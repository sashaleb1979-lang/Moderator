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
      assert.deepEqual(usernames, ["repairablerb", "discord-clone"]);
      return [
        {
          userId: 101,
          username: "RepairableRb",
          displayName: "Repair Display",
        },
        {
          userId: 202,
          username: "discord-clone",
          displayName: "Roblox Clone",
        },
      ];
    },
    markDirty(userId, reason) {
      dirtyCalls.push(`${userId}:${reason}`);
    },
  });

  assert.deepEqual(result, {
    scannedProfiles: 4,
    profilesWithRobloxData: 4,
    safeRepairCandidateCount: 2,
    cleanupTrailRestoreCandidateCount: 0,
    submissionRestoreCandidateCount: 0,
    sanitizedCount: 1,
    restoredFromCleanupTrailCount: 0,
    restoredFromSubmissionCount: 0,
    resetSuspiciousCount: 0,
    repairedCount: 2,
    unresolvedCount: 0,
    failedRepairBatchCount: 0,
    skippedSuspiciousCount: 0,
    rebindRequiredCount: 1,
    confirmOnlyCount: 1,
  });

  assert.equal(db.profiles["repair-user"].domains.roblox.userId, "101");
  assert.equal(db.profiles["repair-user"].domains.roblox.displayName, "Repair Display");
  assert.equal(db.profiles["suspicious-user"].domains.roblox.userId, "202");
  assert.equal(db.profiles["suspicious-user"].domains.roblox.verificationStatus, "verified");
  assert.deepEqual(dirtyCalls, [
    "repair-user:binding_repaired",
    "suspicious-user:binding_repaired",
  ]);

  const repairEntry = getRobloxCleanupTrailEntry(db, "repair-user");
  assert.equal(repairEntry.lastOutcome, "repaired");
  assert.equal(repairEntry.lastReason, "invalid_user_id");
  assert.deepEqual(repairEntry.history.map((entry) => entry.outcome), ["repaired"]);

  assert.equal(getRobloxCleanupTrailEntry(db, "suspicious-user").lastOutcome, "repaired");
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
    cleanupTrailRestoreCandidateCount: 0,
    submissionRestoreCandidateCount: 0,
    sanitizedCount: 0,
    restoredFromCleanupTrailCount: 0,
    restoredFromSubmissionCount: 0,
    resetSuspiciousCount: 0,
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

test("applyRobloxBindingRepairPass preserves invalid raw user id when username lookup is unresolved", async () => {
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
    },
  };

  const result = await applyRobloxBindingRepairPass({
    db,
    dryRun: false,
    persistTrail: true,
    now: "2026-05-20T11:45:00.000Z",
    source: "repair_script_apply",
    fetchUsersByUsernames: async (usernames) => {
      assert.deepEqual(usernames, ["repairablerb"]);
      return [];
    },
    markDirty(userId, reason) {
      dirtyCalls.push(`${userId}:${reason}`);
    },
  });

  assert.equal(result.sanitizedCount, 1);
  assert.equal(result.unresolvedCount, 1);
  assert.equal(db.profiles["repair-user"].domains.roblox.userId, null);
  assert.equal(db.profiles["repair-user"].domains.roblox.invalidUserId, "711122552566579240");
  assert.deepEqual(dirtyCalls, []);
  const cleanupEntry = getRobloxCleanupTrailEntry(db, "repair-user");
  assert.equal(cleanupEntry.lastOutcome, "unresolved");
  assert.equal(cleanupEntry.robloxUserId, "711122552566579240");
});

test("applyRobloxBindingRepairPass restores suspicious bindings from proven submissions", async () => {
  const db = {
    profiles: {
      "1146511958305144883": {
        userId: "1146511958305144883",
        username: "gno2m007",
        displayName: "gno2m007",
        domains: {
          roblox: {
            username: "gno2m007",
            profileUrl: "https://www.roblox.com/users/1146511958305144883/profile",
            verificationStatus: "verified",
            playtime: {
              totalJjsMinutes: 120,
              jjsMinutes7d: 60,
              jjsMinutes30d: 120,
              sessionCount: 2,
            },
          },
        },
      },
    },
    submissions: {
      sub_1: {
        id: "sub_1",
        userId: "1146511958305144883",
        status: "approved",
        reviewedAt: "2026-05-20T10:00:00.000Z",
        reviewedBy: "mod",
        robloxUsername: "KolhozU",
        robloxUserId: "9843941555",
        robloxDisplayName: "KolhozU",
      },
    },
  };

  const result = await applyRobloxBindingRepairPass({
    db,
    dryRun: false,
    persistTrail: true,
    recoverFromSubmissions: true,
    resetSuspiciousBindings: true,
    allowDestructiveSuspiciousReset: true,
    now: "2026-05-20T11:00:00.000Z",
    source: "repair_script_apply",
  });

  assert.equal(result.submissionRestoreCandidateCount, 1);
  assert.equal(result.restoredFromSubmissionCount, 1);
  assert.equal(result.resetSuspiciousCount, 0);
  assert.equal(db.profiles["1146511958305144883"].domains.roblox.username, "KolhozU");
  assert.equal(db.profiles["1146511958305144883"].domains.roblox.userId, "9843941555");
  assert.equal(db.profiles["1146511958305144883"].domains.roblox.verificationStatus, "verified");
  assert.equal(db.profiles["1146511958305144883"].domains.roblox.playtime.totalJjsMinutes, 120);
  assert.equal(getRobloxCleanupTrailEntry(db, "1146511958305144883").lastOutcome, "restored_from_submission");
});

test("applyRobloxBindingRepairPass restores reset cleanup trail entries through Roblox lookup", async () => {
  const db = {
    profiles: {
      "1146511958305144883": {
        userId: "1146511958305144883",
        username: "gno2m007",
        displayName: "gno2m007",
        domains: {
          roblox: {
            username: null,
            userId: null,
            verificationStatus: "failed",
            refreshStatus: "error",
            refreshError: "suspicious_identity_rebind_required",
            playtime: {
              totalJjsMinutes: 1434,
              jjsMinutes7d: 1134,
              jjsMinutes30d: 1434,
              sessionCount: 54,
            },
          },
        },
      },
    },
    sot: {
      integrations: {
        roblox: {
          cleanup: {
            version: 1,
            lastRunAt: "2026-05-22T09:12:39.135Z",
            byDiscordUserId: {
              "1146511958305144883": {
                userId: "1146511958305144883",
                lastEvaluatedAt: "2026-05-22T09:12:39.135Z",
                lastOutcome: "reset_suspicious",
                lastReason: "suspicious_identity",
                lastSource: "repair_script_apply",
                robloxUsername: "KolhozU",
                robloxUserId: null,
                history: [],
              },
            },
          },
        },
      },
    },
  };

  const result = await applyRobloxBindingRepairPass({
    db,
    dryRun: false,
    persistTrail: true,
    recoverFromSubmissions: true,
    now: "2026-05-23T10:00:00.000Z",
    source: "repair_script_apply",
    fetchUsersByUsernames: async (usernames) => {
      assert.deepEqual(usernames, ["kolhozu"]);
      return [{
        userId: 9843941555,
        username: "KolhozU",
        displayName: "KolhozU",
        profileUrl: "https://www.roblox.com/users/9843941555/profile",
      }];
    },
  });

  assert.equal(result.cleanupTrailRestoreCandidateCount, 1);
  assert.equal(result.restoredFromCleanupTrailCount, 1);
  assert.equal(result.repairedCount, 1);
  assert.equal(db.profiles["1146511958305144883"].domains.roblox.username, "KolhozU");
  assert.equal(db.profiles["1146511958305144883"].domains.roblox.userId, "9843941555");
  assert.equal(db.profiles["1146511958305144883"].domains.roblox.verificationStatus, "verified");
  assert.equal(db.profiles["1146511958305144883"].domains.roblox.refreshError, null);
  assert.equal(db.profiles["1146511958305144883"].domains.roblox.playtime.totalJjsMinutes, 1434);
  assert.equal(getRobloxCleanupTrailEntry(db, "1146511958305144883").lastOutcome, "restored_from_cleanup_trail");
});

test("applyRobloxBindingRepairPass resets unproven suspicious bindings without dropping playtime", async () => {
  const db = {
    profiles: {
      suspicious: {
        userId: "999999999999999999",
        username: "discord-name",
        displayName: "discord-name",
        domains: {
          roblox: {
            username: "discord-name",
            profileUrl: "https://www.roblox.com/users/999999999999999999/profile",
            verificationStatus: "verified",
            playtime: {
              totalJjsMinutes: 240,
              jjsMinutes7d: 30,
              jjsMinutes30d: 240,
              sessionCount: 4,
            },
          },
        },
      },
    },
  };

  const result = await applyRobloxBindingRepairPass({
    db,
    dryRun: false,
    persistTrail: true,
    recoverFromSubmissions: true,
    resetSuspiciousBindings: true,
    allowDestructiveSuspiciousReset: true,
    now: "2026-05-20T11:00:00.000Z",
    source: "repair_script_apply",
  });

  assert.equal(result.restoredFromSubmissionCount, 0);
  assert.equal(result.resetSuspiciousCount, 1);
  assert.equal(db.profiles.suspicious.domains.roblox.username, null);
  assert.equal(db.profiles.suspicious.domains.roblox.userId, null);
  assert.equal(db.profiles.suspicious.domains.roblox.profileUrl, null);
  assert.equal(db.profiles.suspicious.domains.roblox.verificationStatus, "failed");
  assert.equal(db.profiles.suspicious.domains.roblox.refreshError, "suspicious_identity_rebind_required");
  assert.equal(db.profiles.suspicious.domains.roblox.playtime.totalJjsMinutes, 240);
  assert.equal(getRobloxCleanupTrailEntry(db, "suspicious").lastOutcome, "reset_suspicious");
});
