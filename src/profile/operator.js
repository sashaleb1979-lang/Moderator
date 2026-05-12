"use strict";

const { MessageFlags } = require("discord.js");
const {
  PROFILE_ACCESS_DENY_REASONS,
  normalizeProfileViewerTagRoleIds,
  resolveProfileAccess,
} = require("./access");
const {
  PROFILE_TARGET_RESOLUTION_REASONS,
  isProfileTriggerContent,
  parseProfileNavCustomId,
  parseProfileOpenCustomId,
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

function resolveUserAvatarUrl(user = null) {
  if (!user || typeof user !== "object") return null;

  try {
    if (typeof user.displayAvatarURL === "function") {
      return cleanString(user.displayAvatarURL({ extension: "png", size: 512 }), 2000) || null;
    }
    if (typeof user.avatarURL === "function") {
      return cleanString(user.avatarURL({ extension: "png", size: 512 }), 2000) || null;
    }
  } catch {
    return null;
  }

  return cleanString(user.displayAvatarURL || user.avatarURL, 2000) || null;
}

function createProfileOperator(options = {}) {
  function hasStaffBypass(member = null) {
    return Boolean(typeof options.hasStaffBypass === "function" && options.hasStaffBypass(member));
  }

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
      hasStaffBypass: hasStaffBypass(requesterMember),
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
    const memberUser = resolvedTargetMember?.user || null;
    const fetchedTargetUser = targetUser || await Promise.resolve(
      typeof options.fetchUser === "function" ? options.fetchUser(normalizedTargetUserId) : null
    ).catch(() => null);
    const resolvedTargetUser = targetUser
      || fetchedTargetUser
      || memberUser
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
      targetAvatarUrl: resolveUserAvatarUrl(resolvedTargetUser),
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

  async function handleProfileMessage({
    message,
    accessMember = null,
    replyAndDelete,
    scheduleDeleteMessage = null,
    helperDeleteMs = 0,
  } = {}) {
    if (typeof replyAndDelete !== "function") {
      throw new TypeError("replyAndDelete must be a function");
    }

    const profileRequest = await resolveProfileMessageRequest(message);
    if (!profileRequest) return false;

    if (!profileRequest.ok) {
      if (profileRequest.reason === PROFILE_TARGET_RESOLUTION_REASONS.AMBIGUOUS_MENTION) {
        await replyAndDelete(message, "Укажи только одного участника: один mention, либо reply, либо просто `профиль`.");
      }
      return true;
    }

    const resolvedAccessMember = accessMember
      || message?.member?.roles?.cache
      || !message?.author?.id
      ? accessMember || message?.member || null
      : await Promise.resolve(typeof options.fetchMember === "function" ? options.fetchMember(message.author.id) : null).catch(() => null);
    const access = resolveProfileAccessForRequester({
      requesterUserId: message?.author?.id,
      requesterMember: resolvedAccessMember,
      targetUserId: profileRequest.targetUserId,
    });

    if (!access.allowed) {
      await replyAndDelete(message, getProfileAccessDeniedText(access));
      return true;
    }

    const helperReply = await message.reply(buildProfileOpenHelperPayload({
      requesterUserId: message.author.id,
      targetUserId: profileRequest.targetUserId,
      isSelf: access.isSelf,
      targetLabel: profileRequest.targetUser?.username || (access.isSelf ? "свой профиль" : `<@${profileRequest.targetUserId}>`),
    })).catch(() => null);

    if (helperReply && typeof scheduleDeleteMessage === "function") {
      scheduleDeleteMessage(helperReply, helperDeleteMs);
    }

    return true;
  }

  async function handleProfileSlashCommand({
    interaction,
    checkActorGuard = null,
  } = {}) {
    const commandName = cleanString(options.commandName || "профиль", 80);
    if (cleanString(interaction?.commandName, 80) !== commandName) {
      return false;
    }

    if (typeof checkActorGuard === "function" && await checkActorGuard(interaction)) {
      return true;
    }

    const targetUser = interaction.options.getUser("target") || interaction.user;
    const access = resolveProfileAccessForRequester({
      requesterUserId: interaction.user.id,
      requesterMember: interaction.member,
      targetUserId: targetUser.id,
    });

    if (!access.allowed) {
      await interaction.reply(buildProfileAccessDeniedPayload(access));
      return true;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await interaction.editReply(await buildPrivateProfilePayload({
      targetUserId: targetUser.id,
      targetUser,
      isSelf: access.isSelf,
      requesterUserId: interaction.user.id,
    }));
    return true;
  }

  async function handleProfileButtonInteraction({
    interaction,
    checkActorGuard = null,
    deleteSourceMessage = true,
  } = {}) {
    const profileButtonRequest = parseProfileOpenCustomId(interaction?.customId);
    if (profileButtonRequest) {
      if (typeof checkActorGuard === "function" && await checkActorGuard(interaction)) {
        return true;
      }

      if (interaction?.user?.id !== profileButtonRequest.requesterUserId && !hasStaffBypass(interaction?.member)) {
        await interaction.reply({ content: "Эта кнопка не для тебя.", flags: MessageFlags.Ephemeral });
        return true;
      }

      const access = resolveProfileAccessForRequester({
        requesterUserId: interaction.user.id,
        requesterMember: interaction.member,
        targetUserId: profileButtonRequest.targetUserId,
      });

      if (!access.allowed) {
        await interaction.reply(buildProfileAccessDeniedPayload(access));
        return true;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await interaction.editReply(await buildPrivateProfilePayload({
        targetUserId: profileButtonRequest.targetUserId,
        isSelf: access.isSelf,
        requesterUserId: interaction.user.id,
      }));
      if (deleteSourceMessage && typeof interaction?.message?.delete === "function") {
        await interaction.message.delete().catch(() => {});
      }
      return true;
    }

    const profileNavRequest = parseProfileNavCustomId(interaction?.customId);
    if (!profileNavRequest) {
      return false;
    }

    if (interaction?.user?.id !== profileNavRequest.requesterUserId && !hasStaffBypass(interaction?.member)) {
      await interaction.reply({ content: "Эта навигация не для тебя.", flags: MessageFlags.Ephemeral });
      return true;
    }

    const access = resolveProfileAccessForRequester({
      requesterUserId: interaction.user.id,
      requesterMember: interaction.member,
      targetUserId: profileNavRequest.targetUserId,
    });

    if (!access.allowed) {
      await interaction.reply(buildProfileAccessDeniedPayload(access));
      return true;
    }

    await interaction.update(await buildPrivateProfilePayload({
      targetUserId: profileNavRequest.targetUserId,
      isSelf: access.isSelf,
      requesterUserId: interaction.user.id,
      view: profileNavRequest.view,
    }));
    return true;
  }

  return {
    buildProfileAccessDeniedPayload,
    buildProfileOpenHelperPayload,
    buildPrivateProfilePayload,
    getProfileAccessDeniedText,
    handleProfileButtonInteraction,
    handleProfileMessage,
    handleProfileSlashCommand,
    resolveProfileAccessForRequester,
    resolveProfileMessageRequest,
  };
}

module.exports = {
  createProfileOperator,
};