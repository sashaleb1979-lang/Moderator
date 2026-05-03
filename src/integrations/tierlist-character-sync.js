"use strict";

function cleanText(value, limit = 200) {
  return String(value ?? "").trim().slice(0, limit);
}

function normalizeCharacterSyncId(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeCharacterSyncLabel(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ");
}

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

function registerLegacyAlias(index, value, character) {
  const raw = cleanText(value);
  if (!raw) return;

  const idKey = normalizeCharacterSyncId(raw);
  if (idKey && !index.byIdAlias.has(idKey)) {
    index.byIdAlias.set(idKey, character);
  }

  const labelKey = normalizeCharacterSyncLabel(raw);
  if (labelKey && !index.byLabelAlias.has(labelKey)) {
    index.byLabelAlias.set(labelKey, character);
  }
}

function buildLegacyCharacterSyncIndex(legacyCharacters = []) {
  const index = {
    byId: new Map(),
    byIdAlias: new Map(),
    byLabelAlias: new Map(),
  };

  for (const entry of ensureArray(legacyCharacters)) {
    const id = cleanText(entry?.id, 80);
    if (!id || index.byId.has(id)) continue;

    const character = {
      id,
      name: cleanText(entry?.name || entry?.label || id, 120) || id,
    };

    index.byId.set(id, character);
    registerLegacyAlias(index, id, character);
    registerLegacyAlias(index, character.name, character);
  }

  return index;
}

function ensureLegacyCharacterSyncIndex(legacyCharactersOrIndex) {
  if (legacyCharactersOrIndex?.byId instanceof Map) return legacyCharactersOrIndex;
  return buildLegacyCharacterSyncIndex(legacyCharactersOrIndex);
}

function collectRuntimeMatchCandidates(runtimeEntry) {
  const candidates = [];
  const push = (value) => {
    if (Array.isArray(value)) {
      for (const nested of value) push(nested);
      return;
    }

    const text = cleanText(value, 120);
    if (text) candidates.push(text);
  };

  push(runtimeEntry?.legacyId);
  push(runtimeEntry?.legacyCharacterId);
  push(runtimeEntry?.tierlistId);
  push(runtimeEntry?.id);
  push(runtimeEntry?.main);
  push(runtimeEntry?.label);
  push(runtimeEntry?.name);
  push(runtimeEntry?.aliases);
  push(runtimeEntry?.legacyAliases);

  return [...new Set(candidates)];
}

function resolveLegacyCharacterMatch(runtimeEntry, legacyCharactersOrIndex) {
  const index = ensureLegacyCharacterSyncIndex(legacyCharactersOrIndex);

  for (const candidate of collectRuntimeMatchCandidates(runtimeEntry)) {
    const exact = index.byId.get(candidate);
    if (exact) {
      return { character: exact, matchedBy: "exact-id", value: candidate };
    }

    const idKey = normalizeCharacterSyncId(candidate);
    if (idKey) {
      const byIdAlias = index.byIdAlias.get(idKey);
      if (byIdAlias) {
        return { character: byIdAlias, matchedBy: "normalized-id", value: candidate };
      }
    }

    const labelKey = normalizeCharacterSyncLabel(candidate);
    if (labelKey) {
      const byLabelAlias = index.byLabelAlias.get(labelKey);
      if (byLabelAlias) {
        return { character: byLabelAlias, matchedBy: "normalized-label", value: candidate };
      }
    }
  }

  return null;
}

function resolveLegacyCharacterIdsFromValues(values, legacyCharactersOrIndex) {
  const index = ensureLegacyCharacterSyncIndex(legacyCharactersOrIndex);
  const resolved = [];

  for (const value of ensureArray(values)) {
    const match = resolveLegacyCharacterMatch({ id: value, label: value, main: value }, index);
    if (match?.character?.id) resolved.push(match.character.id);
  }

  return [...new Set(resolved)].slice(0, 2);
}

function resolveLegacyMainIdsFromRuntimeEntries({ runtimeEntries = [], profileMainIds = [], legacyCharacters = [] } = {}) {
  const index = ensureLegacyCharacterSyncIndex(legacyCharacters);
  const matched = [];
  const unmatched = [];

  for (const entry of ensureArray(runtimeEntries)) {
    const match = resolveLegacyCharacterMatch(entry, index);
    if (match?.character?.id) {
      matched.push({
        runtimeId: cleanText(entry?.id, 80),
        roleId: cleanText(entry?.roleId, 80),
        legacyId: match.character.id,
        matchedBy: match.matchedBy,
      });
      continue;
    }

    unmatched.push({
      runtimeId: cleanText(entry?.id, 80),
      label: cleanText(entry?.label || entry?.main || entry?.name, 120),
      roleId: cleanText(entry?.roleId, 80),
    });
  }

  const mainIds = [...new Set(matched.map((entry) => entry.legacyId))].slice(0, 2);
  if (mainIds.length) {
    return { mainIds, source: "roles", matched, unmatched };
  }

  return {
    mainIds: resolveLegacyCharacterIdsFromValues(profileMainIds, index),
    source: "profile",
    matched,
    unmatched,
  };
}

function getLegacyMainsBackfillDisposition({ member = null, isTrackedUser = false } = {}) {
  if (!member && isTrackedUser) {
    return {
      shouldSync: false,
      skippedReason: "missing_member",
    };
  }

  return {
    shouldSync: true,
    skippedReason: "",
  };
}

function getLegacyTierlistClusterStatusNote(errorMessage) {
  const text = cleanText(errorMessage, 500);
  if (!text || text.includes("sourcePath не задан")) return "";
  return "_Кластеры tierlist временно недоступны._";
}

module.exports = {
  buildLegacyCharacterSyncIndex,
  getLegacyMainsBackfillDisposition,
  getLegacyTierlistClusterStatusNote,
  resolveLegacyCharacterIdsFromValues,
  resolveLegacyCharacterMatch,
  resolveLegacyMainIdsFromRuntimeEntries,
};
