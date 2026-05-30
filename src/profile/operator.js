"use strict";

const { MessageFlags } = require("discord.js");
const { buildProfileRobloxIdentitySession } = require("../onboard/roblox-identity");
const { safeDeferComponentUpdate } = require("../runtime/interaction-ack");
const {
  PROFILE_ACCESS_DENY_REASONS,
  hasProfileViewerServerTag,
  resolveProfileAccess,
} = require("./access");
const {
  PROFILE_TARGET_RESOLUTION_REASONS,
  isProfileTriggerContent,
  parseProfileNavCustomId,
  parseProfileOpenCustomId,
  parseProfileRatingDetailCustomId,
  resolveProfileMessageTarget,
} = require("./entry");
const {
  buildProfileFallbackPayload,
  buildProfileHelperMessagePayload,
  buildProfilePayload,
  buildProfileRatingDetailPayload,
} = require("./view");
const { buildProfileReadModel } = require("./model");

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function normalizeHiddenRoleIds(values = []) {
  return new Set((Array.isArray(values) ? values : [])
    .map((entry) => cleanString(entry, 80))
    .filter(Boolean));
}

function listMemberRoleMentions(member, limit = 6, hiddenRoleIds = []) {
  const roles = member?.roles?.cache;
  if (!roles?.values) return [];
  const hiddenIds = normalizeHiddenRoleIds(hiddenRoleIds);

  return [...roles.values()]
    .filter((role) => role && role.id !== member?.guild?.id)
    .filter((role) => !hiddenIds.has(cleanString(role.id, 80)))
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

  function logProfileWarning(message = "") {
    if (typeof options.logWarning !== "function") return;
    options.logWarning(cleanString(message, 400));
  }

  async function resolveRequesterUserForAccess({ requesterUserId = "", requesterUser = null, requesterMember = null } = {}) {
    const candidateUsers = [requesterUser, requesterMember?.user].filter((user) => user && typeof user === "object");
    const seededUser = candidateUsers.find((user) => hasProfileViewerServerTag(user)) || candidateUsers[0] || null;

    if (hasProfileViewerServerTag(seededUser)) {
      return seededUser;
    }

    const normalizedRequesterUserId = cleanString(requesterUserId, 80);
    if (!normalizedRequesterUserId) {
      return seededUser;
    }

    const fetchAccessUser = typeof options.fetchAccessUser === "function"
      ? options.fetchAccessUser
      : (typeof options.fetchUser === "function" ? options.fetchUser : null);
    if (typeof fetchAccessUser !== "function") {
      return seededUser;
    }

    const fetchedUser = await Promise.resolve(fetchAccessUser(normalizedRequesterUserId, seededUser)).catch(() => null);
    return fetchedUser || seededUser;
  }

  async function resolveProfileAccessForRequester({ requesterUserId = "", requesterUser = null, requesterMember = null, targetUserId = "" } = {}) {
    const [requesterProfile, resolvedRequesterUser] = await Promise.all([
      Promise.resolve(typeof options.getRequesterProfile === "function"
        ? options.getRequesterProfile(requesterUserId)
        : null).catch(() => null),
      resolveRequesterUserForAccess({
        requesterUserId,
        requesterUser,
        requesterMember,
      }),
    ]);

    return resolveProfileAccess({
      requesterProfile,
      requesterMember,
      requesterUser: resolvedRequesterUser,
      requesterUserId,
      targetUserId,
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
    displayMode = "",
  } = {}) {
    const readModel = await buildPrivateProfileReadModel({
      targetUserId,
      targetUser,
      targetMember,
      isSelf,
      requesterUserId,
      displayMode,
    });

    return buildProfilePayload({
      readModel,
      requesterUserId,
      view,
      displayMode,
    });
  }

  async function rememberPrivateProfileSurface(interaction, replyMessage, { requesterUserId = "", isSelf = false, displayMode = "" } = {}) {
    if (!isSelf || typeof options.rememberPrivateProfileSurface !== "function") {
      return;
    }

    const normalizedDisplayMode = cleanString(displayMode, 40).toLowerCase() || "full";
    if (normalizedDisplayMode === "compact-card") {
      return;
    }

    const resolvedReply = cleanString(replyMessage?.id, 80)
      ? replyMessage
      : (typeof interaction?.fetchReply === "function"
        ? await Promise.resolve(interaction.fetchReply()).catch(() => null)
        : null);
    const messageId = cleanString(resolvedReply?.id, 80);
    if (!messageId) {
      return;
    }

    await Promise.resolve(options.rememberPrivateProfileSurface({
      userId: requesterUserId || interaction?.user?.id || "",
      messageId,
      isSelf,
      displayMode: normalizedDisplayMode,
    })).catch((error) => {
      logProfileWarning(`profile surface remember failed (${messageId}): ${error?.message || error}`);
    });
  }

  async function buildPrivateProfileReadModel({
    targetUserId = "",
    targetUser = null,
    targetMember = null,
    isSelf = false,
    requesterUserId = "",
    displayMode = "",
  } = {}) {
    const normalizedTargetUserId = cleanString(targetUserId, 80);
    const [resolvedTargetMember, fetchedTargetUser] = await Promise.all([
      targetMember
        ? Promise.resolve(targetMember)
        : Promise.resolve(typeof options.fetchMember === "function" ? options.fetchMember(normalizedTargetUserId) : null).catch(() => null),
      targetUser
        ? Promise.resolve(targetUser)
        : Promise.resolve(typeof options.fetchUser === "function" ? options.fetchUser(normalizedTargetUserId) : null).catch(() => null),
    ]);
    const memberUser = resolvedTargetMember?.user || null;
    const resolvedTargetUser = targetUser
      || fetchedTargetUser
      || memberUser
      || { id: normalizedTargetUserId, username: `User ${normalizedTargetUserId}` };
    const targetProfile = typeof options.getTargetProfile === "function"
      ? options.getTargetProfile(normalizedTargetUserId)
      : null;
    const [characterStatsContext, tierlistStatsUrl] = await Promise.all([
      Promise.resolve(typeof options.getCharacterStatsContext === "function"
        ? options.getCharacterStatsContext({ userId: normalizedTargetUserId })
        : null)
        .catch((error) => {
          logProfileWarning(`profile character stats context failed: ${error?.message || error}`);
          return null;
        }),
      Promise.resolve(typeof options.getTierlistStatsUrl === "function"
        ? options.getTierlistStatsUrl({ userId: normalizedTargetUserId })
        : "")
        .catch((error) => {
          logProfileWarning(`profile tierlist stats url failed: ${error?.message || error}`);
          return "";
        }),
    ]);
    const characterStats = Array.isArray(characterStatsContext?.characterStats)
      ? characterStatsContext.characterStats
      : (Array.isArray(characterStatsContext) ? characterStatsContext : []);

    const readModel = buildProfileReadModel({
      guildId: cleanString(options.guildId, 80),
      userId: normalizedTargetUserId,
      requesterUserId,
      targetDisplayName: resolvedTargetMember?.displayName
        || (typeof options.getTargetDisplayName === "function" ? options.getTargetDisplayName(normalizedTargetUserId, targetProfile) : "")
        || resolvedTargetUser?.globalName
        || resolvedTargetUser?.username,
      targetAvatarUrl: resolveUserAvatarUrl(resolvedTargetUser),
      roleMentions: listMemberRoleMentions(resolvedTargetMember, 6, options.hiddenProfileRoleIds),
      hiddenProfileRoleIds: options.hiddenProfileRoleIds,
      tierlistStatsUrl,
      characterStats,
      robloxJobState: typeof options.getRobloxJobState === "function"
        ? options.getRobloxJobState({ userId: normalizedTargetUserId })
        : null,
      robloxPlaytimePollMinutes: typeof options.getRobloxPlaytimePollMinutes === "function"
        ? options.getRobloxPlaytimePollMinutes()
        : null,
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
        populationProfiles: typeof options.getPopulationProfiles === "function"
          ? options.getPopulationProfiles()
          : [],
      recentKillChange: typeof options.getRecentKillChangeForUser === "function"
        ? options.getRecentKillChangeForUser(normalizedTargetUserId)
        : null,
      recentKillChanges: typeof options.getRecentKillChangesForUser === "function"
        ? options.getRecentKillChangesForUser(normalizedTargetUserId)
        : [],
      comboGuideState: typeof options.getComboGuideState === "function"
        ? options.getComboGuideState()
        : null,
      characterCatalog: typeof options.getCharacterCatalog === "function"
        ? options.getCharacterCatalog()
        : [],
      isSelf,
      displayMode,
    });

    return readModel;
  }

  async function resolveProfileSlashTargetUser(interaction) {
    const explicitTargetUser = typeof interaction?.options?.getUser === "function"
      ? interaction.options.getUser("target")
      : null;
    if (explicitTargetUser) {
      return explicitTargetUser;
    }

    const channelId = cleanString(interaction?.channelId, 80);
    const messageId = cleanString(interaction?.reference?.messageId, 80);
    if (channelId && messageId && typeof options.fetchChannelMessage === "function") {
      const referencedMessage = await Promise.resolve(options.fetchChannelMessage(channelId, messageId)).catch(() => null);
      if (referencedMessage?.author && referencedMessage.author.bot !== true) {
        return referencedMessage.author;
      }
    }

    return interaction?.user || null;
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
    const access = await resolveProfileAccessForRequester({
      requesterUserId: message?.author?.id,
      requesterUser: message?.author,
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

    const targetUser = await resolveProfileSlashTargetUser(interaction);
    const access = await resolveProfileAccessForRequester({
      requesterUserId: interaction.user.id,
      requesterUser: interaction.user,
      requesterMember: interaction.member,
      targetUserId: targetUser.id,
    });

    if (!access.allowed) {
      await interaction.reply(buildProfileAccessDeniedPayload(access));
      return true;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const reply = await interaction.editReply(await buildPrivateProfilePayload({
      targetUserId: targetUser.id,
      targetUser,
      isSelf: access.isSelf,
      requesterUserId: interaction.user.id,
    }));
    await rememberPrivateProfileSurface(interaction, reply, {
      requesterUserId: interaction.user.id,
      isSelf: access.isSelf,
    });
    return true;
  }

  async function handleProfileButtonInteraction({
    interaction,
    checkActorGuard = null,
    deleteSourceMessage = true,
  } = {}) {
    if (interaction?.customId === "elo_submit_card") {
      if (typeof checkActorGuard === "function" && await checkActorGuard(interaction)) {
        return true;
      }

      const access = await resolveProfileAccessForRequester({
        requesterUserId: interaction.user.id,
        requesterUser: interaction.user,
        requesterMember: interaction.member,
        targetUserId: interaction.user.id,
      });

      if (!access.allowed) {
        await interaction.reply(buildProfileAccessDeniedPayload(access));
        return true;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const reply = await interaction.editReply(await buildPrivateProfilePayload({
        targetUserId: interaction.user.id,
        targetUser: interaction.user,
        isSelf: access.isSelf,
        requesterUserId: interaction.user.id,
        displayMode: "compact-card",
      }));
      await rememberPrivateProfileSurface(interaction, reply, {
        requesterUserId: interaction.user.id,
        isSelf: access.isSelf,
        displayMode: "compact-card",
      });
      return true;
    }

    if (interaction?.customId === "profile_bind_roblox") {
      if (typeof checkActorGuard === "function" && await checkActorGuard(interaction)) {
        return true;
      }

      if (typeof options.buildProfileRobloxBindModal !== "function") {
        throw new TypeError("buildProfileRobloxBindModal must be a function");
      }

      const profile = typeof options.getTargetProfile === "function"
        ? options.getTargetProfile(interaction?.user?.id)
        : null;
      const identity = buildProfileRobloxIdentitySession(
        profile?.domains?.roblox || profile?.summary?.roblox || {}
      );
      await interaction.showModal(await options.buildProfileRobloxBindModal({
        initialValue: identity.robloxUsername || "",
      }));
      return true;
    }

    const profileButtonRequest = parseProfileOpenCustomId(interaction?.customId);
    if (profileButtonRequest) {
      if (typeof checkActorGuard === "function" && await checkActorGuard(interaction)) {
        return true;
      }

      if (interaction?.user?.id !== profileButtonRequest.requesterUserId && !hasStaffBypass(interaction?.member)) {
        await interaction.reply({ content: "Эта кнопка не для тебя.", flags: MessageFlags.Ephemeral });
        return true;
      }

      const access = await resolveProfileAccessForRequester({
        requesterUserId: interaction.user.id,
        requesterUser: interaction.user,
        requesterMember: interaction.member,
        targetUserId: profileButtonRequest.targetUserId,
      });

      if (!access.allowed) {
        await interaction.reply(buildProfileAccessDeniedPayload(access));
        return true;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const reply = await interaction.editReply(await buildPrivateProfilePayload({
        targetUserId: profileButtonRequest.targetUserId,
        isSelf: access.isSelf,
        requesterUserId: interaction.user.id,
      }));
      await rememberPrivateProfileSurface(interaction, reply, {
        requesterUserId: interaction.user.id,
        isSelf: access.isSelf,
      });
      if (deleteSourceMessage && typeof interaction?.message?.delete === "function") {
        await interaction.message.delete().catch(() => {});
      }
      return true;
    }

    const profileRatingDetailRequest = parseProfileRatingDetailCustomId(interaction?.customId);
    if (profileRatingDetailRequest) {
      if (typeof checkActorGuard === "function" && await checkActorGuard(interaction)) {
        return true;
      }

      if (interaction?.user?.id !== profileRatingDetailRequest.requesterUserId && !hasStaffBypass(interaction?.member)) {
        await interaction.reply({ content: "Эта кнопка не для тебя.", flags: MessageFlags.Ephemeral });
        return true;
      }

      const access = await resolveProfileAccessForRequester({
        requesterUserId: interaction.user.id,
        requesterUser: interaction.user,
        requesterMember: interaction.member,
        targetUserId: profileRatingDetailRequest.targetUserId,
      });

      if (!access.allowed) {
        await interaction.reply(buildProfileAccessDeniedPayload(access));
        return true;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const readModel = await buildPrivateProfileReadModel({
        targetUserId: profileRatingDetailRequest.targetUserId,
        isSelf: access.isSelf,
        requesterUserId: interaction.user.id,
      });
      await interaction.editReply(buildProfileRatingDetailPayload({
        readModel,
        axis: profileRatingDetailRequest.axis,
      }));
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

    const access = await resolveProfileAccessForRequester({
      requesterUserId: interaction.user.id,
      requesterUser: interaction.user,
      requesterMember: interaction.member,
      targetUserId: profileNavRequest.targetUserId,
    });

    if (!access.allowed) {
      await interaction.reply(buildProfileAccessDeniedPayload(access));
      return true;
    }

    const acked = await safeDeferComponentUpdate(interaction, {
      label: "profile nav",
      logWarning: typeof options.logWarning === "function" ? options.logWarning : () => {},
    });
    if (!acked) {
      return true;
    }

    try {
      const reply = await interaction.editReply(await buildPrivateProfilePayload({
        targetUserId: profileNavRequest.targetUserId,
        isSelf: access.isSelf,
        requesterUserId: interaction.user.id,
        view: profileNavRequest.view,
      }));
      await rememberPrivateProfileSurface(interaction, reply, {
        requesterUserId: interaction.user.id,
        isSelf: access.isSelf,
      });
    } catch (error) {
      if (typeof options.logWarning === "function") {
        options.logWarning(`profile nav payload failed (${profileNavRequest.view}/${profileNavRequest.targetUserId}): ${error?.message || error}`);
      }
      await interaction.editReply(buildProfileFallbackPayload({
        view: profileNavRequest.view,
        message: "Профильная кнопка сработала, но этот раздел временно не собрался. Ошибка записана в лог.",
      }));
    }
    return true;
  }

  async function handleProfileModalSubmitInteraction({
    interaction,
    checkActorGuard = null,
  } = {}) {
    if (interaction?.customId !== "profile_bind_roblox_modal") {
      return false;
    }

    if (typeof checkActorGuard === "function" && await checkActorGuard(interaction)) {
      return true;
    }

    if (typeof options.resolveRobloxUserInput !== "function") {
      throw new TypeError("resolveRobloxUserInput must be a function");
    }
    if (typeof options.writeProfileRobloxBinding !== "function") {
      throw new TypeError("writeProfileRobloxBinding must be a function");
    }

    const robloxIdentityInput = interaction.fields.getTextInputValue("roblox_username");
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let robloxUser = null;
    try {
      robloxUser = await options.resolveRobloxUserInput(robloxIdentityInput);
    } catch (error) {
      logProfileWarning(`profile_bind_roblox resolve failed (${interaction?.user?.id || "unknown"}): ${error?.message || error || "unknown error"}`);
      await interaction.editReply(String(error?.message || error || "Не удалось проверить Roblox аккаунт."));
      return true;
    }

    if (!robloxUser) {
      await interaction.editReply("Такой Roblox аккаунт не найден через Roblox API. Проверь username, userId или ссылку и попробуй ещё раз.");
      return true;
    }

    try {
      await options.writeProfileRobloxBinding(interaction.user.id, robloxUser, {
        interaction,
        user: interaction.user,
        member: interaction.member,
        source: "profile_button",
      });
    } catch (error) {
      logProfileWarning(`profile_bind_roblox write failed (${interaction?.user?.id || "unknown"}): ${error?.message || error || "unknown error"}`);
      await interaction.editReply(String(error?.message || error || "Не удалось сохранить Roblox аккаунт."));
      return true;
    }

    if (typeof options.logProfileRobloxBinding === "function") {
      await Promise.resolve(options.logProfileRobloxBinding({
        userId: interaction.user.id,
        robloxUser,
        interaction,
      })).catch(() => {});
    }

    await interaction.editReply(`Roblox аккаунт подтверждён: **${robloxUser.name}** (ID ${robloxUser.id}). Профиль обновлён.`);
    return true;
  }

  return {
    buildProfileAccessDeniedPayload,
    buildProfileOpenHelperPayload,
    buildPrivateProfilePayload,
    getProfileAccessDeniedText,
    handleProfileButtonInteraction,
    handleProfileModalSubmitInteraction,
    handleProfileMessage,
    handleProfileSlashCommand,
    resolveProfileAccessForRequester,
    resolveProfileMessageRequest,
  };
}

module.exports = {
  createProfileOperator,
};
