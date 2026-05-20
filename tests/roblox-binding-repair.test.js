"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  applyRobloxBindingRepairPass,
  getRobloxCleanupTrailEntry,
} = require("../src/integrations/roblox-binding-repair");

test("applyRobloxBindingRepairPass repairs safe candidates and persists cleanup trail on write mode", async () => {
  const dirtyCalls = [];
  const db = {
    profiles: {
      "repair-user": {
        userId: "repair-user",
        username: "discord-repair",
        displayName: "Repair User",
        domains: {
          roblox: {
            username: "RepairableRb",
            userId: "711122552566579240",
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
      "usable-user": {
        userId: "usable-user",
        username: "discord-usable",
        displayName: "Usable User",
        domains: {
          roblox: {
            username: "GojoMain",
            userId: "123",
            verificationStatus: "verified",
          },
        },
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
  };

  const result = await applyRobloxBindingRepairPass({
    db,
    dryRun: false,
    persistTrail: true,
    now: "2026-05-20T11:00:00.000Z",
    source: "repair_script_apply",
    fetchUsersByUsernames: async (usernames) => {
      assert.deepEqual(usernames, ["repairablerb"]);
      return [{
        userId: 101,
        username: "RepairableRb",
        displayName: "Repair Display",
      }];
    },
    markDirty(userId, reason) {
      dirtyCalls.push(`${userId}:${reason}`);
    },
  });

  assert.deepEqual(result, {
    scannedProfiles: 4,
    profilesWithRobloxData: 4,
    safeRepairCandidateCount: 1,
    sanitizedCount: 1,
    repairedCount: 1,
    unresolvedCount: 0,
    failedRepairBatchCount: 0,
    skippedSuspiciousCount: 1,
    rebindRequiredCount: 1,
    confirmOnlyCount: 1,
  });

  assert.equal(db.profiles["repair-user"].domains.roblox.userId, "101");
  assert.equal(db.profiles["repair-user"].domains.roblox.displayName, "Repair Display");
  assert.deepEqual(dirtyCalls, [
    "repair-user:binding_sanitized",
    "repair-user:binding_repaired",
  ]);

  const repairEntry = getRobloxCleanupTrailEntry(db, "repair-user");
  assert.equal(repairEntry.lastOutcome, "repaired");
  assert.equal(repairEntry.lastReason, "invalid_user_id");
  assert.deepEqual(repairEntry.history.map((entry) => entry.outcome), ["repaired", "sanitized"]);

  assert.equal(getRobloxCleanupTrailEntry(db, "suspicious-user").lastOutcome, "skipped_suspicious");
  assert.equal(getRobloxCleanupTrailEntry(db, "manual-user").lastOutcome, "rebind_required");
  assert.equal(getRobloxCleanupTrailEntry(db, "usable-user").lastOutcome, "confirm_only");
});

test("applyRobloxBindingRepairPass keeps dry-run non-destructive while still reporting unresolved candidates", async () => {
  const db = {
    profiles: {
      "repair-user": {
        userId: "repair-user",
        username: "discord-repair",
        displayName: "Repair User",
        domains: {
          roblox: {
            username: "RepairableRb",
            verificationStatus: "verified",
          },
        },
      },
    },
  };

  const result = await applyRobloxBindingRepairPass({
    db,
    dryRun: true,
    persistTrail: true,
    now: "2026-05-20T11:30:00.000Z",
    source: "repair_script_dry_run",
    fetchUsersByUsernames: async (usernames) => {
      assert.deepEqual(usernames, ["repairablerb"]);
      return [];
    },
  });

  assert.deepEqual(result, {
    scannedProfiles: 1,
    profilesWithRobloxData: 1,
    safeRepairCandidateCount: 1,
    sanitizedCount: 0,
    repairedCount: 0,
    unresolvedCount: 1,
    failedRepairBatchCount: 0,
    skippedSuspiciousCount: 0,
    rebindRequiredCount: 0,
    confirmOnlyCount: 0,
  });

  assert.equal(db.profiles["repair-user"].domains.roblox.userId, undefined);
  assert.equal(getRobloxCleanupTrailEntry(db, "repair-user"), null);
});