"use strict";

// v2 PNG renderers for tournaments. Pure CPU work — no network, no DB. Avatars
// are passed in as already-downloaded image buffers (the operator fetches them
// on the main thread), keeping this module safe to run inside the render worker
// pool via renderOffThread. Falls back to inline use if the worker is absent.
//
// Three public renderers:
//   renderBracketCard(model)  → the bracket tree (one column per stage)
//   renderPreviewCard(model)  → a full pre-publication map of servers/merge
//   renderSummaryCard(model)  → the grand 1/2/3 podium card
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
  const bye = entry.bye ? playerNode(entry.bye) : null;
  if (bye) {
    matches.push({
      red: bye,
      blue: null,
      winnerId: bye.id,
      placement: null,
      bye: true,
      tag: "без пары",
    });
  }
  return { label: stageColumnLabel(entry), matches, bye: null };
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
function buildBracketModel({ tournament, server, history = [], livePlan = null, liveDecisions = {}, liveRunIndex = 0, avatars = {}, totalPlayers = 0 } = {}) {
  const entries = [...history];
  if (livePlan) entries.push(stageEntryFromPlan(livePlan, liveDecisions));
  const columns = entries.map(columnFromStageEntry);

  // current-run indicator for the live stage: each run is up to 4 simultaneous
  // FT6 fights; surfacing "прогон k/n · 4 боя" makes the per-run progression
  // explicit on the public picture.
  const liveRunCount = livePlan && Array.isArray(livePlan.runs) ? livePlan.runs.length : 1;
  const runTag = livePlan && liveRunCount > 1 && !server?.done
    ? ` · прогон ${Math.min(liveRunCount, (Number(liveRunIndex) || 0) + 1)}/${liveRunCount} · до 4 боёв`
    : "";

  // total field size — used to project the full bracket shape (empty future boxes)
  const firstCol = columns[0];
  const derivedN = firstCol
    ? firstCol.matches.reduce((sum, match) => sum + (match?.red ? 1 : 0) + (match?.blue ? 1 : 0), 0) + (firstCol.bye ? 1 : 0)
    : 0;
  const n = Math.max(Number(totalPlayers) || 0, derivedN, 2);

  const placement = server?.placement || {};
  // base (qualifying) servers don't have a final — they only send their top-4 on
  const qualifier = server?.role === "base";
  // the actual qualified players (named, with avatars) once the base server is
  // done; before that the centre shows an empty top-4 projection.
  const finalists = qualifier
    ? (Array.isArray(server?.qualified) ? server.qualified : []).map(playerNode).filter(Boolean)
    : [];
  return {
    title: `${tournament?.name || "Турнир"}${server && server.role === "final" ? " · ФИНАЛ" : server ? ` · сервер ${(server.index || 0) + 1}` : ""}`,
    subtitle: qualifier ? `Отбор в финал · топ-4${runTag}` : server?.done ? "Итоги" : `Сетка · FT6${runTag}`,
    seedingMode: tournament?.seedingMode || "similar",
    totalPlayers: n,
    qualifier,
    qualifyCount: qualifier ? Math.min(4, Math.max(2, Math.floor(n / 2))) : 0,
    finalists,
    serverNumber: (Number(server?.index) || 0) + 1,
    columns,
    podium: qualifier
      ? null
      : server?.done
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

function previewEmptyMatch() {
  return {
    red: null,
    blue: null,
    winnerId: null,
    placement: null,
    previewEmpty: true,
  };
}

function previewMatchFromStageMatch(match) {
  return {
    red: playerNode(match.red),
    blue: playerNode(match.blue),
    winnerId: null,
    placement: null,
    cellRed: match.cellRed,
    cellBlue: match.cellBlue,
  };
}

// Preview is intentionally NOT a prediction. It shows only the first, real
// placement of players; every later round is a blank bracket slot.
function buildPreviewColumns(players, mode, qualifyCount) {
  const source = Array.isArray(players) ? players.slice() : [];
  if (!source.length) return { columns: [], qualifiers: [] };

  const firstStage = seeding.buildStage(source, mode, 1);
  const firstMatches = seeding.listStageMatches(firstStage).map(previewMatchFromStageMatch);
  if (firstStage.bye) {
    firstMatches.push({
      red: playerNode(firstStage.bye),
      blue: null,
      winnerId: null,
      placement: null,
      bye: true,
      tag: "бай",
    });
  }

  const columns = [{
    stage: 1,
    kind: "regular",
    isSemifinal: Boolean(firstStage.isSemifinal),
    matches: firstMatches,
  }];

  const stopAt = qualifyCount > 0 ? Math.max(1, Math.min(qualifyCount, source.length)) : 1;
  let survivors = Math.ceil(source.length / 2);
  let stageNumber = 2;
  let guard = 0;
  while (survivors > stopAt && guard < 12) {
    const visualSlots = Math.max(1, Math.ceil(survivors / 2));
    columns.push({
      stage: stageNumber,
      kind: "preview-empty",
      isSemifinal: survivors === 4,
      matches: Array.from({ length: visualSlots }, previewEmptyMatch),
    });
    survivors = Math.ceil(survivors / 2);
    stageNumber += 1;
    guard += 1;
  }

  return { columns, qualifiers: [] };
}

function buildPreviewModel({ tournament, servers = [], waitlist = [], avatars = {} } = {}) {
  const mode = tournament?.seedingMode || "similar";
  const normalizedServers = (Array.isArray(servers) ? servers : []).map((server, index) => {
    const rawPlayers = Array.isArray(server?.players) ? server.players : [];
    const players = rawPlayers.map(playerNode).filter(Boolean);
    const qualifyCount = Number(server?.qualifyCount) || 0;
    const projection = buildPreviewColumns(rawPlayers, mode, qualifyCount);
    return {
      index: Number.isFinite(Number(server?.index)) ? Number(server.index) : index,
      label: server?.label || `Сервер ${index + 1}`,
      players,
      playerCount: Number(server?.playerCount) || players.length,
      qualifyCount,
      columns: projection.columns,
      qualifiers: projection.qualifiers,
      previewEmptyFuture: true,
    };
  });
  const activeCount = normalizedServers.reduce((sum, server) => sum + (Number(server.playerCount) || 0), 0);
  const serverCount = Number(tournament?.previewServerCount) || normalizedServers.length || 1;
  return {
    title: tournament?.name || "Турнир",
    subtitle: `Предварительная сетка · ${activeCount} игроков · ${serverCount} сервер${serverCount === 1 ? "" : "а"}`,
    seedingMode: tournament?.seedingMode || "similar",
    activeCount,
    plannedPlayers: Number(tournament?.plannedPlayers) || activeCount,
    waitlistCount: Array.isArray(waitlist) ? waitlist.length : Number(tournament?.waitlistCount) || 0,
    serverCount,
    servers: normalizedServers,
    avatars,
  };
}

// --------------------------------------------------------------------------
// renderers
// --------------------------------------------------------------------------

const PAD = 28;
const COL_W = 244;
const COL_GAP = 30;
const HEADER_H = 100;
const MATCH_H = 78;
const MATCH_GAP = 22;
const FOOTER_H = 40;

async function decodeAvatars(avatars) {
  const decoded = new Map();
  for (const [id, buffer] of Object.entries(avatars || {})) {
    decoded.set(String(id), await decodeAvatar(buffer));
  }
  return decoded;
}

function drawPlayerRow(ctx, node, avatarImage, x, y, w, h, side, isWinner) {
  const frame = side === "blue" ? BLUE_HEX : RED_HEX;
  const empty = !node;
  rect(ctx, x, y, w, h, empty ? "#0d0f14" : isWinner ? WIN_HEX : "#11141b");
  strokeRect(ctx, x, y, w, h, empty ? "#242a35" : isWinner ? "#3ea76a" : BORDER_HEX, 2);
  rect(ctx, x, y, 5, h, frame);

  const av = h - 12;
  drawAvatar(ctx, avatarImage, node ? node.name : "—", x + 12, y + 6, av, empty ? "#3a4150" : frame);
  const textX = x + 12 + av + 12;
  const textW = w - (textX - x) - (isWinner ? 30 : 12);
  const name = node ? node.name : "нет пары";
  const kills = node ? ` (${Number(node.kills).toLocaleString("ru-RU")})` : "проход дальше";
  const nameFit = fitText(ctx, name, textW, 22, 13, "bold");
  text(ctx, nameFit.text, textX, y + Math.floor(h / 2) - 2, nameFit.px, empty ? "#9aa6b8" : "#ffffff", "bold");
  text(ctx, kills.trim(), textX, y + Math.floor(h / 2) + 18, 15, empty ? "#7e8696" : isWinner ? "#d8ffe6" : "#9aa6b8", "regular");
  if (isWinner) drawCheck(ctx, x + w - 26, y + Math.floor(h / 2) - 8, 16, "#d8ffe6");
}

function drawMatchBox(ctx, match, decoded, x, y, w) {
  const rowH = Math.floor((MATCH_H - 6) / 2);
  const redWin = match.winnerId && match.red && match.winnerId === match.red.id;
  const blueWin = match.winnerId && match.blue && match.winnerId === match.blue.id;
  drawPlayerRow(ctx, match.red, decoded.get(match.red?.id), x, y, w, rowH, "red", redWin);
  drawPlayerRow(ctx, match.blue, decoded.get(match.blue?.id), x, y + rowH + 6, w, rowH, "blue", blueWin);
}

function drawEmptyBox(ctx, x, y, w) {
  const rowH = Math.floor((MATCH_H - 6) / 2);
  rect(ctx, x, y, w, rowH, "#0d0f14");
  strokeRect(ctx, x, y, w, rowH, BORDER_HEX, 1);
  rect(ctx, x, y + rowH + 6, w, rowH, "#0d0f14");
  strokeRect(ctx, x, y + rowH + 6, w, rowH, BORDER_HEX, 1);
}

// Gold-framed panel that names the four players a base server sends to the final
// (the "top-4 → final" funnel). Each known finalist is a green, checked row with
// avatar + kills; unfilled slots render as empty placeholders.
function drawFinalistsPanel(ctx, finalists, decoded, x, centerY, w, count, options = {}) {
  const title = options.title || "ТОП-4 → ФИНАЛ";
  const emptyLabel = options.emptyLabel || "—";
  const showChecks = options.showChecks !== false;
  const rows = Math.max(1, count || finalists.length || 4);
  const headerH = 30;
  const rowH = 46;
  const gap = 8;
  const totalH = headerH + rows * rowH + (rows - 1) * gap;
  let y = Math.round(centerY - totalH / 2);
  rect(ctx, x - 6, y - 6, w + 12, totalH + 12, "#161922");
  strokeRect(ctx, x - 6, y - 6, w + 12, totalH + 12, GOLD_HEX, 2);
  centered(ctx, title, x, y + 20, w, 16, GOLD_HEX, "bold", 11);
  y += headerH;
  for (let i = 0; i < rows; i += 1) {
    const node = finalists[i] || null;
    rect(ctx, x, y, w, rowH, node ? WIN_HEX : "#11141b");
    strokeRect(ctx, x, y, w, rowH, node ? "#3ea76a" : BORDER_HEX, 2);
    const av = rowH - 10;
    drawAvatar(ctx, node ? decoded.get(node.id) : null, node ? node.name : "—", x + 6, y + 5, av, node ? GOLD_HEX : BORDER_HEX);
    const tx = x + 6 + av + 10;
    const tw = w - (tx - x) - 10;
    const nameFit = fitText(ctx, node ? node.name : emptyLabel, tw, 18, 11, "bold");
    text(ctx, nameFit.text, tx, y + 20, nameFit.px, node ? "#ffffff" : "#8f98a8", "bold");
    if (node) text(ctx, `${Number(node.kills).toLocaleString("ru-RU")} килов`, tx, y + 38, 13, "#d8ffe6", "regular");
    if (node && showChecks) drawCheck(ctx, x + w - 24, y + Math.floor(rowH / 2) - 8, 15, "#d8ffe6");
    y += rowH + gap;
  }
}

// Build the round structure for the symmetric tree. Returns rounds[] where
// rounds[0] is the outermost (most matches) and the last is the single final.
// Actual played matches come from model.columns; remaining rounds are projected
// as empty boxes down to one final, so the bracket always funnels to the center.
function buildTreeRounds(model) {
  const columns = Array.isArray(model.columns) ? model.columns : [];
  const rounds = [];
  let bronze = null;
  for (const col of columns) {
    const matches = Array.isArray(col.matches) ? col.matches : [];
    const placementMatch = matches.find((m) => m.placement);
    if (placementMatch && !model.qualifier) {
      const finalM = matches.find((m) => m.placement === "final") || matches[0] || null;
      bronze = matches.find((m) => m.placement === "bronze") || null;
      rounds.push([finalM]);
    } else {
      rounds.push(matches);
    }
  }
  // seed an empty first round if nothing played yet
  if (!rounds.length) {
    const n = Math.max(2, Number(model.totalPlayers) || 2);
    rounds.push(new Array(Math.ceil(n / 2)).fill(null));
  }
  // Qualifier (base server): the tree funnels only down to the top-4 qualifying
  // round (no central final). Otherwise project all the way to a single final.
  const stopAt = model.qualifier ? Math.max(2, Number(model.qualifyCount) || 4) : 1;
  let guard = 0;
  while (rounds[rounds.length - 1].length > stopAt && guard < 12) {
    const len = rounds[rounds.length - 1].length;
    rounds.push(new Array(Math.ceil(len / 2)).fill(null));
    guard += 1;
  }
  return { rounds, bronze };
}

function computeSideYs(leafYs, levels) {
  // leafYs: Y centers for the outermost round's matches (this side).
  const ys = [leafYs];
  for (let l = 1; l < levels; l += 1) {
    const prev = ys[l - 1];
    const cur = [];
    for (let k = 0; k < Math.ceil(prev.length / 2); k += 1) {
      const a = prev[2 * k];
      const b = prev[2 * k + 1];
      cur.push(b == null ? a : (a + b) / 2);
    }
    ys.push(cur);
  }
  return ys;
}

async function renderBracketCard(model = {}) {
  if (!PImage) throw new Error("pureimage не установлен.");
  ensureFonts();
  const decoded = await decodeAvatars(model.avatars);

  const { rounds, bronze } = buildTreeRounds(model);
  const qualifier = Boolean(model.qualifier);
  const L = rounds.length; // total round levels
  // non-qualifier: last round is the single central final → feeders = L-1.
  // qualifier: every round splits L/R, no central final → feeders = L.
  const feeders = qualifier ? L : Math.max(0, L - 1);

  // split every feeder round into left / right halves
  const leftRounds = [];
  const rightRounds = [];
  for (let r = 0; r < feeders; r += 1) {
    const m = rounds[r];
    const half = Math.ceil(m.length / 2);
    leftRounds.push(m.slice(0, half));
    rightRounds.push(m.slice(half));
  }
  const finalMatch = qualifier ? null : rounds[L - 1] ? rounds[L - 1][0] : null;

  const leftLeaves = leftRounds[0] ? leftRounds[0].length : 0;
  const rightLeaves = rightRounds[0] ? rightRounds[0].length : 0;
  const maxLeaves = Math.max(1, leftLeaves, rightLeaves);

  const topY = HEADER_H + 18;
  const step = MATCH_H + MATCH_GAP;
  const centerY = (n) => topY + n * step + Math.floor(MATCH_H / 2);
  const leftLeafYs = Array.from({ length: leftLeaves }, (_, j) => centerY(j));
  const rightLeafYs = Array.from({ length: rightLeaves }, (_, j) => centerY(j));
  const leftYs = computeSideYs(leftLeafYs, feeders);
  const rightYs = computeSideYs(rightLeafYs, feeders);
  let finalY = feeders > 0
    ? ((leftYs[feeders - 1][0] ?? topY) + (rightYs[feeders - 1][0] ?? topY)) / 2
    : centerY(0);

  // the qualifier centre is a NAMED top-4 panel — size it and keep it on-canvas
  // (below the header) even when the base-server tree is short.
  const finalistCount = qualifier ? Math.max(1, Math.min(4, (model.finalists || []).length || model.qualifyCount || 4)) : 0;
  const qualifierPanelH = qualifier ? 36 + finalistCount * 54 : 0;
  if (qualifier) finalY = Math.max(finalY, topY + qualifierPanelH / 2);

  const totalCols = feeders > 0 ? 2 * feeders + 1 : 1;
  const leftX = (r) => PAD + r * (COL_W + COL_GAP);
  const finalX = PAD + feeders * (COL_W + COL_GAP);
  const rightX = (r) => PAD + (2 * feeders - r) * (COL_W + COL_GAP);

  const width = PAD * 2 + totalCols * COL_W + (totalCols - 1) * COL_GAP;
  const bodyH = maxLeaves * step;
  const bronzeH = bronze ? MATCH_H + 30 : 0;
  const podiumH = model.podium ? 56 : 0;
  const centerHalf = qualifier ? qualifierPanelH / 2 : MATCH_H;
  const height = HEADER_H + Math.max(bodyH, finalY - HEADER_H + centerHalf + 8) + bronzeH + podiumH + FOOTER_H;

  const image = PImage.make(width, height);
  const ctx = image.getContext("2d");
  rect(ctx, 0, 0, width, height, BG_HEX);
  rect(ctx, 0, 0, width, 8, GOLD_HEX);

  const titleFit = fitText(ctx, model.title || "Турнир", width - PAD * 2, 34, 18, "bold");
  text(ctx, titleFit.text, PAD, 50, titleFit.px, "#ffffff", "bold");
  text(ctx, model.subtitle || "", PAD, 80, 18, "#aeb5c2", "regular");

  ctx.strokeStyle = "#3a4150";
  ctx.lineWidth = 2;
  const connect = (x1, y1, x2, y2) => {
    ctx.beginPath();
    if (Math.abs(y1 - y2) < 1) {
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); // straight (avoid degenerate elbow)
    } else {
      const midX = (x1 + x2) / 2;
      ctx.moveTo(x1, y1); ctx.lineTo(midX, y1); ctx.lineTo(midX, y2); ctx.lineTo(x2, y2);
    }
    ctx.stroke();
  };

  // connectors — left half (children feed parents toward center). The innermost
  // round connects to the central final only when there IS one (not a qualifier).
  for (let r = 0; r < feeders; r += 1) {
    const isInnermost = r === feeders - 1;
    if (isInnermost && qualifier) continue; // qualifier: top-4 round has no final to feed
    const parentY = isInnermost ? [finalY] : leftYs[r + 1];
    const parentLeftX = isInnermost ? finalX : leftX(r + 1);
    for (let k = 0; k < parentY.length; k += 1) {
      const yP = parentY[k];
      for (const childIdx of [2 * k, 2 * k + 1]) {
        if (childIdx >= leftYs[r].length) continue;
        connect(leftX(r) + COL_W, leftYs[r][childIdx], parentLeftX, yP);
      }
    }
  }
  // connectors — right half (mirrored)
  for (let r = 0; r < feeders; r += 1) {
    const isInnermost = r === feeders - 1;
    if (isInnermost && qualifier) continue;
    const parentY = isInnermost ? [finalY] : rightYs[r + 1];
    const parentRightX = isInnermost ? finalX + COL_W : rightX(r + 1) + COL_W;
    for (let k = 0; k < parentY.length; k += 1) {
      const yP = parentY[k];
      for (const childIdx of [2 * k, 2 * k + 1]) {
        if (childIdx >= rightYs[r].length) continue;
        connect(rightX(r), rightYs[r][childIdx], parentRightX, yP);
      }
    }
  }

  const placeBox = (match, x, y) => {
    const boxTop = Math.round(y - MATCH_H / 2);
    if (match) drawMatchBox(ctx, match, decoded, x, boxTop, COL_W);
    else drawEmptyBox(ctx, x, boxTop, COL_W);
  };

  // draw boxes — left, right, then the centre
  for (let r = 0; r < feeders; r += 1) {
    leftRounds[r].forEach((m, j) => placeBox(m, leftX(r), leftYs[r][j]));
    rightRounds[r].forEach((m, j) => placeBox(m, rightX(r), rightYs[r][j]));
  }

  if (qualifier) {
    // base server: the innermost round funnels into a NAMED top-4 panel — the four
    // players who advance to the cross-server final (avatars + kills + check).
    const inner = feeders - 1;
    if (inner >= 0) {
      for (let k = 0; k < (leftYs[inner] ? leftYs[inner].length : 0); k += 1) connect(leftX(inner) + COL_W, leftYs[inner][k], finalX, finalY);
      for (let k = 0; k < (rightYs[inner] ? rightYs[inner].length : 0); k += 1) connect(rightX(inner), rightYs[inner][k], finalX + COL_W, finalY);
    }
    drawFinalistsPanel(ctx, model.finalists || [], decoded, finalX, finalY, COL_W, finalistCount);
  } else {
    // higher league: the central final decides 1st / 2nd place (gold frame)
    const finalTop = Math.round(finalY - MATCH_H / 2);
    rect(ctx, finalX - 4, finalTop - 22, COL_W + 8, MATCH_H + 28, "#1a1d25");
    strokeRect(ctx, finalX - 4, finalTop - 22, COL_W + 8, MATCH_H + 28, GOLD_HEX, 2);
    centered(ctx, "ФИНАЛ · высшая лига (1–2 место)", finalX, finalTop - 6, COL_W, 13, GOLD_HEX, "bold", 9);
    placeBox(finalMatch, finalX, finalY);

    // lower league: the two semifinal losers play for 3rd place
    if (bronze) {
      const by = finalY + MATCH_H + 40;
      centered(ctx, "Низшая лига · за 3-е место", finalX, by - MATCH_H / 2 - 8, COL_W, 13, "#cd7f32", "bold", 9);
      placeBox(bronze, finalX, by);
    }
  }

  if (model.podium) {
    const py = height - FOOTER_H - podiumH + 4;
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
  text(ctx, `Распределение: ${modeLabel} · ${model.totalPlayers || ""} игроков`, PAD, height - 14, 15, "#7e8696", "regular");
  return encodePng(image);
}

function drawPreviewFunnel(ctx, x, y, w, h, title, body, color = GOLD_HEX) {
  rect(ctx, x, y, w, h, "#171b24");
  strokeRect(ctx, x, y, w, h, color, 2);
  centered(ctx, title, x + 12, y + 30, w - 24, 18, color, "bold", 10);
  centered(ctx, body, x + 12, y + 56, w - 24, 15, "#cdd3dd", "regular", 9);
}

const PV_COL_W = 240;
const PV_COL_GAP = 32;
const PV_STEP = MATCH_H + 16;
const PV_HEADER_H = 60;

function previewStageWord(n) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return `${n} этапов`;
  if (last === 1) return `${n} этап`;
  if (last >= 2 && last <= 4) return `${n} этапа`;
  return `${n} этапов`;
}

function previewServerPanelHeight(server) {
  const feederCols = (Array.isArray(server.columns) ? server.columns : []).filter((c) => c.kind !== "placement");
  const leaf = feederCols[0] ? Math.max(1, feederCols[0].matches.length) : 1;
  return PV_HEADER_H + leaf * PV_STEP + 18;
}

// Draw one server as a left→right projected bracket: a column per round, each
// match a red/blue box with the probable winner (higher kills) highlighted and
// wired into its next-round slot, ending in a top-N qualify panel (multi) or the
// final + bronze boxes (single). Returns the panel height + the right-edge funnel
// point used to wire servers into the shared final.
function drawServerTree(ctx, server, decoded, x, y, w, multi) {
  const allCols = Array.isArray(server.columns) ? server.columns : [];
  const placementCol = allCols.find((c) => c.kind === "placement") || null;
  const feederCols = allCols.filter((c) => c.kind !== "placement");
  const feeders = feederCols.length;
  const leaf = feederCols[0] ? Math.max(1, feederCols[0].matches.length) : 1;
  const panelH = PV_HEADER_H + leaf * PV_STEP + 18;

  rect(ctx, x, y, w, panelH, PANEL_HEX);
  strokeRect(ctx, x, y, w, panelH, "#3a4150", 2);
  rect(ctx, x, y, w, 5, multi ? BLUE_HEX : GOLD_HEX);
  text(ctx, server.label || "Сервер", x + 22, y + 36, 24, "#ffffff", "bold");
  const stageTotal = feeders + (multi ? 1 : placementCol ? 1 : 0);
  text(
    ctx,
    `${Number(server.playerCount || 0).toLocaleString("ru-RU")} игроков · ${previewStageWord(stageTotal)} · вероятный путь`,
    x + 22, y + 58, 15, "#aeb5c2", "regular"
  );

  const bodyTop = y + PV_HEADER_H;
  const colX = (r) => x + 18 + r * (PV_COL_W + PV_COL_GAP);
  const termX = x + 18 + feeders * (PV_COL_W + PV_COL_GAP);
  const leafYs = Array.from({ length: leaf }, (_, j) => bodyTop + j * PV_STEP + Math.floor(MATCH_H / 2));
  const ys = computeSideYs(leafYs, Math.max(1, feeders));
  const lastFeederYs = ys[feeders - 1] || leafYs;
  const termY = lastFeederYs.reduce((s, v) => s + v, 0) / Math.max(1, lastFeederYs.length);

  ctx.strokeStyle = "#3a4150";
  ctx.lineWidth = 2;
  const connect = (x1, y1, x2, y2) => {
    ctx.beginPath();
    if (Math.abs(y1 - y2) < 1) { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
    else { const mx = (x1 + x2) / 2; ctx.moveTo(x1, y1); ctx.lineTo(mx, y1); ctx.lineTo(mx, y2); ctx.lineTo(x2, y2); }
    ctx.stroke();
  };
  for (let r = 0; r < feeders; r += 1) {
    const parentYs = r + 1 < feeders ? ys[r + 1] : [termY];
    const parentX = r + 1 < feeders ? colX(r + 1) : termX;
    for (let k = 0; k < parentYs.length; k += 1) {
      for (const child of [2 * k, 2 * k + 1]) {
        if (!ys[r] || child >= ys[r].length) continue;
        connect(colX(r) + PV_COL_W, ys[r][child], parentX, parentYs[k]);
      }
    }
  }

  for (let r = 0; r < feeders; r += 1) {
    const colYs = ys[r] || [];
    const label = feederCols[r].isSemifinal ? "Полуфинал" : `Раунд ${r + 1}`;
    text(ctx, label, colX(r) + 2, bodyTop - 8, 13, "#7e8696", "bold");
    feederCols[r].matches.forEach((m, j) => {
      if (j >= colYs.length) return;
      drawMatchBox(ctx, m, decoded, colX(r), Math.round(colYs[j] - MATCH_H / 2), PV_COL_W);
    });
  }

  if (multi) {
    drawFinalistsPanel(ctx, server.qualifiers || [], decoded, termX, termY, PV_COL_W, server.qualifyCount || 4);
  } else if (placementCol) {
    const finalM = placementCol.matches.find((m) => m.placement === "final") || placementCol.matches[0] || null;
    const bronzeM = placementCol.matches.find((m) => m.placement === "bronze") || null;
    const ft = Math.round(termY - MATCH_H / 2);
    rect(ctx, termX - 4, ft - 22, PV_COL_W + 8, MATCH_H + 28, "#1a1d25");
    strokeRect(ctx, termX - 4, ft - 22, PV_COL_W + 8, MATCH_H + 28, GOLD_HEX, 2);
    centered(ctx, "ФИНАЛ · 1–2 место", termX, ft - 6, PV_COL_W, 13, GOLD_HEX, "bold", 9);
    if (finalM) drawMatchBox(ctx, finalM, decoded, termX, ft, PV_COL_W); else drawEmptyBox(ctx, termX, ft, PV_COL_W);
    if (bronzeM) {
      const by = termY + MATCH_H + 40;
      centered(ctx, "За 3-е место", termX, Math.round(by - MATCH_H / 2) - 8, PV_COL_W, 13, "#cd7f32", "bold", 9);
      drawMatchBox(ctx, bronzeM, decoded, termX, Math.round(by - MATCH_H / 2), PV_COL_W);
    }
  }

  return { height: panelH, funnel: { x: termX + PV_COL_W, y: termY } };
}

function previewColumns(server) {
  return (Array.isArray(server?.columns) ? server.columns : []).filter((column) => Array.isArray(column.matches));
}

function drawPreviewBox(ctx, match, decoded, x, centerY, w = PV_COL_W) {
  const top = Math.round(centerY - MATCH_H / 2);
  if (!match || match.previewEmpty) drawEmptyBox(ctx, x, top, w);
  else drawMatchBox(ctx, match, decoded, x, top, w);
}

function previewLeafYs(topY, leafCount) {
  return Array.from({ length: Math.max(1, leafCount) }, (_, j) => topY + j * PV_STEP + Math.floor(MATCH_H / 2));
}

function splitPreviewColumn(column, takeLeft) {
  const matches = Array.isArray(column?.matches) ? column.matches : [];
  const half = Math.ceil(matches.length / 2);
  return {
    ...(column || {}),
    matches: takeLeft ? matches.slice(0, half) : matches.slice(half),
  };
}

function ensureSideColumns(columns, minColumns = 2) {
  const out = columns.map((column, index) => ({
    ...(column || {}),
    stage: column?.stage || index + 1,
    matches: Array.isArray(column?.matches) && column.matches.length ? column.matches : [previewEmptyMatch()],
  }));
  while (out.length < minColumns) {
    out.push({
      stage: out.length + 1,
      kind: "preview-empty",
      matches: [previewEmptyMatch()],
    });
  }
  return out;
}

function average(values, fallback) {
  const nums = (values || []).filter((value) => Number.isFinite(value));
  return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : fallback;
}

function drawPreviewSide(ctx, server, decoded, {
  outerX,
  topY,
  orientation = "left",
  columns,
  terminalTitle = "ТОП-4 В ФИНАЛ",
  terminalRows = 4,
}) {
  const sideColumns = ensureSideColumns(columns || previewColumns(server));
  const leafCount = Math.max(1, sideColumns[0].matches.length);
  const leafYs = previewLeafYs(topY, leafCount);
  const ys = computeSideYs(leafYs, sideColumns.length);
  const colX = (level) => orientation === "left"
    ? outerX + level * (PV_COL_W + PV_COL_GAP)
    : outerX - level * (PV_COL_W + PV_COL_GAP);
  const terminalX = colX(sideColumns.length);
  const terminalY = average(ys[sideColumns.length - 1], leafYs[0]);

  const minX = Math.min(outerX, terminalX);
  const headerW = Math.abs(outerX - terminalX) + PV_COL_W;
  const title = server?.label || "Сервер";
  text(ctx, title, minX, topY - 48, 23, "#ffffff", "bold");
  const subtitleFit = fitText(ctx, "стартовые пары без прогноза победителей", headerW, 14, 10, "regular");
  text(ctx, subtitleFit.text, minX, topY - 26, subtitleFit.px, "#aeb5c2", "regular");

  ctx.strokeStyle = "#3a4150";
  ctx.lineWidth = 2;
  const connect = (x1, y1, x2, y2) => {
    ctx.beginPath();
    if (Math.abs(y1 - y2) < 1) {
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    } else {
      const mx = (x1 + x2) / 2;
      ctx.moveTo(x1, y1); ctx.lineTo(mx, y1); ctx.lineTo(mx, y2); ctx.lineTo(x2, y2);
    }
    ctx.stroke();
  };

  for (let level = 0; level < sideColumns.length; level += 1) {
    const parentYs = level + 1 < sideColumns.length ? ys[level + 1] : [terminalY];
    const parentX = level + 1 < sideColumns.length ? colX(level + 1) : terminalX;
    const childEdge = orientation === "left" ? colX(level) + PV_COL_W : colX(level);
    const parentEdge = orientation === "left" ? parentX : parentX + PV_COL_W;
    for (let k = 0; k < parentYs.length; k += 1) {
      for (const child of [2 * k, 2 * k + 1]) {
        if (!ys[level] || child >= ys[level].length) continue;
        connect(childEdge, ys[level][child], parentEdge, parentYs[k]);
      }
    }
  }

  for (let level = 0; level < sideColumns.length; level += 1) {
    const label = level === 0 ? "Старт" : `Раунд ${level + 1}`;
    const x = colX(level);
    text(ctx, label, x + 2, topY - 8, 13, "#7e8696", "bold");
    (sideColumns[level].matches || []).forEach((match, index) => {
      if (!ys[level] || index >= ys[level].length) return;
      drawPreviewBox(ctx, match, decoded, x, ys[level][index]);
    });
  }

  drawFinalistsPanel(ctx, [], decoded, terminalX, terminalY, PV_COL_W, terminalRows, {
    title: terminalTitle,
    emptyLabel: "пустой слот",
    showChecks: false,
  });

  return {
    terminalX,
    terminalY,
    funnel: {
      x: orientation === "left" ? terminalX + PV_COL_W : terminalX,
      y: terminalY,
    },
    leafCount,
  };
}

function connectPreviewPoint(ctx, x1, y1, x2, y2) {
  ctx.strokeStyle = "#3a4150";
  ctx.lineWidth = 3;
  ctx.beginPath();
  if (Math.abs(y1 - y2) < 1) {
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  } else {
    const mx = (x1 + x2) / 2;
    ctx.moveTo(x1, y1);
    ctx.lineTo(mx, y1);
    ctx.lineTo(mx, y2);
    ctx.lineTo(x2, y2);
  }
  ctx.stroke();
}

async function renderPreviewCard(model = {}) {
  if (!PImage) throw new Error("pureimage не установлен.");
  ensureFonts();
  const decoded = await decodeAvatars(model.avatars);

  const servers = Array.isArray(model.servers) ? model.servers : [];
  const multi = Number(model.serverCount) > 1;
  const topY = HEADER_H + 86;
  const firstLeafCount = (server) => Math.max(1, previewColumns(server)[0]?.matches?.length || 1);
  const maxLeaves = Math.max(1, ...servers.map(firstLeafCount));
  const sideColumnCount = multi ? Math.max(2, ...servers.map((server) => previewColumns(server).length || 1)) : 2;
  const sideTreeWidth = (sideColumnCount + 1) * PV_COL_W + sideColumnCount * PV_COL_GAP;
  const centerW = multi ? 300 : PV_COL_W;
  const centerGap = 70;
  const width = Math.max(1100, PAD * 2 + sideTreeWidth * 2 + centerGap * 2 + centerW);
  const height = Math.max(620, topY + maxLeaves * PV_STEP + FOOTER_H);

  const image = PImage.make(width, height);
  const ctx = image.getContext("2d");
  rect(ctx, 0, 0, width, height, BG_HEX);
  rect(ctx, 0, 0, width, 10, GOLD_HEX);

  const titleFit = fitText(ctx, model.title || "Турнир", width - PAD * 2, 36, 18, "bold");
  text(ctx, titleFit.text, PAD, 50, titleFit.px, "#ffffff", "bold");
  text(ctx, model.subtitle || "Предварительная сетка", PAD, 80, 18, "#aeb5c2", "regular");

  const stats = [
    `Основной состав: ${Number(model.activeCount || 0).toLocaleString("ru-RU")} / ${Number(model.plannedPlayers || model.activeCount || 0).toLocaleString("ru-RU")}`,
    `Серверов: ${Number(model.serverCount || servers.length || 1).toLocaleString("ru-RU")}`,
    model.waitlistCount ? `резерв: ${Number(model.waitlistCount).toLocaleString("ru-RU")}` : null,
    model.seedingMode === "seed" ? "посев 1×N" : "близкие килы (равный с равным)",
  ].filter(Boolean).join(" · ");
  text(ctx, stats, PAD, 104, 15, "#7e8696", "regular");

  const centerX = Math.round((width - centerW) / 2);
  const centerY = topY + (maxLeaves - 1) * PV_STEP / 2 + Math.floor(MATCH_H / 2);

  if (multi && servers.length >= 2) {
    const leftServer = servers[0];
    const rightServer = servers[1];
    const left = drawPreviewSide(ctx, leftServer, decoded, {
      outerX: PAD,
      topY,
      orientation: "left",
      columns: ensureSideColumns(previewColumns(leftServer), sideColumnCount),
      terminalTitle: "ТОП-4 СЕРВЕРА 1",
      terminalRows: leftServer.qualifyCount || 4,
    });
    const right = drawPreviewSide(ctx, rightServer, decoded, {
      outerX: width - PAD - PV_COL_W,
      topY,
      orientation: "right",
      columns: ensureSideColumns(previewColumns(rightServer), sideColumnCount),
      terminalTitle: "ТОП-4 СЕРВЕРА 2",
      terminalRows: rightServer.qualifyCount || 4,
    });
    drawFinalistsPanel(ctx, [], decoded, centerX, centerY, centerW, (leftServer.qualifyCount || 4) + (rightServer.qualifyCount || 4), {
      title: "ФИНАЛЬНЫЙ СЕРВЕР",
      emptyLabel: "место финалиста",
      showChecks: false,
    });
    connectPreviewPoint(ctx, left.funnel.x, left.funnel.y, centerX, centerY);
    connectPreviewPoint(ctx, right.funnel.x, right.funnel.y, centerX + centerW, centerY);
  } else {
    const server = servers[0] || { label: "Сервер", columns: [] };
    const cols = previewColumns(server);
    const first = cols[0] || { matches: [previewEmptyMatch(), previewEmptyMatch()] };
    const second = cols[1] || { kind: "preview-empty", matches: Array.from({ length: Math.max(1, Math.ceil((first.matches || []).length / 2)) }, previewEmptyMatch) };
    const left = drawPreviewSide(ctx, server, decoded, {
      outerX: PAD,
      topY,
      orientation: "left",
      columns: [splitPreviewColumn(first, true), splitPreviewColumn(second, true)],
      terminalTitle: "ФИНАЛЬНЫЙ ЭТАП",
      terminalRows: 2,
    });
    const right = drawPreviewSide(ctx, { ...server, label: "Вторая сторона" }, decoded, {
      outerX: width - PAD - PV_COL_W,
      topY,
      orientation: "right",
      columns: [splitPreviewColumn(first, false), splitPreviewColumn(second, false)],
      terminalTitle: "ФИНАЛЬНЫЙ ЭТАП",
      terminalRows: 2,
    });
    drawFinalistsPanel(ctx, [], decoded, centerX, centerY, centerW, 4, {
      title: "ФИНАЛ",
      emptyLabel: "пустой слот",
      showChecks: false,
    });
    connectPreviewPoint(ctx, left.funnel.x, left.funnel.y, centerX, centerY);
    connectPreviewPoint(ctx, right.funnel.x, right.funnel.y, centerX + centerW, centerY);
  }

  text(ctx, "Предпубликация: стартовая расстановка. Следующие раунды пустые и заполняются только после реальных боёв.", PAD, height - 18, 15, "#7e8696", "regular");
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
  buildPreviewModel,
  buildSummaryModel,
  stageEntryFromPlan,
  renderBracketCard,
  renderPreviewCard,
  renderSummaryCard,
};
