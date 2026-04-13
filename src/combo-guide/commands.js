"use strict";

function buildComboCommands() {
  const { SlashCommandBuilder, ChannelType } = require("discord.js");

  return new SlashCommandBuilder()
    .setName("combo")
    .setDescription("Комбо-гайды: публикация, редактирование, панель")
    .addSubcommand((sub) =>
      sub
        .setName("publish")
        .setDescription("Опубликовать полный комбо-гайд в канал")
        .addAttachmentOption((opt) =>
          opt.setName("combo_file").setDescription("Файл комбо (.txt)").setRequired(true)
        )
        .addAttachmentOption((opt) =>
          opt.setName("techs_file").setDescription("Файл техов (.txt)").setRequired(true)
        )
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("Канал для публикации")
            .addChannelTypes(0) // GuildText
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Добавить персонажа в существующий гайд")
        .addAttachmentOption((opt) =>
          opt.setName("combo_file").setDescription("Файл комбо нового персонажа (.txt)").setRequired(true)
        )
        .addAttachmentOption((opt) =>
          opt.setName("techs_file").setDescription("Файл техов нового персонажа (.txt)").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("panel")
        .setDescription("Показать панель управления комбо-гайдом")
    )
    .addSubcommand((sub) =>
      sub
        .setName("refresh")
        .setDescription("Обновить навигацию комбо-гайда")
    )
    .toJSON();
}

module.exports = { buildComboCommands };
