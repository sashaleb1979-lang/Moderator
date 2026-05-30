"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PROFILE_SUBMIT_ACTIONS,
  PROFILE_SUBMIT_CANCEL_CUSTOM_ID,
  buildProfileEloSubmitCapturePayload,
  buildProfileKillsSubmitCapturePayload,
  buildProfileSubmitCancelledPayload,
  createProfileSubmitCaptureStore,
} = require("../src/profile/submit-capture");

test("profile submit capture store scopes sessions by user, channel and five minute expiry", () => {
  const store = createProfileSubmitCaptureStore({ ttlMs: 5 * 60 * 1000 });
  const session = store.start("user-1", {
    action: PROFILE_SUBMIT_ACTIONS.KILLS,
    channelId: "channel-1",
    sourceMessageId: "message-1",
    nowMs: 1000,
  });

  assert.equal(session.userId, "user-1");
  assert.equal(session.action, "kills");
  assert.equal(session.channelId, "channel-1");
  assert.equal(session.expiresAtMs, 301000);
  assert.equal(store.get("user-1", { nowMs: 300999 }).channelId, "channel-1");
  assert.equal(store.get("user-1", { nowMs: 301000 }), null);
  assert.equal(store.peek("user-1"), null);
});

test("profile submit capture store starts live sessions when nowMs is omitted", () => {
  const store = createProfileSubmitCaptureStore({ ttlMs: 5 * 60 * 1000 });
  const session = store.start("user-live", {
    action: PROFILE_SUBMIT_ACTIONS.ELO,
    channelId: "channel-live",
  });

  assert.equal(session.userId, "user-live");
  assert.equal(store.get("user-live")?.channelId, "channel-live");
});

test("profile submit capture payloads explain next-message flow and expose cancel", () => {
  const killsPayload = buildProfileKillsSubmitCapturePayload({
    channelText: "<#profile-chat>",
    mainsText: "Gojo, Sukuna",
  });
  const eloPayload = buildProfileEloSubmitCapturePayload({ channelText: "<#profile-chat>" });

  const killsText = JSON.stringify(killsPayload.embeds[0].toJSON());
  const eloText = JSON.stringify(eloPayload.embeds[0].toJSON());
  assert.match(killsText, /Следующее сообщение/);
  assert.match(killsText, /одно точное число kills/);
  assert.match(killsText, /5 минут/);
  assert.equal(killsPayload.components[0].toJSON().components[0].custom_id, PROFILE_SUBMIT_CANCEL_CUSTOM_ID);
  assert.match(eloText, /ELO-заявку/);
  assert.equal(eloPayload.components[0].toJSON().components[0].custom_id, PROFILE_SUBMIT_CANCEL_CUSTOM_ID);
});

test("profile submit cancel payload clears components", () => {
  const payload = buildProfileSubmitCancelledPayload(PROFILE_SUBMIT_ACTIONS.ELO);
  assert.match(payload.content, /ELO/);
  assert.deepEqual(payload.components, []);
});
