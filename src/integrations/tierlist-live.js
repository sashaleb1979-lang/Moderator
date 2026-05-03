"use strict";

const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const { PassThrough } = require("stream");
const { EmbedBuilder } = require("discord.js");

let PImage = null;
try {
  PImage = require("pureimage");
} catch {}

const LEGACY_TIERLIST_TITLE = "Tier List";
const LEGACY_TIER_ORDER = ["S", "A", "B", "C", "D"];
const LEGACY_TIER_OFFSETS = { S: 2, A: 1, B: 0, C: -1, D: -2 };
const LEGACY_TIER_DEFAULTS = {
  S: { name: "Супер", color: "#ff6b6b" },
  A: { name: "Сильный", color: "#ffbe76" },
  B: { name: "Норма", color: "#f9f871" },
  C: { name: "Слабый", color: "#7bed9f" },
  D: { name: "Мусор", color: "#74b9ff" },
};
const DEFAULT_IMAGE_WIDTH = 2000;
const DEFAULT_IMAGE_HEIGHT = 1200;
const DEFAULT_ICON_SIZE = 112;

const FONT_REG = "LegacyTierlistReg";
const FONT_BOLD = "LegacyTierlistBold";
let fontsReady = false;
const iconCache = new Map();

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function copyJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function loadJsonIfExists(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function saveJsonAtomic(filePath, value) {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tempPath, filePath);
}

function writeBufferAtomic(filePath, buffer) {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, buffer);
  fs.renameSync(tempPath, filePath);
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleString("ru-RU");
}

function normalizePositiveNumber(value, fallback) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : fallback;
}

function normalizeTierKey(value) {
  const tierKey = cleanString(value, 1).toUpperCase();
  return Object.prototype.hasOwnProperty.call(LEGACY_TIER_OFFSETS, tierKey) ? tierKey : "B";
}

function getTierState(rawState, tierKey) {
  return rawState?.tiers?.[tierKey] || LEGACY_TIER_DEFAULTS[tierKey] || { name: tierKey, color: "#cccccc" };
}

function getLegacyTierlistImageConfig(rawState = {}) {
  const image = rawState?.settings?.image || {};
  return {
    W: Math.max(1200, Number(image.width) || DEFAULT_IMAGE_WIDTH),
    H: Math.max(700, Number(image.height) || DEFAULT_IMAGE_HEIGHT),
    ICON: Math.max(64, Number(image.icon) || DEFAULT_ICON_SIZE),
  };
}

function listFontFiles() {
  const repoFontsDir = path.resolve(__dirname, "../../assets/fonts");
  const windowsFontsDir = process.platform === "win32"
    ? path.join(process.env.WINDIR || "C:\\Windows", "Fonts")
    : null;
  const dirs = [
    repoFontsDir,
    ...(windowsFontsDir ? [windowsFontsDir] : []),
    "/usr/share/fonts/truetype/dejavu",
    "/usr/share/fonts/truetype/liberation2",
    "/usr/share/fonts/truetype/liberation",
    "/usr/share/fonts/truetype/freefont",
    "/usr/share/fonts/truetype/noto",
  ];

  const files = [];
  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir)) {
        if (/\.ttf$/i.test(name)) files.push(path.join(dir, name));
      }
    } catch {}
  }
  return files;
}

function pickFontFiles() {
  const repoFontsDir = path.resolve(__dirname, "../../assets/fonts");
  const windowsFontsDir = process.platform === "win32"
    ? path.join(process.env.WINDIR || "C:\\Windows", "Fonts")
    : "";
  const pairs = [
    [path.join(repoFontsDir, "NotoSans-Regular.ttf"), path.join(repoFontsDir, "NotoSans-Bold.ttf")],
    [path.join(repoFontsDir, "DejaVuSans.ttf"), path.join(repoFontsDir, "DejaVuSans-Bold.ttf")],
    [path.join(repoFontsDir, "montserrat-bold.ttf"), path.join(repoFontsDir, "montserrat-bold.ttf")],
    [path.join(windowsFontsDir, "arial.ttf"), path.join(windowsFontsDir, "arialbd.ttf")],
    [path.join(windowsFontsDir, "segoeui.ttf"), path.join(windowsFontsDir, "segoeuib.ttf")],
    ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"],
    ["/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf", "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf"],
    ["/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf", "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf"],
  ];

  for (const [regularFile, boldFile] of pairs) {
    if (fs.existsSync(regularFile) && fs.existsSync(boldFile)) {
      return { regularFile, boldFile };
    }
  }

  const anyFiles = listFontFiles();
  if (anyFiles.length) {
    return { regularFile: anyFiles[0], boldFile: anyFiles[0] };
  }

  return { regularFile: null, boldFile: null };
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

function getLegacyTierlistFontDebugInfo() {
  const files = listFontFiles();
  const picked = pickFontFiles();
  return {
    files,
    regularFile: picked.regularFile,
    boldFile: picked.boldFile,
    usedFallback: Boolean(picked.regularFile && picked.boldFile && picked.regularFile === picked.boldFile),
  };
}

function hexToRgb(hex) {
  const normalized = String(hex || "#cccccc").replace("#", "");
  const number = parseInt(normalized, 16);
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

function encodePngToBuffer(img) {
  const chunks = [];
  const stream = new PassThrough();
  stream.on("data", (chunk) => chunks.push(chunk));
  return PImage.encodePNGToStream(img, stream).then(() => {
    stream.end();
    return Buffer.concat(chunks);
  });
}

function bufferToStream(buffer) {
  const stream = new PassThrough();
  stream.end(buffer);
  return stream;
}

function downloadBuffer(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error("Слишком много редиректов при скачивании картинки."));
      return;
    }

    const text = cleanString(url, 2000);
    if (!/^https?:\/\//i.test(text)) {
      reject(new Error("Нужен прямой http/https URL на PNG/JPG картинку."));
      return;
    }

    const transport = text.startsWith("https:") ? https : http;
    const request = transport.get(text, (response) => {
      if (response.statusCode && [301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        const nextUrl = new URL(response.headers.location, text).toString();
        response.resume();
        resolve(downloadBuffer(nextUrl, redirects + 1));
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Не удалось скачать картинку (${response.statusCode || "unknown"}).`));
        return;
      }

      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve(Buffer.concat(chunks)));
      response.on("error", reject);
    });

    request.on("error", reject);
  });
}

async function decodeImageBuffer(buffer) {
  if (!PImage) throw new Error("pureimage не установлен.");

  try {
    return await PImage.decodePNGFromStream(bufferToStream(buffer));
  } catch {}

  try {
    return await PImage.decodeJPEGFromStream(bufferToStream(buffer));
  } catch {}

  throw new Error("Поддерживаются только PNG и JPG/JPEG.");
}

async function normalizeLegacyTierlistCharacterImageBuffer(buffer, size = 512) {
  const input = await decodeImageBuffer(buffer);
  if (!input?.width || !input?.height) {
    throw new Error("Не удалось прочитать размеры картинки.");
  }

  const canvas = PImage.make(size, size);
  const ctx = canvas.getContext("2d");
  const scale = Math.min(size / input.width, size / input.height);
  const drawW = Math.max(1, Math.round(input.width * scale));
  const drawH = Math.max(1, Math.round(input.height * scale));
  const x = Math.floor((size - drawW) / 2);
  const y = Math.floor((size - drawH) / 2);

  ctx.drawImage(input, x, y, drawW, drawH);
  return encodePngToBuffer(canvas);
}

function mergeLegacyTierlistCharacters(baseCharacterCatalog = [], customCharacters = []) {
  const merged = [];
  const seen = new Set();

  for (const source of [baseCharacterCatalog, customCharacters]) {
    if (!Array.isArray(source)) continue;
    for (const entry of source) {
      const id = cleanString(entry?.id, 80);
      if (!id || seen.has(id)) continue;
      seen.add(id);

      merged.push({
        id,
        name: cleanString(entry?.name || entry?.label || id, 120) || id,
        enabled: entry?.enabled !== false,
      });
    }
  }

  return merged.filter((entry) => entry.enabled !== false);
}

function readLegacyTierlistCustomCharacters(liveState) {
  return loadJsonIfExists(liveState?.customCharactersPath, []);
}

function getLegacyTierlistUserMainIds(rawUser = {}) {
  const mainIds = Array.isArray(rawUser?.mainIds) ? rawUser.mainIds : [];
  const fallback = mainIds.length ? mainIds : (rawUser?.mainId ? [rawUser.mainId] : []);
  return [...new Set(fallback
    .map((value) => cleanString(value, 80))
    .filter(Boolean))].slice(0, 2);
}

function appendLegacyTierlistCharacterToActiveWizards(rawState, characterId) {
  for (const userId of Object.keys(rawState?.users || {})) {
    const user = rawState.users[userId];
    const wizardMode = String(user?.wizMode || "").trim();
    const mainIds = getLegacyTierlistUserMainIds(user);
    if (!["full", "new"].includes(wizardMode)) continue;
    if (!mainIds.length || !Array.isArray(user.wizQueue) || (user.wizIndex || 0) >= user.wizQueue.length) continue;
    if (mainIds.includes(characterId)) continue;
    if (user.wizQueue.includes(characterId)) continue;
    user.wizQueue.push(characterId);
  }
}

async function addLegacyTierlistCustomCharacter(liveState, options = {}) {
  const characterId = cleanString(options.id, 80);
  const name = cleanString(options.name, 100);
  const imageUrl = cleanString(options.imageUrl, 2000);

  if (!characterId) throw new Error("Не удалось получить id персонажа.");
  if (!name) throw new Error("Имя персонажа пустое.");
  if (!imageUrl) throw new Error("Нужен прямой URL картинки.");
  if (liveState?.charById?.has(characterId)) {
    throw new Error(`Персонаж с id ${characterId} уже существует.`);
  }

  const imageBuffer = await downloadBuffer(imageUrl);
  const normalizedPng = await normalizeLegacyTierlistCharacterImageBuffer(imageBuffer, 512);
  const customCharacters = readLegacyTierlistCustomCharacters(liveState);
  if (customCharacters.some((entry) => cleanString(entry?.id, 80) === characterId)) {
    throw new Error(`Персонаж с id ${characterId} уже существует.`);
  }

  const entry = { id: characterId, name, enabled: true };
  const nextCustomCharacters = [...customCharacters, entry];
  const imagePath = path.join(liveState.customCharactersDir, `${characterId}.png`);
  let imageWritten = false;

  try {
    writeBufferAtomic(imagePath, normalizedPng);
    imageWritten = true;
    saveJsonAtomic(liveState.customCharactersPath, nextCustomCharacters);
  } catch (error) {
    if (imageWritten) {
      try {
        fs.unlinkSync(imagePath);
      } catch {}
    }
    throw error;
  }

  iconCache.delete(characterId);
  appendLegacyTierlistCharacterToActiveWizards(liveState.rawState, characterId);
  liveState.characters = mergeLegacyTierlistCharacters(liveState.characters, [entry]);
  liveState.charById = new Map(liveState.characters.map((item) => [item.id, item]));

  return {
    entry,
    imagePath,
    customCharacters: nextCustomCharacters,
  };
}

function createDefaultLegacyTierlistState() {
  return {
    settings: {
      channelId: null,
      dashboardMessageId: null,
      lastUpdated: 0,
      summaryChannelId: null,
      summaryMessageId: null,
      summaryLastUpdated: 0,
      image: {
        width: null,
        height: null,
        icon: null,
      },
    },
    tiers: copyJson(LEGACY_TIER_DEFAULTS),
    users: {},
    draftVotes: {},
    finalVotes: {},
  };
}

function ensureLegacyTierlistStateShape(rawValue = {}) {
  const source = rawValue && typeof rawValue === "object" ? rawValue : {};
  const defaults = createDefaultLegacyTierlistState();

  source.settings ||= defaults.settings;
  source.settings.image ||= defaults.settings.image;
  if (!Object.prototype.hasOwnProperty.call(source.settings, "summaryChannelId")) {
    source.settings.summaryChannelId = defaults.settings.summaryChannelId;
  }
  if (!Object.prototype.hasOwnProperty.call(source.settings, "summaryMessageId")) {
    source.settings.summaryMessageId = defaults.settings.summaryMessageId;
  }
  if (!Object.prototype.hasOwnProperty.call(source.settings, "summaryLastUpdated")) {
    source.settings.summaryLastUpdated = defaults.settings.summaryLastUpdated;
  }

  source.tiers = {
    ...copyJson(LEGACY_TIER_DEFAULTS),
    ...(source.tiers && typeof source.tiers === "object" ? source.tiers : {}),
  };
  source.users ||= {};
  source.draftVotes ||= {};
  source.finalVotes ||= {};
  return source;
}

function resolveLegacyTierlistPaths(sourcePath, baseDir = process.cwd()) {
  const normalizedSourcePath = cleanString(sourcePath, 500);
  const resolvedPath = path.isAbsolute(normalizedSourcePath)
    ? normalizedSourcePath
    : path.resolve(cleanString(baseDir, 2000) || process.cwd(), normalizedSourcePath);
  const stateDir = path.dirname(resolvedPath);

  return {
    sourcePath: normalizedSourcePath,
    resolvedPath,
    stateDir,
    customCharactersPath: path.join(stateDir, "characters.custom.json"),
    customCharactersDir: path.join(stateDir, "characters"),
    baseCharacterAssetsDir: path.resolve(__dirname, "../../assets/characters"),
  };
}

function loadLegacyTierlistState(options = {}) {
  const sourcePath = cleanString(options.sourcePath, 500);
  if (!sourcePath) {
    return {
      ok: false,
      error: "Legacy Tierlist sourcePath не задан.",
      sourcePath: "",
      resolvedPath: "",
    };
  }

  const paths = resolveLegacyTierlistPaths(sourcePath, options.baseDir);
  if (!fs.existsSync(paths.resolvedPath)) {
    return {
      ok: false,
      error: `Legacy Tierlist state не найден: ${paths.resolvedPath}`,
      sourcePath,
      resolvedPath: paths.resolvedPath,
    };
  }

  try {
    const parsedState = JSON.parse(fs.readFileSync(paths.resolvedPath, "utf8"));
    const rawState = ensureLegacyTierlistStateShape(parsedState);
    const customCharacters = loadJsonIfExists(paths.customCharactersPath, []);
    const characters = mergeLegacyTierlistCharacters(options.baseCharacterCatalog, customCharacters);
    const charById = new Map(characters.map((entry) => [entry.id, entry]));

    return {
      ok: true,
      error: null,
      sourcePath,
      resolvedPath: paths.resolvedPath,
      rawState,
      characters,
      charById,
      customCharactersPath: paths.customCharactersPath,
      customCharactersDir: paths.customCharactersDir,
      baseCharacterAssetsDir: cleanString(options.baseCharacterAssetsDir, 2000) || paths.baseCharacterAssetsDir,
    };
  } catch (error) {
    return {
      ok: false,
      error: String(error?.message || error || "Не удалось прочитать legacy Tierlist state."),
      sourcePath,
      resolvedPath: paths.resolvedPath,
    };
  }
}

function saveLegacyTierlistState(resolvedPath, rawState) {
  const normalizedPath = cleanString(resolvedPath, 2000);
  if (!normalizedPath) throw new Error("Resolved legacy Tierlist state path is missing");
  saveJsonAtomic(normalizedPath, ensureLegacyTierlistStateShape(rawState));
}

function getStoredInfluenceMultiplier(liveState, userId) {
  return normalizePositiveNumber(liveState?.rawState?.users?.[userId]?.influenceMultiplier, 1);
}

function voteWeight(tierKey) {
  const offset = Math.abs(LEGACY_TIER_OFFSETS[normalizeTierKey(tierKey)] || 0);
  return offset === 2 ? 5 : 1;
}

function computeLegacyTierlistCharacterAvgOffset(liveState, characterId) {
  let sum = 0;
  let weightedSum = 1;

  for (const [userId, votes] of Object.entries(liveState?.rawState?.finalVotes || {})) {
    const tierKey = votes?.[characterId];
    if (!tierKey) continue;

    const normalizedTierKey = normalizeTierKey(tierKey);
    const multiplier = getStoredInfluenceMultiplier(liveState, userId);
    const weight = voteWeight(normalizedTierKey) * multiplier;

    sum += LEGACY_TIER_OFFSETS[normalizedTierKey] * weight;
    weightedSum += weight;
  }

  return sum / weightedSum;
}

function avgToLegacyTier(avg) {
  if (avg >= 1.5) return "S";
  if (avg >= 0.5) return "A";
  if (avg > -0.5) return "B";
  if (avg > -1.5) return "C";
  return "D";
}

function computeLegacyTierlistGlobalBuckets(liveState) {
  const buckets = { S: [], A: [], B: [], C: [], D: [] };
  const meta = {};
  const voters = new Set();

  for (const [userId, votes] of Object.entries(liveState?.rawState?.finalVotes || {})) {
    if (votes && Object.keys(votes).length > 0) voters.add(userId);
  }

  for (const character of liveState?.characters || []) {
    let votesCount = 0;
    for (const votes of Object.values(liveState?.rawState?.finalVotes || {})) {
      if (votes?.[character.id]) votesCount += 1;
    }

    const avg = computeLegacyTierlistCharacterAvgOffset(liveState, character.id);
    const tierKey = avgToLegacyTier(avg);
    buckets[tierKey].push(character.id);
    meta[character.id] = {
      avg,
      votes: votesCount,
      name: liveState?.charById?.get(character.id)?.name || character.id,
    };
  }

  for (const tierKey of LEGACY_TIER_ORDER) {
    buckets[tierKey].sort((left, right) => {
      const a = meta[left];
      const b = meta[right];
      if (b.avg !== a.avg) return b.avg - a.avg;
      if (b.votes !== a.votes) return b.votes - a.votes;
      return String(a.name).localeCompare(String(b.name), "ru");
    });
  }

  return {
    buckets,
    meta,
    votersCount: voters.size,
  };
}

function buildLegacyTierlistBucketsFromVoteMap(liveState, voteMap) {
  const buckets = { S: [], A: [], B: [], C: [], D: [] };

  for (const character of liveState?.characters || []) {
    const tierKey = normalizeTierKey(voteMap?.[character.id]);
    buckets[tierKey].push(character.id);
  }

  for (const tierKey of LEGACY_TIER_ORDER) {
    buckets[tierKey].sort((left, right) => {
      const avgLeft = computeLegacyTierlistCharacterAvgOffset(liveState, left);
      const avgRight = computeLegacyTierlistCharacterAvgOffset(liveState, right);
      if (avgRight !== avgLeft) return avgRight - avgLeft;
      const nameLeft = liveState?.charById?.get(left)?.name || left;
      const nameRight = liveState?.charById?.get(right)?.name || right;
      return String(nameLeft).localeCompare(String(nameRight), "ru");
    });
  }

  return buckets;
}

function getLegacyTierlistUserTierCounts(voteMap) {
  const counts = { S: 0, A: 0, B: 0, C: 0, D: 0 };
  for (const tierKey of Object.values(voteMap || {})) {
    const normalizedTierKey = normalizeTierKey(tierKey);
    counts[normalizedTierKey] += 1;
  }
  return counts;
}

function getCustomCharacterImagePath(liveState, characterId) {
  return path.join(liveState.customCharactersDir, `${characterId}.png`);
}

function getBaseCharacterImagePath(liveState, characterId) {
  return path.join(liveState.baseCharacterAssetsDir, `${characterId}.png`);
}

function resolveLegacyTierlistCharacterImagePath(liveState, characterId) {
  const customPath = getCustomCharacterImagePath(liveState, characterId);
  if (fs.existsSync(customPath)) return customPath;

  const basePath = getBaseCharacterImagePath(liveState, characterId);
  if (fs.existsSync(basePath)) return basePath;

  return null;
}

async function loadIcon(liveState, characterId) {
  const cacheKey = `${liveState.resolvedPath}::${characterId}`;
  if (iconCache.has(cacheKey)) return iconCache.get(cacheKey);

  const imagePath = resolveLegacyTierlistCharacterImagePath(liveState, characterId);
  if (!imagePath || !fs.existsSync(imagePath) || !PImage) {
    iconCache.set(cacheKey, null);
    return null;
  }

  try {
    const image = await PImage.decodePNGFromStream(fs.createReadStream(imagePath));
    iconCache.set(cacheKey, image);
    return image;
  } catch {
    iconCache.set(cacheKey, null);
    return null;
  }
}

async function renderLegacyTierlistFromBuckets(liveState, options = {}) {
  if (!PImage) throw new Error("pureimage не установлен.");
  ensureFonts();

  const rawState = liveState?.rawState || {};
  const buckets = options.buckets || { S: [], A: [], B: [], C: [], D: [] };
  const lockedIds = new Set(
    [
      ...(Array.isArray(options.lockedIds) ? options.lockedIds : []),
      options.lockedId,
    ]
      .map((value) => cleanString(value, 80))
      .filter(Boolean)
  );
  const { W, H: configuredHeight, ICON } = getLegacyTierlistImageConfig(rawState);

  const topY = 110;
  const leftW = Math.floor(W * 0.24);
  const rightPadding = 36;
  const gap = Math.max(10, Math.floor(ICON * 0.16));
  const rightW = W - leftW - rightPadding - 24;
  const cols = Math.max(1, Math.floor((rightW + gap) / (ICON + gap)));
  const rowHeights = LEGACY_TIER_ORDER.map((tierKey) => {
    const count = (buckets[tierKey] || []).length;
    const rowsNeeded = Math.max(1, Math.ceil(count / cols));
    const iconsHeight = rowsNeeded * (ICON + gap) - gap;
    return Math.max(18 + iconsHeight + 22 + 12, 160);
  });

  const footerHeight = 44;
  const neededHeight = topY + rowHeights.reduce((sum, current) => sum + current, 0) + footerHeight;
  const H = Math.max(configuredHeight, neededHeight);

  const image = PImage.make(W, H);
  const ctx = image.getContext("2d");

  fill(ctx, "#242424");
  ctx.fillRect(0, 0, W, H);

  fill(ctx, "#ffffff");
  ctx.font = `64px '${FONT_BOLD}'`;
  ctx.fillText(String(options.title || LEGACY_TIERLIST_TITLE), 40, 82);

  fill(ctx, "#cfcfcf");
  ctx.font = `22px '${FONT_REG}'`;
  ctx.fillText(String(options.footerText || ""), 40, H - 18);

  let yCursor = topY;
  for (let index = 0; index < LEGACY_TIER_ORDER.length; index += 1) {
    const tierKey = LEGACY_TIER_ORDER[index];
    const y = yCursor;
    const rowHeight = rowHeights[index];
    yCursor += rowHeight;

    fill(ctx, "#2f2f2f");
    ctx.fillRect(leftW, y, W - leftW - rightPadding, rowHeight - 12);

    const tierState = getTierState(rawState, tierKey);
    fill(ctx, tierState.color || "#cccccc");
    ctx.fillRect(40, y, leftW - 40, rowHeight - 12);

    const blockHeight = rowHeight - 12;
    fill(ctx, "#111111");
    ctx.font = `56px '${FONT_BOLD}'`;
    ctx.fillText(tierState.name || tierKey, 40 + 70, y + Math.floor(blockHeight / 2) + 18);

    fill(ctx, "#111111");
    ctx.font = `24px '${FONT_REG}'`;
    ctx.fillText(tierKey, 40 + 70, y + blockHeight - 18);

    const list = buckets[tierKey] || [];
    const rightX = leftW + 24;
    const rightY = y + 18;

    for (let entryIndex = 0; entryIndex < list.length; entryIndex += 1) {
      const characterId = list[entryIndex];
      const col = entryIndex % cols;
      const row = Math.floor(entryIndex / cols);
      const x = rightX + col * (ICON + gap);
      const iconY = rightY + row * (ICON + gap);
      const icon = await loadIcon(liveState, characterId);

      fill(ctx, "#171717");
      ctx.fillRect(x - 3, iconY - 3, ICON + 6, ICON + 6);

      if (options.highlightId && characterId === options.highlightId) {
        ctx.strokeStyle = "rgba(255,255,255,0.95)";
        ctx.lineWidth = 6;
        ctx.strokeRect(x - 5, iconY - 5, ICON + 10, ICON + 10);
      }

      if (icon) {
        ctx.drawImage(icon, x, iconY, ICON, ICON);
      } else {
        fill(ctx, "#555555");
        ctx.fillRect(x, iconY, ICON, ICON);
      }

      if (lockedIds.has(characterId)) {
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(x, iconY, ICON, ICON);
        ctx.fillStyle = "rgba(230,230,230,0.95)";
        ctx.font = `22px '${FONT_BOLD}'`;
        ctx.fillText("MAIN", x + 10, iconY + 32);
      }
    }
  }

  return encodePngToBuffer(image);
}

async function renderLegacyTierlistGlobalPng(liveState, options = {}) {
  const { buckets, votersCount } = computeLegacyTierlistGlobalBuckets(liveState);
  return renderLegacyTierlistFromBuckets(liveState, {
    title: options.title || LEGACY_TIERLIST_TITLE,
    footerText: `voters: ${votersCount}. updated: ${new Date().toLocaleString("ru-RU")}`,
    buckets,
  });
}

async function renderLegacyTierlistUserPng(liveState, targetUserId, titleSuffix = "") {
  const voteMap = liveState?.rawState?.finalVotes?.[targetUserId] || {};
  const mainIds = getLegacyTierlistUserMainIds(liveState?.rawState?.users?.[targetUserId] || {});
  const buckets = buildLegacyTierlistBucketsFromVoteMap(liveState, voteMap);
  return renderLegacyTierlistFromBuckets(liveState, {
    title: `${LEGACY_TIERLIST_TITLE}${titleSuffix ? ` ${titleSuffix}` : ""}`,
    footerText: `user: ${targetUserId}. updated: ${new Date().toLocaleString("ru-RU")}`,
    buckets,
    lockedIds: mainIds,
  });
}

function buildLegacyTierlistSummaryEmbed(liveState, options = {}) {
  const { buckets, votersCount } = computeLegacyTierlistGlobalBuckets(liveState);
  const updatedAt = Date.now();
  const title = cleanString(options.title, 120) || LEGACY_TIERLIST_TITLE;
  const embed = new EmbedBuilder()
    .setTitle(`${title} Summary`)
    .setDescription([
      "Персонажи распределены по актуальным глобальным тирам.",
      `Учтено голосов: **${votersCount}**.`,
      `Обновлено: ${formatTime(updatedAt)}`,
    ].join("\n"))
    .setTimestamp(updatedAt);

  for (const tierKey of LEGACY_TIER_ORDER) {
    const ids = buckets[tierKey] || [];
    if (!ids.length) continue;

    const tierName = getTierState(liveState?.rawState, tierKey).name || tierKey;
    const chunks = [];
    let currentChunk = "";

    for (const characterId of ids) {
      const line = `• ${liveState?.charById?.get(characterId)?.name || characterId}`;
      const nextChunk = currentChunk ? `${currentChunk}\n${line}` : line;
      if (nextChunk.length > 1024) {
        if (currentChunk) chunks.push(currentChunk);
        currentChunk = line;
      } else {
        currentChunk = nextChunk;
      }
    }

    if (currentChunk) chunks.push(currentChunk);
    for (let index = 0; index < chunks.length; index += 1) {
      embed.addFields({
        name: index === 0 ? tierName : `${tierName} (продолжение ${index + 1})`,
        value: chunks[index],
        inline: false,
      });
    }
  }

  if (!embed.data.fields?.length) {
    embed.addFields({ name: "Персонажи", value: "Пока нечего показывать.", inline: false });
  }

  return embed;
}

module.exports = {
  LEGACY_TIERLIST_TITLE,
  LEGACY_TIER_ORDER,
  LEGACY_TIER_DEFAULTS,
  addLegacyTierlistCustomCharacter,
  avgToLegacyTier,
  buildLegacyTierlistBucketsFromVoteMap,
  buildLegacyTierlistSummaryEmbed,
  computeLegacyTierlistCharacterAvgOffset,
  computeLegacyTierlistGlobalBuckets,
  ensureLegacyTierlistStateShape,
  getLegacyTierlistFontDebugInfo,
  getLegacyTierlistImageConfig,
  getLegacyTierlistUserTierCounts,
  loadLegacyTierlistState,
  mergeLegacyTierlistCharacters,
  renderLegacyTierlistFromBuckets,
  renderLegacyTierlistGlobalPng,
  renderLegacyTierlistUserPng,
  resolveLegacyTierlistCharacterImagePath,
  saveLegacyTierlistState,
};