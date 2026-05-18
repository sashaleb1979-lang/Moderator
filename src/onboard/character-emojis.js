"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const { PassThrough } = require("node:stream");

let PImage = null;
try { PImage = require("pureimage"); } catch {}

const DISCORD_EMOJI_MAX_BYTES = 256 * 1024;
const DISCORD_EMOJI_SIZE = 128;

function cleanString(value, limit = 256) {
  return String(value || "").trim().slice(0, limit);
}

function normalizeEmojiNamePart(value) {
  const normalized = cleanString(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  return normalized || "character";
}

function shortHash(value, length = 6) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, length);
}

function createCharacterEmojiName(characterId, usedNames = new Set()) {
  const base = `jjs_${normalizeEmojiNamePart(characterId)}`;
  const used = usedNames instanceof Set ? usedNames : new Set(Array.isArray(usedNames) ? usedNames : []);
  if (base.length <= 32 && !used.has(base)) return base;

  const suffix = shortHash(characterId);
  const prefix = base.slice(0, Math.max(2, 32 - suffix.length - 1)).replace(/_+$/g, "") || "jjs";
  let candidate = `${prefix}_${suffix}`.slice(0, 32);
  if (!used.has(candidate)) return candidate;

  for (let index = 2; index < 100; index += 1) {
    const nextSuffix = `${suffix.slice(0, 4)}${index}`;
    const nextPrefix = base.slice(0, Math.max(2, 32 - nextSuffix.length - 1)).replace(/_+$/g, "") || "jjs";
    candidate = `${nextPrefix}_${nextSuffix}`.slice(0, 32);
    if (!used.has(candidate)) return candidate;
  }

  return `jjs_${suffix}`.slice(0, 32);
}

function normalizeEmojiNameSet(values = []) {
  const source = values instanceof Set ? [...values] : Array.isArray(values) ? values : [];
  return new Set(source.map((value) => normalizeEmojiNamePart(value)).filter(Boolean));
}

function resolveCharacterEmojiSyncName(characterId, options = {}) {
  const reservedNames = normalizeEmojiNameSet(options.reservedNames);
  const preferredName = cleanString(options.preferredName, 80)
    ? normalizeEmojiNamePart(options.preferredName)
    : createCharacterEmojiName(characterId);
  if (!reservedNames.has(preferredName)) return preferredName;
  return createCharacterEmojiName(characterId, reservedNames);
}

function normalizeCharacterEmojiRecord(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const id = cleanString(source.id, 40);
  const rawName = cleanString(source.name, 80);
  const name = rawName ? normalizeEmojiNamePart(rawName) : "";
  if (!/^\d{5,25}$/.test(id) || !/^[a-z0-9_]{2,32}$/.test(name)) return null;

  const syncedAt = cleanString(source.syncedAt, 80);
  return {
    id,
    name,
    animated: source.animated === true,
    syncedAt,
  };
}

function normalizeCharacterEmojiMap(value = {}, fallback = {}) {
  const out = {};
  for (const source of [fallback, value]) {
    const map = source && typeof source === "object" && !Array.isArray(source) ? source : {};
    for (const [characterId, record] of Object.entries(map)) {
      const normalizedId = cleanString(characterId, 120);
      const normalizedRecord = normalizeCharacterEmojiRecord(record);
      if (normalizedId && normalizedRecord) out[normalizedId] = normalizedRecord;
    }
  }
  return out;
}

function getCharacterEmojiRecord(characterEmojis = {}, characterId = "") {
  return normalizeCharacterEmojiRecord(normalizeCharacterEmojiMap(characterEmojis)[cleanString(characterId, 120)]);
}

function toButtonEmoji(record) {
  const emoji = normalizeCharacterEmojiRecord(record);
  if (!emoji) return null;
  return { id: emoji.id, name: emoji.name, animated: emoji.animated };
}

function toEmojiMention(record) {
  const emoji = normalizeCharacterEmojiRecord(record);
  if (!emoji) return "";
  return `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`;
}

function bufferToStream(buffer) {
  const stream = new PassThrough();
  stream.end(buffer);
  return stream;
}

async function decodeImage(buffer) {
  if (!PImage) throw new Error("pureimage не установлен.");
  try {
    return await PImage.decodePNGFromStream(bufferToStream(buffer));
  } catch {
    return PImage.decodeJPEGFromStream(bufferToStream(buffer));
  }
}

function drawCoverImage(ctx, image, x, y, width, height) {
  const sourceWidth = Number(image?.width) || width;
  const sourceHeight = Number(image?.height) || height;
  const sourceRatio = sourceWidth / Math.max(1, sourceHeight);
  const targetRatio = width / Math.max(1, height);

  let sx = 0;
  let sy = 0;
  let sw = sourceWidth;
  let sh = sourceHeight;
  if (sourceRatio > targetRatio) {
    sw = Math.max(1, Math.floor(sourceHeight * targetRatio));
    sx = Math.floor((sourceWidth - sw) / 2);
  } else {
    sh = Math.max(1, Math.floor(sourceWidth / targetRatio));
    sy = Math.floor((sourceHeight - sh) / 2);
  }

  ctx.drawImage(image, sx, sy, sw, sh, x, y, width, height);
}

async function encodePng(image) {
  const chunks = [];
  const stream = new PassThrough();
  stream.on("data", (chunk) => chunks.push(chunk));
  await PImage.encodePNGToStream(image, stream);
  stream.end();
  return Buffer.concat(chunks);
}

async function renderCharacterEmojiPng(assetPath, options = {}) {
  if (!PImage) throw new Error("pureimage не установлен.");
  const size = Math.max(16, Math.min(128, Number(options.size) || DISCORD_EMOJI_SIZE));
  const input = await decodeImage(fs.readFileSync(assetPath));
  const image = PImage.make(size, size);
  const ctx = image.getContext("2d");
  drawCoverImage(ctx, input, 0, 0, size, size);
  return encodePng(image);
}

module.exports = {
  DISCORD_EMOJI_MAX_BYTES,
  DISCORD_EMOJI_SIZE,
  createCharacterEmojiName,
  getCharacterEmojiRecord,
  normalizeCharacterEmojiMap,
  normalizeCharacterEmojiRecord,
  normalizeEmojiNamePart,
  renderCharacterEmojiPng,
  resolveCharacterEmojiSyncName,
  toButtonEmoji,
  toEmojiMention,
};
