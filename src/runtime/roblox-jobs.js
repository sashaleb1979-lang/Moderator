"use strict";

const { splitIntoBatches } = require("../integrations/roblox-service");
const { applyRobloxBindingRepairPass } = require("../integrations/roblox-binding-repair");
const {
  applyRobloxAccountSnapshot,
  ensureSharedProfile,
  normalizeRobloxDomainState,
} = require("../integrations/shared-profile");

function assertFunction(value, name) {
  if (typeof value !== "function") {
    throw new TypeError(`${name} must be a function`);
  }
}

function normalizePositiveInteger(value, fallback) {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : fallback;
}

function formatErrorText(error) {
  return error?.message || error;
}

function normalizeCandidateUserIds(userIds = []) {
  const unique = [];
  const seen = new Set();

  for (const value of Array.isArray(userIds) ? userIds : []) {
    const normalized = Number(value);
    if (!Number.isSafeInteger(normalized) || normalized <= 0 || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
  }

  return unique;
}

const ROBLOX_RUNTIME_DIRTY_REASONS = new Set([
  "binding_sanitized",
  "binding_repaired",
  "session_started",
  "session_closed",
  "playtime_updated",
  "coplay_updated",
]);
const ROBLOX_SESSION_HISTORY_LIMIT = 120;
const ROBLOX_PRESENCE_BATCH_SIZE = 50;

function normalizeRuntimeDiscordUserId(value = "") {
  return String(value || "").trim().slice(0, 80);
}

function normalizeRobloxRuntimeDirtyReason(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return ROBLOX_RUNTIME_DIRTY_REASONS.has(normalized) ? normalized : "";
}

function normalizeRobloxRuntimeDirtyReasonList(value = []) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => normalizeRobloxRuntimeDirtyReason(entry)).filter(Boolean))];
}

function normalizeRobloxRuntimeDirtyReasonMap(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const normalized = {};
  for (const [userId, reasons] of Object.entries(value)) {
    const normalizedUserId = normalizeRuntimeDiscordUserId(userId);
    const normalizedReasons = normalizeRobloxRuntimeDirtyReasonList(reasons);
    if (!normalizedUserId || !normalizedReasons.length) continue;
    normalized[normalizedUserId] = normalizedReasons;
  }

  return normalized;
}

function getRobloxRuntimeDirtyReasonsForUser(runtimeState = {}, userId = "") {
  const normalizedUserId = normalizeRuntimeDiscordUserId(userId);
  if (!normalizedUserId) return [];
  return normalizeRobloxRuntimeDirtyReasonList(runtimeState?.dirtyReasonsByDiscordUserId?.[normalizedUserId]);
}

function getRobloxRuntimeDirtyReasonCounts(runtimeState = {}, userIds = null) {
  const dirtyReasonMap = normalizeRobloxRuntimeDirtyReasonMap(runtimeState?.dirtyReasonsByDiscordUserId);
  const allowedUserIds = Array.isArray(userIds)
    ? new Set(userIds.map((userId) => normalizeRuntimeDiscordUserId(userId)).filter(Boolean))
    : null;
  const counts = {};

  for (const [userId, reasons] of Object.entries(dirtyReasonMap)) {
    if (allowedUserIds && !allowedUserIds.has(userId)) continue;
    for (const reason of reasons) {
      counts[reason] = (counts[reason] || 0) + 1;
    }
  }

  return counts;
}

function markRobloxRuntimeDirty(runtimeState = null, discordUserId = "", reason = "") {
  const state = ensureRobloxRuntimeState(runtimeState);
  const normalizedUserId = normalizeRuntimeDiscordUserId(discordUserId);
  const normalizedReason = normalizeRobloxRuntimeDirtyReason(reason);
  if (!normalizedUserId) return state;

  state.dirtyDiscordUserIds.add(normalizedUserId);
  state.dirty = true;

  if (normalizedReason) {
    state.dirtyReasonsByDiscordUserId[normalizedUserId] = normalizeRobloxRuntimeDirtyReasonList([
      ...(Array.isArray(state.dirtyReasonsByDiscordUserId[normalizedUserId]) ? state.dirtyReasonsByDiscordUserId[normalizedUserId] : []),
      normalizedReason,
    ]);
  }

  return state;
}

function createRobloxRuntimeState() {
  return {
    activeSessionsByDiscordUserId: {},
    activeCoPlayPairsByKey: {},
    dirtyDiscordUserIds: new Set(),
    dirtyReasonsByDiscordUserId: {},
    dirty: false,
    lastPlaytimeSyncAt: null,
    lastFlushAt: null,
  };
}

function ensureRobloxRuntimeState(runtimeState = null) {
  const state = runtimeState && typeof runtimeState === "object"
    ? runtimeState
    : createRobloxRuntimeState();

  if (!state.activeSessionsByDiscordUserId || typeof state.activeSessionsByDiscordUserId !== "object" || Array.isArray(state.activeSessionsByDiscordUserId)) {
    state.activeSessionsByDiscordUserId = {};
  }
  if (!state.activeCoPlayPairsByKey || typeof state.activeCoPlayPairsByKey !== "object" || Array.isArray(state.activeCoPlayPairsByKey)) {
    state.activeCoPlayPairsByKey = {};
  }
  if (!(state.dirtyDiscordUserIds instanceof Set)) {
    state.dirtyDiscordUserIds = new Set(Array.isArray(state.dirtyDiscordUserIds) ? state.dirtyDiscordUserIds : []);
  }
  state.dirtyReasonsByDiscordUserId = normalizeRobloxRuntimeDirtyReasonMap(state.dirtyReasonsByDiscordUserId);

  state.dirty = state.dirty === true;
  state.lastPlaytimeSyncAt = state.lastPlaytimeSyncAt || null;
  state.lastFlushAt = state.lastFlushAt || null;
  return state;
}

function normalizeRobloxTrackingConfig(config = {}) {
  const source = config && typeof config === "object" ? config : {};
  return {
    jjsUniverseId: normalizePositiveInteger(source.jjsUniverseId, 0),
    jjsRootPlaceId: normalizePositiveInteger(source.jjsRootPlaceId, 0),
    jjsPlaceId: normalizePositiveInteger(source.jjsPlaceId, 0),
    playtimePollMinutes: normalizePositiveInteger(source.playtimePollMinutes, 2),
    opaqueInGameCountsAsJjs: source.opaqueInGameCountsAsJjs !== false,
  };
}

function buildRobloxVerifiedCandidates(db = {}) {
  const profiles = db && typeof db.profiles === "object" && !Array.isArray(db.profiles)
    ? db.profiles
    : {};
  const candidates = [];

  for (const [discordUserId, rawProfile] of Object.entries(profiles)) {
    const ensured = ensureSharedProfile(rawProfile, discordUserId).profile;
    profiles[discordUserId] = ensured;

    const roblox = ensured?.domains?.roblox;
    const robloxUserId = Number(roblox?.userId);
    if (roblox?.verificationStatus !== "verified") continue;
    if (!Number.isSafeInteger(robloxUserId) || robloxUserId <= 0) continue;

    candidates.push({
      discordUserId,
      profile: ensured,
      roblox,
      robloxUserId,
    });
  }

  return candidates;
}

function buildRobloxRepairableCandidates(db = {}) {
  const profiles = db && typeof db.profiles === "object" && !Array.isArray(db.profiles)
    ? db.profiles
    : {};
  const candidates = [];
  const sanitizedDiscordUserIds = [];

  for (const [discordUserId, rawProfile] of Object.entries(profiles)) {
    const ensured = ensureSharedProfile(rawProfile, discordUserId).profile;
    profiles[discordUserId] = ensured;

    const roblox = ensured?.domains?.roblox;
    const hadSanitizedUserId = String(rawProfile?.domains?.roblox?.userId || "") !== String(roblox?.userId || "");
    if (hadSanitizedUserId) {
      sanitizedDiscordUserIds.push(discordUserId);
    }

    const robloxUserId = Number(roblox?.userId);
    if (roblox?.verificationStatus !== "verified") continue;
    if (Number.isSafeInteger(robloxUserId) && robloxUserId > 0) continue;

    const username = String(roblox?.username || "").trim();
    if (!username) continue;

    candidates.push({
      discordUserId,
      profile: ensured,
      roblox,
      username,
    });
  }

  return {
    candidates,
    sanitizedDiscordUserIds,
  };
}

async function repairRobloxVerifiedBindings(options = {}) {
  const result = await applyRobloxBindingRepairPass({
    db: options.db,
    dryRun: false,
    persistTrail: false,
    source: "playtime_sync",
    fetchUsersByUsernames: options.fetchUsersByUsernames,
    logError: options.logError,
    now: options.now,
    markDirty(discordUserId, reason) {
      if (options.runtimeState?.dirtyDiscordUserIds instanceof Set) {
        markRobloxRuntimeDirty(options.runtimeState, discordUserId, reason);
      }
    },
  });

  return {
    repairedCount: result.repairedCount,
    failedCount: 0,
    failedBatchCount: result.failedRepairBatchCount,
    unresolvedCount: result.unresolvedCount,
    sanitizedCount: result.sanitizedCount,
    skippedSuspiciousCount: result.skippedSuspiciousCount,
    restoredFromSubmissionCount: result.restoredFromSubmissionCount,
    resetSuspiciousCount: result.resetSuspiciousCount,
  };
}

function toDateKey(isoValue) {
  const timestamp = Date.parse(isoValue || "");
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : null;
}

function toMskHourKey(isoValue) {
  const timestamp = Date.parse(isoValue || "");
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp + (3 * 60 * 60 * 1000)).toISOString().slice(0, 13);
}

function canContinueTrackedSession(lastSeenAt, nowIso, maxGapMs) {
  const previousTs = Date.parse(lastSeenAt || "");
  const nowTs = Date.parse(nowIso || "");
  if (!Number.isFinite(previousTs) || !Number.isFinite(nowTs)) return false;
  const deltaMs = nowTs - previousTs;
  return deltaMs >= 0 && deltaMs <= maxGapMs;
}

function calculateTrackedMinutes(lastSeenAt, nowIso) {
  const previousTs = Date.parse(lastSeenAt || "");
  const nowTs = Date.parse(nowIso || "");
  if (!Number.isFinite(previousTs) || !Number.isFinite(nowTs) || nowTs <= previousTs) return 0;
  return Math.max(0, Math.round((nowTs - previousTs) / 60000));
}

function appendDailyMinutes(dailyBuckets = {}, nowIso, minutes, limit = 40) {
  if (!Number.isFinite(minutes) || minutes <= 0) return { ...(dailyBuckets || {}) };
  const dateKey = toDateKey(nowIso);
  if (!dateKey) return { ...(dailyBuckets || {}) };

  const next = { ...(dailyBuckets || {}) };
  next[dateKey] = Number(next[dateKey] || 0) + minutes;

  return Object.fromEntries(
    Object.entries(next)
      .filter(([bucketKey, value]) => /^\d{4}-\d{2}-\d{2}$/.test(bucketKey) && Number(value) > 0)
      .sort((left, right) => left[0].localeCompare(right[0]))
      .slice(-Math.max(1, limit))
  );
}

function appendHourlyMinutes(hourlyBucketsMsk = {}, nowIso, minutes, limit = 40 * 24) {
  if (!Number.isFinite(minutes) || minutes <= 0) return { ...(hourlyBucketsMsk || {}) };
  const hourKey = toMskHourKey(nowIso);
  if (!hourKey) return { ...(hourlyBucketsMsk || {}) };

  const next = { ...(hourlyBucketsMsk || {}) };
  next[hourKey] = Number(next[hourKey] || 0) + minutes;

  return Object.fromEntries(
    Object.entries(next)
      .filter(([bucketKey, value]) => /^\d{4}-\d{2}-\d{2}T\d{2}$/.test(bucketKey) && Number(value) > 0)
      .sort((left, right) => left[0].localeCompare(right[0]))
      .slice(-Math.max(1, limit))
  );
}

function appendRobloxSessionHistory(sessionHistory = [], session = {}, limit = ROBLOX_SESSION_HISTORY_LIMIT) {
  const startedAt = String(session?.startedAt || "").trim();
  const endedAt = String(session?.endedAt || "").trim();
  const durationMinutes = normalizePositiveInteger(session?.durationMinutes, 0);
  if (!startedAt || !endedAt || durationMinutes <= 0) {
    return Array.isArray(sessionHistory) ? sessionHistory.slice() : [];
  }

  const next = [
    ...(Array.isArray(sessionHistory) ? sessionHistory : []),
    {
      startedAt,
      endedAt,
      durationMinutes,
      gameId: String(session?.gameId || "").trim() || null,
      source: "roblox.playtime",
    },
  ];
  const seen = new Set();
  return next
    .filter((entry) => {
      const key = `${entry.startedAt}:${entry.endedAt}:${entry.gameId || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => String(left.endedAt || "").localeCompare(String(right.endedAt || "")))
    .slice(-Math.max(1, normalizePositiveInteger(limit, ROBLOX_SESSION_HISTORY_LIMIT)));
}

function sumRecentDailyMinutes(dailyBuckets = {}, nowIso, days) {
  const nowTs = Date.parse(nowIso || "");
  if (!Number.isFinite(nowTs)) return 0;
  const windowMs = Math.max(1, Number(days) || 1) * 24 * 60 * 60 * 1000;

  return Object.entries(dailyBuckets || {}).reduce((sum, [dateKey, minutes]) => {
    const bucketTs = Date.parse(`${dateKey}T00:00:00.000Z`);
    if (!Number.isFinite(bucketTs)) return sum;
    if (nowTs - bucketTs >= windowMs) return sum;
    return sum + normalizePositiveInteger(minutes, 0);
  }, 0);
}

function isPresenceInConfiguredJjs(presence = {}, config = {}) {
  const normalized = normalizeRobloxTrackingConfig(config);
  const hasAnyTarget = Boolean(normalized.jjsUniverseId || normalized.jjsRootPlaceId || normalized.jjsPlaceId);
  if (!hasAnyTarget) return false;
  if (presence?.presenceType !== "in_game") return false;

  return (normalized.jjsUniverseId && Number(presence?.universeId) === normalized.jjsUniverseId)
    || (normalized.jjsRootPlaceId && Number(presence?.rootPlaceId) === normalized.jjsRootPlaceId)
    || (normalized.jjsPlaceId && Number(presence?.placeId) === normalized.jjsPlaceId);
}

function isOpaqueInGamePresence(presence = {}) {
  if (presence?.presenceType !== "in_game") return false;
  return !(Number.isSafeInteger(Number(presence?.universeId)) && Number(presence?.universeId) > 0)
    && !(Number.isSafeInteger(Number(presence?.rootPlaceId)) && Number(presence?.rootPlaceId) > 0)
    && !(Number.isSafeInteger(Number(presence?.placeId)) && Number(presence?.placeId) > 0);
}

function shouldTrackOpaqueInGameAsJjs(presence = {}, config = {}) {
  const normalized = normalizeRobloxTrackingConfig(config);
  return normalized.opaqueInGameCountsAsJjs === true && isOpaqueInGamePresence(presence);
}

function resolvePairKey(leftUserId, rightUserId) {
  return [String(leftUserId || "").trim(), String(rightUserId || "").trim()].sort().join(":");
}

function ensureCoPlayPeer(profile, peerDiscordUserId) {
  const roblox = profile?.domains?.roblox;
  if (!roblox?.coPlay || !Array.isArray(roblox.coPlay.peers)) {
    roblox.coPlay = { peers: [], computedAt: null };
  }

  let peer = roblox.coPlay.peers.find((entry) => entry?.peerUserId === peerDiscordUserId) || null;
  if (!peer) {
    peer = {
      peerUserId: peerDiscordUserId,
      minutesTogether: 0,
      sessionsTogether: 0,
      daysTogether: 0,
      sharedJjsSessionCount: 0,
      lastSeenTogetherAt: null,
      isRobloxFriend: null,
    };
    roblox.coPlay.peers.push(peer);
  }

  return peer;
}

function classifyRobloxFriendship(roblox = {}, peerRobloxUserId, fallback = null) {
  const computedAt = roblox?.serverFriends?.computedAt || null;
  if (!computedAt) return fallback;
  const peerId = String(peerRobloxUserId || "").trim();
  return Array.isArray(roblox?.serverFriends?.userIds) && roblox.serverFriends.userIds.includes(peerId)
    ? true
    : false;
}

function resolveNowIso(options = {}) {
  if (typeof options.now === "function") {
    const value = String(options.now() || "").trim();
    if (value) return value;
  }
  return new Date().toISOString();
}

function createRobloxJobCoordinator(options = {}) {
  const logError = typeof options.logError === "function" ? options.logError : null;
  let queueTail = Promise.resolve();
  const pendingJobs = new Map();

  function run(kind, job, jobOptions = {}) {
    const jobKind = String(kind || "").trim();
    if (!jobKind) {
      throw new TypeError("kind must be a non-empty string");
    }
    assertFunction(job, "job");

    if (pendingJobs.has(jobKind)) {
      return pendingJobs.get(jobKind);
    }

    let settleJob = null;
    const scheduledJob = new Promise((resolve, reject) => {
      settleJob = { resolve, reject };
    });
    pendingJobs.set(jobKind, scheduledJob);

    queueTail = queueTail
      .catch(() => null)
      .then(async () => {
        try {
          const result = await job();
          settleJob.resolve(result);
        } catch (error) {
          if (logError && jobOptions.logErrors !== false) {
            logError(`Roblox job ${jobKind} failed:`, formatErrorText(error));
          }
          settleJob.reject(error);
        } finally {
          if (pendingJobs.get(jobKind) === scheduledJob) {
            pendingJobs.delete(jobKind);
          }
        }
      });

    return scheduledJob;
  }

  return {
    createRunner(kind, job, jobOptions = {}) {
      assertFunction(job, "job");
      return () => run(kind, job, jobOptions);
    },
    hasPendingJob(kind) {
      const jobKind = String(kind || "").trim();
      return jobKind ? pendingJobs.has(jobKind) : false;
    },
    listPendingJobKinds() {
      return [...pendingJobs.keys()];
    },
    run,
  };
}

async function runRobloxPlaytimeCycle(options = {}) {
  const fetchPresenceBatch = options.fetchPresenceBatch || options.fetchUserPresences;
  const processPresenceBatch = options.processPresenceBatch || null;
  const handleFailedBatch = options.handleFailedBatch || null;
  const logError = typeof options.logError === "function" ? options.logError : () => {};
  const candidateUserIds = normalizeCandidateUserIds(options.userIds);
  const batchSize = normalizePositiveInteger(options.batchSize, ROBLOX_PRESENCE_BATCH_SIZE);

  assertFunction(fetchPresenceBatch, "fetchPresenceBatch");
  if (processPresenceBatch != null) {
    assertFunction(processPresenceBatch, "processPresenceBatch");
  }
  if (handleFailedBatch != null) {
    assertFunction(handleFailedBatch, "handleFailedBatch");
  }

  const summary = {
    totalCandidates: candidateUserIds.length,
    totalBatches: 0,
    processedBatches: 0,
    failedBatches: 0,
    processedUserIds: 0,
    failedUserIds: 0,
  };

  for (const batchUserIds of splitIntoBatches(candidateUserIds, batchSize)) {
    summary.totalBatches += 1;

    try {
      const presences = await fetchPresenceBatch(batchUserIds);
      if (typeof processPresenceBatch === "function") {
        await processPresenceBatch(batchUserIds, Array.isArray(presences) ? presences : []);
      }
      summary.processedBatches += 1;
      summary.processedUserIds += batchUserIds.length;
    } catch (error) {
      summary.failedBatches += 1;
      summary.failedUserIds += batchUserIds.length;
      if (typeof handleFailedBatch === "function") {
        await handleFailedBatch(batchUserIds, error);
      }
      logError(`Roblox playtime batch failed [${batchUserIds.join(",")}]:`, formatErrorText(error));
    }
  }

  return summary;
}

function recalculatePlaytimeWindows(playtime, nowIso) {
  playtime.jjsMinutes7d = sumRecentDailyMinutes(playtime.dailyBuckets, nowIso, 7);
  playtime.jjsMinutes30d = sumRecentDailyMinutes(playtime.dailyBuckets, nowIso, 30);
}

function splitRuntimePairKey(pairKey) {
  return String(pairKey || "")
    .split(":")
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

async function runRobloxProfileRefreshJob(options = {}) {
  const db = options.db && typeof options.db === "object" ? options.db : null;
  const profiles = db && typeof db.profiles === "object" && !Array.isArray(db.profiles)
    ? db.profiles
    : null;
  const fetchUserProfile = options.fetchUserProfile;
  const fetchUserAvatarHeadshots = options.fetchUserAvatarHeadshots;
  const fetchUserUsernameHistory = options.fetchUserUsernameHistory;
  const logError = typeof options.logError === "function" ? options.logError : () => {};

  if (!profiles) {
    throw new TypeError("db.profiles must be an object");
  }

  assertFunction(fetchUserProfile, "fetchUserProfile");
  assertFunction(fetchUserAvatarHeadshots, "fetchUserAvatarHeadshots");
  assertFunction(fetchUserUsernameHistory, "fetchUserUsernameHistory");

  const candidates = buildRobloxVerifiedCandidates(db);

  const avatarsByUserId = new Map();
  let avatarErrors = 0;
  for (const batchUserIds of splitIntoBatches(candidates.map((candidate) => candidate.robloxUserId), 100)) {
    try {
      const avatars = await fetchUserAvatarHeadshots(batchUserIds);
      for (const avatar of Array.isArray(avatars) ? avatars : []) {
        if (Number.isSafeInteger(Number(avatar?.userId)) && Number(avatar.userId) > 0) {
          avatarsByUserId.set(Number(avatar.userId), avatar);
        }
      }
    } catch (error) {
      avatarErrors += 1;
      logError(`Roblox avatar refresh batch failed [${batchUserIds.join(",")}]:`, formatErrorText(error));
    }
  }

  const summary = {
    totalCandidates: candidates.length,
    refreshedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    avatarErrors,
  };

  for (const candidate of candidates) {
    const refreshedAt = resolveNowIso(options);
    try {
      const [nextProfile, usernameHistory] = await Promise.all([
        fetchUserProfile(candidate.robloxUserId),
        fetchUserUsernameHistory(candidate.robloxUserId),
      ]);

      if (!nextProfile?.userId) {
        throw new Error("Roblox profile lookup returned no user");
      }

      applyRobloxAccountSnapshot(candidate.profile, {
        ...nextProfile,
        avatarUrl: avatarsByUserId.get(candidate.robloxUserId)?.imageUrl || candidate.roblox.avatarUrl,
      }, {
        verificationStatus: candidate.roblox.verificationStatus,
        verifiedAt: candidate.roblox.verifiedAt,
        updatedAt: refreshedAt,
        lastSubmissionId: candidate.roblox.lastSubmissionId,
        lastReviewedAt: candidate.roblox.lastReviewedAt,
        reviewedBy: candidate.roblox.reviewedBy,
        source: candidate.roblox.source,
        lastRefreshAt: refreshedAt,
        refreshStatus: "ok",
        refreshError: null,
      });

      if (Array.isArray(usernameHistory) && usernameHistory.length) {
        candidate.profile.domains.roblox = normalizeRobloxDomainState({
          ...candidate.profile.domains.roblox,
          usernameHistory,
        });
      }

      profiles[candidate.discordUserId] = ensureSharedProfile(candidate.profile, candidate.discordUserId).profile;
      summary.refreshedCount += 1;
    } catch (error) {
      applyRobloxAccountSnapshot(candidate.profile, {
        username: candidate.roblox.username,
        userId: candidate.roblox.userId,
        displayName: candidate.roblox.displayName,
      }, {
        verificationStatus: candidate.roblox.verificationStatus,
        verifiedAt: candidate.roblox.verifiedAt,
        updatedAt: candidate.roblox.updatedAt,
        lastSubmissionId: candidate.roblox.lastSubmissionId,
        lastReviewedAt: candidate.roblox.lastReviewedAt,
        reviewedBy: candidate.roblox.reviewedBy,
        source: candidate.roblox.source,
        lastRefreshAt: refreshedAt,
        refreshStatus: "error",
        refreshError: formatErrorText(error),
      });

      profiles[candidate.discordUserId] = ensureSharedProfile(candidate.profile, candidate.discordUserId).profile;
      summary.failedCount += 1;
      logError(`Roblox profile refresh failed for ${candidate.discordUserId}/${candidate.robloxUserId}:`, formatErrorText(error));
    }
  }

  return summary;
}

async function runRobloxPlaytimeSyncJob(options = {}) {
  const db = options.db && typeof options.db === "object" ? options.db : null;
  const profiles = db && typeof db.profiles === "object" && !Array.isArray(db.profiles)
    ? db.profiles
    : null;
  const fetchUserPresences = options.fetchUserPresences || options.fetchPresenceBatch;
  const fetchUsersByUsernames = options.fetchUsersByUsernames || null;
  const logError = typeof options.logError === "function" ? options.logError : () => {};
  const runtimeState = ensureRobloxRuntimeState(options.runtimeState);
  const nowIso = resolveNowIso(options);
  const trackingConfig = normalizeRobloxTrackingConfig(options.roblox);
  const maxGapMs = Math.max(1, trackingConfig.playtimePollMinutes * 3) * 60 * 1000;

  if (!profiles) {
    throw new TypeError("db.profiles must be an object");
  }
  assertFunction(fetchUserPresences, "fetchUserPresences");
  if (fetchUsersByUsernames != null) {
    assertFunction(fetchUsersByUsernames, "fetchUsersByUsernames");
  }

  if (!trackingConfig.jjsUniverseId && !trackingConfig.jjsRootPlaceId && !trackingConfig.jjsPlaceId) {
    return {
      totalCandidates: 0,
      totalBatches: 0,
      processedBatches: 0,
      failedBatches: 0,
      processedUserIds: 0,
      failedUserIds: 0,
      activeJjsUsers: 0,
      touchedUserCount: 0,
      startedSessionCount: 0,
      closedSessionCount: 0,
      activeCoPlayPairCount: 0,
      repairedBindingCount: 0,
      unresolvedBindingCount: 0,
      failedRepairBatchCount: 0,
      sanitizedBindingCount: 0,
      skippedSuspiciousBindingCount: 0,
      restoredFromSubmissionCount: 0,
      resetSuspiciousCount: 0,
      staleSessionClosedCount: 0,
      skippedReason: "jjs_ids_not_configured",
    };
  }

  const repairSummary = await repairRobloxVerifiedBindings({
    db,
    runtimeState,
    fetchUsersByUsernames,
    now: options.now,
    logError,
  });

  const candidates = buildRobloxVerifiedCandidates(db);
  if (!candidates.length) {
    return {
      totalCandidates: 0,
      totalBatches: 0,
      processedBatches: 0,
      failedBatches: 0,
      processedUserIds: 0,
      failedUserIds: 0,
      activeJjsUsers: 0,
      opaqueInGameUsers: 0,
      touchedUserCount: 0,
      startedSessionCount: 0,
      closedSessionCount: 0,
      activeCoPlayPairCount: 0,
      repairedBindingCount: normalizePositiveInteger(repairSummary.repairedCount, 0),
      unresolvedBindingCount: normalizePositiveInteger(repairSummary.unresolvedCount, 0),
      failedRepairBatchCount: normalizePositiveInteger(repairSummary.failedRepairBatchCount, 0),
      sanitizedBindingCount: normalizePositiveInteger(repairSummary.sanitizedCount, 0),
      skippedSuspiciousBindingCount: normalizePositiveInteger(repairSummary.skippedSuspiciousCount, 0),
      restoredFromSubmissionCount: normalizePositiveInteger(repairSummary.restoredFromSubmissionCount, 0),
      resetSuspiciousCount: normalizePositiveInteger(repairSummary.resetSuspiciousCount, 0),
      staleSessionClosedCount: 0,
      skippedReason: "no_verified_candidates",
    };
  }

  const candidateByRobloxUserId = new Map(candidates.map((candidate) => [candidate.robloxUserId, candidate]));
  const presenceByRobloxUserId = new Map();
  const failedRobloxUserIds = new Set();

  const cycleSummary = await runRobloxPlaytimeCycle({
    userIds: candidates.map((candidate) => candidate.robloxUserId),
    batchSize: options.batchSize,
    fetchPresenceBatch: fetchUserPresences,
    processPresenceBatch(_batchUserIds, presences) {
      for (const presence of Array.isArray(presences) ? presences : []) {
        const robloxUserId = Number(presence?.userId);
        if (!Number.isSafeInteger(robloxUserId) || !candidateByRobloxUserId.has(robloxUserId)) continue;
        presenceByRobloxUserId.set(robloxUserId, presence);
      }
    },
    handleFailedBatch(batchUserIds) {
      for (const robloxUserId of Array.isArray(batchUserIds) ? batchUserIds : []) {
        failedRobloxUserIds.add(Number(robloxUserId));
      }
    },
    logError,
  });

  const activeUsersByGameId = new Map();
  const touchedDiscordUserIds = new Set();
  const failedDiscordUserIds = new Set();
  const opaqueInGameDiscordUserIds = new Set();
  let startedSessionCount = 0;
  let closedSessionCount = 0;
  let staleSessionClosedCount = 0;

  for (const candidate of candidates) {
    if (failedRobloxUserIds.has(candidate.robloxUserId)) {
      failedDiscordUserIds.add(candidate.discordUserId);
    }
  }

  for (const candidate of candidates) {
    if (failedRobloxUserIds.has(candidate.robloxUserId)) {
      continue;
    }

    const presence = presenceByRobloxUserId.get(candidate.robloxUserId) || null;
    const opaqueInGame = isOpaqueInGamePresence(presence);
    const inJjs = isPresenceInConfiguredJjs(presence, trackingConfig) || shouldTrackOpaqueInGameAsJjs(presence, trackingConfig);
    if (opaqueInGame) {
      opaqueInGameDiscordUserIds.add(candidate.discordUserId);
    }
    const profile = candidate.profile;
    const playtime = profile.domains.roblox.playtime;
    const activeSession = runtimeState.activeSessionsByDiscordUserId[candidate.discordUserId] || null;
    const hasPersistedSessionMarker = Boolean(playtime.currentSessionStartedAt);

    if (inJjs) {
      const gameId = opaqueInGame
        ? `opaque:${candidate.robloxUserId}`
        : String(presence?.gameId || "").trim() || `root:${presence?.rootPlaceId || "unknown"}`;
      const isContinuation = activeSession
        && activeSession.gameId === gameId
        && canContinueTrackedSession(activeSession.lastSeenAt, nowIso, maxGapMs);
      const deltaMinutes = isContinuation ? calculateTrackedMinutes(activeSession.lastSeenAt, nowIso) : 0;

      if (!isContinuation) {
        playtime.sessionCount += 1;
        playtime.currentSessionStartedAt = nowIso;
        startedSessionCount += 1;
        markRobloxRuntimeDirty(runtimeState, candidate.discordUserId, "session_started");
      }
      if (deltaMinutes > 0) {
        playtime.totalJjsMinutes += deltaMinutes;
        playtime.dailyBuckets = appendDailyMinutes(playtime.dailyBuckets, nowIso, deltaMinutes);
        playtime.hourlyBucketsMsk = appendHourlyMinutes(playtime.hourlyBucketsMsk, nowIso, deltaMinutes);
        markRobloxRuntimeDirty(runtimeState, candidate.discordUserId, "playtime_updated");
      }

      recalculatePlaytimeWindows(playtime, nowIso);
      playtime.lastSeenInJjsAt = nowIso;
      runtimeState.activeSessionsByDiscordUserId[candidate.discordUserId] = {
        startedAt: isContinuation ? activeSession.startedAt : nowIso,
        lastSeenAt: nowIso,
        gameId,
      };

      if (!activeUsersByGameId.has(gameId)) {
        activeUsersByGameId.set(gameId, []);
      }
      activeUsersByGameId.get(gameId).push(candidate);
      touchedDiscordUserIds.add(candidate.discordUserId);
      continue;
    }

    if (activeSession || hasPersistedSessionMarker) {
      delete runtimeState.activeSessionsByDiscordUserId[candidate.discordUserId];
      const sessionStartedAt = activeSession?.startedAt || playtime.currentSessionStartedAt;
      const sessionEndedAt = activeSession?.lastSeenAt || nowIso;
      const durationMinutes = calculateTrackedMinutes(sessionStartedAt, sessionEndedAt);
      if (durationMinutes > 0) {
        playtime.sessionHistory = appendRobloxSessionHistory(playtime.sessionHistory, {
          startedAt: sessionStartedAt,
          endedAt: sessionEndedAt,
          durationMinutes,
          gameId: activeSession?.gameId,
        });
      }
      playtime.currentSessionStartedAt = null;
      recalculatePlaytimeWindows(playtime, nowIso);
      touchedDiscordUserIds.add(candidate.discordUserId);
      markRobloxRuntimeDirty(runtimeState, candidate.discordUserId, "session_closed");
      if (activeSession) {
        closedSessionCount += 1;
      } else if (hasPersistedSessionMarker) {
        staleSessionClosedCount += 1;
      }
    }
  }

  const activePairKeys = new Set();
  for (const [gameId, group] of activeUsersByGameId.entries()) {
    if (!Array.isArray(group) || group.length < 2) continue;
    for (let index = 0; index < group.length; index += 1) {
      for (let peerIndex = index + 1; peerIndex < group.length; peerIndex += 1) {
        const left = group[index];
        const right = group[peerIndex];
        const pairKey = resolvePairKey(left.discordUserId, right.discordUserId);
        const runtimePair = runtimeState.activeCoPlayPairsByKey[pairKey] || null;
        const isContinuation = runtimePair
          && runtimePair.gameId === gameId
          && canContinueTrackedSession(runtimePair.lastSeenAt, nowIso, maxGapMs);
        const deltaMinutes = isContinuation ? calculateTrackedMinutes(runtimePair.lastSeenAt, nowIso) : 0;

        const leftPeer = ensureCoPlayPeer(left.profile, right.discordUserId);
        const rightPeer = ensureCoPlayPeer(right.profile, left.discordUserId);
        const currentDateKey = toDateKey(nowIso);

        if (!isContinuation) {
          leftPeer.sessionsTogether += 1;
          leftPeer.sharedJjsSessionCount += 1;
          rightPeer.sessionsTogether += 1;
          rightPeer.sharedJjsSessionCount += 1;

          if (toDateKey(leftPeer.lastSeenTogetherAt) !== currentDateKey) leftPeer.daysTogether += 1;
          if (toDateKey(rightPeer.lastSeenTogetherAt) !== currentDateKey) rightPeer.daysTogether += 1;
        }
        if (deltaMinutes > 0) {
          leftPeer.minutesTogether += deltaMinutes;
          rightPeer.minutesTogether += deltaMinutes;
        }

        leftPeer.lastSeenTogetherAt = nowIso;
        rightPeer.lastSeenTogetherAt = nowIso;
        leftPeer.isRobloxFriend = classifyRobloxFriendship(left.profile.domains.roblox, right.robloxUserId, leftPeer.isRobloxFriend);
        rightPeer.isRobloxFriend = classifyRobloxFriendship(right.profile.domains.roblox, left.robloxUserId, rightPeer.isRobloxFriend);
        left.profile.domains.roblox.coPlay.computedAt = nowIso;
        right.profile.domains.roblox.coPlay.computedAt = nowIso;

        runtimeState.activeCoPlayPairsByKey[pairKey] = {
          gameId,
          lastSeenAt: nowIso,
        };
        activePairKeys.add(pairKey);
        touchedDiscordUserIds.add(left.discordUserId);
        touchedDiscordUserIds.add(right.discordUserId);
        markRobloxRuntimeDirty(runtimeState, left.discordUserId, "coplay_updated");
        markRobloxRuntimeDirty(runtimeState, right.discordUserId, "coplay_updated");
      }
    }
  }

  for (const pairKey of Object.keys(runtimeState.activeCoPlayPairsByKey)) {
    const pairDiscordUserIds = splitRuntimePairKey(pairKey);
    if (pairDiscordUserIds.some((discordUserId) => failedDiscordUserIds.has(discordUserId))) {
      continue;
    }
    if (!activePairKeys.has(pairKey)) {
      delete runtimeState.activeCoPlayPairsByKey[pairKey];
    }
  }

  for (const discordUserId of touchedDiscordUserIds) {
    profiles[discordUserId] = ensureSharedProfile(profiles[discordUserId], discordUserId).profile;
    markRobloxRuntimeDirty(runtimeState, discordUserId);
  }

  runtimeState.lastPlaytimeSyncAt = nowIso;
  runtimeState.dirty = runtimeState.dirty || touchedDiscordUserIds.size > 0;

  return {
    totalCandidates: candidates.length,
    totalBatches: cycleSummary.totalBatches,
    processedBatches: cycleSummary.processedBatches,
    failedBatches: cycleSummary.failedBatches,
    processedUserIds: cycleSummary.processedUserIds,
    failedUserIds: cycleSummary.failedUserIds,
    activeJjsUsers: [...activeUsersByGameId.values()].reduce((sum, users) => sum + users.length, 0),
    opaqueInGameUsers: opaqueInGameDiscordUserIds.size,
    touchedUserCount: touchedDiscordUserIds.size,
    startedSessionCount,
    closedSessionCount,
    activeCoPlayPairCount: activePairKeys.size,
    repairedBindingCount: normalizePositiveInteger(repairSummary.repairedCount, 0),
    unresolvedBindingCount: normalizePositiveInteger(repairSummary.unresolvedCount, 0),
    failedRepairBatchCount: normalizePositiveInteger(repairSummary.failedRepairBatchCount, 0),
    sanitizedBindingCount: normalizePositiveInteger(repairSummary.sanitizedCount, 0),
    skippedSuspiciousBindingCount: normalizePositiveInteger(repairSummary.skippedSuspiciousCount, 0),
    restoredFromSubmissionCount: normalizePositiveInteger(repairSummary.restoredFromSubmissionCount, 0),
    resetSuspiciousCount: normalizePositiveInteger(repairSummary.resetSuspiciousCount, 0),
    staleSessionClosedCount,
  };
}

function flushRobloxRuntime(options = {}) {
  const db = options.db && typeof options.db === "object" ? options.db : null;
  const saveDb = options.saveDb;
  const runtimeState = ensureRobloxRuntimeState(options.runtimeState);
  const nowIso = resolveNowIso(options);

  if (!db || typeof db.profiles !== "object" || Array.isArray(db.profiles)) {
    throw new TypeError("db.profiles must be an object");
  }
  assertFunction(saveDb, "saveDb");

  const dirtyUserIds = [...runtimeState.dirtyDiscordUserIds];
  const dirtyReasonCounts = getRobloxRuntimeDirtyReasonCounts(runtimeState, dirtyUserIds);
  for (const discordUserId of dirtyUserIds) {
    db.profiles[discordUserId] = ensureSharedProfile(db.profiles[discordUserId], discordUserId).profile;
  }

  const saved = dirtyUserIds.length > 0;
  if (saved) {
    saveDb();
  }

  runtimeState.dirtyDiscordUserIds.clear();
  runtimeState.dirtyReasonsByDiscordUserId = {};
  runtimeState.dirty = false;
  runtimeState.lastFlushAt = nowIso;

  return {
    saved,
    dirtyUserCount: dirtyUserIds.length,
    dirtyReasonCounts,
    flushedAt: nowIso,
  };
}

module.exports = {
  createRobloxJobCoordinator,
  createRobloxRuntimeState,
  flushRobloxRuntime,
  getRobloxRuntimeDirtyReasonCounts,
  getRobloxRuntimeDirtyReasonsForUser,
  runRobloxProfileRefreshJob,
  runRobloxPlaytimeSyncJob,
  runRobloxPlaytimeCycle,
};
