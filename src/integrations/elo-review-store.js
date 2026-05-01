"use strict";

const fs = require("fs");
const path = require("path");

const LEGACY_ELO_PENDING_EXPIRE_HOURS = 48;
const LEGACY_ELO_MIN_VALUE = 10;

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

function parseLegacyElo(text) {
  if (text === null || text === undefined) return null;
  const match = String(text).match(/(\d{1,4})\+?/);
  if (!match) return null;
  const amount = Number(match[1]);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function tierForLegacyElo(value) {
  const elo = normalizeNullableInteger(value, { min: LEGACY_ELO_MIN_VALUE });
  if (!elo) return null;
  if (elo >= 110) return 5;
  if (elo >= 70) return 4;
  if (elo >= 40) return 3;
  if (elo >= 20) return 2;
  if (elo >= 10) return 1;
  return null;
}

function getLegacyEloSortKey(value) {
  return Date.parse(String(value || "")) || 0;
}

function resolveLegacyEloDbPath(baseDir, rawSourcePath) {
  const sourcePath = cleanString(rawSourcePath, 500);
  if (!sourcePath) return "";
  const normalizedBaseDir = cleanString(baseDir, 2000) || process.cwd();
  return path.isAbsolute(sourcePath) ? sourcePath : path.resolve(normalizedBaseDir, sourcePath);
}

function ensureLegacyEloDbShape(rawValue = {}) {
  const source = rawValue && typeof rawValue === "object" ? rawValue : {};
  source.config ||= {};
  source.submissions ||= {};
  source.ratings ||= {};
  source.cooldowns ||= {};
  source.miniCards ||= {};
  return source;
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
    reviewImage: normalizeNullableString(source.reviewImage, 1000),
    reviewFileName: normalizeNullableString(source.reviewFileName, 240),
    messageUrl: normalizeNullableString(source.messageUrl, 1000),
    status: cleanString(source.status, 40),
    createdAt: normalizeIsoLike(source.createdAt),
    reviewedAt: normalizeIsoLike(source.reviewedAt),
    reviewedBy: normalizeNullableString(source.reviewedBy, 120),
    rejectReason: normalizeNullableString(source.rejectReason, 800),
    reviewChannelId: normalizeNullableString(source.reviewChannelId, 40),
    reviewMessageId: normalizeNullableString(source.reviewMessageId, 40),
    reviewAttachmentUrl: normalizeNullableString(source.reviewAttachmentUrl, 1000),
    manual: Boolean(source.manual),
  };
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

function getLegacyEloRating(rawDb, userId) {
  const db = ensureLegacyEloDbShape(rawDb);
  const targetUserId = cleanString(userId, 80);
  if (!targetUserId || !db.ratings[targetUserId]) return null;
  return normalizeLegacyEloRating(db.ratings[targetUserId], targetUserId);
}

function loadLegacyEloDbFile(options = {}) {
  const sourcePath = cleanString(options.sourcePath, 500);
  if (!sourcePath) {
    return {
      ok: false,
      sourcePath: "",
      resolvedPath: "",
      error: "ELO sourcePath is not configured",
      rawDb: null,
    };
  }

  const resolvedPath = resolveLegacyEloDbPath(options.baseDir, sourcePath);
  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    return {
      ok: false,
      sourcePath,
      resolvedPath,
      error: `Legacy ELO db file not found: ${resolvedPath || sourcePath}`,
      rawDb: null,
    };
  }

  try {
    const rawDb = ensureLegacyEloDbShape(JSON.parse(fs.readFileSync(resolvedPath, "utf8")));
    return {
      ok: true,
      sourcePath,
      resolvedPath,
      error: null,
      rawDb,
    };
  } catch (error) {
    return {
      ok: false,
      sourcePath,
      resolvedPath,
      error: String(error?.message || error),
      rawDb: null,
    };
  }
}

function saveLegacyEloDbFile(filePath, rawDb) {
  const resolvedPath = cleanString(filePath, 2000);
  if (!resolvedPath) throw new Error("Legacy ELO db path is required");
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, JSON.stringify(ensureLegacyEloDbShape(rawDb), null, 2), "utf8");
  return resolvedPath;
}

function getLegacyEloSubmission(rawDb, submissionId) {
  const db = ensureLegacyEloDbShape(rawDb);
  const id = cleanString(submissionId, 80);
  if (!id || !db.submissions[id]) return null;
  return normalizeLegacyEloSubmission(db.submissions[id], id);
}

function listLegacyEloPendingSubmissions(rawDb, options = {}) {
  const db = ensureLegacyEloDbShape(rawDb);
  const limit = Math.max(0, Number(options.limit) || 15);
  return Object.entries(db.submissions || {})
    .map(([submissionId, submission]) => normalizeLegacyEloSubmission(submission, submissionId))
    .filter((submission) => submission.status === "pending")
    .sort((left, right) => getLegacyEloSortKey(right.createdAt) - getLegacyEloSortKey(left.createdAt))
    .slice(0, limit);
}

function isLegacyEloSubmissionExpired(submission, options = {}) {
  const expiresInHours = Number(options.pendingExpireHours) || LEGACY_ELO_PENDING_EXPIRE_HOURS;
  const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
  const createdAtMs = Date.parse(String(submission?.createdAt || "")) || 0;
  if (!createdAtMs) return false;
  return ((nowMs - createdAtMs) / (60 * 60 * 1000)) > expiresInHours;
}

function getMutableLegacyEloSubmission(db, submissionId) {
  const id = cleanString(submissionId, 80);
  if (!id) throw new Error("Submission ID is required");
  const submission = db.submissions[id];
  if (!submission || typeof submission !== "object") {
    throw new Error(`Legacy ELO submission not found: ${id}`);
  }
  return { id, submission };
}

function approveLegacyEloSubmission(rawDb, submissionId, options = {}) {
  const db = ensureLegacyEloDbShape(rawDb);
  const { id, submission } = getMutableLegacyEloSubmission(db, submissionId);
  const nextElo = normalizeNullableInteger(submission.elo, { min: LEGACY_ELO_MIN_VALUE });
  const nextTier = tierForLegacyElo(nextElo);
  if (!nextElo || !nextTier) throw new Error(`Legacy ELO submission ${id} has invalid ELO`);

  const reviewedAt = normalizeIsoLike(options.reviewedAt) || new Date().toISOString();
  const reviewedBy = cleanString(options.reviewedBy, 120);
  const previousRating = db.ratings[submission.userId] && typeof db.ratings[submission.userId] === "object"
    ? db.ratings[submission.userId]
    : { userId: submission.userId };

  submission.elo = nextElo;
  submission.tier = nextTier;
  submission.status = "approved";
  submission.reviewedBy = reviewedBy;
  submission.reviewedAt = reviewedAt;
  submission.rejectReason = null;

  db.ratings[submission.userId] = {
    ...previousRating,
    userId: cleanString(submission.userId, 80),
    name: cleanString(options.displayName || submission.name || previousRating.name, 200),
    username: cleanString(options.username || submission.username || previousRating.username, 120),
    elo: nextElo,
    tier: nextTier,
    proofUrl: cleanString(submission.reviewAttachmentUrl || submission.screenshotUrl || previousRating.proofUrl, 1000),
    avatarUrl: cleanString(options.avatarUrl || previousRating.avatarUrl, 1000),
    updatedAt: reviewedAt,
  };

  return {
    db,
    submission: normalizeLegacyEloSubmission(submission, id),
    rating: normalizeLegacyEloRating(db.ratings[submission.userId], submission.userId),
  };
}

function editLegacyEloSubmission(rawDb, submissionId, nextEloInput) {
  const db = ensureLegacyEloDbShape(rawDb);
  const { id, submission } = getMutableLegacyEloSubmission(db, submissionId);
  const nextElo = typeof nextEloInput === "number"
    ? normalizeNullableInteger(nextEloInput, { min: LEGACY_ELO_MIN_VALUE })
    : parseLegacyElo(nextEloInput);
  const nextTier = tierForLegacyElo(nextElo);
  if (!nextElo || !nextTier) throw new Error("Legacy ELO value is invalid");

  submission.elo = nextElo;
  submission.tier = nextTier;

  return {
    db,
    submission: normalizeLegacyEloSubmission(submission, id),
  };
}

function rejectLegacyEloSubmission(rawDb, submissionId, options = {}) {
  const db = ensureLegacyEloDbShape(rawDb);
  const { id, submission } = getMutableLegacyEloSubmission(db, submissionId);
  const reviewedAt = normalizeIsoLike(options.reviewedAt) || new Date().toISOString();

  submission.status = "rejected";
  submission.reviewedBy = cleanString(options.reviewedBy, 120);
  submission.reviewedAt = reviewedAt;
  submission.rejectReason = cleanString(options.reason, 800);

  return {
    db,
    submission: normalizeLegacyEloSubmission(submission, id),
  };
}

function expireLegacyEloSubmission(rawDb, submissionId, options = {}) {
  const db = ensureLegacyEloDbShape(rawDb);
  const { id, submission } = getMutableLegacyEloSubmission(db, submissionId);
  submission.status = "expired";
  submission.reviewedAt = normalizeIsoLike(options.reviewedAt) || new Date().toISOString();

  return {
    db,
    submission: normalizeLegacyEloSubmission(submission, id),
  };
}

function removeLegacyEloRating(rawDb, userId) {
  const db = ensureLegacyEloDbShape(rawDb);
  const targetUserId = cleanString(userId, 80);
  if (!targetUserId) throw new Error("User ID is required");

  const existingRating = db.ratings[targetUserId] && typeof db.ratings[targetUserId] === "object"
    ? db.ratings[targetUserId]
    : null;
  if (!existingRating) {
    return {
      db,
      removed: false,
      removedRating: null,
      removedMiniCardId: null,
      removedCardMessageId: null,
    };
  }

  const removedMiniCardId = cleanString(db.miniCards?.[targetUserId], 80) || null;
  const removedCardMessageId = cleanString(existingRating.cardMessageId, 80) || null;
  const removedRating = normalizeLegacyEloRating(existingRating, targetUserId);

  delete db.ratings[targetUserId];
  if (db.miniCards && Object.prototype.hasOwnProperty.call(db.miniCards, targetUserId)) {
    delete db.miniCards[targetUserId];
  }

  return {
    db,
    removed: true,
    removedRating,
    removedMiniCardId,
    removedCardMessageId,
  };
}

function wipeLegacyEloRatings(rawDb, options = {}) {
  const db = ensureLegacyEloDbShape(rawDb);
  const mode = cleanString(options.mode, 20) || "soft";
  if (!["soft", "hard"].includes(mode)) throw new Error("Wipe mode must be soft or hard");

  const ratings = Object.entries(db.ratings || {});
  const removedUserIds = ratings.map(([userId]) => userId);
  const removedRatings = ratings.length;
  const removedMiniCards = Object.keys(db.miniCards || {}).length;

  let clearedCardLinks = 0;
  let clearedIndexLink = false;
  if (mode === "hard") {
    for (const [, rating] of ratings) {
      if (!rating || !Object.prototype.hasOwnProperty.call(rating, "cardMessageId")) continue;
      if (rating.cardMessageId) clearedCardLinks += 1;
      delete rating.cardMessageId;
    }
    if (db.config?.indexMessageId) {
      db.config.indexMessageId = "";
      clearedIndexLink = true;
    }
  }

  db.miniCards = {};
  db.ratings = {};

  return {
    db,
    mode,
    removedRatings,
    removedMiniCards,
    removedUserIds,
    cleanup: {
      clearedCardLinks,
      clearedIndexLink,
    },
  };
}

function rebuildLegacyEloRatings(rawDb, options = {}) {
  const db = ensureLegacyEloDbShape(rawDb);
  const rebuiltAt = normalizeIsoLike(options.rebuiltAt) || new Date().toISOString();
  const ratings = Object.entries(db.ratings || {});

  let total = 0;
  let retiered = 0;
  let hidden = 0;
  let clearedCards = 0;
  let clearedIndexLink = false;

  if (db.config?.indexMessageId) {
    db.config.indexMessageId = "";
    clearedIndexLink = true;
  }

  for (const [userId, rating] of ratings) {
    if (!rating || typeof rating !== "object") continue;
    total += 1;

    const elo = normalizeNullableInteger(rating.elo, { min: 0 }) || 0;
    const prevTier = normalizeNullableInteger(rating.tier, { min: 1, max: 5 });
    const nextTier = tierForLegacyElo(elo);

    if (Object.prototype.hasOwnProperty.call(rating, "cardMessageId")) {
      if (cleanString(rating.cardMessageId, 80)) clearedCards += 1;
      delete rating.cardMessageId;
    }

    if (prevTier !== nextTier) retiered += 1;
    if (!nextTier) hidden += 1;

    rating.userId = cleanString(rating.userId || userId, 80);
    rating.tier = nextTier;
    rating.updatedAt = rebuiltAt;
  }

  return {
    db,
    total,
    retiered,
    hidden,
    rolesSynced: 0,
    rebuiltAt,
    cleanup: {
      clearedCards,
      clearedIndexLink,
    },
  };
}

function makeLegacyEloSubmissionId(options = {}) {
  const explicit = cleanString(options.submissionId, 80);
  if (explicit) return explicit;

  const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
  return `${nowMs.toString(36)}${Math.random().toString(36).slice(2, 10)}`.toUpperCase();
}

function supersedeLegacyEloPendingSubmissions(rawDb, userId, options = {}) {
  const db = ensureLegacyEloDbShape(rawDb);
  const targetUserId = cleanString(userId, 80);
  if (!targetUserId) throw new Error("User ID is required");

  const reviewedAt = normalizeIsoLike(options.reviewedAt) || new Date().toISOString();
  const reviewedBy = cleanString(options.reviewedBy, 120);
  const reason = cleanString(options.reason, 800) || "Добавлено/обновлено модератором напрямую";
  const changedIds = [];

  for (const [submissionId, submission] of Object.entries(db.submissions || {})) {
    if (!submission || typeof submission !== "object") continue;
    if (cleanString(submission.userId, 80) !== targetUserId) continue;
    if (cleanString(submission.status, 40) !== "pending") continue;

    submission.status = "superseded";
    submission.reviewedBy = reviewedBy;
    submission.reviewedAt = reviewedAt;
    submission.rejectReason = reason;
    changedIds.push(submissionId);
  }

  return {
    db,
    changed: changedIds.length,
    changedIds,
    reviewedAt,
    reviewedBy,
    reason,
  };
}

function upsertDirectLegacyEloRating(rawDb, options = {}) {
  const db = ensureLegacyEloDbShape(rawDb);
  const userId = cleanString(options.userId, 80);
  if (!userId) throw new Error("User ID is required");

  const nextElo = typeof options.elo === "number"
    ? normalizeNullableInteger(options.elo, { min: LEGACY_ELO_MIN_VALUE })
    : parseLegacyElo(options.rawText);
  const nextTier = tierForLegacyElo(nextElo);
  if (!nextElo || !nextTier) throw new Error("Legacy ELO value is invalid");

  const screenshotUrl = cleanString(options.screenshotUrl, 1000);
  if (!screenshotUrl) throw new Error("Screenshot URL is required");

  const createdAt = normalizeIsoLike(options.createdAt) || new Date().toISOString();
  const reviewedAt = normalizeIsoLike(options.reviewedAt) || createdAt;
  const reviewedBy = cleanString(options.reviewedBy, 120);
  const previousRating = db.ratings[userId] && typeof db.ratings[userId] === "object"
    ? db.ratings[userId]
    : { userId };

  const superseded = supersedeLegacyEloPendingSubmissions(db, userId, {
    reviewedAt,
    reviewedBy,
    reason: cleanString(options.supersedeReason, 800) || "Добавлено/обновлено модератором напрямую",
  });

  const submissionId = makeLegacyEloSubmissionId(options);
  const submission = {
    id: submissionId,
    userId,
    name: cleanString(options.displayName || previousRating.name, 200),
    username: cleanString(options.username || previousRating.username, 120),
    elo: nextElo,
    tier: nextTier,
    screenshotUrl,
    reviewImage: cleanString(options.reviewImage || screenshotUrl, 1000),
    reviewFileName: normalizeNullableString(options.reviewFileName, 240),
    messageUrl: cleanString(options.messageUrl || screenshotUrl, 1000),
    status: "approved",
    createdAt,
    reviewedAt,
    reviewedBy,
    rejectReason: null,
    reviewChannelId: normalizeNullableString(options.reviewChannelId, 40),
    reviewMessageId: normalizeNullableString(options.reviewMessageId, 40),
    reviewAttachmentUrl: normalizeNullableString(options.reviewAttachmentUrl, 1000),
    manual: true,
  };

  db.submissions[submissionId] = submission;
  db.ratings[userId] = {
    ...previousRating,
    userId,
    name: cleanString(options.displayName || previousRating.name, 200),
    username: cleanString(options.username || previousRating.username, 120),
    elo: nextElo,
    tier: nextTier,
    proofUrl: cleanString(submission.reviewAttachmentUrl || screenshotUrl || previousRating.proofUrl, 1000),
    avatarUrl: cleanString(options.avatarUrl || previousRating.avatarUrl, 1000),
    updatedAt: reviewedAt,
  };

  return {
    db,
    supersededCount: superseded.changed,
    supersededSubmissionIds: superseded.changedIds,
    submission: normalizeLegacyEloSubmission(submission, submissionId),
    rating: normalizeLegacyEloRating(db.ratings[userId], userId),
  };
}

function attachLegacyEloReviewRecord(rawDb, submissionId, options = {}) {
  const db = ensureLegacyEloDbShape(rawDb);
  const submission = getMutableLegacyEloSubmission(db, submissionId).submission;
  const userId = cleanString(submission.userId, 80);

  submission.reviewChannelId = normalizeNullableString(options.reviewChannelId, 40);
  submission.reviewMessageId = normalizeNullableString(options.reviewMessageId, 40);
  submission.reviewAttachmentUrl = normalizeNullableString(options.reviewAttachmentUrl, 1000);
  submission.reviewImage = normalizeNullableString(options.reviewImage, 1000)
    || submission.reviewAttachmentUrl
    || submission.reviewImage
    || submission.screenshotUrl;

  const rating = db.ratings[userId] && typeof db.ratings[userId] === "object"
    ? db.ratings[userId]
    : null;
  if (rating && submission.reviewAttachmentUrl) {
    rating.proofUrl = submission.reviewAttachmentUrl;
    rating.updatedAt = normalizeIsoLike(options.updatedAt) || normalizeIsoLike(submission.reviewedAt) || rating.updatedAt || new Date().toISOString();
  }

  return {
    db,
    submission: normalizeLegacyEloSubmission(submission, submissionId),
    rating: rating ? normalizeLegacyEloRating(rating, userId) : null,
  };
}

module.exports = {
  attachLegacyEloReviewRecord,
  LEGACY_ELO_MIN_VALUE,
  LEGACY_ELO_PENDING_EXPIRE_HOURS,
  approveLegacyEloSubmission,
  editLegacyEloSubmission,
  ensureLegacyEloDbShape,
  expireLegacyEloSubmission,
  getLegacyEloRating,
  getLegacyEloSubmission,
  isLegacyEloSubmissionExpired,
  listLegacyEloPendingSubmissions,
  loadLegacyEloDbFile,
  normalizeLegacyEloRating,
  normalizeLegacyEloSubmission,
  parseLegacyElo,
  rebuildLegacyEloRatings,
  removeLegacyEloRating,
  rejectLegacyEloSubmission,
  resolveLegacyEloDbPath,
  saveLegacyEloDbFile,
  supersedeLegacyEloPendingSubmissions,
  tierForLegacyElo,
  upsertDirectLegacyEloRating,
  wipeLegacyEloRatings,
};