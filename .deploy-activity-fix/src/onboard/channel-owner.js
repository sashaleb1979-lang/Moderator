"use strict";

function buildUnknownSlotError() {
  return new Error("Неизвестный channel slot. Используй welcome / review / tierlistText / tierlistGraphic / log.");
}

function normalizeChannelSlot(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (!normalized) return "";

  const aliases = {
    welcome: "welcome",
    review: "review",
    text: "tierlistText",
    texttierlist: "tierlistText",
    tierlisttext: "tierlistText",
    graphic: "tierlistGraphic",
    graphictierlist: "tierlistGraphic",
    tierlistgraphic: "tierlistGraphic",
    log: "log",
    notice: "log",
    notices: "log",
    notification: "log",
    notifications: "log",
  };

  return aliases[normalized] || "";
}

function getChannelSlotLabel(slot) {
  switch (slot) {
    case "welcome": return "Welcome";
    case "review": return "Review";
    case "tierlistText": return "Text tierlist";
    case "tierlistGraphic": return "Graphic tierlist";
    case "log": return "Notice/log";
    default: return slot || "channel";
  }
}

function normalizeChannelIdValue(value) {
  return String(value || "").trim();
}

class ChannelOverrideBatchError extends Error {
  constructor(cause, options = {}) {
    const message = String(cause?.message || cause || "Не удалось применить channel overrides.");
    super(message);
    this.name = "ChannelOverrideBatchError";
    this.cause = cause;
    this.failedOverride = options.failedOverride || null;
    this.appliedOverrides = Array.isArray(options.appliedOverrides) ? options.appliedOverrides : [];
    this.rollbackFailures = Array.isArray(options.rollbackFailures) ? options.rollbackFailures : [];
  }
}

function getChangedChannelOverrides(channelOverrides = [], getCurrentChannelId = () => "") {
  const overrides = Array.isArray(channelOverrides) ? channelOverrides : [];
  const resolveCurrentChannelId = typeof getCurrentChannelId === "function"
    ? getCurrentChannelId
    : () => "";

  return overrides
    .map((entry) => {
      const slot = normalizeChannelSlot(entry?.slot);
      if (!slot) return null;

      const currentChannelId = normalizeChannelIdValue(resolveCurrentChannelId(slot));
      const channelId = normalizeChannelIdValue(entry?.channelId);
      if (currentChannelId === channelId) return null;

      return {
        ...entry,
        slot,
        channelId,
        currentChannelId,
      };
    })
    .filter(Boolean);
}

async function applyChannelOverrideBatch({
  channelOverrides = [],
  getCurrentChannelId = () => "",
  applyChannelOverride,
} = {}) {
  if (typeof applyChannelOverride !== "function") {
    throw new Error("applyChannelOverride is required");
  }

  const changedChannelOverrides = getChangedChannelOverrides(channelOverrides, getCurrentChannelId);
  const statusNotes = [];
  const appliedOverrides = [];

  for (const override of changedChannelOverrides) {
    try {
      statusNotes.push(await applyChannelOverride(override.slot, override.channelId, {
        allowClear: true,
        currentChannelId: override.currentChannelId,
      }));
      appliedOverrides.push(override);
    } catch (error) {
      const rollbackFailures = [];
      for (const appliedOverride of [...appliedOverrides].reverse()) {
        try {
          await applyChannelOverride(appliedOverride.slot, appliedOverride.currentChannelId, {
            allowClear: true,
            currentChannelId: appliedOverride.channelId,
            isRollback: true,
          });
        } catch (rollbackError) {
          rollbackFailures.push({
            ...appliedOverride,
            error: rollbackError,
          });
        }
      }

      throw new ChannelOverrideBatchError(error, {
        failedOverride: override,
        appliedOverrides,
        rollbackFailures,
      });
    }
  }

  return {
    changedChannelOverrides,
    statusNotes,
    appliedOverrides,
  };
}

async function deleteTrackedManagedMessages(messageRefs = [], helpers = {}) {
  if (typeof helpers.deleteManagedChannelMessage !== "function") return;

  const refs = new Map();
  for (const entry of Array.isArray(messageRefs) ? messageRefs : []) {
    const channelId = normalizeChannelIdValue(entry?.channelId);
    const messageId = normalizeChannelIdValue(entry?.messageId);
    if (!channelId || !messageId) continue;
    refs.set(`${channelId}:${messageId}`, { channelId, messageId });
  }

  for (const { channelId, messageId } of refs.values()) {
    await helpers.deleteManagedChannelMessage(channelId, messageId);
  }
}

async function clearChannelLink(slot, helpers) {
  const normalizedSlot = normalizeChannelSlot(slot);
  if (!normalizedSlot) {
    throw buildUnknownSlotError();
  }

  if (normalizedSlot === "welcome") {
    const welcomePanelState = helpers.syncLegacyPanelSnapshot(
      helpers.getWelcomePanelState(),
      helpers.getResolvedWelcomePanelSnapshot()
    );
    const nonGgsPanelState = helpers.syncLegacyPanelSnapshot(
      helpers.getNonGgsPanelState(),
      helpers.getResolvedNonGgsPanelSnapshot()
    );
    const previousWelcomeChannelId = String(welcomePanelState.channelId || "").trim();
    const previousWelcomeMessageId = String(welcomePanelState.messageId || "").trim();
    const previousNonGgsChannelId = String(nonGgsPanelState.channelId || "").trim();
    const previousNonGgsMessageId = String(nonGgsPanelState.messageId || "").trim();

    welcomePanelState.channelId = "";
    welcomePanelState.messageId = "";
    nonGgsPanelState.channelId = "";
    nonGgsPanelState.messageId = "";
    helpers.saveDb();
    await deleteTrackedManagedMessages([
      { channelId: previousWelcomeChannelId, messageId: previousWelcomeMessageId },
      { channelId: previousNonGgsChannelId, messageId: previousNonGgsMessageId },
    ], helpers);

    const previousParts = [previousWelcomeChannelId, previousNonGgsChannelId]
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index)
      .map((channelId) => helpers.formatChannelMention(channelId));
    const previousText = previousParts.length ? ` Было: ${previousParts.join(", ")}.` : "";
    return `${getChannelSlotLabel(normalizedSlot)} и non-JJS panel отключены.${previousText}`;
  }

  if (normalizedSlot === "review") {
    const previousChannelId = helpers.getResolvedChannelId("review");
    helpers.setReviewChannelId("");
    helpers.saveDb();
    return previousChannelId
      ? `${getChannelSlotLabel(normalizedSlot)} channel очищен. Было: ${helpers.formatChannelMention(previousChannelId)}.`
      : `${getChannelSlotLabel(normalizedSlot)} channel уже пуст.`;
  }

  if (normalizedSlot === "tierlistText") {
    const textBoardState = helpers.syncLegacyTextTierlistBoardSnapshot(
      helpers.getTextTierlistBoardState(),
      helpers.getResolvedTextTierlistBoardSnapshot()
    );
    const previousChannelId = String(textBoardState.channelId || "").trim();
    const previousMessageIds = [
      String(textBoardState.messageId || "").trim(),
      String(textBoardState.messageIdSummary || "").trim(),
      String(textBoardState.messageIdPages || "").trim(),
    ];
    textBoardState.channelId = "";
    helpers.clearTextTierlistBoardMessageIds(textBoardState);
    helpers.saveDb();
    await deleteTrackedManagedMessages(
      previousMessageIds.map((messageId) => ({ channelId: previousChannelId, messageId })),
      helpers
    );
    return previousChannelId
      ? `${getChannelSlotLabel(normalizedSlot)} очищен. Было: ${helpers.formatChannelMention(previousChannelId)}.`
      : `${getChannelSlotLabel(normalizedSlot)} уже пуст.`;
  }

  if (normalizedSlot === "tierlistGraphic") {
    const graphicBoardState = helpers.syncLegacyGraphicTierlistBoardSnapshot(
      helpers.getGraphicTierlistBoardState(),
      helpers.getResolvedGraphicTierlistBoardSnapshot()
    );
    const previousChannelId = String(graphicBoardState.channelId || "").trim();
    const previousMessageId = String(graphicBoardState.messageId || "").trim();
    graphicBoardState.channelId = "";
    graphicBoardState.messageId = "";
    helpers.saveDb();
    await deleteTrackedManagedMessages([
      { channelId: previousChannelId, messageId: previousMessageId },
    ], helpers);
    return previousChannelId
      ? `${getChannelSlotLabel(normalizedSlot)} очищен. Было: ${helpers.formatChannelMention(previousChannelId)}.`
      : `${getChannelSlotLabel(normalizedSlot)} уже пуст.`;
  }

  const previousChannelId = helpers.getResolvedChannelId("log");
  helpers.setNotificationChannelId("");
  helpers.saveDb();
  return previousChannelId
    ? `${getChannelSlotLabel(normalizedSlot)} channel очищен. Было: ${helpers.formatChannelMention(previousChannelId)}.`
    : `${getChannelSlotLabel(normalizedSlot)} channel уже пуст.`;
}

async function applyChannelLink({ slot, targetChannelId, allowClear = false, isPlaceholder = () => false, clearChannel, linkChannel }) {
  const normalizedSlot = normalizeChannelSlot(slot);
  if (!normalizedSlot) {
    throw buildUnknownSlotError();
  }

  const nextChannelId = String(targetChannelId || "").trim();
  if (!nextChannelId || isPlaceholder(nextChannelId)) {
    if (!allowClear) {
      throw new Error("Нужно указать текстовый канал.");
    }
    return clearChannel(normalizedSlot);
  }

  return linkChannel(normalizedSlot, nextChannelId);
}

module.exports = {
  applyChannelLink,
  applyChannelOverrideBatch,
  ChannelOverrideBatchError,
  clearChannelLink,
  getChangedChannelOverrides,
  getChannelSlotLabel,
  normalizeChannelSlot,
};