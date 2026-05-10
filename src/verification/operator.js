"use strict";

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

const VERIFY_COMMAND_NAME = "verify";
const VERIFY_SUBCOMMAND_NAMES = ["panel", "add"];
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
const VERIFY_REPORT_APPROVE_NORMAL_PREFIX = "verification_report_approve_normal:";
const VERIFY_REPORT_APPROVE_WARTIME_PREFIX = "verification_report_approve_wartime:";
const VERIFY_REPORT_BAN_PREFIX = "verification_report_ban:";

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

const VERIFICATION_STATUS_LABELS = Object.freeze({
  not_started: "не начато",
  pending: "ожидает проверки",
  manual_review: "нужна ручная проверка",
  verified: "подтверждён",
  rejected: "отклонён",
  failed: "ошибка OAuth",
  configured: "настроено",
  in_progress: "в работе",
  none: "нет",
});

const VERIFICATION_DECISION_LABELS = Object.freeze({
  none: "нет",
  approved: "одобрено",
  manual_review: "нужна ручная проверка",
  rejected: "отклонено",
});

const VERIFICATION_ISSUE_LABELS = Object.freeze({
  "verification disabled in config": "система выключена в настройках",
  "OAuth env is not configured": "не заполнены OAuth-переменные окружения",
  "verify-role is missing": "не настроена verify-роль",
  "verification room is missing": "не настроен канал проверки",
  "report channel is missing": "не настроен канал отчётов",
  "report channel missing": "не настроен канал отчётов",
});

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function assertFunction(value, name) {
  if (typeof value !== "function") {
    throw new TypeError(`${name} must be a function`);
  }
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

function formatVerificationStatus(value, fallback = "—") {
  const text = cleanString(value, 80).toLowerCase();
  return VERIFICATION_STATUS_LABELS[text] || text || fallback;
}

function formatVerificationDecision(value, fallback = "—") {
  const text = cleanString(value, 80).toLowerCase();
  return VERIFICATION_DECISION_LABELS[text] || formatVerificationStatus(text, fallback);
}

function formatVerificationIssue(entry) {
  const text = cleanString(entry, 200);
  return VERIFICATION_ISSUE_LABELS[text] || text || "неизвестная проблема";
}

function formatVerificationQueueEntry(entry) {
  const replacements = [
    [/report sent/gi, "отчёт отправлен"],
    [/overdue/gi, "просрочено"],
    [/waiting/gi, "ожидает"],
    [/manual_review/gi, "ручная проверка"],
    [/not_started/gi, "не начато"],
    [/verified/gi, "подтверждён"],
    [/rejected/gi, "отклонён"],
    [/pending/gi, "ожидает проверки"],
    [/failed/gi, "ошибка OAuth"],
    [/\bdue\b/gi, "срок"],
  ];

  let text = cleanString(entry, 240);
  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

function normalizeObservedGuildEntries(verification = {}) {
  const source = verification && typeof verification === "object" && !Array.isArray(verification)
    ? verification
    : {};
  const directEntries = Array.isArray(source.observedGuilds) ? source.observedGuilds : [];
  const normalized = [];

  for (const entry of directEntries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const id = cleanString(entry.id, 80);
    if (!id) continue;
    normalized.push({
      id,
      name: cleanString(entry.name, 120),
      owner: entry.owner === true,
      permissions: cleanString(entry.permissions, 40),
    });
    if (normalized.length >= 20) return normalized;
  }

  if (normalized.length) {
    return normalized;
  }

  const ids = normalizeStringArray(source.observedGuildIds, 20, 80);
  const names = Array.isArray(source.observedGuildNames)
    ? source.observedGuildNames.map((entry) => cleanString(entry, 120)).filter(Boolean)
    : [];

  return ids.map((id, index) => ({
    id,
    name: names[index] || "",
    owner: false,
    permissions: "",
  }));
}

function formatObservedGuildLine(entry, index) {
  const name = cleanString(entry?.name, 120) || "Без названия";
  const id = cleanString(entry?.id, 80) || "—";
  const parts = [`${index + 1}. ${name}`, `ID ${id}`];
  if (entry?.owner === true) {
    parts.push("owner");
  }
  if (cleanString(entry?.permissions, 40)) {
    parts.push(`perm ${cleanString(entry.permissions, 40)}`);
  }
  return parts.join(" • ");
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
    new ButtonBuilder().setCustomId(VERIFY_PANEL_HOME_ID).setLabel("Обзор").setStyle(currentView === "home" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(VERIFY_PANEL_QUEUE_ID).setLabel("Очередь").setStyle(currentView === "queue" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(VERIFY_PANEL_RUNTIME_ID).setLabel("Система").setStyle(currentView === "runtime" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(VERIFY_PANEL_GUIDE_ID).setLabel("Инструкция").setStyle(currentView === "guide" ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );
}

function buildVerificationHomeRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(VERIFY_PANEL_CONFIG_INFRA_ID).setLabel("Основные").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(VERIFY_PANEL_CONFIG_RISK_ID).setLabel("Риски").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(VERIFY_PANEL_CONFIG_TEXTS_ID).setLabel("Тексты").setStyle(ButtonStyle.Secondary)
  );
}

function buildVerificationQueueRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(VERIFY_PANEL_RUN_SWEEP_ID).setLabel("Проверить дедлайны").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(VERIFY_PANEL_RESEND_REPORT_ID).setLabel("Повторить отчёт").setStyle(ButtonStyle.Secondary)
  );
}

function buildVerificationRuntimeRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(VERIFY_PANEL_CONFIG_INFRA_ID).setLabel("Основные").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(VERIFY_PANEL_PUBLISH_ENTRY_ID).setLabel("Опубликовать кнопку").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(VERIFY_PANEL_RUN_SWEEP_ID).setLabel("Проверить дедлайны").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(VERIFY_PANEL_RESEND_REPORT_ID).setLabel("Повторить отчёт").setStyle(ButtonStyle.Secondary)
  );
}

function buildVerificationGuideRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(VERIFY_PANEL_CONFIG_INFRA_ID).setLabel("Основные").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(VERIFY_PANEL_CONFIG_RISK_ID).setLabel("Риски").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(VERIFY_PANEL_CONFIG_TEXTS_ID).setLabel("Тексты").setStyle(ButtonStyle.Secondary)
  );
}

function buildVerificationPanelRows(currentView = "home") {
  const rows = [buildVerificationPanelNavRow(currentView)];
  if (currentView === "runtime") {
    rows.push(buildVerificationRuntimeRow());
    return rows;
  }
  if (currentView === "queue") {
    rows.push(buildVerificationQueueRow());
    return rows;
  }
  if (currentView === "guide") {
    rows.push(buildVerificationGuideRow());
    return rows;
  }
  rows.push(buildVerificationHomeRow());
  return rows;
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
    .setTitle("Основные настройки")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("verification_enabled")
          .setLabel("Система включена? (да/нет)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(10)
          .setValue(integration.enabled === true ? "да" : "нет")
          .setPlaceholder("да")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("verification_callback_base_url")
          .setLabel("Callback URL")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(500)
          .setValue(normalizeModalValue(integration.callbackBaseUrl, ""))
          .setPlaceholder("https://example.com/verification/callback")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("verification_verify_role")
          .setLabel("Verify-роль: ID/mention/название")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(120)
          .setValue(normalizeModalValue(options.verifyRoleId, ""))
          .setPlaceholder("например, Проверка")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("verification_room_channel")
          .setLabel("Канал проверки: ID/mention/название")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(120)
          .setValue(normalizeModalValue(integration.verificationChannelId, ""))
          .setPlaceholder("например, verification")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("verification_report_channel")
          .setLabel("Канал отчётов: ID/mention/название")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(120)
          .setValue(normalizeModalValue(integration.reportChannelId, ""))
          .setPlaceholder("например, review")
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
    .setTitle("Правила риска")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("verification_enemy_guild_ids")
          .setLabel("ID вражеских серверов")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(4000)
          .setValue(joinLines(riskRules.enemyGuildIds))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("verification_enemy_user_ids")
          .setLabel("ID подозрительных пользователей")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(4000)
          .setValue(joinLines(riskRules.enemyUserIds))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("verification_enemy_invite_codes")
          .setLabel("Коды опасных invite")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(4000)
          .setValue(joinLines(riskRules.enemyInviteCodes))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("verification_enemy_inviter_user_ids")
          .setLabel("ID пригласивших из риска")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(4000)
          .setValue(joinLines(riskRules.enemyInviterUserIds))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("verification_manual_tags")
          .setLabel("Теги для ручной проверки")
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
    .setTitle("Тексты и сроки")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("verification_stage_entry")
          .setLabel("Текст входного сообщения")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(4000)
          .setValue(normalizeModalValue(stageTexts.entry, ""))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("verification_stage_manual_review")
          .setLabel("Текст для ручной проверки")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(4000)
          .setValue(normalizeModalValue(stageTexts.manualReview, ""))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("verification_stage_approved")
          .setLabel("Текст после одобрения")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(4000)
          .setValue(normalizeModalValue(stageTexts.approved, ""))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("verification_stage_rejected")
          .setLabel("Текст после отказа")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(4000)
          .setValue(normalizeModalValue(stageTexts.rejected, ""))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("verification_pending_days")
          .setLabel("Сколько дней ждать до отчёта")
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
    .setTitle("Повторная отправка отчёта")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("verification_resend_user")
          .setLabel("Кому отправить отчёт")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(80)
          .setPlaceholder("123456789012345678")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("verification_resend_note")
          .setLabel("Комментарий модератора")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(1000)
          .setValue("Ручная повторная отправка отчёта.")
      )
    );
}

function buildParticipantGuideText(integration = {}) {
  return [
    "1. Открой канал проверки и нажми кнопку запуска OAuth.",
    "2. Авторизуйся тем же Discord-аккаунтом, который сейчас находится на сервере.",
    "3. После возврата с сайта бот сохранит данные проверки и отправит кейс модераторам.",
    `4. Если участник не завершит OAuth сам, через **${Math.max(1, Number(integration.deadline?.pendingDays) || 7)} дн.** модераторы всё равно получат отчёт и примут решение вручную.`,
    `5. После одобрения участник увидит: ${cleanString(integration.stageTexts?.approved, 200) || "модератор снимет verify-роль и выдаст нужный стартовый доступ."}`,
    `6. После отказа участник увидит: ${cleanString(integration.stageTexts?.rejected, 200) || "доступ не будет выдан, а модератор может забанить прямо из отчёта."}`,
  ].join("\n");
}

function buildModeratorGuideText(integration = {}, snapshot = {}) {
  const normalizedSnapshot = normalizeVerificationSnapshot(snapshot);
  return [
    "1. Раздел «Обзор» показывает, всё ли готово: OAuth, verify-роль, канал проверки и канал отчётов.",
    "2. Раздел «Очередь» показывает, кто ждёт решения, ушёл в ручную проверку, упал с ошибкой или просрочен.",
    "3. Раздел «Система» нужен для обновления входного сообщения, ручной проверки просроченных кейсов и повторной отправки отчётов.",
    "4. Отчёт в канал модераторов остаётся местом, где принимается решение: выдать обычный доступ, выдать военный доступ или забанить.",
    `5. Сейчас в очереди: ожидают ${normalizedSnapshot.totals.pending}, ручная проверка ${normalizedSnapshot.totals.manualReview}, просрочено ${normalizedSnapshot.totals.overdue}.`,
    `6. Дедлайн до отправки отчёта: ${Math.max(1, Number(integration.deadline?.pendingDays) || 7)} дн. Автокика здесь нет.`
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
    .setTitle("Проверка доступа")
    .setColor(0x2563EB)
    .setDescription([
      entryText,
      `После OAuth решение всё равно принимает модератор. Если участник не завершит проверку сам, через **${pendingDays} дн.** отчёт уйдёт модераторам автоматически.`,
    ].join("\n\n"));

  if (statusText) {
    embed.addFields({ name: "Статус", value: statusText, inline: false });
  }

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(VERIFY_ENTRY_START_ID).setLabel("Начать проверку").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(VERIFY_ENTRY_STATUS_ID).setLabel("Мой статус").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(VERIFY_ENTRY_GUIDE_ID).setLabel("Как это работает").setStyle(ButtonStyle.Secondary)
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
    .setTitle(audience === "participant" ? "Как пройти проверку" : "Инструкция для модераторов")
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
            new ButtonBuilder().setCustomId(VERIFY_ENTRY_START_ID).setLabel("Начать проверку").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(VERIFY_ENTRY_STATUS_ID).setLabel("Мой статус").setStyle(ButtonStyle.Secondary)
          ),
        ]
      : buildVerificationPanelRows("guide"),
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
        .setTitle("Авторизация Discord")
        .setColor(0x2563EB)
        .setDescription(description),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Открыть страницу авторизации").setURL(authorizeUrl),
        new ButtonBuilder().setCustomId(VERIFY_ENTRY_STATUS_ID).setLabel("Проверить статус").setStyle(ButtonStyle.Secondary)
      ),
    ],
  };
}

function buildVerificationReportCustomId(action, userId) {
  const normalizedUserId = cleanString(userId, 80);
  if (!normalizedUserId) {
    throw new Error("userId обязателен для verification report action.");
  }
  if (action === "approve_normal") return `${VERIFY_REPORT_APPROVE_NORMAL_PREFIX}${normalizedUserId}`;
  if (action === "approve_wartime") return `${VERIFY_REPORT_APPROVE_WARTIME_PREFIX}${normalizedUserId}`;
  if (action === "ban") return `${VERIFY_REPORT_BAN_PREFIX}${normalizedUserId}`;
  throw new Error("Неизвестное verification report action.");
}

function parseVerificationReportAction(customId) {
  const value = cleanString(customId, 200);
  if (value.startsWith(VERIFY_REPORT_APPROVE_NORMAL_PREFIX)) {
    return {
      action: "approve_normal",
      userId: cleanString(value.slice(VERIFY_REPORT_APPROVE_NORMAL_PREFIX.length), 80),
    };
  }
  if (value.startsWith(VERIFY_REPORT_APPROVE_WARTIME_PREFIX)) {
    return {
      action: "approve_wartime",
      userId: cleanString(value.slice(VERIFY_REPORT_APPROVE_WARTIME_PREFIX.length), 80),
    };
  }
  if (value.startsWith(VERIFY_REPORT_BAN_PREFIX)) {
    return {
      action: "ban",
      userId: cleanString(value.slice(VERIFY_REPORT_BAN_PREFIX.length), 80),
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
  const observedGuildEntries = normalizeObservedGuildEntries(verification);
  const riskLines = [
    `Совпадения по серверам: **${Number(summary.matchedEnemyGuildCount) || 0}**`,
    `Совпадения по пользователям: **${Number(summary.matchedEnemyUserCount) || 0}**`,
    `Совпадения по invite: **${Number(summary.matchedEnemyInviteCount) || 0}**`,
    `Совпадения по inviter: **${Number(summary.matchedEnemyInviterCount) || 0}**`,
    `Ручные теги: **${Number(summary.manualTagCount) || 0}**`,
  ];
  const detailsLines = [
    `OAuth-аккаунт: **${cleanString(summary.oauthUsername || verification.oauthUsername, 120) || "—"}**`,
    `Замечено серверов: **${Number(summary.observedGuildCount) || 0}**`,
    `Статус: **${formatVerificationStatus(summary.status || verification.status, "не начато")}**`,
    `Решение: **${formatVerificationDecision(summary.decision || verification.decision, "нет")}**`,
    `Дедлайн отчёта: **${cleanString(summary.reportDueAt || verification.reportDueAt, 80) || "—"}**`,
  ];

  const embed = new EmbedBuilder()
    .setTitle("Ручная проверка доступа")
    .setColor(0xD97706)
    .setDescription(userId ? `Участник: <@${userId}>` : "Участник не найден.")
    .addFields(
      { name: "Проверка", value: detailsLines.join("\n"), inline: false },
      { name: "Сводка риска", value: riskLines.join("\n"), inline: false },
      {
        name: "Точные совпадения",
        value: [
          `Серверы: ${normalizeStringArray(verification.matchedEnemyGuildIds, 20, 80).join(", ") || "—"}`,
          `Пользователи: ${normalizeStringArray(verification.matchedEnemyUserIds, 20, 80).join(", ") || "—"}`,
          `Invite-коды: ${normalizeStringArray(verification.matchedEnemyInviteCodes, 20, 80).join(", ") || "—"}`,
          `Inviter ID: ${normalizeStringArray(verification.matchedEnemyInviterUserIds, 20, 80).join(", ") || "—"}`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "Замеченные серверы OAuth",
        value: observedGuildEntries.length
          ? observedGuildEntries.map((entry, index) => formatObservedGuildLine(entry, index)).join("\n")
          : "Discord OAuth не вернул список серверов для этого участника.",
        inline: false,
      }
    );

  if (statusNote) {
    embed.addFields({ name: "Комментарий модератора", value: statusNote, inline: false });
  }

  const files = Array.isArray(options.files) ? options.files.filter(Boolean) : [];

  return {
    embeds: [embed],
    ...(files.length ? { files } : {}),
    components: userId && !disableActions
      ? [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(buildVerificationReportCustomId("approve_normal", userId)).setLabel("Норм роль").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(buildVerificationReportCustomId("approve_wartime", userId)).setLabel("Воен роль").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(buildVerificationReportCustomId("ban", userId)).setLabel("Забанить").setStyle(ButtonStyle.Danger)
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

  if (!oauthConfigured) missingConfig.push("OAuth-переменные");
  if (!verifyRoleId) missingConfig.push("verify-роль");
  if (!verificationChannelId) missingConfig.push("канал проверки");

  const embed = new EmbedBuilder()
    .setTitle("Панель проверки доступа")
    .setColor(missingConfig.length ? 0xC62828 : 0x2E7D32)
    .setDescription([
      "Отсюда управляется отдельная Discord OAuth-проверка участников.",
      "Панель показывает, что готово, кто застрял в очереди и какие действия нужны модератору прямо сейчас.",
    ].join("\n"))
    .addFields(
      {
        name: "Общее состояние",
        value: [
          `Система включена: **${integration.enabled === true ? "да" : "нет"}**`,
          `OAuth: **${oauthConfigured ? "готов" : "не настроен"}**`,
          `Текущий статус: **${formatVerificationStatus(cleanString(integration.status, 40), "не начато")}**`,
          missingConfig.length ? `Нужно настроить: **${missingConfig.join(", ")}**` : "Критичных пробелов в базовой настройке не найдено.",
        ].join("\n"),
        inline: false,
      },
      {
        name: "Очередь и результаты",
        value: [
          `Ожидают проверки: ${formatCount(snapshot.totals.pending)}`,
          `Нужна ручная проверка: ${formatCount(snapshot.totals.manualReview)}`,
          `Ошибки OAuth: ${formatCount(snapshot.totals.failed)}`,
          `Просрочено: ${formatCount(snapshot.totals.overdue)}`,
          `Подтверждены / отклонены: ${formatCount(snapshot.totals.verified)} / ${formatCount(snapshot.totals.rejected)}`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "Роли и каналы",
        value: [
          `Verify-роль: ${formatRoleMention(verifyRoleId)}`,
          `Канал проверки: ${formatChannelMention(verificationChannelId)}`,
          `Базовый доступ: ${formatRoleMention(options.accessRoleId)}`,
          `Военный доступ: ${formatRoleMention(options.wartimeAccessRoleId)}`,
          `Канал отчётов: ${formatChannelMention(reportChannelId)}`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "Правила риска",
        value: [
          `Вражеские серверы: **${countRiskItems(riskRules, "enemyGuildIds")}**`,
          `Подозрительные пользователи: **${countRiskItems(riskRules, "enemyUserIds")}**`,
          `Опасные invite: **${countRiskItems(riskRules, "enemyInviteCodes")}**`,
          `Подозрительные inviter: **${countRiskItems(riskRules, "enemyInviterUserIds")}**`,
          `Теги ручной проверки: **${countRiskItems(riskRules, "manualTags")}**`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "Что сейчас готово",
        value: [
          `Callback server: **${snapshot.runtime.callbackReady ? "готов" : "не готов"}**`,
          `Изоляция до проверки: **${snapshot.runtime.joinGateReady ? "готова" : "не готова"}**`,
          `Входное сообщение: **${snapshot.runtime.entryMessagePublished ? "опубликовано" : "не опубликовано"}**`,
          `Канал отчётов: **${snapshot.runtime.reportChannelReady ? "готов" : "не готов"}**`,
          snapshot.runtime.lastSweepAt ? `Последняя проверка просроченных: ${formatDateTime(snapshot.runtime.lastSweepAt)}` : "Последняя проверка просроченных: —",
        ].join("\n"),
        inline: false,
      },
      {
        name: "Тексты и срок",
        value: [
          `Настроено текстовых этапов: **${stageTextCount}**`,
          `Срок до отчёта модераторам: **${pendingDays} дн.**`,
          "После истечения срока система отправляет отчёт модераторам. Выпуск из карантина и бан делаются только кнопками модератора.",
        ].join("\n"),
        inline: false,
      }
    );

  if (snapshot.issues.length) {
    embed.addFields({
      name: "Что требует внимания",
      value: snapshot.issues.map((entry, index) => `${index + 1}. ${formatVerificationIssue(entry)}`).join("\n"),
      inline: false,
    });
  }

  if (statusText) {
    embed.addFields({ name: "Последнее действие", value: statusText, inline: false });
  }

  return {
    embeds: [embed],
    components: buildVerificationPanelRows("home"),
  };
}

function buildVerificationQueuePayload(options = {}) {
  const snapshot = normalizeVerificationSnapshot(options.snapshot);
  const statusText = cleanString(options.statusText, 1000);
  const queueLines = snapshot.queueEntries.length
    ? snapshot.queueEntries.map((entry, index) => `${index + 1}. ${formatVerificationQueueEntry(entry)}`).join("\n")
    : "Сейчас в очереди проверки никого нет.";

  const embed = new EmbedBuilder()
    .setTitle("Очередь проверки")
    .setColor(0x7C3AED)
    .setDescription("Здесь видно, кто ещё ждёт решения, ушёл в ручную проверку, упал с ошибкой или уже просрочен.")
    .addFields(
      {
        name: "Сводка",
        value: [
          `Ожидают проверки: ${formatCount(snapshot.totals.pending)}`,
          `Нужна ручная проверка: ${formatCount(snapshot.totals.manualReview)}`,
          `Ошибки OAuth: ${formatCount(snapshot.totals.failed)}`,
          `Просрочено: ${formatCount(snapshot.totals.overdue)}`,
          `Всё ещё заблокированы verify-ролью: ${formatCount(snapshot.totals.blocked)}`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "Ближайшие кейсы",
        value: queueLines,
        inline: false,
      }
    );

  if (statusText) {
    embed.addFields({ name: "Последнее действие", value: statusText, inline: false });
  }

  return {
    embeds: [embed],
    components: buildVerificationPanelRows("queue"),
  };
}

function buildVerificationRuntimePayload(options = {}) {
  const integration = options.integration && typeof options.integration === "object" && !Array.isArray(options.integration)
    ? options.integration
    : {};
  const snapshot = normalizeVerificationSnapshot(options.snapshot);
  const statusText = cleanString(options.statusText, 1000);

  const embed = new EmbedBuilder()
    .setTitle("Состояние системы")
    .setColor(0xEA580C)
    .setDescription("Здесь видно, готов ли callback, опубликовано ли входное сообщение и куда сейчас уходят отчёты.")
    .addFields(
      {
        name: "Готовность",
        value: [
          `Callback-сервер: **${snapshot.runtime.callbackReady ? "готов" : "не готов"}**`,
          `Verify-роль: **${snapshot.runtime.verifyRoleReady ? "настроена" : "не настроена"}**`,
          `Канал проверки: **${snapshot.runtime.verificationRoomReady ? "настроен" : "не настроен"}**`,
          `Канал отчётов: **${snapshot.runtime.reportChannelReady ? "настроен" : "не настроен"}**`,
          `Входное сообщение: **${snapshot.runtime.entryMessagePublished ? "опубликовано" : "не опубликовано"}**`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "Входное сообщение и отчёты",
        value: [
          `Канал входного сообщения: ${formatChannelMention(snapshot.runtime.entryMessageChannelId || integration.entryMessage?.channelId)}`,
          `ID входного сообщения: **${snapshot.runtime.entryMessageId || cleanString(integration.entryMessage?.messageId, 80) || "—"}**`,
          snapshot.runtime.lastReportSentAt ? `Последний отправленный отчёт: ${formatDateTime(snapshot.runtime.lastReportSentAt)}` : "Последний отправленный отчёт: —",
          snapshot.runtime.lastSweepAt ? `Последняя проверка просроченных: ${formatDateTime(snapshot.runtime.lastSweepAt)}` : "Последняя проверка просроченных: —",
        ].join("\n"),
        inline: false,
      }
    );

  if (snapshot.issues.length) {
    embed.addFields({
      name: "Проблемы",
      value: snapshot.issues.map((entry, index) => `${index + 1}. ${formatVerificationIssue(entry)}`).join("\n"),
      inline: false,
    });
  }

  if (statusText) {
    embed.addFields({ name: "Последнее действие", value: statusText, inline: false });
  }

  return {
    embeds: [embed],
    components: buildVerificationPanelRows("runtime"),
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
    const statusText = customId === VERIFY_PANEL_REFRESH_ID ? "Панель проверки обновлена." : "";
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

async function handleVerificationPanelModalSubmitInteraction(options = {}) {
  const {
    interaction,
    client,
    isModerator,
    replyNoPermission,
    buildPanelReply,
    getCurrentIntegration,
    parseBooleanInput,
    parseListInput,
    parseRequestedRoleId,
    parseRequestedChannelId,
    resolveRequestedRoleId,
    resolveRequestedChannelId,
    parseRequestedUserId,
    cleanText,
    nowIso,
    writeIntegrationSnapshot,
    writeVerifyRole,
    clearVerifyRole,
    saveDb,
    startRuntime,
    ensureEntryMessage,
    ensurePendingProfile,
    postManualReport,
    updateProfile,
    computeReportDueAt,
  } = options;

  const customId = cleanString(interaction?.customId, 120);
  if (!VERIFY_PANEL_MODAL_IDS.includes(customId)) {
    return false;
  }

  assertFunction(isModerator, "isModerator");
  assertFunction(replyNoPermission, "replyNoPermission");
  assertFunction(buildPanelReply, "buildPanelReply");
  assertFunction(getCurrentIntegration, "getCurrentIntegration");
  assertFunction(parseBooleanInput, "parseBooleanInput");
  assertFunction(parseListInput, "parseListInput");
  assertFunction(parseRequestedRoleId, "parseRequestedRoleId");
  assertFunction(parseRequestedChannelId, "parseRequestedChannelId");
  assertFunction(parseRequestedUserId, "parseRequestedUserId");
  assertFunction(cleanText, "cleanText");
  assertFunction(nowIso, "nowIso");
  assertFunction(writeIntegrationSnapshot, "writeIntegrationSnapshot");
  assertFunction(writeVerifyRole, "writeVerifyRole");
  assertFunction(clearVerifyRole, "clearVerifyRole");
  assertFunction(saveDb, "saveDb");
  assertFunction(startRuntime, "startRuntime");
  assertFunction(ensureEntryMessage, "ensureEntryMessage");
  assertFunction(ensurePendingProfile, "ensurePendingProfile");
  assertFunction(postManualReport, "postManualReport");
  assertFunction(updateProfile, "updateProfile");
  assertFunction(computeReportDueAt, "computeReportDueAt");

  if (!isModerator(interaction?.member)) {
    await replyNoPermission(interaction);
    return true;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const editPayload = async (payload) => {
    await interaction.editReply(payload);
  };
  const resolveRoleId = typeof resolveRequestedRoleId === "function"
    ? resolveRequestedRoleId
    : async (value, fallbackRoleId = "") => parseRequestedRoleId(value, fallbackRoleId);
  const resolveChannelId = typeof resolveRequestedChannelId === "function"
    ? resolveRequestedChannelId
    : async (value, fallbackChannelId = "") => parseRequestedChannelId(value, fallbackChannelId);

  try {
    if (customId === VERIFY_PANEL_CONFIG_INFRA_MODAL_ID) {
      const currentIntegration = getCurrentIntegration();
      const enabledRaw = interaction.fields.getTextInputValue("verification_enabled");
      const callbackBaseUrl = cleanText(interaction.fields.getTextInputValue("verification_callback_base_url"), 500);
      const verifyRoleRaw = interaction.fields.getTextInputValue("verification_verify_role");
      const verificationRoomRaw = interaction.fields.getTextInputValue("verification_room_channel");
      const reportChannelRaw = interaction.fields.getTextInputValue("verification_report_channel");

      const enabled = parseBooleanInput(enabledRaw, currentIntegration.enabled === true);
      if (enabled === null) {
        await editPayload({ content: "Enabled должно быть yes/no, true/false или да/нет." });
        return true;
      }

      const verifyRoleId = await resolveRoleId(verifyRoleRaw, "");
      const verificationChannelId = await resolveChannelId(verificationRoomRaw, "");
      const reportChannelId = await resolveChannelId(reportChannelRaw, "");
      if (cleanText(verifyRoleRaw, 80) && !verifyRoleId) {
        await editPayload({ content: "Verify-роль должна быть ID, mention или точным названием существующей роли." });
        return true;
      }
      if (cleanText(verificationRoomRaw, 80) && !verificationChannelId) {
        await editPayload({ content: "Канал проверки должен быть ID, mention или точным названием существующего текстового канала." });
        return true;
      }
      if (cleanText(reportChannelRaw, 80) && !reportChannelId) {
        await editPayload({ content: "Канал отчётов должен быть ID, mention или точным названием существующего текстового канала." });
        return true;
      }

      const patch = {
        enabled,
        callbackBaseUrl,
        verificationChannelId,
        reportChannelId,
        lastSyncAt: nowIso(),
      };
      if (cleanText(currentIntegration.verificationChannelId, 80) !== verificationChannelId) {
        patch.entryMessage = { channelId: "", messageId: "" };
      }
      writeIntegrationSnapshot(patch);

      if (verifyRoleId) {
        writeVerifyRole(verifyRoleId);
      } else {
        clearVerifyRole();
      }
      saveDb();

      const savedTargets = [];
      if (verifyRoleId) savedTargets.push(`verify-роль ${formatRoleMention(verifyRoleId)}`);
      if (verificationChannelId) savedTargets.push(`канал проверки ${formatChannelMention(verificationChannelId)}`);
      if (reportChannelId) savedTargets.push(`канал отчётов ${formatChannelMention(reportChannelId)}`);
      const statusParts = [savedTargets.length
        ? `Базовые настройки проверки сохранены: ${savedTargets.join(", ")}.`
        : "Базовые настройки проверки сохранены."];
      let entryPublished = false;
      if (enabled) {
        try {
          const runtimeState = await startRuntime(client);
          entryPublished = runtimeState.entryPublished === true;
          statusParts.push(`Система: callback ${runtimeState.callbackStarted ? "готов" : "работает с ограничениями"}, входное сообщение ${entryPublished ? "опубликовано" : "не опубликовано"}.`);
        } catch (error) {
          statusParts.push(`Предупреждение системы: ${cleanText(error?.message || error, 200)}`);
        }
      }

      if (verificationChannelId && !entryPublished) {
        try {
          await ensureEntryMessage(client);
          entryPublished = true;
          statusParts.push("Входное сообщение опубликовано в канале проверки.");
        } catch (error) {
          statusParts.push(`Предупреждение по входному сообщению: ${cleanText(error?.message || error, 200)}`);
        }
      }

      await editPayload(await buildPanelReply("runtime", statusParts.join(" ")));
      return true;
    }

    if (customId === VERIFY_PANEL_CONFIG_RISK_MODAL_ID) {
      writeIntegrationSnapshot({
        riskRules: {
          enemyGuildIds: parseListInput(interaction.fields.getTextInputValue("verification_enemy_guild_ids")),
          enemyUserIds: parseListInput(interaction.fields.getTextInputValue("verification_enemy_user_ids")),
          enemyInviteCodes: parseListInput(interaction.fields.getTextInputValue("verification_enemy_invite_codes")),
          enemyInviterUserIds: parseListInput(interaction.fields.getTextInputValue("verification_enemy_inviter_user_ids")),
          manualTags: parseListInput(interaction.fields.getTextInputValue("verification_manual_tags")),
        },
        lastSyncAt: nowIso(),
      });
      saveDb();
      await editPayload(await buildPanelReply("home", "Verification risk rules сохранены."));
      return true;
    }

    if (customId === VERIFY_PANEL_RESEND_REPORT_MODAL_ID) {
      const targetRaw = interaction.fields.getTextInputValue("verification_resend_user");
      const targetUserId = parseRequestedUserId(targetRaw, "");
      if (!targetUserId) {
        await editPayload({ content: "Target user должен быть Discord user ID или mention вида <@...>." });
        return true;
      }

      const moderatorNote = cleanText(interaction.fields.getTextInputValue("verification_resend_note"), 1000)
        || "Ручной resend verification report.";
      ensurePendingProfile(targetUserId, {
        status: "manual_review",
        decision: "manual_review",
      });
      const result = await postManualReport(client, targetUserId, moderatorNote);
      updateProfile(targetUserId, {
        status: "manual_review",
        decision: "manual_review",
        reportSentAt: nowIso(),
        reportDueAt: cleanText(result.profile?.domains?.verification?.reportDueAt, 80) || computeReportDueAt(),
      });
      await editPayload(await buildPanelReply(
        "runtime",
        `Verification report повторно отправлен для <@${targetUserId}> в <#${result.channel.id}>.`
      ));
      return true;
    }

    const pendingDaysValue = Number.parseInt(interaction.fields.getTextInputValue("verification_pending_days"), 10);
    if (!Number.isSafeInteger(pendingDaysValue) || pendingDaysValue < 1 || pendingDaysValue > 60) {
      await editPayload({ content: "Pending days должен быть целым числом от 1 до 60." });
      return true;
    }

    writeIntegrationSnapshot({
      stageTexts: {
        entry: cleanText(interaction.fields.getTextInputValue("verification_stage_entry"), 4000),
        manualReview: cleanText(interaction.fields.getTextInputValue("verification_stage_manual_review"), 4000),
        approved: cleanText(interaction.fields.getTextInputValue("verification_stage_approved"), 4000),
        rejected: cleanText(interaction.fields.getTextInputValue("verification_stage_rejected"), 4000),
      },
      deadline: {
        pendingDays: pendingDaysValue,
      },
      lastSyncAt: nowIso(),
    });
    saveDb();

    const currentIntegration = getCurrentIntegration();
    let statusText = "Verification stage texts сохранены.";
    if (cleanText(currentIntegration.verificationChannelId, 80)) {
      try {
        await ensureEntryMessage(client);
        statusText = `${statusText} Entry message обновлено.`;
      } catch (error) {
        statusText = `${statusText} Entry warning: ${cleanText(error?.message || error, 200)}`;
      }
    }
    await editPayload(await buildPanelReply("home", statusText));
    return true;
  } catch (error) {
    await editPayload({ content: `Не удалось сохранить verification config: ${cleanText(error?.message || error, 300)}` });
    return true;
  }
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
  VERIFY_REPORT_APPROVE_NORMAL_PREFIX,
  VERIFY_REPORT_APPROVE_WARTIME_PREFIX,
  VERIFY_REPORT_BAN_PREFIX,
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
  handleVerificationPanelModalSubmitInteraction,
  parseVerificationReportAction,
};