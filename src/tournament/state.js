"use strict";

// Tournament data layer. Operates directly on the shared `db` object (the same
// object the rest of the bot persists via the coalesced `saveDb`). No Discord
// objects here — the operator wraps mutating calls in the serialized runner and
// calls `saveDb()` after.

const crypto = require("node:crypto");
const { BASE_KILL_TIER_THRESHOLDS, killTierFor } = require("../onboard/kill-tiers");

const TOURNAMENT_STATE_VERSION = 1;

// A player may self-declare a twink/alt only when their main account is at or
// below this many kills (i.e. tier 1-2). Above it we trust the stored kills.
const TWINK_THRESHOLD = 3000;

const TOURNAMENT_STATUSES = Object.freeze([
  "draft",
  "registration",
  "seeded",
  "running",
  "completed",
  "cancelled",
]);

const ACCOUNT_KINDS = Object.freeze(["main", "alt", "twink"]);

// Representative kills for a declared tier, used for seeding when a player gives
// a tier instead of an exact count. Uses the tier's lower bound.
const TIER_REPRESENTATIVE_KILLS = Object.freeze({
  1: 0,
  2: BASE_KILL_TIER_THRESHOLDS[2], // 1000
  3: BASE_KILL_TIER_THRESHOLDS[3], // 4000
  4: BASE_KILL_TIER_THRESHOLDS[4], // 9000
  5: BASE_KILL_TIER_THRESHOLDS[5], // 15000
});

function cleanString(value, limit = 2000) {
  return String(value == null ? "" : value).trim().slice(0, Math.max(0, Number(limit) || 0));
}

function nullableString(value, limit = 2000) {
  return cleanString(value, limit) || null;
}

function nonNegativeInt(value, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function positiveInt(value, fallback = 1) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function isoTimestamp(value, fallback = null) {
  const text = cleanString(value, 80);
  if (!text) return fallback;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : fallback;
}

function stringList(value, { limit = 40, max = 25 } = {}) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const entry of value) {
    const text = cleanString(entry, limit);
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

function nowIso() {
  return new Date().toISOString();
}

function makeId() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

function ensureTournamentState(db = {}) {
  const previous = db.tournament && typeof db.tournament === "object" && !Array.isArray(db.tournament)
    ? db.tournament
    : {};
  const state = {
    version: TOURNAMENT_STATE_VERSION,
    config: {
      defaultChannelId: cleanString(previous.config?.defaultChannelId, 40),
    },
    drafts: previous.drafts && typeof previous.drafts === "object" ? previous.drafts : {},
    tournaments: previous.tournaments && typeof previous.tournaments === "object" ? previous.tournaments : {},
  };
  const mutated = JSON.stringify(db.tournament || null) !== JSON.stringify(state);
  db.tournament = state;
  return { state, mutated };
}

// ---------------------------------------------------------------------------
// Drafts (in-progress setup, one per moderator)
// ---------------------------------------------------------------------------

function getDraft(db, userId) {
  const { state } = ensureTournamentState(db);
  const id = cleanString(userId, 40);
  return id ? state.drafts[id] || null : null;
}

function setDraft(db, userId, patch = {}) {
  const { state } = ensureTournamentState(db);
  const id = cleanString(userId, 40);
  if (!id) throw new Error("userId is required");
  const previous = state.drafts[id] || {};
  const draft = {
    ...previous,
    ...patch,
    userId: id,
    updatedAt: nowIso(),
  };
  state.drafts[id] = draft;
  return draft;
}

function clearDraft(db, userId) {
  const { state } = ensureTournamentState(db);
  const id = cleanString(userId, 40);
  if (!id) return false;
  const existed = Object.prototype.hasOwnProperty.call(state.drafts, id);
  delete state.drafts[id];
  return existed;
}

// ---------------------------------------------------------------------------
// Tournaments
// ---------------------------------------------------------------------------

function normalizeRewards(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    first: nullableString(source.first, 200),
    second: nullableString(source.second, 200),
    third: nullableString(source.third, 200),
    extra: nullableString(source.extra, 400),
  };
}

function createTournamentFromDraft(db, draft = {}, options = {}) {
  const { state } = ensureTournamentState(db);
  const now = isoTimestamp(options.now, nowIso());
  const id = cleanString(options.id, 40) || makeId();
  const slots = positiveInt(draft.slots, 16);
  const tournament = {
    id,
    name: cleanString(draft.name, 120) || "Турнир",
    status: "registration",
    isPhantom: Boolean(draft.isPhantom), // set true when auto-fill is used → not counted anywhere
    createdBy: cleanString(draft.createdBy || draft.userId, 40),
    createdByTag: nullableString(draft.createdByTag, 80),
    createdAt: now,
    updatedAt: now,
    seedingMode: draft.seedingMode === "seed" ? "seed" : "similar",
    plannedPlayers: positiveInt(draft.plannedPlayers, slots),
    slots,
    startsAtIso: isoTimestamp(draft.startsAtIso, null),
    pingRoleIds: stringList(draft.pingRoleIds, { limit: 40, max: 15 }),
    participantRoleId: cleanString(draft.participantRoleId, 40),
    rewards: normalizeRewards(draft.rewards),
    conditions: nullableString(draft.conditions, 1000),
    announce: { channelId: cleanString(draft.announceChannelId, 40), messageId: "" },
    managePanel: { channelId: "", messageId: "" },
    registrationOpen: true,
    registrations: {},
    servers: {},
    results: { first: null, second: null, third: null, organizerComment: null },
  };
  state.tournaments[id] = tournament;
  return tournament;
}

function getTournament(db, id) {
  const { state } = ensureTournamentState(db);
  const key = cleanString(id, 40);
  return key ? state.tournaments[key] || null : null;
}

function listTournaments(db, { status = null } = {}) {
  const { state } = ensureTournamentState(db);
  const all = Object.values(state.tournaments);
  const filtered = status ? all.filter((t) => t.status === status) : all;
  return filtered.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function updateTournament(db, id, patch = {}) {
  const tournament = getTournament(db, id);
  if (!tournament) return null;
  Object.assign(tournament, patch, { updatedAt: nowIso() });
  return tournament;
}

function deleteTournament(db, id) {
  const { state } = ensureTournamentState(db);
  const key = cleanString(id, 40);
  if (!key) return false;
  const existed = Object.prototype.hasOwnProperty.call(state.tournaments, key);
  delete state.tournaments[key];
  return existed;
}

// ---------------------------------------------------------------------------
// Phantom (auto-fill) helpers
// ---------------------------------------------------------------------------

// Generate one-off PHANTOM registration inputs to fill empty slots so a
// tournament can be run end-to-end with made-up players. They use synthetic,
// non-Discord ids (so they can never be pinged or get real roles) and a unique
// run tag (so two fills never collide). Avatars are attached by the operator.
function buildPhantomRegistrations(count, { startIndex = 1, runTag = "x", maxKills = 16000 } = {}) {
  const total = Math.max(0, positiveInt(count, 0));
  const out = [];
  for (let k = 0; k < total; k += 1) {
    const i = startIndex + k;
    const base = Math.round((maxKills * (total - k + 1)) / (total + 1));
    const jitter = ((i * 37) % 11) * 25;
    const robloxId = String(1 + ((i * 7) % 200)); // low real Roblox ids → real avatars
    out.push({
      userId: `phantom:${runTag}:${i}`, // never a real Discord snowflake
      discordName: `Бот-${i}`,
      robloxUserId: robloxId,
      robloxUsername: `Бот-${i}`,
      accountKind: "main",
      approvedKills: Math.max(50, base - jitter),
      killsSource: "phantom",
      isPhantom: true,
    });
  }
  return out;
}

function isPhantomUserId(userId) {
  return String(userId || "").startsWith("phantom:");
}

// ---------------------------------------------------------------------------
// Effective kills (seeding metric)
// ---------------------------------------------------------------------------

function tierRepresentativeKills(tier) {
  const normalized = Number(tier);
  return TIER_REPRESENTATIVE_KILLS[normalized] != null ? TIER_REPRESENTATIVE_KILLS[normalized] : 0;
}

// Resolve the kills value used for seeding from a registration's declarations.
//   main  → stored approvedKills
//   alt   → declaredKills if given, else representative kills for declaredTier,
//           else fall back to approvedKills
//   twink → declared true strength (declaredKills or declaredTier); never below
//           the stored approvedKills
function resolveEffectiveKills({ accountKind, approvedKills = 0, declaredKills = null, declaredTier = null } = {}) {
  const base = nonNegativeInt(approvedKills, 0);
  const declared = declaredKills == null ? null : nonNegativeInt(declaredKills, null);
  const tierKills = declaredTier == null ? null : tierRepresentativeKills(declaredTier);

  if (accountKind === "twink") {
    return Math.max(base, declared != null ? declared : (tierKills != null ? tierKills : base));
  }
  if (accountKind === "alt") {
    if (declared != null) return declared;
    if (tierKills != null) return tierKills;
    return base;
  }
  return base; // main
}

function canSelfDeclareTwink(approvedKills) {
  return nonNegativeInt(approvedKills, 0) <= TWINK_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Registrations
// ---------------------------------------------------------------------------

function normalizeRegistration(value = {}, { now } = {}) {
  const accountKind = ACCOUNT_KINDS.includes(value.accountKind) ? value.accountKind : "main";
  const approvedKills = nonNegativeInt(value.approvedKills, 0);
  const declaredTier = value.declaredTier == null ? null : positiveInt(value.declaredTier, null);
  const declaredKills = value.declaredKills == null ? null : nonNegativeInt(value.declaredKills, null);
  const effectiveKills = value.effectiveKills != null
    ? nonNegativeInt(value.effectiveKills, 0)
    : resolveEffectiveKills({ accountKind, approvedKills, declaredKills, declaredTier });
  return {
    userId: cleanString(value.userId, 40),
    discordName: nullableString(value.discordName, 80),
    robloxUserId: nullableString(value.robloxUserId, 40),
    robloxUsername: nullableString(value.robloxUsername, 40),
    robloxAvatarUrl: nullableString(value.robloxAvatarUrl, 400),
    accountKind,
    isAltMemory: accountKind !== "main",
    approvedKills,
    declaredTier,
    declaredKills,
    effectiveKills,
    effectiveTier: killTierFor(effectiveKills),
    killsSource: nullableString(value.killsSource, 40),
    addedManually: Boolean(value.addedManually),
    isPhantom: Boolean(value.isPhantom) || isPhantomUserId(value.userId),
    registeredAt: isoTimestamp(value.registeredAt, isoTimestamp(now, nowIso())),
    serverIndex: value.serverIndex == null ? null : nonNegativeInt(value.serverIndex, null),
    seedNumber: value.seedNumber == null ? null : positiveInt(value.seedNumber, null),
  };
}

// Roblox profile URL for a registration/player (clickable in V2 TextDisplay).
function robloxProfileUrl(robloxUserId) {
  const id = cleanString(robloxUserId, 40);
  return /^\d+$/.test(id) ? `https://www.roblox.com/users/${id}/profile` : null;
}

const KILLS_SOURCE_LABELS = Object.freeze({
  profile: "профиль",
  "profile-domain": "профиль",
  submission: "пруф",
  "recent-submission": "пруф",
  tierlist: "тир-лист",
  declared: "заявлено",
  manual: "вручную",
  session: "заявка",
});

function killsSourceLabel(source) {
  const key = cleanString(source, 40);
  return KILLS_SOURCE_LABELS[key] || (key || "—");
}

function ensureRegistrations(tournament) {
  if (!tournament.registrations || typeof tournament.registrations !== "object") {
    tournament.registrations = {};
  }
  return tournament.registrations;
}

function upsertRegistration(tournament, registration, options = {}) {
  const registrations = ensureRegistrations(tournament);
  const normalized = normalizeRegistration(registration, options);
  if (!normalized.userId) throw new Error("registration.userId is required");
  const previous = registrations[normalized.userId];
  if (previous) normalized.registeredAt = previous.registeredAt; // preserve original join time
  registrations[normalized.userId] = normalized;
  return normalized;
}

function removeRegistration(tournament, userId) {
  const registrations = ensureRegistrations(tournament);
  const id = cleanString(userId, 40);
  const existed = Object.prototype.hasOwnProperty.call(registrations, id);
  delete registrations[id];
  return existed;
}

function getRegistration(tournament, userId) {
  const registrations = ensureRegistrations(tournament);
  const id = cleanString(userId, 40);
  return id ? registrations[id] || null : null;
}

function listRegistrations(tournament) {
  const registrations = ensureRegistrations(tournament);
  return Object.values(registrations).sort((a, b) =>
    String(a.registeredAt).localeCompare(String(b.registeredAt))
  );
}

function registrationCount(tournament) {
  return Object.keys(ensureRegistrations(tournament)).length;
}

function isFull(tournament) {
  return registrationCount(tournament) >= positiveInt(tournament?.slots, 16);
}

// Player objects for the seeding engine + panels (carries roster metadata so
// every nick can be rendered as a Roblox link with kills/source).
function tournamentPlayers(tournament, { serverIndex = null } = {}) {
  return listRegistrations(tournament)
    .filter((reg) => serverIndex == null || reg.serverIndex === serverIndex)
    .map((reg) => ({
      id: reg.userId,
      userId: reg.userId,
      kills: reg.effectiveKills,
      effectiveKills: reg.effectiveKills,
      effectiveTier: reg.effectiveTier,
      killsSource: reg.killsSource,
      discordName: reg.discordName,
      robloxUsername: reg.robloxUsername,
      robloxUserId: reg.robloxUserId,
      robloxAvatarUrl: reg.robloxAvatarUrl,
      robloxProfileUrl: robloxProfileUrl(reg.robloxUserId),
      accountKind: reg.accountKind,
      seedNumber: reg.seedNumber,
      addedManually: reg.addedManually,
      isPhantom: reg.isPhantom,
    }));
}

function phantomCount(tournament) {
  return listRegistrations(tournament).filter((r) => r.isPhantom).length;
}

// Remove only the phantom (auto-fill) registrations, keep real players.
function removePhantomRegistrations(tournament) {
  const registrations = ensureRegistrations(tournament);
  let removed = 0;
  for (const id of Object.keys(registrations)) {
    if (registrations[id]?.isPhantom) {
      delete registrations[id];
      removed += 1;
    }
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Servers (per 16-player bracket)
// ---------------------------------------------------------------------------

function ensureServers(tournament) {
  if (!tournament.servers || typeof tournament.servers !== "object") tournament.servers = {};
  return tournament.servers;
}

function getServer(tournament, index) {
  const servers = ensureServers(tournament);
  return servers[String(index)] || null;
}

function ensureServer(tournament, index) {
  const servers = ensureServers(tournament);
  const key = String(nonNegativeInt(index, 0));
  if (!servers[key]) {
    servers[key] = {
      index: Number(key),
      launched: false,
      launchMessageId: "",
      threadId: "",
      stageNumber: 1,
      currentStage: null, // computed stage plan (from seeding)
      decisions: {}, // matchKey -> { winnerId, noShowIds }
      semifinalLosers: [],
      champion: null,
      placement: { first: null, second: null, third: null },
      done: false,
    };
  }
  return servers[key];
}

module.exports = {
  TOURNAMENT_STATE_VERSION,
  TOURNAMENT_STATUSES,
  ACCOUNT_KINDS,
  TWINK_THRESHOLD,
  ensureTournamentState,
  getDraft,
  setDraft,
  clearDraft,
  createTournamentFromDraft,
  getTournament,
  listTournaments,
  updateTournament,
  deleteTournament,
  buildPhantomRegistrations,
  isPhantomUserId,
  phantomCount,
  removePhantomRegistrations,
  resolveEffectiveKills,
  tierRepresentativeKills,
  canSelfDeclareTwink,
  robloxProfileUrl,
  killsSourceLabel,
  normalizeRegistration,
  upsertRegistration,
  removeRegistration,
  getRegistration,
  listRegistrations,
  registrationCount,
  isFull,
  tournamentPlayers,
  getServer,
  ensureServer,
  makeId,
  nowIso,
};
