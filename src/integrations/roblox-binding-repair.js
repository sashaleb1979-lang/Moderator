"use strict";

const { splitIntoBatches } = require("./roblox-service");
const { buildRobloxCleanupAuditRecord } = require("./roblox-cleanup-audit");
const {
  applyRobloxAccountSnapshot,
  ensureSharedProfile,
  normalizeRobloxDomainState,
} = require("./shared-profile");

const ROBLOX_CLEANUP_TRAIL_VERSION = 1;
const ROBLOX_CLEANUP_HISTORY_LIMIT = 10;
const ROBLOX_CLEANUP_OUTCOMES = new Set([
  "sanitized",
  "repaired",
  "restored_from_submission",
  "restored_from_cleanup_trail",
  "reset_suspicious",
  "unresolved",
  "skipped_suspicious",
  "rebind_required",
  "confirm_only",
]);

function cleanString(value, maxLength = 200) {
  if (value === undefined || value === null) return "";
  const text = String(value).trim();
  if (!text) return "";
  return text.slice(0, maxLength);
}

function cloneValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeCleanupOutcome(value = "") {
  const normalized = cleanString(value, 80).toLowerCase();
  return ROBLOX_CLEANUP_OUTCOMES.has(normalized) ? normalized : "";
}

function normalizeCleanupReason(value = "") {
  return cleanString(value, 120).toLowerCase();
}

function resolveNowIso(options = {}) {
  const source = typeof options.now === "function" ? options.now() : options.now;
  const text = cleanString(source, 80);
  return text || new Date().toISOString();
}

function normalizeCleanupHistoryEntry(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const outcome = normalizeCleanupOutcome(source.outcome);
  if (!outcome) return null;

  return {
    at: cleanString(source.at, 80) || null,
    outcome,
    reason: normalizeCleanupReason(source.reason) || "none",
    source: cleanString(source.source, 80) || "unknown",
    robloxUsername: cleanString(source.robloxUsername, 120) || null,
    robloxUserId: cleanString(source.robloxUserId, 40) || null,
  };
}

function normalizeCleanupHistory(value = []) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeCleanupHistoryEntry(entry))
    .filter(Boolean)
    .slice(0, ROBLOX_CLEANUP_HISTORY_LIMIT);
}

function normalizeCleanupEntry(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    userId: cleanString(source.userId, 80),
    lastEvaluatedAt: cleanString(source.lastEvaluatedAt, 80) || null,
    lastOutcome: normalizeCleanupOutcome(source.lastOutcome) || null,
    lastReason: normalizeCleanupReason(source.lastReason) || "none",
    lastSource: cleanString(source.lastSource, 80) || null,
    robloxUsername: cleanString(source.robloxUsername, 120) || null,
    robloxUserId: cleanString(source.robloxUserId, 40) || null,
    history: normalizeCleanupHistory(source.history),
  };
}

function normalizeCleanupEntryMap(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const normalized = {};
  for (const [userId, entry] of Object.entries(value)) {
    const normalizedUserId = cleanString(userId, 80);
    if (!normalizedUserId) continue;
    normalized[normalizedUserId] = normalizeCleanupEntry({
      ...(entry && typeof entry === "object" ? entry : {}),
      userId: normalizedUserId,
    });
  }
  return normalized;
}

function normalizeCleanupTrailState(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    version: ROBLOX_CLEANUP_TRAIL_VERSION,
    lastRunAt: cleanString(source.lastRunAt, 80) || null,
    byDiscordUserId: normalizeCleanupEntryMap(source.byDiscordUserId),
  };
}

function ensureRobloxCleanupTrailState(db = {}) {
  const targetDb = db && typeof db === "object" ? db : {};
  targetDb.sot ||= {};
  targetDb.sot.integrations ||= {};
  const robloxState = targetDb.sot.integrations.roblox && typeof targetDb.sot.integrations.roblox === "object"
    ? targetDb.sot.integrations.roblox
    : {};
  const normalizedCleanup = normalizeCleanupTrailState(robloxState.cleanup);
  robloxState.cleanup = normalizedCleanup;
  targetDb.sot.integrations.roblox = robloxState;

  return normalizedCleanup;
}

function getRobloxCleanupTrailEntry(db = {}, userId = "") {
  const normalizedUserId = cleanString(userId, 80);
  if (!normalizedUserId) return null;
  const cleanup = ensureRobloxCleanupTrailState(db);
  return cleanup.byDiscordUserId[normalizedUserId] || null;
}

function appendCleanupHistory(entry = {}, event = {}) {
  const normalizedEvent = normalizeCleanupHistoryEntry(event);
  if (!normalizedEvent) return normalizeCleanupEntry(entry);

  const next = normalizeCleanupEntry(entry);
  next.history = [normalizedEvent, ...next.history].slice(0, ROBLOX_CLEANUP_HISTORY_LIMIT);
  return next;
}

function recordRobloxCleanupOutcome(db = {}, userId = "", outcome = "", options = {}) {
  const normalizedUserId = cleanString(userId, 80);
  const normalizedOutcome = normalizeCleanupOutcome(outcome);
  if (!normalizedUserId || !normalizedOutcome) return null;

  const cleanup = ensureRobloxCleanupTrailState(db);
  const existing = cleanup.byDiscordUserId[normalizedUserId] || {
    userId: normalizedUserId,
    history: [],
  };
  const at = resolveNowIso(options);
  const next = appendCleanupHistory(existing, {
    at,
    outcome: normalizedOutcome,
    reason: options.reason,
    source: options.source,
    robloxUsername: options.robloxUsername,
    robloxUserId: options.robloxUserId,
  });

  next.userId = normalizedUserId;
  next.lastEvaluatedAt = at;
  next.lastOutcome = normalizedOutcome;
  next.lastReason = normalizeCleanupReason(options.reason) || "none";
  next.lastSource = cleanString(options.source, 80) || "unknown";
  next.robloxUsername = cleanString(options.robloxUsername, 120) || null;
  next.robloxUserId = cleanString(options.robloxUserId, 40) || null;

  cleanup.byDiscordUserId[normalizedUserId] = next;
  cleanup.lastRunAt = at;
  return next;
}

function readRawRobloxUserId(rawProfile = {}) {
  const profile = rawProfile && typeof rawProfile === "object" ? rawProfile : {};
  return cleanString(
    profile?.domains?.roblox?.userId
      ?? profile?.domains?.roblox?.invalidUserId
      ?? profile?.domains?.roblox?.rawUserId
      ?? profile?.domains?.roblox?.robloxUserId
      ?? profile?.robloxUserId
      ?? profile?.robloxInvalidUserId
      ?? profile?.rawRobloxUserId
      ?? profile?.summary?.roblox?.userId,
    40
  );
}

function shouldPersistEnsuredRobloxProfile(rawProfile = {}, ensuredProfile = {}, options = {}) {
  const rawUserId = readRawRobloxUserId(rawProfile);
  const ensuredUserId = cleanString(
    ensuredProfile?.domains?.roblox?.userId
      ?? ensuredProfile?.domains?.roblox?.invalidUserId
      ?? ensuredProfile?.domains?.roblox?.rawUserId,
    40
  );
  return !rawUserId || rawUserId === ensuredUserId || options.persistSanitizedInvalidIds === true;
}

function resolveCleanupReason(record = {}) {
  if (record.suspiciousPollution) return "suspicious_identity";
  if (record.usableWithoutAntiteamConfirmation) return "antiteam_confirmation_missing";

  const blocker = cleanString(record.trackingBlocker, 120);
  if (blocker) return blocker;

  const verificationStatus = cleanString(record.verificationStatus, 80).toLowerCase();
  if (verificationStatus) return verificationStatus;
  return "none";
}

function buildRepairSummary() {
  return {
    scannedProfiles: 0,
    profilesWithRobloxData: 0,
    safeRepairCandidateCount: 0,
    cleanupTrailRestoreCandidateCount: 0,
    submissionRestoreCandidateCount: 0,
    sanitizedCount: 0,
    restoredFromCleanupTrailCount: 0,
    restoredFromSubmissionCount: 0,
    resetSuspiciousCount: 0,
    repairedCount: 0,
    unresolvedCount: 0,
    failedRepairBatchCount: 0,
    skippedSuspiciousCount: 0,
    rebindRequiredCount: 0,
    confirmOnlyCount: 0,
  };
}

function addUsernameRepairCandidate(candidatesByUsername, candidate = {}) {
  const usernameKey = cleanString(candidate.record?.robloxUsername || candidate.robloxUsername, 120).toLowerCase();
  if (!usernameKey) return false;
  if (!candidatesByUsername.has(usernameKey)) {
    candidatesByUsername.set(usernameKey, []);
  }
  candidatesByUsername.get(usernameKey).push(candidate);
  return true;
}

function normalizeSubmissionRobloxSnapshot(submission = {}) {
  const source = submission && typeof submission === "object" ? submission : {};
  const normalized = normalizeRobloxDomainState({
    username: source.robloxUsername,
    userId: source.robloxUserId,
    displayName: source.robloxDisplayName,
  });
  if (!normalized.username || !normalized.userId) return null;
  return {
    username: normalized.username,
    userId: normalized.userId,
    displayName: normalized.displayName,
  };
}

function getSubmissionTimestamp(submission = {}) {
  const reviewedAt = Date.parse(submission?.reviewedAt || "");
  if (Number.isFinite(reviewedAt)) return reviewedAt;
  const createdAt = Date.parse(submission?.createdAt || "");
  return Number.isFinite(createdAt) ? createdAt : 0;
}

function findRecoverableRobloxSubmission(db = {}, userId = "", profile = {}) {
  const submissions = db?.submissions && typeof db.submissions === "object" && !Array.isArray(db.submissions)
    ? db.submissions
    : {};
  const normalizedUserId = cleanString(userId, 80);
  if (!normalizedUserId) return null;

  const preferredIds = [
    profile?.domains?.roblox?.lastSubmissionId,
    profile?.lastSubmissionId,
  ].map((value) => cleanString(value, 80)).filter(Boolean);
  for (const submissionId of preferredIds) {
    const submission = submissions[submissionId];
    if (!submission || cleanString(submission.userId, 80) !== normalizedUserId) continue;
    const snapshot = normalizeSubmissionRobloxSnapshot(submission);
    if (snapshot) return { submission, snapshot };
  }

  return Object.values(submissions)
    .filter((submission) => cleanString(submission?.userId, 80) === normalizedUserId)
    .map((submission) => ({ submission, snapshot: normalizeSubmissionRobloxSnapshot(submission) }))
    .filter((entry) => entry.snapshot)
    .sort((left, right) => getSubmissionTimestamp(right.submission) - getSubmissionTimestamp(left.submission))[0]
    || null;
}

function resetSuspiciousRobloxBinding(profile = {}, options = {}) {
  const target = profile && typeof profile === "object" ? profile : {};
  target.domains ||= {};
  const existing = normalizeRobloxDomainState(target.domains.roblox);
  target.domains.roblox = normalizeRobloxDomainState({
    username: null,
    userId: null,
    displayName: null,
    avatarUrl: null,
    profileUrl: null,
    verificationStatus: "failed",
    updatedAt: options.updatedAt,
    refreshStatus: "error",
    refreshError: "suspicious_identity_rebind_required",
    source: options.source || "repair",
    playtime: existing.playtime,
    coPlay: existing.coPlay,
  });
  return target.domains.roblox;
}

function findCleanupTrailRestoreCandidates(db = {}, profiles = {}, candidatesByUsername = new Map(), existingUserIds = new Set(), options = {}) {
  const cleanupEntries = ensureRobloxCleanupTrailState(db).byDiscordUserId;
  let count = 0;

  for (const [userId, entry] of Object.entries(cleanupEntries)) {
    const normalizedUserId = cleanString(userId, 80);
    const robloxUsername = cleanString(entry?.robloxUsername, 120);
    if (!normalizedUserId || !robloxUsername || existingUserIds.has(normalizedUserId)) continue;
    if (entry?.lastOutcome !== "reset_suspicious") continue;

    const rawProfile = profiles[normalizedUserId];
    if (!rawProfile || typeof rawProfile !== "object" || Array.isArray(rawProfile)) continue;
    const ensuredProfile = ensureSharedProfile(rawProfile, normalizedUserId).profile;
    const roblox = ensuredProfile?.domains?.roblox || {};
    if (roblox.verificationStatus === "verified" && roblox.userId) continue;

    const added = addUsernameRepairCandidate(candidatesByUsername, {
      userId: normalizedUserId,
      profile: ensuredProfile,
      record: {
        robloxUsername,
        robloxUserId: cleanString(entry?.robloxUserId, 40),
      },
      reason: "cleanup_trail_reset_suspicious",
      restoreSource: "cleanup_trail",
      verificationStatus: "verified",
      verifiedAt: entry.lastEvaluatedAt,
    });
    if (added) {
      if (options.dryRun !== true && shouldPersistEnsuredRobloxProfile(rawProfile, ensuredProfile, options)) {
        profiles[normalizedUserId] = ensuredProfile;
      }
      existingUserIds.add(normalizedUserId);
      count += 1;
    }
  }

  return count;
}

async function applyRobloxBindingRepairPass(options = {}) {
  const db = options.db && typeof options.db === "object" ? options.db : null;
  const profiles = db?.profiles && typeof db.profiles === "object" && !Array.isArray(db.profiles)
    ? db.profiles
    : null;
  const fetchUsersByUsernames = typeof options.fetchUsersByUsernames === "function"
    ? options.fetchUsersByUsernames
    : null;
  const logError = typeof options.logError === "function" ? options.logError : () => {};
  const markDirty = typeof options.markDirty === "function" ? options.markDirty : null;
  const persistTrail = options.persistTrail === true;
  const dryRun = options.dryRun === true;
  const recoverFromSubmissions = options.recoverFromSubmissions === true;
  const resetSuspiciousBindings = options.resetSuspiciousBindings === true;
  const allowDestructiveSuspiciousReset = options.allowDestructiveSuspiciousReset === true;
  const persistSanitizedInvalidIds = options.persistSanitizedInvalidIds === true;
  const nowIso = resolveNowIso(options);
  const source = cleanString(options.source, 80) || (dryRun ? "repair_dry_run" : "repair_apply");

  if (!profiles) {
    return buildRepairSummary();
  }

  if (persistTrail && !dryRun) {
    ensureRobloxCleanupTrailState(db).lastRunAt = nowIso;
  }

  const robloxConfirmations = db?.sot?.antiteam?.robloxConfirmations
    && typeof db.sot.antiteam.robloxConfirmations === "object"
    && !Array.isArray(db.sot.antiteam.robloxConfirmations)
      ? db.sot.antiteam.robloxConfirmations
      : {};
  const summary = buildRepairSummary();
  const candidatesByUsername = new Map();
  const candidateUserIds = new Set();

  if (db && profiles) {
    summary.cleanupTrailRestoreCandidateCount += findCleanupTrailRestoreCandidates(
      db,
      profiles,
      candidatesByUsername,
      candidateUserIds,
      { dryRun, persistSanitizedInvalidIds }
    );
  }

  for (const [userId, rawProfile] of Object.entries(profiles)) {
    const ensuredProfile = ensureSharedProfile(rawProfile, userId).profile;
    const record = buildRobloxCleanupAuditRecord(ensuredProfile, userId, { robloxConfirmations });
    const rawUserId = readRawRobloxUserId(rawProfile);
    const ensuredUserId = cleanString(ensuredProfile?.domains?.roblox?.userId, 40);
    const hadSanitizedUserId = Boolean(rawUserId && rawUserId !== ensuredUserId);
    const reason = resolveCleanupReason(record);

    summary.scannedProfiles += 1;
    if (record.hasAnyRobloxData) summary.profilesWithRobloxData += 1;

    if (!dryRun && shouldPersistEnsuredRobloxProfile(rawProfile, ensuredProfile, { persistSanitizedInvalidIds })) {
      profiles[userId] = ensuredProfile;
    }

    if (hadSanitizedUserId) {
      summary.sanitizedCount += 1;
      if (persistSanitizedInvalidIds && markDirty) markDirty(userId, "binding_sanitized");
      if (persistSanitizedInvalidIds && persistTrail && !dryRun) {
        recordRobloxCleanupOutcome(db, userId, "sanitized", {
          now: nowIso,
          source,
          reason: "invalid_user_id",
          robloxUsername: record.robloxUsername,
          robloxUserId: ensuredUserId,
        });
      }
    }

    if (candidateUserIds.has(userId)) {
      continue;
    }

    if (record.suggestedAction === "safe_repair") {
      summary.safeRepairCandidateCount += 1;
      const added = addUsernameRepairCandidate(candidatesByUsername, {
        userId,
        profile: ensuredProfile,
        record,
        reason,
        restoreSource: "safe_repair",
      });
      if (added) {
        candidateUserIds.add(userId);
      }
      continue;
    }

    if (record.suggestedAction === "manual_review") {
      if (record.suspiciousPollution) {
        const recoverableSubmission = recoverFromSubmissions
          ? findRecoverableRobloxSubmission(db, userId, ensuredProfile)
          : null;
        if (recoverableSubmission) {
          summary.submissionRestoreCandidateCount += 1;
          summary.restoredFromSubmissionCount += 1;
          if (!dryRun) {
            const submission = recoverableSubmission.submission;
            applyRobloxAccountSnapshot(ensuredProfile, recoverableSubmission.snapshot, {
              verificationStatus: submission.status === "approved" ? "verified" : "pending",
              verifiedAt: submission.status === "approved" ? submission.reviewedAt : null,
              updatedAt: nowIso,
              lastSubmissionId: submission.id,
              lastReviewedAt: submission.reviewedAt,
              reviewedBy: submission.reviewedBy,
              source: "submission_recovery",
            });
            profiles[userId] = ensureSharedProfile(ensuredProfile, userId).profile;
            if (markDirty) markDirty(userId, "binding_repaired");
            if (persistTrail) {
              recordRobloxCleanupOutcome(db, userId, "restored_from_submission", {
                now: nowIso,
                source,
                reason,
                robloxUsername: recoverableSubmission.snapshot.username,
                robloxUserId: recoverableSubmission.snapshot.userId,
              });
            }
          }
          continue;
        }

        if (fetchUsersByUsernames || !allowDestructiveSuspiciousReset) {
          const added = addUsernameRepairCandidate(candidatesByUsername, {
            userId,
            profile: ensuredProfile,
            record,
            reason,
            restoreSource: "suspicious_lookup",
            verificationStatus: ensuredProfile?.domains?.roblox?.verificationStatus,
            verifiedAt: ensuredProfile?.domains?.roblox?.verifiedAt,
          });
          if (added) {
            summary.safeRepairCandidateCount += 1;
            candidateUserIds.add(userId);
            continue;
          }
        }

        if (resetSuspiciousBindings && allowDestructiveSuspiciousReset) {
          summary.resetSuspiciousCount += 1;
          if (!dryRun) {
            resetSuspiciousRobloxBinding(ensuredProfile, {
              updatedAt: nowIso,
              source: "rebind_required",
            });
            profiles[userId] = ensureSharedProfile(ensuredProfile, userId).profile;
            if (markDirty) markDirty(userId, "binding_sanitized");
            if (persistTrail) {
              recordRobloxCleanupOutcome(db, userId, "reset_suspicious", {
                now: nowIso,
                source,
                reason,
                robloxUsername: record.robloxUsername,
                robloxUserId: record.robloxUserId,
              });
            }
          }
          continue;
        }

        summary.skippedSuspiciousCount += 1;
        if (persistTrail && !dryRun) {
          recordRobloxCleanupOutcome(db, userId, "skipped_suspicious", {
            now: nowIso,
            source,
            reason,
            robloxUsername: record.robloxUsername,
            robloxUserId: record.robloxUserId,
          });
        }
      } else {
        summary.rebindRequiredCount += 1;
        if (persistTrail && !dryRun) {
          recordRobloxCleanupOutcome(db, userId, "rebind_required", {
            now: nowIso,
            source,
            reason,
            robloxUsername: record.robloxUsername,
            robloxUserId: record.robloxUserId,
          });
        }
      }
      continue;
    }

    if (record.suggestedAction === "rebind_required") {
      summary.rebindRequiredCount += 1;
      if (persistTrail && !dryRun) {
        recordRobloxCleanupOutcome(db, userId, "rebind_required", {
          now: nowIso,
          source,
          reason,
          robloxUsername: record.robloxUsername,
          robloxUserId: record.robloxUserId,
        });
      }
      continue;
    }

    if (record.suggestedAction === "confirm_only") {
      summary.confirmOnlyCount += 1;
      if (persistTrail && !dryRun) {
        recordRobloxCleanupOutcome(db, userId, "confirm_only", {
          now: nowIso,
          source,
          reason,
          robloxUsername: record.robloxUsername,
          robloxUserId: record.robloxUserId,
        });
      }
    }
  }

  if (!candidatesByUsername.size || !fetchUsersByUsernames) {
    return summary;
  }

  for (const batchUsernames of splitIntoBatches([...candidatesByUsername.keys()], 100)) {
    try {
      const matches = await fetchUsersByUsernames(batchUsernames, {
        excludeBannedUsers: false,
      });
      const matchByUsername = new Map(
        (Array.isArray(matches) ? matches : [])
          .filter((entry) => entry?.userId && entry?.username)
          .map((entry) => [cleanString(entry.username, 120).toLowerCase(), entry])
      );

      for (const usernameKey of batchUsernames) {
        const candidates = candidatesByUsername.get(usernameKey) || [];
        const match = matchByUsername.get(usernameKey) || null;

        if (!match?.userId) {
          for (const candidate of candidates) {
            summary.unresolvedCount += 1;
            if (persistTrail && !dryRun) {
              recordRobloxCleanupOutcome(db, candidate.userId, "unresolved", {
                now: nowIso,
                source,
                reason: "lookup_not_found",
                robloxUsername: candidate.record.robloxUsername,
                robloxUserId: candidate.record.robloxUserId,
              });
            }
          }
          continue;
        }

        for (const candidate of candidates) {
          summary.repairedCount += 1;
          if (!dryRun) {
            applyRobloxAccountSnapshot(candidate.profile, match, {
              verificationStatus: candidate.verificationStatus || candidate.profile?.domains?.roblox?.verificationStatus,
              verifiedAt: candidate.verifiedAt || candidate.profile?.domains?.roblox?.verifiedAt,
              updatedAt: nowIso,
              lastSubmissionId: candidate.profile?.domains?.roblox?.lastSubmissionId,
              lastReviewedAt: candidate.profile?.domains?.roblox?.lastReviewedAt,
              reviewedBy: candidate.profile?.domains?.roblox?.reviewedBy,
              source: candidate.restoreSource === "cleanup_trail" ? "cleanup_trail_recovery" : candidate.profile?.domains?.roblox?.source,
              lastRefreshAt: candidate.profile?.domains?.roblox?.lastRefreshAt,
              refreshStatus: candidate.restoreSource === "cleanup_trail" ? null : candidate.profile?.domains?.roblox?.refreshStatus,
              refreshError: candidate.restoreSource === "cleanup_trail" ? null : candidate.profile?.domains?.roblox?.refreshError,
            });
            profiles[candidate.userId] = ensureSharedProfile(candidate.profile, candidate.userId).profile;
            if (markDirty) markDirty(candidate.userId, "binding_repaired");
          }
          if (candidate.restoreSource === "cleanup_trail") {
            summary.restoredFromCleanupTrailCount += 1;
          }
          if (persistTrail && !dryRun) {
            recordRobloxCleanupOutcome(db, candidate.userId, candidate.restoreSource === "cleanup_trail" ? "restored_from_cleanup_trail" : "repaired", {
              now: nowIso,
              source,
              reason: candidate.reason,
              robloxUsername: cleanString(match.username, 120),
              robloxUserId: cleanString(match.userId, 40),
            });
          }
        }
      }
    } catch (error) {
      summary.failedRepairBatchCount += 1;
      logError(`Roblox repair batch failed [${batchUsernames.join(",")}]:`, error?.message || error);
      for (const usernameKey of batchUsernames) {
        for (const candidate of candidatesByUsername.get(usernameKey) || []) {
          summary.unresolvedCount += 1;
          if (persistTrail && !dryRun) {
            recordRobloxCleanupOutcome(db, candidate.userId, "unresolved", {
              now: nowIso,
              source,
              reason: "lookup_error",
              robloxUsername: candidate.record.robloxUsername,
              robloxUserId: candidate.record.robloxUserId,
            });
          }
        }
      }
    }
  }

  return summary;
}

module.exports = {
  applyRobloxBindingRepairPass,
  ensureRobloxCleanupTrailState,
  getRobloxCleanupTrailEntry,
  recordRobloxCleanupOutcome,
};
