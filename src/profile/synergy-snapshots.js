"use strict";

const { normalizeRobloxDomainState } = require("../integrations/shared-profile");

const PROOF_WINDOW_LIMIT = 10;

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function normalizeNullableString(value, limit = 2000) {
  const text = cleanString(value, limit);
  return text || null;
}

function normalizeNonNegativeInteger(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : fallback;
}

function normalizeNullableInteger(value, options = {}) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) return null;
  if (Number.isFinite(options.min) && amount < options.min) return null;
  if (Number.isFinite(options.max) && amount > options.max) return null;
  return amount;
}

function cloneValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function buildProofWindowSnapshot({ approvedKills = null, killTier = null, reviewedAt = null, reviewedBy = null, roblox = null } = {}) {
  const normalizedRoblox = normalizeRobloxDomainState(roblox || {});
  const playtime = normalizedRoblox.playtime;

  return {
    approvedKills: normalizeNullableInteger(approvedKills, { min: 0 }),
    killTier: normalizeNullableInteger(killTier, { min: 1, max: 5 }),
    reviewedAt: normalizeNullableString(reviewedAt, 80),
    reviewedBy: normalizeNullableString(reviewedBy, 120),
    playtimeTracked: normalizedRoblox.verificationStatus === "verified" && Boolean(normalizedRoblox.userId),
    totalJjsMinutes: normalizeNonNegativeInteger(playtime?.totalJjsMinutes, 0),
    jjsMinutes7d: normalizeNonNegativeInteger(playtime?.jjsMinutes7d, 0),
    jjsMinutes30d: normalizeNonNegativeInteger(playtime?.jjsMinutes30d, 0),
    sessionCount: normalizeNonNegativeInteger(playtime?.sessionCount, 0),
    currentSessionStartedAt: normalizeNullableString(playtime?.currentSessionStartedAt, 80),
    lastSeenInJjsAt: normalizeNullableString(playtime?.lastSeenInJjsAt, 80),
    dailyBucketsSnapshot: cloneValue(playtime?.dailyBuckets) || {},
    hourlyBucketsMskSnapshot: cloneValue(playtime?.hourlyBucketsMsk) || {},
  };
}

function appendProofWindowSnapshot(profile = {}, snapshot = {}, options = {}) {
  const targetProfile = profile && typeof profile === "object" ? profile : {};
  const nextSnapshot = buildProofWindowSnapshot(snapshot);
  if (nextSnapshot.approvedKills === null || !nextSnapshot.reviewedAt) {
    return {
      appended: false,
      profile: targetProfile,
      snapshot: nextSnapshot,
    };
  }

  targetProfile.domains ||= {};
  const currentProgress = targetProfile.domains.progress && typeof targetProfile.domains.progress === "object"
    ? targetProfile.domains.progress
    : {};
  const existing = Array.isArray(currentProgress.proofWindows) ? currentProgress.proofWindows : [];
  const limit = Math.max(1, Number(options.limit) || PROOF_WINDOW_LIMIT);
  const nextProofWindows = existing
    .filter((entry) => !(Number(entry?.approvedKills) === nextSnapshot.approvedKills && String(entry?.reviewedAt || "") === nextSnapshot.reviewedAt))
    .concat([nextSnapshot])
    .sort((left, right) => String(left?.reviewedAt || "").localeCompare(String(right?.reviewedAt || "")))
    .slice(-limit);

  targetProfile.domains.progress = {
    ...currentProgress,
    proofWindows: nextProofWindows,
  };

  return {
    appended: true,
    profile: targetProfile,
    snapshot: nextSnapshot,
  };
}

module.exports = {
  PROOF_WINDOW_LIMIT,
  appendProofWindowSnapshot,
  buildProofWindowSnapshot,
};