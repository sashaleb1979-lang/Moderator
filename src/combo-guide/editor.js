"use strict";

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

const DISCORD_HARD_LIMIT = 2000;
const MODAL_TEXT_LIMIT = 4000;

function normalizeComboGuideEditorRoleIds(value) {
  if (!Array.isArray(value)) return [];

  const seen = new Set();
  const normalized = [];

  for (const entry of value) {
    const roleId = String(entry || "").trim();
    if (!roleId || seen.has(roleId)) continue;
    seen.add(roleId);
    normalized.push(roleId);
  }

  return normalized.slice(0, 25);
}

function formatComboGuideEditorRoleList(roleIds) {
  if (!roleIds.length) return "Только модераторы";
  return roleIds.map((roleId) => `<@&${roleId}>`).join("\n");
}

// ── Panel ──

/**
 * Build the combo guide moderator panel payload.
 */
function buildComboPanelPayload(guideState, statusText, options = {}) {
  const canManage = options.canManage !== false;
  const canEdit = options.canEdit !== false;
  const editorRoleIds = normalizeComboGuideEditorRoleIds(guideState?.editorRoleIds);
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

  embed.addFields({
    name: "Доп. доступ к панели",
    value: formatComboGuideEditorRoleList(editorRoleIds),
    inline: true,
  });

  if (statusText) {
    embed.setFooter({ text: statusText });
  }

  const hasGuide = guideState && guideState.characters && guideState.characters.length > 0;

  const components = [];

  if (hasGuide && canEdit) {
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
  }

  if (hasGuide && canManage) {
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

  if (canManage) {
    components.push(
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId("combo_panel_editor_roles")
          .setPlaceholder("Выбери роли с доступом к панели редактирования…")
          .setMinValues(0)
          .setMaxValues(25)
      )
    );

    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("combo_panel_clear_editor_roles")
          .setLabel("Сбросить доп. роли")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(!editorRoleIds.length)
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
function buildMessageSelectPayload(charState, guideState, options = {}) {
  const canManage = options.canManage !== false;
  const isGeneral = charState === "__general_techs__";
  const messageOptions = [];

  if (isGeneral) {
    for (let i = 0; i < guideState.generalTechsMessageIds.length; i++) {
      messageOptions.push({
        label: `Общие техи — сообщение ${i + 1}`,
        value: `general_tech:${guideState.generalTechsMessageIds[i]}`,
      });
    }
  } else {
    // Combo messages
    for (let i = 0; i < charState.comboMessageIds.length; i++) {
      messageOptions.push({
        label: `Комбо — сообщение ${i + 1}`,
        value: `combo:${charState.comboMessageIds[i]}`,
        description: `В канале`,
      });
    }

    // Tech messages in thread
    for (let i = 0; i < charState.techMessageIds.length; i++) {
      messageOptions.push({
        label: `Тех — сообщение ${i + 1}`,
        value: `tech:${charState.techMessageIds[i]}:${charState.threadId}`,
        description: `В ветке`,
      });
    }
  }

  if (!messageOptions.length) {
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
        .addOptions(messageOptions.slice(0, 25))
    ),
  ];

  // Add remove button for characters (not general techs)
  if (!isGeneral && canManage) {
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
  normalizeComboGuideEditorRoleIds,
};
