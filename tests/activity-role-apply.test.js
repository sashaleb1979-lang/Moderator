"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  applyActivityRoleChangesForMember,
  buildNextRoleIds,
} = require("../src/activity/role-apply");

test("buildNextRoleIds reconciles add/remove changes while preserving unrelated roles", () => {
  const nextRoleIds = buildNextRoleIds([
    "guild-1",
    "role-dead",
    "role-keep",
  ], {
    removeRoleIds: ["role-dead", "role-dead", ""],
    addRoleIds: ["role-rare", "role-rare", null],
    protectedRoleIds: ["guild-1"],
  });

  assert.deepEqual(nextRoleIds, ["role-keep", "role-rare"]);
});

test("applyActivityRoleChangesForMember applies the reconciled role set in one mutation when roles.set is available", async () => {
  const calls = [];
  const member = {
    guild: { id: "guild-1" },
    roles: {
      cache: new Set(["guild-1", "role-dead", "role-keep"]),
      async set(roleIds, reason) {
        calls.push(["set", roleIds, reason]);
      },
      async remove() {
        throw new Error("should not reach remove when set is available");
      },
      async add() {
        throw new Error("should not reach add when set is available");
      },
    },
  };

  const result = await applyActivityRoleChangesForMember(member, {
    removeRoleIds: ["role-dead", "role-dead", ""],
    addRoleIds: ["role-rare", "role-rare", null],
    reason: "activity role sync by gno2m007",
  });

  assert.equal(result, true);
  assert.deepEqual(calls, [
    [["set", ["role-keep", "role-rare"], "activity role sync by gno2m007"]][0],
  ]);
});

test("applyActivityRoleChangesForMember falls back to remove/add when roles.set is unavailable", async () => {
  const calls = [];
  const member = {
    roles: {
      async remove(roleId, reason) {
        calls.push(["remove", roleId, reason]);
      },
      async add(roleId, reason) {
        calls.push(["add", roleId, reason]);
      },
    },
  };

  const result = await applyActivityRoleChangesForMember(member, {
    removeRoleIds: ["role-dead", "role-dead", ""],
    addRoleIds: ["role-rare", "role-rare", null],
    reason: "activity role sync by gno2m007",
  });

  assert.equal(result, true);
  assert.deepEqual(calls, [
    ["remove", "role-dead", "activity role sync by gno2m007"],
    ["add", "role-rare", "activity role sync by gno2m007"],
  ]);
});

test("applyActivityRoleChangesForMember returns false when a reconciled role set mutation throws", async () => {
  const member = {
    guild: { id: "guild-1" },
    roles: {
      cache: new Set(["guild-1", "role-dead"]),
      async set() {
        throw new Error("missing permissions");
      },
      async add() {
        throw new Error("should not reach add");
      },
      async remove() {
        throw new Error("should not reach remove");
      },
    },
  };

  const result = await applyActivityRoleChangesForMember(member, {
    removeRoleIds: ["role-dead"],
    addRoleIds: ["role-rare"],
  });

  assert.equal(result, false);
});