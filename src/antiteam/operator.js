"use strict";

const { MessageFlags, PermissionsBitField } = require("discord.js");
const {
  ANTITEAM_LEVELS,
  cleanString,
  clearAntiteamDraft,
  closeAntiteamTicket,
  createAntiteamTicketFromDraft,
  createDefaultAntiteamConfig,
  ensureAntiteamState,
  findIdleAntiteamTickets,
  getAntiteamDraft,
  incrementHelperStats,
  matchRobloxFriendsToDiscordProfiles,
  recordAntiteamHelper,
  setAntiteamDraft,
  setTicketHelperArrival,
  updateAntiteamTicket,
} = require("./state");
const {
  ANTITEAM_COMMAND_NAME,
  ANTITEAM_CUSTOM_IDS,
  buildAdvancedConfigModal,
  buildCloseReviewPayload,
  buildCloseSummaryModal,
  buildConfigModal,
  buildDescriptionModal,
  buildEscalateModal,
  buildHelpReplyPayload,
  buildModeratorPanelPayload,
  buildPanelTextModal,
  buildPhotoRequestPayload,
  buildReportModal,
  buildRobloxUsernameModal,
  buildStartPanelPayload,
  buildStartGuidePayload,
  buildThreadName,
  buildThreadPanelPayload,
  buildTicketPublicPayload,
  buildTicketSetupPayload,
  formatRoleMention,
  ticketButtonId,
} = require("./view");

function noop() {}

function normalizeUsernameInput(value) {
  const username = cleanString(value, 40);
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
    throw new Error("Roblox username должен содержать 3-20 символов: буквы, цифры или _.");
  }
  return username;
}

function getUserTag(user = {}) {
  return cleanString(user.tag || user.username || user.globalName || user.id, 120);
}

function getMemberRoleCache(member = null) {
  return member?.roles?.cache || null;
}

function hasRole(member = null, roleId = "") {
  const id = cleanString(roleId, 80);
  return Boolean(id && getMemberRoleCache(member)?.has?.(id));
}

function hasAdmin(member = null) {
  return Boolean(member?.permissions?.has?.(PermissionsBitField.Flags.Administrator));
}

function parseEntityId(value = "") {
  const text = cleanString(value, 120);
  if (!text) return "";
  const mentionMatch = text.match(/^<[@#&!]*([0-9]{5,30})>$/);
  if (mentionMatch) return mentionMatch[1];
  const digitMatch = text.match(/[0-9]{5,30}/);
  return digitMatch ? digitMatch[0] : text;
}

function parseClanPingRolesText(value = "", previousRoles = []) {
  const previousByLabel = new Map((Array.isArray(previousRoles) ? previousRoles : [])
    .map((entry) => [cleanString(entry.label, 80).toLowerCase(), entry]));
  const roles = [];
  const seen = new Set();

  for (const rawLine of String(value || "").split(/\r?\n/)) {
    const line = cleanString(rawLine, 200);
    if (!line) continue;
    const [left, right = ""] = line.split("=");
    const label = cleanString(left, 80);
    if (!label) continue;
    const [rolePart = "", defaultPart = "off"] = right.split(":");
    const previous = previousByLabel.get(label.toLowerCase()) || {};
    const key = cleanString(previous.key || label.toLowerCase().replace(/[^a-zа-я0-9]+/gi, "_"), 80);
    if (seen.has(key)) continue;
    seen.add(key);
    roles.push({
      key,
      label,
      roleId: parseEntityId(rolePart),
      defaultEnabled: /^(1|true|yes|on|да|вкл)$/i.test(cleanString(defaultPart, 20)),
    });
  }

  return roles;
}

function parsePositiveIntegerInput(value, fallback) {
  const number = Number.parseInt(cleanString(value, 20), 10);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function parseColorInput(value, fallback = 0xE53935) {
  const text = cleanString(value, 20).replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(text)) return Number.parseInt(text, 16);
  return fallback;
}

function buildTemplateUrl(template = "", replacements = {}) {
  let result = cleanString(template, 800);
  for (const [key, value] of Object.entries(replacements)) {
    result = result.replaceAll(`{${key}}`, encodeURIComponent(cleanString(value, 200)));
  }
  return result;
}

function getTicketProfileUrl(ticket = {}) {
  const userId = cleanString(ticket.roblox?.userId, 40);
  return cleanString(ticket.roblox?.profileUrl, 500) || (userId ? `https://www.roblox.com/users/${userId}/profile` : "");
}

function getConfiguredClanRoleIds(ticket = {}, config = createDefaultAntiteamConfig()) {
  const selected = new Set(Array.isArray(ticket.selectedClanPingKeys) ? ticket.selectedClanPingKeys : []);
  const roleIds = [];
  for (const entry of config.clanPingRoles) {
    if (!selected.has(entry.key)) continue;
    const roleId = cleanString(entry.roleId, 80);
    if (roleId) roleIds.push(roleId);
  }
  return [...new Set(roleIds)];
}

function getTicketPingRoleIds(ticket = {}, config = createDefaultAntiteamConfig()) {
  if (ticket.kind === "clan") return getConfiguredClanRoleIds(ticket, config);
  return cleanString(config.battalionRoleId, 80) ? [config.battalionRoleId] : [];
}

function isImageAttachment(attachment = {}) {
  const contentType = cleanString(attachment.contentType, 120).toLowerCase();
  const name = cleanString(attachment.name, 180).toLowerCase();
  return contentType.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(name);
}

function normalizeAttachmentPhoto(attachment = {}, now = new Date().toISOString()) {
  return {
    url: cleanString(attachment.url, 2000),
    proxyUrl: cleanString(attachment.proxyURL || attachment.proxyUrl, 2000),
    name: cleanString(attachment.name, 180),
    contentType: cleanString(attachment.contentType, 120),
    size: Number(attachment.size) || 0,
    capturedAt: now,
  };
}

function createAntiteamOperator(options = {}) {
  const db = options.db;
  if (!db || typeof db !== "object") throw new TypeError("db is required");

  const nowIso = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  const logError = typeof options.logError === "function" ? options.logError : noop;

  function getState() {
    return ensureAntiteamState(db).state;
  }

  function getConfig() {
    return getState().config;
  }

  async function persist(label, mutate, { shouldSave = true } = {}) {
    if (typeof options.runSerializedMutation === "function") {
      return options.runSerializedMutation({
        label,
        mutate,
        shouldPersist: shouldSave,
        persist: options.saveDb,
      });
    }
    const result = await Promise.resolve().then(mutate);
    if (shouldSave && typeof options.saveDb === "function") options.saveDb();
    return result;
  }

  function isModerator(member = null) {
    if (typeof options.isModerator === "function") return options.isModerator(member);
    const config = getConfig();
    return hasAdmin(member) || hasRole(member, config.moderatorRoleId);
  }

  function canCallClan(member = null) {
    const config = getConfig();
    return isModerator(member)
      || hasRole(member, config.battalionLeadRoleId)
      || hasRole(member, config.clanCallerRoleId);
  }

  function canManageTicket(interaction, ticket = {}) {
    return cleanString(interaction?.user?.id, 80) === ticket.createdBy || isModerator(interaction?.member);
  }

  async function replyNoPermission(interaction) {
    if (typeof options.replyNoPermission === "function") {
      await options.replyNoPermission(interaction);
      return;
    }
    await interaction.reply({ content: "Нет прав.", flags: MessageFlags.Ephemeral });
  }

  async function fetchRobloxUserByUsername(username) {
    if (typeof options.resolveRobloxUserByUsername === "function") {
      return options.resolveRobloxUserByUsername(username);
    }
    if (typeof options.fetchUsersByUsernames !== "function") {
      throw new Error("Roblox API не подключён.");
    }
    const users = await options.fetchUsersByUsernames([username], { excludeBannedUsers: false });
    return Array.isArray(users) ? users.find((user) => user?.username?.toLowerCase?.() === username.toLowerCase()) || users[0] : null;
  }

  async function writeRobloxBinding(discordUserId, robloxUser, source = "antiteam") {
    if (typeof options.writeRobloxBinding === "function") {
      return options.writeRobloxBinding(discordUserId, robloxUser, source);
    }
    return null;
  }

  async function grantBattalionRole(userId, reason = "antiteam participant") {
    const roleId = cleanString(getConfig().battalionRoleId, 80);
    if (!roleId) return { skipped: "missing-role" };
    if (typeof options.grantRole === "function") {
      return options.grantRole(userId, roleId, reason);
    }
    const member = typeof options.fetchMember === "function" ? await options.fetchMember(userId).catch(() => null) : null;
    if (!member?.roles?.add) return { skipped: "missing-member" };
    if (member.roles.cache?.has?.(roleId)) return { skipped: "already-has-role" };
    await member.roles.add(roleId, reason);
    return { granted: true, roleId };
  }

  async function collectFriendEligibleDiscordIds(draft = {}) {
    if (!draft.roblox?.userId || typeof options.fetchRobloxFriends !== "function") return [];
    try {
      const friends = await options.fetchRobloxFriends(draft.roblox.userId);
      return matchRobloxFriendsToDiscordProfiles(db.profiles, friends)
        .filter((userId) => userId !== draft.userId);
    } catch (error) {
      logError("Antiteam Roblox friend scan failed:", error?.message || error);
      return [];
    }
  }

  async function fetchTextChannel(channelId) {
    const id = cleanString(channelId, 80);
    if (!id) return null;
    if (typeof options.fetchChannel === "function") {
      return options.fetchChannel(id);
    }
    return null;
  }

  async function publishStartPanel(statusText = "") {
    const state = getState();
    const config = state.config;
    if (!config.channelId) throw new Error("Канал антитима не настроен.");
    const channel = await fetchTextChannel(config.channelId);
    if (!channel?.isTextBased?.()) throw new Error("Канал антитима не найден или не текстовый.");

    const payload = buildStartPanelPayload(config);
    let previous = null;
    if (config.panelMessageId) {
      previous = await channel.messages?.fetch?.(config.panelMessageId).catch(() => null);
    }
    if (previous) await previous.delete().catch(() => {});
    const message = await channel.send(payload);
    await persist("antiteam-panel-publish", () => {
      const current = getState();
      current.config.panelMessageId = message.id;
      current.config.channelId = channel.id;
      return { mutated: true };
    });
    return { message, statusText: statusText || `Стартовая панель опубликована в <#${channel.id}>.` };
  }

  async function editPublishedStartPanel() {
    const config = getConfig();
    if (!config.channelId || !config.panelMessageId) return { edited: false, reason: "missing-message" };
    const channel = await fetchTextChannel(config.channelId).catch(() => null);
    const message = channel?.messages?.fetch ? await channel.messages.fetch(config.panelMessageId).catch(() => null) : null;
    if (!message?.edit) return { edited: false, reason: "message-not-found" };
    await message.edit(buildStartPanelPayload(config));
    return { edited: true, message };
  }

  async function syncTicketMessages(ticket) {
    const config = getConfig();
    const channel = await fetchTextChannel(ticket.message?.channelId).catch(() => null);
    if (channel && ticket.message?.messageId) {
      const message = await channel.messages?.fetch?.(ticket.message.messageId).catch(() => null);
      if (message) await message.edit(buildTicketPublicPayload(ticket, config)).catch(() => {});
    }
    const thread = await fetchTextChannel(ticket.message?.threadId).catch(() => null);
    if (thread && ticket.message?.threadPanelMessageId) {
      const panel = await thread.messages?.fetch?.(ticket.message.threadPanelMessageId).catch(() => null);
      if (panel) await panel.edit(buildThreadPanelPayload(ticket, config)).catch(() => {});
    }
  }

  async function publishTicketFromDraft(userId, { skipPhoto = false } = {}) {
    const draft = getAntiteamDraft(db, userId);
    if (!draft) throw new Error("Черновик антитима истёк. Начни заново.");
    if (draft.kind === "clan" && !draft.description) {
      throw new Error("Для клан-аларма нужно описание врагов и ситуации.");
    }
    if (draft.photoWanted && !draft.photo && !skipPhoto) {
      const channelId = getConfig().channelId;
      await persist("antiteam-photo-request", () => {
        const state = getState();
        state.photoRequests[userId] = { userId, channelId, createdAt: nowIso() };
        return { mutated: true };
      });
      return { needsPhoto: true, draft: getAntiteamDraft(db, userId) };
    }

    const state = getState();
    const config = state.config;
    if (!config.channelId) throw new Error("Канал антитима не настроен.");
    const channel = await fetchTextChannel(config.channelId);
    if (!channel?.isTextBased?.()) throw new Error("Канал антитима не найден или не текстовый.");

    const friendEligibleDiscordUserIds = await collectFriendEligibleDiscordIds(draft);
    const ticket = await persist("antiteam-ticket-create", () => createAntiteamTicketFromDraft(db, draft, {
      now: nowIso(),
      friendEligibleDiscordUserIds,
    }));

    try {
      const publicPayload = buildTicketPublicPayload(ticket, config, { attachPhoto: Boolean(ticket.photo?.url) });
      const publicMessage = await channel.send(publicPayload);
      const thread = typeof publicMessage.startThread === "function"
        ? await publicMessage.startThread({
          name: buildThreadName(ticket).slice(0, 100),
          autoArchiveDuration: Math.max(60, Math.min(10080, Number(config.missionAutoArchiveMinutes) || 60)),
        })
        : null;
      const pingRoleIds = getTicketPingRoleIds(ticket, config);
      let pingMessage = null;
      if (thread && pingRoleIds.length) {
        pingMessage = await thread.send({
          content: pingRoleIds.map((roleId) => `<@&${roleId}>`).join(" "),
          allowedMentions: { roles: pingRoleIds },
        }).catch(() => null);
      }
      const threadPanel = thread
        ? await thread.send(buildThreadPanelPayload(ticket, config)).catch(() => null)
        : null;

      const updatedTicket = await persist("antiteam-ticket-message-refs", () => updateAntiteamTicket(db, ticket.id, (current) => {
        current.message = {
          channelId: channel.id,
          messageId: publicMessage.id,
          threadId: thread?.id || "",
          threadPanelMessageId: threadPanel?.id || "",
          pingMessageId: pingMessage?.id || "",
          photoAttachmentName: publicPayload.files?.[0]?.name || "",
        };
        current.updatedAt = nowIso();
        return current;
      }));

      await grantBattalionRole(ticket.createdBy, "antiteam request created").catch(() => null);
      await publishStartPanel().catch((error) => {
        logError("Antiteam panel resend failed:", error?.message || error);
      });
      return { ticket: updatedTicket, publicMessage, thread };
    } catch (error) {
      await persist("antiteam-ticket-publish-rollback", () => {
        const current = getState();
        delete current.tickets[ticket.id];
        current.drafts[userId] = draft;
        return { mutated: true };
      });
      throw error;
    }
  }

  async function resolveDirectJoinUrl(ticket = {}) {
    const config = getConfig();
    const userId = cleanString(ticket.roblox?.userId, 40);
    const optionPlaceId = typeof options.robloxPlaceId === "function" ? options.robloxPlaceId() : options.robloxPlaceId;
    const configuredPlaceId = cleanString(config.roblox.jjsPlaceId || optionPlaceId, 40);
    let gameId = "";
    let placeId = configuredPlaceId;
    if (userId && typeof options.fetchRobloxPresences === "function") {
      const presences = await options.fetchRobloxPresences([userId]).catch(() => []);
      const presence = Array.isArray(presences) ? presences[0] : null;
      gameId = cleanString(presence?.gameId, 120);
      placeId = cleanString(presence?.placeId || presence?.rootPlaceId || configuredPlaceId, 40);
    }
    if (placeId && gameId) {
      return buildTemplateUrl(config.roblox.directJoinUrlTemplate, { placeId, gameId });
    }
    if (placeId) {
      return buildTemplateUrl(config.roblox.gameUrlTemplate, { placeId });
    }
    return "";
  }

  async function notifyTicketAuthorForFriendRequest(ticket = {}, helper = {}) {
    if (typeof options.sendDirectMessage !== "function") return false;
    const helperText = [
      `<@${helper.userId}> хочет помочь по антитиму, но direct join недоступен.`,
      helper.robloxUsername ? `Roblox helper-а: **${helper.robloxUsername}**${helper.robloxUserId ? ` (${helper.robloxUserId})` : ""}.` : "Roblox helper-а в базе не найден.",
      `Прими его в друзья: ${getConfig().roblox.friendRequestsUrl}`,
    ].join("\n");
    await options.sendDirectMessage(ticket.createdBy, { content: helperText }).catch(() => null);
    return true;
  }

  function getHelperRobloxSnapshot(userId) {
    const profile = typeof options.getProfile === "function" ? options.getProfile(userId) : db.profiles?.[userId];
    const roblox = profile?.domains?.roblox || profile?.summary?.roblox || {};
    return {
      username: cleanString(roblox.username || roblox.currentUsername, 120),
      userId: cleanString(roblox.userId, 40),
    };
  }

  function getStoredRobloxSnapshot(userId) {
    const profile = typeof options.getProfile === "function" ? options.getProfile(userId) : db.profiles?.[userId];
    const candidates = [
      profile?.domains?.roblox,
      profile?.summary?.roblox,
      profile?.roblox,
    ].filter(Boolean);

    for (const roblox of candidates) {
      const robloxUserId = cleanString(roblox.userId || roblox.robloxUserId || roblox.id, 40);
      const username = cleanString(roblox.username || roblox.currentUsername || roblox.robloxUsername || roblox.name, 120);
      const status = cleanString(roblox.verificationStatus || roblox.status, 40).toLowerCase();
      const trusted = status === "verified" || roblox.hasVerifiedAccount === true || Boolean(roblox.verifiedAt);
      const explicitlyUnusable = status === "failed" || status === "unverified";
      if (!robloxUserId || !username || explicitlyUnusable || (!trusted && status)) continue;
      return {
        id: robloxUserId,
        userId: robloxUserId,
        name: username,
        username,
        displayName: cleanString(roblox.displayName || roblox.robloxDisplayName, 120),
        profileUrl: cleanString(roblox.profileUrl, 500) || `https://www.roblox.com/users/${robloxUserId}/profile`,
      };
    }
    return null;
  }

  async function openTicketDraftWithRoblox(interaction, robloxUser, kind = "standard", { response = "reply", statusText = "" } = {}) {
    await grantBattalionRole(interaction.user.id, "antiteam roblox ready").catch(() => null);
    const draft = await persist("antiteam-draft-roblox", () => setAntiteamDraft(db, interaction.user.id, {
      kind,
      userTag: getUserTag(interaction.user),
      roblox: robloxUser,
      level: "medium",
      count: "2-4",
      directJoinEnabled: false,
      photoWanted: false,
    }, { now: nowIso() }));
    const payload = buildTicketSetupPayload(draft, getConfig(), statusText || `Roblox готов: ${draft.roblox.username}.`);
    if (response === "editReply") {
      await interaction.editReply(payload);
    } else {
      await interaction.reply(payload);
    }
    return true;
  }

  async function handleHelp(interaction, ticketId) {
    const state = getState();
    const ticket = state.tickets[ticketId];
    if (!ticket || ticket.status !== "open") {
      await interaction.reply({ content: "Эта миссия уже закрыта или не найдена.", flags: MessageFlags.Ephemeral });
      return true;
    }

    const helperRoblox = getHelperRobloxSnapshot(interaction.user.id);
    const isFriendEligible = ticket.friendEligibleDiscordUserIds.includes(interaction.user.id);
    const linkKind = ticket.directJoinEnabled ? "direct" : isFriendEligible ? "friend_direct" : "friend_request";
    const directJoinUrl = linkKind === "friend_request" ? "" : await resolveDirectJoinUrl(ticket);
    const profileUrl = getTicketProfileUrl(ticket);
    const previousHelper = ticket.helpers?.[interaction.user.id] || null;
    const alreadyResponded = Boolean(previousHelper?.respondedAt);
    const alreadyGrantedLink = Boolean(previousHelper?.linkGrantedAt);
    const alreadyNotifiedAuthor = Boolean(previousHelper?.friendRequestNotifiedAt);
    const shouldNotifyAuthor = linkKind === "friend_request" && !alreadyNotifiedAuthor;
    const helperRecord = {
      userId: interaction.user.id,
      discordTag: getUserTag(interaction.user),
      robloxUsername: helperRoblox.username,
      robloxUserId: helperRoblox.userId,
      linkKind,
      friendRequestNotifiedAt: linkKind === "friend_request" ? previousHelper?.friendRequestNotifiedAt || nowIso() : null,
    };

    const updated = await persist("antiteam-helper", () => {
      recordAntiteamHelper(db, ticket.id, helperRecord, { now: nowIso() });
      incrementHelperStats(db, interaction.user.id, {
        responded: alreadyResponded ? 0 : 1,
        linkGranted: alreadyGrantedLink ? 0 : 1,
        lastTicketId: ticket.id,
      }, { now: nowIso() });
      return getState().tickets[ticket.id];
    });

    if (shouldNotifyAuthor) {
      await notifyTicketAuthorForFriendRequest(ticket, helperRecord);
    }

    await syncTicketMessages(updated).catch(() => {});
    await interaction.reply(buildHelpReplyPayload({
      ticket: updated,
      linkKind,
      directJoinUrl,
      profileUrl,
      friendRequestsUrl: getConfig().roblox.friendRequestsUrl,
    }));
    return true;
  }

  function getNextEscalationLevel(level) {
    if (level === "low") return "medium";
    if (level === "medium") return "high";
    return "";
  }

  async function handleSlashCommand(interaction) {
    if (!interaction?.isChatInputCommand?.() || interaction.commandName !== ANTITEAM_COMMAND_NAME) return false;
    const subcommand = typeof interaction.options?.getSubcommand === "function"
      ? interaction.options.getSubcommand()
      : "";

    if (subcommand === "panel") {
      if (!isModerator(interaction.member)) {
        await replyNoPermission(interaction);
        return true;
      }
      await interaction.reply(buildModeratorPanelPayload(getState()));
      return true;
    }

    if (subcommand === "clan") {
      if (!canCallClan(interaction.member)) {
        await replyNoPermission(interaction);
        return true;
      }
      await interaction.showModal(buildRobloxUsernameModal({
        customId: "at:clan_roblox",
        title: "Клан-аларм: Roblox якорь",
      }));
      return true;
    }

    return false;
  }

  async function handleButtonInteraction(interaction) {
    if (!interaction?.isButton?.() || !cleanString(interaction.customId, 100).startsWith("at:")) return false;
    const id = interaction.customId;

    if (id === ANTITEAM_CUSTOM_IDS.open) {
      const storedRoblox = getStoredRobloxSnapshot(interaction.user.id);
      if (storedRoblox) {
        return openTicketDraftWithRoblox(interaction, storedRoblox, "standard", {
          response: "reply",
          statusText: `Roblox взят из твоего профиля: ${storedRoblox.username}.`,
        });
      }
      await interaction.showModal(buildRobloxUsernameModal({ customId: "at:roblox" }));
      return true;
    }

    if (id === ANTITEAM_CUSTOM_IDS.guide) {
      await interaction.reply(buildStartGuidePayload(getConfig()));
      return true;
    }

    if (id === ANTITEAM_CUSTOM_IDS.config) {
      if (!isModerator(interaction.member)) {
        await replyNoPermission(interaction);
        return true;
      }
      await interaction.showModal(buildConfigModal(getConfig()));
      return true;
    }

    if (id === ANTITEAM_CUSTOM_IDS.panelText) {
      if (!isModerator(interaction.member)) {
        await replyNoPermission(interaction);
        return true;
      }
      await interaction.showModal(buildPanelTextModal(getConfig()));
      return true;
    }

    if (id === ANTITEAM_CUSTOM_IDS.configAdvanced) {
      if (!isModerator(interaction.member)) {
        await replyNoPermission(interaction);
        return true;
      }
      await interaction.showModal(buildAdvancedConfigModal(getConfig()));
      return true;
    }

    if (id === ANTITEAM_CUSTOM_IDS.publishPanel) {
      if (!isModerator(interaction.member)) {
        await replyNoPermission(interaction);
        return true;
      }
      await interaction.deferUpdate();
      try {
        const result = await publishStartPanel();
        await interaction.editReply(buildModeratorPanelPayload(getState(), result.statusText));
      } catch (error) {
        await interaction.editReply(buildModeratorPanelPayload(getState(), `Ошибка: ${error?.message || error}`));
      }
      return true;
    }

    if (id === ANTITEAM_CUSTOM_IDS.refreshPanel) {
      if (!isModerator(interaction.member)) {
        await replyNoPermission(interaction);
        return true;
      }
      await interaction.update(buildModeratorPanelPayload(getState()));
      return true;
    }

    if (id === ANTITEAM_CUSTOM_IDS.toggleDirect || id === ANTITEAM_CUSTOM_IDS.togglePhoto) {
      const draft = getAntiteamDraft(db, interaction.user.id);
      if (!draft) {
        await interaction.reply({ content: "Черновик истёк. Начни заново.", flags: MessageFlags.Ephemeral });
        return true;
      }
      const patch = id === ANTITEAM_CUSTOM_IDS.toggleDirect
        ? { directJoinEnabled: !draft.directJoinEnabled }
        : { photoWanted: !draft.photoWanted };
      const updated = await persist("antiteam-draft-toggle", () => setAntiteamDraft(db, interaction.user.id, patch, { now: nowIso() }));
      await interaction.update(buildTicketSetupPayload(updated, getConfig()));
      return true;
    }

    if (id === ANTITEAM_CUSTOM_IDS.editDescription) {
      const draft = getAntiteamDraft(db, interaction.user.id);
      if (!draft) {
        await interaction.reply({ content: "Черновик истёк. Начни заново.", flags: MessageFlags.Ephemeral });
        return true;
      }
      await interaction.showModal(buildDescriptionModal(draft));
      return true;
    }

    if (id === ANTITEAM_CUSTOM_IDS.cancelDraft) {
      await persist("antiteam-draft-cancel", () => {
        clearAntiteamDraft(db, interaction.user.id);
        return { mutated: true };
      });
      await interaction.update({
        content: "Заявка антитима отменена.",
        components: [],
        flags: MessageFlags.Ephemeral,
      }).catch(async () => interaction.reply({ content: "Заявка антитима отменена.", flags: MessageFlags.Ephemeral }));
      return true;
    }

    if (id === ANTITEAM_CUSTOM_IDS.submitDraft || id === ANTITEAM_CUSTOM_IDS.submitWithoutPhoto) {
      await interaction.deferUpdate();
      try {
        const result = await publishTicketFromDraft(interaction.user.id, { skipPhoto: id === ANTITEAM_CUSTOM_IDS.submitWithoutPhoto });
        if (result.needsPhoto) {
          await interaction.editReply(buildPhotoRequestPayload(result.draft));
        } else {
          await interaction.editReply({
            content: `Заявка опубликована: ${result.ticket ? `\`${result.ticket.id}\`` : "готово"}.`,
            components: [],
            flags: MessageFlags.Ephemeral,
          });
        }
      } catch (error) {
        const draft = getAntiteamDraft(db, interaction.user.id);
        if (draft) {
          await interaction.editReply(buildTicketSetupPayload(draft, getConfig(), `Ошибка: ${error?.message || error}`));
        } else {
          await interaction.editReply({ content: `Ошибка: ${error?.message || error}`, components: [], flags: MessageFlags.Ephemeral });
        }
      }
      return true;
    }

    const parts = id.split(":");
    if (parts[0] !== "at" || parts.length < 3) return false;
    const action = parts[1];
    const ticketId = parts[2];
    const extra = parts.slice(3).join(":");
    const ticket = getState().tickets[ticketId];

    if (action === "help") return handleHelp(interaction, ticketId);

    if (action === "report") {
      if (!ticket) {
        await interaction.reply({ content: "Миссия не найдена.", flags: MessageFlags.Ephemeral });
        return true;
      }
      await interaction.showModal(buildReportModal(ticketId));
      return true;
    }

    if (action === "escalate") {
      if (!ticket || ticket.kind === "clan" || ticket.status !== "open") {
        await interaction.reply({ content: "Повысить эту миссию нельзя.", flags: MessageFlags.Ephemeral });
        return true;
      }
      if (!canManageTicket(interaction, ticket)) {
        await replyNoPermission(interaction);
        return true;
      }
      const nextLevel = getNextEscalationLevel(ticket.level);
      if (!nextLevel) {
        await interaction.reply({ content: "Опасность уже на максимуме.", flags: MessageFlags.Ephemeral });
        return true;
      }
      await interaction.showModal(buildEscalateModal(ticketId, nextLevel));
      return true;
    }

    if (action === "close") {
      if (!ticket || ticket.status !== "open") {
        await interaction.reply({ content: "Миссия уже закрыта или не найдена.", flags: MessageFlags.Ephemeral });
        return true;
      }
      if (!canManageTicket(interaction, ticket)) {
        await replyNoPermission(interaction);
        return true;
      }
      await interaction.reply(buildCloseReviewPayload(ticket));
      return true;
    }

    if (action === "close_page") {
      if (!ticket || !canManageTicket(interaction, ticket)) {
        await replyNoPermission(interaction);
        return true;
      }
      await interaction.update(buildCloseReviewPayload(ticket, Number.parseInt(extra, 10) || 0));
      return true;
    }

    if (action === "arrived") {
      if (!ticket || !canManageTicket(interaction, ticket)) {
        await replyNoPermission(interaction);
        return true;
      }
      const [helperId, pageRaw = "0"] = extra.split(":");
      const current = ticket.helpers?.[helperId];
      if (!current) {
        await interaction.reply({ content: "Helper не найден в этой миссии.", flags: MessageFlags.Ephemeral });
        return true;
      }
      const updated = await persist("antiteam-arrival-toggle", () => setTicketHelperArrival(db, ticket.id, helperId, !current.arrived, { now: nowIso() }));
      await interaction.update(buildCloseReviewPayload(updated, Number.parseInt(pageRaw, 10) || 0));
      return true;
    }

    if (action === "close_finish") {
      if (!ticket || !canManageTicket(interaction, ticket)) {
        await replyNoPermission(interaction);
        return true;
      }
      await interaction.showModal(buildCloseSummaryModal(ticketId));
      return true;
    }

    return false;
  }

  async function handleSelectMenuInteraction(interaction) {
    if (!interaction?.isStringSelectMenu?.() || !cleanString(interaction.customId, 100).startsWith("at:")) return false;
    const draft = getAntiteamDraft(db, interaction.user.id);
    if (!draft) {
      await interaction.reply({ content: "Черновик истёк. Начни заново.", flags: MessageFlags.Ephemeral });
      return true;
    }
    const value = Array.isArray(interaction.values) ? interaction.values[0] : "";
    let patch = {};
    if (interaction.customId === ANTITEAM_CUSTOM_IDS.levelSelect) {
      patch = { level: value };
    } else if (interaction.customId === ANTITEAM_CUSTOM_IDS.countSelect) {
      patch = { count: value };
    } else if (interaction.customId === ANTITEAM_CUSTOM_IDS.clanRolesSelect) {
      patch = { selectedClanPingKeys: Array.isArray(interaction.values) ? interaction.values : [] };
    } else {
      return false;
    }
    const updated = await persist("antiteam-draft-select", () => setAntiteamDraft(db, interaction.user.id, patch, { now: nowIso() }));
    await interaction.update(buildTicketSetupPayload(updated, getConfig()));
    return true;
  }

  async function handleRobloxModal(interaction, kind = "standard") {
    const username = normalizeUsernameInput(interaction.fields.getTextInputValue("roblox_username"));
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const robloxUser = await fetchRobloxUserByUsername(username);
    if (!robloxUser?.userId && !robloxUser?.id) {
      await interaction.editReply("Такой Roblox username не найден через Roblox API.");
      return true;
    }
    await writeRobloxBinding(interaction.user.id, robloxUser, "antiteam");
    return openTicketDraftWithRoblox(interaction, robloxUser, kind, {
      response: "editReply",
      statusText: `Roblox подтверждён: ${cleanString(robloxUser.username || robloxUser.name, 120)}.`,
    });
  }

  async function handleModalSubmitInteraction(interaction) {
    if (!interaction?.isModalSubmit?.() || !cleanString(interaction.customId, 100).startsWith("at:")) return false;
    const id = interaction.customId;

    if (id === "at:roblox") return handleRobloxModal(interaction, "standard");
    if (id === "at:clan_roblox") return handleRobloxModal(interaction, "clan");

    if (id === "at:desc:modal") {
      const draft = getAntiteamDraft(db, interaction.user.id);
      if (!draft) {
        await interaction.reply({ content: "Черновик истёк. Начни заново.", flags: MessageFlags.Ephemeral });
        return true;
      }
      const description = interaction.fields.getTextInputValue("description");
      const updated = await persist("antiteam-draft-description", () => setAntiteamDraft(db, interaction.user.id, { description }, { now: nowIso() }));
      await interaction.reply(buildTicketSetupPayload(updated, getConfig(), "Описание обновлено."));
      return true;
    }

    if (id === "at:config:modal") {
      if (!isModerator(interaction.member)) {
        await replyNoPermission(interaction);
        return true;
      }
      const previous = getConfig();
      const nextConfig = createDefaultAntiteamConfig({
        ...previous,
        channelId: parseEntityId(interaction.fields.getTextInputValue("channel_id")),
        battalionRoleId: parseEntityId(interaction.fields.getTextInputValue("battalion_role_id")),
        battalionLeadRoleId: parseEntityId(interaction.fields.getTextInputValue("battalion_lead_role_id")),
        clanCallerRoleId: parseEntityId(interaction.fields.getTextInputValue("clan_caller_role_id")),
        clanPingRoles: parseClanPingRolesText(interaction.fields.getTextInputValue("clan_ping_roles"), previous.clanPingRoles),
      });
      for (const role of nextConfig.clanPingRoles) {
        if (role.key === "battalion" && !role.roleId) role.roleId = nextConfig.battalionRoleId;
        if (role.key === "battalion_lead" && !role.roleId) role.roleId = nextConfig.battalionLeadRoleId;
      }
      await persist("antiteam-config", () => {
        const state = getState();
        state.config = nextConfig;
        return { mutated: true };
      });
      await interaction.reply(buildModeratorPanelPayload(getState(), "Настройки антитима сохранены."));
      return true;
    }

    if (id === "at:panel_text:modal") {
      if (!isModerator(interaction.member)) {
        await replyNoPermission(interaction);
        return true;
      }
      const previous = getConfig();
      const nextConfig = createDefaultAntiteamConfig({
        ...previous,
        panel: {
          ...previous.panel,
          title: interaction.fields.getTextInputValue("title"),
          description: interaction.fields.getTextInputValue("description"),
          details: interaction.fields.getTextInputValue("details"),
          buttonLabel: interaction.fields.getTextInputValue("button_label"),
          accentColor: parseColorInput(interaction.fields.getTextInputValue("accent_color"), previous.panel?.accentColor),
        },
      });
      await persist("antiteam-panel-text", () => {
        const state = getState();
        state.config = nextConfig;
        return { mutated: true };
      });
      const editResult = await editPublishedStartPanel().catch(() => ({ edited: false }));
      await interaction.reply(buildModeratorPanelPayload(
        getState(),
        editResult.edited
          ? "Стартовая панель сохранена и обновлена в канале."
          : "Стартовая панель сохранена. Опубликуй её заново, если старое сообщение уже удалено."
      ));
      return true;
    }

    if (id === "at:config_advanced:modal") {
      if (!isModerator(interaction.member)) {
        await replyNoPermission(interaction);
        return true;
      }
      const previous = getConfig();
      const nextConfig = createDefaultAntiteamConfig({
        ...previous,
        missionAutoArchiveMinutes: parsePositiveIntegerInput(
          interaction.fields.getTextInputValue("archive_minutes"),
          previous.missionAutoArchiveMinutes
        ),
        missionAutoCloseMinutes: parsePositiveIntegerInput(
          interaction.fields.getTextInputValue("close_minutes"),
          previous.missionAutoCloseMinutes
        ),
        roblox: {
          ...previous.roblox,
          jjsPlaceId: cleanString(interaction.fields.getTextInputValue("place_id"), 40),
          directJoinUrlTemplate: cleanString(interaction.fields.getTextInputValue("direct_join_template"), 500) || previous.roblox.directJoinUrlTemplate,
          friendRequestsUrl: cleanString(interaction.fields.getTextInputValue("friend_requests_url"), 500) || previous.roblox.friendRequestsUrl,
        },
      });
      await persist("antiteam-config-advanced", () => {
        const state = getState();
        state.config = nextConfig;
        return { mutated: true };
      });
      await interaction.reply(buildModeratorPanelPayload(getState(), "Roblox-ссылки и тайминги антитима сохранены."));
      return true;
    }

    const parts = id.split(":");
    if (parts[0] !== "at" || parts.length < 3) return false;
    const action = parts[1];
    const ticketId = parts[2];
    const extra = parts.slice(3).join(":");
    const ticket = getState().tickets[ticketId];
    if (!ticket) {
      await interaction.reply({ content: "Миссия не найдена.", flags: MessageFlags.Ephemeral });
      return true;
    }

    if (action === "report_modal") {
      const reason = interaction.fields.getTextInputValue("reason");
      const updated = await persist("antiteam-report", () => updateAntiteamTicket(db, ticketId, (current) => {
        current.reports.push({
          byUserId: interaction.user.id,
          byTag: getUserTag(interaction.user),
          reason,
          createdAt: nowIso(),
        });
        current.updatedAt = nowIso();
        current.lastActivityAt = nowIso();
        return current;
      }));
      if (typeof options.logLine === "function") {
        await options.logLine(`ANTITEAM_REPORT: ${ticketId} by ${interaction.user.id}: ${cleanString(reason, 300)}`).catch(() => null);
      }
      await syncTicketMessages(updated).catch(() => {});
      await interaction.reply({ content: "Жалоба записана и передана модерации.", flags: MessageFlags.Ephemeral });
      return true;
    }

    if (action === "escalate_modal") {
      if (!canManageTicket(interaction, ticket)) {
        await replyNoPermission(interaction);
        return true;
      }
      const nextLevel = cleanString(extra, 40);
      const reason = interaction.fields.getTextInputValue("reason");
      if (!ANTITEAM_LEVELS[nextLevel]) {
        await interaction.reply({ content: "Некорректный уровень опасности.", flags: MessageFlags.Ephemeral });
        return true;
      }
      const updated = await persist("antiteam-escalate", () => updateAntiteamTicket(db, ticketId, (current) => {
        const previousLevel = current.level;
        current.level = nextLevel;
        current.escalationHistory.push({
          fromLevel: previousLevel,
          toLevel: nextLevel,
          reason,
          byUserId: interaction.user.id,
          byTag: getUserTag(interaction.user),
          createdAt: nowIso(),
        });
        current.updatedAt = nowIso();
        current.lastActivityAt = nowIso();
        return current;
      }));
      await syncTicketMessages(updated);
      const roleIds = getTicketPingRoleIds(updated, getConfig());
      if (roleIds.length && updated.message?.threadId) {
        const thread = await fetchTextChannel(updated.message.threadId).catch(() => null);
        await thread?.send?.({
          content: `${roleIds.map((roleId) => `<@&${roleId}>`).join(" ")} опасность повышена: ${cleanString(reason, 300)}`,
          allowedMentions: { roles: roleIds },
        }).catch(() => null);
      }
      await interaction.reply({ content: `Опасность повышена до ${ANTITEAM_LEVELS[nextLevel].label}.`, flags: MessageFlags.Ephemeral });
      return true;
    }

    if (action === "close_modal") {
      if (!canManageTicket(interaction, ticket)) {
        await replyNoPermission(interaction);
        return true;
      }
      const summary = interaction.fields.getTextInputValue("summary");
      const confirmedHelperIds = Object.values(ticket.helpers || {}).filter((helper) => helper.arrived).map((helper) => helper.userId);
      const updated = await persist("antiteam-close", () => {
        const closed = closeAntiteamTicket(db, ticketId, {
          now: nowIso(),
          closedBy: interaction.user.id,
          summaryText: summary,
          confirmedHelperIds,
        });
        for (const helperId of confirmedHelperIds) {
          incrementHelperStats(db, helperId, {
            confirmedArrived: 1,
            lastTicketId: ticketId,
          }, { now: nowIso() });
        }
        return closed;
      });
      await syncTicketMessages(updated);
      await interaction.reply({ content: "Антитим закрыт. Итог записан в заявку.", flags: MessageFlags.Ephemeral });
      return true;
    }

    return false;
  }

  async function handlePhotoMessage(message) {
    if (!message || message.author?.bot) return false;
    const state = getState();
    const request = state.photoRequests?.[message.author.id];
    if (!request) return false;
    if (request.channelId && message.channelId !== request.channelId) return false;

    const attachments = message.attachments?.values ? [...message.attachments.values()] : [];
    const photoAttachment = attachments.find(isImageAttachment);
    if (!photoAttachment) return false;

    const photo = normalizeAttachmentPhoto(photoAttachment, nowIso());
    await persist("antiteam-photo-captured", () => setAntiteamDraft(db, message.author.id, { photo }, { now: nowIso() }));
    let result;
    try {
      result = await publishTicketFromDraft(message.author.id, { skipPhoto: true });
      await message.delete?.().catch(() => {});
    } catch (error) {
      logError("Antiteam photo publish failed:", error?.message || error);
      return false;
    }
    if (result?.ticket && typeof options.logLine === "function") {
      await options.logLine(`ANTITEAM_SUBMIT_WITH_PHOTO: <@${message.author.id}> ${result.ticket.id}`).catch(() => null);
    }
    return true;
  }

  async function sweepIdleTickets() {
    const idle = findIdleAntiteamTickets(db, nowIso());
    const closed = [];
    for (const ticket of idle) {
      const updated = await persist("antiteam-auto-close", () => closeAntiteamTicket(db, ticket.id, {
        now: nowIso(),
        closedBy: "system",
        summaryText: "Автозавершено после 2 часов без движения.",
        confirmedHelperIds: Object.values(ticket.helpers || {}).filter((helper) => helper.arrived).map((helper) => helper.userId),
        autoClosed: true,
      }));
      await syncTicketMessages(updated).catch(() => {});
      closed.push(updated);
    }
    return { closedCount: closed.length, closed };
  }

  return {
    canCallClan,
    handleButtonInteraction,
    handleModalSubmitInteraction,
    handlePhotoMessage,
    handleSelectMenuInteraction,
    handleSlashCommand,
    isModerator,
    publishStartPanel,
    sweepIdleTickets,
  };
}

module.exports = {
  ANTITEAM_COMMAND_NAME,
  createAntiteamOperator,
  getTicketPingRoleIds,
  normalizeUsernameInput,
  parseClanPingRolesText,
  parseEntityId,
};
