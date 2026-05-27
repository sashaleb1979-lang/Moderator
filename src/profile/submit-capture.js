"use strict";

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");

const PROFILE_SUBMIT_CAPTURE_TTL_MS = 5 * 60 * 1000;
const PROFILE_SUBMIT_CANCEL_CUSTOM_ID = "profile_submit_cancel";
const PROFILE_SUBMIT_ACTIONS = Object.freeze({
  KILLS: "kills",
  ELO: "elo",
});

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function normalizeAction(value = "") {
  const action = cleanString(value, 40).toLowerCase();
  return Object.values(PROFILE_SUBMIT_ACTIONS).includes(action) ? action : "";
}

function normalizeNowMs(value = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Date.now();
}

function createProfileSubmitCaptureStore(options = {}) {
  const ttlMs = Math.max(1000, Number(options.ttlMs) || PROFILE_SUBMIT_CAPTURE_TTL_MS);
  const sessions = new Map();

  function start(userId, input = {}) {
    const normalizedUserId = cleanString(userId, 80);
    const action = normalizeAction(input.action);
    const channelId = cleanString(input.channelId, 80);
    if (!normalizedUserId || !action || !channelId) return null;

    const startedAtMs = normalizeNowMs(input.nowMs);
    const session = {
      userId: normalizedUserId,
      action,
      channelId,
      source: cleanString(input.source, 80) || "profile_button",
      sourceMessageId: cleanString(input.sourceMessageId, 80) || null,
      interactionId: cleanString(input.interactionId, 80) || null,
      mainCharacterIds: Array.isArray(input.mainCharacterIds)
        ? input.mainCharacterIds.map((entry) => cleanString(entry, 80)).filter(Boolean).slice(0, 2)
        : [],
      startedAtMs,
      expiresAtMs: startedAtMs + ttlMs,
    };
    sessions.set(normalizedUserId, session);
    return { ...session };
  }

  function peek(userId) {
    const normalizedUserId = cleanString(userId, 80);
    const session = normalizedUserId ? sessions.get(normalizedUserId) : null;
    return session ? { ...session, mainCharacterIds: [...session.mainCharacterIds] } : null;
  }

  function get(userId, options = {}) {
    const session = peek(userId);
    if (!session) return null;
    const nowMs = normalizeNowMs(options.nowMs);
    if (nowMs >= Number(session.expiresAtMs || 0)) {
      sessions.delete(session.userId);
      return null;
    }
    return session;
  }

  function clear(userId) {
    const session = peek(userId);
    if (session) sessions.delete(session.userId);
    return session;
  }

  function clearExpired(options = {}) {
    const nowMs = normalizeNowMs(options.nowMs);
    const expired = [];
    for (const [userId, session] of sessions.entries()) {
      if (nowMs >= Number(session.expiresAtMs || 0)) {
        expired.push({ ...session });
        sessions.delete(userId);
      }
    }
    return expired;
  }

  return {
    clear,
    clearExpired,
    get,
    peek,
    start,
    ttlMs,
  };
}

function buildCancelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(PROFILE_SUBMIT_CANCEL_CUSTOM_ID)
      .setLabel("Отменить")
      .setStyle(ButtonStyle.Secondary)
  );
}

function buildProfileKillsSubmitCapturePayload(options = {}) {
  const channelText = cleanString(options.channelText, 200) || "этот чат";
  const mainsText = cleanString(options.mainsText, 300);
  const noticeText = cleanString(options.noticeText, 1000);
  const lines = [];
  if (noticeText) lines.push(noticeText);
  lines.push(`Следующим сообщением отправь заявку в ${channelText}.`);
  lines.push("Формат: одно точное число kills в тексте + скрин во вложении.");
  lines.push("Если отправишь лишнее сообщение в этом чате, бот удалит только его и будет ждать правильную заявку до 5 минут.");
  if (mainsText) lines.push(`Мейны: ${mainsText}.`);

  return {
    embeds: [
      new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle("Следующее сообщение — заявка на kills")
        .setDescription(lines.join("\n")),
    ],
    components: [buildCancelRow()],
    flags: MessageFlags.Ephemeral,
  };
}

function buildProfileEloSubmitCapturePayload(options = {}) {
  const channelText = cleanString(options.channelText, 200) || "этот чат";
  const noticeText = cleanString(options.noticeText, 1000);
  const lines = [];
  if (noticeText) lines.push(noticeText);
  lines.push(`Следующим сообщением отправь ELO-заявку в ${channelText}.`);
  lines.push("Формат: число ELO в тексте + скрин во вложении.");
  lines.push("Если отправишь лишнее сообщение в этом чате, бот удалит только его и будет ждать правильную заявку до 5 минут.");

  return {
    embeds: [
      new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle("Следующее сообщение — ELO заявка")
        .setDescription(lines.join("\n")),
    ],
    components: [buildCancelRow()],
    flags: MessageFlags.Ephemeral,
  };
}

function buildProfileSubmitCancelledPayload(action = "") {
  const normalizedAction = normalizeAction(action);
  const label = normalizedAction === PROFILE_SUBMIT_ACTIONS.ELO ? "ELO" : "kills";
  return {
    content: `Ок. Ожидание ${label}-заявки отменено.`,
    embeds: [],
    components: [],
    flags: MessageFlags.Ephemeral,
  };
}

module.exports = {
  PROFILE_SUBMIT_ACTIONS,
  PROFILE_SUBMIT_CANCEL_CUSTOM_ID,
  PROFILE_SUBMIT_CAPTURE_TTL_MS,
  buildProfileEloSubmitCapturePayload,
  buildProfileKillsSubmitCapturePayload,
  buildProfileSubmitCancelledPayload,
  createProfileSubmitCaptureStore,
};
