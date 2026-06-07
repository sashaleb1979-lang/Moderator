"use strict";

const { DENY_ALLOWED_MENTIONS } = require("./mentions");

const DEFAULT_ACCENT_COLOR = 0xD6A441;
const DEFAULT_ALT_COLOR = 0x5DA9E9;
const SECTION_SEPARATOR = "━━━━━━━━━━━━━━━━━━━━";
const MEDALS = ["🥇", "🥈", "🥉", "4.", "5."];

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function parseIsoMs(value) {
  const timeMs = Date.parse(String(value || ""));
  return Number.isFinite(timeMs) ? timeMs : null;
}

function isDiscordUserId(value) {
  return /^\d{5,25}$/.test(cleanString(value, 80));
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function normalizeHexColor(value = "", fallback = DEFAULT_ACCENT_COLOR) {
  const text = cleanString(value, 16).replace(/^#/, "");
  return /^[0-9a-fA-F]{6}$/.test(text) ? Number.parseInt(text, 16) : fallback;
}

function formatNumber(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "0";
  const rounded = Number.isInteger(amount) ? amount : Math.round(amount * 10) / 10;
  const [whole, fraction] = String(rounded).split(".");
  const sign = whole.startsWith("-") ? "-" : "";
  const digits = sign ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return fraction ? `${sign}${grouped},${fraction}` : `${sign}${grouped}`;
}

function formatSignedNumber(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "+0";
  return `${amount >= 0 ? "+" : ""}${formatNumber(amount)}`;
}

function formatDuration(seconds) {
  const totalSeconds = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0 && minutes > 0) return `${hours}ч ${minutes}м`;
  if (hours > 0) return `${hours}ч`;
  if (minutes > 0) return `${minutes}м`;
  return `${totalSeconds}с`;
}

function formatMoscowDate(dayKey = "") {
  const normalizedDayKey = cleanString(dayKey, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDayKey)) return normalizedDayKey || "дата неизвестна";
  const [year, month, day] = normalizedDayKey.split("-");
  return `${day}.${month}.${year}`;
}

function formatMoscowWindow(coverageWindow = {}) {
  const start = cleanString(coverageWindow.startAt, 80);
  const end = cleanString(coverageWindow.endAt, 80);
  if (!start || !end) return "окно не определено";
  const formatTime = (iso) => {
    const timeMs = Date.parse(iso);
    if (!Number.isFinite(timeMs)) return "??:??";
    const moscowIso = new Date(timeMs + 3 * 60 * 60 * 1000).toISOString();
    return `${moscowIso.slice(11, 16)} МСК`;
  };
  return `${formatTime(start)} → ${formatTime(end)}`;
}

function truncateText(value = "", limit = 1000) {
  const text = cleanString(value, Math.max(0, Number(limit) || 0));
  if (text.length < limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trim()}…`;
}

function trimLines(lines = [], limit = 1024) {
  const result = [];
  let used = 0;
  for (const rawLine of Array.isArray(lines) ? lines : []) {
    const line = cleanString(rawLine, 500);
    if (!line) continue;
    const nextUsed = used + line.length + (result.length ? 1 : 0);
    if (nextUsed > limit) break;
    result.push(line);
    used = nextUsed;
  }
  return result.length ? result.join("\n") : "—";
}

function createEmbedField(name, lines, inline = false) {
  return {
    name: truncateText(name, 256),
    value: trimLines(lines, 1024),
    inline,
  };
}

function sanitizeDisplayName(value = "", fallbackName = "неизвестно") {
  const text = cleanString(value, 120)
    .replace(/@everyone/gi, "everyone")
    .replace(/@here/gi, "here")
    .replace(/<@!?\d{5,25}>/g, "")
    .replace(/<@&\d{5,25}>/g, "")
    .replace(/<#\d{5,25}>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text) return text;
  const fallback = cleanString(fallbackName, 120)
    .replace(/@everyone/gi, "everyone")
    .replace(/@here/gi, "here")
    .replace(/<@!?\d{5,25}>/g, "")
    .replace(/<@&\d{5,25}>/g, "")
    .replace(/<#\d{5,25}>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return fallback || "неизвестно";
}

function makeBar(label = "", value = 0, maxValue = 1, filled = "█", empty = "░") {
  const width = 10;
  const amount = Math.max(0, Number(value) || 0);
  const max = Math.max(1, Number(maxValue) || 1);
  const filledCount = Math.max(0, Math.min(width, Math.round((amount / max) * width)));
  return `${label} ${filled.repeat(filledCount)}${empty.repeat(width - filledCount)}`;
}

function getCoverageLabel(digest = {}) {
  if (digest.coverage?.partial && digest.coverage?.ambiguous) return "⚠️ частично + неоднозначно";
  if (digest.coverage?.partial) return "⚠️ частичное покрытие";
  if (digest.coverage?.ambiguous) return "⚠️ неоднозначные источники";
  return "✅ покрытие чистое";
}

function formatParticipant(entry = {}, fallbackName = "неизвестно") {
  const mentionId = cleanString(entry?.discordUserId || entry?.discordId || entry?.userId, 80);
  if (isDiscordUserId(mentionId)) return `<@${mentionId}>`;
  return sanitizeDisplayName(entry?.displayName, fallbackName);
}

function createKillEventKey(entry = {}) {
  return [
    cleanString(entry.userId, 80),
    formatNumber(entry.to),
    cleanString(entry.toAt, 80),
    formatNumber(entry.delta),
  ].join("|");
}

function formatKillTempo(entry = {}) {
  const parts = [];
  const dayCount = Number(entry.dayCount);
  if (Number.isFinite(dayCount) && dayCount > 0) {
    parts.push(`за ${formatNumber(dayCount)} дн.`);
  }
  const averagePerDay = Number(entry.averagePerDay);
  if (Number.isFinite(averagePerDay) && averagePerDay > 0) {
    parts.push(`~${formatNumber(averagePerDay)}/день`);
  }
  return parts.join(" · ");
}

function getTopKillUpgrade(digest = {}) {
  return Array.isArray(digest.publicEdition?.kills?.topUpgrades)
    ? digest.publicEdition.kills.topUpgrades[0] || null
    : null;
}

function getTopMessageAuthor(digest = {}) {
  return Array.isArray(digest.publicEdition?.activity?.topMessageAuthors)
    ? digest.publicEdition.activity.topMessageAuthors[0] || null
    : null;
}

function getTopVoiceVisitor(digest = {}) {
  return Array.isArray(digest.publicEdition?.voice?.topVisitors)
    ? digest.publicEdition.voice.topVisitors[0] || null
    : null;
}

function getTopGameplayPlayer(digest = {}) {
  return Array.isArray(digest.publicEdition?.gameplay?.topPlayers)
    ? digest.publicEdition.gameplay.topPlayers[0] || null
    : null;
}

function buildStoryLine(digest = {}) {
  void digest;
  return "";
}

function buildHeroMetrics(digest = {}) {
  const metrics = [
    ["⚔️ апы киллов", digest.publicEdition?.kills?.upgradeCount || 0],
    ["💬 сообщения", digest.publicEdition?.activity?.totalMessagesCount || 0],
    ["🎮 JJS-игроки", digest.publicEdition?.gameplay?.precisePlayerCount || 0],
    ["👋 входы", digest.publicEdition?.newcomers?.newcomerCount || 0],
    ["✅ верификации", digest.publicEdition?.newcomers?.verifiedCount || 0],
    ["🎙️ voice-участники", digest.publicEdition?.voice?.visitorCount || 0],
    ["🛡️ модерация", digest.moderation?.totalCount || 0],
  ];
  return metrics
    .filter(([, value]) => Number(value) > 0)
    .map(([label, value]) => `${label}: **${formatNumber(value)}**`);
}

function renderKillLines(upgrades = [], limit = 5, options = {}) {
  const excludeKeys = options?.excludeKeys instanceof Set ? options.excludeKeys : new Set();
  const items = (Array.isArray(upgrades) ? upgrades : [])
    .filter((entry) => !excludeKeys.has(createKillEventKey(entry)))
    .slice(0, limit);
  if (!items.length) return [];
  return items.map((entry, index) => {
    const medal = MEDALS[index] || `${index + 1}.`;
    const tempo = formatKillTempo(entry);
    return `${medal} **${formatParticipant(entry)}** · ${formatSignedNumber(entry.delta)}${tempo ? ` · ${tempo}` : ""} · ${formatNumber(entry.from)} → ${formatNumber(entry.to)}`;
  });
}

function renderActivityLines(authors = [], limit = 5) {
  const items = (Array.isArray(authors) ? authors : []).slice(0, limit);
  if (!items.length) return [];
  return items.map((entry, index) => {
    const medal = MEDALS[index] || `${index + 1}.`;
    const sessions = Number(entry.sessionsCount || 0) > 0 ? ` · ${formatNumber(entry.sessionsCount)} сесс.` : "";
    return `${medal} **${formatParticipant(entry)}** · ${formatNumber(entry.messagesCount)} сообщ.${sessions}`;
  });
}

function renderActivityMoverLines(movers = {}, limitPerDirection = 1) {
  if (movers?.available !== true) return [];
  const lines = [];
  const rising = (Array.isArray(movers.up) ? movers.up : []).slice(0, limitPerDirection);
  const falling = (Array.isArray(movers.down) ? movers.down : []).slice(0, limitPerDirection);

  for (const entry of rising) {
    const roleLine = entry.roleChanged ? ` · роль ${formatActivityRoleLabel(entry.fromAppliedRoleKey)} → ${formatActivityRoleLabel(entry.toAppliedRoleKey)}` : "";
    lines.push(`↗ **${formatParticipant(entry)}** · ${formatSignedNumber(entry.delta)} активности (${formatNumber(entry.fromScore)} → ${formatNumber(entry.toScore)})${roleLine}`);
  }

  for (const entry of falling) {
    const roleLine = entry.roleChanged ? ` · роль ${formatActivityRoleLabel(entry.fromAppliedRoleKey)} → ${formatActivityRoleLabel(entry.toAppliedRoleKey)}` : "";
    lines.push(`↘ **${formatParticipant(entry)}** · ${formatSignedNumber(entry.delta)} активности (${formatNumber(entry.fromScore)} → ${formatNumber(entry.toScore)})${roleLine}`);
  }

  return lines;
}

function renderGameplayLines(players = [], limit = 5) {
  const items = (Array.isArray(players) ? players : []).slice(0, limit);
  if (!items.length) return [];
  return items.map((entry, index) => {
    const medal = MEDALS[index] || `${index + 1}.`;
    const source = entry.sourceType === "roblox_session_history" ? "сессии" : "почасовой учёт";
    return `${medal} **${formatParticipant(entry)}** · ${formatDuration(entry.minutes * 60)} JJS · ${source}`;
  });
}

function renderNewcomerLines(events = [], limit = 6) {
  const items = (Array.isArray(events) ? events : []).slice(0, limit);
  if (!items.length) return [];
  const groups = [
    ["guild_joined", "👋 зашли"],
    ["roblox_verified", "✅ верифицировались"],
    ["access_granted", "🔓 получили доступ"],
  ];
  return groups.map(([eventType, label]) => {
    const names = items
      .filter((entry) => entry.eventType === eventType)
      .map((entry) => `**${formatParticipant(entry)}**`);
    return names.length ? `${label}: ${names.join(", ")}` : null;
  }).filter(Boolean);
}

function renderTierlistLines(updates = [], limit = 5) {
  const items = (Array.isArray(updates) ? updates : []).slice(0, limit);
  if (!items.length) return [];
  return items.map((entry) => `🧩 **${formatParticipant(entry)}** · мейн: **${entry.mainName || "неизвестно"}** · x${entry.influenceMultiplier || 1}`);
}

function renderTierlistShiftLines(shifts = {}, limit = 2) {
  if (shifts?.available !== true) return [];
  const items = (Array.isArray(shifts.items) ? shifts.items : []).slice(0, limit);
  if (!items.length) return [];

  return items.map((entry) => {
    const parts = [];
    if (entry.mainChanged) {
      parts.push(`${entry.fromMainName || "—"} → ${entry.toMainName || "—"}`);
    }
    if (Number(entry.influenceDelta) !== 0) {
      const icon = Number(entry.influenceDelta) > 0 ? "📈" : "📉";
      parts.push(`${icon} x${formatNumber(entry.fromInfluenceMultiplier)} → x${formatNumber(entry.toInfluenceMultiplier)}`);
    }
    return `↔ **${formatParticipant(entry)}** · ${parts.join(" · ")}`;
  });
}

function renderVoiceLines(visitors = [], limit = 5) {
  const items = (Array.isArray(visitors) ? visitors : []).slice(0, limit);
  if (!items.length) return [];
  return items.map((entry, index) => {
    const medal = MEDALS[index] || `${index + 1}.`;
    const moves = Number(entry.moveCount || 0) > 0 ? ` · переходы ${formatNumber(entry.moveCount)}` : "";
    return `${medal} **${formatParticipant(entry)}** · ${formatDuration(entry.totalDurationSeconds)}${moves}`;
  });
}

function renderModerationLines(events = [], limit = 5) {
  const items = (Array.isArray(events) ? events : []).slice(0, limit);
  if (!items.length) return [];
  return items.map((entry) => {
    const label = formatModerationPublicLabel(entry);
    const icon = entry.eventType === "ban_add" ? "🔨" : entry.eventType === "ban_remove" ? "🕊️" : "🛡️";
    return `${icon} **${formatParticipant(entry)}** · ${label}`;
  });
}

function formatActivityRoleLabel(roleKey = "") {
  const labels = {
    dead: "мертвец",
    weak: "слабая активность",
    floating: "плавающая активность",
    active: "актив",
    stable: "стабильный актив",
    core: "ядро",
  };
  return labels[cleanString(roleKey, 80)] || cleanString(roleKey, 80) || "—";
}

function formatModerationPublicLabel(entry = {}) {
  const type = cleanString(entry.eventType, 80);
  const resolution = cleanString(entry.resolution, 120);
  if (type === "ban_add") return "бан";
  if (type === "ban_remove") return "разбан";
  if (type === "timeout_add") return "таймаут";
  if (type === "timeout_remove") return "таймаут снят";
  if (type === "member_remove" && resolution === "kick_confirmed") return "кик";
  if (type === "member_remove") return "ушёл";
  return "модерация";
}

function renderDeadTransitionLines(movers = {}) {
  const items = Array.isArray(movers?.deadTransitions) ? movers.deadTransitions : [];
  return items.map((entry) => {
    if (entry.deadTransition === "left_dead") {
      return `↗ **${formatParticipant(entry)}** вышел из мертвецов: ${formatActivityRoleLabel(entry.fromAppliedRoleKey)} → ${formatActivityRoleLabel(entry.toAppliedRoleKey)}`;
    }
    if (entry.deadTransition === "became_dead") {
      return `↘ **${formatParticipant(entry)}** стал мертвецом: ${formatActivityRoleLabel(entry.fromAppliedRoleKey)} → ${formatActivityRoleLabel(entry.toAppliedRoleKey)}`;
    }
    return null;
  }).filter(Boolean);
}

function renderAntiteamSupportLines(upgrades = [], limit = 5) {
  const items = (Array.isArray(upgrades) ? upgrades : []).slice(0, limit);
  return items.map((entry) => (
    `🛡️ **${formatParticipant(entry)}** апнул антитим: ${entry.fromLevel?.label || "без ранга"} → ${entry.toLevel?.label || "новый ранг"} · ${formatNumber(entry.fromPoints)} → ${formatNumber(entry.toPoints)}`
  ));
}

function renderAntiteamThreadLines(upgrades = [], limit = 20) {
  return (Array.isArray(upgrades) ? upgrades : []).slice(0, limit).map((entry, index) => {
    const medal = MEDALS[index] || `${index + 1}.`;
    return `${medal} **${formatParticipant(entry)}** · ${formatSignedNumber(entry.deltaPoints)} очк. · ${formatNumber(entry.fromPoints)} → ${formatNumber(entry.toPoints)} · ${entry.fromLevel?.label || "без ранга"} → ${entry.toLevel?.label || "новый ранг"}`;
  });
}

function collectStrongChangeEntries(digest = {}, limit = 5) {
  const entries = [];
  for (const entry of Array.isArray(digest.publicEdition?.kills?.topUpgrades) ? digest.publicEdition.kills.topUpgrades : []) {
    entries.push({
      module: "kills",
      key: createKillEventKey(entry),
      score: Math.max(1, Number(entry.delta) || 0),
      line: `⚔️ **${formatParticipant(entry)}** · рост киллов ${formatSignedNumber(entry.delta)}${formatKillTempo(entry) ? ` · ${formatKillTempo(entry)}` : ""} (${formatNumber(entry.from)} → ${formatNumber(entry.to)})`,
    });
  }

  const movers = digest.publicEdition?.activity?.movers;
  for (const entry of Array.isArray(movers?.roleChanges) ? movers.roleChanges : []) {
    if (Number(entry.roleRankDelta) <= 0) continue;
    entries.push({
      module: "activity",
      key: `activity-role|${cleanString(entry.userId, 80)}|${entry.fromAppliedRoleKey}|${entry.toAppliedRoleKey}`,
      score: 160 + (Number(entry.roleRankDelta) * 30) + Math.max(0, Number(entry.delta) || 0),
      line: `↗ **${formatParticipant(entry)}** · уровень активности ${formatActivityRoleLabel(entry.fromAppliedRoleKey)} → ${formatActivityRoleLabel(entry.toAppliedRoleKey)} · ${formatSignedNumber(entry.delta)} очк.`,
    });
  }

  for (const entry of Array.isArray(movers?.deadTransitions) ? movers.deadTransitions : []) {
    if (entry.deadTransition !== "left_dead") continue;
    entries.push({
      module: "activity",
      key: `activity-dead|${cleanString(entry.userId, 80)}|${entry.deadTransition}`,
      score: 220 + Math.max(0, Number(entry.delta) || 0),
      line: `↗ **${formatParticipant(entry)}** · вышел из мертвецов · ${formatSignedNumber(entry.delta)} очк.`,
    });
  }

  for (const entry of Array.isArray(digest.publicEdition?.antiteam?.upgrades) ? digest.publicEdition.antiteam.upgrades : []) {
    entries.push({
      module: "antiteam",
      key: `antiteam|${cleanString(entry.userId, 80)}|${entry.toPoints}`,
      score: 200 + (Number(entry.toLevel?.level) || 0) * 40 + (Number(entry.deltaPoints) || 0),
      line: `🛡️ **${formatParticipant(entry)}** · антитим ${entry.fromLevel?.label || "без ранга"} → ${entry.toLevel?.label || "новый ранг"} · ${formatSignedNumber(entry.deltaPoints)} очк.`,
    });
  }

  const shifts = digest.publicEdition?.tierlist?.shifts;
  for (const entry of Array.isArray(shifts?.items) ? shifts.items : []) {
    if (Number(entry.influenceDelta) <= 0 && !entry.mainChanged) continue;
    entries.push({
      module: "tierlist",
      key: `tierlist|${cleanString(entry.userId, 80)}|${entry.fromMainName}|${entry.toMainName}|${entry.influenceDelta}`,
      score: 80 + Math.max(0, Number(entry.influenceDelta) || 0) * 30 + (entry.mainChanged ? 20 : 0),
      line: `🧩 **${formatParticipant(entry)}** · тирлист ${entry.mainChanged ? `${entry.fromMainName || "—"} → ${entry.toMainName || "—"}` : `x${formatNumber(entry.fromInfluenceMultiplier)} → x${formatNumber(entry.toInfluenceMultiplier)}`}`,
    });
  }

  return entries
    .sort((left, right) => right.score - left.score || left.line.localeCompare(right.line, undefined, { sensitivity: "base" }))
    .slice(0, limit)
    .map((entry, index) => ({
      ...entry,
      line: `${MEDALS[index] || `${index + 1}.`} ${entry.line}`,
    }));
}

function buildStrongChangeEntries(digest = {}, limit = 5) {
  return collectStrongChangeEntries(digest, limit).map((entry) => entry.line);
}

function renderActivityScoreMoverLines(entries = [], direction = "up", limit = 5) {
  const items = (Array.isArray(entries) ? entries : []).slice(0, limit);
  const icon = direction === "down" ? "↘" : "↗";
  return items.map((entry, index) => {
    const medal = MEDALS[index] || `${index + 1}.`;
    const roleLine = entry.roleChanged
      ? ` · ${formatActivityRoleLabel(entry.fromAppliedRoleKey)} → ${formatActivityRoleLabel(entry.toAppliedRoleKey)}`
      : "";
    return `${medal} ${icon} **${formatParticipant(entry)}** · ${formatSignedNumber(entry.delta)} очк. активности (${formatNumber(entry.fromScore)} → ${formatNumber(entry.toScore)})${roleLine}`;
  });
}

function chunkLines(header = "", lines = [], limit = 20) {
  const result = [];
  const items = Array.isArray(lines) ? lines.filter((line) => cleanString(line, 500)) : [];
  for (let index = 0; index < items.length; index += limit) {
    const slice = items.slice(index, index + limit);
    if (!slice.length) continue;
    const suffix = items.length > limit ? ` · ${Math.floor(index / limit) + 1}/${Math.ceil(items.length / limit)}` : "";
    result.push({
      content: trimLines([
        `${header}${suffix}`,
        SECTION_SEPARATOR,
        ...slice,
      ], 3900),
      allowedMentions: DENY_ALLOWED_MENTIONS,
    });
  }
  return result;
}

function renderCoverageLines(digest = {}) {
  const reasons = Array.isArray(digest.coverage?.reasons) ? digest.coverage.reasons : [];
  if (!reasons.length) return ["✅ Все текущие источники прошли без partial/ambiguous markers."];
  return [
    `${getCoverageLabel(digest)} · ${reasons.join(", ")}`,
    "Подробности ушли в staff-аудит, публичный выпуск не притворяется точнее источников.",
  ];
}

function buildCoverSpec(digest = {}, config = {}) {
  const presentation = config.presentation || {};
  const accentColor = cleanString(presentation.accentColor, 16) || "#D6A441";
  const accentColorAlt = cleanString(presentation.accentColorAlt, 16) || "#5DA9E9";
  return {
    visualMode: cleanString(presentation.visualMode, 40) || "edition",
    masthead: cleanString(presentation.masthead, 120) || "Daily Edition",
    title: `Выпуск дня · ${formatMoscowDate(digest.dayKey)}`,
    subtitle: (buildStoryLine(digest) || `Выпуск дня · ${formatMoscowDate(digest.dayKey)}`).replace(/\*\*/g, ""),
    accentColor,
    accentColorAlt,
    backgroundColor: cleanString(presentation.backgroundColor, 16) || "#101418",
    metrics: [
      { label: "Апы", value: digest.publicEdition?.kills?.upgradeCount || 0, icon: "⚔️" },
      { label: "Сообщ.", value: digest.publicEdition?.activity?.totalMessagesCount || 0, icon: "💬" },
      { label: "JJS", value: digest.publicEdition?.gameplay?.precisePlayerCount || 0, icon: "🎮" },
      { label: "Новые", value: digest.publicEdition?.newcomers?.newcomerCount || 0, icon: "🆕" },
      { label: "Voice", value: digest.publicEdition?.voice?.visitorCount || 0, icon: "🎙️" },
      { label: "Аудит", value: digest.audit?.rawCandidateCounts?.total || 0, icon: "🧾" },
    ],
  };
}

function buildPublicEmbed(digest = {}, config = {}) {
  const accentColor = normalizeHexColor(config.presentation?.accentColor, DEFAULT_ACCENT_COLOR);
  const altColor = normalizeHexColor(config.presentation?.accentColorAlt, DEFAULT_ALT_COLOR);
  const metrics = buildHeroMetrics(digest);
  const topMessages = getTopMessageAuthor(digest)?.messagesCount || 0;
  const maxMessages = Math.max(1, topMessages, digest.publicEdition?.activity?.totalMessagesCount || 1);
  const topVoiceSeconds = getTopVoiceVisitor(digest)?.totalDurationSeconds || 0;
  const maxVoiceSeconds = Math.max(1, topVoiceSeconds);
  const activityMoverLines = renderActivityMoverLines(digest.publicEdition?.activity?.movers, 1);
  const tierlistShiftLines = renderTierlistShiftLines(digest.publicEdition?.tierlist?.shifts, 2);
  const storyLine = buildStoryLine(digest);
  const descriptionLines = [
    storyLine,
    storyLine ? "" : null,
    metrics.length ? SECTION_SEPARATOR : null,
    metrics.length ? "**Акценты дня**" : null,
    ...metrics,
    `🕘 окно: **${formatMoscowWindow(digest.coverageWindow)}**`,
    digest.coverage?.partial || digest.coverage?.ambiguous ? `📡 статус: **${getCoverageLabel(digest)}**` : null,
  ].filter(Boolean);
  const fields = [];
  const pushField = (name, lines, inline = false) => {
    const normalizedLines = (Array.isArray(lines) ? lines : []).filter((line) => cleanString(line, 500));
    if (!normalizedLines.length) return;
    fields.push(createEmbedField(name, normalizedLines, inline));
  };

  pushField("⚔️ Киллы · апы", renderKillLines(digest.publicEdition?.kills?.topUpgrades, 5));
  pushField("💬 Активность · топ сообщений", [
    digest.publicEdition?.activity?.topMessageAuthors?.length ? makeBar("чат", topMessages, maxMessages) : null,
    ...renderActivityLines(digest.publicEdition?.activity?.topMessageAuthors, 5),
    ...activityMoverLines,
  ].filter(Boolean));
  pushField("🎮 JJS · топ игры", renderGameplayLines(digest.publicEdition?.gameplay?.topPlayers, 5));
  pushField("👋 Новые и верификация", renderNewcomerLines(digest.publicEdition?.newcomers?.highlights, 6));
  pushField("🎙️ Voice · лидеры эфира", [
    digest.publicEdition?.voice?.topVisitors?.length ? makeBar("voice", topVoiceSeconds, maxVoiceSeconds) : null,
    ...renderVoiceLines(digest.publicEdition?.voice?.topVisitors, 5),
  ].filter(Boolean));
  pushField("🛡️ Модерация", renderModerationLines(digest.publicEdition?.moderation?.highlights, 5));
  pushField("🧩 Тирлист · обновления", [
    ...renderTierlistLines(digest.publicEdition?.tierlist?.updates, 5),
    ...tierlistShiftLines,
  ]);
  pushField("🛡️ Антитим · новые ранги", renderAntiteamSupportLines(digest.publicEdition?.antiteam?.upgrades, 5));
  pushField("☠️ Мертвецы", renderDeadTransitionLines(digest.publicEdition?.activity?.movers));
  if (digest.coverage?.partial || digest.coverage?.ambiguous) {
    pushField("📡 Покрытие", renderCoverageLines(digest));
  }

  return {
    title: `🗞️ ${cleanString(config.presentation?.masthead, 120) || "Daily Edition"} · ${formatMoscowDate(digest.dayKey)}`,
    description: trimLines(descriptionLines, 4096),
    color: accentColor || altColor,
    fields,
    footer: {
      text: `Дайджест дня · ${digest.coverageWindow?.timeZone || "Europe/Moscow"} · ${getCoverageLabel(digest)}`,
    },
    timestamp: cleanString(digest.compiledAt, 80) || undefined,
  };
}

function buildPublicThreadMessages(digest = {}) {
  const messages = [];
  const shouldPublishVoiceThread = digest.publicEdition?.voice?.publishFullListInThread === true;
  const voiceVisitors = Array.isArray(digest.voice?.visitors) ? digest.voice.visitors : [];
  if (shouldPublishVoiceThread && voiceVisitors.length) {
    messages.push(...chunkLines(
      `🎙️ **Полный voice-лидерборд · ${formatMoscowDate(digest.dayKey)}**`,
      renderVoiceLines(voiceVisitors, voiceVisitors.length),
      20
    ));
  }

  const allUpgrades = Array.isArray(digest.kills?.allUpgrades) ? digest.kills.allUpgrades : [];
  if (allUpgrades.length) {
    messages.push(...chunkLines(
      `⚔️ **Все апы киллов · ${formatMoscowDate(digest.dayKey)}**`,
      renderKillLines(allUpgrades, allUpgrades.length),
      20
    ));
  }

  const activityMovers = digest.publicEdition?.activity?.movers || {};
  const activityUpLines = renderActivityScoreMoverLines(activityMovers.up, "up", 20);
  if (activityUpLines.length) {
    messages.push(...chunkLines(
      `↗ **Рост активности · ${formatMoscowDate(digest.dayKey)}**`,
      activityUpLines,
      20
    ));
  }

  const activityDownLines = renderActivityScoreMoverLines(activityMovers.down, "down", 20);
  if (activityDownLines.length) {
    messages.push(...chunkLines(
      `↘ **Падение активности · ${formatMoscowDate(digest.dayKey)}**`,
      activityDownLines,
      20
    ));
  }

  const publicActivityAuthors = (Array.isArray(digest.activity?.allMessageAuthors) ? digest.activity.allMessageAuthors : [])
    .filter((entry) => entry?.hasImpreciseRows !== true);
  if (publicActivityAuthors.length) {
    messages.push(...chunkLines(
      `💬 **Полный чат-лидерборд · ${formatMoscowDate(digest.dayKey)}**`,
      renderActivityLines(publicActivityAuthors, publicActivityAuthors.length),
      20
    ));
  }

  const gameplayItems = (Array.isArray(digest.staffDigest?.gameplay?.items) ? digest.staffDigest.gameplay.items : [])
    .filter((entry) => entry?.preciseWindow === true);
  if (gameplayItems.length) {
    messages.push(...chunkLines(
      `🎮 **Полный топ времени JJS · ${formatMoscowDate(digest.dayKey)}**`,
      renderGameplayLines(gameplayItems, gameplayItems.length),
      20
    ));
  }

  const antiteamUpgrades = Array.isArray(digest.publicEdition?.antiteam?.upgrades) ? digest.publicEdition.antiteam.upgrades : [];
  if (antiteamUpgrades.length) {
    messages.push(...chunkLines(
      `🛡️ **Антитим-очки и новые ранги · ${formatMoscowDate(digest.dayKey)}**`,
      renderAntiteamThreadLines(antiteamUpgrades, antiteamUpgrades.length),
      20
    ));
  }

  return messages;
}

function renderBucketLines(bucketCounts = {}) {
  const order = [
    ["published_public", "🟢 public"],
    ["published_staff", "🔵 staff"],
    ["suppressed_by_threshold", "⚪ скрыто"],
    ["pending_review", "🟡 pending"],
    ["rejected", "🔴 rejected"],
    ["expired", "⌛ expired"],
    ["superseded", "♻️ superseded"],
    ["ambiguous_source", "⚠️ ambiguous"],
    ["invalid_source", "⛔ invalid"],
    ["orphaned", "🧩 orphaned"],
  ];
  return order.map(([key, label]) => `${label}: **${formatNumber(bucketCounts?.[key] || 0)}**`);
}

function renderKillStaffLines(items = [], limit = 8) {
  const list = (Array.isArray(items) ? items : [])
    .filter((entry) => entry.bucket !== "published_public")
    .slice(0, limit);
  if (!list.length) return ["— в этом окне нет staff-only kill submissions"];
  return list.map((entry) => `${entry.bucket === "rejected" ? "🔴" : entry.bucket === "pending_review" ? "🟡" : "⚪"} **${formatParticipant(entry)}** · ${entry.status} · ${formatNumber(entry.kills)} kills · ${entry.bucketDetail || entry.bucket}`);
}

function compareAuditWatchlistEntries(left = {}, right = {}) {
  const leftMs = parseIsoMs(left.occurredAt);
  const rightMs = parseIsoMs(right.occurredAt);
  if (leftMs !== null && rightMs !== null && leftMs !== rightMs) {
    return leftMs - rightMs;
  }
  if (leftMs !== null && rightMs === null) return -1;
  if (leftMs === null && rightMs !== null) return 1;
  return cleanString(left.module, 40).localeCompare(cleanString(right.module, 40), undefined, { sensitivity: "base" })
    || cleanString(left.displayName, 120).localeCompare(cleanString(right.displayName, 120), undefined, { sensitivity: "base" });
}

function isWatchlistAuditCandidate(candidate = {}) {
  const module = cleanString(candidate.module, 40);
  const bucket = cleanString(candidate.bucket, 80);
  if (!module || !bucket || module === "kills") return false;
  if (bucket === "published_staff") return module === "moderation";
  return [
    "pending_review",
    "rejected",
    "expired",
    "superseded",
    "ambiguous_source",
    "invalid_source",
    "orphaned",
  ].includes(bucket);
}

function renderAuditWatchlistLines(candidates = [], limit = 8) {
  const bucketMeta = {
    published_staff: { icon: "🔵", label: "staff-only" },
    pending_review: { icon: "🟡", label: "pending" },
    rejected: { icon: "🔴", label: "rejected" },
    expired: { icon: "⌛", label: "expired" },
    superseded: { icon: "♻️", label: "superseded" },
    ambiguous_source: { icon: "⚠️", label: "ambiguous" },
    invalid_source: { icon: "⛔", label: "invalid" },
    orphaned: { icon: "🧩", label: "orphaned" },
  };
  const moduleLabels = {
    voice: "voice",
    moderation: "модерация",
    activity: "активность",
    newcomers: "новички",
    gameplay: "jjs",
    tierlist: "тирлист",
  };
  const hiddenDetails = new Set(["staff_digest_only"]);
  const list = (Array.isArray(candidates) ? candidates : [])
    .filter(isWatchlistAuditCandidate)
    .sort(compareAuditWatchlistEntries)
    .slice(0, limit);
  if (!list.length) return ["— вне kills сейчас нет заметных слепых зон по непубличным источникам"];

  return list.map((candidate) => {
    const bucket = cleanString(candidate.bucket, 80);
    const meta = bucketMeta[bucket] || { icon: "⚪", label: bucket || "unknown" };
    const detail = cleanString(candidate.detail, 200);
    const detailText = detail && !hiddenDetails.has(detail) ? ` · ${detail}` : "";
    const displayName = formatParticipant(candidate, cleanString(candidate.userId, 80) || "неизвестно");
    const moduleLabel = moduleLabels[cleanString(candidate.module, 40)] || cleanString(candidate.module, 40) || "unknown";
    return `${meta.icon} **${displayName}** · ${moduleLabel} · ${meta.label}${detailText}`;
  });
}

function buildStaffEmbed(digest = {}, config = {}) {
  const accentColor = normalizeHexColor(config.presentation?.accentColorAlt, DEFAULT_ALT_COLOR);
  const bucketCounts = digest.audit?.bucketCounts || {};
  return {
    title: `🧾 Staff Audit · ${formatMoscowDate(digest.dayKey)}`,
    description: trimLines([
      `Собрано: **${cleanString(digest.compiledAt, 80) || "—"}**`,
      `Окно: **${formatMoscowWindow(digest.coverageWindow)}**`,
      `Статус: **${getCoverageLabel(digest)}**`,
      SECTION_SEPARATOR,
      buildStoryLine(digest),
    ], 4096),
    color: accentColor,
    fields: [
      createEmbedField("📊 Bucket trail", renderBucketLines(bucketCounts), true),
      createEmbedField("⚔️ Kills staff trail", renderKillStaffLines(digest.staffDigest?.kills?.items, 8), false),
      createEmbedField("👀 Audit watchlist", renderAuditWatchlistLines(digest.audit?.candidates, 8), false),
      createEmbedField("💬 Activity diagnostics", [
        `rows: **${formatNumber(digest.staffDigest?.activity?.sourceRowCount || 0)}**`,
        `imprecise rows: **${formatNumber(digest.staffDigest?.activity?.impreciseRowCount || 0)}**`,
        digest.staffDigest?.activity?.movers?.available === true
          ? `movers: **${formatNumber(digest.staffDigest.activity.movers.changedUserCount || 0)}** changed / **${formatNumber(digest.staffDigest.activity.movers.comparedUserCount || 0)}** compared`
          : `movers: **${digest.staffDigest?.activity?.movers?.reason || "available"}**`,
      ], true),
      createEmbedField("🎮 JJS diagnostics", [
        `players: **${formatNumber(digest.staffDigest?.gameplay?.sourcePlayerCount || 0)}**`,
        `precise: **${formatNumber(digest.staffDigest?.gameplay?.precisePlayerCount || 0)}**`,
        `ambiguous daily buckets: **${formatNumber(digest.staffDigest?.gameplay?.ambiguousDailyBucketCount || 0)}**`,
      ], true),
      createEmbedField("🆕 Newcomer diagnostics", [
        `events: **${formatNumber(digest.staffDigest?.newcomers?.sourceEventCount || 0)}**`,
        `joined: **${formatNumber(digest.publicEdition?.newcomers?.newcomerCount || 0)}**`,
        `verified: **${formatNumber(digest.publicEdition?.newcomers?.verifiedCount || 0)}**`,
      ], true),
      createEmbedField("🧩 Tierlist diagnostics", [
        `updates: **${formatNumber(digest.staffDigest?.tierlist?.sourceUpdateCount || 0)}**`,
        digest.staffDigest?.tierlist?.shifts?.available === true
          ? `shifts: **${formatNumber(digest.staffDigest.tierlist.shifts.totalShiftCount || 0)}** historical changes`
          : `shifts: **${digest.staffDigest?.tierlist?.shifts?.reason || "available"}**`,
      ], true),
      createEmbedField("🛡️ Moderation diagnostics", [
        `events: **${formatNumber(digest.staffDigest?.moderation?.totalCount || 0)}**`,
        `ambiguous: **${formatNumber(digest.staffDigest?.moderation?.ambiguousCount || 0)}**`,
      ], true),
      createEmbedField("📡 Coverage reasons", renderCoverageLines(digest), false),
    ],
    footer: {
      text: `Raw candidates: ${formatNumber(digest.audit?.rawCandidateCounts?.total || 0)} · Staff digest строится из того же собранного digest`,
    },
    timestamp: cleanString(digest.compiledAt, 80) || undefined,
  };
}

function renderDailyNewsIssue({ digest = {}, config = {} } = {}) {
  if (!digest || typeof digest !== "object" || Array.isArray(digest)) {
    throw new Error("digest must be an object");
  }
  const masthead = cleanString(config.presentation?.masthead, 120) || "Daily Edition";
  const publicEmbed = buildPublicEmbed(digest, config);
  const staffEmbed = buildStaffEmbed(digest, config);
  const publicThreadMessages = buildPublicThreadMessages(digest);
  const storyLine = buildStoryLine(digest);
  const heroMetrics = buildHeroMetrics(digest);

  return {
    dayKey: cleanString(digest.dayKey, 40),
    coverSpec: buildCoverSpec(digest, config),
    publicMessage: {
      content: trimLines([
        `# 🗞️ ${masthead} · ${formatMoscowDate(digest.dayKey)}`,
        storyLine ? `> ${storyLine}` : null,
        heroMetrics.length ? SECTION_SEPARATOR : null,
        heroMetrics.length ? heroMetrics.join("  •  ") : null,
      ].filter(Boolean), 1900),
      embeds: [publicEmbed],
      allowedMentions: DENY_ALLOWED_MENTIONS,
    },
    publicThreadTitle: `Daily News · ${formatMoscowDate(digest.dayKey)}`,
    publicThreadMessages,
    staffMessage: {
      content: trimLines([
        `## 🧾 Staff Audit · ${masthead} · ${formatMoscowDate(digest.dayKey)}`,
        `${getCoverageLabel(digest)} · candidates ${formatNumber(digest.audit?.rawCandidateCounts?.total || 0)}`,
      ], 1900),
      embeds: [staffEmbed],
      allowedMentions: DENY_ALLOWED_MENTIONS,
    },
    diagnostics: {
      coverage: clone(digest.coverage || {}),
      audit: clone(digest.audit || {}),
      publicThreadMessageCount: publicThreadMessages.length,
      hasPublicHighlights: Boolean(
        digest.publicEdition?.kills?.enabled
        || digest.publicEdition?.activity?.enabled
        || digest.publicEdition?.newcomers?.enabled
        || digest.publicEdition?.gameplay?.enabled
        || digest.publicEdition?.tierlist?.enabled
        || digest.publicEdition?.voice?.enabled
        || digest.publicEdition?.moderation?.enabled
        || digest.publicEdition?.antiteam?.enabled
      ),
    },
  };
}

module.exports = {
  renderDailyNewsIssue,
};
