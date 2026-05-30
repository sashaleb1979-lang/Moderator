"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  HELPER_INTAKE_ACTIONS,
  HELPER_INTAKE_SESSION_EXPIRE_MS,
  SUBMIT_INTAKE_ACTIONS,
  SUBMIT_INTAKE_SESSION_TTL_MS,
  SUBMIT_INTAKE_SOURCES,
  createHelperIntakeSessionStore,
  createSubmitIntakeSessionStore,
  isHelperIntakeSessionExpired,
  isSubmitIntakeSessionExpired,
  normalizeHelperIntakeSession,
  normalizeSubmitIntakeSource,
} = require("../src/onboard/helper-intake");

test("helper intake session store normalizes and matches armed sessions", () => {
  const store = createHelperIntakeSessionStore();
  const created = store.set("user-1", {
    action: HELPER_INTAKE_ACTIONS.kills,
    source: SUBMIT_INTAKE_SOURCES.helper,
    channelId: " channel-1 ",
    rawText: " 3120 kills ",
  });

  assert.equal(created.action, HELPER_INTAKE_ACTIONS.kills);
  assert.equal(created.source, SUBMIT_INTAKE_SOURCES.helper);
  assert.equal(created.channelId, "channel-1");
  assert.equal(created.rawText, "3120 kills");
  assert.equal(store.matches("user-1", { action: "kills", channelId: "channel-1" }), true);
  assert.equal(store.matches("user-1", { action: "elo", channelId: "channel-1" }), false);
  assert.equal(store.matches("user-1", { action: "kills", channelId: "channel-2" }), false);
});

test("helper intake session store expires sessions after five minutes by default", () => {
  const now = Date.parse("2026-05-30T12:00:00.000Z");
  const store = createHelperIntakeSessionStore();
  store.set("user-1", {
    action: HELPER_INTAKE_ACTIONS.elo,
    channelId: "channel-1",
    createdAt: now,
  });

  const active = store.get("user-1", { now: now + HELPER_INTAKE_SESSION_EXPIRE_MS - 1 });
  assert.equal(Boolean(active), true);

  const expired = store.get("user-1", { now: now + HELPER_INTAKE_SESSION_EXPIRE_MS + 1 });
  assert.equal(expired, null);
});

test("helper intake session helpers treat incomplete sessions as expired", () => {
  const incomplete = normalizeHelperIntakeSession({ action: "kills", channelId: "channel-1" });
  assert.equal(isHelperIntakeSessionExpired(incomplete), true);
});

test("submit intake aliases preserve the helper store contract and normalize source", () => {
  const store = createSubmitIntakeSessionStore();
  const created = store.set("user-2", {
    action: SUBMIT_INTAKE_ACTIONS.elo,
    source: " profile ",
    channelId: " channel-2 ",
    rawText: " 1234 elo ",
  });

  assert.equal(SUBMIT_INTAKE_SESSION_TTL_MS, HELPER_INTAKE_SESSION_EXPIRE_MS);
  assert.equal(created.action, HELPER_INTAKE_ACTIONS.elo);
  assert.equal(created.source, SUBMIT_INTAKE_SOURCES.profile);
  assert.equal(normalizeSubmitIntakeSource(" welcome "), SUBMIT_INTAKE_SOURCES.welcome);
  assert.equal(isSubmitIntakeSessionExpired({ action: "elo", channelId: "channel-2" }), true);
  assert.deepEqual(store.get("user-2"), {
    action: HELPER_INTAKE_ACTIONS.elo,
    source: SUBMIT_INTAKE_SOURCES.profile,
    channelId: "channel-2",
    rawText: "1234 elo",
    createdAt: created.createdAt,
  });
});