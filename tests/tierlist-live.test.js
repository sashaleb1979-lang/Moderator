"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  LEGACY_TIERLIST_TITLE,
  appendLegacyTierlistCharacterToActiveWizards,
  buildLegacyTierlistBucketsFromVoteMap,
  buildLegacyTierlistSummaryEmbed,
  computeLegacyTierlistGlobalBuckets,
  loadLegacyTierlistState,
  mergeLegacyTierlistCharacters,
} = require("../src/integrations/tierlist-live");

test("mergeLegacyTierlistCharacters merges base and custom entries without duplicates", () => {
  const merged = mergeLegacyTierlistCharacters(
    [
      { id: "gojo", label: "Gojo" },
      { id: "yuji", label: "Yuji" },
    ],
    [
      { id: "yuji", name: "Yuji Itadori", enabled: true },
      { id: "mahito", name: "Mahito", enabled: true },
      { id: "hidden", name: "Hidden", enabled: false },
    ]
  );

  assert.deepEqual(
    merged.map((entry) => ({ id: entry.id, name: entry.name })),
    [
      { id: "gojo", name: "Gojo" },
      { id: "yuji", name: "Yuji" },
      { id: "mahito", name: "Mahito" },
    ]
  );
});

test("loadLegacyTierlistState reads legacy state and merges custom characters", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "moderator-tierlist-live-"));
  const statePath = path.join(tempDir, "state.json");
  const customCharactersPath = path.join(tempDir, "characters.custom.json");

  fs.writeFileSync(statePath, JSON.stringify({ settings: {}, users: {}, finalVotes: {} }, null, 2), "utf8");
  fs.writeFileSync(customCharactersPath, JSON.stringify([{ id: "mahito", name: "Mahito", enabled: true }], null, 2), "utf8");

  const liveState = loadLegacyTierlistState({
    sourcePath: statePath,
    baseCharacterCatalog: [{ id: "gojo", label: "Gojo" }],
  });

  assert.equal(liveState.ok, true);
  assert.equal(liveState.characters.length, 2);
  assert.equal(liveState.charById.get("mahito").name, "Mahito");
  assert.equal(liveState.rawState.settings.summaryMessageId, null);
});

test("computeLegacyTierlistGlobalBuckets follows legacy averaging with stored influence multipliers", () => {
  const liveState = {
    rawState: {
      tiers: {},
      users: {
        user1: { influenceMultiplier: 4 },
        user2: { influenceMultiplier: 1 },
      },
      finalVotes: {
        user1: { gojo: "S" },
        user2: { gojo: "D", yuji: "A" },
      },
    },
    characters: [
      { id: "gojo", name: "Gojo" },
      { id: "yuji", name: "Yuji" },
    ],
    charById: new Map([
      ["gojo", { id: "gojo", name: "Gojo" }],
      ["yuji", { id: "yuji", name: "Yuji" }],
    ]),
  };

  const result = computeLegacyTierlistGlobalBuckets(liveState);

  assert.equal(result.votersCount, 2);
  assert.deepEqual(result.buckets.S, []);
  assert.deepEqual(result.buckets.A, ["gojo", "yuji"]);
  assert.ok(result.meta.gojo.avg > result.meta.yuji.avg);
  assert.equal(result.meta.gojo.votes, 2);
});

test("computeLegacyTierlistGlobalBuckets excludes only current main votes from the global result", () => {
  const liveState = {
    rawState: {
      tiers: {},
      users: {
        user1: { mainIds: ["gojo"], influenceMultiplier: 2 },
        user2: { influenceMultiplier: 1 },
      },
      finalVotes: {
        user1: { gojo: "D", yuji: "S" },
        user2: { gojo: "S" },
      },
    },
    characters: [
      { id: "gojo", name: "Gojo" },
      { id: "yuji", name: "Yuji" },
    ],
    charById: new Map([
      ["gojo", { id: "gojo", name: "Gojo" }],
      ["yuji", { id: "yuji", name: "Yuji" }],
    ]),
  };

  const result = computeLegacyTierlistGlobalBuckets(liveState);

  assert.equal(result.votersCount, 2);
  assert.equal(result.meta.gojo.votes, 1);
  assert.equal(result.meta.yuji.votes, 1);
  assert.deepEqual(result.buckets.S, ["yuji", "gojo"]);
});

test("computeLegacyTierlistGlobalBuckets reuses stored votes after mainIds change", () => {
  const liveState = {
    rawState: {
      tiers: {},
      users: {
        user1: { mainIds: ["gojo"], influenceMultiplier: 1 },
        user2: { influenceMultiplier: 1 },
      },
      finalVotes: {
        user1: { gojo: "D" },
        user2: { gojo: "S" },
      },
    },
    characters: [
      { id: "gojo", name: "Gojo" },
    ],
    charById: new Map([
      ["gojo", { id: "gojo", name: "Gojo" }],
    ]),
  };

  const beforeMainSwap = computeLegacyTierlistGlobalBuckets(liveState);
  liveState.rawState.users.user1.mainIds = ["yuji"];
  const afterMainSwap = computeLegacyTierlistGlobalBuckets(liveState);

  assert.equal(beforeMainSwap.meta.gojo.votes, 1);
  assert.equal(beforeMainSwap.votersCount, 1);
  assert.equal(afterMainSwap.meta.gojo.votes, 2);
  assert.equal(afterMainSwap.votersCount, 2);
  assert.ok(afterMainSwap.meta.gojo.avg < beforeMainSwap.meta.gojo.avg);
});

test("buildLegacyTierlistBucketsFromVoteMap and summary embed follow legacy tier naming", () => {
  const liveState = {
    rawState: {
      tiers: {
        S: { name: "Имба", color: "#ff6b6b" },
        A: { name: "Сильный", color: "#ffbe76" },
        B: { name: "Норма", color: "#f9f871" },
        C: { name: "Слабый", color: "#7bed9f" },
        D: { name: "Мусор", color: "#74b9ff" },
      },
      users: {},
      finalVotes: {
        voter1: { gojo: "S", yuji: "A" },
      },
    },
    characters: [
      { id: "gojo", name: "Gojo" },
      { id: "yuji", name: "Yuji" },
    ],
    charById: new Map([
      ["gojo", { id: "gojo", name: "Gojo" }],
      ["yuji", { id: "yuji", name: "Yuji" }],
    ]),
  };

  const buckets = buildLegacyTierlistBucketsFromVoteMap(liveState, { gojo: "S", yuji: "A" });
  const embed = buildLegacyTierlistSummaryEmbed(liveState, { title: LEGACY_TIERLIST_TITLE });

  assert.deepEqual(buckets.S, ["gojo"]);
  assert.deepEqual(buckets.A, ["yuji"]);
  assert.equal(embed.data.title, `${LEGACY_TIERLIST_TITLE} Summary`);
  assert.equal(embed.data.fields[0].name, "Имба");
  assert.match(embed.data.fields[0].value, /Gojo/);
});

test("appendLegacyTierlistCharacterToActiveWizards appends for active full/new sessions even when the character is a main", () => {
  const rawState = {
    users: {
      noMainFull: { wizMode: "full", wizQueue: ["gojo"], wizIndex: 0, mainIds: [] },
      noMainNew: { wizMode: "new", wizQueue: ["yuji"], wizIndex: 0, mainIds: [] },
      targeted: { wizMode: "targeted", wizQueue: ["mahito"], wizIndex: 0, mainIds: [] },
      lockedMain: { wizMode: "full", wizQueue: ["gojo"], wizIndex: 0, mainIds: ["sukuna"] },
      finished: { wizMode: "full", wizQueue: ["gojo"], wizIndex: 1, mainIds: [] },
    },
  };

  appendLegacyTierlistCharacterToActiveWizards(rawState, "sukuna");

  assert.deepEqual(rawState.users.noMainFull.wizQueue, ["gojo", "sukuna"]);
  assert.deepEqual(rawState.users.noMainNew.wizQueue, ["yuji", "sukuna"]);
  assert.deepEqual(rawState.users.targeted.wizQueue, ["mahito"]);
  assert.deepEqual(rawState.users.lockedMain.wizQueue, ["gojo", "sukuna"]);
  assert.deepEqual(rawState.users.finished.wizQueue, ["gojo"]);
});