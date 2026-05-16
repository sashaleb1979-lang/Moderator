"use strict";

const { normalizeActivityDomainState } = require("../integrations/shared-profile");

const PROFILE_ACCESS_DENY_REASONS = Object.freeze({
  DEAD_REQUESTER: "dead_requester",
  VIEWER_TAG_REQUIRED: "viewer_tag_required",
});

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function getProfileViewerServerTag(user = null) {
  const primaryGuild = user?.primaryGuild;
  const tag = cleanString(primaryGuild?.tag, 16);
  if (!tag) return "";
  if (primaryGuild?.identityEnabled === false) return "";
  return tag;
}

function hasProfileViewerServerTag(user = null) {
  return Boolean(getProfileViewerServerTag(user));
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
  requesterUser = null,
  requesterUserId = "",
  targetUserId = "",
  hasViewerServerTag = null,
  hasStaffBypass = false,
} = {}) {
  const normalizedRequesterUserId = cleanString(requesterUserId, 80);
  const normalizedTargetUserId = cleanString(targetUserId, 80) || normalizedRequesterUserId;
  const isSelf = normalizedRequesterUserId === normalizedTargetUserId;
  const isDeadRequester = isProfileRequesterDead(requesterProfile);
  const requesterAccessUser = [requesterUser, requesterMember?.user]
    .filter((user) => user && typeof user === "object")
    .find((user) => hasProfileViewerServerTag(user))
    || requesterUser
    || requesterMember?.user
    || null;
  const requesterServerTag = getProfileViewerServerTag(requesterAccessUser);
  const resolvedHasViewerServerTag = typeof hasViewerServerTag === "boolean"
    ? hasViewerServerTag
    : Boolean(requesterServerTag);

  if (hasStaffBypass) {
    return {
      allowed: true,
      denyReason: null,
      isSelf,
      isDeadRequester,
      hasStaffBypass,
      hasViewerServerTag: resolvedHasViewerServerTag,
      requesterServerTag,
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
      hasViewerServerTag: resolvedHasViewerServerTag,
      requesterServerTag,
      requesterUserId: normalizedRequesterUserId,
      targetUserId: normalizedTargetUserId,
    };
  }

  if (!isSelf && !resolvedHasViewerServerTag) {
    return {
      allowed: false,
      denyReason: PROFILE_ACCESS_DENY_REASONS.VIEWER_TAG_REQUIRED,
      isSelf,
      isDeadRequester,
      hasStaffBypass,
      hasViewerServerTag: resolvedHasViewerServerTag,
      requesterServerTag,
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
    hasViewerServerTag: resolvedHasViewerServerTag,
    requesterServerTag,
    requesterUserId: normalizedRequesterUserId,
    targetUserId: normalizedTargetUserId,
  };
}

module.exports = {
  PROFILE_ACCESS_DENY_REASONS,
  getProfileViewerServerTag,
  hasProfileViewerServerTag,
  isProfileRequesterDead,
  resolveProfileAccess,
};