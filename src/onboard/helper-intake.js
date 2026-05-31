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

const HELPER_INTAKE_MESSAGE_ROUTES = Object.freeze({
  helperElo: "helper_elo",
  killsSubmit: "kills_submit",
  idleWelcomeCleanup: "idle_welcome_cleanup",
  ignore: "ignore",
});

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

function resolveHelperIntakeMessageRoute(options = {}) {
  const channelId = cleanString(options.channelId, 80);
  const welcomeChannelId = cleanString(options.welcomeChannelId, 80);
  const helperSession = normalizeHelperIntakeSession(options.session);
  const hasMatchingHelperIntakeSession = Boolean(
    helperSession.action
    && helperSession.channelId
    && channelId
    && helperSession.channelId === channelId
  );

  if (hasMatchingHelperIntakeSession && helperSession.action === HELPER_INTAKE_ACTIONS.elo) {
    return {
      route: HELPER_INTAKE_MESSAGE_ROUTES.helperElo,
      helperSession: { ...helperSession },
      hasMatchingHelperIntakeSession: true,
      hasActiveHelperEloSession: true,
      hasActiveHelperKillsSession: false,
      shouldDeleteIdleWelcomeMessage: false,
      shouldOfferProfileMessageRoute: false,
    };
  }

  if (hasMatchingHelperIntakeSession && helperSession.action === HELPER_INTAKE_ACTIONS.kills) {
    return {
      route: HELPER_INTAKE_MESSAGE_ROUTES.killsSubmit,
      helperSession: { ...helperSession },
      hasMatchingHelperIntakeSession: true,
      hasActiveHelperEloSession: false,
      hasActiveHelperKillsSession: true,
      shouldDeleteIdleWelcomeMessage: false,
      shouldOfferProfileMessageRoute: false,
    };
  }

  const shouldDeleteIdleWelcomeMessage = Boolean(channelId && welcomeChannelId && channelId === welcomeChannelId);
  return {
    route: shouldDeleteIdleWelcomeMessage
      ? HELPER_INTAKE_MESSAGE_ROUTES.idleWelcomeCleanup
      : HELPER_INTAKE_MESSAGE_ROUTES.ignore,
    helperSession: null,
    hasMatchingHelperIntakeSession: false,
    hasActiveHelperEloSession: false,
    hasActiveHelperKillsSession: false,
    shouldDeleteIdleWelcomeMessage,
    shouldOfferProfileMessageRoute: true,
  };
}

const createSubmitIntakeSessionStore = createHelperIntakeSessionStore;
const isSubmitIntakeSessionExpired = isHelperIntakeSessionExpired;
const normalizeSubmitIntakeAction = normalizeHelperIntakeAction;
const normalizeSubmitIntakeSession = normalizeHelperIntakeSession;

module.exports = {
  HELPER_INTAKE_ACTIONS,
  HELPER_INTAKE_MESSAGE_ROUTES,
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
  resolveHelperIntakeMessageRoute,
};