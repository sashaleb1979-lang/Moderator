"use strict";

function cloneJsonValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function mergeRobloxRuntimeConfig(baseConfig = {}, overrides = {}) {
  const base = cloneJsonValue(baseConfig || {}) || {};
  const nextOverrides = cloneJsonValue(overrides || {}) || {};

  return {
    ...base,
    ...nextOverrides,
    links: {
      ...(base.links || {}),
      ...(nextOverrides.links || {}),
    },
  };
}

function clearIntervalHandles(handles = [], clearIntervalFn = clearInterval) {
  if (typeof clearIntervalFn !== "function") {
    throw new TypeError("clearIntervalFn must be a function");
  }

  for (const handle of Array.isArray(handles) ? handles : []) {
    clearIntervalFn(handle);
  }
}

function normalizeRobloxPanelSettingsPatch(patch = {}) {
  const source = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
  const nextPatch = {};

  if (Object.prototype.hasOwnProperty.call(source, "metadataRefreshEnabled")) {
    nextPatch.metadataRefreshEnabled = source.metadataRefreshEnabled !== false;
  }
  if (Object.prototype.hasOwnProperty.call(source, "playtimeTrackingEnabled")) {
    nextPatch.playtimeTrackingEnabled = source.playtimeTrackingEnabled !== false;
  }
  if (Object.prototype.hasOwnProperty.call(source, "runtimeFlushEnabled")) {
    nextPatch.runtimeFlushEnabled = source.runtimeFlushEnabled !== false;
  }
  if (Object.prototype.hasOwnProperty.call(source, "playtimePollMinutes")) {
    const playtimePollMinutes = Number(source.playtimePollMinutes);
    if (!Number.isSafeInteger(playtimePollMinutes) || playtimePollMinutes < 1) {
      throw new TypeError("playtimePollMinutes must be a positive integer");
    }
    nextPatch.playtimePollMinutes = playtimePollMinutes;
  }

  if (!Object.keys(nextPatch).length) {
    throw new TypeError("Roblox settings patch must include at least one supported field");
  }

  return nextPatch;
}

function rebuildRobloxIntervalHandles({
  client,
  currentHandles = [],
  clearIntervalFn = clearInterval,
  buildRobloxPeriodicJobs,
  schedulePeriodicJobs,
  configureSharedProfileRuntime,
  runRobloxProfileRefreshJob,
  syncRobloxPlaytime,
  flushRobloxRuntime,
  robloxConfig = {},
  logError = () => {},
} = {}) {
  if (typeof buildRobloxPeriodicJobs !== "function") {
    throw new TypeError("buildRobloxPeriodicJobs must be a function");
  }
  if (typeof schedulePeriodicJobs !== "function") {
    throw new TypeError("schedulePeriodicJobs must be a function");
  }
  if (typeof configureSharedProfileRuntime !== "function") {
    throw new TypeError("configureSharedProfileRuntime must be a function");
  }
  if (typeof logError !== "function") {
    throw new TypeError("logError must be a function");
  }

  configureSharedProfileRuntime({ roblox: robloxConfig });
  clearIntervalHandles(currentHandles, clearIntervalFn);

  return schedulePeriodicJobs(client, {
    periodicJobs: buildRobloxPeriodicJobs({
      runRobloxProfileRefreshJob,
      syncRobloxPlaytime,
      flushRobloxRuntime,
      roblox: robloxConfig,
    }),
    logError,
  });
}

module.exports = {
  clearIntervalHandles,
  mergeRobloxRuntimeConfig,
  normalizeRobloxPanelSettingsPatch,
  rebuildRobloxIntervalHandles,
};