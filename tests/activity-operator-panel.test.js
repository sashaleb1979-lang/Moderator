"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildActivityOperatorPanelPayload,
  handleActivityPanelButtonInteraction,
  handleActivityPanelModalSubmitInteraction,
} = require("../src/activity/operator");
const { ensureActivityState, updateActivityConfig, upsertWatchedChannel } = require("../src/activity/state");

test("buildActivityOperatorPanelPayload separates overview, channels, roles, and runtime views", () => {
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
  state.runtime.lastRebuildAndRoleSyncAt = "2026-05-09T12:35:00.000Z";
  state.runtime.lastRebuildAndRoleSyncStats = {
    targetUserCount: 3,
    localActivityTargetCount: 2,
    missingLocalHistoryUserCount: 1,
    rebuiltUserCount: 3,
    appliedCount: 2,
    skippedCount: 1,
    skipReasonCounts: {
      unchanged: 1,
    },
    syncMode: "rebuild_and_sync",
  };
  state.runtime.lastRolesOnlySyncAt = "2026-05-09T13:00:00.000Z";
  state.runtime.lastRolesOnlySyncStats = {
    targetUserCount: 2,
    localActivityTargetCount: 1,
    missingLocalHistoryUserCount: 1,
    rebuiltUserCount: 0,
    appliedCount: 1,
    skippedCount: 1,
    skipReasonCounts: {
      unchanged: 1,
    },
    syncMode: "roles_only",
  };
  state.runtime.lastDailyRoleSyncAt = "2026-05-09T13:00:00.000Z";
  state.runtime.lastDailyRoleSyncStats = {
    targetUserCount: 2,
    localActivityTargetCount: 1,
    missingLocalHistoryUserCount: 1,
    rebuiltUserCount: 0,
    appliedCount: 1,
    skippedCount: 1,
    skipReasonCounts: {
      unchanged: 1,
    },
    syncMode: "roles_only",
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

  assert.equal(payload.embeds[0].data.title, "Activity Panel • Обзор");
  assert.match(payload.embeds[0].data.description, /Кнопки ниже разделены по смыслу/);
  assert.equal(payload.embeds.length, 2);
  assert.equal(payload.embeds[1].data.title, "Activity Panel • Что важно");
  assert.equal(payload.components.length, 3);
  assert.deepEqual(payload.components[0].components.map((component) => component.data.custom_id), [
    "activity_panel_view_overview",
    "activity_panel_view_channels",
    "activity_panel_view_roles",
    "activity_panel_view_runtime",
    "activity_panel_back",
  ]);
  assert.deepEqual(payload.components[1].components.map((component) => component.data.custom_id), [
    "activity_panel_refresh_overview",
    "activity_panel_historical_import",
    "activity_panel_rebuild_metrics",
    "activity_panel_sync_roles",
  ]);
  assert.deepEqual(payload.components[2].components.map((component) => component.data.custom_id), [
    "activity_panel_config_access",
    "activity_panel_config_roles_primary",
    "activity_panel_config_roles_secondary",
    "activity_panel_config_watch_save",
  ]);
  const fieldTexts = payload.embeds[0].data.fields.map((field) => `${field.name}: ${field.value}`).join("\n");
  assert.match(fieldTexts, /Watched channels: \*\*1\*\*/);
  assert.match(fieldTexts, /Mapped roles: \*\*2\*\*/);
  assert.match(fieldTexts, /Пересчитать метрики: пересобирает activity snapshots/);
  assert.match(fieldTexts, /Синхронизировать роли: только выравнивает роли/);
  assert.match(fieldTexts, /Последний полный rebuild\+sync:/);
  assert.match(fieldTexts, /Последний roles-only sync:/);
  assert.match(fieldTexts, /Need import rerun for old history: \*\*1\*\*/);
  assert.match(fieldTexts, /Open sessions: \*\*1\*\*/);
  assert.match(fieldTexts, /Snapshots gated\/boosted: \*\*1\*\* \/ \*\*1\*\*/);
  assert.match(fieldTexts, /Готово\./);
  const overviewDiagnosticTexts = payload.embeds[1].data.fields.map((field) => `${field.name}: ${field.value}`).join("\n");
  assert.match(overviewDiagnosticTexts, /Ошибки runtime: \*\*0\*\*/);
  assert.match(overviewDiagnosticTexts, /Каналов без import checkpoint: \*\*1\*\*/);
  assert.match(overviewDiagnosticTexts, /без изменений: \*\*1\*\*/i);
  assert.match(overviewDiagnosticTexts, /Есть users без локальной истории: запусти «Импорт истории» перед sync roles\./);

  const channelsPayload = buildActivityOperatorPanelPayload({
    db,
    view: "channels",
  });
  assert.equal(channelsPayload.embeds[0].data.title, "Activity Panel • Каналы и импорт");
  assert.equal(channelsPayload.embeds.length, 2);
  assert.equal(channelsPayload.embeds[1].data.title, "Activity Panel • Каналы • Диагностика");
  assert.deepEqual(channelsPayload.components[1].components.map((component) => component.data.custom_id), [
    "activity_panel_refresh_channels",
    "activity_panel_historical_import",
    "activity_panel_config_watch_save",
    "activity_panel_config_watch_remove",
  ]);
  const channelFieldTexts = channelsPayload.embeds[0].data.fields.map((field) => `${field.name}: ${field.value}`).join("\n");
  assert.match(channelFieldTexts, /Последний запуск: \*\*historical_import\*\*/);
  assert.match(channelFieldTexts, /main-1 \(main-1\)/);
  assert.match(channelFieldTexts, /Кнопка «Редактировать» открывает полный список каналов и сохраняет его целиком\./);
  const channelDiagnosticTexts = channelsPayload.embeds[1].data.fields.map((field) => `${field.name}: ${field.value}`).join("\n");
  assert.match(channelDiagnosticTexts, /Каналов с import cursor: \*\*0\*\*/);
  assert.match(channelDiagnosticTexts, /Каналов без import checkpoint: \*\*1\*\*/);
  assert.match(channelDiagnosticTexts, /Ошибки import\/runtime: \*\*0\*\*/);
  assert.match(channelDiagnosticTexts, /У 1 каналов ещё нет import checkpoint: после проверки списка запусти «Импорт истории»\./);

  const rolesPayload = buildActivityOperatorPanelPayload({
    db,
    view: "roles",
  });
  assert.equal(rolesPayload.embeds[0].data.title, "Activity Panel • Роли и правила");
  assert.equal(rolesPayload.embeds.length, 2);
  assert.equal(rolesPayload.embeds[1].data.title, "Activity Panel • Роли • Диагностика");
  assert.deepEqual(rolesPayload.components[1].components.map((component) => component.data.custom_id), [
    "activity_panel_refresh_roles",
    "activity_panel_sync_roles",
    "activity_panel_config_access",
    "activity_panel_config_roles_primary",
    "activity_panel_config_roles_secondary",
  ]);
  const roleFieldTexts = rolesPayload.embeds[0].data.fields.map((field) => `${field.name}: ${field.value}`).join("\n");
  assert.match(roleFieldTexts, /Role gate: after \*\*3\*\* days on server/);
  assert.match(roleFieldTexts, /Newcomer boost: \*\*x1\.15\*\* -> x1\.00 by day \*\*7\*\*/);
  assert.match(roleFieldTexts, /Последний полный rebuild\+sync:/);
  assert.match(roleFieldTexts, /Последний roles-only sync:/);
  assert.match(roleFieldTexts, /Activity moderators:/);
  const roleDiagnosticTexts = rolesPayload.embeds[1].data.fields.map((field) => `${field.name}: ${field.value}`).join("\n");
  assert.match(roleDiagnosticTexts, /Full rebuild \+ sync:/);
  assert.match(roleDiagnosticTexts, /Roles-only sync:/);
  assert.match(roleDiagnosticTexts, /skipped: \*\*1\*\*/i);
  assert.match(roleDiagnosticTexts, /без изменений: \*\*1\*\*/i);
  assert.match(roleDiagnosticTexts, /Need import rerun for old history: \*\*1\*\*/);
  assert.match(roleDiagnosticTexts, /Есть 1 users без локальной истории: сначала historical import, потом sync roles\./);
  assert.match(fieldTexts, /Snapshots: \*\*2\*\*/);

  const runtimePayload = buildActivityOperatorPanelPayload({
    db,
    view: "runtime",
  });
  assert.equal(runtimePayload.embeds[0].data.title, "Activity Panel • Процессы");
  assert.equal(runtimePayload.embeds.length, 2);
  assert.equal(runtimePayload.embeds[1].data.title, "Activity Panel • Процессы • Диагностика");
  assert.deepEqual(runtimePayload.components[1].components.map((component) => component.data.custom_id), [
    "activity_panel_refresh_runtime",
    "activity_panel_rebuild_metrics",
  ]);
  const runtimeFieldTexts = runtimePayload.embeds[0].data.fields.map((field) => `${field.name}: ${field.value}`).join("\n");
  assert.match(runtimeFieldTexts, /Analyzed messages: \*\*12\*\*/);
  assert.match(runtimeFieldTexts, /Weighted messages: \*\*12\*\*/);
  assert.match(runtimeFieldTexts, /Last flush result: 2 users, 1 finalized sessions/);
  assert.match(runtimeFieldTexts, /Ошибок не зафиксировано\./);
  const runtimeDiagnosticTexts = runtimePayload.embeds[1].data.fields.map((field) => `${field.name}: ${field.value}`).join("\n");
  assert.match(runtimeDiagnosticTexts, /Последний полный rebuild\+sync:/);
  assert.match(runtimeDiagnosticTexts, /Finalized sessions: \*\*1\*\*/);
  assert.match(runtimeDiagnosticTexts, /Ошибки runtime: \*\*0\*\*/);
  assert.match(runtimeDiagnosticTexts, /Runtime ещё живой: дождись flush или обнови раздел позже, если нужна самая свежая картина\./);
});

test("handleActivityPanelButtonInteraction navigates views and routes rebuild vs sync actions separately", async () => {
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

  const buildArgs = () => ({
    interaction,
    client: { id: "client" },
    db: {},
    isModerator: () => true,
    replyNoPermission: async () => {
      throw new Error("should not run");
    },
    buildModeratorPanelPayload: async () => ({ content: "main" }),
    buildActivityPanelPayload: ({ view = "overview", statusText = "" } = {}) => ({ content: `${view}|${statusText}` }),
    runHistoricalImport: async () => ({ importedEntryCount: 4, ignoredEntryCount: 1 }),
    runRebuildMetrics: async () => ({ rebuiltUserCount: 3, roleAssignment: { appliedCount: 2, skippedCount: 1 } }),
    runSyncRoles: async () => ({ roleAssignment: { appliedCount: 4, skippedCount: 2 } }),
  });

  const handledOpen = await handleActivityPanelButtonInteraction(buildArgs());

  assert.equal(handledOpen, true);
  assert.deepEqual(calls[0], ["update", { content: "overview|" }]);

  interaction.customId = "activity_panel_view_channels";
  const handledChannelsView = await handleActivityPanelButtonInteraction(buildArgs());

  assert.equal(handledChannelsView, true);
  assert.deepEqual(calls[1], ["update", { content: "channels|" }]);

  interaction.customId = "activity_panel_refresh_channels";
  const handledRefresh = await handleActivityPanelButtonInteraction(buildArgs());

  assert.equal(handledRefresh, true);
  assert.deepEqual(calls[2], ["update", { content: "channels|Панель обновлена." }]);

  interaction.customId = "activity_panel_config_access";
  const handledAccessConfig = await handleActivityPanelButtonInteraction(buildArgs());

  assert.equal(handledAccessConfig, true);
  assert.deepEqual(calls[3], ["showModal", "activity_panel_config_access_modal"]);

  interaction.customId = "activity_panel_config_roles_primary";
  const handledPrimaryRoleConfig = await handleActivityPanelButtonInteraction(buildArgs());

  assert.equal(handledPrimaryRoleConfig, true);
  assert.deepEqual(calls[4], ["showModal", "activity_panel_config_roles_primary_modal"]);

  interaction.customId = "activity_panel_config_watch_save";
  const handledWatchSave = await handleActivityPanelButtonInteraction(buildArgs());

  assert.equal(handledWatchSave, true);
  assert.deepEqual(calls[5], ["showModal", "activity_panel_config_watch_save_modal"]);

  interaction.customId = "activity_panel_config_watch_remove";
  const handledWatchRemove = await handleActivityPanelButtonInteraction(buildArgs());

  assert.equal(handledWatchRemove, true);
  assert.deepEqual(calls[6], ["showModal", "activity_panel_config_watch_remove_modal"]);

  interaction.customId = "activity_panel_historical_import";
  const handledImport = await handleActivityPanelButtonInteraction(buildArgs());

  assert.equal(handledImport, true);
  assert.deepEqual(calls[7], ["deferUpdate"]);
  assert.deepEqual(calls[8], ["editReply", { content: "channels|Импорт истории завершён. Импортировано 4, пропущено 1. Все каналы обработаны без ошибок." }]);

  interaction.customId = "activity_panel_rebuild_metrics";
  const handledRebuild = await handleActivityPanelButtonInteraction(buildArgs());

  assert.equal(handledRebuild, true);
  assert.deepEqual(calls[9], ["deferUpdate"]);
  assert.deepEqual(calls[10], ["editReply", { content: "runtime|Пересчёт метрик завершён. Пересобрано 3, роли применены 2, пропущено 1." }]);

  interaction.customId = "activity_panel_sync_roles";
  const handledSyncRoles = await handleActivityPanelButtonInteraction(buildArgs());

  assert.equal(handledSyncRoles, true);
  assert.deepEqual(calls[11], ["deferUpdate"]);
  assert.deepEqual(calls[12], ["editReply", { content: "roles|Синхронизация ролей завершена. Применено 4, пропущено 2. Score не пересчитывался." }]);

  interaction.customId = "activity_panel_back";
  const handledBack = await handleActivityPanelButtonInteraction(buildArgs());

  assert.equal(handledBack, true);
  assert.deepEqual(calls[13], ["update", { content: "main" }]);
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
    runRebuildMetrics: async () => ({ rebuiltUserCount: 0, roleAssignment: { appliedCount: 0, skippedCount: 0 } }),
    runSyncRoles: async () => ({ roleAssignment: { appliedCount: 0, skippedCount: 0 } }),
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