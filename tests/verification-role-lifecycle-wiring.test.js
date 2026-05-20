"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function loadReconcileVerificationAssignmentForMember() {
  const source = fs.readFileSync(path.join(__dirname, "..", "welcome-bot.js"), "utf8");
  const startToken = "async function reconcileVerificationAssignmentForMember(client, userId, member = null, options = {}) {";
  const endToken = "\nasync function reconcileVerificationAssignments(client, options = {}) {";
  const startIndex = source.indexOf(startToken);
  const endIndex = source.indexOf(endToken, startIndex);

  assert.ok(startIndex >= 0 && endIndex > startIndex, "expected to find reconcileVerificationAssignmentForMember in welcome-bot.js");
  const functionSource = source.slice(startIndex, endIndex).trimEnd();

  return new Function(
    "finalizeStoredProfile",
    "getVerificationProfileState",
    "cleanVerificationText",
    "isVerificationActiveStatus",
    "getVerifyAccessRoleId",
    "fetchMember",
    "stopVerificationCycle",
    `return (${functionSource});`
  );
}

test("verification reconcile keeps active state when member fetch is unresolved", async () => {
  let stopCalls = 0;
  const buildFunction = loadReconcileVerificationAssignmentForMember();
  const reconcileVerificationAssignmentForMember = buildFunction(
    () => ({ domains: { verification: { status: "pending" } } }),
    (profile) => profile.domains.verification,
    (value) => String(value || "").trim(),
    (value) => ["pending", "manual_review", "failed"].includes(String(value || "").trim()),
    () => "verify-role",
    async () => null,
    () => {
      stopCalls += 1;
      return { updated: true };
    }
  );

  const result = await reconcileVerificationAssignmentForMember({}, "user-1", null, {
    reason: "verify role removed manually",
  });

  assert.equal(stopCalls, 0);
  assert.equal(result.active, true);
  assert.equal(result.stopped, false);
  assert.equal(result.unresolved, true);
  assert.equal(result.status, "pending");
});

test("verification reconcile still stops active state when a resolved member lacks verify-role", async () => {
  const stopReasons = [];
  const buildFunction = loadReconcileVerificationAssignmentForMember();
  const reconcileVerificationAssignmentForMember = buildFunction(
    () => ({ domains: { verification: { status: "manual_review" } } }),
    (profile) => profile.domains.verification,
    (value) => String(value || "").trim(),
    (value) => ["pending", "manual_review", "failed"].includes(String(value || "").trim()),
    () => "verify-role",
    async () => null,
    (_userId, reason) => {
      stopReasons.push(reason);
      return { updated: true };
    }
  );

  const result = await reconcileVerificationAssignmentForMember({}, "user-1", {
    roles: {
      cache: {
        has: () => false,
      },
    },
  }, {
    reason: "verify role removed manually",
  });

  assert.deepEqual(stopReasons, ["verify role removed manually"]);
  assert.equal(result.active, true);
  assert.equal(result.stopped, true);
  assert.equal(result.status, "manual_review");
});