"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeResidentChatActivityRoleKeys,
  resolveResidentChatAccessRoleState,
} = require("../src/onboard/resident-chat-access");

test("normalizeResidentChatActivityRoleKeys keeps only v1 top activity roles", () => {
  assert.deepEqual(normalizeResidentChatActivityRoleKeys(), ["core", "stable", "active"]);
  assert.deepEqual(normalizeResidentChatActivityRoleKeys(["active", "active", "weak", "bad"]), ["active"]);
});

test("resident chat grants for normal access plus core stable or active activity role", () => {
  for (const activityRoleId of ["core-role", "stable-role", "active-role"]) {
    const state = resolveResidentChatAccessRoleState({
      enabled: true,
      residentRoleId: "resident-role",
      normalAccessRoleId: "base-role",
      wartimeAccessRoleId: "wartime-role",
      eligibleActivityRoleIds: ["core-role", "stable-role", "active-role"],
      heldRoleIds: ["base-role", activityRoleId],
    });
    assert.equal(state.shouldGrant, true);
  }
});

test("resident chat skips and removes when wartime access is present", () => {
  const state = resolveResidentChatAccessRoleState({
    enabled: true,
    residentRoleId: "resident-role",
    normalAccessRoleId: "base-role",
    wartimeAccessRoleId: "wartime-role",
    eligibleActivityRoleIds: ["core-role"],
    heldRoleIds: ["base-role", "wartime-role", "core-role", "resident-role"],
  });

  assert.equal(state.eligible, false);
  assert.equal(state.skipReason, "wartime_access");
  assert.equal(state.shouldRemove, true);
});

test("resident chat skips and removes without normal access", () => {
  const state = resolveResidentChatAccessRoleState({
    enabled: true,
    residentRoleId: "resident-role",
    normalAccessRoleId: "base-role",
    wartimeAccessRoleId: "wartime-role",
    eligibleActivityRoleIds: ["core-role"],
    heldRoleIds: ["core-role", "resident-role"],
  });

  assert.equal(state.skipReason, "no_normal_access");
  assert.equal(state.shouldRemove, true);
});

test("resident chat skips and removes for lower activity roles", () => {
  const state = resolveResidentChatAccessRoleState({
    enabled: true,
    residentRoleId: "resident-role",
    normalAccessRoleId: "base-role",
    wartimeAccessRoleId: "wartime-role",
    eligibleActivityRoleIds: ["core-role", "stable-role", "active-role"],
    heldRoleIds: ["base-role", "floating-role", "weak-role", "dead-role", "newcomer-role", "resident-role"],
  });

  assert.equal(state.skipReason, "no_activity_role");
  assert.equal(state.shouldRemove, true);
});

test("disabled resident chat never grants and removes existing resident role", () => {
  const state = resolveResidentChatAccessRoleState({
    enabled: false,
    residentRoleId: "resident-role",
    normalAccessRoleId: "base-role",
    wartimeAccessRoleId: "wartime-role",
    eligibleActivityRoleIds: ["core-role"],
    heldRoleIds: ["base-role", "core-role", "resident-role"],
  });

  assert.equal(state.shouldGrant, false);
  assert.equal(state.skipReason, "disabled");
  assert.equal(state.shouldRemove, true);
});
