"use strict";

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require("discord.js");

const VERIFY_COMMAND_NAME = "verify";
const VERIFY_SUBCOMMAND_NAMES = ["panel"];
const VERIFY_PANEL_REFRESH_ID = "verification_panel_refresh";
const VERIFY_ENTRY_START_ID = "verification_begin";
const VERIFY_ENTRY_STATUS_ID = "verification_status";
const VERIFY_REPORT_APPROVE_PREFIX = "verification_report_approve:";
const VERIFY_REPORT_REJECT_PREFIX = "verification_report_reject:";

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
        new ButtonBuilder().setCustomId(VERIFY_ENTRY_STATUS_ID).setLabel("Мой статус").setStyle(ButtonStyle.Secondary)
      ),
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
        name: "Тексты и дедлайн",
        value: [
          `Настроено текстовых этапов: **${stageTextCount}**`,
          `Дедлайн без auto-kick: **${pendingDays} дн.**`,
          "Через дедлайн система шлёт только overdue-отчёт модерам; auto-kick здесь не включён.",
        ].join("\n"),
        inline: false,
      }
    );

  if (statusText) {
    embed.addFields({ name: "Последнее действие", value: statusText, inline: false });
  }

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(VERIFY_PANEL_REFRESH_ID).setLabel("Обновить").setStyle(ButtonStyle.Secondary)
      ),
    ],
  };
}

async function handleVerificationPanelButtonInteraction(options = {}) {
  const interaction = options.interaction;
  if (String(interaction?.customId || "").trim() !== VERIFY_PANEL_REFRESH_ID) {
    return false;
  }

  if (typeof options.isModerator !== "function") {
    throw new TypeError("isModerator must be a function");
  }
  if (typeof options.replyNoPermission !== "function") {
    throw new TypeError("replyNoPermission must be a function");
  }
  if (typeof options.buildPayload !== "function") {
    throw new TypeError("buildPayload must be a function");
  }

  if (!options.isModerator(interaction?.member)) {
    await options.replyNoPermission(interaction);
    return true;
  }

  await interaction.update(await options.buildPayload("Verification panel обновлён.", false));
  return true;
}

module.exports = {
  VERIFY_COMMAND_NAME,
  VERIFY_ENTRY_START_ID,
  VERIFY_ENTRY_STATUS_ID,
  VERIFY_PANEL_REFRESH_ID,
  VERIFY_REPORT_APPROVE_PREFIX,
  VERIFY_REPORT_REJECT_PREFIX,
  VERIFY_SUBCOMMAND_NAMES,
  buildVerificationEntryPayload,
  buildVerificationLaunchPayload,
  buildVerificationPanelPayload,
  buildVerificationReportCustomId,
  buildVerificationReportPayload,
  handleVerificationPanelButtonInteraction,
  parseVerificationReportAction,
};