"use strict";

const { resolveUsableVerifiedRobloxIdentity } = require("../integrations/shared-profile");

const WELCOME_ROBLOX_IDENTITY_LOCK_TEXT = "Roblox username уже подтверждён. В welcome-панели его можно только добавить, если он ещё не указан. Изменить может только админ.";

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

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

function buildProfileRobloxIdentitySession(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const usableIdentity = resolveUsableVerifiedRobloxIdentity(source);

  return {
    robloxUsername: cleanString(source.robloxUsername ?? source.currentUsername ?? source.username, 120),
    robloxUserId: usableIdentity?.userId || "",
    robloxDisplayName: cleanString(source.robloxDisplayName ?? source.currentDisplayName ?? source.displayName, 120),
  };
}

module.exports = {
  buildProfileRobloxIdentitySession,
  WELCOME_ROBLOX_IDENTITY_LOCK_TEXT,
  canManageWelcomeRobloxIdentity,
  getWelcomeRobloxIdentityLockText,
  hasConfirmedRobloxIdentity,
};