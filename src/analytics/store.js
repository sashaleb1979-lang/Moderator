"use strict";

const crypto = require("node:crypto");
const { loadJsonFile, saveJsonFile } = require("../db/store");
const {
  cleanString,
  normalizeAnalyticsState,
  normalizeRedirectRecord,
  recordAnalyticsEvent,
} = require("./state");

function createAnalyticsToken(seed = "") {
  return crypto
    .createHash("sha256")
    .update(String(seed || `${Date.now()}:${Math.random()}`))
    .digest("base64url")
    .slice(0, 24);
}

function createAnalyticsStore(options = {}) {
  const analyticsPath = cleanString(options.analyticsPath || options.path, 1000);
  if (!analyticsPath) throw new Error("analyticsPath is required");

  let state = normalizeAnalyticsState(loadJsonFile(analyticsPath, {}));

  function save() {
    state = normalizeAnalyticsState(state);
    saveJsonFile(analyticsPath, state);
    return state;
  }

  function getState() {
    state = normalizeAnalyticsState(state);
    return state;
  }

  function replaceState(nextState) {
    state = normalizeAnalyticsState(nextState);
    save();
    return state;
  }

  function recordEvent(eventInput = {}, recordOptions = {}) {
    const result = recordAnalyticsEvent(state, eventInput, recordOptions);
    state = result.state;
    if (recordOptions.save !== false) save();
    return result.event;
  }

  function ensureRedirect(recordInput = {}, recordOptions = {}) {
    const targetUrl = cleanString(recordInput.targetUrl, 2000);
    if (!targetUrl) return null;
    state = normalizeAnalyticsState(state);
    state.redirects ||= {};

    const seed = [
      targetUrl,
      cleanString(recordInput.feature, 80),
      cleanString(recordInput.action, 120),
      cleanString(recordInput.targetKind, 80),
      cleanString(recordInput.metadata?.channelId, 80),
      cleanString(recordInput.metadata?.messageId, 80),
    ].join("|");
    const token = cleanString(recordInput.token, 120) || createAnalyticsToken(seed);
    const existing = state.redirects[token] || {};
    const now = cleanString(recordOptions.now, 80) || new Date().toISOString();
    const normalized = normalizeRedirectRecord({
      ...existing,
      ...recordInput,
      token,
      targetUrl,
      createdAt: existing.createdAt || recordInput.createdAt || now,
      clickCount: existing.clickCount,
    });
    state.redirects[token] = normalized;
    if (recordOptions.save !== false) save();
    return normalized;
  }

  function resolveRedirect(token = "") {
    state = normalizeAnalyticsState(state);
    return state.redirects[cleanString(token, 120)] || null;
  }

  function recordRedirectClick(token = "", eventInput = {}, recordOptions = {}) {
    state = normalizeAnalyticsState(state);
    const normalizedToken = cleanString(token, 120);
    const record = state.redirects[normalizedToken] || null;
    if (!record) return null;
    const now = cleanString(recordOptions.now, 80) || new Date().toISOString();
    record.clickCount = Math.max(0, Number(record.clickCount) || 0) + 1;
    record.lastUsedAt = now;
    state.redirects[normalizedToken] = record;
    const event = recordEvent({
      ...eventInput,
      feature: record.feature,
      action: "redirect",
      interactionType: "link",
      outcome: "redirected",
      metadata: {
        ...record.metadata,
        ...eventInput.metadata,
        redirect: true,
        token: normalizedToken,
        targetUrl: record.targetUrl,
        targetKind: record.targetKind,
        originalAction: record.action,
      },
      at: eventInput.at || now,
      actorUserId: eventInput.actorUserId || "",
    }, { ...recordOptions, now });
    return { record, event };
  }

  return {
    analyticsPath,
    ensureRedirect,
    getState,
    recordEvent,
    recordRedirectClick,
    replaceState,
    resolveRedirect,
    save,
  };
}

module.exports = {
  createAnalyticsStore,
  createAnalyticsToken,
};
