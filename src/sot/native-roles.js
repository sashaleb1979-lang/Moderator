"use strict";

const { createRecord, ensureSotState, normalizeRecord } = require("./schema");

const BASE_ROLE_SLOT_LABELS = {
  moderator: "Moderator",
  accessNormal: "Access normal",
  accessWartime: "Access wartime",
  accessNonJjs: "Access nonJJS",
  verifyAccess: "Verify access",
};

const TIER_ROLE_LABELS = {
  killTier: "Kill tier",
  legacyEloTier: "Legacy ELO tier",
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

function normalizeRoleSlot(slot) {
  const text = cleanString(slot, 80);
  if (!text) return null;

  const normalized = text.toLowerCase().replace(/[\s_:-]+/g, "");
  const aliases = {
    moderator: "moderator",
    mod: "moderator",
    access: "accessNormal",
    accessnormal: "accessNormal",
    normal: "accessNormal",
    accesswartime: "accessWartime",
    wartime: "accessWartime",
    accessnonjjs: "accessNonJjs",
    nonjjs: "accessNonJjs",
    accessnonggs: "accessNonJjs",
    nonggs: "accessNonJjs",
    verifyaccess: "verifyAccess",
    verify: "verifyAccess",
  };

  const canonical = aliases[normalized] || "";
  if (canonical) {
    return {
      canonical,
      label: BASE_ROLE_SLOT_LABELS[canonical] || canonical,
      domain: "base",
      key: canonical,
    };
  }

  const killTierMatch = normalized.match(/^(?:killtier|tier)([1-5])$/);
  if (killTierMatch) {
    const tier = killTierMatch[1];
    return {
      canonical: `killTier:${tier}`,
      label: `${TIER_ROLE_LABELS.killTier} ${tier}`,
      domain: "killTier",
      key: tier,
    };
  }

  const legacyEloMatch = normalized.match(/^(?:legacyelotier|legacyelo|elo)([1-4])$/);
  if (legacyEloMatch) {
    const tier = legacyEloMatch[1];
    return {
      canonical: `legacyEloTier:${tier}`,
      label: `${TIER_ROLE_LABELS.legacyEloTier} ${tier}`,
      domain: "legacyEloTier",
      key: tier,
    };
  }

  return null;
}

function getCurrentRoleRecord(state, roleSlot) {
  if (roleSlot.domain === "base") {
    return normalizeRecord(state.sot.roles?.[roleSlot.key], "manual");
  }

  return normalizeRecord(state.sot.roles?.[roleSlot.domain]?.[roleSlot.key], "manual");
}

function setRoleRecord(state, roleSlot, value) {
  if (roleSlot.domain === "base") {
    state.sot.roles[roleSlot.key] = value;
    return;
  }

  state.sot.roles[roleSlot.domain] ||= {};
  state.sot.roles[roleSlot.domain][roleSlot.key] = value;
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

function writeNativeRoleRecord(db = {}, {
  slot,
  roleId,
  source = "manual",
  verifiedAt = null,
  evidence,
  history,
} = {}) {
  const roleSlot = normalizeRoleSlot(slot);
  if (!roleSlot) throw new Error("role slot is required");

  const normalizedRoleId = cleanString(roleId, 80);
  if (!normalizedRoleId) throw new Error("roleId is required");

  const state = ensureSotState(db);
  const current = getCurrentRoleRecord(state, roleSlot);
  const next = createRecord(normalizedRoleId, source, {
    verifiedAt,
    evidence: buildNativeEvidence(current, evidence, cleanString(current?.value, 80) === normalizedRoleId, source),
    history: Array.isArray(history) ? clone(history) : (Array.isArray(current?.history) ? clone(current.history) : undefined),
  });

  if (isEqual(current, next)) {
    return {
      mutated: false,
      slot: roleSlot.canonical,
      record: next,
    };
  }

  setRoleRecord(state, roleSlot, next);
  return {
    mutated: true,
    slot: roleSlot.canonical,
    record: next,
  };
}

function clearNativeRoleRecord(db = {}, { slot } = {}) {
  const roleSlot = normalizeRoleSlot(slot);
  if (!roleSlot) throw new Error("role slot is required");

  const state = ensureSotState(db);
  const current = getCurrentRoleRecord(state, roleSlot);
  if (!current) {
    return {
      mutated: false,
      slot: roleSlot.canonical,
      record: null,
    };
  }

  setRoleRecord(state, roleSlot, null);
  return {
    mutated: true,
    slot: roleSlot.canonical,
    record: null,
    previous: current,
  };
}

module.exports = {
  BASE_ROLE_SLOT_LABELS,
  clearNativeRoleRecord,
  normalizeRoleSlot,
  TIER_ROLE_LABELS,
  writeNativeRoleRecord,
};