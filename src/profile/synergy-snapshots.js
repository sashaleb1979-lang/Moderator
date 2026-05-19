"use strict";

const {
  ensureSharedProfile,
  getRobloxTrackabilityState,
  normalizeActivityDomainState,
  normalizeProgressDomainState,
  normalizeRobloxDomainState,
  normalizeSeasonArchiveDomainState,
  normalizeSocialDomainState,
  normalizeVoiceDomainState,
} = require("../integrations/shared-profile");

const PROOF_WINDOW_LIMIT = 10;
const SEASON_ARCHIVE_LIMIT = 120;
const SEASON_ARCHIVE_PEER_LIMIT = 10;

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

function normalizeStringArray(value, limit = 50, itemLimit = 120) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => cleanString(entry, itemLimit)).filter(Boolean))].slice(0, limit);
}

function normalizeIsoDayKey(value) {
  const text = cleanString(value, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function resolveIsoDayKey(dayKey, timestamp) {
  const normalizedDayKey = normalizeIsoDayKey(dayKey);
  if (normalizedDayKey) return normalizedDayKey;
  const normalizedTimestamp = normalizeNullableString(timestamp, 80);
  const parsed = Date.parse(normalizedTimestamp || "");
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

function resolveCapturedAt(value) {
  const normalized = typeof value === "function"
    ? normalizeNullableString(value(), 80)
    : normalizeNullableString(value, 80);
  return normalized || new Date().toISOString();
}

function buildSeasonArchivePeerUserIds(peers = [], limit = SEASON_ARCHIVE_PEER_LIMIT) {
  return (Array.isArray(peers) ? peers : [])
    .filter((entry) => cleanString(entry?.peerUserId, 80))
    .slice()
    .sort((left, right) => {
      const minutesDiff = normalizeNonNegativeInteger(right?.minutesTogether, 0) - normalizeNonNegativeInteger(left?.minutesTogether, 0);
      if (minutesDiff) return minutesDiff;
      const sessionsDiff = normalizeNonNegativeInteger(right?.sessionsTogether, 0) - normalizeNonNegativeInteger(left?.sessionsTogether, 0);
      if (sessionsDiff) return sessionsDiff;
      const rightSeenAt = cleanString(right?.lastSeenTogetherAt, 80);
      const leftSeenAt = cleanString(left?.lastSeenTogetherAt, 80);
      const seenDiff = rightSeenAt.localeCompare(leftSeenAt);
      if (seenDiff) return seenDiff;
      return cleanString(left?.peerUserId, 80).localeCompare(cleanString(right?.peerUserId, 80));
    })
    .map((entry) => cleanString(entry.peerUserId, 80))
    .filter(Boolean)
    .slice(0, Math.max(1, Number(limit) || SEASON_ARCHIVE_PEER_LIMIT));
}

function buildProofWindowSnapshot({ approvedKills = null, killTier = null, reviewedAt = null, reviewedBy = null, roblox = null } = {}) {
  const normalizedRoblox = normalizeRobloxDomainState(roblox || {});
  const playtime = normalizedRoblox.playtime;
  const isTrackableRoblox = getRobloxTrackabilityState(normalizedRoblox) === "trackable";

  return {
    approvedKills: normalizeNullableInteger(approvedKills, { min: 0 }),
    killTier: normalizeNullableInteger(killTier, { min: 1, max: 5 }),
    reviewedAt: normalizeNullableString(reviewedAt, 80),
    reviewedBy: normalizeNullableString(reviewedBy, 120),
    playtimeTracked: isTrackableRoblox,
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

function buildSeasonArchiveSnapshot({ profile = null, capturedAt = null, dayKey = null } = {}) {
  const sourceProfile = profile && typeof profile === "object" ? profile : {};
  const normalizedCapturedAt = normalizeNullableString(capturedAt, 80);
  const normalizedDayKey = resolveIsoDayKey(dayKey, normalizedCapturedAt);
  const activity = normalizeActivityDomainState(sourceProfile?.domains?.activity || sourceProfile?.activity || sourceProfile?.summary?.activity);
  const roblox = normalizeRobloxDomainState(sourceProfile?.domains?.roblox || sourceProfile);
  const progress = normalizeProgressDomainState(sourceProfile?.domains?.progress);
  const voice = normalizeVoiceDomainState(sourceProfile?.domains?.voice);
  const social = normalizeSocialDomainState(sourceProfile?.domains?.social);
  const tierlist = sourceProfile?.domains?.tierlist && typeof sourceProfile.domains.tierlist === "object" && !Array.isArray(sourceProfile.domains.tierlist)
    ? sourceProfile.domains.tierlist
    : (sourceProfile?.summary?.tierlist && typeof sourceProfile.summary.tierlist === "object" ? sourceProfile.summary.tierlist : {});
  const topCoPlayPeerUserIds = buildSeasonArchivePeerUserIds(roblox?.coPlay?.peers, SEASON_ARCHIVE_PEER_LIMIT);
  const isTrackableRoblox = getRobloxTrackabilityState(roblox) === "trackable";

  return {
    dayKey: normalizedDayKey,
    capturedAt: normalizedCapturedAt,
    approvedKills: normalizeNullableInteger(sourceProfile?.approvedKills ?? sourceProfile?.summary?.onboarding?.approvedKills, { min: 0 }),
    killTier: normalizeNullableInteger(sourceProfile?.killTier ?? sourceProfile?.summary?.onboarding?.killTier, { min: 1, max: 5 }),
    hasAccess: Boolean(cleanString(sourceProfile?.accessGrantedAt, 80) || cleanString(sourceProfile?.nonGgsAccessGrantedAt, 80)),
    mainCharacterIds: normalizeStringArray(sourceProfile?.mainCharacterIds, 10, 80),
    mainCharacterLabels: normalizeStringArray(sourceProfile?.mainCharacterLabels, 10, 120),
    tierlistMainId: normalizeNullableString(tierlist?.mainId, 80),
    tierlistMainName: normalizeNullableString(tierlist?.mainName, 120),
    activityScore: normalizeNullableInteger(activity?.activityScore, { min: 0 }),
    messages7d: normalizeNullableInteger(activity?.messages7d, { min: 0 }),
    sessions7d: normalizeNullableInteger(activity?.sessions7d, { min: 0 }),
    activeDays7d: normalizeNullableInteger(activity?.activeDays7d, { min: 0 }),
    daysAbsent: normalizeNullableInteger(activity?.daysAbsent, { min: 0 }),
    lastSeenAt: normalizeNullableString(activity?.lastSeenAt, 80),
    appliedActivityRoleKey: normalizeNullableString(activity?.appliedActivityRoleKey, 80),
    desiredActivityRoleKey: normalizeNullableString(activity?.desiredActivityRoleKey, 80),
    hasVerifiedRoblox: isTrackableRoblox,
    robloxUserId: normalizeNullableString(roblox?.userId, 40),
    robloxUsername: normalizeNullableString(roblox?.username, 120),
    totalJjsMinutes: normalizeNonNegativeInteger(roblox?.playtime?.totalJjsMinutes, 0),
    jjsMinutes7d: normalizeNonNegativeInteger(roblox?.playtime?.jjsMinutes7d, 0),
    jjsMinutes30d: normalizeNonNegativeInteger(roblox?.playtime?.jjsMinutes30d, 0),
    dayJjsMinutes: normalizedDayKey ? normalizeNonNegativeInteger(roblox?.playtime?.dailyBuckets?.[normalizedDayKey], 0) : 0,
    hourlyBucketCount: roblox?.playtime?.hourlyBucketsMsk && typeof roblox.playtime.hourlyBucketsMsk === "object"
      ? Object.keys(roblox.playtime.hourlyBucketsMsk).length
      : 0,
    sessionCount: normalizeNonNegativeInteger(roblox?.playtime?.sessionCount, 0),
    lastSeenInJjsAt: normalizeNullableString(roblox?.playtime?.lastSeenInJjsAt, 80),
    serverFriendsCount: Array.isArray(roblox?.serverFriends?.userIds) ? roblox.serverFriends.userIds.length : 0,
    frequentNonFriendCount: (Array.isArray(roblox?.coPlay?.peers) ? roblox.coPlay.peers : []).filter((entry) => entry?.isRobloxFriend === false).length,
    topCoPlayPeerUserIds,
    proofWindowCount: Array.isArray(progress?.proofWindows) ? progress.proofWindows.length : 0,
    lastProofWindowReviewedAt: Array.isArray(progress?.proofWindows) && progress.proofWindows.length
      ? normalizeNullableString(progress.proofWindows.at(-1)?.reviewedAt, 80)
      : null,
    lastProofWindowApprovedKills: Array.isArray(progress?.proofWindows) && progress.proofWindows.length
      ? normalizeNullableInteger(progress.proofWindows.at(-1)?.approvedKills, { min: 0 })
      : null,
    voiceSessionCount7d: normalizeNonNegativeInteger(voice?.summary?.sessionCount7d, 0),
    voiceDurationSeconds7d: normalizeNonNegativeInteger(voice?.summary?.voiceDurationSeconds7d, 0),
    voiceSessionCount30d: normalizeNonNegativeInteger(voice?.summary?.sessionCount30d, 0),
    voiceDurationSeconds30d: normalizeNonNegativeInteger(voice?.summary?.voiceDurationSeconds30d, 0),
    lastVoiceSeenAt: normalizeNullableString(voice?.summary?.lastVoiceSeenAt, 80),
    socialSuggestionCount: Array.isArray(social?.suggestions) ? social.suggestions.length : 0,
    socialSuggestionPeerUserIds: normalizeStringArray(
      (Array.isArray(social?.suggestions) ? social.suggestions : []).map((entry) => entry?.peerUserId),
      SEASON_ARCHIVE_PEER_LIMIT,
      80
    ),
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

function appendSeasonArchiveSnapshot(profile = {}, snapshot = {}, options = {}) {
  const targetProfile = profile && typeof profile === "object" ? profile : {};
  const nextSnapshot = buildSeasonArchiveSnapshot(snapshot);
  if (!nextSnapshot.dayKey || !nextSnapshot.capturedAt) {
    return {
      appended: false,
      profile: targetProfile,
      snapshot: nextSnapshot,
    };
  }

  targetProfile.domains ||= {};
  const currentSeasonArchive = normalizeSeasonArchiveDomainState(targetProfile.domains.seasonArchive);
  const existing = Array.isArray(currentSeasonArchive.snapshots) ? currentSeasonArchive.snapshots : [];
  const limit = Math.max(1, Number(options.limit) || SEASON_ARCHIVE_LIMIT);
  const nextSnapshots = existing
    .filter((entry) => cleanString(entry?.dayKey, 20) !== nextSnapshot.dayKey)
    .concat([nextSnapshot])
    .sort((left, right) => cleanString(left?.dayKey, 20).localeCompare(cleanString(right?.dayKey, 20)))
    .slice(-limit);

  targetProfile.domains.seasonArchive = {
    ...currentSeasonArchive,
    snapshots: nextSnapshots,
  };

  return {
    appended: true,
    profile: targetProfile,
    snapshot: nextSnapshot,
  };
}

function captureSeasonArchiveSnapshots(db = {}, options = {}) {
  const targetDb = db && typeof db === "object" ? db : {};
  const profiles = targetDb.profiles && typeof targetDb.profiles === "object" && !Array.isArray(targetDb.profiles)
    ? targetDb.profiles
    : {};
  const capturedAt = resolveCapturedAt(options.now);
  const dayKey = resolveIsoDayKey(options.dayKey, capturedAt);
  const limit = Math.max(1, Number(options.limit) || SEASON_ARCHIVE_LIMIT);
  const entries = Object.entries(profiles);

  if (!capturedAt || !dayKey) {
    return {
      mutated: false,
      updatedCount: 0,
      skippedCount: entries.length,
      totalProfiles: entries.length,
      capturedAt,
      dayKey,
      profiles,
    };
  }

  let mutated = false;
  let updatedCount = 0;
  let skippedCount = 0;

  for (const [userId, rawProfile] of entries) {
    const ensured = ensureSharedProfile(rawProfile, userId);
    const previousArchiveText = JSON.stringify(ensured.profile?.domains?.seasonArchive || {});
    const appended = appendSeasonArchiveSnapshot(ensured.profile, {
      profile: ensured.profile,
      capturedAt,
      dayKey,
    }, {
      limit,
    });
    const nextProfile = appended.profile;
    const nextArchiveText = JSON.stringify(nextProfile?.domains?.seasonArchive || {});
    const archiveChanged = previousArchiveText !== nextArchiveText;

    targetDb.profiles[userId] = nextProfile;
    mutated ||= ensured.mutated || archiveChanged;
    if (archiveChanged) {
      updatedCount += 1;
    } else {
      skippedCount += 1;
    }
  }

  return {
    mutated,
    updatedCount,
    skippedCount,
    totalProfiles: entries.length,
    capturedAt,
    dayKey,
    profiles: targetDb.profiles,
  };
}

module.exports = {
  PROOF_WINDOW_LIMIT,
  SEASON_ARCHIVE_LIMIT,
  appendProofWindowSnapshot,
  appendSeasonArchiveSnapshot,
  captureSeasonArchiveSnapshots,
  buildProofWindowSnapshot,
  buildSeasonArchiveSnapshot,
};