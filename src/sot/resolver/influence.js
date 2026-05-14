"use strict";

const { DEFAULT_INFLUENCE, KILL_MILESTONE_SLOTS, normalizeInfluence } = require("../schema");

function resolveInfluence({ db = {}, influence } = {}) {
  if (influence && typeof influence === "object" && !Array.isArray(influence)) {
    return normalizeInfluence(influence);
  }
  if (db?.sot?.influence && typeof db.sot.influence === "object" && !Array.isArray(db.sot.influence)) {
    return normalizeInfluence(db.sot.influence);
  }
  return normalizeInfluence(DEFAULT_INFLUENCE);
}

function resolveLegacyInfluenceConfig(context = {}) {
  const influence = resolveInfluence(context);
  return {
    default: influence.default,
    1: influence.tiers[1],
    2: influence.tiers[2],
    3: influence.tiers[3],
    4: influence.tiers[4],
    5: influence.tiers[5],
  };
}

function getInfluenceTierValue(tier, context = {}) {
  const influence = resolveInfluence(context);
  const tierKey = Number(tier);
  return Number.isFinite(tierKey) && influence.tiers[tierKey] !== undefined
    ? influence.tiers[tierKey]
    : influence.default;
}

function getInfluenceMilestoneValue(milestone, context = {}) {
  const influence = resolveInfluence(context);
  const milestoneKey = String(milestone || "").trim().toLowerCase();
  return KILL_MILESTONE_SLOTS.includes(milestoneKey) && influence.milestones?.[milestoneKey] !== undefined
    ? influence.milestones[milestoneKey]
    : influence.default;
}

module.exports = {
  getInfluenceMilestoneValue,
  getInfluenceTierValue,
  resolveLegacyInfluenceConfig,
  resolveInfluence,
};