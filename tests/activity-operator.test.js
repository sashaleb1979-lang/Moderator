"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Collection } = require("discord.js");

const {
  applyInitialActivityRoleAssignments,
  importHistoricalActivity,
  importHistoricalActivityFromWatchedChannels,
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