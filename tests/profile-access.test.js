"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PROFILE_ACCESS_DENY_REASONS,
  getProfileViewerServerTag,
  isProfileRequesterDead,
  resolveProfileAccess,
} = require("../src/profile/access");

function makePrimaryGuild(tag = "TAG", { identityEnabled = true } = {}) {
  return {
    identityGuildId: "guild-1",
    identityEnabled,
    tag,
    badge: "badge-hash",
  };
}

function makeMember(primaryGuild = null) {
  return {
    user: {
      id: "requester",
      username: "Requester",
      ...(primaryGuild ? { primaryGuild } : {}),
    },
  };
}

test("profile viewer server tag resolves only for enabled guild identities", () => {
  assert.equal(getProfileViewerServerTag({ primaryGuild: makePrimaryGuild("TAG") }), "TAG");
  assert.equal(getProfileViewerServerTag({ primaryGuild: makePrimaryGuild("TAG", { identityEnabled: false }) }), "");
  assert.equal(getProfileViewerServerTag({ primaryGuild: { tag: "   ", identityEnabled: true } }), "");
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
    requesterMember: makeMember(makePrimaryGuild("TAG")),
    requesterUserId: "requester",
    targetUserId: "requester",
  });
  const targetAccess = resolveProfileAccess({
    requesterProfile,
    requesterMember: makeMember(makePrimaryGuild("TAG")),
    requesterUserId: "requester",
    targetUserId: "target",
  });

  assert.equal(selfAccess.allowed, false);
  assert.equal(selfAccess.denyReason, PROFILE_ACCESS_DENY_REASONS.DEAD_REQUESTER);
  assert.equal(targetAccess.allowed, false);
  assert.equal(targetAccess.denyReason, PROFILE_ACCESS_DENY_REASONS.DEAD_REQUESTER);
});

test("untagged requester can open self profile but not target profile", () => {
  const selfAccess = resolveProfileAccess({
    requesterMember: makeMember(),
    requesterUserId: "requester",
    targetUserId: "requester",
  });
  const targetAccess = resolveProfileAccess({
    requesterMember: makeMember(),
    requesterUserId: "requester",
    targetUserId: "target",
  });

  assert.equal(selfAccess.allowed, true);
  assert.equal(targetAccess.allowed, false);
  assert.equal(targetAccess.denyReason, PROFILE_ACCESS_DENY_REASONS.VIEWER_TAG_REQUIRED);
});

test("requester with server tag can open other members profiles", () => {
  const access = resolveProfileAccess({
    requesterMember: makeMember(makePrimaryGuild("TAG")),
    requesterUserId: "requester",
    targetUserId: "target",
  });

  assert.equal(access.allowed, true);
  assert.equal(access.hasViewerServerTag, true);
  assert.equal(access.requesterServerTag, "TAG");
  assert.equal(access.isSelf, false);
});

test("staff bypass overrides dead and missing tag restrictions", () => {
  const access = resolveProfileAccess({
    requesterProfile: { domains: { activity: { desiredActivityRoleKey: "dead" } } },
    requesterMember: makeMember(),
    requesterUserId: "requester",
    targetUserId: "target",
    hasStaffBypass: true,
  });

  assert.equal(access.allowed, true);
  assert.equal(access.hasStaffBypass, true);
});