"use strict";

const {
  SUPPORT_PROGRESS_LEVELS,
} = require("../antiteam/support-progress");
const {
  buildDailyNewsProfileHistorySnapshot,
  getDailyNewsHistorySnapshot,
  shiftMoscowDayKey,
} = require("./history");

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function normalizeNonNegativeInteger(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : fallback;
}

function createAuditCandidateId(prefix, parts = []) {
  return [cleanString(prefix, 40) || "candidate", ...parts.map((part) => cleanString(part, 120) || "na")].join(":");
}

function resolveSupportLevel(pointsValue = 0) {
  const points = normalizeNonNegativeInteger(pointsValue, 0);
  return [...SUPPORT_PROGRESS_LEVELS]
    .reverse()
    .find((level) => points >= Number(level.threshold || 0)) || null;
}

function compareSupportUpgrades(left, right) {
  return (Number(right.toLevel?.level) || 0) - (Number(left.toLevel?.level) || 0)
    || (right.deltaPoints || 0) - (left.deltaPoints || 0)
    || String(left.displayName || "").localeCompare(String(right.displayName || ""), undefined, { sensitivity: "base" });
}

function collectAntiteamSupportDigest({ db = {}, window = {}, config = {} } = {}) {
  const dayKey = cleanString(window.dayKey, 40);
  const baselineDayKey = shiftMoscowDayKey(dayKey, -1);
  const previousSnapshot = getDailyNewsHistorySnapshot(db, baselineDayKey);
  if (!baselineDayKey || !previousSnapshot || !Object.keys(previousSnapshot).length) {
    return {
      available: false,
      reason: "no_antiteam_support_history_yet",
      baselineDayKey: baselineDayKey || null,
      upgrades: [],
      candidateBuckets: [],
      partial: false,
      partialReasons: [],
    };
  }

  const currentSnapshot = getDailyNewsHistorySnapshot(db, dayKey) || buildDailyNewsProfileHistorySnapshot({ db });
  const userIds = [...new Set([
    ...Object.keys(previousSnapshot),
    ...Object.keys(currentSnapshot || {}),
  ])];
  const upgrades = [];
  const candidateBuckets = [];

  for (const userId of userIds) {
    const previous = previousSnapshot?.[userId];
    const current = currentSnapshot?.[userId];
    const fromPoints = normalizeNonNegativeInteger(previous?.antiteamSupportPoints, null);
    const toPoints = normalizeNonNegativeInteger(current?.antiteamSupportPoints, null);
    if (fromPoints === null || toPoints === null || toPoints <= fromPoints) continue;

    const fromLevel = resolveSupportLevel(fromPoints);
    const toLevel = resolveSupportLevel(toPoints);
    if (!toLevel || Number(toLevel.level) <= Number(fromLevel?.level || 0)) continue;

    const entry = {
      userId,
      displayName: cleanString(current?.displayName, 120) || cleanString(previous?.displayName, 120) || userId,
      fromPoints,
      toPoints,
      deltaPoints: toPoints - fromPoints,
      fromLevel: fromLevel ? {
        level: fromLevel.level,
        label: fromLevel.label,
        threshold: fromLevel.threshold,
      } : null,
      toLevel: {
        level: toLevel.level,
        label: toLevel.label,
        threshold: toLevel.threshold,
      },
    };
    upgrades.push(entry);
    candidateBuckets.push({
      id: createAuditCandidateId("antiteam_support", [userId, baselineDayKey, dayKey]),
      module: "antiteam",
      bucket: "published_public",
      detail: "public_antiteam_support_rank_upgrade",
      sourceType: "daily_profile_history_snapshot",
      userId,
      displayName: entry.displayName,
      occurredAt: window.endAt || null,
    });
  }

  const topCount = Math.max(1, Number(config?.antiteam?.topCount) || 5);
  return {
    available: true,
    reason: null,
    baselineDayKey,
    upgrades: upgrades.sort(compareSupportUpgrades).slice(0, topCount),
    candidateBuckets,
    partial: false,
    partialReasons: [],
  };
}

module.exports = {
  collectAntiteamSupportDigest,
};
