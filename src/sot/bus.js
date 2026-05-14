"use strict";

const { EventEmitter } = require("node:events");

const { KILL_MILESTONE_SLOTS, KILL_TIER_SLOTS, LEGACY_ELO_TIER_SLOTS, normalizeSotState } = require("./schema");

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function isEqual(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function snapshotSotState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return normalizeSotState({});
  }
  return normalizeSotState(clone(value));
}

function pushChange(changes, domain, key, previousValue, nextValue) {
  if (isEqual(previousValue, nextValue)) return;
  changes.push({
    domain,
    key,
    oldValue: clone(previousValue ?? null),
    newValue: clone(nextValue ?? null),
  });
}

function collectSotChanges(previousState = {}, nextState = {}) {
  const previous = snapshotSotState(previousState);
  const next = snapshotSotState(nextState);
  const changes = [];

  for (const slot of Object.keys(next.channels || {})) {
    pushChange(changes, "channels", slot, previous.channels?.[slot], next.channels?.[slot]);
  }

  for (const slot of ["moderator", "accessNormal", "accessWartime", "accessNonJjs"]) {
    pushChange(changes, "roles", slot, previous.roles?.[slot], next.roles?.[slot]);
  }
  for (const tier of KILL_TIER_SLOTS) {
    pushChange(changes, "roles", `killTier.${tier}`, previous.roles?.killTier?.[tier], next.roles?.killTier?.[tier]);
  }
  for (const milestone of KILL_MILESTONE_SLOTS) {
    pushChange(changes, "roles", `killMilestone.${milestone}`, previous.roles?.killMilestone?.[milestone], next.roles?.killMilestone?.[milestone]);
  }
  for (const tier of LEGACY_ELO_TIER_SLOTS) {
    pushChange(changes, "roles", `legacyEloTier.${tier}`, previous.roles?.legacyEloTier?.[tier], next.roles?.legacyEloTier?.[tier]);
  }

  const characterIds = new Set([
    ...Object.keys(previous.characters || {}),
    ...Object.keys(next.characters || {}),
  ]);
  for (const characterId of [...characterIds].sort()) {
    pushChange(changes, "characters", characterId, previous.characters?.[characterId], next.characters?.[characterId]);
  }

  for (const slot of Object.keys(next.panels || {})) {
    pushChange(changes, "panels", slot, previous.panels?.[slot], next.panels?.[slot]);
  }

  for (const slot of Object.keys(next.presentation || {})) {
    pushChange(changes, "presentation", slot, previous.presentation?.[slot], next.presentation?.[slot]);
  }

  for (const slot of Object.keys(next.modes || {})) {
    pushChange(changes, "modes", slot, previous.modes?.[slot], next.modes?.[slot]);
  }

  for (const slot of Object.keys(next.integrations || {})) {
    pushChange(changes, "integrations", slot, previous.integrations?.[slot], next.integrations?.[slot]);
  }

  pushChange(changes, "influence", "config", previous.influence, next.influence);
  pushChange(changes, "meta", "lastVerifiedAt", previous.lastVerifiedAt, next.lastVerifiedAt);

  return changes;
}

function publishSotChanges(eventBus, { previousState = {}, nextState = {}, reason = "save" } = {}) {
  const changes = collectSotChanges(previousState, nextState);
  if (!eventBus || typeof eventBus.emit !== "function") return changes;

  for (const change of changes) {
    const event = { ...change, reason };
    eventBus.emit("change", event);
    eventBus.emit(`${change.domain}:change`, event);
  }

  if (changes.length) {
    eventBus.emit("batch", { reason, changes: clone(changes) });
  }

  return changes;
}

function createSotBus() {
  const bus = new EventEmitter();
  bus.publishChanges = (payload) => publishSotChanges(bus, payload);
  return bus;
}

module.exports = {
  collectSotChanges,
  createSotBus,
  publishSotChanges,
  snapshotSotState,
};