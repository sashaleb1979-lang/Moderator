"use strict";
const {
  buildDailyNewsProfileHistorySnapshot,
  getDailyNewsHistorySnapshot,
  shiftMoscowDayKey,
} = require("./history");

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function parseIsoMs(value) {
  const timeMs = Date.parse(String(value || ""));
  return Number.isFinite(timeMs) ? timeMs : null;
}

function normalizeNonNegativeNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : fallback;
}

function toIsoString(timeMs) {
  return Number.isFinite(timeMs) ? new Date(timeMs).toISOString() : null;
}

function compareText(left = "", right = "") {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

function uniqueStrings(items = [], limit = 120) {
  const result = [];
  const seen = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    const normalized = cleanString(item, limit);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function createAuditCandidateId(prefix, parts = []) {
  return [cleanString(prefix, 40) || "candidate", ...parts.map((part) => cleanString(part, 120) || "na")].join(":");
}

function resolveProfileDisplayName(profiles = {}, userId = "") {
  const profile = profiles && typeof profiles === "object" && !Array.isArray(profiles)
    ? profiles[cleanString(userId, 80)]
    : null;
  return cleanString(
    profile?.summary?.preferredDisplayName
      || profile?.displayName
      || profile?.username
      || userId,
    120
  ) || "unknown";
}

function resolveRowWindowMs(row = {}) {
  const firstMs = parseIsoMs(row.firstMessageAt);
  const lastMs = parseIsoMs(row.lastMessageAt);
  if (firstMs !== null || lastMs !== null) {
    const startMs = firstMs ?? lastMs;
    const endMs = lastMs ?? firstMs;
    return { startMs, endMs, precise: true };
  }

  const dateKey = cleanString(row.date, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return { startMs: null, endMs: null, precise: false };
  }

  const startMs = Date.parse(`${dateKey}T00:00:00.000Z`);
  return Number.isFinite(startMs)
    ? { startMs, endMs: startMs + 24 * 60 * 60 * 1000, precise: false }
    : { startMs: null, endMs: null, precise: false };
}

function overlapsWindow(rowWindow = {}, window = {}) {
  if (!Number.isFinite(rowWindow.startMs) || !Number.isFinite(rowWindow.endMs)) return false;
  return rowWindow.startMs <= window.endMs && rowWindow.endMs >= window.startMs;
}

function compareMessageLeaders(left, right) {
  return right.messagesCount - left.messagesCount
    || right.weightedMessagesCount - left.weightedMessagesCount
    || compareText(left.displayName, right.displayName);
}

function compareActivityMovers(left, right) {
  return Math.abs(right.delta) - Math.abs(left.delta)
    || right.toScore - left.toScore
    || compareText(left.displayName, right.displayName);
}

function collectActivityMovers({ db = {}, window = {}, config = {} } = {}) {
  const dayKey = cleanString(window.dayKey, 40);
  const baselineDayKey = shiftMoscowDayKey(dayKey, -1);
  const previousSnapshot = getDailyNewsHistorySnapshot(db, baselineDayKey);
  if (!baselineDayKey || !previousSnapshot || !Object.keys(previousSnapshot).length) {
    return {
      available: false,
      reason: "no_daily_activity_baseline_yet",
      baselineDayKey: baselineDayKey || null,
      comparedUserCount: 0,
      changedUserCount: 0,
      up: [],
      down: [],
    };
  }

  const currentSnapshot = getDailyNewsHistorySnapshot(db, dayKey) || buildDailyNewsProfileHistorySnapshot({ db });
  const userIds = uniqueStrings([
    ...Object.keys(previousSnapshot),
    ...Object.keys(currentSnapshot || {}),
  ], 80);
  const movers = [];
  let comparedUserCount = 0;

  for (const userId of userIds) {
    const previous = previousSnapshot?.[userId];
    const current = currentSnapshot?.[userId];
    const previousScore = Number(previous?.activityScore);
    const currentScore = Number(current?.activityScore);
    if (!Number.isFinite(previousScore) || !Number.isFinite(currentScore)) continue;

    comparedUserCount += 1;
    const delta = currentScore - previousScore;
    if (delta === 0) continue;
    const previousRoleKey = cleanString(previous?.appliedActivityRoleKey, 80) || null;
    const currentRoleKey = cleanString(current?.appliedActivityRoleKey, 80) || null;
    movers.push({
      userId,
      displayName: cleanString(current?.displayName, 120) || cleanString(previous?.displayName, 120) || userId,
      delta,
      fromScore: previousScore,
      toScore: currentScore,
      fromAppliedRoleKey: previousRoleKey,
      toAppliedRoleKey: currentRoleKey,
      roleChanged: previousRoleKey !== currentRoleKey,
    });
  }

  const topMoversCount = Math.max(1, Number(config?.activity?.topMoversCount) || 3);
  const rising = movers.filter((entry) => entry.delta > 0).sort(compareActivityMovers).slice(0, topMoversCount);
  const falling = movers.filter((entry) => entry.delta < 0).sort(compareActivityMovers).slice(0, topMoversCount);

  return {
    available: true,
    reason: null,
    baselineDayKey,
    comparedUserCount,
    changedUserCount: movers.length,
    up: rising,
    down: falling,
  };
}

function collectActivityDigest({ db = {}, window = {}, config = {} } = {}) {
  const profiles = db.profiles && typeof db.profiles === "object" && !Array.isArray(db.profiles) ? db.profiles : {};
  const activityState = db.sot?.activity && typeof db.sot.activity === "object" && !Array.isArray(db.sot.activity)
    ? db.sot.activity
    : {};
  const rows = Array.isArray(activityState.userChannelDailyStats) ? activityState.userChannelDailyStats : [];
  const aggregateByUser = new Map();
  const rowCandidates = [];
  let impreciseRowCount = 0;

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const rowWindow = resolveRowWindowMs(row);
    if (!overlapsWindow(rowWindow, window)) continue;

    const userId = cleanString(row.userId, 80);
    const displayName = resolveProfileDisplayName(profiles, userId);
    const messagesCount = normalizeNonNegativeNumber(row.messagesCount ?? row.messageCount, 0);
    const weightedMessagesCount = normalizeNonNegativeNumber(row.weightedMessagesCount ?? row.weightedMessageCount, 0);
    const sessionsCount = normalizeNonNegativeNumber(row.sessionsCount, 0);
    const effectiveSessionsCount = normalizeNonNegativeNumber(row.effectiveSessionsCount, 0);
    const candidate = {
      guildId: cleanString(row.guildId, 80),
      channelId: cleanString(row.channelId, 80),
      userId,
      displayName,
      date: cleanString(row.date, 20),
      messagesCount,
      weightedMessagesCount,
      sessionsCount,
      effectiveSessionsCount,
      firstMessageAt: toIsoString(rowWindow.startMs),
      lastMessageAt: toIsoString(rowWindow.endMs),
      preciseWindow: rowWindow.precise,
    };

    if (!candidate.preciseWindow) impreciseRowCount += 1;
    rowCandidates.push(candidate);

    if (!userId) continue;
    const existing = aggregateByUser.get(userId) || {
      userId,
      displayName,
      messagesCount: 0,
      weightedMessagesCount: 0,
      sessionsCount: 0,
      effectiveSessionsCount: 0,
      channelIds: [],
      firstMessageAt: null,
      lastMessageAt: null,
      hasImpreciseRows: false,
    };

    existing.messagesCount += messagesCount;
    existing.weightedMessagesCount += weightedMessagesCount;
    existing.sessionsCount += sessionsCount;
    existing.effectiveSessionsCount += effectiveSessionsCount;
    existing.channelIds = uniqueStrings([...existing.channelIds, candidate.channelId], 80);
    if (candidate.firstMessageAt && (!existing.firstMessageAt || candidate.firstMessageAt < existing.firstMessageAt)) {
      existing.firstMessageAt = candidate.firstMessageAt;
    }
    if (candidate.lastMessageAt && (!existing.lastMessageAt || candidate.lastMessageAt > existing.lastMessageAt)) {
      existing.lastMessageAt = candidate.lastMessageAt;
      existing.displayName = displayName || existing.displayName;
    }
    if (!candidate.preciseWindow) {
      existing.hasImpreciseRows = true;
    }
    aggregateByUser.set(userId, existing);
  }

  const authors = [...aggregateByUser.values()]
    .filter((entry) => entry.messagesCount > 0 || entry.sessionsCount > 0)
    .sort(compareMessageLeaders)
    .map((entry) => ({
      ...entry,
      weightedMessagesCount: Number(entry.weightedMessagesCount.toFixed(2)),
      effectiveSessionsCount: Number(entry.effectiveSessionsCount.toFixed(2)),
    }));
  const publicAuthors = authors.filter((entry) => entry.hasImpreciseRows !== true);
  const topCount = Math.max(1, Number(config?.activity?.topMessagesCount) || 5);
  const topMessageAuthors = publicAuthors.slice(0, topCount);
  const publicUserIds = new Set(topMessageAuthors.map((entry) => entry.userId));

  const candidateBuckets = rowCandidates.map((candidate) => {
    let bucket = "suppressed_by_threshold";
    let detail = "not_in_public_message_top";

    if (!candidate.userId || candidate.messagesCount <= 0) {
      bucket = "invalid_source";
      detail = "invalid_activity_daily_row";
    } else if (!candidate.preciseWindow) {
      bucket = "ambiguous_source";
      detail = "activity_daily_row_without_precise_timestamp";
    } else if (publicUserIds.has(candidate.userId)) {
      bucket = "published_public";
      detail = "public_top_message_author";
    }

    return {
      id: createAuditCandidateId("activity", [candidate.userId, candidate.channelId, candidate.date]),
      module: "activity",
      bucket,
      detail,
      sourceType: "user_channel_daily_stat",
      userId: candidate.userId,
      displayName: candidate.displayName,
      occurredAt: candidate.lastMessageAt || candidate.firstMessageAt,
    };
  });

  const partialReasons = impreciseRowCount > 0 ? ["activity_rows_without_precise_timestamps"] : [];
  const movers = collectActivityMovers({ db, window, config });
  return {
    sourceRowCount: rowCandidates.length,
    activeUserCount: authors.length,
    totalMessagesCount: authors.reduce((sum, entry) => sum + entry.messagesCount, 0),
    totalWeightedMessagesCount: Number(authors.reduce((sum, entry) => sum + entry.weightedMessagesCount, 0).toFixed(2)),
    topMessageAuthors,
    allMessageAuthors: authors,
    movers,
    impreciseRowCount,
    partial: partialReasons.length > 0,
    partialReasons,
    candidateBuckets,
  };
}

module.exports = {
  collectActivityDigest,
};
