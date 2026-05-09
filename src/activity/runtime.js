"use strict";

const { ensureSharedProfile } = require("../integrations/shared-profile");
const { ensureActivityState } = require("./state");

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function normalizeIsoTimestamp(value, fallback = null) {
  const text = cleanString(value, 80);
  if (!text) return fallback;
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

function getDateKey(value) {
  const iso = normalizeIsoTimestamp(value, null);
  return iso ? iso.slice(0, 10) : "";
}

function getActivityRuntimeNow(options = {}) {
  if (options.now instanceof Date && Number.isFinite(options.now.getTime())) {
    return options.now.toISOString();
  }
  return normalizeIsoTimestamp(options.now, new Date().toISOString());
}

function buildSessionId(session) {
  return [
    cleanString(session.guildId, 80) || "guild",
    cleanString(session.userId, 80) || "user",
    cleanString(session.startedAt, 80) || "start",
    cleanString(session.endedAt, 80) || cleanString(session.startedAt, 80) || "end",
  ].join(":");
}

function ensureOpenSessionMap(state) {
  state.runtime ||= {};
  state.runtime.openSessions ||= {};
  return state.runtime.openSessions;
}

function ensureDirtyUserSet(state) {
  state.runtime ||= {};
  const values = Array.isArray(state.runtime.dirtyUsers) ? state.runtime.dirtyUsers : [];
  const dirtyUsers = new Set(values.map((entry) => cleanString(entry, 80)).filter(Boolean));
  state.runtime.dirtyUsers = [...dirtyUsers];
  return dirtyUsers;
}

function commitDirtyUserSet(state, dirtyUsers) {
  state.runtime ||= {};
  state.runtime.dirtyUsers = [...dirtyUsers].filter(Boolean).sort();
}

function getWatchedChannelRecord(state, channelId) {
  const normalizedChannelId = cleanString(channelId, 80);
  if (!normalizedChannelId) return null;
  return (Array.isArray(state.watchedChannels) ? state.watchedChannels : []).find((entry) => entry.channelId === normalizedChannelId) || null;
}

function getSessionGapMs(config = {}) {
  return Math.max(1, Number(config.sessionGapMinutes) || 45) * 60 * 1000;
}

function getSessionBreakdownEntry(session, watchedChannel) {
  session.channelBreakdown ||= {};
  const channelId = watchedChannel.channelId;
  session.channelBreakdown[channelId] ||= {
    channelId,
    channelNameCache: cleanString(watchedChannel.channelNameCache, 200),
    channelType: cleanString(watchedChannel.channelType, 40) || "normal_chat",
    channelWeight: Number.isFinite(Number(watchedChannel.channelWeight)) ? Number(watchedChannel.channelWeight) : 1,
    messageCount: 0,
    weightedMessageCount: 0,
    sessionMessageCount: 0,
    countForTrust: watchedChannel.countForTrust !== false,
    countForRoles: watchedChannel.countForRoles !== false,
    firstMessageAt: null,
    lastMessageAt: null,
  };
  return session.channelBreakdown[channelId];
}

function getSessionDayEntry(session, dateKey, channelId) {
  session.dayBreakdown ||= {};
  session.dayBreakdown[dateKey] ||= { channels: {} };
  session.dayBreakdown[dateKey].channels[channelId] ||= {
    messageCount: 0,
    weightedMessageCount: 0,
    sessionMessageCount: 0,
    firstMessageAt: null,
    lastMessageAt: null,
  };
  return session.dayBreakdown[dateKey].channels[channelId];
}

function getEffectiveSessionBase(messageCount, config = {}) {
  const count = Number(messageCount) || 0;
  if (count <= 0) return 0;
  if (count === 1) return Number(config.sessionBaseValues?.single) || 0.45;
  if (count <= 4) return Number(config.sessionBaseValues?.burst) || 0.75;
  return Number(config.sessionBaseValues?.full) || 1;
}

function computeSessionChannelWeight(session, config = {}) {
  const entries = Object.values(session.channelBreakdown || {});
  if (!entries.length) {
    return Number(config.sessionWeightMin) || 0.35;
  }

  const averageWeight = entries.reduce((sum, entry) => sum + (Number(entry.channelWeight) || 0), 0) / entries.length;
  const minWeight = Number(config.sessionWeightMin) || 0.35;
  const maxWeight = Number(config.sessionWeightMax) || 1.15;
  return Math.min(maxWeight, Math.max(minWeight, averageWeight));
}

function resolveMainChannelId(session) {
  const entries = Object.values(session.channelBreakdown || {});
  if (!entries.length) return "";
  return entries
    .slice()
    .sort((left, right) => {
      if (right.messageCount !== left.messageCount) return right.messageCount - left.messageCount;
      return String(left.firstMessageAt || "").localeCompare(String(right.firstMessageAt || ""));
    })[0].channelId;
}

function buildPersistedSessionRecord(session, config = {}) {
  const sessionChannelWeight = computeSessionChannelWeight(session, config);
  const effectiveBase = getEffectiveSessionBase(session.sessionMessageCount, config);
  const effectiveValue = Math.min(1, effectiveBase * sessionChannelWeight);

  return {
    id: buildSessionId({ ...session, endedAt: session.endedAt || session.startedAt }),
    guildId: session.guildId,
    userId: session.userId,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    messageCount: session.messageCount,
    weightedMessageCount: session.weightedMessageCount,
    effectiveValue,
    mainChannelId: resolveMainChannelId(session),
    channelBreakdown: clone(session.channelBreakdown || {}),
  };
}

function upsertUserChannelDailyStat(state, record) {
  const list = Array.isArray(state.userChannelDailyStats) ? state.userChannelDailyStats : [];
  const index = list.findIndex((entry) => entry.guildId === record.guildId
    && entry.channelId === record.channelId
    && entry.userId === record.userId
    && entry.date === record.date);

  if (index >= 0) {
    const current = list[index];
    list[index] = {
      ...current,
      messagesCount: Number(current.messagesCount || 0) + Number(record.messagesCount || 0),
      weightedMessagesCount: Number(current.weightedMessagesCount || 0) + Number(record.weightedMessagesCount || 0),
      sessionsCount: Number(current.sessionsCount || 0) + Number(record.sessionsCount || 0),
      effectiveSessionsCount: Number(current.effectiveSessionsCount || 0) + Number(record.effectiveSessionsCount || 0),
      firstMessageAt: [current.firstMessageAt, record.firstMessageAt].filter(Boolean).sort()[0] || null,
      lastMessageAt: [current.lastMessageAt, record.lastMessageAt].filter(Boolean).sort().slice(-1)[0] || null,
    };
  } else {
    list.push({
      guildId: record.guildId,
      channelId: record.channelId,
      userId: record.userId,
      date: record.date,
      messagesCount: Number(record.messagesCount || 0),
      weightedMessagesCount: Number(record.weightedMessagesCount || 0),
      sessionsCount: Number(record.sessionsCount || 0),
      effectiveSessionsCount: Number(record.effectiveSessionsCount || 0),
      firstMessageAt: record.firstMessageAt || null,
      lastMessageAt: record.lastMessageAt || null,
    });
  }

  state.userChannelDailyStats = list;
}

function refreshChannelDailyStat(state, { guildId, channelId, date }) {
  const userStats = (Array.isArray(state.userChannelDailyStats) ? state.userChannelDailyStats : [])
    .filter((entry) => entry.guildId === guildId && entry.channelId === channelId && entry.date === date);

  const nextRecord = {
    guildId,
    channelId,
    date,
    messagesCount: userStats.reduce((sum, entry) => sum + Number(entry.messagesCount || 0), 0),
    activeUsersCount: userStats.filter((entry) => Number(entry.messagesCount || 0) > 0 || Number(entry.sessionsCount || 0) > 0).length,
    sessionsCount: userStats.reduce((sum, entry) => sum + Number(entry.sessionsCount || 0), 0),
    weightedMessagesCount: userStats.reduce((sum, entry) => sum + Number(entry.weightedMessagesCount || 0), 0),
  };

  const list = Array.isArray(state.channelDailyStats) ? state.channelDailyStats : [];
  const index = list.findIndex((entry) => entry.guildId === guildId && entry.channelId === channelId && entry.date === date);
  if (index >= 0) {
    list[index] = nextRecord;
  } else {
    list.push(nextRecord);
  }
  state.channelDailyStats = list;
}

function persistFinalizedSession(state, session, config = {}) {
  const persistedSession = buildPersistedSessionRecord(session, config);
  state.globalUserSessions ||= [];
  state.globalUserSessions.push(persistedSession);

  const sessionDate = getDateKey(persistedSession.startedAt);
  for (const [date, dayEntry] of Object.entries(session.dayBreakdown || {})) {
    for (const [channelId, channelDayEntry] of Object.entries(dayEntry.channels || {})) {
      const breakdownEntry = persistedSession.channelBreakdown[channelId] || {};
      upsertUserChannelDailyStat(state, {
        guildId: persistedSession.guildId,
        channelId,
        userId: persistedSession.userId,
        date,
        messagesCount: channelDayEntry.messageCount,
        weightedMessagesCount: channelDayEntry.weightedMessageCount,
        sessionsCount: date === sessionDate && breakdownEntry.sessionMessageCount > 0 ? 1 : 0,
        effectiveSessionsCount: date === sessionDate && breakdownEntry.sessionMessageCount > 0 ? persistedSession.effectiveValue : 0,
        firstMessageAt: channelDayEntry.firstMessageAt,
        lastMessageAt: channelDayEntry.lastMessageAt,
      });
      refreshChannelDailyStat(state, {
        guildId: persistedSession.guildId,
        channelId,
        date,
      });
    }
  }

  return persistedSession;
}

function finalizeSessionIfPresent(state, userId, config = {}) {
  const openSessions = ensureOpenSessionMap(state);
  const session = openSessions[userId];
  if (!session) return null;

  delete openSessions[userId];
  return persistFinalizedSession(state, session, config);
}

function createOpenSession({ guildId, userId, createdAt }) {
  return {
    guildId,
    userId,
    startedAt: createdAt,
    endedAt: createdAt,
    messageCount: 0,
    weightedMessageCount: 0,
    sessionMessageCount: 0,
    channelBreakdown: {},
    dayBreakdown: {},
  };
}

function mergeOpenSessionMessage(session, watchedChannel, createdAt) {
  const breakdownEntry = getSessionBreakdownEntry(session, watchedChannel);
  breakdownEntry.messageCount += 1;
  if (watchedChannel.countMessages !== false) {
    breakdownEntry.weightedMessageCount += Number(breakdownEntry.channelWeight || 0);
    session.weightedMessageCount += Number(breakdownEntry.channelWeight || 0);
  }
  if (watchedChannel.countSessions !== false) {
    breakdownEntry.sessionMessageCount += 1;
    session.sessionMessageCount += 1;
  }
  breakdownEntry.firstMessageAt = breakdownEntry.firstMessageAt || createdAt;
  breakdownEntry.lastMessageAt = createdAt;

  session.messageCount += 1;
  session.endedAt = createdAt;

  const dateKey = getDateKey(createdAt);
  const dayEntry = getSessionDayEntry(session, dateKey, watchedChannel.channelId);
  dayEntry.messageCount += 1;
  if (watchedChannel.countMessages !== false) {
    dayEntry.weightedMessageCount += Number(breakdownEntry.channelWeight || 0);
  }
  if (watchedChannel.countSessions !== false) {
    dayEntry.sessionMessageCount += 1;
  }
  dayEntry.firstMessageAt = dayEntry.firstMessageAt || createdAt;
  dayEntry.lastMessageAt = createdAt;
}

function shouldRotateSession(session, createdAt, config = {}) {
  const currentTime = new Date(createdAt).getTime();
  const lastMessageTime = new Date(session.endedAt || session.startedAt).getTime();
  return currentTime - lastMessageTime > getSessionGapMs(config);
}

function buildSnapshotCutoff(now, days) {
  const current = new Date(now);
  current.setUTCHours(0, 0, 0, 0);
  current.setUTCDate(current.getUTCDate() - (Math.max(1, Number(days) || 1) - 1));
  return current.getTime();
}

function collectUserSessionRows(state, userId) {
  const rows = (Array.isArray(state.globalUserSessions) ? state.globalUserSessions : [])
    .filter((entry) => entry.userId === userId)
    .map((entry) => clone(entry));
  const openSession = ensureOpenSessionMap(state)[userId];
  if (openSession) {
    rows.push(buildPersistedSessionRecord(openSession, state.config));
  }
  return rows;
}

function collectUserDailyRows(state, userId) {
  const rows = (Array.isArray(state.userChannelDailyStats) ? state.userChannelDailyStats : [])
    .filter((entry) => entry.userId === userId)
    .map((entry) => clone(entry));

  const openSession = ensureOpenSessionMap(state)[userId];
  if (!openSession) return rows;

  const projectedSession = buildPersistedSessionRecord(openSession, state.config);
  const sessionDate = getDateKey(projectedSession.startedAt);
  for (const [date, dayEntry] of Object.entries(openSession.dayBreakdown || {})) {
    for (const [channelId, channelDayEntry] of Object.entries(dayEntry.channels || {})) {
      const breakdownEntry = projectedSession.channelBreakdown[channelId] || {};
      rows.push({
        guildId: projectedSession.guildId,
        channelId,
        userId,
        date,
        messagesCount: channelDayEntry.messageCount,
        weightedMessagesCount: channelDayEntry.weightedMessageCount,
        sessionsCount: date === sessionDate && breakdownEntry.sessionMessageCount > 0 ? 1 : 0,
        effectiveSessionsCount: date === sessionDate && breakdownEntry.sessionMessageCount > 0 ? projectedSession.effectiveValue : 0,
        firstMessageAt: channelDayEntry.firstMessageAt,
        lastMessageAt: channelDayEntry.lastMessageAt,
      });
    }
  }

  return rows;
}

function sumSessionEffectiveValuesByWindow(sessionRows, now, days, maxPerDay) {
  const cutoff = buildSnapshotCutoff(now, days);
  const totalsByDate = new Map();
  for (const entry of sessionRows) {
    const timestamp = new Date(entry.startedAt || entry.endedAt || 0).getTime();
    if (!Number.isFinite(timestamp) || timestamp < cutoff) continue;
    const dateKey = getDateKey(entry.startedAt || entry.endedAt);
    totalsByDate.set(dateKey, (totalsByDate.get(dateKey) || 0) + Number(entry.effectiveValue || 0));
  }

  let total = 0;
  for (const value of totalsByDate.values()) {
    total += Math.min(Number(maxPerDay) || 3.2, value);
  }
  return total;
}

function getFreshnessScore(daysAbsent, config = {}) {
  const buckets = Array.isArray(config.freshnessBuckets) ? config.freshnessBuckets : [];
  for (const bucket of buckets) {
    if (daysAbsent <= Number(bucket.maxDays)) return Number(bucket.score) || 0;
  }
  return 0;
}

function getDiversityBonus(activeChannelCount, config = {}) {
  const bonuses = config.diversityBonuses || {};
  if (activeChannelCount >= 4) return Number(bonuses[4]) || 0;
  if (activeChannelCount >= 3) return Number(bonuses[3]) || 0;
  if (activeChannelCount >= 2) return Number(bonuses[2]) || 0;
  return 0;
}

function getActivityScoreCap(effectiveActiveDays, config = {}) {
  const caps = Array.isArray(config.antiSpamCaps) ? config.antiSpamCaps : [];
  for (const cap of caps) {
    if (effectiveActiveDays <= Number(cap.maxActiveDays || 0)) return Number(cap.maxScore || 0);
  }
  return 100;
}

function resolveDesiredActivityRoleKey(score, config = {}) {
  const thresholds = config.activityRoleThresholds || {};
  if (score >= Number(thresholds.core ?? 85)) return "core";
  if (score >= Number(thresholds.stable ?? 70)) return "stable";
  if (score >= Number(thresholds.active ?? 55)) return "active";
  if (score >= Number(thresholds.floating ?? 38)) return "floating";
  if (score >= Number(thresholds.weak ?? 18)) return "weak";
  return "dead";
}

function rebuildActivityUserSnapshot({ db = {}, userId = "", now } = {}) {
  const normalizedUserId = cleanString(userId, 80);
  if (!normalizedUserId) {
    throw new Error("userId is required");
  }

  const state = ensureActivityState(db);
  const config = state.config || {};
  const currentTime = getActivityRuntimeNow({ now });
  const profile = db.profiles?.[normalizedUserId] || { userId: normalizedUserId };
  const existingActivity = profile?.domains?.activity || {};
  const sessionRows = collectUserSessionRows(state, normalizedUserId);
  const dailyRows = collectUserDailyRows(state, normalizedUserId);

  const messageWindowSums = new Map([[7, 0], [30, 0], [90, 0]]);
  const sessionWindowCounts = new Map([[7, 0], [30, 0], [90, 0]]);
  const activeDaySets = new Map([[7, new Set()], [30, new Set()], [90, new Set()]]);
  const channelMessageCounts30d = new Map();
  const channelSessionCounts30d = new Map();
  const channelWeightedMessages30d = new Map();
  let lastSeenAt = null;

  for (const entry of dailyRows) {
    const timestamp = new Date(entry.lastMessageAt || entry.firstMessageAt || `${entry.date}T00:00:00.000Z`).getTime();
    if (!Number.isFinite(timestamp)) continue;
    const dateKey = cleanString(entry.date, 20) || getDateKey(entry.lastMessageAt || entry.firstMessageAt);
    const lastSeenCandidate = entry.lastMessageAt || entry.firstMessageAt || null;
    if (lastSeenCandidate && (!lastSeenAt || lastSeenCandidate > lastSeenAt)) {
      lastSeenAt = lastSeenCandidate;
    }

    for (const windowDays of [7, 30, 90]) {
      if (timestamp >= buildSnapshotCutoff(currentTime, windowDays)) {
        messageWindowSums.set(windowDays, messageWindowSums.get(windowDays) + Number(entry.messagesCount || 0));
        if (Number(entry.messagesCount || 0) > 0 || Number(entry.sessionsCount || 0) > 0) {
          activeDaySets.get(windowDays).add(dateKey);
        }
      }
    }

    if (timestamp >= buildSnapshotCutoff(currentTime, 30)) {
      channelMessageCounts30d.set(entry.channelId, (channelMessageCounts30d.get(entry.channelId) || 0) + Number(entry.messagesCount || 0));
      channelSessionCounts30d.set(entry.channelId, (channelSessionCounts30d.get(entry.channelId) || 0) + Number(entry.sessionsCount || 0));
      channelWeightedMessages30d.set(entry.channelId, (channelWeightedMessages30d.get(entry.channelId) || 0) + Number(entry.weightedMessagesCount || 0));
    }
  }

  for (const entry of sessionRows) {
    const timestamp = new Date(entry.startedAt || entry.endedAt || 0).getTime();
    if (!Number.isFinite(timestamp)) continue;
    for (const windowDays of [7, 30, 90]) {
      if (timestamp >= buildSnapshotCutoff(currentTime, windowDays)) {
        sessionWindowCounts.set(windowDays, sessionWindowCounts.get(windowDays) + 1);
      }
    }
  }

  let activeWatchedChannels30d = 0;
  for (const [channelId, messageCount] of channelMessageCounts30d.entries()) {
    const sessionsCount = channelSessionCounts30d.get(channelId) || 0;
    if (messageCount > 0 || sessionsCount > 0) {
      activeWatchedChannels30d += 1;
    }
  }

  const weightedMessages30d = [...channelWeightedMessages30d.values()].reduce((sum, value) => sum + value, 0);
  const globalEffectiveSessions30d = sumSessionEffectiveValuesByWindow(sessionRows, currentTime, 30, config.maxEffectiveSessionsPerDay);
  const effectiveActiveDays30d = activeDaySets.get(30).size;
  const daysAbsent = lastSeenAt
    ? (() => {
      const currentDate = new Date(currentTime);
      currentDate.setUTCHours(0, 0, 0, 0);
      const lastSeenDate = new Date(lastSeenAt);
      lastSeenDate.setUTCHours(0, 0, 0, 0);
      return Math.max(0, Math.round((currentDate.getTime() - lastSeenDate.getTime()) / (24 * 60 * 60 * 1000)));
    })()
    : null;
  const sessionsPart = Math.min(globalEffectiveSessions30d / (Number(config.activityScoreWindows?.sessions) || 50), 1)
    * (Number(config.activityScoreWeights?.sessions) || 36);
  const daysPart = Math.min(effectiveActiveDays30d / (Number(config.activityScoreWindows?.days) || 20), 1)
    * (Number(config.activityScoreWeights?.days) || 31);
  const freshnessPart = getFreshnessScore(daysAbsent ?? Number.POSITIVE_INFINITY, config);
  const messagesPart = Math.min(weightedMessages30d / (Number(config.activityScoreWindows?.messages) || 250), 1)
    * (Number(config.activityScoreWeights?.messages) || 10);
  const diversityPart = getDiversityBonus(activeWatchedChannels30d, config);
  const uncappedScore = sessionsPart + daysPart + freshnessPart + messagesPart + diversityPart;
  const activityScore = Math.round(Math.min(getActivityScoreCap(effectiveActiveDays30d, config), Math.min(100, uncappedScore)));

  const snapshot = {
    activityScore,
    trustScore: Number.isSafeInteger(existingActivity.trustScore) ? existingActivity.trustScore : null,
    messages7d: messageWindowSums.get(7),
    messages30d: messageWindowSums.get(30),
    messages90d: messageWindowSums.get(90),
    sessions7d: sessionWindowCounts.get(7),
    sessions30d: sessionWindowCounts.get(30),
    sessions90d: sessionWindowCounts.get(90),
    activeDays7d: activeDaySets.get(7).size,
    activeDays30d: activeDaySets.get(30).size,
    activeDays90d: activeDaySets.get(90).size,
    activeWatchedChannels30d,
    weightedMessages30d,
    globalEffectiveSessions30d,
    effectiveActiveDays30d,
    daysAbsent,
    lastSeenAt,
    desiredActivityRoleKey: resolveDesiredActivityRoleKey(activityScore, config),
    appliedActivityRoleKey: cleanString(existingActivity.appliedActivityRoleKey, 80) || null,
    manualOverride: existingActivity.manualOverride === true,
    autoRoleFrozen: existingActivity.autoRoleFrozen === true,
    recalculatedAt: currentTime,
    lastRoleAppliedAt: normalizeIsoTimestamp(existingActivity.lastRoleAppliedAt, null),
  };

  state.userSnapshots ||= {};
  state.userSnapshots[normalizedUserId] = clone(snapshot);
  return snapshot;
}

function mirrorActivitySnapshotToProfile(db, userId, snapshot) {
  db.profiles ||= {};
  const currentProfile = db.profiles[userId] && typeof db.profiles[userId] === "object"
    ? db.profiles[userId]
    : { userId };
  const nextProfile = clone(currentProfile);
  nextProfile.domains ||= {};
  const preservedActivity = nextProfile.domains.activity && typeof nextProfile.domains.activity === "object"
    ? nextProfile.domains.activity
    : {};
  nextProfile.domains.activity = {
    ...preservedActivity,
    ...clone(snapshot),
  };

  db.profiles[userId] = ensureSharedProfile(nextProfile, userId).profile;
  return db.profiles[userId];
}

function recordActivityMessage({ db = {}, message = {} } = {}) {
  const state = ensureActivityState(db);
  const config = state.config || {};
  const createdAt = normalizeIsoTimestamp(message.createdAt, null);
  const guildId = cleanString(message.guildId, 80);
  const userId = cleanString(message.userId, 80);
  const channelId = cleanString(message.channelId, 80);

  if (!createdAt || !guildId || !userId || !channelId) {
    throw new Error("guildId, userId, channelId, and createdAt are required");
  }

  const watchedChannel = getWatchedChannelRecord(state, channelId);
  if (!watchedChannel || watchedChannel.enabled === false) {
    return { ignored: true, reason: "channel-not-watched" };
  }

  const openSessions = ensureOpenSessionMap(state);
  const dirtyUsers = ensureDirtyUserSet(state);
  let session = openSessions[userId] || null;
  let rotatedPreviousSession = false;

  if (session && shouldRotateSession(session, createdAt, config)) {
    finalizeSessionIfPresent(state, userId, config);
    rotatedPreviousSession = true;
    session = null;
  }

  if (!session) {
    session = createOpenSession({ guildId, userId, createdAt });
    openSessions[userId] = session;
  }

  mergeOpenSessionMessage(session, watchedChannel, createdAt);
  dirtyUsers.add(userId);
  commitDirtyUserSet(state, dirtyUsers);

  return {
    ignored: false,
    rotatedPreviousSession,
    session: clone(session),
  };
}

async function flushActivityRuntime({ db = {}, now, saveDb, runSerialized } = {}) {
  const execute = async () => {
    const state = ensureActivityState(db);
    const config = state.config || {};
    const currentTime = getActivityRuntimeNow({ now });
    const openSessions = ensureOpenSessionMap(state);
    const dirtyUsers = ensureDirtyUserSet(state);
    let finalizedSessionCount = 0;

    for (const [userId, session] of Object.entries(openSessions)) {
      if (!session || !shouldRotateSession(session, currentTime, config)) continue;
      finalizeSessionIfPresent(state, userId, config);
      dirtyUsers.add(userId);
      finalizedSessionCount += 1;
    }

    const rebuiltUsers = [];
    for (const userId of [...dirtyUsers]) {
      const snapshot = rebuildActivityUserSnapshot({ db, userId, now: currentTime });
      mirrorActivitySnapshotToProfile(db, userId, snapshot);
      rebuiltUsers.push(userId);
    }

    commitDirtyUserSet(state, new Set());
    state.runtime.lastFlushAt = currentTime;
    db.sot.activity = state;
    if (typeof saveDb === "function") {
      saveDb();
    }

    return {
      finalizedSessionCount,
      rebuiltUserCount: rebuiltUsers.length,
      rebuiltUsers,
      flushedAt: currentTime,
    };
  };

  if (typeof runSerialized === "function") {
    return runSerialized(execute, "activity-runtime-flush");
  }
  return execute();
}

async function resumeActivityRuntime({ db = {}, now, saveDb, runSerialized } = {}) {
  const execute = async () => {
    const state = ensureActivityState(db);
    const resumedAt = getActivityRuntimeNow({ now });
    state.runtime.lastResumeAt = resumedAt;
    db.sot.activity = state;
    if (typeof saveDb === "function") {
      saveDb();
    }
    return {
      resumedAt,
      openSessionCount: Object.keys(state.runtime.openSessions || {}).length,
    };
  };

  if (typeof runSerialized === "function") {
    return runSerialized(execute, "activity-runtime-resume");
  }
  return execute();
}

module.exports = {
  flushActivityRuntime,
  getEffectiveSessionBase,
  rebuildActivityUserSnapshot,
  recordActivityMessage,
  resumeActivityRuntime,
};
