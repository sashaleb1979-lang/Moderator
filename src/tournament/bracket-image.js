"use strict";

// v2 PNG renderers for tournaments. Pure CPU work — no network, no DB. Avatars
// are passed in as already-downloaded image buffers (the operator fetches them
// on the main thread), keeping this module safe to run inside the render worker
// pool via renderOffThread. Falls back to inline use if the worker is absent.
//
// Two public renderers:
//   renderBracketCard(model)  → the bracket tree (one column per stage)
//   renderSummaryCard(model)   → the grand 1/2/3 podium card
// Plus model builders that turn tournament/server state into a serializable
// model (with avatar buffers inlined).

const fs = require("node:fs");
const path = require("node:path");
const { PassThrough, Readable } = require("node:stream");

let PImage = null;
try { PImage = require("pureimage"); } catch {}

const seeding = require("./seeding");

const FONT_REG = "TournyRegular";
const FONT_BOLD = "TournyBold";
let fontsReady = false;

const RED_HEX = "#ed4245";
const BLUE_HEX = "#3b82f6";
const BG_HEX = "#0f1117";
const PANEL_HEX = "#1a1d25";
const BORDER_HEX = "#303541";
const WIN_HEX = "#2f7d4f";
const GOLD_HEX = "#fee75c";

// --------------------------------------------------------------------------
// fonts + primitives (mirrors antiteam/support-progress.js, incl. .ttf.ttf)
// --------------------------------------------------------------------------

function listFontFiles() {
  const dir = path.resolve(__dirname, "..", "..", "assets", "fonts");
  const win = "C:\\Windows\\Fonts";
  return [
    [path.join(dir, "NotoSans-Regular.ttf.ttf"), path.join(dir, "NotoSans-Bold.ttf.ttf")],
    [path.join(dir, "NotoSans-Regular.ttf"), path.join(dir, "NotoSans-Bold.ttf")],
    [path.join(dir, "DejaVuSans.ttf"), path.join(dir, "DejaVuSans-Bold.ttf")],
    [path.join(win, "segoeui.ttf"), path.join(win, "segoeuib.ttf")],
    [path.join(win, "arial.ttf"), path.join(win, "arialbd.ttf")],
    ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"],
    ["/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf", "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf"],
  ];
}

function ensureFonts() {
  if (!PImage || fontsReady) return Boolean(PImage);
  fontsReady = true;
  for (const [reg, bold] of listFontFiles()) {
    if (!fs.existsSync(reg) || !fs.existsSync(bold)) continue;
    try {
      PImage.registerFont(reg, FONT_REG).loadSync();
      PImage.registerFont(bold, FONT_BOLD).loadSync();
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function setFont(ctx, px, kind = "regular") {
  ctx.font = `${Math.max(8, Math.floor(px))}px "${kind === "bold" ? FONT_BOLD : FONT_REG}"`;
}

function measure(ctx, text) {
  try { return Number(ctx.measureText(String(text || "")).width) || 0; }
  catch { return String(text || "").length * 9; }
}

function fitText(ctx, text, maxWidth, px, minPx = 12, kind = "regular") {
  const source = String(text == null ? "" : text);
  for (let size = px; size >= minPx; size -= 1) {
    setFont(ctx, size, kind);
    if (measure(ctx, source) <= maxWidth) return { text: source, px: size };
  }
  setFont(ctx, minPx, kind);
  let clipped = source;
  while (clipped.length > 1 && measure(ctx, `${clipped}…`) > maxWidth) clipped = clipped.slice(0, -1);
  return { text: clipped.length < source.length ? `${clipped}…` : clipped, px: minPx };
}

function rect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function strokeRect(ctx, x, y, w, h, color, width = 2) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.strokeRect(Math.round(x) + 1, Math.round(y) + 1, Math.round(w) - 2, Math.round(h) - 2);
}

function text(ctx, value, x, y, px, color = "#ffffff", kind = "regular") {
  setFont(ctx, px, kind);
  ctx.fillStyle = color;
  ctx.fillText(String(value == null ? "" : value), Math.round(x), Math.round(y));
}

function centered(ctx, value, x, y, w, px, color, kind = "bold", minPx = 12) {
  const fit = fitText(ctx, value, w, px, minPx, kind);
  setFont(ctx, fit.px, kind);
  ctx.fillStyle = color;
  const tw = measure(ctx, fit.text);
  ctx.fillText(fit.text, Math.round(x + (w - tw) / 2), Math.round(y));
}

function drawContain(ctx, image, x, y, w, h) {
  const sw = Number(image?.width) || w;
  const sh = Number(image?.height) || h;
  const scale = Math.min(w / Math.max(1, sw), h / Math.max(1, sh));
  const tw = Math.floor(sw * scale);
  const th = Math.floor(sh * scale);
  ctx.drawImage(image, 0, 0, sw, sh, x + Math.floor((w - tw) / 2), y + Math.floor((h - th) / 2), tw, th);
}

async function decodeAvatar(buffer) {
  if (!PImage || !buffer) return null;
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  try { return await PImage.decodePNGFromStream(Readable.from(data)); }
  catch {
    try { return await PImage.decodeJPEGFromStream(Readable.from(data)); }
    catch { return null; }
  }
}

function initials(name) {
  const trimmed = String(name || "?").trim();
  return (trimmed[0] || "?").toUpperCase();
}

// Hand-drawn checkmark (the bundled Noto Sans lacks ✓ and emoji glyphs).
function drawCheck(ctx, x, y, size, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, Math.floor(size / 6));
  ctx.beginPath();
  ctx.moveTo(x, y + size * 0.55);
  ctx.lineTo(x + size * 0.4, y + size * 0.95);
  ctx.lineTo(x + size, y);
  ctx.stroke();
}

function drawAvatar(ctx, image, name, x, y, size, frameColor) {
  rect(ctx, x, y, size, size, "#08090d");
  if (image) {
    drawContain(ctx, image, x, y, size, size);
  } else {
    centered(ctx, initials(name), x, y + Math.floor(size / 2) + size / 6, size, Math.floor(size * 0.55), "#aeb5c2", "bold", 10);
  }
  strokeRect(ctx, x, y, size, size, frameColor, 3);
}

async function encodePng(image) {
  const chunks = [];
  const stream = new PassThrough();
  stream.on("data", (chunk) => chunks.push(chunk));
  await PImage.encodePNGToStream(image, stream);
  stream.end();
  return Buffer.concat(chunks);
}

// --------------------------------------------------------------------------
// model builders (sync, no I/O — avatars injected separately)
// --------------------------------------------------------------------------

function playerNode(player) {
  if (!player) return null;
  return {
    id: String(player.userId || player.id || ""),
    name: player.robloxUsername || player.discordName || `id${player.userId || player.id}`,
    kills: Number(player.kills != null ? player.kills : player.effectiveKills) || 0,
  };
}

function stageColumnLabel(entry) {
  if (entry.kind === "placement") return "Финал / 3-е место";
  if (entry.isSemifinal) return "Полуфинал";
  return `Этап ${entry.stage}`;
}

// Convert a stored history entry (or a live stage plan) into a column model.
function columnFromStageEntry(entry) {
  const matches = (entry.matches || []).map((m) => ({
    red: playerNode(m.red),
    blue: playerNode(m.blue),
    winnerId: m.winnerId || null,
    placement: m.placement || null,
    cellRed: m.cellRed,
    cellBlue: m.cellBlue,
    tag: m.runIndex != null && entry.runCount > 1 ? `прогон ${m.runIndex + 1}` : "",
  }));
  return { label: stageColumnLabel(entry), matches, bye: entry.bye ? playerNode(entry.bye) : null };
}

// Flatten a live seeding stage plan into the same shape used for history.
function stageEntryFromPlan(stagePlan, decisions = {}) {
  const matches = seeding.listStageMatches(stagePlan).map((m) => {
    const outcome = seeding.resolveMatchOutcome(m, decisions[m.key] || {});
    return {
      red: m.red,
      blue: m.blue,
      winnerId: outcome.winner ? String(outcome.winner.userId || outcome.winner.id) : null,
      placement: m.placement || null,
      cellRed: m.cellRed,
      cellBlue: m.cellBlue,
      runIndex: m.runIndex,
    };
  });
  return {
    stage: stagePlan.stage,
    kind: stagePlan.kind,
    isSemifinal: stagePlan.isSemifinal,
    runCount: Array.isArray(stagePlan.runs) ? stagePlan.runs.length : 1,
    matches,
    bye: stagePlan.bye || null,
  };
}

// Build the full bracket-card model for a server. `history` is the list of
// completed stage entries; `livePlan`/`liveDecisions` render the in-progress
// stage. avatars: { [id]: Buffer }.
function buildBracketModel({ tournament, server, history = [], livePlan = null, liveDecisions = {}, avatars = {} } = {}) {
  const entries = [...history];
  if (livePlan) entries.push(stageEntryFromPlan(livePlan, liveDecisions));
  const columns = entries.map(columnFromStageEntry);

  const placement = server?.placement || {};
  return {
    title: `${tournament?.name || "Турнир"} · сервер ${(server?.index || 0) + 1}`,
    subtitle: server?.done ? "Итоги сервера" : "Сетка · FT6",
    seedingMode: tournament?.seedingMode || "similar",
    columns,
    podium: server?.done
      ? {
          first: playerNode(placement.first),
          second: playerNode(placement.second),
          third: playerNode(placement.third),
        }
      : null,
    avatars,
  };
}

function buildSummaryModel({ tournament, avatars = {} } = {}) {
  const results = tournament?.results || {};
  return {
    title: tournament?.name || "Турнир",
    comment: results.organizerComment || "",
    podium: [
      { place: 1, ...(playerNode(results.first) || {}) },
      { place: 2, ...(playerNode(results.second) || {}) },
      { place: 3, ...(playerNode(results.third) || {}) },
    ].filter((p) => p.id),
    avatars,
  };
}

// --------------------------------------------------------------------------
// renderers
// --------------------------------------------------------------------------

const PAD = 28;
const COL_W = 330;
const COL_GAP = 26;
const HEADER_H = 96;
const MATCH_H = 96;
const MATCH_GAP = 14;
const FOOTER_H = 44;

async function decodeAvatars(avatars) {
  const decoded = new Map();
  for (const [id, buffer] of Object.entries(avatars || {})) {
    decoded.set(String(id), await decodeAvatar(buffer));
  }
  return decoded;
}

function drawPlayerRow(ctx, node, avatarImage, x, y, w, h, side, isWinner) {
  const frame = side === "blue" ? BLUE_HEX : RED_HEX;
  rect(ctx, x, y, w, h, isWinner ? WIN_HEX : "#11141b");
  strokeRect(ctx, x, y, w, h, isWinner ? "#3ea76a" : BORDER_HEX, 2);
  rect(ctx, x, y, 5, h, frame);

  const av = h - 12;
  drawAvatar(ctx, avatarImage, node ? node.name : "", x + 12, y + 6, av, frame);
  const textX = x + 12 + av + 12;
  const textW = w - (textX - x) - (isWinner ? 30 : 12);
  const name = node ? node.name : "—";
  const kills = node ? ` (${Number(node.kills).toLocaleString("ru-RU")})` : "";
  const nameFit = fitText(ctx, name, textW, 22, 13, "bold");
  text(ctx, nameFit.text, textX, y + Math.floor(h / 2) - 2, nameFit.px, "#ffffff", "bold");
  text(ctx, kills.trim(), textX, y + Math.floor(h / 2) + 18, 15, isWinner ? "#d8ffe6" : "#9aa6b8", "regular");
  if (isWinner) drawCheck(ctx, x + w - 26, y + Math.floor(h / 2) - 8, 16, "#d8ffe6");
}

function drawMatchBox(ctx, match, decoded, x, y, w) {
  const rowH = Math.floor((MATCH_H - 6) / 2);
  const cellTag = match.placement === "final" ? "ФИНАЛ" : match.placement === "bronze" ? "3-е место" : match.tag || "";
  if (cellTag) {
    centered(ctx, cellTag, x, y - 4, w, 14, "#8b93a3", "bold", 10);
  }
  const redWin = match.winnerId && match.red && match.winnerId === match.red.id;
  const blueWin = match.winnerId && match.blue && match.winnerId === match.blue.id;
  drawPlayerRow(ctx, match.red, decoded.get(match.red?.id), x, y, w, rowH, "red", redWin);
  drawPlayerRow(ctx, match.blue, decoded.get(match.blue?.id), x, y + rowH + 6, w, rowH, "blue", blueWin);
}

async function renderBracketCard(model = {}) {
  if (!PImage) throw new Error("pureimage не установлен.");
  ensureFonts();
  const decoded = await decodeAvatars(model.avatars);

  const columns = Array.isArray(model.columns) ? model.columns : [];
  const colCount = Math.max(1, columns.length);
  const maxRows = Math.max(1, ...columns.map((c) => (c.matches ? c.matches.length : 0) + (c.bye ? 1 : 0)));
  const width = PAD * 2 + colCount * COL_W + (colCount - 1) * COL_GAP;
  const bodyH = maxRows * (MATCH_H + MATCH_GAP);
  const podiumH = model.podium ? 60 : 0;
  const height = HEADER_H + bodyH + podiumH + FOOTER_H + PAD;

  const image = PImage.make(width, height);
  const ctx = image.getContext("2d");
  rect(ctx, 0, 0, width, height, BG_HEX);
  rect(ctx, 0, 0, width, 8, GOLD_HEX);

  const titleFit = fitText(ctx, model.title || "Турнир", width - PAD * 2, 34, 18, "bold");
  text(ctx, titleFit.text, PAD, 50, titleFit.px, "#ffffff", "bold");
  text(ctx, model.subtitle || "", PAD, 80, 18, "#aeb5c2", "regular");

  // classic bracket connectors between cleanly-halving rounds (8→4→2)
  const colX = (ci) => PAD + ci * (COL_W + COL_GAP);
  const matchCenterY = (m) => HEADER_H + 14 + m * (MATCH_H + MATCH_GAP) + Math.floor(MATCH_H / 2);
  for (let ci = 0; ci < columns.length - 1; ci += 1) {
    const here = (columns[ci].matches || []).length;
    const next = (columns[ci + 1].matches || []).length;
    if (!next || here !== next * 2) continue;
    const rightX = colX(ci) + COL_W;
    const nextLeftX = colX(ci + 1);
    const midX = rightX + Math.floor(COL_GAP / 2);
    for (let j = 0; j < next; j += 1) {
      const yA = matchCenterY(2 * j);
      const yB = matchCenterY(2 * j + 1);
      const yT = matchCenterY(j);
      ctx.strokeStyle = "#3a4150";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(rightX, yA); ctx.lineTo(midX, yA);
      ctx.moveTo(rightX, yB); ctx.lineTo(midX, yB);
      ctx.moveTo(midX, yA); ctx.lineTo(midX, yB);
      ctx.moveTo(midX, Math.floor((yA + yB) / 2)); ctx.lineTo(nextLeftX, yT);
      ctx.stroke();
    }
  }

  columns.forEach((column, ci) => {
    const x = colX(ci);
    rect(ctx, x, HEADER_H - 28, COL_W, 26, PANEL_HEX);
    strokeRect(ctx, x, HEADER_H - 28, COL_W, 26, BORDER_HEX, 1);
    centered(ctx, `${column.label} · ${(column.matches || []).length} боёв`, x, HEADER_H - 9, COL_W, 18, "#dfe3ea", "bold", 11);

    let y = HEADER_H + 14;
    for (const match of column.matches || []) {
      drawMatchBox(ctx, match, decoded, x, y, COL_W);
      y += MATCH_H + MATCH_GAP;
    }
    if (column.bye) {
      rect(ctx, x, y, COL_W, 34, "#11141b");
      strokeRect(ctx, x, y, COL_W, 34, BORDER_HEX, 1);
      centered(ctx, `BYE: ${column.bye.name} — проходит дальше`, x, y + 22, COL_W, 16, "#cdd3dd", "bold", 11);
    }
  });

  if (model.podium) {
    const py = HEADER_H + bodyH + 6;
    const parts = [
      model.podium.first && `1 место: ${model.podium.first.name}`,
      model.podium.second && `2 место: ${model.podium.second.name}`,
      model.podium.third && `3 место: ${model.podium.third.name}`,
    ].filter(Boolean);
    rect(ctx, PAD, py, width - PAD * 2, 44, PANEL_HEX);
    strokeRect(ctx, PAD, py, width - PAD * 2, 44, GOLD_HEX, 2);
    centered(ctx, parts.join("      "), PAD, py + 29, width - PAD * 2, 22, "#ffffff", "bold", 12);
  }

  const modeLabel = model.seedingMode === "seed" ? "посевная сетка" : "близкие килы";
  text(ctx, `Распределение: ${modeLabel}`, PAD, height - 16, 16, "#7e8696", "regular");
  return encodePng(image);
}

async function renderSummaryCard(model = {}) {
  if (!PImage) throw new Error("pureimage не установлен.");
  ensureFonts();
  const decoded = await decodeAvatars(model.avatars);

  const width = 960;
  const height = 540;
  const image = PImage.make(width, height);
  const ctx = image.getContext("2d");
  rect(ctx, 0, 0, width, height, BG_HEX);
  rect(ctx, 0, 0, width, 10, GOLD_HEX);
  centered(ctx, model.title || "Турнир", 0, 70, width, 40, "#ffffff", "bold", 18);
  centered(ctx, "Итоги турнира", 0, 104, width, 22, "#aeb5c2", "regular", 12);

  const podium = Array.isArray(model.podium) ? model.podium : [];
  // 1st centered tall, 2nd left, 3rd right
  const slots = [
    { place: 2, x: 120, h: 150, color: "#c0c7d4" },
    { place: 1, x: 380, h: 210, color: GOLD_HEX },
    { place: 3, x: 640, h: 120, color: "#cd7f32" },
  ];
  const baseY = 470;
  const boxW = 200;
  for (const slot of slots) {
    const node = podium.find((p) => p.place === slot.place);
    const topY = baseY - slot.h;
    rect(ctx, slot.x, topY, boxW, slot.h, PANEL_HEX);
    strokeRect(ctx, slot.x, topY, boxW, slot.h, slot.color, 3);
    const avSize = 96;
    drawAvatar(ctx, decoded.get(node?.id), node?.name, slot.x + (boxW - avSize) / 2, topY - avSize - 8, avSize, slot.color);
    // big place number badge
    centered(ctx, String(slot.place), slot.x, topY + 44, boxW, 40, slot.color, "bold", 20);
    centered(ctx, slot.place === 1 ? "МЕСТО" : "место", slot.x, topY + 64, boxW, 16, slot.color, "bold", 10);
    centered(ctx, node ? node.name : "—", slot.x + 8, topY + 92, boxW - 16, 22, "#ffffff", "bold", 11);
    if (node && node.kills) centered(ctx, `${Number(node.kills).toLocaleString("ru-RU")} килов`, slot.x + 8, topY + 116, boxW - 16, 18, "#9aa6b8", "regular", 10);
  }

  if (model.comment) {
    const fit = fitText(ctx, `«${model.comment}»`, width - 120, 20, 13, "regular");
    centered(ctx, fit.text, 0, height - 24, width, fit.px, "#cdd3dd", "regular", 11);
  }
  return encodePng(image);
}

module.exports = {
  hasRenderer: () => Boolean(PImage),
  buildBracketModel,
  buildSummaryModel,
  stageEntryFromPlan,
  renderBracketCard,
  renderSummaryCard,
};
