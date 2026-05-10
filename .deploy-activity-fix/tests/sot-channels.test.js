"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { resolveAllChannelRecords, resolveChannelRecord } = require("../src/sot/resolver/channels");

function createContext(overrides = {}) {
  return {
    db: overrides.db || {
      config: {
        welcomePanel: { channelId: "welcome-panel" },
        reviewChannelId: "review-manual",
        tierlistBoard: {
          text: { channelId: "tier-text-panel" },
          graphic: { channelId: "tier-graphic-panel" },
        },
        notificationChannelId: "log-manual",
        integrations: {
          elo: {
            submitPanel: { channelId: "elo-submit-panel" },
            graphicBoard: { channelId: "elo-graphic-panel" },
          },
          tierlist: {
            dashboard: { channelId: "tier-dashboard-panel" },
            summary: { channelId: "tier-summary-panel" },
          },
        },
      },
    },
    appConfig: overrides.appConfig || {
      channels: {
        welcomeChannelId: "welcome-config",
        reviewChannelId: "review-config",
        tierlistChannelId: "tier-config",
        logChannelId: "log-config",
      },
    },
  };
}

test("resolveChannelRecord prefers persisted db.sot records over legacy and configured values", () => {
  const context = createContext({
    db: {
      sot: {
        channels: {
          review: { value: "review-sot", source: "manual", verifiedAt: "2026-05-03T12:00:00.000Z" },
        },
      },
      config: {
        reviewChannelId: "review-manual",
      },
    },
  });

  assert.deepEqual(resolveChannelRecord({ slot: "review", ...context }), {
    value: "review-sot",
    source: "manual",
    verifiedAt: "2026-05-03T12:00:00.000Z",
  });
});

test("resolveChannelRecord falls back to legacy manual values and keeps configured source when value matches config", () => {
  const context = createContext();

  assert.deepEqual(resolveChannelRecord({ slot: "review", ...context }), {
    value: "review-manual",
    source: "manual",
    verifiedAt: null,
  });
  assert.deepEqual(resolveChannelRecord({
    slot: "welcome",
    db: {
      config: {
        welcomePanel: { channelId: "welcome-config" },
      },
    },
    appConfig: context.appConfig,
  }), {
    value: "welcome-config",
    source: "configured",
    verifiedAt: null,
  });
});

test("resolveChannelRecord falls back to configured values when legacy state is absent", () => {
  const result = resolveChannelRecord({
    slot: "log",
    db: { config: {} },
    appConfig: {
      channels: {
        logChannelId: "log-config",
      },
    },
  });

  assert.deepEqual(result, {
    value: "log-config",
    source: "configured",
    verifiedAt: null,
  });
});

test("resolveChannelRecord prefers resolver-backed integration panel channels over stale compat shadow", () => {
  const result = resolveChannelRecord({
    slot: "eloSubmit",
    db: {
      config: {
        integrations: {
          elo: {
            submitPanel: { channelId: "elo-submit-stale" },
          },
        },
      },
      sot: {
        integrations: {
          elo: {
            submitPanel: { channelId: "elo-submit-sot" },
          },
        },
      },
    },
    appConfig: {},
  });

  assert.deepEqual(result, {
    value: "elo-submit-sot",
    source: "manual",
    verifiedAt: null,
  });
});

test("resolveAllChannelRecords returns every configured slot", () => {
  const result = resolveAllChannelRecords(createContext());

  assert.equal(result.welcome.value, "welcome-panel");
  assert.equal(result.tierlistText.value, "tier-text-panel");
  assert.equal(result.tierlistGraphic.value, "tier-graphic-panel");
  assert.equal(result.eloSubmit.value, "elo-submit-panel");
  assert.equal(result.tierlistSummary.value, "tier-summary-panel");
});