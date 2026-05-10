"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  clearIntervalHandles,
  mergeRobloxRuntimeConfig,
  normalizeRobloxPanelSettingsPatch,
  rebuildRobloxIntervalHandles,
} = require("../src/runtime/roblox-runtime-support");

test("mergeRobloxRuntimeConfig lets persisted overrides win and merges nested links", () => {
  const baseConfig = {
    metadataRefreshEnabled: true,
    playtimePollMinutes: 15,
    links: {
      friendRequestsUrl: "https://base.example/friends",
      jjsGameUrl: "https://base.example/game",
    },
  };
  const overrides = {
    metadataRefreshEnabled: false,
    playtimePollMinutes: 3,
    links: {
      jjsGameUrl: "https://override.example/game",
    },
  };

  const result = mergeRobloxRuntimeConfig(baseConfig, overrides);

  assert.deepEqual(result, {
    metadataRefreshEnabled: false,
    playtimePollMinutes: 3,
    links: {
      friendRequestsUrl: "https://base.example/friends",
      jjsGameUrl: "https://override.example/game",
    },
  });
  assert.equal(baseConfig.metadataRefreshEnabled, true);
  assert.equal(baseConfig.links.jjsGameUrl, "https://base.example/game");
});

test("normalizeRobloxPanelSettingsPatch accepts supported fields and rejects invalid patches", () => {
  assert.deepEqual(normalizeRobloxPanelSettingsPatch({
    metadataRefreshEnabled: false,
    playtimeTrackingEnabled: true,
    runtimeFlushEnabled: true,
    playtimePollMinutes: 5,
  }), {
    metadataRefreshEnabled: false,
    playtimeTrackingEnabled: true,
    runtimeFlushEnabled: true,
    playtimePollMinutes: 5,
  });

  assert.throws(
    () => normalizeRobloxPanelSettingsPatch({ playtimePollMinutes: 0 }),
    /playtimePollMinutes must be a positive integer/
  );
  assert.throws(
    () => normalizeRobloxPanelSettingsPatch({ unknown: true }),
    /Roblox settings patch must include at least one supported field/
  );
});

test("clearIntervalHandles delegates every handle to clearIntervalFn", () => {
  const cleared = [];

  clearIntervalHandles(["timer-1", "timer-2"], (handle) => {
    cleared.push(handle);
  });

  assert.deepEqual(cleared, ["timer-1", "timer-2"]);
});

test("rebuildRobloxIntervalHandles clears old handles, reconfigures runtime, and schedules new jobs", () => {
  const cleared = [];
  const configured = [];
  const buildCalls = [];
  const scheduleCalls = [];

  const result = rebuildRobloxIntervalHandles({
    client: { id: "client" },
    currentHandles: ["old-1", "old-2"],
    clearIntervalFn: (handle) => {
      cleared.push(handle);
    },
    buildRobloxPeriodicJobs: (options) => {
      buildCalls.push(options);
      return [{ key: "roblox.playtimeSync", run() {}, intervalMs: 180000, errorLabel: "Roblox playtime sync failed" }];
    },
    schedulePeriodicJobs: (client, options) => {
      scheduleCalls.push({ client, options });
      return ["new-handle"];
    },
    configureSharedProfileRuntime: (value) => {
      configured.push(value);
    },
    runRobloxProfileRefreshJob: () => {},
    syncRobloxPlaytime: () => {},
    flushRobloxRuntime: () => {},
    robloxConfig: {
      playtimeTrackingEnabled: true,
      playtimePollMinutes: 3,
    },
    logError: () => {},
  });

  assert.deepEqual(cleared, ["old-1", "old-2"]);
  assert.deepEqual(configured, [{
    roblox: {
      playtimeTrackingEnabled: true,
      playtimePollMinutes: 3,
    },
  }]);
  assert.equal(buildCalls.length, 1);
  assert.deepEqual(buildCalls[0].roblox, {
    playtimeTrackingEnabled: true,
    playtimePollMinutes: 3,
  });
  assert.equal(scheduleCalls.length, 1);
  assert.deepEqual(result, ["new-handle"]);
});