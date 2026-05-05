"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  runClientReadyCore,
  scheduleClientReadyIntervals,
} = require("../src/runtime/client-ready-core");

test("runClientReadyCore preserves startup order for the core prelude", async () => {
  const calls = [];
  const client = { id: "client" };

  const result = await runClientReadyCore(client, {
    async ensureManagedRoles(currentClient) {
      calls.push(["ensureManagedRoles", currentClient]);
      return { resolvedCharacters: 3 };
    },
    async runSotStartupAlerts(currentClient) {
      calls.push(["runSotStartupAlerts", currentClient]);
    },
    async registerGuildCommands(currentClient) {
      calls.push(["registerGuildCommands", currentClient]);
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
    ["ensureManagedRoles", client],
    ["runSotStartupAlerts", client],
    ["registerGuildCommands", client],
    ["syncApprovedTierRoles", client],
    ["refreshWelcomePanel", client],
    ["refreshAllTierlists", client],
  ]);
  assert.deepEqual(result, { generated: { resolvedCharacters: 3 } });
});

test("runClientReadyCore ignores syncApprovedTierRoles failures and continues", async () => {
  const calls = [];

  await runClientReadyCore({ id: "client" }, {
    async ensureManagedRoles() {
      calls.push("ensureManagedRoles");
      return {};
    },
    async runSotStartupAlerts() {
      calls.push("runSotStartupAlerts");
    },
    async registerGuildCommands() {
      calls.push("registerGuildCommands");
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
  });

  assert.deepEqual(calls, [
    "ensureManagedRoles",
    "runSotStartupAlerts",
    "registerGuildCommands",
    "syncApprovedTierRoles",
    "refreshWelcomePanel",
    "refreshAllTierlists",
  ]);
});

test("runClientReadyCore logs welcome refresh failures and still refreshes tierlists", async () => {
  const calls = [];
  const errors = [];

  await runClientReadyCore({ id: "client" }, {
    async ensureManagedRoles() {
      calls.push("ensureManagedRoles");
      return {};
    },
    async runSotStartupAlerts() {
      calls.push("runSotStartupAlerts");
    },
    async registerGuildCommands() {
      calls.push("registerGuildCommands");
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
    "ensureManagedRoles",
    "runSotStartupAlerts",
    "registerGuildCommands",
    "syncApprovedTierRoles",
    "refreshWelcomePanel",
    "refreshAllTierlists",
  ]);
  assert.deepEqual(errors, ["Welcome panel refresh failed: welcome refresh failed"]);
});

test("scheduleClientReadyIntervals wires auto-resend, alert ticks, and summary refresh", async () => {
  const scheduled = [];
  const calls = [];
  const handles = scheduleClientReadyIntervals({ id: "client" }, {
    async runAutoResendTick(client) {
      calls.push(["runAutoResendTick", client]);
    },
    autoResendTickMs: 100,
    scheduleSotAlertTicks(client) {
      calls.push(["scheduleSotAlertTicks", client]);
      return ["character-handle", "drift-handle"];
    },
    getResolvedIntegrationSourcePath(slot) {
      calls.push(["getResolvedIntegrationSourcePath", slot]);
      return "tierlist/state.json";
    },
    async refreshLegacyTierlistSummaryMessage(client) {
      calls.push(["refreshLegacyTierlistSummaryMessage", client]);
    },
    legacyTierlistSummaryRefreshMs: 200,
    setIntervalFn(handler, intervalMs) {
      scheduled.push({ handler, intervalMs });
      return `timer:${intervalMs}`;
    },
  });

  assert.deepEqual(handles, ["timer:100", "character-handle", "drift-handle", "timer:200"]);
  assert.deepEqual(calls, [["scheduleSotAlertTicks", { id: "client" }]]);

  await scheduled[0].handler();
  await scheduled[1].handler();

  assert.deepEqual(calls, [
    ["scheduleSotAlertTicks", { id: "client" }],
    ["runAutoResendTick", { id: "client" }],
    ["getResolvedIntegrationSourcePath", "tierlist"],
    ["refreshLegacyTierlistSummaryMessage", { id: "client" }],
  ]);
});

test("scheduleClientReadyIntervals logs auto-resend and summary refresh failures", async () => {
  const scheduled = [];
  const errors = [];

  scheduleClientReadyIntervals({ id: "client" }, {
    async runAutoResendTick() {
      throw new Error("auto resend failed");
    },
    autoResendTickMs: 100,
    scheduleSotAlertTicks() {
      return [];
    },
    getResolvedIntegrationSourcePath() {
      return "tierlist/state.json";
    },
    async refreshLegacyTierlistSummaryMessage() {
      throw new Error("summary refresh failed");
    },
    legacyTierlistSummaryRefreshMs: 200,
    setIntervalFn(handler, intervalMs) {
      scheduled.push({ handler, intervalMs });
      return intervalMs;
    },
    logError: (...args) => errors.push(args.join(" ")),
  });

  await scheduled[0].handler();
  await scheduled[1].handler();

  assert.deepEqual(errors, [
    "Auto-resend tick error: auto resend failed",
    "Legacy Tierlist summary refresh failed: summary refresh failed",
  ]);
});

test("scheduleClientReadyIntervals skips summary refresh when tierlist source path is missing", async () => {
  const scheduled = [];
  let refreshed = false;

  scheduleClientReadyIntervals({ id: "client" }, {
    async runAutoResendTick() {},
    autoResendTickMs: 100,
    scheduleSotAlertTicks() {
      return [];
    },
    getResolvedIntegrationSourcePath() {
      return "";
    },
    async refreshLegacyTierlistSummaryMessage() {
      refreshed = true;
    },
    legacyTierlistSummaryRefreshMs: 200,
    setIntervalFn(handler, intervalMs) {
      scheduled.push({ handler, intervalMs });
      return intervalMs;
    },
  });

  await scheduled[1].handler();

  assert.equal(refreshed, false);
});