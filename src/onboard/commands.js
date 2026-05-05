"use strict";

const { ROLE_PANEL_COMMAND_NAME } = require("../role-panel");

const ONBOARD_SUBCOMMAND_NAMES = [
  "panel",
  "sotreport",
  "welcomeedit",
  "movegraphic",
  "movetext",
  "movenotices",
  "modset",
  "deleteprofile",
  "removetier",
];

const TOP_LEVEL_COMMAND_NAMES = ["onboard", ROLE_PANEL_COMMAND_NAME];

function buildCommands() {
  const { SlashCommandBuilder } = require("discord.js");
  return [
    new SlashCommandBuilder()
      .setName("onboard")
      .setDescription("Welcome bot commands")
      .addSubcommand((subcommand) =>
        subcommand.setName("panel").setDescription("Открыть модераторскую панель управления")
      )
      .addSubcommand((subcommand) =>
        subcommand.setName("sotreport").setDescription("Показать ground-truth отчёт по текущим источникам данных")
      )
      .addSubcommand((subcommand) =>
        subcommand.setName("welcomeedit").setDescription("Открыть редактор welcome и tier-листа")
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("movegraphic")
          .setDescription("Перезалить графический тир-лист в другой канал")
          .addChannelOption((option) => option.setName("channel").setDescription("Канал для PNG тир-листа").setRequired(true))
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("movetext")
          .setDescription("Перенести текстовый тир-лист в другой канал")
          .addChannelOption((option) => option.setName("channel").setDescription("Канал для текстового тир-листа").setRequired(true))
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("movenotices")
          .setDescription("Перенести канал уведомлений и логов бота")
          .addChannelOption((option) => option.setName("channel").setDescription("Канал для уведомлений бота").setRequired(true))
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("modset")
          .setDescription("Вручную выставить kills и tier-role")
          .addAttachmentOption((option) => option.setName("screenshot").setDescription("Скрин-пруф").setRequired(true))
          .addIntegerOption((option) => option.setName("kills").setDescription("Точное число kills").setMinValue(0).setRequired(true))
          .addUserOption((option) => option.setName("target").setDescription("Игрок (если в сервере)"))
          .addStringOption((option) => option.setName("user_id").setDescription("ID игрока (если вышел из сервера)"))
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("deleteprofile")
          .setDescription("Полностью удалить профиль игрока и связанные роли")
          .addUserOption((option) => option.setName("target").setDescription("Игрок (если в сервере)"))
          .addStringOption((option) => option.setName("user_id").setDescription("ID игрока (если вышел из сервера)"))
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("removetier")
          .setDescription("Снять kill-tier роль")
          .addUserOption((option) => option.setName("target").setDescription("Игрок (если в сервере)"))
          .addStringOption((option) => option.setName("user_id").setDescription("ID игрока (если вышел из сервера)"))
      ),
    new SlashCommandBuilder()
      .setName(ROLE_PANEL_COMMAND_NAME)
      .setDescription("Открыть панель выдачи и массового снятия ивент-ролей"),
  ].map((command) => command.toJSON());
}

module.exports = {
  ONBOARD_SUBCOMMAND_NAMES,
  ROLE_PANEL_COMMAND_NAME,
  TOP_LEVEL_COMMAND_NAMES,
  buildCommands,
};
