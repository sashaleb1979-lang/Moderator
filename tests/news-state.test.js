"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createDefaultNewsConfig,
  createEmptyNewsState,
  ensureNewsState,
  normalizeNewsState,
} = require("../src/news/state");

test("createDefaultNewsConfig seeds edition-first defaults for daily digest", () => {
  const config = createDefaultNewsConfig();

  assert.equal(config.enabled, false);
  assert.equal(config.schedule.publishHourMsk, 21);
  assert.equal(config.publish.autoPublishEnabled, false);
  assert.equal(config.voice.topCount, 5);
  assert.equal(config.kills.topCount, 5);
  assert.equal(config.activity.topMessagesCount, 5);
  assert.equal(config.activity.topMoversCount, 3);
  assert.equal(config.newcomers.topCount, 8);
  assert.equal(config.gameplay.topCount, 5);
  assert.equal(config.tierlist.topCount, 5);
  assert.equal(config.voice.fullListFormat, "single_line");
  assert.equal(config.presentation.visualMode, "edition");
  assert.equal(config.presentation.postThreadEnabled, true);
});

test("createEmptyNewsState seeds raw capture and runtime scaffolds", () => {
  const state = createEmptyNewsState();

  assert.deepEqual(state.voice.openSessions, {});
  assert.deepEqual(state.voice.finalizedSessions, []);
  assert.deepEqual(state.moderation.events, []);
  assert.deepEqual(state.history.daySnapshots, {});
  assert.equal(state.runtime.lastCompiledDayKey, null);
  assert.equal(state.runtime.lastCompileStatus, null);
  assert.equal(state.runtime.lastPublishStartedAt, null);
  assert.equal(state.runtime.lastPublishFinishedAt, null);
  assert.equal(state.runtime.lastPublishResult, null);
  assert.deepEqual(state.runtime.errors, []);
});

test("normalizeNewsState normalizes config and preserves captured runtime slices", () => {
  const state = normalizeNewsState({
    config: {
      enabled: true,
      schedule: {
        publishHourMsk: 25,
        tickMinutes: 0,
      },
      publish: {
        autoPublishEnabled: true,
      },
      channels: {
        publicChannelId: " public-news ",
        staffChannelId: " staff-news ",
      },
      voice: {
        topCount: 10,
        fullListFormat: " line ",
      },
      activity: {
        topMoversCount: 5,
      },
      presentation: {
        visualMode: " magazine ",
        accentColor: "#abc123",
        accentColorAlt: "oops",
      },
    },
    voice: {
      openSessions: {
        user_1: { channelId: "voice-1", joinedAt: "2026-05-14T18:00:00.000Z" },
      },
      finalizedSessions: [{ userId: "user_1", displayName: "Alpha" }],
      lastPrunedAt: "2026-05-14T21:00:00.000Z",
    },
    moderation: {
      events: [{ userId: "user_2", eventType: "ban" }],
    },
    history: {
      daySnapshots: {
        "2026-05-13": {
          user_1: { activityScore: 41 },
        },
      },
    },
    runtime: {
      lastCompiledDayKey: "2026-05-14",
      lastCompileStatus: " shadow_compiled ",
      lastPublishStartedAt: "2026-05-14T20:55:00.000Z",
      lastPublishFinishedAt: "2026-05-14T21:00:30.000Z",
      lastPublishResult: {
        dayKey: " 2026-05-14 ",
        publishedAt: "2026-05-14T21:00:30.000Z",
        publishMode: " staff_only ",
        deliveryChannelId: " staff ",
        deliveryMessageId: " smoke-1 ",
        publicChannelId: "   ",
        publicMessageId: null,
        coverFileName: " daily-news-2026-05-14.png ",
        threadId: " thread-1 ",
        threadMessageCount: "2",
        staffChannelId: " staff ",
        staffMessageId: " audit-1 ",
      },
      lastVoiceCaptureAt: "2026-05-14T20:59:00.000Z",
      errors: [{ scope: "voice", reason: "gap" }],
    },
  });

  assert.equal(state.config.enabled, true);
  assert.equal(state.config.schedule.publishHourMsk, 21);
  assert.equal(state.config.schedule.tickMinutes, 5);
  assert.equal(state.config.publish.autoPublishEnabled, true);
  assert.equal(state.config.channels.publicChannelId, "public-news");
  assert.equal(state.config.voice.topCount, 10);
  assert.equal(state.config.voice.fullListFormat, "line");
  assert.equal(state.config.activity.topMoversCount, 5);
  assert.equal(state.config.presentation.visualMode, "magazine");
  assert.equal(state.config.presentation.accentColor, "#ABC123");
  assert.equal(state.config.presentation.accentColorAlt, "#5DA9E9");
  assert.equal(state.voice.openSessions.user_1.channelId, "voice-1");
  assert.equal(state.voice.finalizedSessions[0].displayName, "Alpha");
  assert.equal(state.moderation.events[0].eventType, "ban");
  assert.equal(state.history.daySnapshots["2026-05-13"].user_1.activityScore, 41);
  assert.equal(state.runtime.lastCompiledDayKey, "2026-05-14");
  assert.equal(state.runtime.lastCompileStatus, "shadow_compiled");
  assert.equal(state.runtime.lastPublishStartedAt, "2026-05-14T20:55:00.000Z");
  assert.equal(state.runtime.lastPublishFinishedAt, "2026-05-14T21:00:30.000Z");
  assert.deepEqual(state.runtime.lastPublishResult, {
    dayKey: "2026-05-14",
    publishedAt: "2026-05-14T21:00:30.000Z",
    publishMode: "staff_only",
    deliveryChannelId: "staff",
    deliveryMessageId: "smoke-1",
    publicChannelId: null,
    publicMessageId: null,
    coverFileName: "daily-news-2026-05-14.png",
    threadId: "thread-1",
    threadMessageCount: 2,
    staffChannelId: "staff",
    staffMessageId: "audit-1",
    warningCount: null,
    warnings: null,
  });
  assert.equal(state.runtime.lastVoiceCaptureAt, "2026-05-14T20:59:00.000Z");
  assert.deepEqual(state.runtime.errors, [{ scope: "voice", reason: "gap" }]);
});

test("ensureNewsState normalizes and memoizes db.sot.news", () => {
  const db = {
    sot: {
      news: {
        config: {
          channels: {
            publicChannelId: " daily-public ",
          },
        },
      },
    },
  };

  const first = ensureNewsState(db);
  const second = ensureNewsState(db);

  assert.equal(first, second);
  assert.equal(db.sot.news.config.channels.publicChannelId, "daily-public");
});