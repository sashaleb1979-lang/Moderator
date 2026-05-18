"use strict";

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");
const {
  toButtonEmoji,
  toEmojiMention,
} = require("./character-emojis");

const CHARACTER_PICKER_COLUMNS = 5;
const CHARACTER_PICKER_ROWS = 4;
const CHARACTER_PICKER_PAGE_SIZE = CHARACTER_PICKER_COLUMNS * CHARACTER_PICKER_ROWS;

function cleanString(value, limit = 256) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function previewText(value, limit = 80) {
  const text = cleanString(value, limit);
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(1, limit - 1)).trimEnd()}…`;
}

function maybeEphemeral(payload, includeEphemeralFlag = true) {
  return includeEphemeralFlag === false ? payload : { ...payload, flags: MessageFlags.Ephemeral };
}

function paginateCharacterPickerEntries(entries = [], rawPage = 0, pageSize = CHARACTER_PICKER_PAGE_SIZE) {
  const safeEntries = Array.isArray(entries) ? entries : [];
  const safePageSize = Math.max(1, Number(pageSize) || CHARACTER_PICKER_PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(safeEntries.length / safePageSize));
  const page = Math.min(Math.max(0, Number(rawPage) || 0), pageCount - 1);
  const start = page * safePageSize;
  return {
    items: safeEntries.slice(start, start + safePageSize),
    totalCount: safeEntries.length,
    page,
    pageCount,
    hasPrev: page > 0,
    hasNext: page + 1 < pageCount,
    startIndex: start,
  };
}

function toggleCharacterPickerSelection(selectedIds = [], characterId = "", options = {}) {
  const max = Math.max(1, Number(options.max) || 2);
  const id = cleanString(characterId, 120);
  const current = [...new Set(
    (Array.isArray(selectedIds) ? selectedIds : [])
      .map((value) => cleanString(value, 120))
      .filter(Boolean)
  )].slice(0, max);
  if (!id) return { selectedIds: current, blocked: true, reason: "unknown-character" };
  if (current.includes(id)) {
    return { selectedIds: current.filter((value) => value !== id), blocked: false, reason: "removed" };
  }
  if (current.length >= max) {
    return { selectedIds: current, blocked: true, reason: "max-selected" };
  }
  return { selectedIds: [...current, id], blocked: false, reason: "added" };
}

function formatCharacterLabel(entry = {}, characterEmojis = {}) {
  const mention = toEmojiMention(characterEmojis[entry.id]);
  const label = cleanString(entry.label || entry.id, 120);
  return [mention, label].filter(Boolean).join(" ");
}

function buildCharacterButton(entry, options = {}) {
  const {
    number,
    selected,
    characterEmojis,
  } = options;
  const emoji = toButtonEmoji(characterEmojis[entry.id]);
  const numberText = String(number).padStart(2, "0");
  const label = emoji
    ? previewText(`${numberText} ${entry.label || entry.id}`, 80)
    : previewText(`${numberText} ${entry.label || entry.id}`, 80);
  const button = new ButtonBuilder()
    .setCustomId(`onboard_main_toggle:${entry.id}`)
    .setLabel(label)
    .setStyle(selected ? ButtonStyle.Success : ButtonStyle.Secondary);
  if (emoji) button.setEmoji(emoji);
  return button;
}

function buildCharacterButtonRows(picker, pageInfo, characterEmojis = {}) {
  const rows = [];
  for (let rowIndex = 0; rowIndex < CHARACTER_PICKER_ROWS; rowIndex += 1) {
    const rowItems = pageInfo.items.slice(rowIndex * CHARACTER_PICKER_COLUMNS, rowIndex * CHARACTER_PICKER_COLUMNS + CHARACTER_PICKER_COLUMNS);
    if (!rowItems.length) break;
    const row = new ActionRowBuilder();
    for (const [index, entry] of rowItems.entries()) {
      const number = pageInfo.startIndex + rowIndex * CHARACTER_PICKER_COLUMNS + index + 1;
      row.addComponents(buildCharacterButton(entry, {
        number,
        selected: picker.selectedIds.includes(entry.id),
        characterEmojis,
      }));
    }
    rows.push(row);
  }
  return rows;
}

function buildCharacterPickerControlRow(picker, pageInfo) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("onboard_main_prev")
      .setLabel("Назад")
      .setEmoji("◀️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!pageInfo.hasPrev),
    new ButtonBuilder()
      .setCustomId("onboard_main_confirm")
      .setLabel(picker.mode === "quick" ? "Сохранить" : "Готово")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!picker.selectedIds.length),
    new ButtonBuilder()
      .setCustomId("onboard_cancel")
      .setLabel("Отмена")
      .setEmoji("✖️")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("onboard_main_next")
      .setLabel("Дальше")
      .setEmoji("▶️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!pageInfo.hasNext)
  );
}

function buildCharacterPickerStatusPayload(message, options = {}) {
  const payload = {
    content: cleanString(message, 1500) || "Сессия выбора мейнов недоступна.",
  };
  if (options.forUpdate) {
    payload.embeds = [];
    payload.components = [];
    payload.attachments = [];
  }
  return maybeEphemeral(payload, options.includeEphemeralFlag);
}

function buildCharacterPickerPayload(options = {}) {
  const entries = Array.isArray(options.entries) ? options.entries : [];
  const picker = options.picker || {};
  const characterEmojis = options.characterEmojis && typeof options.characterEmojis === "object" ? options.characterEmojis : {};
  const selectedIds = Array.isArray(picker.selectedIds) ? picker.selectedIds : [];

  if (!picker || !Array.isArray(picker.selectedIds)) {
    return buildCharacterPickerStatusPayload("Сессия выбора мейнов истекла. Нажми кнопку заново.", options);
  }
  if (!entries.length) {
    return buildCharacterPickerStatusPayload("Нет доступных персонажей. Проверь конфигурацию characters в bot.config.json.", options);
  }

  const pageInfo = paginateCharacterPickerEntries(entries, picker.page, CHARACTER_PICKER_PAGE_SIZE);
  const isQuick = picker.mode === "quick";
  const selectedLabels = selectedIds
    .map((id) => entries.find((entry) => entry.id === id))
    .filter(Boolean)
    .map((entry) => formatCharacterLabel(entry, characterEmojis));

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(isQuick ? "Смена мейнов" : "Выбор мейнов")
    .setDescription([
      "`1-2` мейна. Жми кнопку персонажа; зелёные уже выбраны.",
      selectedLabels.length ? `**Выбрано:** ${selectedLabels.join(", ")}` : "**Выбрано:** пока пусто",
      pageInfo.pageCount > 1 ? `**Страница:** ${pageInfo.page + 1}/${pageInfo.pageCount}` : null,
      cleanString(picker.statusText, 220) ? `_${cleanString(picker.statusText, 220)}_` : null,
    ].filter(Boolean).join("\n"));

  const payload = {
    embeds: [embed],
    components: [
      ...buildCharacterButtonRows(picker, pageInfo, characterEmojis),
      buildCharacterPickerControlRow(picker, pageInfo),
    ],
  };
  if (options.forUpdate) payload.attachments = [];
  return maybeEphemeral(payload, options.includeEphemeralFlag);
}

module.exports = {
  CHARACTER_PICKER_COLUMNS,
  CHARACTER_PICKER_PAGE_SIZE,
  CHARACTER_PICKER_ROWS,
  buildCharacterPickerPayload,
  buildCharacterPickerStatusPayload,
  paginateCharacterPickerEntries,
  toggleCharacterPickerSelection,
};
