"use strict";

const fs = require("fs");
const path = require("path");

const { ensureSharedProfile, normalizeIntegrationState } = require("./shared-profile");
const { writeNativeIntegrationSnapshot } = require("../sot/native-integrations");
const { resolveIntegrationRecord } = require("../sot/resolver/integrations");

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function normalizeNullableString(value, limit = 2000) {
  const text = cleanString(value, limit);
  return text || null;
}

function normalizeNullableInteger(value, options = {}) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) return null;
  if (Number.isFinite(options.min) && amount < options.min) return null;
  if (Number.isFinite(options.max) && amount > options.max) return null;
  return amount;
}

function normalizeIsoLike(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return new Date(value).toISOString();
  }

  const text = cleanString(value, 80);
  if (!text) return null;

  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : text;
}

function normalizeLegacyEloRating(rawValue = {}, fallbackUserId = "") {
  const source = rawValue && typeof rawValue === "object" ? rawValue : {};
  return {
    userId: cleanString(source.userId || fallbackUserId, 80),
    name: cleanString(source.name, 200),
    username: cleanString(source.username, 120),
    elo: normalizeNullableInteger(source.elo, { min: 0 }),
    tier: normalizeNullableInteger(source.tier, { min: 1, max: 5 }),
    proofUrl: normalizeNullableString(source.proofUrl, 1000),
    avatarUrl: normalizeNullableString(source.avatarUrl, 1000),
    updatedAt: normalizeIsoLike(source.updatedAt),
  };
}

function normalizeLegacyEloSubmission(rawValue = {}, fallbackId = "") {
  const source = rawValue && typeof rawValue === "object" ? rawValue : {};
  return {
    id: cleanString(source.id || fallbackId, 80),
    userId: cleanString(source.userId, 80),
    name: cleanString(source.name, 200),
    username: cleanString(source.username, 120),
    elo: normalizeNullableInteger(source.elo, { min: 0 }),
    tier: normalizeNullableInteger(source.tier, { min: 1, max: 5 }),
    screenshotUrl: normalizeNullableString(source.screenshotUrl, 1000),
    reviewAttachmentUrl: normalizeNullableString(source.reviewAttachmentUrl, 1000),
    status: cleanString(source.status, 40),
    createdAt: normalizeIsoLike(source.createdAt),
    reviewedAt: normalizeIsoLike(source.reviewedAt),
    reviewChannelId: normalizeNullableString(source.reviewChannelId, 40),
    reviewMessageId: normalizeNullableString(source.reviewMessageId, 40),
    reviewedBy: normalizeNullableString(source.reviewedBy, 120),
    rejectReason: normalizeNullableString(source.rejectReason, 800),
  };
}

function normalizeLegacyEloDb(rawValue = {}) {
  const source = rawValue && typeof rawValue === "object" ? rawValue : {};
  const rawConfig = source.config && typeof source.config === "object" ? source.config : {};
  const rawRatings = source.ratings && typeof source.ratings === "object" ? source.ratings : {};
  const rawSubmissions = source.submissions && typeof source.submissions === "object" ? source.submissions : {};

  const ratings = {};
  for (const [userId, rawRating] of Object.entries(rawRatings)) {
    const rating = normalizeLegacyEloRating(rawRating, userId);
    if (!rating.userId) continue;
    ratings[rating.userId] = rating;
  }

  const submissions = {};
  for (const [submissionId, rawSubmission] of Object.entries(rawSubmissions)) {
    const submission = normalizeLegacyEloSubmission(rawSubmission, submissionId);
    if (!submission.id || !submission.userId) continue;
    submissions[submission.id] = submission;
  }

  return {
    config: {
      submitPanel: {
        channelId: cleanString(rawConfig?.submitPanel?.channelId, 40),
        messageId: cleanString(rawConfig?.submitPanel?.messageId, 40),
      },
      graphicTierlist: {
        dashboardChannelId: cleanString(rawConfig?.graphicTierlist?.dashboardChannelId, 40),
        dashboardMessageId: cleanString(rawConfig?.graphicTierlist?.dashboardMessageId, 40),
        lastUpdated: normalizeIsoLike(rawConfig?.graphicTierlist?.lastUpdated),
      },
    },
    ratings,
    submissions,
  };
}

function getSubmissionSortKey(submission) {
  return Date.parse(submission?.reviewedAt || submission?.createdAt || 0) || 0;
}

function buildLatestSubmissionMap(submissions = {}) {
  const latestByUserId = new Map();

  for (const submission of Object.values(submissions || {})) {
    const userId = cleanString(submission?.userId, 80);
    if (!userId) continue;

    const current = latestByUserId.get(userId);
    if (!current || getSubmissionSortKey(submission) > getSubmissionSortKey(current)) {
      latestByUserId.set(userId, submission);
    }
  }

  return latestByUserId;
}

function buildDormantEloDomainState(rating = null, latestSubmission = null) {
  return {
    currentElo: normalizeNullableInteger(rating?.elo, { min: 0 }),
    currentTier: normalizeNullableInteger(rating?.tier, { min: 1, max: 5 }),
    proofUrl: normalizeNullableString(rating?.proofUrl || latestSubmission?.reviewAttachmentUrl || latestSubmission?.screenshotUrl, 1000),
    updatedAt: normalizeIsoLike(rating?.updatedAt),
    lastSubmissionId: normalizeNullableString(latestSubmission?.id, 80),
    lastSubmissionStatus: normalizeNullableString(latestSubmission?.status, 40),
    lastSubmissionCreatedAt: normalizeIsoLike(latestSubmission?.createdAt),
    lastSubmissionElo: normalizeNullableInteger(latestSubmission?.elo, { min: 0 }),
    lastSubmissionTier: normalizeNullableInteger(latestSubmission?.tier, { min: 1, max: 5 }),
    lastReviewedAt: normalizeIsoLike(latestSubmission?.reviewedAt),
    reviewChannelId: normalizeNullableString(latestSubmission?.reviewChannelId, 40),
    reviewMessageId: normalizeNullableString(latestSubmission?.reviewMessageId, 40),
  };
}

function applyDormantEloSync(db, legacyEloDb, options = {}) {
  if (!db || typeof db !== "object") throw new Error("Moderator db is required");

  const syncedAt = normalizeIsoLike(options.syncedAt) || new Date().toISOString();
  const sourcePath = cleanString(options.sourcePath, 500);
  const normalized = normalizeLegacyEloDb(legacyEloDb);
  const latestSubmissionByUserId = buildLatestSubmissionMap(normalized.submissions);
  const userIds = new Set([
    ...Object.keys(normalized.ratings || {}),
    ...latestSubmissionByUserId.keys(),
  ]);

  db.config ||= {};
  const normalizedIntegrations = normalizeIntegrationState(db.config.integrations);
  db.config.integrations = normalizedIntegrations.integrations;
  db.profiles ||= {};
  const currentIntegration = resolveIntegrationRecord({ slot: "elo", db });

  const eloState = {
    ...currentIntegration,
    sourcePath: sourcePath || currentIntegration.sourcePath || "",
    status: sourcePath || userIds.size ? "in_progress" : currentIntegration.status,
    lastImportAt: syncedAt,
    lastSyncAt: syncedAt,
    submitPanel: { ...normalized.config.submitPanel },
    graphicBoard: {
      channelId: normalized.config.graphicTierlist.dashboardChannelId,
      messageId: normalized.config.graphicTierlist.dashboardMessageId,
      lastUpdated: normalized.config.graphicTierlist.lastUpdated,
    },
  };
  writeNativeIntegrationSnapshot(db, { slot: "elo", patch: eloState });

  let mutated = normalizedIntegrations.mutated;
  let syncedProfiles = 0;
  let clearedProfiles = 0;

  for (const userId of userIds) {
    const rating = normalized.ratings[userId] || null;
    const latestSubmission = latestSubmissionByUserId.get(userId) || null;
    const existing = db.profiles[userId] || { userId };

    const nextProfile = {
      ...existing,
      userId,
      displayName: cleanString(existing.displayName, 200) || cleanString(rating?.name || latestSubmission?.name, 200),
      username: cleanString(existing.username, 120) || cleanString(rating?.username || latestSubmission?.username, 120),
      domains: {
        ...(existing.domains || {}),
        elo: buildDormantEloDomainState(rating, latestSubmission),
      },
    };

    const ensured = ensureSharedProfile(nextProfile, userId);
    mutated ||= JSON.stringify(existing) !== JSON.stringify(ensured.profile);
    db.profiles[userId] = ensured.profile;
    syncedProfiles += 1;
  }

  for (const [userId, existing] of Object.entries(db.profiles || {})) {
    if (userIds.has(userId)) continue;
    if (!existing?.domains?.elo) continue;

    const cleared = {
      ...existing,
      domains: {
        ...(existing.domains || {}),
        elo: {},
      },
    };
    const ensured = ensureSharedProfile(cleared, userId);
    mutated ||= JSON.stringify(existing) !== JSON.stringify(ensured.profile);
    db.profiles[userId] = ensured.profile;
    clearedProfiles += 1;
  }

  return {
    mutated,
    syncedProfiles,
    clearedProfiles,
    importedUserCount: userIds.size,
    submitPanelChannelId: eloState.submitPanel.channelId,
    graphicBoardChannelId: eloState.graphicBoard.channelId,
  };
}

function clearDormantEloSync(db, options = {}) {
  if (!db || typeof db !== "object") throw new Error("Moderator db is required");

  const syncedAt = normalizeIsoLike(options.syncedAt) || new Date().toISOString();
  const sourcePath = cleanString(options.sourcePath, 500);

  db.config ||= {};
  const normalizedIntegrations = normalizeIntegrationState(db.config.integrations);
  db.config.integrations = normalizedIntegrations.integrations;
  db.profiles ||= {};
  const currentIntegration = resolveIntegrationRecord({ slot: "elo", db });

  const eloState = {
    ...currentIntegration,
    sourcePath,
    status: sourcePath ? currentIntegration.status : "not_started",
    lastSyncAt: syncedAt,
  };

  if (!sourcePath) {
    eloState.lastImportAt = null;
    eloState.submitPanel = { channelId: "", messageId: "" };
    eloState.graphicBoard = { channelId: "", messageId: "", lastUpdated: null };
  }

  writeNativeIntegrationSnapshot(db, { slot: "elo", patch: eloState });

  let mutated = normalizedIntegrations.mutated;
  let clearedProfiles = 0;

  for (const [userId, existing] of Object.entries(db.profiles || {})) {
    if (!existing?.domains?.elo) continue;

    const cleared = {
      ...existing,
      domains: {
        ...(existing.domains || {}),
        elo: {},
      },
    };
    const ensured = ensureSharedProfile(cleared, userId);
    mutated ||= JSON.stringify(existing) !== JSON.stringify(ensured.profile);
    db.profiles[userId] = ensured.profile;
    clearedProfiles += 1;
  }

  return {
    mutated,
    clearedProfiles,
  };
}

function importDormantEloSyncFromFile(db, options = {}) {
  const rawSourcePath = cleanString(options.sourcePath, 500);
  if (!rawSourcePath) {
    return {
      mutated: false,
      imported: false,
      sourcePath: "",
      resolvedPath: "",
      error: null,
    };
  }

  const baseDir = cleanString(options.baseDir, 2000) || process.cwd();
  const resolvedPath = path.isAbsolute(rawSourcePath)
    ? rawSourcePath
    : path.resolve(baseDir, rawSourcePath);

  if (!fs.existsSync(resolvedPath)) {
    return {
      mutated: false,
      imported: false,
      sourcePath: rawSourcePath,
      resolvedPath,
      error: null,
    };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
    const syncResult = applyDormantEloSync(db, raw, {
      sourcePath: rawSourcePath,
      syncedAt: options.syncedAt,
    });
    return {
      ...syncResult,
      imported: true,
      sourcePath: rawSourcePath,
      resolvedPath,
      error: null,
    };
  } catch (error) {
    return {
      mutated: false,
      imported: false,
      sourcePath: rawSourcePath,
      resolvedPath,
      error: String(error?.message || error),
    };
  }
}

module.exports = {
  applyDormantEloSync,
  buildLatestSubmissionMap,
  clearDormantEloSync,
  importDormantEloSyncFromFile,
  normalizeLegacyEloDb,
};