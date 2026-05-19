"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  collectAccessCompanionCandidateUserIds,
  collectAccessCompanionSourceRoleIds,
  hasAnyAccessCompanionSourceRole,
  shouldGrantAccessCompanionRole,
} = require("../src/onboard/access-companion");

test("collectAccessCompanionSourceRoleIds keeps only normal wartime and non-JJS ids", () => {
  assert.deepEqual(collectAccessCompanionSourceRoleIds({
    normalAccessRoleId: " base-role ",
    wartimeAccessRoleId: "wartime-role",
    nonJjsAccessRoleId: "nonjjs-role",
  }), ["base-role", "wartime-role", "nonjjs-role"]);
});

test("collectAccessCompanionSourceRoleIds dedupes and drops blanks", () => {
  assert.deepEqual(collectAccessCompanionSourceRoleIds({
    normalAccessRoleId: "shared-role",
    wartimeAccessRoleId: " shared-role ",
    nonJjsAccessRoleId: "",
  }), ["shared-role"]);
});

test("hasAnyAccessCompanionSourceRole matches only counted access roles", () => {
  assert.equal(hasAnyAccessCompanionSourceRole({
    heldRoleIds: ["verify-role", "nonjjs-role"],
    sourceRoleIds: ["base-role", "wartime-role", "nonjjs-role"],
  }), true);

  assert.equal(hasAnyAccessCompanionSourceRole({
    heldRoleIds: ["verify-role"],
    sourceRoleIds: ["base-role", "wartime-role", "nonjjs-role"],
  }), false);
});

test("shouldGrantAccessCompanionRole grants when counted access exists and companion is missing", () => {
  assert.equal(shouldGrantAccessCompanionRole({
    companionRoleId: "companion-role",
    heldRoleIds: ["base-role"],
    sourceRoleIds: ["base-role", "wartime-role", "nonjjs-role"],
  }), true);
});

test("shouldGrantAccessCompanionRole skips when companion role is already present or not configured", () => {
  assert.equal(shouldGrantAccessCompanionRole({
    companionRoleId: "companion-role",
    heldRoleIds: ["base-role", "companion-role"],
    sourceRoleIds: ["base-role", "wartime-role", "nonjjs-role"],
  }), false);

  assert.equal(shouldGrantAccessCompanionRole({
    companionRoleId: "",
    heldRoleIds: ["base-role"],
    sourceRoleIds: ["base-role", "wartime-role", "nonjjs-role"],
  }), false);
});

test("collectAccessCompanionCandidateUserIds prefers source-role and cache ids before profile fallbacks", () => {
  assert.deepEqual(collectAccessCompanionCandidateUserIds({
    sourceRoleMemberIds: [" role-user ", "shared-user"],
    cachedMemberIds: ["shared-user", "cached-user"],
    profileUserIds: ["cached-user", "profile-user", ""],
  }), ["role-user", "shared-user", "cached-user", "profile-user"]);
});