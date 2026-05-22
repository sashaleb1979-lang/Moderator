"use strict";

const {
  ensureSharedProfile,
  getRobloxTrackabilityState,
  normalizeActivityDomainState,
  normalizeProgressDomainState,
  normalizeRobloxDomainState,
  normalizeSeasonArchiveDomainState,
  normalizeSocialDomainState,
  normalizeSupportDomainState,
  normalizeVoiceDomainState,
} = require("../integrations/shared-profile");

const PROOF_WINDOW_LIMIT = 10;
const SEASON_ARCHIVE_LIMIT = 120;
const SEASON_ARCHIVE_PEER_LIMIT = 10;
const WEEKLY_ROLLUP_LIMIT = 26;
const POPULATION_SNAPSHOT_LIMIT = 120;

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

function normalizeNullableNumber(value, options = {}) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  if (Number.isFinite(options.min) && amount < options.min) return null;
  if (Number.isFinite(options.max) && amount > options.max) return null;
  return amount;
}

function clampNumber(value, min = 0, max = 100) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return min;
  return Math.min(max, Math.max(min, amount));
}

function buildLetterGrade(score = null) {
  const amount = Number(score);
  if (!Number.isFinite(amount)) return "N/A";
  if (amount >= 97) return "S+";
  if (amount >= 92) return "S";
  if (amount >= 87) return "A+";
  if (amount >= 82) return "A";
  if (amount >= 77) return "A-";
  if (amount >= 72) return "B+";
  if (amount >= 67) return "B";
  if (amount >= 62) return "B-";
  if (amount >= 55) return "C+";
  if (amount >= 48) return "C";
  if (amount >= 42) return "C-";
  if (amount >= 35) return "D+";
  if (amount >= 28) return "D";
  return "D-";
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

function parseIsoDayKey(value) {
  const normalized = normalizeIsoDayKey(value);
  if (!normalized) return NaN;
  const [year, month, day] = normalized.split("-").map((entry) => Number(entry));
  return Date.UTC(year, month - 1, day, 12, 0, 0, 0);
}

function formatIsoDayKey(timestamp) {
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : null;
}

function resolveIsoDayKey(dayKey, timestamp) {
  const normalizedDayKey = normalizeIsoDayKey(dayKey);
  if (normalizedDayKey) return normalizedDayKey;
  const normalizedTimestamp = normalizeNullableString(timestamp, 80);
  const parsed = Date.parse(normalizedTimestamp || "");
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

function getIsoWeekParts(dayKey) {
  const timestamp = parseIsoDayKey(dayKey);
  if (!Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  const dayOfWeek = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayOfWeek);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1, 12, 0, 0, 0);
  const week = Math.ceil((((date.getTime() - yearStart) / (24 * 60 * 60 * 1000)) + 1) / 7);
  const weekYear = date.getUTCFullYear();
  const startTimestamp = timestamp - (dayOfWeek - 1) * 24 * 60 * 60 * 1000;
  return {
    weekKey: `${weekYear}-W${String(week).padStart(2, "0")}`,
    startDayKey: formatIsoDayKey(startTimestamp),
    endDayKey: formatIsoDayKey(startTimestamp + 6 * 24 * 60 * 60 * 1000),
  };
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
  const support = normalizeSupportDomainState(sourceProfile?.domains?.support || sourceProfile?.summary?.support);
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
    lifetimeVoiceSessionCount: normalizeNonNegativeInteger(voice?.summary?.lifetimeSessionCount, 0),
    lifetimeVoiceDurationSeconds: normalizeNonNegativeInteger(voice?.summary?.lifetimeVoiceDurationSeconds, 0),
    lastVoiceSeenAt: normalizeNullableString(voice?.summary?.lastVoiceSeenAt, 80),
    socialSuggestionCount: Array.isArray(social?.suggestions) ? social.suggestions.length : 0,
    socialSuggestionPeerUserIds: normalizeStringArray(
      (Array.isArray(social?.suggestions) ? social.suggestions : []).map((entry) => entry?.peerUserId),
      SEASON_ARCHIVE_PEER_LIMIT,
      80
    ),
    antiteamSupportPoints: support?.antiteam?.sourceAvailable === true
      ? normalizeNonNegativeInteger(support.antiteam.confirmedArrived, 0)
      : null,
  };
}

function sumSnapshotField(snapshots = [], fieldName = "") {
  return snapshots.reduce((sum, snapshot) => {
    const value = normalizeNullableNumber(snapshot?.[fieldName], { min: 0 });
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);
}

function sumSnapshotDayDeltaField(snapshots = [], fieldName = "") {
  let hasValue = false;
  const sum = (Array.isArray(snapshots) ? snapshots : []).reduce((total, snapshot) => {
    const value = normalizeNullableNumber(snapshot?.dayDeltas?.[fieldName], { min: 0 });
    if (!Number.isFinite(value)) return total;
    hasValue = true;
    return total + value;
  }, 0);
  return hasValue ? sum : null;
}

function computeSnapshotDelta(current = {}, previous = {}, fieldName = "") {
  const currentValue = normalizeNullableInteger(current?.[fieldName], { min: 0 });
  const previousValue = normalizeNullableInteger(previous?.[fieldName], { min: 0 });
  if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue)) return null;
  if (currentValue < previousValue) return null;
  return currentValue - previousValue;
}

function buildSeasonArchiveDayDeltas(current = {}, previous = null) {
  const hasPreviousSnapshot = Boolean(previous);
  const jjsMinutes = normalizeNonNegativeInteger(current?.dayJjsMinutes, 0);
  if (!hasPreviousSnapshot) {
    return {
      hasPreviousSnapshot: false,
      jjsMinutes,
      totalJjsMinutes: null,
      sessionCount: null,
      approvedKills: null,
      antiteamSupportPoints: null,
      voiceSeconds: null,
      voiceSessionCount: null,
      confidenceState: jjsMinutes > 0 ? "heuristic" : "sparse",
    };
  }

  const totalJjsMinutes = computeSnapshotDelta(current, previous, "totalJjsMinutes");
  const sessionCount = computeSnapshotDelta(current, previous, "sessionCount");
  const approvedKills = computeSnapshotDelta(current, previous, "approvedKills");
  const antiteamSupportPoints = computeSnapshotDelta(current, previous, "antiteamSupportPoints");
  const voiceSeconds = computeSnapshotDelta(current, previous, "lifetimeVoiceDurationSeconds");
  const voiceSessionCount = computeSnapshotDelta(current, previous, "lifetimeVoiceSessionCount");
  const reliableSignals = [
    totalJjsMinutes,
    sessionCount,
    approvedKills,
    antiteamSupportPoints,
    voiceSeconds,
    voiceSessionCount,
  ].filter((entry) => Number.isFinite(entry)).length;

  return {
    hasPreviousSnapshot: true,
    jjsMinutes,
    totalJjsMinutes,
    sessionCount,
    approvedKills,
    antiteamSupportPoints,
    voiceSeconds,
    voiceSessionCount,
    confidenceState: reliableSignals >= 3 ? "reliable" : reliableSignals >= 1 ? "partial" : "heuristic",
  };
}

function enrichSeasonArchiveSnapshotsWithDayDeltas(snapshots = []) {
  const sorted = (Array.isArray(snapshots) ? snapshots : [])
    .filter((entry) => normalizeIsoDayKey(entry?.dayKey))
    .slice()
    .sort((left, right) => cleanString(left?.dayKey, 20).localeCompare(cleanString(right?.dayKey, 20)));

  return sorted.map((snapshot, index) => ({
    ...snapshot,
    dayDeltas: buildSeasonArchiveDayDeltas(snapshot, index > 0 ? sorted[index - 1] : null),
  }));
}

function buildWeeklyComposite({ totals = {}, coverage = {} } = {}) {
  const coveragePercent = normalizeNullableNumber(coverage.coveragePercent, { min: 0, max: 100 });
  const score = clampNumber(
    Math.min(24, (Number(totals.jjsMinutes) || 0) / 900 * 24)
      + Math.min(18, (Number(totals.messages) || 0) / 210 * 18)
      + Math.min(12, (Number(totals.sessions) || 0) / 21 * 12)
      + Math.min(16, (Number(totals.voiceSeconds) || 0) / 7200 * 16)
      + Math.min(16, (Number(totals.approvedKillsDelta) || 0) / 400 * 16)
      + Math.min(8, (Number(totals.antiteamPointsDelta) || 0) * 4)
      + Math.min(6, (Number(coveragePercent) || 0) / 100 * 6),
    0,
    100
  );
  const roundedScore = Math.round(score);
  const confidenceState = Number(coveragePercent) >= 85
    ? "reliable"
    : Number(coveragePercent) >= 50
      ? "partial"
      : "sparse";

  return {
    score: roundedScore,
    grade: buildLetterGrade(roundedScore),
    confidenceState,
    influenceDebuffPercent: confidenceState === "reliable" ? 0 : confidenceState === "partial" ? 15 : 40,
  };
}

function buildWeeklyRollupFromSnapshots(weekKey, weekParts, snapshots = []) {
  const sorted = (Array.isArray(snapshots) ? snapshots : [])
    .filter((entry) => normalizeIsoDayKey(entry?.dayKey))
    .slice()
    .sort((left, right) => String(left.dayKey).localeCompare(String(right.dayKey)));
  if (!weekKey || !weekParts || !sorted.length) return null;

  const dayKeys = new Set(sorted.map((entry) => entry.dayKey));
  const expectedDays = 7;
  const coveredDays = dayKeys.size;
  const missingDays = Math.max(0, expectedDays - coveredDays);
  const coveragePercent = (coveredDays / expectedDays) * 100;
  const latest = sorted.at(-1);
  const first = sorted[0];
  const latestKills = normalizeNullableInteger(latest?.approvedKills, { min: 0 });
  const firstKills = normalizeNullableInteger(first?.approvedKills, { min: 0 });
  const latestAntiteamPoints = normalizeNullableInteger(latest?.antiteamSupportPoints, { min: 0 });
  const firstAntiteamPoints = normalizeNullableInteger(first?.antiteamSupportPoints, { min: 0 });
  const deltaSessions = sumSnapshotDayDeltaField(sorted, "sessionCount");
  const deltaVoiceSeconds = sumSnapshotDayDeltaField(sorted, "voiceSeconds");
  const deltaApprovedKills = sumSnapshotDayDeltaField(sorted, "approvedKills");
  const deltaAntiteamPoints = sumSnapshotDayDeltaField(sorted, "antiteamSupportPoints");
  const totals = {
    jjsMinutes: sumSnapshotField(sorted, "dayJjsMinutes"),
    messages: normalizeNonNegativeInteger(latest?.messages7d, 0),
    sessions: Number.isFinite(deltaSessions) ? deltaSessions : normalizeNonNegativeInteger(latest?.sessions7d, 0),
    voiceSeconds: Number.isFinite(deltaVoiceSeconds) ? deltaVoiceSeconds : normalizeNonNegativeInteger(latest?.voiceDurationSeconds7d, 0),
    antiteamPointsDelta: Number.isFinite(deltaAntiteamPoints)
      ? deltaAntiteamPoints
      : Number.isFinite(latestAntiteamPoints) && Number.isFinite(firstAntiteamPoints)
      ? Math.max(0, latestAntiteamPoints - firstAntiteamPoints)
      : null,
    approvedKillsDelta: Number.isFinite(deltaApprovedKills)
      ? deltaApprovedKills
      : Number.isFinite(latestKills) && Number.isFinite(firstKills)
      ? Math.max(0, latestKills - firstKills)
      : null,
  };
  const coverage = {
    expectedDays,
    coveredDays,
    missingDays,
    coveragePercent: Math.round(coveragePercent * 10) / 10,
    completePercent: Math.round(coveragePercent * 10) / 10,
    fragmentedPercent: Math.round(Math.max(0, 100 - coveragePercent) * 10) / 10,
  };

  return {
    weekKey,
    startDayKey: weekParts.startDayKey,
    endDayKey: weekParts.endDayKey,
    capturedAt: normalizeNullableString(latest?.capturedAt, 80),
    coverage,
    totals,
    composite: buildWeeklyComposite({ totals, coverage }),
  };
}

function buildSeasonArchiveWeeklyRollups(snapshots = [], options = {}) {
  const groups = new Map();
  for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
    const weekParts = getIsoWeekParts(snapshot?.dayKey);
    if (!weekParts) continue;
    if (!groups.has(weekParts.weekKey)) {
      groups.set(weekParts.weekKey, {
        weekParts,
        snapshots: [],
      });
    }
    groups.get(weekParts.weekKey).snapshots.push(snapshot);
  }

  const limit = Math.max(1, Number(options.limit) || WEEKLY_ROLLUP_LIMIT);
  return [...groups.entries()]
    .map(([weekKey, group]) => buildWeeklyRollupFromSnapshots(weekKey, group.weekParts, group.snapshots))
    .filter(Boolean)
    .sort((left, right) => String(left.weekKey).localeCompare(String(right.weekKey)))
    .slice(-limit);
}

function getLatestProofWindowForPopulation(profile = {}) {
  const progress = normalizeProgressDomainState(profile?.domains?.progress);
  return progress.proofWindows.length ? progress.proofWindows.at(-1) : null;
}

function getPreviousProofWindowForPopulation(profile = {}) {
  const progress = normalizeProgressDomainState(profile?.domains?.progress);
  return progress.proofWindows.length >= 2 ? progress.proofWindows.at(-2) : null;
}

function computePopulationKillsPerCoveredDay(profile = {}) {
  const previous = getPreviousProofWindowForPopulation(profile);
  const latest = getLatestProofWindowForPopulation(profile);
  const previousKills = normalizeNullableInteger(previous?.approvedKills, { min: 0 });
  const latestKills = normalizeNullableInteger(latest?.approvedKills, { min: 0 });
  const previousAt = Date.parse(String(previous?.reviewedAt || ""));
  const latestAt = Date.parse(String(latest?.reviewedAt || ""));
  if (!Number.isFinite(previousKills) || !Number.isFinite(latestKills) || latestKills < previousKills) return null;
  if (!Number.isFinite(previousAt) || !Number.isFinite(latestAt) || latestAt <= previousAt) return null;
  return (latestKills - previousKills) / ((latestAt - previousAt) / (24 * 60 * 60 * 1000));
}

function computePopulationActiveVoiceShare(activity = {}) {
  const effectiveVoiceHours = normalizeNullableNumber(activity?.effectiveVoiceHours30d, { min: 0 });
  const effectiveActiveVoiceHours = normalizeNullableNumber(activity?.effectiveActiveVoiceSignalHours30d, { min: 0 });
  if (Number.isFinite(effectiveVoiceHours) && effectiveVoiceHours > 0 && Number.isFinite(effectiveActiveVoiceHours)) {
    return clampNumber((effectiveActiveVoiceHours / effectiveVoiceHours) * 100, 0, 100);
  }

  const voiceSeconds = normalizeNullableInteger(activity?.voiceDurationSeconds30d, { min: 0 });
  const activeVoiceSeconds = normalizeNullableInteger(activity?.activeVoiceDurationSeconds30d, { min: 0 });
  if (Number.isFinite(voiceSeconds) && voiceSeconds > 0 && Number.isFinite(activeVoiceSeconds)) {
    return clampNumber((activeVoiceSeconds / voiceSeconds) * 100, 0, 100);
  }

  return null;
}

function collectPopulationSnapshotAxisValues(profile = {}) {
  const summary = profile?.summary && typeof profile.summary === "object" ? profile.summary : {};
  const domains = profile?.domains && typeof profile.domains === "object" ? profile.domains : {};
  const rawActivity = domains.activity && typeof domains.activity === "object" ? domains.activity : summary.activity;
  const rawRoblox = domains.roblox && typeof domains.roblox === "object" ? domains.roblox : summary.roblox;
  const rawVoiceDomain = domains.voice && typeof domains.voice === "object" ? domains.voice : {};
  const rawVoice = rawVoiceDomain.summary && typeof rawVoiceDomain.summary === "object" ? rawVoiceDomain.summary : summary.voice;
  const activity = normalizeActivityDomainState(rawActivity);
  const activityVoiceSeconds30d = normalizeNullableNumber(activity?.voiceDurationSeconds30d, { min: 0 });
  const mirrorVoiceSeconds30d = normalizeNullableNumber(rawVoice?.voiceDurationSeconds30d, { min: 0 });
  const activityVoiceSessions30d = normalizeNullableNumber(activity?.voiceSessions30d, { min: 0 });
  const mirrorVoiceSessions30d = normalizeNullableNumber(rawVoice?.sessionCount30d, { min: 0 });
  const support = normalizeSupportDomainState(profile?.domains?.support || summary.support);
  const hasRobloxSignal = Boolean(
    cleanString(rawRoblox?.userId, 80)
      || cleanString(rawRoblox?.username || rawRoblox?.currentUsername, 120)
      || rawRoblox?.hasVerifiedAccount === true
      || cleanString(rawRoblox?.verificationStatus, 40) === "verified"
  );
  const hasVoiceSignal = Boolean(
    cleanString(rawVoice?.lastCapturedAt || rawVoice?.lastVoiceSeenAt, 80)
      || (Number(activityVoiceSeconds30d) || 0) > 0
      || (Number(activityVoiceSessions30d) || 0) > 0
      || (Number(rawVoice?.voiceDurationSeconds30d) || 0) > 0
      || (Number(rawVoice?.sessionCount30d) || 0) > 0
      || (Number(activity?.effectiveVoiceHours30d) || 0) > 0
      || (Number(activity?.voiceSessions30d) || 0) > 0
  );
  const values = {
    jjs_time_30d: hasRobloxSignal ? normalizeNullableNumber(rawRoblox?.playtime?.jjsMinutes30d ?? rawRoblox?.jjsMinutes30d, { min: 0 }) : null,
    discord_messages_30d: normalizeNullableNumber(activity?.messages30d, { min: 0 }),
    discord_sessions_30d: normalizeNullableNumber(activity?.sessions30d, { min: 0 }),
    voice_hours_30d: hasVoiceSignal ? (activityVoiceSeconds30d ?? mirrorVoiceSeconds30d) : null,
    voice_sessions_30d: hasVoiceSignal ? (activityVoiceSessions30d ?? mirrorVoiceSessions30d) : null,
    active_voice_share_30d: hasVoiceSignal ? computePopulationActiveVoiceShare(activity) : null,
    jjs_session_count: hasRobloxSignal ? normalizeNullableNumber(rawRoblox?.playtime?.sessionCount ?? rawRoblox?.sessionCount, { min: 0 }) : null,
    kills_per_covered_day: computePopulationKillsPerCoveredDay(profile),
    antiteam_support_points: support?.antiteam?.sourceAvailable === true
      ? normalizeNullableNumber(support.antiteam.confirmedArrived, { min: 0 })
      : null,
  };

  if (Number.isFinite(values.voice_hours_30d)) values.voice_hours_30d /= 3600;
  if (Number.isFinite(values.jjs_time_30d)) values.jjs_time_30d /= 60;
  return values;
}

function buildProfilePopulationSnapshot({ profiles = {}, capturedAt = null, dayKey = null } = {}) {
  const normalizedCapturedAt = normalizeNullableString(capturedAt, 80) || new Date().toISOString();
  const normalizedDayKey = resolveIsoDayKey(dayKey, normalizedCapturedAt);
  const axes = {
    jjs_time_30d: [],
    discord_messages_30d: [],
    discord_sessions_30d: [],
    voice_hours_30d: [],
    voice_sessions_30d: [],
    active_voice_share_30d: [],
    jjs_session_count: [],
    kills_per_covered_day: [],
    antiteam_support_points: [],
  };
  const entries = Object.entries(profiles && typeof profiles === "object" && !Array.isArray(profiles) ? profiles : {});
  let eligibleProfileCount = 0;

  for (const [, profile] of entries) {
    const values = collectPopulationSnapshotAxisValues(profile);
    let hasAnyAxis = false;
    for (const [axisName, rawValue] of Object.entries(values)) {
      if (!Number.isFinite(rawValue)) continue;
      axes[axisName].push(rawValue);
      hasAnyAxis = true;
    }
    if (hasAnyAxis) eligibleProfileCount += 1;
  }

  return {
    dayKey: normalizedDayKey,
    capturedAt: normalizedCapturedAt,
    profileCount: entries.length,
    eligibleProfileCount,
    axes: Object.fromEntries(Object.entries(axes).map(([axisName, values]) => [
      axisName,
      {
        sampleSize: values.length,
        values: values.slice().sort((left, right) => left - right),
      },
    ])),
  };
}

function captureProfilePopulationSnapshot(db = {}, options = {}) {
  const targetDb = db && typeof db === "object" ? db : {};
  const profiles = targetDb.profiles && typeof targetDb.profiles === "object" && !Array.isArray(targetDb.profiles)
    ? targetDb.profiles
    : {};
  const capturedAt = resolveCapturedAt(options.now);
  const dayKey = resolveIsoDayKey(options.dayKey, capturedAt);
  const nextProfiles = {};
  let profileMutated = false;

  for (const [userId, rawProfile] of Object.entries(profiles)) {
    const ensured = ensureSharedProfile(rawProfile, userId);
    nextProfiles[userId] = ensured.profile;
    profileMutated ||= ensured.mutated || ensured.profile.userId !== userId;
  }

  const snapshot = buildProfilePopulationSnapshot({
    profiles: nextProfiles,
    capturedAt,
    dayKey,
  });
  targetDb.profiles = nextProfiles;
  targetDb.analytics ||= {};
  const existing = Array.isArray(targetDb.analytics.profilePopulationSnapshots)
    ? targetDb.analytics.profilePopulationSnapshots
    : [];
  const limit = Math.max(1, Number(options.limit) || POPULATION_SNAPSHOT_LIMIT);
  const nextSnapshots = existing
    .filter((entry) => cleanString(entry?.dayKey, 20) !== dayKey)
    .concat([snapshot])
    .filter((entry) => cleanString(entry?.dayKey, 20))
    .sort((left, right) => cleanString(left?.dayKey, 20).localeCompare(cleanString(right?.dayKey, 20)))
    .slice(-limit);
  const previousText = JSON.stringify(targetDb.analytics.profilePopulationSnapshots || []);
  const nextText = JSON.stringify(nextSnapshots);
  targetDb.analytics.profilePopulationSnapshots = nextSnapshots;

  return {
    mutated: profileMutated || previousText !== nextText,
    capturedAt,
    dayKey,
    profileCount: snapshot.profileCount,
    eligibleProfileCount: snapshot.eligibleProfileCount,
    snapshot,
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
  const nextSnapshots = enrichSeasonArchiveSnapshotsWithDayDeltas(existing
    .filter((entry) => cleanString(entry?.dayKey, 20) !== nextSnapshot.dayKey)
    .concat([nextSnapshot])
    .sort((left, right) => cleanString(left?.dayKey, 20).localeCompare(cleanString(right?.dayKey, 20)))
    .slice(-limit));

  targetProfile.domains.seasonArchive = {
    ...currentSeasonArchive,
    snapshots: nextSnapshots,
    weeklyRollups: buildSeasonArchiveWeeklyRollups(nextSnapshots, {
      limit: options.weeklyLimit,
    }),
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
  POPULATION_SNAPSHOT_LIMIT,
  SEASON_ARCHIVE_LIMIT,
  appendProofWindowSnapshot,
  appendSeasonArchiveSnapshot,
  captureProfilePopulationSnapshot,
  captureSeasonArchiveSnapshots,
  buildProfilePopulationSnapshot,
  buildProofWindowSnapshot,
  buildSeasonArchiveSnapshot,
  buildSeasonArchiveWeeklyRollups,
};
