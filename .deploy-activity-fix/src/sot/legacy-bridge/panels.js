"use strict";

function cleanString(value, limit = 80) {
  return String(value || "").trim().slice(0, limit);
}

function applyPanelValue(state, key, value) {
  if (!state || typeof state !== "object") return;
  if (!Object.prototype.hasOwnProperty.call(state, key)) return;
  const nextValue = cleanString(value, 80);
  if (!nextValue) return;
  state[key] = nextValue;
}

function syncLegacyPanelSnapshot(state, snapshot = {}) {
  if (!state || typeof state !== "object") return state;
  const source = snapshot && typeof snapshot === "object" ? snapshot : {};

  applyPanelValue(state, "channelId", source.channelId);
  applyPanelValue(state, "messageId", source.messageId);
  return state;
}

function syncLegacyTextTierlistBoardSnapshot(state, snapshot = {}) {
  if (!state || typeof state !== "object") return state;
  const source = snapshot && typeof snapshot === "object" ? snapshot : {};
  const nextMessageId = cleanString(source.messageId, 80);
  const nextSummaryMessageId = cleanString(source.messageIdSummary, 80);
  const nextPagesMessageId = cleanString(source.messageIdPages, 80);
  const hasSplitLayout = Boolean(nextSummaryMessageId || nextPagesMessageId);

  applyPanelValue(state, "channelId", source.channelId);

  if (hasSplitLayout) {
    state.messageId = "";
    state.messageIdSummary = nextSummaryMessageId;
    state.messageIdPages = nextPagesMessageId;
    return state;
  }

  if (nextMessageId) {
    state.messageId = nextMessageId;
    state.messageIdSummary = "";
    state.messageIdPages = "";
  }

  return state;
}

function syncLegacyGraphicTierlistBoardSnapshot(state, snapshot = {}) {
  if (!state || typeof state !== "object") return state;
  const source = snapshot && typeof snapshot === "object" ? snapshot : {};

  applyPanelValue(state, "channelId", source.channelId);
  applyPanelValue(state, "messageId", source.messageId);
  return state;
}

module.exports = {
  syncLegacyGraphicTierlistBoardSnapshot,
  syncLegacyPanelSnapshot,
  syncLegacyTextTierlistBoardSnapshot,
};