"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { MessageFlags } = require("discord.js");

const {
  VERIFY_ENTRY_START_ID,
  VERIFY_ENTRY_STATUS_ID,
  VERIFY_ENTRY_GUIDE_ID,
  VERIFY_PANEL_BACK_ID,
  VERIFY_PANEL_CONFIG_INFRA_ID,
  VERIFY_PANEL_CONFIG_INFRA_MODAL_ID,
  VERIFY_PANEL_CONFIG_RISK_ID,
  VERIFY_PANEL_CONFIG_RISK_MODAL_ID,
  VERIFY_PANEL_CONFIG_TEXTS_ID,
  VERIFY_PANEL_CONFIG_TEXTS_MODAL_ID,
  VERIFY_PANEL_RESEND_REPORT_ID,
  VERIFY_PANEL_RESEND_REPORT_MODAL_ID,
  VERIFY_PANEL_GUIDE_ID,
  VERIFY_PANEL_HOME_ID,
  VERIFY_PANEL_PUBLISH_ENTRY_ID,
  VERIFY_PANEL_QUEUE_ID,
  VERIFY_PANEL_REFRESH_ID,
  VERIFY_PANEL_RUN_SWEEP_ID,
  VERIFY_PANEL_RUNTIME_ID,
  buildVerificationEntryPayload,
  buildVerificationInfraConfigModal,
  buildVerificationGuidePayload,
  buildVerificationLaunchPayload,
  buildVerificationPanelPayload,
  buildVerificationQueuePayload,
  buildVerificationResendReportModal,
  buildVerificationRiskRulesModal,
  buildVerificationReportPayload,
  buildVerificationRuntimePayload,
  buildVerificationStageTextsModal,
  handleVerificationPanelButtonInteraction,
  handleVerificationPanelModalSubmitInteraction,
  parseVerificationReportAction,
} = require("../src/verification/operator");

test("buildVerificationPanelPayload summarizes autonomous verification config", () => {
  const payload = buildVerificationPanelPayload({
    integration: {
      enabled: true,
      status: "configured",
      verificationChannelId: "verify-room",
      reportChannelId: "report-room",
      stageTexts: {
        entry: "hello",
        warning: "warn",
      },
      riskRules: {
        enemyGuildIds: ["guild-1", "guild-2"],
        enemyUserIds: ["user-1"],
        enemyInviteCodes: ["code-1"],
        enemyInviterUserIds: [],
        manualTags: ["flag-a", "flag-b", "flag-a"],
      },
      deadline: {
        pendingDays: 7,
      },
    },
    verifyRoleId: "verify-role",
    accessRoleId: "base-role",
    wartimeAccessRoleId: "wartime-role",
    oauthConfigured: true,
    snapshot: {
      totals: {
        pending: 3,
        manualReview: 1,
        overdue: 2,
        verified: 4,
        rejected: 1,
      },
      runtime: {
        callbackReady: true,
        joinGateReady: true,
        entryMessagePublished: true,
        reportChannelReady: true,
      },
    },
  });

  const navRow = payload.components[0].toJSON().components;
  const actionRow = payload.components[1].toJSON().components;
  const configRow = payload.components[2].toJSON().components;
  assert.equal(navRow[0].custom_id, VERIFY_PANEL_HOME_ID);
  assert.equal(navRow[1].custom_id, VERIFY_PANEL_QUEUE_ID);
  assert.equal(navRow[2].custom_id, VERIFY_PANEL_RUNTIME_ID);
  assert.equal(navRow[3].custom_id, VERIFY_PANEL_GUIDE_ID);
  assert.equal(navRow[4].custom_id, VERIFY_PANEL_BACK_ID);
  assert.equal(actionRow[0].custom_id, VERIFY_PANEL_REFRESH_ID);
  assert.equal(actionRow[1].custom_id, VERIFY_PANEL_PUBLISH_ENTRY_ID);
  assert.equal(actionRow[2].custom_id, VERIFY_PANEL_RUN_SWEEP_ID);
  assert.equal(configRow[0].custom_id, VERIFY_PANEL_CONFIG_INFRA_ID);
  assert.equal(configRow[1].custom_id, VERIFY_PANEL_CONFIG_RISK_ID);
  assert.equal(configRow[2].custom_id, VERIFY_PANEL_CONFIG_TEXTS_ID);
  assert.equal(configRow[3].custom_id, VERIFY_PANEL_RESEND_REPORT_ID);
  assert.equal(payload.embeds[0].data.title, "Панель проверки доступа");
  assert.match(payload.embeds[0].data.fields[1].value, /Ожидают проверки: \*\*3\*\*/);
  assert.match(payload.embeds[0].data.fields[2].value, /<@&verify-role>/);
  assert.match(payload.embeds[0].data.fields[3].value, /Вражеские серверы: \*\*2\*\*/);
  assert.match(payload.embeds[0].data.fields[5].value, /7 дн\./);
});

test("buildVerificationEntryPayload exposes user-facing OAuth and status buttons", () => {
  const payload = buildVerificationEntryPayload({
    integration: {
      stageTexts: {
        entry: "Пройди отдельную проверку.",
      },
      deadline: {
        pendingDays: 7,
      },
    },
    statusText: "Система готова.",
  });

  const row = payload.components[0].toJSON().components;
  assert.equal(payload.embeds[0].data.title, "Проверка доступа");
  assert.equal(row[0].custom_id, VERIFY_ENTRY_START_ID);
  assert.equal(row[1].custom_id, VERIFY_ENTRY_STATUS_ID);
  assert.equal(row[2].custom_id, VERIFY_ENTRY_GUIDE_ID);
  assert.match(payload.embeds[0].data.description, /7 дн\./);
});

test("buildVerificationGuidePayload returns separate moderator and participant guides", () => {
  const moderatorPayload = buildVerificationGuidePayload({
    audience: "moderator",
    integration: {
      deadline: { pendingDays: 7 },
    },
    snapshot: {
      totals: { pending: 4, manualReview: 2, overdue: 1 },
    },
  });
  const participantPayload = buildVerificationGuidePayload({
    audience: "participant",
    integration: {
      deadline: { pendingDays: 7 },
      stageTexts: {
        approved: "роль будет выдана",
        rejected: "роль не будет выдана",
      },
    },
  });

  assert.equal(moderatorPayload.embeds[0].data.title, "Инструкция для модераторов");
  assert.equal(participantPayload.embeds[0].data.title, "Как пройти проверку");
  assert.equal(participantPayload.components[0].toJSON().components[0].custom_id, VERIFY_ENTRY_START_ID);
  assert.match(moderatorPayload.embeds[0].data.description, /ожидают 4/i);
  assert.match(participantPayload.embeds[0].data.description, /7 дн\./);
});

test("buildVerificationQueuePayload and buildVerificationRuntimePayload expose queue and runtime views", () => {
  const queuePayload = buildVerificationQueuePayload({
    snapshot: {
      totals: {
        pending: 2,
        manualReview: 1,
        failed: 1,
        overdue: 1,
        blocked: 3,
      },
      queueEntries: [
        "<@1> • pending • due 10.05",
        "<@2> • manual_review • due 11.05",
      ],
    },
  });
  const runtimePayload = buildVerificationRuntimePayload({
    integration: {
      entryMessage: {
        channelId: "verify-room",
        messageId: "message-1",
      },
    },
    snapshot: {
      runtime: {
        callbackReady: true,
        verifyRoleReady: true,
        verificationRoomReady: true,
        reportChannelReady: false,
        entryMessagePublished: true,
        entryMessageChannelId: "verify-room",
        entryMessageId: "message-1",
      },
      issues: ["report channel missing"],
    },
  });

  assert.equal(queuePayload.embeds[0].data.title, "Очередь проверки");
  assert.match(queuePayload.embeds[0].data.fields[1].value, /<@1>/);
  assert.equal(runtimePayload.embeds[0].data.title, "Состояние системы");
  assert.match(runtimePayload.embeds[0].data.fields[0].value, /Канал отчётов: \*\*не настроен\*\*/i);
  assert.match(runtimePayload.embeds[0].data.fields[2].value, /не настроен канал отчётов/i);
});

test("verification config modals expose infra, risk, and stage editors", () => {
  const infraModal = buildVerificationInfraConfigModal({
    integration: {
      enabled: true,
      callbackBaseUrl: "https://example.com/callback",
      verificationChannelId: "111",
      reportChannelId: "222",
    },
    verifyRoleId: "333",
  }).toJSON();
  const riskModal = buildVerificationRiskRulesModal({
    integration: {
      riskRules: {
        enemyGuildIds: ["guild-1"],
        manualTags: ["flag-a"],
      },
    },
  }).toJSON();
  const textsModal = buildVerificationStageTextsModal({
    integration: {
      stageTexts: {
        entry: "entry text",
      },
      deadline: {
        pendingDays: 9,
      },
    },
  }).toJSON();
  const resendModal = buildVerificationResendReportModal().toJSON();

  assert.equal(infraModal.custom_id, VERIFY_PANEL_CONFIG_INFRA_MODAL_ID);
  assert.equal(riskModal.custom_id, VERIFY_PANEL_CONFIG_RISK_MODAL_ID);
  assert.equal(textsModal.custom_id, VERIFY_PANEL_CONFIG_TEXTS_MODAL_ID);
  assert.equal(resendModal.custom_id, VERIFY_PANEL_RESEND_REPORT_MODAL_ID);
  assert.equal(infraModal.components.length, 5);
  assert.equal(riskModal.components.length, 5);
  assert.equal(textsModal.components.length, 5);
  assert.equal(resendModal.components.length, 2);
});

test("buildVerificationLaunchPayload returns a link button for Discord OAuth", () => {
  const payload = buildVerificationLaunchPayload({
    authorizeUrl: "https://discord.com/oauth2/authorize?state=abc",
  });

  const row = payload.components[0].toJSON().components;
  assert.equal(row[0].style, 5);
  assert.equal(row[0].url, "https://discord.com/oauth2/authorize?state=abc");
  assert.equal(row[1].custom_id, VERIFY_ENTRY_STATUS_ID);
});

test("buildVerificationReportPayload and parseVerificationReportAction round-trip manual actions", () => {
  const payload = buildVerificationReportPayload({
    userId: "user-1",
    profile: {
      userId: "user-1",
      domains: {
        verification: {
          status: "manual_review",
          decision: "manual_review",
          oauthUsername: "discord-user",
          reportDueAt: "2026-05-08T10:00:00.000Z",
          observedGuilds: [
            { id: "guild-10", name: "Enemy Nest", owner: true, permissions: "8" },
            { id: "guild-11", name: "Side Guild", owner: false, permissions: "1024" },
          ],
          matchedEnemyGuildIds: ["guild-1"],
          matchedEnemyUserIds: ["user-2"],
          matchedEnemyInviteCodes: ["invite-1"],
          matchedEnemyInviterUserIds: ["inviter-1"],
        },
      },
      summary: {
        verification: {
          oauthUsername: "discord-user",
          observedGuildCount: 3,
          matchedEnemyGuildCount: 1,
          matchedEnemyUserCount: 1,
          matchedEnemyInviteCount: 1,
          matchedEnemyInviterCount: 1,
          manualTagCount: 0,
          status: "manual_review",
          decision: "manual_review",
          reportDueAt: "2026-05-08T10:00:00.000Z",
        },
      },
    },
  });

  const row = payload.components[0].toJSON().components;
  const observedGuildField = payload.embeds[0].data.fields.find((field) => field.name === "Замеченные серверы OAuth");
  assert.equal(payload.embeds[0].data.title, "Ручная проверка доступа");
  assert.match(observedGuildField.value, /Enemy Nest/);
  assert.match(observedGuildField.value, /guild-10/);
  assert.deepEqual(parseVerificationReportAction(row[0].custom_id), { action: "approve", userId: "user-1" });
  assert.deepEqual(parseVerificationReportAction(row[1].custom_id), { action: "reject", userId: "user-1" });
});

test("handleVerificationPanelButtonInteraction routes panel views and runtime actions", async () => {
  const calls = [];
  const interaction = {
    customId: VERIFY_PANEL_RUN_SWEEP_ID,
    member: { id: "moderator" },
    async deferUpdate() {
      calls.push(["deferUpdate"]);
    },
    async editReply(payload) {
      calls.push(["editReply", payload]);
    },
    async update(payload) {
      calls.push(["update", payload]);
    },
  };

  const handled = await handleVerificationPanelButtonInteraction({
    interaction,
    isModerator: () => true,
    replyNoPermission: async () => {
      calls.push(["replyNoPermission"]);
    },
    buildView: async (view, statusText) => ({ view, statusText }),
    buildBackPayload: async () => ({ back: true }),
    runAction: async (action) => {
      calls.push(["runAction", action]);
      return "Sweep finished.";
    },
  });

  assert.equal(handled, true);
  assert.deepEqual(calls[0], ["deferUpdate"]);
  assert.deepEqual(calls[1], ["runAction", VERIFY_PANEL_RUN_SWEEP_ID]);
  assert.deepEqual(calls[2], ["editReply", { view: "runtime", statusText: "Sweep finished." }]);
});

test("handleVerificationPanelButtonInteraction opens config modal actions", async () => {
  const calls = [];
  const interaction = {
    customId: VERIFY_PANEL_CONFIG_INFRA_ID,
    member: { id: "moderator" },
    async showModal(modal) {
      calls.push(["showModal", modal]);
    },
  };

  const handled = await handleVerificationPanelButtonInteraction({
    interaction,
    isModerator: () => true,
    replyNoPermission: async () => {},
    buildView: async () => ({}),
    buildBackPayload: async () => ({}),
    buildModal: async (customId) => ({ customId }),
    runAction: async () => "",
  });

  assert.equal(handled, true);
  assert.deepEqual(calls[0], ["showModal", { customId: VERIFY_PANEL_CONFIG_INFRA_ID }]);
});

test("handleVerificationPanelModalSubmitInteraction defers modal replies before slow runtime work and finishes with editReply", async () => {
  const calls = [];

  const handled = await handleVerificationPanelModalSubmitInteraction({
    interaction: {
      customId: VERIFY_PANEL_CONFIG_INFRA_MODAL_ID,
      member: { id: "moderator" },
      deferred: false,
      replied: false,
      fields: {
        getTextInputValue(fieldId) {
          if (fieldId === "verification_enabled") return "да";
          if (fieldId === "verification_callback_base_url") return "https://example.com/callback";
          if (fieldId === "verification_verify_role") return "123";
          if (fieldId === "verification_room_channel") return "456";
          if (fieldId === "verification_report_channel") return "789";
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
    client: { id: "client" },
    isModerator: () => true,
    replyNoPermission: async () => {
      throw new Error("should not run");
    },
    buildPanelReply: async (view, statusText) => ({ view, statusText }),
    getCurrentIntegration: () => ({ enabled: false, verificationChannelId: "old-channel" }),
    parseBooleanInput: () => true,
    parseListInput: () => [],
    parseRequestedRoleId: (value) => String(value || "").trim(),
    parseRequestedChannelId: (value) => String(value || "").trim(),
    parseRequestedUserId: (value) => String(value || "").trim(),
    cleanText: (value) => String(value || "").trim(),
    nowIso: () => "2026-05-10T00:00:00.000Z",
    writeIntegrationSnapshot: (patch) => {
      calls.push(["writeIntegrationSnapshot", patch]);
    },
    writeVerifyRole: (roleId) => {
      calls.push(["writeVerifyRole", roleId]);
    },
    clearVerifyRole: () => {
      calls.push(["clearVerifyRole"]);
    },
    saveDb: () => {
      calls.push(["saveDb"]);
    },
    startRuntime: async (client) => {
      calls.push(["startRuntime", client]);
      return {
        callbackStarted: true,
        entryPublished: true,
      };
    },
    ensureEntryMessage: async () => {
      calls.push(["ensureEntryMessage"]);
    },
    ensurePendingProfile: () => {
      calls.push(["ensurePendingProfile"]);
    },
    postManualReport: async () => {
      calls.push(["postManualReport"]);
      return { channel: { id: "report-room" }, profile: { domains: { verification: {} } } };
    },
    updateProfile: () => {
      calls.push(["updateProfile"]);
    },
    computeReportDueAt: () => "2026-05-17T00:00:00.000Z",
  });

  assert.equal(handled, true);
  assert.deepEqual(calls[0], ["deferReply", { flags: MessageFlags.Ephemeral }]);
  assert.deepEqual(calls[1][0], "writeIntegrationSnapshot");
  assert.deepEqual(calls[2], ["writeVerifyRole", "123"]);
  assert.deepEqual(calls[3], ["saveDb"]);
  assert.deepEqual(calls[4], ["startRuntime", { id: "client" }]);
  assert.deepEqual(calls[5], ["editReply", {
    view: "runtime",
    statusText: "Базовые настройки проверки сохранены. Система: callback готов, входное сообщение опубликовано."
  }]);
});

test("handleVerificationPanelModalSubmitInteraction publishes entry message immediately after channel binding", async () => {
  const calls = [];

  const handled = await handleVerificationPanelModalSubmitInteraction({
    interaction: {
      customId: VERIFY_PANEL_CONFIG_INFRA_MODAL_ID,
      member: { id: "moderator" },
      fields: {
        getTextInputValue(fieldId) {
          if (fieldId === "verification_enabled") return "нет";
          if (fieldId === "verification_callback_base_url") return "";
          if (fieldId === "verification_verify_role") return "123";
          if (fieldId === "verification_room_channel") return "456";
          if (fieldId === "verification_report_channel") return "789";
          return "";
        },
      },
      async deferReply(options) {
        calls.push(["deferReply", options]);
      },
      async editReply(payload) {
        calls.push(["editReply", payload]);
      },
    },
    client: { id: "client" },
    isModerator: () => true,
    replyNoPermission: async () => {
      throw new Error("should not run");
    },
    buildPanelReply: async (view, statusText) => ({ view, statusText }),
    getCurrentIntegration: () => ({ enabled: false, verificationChannelId: "old-channel" }),
    parseBooleanInput: () => false,
    parseListInput: () => [],
    parseRequestedRoleId: (value) => String(value || "").trim(),
    parseRequestedChannelId: (value) => String(value || "").trim(),
    parseRequestedUserId: (value) => String(value || "").trim(),
    cleanText: (value) => String(value || "").trim(),
    nowIso: () => "2026-05-10T00:00:00.000Z",
    writeIntegrationSnapshot: (patch) => {
      calls.push(["writeIntegrationSnapshot", patch]);
    },
    writeVerifyRole: (roleId) => {
      calls.push(["writeVerifyRole", roleId]);
    },
    clearVerifyRole: () => {
      calls.push(["clearVerifyRole"]);
    },
    saveDb: () => {
      calls.push(["saveDb"]);
    },
    startRuntime: async () => {
      calls.push(["startRuntime"]);
      return {
        callbackStarted: false,
        entryPublished: false,
      };
    },
    ensureEntryMessage: async () => {
      calls.push(["ensureEntryMessage"]);
    },
    ensurePendingProfile: () => {},
    postManualReport: async () => ({ channel: { id: "report-room" }, profile: { domains: { verification: {} } } }),
    updateProfile: () => {},
    computeReportDueAt: () => "2026-05-17T00:00:00.000Z",
  });

  assert.equal(handled, true);
  assert.equal(calls.some(([name]) => name === "startRuntime"), false);
  assert.equal(calls.some(([name]) => name === "ensureEntryMessage"), true);
  assert.deepEqual(calls.at(-1), ["editReply", {
    view: "runtime",
    statusText: "Базовые настройки проверки сохранены. Входное сообщение опубликовано в канале проверки."
  }]);
});