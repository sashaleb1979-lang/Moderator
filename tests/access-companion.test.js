"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  collectAccessCompanionCandidateUserIds,
  collectAccessCompanionSourceRoleIds,
  normalizeAccessCompanionActivityRoleKeys,
  resolveAccessCompanionRoleState,
  shouldGrantAccessCompanionRole,
} = require("../src/onboard/access-companion");

test("collectAccessCompanionSourceRoleIds keeps only normal access as source", () => {
  assert.deepEqual(collectAccessCompanionSourceRoleIds({
    normalAccessRoleId: " base-role ",
    wartimeAccessRoleId: "wartime-role",
    nonJjsAccessRoleId: "nonjjs-role",
  }), ["base-role"]);
});

test("normalizeAccessCompanionActivityRoleKeys keeps the v1 top activity roles by default", () => {
  assert.deepEqual(normalizeAccessCompanionActivityRoleKeys(), ["core", "stable", "active"]);
  assert.deepEqual(normalizeAccessCompanionActivityRoleKeys(["active", "active", "weak", "bad"]), ["active"]);
});

test("access companion grants for normal access plus core stable or active activity role", () => {
  for (const activityRoleId of ["core-role", "stable-role", "active-role"]) {
    assert.equal(shouldGrantAccessCompanionRole({
      enabled: true,
      companionRoleId: "companion-role",
      normalAccessRoleId: "base-role",
      wartimeAccessRoleId: "wartime-role",
      eligibleActivityRoleIds: ["core-role", "stable-role", "active-role"],
      heldRoleIds: ["base-role", activityRoleId],
    }), true);
  }
});

test("access companion skips and removes when wartime access is present", () => {
  const state = resolveAccessCompanionRoleState({
    enabled: true,
    companionRoleId: "companion-role",
    normalAccessRoleId: "base-role",
    wartimeAccessRoleId: "wartime-role",
    eligibleActivityRoleIds: ["core-role"],
    heldRoleIds: ["base-role", "wartime-role", "core-role", "companion-role"],
  });

  assert.equal(state.eligible, false);
  assert.equal(state.skipReason, "wartime_access");
  assert.equal(state.shouldRemove, true);
});

test("access companion skips and removes without normal access", () => {
  const state = resolveAccessCompanionRoleState({
    enabled: true,
    companionRoleId: "companion-role",
    normalAccessRoleId: "base-role",
    wartimeAccessRoleId: "wartime-role",
    eligibleActivityRoleIds: ["core-role"],
    heldRoleIds: ["core-role", "companion-role"],
  });

  assert.equal(state.skipReason, "no_normal_access");
  assert.equal(state.shouldRemove, true);
});

test("access companion skips and removes for lower activity roles", () => {
  const state = resolveAccessCompanionRoleState({
    enabled: true,
    companionRoleId: "companion-role",
    normalAccessRoleId: "base-role",
    wartimeAccessRoleId: "wartime-role",
    eligibleActivityRoleIds: ["core-role", "stable-role", "active-role"],
    heldRoleIds: ["base-role", "floating-role", "weak-role", "dead-role", "newcomer-role", "companion-role"],
  });

  assert.equal(state.skipReason, "no_activity_role");
  assert.equal(state.shouldRemove, true);
});

test("disabled access companion never grants and removes existing companion role", () => {
  const state = resolveAccessCompanionRoleState({
    enabled: false,
    companionRoleId: "companion-role",
    normalAccessRoleId: "base-role",
    wartimeAccessRoleId: "wartime-role",
    eligibleActivityRoleIds: ["core-role"],
    heldRoleIds: ["base-role", "core-role", "companion-role"],
  });

  assert.equal(state.shouldGrant, false);
  assert.equal(state.skipReason, "disabled");
  assert.equal(state.shouldRemove, true);
});

test("collectAccessCompanionCandidateUserIds prefers source-role and cache ids before profile fallbacks", () => {
  assert.deepEqual(collectAccessCompanionCandidateUserIds({
    sourceRoleMemberIds: [" role-user ", "shared-user"],
    cachedMemberIds: ["shared-user", "cached-user"],
    profileUserIds: ["cached-user", "profile-user", ""],
  }), ["role-user", "shared-user", "cached-user", "profile-user"]);
});
