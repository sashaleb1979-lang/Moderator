"use strict";

const AUTONOMY_GUARD_WARNING_BUCKET_KEYS = Object.freeze([
  "ownerMessageDeletes",
  "logMessageDeletes",
  "reviewMessageDeletes",
]);

const AUTONOMY_GUARD_MESSAGE_DELETE_KINDS = Object.freeze([
  "owner",
  "log",
  "review",
  "important",
]);

const AUTONOMY_GUARD_MESSAGE_DELETE_POLICIES = Object.freeze({
  owner: Object.freeze({ bucketKey: "ownerMessageDeletes", warningsBeforeStrip: 5, immediateStrip: false }),
  log: Object.freeze({ bucketKey: "logMessageDeletes", warningsBeforeStrip: 5, immediateStrip: false }),
  review: Object.freeze({ bucketKey: "reviewMessageDeletes", warningsBeforeStrip: 1, immediateStrip: false }),
  important: Object.freeze({ bucketKey: "", warningsBeforeStrip: 0, immediateStrip: true }),
});

function trimText(value, limit = 200) {
  return String(value || "").trim().slice(0, limit);
}

function normalizeDiscordId(value) {
  const text = trimText(value, 40);
  return /^\d{17,20}$/.test(text) ? text : "";
}

function normalizeHexColor(value) {
  const text = trimText(value, 32).replace(/^#/, "").toUpperCase();
  return /^[0-9A-F]{6}$/.test(text) ? `#${text}` : "";
}

function normalizeProtectedRole(rawValue = {}) {
  const source = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) ? rawValue : {};
  return {
    roleId: normalizeDiscordId(source.roleId),
    name: trimText(source.name, 100),
    color: normalizeHexColor(source.color),
  };
}

function createAutonomyGuardState(rawValue = {}) {
  const source = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) ? rawValue : {};
  return {
    primaryAdminUserId: normalizeDiscordId(source.primaryAdminUserId),
    targetUserId: normalizeDiscordId(source.targetUserId),
    protectedRole: normalizeProtectedRole(source.protectedRole),
    isolatedUserIds: normalizeDiscordIdList(source.isolatedUserIds, 50),
    warningCounters: normalizeWarningCounters(source.warningCounters),
  };
}

function ensureAutonomyGuardState(db) {
  if (!db || typeof db !== "object") {
    throw new TypeError("db must be an object");
  }

  db.config ||= {};
  db.config.autonomyGuard = createAutonomyGuardState(db.config.autonomyGuard);
  return db.config.autonomyGuard;
}

function normalizeWarningCounters(rawValue = {}) {
  const source = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) ? rawValue : {};
  const result = {};

  for (const [userId, value] of Object.entries(source)) {
    const normalizedUserId = normalizeDiscordId(userId);
    if (!normalizedUserId) continue;
    const bucketSource = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const normalizedBucket = {};

    for (const key of AUTONOMY_GUARD_WARNING_BUCKET_KEYS) {
      const numeric = Number(bucketSource[key]);
      normalizedBucket[key] = Number.isSafeInteger(numeric) && numeric > 0 ? numeric : 0;
    }

    result[normalizedUserId] = normalizedBucket;
  }

  return result;
}

function normalizeDiscordIdList(rawValue, limit = 50) {
  if (!Array.isArray(rawValue) || rawValue.length === 0) return [];
  return [...new Set(rawValue.map((value) => normalizeDiscordId(value)).filter(Boolean))].slice(0, limit);
}

function collectAutonomyGuardProtectedRoleIds(options = {}) {
  const source = options && typeof options === "object" && !Array.isArray(options) ? options : {};
  const collectedRoleIds = [];

  function pushRoleIds(value) {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const entry of value) pushRoleIds(entry);
      return;
    }
    if (typeof value === "object") {
      for (const entry of Object.values(value)) pushRoleIds(entry);
      return;
    }
    const normalizedRoleId = normalizeDiscordId(value);
    if (normalizedRoleId) collectedRoleIds.push(normalizedRoleId);
  }

  pushRoleIds(source.protectedRoleId);
  pushRoleIds(source.accessRoleIds);
  pushRoleIds(source.tierRoleIds);
  pushRoleIds(source.legacyEloTierRoleIds);
  pushRoleIds(source.characterRoleIds);
  pushRoleIds(source.activityRoleIds);
  pushRoleIds(source.activityAdminRoleIds);
  pushRoleIds(source.activityModeratorRoleIds);
  pushRoleIds(source.roleGrantRoleIds);
  pushRoleIds(source.extraRoleIds);

  return [...new Set(collectedRoleIds)];
}

function diffAutonomyGuardProtectedRoleIds(options = {}) {
  const source = options && typeof options === "object" && !Array.isArray(options) ? options : {};
  const protectedRoleIdSet = new Set(normalizeDiscordIdList(source.protectedRoleIds, 500));
  const previousRoleIdSet = new Set(normalizeDiscordIdList(source.previousRoleIds, 500));
  const nextRoleIdSet = new Set(normalizeDiscordIdList(source.nextRoleIds, 500));
  const addedRoleIds = [];
  const removedRoleIds = [];

  for (const roleId of protectedRoleIdSet) {
    if (!previousRoleIdSet.has(roleId) && nextRoleIdSet.has(roleId)) {
      addedRoleIds.push(roleId);
    }
    if (previousRoleIdSet.has(roleId) && !nextRoleIdSet.has(roleId)) {
      removedRoleIds.push(roleId);
    }
  }

  return {
    addedRoleIds,
    removedRoleIds,
    changedRoleIds: [...addedRoleIds, ...removedRoleIds],
    hasProtectedChanges: addedRoleIds.length > 0 || removedRoleIds.length > 0,
  };
}

function resolveAutonomyGuardPrimaryAdminUserId(db, appConfig = {}) {
  const fromConfig = normalizeDiscordId(appConfig?.moderation?.primaryAdminUserId);
  if (fromConfig) return fromConfig;
  return ensureAutonomyGuardState(db).primaryAdminUserId;
}

function setAutonomyGuardPrimaryAdminUserId(db, userId) {
  const state = ensureAutonomyGuardState(db);
  const normalizedUserId = normalizeDiscordId(userId);
  if (state.primaryAdminUserId === normalizedUserId) return false;
  state.primaryAdminUserId = normalizedUserId;
  return true;
}

function setAutonomyGuardProtectedRole(db, patch = {}) {
  const state = ensureAutonomyGuardState(db);
  const nextRole = normalizeProtectedRole({
    ...state.protectedRole,
    ...(patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {}),
  });
  if (JSON.stringify(state.protectedRole) === JSON.stringify(nextRole)) return false;
  state.protectedRole = nextRole;
  return true;
}

function setAutonomyGuardTargetUserId(db, userId) {
  const state = ensureAutonomyGuardState(db);
  const normalizedUserId = normalizeDiscordId(userId);
  if (state.targetUserId === normalizedUserId) return false;
  state.targetUserId = normalizedUserId;
  return true;
}

function clearAutonomyGuardTargetUserId(db) {
  return setAutonomyGuardTargetUserId(db, "");
}

function addAutonomyGuardIsolatedUserId(db, userId) {
  const state = ensureAutonomyGuardState(db);
  const normalizedUserId = normalizeDiscordId(userId);
  if (!normalizedUserId || state.isolatedUserIds.includes(normalizedUserId)) return false;
  state.isolatedUserIds = normalizeDiscordIdList([...state.isolatedUserIds, normalizedUserId], 50);
  return true;
}

function removeAutonomyGuardIsolatedUserId(db, userId) {
  const state = ensureAutonomyGuardState(db);
  const normalizedUserId = normalizeDiscordId(userId);
  if (!normalizedUserId || !state.isolatedUserIds.includes(normalizedUserId)) return false;
  state.isolatedUserIds = state.isolatedUserIds.filter((entry) => entry !== normalizedUserId);
  delete state.warningCounters[normalizedUserId];
  return true;
}

function isAutonomyGuardIsolatedUser(db, userId) {
  const normalizedUserId = normalizeDiscordId(userId);
  if (!normalizedUserId) return false;
  return ensureAutonomyGuardState(db).isolatedUserIds.includes(normalizedUserId);
}

function getAutonomyGuardMessageDeletePolicy(kind) {
  const normalizedKind = trimText(kind, 40).toLowerCase();
  return AUTONOMY_GUARD_MESSAGE_DELETE_POLICIES[normalizedKind] || null;
}

function classifyAutonomyGuardDeletedMessage(options = {}) {
  const source = options && typeof options === "object" && !Array.isArray(options) ? options : {};
  const ownerUserId = normalizeDiscordId(source.ownerUserId);
  const authorUserId = normalizeDiscordId(source.authorUserId);
  const channelId = normalizeDiscordId(source.channelId);
  const logChannelId = normalizeDiscordId(source.logChannelId);
  const messageId = normalizeDiscordId(source.messageId);
  const importantMessageIdSet = new Set(normalizeDiscordIdList(source.importantMessageIds, 500));
  const reviewMessageIdSet = new Set(normalizeDiscordIdList(source.reviewMessageIds, 500));

  if (messageId && importantMessageIdSet.has(messageId)) {
    return "important";
  }
  if (ownerUserId && authorUserId && ownerUserId === authorUserId) {
    return "owner";
  }
  if (messageId && reviewMessageIdSet.has(messageId)) {
    return "review";
  }
  if (source.authorIsBot === true && channelId && logChannelId && channelId === logChannelId) {
    return "log";
  }
  return "";
}

function incrementAutonomyGuardWarningCounter(db, userId, bucketKey) {
  const normalizedUserId = normalizeDiscordId(userId);
  if (!normalizedUserId || !AUTONOMY_GUARD_WARNING_BUCKET_KEYS.includes(bucketKey)) {
    return 0;
  }

  const state = ensureAutonomyGuardState(db);
  const currentBucket = state.warningCounters[normalizedUserId];
  const normalizedBucket = currentBucket && typeof currentBucket === "object" && !Array.isArray(currentBucket)
    ? normalizeWarningCounters({ [normalizedUserId]: currentBucket })[normalizedUserId]
    : normalizeWarningCounters({ [normalizedUserId]: {} })[normalizedUserId];

  normalizedBucket[bucketKey] += 1;
  state.warningCounters[normalizedUserId] = normalizedBucket;
  return normalizedBucket[bucketKey];
}

function resolveAutonomyGuardMessageDeleteDecision(kind, warningCount = 0) {
  const policy = getAutonomyGuardMessageDeletePolicy(kind);
  if (!policy) {
    return {
      action: "ignore",
      bucketKey: "",
      kind: "",
      warningCount: 0,
      warningsRemaining: 0,
      shouldStripAdmin: false,
    };
  }

  if (policy.immediateStrip) {
    return {
      action: "strip-admin",
      bucketKey: policy.bucketKey,
      kind: trimText(kind, 40).toLowerCase(),
      warningCount: 0,
      warningsRemaining: 0,
      shouldStripAdmin: true,
    };
  }

  const normalizedWarningCount = Math.max(0, Number(warningCount) || 0);
  const shouldStripAdmin = normalizedWarningCount > policy.warningsBeforeStrip;
  return {
    action: shouldStripAdmin ? "strip-admin" : "warn",
    bucketKey: policy.bucketKey,
    kind: trimText(kind, 40).toLowerCase(),
    warningCount: normalizedWarningCount,
    warningsRemaining: Math.max(policy.warningsBeforeStrip - normalizedWarningCount, 0),
    shouldStripAdmin,
  };
}

module.exports = {
  AUTONOMY_GUARD_MESSAGE_DELETE_KINDS,
  AUTONOMY_GUARD_MESSAGE_DELETE_POLICIES,
  AUTONOMY_GUARD_WARNING_BUCKET_KEYS,
  addAutonomyGuardIsolatedUserId,
  classifyAutonomyGuardDeletedMessage,
  clearAutonomyGuardTargetUserId,
  collectAutonomyGuardProtectedRoleIds,
  createAutonomyGuardState,
  diffAutonomyGuardProtectedRoleIds,
  ensureAutonomyGuardState,
  getAutonomyGuardMessageDeletePolicy,
  incrementAutonomyGuardWarningCounter,
  isAutonomyGuardIsolatedUser,
  normalizeDiscordId,
  normalizeDiscordIdList,
  normalizeHexColor,
  normalizeProtectedRole,
  normalizeWarningCounters,
  removeAutonomyGuardIsolatedUserId,
  resolveAutonomyGuardMessageDeleteDecision,
  resolveAutonomyGuardPrimaryAdminUserId,
  setAutonomyGuardPrimaryAdminUserId,
  setAutonomyGuardProtectedRole,
  setAutonomyGuardTargetUserId,
};