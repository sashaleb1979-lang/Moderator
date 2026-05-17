"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildRobloxPeriodicJobs,
  buildClientReadyPeriodicJobs,
  ClientReadyCoreError,
  runClientReadyCore,
  scheduleClientReadyIntervals,
  schedulePeriodicJobs,
} = require("../src/runtime/client-ready-core");

test("buildRobloxPeriodicJobs restores the Roblox-only descriptor set for welcome-bot rescheduling", () => {
  const jobs = buildRobloxPeriodicJobs({
    runRobloxProfileRefreshJob() {},
    syncRobloxPlaytime() {},
    flushRobloxRuntime() {},
    roblox: {
      metadataRefreshEnabled: true,
      metadataRefreshHours: 6,
      playtimeTrackingEnabled: true,
      playtimePollMinutes: 15,
      runtimeFlushEnabled: true,
      flushIntervalMinutes: 11,
    },
  });

  assert.deepEqual(jobs.map((job) => job.key), [
    "roblox.metadataRefresh",
    "roblox.playtimeSync",
    "roblox.runtimeFlush",
  ]);
  assert.deepEqual(jobs.map((job) => job.errorLabel), [
    "Roblox metadata refresh failed",
    "Roblox playtime sync failed",
    "Roblox runtime flush failed",
  ]);
  assert.deepEqual(jobs.map((job) => job.intervalMs), [21600000, 900000, 660000]);
});

test("schedulePeriodicJobs schedules normalized jobs without startup alert wiring", async () => {
  const handles = [];
  const calls = [];

  const result = schedulePeriodicJobs({ id: "client" }, {
    periodicJobs: [{
      key: "roblox.playtimeSync",
      run(client) {
        calls.push(client);
      },
      intervalMs: 1234,
      errorLabel: "Roblox playtime sync failed",
    }],
    setIntervalFn(callback, intervalMs) {
      handles.push(intervalMs);
      callback();
      return `handle-${intervalMs}`;
    },
  });

  assert.deepEqual(handles, [1234]);
  assert.deepEqual(calls, [{ id: "client" }]);
  assert.deepEqual(result, ["handle-1234"]);
});

test("buildClientReadyPeriodicJobs owns interval defaults and feature gating for periodic startup jobs", async () => {
  const calls = [];
  const periodicJobs = buildClientReadyPeriodicJobs({
    runAutoResendTick(client) {
      calls.push(["runAutoResendTick", client]);
    },
    async refreshLegacyTierlistSummaryMessage(client) {
      calls.push(["refreshLegacyTierlistSummaryMessage", client]);
    },
    runRobloxProfileRefreshJob(client) {
      calls.push(["runRobloxProfileRefreshJob", client]);
    },
    flushActivityRuntime(client) {
      calls.push(["flushActivityRuntime", client]);
    },
    runDailyActivityRoleSync(client) {
      calls.push(["runDailyActivityRoleSync", client]);
    },
    runVerificationDeadlineSweep(client) {
      calls.push(["runVerificationDeadlineSweep", client]);
    },
    syncRobloxPlaytime(client) {
      calls.push(["syncRobloxPlaytime", client]);
    },
    flushRobloxRuntime(client) {
      calls.push(["flushRobloxRuntime", client]);
    },
    getResolvedIntegrationSourcePath(slot) {
      calls.push(["getResolvedIntegrationSourcePath", slot]);
      return slot === "tierlist" ? "tierlist/state.json" : "";
    },
    rolePanelAutoResendTickMs: 100,
    legacyTierlistSummaryRefreshMs: 200,
    activityFlushIntervalMs: 300,
    activityRoleSyncHours: 24,
    verification: {
      enabled: true,
      reportSweepMinutes: 45,
    },
    roblox: {
      metadataRefreshEnabled: true,
      metadataRefreshHours: 6,
      playtimeTrackingEnabled: true,
      playtimePollMinutes: 15,
      flushIntervalMinutes: 11,
    },
  });

  assert.deepEqual(periodicJobs.map((job) => job.errorLabel), [
    "Auto-resend tick error",
    "Legacy Tierlist summary refresh failed",
    "Activity runtime flush failed",
    "Activity daily role sync failed",
    "Verification deadline sweep failed",
    "Roblox metadata refresh failed",
    "Roblox playtime sync failed",
    "Roblox runtime flush failed",
  ]);
  assert.deepEqual(periodicJobs.map((job) => job.intervalMs), [100, 200, 300, 86400000, 2700000, 21600000, 900000, 660000]);

  await periodicJobs[1].run({ id: "client" });
  assert.deepEqual(calls, [
    ["getResolvedIntegrationSourcePath", "tierlist"],
    ["refreshLegacyTierlistSummaryMessage", { id: "client" }],
  ]);
});

test("buildClientReadyPeriodicJobs skips disabled Roblox jobs and no-op tierlist summary refresh when source path is missing", async () => {
  const calls = [];
  const periodicJobs = buildClientReadyPeriodicJobs({
    runAutoResendTick(client) {
      calls.push(["runAutoResendTick", client]);
    },
    async refreshLegacyTierlistSummaryMessage(client) {
      calls.push(["refreshLegacyTierlistSummaryMessage", client]);
    },
    flushActivityRuntime(client) {
      calls.push(["flushActivityRuntime", client]);
    },
    runDailyActivityRoleSync(client) {
      calls.push(["runDailyActivityRoleSync", client]);
    },
    getResolvedIntegrationSourcePath(slot) {
      calls.push(["getResolvedIntegrationSourcePath", slot]);
      return "";
    },
    rolePanelAutoResendTickMs: 100,
    legacyTierlistSummaryRefreshMs: 200,
    activityFlushIntervalMs: 300,
    activityRoleSyncHours: 24,
    roblox: {
      metadataRefreshEnabled: false,
      playtimeTrackingEnabled: false,
    },
  });

  assert.deepEqual(periodicJobs.map((job) => job.errorLabel), [
    "Auto-resend tick error",
    "Legacy Tierlist summary refresh failed",
    "Activity runtime flush failed",
    "Activity daily role sync failed",
  ]);

  await periodicJobs[1].run({ id: "client" });
  assert.deepEqual(calls, [["getResolvedIntegrationSourcePath", "tierlist"]]);
});

test("buildClientReadyPeriodicJobs does not require an activity flush callback to build descriptor jobs", () => {
  const periodicJobs = buildClientReadyPeriodicJobs({
    runAutoResendTick() {},
    async refreshLegacyTierlistSummaryMessage() {},
    rolePanelAutoResendTickMs: 100,
    legacyTierlistSummaryRefreshMs: 200,
  });

  assert.deepEqual(periodicJobs.map((job) => job.errorLabel), [
    "Auto-resend tick error",
    "Legacy Tierlist summary refresh failed",
  ]);
});

test("buildClientReadyPeriodicJobs schedules daily activity rebuild and role sync when configured", () => {
  const periodicJobs = buildClientReadyPeriodicJobs({
    runAutoResendTick() {},
    async refreshLegacyTierlistSummaryMessage() {},
    runDailyActivityRoleSync() {},
    activityRoleSyncHours: 12,
    now: "2026-05-16T12:00:00.000Z",
  });

  const activityRoleSyncJob = periodicJobs.find((job) => job.errorLabel === "Activity daily role sync failed");
  assert.deepEqual(activityRoleSyncJob, {
    run: activityRoleSyncJob.run,
    intervalMs: 43200000,
    initialDelayMs: 0,
    errorLabel: "Activity daily role sync failed",
  });
});

test("buildClientReadyPeriodicJobs preserves daily activity sync cadence across restart using the last successful run time", () => {
  const periodicJobs = buildClientReadyPeriodicJobs({
    runAutoResendTick() {},
    async refreshLegacyTierlistSummaryMessage() {},
    runDailyActivityRoleSync() {},
    activityRoleSyncHours: 24,
    getActivityRoleSyncLastRunAt() {
      return "2026-05-15T18:00:00.000Z";
    },
    now: "2026-05-16T12:00:00.000Z",
  });

  const activityRoleSyncJob = periodicJobs.find((job) => job.errorLabel === "Activity daily role sync failed");
  assert.equal(activityRoleSyncJob.intervalMs, 86400000);
  assert.equal(activityRoleSyncJob.initialDelayMs, 21600000);
});

test("buildClientReadyPeriodicJobs catches up daily activity sync immediately after an overdue restart", () => {
  const periodicJobs = buildClientReadyPeriodicJobs({
    runAutoResendTick() {},
    async refreshLegacyTierlistSummaryMessage() {},
    runDailyActivityRoleSync() {},
    activityRoleSyncHours: 24,
    getActivityRoleSyncLastRunAt() {
      return "2026-05-14T09:00:00.000Z";
    },
    now: "2026-05-16T12:00:00.000Z",
  });

  const activityRoleSyncJob = periodicJobs.find((job) => job.errorLabel === "Activity daily role sync failed");
  assert.equal(activityRoleSyncJob.intervalMs, 86400000);
  assert.equal(activityRoleSyncJob.initialDelayMs, 0);
});

test("buildClientReadyPeriodicJobs applies Roblox default poll and flush cadences when callbacks are provided", () => {
  const periodicJobs = buildClientReadyPeriodicJobs({
    runAutoResendTick() {},
    async refreshLegacyTierlistSummaryMessage() {},
    flushActivityRuntime() {},
    runRobloxProfileRefreshJob() {},
    syncRobloxPlaytime() {},
    flushRobloxRuntime() {},
    roblox: {
      metadataRefreshEnabled: true,
      playtimeTrackingEnabled: true,
    },
  });

  const robloxJobs = periodicJobs.slice(-3);
  assert.deepEqual(robloxJobs.map((job) => job.errorLabel), [
    "Roblox metadata refresh failed",
    "Roblox playtime sync failed",
    "Roblox runtime flush failed",
  ]);
  assert.deepEqual(robloxJobs.map((job) => job.intervalMs), [86400000, 120000, 600000]);
});

test("buildClientReadyPeriodicJobs adds verification deadline sweep only when verification is enabled", () => {
  const periodicJobs = buildClientReadyPeriodicJobs({
    runAutoResendTick() {},
    async refreshLegacyTierlistSummaryMessage() {},
    runVerificationDeadlineSweep() {},
    verification: {
      enabled: true,
      reportSweepMinutes: 30,
    },
  });

  assert.equal(periodicJobs.some((job) => job.errorLabel === "Verification deadline sweep failed"), true);
  assert.equal(periodicJobs.find((job) => job.errorLabel === "Verification deadline sweep failed").intervalMs, 1800000);
});

test("runClientReadyCore preserves startup order for the core prelude", async () => {
  const calls = [];
  const client = { id: "client" };

  const result = await runClientReadyCore(client, {
    async registerGuildCommands(currentClient) {
      calls.push(["registerGuildCommands", currentClient]);
    },
    async ensureManagedRoles(currentClient) {
      calls.push(["ensureManagedRoles", currentClient]);
      return { resolvedCharacters: 3 };
    },
    async runSotStartupAlerts(currentClient) {
      calls.push(["runSotStartupAlerts", currentClient]);
    },
    async syncApprovedTierRoles(currentClient) {
      calls.push(["syncApprovedTierRoles", currentClient]);
      return 0;
    },
    async refreshWelcomePanel(currentClient) {
      calls.push(["refreshWelcomePanel", currentClient]);
    },
    async refreshAllTierlists(currentClient) {
      calls.push(["refreshAllTierlists", currentClient]);
    },
  });

  assert.deepEqual(calls, [
    ["registerGuildCommands", client],
    ["ensureManagedRoles", client],
    ["runSotStartupAlerts", client],
    ["syncApprovedTierRoles", client],
    ["refreshWelcomePanel", client],
    ["refreshAllTierlists", client],
  ]);
  assert.deepEqual(result, { generated: { resolvedCharacters: 3 } });
});

test("runClientReadyCore throws a critical error when guild command registration fails", async () => {
  await assert.rejects(
    runClientReadyCore({ id: "client" }, {
      async registerGuildCommands() {
        throw new Error("missing applications.commands scope");
      },
      async ensureManagedRoles() {
        throw new Error("should not run");
      },
      async runSotStartupAlerts() {},
      async syncApprovedTierRoles() {},
      async refreshWelcomePanel() {},
      async refreshAllTierlists() {},
    }),
    (error) => {
      assert.equal(error instanceof ClientReadyCoreError, true);
      assert.equal(error.step, "registerGuildCommands");
      assert.match(error.message, /missing applications\.commands scope/);
      return true;
    }
  );
});

test("runClientReadyCore logs ensureManagedRoles failures and still registers startup surfaces", async () => {
  const calls = [];
  const errors = [];

  const result = await runClientReadyCore({ id: "client" }, {
    async registerGuildCommands() {
      calls.push("registerGuildCommands");
    },
    async ensureManagedRoles() {
      calls.push("ensureManagedRoles");
      throw new Error("role create failed");
    },
    async runSotStartupAlerts() {
      calls.push("runSotStartupAlerts");
    },
    async syncApprovedTierRoles() {
      calls.push("syncApprovedTierRoles");
    },
    async refreshWelcomePanel() {
      calls.push("refreshWelcomePanel");
    },
    async refreshAllTierlists() {
      calls.push("refreshAllTierlists");
    },
    logError: (...args) => errors.push(args.join(" ")),
  });

  assert.deepEqual(calls, [
    "registerGuildCommands",
    "ensureManagedRoles",
    "runSotStartupAlerts",
    "syncApprovedTierRoles",
    "refreshWelcomePanel",
    "refreshAllTierlists",
  ]);
  assert.deepEqual(errors, ["Managed role ensure failed: role create failed"]);
  assert.deepEqual(result, {
    generated: {
      characterRoles: 0,
      resolvedCharacters: 0,
      recoveredCharacters: 0,
      ambiguousCharacters: 0,
      unresolvedCharacters: 0,
      tierRoles: 0,
    },
  });
});

test("runClientReadyCore logs syncApprovedTierRoles failures and continues", async () => {
  const calls = [];
  const errors = [];

  await runClientReadyCore({ id: "client" }, {
    async registerGuildCommands() {
      calls.push("registerGuildCommands");
    },
    async ensureManagedRoles() {
      calls.push("ensureManagedRoles");
      return {};
    },
    async runSotStartupAlerts() {
      calls.push("runSotStartupAlerts");
    },
    async syncApprovedTierRoles() {
      calls.push("syncApprovedTierRoles");
      throw new Error("tier sync failed");
    },
    async refreshWelcomePanel() {
      calls.push("refreshWelcomePanel");
    },
    async refreshAllTierlists() {
      calls.push("refreshAllTierlists");
    },
    logError: (...args) => errors.push(args.join(" ")),
  });

  assert.deepEqual(calls, [
    "registerGuildCommands",
    "ensureManagedRoles",
    "runSotStartupAlerts",
    "syncApprovedTierRoles",
    "refreshWelcomePanel",
    "refreshAllTierlists",
  ]);
  assert.deepEqual(errors, ["Tier role sync failed: tier sync failed"]);
});

test("runClientReadyCore logs welcome refresh failures and still refreshes tierlists", async () => {
  const calls = [];
  const errors = [];

  await runClientReadyCore({ id: "client" }, {
    async registerGuildCommands() {
      calls.push("registerGuildCommands");
    },
    async ensureManagedRoles() {
      calls.push("ensureManagedRoles");
      return {};
    },
    async runSotStartupAlerts() {
      calls.push("runSotStartupAlerts");
    },
    async syncApprovedTierRoles() {
      calls.push("syncApprovedTierRoles");
    },
    async refreshWelcomePanel() {
      calls.push("refreshWelcomePanel");
      throw new Error("welcome refresh failed");
    },
    async refreshAllTierlists() {
      calls.push("refreshAllTierlists");
    },
    logError: (...args) => errors.push(args.join(" ")),
  });

  assert.deepEqual(calls, [
    "registerGuildCommands",
    "ensureManagedRoles",
    "runSotStartupAlerts",
    "syncApprovedTierRoles",
    "refreshWelcomePanel",
    "refreshAllTierlists",
  ]);
  assert.deepEqual(errors, ["Welcome panel refresh failed: welcome refresh failed"]);
});

test("runClientReadyCore logs tierlist refresh failures and continues to activity resume", async () => {
  const calls = [];
  const errors = [];

  await runClientReadyCore({ id: "client" }, {
    async registerGuildCommands() {
      calls.push("registerGuildCommands");
    },
    async ensureManagedRoles() {
      calls.push("ensureManagedRoles");
      return {};
    },
    async runSotStartupAlerts() {
      calls.push("runSotStartupAlerts");
    },
    async syncApprovedTierRoles() {
      calls.push("syncApprovedTierRoles");
    },
    async refreshWelcomePanel() {
      calls.push("refreshWelcomePanel");
    },
    async refreshAllTierlists() {
      calls.push("refreshAllTierlists");
      throw new Error("tierlist refresh failed");
    },
    async resumeActivityRuntime() {
      calls.push("resumeActivityRuntime");
    },
    logError: (...args) => errors.push(args.join(" ")),
  });

  assert.deepEqual(calls, [
    "registerGuildCommands",
    "ensureManagedRoles",
    "runSotStartupAlerts",
    "syncApprovedTierRoles",
    "refreshWelcomePanel",
    "refreshAllTierlists",
    "resumeActivityRuntime",
  ]);
  assert.deepEqual(errors, ["Tierlist refresh failed: tierlist refresh failed"]);
});

test("runClientReadyCore resumes activity runtime after refreshes", async () => {
  const calls = [];

  await runClientReadyCore({ id: "client" }, {
    async registerGuildCommands() {
      calls.push("registerGuildCommands");
    },
    async ensureManagedRoles() {
      calls.push("ensureManagedRoles");
      return {};
    },
    async runSotStartupAlerts() {
      calls.push("runSotStartupAlerts");
    },
    async syncApprovedTierRoles() {
      calls.push("syncApprovedTierRoles");
    },
    async refreshWelcomePanel() {
      calls.push("refreshWelcomePanel");
    },
    async refreshAllTierlists() {
      calls.push("refreshAllTierlists");
    },
    async resumeActivityRuntime() {
      calls.push("resumeActivityRuntime");
    },
  });

  assert.deepEqual(calls, [
    "registerGuildCommands",
    "ensureManagedRoles",
    "runSotStartupAlerts",
    "syncApprovedTierRoles",
    "refreshWelcomePanel",
    "refreshAllTierlists",
    "resumeActivityRuntime",
  ]);
});

test("scheduleClientReadyIntervals wires auto-resend, alert ticks, and summary refresh", async () => {
  const scheduled = [];
  const calls = [];
  const handles = scheduleClientReadyIntervals({ id: "client" }, {
    periodicJobs: [
      {
        run(client) {
          calls.push(["runAutoResendTick", client]);
        },
        intervalMs: 100,
        errorLabel: "Auto-resend tick error",
      },
      {
        run(client) {
          calls.push(["refreshLegacyTierlistSummaryMessage", client]);
        },
        intervalMs: 200,
        errorLabel: "Legacy Tierlist summary refresh failed",
      },
      {
        run(client) {
          calls.push(["runRobloxProfileRefreshJob", client]);
        },
        intervalMs: 300,
        errorLabel: "Roblox metadata refresh failed",
      },
      {
        run(client) {
          calls.push(["flushActivityRuntime", client]);
        },
        intervalMs: 350,
        errorLabel: "Activity runtime flush failed",
      },
      {
        run(client) {
          calls.push(["syncRobloxPlaytime", client]);
        },
        intervalMs: 400,
        errorLabel: "Roblox playtime sync failed",
      },
    ],
    scheduleSotAlertTicks(client) {
      calls.push(["scheduleSotAlertTicks", client]);
      return ["character-handle", "drift-handle"];
    },
    setIntervalFn(handler, intervalMs) {
      scheduled.push({ handler, intervalMs });
      return `timer:${intervalMs}`;
    },
  });

  assert.deepEqual(handles, ["character-handle", "drift-handle", "timer:100", "timer:200", "timer:300", "timer:350", "timer:400"]);
  assert.deepEqual(calls, [["scheduleSotAlertTicks", { id: "client" }]]);

  await scheduled[0].handler();
  await scheduled[1].handler();
  await scheduled[2].handler();
  await scheduled[3].handler();
  await scheduled[4].handler();

  assert.deepEqual(calls, [
    ["scheduleSotAlertTicks", { id: "client" }],
    ["runAutoResendTick", { id: "client" }],
    ["refreshLegacyTierlistSummaryMessage", { id: "client" }],
    ["runRobloxProfileRefreshJob", { id: "client" }],
    ["flushActivityRuntime", { id: "client" }],
    ["syncRobloxPlaytime", { id: "client" }],
  ]);
});

test("scheduleClientReadyIntervals runs zero-delay jobs immediately and delays the recurring cadence when initialDelayMs is set", async () => {
  const scheduledIntervals = [];
  const scheduledTimeouts = [];
  const calls = [];

  const handles = scheduleClientReadyIntervals({ id: "client" }, {
    periodicJobs: [
      {
        run(client) {
          calls.push(["runDailyActivityRoleSync", client]);
        },
        intervalMs: 86400000,
        initialDelayMs: 0,
        errorLabel: "Activity daily role sync failed",
      },
      {
        run(client) {
          calls.push(["delayedActivityRoleSync", client]);
        },
        intervalMs: 86400000,
        initialDelayMs: 3600000,
        errorLabel: "Activity delayed role sync failed",
      },
    ],
    scheduleSotAlertTicks() {
      return [];
    },
    setIntervalFn(handler, intervalMs) {
      scheduledIntervals.push({ handler, intervalMs });
      return `timer:${intervalMs}:${scheduledIntervals.length}`;
    },
    setTimeoutFn(handler, delayMs) {
      scheduledTimeouts.push({ handler, delayMs });
      return `timeout:${delayMs}`;
    },
  });

  assert.deepEqual(calls, [["runDailyActivityRoleSync", { id: "client" }]]);
  assert.deepEqual(scheduledTimeouts.map((entry) => entry.delayMs), [3600000]);
  assert.deepEqual(scheduledIntervals.map((entry) => entry.intervalMs), [86400000]);
  assert.deepEqual(handles, ["timer:86400000:1", "timeout:3600000"]);

  await scheduledTimeouts[0].handler();

  assert.deepEqual(calls, [
    ["runDailyActivityRoleSync", { id: "client" }],
    ["delayedActivityRoleSync", { id: "client" }],
  ]);
  assert.deepEqual(scheduledIntervals.map((entry) => entry.intervalMs), [86400000, 86400000]);
  assert.deepEqual(handles, ["timer:86400000:1", "timeout:3600000", "timer:86400000:2"]);
});

test("scheduleClientReadyIntervals logs auto-resend and summary refresh failures", async () => {
  const scheduled = [];
  const errors = [];

  scheduleClientReadyIntervals({ id: "client" }, {
    periodicJobs: [
      {
        async run() {
          throw new Error("auto resend failed");
        },
        intervalMs: 100,
        errorLabel: "Auto-resend tick error",
      },
      {
        async run() {
          throw new Error("summary refresh failed");
        },
        intervalMs: 200,
        errorLabel: "Legacy Tierlist summary refresh failed",
      },
      {
        async run() {
          throw new Error("roblox refresh failed");
        },
        intervalMs: 300,
        errorLabel: "Roblox metadata refresh failed",
      },
      {
        async run() {
          throw new Error("activity flush failed");
        },
        intervalMs: 350,
        errorLabel: "Activity runtime flush failed",
      },
      {
        async run() {
          throw new Error("playtime failed");
        },
        intervalMs: 400,
        errorLabel: "Roblox playtime sync failed",
      },
    ],
    scheduleSotAlertTicks() {
      return [];
    },
    setIntervalFn(handler, intervalMs) {
      scheduled.push({ handler, intervalMs });
      return intervalMs;
    },
    logError: (...args) => errors.push(args.join(" ")),
  });

  await scheduled[0].handler();
  await scheduled[1].handler();
  await scheduled[2].handler();
  await scheduled[3].handler();
  await scheduled[4].handler();

  assert.deepEqual(errors, [
    "Auto-resend tick error: auto resend failed",
    "Legacy Tierlist summary refresh failed: summary refresh failed",
    "Roblox metadata refresh failed: roblox refresh failed",
    "Activity runtime flush failed: activity flush failed",
    "Roblox playtime sync failed: playtime failed",
  ]);
});

test("scheduleClientReadyIntervals skips summary refresh when tierlist source path is missing", async () => {
  const scheduled = [];
  let refreshed = false;

  scheduleClientReadyIntervals({ id: "client" }, {
    periodicJobs: [
      {
        async run() {},
        intervalMs: 100,
        errorLabel: "Auto-resend tick error",
      },
      {
        async run() {
          const tierlistSourcePath = "";
          if (!tierlistSourcePath) return;
          refreshed = true;
        },
        intervalMs: 200,
        errorLabel: "Legacy Tierlist summary refresh failed",
      },
    ],
    scheduleSotAlertTicks() {
      return [];
    },
    setIntervalFn(handler, intervalMs) {
      scheduled.push({ handler, intervalMs });
      return intervalMs;
    },
  });

  await scheduled[1].handler();

  assert.equal(refreshed, false);
});