"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { resolveAllPanelRecords, resolvePanelRecord } = require("../src/sot/resolver/panels");
const {
  clearNativePanelRecord,
  normalizePanelSlot,
  writeNativePanelRecord,
} = require("../src/sot/native-panels");

function createContext(overrides = {}) {
  return {
    db: overrides.db || {
      config: {
        welcomePanel: {
          channelId: "welcome-channel",
          messageId: "welcome-message",
        },
        tierlistBoard: {
          text: {
            channelId: "tier-text-channel",
            messageId: "tier-main-message",
            messageIdSummary: "tier-summary-message",
            messageIdPages: "tier-pages-message",
          },
          graphic: {
            channelId: "tier-graphic-channel",
            messageId: "tier-graphic-message",
          },
        },
        integrations: {
          elo: {
            submitPanel: {
              channelId: "elo-submit-channel",
              messageId: "elo-submit-message",
            },
            graphicBoard: {
              channelId: "elo-graphic-channel",
              messageId: "elo-graphic-message",
            },
          },
        },
      },
    },
    appConfig: overrides.appConfig || {},
  };
}

test("resolvePanelRecord prefers persisted db.sot values and falls back per field to legacy slots", () => {
  const base = createContext();
  const result = resolvePanelRecord({
    slot: "tierlistText",
    db: {
      sot: {
        panels: {
          tierlistText: {
            channelId: { value: "tier-sot-channel", source: "manual", verifiedAt: "2026-05-03T12:00:00.000Z" },
            messageIds: {
              summary: { value: "tier-sot-summary", source: "manual" },
            },
            lastUpdated: "2026-05-03T12:30:00.000Z",
          },
        },
      },
      config: base.db.config,
    },
    appConfig: base.appConfig,
  });

  assert.equal(result.channelId.value, "tier-sot-channel");
  assert.equal(result.channelId.verifiedAt, "2026-05-03T12:00:00.000Z");
  assert.equal(result.messageIds.summary.value, "tier-sot-summary");
  assert.equal(result.messageIds.main, null);
  assert.equal(result.messageIds.pages.value, "tier-pages-message");
  assert.equal(result.lastUpdated, "2026-05-03T12:30:00.000Z");
});

test("resolvePanelRecord falls back to legacy panel snapshots when db.sot is absent", () => {
  const result = resolvePanelRecord({
    slot: "welcome",
    ...createContext(),
  });

  assert.equal(result.channelId.value, "welcome-channel");
  assert.equal(result.messageIds.main.value, "welcome-message");
});

test("resolveAllPanelRecords returns every tracked panel slot", () => {
  const result = resolveAllPanelRecords(createContext());

  assert.equal(result.tierlistGraphic.messageIds.main.value, "tier-graphic-message");
  assert.equal(result.eloSubmit.channelId.value, "elo-submit-channel");
  assert.equal(result.nonGgs.channelId, null);
});

test("writeNativePanelRecord stores manual welcome panel override and resolvePanelRecord prefers it", () => {
  const context = createContext();

  const result = writeNativePanelRecord(context.db, {
    slot: "welcome",
    channelId: "welcome-manual-channel",
    source: "manual",
    lastUpdated: "2026-05-05T10:00:00.000Z",
  });

  assert.equal(result.mutated, true);
  assert.equal(result.record.channelId.value, "welcome-manual-channel");
  assert.equal(result.record.channelId.source, "manual");
  assert.equal(result.record.lastUpdated, "2026-05-05T10:00:00.000Z");
  assert.equal(result.record.channelId.evidence.nativeWriter, true);
  assert.equal(result.record.channelId.evidence.manualOverride, true);

  const resolved = resolvePanelRecord({ slot: "welcome", ...context });
  assert.equal(resolved.channelId.value, "welcome-manual-channel");
  assert.equal(resolved.messageIds.main.value, "welcome-message");
});

test("writeNativePanelRecord stores manual eloSubmit override and resolvePanelRecord prefers it", () => {
  const context = createContext();

  const result = writeNativePanelRecord(context.db, {
    slot: "eloSubmit",
    channelId: "elo-submit-manual-channel",
    source: "manual",
    lastUpdated: "2026-05-05T10:30:00.000Z",
  });

  assert.equal(result.mutated, true);
  assert.equal(result.record.channelId.value, "elo-submit-manual-channel");

  const resolved = resolvePanelRecord({ slot: "eloSubmit", ...context });
  assert.equal(resolved.channelId.value, "elo-submit-manual-channel");
  assert.equal(resolved.messageIds.main.value, "elo-submit-message");
});

test("writeNativePanelRecord stores manual eloGraphic override and resolvePanelRecord prefers it", () => {
  const context = createContext();

  const result = writeNativePanelRecord(context.db, {
    slot: "eloGraphic",
    channelId: "elo-graphic-manual-channel",
    source: "manual",
    lastUpdated: "2026-05-05T10:40:00.000Z",
  });

  assert.equal(result.mutated, true);
  assert.equal(result.record.channelId.value, "elo-graphic-manual-channel");

  const resolved = resolvePanelRecord({ slot: "eloGraphic", ...context });
  assert.equal(resolved.channelId.value, "elo-graphic-manual-channel");
  assert.equal(resolved.messageIds.main.value, "elo-graphic-message");
});

test("writeNativePanelRecord stores manual tierlistSummary override and resolvePanelRecord prefers it", () => {
  const context = createContext({
    db: {
      config: {
        integrations: {
          tierlist: {
            summary: {
              channelId: "tier-summary-channel",
            },
          },
        },
      },
    },
  });

  const result = writeNativePanelRecord(context.db, {
    slot: "summary",
    channelId: "tier-summary-manual-channel",
    source: "manual",
    lastUpdated: "2026-05-05T11:00:00.000Z",
  });

  assert.equal(result.mutated, true);
  assert.equal(result.record.channelId.value, "tier-summary-manual-channel");

  const resolved = resolvePanelRecord({ slot: "tierlistSummary", ...context });
  assert.equal(resolved.channelId.value, "tier-summary-manual-channel");
  assert.equal(resolved.messageIds.main, null);
});

test("clearNativePanelRecord removes manual nonGgs panel override and falls back to legacy state", () => {
  const context = createContext({
    db: {
      config: {
        nonGgsPanel: {
          channelId: "captcha-legacy-channel",
          messageId: "captcha-legacy-message",
        },
      },
    },
  });

  writeNativePanelRecord(context.db, {
    slot: "nonGgs",
    channelId: "captcha-manual-channel",
    source: "manual",
  });

  const result = clearNativePanelRecord(context.db, { slot: "nonGgs" });
  assert.equal(result.mutated, true);
  assert.equal(context.db.sot.panels.nonGgs, null);

  const resolved = resolvePanelRecord({ slot: "nonGgs", ...context });
  assert.equal(resolved.channelId.value, "captcha-legacy-channel");
  assert.equal(resolved.messageIds.main.value, "captcha-legacy-message");
});

test("normalizePanelSlot accepts nonJjs aliases and rejects unsupported slots", () => {
  assert.deepEqual(normalizePanelSlot("non-ggs"), {
    canonical: "nonGgs",
    label: "non-JJS panel",
  });
  assert.deepEqual(normalizePanelSlot("captcha"), {
    canonical: "nonGgs",
    label: "non-JJS panel",
  });
  assert.deepEqual(normalizePanelSlot("eloSubmit"), {
    canonical: "eloSubmit",
    label: "Legacy ELO submit panel",
  });
  assert.deepEqual(normalizePanelSlot("eloGraphic"), {
    canonical: "eloGraphic",
    label: "Legacy ELO graphic panel",
  });
  assert.deepEqual(normalizePanelSlot("dashboard"), {
    canonical: "tierlistDashboard",
    label: "Legacy Tierlist dashboard panel",
  });
  assert.deepEqual(normalizePanelSlot("summary"), {
    canonical: "tierlistSummary",
    label: "Legacy Tierlist summary panel",
  });
  assert.equal(normalizePanelSlot("tierlistText"), null);
});