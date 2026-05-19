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

function drawCenteredText(ctx, text, x, y, width, px, color = "#ffffff", kind = "regular", minPx = 14) {
  const fit = fitText(ctx, text, width, px, minPx, kind);
  setFont(ctx, fit.px, kind);
  fill(ctx, color);
  const textWidth = measureText(ctx, fit.text);
  ctx.fillText(fit.text, Math.round(x + (width - textWidth) / 2), Math.round(y));
}

function drawMilestoneRail(ctx, model, x, y, width) {
  drawRect(ctx, x, y, width, 6, "#2a2e38");
  drawRect(ctx, x, y, Math.floor(width * model.totalProgress), 6, model.displayLevel.accentHex || "#ff2a2a");
  const maxThreshold = SUPPORT_PROGRESS_LEVELS.at(-1).threshold;
  for (const level of SUPPORT_PROGRESS_LEVELS) {
    const centerX = x + Math.floor(width * clamp(level.threshold / maxThreshold));
    const unlocked = model.points >= level.threshold;
    const markerColor = unlocked ? (level.accentHex || "#ff2a2a") : "#474c59";
    drawRect(ctx, centerX - 5, y - 10, 10, 26, markerColor);
    drawRect(ctx, centerX - 2, y - 15, 4, 36, unlocked ? "#ffffff" : "#5d6370");
    drawCenteredText(ctx, String(level.threshold), centerX - 22, y + 42, 44, 19, unlocked ? "#ffffff" : "#858b99", "bold", 14);
  }
}

function drawSegmentProgress(ctx, model, x, y, width, height) {
  drawRect(ctx, x, y, width, height, "#2c313d");
  drawRect(ctx, x + 4, y + 4, width - 8, height - 8, "#10131a");
  const progressWidth = Math.max(0, Math.floor((width - 8) * model.segmentProgress));
  if (progressWidth > 0) {
    drawRect(ctx, x + 4, y + 4, progressWidth, height - 8, model.displayLevel.accentHex || "#ff2a2a");
  }
  stroke(ctx, "#555b68", 2);
  ctx.strokeRect(x + 1, y + 1, width - 2, height - 2);
  const targetThreshold = model.next?.threshold || SUPPORT_PROGRESS_LEVELS.at(-1).threshold;
  const progressText = model.isMaxLevel ? "MAX" : `${model.points} / ${targetThreshold}`;
  drawCenteredText(ctx, progressText, x + 10, y + Math.floor(height / 2) + 9, width - 20, 24, "#ffffff", "bold", 16);
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
  const panelX = 34;
  const panelY = 34;
  const panelWidth = width - 68;
  const panelHeight = height - 68;
  const leftX = 58;
  const leftY = 68;
  const leftWidth = 238;
  const leftHeight = 352;
  const contentX = 348;
  const contentRight = width - 72;
  const contentWidth = contentRight - contentX;
  const chipWidth = 186;
  const chipX = contentRight - chipWidth;

  drawRect(ctx, 0, 0, width, height, "#0f1117");
  drawRect(ctx, 0, 0, width, 8, accent);
  drawRect(ctx, 0, height - 8, width, 8, "#272b35");
  drawPanel(ctx, panelX, panelY, panelWidth, panelHeight, "#1a1d25", "#303541");

  drawRect(ctx, leftX + 8, leftY + 8, leftWidth, leftHeight, "rgba(0,0,0,0.16)");
  drawRect(ctx, leftX, leftY, leftWidth, leftHeight, "#11141b");
  stroke(ctx, "#323846", 2);
  ctx.strokeRect(leftX + 1, leftY + 1, leftWidth - 2, leftHeight - 2);
  drawRect(ctx, leftX, leftY, 5, leftHeight, accent);
  drawRect(ctx, leftX + 16, leftY + 16, leftWidth - 32, 252, "#08090d");

  const shield = await decodeShield(model.displayLevel, options.assetsDir || defaultShieldAssetsDir());
  drawContainImage(ctx, shield, leftX + 42, leftY + 52, leftWidth - 84, 184);
  drawCenteredText(ctx, model.current ? `LEVEL ${model.displayLevel.level}` : "LOCKED", leftX + 18, leftY + 308, leftWidth - 36, 24, model.current ? "#ffffff" : "#9aa1ad", "bold", 18);

  drawText(ctx, "АНТИТИМ SUPPORT", contentX, 86, 22, "#9da5b4", "bold");
  drawRect(ctx, chipX, 64, chipWidth, 44, "#111319");
  stroke(ctx, accent, 2);
  ctx.strokeRect(chipX + 1, 65, chipWidth - 2, 42);
  drawCenteredText(ctx, model.isMaxLevel ? "ПИК ОТКРЫТ" : "ДО НОВОГО УР.", chipX + 12, 94, chipWidth - 24, 20, "#ffffff", "bold", 14);

  const titleMaxWidth = Math.max(320, chipX - contentX - 34);
  const title = fitText(ctx, toPngSafeRoman(model.title), titleMaxWidth, 52, 32, "bold");
  drawText(ctx, title.text, contentX - 2, 142, title.px, "#ffffff", "bold");
  drawText(ctx, model.subtitle, contentX + 2, 180, 24, "#c9ced8", "regular");
  const displayNameFit = fitText(ctx, displayName, contentWidth, 28, 18, "bold");
  drawText(ctx, displayNameFit.text, contentX + 2, 220, displayNameFit.px, "#ffffff", "bold");
  const pointsFit = fitText(ctx, model.pointsText, contentWidth, 28, 18, "bold");
  drawText(ctx, pointsFit.text, contentX + 2, 254, pointsFit.px, accent, "bold");

  drawSegmentProgress(ctx, model, contentX, 286, contentWidth, 46);
  const nextText = fitText(ctx, toPngSafeRoman(model.nextText), contentWidth, 25, 17, "bold");
  drawText(ctx, nextText.text, contentX, 370, nextText.px, "#ffffff", "bold");
  const description = fitText(ctx, model.displayLevel.description, contentWidth, 22, 16, "regular");
  drawText(ctx, description.text, contentX, 408, description.px, "#aeb5c2", "regular");
  drawMilestoneRail(ctx, model, contentX + 4, 448, contentWidth - 8);

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
