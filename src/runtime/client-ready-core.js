"use strict";

function assertFunction(value, name) {
  if (typeof value !== "function") {
    throw new TypeError(`${name} must be a function`);
  }
}

function formatErrorText(error) {
  return error?.message || error;
}

class ClientReadyCoreError extends Error {
  constructor(step, cause) {
    super(`Client ready step failed: ${step}: ${formatErrorText(cause)}`);
    this.name = "ClientReadyCoreError";
    this.step = String(step || "unknown").trim() || "unknown";
    this.cause = cause;
  }
}

function createEmptyGeneratedSummary() {
  return {
    characterRoles: 0,
    resolvedCharacters: 0,
    recoveredCharacters: 0,
    ambiguousCharacters: 0,
    unresolvedCharacters: 0,
    tierRoles: 0,
  };
}

function normalizeIntervalMs(value, fallbackMs) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallbackMs;
}

function buildClientReadyPeriodicJobs(options = {}) {
  const {
    runAutoResendTick,
    refreshLegacyTierlistSummaryMessage,
    runRobloxProfileRefreshJob,
    flushActivityRuntime,
    flushRobloxRuntime,
    syncRobloxPlaytime,
    getResolvedIntegrationSourcePath = null,
    rolePanelAutoResendTickMs = 0,
    legacyTierlistSummaryRefreshMs = 0,
    activityFlushIntervalMs = 0,
    roblox = {},
  } = options;

  assertFunction(runAutoResendTick, "runAutoResendTick");
  assertFunction(refreshLegacyTierlistSummaryMessage, "refreshLegacyTierlistSummaryMessage");
  if (runRobloxProfileRefreshJob != null) {
    assertFunction(runRobloxProfileRefreshJob, "runRobloxProfileRefreshJob");
  }
  if (flushActivityRuntime != null) {
    assertFunction(flushActivityRuntime, "flushActivityRuntime");
  }
  if (syncRobloxPlaytime != null) {
    assertFunction(syncRobloxPlaytime, "syncRobloxPlaytime");
  }
  if (flushRobloxRuntime != null) {
    assertFunction(flushRobloxRuntime, "flushRobloxRuntime");
  }
  if (getResolvedIntegrationSourcePath != null) {
    assertFunction(getResolvedIntegrationSourcePath, "getResolvedIntegrationSourcePath");
  }

  const periodicJobs = [
    {
      run: runAutoResendTick,
      intervalMs: normalizeIntervalMs(rolePanelAutoResendTickMs, 0),
      errorLabel: "Auto-resend tick error",
    },
    {
      run: async (client) => {
        if (typeof getResolvedIntegrationSourcePath === "function") {
          const tierlistSourcePath = getResolvedIntegrationSourcePath("tierlist");
          if (!tierlistSourcePath) return;
        }
        await refreshLegacyTierlistSummaryMessage(client);
      },
      intervalMs: normalizeIntervalMs(legacyTierlistSummaryRefreshMs, 0),
      errorLabel: "Legacy Tierlist summary refresh failed",
    },
  ];

  if (typeof flushActivityRuntime === "function") {
    periodicJobs.push({
      run: flushActivityRuntime,
      intervalMs: normalizeIntervalMs(activityFlushIntervalMs, 0),
      errorLabel: "Activity runtime flush failed",
    });
  }

  if (roblox?.metadataRefreshEnabled !== false && typeof runRobloxProfileRefreshJob === "function") {
    periodicJobs.push({
      run: runRobloxProfileRefreshJob,
      intervalMs: Math.max(1, Number(roblox?.metadataRefreshHours) || 24) * 60 * 60 * 1000,
      errorLabel: "Roblox metadata refresh failed",
    });
  }

  if (roblox?.playtimeTrackingEnabled !== false && typeof syncRobloxPlaytime === "function") {
    periodicJobs.push({
      run: syncRobloxPlaytime,
      intervalMs: Math.max(1, Number(roblox?.playtimePollMinutes) || 2) * 60 * 1000,
      errorLabel: "Roblox playtime sync failed",
    });
  }

  if (roblox?.playtimeTrackingEnabled !== false && roblox?.runtimeFlushEnabled !== false && typeof flushRobloxRuntime === "function") {
    periodicJobs.push({
      run: flushRobloxRuntime,
      intervalMs: Math.max(1, Number(roblox?.flushIntervalMinutes) || 10) * 60 * 1000,
      errorLabel: "Roblox runtime flush failed",
    });
  }

  return periodicJobs;
}

function normalizePeriodicJobs(periodicJobs = []) {
  if (!Array.isArray(periodicJobs)) {
    throw new TypeError("periodicJobs must be an array");
  }

  return periodicJobs
    .map((job, index) => {
      if (!job || typeof job !== "object") {
        throw new TypeError(`periodicJobs[${index}] must be an object`);
      }

      assertFunction(job.run, `periodicJobs[${index}].run`);
      return {
        run: job.run,
        intervalMs: Number(job.intervalMs),
        errorLabel: String(job.errorLabel || "Periodic job failed").trim() || "Periodic job failed",
      };
    })
    .filter((job) => Number.isFinite(job.intervalMs) && job.intervalMs > 0);
}

async function runClientReadyCore(client, options = {}) {
  const {
    ensureManagedRoles,
    runSotStartupAlerts,
    registerGuildCommands,
    syncApprovedTierRoles,
    refreshWelcomePanel,
    refreshAllTierlists,
    resumeActivityRuntime = null,
    logError = () => {},
  } = options;

  assertFunction(ensureManagedRoles, "ensureManagedRoles");
  assertFunction(runSotStartupAlerts, "runSotStartupAlerts");
  assertFunction(registerGuildCommands, "registerGuildCommands");
  assertFunction(syncApprovedTierRoles, "syncApprovedTierRoles");
  assertFunction(refreshWelcomePanel, "refreshWelcomePanel");
  assertFunction(refreshAllTierlists, "refreshAllTierlists");
  assertFunction(logError, "logError");
  if (resumeActivityRuntime != null) {
    assertFunction(resumeActivityRuntime, "resumeActivityRuntime");
  }

  await Promise.resolve(registerGuildCommands(client)).catch((error) => {
    throw new ClientReadyCoreError("registerGuildCommands", error);
  });

  const generated = await Promise.resolve(ensureManagedRoles(client)).catch((error) => {
    logError("Managed role ensure failed:", formatErrorText(error));
    return createEmptyGeneratedSummary();
  });

  await Promise.resolve(runSotStartupAlerts(client)).catch((error) => {
    logError("SoT startup alerts failed:", formatErrorText(error));
  });

  await Promise.resolve(syncApprovedTierRoles(client)).catch((error) => {
    logError("Tier role sync failed:", formatErrorText(error));
    return 0;
  });
  await Promise.resolve(refreshWelcomePanel(client)).catch((error) => {
    logError("Welcome panel refresh failed:", formatErrorText(error));
  });
  await Promise.resolve(refreshAllTierlists(client)).catch((error) => {
    logError("Tierlist refresh failed:", formatErrorText(error));
    return null;
  });
  if (typeof resumeActivityRuntime === "function") {
    await Promise.resolve(resumeActivityRuntime(client)).catch((error) => {
      logError("Activity runtime resume failed:", formatErrorText(error));
    });
  }
  return { generated };
}

function scheduleClientReadyIntervals(client, options = {}) {
  const {
    periodicJobs = [],
    scheduleSotAlertTicks,
    setIntervalFn = setInterval,
    logError = () => {},
  } = options;

  assertFunction(scheduleSotAlertTicks, "scheduleSotAlertTicks");
  assertFunction(setIntervalFn, "setIntervalFn");
  assertFunction(logError, "logError");
  const jobs = normalizePeriodicJobs(periodicJobs);

  const intervalHandles = [];

  const alertHandles = scheduleSotAlertTicks(client);
  if (Array.isArray(alertHandles)) {
    intervalHandles.push(...alertHandles);
  }

  for (const job of jobs) {
    intervalHandles.push(setIntervalFn(() => {
      Promise.resolve(job.run(client)).catch((error) => {
        logError(`${job.errorLabel}:`, formatErrorText(error));
      });
    }, job.intervalMs));
  }

  return intervalHandles;
}

module.exports = {
  buildClientReadyPeriodicJobs,
  ClientReadyCoreError,
  runClientReadyCore,
  scheduleClientReadyIntervals,
};