"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { isSqliteAvailable, createSqliteAdapter, seedSqliteFromJsonIfEmpty } = require("../src/db/sqlite-adapter");
const { createDbStore } = require("../src/db/store");
const { createAutonomyGuardState } = require("../src/moderation/autonomy-guard");

const sqliteReady = isSqliteAvailable();
const maybe = sqliteReady ? test : test.skip;

function tempDbPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "moderator-sqlite-")), "welcome.sqlite");
}

maybe("readRaw returns undefined for an empty database", () => {
  const adapter = createSqliteAdapter(tempDbPath());
  try {
    assert.equal(adapter.readRaw(), undefined);
  } finally {
    adapter.close();
  }
});

maybe("writeSync then readRaw round-trips kv, profiles and submissions", () => {
  const dbPath = tempDbPath();
  const writer = createSqliteAdapter(dbPath);
  const snapshot = {
    config: { welcomePanel: { channelId: "w1" }, nested: { a: 1, b: [2, 3] } },
    sot: { sotVersion: 4 },
    cooldowns: { u1: 1234 },
    profiles: {
      u1: { name: "One", domains: { activity: { joins: 2 } } },
      u2: { name: "Two" },
    },
    submissions: { s1: { status: "pending" } },
  };
  writer.writeSync(snapshot);
  writer.close();

  const reader = createSqliteAdapter(dbPath);
  try {
    const raw = reader.readRaw();
    assert.deepEqual(raw, snapshot);
  } finally {
    reader.close();
  }
});

maybe("writeSync only touches changed rows and applies deletions", () => {
  const dbPath = tempDbPath();
  const adapter = createSqliteAdapter(dbPath);
  try {
    let result = adapter.writeSync({
      config: { v: 1 },
      profiles: { u1: { score: 1 }, u2: { score: 2 } },
      submissions: {},
    });
    // first write: config + 2 profiles = 3 changed rows
    assert.equal(result.changedRows, 3);

    // change only u2, leave config and u1 untouched
    result = adapter.writeSync({
      config: { v: 1 },
      profiles: { u1: { score: 1 }, u2: { score: 99 } },
      submissions: {},
    });
    assert.equal(result.changedRows, 1);

    // no-op write
    result = adapter.writeSync({
      config: { v: 1 },
      profiles: { u1: { score: 1 }, u2: { score: 99 } },
      submissions: {},
    });
    assert.equal(result.changedRows, 0);

    // delete u1, change config
    result = adapter.writeSync({
      config: { v: 2 },
      profiles: { u2: { score: 99 } },
      submissions: {},
    });
    assert.equal(result.changedRows, 2);
  } finally {
    adapter.close();
  }

  const reader = createSqliteAdapter(dbPath);
  try {
    const raw = reader.readRaw();
    assert.deepEqual(raw.profiles, { u2: { score: 99 } });
    assert.deepEqual(raw.config, { v: 2 });
  } finally {
    reader.close();
  }
});

function makeStoreDeps(persistence, dbPath, dataRoot) {
  return {
    dbPath,
    dataRoot,
    appConfig: {
      channels: { welcomeChannelId: "welcome-1", tierlistChannelId: "tier-1" },
      characters: [{ id: "gojo", label: "Годжо", roleId: "" }],
    },
    fileConfig: {},
    defaultGraphicTierColors: { 1: "#111111" },
    normalizeCharacterCatalog: (value) => (Array.isArray(value) ? value.filter(Boolean) : []),
    createDefaultIntegrationState: () => ({ elo: { sourcePath: "" }, tierlist: { sourcePath: "" } }),
    createOnboardModeState: (value) => (value ? { value: String(value.value || value.mode || "peace") } : { value: "peace" }),
    createOnboardAccessGrantState: (value) => (value ? { mode: String(value.mode || "after_submit") } : { mode: "after_submit" }),
    ensurePresentationConfig: () => ({ mutated: false }),
    createPresentationDefaults: () => ({ welcome: {} }),
    normalizeRoleGrantRegistry: () => ({ registry: {}, mutated: false }),
    normalizeIntegrationState: (integrations) => ({
      integrations: integrations || { elo: { sourcePath: "" }, tierlist: { sourcePath: "" } },
      mutated: false,
    }),
    normalizeComboGuideEditorRoleIds: (value) => (Array.isArray(value) ? value : []),
    importDormantEloSyncFromFile: () => ({ mutated: false, error: null }),
    importDormantTierlistSyncFromFile: () => ({ mutated: false, error: null }),
    syncSharedProfiles: () => ({ mutated: false }),
    dualWriteSotState: () => ({ mutated: false, writtenSlots: [] }),
    syncSotState: () => ({ mutated: false }),
    persistence,
  };
}

maybe("seedSqliteFromJsonIfEmpty seeds an empty store from a JSON snapshot", () => {
  const dbPath = tempDbPath();
  const jsonRaw = {
    config: { welcomePanel: { channelId: "w1" } },
    sot: { sotVersion: 4 },
    profiles: { u1: { name: "One" } },
    // submissions intentionally omitted — the guard must default it.
  };
  const adapter = createSqliteAdapter(dbPath);
  try {
    const result = seedSqliteFromJsonIfEmpty(adapter, jsonRaw);
    assert.equal(result.seeded, true);
    assert.equal(result.reason, "seeded-from-json");
    assert.ok(result.rows >= 3);
    // The caller's object must not be mutated by the defaulting.
    assert.equal(jsonRaw.submissions, undefined);
  } finally {
    adapter.close();
  }

  const reader = createSqliteAdapter(dbPath);
  try {
    assert.deepEqual(reader.readRaw(), {
      config: { welcomePanel: { channelId: "w1" } },
      sot: { sotVersion: 4 },
      profiles: { u1: { name: "One" } },
      submissions: {},
    });
  } finally {
    reader.close();
  }
});

maybe("seedSqliteFromJsonIfEmpty never clobbers an already-populated store", () => {
  const dbPath = tempDbPath();
  const adapter = createSqliteAdapter(dbPath);
  try {
    adapter.writeSync({ config: { v: 1 }, profiles: { keep: { score: 7 } }, submissions: {} });
    const result = seedSqliteFromJsonIfEmpty(adapter, { config: { v: 999 }, profiles: { other: {} }, submissions: {} });
    assert.equal(result.seeded, false);
    assert.equal(result.reason, "already-populated");
    // Live data is untouched.
    assert.deepEqual(adapter.readRaw().profiles, { keep: { score: 7 } });
    assert.deepEqual(adapter.readRaw().config, { v: 1 });
  } finally {
    adapter.close();
  }
});

maybe("seedSqliteFromJsonIfEmpty is a no-op when there is no JSON source", () => {
  const adapter = createSqliteAdapter(tempDbPath());
  try {
    assert.equal(seedSqliteFromJsonIfEmpty(adapter, undefined).reason, "no-json-source");
    assert.equal(seedSqliteFromJsonIfEmpty(adapter, null).reason, "no-json-source");
    assert.equal(seedSqliteFromJsonIfEmpty(adapter, []).reason, "no-json-source");
    // Still empty — nothing was written.
    assert.equal(adapter.readRaw(), undefined);
  } finally {
    adapter.close();
  }
});

maybe("createDbStore persists through the sqlite adapter across reloads", async () => {
  const dbPath = tempDbPath();
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "moderator-sqlite-root-"));

  const adapterA = createSqliteAdapter(dbPath);
  const storeA = createDbStore(makeStoreDeps(adapterA, dbPath, dataRoot));
  const dbA = storeA.load();
  // fresh database: starts from defaults
  assert.deepEqual(dbA.profiles, {});
  assert.deepEqual(dbA.config.autonomyGuard, createAutonomyGuardState({}));

  dbA.profiles.u1 = { name: "One", score: 5 };
  dbA.submissions.s1 = { status: "pending" };
  await storeA.saveAsync(dbA);
  adapterA.close();

  const adapterB = createSqliteAdapter(dbPath);
  const storeB = createDbStore(makeStoreDeps(adapterB, dbPath, dataRoot));
  try {
    const dbB = storeB.load();
    assert.deepEqual(dbB.profiles.u1, { name: "One", score: 5 });
    assert.deepEqual(dbB.submissions.s1, { status: "pending" });
    assert.equal(dbB.config.welcomePanel.channelId, "welcome-1");
  } finally {
    adapterB.close();
  }
});
