"use strict";

function cleanRoleId(value) {
  return String(value || "").trim();
}

function normalizeRoleIdSet(value) {
  if (value instanceof Set) {
    return new Set([...value].map((entry) => cleanRoleId(entry)).filter(Boolean));
  }
  if (Array.isArray(value)) {
    return new Set(value.map((entry) => cleanRoleId(entry)).filter(Boolean));
  }
  return new Set();
}

function collectAccessCompanionSourceRoleIds({
  normalAccessRoleId = "",
  wartimeAccessRoleId = "",
  nonJjsAccessRoleId = "",
} = {}) {
  return [...new Set([
    cleanRoleId(normalAccessRoleId),
    cleanRoleId(wartimeAccessRoleId),
    cleanRoleId(nonJjsAccessRoleId),
  ].filter(Boolean))];
}

function hasAnyAccessCompanionSourceRole({ heldRoleIds = [], sourceRoleIds = [] } = {}) {
  const heldRoleIdSet = normalizeRoleIdSet(heldRoleIds);
  if (!heldRoleIdSet.size) return false;

  for (const roleId of normalizeRoleIdSet(sourceRoleIds)) {
    if (heldRoleIdSet.has(roleId)) return true;
  }
  return false;
}

function shouldGrantAccessCompanionRole({
  companionRoleId = "",
  heldRoleIds = [],
  sourceRoleIds = [],
} = {}) {
  const normalizedCompanionRoleId = cleanRoleId(companionRoleId);
  if (!normalizedCompanionRoleId) return false;

  const heldRoleIdSet = normalizeRoleIdSet(heldRoleIds);
  if (heldRoleIdSet.has(normalizedCompanionRoleId)) return false;

  return hasAnyAccessCompanionSourceRole({
    heldRoleIds: heldRoleIdSet,
    sourceRoleIds,
  });
}

function collectAccessCompanionCandidateUserIds({
  sourceRoleMemberIds = [],
  cachedMemberIds = [],
  profileUserIds = [],
} = {}) {
  return [
    ...new Set([
      ...normalizeRoleIdSet(sourceRoleMemberIds),
      ...normalizeRoleIdSet(cachedMemberIds),
      ...normalizeRoleIdSet(profileUserIds),
    ]),
  ];
}

module.exports = {
  cleanRoleId,
  collectAccessCompanionCandidateUserIds,
  collectAccessCompanionSourceRoleIds,
  hasAnyAccessCompanionSourceRole,
  normalizeRoleIdSet,
  shouldGrantAccessCompanionRole,
};