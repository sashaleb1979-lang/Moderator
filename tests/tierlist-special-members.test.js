"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  NON_FAKE_TIER_KEY,
  NON_FAKE_TIER_LABEL,
  applyTierlistSpecialMembers,
  ensureTierlistSpecialState,
  normalizeTierlistSpecialState,
  setTierlistNonFakeUser,
} = require("../src/onboard/tierlist-special-members");

test("normalizeTierlistSpecialState keeps only unique remembered user ids", () => {
  assert.deepEqual(
    normalizeTierlistSpecialState({ nonFakeUserIds: [" 100 ", "", "100", "200"] }),
    { nonFakeUserIds: ["100", "200"] }
  );
});

test("setTierlistNonFakeUser adds and removes remembered users in place", () => {
  const dbConfig = {};

  assert.deepEqual(ensureTierlistSpecialState(dbConfig), { nonFakeUserIds: [] });
  assert.deepEqual(setTierlistNonFakeUser(dbConfig, "100", true), {
    changed: true,
    enabled: true,
    userIds: ["100"],
  });
  assert.deepEqual(setTierlistNonFakeUser(dbConfig, "100", true), {
    changed: false,
    enabled: true,
    userIds: ["100"],
  });
  assert.deepEqual(setTierlistNonFakeUser(dbConfig, "100", false), {
    changed: true,
    enabled: false,
    userIds: [],
  });
});

test("applyTierlistSpecialMembers moves remembered users into the 6th display cluster without changing kill tier", () => {
  const entries = applyTierlistSpecialMembers([
    { userId: "100", displayName: "Alpha", approvedKills: 500, killTier: 2 },
    { userId: "200", displayName: "Beta", approvedKills: 900, killTier: 3 },
    { userId: "300", displayName: "Gamma", approvedKills: 300, killTier: 1 },
  ], {
    nonFakeUserIds: ["100", "300"],
  });

  assert.deepEqual(entries.map((entry) => ({
    userId: entry.userId,
    killTier: entry.killTier,
    displayTier: entry.displayTier,
    isNonFakeTierMember: entry.isNonFakeTierMember,
  })), [
    { userId: "200", killTier: 3, displayTier: 3, isNonFakeTierMember: false },
    { userId: "100", killTier: 2, displayTier: NON_FAKE_TIER_KEY, isNonFakeTierMember: true },
    { userId: "300", killTier: 1, displayTier: NON_FAKE_TIER_KEY, isNonFakeTierMember: true },
  ]);
  assert.equal(NON_FAKE_TIER_LABEL, "Не фейкостановцы");
  assert.equal(NON_FAKE_TIER_KEY, 6);
});