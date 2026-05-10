"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Collection } = require("discord.js");

const {
  applyInitialActivityRoleAssignments,
  buildActivityRoleAssignmentPlan,
  getActivityUserInspection,
  importHistoricalActivity,
  importHistoricalActivityFromWatchedChannels,
  runActivityRoleSyncFromSnapshots,
  runDailyActivityRoleSync,
} = require("../src/activity/operator");
const { ensureActivityState, updateActivityConfig, upsertWatchedChannel } = require("../src/activity/state");

function seedWatchedChannels(db) {
  upsertWatchedChannel(db, {
    channelId: "main-1",
    channelType: "main_chat",
    channelNameCache: "Main",
    now: "2026-05-01T00:00:00.000Z",
  });
  upsertWatchedChannel(db, {
    channelId: "small-1",
    channelType: "small_chat",
    channelNameCache: "Small",
    now: "2026-05-01T00:00:00.000Z",
  });
}

function createDeferred() {
  let resolve = null;
  let reject = null;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

test("importHistoricalActivity replays history, finalizes imported sessions, records calibration, and runs initial role assignment", async () => {
  const db = {
    profiles: {
      "user-1": {
        userId: "user-1",
        username: "todo",
      },
    },
  };
  seedWatchedChannels(db);
  updateActivityConfig(db, {
    activityRoleIds: {
      weak: "role-weak",
      floating: "role-floating",
    },
  });

  const roleChanges = [];
  const serializedCalls = [];
  const saved = [];

  const result = await importHistoricalActivity({
    db,
    requestedByUserId: "mod-1",
    entries: [
      {
        guildId: "guild-1",
        userId: "user-1",
        channelId: "small-1",
        createdAt: "2026-05-01T10:20:00.000Z",
      },
      {
        guildId: "guild-1",
        userId: "user-1",
        channelId: "main-1",
        createdAt: "2026-05-01T10:00:00.000Z",
      },
    ],
    resolveMemberRoleIds(userId) {
      assert.equal(userId, "user-1");
      return ["role-floating"];
    },
    resolveMemberActivityMeta() {
      return {
        joinedAt: "2026-04-01T10:00:00.000Z",
      };
    },
    async applyRoleChanges(change) {
      roleChanges.push(change);
    },
    saveDb() {
      saved.push("saved");
    },
    async runSerialized(task, label) {
      serializedCalls.push(label);
      return task();
    },
  });

  assert.deepEqual(serializedCalls, ["activity-historical-import"]);
  assert.equal(saved.length, 1);
  assert.equal(result.importedEntryCount, 2);
  assert.equal(result.ignoredEntryCount, 0);
  assert.equal(result.finalizedSessionCount, 1);
  assert.equal(result.initialRoleAssignment.appliedCount, 1);
  assert.deepEqual(Object.keys(ensureActivityState(db).runtime.openSessions), []);
  assert.equal(db.sot.activity.globalUserSessions.length, 1);
  assert.equal(db.sot.activity.calibrationRuns.length, 1);
  assert.equal(db.sot.activity.calibrationRuns[0].mode, "historical_import");
  assert.equal(db.sot.activity.calibrationRuns[0].requestedByUserId, "mod-1");
  assert.equal(db.sot.activity.calibrationRuns[0].importedEntryCount, 2);
  assert.equal(db.profiles["user-1"].domains.activity.desiredActivityRoleKey, "weak");
  assert.equal(db.profiles["user-1"].domains.activity.appliedActivityRoleKey, "weak");
  assert.equal(db.profiles["user-1"].summary.activity.appliedActivityRoleKey, "weak");
  assert.equal(db.profiles["user-1"].domains.activity.lastRoleAppliedAt, result.initialRoleAssignment.appliedAt);
  assert.deepEqual(roleChanges, [
    {
      userId: "user-1",
      desiredRoleKey: "weak",
      desiredRoleId: "role-weak",
      addRoleIds: ["role-weak"],
      removeRoleIds: ["role-floating"],
    },
  ]);
});

test("applyInitialActivityRoleAssignments skips manual, frozen, unmapped, and unchanged users", async () => {
  const db = {
    profiles: {
      manual: {
        userId: "manual",
        domains: {
          activity: {
            desiredActivityRoleKey: "weak",
            manualOverride: true,
          },
        },
      },
      frozen: {
        userId: "frozen",
        domains: {
          activity: {
            desiredActivityRoleKey: "weak",
            autoRoleFrozen: true,
          },
        },
      },
      unmapped: {
        userId: "unmapped",
        domains: {
          activity: {
            desiredActivityRoleKey: "stable",
          },
        },
      },
      unchanged: {
        userId: "unchanged",
        domains: {
          activity: {
            desiredActivityRoleKey: "weak",
            appliedActivityRoleKey: "weak",
          },
        },
      },
    },
  };
  updateActivityConfig(db, {
    activityRoleIds: {
      weak: "role-weak",
    },
  });

  const roleChanges = [];
  const result = await applyInitialActivityRoleAssignments({
    db,
    userIds: ["manual", "frozen", "unmapped", "unchanged"],
    resolveMemberRoleIds(userId) {
      if (userId === "unchanged") return ["role-weak"];
      return [];
    },
    async applyRoleChanges(change) {
      roleChanges.push(change);
    },
    now: "2026-05-09T12:00:00.000Z",
  });

  assert.equal(result.appliedCount, 0);
  assert.equal(result.skippedCount, 4);
  assert.deepEqual(result.appliedUserIds, []);
  assert.deepEqual(roleChanges, []);
  assert.equal(db.profiles.manual.domains.activity.appliedActivityRoleKey, null);
  assert.equal(db.profiles.frozen.domains.activity.appliedActivityRoleKey, null);
  assert.equal(db.profiles.unmapped.domains.activity.appliedActivityRoleKey, null);
  assert.equal(db.profiles.unchanged.domains.activity.appliedActivityRoleKey, "weak");
});

test("buildActivityRoleAssignmentPlan removes stale managed roles when desired role is missing or unmapped", () => {
  const db = {
    profiles: {
      missing: {
        userId: "missing",
        domains: {
          activity: {
            desiredActivityRoleKey: null,
            appliedActivityRoleKey: "weak",
          },
        },
      },
      unmapped: {
        userId: "unmapped",
        domains: {
          activity: {
            desiredActivityRoleKey: "stable",
            appliedActivityRoleKey: "weak",
          },
        },
      },
    },
  };

  updateActivityConfig(db, {
    activityRoleIds: {
      weak: "role-weak",
      floating: "role-floating",
    },
  });

  const missingPlan = buildActivityRoleAssignmentPlan({
    db,
    userId: "missing",
    memberRoleIds: ["role-weak", "role-floating"],
  });
  assert.equal(missingPlan.shouldApply, true);
  assert.deepEqual(missingPlan.addRoleIds, []);
  assert.deepEqual(missingPlan.removeRoleIds.slice().sort(), ["role-floating", "role-weak"]);

  const unmappedPlan = buildActivityRoleAssignmentPlan({
    db,
    userId: "unmapped",
    memberRoleIds: ["role-weak"],
  });
  assert.equal(unmappedPlan.shouldApply, true);
  assert.equal(unmappedPlan.desiredRoleKey, "stable");
  assert.equal(unmappedPlan.desiredRoleId, null);
  assert.deepEqual(unmappedPlan.addRoleIds, []);
  assert.deepEqual(unmappedPlan.removeRoleIds, ["role-weak"]);
});

test("applyInitialActivityRoleAssignments cleans duplicate managed roles when desired role is missing", async () => {
  const db = {
    profiles: {
      duplicate: {
        userId: "duplicate",
        domains: {
          activity: {
            desiredActivityRoleKey: null,
            appliedActivityRoleKey: "weak",
          },
        },
      },
    },
  };

  updateActivityConfig(db, {
    activityRoleIds: {
      weak: "role-weak",
      floating: "role-floating",
    },
  });

  const roleChanges = [];
  const result = await applyInitialActivityRoleAssignments({
    db,
    userIds: ["duplicate"],
    resolveMemberRoleIds() {
      return ["role-weak", "role-floating"];
    },
    async applyRoleChanges(change) {
      roleChanges.push(change);
      return true;
    },
    now: "2026-05-09T12:00:00.000Z",
  });

  assert.equal(result.appliedCount, 1);
  assert.equal(result.skippedCount, 0);
  assert.deepEqual(roleChanges, [
    {
      userId: "duplicate",
      desiredRoleKey: null,
      desiredRoleId: null,
      addRoleIds: [],
      removeRoleIds: ["role-floating", "role-weak"],
    },
  ]);
  assert.equal(db.profiles.duplicate.domains.activity.appliedActivityRoleKey, null);
});

test("runDailyActivityRoleSync targets activity-owned users instead of every profile record", async () => {
  const db = {
    profiles: {
      profileOnly: {
        userId: "profileOnly",
        username: "todo",
      },
      activeUser: {
        userId: "activeUser",
        username: "todo",
      },
    },
    sot: {
      activity: {
        config: {},
        watchedChannels: [],
        globalUserSessions: [
          {
            guildId: "guild-1",
            userId: "activeUser",
            startedAt: "2026-05-08T12:00:00.000Z",
            endedAt: "2026-05-08T12:10:00.000Z",
            effectiveValue: 1,
          },
        ],
        userChannelDailyStats: [
          {
            guildId: "guild-1",
            channelId: "main-1",
            userId: "activeUser",
            date: "2026-05-08",
            messagesCount: 8,
            weightedMessagesCount: 8,
            sessionsCount: 1,
            effectiveSessionsCount: 1,
            firstMessageAt: "2026-05-08T12:00:00.000Z",
            lastMessageAt: "2026-05-08T12:10:00.000Z",
          },
        ],
        userSnapshots: {
          activeUser: {
            desiredActivityRoleKey: "weak",
          },
        },
        calibrationRuns: [],
        ops: { moderationAuditLog: [] },
        runtime: { openSessions: {}, dirtyUsers: [] },
      },
    },
  };

  updateActivityConfig(db, {
    activityRoleIds: {
      weak: "role-weak",
    },
  });

  const resolvedUserIds = [];
  const result = await runDailyActivityRoleSync({
    db,
    now: "2026-05-09T12:00:00.000Z",
    resolveMemberRoleIds(userId) {
      resolvedUserIds.push(userId);
      return userId === "activeUser" ? ["role-weak"] : [];
    },
    resolveMemberActivityMeta() {
      return {
        joinedAt: "2026-05-01T12:00:00.000Z",
      };
    },
    async applyRoleChanges() {
      return true;
    },
  });

  assert.equal(result.targetUserCount, 1);
  assert.equal(result.rebuiltUserCount, 1);
  assert.deepEqual(resolvedUserIds, ["activeUser"]);
  assert.equal(db.profiles.profileOnly?.domains?.activity ?? null, null);
  assert.equal(db.sot.activity.runtime.lastDailyRoleSyncStats.targetUserCount, 1);
  assert.equal(db.sot.activity.runtime.lastDailyRoleSyncStats.managedRoleHolderCount, 0);
  assert.equal(db.sot.activity.runtime.lastDailyRoleSyncStats.localActivityTargetCount, 1);
  assert.equal(db.sot.activity.runtime.lastDailyRoleSyncStats.missingLocalHistoryUserCount, 0);
  assert.equal(db.sot.activity.runtime.lastDailyRoleSyncStats.snapshotWithoutLocalHistoryUserCount, 0);
  assert.equal(db.sot.activity.runtime.lastDailyRoleSyncStats.mirrorOnlyPersistedUserCount, 0);
  assert.equal(db.sot.activity.runtime.lastDailyRoleSyncStats.managedRoleHolderWithoutPersistedActivityUserCount, 0);
  assert.equal(db.sot.activity.runtime.lastRebuildAndRoleSyncAt, "2026-05-09T12:00:00.000Z");
  assert.deepEqual(db.sot.activity.runtime.lastRebuildAndRoleSyncStats, db.sot.activity.runtime.lastDailyRoleSyncStats);
});

test("runDailyActivityRoleSync reports managed-role holders without local history without auto-demoting them", async () => {
  const db = {
    profiles: {
      staleHolder: {
        userId: "staleHolder",
        domains: {
          activity: {
            desiredActivityRoleKey: null,
            appliedActivityRoleKey: "weak",
          },
        },
      },
    },
    sot: {
      activity: {
        config: {},
        watchedChannels: [],
        globalUserSessions: [],
        userChannelDailyStats: [],
        userSnapshots: {},
        calibrationRuns: [],
        ops: { moderationAuditLog: [] },
        runtime: { openSessions: {}, dirtyUsers: [] },
      },
    },
  };

  updateActivityConfig(db, {
    activityRoleIds: {
      weak: "role-weak",
      floating: "role-floating",
    },
  });

  const roleChanges = [];
  const result = await runDailyActivityRoleSync({
    db,
    now: "2026-05-09T12:00:00.000Z",
    listManagedActivityRoleUserIds() {
      return ["staleHolder"];
    },
    resolveMemberRoleIds() {
      return ["role-weak", "role-floating"];
    },
    resolveMemberActivityMeta() {
      return {
        joinedAt: "2026-05-01T12:00:00.000Z",
      };
    },
    async applyRoleChanges(change) {
      roleChanges.push(change);
      return true;
    },
  });

  assert.equal(result.targetUserCount, 0);
  assert.equal(result.rebuiltUserCount, 0);
  assert.equal(result.roleAssignment.appliedCount, 0);
  assert.deepEqual(roleChanges, []);
  assert.deepEqual(db.sot.activity.runtime.lastDailyRoleSyncStats, {
    targetUserCount: 0,
    managedRoleHolderCount: 1,
    localActivityTargetCount: 0,
    missingLocalHistoryUserCount: 1,
    snapshotWithoutLocalHistoryUserCount: 0,
    mirrorOnlyPersistedUserCount: 0,
    managedRoleHolderWithoutPersistedActivityUserCount: 1,
    rebuiltUserCount: 0,
    appliedCount: 0,
    skippedCount: 0,
    skipReasonCounts: {},
    syncMode: "rebuild_and_sync",
  });
});

test("runDailyActivityRoleSync applies canonical saved snapshots without rebuilding mirror-only fallback users", async () => {
  const db = {
    profiles: {
      mirrorOnly: {
        userId: "mirrorOnly",
        domains: {
          activity: {
            activityScore: 26,
            baseActivityScore: 26,
            desiredActivityRoleKey: "weak",
            appliedActivityRoleKey: null,
            roleEligibilityStatus: "eligible",
            roleEligibleForActivityRole: true,
            recalculatedAt: "2026-05-08T12:00:00.000Z",
            lastSeenAt: "2026-05-08T11:50:00.000Z",
          },
        },
      },
    },
    sot: {
      activity: {
        config: {},
        watchedChannels: [],
        globalUserSessions: [],
        userChannelDailyStats: [],
        userSnapshots: {
          snapshotOnly: {
            activityScore: 26,
            baseActivityScore: 26,
            desiredActivityRoleKey: "weak",
            appliedActivityRoleKey: null,
            roleEligibilityStatus: "eligible",
            roleEligibleForActivityRole: true,
            recalculatedAt: "2026-05-08T12:00:00.000Z",
            lastSeenAt: "2026-05-08T11:50:00.000Z",
          },
        },
        calibrationRuns: [],
        ops: { moderationAuditLog: [] },
        runtime: { openSessions: {}, dirtyUsers: [] },
      },
    },
  };

  updateActivityConfig(db, {
    activityRoleIds: {
      weak: "role-weak",
    },
  });

  const resolvedRoleUserIds = [];
  const resolvedMetaUserIds = [];
  const roleChanges = [];
  const result = await runDailyActivityRoleSync({
    db,
    now: "2026-05-09T12:00:00.000Z",
    resolveMemberRoleIds(userId) {
      resolvedRoleUserIds.push(userId);
      return [];
    },
    resolveMemberActivityMeta(userId) {
      resolvedMetaUserIds.push(userId);
      return {
        joinedAt: "2026-05-01T12:00:00.000Z",
      };
    },
    async applyRoleChanges(change) {
      roleChanges.push(change);
      return true;
    },
  });

  assert.equal(result.targetUserCount, 1);
  assert.equal(result.localActivityTargetCount, 0);
  assert.equal(result.missingLocalHistoryUserCount, 1);
  assert.equal(result.rebuiltUserCount, 0);
  assert.deepEqual(resolvedMetaUserIds, []);
  assert.deepEqual(resolvedRoleUserIds, ["snapshotOnly"]);
  assert.deepEqual(roleChanges, [
    {
      userId: "snapshotOnly",
      desiredRoleKey: "weak",
      desiredRoleId: "role-weak",
      addRoleIds: ["role-weak"],
      removeRoleIds: [],
    },
  ]);
  assert.equal(db.profiles.snapshotOnly.domains.activity.appliedActivityRoleKey, "weak");
  assert.equal(db.profiles.mirrorOnly.domains.activity.appliedActivityRoleKey, null);
  assert.deepEqual(db.sot.activity.runtime.lastDailyRoleSyncStats, {
    targetUserCount: 1,
    managedRoleHolderCount: 0,
    localActivityTargetCount: 0,
    missingLocalHistoryUserCount: 1,
    snapshotWithoutLocalHistoryUserCount: 1,
    mirrorOnlyPersistedUserCount: 0,
    managedRoleHolderWithoutPersistedActivityUserCount: 0,
    rebuiltUserCount: 0,
    appliedCount: 1,
    skippedCount: 0,
    skipReasonCounts: {},
    syncMode: "rebuild_and_sync",
  });
});

test("runDailyActivityRoleSync ignores explicit users without local history or canonical snapshots", async () => {
  const db = {
    profiles: {
      mirrorOnly: {
        userId: "mirrorOnly",
        domains: {
          activity: {
            activityScore: 26,
            baseActivityScore: 26,
            desiredActivityRoleKey: "weak",
            appliedActivityRoleKey: null,
            roleEligibilityStatus: "eligible",
            roleEligibleForActivityRole: true,
            recalculatedAt: "2026-05-08T12:00:00.000Z",
            lastSeenAt: "2026-05-08T11:50:00.000Z",
          },
        },
      },
    },
    sot: {
      activity: {
        config: {},
        watchedChannels: [],
        globalUserSessions: [],
        userChannelDailyStats: [],
        userSnapshots: {},
        calibrationRuns: [],
        ops: { moderationAuditLog: [] },
        runtime: { openSessions: {}, dirtyUsers: [] },
      },
    },
  };

  updateActivityConfig(db, {
    activityRoleIds: {
      weak: "role-weak",
    },
  });

  const resolvedRoleUserIds = [];
  const resolvedMetaUserIds = [];
  const roleChanges = [];
  const result = await runDailyActivityRoleSync({
    db,
    userIds: ["missingUser", "mirrorOnly"],
    now: "2026-05-09T12:00:00.000Z",
    resolveMemberRoleIds(userId) {
      resolvedRoleUserIds.push(userId);
      return [];
    },
    resolveMemberActivityMeta(userId) {
      resolvedMetaUserIds.push(userId);
      return {
        joinedAt: "2026-05-01T12:00:00.000Z",
      };
    },
    async applyRoleChanges(change) {
      roleChanges.push(change);
      return true;
    },
  });

  assert.equal(result.targetUserCount, 0);
  assert.equal(result.localActivityTargetCount, 0);
  assert.equal(result.missingLocalHistoryUserCount, 0);
  assert.equal(result.rebuiltUserCount, 0);
  assert.deepEqual(resolvedMetaUserIds, []);
  assert.deepEqual(resolvedRoleUserIds, []);
  assert.deepEqual(roleChanges, []);
  assert.deepEqual(db.sot.activity.runtime.lastDailyRoleSyncStats, {
    targetUserCount: 0,
    managedRoleHolderCount: 0,
    localActivityTargetCount: 0,
    missingLocalHistoryUserCount: 0,
    snapshotWithoutLocalHistoryUserCount: 0,
    mirrorOnlyPersistedUserCount: 0,
    managedRoleHolderWithoutPersistedActivityUserCount: 0,
    rebuiltUserCount: 0,
    appliedCount: 0,
    skippedCount: 0,
    skipReasonCounts: {},
    syncMode: "rebuild_and_sync",
  });
});

test("runActivityRoleSyncFromSnapshots aligns roles only for saved snapshots and skips missing-snapshot holders", async () => {
  const db = {
    profiles: {
      snapshotUser: {
        userId: "snapshotUser",
        domains: {
          activity: {
            desiredActivityRoleKey: "weak",
            appliedActivityRoleKey: null,
          },
        },
      },
      staleHolder: {
        userId: "staleHolder",
        domains: {
          activity: {
            desiredActivityRoleKey: null,
            appliedActivityRoleKey: "weak",
          },
        },
      },
    },
    sot: {
      activity: {
        config: {},
        watchedChannels: [],
        globalUserSessions: [],
        userChannelDailyStats: [],
        userSnapshots: {
          snapshotUser: {
            desiredActivityRoleKey: "weak",
          },
        },
        calibrationRuns: [],
        ops: { moderationAuditLog: [] },
        runtime: {
          openSessions: {
            runtimeOnly: {
              userId: "runtimeOnly",
              guildId: "guild-1",
              startedAt: "2026-05-09T11:55:00.000Z",
              endedAt: "2026-05-09T11:59:00.000Z",
              messageCount: 2,
              weightedMessageCount: 2,
              sessionMessageCount: 2,
              channelBreakdown: {},
              dayBreakdown: {},
            },
          },
          dirtyUsers: ["runtimeOnly"],
          lastFullRecalcAt: "2026-05-08T12:00:00.000Z",
        },
      },
    },
  };

  updateActivityConfig(db, {
    activityRoleIds: {
      weak: "role-weak",
      floating: "role-floating",
    },
  });

  const roleChanges = [];
  const result = await runActivityRoleSyncFromSnapshots({
    db,
    now: "2026-05-09T12:00:00.000Z",
    listManagedActivityRoleUserIds() {
      return ["staleHolder"];
    },
    resolveMemberRoleIds(userId) {
      return userId === "staleHolder" ? ["role-weak"] : [];
    },
    async applyRoleChanges(change) {
      roleChanges.push(change);
      return true;
    },
  });

  assert.equal(result.targetUserCount, 1);
  assert.equal(result.roleAssignment.appliedCount, 1);
  assert.equal(db.sot.activity.runtime.lastFullRecalcAt, "2026-05-08T12:00:00.000Z");
  assert.deepEqual(db.sot.activity.runtime.lastDailyRoleSyncStats, {
    targetUserCount: 1,
    managedRoleHolderCount: 1,
    localActivityTargetCount: 1,
    missingLocalHistoryUserCount: 1,
    snapshotWithoutLocalHistoryUserCount: 1,
    mirrorOnlyPersistedUserCount: 0,
    managedRoleHolderWithoutPersistedActivityUserCount: 1,
    rebuiltUserCount: 0,
    appliedCount: 1,
    skippedCount: 0,
    skipReasonCounts: {},
    syncMode: "roles_only",
  });
  assert.equal(db.sot.activity.runtime.lastRolesOnlySyncAt, "2026-05-09T12:00:00.000Z");
  assert.deepEqual(db.sot.activity.runtime.lastRolesOnlySyncStats, db.sot.activity.runtime.lastDailyRoleSyncStats);
  assert.deepEqual(roleChanges, [
    {
      userId: "snapshotUser",
      desiredRoleKey: "weak",
      desiredRoleId: "role-weak",
      addRoleIds: ["role-weak"],
      removeRoleIds: [],
    },
  ]);
});

test("runActivityRoleSyncFromSnapshots also targets persisted profile mirrors when snapshot index is missing", async () => {
  const db = {
    profiles: {
      mirrorOnly: {
        userId: "mirrorOnly",
        domains: {
          activity: {
            activityScore: 26,
            baseActivityScore: 26,
            desiredActivityRoleKey: "weak",
            appliedActivityRoleKey: null,
            roleEligibilityStatus: "eligible",
            roleEligibleForActivityRole: true,
            recalculatedAt: "2026-05-08T12:00:00.000Z",
            lastSeenAt: "2026-05-08T11:50:00.000Z",
          },
        },
      },
    },
    sot: {
      activity: {
        config: {},
        watchedChannels: [],
        globalUserSessions: [],
        userChannelDailyStats: [],
        userSnapshots: {},
        calibrationRuns: [],
        ops: { moderationAuditLog: [] },
        runtime: {
          openSessions: {},
          dirtyUsers: [],
        },
      },
    },
  };

  updateActivityConfig(db, {
    activityRoleIds: {
      weak: "role-weak",
    },
  });

  const roleChanges = [];
  const result = await runActivityRoleSyncFromSnapshots({
    db,
    now: "2026-05-09T12:00:00.000Z",
    resolveMemberRoleIds() {
      return [];
    },
    async applyRoleChanges(change) {
      roleChanges.push(change);
      return true;
    },
  });

  assert.equal(result.targetUserCount, 1);
  assert.equal(result.localActivityTargetCount, 1);
  assert.equal(result.missingLocalHistoryUserCount, 0);
  assert.equal(result.roleAssignment.appliedCount, 1);
  assert.equal(db.sot.activity.runtime.lastDailyRoleSyncStats.snapshotWithoutLocalHistoryUserCount, 0);
  assert.equal(db.sot.activity.runtime.lastDailyRoleSyncStats.mirrorOnlyPersistedUserCount, 1);
  assert.equal(db.sot.activity.runtime.lastDailyRoleSyncStats.managedRoleHolderWithoutPersistedActivityUserCount, 0);
  assert.deepEqual(roleChanges, [
    {
      userId: "mirrorOnly",
      desiredRoleKey: "weak",
      desiredRoleId: "role-weak",
      addRoleIds: ["role-weak"],
      removeRoleIds: [],
    },
  ]);
  assert.equal(db.profiles.mirrorOnly.domains.activity.appliedActivityRoleKey, "weak");
});

test("runActivityRoleSyncFromSnapshots also targets legacy summary activity mirrors when domains.activity is missing", async () => {
  const db = {
    profiles: {
      legacySummaryOnly: {
        userId: "legacySummaryOnly",
        summary: {
          activity: {
            activityScore: 91,
            baseActivityScore: 88,
            desiredActivityRoleKey: "core",
            appliedActivityRoleKey: null,
            roleEligibilityStatus: "eligible",
            roleEligibleForActivityRole: true,
            recalculatedAt: "2026-05-08T12:00:00.000Z",
            lastSeenAt: "2026-05-08T11:50:00.000Z",
          },
        },
      },
    },
    sot: {
      activity: {
        config: {},
        watchedChannels: [],
        globalUserSessions: [],
        userChannelDailyStats: [],
        userSnapshots: {},
        calibrationRuns: [],
        ops: { moderationAuditLog: [] },
        runtime: {
          openSessions: {},
          dirtyUsers: [],
        },
      },
    },
  };

  updateActivityConfig(db, {
    activityRoleIds: {
      core: "role-core",
    },
  });

  const roleChanges = [];
  const result = await runActivityRoleSyncFromSnapshots({
    db,
    now: "2026-05-09T12:00:00.000Z",
    resolveMemberRoleIds() {
      return [];
    },
    async applyRoleChanges(change) {
      roleChanges.push(change);
      return true;
    },
  });

  assert.equal(result.targetUserCount, 1);
  assert.equal(result.localActivityTargetCount, 1);
  assert.equal(result.roleAssignment.appliedCount, 1);
  assert.deepEqual(roleChanges, [
    {
      userId: "legacySummaryOnly",
      desiredRoleKey: "core",
      desiredRoleId: "role-core",
      addRoleIds: ["role-core"],
      removeRoleIds: [],
    },
  ]);
  assert.equal(db.profiles.legacySummaryOnly.domains.activity.appliedActivityRoleKey, "core");
});

test("runActivityRoleSyncFromSnapshots prefers indexed activity snapshots over stale profile mirrors", async () => {
  const db = {
    profiles: {
      snapshotOwned: {
        userId: "snapshotOwned",
        domains: {
          activity: {
            desiredActivityRoleKey: null,
            appliedActivityRoleKey: null,
            roleEligibilityStatus: "eligible",
            roleEligibleForActivityRole: true,
          },
        },
      },
    },
    sot: {
      activity: {
        config: {},
        watchedChannels: [],
        globalUserSessions: [],
        userChannelDailyStats: [],
        calibrationRuns: [],
        ops: { moderationAuditLog: [] },
        runtime: {
          openSessions: {},
          dirtyUsers: [],
        },
        userSnapshots: {
          snapshotOwned: {
            activityScore: 92,
            baseActivityScore: 88,
            desiredActivityRoleKey: "core",
            appliedActivityRoleKey: null,
            roleEligibilityStatus: "eligible",
            roleEligibleForActivityRole: true,
            recalculatedAt: "2026-05-09T12:00:00.000Z",
          },
        },
      },
    },
  };

  updateActivityConfig(db, {
    activityRoleIds: {
      core: "role-core",
    },
  });

  const roleChanges = [];
  const result = await runActivityRoleSyncFromSnapshots({
    db,
    now: "2026-05-09T12:00:00.000Z",
    resolveMemberRoleIds() {
      return [];
    },
    async applyRoleChanges(change) {
      roleChanges.push(change);
      return true;
    },
  });

  assert.equal(result.targetUserCount, 1);
  assert.equal(result.localActivityTargetCount, 1);
  assert.equal(result.roleAssignment.appliedCount, 1);
  assert.deepEqual(roleChanges, [
    {
      userId: "snapshotOwned",
      desiredRoleKey: "core",
      desiredRoleId: "role-core",
      addRoleIds: ["role-core"],
      removeRoleIds: [],
    },
  ]);
  assert.equal(db.profiles.snapshotOwned.domains.activity.appliedActivityRoleKey, "core");
});

test("getActivityUserInspection explains mirror-only users and their recovery path", () => {
  const db = {
    profiles: {
      mirrorOnly: {
        userId: "mirrorOnly",
        domains: {
          activity: {
            activityScore: 26,
            baseActivityScore: 26,
            desiredActivityRoleKey: "weak",
            appliedActivityRoleKey: null,
            roleEligibilityStatus: "eligible",
            roleEligibleForActivityRole: true,
            recalculatedAt: "2026-05-08T12:00:00.000Z",
            lastSeenAt: "2026-05-08T11:50:00.000Z",
          },
        },
      },
    },
    sot: {
      activity: {
        config: {},
        watchedChannels: [],
        globalUserSessions: [],
        userChannelDailyStats: [],
        userSnapshots: {},
        calibrationRuns: [],
        ops: { moderationAuditLog: [] },
        runtime: {
          openSessions: {},
          dirtyUsers: [],
        },
      },
    },
  };

  updateActivityConfig(db, {
    activityRoleIds: {
      weak: "role-weak",
    },
  });

  const inspection = getActivityUserInspection({
    db,
    userId: "mirrorOnly",
    memberRoleIds: [],
  });

  assert.equal(inspection.userId, "mirrorOnly");
  assert.equal(inspection.snapshotSource, "profile_mirror");
  assert.equal(inspection.hasSnapshotIndex, false);
  assert.equal(inspection.hasProfileMirror, true);
  assert.equal(inspection.history.hasLocalHistory, false);
  assert.equal(inspection.visibility.canRunRebuildAndSync, false);
  assert.equal(inspection.visibility.canRunRolesOnlySync, true);
  assert.equal(inspection.roleAssignmentPlan.desiredRoleKey, "weak");
  assert.equal(inspection.roleAssignmentPlan.desiredRoleId, "role-weak");
  assert.equal(inspection.diagnosis.statusCode, "profile_mirror_only");
  assert.match(inspection.diagnosis.summary, /profile activity mirror/i);
  assert.match(inspection.diagnosis.recommendedAction, /roles-only sync/i);
});

test("getActivityUserInspection marks contradictory persisted mirror states as a separate recovery bucket", () => {
  const db = {
    profiles: {
      contradictoryMirror: {
        userId: "contradictoryMirror",
        domains: {
          activity: {
            activityScore: 12,
            baseActivityScore: 12,
            desiredActivityRoleKey: "dead",
            appliedActivityRoleKey: null,
            roleEligibilityStatus: "join_age_unknown",
            roleEligibleForActivityRole: true,
            recalculatedAt: "2026-05-08T12:00:00.000Z",
            lastSeenAt: "2026-05-08T11:50:00.000Z",
          },
        },
      },
    },
    sot: {
      activity: {
        config: {},
        watchedChannels: [],
        globalUserSessions: [],
        userChannelDailyStats: [],
        userSnapshots: {},
        calibrationRuns: [],
        ops: { moderationAuditLog: [] },
        runtime: {
          openSessions: {},
          dirtyUsers: [],
        },
      },
    },
  };

  const inspection = getActivityUserInspection({
    db,
    userId: "contradictoryMirror",
    memberRoleIds: [],
  });

  assert.equal(inspection.snapshotSource, "profile_mirror");
  assert.equal(inspection.integrityIssue, "blocked_role_status_has_role_output");
  assert.equal(inspection.diagnosis.statusCode, "contradictory_persisted_state");
  assert.match(inspection.diagnosis.summary, /противоречит правилам gate\/eligibility/i);
  assert.match(inspection.diagnosis.recommendedAction, /roles-only sync .* небезопасен/i);
});

test("buildActivityRoleAssignmentPlan removes managed activity roles from gated new members", () => {
  const db = {
    profiles: {
      newcomer: {
        userId: "newcomer",
        domains: {
          activity: {
            desiredActivityRoleKey: null,
            appliedActivityRoleKey: "weak",
            roleEligibilityStatus: "gated_new_member",
            roleEligibleForActivityRole: false,
          },
        },
      },
    },
  };

  updateActivityConfig(db, {
    activityRoleIds: {
      weak: "role-weak",
      floating: "role-floating",
    },
  });

  const plan = buildActivityRoleAssignmentPlan({
    db,
    userId: "newcomer",
    memberRoleIds: ["role-weak"],
  });

  assert.equal(plan.shouldApply, true);
  assert.equal(plan.desiredRoleKey, null);
  assert.equal(plan.desiredRoleId, null);
  assert.deepEqual(plan.addRoleIds, []);
  assert.deepEqual(plan.removeRoleIds, ["role-weak"]);
});

test("runDailyActivityRoleSync rebuilds snapshots with member age metadata and applies boosted roles", async () => {
  const db = {
    profiles: {
      "user-1": {
        userId: "user-1",
        username: "todo",
      },
    },
    sot: {
      activity: {
        config: {},
        watchedChannels: [
          {
            channelId: "main-1",
            channelType: "main_chat",
            enabled: true,
            channelWeight: 1,
            countMessages: true,
            countSessions: true,
            countForTrust: true,
            countForRoles: true,
          },
        ],
        globalUserSessions: [
          {
            guildId: "guild-1",
            userId: "user-1",
            startedAt: "2026-05-08T12:00:00.000Z",
            endedAt: "2026-05-08T12:10:00.000Z",
            effectiveValue: 1,
          },
        ],
        userChannelDailyStats: [
          {
            guildId: "guild-1",
            channelId: "main-1",
            userId: "user-1",
            date: "2026-05-08",
            messagesCount: 8,
            weightedMessagesCount: 8,
            sessionsCount: 1,
            effectiveSessionsCount: 1,
            firstMessageAt: "2026-05-08T12:00:00.000Z",
            lastMessageAt: "2026-05-08T12:10:00.000Z",
          },
        ],
        userSnapshots: {},
        calibrationRuns: [],
        ops: { moderationAuditLog: [] },
        runtime: { openSessions: {}, dirtyUsers: [] },
      },
    },
  };

  updateActivityConfig(db, {
    activityRoleIds: {
      weak: "role-weak",
    },
  });

  const roleChanges = [];
  const result = await runDailyActivityRoleSync({
    db,
    now: "2026-05-09T12:00:00.000Z",
    resolveMemberRoleIds() {
      return [];
    },
    resolveMemberActivityMeta() {
      return {
        joinedAt: "2026-05-06T12:00:00.000Z",
      };
    },
    async applyRoleChanges(change) {
      roleChanges.push(change);
      return true;
    },
  });

  assert.equal(result.rebuiltUserCount, 1);
  assert.equal(result.roleAssignment.appliedCount, 1);
  assert.equal(db.profiles["user-1"].domains.activity.activityScoreMultiplier, 1.15);
  assert.equal(db.profiles["user-1"].domains.activity.desiredActivityRoleKey, "weak");
  assert.equal(db.profiles["user-1"].domains.activity.appliedActivityRoleKey, "weak");
  assert.equal(db.sot.activity.runtime.lastDailyRoleSyncAt, "2026-05-09T12:00:00.000Z");
  assert.equal(db.sot.activity.runtime.lastRebuildAndRoleSyncAt, "2026-05-09T12:00:00.000Z");
  assert.deepEqual(db.sot.activity.runtime.lastDailyRoleSyncStats, {
    targetUserCount: 1,
    managedRoleHolderCount: 0,
    localActivityTargetCount: 1,
    missingLocalHistoryUserCount: 0,
    snapshotWithoutLocalHistoryUserCount: 0,
    mirrorOnlyPersistedUserCount: 0,
    managedRoleHolderWithoutPersistedActivityUserCount: 0,
    rebuiltUserCount: 1,
    appliedCount: 1,
    skippedCount: 0,
    skipReasonCounts: {},
    syncMode: "rebuild_and_sync",
  });
  assert.deepEqual(db.sot.activity.runtime.lastRebuildAndRoleSyncStats, db.sot.activity.runtime.lastDailyRoleSyncStats);
  assert.deepEqual(roleChanges, [
    {
      userId: "user-1",
      desiredRoleKey: "weak",
      desiredRoleId: "role-weak",
      addRoleIds: ["role-weak"],
      removeRoleIds: [],
    },
  ]);
});

test("importHistoricalActivityFromWatchedChannels paginates channel history, respects the import cursor, and updates channel checkpoints", async () => {
  const db = {
    profiles: {
      "user-1": {
        userId: "user-1",
        username: "todo",
      },
    },
  };

  upsertWatchedChannel(db, {
    channelId: "main-1",
    channelType: "main_chat",
    importedUntilMessageId: "m-2",
    now: "2026-05-01T00:00:00.000Z",
  });
  updateActivityConfig(db, {
    activityRoleIds: {
      weak: "role-weak",
    },
  });

  const fetchedOptions = [];
  const result = await importHistoricalActivityFromWatchedChannels({
    db,
    requestedByUserId: "mod-1",
    fetchChannel: async (channelId) => {
      assert.equal(channelId, "main-1");
      return {
        isTextBased() {
          return true;
        },
        messages: {
          async fetch(options) {
            fetchedOptions.push(options || {});
            return new Collection([
              ["m-4", { id: "m-4", guildId: "guild-1", channelId: "main-1", author: { id: "user-1", bot: false }, createdAt: new Date("2026-05-01T10:30:00.000Z") }],
              ["m-3", { id: "m-3", guildId: "guild-1", channelId: "main-1", author: { id: "user-1", bot: false }, createdAt: new Date("2026-05-01T10:20:00.000Z") }],
              ["m-2", { id: "m-2", guildId: "guild-1", channelId: "main-1", author: { id: "user-1", bot: false }, createdAt: new Date("2026-05-01T10:10:00.000Z") }],
              ["m-1", { id: "m-1", guildId: "guild-1", channelId: "main-1", author: { id: "user-1", bot: false }, createdAt: new Date("2026-05-01T10:00:00.000Z") }],
            ]);
          },
        },
      };
    },
    resolveMemberRoleIds() {
      return [];
    },
    resolveMemberActivityMeta() {
      return {
        joinedAt: "2026-04-01T10:00:00.000Z",
      };
    },
    async applyRoleChanges() {
      return true;
    },
  });

  assert.deepEqual(fetchedOptions, [{ limit: 100 }]);
  assert.equal(result.importedEntryCount, 2);
  assert.equal(result.ignoredEntryCount, 0);
  assert.equal(result.scannedChannelCount, 1);
  assert.equal(result.scannedMessageCount, 3);
  assert.equal(db.sot.activity.watchedChannels[0].importedUntilMessageId, "m-4");
  assert.equal(db.sot.activity.watchedChannels[0].lastScannedMessageId, "m-2");
  assert.equal(db.sot.activity.watchedChannels[0].lastImportAt, result.flushedAt);
  assert.equal(db.profiles["user-1"].domains.activity.appliedActivityRoleKey, "weak");
});

test("importHistoricalActivityFromWatchedChannels keeps successful channel progress when another watched channel fails", async () => {
  const db = {
    profiles: {
      "user-1": {
        userId: "user-1",
        username: "todo",
      },
    },
  };
  seedWatchedChannels(db);
  updateActivityConfig(db, {
    activityRoleIds: {
      weak: "role-weak",
    },
  });

  const result = await importHistoricalActivityFromWatchedChannels({
    db,
    requestedByUserId: "mod-1",
    fetchChannel: async (channelId) => {
      if (channelId === "small-1") {
        return {
          isTextBased() {
            return true;
          },
          messages: {
            async fetch() {
              throw new Error("missing access");
            },
          },
        };
      }

      return {
        isTextBased() {
          return true;
        },
        messages: {
          async fetch() {
            return new Collection([
              ["m-2", { id: "m-2", guildId: "guild-1", channelId: "main-1", author: { id: "user-1", bot: false }, createdAt: new Date("2026-05-01T10:10:00.000Z") }],
              ["m-1", { id: "m-1", guildId: "guild-1", channelId: "main-1", author: { id: "user-1", bot: false }, createdAt: new Date("2026-05-01T10:00:00.000Z") }],
            ]);
          },
        },
      };
    },
    resolveMemberRoleIds() {
      return [];
    },
    async applyRoleChanges() {
      return true;
    },
  });

  assert.equal(result.importedEntryCount, 2);
  assert.equal(result.failedChannelCount, 1);
  assert.equal(result.failedChannels[0].channelId, "small-1");
  assert.match(result.failedChannels[0].reason, /missing access/i);
  assert.equal(db.sot.activity.watchedChannels.find((entry) => entry.channelId === "main-1").importedUntilMessageId, "m-2");
  assert.equal(db.sot.activity.watchedChannels.find((entry) => entry.channelId === "small-1").importedUntilMessageId, "");
  assert.equal(db.sot.activity.runtime.errors.at(-1).channelId, "small-1");
});

test("importHistoricalActivityFromWatchedChannels preserves per-channel cursor progress when a later page fetch fails", async () => {
  const db = {
    profiles: {
      "user-1": {
        userId: "user-1",
        username: "todo",
      },
    },
  };

  upsertWatchedChannel(db, {
    channelId: "main-1",
    channelType: "main_chat",
    now: "2026-05-01T00:00:00.000Z",
  });

  const firstBatch = new Collection(
    Array.from({ length: 100 }, (_, index) => {
      const numericId = 150 - index;
      const messageId = `m-${numericId}`;
      const createdAt = new Date(Date.parse("2026-05-01T10:00:00.000Z") + index * 60_000);
      return [messageId, {
        id: messageId,
        guildId: "guild-1",
        channelId: "main-1",
        author: { id: "user-1", bot: false },
        createdAt,
      }];
    })
  );

  const fetchCalls = [];
  const result = await importHistoricalActivityFromWatchedChannels({
    db,
    requestedByUserId: "mod-1",
    fetchChannel: async () => ({
      isTextBased() {
        return true;
      },
      messages: {
        async fetch(options = {}) {
          fetchCalls.push(options);
          if (!options.before) {
            return firstBatch;
          }

          throw new Error("second page failed");
        },
      },
    }),
    resolveMemberRoleIds() {
      return [];
    },
    async applyRoleChanges() {
      return true;
    },
  });

  assert.deepEqual(fetchCalls, [{ limit: 100 }, { limit: 100, before: "m-51" }]);
  assert.equal(result.importedEntryCount, 100);
  assert.equal(result.failedChannelCount, 1);
  assert.equal(db.sot.activity.watchedChannels[0].importedUntilMessageId, "m-150");
  assert.equal(db.sot.activity.watchedChannels[0].lastScannedMessageId, "m-51");

  const rerun = await importHistoricalActivityFromWatchedChannels({
    db,
    requestedByUserId: "mod-2",
    fetchChannel: async () => ({
      isTextBased() {
        return true;
      },
      messages: {
        async fetch() {
          return firstBatch;
        },
      },
    }),
    resolveMemberRoleIds() {
      return [];
    },
    async applyRoleChanges() {
      return true;
    },
  });

  assert.equal(rerun.importedEntryCount, 0);
  assert.equal(db.sot.activity.globalUserSessions.length, 1);
});

test("importHistoricalActivityFromWatchedChannels rejects concurrent runs for the same db instance", async () => {
  const db = {};
  upsertWatchedChannel(db, {
    channelId: "main-1",
    channelType: "main_chat",
    now: "2026-05-01T00:00:00.000Z",
  });

  const gate = createDeferred();
  const firstRun = importHistoricalActivityFromWatchedChannels({
    db,
    requestedByUserId: "mod-1",
    fetchChannel: async () => ({
      isTextBased() {
        return true;
      },
      messages: {
        async fetch() {
          await gate.promise;
          return new Collection();
        },
      },
    }),
    resolveMemberRoleIds() {
      return [];
    },
    async applyRoleChanges() {
      return true;
    },
  });

  const concurrentRun = await importHistoricalActivityFromWatchedChannels({
    db,
    requestedByUserId: "mod-2",
    fetchChannel: async () => ({
      isTextBased() {
        return true;
      },
      messages: {
        async fetch() {
          return new Collection();
        },
      },
    }),
    resolveMemberRoleIds() {
      return [];
    },
    async applyRoleChanges() {
      return true;
    },
  });

  assert.equal(concurrentRun.alreadyRunning, true);

  gate.resolve();
  const completedRun = await firstRun;
  assert.equal(completedRun.alreadyRunning, false);
});