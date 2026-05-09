"use strict";

const { CHANNEL_SLOTS, buildInfluenceState, buildIntegrationState, buildPanelMap, buildPresentationState, createCharacterRecord, createRecord, normalizeSotState } = require("../schema");
const { getConfiguredChannelValue, getLegacyChannelRecord } = require("../resolver/channels");
const { selectPreferredRecord } = require("../resolver/priority");

const BASE_ROLE_SLOTS = ["moderator", "accessNormal", "accessWartime", "accessNonJjs", "verifyAccess"];
const KILL_TIER_SLOTS = [1, 2, 3, 4, 5];
const LEGACY_ELO_TIER_SLOTS = [1, 2, 3, 4];

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function cleanString(value, limit = 200) {
  return String(value || "").trim().slice(0, limit);
}

function isEqual(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function getDbConfig(db = {}) {
  return db && typeof db.config === "object" && !Array.isArray(db.config) ? db.config : {};
}

function getAppChannels(appConfig = {}) {
  return appConfig && typeof appConfig.channels === "object" && !Array.isArray(appConfig.channels)
    ? appConfig.channels
    : {};
}

function getAppRoles(appConfig = {}) {
  return appConfig && typeof appConfig.roles === "object" && !Array.isArray(appConfig.roles)
    ? appConfig.roles
    : {};
}

function normalizeLegacyCharacters(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => ({
      id: cleanString(entry?.id, 120),
      label: cleanString(entry?.label, 200),
      roleId: cleanString(entry?.roleId, 80),
    }))
    .filter((entry) => entry.id);
}

function normalizeExcludedCharacterIds(value) {
  const values = Array.isArray(value) ? value : (value instanceof Set ? [...value] : []);
  return new Set(values.map((entry) => cleanString(entry, 120)).filter(Boolean));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isManualOverrideRecord(record) {
  return String(record?.source || "").trim() === "manual"
    && record?.evidence?.manualOverride === true;
}

function isNativeOwnedCharacterRecord(record) {
  return record?.evidence?.nativeWriter === true;
}

function shouldPreserveManualRecord(currentRecord, nextRecord) {
  const currentSource = String(currentRecord?.source || "").trim();
  const nextSource = String(nextRecord?.source || "").trim();

  if (!currentRecord) return false;
  if (isManualOverrideRecord(currentRecord)) return true;
  return currentSource === "manual" && nextSource && nextSource !== "manual";
}

function mergeLegacyRecord(currentRecord, nextRecord) {
  const current = currentRecord && typeof currentRecord === "object" ? clone(currentRecord) : null;
  const next = nextRecord && typeof nextRecord === "object" ? clone(nextRecord) : null;

  if (!next) return current;
  if (!current) return next;
  if (shouldPreserveManualRecord(current, next)) return current;

  if (!next.verifiedAt && current.verifiedAt && current.value === next.value) {
    next.verifiedAt = current.verifiedAt;
  }
  if (!next.evidence && current.evidence && current.value === next.value) {
    next.evidence = clone(current.evidence);
  }
  if (!next.history && current.history) {
    next.history = clone(current.history);
  }

  return next;
}

function mergeLegacyCharacterRecord(currentRecord, nextRecord) {
  const current = currentRecord && typeof currentRecord === "object" ? clone(currentRecord) : null;
  const next = nextRecord && typeof nextRecord === "object" ? clone(nextRecord) : null;

  if (!next) return current;
  if (!current) return next;
  if (isNativeOwnedCharacterRecord(current)) return current;
  if (shouldPreserveManualRecord(current, next)) return current;

  if (!next.verifiedAt && current.verifiedAt && current.roleId === next.roleId) {
    next.verifiedAt = current.verifiedAt;
  }
  if (!next.evidence && current.evidence && current.roleId === next.roleId) {
    next.evidence = clone(current.evidence);
  }
  if (!next.history && current.history) {
    next.history = clone(current.history);
  }
  if (!next.englishLabel && current.englishLabel) {
    next.englishLabel = current.englishLabel;
  }

  return next;
}

function mergeLegacyPanelRecord(currentRecord, nextRecord) {
  const current = isPlainObject(currentRecord) ? clone(currentRecord) : null;
  const next = isPlainObject(nextRecord) ? clone(nextRecord) : null;

  if (!next) return current;
  if (!current) return next;

  const messageSlots = new Set([
    ...Object.keys(current.messageIds || {}),
    ...Object.keys(next.messageIds || {}),
  ]);

  return {
    channelId: mergeLegacyRecord(current.channelId, next.channelId),
    messageIds: Object.fromEntries(
      [...messageSlots].map((slot) => [slot, mergeLegacyRecord(current.messageIds?.[slot], next.messageIds?.[slot])])
    ),
    lastUpdated: next.lastUpdated || current.lastUpdated || null,
  };
}

function mergeLegacyObject(currentValue, nextValue) {
  if (!isPlainObject(nextValue)) {
    return isPlainObject(currentValue) ? clone(currentValue) : clone(nextValue);
  }

  const merged = clone(nextValue);
  const current = isPlainObject(currentValue) ? currentValue : {};

  for (const [key, value] of Object.entries(current)) {
    if (merged[key] !== undefined) continue;
    merged[key] = clone(value);
  }

  for (const [key, value] of Object.entries(nextValue)) {
    if (isPlainObject(value) && isPlainObject(current[key])) {
      merged[key] = mergeLegacyObject(current[key], value);
      continue;
    }
    merged[key] = clone(value);
  }
  return merged;
}

function normalizeChannelSlots(slots = CHANNEL_SLOTS) {
  return [...new Set((Array.isArray(slots) ? slots : []).map((slot) => String(slot || "").trim()).filter((slot) => CHANNEL_SLOTS.includes(slot)))];
}

function buildLegacyChannelRecord(slot, { db = {}, appConfig = {} } = {}) {
  const dbConfig = getDbConfig(db);
  const appChannels = getAppChannels(appConfig);

  return selectPreferredRecord([
    getLegacyChannelRecord(slot, dbConfig, appChannels),
    createRecord(getConfiguredChannelValue(slot, appChannels), "configured"),
  ], "configured");
}

function buildLegacyChannelRecords({ db = {}, appConfig = {}, slots = CHANNEL_SLOTS } = {}) {
  const normalizedSlots = normalizeChannelSlots(slots);
  return Object.fromEntries(normalizedSlots.map((slot) => [slot, buildLegacyChannelRecord(slot, { db, appConfig })]));
}

function buildLegacyBaseRoleRecord(slot, { appConfig = {} } = {}) {
  const appRoles = getAppRoles(appConfig);

  switch (slot) {
    case "moderator":
      return createRecord(appRoles.moderatorRoleId, "configured");
    case "accessNormal":
      return createRecord(appRoles.accessRoleId, "configured");
    case "accessWartime":
      return createRecord(appRoles.wartimeAccessRoleId, "configured");
    case "accessNonJjs":
      return createRecord(appRoles.nonGgsAccessRoleId || appRoles.nonJjsAccessRoleId, "configured");
    case "verifyAccess":
      return createRecord(appRoles.verifyAccessRoleId, "configured");
    default:
      return null;
  }
}

function buildLegacyKillTierRecord(tier, { db = {}, appConfig = {} } = {}) {
  const dbConfig = getDbConfig(db);
  const appRoles = getAppRoles(appConfig);
  const tierKey = String(tier);

  return selectPreferredRecord([
    createRecord(appRoles.killTierRoleIds?.[tier] || appRoles.killTierRoleIds?.[tierKey], "configured"),
    createRecord(dbConfig.generatedRoles?.tiers?.[tier] || dbConfig.generatedRoles?.tiers?.[tierKey], "discovered"),
  ], "configured");
}

function buildLegacyLegacyEloTierRecord(tier, { appConfig = {} } = {}) {
  const appRoles = getAppRoles(appConfig);
  const tierKey = String(tier);
  return createRecord(appRoles.legacyEloTierRoleIds?.[tier] || appRoles.legacyEloTierRoleIds?.[tierKey], "configured");
}

function buildLegacyRoleRecords({ db = {}, appConfig = {} } = {}) {
  return {
    moderator: buildLegacyBaseRoleRecord("moderator", { appConfig }),
    accessNormal: buildLegacyBaseRoleRecord("accessNormal", { appConfig }),
    accessWartime: buildLegacyBaseRoleRecord("accessWartime", { appConfig }),
    accessNonJjs: buildLegacyBaseRoleRecord("accessNonJjs", { appConfig }),
    verifyAccess: buildLegacyBaseRoleRecord("verifyAccess", { appConfig }),
    killTier: Object.fromEntries(KILL_TIER_SLOTS.map((tier) => [tier, buildLegacyKillTierRecord(tier, { db, appConfig })])),
    legacyEloTier: Object.fromEntries(LEGACY_ELO_TIER_SLOTS.map((tier) => [tier, buildLegacyLegacyEloTierRecord(tier, { appConfig })])),
  };
}

function buildLegacyCharacterRecords({ db = {}, appConfig = {}, excludedCharacterIds = [] } = {}) {
  const dbConfig = getDbConfig(db);
  const entries = new Map();
  const configuredCharacters = normalizeLegacyCharacters(appConfig.characters);
  const persistedCharacters = normalizeLegacyCharacters(dbConfig.characters)
    .filter((entry) => !normalizeExcludedCharacterIds(excludedCharacterIds).has(entry.id));
  const generatedCharacterIds = dbConfig.generatedRoles?.characters && typeof dbConfig.generatedRoles.characters === "object"
    ? dbConfig.generatedRoles.characters
    : {};
  const generatedCharacterLabels = dbConfig.generatedRoles?.characterLabels && typeof dbConfig.generatedRoles.characterLabels === "object"
    ? dbConfig.generatedRoles.characterLabels
    : {};

  function ensureEntry(id) {
    if (!entries.has(id)) {
      entries.set(id, {
        id,
        label: "",
        englishLabel: "",
        liveLabel: "",
        configuredRoleId: "",
        discoveredRoleId: "",
      });
    }
    return entries.get(id);
  }

  for (const entry of configuredCharacters) {
    const target = ensureEntry(entry.id);
    target.label = target.label || entry.label;
    target.englishLabel = target.englishLabel || entry.label;
    target.configuredRoleId = target.configuredRoleId || entry.roleId;
  }

  for (const entry of persistedCharacters) {
    const target = ensureEntry(entry.id);
    target.label = target.label || entry.label;
    target.englishLabel = target.englishLabel || entry.label;
    target.configuredRoleId = target.configuredRoleId || entry.roleId;
  }

  for (const [id, roleId] of Object.entries(generatedCharacterIds)) {
    const normalizedId = cleanString(id, 120);
    if (!normalizedId) continue;
    const target = ensureEntry(normalizedId);
    target.liveLabel = target.liveLabel || cleanString(generatedCharacterLabels[normalizedId], 200);
    target.englishLabel = target.englishLabel || target.label || target.liveLabel || normalizedId;
    target.discoveredRoleId = target.discoveredRoleId || cleanString(roleId, 80);
  }

  return Object.fromEntries(
    [...entries.entries()].map(([id, entry]) => [id, createCharacterRecord({
      id,
      label: entry.liveLabel || entry.label || id,
      englishLabel: entry.englishLabel || entry.label || entry.liveLabel || id,
      roleId: entry.configuredRoleId || entry.discoveredRoleId || "",
      source: entry.configuredRoleId ? "configured" : entry.discoveredRoleId ? "discovered" : "configured",
    })])
  );
}

function buildLegacyPanelRecords({ db = {} } = {}) {
  return buildPanelMap(getDbConfig(db));
}

function buildLegacyIntegrationState({ db = {} } = {}) {
  return buildIntegrationState(getDbConfig(db));
}

function buildLegacyPresentationState({ db = {}, presentation, nonGgsPresentation } = {}) {
  return buildPresentationState(getDbConfig(db), { presentation, nonGgsPresentation });
}

function buildLegacyInfluenceState({ db = {}, influence } = {}) {
  return buildInfluenceState(db, { influence });
}

function syncLegacyChannelWrites(db = {}, { appConfig = {}, slots = CHANNEL_SLOTS } = {}) {
  const normalizedSlots = normalizeChannelSlots(slots);
  const nextSot = normalizeSotState(db?.sot || {});
  const nextChannels = buildLegacyChannelRecords({ db, appConfig, slots: normalizedSlots });
  const writtenSlots = [];

  for (const slot of normalizedSlots) {
    const nextRecord = mergeLegacyRecord(nextSot.channels?.[slot], nextChannels[slot]);
    if (isEqual(nextSot.channels?.[slot], nextRecord)) continue;
    nextSot.channels[slot] = nextRecord;
    writtenSlots.push(slot);
  }

  if (writtenSlots.length || !db?.sot) {
    db.sot = nextSot;
  }

  return {
    mutated: writtenSlots.length > 0,
    writtenSlots,
    sot: db.sot || nextSot,
  };
}

function syncLegacyRoleWrites(db = {}, { appConfig = {} } = {}) {
  const nextSot = normalizeSotState(db?.sot || {});
  const nextRoles = buildLegacyRoleRecords({ db, appConfig });
  const writtenSlots = [];

  for (const slot of BASE_ROLE_SLOTS) {
    const nextRecord = mergeLegacyRecord(nextSot.roles?.[slot], nextRoles[slot]);
    if (isEqual(nextSot.roles?.[slot], nextRecord)) continue;
    nextSot.roles[slot] = nextRecord;
    writtenSlots.push(slot);
  }

  for (const tier of KILL_TIER_SLOTS) {
    const nextRecord = mergeLegacyRecord(nextSot.roles?.killTier?.[tier], nextRoles.killTier?.[tier]);
    if (isEqual(nextSot.roles?.killTier?.[tier], nextRecord)) continue;
    nextSot.roles.killTier[tier] = nextRecord;
    writtenSlots.push(`killTier.${tier}`);
  }

  for (const tier of LEGACY_ELO_TIER_SLOTS) {
    const nextRecord = mergeLegacyRecord(nextSot.roles?.legacyEloTier?.[tier], nextRoles.legacyEloTier?.[tier]);
    if (isEqual(nextSot.roles?.legacyEloTier?.[tier], nextRecord)) continue;
    nextSot.roles.legacyEloTier[tier] = nextRecord;
    writtenSlots.push(`legacyEloTier.${tier}`);
  }

  if (writtenSlots.length || !db?.sot) {
    db.sot = nextSot;
  }

  return {
    mutated: writtenSlots.length > 0,
    writtenSlots,
    sot: db.sot || nextSot,
  };
}

function syncLegacyCharacterWrites(db = {}, { appConfig = {}, excludedCharacterIds = [] } = {}) {
  const nextSot = normalizeSotState(db?.sot || {});
  const nextCharacters = buildLegacyCharacterRecords({ db, appConfig, excludedCharacterIds });
  const writtenSlots = [];
  const keys = new Set([
    ...Object.keys(nextSot.characters || {}),
    ...Object.keys(nextCharacters || {}),
  ]);

  for (const characterId of [...keys].sort()) {
    const nextRecord = mergeLegacyCharacterRecord(nextSot.characters?.[characterId], nextCharacters?.[characterId]);
    if (isEqual(nextSot.characters?.[characterId], nextRecord)) continue;
    if (nextRecord) nextSot.characters[characterId] = nextRecord;
    else delete nextSot.characters[characterId];
    writtenSlots.push(characterId);
  }

  if (writtenSlots.length || !db?.sot) {
    db.sot = nextSot;
  }

  return {
    mutated: writtenSlots.length > 0,
    writtenSlots,
    sot: db.sot || nextSot,
  };
}

function syncLegacyPanelWrites(db = {}) {
  const nextSot = normalizeSotState(db?.sot || {});
  const nextPanels = buildLegacyPanelRecords({ db });
  const writtenSlots = [];
  const keys = new Set([
    ...Object.keys(nextSot.panels || {}),
    ...Object.keys(nextPanels || {}),
  ]);

  for (const slot of [...keys].sort()) {
    const nextRecord = mergeLegacyPanelRecord(nextSot.panels?.[slot], nextPanels?.[slot]);
    if (isEqual(nextSot.panels?.[slot], nextRecord)) continue;
    if (nextRecord) nextSot.panels[slot] = nextRecord;
    else delete nextSot.panels[slot];
    writtenSlots.push(slot);
  }

  if (writtenSlots.length || !db?.sot) {
    db.sot = nextSot;
  }

  return {
    mutated: writtenSlots.length > 0,
    writtenSlots,
    sot: db.sot || nextSot,
  };
}

function syncLegacyIntegrationWrites(db = {}) {
  const nextSot = normalizeSotState(db?.sot || {});
  const nextIntegrations = buildLegacyIntegrationState({ db });
  const writtenSlots = [];

  for (const slot of ["elo", "roblox", "tierlist", "verification"]) {
    const nextRecord = mergeLegacyObject(nextSot.integrations?.[slot], nextIntegrations?.[slot]);
    if (isEqual(nextSot.integrations?.[slot], nextRecord)) continue;
    nextSot.integrations[slot] = nextRecord;
    writtenSlots.push(slot);
  }

  if (writtenSlots.length || !db?.sot) {
    db.sot = nextSot;
  }

  return {
    mutated: writtenSlots.length > 0,
    writtenSlots,
    sot: db.sot || nextSot,
  };
}

function syncLegacyPresentationWrites(db = {}, { presentation, nonGgsPresentation } = {}) {
  const nextSot = normalizeSotState(db?.sot || {});
  const nextPresentation = buildLegacyPresentationState({ db, presentation, nonGgsPresentation });
  const writtenSlots = [];
  const keys = new Set([
    ...Object.keys(nextSot.presentation || {}),
    ...Object.keys(nextPresentation || {}),
  ]);

  for (const slot of [...keys].sort()) {
    const nextRecord = mergeLegacyObject(nextSot.presentation?.[slot], nextPresentation?.[slot]);
    if (isEqual(nextSot.presentation?.[slot], nextRecord)) continue;
    nextSot.presentation[slot] = nextRecord;
    writtenSlots.push(slot);
  }

  if (writtenSlots.length || !db?.sot) {
    db.sot = nextSot;
  }

  return {
    mutated: writtenSlots.length > 0,
    writtenSlots,
    sot: db.sot || nextSot,
  };
}

function syncLegacyInfluenceWrites(db = {}, { influence } = {}) {
  const nextSot = normalizeSotState(db?.sot || {});
  const nextInfluence = buildLegacyInfluenceState({ db, influence });
  const writtenSlots = [];

  const mergedInfluence = mergeLegacyObject(nextSot.influence, nextInfluence);
  if (!isEqual(nextSot.influence, mergedInfluence)) {
    nextSot.influence = mergedInfluence;
    writtenSlots.push("current");
  }

  if (writtenSlots.length || !db?.sot) {
    db.sot = nextSot;
  }

  return {
    mutated: writtenSlots.length > 0,
    writtenSlots,
    sot: db.sot || nextSot,
  };
}

module.exports = {
  buildLegacyChannelRecord,
  buildLegacyChannelRecords,
  buildLegacyCharacterRecords,
  buildLegacyInfluenceState,
  buildLegacyIntegrationState,
  buildLegacyPanelRecords,
  buildLegacyPresentationState,
  buildLegacyRoleRecords,
  normalizeChannelSlots,
  syncLegacyCharacterWrites,
  syncLegacyChannelWrites,
  syncLegacyInfluenceWrites,
  syncLegacyIntegrationWrites,
  syncLegacyPanelWrites,
  syncLegacyPresentationWrites,
  syncLegacyRoleWrites,
};