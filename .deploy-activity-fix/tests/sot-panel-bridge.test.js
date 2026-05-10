"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  syncLegacyGraphicTierlistBoardSnapshot,
  syncLegacyPanelSnapshot,
  syncLegacyTextTierlistBoardSnapshot,
} = require("../src/sot/legacy-bridge/panels");

test("syncLegacyPanelSnapshot overlays non-empty resolved panel fields onto mutable legacy state", () => {
  const state = {
    channelId: "legacy-channel",
    messageId: "legacy-message",
  };

  const result = syncLegacyPanelSnapshot(state, {
    channelId: "sot-channel",
    messageId: "sot-message",
  });

  assert.equal(result, state);
  assert.deepEqual(state, {
    channelId: "sot-channel",
    messageId: "sot-message",
  });
});

test("syncLegacyPanelSnapshot keeps existing legacy values when the resolved snapshot is empty", () => {
  const state = {
    channelId: "legacy-channel",
    messageId: "legacy-message",
  };

  syncLegacyPanelSnapshot(state, {
    channelId: "",
    messageId: "",
  });

  assert.deepEqual(state, {
    channelId: "legacy-channel",
    messageId: "legacy-message",
  });
});

test("syncLegacyTextTierlistBoardSnapshot clears legacy main once resolved split-layout ids exist", () => {
  const state = {
    channelId: "legacy-channel",
    messageId: "legacy-main",
    messageIdSummary: "legacy-summary",
    messageIdPages: "legacy-pages",
  };

  syncLegacyTextTierlistBoardSnapshot(state, {
    channelId: "sot-channel",
    messageId: "legacy-main",
    messageIdSummary: "sot-summary",
    messageIdPages: "sot-pages",
  });

  assert.deepEqual(state, {
    channelId: "sot-channel",
    messageId: "",
    messageIdSummary: "sot-summary",
    messageIdPages: "sot-pages",
  });
});

test("syncLegacyTextTierlistBoardSnapshot keeps only the legacy single-message id when split ids are absent", () => {
  const state = {
    channelId: "legacy-channel",
    messageId: "legacy-main",
    messageIdSummary: "legacy-summary",
    messageIdPages: "legacy-pages",
  };

  syncLegacyTextTierlistBoardSnapshot(state, {
    channelId: "sot-channel",
    messageId: "sot-main",
    messageIdSummary: "",
    messageIdPages: "",
  });

  assert.deepEqual(state, {
    channelId: "sot-channel",
    messageId: "sot-main",
    messageIdSummary: "",
    messageIdPages: "",
  });
});

test("syncLegacyGraphicTierlistBoardSnapshot does not overwrite legacy lastUpdated semantics", () => {
  const state = {
    channelId: "legacy-channel",
    messageId: "legacy-message",
    lastUpdated: 123456,
  };

  syncLegacyGraphicTierlistBoardSnapshot(state, {
    channelId: "sot-channel",
    messageId: "sot-message",
    lastUpdated: "2026-05-04T12:00:00.000Z",
  });

  assert.deepEqual(state, {
    channelId: "sot-channel",
    messageId: "sot-message",
    lastUpdated: 123456,
  });
});