"use strict";

const { compileDailyNewsDigest, resolveMoscowDayKey } = require("./compiler");
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

function runDailyNewsCompileTick({ db = {}, now, saveDb, compileDailyNewsDigestFn = compileDailyNewsDigest } = {}) {
  const state = ensureNewsState(db);
  const decision = shouldRunDailyNewsCompileTick({ db, now });

  if (!decision.shouldRun) {
    return {
      compiled: false,
      skipped: true,
      reason: decision.reason,
      dayKey: decision.dayKey,
      publishHourMsk: decision.publishHourMsk,
      nowIso: decision.nowIso,
    };
  }

  try {
    const result = compileDailyNewsDigestFn({
      db,
      targetDayKey: decision.dayKey,
      now: decision.nowIso,
      windowEndAt: resolveDailyNewsWindowEndAt(decision.dayKey, decision.publishHourMsk),
    });
    state.runtime.lastCompileStatus = "shadow_compiled";
    if (typeof saveDb === "function") {
      saveDb();
    }
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
    if (typeof saveDb === "function") {
      saveDb();
    }
    throw error;
  }
}

module.exports = {
  resolveDailyNewsWindowEndAt,
  resolveMoscowWallClock,
  runDailyNewsCompileTick,
  shouldRunDailyNewsCompileTick,
};