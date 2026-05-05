"use strict";

const { normalizeSotState } = require("./schema");

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function cleanString(value, limit = 500) {
  return String(value || "").trim().slice(0, limit);
}

function normalizeIntegrationSlot(slot) {
  const normalized = cleanString(slot, 40);
  return ["elo", "tierlist"].includes(normalized) ? normalized : "";
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function ensureSot(db = {}) {
  if (!db.sot || typeof db.sot !== "object" || Array.isArray(db.sot)) {
    db.sot = normalizeSotState({});
    return db.sot;
  }

  db.sot = normalizeSotState(db.sot);
  return db.sot;
}

function ensureLegacyIntegration(db = {}, slot) {
  db.config ||= {};
  db.config.integrations ||= {};
  db.config.integrations[slot] ||= {};
  return db.config.integrations[slot];
}

function applyIntegrationPatch(target, patch) {
  for (const [key, value] of Object.entries(patch || {})) {
    if (isPlainObject(value) && isPlainObject(target[key])) {
      target[key] = { ...clone(target[key]), ...clone(value) };
      continue;
    }
    target[key] = clone(value);
  }
}

function writeNativeIntegrationSnapshot(db = {}, { slot, patch = {} } = {}) {
  const normalizedSlot = normalizeIntegrationSlot(slot);
  if (!normalizedSlot) {
    throw new Error("Unknown integration slot.");
  }

  const sot = ensureSot(db);
  sot.integrations ||= {};
  sot.integrations[normalizedSlot] ||= {};
  const legacyIntegration = ensureLegacyIntegration(db, normalizedSlot);
  const previousRecord = clone(sot.integrations[normalizedSlot] || {});

  applyIntegrationPatch(sot.integrations[normalizedSlot], patch);
  applyIntegrationPatch(legacyIntegration, patch);

  return {
    mutated: JSON.stringify(previousRecord) !== JSON.stringify(sot.integrations[normalizedSlot]),
    slot: normalizedSlot,
    record: clone(sot.integrations[normalizedSlot]),
  };
}

function writeNativeIntegrationSourcePath(db = {}, { slot, sourcePath = "" } = {}) {
  const normalizedSlot = normalizeIntegrationSlot(slot);
  if (!normalizedSlot) {
    throw new Error("Unknown integration slot.");
  }

  const nextSourcePath = cleanString(sourcePath, 500);
  const sot = ensureSot(db);
  sot.integrations ||= {};
  sot.integrations[normalizedSlot] ||= {};

  const previousSourcePath = cleanString(sot.integrations[normalizedSlot].sourcePath, 500);
  if (previousSourcePath === nextSourcePath) {
    ensureLegacyIntegration(db, normalizedSlot).sourcePath = nextSourcePath;
    return { mutated: false, slot: normalizedSlot, previousSourcePath, sourcePath: nextSourcePath };
  }

  writeNativeIntegrationSnapshot(db, {
    slot: normalizedSlot,
    patch: { sourcePath: nextSourcePath },
  });

  return { mutated: true, slot: normalizedSlot, previousSourcePath, sourcePath: nextSourcePath };
}

function clearNativeIntegrationSourcePath(db = {}, { slot } = {}) {
  return writeNativeIntegrationSourcePath(db, { slot, sourcePath: "" });
}

function writeNativeIntegrationRoleGrantEnabled(db = {}, { slot, value } = {}) {
  const normalizedSlot = normalizeIntegrationSlot(slot);
  if (normalizedSlot !== "elo") {
    throw new Error("roleGrantEnabled is only supported for elo.");
  }

  const nextValue = value !== false;
  const sot = ensureSot(db);
  sot.integrations ||= {};
  sot.integrations[normalizedSlot] ||= {};

  const previousValue = sot.integrations[normalizedSlot].roleGrantEnabled !== false;
  if (previousValue === nextValue) {
    ensureLegacyIntegration(db, normalizedSlot).roleGrantEnabled = nextValue;
    return { mutated: false, slot: normalizedSlot, previousValue, value: nextValue };
  }

  writeNativeIntegrationSnapshot(db, {
    slot: normalizedSlot,
    patch: { roleGrantEnabled: nextValue },
  });

  return { mutated: true, slot: normalizedSlot, previousValue, value: nextValue };
}

module.exports = {
  clearNativeIntegrationSourcePath,
  normalizeIntegrationSlot,
  writeNativeIntegrationSnapshot,
  writeNativeIntegrationRoleGrantEnabled,
  writeNativeIntegrationSourcePath,
};