"use strict";

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function parseIsoMs(value) {
  const timeMs = Date.parse(String(value || ""));
  return Number.isFinite(timeMs) ? timeMs : null;
}

function toIsoString(timeMs) {
  return Number.isFinite(timeMs) ? new Date(timeMs).toISOString() : null;
}

function normalizeNonNegativeNumber(value, fallback = 0) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : fallback;
}

function createAuditCandidateId(prefix, parts = []) {
  return [cleanString(prefix, 40) || "candidate", ...parts.map((part) => cleanString(part, 120) || "na")].join(":");
}

function calculateOverlapMinutes(startMs, endMs, window = {}) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0;
  const overlapStartMs = Math.max(startMs, window.startMs);
  const overlapEndMs = Math.min(endMs, window.endMs);
  if (overlapEndMs <= overlapStartMs) return 0;
  return Math.max(0, Math.round((overlapEndMs - overlapStartMs) / 60000));
}

function compareLeaders(left, right) {
  return right.minutes - left.minutes
    || String(left.displayName || "").localeCompare(String(right.displayName || ""), undefined, { sensitivity: "base" });
}

function resolveDisplayName(profile = {}, userId = "") {
  return cleanString(
    profile?.summary?.preferredDisplayName
      || profile?.displayName
      || profile?.username
      || profile?.summary?.roblox?.currentUsername
      || profile?.domains?.roblox?.username
      || userId,
    120
  ) || "unknown";
}

function resolveRobloxPlaytime(profile = {}) {
  const summaryRoblox = profile?.summary?.roblox && typeof profile.summary.roblox === "object" ? profile.summary.roblox : {};
  const domainRoblox = profile?.domains?.roblox && typeof profile.domains.roblox === "object" ? profile.domains.roblox : {};
  return domainRoblox.playtime && typeof domainRoblox.playtime === "object"
    ? domainRoblox.playtime
    : summaryRoblox;
}

function collectSessionMinutes(playtime = {}, window = {}) {
  const sessionHistory = Array.isArray(playtime.sessionHistory) ? playtime.sessionHistory : [];
  let minutes = 0;
  let sessionCount = 0;
  for (const session of sessionHistory) {
    const startMs = parseIsoMs(session?.startedAt);
    const endMs = parseIsoMs(session?.endedAt);
    const overlapMinutes = calculateOverlapMinutes(startMs, endMs, window);
    if (overlapMinutes <= 0) continue;
    minutes += overlapMinutes;
    sessionCount += 1;
  }
  return { minutes, sessionCount };
}

function collectHourlyMinutes(playtime = {}, window = {}) {
  const hourlyBuckets = playtime.hourlyBucketsMsk && typeof playtime.hourlyBucketsMsk === "object" && !Array.isArray(playtime.hourlyBucketsMsk)
    ? playtime.hourlyBucketsMsk
    : {};
  let minutes = 0;
  let bucketCount = 0;
  for (const [bucketKey, rawMinutes] of Object.entries(hourlyBuckets)) {
    const normalizedBucketKey = cleanString(bucketKey, 32);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(normalizedBucketKey)) continue;
    const bucketStartMs = Date.parse(`${normalizedBucketKey}:00:00+03:00`);
    const bucketEndMs = bucketStartMs + 60 * 60 * 1000;
    if (calculateOverlapMinutes(bucketStartMs, bucketEndMs, window) <= 0) continue;
    const bucketMinutes = normalizeNonNegativeNumber(rawMinutes, 0);
    if (bucketMinutes <= 0) continue;
    minutes += Math.min(60, Math.round(bucketMinutes));
    bucketCount += 1;
  }
  return { minutes, bucketCount };
}

function collectDailyMinutes(playtime = {}, dayKey = "") {
  const dailyBuckets = playtime.dailyBuckets && typeof playtime.dailyBuckets === "object" && !Array.isArray(playtime.dailyBuckets)
    ? playtime.dailyBuckets
    : {};
  const minutes = normalizeNonNegativeNumber(dailyBuckets[cleanString(dayKey, 20)], 0);
  return { minutes: Math.round(minutes), bucketCount: minutes > 0 ? 1 : 0 };
}

function collectGameplayDigest({ db = {}, window = {}, config = {} } = {}) {
  const profiles = db.profiles && typeof db.profiles === "object" && !Array.isArray(db.profiles) ? db.profiles : {};
  const topCount = Math.max(1, Number(config?.gameplay?.topCount) || 5);
  const preciseLeaders = [];
  const staffItems = [];
  const candidateBuckets = [];
  let ambiguousDailyBucketCount = 0;

  for (const [rawUserId, profile] of Object.entries(profiles)) {
    if (!profile || typeof profile !== "object") continue;
    const userId = cleanString(profile.userId || rawUserId, 80);
    if (!userId) continue;
    const displayName = resolveDisplayName(profile, userId);
    const playtime = resolveRobloxPlaytime(profile);
    const session = collectSessionMinutes(playtime, window);
    const hourly = session.minutes > 0 ? { minutes: 0, bucketCount: 0 } : collectHourlyMinutes(playtime, window);
    const daily = session.minutes > 0 || hourly.minutes > 0 ? { minutes: 0, bucketCount: 0 } : collectDailyMinutes(playtime, window.dayKey);
    const preciseMinutes = session.minutes || hourly.minutes;
    const sourceType = session.minutes > 0 ? "roblox_session_history" : hourly.minutes > 0 ? "roblox_hourly_buckets_msk" : daily.minutes > 0 ? "roblox_daily_bucket" : "";
    if (!preciseMinutes && !daily.minutes) continue;

    const item = {
      userId,
      displayName,
      minutes: preciseMinutes || daily.minutes,
      hours: Math.round(((preciseMinutes || daily.minutes) / 60) * 10) / 10,
      sessionCount: session.sessionCount,
      bucketCount: session.minutes > 0 ? session.sessionCount : hourly.bucketCount || daily.bucketCount,
      sourceType,
      preciseWindow: preciseMinutes > 0,
      lastSeenInJjsAt: cleanString(playtime.lastSeenInJjsAt || profile?.summary?.roblox?.lastSeenInJjsAt, 80) || null,
    };
    staffItems.push(item);
    if (item.preciseWindow) preciseLeaders.push(item);
    if (!item.preciseWindow) ambiguousDailyBucketCount += 1;

    const bucket = item.preciseWindow ? "published_public" : "ambiguous_source";
    candidateBuckets.push({
      id: createAuditCandidateId("gameplay", [sourceType, userId, window.dayKey]),
      module: "gameplay",
      bucket,
      detail: item.preciseWindow ? "public_jjs_playtime" : "daily_bucket_without_precise_cutoff",
      sourceType,
      userId,
      displayName,
      occurredAt: toIsoString(window.endMs),
    });
  }

  preciseLeaders.sort(compareLeaders);
  staffItems.sort(compareLeaders);
  const topPlayers = preciseLeaders.slice(0, topCount);
  const partialReasons = ambiguousDailyBucketCount > 0 ? ["jjs_daily_buckets_without_precise_cutoff"] : [];

  return {
    sourcePlayerCount: staffItems.length,
    precisePlayerCount: preciseLeaders.length,
    ambiguousDailyBucketCount,
    totalPreciseMinutes: preciseLeaders.reduce((sum, entry) => sum + entry.minutes, 0),
    topPlayers,
    staffItems,
    candidateBuckets,
    partial: partialReasons.length > 0,
    partialReasons,
  };
}

module.exports = {
  collectGameplayDigest,
};
