"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  pickAuthoritativeApprovedSubmission,
  profileNeedsKillRecovery,
  recoverApprovedProfileKills,
  recoverApprovedProfileKillsForDb,
} = require("../src/onboard/kill-recovery");

const killTierFor = (kills) => {
  if (kills >= 400) return 1;
  if (kills >= 200) return 2;
  return 3;
};
const now = () => "2026-06-16T00:00:00.000Z";

test("profileNeedsKillRecovery only flags approved members with missing kills or tier", () => {
  assert.equal(profileNeedsKillRecovery({ lastSubmissionStatus: "approved", approvedKills: null, killTier: null }), true);
  assert.equal(profileNeedsKillRecovery({ lastSubmissionStatus: "approved", approvedKills: 456, killTier: null }), true);
  assert.equal(profileNeedsKillRecovery({ lastSubmissionStatus: "approved", approvedKills: 456, killTier: 1 }), false);
  assert.equal(profileNeedsKillRecovery({ lastSubmissionStatus: "pending", approvedKills: null, killTier: null }), false);
  assert.equal(profileNeedsKillRecovery(null), false);
});

test("pickAuthoritativeApprovedSubmission prefers the profile's pinned submission", () => {
  const submissions = [
    { id: "OLD", userId: "u1", status: "approved", kills: 200, reviewedAt: "2026-04-01T00:00:00.000Z" },
    { id: "NEW", userId: "u1", status: "approved", kills: 456, reviewedAt: "2026-04-23T00:00:00.000Z" },
  ];
  const pinned = pickAuthoritativeApprovedSubmission({ userId: "u1", lastSubmissionId: "OLD" }, submissions);
  assert.equal(pinned.id, "OLD");

  // No pin → fall back to the most recently reviewed approved submission.
  const latest = pickAuthoritativeApprovedSubmission({ userId: "u1" }, submissions);
  assert.equal(latest.id, "NEW");
});

test("recoverApprovedProfileKills restores kills and tier from the approved submission", () => {
  const profile = {
    userId: "u1",
    lastSubmissionStatus: "approved",
    lastSubmissionId: "S1",
    approvedKills: null,
    killTier: null,
  };
  const submissions = [
    { id: "S1", userId: "u1", status: "approved", kills: 456, derivedTier: 1, reviewedAt: "2026-04-23T00:00:00.000Z" },
  ];

  const result = recoverApprovedProfileKills(profile, submissions, { killTierFor, now });

  assert.equal(result.changed, true);
  assert.equal(profile.approvedKills, 456);
  assert.equal(profile.killTier, 1);
  assert.equal(profile.updatedAt, "2026-06-16T00:00:00.000Z");
});

test("recoverApprovedProfileKills recomputes only the tier when kills survived", () => {
  const profile = {
    userId: "u1",
    lastSubmissionStatus: "approved",
    approvedKills: 250,
    killTier: null,
  };

  const result = recoverApprovedProfileKills(profile, [], { killTierFor, now });

  assert.equal(result.changed, true);
  assert.equal(profile.approvedKills, 250);
  assert.equal(profile.killTier, 2);
});

test("recoverApprovedProfileKills derives the tier from kills when the submission lacks one", () => {
  const profile = { userId: "u1", lastSubmissionStatus: "approved", approvedKills: null, killTier: null };
  const submissions = [{ id: "S1", userId: "u1", status: "approved", kills: 456, reviewedAt: "2026-04-23T00:00:00.000Z" }];

  const result = recoverApprovedProfileKills(profile, submissions, { killTierFor, now });

  assert.equal(result.changed, true);
  assert.equal(profile.approvedKills, 456);
  assert.equal(profile.killTier, 1);
});

test("recoverApprovedProfileKills leaves consistent and ineligible profiles untouched", () => {
  const consistent = { userId: "u1", lastSubmissionStatus: "approved", approvedKills: 456, killTier: 1 };
  assert.equal(recoverApprovedProfileKills(consistent, [], { killTierFor, now }).changed, false);

  const noSubmission = { userId: "u1", lastSubmissionStatus: "approved", approvedKills: null, killTier: null };
  const result = recoverApprovedProfileKills(noSubmission, [], { killTierFor, now });
  assert.equal(result.changed, false);
  assert.equal(noSubmission.approvedKills, null);
});

test("recoverApprovedProfileKillsForDb heals every affected profile and reports them", () => {
  const db = {
    profiles: {
      u1: { userId: "u1", lastSubmissionStatus: "approved", lastSubmissionId: "S1", approvedKills: null, killTier: null },
      u2: { userId: "u2", lastSubmissionStatus: "approved", approvedKills: 500, killTier: 1 },
      u3: { userId: "u3", lastSubmissionStatus: "pending", approvedKills: null, killTier: null },
    },
    submissions: {
      S1: { id: "S1", userId: "u1", status: "approved", kills: 456, derivedTier: 1, reviewedAt: "2026-04-23T00:00:00.000Z" },
    },
  };

  const result = recoverApprovedProfileKillsForDb(db, { killTierFor, now });

  assert.equal(result.changed, true);
  assert.deepEqual(result.recovered, [{ userId: "u1", approvedKills: 456, killTier: 1 }]);
  assert.equal(db.profiles.u1.approvedKills, 456);
  assert.equal(db.profiles.u1.killTier, 1);
  // Untouched: already-consistent and non-approved profiles.
  assert.equal(db.profiles.u2.approvedKills, 500);
  assert.equal(db.profiles.u3.approvedKills, null);
});
