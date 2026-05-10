"use strict";

const { createEmptyActivityState, normalizeActivityState } = require("../activity/state");
const { getCharacterAliasNames } = require("./character-aliases");
const { buildHistoricalManagedCharacterRoleIds } = require("./recovery/plan");

const SOT_VERSION = 1;
const SOT_SOURCES = new Set(["manual", "configured", "recovered", "alias", "name", "discovered", "default"]);
const CHANNEL_SLOTS = [
  "welcome",
  "review",
  "tierlistText",
  "tierlistGraphic",
  "log",
  "eloSubmit",
  "eloGraphic",
  "tierlistDashboard",
  "tierlistSummary",
];
const DEFAULT_INFLUENCE = {
  default: 1,
  tiers: {
    1: 2,
    2: 2.5,
    3: 3,
    4: 3.5,
    5: 4,
  },
};
const PANEL_MESSAGE_SLOTS = {
  welcome: ["main"],
  nonGgs: ["main"],
  tierlistText: ["main", "summary", "pages"],
  tierlistGraphic: ["main"],
  eloSubmit: ["main"],
  eloGraphic: ["main"],
  tierlistDashboard: ["main"],
  tierlistSummary: ["main"],
};

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function normalizeNullableString(value, limit = 2000) {
  const text = cleanString(value, limit);
  return text || null;
}

function normalizeSource(value, fallback = "default") {
  const source = cleanString(value, 40);
  return SOT_SOURCES.has(source) ? source : fallback;
}

function normalizeRecord(value, fallbackSource = "default") {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const normalizedValue = cleanString(value.value, 2000);
    if (!normalizedValue) return null;
    const normalized = {
      value: normalizedValue,
      source: normalizeSource(value.source, fallbackSource),
      verifiedAt: normalizeNullableString(value.verifiedAt, 80),
    };
    if (value.evidence && typeof value.evidence === "object" && !Array.isArray(value.evidence)) {
      normalized.evidence = clone(value.evidence);
    }
    if (Array.isArray(value.history) && value.history.length) {
      normalized.history = clone(value.history);
    }
    return normalized;
  }

  const text = cleanString(value, 2000);
  if (!text) return null;
  return {
    value: text,
    source: normalizeSource(fallbackSource, "default"),
    verifiedAt: null,
  };
}

function createRecord(value, source = "default", options = {}) {
  const record = normalizeRecord({
    value,
    source,
    verifiedAt: options.verifiedAt || null,
    evidence: options.evidence,
    history: options.history,
  }, source);
  return record;
}

function normalizeCharacterRecord(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const id = cleanString(source.id, 120);
  if (!id) return null;
  const normalized = {
    id,
    label: cleanString(source.label, 200) || id,
    englishLabel: cleanString(source.englishLabel, 200) || cleanString(source.label, 200) || id,
    roleId: cleanString(source.roleId, 80),
    source: normalizeSource(source.source, "configured"),
    verifiedAt: normalizeNullableString(source.verifiedAt, 80),
    evidence: source.evidence && typeof source.evidence === "object" && !Array.isArray(source.evidence)
      ? clone(source.evidence)
      : undefined,
  };
  if (Array.isArray(source.history) && source.history.length) {
    normalized.history = clone(source.history);
  }
  return normalized;
}

function createCharacterRecord({ id, label, englishLabel, roleId = "", source = "configured", verifiedAt = null, evidence, history }) {
  return normalizeCharacterRecord({
    id,
    label,
    englishLabel,
    roleId,
    source,
    verifiedAt,
    evidence,
    history,
  });
}

function normalizePanelRecord(value, slots = ["main"]) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const messageIds = {};
  for (const slot of slots) {
    messageIds[slot] = normalizeRecord(source.messageIds?.[slot], "manual");
  }
  return {
    channelId: normalizeRecord(source.channelId, "manual"),
    messageIds,
    lastUpdated: normalizeNullableString(source.lastUpdated, 80),
  };
}

function createPanelRecord({ channelId = "", messageIds = {}, lastUpdated = null, source = "manual" } = {}, slots = ["main"]) {
  const normalizedMessageIds = {};
  for (const slot of slots) {
    normalizedMessageIds[slot] = createRecord(messageIds[slot], source);
  }
  return normalizePanelRecord({
    channelId: createRecord(channelId, source),
    messageIds: normalizedMessageIds,
    lastUpdated,
  }, slots);
}

function normalizeInfluence(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const tiers = {};
  for (const tier of [1, 2, 3, 4, 5]) {
    const raw = source.tiers?.[tier]
      ?? source.tiers?.[String(tier)]
      ?? source[tier]
      ?? source[String(tier)]
      ?? DEFAULT_INFLUENCE.tiers[tier];
    const next = Number(raw);
    tiers[tier] = Number.isFinite(next) && next > 0 ? next : DEFAULT_INFLUENCE.tiers[tier];
  }
  const defaultValue = Number(source.default);
  return {
    default: Number.isFinite(defaultValue) && defaultValue > 0 ? defaultValue : DEFAULT_INFLUENCE.default,
    tiers,
  };
}

function createEmptySotState() {
  const channels = {};
  for (const slot of CHANNEL_SLOTS) channels[slot] = null;

  const panels = {};
  for (const [slot, messageSlots] of Object.entries(PANEL_MESSAGE_SLOTS)) {
    panels[slot] = createPanelRecord({}, messageSlots);
  }

  return {
    sotVersion: SOT_VERSION,
    lastVerifiedAt: null,
    channels,
    roles: {
      moderator: null,
      accessNormal: null,
      accessWartime: null,
      accessNonJjs: null,
      verifyAccess: null,
      killTier: {
        1: null,
        2: null,
        3: null,
        4: null,
        5: null,
      },
      legacyEloTier: {
        1: null,
        2: null,
        3: null,
        4: null,
      },
    },
    characters: {},
    panels,
    presentation: {
      welcome: {},
      tierlist: {},
      nonGgs: {},
    },
    modes: {
      onboard: null,
    },
    integrations: {
      elo: {},
      roblox: {},
      tierlist: {},
      verification: {},
    },
    activity: createEmptyActivityState(),
    influence: normalizeInfluence(DEFAULT_INFLUENCE),
  };
}

function channelRecord(primaryValue, fallbackValue = "") {
  const primary = cleanString(primaryValue, 80);
  const fallback = cleanString(fallbackValue, 80);
  if (primary) {
    return createRecord(primary, fallback && primary === fallback ? "configured" : "manual");
  }
  if (fallback) {
    return createRecord(fallback, "configured");
  }
  return null;
}

function roleRecord(configuredValue, discoveredValue = "") {
  const configured = cleanString(configuredValue, 80);
  const discovered = cleanString(discoveredValue, 80);
  if (configured) return createRecord(configured, "configured");
  if (discovered) return createRecord(discovered, "discovered");
  return null;
}

function normalizeCharactersCatalog(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => ({
      id: cleanString(entry?.id, 120),
      label: cleanString(entry?.label, 200),
      roleId: cleanString(entry?.roleId, 80),
    }))
    .filter((entry) => entry.id);
}

function normalizeExcludedCharacterIds(value) {
  const values = Array.isArray(value) ? value : (value instanceof Set ? [...value] : []);
  return new Set(values.map((entry) => cleanString(entry, 120)).filter(Boolean));
}

function buildCharacterMap(dbConfig = {}, appConfig = {}, options = {}) {
  const entries = new Map();
  const configuredCharacters = normalizeCharactersCatalog(appConfig.characters);
  const historicalRoleIds = options.historicalRoleIds && typeof options.historicalRoleIds === "object"
    ? options.historicalRoleIds
    : {};

  function ensureEntry(id) {
    if (!entries.has(id)) {
      entries.set(id, {
        id,
        label: "",
        englishLabel: "",
        configuredRoleId: "",
        historicalRoleId: "",
        aliasNames: [],
      });
    }
    return entries.get(id);
  }

  for (const entry of configuredCharacters) {
    const target = ensureEntry(entry.id);
    target.label = target.label || entry.label;
    target.englishLabel = target.englishLabel || entry.label;
    target.configuredRoleId = target.configuredRoleId || entry.roleId;
    target.historicalRoleId = target.historicalRoleId || cleanString(historicalRoleIds[entry.id], 80);
    target.aliasNames = getCharacterAliasNames(entry.id);
  }

  const characters = {};
  for (const [id, entry] of entries.entries()) {
    const roleId = entry.configuredRoleId || entry.historicalRoleId || "";
    const aliasNames = Array.isArray(entry.aliasNames) ? entry.aliasNames : [];
    const evidence = {};
    if (entry.historicalRoleId) evidence.historicalRoleId = entry.historicalRoleId;
    if (aliasNames.length) evidence.aliasNames = aliasNames;
    characters[id] = createCharacterRecord({
      id,
      label: aliasNames[0] || entry.label || id,
      englishLabel: entry.englishLabel || entry.label || aliasNames[0] || id,
      roleId,
      source: entry.configuredRoleId ? "configured" : aliasNames.length ? "alias" : entry.historicalRoleId ? "recovered" : "configured",
      evidence: Object.keys(evidence).length ? evidence : undefined,
    });
  }
  return characters;
}

function buildPanelMap(dbConfig = {}) {
  const tierlistBoard = dbConfig.tierlistBoard && typeof dbConfig.tierlistBoard === "object" ? dbConfig.tierlistBoard : {};
  const tierlistText = tierlistBoard.text && typeof tierlistBoard.text === "object" ? tierlistBoard.text : {};
  const tierlistGraphic = tierlistBoard.graphic && typeof tierlistBoard.graphic === "object" ? tierlistBoard.graphic : {};
  const integrations = dbConfig.integrations && typeof dbConfig.integrations === "object" ? dbConfig.integrations : {};
  const eloIntegration = integrations.elo && typeof integrations.elo === "object" ? integrations.elo : {};
  const tierlistIntegration = integrations.tierlist && typeof integrations.tierlist === "object" ? integrations.tierlist : {};
  const hasSplitTextMessages = Boolean(cleanString(tierlistText.messageIdSummary, 80) || cleanString(tierlistText.messageIdPages, 80));

  return {
    welcome: createPanelRecord({
      channelId: dbConfig.welcomePanel?.channelId,
      messageIds: { main: dbConfig.welcomePanel?.messageId },
    }, PANEL_MESSAGE_SLOTS.welcome),
    nonGgs: createPanelRecord({
      channelId: dbConfig.nonGgsPanel?.channelId,
      messageIds: { main: dbConfig.nonGgsPanel?.messageId },
    }, PANEL_MESSAGE_SLOTS.nonGgs),
    tierlistText: createPanelRecord({
      channelId: tierlistText.channelId,
      messageIds: {
        main: hasSplitTextMessages ? "" : tierlistText.messageId,
        summary: tierlistText.messageIdSummary,
        pages: tierlistText.messageIdPages,
      },
    }, PANEL_MESSAGE_SLOTS.tierlistText),
    tierlistGraphic: createPanelRecord({
      channelId: tierlistGraphic.channelId,
      messageIds: { main: tierlistGraphic.messageId },
      lastUpdated: tierlistGraphic.lastUpdated,
    }, PANEL_MESSAGE_SLOTS.tierlistGraphic),
    eloSubmit: createPanelRecord({
      channelId: eloIntegration.submitPanel?.channelId,
      messageIds: { main: eloIntegration.submitPanel?.messageId },
    }, PANEL_MESSAGE_SLOTS.eloSubmit),
    eloGraphic: createPanelRecord({
      channelId: eloIntegration.graphicBoard?.channelId,
      messageIds: { main: eloIntegration.graphicBoard?.messageId },
      lastUpdated: eloIntegration.graphicBoard?.lastUpdated,
    }, PANEL_MESSAGE_SLOTS.eloGraphic),
    tierlistDashboard: createPanelRecord({
      channelId: tierlistIntegration.dashboard?.channelId,
      messageIds: { main: tierlistIntegration.dashboard?.messageId },
      lastUpdated: tierlistIntegration.dashboard?.lastUpdated,
    }, PANEL_MESSAGE_SLOTS.tierlistDashboard),
    tierlistSummary: createPanelRecord({
      channelId: tierlistIntegration.summary?.channelId,
      messageIds: { main: tierlistIntegration.summary?.messageId },
      lastUpdated: tierlistIntegration.summary?.lastUpdated,
    }, PANEL_MESSAGE_SLOTS.tierlistSummary),
  };
}

function buildIntegrationState(dbConfig = {}, appConfig = {}) {
  const integrations = dbConfig.integrations && typeof dbConfig.integrations === "object" ? dbConfig.integrations : {};
  const eloIntegration = integrations.elo && typeof integrations.elo === "object" ? integrations.elo : {};
  const robloxIntegration = integrations.roblox && typeof integrations.roblox === "object" ? integrations.roblox : {};
  const tierlistIntegration = integrations.tierlist && typeof integrations.tierlist === "object" ? integrations.tierlist : {};
  const verificationIntegration = integrations.verification && typeof integrations.verification === "object" ? integrations.verification : {};
  const appVerification = appConfig.verification && typeof appConfig.verification === "object" && !Array.isArray(appConfig.verification)
    ? appConfig.verification
    : {};

  const verificationStageTexts = appVerification.stageTexts && typeof appVerification.stageTexts === "object" && !Array.isArray(appVerification.stageTexts)
    ? appVerification.stageTexts
    : {};
  const verificationRiskRules = appVerification.riskRules && typeof appVerification.riskRules === "object" && !Array.isArray(appVerification.riskRules)
    ? appVerification.riskRules
    : {};
  const verificationDeadline = appVerification.deadline && typeof appVerification.deadline === "object" && !Array.isArray(appVerification.deadline)
    ? appVerification.deadline
    : {};
  const verificationEntryMessage = appVerification.entryMessage && typeof appVerification.entryMessage === "object" && !Array.isArray(appVerification.entryMessage)
    ? appVerification.entryMessage
    : {};

  return clone({
    elo: {
      sourcePath: cleanString(eloIntegration.sourcePath, 500),
      mode: cleanString(eloIntegration.mode, 40),
      status: cleanString(eloIntegration.status, 40),
      lastImportAt: normalizeNullableString(eloIntegration.lastImportAt, 80),
      lastSyncAt: normalizeNullableString(eloIntegration.lastSyncAt, 80),
      roleGrantEnabled: eloIntegration.roleGrantEnabled !== false,
      submitPanel: clone(eloIntegration.submitPanel || {}),
      graphicBoard: clone(eloIntegration.graphicBoard || {}),
    },
    roblox: clone(robloxIntegration || {}),
    tierlist: {
      sourcePath: cleanString(tierlistIntegration.sourcePath, 500),
      mode: cleanString(tierlistIntegration.mode, 40),
      status: cleanString(tierlistIntegration.status, 40),
      lastImportAt: normalizeNullableString(tierlistIntegration.lastImportAt, 80),
      lastSyncAt: normalizeNullableString(tierlistIntegration.lastSyncAt, 80),
      dashboard: clone(tierlistIntegration.dashboard || {}),
      summary: clone(tierlistIntegration.summary || {}),
    },
    verification: {
      enabled: Object.prototype.hasOwnProperty.call(verificationIntegration, "enabled")
        ? verificationIntegration.enabled === true
        : appVerification.enabled === true,
      status: cleanString(verificationIntegration.status, 40),
      mode: cleanString(verificationIntegration.mode, 40),
      callbackBaseUrl: cleanString(verificationIntegration.callbackBaseUrl || appVerification.callbackBaseUrl, 500),
      reportChannelId: cleanString(verificationIntegration.reportChannelId || appVerification.reportChannelId, 80),
      verificationChannelId: cleanString(verificationIntegration.verificationChannelId || appVerification.verificationChannelId, 80),
      lastSyncAt: normalizeNullableString(verificationIntegration.lastSyncAt, 80),
      stageTexts: clone({ ...verificationStageTexts, ...(verificationIntegration.stageTexts || {}) }),
      riskRules: clone({ ...verificationRiskRules, ...(verificationIntegration.riskRules || {}) }),
      deadline: clone({ ...verificationDeadline, ...(verificationIntegration.deadline || {}) }),
      entryMessage: clone({ ...verificationEntryMessage, ...(verificationIntegration.entryMessage || {}) }),
    },
  });
}

function buildPresentationState(dbConfig = {}, options = {}) {
  const next = clone(options.presentation || dbConfig.presentation || {
    welcome: {},
    tierlist: {},
    nonGgs: {},
  });

  next.welcome ||= {};
  next.tierlist ||= {};
  const canonicalNonGgs = next.nonGgs && typeof next.nonGgs === "object" && Object.keys(next.nonGgs).length
    ? next.nonGgs
    : null;
  next.nonGgs = clone(options.nonGgsPresentation || canonicalNonGgs || dbConfig.nonJjsUi || dbConfig.nonGgsUi || {});

  return next;
}

function buildInfluenceState(db = {}, options = {}) {
  return normalizeInfluence(options.influence || db?.sot?.influence || DEFAULT_INFLUENCE);
}

function migrateLegacyState(db = {}, options = {}) {
  const dbConfig = db && typeof db.config === "object" && !Array.isArray(db.config) ? db.config : {};
  const appConfig = options.appConfig && typeof options.appConfig === "object" ? options.appConfig : {};
  const historicalCharacterRoleIds = buildHistoricalManagedCharacterRoleIds({
    managedCharacters: appConfig.characters,
    profiles: db?.profiles,
    submissions: db?.submissions,
  });
  const appChannels = appConfig.channels && typeof appConfig.channels === "object" ? appConfig.channels : {};
  const appRoles = appConfig.roles && typeof appConfig.roles === "object" ? appConfig.roles : {};
  const tierlistBoard = dbConfig.tierlistBoard && typeof dbConfig.tierlistBoard === "object" ? dbConfig.tierlistBoard : {};
  const tierlistText = tierlistBoard.text && typeof tierlistBoard.text === "object" ? tierlistBoard.text : {};
  const tierlistGraphic = tierlistBoard.graphic && typeof tierlistBoard.graphic === "object" ? tierlistBoard.graphic : {};
  const integrations = dbConfig.integrations && typeof dbConfig.integrations === "object" ? dbConfig.integrations : {};
  const eloIntegration = integrations.elo && typeof integrations.elo === "object" ? integrations.elo : {};
  const tierlistIntegration = integrations.tierlist && typeof integrations.tierlist === "object" ? integrations.tierlist : {};
  const next = createEmptySotState();

  next.channels.welcome = channelRecord(dbConfig.welcomePanel?.channelId, appChannels.welcomeChannelId);
  next.channels.review = channelRecord(dbConfig.reviewChannelId, appChannels.reviewChannelId);
  next.channels.tierlistText = channelRecord(tierlistText.channelId, appChannels.tierlistChannelId);
  next.channels.tierlistGraphic = channelRecord(tierlistGraphic.channelId, appChannels.tierlistChannelId);
  next.channels.log = channelRecord(dbConfig.notificationChannelId, appChannels.logChannelId);
  next.channels.eloSubmit = channelRecord(eloIntegration.submitPanel?.channelId);
  next.channels.eloGraphic = channelRecord(eloIntegration.graphicBoard?.channelId);
  next.channels.tierlistDashboard = channelRecord(tierlistIntegration.dashboard?.channelId);
  next.channels.tierlistSummary = channelRecord(tierlistIntegration.summary?.channelId);

  next.roles.moderator = roleRecord(appRoles.moderatorRoleId);
  next.roles.accessNormal = roleRecord(appRoles.accessRoleId);
  next.roles.accessWartime = roleRecord(appRoles.wartimeAccessRoleId);
  next.roles.accessNonJjs = roleRecord(appRoles.nonGgsAccessRoleId || appRoles.nonJjsAccessRoleId);
  next.roles.verifyAccess = roleRecord(appRoles.verifyAccessRoleId);
  for (const tier of [1, 2, 3, 4, 5]) {
    next.roles.killTier[tier] = roleRecord(appRoles.killTierRoleIds?.[tier] || appRoles.killTierRoleIds?.[String(tier)], dbConfig.generatedRoles?.tiers?.[tier] || dbConfig.generatedRoles?.tiers?.[String(tier)]);
  }
  for (const tier of [1, 2, 3, 4]) {
    next.roles.legacyEloTier[tier] = roleRecord(appRoles.legacyEloTierRoleIds?.[tier] || appRoles.legacyEloTierRoleIds?.[String(tier)]);
  }

  next.characters = buildCharacterMap(dbConfig, appConfig, {
    excludedCharacterIds: options.legacyTierlistCustomCharacterIds,
    historicalRoleIds: historicalCharacterRoleIds,
  });
  next.panels = buildPanelMap(dbConfig);

  next.presentation = buildPresentationState(dbConfig, options);
  next.modes.onboard = createRecord(dbConfig.onboardMode?.value || dbConfig.onboardMode?.mode || "peace", "configured");
  next.integrations = buildIntegrationState(dbConfig, appConfig);
  next.influence = buildInfluenceState(db, options);
  next.lastVerifiedAt = normalizeNullableString(options.lastVerifiedAt, 80);

  return next;
}

function normalizeSotState(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const next = createEmptySotState();
  next.sotVersion = SOT_VERSION;
  next.lastVerifiedAt = normalizeNullableString(source.lastVerifiedAt, 80);

  for (const slot of CHANNEL_SLOTS) {
    next.channels[slot] = normalizeRecord(source.channels?.[slot], "configured");
  }

  next.roles.moderator = normalizeRecord(source.roles?.moderator, "configured");
  next.roles.accessNormal = normalizeRecord(source.roles?.accessNormal, "configured");
  next.roles.accessWartime = normalizeRecord(source.roles?.accessWartime, "configured");
  next.roles.accessNonJjs = normalizeRecord(source.roles?.accessNonJjs, "configured");
  next.roles.verifyAccess = normalizeRecord(source.roles?.verifyAccess, "configured");
  for (const tier of [1, 2, 3, 4, 5]) {
    next.roles.killTier[tier] = normalizeRecord(source.roles?.killTier?.[tier] || source.roles?.killTier?.[String(tier)], "configured");
  }
  for (const tier of [1, 2, 3, 4]) {
    next.roles.legacyEloTier[tier] = normalizeRecord(source.roles?.legacyEloTier?.[tier] || source.roles?.legacyEloTier?.[String(tier)], "configured");
  }

  const characters = source.characters && typeof source.characters === "object" && !Array.isArray(source.characters) ? source.characters : {};
  next.characters = Object.fromEntries(
    Object.entries(characters)
      .map(([id, record]) => [id, normalizeCharacterRecord({ id, ...(record || {}) })])
      .filter(([, record]) => Boolean(record))
  );

  for (const [slot, messageSlots] of Object.entries(PANEL_MESSAGE_SLOTS)) {
    next.panels[slot] = normalizePanelRecord(source.panels?.[slot], messageSlots);
  }

  next.presentation = clone(source.presentation && typeof source.presentation === "object" ? source.presentation : next.presentation);
  next.integrations = {
    ...clone(next.integrations),
    ...clone(source.integrations && typeof source.integrations === "object" ? source.integrations : {}),
  };
  next.activity = normalizeActivityState(source.activity);
  next.influence = normalizeInfluence(source.influence);
  next.modes.onboard = normalizeRecord(source.modes?.onboard, "configured");

  return next;
}

function shouldPreserveCharacterAcrossLegacyRefresh(record) {
  const source = cleanString(record?.source, 40);
  return record?.evidence?.nativeWriter === true
    || source === "manual"
    || source === "discovered"
    || source === "recovered"
    || source === "alias"
    || source === "name";
}

function shouldPreserveRoleAcrossLegacyRefresh(record) {
  const source = cleanString(record?.source, 40);
  return record?.evidence?.nativeWriter === true || source === "manual";
}

function mergeRolesAcrossLegacyRefresh(existingRoles = {}, refreshedRoles = {}) {
  const merged = clone(refreshedRoles && typeof refreshedRoles === "object" && !Array.isArray(refreshedRoles)
    ? refreshedRoles
    : {});
  const currentRoles = existingRoles && typeof existingRoles === "object" && !Array.isArray(existingRoles)
    ? existingRoles
    : {};
  const baseRoleSlots = ["moderator", "accessNormal", "accessWartime", "accessNonJjs", "verifyAccess"];

  for (const slot of baseRoleSlots) {
    const currentRecord = normalizeRecord(currentRoles?.[slot], "configured");
    if (!shouldPreserveRoleAcrossLegacyRefresh(currentRecord)) continue;
    merged[slot] = currentRecord;
  }

  for (const tier of [1, 2, 3, 4, 5]) {
    const currentRecord = normalizeRecord(currentRoles?.killTier?.[tier] || currentRoles?.killTier?.[String(tier)], "configured");
    if (!shouldPreserveRoleAcrossLegacyRefresh(currentRecord)) continue;
    merged.killTier ||= {};
    merged.killTier[tier] = currentRecord;
  }

  for (const tier of [1, 2, 3, 4]) {
    const currentRecord = normalizeRecord(currentRoles?.legacyEloTier?.[tier] || currentRoles?.legacyEloTier?.[String(tier)], "configured");
    if (!shouldPreserveRoleAcrossLegacyRefresh(currentRecord)) continue;
    merged.legacyEloTier ||= {};
    merged.legacyEloTier[tier] = currentRecord;
  }

  return normalizeSotState({ roles: merged }).roles;
}

function mergeCharactersAcrossLegacyRefresh(existingCharacters = {}, refreshedCharacters = {}) {
  const merged = { ...refreshedCharacters };
  const currentEntries = existingCharacters && typeof existingCharacters === "object" && !Array.isArray(existingCharacters)
    ? existingCharacters
    : {};

  for (const [characterId, record] of Object.entries(currentEntries)) {
    if (!shouldPreserveCharacterAcrossLegacyRefresh(record)) continue;
    merged[characterId] = normalizeCharacterRecord({ id: characterId, ...(record || {}) });
  }

  return Object.fromEntries(
    Object.entries(merged).filter(([, record]) => Boolean(record))
  );
}

function refreshSotStateFromLegacy(db = {}, options = {}) {
  const source = db && typeof db === "object" ? db : {};
  const existing = source.sot && typeof source.sot === "object" && !Array.isArray(source.sot)
    ? normalizeSotState(source.sot)
    : null;
  const refreshed = normalizeSotState(migrateLegacyState(source, {
    ...options,
    useLegacyCharacterCompat: false,
  }));

  if (existing?.characters) {
    refreshed.characters = mergeCharactersAcrossLegacyRefresh(existing.characters, refreshed.characters);
  }

  if (existing?.roles) {
    refreshed.roles = mergeRolesAcrossLegacyRefresh(existing.roles, refreshed.roles);
  }

  if (existing?.activity) {
    refreshed.activity = normalizeActivityState(existing.activity);
  }

  if (existing?.lastVerifiedAt && !options.lastVerifiedAt) {
    refreshed.lastVerifiedAt = existing.lastVerifiedAt;
  }

  return refreshed;
}

function ensureSotState(db = {}, options = {}) {
  const source = db && typeof db === "object" ? db : {};
  const existing = source.sot;
  if (options.refreshFromLegacy) {
    const refreshed = refreshSotStateFromLegacy(source, options);
    const mutated = JSON.stringify(existing || null) !== JSON.stringify(refreshed);
    source.sot = refreshed;
    return {
      sot: refreshed,
      mutated,
      migrated: !(existing && Number(existing.sotVersion) >= SOT_VERSION),
      refreshed: Boolean(existing && Number(existing.sotVersion) >= SOT_VERSION),
    };
  }

  if (existing && Number(existing.sotVersion) >= SOT_VERSION) {
    const normalized = normalizeSotState(existing);
    const mutated = JSON.stringify(existing) !== JSON.stringify(normalized);
    source.sot = normalized;
    return {
      sot: normalized,
      mutated,
      migrated: false,
    };
  }

  const next = migrateLegacyState(source, options);
  const mutated = JSON.stringify(existing || null) !== JSON.stringify(next);
  source.sot = next;
  return {
    sot: next,
    mutated,
    migrated: true,
  };
}

module.exports = {
  buildCharacterMap,
  buildInfluenceState,
  buildIntegrationState,
  buildPanelMap,
  buildPresentationState,
  CHANNEL_SLOTS,
  DEFAULT_INFLUENCE,
  PANEL_MESSAGE_SLOTS,
  SOT_VERSION,
  createEmptyActivityState,
  createCharacterRecord,
  createEmptySotState,
  createPanelRecord,
  createRecord,
  ensureSotState,
  migrateLegacyState,
  normalizeActivityState,
  normalizeCharacterRecord,
  normalizeInfluence,
  normalizePanelRecord,
  normalizeRecord,
  normalizeSotState,
  refreshSotStateFromLegacy,
};