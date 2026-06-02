"use strict";

const ANALYTICS_VERSION = 1;
const DEFAULT_RETENTION_DAYS = 90;
const MAX_ARCHIVE_USER_IDS = 500;

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function cloneValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeTimestamp(value, fallback = new Date().toISOString()) {
  const text = cleanString(value, 80);
  const time = Date.parse(text);
  return Number.isFinite(time) ? new Date(time).toISOString() : fallback;
}

function getDayKey(value = new Date().toISOString()) {
  const iso = normalizeTimestamp(value);
  return iso.slice(0, 10);
}

function normalizePlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeMetadata(value = {}) {
  const source = normalizePlainObject(value);
  const out = {};
  for (const [key, raw] of Object.entries(source)) {
    const normalizedKey = cleanString(key, 80);
    if (!normalizedKey) continue;
    if (raw === null || raw === undefined) continue;
    if (typeof raw === "number" || typeof raw === "boolean") {
      out[normalizedKey] = raw;
    } else if (Array.isArray(raw)) {
      out[normalizedKey] = raw.map((entry) => cleanString(entry, 160)).filter(Boolean).slice(0, 25);
    } else if (typeof raw === "object") {
      out[normalizedKey] = cleanString(JSON.stringify(raw), 500);
    } else {
      out[normalizedKey] = cleanString(raw, 500);
    }
  }
  return out;
}

function normalizeAnalyticsEvent(value = {}) {
  const source = normalizePlainObject(value);
  const fallbackAt = new Date().toISOString();
  const feature = cleanString(source.feature, 80) || "unknown";
  const action = cleanString(source.action, 120) || "unknown";
  const at = normalizeTimestamp(source.at, fallbackAt);

  return {
    id: cleanString(source.id, 120) || `${Date.parse(at) || Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    at,
    feature,
    action,
    actorUserId: cleanString(source.actorUserId, 80),
    targetUserId: cleanString(source.targetUserId, 80),
    guildId: cleanString(source.guildId, 80),
    channelId: cleanString(source.channelId, 80),
    messageId: cleanString(source.messageId, 80),
    interactionType: cleanString(source.interactionType, 40) || "unknown",
    outcome: cleanString(source.outcome, 80) || "received",
    metadata: normalizeMetadata(source.metadata),
  };
}

function normalizeArchiveBucket(value = {}) {
  const source = normalizePlainObject(value);
  const byFeature = {};
  for (const [feature, rawFeature] of Object.entries(normalizePlainObject(source.byFeature))) {
    const featureKey = cleanString(feature, 80);
    if (!featureKey) continue;
    const featureSource = normalizePlainObject(rawFeature);
    const byAction = {};
    for (const [action, count] of Object.entries(normalizePlainObject(featureSource.byAction))) {
      const actionKey = cleanString(action, 120);
      if (!actionKey) continue;
      byAction[actionKey] = Math.max(0, Number(count) || 0);
    }
    byFeature[featureKey] = {
      total: Math.max(0, Number(featureSource.total) || 0),
      byAction,
      userIds: Array.isArray(featureSource.userIds)
        ? [...new Set(featureSource.userIds.map((entry) => cleanString(entry, 80)).filter(Boolean))].slice(0, MAX_ARCHIVE_USER_IDS)
        : [],
      anonymous: Math.max(0, Number(featureSource.anonymous) || 0),
      linkClicks: Math.max(0, Number(featureSource.linkClicks) || 0),
    };
  }

  return {
    total: Math.max(0, Number(source.total) || 0),
    byFeature,
  };
}

function normalizeRedirectRecord(value = {}) {
  const source = normalizePlainObject(value);
  return {
    token: cleanString(source.token, 120),
    targetUrl: cleanString(source.targetUrl, 2000),
    feature: cleanString(source.feature, 80) || "links",
    action: cleanString(source.action, 120) || "redirect",
    targetKind: cleanString(source.targetKind, 80),
    createdAt: normalizeTimestamp(source.createdAt),
    lastUsedAt: cleanString(source.lastUsedAt, 80),
    clickCount: Math.max(0, Number(source.clickCount) || 0),
    metadata: normalizeMetadata(source.metadata),
  };
}

function normalizeAnalyticsState(value = {}) {
  const source = normalizePlainObject(value);
  const events = Array.isArray(source.events)
    ? source.events.map((event) => normalizeAnalyticsEvent(event)).filter((event) => event.feature && event.action)
    : [];
  const archiveDaily = {};
  for (const [dayKey, bucket] of Object.entries(normalizePlainObject(source.archiveDaily))) {
    const normalizedDay = /^\d{4}-\d{2}-\d{2}$/.test(dayKey) ? dayKey : "";
    if (!normalizedDay) continue;
    archiveDaily[normalizedDay] = normalizeArchiveBucket(bucket);
  }
  const redirects = {};
  for (const [token, record] of Object.entries(normalizePlainObject(source.redirects))) {
    const normalized = normalizeRedirectRecord({ token, ...record });
    if (!normalized.token || !normalized.targetUrl) continue;
    redirects[normalized.token] = normalized;
  }

  return {
    version: ANALYTICS_VERSION,
    retentionDays: Math.max(1, Number(source.retentionDays) || DEFAULT_RETENTION_DAYS),
    events,
    archiveDaily,
    redirects,
    lastCompactedAt: cleanString(source.lastCompactedAt, 80),
  };
}

function addArchivedEvent(state, event) {
  const dayKey = getDayKey(event.at);
  state.archiveDaily ||= {};
  const day = state.archiveDaily[dayKey] || { total: 0, byFeature: {} };
  day.total += 1;
  day.byFeature ||= {};

  const feature = event.feature || "unknown";
  const action = event.action || "unknown";
  const featureBucket = day.byFeature[feature] || {
    total: 0,
    byAction: {},
    userIds: [],
    anonymous: 0,
    linkClicks: 0,
  };
  featureBucket.total += 1;
  featureBucket.byAction[action] = (featureBucket.byAction[action] || 0) + 1;
  if (event.actorUserId) {
    if (!featureBucket.userIds.includes(event.actorUserId) && featureBucket.userIds.length < MAX_ARCHIVE_USER_IDS) {
      featureBucket.userIds.push(event.actorUserId);
    }
  } else {
    featureBucket.anonymous += 1;
  }
  if (event.action === "redirect" || event.metadata?.redirect === true) {
    featureBucket.linkClicks += 1;
  }
  day.byFeature[feature] = featureBucket;
  state.archiveDaily[dayKey] = day;
}

function applyAnalyticsRetention(rawState, options = {}) {
  const state = normalizeAnalyticsState(rawState);
  const retentionDays = Math.max(1, Number(options.retentionDays || state.retentionDays) || DEFAULT_RETENTION_DAYS);
  const nowMs = Date.parse(normalizeTimestamp(options.now || new Date().toISOString()));
  const cutoffMs = nowMs - retentionDays * 24 * 60 * 60 * 1000;
  const retained = [];
  let archived = 0;

  for (const event of state.events) {
    const eventMs = Date.parse(event.at);
    if (Number.isFinite(eventMs) && eventMs < cutoffMs) {
      addArchivedEvent(state, event);
      archived += 1;
    } else {
      retained.push(event);
    }
  }

  state.events = retained;
  if (archived > 0) {
    state.lastCompactedAt = normalizeTimestamp(options.now || new Date().toISOString());
  }
  return { state, archived };
}

function recordAnalyticsEvent(rawState, eventInput = {}, options = {}) {
  const retention = applyAnalyticsRetention(rawState, options);
  const state = retention.state;
  const event = normalizeAnalyticsEvent({
    ...eventInput,
    at: eventInput.at || options.now || new Date().toISOString(),
    id: eventInput.id || (typeof options.createId === "function" ? options.createId() : undefined),
  });
  state.events.push(event);
  return {
    state,
    event,
    archived: retention.archived,
  };
}

function mergeTopCounter(map, key, count = 1) {
  const normalizedKey = cleanString(key, 120) || "unknown";
  map[normalizedKey] = (map[normalizedKey] || 0) + Math.max(0, Number(count) || 0);
}

function sortedCounterEntries(counter = {}, limit = 10) {
  return Object.entries(counter)
    .sort((left, right) => Number(right[1] || 0) - Number(left[1] || 0) || String(left[0]).localeCompare(String(right[0])))
    .slice(0, Math.max(1, Number(limit) || 10))
    .map(([key, count]) => ({ key, count }));
}

function createFeatureSummary(feature) {
  return {
    feature,
    total: 0,
    uniqueUsers: new Set(),
    anonymous: 0,
    linkClicks: 0,
    actions: {},
    users: {},
    lastAt: "",
  };
}

function createUserSummary(userId) {
  return {
    userId,
    total: 0,
    features: {},
    actions: {},
    lastAt: "",
  };
}

function addSummaryEvent(summary, event, count = 1) {
  const feature = event.feature || "unknown";
  const action = event.action || "unknown";
  const safeCount = Math.max(0, Number(count) || 0);
  if (!safeCount) return;

  summary.total += safeCount;
  const featureSummary = summary.features[feature] || createFeatureSummary(feature);
  featureSummary.total += safeCount;
  mergeTopCounter(featureSummary.actions, action, safeCount);
  if (event.actorUserId) {
    featureSummary.uniqueUsers.add(event.actorUserId);
    mergeTopCounter(featureSummary.users, event.actorUserId, safeCount);
    summary.uniqueUsers.add(event.actorUserId);
    const userSummary = summary.users[event.actorUserId] || createUserSummary(event.actorUserId);
    userSummary.total += safeCount;
    mergeTopCounter(userSummary.features, feature, safeCount);
    mergeTopCounter(userSummary.actions, `${feature}:${action}`, safeCount);
    if (!userSummary.lastAt || event.at > userSummary.lastAt) userSummary.lastAt = event.at;
    summary.users[event.actorUserId] = userSummary;
  } else {
    featureSummary.anonymous += safeCount;
  }
  if (action === "redirect" || event.metadata?.redirect === true) {
    featureSummary.linkClicks += safeCount;
    summary.linkClicks += safeCount;
  }
  if (!featureSummary.lastAt || event.at > featureSummary.lastAt) featureSummary.lastAt = event.at;
  summary.features[feature] = featureSummary;
}

function buildAnalyticsSummary(rawState, options = {}) {
  const state = normalizeAnalyticsState(rawState);
  const summary = {
    total: 0,
    detailedCount: state.events.length,
    archivedTotal: 0,
    uniqueUsers: new Set(),
    linkClicks: 0,
    features: {},
    users: {},
    recent: [...state.events]
      .sort((left, right) => String(right.at).localeCompare(String(left.at)))
      .slice(0, Math.max(1, Number(options.recentLimit) || 25)),
    redirects: Object.values(state.redirects || {})
      .sort((left, right) => Number(right.clickCount || 0) - Number(left.clickCount || 0)),
    retentionDays: state.retentionDays,
    lastCompactedAt: state.lastCompactedAt,
  };

  for (const event of state.events) {
    addSummaryEvent(summary, event, 1);
  }

  for (const [dayKey, day] of Object.entries(state.archiveDaily || {})) {
    const normalizedDay = normalizeArchiveBucket(day);
    summary.archivedTotal += normalizedDay.total;
    summary.total += normalizedDay.total;
    for (const [feature, featureBucket] of Object.entries(normalizedDay.byFeature || {})) {
      const featureSummary = summary.features[feature] || createFeatureSummary(feature);
      featureSummary.total += featureBucket.total;
      featureSummary.anonymous += featureBucket.anonymous;
      featureSummary.linkClicks += featureBucket.linkClicks;
      summary.linkClicks += featureBucket.linkClicks;
      for (const [action, count] of Object.entries(featureBucket.byAction || {})) {
        mergeTopCounter(featureSummary.actions, action, count);
      }
      for (const userId of featureBucket.userIds || []) {
        featureSummary.uniqueUsers.add(userId);
        summary.uniqueUsers.add(userId);
      }
      if (!featureSummary.lastAt || dayKey > featureSummary.lastAt) featureSummary.lastAt = dayKey;
      summary.features[feature] = featureSummary;
    }
  }

  const featureList = Object.values(summary.features)
    .map((feature) => ({
      ...feature,
      uniqueUserCount: feature.uniqueUsers.size,
      topActions: sortedCounterEntries(feature.actions, 8),
      topUsers: sortedCounterEntries(feature.users, 8),
    }))
    .sort((left, right) => right.total - left.total || left.feature.localeCompare(right.feature));
  const userList = Object.values(summary.users)
    .map((user) => ({
      ...user,
      topFeatures: sortedCounterEntries(user.features, 6),
      topActions: sortedCounterEntries(user.actions, 6),
    }))
    .sort((left, right) => right.total - left.total || String(right.lastAt).localeCompare(String(left.lastAt)));

  return {
    ...summary,
    uniqueUserCount: summary.uniqueUsers.size,
    featureList,
    userList,
    state: cloneValue(state),
  };
}

module.exports = {
  ANALYTICS_VERSION,
  DEFAULT_RETENTION_DAYS,
  applyAnalyticsRetention,
  buildAnalyticsSummary,
  cleanString,
  getDayKey,
  normalizeAnalyticsEvent,
  normalizeAnalyticsState,
  normalizeMetadata,
  normalizeRedirectRecord,
  recordAnalyticsEvent,
  sortedCounterEntries,
};
