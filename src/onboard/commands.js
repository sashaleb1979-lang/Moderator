"use strict";

const { ROLE_PANEL_COMMAND_NAME } = require("../role-panel");
const { ANTITEAM_COMMAND_NAME } = require("../antiteam/view");
const { VERIFY_COMMAND_NAME, VERIFY_SUBCOMMAND_NAMES } = require("../verification/operator");
const { ANALYTICS_COMMAND_NAME } = require("../analytics/panel");

const PROFILE_COMMAND_NAME = "профиль";

const ONBOARD_SUBCOMMAND_NAMES = [
  "activitystatus",
  "panel",
  "sotreport",
  "welcomeedit",
  "movegraphic",
  "movetext",
  "movenotices",
  "modset",
  "nonfake",
  "robloxauth",
  "deleteprofile",
  "removetier",
];

const TOP_LEVEL_COMMAND_NAMES = ["onboard", ROLE_PANEL_COMMAND_NAME, VERIFY_COMMAND_NAME, PROFILE_COMMAND_NAME, ANTITEAM_COMMAND_NAME, ANALYTICS_COMMAND_NAME];

function buildCommands() {
  const { SlashCommandBuilder } = require("discord.js");
  const onboardCommand = new SlashCommandBuilder()
      .setName("onboard")
      .setDescription("Welcome bot commands")
      .addSubcommand((subcommand) =>
        subcommand
          .setName("activitystatus")
          .setDescription("Временно вручную поставить activity статус или вернуть auto")
          .addStringOption((option) =>
            option
              .setName("status")
              .setDescription("Какой activity статус выставить")
              .setRequired(true)
              .addChoices(
                { name: "Авто (снять override)", value: "auto" },
                { name: "Newcomer", value: "newcomer" },
                { name: "Dead", value: "dead" },
                { name: "Weak", value: "weak" },
                { name: "Floating", value: "floating" },
                { name: "Active", value: "active" },
                { name: "Stable", value: "stable" },
                { name: "Core", value: "core" }
              )
          )
          .addUserOption((option) => option.setName("target").setDescription("Игрок (если в сервере)"))
          .addStringOption((option) => option.setName("user_id").setDescription("ID игрока (если вышел из сервера)"))
          .addStringOption((option) => option.setName("note").setDescription("Короткая заметка для audit log").setMaxLength(300))
      )
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
          .setName("nonfake")
          .setDescription("Управлять remembered списком не фейкостановцев")
          .addStringOption((option) =>
            option
              .setName("action")
              .setDescription("Что сделать")
              .setRequired(true)
              .addChoices(
                { name: "Добавить", value: "add" },
                { name: "Убрать", value: "remove" },
                { name: "Показать список", value: "list" }
              )
          )
          .addUserOption((option) => option.setName("target").setDescription("Игрок (если в сервере)"))
          .addStringOption((option) =>
            option
              .setName("targets")
              .setDescription("Несколько user mention/ID через пробел, запятую или новую строку")
              .setMaxLength(1000)
          )
          .addStringOption((option) => option.setName("user_id").setDescription("ID игрока, если пользователя нет в сервере"))
          .addStringOption((option) =>
            option
              .setName("user_ids")
              .setDescription("Несколько user mention/ID через пробел, запятую или новую строку")
              .setMaxLength(1000)
          )
          .addRoleOption((option) => option.setName("role").setDescription("Добавить или убрать всех участников с этой роли"))
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("robloxauth")
          .setDescription("Вручную подтвердить Roblox username игрока")
          .addStringOption((option) => option.setName("roblox_username").setDescription("Roblox username").setRequired(true))
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
      );

  return [
    onboardCommand,
    new SlashCommandBuilder()
      .setName(ROLE_PANEL_COMMAND_NAME)
      .setDescription("Открыть панель выдачи и массового снятия ивент-ролей"),
    new SlashCommandBuilder()
      .setName(VERIFY_COMMAND_NAME)
      .setDescription("Открыть автономную verification-панель")
      .addSubcommand((subcommand) =>
        subcommand.setName("panel").setDescription("Открыть verification-панель")
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("add")
          .setDescription("Поставить участника на verification и выдать verify-роль")
          .addUserOption((option) => option.setName("target").setDescription("Участник сервера").setRequired(true))
          .addStringOption((option) => option.setName("note").setDescription("Заметка модератора для запуска проверки"))
      ),
    new SlashCommandBuilder()
      .setName(PROFILE_COMMAND_NAME)
      .setDescription("Открыть приватный профиль игрока")
      .addUserOption((option) => option.setName("target").setDescription("Чей профиль открыть")),
    new SlashCommandBuilder()
      .setName(ANTITEAM_COMMAND_NAME)
      .setDescription("Антитим и клан-вары")
      .addSubcommand((subcommand) =>
        subcommand.setName("panel").setDescription("Открыть панель настройки антитима")
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("clan")
          .setDescription("Создать ФАЙТ С КЛАНОМ для батальона")
          .addUserOption((option) => option
            .setName("target")
            .setDescription("Игрок-якорь, который уже сидит на сервере и не должен выходить")
            .setRequired(true))
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("points")
          .setDescription("Начислить или убрать очки помощи антитима")
          .addStringOption((option) =>
            option
              .setName("action")
              .setDescription("Что сделать с очками")
              .setRequired(true)
              .addChoices(
                { name: "Начислить", value: "add" },
                { name: "Убрать", value: "remove" }
              )
          )
          .addIntegerOption((option) =>
            option
              .setName("amount")
              .setDescription("Сколько очков применить каждому выбранному участнику")
              .setMinValue(1)
              .setMaxValue(1000)
              .setRequired(true)
          )
          .addUserOption((option) => option.setName("target").setDescription("Один участник сервера"))
          .addStringOption((option) =>
            option
              .setName("targets")
              .setDescription("Несколько user mention/ID через пробел, запятую или новую строку")
              .setMaxLength(1200)
          )
          .addStringOption((option) => option.setName("user_id").setDescription("ID игрока, если пользователя нет в сервере"))
          .addStringOption((option) =>
            option
              .setName("user_ids")
              .setDescription("Несколько Discord ID через пробел, запятую или новую строку")
              .setMaxLength(1200)
          )
          .addRoleOption((option) => option.setName("role").setDescription("Применить всем участникам с этой ролью"))
          .addStringOption((option) => option.setName("note").setDescription("Короткая заметка для audit log").setMaxLength(300))
      ),
    new SlashCommandBuilder()
      .setName(ANALYTICS_COMMAND_NAME)
      .setDescription("Открыть личную панель статистики бота")
      .addSubcommand((subcommand) =>
        subcommand.setName("panel").setDescription("Открыть analytics-панель")
      ),
  ].map((command) => command.toJSON());
}

module.exports = {
  ONBOARD_SUBCOMMAND_NAMES,
  ANTITEAM_COMMAND_NAME,
  ANALYTICS_COMMAND_NAME,
  PROFILE_COMMAND_NAME,
  ROLE_PANEL_COMMAND_NAME,
  TOP_LEVEL_COMMAND_NAMES,
  VERIFY_COMMAND_NAME,
  VERIFY_SUBCOMMAND_NAMES,
  buildCommands,
};
