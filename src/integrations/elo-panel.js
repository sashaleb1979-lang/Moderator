"use strict";

const { resolveIntegrationRecord } = require("../sot/resolver/integrations");

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function normalizeNullableInteger(value, options = {}) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) return null;
  if (Number.isFinite(options.min) && amount < options.min) return null;
  if (Number.isFinite(options.max) && amount > options.max) return null;
  return amount;
}

function getEloSortKey(value) {
  return Date.parse(String(value || "")) || 0;
}

function getDormantEloEntries(db = {}) {
  return Object.entries(db?.profiles || {})
    .map(([userId, profile]) => {
      const elo = profile?.domains?.elo || {};
      const currentElo = normalizeNullableInteger(elo.currentElo, { min: 0 });
      const currentTier = normalizeNullableInteger(elo.currentTier, { min: 1, max: 5 });
      const lastSubmissionStatus = cleanString(elo.lastSubmissionStatus, 40) || null;

      return {
        userId,
        displayName: cleanString(profile?.displayName, 200) || cleanString(profile?.username, 120) || `User ${userId}`,
        username: cleanString(profile?.username, 120) || null,
        currentElo,
        currentTier,
        proofUrl: cleanString(elo.proofUrl, 1000) || null,
        updatedAt: cleanString(elo.updatedAt, 80) || null,
        lastSubmissionId: cleanString(elo.lastSubmissionId, 80) || null,
        lastSubmissionStatus,
        lastSubmissionCreatedAt: cleanString(elo.lastSubmissionCreatedAt, 80) || null,
        lastSubmissionElo: normalizeNullableInteger(elo.lastSubmissionElo, { min: 0 }),
        lastSubmissionTier: normalizeNullableInteger(elo.lastSubmissionTier, { min: 1, max: 5 }),
        lastReviewedAt: cleanString(elo.lastReviewedAt, 80) || null,
        reviewChannelId: cleanString(elo.reviewChannelId, 40) || null,
        reviewMessageId: cleanString(elo.reviewMessageId, 40) || null,
      };
    })
    .filter((entry) => entry.currentElo !== null || entry.lastSubmissionStatus);
}

function getDormantEloPanelSnapshot(db = {}, options = {}) {
  const integrations = resolveIntegrationRecord({
    slot: "elo",
    db,
    appConfig: options.appConfig || {},
  });
  const entries = getDormantEloEntries(db)
    .filter((entry) => entry.currentElo !== null || entry.lastSubmissionStatus)
    .sort((left, right) => {
      if ((right.currentElo || -1) !== (left.currentElo || -1)) return (right.currentElo || -1) - (left.currentElo || -1);
      return String(left.displayName).localeCompare(String(right.displayName), "ru");
    });

  return {
    sourcePath: cleanString(integrations.sourcePath, 500),
    status: cleanString(integrations.status, 40) || "not_started",
    lastImportAt: cleanString(integrations.lastImportAt, 80) || null,
    lastSyncAt: cleanString(integrations.lastSyncAt, 80) || null,
    submitPanel: {
      channelId: cleanString(integrations?.submitPanel?.channelId, 40),
      messageId: cleanString(integrations?.submitPanel?.messageId, 40),
    },
    graphicBoard: {
      channelId: cleanString(integrations?.graphicBoard?.channelId, 40),
      messageId: cleanString(integrations?.graphicBoard?.messageId, 40),
      lastUpdated: cleanString(integrations?.graphicBoard?.lastUpdated, 80) || null,
    },
    trackedProfiles: entries.length,
    ratedProfiles: entries.filter((entry) => entry.currentElo !== null).length,
    pendingProfiles: entries.filter((entry) => entry.lastSubmissionStatus === "pending").length,
    topEntry: entries.find((entry) => entry.currentElo !== null) || null,
  };
}

function getDormantEloProfileSnapshot(db = {}, userId = "") {
  const targetUserId = cleanString(userId, 80);
  if (!targetUserId) return null;
  return getDormantEloEntries(db).find((entry) => entry.userId === targetUserId) || null;
}

function getDormantEloPendingEntries(db = {}, limit = 10) {
  return getDormantEloEntries(db)
    .filter((entry) => entry.lastSubmissionStatus === "pending")
    .sort((left, right) => {
      if (getEloSortKey(right.lastSubmissionCreatedAt) !== getEloSortKey(left.lastSubmissionCreatedAt)) {
        return getEloSortKey(right.lastSubmissionCreatedAt) - getEloSortKey(left.lastSubmissionCreatedAt);
      }
      return String(left.displayName).localeCompare(String(right.displayName), "ru");
    })
    .slice(0, Math.max(0, Number(limit) || 0));
}

module.exports = {
  getDormantEloEntries,
  getDormantEloPanelSnapshot,
  getDormantEloPendingEntries,
  getDormantEloProfileSnapshot,
};