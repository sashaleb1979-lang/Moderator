"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildRobloxCleanupAuditRecord,
  summarizeRobloxCleanupAudit,
} = require("../src/integrations/roblox-cleanup-audit");

test("buildRobloxCleanupAuditRecord flags usable Roblox bindings missing antiteam confirmation", () => {
  const record = buildRobloxCleanupAuditRecord({
    userId: "user-1",
    username: "discord-user",
    displayName: "Discord User",
    domains: {
      roblox: {
        username: "GojoMain",
        userId: "123",
        verificationStatus: "verified",
      },
    },
  }, "user-1", {
    robloxConfirmations: {},
  });

  assert.equal(record.primaryCohort, "usable_verified");
  assert.equal(record.usableWithoutAntiteamConfirmation, true);
  assert.equal(record.suggestedAction, "confirm_only");
  assert.equal(record.suspiciousPollution, false);
});

test("buildRobloxCleanupAuditRecord marks repairable Discord-like Roblox usernames as suspicious pollution", () => {
  const record = buildRobloxCleanupAuditRecord({
    userId: "user-2",
    username: "gho2m007",
    displayName: "gho2m007",
    domains: {
      roblox: {
        username: "gho2m007",
        verificationStatus: "verified",
      },
    },
  }, "user-2");

  assert.equal(record.primaryCohort, "repairable_verified");
  assert.equal(record.suspiciousPollution, true);
  assert.equal(record.suggestedAction, "manual_review");
});

test("summarizeRobloxCleanupAudit groups repair, review, confirmation and rebind cohorts", () => {
  const summary = summarizeRobloxCleanupAudit({
    profiles: {
      "usable-user": {
        userId: "usable-user",
        username: "discord-usable",
        displayName: "Usable",
        domains: {
          roblox: {
            username: "TrackableRb",
            userId: "111",
            verificationStatus: "verified",
          },
        },
      },
      "repair-user": {
        userId: "repair-user",
        username: "discord-repair",
        displayName: "Repair Candidate",
        domains: {
          roblox: {
            username: "RepairableRb",
            verificationStatus: "verified",
          },
        },
      },
      "suspicious-user": {
        userId: "suspicious-user",
        username: "discord-clone",
        displayName: "discord-clone",
        domains: {
          roblox: {
            username: "discord-clone",
            verificationStatus: "verified",
          },
        },
      },
      "manual-user": {
        userId: "manual-user",
        username: "manual-discord",
        displayName: "Manual User",
        domains: {
          roblox: {
            verificationStatus: "verified",
          },
        },
      },
      "pending-user": {
        userId: "pending-user",
        username: "pending-discord",
        displayName: "Pending User",
        domains: {
          roblox: {
            username: "PendingRb",
            verificationStatus: "pending",
            refreshError: "refresh failed",
          },
        },
      },
      "plain-user": {
        userId: "plain-user",
        username: "plain-discord",
        displayName: "Plain User",
      },
    },
    sot: {
      antiteam: {
        robloxConfirmations: {
          "usable-user": {
            userId: "usable-user",
            robloxUserId: "999",
            confirmedAt: "2026-05-20T10:00:00.000Z",
          },
        },
      },
    },
  }, {
    sampleLimit: 2,
  });

  assert.equal(summary.counts.totalProfiles, 6);
  assert.equal(summary.counts.profilesWithRobloxData, 5);
  assert.equal(summary.counts.usableVerified, 1);
  assert.equal(summary.counts.repairableVerified, 2);
  assert.equal(summary.counts.manualOnlyVerified, 1);
  assert.equal(summary.counts.pending, 1);
  assert.equal(summary.counts.failed, 0);
  assert.equal(summary.counts.unverified, 0);
  assert.equal(summary.counts.noBinding, 1);
  assert.equal(summary.counts.suspiciousPollution, 1);
  assert.equal(summary.counts.refreshError, 1);
  assert.equal(summary.counts.usableWithoutAntiteamConfirmation, 1);
  assert.equal(summary.counts.safeRepairCandidates, 1);
  assert.equal(summary.counts.manualReviewCandidates, 2);
  assert.equal(summary.counts.rebindRequiredCandidates, 1);

  assert.deepEqual(summary.samples.byPrimaryCohort.usable_verified.map((entry) => entry.userId), ["usable-user"]);
  assert.deepEqual(summary.samples.safeRepairCandidates.map((entry) => entry.userId), ["repair-user"]);
  assert.deepEqual(summary.samples.manualReviewCandidates.map((entry) => entry.userId), ["suspicious-user", "manual-user"]);
  assert.deepEqual(summary.samples.rebindRequiredCandidates.map((entry) => entry.userId), ["pending-user"]);
  assert.deepEqual(summary.samples.suspiciousPollution.map((entry) => entry.userId), ["suspicious-user"]);
  assert.deepEqual(summary.samples.usableWithoutAntiteamConfirmation.map((entry) => entry.userId), ["usable-user"]);
});