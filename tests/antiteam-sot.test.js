"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ensureSotState,
  normalizeSotState,
} = require("../src/sot/schema");

test("normalizeSotState preserves antiteam domain", () => {
  const sot = normalizeSotState({
    antiteam: {
      config: {
        channelId: "channel-1",
        battalionRoleId: "role-1",
      },
      tickets: {
        "ticket-1": {
          id: "ticket-1",
          status: "open",
          createdBy: "author-1",
          roblox: { userId: "101", username: "Anchor" },
        },
      },
      stats: {
        helpers: {
          "helper-1": { responded: 2, linkGranted: 1 },
        },
      },
    },
  });

  assert.equal(sot.antiteam.config.channelId, "channel-1");
  assert.equal(sot.antiteam.config.battalionRoleId, "role-1");
  assert.equal(sot.antiteam.tickets["ticket-1"].roblox.username, "Anchor");
  assert.equal(sot.antiteam.stats.helpers["helper-1"].responded, 2);
});

test("ensureSotState refreshFromLegacy keeps existing antiteam state", () => {
  const db = {
    config: {
      welcomePanel: {},
      nonGgsPanel: {},
      tierlistBoard: {},
      integrations: {},
    },
    sot: normalizeSotState({
      antiteam: {
        config: { channelId: "antiteam-channel" },
        tickets: {
          t1: { id: "t1", status: "open", createdBy: "author" },
        },
      },
    }),
  };

  const result = ensureSotState(db, { refreshFromLegacy: true });

  assert.equal(result.sot.antiteam.config.channelId, "antiteam-channel");
  assert.equal(result.sot.antiteam.tickets.t1.status, "open");
});
