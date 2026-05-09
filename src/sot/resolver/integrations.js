"use strict";

const { migrateLegacyState } = require("../schema");

const INTEGRATION_SLOTS = ["elo", "tierlist", "roblox", "verification"];

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(base, override) {
  const result = isPlainObject(base) ? clone(base) : {};

  for (const [key, value] of Object.entries(isPlainObject(override) ? override : {})) {
    if (isPlainObject(result[key]) && isPlainObject(value)) {
      result[key] = deepMerge(result[key], value);
      continue;
    }
    result[key] = clone(value);
  }

  return result;
}

function normalizeIntegrationSlot(slot) {
  const normalized = String(slot || "").trim();
  return INTEGRATION_SLOTS.includes(normalized) ? normalized : "";
}

function getPersistedIntegrationRecord(slot, db = {}) {
  const normalizedSlot = normalizeIntegrationSlot(slot);
  if (!normalizedSlot) return {};

  const integrations = db?.sot?.integrations && typeof db.sot.integrations === "object" && !Array.isArray(db.sot.integrations)
    ? db.sot.integrations
    : {};

  return isPlainObject(integrations[normalizedSlot]) ? clone(integrations[normalizedSlot]) : {};
}

function getLegacyIntegrationRecord(slot, context = {}) {
  const normalizedSlot = normalizeIntegrationSlot(slot);
  if (!normalizedSlot) return {};

  const sotView = migrateLegacyState(context.db || {}, {
    appConfig: context.appConfig,
    presentation: context.presentation,
    nonGgsPresentation: context.nonGgsPresentation,
    influence: context.influence,
    lastVerifiedAt: context.lastVerifiedAt,
  });

  return isPlainObject(sotView?.integrations?.[normalizedSlot]) ? clone(sotView.integrations[normalizedSlot]) : {};
}

function resolveIntegrationRecord({ slot, db = {}, appConfig = {}, ...context } = {}) {
  const normalizedSlot = normalizeIntegrationSlot(slot);
  if (!normalizedSlot) return {};

  return deepMerge(
    getLegacyIntegrationRecord(normalizedSlot, { db, appConfig, ...context }),
    getPersistedIntegrationRecord(normalizedSlot, db)
  );
}

function resolveAllIntegrationRecords(context = {}) {
  return Object.fromEntries(INTEGRATION_SLOTS.map((slot) => [slot, resolveIntegrationRecord({ slot, ...context })]));
}

module.exports = {
  INTEGRATION_SLOTS,
  getLegacyIntegrationRecord,
  getPersistedIntegrationRecord,
  normalizeIntegrationSlot,
  resolveAllIntegrationRecords,
  resolveIntegrationRecord,
};