"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  describeRoleSyncFailures,
  RoleSyncError,
  syncMemberCharacterRoles,
} = require("../src/onboard/character-role-sync");

test("syncMemberCharacterRoles removes stale roles and adds selected roles", async () => {
  const cache = new Set(["role-old"]);
  const operations = [];
  const member = {
    id: "user-1",
    roles: {
      cache,
      async remove(roleId, reason) {
        operations.push(`remove:${roleId}:${reason}`);
        cache.delete(roleId);
      },
      async add(roleId, reason) {
        operations.push(`add:${roleId}:${reason}`);
        cache.add(roleId);
      },
    },
  };
  const selectedEntries = [{ id: "vessel", roleId: "role-new" }];

  const result = await syncMemberCharacterRoles({
    member,
    selectedEntries,
    allManagedRoleIds: ["role-old", "role-new"],
    reason: "test sync",
  });

  assert.equal(result, selectedEntries);
  assert.deepEqual(operations, [
    "remove:role-old:test sync",
    "add:role-new:test sync",
  ]);
});

test("syncMemberCharacterRoles throws RoleSyncError with all failed operations", async () => {
  const operations = [];
  const member = {
    id: "user-9",
    roles: {
      cache: new Set(["role-old"]),
      async remove(roleId) {
        operations.push(`remove:${roleId}`);
        throw new Error("Missing Permissions");
      },
      async add(roleId) {
        operations.push(`add:${roleId}`);
        throw new Error("Missing Permissions");
      },
    },
  };

  await assert.rejects(
    syncMemberCharacterRoles({
      member,
      selectedEntries: [{ id: "gojo", roleId: "role-new" }],
      allManagedRoleIds: ["role-old", "role-new"],
    }),
    (error) => {
      assert.equal(error instanceof RoleSyncError, true);
      assert.equal(error.userId, "user-9");
      assert.deepEqual(error.failures, [
        { op: "remove", roleId: "role-old", error: "Missing Permissions" },
        { op: "add", roleId: "role-new", error: "Missing Permissions" },
      ]);
      return true;
    }
  );

  assert.deepEqual(operations, ["remove:role-old", "add:role-new"]);
  assert.match(describeRoleSyncFailures([
    { op: "add", roleId: "role-new", error: "Missing Permissions" },
  ]), /add:role-new/);
});