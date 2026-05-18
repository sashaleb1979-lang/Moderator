"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  DISCORD_EMOJI_MAX_BYTES,
  DISCORD_EMOJI_SIZE,
  renderCharacterEmojiPng,
  resolveCharacterEmojiSyncName,
} = require("../src/onboard/character-emojis");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(PROJECT_ROOT, "bot.config.json");
const SOURCE_DIR = path.join(PROJECT_ROOT, "assets", "characters");
const OUTPUT_DIR = path.join(PROJECT_ROOT, "assets", "character-emojis");
const MANIFEST_PATH = path.join(OUTPUT_DIR, "manifest.json");
const README_PATH = path.join(OUTPUT_DIR, "README.md");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function cleanString(value, limit = 200) {
  return String(value || "").trim().slice(0, limit);
}

function getCharacterEntries(config) {
  return (Array.isArray(config?.characters) ? config.characters : [])
    .map((entry) => ({
      id: cleanString(entry?.id, 120),
      label: cleanString(entry?.label || entry?.name || entry?.id, 120),
    }))
    .filter((entry) => entry.id);
}

function writeReadme(manifest) {
  const rows = manifest.characters
    .map((entry) => `| \`${entry.characterId}\` | \`${entry.emojiName}\` | \`${entry.file}\` | ${entry.bytes} |`)
    .join("\n");
  const missing = manifest.missing.length
    ? manifest.missing.map((entry) => `- \`${entry.characterId}\`: missing \`${entry.sourceFile}\``).join("\n")
    : "- none";
  const oversized = manifest.oversized.length
    ? manifest.oversized.map((entry) => `- \`${entry.characterId}\`: ${entry.bytes} bytes`).join("\n")
    : "- none";

  const content = [
    "# Character Emoji Upload Kit",
    "",
    "Готовые 128x128 PNG для Discord custom emoji. Эти файлы можно грузить руками, если бот не может создать emoji сам.",
    "",
    "## Ручная загрузка",
    "",
    "1. Discord Server Settings -> Emoji -> Upload Emoji.",
    "2. Загрузи PNG из этой папки.",
    "3. Имя emoji ставь ровно как имя файла без `.png`, например `jjs_honored_one`.",
    "4. После загрузки нажми в мод-панели бота `Залить emoji персов`, чтобы бот переиспользовал emoji и записал mapping.",
    "",
    "## Files",
    "",
    "| Character id | Emoji name | File | Bytes |",
    "| --- | --- | --- | ---: |",
    rows,
    "",
    "## Missing Source Assets",
    "",
    missing,
    "",
    "## Oversized Outputs",
    "",
    oversized,
    "",
  ].join("\n");

  fs.writeFileSync(README_PATH, content, "utf8");
}

async function main() {
  const config = readJson(CONFIG_PATH);
  const characters = getCharacterEntries(config);
  const reservedNames = new Set();
  const manifest = {
    sourceDir: path.relative(PROJECT_ROOT, SOURCE_DIR).replace(/\\/g, "/"),
    outputDir: path.relative(PROJECT_ROOT, OUTPUT_DIR).replace(/\\/g, "/"),
    size: DISCORD_EMOJI_SIZE,
    discordMaxBytes: DISCORD_EMOJI_MAX_BYTES,
    total: characters.length,
    characters: [],
    missing: [],
    oversized: [],
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  for (const fileName of fs.readdirSync(OUTPUT_DIR)) {
    if (/^jjs_[a-z0-9_]+\.png$/i.test(fileName)) {
      fs.unlinkSync(path.join(OUTPUT_DIR, fileName));
    }
  }

  for (const entry of characters) {
    const emojiName = resolveCharacterEmojiSyncName(entry.id, { reservedNames });
    reservedNames.add(emojiName);

    const sourcePath = path.join(SOURCE_DIR, `${entry.id}.png`);
    const outputFile = `${emojiName}.png`;
    const outputPath = path.join(OUTPUT_DIR, outputFile);
    const relativeSource = path.relative(PROJECT_ROOT, sourcePath).replace(/\\/g, "/");
    const relativeOutput = path.relative(PROJECT_ROOT, outputPath).replace(/\\/g, "/");

    if (!fs.existsSync(sourcePath)) {
      manifest.missing.push({
        characterId: entry.id,
        label: entry.label,
        emojiName,
        sourceFile: relativeSource,
      });
      continue;
    }

    const buffer = await renderCharacterEmojiPng(sourcePath, { size: DISCORD_EMOJI_SIZE });
    fs.writeFileSync(outputPath, buffer);

    const record = {
      characterId: entry.id,
      label: entry.label,
      emojiName,
      file: relativeOutput,
      sourceFile: relativeSource,
      bytes: buffer.length,
    };
    manifest.characters.push(record);
    if (buffer.length > DISCORD_EMOJI_MAX_BYTES) {
      manifest.oversized.push(record);
    }
  }

  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  writeReadme(manifest);

  console.log(`Prepared ${manifest.characters.length}/${manifest.total} character emoji PNGs in ${path.relative(PROJECT_ROOT, OUTPUT_DIR)}.`);
  if (manifest.missing.length) console.warn(`Missing source assets: ${manifest.missing.length}.`);
  if (manifest.oversized.length) console.warn(`Oversized outputs: ${manifest.oversized.length}.`);
  if (manifest.missing.length || manifest.oversized.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
