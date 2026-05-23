"use strict";

const { createCharacterRecord, ensureSotState, normalizeCharacterRecord } = require("./schema");
const { getCharacterAliasNames } = require("./character-aliases");
const { normalizeManagedCharacterCatalog } = require("./recovery/plan");

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

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isManualOverrideCharacterRecord(record) {
  return String(record?.source || "").trim() === "manual"
    && record?.evidence?.manualOverride === true;
}

function buildNativeEvidence(currentRecord, nextEvidence, sameRole) {
  const evidence = sameRole && isPlainObject(currentRecord?.evidence)
    ? clone(currentRecord.evidence)
    : {};

  if (isPlainObject(nextEvidence)) {
    Object.assign(evidence, clone(nextEvidence));
  }

  evidence.nativeWriter = true;
  return evidence;
}

function writeNativeCharacterRecord(db = {}, options = {}) {
  const {
    characterId,
    label,
    englishLabel,
    roleId = "",
    source = "discovered",
    verifiedAt = null,
    evidence,
    history,
    wikiUrl,
  } = options;
  const id = cleanString(characterId, 120);
  if (!id) throw new Error("characterId is required");

  const state = ensureSotState(db);
  const current = normalizeCharacterRecord(state.sot.characters?.[id]);
  if (isManualOverrideCharacterRecord(current) && source !== "manual") {
    return {
      mutated: false,
      preserved: true,
      record: current,
    };
  }

  const normalizedRoleId = cleanString(roleId, 80);
  const hasWikiUrlOverride = Object.prototype.hasOwnProperty.call(options, "wikiUrl");
  const next = createCharacterRecord({
    id,
    label: cleanString(label, 200) || cleanString(current?.label, 200) || id,
    englishLabel: cleanString(englishLabel, 200) || cleanString(current?.englishLabel, 200) || cleanString(label, 200) || id,
    roleId: normalizedRoleId,
    source,
    verifiedAt,
    evidence: buildNativeEvidence(current, evidence, cleanString(current?.roleId, 80) === normalizedRoleId),
    history: Array.isArray(history) ? clone(history) : (Array.isArray(current?.history) ? clone(current.history) : undefined),
    wikiUrl: hasWikiUrlOverride ? cleanString(wikiUrl, 2000) : cleanString(current?.wikiUrl, 2000),
  });

  if (isEqual(current, next)) {
    return {
      mutated: false,
      preserved: false,
      record: next,
    };
  }

  state.sot.characters[id] = next;
  return {
    mutated: true,
    preserved: false,
    record: next,
  };
}

function clearNativeCharacterRecord(db = {}, options = {}) {
  const {
    characterId,
    label,
    englishLabel,
    source = "default",
    evidence,
  } = options;
  const nextOptions = {
    characterId,
    label,
    englishLabel,
    roleId: "",
    source,
    verifiedAt: null,
    evidence,
  };
  if (Object.prototype.hasOwnProperty.call(options, "wikiUrl")) {
    nextOptions.wikiUrl = options.wikiUrl;
  }
  return writeNativeCharacterRecord(db, nextOptions);
}

function buildConfiguredCharacterCatalogView({
  configuredCharacters = [],
  resolvedRecords = [],
  excludedCharacterIds = [],
} = {}) {
  const rawConfiguredById = new Map(
    (Array.isArray(configuredCharacters) ? configuredCharacters : [])
      .map((entry) => [cleanString(entry?.id, 120), entry])
      .filter(([id]) => Boolean(id))
  );
  const records = Array.isArray(resolvedRecords)
    ? resolvedRecords
    : (resolvedRecords && typeof resolvedRecords === "object" ? Object.values(resolvedRecords) : []);
  const recordById = new Map(
    records
      .map((record) => normalizeCharacterRecord(record))
      .filter(Boolean)
      .map((record) => [record.id, record])
  );
  const excludedIds = new Set(
    (Array.isArray(excludedCharacterIds) ? excludedCharacterIds : [])
      .map((value) => cleanString(value, 120))
      .filter(Boolean)
  );

  return normalizeManagedCharacterCatalog(configuredCharacters)
    .filter((entry) => !excludedIds.has(entry.id))
    .map((entry) => {
      const record = recordById.get(entry.id) || null;
      const rawConfigured = rawConfiguredById.get(entry.id) || null;
      const wikiUrl = cleanString(record?.wikiUrl, 2000) || cleanString(rawConfigured?.wikiUrl, 2000);
      return {
        id: entry.id,
        label: cleanString(record?.label, 200) || entry.label,
        englishLabel: cleanString(record?.englishLabel, 200) || entry.label,
        roleId: cleanString(record?.roleId, 80) || cleanString(entry.roleId, 80),
        source: cleanString(record?.source, 40) || (cleanString(entry.roleId, 80) ? "configured" : "default"),
        verifiedAt: cleanString(record?.verifiedAt, 80),
        evidence: record?.evidence,
        ...(wikiUrl ? { wikiUrl } : {}),
      };
    });
}

function upsertLegacyConfiguredCharacter(db, entry) {
  db.config ||= {};
  db.config.characters = Array.isArray(db.config.characters) ? db.config.characters : [];

  const targetId = cleanString(entry?.id, 120);
  const targetRoleId = cleanString(entry?.roleId, 80);
  if (!targetId || !targetRoleId) return false;

  let mutated = false;
  let found = false;
  for (const character of db.config.characters) {
    if (!character || typeof character !== "object" || Array.isArray(character)) continue;
    const currentId = cleanString(character.id, 120);
    const currentRoleId = cleanString(character.roleId, 80);
    if (currentId === targetId) {
      found = true;
      if (character.label !== entry.label) {
        character.label = entry.label;
        mutated = true;
      }
      if (currentRoleId !== targetRoleId) {
        character.roleId = targetRoleId;
        mutated = true;
      }
      continue;
    }
    if (currentRoleId === targetRoleId) {
      character.roleId = "";
      mutated = true;
    }
  }

  if (!found) {
    db.config.characters.push({
      id: targetId,
      label: cleanString(entry.label, 120) || targetId,
      roleId: targetRoleId,
    });
    mutated = true;
  }

  return mutated;
}

function syncLegacyGeneratedCharacterBinding(db, entry) {
  db.config ||= {};
  db.config.generatedRoles ||= {};
  db.config.generatedRoles.characters ||= {};
  db.config.generatedRoles.characterLabels ||= {};

  const targetId = cleanString(entry?.id, 120);
  const targetLabel = cleanString(entry?.label, 200) || targetId;
  const targetRoleId = cleanString(entry?.roleId, 80);
  if (!targetId || !targetRoleId) return false;

  let mutated = false;
  for (const [characterId, roleId] of Object.entries(db.config.generatedRoles.characters)) {
    if (characterId === targetId) continue;
    if (cleanString(roleId, 80) !== targetRoleId) continue;
    delete db.config.generatedRoles.characters[characterId];
    delete db.config.generatedRoles.characterLabels[characterId];
    mutated = true;
  }

  if (db.config.generatedRoles.characters[targetId] !== targetRoleId) {
    db.config.generatedRoles.characters[targetId] = targetRoleId;
    mutated = true;
  }
  if (db.config.generatedRoles.characterLabels[targetId] !== targetLabel) {
    db.config.generatedRoles.characterLabels[targetId] = targetLabel;
    mutated = true;
  }

  return mutated;
}

function clearDuplicateSotCharacterRoleBindings(state, entry) {
  const targetId = cleanString(entry?.id, 120);
  const targetRoleId = cleanString(entry?.roleId, 80);
  if (!targetId || !targetRoleId) return { mutated: false, clearedIds: [] };

  let mutated = false;
  const clearedIds = [];
  for (const [characterId, rawRecord] of Object.entries(state.sot.characters || {})) {
    const normalizedId = cleanString(characterId, 120);
    if (!normalizedId || normalizedId === targetId) continue;
    const record = normalizeCharacterRecord(rawRecord);
    if (cleanString(record?.roleId, 80) !== targetRoleId) continue;
    if (isManualOverrideCharacterRecord(record)) continue;

    const next = createCharacterRecord({
      id: normalizedId,
      label: cleanString(record?.label, 200) || cleanString(record?.englishLabel, 200) || normalizedId,
      englishLabel: cleanString(record?.englishLabel, 200) || cleanString(record?.label, 200) || normalizedId,
      roleId: "",
      source: "default",
      verifiedAt: null,
      evidence: buildNativeEvidence(record, {
        duplicateClearedFor: targetId,
        previousRoleId: targetRoleId,
      }, false),
      wikiUrl: cleanString(record?.wikiUrl, 2000),
    });

    if (!isEqual(rawRecord, next)) {
      state.sot.characters[normalizedId] = next;
      mutated = true;
      clearedIds.push(normalizedId);
    }
  }

  return { mutated, clearedIds };
}

function applyConfiguredCharacterRoleBindings(db = {}, appConfig = {}, options = {}) {
  const configuredCharacters = normalizeManagedCharacterCatalog(appConfig?.characters)
    .filter((entry) => cleanString(entry.roleId, 80));
  if (!configuredCharacters.length) {
    return { mutated: false, writtenIds: [], duplicateClearedIds: [] };
  }

  const rawById = new Map(
    (Array.isArray(appConfig?.characters) ? appConfig.characters : [])
      .map((entry) => {
        const normalized = normalizeManagedCharacterCatalog([entry])[0] || null;
        return normalized ? [normalized.id, entry] : null;
      })
      .filter(Boolean)
  );
  const verifiedAt = cleanString(
    typeof options.nowIso === "function" ? options.nowIso() : options.verifiedAt,
    80
  ) || null;
  const state = ensureSotState(db);
  let mutated = false;
  const writtenIds = [];
  const duplicateClearedIds = [];

  for (const entry of configuredCharacters) {
    const raw = rawById.get(entry.id) || {};
    const target = {
      ...entry,
      label: cleanString(raw.label || entry.label, 200) || entry.id,
      wikiUrl: cleanString(raw.wikiUrl, 2000),
    };

    const duplicateState = clearDuplicateSotCharacterRoleBindings(state, target);
    if (duplicateState.mutated) {
      mutated = true;
      duplicateClearedIds.push(...duplicateState.clearedIds);
    }

    const aliasNames = getCharacterAliasNames(target.id);
    const writeResult = writeNativeCharacterRecord(db, {
      characterId: target.id,
      label: target.label,
      englishLabel: cleanString(raw.label || entry.label, 200) || target.label,
      roleId: target.roleId,
      source: "configured",
      verifiedAt,
      evidence: aliasNames.length ? { aliasNames } : undefined,
      wikiUrl: target.wikiUrl,
    });
    if (writeResult.mutated) {
      mutated = true;
      writtenIds.push(target.id);
    }

    if (upsertLegacyConfiguredCharacter(db, target)) mutated = true;
    if (syncLegacyGeneratedCharacterBinding(db, target)) mutated = true;
  }

  return {
    mutated,
    writtenIds,
    duplicateClearedIds: [...new Set(duplicateClearedIds)],
  };
}

module.exports = {
  applyConfiguredCharacterRoleBindings,
  buildConfiguredCharacterCatalogView,
  clearNativeCharacterRecord,
  writeNativeCharacterRecord,
};
