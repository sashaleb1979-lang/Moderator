"use strict";

const { PANEL_MESSAGE_SLOTS, migrateLegacyState, normalizePanelRecord } = require("../schema");
const { selectPreferredRecord } = require("./priority");

const PANEL_SLOTS = Object.keys(PANEL_MESSAGE_SLOTS);

function normalizePanelSlot(slot) {
  const normalized = String(slot || "").trim();
  return PANEL_SLOTS.includes(normalized) ? normalized : "";
}

function getPersistedPanelRecord(slot, db = {}) {
  const normalizedSlot = normalizePanelSlot(slot);
  if (!normalizedSlot) return null;
  return normalizePanelRecord(db?.sot?.panels?.[normalizedSlot], PANEL_MESSAGE_SLOTS[normalizedSlot]);
}

function getLegacyPanelRecord(slot, context = {}) {
  const normalizedSlot = normalizePanelSlot(slot);
  if (!normalizedSlot) return null;

  const sotView = migrateLegacyState(context.db || {}, {
    appConfig: context.appConfig,
    presentation: context.presentation,
    nonGgsPresentation: context.nonGgsPresentation,
    influence: context.influence,
    lastVerifiedAt: context.lastVerifiedAt,
  });

  return normalizePanelRecord(sotView?.panels?.[normalizedSlot], PANEL_MESSAGE_SLOTS[normalizedSlot]);
}

function mergePanelRecords(primary, fallback, messageSlots = ["main"]) {
  const nextPrimary = normalizePanelRecord(primary, messageSlots);
  const nextFallback = normalizePanelRecord(fallback, messageSlots);
  const messageIds = {};

  for (const messageSlot of messageSlots) {
    messageIds[messageSlot] = selectPreferredRecord([
      nextPrimary.messageIds?.[messageSlot],
      nextFallback.messageIds?.[messageSlot],
    ], "manual");
  }

  return {
    channelId: selectPreferredRecord([nextPrimary.channelId, nextFallback.channelId], "manual"),
    messageIds,
    lastUpdated: nextPrimary.lastUpdated || nextFallback.lastUpdated || null,
  };
}

function resolvePanelRecord({ slot, db = {}, appConfig = {}, ...context } = {}) {
  const normalizedSlot = normalizePanelSlot(slot);
  if (!normalizedSlot) return null;

  return mergePanelRecords(
    getPersistedPanelRecord(normalizedSlot, db),
    getLegacyPanelRecord(normalizedSlot, { db, appConfig, ...context }),
    PANEL_MESSAGE_SLOTS[normalizedSlot]
  );
}

function resolveAllPanelRecords(context = {}) {
  return Object.fromEntries(PANEL_SLOTS.map((slot) => [slot, resolvePanelRecord({ slot, ...context })]));
}

function getPanelChannelId(slot, context = {}) {
  return resolvePanelRecord({ slot, ...context })?.channelId?.value || "";
}

function getPanelMessageId(slot, messageSlot = "main", context = {}) {
  const normalizedSlot = normalizePanelSlot(slot);
  if (!normalizedSlot || !PANEL_MESSAGE_SLOTS[normalizedSlot].includes(messageSlot)) return "";
  return resolvePanelRecord({ slot: normalizedSlot, ...context })?.messageIds?.[messageSlot]?.value || "";
}

module.exports = {
  PANEL_SLOTS,
  getLegacyPanelRecord,
  getPanelChannelId,
  getPanelMessageId,
  getPersistedPanelRecord,
  mergePanelRecords,
  normalizePanelSlot,
  resolveAllPanelRecords,
  resolvePanelRecord,
};