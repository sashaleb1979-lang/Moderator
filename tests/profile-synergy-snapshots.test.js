"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PROOF_WINDOW_LIMIT,
  appendProofWindowSnapshot,
  buildProofWindowSnapshot,
} = require("../src/profile/synergy-snapshots");

test("buildProofWindowSnapshot captures Roblox playtime scaffolding and tracking flag", () => {
  const snapshot = buildProofWindowSnapshot({
    approvedKills: 4320,
    killTier: 3,
    reviewedAt: "2026-05-12T10:00:00.000Z",
    reviewedBy: "mod#1",
    roblox: {
      userId: "123",
      verificationStatus: "verified",
      playtime: {
        totalJjsMinutes: 140,
        jjsMinutes7d: 60,
        jjsMinutes30d: 90,
        sessionCount: 5,
        currentSessionStartedAt: "2026-05-12T09:30:00.000Z",
        lastSeenInJjsAt: "2026-05-12T10:00:00.000Z",
        dailyBuckets: {
          "2026-05-12": 20,
        },
        hourlyBucketsMsk: {
          "2026-05-12T13": 7,
        },
      },
    },
  });

  assert.equal(snapshot.playtimeTracked, true);
  assert.equal(snapshot.totalJjsMinutes, 140);
  assert.deepEqual(snapshot.dailyBucketsSnapshot, {
    "2026-05-12": 20,
  });
  assert.deepEqual(snapshot.hourlyBucketsMskSnapshot, {
    "2026-05-12T13": 7,
  });
});

test("appendProofWindowSnapshot dedupes identical windows and caps history", () => {
  const profile = {
    domains: {
      progress: {
        proofWindows: Array.from({ length: PROOF_WINDOW_LIMIT }, (_entry, index) => ({
          approvedKills: 1000 + index,
          reviewedAt: `2026-05-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`,
        })),
      },
    },
  };

  appendProofWindowSnapshot(profile, {
    approvedKills: 1009,
    reviewedAt: "2026-05-10T10:00:00.000Z",
  });
  assert.equal(profile.domains.progress.proofWindows.length, PROOF_WINDOW_LIMIT);

  appendProofWindowSnapshot(profile, {
    approvedKills: 5000,
    killTier: 4,
    reviewedAt: "2026-05-20T10:00:00.000Z",
    reviewedBy: "mod#2",
    roblox: {
      verificationStatus: "unverified",
      playtime: {
        totalJjsMinutes: 0,
      },
    },
  });

  assert.equal(profile.domains.progress.proofWindows.length, PROOF_WINDOW_LIMIT);
  assert.equal(profile.domains.progress.proofWindows.at(-1).approvedKills, 5000);
  assert.equal(profile.domains.progress.proofWindows.at(-1).playtimeTracked, false);
  assert.equal(profile.domains.progress.proofWindows[0].approvedKills, 1001);
});