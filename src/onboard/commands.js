"use strict";

const { ROLE_PANEL_COMMAND_NAME } = require("../role-panel");

const ONBOARD_SUBCOMMAND_NAMES = [
  "profile",
  "pending",
  "tierlist",
  "stats",
  "panel",
  "welcomeedit",
  "refreshwelcome",
  "refreshavatars",
  "refreshtierlists",
  "graphicpanel",
  "graphicstatus",
  "nonggsstatus",
  "movegraphic",
  "movetext",
  "movenotices",
  "remindmissing",
  "modset",
  "deleteprofile",
  "removetier",
  "syncroles",
];

const TOP_LEVEL_COMMAND_NAMES = ["onboard", ROLE_PANEL_COMMAND_NAME];

function buildCommands() {
  const { SlashCommandBuilder } = require("discord.js");
  return [
    new SlashCommandBuilder()
      .setName("onboard")
      .setDescription("Welcome bot commands")
      .addSubcommand((subcommand) =>
        subcommand
          .setName("profile")
          .setDescription("Показать профиль")
          .addUserOption((option) => option.setName("target").setDescription("Игрок"))
      )
      .addSubcommand((subcommand) =>
        subcommand.setName("pending").setDescription("Показать pending-заявки")
      )
      .addSubcommand((subcommand) =>
        subcommand.setName("tierlist").setDescription("Показать текстовый тир-лист")
      )
      .addSubcommand((subcommand) =>
        subcommand.setName("stats").setDescription("Показать общую статистику")
      )
      .addSubcommand((subcommand) =>
        subcommand.setName("panel").setDescription("Открыть модераторскую панель управления")
      )
      .addSubcommand((subcommand) =>
        subcommand.setName("welcomeedit").setDescription("Открыть редактор welcome и tier-листа")
      )
      .addSubcommand((subcommand) =>
        subcommand.setName("refreshwelcome").setDescription("Обновить live welcome-панель")
      )
      .addSubcommand((subcommand) =>
        subcommand.setName("refreshavatars").setDescription("Обновить аватарки в PNG tier-листе")
      )
      .addSubcommand((subcommand) =>
        subcommand.setName("refreshtierlists").setDescription("Обновить live текстовый и PNG tier-листы")
      )
      .addSubcommand((subcommand) =>
        subcommand.setName("graphicpanel").setDescription("Открыть PNG-панель")
      )
      .addSubcommand((subcommand) =>
        subcommand.setName("graphicstatus").setDescription("Показать статус PNG tier-листа")
      )
      .addSubcommand((subcommand) =>
        subcommand.setName("nonggsstatus").setDescription("Показать статус JJS-капчи и отдельной роли")
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
        subcommand.setName("remindmissing").setDescription("Напомнить всем, кого нет в тир-листе")
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("modset")
          .setDescription("Вручную выставить kills и tier-role")
          .addUserOption((option) => option.setName("target").setDescription("Игрок").setRequired(true))
          .addAttachmentOption((option) => option.setName("screenshot").setDescription("Скрин-пруф").setRequired(true))
          .addIntegerOption((option) => option.setName("kills").setDescription("Точное число kills").setMinValue(0).setRequired(true))
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("deleteprofile")
          .setDescription("Полностью удалить профиль игрока и связанные роли")
          .addUserOption((option) => option.setName("target").setDescription("Игрок").setRequired(true))
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("removetier")
          .setDescription("Снять kill-tier роль")
          .addUserOption((option) => option.setName("target").setDescription("Игрок").setRequired(true))
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("syncroles")
          .setDescription("Синхронизировать kill-tier роли по базе")
          .addUserOption((option) => option.setName("target").setDescription("Игрок"))
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
