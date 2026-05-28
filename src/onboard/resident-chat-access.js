"use strict";

const DEFAULT_RESIDENT_CHAT_ACTIVITY_ROLE_KEYS = Object.freeze(["core", "stable", "active"]);
const RESIDENT_CHAT_ACTIVITY_ROLE_KEYS = new Set(DEFAULT_RESIDENT_CHAT_ACTIVITY_ROLE_KEYS);

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

function normalizeResidentChatActivityRoleKeys(value, fallback = DEFAULT_RESIDENT_CHAT_ACTIVITY_ROLE_KEYS) {
  const source = Array.isArray(value) ? value : fallback;
  const normalized = [];
  const seen = new Set();
  for (const rawKey of source) {
    const key = cleanRoleKey(rawKey);
    if (!RESIDENT_CHAT_ACTIVITY_ROLE_KEYS.has(key) || seen.has(key)) continue;
    seen.add(key);
    normalized.push(key);
  }
  return normalized.length ? normalized : [...DEFAULT_RESIDENT_CHAT_ACTIVITY_ROLE_KEYS];
}

function resolveResidentChatAccessRoleState({
  enabled = false,
  residentRoleId = "",
  heldRoleIds = [],
  normalAccessRoleId = "",
  wartimeAccessRoleId = "",
  eligibleActivityRoleIds = [],
} = {}) {
  const normalizedResidentRoleId = cleanRoleId(residentRoleId);
  const heldRoleIdSet = normalizeRoleIdSet(heldRoleIds);
  const normalizedNormalAccessRoleId = cleanRoleId(normalAccessRoleId);
  const normalizedWartimeAccessRoleId = cleanRoleId(wartimeAccessRoleId);
  const eligibleActivityRoleIdSet = normalizeRoleIdSet(eligibleActivityRoleIds);
  const hasResidentRole = Boolean(normalizedResidentRoleId && heldRoleIdSet.has(normalizedResidentRoleId));
  const hasNormalAccessRole = Boolean(normalizedNormalAccessRoleId && heldRoleIdSet.has(normalizedNormalAccessRoleId));
  const hasWartimeAccessRole = Boolean(normalizedWartimeAccessRoleId && heldRoleIdSet.has(normalizedWartimeAccessRoleId));
  const hasEligibleActivityRole = [...eligibleActivityRoleIdSet].some((roleId) => heldRoleIdSet.has(roleId));
  const configured = Boolean(normalizedResidentRoleId);
  const active = enabled === true;
  const eligible = active
    && configured
    && hasNormalAccessRole
    && !hasWartimeAccessRole
    && hasEligibleActivityRole;
  let skipReason = "";
  if (!active) skipReason = "disabled";
  else if (!configured) skipReason = "resident_role_not_configured";
  else if (hasWartimeAccessRole) skipReason = "wartime_access";
  else if (!hasNormalAccessRole) skipReason = "no_normal_access";
  else if (!hasEligibleActivityRole) skipReason = "no_activity_role";
  else if (hasResidentRole) skipReason = "already_had";

  return {
    enabled: active,
    configured,
    residentRoleId: normalizedResidentRoleId,
    hasResidentRole,
    hasNormalAccessRole,
    hasWartimeAccessRole,
    hasEligibleActivityRole,
    eligible,
    skipReason,
    shouldGrant: eligible && !hasResidentRole,
    shouldRemove: configured && hasResidentRole && !eligible,
  };
}

module.exports = {
  DEFAULT_RESIDENT_CHAT_ACTIVITY_ROLE_KEYS,
  normalizeResidentChatActivityRoleKeys,
  resolveResidentChatAccessRoleState,
};
