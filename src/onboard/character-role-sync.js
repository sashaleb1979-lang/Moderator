"use strict";

function cleanString(value, limit = 200) {
  return String(value || "").trim().slice(0, limit);
}

function normalizeRoleIds(value) {
  const values = Array.isArray(value) ? value : (value instanceof Set ? [...value] : []);
  return [...new Set(values.map((entry) => cleanString(entry, 80)).filter(Boolean))];
}

function describeRoleSyncFailures(failures = []) {
  return failures
    .map((failure) => {
      const operation = failure?.op === "remove" ? "remove" : "add";
      const roleId = cleanString(failure?.roleId, 80) || "unknown-role";
      const message = cleanString(failure?.error, 240);
      return message ? `${operation}:${roleId} (${message})` : `${operation}:${roleId}`;
    })
    .join("; ");
}

class RoleSyncError extends Error {
  constructor(failures = [], options = {}) {
    const normalizedFailures = Array.isArray(failures) ? failures : [];
    const summary = describeRoleSyncFailures(normalizedFailures);
    super(summary ? `Character role sync failed: ${summary}` : "Character role sync failed.");
    this.name = "RoleSyncError";
    this.failures = normalizedFailures;
    this.userId = cleanString(options.userId, 80) || null;
  }
}

async function syncMemberCharacterRoles({ member, selectedEntries = [], allManagedRoleIds = [], reason = "main character sync" } = {}) {
  const roleManager = member?.roles;
  const roleCache = roleManager?.cache;
  if (!roleManager || !roleCache || typeof roleManager.add !== "function" || typeof roleManager.remove !== "function") {
    throw new Error("Character role manager is unavailable.");
  }

  const selectedRoleIds = new Set(normalizeRoleIds(selectedEntries.map((entry) => entry?.roleId)));
  const managedRoleIds = normalizeRoleIds(allManagedRoleIds);
  const failures = [];

  for (const roleId of managedRoleIds) {
    if (!roleCache.has(roleId) || selectedRoleIds.has(roleId)) continue;
    try {
      await roleManager.remove(roleId, reason);
    } catch (error) {
      failures.push({
        op: "remove",
        roleId,
        error: cleanString(error?.message || error, 240) || "unknown role removal error",
      });
    }
  }

  for (const roleId of selectedRoleIds) {
    if (roleCache.has(roleId)) continue;
    try {
      await roleManager.add(roleId, reason);
    } catch (error) {
      failures.push({
        op: "add",
        roleId,
        error: cleanString(error?.message || error, 240) || "unknown role add error",
      });
    }
  }

  if (failures.length) {
    throw new RoleSyncError(failures, { userId: member?.id });
  }

  return selectedEntries;
}

module.exports = {
  describeRoleSyncFailures,
  RoleSyncError,
  syncMemberCharacterRoles,
};