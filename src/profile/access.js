"use strict";

const { normalizeActivityDomainState } = require("../integrations/shared-profile");

const PROFILE_ACCESS_DENY_REASONS = Object.freeze({
  DEAD_REQUESTER: "dead_requester",
  VIEWER_TAG_REQUIRED: "viewer_tag_required",
});

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function normalizeProfileViewerTagRoleIds(value, limit = 20) {
  const source = Array.isArray(value)
    ? value
    : cleanString(value, 4000).split(/[;,\n]/g);
  const normalized = [];
  const seen = new Set();

  for (const entry of source) {
    const roleId = cleanString(entry, 80);
    if (!roleId || seen.has(roleId)) continue;
    seen.add(roleId);
    normalized.push(roleId);
    if (normalized.length >= limit) break;
  }

  return normalized;
}

function hasProfileViewerTagRole(member, viewerTagRoleIds = []) {
  const normalizedRoleIds = normalizeProfileViewerTagRoleIds(viewerTagRoleIds);
  return normalizedRoleIds.some((roleId) => member?.roles?.cache?.has?.(roleId));
}

function isProfileRequesterDead(profile = null) {
  const activity = normalizeActivityDomainState(
    profile?.domains?.activity || profile?.activity || profile?.summary?.activity
  );

  return activity.desiredActivityRoleKey === "dead" || activity.appliedActivityRoleKey === "dead";
}

function resolveProfileAccess({
  requesterProfile = null,
  requesterMember = null,
  requesterUserId = "",
  targetUserId = "",
  viewerTagRoleIds = [],
  hasStaffBypass = false,
} = {}) {
  const normalizedRequesterUserId = cleanString(requesterUserId, 80);
  const normalizedTargetUserId = cleanString(targetUserId, 80) || normalizedRequesterUserId;
  const isSelf = normalizedRequesterUserId === normalizedTargetUserId;
  const isDeadRequester = isProfileRequesterDead(requesterProfile);
  const hasViewerTagRole = hasProfileViewerTagRole(requesterMember, viewerTagRoleIds);

  if (hasStaffBypass) {
    return {
      allowed: true,
      denyReason: null,
      isSelf,
      isDeadRequester,
      hasStaffBypass,
      hasViewerTagRole,
      requesterUserId: normalizedRequesterUserId,
      targetUserId: normalizedTargetUserId,
    };
  }

  if (isDeadRequester) {
    return {
      allowed: false,
      denyReason: PROFILE_ACCESS_DENY_REASONS.DEAD_REQUESTER,
      isSelf,
      isDeadRequester,
      hasStaffBypass,
      hasViewerTagRole,
      requesterUserId: normalizedRequesterUserId,
      targetUserId: normalizedTargetUserId,
    };
  }

  if (!isSelf && !hasViewerTagRole) {
    return {
      allowed: false,
      denyReason: PROFILE_ACCESS_DENY_REASONS.VIEWER_TAG_REQUIRED,
      isSelf,
      isDeadRequester,
      hasStaffBypass,
      hasViewerTagRole,
      requesterUserId: normalizedRequesterUserId,
      targetUserId: normalizedTargetUserId,
    };
  }

  return {
    allowed: true,
    denyReason: null,
    isSelf,
    isDeadRequester,
    hasStaffBypass,
    hasViewerTagRole,
    requesterUserId: normalizedRequesterUserId,
    targetUserId: normalizedTargetUserId,
  };
}

module.exports = {
  PROFILE_ACCESS_DENY_REASONS,
  hasProfileViewerTagRole,
  isProfileRequesterDead,
  normalizeProfileViewerTagRoleIds,
  resolveProfileAccess,
};