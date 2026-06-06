"use strict";

const NORMALIZED_NEWS_STATES = new WeakSet();

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

function normalizeBoolean(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeIntegerInRange(value, fallback, min, max) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) return fallback;
  if (amount < min || amount > max) return fallback;
  return amount;
}

function normalizePositiveInteger(value, fallback) {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : fallback;
}

function normalizeOptionalNonNegativeInteger(value) {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
}

function normalizeStringList(items = [], limit = 8, itemLimit = 300) {
  const source = Array.isArray(items) ? items : [];
  const normalized = [];
  for (const item of source) {
    const text = cleanString(item, itemLimit);
    if (!text) continue;
    normalized.push(text);
    if (normalized.length >= limit) break;
  }
  return normalized.length ? normalized : null;
}

function normalizeDayKeyList(items = [], limit = 120) {
  const source = Array.isArray(items) ? items : [];
  const normalized = [];
  const seen = new Set();
  for (const item of source) {
    const dayKey = cleanString(item, 40);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey) || seen.has(dayKey)) continue;
    seen.add(dayKey);
    normalized.push(dayKey);
    if (normalized.length >= limit) break;
  }
  return normalized;
}

function normalizeHexColor(value, fallback) {
  const text = cleanString(value, 16).toUpperCase();
  return /^#[0-9A-F]{6}$/.test(text) ? text : fallback;
}

function normalizePublishResult(value = null) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : null;
  if (!source) return null;

  const publishMode = cleanString(source.publishMode, 40);
  const result = {
    dayKey: normalizeNullableString(source.dayKey, 40),
    publishedAt: normalizeNullableString(source.publishedAt, 80),
    publishMode: publishMode === "public" || publishMode === "staff_only" ? publishMode : null,
    deliveryChannelId: normalizeNullableString(source.deliveryChannelId, 80),
    deliveryMessageId: normalizeNullableString(source.deliveryMessageId, 80),
    publicChannelId: normalizeNullableString(source.publicChannelId, 80),
    publicMessageId: normalizeNullableString(source.publicMessageId, 80),
    coverFileName: normalizeNullableString(source.coverFileName, 120),
    threadId: normalizeNullableString(source.threadId, 80),
    threadMessageCount: normalizeOptionalNonNegativeInteger(source.threadMessageCount),
    staffChannelId: normalizeNullableString(source.staffChannelId, 80),
    staffMessageId: normalizeNullableString(source.staffMessageId, 80),
    warningCount: normalizeOptionalNonNegativeInteger(source.warningCount),
    warnings: normalizeStringList(source.warnings, 8, 300),
  };

  return Object.values(result).some((entry) => entry !== null) ? result : null;
}

function normalizeReleaseQueue(value = null) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const dayKeys = normalizeDayKeyList(source.dayKeys, 120);
  return {
    active: dayKeys.length > 0 ? normalizeBoolean(source.active, false) : false,
    dayKeys,
    lastPreparedAt: normalizeNullableString(source.lastPreparedAt, 80),
    lastPreparedRangeStartDayKey: normalizeNullableString(source.lastPreparedRangeStartDayKey, 40),
    lastPreparedRangeEndDayKey: normalizeNullableString(source.lastPreparedRangeEndDayKey, 40),
    lastReleasedDayKey: normalizeNullableString(source.lastReleasedDayKey, 40),
    lastReleasedAt: normalizeNullableString(source.lastReleasedAt, 80),
  };
}

function createDefaultNewsConfig() {
  return {
    enabled: false,
    schedule: {
      publishHourMsk: 21,
      tickMinutes: 5,
    },
    publish: {
      autoPublishEnabled: false,
    },
    channels: {
      publicChannelId: "",
      staffChannelId: "",
    },
    voice: {
      topCount: 5,
      includeFullList: true,
      fullListFormat: "single_line",
      publishFullListInThread: true,
    },
    moderation: {
      includeLeavesPublic: true,
      includeBansPublic: true,
      staffIncludeActorDetails: true,
    },
    kills: {
      topCount: 5,
      staffIncludeRejected: true,
      staffIncludePending: true,
    },
    activity: {
      topMessagesCount: 5,
      topMoversCount: 5,
      includeMessageLeaderboard: true,
    },
    antiteam: {
      topCount: 5,
    },
    newcomers: {
      topCount: 8,
      includeVerifiedPublic: true,
    },
    gameplay: {
      topCount: 5,
      includeJjsLeaderboard: true,
    },
    tierlist: {
      topCount: 5,
      includeSubmissionUpdates: true,
    },
    presentation: {
      visualMode: "edition",
      masthead: "Daily Edition",
      postThreadEnabled: true,
      accentColor: "#D6A441",
      accentColorAlt: "#5DA9E9",
      backgroundColor: "#101418",
    },
  };
}

function normalizeNewsConfig(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const defaults = createDefaultNewsConfig();

  return {
    enabled: normalizeBoolean(source.enabled, defaults.enabled),
    schedule: {
      publishHourMsk: normalizeIntegerInRange(source.schedule?.publishHourMsk, defaults.schedule.publishHourMsk, 0, 23),
      tickMinutes: normalizePositiveInteger(source.schedule?.tickMinutes, defaults.schedule.tickMinutes),
    },
    publish: {
      autoPublishEnabled: normalizeBoolean(source.publish?.autoPublishEnabled, defaults.publish.autoPublishEnabled),
    },
    channels: {
      publicChannelId: cleanString(source.channels?.publicChannelId, 80),
      staffChannelId: cleanString(source.channels?.staffChannelId, 80),
    },
    voice: {
      topCount: normalizePositiveInteger(source.voice?.topCount, defaults.voice.topCount),
      includeFullList: normalizeBoolean(source.voice?.includeFullList, defaults.voice.includeFullList),
      fullListFormat: cleanString(source.voice?.fullListFormat, 40) || defaults.voice.fullListFormat,
      publishFullListInThread: normalizeBoolean(source.voice?.publishFullListInThread, defaults.voice.publishFullListInThread),
    },
    moderation: {
      includeLeavesPublic: normalizeBoolean(source.moderation?.includeLeavesPublic, defaults.moderation.includeLeavesPublic),
      includeBansPublic: normalizeBoolean(source.moderation?.includeBansPublic, defaults.moderation.includeBansPublic),
      staffIncludeActorDetails: normalizeBoolean(source.moderation?.staffIncludeActorDetails, defaults.moderation.staffIncludeActorDetails),
    },
    kills: {
      topCount: normalizePositiveInteger(source.kills?.topCount, defaults.kills.topCount),
      staffIncludeRejected: normalizeBoolean(source.kills?.staffIncludeRejected, defaults.kills.staffIncludeRejected),
      staffIncludePending: normalizeBoolean(source.kills?.staffIncludePending, defaults.kills.staffIncludePending),
    },
    activity: {
      topMessagesCount: normalizePositiveInteger(source.activity?.topMessagesCount, defaults.activity.topMessagesCount),
      topMoversCount: normalizePositiveInteger(source.activity?.topMoversCount, defaults.activity.topMoversCount),
      includeMessageLeaderboard: normalizeBoolean(source.activity?.includeMessageLeaderboard, defaults.activity.includeMessageLeaderboard),
    },
    antiteam: {
      topCount: normalizePositiveInteger(source.antiteam?.topCount, defaults.antiteam.topCount),
    },
    newcomers: {
      topCount: normalizePositiveInteger(source.newcomers?.topCount, defaults.newcomers.topCount),
      includeVerifiedPublic: normalizeBoolean(source.newcomers?.includeVerifiedPublic, defaults.newcomers.includeVerifiedPublic),
    },
    gameplay: {
      topCount: normalizePositiveInteger(source.gameplay?.topCount, defaults.gameplay.topCount),
      includeJjsLeaderboard: normalizeBoolean(source.gameplay?.includeJjsLeaderboard, defaults.gameplay.includeJjsLeaderboard),
    },
    tierlist: {
      topCount: normalizePositiveInteger(source.tierlist?.topCount, defaults.tierlist.topCount),
      includeSubmissionUpdates: normalizeBoolean(source.tierlist?.includeSubmissionUpdates, defaults.tierlist.includeSubmissionUpdates),
    },
    presentation: {
      visualMode: cleanString(source.presentation?.visualMode, 40) || defaults.presentation.visualMode,
      masthead: cleanString(source.presentation?.masthead, 120) || defaults.presentation.masthead,
      postThreadEnabled: normalizeBoolean(source.presentation?.postThreadEnabled, defaults.presentation.postThreadEnabled),
      accentColor: normalizeHexColor(source.presentation?.accentColor, defaults.presentation.accentColor),
      accentColorAlt: normalizeHexColor(source.presentation?.accentColorAlt, defaults.presentation.accentColorAlt),
      backgroundColor: normalizeHexColor(source.presentation?.backgroundColor, defaults.presentation.backgroundColor),
    },
  };
}

function createEmptyNewsState() {
  return {
    config: createDefaultNewsConfig(),
    voice: {
      openSessions: {},
      finalizedSessions: [],
      lastPrunedAt: null,
    },
    moderation: {
      events: [],
      lastPrunedAt: null,
    },
    history: {
      daySnapshots: {},
      lastPrunedAt: null,
    },
    dailyDigests: {},
    runtime: {
      lastCompileStartedAt: null,
      lastCompileFinishedAt: null,
      lastCompiledDayKey: null,
      lastPublishStartedAt: null,
      lastPublishFinishedAt: null,
      lastCompileStatus: null,
      lastPublishedDayKey: null,
      lastPublishStatus: null,
      lastPublishResult: null,
      lastFailure: null,
      lastAuditCounts: null,
      lastCoverageSummary: null,
      lastPreviewRequest: null,
      lastVoiceCaptureAt: null,
      lastModerationCaptureAt: null,
      releaseQueue: {
        active: false,
        dayKeys: [],
        lastPreparedAt: null,
        lastPreparedRangeStartDayKey: null,
        lastPreparedRangeEndDayKey: null,
        lastReleasedDayKey: null,
        lastReleasedAt: null,
      },
      errors: [],
    },
  };
}

function normalizeNewsState(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const defaults = createEmptyNewsState();
  const next = {
    ...defaults,
    ...clone(source),
  };

  next.config = normalizeNewsConfig(source.config);
  next.voice = {
    ...defaults.voice,
    ...(source.voice && typeof source.voice === "object" && !Array.isArray(source.voice) ? clone(source.voice) : {}),
    openSessions: source.voice?.openSessions && typeof source.voice.openSessions === "object" && !Array.isArray(source.voice.openSessions)
      ? clone(source.voice.openSessions)
      : {},
    finalizedSessions: Array.isArray(source.voice?.finalizedSessions) ? clone(source.voice.finalizedSessions) : [],
    lastPrunedAt: normalizeNullableString(source.voice?.lastPrunedAt, 80),
  };
  next.moderation = {
    ...defaults.moderation,
    ...(source.moderation && typeof source.moderation === "object" && !Array.isArray(source.moderation) ? clone(source.moderation) : {}),
    events: Array.isArray(source.moderation?.events) ? clone(source.moderation.events) : [],
    lastPrunedAt: normalizeNullableString(source.moderation?.lastPrunedAt, 80),
  };
  next.history = {
    ...defaults.history,
    ...(source.history && typeof source.history === "object" && !Array.isArray(source.history) ? clone(source.history) : {}),
    daySnapshots: source.history?.daySnapshots && typeof source.history.daySnapshots === "object" && !Array.isArray(source.history.daySnapshots)
      ? clone(source.history.daySnapshots)
      : {},
    lastPrunedAt: normalizeNullableString(source.history?.lastPrunedAt, 80),
  };
  next.dailyDigests = source.dailyDigests && typeof source.dailyDigests === "object" && !Array.isArray(source.dailyDigests)
    ? clone(source.dailyDigests)
    : {};
  next.runtime = {
    ...defaults.runtime,
    ...(source.runtime && typeof source.runtime === "object" && !Array.isArray(source.runtime) ? clone(source.runtime) : {}),
    lastCompileStartedAt: normalizeNullableString(source.runtime?.lastCompileStartedAt, 80),
    lastCompileFinishedAt: normalizeNullableString(source.runtime?.lastCompileFinishedAt, 80),
    lastCompiledDayKey: normalizeNullableString(source.runtime?.lastCompiledDayKey, 40),
    lastCompileStatus: normalizeNullableString(source.runtime?.lastCompileStatus, 80),
    lastPublishStartedAt: normalizeNullableString(source.runtime?.lastPublishStartedAt, 80),
    lastPublishFinishedAt: normalizeNullableString(source.runtime?.lastPublishFinishedAt, 80),
    lastPublishedDayKey: normalizeNullableString(source.runtime?.lastPublishedDayKey, 40),
    lastPublishStatus: normalizeNullableString(source.runtime?.lastPublishStatus, 80),
    lastPublishResult: normalizePublishResult(source.runtime?.lastPublishResult),
    lastFailure: source.runtime?.lastFailure && typeof source.runtime.lastFailure === "object" && !Array.isArray(source.runtime.lastFailure)
      ? clone(source.runtime.lastFailure)
      : null,
    lastAuditCounts: source.runtime?.lastAuditCounts && typeof source.runtime.lastAuditCounts === "object" && !Array.isArray(source.runtime.lastAuditCounts)
      ? clone(source.runtime.lastAuditCounts)
      : null,
    lastCoverageSummary: source.runtime?.lastCoverageSummary && typeof source.runtime.lastCoverageSummary === "object" && !Array.isArray(source.runtime.lastCoverageSummary)
      ? clone(source.runtime.lastCoverageSummary)
      : null,
    lastPreviewRequest: source.runtime?.lastPreviewRequest && typeof source.runtime.lastPreviewRequest === "object" && !Array.isArray(source.runtime.lastPreviewRequest)
      ? clone(source.runtime.lastPreviewRequest)
      : null,
    lastVoiceCaptureAt: normalizeNullableString(source.runtime?.lastVoiceCaptureAt, 80),
    lastModerationCaptureAt: normalizeNullableString(source.runtime?.lastModerationCaptureAt, 80),
    releaseQueue: normalizeReleaseQueue(source.runtime?.releaseQueue),
    errors: Array.isArray(source.runtime?.errors) ? clone(source.runtime.errors) : [],
  };

  NORMALIZED_NEWS_STATES.add(next);
  return next;
}

function ensureNewsState(db = {}) {
  if (!db || typeof db !== "object") {
    throw new Error("db must be an object");
  }

  db.sot ||= {};
  if (
    db.sot.news
    && typeof db.sot.news === "object"
    && !Array.isArray(db.sot.news)
    && NORMALIZED_NEWS_STATES.has(db.sot.news)
  ) {
    return db.sot.news;
  }

  db.sot.news = normalizeNewsState(db.sot.news);
  return db.sot.news;
}

module.exports = {
  createDefaultNewsConfig,
  createEmptyNewsState,
  ensureNewsState,
  normalizeNewsConfig,
  normalizePublishResult,
  normalizeNewsState,
};
