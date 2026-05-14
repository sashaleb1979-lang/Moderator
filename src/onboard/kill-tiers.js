"use strict";

const BASE_KILL_TIER_THRESHOLDS = Object.freeze({
  2: 1000,
  3: 4000,
  4: 9000,
  5: 15000,
});

const KILL_MILESTONE_THRESHOLDS = Object.freeze({
  "20k": 20000,
  "30k": 30000,
});

function normalizeKillCount(kills) {
  const amount = Number(kills);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return amount;
}

function killTierFor(kills) {
  const amount = normalizeKillCount(kills);
  if (amount === null) return null;
  if (amount >= BASE_KILL_TIER_THRESHOLDS[5]) return 5;
  if (amount >= BASE_KILL_TIER_THRESHOLDS[4]) return 4;
  if (amount >= BASE_KILL_TIER_THRESHOLDS[3]) return 3;
  if (amount >= BASE_KILL_TIER_THRESHOLDS[2]) return 2;
  return 1;
}

function resolveKillMilestoneKey(kills) {
  const amount = normalizeKillCount(kills);
  if (amount === null) return null;
  if (amount >= KILL_MILESTONE_THRESHOLDS["30k"]) return "30k";
  if (amount >= KILL_MILESTONE_THRESHOLDS["20k"]) return "20k";
  return null;
}

module.exports = {
  BASE_KILL_TIER_THRESHOLDS,
  KILL_MILESTONE_THRESHOLDS,
  killTierFor,
  resolveKillMilestoneKey,
};