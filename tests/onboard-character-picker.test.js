"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { MessageFlags } = require("discord.js");
const botConfig = require("../bot.config.json");

const {
  DISCORD_EMOJI_MAX_BYTES,
  createCharacterEmojiName,
  normalizeCharacterEmojiMap,
  renderCharacterEmojiPng,
  resolveCharacterEmojiSyncName,
} = require("../src/onboard/character-emojis");
const {
  CHARACTER_PICKER_PAGE_SIZE,
  buildCharacterPickerPayload,
  paginateCharacterPickerEntries,
  toggleCharacterPickerSelection,
} = require("../src/onboard/character-picker");
const {
  createPresentationDefaults,
  ensurePresentationConfig,
  resolvePresentation,
} = require("../src/onboard/presentation");

const ASSETS_DIR = path.resolve(__dirname, "../assets/characters");
const GENERATED_EMOJI_DIR = path.resolve(__dirname, "../assets/character-emojis");

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
  const files = fs.readdirSync(ASSETS_DIR).filter((file) => file.endsWith(".png"));
  assert.ok(files.length > 0);

  for (const file of files) {
    const buffer = await renderCharacterEmojiPng(path.join(ASSETS_DIR, file));
    assert.ok(Buffer.isBuffer(buffer), file);
    assert.ok(buffer.length > 1000, file);
    assert.ok(buffer.length <= DISCORD_EMOJI_MAX_BYTES, file);
  }
});

test("prepared character emoji upload kit covers the current character catalog", () => {
  const manifestPath = path.join(GENERATED_EMOJI_DIR, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const configuredIds = (Array.isArray(botConfig.characters) ? botConfig.characters : [])
    .map((entry) => entry.id)
    .sort();
  const generatedIds = manifest.characters.map((entry) => entry.characterId).sort();

  assert.deepEqual(generatedIds, configuredIds);
  assert.deepEqual(manifest.missing, []);
  assert.deepEqual(manifest.oversized, []);

  for (const entry of manifest.characters) {
    const fullPath = path.resolve(__dirname, "..", entry.file);
    const stat = fs.statSync(fullPath);
    assert.equal(stat.size, entry.bytes, entry.file);
    assert.ok(entry.bytes <= DISCORD_EMOJI_MAX_BYTES, entry.file);
    assert.match(entry.emojiName, /^jjs_[a-z0-9_]{1,28}$/);
  }
});

test("character picker pagination keeps all configured characters reachable", () => {
  const extraOnLastPage = 3;
  const entries = Array.from({ length: CHARACTER_PICKER_PAGE_SIZE * 2 + extraOnLastPage }, (_, index) => ({
    id: `character_${index + 1}`,
    label: `Character ${index + 1}`,
  }));

  const first = paginateCharacterPickerEntries(entries, 0);
  const last = paginateCharacterPickerEntries(entries, 99);

  assert.equal(first.items.length, CHARACTER_PICKER_PAGE_SIZE);
  assert.equal(first.startIndex, 0);
  assert.equal(first.hasNext, true);
  assert.equal(last.page, 2);
  assert.equal(last.items.length, extraOnLastPage);
  assert.equal(last.startIndex, CHARACTER_PICKER_PAGE_SIZE * 2);
});

test("current configured characters fit on one fast picker page", () => {
  const entries = (Array.isArray(botConfig.characters) ? botConfig.characters : []).map((value) => ({
    id: value.id,
    label: value?.name || value?.label || value.id,
  }));
  const pageInfo = paginateCharacterPickerEntries(entries, 0);

  assert.equal(entries.length, 20);
  assert.equal(pageInfo.items.length, entries.length);
  assert.equal(pageInfo.hasNext, false);
});

test("character picker paginates only after twenty entries", () => {
  const entries = Array.from({ length: 21 }, (_, index) => ({
    id: `character_${index + 1}`,
    label: `Character ${index + 1}`,
  }));
  const first = paginateCharacterPickerEntries(entries, 0);
  const second = paginateCharacterPickerEntries(entries, 1);

  assert.equal(first.items.length, 20);
  assert.equal(first.hasNext, true);
  assert.equal(second.items.length, 1);
  assert.equal(second.hasPrev, true);
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

test("character picker payload renders one dense emoji-button panel without attachments", () => {
  const entries = (Array.isArray(botConfig.characters) ? botConfig.characters : []).map((value) => ({
    id: value.id,
    label: value?.name || value?.label || value.id,
  }));
  const firstEntry = entries[0];
  const payload = buildCharacterPickerPayload({
    entries,
    picker: { mode: "quick", page: 0, selectedIds: [firstEntry.id] },
    characterEmojis: {
      [firstEntry.id]: { id: "123456789012345678", name: "jjs_first_character", animated: false },
    },
  });
  const rows = payload.components.map((row) => row.toJSON());
  const json = JSON.stringify(rows);
  const characterButtons = rows
    .flatMap((row) => row.components || [])
    .filter((component) => String(component.custom_id || "").startsWith("onboard_main_toggle:"));

  assert.equal(payload.flags, MessageFlags.Ephemeral);
  assert.equal(payload.files, undefined);
  assert.equal(payload.components.length, 5);
  assert.equal(characterButtons.length, entries.length);
  assert.equal(rows[0].components.length, 5);
  assert.equal(rows[3].components.length, 5);
  assert.equal(rows[4].components.length, 2);
  assert.match(json, new RegExp(`onboard_main_toggle:${firstEntry.id}`));
  assert.match(json, /jjs_first_character/);
  assert.doesNotMatch(json, /"label":"0[1-9] /);
  assert.doesNotMatch(json, /onboard_main_prev/);
  assert.doesNotMatch(json, /onboard_main_next/);
  assert.doesNotMatch(json, /mains-picker\.png/);
  assert.doesNotMatch(json, /attachment:\/\//);
});

test("character picker payload falls back to text labels without emoji mapping", () => {
  const entries = [{ id: "honored_one", label: "Годжо" }];
  const payload = buildCharacterPickerPayload({
    entries,
    picker: { mode: "full", page: 0, selectedIds: [] },
    characterEmojis: {},
  });
  const button = payload.components[0].toJSON().components[0];

  assert.equal(button.label, "Годжо");
  assert.equal(button.emoji, undefined);
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

test("change mains route reopens picker with reply instead of rewriting the source panel", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "welcome-bot.js"), "utf8");
  const changeMainsBranch = /if \(interaction\.customId === "onboard_change_mains"\) \{[\s\S]*?await openCharacterPicker\(interaction, "full", "reply"\);/;
  const legacyUpdateBranch = /if \(interaction\.customId === "onboard_change_mains"\) \{[\s\S]*?await openCharacterPicker\(interaction, "full", "update"\);/;

  assert.match(source, changeMainsBranch);
  assert.doesNotMatch(source, legacyUpdateBranch);
});
