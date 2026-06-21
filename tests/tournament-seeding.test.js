"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SEEDING_MODES,
  sortBySeed,
  assignSeedNumbers,
  pairPlayers,
  buildRuns,
  buildStage,
  planNextStage,
  listStageMatches,
  resolveMatchOutcome,
  resolveStageResults,
  isStageComplete,
  serverCountForSlots,
} = require("../src/tournament/seeding");

function players(...kills) {
  // p1..pN with the given kill counts (index order = id order)
  return kills.map((k, i) => ({ id: `p${i + 1}`, kills: k }));
}

function ids(list) {
  return list.map((p) => p.id);
}

test("sortBySeed orders by kills desc with deterministic id tiebreak", () => {
  const sorted = sortBySeed([
    { id: "b", kills: 100 },
    { id: "a", kills: 100 },
    { id: "c", kills: 500 },
  ]);
  assert.deepEqual(ids(sorted), ["c", "a", "b"]);
});

test("assignSeedNumbers ranks strongest as 1", () => {
  const seeded = assignSeedNumbers(players(300, 900, 50));
  assert.deepEqual(
    seeded.map((p) => [p.id, p.seedNumber]),
    [["p2", 1], ["p1", 2], ["p3", 3]]
  );
});

test("similar mode pairs adjacent kills", () => {
  const { pairs, bye } = pairPlayers(players(1000, 900, 400, 350), SEEDING_MODES.SIMILAR);
  assert.equal(bye, null);
  assert.deepEqual(
    pairs.map((pair) => ids(pair)),
    [["p1", "p2"], ["p3", "p4"]]
  );
});

test("seed mode pairs strongest vs weakest (1-vs-N)", () => {
  const { pairs } = pairPlayers(players(1000, 900, 400, 350), SEEDING_MODES.SEED);
  assert.deepEqual(
    pairs.map((pair) => ids(pair)),
    [["p1", "p4"], ["p2", "p3"]]
  );
});

test("odd field gives the top seed a bye in both modes", () => {
  for (const mode of [SEEDING_MODES.SIMILAR, SEEDING_MODES.SEED]) {
    const { pairs, bye } = pairPlayers(players(900, 700, 500), mode);
    assert.equal(bye.id, "p1", `bye should be top seed in ${mode}`);
    assert.deepEqual(pairs.map((pair) => ids(pair)), [["p2", "p3"]]);
  }
});

test("16-player stage 1 builds two runs of four matches with red=odd cells", () => {
  const field = players(
    1600, 1500, 1400, 1300, 1200, 1100, 1000, 900,
    800, 700, 600, 500, 400, 300, 200, 100
  );
  const stage = buildStage(field, SEEDING_MODES.SIMILAR, 1);
  assert.equal(stage.runs.length, 2);
  assert.equal(stage.runs[0].matches.length, 4);
  assert.equal(stage.runs[1].matches.length, 4);
  assert.equal(listStageMatches(stage).length, 8);

  for (const match of listStageMatches(stage)) {
    assert.equal(match.cellRed % 2, 1, "red cell is odd");
    assert.equal(match.cellBlue % 2, 0, "blue cell is even");
    assert.equal(match.cellBlue, match.cellRed + 1, "arena couples adjacent cells");
    assert.equal(match.red.color, "red");
    assert.equal(match.blue.color, "blue");
    assert.ok(match.red.kills >= match.blue.kills, "higher seed takes red");
  }
});

test("buildRuns never exceeds four matches per run and spreads strength", () => {
  const eightPairs = Array.from({ length: 8 }, (_, i) => [{ id: `a${i}` }, { id: `b${i}` }]);
  const runs = buildRuns(eightPairs);
  assert.equal(runs.length, 2);
  assert.equal(runs[0].length, 4);
  assert.equal(runs[1].length, 4);
  // strongest pair (index 0) and second (index 1) land in different runs
  assert.equal(runs[0][0][0].id, "a0");
  assert.equal(runs[1][0][0].id, "a1");
});

test("full 16-player progression resolves to a single winner (similar mode)", () => {
  // Deterministic rule: the higher-kills (red) side always wins, so the top seed
  // must emerge as champion after every stage.
  let survivors = players(
    1600, 1500, 1400, 1300, 1200, 1100, 1000, 900,
    800, 700, 600, 500, 400, 300, 200, 100
  );
  let semifinalLosers = [];
  let stageNumber = 1;
  const stageSizes = [];

  for (let guard = 0; guard < 10; guard += 1) {
    const plan = planNextStage({ survivors, mode: SEEDING_MODES.SIMILAR, stageNumber, semifinalLosers });
    if (plan.type === "complete") {
      assert.equal(plan.winner.id, "p1", "top seed wins the whole thing");
      break;
    }

    const wasSemifinal = plan.type === "stage" && plan.isSemifinal;
    const decisions = {};
    for (const match of listStageMatches(plan.stage)) {
      // red is the higher seed by construction
      decisions[match.key] = { winnerId: match.red.id };
    }
    const result = resolveStageResults(plan.stage, decisions);
    assert.ok(isStageComplete(plan.stage, decisions));

    if (plan.type === "placement") {
      // final winner is champion; nothing carries forward
      survivors = [result.winners.find((w) => w.id === "p1")];
      stageSizes.push("placement");
      stageNumber += 1;
      continue;
    }

    stageSizes.push(result.winners.length);
    if (wasSemifinal) semifinalLosers = result.losers;
    survivors = result.winners;
    stageNumber += 1;
  }

  // 16 → 8 → 4 → 2(placement) → champion
  assert.deepEqual(stageSizes, [8, 4, 2, "placement"]);
});

test("placement stage emits a final and a bronze match from semifinal losers", () => {
  const finalists = players(1500, 1400); // p1, p2
  const semiLosers = players(900, 800).map((p, i) => ({ ...p, id: `loser${i + 1}` }));
  const plan = planNextStage({
    survivors: finalists,
    mode: SEEDING_MODES.SEED,
    stageNumber: 4,
    semifinalLosers: semiLosers,
  });
  assert.equal(plan.type, "placement");
  const matches = listStageMatches(plan.stage);
  assert.equal(matches.length, 2);
  assert.equal(matches[0].placement, "final");
  assert.equal(matches[1].placement, "bronze");
  assert.deepEqual(ids([matches[1].red, matches[1].blue]).sort(), ["loser1", "loser2"]);
});

test("no-show hands the win to the opponent; double no-show voids the match", () => {
  const stage = buildStage(players(900, 800, 700, 600), SEEDING_MODES.SIMILAR, 2);
  const match = listStageMatches(stage)[0];

  const opponentWins = resolveMatchOutcome(match, { noShowIds: [match.red.id] });
  assert.equal(opponentWins.winner.id, match.blue.id);
  assert.equal(opponentWins.byNoShow, true);

  const voided = resolveMatchOutcome(match, { noShowIds: [match.red.id, match.blue.id] });
  assert.equal(voided.winner, null);
  assert.equal(voided.void, true);

  const undecided = resolveMatchOutcome(match, {});
  assert.equal(undecided.winner, null);
});

test("byes carry through to winners for assorted field sizes", () => {
  for (const n of [3, 5, 7, 13]) {
    const field = players(...Array.from({ length: n }, (_, i) => (n - i) * 100));
    const stage = buildStage(field, SEEDING_MODES.SEED, 1);
    const matchCount = listStageMatches(stage).length;
    assert.equal(matchCount, Math.floor(n / 2), `n=${n} produces floor(n/2) matches`);
    assert.equal(Boolean(stage.bye), n % 2 === 1, `n=${n} has a bye iff odd`);

    // decide every match for the red side; winners = match winners + bye
    const decisions = {};
    for (const match of listStageMatches(stage)) decisions[match.key] = { winnerId: match.red.id };
    const { winners } = resolveStageResults(stage, decisions);
    assert.equal(winners.length, Math.ceil(n / 2), `n=${n} advances ceil(n/2)`);
    if (n % 2 === 1) {
      assert.ok(winners.some((w) => w.id === stage.bye.id), "bye player advances");
    }
  }
});

test("serverCountForSlots buckets players into 16-cap servers", () => {
  assert.equal(serverCountForSlots(16), 1);
  assert.equal(serverCountForSlots(17), 2);
  assert.equal(serverCountForSlots(32), 2);
  assert.equal(serverCountForSlots(33), 3);
  assert.equal(serverCountForSlots(0), 1);
});
