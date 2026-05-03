"use strict";

function cleanText(value, limit = 200) {
  return String(value ?? "").trim().slice(0, limit);
}

function normalizeManagedCharacterId(value, fallback = "") {
  const text = cleanText(value, 120).toLowerCase();
  const normalized = text.replace(/[^a-zа-яё0-9]+/gi, "_").replace(/^_+|_+$/g, "");
  return normalized || cleanText(fallback, 120);
}

function normalizeManagedCharacterCatalog(characters = []) {
  const out = [];
  const seen = new Set();

  for (const entry of Array.isArray(characters) ? characters : []) {
    const label = cleanText(entry?.label || entry?.name || entry?.id, 120);
    const id = normalizeManagedCharacterId(entry?.id || label, `char_${out.length + 1}`);
    const roleId = cleanText(entry?.roleId, 80);
    if (!label || !id || seen.has(id)) continue;

    seen.add(id);
    out.push({ id, label, roleId });
  }

  return out;
}

function isPlaceholderRoleId(value) {
  const text = cleanText(value, 80);
  return !text || text.startsWith("REPLACE_") || text.startsWith("YOUR_");
}

function toEntryList(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function recordHistoricalRoleBindings(countsByCharacterId, managedCharacterIds, characterIds, roleIds) {
  const ids = Array.isArray(characterIds) ? characterIds : [];
  const roles = Array.isArray(roleIds) ? roleIds : [];
  const limit = Math.min(ids.length, roles.length);

  for (let index = 0; index < limit; index += 1) {
    const characterId = cleanText(ids[index], 80);
    const roleId = cleanText(roles[index], 80);
    if (!characterId || isPlaceholderRoleId(roleId) || !managedCharacterIds.has(characterId)) continue;

    let counts = countsByCharacterId.get(characterId);
    if (!counts) {
      counts = new Map();
      countsByCharacterId.set(characterId, counts);
    }
    counts.set(roleId, (counts.get(roleId) || 0) + 1);
  }
}

function recordHistoricalUserBindings(userIdsByCharacterId, managedCharacterIds, characterIds, userId) {
  const ids = Array.isArray(characterIds) ? characterIds : [];
  const normalizedUserId = cleanText(userId, 80);
  if (!normalizedUserId) return;

  for (const rawCharacterId of ids) {
    const characterId = cleanText(rawCharacterId, 80);
    if (!characterId || !managedCharacterIds.has(characterId)) continue;

    let userIds = userIdsByCharacterId.get(characterId);
    if (!userIds) {
      userIds = new Set();
      userIdsByCharacterId.set(characterId, userIds);
    }
    userIds.add(normalizedUserId);
  }
}

function toUserLinkedEntries(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => ({
      userId: cleanText(entry?.userId, 80),
      entry,
    }));
  }

  if (value && typeof value === "object") {
    return Object.entries(value).map(([userId, entry]) => ({
      userId: cleanText(entry?.userId, 80) || cleanText(userId, 80),
      entry,
    }));
  }

  return [];
}

function buildHistoricalManagedCharacterRoleIds({ managedCharacters = [], profiles = [], submissions = [] } = {}) {
  const managedCharacterIds = new Set(
    normalizeManagedCharacterCatalog(managedCharacters)
      .map((entry) => entry.id)
      .filter(Boolean)
  );
  if (!managedCharacterIds.size) return {};

  const countsByCharacterId = new Map();

  for (const profile of toEntryList(profiles)) {
    recordHistoricalRoleBindings(
      countsByCharacterId,
      managedCharacterIds,
      profile?.mainCharacterIds,
      profile?.characterRoleIds
    );
  }

  for (const submission of toEntryList(submissions)) {
    recordHistoricalRoleBindings(
      countsByCharacterId,
      managedCharacterIds,
      submission?.mainCharacterIds,
      submission?.mainRoleIds
    );
  }

  const historicalRoleIds = {};
  for (const [characterId, counts] of countsByCharacterId) {
    let bestRoleId = "";
    let bestCount = -1;

    for (const [roleId, count] of counts) {
      if (count > bestCount) {
        bestRoleId = roleId;
        bestCount = count;
      }
    }

    if (bestRoleId) historicalRoleIds[characterId] = bestRoleId;
  }

  return historicalRoleIds;
}

function buildHistoricalManagedCharacterUserIds({ managedCharacters = [], profiles = [], submissions = [] } = {}) {
  const managedCharacterIds = new Set(
    normalizeManagedCharacterCatalog(managedCharacters)
      .map((entry) => entry.id)
      .filter(Boolean)
  );
  if (!managedCharacterIds.size) return {};

  const userIdsByCharacterId = new Map();

  for (const { userId, entry } of toUserLinkedEntries(profiles)) {
    recordHistoricalUserBindings(
      userIdsByCharacterId,
      managedCharacterIds,
      entry?.mainCharacterIds,
      userId
    );
  }

  for (const { userId, entry } of toUserLinkedEntries(submissions)) {
    recordHistoricalUserBindings(
      userIdsByCharacterId,
      managedCharacterIds,
      entry?.mainCharacterIds,
      userId
    );
  }

  const historicalUserIds = {};
  for (const [characterId, userIds] of userIdsByCharacterId) {
    historicalUserIds[characterId] = [...userIds];
  }

  return historicalUserIds;
}

function normalizeGuildRoleCandidates(guildRoles = []) {
  const out = [];
  const seen = new Set();

  for (const rawRole of Array.isArray(guildRoles) ? guildRoles : []) {
    const id = cleanText(rawRole?.id, 80);
    const name = cleanText(rawRole?.name, 120);
    if (!id || !name || seen.has(id)) continue;

    seen.add(id);
    out.push({
      id,
      name,
      memberUserIds: [...new Set(
        (Array.isArray(rawRole?.memberUserIds) ? rawRole.memberUserIds : [])
          .map((userId) => cleanText(userId, 80))
          .filter(Boolean)
      )],
    });
  }

  return out;
}

function countSharedUserIds(memberUserIds = [], expectedUserIds = new Set()) {
  let overlap = 0;
  for (const userId of memberUserIds) {
    if (expectedUserIds.has(userId)) overlap += 1;
  }
  return overlap;
}

function compareRecoveryCandidates(left, right) {
  const leftScore = Number(left?.score || 0);
  const rightScore = Number(right?.score || 0);
  if (leftScore !== rightScore) return rightScore - leftScore;

  const leftOverlap = Number(left?.overlap || 0);
  const rightOverlap = Number(right?.overlap || 0);
  if (leftOverlap !== rightOverlap) return rightOverlap - leftOverlap;

  const leftCoverage = Number(left?.coverage || 0);
  const rightCoverage = Number(right?.coverage || 0);
  if (leftCoverage !== rightCoverage) return rightCoverage - leftCoverage;

  const leftRoleShare = Number(left?.roleShare || 0);
  const rightRoleShare = Number(right?.roleShare || 0);
  if (leftRoleShare !== rightRoleShare) return rightRoleShare - leftRoleShare;

  const leftHolders = Number(left?.holderCount || 0);
  const rightHolders = Number(right?.holderCount || 0);
  if (leftHolders !== rightHolders) return rightHolders - leftHolders;

  return String(left?.roleName || "").localeCompare(String(right?.roleName || ""), "ru");
}

function isConfidentRecoveryCandidate(best, second) {
  if (!best) return false;
  if (best.preferredMatch) return true;
  if (best.overlap >= 2 && (!second || best.overlap > Number(second.overlap || 0))) return true;
  if (best.overlap >= 1 && best.coverage >= 0.75 && best.roleShare >= 0.75 && (!second || Number(second.overlap || 0) === 0)) {
    return true;
  }
  if (best.exactName && best.overlap >= 1 && (!second || Number(second.overlap || 0) === 0)) return true;
  return false;
}

function buildManagedCharacterRoleRecoveryPlan({
  managedCharacters = [],
  profiles = [],
  submissions = [],
  guildRoles = [],
  historicalRoleIds = {},
  generatedRoleIds = {},
} = {}) {
  const managedCatalog = normalizeManagedCharacterCatalog(managedCharacters);
  const expectedUserIdsByCharacterId = buildHistoricalManagedCharacterUserIds({ managedCharacters, profiles, submissions });
  const normalizedGuildRoles = normalizeGuildRoleCandidates(guildRoles);
  const analyses = [];

  for (const entry of managedCatalog) {
    const expectedUserIds = new Set(Array.isArray(expectedUserIdsByCharacterId[entry.id]) ? expectedUserIdsByCharacterId[entry.id] : []);
    const preferredRoleIds = [...new Set([
      cleanText(entry.roleId, 80),
      cleanText(historicalRoleIds?.[entry.id], 80),
      cleanText(generatedRoleIds?.[entry.id], 80),
    ].filter((roleId) => roleId && !isPlaceholderRoleId(roleId)))];

    const candidates = [];
    for (const role of normalizedGuildRoles) {
      const preferredMatch = preferredRoleIds.includes(role.id);
      const overlap = countSharedUserIds(role.memberUserIds, expectedUserIds);
      const exactName = cleanText(role.name, 120).toLowerCase() === cleanText(entry.label, 120).toLowerCase();
      if (!preferredMatch && !overlap && !exactName) continue;

      const evidenceCount = expectedUserIds.size;
      const holderCount = role.memberUserIds.length;
      const coverage = evidenceCount ? overlap / evidenceCount : 0;
      const roleShare = holderCount ? overlap / holderCount : 0;
      const score = (preferredMatch ? 1000000 : 0)
        + (overlap * 100)
        + Math.round(coverage * 10)
        + Math.round(roleShare * 10)
        + (exactName ? 5 : 0);

      candidates.push({
        roleId: role.id,
        roleName: role.name,
        overlap,
        evidenceCount,
        holderCount,
        coverage,
        roleShare,
        preferredMatch,
        exactName,
        score,
      });
    }

    candidates.sort(compareRecoveryCandidates);
    analyses.push({
      characterId: entry.id,
      configuredLabel: entry.label,
      evidenceCount: expectedUserIds.size,
      best: candidates[0] || null,
      second: candidates[1] || null,
      confident: isConfidentRecoveryCandidate(candidates[0] || null, candidates[1] || null),
    });
  }

  const recoveredRoleIds = {};
  const recoveredRoleLabels = {};
  const ambiguous = [];
  const unresolved = [];
  const usedRoleIds = new Set();

  for (const analysis of analyses.filter((entry) => entry.best).sort((left, right) => compareRecoveryCandidates(left.best, right.best))) {
    if (!analysis.confident) continue;
    if (usedRoleIds.has(analysis.best.roleId)) continue;

    recoveredRoleIds[analysis.characterId] = analysis.best.roleId;
    recoveredRoleLabels[analysis.characterId] = analysis.best.roleName;
    usedRoleIds.add(analysis.best.roleId);
  }

  for (const analysis of analyses) {
    if (recoveredRoleIds[analysis.characterId]) continue;

    if (analysis.best) {
      ambiguous.push({
        characterId: analysis.characterId,
        configuredLabel: analysis.configuredLabel,
        evidenceCount: analysis.evidenceCount,
        bestRoleId: analysis.best.roleId,
        bestRoleName: analysis.best.roleName,
        bestOverlap: analysis.best.overlap,
        secondRoleId: analysis.second?.roleId || "",
        secondRoleName: analysis.second?.roleName || "",
        secondOverlap: Number(analysis.second?.overlap || 0),
      });
      continue;
    }

    unresolved.push({
      characterId: analysis.characterId,
      configuredLabel: analysis.configuredLabel,
      evidenceCount: analysis.evidenceCount,
    });
  }

  return {
    recoveredRoleIds,
    recoveredRoleLabels,
    ambiguous,
    unresolved,
  };
}

function buildManagedCharacterEntries({ managedCharacters = [], historicalRoleIds = {}, generatedRoleIds = {} } = {}) {
  const historical = historicalRoleIds && typeof historicalRoleIds === "object" ? historicalRoleIds : {};
  const generated = generatedRoleIds && typeof generatedRoleIds === "object" ? generatedRoleIds : {};

  return normalizeManagedCharacterCatalog(managedCharacters).map((entry) => ({
    id: entry.id,
    label: entry.label,
    roleId: cleanText(entry.roleId, 80)
      || cleanText(historical?.[entry.id], 80)
      || cleanText(generated?.[entry.id], 80),
  }));
}

module.exports = {
  buildHistoricalManagedCharacterUserIds,
  buildHistoricalManagedCharacterRoleIds,
  buildManagedCharacterRoleRecoveryPlan,
  buildManagedCharacterEntries,
  normalizeManagedCharacterCatalog,
};