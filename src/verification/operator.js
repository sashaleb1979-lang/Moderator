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
  VERIFY_PANEL_REFRESH_ID,
  VERIFY_SUBCOMMAND_NAMES,
  buildVerificationPanelPayload,
  handleVerificationPanelButtonInteraction,
};