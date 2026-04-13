"use strict";

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

const DISCORD_HARD_LIMIT = 2000;
const MODAL_TEXT_LIMIT = 4000;

// ── Panel ──

/**
 * Build the combo guide moderator panel payload.
 */
function buildComboPanelPayload(guideState, statusText) {
  const embed = new EmbedBuilder()
    .setTitle("🗺️ Combo Guide — Панель управления")
    .setColor(0x2f3136);

  if (guideState && guideState.characters && guideState.characters.length) {
    const charList = guideState.characters
      .map((c) => `${c.emoji} ${c.name}`)
      .join("\n");
    embed.addFields({ name: "Персонажи", value: charList, inline: true });
    embed.addFields({
      name: "Канал",
      value: guideState.channelId ? `<#${guideState.channelId}>` : "Не задан",
      inline: true,
    });
  } else {
    embed.setDescription("Гайд ещё не опубликован. Используй `/combo publish`.");
  }

  if (statusText) {
    embed.setFooter({ text: statusText });
  }

  const hasGuide = guideState && guideState.characters && guideState.characters.length > 0;

  const components = [];

  if (hasGuide) {
    // Character select menu
    const charOptions = guideState.characters.map((c) => ({
      label: `${c.emoji} ${c.name}`.slice(0, 100),
      value: c.id,
      description: `${c.comboMessageIds.length} комбо, ${c.techMessageIds.length} тех`,
    }));

    // Add general techs option if exists
    if (guideState.generalTechsThreadId) {
      charOptions.unshift({
        label: "🛠️ Общие техи",
        value: "__general_techs__",
        description: `${guideState.generalTechsMessageIds.length} сообщений`,
      });
    }

    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("combo_select_character")
          .setPlaceholder("Выбери персонажа для редактирования…")
          .addOptions(charOptions.slice(0, 25))
      )
    );

    // Action buttons
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("combo_panel_refresh_nav")
          .setLabel("Обновить навигацию")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("🔄"),
        new ButtonBuilder()
          .setCustomId("combo_panel_republish")
          .setLabel("Перезалить всё")
          .setStyle(ButtonStyle.Danger)
          .setEmoji("♻️")
      )
    );
  }

  return {
    embeds: [embed],
    components,
  };
}

/**
 * Build the message selection payload for a chosen character.
 * Returns an ephemeral reply with a select menu of all messages.
 */
function buildMessageSelectPayload(charState, guideState) {
  const isGeneral = charState === "__general_techs__";
  const options = [];

  if (isGeneral) {
    for (let i = 0; i < guideState.generalTechsMessageIds.length; i++) {
      options.push({
        label: `Общие техи — сообщение ${i + 1}`,
        value: `general_tech:${guideState.generalTechsMessageIds[i]}`,
      });
    }
  } else {
    // Combo messages
    for (let i = 0; i < charState.comboMessageIds.length; i++) {
      options.push({
        label: `Комбо — сообщение ${i + 1}`,
        value: `combo:${charState.comboMessageIds[i]}`,
        description: `В канале`,
      });
    }

    // Tech messages in thread
    for (let i = 0; i < charState.techMessageIds.length; i++) {
      options.push({
        label: `Тех — сообщение ${i + 1}`,
        value: `tech:${charState.techMessageIds[i]}:${charState.threadId}`,
        description: `В ветке`,
      });
    }
  }

  if (!options.length) {
    return {
      content: "У этого персонажа нет сообщений для редактирования.",
      ephemeral: true,
    };
  }

  const title = isGeneral ? "🛠️ Общие техи" : `${charState.emoji} ${charState.name}`;

  const components = [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("combo_select_message")
        .setPlaceholder("Выбери сообщение…")
        .addOptions(options.slice(0, 25))
    ),
  ];

  // Add remove button for characters (not general techs)
  if (!isGeneral) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`combo_panel_remove_char:${charState.id}`)
          .setLabel(`Удалить ${charState.name}`)
          .setStyle(ButtonStyle.Danger)
          .setEmoji("🗑️")
      )
    );
  }

  return {
    content: `**${title}** — выбери сообщение:`,
    components,
    ephemeral: true,
  };
}

/**
 * Build modal for editing a message's content.
 */
function buildEditModal(messageId, currentContent) {
  return new ModalBuilder()
    .setCustomId(`combo_edit_message:${messageId}`)
    .setTitle("Редактирование сообщения")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("content")
          .setLabel("Содержимое")
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(MODAL_TEXT_LIMIT)
          .setValue(currentContent.slice(0, MODAL_TEXT_LIMIT))
          .setRequired(true)
      )
    );
}

/**
 * Handle the message edit modal submission.
 * Returns { success, error? }
 */
async function handleEditSubmission(interaction, channel, guideState) {
  const msgId = interaction.customId.replace("combo_edit_message:", "");
  const newContent = interaction.fields.getTextInputValue("content");

  if (newContent.length > DISCORD_HARD_LIMIT) {
    return {
      success: false,
      error: `Слишком длинное сообщение: ${newContent.length}/${DISCORD_HARD_LIMIT} символов.`,
    };
  }

  // Determine where this message is (channel or thread)
  const threadId = interaction._comboEditThreadId; // set by the select handler

  try {
    let targetChannel = channel;
    if (threadId) {
      targetChannel = await channel.threads.fetch(threadId).catch(() => null);
      if (!targetChannel) {
        // Try fetching as a channel directly (thread IDs are channel IDs)
        targetChannel = await channel.guild.channels.fetch(threadId).catch(() => null);
      }
    }

    if (!targetChannel) {
      return { success: false, error: "Не удалось найти канал/ветку для этого сообщения." };
    }

    const msg = await targetChannel.messages.fetch(msgId);
    await msg.edit({ content: newContent });
    return { success: true };
  } catch (e) {
    return { success: false, error: `Ошибка редактирования: ${e.message}` };
  }
}

module.exports = {
  buildComboPanelPayload,
  buildMessageSelectPayload,
  buildEditModal,
  handleEditSubmission,
};
