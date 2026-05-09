"use strict";

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

const VERIFY_COMMAND_NAME = "verify";
const VERIFY_SUBCOMMAND_NAMES = ["panel"];
const VERIFY_PANEL_REFRESH_ID = "verification_panel_refresh";
const VERIFY_PANEL_HOME_ID = "verification_panel_home";
const VERIFY_PANEL_QUEUE_ID = "verification_panel_queue";
const VERIFY_PANEL_RUNTIME_ID = "verification_panel_runtime";
const VERIFY_PANEL_GUIDE_ID = "verification_panel_guide";
const VERIFY_PANEL_PUBLISH_ENTRY_ID = "verification_panel_publish_entry";
const VERIFY_PANEL_RUN_SWEEP_ID = "verification_panel_run_sweep";
const VERIFY_PANEL_BACK_ID = "verification_panel_back";
const VERIFY_PANEL_CONFIG_INFRA_ID = "verification_panel_config_infra";
const VERIFY_PANEL_CONFIG_RISK_ID = "verification_panel_config_risk";
const VERIFY_PANEL_CONFIG_TEXTS_ID = "verification_panel_config_texts";
const VERIFY_PANEL_RESEND_REPORT_ID = "verification_panel_resend_report";
const VERIFY_ENTRY_START_ID = "verification_begin";
const VERIFY_ENTRY_STATUS_ID = "verification_status";
const VERIFY_ENTRY_GUIDE_ID = "verification_entry_guide";
const VERIFY_REPORT_APPROVE_PREFIX = "verification_report_approve:";
const VERIFY_REPORT_REJECT_PREFIX = "verification_report_reject:";

const VERIFY_PANEL_CONFIG_INFRA_MODAL_ID = "verification_panel_config_infra_modal";
const VERIFY_PANEL_CONFIG_RISK_MODAL_ID = "verification_panel_config_risk_modal";
const VERIFY_PANEL_CONFIG_TEXTS_MODAL_ID = "verification_panel_config_texts_modal";
const VERIFY_PANEL_RESEND_REPORT_MODAL_ID = "verification_panel_resend_report_modal";

const VERIFY_PANEL_BUTTON_IDS = Object.freeze([
  VERIFY_PANEL_REFRESH_ID,
  VERIFY_PANEL_HOME_ID,
  VERIFY_PANEL_QUEUE_ID,
  VERIFY_PANEL_RUNTIME_ID,
  VERIFY_PANEL_GUIDE_ID,
  VERIFY_PANEL_PUBLISH_ENTRY_ID,
  VERIFY_PANEL_RUN_SWEEP_ID,
  VERIFY_PANEL_BACK_ID,
  VERIFY_PANEL_CONFIG_INFRA_ID,
  VERIFY_PANEL_CONFIG_RISK_ID,
  VERIFY_PANEL_CONFIG_TEXTS_ID,
  VERIFY_PANEL_RESEND_REPORT_ID,
]);

const VERIFY_PANEL_MODAL_IDS = Object.freeze([
  VERIFY_PANEL_CONFIG_INFRA_MODAL_ID,
  VERIFY_PANEL_CONFIG_RISK_MODAL_ID,
  VERIFY_PANEL_CONFIG_TEXTS_MODAL_ID,
  VERIFY_PANEL_RESEND_REPORT_MODAL_ID,
]);

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function normalizeStringArray(value, limit = 500, itemLimit = 120) {
  if (!Array.isArray(value)) return [];
  const normalized = [];
  const seen = new Set();
  for (const entry of value) {
    const text = cleanString(entry, itemLimit);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    normalized.push(text);
    if (normalized.length >= limit) break;
  }
  return normalized;
}

function formatRoleMention(roleId) {
  const value = cleanString(roleId, 80);
  return value ? `<@&${value}>` : "не настроена";
}

function formatChannelMention(channelId) {
  const value = cleanString(channelId, 80);
  return value ? `<#${value}>` : "не настроен";
}

function countRiskItems(riskRules = {}, key) {
  return normalizeStringArray(riskRules?.[key]).length;
}

function formatDateTime(value) {
  const timestamp = Date.parse(value || "");
  if (!Number.isFinite(timestamp)) return "—";
  return new Date(timestamp).toLocaleString("ru-RU");
}

function formatCount(value) {
  return `**${Math.max(0, Number(value) || 0)}**`;
}

function normalizeVerificationSnapshot(value = {}) {
  const snapshot = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const totals = snapshot.totals && typeof snapshot.totals === "object" && !Array.isArray(snapshot.totals)
    ? snapshot.totals
    : {};
  const runtime = snapshot.runtime && typeof snapshot.runtime === "object" && !Array.isArray(snapshot.runtime)
    ? snapshot.runtime
    : {};

  return {
    totals: {
      pending: Math.max(0, Number(totals.pending) || 0),
      manualReview: Math.max(0, Number(totals.manualReview) || 0),
      failed: Math.max(0, Number(totals.failed) || 0),
      overdue: Math.max(0, Number(totals.overdue) || 0),
      verified: Math.max(0, Number(totals.verified) || 0),
      rejected: Math.max(0, Number(totals.rejected) || 0),
      blocked: Math.max(0, Number(totals.blocked) || 0),
      reportSent: Math.max(0, Number(totals.reportSent) || 0),
      totalProfiles: Math.max(0, Number(totals.totalProfiles) || 0),
    },
    queueEntries: normalizeStringArray(snapshot.queueEntries, 12, 200),
    issues: normalizeStringArray(snapshot.issues, 12, 200),
    runtime: {
      callbackReady: runtime.callbackReady === true,
      joinGateReady: runtime.joinGateReady === true,
      entryMessagePublished: runtime.entryMessagePublished === true,
      reportChannelReady: runtime.reportChannelReady === true,
      verificationRoomReady: runtime.verificationRoomReady === true,
      verifyRoleReady: runtime.verifyRoleReady === true,
      lastSweepAt: cleanString(runtime.lastSweepAt, 80),
      lastReportSentAt: cleanString(runtime.lastReportSentAt, 80),
      entryMessageChannelId: cleanString(runtime.entryMessageChannelId, 80),
      entryMessageId: cleanString(runtime.entryMessageId, 80),
    },
  };
}

function buildVerificationPanelNavRow(currentView = "home") {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(VERIFY_PANEL_HOME_ID).setLabel("Home").setStyle(currentView === "home" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(VERIFY_PANEL_QUEUE_ID).setLabel("Queue").setStyle(currentView === "queue" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(VERIFY_PANEL_RUNTIME_ID).setLabel("Runtime").setStyle(currentView === "runtime" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(VERIFY_PANEL_GUIDE_ID).setLabel("Guide").setStyle(currentView === "guide" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(VERIFY_PANEL_BACK_ID).setLabel("Назад").setStyle(ButtonStyle.Secondary)
  );
}

function buildVerificationPanelActionRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(VERIFY_PANEL_REFRESH_ID).setLabel("Обновить").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(VERIFY_PANEL_PUBLISH_ENTRY_ID).setLabel("Переопубликовать entry").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(VERIFY_PANEL_RUN_SWEEP_ID).setLabel("Запустить sweep").setStyle(ButtonStyle.Secondary)
  );
}

function buildVerificationPanelConfigRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(VERIFY_PANEL_CONFIG_INFRA_ID).setLabel("Infra").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(VERIFY_PANEL_CONFIG_RISK_ID).setLabel("Risk rules").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(VERIFY_PANEL_CONFIG_TEXTS_ID).setLabel("Stage texts").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(VERIFY_PANEL_RESEND_REPORT_ID).setLabel("Resend report").setStyle(ButtonStyle.Secondary)
  );
}

function normalizeModalValue(value, fallback = "", limit = 4000) {
  const text = cleanString(value, limit);
  return text || cleanString(fallback, limit);
}

function buildVerificationInfraConfigModal(options = {}) {
  const integration = options.integration && typeof options.integration === "object" && !Array.isArray(options.integration)
    ? options.integration
    : {};

  return new ModalBuilder()
    .setCustomId(VERIFY_PANEL_CONFIG_INFRA_MODAL_ID)
    .setTitle("Verification Infra")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("verification_enabled")
          .setLabel("Enabled (yes/no)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(10)
          .setValue(integration.enabled === true ? "yes" : "no")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("verification_callback_base_url")
          .setLabel("Callback URL")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(500)
          .setValue(normalizeModalValue(integration.callbackBaseUrl, ""))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("verification_verify_role")
          .setLabel("Verify role ID or mention")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(80)
          .setValue(normalizeModalValue(options.verifyRoleId, ""))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("verification_room_channel")
          .setLabel("Verification room channel")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(80)
          .setValue(normalizeModalValue(integration.verificationChannelId, ""))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("verification_report_channel")
          .setLabel("Report channel")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(80)
          .setValue(normalizeModalValue(integration.reportChannelId, ""))
      )
    );
}

function buildVerificationRiskRulesModal(options = {}) {
  const integration = options.integration && typeof options.integration === "object" && !Array.isArray(options.integration)
    ? options.integration
    : {};
  const riskRules = integration.riskRules && typeof integration.riskRules === "object" && !Array.isArray(integration.riskRules)
    ? integration.riskRules
    : {};
  const joinLines = (value) => normalizeStringArray(value, 100, 120).join("\n");

  return new ModalBuilder()
    .setCustomId(VERIFY_PANEL_CONFIG_RISK_MODAL_ID)
    .setTitle("Verification Risk Rules")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("verification_enemy_guild_ids")
          .setLabel("Enemy guild IDs")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(4000)
          .setValue(joinLines(riskRules.enemyGuildIds))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("verification_enemy_user_ids")
          .setLabel("Enemy user IDs")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(4000)
          .setValue(joinLines(riskRules.enemyUserIds))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("verification_enemy_invite_codes")
          .setLabel("Enemy invite codes")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(4000)
          .setValue(joinLines(riskRules.enemyInviteCodes))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("verification_enemy_inviter_user_ids")
          .setLabel("Enemy inviter user IDs")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(4000)
          .setValue(joinLines(riskRules.enemyInviterUserIds))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("verification_manual_tags")
          .setLabel("Manual tags")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(4000)
          .setValue(joinLines(riskRules.manualTags))
      )
    );
}

function buildVerificationStageTextsModal(options = {}) {
  const integration = options.integration && typeof options.integration === "object" && !Array.isArray(options.integration)
    ? options.integration
    : {};
  const stageTexts = integration.stageTexts && typeof integration.stageTexts === "object" && !Array.isArray(integration.stageTexts)
    ? integration.stageTexts
    : {};

  return new ModalBuilder()
    .setCustomId(VERIFY_PANEL_CONFIG_TEXTS_MODAL_ID)
    .setTitle("Verification Stage Texts")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("verification_stage_entry")
          .setLabel("Entry text")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(4000)
          .setValue(normalizeModalValue(stageTexts.entry, ""))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("verification_stage_manual_review")
          .setLabel("Manual review text")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(4000)
          .setValue(normalizeModalValue(stageTexts.manualReview, ""))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("verification_stage_approved")
          .setLabel("Approved text")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(4000)
          .setValue(normalizeModalValue(stageTexts.approved, ""))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("verification_stage_rejected")
          .setLabel("Rejected text")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(4000)
          .setValue(normalizeModalValue(stageTexts.rejected, ""))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("verification_pending_days")
          .setLabel("Pending days")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(10)
          .setValue(String(Math.max(1, Number(integration.deadline?.pendingDays) || 7)))
      )
    );
}

function buildVerificationResendReportModal() {
  return new ModalBuilder()
    .setCustomId(VERIFY_PANEL_RESEND_REPORT_MODAL_ID)
    .setTitle("Verification Resend Report")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("verification_resend_user")
          .setLabel("Target user ID or mention")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(80)
          .setPlaceholder("123456789012345678")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("verification_resend_note")
          .setLabel("Moderator note")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(1000)
          .setValue("Ручной resend verification report.")
      )
    );
}

function buildParticipantGuideText(integration = {}) {
  return [
    "1. Зайди в verification room и нажми кнопку OAuth.",
    "2. Авторизуйся тем же Discord-аккаунтом, который находится на сервере.",
    "3. После callback бот либо сразу снимет verify-role, либо отправит кейс модераторам.",
    `4. Если автоматическое решение не получится, тебя оставят в очереди до ручной проверки и дедлайна **${Math.max(1, Number(integration.deadline?.pendingDays) || 7)} дн.**.`,
    `5. После approve применяется текст: ${cleanString(integration.stageTexts?.approved, 200) || "бот снимет verify-role и выдаст стартовый доступ."}`,
    `6. После reject применяется текст: ${cleanString(integration.stageTexts?.rejected, 200) || "доступ не будет выдан."}`,
  ].join("\n");
}

function buildModeratorGuideText(integration = {}, snapshot = {}) {
  const normalizedSnapshot = normalizeVerificationSnapshot(snapshot);
  return [
    "1. Home показывает readiness OAuth, verify-role, verification room и report channel.",
    "2. Queue показывает текущие состояния участников: pending, manual review, failed, overdue.",
    "3. Runtime actions нужны для republish entry message и ручного запуска overdue sweep.",
    "4. Manual review report остаётся местом для approve/reject, а панель должна давать ту же картину по очереди.",
    `5. Сейчас в queue: pending ${normalizedSnapshot.totals.pending}, manual review ${normalizedSnapshot.totals.manualReview}, overdue ${normalizedSnapshot.totals.overdue}.`,
    `6. Дедлайн escalation: ${Math.max(1, Number(integration.deadline?.pendingDays) || 7)} дн. без auto-kick.`
  ].join("\n");
}

function buildVerificationEntryPayload(options = {}) {
  const integration = options.integration && typeof options.integration === "object" && !Array.isArray(options.integration)
    ? options.integration
    : {};
  const deadline = integration.deadline && typeof integration.deadline === "object" && !Array.isArray(integration.deadline)
    ? integration.deadline
    : {};
  const entryText = cleanString(integration.stageTexts?.entry, 3000)
    || "Нажми кнопку ниже, открой Discord OAuth и дождись автоматического решения или модераторского отчёта.";
  const pendingDays = Math.max(1, Number(deadline.pendingDays) || 7);
  const statusText = cleanString(options.statusText, 1000);

  const embed = new EmbedBuilder()
    .setTitle("Verification Access")
    .setColor(0x2563EB)
    .setDescription([
      entryText,
      `Если система не сможет принять решение автоматически, через **${pendingDays} дн.** уйдёт отчёт модераторам.`,
    ].join("\n\n"));

  if (statusText) {
    embed.addFields({ name: "Статус", value: statusText, inline: false });
  }

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(VERIFY_ENTRY_START_ID).setLabel("Открыть OAuth").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(VERIFY_ENTRY_STATUS_ID).setLabel("Мой статус").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(VERIFY_ENTRY_GUIDE_ID).setLabel("Гайд").setStyle(ButtonStyle.Secondary)
      ),
    ],
  };
}

function buildVerificationGuidePayload(options = {}) {
  const audience = cleanString(options.audience, 40) === "participant" ? "participant" : "moderator";
  const integration = options.integration && typeof options.integration === "object" && !Array.isArray(options.integration)
    ? options.integration
    : {};
  const snapshot = normalizeVerificationSnapshot(options.snapshot);
  const statusText = cleanString(options.statusText, 1000);

  const embed = new EmbedBuilder()
    .setTitle(audience === "participant" ? "Verification Guide" : "Verification Moderator Guide")
    .setColor(audience === "participant" ? 0x2563EB : 0x0F766E)
    .setDescription(
      audience === "participant"
        ? buildParticipantGuideText(integration)
        : buildModeratorGuideText(integration, snapshot)
    );

  if (statusText) {
    embed.addFields({ name: "Статус", value: statusText, inline: false });
  }

  return {
    embeds: [embed],
    components: audience === "participant"
      ? [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(VERIFY_ENTRY_START_ID).setLabel("Открыть OAuth").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(VERIFY_ENTRY_STATUS_ID).setLabel("Мой статус").setStyle(ButtonStyle.Secondary)
          ),
        ]
      : [
          buildVerificationPanelNavRow("guide"),
          buildVerificationPanelActionRow(),
          buildVerificationPanelConfigRow(),
        ],
  };
}

function buildVerificationLaunchPayload(options = {}) {
  const authorizeUrl = cleanString(options.authorizeUrl, 2000);
  if (!authorizeUrl) {
    throw new Error("authorizeUrl обязателен для verification launch payload.");
  }

  const description = cleanString(options.description, 2000)
    || "Открой ссылку, авторизуйся через Discord и дождись страницы с результатом. После этого вернись на сервер.";

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("Verification OAuth")
        .setColor(0x2563EB)
        .setDescription(description),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Открыть Discord OAuth").setURL(authorizeUrl),
        new ButtonBuilder().setCustomId(VERIFY_ENTRY_STATUS_ID).setLabel("Обновить статус").setStyle(ButtonStyle.Secondary)
      ),
    ],
  };
}

function buildVerificationReportCustomId(action, userId) {
  const normalizedUserId = cleanString(userId, 80);
  if (!normalizedUserId) {
    throw new Error("userId обязателен для verification report action.");
  }
  if (action === "approve") return `${VERIFY_REPORT_APPROVE_PREFIX}${normalizedUserId}`;
  if (action === "reject") return `${VERIFY_REPORT_REJECT_PREFIX}${normalizedUserId}`;
  throw new Error("Неизвестное verification report action.");
}

function parseVerificationReportAction(customId) {
  const value = cleanString(customId, 200);
  if (value.startsWith(VERIFY_REPORT_APPROVE_PREFIX)) {
    return {
      action: "approve",
      userId: cleanString(value.slice(VERIFY_REPORT_APPROVE_PREFIX.length), 80),
    };
  }
  if (value.startsWith(VERIFY_REPORT_REJECT_PREFIX)) {
    return {
      action: "reject",
      userId: cleanString(value.slice(VERIFY_REPORT_REJECT_PREFIX.length), 80),
    };
  }
  return null;
}

function buildVerificationReportPayload(options = {}) {
  const profile = options.profile && typeof options.profile === "object" && !Array.isArray(options.profile)
    ? options.profile
    : {};
  const statusNote = cleanString(options.statusNote, 500);
  const disableActions = options.disableActions === true;
  const verification = profile.domains?.verification && typeof profile.domains.verification === "object"
    ? profile.domains.verification
    : {};
  const summary = profile.summary?.verification && typeof profile.summary.verification === "object"
    ? profile.summary.verification
    : {};
  const userId = cleanString(options.userId || profile.userId, 80);
  const riskLines = [
    `Enemy guild matches: **${Number(summary.matchedEnemyGuildCount) || 0}**`,
    `Enemy user matches: **${Number(summary.matchedEnemyUserCount) || 0}**`,
    `Enemy invite matches: **${Number(summary.matchedEnemyInviteCount) || 0}**`,
    `Enemy inviter matches: **${Number(summary.matchedEnemyInviterCount) || 0}**`,
    `Manual tags: **${Number(summary.manualTagCount) || 0}**`,
  ];
  const detailsLines = [
    `OAuth username: **${cleanString(summary.oauthUsername || verification.oauthUsername, 120) || "—"}**`,
    `Observed guilds: **${Number(summary.observedGuildCount) || 0}**`,
    `Status: **${cleanString(summary.status || verification.status, 40) || "not_started"}**`,
    `Decision: **${cleanString(summary.decision || verification.decision, 40) || "none"}**`,
    `Report due: **${cleanString(summary.reportDueAt || verification.reportDueAt, 80) || "—"}**`,
  ];

  const embed = new EmbedBuilder()
    .setTitle("Verification Manual Review")
    .setColor(0xD97706)
    .setDescription(userId ? `Участник: <@${userId}>` : "Участник не найден.")
    .addFields(
      { name: "Проверка", value: detailsLines.join("\n"), inline: false },
      { name: "Risk summary", value: riskLines.join("\n"), inline: false },
      {
        name: "Точные совпадения",
        value: [
          `Guild IDs: ${normalizeStringArray(verification.matchedEnemyGuildIds, 20, 80).join(", ") || "—"}`,
          `User IDs: ${normalizeStringArray(verification.matchedEnemyUserIds, 20, 80).join(", ") || "—"}`,
          `Invite codes: ${normalizeStringArray(verification.matchedEnemyInviteCodes, 20, 80).join(", ") || "—"}`,
          `Inviter IDs: ${normalizeStringArray(verification.matchedEnemyInviterUserIds, 20, 80).join(", ") || "—"}`,
        ].join("\n"),
        inline: false,
      }
    );

  if (statusNote) {
    embed.addFields({ name: "Moderator note", value: statusNote, inline: false });
  }

  return {
    embeds: [embed],
    components: userId && !disableActions
      ? [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(buildVerificationReportCustomId("approve", userId)).setLabel("Approve").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(buildVerificationReportCustomId("reject", userId)).setLabel("Reject").setStyle(ButtonStyle.Danger)
          ),
        ]
      : [],
  };
}

function buildVerificationPanelPayload(options = {}) {
  const integration = options.integration && typeof options.integration === "object" && !Array.isArray(options.integration)
    ? options.integration
    : {};
  const snapshot = normalizeVerificationSnapshot(options.snapshot);
  const riskRules = integration.riskRules && typeof integration.riskRules === "object" && !Array.isArray(integration.riskRules)
    ? integration.riskRules
    : {};
  const deadline = integration.deadline && typeof integration.deadline === "object" && !Array.isArray(integration.deadline)
    ? integration.deadline
    : {};
  const oauthConfigured = options.oauthConfigured === true;
  const verifyRoleId = cleanString(options.verifyRoleId, 80);
  const verificationChannelId = cleanString(integration.verificationChannelId, 80);
  const reportChannelId = cleanString(integration.reportChannelId, 80);
  const statusText = cleanString(options.statusText, 1000);
  const pendingDays = Math.max(1, Number(deadline.pendingDays) || 7);
  const stageTextCount = Object.keys(integration.stageTexts && typeof integration.stageTexts === "object" ? integration.stageTexts : {}).length;
  const missingConfig = [];

  if (!oauthConfigured) missingConfig.push("OAuth env");
  if (!verifyRoleId) missingConfig.push("verify-role");
  if (!verificationChannelId) missingConfig.push("verification-room");

  const embed = new EmbedBuilder()
    .setTitle("Verification Panel")
    .setColor(missingConfig.length ? 0xC62828 : 0x2E7D32)
    .setDescription([
      "Автономная Discord OAuth verification-система.",
      "Подсистема должна изолировать участника verify-ролью и вмешиваться в onboarding только на blocker seam и финальном handoff.",
    ].join("\n"))
    .addFields(
      {
        name: "Система",
        value: [
          `Enabled: **${integration.enabled === true ? "да" : "нет"}**`,
          `OAuth: **${oauthConfigured ? "готов" : "не настроен"}**`,
          `Статус: **${cleanString(integration.status, 40) || "not_started"}**`,
          missingConfig.length ? `Проблемы конфигурации: **${missingConfig.join(", ")}**` : "Критичные зависимости для foundation-среза найдены.",
        ].join("\n"),
        inline: false,
      },
      {
        name: "Очередь и состояния",
        value: [
          `Pending: ${formatCount(snapshot.totals.pending)}`,
          `Manual review: ${formatCount(snapshot.totals.manualReview)}`,
          `Failed: ${formatCount(snapshot.totals.failed)}`,
          `Overdue: ${formatCount(snapshot.totals.overdue)}`,
          `Verified / rejected: ${formatCount(snapshot.totals.verified)} / ${formatCount(snapshot.totals.rejected)}`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "Изоляция и выход",
        value: [
          `Verify-role: ${formatRoleMention(verifyRoleId)}`,
          `Verification room: ${formatChannelMention(verificationChannelId)}`,
          `Base access: ${formatRoleMention(options.accessRoleId)}`,
          `Wartime access: ${formatRoleMention(options.wartimeAccessRoleId)}`,
          `Report channel: ${formatChannelMention(reportChannelId)}`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "Risk rules",
        value: [
          `Enemy guilds: **${countRiskItems(riskRules, "enemyGuildIds")}**`,
          `Enemy users: **${countRiskItems(riskRules, "enemyUserIds")}**`,
          `Enemy invites: **${countRiskItems(riskRules, "enemyInviteCodes")}**`,
          `Enemy inviters: **${countRiskItems(riskRules, "enemyInviterUserIds")}**`,
          `Manual tags: **${countRiskItems(riskRules, "manualTags")}**`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "Runtime health",
        value: [
          `Callback server: **${snapshot.runtime.callbackReady ? "готов" : "не готов"}**`,
          `Join gate: **${snapshot.runtime.joinGateReady ? "готов" : "не готов"}**`,
          `Entry message: **${snapshot.runtime.entryMessagePublished ? "опубликовано" : "не опубликовано"}**`,
          `Report channel: **${snapshot.runtime.reportChannelReady ? "готов" : "не готов"}**`,
          snapshot.runtime.lastSweepAt ? `Последний sweep: ${formatDateTime(snapshot.runtime.lastSweepAt)}` : "Последний sweep: —",
        ].join("\n"),
        inline: false,
      },
      {
        name: "Тексты и дедлайн",
        value: [
          `Настроено текстовых этапов: **${stageTextCount}**`,
          `Дедлайн без auto-kick: **${pendingDays} дн.**`,
          "Через дедлайн система шлёт только overdue-отчёт модерам; auto-kick здесь не включён.",
        ].join("\n"),
        inline: false,
      }
    );

  if (snapshot.issues.length) {
    embed.addFields({
      name: "Внимание",
      value: snapshot.issues.map((entry, index) => `${index + 1}. ${entry}`).join("\n"),
      inline: false,
    });
  }

  if (statusText) {
    embed.addFields({ name: "Последнее действие", value: statusText, inline: false });
  }

  return {
    embeds: [embed],
    components: [
      buildVerificationPanelNavRow("home"),
      buildVerificationPanelActionRow(),
      buildVerificationPanelConfigRow(),
    ],
  };
}

function buildVerificationQueuePayload(options = {}) {
  const snapshot = normalizeVerificationSnapshot(options.snapshot);
  const statusText = cleanString(options.statusText, 1000);
  const queueLines = snapshot.queueEntries.length
    ? snapshot.queueEntries.map((entry, index) => `${index + 1}. ${entry}`).join("\n")
    : "Активная очередь verification сейчас пустая.";

  const embed = new EmbedBuilder()
    .setTitle("Verification Queue")
    .setColor(0x7C3AED)
    .setDescription("Эта view нужна, чтобы быстро оценить объём pending/manual review/failed кейсов без чтения сырых профилей.")
    .addFields(
      {
        name: "Когорты",
        value: [
          `Pending: ${formatCount(snapshot.totals.pending)}`,
          `Manual review: ${formatCount(snapshot.totals.manualReview)}`,
          `Failed: ${formatCount(snapshot.totals.failed)}`,
          `Overdue: ${formatCount(snapshot.totals.overdue)}`,
          `Blocked by verify-role: ${formatCount(snapshot.totals.blocked)}`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "Preview",
        value: queueLines,
        inline: false,
      }
    );

  if (statusText) {
    embed.addFields({ name: "Последнее действие", value: statusText, inline: false });
  }

  return {
    embeds: [embed],
    components: [
      buildVerificationPanelNavRow("queue"),
      buildVerificationPanelActionRow(),
      buildVerificationPanelConfigRow(),
    ],
  };
}

function buildVerificationRuntimePayload(options = {}) {
  const integration = options.integration && typeof options.integration === "object" && !Array.isArray(options.integration)
    ? options.integration
    : {};
  const snapshot = normalizeVerificationSnapshot(options.snapshot);
  const statusText = cleanString(options.statusText, 1000);

  const embed = new EmbedBuilder()
    .setTitle("Verification Runtime")
    .setColor(0xEA580C)
    .setDescription("Операционный runtime view для publish/refresh/sweep и проверки binding health.")
    .addFields(
      {
        name: "Runtime",
        value: [
          `Callback server: **${snapshot.runtime.callbackReady ? "ready" : "missing"}**`,
          `Verify-role binding: **${snapshot.runtime.verifyRoleReady ? "ready" : "missing"}**`,
          `Verification room: **${snapshot.runtime.verificationRoomReady ? "ready" : "missing"}**`,
          `Report channel: **${snapshot.runtime.reportChannelReady ? "ready" : "missing"}**`,
          `Entry message: **${snapshot.runtime.entryMessagePublished ? "published" : "missing"}**`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "Publish state",
        value: [
          `Entry channel: ${formatChannelMention(snapshot.runtime.entryMessageChannelId || integration.entryMessage?.channelId)}`,
          `Entry message id: **${snapshot.runtime.entryMessageId || cleanString(integration.entryMessage?.messageId, 80) || "—"}**`,
          snapshot.runtime.lastReportSentAt ? `Last report sent: ${formatDateTime(snapshot.runtime.lastReportSentAt)}` : "Last report sent: —",
          snapshot.runtime.lastSweepAt ? `Last sweep: ${formatDateTime(snapshot.runtime.lastSweepAt)}` : "Last sweep: —",
        ].join("\n"),
        inline: false,
      }
    );

  if (snapshot.issues.length) {
    embed.addFields({
      name: "Blocking issues",
      value: snapshot.issues.map((entry, index) => `${index + 1}. ${entry}`).join("\n"),
      inline: false,
    });
  }

  if (statusText) {
    embed.addFields({ name: "Последнее действие", value: statusText, inline: false });
  }

  return {
    embeds: [embed],
    components: [
      buildVerificationPanelNavRow("runtime"),
      buildVerificationPanelActionRow(),
      buildVerificationPanelConfigRow(),
    ],
  };
}

async function handleVerificationPanelButtonInteraction(options = {}) {
  const interaction = options.interaction;
  const customId = cleanString(interaction?.customId, 120);
  if (!VERIFY_PANEL_BUTTON_IDS.includes(customId)) {
    return false;
  }

  if (typeof options.isModerator !== "function") {
    throw new TypeError("isModerator must be a function");
  }
  if (typeof options.replyNoPermission !== "function") {
    throw new TypeError("replyNoPermission must be a function");
  }
  if (typeof options.buildView !== "function") {
    throw new TypeError("buildView must be a function");
  }

  if (!options.isModerator(interaction?.member)) {
    await options.replyNoPermission(interaction);
    return true;
  }

  const viewByButtonId = {
    [VERIFY_PANEL_REFRESH_ID]: "home",
    [VERIFY_PANEL_HOME_ID]: "home",
    [VERIFY_PANEL_QUEUE_ID]: "queue",
    [VERIFY_PANEL_RUNTIME_ID]: "runtime",
    [VERIFY_PANEL_GUIDE_ID]: "guide",
  };

  if (viewByButtonId[customId]) {
    const statusText = customId === VERIFY_PANEL_REFRESH_ID ? "Verification panel обновлён." : "";
    await interaction.update(await options.buildView(viewByButtonId[customId], statusText, false));
    return true;
  }

  if (customId === VERIFY_PANEL_BACK_ID) {
    if (typeof options.buildBackPayload !== "function") {
      throw new TypeError("buildBackPayload must be a function");
    }
    await interaction.update(await options.buildBackPayload());
    return true;
  }

  if ([VERIFY_PANEL_CONFIG_INFRA_ID, VERIFY_PANEL_CONFIG_RISK_ID, VERIFY_PANEL_CONFIG_TEXTS_ID, VERIFY_PANEL_RESEND_REPORT_ID].includes(customId)) {
    if (typeof options.buildModal !== "function") {
      throw new TypeError("buildModal must be a function");
    }
    await interaction.showModal(await options.buildModal(customId, interaction));
    return true;
  }

  if ([VERIFY_PANEL_PUBLISH_ENTRY_ID, VERIFY_PANEL_RUN_SWEEP_ID].includes(customId)) {
    if (typeof options.runAction !== "function") {
      throw new TypeError("runAction must be a function");
    }
    await interaction.deferUpdate();
    const statusText = await options.runAction(customId, interaction);
    await interaction.editReply(await options.buildView("runtime", cleanString(statusText, 1000), false));
    return true;
  }

  return true;
}

module.exports = {
  VERIFY_COMMAND_NAME,
  VERIFY_ENTRY_START_ID,
  VERIFY_ENTRY_STATUS_ID,
  VERIFY_ENTRY_GUIDE_ID,
  VERIFY_PANEL_BACK_ID,
  VERIFY_PANEL_BUTTON_IDS,
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
  VERIFY_PANEL_MODAL_IDS,
  VERIFY_PANEL_PUBLISH_ENTRY_ID,
  VERIFY_PANEL_QUEUE_ID,
  VERIFY_PANEL_REFRESH_ID,
  VERIFY_PANEL_RUN_SWEEP_ID,
  VERIFY_PANEL_RUNTIME_ID,
  VERIFY_REPORT_APPROVE_PREFIX,
  VERIFY_REPORT_REJECT_PREFIX,
  VERIFY_SUBCOMMAND_NAMES,
  buildVerificationEntryPayload,
  buildVerificationInfraConfigModal,
  buildVerificationGuidePayload,
  buildVerificationLaunchPayload,
  buildVerificationPanelPayload,
  buildVerificationQueuePayload,
  buildVerificationResendReportModal,
  buildVerificationRiskRulesModal,
  buildVerificationReportCustomId,
  buildVerificationReportPayload,
  buildVerificationRuntimePayload,
  buildVerificationStageTextsModal,
  handleVerificationPanelButtonInteraction,
  parseVerificationReportAction,
};