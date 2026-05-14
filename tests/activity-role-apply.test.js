"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { applyActivityRoleChangesForMember } = require("../src/activity/role-apply");

test("applyActivityRoleChangesForMember removes stale roles before adding new ones one-by-one", async () => {
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

test("applyActivityRoleChangesForMember returns false when a Discord role mutation throws", async () => {
  const member = {
    roles: {
      async remove() {
        throw new Error("missing permissions");
      },
      async add() {
        throw new Error("should not reach add");
      },
    },
  };

  const result = await applyActivityRoleChangesForMember(member, {
    removeRoleIds: ["role-dead"],
    addRoleIds: ["role-rare"],
  });

  assert.equal(result, false);
});