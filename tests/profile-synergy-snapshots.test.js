"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PROOF_WINDOW_LIMIT,
  POPULATION_SNAPSHOT_LIMIT,
  SEASON_ARCHIVE_LIMIT,
  appendProofWindowSnapshot,
  appendSeasonArchiveSnapshot,
  captureProfilePopulationSnapshot,
  captureSeasonArchiveSnapshots,
  buildProofWindowSnapshot,
  buildSeasonArchiveSnapshot,
  buildSeasonArchiveWeeklyRollups,
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

test("buildProofWindowSnapshot keeps repairable verified Roblox out of tracked playtime", () => {
  const snapshot = buildProofWindowSnapshot({
    approvedKills: 4320,
    reviewedAt: "2026-05-12T10:00:00.000Z",
    roblox: {
      username: "GojoMain",
      verificationStatus: "verified",
      playtime: {
        totalJjsMinutes: 140,
      },
    },
  });

  assert.equal(snapshot.playtimeTracked, false);
  assert.equal(snapshot.totalJjsMinutes, 140);
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

test("buildSeasonArchiveWeeklyRollups builds covered weekly composite from daily archive snapshots", () => {
  const snapshots = Array.from({ length: 7 }, (_entry, index) => {
    const day = String(18 + index).padStart(2, "0");
    return {
      dayKey: `2026-05-${day}`,
      capturedAt: `2026-05-${day}T12:00:00.000Z`,
      approvedKills: 1000 + index * 50,
      dayJjsMinutes: 120,
      messages7d: 140 + index * 10,
      sessions7d: 10 + index,
      voiceDurationSeconds7d: 3600 + index * 900,
      antiteamSupportPoints: index < 4 ? 1 : 2,
    };
  });

  const rollups = buildSeasonArchiveWeeklyRollups(snapshots);

  assert.equal(rollups.length, 1);
  assert.equal(rollups[0].weekKey, "2026-W21");
  assert.equal(rollups[0].startDayKey, "2026-05-18");
  assert.equal(rollups[0].endDayKey, "2026-05-24");
  assert.equal(rollups[0].coverage.coveredDays, 7);
  assert.equal(rollups[0].coverage.coveragePercent, 100);
  assert.equal(rollups[0].totals.jjsMinutes, 840);
  assert.equal(rollups[0].totals.messages, 200);
  assert.equal(rollups[0].totals.sessions, 16);
  assert.equal(rollups[0].totals.approvedKillsDelta, 300);
  assert.equal(rollups[0].totals.antiteamPointsDelta, 1);
  assert.equal(rollups[0].composite.confidenceState, "reliable");
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

test("appendSeasonArchiveSnapshot rebuilds weekly rollups after daily archive append", () => {
  const profile = {};

  for (let index = 0; index < 7; index += 1) {
    const day = String(18 + index).padStart(2, "0");
    appendSeasonArchiveSnapshot(profile, {
      capturedAt: `2026-05-${day}T12:00:00.000Z`,
      profile: {
        approvedKills: 1000 + index * 100,
        domains: {
          activity: {
            messages7d: 100 + index * 10,
            sessions7d: 7 + index,
          },
          roblox: {
            userId: "123",
            verificationStatus: "verified",
            playtime: {
              totalJjsMinutes: 1000 + index * 120,
              dailyBuckets: {
                [`2026-05-${day}`]: 120,
              },
            },
          },
          support: {
            antiteam: {
              sourceAvailable: true,
              confirmedArrived: index,
              source: "sot.antiteam.stats.helpers",
            },
          },
        },
      },
    });
  }

  assert.equal(profile.domains.seasonArchive.weeklyRollups.length, 1);
  assert.equal(profile.domains.seasonArchive.weeklyRollups[0].weekKey, "2026-W21");
  assert.equal(profile.domains.seasonArchive.weeklyRollups[0].coverage.coveredDays, 7);
  assert.equal(profile.domains.seasonArchive.weeklyRollups[0].totals.antiteamPointsDelta, 6);
});

test("appendSeasonArchiveSnapshot enriches daily deltas for exact season and farm reads", () => {
  const profile = {
    approvedKills: 100,
    domains: {
      roblox: {
        userId: "123",
        username: "YujiRb",
        verificationStatus: "verified",
        playtime: {
          totalJjsMinutes: 100,
          jjsMinutes7d: 100,
          jjsMinutes30d: 100,
          sessionCount: 1,
          dailyBuckets: { "2026-05-18": 100 },
          hourlyBucketsMsk: {},
        },
      },
      voice: {
        summary: {
          lifetimeSessionCount: 1,
          lifetimeVoiceDurationSeconds: 600,
        },
      },
      support: {
        antiteam: {
          sourceAvailable: true,
          confirmedArrived: 1,
        },
      },
    },
  };

  appendSeasonArchiveSnapshot(profile, {
    profile,
    capturedAt: "2026-05-18T12:00:00.000Z",
    dayKey: "2026-05-18",
  });

  profile.approvedKills = 130;
  profile.domains.roblox.playtime.totalJjsMinutes = 160;
  profile.domains.roblox.playtime.jjsMinutes7d = 160;
  profile.domains.roblox.playtime.jjsMinutes30d = 160;
  profile.domains.roblox.playtime.sessionCount = 3;
  profile.domains.roblox.playtime.dailyBuckets["2026-05-19"] = 60;
  profile.domains.voice.summary.lifetimeSessionCount = 3;
  profile.domains.voice.summary.lifetimeVoiceDurationSeconds = 1800;
  profile.domains.support.antiteam.confirmedArrived = 3;

  appendSeasonArchiveSnapshot(profile, {
    profile,
    capturedAt: "2026-05-19T12:00:00.000Z",
    dayKey: "2026-05-19",
  });

  const latest = profile.domains.seasonArchive.snapshots.at(-1);
  assert.deepEqual(latest.dayDeltas, {
    hasPreviousSnapshot: true,
    jjsMinutes: 60,
    totalJjsMinutes: 60,
    sessionCount: 2,
    approvedKills: 30,
    antiteamSupportPoints: 2,
    voiceSeconds: 1200,
    voiceSessionCount: 2,
    confidenceState: "reliable",
  });
  assert.equal(profile.domains.seasonArchive.weeklyRollups[0].totals.sessions, 2);
  assert.equal(profile.domains.seasonArchive.weeklyRollups[0].totals.voiceSeconds, 1200);
  assert.equal(profile.domains.seasonArchive.weeklyRollups[0].totals.approvedKillsDelta, 30);
});

test("captureProfilePopulationSnapshot writes idempotent persisted relative baseline", () => {
  const db = {
    analytics: {
      profilePopulationSnapshots: Array.from({ length: POPULATION_SNAPSHOT_LIMIT }, (_entry, index) => ({
        dayKey: `2026-01-${String((index % 28) + 1).padStart(2, "0")}`,
        capturedAt: `2026-01-${String((index % 28) + 1).padStart(2, "0")}T12:00:00.000Z`,
        profileCount: 1,
        eligibleProfileCount: 1,
        axes: {},
      })),
    },
    profiles: {
      helper: {
        approvedKills: 4300,
        domains: {
          activity: {
            messages30d: 210,
            sessions30d: 25,
            voiceSessions30d: 4,
            voiceDurationSeconds30d: 10800,
            effectiveVoiceHours30d: 2,
            effectiveActiveVoiceSignalHours30d: 1,
          },
          roblox: {
            userId: "123",
            verificationStatus: "verified",
            playtime: {
              jjsMinutes30d: 420,
              sessionCount: 9,
            },
          },
          voice: {
            summary: {
              voiceDurationSeconds30d: 7200,
              sessionCount30d: 3,
              lastCapturedAt: "2026-05-20T10:00:00.000Z",
            },
          },
          support: {
            antiteam: {
              sourceAvailable: true,
              confirmedArrived: 3,
              source: "sot.antiteam.stats.helpers",
            },
          },
          progress: {
            proofWindows: [
              {
                approvedKills: 4000,
                reviewedAt: "2026-05-10T00:00:00.000Z",
              },
              {
                approvedKills: 4300,
                reviewedAt: "2026-05-15T00:00:00.000Z",
              },
            ],
          },
        },
      },
      quiet: {},
    },
  };

  const firstRun = captureProfilePopulationSnapshot(db, {
    now: "2026-05-20T12:00:00.000Z",
  });
  const secondRun = captureProfilePopulationSnapshot(db, {
    now: "2026-05-20T12:00:00.000Z",
  });

  assert.equal(firstRun.mutated, true);
  assert.equal(secondRun.mutated, false);
  assert.equal(db.analytics.profilePopulationSnapshots.length, POPULATION_SNAPSHOT_LIMIT);
  assert.equal(db.analytics.profilePopulationSnapshots.at(-1).dayKey, "2026-05-20");
  assert.equal(firstRun.snapshot.profileCount, 2);
  assert.equal(firstRun.snapshot.eligibleProfileCount, 1);
  assert.deepEqual(firstRun.snapshot.axes.discord_messages_30d.values, [210]);
  assert.deepEqual(firstRun.snapshot.axes.discord_sessions_30d.values, [25]);
  assert.deepEqual(firstRun.snapshot.axes.voice_hours_30d.values, [3]);
  assert.deepEqual(firstRun.snapshot.axes.voice_sessions_30d.values, [4]);
  assert.deepEqual(firstRun.snapshot.axes.active_voice_share_30d.values, [50]);
  assert.deepEqual(firstRun.snapshot.axes.jjs_time_30d.values, [7]);
  assert.deepEqual(firstRun.snapshot.axes.jjs_session_count.values, [9]);
  assert.deepEqual(firstRun.snapshot.axes.kills_per_covered_day.values, [60]);
  assert.deepEqual(firstRun.snapshot.axes.antiteam_support_points.values, [3]);
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
