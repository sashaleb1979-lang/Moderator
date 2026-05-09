"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createRobloxJobCoordinator,
  createRobloxRuntimeState,
  flushRobloxRuntime,
  runRobloxProfileRefreshJob,
  runRobloxPlaytimeSyncJob,
  runRobloxPlaytimeCycle,
} = require("../src/runtime/roblox-jobs");

function createDeferred() {
  let resolve = null;
  let reject = null;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

test("createRobloxJobCoordinator serializes different job kinds and dedupes same-kind runs", async () => {
  const calls = [];
  const refreshGate = createDeferred();
  const coordinator = createRobloxJobCoordinator();

  const refreshJob = coordinator.run("refresh", async () => {
    calls.push("refresh:start");
    await refreshGate.promise;
    calls.push("refresh:end");
    return "refresh-ok";
  });
  const refreshDuplicate = coordinator.run("refresh", async () => {
    calls.push("refresh:duplicate");
    return "should-not-run";
  });
  const playtimeJob = coordinator.run("playtime", async () => {
    calls.push("playtime:start");
    calls.push("playtime:end");
    return "playtime-ok";
  });

  assert.strictEqual(refreshJob, refreshDuplicate);
  assert.equal(coordinator.hasPendingJob("refresh"), true);
  assert.equal(coordinator.hasPendingJob("playtime"), true);

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["refresh:start"]);

  refreshGate.resolve();

  assert.equal(await refreshJob, "refresh-ok");
  assert.equal(await playtimeJob, "playtime-ok");
  assert.deepEqual(calls, [
    "refresh:start",
    "refresh:end",
    "playtime:start",
    "playtime:end",
  ]);
  assert.equal(coordinator.hasPendingJob("refresh"), false);
  assert.equal(coordinator.hasPendingJob("playtime"), false);

  const rerun = await coordinator.run("refresh", async () => {
    calls.push("refresh:rerun");
    return "refresh-rerun";
  });
  assert.equal(rerun, "refresh-rerun");
  assert.equal(calls.at(-1), "refresh:rerun");
});

test("createRobloxJobCoordinator can suppress coordinator-side logging for a job", async () => {
  const errors = [];
  const coordinator = createRobloxJobCoordinator({
    logError: (...args) => errors.push(args.join(" ")),
  });

  await assert.rejects(
    coordinator.run("refresh", async () => {
      throw new Error("boom");
    }, { logErrors: false })
  );

  assert.deepEqual(errors, []);
});

test("runRobloxPlaytimeCycle keeps later batches alive after one batch fails", async () => {
  const processed = [];
  const errors = [];

  const result = await runRobloxPlaytimeCycle({
    userIds: [1, 2, 3, 4, 5],
    batchSize: 2,
    async fetchPresenceBatch(userIds) {
      if (userIds[0] === 3) {
        throw new Error("rate limited");
      }
      return userIds.map((userId) => ({ userId, presenceType: "in_game" }));
    },
    async processPresenceBatch(userIds, presences) {
      processed.push({ userIds, presences });
    },
    logError: (...args) => errors.push(args.join(" ")),
  });

  assert.deepEqual(result, {
    totalCandidates: 5,
    totalBatches: 3,
    processedBatches: 2,
    failedBatches: 1,
    processedUserIds: 3,
    failedUserIds: 2,
  });
  assert.deepEqual(processed.map((entry) => entry.userIds), [[1, 2], [5]]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /rate limited/i);
});

test("runRobloxPlaytimeCycle normalizes candidate ids before batching", async () => {
  const batches = [];

  const result = await runRobloxPlaytimeCycle({
    userIds: [1, "2", 2, 0, null, "bad", 3],
    batchSize: 2,
    async fetchPresenceBatch(userIds) {
      batches.push(userIds);
      return [];
    },
  });

  assert.deepEqual(batches, [[1, 2], [3]]);
  assert.deepEqual(result, {
    totalCandidates: 3,
    totalBatches: 2,
    processedBatches: 2,
    failedBatches: 0,
    processedUserIds: 3,
    failedUserIds: 0,
  });
});

test("runRobloxProfileRefreshJob refreshes verified Roblox profiles and keeps username history current", async () => {
  const db = {
    profiles: {
      discord_1: {
        userId: "discord_1",
        domains: {
          roblox: {
            username: "OldName",
            displayName: "Old Display",
            userId: "123",
            verificationStatus: "verified",
            verifiedAt: "2026-05-01T00:00:00.000Z",
            source: "manual_moderator",
          },
        },
      },
      discord_2: {
        userId: "discord_2",
        domains: {
          roblox: {
            username: "PendingName",
            userId: "999",
            verificationStatus: "pending",
          },
        },
      },
    },
  };

  const result = await runRobloxProfileRefreshJob({
    db,
    now: () => "2026-05-09T12:00:00.000Z",
    async fetchUserProfile(userId) {
      assert.equal(userId, 123);
      return {
        userId: 123,
        username: "NewName",
        displayName: "New Display",
        description: "Refreshed profile",
        createdAt: "2020-01-01T00:00:00.000Z",
        isBanned: false,
        hasVerifiedBadge: true,
        profileUrl: "https://www.roblox.com/users/123/profile",
      };
    },
    async fetchUserAvatarHeadshots(userIds) {
      assert.deepEqual(userIds, [123]);
      return [{ userId: 123, imageUrl: "https://cdn.example/avatar.png" }];
    },
    async fetchUserUsernameHistory(userId) {
      assert.equal(userId, 123);
      return [{ name: "NewName" }, { name: "OldName" }];
    },
  });

  assert.deepEqual(result, {
    totalCandidates: 1,
    refreshedCount: 1,
    failedCount: 0,
    skippedCount: 0,
    avatarErrors: 0,
  });
  assert.equal(db.profiles.discord_1.domains.roblox.username, "NewName");
  assert.equal(db.profiles.discord_1.domains.roblox.displayName, "New Display");
  assert.equal(db.profiles.discord_1.domains.roblox.avatarUrl, "https://cdn.example/avatar.png");
  assert.equal(db.profiles.discord_1.domains.roblox.refreshStatus, "ok");
  assert.equal(db.profiles.discord_1.domains.roblox.refreshError, null);
  assert.equal(db.profiles.discord_1.domains.roblox.lastRefreshAt, "2026-05-09T12:00:00.000Z");
  assert.deepEqual(db.profiles.discord_1.domains.roblox.usernameHistory.map((entry) => entry.name), ["NewName", "OldName"]);
  assert.equal(db.profiles.discord_1.summary.roblox.previousUsername, "OldName");
  assert.equal(db.profiles.discord_2.domains.roblox.verificationStatus, "pending");
});

test("runRobloxProfileRefreshJob marks refresh errors without dropping verified binding", async () => {
  const errors = [];
  const db = {
    profiles: {
      discord_1: {
        userId: "discord_1",
        domains: {
          roblox: {
            username: "StableName",
            displayName: "Stable Display",
            userId: "123",
            verificationStatus: "verified",
            verifiedAt: "2026-05-01T00:00:00.000Z",
            source: "manual_moderator",
          },
        },
      },
    },
  };

  const result = await runRobloxProfileRefreshJob({
    db,
    now: () => "2026-05-09T12:30:00.000Z",
    async fetchUserProfile() {
      throw new Error("temporary upstream error");
    },
    async fetchUserAvatarHeadshots() {
      return [];
    },
    async fetchUserUsernameHistory() {
      return [];
    },
    logError: (...args) => errors.push(args.join(" ")),
  });

  assert.deepEqual(result, {
    totalCandidates: 1,
    refreshedCount: 0,
    failedCount: 1,
    skippedCount: 0,
    avatarErrors: 0,
  });
  assert.equal(db.profiles.discord_1.domains.roblox.userId, "123");
  assert.equal(db.profiles.discord_1.domains.roblox.verificationStatus, "verified");
  assert.equal(db.profiles.discord_1.domains.roblox.refreshStatus, "error");
  assert.match(db.profiles.discord_1.domains.roblox.refreshError, /temporary upstream error/i);
  assert.equal(db.profiles.discord_1.domains.roblox.lastRefreshAt, "2026-05-09T12:30:00.000Z");
  assert.equal(errors.length, 1);
});

test("runRobloxPlaytimeSyncJob updates rolling JJS minutes and co-play state in memory", async () => {
  const runtimeState = createRobloxRuntimeState();
  const db = {
    profiles: {
      user_a: {
        userId: "user_a",
        username: "alpha",
        domains: {
          roblox: {
            username: "AlphaRb",
            userId: "101",
            verificationStatus: "verified",
            serverFriends: {
              userIds: ["202"],
              computedAt: "2026-05-09T10:00:00.000Z",
            },
          },
        },
      },
      user_b: {
        userId: "user_b",
        username: "beta",
        domains: {
          roblox: {
            username: "BetaRb",
            userId: "202",
            verificationStatus: "verified",
            serverFriends: {
              userIds: [],
              computedAt: "2026-05-09T10:00:00.000Z",
            },
          },
        },
      },
    },
  };

  await runRobloxPlaytimeSyncJob({
    db,
    runtimeState,
    now: () => "2026-05-09T12:00:00.000Z",
    roblox: {
      jjsUniverseId: 999,
      playtimePollMinutes: 2,
    },
    async fetchUserPresences(userIds) {
      return userIds.map((userId) => ({
        userId,
        presenceType: "in_game",
        universeId: 999,
        rootPlaceId: 111,
        placeId: 222,
        gameId: "server-1",
      }));
    },
  });

  const result = await runRobloxPlaytimeSyncJob({
    db,
    runtimeState,
    now: () => "2026-05-09T12:02:00.000Z",
    roblox: {
      jjsUniverseId: 999,
      playtimePollMinutes: 2,
    },
    async fetchUserPresences(userIds) {
      return userIds.map((userId) => ({
        userId,
        presenceType: "in_game",
        universeId: 999,
        rootPlaceId: 111,
        placeId: 222,
        gameId: "server-1",
      }));
    },
  });

  assert.deepEqual(result, {
    totalCandidates: 2,
    activeJjsUsers: 2,
    touchedUserCount: 2,
    startedSessionCount: 0,
    closedSessionCount: 0,
    activeCoPlayPairCount: 1,
  });
  assert.equal(db.profiles.user_a.domains.roblox.playtime.totalJjsMinutes, 2);
  assert.equal(db.profiles.user_a.domains.roblox.playtime.jjsMinutes7d, 2);
  assert.equal(db.profiles.user_a.domains.roblox.playtime.jjsMinutes30d, 2);
  assert.equal(db.profiles.user_a.domains.roblox.playtime.currentSessionStartedAt, "2026-05-09T12:00:00.000Z");
  assert.equal(db.profiles.user_a.domains.roblox.coPlay.peers[0].peerUserId, "user_b");
  assert.equal(db.profiles.user_a.domains.roblox.coPlay.peers[0].minutesTogether, 2);
  assert.equal(db.profiles.user_a.domains.roblox.coPlay.peers[0].sessionsTogether, 1);
  assert.equal(db.profiles.user_a.domains.roblox.coPlay.peers[0].isRobloxFriend, true);
  assert.equal(db.profiles.user_b.domains.roblox.coPlay.peers[0].isRobloxFriend, false);
  assert.equal(runtimeState.dirtyDiscordUserIds.has("user_a"), true);
  assert.equal(runtimeState.dirtyDiscordUserIds.has("user_b"), true);
});

test("flushRobloxRuntime persists only when playtime runtime marked profiles dirty", () => {
  const runtimeState = createRobloxRuntimeState();
  const db = {
    profiles: {
      user_a: {
        userId: "user_a",
        domains: {
          roblox: {
            username: "AlphaRb",
            userId: "101",
            verificationStatus: "verified",
          },
        },
      },
    },
  };
  const saved = [];

  runtimeState.dirtyDiscordUserIds.add("user_a");
  runtimeState.dirty = true;

  const result = flushRobloxRuntime({
    db,
    runtimeState,
    now: () => "2026-05-09T12:10:00.000Z",
    saveDb() {
      saved.push("saved");
    },
  });

  assert.deepEqual(result, {
    saved: true,
    dirtyUserCount: 1,
    flushedAt: "2026-05-09T12:10:00.000Z",
  });
  assert.deepEqual(saved, ["saved"]);
  assert.equal(runtimeState.dirty, false);
  assert.equal(runtimeState.dirtyDiscordUserIds.size, 0);
});