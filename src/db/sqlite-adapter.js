"use strict";

// SQLite persistence adapter for the db store, built on Node's built-in
// `node:sqlite` (Node >= 22.5) so there is no native dependency to compile.
//
// It plugs into createDbStore via the `persistence` option and exposes the same
// readRaw / writeSync / writeAsync contract as the default JSON backend. The key
// difference: writes are INCREMENTAL. Instead of rewriting the whole ~20MB
// database on every save, each top-level entry (every profile, every
// submission, and each remaining top-level object) is serialized and compared
// against the last-persisted value; only changed rows are UPSERTed and removed
// rows DELETEd, all inside a single transaction.

const path = require("node:path");

let DatabaseSync = null;
try {
  ({ DatabaseSync } = require("node:sqlite"));
} catch {
  DatabaseSync = null;
}

function isSqliteAvailable() {
  return typeof DatabaseSync === "function";
}

// Top-level keys that are large keyed maps get their own row-per-entry table.
// Everything else (config, sot, cooldowns, roleGrantMessages, comboGuide, ...)
// is stored whole, one row per key, in `kv`.
const ROW_TABLES = ["profiles", "submissions"];

function createSqliteAdapter(dbPath, options = {}) {
  if (!isSqliteAvailable()) {
    throw new Error("node:sqlite is not available (requires Node >= 22.5).");
  }
  if (!dbPath) throw new Error("sqlite dbPath is required");

  const fs = require("node:fs");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, data TEXT NOT NULL);");
  db.exec("CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, data TEXT NOT NULL);");
  db.exec("CREATE TABLE IF NOT EXISTS submissions (id TEXT PRIMARY KEY, data TEXT NOT NULL);");

  const statements = {
    kvSelectAll: db.prepare("SELECT key, data FROM kv"),
    kvUpsert: db.prepare("INSERT INTO kv(key, data) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data"),
    kvDelete: db.prepare("DELETE FROM kv WHERE key = ?"),
    profilesSelectAll: db.prepare("SELECT id, data FROM profiles"),
    profilesUpsert: db.prepare("INSERT INTO profiles(id, data) VALUES(?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data"),
    profilesDelete: db.prepare("DELETE FROM profiles WHERE id = ?"),
    submissionsSelectAll: db.prepare("SELECT id, data FROM submissions"),
    submissionsUpsert: db.prepare("INSERT INTO submissions(id, data) VALUES(?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data"),
    submissionsDelete: db.prepare("DELETE FROM submissions WHERE id = ?"),
  };

  // Last-persisted serialization per entry, used to compute incremental diffs.
  // Only mutated AFTER a successful COMMIT so a rollback can never desync it.
  const persistedCache = {
    kv: new Map(),
    profiles: new Map(),
    submissions: new Map(),
  };

  function readRaw() {
    const kvRows = statements.kvSelectAll.all();
    const profileRows = statements.profilesSelectAll.all();
    const submissionRows = statements.submissionsSelectAll.all();

    if (!kvRows.length && !profileRows.length && !submissionRows.length) {
      return undefined; // empty database -> caller falls back to defaults
    }

    const raw = {};
    persistedCache.kv.clear();
    for (const row of kvRows) {
      raw[row.key] = JSON.parse(row.data);
      persistedCache.kv.set(row.key, row.data);
    }

    const profiles = {};
    persistedCache.profiles.clear();
    for (const row of profileRows) {
      profiles[row.id] = JSON.parse(row.data);
      persistedCache.profiles.set(row.id, row.data);
    }

    const submissions = {};
    persistedCache.submissions.clear();
    for (const row of submissionRows) {
      submissions[row.id] = JSON.parse(row.data);
      persistedCache.submissions.set(row.id, row.data);
    }

    raw.profiles = profiles;
    raw.submissions = submissions;
    return raw;
  }

  // Compute the row changes for one keyed collection without touching the cache.
  function planCollectionDiff(cacheMap, sourceMap) {
    const upserts = [];
    const deletes = [];
    const seen = new Set();

    for (const id of Object.keys(sourceMap || {})) {
      seen.add(id);
      const serialized = JSON.stringify(sourceMap[id]);
      if (cacheMap.get(id) !== serialized) {
        upserts.push([id, serialized]);
      }
    }
    for (const id of cacheMap.keys()) {
      if (!seen.has(id)) deletes.push(id);
    }
    return { upserts, deletes };
  }

  function writeSync(workingDb) {
    const source = workingDb || {};

    // kv = every top-level key except the dedicated row-tables.
    const kvSource = {};
    for (const key of Object.keys(source)) {
      if (ROW_TABLES.includes(key)) continue;
      kvSource[key] = source[key];
    }

    const kvDiff = planCollectionDiff(persistedCache.kv, kvSource);
    const profilesDiff = planCollectionDiff(persistedCache.profiles, source.profiles || {});
    const submissionsDiff = planCollectionDiff(persistedCache.submissions, source.submissions || {});

    db.exec("BEGIN IMMEDIATE");
    try {
      for (const [key, data] of kvDiff.upserts) statements.kvUpsert.run(key, data);
      for (const key of kvDiff.deletes) statements.kvDelete.run(key);
      for (const [id, data] of profilesDiff.upserts) statements.profilesUpsert.run(id, data);
      for (const id of profilesDiff.deletes) statements.profilesDelete.run(id);
      for (const [id, data] of submissionsDiff.upserts) statements.submissionsUpsert.run(id, data);
      for (const id of submissionsDiff.deletes) statements.submissionsDelete.run(id);
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* noop */ }
      throw error;
    }

    // Commit succeeded: sync the cache to match what is now on disk.
    for (const [key, data] of kvDiff.upserts) persistedCache.kv.set(key, data);
    for (const key of kvDiff.deletes) persistedCache.kv.delete(key);
    for (const [id, data] of profilesDiff.upserts) persistedCache.profiles.set(id, data);
    for (const id of profilesDiff.deletes) persistedCache.profiles.delete(id);
    for (const [id, data] of submissionsDiff.upserts) persistedCache.submissions.set(id, data);
    for (const id of submissionsDiff.deletes) persistedCache.submissions.delete(id);

    return {
      changedRows:
        kvDiff.upserts.length + kvDiff.deletes.length
        + profilesDiff.upserts.length + profilesDiff.deletes.length
        + submissionsDiff.upserts.length + submissionsDiff.deletes.length,
    };
  }

  async function writeAsync(workingDb) {
    // node:sqlite is synchronous, but incremental writes touch only the handful
    // of changed rows, so this stays well under a millisecond in practice.
    return writeSync(workingDb);
  }

  function close() {
    try { db.close(); } catch { /* noop */ }
  }

  return {
    readRaw,
    writeSync,
    writeAsync,
    close,
    _db: options.exposeHandleForTests ? db : undefined,
  };
}

module.exports = {
  isSqliteAvailable,
  createSqliteAdapter,
};
