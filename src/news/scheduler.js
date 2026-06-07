"use strict";

const { compileDailyNewsDigest, resolveMoscowDayKey } = require("./compiler");
const { publishDailyNewsIssue } = require("./publisher");
const { ensureNewsState } = require("./state");

const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;

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

function pad2(value) {
  return String(Math.max(0, Number(value) || 0)).padStart(2, "0");
}

function resolveMoscowWallClock(now) {
  const nowIso = resolveNowIso(now);
  const timeMs = parseIsoMs(nowIso);
  if (timeMs === null) {
    throw new Error("now must resolve to a valid ISO timestamp");
  }

  const shiftedIso = new Date(timeMs + MOSCOW_OFFSET_MS).toISOString();
  return {
    nowIso,
    dayKey: resolveMoscowDayKey(nowIso),
    hour: Number(shiftedIso.slice(11, 13)),
    minute: Number(shiftedIso.slice(14, 16)),
  };
}

function resolveDailyNewsWindowEndAt(dayKey = "", publishHourMsk = 21) {
  const normalizedDayKey = cleanString(dayKey, 40);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDayKey)) {
    throw new Error("dayKey must be a valid Moscow day key in YYYY-MM-DD format");
  }

  const normalizedPublishHour = Number.isSafeInteger(Number(publishHourMsk)) ? Number(publishHourMsk) : 21;
  const timeMs = Date.parse(`${normalizedDayKey}T${pad2(normalizedPublishHour)}:00:00+03:00`);
  if (!Number.isFinite(timeMs)) {
    throw new Error("publishHourMsk must resolve to a valid Moscow cutoff time");
  }
  return new Date(timeMs).toISOString();
}

function shouldRunDailyNewsCompileTick({ db = {}, now } = {}) {
  const state = ensureNewsState(db);
  const wallClock = resolveMoscowWallClock(now);
  const publishHourMsk = Number.isSafeInteger(Number(state.config?.schedule?.publishHourMsk))
    ? Number(state.config.schedule.publishHourMsk)
    : 21;

  if (state.config?.enabled !== true) {
    return {
      shouldRun: false,
      reason: "disabled",
      dayKey: wallClock.dayKey,
      publishHourMsk,
      nowIso: wallClock.nowIso,
    };
  }

  if (wallClock.hour < publishHourMsk) {
    return {
      shouldRun: false,
      reason: "before_publish_hour",
      dayKey: wallClock.dayKey,
      publishHourMsk,
      nowIso: wallClock.nowIso,
    };
  }

  if (cleanString(state.runtime?.lastCompiledDayKey, 40) === wallClock.dayKey) {
    return {
      shouldRun: false,
      reason: "already_compiled",
      dayKey: wallClock.dayKey,
      publishHourMsk,
      nowIso: wallClock.nowIso,
    };
  }

  return {
    shouldRun: true,
    reason: null,
    dayKey: wallClock.dayKey,
    publishHourMsk,
    nowIso: wallClock.nowIso,
  };
}

function buildSkippedCompileResult(decision = {}) {
  return {
    compiled: false,
    skipped: true,
    reason: decision.reason || null,
    dayKey: decision.dayKey || null,
    publishHourMsk: decision.publishHourMsk,
    nowIso: decision.nowIso || null,
    mode: "shadow",
    digest: null,
  };
}

async function persistDb(saveDb) {
  if (typeof saveDb === "function") {
    await Promise.resolve(saveDb());
  }
}

async function markHistoricalQueueDayReleased({ queue, dayKeys = [], dayKey = "", now, saveDb } = {}) {
  queue.dayKeys = dayKeys.slice(1);
  queue.lastReleasedDayKey = cleanString(dayKey, 40) || null;
  queue.lastReleasedAt = resolveNowIso(now);
  queue.completedDayCount = Math.max(0, Number(queue.completedDayCount) || 0) + 1;
  queue.currentDayKey = null;
  queue.currentStartedAt = null;
  queue.lastFailedDayKey = null;
  queue.lastFailureMessage = null;
  queue.lastFailureAt = null;
  if (!queue.dayKeys.length) {
    queue.active = false;
  }
  await persistDb(saveDb);
}

async function runHistoricalReleaseQueueTick({
  db = {},
  now,
  saveDb,
  compileDailyNewsDigestFn = compileDailyNewsDigest,
  publishDailyNewsIssueFn = publishDailyNewsIssue,
  client = null,
  publicChannel = null,
  staffChannel = null,
} = {}) {
  const state = ensureNewsState(db);
  const queue = state.runtime?.releaseQueue;
  const dayKeys = Array.isArray(queue?.dayKeys) ? queue.dayKeys : [];
  if (queue?.active !== true || !dayKeys.length) {
    return null;
  }

  const dayKey = cleanString(dayKeys[0], 40);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
    queue.dayKeys = dayKeys.slice(1);
    if (!queue.dayKeys.length) {
      queue.active = false;
    }
    await persistDb(saveDb);
    return {
      compiled: false,
      skipped: true,
      reason: "invalid_queue_day",
      dayKey: null,
      publishHourMsk: null,
      nowIso: resolveNowIso(now),
      mode: "history_queue",
      digest: null,
      published: false,
      publishSkipped: true,
      publishReason: "invalid_queue_day",
      releaseMode: "history_queue",
      publish: null,
      queueRemainingCount: queue.dayKeys.length,
    };
  }

  const publicChannelId = cleanString(state.config?.channels?.publicChannelId, 80);
  if (!publicChannel && !publicChannelId) {
    queue.currentDayKey = dayKey;
    queue.currentStartedAt ||= resolveNowIso(now);
    queue.lastFailedDayKey = dayKey;
    queue.lastFailureMessage = "не привязан публичный канал";
    queue.lastFailureAt = resolveNowIso(now);
    await persistDb(saveDb);
    return {
      compiled: false,
      skipped: true,
      reason: "queue_waiting_public_channel",
      dayKey,
      publishHourMsk: null,
      nowIso: resolveNowIso(now),
      mode: "history_queue",
      digest: state.dailyDigests?.[dayKey] || null,
      published: false,
      publishSkipped: true,
      publishReason: "missing_public_channel",
      releaseMode: "history_queue",
      publish: null,
      queueRemainingCount: queue.dayKeys.length,
    };
  }

  queue.currentDayKey = dayKey;
  queue.currentStartedAt = resolveNowIso(now);
  queue.lastFailedDayKey = null;
  queue.lastFailureMessage = null;
  queue.lastFailureAt = null;
  await persistDb(saveDb);

  let digest = null;
  let compiled = false;
  try {
    const compileResult = compileDailyNewsDigestFn({
      db,
      targetDayKey: dayKey,
      now,
      historySnapshotMode: "capture_if_current_day",
    });
    digest = compileResult?.digest || state.dailyDigests?.[dayKey] || null;
    compiled = true;
    await persistDb(saveDb);
  } catch (error) {
    const failureAt = resolveNowIso(now);
    const failureMessage = cleanString(error?.message || error, 400) || "unknown_error";
    queue.lastFailedDayKey = dayKey;
    queue.lastFailureMessage = failureMessage;
    queue.lastFailureAt = failureAt;
    state.runtime.lastFailure = {
      stage: "historical_release_queue_compile",
      dayKey,
      message: failureMessage,
      occurredAt: failureAt,
    };
    await persistDb(saveDb);
    return {
      compiled: false,
      skipped: false,
      reason: null,
      dayKey,
      publishHourMsk: null,
      nowIso: resolveNowIso(now),
      mode: "history_queue",
      digest: null,
      published: false,
      publishSkipped: false,
      publishFailed: true,
      publishReason: "compile_failed",
      releaseMode: "history_queue",
      publish: null,
      queueRemainingCount: queue.dayKeys.length,
      error: state.runtime.lastFailure,
    };
  }

  let publish = null;
  try {
    publish = await publishDailyNewsIssueFn({
      db,
      digest,
      dayKey,
      client,
      publicChannel,
      staffChannel,
      publishMode: "public",
      force: true,
      now,
      saveDb,
    });
  } catch (error) {
    const failureAt = resolveNowIso(now);
    const failureMessage = cleanString(error?.message || error, 400) || "unknown_error";
    queue.lastFailedDayKey = dayKey;
    queue.lastFailureMessage = failureMessage;
    queue.lastFailureAt = failureAt;
    state.runtime.lastFailure = {
      stage: "historical_release_queue",
      dayKey,
      message: failureMessage,
      occurredAt: failureAt,
    };
    await persistDb(saveDb);
    return {
      compiled,
      skipped: false,
      reason: null,
      dayKey,
      publishHourMsk: null,
      nowIso: resolveNowIso(now),
      mode: "history_queue",
      digest,
      published: false,
      publishSkipped: false,
      publishFailed: true,
      publishReason: "publish_failed",
      releaseMode: "history_queue",
      publish: null,
      queueRemainingCount: queue.dayKeys.length,
      error: state.runtime.lastFailure,
    };
  }

  if (publish.published === true) {
    await markHistoricalQueueDayReleased({ queue, dayKeys, dayKey, now, saveDb });
  } else if (publish.skipped === true) {
    const failureAt = resolveNowIso(now);
    const failureMessage = cleanString(publish.reason, 120) || "publish_skipped";
    queue.lastFailedDayKey = dayKey;
    queue.lastFailureMessage = failureMessage;
    queue.lastFailureAt = failureAt;
    state.runtime.lastFailure = {
      stage: "historical_release_queue",
      dayKey,
      message: failureMessage,
      occurredAt: failureAt,
    };
    await persistDb(saveDb);
    return {
      compiled,
      skipped: false,
      reason: null,
      dayKey,
      publishHourMsk: null,
      nowIso: resolveNowIso(now),
      mode: "history_queue",
      digest,
      published: false,
      publishSkipped: true,
      publishFailed: true,
      publishReason: failureMessage,
      releaseMode: "history_queue",
      publish,
      queueRemainingCount: queue.dayKeys.length,
      error: state.runtime.lastFailure,
    };
  }

  return {
    compiled,
    skipped: false,
    reason: null,
    dayKey,
    publishHourMsk: null,
    nowIso: resolveNowIso(now),
    mode: "history_queue",
    digest,
    published: publish.published === true,
    publishSkipped: publish.skipped === true,
    publishReason: cleanString(publish.reason, 80) || null,
    releaseMode: "history_queue",
    publish,
    queueRemainingCount: Array.isArray(queue.dayKeys) ? queue.dayKeys.length : 0,
  };
}

async function runBeforeCompileHook({ beforeCompile = null, db = {}, decision = {} } = {}) {
  if (typeof beforeCompile !== "function") return null;
  return Promise.resolve(beforeCompile({
    db,
    dayKey: decision.dayKey,
    publishHourMsk: decision.publishHourMsk,
    nowIso: decision.nowIso,
  }));
}

function shouldRecompileAfterBeforeCompile(beforeCompileResult = null) {
  if (beforeCompileResult === true) return true;
  if (!beforeCompileResult || typeof beforeCompileResult !== "object") return false;
  return beforeCompileResult.shouldRecompile === true
    || beforeCompileResult.stateChanged === true
    || Number(beforeCompileResult.updatedCount) > 0
    || Number(beforeCompileResult.changedCount) > 0;
}

async function executeDailyNewsCompile({
  db = {},
  now,
  saveDb,
  decision = {},
  compileDailyNewsDigestFn = compileDailyNewsDigest,
} = {}) {
  const state = ensureNewsState(db);

  try {
    const result = compileDailyNewsDigestFn({
      db,
      targetDayKey: decision.dayKey,
      now: typeof now === "function" ? now : decision.nowIso,
      windowEndAt: resolveDailyNewsWindowEndAt(decision.dayKey, decision.publishHourMsk),
      historySnapshotMode: "capture_if_current_day",
    });
    state.runtime.lastCompileStatus = "shadow_compiled";
    await persistDb(saveDb);
    return {
      compiled: true,
      skipped: false,
      reason: null,
      dayKey: decision.dayKey,
      publishHourMsk: decision.publishHourMsk,
      nowIso: decision.nowIso,
      mode: "shadow",
      digest: result?.digest || null,
    };
  } catch (error) {
    await persistDb(saveDb);
    throw error;
  }
}

async function runDailyNewsCompileTick({ db = {}, now, saveDb, beforeCompile = null, compileDailyNewsDigestFn = compileDailyNewsDigest } = {}) {
  const decision = shouldRunDailyNewsCompileTick({ db, now });

  if (!decision.shouldRun) {
    return buildSkippedCompileResult(decision);
  }

  await runBeforeCompileHook({ beforeCompile, db, decision });
  return executeDailyNewsCompile({
    db,
    now,
    saveDb,
    decision,
    compileDailyNewsDigestFn,
  });
}

async function runDailyNewsReleaseTick({
  db = {},
  now,
  saveDb,
  beforeCompile = null,
  compileDailyNewsDigestFn = compileDailyNewsDigest,
  publishDailyNewsIssueFn = publishDailyNewsIssue,
  client = null,
  publicChannel = null,
  staffChannel = null,
  force = false,
} = {}) {
  const state = ensureNewsState(db);
  const historyQueueResult = await runHistoricalReleaseQueueTick({
    db,
    now,
    saveDb,
    compileDailyNewsDigestFn,
    publishDailyNewsIssueFn,
    client,
    publicChannel,
    staffChannel,
  });
  if (historyQueueResult) {
    return historyQueueResult;
  }
  const decision = shouldRunDailyNewsCompileTick({ db, now });

  let compileResult = buildSkippedCompileResult(decision);
  let beforeCompileResult = null;

  if (decision.shouldRun || decision.reason === "already_compiled") {
    beforeCompileResult = await runBeforeCompileHook({ beforeCompile, db, decision });
  }

  if (decision.shouldRun || (decision.reason === "already_compiled" && shouldRecompileAfterBeforeCompile(beforeCompileResult))) {
    compileResult = await executeDailyNewsCompile({
      db,
      now,
      saveDb,
      decision,
      compileDailyNewsDigestFn,
    });
  } else if (decision.reason !== "already_compiled") {
    return {
      ...compileResult,
      published: false,
      publishSkipped: true,
      publishReason: "compile_not_ready",
      releaseMode: state.config?.publish?.autoPublishEnabled === true ? "auto_publish" : "manual_only",
      publish: null,
    };
  }

  if (state.config?.publish?.autoPublishEnabled !== true) {
    return {
      ...compileResult,
      published: false,
      publishSkipped: true,
      publishReason: "auto_publish_disabled",
      releaseMode: "manual_only",
      publish: null,
    };
  }

  const publicChannelId = cleanString(state.config?.channels?.publicChannelId, 80);
  if (!publicChannel && !publicChannelId) {
    return {
      ...compileResult,
      published: false,
      publishSkipped: true,
      publishReason: "missing_public_channel",
      releaseMode: "auto_publish",
      publish: null,
    };
  }

  const publish = await publishDailyNewsIssueFn({
    db,
    digest: compileResult.digest,
    dayKey: compileResult.dayKey || decision.dayKey,
    client,
    publicChannel,
    staffChannel,
    publishMode: "public",
    force,
    now,
    saveDb,
  });

  return {
    ...compileResult,
    published: publish.published === true,
    publishSkipped: publish.skipped === true,
    publishReason: cleanString(publish.reason, 80) || null,
    releaseMode: "auto_publish",
    publish,
  };
}

module.exports = {
  resolveDailyNewsWindowEndAt,
  resolveMoscowWallClock,
  runDailyNewsCompileTick,
  runDailyNewsReleaseTick,
  shouldRunDailyNewsCompileTick,
};
