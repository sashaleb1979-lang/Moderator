"use strict";

const { MessageFlags } = require("discord.js");
const {
  PROFILE_ACCESS_DENY_REASONS,
  normalizeProfileViewerTagRoleIds,
  resolveProfileAccess,
} = require("./access");
const {
  isProfileTriggerContent,
  resolveProfileMessageTarget,
} = require("./entry");
const {
  buildProfileHelperMessagePayload,
  buildProfilePayload,
} = require("./view");
const { buildProfileReadModel } = require("./model");

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function listMemberRoleMentions(member, limit = 6) {
  const roles = member?.roles?.cache;
  if (!roles?.values) return [];

  return [...roles.values()]
    .filter((role) => role && role.id !== member?.guild?.id)
    .sort((left, right) => (Number(right?.position) || 0) - (Number(left?.position) || 0))
    .slice(0, Math.max(1, Number(limit) || 1))
    .map((role) => `<@&${role.id}>`);
}

function createProfileOperator(options = {}) {
  function getProfileViewerTagRoleIds() {
    const raw = typeof options.getViewerTagRoleIds === "function"
      ? options.getViewerTagRoleIds()
      : options.viewerTagRoleIds;
    return normalizeProfileViewerTagRoleIds(raw);
  }

  function getProfileAccessDeniedText(access = {}) {
    if (access.denyReason === PROFILE_ACCESS_DENY_REASONS.DEAD_REQUESTER) {
      return "Профиль недоступен: у тебя сейчас activity bucket dead.";
    }

    if (access.denyReason === PROFILE_ACCESS_DENY_REASONS.VIEWER_TAG_REQUIRED) {
      return "Чужие профили доступны только участникам с серверным tag.";
    }

    return "Профиль сейчас недоступен.";
  }

  function buildProfileAccessDeniedPayload(access = {}) {
    return {
      content: getProfileAccessDeniedText(access),
      flags: MessageFlags.Ephemeral,
    };
  }

  function resolveProfileAccessForRequester({ requesterUserId = "", requesterMember = null, targetUserId = "" } = {}) {
    const requesterProfile = typeof options.getRequesterProfile === "function"
      ? options.getRequesterProfile(requesterUserId)
      : null;

    return resolveProfileAccess({
      requesterProfile,
      requesterMember,
      requesterUserId,
      targetUserId,
      viewerTagRoleIds: getProfileViewerTagRoleIds(),
      hasStaffBypass: Boolean(typeof options.hasStaffBypass === "function" && options.hasStaffBypass(requesterMember)),
    });
  }

  async function buildPrivateProfilePayload({
    targetUserId = "",
    targetUser = null,
    targetMember = null,
    isSelf = false,
    requesterUserId = "",
    view = "overview",
  } = {}) {
    const normalizedTargetUserId = cleanString(targetUserId, 80);
    const resolvedTargetMember = targetMember || await Promise.resolve(
      typeof options.fetchMember === "function" ? options.fetchMember(normalizedTargetUserId) : null
    ).catch(() => null);
    const resolvedTargetUser = targetUser
      || resolvedTargetMember?.user
      || await Promise.resolve(typeof options.fetchUser === "function" ? options.fetchUser(normalizedTargetUserId) : null).catch(() => null)
      || { id: normalizedTargetUserId, username: `User ${normalizedTargetUserId}` };
    const targetProfile = typeof options.getTargetProfile === "function"
      ? options.getTargetProfile(normalizedTargetUserId)
      : null;

    const readModel = buildProfileReadModel({
      guildId: cleanString(options.guildId, 80),
      userId: normalizedTargetUserId,
      requesterUserId,
      targetDisplayName: resolvedTargetMember?.displayName
        || (typeof options.getTargetDisplayName === "function" ? options.getTargetDisplayName(normalizedTargetUserId, targetProfile) : "")
        || resolvedTargetUser?.globalName
        || resolvedTargetUser?.username,
      roleMentions: listMemberRoleMentions(resolvedTargetMember),
      profile: targetProfile,
      pendingSubmission: typeof options.getPendingSubmissionForUser === "function"
        ? options.getPendingSubmissionForUser(normalizedTargetUserId)
        : null,
      latestSubmission: typeof options.getLatestSubmissionForUser === "function"
        ? options.getLatestSubmissionForUser(normalizedTargetUserId)
        : null,
      eloProfile: typeof options.getEloProfile === "function"
        ? options.getEloProfile(normalizedTargetUserId)
        : null,
      tierlistProfile: typeof options.getTierlistProfile === "function"
        ? options.getTierlistProfile(normalizedTargetUserId)
        : null,
      approvedEntries: typeof options.getApprovedEntries === "function"
        ? options.getApprovedEntries()
        : [],
      recentKillChange: typeof options.getRecentKillChangeForUser === "function"
        ? options.getRecentKillChangeForUser(normalizedTargetUserId)
        : null,
      comboGuideState: typeof options.getComboGuideState === "function"
        ? options.getComboGuideState()
        : null,
      isSelf,
    });

    return buildProfilePayload({
      readModel,
      view,
    });
  }

  async function resolveProfileMessageRequest(message) {
    if (!isProfileTriggerContent(message.content)) return null;

    const mentionUsers = [...message.mentions.users.values()].filter((user) => user && user.bot !== true);
    let replyTargetUserId = "";
    let replyTargetUser = null;

    if (!mentionUsers.length && message.reference?.messageId) {
      const reference = await message.fetchReference().catch(() => null);
      if (reference?.author && reference.author.bot !== true) {
        replyTargetUserId = reference.author.id;
        replyTargetUser = reference.author;
      }
    }

    const resolution = resolveProfileMessageTarget({
      requesterUserId: message.author.id,
      mentionUserIds: mentionUsers.map((user) => user.id),
      replyTargetUserId,
    });

    if (!resolution.ok) {
      return resolution;
    }

    return {
      ...resolution,
      targetUser: mentionUsers[0] || replyTargetUser || message.author,
    };
  }

  function buildProfileOpenHelperPayload(options = {}) {
    return buildProfileHelperMessagePayload(options);
  }

  return {
    buildProfileAccessDeniedPayload,
    buildProfileOpenHelperPayload,
    buildPrivateProfilePayload,
    getProfileAccessDeniedText,
    resolveProfileAccessForRequester,
    resolveProfileMessageRequest,
  };
}

module.exports = {
  createProfileOperator,
};