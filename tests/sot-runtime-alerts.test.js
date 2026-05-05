"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { runSotStartupAlerts, scheduleSotAlertTicks } = require("../src/sot/runtime-alerts");

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