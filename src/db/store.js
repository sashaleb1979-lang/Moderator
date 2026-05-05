"use strict";

const fs = require("node:fs");
const path = require("node:path");

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
    fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf8");
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

function createDefaultDbState({
  appConfig,
  createDefaultIntegrationState,
  createOnboardModeState,
  normalizeCharacterCatalog,
}) {
  return {
    config: {
      welcomePanel: {
        channelId: appConfig.channels.welcomeChannelId,
        messageId: "",
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
}) {
  if (!dbPath) throw new Error("dbPath is required");

  function load() {
    const fallback = createDefaultDbState({
      appConfig,
      createDefaultIntegrationState,
      createOnboardModeState,
      normalizeCharacterCatalog,
    });

    const db = loadJsonFile(dbPath, fallback);
    db.config ||= {};
    const migrated = ensurePresentationConfig(db.config, {
      defaults: createPresentationDefaults(fileConfig, { defaultGraphicTierColors }),
      defaultWelcomeChannelId: appConfig.channels.welcomeChannelId,
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
    const normalizedIntegrations = normalizeIntegrationState(db.config.integrations);
    const integrationsChanged = normalizedIntegrations.mutated;
    db.config.integrations = normalizedIntegrations.integrations;
    const normalizedStoredCharacters = normalizeCharacterCatalog(db.config.characters);
    const runtimeCharacters = normalizeCharacterCatalog(appConfig.characters);
    const charactersChanged = JSON.stringify(Array.isArray(db.config.characters) ? db.config.characters : []) !== JSON.stringify(normalizedStoredCharacters);
    const comboGuideEditorRoleIds = normalizeComboGuideEditorRoleIds(db.comboGuide?.editorRoleIds);
    const comboGuideEditorRoleIdsChanged = Boolean(db.comboGuide && typeof db.comboGuide === "object") && (
      !Array.isArray(db.comboGuide.editorRoleIds)
      || JSON.stringify(comboGuideEditorRoleIds) !== JSON.stringify(db.comboGuide.editorRoleIds)
    );
    if (db.comboGuide && typeof db.comboGuide === "object") {
      db.comboGuide.editorRoleIds = comboGuideEditorRoleIds;
    }
    db.config.characters = normalizedStoredCharacters;
    const dormantEloImport = importDormantEloSyncFromFile(db, {
      sourcePath: db.config.integrations?.elo?.sourcePath,
      baseDir: dataRoot,
      syncedAt: new Date().toISOString(),
    });
    if (dormantEloImport.error) {
      console.warn(`dormant ELO import skipped: ${dormantEloImport.error}`);
    }
    const dormantTierlistImport = importDormantTierlistSyncFromFile(db, {
      sourcePath: db.config.integrations?.tierlist?.sourcePath,
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
      || comboGuideEditorRoleIdsChanged
      || onboardModeChanged
      || integrationsChanged
      || Boolean(dormantEloImport.mutated)
      || Boolean(dormantTierlistImport.mutated)
      || sharedProfiles.mutated
      || Boolean(sotState?.mutated);
    return db;
  }

  function save(db) {
    syncSharedProfiles(db);
    ensurePresentationConfig(db.config, {
      defaults: createPresentationDefaults(fileConfig, { defaultGraphicTierColors }),
      defaultWelcomeChannelId: appConfig.channels.welcomeChannelId,
      defaultTextTierlistChannelId: appConfig.channels.tierlistChannelId || "",
      defaultGraphicTierColors,
    });
    db.config.integrations = normalizeIntegrationState(db.config.integrations).integrations;
    const dualWriteState = typeof dualWriteSotState === "function"
      ? dualWriteSotState(db)
      : { mutated: false, writtenSlots: [] };
    if (typeof syncSotState === "function") syncSotState(db);
    delete db.__needsSaveAfterLoad;
    saveJsonFile(dbPath, db);

    return {
      db,
      dbPath,
      dualWriteState,
    };
  }

  return {
    load,
    save,
  };
}

module.exports = {
  createDbStore,
  createDefaultDbState,
  loadJsonFile,
  saveJsonFile,
};