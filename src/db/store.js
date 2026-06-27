"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { createAutonomyGuardState } = require("../moderation/autonomy-guard");
const { stringifyCooperative } = require("../runtime/cooperative-json");

function cloneValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeComboGuideMessageIds(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

function normalizeComboGuideCharacters(value) {
  if (!Array.isArray(value)) return [];

  return value
    .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    .map((entry) => ({
      ...entry,
      comboMessageIds: normalizeComboGuideMessageIds(entry.comboMessageIds),
      techMessageIds: normalizeComboGuideMessageIds(entry.techMessageIds),
    }));
}

function normalizeComboGuideState(value, normalizeComboGuideEditorRoleIds) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;

  return {
    ...value,
    editorRoleIds: normalizeComboGuideEditorRoleIds(value.editorRoleIds),
    generalTechsMessageIds: normalizeComboGuideMessageIds(value.generalTechsMessageIds),
    characters: normalizeComboGuideCharacters(value.characters),
  };
}

function replaceObjectContents(target, source) {
  for (const key of Object.keys(target || {})) {
    delete target[key];
  }
  // `source` here is always the throwaway normalized snapshot produced by
  // prepareWriteState (already a deep clone of the live db). Move its
  // references in directly rather than deep-cloning ~20MB a second time.
  Object.assign(target, source || {});
}

function loadJsonFile(filePath, fallbackValue) {
  try {
    if (!fs.existsSync(filePath)) return fallbackValue;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Не удалось прочитать JSON из ${filePath}: ${error.message}`);
  }
}

function saveJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    // Compact (non-pretty) JSON: the db file is machine-read only, and on the
    // ~20MB prod database the indentation roughly doubles serialize time and
    // file size. Dropping it shrinks the event-loop stall on every flush.
    fs.writeFileSync(tempPath, JSON.stringify(value), "utf8");
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {
      // noop
    }
    throw error;
  }
}

// Async sibling of saveJsonFile: keeps the same atomic temp-file + rename
// contract but performs the disk I/O off the event loop so a large database
// write never blocks interaction handling.
async function saveJsonFileAsync(filePath, value) {
  // Serialize with the COOPERATIVE serializer: byte-identical to JSON.stringify,
  // but it yields to the event loop every few ms instead of monopolizing it for
  // the ~3.5s a single synchronous stringify of the ~20MB prod db took on the
  // host. That synchronous freeze was the first cause of Discord "did not respond"
  // / frozen panels — it blew the 3s ack window AND blocked the ack watchdog's own
  // timer. Total wall-time is ~unchanged (big maps still serialize each record via
  // native stringify); it is just sliced so interaction handling is never starved.
  const serializeStart = process.hrtime.bigint();
  const { json: serialized, maxSliceMs } = await stringifyCooperative(value);
  const serializeMs = Number(process.hrtime.bigint() - serializeStart) / 1e6;
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await fsp.writeFile(tempPath, serialized, "utf8");
    await fsp.rename(tempPath, filePath);
  } catch (error) {
    try {
      await fsp.unlink(tempPath);
    } catch {
      // noop
    }
    throw error;
  }
  // serializeMs = total wall time (still drives the host's heavy-flush backoff so
  // sustained churn doesn't re-serialize non-stop). serializeBlockMs = the LONGEST
  // uninterrupted on-CPU slice — the honest "event-loop block" figure, now a few
  // ms instead of seconds.
  return { serializeMs, bytes: serialized.length, serializeBlockMs: maxSliceMs };
}

function hasExistingIntegrationSourcePath(sourcePath = "", options = {}) {
  const normalizedSourcePath = String(sourcePath || "").trim();
  if (!normalizedSourcePath) return false;

  const baseDir = String(options.baseDir || "").trim();
  if (!baseDir) return true;

  const resolvedPath = path.isAbsolute(normalizedSourcePath)
    ? normalizedSourcePath
    : path.join(baseDir, normalizedSourcePath);
  return fs.existsSync(resolvedPath);
}

function getResolvedIntegrationSourcePathFromState(db = {}, slot = "", options = {}) {
  const normalizedSlot = String(slot || "").trim();
  if (!normalizedSlot) return "";

  const baseDir = String(options.baseDir || "").trim();
  const persistedValue = String(db?.sot?.integrations?.[normalizedSlot]?.sourcePath || "").trim();
  const compatValue = String(db?.config?.integrations?.[normalizedSlot]?.sourcePath || "").trim();

  if (persistedValue) {
    if (hasExistingIntegrationSourcePath(persistedValue, { baseDir })) {
      return persistedValue;
    }
    if (compatValue && hasExistingIntegrationSourcePath(compatValue, { baseDir })) {
      return compatValue;
    }
    return persistedValue;
  }

  return compatValue;
}

function createDefaultDbState({
  appConfig,
  createDefaultIntegrationState,
  createOnboardModeState,
  createOnboardAccessGrantState,
  normalizeCharacterCatalog,
}) {
  return {
    config: {
      welcomePanel: {
        channelId: appConfig.channels.welcomeChannelId,
        messageId: "",
      },
      botHelperPanel: {
        channelId: "",
        messageId: "",
        lastSentAt: "",
      },
      nonGgsPanel: {
        channelId: appConfig.channels.welcomeChannelId,
        messageId: "",
      },
      tierlistBoard: {
        text: {
          channelId: appConfig.channels.tierlistChannelId || "",
          messageIdSummary: "",
          messageIdPages: "",
        },
        graphic: {
          channelId: appConfig.channels.tierlistChannelId || "",
          messageId: "",
          lastUpdated: null,
        },
      },
      generatedRoles: {
        characters: {},
        characterLabels: {},
        tiers: {},
      },
      integrations: createDefaultIntegrationState(),
      onboardMode: createOnboardModeState(),
      accessGrant: typeof createOnboardAccessGrantState === "function"
        ? createOnboardAccessGrantState()
        : { mode: "after_submit", changedAt: null, changedBy: "" },
      autonomyGuard: createAutonomyGuardState({}),
      characters: normalizeCharacterCatalog(appConfig.characters),
    },
    profiles: {},
    submissions: {},
  };
}

function createDbStore({
  dbPath,
  dataRoot,
  appConfig,
  fileConfig,
  defaultGraphicTierColors,
  normalizeCharacterCatalog,
  createDefaultIntegrationState,
  createOnboardModeState,
  createOnboardAccessGrantState,
  ensurePresentationConfig,
  createPresentationDefaults,
  normalizeRoleGrantRegistry,
  normalizeIntegrationState,
  normalizeComboGuideEditorRoleIds,
  importDormantEloSyncFromFile,
  importDormantTierlistSyncFromFile,
  syncSharedProfiles,
  dualWriteSotState,
  syncSotState,
  persistence,
}) {
  if (!dbPath) throw new Error("dbPath is required");

  // Pluggable persistence adapter. Defaults to the JSON file backend so all
  // existing behavior (and tests) is unchanged; a SQLite adapter can be
  // injected without touching the normalization logic below.
  const persistenceAdapter = persistence || {
    readRaw: () => loadJsonFile(dbPath, undefined),
    writeSync: (workingDb) => saveJsonFile(dbPath, workingDb),
    writeAsync: (workingDb) => saveJsonFileAsync(dbPath, workingDb),
  };

  function load() {
    const fallback = createDefaultDbState({
      appConfig,
      createDefaultIntegrationState,
      createOnboardModeState,
      createOnboardAccessGrantState,
      normalizeCharacterCatalog,
    });

    const raw = persistenceAdapter.readRaw();
    const db = (raw === undefined || raw === null) ? fallback : raw;
    db.config ||= {};
    const migrated = ensurePresentationConfig(db.config, {
      defaults: createPresentationDefaults(fileConfig, { defaultGraphicTierColors }),
      defaultWelcomeChannelId: appConfig.channels.welcomeChannelId,
      defaultBotHelperChannelId: "",
      defaultTextTierlistChannelId: appConfig.channels.tierlistChannelId || "",
      defaultGraphicTierColors,
    });
    db.profiles ||= {};
    db.submissions ||= {};
    db.cooldowns ||= {};
    const roleGrantRegistry = normalizeRoleGrantRegistry(db.roleGrantMessages);
    db.roleGrantMessages = roleGrantRegistry.registry;
    db.config.notificationChannelId = String(db.config.notificationChannelId || "").trim();
    db.config.reviewChannelId = String(db.config.reviewChannelId || "").trim();
    const normalizedOnboardMode = createOnboardModeState(db.config.onboardMode);
    const onboardModeChanged = JSON.stringify(normalizedOnboardMode) !== JSON.stringify(db.config.onboardMode || null);
    db.config.onboardMode = normalizedOnboardMode;
    const normalizedAccessGrant = typeof createOnboardAccessGrantState === "function"
      ? createOnboardAccessGrantState(db.config.accessGrant)
      : { mode: "after_submit", changedAt: null, changedBy: "" };
    const accessGrantChanged = JSON.stringify(normalizedAccessGrant) !== JSON.stringify(db.config.accessGrant || null);
    db.config.accessGrant = normalizedAccessGrant;
    const normalizedAutonomyGuard = createAutonomyGuardState(db.config.autonomyGuard);
    const autonomyGuardChanged = JSON.stringify(normalizedAutonomyGuard) !== JSON.stringify(db.config.autonomyGuard || null);
    db.config.autonomyGuard = normalizedAutonomyGuard;
    const normalizedIntegrations = normalizeIntegrationState(db.config.integrations);
    const integrationsChanged = normalizedIntegrations.mutated;
    db.config.integrations = normalizedIntegrations.integrations;
    const normalizedStoredCharacters = normalizeCharacterCatalog(db.config.characters);
    const runtimeCharacters = normalizeCharacterCatalog(appConfig.characters);
    const charactersChanged = JSON.stringify(Array.isArray(db.config.characters) ? db.config.characters : []) !== JSON.stringify(normalizedStoredCharacters);
    const rawComboGuide = db.comboGuide;
    const normalizedComboGuide = normalizeComboGuideState(rawComboGuide, normalizeComboGuideEditorRoleIds);
    const comboGuideChanged = Boolean(rawComboGuide && typeof rawComboGuide === "object" && !Array.isArray(rawComboGuide))
      && JSON.stringify(normalizedComboGuide) !== JSON.stringify(rawComboGuide);
    if (normalizedComboGuide && typeof normalizedComboGuide === "object" && !Array.isArray(normalizedComboGuide)) {
      db.comboGuide = normalizedComboGuide;
    }
    db.config.characters = normalizedStoredCharacters;
    const dormantEloImport = importDormantEloSyncFromFile(db, {
      sourcePath: getResolvedIntegrationSourcePathFromState(db, "elo", { baseDir: dataRoot }),
      baseDir: dataRoot,
      syncedAt: new Date().toISOString(),
    });
    if (dormantEloImport.error) {
      console.warn(`dormant ELO import skipped: ${dormantEloImport.error}`);
    }
    const dormantTierlistImport = importDormantTierlistSyncFromFile(db, {
      sourcePath: getResolvedIntegrationSourcePathFromState(db, "tierlist", { baseDir: dataRoot }),
      baseDir: dataRoot,
      syncedAt: new Date().toISOString(),
      characterCatalog: (runtimeCharacters.length ? runtimeCharacters : normalizedStoredCharacters)
        .map((entry) => ({ id: entry.id, label: entry.label })),
    });
    if (dormantTierlistImport.error) {
      console.warn(`dormant Tierlist import skipped: ${dormantTierlistImport.error}`);
    }
    const sharedProfiles = syncSharedProfiles(db);
    const sotState = typeof syncSotState === "function" ? syncSotState(db) : { mutated: false };
    db.__needsSaveAfterLoad = migrated.mutated
      || charactersChanged
      || roleGrantRegistry.mutated
      || comboGuideChanged
      || onboardModeChanged
      || accessGrantChanged
      || autonomyGuardChanged
      || integrationsChanged
      || Boolean(dormantEloImport.mutated)
      || Boolean(dormantTierlistImport.mutated)
      || sharedProfiles.mutated
      || Boolean(sotState?.mutated);
    return db;
  }

  // Build the normalized snapshot that should be persisted. All mutations
  // happen on an isolated clone so a downstream failure (SoT dual-write or the
  // disk write itself) never leaks half-applied state into the live `db`.
  function prepareWriteState(db) {
    // Isolation clone so a failed write never leaks half-normalized state into the
    // live db. Two subtrees dominate the byte size — `profiles` (~3MB) and
    // `sot.activity` (~8MB) — and NEITHER is mutated in place on this path:
    // syncSharedProfiles REPLACES workingDb.profiles with a freshly-built object,
    // and the activity tree is only read + re-serialized (normalizeActivityState
    // returns an already-normalized tree by reference). So we deep-clone every
    // OTHER subtree and share just those two by reference, turning the old ~83ms
    // event-loop stall on every flush into ~4ms. Top-level and sot key order are
    // preserved so the persisted output stays byte-identical to a full clone.
    const source = db && typeof db === "object" && !Array.isArray(db) ? db : {};
    const workingDb = {};
    for (const key of Object.keys(source)) {
      if (key === "profiles") {
        workingDb.profiles = source.profiles;
      } else if (key === "sot" && source.sot && typeof source.sot === "object" && !Array.isArray(source.sot)) {
        const sot = {};
        for (const sotKey of Object.keys(source.sot)) {
          sot[sotKey] = sotKey === "activity" ? source.sot.activity : cloneValue(source.sot[sotKey]);
        }
        workingDb.sot = sot;
      } else {
        workingDb[key] = cloneValue(source[key]);
      }
    }

    syncSharedProfiles(workingDb);
    ensurePresentationConfig(workingDb.config, {
      defaults: createPresentationDefaults(fileConfig, { defaultGraphicTierColors }),
      defaultWelcomeChannelId: appConfig.channels.welcomeChannelId,
      defaultBotHelperChannelId: "",
      defaultTextTierlistChannelId: appConfig.channels.tierlistChannelId || "",
      defaultGraphicTierColors,
    });
    workingDb.config.autonomyGuard = createAutonomyGuardState(workingDb.config.autonomyGuard);
    workingDb.config.integrations = normalizeIntegrationState(workingDb.config.integrations).integrations;
    if (workingDb.comboGuide && typeof workingDb.comboGuide === "object" && !Array.isArray(workingDb.comboGuide)) {
      workingDb.comboGuide = normalizeComboGuideState(workingDb.comboGuide, normalizeComboGuideEditorRoleIds);
    }
    const dualWriteState = typeof dualWriteSotState === "function"
      ? dualWriteSotState(workingDb)
      : { mutated: false, writtenSlots: [] };
    if (typeof syncSotState === "function") syncSotState(workingDb);
    delete workingDb.__needsSaveAfterLoad;

    return { workingDb, dualWriteState };
  }

  // Synchronous persist. Retained for process-exit flushing and for callers
  // that need a durable write before returning. Blocks the event loop while
  // serializing/writing, so the hot path uses saveAsync instead.
  function save(db) {
    const { workingDb, dualWriteState } = prepareWriteState(db);

    try {
      persistenceAdapter.writeSync(workingDb);
    } catch (error) {
      db.__needsSaveAfterLoad = true;
      throw error;
    }

    replaceObjectContents(db, workingDb);

    return {
      db,
      dbPath,
      dualWriteState,
    };
  }

  // Async persist used by the coalesced write-behind flush. prepareWriteState
  // (clone + normalize) is synchronous; the serialize+write is awaited off the
  // event loop (and the serialize itself yields cooperatively).
  async function saveAsync(db) {
    const prepareStart = process.hrtime.bigint();
    const { workingDb, dualWriteState } = prepareWriteState(db);

    // Apply the normalized snapshot to the live db NOW, synchronously, BEFORE the
    // (cooperative, multi-yield) serialize — not after the write like the sync
    // path. prepareWriteState clones the non-shared subtrees, so if we wrote that
    // pre-serialize snapshot back AFTER the serialize, any mutation that landed
    // during the serialize's yields (e.g. a tournament match tap) would be
    // clobbered — a real "my pick vanished" data loss that the long cooperative
    // serialize would make routine. Applying first makes db and workingDb share
    // references, so the serialize sees live state and concurrent mutations are
    // preserved (persisted now or on the next flush). The only trade vs. before:
    // if the disk write then fails, the normalized (idempotent) state is already
    // in memory — harmless, and re-persisted on the retry.
    replaceObjectContents(db, workingDb);
    const prepareMs = Number(process.hrtime.bigint() - prepareStart) / 1e6;

    let writeMeta = null;
    try {
      writeMeta = await persistenceAdapter.writeAsync(workingDb);
    } catch (error) {
      db.__needsSaveAfterLoad = true;
      throw error;
    }

    const serializeMs = Number(writeMeta?.serializeMs) || 0;
    // Longest uninterrupted on-CPU slice of the serialize. With the cooperative
    // serializer this is a few ms (it yields), vs. `serializeMs` which is the
    // total wall time. `blockMs` is the figure that actually matters for event-loop
    // health; `syncBlockMs` stays wall-based so the host's heavy-flush backoff
    // (which limits CPU churn, not loop lag) is unchanged.
    const serializeBlockMs = Number(writeMeta?.serializeBlockMs) || serializeMs;
    return {
      db,
      dbPath,
      dualWriteState,
      prepareMs,
      serializeMs,
      serializeBlockMs,
      // Total synchronous on-CPU footprint of this flush (clone + serialize wall).
      syncBlockMs: prepareMs + serializeMs,
      // Worst contiguous event-loop block this flush actually caused.
      blockMs: prepareMs + serializeBlockMs,
      bytes: Number(writeMeta?.bytes) || 0,
    };
  }

  return {
    load,
    save,
    saveAsync,
  };
}

module.exports = {
  createDbStore,
  createDefaultDbState,
  getResolvedIntegrationSourcePathFromState,
  loadJsonFile,
  saveJsonFile,
  saveJsonFileAsync,
};
