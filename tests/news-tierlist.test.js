"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { collectTierlistDigest } = require("../src/news/tierlist");

function buildWindow() {
  return {
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
