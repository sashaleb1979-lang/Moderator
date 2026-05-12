"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PROFILE_ACCESS_DENY_REASONS,
  isProfileRequesterDead,
  normalizeProfileViewerTagRoleIds,
  resolveProfileAccess,
} = require("../src/profile/access");

function makeMember(roleIds = []) {
  const roleIdSet = new Set(roleIds);
  return {
    roles: {
      cache: {
        has(roleId) {
          return roleIdSet.has(roleId);
        },
      },
    },
  };
}

test("profile viewer tag roles normalize from arrays and delimited strings", () => {
  assert.deepEqual(normalizeProfileViewerTagRoleIds(["tag-1", " tag-2 ", "", "tag-1"]), ["tag-1", "tag-2"]);
  assert.deepEqual(normalizeProfileViewerTagRoleIds("tag-1, tag-2;tag-1\ntag-3"), ["tag-1", "tag-2", "tag-3"]);
});

test("dead requester detection uses desired and applied activity dead buckets", () => {
  assert.equal(isProfileRequesterDead({ domains: { activity: { desiredActivityRoleKey: "dead" } } }), true);
  assert.equal(isProfileRequesterDead({ domains: { activity: { appliedActivityRoleKey: "dead" } } }), true);
  assert.equal(isProfileRequesterDead({ domains: { activity: { desiredActivityRoleKey: "active" } } }), false);
});

test("dead requester is denied both self and target profile access", () => {
  const requesterProfile = { domains: { activity: { desiredActivityRoleKey: "dead" } } };

  const selfAccess = resolveProfileAccess({
    requesterProfile,
    requesterMember: makeMember(["tag-role"]),
    requesterUserId: "requester",
    targetUserId: "requester",
    viewerTagRoleIds: ["tag-role"],
  });
  const targetAccess = resolveProfileAccess({
    requesterProfile,
    requesterMember: makeMember(["tag-role"]),
    requesterUserId: "requester",
    targetUserId: "target",
    viewerTagRoleIds: ["tag-role"],
  });

  assert.equal(selfAccess.allowed, false);
  assert.equal(selfAccess.denyReason, PROFILE_ACCESS_DENY_REASONS.DEAD_REQUESTER);
  assert.equal(targetAccess.allowed, false);
  assert.equal(targetAccess.denyReason, PROFILE_ACCESS_DENY_REASONS.DEAD_REQUESTER);
});

test("untagged requester can open self profile but not target profile", () => {
  const selfAccess = resolveProfileAccess({
    requesterMember: makeMember([]),
    requesterUserId: "requester",
    targetUserId: "requester",
    viewerTagRoleIds: ["tag-role"],
  });
  const targetAccess = resolveProfileAccess({
    requesterMember: makeMember([]),
    requesterUserId: "requester",
    targetUserId: "target",
    viewerTagRoleIds: ["tag-role"],
  });

  assert.equal(selfAccess.allowed, true);
  assert.equal(targetAccess.allowed, false);
  assert.equal(targetAccess.denyReason, PROFILE_ACCESS_DENY_REASONS.VIEWER_TAG_REQUIRED);
});

test("tagged requester can open other members profiles", () => {
  const access = resolveProfileAccess({
    requesterMember: makeMember(["tag-role"]),
    requesterUserId: "requester",
    targetUserId: "target",
    viewerTagRoleIds: ["tag-role"],
  });

  assert.equal(access.allowed, true);
  assert.equal(access.hasViewerTagRole, true);
  assert.equal(access.isSelf, false);
});

test("staff bypass overrides dead and missing tag restrictions", () => {
  const access = resolveProfileAccess({
    requesterProfile: { domains: { activity: { desiredActivityRoleKey: "dead" } } },
    requesterMember: makeMember([]),
    requesterUserId: "requester",
    targetUserId: "target",
    viewerTagRoleIds: ["tag-role"],
    hasStaffBypass: true,
  });

  assert.equal(access.allowed, true);
  assert.equal(access.hasStaffBypass, true);
});