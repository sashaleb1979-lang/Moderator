"use strict";

const { getCharacterAliasNames } = require("../character-aliases");
const { createCharacterRecord, normalizeCharacterRecord } = require("../schema");
const {
  buildManagedCharacterRoleRecoveryPlan,
  normalizeManagedCharacterCatalog,
} = require("../recovery/plan");

function cleanString(value, limit = 200) {
  return String(value || "").trim().slice(0, limit);
}

function getVerifiedRoleIds(context = {}) {
  if (context.verifiedRoleIds instanceof Set) {
    return new Set([...context.verifiedRoleIds].map((value) => cleanString(value, 80)).filter(Boolean));
  }
  if (Array.isArray(context.verifiedRoleIds)) {
    return new Set(context.verifiedRoleIds.map((value) => cleanString(value, 80)).filter(Boolean));
  }
  if (context.guildSnapshot?.roleIds instanceof Set) {
    return new Set([...context.guildSnapshot.roleIds].map((value) => cleanString(value, 80)).filter(Boolean));
  }
  if (Array.isArray(context.guildSnapshot?.roleIds)) {
    return new Set(context.guildSnapshot.roleIds.map((value) => cleanString(value, 80)).filter(Boolean));
  }
  if (context.snapshot?.roleIds instanceof Set) {
    return new Set([...context.snapshot.roleIds].map((value) => cleanString(value, 80)).filter(Boolean));
  }
  if (Array.isArray(context.snapshot?.roleIds)) {
    return new Set(context.snapshot.roleIds.map((value) => cleanString(value, 80)).filter(Boolean));
  }
  return null;
}

function resolveVerifiedAt(roleId, persisted, context = {}) {
  const normalizedRoleId = cleanString(roleId, 80);
  if (!normalizedRoleId) return null;

  const verifiedRoleIds = getVerifiedRoleIds(context);
  if (!verifiedRoleIds) {
    return cleanString(persisted?.verifiedAt, 80) || null;
  }
  if (!verifiedRoleIds.has(normalizedRoleId)) return null;

  return cleanString(context.verifiedAt || context.guildSnapshot?.verifiedAt || context.snapshot?.verifiedAt, 80)
    || cleanString(persisted?.verifiedAt, 80)
    || null;
}

function getDbConfig(db = {}) {
  return db && typeof db.config === "object" && !Array.isArray(db.config) ? db.config : {};
}

function getAppCharacters(appConfig = {}) {
  return Array.isArray(appConfig?.characters) ? appConfig.characters : [];
}

function getPersistedCharacters(db = {}) {
  return db?.sot?.characters && typeof db.sot.characters === "object" && !Array.isArray(db.sot.characters)
    ? db.sot.characters
    : {};
}

function isNativeOwnedCharacterRecord(record) {
  return record?.evidence?.nativeWriter === true;
}

function getGeneratedRoleIds(dbConfig = {}) {
  return dbConfig.generatedRoles?.characters && typeof dbConfig.generatedRoles.characters === "object"
    ? dbConfig.generatedRoles.characters
    : {};
}

function getGeneratedRoleLabels(dbConfig = {}) {
  return dbConfig.generatedRoles?.characterLabels && typeof dbConfig.generatedRoles.characterLabels === "object"
    ? dbConfig.generatedRoles.characterLabels
    : {};
}

function getExcludedCharacterIds(context = {}) {
  const values = Array.isArray(context.excludedCharacterIds)
    ? context.excludedCharacterIds
    : (context.excludedCharacterIds instanceof Set ? [...context.excludedCharacterIds] : []);
  return new Set(values.map((value) => cleanString(value, 120)).filter(Boolean));
}

function mergeCharacterAliasNames(entry = {}) {
  const aliasNames = [
    ...getCharacterAliasNames(entry?.id),
    ...(Array.isArray(entry?.evidence?.aliasNames) ? entry.evidence.aliasNames : []),
    ...(Array.isArray(entry?.aliasNames) ? entry.aliasNames : []),
  ];

  return [...new Set(aliasNames.map((value) => cleanString(value, 200)).filter(Boolean))];
}

function enrichManagedCharacterEntry(entry = {}) {
  const aliasNames = mergeCharacterAliasNames(entry);
  const nextEvidence = entry?.evidence && typeof entry.evidence === "object"
    ? { ...entry.evidence }
    : {};
  if (aliasNames.length) nextEvidence.aliasNames = aliasNames;

  return {
    ...entry,
    aliasNames,
    evidence: Object.keys(nextEvidence).length ? nextEvidence : undefined,
  };
}

function getManagedCatalog({ db = {}, appConfig = {}, managedCharacters, excludedCharacterIds } = {}) {
  if (Array.isArray(managedCharacters) && managedCharacters.length) {
    return normalizeManagedCharacterCatalog(managedCharacters).map((entry) => {
      const rawEntry = managedCharacters.find((candidate) => cleanString(candidate?.id, 120) === entry.id) || {};
      return enrichManagedCharacterEntry({ ...rawEntry, ...entry });
    });
  }

  const excludedIds = getExcludedCharacterIds({ excludedCharacterIds });
  const configuredCatalog = getAppCharacters(appConfig)
    .filter((entry) => !excludedIds.has(cleanString(entry?.id, 120)));

  return normalizeManagedCharacterCatalog(configuredCatalog).map((entry) => {
    const rawEntry = configuredCatalog.find((candidate) => cleanString(candidate?.id, 120) === entry.id) || {};
    return enrichManagedCharacterEntry({ ...rawEntry, ...entry });
  });
}

function hasEntries(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return false;
}

function normalizeRecoveryPlan(plan = {}) {
  return {
    recoveredRoleIds: plan && typeof plan.recoveredRoleIds === "object" ? plan.recoveredRoleIds : {},
    recoveredRoleLabels: plan && typeof plan.recoveredRoleLabels === "object" ? plan.recoveredRoleLabels : {},
    ambiguous: Array.isArray(plan?.ambiguous) ? plan.ambiguous : [],
    unresolved: Array.isArray(plan?.unresolved) ? plan.unresolved : [],
    analysisByCharacterId: plan && typeof plan.analysisByCharacterId === "object" ? plan.analysisByCharacterId : {},
  };
}

function ensureRecoveryPlan(context = {}) {
  if (context.recoveryPlan) return normalizeRecoveryPlan(context.recoveryPlan);

  const managedCharacters = getManagedCatalog(context);
  if (!hasEntries(context.profiles) && !hasEntries(context.submissions) && !hasEntries(context.guildRoles) && !hasEntries(context.historicalRoleIds)) {
    return normalizeRecoveryPlan();
  }

  const historicalRoleIds = context.historicalRoleIds && typeof context.historicalRoleIds === "object"
    ? context.historicalRoleIds
    : {};

  return normalizeRecoveryPlan(buildManagedCharacterRoleRecoveryPlan({
    managedCharacters,
    profiles: context.profiles,
    submissions: context.submissions,
    guildRoles: context.guildRoles,
    historicalRoleIds,
    generatedRoleIds: getGeneratedRoleIds(getDbConfig(context.db)),
  }));
}

function buildRecoveryEvidence(analysis) {
  if (!analysis?.best && !analysis?.second) return undefined;

  const candidates = [];
  if (analysis.best?.roleId) {
    candidates.push({
      roleId: analysis.best.roleId,
      roleName: analysis.best.roleName,
      overlap: Number(analysis.best.overlap || 0),
    });
  }
  if (analysis.second?.roleId) {
    candidates.push({
      roleId: analysis.second.roleId,
      roleName: analysis.second.roleName,
      overlap: Number(analysis.second.overlap || 0),
    });
  }

  return {
    overlap: Number(analysis.best?.overlap || 0),
    coverage: Number(analysis.best?.coverage || 0),
    roleShare: Number(analysis.best?.roleShare || 0),
    holderCount: Number(analysis.best?.holderCount || 0),
    exactName: Boolean(analysis.best?.exactName),
    preferredMatch: Boolean(analysis.best?.preferredMatch),
    candidates,
  };
}

function mergeCharacterEvidence(...values) {
  const aliasNames = [];
  const merged = {};

  for (const value of values) {
    if (!value || typeof value !== "object") continue;

    const nextAliasNames = Array.isArray(value.aliasNames) ? value.aliasNames : [];
    aliasNames.push(...nextAliasNames);

    for (const [key, entryValue] of Object.entries(value)) {
      if (key === "aliasNames") continue;
      if (entryValue === undefined) continue;
      merged[key] = entryValue;
    }
  }

  const normalizedAliasNames = [...new Set(aliasNames.map((value) => cleanString(value, 200)).filter(Boolean))];
  if (normalizedAliasNames.length) merged.aliasNames = normalizedAliasNames;

  return Object.keys(merged).length ? merged : undefined;
}

function buildCharacterFallbackIdentity({ id, persisted, catalogEntry, generatedLabel, recoveredLabel, analysis }) {
  const label = cleanString(generatedLabel, 200)
    || cleanString(recoveredLabel, 200)
    || cleanString(persisted?.label, 200)
    || cleanString(catalogEntry?.label, 200)
    || cleanString(persisted?.englishLabel, 200)
    || id;
  const englishLabel = cleanString(persisted?.englishLabel, 200)
    || cleanString(catalogEntry?.label, 200)
    || label
    || id;

  return {
    label,
    englishLabel,
    evidence: mergeCharacterEvidence(
      persisted?.evidence,
      cleanString(catalogEntry?.roleId, 80) ? undefined : catalogEntry?.evidence,
      buildRecoveryEvidence(analysis)
    ),
  };
}

function buildCharacterCandidates({
  persisted,
  catalogEntry,
  generatedLabel,
  recoveredLabel,
  analysis,
}) {
  const persistedRoleId = cleanString(persisted?.roleId, 80);
  const configuredRoleId = cleanString(catalogEntry?.roleId, 80);
  const recoveredRoleId = cleanString(recoveredLabel?.roleId, 80);
  const discoveredRoleId = cleanString(generatedLabel?.roleId, 80);
  const fallbackEnglishLabel = cleanString(persisted?.englishLabel, 200)
    || cleanString(catalogEntry?.label, 200)
    || cleanString(persisted?.label, 200);
  const fallbackLabel = cleanString(generatedLabel?.label, 200)
    || cleanString(recoveredLabel?.label, 200)
    || cleanString(persisted?.label, 200)
    || cleanString(catalogEntry?.label, 200);

  return [
    persistedRoleId ? {
      roleId: persistedRoleId,
      source: cleanString(persisted?.source, 40) || "configured",
      label: cleanString(persisted?.label, 200) || fallbackLabel,
      englishLabel: cleanString(persisted?.englishLabel, 200) || fallbackEnglishLabel || fallbackLabel,
      evidence: persisted?.evidence,
      persisted,
    } : null,
    configuredRoleId ? {
      roleId: configuredRoleId,
      source: "configured",
      label: fallbackLabel,
      englishLabel: cleanString(catalogEntry?.label, 200) || fallbackEnglishLabel || fallbackLabel,
      evidence: persistedRoleId === configuredRoleId ? persisted?.evidence : undefined,
      persisted,
    } : null,
    recoveredRoleId ? {
      roleId: recoveredRoleId,
      source: "recovered",
      label: cleanString(recoveredLabel?.label, 200) || fallbackLabel,
      englishLabel: cleanString(catalogEntry?.label, 200) || fallbackEnglishLabel || cleanString(recoveredLabel?.label, 200) || fallbackLabel,
      evidence: buildRecoveryEvidence(analysis),
      persisted,
    } : null,
    discoveredRoleId ? {
      roleId: discoveredRoleId,
      source: "discovered",
      label: cleanString(generatedLabel?.label, 200) || fallbackLabel,
      englishLabel: cleanString(catalogEntry?.label, 200) || fallbackEnglishLabel || cleanString(generatedLabel?.label, 200) || fallbackLabel,
      evidence: persistedRoleId === discoveredRoleId ? persisted?.evidence : undefined,
      persisted,
    } : null,
  ].filter(Boolean);
}

function selectCharacterCandidate(candidates = [], context = {}) {
  const verifiedRoleIds = getVerifiedRoleIds(context);
  const normalizedCandidates = (Array.isArray(candidates) ? candidates : [])
    .filter((candidate) => cleanString(candidate?.roleId, 80));

  if (verifiedRoleIds && verifiedRoleIds.size) {
    for (const candidate of normalizedCandidates) {
      if (!verifiedRoleIds.has(cleanString(candidate.roleId, 80))) continue;
      return {
        ...candidate,
        verifiedAt: resolveVerifiedAt(candidate.roleId, candidate.persisted, context),
      };
    }
  }

  const fallback = normalizedCandidates[0] || null;
  if (!fallback) return null;
  return {
    ...fallback,
    verifiedAt: resolveVerifiedAt(fallback.roleId, fallback.persisted, context),
  };
}

function resolveCharacterRecord({ characterId, db = {}, appConfig = {}, managedCharacters, recoveryPlan, ...context } = {}) {
  const id = cleanString(characterId, 120);
  if (!id) return null;

  const catalog = getManagedCatalog({ db, appConfig, managedCharacters, ...context });
  const catalogEntry = catalog.find((entry) => entry.id === id) || null;
  const persisted = normalizeCharacterRecord(getPersistedCharacters(db)[id]);
  if (!catalogEntry && !persisted) return null;

  const dbConfig = getDbConfig(db);
  const generatedRoleIds = getGeneratedRoleIds(dbConfig);
  const generatedRoleLabels = getGeneratedRoleLabels(dbConfig);
  const nextRecoveryPlan = ensureRecoveryPlan({ db, appConfig, managedCharacters: catalog, recoveryPlan, ...context });
  const analysis = nextRecoveryPlan.analysisByCharacterId[id] || null;
  const useLegacyGeneratedFallback = !isNativeOwnedCharacterRecord(persisted);

  const selectedCandidate = selectCharacterCandidate(buildCharacterCandidates({
    persisted,
    catalogEntry,
    generatedLabel: useLegacyGeneratedFallback ? {
      roleId: generatedRoleIds[id],
      label: generatedRoleLabels[id],
    } : null,
    recoveredLabel: {
      roleId: nextRecoveryPlan.recoveredRoleIds[id],
      label: nextRecoveryPlan.recoveredRoleLabels[id],
    },
    analysis,
  }), context);
  const fallbackIdentity = buildCharacterFallbackIdentity({
    id,
    persisted,
    catalogEntry,
    generatedLabel: useLegacyGeneratedFallback ? generatedRoleLabels[id] : "",
    recoveredLabel: nextRecoveryPlan.recoveredRoleLabels[id],
    analysis,
  });
  const roleId = cleanString(selectedCandidate?.roleId, 80);
  const source = selectedCandidate?.source
    || (persisted ? cleanString(persisted.source, 40) || "configured" : catalogEntry ? "configured" : "default");
  const label = cleanString(selectedCandidate?.label, 200)
    || fallbackIdentity.label;
  const englishLabel = cleanString(selectedCandidate?.englishLabel, 200)
    || fallbackIdentity.englishLabel;
  const evidence = selectedCandidate?.evidence !== undefined
    ? selectedCandidate.evidence
    : fallbackIdentity.evidence;
  const verifiedAt = selectedCandidate?.verifiedAt || null;

  return createCharacterRecord({
    id,
    label,
    englishLabel,
    roleId,
    source,
    verifiedAt,
    evidence,
  });
}

function resolveAllCharacterRecords({ db = {}, appConfig = {}, managedCharacters, recoveryPlan, ...context } = {}) {
  const catalog = getManagedCatalog({ db, appConfig, managedCharacters, ...context });
  const persistedCharacters = getPersistedCharacters(db);
  const ids = new Set([
    ...catalog.map((entry) => entry.id),
    ...Object.keys(persistedCharacters),
  ]);
  const nextRecoveryPlan = ensureRecoveryPlan({ db, appConfig, managedCharacters: catalog, recoveryPlan, ...context });
  const records = {};

  for (const id of ids) {
    const record = resolveCharacterRecord({
      characterId: id,
      db,
      appConfig,
      managedCharacters: catalog,
      recoveryPlan: nextRecoveryPlan,
      ...context,
    });
    if (record) records[id] = record;
  }

  return records;
}

function buildCharacterOrderIndex(context = {}) {
  return new Map(
    getManagedCatalog(context).map((entry, index) => [entry.id, index])
  );
}

function listCharacterRecords({ pickerOnly = false, includeUnresolved = true, ...context } = {}) {
  let records = Object.values(resolveAllCharacterRecords(context));
  const characterOrderIndex = buildCharacterOrderIndex(context);
  if (pickerOnly) {
    records = records.filter((record) => cleanString(record?.verifiedAt, 80));
  } else if (!includeUnresolved) {
    records = records.filter((record) => cleanString(record?.roleId, 80));
  }

  records.sort((left, right) => {
    if (pickerOnly) {
      const leftResolved = cleanString(left?.roleId, 80) ? 1 : 0;
      const rightResolved = cleanString(right?.roleId, 80) ? 1 : 0;
      if (leftResolved !== rightResolved) return rightResolved - leftResolved;
    }

    const leftOrder = characterOrderIndex.has(left?.id) ? characterOrderIndex.get(left.id) : Number.MAX_SAFE_INTEGER;
    const rightOrder = characterOrderIndex.has(right?.id) ? characterOrderIndex.get(right.id) : Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;

    return String(left?.label || left?.id || "").localeCompare(String(right?.label || right?.id || ""), "ru");
  });

  return records;
}

module.exports = {
  listCharacterRecords,
  resolveAllCharacterRecords,
  resolveCharacterRecord,
};