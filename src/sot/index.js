"use strict";

const { collectSotChanges, createSotBus, publishSotChanges, snapshotSotState } = require("./bus");
const { diagnoseSotState } = require("./diagnostics");
const { buildLegacyComparableSot, compareSotVsLegacy } = require("./legacy-bridge/compare");
const { loadSotState, saveSotState, writeJsonAtomic } = require("./loader");
const { listCharacterRecords, resolveAllCharacterRecords, resolveCharacterRecord } = require("./resolver/characters");
const { getChannelValue, resolveAllChannelRecords, resolveChannelRecord } = require("./resolver/channels");
const { resolveInfluence, resolveLegacyInfluenceConfig, getInfluenceTierValue } = require("./resolver/influence");
const { INTEGRATION_SLOTS, resolveAllIntegrationRecords, resolveIntegrationRecord } = require("./resolver/integrations");
const { PANEL_SLOTS, resolveAllPanelRecords, resolvePanelRecord } = require("./resolver/panels");
const { PRESENTATION_SLOTS, resolveAllPresentations, resolvePresentation } = require("./resolver/presentation");
const { resolveAllRoleRecords, resolveKillTierRole, resolveLegacyEloTierRole, resolveRoleRecord } = require("./resolver/roles");
const {
  CHANNEL_SLOTS,
  DEFAULT_INFLUENCE,
  PANEL_MESSAGE_SLOTS,
  SOT_VERSION,
  createCharacterRecord,
  createEmptySotState,
  createPanelRecord,
  createRecord,
  ensureSotState,
  migrateLegacyState,
  normalizeCharacterRecord,
  normalizeInfluence,
  normalizePanelRecord,
  normalizeRecord,
  normalizeSotState,
} = require("./schema");

function getChannel(slot, context = {}) {
  return resolveChannelRecord({ slot, ...context });
}

function getRole(slot, context = {}) {
  return resolveRoleRecord({ slot, ...context });
}

function getKillTierRole(tier, context = {}) {
  return resolveKillTierRole({ tier, ...context });
}

function getLegacyEloTierRole(tier, context = {}) {
  return resolveLegacyEloTierRole({ tier, ...context });
}

function getCharacter(id, context = {}) {
  return resolveCharacterRecord({ characterId: id, ...context });
}

function listCharacters(context = {}) {
  return listCharacterRecords(context);
}

function getPanel(slot, context = {}) {
  return resolvePanelRecord({ slot, ...context });
}

function getPresentation(slot, context = {}) {
  return resolvePresentation({ slot, ...context });
}

function getIntegration(slot, context = {}) {
  return resolveIntegrationRecord({ slot, ...context });
}

function getInfluence(context = {}) {
  return resolveInfluence(context);
}

function getLegacyInfluenceConfig(context = {}) {
  return resolveLegacyInfluenceConfig(context);
}

function diagnose(context = {}) {
  return diagnoseSotState(context);
}

function compareWithLegacy(context = {}) {
  return compareSotVsLegacy(context);
}

module.exports = {
  CHANNEL_SLOTS,
  DEFAULT_INFLUENCE,
  INTEGRATION_SLOTS,
  PANEL_MESSAGE_SLOTS,
  PANEL_SLOTS,
  PRESENTATION_SLOTS,
  SOT_VERSION,
  buildLegacyComparableSot,
  collectSotChanges,
  compareSotVsLegacy,
  createCharacterRecord,
  createEmptySotState,
  createSotBus,
  createPanelRecord,
  createRecord,
  compareWithLegacy,
  diagnose,
  diagnoseSotState,
  ensureSotState,
  getCharacter,
  getChannel,
  getChannelValue,
  getInfluence,
  getLegacyInfluenceConfig,
  getInfluenceTierValue,
  getIntegration,
  getKillTierRole,
  getLegacyEloTierRole,
  getPanel,
  getPresentation,
  listCharacters,
  getRole,
  loadSotState,
  migrateLegacyState,
  listCharacterRecords,
  normalizeCharacterRecord,
  normalizeInfluence,
  normalizePanelRecord,
  normalizeRecord,
  normalizeSotState,
  publishSotChanges,
  resolveAllCharacterRecords,
  resolveCharacterRecord,
  resolveAllChannelRecords,
  resolveAllIntegrationRecords,
  resolveAllPanelRecords,
  resolveAllPresentations,
  resolveAllRoleRecords,
  resolveChannelRecord,
  resolveInfluence,
  resolveIntegrationRecord,
  resolveLegacyInfluenceConfig,
  resolveKillTierRole,
  resolveLegacyEloTierRole,
  resolvePanelRecord,
  resolvePresentation,
  resolveRoleRecord,
  saveSotState,
  snapshotSotState,
  writeJsonAtomic,
};