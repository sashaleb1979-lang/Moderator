"use strict";

const { migrateLegacyState } = require("../schema");

const PRESENTATION_SLOTS = ["welcome", "tierlist", "nonGgs"];

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

function normalizePresentationSlot(slot) {
  const normalized = String(slot || "").trim();
  if (normalized === "nonJjs") return "nonGgs";
  return PRESENTATION_SLOTS.includes(normalized) ? normalized : "";
}

function getPersistedPresentation(slot, db = {}) {
  const normalizedSlot = normalizePresentationSlot(slot);
  if (!normalizedSlot) return {};

  const presentation = db?.sot?.presentation && typeof db.sot.presentation === "object" && !Array.isArray(db.sot.presentation)
    ? db.sot.presentation
    : {};
  const raw = normalizedSlot === "nonGgs"
    ? presentation.nonGgs || presentation.nonJjs
    : presentation[normalizedSlot];

  return isPlainObject(raw) ? clone(raw) : {};
}

function getLegacyPresentation(slot, context = {}) {
  const normalizedSlot = normalizePresentationSlot(slot);
  if (!normalizedSlot) return {};

  const sotView = migrateLegacyState(context.db || {}, {
    appConfig: context.appConfig,
    presentation: context.presentation,
    nonGgsPresentation: context.nonGgsPresentation ?? context.nonJjsPresentation,
    influence: context.influence,
    lastVerifiedAt: context.lastVerifiedAt,
  });
  const raw = sotView?.presentation?.[normalizedSlot];
  return isPlainObject(raw) ? clone(raw) : {};
}

function resolvePresentation({ slot, db = {}, appConfig = {}, ...context } = {}) {
  const normalizedSlot = normalizePresentationSlot(slot);
  if (!normalizedSlot) return {};

  return deepMerge(
    getLegacyPresentation(normalizedSlot, { db, appConfig, ...context }),
    getPersistedPresentation(normalizedSlot, db)
  );
}

function resolveAllPresentations(context = {}) {
  return Object.fromEntries(PRESENTATION_SLOTS.map((slot) => [slot, resolvePresentation({ slot, ...context })]));
}

module.exports = {
  PRESENTATION_SLOTS,
  deepMerge,
  getLegacyPresentation,
  getPersistedPresentation,
  normalizePresentationSlot,
  resolveAllPresentations,
  resolvePresentation,
};