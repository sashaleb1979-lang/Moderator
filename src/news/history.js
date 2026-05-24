"use strict";

const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_LIMIT_DAYS = 45;

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeDayKey(dayKey = "") {
  const normalizedDayKey = cleanString(dayKey, 40);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalizedDayKey) ? normalizedDayKey : "";
}

function parseIsoMs(value) {
  const timeMs = Date.parse(String(value || ""));
  return Number.isFinite(timeMs) ? timeMs : null;
}

function parseMoscowDayKeyMs(dayKey = "") {
  const normalizedDayKey = normalizeDayKey(dayKey);
  if (!normalizedDayKey) return null;
  const timeMs = Date.parse(`${normalizedDayKey}T00:00:00+03:00`);
  return Number.isFinite(timeMs) ? timeMs : null;
}

function formatMoscowDayKey(timeMs) {
  return Number.isFinite(timeMs)
    ? new Date(timeMs + MOSCOW_OFFSET_MS).toISOString().slice(0, 10)
    : "";
}

function resolveMoscowDayKey(value) {
  const timeMs = parseIsoMs(value);
  return Number.isFinite(timeMs) ? new Date(timeMs + MOSCOW_OFFSET_MS).toISOString().slice(0, 10) : "";
}

function shiftMoscowDayKey(dayKey = "", offsetDays = 0) {
  const timeMs = parseMoscowDayKeyMs(dayKey);
  if (!Number.isFinite(timeMs)) return "";
  return formatMoscowDayKey(timeMs + (Number(offsetDays) || 0) * DAY_MS);
}

function normalizeNullableInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
}

function normalizePositiveNumber(value, fallback = 1) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : fallback;
}

function resolveProfileDisplayName(profile = {}, userId = "") {
  return cleanString(
    profile?.summary?.preferredDisplayName
      || profile?.displayName
      || profile?.username
      || profile?.summary?.roblox?.currentUsername
      || profile?.domains?.roblox?.username
      || userId,
    120
  ) || "unknown";
}

function resolveActivityDomain(profile = {}) {
  return profile?.domains?.activity && typeof profile.domains.activity === "object"
    ? profile.domains.activity
    : profile?.summary?.activity && typeof profile.summary.activity === "object"
      ? profile.summary.activity
      : profile?.activity && typeof profile.activity === "object"
        ? profile.activity
        : {};
}

function resolveTierlistDomain(profile = {}) {
  return profile?.domains?.tierlist && typeof profile.domains.tierlist === "object"
    ? profile.domains.tierlist
    : profile?.summary?.tierlist && typeof profile.summary.tierlist === "object"
      ? profile.summary.tierlist
      : {};
}

function buildDailyNewsProfileHistorySnapshot({ db = {} } = {}) {
  const profiles = db.profiles && typeof db.profiles === "object" && !Array.isArray(db.profiles)
    ? db.profiles
    : {};
  const snapshot = {};

  for (const [rawUserId, profile] of Object.entries(profiles)) {
    if (!profile || typeof profile !== "object") continue;
    const userId = cleanString(profile.userId || rawUserId, 80);
    if (!userId) continue;

    const activity = resolveActivityDomain(profile);
    const tierlist = resolveTierlistDomain(profile);
    const activityScore = normalizeNullableInteger(activity?.activityScore);
    const appliedActivityRoleKey = cleanString(activity?.appliedActivityRoleKey, 80) || null;
    const desiredActivityRoleKey = cleanString(activity?.desiredActivityRoleKey, 80) || null;
    const tierlistMainId = cleanString(tierlist?.mainId, 80) || null;
    const tierlistMainName = cleanString(tierlist?.mainName, 120) || null;
    const tierlistInfluenceMultiplier = normalizePositiveNumber(tierlist?.influenceMultiplier, 1);

    if (
      activityScore === null
      && !appliedActivityRoleKey
      && !desiredActivityRoleKey
      && !tierlistMainId
      && !tierlistMainName
      && tierlistInfluenceMultiplier === 1
    ) {
      continue;
    }

    snapshot[userId] = {
      userId,
      displayName: resolveProfileDisplayName(profile, userId),
      activityScore,
      appliedActivityRoleKey,
      desiredActivityRoleKey,
      tierlistMainId,
      tierlistMainName,
      tierlistInfluenceMultiplier,
    };
  }

  return snapshot;
}

function getDailyNewsHistorySnapshot(db = {}, dayKey = "") {
  const normalizedDayKey = normalizeDayKey(dayKey);
  const snapshot = normalizedDayKey ? db.sot?.news?.history?.daySnapshots?.[normalizedDayKey] : null;
  return snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot : null;
}

function shouldCaptureDailyNewsHistorySnapshot({ dayKey = "", now } = {}) {
  const normalizedDayKey = normalizeDayKey(dayKey);
  if (!normalizedDayKey) return false;
  return normalizedDayKey === resolveMoscowDayKey(now);
}

function writeDailyNewsHistorySnapshot({ state = {}, dayKey = "", snapshot = {}, overwrite = false, now = null, limitDays = HISTORY_LIMIT_DAYS } = {}) {
  const normalizedDayKey = normalizeDayKey(dayKey);
  if (!normalizedDayKey || !snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return { stored: false, prunedCount: 0, reason: "invalid_snapshot" };
  }

  state.history ||= { daySnapshots: {}, lastPrunedAt: null };
  state.history.daySnapshots ||= {};
  if (state.history.daySnapshots[normalizedDayKey] && overwrite !== true) {
    return { stored: false, prunedCount: 0, reason: "already_exists" };
  }

  state.history.daySnapshots[normalizedDayKey] = clone(snapshot);
  const dayKeys = Object.keys(state.history.daySnapshots).sort();
  const keepCount = Math.max(1, Number(limitDays) || HISTORY_LIMIT_DAYS);
  let prunedCount = 0;
  while (dayKeys.length > keepCount) {
    const oldestDayKey = dayKeys.shift();
    if (!oldestDayKey) continue;
    delete state.history.daySnapshots[oldestDayKey];
    prunedCount += 1;
  }

  if (prunedCount > 0) {
    state.history.lastPrunedAt = cleanString(now, 80) || state.history.lastPrunedAt || null;
  }

  return { stored: true, prunedCount, reason: null };
}

module.exports = {
  buildDailyNewsProfileHistorySnapshot,
  getDailyNewsHistorySnapshot,
  resolveMoscowDayKey,
  shiftMoscowDayKey,
  shouldCaptureDailyNewsHistorySnapshot,
  writeDailyNewsHistorySnapshot,
};