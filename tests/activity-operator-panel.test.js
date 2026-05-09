"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildActivityOperatorPanelPayload,
  handleActivityPanelButtonInteraction,
} = require("../src/activity/operator");
const { ensureActivityState, updateActivityConfig, upsertWatchedChannel } = require("../src/activity/state");

test("buildActivityOperatorPanelPayload summarizes runtime, calibration, and role mapping state", () => {
  const db = {
    profiles: {
      "user-1": {
        userId: "user-1",
        domains: {
          activity: {
            desiredActivityRoleKey: "weak",
            appliedActivityRoleKey: "weak",
          },
        },
      },
    },
  };

  upsertWatchedChannel(db, {
    channelId: "main-1",
    channelType: "main_chat",
    now: "2026-05-01T00:00:00.000Z",
  });
  updateActivityConfig(db, {
    activityRoleIds: {
      weak: "role-weak",
      stable: "role-stable",
    },
  });

  const state = ensureActivityState(db);
  state.runtime.openSessions.user_1 = { startedAt: "2026-05-09T12:00:00.000Z" };
  state.runtime.lastFlushAt = "2026-05-09T12:30:00.000Z";
  state.runtime.lastFullRecalcAt = "2026-05-09T12:35:00.000Z";
  state.calibrationRuns.push({
    mode: "historical_import",
    completedAt: "2026-05-09T12:35:00.000Z",
    importedEntryCount: 24,
    importedUserCount: 3,
    appliedRoleCount: 2,
  });

  const payload = buildActivityOperatorPanelPayload({
    db,
    statusText: "Готово.",
  });

  assert.equal(payload.embeds[0].data.title, "Activity Panel");
  assert.match(payload.embeds[0].data.description, /Закрытая мод-панель активности/);
  assert.equal(payload.components.length, 1);
  assert.deepEqual(payload.components[0].components.map((component) => component.data.custom_id), [
    "activity_panel_refresh",
    "activity_panel_historical_import",
    "activity_panel_assign_roles",
    "activity_panel_back",
  ]);
  const fieldTexts = payload.embeds[0].data.fields.map((field) => `${field.name}: ${field.value}`).join("\n");
  assert.match(fieldTexts, /Watched channels: \*\*1\*\*/);
  assert.match(fieldTexts, /Mapped roles: \*\*2\*\*/);
  assert.match(fieldTexts, /Snapshots: \*\*0\*\*/);
  assert.match(fieldTexts, /Open sessions: \*\*1\*\*/);
  assert.match(fieldTexts, /historical_import/);
  assert.match(fieldTexts, /24 entries/);
  assert.match(fieldTexts, /Готово\./);
});

test("handleActivityPanelButtonInteraction opens, refreshes, assigns, and returns to the main moderator panel", async () => {
  const calls = [];
  const interaction = {
    customId: "panel_open_activity",
    member: { id: "mod-1" },
    async update(payload) {
      calls.push(["update", payload]);
    },
    async deferUpdate() {
      calls.push(["deferUpdate"]);
    },
    async editReply(payload) {
      calls.push(["editReply", payload]);
    },
  };

  const handledOpen = await handleActivityPanelButtonInteraction({
    interaction,
    client: { id: "client" },
    db: {},
    isModerator: () => true,
    replyNoPermission: async () => {
      throw new Error("should not run");
    },
    buildModeratorPanelPayload: async () => ({ content: "main" }),
    buildActivityPanelPayload: () => ({ content: "activity" }),
    runHistoricalImport: async () => ({ importedEntryCount: 4, ignoredEntryCount: 1 }),
    runInitialRoleAssignment: async () => ({ appliedCount: 2, skippedCount: 1 }),
  });

  assert.equal(handledOpen, true);
  assert.deepEqual(calls[0], ["update", { content: "activity" }]);

  interaction.customId = "activity_panel_historical_import";
  const handledImport = await handleActivityPanelButtonInteraction({
    interaction,
    client: { id: "client" },
    db: {},
    isModerator: () => true,
    replyNoPermission: async () => {
      throw new Error("should not run");
    },
    buildModeratorPanelPayload: async () => ({ content: "main" }),
    buildActivityPanelPayload: ({ statusText }) => ({ content: statusText }),
    runHistoricalImport: async () => ({ importedEntryCount: 4, ignoredEntryCount: 1 }),
    runInitialRoleAssignment: async () => ({ appliedCount: 2, skippedCount: 1 }),
  });

  assert.equal(handledImport, true);
  assert.deepEqual(calls[1], ["deferUpdate"]);
  assert.deepEqual(calls[2], ["editReply", { content: "Historical import завершён. Imported 4, ignored 1." }]);

  interaction.customId = "activity_panel_assign_roles";
  const handledAssign = await handleActivityPanelButtonInteraction({
    interaction,
    client: { id: "client" },
    db: {},
    isModerator: () => true,
    replyNoPermission: async () => {
      throw new Error("should not run");
    },
    buildModeratorPanelPayload: async () => ({ content: "main" }),
    buildActivityPanelPayload: ({ statusText }) => ({ content: statusText }),
    runHistoricalImport: async () => ({ importedEntryCount: 0, ignoredEntryCount: 0 }),
    runInitialRoleAssignment: async () => ({ appliedCount: 2, skippedCount: 1 }),
  });

  assert.equal(handledAssign, true);
  assert.deepEqual(calls[3], ["deferUpdate"]);
  assert.deepEqual(calls[4], ["editReply", { content: "Initial role assignment завершён. Applied 2, skipped 1." }]);

  interaction.customId = "activity_panel_back";
  const handledBack = await handleActivityPanelButtonInteraction({
    interaction,
    client: { id: "client" },
    db: {},
    isModerator: () => true,
    replyNoPermission: async () => {
      throw new Error("should not run");
    },
    buildModeratorPanelPayload: async () => ({ content: "main" }),
    buildActivityPanelPayload: () => ({ content: "activity" }),
    runHistoricalImport: async () => ({ importedEntryCount: 0, ignoredEntryCount: 0 }),
    runInitialRoleAssignment: async () => ({ appliedCount: 0, skippedCount: 0 }),
  });

  assert.equal(handledBack, true);
  assert.deepEqual(calls[5], ["update", { content: "main" }]);
});

test("handleActivityPanelButtonInteraction rejects non-moderators before opening the panel", async () => {
  const replies = [];

  const handled = await handleActivityPanelButtonInteraction({
    interaction: {
      customId: "panel_open_activity",
      member: { id: "user-1" },
    },
    client: { id: "client" },
    db: {},
    isModerator: () => false,
    async replyNoPermission() {
      replies.push("no-permission");
    },
    buildModeratorPanelPayload: async () => ({ content: "main" }),
    buildActivityPanelPayload: () => ({ content: "activity" }),
    runHistoricalImport: async () => ({ importedEntryCount: 0, ignoredEntryCount: 0 }),
    runInitialRoleAssignment: async () => ({ appliedCount: 0, skippedCount: 0 }),
  });

  assert.equal(handled, true);
  assert.deepEqual(replies, ["no-permission"]);
});