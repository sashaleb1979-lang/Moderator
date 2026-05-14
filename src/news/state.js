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

function normalizeHexColor(value, fallback) {
  const text = cleanString(value, 16).toUpperCase();
  return /^#[0-9A-F]{6}$/.test(text) ? text : fallback;
}

function createDefaultNewsConfig() {
  return {
    enabled: false,
    schedule: {
      publishHourMsk: 21,
      tickMinutes: 5,
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
    dailyDigests: {},
    runtime: {
      lastCompileStartedAt: null,
      lastCompileFinishedAt: null,
      lastCompiledDayKey: null,
      lastPublishedDayKey: null,
      lastPublishStatus: null,
      lastFailure: null,
      lastAuditCounts: null,
      lastCoverageSummary: null,
      lastPreviewRequest: null,
      lastVoiceCaptureAt: null,
      lastModerationCaptureAt: null,
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
  next.dailyDigests = source.dailyDigests && typeof source.dailyDigests === "object" && !Array.isArray(source.dailyDigests)
    ? clone(source.dailyDigests)
    : {};
  next.runtime = {
    ...defaults.runtime,
    ...(source.runtime && typeof source.runtime === "object" && !Array.isArray(source.runtime) ? clone(source.runtime) : {}),
    lastCompileStartedAt: normalizeNullableString(source.runtime?.lastCompileStartedAt, 80),
    lastCompileFinishedAt: normalizeNullableString(source.runtime?.lastCompileFinishedAt, 80),
    lastCompiledDayKey: normalizeNullableString(source.runtime?.lastCompiledDayKey, 40),
    lastPublishedDayKey: normalizeNullableString(source.runtime?.lastPublishedDayKey, 40),
    lastPublishStatus: normalizeNullableString(source.runtime?.lastPublishStatus, 80),
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
  normalizeNewsState,
};