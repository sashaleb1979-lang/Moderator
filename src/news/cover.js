"use strict";

const fs = require("fs");
const path = require("path");
const { PassThrough } = require("stream");

let PImage = null;
try {
  PImage = require("pureimage");
} catch {}

const FONT_REG = "DailyNewsCoverReg";
const FONT_BOLD = "DailyNewsCoverBold";
let fontsReady = false;

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function normalizePositiveInteger(value, fallback) {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : fallback;
}

function listFontFiles() {
  const fontsDir = path.join(__dirname, "..", "..", "assets", "fonts");
  if (!fs.existsSync(fontsDir)) return [];
  return fs.readdirSync(fontsDir)
    .filter((fileName) => /\.ttf$/i.test(fileName))
    .map((fileName) => path.join(fontsDir, fileName));
}

function pickFontFiles() {
  const files = listFontFiles();
  const regularFile = files.find((filePath) => /regular/i.test(path.basename(filePath))) || files[0] || null;
  const boldFile = files.find((filePath) => /bold/i.test(path.basename(filePath))) || regularFile;
  return { regularFile, boldFile };
}

function ensureFonts() {
  if (!PImage) return false;
  if (fontsReady) return true;

  const picked = pickFontFiles();
  try {
    if (picked.regularFile) PImage.registerFont(picked.regularFile, FONT_REG).loadSync();
    if (picked.boldFile) PImage.registerFont(picked.boldFile, FONT_BOLD).loadSync();
    fontsReady = true;
    return Boolean(picked.regularFile && picked.boldFile);
  } catch {
    fontsReady = true;
    return false;
  }
}

function hexToRgb(hex) {
  const normalized = cleanString(hex, 16).replace(/^#/, "") || "cccccc";
  const number = Number.parseInt(normalized, 16);
  return {
    r: (number >> 16) & 255,
    g: (number >> 8) & 255,
    b: number & 255,
  };
}

function fill(ctx, hex) {
  const { r, g, b } = hexToRgb(hex);
  ctx.fillStyle = `rgb(${r},${g},${b})`;
}

function encodePngToBuffer(image) {
  const chunks = [];
  const stream = new PassThrough();
  stream.on("data", (chunk) => chunks.push(chunk));
  return PImage.encodePNGToStream(image, stream).then(() => {
    stream.end();
    return Buffer.concat(chunks);
  });
}

function wrapText(ctx, text, maxWidth) {
  const words = cleanString(text, 1000).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let currentLine = "";

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (!currentLine || ctx.measureText(candidate).width <= maxWidth) {
      currentLine = candidate;
      continue;
    }
    lines.push(currentLine);
    currentLine = word;
  }

  if (currentLine) lines.push(currentLine);
  return lines;
}

function drawMetricCard(ctx, metric, x, y, width, height, colors) {
  fill(ctx, colors.cardBg);
  ctx.fillRect(x, y, width, height);

  fill(ctx, colors.accent);
  ctx.fillRect(x, y, 10, height);

  fill(ctx, colors.label);
  ctx.font = `24px '${FONT_BOLD}'`;
  ctx.fillText(cleanString(metric.label, 60) || "Metric", x + 28, y + 36);

  fill(ctx, colors.value);
  ctx.font = `48px '${FONT_BOLD}'`;
  ctx.fillText(cleanString(metric.value, 40) || "0", x + 28, y + 90);

  const iconText = cleanString(metric.icon, 20);
  if (iconText) {
    fill(ctx, colors.label);
    ctx.font = `22px '${FONT_REG}'`;
    ctx.fillText(iconText, x + width - 48, y + 34);
  }
}

async function renderDailyNewsCoverPng(coverSpec = {}, options = {}) {
  if (!PImage) {
    throw new Error("pureimage не установлен.");
  }

  ensureFonts();

  const width = normalizePositiveInteger(options.width, 1600);
  const height = normalizePositiveInteger(options.height, 900);
  const image = PImage.make(width, height);
  const ctx = image.getContext("2d");

  const backgroundColor = cleanString(coverSpec.backgroundColor, 16) || "#101418";
  const accentColor = cleanString(coverSpec.accentColor, 16) || "#D6A441";
  const accentColorAlt = cleanString(coverSpec.accentColorAlt, 16) || "#5DA9E9";
  const colors = {
    accent: accentColor,
    accentAlt: accentColorAlt,
    cardBg: "#182129",
    label: "#C7D2DA",
    value: "#F7F4EA",
    body: "#E5ECF2",
  };

  fill(ctx, backgroundColor);
  ctx.fillRect(0, 0, width, height);

  fill(ctx, accentColor);
  ctx.fillRect(0, 0, width, 18);
  fill(ctx, accentColorAlt);
  ctx.fillRect(width - 420, 18, 420, 14);
  fill(ctx, "#141B22");
  ctx.fillRect(72, 88, width - 144, height - 176);
  fill(ctx, "#1B242D");
  ctx.fillRect(width - 340, 88, 220, height - 176);

  fill(ctx, colors.label);
  ctx.font = `30px '${FONT_BOLD}'`;
  ctx.fillText(cleanString(coverSpec.masthead, 120) || "Daily Edition", 96, 146);

  fill(ctx, colors.value);
  ctx.font = `78px '${FONT_BOLD}'`;
  ctx.fillText(cleanString(coverSpec.title, 160) || "Daily Issue", 96, 246);

  fill(ctx, colors.body);
  ctx.font = `28px '${FONT_REG}'`;
  const subtitleLines = wrapText(ctx, cleanString(coverSpec.subtitle, 320) || "Главный сюжет дня пока не определён.", width - 520);
  subtitleLines.slice(0, 4).forEach((line, index) => {
    ctx.fillText(line, 96, 314 + index * 38);
  });

  fill(ctx, accentColorAlt);
  ctx.fillRect(96, 420, 240, 6);
  fill(ctx, accentColor);
  ctx.fillRect(96, 440, 320, 6);

  fill(ctx, colors.label);
  ctx.font = `22px '${FONT_BOLD}'`;
  ctx.fillText(cleanString(coverSpec.visualMode, 40).toUpperCase() || "EDITION", width - 302, 146);

  const metrics = Array.isArray(coverSpec.metrics) ? coverSpec.metrics.slice(0, 6) : [];
  const cardsY = height - 280;
  const columns = 3;
  const gap = 18;
  const cardWidth = Math.floor((width - 192 - gap * (columns - 1)) / columns);
  const cardHeight = 110;

  for (let index = 0; index < metrics.length; index += 1) {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const x = 96 + column * (cardWidth + gap);
    const y = cardsY + row * (cardHeight + gap);
    drawMetricCard(ctx, {
      label: cleanString(metrics[index]?.label, 60),
      value: String(metrics[index]?.value ?? 0),
      icon: cleanString(metrics[index]?.icon, 20),
    }, x, y, cardWidth, cardHeight, colors);
  }

  return encodePngToBuffer(image);
}

async function buildDailyNewsCoverAttachment(issue = {}, options = {}) {
  const dayKey = cleanString(options.dayKey || issue?.dayKey, 40) || "issue";
  const fileName = cleanString(options.fileName, 120) || `daily-news-${dayKey}.png`;
  const buffer = await renderDailyNewsCoverPng(issue?.coverSpec || {}, options);
  return {
    name: fileName,
    attachment: buffer,
  };
}

module.exports = {
  buildDailyNewsCoverAttachment,
  renderDailyNewsCoverPng,
};