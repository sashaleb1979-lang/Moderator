"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getActionableSotCharacterAlertState,
  runSotStartupAlerts,
  scheduleSotAlertTicks,
} = require("../src/sot/runtime-alerts");

test("getActionableSotCharacterAlertState suppresses zero-evidence unresolved entries", () => {
  const result = getActionableSotCharacterAlertState({
    unresolvedCount: 1,
    unresolvedEntries: [{ characterId: "aspiring_mangaka", evidenceCount: 0 }],
    attentionEntries: [{
      characterId: "aspiring_mangaka",
      status: "unresolved",
      evidenceCount: 0,
      line: "• Aspiring Mangaka: — [default; unresolved] — evidence 0; aliases Aspiring Mangaka, Чарльз, Шарль",
    }],
  }, { staleHours: 24 });

  assert.deepEqual(result, {
    issueParts: [],
    attentionLines: [],
  });
});

test("getActionableSotCharacterAlertState keeps actionable unresolved, ambiguous and stale issues", () => {
  const result = getActionableSotCharacterAlertState({
    ambiguousCount: 1,
    staleCount: 2,
    staleVerificationCount: 1,
    unresolvedEntries: [{ characterId: "vessel", evidenceCount: 3 }],
    attentionEntries: [
      { characterId: "vessel", status: "unresolved", evidenceCount: 3, line: "line unresolved" },
      { characterId: "honored_one", status: "stale", evidenceCount: 0, line: "line stale" },
    ],
  }, { staleHours: 24 });

  assert.deepEqual(result, {
    issueParts: ["unresolved=1", "ambiguous=1", "staleRole=2", "staleVerification>24h=1"],
    attentionLines: ["line unresolved", "line stale"],
  });
});

test("runSotStartupAlerts logs a character alert failure and still runs drift alert", async () => {
  const client = { id: "client" };
  const calls = [];
  const errors = [];

  await runSotStartupAlerts(client, {
    maybeLogSotCharacterHealthAlert: async (_client, reason) => {
      calls.push(["character", reason]);
      throw new Error("character boom");
    },
    maybeLogSotDriftAlert: async (_client, reason) => {
      calls.push(["drift", reason]);
    },
    logError: (...args) => errors.push(args.join(" ")),
  });

  assert.deepEqual(calls, [
    ["character", "startup"],
    ["drift", "startup"],
  ]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /SoT character startup alert failed:/);
  assert.match(errors[0], /character boom/);
});

test("scheduleSotAlertTicks registers character and drift periodic callbacks", async () => {
  const client = { id: "client" };
  const calls = [];
  const scheduled = [];

  const intervals = scheduleSotAlertTicks(client, {
    maybeLogSotCharacterHealthAlert: async (_client, reason) => {
      calls.push(["character", reason]);
    },
    maybeLogSotDriftAlert: async (_client, reason) => {
      calls.push(["drift", reason]);
    },
    characterPeriodicMs: 1000,
    driftPeriodicMs: 2000,
    setIntervalFn: (handler, intervalMs) => {
      scheduled.push({ handler, intervalMs });
      return `${intervalMs}`;
    },
  });

  assert.deepEqual(intervals, ["1000", "2000"]);
  assert.deepEqual(scheduled.map((entry) => entry.intervalMs), [1000, 2000]);

  await scheduled[0].handler();
  await scheduled[1].handler();

  assert.deepEqual(calls, [
    ["character", "periodic"],
    ["drift", "periodic"],
  ]);
});

test("scheduleSotAlertTicks logs periodic failures without throwing", async () => {
  const scheduled = [];
  const errors = [];

  scheduleSotAlertTicks({ id: "client" }, {
    maybeLogSotCharacterHealthAlert: async () => {
      throw new Error("character periodic boom");
    },
    maybeLogSotDriftAlert: async () => {
      throw new Error("drift periodic boom");
    },
    characterPeriodicMs: 1000,
    driftPeriodicMs: 1000,
    setIntervalFn: (handler, intervalMs) => {
      scheduled.push({ handler, intervalMs });
      return intervalMs;
    },
    logError: (...args) => errors.push(args.join(" ")),
  });

  await scheduled[0].handler();
  await scheduled[1].handler();

  assert.equal(errors.length, 2);
  assert.match(errors[0], /SoT character alert tick failed:/);
  assert.match(errors[0], /character periodic boom/);
  assert.match(errors[1], /SoT drift alert tick failed:/);
  assert.match(errors[1], /drift periodic boom/);
});