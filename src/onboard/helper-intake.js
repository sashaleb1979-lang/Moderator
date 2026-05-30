"use strict";

const HELPER_INTAKE_ACTIONS = Object.freeze({
  kills: "kills",
  elo: "elo",
});

const SUBMIT_INTAKE_ACTIONS = HELPER_INTAKE_ACTIONS;

const SUBMIT_INTAKE_SOURCES = Object.freeze({
  welcome: "welcome",
  helper: "helper",
  profile: "profile",
});

const HELPER_INTAKE_SESSION_EXPIRE_MS = 5 * 60 * 1000;
const SUBMIT_INTAKE_SESSION_TTL_MS = HELPER_INTAKE_SESSION_EXPIRE_MS;

function cleanString(value, limit = 200) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function normalizeHelperIntakeAction(value) {
  const normalizedValue = cleanString(value, 40).toLowerCase();
  return Object.values(HELPER_INTAKE_ACTIONS).includes(normalizedValue) ? normalizedValue : "";
}

function normalizeSubmitIntakeSource(value) {
  const normalizedValue = cleanString(value, 40).toLowerCase();
  return Object.values(SUBMIT_INTAKE_SOURCES).includes(normalizedValue) ? normalizedValue : "";
}

function normalizeHelperIntakeSession(rawValue = {}) {
  const source = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) ? rawValue : {};
  const createdAt = Number(source.createdAt);

  return {
    action: normalizeHelperIntakeAction(source.action),
    source: normalizeSubmitIntakeSource(source.source),
    channelId: cleanString(source.channelId, 80),
    rawText: cleanString(source.rawText, 1000),
    createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : 0,
  };
}

function isHelperIntakeSessionExpired(session, options = {}) {
  const normalizedSession = normalizeHelperIntakeSession(session);
  if (!normalizedSession.action || !normalizedSession.channelId || !normalizedSession.createdAt) {
    return true;
  }

  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const expireMs = Number.isFinite(Number(options.expireMs)) && Number(options.expireMs) > 0
    ? Number(options.expireMs)
    : HELPER_INTAKE_SESSION_EXPIRE_MS;

  return now - normalizedSession.createdAt > expireMs;
}

function createHelperIntakeSessionStore(options = {}) {
  const expireMs = Number.isFinite(Number(options.expireMs)) && Number(options.expireMs) > 0
    ? Number(options.expireMs)
    : HELPER_INTAKE_SESSION_EXPIRE_MS;
  const sessions = new Map();

  function clear(userId) {
    sessions.delete(cleanString(userId, 80));
  }

  function set(userId, value = {}) {
    const normalizedUserId = cleanString(userId, 80);
    const createdAt = Number(value?.createdAt);
    const normalizedSession = normalizeHelperIntakeSession({
      ...value,
      createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : Date.now(),
    });

    if (!normalizedUserId || !normalizedSession.action || !normalizedSession.channelId) {
      return null;
    }

    sessions.set(normalizedUserId, normalizedSession);
    return { ...normalizedSession };
  }

  function get(userId, readOptions = {}) {
    const normalizedUserId = cleanString(userId, 80);
    if (!normalizedUserId) return null;

    const session = normalizeHelperIntakeSession(sessions.get(normalizedUserId));
    if (isHelperIntakeSessionExpired(session, { now: readOptions.now, expireMs })) {
      sessions.delete(normalizedUserId);
      return null;
    }

    return { ...session };
  }

  function matches(userId, readOptions = {}) {
    const session = get(userId, readOptions);
    if (!session) return false;

    const expectedAction = normalizeHelperIntakeAction(readOptions.action);
    const expectedChannelId = cleanString(readOptions.channelId, 80);

    if (expectedAction && session.action !== expectedAction) return false;
    if (expectedChannelId && session.channelId !== expectedChannelId) return false;
    return true;
  }

  return {
    clear,
    get,
    matches,
    set,
  };
}

const createSubmitIntakeSessionStore = createHelperIntakeSessionStore;
const isSubmitIntakeSessionExpired = isHelperIntakeSessionExpired;
const normalizeSubmitIntakeAction = normalizeHelperIntakeAction;
const normalizeSubmitIntakeSession = normalizeHelperIntakeSession;

module.exports = {
  HELPER_INTAKE_ACTIONS,
  HELPER_INTAKE_SESSION_EXPIRE_MS,
  SUBMIT_INTAKE_ACTIONS,
  SUBMIT_INTAKE_SESSION_TTL_MS,
  SUBMIT_INTAKE_SOURCES,
  createHelperIntakeSessionStore,
  createSubmitIntakeSessionStore,
  isHelperIntakeSessionExpired,
  isSubmitIntakeSessionExpired,
  normalizeHelperIntakeAction,
  normalizeHelperIntakeSession,
  normalizeSubmitIntakeAction,
  normalizeSubmitIntakeSession,
  normalizeSubmitIntakeSource,
};