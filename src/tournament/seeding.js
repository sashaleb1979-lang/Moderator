"use strict";

// Tournament seeding / matchmaking engine.
//
// Pure functions, no Discord or DB dependencies — fully unit-testable. The
// operator/state layers own all mutable state and Discord I/O; this module only
// computes *who plays whom, where, and who advances*.
//
// Physical model (from the spec):
//  - A game server holds up to 16 players.
//  - Cells are numbered 1..8. Odd cells are RED, even cells are BLUE. An "arena"
//    couples two adjacent cells: (1,2) (3,4) (5,6) (7,8) → 4 arenas per server.
//  - A "run" is one pass through the 8 cells, i.e. up to 4 simultaneous FT6
//    matches. Stage 1 of a full 16-player server needs TWO runs (8 matches)
//    because there are only 8 cells; later stages fit in a single run.
//
// Progression for the canonical 16-player server (scales to any N):
//    Stage 1: 16 → 2 runs × 4 → 8 winners
//    Stage 2:  8 → 1 run  × 4 → 4 winners
//    Stage 3:  4 → semifinal (2 matches) → 2 winners + 2 losers
//    Stage 4:  final (winners → 1st/2nd) + bronze (semifinal losers → 3rd)
//
// Pairing modes (the admin chooses per-tournament):
//    "similar" — survivors sorted by kills and paired ADJACENTLY, so players of
//                comparable strength meet (the user's "максимально близко по килам").
//    "seed"    — standard 1-vs-N seeding, so the strongest meets the weakest and
//                top seeds only collide late.
// Both modes re-pair from the live survivor set each stage. That keeps the engine
// robust to byes, no-shows and non-power-of-two counts while preserving each
// mode's philosophy.

const MAX_PLAYERS_PER_SERVER = 16;
const CELLS_PER_SERVER = 8;
const MATCHES_PER_RUN = 4;

// arena index → its red (odd) and blue (even) cell numbers
const ARENA_CELLS = Object.freeze([
  Object.freeze({ red: 1, blue: 2 }),
  Object.freeze({ red: 3, blue: 4 }),
  Object.freeze({ red: 5, blue: 6 }),
  Object.freeze({ red: 7, blue: 8 }),
]);

const SEEDING_MODES = Object.freeze({ SIMILAR: "similar", SEED: "seed" });
const COLOR_RED = "red";
const COLOR_BLUE = "blue";

function normalizeMode(mode) {
  return mode === SEEDING_MODES.SEED ? SEEDING_MODES.SEED : SEEDING_MODES.SIMILAR;
}

function normalizeKills(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Math.floor(amount);
}

function playerId(player) {
  return String(player && player.id != null ? player.id : "");
}

// Stable seed order: most kills first; ties broken by id so the layout is
// deterministic for a given registration set (important for tests + idempotent
// panel re-renders).
function sortBySeed(players) {
  return players
    .map((player) => ({ ...player, kills: normalizeKills(player.kills) }))
    .sort((a, b) => {
      if (b.kills !== a.kills) return b.kills - a.kills;
      return playerId(a).localeCompare(playerId(b));
    });
}

// Assign each participant a global rank number (1 = strongest) for the roster /
// duel-formation table. Returns a new array sorted by seed.
function assignSeedNumbers(players) {
  return sortBySeed(players).map((player, index) => ({
    ...player,
    seedNumber: index + 1,
  }));
}

// Pair the current survivors. The odd player out (if any) receives a bye and is
// carried to the next stage; the top seed gets the bye, matching standard
// tournament practice (skipping a round is a reward, and it keeps the remaining
// field even).
//
// Returns { pairs: [[high, low], ...], bye: player|null }. In every pair element
// index 0 is the RED (higher-seed) side and index 1 is the BLUE side.
function pairPlayers(players, mode) {
  const normalizedMode = normalizeMode(mode);
  const seeded = sortBySeed(players);

  let bye = null;
  let pool = seeded;
  if (seeded.length % 2 === 1) {
    bye = seeded[0];
    pool = seeded.slice(1);
  }

  const pairs = [];
  if (normalizedMode === SEEDING_MODES.SEED) {
    // 1-vs-N: front seed against back seed.
    for (let i = 0; i < pool.length / 2; i += 1) {
      pairs.push([pool[i], pool[pool.length - 1 - i]]);
    }
  } else {
    // similar: adjacent seeds (closest kills) meet.
    for (let i = 0; i < pool.length; i += 2) {
      pairs.push([pool[i], pool[i + 1]]);
    }
  }
  return { pairs, bye };
}

// Distribute pairs into runs of up to 4 matches. Pairs are ordered strongest
// first; round-robin assignment spreads strong matches across runs instead of
// stacking them all in run 1.
function buildRuns(pairs) {
  const runCount = Math.max(1, Math.ceil(pairs.length / MATCHES_PER_RUN));
  const buckets = Array.from({ length: runCount }, () => []);
  pairs.forEach((pair, index) => {
    buckets[index % runCount].push(pair);
  });
  return buckets;
}

// Map a run's pairs onto arenas/cells. pair[0] → red (odd cell), pair[1] → blue.
function assignCellsToRun(runPairs, { stage, runIndex }) {
  return runPairs.map((pair, arenaIndex) => {
    const arena = ARENA_CELLS[arenaIndex];
    const [red, blue] = pair;
    return {
      key: `s${stage}-r${runIndex}-a${arenaIndex}`,
      stage,
      runIndex,
      arenaIndex,
      cellRed: arena.red,
      cellBlue: arena.blue,
      red: red ? { ...red, color: COLOR_RED, cell: arena.red } : null,
      blue: blue ? { ...blue, color: COLOR_BLUE, cell: arena.blue } : null,
    };
  });
}

// Build a regular (non-final) stage from the current survivor set.
// Returns { stage, mode, kind, runs: [{ runIndex, matches }], bye, isSemifinal }.
function buildStage(players, mode, stage) {
  const normalizedMode = normalizeMode(mode);
  const { pairs, bye } = pairPlayers(players, normalizedMode);
  const runBuckets = buildRuns(pairs);
  const runs = runBuckets.map((runPairs, runIndex) => ({
    runIndex,
    matches: assignCellsToRun(runPairs, { stage, runIndex }),
  }));
  return {
    stage,
    mode: normalizedMode,
    kind: "regular",
    isSemifinal: players.length === 4,
    runs,
    bye: bye || null,
  };
}

// Build the placement stage: the final (2 survivors → 1st/2nd) plus, when the
// previous round was a clean 4→2 semifinal, a bronze match between the two
// semifinal losers (→ 3rd). Returns a single-run stage with up to 2 matches.
function buildPlacementStage(finalists, semifinalLosers, mode, stage) {
  const normalizedMode = normalizeMode(mode);
  const matches = [];
  const seededFinalists = sortBySeed(finalists);
  if (seededFinalists.length >= 2) {
    const arena = ARENA_CELLS[0];
    matches.push({
      key: `s${stage}-r0-final`,
      stage,
      runIndex: 0,
      arenaIndex: 0,
      placement: "final",
      cellRed: arena.red,
      cellBlue: arena.blue,
      red: { ...seededFinalists[0], color: COLOR_RED, cell: arena.red },
      blue: { ...seededFinalists[1], color: COLOR_BLUE, cell: arena.blue },
    });
  }
  const seededLosers = sortBySeed(semifinalLosers || []);
  if (seededLosers.length >= 2) {
    const arena = ARENA_CELLS[1];
    matches.push({
      key: `s${stage}-r0-bronze`,
      stage,
      runIndex: 0,
      arenaIndex: 1,
      placement: "bronze",
      cellRed: arena.red,
      cellBlue: arena.blue,
      red: { ...seededLosers[0], color: COLOR_RED, cell: arena.red },
      blue: { ...seededLosers[1], color: COLOR_BLUE, cell: arena.blue },
    });
  }
  return {
    stage,
    mode: normalizedMode,
    kind: "placement",
    isSemifinal: false,
    runs: [{ runIndex: 0, matches }],
    bye: null,
  };
}

// Plan the next stage for a server given its current survivors. The caller passes
// the running stage number and the carried semifinal losers (for bronze).
//
// Returns one of:
//   { type: "complete", winner }                         — one player left
//   { type: "placement", stage: <stageState>, ... }      — final (+ bronze)
//   { type: "stage", stage: <stageState>, isSemifinal }  — regular round
function planNextStage({ survivors, mode, stageNumber, semifinalLosers = [] }) {
  const players = Array.isArray(survivors) ? survivors : [];
  if (players.length <= 1) {
    return { type: "complete", winner: players[0] || null };
  }
  if (players.length === 2) {
    return {
      type: "placement",
      stage: buildPlacementStage(players, semifinalLosers, mode, stageNumber),
    };
  }
  return {
    type: "stage",
    isSemifinal: players.length === 4,
    stage: buildStage(players, mode, stageNumber),
  };
}

// Flatten every match in a stage (across all runs) into one ordered list.
function listStageMatches(stage) {
  if (!stage || !Array.isArray(stage.runs)) return [];
  return stage.runs.flatMap((run) => (Array.isArray(run.matches) ? run.matches : []));
}

// Resolve a single match's effective winner from raw inputs. `winnerId` is the
// explicit "won" click; `noShowIds` are players marked "не пришёл". A no-show
// hands the win to the opponent; if both no-show the match is void (null).
function resolveMatchOutcome(match, { winnerId = null, noShowIds = [] } = {}) {
  const redId = match.red ? playerId(match.red) : null;
  const blueId = match.blue ? playerId(match.blue) : null;
  const noShow = new Set((noShowIds || []).map((id) => String(id)));

  const redNoShow = redId && noShow.has(redId);
  const blueNoShow = blueId && noShow.has(blueId);
  if (redNoShow && blueNoShow) return { winner: null, void: true };
  if (redNoShow) return { winner: match.blue || null, void: false, byNoShow: true };
  if (blueNoShow) return { winner: match.red || null, void: false, byNoShow: true };

  if (winnerId != null) {
    const id = String(winnerId);
    if (id === redId) return { winner: match.red, void: false };
    if (id === blueId) return { winner: match.blue, void: false };
  }
  return { winner: null, void: false }; // undecided
}

// Given a built stage and a decisions map { [matchKey]: { winnerId, noShowIds } },
// collect the players who advance. Includes the bye player automatically. Returns
// { winners, losers, undecided } where `losers` are the defeated players of this
// stage (used to seed the bronze match when a stage is the semifinal).
function resolveStageResults(stage, decisions = {}) {
  const winners = [];
  const losers = [];
  const undecided = [];

  for (const match of listStageMatches(stage)) {
    const decision = decisions[match.key] || {};
    const outcome = resolveMatchOutcome(match, decision);
    if (!outcome.winner) {
      if (!outcome.void) undecided.push(match.key);
      continue;
    }
    winners.push(outcome.winner);
    const winnerId = playerId(outcome.winner);
    for (const side of [match.red, match.blue]) {
      if (side && playerId(side) !== winnerId) losers.push(side);
    }
  }

  if (stage && stage.bye) winners.push(stage.bye);
  return { winners, losers, undecided };
}

// Convenience: is every match in the stage decided (or void)?
function isStageComplete(stage, decisions = {}) {
  return resolveStageResults(stage, decisions).undecided.length === 0;
}

// How many 16-cap servers a planned slot count needs (v3 multi-server).
function serverCountForSlots(slots) {
  const normalized = Math.max(1, normalizeKills(slots));
  return Math.max(1, Math.ceil(normalized / MAX_PLAYERS_PER_SERVER));
}

module.exports = {
  MAX_PLAYERS_PER_SERVER,
  CELLS_PER_SERVER,
  MATCHES_PER_RUN,
  ARENA_CELLS,
  SEEDING_MODES,
  COLOR_RED,
  COLOR_BLUE,
  normalizeMode,
  normalizeKills,
  sortBySeed,
  assignSeedNumbers,
  pairPlayers,
  buildRuns,
  assignCellsToRun,
  buildStage,
  buildPlacementStage,
  planNextStage,
  listStageMatches,
  resolveMatchOutcome,
  resolveStageResults,
  isStageComplete,
  serverCountForSlots,
};
