"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PROFILE_TARGET_RESOLUTION_REASONS,
  buildProfileNavCustomId,
  buildProfileOpenCustomId,
  isProfileTriggerContent,
  parseProfileNavCustomId,
  parseProfileOpenCustomId,
  resolveProfileMessageTarget,
} = require("../src/profile/entry");

test("profile trigger content accepts plain keyword and mention wrappers", () => {
  assert.equal(isProfileTriggerContent("профиль"), true);
  assert.equal(isProfileTriggerContent(" <@123> профиль "), true);
  assert.equal(isProfileTriggerContent("профиль <@123>"), true);
  assert.equal(isProfileTriggerContent("мой профиль"), false);
});

test("profile message target prefers mention over reply and self", () => {
  const result = resolveProfileMessageTarget({
    requesterUserId: "requester",
    mentionUserIds: ["target"],
    replyTargetUserId: "reply-target",
  });

  assert.deepEqual(result, {
    ok: true,
    reason: null,
    targetUserId: "target",
    isSelf: false,
  });
});

test("profile message target falls back to reply target and then self", () => {
  assert.deepEqual(resolveProfileMessageTarget({
    requesterUserId: "requester",
    replyTargetUserId: "reply-target",
  }), {
    ok: true,
    reason: null,
    targetUserId: "reply-target",
    isSelf: false,
  });

  assert.deepEqual(resolveProfileMessageTarget({
    requesterUserId: "requester",
  }), {
    ok: true,
    reason: null,
    targetUserId: "requester",
    isSelf: true,
  });
});

test("profile message target rejects ambiguous multi-mention request", () => {
  assert.deepEqual(resolveProfileMessageTarget({
    requesterUserId: "requester",
    mentionUserIds: ["target-1", "target-2"],
  }), {
    ok: false,
    reason: PROFILE_TARGET_RESOLUTION_REASONS.AMBIGUOUS_MENTION,
    targetUserId: "",
    isSelf: false,
  });
});

test("profile open button custom ids round-trip cleanly", () => {
  const customId = buildProfileOpenCustomId("requester", "target");
  assert.deepEqual(parseProfileOpenCustomId(customId), {
    requesterUserId: "requester",
    targetUserId: "target",
  });
  assert.equal(parseProfileOpenCustomId("other:requester:target"), null);
});

test("profile navigation custom ids round-trip cleanly", () => {
  const customId = buildProfileNavCustomId("requester", "target", "activity");
  assert.deepEqual(parseProfileNavCustomId(customId), {
    requesterUserId: "requester",
    targetUserId: "target",
    view: "activity",
  });
  assert.equal(parseProfileNavCustomId("profile_nav:requester:target"), null);
});