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

function normalizePositiveNumber(value, fallback = 1) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : fallback;
}

function createAuditCandidateId(prefix, parts = []) {
  return [cleanString(prefix, 40) || "candidate", ...parts.map((part) => cleanString(part, 120) || "na")].join(":");
}

function isWithinWindow(timeMs, window = {}) {
  return Number.isFinite(timeMs) && timeMs >= window.startMs && timeMs <= window.endMs;
}

function compareByTimeThenName(left, right) {
  return (left.submittedMs || 0) - (right.submittedMs || 0)
    || String(left.displayName || "").localeCompare(String(right.displayName || ""), undefined, { sensitivity: "base" });
}

function resolveDisplayName(profile = {}, userId = "") {
  return cleanString(
    profile?.summary?.preferredDisplayName
      || profile?.displayName
      || profile?.username
      || userId,
    120
  ) || "unknown";
}

function resolveTierlist(profile = {}) {
  return profile?.domains?.tierlist && typeof profile.domains.tierlist === "object"
    ? profile.domains.tierlist
    : profile?.summary?.tierlist && typeof profile.summary.tierlist === "object"
      ? profile.summary.tierlist
      : {};
}

function collectTierlistDigest({ db = {}, window = {}, config = {} } = {}) {
  const profiles = db.profiles && typeof db.profiles === "object" && !Array.isArray(db.profiles) ? db.profiles : {};
  const topCount = Math.max(1, Number(config?.tierlist?.topCount) || 5);
  const updates = [];
  const candidateBuckets = [];

  for (const [rawUserId, profile] of Object.entries(profiles)) {
    if (!profile || typeof profile !== "object") continue;
    const userId = cleanString(profile.userId || rawUserId, 80);
    if (!userId) continue;
    const tierlist = resolveTierlist(profile);
    const submittedMs = parseIsoMs(tierlist.submittedAt);
    if (!isWithinWindow(submittedMs, window)) continue;
    const displayName = resolveDisplayName(profile, userId);
    const mainId = cleanString(tierlist.mainId, 80);
    const mainName = cleanString(tierlist.mainName, 120) || mainId || "main unknown";
    const update = {
      userId,
      displayName,
      mainId: mainId || null,
      mainName,
      submittedAt: toIsoString(submittedMs),
      submittedMs,
      influenceMultiplier: normalizePositiveNumber(tierlist.influenceMultiplier, 1),
      sourceType: "profile.tierlist.submittedAt",
    };
    updates.push(update);
    candidateBuckets.push({
      id: createAuditCandidateId("tierlist", [userId, update.submittedAt, mainId]),
      module: "tierlist",
      bucket: "published_public",
      detail: "public_tierlist_submission",
      sourceType: update.sourceType,
      userId,
      displayName,
      occurredAt: update.submittedAt,
    });
  }

  updates.sort(compareByTimeThenName);
  return {
    sourceUpdateCount: updates.length,
    updates: updates.slice(0, topCount).map(({ submittedMs, ...entry }) => entry),
    staffItems: updates.map(({ submittedMs, ...entry }) => entry),
    shifts: {
      available: false,
      reason: "no_tierlist_shift_history_yet",
    },
    candidateBuckets,
    partial: false,
    partialReasons: [],
  };
}

module.exports = {
  collectTierlistDigest,
};
