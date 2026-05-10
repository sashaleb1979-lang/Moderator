"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  createDbStore,
  createDefaultDbState,
  getResolvedIntegrationSourcePathFromState,
  loadJsonFile,
  saveJsonFile,
} = require("../src/db/store");
const {
  AUTONOMY_GUARD_WARNING_BUCKET_KEYS,
  createAutonomyGuardState,
} = require("../src/moderation/autonomy-guard");
const {
  createPresentationDefaults,
  ensurePresentationConfig,
} = require("../src/onboard/presentation");
const { normalizeIntegrationState } = require("../src/integrations/shared-profile");
const { syncSotShadowState } = require("../src/sot/loader");

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
    createOnboardAccessGrantState: overrides.createOnboardAccessGrantState || ((value) => value ? { mode: String(value.mode || "after_submit") } : { mode: "after_submit" }),
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

test("getResolvedIntegrationSourcePathFromState prefers persisted SoT sourcePath over compat shadow", () => {
  const db = {
    config: {
      integrations: {
        elo: { sourcePath: "legacy/elo-stale.json" },
      },
    },
    sot: {
      integrations: {
        elo: { sourcePath: "sot/elo-preferred.json" },
      },
    },
  };

  assert.equal(getResolvedIntegrationSourcePathFromState(db, "elo"), "sot/elo-preferred.json");
  assert.equal(getResolvedIntegrationSourcePathFromState(db, "tierlist"), "");
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
    createOnboardAccessGrantState: () => ({ mode: "after_submit" }),
    normalizeCharacterCatalog: (value) => value,
  });

  assert.equal(state.config.welcomePanel.channelId, "welcome-1");
  assert.equal(state.config.nonGgsPanel.channelId, "welcome-1");
  assert.deepEqual(state.config.accessGrant, { mode: "after_submit" });
  assert.deepEqual(state.config.autonomyGuard, createAutonomyGuardState({}));
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
      accessGrant: { mode: "after_approve" },
      onboardMode: { mode: "wartime" },
      autonomyGuard: {
        primaryAdminUserId: "invalid",
        targetUserId: "123456789012345678",
        protectedRole: {
          roleId: "987654321098765432",
          name: "  target role  ",
          color: "abc123",
        },
        isolatedUserIds: ["111111111111111111", "bad", "111111111111111111", "222222222222222222"],
        warningCounters: {
          invalid: { ownerMessageDeletes: 99 },
          "111111111111111111": { ownerMessageDeletes: 2, logMessageDeletes: -1, reviewMessageDeletes: "3" },
        },
      },
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
  assert.deepEqual(db.config.accessGrant, { mode: "after_approve" });
  assert.deepEqual(db.config.autonomyGuard, {
    primaryAdminUserId: "",
    targetUserId: "123456789012345678",
    protectedRole: {
      roleId: "987654321098765432",
      name: "target role",
      color: "#ABC123",
    },
    isolatedUserIds: ["111111111111111111", "222222222222222222"],
    warningCounters: {
      "111111111111111111": {
        ownerMessageDeletes: 2,
        logMessageDeletes: 0,
        reviewMessageDeletes: 3,
      },
    },
  });
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

test("createDbStore.load prefers persisted SoT integration sourcePath over stale compat shadow", () => {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "moderator-db-load-sot-path-")), "welcome-db.json");
  fs.writeFileSync(dbPath, JSON.stringify({
    config: {
      integrations: {
        elo: { sourcePath: "legacy/elo-stale.json" },
        tierlist: { sourcePath: "legacy/tierlist-stale.json" },
      },
    },
    sot: {
      integrations: {
        elo: { sourcePath: "sot/elo-preferred.json" },
        tierlist: { sourcePath: "sot/tierlist-preferred.json" },
      },
    },
  }, null, 2), "utf8");

  const calls = {
    elo: null,
    tierlist: null,
  };

  const store = createDbStore(createDeps({
    dbPath,
    importDormantEloSyncFromFile: (_db, options) => {
      calls.elo = options;
      return { mutated: false, error: null };
    },
    importDormantTierlistSyncFromFile: (_db, options) => {
      calls.tierlist = options;
      return { mutated: false, error: null };
    },
  }));

  store.load();

  assert.equal(calls.elo.sourcePath, "sot/elo-preferred.json");
  assert.equal(calls.tierlist.sourcePath, "sot/tierlist-preferred.json");
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

test("createDbStore.save preserves runtime state when disk write fails", () => {
  const blockedPath = fs.mkdtempSync(path.join(os.tmpdir(), "moderator-db-save-fail-"));
  const deps = createDeps({
    dbPath: blockedPath,
    dualWriteSotState: (db) => {
      db.sot = {
        ...(db.sot || {}),
        channels: {
          review: { value: "review-channel", source: "manual", verifiedAt: null },
        },
      };
      return { mutated: true, writtenSlots: ["review"] };
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

  assert.throws(() => store.save(db));
  assert.equal(db.__needsSaveAfterLoad, true);
  assert.equal(Boolean(db.sot?.channels?.review), false);
});

test("createDbStore.save preserves verification shadow and manual verify role across SoT refresh", () => {
  const appConfig = {
    channels: {
      welcomeChannelId: "welcome-1",
      tierlistChannelId: "tier-1",
    },
    roles: {
      verifyAccessRoleId: "verify-config",
    },
    characters: [{ id: "gojo", label: "Годжо", roleId: "" }],
  };
  const deps = createDeps({
    appConfig,
    normalizeIntegrationState,
    syncSotState: (db) => syncSotShadowState(db, { appConfig }),
  });
  const store = createDbStore(deps);
  const db = createDefaultDbState({
    appConfig: deps.appConfig,
    createDefaultIntegrationState: deps.createDefaultIntegrationState,
    createOnboardModeState: deps.createOnboardModeState,
    normalizeCharacterCatalog: deps.normalizeCharacterCatalog,
  });

  db.config.integrations.verification = {
    enabled: true,
    callbackBaseUrl: "https://example.com/verification/callback",
    verificationChannelId: "verify-room",
    reportChannelId: "review-room",
    entryMessage: { channelId: "verify-room", messageId: "entry-message" },
  };
  db.sot = {
    sotVersion: 1,
    integrations: {
      verification: {
        enabled: true,
        callbackBaseUrl: "https://example.com/verification/callback",
        verificationChannelId: "verify-room",
        reportChannelId: "review-room",
        entryMessage: { channelId: "verify-room", messageId: "entry-message" },
      },
    },
    roles: {
      verifyAccess: {
        value: "verify-manual",
        source: "manual",
        verifiedAt: null,
        evidence: { nativeWriter: true, manualOverride: true },
      },
    },
  };

  store.save(db);

  const written = JSON.parse(fs.readFileSync(deps.dbPath, "utf8"));
  assert.equal(written.config.integrations.verification.verificationChannelId, "verify-room");
  assert.equal(written.config.integrations.verification.reportChannelId, "review-room");
  assert.equal(written.sot.integrations.verification.verificationChannelId, "verify-room");
  assert.equal(written.sot.roles.verifyAccess.value, "verify-manual");
  assert.equal(written.sot.roles.verifyAccess.source, "manual");
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

test("createAutonomyGuardState normalizes ids, colors and warning buckets", () => {
  const state = createAutonomyGuardState({
    primaryAdminUserId: "123456789012345678",
    targetUserId: "bad-id",
    protectedRole: {
      roleId: "876543210987654321",
      name: "  Sentinel  ",
      color: "#00ff00",
    },
    isolatedUserIds: ["111111111111111111", "invalid", "111111111111111111"],
    warningCounters: {
      "111111111111111111": {
        ownerMessageDeletes: 1,
        logMessageDeletes: 2,
        reviewMessageDeletes: 3,
        ignoredExtraKey: 99,
      },
    },
  });

  assert.deepEqual(state, {
    primaryAdminUserId: "123456789012345678",
    targetUserId: "",
    protectedRole: {
      roleId: "876543210987654321",
      name: "Sentinel",
      color: "#00FF00",
    },
    isolatedUserIds: ["111111111111111111"],
    warningCounters: {
      "111111111111111111": {
        ownerMessageDeletes: 1,
        logMessageDeletes: 2,
        reviewMessageDeletes: 3,
      },
    },
  });
  assert.deepEqual(AUTONOMY_GUARD_WARNING_BUCKET_KEYS, [
    "ownerMessageDeletes",
    "logMessageDeletes",
    "reviewMessageDeletes",
  ]);
});