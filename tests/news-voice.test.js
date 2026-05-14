"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { recordVoiceStateTransition } = require("../src/news/voice");

function createStateFixture(overrides = {}) {
  return {
    guild: { id: overrides.guildId || "guild-1" },
    channelId: Object.prototype.hasOwnProperty.call(overrides, "channelId") ? overrides.channelId : null,
    member: {
      id: overrides.userId || "user-1",
      displayName: overrides.displayName || "Alpha",
      user: {
        username: overrides.username || "alpha_user",
      },
    },
  };
}

test("recordVoiceStateTransition opens a tracked voice session on join", () => {
  const db = {};

  const result = recordVoiceStateTransition({
    db,
    oldState: createStateFixture({ channelId: null }),
    newState: createStateFixture({ channelId: "voice-main" }),
    now: "2026-05-14T18:00:00.000Z",
  });

  assert.equal(result.action, "join");
  assert.equal(db.sot.news.voice.openSessions["user-1"].currentChannelId, "voice-main");
  assert.equal(db.sot.news.voice.openSessions["user-1"].displayName, "Alpha");
  assert.deepEqual(db.sot.news.voice.openSessions["user-1"].enteredChannelIds, ["voice-main"]);
});

test("recordVoiceStateTransition updates an open session on channel move", () => {
  const db = {};

  recordVoiceStateTransition({
    db,
    oldState: createStateFixture({ channelId: null }),
    newState: createStateFixture({ channelId: "voice-main" }),
    now: "2026-05-14T18:00:00.000Z",
  });
  const result = recordVoiceStateTransition({
    db,
    oldState: createStateFixture({ channelId: "voice-main" }),
    newState: createStateFixture({ channelId: "voice-side" }),
    now: "2026-05-14T18:15:00.000Z",
  });

  assert.equal(result.action, "move");
  assert.equal(db.sot.news.voice.openSessions["user-1"].currentChannelId, "voice-side");
  assert.equal(db.sot.news.voice.openSessions["user-1"].moveCount, 1);
  assert.deepEqual(db.sot.news.voice.openSessions["user-1"].enteredChannelIds, ["voice-main", "voice-side"]);
});

test("recordVoiceStateTransition finalizes a tracked voice session on leave", () => {
  const db = {};

  recordVoiceStateTransition({
    db,
    oldState: createStateFixture({ channelId: null }),
    newState: createStateFixture({ channelId: "voice-main" }),
    now: "2026-05-14T18:00:00.000Z",
  });
  const result = recordVoiceStateTransition({
    db,
    oldState: createStateFixture({ channelId: "voice-main" }),
    newState: createStateFixture({ channelId: null }),
    now: "2026-05-14T18:45:30.000Z",
  });

  assert.equal(result.action, "leave");
  assert.equal(db.sot.news.voice.openSessions["user-1"], undefined);
  assert.equal(db.sot.news.voice.finalizedSessions.length, 1);
  assert.equal(db.sot.news.voice.finalizedSessions[0].displayName, "Alpha");
  assert.equal(db.sot.news.voice.finalizedSessions[0].durationSeconds, 2730);
});

test("recordVoiceStateTransition recovers a leave without open session as incomplete coverage", () => {
  const db = {};

  const result = recordVoiceStateTransition({
    db,
    oldState: createStateFixture({ channelId: "voice-main", displayName: "RecoveredAlpha" }),
    newState: createStateFixture({ channelId: null, displayName: "RecoveredAlpha" }),
    now: "2026-05-14T19:00:00.000Z",
  });

  assert.equal(result.action, "leave_recovered");
  assert.equal(db.sot.news.voice.finalizedSessions.length, 1);
  assert.equal(db.sot.news.voice.finalizedSessions[0].incomplete, true);
  assert.equal(db.sot.news.voice.finalizedSessions[0].incompleteReason, "missing_open_session");
  assert.equal(db.sot.news.voice.finalizedSessions[0].durationSeconds, 0);
});

test("recordVoiceStateTransition ignores non-channel voice updates", () => {
  const db = {};

  const result = recordVoiceStateTransition({
    db,
    oldState: createStateFixture({ channelId: "voice-main" }),
    newState: createStateFixture({ channelId: "voice-main" }),
    now: "2026-05-14T19:00:00.000Z",
  });

  assert.equal(result.captured, false);
  assert.equal(result.reason, "channel_unchanged");
  assert.equal(db.sot.news.voice.finalizedSessions.length, 0);
});