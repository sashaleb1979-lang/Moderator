"use strict";

function normalizeUserId(value) {
  return String(value || "").trim();
}

function normalizeTier(value) {
  const tier = Number(value);
  if (!Number.isSafeInteger(tier) || tier < 1 || tier > 5) {
    return null;
  }
  return tier;
}

function getProfileEloTier(profile) {
  if (!profile || typeof profile !== "object") return null;
  return normalizeTier(profile?.domains?.elo?.currentTier);
}

function buildGlobalEloRoleSyncPlan(profiles = {}, options = {}) {
  const normalizedProfiles = profiles && typeof profiles === "object" ? profiles : {};
  const targetUserId = normalizeUserId(options.targetUserId);
  const explicitClearUserIds = Array.isArray(options.clearUserIds)
    ? options.clearUserIds.map(normalizeUserId).filter(Boolean)
    : [];
  const clearUserIds = new Set(explicitClearUserIds);
  const userIds = targetUserId
    ? [targetUserId]
    : Object.keys(normalizedProfiles).map(normalizeUserId).filter(Boolean);

  const assign = [];
  const clear = [];

  for (const userId of userIds) {
    const tier = getProfileEloTier(normalizedProfiles[userId]);
    if (tier) {
      assign.push({ userId, tier });
      clearUserIds.delete(userId);
      continue;
    }

    clear.push(userId);
    clearUserIds.delete(userId);
  }

  for (const userId of clearUserIds) {
    clear.push(userId);
  }

  return {
    assign,
    clear,
  };
}

module.exports = {
  buildGlobalEloRoleSyncPlan,
  getProfileEloTier,
};