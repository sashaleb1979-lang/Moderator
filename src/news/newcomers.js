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

function isWithinWindow(timeMs, window = {}) {
  return Number.isFinite(timeMs) && timeMs >= window.startMs && timeMs <= window.endMs;
}

function compareByTimeThenName(left, right) {
  return (left.occurredMs || 0) - (right.occurredMs || 0)
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

function getProfileCandidates(profile = {}, userId = "") {
  const activity = profile?.summary?.activity || profile?.domains?.activity || profile?.activity || {};
  const roblox = profile?.summary?.roblox || profile?.domains?.roblox || {};
  const onboarding = profile?.summary?.onboarding || profile?.domains?.onboarding || profile || {};
  return [
    {
      eventType: "guild_joined",
      occurredAt: cleanString(activity.guildJoinedAt || profile.guildJoinedAt, 80),
      sourceType: "profile.activity.guildJoinedAt",
    },
    {
      eventType: "roblox_verified",
      occurredAt: cleanString(roblox.verifiedAt || profile.robloxVerifiedAt || profile.verifiedAt, 80),
      sourceType: "profile.roblox.verifiedAt",
    },
    {
      eventType: "access_granted",
      occurredAt: cleanString(onboarding.accessGrantedAt || profile.accessGrantedAt, 80),
      sourceType: "profile.onboarding.accessGrantedAt",
    },
  ].filter((entry) => entry.occurredAt);
}

function collectNewcomerDigest({ db = {}, window = {}, config = {} } = {}) {
  const profiles = db.profiles && typeof db.profiles === "object" && !Array.isArray(db.profiles) ? db.profiles : {};
  const topCount = Math.max(1, Number(config?.newcomers?.topCount) || 8);
  const events = [];
  const candidateBuckets = [];

  for (const [rawUserId, profile] of Object.entries(profiles)) {
    if (!profile || typeof profile !== "object") continue;
    const userId = cleanString(profile.userId || rawUserId, 80);
    if (!userId) continue;
    const displayName = resolveDisplayName(profile, userId);

    for (const candidate of getProfileCandidates(profile, userId)) {
      const occurredMs = parseIsoMs(candidate.occurredAt);
      if (!isWithinWindow(occurredMs, window)) continue;
      const event = {
        userId,
        displayName,
        eventType: candidate.eventType,
        occurredAt: toIsoString(occurredMs),
        occurredMs,
        sourceType: candidate.sourceType,
      };
      events.push(event);
      candidateBuckets.push({
        id: createAuditCandidateId("newcomers", [candidate.eventType, userId, event.occurredAt]),
        module: "newcomers",
        bucket: "published_public",
        detail: `public_${candidate.eventType}`,
        sourceType: candidate.sourceType,
        userId,
        displayName,
        occurredAt: event.occurredAt,
      });
    }
  }

  events.sort(compareByTimeThenName);
  const joined = events.filter((entry) => entry.eventType === "guild_joined");
  const verified = events.filter((entry) => entry.eventType === "roblox_verified");
  const accessGranted = events.filter((entry) => entry.eventType === "access_granted");

  return {
    sourceEventCount: events.length,
    newcomerCount: joined.length,
    verifiedCount: verified.length,
    accessGrantedCount: accessGranted.length,
    highlights: events.slice(0, topCount).map(({ occurredMs, ...entry }) => entry),
    joined: joined.slice(0, topCount).map(({ occurredMs, ...entry }) => entry),
    verified: verified.slice(0, topCount).map(({ occurredMs, ...entry }) => entry),
    accessGranted: accessGranted.slice(0, topCount).map(({ occurredMs, ...entry }) => entry),
    candidateBuckets,
    partial: false,
    partialReasons: [],
  };
}

module.exports = {
  collectNewcomerDigest,
};
