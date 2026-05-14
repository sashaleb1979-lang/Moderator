"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_LEGACY_ELO_GRAPHIC_MESSAGE_TEXT,
  DEFAULT_LEGACY_ELO_GRAPHIC_TITLE,
  DEFAULT_LEGACY_ELO_TIER_LABELS,
  applyLegacyEloGraphicImageDelta,
  buildLegacyEloGraphicEntries,
  buildLegacyEloGraphicPanelSnapshot,
  buildLegacyEloGraphicStatusLines,
  ensureLegacyEloGraphicState,
  normalizeLegacyEloGraphicHexColor,
  resetAllLegacyEloGraphicTierColors,
  resetLegacyEloGraphicImageOverrides,
  resetLegacyEloGraphicTierColor,
  setLegacyEloGraphicDashboardChannel,
  setLegacyEloGraphicMessageText,
  setLegacyEloGraphicSelectedTier,
  setLegacyEloGraphicTierColor,
  setLegacyEloGraphicTitle,
  setLegacyEloTierLabel,
  setLegacyEloTierLabels,
} = require("../src/integrations/elo-graphic");

test("ensureLegacyEloGraphicState fills defaults and normalizes persisted values", () => {
  const rawDb = {
    config: {
      graphicTierlist: {
        title: "",
        dashboardChannelId: "123",
        dashboardMessageId: "456",
        lastUpdated: 1714564800000,
        image: { width: "2100", height: "1300", icon: "96" },
        tierColors: { 5: "FF6B6B", 4: "#ff9f43" },
        panel: { selectedTier: "4" },
      },
    },
  };

  const state = ensureLegacyEloGraphicState(rawDb);

  assert.equal(state.title, DEFAULT_LEGACY_ELO_GRAPHIC_TITLE);
  assert.equal(state.messageText, DEFAULT_LEGACY_ELO_GRAPHIC_MESSAGE_TEXT);
  assert.equal(state.dashboardChannelId, "123");
  assert.equal(state.dashboardMessageId, "456");
  assert.equal(state.lastUpdated, "2024-05-01T12:00:00.000Z");
  assert.equal(state.image.width, 2100);
  assert.equal(state.image.height, 1300);
  assert.equal(state.image.icon, 96);
  assert.equal(state.tierColors[5], "#ff6b6b");
  assert.equal(state.tierColors[4], "#ff9f43");
  assert.equal(state.panel.selectedTier, 4);
  assert.equal(state.tierColors[6], undefined);
  assert.deepEqual(rawDb.config.tierLabels, DEFAULT_LEGACY_ELO_TIER_LABELS);
});

test("legacy ELO graphic mutations update labels, colors, image config, and dashboard state", () => {
  const rawDb = { config: {} };

  assert.equal(setLegacyEloGraphicTitle(rawDb, "Ranked ELO"), true);
  assert.equal(setLegacyEloGraphicMessageText(rawDb, "PNG panel text"), true);
  assert.equal(setLegacyEloGraphicSelectedTier(rawDb, 3), true);
  assert.equal(setLegacyEloGraphicDashboardChannel(rawDb, "999"), true);
  assert.equal(setLegacyEloTierLabel(rawDb, 3, "Mid"), true);
  assert.equal(setLegacyEloTierLabels(rawDb, { 1: "Bronze", 2: "Silver", 3: "Gold", 4: "Diamond", 5: "Legend" }), true);
  assert.equal(setLegacyEloGraphicTierColor(rawDb, 5, "ff00aa"), true);
  assert.equal(normalizeLegacyEloGraphicHexColor("#ABCDEF"), "#abcdef");
  assert.equal(normalizeLegacyEloGraphicHexColor("xyz"), null);

  applyLegacyEloGraphicImageDelta(rawDb, "width", 300);
  applyLegacyEloGraphicImageDelta(rawDb, "height", -100);
  applyLegacyEloGraphicImageDelta(rawDb, "icon", 24);

  assert.equal(rawDb.config.graphicTierlist.title, "Ranked ELO");
  assert.equal(rawDb.config.graphicTierlist.messageText, "PNG panel text");
  assert.equal(rawDb.config.graphicTierlist.panel.selectedTier, 3);
  assert.equal(rawDb.config.graphicTierlist.dashboardChannelId, "999");
  assert.equal(rawDb.config.tierLabels[5], "Legend");
  assert.equal(rawDb.config.graphicTierlist.tierColors[5], "#ff00aa");
  assert.equal(rawDb.config.graphicTierlist.image.width, 2300);
  assert.equal(rawDb.config.graphicTierlist.image.height, 1100);
  assert.equal(rawDb.config.graphicTierlist.image.icon, 136);

  resetLegacyEloGraphicTierColor(rawDb, 5);
  resetAllLegacyEloGraphicTierColors(rawDb);
  resetLegacyEloGraphicImageOverrides(rawDb);
  assert.equal(setLegacyEloGraphicDashboardChannel(rawDb, ""), true);

  assert.equal(rawDb.config.graphicTierlist.tierColors[5], "#ff6b6b");
  assert.equal(rawDb.config.graphicTierlist.image.width, null);
  assert.equal(rawDb.config.graphicTierlist.image.height, null);
  assert.equal(rawDb.config.graphicTierlist.image.icon, null);
  assert.equal(rawDb.config.graphicTierlist.dashboardChannelId, "");
  assert.equal(rawDb.config.graphicTierlist.dashboardMessageId, "");
  assert.equal(rawDb.config.graphicTierlist.lastUpdated, null);
  assert.equal(rawDb.config.graphicTierlist.tierColors[6], undefined);
});

test("buildLegacyEloGraphicEntries sorts live ratings and status lines reflect the current graphic state", () => {
  const rawDb = {
    config: {
      tierLabels: { 1: "Bronze", 2: "Silver", 3: "Gold", 4: "Diamond", 5: "Legend" },
      graphicTierlist: {
        title: "Ranked ELO",
        messageText: "PNG board for the ELO ladder",
        dashboardChannelId: "chan-1",
        dashboardMessageId: "msg-1",
        lastUpdated: "2026-05-01T15:00:00.000Z",
        image: { width: 2200, height: 1400, icon: 128 },
        tierColors: { 5: "#111111", 4: "#222222", 3: "#333333", 2: "#444444", 1: "#555555" },
        panel: { selectedTier: 4 },
      },
    },
    ratings: {
      user1: { userId: "user1", name: "Gojo", username: "satoru", elo: 110, tier: 5 },
      user2: { userId: "user2", name: "Yuji", username: "itadori", elo: 70, tier: 4 },
      user3: { userId: "user3", name: "Low", username: "low", elo: 0, tier: null },
    },
  };

  const entries = buildLegacyEloGraphicEntries(rawDb);
  const snapshot = buildLegacyEloGraphicPanelSnapshot(rawDb);
  const statusLines = buildLegacyEloGraphicStatusLines(rawDb);

  assert.equal(entries.length, 2);
  assert.equal(entries[0].userId, "user1");
  assert.equal(entries[0].kills, 110);
  assert.equal(entries[1].userId, "user2");
  assert.equal(snapshot.totalEntries, 2);
  assert.equal(snapshot.selectedTier, 4);
  assert.equal(snapshot.selectedTierLabel, "Diamond");
  assert.equal(snapshot.selectedTierColor, "#222222");
  assert.equal(snapshot.image.W, 2200);
  assert.equal(snapshot.image.H, 1400);
  assert.equal(snapshot.image.ICON, 128);
  assert.equal(statusLines[0], "title: Ranked ELO");
  assert.equal(statusLines[2], "channelId: chan-1");
  assert.equal(statusLines[4], "img: 2200x1400, icon=128");
  assert.equal(statusLines[5], "selectedTier: 4 -> Diamond");
});