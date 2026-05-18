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

function getBotHelperPanelRequiredCustomIds() {
  return [...BOT_HELPER_PANEL_REQUIRED_CUSTOM_IDS];
}

module.exports = {
  BOT_HELPER_PANEL_ACTION_IDS,
  BOT_HELPER_PANEL_CHANNEL_INPUT_ID,
  BOT_HELPER_PANEL_CONFIG_BUTTON_ID,
  BOT_HELPER_PANEL_CONFIG_MODAL_ID,
  BOT_HELPER_PANEL_REQUIRED_CUSTOM_IDS,
  BOT_HELPER_PANEL_SLOT,
  buildBotHelperPanelPayload,
  getBotHelperPanelRequiredCustomIds,
};