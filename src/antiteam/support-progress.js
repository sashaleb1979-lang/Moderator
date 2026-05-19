"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { PassThrough } = require("node:stream");

let PImage = null;
try { PImage = require("pureimage"); } catch {}

const FONT_REG = "AntiteamSupportRegular";
const FONT_BOLD = "AntiteamSupportBold";
let fontsReady = false;
const shieldCache = new Map();

const SUPPORT_PROGRESS_LEVELS = Object.freeze([
  {
    level: 1,
    threshold: 1,
    label: "Саппорт Ⅰ ур.",
    fileName: "anti_team_shield_level_1_transparent.png",
    accentColor: 0xF5F5F5,
    accentHex: "#f5f5f5",
    description: "Белый контур: первый подтверждённый выезд на помощь.",
  },
  {
    level: 2,
    threshold: 5,
    label: "Саппорт Ⅱ ур.",
    fileName: "anti_team_shield_level_2_transparent.png",
    accentColor: 0xE53935,
    accentHex: "#ff2a2a",
    description: "Красный знак: ты уже стабильно откликаешься на антитим.",
  },
  {
    level: 3,
    threshold: 10,
    label: "Саппорт Ⅲ ур.",
    fileName: "anti_team_shield_level_3_transparent.png",
    accentColor: 0xD32F2F,
    accentHex: "#ff1f1f",
    description: "Двухцветный щит: помощь стала заметной частью батальёна.",
  },
  {
    level: 4,
    threshold: 20,
    label: "Саппорт Ⅳ ур.",
    fileName: "anti_team_shield_level_4_transparent.png",
    accentColor: 0xC62828,
    accentHex: "#f01818",
    description: "Заполненный щит: надёжный боец, которого уже ждут в миссиях.",
  },
  {
    level: 5,
    threshold: 50,
    label: "Саппорт Ⅴ ур.",
    fileName: "anti_team_shield_level_5_transparent.png",
    accentColor: 0xB71C1C,
    accentHex: "#ff1515",
    description: "Красный контур и звезда: элитный саппорт антитима.",
  },
]);

function clamp(value, min = 0, max = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function normalizePoints(value) {
  const number = Math.floor(Number(value) || 0);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function getSupportProgressModel(pointsValue = 0) {
  const points = normalizePoints(pointsValue);
  const current = [...SUPPORT_PROGRESS_LEVELS].reverse().find((level) => points >= level.threshold) || null;
  const next = SUPPORT_PROGRESS_LEVELS.find((level) => points < level.threshold) || null;
  const displayLevel = current || SUPPORT_PROGRESS_LEVELS[0];
  const previousThreshold = current?.threshold || 0;
  const nextThreshold = next?.threshold || displayLevel.threshold;
  const segmentSize = Math.max(1, nextThreshold - previousThreshold);
  const segmentProgress = next ? clamp((points - previousThreshold) / segmentSize) : 1;
  const maxThreshold = SUPPORT_PROGRESS_LEVELS.at(-1).threshold;
  const totalProgress = clamp(points / maxThreshold);
  const remaining = next ? Math.max(0, next.threshold - points) : 0;

  return {
    points,
    current,
    displayLevel,
    next,
    remaining,
    segmentProgress,
    totalProgress,
    isMaxLevel: !next,
    title: current ? current.label : "Саппорт Ⅰ ур.",
    subtitle: current ? "Текущий уровень помощи" : "Первый уровень ещё не открыт",
    nextText: next
      ? `До ${next.label}: ${remaining} ${formatHelpWord(remaining)}`
      : "Максимальный уровень открыт.",
    pointsText: `${points} ${formatHelpWord(points)} подтверждено`,
  };
}

function formatHelpWord(value) {
  const number = Math.abs(Number(value) || 0);
  const lastTwo = number % 100;
  const last = number % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return "помощей";
  if (last === 1) return "помощь";
  if (last >= 2 && last <= 4) return "помощи";
  return "помощей";
}

function hexColor(number, fallback = "#e53935") {
  if (!Number.isSafeInteger(number)) return fallback;
  return `#${number.toString(16).padStart(6, "0").slice(-6)}`;
}

function toPngSafeRoman(text = "") {
  return String(text || "")
    .replaceAll("Ⅰ", "I")
    .replaceAll("Ⅱ", "II")
    .replaceAll("Ⅲ", "III")
    .replaceAll("Ⅳ", "IV")
    .replaceAll("Ⅴ", "V");
}

function fill(ctx, color) {
  ctx.fillStyle = color;
}

function stroke(ctx, color, width = 1) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
}

function setFont(ctx, px, kind = "regular") {
  ctx.font = `${Math.max(8, Math.floor(px))}px "${kind === "bold" ? FONT_BOLD : FONT_REG}"`;
}

function measureText(ctx, text) {
  try {
    return Number(ctx.measureText(String(text || "")).width) || 0;
  } catch {
    return String(text || "").length * 10;
  }
}

function fitText(ctx, text, maxWidth, px, minPx = 18, kind = "bold") {
  const source = String(text || "");
  for (let size = px; size >= minPx; size -= 2) {
    setFont(ctx, size, kind);
    if (measureText(ctx, source) <= maxWidth) return { text: source, px: size };
  }
  setFont(ctx, minPx, kind);
  let clipped = source;
  while (clipped.length > 1 && measureText(ctx, `${clipped}...`) > maxWidth) {
    clipped = clipped.slice(0, -1);
  }
  return { text: `${clipped}...`, px: minPx };
}

function listFontFiles() {
  const repoFontsDir = path.resolve(__dirname, "..", "..", "assets", "fonts");
  const windowsFontsDir = "C:\\Windows\\Fonts";
  return [
    [path.join(repoFontsDir, "NotoSans-Regular.ttf"), path.join(repoFontsDir, "NotoSans-Bold.ttf")],
    [path.join(repoFontsDir, "DejaVuSans.ttf"), path.join(repoFontsDir, "DejaVuSans-Bold.ttf")],
    [path.join(windowsFontsDir, "segoeui.ttf"), path.join(windowsFontsDir, "segoeuib.ttf")],
    [path.join(windowsFontsDir, "arial.ttf"), path.join(windowsFontsDir, "arialbd.ttf")],
    ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"],
    ["/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf", "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf"],
    ["/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf", "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf"],
  ];
}

function ensureFonts() {
  if (!PImage || fontsReady) return Boolean(PImage);
  fontsReady = true;
  for (const [regularFile, boldFile] of listFontFiles()) {
    if (!fs.existsSync(regularFile) || !fs.existsSync(boldFile)) continue;
    try {
      PImage.registerFont(regularFile, FONT_REG).loadSync();
      PImage.registerFont(boldFile, FONT_BOLD).loadSync();
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function defaultShieldAssetsDir() {
  return path.resolve(__dirname, "..", "..", "assets", "antiteam", "shields");
}

function resolveSupportShieldPath(level = {}, assetsDir = defaultShieldAssetsDir()) {
  const fileName = String(level?.fileName || SUPPORT_PROGRESS_LEVELS[0].fileName);
  return path.join(assetsDir, fileName);
}

async function decodeShield(level = {}, assetsDir = defaultShieldAssetsDir()) {
  if (!PImage) throw new Error("pureimage не установлен.");
  const assetPath = resolveSupportShieldPath(level, assetsDir);
  const cacheKey = assetPath;
  if (shieldCache.has(cacheKey)) return shieldCache.get(cacheKey);
  if (!fs.existsSync(assetPath)) throw new Error(`Не найден щит прогресса: ${assetPath}`);
  const image = await PImage.decodePNGFromStream(fs.createReadStream(assetPath));
  shieldCache.set(cacheKey, image);
  return image;
}

function drawContainImage(ctx, image, x, y, width, height) {
  const sourceWidth = Number(image?.width) || width;
  const sourceHeight = Number(image?.height) || height;
  const scale = Math.min(width / Math.max(1, sourceWidth), height / Math.max(1, sourceHeight));
  const targetWidth = Math.floor(sourceWidth * scale);
  const targetHeight = Math.floor(sourceHeight * scale);
  const targetX = x + Math.floor((width - targetWidth) / 2);
  const targetY = y + Math.floor((height - targetHeight) / 2);
  ctx.drawImage(image, 0, 0, sourceWidth, sourceHeight, targetX, targetY, targetWidth, targetHeight);
}

function drawRect(ctx, x, y, width, height, color) {
  fill(ctx, color);
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(width), Math.round(height));
}

function drawPanel(ctx, x, y, width, height, color = "#1b1d24", borderColor = "#313541") {
  drawRect(ctx, x + 8, y + 10, width, height, "rgba(0,0,0,0.22)");
  drawRect(ctx, x, y, width, height, color);
  stroke(ctx, borderColor, 2);
  ctx.strokeRect(x + 1, y + 1, width - 2, height - 2);
}

function drawText(ctx, text, x, y, px, color = "#ffffff", kind = "regular") {
  setFont(ctx, px, kind);
  fill(ctx, color);
  ctx.fillText(String(text || ""), Math.round(x), Math.round(y));
}

function drawMilestoneRail(ctx, model, x, y, width) {
  drawRect(ctx, x, y, width, 8, "#2a2e38");
  drawRect(ctx, x, y, Math.floor(width * model.totalProgress), 8, model.displayLevel.accentHex || "#ff2a2a");
  const maxThreshold = SUPPORT_PROGRESS_LEVELS.at(-1).threshold;
  for (const level of SUPPORT_PROGRESS_LEVELS) {
    const centerX = x + Math.floor(width * clamp(level.threshold / maxThreshold));
    const unlocked = model.points >= level.threshold;
    drawRect(ctx, centerX - 5, y - 9, 10, 26, unlocked ? (level.accentHex || "#ff2a2a") : "#474c59");
    drawText(ctx, String(level.threshold), centerX - (level.threshold >= 10 ? 12 : 6), y + 45, 20, unlocked ? "#ffffff" : "#858b99", "bold");
  }
}

function drawSegmentProgress(ctx, model, x, y, width, height) {
  drawRect(ctx, x, y, width, height, "#252a34");
  drawRect(ctx, x + 4, y + 4, width - 8, height - 8, "#111319");
  const progressWidth = Math.max(0, Math.floor((width - 8) * model.segmentProgress));
  drawRect(ctx, x + 4, y + 4, progressWidth, height - 8, model.displayLevel.accentHex || "#ff2a2a");
  stroke(ctx, "#555b68", 2);
  ctx.strokeRect(x + 1, y + 1, width - 2, height - 2);
  const percent = model.isMaxLevel ? "MAX" : `${Math.floor(model.segmentProgress * 100)}%`;
  const fit = fitText(ctx, percent, width - 20, 24, 16, "bold");
  setFont(ctx, fit.px, "bold");
  fill(ctx, "#ffffff");
  const textWidth = measureText(ctx, fit.text);
  ctx.fillText(fit.text, x + Math.floor((width - textWidth) / 2), y + Math.floor(height / 2) + 9);
}

async function renderSupportProgressCard(options = {}) {
  if (!PImage) throw new Error("pureimage не установлен.");
  ensureFonts();

  const model = options.model || getSupportProgressModel(options.points);
  const displayName = String(options.displayName || "Саппорт").trim().slice(0, 48) || "Саппорт";
  const width = Math.max(920, Number(options.width) || 1040);
  const height = Math.max(500, Number(options.height) || 520);
  const image = PImage.make(width, height);
  const ctx = image.getContext("2d");
  const accent = model.displayLevel.accentHex || hexColor(model.displayLevel.accentColor, "#e53935");

  drawRect(ctx, 0, 0, width, height, "#0f1117");
  drawRect(ctx, 0, 0, width, 8, accent);
  drawRect(ctx, 0, height - 8, width, 8, "#272b35");
  drawPanel(ctx, 34, 34, width - 68, height - 68, "#1a1d25", "#303541");

  drawRect(ctx, 58, 58, 250, 342, "#111319");
  stroke(ctx, accent, 3);
  ctx.strokeRect(60, 60, 246, 338);
  drawRect(ctx, 74, 74, 218, 300, "#08090d");

  const shield = await decodeShield(model.displayLevel, options.assetsDir || defaultShieldAssetsDir());
  drawContainImage(ctx, shield, 74, 76, 218, 264);
  drawText(ctx, model.current ? `LEVEL ${model.displayLevel.level}` : "LOCKED", 118, 378, 24, model.current ? "#ffffff" : "#9aa1ad", "bold");

  drawText(ctx, "АНТИТИМ SUPPORT", 350, 86, 22, "#9da5b4", "bold");
  const title = fitText(ctx, toPngSafeRoman(model.title), width - 410, 58, 32, "bold");
  drawText(ctx, title.text, 348, 142, title.px, "#ffffff", "bold");
  drawText(ctx, model.subtitle, 352, 180, 24, "#c9ced8", "regular");
  drawText(ctx, displayName, 352, 220, 28, "#ffffff", "bold");
  drawText(ctx, model.pointsText, 352, 254, 28, accent, "bold");

  drawSegmentProgress(ctx, model, 350, 286, width - 420, 46);
  drawText(ctx, toPngSafeRoman(model.nextText), 350, 370, 25, "#ffffff", "bold");
  const description = fitText(ctx, model.displayLevel.description, width - 410, 22, 16, "regular");
  drawText(ctx, description.text, 350, 408, description.px, "#aeb5c2", "regular");
  drawMilestoneRail(ctx, model, 352, 448, width - 426);

  drawRect(ctx, width - 270, 64, 196, 44, "#111319");
  stroke(ctx, accent, 2);
  ctx.strokeRect(width - 270, 64, 196, 44);
  drawText(ctx, model.isMaxLevel ? "ПИК ОТКРЫТ" : "ДО НОВОГО УР.", width - 252, 94, 21, "#ffffff", "bold");

  const chunks = [];
  const stream = new PassThrough();
  stream.on("data", (chunk) => chunks.push(chunk));
  await PImage.encodePNGToStream(image, stream);
  stream.end();
  return Buffer.concat(chunks);
}

module.exports = {
  SUPPORT_PROGRESS_LEVELS,
  defaultShieldAssetsDir,
  formatHelpWord,
  getSupportProgressModel,
  renderSupportProgressCard,
  resolveSupportShieldPath,
  toPngSafeRoman,
};
