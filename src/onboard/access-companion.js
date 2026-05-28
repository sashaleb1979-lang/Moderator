"use strict";

const DEFAULT_ACCESS_COMPANION_ACTIVITY_ROLE_KEYS = Object.freeze(["core", "stable", "active"]);
const ACCESS_COMPANION_ACTIVITY_ROLE_KEYS = new Set([
  "core",
  "stable",
  "active",
]);

function cleanRoleId(value) {
  return String(value || "").trim();
}

function cleanRoleKey(value) {
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
} = {}) {
  return [...new Set([
    cleanRoleId(normalAccessRoleId),
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

function normalizeAccessCompanionActivityRoleKeys(value, fallback = DEFAULT_ACCESS_COMPANION_ACTIVITY_ROLE_KEYS) {
  const source = Array.isArray(value) ? value : fallback;
  const normalized = [];
  const seen = new Set();
  for (const rawKey of source) {
    const key = cleanRoleKey(rawKey);
    if (!ACCESS_COMPANION_ACTIVITY_ROLE_KEYS.has(key) || seen.has(key)) continue;
    seen.add(key);
    normalized.push(key);
  }
  return normalized.length ? normalized : [...DEFAULT_ACCESS_COMPANION_ACTIVITY_ROLE_KEYS];
}

function resolveAccessCompanionRoleState({
  enabled = false,
  companionRoleId = "",
  heldRoleIds = [],
  normalAccessRoleId = "",
  wartimeAccessRoleId = "",
  eligibleActivityRoleIds = [],
} = {}) {
  const normalizedCompanionRoleId = cleanRoleId(companionRoleId);
  const heldRoleIdSet = normalizeRoleIdSet(heldRoleIds);
  const normalizedNormalAccessRoleId = cleanRoleId(normalAccessRoleId);
  const normalizedWartimeAccessRoleId = cleanRoleId(wartimeAccessRoleId);
  const eligibleActivityRoleIdSet = normalizeRoleIdSet(eligibleActivityRoleIds);
  const hasCompanionRole = Boolean(normalizedCompanionRoleId && heldRoleIdSet.has(normalizedCompanionRoleId));
  const hasNormalAccessRole = Boolean(normalizedNormalAccessRoleId && heldRoleIdSet.has(normalizedNormalAccessRoleId));
  const hasWartimeAccessRole = Boolean(normalizedWartimeAccessRoleId && heldRoleIdSet.has(normalizedWartimeAccessRoleId));
  const hasEligibleActivityRole = [...eligibleActivityRoleIdSet].some((roleId) => heldRoleIdSet.has(roleId));
  const configured = Boolean(normalizedCompanionRoleId);
  const active = enabled === true;
  const eligible = active
    && configured
    && hasNormalAccessRole
    && !hasWartimeAccessRole
    && hasEligibleActivityRole;
  let skipReason = "";
  if (!active) skipReason = "disabled";
  else if (!configured) skipReason = "companion_not_configured";
  else if (hasWartimeAccessRole) skipReason = "wartime_access";
  else if (!hasNormalAccessRole) skipReason = "no_normal_access";
  else if (!hasEligibleActivityRole) skipReason = "no_activity_role";
  else if (hasCompanionRole) skipReason = "already_had";

  return {
    enabled: active,
    configured,
    companionRoleId: normalizedCompanionRoleId,
    hasCompanionRole,
    hasNormalAccessRole,
    hasWartimeAccessRole,
    hasEligibleActivityRole,
    eligible,
    skipReason,
    shouldGrant: eligible && !hasCompanionRole,
    shouldRemove: configured && hasCompanionRole && !eligible,
  };
}

function shouldGrantAccessCompanionRole(options = {}) {
  return resolveAccessCompanionRoleState(options).shouldGrant;
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
  DEFAULT_ACCESS_COMPANION_ACTIVITY_ROLE_KEYS,
  cleanRoleId,
  collectAccessCompanionCandidateUserIds,
  collectAccessCompanionSourceRoleIds,
  hasAnyAccessCompanionSourceRole,
  normalizeAccessCompanionActivityRoleKeys,
  normalizeRoleIdSet,
  resolveAccessCompanionRoleState,
  shouldGrantAccessCompanionRole,
};
