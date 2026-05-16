"use strict";

const ACTIVITY_CHANNEL_TYPES = new Set([
  "main_chat",
  "normal_chat",
  "small_chat",
  "flood",
  "media",
  "event",
  "admin",
  "ignored",
]);

const ACTIVITY_CHANNEL_WEIGHT_PRESETS = Object.freeze({
  main_chat: 1,
  normal_chat: 1,
  small_chat: 1.15,
  event: 0.9,
  media: 0.7,
  flood: 0.35,
  admin: 0,
  ignored: 0,
});

const DEFAULT_ACTIVITY_ROLE_THRESHOLDS = Object.freeze({
  core: 94,
  stable: 77,
  active: 61,
  floating: 42,
  weak: 18,
  dead: 0,
});

const DEFAULT_ACTIVITY_ROLE_IDS = Object.freeze({
  core: null,
  stable: null,
  active: null,
  floating: null,
  weak: null,
  dead: null,
});

const DEFAULT_ACTIVITY_SESSION_BASE_VALUES = Object.freeze({
  single: 0.45,
  burst: 0.75,
  full: 1,
});

const DEFAULT_ACTIVITY_SCORE_WEIGHTS = Object.freeze({
  sessions: 36,
  days: 31,
  freshness: 18,
  messages: 10,
  voice: 8,
  activeVoice: 6,
  diversity: 5,
});

const DEFAULT_ACTIVITY_SCORE_WINDOWS = Object.freeze({
  sessions: 50,
  days: 20,
  messages: 250,
  voiceHours: 20,
  activeVoiceHours: 12,
});

const DEFAULT_ACTIVITY_DIVERSITY_BONUSES = Object.freeze({
  2: 2,
  3: 4,
  4: 5,
});

const DEFAULT_ACTIVITY_FRESHNESS_BUCKETS = Object.freeze([
  { maxDays: 1, score: 18 },
  { maxDays: 3, score: 16 },
  { maxDays: 7, score: 11 },
  { maxDays: 14, score: 7 },
  { maxDays: 21, score: 3 },
  { maxDays: Number.POSITIVE_INFINITY, score: 0 },
]);

const DEFAULT_ACTIVITY_ANTI_SPAM_CAPS = Object.freeze([
  { maxActiveDays: 2, maxScore: 35 },
  { maxActiveDays: 4, maxScore: 50 },
  { maxActiveDays: 7, maxScore: 65 },
  { maxActiveDays: 10, maxScore: 75 },
]);

const DEFAULT_ACTIVITY_MEMBER_RULES = Object.freeze({
  roleEligibilityMinMemberDays: 3,
  roleBoostEndMemberDays: 7,
  roleBoostMaxMultiplier: 1.15,
  autoRoleSyncHours: 24,
});

const NORMALIZED_ACTIVITY_STATES = new WeakSet();

const WATCHED_CHANNEL_ROLE_OPT_OUT_TYPES = new Set(["admin", "ignored"]);

function clone(value) {
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

function normalizeStringArray(value, limit = 50, itemLimit = 120) {
  if (!Array.isArray(value)) return [];

  const seen = new Set();
  const normalized = [];
  for (const entry of value) {
    const text = cleanString(entry, itemLimit);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    normalized.push(text);
    if (normalized.length >= limit) break;
  }

  return normalized;
}

function normalizeBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeNonNegativeInteger(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : fallback;
}

function normalizePositiveInteger(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : fallback;
}

function normalizeNonNegativeNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : fallback;
}

function normalizePositiveNumber(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : fallback;
}

function normalizeActivityChannelType(value, fallback = "normal_chat") {
  const channelType = cleanString(value, 40).toLowerCase();
  return ACTIVITY_CHANNEL_TYPES.has(channelType) ? channelType : fallback;
}

function normalizeActivityChannelWeight(value, fallback, channelType = "normal_chat") {
  const channelWeight = normalizePositiveNumber(value, NaN);
  if (Number.isFinite(channelWeight)) return channelWeight;
  if (Number.isFinite(fallback) && fallback >= 0) return fallback;
  return ACTIVITY_CHANNEL_WEIGHT_PRESETS[channelType] ?? ACTIVITY_CHANNEL_WEIGHT_PRESETS.normal_chat;
}

function createDefaultActivityConfig() {
  return {
    sessionGapMinutes: 45,
    scoreWindowDays: 30,
    maxEffectiveSessionsPerDay: 3.2,
    sessionWeightMin: 0.35,
    sessionWeightMax: 1.15,
    roleEligibilityMinMemberDays: DEFAULT_ACTIVITY_MEMBER_RULES.roleEligibilityMinMemberDays,
    roleBoostEndMemberDays: DEFAULT_ACTIVITY_MEMBER_RULES.roleBoostEndMemberDays,
    roleBoostMaxMultiplier: DEFAULT_ACTIVITY_MEMBER_RULES.roleBoostMaxMultiplier,
    autoRoleSyncHours: DEFAULT_ACTIVITY_MEMBER_RULES.autoRoleSyncHours,
    adminRoleIds: [],
    moderatorRoleIds: [],
    channelWeightPresets: clone(ACTIVITY_CHANNEL_WEIGHT_PRESETS),
    activityRoleIds: { ...DEFAULT_ACTIVITY_ROLE_IDS },
    activityRoleThresholds: clone(DEFAULT_ACTIVITY_ROLE_THRESHOLDS),
    sessionBaseValues: clone(DEFAULT_ACTIVITY_SESSION_BASE_VALUES),
    activityScoreWeights: clone(DEFAULT_ACTIVITY_SCORE_WEIGHTS),
    activityScoreWindows: clone(DEFAULT_ACTIVITY_SCORE_WINDOWS),
    diversityBonuses: clone(DEFAULT_ACTIVITY_DIVERSITY_BONUSES),
    freshnessBuckets: DEFAULT_ACTIVITY_FRESHNESS_BUCKETS.map((entry) => ({ ...entry })),
    antiSpamCaps: clone(DEFAULT_ACTIVITY_ANTI_SPAM_CAPS),
  };
}

function normalizeActivityConfig(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const defaults = createDefaultActivityConfig();
  const channelWeightPresets = { ...defaults.channelWeightPresets };
  for (const channelType of Object.keys(channelWeightPresets)) {
    channelWeightPresets[channelType] = normalizeNonNegativeNumber(
      source.channelWeightPresets?.[channelType],
      defaults.channelWeightPresets[channelType]
    );
  }

  const activityRoleThresholds = { ...defaults.activityRoleThresholds };
  for (const thresholdKey of Object.keys(activityRoleThresholds)) {
    activityRoleThresholds[thresholdKey] = normalizeNonNegativeInteger(
      source.activityRoleThresholds?.[thresholdKey],
      defaults.activityRoleThresholds[thresholdKey]
    );
  }

  const activityRoleIds = { ...defaults.activityRoleIds };
  for (const roleKey of Object.keys(activityRoleIds)) {
    activityRoleIds[roleKey] = normalizeNullableString(
      source.activityRoleIds?.[roleKey],
      80
    );
  }

  const sessionBaseValues = { ...defaults.sessionBaseValues };
  for (const sessionBaseKey of Object.keys(sessionBaseValues)) {
    sessionBaseValues[sessionBaseKey] = normalizePositiveNumber(
      source.sessionBaseValues?.[sessionBaseKey],
      defaults.sessionBaseValues[sessionBaseKey]
    );
  }

  const activityScoreWeights = { ...defaults.activityScoreWeights };
  for (const weightKey of Object.keys(activityScoreWeights)) {
    activityScoreWeights[weightKey] = normalizePositiveNumber(
      source.activityScoreWeights?.[weightKey],
      defaults.activityScoreWeights[weightKey]
    );
  }

  const activityScoreWindows = { ...defaults.activityScoreWindows };
  for (const windowKey of Object.keys(activityScoreWindows)) {
    activityScoreWindows[windowKey] = normalizePositiveNumber(
      source.activityScoreWindows?.[windowKey],
      defaults.activityScoreWindows[windowKey]
    );
  }

  const diversityBonuses = { ...defaults.diversityBonuses };
  for (const diversityKey of Object.keys(diversityBonuses)) {
    diversityBonuses[diversityKey] = normalizeNonNegativeInteger(
      source.diversityBonuses?.[diversityKey],
      defaults.diversityBonuses[diversityKey]
    );
  }

  const freshnessBuckets = Array.isArray(source.freshnessBuckets) && source.freshnessBuckets.length
    ? source.freshnessBuckets
      .map((entry) => ({
        maxDays: entry?.maxDays === null || entry?.maxDays === undefined || entry?.maxDays === ""
          ? Number.POSITIVE_INFINITY
          : Number.isFinite(Number(entry?.maxDays)) ? Number(entry.maxDays) : Number.POSITIVE_INFINITY,
        score: normalizeNonNegativeInteger(entry?.score, 0),
      }))
      .filter((entry) => entry.maxDays >= 0)
      .sort((left, right) => left.maxDays - right.maxDays)
    : defaults.freshnessBuckets.map((entry) => ({ ...entry }));

  const antiSpamCaps = Array.isArray(source.antiSpamCaps) && source.antiSpamCaps.length
    ? source.antiSpamCaps
      .map((entry) => ({
        maxActiveDays: normalizeNonNegativeInteger(entry?.maxActiveDays, 0),
        maxScore: normalizeNonNegativeInteger(entry?.maxScore, 0),
      }))
      .filter((entry) => entry.maxActiveDays > 0)
      .sort((left, right) => left.maxActiveDays - right.maxActiveDays)
    : clone(defaults.antiSpamCaps);

  const sessionWeightMin = normalizeNonNegativeNumber(source.sessionWeightMin, defaults.sessionWeightMin);
  const sessionWeightMax = normalizeNonNegativeNumber(source.sessionWeightMax, defaults.sessionWeightMax);
  const roleEligibilityMinMemberDays = normalizeNonNegativeNumber(
    source.roleEligibilityMinMemberDays,
    defaults.roleEligibilityMinMemberDays
  );
  const roleBoostEndMemberDays = Math.max(
    roleEligibilityMinMemberDays,
    normalizeNonNegativeNumber(source.roleBoostEndMemberDays, defaults.roleBoostEndMemberDays)
  );
  const roleBoostMaxMultiplier = Math.max(
    1,
    normalizePositiveNumber(source.roleBoostMaxMultiplier, defaults.roleBoostMaxMultiplier)
  );

  return {
    ...clone(source),
    sessionGapMinutes: normalizePositiveInteger(source.sessionGapMinutes, defaults.sessionGapMinutes),
    scoreWindowDays: normalizePositiveInteger(source.scoreWindowDays, defaults.scoreWindowDays),
    maxEffectiveSessionsPerDay: normalizePositiveNumber(
      source.maxEffectiveSessionsPerDay,
      defaults.maxEffectiveSessionsPerDay
    ),
    sessionWeightMin,
    sessionWeightMax: sessionWeightMax >= sessionWeightMin ? sessionWeightMax : defaults.sessionWeightMax,
    roleEligibilityMinMemberDays,
    roleBoostEndMemberDays,
    roleBoostMaxMultiplier,
    autoRoleSyncHours: normalizePositiveNumber(source.autoRoleSyncHours, defaults.autoRoleSyncHours),
    adminRoleIds: normalizeStringArray(source.adminRoleIds, 25, 80),
    moderatorRoleIds: normalizeStringArray(source.moderatorRoleIds, 25, 80),
    channelWeightPresets,
    activityRoleIds,
    activityRoleThresholds,
    sessionBaseValues,
    activityScoreWeights,
    activityScoreWindows,
    diversityBonuses,
    freshnessBuckets,
    antiSpamCaps,
  };
}

function createEmptyActivityState() {
  return {
    config: createDefaultActivityConfig(),
    watchedChannels: [],
    globalUserSessions: [],
    globalVoiceSessions: [],
    channelDailyStats: [],
    userChannelDailyStats: [],
    userVoiceDailyStats: [],
    userSnapshots: {},
    calibrationRuns: [],
    ops: {
      moderationAuditLog: [],
    },
    runtime: {
      openSessions: {},
      openVoiceSessions: {},
      dirtyUsers: [],
      lastFlushAt: null,
      lastFlushStats: null,
      lastResumeAt: null,
      lastFullRecalcAt: null,
      lastRebuildAndRoleSyncAt: null,
      lastRebuildAndRoleSyncStats: null,
      lastDailyRoleSyncAt: null,
      lastDailyRoleSyncStats: null,
      lastRolesOnlySyncAt: null,
      lastRolesOnlySyncStats: null,
      errors: [],
    },
  };
}

function normalizeWatchedChannelRecord(value = {}, options = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const existingRecord = options.existingRecord && typeof options.existingRecord === "object" && !Array.isArray(options.existingRecord)
    ? options.existingRecord
    : null;
  const now = normalizeNullableString(options.now ?? source.now, 80);
  const channelId = cleanString(source.channelId ?? existingRecord?.channelId, 80);
  if (!channelId) return null;

  const hasExplicitChannelType = ACTIVITY_CHANNEL_TYPES.has(cleanString(source.channelType, 40).toLowerCase());
  const hasExplicitChannelWeight = source.channelWeight !== undefined && source.channelWeight !== null && source.channelWeight !== "";
  const channelType = normalizeActivityChannelType(source.channelType, existingRecord?.channelType || "normal_chat");
  const defaultCountForTrust = !WATCHED_CHANNEL_ROLE_OPT_OUT_TYPES.has(channelType);
  const defaultCountForRoles = !WATCHED_CHANNEL_ROLE_OPT_OUT_TYPES.has(channelType);

  return {
    guildId: normalizeNullableString(source.guildId ?? existingRecord?.guildId, 80),
    channelId,
    channelNameCache: cleanString(source.channelNameCache ?? existingRecord?.channelNameCache, 200),
    enabled: normalizeBoolean(source.enabled, existingRecord?.enabled ?? true),
    channelType,
    channelWeight: normalizeActivityChannelWeight(
      source.channelWeight,
      hasExplicitChannelWeight || hasExplicitChannelType
        ? NaN
        : normalizePositiveNumber(existingRecord?.channelWeight, NaN),
      channelType
    ),
    countMessages: normalizeBoolean(source.countMessages, existingRecord?.countMessages ?? true),
    countSessions: normalizeBoolean(source.countSessions, existingRecord?.countSessions ?? true),
    countForTrust: normalizeBoolean(source.countForTrust, existingRecord?.countForTrust ?? defaultCountForTrust),
    countForRoles: normalizeBoolean(source.countForRoles, existingRecord?.countForRoles ?? defaultCountForRoles),
    importedUntilMessageId: cleanString(source.importedUntilMessageId ?? existingRecord?.importedUntilMessageId, 80),
    lastScannedMessageId: cleanString(source.lastScannedMessageId ?? existingRecord?.lastScannedMessageId, 80),
    lastImportAt: normalizeNullableString(source.lastImportAt ?? existingRecord?.lastImportAt, 80),
    createdAt: normalizeNullableString(existingRecord?.createdAt, 80)
      || normalizeNullableString(source.createdAt, 80)
      || now,
    updatedAt: now
      || normalizeNullableString(source.updatedAt, 80)
      || normalizeNullableString(existingRecord?.updatedAt, 80),
  };
}

function normalizeActivityState(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const defaults = createEmptyActivityState();
  const next = {
    ...defaults,
    ...clone(source),
  };

  next.config = normalizeActivityConfig(source.config);

  const watchedChannelsById = new Map();
  for (const entry of Array.isArray(source.watchedChannels) ? source.watchedChannels : []) {
    const normalized = normalizeWatchedChannelRecord(entry, {
      existingRecord: watchedChannelsById.get(cleanString(entry?.channelId, 80)) || null,
    });
    if (!normalized) continue;
    watchedChannelsById.set(normalized.channelId, normalized);
  }
  next.watchedChannels = [...watchedChannelsById.values()];

  next.globalUserSessions = Array.isArray(source.globalUserSessions) ? clone(source.globalUserSessions) : [];
  next.globalVoiceSessions = Array.isArray(source.globalVoiceSessions) ? clone(source.globalVoiceSessions) : [];
  next.channelDailyStats = Array.isArray(source.channelDailyStats) ? clone(source.channelDailyStats) : [];
  next.userChannelDailyStats = Array.isArray(source.userChannelDailyStats) ? clone(source.userChannelDailyStats) : [];
  next.userVoiceDailyStats = Array.isArray(source.userVoiceDailyStats) ? clone(source.userVoiceDailyStats) : [];
  next.userSnapshots = source.userSnapshots && typeof source.userSnapshots === "object" && !Array.isArray(source.userSnapshots)
    ? clone(source.userSnapshots)
    : {};
  next.calibrationRuns = Array.isArray(source.calibrationRuns) ? clone(source.calibrationRuns) : [];
  next.ops = {
    ...defaults.ops,
    ...(source.ops && typeof source.ops === "object" && !Array.isArray(source.ops) ? clone(source.ops) : {}),
    moderationAuditLog: Array.isArray(source.ops?.moderationAuditLog) ? clone(source.ops.moderationAuditLog) : [],
  };
  next.runtime = {
    ...defaults.runtime,
    ...(source.runtime && typeof source.runtime === "object" && !Array.isArray(source.runtime) ? clone(source.runtime) : {}),
    openSessions: source.runtime?.openSessions && typeof source.runtime.openSessions === "object" && !Array.isArray(source.runtime.openSessions)
      ? clone(source.runtime.openSessions)
      : {},
    openVoiceSessions: source.runtime?.openVoiceSessions && typeof source.runtime.openVoiceSessions === "object" && !Array.isArray(source.runtime.openVoiceSessions)
      ? clone(source.runtime.openVoiceSessions)
      : {},
    dirtyUsers: normalizeStringArray(source.runtime?.dirtyUsers, 5000, 80),
    lastFlushAt: normalizeNullableString(source.runtime?.lastFlushAt, 80),
    lastFlushStats: source.runtime?.lastFlushStats
      && typeof source.runtime.lastFlushStats === "object"
      && !Array.isArray(source.runtime.lastFlushStats)
      ? clone(source.runtime.lastFlushStats)
      : null,
    lastResumeAt: normalizeNullableString(source.runtime?.lastResumeAt, 80),
    lastFullRecalcAt: normalizeNullableString(source.runtime?.lastFullRecalcAt, 80),
    lastRebuildAndRoleSyncAt: normalizeNullableString(source.runtime?.lastRebuildAndRoleSyncAt, 80),
    lastRebuildAndRoleSyncStats: source.runtime?.lastRebuildAndRoleSyncStats
      && typeof source.runtime.lastRebuildAndRoleSyncStats === "object"
      && !Array.isArray(source.runtime.lastRebuildAndRoleSyncStats)
      ? clone(source.runtime.lastRebuildAndRoleSyncStats)
      : null,
    lastDailyRoleSyncAt: normalizeNullableString(source.runtime?.lastDailyRoleSyncAt, 80),
    lastDailyRoleSyncStats: source.runtime?.lastDailyRoleSyncStats
      && typeof source.runtime.lastDailyRoleSyncStats === "object"
      && !Array.isArray(source.runtime.lastDailyRoleSyncStats)
      ? clone(source.runtime.lastDailyRoleSyncStats)
      : null,
    lastRolesOnlySyncAt: normalizeNullableString(source.runtime?.lastRolesOnlySyncAt, 80),
    lastRolesOnlySyncStats: source.runtime?.lastRolesOnlySyncStats
      && typeof source.runtime.lastRolesOnlySyncStats === "object"
      && !Array.isArray(source.runtime.lastRolesOnlySyncStats)
      ? clone(source.runtime.lastRolesOnlySyncStats)
      : null,
    errors: Array.isArray(source.runtime?.errors) ? clone(source.runtime.errors) : [],
  };

  NORMALIZED_ACTIVITY_STATES.add(next);

  return next;
}

function ensureActivityState(db = {}) {
  if (!db || typeof db !== "object") {
    throw new Error("db must be an object");
  }

  db.sot ||= {};
  if (
    db.sot.activity
    && typeof db.sot.activity === "object"
    && !Array.isArray(db.sot.activity)
    && NORMALIZED_ACTIVITY_STATES.has(db.sot.activity)
  ) {
    return db.sot.activity;
  }

  db.sot.activity = normalizeActivityState(db.sot.activity);
  return db.sot.activity;
}

function getActivityConfig(db = {}) {
  return clone(ensureActivityState(db).config);
}

function updateActivityConfig(db = {}, patch = {}) {
  const state = ensureActivityState(db);
  const previousConfig = clone(state.config);
  const sourcePatch = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
  const nextConfig = normalizeActivityConfig({
    ...state.config,
    ...clone(sourcePatch),
    channelWeightPresets: {
      ...state.config.channelWeightPresets,
      ...(sourcePatch.channelWeightPresets && typeof sourcePatch.channelWeightPresets === "object" && !Array.isArray(sourcePatch.channelWeightPresets)
        ? clone(sourcePatch.channelWeightPresets)
        : {}),
    },
    activityRoleIds: {
      ...state.config.activityRoleIds,
      ...(sourcePatch.activityRoleIds && typeof sourcePatch.activityRoleIds === "object" && !Array.isArray(sourcePatch.activityRoleIds)
        ? clone(sourcePatch.activityRoleIds)
        : {}),
    },
    activityRoleThresholds: {
      ...state.config.activityRoleThresholds,
      ...(sourcePatch.activityRoleThresholds && typeof sourcePatch.activityRoleThresholds === "object" && !Array.isArray(sourcePatch.activityRoleThresholds)
        ? clone(sourcePatch.activityRoleThresholds)
        : {}),
    },
  });

  state.config = nextConfig;
  return {
    mutated: JSON.stringify(previousConfig) !== JSON.stringify(nextConfig),
    config: clone(nextConfig),
  };
}

function listWatchedChannels(db = {}) {
  return clone(ensureActivityState(db).watchedChannels);
}

function getWatchedChannel(db = {}, channelId = "") {
  const normalizedChannelId = cleanString(channelId, 80);
  if (!normalizedChannelId) return null;
  const watchedChannel = ensureActivityState(db).watchedChannels.find((entry) => entry.channelId === normalizedChannelId);
  return watchedChannel ? clone(watchedChannel) : null;
}

function upsertWatchedChannel(db = {}, value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const channelId = cleanString(source.channelId, 80);
  if (!channelId) {
    throw new Error("channelId is required");
  }

  const state = ensureActivityState(db);
  const existingIndex = state.watchedChannels.findIndex((entry) => entry.channelId === channelId);
  const existingRecord = existingIndex >= 0 ? state.watchedChannels[existingIndex] : null;
  const nextRecord = normalizeWatchedChannelRecord(source, {
    existingRecord,
    now: source.now,
  });

  if (!nextRecord) {
    throw new Error("channelId is required");
  }

  if (existingIndex >= 0) {
    state.watchedChannels.splice(existingIndex, 1, nextRecord);
  } else {
    state.watchedChannels.push(nextRecord);
  }

  return {
    mutated: JSON.stringify(existingRecord || null) !== JSON.stringify(nextRecord),
    created: existingIndex < 0,
    record: clone(nextRecord),
  };
}

function removeWatchedChannel(db = {}, { channelId } = {}) {
  const normalizedChannelId = cleanString(channelId, 80);
  if (!normalizedChannelId) {
    throw new Error("channelId is required");
  }

  const state = ensureActivityState(db);
  const index = state.watchedChannels.findIndex((entry) => entry.channelId === normalizedChannelId);
  if (index < 0) {
    return {
      removed: false,
      record: null,
    };
  }

  const [removedRecord] = state.watchedChannels.splice(index, 1);
  return {
    removed: true,
    record: clone(removedRecord),
  };
}

module.exports = {
  ACTIVITY_CHANNEL_TYPES,
  ACTIVITY_CHANNEL_WEIGHT_PRESETS,
  DEFAULT_ACTIVITY_ROLE_IDS,
  DEFAULT_ACTIVITY_ROLE_THRESHOLDS,
  DEFAULT_ACTIVITY_SESSION_BASE_VALUES,
  DEFAULT_ACTIVITY_SCORE_WEIGHTS,
  DEFAULT_ACTIVITY_SCORE_WINDOWS,
  DEFAULT_ACTIVITY_DIVERSITY_BONUSES,
  DEFAULT_ACTIVITY_FRESHNESS_BUCKETS,
  DEFAULT_ACTIVITY_ANTI_SPAM_CAPS,
  createDefaultActivityConfig,
  createEmptyActivityState,
  ensureActivityState,
  getActivityConfig,
  getWatchedChannel,
  listWatchedChannels,
  normalizeActivityConfig,
  normalizeActivityState,
  normalizeWatchedChannelRecord,
  removeWatchedChannel,
  upsertWatchedChannel,
  updateActivityConfig,
};