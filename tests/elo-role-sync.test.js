"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildGlobalEloRoleSyncPlan,
  getProfileEloTier,
} = require("../src/integrations/elo-role-sync");

test("getProfileEloTier reads the canonical shared-profile elo tier only", () => {
  assert.equal(getProfileEloTier({ domains: { elo: { currentTier: 3 } } }), 3);
  assert.equal(getProfileEloTier({ domains: { elo: { currentTier: "5" } } }), 5);
  assert.equal(getProfileEloTier({ domains: { elo: { currentTier: 6 } } }), null);
  assert.equal(getProfileEloTier({ currentTier: 4 }), null);
  assert.equal(getProfileEloTier(null), null);
});

test("buildGlobalEloRoleSyncPlan assigns users with canonical elo tiers and clears the rest", () => {
  const plan = buildGlobalEloRoleSyncPlan({
    user1: { domains: { elo: { currentTier: 2 } } },
    user2: { domains: { elo: { currentTier: null } } },
    user3: { domains: { elo: { currentTier: 5 } } },
  });

  assert.deepEqual(plan.assign, [
    { userId: "user1", tier: 2 },
    { userId: "user3", tier: 5 },
  ]);
  assert.deepEqual(plan.clear, ["user2"]);
});

test("buildGlobalEloRoleSyncPlan narrows to one user and preserves explicit clears", () => {
  const plan = buildGlobalEloRoleSyncPlan({
    user1: { domains: { elo: { currentTier: 4 } } },
    user2: { domains: { elo: { currentTier: 1 } } },
  }, {
    targetUserId: "user1",
    clearUserIds: ["user3", "", null],
  });

  assert.deepEqual(plan.assign, [
    { userId: "user1", tier: 4 },
  ]);
  assert.deepEqual(plan.clear, ["user3"]);
});

test("buildGlobalEloRoleSyncPlan clears a targeted user when their canonical elo tier is missing", () => {
  const plan = buildGlobalEloRoleSyncPlan({
    user1: { domains: { elo: { currentTier: null } } },
  }, {
    targetUserId: "user1",
  });

  assert.deepEqual(plan.assign, []);
  assert.deepEqual(plan.clear, ["user1"]);
});