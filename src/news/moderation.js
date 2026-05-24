"use strict";

const { ensureNewsState } = require("./state");

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function parseIsoMs(value) {
  const timeMs = Date.parse(String(value || ""));
  return Number.isFinite(timeMs) ? timeMs : null;
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

function resolveTimeoutUntilIso(memberLike = {}) {
  const directValue = memberLike?.communicationDisabledUntil;
  if (directValue instanceof Date && Number.isFinite(directValue.getTime())) {
    return directValue.toISOString();
  }

  const directText = cleanString(directValue, 80);
  if (directText) {
    const parsedDirectMs = Date.parse(directText);
    if (Number.isFinite(parsedDirectMs)) {
      return new Date(parsedDirectMs).toISOString();
    }
  }

  const timestamp = Number(memberLike?.communicationDisabledUntilTimestamp);
  if (Number.isFinite(timestamp) && timestamp > 0) {
    return new Date(timestamp).toISOString();
  }

  return null;
}

function appendModerationEvent(state, event) {
  state.moderation.events.push(event);
  state.runtime.lastModerationCaptureAt = event.occurredAt;
}

function normalizeResolvedRemoval(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      resolution: "leave_or_kick_ambiguous",
      reason: null,
    };
  }

  return {
    resolution: cleanString(value.resolution, 120) || "leave_or_kick_ambiguous",
    reason: cleanString(value.reason, 500) || null,
  };
}

function createMemberRemovalReconciliationId(event = {}) {
  return [
    "member_remove",
    cleanString(event.userId, 80) || "na",
    cleanString(event.occurredAt, 80) || "na",
  ].join(":");
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

function pruneModerationEvents(moderationState = {}, { retainFromMs = null, prunedAt = null } = {}) {
  if (!moderationState || typeof moderationState !== "object" || Array.isArray(moderationState)) {
    return { prunedCount: 0, remainingCount: 0 };
  }

  const events = Array.isArray(moderationState.events) ? moderationState.events : [];
  if (!Number.isFinite(retainFromMs)) {
    moderationState.events = events;
    return { prunedCount: 0, remainingCount: events.length };
  }

  const keptEvents = events.filter((event) => {
    const occurredMs = parseIsoMs(event?.occurredAt);
    if (occurredMs === null) {
      return true;
    }
    return occurredMs >= retainFromMs;
  });

  moderationState.events = keptEvents;
  moderationState.lastPrunedAt = cleanString(prunedAt, 80) || moderationState.lastPrunedAt || null;
  return {
    prunedCount: events.length - keptEvents.length,
    remainingCount: keptEvents.length,
  };
}

function recordMemberRemovalEvent({ db = {}, member = {}, now, saveDb, runSerialized, resolveRemovalResolution } = {}) {
  const execute = async () => {
    const state = ensureNewsState(db);
    const occurredAt = resolveNowIso(now);
    const guildId = cleanString(member?.guild?.id, 80);
    const userId = cleanString(member?.id || member?.user?.id, 80);
    if (!guildId || !userId) {
      return { captured: false, stateChanged: false, reason: "missing_context" };
    }

    let resolvedRemoval = {
      resolution: "leave_or_kick_ambiguous",
      reason: null,
    };

    if (typeof resolveRemovalResolution === "function") {
      try {
        resolvedRemoval = normalizeResolvedRemoval(await Promise.resolve(resolveRemovalResolution({
          member,
          guildId,
          userId,
          occurredAt,
        })));
      } catch (error) {
        resolvedRemoval = {
          resolution: "leave_or_kick_ambiguous",
          reason: cleanString(`audit_lookup_failed: ${error?.message || error}`, 500) || null,
        };
      }
    }

    const event = createModerationEvent({
      eventType: "member_remove",
      guildId,
      userId,
      displayName: resolveMemberDisplayName(member, userId),
      occurredAt,
      reason: resolvedRemoval.reason,
      resolution: resolvedRemoval.resolution,
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

function collectPendingMemberRemovalEvents({ db = {}, now } = {}) {
  const state = ensureNewsState(db);
  const nowMs = parseIsoMs(resolveNowIso(now));
  const events = Array.isArray(state.moderation?.events) ? state.moderation.events : [];
  const pending = [];

  for (const rawEvent of events) {
    if (!rawEvent || typeof rawEvent !== "object") continue;
    if (cleanString(rawEvent.eventType, 80) !== "member_remove") continue;
    if (cleanString(rawEvent.resolution, 120) !== "leave_or_kick_ambiguous") continue;

    const occurredAt = cleanString(rawEvent.occurredAt, 80);
    const occurredMs = parseIsoMs(occurredAt);
    if (Number.isFinite(nowMs) && Number.isFinite(occurredMs) && occurredMs > nowMs) continue;

    pending.push({
      guildId: cleanString(rawEvent.guildId, 80),
      userId: cleanString(rawEvent.userId, 80),
      displayName: cleanString(rawEvent.displayName, 120) || cleanString(rawEvent.userId, 120) || "unknown",
      occurredAt,
      occurredMs,
      reconciliationId: createMemberRemovalReconciliationId(rawEvent),
    });
  }

  return pending;
}

function reconcileMemberRemovalEvents({ db = {}, resolutionsByEventId = {} } = {}) {
  const state = ensureNewsState(db);
  const events = Array.isArray(state.moderation?.events) ? state.moderation.events : [];
  let pendingCount = 0;
  let updatedCount = 0;

  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    if (cleanString(event.eventType, 80) !== "member_remove") continue;
    if (cleanString(event.resolution, 120) !== "leave_or_kick_ambiguous") continue;

    pendingCount += 1;
    const resolved = resolutionsByEventId?.[createMemberRemovalReconciliationId(event)];
    if (!resolved) continue;

    const normalized = normalizeResolvedRemoval(resolved);
    if (normalized.resolution === "leave_or_kick_ambiguous") continue;

    event.resolution = normalized.resolution;
    event.reason = normalized.reason;
    updatedCount += 1;
  }

  return { pendingCount, updatedCount };
}

function recordMemberTimeoutEvent({ db = {}, oldMember = {}, newMember = {}, now, saveDb, runSerialized } = {}) {
  const execute = () => {
    const state = ensureNewsState(db);
    const occurredAt = resolveNowIso(now);
    const guildId = cleanString(newMember?.guild?.id || oldMember?.guild?.id, 80);
    const userId = cleanString(newMember?.id || newMember?.user?.id || oldMember?.id || oldMember?.user?.id, 80);
    if (!guildId || !userId) {
      return { captured: false, stateChanged: false, reason: "missing_context" };
    }

    const previousTimeoutUntil = resolveTimeoutUntilIso(oldMember);
    const nextTimeoutUntil = resolveTimeoutUntilIso(newMember);
    if (previousTimeoutUntil === nextTimeoutUntil) {
      return { captured: false, stateChanged: false, reason: "no_timeout_change" };
    }

    const timeoutApplied = Boolean(nextTimeoutUntil);
    const event = createModerationEvent({
      eventType: timeoutApplied ? "timeout_add" : "timeout_remove",
      guildId,
      userId,
      displayName: resolveMemberDisplayName(newMember, userId),
      occurredAt,
      reason: timeoutApplied
        ? `until ${nextTimeoutUntil}`
        : (previousTimeoutUntil ? `previously until ${previousTimeoutUntil}` : null),
      resolution: timeoutApplied ? "timeout_confirmed" : "timeout_removed_confirmed",
    });
    appendModerationEvent(state, event);
    if (typeof saveDb === "function") saveDb();
    return { captured: true, stateChanged: true, action: event.eventType, event };
  };

  if (typeof runSerialized === "function") {
    return runSerialized(execute, "daily-news-timeout-capture");
  }
  return execute();
}

module.exports = {
  collectPendingMemberRemovalEvents,
  createModerationEvent,
  createMemberRemovalReconciliationId,
  normalizeResolvedRemoval,
  pruneModerationEvents,
  reconcileMemberRemovalEvents,
  recordGuildBanEvent,
  recordMemberRemovalEvent,
  recordMemberTimeoutEvent,
  resolveMemberDisplayName,
  resolveTimeoutUntilIso,
};