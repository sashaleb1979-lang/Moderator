"use strict";

const { CHANNEL_SLOTS, migrateLegacyState, normalizeSotState } = require("../schema");
const { buildLegacyChannelRecords, buildLegacyCharacterRecords, buildLegacyInfluenceState, buildLegacyIntegrationState, buildLegacyPanelRecords, buildLegacyPresentationState, buildLegacyRoleRecords, normalizeChannelSlots } = require("./write");

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function isEqual(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function normalizeDb(value = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function withoutSot(db = {}) {
  const next = clone(normalizeDb(db));
  delete next.sot;
  return next;
}

function normalizeComparableSot(db = {}) {
  return normalizeSotState(normalizeDb(db).sot || {});
}

function buildLegacyComparableSot(db = {}, options = {}) {
  const source = withoutSot(db);
  return migrateLegacyState(source, {
    appConfig: options.appConfig,
    presentation: options.presentation,
    nonGgsPresentation: options.nonGgsPresentation,
    influence: options.influence,
    lastVerifiedAt: options.lastVerifiedAt,
    useLegacyCharacterCompat: false,
  });
}

function getMismatchStatus(actual, expected) {
  if (!actual && expected) return "missing-in-sot";
  if (actual && !expected) return "extra-in-sot";
  return "mismatch";
}

function pushMismatch(mismatches, domain, key, actual, expected) {
  if (isEqual(actual, expected)) return;
  mismatches.push({
    domain,
    key,
    status: getMismatchStatus(actual, expected),
    actual: clone(actual ?? null),
    expected: clone(expected ?? null),
  });
}

function compareKeyedDomain(mismatches, domain, actualEntries = {}, expectedEntries = {}) {
  const keys = new Set([
    ...Object.keys(actualEntries || {}),
    ...Object.keys(expectedEntries || {}),
  ]);

  for (const key of [...keys].sort()) {
    pushMismatch(mismatches, domain, key, actualEntries?.[key], expectedEntries?.[key]);
  }
}

function isNativeOwnedCharacterRecord(record) {
  return record?.evidence?.nativeWriter === true;
}

function compareCharacterDomain(mismatches, actualEntries = {}, expectedEntries = {}) {
  const keys = new Set([
    ...Object.keys(actualEntries || {}),
    ...Object.keys(expectedEntries || {}),
  ]);

  for (const key of [...keys].sort()) {
    if (isNativeOwnedCharacterRecord(actualEntries?.[key])) continue;
    pushMismatch(mismatches, "characters", key, actualEntries?.[key], expectedEntries?.[key]);
  }
}

function flattenRoleRecords(roles = {}) {
  return {
    moderator: roles?.moderator || null,
    accessNormal: roles?.accessNormal || null,
    accessWartime: roles?.accessWartime || null,
    accessNonJjs: roles?.accessNonJjs || null,
    ...Object.fromEntries([1, 2, 3, 4, 5].map((tier) => [`killTier.${tier}`, roles?.killTier?.[tier] || roles?.killTier?.[String(tier)] || null])),
    ...Object.fromEntries([1, 2, 3, 4].map((tier) => [`legacyEloTier.${tier}`, roles?.legacyEloTier?.[tier] || roles?.legacyEloTier?.[String(tier)] || null])),
  };
}

function compareSotChannelsVsLegacy({ db = {}, appConfig = {}, slots = CHANNEL_SLOTS } = {}) {
  const normalizedSlots = normalizeChannelSlots(slots);
  const actualChannels = normalizeComparableSot(db).channels;
  const actual = Object.fromEntries(normalizedSlots.map((slot) => [slot, actualChannels?.[slot] || null]));
  const expected = buildLegacyChannelRecords({ db, appConfig, slots: normalizedSlots });
  const mismatches = [];

  compareKeyedDomain(mismatches, "channels", actual, expected);
  return mismatches;
}

function compareSotRolesVsLegacy({ db = {}, appConfig = {} } = {}) {
  const actual = flattenRoleRecords(normalizeComparableSot(db).roles);
  const expected = flattenRoleRecords(buildLegacyRoleRecords({ db, appConfig }));
  const mismatches = [];

  compareKeyedDomain(mismatches, "roles", actual, expected);
  return mismatches;
}

function compareSotCharactersVsLegacy({ db = {}, appConfig = {} } = {}) {
  const actual = normalizeComparableSot(db).characters;
  const expected = buildLegacyCharacterRecords({ db, appConfig });
  const mismatches = [];

  compareCharacterDomain(mismatches, actual, expected);
  return mismatches;
}

function compareSotPanelsVsLegacy({ db = {} } = {}) {
  const actual = normalizeComparableSot(db).panels;
  const expected = buildLegacyPanelRecords({ db });
  const mismatches = [];

  compareKeyedDomain(mismatches, "panels", actual, expected);
  return mismatches;
}

function compareSotIntegrationsVsLegacy({ db = {} } = {}) {
  const actual = normalizeComparableSot(db).integrations;
  const expected = buildLegacyIntegrationState({ db });
  const mismatches = [];

  compareKeyedDomain(mismatches, "integrations", actual, expected);
  return mismatches;
}

function compareSotPresentationVsLegacy({ db = {}, presentation, nonGgsPresentation } = {}) {
  const actual = normalizeComparableSot(db).presentation;
  const expected = buildLegacyPresentationState({ db, presentation, nonGgsPresentation });
  const mismatches = [];

  compareKeyedDomain(mismatches, "presentation", actual, expected);
  return mismatches;
}

function compareSotInfluenceVsLegacy({ db = {}, influence } = {}) {
  const actual = { current: normalizeComparableSot(db).influence };
  const expected = { current: buildLegacyInfluenceState({ db, influence }) };
  const mismatches = [];

  compareKeyedDomain(mismatches, "influence", actual, expected);
  return mismatches;
}

function summarizeCompareMismatches(mismatches = [], options = {}) {
  const limit = Math.max(0, Number(options.limit) || 0) || 5;
  const countsByDomain = {};

  for (const mismatch of Array.isArray(mismatches) ? mismatches : []) {
    const domain = String(mismatch?.domain || "unknown");
    countsByDomain[domain] = (countsByDomain[domain] || 0) + 1;
  }

  return {
    total: Array.isArray(mismatches) ? mismatches.length : 0,
    countsByDomain,
    preview: (Array.isArray(mismatches) ? mismatches : [])
      .slice(0, limit)
      .map((entry) => `${entry.domain}.${entry.key}:${entry.status}`),
  };
}

function compareSotVsLegacy({ db = {}, ...options } = {}) {
  const actual = normalizeComparableSot(db);
  const expected = buildLegacyComparableSot(db, options);
  const mismatches = [];

  compareKeyedDomain(mismatches, "channels", actual.channels, expected.channels);
  compareKeyedDomain(mismatches, "roles", flattenRoleRecords(actual.roles), flattenRoleRecords(expected.roles));
  compareCharacterDomain(mismatches, actual.characters, expected.characters);
  compareKeyedDomain(mismatches, "panels", actual.panels, expected.panels);
  compareKeyedDomain(mismatches, "presentation", actual.presentation, expected.presentation);
  compareKeyedDomain(mismatches, "integrations", actual.integrations, expected.integrations);
  compareKeyedDomain(mismatches, "influence", { current: actual.influence }, { current: expected.influence });
  compareKeyedDomain(mismatches, "modes", actual.modes, expected.modes);

  return mismatches;
}

module.exports = {
  buildLegacyComparableSot,
  compareSotCharactersVsLegacy,
  compareSotChannelsVsLegacy,
  compareSotInfluenceVsLegacy,
  compareSotIntegrationsVsLegacy,
  compareSotPanelsVsLegacy,
  compareSotPresentationVsLegacy,
  compareSotRolesVsLegacy,
  compareSotVsLegacy,
  flattenRoleRecords,
  normalizeComparableSot,
  summarizeCompareMismatches,
  withoutSot,
};