"use strict";

// Time helpers for tournaments. The moderator enters a start time "по МСК"
// (Moscow time, UTC+3 year-round). We convert it to an absolute instant and
// render it with Discord's `<t:unix:style>` markup so every viewer sees it in
// their own local timezone automatically.

const MSK_OFFSET_MINUTES = 180; // UTC+3, no DST

// Accepted inputs (all interpreted as MSK wall-clock):
//   "2026-06-25 20:00"      ISO-ish date + time
//   "25.06.2026 20:00"      dotted day-first, full year
//   "25.06 20:00"           dotted day-first, year inferred
//   "25.06.26 20:00"        dotted day-first, 2-digit year
//   "20:00"                 time only → today (or tomorrow if already past)
const ISO_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/;
const DOTTED_RE = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?(?:[ T](\d{1,2}):(\d{2}))?$/;
const TIME_ONLY_RE = /^(\d{1,2}):(\d{2})$/;

function mskPartsNow(nowMs) {
  // Current wall-clock in MSK, derived without relying on the host timezone.
  const shifted = new Date(nowMs + MSK_OFFSET_MINUTES * 60000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function normalizeYear(rawYear, fallbackYear) {
  if (rawYear == null || rawYear === "") return fallbackYear;
  const value = Number(rawYear);
  if (!Number.isFinite(value)) return fallbackYear;
  if (String(rawYear).length <= 2) return 2000 + value;
  return value;
}

function buildMskInstant({ year, month, day, hour, minute }) {
  if (
    month < 1 || month > 12 ||
    day < 1 || day > 31 ||
    hour < 0 || hour > 23 ||
    minute < 0 || minute > 59
  ) {
    return null;
  }
  const ms = Date.UTC(year, month - 1, day, hour, minute, 0) - MSK_OFFSET_MINUTES * 60000;
  // reject overflow dates (e.g. 31.02) by round-tripping
  const back = new Date(ms + MSK_OFFSET_MINUTES * 60000);
  if (back.getUTCMonth() + 1 !== month || back.getUTCDate() !== day) return null;
  return ms;
}

// Parse a moderator's MSK input. Returns { ok: true, ms, unix, iso } or
// { ok: false, error }.
function parseMskDateTime(input, options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const text = String(input == null ? "" : input).trim();
  if (!text) return { ok: false, error: "Укажи дату и время по МСК." };

  const todayMsk = mskPartsNow(nowMs);
  let parts = null;

  let m = text.match(ISO_RE);
  if (m) {
    parts = {
      year: Number(m[1]),
      month: Number(m[2]),
      day: Number(m[3]),
      hour: m[4] != null ? Number(m[4]) : 0,
      minute: m[5] != null ? Number(m[5]) : 0,
    };
  }

  if (!parts && (m = text.match(DOTTED_RE))) {
    parts = {
      day: Number(m[1]),
      month: Number(m[2]),
      year: normalizeYear(m[3], todayMsk.year),
      hour: m[4] != null ? Number(m[4]) : 0,
      minute: m[5] != null ? Number(m[5]) : 0,
    };
  }

  if (!parts && (m = text.match(TIME_ONLY_RE))) {
    parts = {
      ...todayMsk,
      hour: Number(m[1]),
      minute: Number(m[2]),
    };
  }

  if (!parts) {
    return {
      ok: false,
      error: "Не понял формат. Примеры: `25.06 20:00`, `25.06.2026 20:00`, `2026-06-25 20:00`.",
    };
  }

  let ms = buildMskInstant(parts);
  if (ms == null) return { ok: false, error: "Такой даты/времени не существует." };

  // Time-only (and year-inferred) inputs: if the instant is already in the past,
  // roll forward so "20:00" means the next upcoming 20:00.
  if (ms < nowMs && TIME_ONLY_RE.test(text)) {
    ms = buildMskInstant({ ...parts, day: parts.day + 1 }) ?? ms;
  }

  return { ok: true, ms, unix: Math.floor(ms / 1000), iso: new Date(ms).toISOString() };
}

function toUnixSeconds(value) {
  if (Number.isFinite(value)) {
    // already seconds if small-ish, else treat as ms
    return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  }
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

// `<t:unix:style>` — F = full date+time, R = relative, f, D, t, etc.
function discordTimestamp(value, style = "F") {
  const unix = toUnixSeconds(value);
  if (unix == null) return "—";
  return `<t:${unix}:${style}>`;
}

// Combined "full (relative)" rendering used across the panels.
function formatStartTime(value) {
  const unix = toUnixSeconds(value);
  if (unix == null) return "—";
  return `<t:${unix}:F> (<t:${unix}:R>)`;
}

module.exports = {
  MSK_OFFSET_MINUTES,
  parseMskDateTime,
  discordTimestamp,
  formatStartTime,
  toUnixSeconds,
};
