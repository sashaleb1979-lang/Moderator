"use strict";

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function normalizeRoleIds(value) {
  const source = Array.isArray(value) ? value : [value];
  return [...new Set(source.map((entry) => cleanString(entry, 80)).filter(Boolean))];
}

function listCurrentMemberRoleIds(member, roleManager) {
  const cache = roleManager?.cache;
  if (!cache) return null;
  if (typeof cache.keys === "function") {
    return normalizeRoleIds([...cache.keys()]);
  }
  if (cache instanceof Set) {
    return normalizeRoleIds([...cache]);
  }
  if (Array.isArray(cache)) {
    return normalizeRoleIds(cache);
  }
  return null;
}

function buildNextRoleIds(currentRoleIds, {
  addRoleIds = [],
  removeRoleIds = [],
  protectedRoleIds = [],
} = {}) {
  const nextRoleIdSet = new Set(normalizeRoleIds(currentRoleIds));
  const protectedRoleIdSet = new Set(normalizeRoleIds(protectedRoleIds));

  for (const roleId of normalizeRoleIds(removeRoleIds)) {
    if (protectedRoleIdSet.has(roleId)) continue;
    nextRoleIdSet.delete(roleId);
  }

  for (const roleId of normalizeRoleIds(addRoleIds)) {
    if (protectedRoleIdSet.has(roleId)) continue;
    nextRoleIdSet.add(roleId);
  }

  for (const roleId of protectedRoleIdSet) {
    nextRoleIdSet.delete(roleId);
  }

  return [...nextRoleIdSet];
}

async function applyActivityRoleChangesForMember(member, {
  addRoleIds = [],
  removeRoleIds = [],
  reason = "activity role sync",
} = {}) {
  const roleManager = member?.roles;
  if (!roleManager?.remove || !roleManager?.add) return false;

  const normalizedReason = cleanString(reason, 300) || "activity role sync";
  const normalizedRemoveRoleIds = normalizeRoleIds(removeRoleIds);
  const normalizedAddRoleIds = normalizeRoleIds(addRoleIds);

  try {
    const currentRoleIds = listCurrentMemberRoleIds(member, roleManager);
    const protectedRoleId = cleanString(member?.guild?.id || roleManager?.guild?.id, 80);
    if (typeof roleManager.set === "function" && currentRoleIds) {
      const nextRoleIds = buildNextRoleIds(currentRoleIds, {
        addRoleIds: normalizedAddRoleIds,
        removeRoleIds: normalizedRemoveRoleIds,
        protectedRoleIds: protectedRoleId ? [protectedRoleId] : [],
      });
      await roleManager.set(nextRoleIds, normalizedReason);
      return true;
    }

    for (const roleId of normalizedRemoveRoleIds) {
      await roleManager.remove(roleId, normalizedReason);
    }

    for (const roleId of normalizedAddRoleIds) {
      await roleManager.add(roleId, normalizedReason);
    }

    return true;
  } catch {
    return false;
  }
}

module.exports = {
  applyActivityRoleChangesForMember,
  buildNextRoleIds,
};