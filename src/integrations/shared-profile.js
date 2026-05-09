"use strict";

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
    activityScore: normalizeNullableInteger(source.activityScore, { min: 0 }),
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
    lastSeenAt: normalizeNullableString(source.lastSeenAt, 80),
    desiredActivityRoleKey: normalizeNullableString(source.desiredActivityRoleKey, 80),
    appliedActivityRoleKey: normalizeNullableString(source.appliedActivityRoleKey, 80),
    manualOverride: normalizeNullableBoolean(source.manualOverride),
    autoRoleFrozen: normalizeNullableBoolean(source.autoRoleFrozen),
    recalculatedAt: normalizeNullableString(source.recalculatedAt, 80),
    lastRoleAppliedAt: normalizeNullableString(source.lastRoleAppliedAt, 80),
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

function getRobloxSharedSessionCount(peer = {}) {
  return Math.max(
    normalizeNonNegativeInteger(peer?.sharedJjsSessionCount, 0),
    normalizeNonNegativeInteger(peer?.sessionsTogether, 0)
  );
}

function isFrequentRobloxNonFriendPeer(peer = {}) {
  if (peer?.isRobloxFriend !== false) return false;
  return normalizeNonNegativeInteger(peer?.minutesTogether, 0) >= ROBLOX_FREQUENT_NON_FRIEND_MINUTES
    || getRobloxSharedSessionCount(peer) >= ROBLOX_FREQUENT_NON_FRIEND_SESSIONS;
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
  const userId = normalizeNullableString(source.robloxUserId ?? source.userId, 40);
  const username = normalizeNullableString(source.robloxUsername ?? source.username, 120);
  const displayName = normalizeNullableString(source.robloxDisplayName ?? source.displayName, 120);
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
      : userId
        ? "verified"
        : "unverified",
    verifiedAt: normalizeNullableString(source.verifiedAt, 80),
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
  const activity = domains.activity || normalizeActivityDomainState(profile?.domains?.activity || profile?.activity);
  const roblox = domains.roblox || normalizeRobloxDomainState(profile?.domains?.roblox || profile);
  const previousUsername = getRobloxPreviousName(roblox.username, roblox.usernameHistory);
  const previousDisplayName = getRobloxPreviousName(roblox.displayName, roblox.displayNameHistory);
  const serverFriendsCount = roblox.serverFriends.userIds.length;
  const nonFriendPeerCount = roblox.coPlay.peers.filter((entry) => entry.isRobloxFriend === false).length;
  const frequentNonFriendCount = roblox.coPlay.peers.filter((entry) => isFrequentRobloxNonFriendPeer(entry)).length;
  const topCoPlayPeers = buildRobloxTopCoPlayPeers(roblox.coPlay.peers);
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
      activityScore: activity.activityScore,
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
      lastSeenAt: activity.lastSeenAt,
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
  };
}

function ensureSharedProfile(profile = {}, userId = "") {
  const source = profile && typeof profile === "object" ? profile : {};
  const onboarding = normalizeOnboardingDomainState(source);
  const elo = normalizeEloDomainState(source?.domains?.elo);
  const tierlist = normalizeTierlistDomainState(source?.domains?.tierlist);
  const activity = normalizeActivityDomainState(source?.domains?.activity || source?.activity);
  const roblox = normalizeRobloxDomainState(source?.domains?.roblox || buildLegacyRobloxSource(source));

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
  deriveProfileMainView,
  INTEGRATION_MODE_DORMANT,
  SHARED_PROFILE_VERSION,
  createDefaultIntegrationState,
  ensureSharedProfile,
  normalizeActivityDomainState,
  normalizeIntegrationState,
  normalizeRobloxDomainState,
  syncSharedProfiles,
};