"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("welcome-bot wires username repair into scheduled Roblox playtime sync", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "welcome-bot.js"), "utf8");
  assert.match(
    source,
    /const syncRobloxPlaytime = [\s\S]*?runRobloxPlaytimeSyncJob\(\{[\s\S]*?fetchUserPresences:\s*robloxApiClient\.fetchUserPresences\.bind\(robloxApiClient\)/,
    "expected scheduled playtime sync to keep wiring Roblox presence polling"
  );
  assert.match(
    source,
    /fetchUserPresences:\s*robloxApiClient\.fetchUserPresences\.bind\(robloxApiClient\)/,
    /fetchUsersByUsernames:\s*robloxApiClient\.fetchUsersByUsernames\.bind\(robloxApiClient\)/,
    "expected scheduled playtime sync to wire username-based binding repair"
  );
});

test("welcome-bot serializes Roblox runtime flush through the shared db task runner", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "welcome-bot.js"), "utf8");
  assert.match(
    source,
    /const flushRobloxRuntime = [\s\S]*?runSerializedDbTask\(\(\) => flushRobloxRuntimeState\(\{[\s\S]*?saveDb,[\s\S]*?\}\),\s*"roblox-runtime-flush"\)/,
    "expected Roblox runtime flush wiring to use the shared serialized db task runner"
  );
  assert.match(
    source,
    /saveDb/,
    "expected serialized runtime flush wiring to preserve the existing saveDb persist path inside the queued task"
  );
});

test("welcome-bot wires fetchAccessUser into the profile operator for fresh server-tag reads", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "welcome-bot.js"), "utf8");
  assert.match(
    source,
    /function getProfileOperator\(\) \{[\s\S]*?profileOperator = createProfileOperator\(\{[\s\S]*?fetchAccessUser:\s*\(userId\) => client\.users\.fetch\(userId\),/,
    /fetchAccessUser:\s*\(userId\)\s*=>\s*client\.users\.fetch\(userId\)/,
    "expected profile operator wiring to refresh requester user identity separately from general profile fetches"
  );
});

test("welcome-bot calls applyRobloxAccountSnapshot only inside writeCanonicalRobloxBinding", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "welcome-bot.js"), "utf8");

  const functionStart = source.indexOf("function writeCanonicalRobloxBinding(");
  assert.notEqual(functionStart, -1, "expected writeCanonicalRobloxBinding to be defined");

  const nextFunctionStart = source.indexOf("\nfunction ", functionStart + 1);
  const canonicalFn = source.slice(functionStart, nextFunctionStart === -1 ? source.length : nextFunctionStart);

  // Count total calls to applyRobloxAccountSnapshot in the entire file
  const totalCalls = (source.match(/applyRobloxAccountSnapshot\s*\(/g) || []).length;

  // Count calls inside the canonical function body
  const callsInsideFn = (canonicalFn.match(/applyRobloxAccountSnapshot\s*\(/g) || []).length;

  assert.equal(
    totalCalls,
    callsInsideFn,
    "expected applyRobloxAccountSnapshot to be called only inside writeCanonicalRobloxBinding, not scattered elsewhere in welcome-bot.js"
  );
});