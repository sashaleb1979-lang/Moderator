"use strict";

const WELCOME_ROBLOX_IDENTITY_LOCK_TEXT = "Roblox username уже подтверждён. В welcome-панели его можно только добавить, если он ещё не указан. Изменить может только админ.";

function hasConfirmedRobloxIdentity(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return Boolean(String(source.robloxUsername || "").trim() && String(source.robloxUserId || "").trim());
}

function canManageWelcomeRobloxIdentity(value = {}) {
  const state = value && typeof value === "object" ? value : {};
  if (state.canManage === true) return true;
  return !hasConfirmedRobloxIdentity(state.session) && !hasConfirmedRobloxIdentity(state.pending);
}

function getWelcomeRobloxIdentityLockText(value = {}) {
  return canManageWelcomeRobloxIdentity(value) ? null : WELCOME_ROBLOX_IDENTITY_LOCK_TEXT;
}

module.exports = {
  WELCOME_ROBLOX_IDENTITY_LOCK_TEXT,
  canManageWelcomeRobloxIdentity,
  getWelcomeRobloxIdentityLockText,
  hasConfirmedRobloxIdentity,
};