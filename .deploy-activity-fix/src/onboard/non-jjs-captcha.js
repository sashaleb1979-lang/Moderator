"use strict";

const fs = require("fs");
const path = require("path");
const { PassThrough } = require("stream");

let PImage = null;
try { PImage = require("pureimage"); } catch {}

const { ensureGraphicFonts } = require("../../graphic-tierlist");

const FONT_REG = "TierlistReg";
const FONT_BOLD = "TierlistBold";
const CAPTCHA_SKILLFUL_SLOTS = [1, 2, 3, 4, 5];
const CAPTCHA_OUTLIER_SLOTS = [6, 7, 8, 9, 10];
const CAPTCHA_SUPPORTED_EXTENSIONS = [".png", ".jpg", ".jpeg"];

function setFont(ctx, px, kind = "regular") {
  ctx.font = `${Math.max(1, Math.floor(px))}px ${kind === "bold" ? FONT_BOLD : FONT_REG}`;
}

function measureText(ctx, text) {
  try {
    return Number(ctx.measureText(String(text || "")).width) || 0;
  } catch {
    return String(text || "").length * 12;
  }
}

function fitSingleLine(ctx, text, kind, maxW, startPx, minPx = 18) {
  const source = String(text || "").trim();
  if (!source) return { px: minPx, text: "" };

  for (let px = startPx; px >= minPx; px -= 2) {
    setFont(ctx, px, kind);
    if (measureText(ctx, source) <= maxW) return { px, text: source };
  }

  setFont(ctx, minPx, kind);
  let trimmed = source;
  while (trimmed.length > 1 && measureText(ctx, `${trimmed}...`) > maxW) {
    trimmed = trimmed.slice(0, -1).trimEnd();
  }
  return { px: minPx, text: trimmed.length ? `${trimmed}...` : "" };
}

function fillHex(ctx, hex) {
  const normalized = String(hex || "#cccccc").replace("#", "").trim();
  const safe = normalized.length === 6 ? normalized : "cccccc";
  const value = Number.parseInt(safe, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  ctx.fillStyle = `rgb(${r},${g},${b})`;
}

function resolveCaptchaAssetPath(assetDir, slotNumber) {
  const baseDir = path.resolve(String(assetDir || "."));
  const slot = String(Number(slotNumber) || "").trim();
  if (!slot) return "";

  for (const ext of CAPTCHA_SUPPORTED_EXTENSIONS) {
    const candidate = path.join(baseDir, `${slot}${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }

  return "";
}

function loadCaptchaCatalog(assetDir) {
  const baseDir = path.resolve(String(assetDir || "."));
  const skillful = CAPTCHA_SKILLFUL_SLOTS
    .map((slot) => ({ slot, path: resolveCaptchaAssetPath(baseDir, slot) }))
    .filter((entry) => entry.path);
  const outliers = CAPTCHA_OUTLIER_SLOTS
    .map((slot) => ({ slot, path: resolveCaptchaAssetPath(baseDir, slot) }))
    .filter((entry) => entry.path);

  return {
    assetDir: baseDir,
    skillful,
    outliers,
    missingSkillfulSlots: CAPTCHA_SKILLFUL_SLOTS.filter((slot) => !skillful.some((entry) => entry.slot === slot)),
    missingOutlierSlots: CAPTCHA_OUTLIER_SLOTS.filter((slot) => !outliers.some((entry) => entry.slot === slot)),
  };
}

function getCaptchaCatalogIssues(catalog) {
  const issues = [];
  if (!catalog?.skillful?.length) {
    issues.push("не найдено ни одной картинки для skillful-слотов 1-5");
  }
  if (!catalog?.outliers?.length) {
    issues.push("не найдено ни одной картинки для non-skillful-слотов 6-10");
  }
  return issues;
}

function pickRandomEntry(entries, random = Math.random, excludeSlot = null) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) return null;
  const filtered = excludeSlot && list.some((entry) => Number(entry.slot) !== Number(excludeSlot))
    ? list.filter((entry) => Number(entry.slot) !== Number(excludeSlot))
    : list;
  const index = Math.max(0, Math.min(filtered.length - 1, Math.floor(random() * filtered.length)));
  return filtered[index];
}

function pickRandomIndex(length, random = Math.random, excludeIndex = null) {
  if (!Number.isFinite(length) || length <= 0) return 0;
  const indexes = Array.from({ length }, (_, index) => index);
  const filtered = Number.isInteger(excludeIndex) && indexes.length > 1
    ? indexes.filter((index) => index !== excludeIndex)
    : indexes;
  return filtered[Math.max(0, Math.min(filtered.length - 1, Math.floor(random() * filtered.length)))];
}

function createCaptchaChallenge(catalog, options = {}) {
  const issues = getCaptchaCatalogIssues(catalog);
  if (issues.length) {
    throw new Error(`Капча не готова: ${issues.join("; ")}.`);
  }

  const random = typeof options.random === "function" ? options.random : Math.random;
  const previous = options.previousChallenge || null;
  const skillful = pickRandomEntry(catalog.skillful, random, previous?.skillSlot);
  const outlier = pickRandomEntry(catalog.outliers, random, previous?.outlierSlot);
  const oddIndex = pickRandomIndex(9, random, Number.isFinite(previous?.correctIndex) ? previous.correctIndex - 1 : null);

  const cells = Array.from({ length: 9 }, (_, index) => ({
    number: index + 1,
    kind: "skillful",
    slot: skillful.slot,
    assetPath: skillful.path,
  }));

  cells[oddIndex] = {
    number: oddIndex + 1,
    kind: "outlier",
    slot: outlier.slot,
    assetPath: outlier.path,
  };

  return {
    skillSlot: skillful.slot,
    outlierSlot: outlier.slot,
    correctIndex: oddIndex + 1,
    cells,
  };
}

async function decodeImageFromFile(filePath) {
  if (!PImage) throw new Error("pureimage не установлен.");
  const buffer = fs.readFileSync(filePath);
  const stream = new PassThrough();
  stream.end(buffer);
  try {
    return await PImage.decodePNGFromStream(stream);
  } catch {
    const jpegStream = new PassThrough();
    jpegStream.end(buffer);
    return PImage.decodeJPEGFromStream(jpegStream);
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

async function renderCaptchaPng(challenge, options = {}) {
  if (!PImage) throw new Error("pureimage не установлен.");
  ensureGraphicFonts();

  const width = Math.max(1080, Number(options.width) || 1280);
  const height = Math.max(1280, Number(options.height) || 1440);
  const headerHeight = 264;
  const gridPadding = 44;
  const gap = 28;
  const gridWidth = width - gridPadding * 2;
  const cellSize = Math.floor((gridWidth - gap * 2) / 3);
  const gridHeight = cellSize * 3 + gap * 2;
  const gridX = gridPadding;
  const gridY = headerHeight + 36;

  const image = PImage.make(width, Math.max(height, gridY + gridHeight + 44));
  const ctx = image.getContext("2d");

  fillHex(ctx, "#141414");
  ctx.fillRect(0, 0, image.width, image.height);
  fillHex(ctx, "#2a2116");
  ctx.fillRect(28, 28, image.width - 56, image.height - 56);
  fillHex(ctx, "#f2ead8");
  ctx.fillRect(44, 44, image.width - 88, headerHeight - 24);
  fillHex(ctx, "#101010");
  ctx.fillRect(44, headerHeight - 10, image.width - 88, 10);
  fillHex(ctx, "#1c1c1c");
  ctx.fillRect(gridX - 18, gridY - 18, gridWidth + 36, gridHeight + 36);

  const titleBlocks = [
    { text: "Капча", px: 58, y: 116, color: "#111111" },
    { text: "Скилловый персонаж", px: 42, y: 170, color: "#111111" },
    { text: "Выбери лишнее", px: 38, y: 214, color: "#5d160f" },
  ];

  for (const block of titleBlocks) {
    const fit = fitSingleLine(ctx, block.text, "bold", width - 120, block.px, 22);
    setFont(ctx, fit.px, "bold");
    fillHex(ctx, block.color);
    const textWidth = measureText(ctx, fit.text);
    ctx.fillText(fit.text, Math.floor((width - textWidth) / 2), block.y);
  }

  for (let index = 0; index < challenge.cells.length; index += 1) {
    const cell = challenge.cells[index];
    const col = index % 3;
    const row = Math.floor(index / 3);
    const x = gridX + col * (cellSize + gap);
    const y = gridY + row * (cellSize + gap);

    fillHex(ctx, "#000000");
    ctx.fillRect(x + 8, y + 12, cellSize, cellSize);
    fillHex(ctx, "#ead5a2");
    ctx.fillRect(x - 6, y - 6, cellSize + 12, cellSize + 12);
    fillHex(ctx, "#ffffff");
    ctx.fillRect(x, y, cellSize, cellSize);

    const tileImage = await decodeImageFromFile(cell.assetPath);
    drawCoverImage(ctx, tileImage, x + 8, y + 8, cellSize - 16, cellSize - 16);

    fillHex(ctx, "#111111");
    ctx.fillRect(x + 14, y + 14, 58, 58);
    fillHex(ctx, "#ead5a2");
    ctx.fillRect(x + 18, y + 18, 50, 50);
    const numberText = String(cell.number);
    setFont(ctx, 32, "bold");
    fillHex(ctx, "#111111");
    const textWidth = measureText(ctx, numberText);
    ctx.fillText(numberText, x + 18 + Math.floor((50 - textWidth) / 2), y + 52);
  }

  const chunks = [];
  const stream = new PassThrough();
  stream.on("data", (chunk) => chunks.push(chunk));
  await PImage.encodePNGToStream(image, stream);
  stream.end();
  return Buffer.concat(chunks);
}

module.exports = {
  CAPTCHA_SKILLFUL_SLOTS,
  CAPTCHA_OUTLIER_SLOTS,
  CAPTCHA_SUPPORTED_EXTENSIONS,
  createCaptchaChallenge,
  getCaptchaCatalogIssues,
  loadCaptchaCatalog,
  renderCaptchaPng,
  resolveCaptchaAssetPath,
};
