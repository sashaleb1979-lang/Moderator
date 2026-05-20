"use strict";

const { resolveUsableVerifiedRobloxIdentity } = require("../integrations/shared-profile");

const WELCOME_ROBLOX_IDENTITY_LOCK_TEXT = "Roblox username уже подтверждён. В welcome-панели его можно только добавить, если он ещё не указан. Изменить может только админ.";

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function hasOwn(source, key) {
  return Boolean(source) && Object.prototype.hasOwnProperty.call(source, key);
}

function hasRobloxSpecificIdentityFields(source = {}) {
  return [
    "robloxUsername",
    "currentUsername",
    "robloxUserId",
    "currentDisplayName",
    "robloxDisplayName",
    "hasVerifiedAccount",
    "verificationStatus",
    "status",
    "robloxProfileUrl",
    "profileUrl",
    "robloxAvatarUrl",
    "avatarUrl",
  ].some((key) => hasOwn(source, key));
}

function normalizeRobloxUsernameInput(value) {
  const username = cleanString(value, 120);
  return /^[A-Za-z0-9_]{3,20}$/.test(username) ? username : "";
}

function normalizeRobloxProfileUserId(value) {
  const text = cleanString(value, 2000);
  if (!text) return "";

  let parsed = null;
  try {
    parsed = new URL(text);
  } catch {
    return "";
  }

  const hostname = cleanString(parsed.hostname, 120).toLowerCase();
  if (!["roblox.com", "www.roblox.com", "m.roblox.com", "web.roblox.com"].includes(hostname)) {
    return "";
  }

  const match = parsed.pathname.match(/^\/users\/(\d+)\/profile\/?$/i);
  return match ? match[1] : "";
}

function parseRobloxIdentityInput(value) {
  const text = cleanString(value, 2000);
  if (!text) {
    return {
      ok: false,
      error: "Укажи Roblox username, userId или ссылку на профиль.",
    };
  }

  const profileUserId = normalizeRobloxProfileUserId(text);
  if (profileUserId) {
    return {
      ok: true,
      kind: "userId",
      userId: profileUserId,
      source: "profile_url",
      rawInput: text,
    };
  }

  const username = normalizeRobloxUsernameInput(text);
  if (username) {
    const fallbackUserId = /^\d+$/.test(username) ? username : "";
    return {
      ok: true,
      kind: "username",
      username,
      fallbackUserId,
      source: fallbackUserId ? "username_or_userId" : "username",
      rawInput: text,
    };
  }

  if (/^\d{1,20}$/.test(text)) {
    return {
      ok: true,
      kind: "userId",
      userId: text,
      source: "user_id",
      rawInput: text,
    };
  }

  return {
    ok: false,
    error: "Укажи Roblox username (3-20 символов, буквы, цифры или _), numeric userId или ссылку на профиль.",
  };
}

function hasConfirmedRobloxIdentity(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return Boolean(String(source.robloxUsername || "").trim() && String(source.robloxUserId || "").trim());
}

function canManageWelcomeRobloxIdentity(value = {}) {
  void value;
  return true;
}

function getWelcomeRobloxIdentityLockText(value = {}) {
  void value;
  return null;
}

function buildProfileRobloxIdentitySession(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  if (!hasRobloxSpecificIdentityFields(source)) {
    return {
      robloxUsername: "",
      robloxUserId: "",
      robloxDisplayName: "",
    };
  }

  const usableIdentity = resolveUsableVerifiedRobloxIdentity(source);
  if (!usableIdentity) {
    return {
      robloxUsername: "",
      robloxUserId: "",
      robloxDisplayName: "",
    };
  }

  return {
    robloxUsername: cleanString(usableIdentity.username, 120),
    robloxUserId: usableIdentity.userId,
    robloxDisplayName: cleanString(usableIdentity.displayName, 120),
  };
}

module.exports = {
  buildProfileRobloxIdentitySession,
  normalizeRobloxUsernameInput,
  parseRobloxIdentityInput,
  WELCOME_ROBLOX_IDENTITY_LOCK_TEXT,
  canManageWelcomeRobloxIdentity,
  getWelcomeRobloxIdentityLockText,
  hasConfirmedRobloxIdentity,
};