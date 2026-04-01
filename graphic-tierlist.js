"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const { PassThrough } = require("stream");

let PImage = null;
try { PImage = require("pureimage"); } catch {}

// ====== CONSTANTS ======
const GRAPHIC_TIER_ORDER = [5, 4, 3, 2, 1];
const DEFAULT_GRAPHIC_TIER_COLORS = {
  5: "#ff6b6b",
  4: "#ff9f43",
  3: "#feca57",
  2: "#1dd1a1",
  1: "#54a0ff",
};

// ====== FONT STATE ======
let fontsReady = false;
const FONT_REG = "TierlistReg";
const FONT_BOLD = "TierlistBold";
let fontInfo = { reg: null, bold: null, source: "none", err: null };

function listFontFiles() {
  const winFontsDir = process.platform === "win32"
    ? path.join(process.env.WINDIR || "C:\\Windows", "Fonts")
    : null;
  const dirs = [
    path.join(__dirname, "assets", "fonts"),
    ...(winFontsDir ? [winFontsDir] : []),
    "/usr/share/fonts/truetype/dejavu",
    "/usr/share/fonts/truetype/liberation2",
    "/usr/share/fonts/truetype/liberation",
    "/usr/share/fonts/truetype/freefont",
    "/usr/share/fonts/truetype/noto",
  ];
  const out = [];
  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (/\.ttf$/i.test(f)) out.push(path.join(dir, f));
      }
    } catch {}
  }
  return out;
}

function pickFonts() {
  const a = path.join(__dirname, "assets", "fonts");
  const wf = process.platform === "win32"
    ? path.join(process.env.WINDIR || "C:\\Windows", "Fonts")
    : "";
  const pairs = [
    [path.join(a, "DejaVuSans.ttf"), path.join(a, "DejaVuSans-Bold.ttf"), "repo-assets"],
    [path.join(a, "NotoSans-Regular.ttf.ttf"), path.join(a, "NotoSans-Bold.ttf.ttf"), "repo-assets-noto-zip"],
    [path.join(a, "NotoSans-Regular.ttf"), path.join(a, "NotoSans-Bold.ttf"), "repo-assets-noto"],
    [path.join(wf, "arial.ttf"), path.join(wf, "arialbd.ttf"), "windows-arial"],
    [path.join(wf, "segoeui.ttf"), path.join(wf, "segoeuib.ttf"), "windows-segoeui"],
    [path.join(wf, "tahoma.ttf"), path.join(wf, "tahomabd.ttf"), "windows-tahoma"],
    ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "dejavu"],
    ["/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf", "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf", "liberation2"],
    ["/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf", "liberation"],
    ["/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf", "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf", "noto"],
  ];
  for (const [reg, bold, source] of pairs) {
    if (fs.existsSync(reg) && fs.existsSync(bold)) return { reg, bold, source, err: null };
  }
  const any = listFontFiles();
  if (any.length) return { reg: any[0], bold: any[0], source: "fallback", err: null };
  return { reg: null, bold: null, source: "none", err: "No TTF fonts found" };
}

function ensureFonts() {
  if (!PImage) return false;
  if (fontsReady) return true;
  const picked = pickFonts();
  fontInfo = picked;
  if (!picked.reg || !picked.bold) return false;
  try {
    PImage.registerFont(picked.reg, FONT_REG).loadSync();
    PImage.registerFont(picked.bold, FONT_BOLD).loadSync();
    fontsReady = true;
    return true;
  } catch (e) {
    fontInfo.err = String(e?.message || e);
    return false;
  }
}

// ====== TEXT HELPERS ======
function setFont(ctx, px, kind = "regular") {
  ctx.font = `${Math.max(1, Math.floor(px))}px ${kind === "bold" ? FONT_BOLD : FONT_REG}`;
}

function measureText(ctx, text) {
  try { return Number(ctx.measureText(String(text || "")).width) || 0; } catch { return String(text || "").length * 12; }
}

function centerTextX(ctx, text, left, width) {
  return Math.floor(left + Math.max(0, (width - measureText(ctx, text)) / 2));
}

function wrapLines(ctx, text, maxW, maxLines = 3) {
  const src = String(text || "").trim();
  if (!src) return [""];
  const pieces = [];
  for (const word of src.split(/\s+/).filter(Boolean)) {
    if (measureText(ctx, word) <= maxW) { pieces.push(word); continue; }
    let chunk = "";
    for (const ch of word) {
      const next = chunk + ch;
      if (!chunk || measureText(ctx, next) <= maxW) { chunk = next; } else { pieces.push(chunk); chunk = ch; }
    }
    if (chunk) pieces.push(chunk);
  }
  const lines = [];
  let line = "";
  for (const part of pieces) {
    const cand = line ? `${line} ${part}` : part;
    if (!line || measureText(ctx, cand) <= maxW) { line = cand; continue; }
    lines.push(line);
    line = part;
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const trimmed = lines.slice(0, maxLines);
  let last = trimmed[maxLines - 1];
  while (last.length > 1 && measureText(ctx, `${last}…`) > maxW) last = last.slice(0, -1).trimEnd();
  trimmed[maxLines - 1] = `${last}…`;
  return trimmed;
}

function fitWrappedText(ctx, text, kind, maxW, maxH, startPx, minPx = 22, maxLines = 3) {
  for (let px = startPx; px >= minPx; px -= 2) {
    setFont(ctx, px, kind);
    const lines = wrapLines(ctx, text, maxW, maxLines);
    const lineH = Math.max(px + 4, Math.floor(px * 1.15));
    const totalH = lines.length * lineH;
    if (Math.max(...lines.map((l) => measureText(ctx, l)), 0) <= maxW && totalH <= maxH) return { px, lines, lineH, totalH };
  }
  setFont(ctx, minPx, kind);
  const lines = wrapLines(ctx, text, maxW, maxLines);
  const lineH = Math.max(minPx + 4, Math.floor(minPx * 1.15));
  return { px: minPx, lines, lineH, totalH: lines.length * lineH };
}

function trimToWidth(ctx, text, maxW) {
  let out = String(text || "").trim();
  if (!out) return "";
  if (measureText(ctx, out) <= maxW) return out;
  while (out.length > 1 && measureText(ctx, `${out}…`) > maxW) out = out.slice(0, -1).trimEnd();
  return out.length ? `${out}…` : "";
}

function fitSingleLine(ctx, text, kind, maxW, startPx, minPx = 10) {
  const src = String(text || "").trim();
  if (!src) return { px: minPx, text: "" };
  for (let px = startPx; px >= minPx; px -= 1) {
    setFont(ctx, px, kind);
    if (measureText(ctx, src) <= maxW) return { px, text: src };
  }
  setFont(ctx, minPx, kind);
  return { px: minPx, text: trimToWidth(ctx, src, maxW) };
}

function drawOutlined(ctx, text, x, y, fill = "#ffffff", outline = "#000000") {
  const offsets = [[-2, 0], [2, 0], [0, -2], [0, 2], [-1, -1], [1, -1], [-1, 1], [1, 1]];
  ctx.fillStyle = outline;
  for (const [dx, dy] of offsets) ctx.fillText(text, x + dx, y + dy);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

function drawTierTitle(ctx, text, boxX, boxY, boxW, boxH) {
  const fit = fitWrappedText(ctx, text, "bold", boxW, boxH, 56, 22, 3);
  fillHex(ctx, "#111111");
  setFont(ctx, fit.px, "bold");
  let y = Math.floor(boxY + Math.max(0, (boxH - fit.totalH) / 2)) + fit.px;
  for (const line of fit.lines) { ctx.fillText(line, boxX, y); y += fit.lineH; }
}

// ====== COLOR & IMAGE ======
function hexToRgb(hex) {
  const h = String(hex || "#cccccc").replace("#", "");
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function fillHex(ctx, hex) {
  const { r, g, b } = hexToRgb(hex);
  ctx.fillStyle = `rgb(${r},${g},${b})`;
}

function bufToStream(buf) {
  const s = new PassThrough();
  s.end(buf);
  return s;
}

async function decodeImage(buf) {
  if (!PImage || !buf) return null;
  try { return await PImage.decodePNGFromStream(bufToStream(buf)); } catch {}
  try { return await PImage.decodeJPEGFromStream(bufToStream(buf)); } catch {}
  return null;
}

// ====== DOWNLOAD ======
async function downloadBuffer(url, timeoutMs = 12000) {
  if (typeof fetch === "function") {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Bot/1.0", Accept: "image/*,*/*;q=0.8" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } finally { clearTimeout(t); }
  }
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https:") ? https : http;
    const req = lib.get(url, { headers: { "User-Agent": "Bot/1.0" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        downloadBuffer(res.headers.location, timeoutMs).then(resolve).catch(reject);
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error("timeout")));
  });
}

// ====== AVATAR CACHE ======
const avatarMem = new Map();
let avatarDiskDir = path.join(__dirname, "graphic_avatar_cache");

function setAvatarCacheDir(dir) {
  avatarDiskDir = dir;
  try { fs.mkdirSync(avatarDiskDir, { recursive: true }); } catch {}
}

function avatarDiskPath(userId) {
  try { fs.mkdirSync(avatarDiskDir, { recursive: true }); } catch {}
  return path.join(avatarDiskDir, `${String(userId || "x")}.png`);
}

async function loadAvatarFromDisk(userId) {
  const fp = avatarDiskPath(userId);
  if (!fs.existsSync(fp)) return null;
  try {
    const img = await decodeImage(fs.readFileSync(fp));
    if (img) avatarMem.set(`disk:${userId}`, img);
    return img;
  } catch { return null; }
}

function saveAvatarToDisk(userId, buf) {
  if (!userId || !buf?.length) return;
  try { fs.writeFileSync(avatarDiskPath(userId), buf); } catch {}
}

function normalizeAvatarUrl(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host === "cdn.discordapp.com" || host === "media.discordapp.net") {
      u.pathname = u.pathname.replace(/\.(webp|gif|jpg|jpeg)$/i, ".png");
      u.searchParams.set("size", "256");
    }
    return u.toString();
  } catch { return String(url); }
}

async function fetchAvatarFromUrl(url) {
  const norm = normalizeAvatarUrl(url);
  if (!norm) return { img: null, buf: null };
  const cached = avatarMem.get(norm);
  if (cached) return { img: cached, buf: null };
  try {
    const buf = await downloadBuffer(norm, 12000);
    const img = await decodeImage(buf);
    if (img) { avatarMem.set(norm, img); return { img, buf }; }
  } catch {}
  return { img: null, buf: null };
}

async function getFreshAvatarUrls(client, guild, userId) {
  const urls = [];
  if (!client || !userId) return urls;
  try {
    if (guild) {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (member) {
        urls.push(normalizeAvatarUrl(member.displayAvatarURL({ extension: "png", forceStatic: true, size: 256 })));
        if (member.user) urls.push(normalizeAvatarUrl(member.user.displayAvatarURL({ extension: "png", forceStatic: true, size: 256 })));
      }
    }
  } catch {}
  try {
    const user = await client.users.fetch(userId).catch(() => null);
    if (user) urls.push(normalizeAvatarUrl(user.displayAvatarURL({ extension: "png", forceStatic: true, size: 256 })));
  } catch {}
  return [...new Set(urls.filter(Boolean))];
}

async function loadAvatar(client, guild, userId) {
  if (userId && avatarMem.has(`disk:${userId}`)) return avatarMem.get(`disk:${userId}`);
  const diskImg = await loadAvatarFromDisk(userId);
  if (diskImg) return diskImg;
  for (const url of await getFreshAvatarUrls(client, guild, userId)) {
    const res = await fetchAvatarFromUrl(url);
    if (!res.img) continue;
    if (userId && res.buf) { saveAvatarToDisk(userId, res.buf); avatarMem.set(`disk:${userId}`, res.img); }
    return res.img;
  }
  return null;
}

function clearGraphicAvatarCache() {
  avatarMem.clear();
  try {
    if (fs.existsSync(avatarDiskDir)) {
      for (const f of fs.readdirSync(avatarDiskDir)) {
        try { fs.unlinkSync(path.join(avatarDiskDir, f)); } catch {}
      }
    }
  } catch {}
}

// ====== DATA PREPARATION ======
function buildBuckets(entries) {
  const buckets = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  for (const entry of entries) {
    const tier = Number(entry.killTier);
    if (!buckets[tier]) continue;
    buckets[tier].push({
      userId: entry.userId,
      name: entry.displayName || entry.userId,
      username: entry.displayName || entry.userId,
      kills: Number(entry.approvedKills) || 0,
      tier,
    });
  }
  for (const t of Object.keys(buckets)) {
    buckets[t].sort((a, b) => {
      if (b.kills !== a.kills) return b.kills - a.kills;
      return String(a.name).localeCompare(String(b.name), "ru");
    });
  }
  return buckets;
}

function formatTierTitle(tier, tierLabels) {
  return String(tierLabels?.[tier] || tierLabels?.[String(tier)] || `Tier ${tier}`);
}

function formatKills(n) {
  return Number(n || 0).toLocaleString("ru-RU");
}

// ====== MAIN RENDERER ======
async function renderGraphicTierlistPng({
  client = null,
  guild = null,
  entries = [],
  title = "Графический тир-лист",
  tierLabels = {},
  tierColors = {},
  imageWidth = null,
  imageHeight = null,
  imageIcon = null,
} = {}) {
  if (!PImage) throw new Error("pureimage не установлен. Установи: npm i pureimage");
  if (!ensureFonts()) throw new Error(`Шрифт не найден. source=${fontInfo.source}. ${fontInfo.err || ""}`);

  const colors = { ...DEFAULT_GRAPHIC_TIER_COLORS, ...tierColors };
  const buckets = buildBuckets(entries);
  const totalPlayers = entries.length;

  const W = Math.max(1200, Number(imageWidth) || 2000);
  const H_CFG = Math.max(700, Number(imageHeight) || 1200);
  const ICON = Math.max(64, Number(imageIcon) || 112);

  const topY = 120;
  const leftW = Math.floor(W * 0.24);
  const rightPad = 36;
  const gap = Math.max(10, Math.floor(ICON * 0.16));
  const rightW = W - leftW - rightPad - 24;
  const cols = Math.max(1, Math.floor((rightW + gap) / (ICON + gap)));

  const rowHeights = GRAPHIC_TIER_ORDER.map((tierKey) => {
    const n = (buckets[tierKey] || []).length;
    const rows = Math.max(1, Math.ceil(n / cols));
    const iconsH = rows * (ICON + gap) - gap;
    return Math.max(18 + iconsH + 22 + 12, 160);
  });

  const footerH = 44;
  const neededH = topY + rowHeights.reduce((a, b) => a + b, 0) + footerH;
  const H = Math.max(H_CFG, neededH);

  const img = PImage.make(W, H);
  const ctx = img.getContext("2d");

  fillHex(ctx, "#242424");
  ctx.fillRect(0, 0, W, H);

  fillHex(ctx, "#ffffff");
  setFont(ctx, 64, "bold");
  ctx.fillText(title, 40, 82);

  fillHex(ctx, "#cfcfcf");
  setFont(ctx, 22, "regular");
  ctx.fillText(`players: ${totalPlayers}. updated: ${new Date().toLocaleString("ru-RU")}`, 40, H - 18);

  let yCursor = topY;

  for (let i = 0; i < GRAPHIC_TIER_ORDER.length; i++) {
    const tierKey = GRAPHIC_TIER_ORDER[i];
    const y = yCursor;
    const rowH = rowHeights[i];
    yCursor += rowH;

    fillHex(ctx, "#2f2f2f");
    ctx.fillRect(leftW, y, W - leftW - rightPad, rowH - 12);

    fillHex(ctx, colors[tierKey] || "#cccccc");
    ctx.fillRect(40, y, leftW - 40, rowH - 12);

    const blockH = rowH - 12;
    const labelX = 40 + 56;
    const labelW = (leftW - 40) - 56 - 18;
    const bottomLabelY = y + blockH - 18;
    const titleBoxY = y + 16;
    const titleBoxH = Math.max(44, bottomLabelY - titleBoxY - 18);

    drawTierTitle(ctx, formatTierTitle(tierKey, tierLabels), labelX, titleBoxY, labelW, titleBoxH);

    fillHex(ctx, "#111111");
    setFont(ctx, 24, "regular");
    ctx.fillText(`TIER ${tierKey}`, labelX, bottomLabelY);

    const list = buckets[tierKey] || [];
    const rightX = leftW + 24;
    const rightY = y + 18;

    for (let idx = 0; idx < list.length; idx++) {
      const player = list[idx];
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const px = rightX + col * (ICON + gap);
      const py = rightY + row * (ICON + gap);

      const avatar = await loadAvatar(client, guild, player.userId);

      fillHex(ctx, "#171717");
      ctx.fillRect(px - 3, py - 3, ICON + 6, ICON + 6);

      if (avatar) {
        ctx.drawImage(avatar, px, py, ICON, ICON);
      } else {
        fillHex(ctx, "#555555");
        ctx.fillRect(px, py, ICON, ICON);
        fillHex(ctx, "#f3f3f3");
        setFont(ctx, Math.max(18, Math.floor(ICON * 0.28)), "bold");
        const initials = String(player.name || "?").trim().split(/\s+/).slice(0, 2).map((s) => (s[0] || "")).join("").toUpperCase() || "?";
        const ix = px + Math.max(10, Math.floor((ICON - initials.length * Math.max(14, Math.floor(ICON * 0.16))) / 2));
        const iy = py + Math.floor(ICON / 2) + Math.max(8, Math.floor(ICON * 0.08));
        ctx.fillText(initials, ix, iy);
      }

      const barH = Math.max(22, Math.floor(ICON * 0.24));
      ctx.fillStyle = "rgba(0,0,0,0.78)";
      ctx.fillRect(px, py + ICON - barH, ICON, barH);

      const nameFit = fitSingleLine(ctx, String(player.username || player.name || player.userId || "").trim(), "bold", Math.max(10, ICON - 10), Math.max(11, Math.floor(ICON * 0.18)), 10);
      setFont(ctx, nameFit.px, "bold");
      ctx.fillStyle = "rgba(255,255,255,0.98)";
      const nameY = py + ICON - Math.max(6, Math.floor((barH - nameFit.px) / 2)) - 1;
      ctx.fillText(nameFit.text, centerTextX(ctx, nameFit.text, px, ICON), nameY);

      const killsText = formatKills(player.kills);
      const killsPx = Math.max(18, Math.floor(ICON * 0.22));
      setFont(ctx, killsPx, "bold");
      const killsW = measureText(ctx, killsText);
      const killsX = px + ICON - killsW - 8;
      const killsY = py + killsPx + 8;
      drawOutlined(ctx, killsText, killsX, killsY, "#ffffff", "#000000");
    }
  }

  const chunks = [];
  const stream = new PassThrough();
  stream.on("data", (c) => chunks.push(c));
  await PImage.encodePNGToStream(img, stream);
  stream.end();
  return Buffer.concat(chunks);
}

// ====== EXPORTS ======
module.exports = {
  GRAPHIC_TIER_ORDER,
  DEFAULT_GRAPHIC_TIER_COLORS,
  renderGraphicTierlistPng,
  ensureGraphicFonts: ensureFonts,
  clearGraphicAvatarCache,
  setAvatarCacheDir,
  isPureimageAvailable: () => !!PImage,
};