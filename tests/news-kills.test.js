"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { collectKillDigest } = require("../src/news/kills");

function buildWindow() {
  return {
    startMs: Date.parse("2026-05-13T21:00:00.000Z"),
    endMs: Date.parse("2026-05-14T18:00:00.000Z"),
  };
}

test("collectKillDigest publishes top approved kill jumps and audits rejected/pending results", () => {
  const db = {
    profiles: {
      "user-1": { displayName: "Alpha" },
      "user-2": { displayName: "Beta" },
      "user-3": { displayName: "Gamma" },
    },
    submissions: {
      old: {
        id: "old",
        userId: "user-1",
        displayName: "Alpha",
        kills: 100,
        status: "approved",
        createdAt: "2026-05-12T10:00:00.000Z",
        reviewedAt: "2026-05-12T11:00:00.000Z",
      },
      jump: {
        id: "jump",
        userId: "user-1",
        displayName: "Alpha",
        kills: 180,
        derivedTier: 4,
        status: "approved",
        createdAt: "2026-05-14T12:00:00.000Z",
        reviewedAt: "2026-05-14T13:00:00.000Z",
        reviewedBy: "mod#0001",
      },
      rejected: {
        id: "rejected",
        userId: "user-2",
        displayName: "Beta",
        kills: 500,
        status: "rejected",
        createdAt: "2026-05-14T14:00:00.000Z",
        reviewedAt: "2026-05-14T15:00:00.000Z",
        rejectReason: "bad screenshot",
      },
      pending: {
        id: "pending",
        userId: "user-3",
        displayName: "Gamma",
        kills: 220,
        status: "pending",
        createdAt: "2026-05-14T16:00:00.000Z",
        reviewedAt: null,
      },
    },
  };

  const digest = collectKillDigest({ db, window: buildWindow(), config: { kills: { topCount: 5 } } });

  assert.equal(digest.upgradeCount, 1);
  assert.deepEqual(digest.topUpgrades.map((entry) => ({ userId: entry.userId, delta: entry.delta, submissionId: entry.submissionId })), [
    { userId: "user-1", delta: 80, submissionId: "jump" },
  ]);
  assert.deepEqual(digest.byStatus, {
    approved: 1,
    pending: 1,
    rejected: 1,
    expired: 0,
    superseded: 0,
    invalid: 0,
    other: 0,
  });
  assert.deepEqual(digest.candidateBuckets.map((entry) => [entry.submissionId, entry.bucket]), [
    ["jump", "published_public"],
    ["rejected", "rejected"],
    ["pending", "pending_review"],
  ]);
  assert.equal(digest.staffItems.find((entry) => entry.id === "rejected").bucketDetail, "bad screenshot");
});

test("collectKillDigest suppresses approved submissions without a public jump", () => {
  const db = {
    submissions: {
      first: {
        id: "first",
        userId: "user-1",
        displayName: "Alpha",
        kills: 50,
        status: "approved",
        createdAt: "2026-05-14T10:00:00.000Z",
        reviewedAt: "2026-05-14T11:00:00.000Z",
      },
    },
  };

  const digest = collectKillDigest({ db, window: buildWindow() });

  assert.equal(digest.upgradeCount, 0);
  assert.equal(digest.sourceSubmissionCount, 1);
  assert.equal(digest.candidateBuckets[0].bucket, "suppressed_by_threshold");
  assert.equal(digest.candidateBuckets[0].detail, "approved_without_public_top_upgrade");
});
