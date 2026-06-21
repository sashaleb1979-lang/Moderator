"use strict";

// Self-heal for approved kill stats that went missing from a profile.
//
// The profile is a derived projection: `approvedKills`/`killTier` are written when a
// submission is approved, but the authoritative record of what a member actually
// submitted is the submission itself. If a profile loses those fields (a lost async
// write, an accidental moderator reset, a half-applied migration) while an approved
// submission still exists, the tierlist drops the member and the startup tier-role sync
// silently reverts their kill-tier role. This module reconstructs the lost stats from the
// authoritative approved submission so nothing rolls back "from nothing".

function cleanString(value, limit = 200) {
  return String(value === null || value === undefined ? "" : value).trim().slice(0, Math.max(0, limit));
}

function toFiniteInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount) : null;
}

function normalizeKills(value) {
  const amount = toFiniteInteger(value);
  return amount !== null && amount >= 0 ? amount : null;
}

function normalizeTier(value) {
  const amount = toFiniteInteger(value);
  return amount !== null && amount >= 1 && amount <= 5 ? amount : null;
}

function isApprovedKillSubmission(submission, userId) {
  return Boolean(
    submission
    && typeof submission === "object"
    && submission.status === "approved"
    && cleanString(submission.userId, 80) === userId
    && normalizeKills(submission.kills) !== null
  );
}

function submissionRecency(submission) {
  return Date.parse(submission.reviewedAt || "")
    || Date.parse(submission.createdAt || "")
    || 0;
}

// Pick the submission that best represents the profile's approved state: the one the
// profile already points at, otherwise the most recently reviewed approved submission.
function pickAuthoritativeApprovedSubmission(profile, submissions) {
  const userId = cleanString(profile?.userId, 80);
  if (!userId) return null;

  const approved = (Array.isArray(submissions) ? submissions : [])
    .filter((submission) => isApprovedKillSubmission(submission, userId));
  if (!approved.length) return null;

  const lastSubmissionId = cleanString(profile?.lastSubmissionId, 120);
  if (lastSubmissionId) {
    const pinned = approved.find((submission) => cleanString(submission.id, 120) === lastSubmissionId);
    if (pinned) return pinned;
  }

  return approved.reduce((best, submission) => (
    !best || submissionRecency(submission) >= submissionRecency(best) ? submission : best
  ), null);
}

// Returns whether the profile is an approved member who lost their kills or tier.
function profileNeedsKillRecovery(profile) {
  if (!profile || typeof profile !== "object") return false;
  if (cleanString(profile.lastSubmissionStatus, 40) !== "approved") return false;
  return normalizeKills(profile.approvedKills) === null || normalizeTier(profile.killTier) === null;
}

// Mutates `profile` in place, restoring approvedKills/killTier from the authoritative
// approved submission (or recomputing the tier from kills via `killTierFor`). Returns a
// summary describing whether anything changed.
function recoverApprovedProfileKills(profile, submissions, options = {}) {
  const killTierFor = typeof options.killTierFor === "function" ? options.killTierFor : null;
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();

  if (!profileNeedsKillRecovery(profile)) {
    return { changed: false, reason: "not-eligible" };
  }

  const currentKills = normalizeKills(profile.approvedKills);
  let nextKills = currentKills;
  let nextTier = normalizeTier(profile.killTier);

  if (nextKills === null) {
    const source = pickAuthoritativeApprovedSubmission(profile, submissions);
    if (!source) {
      return { changed: false, reason: "no-approved-submission" };
    }
    nextKills = normalizeKills(source.kills);
    nextTier = normalizeTier(source.derivedTier)
      ?? (killTierFor ? normalizeTier(killTierFor(nextKills)) : null);
  } else if (nextTier === null && killTierFor) {
    // Kills survived but the tier was lost — recompute it from the surviving kills.
    nextTier = normalizeTier(killTierFor(nextKills));
  }

  if (nextKills === null || nextTier === null) {
    return { changed: false, reason: "unresolved" };
  }

  if (nextKills === currentKills && nextTier === normalizeTier(profile.killTier)) {
    return { changed: false, reason: "already-consistent" };
  }

  profile.approvedKills = nextKills;
  profile.killTier = nextTier;
  profile.updatedAt = now();

  return {
    changed: true,
    approvedKills: nextKills,
    killTier: nextTier,
  };
}

// Batch self-heal across all profiles in a db. Returns the list of recovered userIds.
function recoverApprovedProfileKillsForDb(db, options = {}) {
  const profiles = db && typeof db.profiles === "object" && !Array.isArray(db.profiles) ? db.profiles : {};
  const submissions = db && typeof db.submissions === "object" && !Array.isArray(db.submissions)
    ? Object.values(db.submissions)
    : [];

  const recovered = [];
  for (const [userId, profile] of Object.entries(profiles)) {
    const result = recoverApprovedProfileKills(profile, submissions, options);
    if (result.changed) {
      recovered.push({
        userId,
        approvedKills: result.approvedKills,
        killTier: result.killTier,
      });
    }
  }

  return { changed: recovered.length > 0, recovered };
}

module.exports = {
  pickAuthoritativeApprovedSubmission,
  profileNeedsKillRecovery,
  recoverApprovedProfileKills,
  recoverApprovedProfileKillsForDb,
};
