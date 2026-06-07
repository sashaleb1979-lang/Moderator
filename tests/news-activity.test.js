"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { collectActivityDigest } = require("../src/news/activity");

function buildWindow() {
  return {
    dayKey: "2026-05-14",
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
  assert.equal(digest.activeUserCount, 2);
  assert.equal(digest.sourceActiveUserCount, 3);
  assert.equal(digest.totalMessagesCount, 18);
  assert.equal(digest.sourceMessagesCount, 38);
  assert.deepEqual(digest.topMessageAuthors.map((entry) => [entry.userId, entry.displayName, entry.messagesCount]), [
    ["user-2", "Beta", 10],
  ]);
  assert.equal(digest.partial, true);
  assert.deepEqual(digest.partialReasons, ["activity_rows_without_precise_timestamps", "activity_rows_cross_publish_window_boundary"]);
  assert.deepEqual(digest.candidateBuckets.map((entry) => [entry.userId, entry.bucket]), [
    ["user-1", "suppressed_by_threshold"],
    ["user-1", "suppressed_by_threshold"],
    ["user-2", "published_public"],
    ["user-3", "ambiguous_source"],
  ]);
  assert.equal(digest.movers.available, false);
  assert.equal(digest.movers.reason, "no_daily_activity_baseline_yet");
});

test("collectActivityDigest prefers session rows over UTC daily aggregates for publish-window counts", () => {
  const db = {
    profiles: {
      "user-1": { displayName: "Alpha" },
      "user-2": { displayName: "Beta" },
    },
    sot: {
      activity: {
        globalUserSessions: [
          {
            id: "session-alpha",
            guildId: "guild-1",
            userId: "user-1",
            startedAt: "2026-05-14T10:00:00.000Z",
            endedAt: "2026-05-14T11:00:00.000Z",
            messageCount: 3869,
            weightedMessageCount: 3869,
            effectiveValue: 1,
            mainChannelId: "main-1",
            channelBreakdown: {
              "main-1": {
                channelId: "main-1",
                messageCount: 3869,
                weightedMessageCount: 3869,
                firstMessageAt: "2026-05-14T10:00:00.000Z",
                lastMessageAt: "2026-05-14T11:00:00.000Z",
              },
            },
          },
        ],
        userChannelDailyStats: [
          {
            guildId: "guild-1",
            channelId: "main-1",
            userId: "user-1",
            date: "2026-05-14",
            messagesCount: 11053,
            weightedMessagesCount: 11053,
            sessionsCount: 20,
            effectiveSessionsCount: 20,
            firstMessageAt: "2026-05-14T00:00:00.000Z",
            lastMessageAt: "2026-05-14T23:59:00.000Z",
          },
          {
            guildId: "guild-1",
            channelId: "main-1",
            userId: "user-2",
            date: "2026-05-13",
            messagesCount: 5000,
            weightedMessagesCount: 5000,
            sessionsCount: 5,
            effectiveSessionsCount: 5,
            firstMessageAt: "2026-05-13T20:00:00.000Z",
            lastMessageAt: "2026-05-13T23:30:00.000Z",
          },
        ],
      },
    },
  };

  const digest = collectActivityDigest({
    db,
    window: buildWindow(),
    config: { activity: { topMessagesCount: 5 } },
  });

  assert.equal(digest.sourceMode, "session");
  assert.equal(digest.sourceRowCount, 1);
  assert.equal(digest.totalMessagesCount, 3869);
  assert.deepEqual(digest.topMessageAuthors.map((entry) => [entry.userId, entry.messagesCount]), [
    ["user-1", 3869],
  ]);
});

test("collectActivityDigest keeps boundary-crossing activity rows out of public totals", () => {
  const db = {
    profiles: {
      "user-1": { displayName: "Alpha" },
      "user-2": { displayName: "Beta" },
    },
    sot: {
      activity: {
        userChannelDailyStats: [
          {
            guildId: "guild-1",
            channelId: "main-1",
            userId: "user-1",
            date: "2026-05-14",
            messagesCount: 100,
            weightedMessagesCount: 100,
            sessionsCount: 1,
            effectiveSessionsCount: 1,
            firstMessageAt: "2026-05-14T10:00:00.000Z",
            lastMessageAt: "2026-05-14T11:00:00.000Z",
          },
          {
            guildId: "guild-1",
            channelId: "main-1",
            userId: "user-2",
            date: "2026-05-13",
            messagesCount: 9000,
            weightedMessagesCount: 9000,
            sessionsCount: 3,
            effectiveSessionsCount: 3,
            firstMessageAt: "2026-05-13T20:30:00.000Z",
            lastMessageAt: "2026-05-13T21:30:00.000Z",
          },
        ],
      },
    },
  };

  const digest = collectActivityDigest({
    db,
    window: buildWindow(),
    config: { activity: { topMessagesCount: 5 } },
  });

  assert.equal(digest.totalMessagesCount, 100);
  assert.equal(digest.sourceMessagesCount, 9100);
  assert.deepEqual(digest.topMessageAuthors.map((entry) => [entry.userId, entry.messagesCount]), [
    ["user-1", 100],
  ]);
  assert.deepEqual(digest.partialReasons, ["activity_rows_without_precise_timestamps", "activity_rows_cross_publish_window_boundary"]);
  assert.equal(
    digest.candidateBuckets.some((entry) => entry.userId === "user-2" && entry.detail === "activity_row_crosses_publish_window_boundary"),
    true
  );
});

test("collectActivityDigest dedupes repeated daily rows with shifted timestamps", () => {
  const db = {
    profiles: {
      "user-1": { displayName: "Alpha" },
    },
    sot: {
      activity: {
        userChannelDailyStats: [
          {
            guildId: "guild-1",
            channelId: "main-1",
            userId: "user-1",
            date: "2026-05-14",
            messagesCount: 5405,
            weightedMessagesCount: 5405,
            sessionsCount: 18,
            effectiveSessionsCount: 18,
            firstMessageAt: "2026-05-14T10:00:00.000Z",
            lastMessageAt: "2026-05-14T18:00:00.000Z",
          },
          {
            guildId: "guild-1",
            channelId: "main-1",
            userId: "user-1",
            date: "2026-05-14",
            messagesCount: 5405,
            weightedMessagesCount: 5405,
            sessionsCount: 18,
            effectiveSessionsCount: 18,
            firstMessageAt: "2026-05-14T10:05:00.000Z",
            lastMessageAt: "2026-05-14T17:55:00.000Z",
          },
        ],
      },
    },
  };

  const digest = collectActivityDigest({
    db,
    window: buildWindow(),
    config: { activity: { topMessagesCount: 5 } },
  });

  assert.equal(digest.sourceRowCount, 1);
  assert.equal(digest.totalMessagesCount, 5405);
  assert.deepEqual(digest.topMessageAuthors.map((entry) => [entry.userId, entry.messagesCount, entry.sessionsCount]), [
    ["user-1", 5405, 18],
  ]);
});

test("collectActivityDigest derives daily activity movers from news-owned day snapshots", () => {
  const db = {
    profiles: {
      "user-1": {
        displayName: "Alpha",
        domains: {
          activity: {
            activityScore: 58,
            appliedActivityRoleKey: "active",
          },
        },
      },
      "user-2": {
        displayName: "Beta",
        domains: {
          activity: {
            activityScore: 31,
            appliedActivityRoleKey: "warm",
          },
        },
      },
      "user-3": {
        displayName: "Gamma",
        domains: {
          activity: {
            activityScore: 12,
            appliedActivityRoleKey: "cold",
          },
        },
      },
    },
    sot: {
      activity: {
        userChannelDailyStats: [],
      },
      news: {
        history: {
          daySnapshots: {
            "2026-05-13": {
              "user-1": {
                displayName: "Alpha",
                activityScore: 40,
                appliedActivityRoleKey: "warm",
              },
              "user-2": {
                displayName: "Beta",
                activityScore: 45,
                appliedActivityRoleKey: "active",
              },
              "user-3": {
                displayName: "Gamma",
                activityScore: 12,
                appliedActivityRoleKey: "cold",
              },
            },
          },
        },
      },
    },
  };

  const digest = collectActivityDigest({
    db,
    window: buildWindow(),
    config: { activity: { topMoversCount: 1 } },
  });

  assert.equal(digest.movers.available, true);
  assert.equal(digest.movers.baselineDayKey, "2026-05-13");
  assert.equal(digest.movers.comparedUserCount, 3);
  assert.equal(digest.movers.changedUserCount, 2);
  assert.deepEqual(digest.movers.up.map((entry) => [entry.userId, entry.delta, entry.roleChanged]), [
    ["user-1", 18, true],
  ]);
  assert.deepEqual(digest.movers.down.map((entry) => [entry.userId, entry.delta, entry.roleChanged]), [
    ["user-2", -14, true],
  ]);
});
