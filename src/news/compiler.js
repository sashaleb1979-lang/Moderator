"use strict";

const { ensureNewsState } = require("./state");

const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const AUDIT_BUCKET_KEYS = [
  "published_public",
  "published_staff",
  "suppressed_by_threshold",
  "pending_review",
  "rejected",
  "expired",
  "superseded",
  "ambiguous_source",
  "invalid_source",
  "orphaned",
];

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function parseIsoMs(value) {
  const timeMs = Date.parse(String(value || ""));
  return Number.isFinite(timeMs) ? timeMs : null;
}

function resolveNowIso(now) {
  if (typeof now === "function") return cleanString(now(), 80) || new Date().toISOString();
  return cleanString(now, 80) || new Date().toISOString();
}

function toIsoString(timeMs) {
  return Number.isFinite(timeMs) ? new Date(timeMs).toISOString() : null;
}

function uniqueStrings(items = [], limit = 120) {
  const result = [];
  const seen = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    const normalized = cleanString(item, limit);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function compareText(left = "", right = "") {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

function pad2(value) {
  return String(Math.max(0, Number(value) || 0)).padStart(2, "0");
}

function resolveMoscowDayKey(value) {
  const timeMs = parseIsoMs(value);
  if (timeMs === null) return null;
  return new Date(timeMs + MOSCOW_OFFSET_MS).toISOString().slice(0, 10);
}

function createMoscowDayStartMs(dayKey = "") {
  const normalizedDayKey = cleanString(dayKey, 40);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDayKey)) return null;
  const timeMs = Date.parse(`${normalizedDayKey}T00:00:00+03:00`);
  return Number.isFinite(timeMs) ? timeMs : null;
}

function buildMoscowWallClockMs(dayKey = "", hour = 0, minute = 0, second = 0) {
  const normalizedDayKey = cleanString(dayKey, 40);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDayKey)) return null;

  const timeMs = Date.parse(
    `${normalizedDayKey}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}+03:00`
  );
  return Number.isFinite(timeMs) ? timeMs : null;
}

function buildMoscowDayWindow({ dayKey = "", now, windowEndAt = null } = {}) {
  const nowIso = resolveNowIso(now);
  const nowMs = parseIsoMs(nowIso);
  if (nowMs === null) {
    throw new Error("now must resolve to a valid ISO timestamp");
  }

  const resolvedDayKey = cleanString(dayKey, 40) || resolveMoscowDayKey(nowIso);
  const dayStartMs = createMoscowDayStartMs(resolvedDayKey);
  if (dayStartMs === null) {
    throw new Error("targetDayKey must be a valid Moscow day key in YYYY-MM-DD format");
  }

  const dayEndMs = dayStartMs + DAY_MS;
  const requestedEndMs = windowEndAt == null ? null : parseIsoMs(windowEndAt);
  if (windowEndAt != null && requestedEndMs === null) {
    throw new Error("windowEndAt must be a valid ISO timestamp when provided");
  }

  const resolvedRequestedEndMs = requestedEndMs == null ? null : Math.max(dayStartMs, Math.min(requestedEndMs, dayEndMs));
  const windowEndMs = resolvedRequestedEndMs == null
    ? Math.max(dayStartMs, Math.min(nowMs, dayEndMs))
    : Math.max(dayStartMs, Math.min(resolvedRequestedEndMs, nowMs));
  const fixedEndApplied = resolvedRequestedEndMs != null && windowEndMs === resolvedRequestedEndMs;

  return {
    dayKey: resolvedDayKey,
    nowIso,
    startAt: toIsoString(dayStartMs),
    endAt: toIsoString(windowEndMs),
    requestedEndAt: toIsoString(resolvedRequestedEndMs),
    fullDayEndAt: toIsoString(dayEndMs),
    startMs: dayStartMs,
    endMs: windowEndMs,
    requestedEndMs: resolvedRequestedEndMs,
    fullDayEndMs: dayEndMs,
    isClosed: fixedEndApplied || windowEndMs >= dayEndMs,
    mode: fixedEndApplied ? "fixed_cutoff" : windowEndMs >= dayEndMs ? "full_day" : "publish_snapshot",
    timeZone: "Europe/Moscow",
  };
}

function calculateOverlapSeconds(startMs, endMs, windowStartMs, windowEndMs) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
  const overlapStartMs = Math.max(startMs, windowStartMs);
  const overlapEndMs = Math.min(endMs, windowEndMs);
  if (overlapEndMs <= overlapStartMs) return 0;
  return Math.max(0, Math.floor((overlapEndMs - overlapStartMs) / 1000));
}

function formatDurationCompact(durationSeconds) {
  const totalSeconds = Math.max(0, Number(durationSeconds) || 0);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

function createAuditCandidateId(prefix, parts = []) {
  return [cleanString(prefix, 40) || "candidate", ...parts.map((part) => cleanString(part, 120) || "na")].join(":");
}

function createEmptyBucketCounts() {
  return Object.fromEntries(AUDIT_BUCKET_KEYS.map((key) => [key, 0]));
}

function countAuditBuckets(candidates = []) {
  const counts = createEmptyBucketCounts();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const bucket = cleanString(candidate?.bucket, 80);
    if (!bucket) continue;
    if (!Object.prototype.hasOwnProperty.call(counts, bucket)) {
      counts[bucket] = 0;
    }
    counts[bucket] += 1;
  }
  return counts;
}

function createVoiceCandidate(session, { windowStartMs, windowEndMs, sourceType, effectiveEndMs = null } = {}) {
  const userId = cleanString(session?.userId, 80);
  if (!userId) return null;

  const displayName = cleanString(session?.displayName, 120) || cleanString(userId, 120) || "unknown";
  const startedMs = parseIsoMs(session?.joinedAt);
  const endedMs = Number.isFinite(effectiveEndMs) ? effectiveEndMs : parseIsoMs(session?.endedAt);

  let observed = false;
  let durationSeconds = 0;
  let firstObservedMs = null;
  let lastObservedMs = null;

  if (startedMs !== null && endedMs !== null) {
    observed = startedMs < windowEndMs && endedMs > windowStartMs;
    durationSeconds = calculateOverlapSeconds(startedMs, endedMs, windowStartMs, windowEndMs);
    if (observed) {
      firstObservedMs = Math.max(startedMs, windowStartMs);
      lastObservedMs = Math.min(endedMs, windowEndMs);
    }
  } else if (startedMs !== null) {
    observed = startedMs >= windowStartMs && startedMs < windowEndMs;
    if (observed) {
      firstObservedMs = startedMs;
      lastObservedMs = Math.min(startedMs, windowEndMs);
    }
  } else if (endedMs !== null) {
    observed = endedMs > windowStartMs && endedMs <= windowEndMs;
    if (observed) {
      firstObservedMs = endedMs;
      lastObservedMs = endedMs;
    }
  }

  if (!observed) return null;

  return {
    userId,
    displayName,
    durationSeconds,
    enteredChannelIds: uniqueStrings([
      ...(Array.isArray(session?.enteredChannelIds) ? session.enteredChannelIds : []),
      session?.currentChannelId,
      session?.finalChannelId,
    ], 80),
    moveCount: Number.isSafeInteger(Number(session?.moveCount)) ? Number(session.moveCount) : 0,
    incomplete: session?.incomplete === true,
    incompleteReason: session?.incomplete === true ? cleanString(session?.incompleteReason, 120) || "unknown" : null,
    firstObservedMs,
    lastObservedMs,
    sourceType,
  };
}

function addVoiceCandidate(aggregateByUser, candidate) {
  const existing = aggregateByUser.get(candidate.userId) || {
    userId: candidate.userId,
    displayName: candidate.displayName,
    totalDurationSeconds: 0,
    sessionCount: 0,
    moveCount: 0,
    enteredChannelIds: [],
    incomplete: false,
    incompleteReasons: [],
    firstObservedMs: null,
    lastObservedMs: null,
    sourceTypes: [],
  };

  existing.totalDurationSeconds += Math.max(0, Number(candidate.durationSeconds) || 0);
  existing.sessionCount += 1;
  existing.moveCount += Math.max(0, Number(candidate.moveCount) || 0);
  existing.enteredChannelIds = uniqueStrings([
    ...existing.enteredChannelIds,
    ...(Array.isArray(candidate.enteredChannelIds) ? candidate.enteredChannelIds : []),
  ], 80);
  existing.sourceTypes = uniqueStrings([...existing.sourceTypes, candidate.sourceType], 40);

  if (candidate.incomplete) {
    existing.incomplete = true;
    existing.incompleteReasons = uniqueStrings([...existing.incompleteReasons, candidate.incompleteReason || "unknown"], 120);
  }

  if (candidate.firstObservedMs !== null && (existing.firstObservedMs === null || candidate.firstObservedMs < existing.firstObservedMs)) {
    existing.firstObservedMs = candidate.firstObservedMs;
  }
  if (candidate.lastObservedMs !== null && (existing.lastObservedMs === null || candidate.lastObservedMs >= existing.lastObservedMs)) {
    existing.lastObservedMs = candidate.lastObservedMs;
    existing.displayName = candidate.displayName || existing.displayName;
  }

  aggregateByUser.set(candidate.userId, existing);
}

function compareVoiceVisitors(left, right) {
  const leftFirstMs = left.firstObservedMs === null ? Number.MAX_SAFE_INTEGER : left.firstObservedMs;
  const rightFirstMs = right.firstObservedMs === null ? Number.MAX_SAFE_INTEGER : right.firstObservedMs;
  return leftFirstMs - rightFirstMs || compareText(left.displayName, right.displayName);
}

function compareVoiceLeaders(left, right) {
  return right.totalDurationSeconds - left.totalDurationSeconds
    || compareVoiceVisitors(left, right);
}

function collectVoiceDigest(state, window) {
  const voiceState = state.voice && typeof state.voice === "object" && !Array.isArray(state.voice) ? state.voice : {};
  const aggregateByUser = new Map();
  const sourceCandidates = [];
  let incompleteSessionCount = 0;
  let sourceSessionCount = 0;

  const finalizedSessions = Array.isArray(voiceState.finalizedSessions) ? voiceState.finalizedSessions : [];
  for (const session of finalizedSessions) {
    const candidate = createVoiceCandidate(session, {
      windowStartMs: window.startMs,
      windowEndMs: window.endMs,
      sourceType: "finalized_session",
    });
    if (!candidate) continue;
    sourceCandidates.push(candidate);
    sourceSessionCount += 1;
    if (candidate.incomplete) incompleteSessionCount += 1;
    addVoiceCandidate(aggregateByUser, candidate);
  }

  const openSessions = voiceState.openSessions && typeof voiceState.openSessions === "object" && !Array.isArray(voiceState.openSessions)
    ? Object.values(voiceState.openSessions)
    : [];
  for (const session of openSessions) {
    const candidate = createVoiceCandidate(session, {
      windowStartMs: window.startMs,
      windowEndMs: window.endMs,
      sourceType: "open_session_snapshot",
      effectiveEndMs: window.endMs,
    });
    if (!candidate) continue;
    sourceCandidates.push(candidate);
    sourceSessionCount += 1;
    if (candidate.incomplete) incompleteSessionCount += 1;
    addVoiceCandidate(aggregateByUser, candidate);
  }

  const visitors = [...aggregateByUser.values()]
    .sort(compareVoiceVisitors)
    .map((entry) => ({
      userId: entry.userId,
      displayName: entry.displayName,
      totalDurationSeconds: entry.totalDurationSeconds,
      totalDurationLabel: formatDurationCompact(entry.totalDurationSeconds),
      sessionCount: entry.sessionCount,
      moveCount: entry.moveCount,
      enteredChannelIds: entry.enteredChannelIds,
      incomplete: entry.incomplete,
      incompleteReasons: entry.incompleteReasons,
      firstObservedAt: toIsoString(entry.firstObservedMs),
      lastObservedAt: toIsoString(entry.lastObservedMs),
      sourceTypes: entry.sourceTypes,
    }));

  const leaderboard = [...visitors]
    .sort(compareVoiceLeaders)
    .slice(0, Math.max(1, Number(state.config?.voice?.topCount) || 5));
  const leaderboardUserIds = new Set(leaderboard.map((entry) => entry.userId));
  const includeFullListPublic = state.config?.voice?.includeFullList === true;
  const visitorNames = visitors.map((entry) => entry.displayName);
  const partialReasons = [];
  if (incompleteSessionCount > 0) {
    partialReasons.push("incomplete_voice_recovery");
  }

  const candidateBuckets = sourceCandidates.map((candidate) => {
    let bucket = "suppressed_by_threshold";
    let detail = "not_in_public_voice_output";

    if (candidate.incomplete) {
      bucket = "ambiguous_source";
      detail = candidate.incompleteReason || "unknown";
    } else if (includeFullListPublic || leaderboardUserIds.has(candidate.userId)) {
      bucket = "published_public";
      detail = includeFullListPublic ? "voice_full_list" : "voice_top_visitors";
    }

    return {
      id: createAuditCandidateId("voice", [
        candidate.sourceType,
        candidate.userId,
        toIsoString(candidate.firstObservedMs),
        toIsoString(candidate.lastObservedMs),
      ]),
      module: "voice",
      bucket,
      detail,
      sourceType: candidate.sourceType,
      userId: candidate.userId,
      displayName: candidate.displayName,
      occurredAt: toIsoString(candidate.firstObservedMs) || toIsoString(candidate.lastObservedMs),
    };
  });

  return {
    visitorCount: visitors.length,
    visitors,
    visitorDisplayNames: visitorNames,
    allVisitorsLine: visitorNames.join(", "),
    topVisitors: leaderboard,
    sourceSessionCount,
    incompleteSessionCount,
    partial: partialReasons.length > 0,
    partialReasons,
    candidateBuckets,
  };
}

function normalizeModerationEvent(event) {
  return {
    eventType: cleanString(event?.eventType, 80),
    guildId: cleanString(event?.guildId, 80),
    userId: cleanString(event?.userId, 80),
    displayName: cleanString(event?.displayName, 120) || cleanString(event?.userId, 120) || "unknown",
    occurredAt: cleanString(event?.occurredAt, 80),
    reason: cleanString(event?.reason, 500) || null,
    resolution: cleanString(event?.resolution, 120) || null,
  };
}

function isClearPublicModerationEvent(event, config) {
  if (event.eventType === "member_remove") {
    return config.moderation?.includeLeavesPublic === true
      && (event.resolution === "leave_confirmed" || event.resolution === "kick_confirmed");
  }

  if (event.eventType === "ban_add" || event.eventType === "ban_remove") {
    return config.moderation?.includeBansPublic === true
      && (event.resolution === "ban_confirmed" || event.resolution === "unban_confirmed");
  }

  if (event.eventType === "timeout_add" || event.eventType === "timeout_remove") {
    return event.resolution !== null && !/ambiguous/i.test(event.resolution);
  }

  return false;
}

function collectModerationDigest(state, window) {
  const moderationState = state.moderation && typeof state.moderation === "object" && !Array.isArray(state.moderation)
    ? state.moderation
    : {};
  const events = [];
  const candidateBuckets = [];

  for (const rawEvent of Array.isArray(moderationState.events) ? moderationState.events : []) {
    const event = normalizeModerationEvent(rawEvent);
    const occurredMs = parseIsoMs(event.occurredAt);
    if (occurredMs === null) continue;
    if (occurredMs < window.startMs || occurredMs > window.endMs) continue;
    events.push({ ...event, occurredMs });
  }

  events.sort((left, right) => left.occurredMs - right.occurredMs || compareText(left.displayName, right.displayName));

  const publicHighlights = [];
  const staffHighlights = [];
  const byType = {
    member_remove: 0,
    ban_add: 0,
    ban_remove: 0,
    timeout_add: 0,
    timeout_remove: 0,
    other: 0,
  };

  let ambiguousCount = 0;
  for (const event of events) {
    if (Object.prototype.hasOwnProperty.call(byType, event.eventType)) {
      byType[event.eventType] += 1;
    } else {
      byType.other += 1;
    }

    const isAmbiguous = /ambiguous/i.test(String(event.resolution || ""));
    if (isAmbiguous) ambiguousCount += 1;

    const normalizedEvent = {
      eventType: event.eventType,
      guildId: event.guildId,
      userId: event.userId,
      displayName: event.displayName,
      occurredAt: event.occurredAt,
      reason: event.reason,
      resolution: event.resolution,
      publicEligible: isClearPublicModerationEvent(event, state.config),
      ambiguous: isAmbiguous,
    };

    let bucket = "published_staff";
    let detail = "staff_digest_only";
    if (normalizedEvent.publicEligible) {
      bucket = "published_public";
      detail = "public_moderation_highlight";
    } else if (normalizedEvent.ambiguous) {
      bucket = "ambiguous_source";
      detail = normalizedEvent.resolution || "ambiguous";
    }

    normalizedEvent.bucket = bucket;
    normalizedEvent.bucketDetail = detail;

    candidateBuckets.push({
      id: createAuditCandidateId("moderation", [event.eventType, event.userId, event.occurredAt]),
      module: "moderation",
      bucket,
      detail,
      sourceType: event.eventType,
      userId: event.userId,
      displayName: event.displayName,
      occurredAt: event.occurredAt,
    });

    staffHighlights.push(normalizedEvent);
    if (normalizedEvent.publicEligible) {
      publicHighlights.push(normalizedEvent);
    }
  }

  return {
    totalCount: events.length,
    byType,
    ambiguousCount,
    publicHighlights,
    staffHighlights,
    candidateBuckets,
  };
}

function createAuditSummary(voiceDigest, moderationDigest, auditCandidates) {
  return {
    rawCandidateCounts: {
      voiceSessions: voiceDigest.candidateBuckets.length,
      moderationEvents: moderationDigest.candidateBuckets.length,
      total: auditCandidates.length,
    },
    emittedCounts: {
      voiceVisitors: voiceDigest.visitorCount,
      publicModerationHighlights: moderationDigest.publicHighlights.length,
      staffModerationEvents: moderationDigest.staffHighlights.length,
    },
    ambiguousSourceCount: auditCandidates.filter((candidate) => candidate.bucket === "ambiguous_source").length,
    bucketCounts: countAuditBuckets(auditCandidates),
    candidates: clone(auditCandidates),
  };
}

function compileDailyNewsDigest({ db = {}, targetDayKey = "", now, saveDb, windowEndAt = null } = {}) {
  const state = ensureNewsState(db);
  const compileStartedAt = resolveNowIso(now);
  state.runtime.lastCompileStartedAt = compileStartedAt;
  state.runtime.lastCompileStatus = "running";

  try {
    const window = buildMoscowDayWindow({ dayKey: targetDayKey, now: compileStartedAt, windowEndAt });
    const voice = collectVoiceDigest(state, window);
    const moderation = collectModerationDigest(state, window);
    const auditCandidates = [
      ...voice.candidateBuckets,
      ...moderation.candidateBuckets,
    ];
    const coverageReasons = uniqueStrings([
      ...voice.partialReasons,
      ...(moderation.ambiguousCount > 0 ? ["ambiguous_moderation"] : []),
    ], 120);

    const digest = {
      dayKey: window.dayKey,
      compiledAt: compileStartedAt,
      coverageWindow: {
        startAt: window.startAt,
        endAt: window.endAt,
        requestedEndAt: window.requestedEndAt,
        fullDayEndAt: window.fullDayEndAt,
        isClosed: window.isClosed,
        mode: window.mode,
        timeZone: window.timeZone,
      },
      voice,
      moderation,
      coverage: {
        partial: voice.partial,
        ambiguous: moderation.ambiguousCount > 0,
        reasons: coverageReasons,
      },
      audit: createAuditSummary(voice, moderation, auditCandidates),
      publicEdition: {
        voice: {
          enabled: voice.visitorCount > 0,
          topVisitors: clone(voice.topVisitors),
          visitorCount: voice.visitorCount,
          allVisitorsLine: state.config?.voice?.includeFullList === true ? voice.allVisitorsLine : null,
          publishFullListInThread: state.config?.voice?.publishFullListInThread === true,
        },
        moderation: {
          enabled: moderation.publicHighlights.length > 0,
          highlights: clone(moderation.publicHighlights),
        },
      },
      staffDigest: {
        voiceCoverage: {
          partial: voice.partial,
          incompleteSessionCount: voice.incompleteSessionCount,
          notes: clone(voice.partialReasons),
        },
        moderation: {
          totalCount: moderation.totalCount,
          ambiguousCount: moderation.ambiguousCount,
          events: clone(moderation.staffHighlights),
        },
      },
    };

    state.dailyDigests[window.dayKey] = digest;
    state.runtime.lastCompileFinishedAt = compileStartedAt;
    state.runtime.lastCompiledDayKey = window.dayKey;
    state.runtime.lastCompileStatus = "compiled";
    state.runtime.lastCoverageSummary = clone(digest.coverage);
    state.runtime.lastAuditCounts = clone(digest.audit);
    state.runtime.lastFailure = null;

    if (typeof saveDb === "function") {
      saveDb();
    }

    return {
      compiled: true,
      dayKey: window.dayKey,
      digest,
    };
  } catch (error) {
    state.runtime.lastCompileStatus = "failed";
    state.runtime.lastFailure = {
      stage: "compile_daily_news_digest",
      message: cleanString(error?.message, 400) || "unknown_error",
      occurredAt: compileStartedAt,
    };
    if (typeof saveDb === "function") {
      saveDb();
    }
    throw error;
  }
}

module.exports = {
  buildMoscowDayWindow,
  buildMoscowWallClockMs,
  collectModerationDigest,
  collectVoiceDigest,
  compileDailyNewsDigest,
  resolveMoscowDayKey,
};