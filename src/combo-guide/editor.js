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

function normalizeComboGuideMessageIds(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

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

function normalizeComboGuideCharacterState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  return {
    ...value,
    comboMessageIds: normalizeComboGuideMessageIds(value.comboMessageIds),
    techMessageIds: normalizeComboGuideMessageIds(value.techMessageIds),
  };
}

function normalizeComboGuideState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  return {
    ...value,
    editorRoleIds: normalizeComboGuideEditorRoleIds(value.editorRoleIds),
    generalTechsMessageIds: normalizeComboGuideMessageIds(value.generalTechsMessageIds),
    characters: Array.isArray(value.characters)
      ? value.characters
        .map((character) => normalizeComboGuideCharacterState(character))
        .filter(Boolean)
      : [],
  };
}

function formatComboGuideCharacterTitle(charState) {
  const emoji = String(charState?.emoji || "").trim();
  const name = String(charState?.name || "").trim();
  const label = [emoji, name].filter(Boolean).join(" ").trim();
  if (label) return label;
  const id = String(charState?.id || "").trim();
  return id || "Без названия";
}

// ── Panel ──

/**
 * Build the combo guide moderator panel payload.
 */
function buildComboPanelPayload(guideState, statusText, options = {}) {
  const normalizedGuideState = normalizeComboGuideState(guideState);
  const canManage = options.canManage !== false;
  const canEdit = options.canEdit !== false;
  const editorRoleIds = normalizedGuideState?.editorRoleIds || [];
  const embed = new EmbedBuilder()
    .setTitle("🗺️ Combo Guide — Панель управления")
    .setColor(0x2f3136);

  if (normalizedGuideState?.characters.length) {
    const charList = normalizedGuideState.characters
      .map((c) => formatComboGuideCharacterTitle(c))
      .join("\n");
    embed.addFields({ name: "Персонажи", value: charList, inline: true });
    embed.addFields({
      name: "Канал",
      value: normalizedGuideState.channelId ? `<#${normalizedGuideState.channelId}>` : "Не задан",
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

  const hasGuide = normalizedGuideState?.characters.length > 0;

  const components = [];

  if (hasGuide && canEdit) {
    // Character select menu
    const charOptions = normalizedGuideState.characters.map((c) => ({
      label: formatComboGuideCharacterTitle(c).slice(0, 100),
      value: c.id,
      description: `${c.comboMessageIds.length} комбо, ${c.techMessageIds.length} тех`,
    }));

    // Add general techs option if exists
    if (normalizedGuideState.generalTechsThreadId) {
      charOptions.unshift({
        label: "🛠️ Общие техи",
        value: "__general_techs__",
        description: `${normalizedGuideState.generalTechsMessageIds.length} сообщений`,
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
        new ButtonBuilder()
          .setCustomId("combo_panel_pick_editor_role")
          .setLabel("Добавить или убрать роль")
          .setStyle(ButtonStyle.Primary)
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
  const normalizedGuideState = normalizeComboGuideState(guideState) || {
    generalTechsMessageIds: [],
    characters: [],
  };
  const normalizedCharState = charState === "__general_techs__"
    ? "__general_techs__"
    : normalizeComboGuideCharacterState(charState);
  const canManage = options.canManage !== false;
  const isGeneral = normalizedCharState === "__general_techs__";
  const messageOptions = [];

  if (isGeneral) {
    for (let i = 0; i < normalizedGuideState.generalTechsMessageIds.length; i++) {
      messageOptions.push({
        label: `Общие техи — сообщение ${i + 1}`,
        value: `general_tech:${normalizedGuideState.generalTechsMessageIds[i]}`,
      });
    }
  } else if (normalizedCharState) {
    // Combo messages
    for (let i = 0; i < normalizedCharState.comboMessageIds.length; i++) {
      messageOptions.push({
        label: `Комбо — сообщение ${i + 1}`,
        value: `combo:${normalizedCharState.comboMessageIds[i]}`,
        description: `В канале`,
      });
    }

    // Tech messages in thread
    for (let i = 0; i < normalizedCharState.techMessageIds.length; i++) {
      messageOptions.push({
        label: `Тех — сообщение ${i + 1}`,
        value: `tech:${normalizedCharState.techMessageIds[i]}:${normalizedCharState.threadId}`,
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

  const title = isGeneral ? "🛠️ Общие техи" : formatComboGuideCharacterTitle(normalizedCharState);

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
          .setCustomId(`combo_panel_remove_char:${normalizedCharState.id}`)
          .setLabel(`Удалить ${String(normalizedCharState.name || normalizedCharState.id || "персонажа")}`)
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
  normalizeComboGuideState,
  normalizeComboGuideEditorRoleIds,
};
