"use strict";

// Reverse of migrate-db-to-sqlite: export the current SQLite store back to a
// JSON file. Use this before rolling the bot back to the JSON backend, so that
// changes made while running on SQLite are not lost.
//
// Usage:
//   node scripts/export-sqlite-to-json.js [--force]
//   (honors the same DB_PATH / BOT_DATA_DIR / SQLITE_DB_PATH env vars as the bot)

const fs = require("node:fs");
const path = require("node:path");

const { saveJsonFile } = require("../src/db/store");
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

function timestampSuffix() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function main() {
  if (!isSqliteAvailable()) {
    console.error("node:sqlite is not available (needs Node >= 22.5). Aborting.");
    process.exit(1);
  }
  if (!fs.existsSync(SQLITE_DB_PATH)) {
    console.error(`Source SQLite db not found: ${SQLITE_DB_PATH}`);
    process.exit(1);
  }

  console.log(`Source SQLite: ${SQLITE_DB_PATH}`);
  console.log(`Target JSON  : ${DB_PATH}`);

  const adapter = createSqliteAdapter(SQLITE_DB_PATH);
  const raw = adapter.readRaw();
  adapter.close();

  if (!raw) {
    console.error("SQLite database is empty; nothing to export.");
    process.exit(1);
  }
  raw.profiles ||= {};
  raw.submissions ||= {};

  if (fs.existsSync(DB_PATH)) {
    const backup = `${DB_PATH}.bak-${timestampSuffix()}`;
    fs.copyFileSync(DB_PATH, backup);
    console.log(`Existing JSON backed up to: ${backup}`);
    if (!force) {
      console.log("(use --force to skip this prompt-free; the backup above is always made)");
    }
  }

  saveJsonFile(DB_PATH, raw);
  console.log(`Exported ${Object.keys(raw.profiles).length} profiles and ${Object.keys(raw.submissions).length} submissions to JSON.`);
  console.log("You can now set MODERATOR_DB_BACKEND=json (or unset it) and restart.");
}

main();
