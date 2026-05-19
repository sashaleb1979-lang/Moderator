"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("welcome-bot wires username repair into scheduled Roblox playtime sync", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "welcome-bot.js"), "utf8");
  const match = source.match(
    /const syncRobloxPlaytime = [\s\S]*?runRobloxPlaytimeSyncJob\(\{([\s\S]*?)\}\)\)\);/
  );

  assert.ok(match, "expected to find the scheduled syncRobloxPlaytime wiring block");
  assert.match(
    match[1],
    /fetchUserPresences:\s*robloxApiClient\.fetchUserPresences\.bind\(robloxApiClient\)/,
    "expected scheduled playtime sync to keep wiring Roblox presence polling"
  );
  assert.match(
    match[1],
    /fetchUsersByUsernames:\s*robloxApiClient\.fetchUsersByUsernames\.bind\(robloxApiClient\)/,
    "expected scheduled playtime sync to wire username-based binding repair"
  );
});

test("welcome-bot serializes Roblox runtime flush through the shared db task runner", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "welcome-bot.js"), "utf8");
  const match = source.match(
    /const flushRobloxRuntime = [\s\S]*?runSerializedDbTask\(\(\) => flushRobloxRuntimeState\(\{([\s\S]*?)\}\),\s*"roblox-runtime-flush"\)\)\);/
  );

  assert.ok(match, "expected Roblox runtime flush wiring to use the shared serialized db task runner");
  assert.match(
    match[1],
    /saveDb/,
    "expected serialized runtime flush wiring to preserve the existing saveDb persist path inside the queued task"
  );
});