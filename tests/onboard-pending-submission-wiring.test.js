"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function buildPendingSubmissionHelpers(db, nowIso = "2026-05-22T12:00:00.000Z") {
  const source = fs.readFileSync(path.join(__dirname, "..", "welcome-bot.js"), "utf8");
  const startToken = "function isSubmissionActive(submission) {";
  const endToken = "\nfunction getLatestSubmissionForUser(userId) {";
  const startIndex = source.indexOf(startToken);
  const endIndex = source.indexOf(endToken, startIndex);

  assert.ok(startIndex >= 0 && endIndex > startIndex, "expected onboarding pending submission helpers to exist in welcome-bot.js");
  const functionSource = source.slice(startIndex, endIndex).trimEnd();

  const hoursSince = (value) => {
    const ts = Date.parse(value || "");
    if (!Number.isFinite(ts)) return Number.POSITIVE_INFINITY;
    return (Date.parse(nowIso) - ts) / 36e5;
  };

  return new Function(
    "db",
    "PENDING_EXPIRE_HOURS",
    "hoursSince",
    `${functionSource}; return { getPendingSubmissionForUser };`
  )(db, 72, hoursSince);
}

test("getPendingSubmissionForUser ignores stale pending rows once a newer submission was reviewed", () => {
  const db = {
    submissions: {
      stalePending: {
        id: "stalePending",
        userId: "user-1",
        status: "pending",
        createdAt: "2026-05-21T08:00:00.000Z",
      },
      reviewed: {
        id: "reviewed",
        userId: "user-1",
        status: "approved",
        createdAt: "2026-05-22T09:00:00.000Z",
        reviewedAt: "2026-05-22T10:00:00.000Z",
      },
      activePending: {
        id: "activePending",
        userId: "user-2",
        status: "pending",
        createdAt: "2026-05-22T11:00:00.000Z",
      },
    },
    profiles: {
      "user-1": {
        lastReviewedAt: "2026-05-22T10:00:00.000Z",
      },
    },
  };

  const { getPendingSubmissionForUser } = buildPendingSubmissionHelpers(db);

  assert.equal(getPendingSubmissionForUser("user-1"), null);
  assert.equal(getPendingSubmissionForUser("user-2")?.id, "activePending");
});