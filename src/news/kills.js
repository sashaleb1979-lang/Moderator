"use strict";

const {
  collectRecentKillChanges,
  summarizeRecentKillChange,
} = require("../onboard/tierlist-ranking");

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function parseIsoMs(value) {
  const timeMs = Date.parse(String(value || ""));
  return Number.isFinite(timeMs) ? timeMs : null;
}

function normalizeNonNegativeNumber(value, fallback = null) {
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
      || profile?.username,
    120
  );
}

function resolveSubmissionDisplayName(submission = {}, profiles = {}) {
  const userId = cleanString(submission?.userId, 80);
  return cleanString(
    submission?.displayName
      || submission?.username
      || resolveProfileDisplayName(profiles, userId)
      || userId,
    120
  ) || "unknown";
}

function resolveSubmissionObservedMs(submission = {}) {
  const status = cleanString(submission?.status, 40).toLowerCase();
  const reviewedMs = parseIsoMs(submission?.reviewedAt);
  const createdMs = parseIsoMs(submission?.createdAt);
  if (status && status !== "pending") return reviewedMs ?? createdMs;
  return createdMs ?? reviewedMs;
}

function isWithinWindow(timeMs, window = {}) {
  return Number.isFinite(timeMs) && timeMs >= window.startMs && timeMs <= window.endMs;
}

function createUpgradeKey(userId, kills, timeMs) {
  return [cleanString(userId, 80), Math.round(Number(kills) || 0), Math.round(Number(timeMs) || 0)].join("|");
}

function normalizeKillUpgrade(change = {}, submissionsByApprovedEvent = new Map(), profiles = {}) {
  const summary = summarizeRecentKillChange(change);
  const userId = cleanString(change?.userId, 80);
  const toMs = Number(change?.toAt);
  const submission = submissionsByApprovedEvent.get(createUpgradeKey(userId, change?.to, toMs)) || null;
  const displayName = submission
    ? resolveSubmissionDisplayName(submission, profiles)
    : resolveProfileDisplayName(profiles, userId) || userId || "unknown";

  return {
    userId,
    displayName,
    from: normalizeNonNegativeNumber(change?.from, 0),
    to: normalizeNonNegativeNumber(change?.to, 0),
    delta: summary.delta,
    dayCount: summary.dayCount,
    averagePerDay: summary.averagePerDay,
    fromAt: toIsoString(Number(change?.fromAt)),
    toAt: toIsoString(toMs),
    submissionId: cleanString(submission?.id, 120) || null,
  };
}

function compareKillUpgrades(left, right) {
  return right.delta - left.delta
    || Date.parse(right.toAt || "") - Date.parse(left.toAt || "")
    || compareText(left.displayName, right.displayName);
}

function collectKillDigest({ db = {}, window = {}, config = {} } = {}) {
  const profiles = db.profiles && typeof db.profiles === "object" && !Array.isArray(db.profiles) ? db.profiles : {};
  const submissions = Object.values(db.submissions && typeof db.submissions === "object" && !Array.isArray(db.submissions) ? db.submissions : {});
  const submissionsByApprovedEvent = new Map();

  for (const submission of submissions) {
    if (!submission || typeof submission !== "object") continue;
    if (cleanString(submission.status, 40).toLowerCase() !== "approved") continue;
    const userId = cleanString(submission.userId, 80);
    const kills = normalizeNonNegativeNumber(submission.kills, null);
    const observedMs = parseIsoMs(submission.reviewedAt) ?? parseIsoMs(submission.createdAt);
    if (!userId || kills === null || observedMs === null) continue;
    submissionsByApprovedEvent.set(createUpgradeKey(userId, kills, observedMs), submission);
  }

  const allUpgrades = collectRecentKillChanges(submissions, { profiles })
    .filter((change) => isWithinWindow(Number(change?.toAt), window))
    .map((change) => normalizeKillUpgrade(change, submissionsByApprovedEvent, profiles))
    .filter((entry) => entry.userId && entry.delta > 0)
    .sort(compareKillUpgrades);

  const topCount = Math.max(1, Number(config?.kills?.topCount) || 5);
  const topUpgrades = allUpgrades.slice(0, topCount);
  const publicUpgradeKeys = new Set(topUpgrades.map((entry) => createUpgradeKey(entry.userId, entry.to, Date.parse(entry.toAt || ""))));
  const staffItems = [];
  const candidateBuckets = [];
  const byStatus = {
    approved: 0,
    pending: 0,
    rejected: 0,
    expired: 0,
    superseded: 0,
    invalid: 0,
    other: 0,
  };

  for (const submission of submissions) {
    if (!submission || typeof submission !== "object") continue;
    const observedMs = resolveSubmissionObservedMs(submission);
    if (!isWithinWindow(observedMs, window)) continue;

    const id = cleanString(submission.id, 120) || createAuditCandidateId("submission", [submission.userId, submission.createdAt, submission.reviewedAt]);
    const userId = cleanString(submission.userId, 80);
    const displayName = resolveSubmissionDisplayName(submission, profiles);
    const status = cleanString(submission.status, 40).toLowerCase() || "unknown";
    const kills = normalizeNonNegativeNumber(submission.kills, null);
    const eventKey = createUpgradeKey(userId, kills, observedMs);

    let bucket = "published_staff";
    let detail = "kill_submission_staff_digest";

    if (!userId || kills === null || status === "unknown") {
      bucket = "invalid_source";
      detail = "invalid_kill_submission";
      byStatus.invalid += 1;
    } else if (status === "approved") {
      byStatus.approved += 1;
      if (publicUpgradeKeys.has(eventKey)) {
        bucket = "published_public";
        detail = "public_kill_upgrade";
      } else {
        bucket = "suppressed_by_threshold";
        detail = "approved_without_public_top_upgrade";
      }
    } else if (status === "pending") {
      bucket = "pending_review";
      detail = "pending_kill_review";
      byStatus.pending += 1;
    } else if (status === "rejected") {
      bucket = "rejected";
      detail = cleanString(submission.rejectReason, 200) || "rejected_kill_submission";
      byStatus.rejected += 1;
    } else if (status === "expired") {
      bucket = "expired";
      detail = "expired_kill_submission";
      byStatus.expired += 1;
    } else if (status === "superseded") {
      bucket = "superseded";
      detail = cleanString(submission.rejectReason, 200) || "superseded_kill_submission";
      byStatus.superseded += 1;
    } else {
      detail = `unknown_status:${status}`;
      byStatus.other += 1;
    }

    const staffItem = {
      id,
      userId,
      displayName,
      status,
      kills,
      derivedTier: normalizeNonNegativeNumber(submission.derivedTier, null),
      createdAt: cleanString(submission.createdAt, 80) || null,
      reviewedAt: cleanString(submission.reviewedAt, 80) || null,
      reviewedBy: cleanString(submission.reviewedBy, 120) || null,
      rejectReason: cleanString(submission.rejectReason, 500) || null,
      bucket,
      bucketDetail: detail,
    };
    staffItems.push(staffItem);
    candidateBuckets.push({
      id: createAuditCandidateId("kills", [id, status, toIsoString(observedMs)]),
      module: "kills",
      bucket,
      detail,
      sourceType: "submission",
      submissionId: id,
      userId,
      displayName,
      occurredAt: toIsoString(observedMs),
    });
  }

  staffItems.sort((left, right) => {
    const leftMs = Date.parse(left.reviewedAt || left.createdAt || "") || 0;
    const rightMs = Date.parse(right.reviewedAt || right.createdAt || "") || 0;
    return rightMs - leftMs || compareText(left.displayName, right.displayName);
  });

  return {
    sourceSubmissionCount: candidateBuckets.length,
    upgradeCount: allUpgrades.length,
    topUpgrades,
    allUpgrades,
    byStatus,
    staffItems,
    candidateBuckets,
    partial: false,
    partialReasons: [],
  };
}

module.exports = {
  collectKillDigest,
};
