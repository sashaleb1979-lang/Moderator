"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { MessageFlags } = require("discord.js");

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
    snapshotWithoutLocalHistoryUserCount: 1,
    mirrorOnlyPersistedUserCount: 0,
    managedRoleHolderWithoutPersistedActivityUserCount: 0,
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
    snapshotWithoutLocalHistoryUserCount: 1,
    mirrorOnlyPersistedUserCount: 0,
    managedRoleHolderWithoutPersistedActivityUserCount: 0,
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
    snapshotWithoutLocalHistoryUserCount: 1,
    mirrorOnlyPersistedUserCount: 0,
    managedRoleHolderWithoutPersistedActivityUserCount: 0,
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
  assert.match(payload.embeds[0].data.description, /Статус раздела:/);
  assert.match(payload.embeds[0].data.description, /canonical snapshots без локальной history-базы/i);
  assert.equal(payload.embeds.length, 2);
  assert.equal(payload.embeds[1].data.title, "Activity Panel • Фокус оператора");
  assert.equal(payload.components.length, 3);
  assert.deepEqual(payload.components[0].components.map((component) => component.data.custom_id), [
    "activity_panel_view_overview",
    "activity_panel_view_channels",
    "activity_panel_view_roles",
    "activity_panel_view_runtime",
    "activity_panel_back",
  ]);
  assert.deepEqual(payload.components[0].components.map((component) => component.data.label), [
    "Сводка",
    "Каналы",
    "Роли",
    "Процессы",
    "В мод-панель",
  ]);
  assert.deepEqual(payload.components[1].components.map((component) => component.data.custom_id), [
    "activity_panel_refresh_overview",
    "activity_panel_historical_import",
    "activity_panel_rebuild_metrics",
    "activity_panel_sync_roles",
  ]);
  assert.deepEqual(payload.components[1].components.map((component) => component.data.label), [
    "Обновить вид",
    "Запустить импорт",
    "Пересчитать и выдать",
    "Только выдать роли",
  ]);
  assert.deepEqual(payload.components[2].components.map((component) => component.data.custom_id), [
    "activity_panel_config_watch_save",
    "activity_panel_config_access",
    "activity_panel_config_roles_primary",
    "activity_panel_config_roles_secondary",
    "activity_panel_inspect_user",
  ]);
  assert.deepEqual(payload.components[2].components.map((component) => component.data.label), [
    "Каналы",
    "Кто управляет",
    "Основные роли",
    "Доп. роли",
    "Проверить юзера",
  ]);
  const fieldTexts = payload.embeds[0].data.fields.map((field) => `${field.name}: ${field.value}`).join("\n");
  assert.match(fieldTexts, /Каналов в tracking: \*\*1\*\*/);
  assert.match(fieldTexts, /Привязано activity-ролей: \*\*2\*\*/);
  assert.match(fieldTexts, /Полный цикл:/);
  assert.match(fieldTexts, /Только роли:/);
  assert.match(fieldTexts, /Gate \/ boost snapshots: \*\*1\*\* \/ \*\*1\*\*/);
  assert.match(fieldTexts, /Импорт истории:/);
  assert.match(fieldTexts, /Запустить импорт: добирает старые сообщения/);
  assert.match(fieldTexts, /Пересчитать и выдать: пересобирает snapshots/);
  assert.match(fieldTexts, /Только выдать роли: синхронизирует Discord-роли/);
  assert.match(fieldTexts, /Открытых сессий: \*\*1\*\*/);
  assert.match(fieldTexts, /Готовых snapshots: \*\*2\*\*/i);
  assert.match(fieldTexts, /Готово\./);
  const overviewDiagnosticTexts = payload.embeds[1].data.fields.map((field) => `${field.name}: ${field.value}`).join("\n");
  assert.match(overviewDiagnosticTexts, /Ошибки runtime: \*\*0\*\*/);
  assert.match(overviewDiagnosticTexts, /Каналов без import checkpoint: \*\*1\*\*/);
  assert.match(overviewDiagnosticTexts, /Нужен добор старой истории: \*\*1\*\*/);
  assert.match(overviewDiagnosticTexts, /Canonical snapshots без local history: \*\*1\*\*/);
  assert.match(overviewDiagnosticTexts, /Mirror-only persisted fallback: \*\*0\*\*/);
  assert.match(overviewDiagnosticTexts, /Live holders без saved activity: \*\*0\*\*/);
  assert.match(overviewDiagnosticTexts, /Противоречивых persisted states: \*\*0\*\*/);
  assert.match(overviewDiagnosticTexts, /Причины пропуска:/);
  assert.match(overviewDiagnosticTexts, /уже совпадает: \*\*1\*\*/i);
  assert.match(overviewDiagnosticTexts, /canonical snapshots без local history: roles-only sync возможен, но полный rebuild требует import истории\./i);

  const channelsPayload = buildActivityOperatorPanelPayload({
    db,
    view: "channels",
  });
  assert.equal(channelsPayload.embeds[0].data.title, "Activity Panel • Каналы и импорт");
  assert.equal(channelsPayload.embeds.length, 2);
  assert.match(channelsPayload.embeds[0].data.description, /Статус раздела:/);
  assert.equal(channelsPayload.embeds[1].data.title, "Activity Panel • Каналы • Фокус");
  assert.deepEqual(channelsPayload.components[1].components.map((component) => component.data.custom_id), [
    "activity_panel_refresh_channels",
    "activity_panel_historical_import",
    "activity_panel_config_watch_save",
    "activity_panel_config_watch_remove",
    "activity_panel_inspect_user",
  ]);
  assert.deepEqual(channelsPayload.components[1].components.map((component) => component.data.label), [
    "Обновить вид",
    "Запустить импорт",
    "Список каналов",
    "Убрать 1 канал",
    "Проверить юзера",
  ]);
  const channelFieldTexts = channelsPayload.embeds[0].data.fields.map((field) => `${field.name}: ${field.value}`).join("\n");
  assert.match(channelFieldTexts, /Каналов в tracking: \*\*1\*\*/);
  assert.match(channelFieldTexts, /С import cursor: \*\*0\*\*/);
  assert.match(channelFieldTexts, /Без checkpoint-а: \*\*1\*\*/);
  assert.match(channelFieldTexts, /Режим: \*\*historical_import\*\*/);
  assert.match(channelFieldTexts, /main-1 \(main-1\)/);
  assert.match(channelFieldTexts, /Список каналов: открывает и сохраняет полный текущий список целиком\./);
  const channelDiagnosticTexts = channelsPayload.embeds[1].data.fields.map((field) => `${field.name}: ${field.value}`).join("\n");
  assert.match(channelDiagnosticTexts, /Каналов без import checkpoint: \*\*1\*\*/);
  assert.match(channelDiagnosticTexts, /Ошибки import\/runtime: \*\*0\*\*/);
  assert.match(channelDiagnosticTexts, /Импорт не меняет список каналов сам по себе\./);
  assert.match(channelDiagnosticTexts, /Редактор каналов заменяет список целиком\./);
  assert.match(channelDiagnosticTexts, /У 1 каналов ещё нет checkpoint-а: после проверки списка запусти импорт истории\./);

  const rolesPayload = buildActivityOperatorPanelPayload({
    db,
    view: "roles",
  });
  assert.equal(rolesPayload.embeds[0].data.title, "Activity Panel • Роли и правила");
  assert.equal(rolesPayload.embeds.length, 2);
  assert.match(rolesPayload.embeds[0].data.description, /Статус раздела:/);
  assert.equal(rolesPayload.embeds[1].data.title, "Activity Panel • Роли • Фокус");
  assert.deepEqual(rolesPayload.components[1].components.map((component) => component.data.custom_id), [
    "activity_panel_refresh_roles",
    "activity_panel_sync_roles",
  ]);
  assert.deepEqual(rolesPayload.components[1].components.map((component) => component.data.label), [
    "Обновить вид",
    "Только выдать роли",
  ]);
  assert.deepEqual(rolesPayload.components[2].components.map((component) => component.data.custom_id), [
    "activity_panel_config_access",
    "activity_panel_config_roles_primary",
    "activity_panel_config_roles_secondary",
    "activity_panel_inspect_user",
  ]);
  assert.deepEqual(rolesPayload.components[2].components.map((component) => component.data.label), [
    "Кто управляет",
    "Основные роли",
    "Доп. роли",
    "Проверить юзера",
  ]);
  const roleFieldTexts = rolesPayload.embeds[0].data.fields.map((field) => `${field.name}: ${field.value}`).join("\n");
  assert.match(roleFieldTexts, /Роль можно выдавать после \*\*3\*\* дней на сервере/);
  assert.match(roleFieldTexts, /Буст новичка: \*\*x1\.15\*\* -> x1\.00 к дню \*\*7\*\*/);
  assert.match(roleFieldTexts, /Привязано activity-ролей: \*\*2\*\*/);
  assert.match(roleFieldTexts, /Последний режим: \*\*Только выдача ролей по готовым данным\*\*/);
  assert.match(roleFieldTexts, /Полный цикл:/);
  assert.match(roleFieldTexts, /Только роли:/);
  assert.match(roleFieldTexts, /Модераторы Activity:/);
  assert.match(roleFieldTexts, /Основные:/);
  assert.match(roleFieldTexts, /Дополнительные:/);
  const roleDiagnosticTexts = rolesPayload.embeds[1].data.fields.map((field) => `${field.name}: ${field.value}`).join("\n");
  assert.match(roleDiagnosticTexts, /Что мешает выдаче/);
  assert.match(roleDiagnosticTexts, /пропущено: \*\*1\*\*/i);
  assert.match(roleDiagnosticTexts, /Причины пропуска/);
  assert.match(roleDiagnosticTexts, /уже совпадает: \*\*1\*\*/i);
  assert.match(roleDiagnosticTexts, /Нужен добор старой истории: \*\*1\*\*/);
  assert.match(roleDiagnosticTexts, /Canonical snapshots без local history: \*\*1\*\*/);
  assert.match(roleDiagnosticTexts, /Mirror-only persisted fallback: \*\*0\*\*/);
  assert.match(roleDiagnosticTexts, /Live holders без saved activity: \*\*0\*\*/);
  assert.match(roleDiagnosticTexts, /Противоречивых persisted states: \*\*0\*\*/);
  assert.match(roleDiagnosticTexts, /Есть 1 canonical snapshots без local history: roles-only sync безопасен, а полный rebuild требует import старой истории\./);

  const runtimePayload = buildActivityOperatorPanelPayload({
    db,
    view: "runtime",
  });
  assert.equal(runtimePayload.embeds[0].data.title, "Activity Panel • Процессы");
  assert.equal(runtimePayload.embeds.length, 2);
  assert.match(runtimePayload.embeds[0].data.description, /Статус раздела:/);
  assert.equal(runtimePayload.embeds[1].data.title, "Activity Panel • Процессы • Фокус");
  assert.deepEqual(runtimePayload.components[1].components.map((component) => component.data.custom_id), [
    "activity_panel_refresh_runtime",
    "activity_panel_rebuild_metrics",
    "activity_panel_inspect_user",
  ]);
  assert.deepEqual(runtimePayload.components[1].components.map((component) => component.data.label), [
    "Обновить вид",
    "Пересчитать и выдать",
    "Проверить юзера",
  ]);
  const runtimeFieldTexts = runtimePayload.embeds[0].data.fields.map((field) => `${field.name}: ${field.value}`).join("\n");
  assert.match(runtimeFieldTexts, /Проанализировано сообщений: \*\*12\*\*/);
  assert.match(runtimeFieldTexts, /Взвешенных сообщений: \*\*12\*\*/);
  assert.match(runtimeFieldTexts, /Итог flush: пересобрано 2, завершено сессий 1/);
  assert.match(runtimeFieldTexts, /Ошибок не зафиксировано\./);
  const runtimeDiagnosticTexts = runtimePayload.embeds[1].data.fields.map((field) => `${field.name}: ${field.value}`).join("\n");
  assert.match(runtimeDiagnosticTexts, /Полный пересчёт \+ выдача:/);
  assert.match(runtimeDiagnosticTexts, /Canonical snapshots без local history: \*\*1\*\*/);
  assert.match(runtimeDiagnosticTexts, /Противоречивых persisted states: \*\*0\*\*/);
  assert.match(runtimeDiagnosticTexts, /Flush: пересобрано \*\*2\*\*, завершено сессий \*\*1\*\*/);
  assert.match(runtimeDiagnosticTexts, /Runtime ещё живой: дождись flush или просто обнови вид позже, если нужна финальная картина\./);
});

test("buildActivityOperatorPanelPayload surfaces ready-core startup health in the operator view", () => {
  const payload = buildActivityOperatorPanelPayload({
    db: {},
    startupHealth: {
      label: "degraded",
      completedAt: "2026-05-10T08:40:00.000Z",
      degraded: [
        {
          step: "resumeActivityRuntime",
          message: "activity snapshots require rebuild",
        },
      ],
    },
  });

  assert.match(payload.embeds[0].data.description, /Ready-core startup: \*\*DEGRADED\*\*/);
  const fieldTexts = payload.embeds[0].data.fields.map((field) => `${field.name}: ${field.value}`).join("\n");
  assert.match(fieldTexts, /Startup: Ready-core startup: \*\*DEGRADED\*\*/);
  assert.match(fieldTexts, /Degraded шагов: \*\*1\*\*/);
  const diagnosticTexts = payload.embeds[1].data.fields.map((field) => `${field.name}: ${field.value}`).join("\n");
  assert.match(diagnosticTexts, /Ready-core degraded: • resumeActivityRuntime: activity snapshots require rebuild/i);
});

test("buildActivityOperatorPanelPayload surfaces contradictory persisted mirror states even when snapshot index is empty", () => {
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
        watchedChannels: [
          {
            channelId: "main-1",
            channelType: "main_chat",
            enabled: true,
          },
        ],
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

  const payload = buildActivityOperatorPanelPayload({ db });
  const fieldTexts = payload.embeds[0].data.fields.map((field) => `${field.name}: ${field.value}`).join("\n");
  const overviewDiagnosticTexts = payload.embeds[1].data.fields.map((field) => `${field.name}: ${field.value}`).join("\n");

  assert.match(payload.embeds[0].data.description, /противоречивые persisted activity states/i);
  assert.match(fieldTexts, /Готовых snapshots: \*\*0\*\*/i);
  assert.match(fieldTexts, /Mirror-only persisted fallback: \*\*1\*\*/);
  assert.match(fieldTexts, /Противоречивых persisted states: \*\*1\*\*/);
  assert.match(overviewDiagnosticTexts, /Mirror-only persisted fallback: \*\*1\*\*/);
  assert.match(overviewDiagnosticTexts, /Противоречивых persisted states: \*\*1\*\*/);
  assert.match(overviewDiagnosticTexts, /inspect-user и rebuild\+sync/i);
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
      calls.push(["showModal", modal.data.custom_id, modal.data.title]);
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
  assert.deepEqual(calls[2], ["update", { content: "channels|Вид обновлён." }]);

  interaction.customId = "activity_panel_config_access";
  const handledAccessConfig = await handleActivityPanelButtonInteraction(buildArgs());

  assert.equal(handledAccessConfig, true);
  assert.deepEqual(calls[3], ["showModal", "activity_panel_config_access_modal", "Кто управляет Activity"]);

  interaction.customId = "activity_panel_config_roles_primary";
  const handledPrimaryRoleConfig = await handleActivityPanelButtonInteraction(buildArgs());

  assert.equal(handledPrimaryRoleConfig, true);
  assert.deepEqual(calls[4], ["showModal", "activity_panel_config_roles_primary_modal", "Роли Activity • Основные"]);

  interaction.customId = "activity_panel_config_watch_save";
  const handledWatchSave = await handleActivityPanelButtonInteraction(buildArgs());

  assert.equal(handledWatchSave, true);
  assert.deepEqual(calls[5], ["showModal", "activity_panel_config_watch_save_modal", "Каналы для Activity"]);

  interaction.customId = "activity_panel_config_watch_remove";
  const handledWatchRemove = await handleActivityPanelButtonInteraction(buildArgs());

  assert.equal(handledWatchRemove, true);
  assert.deepEqual(calls[6], ["showModal", "activity_panel_config_watch_remove_modal", "Убрать канал из Activity"]);

  interaction.customId = "activity_panel_inspect_user";
  const handledInspectUser = await handleActivityPanelButtonInteraction(buildArgs());

  assert.equal(handledInspectUser, true);
  assert.deepEqual(calls[7], ["showModal", "activity_panel_inspect_user_modal", "Проверить пользователя"]);

  interaction.customId = "activity_panel_historical_import";
  const handledImport = await handleActivityPanelButtonInteraction(buildArgs());

  assert.equal(handledImport, true);
  assert.deepEqual(calls[8], ["deferUpdate"]);
  assert.deepEqual(calls[9], ["editReply", { content: "channels|Импорт истории завершён. Импортировано 4, пропущено 1. Все каналы обработаны без ошибок." }]);

  interaction.customId = "activity_panel_rebuild_metrics";
  const handledRebuild = await handleActivityPanelButtonInteraction(buildArgs());

  assert.equal(handledRebuild, true);
  assert.deepEqual(calls[10], ["deferUpdate"]);
  assert.deepEqual(calls[11], ["editReply", { content: "runtime|Полный пересчёт завершён. Пересобрано 3, роли применены 2, пропущено 1." }]);

  interaction.customId = "activity_panel_sync_roles";
  const handledSyncRoles = await handleActivityPanelButtonInteraction(buildArgs());

  assert.equal(handledSyncRoles, true);
  assert.deepEqual(calls[12], ["deferUpdate"]);
  assert.deepEqual(calls[13], ["editReply", { content: "roles|Выдача ролей по готовым данным завершена. Применено 4, пропущено 2. Score не пересчитывался." }]);

  interaction.customId = "activity_panel_back";
  const handledBack = await handleActivityPanelButtonInteraction(buildArgs());

  assert.equal(handledBack, true);
  assert.deepEqual(calls[14], ["update", { content: "main" }]);
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

test("handleActivityPanelButtonInteraction falls back to an ephemeral error when opening the panel throws", async () => {
  const replies = [];

  const handled = await handleActivityPanelButtonInteraction({
    interaction: {
      customId: "panel_open_activity",
      member: { id: "mod-1" },
      async reply(payload) {
        replies.push(payload);
      },
    },
    client: { id: "client" },
    db: {},
    isModerator: () => true,
    replyNoPermission: async () => {
      throw new Error("should not run");
    },
    buildModeratorPanelPayload: async () => ({ content: "main" }),
    buildActivityPanelPayload: () => {
      throw new Error("broken activity state");
    },
    runHistoricalImport: async () => ({ importedEntryCount: 0, ignoredEntryCount: 0 }),
    runRebuildMetrics: async () => ({ rebuiltUserCount: 0, roleAssignment: { appliedCount: 0, skippedCount: 0 } }),
    runSyncRoles: async () => ({ roleAssignment: { appliedCount: 0, skippedCount: 0 } }),
  });

  assert.equal(handled, true);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].flags, MessageFlags.Ephemeral);
  assert.match(replies[0].content, /Не удалось открыть Activity Panel/i);
  assert.match(replies[0].content, /broken activity state/i);
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
  assert.match(replies[0][1], /Доступ к Activity обновлён/);

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
  assert.match(replies[1][1], /Роли Activity обновлены/);
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
  assert.match(replies[0][1], /Каналы Activity сохранены/);

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
  assert.match(replies[1][1], /Канал убран из Activity/);
  assert.equal(saved.length, 2);
});

test("handleActivityPanelModalSubmitInteraction returns a rich inspection payload for a requested user", async () => {
  const replies = [];
  const db = {
    profiles: {
      "123456789012345678": {
        userId: "123456789012345678",
        displayName: "Mirror User",
        domains: {
          activity: {
            activityScore: 31,
            baseActivityScore: 27,
            activityScoreMultiplier: 1.15,
            desiredActivityRoleKey: "weak",
            appliedActivityRoleKey: null,
            roleEligibilityStatus: "eligible",
            roleEligibleForActivityRole: true,
            messages7d: 12,
            messages30d: 48,
            messages90d: 75,
            sessions7d: 3,
            sessions30d: 9,
            sessions90d: 12,
            activeDays7d: 3,
            activeDays30d: 8,
            activeDays90d: 11,
            activeWatchedChannels30d: 2,
            weightedMessages30d: 52,
            globalEffectiveSessions30d: 9,
            effectiveActiveDays30d: 8,
            daysAbsent: 0,
            daysSinceGuildJoin: 5,
            guildJoinedAt: "2026-05-04T12:00:00.000Z",
            recalculatedAt: "2026-05-09T12:00:00.000Z",
            lastSeenAt: "2026-05-09T11:50:00.000Z",
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

  const handled = await handleActivityPanelModalSubmitInteraction({
    interaction: {
      customId: "activity_panel_inspect_user_modal",
      member: { id: "mod-1" },
      user: { id: "mod-1" },
      fields: {
        getTextInputValue(fieldId) {
          if (fieldId === "activity_inspect_user_id") return "<@123456789012345678>";
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
    replySuccess: async (_interaction, payload) => {
      replies.push(["success", payload]);
    },
    parseRequestedUserId(value) {
      const text = String(value || "").trim();
      const mentionMatch = text.match(/^<@!?(\d+)>$/);
      const candidate = mentionMatch ? mentionMatch[1] : text;
      return /^\d+$/.test(candidate) ? candidate : "";
    },
    resolveMemberRoleIds() {
      return ["role-weak", "role-extra"];
    },
  });

  assert.equal(handled, true);
  assert.equal(replies.length, 1);
  assert.equal(replies[0][0], "success");
  assert.equal(Array.isArray(replies[0][1].embeds), true);
  assert.equal(replies[0][1].embeds.length, 2);
  assert.match(replies[0][1].embeds[0].data.title, /Mirror User/);
  const inspectionText = replies[0][1].embeds[0].data.fields.map((field) => `${field.name}: ${field.value}`).join("\n");
  assert.match(inspectionText, /profile mirror/i);
  assert.match(inspectionText, /roles-only sync/i);
  assert.match(inspectionText, /<@&role-weak>/);
});

test("handleActivityPanelModalSubmitInteraction returns validation error for bad inspect-user input", async () => {
  const replies = [];

  const handled = await handleActivityPanelModalSubmitInteraction({
    interaction: {
      customId: "activity_panel_inspect_user_modal",
      member: { id: "mod-1" },
      user: { id: "mod-1" },
      fields: {
        getTextInputValue(fieldId) {
          if (fieldId === "activity_inspect_user_id") return "not-a-user";
          return "";
        },
      },
    },
    db: {},
    isModerator: () => true,
    replyNoPermission: async () => {
      throw new Error("should not run");
    },
    replyError: async (_interaction, text) => {
      replies.push(["error", text]);
    },
    replySuccess: async () => {
      throw new Error("should not run");
    },
    parseRequestedUserId() {
      return "";
    },
  });

  assert.equal(handled, true);
  assert.deepEqual(replies, [["error", "Некорректный user input. Используй Discord user ID или <@...>."]]);
});

test("handleActivityPanelModalSubmitInteraction defers modal replies before slow work and finishes with editReply", async () => {
  const db = {};
  const calls = [];

  const handled = await handleActivityPanelModalSubmitInteraction({
    interaction: {
      customId: "activity_panel_config_watch_save_modal",
      member: { id: "mod-1" },
      user: { id: "mod-1" },
      deferred: false,
      replied: false,
      fields: {
        getTextInputValue(fieldId) {
          if (fieldId === "activity_watch_channel_list") return "123456789012345678";
          return "";
        },
      },
      async deferReply(options) {
        calls.push(["deferReply", options]);
        this.deferred = true;
      },
      async editReply(payload) {
        calls.push(["editReply", payload]);
      },
    },
    db,
    isModerator: () => true,
    replyNoPermission: async () => {
      throw new Error("should not run");
    },
    replyError: async () => {
      calls.push(["replyError"]);
    },
    replySuccess: async () => {
      calls.push(["replySuccess"]);
    },
    parseRequestedChannelId(value) {
      return String(value || "").trim();
    },
    async resolveChannel(channelId) {
      calls.push(["resolveChannel", channelId]);
      return {
        id: channelId,
        name: "main-chat",
        guildId: "guild-1",
        isTextBased() {
          return true;
        },
      };
    },
  });

  assert.equal(handled, true);
  assert.deepEqual(calls[0], ["deferReply", { flags: MessageFlags.Ephemeral }]);
  assert.deepEqual(calls[1], ["resolveChannel", "123456789012345678"]);
  assert.equal(calls[2][0], "editReply");
  assert.match(calls[2][1].content, /Каналы Activity сохранены/);
  assert.equal(calls.some(([type]) => type === "replyError" || type === "replySuccess"), false);
});