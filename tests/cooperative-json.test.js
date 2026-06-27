"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { stringifyCooperative } = require("../src/runtime/cooperative-json");

async function coop(value, options) {
  return (await stringifyCooperative(value, options)).json;
}

test("cooperative JSON matches JSON.stringify across value shapes", async () => {
  const cases = [
    null,
    true,
    false,
    0,
    -0,
    42,
    -17.25,
    1e21,
    NaN, // -> null
    Infinity, // -> null
    -Infinity, // -> null
    "",
    "plain",
    "spec\"ial\\\n\t chars 🙂 ёжик",
    [],
    {},
    [1, 2, 3],
    [undefined, null, () => {}, Symbol("s")], // -> [null,null,null,null]
    { a: 1, b: "two", c: null, d: true },
    { skip: undefined, fn: () => {}, sym: Symbol("x"), keep: 1 }, // undefined/fn/sym keys dropped
    { nested: { deep: { deeper: [1, { x: 2 }] } } },
    { date: new Date("2026-06-27T06:14:56.627Z") },
    { toJSON: () => ({ replaced: true }) },
    { "needs\"escape": "v", "юникод": [1, 2] },
    { order: 1, b: 2, a: 3, "0": 4 }, // numeric-ish key ordering quirk of JS objects
    [{ a: [{ b: [] }] }, "tail"],
  ];

  for (const value of cases) {
    assert.equal(await coop(value), JSON.stringify(value), `mismatch for ${JSON.stringify(value)}`);
  }
});

test("cooperative JSON matches for a large high-fanout map (exercises the atomic-child path)", async () => {
  const big = { profiles: {}, submissions: {}, meta: { count: 5000 } };
  for (let i = 0; i < 5000; i += 1) {
    big.profiles[`u${i}`] = {
      id: `u${i}`,
      name: `Player ${i}`,
      kills: i * 7,
      nested: { history: [i, i + 1, i + 2], flags: { a: i % 2 === 0, b: null } },
      maybe: i % 3 === 0 ? undefined : `v${i}`,
    };
  }
  for (let i = 0; i < 1200; i += 1) {
    big.submissions[`s${i}`] = { id: `s${i}`, status: i % 2 ? "approved" : "pending", tags: ["x", "y"] };
  }
  // small sliceMs forces many yields, stressing the chunk boundaries
  assert.equal(await coop(big, { sliceMs: 1 }), JSON.stringify(big));
});

test("cooperative JSON matches for a low-fanout but deep/large subtree", async () => {
  // mimics sot.activity: low fanout at the top, one big map deeper down
  const activity = { config: { season: 3 }, users: {} };
  for (let i = 0; i < 4000; i += 1) {
    activity.users[`a${i}`] = { voice: i, msgs: i * 2, last: { day: "2026-06-27", n: i } };
  }
  const db = { sot: { activity, antiteam: { tickets: { t1: { open: true } } } }, cooldowns: {} };
  assert.equal(await coop(db, { sliceMs: 1 }), JSON.stringify(db));
});

test("cooperative serialize actually yields the event loop (does not block)", async () => {
  // Build a structure big enough that a single JSON.stringify would take a while,
  // then prove a concurrently-scheduled timer gets to run DURING serialization —
  // i.e. the loop was not monopolized.
  const big = { rows: {} };
  for (let i = 0; i < 60000; i += 1) {
    big.rows[`r${i}`] = { i, s: `row-${i}-payload-padding-padding`, arr: [i, i + 1, i + 2, i + 3] };
  }

  let timerFired = false;
  const timer = setInterval(() => { timerFired = true; }, 1);

  const { json, maxSliceMs } = await stringifyCooperative(big, { sliceMs: 4 });
  clearInterval(timer);

  assert.equal(json, JSON.stringify(big), "output still byte-identical under chunking");
  assert.ok(timerFired, "a 1ms interval fired during serialization → loop stayed responsive");
  // No single synchronous slice should approach the multi-second freeze we are fixing.
  assert.ok(maxSliceMs < 250, `max synchronous slice ${maxSliceMs.toFixed(1)}ms stayed small`);
});

test("root undefined mirrors JSON.stringify(undefined)", async () => {
  const { json } = await stringifyCooperative(undefined);
  assert.equal(json, undefined);
  assert.equal(json, JSON.stringify(undefined));
});
