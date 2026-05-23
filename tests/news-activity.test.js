"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { collectActivityDigest } = require("../src/news/activity");

function buildWindow() {
  return {
    startMs: Date.parse("2026-05-13T21:00:00.000Z"),
    endMs: Date.parse("2026-05-14T18:00:00.000Z"),
  };
}

test("collectActivityDigest builds top message authors from persisted daily rows", () => {
  const db = {
    profiles: {
      "user-1": { displayName: "Alpha" },
      "user-2": { displayName: "Beta" },
      "user-3": { displayName: "Gamma" },
    },
    sot: {
      activity: {
        userChannelDailyStats: [
          {
            guildId: "guild-1",
            channelId: "main-1",
            userId: "user-1",
            date: "2026-05-14",
            messagesCount: 6,
            weightedMessagesCount: 6,
            sessionsCount: 1,
            effectiveSessionsCount: 1,
            firstMessageAt: "2026-05-14T10:00:00.000Z",
            lastMessageAt: "2026-05-14T10:10:00.000Z",
          },
          {
            guildId: "guild-1",
            channelId: "media-1",
            userId: "user-1",
            date: "2026-05-14",
            messagesCount: 2,
            weightedMessagesCount: 1.4,
            sessionsCount: 0,
            effectiveSessionsCount: 0,
            firstMessageAt: "2026-05-14T11:00:00.000Z",
            lastMessageAt: "2026-05-14T11:05:00.000Z",
          },
          {
            guildId: "guild-1",
            channelId: "main-1",
            userId: "user-2",
            date: "2026-05-14",
            messagesCount: 10,
            weightedMessagesCount: 10,
            sessionsCount: 1,
            effectiveSessionsCount: 1,
            firstMessageAt: "2026-05-14T12:00:00.000Z",
            lastMessageAt: "2026-05-14T12:30:00.000Z",
          },
          {
            guildId: "guild-1",
            channelId: "main-1",
            userId: "user-3",
            date: "2026-05-14",
            messagesCount: 20,
            weightedMessagesCount: 20,
          },
        ],
      },
    },
  };

  const digest = collectActivityDigest({
    db,
    window: buildWindow(),
    config: { activity: { topMessagesCount: 1 } },
  });

  assert.equal(digest.sourceRowCount, 4);
  assert.equal(digest.activeUserCount, 3);
  assert.equal(digest.totalMessagesCount, 38);
  assert.deepEqual(digest.topMessageAuthors.map((entry) => [entry.userId, entry.displayName, entry.messagesCount]), [
    ["user-2", "Beta", 10],
  ]);
  assert.equal(digest.partial, true);
  assert.deepEqual(digest.partialReasons, ["activity_rows_without_precise_timestamps"]);
  assert.deepEqual(digest.candidateBuckets.map((entry) => [entry.userId, entry.bucket]), [
    ["user-1", "suppressed_by_threshold"],
    ["user-1", "suppressed_by_threshold"],
    ["user-2", "published_public"],
    ["user-3", "ambiguous_source"],
  ]);
});
