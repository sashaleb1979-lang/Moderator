"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  filterEntriesByAllowedUserIds,
  hasAnyAllowedRole,
} = require("../src/onboard/tierlist-live-members");

test("hasAnyAllowedRole keeps stats open when no tier roles are configured", () => {
  assert.equal(hasAnyAllowedRole(["character-role"], []), true);
  assert.equal(hasAnyAllowedRole([], []), true);
});

test("hasAnyAllowedRole matches at least one configured tier role", () => {
  assert.equal(hasAnyAllowedRole(["character-role", "tier-4"], ["tier-1", "tier-4"]), true);
  assert.equal(hasAnyAllowedRole(["character-role"], ["tier-1", "tier-4"]), false);
});

test("filterEntriesByAllowedUserIds keeps only tracked live users", () => {
  const entries = [
    { userId: "alpha", approvedKills: 1000 },
    { userId: "beta", approvedKills: 2000 },
    { userId: "gamma", approvedKills: 3000 },
  ];

  assert.deepEqual(
    filterEntriesByAllowedUserIds(entries, new Set(["beta", "gamma"])),
    [
      { userId: "beta", approvedKills: 2000 },
      { userId: "gamma", approvedKills: 3000 },
    ]
  );
});