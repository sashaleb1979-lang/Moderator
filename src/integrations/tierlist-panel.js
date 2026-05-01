"use strict";

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function normalizePositiveNumber(value, fallback = 1) {
  if (value === null || value === undefined || value === "") return fallback;
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : fallback;
}

function getSortKey(value) {
  return Date.parse(String(value || "")) || 0;
}

function isFutureMoment(value, nowMs = Date.now()) {
  const targetMs = Date.parse(String(value || "")) || 0;
  return targetMs > nowMs;
}

function getDormantTierlistEntries(db = {}) {
  return Object.entries(db?.profiles || {})
    .map(([userId, profile]) => {
      const tierlist = profile?.domains?.tierlist || {};
      const mainId = cleanString(tierlist.mainId, 80) || null;
      const submittedAt = cleanString(tierlist.submittedAt, 80) || null;
      const lockUntil = cleanString(tierlist.lockUntil, 80) || null;
      const influenceRoleId = cleanString(tierlist.influenceRoleId, 40) || null;
      const influenceMultiplier = normalizePositiveNumber(tierlist.influenceMultiplier, 1);

      return {
        userId,
        displayName: cleanString(profile?.displayName, 200) || cleanString(profile?.username, 120) || `User ${userId}`,
        username: cleanString(profile?.username, 120) || null,
        mainId,
        mainName: cleanString(tierlist.mainName, 120) || null,
        submittedAt,
        lockUntil,
        influenceMultiplier,
        influenceRoleId,
        dashboardSyncedAt: cleanString(tierlist.dashboardSyncedAt, 80) || null,
        summarySyncedAt: cleanString(tierlist.summarySyncedAt, 80) || null,
      };
    })
    .filter((entry) => entry.mainId || entry.submittedAt || entry.influenceMultiplier !== 1 || entry.influenceRoleId);
}

function getDormantTierlistPanelSnapshot(db = {}) {
  const integrations = db?.config?.integrations?.tierlist || {};
  const entries = getDormantTierlistEntries(db)
    .sort((left, right) => {
      if (getSortKey(right.submittedAt) !== getSortKey(left.submittedAt)) {
        return getSortKey(right.submittedAt) - getSortKey(left.submittedAt);
      }
      if ((right.influenceMultiplier || 1) !== (left.influenceMultiplier || 1)) {
        return (right.influenceMultiplier || 1) - (left.influenceMultiplier || 1);
      }
      return String(left.displayName).localeCompare(String(right.displayName), "ru");
    });

  return {
    sourcePath: cleanString(integrations.sourcePath, 500),
    status: cleanString(integrations.status, 40) || "not_started",
    lastImportAt: cleanString(integrations.lastImportAt, 80) || null,
    lastSyncAt: cleanString(integrations.lastSyncAt, 80) || null,
    dashboard: {
      channelId: cleanString(integrations?.dashboard?.channelId, 40),
      messageId: cleanString(integrations?.dashboard?.messageId, 40),
      lastUpdated: cleanString(integrations?.dashboard?.lastUpdated, 80) || null,
    },
    summary: {
      channelId: cleanString(integrations?.summary?.channelId, 40),
      messageId: cleanString(integrations?.summary?.messageId, 40),
      lastUpdated: cleanString(integrations?.summary?.lastUpdated, 80) || null,
    },
    trackedProfiles: entries.length,
    submittedProfiles: entries.filter((entry) => Boolean(entry.submittedAt)).length,
    mainSelectedProfiles: entries.filter((entry) => Boolean(entry.mainId)).length,
    lockedProfiles: entries.filter((entry) => isFutureMoment(entry.lockUntil)).length,
    strongestInfluence: entries[0] || null,
  };
}

function getDormantTierlistProfileSnapshot(db = {}, userId = "") {
  const targetUserId = cleanString(userId, 80);
  if (!targetUserId) return null;
  return getDormantTierlistEntries(db).find((entry) => entry.userId === targetUserId) || null;
}

module.exports = {
  getDormantTierlistEntries,
  getDormantTierlistPanelSnapshot,
  getDormantTierlistProfileSnapshot,
};