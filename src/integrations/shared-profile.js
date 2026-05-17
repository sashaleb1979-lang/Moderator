"use strict";

const { normalizeNewsState } = require("../news/state");

const SHARED_PROFILE_VERSION = 3;
const INTEGRATION_STATE_VERSION = 1;
const INTEGRATION_MODE_DORMANT = "dormant";
const INTEGRATION_STATUSES = new Set(["not_started", "in_progress", "migrated"]);
const ROBLOX_VERIFICATION_STATUSES = new Set(["unverified", "pending", "verified", "failed"]);
const ROBLOX_ACCOUNT_STATUSES = new Set(["active", "banned-or-unavailable", "lookup-failed"]);
const ROBLOX_NAME_HISTORY_LIMIT = 20;
const ROBLOX_SERVER_FRIEND_LIMIT = 500;
const ROBLOX_COPLAY_PEER_LIMIT = 50;
const ROBLOX_TOP_COPLAY_PEER_LIMIT = 5;
const ROBLOX_FREQUENT_NON_FRIEND_MINUTES = 60;
const ROBLOX_FREQUENT_NON_FRIEND_SESSIONS = 2;
const ROBLOX_PLAYTIME_BUCKET_LIMIT = 40;
const ROBLOX_PLAYTIME_HOURLY_BUCKET_LIMIT = ROBLOX_PLAYTIME_BUCKET_LIMIT * 24;
const PROFILE_PROOF_WINDOW_LIMIT = 10;
const PROFILE_VOICE_TOP_CHANNEL_LIMIT = 10;
const PROFILE_SOCIAL_SUGGESTION_LIMIT = 10;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const sharedProfileRuntimeConfig = {
  frequentNonFriendMinutes: ROBLOX_FREQUENT_NON_FRIEND_MINUTES,
  frequentNonFriendSessions: ROBLOX_FREQUENT_NON_FRIEND_SESSIONS,
};

function cloneValue(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function normalizeNullableString(value, limit = 2000) {
  const text = cleanString(value, limit);
  return text || null;
}

function normalizeNullableBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

function normalizeStringArray(value, limit = 50, itemLimit = 120) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => cleanString(entry, itemLimit)).filter(Boolean))].slice(0, limit);
}

function captureRawStringArray(value, limit = 50, itemLimit = 120) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => cleanString(entry, itemLimit)).filter(Boolean).slice(0, limit);
}

function normalizeOnboardingRawSnapshot(source = {}, existingRaw = {}) {
  const persisted = existingRaw && typeof existingRaw === "object" && !Array.isArray(existingRaw)
    ? existingRaw
    : {};

  return {
    mainCharacterIds: Array.isArray(persisted.mainCharacterIds)
      ? captureRawStringArray(persisted.mainCharacterIds, 20, 80)
      : captureRawStringArray(source.mainCharacterIds, 20, 80),
    mainCharacterLabels: Array.isArray(persisted.mainCharacterLabels)
      ? captureRawStringArray(persisted.mainCharacterLabels, 20, 120)
      : captureRawStringArray(source.mainCharacterLabels, 20, 120),
    characterRoleIds: Array.isArray(persisted.characterRoleIds)
      ? captureRawStringArray(persisted.characterRoleIds, 40, 40)
      : captureRawStringArray(source.characterRoleIds, 40, 40),
  };
}

function normalizeNullableInteger(value, options = {}) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) return null;
  if (Number.isFinite(options.min) && amount < options.min) return null;
  if (Number.isFinite(options.max) && amount > options.max) return null;
  return amount;
}

function normalizeNullableNumber(value, options = {}) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  if (Number.isFinite(options.min) && amount < options.min) return null;
  if (Number.isFinite(options.max) && amount > options.max) return null;
  return amount;
}

function normalizePositiveNumber(value, fallback = 1) {
  if (value === null || value === undefined || value === "") return fallback;
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : fallback;
}

function normalizeNonNegativeInteger(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : fallback;
}

function configureSharedProfileRuntime(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const roblox = source.roblox && typeof source.roblox === "object" ? source.roblox : {};

  sharedProfileRuntimeConfig.frequentNonFriendMinutes = normalizeNonNegativeInteger(
    roblox.frequentNonFriendMinutes,
    ROBLOX_FREQUENT_NON_FRIEND_MINUTES
  );
  sharedProfileRuntimeConfig.frequentNonFriendSessions = normalizeNonNegativeInteger(
    roblox.frequentNonFriendSessions,
    ROBLOX_FREQUENT_NON_FRIEND_SESSIONS
  );

  return {
    roblox: {
      frequentNonFriendMinutes: sharedProfileRuntimeConfig.frequentNonFriendMinutes,
      frequentNonFriendSessions: sharedProfileRuntimeConfig.frequentNonFriendSessions,
    },
  };
}

function normalizeOnboardingDomainState(profile = {}) {
  const raw = normalizeOnboardingRawSnapshot(profile, profile?.domains?.onboarding?.raw);
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
    raw,
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

function normalizeActivityDomainState(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    baseActivityScore: normalizeNullableInteger(source.baseActivityScore, { min: 0 }),
    activityScore: normalizeNullableInteger(source.activityScore, { min: 0 }),
    activityScoreMultiplier: normalizeNullableNumber(source.activityScoreMultiplier, { min: 0 }),
    trustScore: normalizeNullableInteger(source.trustScore, { min: 0 }),
    messages7d: normalizeNullableInteger(source.messages7d, { min: 0 }),
    messages30d: normalizeNullableInteger(source.messages30d, { min: 0 }),
    messages90d: normalizeNullableInteger(source.messages90d, { min: 0 }),
    sessions7d: normalizeNullableInteger(source.sessions7d, { min: 0 }),
    sessions30d: normalizeNullableInteger(source.sessions30d, { min: 0 }),
    sessions90d: normalizeNullableInteger(source.sessions90d, { min: 0 }),
    activeDays7d: normalizeNullableInteger(source.activeDays7d, { min: 0 }),
    activeDays30d: normalizeNullableInteger(source.activeDays30d, { min: 0 }),
    activeDays90d: normalizeNullableInteger(source.activeDays90d, { min: 0 }),
    activeWatchedChannels30d: normalizeNullableInteger(source.activeWatchedChannels30d, { min: 0 }),
    weightedMessages30d: normalizeNullableNumber(source.weightedMessages30d, { min: 0 }),
    globalEffectiveSessions30d: normalizeNullableNumber(source.globalEffectiveSessions30d, { min: 0 }),
    effectiveActiveDays30d: normalizeNullableNumber(source.effectiveActiveDays30d, { min: 0 }),
    daysAbsent: normalizeNullableInteger(source.daysAbsent, { min: 0 }),
    guildJoinedAt: normalizeNullableString(source.guildJoinedAt, 80),
    daysSinceGuildJoin: normalizeNullableNumber(source.daysSinceGuildJoin, { min: 0 }),
    lastSeenAt: normalizeNullableString(source.lastSeenAt, 80),
    roleEligibilityStatus: normalizeNullableString(source.roleEligibilityStatus, 80),
    roleEligibleForActivityRole: normalizeNullableBoolean(source.roleEligibleForActivityRole),
    desiredActivityRoleKey: normalizeNullableString(source.desiredActivityRoleKey, 80),
    appliedActivityRoleKey: normalizeNullableString(source.appliedActivityRoleKey, 80),
    manualOverride: normalizeNullableBoolean(source.manualOverride),
    autoRoleFrozen: normalizeNullableBoolean(source.autoRoleFrozen),
    recalculatedAt: normalizeNullableString(source.recalculatedAt, 80),
    lastRoleAppliedAt: normalizeNullableString(source.lastRoleAppliedAt, 80),
  };
}

function normalizeVerificationObservedGuilds(value = []) {
  if (!Array.isArray(value)) return [];

  const normalized = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const id = cleanString(entry.id, 80);
    if (!id) continue;
    normalized.push({
      id,
      name: cleanString(entry.name, 120),
      owner: entry.owner === true,
      permissions: cleanString(entry.permissions, 40),
    });
    if (normalized.length >= 20) break;
  }

  return normalized;
}

function normalizeVerificationDomainState(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    status: cleanString(source.status, 40) || "not_started",
    decision: cleanString(source.decision, 40) || "none",
    assignedAt: normalizeNullableString(source.assignedAt, 80),
    startedAt: normalizeNullableString(source.startedAt, 80),
    reportDueAt: normalizeNullableString(source.reportDueAt, 80),
    reportSentAt: normalizeNullableString(source.reportSentAt, 80),
    completedAt: normalizeNullableString(source.completedAt, 80),
    reviewedAt: normalizeNullableString(source.reviewedAt, 80),
    reviewedBy: normalizeNullableString(source.reviewedBy, 120),
    decisionReason: normalizeNullableString(source.decisionReason, 120),
    lastError: normalizeNullableString(source.lastError, 400),
    assignedBy: normalizeNullableString(source.assignedBy, 120),
    assignmentNote: normalizeNullableString(source.assignmentNote, 500),
    stoppedAt: normalizeNullableString(source.stoppedAt, 80),
    stopReason: normalizeNullableString(source.stopReason, 200),
    oauthUserId: normalizeNullableString(source.oauthUserId, 80),
    oauthUsername: normalizeNullableString(source.oauthUsername, 120),
    oauthAvatarUrl: normalizeNullableString(source.oauthAvatarUrl, 2000),
    observedGuilds: normalizeVerificationObservedGuilds(source.observedGuilds),
    observedGuildIds: normalizeStringArray(source.observedGuildIds, 20, 80),
    observedGuildNames: normalizeStringArray(source.observedGuildNames, 20, 120),
    matchedEnemyGuildIds: normalizeStringArray(source.matchedEnemyGuildIds, 20, 80),
    matchedEnemyUserIds: normalizeStringArray(source.matchedEnemyUserIds, 20, 80),
    matchedEnemyInviteCodes: normalizeStringArray(source.matchedEnemyInviteCodes, 20, 80),
    matchedEnemyInviterUserIds: normalizeStringArray(source.matchedEnemyInviterUserIds, 20, 80),
  };
}

function buildRobloxProfileUrl(userId) {
  const normalizedUserId = normalizeNullableString(userId, 40);
  return normalizedUserId ? `https://www.roblox.com/users/${normalizedUserId}/profile` : null;
}

function normalizeRobloxHistoryEntry(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const name = normalizeNullableString(source.name ?? source.value, 120);
  if (!name) return null;
  return {
    name,
    firstSeenAt: normalizeNullableString(source.firstSeenAt ?? source.seenAt, 80),
    lastSeenAt: normalizeNullableString(source.lastSeenAt ?? source.seenAt, 80),
  };
}

function normalizeRobloxNameHistory(value, currentName, options = {}) {
  const limit = normalizeNonNegativeInteger(options.limit, ROBLOX_NAME_HISTORY_LIMIT) || ROBLOX_NAME_HISTORY_LIMIT;
  const entries = [];

  if (currentName) {
    entries.push({
      name: currentName,
      firstSeenAt: null,
      lastSeenAt: null,
    });
  }

  for (const item of Array.isArray(value) ? value : []) {
    const normalized = typeof item === "string"
      ? normalizeRobloxHistoryEntry({ name: item })
      : normalizeRobloxHistoryEntry(item);
    if (normalized) entries.push(normalized);
  }

  const seen = new Set();
  const normalizedHistory = [];
  for (const entry of entries) {
    const key = entry.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalizedHistory.push(entry);
    if (normalizedHistory.length >= limit) break;
  }

  return normalizedHistory;
}

function normalizeRobloxServerFriendsState(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    userIds: normalizeStringArray(source.userIds, ROBLOX_SERVER_FRIEND_LIMIT, 80),
    computedAt: normalizeNullableString(source.computedAt, 80),
  };
}

function normalizeRobloxPlaytimeDailyBuckets(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.fromEntries(
    Object.entries(source)
      .map(([dateKey, minutes]) => [cleanString(dateKey, 20), normalizeNonNegativeInteger(minutes, 0)])
      .filter(([dateKey, minutes]) => /^\d{4}-\d{2}-\d{2}$/.test(dateKey) && minutes > 0)
      .sort((left, right) => left[0].localeCompare(right[0]))
      .slice(-ROBLOX_PLAYTIME_BUCKET_LIMIT)
  );
}

function normalizeRobloxPlaytimeHourlyBuckets(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.fromEntries(
    Object.entries(source)
      .map(([bucketKey, minutes]) => [cleanString(bucketKey, 32), normalizeNonNegativeInteger(minutes, 0)])
      .filter(([bucketKey, minutes]) => /^\d{4}-\d{2}-\d{2}T\d{2}$/.test(bucketKey) && minutes > 0)
      .sort((left, right) => left[0].localeCompare(right[0]))
      .slice(-ROBLOX_PLAYTIME_HOURLY_BUCKET_LIMIT)
  );
}

function normalizeRobloxPlaytimeState(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    totalJjsMinutes: normalizeNonNegativeInteger(source.totalJjsMinutes, 0),
    jjsMinutes7d: normalizeNonNegativeInteger(source.jjsMinutes7d, 0),
    jjsMinutes30d: normalizeNonNegativeInteger(source.jjsMinutes30d, 0),
    sessionCount: normalizeNonNegativeInteger(source.sessionCount, 0),
    currentSessionStartedAt: normalizeNullableString(source.currentSessionStartedAt, 80),
    lastSeenInJjsAt: normalizeNullableString(source.lastSeenInJjsAt, 80),
    dailyBuckets: normalizeRobloxPlaytimeDailyBuckets(source.dailyBuckets),
    hourlyBucketsMsk: normalizeRobloxPlaytimeHourlyBuckets(source.hourlyBucketsMsk),
  };
}

function normalizeRobloxCoPlayPeer(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const peerUserId = normalizeNullableString(source.peerUserId ?? source.userId, 80);
  if (!peerUserId) return null;

  return {
    peerUserId,
    minutesTogether: normalizeNonNegativeInteger(source.minutesTogether, 0),
    sessionsTogether: normalizeNonNegativeInteger(source.sessionsTogether, 0),
    daysTogether: normalizeNonNegativeInteger(source.daysTogether, 0),
    sharedJjsSessionCount: normalizeNonNegativeInteger(source.sharedJjsSessionCount, 0),
    lastSeenTogetherAt: normalizeNullableString(source.lastSeenTogetherAt, 80),
    isRobloxFriend: normalizeNullableBoolean(source.isRobloxFriend),
  };
}

function normalizeRobloxCoPlayState(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const peers = [];
  const seen = new Set();

  for (const entry of Array.isArray(source.peers) ? source.peers : []) {
    const normalized = normalizeRobloxCoPlayPeer(entry);
    if (!normalized) continue;
    if (seen.has(normalized.peerUserId)) continue;
    seen.add(normalized.peerUserId);
    peers.push(normalized);
    if (peers.length >= ROBLOX_COPLAY_PEER_LIMIT) break;
  }

  return {
    peers,
    computedAt: normalizeNullableString(source.computedAt, 80),
  };
}

function normalizeProgressProofWindow(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const approvedKills = normalizeNullableInteger(source.approvedKills, { min: 0 });
  const reviewedAt = normalizeNullableString(source.reviewedAt, 80);
  if (approvedKills === null || !reviewedAt) return null;

  return {
    approvedKills,
    killTier: normalizeNullableInteger(source.killTier, { min: 1, max: 5 }),
    reviewedAt,
    reviewedBy: normalizeNullableString(source.reviewedBy, 120),
    playtimeTracked: source.playtimeTracked === true,
    totalJjsMinutes: normalizeNonNegativeInteger(source.totalJjsMinutes, 0),
    jjsMinutes7d: normalizeNonNegativeInteger(source.jjsMinutes7d, 0),
    jjsMinutes30d: normalizeNonNegativeInteger(source.jjsMinutes30d, 0),
    sessionCount: normalizeNonNegativeInteger(source.sessionCount, 0),
    currentSessionStartedAt: normalizeNullableString(source.currentSessionStartedAt, 80),
    lastSeenInJjsAt: normalizeNullableString(source.lastSeenInJjsAt, 80),
    dailyBucketsSnapshot: normalizeRobloxPlaytimeDailyBuckets(source.dailyBucketsSnapshot),
    hourlyBucketsMskSnapshot: normalizeRobloxPlaytimeHourlyBuckets(source.hourlyBucketsMskSnapshot),
  };
}

function normalizeProgressDomainState(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const proofWindows = [];
  const seen = new Set();

  for (const entry of Array.isArray(source.proofWindows) ? source.proofWindows : []) {
    const normalized = normalizeProgressProofWindow(entry);
    if (!normalized) continue;
    const key = `${normalized.approvedKills}:${normalized.reviewedAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    proofWindows.push(normalized);
  }

  proofWindows.sort((left, right) => left.reviewedAt.localeCompare(right.reviewedAt));

  return {
    proofWindows: proofWindows.slice(-PROFILE_PROOF_WINDOW_LIMIT),
  };
}

function normalizeVoiceChannelSummaryEntry(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const channelId = normalizeNullableString(source.channelId, 80);
  if (!channelId) return null;

  return {
    channelId,
    sessionCount: normalizeNonNegativeInteger(source.sessionCount, 0),
    lastSeenAt: normalizeNullableString(source.lastSeenAt, 80),
  };
}

function normalizeVoiceSummaryState(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const topChannels = [];
  const seen = new Set();

  for (const entry of Array.isArray(source.topChannels) ? source.topChannels : []) {
    const normalized = normalizeVoiceChannelSummaryEntry(entry);
    if (!normalized) continue;
    if (seen.has(normalized.channelId)) continue;
    seen.add(normalized.channelId);
    topChannels.push(normalized);
  }

  topChannels.sort((left, right) => {
    const sessionDiff = right.sessionCount - left.sessionCount;
    if (sessionDiff) return sessionDiff;
    const rightSeenAt = right.lastSeenAt || "";
    const leftSeenAt = left.lastSeenAt || "";
    const seenDiff = rightSeenAt.localeCompare(leftSeenAt);
    if (seenDiff) return seenDiff;
    return left.channelId.localeCompare(right.channelId);
  });

  return {
    lifetimeSessionCount: normalizeNonNegativeInteger(source.lifetimeSessionCount, 0),
    lifetimeVoiceDurationSeconds: normalizeNonNegativeInteger(source.lifetimeVoiceDurationSeconds, 0),
    sessionCount7d: normalizeNonNegativeInteger(source.sessionCount7d, 0),
    sessionCount30d: normalizeNonNegativeInteger(source.sessionCount30d, 0),
    incompleteSessionCount30d: normalizeNonNegativeInteger(source.incompleteSessionCount30d, 0),
    voiceDurationSeconds7d: normalizeNonNegativeInteger(source.voiceDurationSeconds7d, 0),
    voiceDurationSeconds30d: normalizeNonNegativeInteger(source.voiceDurationSeconds30d, 0),
    lastSessionEndedAt: normalizeNullableString(source.lastSessionEndedAt, 80),
    lastVoiceSeenAt: normalizeNullableString(source.lastVoiceSeenAt, 80),
    lastCapturedAt: normalizeNullableString(source.lastCapturedAt, 80),
    isInVoiceNow: source.isInVoiceNow === true,
    currentChannelId: normalizeNullableString(source.currentChannelId, 80),
    currentSessionStartedAt: normalizeNullableString(source.currentSessionStartedAt, 80),
    topChannels: topChannels.slice(0, PROFILE_VOICE_TOP_CHANNEL_LIMIT),
  };
}

function normalizeVoiceDomainState(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const summarySource = source.summary && typeof source.summary === "object" && !Array.isArray(source.summary)
    ? source.summary
    : source;

  return {
    summary: normalizeVoiceSummaryState(summarySource),
  };
}

function normalizeSocialSuggestionEntry(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const peerUserId = normalizeNullableString(source.peerUserId, 80);
  if (!peerUserId) return null;

  return {
    peerUserId,
    peerDisplayName: normalizeNullableString(source.peerDisplayName, 200),
    peerRobloxUserId: normalizeNullableString(source.peerRobloxUserId, 40),
    peerRobloxUsername: normalizeNullableString(source.peerRobloxUsername, 120),
    peerHasVerifiedRoblox: source.peerHasVerifiedRoblox === true,
    minutesTogether: normalizeNonNegativeInteger(source.minutesTogether, 0),
    sessionsTogether: normalizeNonNegativeInteger(source.sessionsTogether, 0),
    daysTogether: normalizeNonNegativeInteger(source.daysTogether, 0),
    sharedJjsSessionCount: normalizeNonNegativeInteger(source.sharedJjsSessionCount, 0),
    lastSeenTogetherAt: normalizeNullableString(source.lastSeenTogetherAt, 80),
    sourceComputedAt: normalizeNullableString(source.sourceComputedAt, 80),
  };
}

function normalizeSocialDomainState(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const suggestions = [];
  const seen = new Set();

  for (const entry of Array.isArray(source.suggestions) ? source.suggestions : []) {
    const normalized = normalizeSocialSuggestionEntry(entry);
    if (!normalized) continue;
    if (seen.has(normalized.peerUserId)) continue;
    seen.add(normalized.peerUserId);
    suggestions.push(normalized);
  }

  suggestions.sort((left, right) => {
    const minutesDiff = right.minutesTogether - left.minutesTogether;
    if (minutesDiff) return minutesDiff;
    const sessionsDiff = right.sharedJjsSessionCount - left.sharedJjsSessionCount;
    if (sessionsDiff) return sessionsDiff;
    const rightSeenAt = right.lastSeenTogetherAt || "";
    const leftSeenAt = left.lastSeenTogetherAt || "";
    const seenDiff = rightSeenAt.localeCompare(leftSeenAt);
    if (seenDiff) return seenDiff;
    return left.peerUserId.localeCompare(right.peerUserId);
  });

  return {
    suggestions: suggestions.slice(0, PROFILE_SOCIAL_SUGGESTION_LIMIT),
  };
}

function normalizeRobloxPlatformUserId(value) {
  const normalized = normalizeNullableInteger(value, { min: 1 });
  return normalized ? String(normalized) : null;
}

function buildLegacyRobloxSource(profile = {}) {
  const source = profile && typeof profile === "object" ? profile : {};
  return {
    robloxUsername: source.robloxUsername,
    robloxUserId: source.robloxUserId,
    robloxDisplayName: source.robloxDisplayName,
    robloxAvatarUrl: source.robloxAvatarUrl,
    robloxProfileUrl: source.robloxProfileUrl,
    robloxCreatedAt: source.robloxCreatedAt,
    robloxDescription: source.robloxDescription,
    robloxHasVerifiedBadge: source.robloxHasVerifiedBadge,
    robloxAccountStatus: source.robloxAccountStatus,
    robloxLastRefreshAt: source.robloxLastRefreshAt,
    robloxRefreshStatus: source.robloxRefreshStatus,
    robloxRefreshError: source.robloxRefreshError,
    robloxUsernameHistory: source.robloxUsernameHistory,
    robloxDisplayNameHistory: source.robloxDisplayNameHistory,
    robloxServerFriends: source.robloxServerFriends,
    robloxPlaytime: source.robloxPlaytime,
    robloxCoPlay: source.robloxCoPlay,
    verificationStatus: source.verificationStatus,
    verifiedAt: source.robloxVerifiedAt ?? source.verifiedAt,
    updatedAt: source.robloxUpdatedAt,
    lastSubmissionId: source.robloxLastSubmissionId,
    lastReviewedAt: source.robloxLastReviewedAt,
    reviewedBy: source.robloxReviewedBy,
    source: source.robloxSource,
  };
}

function hasOwn(source, key) {
  return Boolean(source) && Object.prototype.hasOwnProperty.call(source, key);
}

function buildUpdatedRobloxNameHistory(currentName, nextName, history = [], seenAt = null) {
  const current = normalizeNullableString(currentName, 120);
  const next = normalizeNullableString(nextName, 120);
  const entries = [];

  if (current && next && current.toLowerCase() !== next.toLowerCase()) {
    entries.push({
      name: current,
      firstSeenAt: null,
      lastSeenAt: normalizeNullableString(seenAt, 80),
    });
  }

  return normalizeRobloxNameHistory(entries.concat(Array.isArray(history) ? history : []), next, {
    limit: ROBLOX_NAME_HISTORY_LIMIT,
  });
}

function getRobloxPreviousName(currentName, history = []) {
  const current = normalizeNullableString(currentName, 120);
  for (const entry of Array.isArray(history) ? history : []) {
    const value = normalizeNullableString(entry?.name, 120);
    if (!value) continue;
    if (!current || value.toLowerCase() !== current.toLowerCase()) return value;
  }
  return null;
}

function getRobloxRenameCount(currentName, history = []) {
  const current = normalizeNullableString(currentName, 120);
  if (!Array.isArray(history) || !history.length) return 0;
  const unique = history
    .map((entry) => normalizeNullableString(entry?.name, 120))
    .filter(Boolean)
    .filter((value, index, values) => values.findIndex((candidate) => candidate.toLowerCase() === value.toLowerCase()) === index);

  if (!current) return Math.max(0, unique.length - 1);
  return unique.filter((value) => value.toLowerCase() !== current.toLowerCase()).length;
}

function getRobloxLastRenameSeenAt(currentName, history = []) {
  const current = normalizeNullableString(currentName, 120);
  let latest = null;

  for (const entry of Array.isArray(history) ? history : []) {
    const name = normalizeNullableString(entry?.name, 120);
    if (!name) continue;
    if (current && name.toLowerCase() === current.toLowerCase()) continue;
    const seenAt = normalizeNullableString(entry?.lastSeenAt, 80);
    if (!seenAt) continue;
    if (!latest || seenAt > latest) latest = seenAt;
  }

  return latest;
}

function getLatestTimestamp(values = []) {
  let latest = null;
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = normalizeNullableString(value, 80);
    if (!normalized) continue;
    if (!latest || normalized > latest) latest = normalized;
  }
  return latest;
}

function normalizeTimestampMs(value) {
  const normalized = normalizeNullableString(value, 80);
  if (!normalized) return null;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function listUniqueVoiceChannelIds(session = {}) {
  return [...new Set([
    ...(Array.isArray(session?.enteredChannelIds) ? session.enteredChannelIds : []),
    session?.finalChannelId,
    session?.currentChannelId,
  ].map((value) => cleanString(value, 80)).filter(Boolean))];
}

function ensureVoiceMirrorAggregate(map = new Map(), userId = "", lastCapturedAt = null) {
  const normalizedUserId = cleanString(userId, 80);
  if (!normalizedUserId) return null;
  if (!map.has(normalizedUserId)) {
    map.set(normalizedUserId, {
      lifetimeSessionCount: 0,
      lifetimeVoiceDurationSeconds: 0,
      sessionCount7d: 0,
      sessionCount30d: 0,
      incompleteSessionCount30d: 0,
      voiceDurationSeconds7d: 0,
      voiceDurationSeconds30d: 0,
      lastSessionEndedAt: null,
      lastVoiceSeenAt: null,
      lastCapturedAt: normalizeNullableString(lastCapturedAt, 80),
      isInVoiceNow: false,
      currentChannelId: null,
      currentSessionStartedAt: null,
      topChannels: new Map(),
    });
  }
  return map.get(normalizedUserId);
}

function updateVoiceChannelAggregate(aggregate = {}, channelId, lastSeenAt = null) {
  const normalizedChannelId = cleanString(channelId, 80);
  if (!normalizedChannelId || !(aggregate.topChannels instanceof Map)) return;
  const current = aggregate.topChannels.get(normalizedChannelId) || {
    channelId: normalizedChannelId,
    sessionCount: 0,
    lastSeenAt: null,
  };
  current.sessionCount += 1;
  current.lastSeenAt = getLatestTimestamp([current.lastSeenAt, lastSeenAt]);
  aggregate.topChannels.set(normalizedChannelId, current);
}

function collectVoiceMirrorSummary(aggregate = {}) {
  const topChannels = [...(aggregate.topChannels instanceof Map ? aggregate.topChannels.values() : [])]
    .sort((left, right) => {
      const sessionDiff = normalizeNonNegativeInteger(right?.sessionCount, 0) - normalizeNonNegativeInteger(left?.sessionCount, 0);
      if (sessionDiff) return sessionDiff;
      const rightSeenAt = normalizeNullableString(right?.lastSeenAt, 80) || "";
      const leftSeenAt = normalizeNullableString(left?.lastSeenAt, 80) || "";
      const seenDiff = rightSeenAt.localeCompare(leftSeenAt);
      if (seenDiff) return seenDiff;
      return cleanString(left?.channelId, 80).localeCompare(cleanString(right?.channelId, 80));
    })
    .slice(0, PROFILE_VOICE_TOP_CHANNEL_LIMIT);

  return {
    lifetimeSessionCount: aggregate.lifetimeSessionCount,
    lifetimeVoiceDurationSeconds: aggregate.lifetimeVoiceDurationSeconds,
    sessionCount7d: aggregate.sessionCount7d,
    sessionCount30d: aggregate.sessionCount30d,
    incompleteSessionCount30d: aggregate.incompleteSessionCount30d,
    voiceDurationSeconds7d: aggregate.voiceDurationSeconds7d,
    voiceDurationSeconds30d: aggregate.voiceDurationSeconds30d,
    lastSessionEndedAt: aggregate.lastSessionEndedAt,
    lastVoiceSeenAt: aggregate.lastVoiceSeenAt,
    lastCapturedAt: aggregate.lastCapturedAt,
    isInVoiceNow: aggregate.isInVoiceNow,
    currentChannelId: aggregate.currentChannelId,
    currentSessionStartedAt: aggregate.currentSessionStartedAt,
    topChannels,
  };
}

function buildVoiceMirrorIndex(value = {}) {
  const newsState = normalizeNewsState(value);
  const aggregates = new Map();
  const lastCapturedAt = normalizeNullableString(newsState?.runtime?.lastVoiceCaptureAt, 80);
  const referenceAt = getLatestTimestamp([
    lastCapturedAt,
    ...(Array.isArray(newsState?.voice?.finalizedSessions)
      ? newsState.voice.finalizedSessions.map((session) => normalizeNullableString(session?.endedAt, 80))
      : []),
  ]);
  const referenceMs = normalizeTimestampMs(referenceAt);

  for (const session of Array.isArray(newsState?.voice?.finalizedSessions) ? newsState.voice.finalizedSessions : []) {
    const aggregate = ensureVoiceMirrorAggregate(aggregates, session?.userId, lastCapturedAt);
    if (!aggregate) continue;

    const endedAt = normalizeNullableString(session?.endedAt, 80);
    const endedMs = normalizeTimestampMs(endedAt);
    const durationSeconds = normalizeNonNegativeInteger(session?.durationSeconds, 0);

    aggregate.lifetimeSessionCount += 1;
    aggregate.lifetimeVoiceDurationSeconds += durationSeconds;
    aggregate.lastSessionEndedAt = getLatestTimestamp([aggregate.lastSessionEndedAt, endedAt]);
    aggregate.lastVoiceSeenAt = getLatestTimestamp([aggregate.lastVoiceSeenAt, endedAt]);

    if (Number.isFinite(referenceMs) && Number.isFinite(endedMs)) {
      if (endedMs >= referenceMs - (7 * MS_PER_DAY) && endedMs <= referenceMs) {
        aggregate.sessionCount7d += 1;
        aggregate.voiceDurationSeconds7d += durationSeconds;
      }
      if (endedMs >= referenceMs - (30 * MS_PER_DAY) && endedMs <= referenceMs) {
        aggregate.sessionCount30d += 1;
        aggregate.voiceDurationSeconds30d += durationSeconds;
        if (session?.incomplete === true) aggregate.incompleteSessionCount30d += 1;
      }
    }

    for (const channelId of listUniqueVoiceChannelIds(session)) {
      updateVoiceChannelAggregate(aggregate, channelId, endedAt);
    }
  }

  for (const session of Object.values(newsState?.voice?.openSessions && typeof newsState.voice.openSessions === "object" ? newsState.voice.openSessions : {})) {
    const aggregate = ensureVoiceMirrorAggregate(aggregates, session?.userId, lastCapturedAt);
    if (!aggregate) continue;

    const joinedAt = normalizeNullableString(session?.joinedAt, 80);
    aggregate.isInVoiceNow = true;
    aggregate.currentChannelId = normalizeNullableString(session?.currentChannelId, 80);
    aggregate.currentSessionStartedAt = joinedAt;
    aggregate.lastVoiceSeenAt = getLatestTimestamp([aggregate.lastVoiceSeenAt, lastCapturedAt, joinedAt]);

    for (const channelId of listUniqueVoiceChannelIds(session)) {
      updateVoiceChannelAggregate(aggregate, channelId, lastCapturedAt || joinedAt);
    }
  }

  return Object.fromEntries(
    [...aggregates.entries()].map(([userId, aggregate]) => [
      userId,
      normalizeVoiceDomainState({ summary: collectVoiceMirrorSummary(aggregate) }),
    ])
  );
}

function buildSocialSuggestionCache(profiles = {}) {
  const suggestionsByUserId = {};

  for (const [userId, profile] of Object.entries(profiles || {})) {
    const roblox = normalizeRobloxDomainState(profile?.domains?.roblox || buildLegacyRobloxSource(profile));
    const suggestions = roblox.coPlay.peers
      .filter((peer) => isFrequentRobloxNonFriendPeer(peer))
      .filter((peer) => cleanString(peer?.peerUserId, 80) && cleanString(peer?.peerUserId, 80) !== userId)
      .map((peer) => {
        const peerUserId = cleanString(peer?.peerUserId, 80);
        const peerProfile = profiles?.[peerUserId] || null;
        const peerRoblox = peerProfile
          ? normalizeRobloxDomainState(peerProfile?.domains?.roblox || buildLegacyRobloxSource(peerProfile))
          : normalizeRobloxDomainState({});

        return {
          peerUserId,
          peerDisplayName: cleanString(
            peerProfile?.summary?.preferredDisplayName
              || peerProfile?.displayName
              || peerProfile?.username
              || peerUserId,
            200
          ) || null,
          peerRobloxUserId: peerRoblox.userId,
          peerRobloxUsername: peerRoblox.username,
          peerHasVerifiedRoblox: peerRoblox.verificationStatus === "verified" && Boolean(peerRoblox.userId),
          minutesTogether: normalizeNonNegativeInteger(peer?.minutesTogether, 0),
          sessionsTogether: normalizeNonNegativeInteger(peer?.sessionsTogether, 0),
          daysTogether: normalizeNonNegativeInteger(peer?.daysTogether, 0),
          sharedJjsSessionCount: getRobloxSharedSessionCount(peer),
          lastSeenTogetherAt: normalizeNullableString(peer?.lastSeenTogetherAt, 80),
          sourceComputedAt: roblox.coPlay.computedAt,
        };
      });

    suggestionsByUserId[userId] = normalizeSocialDomainState({ suggestions });
  }

  return suggestionsByUserId;
}

function getRobloxSharedSessionCount(peer = {}) {
  return Math.max(
    normalizeNonNegativeInteger(peer?.sharedJjsSessionCount, 0),
    normalizeNonNegativeInteger(peer?.sessionsTogether, 0)
  );
}

function isFrequentRobloxNonFriendPeer(peer = {}) {
  if (peer?.isRobloxFriend !== false) return false;
  return normalizeNonNegativeInteger(peer?.minutesTogether, 0) >= sharedProfileRuntimeConfig.frequentNonFriendMinutes
    || getRobloxSharedSessionCount(peer) >= sharedProfileRuntimeConfig.frequentNonFriendSessions;
}

function buildRobloxTopCoPlayPeers(peers = [], limit = ROBLOX_TOP_COPLAY_PEER_LIMIT) {
  return (Array.isArray(peers) ? peers : [])
    .slice()
    .sort((left, right) => {
      const minutesDiff = normalizeNonNegativeInteger(right?.minutesTogether, 0)
        - normalizeNonNegativeInteger(left?.minutesTogether, 0);
      if (minutesDiff) return minutesDiff;

      const sessionsDiff = getRobloxSharedSessionCount(right) - getRobloxSharedSessionCount(left);
      if (sessionsDiff) return sessionsDiff;

      const daysDiff = normalizeNonNegativeInteger(right?.daysTogether, 0)
        - normalizeNonNegativeInteger(left?.daysTogether, 0);
      if (daysDiff) return daysDiff;

      const rightSeenAt = normalizeNullableString(right?.lastSeenTogetherAt, 80) || "";
      const leftSeenAt = normalizeNullableString(left?.lastSeenTogetherAt, 80) || "";
      return rightSeenAt.localeCompare(leftSeenAt);
    })
    .slice(0, Math.max(0, normalizeNonNegativeInteger(limit, ROBLOX_TOP_COPLAY_PEER_LIMIT)))
    .map((peer) => ({
      peerUserId: normalizeNullableString(peer?.peerUserId, 80),
      isRobloxFriend: normalizeNullableBoolean(peer?.isRobloxFriend),
      minutesTogether: normalizeNonNegativeInteger(peer?.minutesTogether, 0),
      sessionsTogether: normalizeNonNegativeInteger(peer?.sessionsTogether, 0),
      daysTogether: normalizeNonNegativeInteger(peer?.daysTogether, 0),
      sharedJjsSessionCount: normalizeNonNegativeInteger(peer?.sharedJjsSessionCount, 0),
      lastSeenTogetherAt: normalizeNullableString(peer?.lastSeenTogetherAt, 80),
      isFrequentNonFriend: isFrequentRobloxNonFriendPeer(peer),
    }))
    .filter((peer) => Boolean(peer.peerUserId));
}

function normalizeRobloxDomainState(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const rawStatus = cleanString(source.verificationStatus || source.status, 40).toLowerCase();
  const userId = normalizeRobloxPlatformUserId(source.robloxUserId ?? source.userId);
  const username = normalizeNullableString(source.robloxUsername ?? source.username, 120);
  const displayName = normalizeNullableString(source.robloxDisplayName ?? source.displayName, 120);
  const verifiedAt = normalizeNullableString(source.verifiedAt, 80);
  const implicitlyTrustedVerified = Boolean(userId)
    && (source.hasVerifiedAccount === true || Boolean(verifiedAt));
  const rawAccountStatus = cleanString(source.robloxAccountStatus ?? source.accountStatus, 40).toLowerCase();
  const usernameHistory = normalizeRobloxNameHistory(source.robloxUsernameHistory ?? source.usernameHistory, username, {
    limit: ROBLOX_NAME_HISTORY_LIMIT,
  });
  const displayNameHistory = normalizeRobloxNameHistory(source.robloxDisplayNameHistory ?? source.displayNameHistory, displayName, {
    limit: ROBLOX_NAME_HISTORY_LIMIT,
  });

  return {
    username,
    displayName,
    userId,
    avatarUrl: normalizeNullableString(source.robloxAvatarUrl ?? source.avatarUrl, 2000),
    profileUrl: normalizeNullableString(source.robloxProfileUrl ?? source.profileUrl, 2000) || buildRobloxProfileUrl(userId),
    createdAt: normalizeNullableString(source.robloxCreatedAt ?? source.createdAt, 80),
    description: normalizeNullableString(source.robloxDescription ?? source.description, 2000),
    hasVerifiedBadge: normalizeNullableBoolean(source.robloxHasVerifiedBadge ?? source.hasVerifiedBadge),
    accountStatus: ROBLOX_ACCOUNT_STATUSES.has(rawAccountStatus)
      ? rawAccountStatus
      : source.isBanned === true
        ? "banned-or-unavailable"
        : source.isBanned === false
          ? "active"
          : null,
    verificationStatus: ROBLOX_VERIFICATION_STATUSES.has(rawStatus)
      ? rawStatus
      : implicitlyTrustedVerified
        ? "verified"
        : "unverified",
    verifiedAt,
    updatedAt: normalizeNullableString(source.updatedAt, 80),
    lastSubmissionId: normalizeNullableString(source.lastSubmissionId, 80),
    lastReviewedAt: normalizeNullableString(source.lastReviewedAt, 80),
    reviewedBy: normalizeNullableString(source.reviewedBy, 120),
    source: normalizeNullableString(source.source, 40),
    lastRefreshAt: normalizeNullableString(source.robloxLastRefreshAt ?? source.lastRefreshAt, 80),
    refreshStatus: normalizeNullableString(source.robloxRefreshStatus ?? source.refreshStatus, 40),
    refreshError: normalizeNullableString(source.robloxRefreshError ?? source.refreshError, 500),
    usernameHistory,
    displayNameHistory,
    serverFriends: normalizeRobloxServerFriendsState(source.robloxServerFriends ?? source.serverFriends),
    playtime: normalizeRobloxPlaytimeState(source.robloxPlaytime ?? source.playtime),
    coPlay: normalizeRobloxCoPlayState(source.robloxCoPlay ?? source.coPlay),
  };
}

function applyRobloxAccountSnapshot(profile = {}, snapshot = {}, options = {}) {
  const targetProfile = profile && typeof profile === "object" ? profile : {};
  const source = snapshot && typeof snapshot === "object" ? snapshot : {};
  const current = normalizeRobloxDomainState(targetProfile?.domains?.roblox || buildLegacyRobloxSource(targetProfile));
  const nextUpdatedAt = hasOwn(options, "updatedAt")
    ? normalizeNullableString(options.updatedAt, 80)
    : current.updatedAt;
  const nextUsername = hasOwn(source, "username") || hasOwn(source, "name")
    ? normalizeNullableString(source.username ?? source.name, 120)
    : current.username;
  const nextDisplayName = hasOwn(source, "displayName")
    ? normalizeNullableString(source.displayName, 120)
    : current.displayName;
  const nextUserId = hasOwn(source, "userId") || hasOwn(source, "id")
    ? normalizeNullableString(source.userId ?? source.id, 40)
    : current.userId;
  const nextAccountStatus = hasOwn(source, "accountStatus")
    ? cleanString(source.accountStatus, 40).toLowerCase()
    : hasOwn(source, "isBanned")
      ? source.isBanned === true
        ? "banned-or-unavailable"
        : source.isBanned === false
          ? "active"
          : current.accountStatus
      : current.accountStatus;

  const nextRoblox = normalizeRobloxDomainState({
    ...current,
    username: nextUsername,
    displayName: nextDisplayName,
    userId: nextUserId,
    avatarUrl: hasOwn(source, "avatarUrl") ? source.avatarUrl : current.avatarUrl,
    profileUrl: hasOwn(source, "profileUrl")
      ? source.profileUrl
      : buildRobloxProfileUrl(nextUserId) || current.profileUrl,
    createdAt: hasOwn(source, "createdAt") || hasOwn(source, "created")
      ? source.createdAt ?? source.created
      : current.createdAt,
    description: hasOwn(source, "description") ? source.description : current.description,
    hasVerifiedBadge: hasOwn(source, "hasVerifiedBadge") ? source.hasVerifiedBadge : current.hasVerifiedBadge,
    accountStatus: nextAccountStatus,
    verificationStatus: hasOwn(options, "verificationStatus") ? options.verificationStatus : current.verificationStatus,
    verifiedAt: hasOwn(options, "verifiedAt") ? options.verifiedAt : current.verifiedAt,
    updatedAt: nextUpdatedAt,
    lastSubmissionId: hasOwn(options, "lastSubmissionId") ? options.lastSubmissionId : current.lastSubmissionId,
    lastReviewedAt: hasOwn(options, "lastReviewedAt") ? options.lastReviewedAt : current.lastReviewedAt,
    reviewedBy: hasOwn(options, "reviewedBy") ? options.reviewedBy : current.reviewedBy,
    source: hasOwn(options, "source") ? options.source : current.source,
    lastRefreshAt: hasOwn(options, "lastRefreshAt") ? options.lastRefreshAt : current.lastRefreshAt,
    refreshStatus: hasOwn(options, "refreshStatus") ? options.refreshStatus : current.refreshStatus,
    refreshError: hasOwn(options, "refreshError") ? options.refreshError : current.refreshError,
    usernameHistory: buildUpdatedRobloxNameHistory(current.username, nextUsername, current.usernameHistory, nextUpdatedAt || current.updatedAt),
    displayNameHistory: buildUpdatedRobloxNameHistory(current.displayName, nextDisplayName, current.displayNameHistory, nextUpdatedAt || current.updatedAt),
    serverFriends: current.serverFriends,
    playtime: current.playtime,
    coPlay: current.coPlay,
  });

  targetProfile.domains ||= {};
  targetProfile.domains.roblox = nextRoblox;
  return nextRoblox;
}

function buildSharedProfileSummary(profile = {}, domains = {}) {
  const onboarding = domains.onboarding || normalizeOnboardingDomainState(profile);
  const elo = domains.elo || normalizeEloDomainState(profile?.domains?.elo);
  const tierlist = domains.tierlist || normalizeTierlistDomainState(profile?.domains?.tierlist);
  const activity = domains.activity || normalizeActivityDomainState(profile?.domains?.activity || profile?.activity || profile?.summary?.activity);
  const roblox = domains.roblox || normalizeRobloxDomainState(profile?.domains?.roblox || profile);
  const verification = domains.verification || normalizeVerificationDomainState(profile?.domains?.verification || profile?.verification || profile?.summary?.verification);
  const progress = domains.progress || normalizeProgressDomainState(profile?.domains?.progress);
  const voice = domains.voice || normalizeVoiceDomainState(profile?.domains?.voice);
  const social = domains.social || normalizeSocialDomainState(profile?.domains?.social);
  const previousUsername = getRobloxPreviousName(roblox.username, roblox.usernameHistory);
  const previousDisplayName = getRobloxPreviousName(roblox.displayName, roblox.displayNameHistory);
  const serverFriendsCount = roblox.serverFriends.userIds.length;
  const nonFriendPeerCount = roblox.coPlay.peers.filter((entry) => entry.isRobloxFriend === false).length;
  const frequentNonFriendCount = roblox.coPlay.peers.filter((entry) => isFrequentRobloxNonFriendPeer(entry)).length;
  const topCoPlayPeers = buildRobloxTopCoPlayPeers(roblox.coPlay.peers);
  const observedGuildCount = verification.observedGuilds.length || verification.observedGuildIds.length;
  const lastRenameSeenAt = getLatestTimestamp([
    getRobloxLastRenameSeenAt(roblox.username, roblox.usernameHistory),
    getRobloxLastRenameSeenAt(roblox.displayName, roblox.displayNameHistory),
  ]);

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
    activity: {
      baseActivityScore: activity.baseActivityScore,
      activityScore: activity.activityScore,
      activityScoreMultiplier: activity.activityScoreMultiplier,
      trustScore: activity.trustScore,
      messages7d: activity.messages7d,
      messages30d: activity.messages30d,
      messages90d: activity.messages90d,
      sessions7d: activity.sessions7d,
      sessions30d: activity.sessions30d,
      sessions90d: activity.sessions90d,
      activeDays7d: activity.activeDays7d,
      activeDays30d: activity.activeDays30d,
      activeDays90d: activity.activeDays90d,
      activeWatchedChannels30d: activity.activeWatchedChannels30d,
      weightedMessages30d: activity.weightedMessages30d,
      globalEffectiveSessions30d: activity.globalEffectiveSessions30d,
      effectiveActiveDays30d: activity.effectiveActiveDays30d,
      daysAbsent: activity.daysAbsent,
      guildJoinedAt: activity.guildJoinedAt,
      daysSinceGuildJoin: activity.daysSinceGuildJoin,
      lastSeenAt: activity.lastSeenAt,
      roleEligibilityStatus: activity.roleEligibilityStatus,
      roleEligibleForActivityRole: activity.roleEligibleForActivityRole,
      desiredActivityRoleKey: activity.desiredActivityRoleKey,
      appliedActivityRoleKey: activity.appliedActivityRoleKey,
      manualOverride: activity.manualOverride,
      autoRoleFrozen: activity.autoRoleFrozen,
      recalculatedAt: activity.recalculatedAt,
      lastRoleAppliedAt: activity.lastRoleAppliedAt,
    },
    roblox: {
      hasVerifiedAccount: roblox.verificationStatus === "verified" && Boolean(roblox.userId),
      currentUsername: roblox.username,
      currentDisplayName: roblox.displayName,
      username: roblox.username,
      displayName: roblox.displayName,
      userId: roblox.userId,
      avatarUrl: roblox.avatarUrl,
      profileUrl: roblox.profileUrl,
      createdAt: roblox.createdAt,
      description: roblox.description,
      hasVerifiedBadge: roblox.hasVerifiedBadge,
      accountStatus: roblox.accountStatus,
      verificationStatus: roblox.verificationStatus,
      verifiedAt: roblox.verifiedAt,
      updatedAt: roblox.updatedAt,
      reviewedBy: roblox.reviewedBy,
      source: roblox.source,
      previousUsername,
      previousDisplayName,
      renameCount: getRobloxRenameCount(roblox.username, roblox.usernameHistory),
      displayRenameCount: getRobloxRenameCount(roblox.displayName, roblox.displayNameHistory),
      lastRenameSeenAt,
      serverFriendsUserIds: roblox.serverFriends.userIds,
      serverFriendsCount,
      serverFriendsComputedAt: roblox.serverFriends.computedAt,
      nonFriendPeerCount,
      frequentNonFriendCount,
      topCoPlayPeers,
      totalJjsMinutes: roblox.playtime.totalJjsMinutes,
      jjsMinutes7d: roblox.playtime.jjsMinutes7d,
      jjsMinutes30d: roblox.playtime.jjsMinutes30d,
      sessionCount: roblox.playtime.sessionCount,
      currentSessionStartedAt: roblox.playtime.currentSessionStartedAt,
      lastSeenInJjsAt: roblox.playtime.lastSeenInJjsAt,
      lastRefreshAt: roblox.lastRefreshAt,
      refreshStatus: roblox.refreshStatus,
      refreshError: roblox.refreshError,
    },
    verification: {
      status: verification.status,
      decision: verification.decision,
      assignedAt: verification.assignedAt,
      startedAt: verification.startedAt,
      reportDueAt: verification.reportDueAt,
      reportSentAt: verification.reportSentAt,
      completedAt: verification.completedAt,
      reviewedAt: verification.reviewedAt,
      reviewedBy: verification.reviewedBy,
      decisionReason: verification.decisionReason,
      lastError: verification.lastError,
      assignedBy: verification.assignedBy,
      assignmentNote: verification.assignmentNote,
      stoppedAt: verification.stoppedAt,
      stopReason: verification.stopReason,
      oauthUserId: verification.oauthUserId,
      oauthUsername: verification.oauthUsername,
      oauthAvatarUrl: verification.oauthAvatarUrl,
      observedGuildCount,
      matchedEnemyGuildCount: verification.matchedEnemyGuildIds.length,
      matchedEnemyUserCount: verification.matchedEnemyUserIds.length,
      matchedEnemyInviteCount: verification.matchedEnemyInviteCodes.length,
      matchedEnemyInviterCount: verification.matchedEnemyInviterUserIds.length,
      manualTagCount: 0,
    },
    progress: {
      proofWindowCount: progress.proofWindows.length,
      lastProofWindowReviewedAt: progress.proofWindows.length ? progress.proofWindows.at(-1).reviewedAt : null,
      lastProofWindowApprovedKills: progress.proofWindows.length ? progress.proofWindows.at(-1).approvedKills : null,
    },
    voice: {
      lifetimeSessionCount: voice.summary.lifetimeSessionCount,
      lifetimeVoiceDurationSeconds: voice.summary.lifetimeVoiceDurationSeconds,
      sessionCount7d: voice.summary.sessionCount7d,
      sessionCount30d: voice.summary.sessionCount30d,
      incompleteSessionCount30d: voice.summary.incompleteSessionCount30d,
      voiceDurationSeconds7d: voice.summary.voiceDurationSeconds7d,
      voiceDurationSeconds30d: voice.summary.voiceDurationSeconds30d,
      lastSessionEndedAt: voice.summary.lastSessionEndedAt,
      lastVoiceSeenAt: voice.summary.lastVoiceSeenAt,
      lastCapturedAt: voice.summary.lastCapturedAt,
      isInVoiceNow: voice.summary.isInVoiceNow,
      currentChannelId: voice.summary.currentChannelId,
      currentSessionStartedAt: voice.summary.currentSessionStartedAt,
      topChannels: voice.summary.topChannels,
    },
    social: {
      suggestionCount: social.suggestions.length,
      suggestions: social.suggestions,
    },
  };
}

function ensureSharedProfile(profile = {}, userId = "", options = {}) {
  const source = profile && typeof profile === "object" ? profile : {};
  const onboarding = normalizeOnboardingDomainState(source);
  const elo = normalizeEloDomainState(source?.domains?.elo);
  const tierlist = normalizeTierlistDomainState(source?.domains?.tierlist);
  const activity = normalizeActivityDomainState(source?.domains?.activity || source?.activity || source?.summary?.activity);
  const roblox = normalizeRobloxDomainState(source?.domains?.roblox || buildLegacyRobloxSource(source));
  const verification = normalizeVerificationDomainState(source?.domains?.verification || source?.verification || source?.summary?.verification);
  const progress = normalizeProgressDomainState(source?.domains?.progress);
  const voice = hasOwn(options, "voice")
    ? normalizeVoiceDomainState(options.voice)
    : normalizeVoiceDomainState(source?.domains?.voice);
  const social = hasOwn(options, "social")
    ? normalizeSocialDomainState(options.social)
    : normalizeSocialDomainState(source?.domains?.social);

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
      activity,
      roblox,
      verification,
      progress,
      voice,
      social,
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
  const voiceMirrors = buildVoiceMirrorIndex(db?.sot?.news);
  const nextProfiles = {};
  let mutated = !db || typeof db !== "object" || !db.profiles || typeof db.profiles !== "object" || Array.isArray(db.profiles);

  for (const [userId, rawProfile] of Object.entries(profiles)) {
    const ensured = ensureSharedProfile(rawProfile, userId, {
      voice: hasOwn(voiceMirrors, userId) ? voiceMirrors[userId] : {},
    });
    nextProfiles[userId] = ensured.profile;
    mutated ||= ensured.mutated || ensured.profile.userId !== userId;
  }

  const socialCaches = buildSocialSuggestionCache(nextProfiles);
  for (const [userId, profile] of Object.entries(nextProfiles)) {
    const ensured = ensureSharedProfile(profile, userId, {
      social: hasOwn(socialCaches, userId) ? socialCaches[userId] : {},
    });
    nextProfiles[userId] = ensured.profile;
    mutated ||= ensured.mutated || ensured.profile.userId !== userId;
  }

  db.profiles = nextProfiles;
  return { mutated, profiles: nextProfiles };
}

function clearAllRobloxRefreshDiagnostics(profiles = {}) {
  if (!profiles || typeof profiles !== "object" || Array.isArray(profiles)) {
    return {
      mutated: false,
      clearedCount: 0,
      profiles,
    };
  }

  let mutated = false;
  let clearedCount = 0;

  for (const [userId, rawProfile] of Object.entries(profiles)) {
    const ensured = ensureSharedProfile(rawProfile, userId);
    const profile = ensured.profile;
    const roblox = profile?.domains?.roblox;
    const hadRefreshDiagnostic = Boolean(roblox?.refreshError) || roblox?.refreshStatus === "error";

    if (!hadRefreshDiagnostic) {
      if (ensured.mutated) {
        profiles[userId] = profile;
        mutated = true;
      }
      continue;
    }

    applyRobloxAccountSnapshot(profile, {}, {
      verificationStatus: roblox.verificationStatus,
      verifiedAt: roblox.verifiedAt,
      updatedAt: roblox.updatedAt,
      lastSubmissionId: roblox.lastSubmissionId,
      lastReviewedAt: roblox.lastReviewedAt,
      reviewedBy: roblox.reviewedBy,
      source: roblox.source,
      lastRefreshAt: roblox.lastRefreshAt,
      refreshStatus: null,
      refreshError: null,
    });

    profiles[userId] = ensureSharedProfile(profile, userId).profile;
    mutated = true;
    clearedCount += 1;
  }

  return {
    mutated,
    clearedCount,
    profiles,
  };
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
      roleGrantEnabled: true,
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
    roblox: {},
    verification: {
      enabled: false,
      status: "",
      mode: "",
      callbackBaseUrl: "",
      reportChannelId: "",
      verificationChannelId: "",
      lastSyncAt: null,
      stageTexts: {},
      riskRules: {},
      deadline: {},
      entryMessage: {
        channelId: "",
        messageId: "",
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
      roleGrantEnabled: source?.elo?.roleGrantEnabled !== false,
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
    roblox: source?.roblox && typeof source.roblox === "object" ? cloneValue(source.roblox) : {},
    verification: {
      enabled: source?.verification?.enabled === true,
      status: cleanString(source?.verification?.status, 40),
      mode: cleanString(source?.verification?.mode, 40),
      callbackBaseUrl: cleanString(source?.verification?.callbackBaseUrl, 500),
      reportChannelId: cleanString(source?.verification?.reportChannelId, 80),
      verificationChannelId: cleanString(source?.verification?.verificationChannelId, 80),
      lastSyncAt: normalizeNullableString(source?.verification?.lastSyncAt, 80),
      stageTexts: source?.verification?.stageTexts && typeof source.verification.stageTexts === "object"
        ? cloneValue(source.verification.stageTexts)
        : {},
      riskRules: source?.verification?.riskRules && typeof source.verification.riskRules === "object"
        ? cloneValue(source.verification.riskRules)
        : {},
      deadline: source?.verification?.deadline && typeof source.verification.deadline === "object"
        ? cloneValue(source.verification.deadline)
        : {},
      entryMessage: {
        channelId: cleanString(source?.verification?.entryMessage?.channelId, 80),
        messageId: cleanString(source?.verification?.entryMessage?.messageId, 80),
      },
    },
  };

  return {
    integrations: next,
    mutated: JSON.stringify(source) !== JSON.stringify(next),
  };
}

function deriveProfileMainView(profile = {}, characterEntries = []) {
  const source = profile && typeof profile === "object" ? profile : {};
  const mainCharacterIds = normalizeStringArray(source.mainCharacterIds, 10, 80);
  const storedLabels = normalizeStringArray(source.mainCharacterLabels, 10, 120);
  const rawLabels = Array.isArray(source?.domains?.onboarding?.raw?.mainCharacterLabels)
    ? captureRawStringArray(source.domains.onboarding.raw.mainCharacterLabels, 20, 120)
    : [];
  const entriesById = new Map(
    (Array.isArray(characterEntries) ? characterEntries : [])
      .map((entry) => {
        const id = cleanString(entry?.id, 80);
        if (!id) return null;
        return [id, {
          label: cleanString(entry?.label, 120),
          roleId: cleanString(entry?.roleId, 40),
        }];
      })
      .filter(Boolean)
  );

  const mainCharacterLabels = mainCharacterIds.map((id, index) => {
    const currentEntry = entriesById.get(id);
    return cleanString(currentEntry?.label || storedLabels[index] || rawLabels[index] || id, 120);
  }).filter(Boolean);

  const characterRoleIds = [...new Set(mainCharacterIds
    .map((id) => entriesById.get(id)?.roleId)
    .map((value) => cleanString(value, 40))
    .filter(Boolean))];

  return {
    mainCharacterIds,
    mainCharacterLabels,
    characterRoleIds,
  };
}

module.exports = {
  applyRobloxAccountSnapshot,
  buildRobloxProfileUrl,
  clearAllRobloxRefreshDiagnostics,
  configureSharedProfileRuntime,
  deriveProfileMainView,
  INTEGRATION_MODE_DORMANT,
  SHARED_PROFILE_VERSION,
  createDefaultIntegrationState,
  ensureSharedProfile,
  normalizeActivityDomainState,
  normalizeIntegrationState,
  normalizeProgressDomainState,
  normalizeRobloxDomainState,
  normalizeSocialDomainState,
  normalizeVoiceDomainState,
  syncSharedProfiles,
};