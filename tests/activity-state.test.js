"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ACTIVITY_CHANNEL_WEIGHT_PRESETS,
  createEmptyActivityState,
  ensureActivityState,
  getActivityConfig,
  getWatchedChannel,
  listWatchedChannels,
  normalizeActivityState,
  removeWatchedChannel,
  upsertWatchedChannel,
  updateActivityConfig,
} = require("../src/activity/state");

test("createEmptyActivityState seeds config and empty activity collections", () => {
  const state = createEmptyActivityState();

  assert.equal(state.config.sessionGapMinutes, 45);
  assert.equal(state.config.scoreWindowDays, 30);
  assert.equal(state.config.roleEligibilityMinMemberDays, 3);
  assert.equal(state.config.roleBoostEndMemberDays, 7);
  assert.equal(state.config.roleBoostMaxMultiplier, 1.15);
  assert.equal(state.config.autoRoleSyncHours, 24);
  assert.equal(state.config.channelWeightPresets.main_chat, 1);
  assert.deepEqual(state.watchedChannels, []);
  assert.deepEqual(state.globalUserSessions, []);
  assert.deepEqual(state.globalVoiceSessions, []);
  assert.deepEqual(state.userVoiceDailyStats, []);
  assert.deepEqual(state.runtime.openVoiceSessions, {});
  assert.deepEqual(state.runtime.dirtyUsers, []);
  assert.equal(state.runtime.lastRebuildAndRoleSyncAt, null);
  assert.equal(state.runtime.lastRebuildAndRoleSyncStats, null);
  assert.equal(state.runtime.lastRolesOnlySyncAt, null);
  assert.equal(state.runtime.lastRolesOnlySyncStats, null);
  assert.deepEqual(state.ops.moderationAuditLog, []);
});

test("normalizeActivityState deduplicates watched channels and normalizes config defaults", () => {
  const state = normalizeActivityState({
    config: {
      sessionGapMinutes: "60",
      roleEligibilityMinMemberDays: "4",
      roleBoostEndMemberDays: "8",
      roleBoostMaxMultiplier: "1.2",
      moderatorRoleIds: ["mod-1", "", "mod-1", "mod-2"],
    },
    watchedChannels: [
      {
        channelId: "chat-1",
        channelType: "small_chat",
        enabled: true,
      },
      {
        channelId: "chat-1",
        channelType: "media",
        countForRoles: false,
      },
      {
        channelId: "admin-1",
        channelType: "admin",
      },
    ],
    runtime: {
      dirtyUsers: ["user-1", "", "user-1", "user-2"],
      lastFlushAt: "2026-05-09T10:00:00.000Z",
    },
  });

  assert.equal(state.config.sessionGapMinutes, 60);
  assert.equal(state.config.roleEligibilityMinMemberDays, 4);
  assert.equal(state.config.roleBoostEndMemberDays, 8);
  assert.equal(state.config.roleBoostMaxMultiplier, 1.2);
  assert.deepEqual(state.config.moderatorRoleIds, ["mod-1", "mod-2"]);
  assert.equal(state.watchedChannels.length, 2);
  assert.deepEqual(state.watchedChannels[0], {
    guildId: null,
    channelId: "chat-1",
    channelNameCache: "",
    enabled: true,
    channelType: "media",
    channelWeight: ACTIVITY_CHANNEL_WEIGHT_PRESETS.media,
    countMessages: true,
    countSessions: true,
    countForTrust: true,
    countForRoles: false,
    importedUntilMessageId: "",
    lastScannedMessageId: "",
    lastImportAt: null,
    createdAt: null,
    updatedAt: null,
  });
  assert.equal(state.watchedChannels[1].channelType, "admin");
  assert.equal(state.watchedChannels[1].countForTrust, false);
  assert.equal(state.watchedChannels[1].countForRoles, false);
  assert.deepEqual(state.runtime.dirtyUsers, ["user-1", "user-2"]);
  assert.equal(state.runtime.lastFlushAt, "2026-05-09T10:00:00.000Z");
});

test("upsertWatchedChannel adds and updates watched channel records with stable timestamps", () => {
  const db = {};

  const created = upsertWatchedChannel(db, {
    channelId: "chat-1",
    channelType: "small_chat",
    channelNameCache: "Small chat",
    now: "2026-05-09T10:00:00.000Z",
  });

  assert.equal(created.created, true);
  assert.equal(created.record.channelWeight, ACTIVITY_CHANNEL_WEIGHT_PRESETS.small_chat);
  assert.equal(created.record.createdAt, "2026-05-09T10:00:00.000Z");
  assert.equal(created.record.updatedAt, "2026-05-09T10:00:00.000Z");
  assert.equal(getWatchedChannel(db, "chat-1").channelNameCache, "Small chat");

  const updated = upsertWatchedChannel(db, {
    channelId: "chat-1",
    enabled: false,
    importedUntilMessageId: "999",
    now: "2026-05-10T10:00:00.000Z",
  });

  assert.equal(updated.created, false);
  assert.equal(updated.record.enabled, false);
  assert.equal(updated.record.importedUntilMessageId, "999");
  assert.equal(updated.record.createdAt, "2026-05-09T10:00:00.000Z");
  assert.equal(updated.record.updatedAt, "2026-05-10T10:00:00.000Z");
  assert.deepEqual(listWatchedChannels(db), [updated.record]);
});

test("removeWatchedChannel removes persisted watched channel entries", () => {
  const db = {};

  upsertWatchedChannel(db, {
    channelId: "chat-1",
    channelType: "normal_chat",
    now: "2026-05-09T10:00:00.000Z",
  });
  upsertWatchedChannel(db, {
    channelId: "chat-2",
    channelType: "event",
    now: "2026-05-09T10:05:00.000Z",
  });

  const removed = removeWatchedChannel(db, { channelId: "chat-1" });

  assert.equal(removed.removed, true);
  assert.equal(removed.record.channelId, "chat-1");
  assert.deepEqual(listWatchedChannels(db).map((entry) => entry.channelId), ["chat-2"]);
  assert.equal(removeWatchedChannel(db, { channelId: "missing" }).removed, false);
});

test("updateActivityConfig merges partial overrides and keeps defaults available to readers", () => {
  const db = {};

  const result = updateActivityConfig(db, {
    sessionGapMinutes: 50,
    adminRoleIds: ["admin-1", "", "admin-1"],
    activityRoleThresholds: {
      core: 90,
      weak: 20,
    },
  });

  assert.equal(result.mutated, true);
  assert.equal(result.config.sessionGapMinutes, 50);
  assert.deepEqual(result.config.adminRoleIds, ["admin-1"]);
  assert.equal(result.config.activityRoleThresholds.core, 90);
  assert.equal(result.config.activityRoleThresholds.weak, 20);
  assert.equal(result.config.activityRoleThresholds.stable, 77);
  assert.equal(getActivityConfig(db).channelWeightPresets.flood, ACTIVITY_CHANNEL_WEIGHT_PRESETS.flood);

  const ensured = ensureActivityState(db);
  assert.equal(ensured.config.sessionGapMinutes, 50);
  assert.equal(ensured.watchedChannels.length, 0);
});

test("ensureActivityState keeps the terminal freshness bucket open-ended after normalization", () => {
  const db = {};

  const state = ensureActivityState(db);

  assert.equal(state.config.freshnessBuckets.at(-1).maxDays, Number.POSITIVE_INFINITY);
  assert.equal(state.config.freshnessBuckets.at(-1).score, 0);
});

test("ensureActivityState reuses an already normalized activity object", () => {
  const db = {};

  const first = ensureActivityState(db);
  first.runtime.lastFlushAt = "2026-05-10T00:00:00.000Z";

  const second = ensureActivityState(db);

  assert.equal(second, first);
  assert.equal(second.runtime.lastFlushAt, "2026-05-10T00:00:00.000Z");
});