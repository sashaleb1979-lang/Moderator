"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { collectGameplayDigest } = require("../src/news/gameplay");

function buildWindow() {
  return {
    dayKey: "2026-05-14",
    startMs: Date.parse("2026-05-13T21:00:00.000Z"),
    endMs: Date.parse("2026-05-14T18:00:00.000Z"),
  };
}

test("collectGameplayDigest publishes precise JJS playtime and keeps daily buckets ambiguous", () => {
  const digest = collectGameplayDigest({
    db: {
      profiles: {
        precise: {
          displayName: "Precise",
          domains: {
            roblox: {
              playtime: {
                sessionHistory: [
                  { startedAt: "2026-05-14T10:00:00.000Z", endedAt: "2026-05-14T11:30:00.000Z", durationMinutes: 90 },
                ],
              },
            },
          },
        },
        hourly: {
          displayName: "Hourly",
          domains: {
            roblox: {
              playtime: {
                hourlyBucketsMsk: {
                  "2026-05-14T15": 45,
                },
              },
            },
          },
        },
        daily: {
          displayName: "DailyOnly",
          domains: {
            roblox: {
              playtime: {
                dailyBuckets: {
                  "2026-05-14": 180,
                },
              },
            },
          },
        },
      },
    },
    window: buildWindow(),
  });

  assert.equal(digest.sourcePlayerCount, 3);
  assert.equal(digest.precisePlayerCount, 2);
  assert.equal(digest.ambiguousDailyBucketCount, 1);
  assert.deepEqual(digest.topPlayers.map((entry) => [entry.userId, entry.minutes, entry.sourceType]), [
    ["precise", 90, "roblox_session_history"],
    ["hourly", 45, "roblox_hourly_buckets_msk"],
  ]);
  assert.deepEqual(digest.candidateBuckets.map((entry) => [entry.userId, entry.bucket]), [
    ["precise", "published_public"],
    ["hourly", "published_public"],
    ["daily", "ambiguous_source"],
  ]);
  assert.equal(digest.partial, true);
  assert.deepEqual(digest.partialReasons, ["jjs_daily_buckets_without_precise_cutoff"]);
});
