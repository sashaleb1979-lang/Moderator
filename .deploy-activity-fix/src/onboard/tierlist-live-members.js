"use strict";

function normalizeId(value) {
  return String(value || "").trim();
}

function toNormalizedSet(values) {
  if (!values) return new Set();
  const normalized = [];
  for (const value of values) {
    const id = normalizeId(value);
    if (id) normalized.push(id);
  }
  return new Set(normalized);
}

function hasAnyAllowedRole(memberRoleIds = [], allowedRoleIds = []) {
  const allowedRoleIdSet = toNormalizedSet(allowedRoleIds);
  if (!allowedRoleIdSet.size) return true;
  const memberRoleIdSet = toNormalizedSet(memberRoleIds);
  for (const roleId of allowedRoleIdSet) {
    if (memberRoleIdSet.has(roleId)) return true;
  }
  return false;
}

function filterEntriesByAllowedUserIds(entries = [], allowedUserIds) {
  if (!(allowedUserIds instanceof Set)) {
    return Array.isArray(entries) ? [...entries] : [];
  }

  return (Array.isArray(entries) ? entries : []).filter((entry) => {
    const userId = normalizeId(entry?.userId);
    return userId && allowedUserIds.has(userId);
  });
}

module.exports = {
  filterEntriesByAllowedUserIds,
  hasAnyAllowedRole,
};