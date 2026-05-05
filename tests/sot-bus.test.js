"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { collectSotChanges, createSotBus } = require("../src/sot/bus");
const { createCharacterRecord, createEmptySotState, createRecord } = require("../src/sot/schema");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("collectSotChanges returns deterministic domain and key pairs for changed SoT entries", () => {
  const previous = createEmptySotState();
  const next = clone(previous);

  next.channels.review = createRecord("review-channel", "manual");
  next.characters.honored_one = createCharacterRecord({
    id: "honored_one",
    label: "Годжо",
    englishLabel: "Honored One",
    roleId: "role-gojo",
    source: "manual",
  });
  next.presentation.welcome = { title: "Welcome" };

  const changes = collectSotChanges(previous, next);

  assert.deepEqual(changes.map((entry) => `${entry.domain}:${entry.key}`), [
    "channels:review",
    "characters:honored_one",
    "presentation:welcome",
  ]);
});

test("createSotBus publishes per-change and batch events", () => {
  const previous = createEmptySotState();
  const next = clone(previous);
  next.roles.moderator = createRecord("moderator-role", "manual");

  const bus = createSotBus();
  const seen = [];
  let batch = null;

  bus.on("change", (event) => {
    seen.push(`${event.domain}:${event.key}:${event.reason}`);
  });
  bus.on("batch", (event) => {
    batch = event;
  });

  const changes = bus.publishChanges({
    previousState: previous,
    nextState: next,
    reason: "save",
  });

  assert.equal(changes.length, 1);
  assert.deepEqual(seen, ["roles:moderator:save"]);
  assert.equal(batch.reason, "save");
  assert.equal(batch.changes.length, 1);
});