"use strict";

function assertFunction(value, name) {
  if (typeof value !== "function") {
    throw new TypeError(`${name} must be a function`);
  }
}

function formatErrorText(error) {
  return error?.message || error;
}

async function runClientReadyCore(client, options = {}) {
  const {
    ensureManagedRoles,
    runSotStartupAlerts,
    registerGuildCommands,
    syncApprovedTierRoles,
    refreshWelcomePanel,
    refreshAllTierlists,
    logError = () => {},
  } = options;

  assertFunction(ensureManagedRoles, "ensureManagedRoles");
  assertFunction(runSotStartupAlerts, "runSotStartupAlerts");
  assertFunction(registerGuildCommands, "registerGuildCommands");
  assertFunction(syncApprovedTierRoles, "syncApprovedTierRoles");
  assertFunction(refreshWelcomePanel, "refreshWelcomePanel");
  assertFunction(refreshAllTierlists, "refreshAllTierlists");
  assertFunction(logError, "logError");

  const generated = await ensureManagedRoles(client);
  await runSotStartupAlerts(client);
  await registerGuildCommands(client);
  await Promise.resolve(syncApprovedTierRoles(client)).catch((error) => {
    logError("Tier role sync failed:", formatErrorText(error));
    return 0;
  });
  await Promise.resolve(refreshWelcomePanel(client)).catch((error) => {
    logError("Welcome panel refresh failed:", formatErrorText(error));
  });
  await refreshAllTierlists(client);
  return { generated };
}

function scheduleClientReadyIntervals(client, options = {}) {
  const {
    runAutoResendTick,
    autoResendTickMs,
    scheduleSotAlertTicks,
    getResolvedIntegrationSourcePath,
    refreshLegacyTierlistSummaryMessage,
    legacyTierlistSummaryRefreshMs,
    setIntervalFn = setInterval,
    logError = () => {},
  } = options;

  assertFunction(runAutoResendTick, "runAutoResendTick");
  assertFunction(scheduleSotAlertTicks, "scheduleSotAlertTicks");
  assertFunction(getResolvedIntegrationSourcePath, "getResolvedIntegrationSourcePath");
  assertFunction(refreshLegacyTierlistSummaryMessage, "refreshLegacyTierlistSummaryMessage");
  assertFunction(setIntervalFn, "setIntervalFn");
  assertFunction(logError, "logError");

  const intervalHandles = [];
  intervalHandles.push(setIntervalFn(() => {
    Promise.resolve(runAutoResendTick(client)).catch((error) => {
      logError("Auto-resend tick error:", formatErrorText(error));
    });
  }, autoResendTickMs));

  const alertHandles = scheduleSotAlertTicks(client);
  if (Array.isArray(alertHandles)) {
    intervalHandles.push(...alertHandles);
  }

  intervalHandles.push(setIntervalFn(() => {
    const tierlistSourcePath = getResolvedIntegrationSourcePath("tierlist");
    if (!tierlistSourcePath) return;

    Promise.resolve(refreshLegacyTierlistSummaryMessage(client)).catch((error) => {
      const text = String(error?.message || error || "").trim();
      if (text) logError("Legacy Tierlist summary refresh failed:", text);
    });
  }, legacyTierlistSummaryRefreshMs));

  return intervalHandles;
}

module.exports = {
  runClientReadyCore,
  scheduleClientReadyIntervals,
};