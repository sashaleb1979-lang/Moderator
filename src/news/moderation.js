"use strict";

const { ensureNewsState } = require("./state");

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function resolveNowIso(now) {
  if (typeof now === "function") return cleanString(now(), 80) || new Date().toISOString();
  return cleanString(now, 80) || new Date().toISOString();
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function resolveMemberDisplayName(memberLike = {}, fallbackUserId = "") {
  const member = memberLike && typeof memberLike === "object" ? memberLike : {};
  const user = member.user && typeof member.user === "object" ? member.user : member;
  return cleanString(member.displayName, 120)
    || cleanString(member.nickname, 120)
    || cleanString(user.globalName, 120)
    || cleanString(user.username, 120)
    || cleanString(fallbackUserId, 120)
    || "unknown";
}

function appendModerationEvent(state, event) {
  state.moderation.events.push(event);
  state.runtime.lastModerationCaptureAt = event.occurredAt;
}

function createModerationEvent({ eventType, guildId, userId, displayName, occurredAt, reason = null, resolution = null } = {}) {
  return {
    eventType: cleanString(eventType, 80),
    guildId: cleanString(guildId, 80),
    userId: cleanString(userId, 80),
    displayName: cleanString(displayName, 120) || cleanString(userId, 120) || "unknown",
    occurredAt: cleanString(occurredAt, 80),
    reason: cleanString(reason, 500) || null,
    resolution: cleanString(resolution, 120) || null,
  };
}

function recordMemberRemovalEvent({ db = {}, member = {}, now, saveDb, runSerialized } = {}) {
  const execute = () => {
    const state = ensureNewsState(db);
    const occurredAt = resolveNowIso(now);
    const guildId = cleanString(member?.guild?.id, 80);
    const userId = cleanString(member?.id || member?.user?.id, 80);
    if (!guildId || !userId) {
      return { captured: false, stateChanged: false, reason: "missing_context" };
    }

    const event = createModerationEvent({
      eventType: "member_remove",
      guildId,
      userId,
      displayName: resolveMemberDisplayName(member, userId),
      occurredAt,
      resolution: "leave_or_kick_ambiguous",
    });
    appendModerationEvent(state, event);
    if (typeof saveDb === "function") saveDb();
    return { captured: true, stateChanged: true, action: "member_remove", event };
  };

  if (typeof runSerialized === "function") {
    return runSerialized(execute, "daily-news-member-remove-capture");
  }
  return execute();
}

function recordGuildBanEvent({ db = {}, ban = {}, eventType = "ban_add", now, saveDb, runSerialized } = {}) {
  const execute = () => {
    const state = ensureNewsState(db);
    const occurredAt = resolveNowIso(now);
    const guildId = cleanString(ban?.guild?.id, 80);
    const userId = cleanString(ban?.user?.id, 80);
    if (!guildId || !userId) {
      return { captured: false, stateChanged: false, reason: "missing_context" };
    }

    const normalizedEventType = eventType === "ban_remove" ? "ban_remove" : "ban_add";
    const event = createModerationEvent({
      eventType: normalizedEventType,
      guildId,
      userId,
      displayName: resolveMemberDisplayName(ban?.user, userId),
      occurredAt,
      resolution: normalizedEventType === "ban_add" ? "ban_confirmed" : "unban_confirmed",
    });
    appendModerationEvent(state, event);
    if (typeof saveDb === "function") saveDb();
    return { captured: true, stateChanged: true, action: normalizedEventType, event };
  };

  if (typeof runSerialized === "function") {
    return runSerialized(execute, `daily-news-${eventType}-capture`);
  }
  return execute();
}

module.exports = {
  createModerationEvent,
  recordGuildBanEvent,
  recordMemberRemovalEvent,
  resolveMemberDisplayName,
};