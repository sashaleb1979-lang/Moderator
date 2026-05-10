"use strict";

const { createCharacterRecord, ensureSotState, normalizeCharacterRecord } = require("./schema");
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

function writeNativeCharacterRecord(db = {}, {
  characterId,
  label,
  englishLabel,
  roleId = "",
  source = "discovered",
  verifiedAt = null,
  evidence,
  history,
} = {}) {
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
  const next = createCharacterRecord({
    id,
    label: cleanString(label, 200) || cleanString(current?.label, 200) || id,
    englishLabel: cleanString(englishLabel, 200) || cleanString(current?.englishLabel, 200) || cleanString(label, 200) || id,
    roleId: normalizedRoleId,
    source,
    verifiedAt,
    evidence: buildNativeEvidence(current, evidence, cleanString(current?.roleId, 80) === normalizedRoleId),
    history: Array.isArray(history) ? clone(history) : (Array.isArray(current?.history) ? clone(current.history) : undefined),
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

function clearNativeCharacterRecord(db = {}, {
  characterId,
  label,
  englishLabel,
  source = "default",
  evidence,
} = {}) {
  return writeNativeCharacterRecord(db, {
    characterId,
    label,
    englishLabel,
    roleId: "",
    source,
    verifiedAt: null,
    evidence,
  });
}

function buildConfiguredCharacterCatalogView({
  configuredCharacters = [],
  resolvedRecords = [],
  excludedCharacterIds = [],
} = {}) {
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
      return {
        id: entry.id,
        label: cleanString(record?.label, 200) || entry.label,
        englishLabel: cleanString(record?.englishLabel, 200) || entry.label,
        roleId: cleanString(record?.roleId, 80) || cleanString(entry.roleId, 80),
        source: cleanString(record?.source, 40) || (cleanString(entry.roleId, 80) ? "configured" : "default"),
        verifiedAt: cleanString(record?.verifiedAt, 80),
        evidence: record?.evidence,
      };
    });
}

module.exports = {
  buildConfiguredCharacterCatalogView,
  clearNativeCharacterRecord,
  writeNativeCharacterRecord,
};