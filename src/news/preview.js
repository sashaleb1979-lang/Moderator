"use strict";

const { compileDailyNewsDigest } = require("./compiler");
const { renderDailyNewsIssue } = require("./render");
const { ensureNewsState } = require("./state");

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function compileDailyNewsPreview({
  db = {},
  targetDayKey = "",
  now,
  windowEndAt = null,
  saveDb,
  historySnapshotMode = "none",
} = {}) {
  const compileResult = compileDailyNewsDigest({ db, targetDayKey, now, windowEndAt, historySnapshotMode });
  const state = ensureNewsState(db);
  const issue = renderDailyNewsIssue({ digest: compileResult.digest, config: state.config });
  state.runtime.lastPreviewRequest = {
    dayKey: compileResult.dayKey,
    requestedAt: cleanString(compileResult.digest.compiledAt, 80),
    status: "rendered",
    publicThreadMessageCount: issue.publicThreadMessages.length,
  };

  if (typeof saveDb === "function") {
    saveDb();
  }

  return {
    ...compileResult,
    issue,
  };
}

function renderStoredDailyNewsPreview({ db = {}, dayKey = "" } = {}) {
  const state = ensureNewsState(db);
  const resolvedDayKey = cleanString(dayKey, 40) || state.runtime.lastCompiledDayKey;
  const digest = resolvedDayKey ? state.dailyDigests?.[resolvedDayKey] : null;
  if (!digest) {
    throw new Error("daily news digest not found for preview");
  }
  return {
    dayKey: resolvedDayKey,
    digest,
    issue: renderDailyNewsIssue({ digest, config: state.config }),
  };
}

module.exports = {
  compileDailyNewsPreview,
  renderStoredDailyNewsPreview,
};
