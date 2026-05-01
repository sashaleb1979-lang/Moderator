"use strict";

const SHARED_PROFILE_VERSION = 1;
const INTEGRATION_STATE_VERSION = 1;
const INTEGRATION_MODE_DORMANT = "dormant";
const INTEGRATION_STATUSES = new Set(["not_started", "in_progress", "migrated"]);

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function normalizeNullableString(value, limit = 2000) {
  const text = cleanString(value, limit);
  return text || null;
}

function normalizeStringArray(value, limit = 50, itemLimit = 120) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => cleanString(entry, itemLimit)).filter(Boolean))].slice(0, limit);
}

function normalizeNullableInteger(value, options = {}) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) return null;
  if (Number.isFinite(options.min) && amount < options.min) return null;
  if (Number.isFinite(options.max) && amount > options.max) return null;
  return amount;
}

function normalizePositiveNumber(value, fallback = 1) {
  if (value === null || value === undefined || value === "") return fallback;
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : fallback;
}

function normalizeOnboardingDomainState(profile = {}) {
  return {
    mainCharacterIds: normalizeStringArray(profile.mainCharacterIds, 10, 80),
    mainCharacterLabels: normalizeStringArray(profile.mainCharacterLabels, 10, 120),
    characterRoleIds: normalizeStringArray(profile.characterRoleIds, 20, 40),
    approvedKills: normalizeNullableInteger(profile.approvedKills, { min: 0 }),
    killTier: normalizeNullableInteger(profile.killTier, { min: 1, max: 5 }),
    accessGrantedAt: normalizeNullableString(profile.accessGrantedAt, 80),
    nonGgsAccessGrantedAt: normalizeNullableString(profile.nonGgsAccessGrantedAt, 80),
    nonGgsCaptchaPassedAt: normalizeNullableString(profile.nonGgsCaptchaPassedAt, 80),
    updatedAt: normalizeNullableString(profile.updatedAt, 80),
    lastSubmissionId: normalizeNullableString(profile.lastSubmissionId, 80),
    lastSubmissionStatus: normalizeNullableString(profile.lastSubmissionStatus, 40),
    lastReviewedAt: normalizeNullableString(profile.lastReviewedAt, 80),
  };
}

function normalizeEloDomainState(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    currentElo: normalizeNullableInteger(source.currentElo, { min: 0 }),
    currentTier: normalizeNullableInteger(source.currentTier, { min: 1, max: 5 }),
    proofUrl: normalizeNullableString(source.proofUrl, 1000),
    updatedAt: normalizeNullableString(source.updatedAt, 80),
    lastSubmissionId: normalizeNullableString(source.lastSubmissionId, 80),
    lastSubmissionStatus: normalizeNullableString(source.lastSubmissionStatus, 40),
    lastSubmissionCreatedAt: normalizeNullableString(source.lastSubmissionCreatedAt, 80),
    lastSubmissionElo: normalizeNullableInteger(source.lastSubmissionElo, { min: 0 }),
    lastSubmissionTier: normalizeNullableInteger(source.lastSubmissionTier, { min: 1, max: 5 }),
    lastReviewedAt: normalizeNullableString(source.lastReviewedAt, 80),
    reviewChannelId: normalizeNullableString(source.reviewChannelId, 40),
    reviewMessageId: normalizeNullableString(source.reviewMessageId, 40),
  };
}

function normalizeTierlistDomainState(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    mainId: normalizeNullableString(source.mainId, 80),
    mainName: normalizeNullableString(source.mainName, 120),
    submittedAt: normalizeNullableString(source.submittedAt, 80),
    lockUntil: normalizeNullableString(source.lockUntil, 80),
    influenceMultiplier: normalizePositiveNumber(source.influenceMultiplier, 1),
    influenceRoleId: normalizeNullableString(source.influenceRoleId, 40),
    dashboardSyncedAt: normalizeNullableString(source.dashboardSyncedAt, 80),
    summarySyncedAt: normalizeNullableString(source.summarySyncedAt, 80),
  };
}

function buildSharedProfileSummary(profile = {}, domains = {}) {
  const onboarding = domains.onboarding || normalizeOnboardingDomainState(profile);
  const elo = domains.elo || normalizeEloDomainState(profile?.domains?.elo);
  const tierlist = domains.tierlist || normalizeTierlistDomainState(profile?.domains?.tierlist);

  return {
    preferredDisplayName: cleanString(profile.displayName, 200) || cleanString(profile.username, 120) || cleanString(profile.userId, 80),
    onboarding: {
      hasAccess: Boolean(onboarding.accessGrantedAt || onboarding.nonGgsAccessGrantedAt),
      approvedKills: onboarding.approvedKills,
      killTier: onboarding.killTier,
      mainsCount: onboarding.mainCharacterIds.length,
      lastSubmissionStatus: onboarding.lastSubmissionStatus,
    },
    elo: {
      hasRating: Number.isSafeInteger(elo.currentElo) && elo.currentElo >= 0,
      currentElo: elo.currentElo,
      currentTier: elo.currentTier,
      lastSubmissionStatus: elo.lastSubmissionStatus,
    },
    tierlist: {
      hasSubmission: Boolean(tierlist.submittedAt),
      mainId: tierlist.mainId,
      mainName: tierlist.mainName,
      influenceMultiplier: tierlist.influenceMultiplier,
    },
  };
}

function ensureSharedProfile(profile = {}, userId = "") {
  const source = profile && typeof profile === "object" ? profile : {};
  const onboarding = normalizeOnboardingDomainState(source);
  const elo = normalizeEloDomainState(source?.domains?.elo);
  const tierlist = normalizeTierlistDomainState(source?.domains?.tierlist);

  const next = {
    ...source,
    sharedProfileVersion: SHARED_PROFILE_VERSION,
    userId: cleanString(source.userId || userId, 80),
    displayName: cleanString(source.displayName, 200),
    username: cleanString(source.username, 120),
    mainCharacterIds: onboarding.mainCharacterIds,
    mainCharacterLabels: onboarding.mainCharacterLabels,
    characterRoleIds: onboarding.characterRoleIds,
    approvedKills: onboarding.approvedKills,
    killTier: onboarding.killTier,
    accessGrantedAt: onboarding.accessGrantedAt,
    nonGgsAccessGrantedAt: onboarding.nonGgsAccessGrantedAt,
    nonGgsCaptchaPassedAt: onboarding.nonGgsCaptchaPassedAt,
    updatedAt: onboarding.updatedAt,
    lastSubmissionId: onboarding.lastSubmissionId,
    lastSubmissionStatus: onboarding.lastSubmissionStatus,
    lastReviewedAt: onboarding.lastReviewedAt,
    domains: {
      onboarding,
      elo,
      tierlist,
    },
  };
  next.summary = buildSharedProfileSummary(next, next.domains);

  return {
    profile: next,
    mutated: JSON.stringify(source) !== JSON.stringify(next),
  };
}

function syncSharedProfiles(db = {}) {
  const profiles = db && typeof db.profiles === "object" && !Array.isArray(db.profiles) ? db.profiles : {};
  const nextProfiles = {};
  let mutated = !db || typeof db !== "object" || !db.profiles || typeof db.profiles !== "object" || Array.isArray(db.profiles);

  for (const [userId, rawProfile] of Object.entries(profiles)) {
    const ensured = ensureSharedProfile(rawProfile, userId);
    nextProfiles[userId] = ensured.profile;
    mutated ||= ensured.mutated || ensured.profile.userId !== userId;
  }

  db.profiles = nextProfiles;
  return { mutated, profiles: nextProfiles };
}

function createDefaultIntegrationState() {
  return {
    integrationStateVersion: INTEGRATION_STATE_VERSION,
    elo: {
      mode: INTEGRATION_MODE_DORMANT,
      status: "not_started",
      sourcePath: "",
      lastImportAt: null,
      lastSyncAt: null,
      submitPanel: {
        channelId: "",
        messageId: "",
      },
      graphicBoard: {
        channelId: "",
        messageId: "",
        lastUpdated: null,
      },
    },
    tierlist: {
      mode: INTEGRATION_MODE_DORMANT,
      status: "not_started",
      sourcePath: "",
      lastImportAt: null,
      lastSyncAt: null,
      dashboard: {
        channelId: "",
        messageId: "",
        lastUpdated: null,
      },
      summary: {
        channelId: "",
        messageId: "",
        lastUpdated: null,
      },
    },
  };
}

function normalizeBoardState(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    channelId: cleanString(source.channelId, 40),
    messageId: cleanString(source.messageId, 40),
    lastUpdated: normalizeNullableString(source.lastUpdated, 80),
  };
}

function normalizeIntegrationState(value = {}) {
  const source = value && typeof value === "object" ? value : {};

  const eloStatus = cleanString(source?.elo?.status, 40);
  const tierlistStatus = cleanString(source?.tierlist?.status, 40);
  const next = {
    integrationStateVersion: INTEGRATION_STATE_VERSION,
    elo: {
      mode: INTEGRATION_MODE_DORMANT,
      status: INTEGRATION_STATUSES.has(eloStatus) ? eloStatus : "not_started",
      sourcePath: cleanString(source?.elo?.sourcePath, 500),
      lastImportAt: normalizeNullableString(source?.elo?.lastImportAt, 80),
      lastSyncAt: normalizeNullableString(source?.elo?.lastSyncAt, 80),
      submitPanel: {
        channelId: cleanString(source?.elo?.submitPanel?.channelId, 40),
        messageId: cleanString(source?.elo?.submitPanel?.messageId, 40),
      },
      graphicBoard: normalizeBoardState(source?.elo?.graphicBoard),
    },
    tierlist: {
      mode: INTEGRATION_MODE_DORMANT,
      status: INTEGRATION_STATUSES.has(tierlistStatus) ? tierlistStatus : "not_started",
      sourcePath: cleanString(source?.tierlist?.sourcePath, 500),
      lastImportAt: normalizeNullableString(source?.tierlist?.lastImportAt, 80),
      lastSyncAt: normalizeNullableString(source?.tierlist?.lastSyncAt, 80),
      dashboard: normalizeBoardState(source?.tierlist?.dashboard),
      summary: normalizeBoardState(source?.tierlist?.summary),
    },
  };

  return {
    integrations: next,
    mutated: JSON.stringify(source) !== JSON.stringify(next),
  };
}

module.exports = {
  INTEGRATION_MODE_DORMANT,
  SHARED_PROFILE_VERSION,
  createDefaultIntegrationState,
  ensureSharedProfile,
  normalizeIntegrationState,
  syncSharedProfiles,
};