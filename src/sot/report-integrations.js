"use strict";

const { getIntegration } = require("./index");

function cleanString(value, limit = 500) {
  return String(value || "").trim().slice(0, limit);
}

function normalizePanelSnapshot(snapshot = {}, options = {}) {
  return {
    channelId: cleanString(snapshot?.channelId, 80),
    messageId: cleanString(snapshot?.messageId, 80),
    lastUpdated: cleanString(snapshot?.lastUpdated, 80) || options.defaultLastUpdated || null,
  };
}

function normalizeIntegrationSnapshot(snapshot = {}, options = {}) {
  return {
    status: cleanString(snapshot?.status, 40) || "not_started",
    mode: cleanString(snapshot?.mode, 40) || "",
    sourcePath: cleanString(snapshot?.sourcePath, 500) || "",
    lastImportAt: cleanString(snapshot?.lastImportAt, 80) || null,
    lastSyncAt: cleanString(snapshot?.lastSyncAt, 80) || null,
    roleGrantEnabled: snapshot?.roleGrantEnabled !== false,
    submitPanel: normalizePanelSnapshot(snapshot?.submitPanel),
    graphicBoard: normalizePanelSnapshot(snapshot?.graphicBoard),
    dashboard: normalizePanelSnapshot(snapshot?.dashboard),
    summary: normalizePanelSnapshot(snapshot?.summary),
  };
}

function getSotReportIntegrationSnapshots({ db = {}, appConfig = {}, getIntegrationRecord = getIntegration } = {}) {
  return {
    elo: normalizeIntegrationSnapshot(getIntegrationRecord("elo", { db, appConfig })),
    tierlist: normalizeIntegrationSnapshot(getIntegrationRecord("tierlist", { db, appConfig })),
  };
}

module.exports = {
  getSotReportIntegrationSnapshots,
};