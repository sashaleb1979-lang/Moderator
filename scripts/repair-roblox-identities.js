"use strict";

require("dotenv").config();

const path = require("node:path");

const { loadJsonFile, saveJsonFile } = require("../src/db/store");
const { createRobloxApiClient } = require("../src/integrations/roblox-service");
const { applyRobloxBindingRepairPass } = require("../src/integrations/roblox-binding-repair");

function parseArgs(argv = []) {
  const args = Array.isArray(argv) ? argv : [];
  const write = args.includes("--write");
  const dbArgIndex = args.indexOf("--db");
  const dbPath = dbArgIndex >= 0 && args[dbArgIndex + 1]
    ? path.resolve(args[dbArgIndex + 1])
    : null;

  return {
    write,
    dbPath,
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

  const robloxApiClient = createRobloxApiClient();
  const result = await applyRobloxBindingRepairPass({
    db,
    dryRun: options.write !== true,
    persistTrail: options.write === true,
    source: options.write === true ? "repair_script_apply" : "repair_script_dry_run",
    fetchUsersByUsernames: robloxApiClient.fetchUsersByUsernames.bind(robloxApiClient),
  });

  if (options.write === true) {
    saveJsonFile(dbPath, db);
  }

  console.log(JSON.stringify({
    dbPath,
    write: options.write,
    ...result,
  }, null, 2));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});