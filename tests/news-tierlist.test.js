"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { collectTierlistDigest } = require("../src/news/tierlist");

function buildWindow() {
  return {
    dayKey: "2026-05-14",
    startMs: Date.parse("2026-05-13T21:00:00.000Z"),
    endMs: Date.parse("2026-05-14T18:00:00.000Z"),
  };
}

test("collectTierlistDigest publishes profile tierlist submissions without inventing shifts", () => {
  const digest = collectTierlistDigest({
    db: {
      profiles: {
        "user-1": {
          displayName: "MainPicker",
          domains: {
            tierlist: {
              mainId: "char-gojo",
              mainName: "Gojo",
              submittedAt: "2026-05-14T12:00:00.000Z",
              influenceMultiplier: 1.2,
            },
          },
        },
      },
    },
    window: buildWindow(),
  });

  assert.equal(digest.sourceUpdateCount, 1);
  assert.deepEqual(digest.updates.map((entry) => [entry.userId, entry.mainName, entry.influenceMultiplier]), [
    ["user-1", "Gojo", 1.2],
  ]);
  assert.equal(digest.shifts.available, false);
  assert.equal(digest.shifts.reason, "no_tierlist_shift_history_yet");
  assert.equal(digest.candidateBuckets[0].bucket, "published_public");
});

test("collectTierlistDigest derives focus and influence shifts from news-owned day snapshots", () => {
  const digest = collectTierlistDigest({
    db: {
      profiles: {
        "user-1": {
          displayName: "MainPicker",
          domains: {
            tierlist: {
              mainId: "char-sukuna",
              mainName: "Sukuna",
              submittedAt: "2026-05-14T12:00:00.000Z",
              influenceMultiplier: 1.4,
            },
          },
        },
        "user-2": {
          displayName: "InfluenceOnly",
          domains: {
            tierlist: {
              mainId: "char-gojo",
              mainName: "Gojo",
              influenceMultiplier: 1.5,
            },
          },
        },
      },
      sot: {
        news: {
          history: {
            daySnapshots: {
              "2026-05-13": {
                "user-1": {
                  displayName: "MainPicker",
                  tierlistMainId: "char-gojo",
                  tierlistMainName: "Gojo",
                  tierlistInfluenceMultiplier: 1,
                },
                "user-2": {
                  displayName: "InfluenceOnly",
                  tierlistMainId: "char-gojo",
                  tierlistMainName: "Gojo",
                  tierlistInfluenceMultiplier: 1,
                },
              },
            },
          },
        },
      },
    },
    window: buildWindow(),
    config: { tierlist: { topCount: 2 } },
  });

  assert.equal(digest.shifts.available, true);
  assert.equal(digest.shifts.baselineDayKey, "2026-05-13");
  assert.equal(digest.shifts.totalShiftCount, 2);
  assert.deepEqual(digest.shifts.items.map((entry) => [
    entry.userId,
    entry.mainChanged,
    entry.fromMainName,
    entry.toMainName,
    entry.influenceDelta,
  ]), [
    ["user-1", true, "Gojo", "Sukuna", 0.4],
    ["user-2", false, "Gojo", "Gojo", 0.5],
  ]);
});
