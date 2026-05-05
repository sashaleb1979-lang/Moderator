"use strict";

const { CHANNEL_SLOTS, createRecord } = require("../schema");
const { selectPreferredRecord } = require("./priority");

function cleanString(value, limit = 200) {
  return String(value || "").trim().slice(0, limit);
}

function getDbConfig(db = {}) {
  return db && typeof db.config === "object" && !Array.isArray(db.config) ? db.config : {};
}

function getAppChannels(appConfig = {}) {
  return appConfig && typeof appConfig.channels === "object" && !Array.isArray(appConfig.channels)
    ? appConfig.channels
    : {};
}

function getLegacyChannelValue(slot, dbConfig = {}) {
  switch (slot) {
    case "welcome":
      return cleanString(dbConfig.welcomePanel?.channelId, 80);
    case "review":
      return cleanString(dbConfig.reviewChannelId, 80);
    case "tierlistText":
      return cleanString(dbConfig.tierlistBoard?.text?.channelId, 80);
    case "tierlistGraphic":
      return cleanString(dbConfig.tierlistBoard?.graphic?.channelId, 80);
    case "log":
      return cleanString(dbConfig.notificationChannelId, 80);
    case "eloSubmit":
      return cleanString(dbConfig.integrations?.elo?.submitPanel?.channelId, 80);
    case "eloGraphic":
      return cleanString(dbConfig.integrations?.elo?.graphicBoard?.channelId, 80);
    case "tierlistDashboard":
      return cleanString(dbConfig.integrations?.tierlist?.dashboard?.channelId, 80);
    case "tierlistSummary":
      return cleanString(dbConfig.integrations?.tierlist?.summary?.channelId, 80);
    default:
      return "";
  }
}

function getConfiguredChannelValue(slot, appChannels = {}) {
  switch (slot) {
    case "welcome":
      return cleanString(appChannels.welcomeChannelId, 80);
    case "review":
      return cleanString(appChannels.reviewChannelId, 80);
    case "tierlistText":
    case "tierlistGraphic":
      return cleanString(appChannels.tierlistChannelId, 80);
    case "log":
      return cleanString(appChannels.logChannelId, 80);
    default:
      return "";
  }
}

function getLegacyChannelRecord(slot, dbConfig = {}, appChannels = {}) {
  const legacyValue = getLegacyChannelValue(slot, dbConfig);
  if (!legacyValue) return null;

  const configuredValue = getConfiguredChannelValue(slot, appChannels);
  const source = configuredValue && configuredValue === legacyValue ? "configured" : "manual";
  return createRecord(legacyValue, source);
}

function resolveChannelRecord({ slot, db = {}, appConfig = {} } = {}) {
  if (!CHANNEL_SLOTS.includes(slot)) return null;

  const dbConfig = getDbConfig(db);
  const appChannels = getAppChannels(appConfig);

  return selectPreferredRecord([
    db?.sot?.channels?.[slot],
    getLegacyChannelRecord(slot, dbConfig, appChannels),
    createRecord(getConfiguredChannelValue(slot, appChannels), "configured"),
  ], "configured");
}

function resolveAllChannelRecords({ db = {}, appConfig = {} } = {}) {
  return Object.fromEntries(CHANNEL_SLOTS.map((slot) => [slot, resolveChannelRecord({ slot, db, appConfig })]));
}

function getChannelValue(slot, context = {}) {
  return resolveChannelRecord({ slot, ...context })?.value || "";
}

module.exports = {
  getChannelValue,
  getConfiguredChannelValue,
  getLegacyChannelRecord,
  getLegacyChannelValue,
  resolveAllChannelRecords,
  resolveChannelRecord,
};