"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  createDbStore,
  createDefaultDbState,
  loadJsonFile,
  saveJsonFile,
} = require("../src/db/store");
const {
  createPresentationDefaults,
  ensurePresentationConfig,
} = require("../src/onboard/presentation");

function createDeps(overrides = {}) {
  const defaultCharacters = [
    { id: "gojo", label: "Годжо", roleId: "" },
  ];

  const deps = {
    dbPath: overrides.dbPath || path.join(fs.mkdtempSync(path.join(os.tmpdir(), "moderator-db-store-")), "welcome-db.json"),
    dataRoot: overrides.dataRoot || fs.mkdtempSync(path.join(os.tmpdir(), "moderator-db-root-")),
    appConfig: overrides.appConfig || {
      channels: {
        welcomeChannelId: "welcome-1",
        tierlistChannelId: "tier-1",
      },
      characters: defaultCharacters,
    },
    fileConfig: overrides.fileConfig || {},
    defaultGraphicTierColors: overrides.defaultGraphicTierColors || { 1: "#111111" },
    normalizeCharacterCatalog: overrides.normalizeCharacterCatalog || ((value) => Array.isArray(value) ? value.filter(Boolean) : []),
    mergeCharacterCatalog: overrides.mergeCharacterCatalog || ((value, fallback = []) => {
      const merged = [...(Array.isArray(value) ? value : [])];
      for (const entry of Array.isArray(fallback) ? fallback : []) {
        if (!merged.some((item) => item?.id === entry?.id)) merged.push(entry);
      }
      return merged;
    }),
    sameCharacterCatalog: overrides.sameCharacterCatalog || ((left, right) => JSON.stringify(left || []) === JSON.stringify(right || [])),
    createDefaultIntegrationState: overrides.createDefaultIntegrationState || (() => ({ elo: { sourcePath: "" }, tierlist: { sourcePath: "" } })),
    createOnboardModeState: overrides.createOnboardModeState || ((value) => value ? { value: String(value.value || value.mode || "peace") } : { value: "peace" }),
    ensurePresentationConfig: overrides.ensurePresentationConfig || (() => ({ mutated: false })),
    createPresentationDefaults: overrides.createPresentationDefaults || (() => ({ welcome: {} })),
    normalizeRoleGrantRegistry: overrides.normalizeRoleGrantRegistry || (() => ({ registry: {}, mutated: false })),
    normalizeIntegrationState: overrides.normalizeIntegrationState || ((integrations) => ({ integrations: integrations || { elo: { sourcePath: "" }, tierlist: { sourcePath: "" } }, mutated: false })),
    normalizeComboGuideEditorRoleIds: overrides.normalizeComboGuideEditorRoleIds || ((value) => Array.isArray(value) ? value : []),
    importDormantEloSyncFromFile: overrides.importDormantEloSyncFromFile || (() => ({ mutated: false, error: null })),
    importDormantTierlistSyncFromFile: overrides.importDormantTierlistSyncFromFile || (() => ({ mutated: false, error: null })),
    syncSharedProfiles: overrides.syncSharedProfiles || (() => ({ mutated: false })),
    dualWriteSotState: overrides.dualWriteSotState || (() => ({ mutated: false, writtenSlots: [] })),
    syncSotState: overrides.syncSotState || (() => ({ mutated: false })),
  };

  return deps;
}

test("loadJsonFile returns fallback when file is missing and saveJsonFile writes JSON", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "moderator-db-json-"));
  const filePath = path.join(tempDir, "nested", "db.json");

  assert.deepEqual(loadJsonFile(filePath, { ok: true }), { ok: true });

  saveJsonFile(filePath, { answer: 42 });
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, "utf8")), { answer: 42 });
  assert.deepEqual(fs.readdirSync(path.dirname(filePath)), ["db.json"]);
});

test("createDefaultDbState seeds expected onboarding defaults", () => {
  const state = createDefaultDbState({
    appConfig: {
      channels: {
        welcomeChannelId: "welcome-1",
        tierlistChannelId: "tier-1",
      },
      characters: [{ id: "gojo", label: "Годжо", roleId: "" }],
    },
    createDefaultIntegrationState: () => ({ elo: {}, tierlist: {} }),
    createOnboardModeState: () => ({ value: "peace" }),
    normalizeCharacterCatalog: (value) => value,
  });

  assert.equal(state.config.welcomePanel.channelId, "welcome-1");
  assert.equal(state.config.nonGgsPanel.channelId, "welcome-1");
  assert.deepEqual(state.config.tierlistBoard.text, {
    channelId: "tier-1",
    messageIdSummary: "",
    messageIdPages: "",
  });
  assert.deepEqual(state.config.characters, [{ id: "gojo", label: "Годжо", roleId: "" }]);
  assert.deepEqual(state.profiles, {});
  assert.deepEqual(state.submissions, {});
});

test("createDbStore.load normalizes legacy db state and marks dirty migrations", () => {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "moderator-db-load-")), "welcome-db.json");
  fs.writeFileSync(dbPath, JSON.stringify({
    config: {
      integrations: {
        elo: { sourcePath: "elo-db.json" },
        tierlist: { sourcePath: "tierlist/state.json" },
      },
      onboardMode: { mode: "wartime" },
      characters: [{ id: "gojo", label: "Годжо", roleId: "role-gojo" }],
    },
    roleGrantMessages: { message1: { roleId: "role-1" } },
    comboGuide: {},
  }, null, 2), "utf8");

  const calls = {
    elo: null,
    tierlist: null,
    sharedProfiles: 0,
    sot: 0,
  };

  const store = createDbStore(createDeps({
    dbPath,
    ensurePresentationConfig: () => ({ mutated: true }),
    normalizeRoleGrantRegistry: (value) => ({ registry: value || {}, mutated: false }),
    normalizeIntegrationState: (integrations) => ({
      integrations: {
        elo: { sourcePath: String(integrations?.elo?.sourcePath || "") },
        tierlist: { sourcePath: String(integrations?.tierlist?.sourcePath || "") },
      },
      mutated: true,
    }),
    normalizeComboGuideEditorRoleIds: () => ["combo-editor"],
    importDormantEloSyncFromFile: (db, options) => {
      calls.elo = { db, options };
      return { mutated: false, error: null };
    },
    importDormantTierlistSyncFromFile: (db, options) => {
      calls.tierlist = { db, options };
      return { mutated: true, error: null };
    },
    syncSharedProfiles: (db) => {
      calls.sharedProfiles += 1;
      db.profiles.synced = true;
      return { mutated: false };
    },
    syncSotState: (db) => {
      calls.sot += 1;
      db.sot = { sotVersion: 1 };
      return { mutated: true };
    },
  }));

  const db = store.load();

  assert.equal(db.config.reviewChannelId, "");
  assert.equal(db.config.notificationChannelId, "");
  assert.deepEqual(db.comboGuide.editorRoleIds, ["combo-editor"]);
  assert.equal(db.profiles.synced, true);
  assert.deepEqual(db.sot, { sotVersion: 1 });
  assert.equal(db.__needsSaveAfterLoad, true);
  assert.equal(calls.sharedProfiles, 1);
  assert.equal(calls.sot, 1);
  assert.equal(calls.elo.options.baseDir.length > 0, true);
  assert.deepEqual(calls.tierlist.options.characterCatalog, [{ id: "gojo", label: "Годжо" }]);
});

test("createDbStore.load keeps stored config.characters normalized without merging appConfig additions", () => {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "moderator-db-load-no-merge-")), "welcome-db.json");
  fs.writeFileSync(dbPath, JSON.stringify({
    config: {
      characters: [{ id: "legacy_only", label: "Legacy Only", roleId: "role-legacy" }],
      integrations: {
        elo: { sourcePath: "elo-db.json" },
        tierlist: { sourcePath: "tierlist/state.json" },
      },
    },
  }, null, 2), "utf8");

  const calls = {
    tierlist: null,
  };

  const store = createDbStore(createDeps({
    dbPath,
    appConfig: {
      channels: {
        welcomeChannelId: "welcome-1",
        tierlistChannelId: "tier-1",
      },
      characters: [{ id: "gojo", label: "Годжо", roleId: "" }],
    },
    importDormantTierlistSyncFromFile: (db, options) => {
      calls.tierlist = { db, options };
      return { mutated: false, error: null };
    },
  }));

  const db = store.load();

  assert.deepEqual(db.config.characters, [{ id: "legacy_only", label: "Legacy Only", roleId: "role-legacy" }]);
  assert.deepEqual(calls.tierlist.options.characterCatalog, [{ id: "gojo", label: "Годжо" }]);
});

test("createDbStore.save strips transient load flag and persists normalized integrations", () => {
  let sotCalls = 0;
  let dualWriteCalls = 0;
  const deps = createDeps({
    normalizeIntegrationState: () => ({
      integrations: {
        elo: { sourcePath: "elo-db.json" },
        tierlist: { sourcePath: "tierlist/state.json" },
      },
      mutated: false,
    }),
    dualWriteSotState: (db) => {
      dualWriteCalls += 1;
      db.sot = {
        ...(db.sot || {}),
        channels: {
          review: { value: "review-channel", source: "manual", verifiedAt: null },
        },
      };
      return { mutated: true, writtenSlots: ["review"] };
    },
    syncSotState: (db) => {
      sotCalls += 1;
      db.sot = { ...(db.sot || {}), sotVersion: 1 };
      return { mutated: false };
    },
  });
  const store = createDbStore(deps);
  const db = createDefaultDbState({
    appConfig: deps.appConfig,
    createDefaultIntegrationState: deps.createDefaultIntegrationState,
    createOnboardModeState: deps.createOnboardModeState,
    normalizeCharacterCatalog: deps.normalizeCharacterCatalog,
  });
  db.__needsSaveAfterLoad = true;

  const result = store.save(db);

  const written = JSON.parse(fs.readFileSync(deps.dbPath, "utf8"));
  assert.equal(dualWriteCalls, 1);
  assert.equal(sotCalls, 1);
  assert.equal("__needsSaveAfterLoad" in written, false);
  assert.equal(written.config.integrations.elo.sourcePath, "elo-db.json");
  assert.equal(written.config.integrations.tierlist.sourcePath, "tierlist/state.json");
  assert.equal(written.sot.sotVersion, 1);
  assert.equal(written.sot.channels.review.value, "review-channel");
  assert.deepEqual(result.dualWriteState.writtenSlots, ["review"]);
});

test("createDbStore.save normalizes legacy text tierlist messageId before persist", () => {
  const deps = createDeps({
    ensurePresentationConfig,
    createPresentationDefaults,
  });
  const store = createDbStore(deps);
  const db = createDefaultDbState({
    appConfig: deps.appConfig,
    createDefaultIntegrationState: deps.createDefaultIntegrationState,
    createOnboardModeState: deps.createOnboardModeState,
    normalizeCharacterCatalog: deps.normalizeCharacterCatalog,
  });

  db.config.tierlistBoard.text.messageId = "legacy-summary";

  store.save(db);

  const written = JSON.parse(fs.readFileSync(deps.dbPath, "utf8"));
  assert.deepEqual(written.config.tierlistBoard.text, {
    channelId: "tier-1",
    messageIdSummary: "legacy-summary",
    messageIdPages: "",
  });
  assert.equal("messageId" in written.config.tierlistBoard.text, false);
});