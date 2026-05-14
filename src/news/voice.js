"use strict";

const { ensureNewsState } = require("./state");

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function resolveNowIso(now) {
  if (typeof now === "function") return cleanString(now(), 80) || new Date().toISOString();
  return cleanString(now, 80) || new Date().toISOString();
}

function resolveVoiceDisplayName(state = {}, fallbackUserId = "") {
  const member = state?.member && typeof state.member === "object" ? state.member : null;
  const user = member?.user && typeof member.user === "object" ? member.user : null;
  return cleanString(member?.displayName, 120)
    || cleanString(member?.nickname, 120)
    || cleanString(user?.displayName, 120)
    || cleanString(user?.globalName, 120)
    || cleanString(user?.username, 120)
    || cleanString(fallbackUserId, 120)
    || "unknown";
}

function uniqueChannelIds(items = []) {
  const result = [];
  const seen = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    const channelId = cleanString(item, 80);
    if (!channelId || seen.has(channelId)) continue;
    seen.add(channelId);
    result.push(channelId);
  }
  return result;
}

function calculateDurationSeconds(startedAt, endedAt) {
  const startedMs = Date.parse(String(startedAt || ""));
  const endedMs = Date.parse(String(endedAt || ""));
  if (!Number.isFinite(startedMs) || !Number.isFinite(endedMs) || endedMs <= startedMs) return 0;
  return Math.max(0, Math.floor((endedMs - startedMs) / 1000));
}

function createOpenVoiceSession({ guildId, userId, channelId, joinedAt, displayName, incomplete = false, incompleteReason = null, enteredChannelIds = [] } = {}) {
  const normalizedChannelId = cleanString(channelId, 80);
  return {
    guildId: cleanString(guildId, 80),
    userId: cleanString(userId, 80),
    displayName: cleanString(displayName, 120) || cleanString(userId, 120) || "unknown",
    joinedAt: cleanString(joinedAt, 80) || null,
    currentChannelId: normalizedChannelId,
    enteredChannelIds: uniqueChannelIds([normalizedChannelId, ...enteredChannelIds]),
    moveCount: 0,
    incomplete: incomplete === true,
    incompleteReason: incomplete === true ? cleanString(incompleteReason, 120) || "unknown" : null,
  };
}

function finalizeVoiceSession(session, endedAt, displayNameOverride = "") {
  const finalizedAt = cleanString(endedAt, 80) || null;
  return {
    guildId: cleanString(session?.guildId, 80),
    userId: cleanString(session?.userId, 80),
    displayName: cleanString(displayNameOverride, 120) || cleanString(session?.displayName, 120) || cleanString(session?.userId, 120) || "unknown",
    joinedAt: cleanString(session?.joinedAt, 80) || null,
    endedAt: finalizedAt,
    durationSeconds: calculateDurationSeconds(session?.joinedAt, finalizedAt),
    enteredChannelIds: uniqueChannelIds(session?.enteredChannelIds),
    finalChannelId: cleanString(session?.currentChannelId, 80),
    moveCount: Number.isSafeInteger(Number(session?.moveCount)) ? Number(session.moveCount) : 0,
    incomplete: session?.incomplete === true,
    incompleteReason: session?.incomplete === true ? cleanString(session?.incompleteReason, 120) || "unknown" : null,
  };
}

function recordVoiceStateTransition({ db = {}, oldState = {}, newState = {}, now, saveDb, runSerialized } = {}) {
  const execute = () => {
    const state = ensureNewsState(db);
    const currentTime = resolveNowIso(now);
    const guildId = cleanString(newState?.guild?.id || oldState?.guild?.id, 80);
    const userId = cleanString(newState?.id || newState?.member?.id || oldState?.id || oldState?.member?.id, 80);
    const previousChannelId = cleanString(oldState?.channelId, 80);
    const nextChannelId = cleanString(newState?.channelId, 80);

    if (!guildId || !userId) {
      return { captured: false, stateChanged: false, reason: "missing_context" };
    }

    if (previousChannelId === nextChannelId) {
      return { captured: false, stateChanged: false, reason: "channel_unchanged" };
    }

    const displayName = resolveVoiceDisplayName(newState?.member ? newState : oldState, userId);
    const openSessions = state.voice.openSessions && typeof state.voice.openSessions === "object" && !Array.isArray(state.voice.openSessions)
      ? state.voice.openSessions
      : {};
    const existingSession = openSessions[userId] && typeof openSessions[userId] === "object" && !Array.isArray(openSessions[userId])
      ? openSessions[userId]
      : null;

    let result = { captured: false, stateChanged: false, reason: "unhandled" };

    if (nextChannelId) {
      if (existingSession) {
        existingSession.currentChannelId = nextChannelId;
        existingSession.displayName = displayName;
        existingSession.enteredChannelIds = uniqueChannelIds([...(existingSession.enteredChannelIds || []), nextChannelId]);
        existingSession.moveCount = Math.max(0, Number(existingSession.moveCount) || 0) + 1;
        result = {
          captured: true,
          stateChanged: true,
          action: previousChannelId ? "move" : "join_refresh",
          session: clone(existingSession),
        };
      } else {
        const incomplete = Boolean(previousChannelId && previousChannelId !== nextChannelId);
        const session = createOpenVoiceSession({
          guildId,
          userId,
          channelId: nextChannelId,
          joinedAt: currentTime,
          displayName,
          incomplete,
          incompleteReason: incomplete ? "recovered_mid_session" : null,
          enteredChannelIds: incomplete ? [previousChannelId, nextChannelId] : [nextChannelId],
        });
        if (incomplete) {
          session.moveCount = 1;
        }
        openSessions[userId] = session;
        result = {
          captured: true,
          stateChanged: true,
          action: incomplete ? "recovered_move" : "join",
          session: clone(session),
        };
      }
    } else if (existingSession) {
      const finalized = finalizeVoiceSession(existingSession, currentTime, displayName);
      state.voice.finalizedSessions.push(finalized);
      delete openSessions[userId];
      result = {
        captured: true,
        stateChanged: true,
        action: "leave",
        session: finalized,
      };
    } else if (previousChannelId) {
      const recovered = finalizeVoiceSession(createOpenVoiceSession({
        guildId,
        userId,
        channelId: previousChannelId,
        joinedAt: null,
        displayName,
        incomplete: true,
        incompleteReason: "missing_open_session",
        enteredChannelIds: [previousChannelId],
      }), currentTime, displayName);
      state.voice.finalizedSessions.push(recovered);
      result = {
        captured: true,
        stateChanged: true,
        action: "leave_recovered",
        session: recovered,
      };
    }

    state.voice.openSessions = openSessions;
    if (result.stateChanged) {
      state.runtime.lastVoiceCaptureAt = currentTime;
      if (typeof saveDb === "function") {
        saveDb();
      }
    }

    return result;
  };

  if (typeof runSerialized === "function") {
    return runSerialized(execute, "daily-news-voice-capture");
  }
  return execute();
}

module.exports = {
  createOpenVoiceSession,
  finalizeVoiceSession,
  recordVoiceStateTransition,
  resolveVoiceDisplayName,
};