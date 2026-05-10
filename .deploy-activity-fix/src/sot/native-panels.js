"use strict";

const { PANEL_MESSAGE_SLOTS, createRecord, ensureSotState, normalizePanelRecord } = require("./schema");

const CORE_PANEL_SLOT_LABELS = {
  welcome: "Welcome panel",
  nonGgs: "non-JJS panel",
  eloSubmit: "Legacy ELO submit panel",
  eloGraphic: "Legacy ELO graphic panel",
  tierlistDashboard: "Legacy Tierlist dashboard panel",
  tierlistSummary: "Legacy Tierlist summary panel",
};

function cleanString(value, limit = 200) {
  return String(value || "").trim().slice(0, limit);
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function isEqual(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function normalizePanelSlot(slot) {
  const text = cleanString(slot, 80);
  if (!text) return null;

  const normalized = text.toLowerCase().replace(/[\s_:-]+/g, "");
  const aliases = {
    welcome: "welcome",
    nonggs: "nonGgs",
    nonjjs: "nonGgs",
    captcha: "nonGgs",
    elosubmit: "eloSubmit",
    submitpanel: "eloSubmit",
    elohub: "eloSubmit",
    elographic: "eloGraphic",
    elopng: "eloGraphic",
    elographicpanel: "eloGraphic",
    dashboard: "tierlistDashboard",
    tierlistdashboard: "tierlistDashboard",
    tierdashboard: "tierlistDashboard",
    summary: "tierlistSummary",
    tierlistsummary: "tierlistSummary",
    tiersummary: "tierlistSummary",
  };

  const canonical = aliases[normalized] || "";
  if (!canonical) return null;

  return {
    canonical,
    label: CORE_PANEL_SLOT_LABELS[canonical] || canonical,
  };
}

function buildNativeEvidence(currentRecord, nextEvidence, sameValue, source) {
  const evidence = sameValue && currentRecord?.evidence && typeof currentRecord.evidence === "object" && !Array.isArray(currentRecord.evidence)
    ? clone(currentRecord.evidence)
    : {};

  if (nextEvidence && typeof nextEvidence === "object" && !Array.isArray(nextEvidence)) {
    Object.assign(evidence, clone(nextEvidence));
  }

  evidence.nativeWriter = true;
  if (source === "manual") evidence.manualOverride = true;
  return evidence;
}

function writeNativePanelRecord(db = {}, {
  slot,
  channelId,
  source = "manual",
  lastUpdated = null,
  evidence,
} = {}) {
  const panelSlot = normalizePanelSlot(slot);
  if (!panelSlot) throw new Error("panel slot is required");

  const normalizedChannelId = cleanString(channelId, 80);
  if (!normalizedChannelId) throw new Error("channelId is required");

  const state = ensureSotState(db);
  const messageSlots = PANEL_MESSAGE_SLOTS[panelSlot.canonical] || ["main"];
  const current = normalizePanelRecord(state.sot.panels?.[panelSlot.canonical], messageSlots);
  const next = normalizePanelRecord({
    channelId: createRecord(normalizedChannelId, source, {
      evidence: buildNativeEvidence(current.channelId, evidence, cleanString(current.channelId?.value, 80) === normalizedChannelId, source),
    }),
    messageIds: current.messageIds,
    lastUpdated: cleanString(lastUpdated, 80) || current.lastUpdated || null,
  }, messageSlots);

  if (isEqual(current, next)) {
    return {
      mutated: false,
      slot: panelSlot.canonical,
      record: next,
    };
  }

  state.sot.panels[panelSlot.canonical] = next;
  return {
    mutated: true,
    slot: panelSlot.canonical,
    record: next,
  };
}

function clearNativePanelRecord(db = {}, { slot } = {}) {
  const panelSlot = normalizePanelSlot(slot);
  if (!panelSlot) throw new Error("panel slot is required");

  const state = ensureSotState(db);
  const messageSlots = PANEL_MESSAGE_SLOTS[panelSlot.canonical] || ["main"];
  const current = normalizePanelRecord(state.sot.panels?.[panelSlot.canonical], messageSlots);
  const hasCurrentValue = Boolean(cleanString(current.channelId?.value, 80));
  if (!hasCurrentValue) {
    return {
      mutated: false,
      slot: panelSlot.canonical,
      record: current,
    };
  }

  state.sot.panels[panelSlot.canonical] = null;
  return {
    mutated: true,
    slot: panelSlot.canonical,
    record: null,
    previous: current,
  };
}

module.exports = {
  CORE_PANEL_SLOT_LABELS,
  clearNativePanelRecord,
  normalizePanelSlot,
  writeNativePanelRecord,
};