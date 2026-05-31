"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const welcomeBotSource = fs.readFileSync(path.join(__dirname, "..", "welcome-bot.js"), "utf8");

function loadReconcileHelpers() {
  const startToken = "function isWelcomePendingKillSubmission(submission) {";
  const endToken = "if (db.__needsSaveAfterLoad) saveDb();";
  const startIndex = welcomeBotSource.indexOf(startToken);
  const endIndex = welcomeBotSource.indexOf(endToken, startIndex);

  assert.ok(startIndex >= 0 && endIndex > startIndex, "expected pending reconciliation helpers in welcome-bot.js");
  const functionSource = welcomeBotSource.slice(startIndex, endIndex).trimEnd();
  return new Function(
    "db",
    "finalizeStoredProfile",
    "saveDb",
    "nowIso",
    "killTierFor",
    "fetchReviewMessage",
    "buildReviewEmbed",
    "formatRuntimeError",
    "console",
    `${functionSource}; return { isWelcomePendingKillSubmission, shouldReconcileApprovedPendingSubmission, getApprovedPendingSubmissionReconcileKind, reconcileApprovedPendingSubmissions };`
  );
}

test("startup reconciliation approves only canonical pending kill submissions that already match approved profile state", async () => {
  const db = {
    submissions: {
      stale: {
        id: "stale",
        userId: "user-1",
        status: "pending",
        mainCharacterIds: ["yuji"],
        kills: 551,
        createdAt: "2026-05-07T04:56:09.579Z",
        approveClaim: { claimedBy: "OldMod", claimedAt: "2026-05-07T04:57:00.000Z" },
      },
    },
    profiles: {
      "user-1": {
        approvedKills: 551,
        lastSubmissionStatus: "approved",
        lastSubmissionId: "stale",
        lastReviewedAt: "2026-05-07T05:05:39.444Z",
      },
    },
  };
  let saveCalls = 0;
  const edits = [];

  const buildHelpers = loadReconcileHelpers();
  const { reconcileApprovedPendingSubmissions } = buildHelpers(
    db,
    (userId) => db.profiles[userId],
    () => {
      saveCalls += 1;
    },
    () => "2026-05-31T00:00:00.000Z",
    () => 1,
    async () => ({
      async edit(payload) {
        edits.push(payload);
      },
    }),
    (submission, statusLabel) => ({ id: submission.id, statusLabel }),
    (error) => String(error?.message || error || "unknown"),
    { log() {}, warn() {} }
  );

  const result = await reconcileApprovedPendingSubmissions({});

  assert.deepEqual(result, { approved: 1, currentApproved: 1, historicalApproved: 0, reviewUpdated: 1, reviewMissing: 0, reviewFailed: 0 });
  assert.equal(db.submissions.stale.status, "approved");
  assert.equal(db.submissions.stale.reviewedAt, "2026-05-07T05:05:39.444Z");
  assert.equal(db.submissions.stale.reviewedBy, "startup reconcile");
  assert.equal(db.submissions.stale.derivedTier, 1);
  assert.equal("approveClaim" in db.submissions.stale, false);
  assert.deepEqual(edits, [{ embeds: [{ id: "stale", statusLabel: "approved" }], components: [] }]);
  assert.equal(saveCalls, 1);
});

test("startup reconciliation approves older historical pending submissions without changing profile ownership", async () => {
  const db = {
    submissions: {
      stale: {
        id: "stale",
        userId: "user-1",
        status: "pending",
        mainCharacterIds: ["yuji"],
        kills: 894,
        createdAt: "2026-05-10T11:55:37.497Z",
      },
      current: {
        id: "current",
        userId: "user-1",
        status: "pending",
        mainCharacterIds: ["yuji"],
        kills: 1054,
        createdAt: "2026-05-13T15:38:58.716Z",
      },
    },
    profiles: {
      "user-1": {
        approvedKills: 1054,
        lastSubmissionStatus: "approved",
        lastReviewedAt: "2026-05-13T15:39:14.378Z",
        lastSubmissionId: "current",
      },
    },
  };
  let saveCalls = 0;
  const edits = [];

  const buildHelpers = loadReconcileHelpers();
  const { reconcileApprovedPendingSubmissions } = buildHelpers(
    db,
    (userId) => db.profiles[userId],
    () => {
      saveCalls += 1;
    },
    () => "2026-05-31T00:00:00.000Z",
    () => 2,
    async (client, submission) => ({
      async edit(payload) {
        edits.push({ submissionId: submission.id, payload });
      },
    }),
    (submission, statusLabel) => ({ id: submission.id, statusLabel }),
    (error) => String(error?.message || error || "unknown"),
    { log() {}, warn() {} }
  );

  const result = await reconcileApprovedPendingSubmissions({});

  assert.deepEqual(result, { approved: 2, currentApproved: 1, historicalApproved: 1, reviewUpdated: 2, reviewMissing: 0, reviewFailed: 0 });
  assert.equal(db.submissions.stale.status, "approved");
  assert.equal(db.submissions.stale.reviewedAt, "2026-05-10T11:55:37.497Z");
  assert.equal(db.submissions.current.status, "approved");
  assert.equal(db.profiles["user-1"].lastSubmissionId, "current");
  assert.deepEqual(edits, [
    {
      submissionId: "stale",
      payload: {
        embeds: [{ id: "stale", statusLabel: "approved" }],
        components: [],
      },
    },
    {
      submissionId: "current",
      payload: {
        embeds: [{ id: "current", statusLabel: "approved" }],
        components: [],
      },
    },
  ]);
  assert.equal(saveCalls, 1);
});

test("startup reconciliation ignores non-welcome submissions even when profile onboarding state is approved", async () => {
  const db = {
    submissions: {
      eloPending: {
        id: "eloPending",
        userId: "user-1",
        status: "pending",
        elo: 1234,
        tier: 3,
        createdAt: "2026-05-20T11:55:37.497Z",
      },
    },
    profiles: {
      "user-1": {
        approvedKills: 1200,
        lastSubmissionStatus: "approved",
        lastSubmissionId: "eloPending",
        lastReviewedAt: "2026-05-19T15:39:14.378Z",
      },
    },
  };
  let saveCalls = 0;

  const buildHelpers = loadReconcileHelpers();
  const { reconcileApprovedPendingSubmissions, isWelcomePendingKillSubmission } = buildHelpers(
    db,
    (userId) => db.profiles[userId],
    () => {
      saveCalls += 1;
    },
    () => "2026-05-31T00:00:00.000Z",
    () => 2,
    async () => null,
    () => null,
    (error) => String(error?.message || error || "unknown"),
    { log() {}, warn() {} }
  );

  const result = await reconcileApprovedPendingSubmissions({});

  assert.equal(isWelcomePendingKillSubmission(db.submissions.eloPending), false);
  assert.deepEqual(result, { approved: 0, currentApproved: 0, historicalApproved: 0, reviewUpdated: 0, reviewMissing: 0, reviewFailed: 0 });
  assert.equal(db.submissions.eloPending.status, "pending");
  assert.equal(saveCalls, 0);
});

test("startup reconciliation skips live pending submissions without later approved profile evidence", async () => {
  const db = {
    submissions: {
      active: {
        id: "active",
        userId: "user-1",
        status: "pending",
        mainCharacterIds: ["yuji"],
        kills: 1200,
        createdAt: "2026-05-20T11:55:37.497Z",
      },
    },
    profiles: {
      "user-1": {
        approvedKills: 1200,
        lastSubmissionStatus: "approved",
        lastSubmissionId: "active",
        lastReviewedAt: "2026-05-19T15:39:14.378Z",
      },
    },
  };
  let saveCalls = 0;

  const buildHelpers = loadReconcileHelpers();
  const { reconcileApprovedPendingSubmissions } = buildHelpers(
    db,
    (userId) => db.profiles[userId],
    () => {
      saveCalls += 1;
    },
    () => "2026-05-31T00:00:00.000Z",
    () => 2,
    async () => null,
    () => null,
    (error) => String(error?.message || error || "unknown"),
    { log() {}, warn() {} }
  );

  const result = await reconcileApprovedPendingSubmissions({});

  assert.deepEqual(result, { approved: 0, currentApproved: 0, historicalApproved: 0, reviewUpdated: 0, reviewMissing: 0, reviewFailed: 0 });
  assert.equal(db.submissions.active.status, "pending");
  assert.equal(saveCalls, 0);
});

test("welcome-bot runs stale pending submission reconciliation in clientReady before core startup wiring", () => {
  const readyStartIndex = welcomeBotSource.indexOf("client.once(\"clientReady\", async () => {");
  const reconcileIndex = welcomeBotSource.indexOf("await Promise.resolve(reconcileApprovedPendingSubmissions(client))", readyStartIndex);
  const readyCoreIndex = welcomeBotSource.indexOf("const readyCoreResult = await runClientReadyCore(client, {", reconcileIndex);

  assert.ok(readyStartIndex >= 0, "expected clientReady owner in welcome-bot.js");
  assert.ok(reconcileIndex > readyStartIndex, "expected stale pending submission reconciliation inside clientReady");
  assert.ok(readyCoreIndex > reconcileIndex, "expected stale pending reconciliation before ready core startup wiring");
  assert.equal(welcomeBotSource.includes("\nreconcileApprovedPendingSubmissions();\n"), false, "did not expect raw module-load reconcile call");
});