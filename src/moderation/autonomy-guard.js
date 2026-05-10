"use strict";

const AUTONOMY_GUARD_WARNING_BUCKET_KEYS = Object.freeze([
  "ownerMessageDeletes",
  "logMessageDeletes",
  "reviewMessageDeletes",
]);

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

module.exports = {
  AUTONOMY_GUARD_WARNING_BUCKET_KEYS,
  addAutonomyGuardIsolatedUserId,
  clearAutonomyGuardTargetUserId,
  createAutonomyGuardState,
  ensureAutonomyGuardState,
  isAutonomyGuardIsolatedUser,
  normalizeDiscordId,
  normalizeDiscordIdList,
  normalizeHexColor,
  normalizeProtectedRole,
  normalizeWarningCounters,
  removeAutonomyGuardIsolatedUserId,
  resolveAutonomyGuardPrimaryAdminUserId,
  setAutonomyGuardPrimaryAdminUserId,
  setAutonomyGuardProtectedRole,
  setAutonomyGuardTargetUserId,
};