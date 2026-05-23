"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { collectNewcomerDigest } = require("../src/news/newcomers");

function buildWindow() {
  return {
    startMs: Date.parse("2026-05-13T21:00:00.000Z"),
    endMs: Date.parse("2026-05-14T18:00:00.000Z"),
  };
}

test("collectNewcomerDigest publishes joined verified and access-granted profile events", () => {
  const digest = collectNewcomerDigest({
    db: {
      profiles: {
        "user-1": {
          displayName: "Fresh",
          domains: { activity: { guildJoinedAt: "2026-05-14T10:00:00.000Z" } },
        },
        "user-2": {
          displayName: "Verified",
          domains: { roblox: { verifiedAt: "2026-05-14T11:00:00.000Z" } },
        },
        "user-3": {
          displayName: "Access",
          domains: { onboarding: { accessGrantedAt: "2026-05-14T12:00:00.000Z" } },
        },
        old: {
          displayName: "Old",
          domains: { activity: { guildJoinedAt: "2026-05-10T10:00:00.000Z" } },
        },
      },
    },
    window: buildWindow(),
  });

  assert.equal(digest.sourceEventCount, 3);
  assert.equal(digest.newcomerCount, 1);
  assert.equal(digest.verifiedCount, 1);
  assert.equal(digest.accessGrantedCount, 1);
  assert.deepEqual(digest.highlights.map((entry) => [entry.userId, entry.eventType]), [
    ["user-1", "guild_joined"],
    ["user-2", "roblox_verified"],
    ["user-3", "access_granted"],
  ]);
  assert.deepEqual(digest.candidateBuckets.map((entry) => entry.bucket), ["published_public", "published_public", "published_public"]);
});
