"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { getSotReportIntegrationSnapshots } = require("../src/sot/report-integrations");

test("getSotReportIntegrationSnapshots prefers persisted SoT integration panel overrides while keeping legacy fallback fields", () => {
  const snapshots = getSotReportIntegrationSnapshots({
    db: {
      sot: {
        integrations: {
          elo: {
            status: "ready",
            lastSyncAt: "2026-05-05T12:00:00.000Z",
            submitPanel: {
              channelId: "elo-submit-sot",
            },
            graphicBoard: {
              channelId: "elo-graphic-sot",
            },
          },
          tierlist: {
            dashboard: {
              channelId: "tier-dashboard-sot",
            },
            summary: {
              channelId: "tier-summary-sot",
            },
          },
        },
      },
      config: {
        integrations: {
          elo: {
            status: "idle",
            mode: "import",
            sourcePath: "elo/db.json",
            lastImportAt: "2026-05-03T10:00:00.000Z",
            roleGrantEnabled: false,
            submitPanel: {
              channelId: "elo-submit-legacy",
              messageId: "elo-submit-message",
            },
            graphicBoard: {
              channelId: "elo-graphic-legacy",
              messageId: "elo-graphic-message",
              lastUpdated: "2026-05-04T10:00:00.000Z",
            },
          },
          tierlist: {
            status: "ready",
            sourcePath: "tierlist/state.json",
            dashboard: {
              channelId: "tier-dashboard-legacy",
              messageId: "tier-dashboard-message",
            },
            summary: {
              channelId: "tier-summary-legacy",
              messageId: "tier-summary-message",
            },
          },
        },
      },
    },
    appConfig: {},
  });

  assert.equal(snapshots.elo.status, "ready");
  assert.equal(snapshots.elo.sourcePath, "elo/db.json");
  assert.equal(snapshots.elo.roleGrantEnabled, false);
  assert.equal(snapshots.elo.submitPanel.channelId, "elo-submit-sot");
  assert.equal(snapshots.elo.submitPanel.messageId, "elo-submit-message");
  assert.equal(snapshots.elo.graphicBoard.channelId, "elo-graphic-sot");
  assert.equal(snapshots.elo.graphicBoard.messageId, "elo-graphic-message");
  assert.equal(snapshots.tierlist.dashboard.channelId, "tier-dashboard-sot");
  assert.equal(snapshots.tierlist.dashboard.messageId, "tier-dashboard-message");
  assert.equal(snapshots.tierlist.summary.channelId, "tier-summary-sot");
  assert.equal(snapshots.tierlist.summary.messageId, "tier-summary-message");
});

test("getSotReportIntegrationSnapshots falls back to normalized legacy integration state when db.sot is absent", () => {
  const snapshots = getSotReportIntegrationSnapshots({
    db: {
      config: {
        integrations: {
          elo: {
            status: "idle",
            mode: "import",
            sourcePath: "elo/db.json",
            submitPanel: {
              channelId: "elo-submit-legacy",
              messageId: "elo-submit-message",
            },
          },
          tierlist: {
            status: "ready",
            sourcePath: "tierlist/state.json",
            dashboard: {
              channelId: "tier-dashboard-legacy",
              messageId: "tier-dashboard-message",
            },
          },
        },
      },
    },
    appConfig: {},
  });

  assert.equal(snapshots.elo.status, "idle");
  assert.equal(snapshots.elo.submitPanel.channelId, "elo-submit-legacy");
  assert.equal(snapshots.elo.submitPanel.messageId, "elo-submit-message");
  assert.equal(snapshots.tierlist.status, "ready");
  assert.equal(snapshots.tierlist.dashboard.channelId, "tier-dashboard-legacy");
  assert.equal(snapshots.tierlist.dashboard.messageId, "tier-dashboard-message");
  assert.equal(snapshots.tierlist.summary.channelId, "");
});