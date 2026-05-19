"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PROOF_WINDOW_LIMIT,
  SEASON_ARCHIVE_LIMIT,
  appendProofWindowSnapshot,
  appendSeasonArchiveSnapshot,
  captureSeasonArchiveSnapshots,
  buildProofWindowSnapshot,
  buildSeasonArchiveSnapshot,
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

test("buildSeasonArchiveSnapshot captures canonical daily rollups for story infrastructure", () => {
  const snapshot = buildSeasonArchiveSnapshot({
    capturedAt: "2026-05-19T12:30:00.000Z",
    profile: {
      approvedKills: 4320,
      killTier: 3,
      accessGrantedAt: "2026-05-01T00:00:00.000Z",
      mainCharacterIds: ["gojo"],
      mainCharacterLabels: ["Gojo"],
      domains: {
        tierlist: {
          mainId: "gojo",
          mainName: "Gojo",
        },
        activity: {
          activityScore: 77,
          messages7d: 35,
          sessions7d: 8,
          activeDays7d: 4,
          daysAbsent: 2,
          lastSeenAt: "2026-05-19T11:00:00.000Z",
          appliedActivityRoleKey: "active",
        },
        roblox: {
          userId: "123",
          username: "GojoMain",
          verificationStatus: "verified",
          serverFriends: {
            userIds: ["friend-1", "friend-2"],
          },
          playtime: {
            totalJjsMinutes: 5000,
            jjsMinutes7d: 180,
            jjsMinutes30d: 420,
            sessionCount: 9,
            lastSeenInJjsAt: "2026-05-19T12:00:00.000Z",
            dailyBuckets: {
              "2026-05-19": 70,
            },
            hourlyBucketsMsk: {
              "2026-05-19T19": 30,
              "2026-05-19T20": 40,
            },
          },
          coPlay: {
            peers: [
              { peerUserId: "peer-2", minutesTogether: 110, sessionsTogether: 2, lastSeenTogetherAt: "2026-05-19T10:00:00.000Z" },
              { peerUserId: "peer-1", minutesTogether: 210, sessionsTogether: 5, lastSeenTogetherAt: "2026-05-19T11:00:00.000Z" },
            ],
          },
        },
        progress: {
          proofWindows: [
            { approvedKills: 4000, reviewedAt: "2026-05-10T10:00:00.000Z" },
            { approvedKills: 4320, reviewedAt: "2026-05-18T10:00:00.000Z" },
          ],
        },
        voice: {
          summary: {
            sessionCount7d: 1,
            voiceDurationSeconds7d: 5400,
            sessionCount30d: 2,
            voiceDurationSeconds30d: 9000,
            lastVoiceSeenAt: "2026-05-19T09:00:00.000Z",
          },
        },
        social: {
          suggestions: [
            { peerUserId: "peer-3" },
            { peerUserId: "peer-4" },
          ],
        },
      },
    },
  });

  assert.equal(snapshot.dayKey, "2026-05-19");
  assert.equal(snapshot.approvedKills, 4320);
  assert.equal(snapshot.activityScore, 77);
  assert.equal(snapshot.dayJjsMinutes, 70);
  assert.equal(snapshot.hourlyBucketCount, 2);
  assert.deepEqual(snapshot.topCoPlayPeerUserIds, ["peer-1", "peer-2"]);
  assert.equal(snapshot.proofWindowCount, 2);
  assert.equal(snapshot.lastProofWindowApprovedKills, 4320);
  assert.equal(snapshot.voiceDurationSeconds7d, 5400);
  assert.deepEqual(snapshot.socialSuggestionPeerUserIds, ["peer-3", "peer-4"]);
});

test("appendSeasonArchiveSnapshot dedupes by day and caps bounded history", () => {
  const profile = {
    domains: {
      seasonArchive: {
        snapshots: Array.from({ length: SEASON_ARCHIVE_LIMIT }, (_entry, index) => ({
          dayKey: `2026-01-${String((index % 28) + 1).padStart(2, "0")}`,
          capturedAt: `2026-01-${String((index % 28) + 1).padStart(2, "0")}T10:00:00.000Z`,
        })),
      },
    },
  };

  appendSeasonArchiveSnapshot(profile, {
    capturedAt: "2026-01-05T12:00:00.000Z",
    profile: {
      approvedKills: 2000,
    },
  });

  appendSeasonArchiveSnapshot(profile, {
    capturedAt: "2026-06-01T12:00:00.000Z",
    profile: {
      approvedKills: 5000,
      killTier: 4,
    },
  });

  assert.equal(profile.domains.seasonArchive.snapshots.length, 29);
  assert.equal(profile.domains.seasonArchive.snapshots.at(-1).dayKey, "2026-06-01");
  assert.equal(profile.domains.seasonArchive.snapshots.at(-1).approvedKills, 5000);
  assert.equal(profile.domains.seasonArchive.snapshots.find((entry) => entry.dayKey === "2026-01-05").capturedAt, "2026-01-05T12:00:00.000Z");
});

test("captureSeasonArchiveSnapshots writes one canonical daily snapshot per shared profile and stays idempotent on rerun", () => {
  const db = {
    profiles: {
      user1: {
        approvedKills: 4200,
        killTier: 3,
        mainCharacterIds: ["gojo"],
        domains: {
          activity: {
            activityScore: 70,
          },
          roblox: {
            userId: "123",
            verificationStatus: "verified",
            playtime: {
              totalJjsMinutes: 2000,
              dailyBuckets: {
                "2026-06-01": 120,
              },
            },
          },
        },
      },
      user2: {
        domains: {
          seasonArchive: {
            snapshots: [
              {
                dayKey: "2026-05-31",
                capturedAt: "2026-05-31T12:00:00.000Z",
                approvedKills: 1111,
              },
            ],
          },
        },
      },
    },
  };

  const firstRun = captureSeasonArchiveSnapshots(db, {
    now: "2026-06-01T12:00:00.000Z",
  });

  assert.equal(firstRun.mutated, true);
  assert.equal(firstRun.updatedCount, 2);
  assert.equal(firstRun.skippedCount, 0);
  assert.equal(firstRun.totalProfiles, 2);
  assert.equal(db.profiles.user1.domains.seasonArchive.snapshots.at(-1).dayKey, "2026-06-01");
  assert.equal(db.profiles.user1.domains.seasonArchive.snapshots.at(-1).dayJjsMinutes, 120);
  assert.equal(db.profiles.user2.domains.seasonArchive.snapshots.length, 2);

  const secondRun = captureSeasonArchiveSnapshots(db, {
    now: "2026-06-01T12:00:00.000Z",
  });

  assert.equal(secondRun.mutated, false);
  assert.equal(secondRun.updatedCount, 0);
  assert.equal(secondRun.skippedCount, 2);
  assert.equal(db.profiles.user1.domains.seasonArchive.snapshots.length, 1);
  assert.equal(db.profiles.user2.domains.seasonArchive.snapshots.length, 2);
});