"use strict";

const { splitIntoBatches } = require("../integrations/roblox-service");
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

function createRobloxRuntimeState() {
  return {
    activeSessionsByDiscordUserId: {},
    activeCoPlayPairsByKey: {},
    dirtyDiscordUserIds: new Set(),
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

function toDateKey(isoValue) {
  const timestamp = Date.parse(isoValue || "");
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : null;
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
  const batchSize = normalizePositiveInteger(options.batchSize, 100);

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
  const logError = typeof options.logError === "function" ? options.logError : () => {};
  const runtimeState = ensureRobloxRuntimeState(options.runtimeState);
  const nowIso = resolveNowIso(options);
  const trackingConfig = normalizeRobloxTrackingConfig(options.roblox);
  const maxGapMs = Math.max(1, trackingConfig.playtimePollMinutes * 3) * 60 * 1000;

  if (!profiles) {
    throw new TypeError("db.profiles must be an object");
  }
  assertFunction(fetchUserPresences, "fetchUserPresences");

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
      skippedReason: "jjs_ids_not_configured",
    };
  }

  const candidates = buildRobloxVerifiedCandidates(db);
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
  let startedSessionCount = 0;
  let closedSessionCount = 0;

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
    const inJjs = isPresenceInConfiguredJjs(presence, trackingConfig);
    const profile = candidate.profile;
    const playtime = profile.domains.roblox.playtime;
    const activeSession = runtimeState.activeSessionsByDiscordUserId[candidate.discordUserId] || null;
    const hasPersistedSessionMarker = Boolean(playtime.currentSessionStartedAt);

    if (inJjs) {
      const gameId = String(presence?.gameId || "").trim() || `root:${presence?.rootPlaceId || "unknown"}`;
      const isContinuation = activeSession
        && activeSession.gameId === gameId
        && canContinueTrackedSession(activeSession.lastSeenAt, nowIso, maxGapMs);
      const deltaMinutes = isContinuation ? calculateTrackedMinutes(activeSession.lastSeenAt, nowIso) : 0;

      if (!isContinuation) {
        playtime.sessionCount += 1;
        playtime.currentSessionStartedAt = nowIso;
        startedSessionCount += 1;
      }
      if (deltaMinutes > 0) {
        playtime.totalJjsMinutes += deltaMinutes;
        playtime.dailyBuckets = appendDailyMinutes(playtime.dailyBuckets, nowIso, deltaMinutes);
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
      playtime.currentSessionStartedAt = null;
      recalculatePlaytimeWindows(playtime, nowIso);
      touchedDiscordUserIds.add(candidate.discordUserId);
      if (activeSession) {
        closedSessionCount += 1;
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
    runtimeState.dirtyDiscordUserIds.add(discordUserId);
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
    touchedUserCount: touchedDiscordUserIds.size,
    startedSessionCount,
    closedSessionCount,
    activeCoPlayPairCount: activePairKeys.size,
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
  for (const discordUserId of dirtyUserIds) {
    db.profiles[discordUserId] = ensureSharedProfile(db.profiles[discordUserId], discordUserId).profile;
  }

  const saved = dirtyUserIds.length > 0;
  if (saved) {
    saveDb();
  }

  runtimeState.dirtyDiscordUserIds.clear();
  runtimeState.dirty = false;
  runtimeState.lastFlushAt = nowIso;

  return {
    saved,
    dirtyUserCount: dirtyUserIds.length,
    flushedAt: nowIso,
  };
}

module.exports = {
  createRobloxJobCoordinator,
  createRobloxRuntimeState,
  flushRobloxRuntime,
  runRobloxProfileRefreshJob,
  runRobloxPlaytimeSyncJob,
  runRobloxPlaytimeCycle,
};