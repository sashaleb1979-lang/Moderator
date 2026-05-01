"use strict";

const test = require("node:test");
const assert = require("node:assert");

const {
  createDefaultIntegrationState,
  normalizeIntegrationState,
} = require("../src/integrations/shared-profile");

test("createDefaultIntegrationState defaults elo.roleGrantEnabled to true", () => {
  const state = createDefaultIntegrationState();
  assert.equal(state.elo.roleGrantEnabled, true);
});

test("normalizeIntegrationState preserves explicit roleGrantEnabled = false", () => {
  const { integrations } = normalizeIntegrationState({
    elo: { roleGrantEnabled: false, sourcePath: "/data/elo-db.json" },
  });
  assert.equal(integrations.elo.roleGrantEnabled, false);
  assert.equal(integrations.elo.sourcePath, "/data/elo-db.json");
});

test("normalizeIntegrationState defaults missing roleGrantEnabled to true", () => {
  const { integrations } = normalizeIntegrationState({ elo: {} });
  assert.equal(integrations.elo.roleGrantEnabled, true);
});

test("normalizeIntegrationState treats truthy non-false values as enabled", () => {
  const { integrations } = normalizeIntegrationState({ elo: { roleGrantEnabled: "true" } });
  assert.equal(integrations.elo.roleGrantEnabled, true);
});
