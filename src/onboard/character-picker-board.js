"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { PassThrough } = require("node:stream");

let PImage = null;
try { PImage = require("pureimage"); } catch {}

const CHARACTER_PICKER_COLUMNS = 5;
const CHARACTER_PICKER_ROWS = 4;
const CHARACTER_PICKER_PAGE_SIZE = CHARACTER_PICKER_COLUMNS * CHARACTER_PICKER_ROWS;

const FONT_REG = "OnboardPickerReg";
const FONT_BOLD = "OnboardPickerBold";
let fontsReady = false;

function cleanString(value, limit = 256) {
  return String(value || "").trim().slice(0, limit);
}

function pickFontPair() {
  const root = path.resolve(__dirname, "../..");
  const assets = path.join(root, "assets", "fonts");
  const winFonts = process.platform === "win32" ? path.join(process.env.WINDIR || "C:\\Windows", "Fonts") : "";
  const pairs = [
    [path.join(assets, "NotoSans-Regular.ttf.ttf"), path.join(assets, "NotoSans-Bold.ttf.ttf")],
    [path.join(assets, "NotoSans-Regular.ttf"), path.join(assets, "NotoSans-Bold.ttf")],
    [path.join(winFonts, "segoeui.ttf"), path.join(winFonts, "segoeuib.ttf")],
    [path.join(winFonts, "arial.ttf"), path.join(winFonts, "arialbd.ttf")],
    ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"],
  ];
  return pairs.find(([regular, bold]) => fs.existsSync(regular) && fs.existsSync(bold)) || null;
}

function ensureFonts() {
  if (!PImage || fontsReady) return fontsReady;
  const pair = pickFontPair();
  if (!pair) return false;
  try {
    PImage.registerFont(pair[0], FONT_REG).loadSync();
    PImage.registerFont(pair[1], FONT_BOLD).loadSync();
    fontsReady = true;
  } catch {
    fontsReady = false;
  }
  return fontsReady;
}

function setFont(ctx, px, bold = false) {
  ctx.font = `${Math.max(1, Math.floor(px))}px ${bold ? FONT_BOLD : FONT_REG}`;
}

function measureText(ctx, text) {
  try { return Number(ctx.measureText(String(text || "")).width) || 0; } catch { return String(text || "").length * 12; }
}

function trimToWidth(ctx, text, maxWidth) {
  let out = cleanString(text, 120);
  if (!out) return "";
  if (measureText(ctx, out) <= maxWidth) return out;
  while (out.length > 1 && measureText(ctx, `${out}...`) > maxWidth) out = out.slice(0, -1).trimEnd();
  return out ? `${out}...` : "";
}

function fill(ctx, color) {
  ctx.fillStyle = color;
}

function stroke(ctx, color) {
  ctx.strokeStyle = color;
}

function paginateCharacterPickerEntries(entries = [], rawPage = 0, pageSize = CHARACTER_PICKER_PAGE_SIZE) {
  const safeEntries = Array.isArray(entries) ? entries : [];
  const safePageSize = Math.max(1, Number(pageSize) || CHARACTER_PICKER_PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(safeEntries.length / safePageSize));
  const page = Math.min(Math.max(0, Number(rawPage) || 0), pageCount - 1);
  const start = page * safePageSize;
  return {
    items: safeEntries.slice(start, start + safePageSize),
    totalCount: safeEntries.length,
    page,
    pageCount,
    hasPrev: page > 0,
    hasNext: page + 1 < pageCount,
    startIndex: start,
  };
}

function toggleCharacterPickerSelection(selectedIds = [], characterId = "", options = {}) {
  const max = Math.max(1, Number(options.max) || 2);
  const id = cleanString(characterId, 120);
  const current = [...new Set(
    (Array.isArray(selectedIds) ? selectedIds : [])
      .map((value) => cleanString(value, 120))
      .filter(Boolean)
  )].slice(0, max);
  if (!id) return { selectedIds: current, blocked: true, reason: "unknown-character" };
  if (current.includes(id)) {
    return { selectedIds: current.filter((value) => value !== id), blocked: false, reason: "removed" };
  }
  if (current.length >= max) {
    return { selectedIds: current, blocked: true, reason: "max-selected" };
  }
  return { selectedIds: [...current, id], blocked: false, reason: "added" };
}

function getCharacterAssetPath(entry = {}, assetsDir = "") {
  const explicit = cleanString(entry.assetPath, 500);
  if (explicit) return explicit;
  const id = cleanString(entry.id, 120);
  return id && assetsDir ? path.join(assetsDir, `${id}.png`) : "";
}

function bufferToStream(buffer) {
  const stream = new PassThrough();
  stream.end(buffer);
  return stream;
}

async function decodeImage(filePath) {
  const buffer = fs.readFileSync(filePath);
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

async function drawCharacterTile(ctx, entry, options = {}) {
  const {
    x,
    y,
    width,
    height,
    number,
    selected,
    assetsDir,
  } = options;
  const border = selected ? "#2ee59d" : "#3b3d46";
  fill(ctx, selected ? "#142f29" : "#1f2028");
  ctx.fillRect(x, y, width, height);
  fill(ctx, "#101118");
  ctx.fillRect(x + 7, y + 9, width - 14, height - 18);
  stroke(ctx, border);
  ctx.lineWidth = selected ? 8 : 3;
  ctx.strokeRect(x + 3, y + 3, width - 6, height - 6);

  const imagePath = getCharacterAssetPath(entry, assetsDir);
  if (imagePath && fs.existsSync(imagePath)) {
    const image = await decodeImage(imagePath);
    drawCoverImage(ctx, image, x + 12, y + 12, width - 24, height - 58);
  } else {
    fill(ctx, "#2b2d37");
    ctx.fillRect(x + 12, y + 12, width - 24, height - 58);
  }

  fill(ctx, "#111318");
  ctx.fillRect(x + 16, y + 16, 52, 42);
  fill(ctx, selected ? "#2ee59d" : "#ffffff");
  setFont(ctx, 26, true);
  const numberText = String(number).padStart(2, "0");
  ctx.fillText(numberText, x + 24, y + 47);

  fill(ctx, selected ? "#2ee59d" : "#f2f3f5");
  setFont(ctx, 22, true);
  const label = trimToWidth(ctx, entry.label || entry.id || "Character", width - 24);
  ctx.fillText(label, x + 12, y + height - 20);
}

async function renderCharacterPickerBoardPng(options = {}) {
  if (!PImage) throw new Error("pureimage не установлен.");
  ensureFonts();

  const entries = Array.isArray(options.entries) ? options.entries : [];
  const pageInfo = options.pageInfo || paginateCharacterPickerEntries(entries, options.page);
  const pageItems = Array.isArray(options.pageItems) ? options.pageItems : pageInfo.items;
  const selectedIds = new Set((Array.isArray(options.selectedIds) ? options.selectedIds : []).map((value) => cleanString(value, 120)));
  const assetsDir = cleanString(options.assetsDir, 500);
  const width = Math.max(1100, Number(options.width) || 1400);
  const gap = 18;
  const margin = 38;
  const headerHeight = 130;
  const tileWidth = Math.floor((width - margin * 2 - gap * (CHARACTER_PICKER_COLUMNS - 1)) / CHARACTER_PICKER_COLUMNS);
  const tileHeight = Math.floor(tileWidth * 1.18);
  const height = headerHeight + margin + CHARACTER_PICKER_ROWS * tileHeight + (CHARACTER_PICKER_ROWS - 1) * gap + margin;
  const image = PImage.make(width, height);
  const ctx = image.getContext("2d");

  fill(ctx, "#171821");
  ctx.fillRect(0, 0, width, height);
  fill(ctx, "#242633");
  ctx.fillRect(20, 20, width - 40, height - 40);
  fill(ctx, "#11131a");
  ctx.fillRect(30, 30, width - 60, headerHeight - 12);
  setFont(ctx, 42, true);
  fill(ctx, "#f4f5fb");
  ctx.fillText("Выбор мейнов", margin, 82);
  setFont(ctx, 24, false);
  fill(ctx, "#9da3b5");
  ctx.fillText(`Страница ${pageInfo.page + 1}/${pageInfo.pageCount} • выбери 1-2 персонажей кнопками ниже`, margin, 116);

  for (let index = 0; index < pageItems.length; index += 1) {
    const entry = pageItems[index];
    const col = index % CHARACTER_PICKER_COLUMNS;
    const row = Math.floor(index / CHARACTER_PICKER_COLUMNS);
    const x = margin + col * (tileWidth + gap);
    const y = headerHeight + margin + row * (tileHeight + gap);
    await drawCharacterTile(ctx, entry, {
      x,
      y,
      width: tileWidth,
      height: tileHeight,
      number: pageInfo.startIndex + index + 1,
      selected: selectedIds.has(entry.id),
      assetsDir,
    });
  }

  return encodePng(image);
}

module.exports = {
  CHARACTER_PICKER_COLUMNS,
  CHARACTER_PICKER_PAGE_SIZE,
  CHARACTER_PICKER_ROWS,
  paginateCharacterPickerEntries,
  renderCharacterPickerBoardPng,
  toggleCharacterPickerSelection,
};
