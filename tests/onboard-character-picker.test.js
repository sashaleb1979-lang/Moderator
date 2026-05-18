"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  DISCORD_EMOJI_MAX_BYTES,
  createCharacterEmojiName,
  normalizeCharacterEmojiMap,
  renderCharacterEmojiPng,
  resolveCharacterEmojiSyncName,
} = require("../src/onboard/character-emojis");
const {
  CHARACTER_PICKER_PAGE_SIZE,
  paginateCharacterPickerEntries,
  renderCharacterPickerBoardPng,
  toggleCharacterPickerSelection,
} = require("../src/onboard/character-picker-board");
const {
  createPresentationDefaults,
  ensurePresentationConfig,
  resolvePresentation,
} = require("../src/onboard/presentation");

const ASSETS_DIR = path.resolve(__dirname, "../assets/characters");

test("character emoji names are normalized, shortened, and collision-safe", () => {
  assert.equal(createCharacterEmojiName("honored_one"), "jjs_honored_one");

  const longName = createCharacterEmojiName("this_character_name_is_far_too_long_for_discord_emoji_names");
  assert.ok(longName.length <= 32);
  assert.match(longName, /^jjs_/);

  const colliding = createCharacterEmojiName("honored_one", new Set(["jjs_honored_one"]));
  assert.notEqual(colliding, "jjs_honored_one");
  assert.ok(colliding.length <= 32);
});

test("character emoji sync names avoid already assigned normalized names", () => {
  const reservedNames = new Set();
  const first = resolveCharacterEmojiSyncName("foo-bar", { reservedNames });
  reservedNames.add(first);
  const second = resolveCharacterEmojiSyncName("foo_bar", { reservedNames });

  assert.equal(first, "jjs_foo_bar");
  assert.notEqual(second, first);
  assert.match(second, /^jjs_foo_bar_[a-f0-9]{6}$/);
  assert.ok(second.length <= 32);
});

test("character emoji map normalizes records and preserves valid fallback entries", () => {
  const normalized = normalizeCharacterEmojiMap({
    honored_one: { id: "123456789012345678", name: "JJS Honored One!", animated: false, syncedAt: "now" },
    broken: { id: "nope", name: "bad" },
  }, {
    vessel: { id: "223456789012345678", name: "jjs_vessel", animated: false },
  });

  assert.deepEqual(Object.keys(normalized).sort(), ["honored_one", "vessel"]);
  assert.equal(normalized.honored_one.name, "jjs_honored_one");
  assert.equal(normalized.vessel.id, "223456789012345678");
});

test("character emoji renderer creates Discord-sized PNGs for current character art", async () => {
  const files = require("node:fs").readdirSync(ASSETS_DIR).filter((file) => file.endsWith(".png"));
  assert.ok(files.length > 0);

  for (const file of files) {
    const buffer = await renderCharacterEmojiPng(path.join(ASSETS_DIR, file));
    assert.ok(Buffer.isBuffer(buffer), file);
    assert.ok(buffer.length > 1000, file);
    assert.ok(buffer.length <= DISCORD_EMOJI_MAX_BYTES, file);
  }
});

test("character picker pagination keeps all configured characters reachable", () => {
  const entries = Array.from({ length: CHARACTER_PICKER_PAGE_SIZE * 2 + 5 }, (_, index) => ({
    id: `character_${index + 1}`,
    label: `Character ${index + 1}`,
  }));

  const first = paginateCharacterPickerEntries(entries, 0);
  const last = paginateCharacterPickerEntries(entries, 99);

  assert.equal(first.items.length, CHARACTER_PICKER_PAGE_SIZE);
  assert.equal(first.startIndex, 0);
  assert.equal(first.hasNext, true);
  assert.equal(last.page, 2);
  assert.equal(last.items.length, 5);
  assert.equal(last.startIndex, CHARACTER_PICKER_PAGE_SIZE * 2);
});

test("character picker toggle selects up to two mains and blocks the third", () => {
  const first = toggleCharacterPickerSelection([], "honored_one");
  const second = toggleCharacterPickerSelection(first.selectedIds, "vessel");
  const third = toggleCharacterPickerSelection(second.selectedIds, "ten_shadows");
  const removed = toggleCharacterPickerSelection(second.selectedIds, "honored_one");

  assert.deepEqual(first.selectedIds, ["honored_one"]);
  assert.deepEqual(second.selectedIds, ["honored_one", "vessel"]);
  assert.equal(third.blocked, true);
  assert.equal(third.reason, "max-selected");
  assert.deepEqual(third.selectedIds, ["honored_one", "vessel"]);
  assert.deepEqual(removed.selectedIds, ["vessel"]);
});

test("character picker board renders a PNG for the current page", async () => {
  const entries = ["honored_one", "vessel", "ten_shadows"].map((id) => ({ id, label: id }));
  const pageInfo = paginateCharacterPickerEntries(entries, 0);
  const buffer = await renderCharacterPickerBoardPng({
    entries,
    pageInfo,
    pageItems: pageInfo.items,
    selectedIds: ["vessel"],
    assetsDir: ASSETS_DIR,
  });

  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 5000);
});

test("presentation normalization preserves character emoji config", () => {
  const dbConfig = {
    presentation: {
      welcome: {
        characterEmojis: {
          honored_one: { id: "123456789012345678", name: "JJS Honored One!" },
        },
      },
    },
  };

  const result = ensurePresentationConfig(dbConfig, {
    defaults: createPresentationDefaults({}, {}),
  });
  const resolved = resolvePresentation(dbConfig, {}, {});

  assert.equal(result.mutated, true);
  assert.equal(dbConfig.presentation.welcome.characterEmojis.honored_one.name, "jjs_honored_one");
  assert.equal(resolved.welcome.characterEmojis.honored_one.id, "123456789012345678");
});
