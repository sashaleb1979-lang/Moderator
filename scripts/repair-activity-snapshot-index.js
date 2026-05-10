"use strict";

const path = require("node:path");

const { loadJsonFile, saveJsonFile } = require("../src/db/store");
const {
  collectActivityHistoryTargetUserIds,
  collectActivitySnapshotTargetUserIds,
  getActivityPersistedSnapshotRecord,
} = require("../src/activity/user-state");
const {
  promotePersistedActivityMirrorsToSnapshots,
  rebuildActivitySnapshots,
} = require("../src/activity/runtime");

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

function summarizeSnapshotIndex(db = {}) {
  const persistedTargetUserIds = collectActivitySnapshotTargetUserIds(db);
  const historyTargetUserIdSet = new Set(collectActivityHistoryTargetUserIds(db));
  let mirrorOnlyPersistedUserCount = 0;
  let snapshotWithoutLocalHistoryUserCount = 0;

  for (const userId of persistedTargetUserIds) {
    const persistedSnapshot = getActivityPersistedSnapshotRecord(db, userId);
    if (persistedSnapshot.source === "profile_mirror") {
      mirrorOnlyPersistedUserCount += 1;
      continue;
    }

    if (persistedSnapshot.source === "state_snapshot" && !historyTargetUserIdSet.has(userId)) {
      snapshotWithoutLocalHistoryUserCount += 1;
    }
  }

  return {
    persistedTargetUserCount: persistedTargetUserIds.length,
    historyTargetUserCount: historyTargetUserIdSet.size,
    snapshotCount: Object.keys(db?.sot?.activity?.userSnapshots || {}).length,
    mirrorOnlyPersistedUserCount,
    snapshotWithoutLocalHistoryUserCount,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const dbPath = resolveDbPath(options);
  const db = loadJsonFile(dbPath, null);

  if (!db || typeof db !== "object") {
    throw new Error(`DB not found or unreadable: ${dbPath}`);
  }

  const repairedAt = new Date().toISOString();
  const before = summarizeSnapshotIndex(db);
  const historyTargetUserIds = collectActivityHistoryTargetUserIds(db);
  const rebuildResult = await rebuildActivitySnapshots({
    db,
    userIds: historyTargetUserIds,
    now: repairedAt,
    resolveMemberActivityMeta: () => null,
  });
  const promotionResult = promotePersistedActivityMirrorsToSnapshots({ db });
  const after = summarizeSnapshotIndex(db);

  if (options.write) {
    saveJsonFile(dbPath, db);
  }

  console.log(JSON.stringify({
    dbPath,
    write: options.write,
    repairedAt,
    before,
    rebuildResult: {
      rebuiltUserCount: rebuildResult.rebuiltUserCount,
      rebuiltUsers: rebuildResult.rebuiltUsers,
    },
    promotionResult,
    after,
  }, null, 2));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});