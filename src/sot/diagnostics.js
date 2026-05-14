"use strict";

const { buildManagedCharacterRoleRecoveryPlan, normalizeManagedCharacterCatalog } = require("./recovery/plan");
const { resolveAllCharacterRecords } = require("./resolver/characters");
const { resolveAllChannelRecords } = require("./resolver/channels");
const { resolveAllIntegrationRecords } = require("./resolver/integrations");
const { resolveAllPanelRecords } = require("./resolver/panels");
const { resolveAllRoleRecords } = require("./resolver/roles");
const { KILL_MILESTONE_SLOTS, KILL_TIER_SLOTS, LEGACY_ELO_TIER_SLOTS, PANEL_MESSAGE_SLOTS } = require("./schema");

function cleanString(value, limit = 200) {
  return String(value || "").trim().slice(0, limit);
}

function getDbConfig(db = {}) {
  return db && typeof db.config === "object" && !Array.isArray(db.config) ? db.config : {};
}

function toIdSet(value) {
  if (value instanceof Set) {
    return new Set([...value].map((entry) => cleanString(entry, 80)).filter(Boolean));
  }
  if (Array.isArray(value)) {
    return new Set(value.map((entry) => cleanString(entry, 80)).filter(Boolean));
  }
  return new Set();
}

function normalizeGuildRoles(guildRoles = []) {
  const out = [];
  const seen = new Set();

  for (const role of Array.isArray(guildRoles) ? guildRoles : []) {
    const id = cleanString(role?.id, 80);
    const name = cleanString(role?.name, 120);
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name,
      memberUserIds: Array.isArray(role?.memberUserIds)
        ? role.memberUserIds.map((userId) => cleanString(userId, 80)).filter(Boolean)
        : [],
    });
  }

  return out;
}

function createGuildSnapshot(snapshot = {}) {
  return {
    channelIds: toIdSet(snapshot?.channelIds),
    roleIds: toIdSet(snapshot?.roleIds),
    guildRoles: normalizeGuildRoles(snapshot?.guildRoles),
    verifiedAt: cleanString(snapshot?.verifiedAt, 80) || null,
  };
}

function getManagedCharacters({ db = {}, appConfig = {}, managedCharacters } = {}) {
  if (Array.isArray(managedCharacters) && managedCharacters.length) {
    return normalizeManagedCharacterCatalog(managedCharacters);
  }
  const persistedCatalog = Array.isArray(getDbConfig(db).characters) ? getDbConfig(db).characters : [];
  const configuredCatalog = Array.isArray(appConfig?.characters) ? appConfig.characters : [];
  return normalizeManagedCharacterCatalog([
    ...configuredCatalog,
    ...persistedCatalog,
  ]);
}

function hasEntries(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return false;
}

function normalizeRecoveryPlan(plan = {}) {
  return {
    recoveredRoleIds: plan && typeof plan.recoveredRoleIds === "object" ? plan.recoveredRoleIds : {},
    recoveredRoleLabels: plan && typeof plan.recoveredRoleLabels === "object" ? plan.recoveredRoleLabels : {},
    ambiguous: Array.isArray(plan?.ambiguous) ? plan.ambiguous : [],
    unresolved: Array.isArray(plan?.unresolved) ? plan.unresolved : [],
    analysisByCharacterId: plan && typeof plan.analysisByCharacterId === "object" ? plan.analysisByCharacterId : {},
  };
}

function getExistsStatus(value, ids) {
  const normalizedValue = cleanString(value, 80);
  if (!normalizedValue) return null;
  if (!(ids instanceof Set) || !ids.size) return null;
  return ids.has(normalizedValue);
}

function getEntryStatus(value, exists) {
  if (!cleanString(value, 80)) return "missing";
  if (exists === true) return "ok";
  if (exists === false) return "stale";
  return "unverified";
}

function flattenRoleEntries(roleRecords = {}) {
  return [
    { slot: "moderator", record: roleRecords.moderator },
    { slot: "accessNormal", record: roleRecords.accessNormal },
    { slot: "accessWartime", record: roleRecords.accessWartime },
    { slot: "accessNonJjs", record: roleRecords.accessNonJjs },
    ...KILL_TIER_SLOTS.map((tier) => ({ slot: `killTier.${tier}`, record: roleRecords.killTier?.[tier] || null })),
    ...KILL_MILESTONE_SLOTS.map((milestone) => ({ slot: `killMilestone.${milestone}`, record: roleRecords.killMilestone?.[milestone] || null })),
    ...LEGACY_ELO_TIER_SLOTS.map((tier) => ({ slot: `legacyEloTier.${tier}`, record: roleRecords.legacyEloTier?.[tier] || null })),
  ];
}

function diagnoseChannels({ db = {}, appConfig = {}, snapshot = createGuildSnapshot() } = {}) {
  const entries = Object.entries(resolveAllChannelRecords({ db, appConfig })).map(([slot, record]) => {
    const exists = getExistsStatus(record?.value, snapshot.channelIds);
    return {
      slot,
      value: cleanString(record?.value, 80),
      source: cleanString(record?.source, 40) || null,
      verifiedAt: cleanString(record?.verifiedAt, 80) || null,
      exists,
      status: getEntryStatus(record?.value, exists),
    };
  });

  return {
    entries,
    configuredCount: entries.filter((entry) => entry.value).length,
    liveCount: entries.filter((entry) => entry.exists === true).length,
  };
}

function diagnoseRoles({ db = {}, appConfig = {}, snapshot = createGuildSnapshot() } = {}) {
  const entries = flattenRoleEntries(resolveAllRoleRecords({ db, appConfig })).map(({ slot, record }) => {
    const exists = getExistsStatus(record?.value, snapshot.roleIds);
    return {
      slot,
      value: cleanString(record?.value, 80),
      source: cleanString(record?.source, 40) || null,
      verifiedAt: cleanString(record?.verifiedAt, 80) || null,
      exists,
      status: getEntryStatus(record?.value, exists),
    };
  });

  return {
    entries,
    configuredCount: entries.filter((entry) => entry.value).length,
    liveCount: entries.filter((entry) => entry.exists === true).length,
  };
}

function diagnoseCharacters({
  db = {},
  appConfig = {},
  snapshot = createGuildSnapshot(),
  managedCharacters,
  profiles,
  submissions,
  recoveryPlan,
} = {}) {
  const catalog = getManagedCharacters({ db, appConfig, managedCharacters });
  const dbConfig = getDbConfig(db);
  const generatedRoleIds = dbConfig.generatedRoles?.characters && typeof dbConfig.generatedRoles.characters === "object"
    ? dbConfig.generatedRoles.characters
    : {};

  let nextRecoveryPlan = normalizeRecoveryPlan(recoveryPlan);
  if (!recoveryPlan && (hasEntries(profiles) || hasEntries(submissions) || snapshot.guildRoles.length)) {
    nextRecoveryPlan = normalizeRecoveryPlan(buildManagedCharacterRoleRecoveryPlan({
      managedCharacters: catalog,
      profiles,
      submissions,
      guildRoles: snapshot.guildRoles,
      historicalRoleIds: {},
      generatedRoleIds,
    }));
  }

  const records = resolveAllCharacterRecords({
    db,
    appConfig,
    managedCharacters: catalog,
    profiles,
    submissions,
    guildRoles: snapshot.guildRoles,
    verifiedRoleIds: snapshot.roleIds,
    verifiedAt: snapshot.verifiedAt,
    recoveryPlan: nextRecoveryPlan,
  });
  const ambiguousIds = new Set(nextRecoveryPlan.ambiguous.map((entry) => cleanString(entry?.characterId, 120)).filter(Boolean));
  const unresolvedIds = new Set(nextRecoveryPlan.unresolved.map((entry) => cleanString(entry?.characterId, 120)).filter(Boolean));
  const entries = Object.values(records)
    .map((record) => {
      const exists = getExistsStatus(record?.roleId, snapshot.roleIds);
      let status = getEntryStatus(record?.roleId, exists);
      if (unresolvedIds.has(record.id)) status = "unresolved";
      else if (ambiguousIds.has(record.id)) status = "ambiguous";

      return {
        id: record.id,
        label: record.label,
        englishLabel: record.englishLabel,
        roleId: cleanString(record.roleId, 80),
        source: cleanString(record.source, 40) || null,
        verifiedAt: cleanString(record.verifiedAt, 80) || null,
        exists,
        status,
        evidence: record.evidence,
      };
    })
    .sort((left, right) => String(left.label || left.id || "").localeCompare(String(right.label || right.id || ""), "ru"));

  return {
    entries,
    total: entries.length,
    runtimeBound: entries.filter((entry) => entry.roleId).length,
    staleCount: entries.filter((entry) => entry.status === "stale").length,
    ambiguousCount: entries.filter((entry) => entry.status === "ambiguous").length,
    unresolvedCount: entries.filter((entry) => entry.status === "unresolved").length,
    recoveredCount: Object.keys(nextRecoveryPlan.recoveredRoleIds).length,
  };
}

function diagnosePanels({ db = {}, appConfig = {} } = {}) {
  const panels = resolveAllPanelRecords({ db, appConfig });
  const entries = Object.entries(PANEL_MESSAGE_SLOTS).map(([slot, messageSlots]) => {
    const panel = panels[slot] && typeof panels[slot] === "object" ? panels[slot] : {};
    const channelId = cleanString(panel.channelId?.value || panel.channelId, 80);
    const messageIds = Object.fromEntries(
      messageSlots.map((messageSlot) => [messageSlot, cleanString(panel.messageIds?.[messageSlot]?.value || panel.messageIds?.[messageSlot], 80)])
    );
    return {
      slot,
      channelId,
      messageIds,
      lastUpdated: cleanString(panel.lastUpdated, 80) || null,
      tracked: Boolean(channelId || Object.values(messageIds).some(Boolean)),
    };
  });

  return {
    entries,
    trackedCount: entries.filter((entry) => entry.tracked).length,
  };
}

function normalizeIntegrationPanelSnapshot(snapshot = {}) {
  const channelId = cleanString(snapshot?.channelId, 80);
  const messageId = cleanString(snapshot?.messageId, 80);

  return {
    channelId,
    messageId,
    lastUpdated: cleanString(snapshot?.lastUpdated, 80) || null,
    tracked: Boolean(channelId || messageId),
  };
}

function diagnoseIntegrations({ db = {}, appConfig = {} } = {}) {
  const integrations = resolveAllIntegrationRecords({ db, appConfig });
  const entries = ["elo", "tierlist"].map((slot) => {
    const integration = integrations[slot] && typeof integrations[slot] === "object" ? integrations[slot] : {};
    const submitPanel = normalizeIntegrationPanelSnapshot(integration.submitPanel);
    const graphicBoard = normalizeIntegrationPanelSnapshot(integration.graphicBoard);
    const dashboard = normalizeIntegrationPanelSnapshot(integration.dashboard);
    const summary = normalizeIntegrationPanelSnapshot(integration.summary);

    return {
      slot,
      status: cleanString(integration.status, 40) || "not_started",
      mode: cleanString(integration.mode, 40) || "",
      sourcePath: cleanString(integration.sourcePath, 500) || "",
      lastImportAt: cleanString(integration.lastImportAt, 80) || null,
      lastSyncAt: cleanString(integration.lastSyncAt, 80) || null,
      roleGrantEnabled: integration.roleGrantEnabled !== false,
      submitPanel,
      graphicBoard,
      dashboard,
      summary,
    };
  });

  return {
    entries,
    trackedPanelCount: entries.reduce((total, entry) => total + [
      entry.submitPanel,
      entry.graphicBoard,
      entry.dashboard,
      entry.summary,
    ].filter((snapshot) => snapshot?.tracked).length, 0),
  };
}

function diagnoseSotState({
  db = {},
  appConfig = {},
  guildSnapshot = {},
  managedCharacters,
  profiles,
  submissions,
  recoveryPlan,
} = {}) {
  const snapshot = createGuildSnapshot(guildSnapshot);
  const channels = diagnoseChannels({ db, appConfig, snapshot });
  const roles = diagnoseRoles({ db, appConfig, snapshot });
  const characters = diagnoseCharacters({
    db,
    appConfig,
    snapshot,
    managedCharacters,
    profiles,
    submissions,
    recoveryPlan,
  });
  const panels = diagnosePanels({ db, appConfig });
  const integrations = diagnoseIntegrations({ db, appConfig });

  return {
    channels,
    roles,
    characters,
    panels,
    integrations,
    summary: {
      configuredChannels: channels.configuredCount,
      liveChannels: channels.liveCount,
      configuredRoles: roles.configuredCount,
      liveRoles: roles.liveCount,
      boundCharacters: characters.runtimeBound,
      totalCharacters: characters.total,
      staleCharacters: characters.staleCount,
      ambiguousCharacters: characters.ambiguousCount,
      unresolvedCharacters: characters.unresolvedCount,
      recoveredCharacters: characters.recoveredCount,
      trackedPanels: panels.trackedCount,
      trackedIntegrationPanels: integrations.trackedPanelCount,
    },
  };
}

module.exports = {
  createGuildSnapshot,
  diagnoseChannels,
  diagnoseCharacters,
  diagnoseIntegrations,
  diagnosePanels,
  diagnoseRoles,
  diagnoseSotState,
};