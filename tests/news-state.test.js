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
  assert.equal(config.voice.topCount, 5);
  assert.equal(config.voice.fullListFormat, "single_line");
  assert.equal(config.presentation.visualMode, "edition");
  assert.equal(config.presentation.postThreadEnabled, true);
});

test("createEmptyNewsState seeds raw capture and runtime scaffolds", () => {
  const state = createEmptyNewsState();

  assert.deepEqual(state.voice.openSessions, {});
  assert.deepEqual(state.voice.finalizedSessions, []);
  assert.deepEqual(state.moderation.events, []);
  assert.equal(state.runtime.lastCompiledDayKey, null);
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
      channels: {
        publicChannelId: " public-news ",
        staffChannelId: " staff-news ",
      },
      voice: {
        topCount: 10,
        fullListFormat: " line ",
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
    runtime: {
      lastCompiledDayKey: "2026-05-14",
      lastVoiceCaptureAt: "2026-05-14T20:59:00.000Z",
      errors: [{ scope: "voice", reason: "gap" }],
    },
  });

  assert.equal(state.config.enabled, true);
  assert.equal(state.config.schedule.publishHourMsk, 21);
  assert.equal(state.config.schedule.tickMinutes, 5);
  assert.equal(state.config.channels.publicChannelId, "public-news");
  assert.equal(state.config.voice.topCount, 10);
  assert.equal(state.config.voice.fullListFormat, "line");
  assert.equal(state.config.presentation.visualMode, "magazine");
  assert.equal(state.config.presentation.accentColor, "#ABC123");
  assert.equal(state.config.presentation.accentColorAlt, "#5DA9E9");
  assert.equal(state.voice.openSessions.user_1.channelId, "voice-1");
  assert.equal(state.voice.finalizedSessions[0].displayName, "Alpha");
  assert.equal(state.moderation.events[0].eventType, "ban");
  assert.equal(state.runtime.lastCompiledDayKey, "2026-05-14");
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