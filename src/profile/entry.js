"use strict";

const PROFILE_TRIGGER_KEYWORD = "профиль";
const PROFILE_OPEN_BUTTON_PREFIX = "profile_open:";
const PROFILE_NAV_BUTTON_PREFIX = "profile_nav:";
const PROFILE_TARGET_RESOLUTION_REASONS = Object.freeze({
  AMBIGUOUS_MENTION: "ambiguous_mention",
});

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function normalizeProfileTriggerText(value) {
  return cleanString(value, 2000)
    .replace(/<@!?\d+>/g, " ")
    .replace(/[.,!?;:()\[\]{}"'`~]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isProfileTriggerContent(value) {
  return normalizeProfileTriggerText(value) === PROFILE_TRIGGER_KEYWORD;
}

function normalizeUserIdArray(value, limit = 10) {
  if (!Array.isArray(value)) return [];
  const normalized = [];
  const seen = new Set();

  for (const entry of value) {
    const userId = cleanString(entry, 80);
    if (!userId || seen.has(userId)) continue;
    seen.add(userId);
    normalized.push(userId);
    if (normalized.length >= limit) break;
  }

  return normalized;
}

function resolveProfileMessageTarget({ requesterUserId = "", mentionUserIds = [], replyTargetUserId = "" } = {}) {
  const normalizedRequesterUserId = cleanString(requesterUserId, 80);
  const normalizedMentionUserIds = normalizeUserIdArray(mentionUserIds);
  const normalizedReplyTargetUserId = cleanString(replyTargetUserId, 80);

  if (normalizedMentionUserIds.length > 1) {
    return {
      ok: false,
      reason: PROFILE_TARGET_RESOLUTION_REASONS.AMBIGUOUS_MENTION,
      targetUserId: "",
      isSelf: false,
    };
  }

  const targetUserId = normalizedMentionUserIds[0] || normalizedReplyTargetUserId || normalizedRequesterUserId;
  return {
    ok: true,
    reason: null,
    targetUserId,
    isSelf: targetUserId === normalizedRequesterUserId,
  };
}

function buildProfileOpenCustomId(requesterUserId = "", targetUserId = "") {
  return `${PROFILE_OPEN_BUTTON_PREFIX}${cleanString(requesterUserId, 80)}:${cleanString(targetUserId, 80)}`;
}

function parseProfileOpenCustomId(value = "") {
  const normalized = cleanString(value, 200);
  if (!normalized.startsWith(PROFILE_OPEN_BUTTON_PREFIX)) return null;

  const raw = normalized.slice(PROFILE_OPEN_BUTTON_PREFIX.length);
  const [requesterUserId, targetUserId] = raw.split(":");
  const normalizedRequesterUserId = cleanString(requesterUserId, 80);
  const normalizedTargetUserId = cleanString(targetUserId, 80);
  if (!normalizedRequesterUserId || !normalizedTargetUserId) return null;

  return {
    requesterUserId: normalizedRequesterUserId,
    targetUserId: normalizedTargetUserId,
  };
}

function buildProfileNavCustomId(requesterUserId = "", targetUserId = "", view = "overview") {
  return `${PROFILE_NAV_BUTTON_PREFIX}${cleanString(requesterUserId, 80)}:${cleanString(targetUserId, 80)}:${cleanString(view, 40)}`;
}

function parseProfileNavCustomId(value = "") {
  const normalized = cleanString(value, 200);
  if (!normalized.startsWith(PROFILE_NAV_BUTTON_PREFIX)) return null;

  const raw = normalized.slice(PROFILE_NAV_BUTTON_PREFIX.length);
  const [requesterUserId, targetUserId, view] = raw.split(":");
  const normalizedRequesterUserId = cleanString(requesterUserId, 80);
  const normalizedTargetUserId = cleanString(targetUserId, 80);
  const normalizedView = cleanString(view, 40);
  if (!normalizedRequesterUserId || !normalizedTargetUserId || !normalizedView) return null;

  return {
    requesterUserId: normalizedRequesterUserId,
    targetUserId: normalizedTargetUserId,
    view: normalizedView,
  };
}

module.exports = {
  PROFILE_NAV_BUTTON_PREFIX,
  PROFILE_OPEN_BUTTON_PREFIX,
  PROFILE_TARGET_RESOLUTION_REASONS,
  PROFILE_TRIGGER_KEYWORD,
  buildProfileNavCustomId,
  buildProfileOpenCustomId,
  isProfileTriggerContent,
  normalizeProfileTriggerText,
  parseProfileNavCustomId,
  parseProfileOpenCustomId,
  resolveProfileMessageTarget,
};