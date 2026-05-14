"use strict";

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function normalizeRoleIds(value) {
  const source = Array.isArray(value) ? value : [value];
  return [...new Set(source.map((entry) => cleanString(entry, 80)).filter(Boolean))];
}

async function applyActivityRoleChangesForMember(member, {
  addRoleIds = [],
  removeRoleIds = [],
  reason = "activity role sync",
} = {}) {
  if (!member?.roles?.remove || !member?.roles?.add) return false;

  const normalizedReason = cleanString(reason, 300) || "activity role sync";
  const normalizedRemoveRoleIds = normalizeRoleIds(removeRoleIds);
  const normalizedAddRoleIds = normalizeRoleIds(addRoleIds);

  try {
    for (const roleId of normalizedRemoveRoleIds) {
      await member.roles.remove(roleId, normalizedReason);
    }

    for (const roleId of normalizedAddRoleIds) {
      await member.roles.add(roleId, normalizedReason);
    }

    return true;
  } catch {
    return false;
  }
}

module.exports = {
  applyActivityRoleChangesForMember,
};