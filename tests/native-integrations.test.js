"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  clearNativeIntegrationSourcePath,
  normalizeIntegrationSlot,
  writeNativeIntegrationSnapshot,
  writeNativeIntegrationRoleGrantEnabled,
  writeNativeIntegrationSourcePath,
} = require("../src/sot/native-integrations");

test("normalizeIntegrationSlot accepts only supported integration slots", () => {
  assert.equal(normalizeIntegrationSlot("elo"), "elo");
  assert.equal(normalizeIntegrationSlot("tierlist"), "tierlist");
  assert.equal(normalizeIntegrationSlot("unknown"), "");
});

test("writeNativeIntegrationSourcePath stores a persisted SoT sourcePath override", () => {
  const db = {};

  const result = writeNativeIntegrationSourcePath(db, {
    slot: "elo",
    sourcePath: "elo/custom-db.json",
  });

  assert.equal(result.mutated, true);
  assert.equal(db.sot.integrations.elo.sourcePath, "elo/custom-db.json");
  assert.equal(db.config.integrations.elo.sourcePath, "elo/custom-db.json");
});

test("clearNativeIntegrationSourcePath clears a persisted SoT sourcePath override", () => {
  const db = {
    sot: {
      integrations: {
        tierlist: {
          sourcePath: "tierlist/custom-state.json",
        },
      },
    },
  };

  const result = clearNativeIntegrationSourcePath(db, { slot: "tierlist" });

  assert.equal(result.mutated, true);
  assert.equal(db.sot.integrations.tierlist.sourcePath, "");
  assert.equal(db.config.integrations.tierlist.sourcePath, "");
});

test("writeNativeIntegrationRoleGrantEnabled keeps SoT and compat shadow aligned", () => {
  const db = {};

  const result = writeNativeIntegrationRoleGrantEnabled(db, {
    slot: "elo",
    value: false,
  });

  assert.equal(result.mutated, true);
  assert.equal(db.sot.integrations.elo.roleGrantEnabled, false);
  assert.equal(db.config.integrations.elo.roleGrantEnabled, false);
});

test("writeNativeIntegrationSnapshot mirrors nested integration snapshots into SoT and compat shadow", () => {
  const db = {};

  const result = writeNativeIntegrationSnapshot(db, {
    slot: "tierlist",
    patch: {
      status: "in_progress",
      dashboard: { channelId: "dash-1", messageId: "dash-msg" },
      summary: { channelId: "sum-1", messageId: "sum-msg" },
    },
  });

  assert.equal(result.mutated, true);
  assert.equal(db.sot.integrations.tierlist.dashboard.channelId, "dash-1");
  assert.equal(db.config.integrations.tierlist.summary.messageId, "sum-msg");
});