"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  BASE_KILL_TIER_THRESHOLDS,
  KILL_MILESTONE_THRESHOLDS,
  killTierFor,
  resolveKillMilestoneKey,
} = require("../src/onboard/kill-tiers");

test("killTierFor applies the new T1-T5 boundaries", () => {
  assert.deepEqual(BASE_KILL_TIER_THRESHOLDS, {
    2: 1000,
    3: 4000,
    4: 9000,
    5: 15000,
  });

  assert.equal(killTierFor(-1), null);
  assert.equal(killTierFor("bad"), null);
  assert.equal(killTierFor(0), 1);
  assert.equal(killTierFor(999), 1);
  assert.equal(killTierFor(1000), 2);
  assert.equal(killTierFor(3999), 2);
  assert.equal(killTierFor(4000), 3);
  assert.equal(killTierFor(8999), 3);
  assert.equal(killTierFor(9000), 4);
  assert.equal(killTierFor(14999), 4);
  assert.equal(killTierFor(15000), 5);
});

test("resolveKillMilestoneKey uses inclusive 20k and 30k thresholds", () => {
  assert.deepEqual(KILL_MILESTONE_THRESHOLDS, {
    "20k": 20000,
    "30k": 30000,
  });

  assert.equal(resolveKillMilestoneKey(-1), null);
  assert.equal(resolveKillMilestoneKey("bad"), null);
  assert.equal(resolveKillMilestoneKey(19999), null);
  assert.equal(resolveKillMilestoneKey(20000), "20k");
  assert.equal(resolveKillMilestoneKey(29999), "20k");
  assert.equal(resolveKillMilestoneKey(30000), "30k");
});