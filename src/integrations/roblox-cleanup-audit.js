"use strict";

const {
  ensureSharedProfile,
  resolveUsableVerifiedRobloxIdentity,
} = require("./shared-profile");

function cleanString(value, maxLength = 200) {
  if (value === undefined || value === null) return "";
  const text = String(value).trim();
  if (!text) return "";
  return text.slice(0, maxLength);
}

function normalizeComparableValue(value) {
  return cleanString(value, 200).toLowerCase();
}

function normalizeSampleLimit(value, fallback = 5) {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    return fallback;
  }
  return numeric;
}

function hasAnyRobloxData(roblox = {}) {
  if (!roblox || typeof roblox !== "object") return false;

  const verificationStatus = cleanString(roblox.verificationStatus, 40).toLowerCase();

  return Boolean(
    cleanString(roblox.currentUsername ?? roblox.username, 120)
    || cleanString(roblox.userId, 40)
    || cleanString(roblox.profileUrl, 500)
    || cleanString(roblox.avatarUrl, 2000)
    || cleanString(roblox.verifiedAt, 80)
    || cleanString(roblox.refreshStatus, 40)
    || cleanString(roblox.refreshError, 500)
    || cleanString(roblox.source, 80)
    || (verificationStatus && verificationStatus !== "unverified")
  );
}

function detectSuspiciousPollution(profile = {}, robloxSummary = {}, usableIdentity = null) {
  if (usableIdentity) return false;

  const robloxUsername = normalizeComparableValue(
    robloxSummary.currentUsername ?? robloxSummary.username
  );
  if (!robloxUsername) return false;

  const rootCandidates = new Set([
    normalizeComparableValue(profile.username),
    normalizeComparableValue(profile.displayName),
    normalizeComparableValue(profile?.summary?.preferredDisplayName),
  ].filter(Boolean));

  return rootCandidates.has(robloxUsername);
}

function resolvePrimaryCohort(robloxSummary = {}, usableIdentity = null, hasRobloxData = false) {
  if (usableIdentity) return "usable_verified";

  const trackingState = cleanString(robloxSummary.trackingState, 40);
  if (trackingState === "repairable") return "repairable_verified";
  if (trackingState === "manual_only") return "manual_only_verified";
  if (trackingState === "pending") return "pending";
  if (trackingState === "failed") return "failed";

  return hasRobloxData ? "unverified" : "no_binding";
}

function resolveSuggestedAction(record = {}) {
  if (record.primaryCohort === "repairable_verified" && !record.suspiciousPollution) {
    return "safe_repair";
  }

  if (record.suspiciousPollution || record.primaryCohort === "manual_only_verified") {
    return "manual_review";
  }

  if (record.usableWithoutAntiteamConfirmation) {
    return "confirm_only";
  }

  if (["pending", "failed", "unverified"].includes(record.primaryCohort)) {
    return "rebind_required";
  }

  return "none";
}

function buildRecordSample(record = {}) {
  return {
    userId: record.userId,
    primaryCohort: record.primaryCohort,
    suggestedAction: record.suggestedAction,
    discordUsername: record.discordUsername,
    displayName: record.displayName,
    robloxUsername: record.robloxUsername,
    robloxUserId: record.robloxUserId,
    trackingState: record.trackingState,
    trackingBlocker: record.trackingBlocker,
    verificationStatus: record.verificationStatus,
    suspiciousPollution: record.suspiciousPollution,
    usableWithoutAntiteamConfirmation: record.usableWithoutAntiteamConfirmation,
    refreshError: record.refreshError,
  };
}

function pushSample(samples = {}, key = "", sample = null, sampleLimit = 5) {
  if (!key || !sample || sampleLimit <= 0) return;
  samples[key] ||= [];
  if (samples[key].length >= sampleLimit) return;
  samples[key].push(sample);
}

function buildRobloxCleanupAuditRecord(rawProfile = {}, userId = "", options = {}) {
  const normalizedUserId = cleanString(userId || rawProfile?.userId, 80);
  const ensured = ensureSharedProfile(rawProfile, normalizedUserId).profile;
  const robloxDomain = ensured?.domains?.roblox || {};
  const robloxSummary = ensured?.summary?.roblox || {};
  const usableIdentity = resolveUsableVerifiedRobloxIdentity(robloxDomain);
  const confirmationMap = options.robloxConfirmations && typeof options.robloxConfirmations === "object"
    ? options.robloxConfirmations
    : {};
  const confirmation = normalizedUserId ? confirmationMap[normalizedUserId] || null : null;
  const hasRoblox = hasAnyRobloxData(robloxSummary) || hasAnyRobloxData(robloxDomain);
  const suspiciousPollution = detectSuspiciousPollution(ensured, robloxSummary, usableIdentity);
  const usableWithoutAntiteamConfirmation = Boolean(
    usableIdentity
    && cleanString(confirmation?.robloxUserId, 40) !== usableIdentity.userId
  );

  const record = {
    userId: normalizedUserId,
    discordUsername: cleanString(ensured.username, 120),
    displayName: cleanString(ensured.displayName, 200),
    preferredDisplayName: cleanString(ensured?.summary?.preferredDisplayName, 200),
    robloxUsername: cleanString(robloxSummary.currentUsername ?? robloxSummary.username, 120),
    robloxUserId: cleanString(robloxSummary.userId, 40),
    verificationStatus: cleanString(robloxSummary.verificationStatus, 40) || "unverified",
    trackingState: cleanString(robloxSummary.trackingState, 40) || "unverified",
    trackingBlocker: cleanString(robloxSummary.trackingBlocker, 80) || "none",
    hasAnyRobloxData: hasRoblox,
    suspiciousPollution,
    refreshError: Boolean(cleanString(robloxSummary.refreshError, 500) || cleanString(robloxDomain.refreshError, 500)),
    usableWithoutAntiteamConfirmation,
    confirmationRobloxUserId: cleanString(confirmation?.robloxUserId, 40),
    usableIdentity,
    primaryCohort: resolvePrimaryCohort(robloxSummary, usableIdentity, hasRoblox),
  };

  record.suggestedAction = resolveSuggestedAction(record);
  return record;
}

function summarizeRobloxCleanupAudit(db = {}, options = {}) {
  const profiles = db?.profiles && typeof db.profiles === "object" && !Array.isArray(db.profiles)
    ? db.profiles
    : {};
  const robloxConfirmations = db?.sot?.antiteam?.robloxConfirmations
    && typeof db.sot.antiteam.robloxConfirmations === "object"
    && !Array.isArray(db.sot.antiteam.robloxConfirmations)
      ? db.sot.antiteam.robloxConfirmations
      : {};
  const sampleLimit = normalizeSampleLimit(options.sampleLimit, 5);
  const includeRecords = options.includeRecords === true;
  const now = cleanString(options.now, 80) || new Date().toISOString();
  const counts = {
    totalProfiles: 0,
    profilesWithRobloxData: 0,
    usableVerified: 0,
    repairableVerified: 0,
    manualOnlyVerified: 0,
    pending: 0,
    failed: 0,
    unverified: 0,
    noBinding: 0,
    suspiciousPollution: 0,
    refreshError: 0,
    usableWithoutAntiteamConfirmation: 0,
    safeRepairCandidates: 0,
    manualReviewCandidates: 0,
    rebindRequiredCandidates: 0,
  };
  const samples = {
    byPrimaryCohort: {},
    suspiciousPollution: [],
    usableWithoutAntiteamConfirmation: [],
    safeRepairCandidates: [],
    manualReviewCandidates: [],
    rebindRequiredCandidates: [],
  };
  const records = [];

  for (const [userId, rawProfile] of Object.entries(profiles)) {
    const record = buildRobloxCleanupAuditRecord(rawProfile, userId, { robloxConfirmations });
    const sample = buildRecordSample(record);

    counts.totalProfiles += 1;
    if (record.hasAnyRobloxData) counts.profilesWithRobloxData += 1;
    if (record.primaryCohort === "usable_verified") counts.usableVerified += 1;
    if (record.primaryCohort === "repairable_verified") counts.repairableVerified += 1;
    if (record.primaryCohort === "manual_only_verified") counts.manualOnlyVerified += 1;
    if (record.primaryCohort === "pending") counts.pending += 1;
    if (record.primaryCohort === "failed") counts.failed += 1;
    if (record.primaryCohort === "unverified") counts.unverified += 1;
    if (record.primaryCohort === "no_binding") counts.noBinding += 1;
    if (record.suspiciousPollution) counts.suspiciousPollution += 1;
    if (record.refreshError) counts.refreshError += 1;
    if (record.usableWithoutAntiteamConfirmation) counts.usableWithoutAntiteamConfirmation += 1;
    if (record.suggestedAction === "safe_repair") counts.safeRepairCandidates += 1;
    if (record.suggestedAction === "manual_review") counts.manualReviewCandidates += 1;
    if (record.suggestedAction === "rebind_required") counts.rebindRequiredCandidates += 1;

    pushSample(samples.byPrimaryCohort, record.primaryCohort, sample, sampleLimit);
    if (record.suspiciousPollution) {
      pushSample(samples, "suspiciousPollution", sample, sampleLimit);
    }
    if (record.usableWithoutAntiteamConfirmation) {
      pushSample(samples, "usableWithoutAntiteamConfirmation", sample, sampleLimit);
    }
    if (record.suggestedAction === "safe_repair") {
      pushSample(samples, "safeRepairCandidates", sample, sampleLimit);
    }
    if (record.suggestedAction === "manual_review") {
      pushSample(samples, "manualReviewCandidates", sample, sampleLimit);
    }
    if (record.suggestedAction === "rebind_required") {
      pushSample(samples, "rebindRequiredCandidates", sample, sampleLimit);
    }

    if (includeRecords) {
      records.push(record);
    }
  }

  return {
    generatedAt: now,
    sampleLimit,
    counts,
    samples,
    records: includeRecords ? records : undefined,
  };
}

module.exports = {
  buildRobloxCleanupAuditRecord,
  summarizeRobloxCleanupAudit,
};