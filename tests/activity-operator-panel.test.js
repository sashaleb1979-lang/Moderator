"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildActivityOperatorPanelPayload,
  handleActivityPanelButtonInteraction,
  handleActivityPanelModalSubmitInteraction,
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
  state.runtime.openSessions.user_1 = {
    startedAt: "2026-05-09T12:00:00.000Z",
    messageCount: 2,
    weightedMessageCount: 2,
  };
  state.runtime.lastFlushAt = "2026-05-09T12:30:00.000Z";
  state.runtime.lastFlushStats = {
    finalizedSessionCount: 1,
    rebuiltUserCount: 2,
  };
  state.runtime.lastFullRecalcAt = "2026-05-09T12:35:00.000Z";
  state.runtime.lastDailyRoleSyncAt = "2026-05-09T13:00:00.000Z";
  state.runtime.lastDailyRoleSyncStats = {
    targetUserCount: 3,
    rebuiltUserCount: 3,
    appliedCount: 2,
    skippedCount: 1,
  };
  state.userSnapshots["user-1"] = {
    roleEligibilityStatus: "boosted_new_member",
    roleEligibleForActivityRole: true,
  };
  state.userSnapshots["user-2"] = {
    roleEligibilityStatus: "gated_new_member",
    roleEligibleForActivityRole: false,
  };
  state.userChannelDailyStats.push({
    guildId: "guild-1",
    channelId: "main-1",
    userId: "user-1",
    date: "2026-05-09",
    messagesCount: 10,
    weightedMessagesCount: 10,
    sessionsCount: 1,
    effectiveSessionsCount: 1,
  });
  state.globalUserSessions.push({ id: "session-1" });
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
  assert.equal(payload.components.length, 2);
  assert.deepEqual(payload.components[0].components.map((component) => component.data.custom_id), [
    "activity_panel_refresh",
    "activity_panel_historical_import",
    "activity_panel_assign_roles",
    "activity_panel_config_access",
    "activity_panel_back",
  ]);
  assert.deepEqual(payload.components[1].components.map((component) => component.data.custom_id), [
    "activity_panel_config_roles_primary",
    "activity_panel_config_roles_secondary",
    "activity_panel_config_watch_save",
  ]);
  const fieldTexts = payload.embeds[0].data.fields.map((field) => `${field.name}: ${field.value}`).join("\n");
  assert.match(fieldTexts, /Watched channels: \*\*1\*\*/);
  assert.match(fieldTexts, /main-1 \(main-1\)/);
  assert.match(fieldTexts, /Mapped roles: \*\*2\*\*/);
  assert.match(fieldTexts, /Snapshots: \*\*2\*\*/);
  assert.match(fieldTexts, /Open sessions: \*\*1\*\*/);
  assert.match(fieldTexts, /Analyzed messages: \*\*12\*\*/);
  assert.match(fieldTexts, /Weighted messages: \*\*12\*\*/);
  assert.match(fieldTexts, /Last flush result: 2 users, 1 finalized sessions/);
  assert.match(fieldTexts, /Role gate: after \*\*3\*\* days on server/);
  assert.match(fieldTexts, /Newcomer boost: \*\*x1\.15\*\* -> x1\.00 by day \*\*7\*\*/);
  assert.match(fieldTexts, /Snapshots gated\/boosted: \*\*1\*\* \/ \*\*1\*\*/);
  assert.match(fieldTexts, /Last daily sync:/);
  assert.match(fieldTexts, /Targets: \*\*3\*\*/);
  assert.match(fieldTexts, /historical_import/);
  assert.match(fieldTexts, /24 entries/);
  assert.match(fieldTexts, /Activity moderators:/);
  assert.match(fieldTexts, /weak: role-weak/);
  assert.match(fieldTexts, /Готово\./);
});

test("handleActivityPanelButtonInteraction opens, refreshes, config modals, assigns, and returns to the main moderator panel", async () => {
  const calls = [];
  const interaction = {
    customId: "panel_open_activity",
    member: { id: "mod-1" },
    async update(payload) {
      calls.push(["update", payload]);
    },
    async showModal(modal) {
      calls.push(["showModal", modal.data.custom_id]);
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

  interaction.customId = "activity_panel_config_access";
  const handledAccessConfig = await handleActivityPanelButtonInteraction({
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

  assert.equal(handledAccessConfig, true);
  assert.deepEqual(calls[1], ["showModal", "activity_panel_config_access_modal"]);

  interaction.customId = "activity_panel_config_roles_primary";
  const handledPrimaryRoleConfig = await handleActivityPanelButtonInteraction({
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

  assert.equal(handledPrimaryRoleConfig, true);
  assert.deepEqual(calls[2], ["showModal", "activity_panel_config_roles_primary_modal"]);

  interaction.customId = "activity_panel_config_watch_save";
  const handledWatchSave = await handleActivityPanelButtonInteraction({
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

  assert.equal(handledWatchSave, true);
  assert.deepEqual(calls[3], ["showModal", "activity_panel_config_watch_save_modal"]);

  interaction.customId = "activity_panel_config_watch_remove";
  const handledWatchRemove = await handleActivityPanelButtonInteraction({
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

  assert.equal(handledWatchRemove, true);
  assert.deepEqual(calls[4], ["showModal", "activity_panel_config_watch_remove_modal"]);

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
  assert.deepEqual(calls[5], ["deferUpdate"]);
  assert.deepEqual(calls[6], ["editReply", { content: "Импорт истории завершён. Импортировано 4, пропущено 1. Все каналы обработаны без ошибок." }]);

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
  assert.deepEqual(calls[7], ["deferUpdate"]);
  assert.deepEqual(calls[8], ["editReply", { content: "Initial role assignment завершён. Applied 2, skipped 1." }]);

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
  assert.deepEqual(calls[9], ["update", { content: "main" }]);
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

test("handleActivityPanelModalSubmitInteraction updates access roles and activity role mappings", async () => {
  const db = {};
  const replies = [];
  const saved = [];

  const handledAccess = await handleActivityPanelModalSubmitInteraction({
    interaction: {
      customId: "activity_panel_config_access_modal",
      member: { id: "mod-1" },
      user: { id: "mod-1" },
      fields: {
        getTextInputValue(fieldId) {
          if (fieldId === "activity_access_moderator_roles") return "<@&111> 222";
          if (fieldId === "activity_access_admin_roles") return "333";
          return "";
        },
      },
    },
    db,
    isModerator: () => true,
    replyNoPermission: async () => {
      throw new Error("should not run");
    },
    replyError: async (_interaction, text) => {
      replies.push(["error", text]);
    },
    replySuccess: async (_interaction, text) => {
      replies.push(["success", text]);
    },
    parseRequestedRoleId(value) {
      const text = String(value || "").trim();
      const mentionMatch = text.match(/^<@&(\d+)>$/);
      const candidate = mentionMatch ? mentionMatch[1] : text;
      return /^\d+$/.test(candidate) ? candidate : "";
    },
    saveDb() {
      saved.push("saved");
    },
  });

  assert.equal(handledAccess, true);
  assert.deepEqual(ensureActivityState(db).config.moderatorRoleIds, ["111", "222"]);
  assert.deepEqual(ensureActivityState(db).config.adminRoleIds, ["333"]);
  assert.match(replies[0][1], /Activity access обновлён/);

  const handledRoles = await handleActivityPanelModalSubmitInteraction({
    interaction: {
      customId: "activity_panel_config_roles_secondary_modal",
      member: { id: "mod-1" },
      user: { id: "mod-1" },
      fields: {
        getTextInputValue(fieldId) {
          if (fieldId === "activity_role_floating") return "444";
          if (fieldId === "activity_role_weak") return "<@&555>";
          if (fieldId === "activity_role_dead") return "";
          return "";
        },
      },
    },
    db,
    isModerator: () => true,
    replyNoPermission: async () => {
      throw new Error("should not run");
    },
    replyError: async (_interaction, text) => {
      replies.push(["error", text]);
    },
    replySuccess: async (_interaction, text) => {
      replies.push(["success", text]);
    },
    parseRequestedRoleId(value) {
      const text = String(value || "").trim();
      const mentionMatch = text.match(/^<@&(\d+)>$/);
      const candidate = mentionMatch ? mentionMatch[1] : text;
      return /^\d+$/.test(candidate) ? candidate : "";
    },
    saveDb() {
      saved.push("saved");
    },
  });

  assert.equal(handledRoles, true);
  assert.equal(ensureActivityState(db).config.activityRoleIds.floating, "444");
  assert.equal(ensureActivityState(db).config.activityRoleIds.weak, "555");
  assert.equal(ensureActivityState(db).config.activityRoleIds.dead, null);
  assert.match(replies[1][1], /Activity role mapping обновлён/);
  assert.equal(saved.length, 2);
});

test("handleActivityPanelModalSubmitInteraction saves and removes watched channels", async () => {
  const db = {};
  const replies = [];
  const saved = [];

  upsertWatchedChannel(db, {
    channelId: "111111111111111111",
    channelType: "small_chat",
    channelWeight: 1.15,
    countForTrust: false,
    now: "2026-05-01T00:00:00.000Z",
  });

  const handledSave = await handleActivityPanelModalSubmitInteraction({
    interaction: {
      customId: "activity_panel_config_watch_save_modal",
      member: { id: "mod-1" },
      user: { id: "mod-1" },
      fields: {
        getTextInputValue(fieldId) {
          if (fieldId === "activity_watch_channel_list") return "<#123456789012345678>\n987654321098765432";
          return "";
        },
      },
    },
    db,
    isModerator: () => true,
    replyNoPermission: async () => {
      throw new Error("should not run");
    },
    replyError: async (_interaction, text) => {
      replies.push(["error", text]);
    },
    replySuccess: async (_interaction, text) => {
      replies.push(["success", text]);
    },
    parseRequestedRoleId() {
      throw new Error("should not parse roles");
    },
    parseRequestedChannelId(value) {
      const text = String(value || "").trim();
      const mentionMatch = text.match(/^<#(\d+)>$/);
      const candidate = mentionMatch ? mentionMatch[1] : text;
      return /^\d+$/.test(candidate) ? candidate : "";
    },
    async resolveChannel(channelId) {
      return {
        id: channelId,
        name: "main-chat",
        guildId: "guild-1",
        isTextBased() {
          return true;
        },
      };
    },
    saveDb() {
      saved.push("saved");
    },
  });

  assert.equal(handledSave, true);
  assert.equal(ensureActivityState(db).watchedChannels.length, 2);
  assert.deepEqual(ensureActivityState(db).watchedChannels.map((entry) => entry.channelId).sort(), ["123456789012345678", "987654321098765432"]);
  assert.equal(ensureActivityState(db).watchedChannels.find((entry) => entry.channelId === "123456789012345678").channelType, "normal_chat");
  assert.equal(ensureActivityState(db).watchedChannels.find((entry) => entry.channelId === "123456789012345678").channelWeight, 1);
  assert.equal(ensureActivityState(db).watchedChannels.find((entry) => entry.channelId === "123456789012345678").countForTrust, true);
  assert.match(replies[0][1], /Список каналов сохранён/);

  const handledRemove = await handleActivityPanelModalSubmitInteraction({
    interaction: {
      customId: "activity_panel_config_watch_remove_modal",
      member: { id: "mod-1" },
      user: { id: "mod-1" },
      fields: {
        getTextInputValue(fieldId) {
          if (fieldId === "activity_watch_remove_channel_id") return "123456789012345678";
          return "";
        },
      },
    },
    db,
    isModerator: () => true,
    replyNoPermission: async () => {
      throw new Error("should not run");
    },
    replyError: async (_interaction, text) => {
      replies.push(["error", text]);
    },
    replySuccess: async (_interaction, text) => {
      replies.push(["success", text]);
    },
    parseRequestedRoleId() {
      throw new Error("should not parse roles");
    },
    parseRequestedChannelId(value) {
      return String(value || "").trim();
    },
    async resolveChannel() {
      throw new Error("should not resolve channels");
    },
    saveDb() {
      saved.push("saved");
    },
  });

  assert.equal(handledRemove, true);
  assert.equal(ensureActivityState(db).watchedChannels.length, 1);
  assert.equal(ensureActivityState(db).watchedChannels[0].channelId, "987654321098765432");
  assert.match(replies[1][1], /Watched channel удалён/);
  assert.equal(saved.length, 2);
});