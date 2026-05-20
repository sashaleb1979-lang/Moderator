"use strict";

const path = require("node:path");

const { loadJsonFile } = require("../src/db/store");
const { summarizeRobloxCleanupAudit } = require("../src/integrations/roblox-cleanup-audit");

function parseArgs(argv = []) {
  const args = Array.isArray(argv) ? argv : [];
  const dbArgIndex = args.indexOf("--db");
  const sampleLimitArgIndex = args.indexOf("--sample-limit");
  const includeRecords = args.includes("--records");
  const dbPath = dbArgIndex >= 0 && args[dbArgIndex + 1]
    ? path.resolve(args[dbArgIndex + 1])
    : null;
  const sampleLimit = sampleLimitArgIndex >= 0 && args[sampleLimitArgIndex + 1]
    ? Number(args[sampleLimitArgIndex + 1])
    : 5;

  return {
    dbPath,
    includeRecords,
    sampleLimit,
  };
}

function resolveDbPath(options = {}) {
  if (options.dbPath) return options.dbPath;

  const envPath = String(process.env.DB_PATH || "").trim();
  if (envPath) {
    return path.isAbsolute(envPath)
      ? envPath
      : path.resolve(process.cwd(), envPath);
  }

  return path.resolve(process.cwd(), "welcome-db.json");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const dbPath = resolveDbPath(options);
  const db = loadJsonFile(dbPath, null);

  if (!db || typeof db !== "object") {
    throw new Error(`DB not found or unreadable: ${dbPath}`);
  }

  const summary = summarizeRobloxCleanupAudit(db, {
    includeRecords: options.includeRecords,
    sampleLimit: options.sampleLimit,
  });

  console.log(JSON.stringify({
    dbPath,
    ...summary,
  }, null, 2));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});