"use strict";

const { compileDailyNewsPreview, renderStoredDailyNewsPreview } = require("./preview");
const { publishDailyNewsIssue } = require("./publisher");
const { ensureNewsState } = require("./state");

const DAILY_NEWS_OPERATOR_ACTIONS = Object.freeze({
  STATUS: "status",
  PREVIEW_TODAY: "preview_today",
  PREVIEW_DAY: "preview_day",
  RERUN_DAY: "rerun_day",
  PUBLISH_NOW: "publish_now",
});

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function buildDailyNewsStatusPayload(db = {}) {
  const state = ensureNewsState(db);
  const coverage = state.runtime.lastCoverageSummary || {};
  const audit = state.runtime.lastAuditCounts || {};
  return {
    content: [
      "## 🗞️ Daily News status",
      `compile: **${state.runtime.lastCompileStatus || "idle"}** · day **${state.runtime.lastCompiledDayKey || "—"}**`,
      `publish: **${state.runtime.lastPublishStatus || "idle"}** · day **${state.runtime.lastPublishedDayKey || "—"}**`,
      `coverage: **${coverage.partial ? "partial" : "clean"}${coverage.ambiguous ? " + ambiguous" : ""}**`,
      `candidates: **${audit.rawCandidateCounts?.total || 0}**`,
      state.runtime.lastFailure?.message ? `last failure: **${state.runtime.lastFailure.message}**` : "last failure: **—**",
    ].join("\n"),
    allowedMentions: { parse: [] },
  };
}

async function runDailyNewsOperatorAction({
  db = {},
  action = DAILY_NEWS_OPERATOR_ACTIONS.STATUS,
  dayKey = "",
  now,
  windowEndAt = null,
  client = null,
  publicChannel = null,
  staffChannel = null,
  force = false,
  saveDb,
} = {}) {
  const normalizedAction = cleanString(action, 80) || DAILY_NEWS_OPERATOR_ACTIONS.STATUS;

  if (normalizedAction === DAILY_NEWS_OPERATOR_ACTIONS.STATUS) {
    return { action: normalizedAction, payload: buildDailyNewsStatusPayload(db) };
  }

  if (normalizedAction === DAILY_NEWS_OPERATOR_ACTIONS.PREVIEW_TODAY || normalizedAction === DAILY_NEWS_OPERATOR_ACTIONS.PREVIEW_DAY || normalizedAction === DAILY_NEWS_OPERATOR_ACTIONS.RERUN_DAY) {
    const result = compileDailyNewsPreview({ db, targetDayKey: dayKey, now, windowEndAt, saveDb });
    return {
      action: normalizedAction,
      dayKey: result.dayKey,
      digest: result.digest,
      issue: result.issue,
      payload: result.issue.publicMessage,
      staffPayload: result.issue.staffMessage,
    };
  }

  if (normalizedAction === DAILY_NEWS_OPERATOR_ACTIONS.PUBLISH_NOW) {
    const preview = compileDailyNewsPreview({ db, targetDayKey: dayKey, now, windowEndAt, saveDb });
    const publish = await publishDailyNewsIssue({
      db,
      digest: preview.digest,
      issue: preview.issue,
      client,
      publicChannel,
      staffChannel,
      force,
      now,
      saveDb,
    });
    return {
      action: normalizedAction,
      dayKey: preview.dayKey,
      digest: preview.digest,
      issue: preview.issue,
      publish,
      payload: buildDailyNewsStatusPayload(db),
    };
  }

  throw new Error(`unknown Daily News operator action: ${normalizedAction}`);
}

module.exports = {
  DAILY_NEWS_OPERATOR_ACTIONS,
  buildDailyNewsStatusPayload,
  renderStoredDailyNewsPreview,
  runDailyNewsOperatorAction,
};
