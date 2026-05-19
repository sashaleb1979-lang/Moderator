"use strict";

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require("discord.js");

const BOT_HELPER_PANEL_SLOT = "botHelper";
const BOT_HELPER_PANEL_CONFIG_BUTTON_ID = "panel_config_bot_helper";
const BOT_HELPER_PANEL_CONFIG_MODAL_ID = "panel_config_bot_helper_modal";
const BOT_HELPER_PANEL_CHANNEL_INPUT_ID = "panel_channel_bot_helper";
const BOT_HELPER_PANEL_AUTO_RESEND_INTERVAL_HOURS = 12;
const BOT_HELPER_PANEL_AUTO_RESEND_INTERVAL_MS = BOT_HELPER_PANEL_AUTO_RESEND_INTERVAL_HOURS * 60 * 60 * 1000;

const BOT_HELPER_PANEL_EDITOR_CUSTOM_IDS = Object.freeze({
  refresh: "bot_helper_panel_refresh",
  setChannel: "bot_helper_panel_set_channel",
  resendNow: "bot_helper_panel_resend_now",
  disable: "bot_helper_panel_disable",
  close: "bot_helper_panel_close",
});

const BOT_HELPER_PANEL_ACTION_IDS = Object.freeze({
  kills: "onboard_begin",
  roblox: "profile_bind_roblox",
  elo: "elo_submit_open",
  mains: "onboard_change_mains",
});

const BOT_HELPER_PANEL_REQUIRED_CUSTOM_IDS = Object.freeze([
  BOT_HELPER_PANEL_ACTION_IDS.kills,
  BOT_HELPER_PANEL_ACTION_IDS.roblox,
  BOT_HELPER_PANEL_ACTION_IDS.elo,
  BOT_HELPER_PANEL_ACTION_IDS.mains,
]);

function buildBotHelperPanelPayload() {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("Bot Chat Helper")
        .setDescription([
          "Быстрые действия для заявок и привязок.",
          "Нажми нужную кнопку: kills, Roblox, ELO или смена персонажей.",
          `Если чат уедет вниз, бот поднимет это сообщение обратно через ${BOT_HELPER_PANEL_AUTO_RESEND_INTERVAL_HOURS} часов после новой активности под ним.`,
        ].join("\n")),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(BOT_HELPER_PANEL_ACTION_IDS.kills)
          .setLabel("Отправить kills")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(BOT_HELPER_PANEL_ACTION_IDS.roblox)
          .setLabel("Привязать Roblox")
          .setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(BOT_HELPER_PANEL_ACTION_IDS.elo)
          .setLabel("Отправить ELO")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(BOT_HELPER_PANEL_ACTION_IDS.mains)
          .setLabel("Сменить персонажей")
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
  };
}

function parseTimestampMs(value) {
  const timestampMs = Date.parse(String(value || ""));
  return Number.isFinite(timestampMs) ? timestampMs : NaN;
}

function getBotHelperPanelResendDisposition(options = {}) {
  const panelMessageId = String(options.panelMessageId || "").trim();
  const lastChannelMessageId = String(options.lastChannelMessageId || "").trim();
  const intervalMs = Number.isFinite(Number(options.autoResendIntervalMs)) && Number(options.autoResendIntervalMs) > 0
    ? Number(options.autoResendIntervalMs)
    : BOT_HELPER_PANEL_AUTO_RESEND_INTERVAL_MS;
  const nowMs = Number.isFinite(Number(options.now))
    ? Number(options.now)
    : Date.now();
  const lastSentAtMs = parseTimestampMs(options.lastSentAt);
  const hasActivityBelow = Boolean(lastChannelMessageId) && lastChannelMessageId !== panelMessageId;
  const hasValidLastSentAt = Number.isFinite(lastSentAtMs);
  const elapsedMs = hasValidLastSentAt ? Math.max(0, nowMs - lastSentAtMs) : Number.POSITIVE_INFINITY;
  const isOverdue = elapsedMs >= intervalMs;

  return {
    hasActivityBelow,
    hasValidLastSentAt,
    elapsedMs,
    remainingMs: isOverdue ? 0 : Math.max(0, intervalMs - elapsedMs),
    isOverdue,
    needsResend: hasActivityBelow && isOverdue,
  };
}

function buildBotHelperSettingsPayload(options = {}) {
  const channelText = String(options.channelText || "—").trim() || "—";
  const messageText = String(options.messageText || "—").trim() || "—";
  const lastSentText = String(options.lastSentText || "—").trim() || "—";
  const activityText = String(options.activityText || "—").trim() || "—";
  const autoResendText = String(options.autoResendText || `${BOT_HELPER_PANEL_AUTO_RESEND_INTERVAL_HOURS} ч`).trim() || `${BOT_HELPER_PANEL_AUTO_RESEND_INTERVAL_HOURS} ч`;
  const statusText = String(options.statusText || "").trim();

  const embed = new EmbedBuilder()
    .setTitle("Bot helper settings")
    .setDescription([
      "Управление helper-панелью для bot-chat.",
      "Кнопки панели: kills, Roblox, ELO и смена персонажей.",
    ].join("\n"))
    .addFields(
      { name: "Канал", value: channelText, inline: true },
      { name: "Сообщение", value: messageText, inline: true },
      { name: "Авто-переотправка", value: autoResendText, inline: true },
      { name: "Последняя отправка", value: lastSentText, inline: true },
      { name: "Активность под панелью", value: activityText, inline: true }
    );

  if (statusText) {
    embed.addFields({ name: "Статус", value: statusText, inline: false });
  }

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(BOT_HELPER_PANEL_EDITOR_CUSTOM_IDS.setChannel)
          .setLabel("Канал")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(BOT_HELPER_PANEL_EDITOR_CUSTOM_IDS.resendNow)
          .setLabel("Отправить сейчас")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(BOT_HELPER_PANEL_EDITOR_CUSTOM_IDS.refresh)
          .setLabel("Обновить")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(BOT_HELPER_PANEL_EDITOR_CUSTOM_IDS.disable)
          .setLabel("Отключить")
          .setStyle(ButtonStyle.Danger)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(BOT_HELPER_PANEL_EDITOR_CUSTOM_IDS.close)
          .setLabel("Закрыть")
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
  };
}

function getBotHelperPanelRequiredCustomIds() {
  return [...BOT_HELPER_PANEL_REQUIRED_CUSTOM_IDS];
}

module.exports = {
  BOT_HELPER_PANEL_ACTION_IDS,
  BOT_HELPER_PANEL_AUTO_RESEND_INTERVAL_HOURS,
  BOT_HELPER_PANEL_AUTO_RESEND_INTERVAL_MS,
  BOT_HELPER_PANEL_CHANNEL_INPUT_ID,
  BOT_HELPER_PANEL_CONFIG_BUTTON_ID,
  BOT_HELPER_PANEL_CONFIG_MODAL_ID,
  BOT_HELPER_PANEL_EDITOR_CUSTOM_IDS,
  BOT_HELPER_PANEL_REQUIRED_CUSTOM_IDS,
  BOT_HELPER_PANEL_SLOT,
  buildBotHelperPanelPayload,
  buildBotHelperSettingsPayload,
  getBotHelperPanelResendDisposition,
  getBotHelperPanelRequiredCustomIds,
};