"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  addAutonomyGuardIsolatedUserId,
  clearAutonomyGuardTargetUserId,
  ensureAutonomyGuardState,
  isAutonomyGuardIsolatedUser,
  removeAutonomyGuardIsolatedUserId,
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