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
  repairFreshNewcomerActivityRoles,
  runActivityRoleSyncFromSnapshots,
  runActivityMemberJoinRoleSync,
  runDailyActivityRoleSync,
  setManualActivityUserStatus,
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

test("setManualActivityUserStatus stores and restores the previous auto activity state", async () => {
  const db = {
    profiles: {
      member: {
        userId: "member",
        domains: {
          activity: {
            desiredActivityRoleKey: "weak",
            appliedActivityRoleKey: "weak",
            manualOverride: false,
            autoRoleFrozen: false,
            activityScore: 28,
          },
        },
      },
    },
  };

  updateActivityConfig(db, {
    activityRoleIds: {
      weak: "role-weak",
      active: "role-active",
    },
  });

  const roleChanges = [];
  const setResult = await setManualActivityUserStatus({
    db,
    userId: "member",
    statusKey: "active",
    requestedByUserId: "mod-1",
    changedAt: "2026-05-21T10:00:00.000Z",
    memberPresent: true,
    memberRoleIds: ["role-weak"],
    applyRoleChanges(change) {
      roleChanges.push(change);
      return true;
    },
  });

  assert.equal(setResult.ok, true);
  assert.equal(setResult.action, "set");
  assert.equal(setResult.statusKey, "active");
  assert.equal(setResult.createdRestoreState, true);
  assert.equal(setResult.roleSync.skipReason, null);
  assert.deepEqual(roleChanges[0], {
    userId: "member",
    desiredRoleKey: "active",
    desiredRoleId: "role-active",
    addRoleIds: ["role-active"],
    removeRoleIds: ["role-weak"],
  });
  assert.equal(db.profiles.member.domains.activity.desiredActivityRoleKey, "active");
  assert.equal(db.profiles.member.domains.activity.appliedActivityRoleKey, "active");
  assert.equal(db.profiles.member.domains.activity.manualOverride, true);
  assert.equal(db.sot.activity.ops.manualStatusRestore.member.desiredActivityRoleKey, "weak");
  assert.equal(db.sot.activity.ops.manualStatusRestore.member.appliedActivityRoleKey, "weak");

  const clearResult = await setManualActivityUserStatus({
    db,
    userId: "member",
    statusKey: "auto",
    requestedByUserId: "mod-1",
    changedAt: "2026-05-21T11:00:00.000Z",
    memberPresent: true,
    memberRoleIds: ["role-active"],
    applyRoleChanges(change) {
      roleChanges.push(change);
      return true;
    },
  });

  assert.equal(clearResult.ok, true);
  assert.equal(clearResult.action, "clear");
  assert.equal(clearResult.restoredFromShadow, true);
  assert.equal(clearResult.roleSync.skipReason, null);
  assert.deepEqual(roleChanges[1], {
    userId: "member",
    desiredRoleKey: "weak",
    desiredRoleId: "role-weak",
    addRoleIds: ["role-weak"],
    removeRoleIds: ["role-active"],
  });
  assert.equal(db.profiles.member.domains.activity.desiredActivityRoleKey, "weak");
  assert.equal(db.profiles.member.domains.activity.appliedActivityRoleKey, "weak");
  assert.equal(db.profiles.member.domains.activity.manualOverride, false);
  assert.equal(db.sot.activity.ops.manualStatusRestore.member, undefined);
});

test("setManualActivityUserStatus clears managed roles for manual dead status without a mapped Discord role", async () => {
  const db = {
    profiles: {
      member: {
        userId: "member",
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
      active: "role-active",
    },
  });

  const roleChanges = [];
  const result = await setManualActivityUserStatus({
    db,
    userId: "member",
    statusKey: "dead",
    requestedByUserId: "mod-1",
    changedAt: "2026-05-21T12:00:00.000Z",
    memberPresent: true,
    memberRoleIds: ["role-weak", "role-active"],
    applyRoleChanges(change) {
      roleChanges.push(change);
      return true;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.action, "set");
  assert.equal(result.statusKey, "dead");
  assert.equal(result.roleSync.desiredRoleId, null);
  assert.equal(roleChanges.length, 1);
  assert.equal(roleChanges[0].userId, "member");
  assert.equal(roleChanges[0].desiredRoleKey, "dead");
  assert.equal(roleChanges[0].desiredRoleId, null);
  assert.deepEqual(roleChanges[0].addRoleIds, []);
  assert.deepEqual(roleChanges[0].removeRoleIds.slice().sort(), ["role-active", "role-weak"]);
  assert.equal(db.profiles.member.domains.activity.desiredActivityRoleKey, "dead");
  assert.equal(db.profiles.member.domains.activity.appliedActivityRoleKey, null);
  assert.equal(db.profiles.member.domains.activity.manualOverride, true);
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

test("applyInitialActivityRoleAssignments does not mark newcomer as applied when newcomer mapping is missing", async () => {
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
            daysSinceGuildJoin: 1.2,
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
    userIds: ["newcomer"],
    resolveMemberRoleIds() {
      return ["role-weak"];
    },
    async applyRoleChanges(change) {
      roleChanges.push(change);
      return true;
    },
    now: "2026-05-09T12:00:00.000Z",
  });

  assert.equal(result.appliedCount, 1);
  assert.deepEqual(roleChanges, [
    {
      userId: "newcomer",
      desiredRoleKey: "newcomer",
      desiredRoleId: null,
      addRoleIds: [],
      removeRoleIds: ["role-weak"],
    },
  ]);
  assert.equal(db.profiles.newcomer.domains.activity.appliedActivityRoleKey, null);
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
  assert.deepEqual(Object.keys(db.sot.activity.userSnapshots).sort(), ["mirrorOnly", "snapshotOnly"]);
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
    snapshotWithoutLocalHistoryUserCount: 2,
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
  assert.deepEqual(Object.keys(db.sot.activity.userSnapshots), ["mirrorOnly"]);
  assert.deepEqual(db.sot.activity.runtime.lastDailyRoleSyncStats, {
    targetUserCount: 0,
    managedRoleHolderCount: 0,
    localActivityTargetCount: 0,
    missingLocalHistoryUserCount: 0,
    snapshotWithoutLocalHistoryUserCount: 1,
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

test("getActivityUserInspection explains gated newcomers through the newcomer window", () => {
  const db = {
    profiles: {
      newcomer: {
        userId: "newcomer",
        domains: {
          activity: {
            desiredActivityRoleKey: null,
            appliedActivityRoleKey: null,
            roleEligibilityStatus: "gated_new_member",
            roleEligibleForActivityRole: false,
            daysSinceGuildJoin: 1.2,
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
      newcomer: "role-newcomer",
      weak: "role-weak",
    },
  });

  const inspection = getActivityUserInspection({
    db,
    userId: "newcomer",
    memberRoleIds: [],
  });

  assert.equal(inspection.roleAssignmentPlan.desiredRoleKey, "newcomer");
  assert.equal(inspection.diagnosis.statusCode, "gated_new_member");
  assert.match(inspection.diagnosis.summary, /newcomer-окне/i);
  assert.match(inspection.diagnosis.recommendedAction, /newcomer-роль может выдаться автоматически/i);
});

test("getActivityUserInspection treats boosted newcomer as an effective newcomer role instead of below-threshold", () => {
  const db = {
    profiles: {
      newcomer: {
        userId: "newcomer",
        domains: {
          activity: {
            desiredActivityRoleKey: "dead",
            appliedActivityRoleKey: "newcomer",
            roleEligibilityStatus: "boosted_new_member",
            roleEligibleForActivityRole: true,
            daysSinceGuildJoin: 4.2,
          },
        },
      },
    },
    sot: {
      activity: {
        config: {},
        watchedChannels: [],
        globalUserSessions: [],
        userChannelDailyStats: [{ userId: "newcomer" }],
        userSnapshots: {
          newcomer: {
            desiredActivityRoleKey: "dead",
            appliedActivityRoleKey: "newcomer",
            roleEligibilityStatus: "boosted_new_member",
            roleEligibleForActivityRole: true,
            daysSinceGuildJoin: 4.2,
          },
        },
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
      newcomer: "role-newcomer",
    },
  });

  const inspection = getActivityUserInspection({
    db,
    userId: "newcomer",
    memberRoleIds: ["role-newcomer"],
  });

  assert.equal(inspection.roleAssignmentPlan.desiredRoleKey, "newcomer");
  assert.equal(inspection.diagnosis.statusCode, "role_synced");
  assert.match(inspection.diagnosis.summary, /Newcomer-роль уже соответствует/i);
});

test("buildActivityRoleAssignmentPlan assigns newcomer role to gated new members before their first activity rank", () => {
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
            daysSinceGuildJoin: 1.5,
          },
        },
      },
    },
  };

  updateActivityConfig(db, {
    activityRoleIds: {
      newcomer: "role-newcomer",
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
  assert.equal(plan.desiredRoleKey, "newcomer");
  assert.equal(plan.desiredRoleId, "role-newcomer");
  assert.deepEqual(plan.addRoleIds, ["role-newcomer"]);
  assert.deepEqual(plan.removeRoleIds, ["role-weak"]);
});

test("buildActivityRoleAssignmentPlan keeps newcomer role for eligible members without a first scored rank inside newcomer window", () => {
  const db = {
    profiles: {
      newcomer: {
        userId: "newcomer",
        domains: {
          activity: {
            desiredActivityRoleKey: "dead",
            appliedActivityRoleKey: "newcomer",
            roleEligibilityStatus: "boosted_new_member",
            roleEligibleForActivityRole: true,
            daysSinceGuildJoin: 4.2,
          },
        },
      },
    },
  };

  updateActivityConfig(db, {
    activityRoleIds: {
      newcomer: "role-newcomer",
      dead: "role-dead",
    },
  });

  const plan = buildActivityRoleAssignmentPlan({
    db,
    userId: "newcomer",
    memberRoleIds: ["role-newcomer"],
  });

  assert.equal(plan.shouldApply, false);
  assert.equal(plan.skipReason, "unchanged");
  assert.equal(plan.desiredRoleKey, "newcomer");
  assert.equal(plan.desiredRoleId, "role-newcomer");
});

test("buildActivityRoleAssignmentPlan promotes manually removed newcomer to the current scored tier", () => {
  const db = {
    profiles: {
      newcomer: {
        userId: "newcomer",
        domains: {
          activity: {
            activityScore: 24,
            baseActivityScore: 24,
            desiredActivityRoleKey: null,
            appliedActivityRoleKey: "newcomer",
            roleEligibilityStatus: "gated_new_member",
            roleEligibleForActivityRole: false,
            daysSinceGuildJoin: 1.5,
          },
        },
      },
    },
  };

  updateActivityConfig(db, {
    activityRoleIds: {
      newcomer: "role-newcomer",
      weak: "role-weak",
      dead: "role-dead",
    },
  });

  const plan = buildActivityRoleAssignmentPlan({
    db,
    userId: "newcomer",
    memberRoleIds: [],
  });

  assert.equal(plan.shouldApply, true);
  assert.equal(plan.newcomerSuppressed, true);
  assert.equal(plan.desiredRoleKey, "weak");
  assert.equal(plan.desiredRoleId, "role-weak");
  assert.deepEqual(plan.addRoleIds, ["role-weak"]);
  assert.deepEqual(plan.removeRoleIds, []);
});

test("buildActivityRoleAssignmentPlan keeps manually suppressed newcomer on the scored tier across later syncs", () => {
  const db = {
    profiles: {
      newcomer: {
        userId: "newcomer",
        domains: {
          activity: {
            activityScore: 24,
            baseActivityScore: 24,
            desiredActivityRoleKey: null,
            appliedActivityRoleKey: "weak",
            newcomerRoleSuppressedAt: "2026-05-09T12:00:00.000Z",
            roleEligibilityStatus: "gated_new_member",
            roleEligibleForActivityRole: false,
            daysSinceGuildJoin: 1.5,
          },
        },
      },
    },
  };

  updateActivityConfig(db, {
    activityRoleIds: {
      newcomer: "role-newcomer",
      weak: "role-weak",
      dead: "role-dead",
    },
  });

  const plan = buildActivityRoleAssignmentPlan({
    db,
    userId: "newcomer",
    memberRoleIds: ["role-weak"],
  });

  assert.equal(plan.shouldApply, false);
  assert.equal(plan.skipReason, "unchanged");
  assert.equal(plan.newcomerSuppressed, true);
  assert.equal(plan.desiredRoleKey, "weak");
  assert.equal(plan.desiredRoleId, "role-weak");
});

test("buildActivityRoleAssignmentPlan removes newcomer role after the first scored rank was already earned", () => {
  const db = {
    profiles: {
      veteran: {
        userId: "veteran",
        domains: {
          activity: {
            desiredActivityRoleKey: "dead",
            appliedActivityRoleKey: "newcomer",
            firstActivityRoleGrantedAt: "2026-05-08T12:00:00.000Z",
            roleEligibilityStatus: "boosted_new_member",
            roleEligibleForActivityRole: true,
            daysSinceGuildJoin: 4.8,
          },
        },
      },
    },
  };

  updateActivityConfig(db, {
    activityRoleIds: {
      newcomer: "role-newcomer",
    },
  });

  const plan = buildActivityRoleAssignmentPlan({
    db,
    userId: "veteran",
    memberRoleIds: ["role-newcomer"],
  });

  assert.equal(plan.shouldApply, true);
  assert.equal(plan.desiredRoleKey, "dead");
  assert.equal(plan.desiredRoleId, null);
  assert.deepEqual(plan.addRoleIds, []);
  assert.deepEqual(plan.removeRoleIds, ["role-newcomer"]);
});

test("buildActivityRoleAssignmentPlan keeps join_age_unknown newcomer-safe-off", () => {
  const db = {
    profiles: {
      unknown: {
        userId: "unknown",
        domains: {
          activity: {
            desiredActivityRoleKey: null,
            appliedActivityRoleKey: "newcomer",
            roleEligibilityStatus: "join_age_unknown",
            roleEligibleForActivityRole: false,
            daysSinceGuildJoin: null,
          },
        },
      },
    },
  };

  updateActivityConfig(db, {
    activityRoleIds: {
      newcomer: "role-newcomer",
    },
  });

  const plan = buildActivityRoleAssignmentPlan({
    db,
    userId: "unknown",
    memberRoleIds: ["role-newcomer"],
  });

  assert.equal(plan.shouldApply, true);
  assert.equal(plan.desiredRoleKey, null);
  assert.equal(plan.desiredRoleId, null);
  assert.deepEqual(plan.addRoleIds, []);
  assert.deepEqual(plan.removeRoleIds, ["role-newcomer"]);
});

test("runActivityMemberJoinRoleSync keeps newcomer for recent rejoiners while newcomer is still present", async () => {
  const db = {
    profiles: {
      returning: {
        userId: "returning",
        domains: {
          activity: {
            appliedActivityRoleKey: "newcomer",
            lastObservedGuildJoinAt: "2026-05-01T12:00:00.000Z",
            guildJoinCount: 1,
          },
        },
      },
    },
  };

  updateActivityConfig(db, {
    activityRoleIds: {
      newcomer: "role-newcomer",
      dead: "role-dead",
    },
  });

  const roleChanges = [];
  const result = await runActivityMemberJoinRoleSync({
    db,
    userId: "returning",
    memberRoleIds: ["role-newcomer"],
    memberActivityMeta: {
      joinedAt: "2026-05-09T12:00:00.000Z",
      returningMember: true,
      priorServerTrace: {
        returningMember: true,
        sourceType: "profile.activity.lastGuildLeaveAt",
        occurredAt: "2026-05-08T12:00:00.000Z",
        evidenceCount: 1,
      },
    },
    async applyRoleChanges(change) {
      roleChanges.push(change);
      return true;
    },
    now: "2026-05-09T12:01:00.000Z",
  });

  assert.equal(result.rebuiltUserCount, 1);
  assert.equal(result.roleAssignment.appliedCount, 0);
  assert.deepEqual(roleChanges, []);
  assert.equal(db.profiles.returning.domains.activity.returningMember, true);
  assert.equal(db.profiles.returning.domains.activity.roleEligibleForActivityRole, false);
  assert.equal(db.profiles.returning.domains.activity.desiredActivityRoleKey, null);
  assert.equal(db.profiles.returning.domains.activity.appliedActivityRoleKey, "newcomer");
});

test("runActivityMemberJoinRoleSync promotes manually removed newcomer to the scored tier", async () => {
  const db = {
    profiles: {
      moderated: {
        userId: "moderated",
        domains: {
          activity: {
            appliedActivityRoleKey: "newcomer",
          },
        },
      },
    },
  };

  updateActivityConfig(db, {
    activityRoleIds: {
      newcomer: "role-newcomer",
      dead: "role-dead",
    },
  });

  const roleChanges = [];
  const result = await runActivityMemberJoinRoleSync({
    db,
    userId: "moderated",
    memberRoleIds: [],
    memberActivityMeta: {
      joinedAt: "2026-05-09T12:00:00.000Z",
      returningMember: true,
      priorServerTrace: {
        returningMember: true,
        sourceType: "profile.presence",
        evidenceCount: 1,
      },
    },
    async applyRoleChanges(change) {
      roleChanges.push(change);
      return true;
    },
    now: "2026-05-09T12:01:00.000Z",
  });

  assert.equal(result.rebuiltUserCount, 1);
  assert.equal(result.roleAssignment.appliedCount, 1);
  assert.deepEqual(roleChanges, [
    {
      userId: "moderated",
      desiredRoleKey: "dead",
      desiredRoleId: "role-dead",
      addRoleIds: ["role-dead"],
      removeRoleIds: [],
    },
  ]);
  assert.equal(db.profiles.moderated.domains.activity.roleEligibilityStatus, "gated_new_member");
  assert.equal(db.profiles.moderated.domains.activity.appliedActivityRoleKey, "dead");
  assert.ok(db.profiles.moderated.domains.activity.newcomerRoleSuppressedAt);
});

test("repairFreshNewcomerActivityRoles restores newcomer for every recent member inside the newcomer window", async () => {
  const db = {
    profiles: {
      fresh: {
        userId: "fresh",
        domains: {
          activity: {
            appliedActivityRoleKey: "dead",
          },
        },
      },
      returning: {
        userId: "returning",
        domains: {
          activity: {
            lastGuildLeaveAt: "2026-05-08T12:00:00.000Z",
            appliedActivityRoleKey: "dead",
          },
        },
      },
    },
  };

  updateActivityConfig(db, {
    activityRoleIds: {
      newcomer: "role-newcomer",
      dead: "role-dead",
    },
  });

  const roleChanges = [];
  const result = await repairFreshNewcomerActivityRoles({
    db,
    members: [
      {
        userId: "fresh",
        joinedAt: "2026-05-09T12:00:00.000Z",
        roleIds: ["role-dead"],
      },
      {
        userId: "returning",
        joinedAt: "2026-05-09T12:00:00.000Z",
        roleIds: ["role-dead"],
      },
    ],
    async applyRoleChanges(change) {
      roleChanges.push(change);
      return true;
    },
    now: "2026-05-09T12:01:00.000Z",
  });

  assert.deepEqual(result.targetUserIds, ["fresh", "returning"]);
  assert.deepEqual(result.skippedReasons, {});
  assert.deepEqual(roleChanges, [
    {
      userId: "fresh",
      desiredRoleKey: "newcomer",
      desiredRoleId: "role-newcomer",
      addRoleIds: ["role-newcomer"],
      removeRoleIds: ["role-dead"],
    },
    {
      userId: "returning",
      desiredRoleKey: "newcomer",
      desiredRoleId: "role-newcomer",
      addRoleIds: ["role-newcomer"],
      removeRoleIds: ["role-dead"],
    },
  ]);
  assert.equal(db.profiles.fresh.domains.activity.appliedActivityRoleKey, "newcomer");
  assert.equal(db.profiles.returning.domains.activity.appliedActivityRoleKey, "newcomer");
});

test("getActivityUserInspection explains manually suppressed newcomer as a scored-tier moderation path", () => {
  const db = {
    profiles: {
      newcomer: {
        userId: "newcomer",
        domains: {
          activity: {
            activityScore: 24,
            baseActivityScore: 24,
            appliedActivityRoleKey: "newcomer",
            roleEligibilityStatus: "gated_new_member",
            roleEligibleForActivityRole: false,
            daysSinceGuildJoin: 1.5,
          },
        },
      },
    },
  };

  updateActivityConfig(db, {
    activityRoleIds: {
      newcomer: "role-newcomer",
      weak: "role-weak",
      dead: "role-dead",
    },
  });

  const inspection = getActivityUserInspection({
    db,
    userId: "newcomer",
    memberRoleIds: [],
    resolveRoleAssignmentPlan: ({ db: nextDb, userId: nextUserId, memberRoleIds: nextMemberRoleIds }) => buildActivityRoleAssignmentPlan({
      db: nextDb,
      userId: nextUserId,
      memberRoleIds: nextMemberRoleIds,
    }),
  });

  assert.equal(inspection.roleAssignmentPlan.newcomerSuppressed, true);
  assert.equal(inspection.roleAssignmentPlan.desiredRoleKey, "weak");
  assert.equal(inspection.diagnosis.statusCode, "newcomer_suppressed");
  assert.match(inspection.diagnosis.summary, /снята вручную/i);
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
  assert.equal(db.profiles["user-1"].domains.activity.firstActivityRoleGrantedAt, "2026-05-09T12:00:00.000Z");
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

test("runDailyActivityRoleSync promotes mirror-only persisted users into canonical snapshots before role assignment", async () => {
  const db = {
    profiles: {
      historyUser: {
        userId: "historyUser",
        username: "todo",
      },
      mirrorOnly: {
        userId: "mirrorOnly",
        domains: {
          activity: {
            activityScore: 61,
            baseActivityScore: 58,
            desiredActivityRoleKey: "active",
            appliedActivityRoleKey: null,
            roleEligibilityStatus: "eligible",
            roleEligibleForActivityRole: true,
            recalculatedAt: "2026-05-08T12:00:00.000Z",
            lastSeenAt: "2026-05-08T11:50:00.000Z",
          },
        },
        summary: {
          activity: {
            activityScore: 61,
            baseActivityScore: 58,
            desiredActivityRoleKey: "active",
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
            userId: "historyUser",
            startedAt: "2026-05-08T12:00:00.000Z",
            endedAt: "2026-05-08T12:10:00.000Z",
            effectiveValue: 1,
          },
        ],
        userChannelDailyStats: [
          {
            guildId: "guild-1",
            channelId: "main-1",
            userId: "historyUser",
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
      active: "role-active",
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
        joinedAt: "2026-05-01T12:00:00.000Z",
      };
    },
    async applyRoleChanges(change) {
      roleChanges.push(change);
      return true;
    },
  });

  assert.equal(result.rebuiltUserCount, 1);
  assert.equal(result.targetUserCount, 1);
  assert.deepEqual(Object.keys(db.sot.activity.userSnapshots).sort(), ["historyUser", "mirrorOnly"]);
  assert.equal(db.sot.activity.userSnapshots.mirrorOnly.desiredActivityRoleKey, "active");
  assert.equal(db.sot.activity.userSnapshots.mirrorOnly.appliedActivityRoleKey, null);
  assert.equal(db.sot.activity.runtime.lastDailyRoleSyncStats.localActivityTargetCount, 1);
  assert.equal(db.sot.activity.runtime.lastDailyRoleSyncStats.missingLocalHistoryUserCount, 0);
  assert.equal(db.sot.activity.runtime.lastDailyRoleSyncStats.snapshotWithoutLocalHistoryUserCount, 1);
  assert.equal(db.sot.activity.runtime.lastDailyRoleSyncStats.mirrorOnlyPersistedUserCount, 0);
  assert.equal(db.sot.activity.runtime.lastDailyRoleSyncStats.appliedCount, 1);
  assert.deepEqual(roleChanges, [
    {
      userId: "historyUser",
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
