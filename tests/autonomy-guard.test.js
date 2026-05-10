"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  AUTONOMY_GUARD_MESSAGE_DELETE_POLICIES,
  addAutonomyGuardIsolatedUserId,
  classifyAutonomyGuardDeletedMessage,
  clearAutonomyGuardTargetUserId,
  collectAutonomyGuardProtectedRoleIds,
  diffAutonomyGuardProtectedRoleIds,
  ensureAutonomyGuardState,
  incrementAutonomyGuardWarningCounter,
  isAutonomyGuardIsolatedUser,
  removeAutonomyGuardIsolatedUserId,
  resolveAutonomyGuardMessageDeleteDecision,
  resolveAutonomyGuardPrimaryAdminUserId,
  setAutonomyGuardPrimaryAdminUserId,
  setAutonomyGuardProtectedRole,
  setAutonomyGuardTargetUserId,
} = require("../src/moderation/autonomy-guard");

test("ensureAutonomyGuardState seeds canonical empty shape", () => {
  const db = { config: {} };

  const state = ensureAutonomyGuardState(db);

  assert.deepEqual(state, {
    primaryAdminUserId: "",
    targetUserId: "",
    protectedRole: {
      roleId: "",
      name: "",
      color: "",
    },
    isolatedUserIds: [],
    warningCounters: {},
  });
  assert.equal(db.config.autonomyGuard, state);
});

test("primary admin resolver prefers app config override and mutator normalizes ids", () => {
  const db = { config: {} };

  assert.equal(setAutonomyGuardPrimaryAdminUserId(db, "123456789012345678"), true);
  assert.equal(setAutonomyGuardPrimaryAdminUserId(db, "123456789012345678"), false);
  assert.equal(resolveAutonomyGuardPrimaryAdminUserId(db, {}), "123456789012345678");
  assert.equal(resolveAutonomyGuardPrimaryAdminUserId(db, {
    moderation: { primaryAdminUserId: "876543210987654321" },
  }), "876543210987654321");
});

test("protected role and target mutators update only normalized values", () => {
  const db = { config: {} };

  assert.equal(setAutonomyGuardProtectedRole(db, {
    roleId: "987654321098765432",
    name: "  Target Role  ",
    color: "ff00aa",
  }), true);
  assert.equal(setAutonomyGuardTargetUserId(db, "111111111111111111"), true);
  assert.equal(setAutonomyGuardTargetUserId(db, "111111111111111111"), false);
  assert.equal(clearAutonomyGuardTargetUserId(db), true);
  assert.equal(clearAutonomyGuardTargetUserId(db), false);

  assert.deepEqual(ensureAutonomyGuardState(db).protectedRole, {
    roleId: "987654321098765432",
    name: "Target Role",
    color: "#FF00AA",
  });
  assert.equal(ensureAutonomyGuardState(db).targetUserId, "");
});

test("isolated user mutators dedupe ids and clear warning counters on removal", () => {
  const db = { config: {} };
  const state = ensureAutonomyGuardState(db);
  state.warningCounters["111111111111111111"] = {
    ownerMessageDeletes: 2,
    logMessageDeletes: 1,
    reviewMessageDeletes: 0,
  };

  assert.equal(addAutonomyGuardIsolatedUserId(db, "111111111111111111"), true);
  assert.equal(addAutonomyGuardIsolatedUserId(db, "111111111111111111"), false);
  assert.equal(isAutonomyGuardIsolatedUser(db, "111111111111111111"), true);
  assert.equal(removeAutonomyGuardIsolatedUserId(db, "111111111111111111"), true);
  assert.equal(removeAutonomyGuardIsolatedUserId(db, "111111111111111111"), false);
  assert.equal(isAutonomyGuardIsolatedUser(db, "111111111111111111"), false);
  assert.equal("111111111111111111" in ensureAutonomyGuardState(db).warningCounters, false);
});

test("collectAutonomyGuardProtectedRoleIds dedupes ids from all managed role sources", () => {
  assert.deepEqual(collectAutonomyGuardProtectedRoleIds({
    protectedRoleId: "111111111111111111",
    accessRoleIds: ["222222222222222222", "222222222222222222", "bad"],
    tierRoleIds: ["333333333333333333"],
    legacyEloTierRoleIds: ["444444444444444444"],
    characterRoleIds: ["555555555555555555"],
    activityRoleIds: { weak: "666666666666666666", active: "" },
    activityAdminRoleIds: ["777777777777777777"],
    activityModeratorRoleIds: ["888888888888888888"],
    roleGrantRoleIds: ["555555555555555555", "999999999999999999"],
    extraRoleIds: ["101010101010101010"],
  }), [
    "111111111111111111",
    "222222222222222222",
    "333333333333333333",
    "444444444444444444",
    "555555555555555555",
    "666666666666666666",
    "777777777777777777",
    "888888888888888888",
    "999999999999999999",
    "101010101010101010",
  ]);
});

test("diffAutonomyGuardProtectedRoleIds reports only protected add/remove deltas", () => {
  assert.deepEqual(diffAutonomyGuardProtectedRoleIds({
    previousRoleIds: ["111111111111111111", "222222222222222222", "333333333333333333"],
    nextRoleIds: ["222222222222222222", "444444444444444444", "555555555555555555"],
    protectedRoleIds: ["111111111111111111", "444444444444444444", "999999999999999999"],
  }), {
    addedRoleIds: ["444444444444444444"],
    removedRoleIds: ["111111111111111111"],
    changedRoleIds: ["444444444444444444", "111111111111111111"],
    hasProtectedChanges: true,
  });
});

test("message delete helpers classify message buckets and escalate warning ladders", () => {
  assert.equal(classifyAutonomyGuardDeletedMessage({
    ownerUserId: "111111111111111111",
    authorUserId: "111111111111111111",
    authorIsBot: false,
    channelId: "222222222222222222",
    logChannelId: "333333333333333333",
    messageId: "444444444444444444",
    importantMessageIds: ["555555555555555555"],
    reviewMessageIds: ["666666666666666666"],
  }), "owner");

  assert.equal(classifyAutonomyGuardDeletedMessage({
    ownerUserId: "111111111111111111",
    authorUserId: "777777777777777777",
    authorIsBot: true,
    channelId: "333333333333333333",
    logChannelId: "333333333333333333",
    messageId: "444444444444444444",
    importantMessageIds: ["555555555555555555"],
    reviewMessageIds: ["666666666666666666"],
  }), "log");

  assert.equal(classifyAutonomyGuardDeletedMessage({
    ownerUserId: "111111111111111111",
    authorUserId: "777777777777777777",
    authorIsBot: true,
    channelId: "333333333333333333",
    logChannelId: "333333333333333333",
    messageId: "666666666666666666",
    importantMessageIds: [],
    reviewMessageIds: ["666666666666666666"],
  }), "review");

  assert.equal(classifyAutonomyGuardDeletedMessage({
    ownerUserId: "111111111111111111",
    authorUserId: "777777777777777777",
    authorIsBot: true,
    channelId: "333333333333333333",
    logChannelId: "333333333333333333",
    messageId: "555555555555555555",
    importantMessageIds: ["555555555555555555"],
    reviewMessageIds: ["666666666666666666"],
  }), "important");

  assert.deepEqual(AUTONOMY_GUARD_MESSAGE_DELETE_POLICIES.review, {
    bucketKey: "reviewMessageDeletes",
    warningsBeforeStrip: 1,
    immediateStrip: false,
  });

  const db = { config: {} };
  assert.equal(incrementAutonomyGuardWarningCounter(db, "111111111111111111", "ownerMessageDeletes"), 1);
  assert.equal(incrementAutonomyGuardWarningCounter(db, "111111111111111111", "ownerMessageDeletes"), 2);
  assert.deepEqual(resolveAutonomyGuardMessageDeleteDecision("owner", 2), {
    action: "warn",
    bucketKey: "ownerMessageDeletes",
    kind: "owner",
    warningCount: 2,
    warningsRemaining: 3,
    shouldStripAdmin: false,
  });
  assert.deepEqual(resolveAutonomyGuardMessageDeleteDecision("review", 2), {
    action: "strip-admin",
    bucketKey: "reviewMessageDeletes",
    kind: "review",
    warningCount: 2,
    warningsRemaining: 0,
    shouldStripAdmin: true,
  });
  assert.deepEqual(resolveAutonomyGuardMessageDeleteDecision("important", 0), {
    action: "strip-admin",
    bucketKey: "",
    kind: "important",
    warningCount: 0,
    warningsRemaining: 0,
    shouldStripAdmin: true,
  });
});