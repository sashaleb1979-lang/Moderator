"use strict";

// One-time migration: JSON welcome-db -> incremental SQLite store.
//
// Safe by design:
//   * The source JSON file is only READ, never modified (it stays as a backup).
//   * The target .sqlite is written, then VERIFIED by a cold read-back that must
//     deep-equal the source. If verification fails, the script exits non-zero and
//     you should NOT enable the sqlite backend.
//
// Usage:
//   node scripts/migrate-db-to-sqlite.js [--force]
//   (honors the same DB_PATH / BOT_DATA_DIR / SQLITE_DB_PATH env vars as the bot)

const fs = require("node:fs");
const path = require("node:path");

const { loadJsonFile } = require("../src/db/store");
const { isSqliteAvailable, createSqliteAdapter } = require("../src/db/sqlite-adapter");

function resolvePathFromBase(base, target) {
  return path.isAbsolute(target) ? target : path.join(base, target);
}

const PROJECT_ROOT = path.resolve(__dirname, "..");
const explicitRoot = String(process.env.BOT_DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || "").trim();
const DATA_ROOT = explicitRoot
  ? resolvePathFromBase(PROJECT_ROOT, explicitRoot)
  : (process.env.RAILWAY_ENVIRONMENT_NAME && fs.existsSync("/data") ? "/data" : PROJECT_ROOT);
const DB_PATH = resolvePathFromBase(DATA_ROOT, process.env.DB_PATH || "welcome-db.json");
const SQLITE_DB_PATH = process.env.SQLITE_DB_PATH
  ? resolvePathFromBase(DATA_ROOT, process.env.SQLITE_DB_PATH)
  : (/\.json$/i.test(DB_PATH) ? DB_PATH.replace(/\.json$/i, ".sqlite") : `${DB_PATH}.sqlite`);

const force = process.argv.slice(2).includes("--force");

// Order-insensitive structural comparison (object key order must not matter).
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (!a || !b || typeof a !== "object") return false;
  const aArr = Array.isArray(a);
  if (aArr !== Array.isArray(b)) return false;
  if (aArr) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const key of ak) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!deepEqual(a[key], b[key])) return false;
  }
  return true;
}

function timestampSuffix() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function main() {
  if (!isSqliteAvailable()) {
    console.error("node:sqlite is not available (needs Node >= 22.5). Aborting.");
    process.exit(1);
  }
  if (!fs.existsSync(DB_PATH)) {
    console.error(`Source JSON db not found: ${DB_PATH}`);
    process.exit(1);
  }
  if (fs.existsSync(SQLITE_DB_PATH) && !force) {
    console.error(`Target SQLite db already exists: ${SQLITE_DB_PATH}`);
    console.error("Re-run with --force to replace it (the existing file is backed up first).");
    process.exit(1);
  }

  console.log(`Source JSON : ${DB_PATH}`);
  console.log(`Target SQLite: ${SQLITE_DB_PATH}`);

  const raw = loadJsonFile(DB_PATH, null);
  if (!raw || typeof raw !== "object") {
    console.error("Source db is empty or invalid.");
    process.exit(1);
  }
  // Match the runtime load contract (it defaults these maps).
  raw.profiles ||= {};
  raw.submissions ||= {};

  console.log(`Top-level keys: ${Object.keys(raw).join(", ")}`);
  console.log(`Profiles: ${Object.keys(raw.profiles).length}, submissions: ${Object.keys(raw.submissions).length}`);

  if (fs.existsSync(SQLITE_DB_PATH) && force) {
    const backup = `${SQLITE_DB_PATH}.bak-${timestampSuffix()}`;
    fs.renameSync(SQLITE_DB_PATH, backup);
    for (const suffix of ["-wal", "-shm"]) {
      const sidecar = SQLITE_DB_PATH + suffix;
      if (fs.existsSync(sidecar)) fs.rmSync(sidecar, { force: true });
    }
    console.log(`Existing SQLite backed up to: ${backup}`);
  }

  const startedAt = Date.now();
  const adapter = createSqliteAdapter(SQLITE_DB_PATH);
  const writeResult = adapter.writeSync(raw);
  adapter.close();
  console.log(`Wrote ${writeResult.changedRows} rows in ${Date.now() - startedAt}ms.`);

  // Cold read-back verification through a fresh adapter.
  const verifyAdapter = createSqliteAdapter(SQLITE_DB_PATH);
  const readBack = verifyAdapter.readRaw();
  verifyAdapter.close();

  if (!deepEqual(readBack, raw)) {
    const keys = new Set([...Object.keys(raw), ...Object.keys(readBack || {})]);
    for (const key of keys) {
      if (!deepEqual(raw[key], (readBack || {})[key])) console.error(`  mismatch in top-level key: ${key}`);
    }
    console.error("VERIFICATION FAILED. The JSON file is untouched; do NOT enable the sqlite backend.");
    process.exit(2);
  }

  console.log("VERIFICATION OK: SQLite content matches the JSON source exactly.");
  console.log("");
  console.log("Next steps:");
  console.log("  1. Set MODERATOR_DB_BACKEND=sqlite in the bot env and restart.");
  console.log("  2. The JSON file is kept as a pre-migration backup.");
  console.log("  Note: after the bot writes to SQLite, rolling back to JSON needs an");
  console.log("        export (SQLite -> JSON) first — interim changes are only in SQLite.");
}

main();
