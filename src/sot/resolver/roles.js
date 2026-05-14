"use strict";

const { createRecord, KILL_MILESTONE_SLOTS, KILL_TIER_SLOTS, LEGACY_ELO_TIER_SLOTS } = require("../schema");
const { selectPreferredRecord } = require("./priority");

function cleanString(value, limit = 200) {
  return String(value || "").trim().slice(0, limit);
}

function getDbConfig(db = {}) {
  return db && typeof db.config === "object" && !Array.isArray(db.config) ? db.config : {};
}

function getAppRoles(appConfig = {}) {
  return appConfig && typeof appConfig.roles === "object" && !Array.isArray(appConfig.roles)
    ? appConfig.roles
    : {};
}

function resolveBaseRoleRecord(slot, appRoles = {}) {
  switch (slot) {
    case "moderator":
      return createRecord(appRoles.moderatorRoleId, "configured");
    case "accessNormal":
      return createRecord(appRoles.accessRoleId, "configured");
    case "accessWartime":
      return createRecord(appRoles.wartimeAccessRoleId, "configured");
    case "accessNonJjs":
      return createRecord(appRoles.nonGgsAccessRoleId || appRoles.nonJjsAccessRoleId, "configured");
    case "verifyAccess":
      return createRecord(appRoles.verifyAccessRoleId, "configured");
    default:
      return null;
  }
}

function resolveRoleRecord({ slot, db = {}, appConfig = {} } = {}) {
  const appRoles = getAppRoles(appConfig);
  const record = resolveBaseRoleRecord(slot, appRoles);
  if (!record && !["moderator", "accessNormal", "accessWartime", "accessNonJjs", "verifyAccess"].includes(slot)) {
    return null;
  }

  return selectPreferredRecord([
    db?.sot?.roles?.[slot],
    record,
  ], "configured");
}

function resolveKillTierRole({ tier, db = {}, appConfig = {} } = {}) {
  const tierKey = String(tier);
  const dbConfig = getDbConfig(db);
  const appRoles = getAppRoles(appConfig);
  const configured = cleanString(appRoles.killTierRoleIds?.[tier] || appRoles.killTierRoleIds?.[tierKey], 80);
  const generated = cleanString(dbConfig.generatedRoles?.tiers?.[tier] || dbConfig.generatedRoles?.tiers?.[tierKey], 80);

  return selectPreferredRecord([
    db?.sot?.roles?.killTier?.[tier] || db?.sot?.roles?.killTier?.[tierKey],
    createRecord(configured, "configured"),
    createRecord(generated, "discovered"),
  ], "configured");
}

function resolveKillMilestoneRole({ milestone, db = {}, appConfig = {} } = {}) {
  const milestoneKey = cleanString(milestone, 20).toLowerCase();
  if (!KILL_MILESTONE_SLOTS.includes(milestoneKey)) return null;
  const appRoles = getAppRoles(appConfig);

  return selectPreferredRecord([
    db?.sot?.roles?.killMilestone?.[milestoneKey],
    createRecord(appRoles.killMilestoneRoleIds?.[milestoneKey] || appRoles.killMilestoneRoleIds?.[String(milestoneKey)], "configured"),
  ], "configured");
}

function resolveLegacyEloTierRole({ tier, db = {}, appConfig = {} } = {}) {
  const tierKey = String(tier);
  const appRoles = getAppRoles(appConfig);

  return selectPreferredRecord([
    db?.sot?.roles?.legacyEloTier?.[tier] || db?.sot?.roles?.legacyEloTier?.[tierKey],
    createRecord(appRoles.legacyEloTierRoleIds?.[tier] || appRoles.legacyEloTierRoleIds?.[tierKey], "configured"),
  ], "configured");
}

function resolveAllRoleRecords({ db = {}, appConfig = {} } = {}) {
  return {
    moderator: resolveRoleRecord({ slot: "moderator", db, appConfig }),
    accessNormal: resolveRoleRecord({ slot: "accessNormal", db, appConfig }),
    accessWartime: resolveRoleRecord({ slot: "accessWartime", db, appConfig }),
    accessNonJjs: resolveRoleRecord({ slot: "accessNonJjs", db, appConfig }),
    verifyAccess: resolveRoleRecord({ slot: "verifyAccess", db, appConfig }),
    killTier: Object.fromEntries(KILL_TIER_SLOTS.map((tier) => [tier, resolveKillTierRole({ tier, db, appConfig })])),
    killMilestone: Object.fromEntries(KILL_MILESTONE_SLOTS.map((milestone) => [milestone, resolveKillMilestoneRole({ milestone, db, appConfig })])),
    legacyEloTier: Object.fromEntries(LEGACY_ELO_TIER_SLOTS.map((tier) => [tier, resolveLegacyEloTierRole({ tier, db, appConfig })])),
  };
}

module.exports = {
  resolveAllRoleRecords,
  resolveKillMilestoneRole,
  resolveKillTierRole,
  resolveLegacyEloTierRole,
  resolveRoleRecord,
};