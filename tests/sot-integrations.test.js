"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { resolveAllIntegrationRecords, resolveIntegrationRecord } = require("../src/sot/resolver/integrations");

function createContext(overrides = {}) {
  return {
    db: overrides.db || {
      config: {
        integrations: {
          elo: {
            status: "idle",
            mode: "import",
            sourcePath: "elo/db.json",
            lastImportAt: "2026-05-03T10:00:00.000Z",
            roleGrantEnabled: false,
            submitPanel: {
              channelId: "elo-submit-channel",
              messageId: "elo-submit-message",
            },
          },
          tierlist: {
            status: "ready",
            sourcePath: "tierlist/state.json",
            dashboard: {
              channelId: "tierlist-dashboard-channel",
              messageId: "tierlist-dashboard-message",
            },
          },
        },
      },
    },
    appConfig: overrides.appConfig || {},
  };
}

test("resolveIntegrationRecord prefers persisted db.sot values while keeping legacy fields as fallback", () => {
  const base = createContext();
  const result = resolveIntegrationRecord({
    slot: "elo",
    db: {
      sot: {
        integrations: {
          elo: {
            status: "ready",
            lastSyncAt: "2026-05-03T12:00:00.000Z",
            submitPanel: {
              channelId: "elo-submit-sot",
            },
          },
        },
      },
      config: base.db.config,
    },
    appConfig: base.appConfig,
  });

  assert.equal(result.status, "ready");
  assert.equal(result.sourcePath, "elo/db.json");
  assert.equal(result.roleGrantEnabled, false);
  assert.equal(result.submitPanel.channelId, "elo-submit-sot");
  assert.equal(result.submitPanel.messageId, "elo-submit-message");
});

test("resolveAllIntegrationRecords returns both integration slots", () => {
  const result = resolveAllIntegrationRecords(createContext());

  assert.equal(result.elo.status, "idle");
  assert.equal(result.tierlist.dashboard.channelId, "tierlist-dashboard-channel");
});