"use strict";

const { compileDailyNewsDigest } = require("./compiler");
const { renderDailyNewsIssue } = require("./render");
const { ensureNewsState } = require("./state");

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function resolveNowIso(now) {
  if (typeof now === "function") return cleanString(now(), 80) || new Date().toISOString();
  return cleanString(now, 80) || new Date().toISOString();
}

function writeLastPreviewRequest(state, { dayKey = "", requestedAt = null, status = "rendered", issue = null } = {}) {
  state.runtime.lastPreviewRequest = {
    dayKey: cleanString(dayKey, 40) || null,
    requestedAt: cleanString(requestedAt, 80) || null,
    status: cleanString(status, 80) || "rendered",
    publicThreadMessageCount: Array.isArray(issue?.publicThreadMessages) ? issue.publicThreadMessages.length : 0,
  };
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
  writeLastPreviewRequest(state, {
    dayKey: compileResult.dayKey,
    requestedAt: compileResult.digest.compiledAt,
    status: "rendered",
    issue,
  });

  if (typeof saveDb === "function") {
    saveDb();
  }

  return {
    ...compileResult,
    issue,
  };
}

function renderStoredDailyNewsPreview({ db = {}, dayKey = "", now, saveDb } = {}) {
  const state = ensureNewsState(db);
  const resolvedDayKey = cleanString(dayKey, 40) || state.runtime.lastCompiledDayKey;
  const digest = resolvedDayKey ? state.dailyDigests?.[resolvedDayKey] : null;
  if (!digest) {
    throw new Error("daily news digest not found for preview");
  }
  const issue = renderDailyNewsIssue({ digest, config: state.config });
  writeLastPreviewRequest(state, {
    dayKey: resolvedDayKey,
    requestedAt: resolveNowIso(now),
    status: "stored_rendered",
    issue,
  });

  if (typeof saveDb === "function") {
    saveDb();
  }

  return {
    dayKey: resolvedDayKey,
    digest,
    issue,
  };
}

module.exports = {
  compileDailyNewsPreview,
  renderStoredDailyNewsPreview,
};
