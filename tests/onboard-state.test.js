"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { commitMutation } = require("../src/onboard/refresh-runner");
const { ONBOARD_SUBCOMMAND_NAMES } = require("../src/onboard/commands");
const { getMainStats, getTierlistStats } = require("../src/onboard/tierlist-stats");
const {
  createPresentationDefaults,
  ensurePresentationConfig,
  getGraphicTierlistBoardState,
  getTextTierlistBoardState,
  getTierLabel,
  resolvePresentation,
} = require("../src/onboard/presentation");

const DEFAULT_GRAPHIC_TIER_COLORS = {
  1: "#111111",
  2: "#222222",
  3: "#333333",
  4: "#444444",
  5: "#555555",
};

test("migrates legacy tierlist and graphic config into unified presentation state", () => {
  const fileConfig = {
    ui: { tierlistTitle: "File text title" },
    graphicTierlist: { title: "File graphic title", subtitle: "File graphic subtitle" },
    killTierLabels: { 1: "File tier 1" },
  };
  const dbConfig = {
    tierlistBoard: {
      channelId: "text-channel",
      textMessageId: "text-message",
      graphicChannelId: "graphic-channel",
      graphicMessageId: "graphic-message",
    },
    graphicTierlist: {
      title: "Legacy graphic title",
      messageText: "Legacy graphic text",
      tierLabels: { 1: "Legacy tier one" },
      tierColors: { 5: "#abcdef" },
      image: { width: 2400, icon: 144 },
      panel: { selectedTier: 4 },
      lastUpdated: 123456,
    },
  };

  const result = ensurePresentationConfig(dbConfig, {
    defaults: createPresentationDefaults(fileConfig, { defaultGraphicTierColors: DEFAULT_GRAPHIC_TIER_COLORS }),
    defaultWelcomeChannelId: "welcome-channel",
    defaultTextTierlistChannelId: "text-channel",
    defaultGraphicTierColors: DEFAULT_GRAPHIC_TIER_COLORS,
  });

  assert.equal(result.mutated, true);
  assert.deepEqual(dbConfig.tierlistBoard.text, {
    channelId: "text-channel",
    messageId: "text-message",
  });
  assert.deepEqual(dbConfig.tierlistBoard.graphic, {
    channelId: "graphic-channel",
    messageId: "graphic-message",
    lastUpdated: 123456,
  });
  assert.equal(dbConfig.presentation.tierlist.graphicTitle, "Legacy graphic title");
  assert.equal(dbConfig.presentation.tierlist.graphicMessageText, "Legacy graphic text");
  assert.equal(dbConfig.presentation.tierlist.labels[1], "Legacy tier one");
  assert.equal(dbConfig.presentation.tierlist.graphic.colors[5], "#abcdef");
  assert.equal(dbConfig.presentation.tierlist.graphic.image.width, 2400);
  assert.equal(dbConfig.presentation.tierlist.graphic.image.icon, 144);
  assert.equal(dbConfig.presentation.tierlist.graphic.panel.selectedTier, 4);
});

test("presentation resolution prefers db overrides over file defaults and hard defaults", () => {
  const fileConfig = {
    welcomeEmbed: {
      title: "File welcome title",
      description: "File welcome text",
      steps: ["F1", "F2", "F3", "F4", "F5"],
    },
    ui: {
      getRoleButtonLabel: "File start",
      tierlistTitle: "File text tierlist",
    },
    graphicTierlist: {
      title: "File graphic title",
      subtitle: "File graphic text",
      tierColors: { 3: "#c0ffee" },
    },
    killTierLabels: {
      1: "File tier one",
      2: "File tier two",
    },
  };
  const dbConfig = {
    presentation: {
      welcome: {
        title: "DB welcome title",
        buttons: { begin: "DB start" },
      },
      tierlist: {
        graphicMessageText: "DB graphic text",
        labels: { 1: "DB tier one" },
      },
    },
  };

  const resolved = resolvePresentation(dbConfig, fileConfig, {
    defaultGraphicTierColors: DEFAULT_GRAPHIC_TIER_COLORS,
  });

  assert.equal(resolved.welcome.title, "DB welcome title");
  assert.equal(resolved.welcome.description, "File welcome text");
  assert.deepEqual(resolved.welcome.steps, ["F1", "F2", "F3", "F4", "F5"]);
  assert.equal(resolved.welcome.buttons.begin, "DB start");
  assert.equal(resolved.tierlist.textTitle, "File text tierlist");
  assert.equal(resolved.tierlist.graphicTitle, "File graphic title");
  assert.equal(resolved.tierlist.graphicMessageText, "DB graphic text");
  assert.equal(getTierLabel(resolved, 1), "DB tier one");
  assert.equal(getTierLabel(resolved, 2), "File tier two");
  assert.equal(resolved.tierlist.graphic.colors[3], "#c0ffee");
  assert.equal(resolved.tierlist.graphic.colors[5], "#555555");
});

test("text and graphic board states stay separate after migration and direct updates", () => {
  const dbConfig = {
    tierlistBoard: {
      channelId: "text-home",
      textMessageId: "text-message",
      graphicChannelId: "graphic-home",
      graphicMessageId: "graphic-message",
    },
  };

  ensurePresentationConfig(dbConfig, {
    defaults: createPresentationDefaults({}, { defaultGraphicTierColors: DEFAULT_GRAPHIC_TIER_COLORS }),
    defaultWelcomeChannelId: "welcome-home",
    defaultTextTierlistChannelId: "text-home",
    defaultGraphicTierColors: DEFAULT_GRAPHIC_TIER_COLORS,
  });

  const textBoard = getTextTierlistBoardState(dbConfig, "text-home");
  const graphicBoard = getGraphicTierlistBoardState(dbConfig, "text-home");

  graphicBoard.channelId = "graphic-moved";
  graphicBoard.messageId = "graphic-new";

  assert.deepEqual(textBoard, {
    channelId: "text-home",
    messageId: "text-message",
  });
  assert.deepEqual(graphicBoard, {
    channelId: "graphic-moved",
    messageId: "graphic-new",
    lastUpdated: null,
  });
});

test("commitMutation persists before refreshing the graphic board", async () => {
  const calls = [];
  const state = { counter: 0 };

  await commitMutation({
    mutate: () => {
      state.counter += 1;
      calls.push("mutate");
    },
    persist: () => {
      calls.push(`save:${state.counter}`);
    },
    scope: "graphic",
    refreshers: {
      refreshGraphicTierlistBoard: () => {
        calls.push(`refresh:${state.counter}`);
      },
    },
  });

  assert.deepEqual(calls, ["mutate", "save:1", "refresh:1"]);
});

test("tierlist stats count approval/reject rates and per-main aggregates", () => {
  const entries = [
    { displayName: "Alpha", approvedKills: 1000, killTier: 2, mains: ["Gojo", "Megumi"] },
    { displayName: "Beta", approvedKills: 3000, killTier: 3, mains: ["Gojo"] },
    { displayName: "Gamma", approvedKills: 7000, killTier: 4, mains: ["Megumi", "Megumi"] },
  ];
  const submissions = [
    { status: "approved" },
    { status: "approved" },
    { status: "rejected" },
    { status: "pending" },
    { status: "superseded" },
  ];

  const tierlistStats = getTierlistStats(entries, submissions);
  const mainStats = getMainStats(entries);
  const gojo = mainStats.find((entry) => entry.main === "Gojo");
  const megumi = mainStats.find((entry) => entry.main === "Megumi");

  assert.equal(tierlistStats.totalVerified, 3);
  assert.equal(tierlistStats.pendingCount, 1);
  assert.equal(tierlistStats.approvedCount, 2);
  assert.equal(tierlistStats.rejectedCount, 1);
  assert.ok(Math.abs(tierlistStats.approvalRate - (200 / 3)) < 1e-9);
  assert.ok(Math.abs(tierlistStats.rejectRate - (100 / 3)) < 1e-9);
  assert.deepEqual(tierlistStats.totalsByTier, { 1: 0, 2: 1, 3: 1, 4: 1, 5: 0 });

  assert.deepEqual(mainStats.map((entry) => entry.main), ["Megumi", "Gojo"]);
  assert.equal(gojo.playerCount, 2);
  assert.equal(gojo.averageKills, 2000);
  assert.equal(gojo.medianKills, 2000);
  assert.deepEqual(gojo.totalsByTier, { 1: 0, 2: 1, 3: 1, 4: 0, 5: 0 });
  assert.equal(megumi.playerCount, 2);
  assert.equal(megumi.averageKills, 4000);
  assert.equal(megumi.medianKills, 4000);
  assert.deepEqual(megumi.totalsByTier, { 1: 0, 2: 1, 3: 0, 4: 1, 5: 0 });
});

test("command builder includes new admin refresh and editor subcommands", () => {
  assert.deepEqual(
    [...ONBOARD_SUBCOMMAND_NAMES].sort(),
    [
      "graphicpanel",
      "graphicstatus",
      "modset",
      "movegraphic",
      "movenotices",
      "movetext",
      "panel",
      "pending",
      "profile",
      "refreshwelcome",
      "refreshtierlists",
      "remindmissing",
      "removetier",
      "stats",
      "syncroles",
      "tierlist",
      "welcomeedit",
    ].sort()
  );
});
