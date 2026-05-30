"use strict";

const { AttachmentBuilder, ChannelType, MessageFlags, PermissionsBitField } = require("discord.js");
const { getRobloxBindingRecoveryText } = require("../integrations/roblox-binding-status");
const { resolveUsableVerifiedRobloxIdentity } = require("../integrations/shared-profile");
const {
  ANTITEAM_HELPER_REWARD_THRESHOLDS,
  ANTITEAM_LEVELS,
  cleanString,
  clearAntiteamDraft,
  clearHelperStats,
  closeAntiteamTicket,
  createAntiteamTicketFromDraft,
  createDefaultAntiteamConfig,
  deleteHelperStats,
  ensureAntiteamState,
  findIdleAntiteamTickets,
  getAntiteamDraft,
  getRobloxConfirmation,
  incrementHelperStats,
  markRobloxConfirmed,
  matchRobloxFriendsToDiscordProfiles,
  normalizeAntiteamPingMode,
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
  buildHelperRewardRolesModal,
  buildHelperStatsPayload,
  buildHelpReplyPayload,
  buildModeratorPanelPayload,
  buildPanelTextModal,
  buildPingConfigModal,
  buildPhotoRequestPayload,
  buildReportModal,
  buildRobloxConfirmPayload,
  buildRobloxMissingPayload,
  buildRobloxUsernameModal,
  buildStartPanelPayload,
  buildStartGuidePayload,
  buildSupportProgressPayload,
  buildThreadName,
  buildThreadPanelPayload,
  buildTicketPublicPayload,
  buildTicketSetupPayload,
  formatRoleMention,
  ticketButtonId,
} = require("./view");
const {
  getSupportProgressModel,
  renderSupportProgressCard,
} = require("./support-progress");

function noop() {}

const ANTITEAM_TRANSIENT_PING_DELETE_MS = 250;
const ANTITEAM_SUPPORT_PROGRESS_CACHE_MAX = 100;
const ANTITEAM_SUPPORT_PROGRESS_CACHE_TTL_MS = 5 * 60 * 1000;
const ANTITEAM_EDIT_PING_DELETE_MS = 5000;
const ANTITEAM_ROLE_GRANT_RETRY_DELAYS_MS = [2000, 10000, 30000];
const ANTITEAM_UNKNOWN_INTERACTION_CODES = new Set([10062]);
const ANTITEAM_ALREADY_ACK_CODES = new Set([40060]);

function normalizeUsernameInput(value) {
  const username = cleanString(value, 40);
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
    throw new Error("Roblox ник должен содержать 3-20 символов: буквы, цифры или _.");
  }
  return username;
}

function getUserTag(user = {}) {
  const source = user || {};
  return cleanString(source.tag || source.username || source.globalName || source.id, 120);
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

function parsePingModeInput(value, fallback = "battalion") {
  const normalized = cleanString(value, 40).toLowerCase().replace(/[\s-]+/g, "_");
  if (["1", "bat", "battalion", "батальон", "батальён"].includes(normalized)) return "battalion";
  if (["2", "role", "custom", "custom_role", "роль", "кастом", "кастомная_роль"].includes(normalized)) return "custom_role";
  if (["3", "everyone", "@everyone", "all", "everyone_ping", "эвериван", "эвриван"].includes(normalized)) return "everyone";
  if (["4", "edit", "edit_roles", "edit_role", "edit_ping", "probe", "test", "buffer", "тест", "буфер"].includes(normalized)) return "edit_roles";
  return normalizeAntiteamPingMode(normalized, fallback);
}

function parseEntityIdList(value = "", limit = 25) {
  const roleIds = [];
  const seen = new Set();
  for (const token of String(value || "").split(/[\s,;]+/)) {
    const roleId = parseEntityId(token);
    if (!roleId || seen.has(roleId)) continue;
    seen.add(roleId);
    roleIds.push(roleId);
    if (roleIds.length >= limit) break;
  }
  return roleIds;
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
  return [
    config.battalionRoleId,
    ...(Array.isArray(config.battalionPingRoleIds) ? config.battalionPingRoleIds : []),
  ]
    .map((roleId) => cleanString(roleId, 80))
    .filter(Boolean)
    .filter((roleId, index, roleIds) => roleIds.indexOf(roleId) === index);
}

function getEditPingRoleIds(config = createDefaultAntiteamConfig()) {
  return createDefaultAntiteamConfig(config).editPingRoleIds
    .map((roleId) => cleanString(roleId, 80))
    .filter(Boolean)
    .filter((roleId, index, roleIds) => roleIds.indexOf(roleId) === index);
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
  const nowMs = typeof options.nowMs === "function" ? options.nowMs : () => Date.now();
  const logError = typeof options.logError === "function" ? options.logError : noop;
  const scheduleTimeout = typeof options.setTimeout === "function" ? options.setTimeout : setTimeout;
  const supportProgressCache = new Map();
  const supportProgressInFlight = new Map();
  let submitPanelResendInFlight = null;
  let submitPanelResendQueued = false;

  function getState() {
    return ensureAntiteamState(db).state;
  }

  function getConfig() {
    return getState().config;
  }

  function getRobloxRuntimeState() {
    return typeof options.getRobloxRuntimeState === "function" ? options.getRobloxRuntimeState() : null;
  }

  function writeDraft(userId, patch = {}) {
    return setAntiteamDraft(db, userId, patch, { now: nowIso() });
  }

  function runDetached(task, onError = noop, { delayMs = 0 } = {}) {
    const run = () => {
      Promise.resolve()
        .then(task)
        .catch(onError);
    };
    if (Number(delayMs) > 0) {
      const timer = scheduleTimeout(run, Math.max(0, Number(delayMs) || 0));
      if (timer && typeof timer.unref === "function") timer.unref();
      return;
    }
    run();
  }

  function emitAntiteamLatency(event, fields = {}) {
    const parts = Object.entries(fields)
      .map(([key, value]) => {
        if (value == null || value === "") return "";
        if (typeof value === "number") return `${key}=${Math.max(0, Math.round(value))}`;
        return `${key}=${cleanString(String(value), 120)}`;
      })
      .filter(Boolean);
    const line = `[antiteam][latency] event=${cleanString(event, 80) || "unknown"}${parts.length ? ` ${parts.join(" ")}` : ""}`;
    if (typeof options.logLine === "function") {
      runDetached(() => options.logLine(line), noop);
      return;
    }
    logError(line);
  }

  function buildSupportProgressCacheKey(userId = "", displayName = "", stats = {}) {
    return JSON.stringify({
      userId: cleanString(userId, 80),
      displayName: cleanString(displayName, 120),
      responded: Number(stats?.responded) || 0,
      linkGranted: Number(stats?.linkGranted) || 0,
      confirmedArrived: Number(stats?.confirmedArrived) || 0,
      lastHelpedAt: cleanString(stats?.lastHelpedAt, 80),
    });
  }

  function pruneSupportProgressCache() {
    const currentTime = nowMs();
    for (const [cacheKey, entry] of supportProgressCache.entries()) {
      if (!entry || entry.expiresAt <= currentTime) {
        supportProgressCache.delete(cacheKey);
      }
    }
    while (supportProgressCache.size > ANTITEAM_SUPPORT_PROGRESS_CACHE_MAX) {
      const oldestKey = supportProgressCache.keys().next().value;
      if (!oldestKey) break;
      supportProgressCache.delete(oldestKey);
    }
  }

  function getCachedSupportProgressCard(cacheKey = "") {
    if (!cacheKey) return null;
    const entry = supportProgressCache.get(cacheKey);
    if (!entry) return null;
    if (entry.expiresAt <= nowMs()) {
      supportProgressCache.delete(cacheKey);
      return null;
    }
    return entry.image;
  }

  function setCachedSupportProgressCard(cacheKey = "", image = null) {
    if (!cacheKey || !image) return;
    pruneSupportProgressCache();
    supportProgressCache.set(cacheKey, {
      image,
      expiresAt: nowMs() + ANTITEAM_SUPPORT_PROGRESS_CACHE_TTL_MS,
    });
  }

  async function getOrRenderSupportProgressCard(cacheKey = "", render = async () => null) {
    const cachedImage = getCachedSupportProgressCard(cacheKey);
    if (cachedImage) return { image: cachedImage, cache: "hit" };

    const sharedRender = supportProgressInFlight.get(cacheKey);
    if (sharedRender) {
      return { image: await sharedRender, cache: "shared" };
    }

    const renderPromise = Promise.resolve()
      .then(render)
      .then((image) => {
        setCachedSupportProgressCard(cacheKey, image);
        return image;
      })
      .finally(() => {
        supportProgressInFlight.delete(cacheKey);
      });
    supportProgressInFlight.set(cacheKey, renderPromise);
    return { image: await renderPromise, cache: "miss" };
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

  function getInteractionType(interaction = {}) {
    if (interaction?.isButton?.()) return "button";
    if (interaction?.isStringSelectMenu?.()) return "select";
    if (interaction?.isModalSubmit?.()) return "modal";
    if (interaction?.isChatInputCommand?.()) return "command";
    return "unknown";
  }

  function getInteractionErrorCode(error = {}) {
    return Number(error?.code || error?.rawError?.code || error?.status || 0) || 0;
  }

  function isUnknownInteractionError(error = {}) {
    const code = getInteractionErrorCode(error);
    const message = cleanString(error?.message || error?.rawError?.message, 240).toLowerCase();
    return ANTITEAM_UNKNOWN_INTERACTION_CODES.has(code) || message.includes("unknown interaction");
  }

  function isAlreadyAcknowledgedError(error = {}) {
    const code = getInteractionErrorCode(error);
    const message = cleanString(error?.message || error?.rawError?.message, 240).toLowerCase();
    return ANTITEAM_ALREADY_ACK_CODES.has(code) || message.includes("already been sent or deferred");
  }

  function markInteractionAcknowledged(interaction = {}, kind = "deferred") {
    if (!interaction || typeof interaction !== "object") return;
    try {
      if (kind === "replied") interaction.replied = true;
      else interaction.deferred = true;
    } catch {
      // discord.js exposes these as readonly in production; tests use plain objects.
    }
  }

  function isInteractionAcknowledged(interaction = {}) {
    return interaction?.deferred === true || interaction?.replied === true;
  }

  function logInteraction(interaction, outcome, extra = {}) {
    const customId = cleanString(interaction?.customId || interaction?.commandName, 120) || "unknown";
    const type = getInteractionType(interaction);
    const userId = cleanString(interaction?.user?.id, 80) || "unknown";
    const parts = [
      `[antiteam][interaction] customId=${customId}`,
      `type=${type}`,
      `user=${userId}`,
      `outcome=${cleanString(outcome, 80) || "unknown"}`,
    ];
    if (extra.acknowledgedAtMs != null) parts.push(`ackMs=${Number(extra.acknowledgedAtMs) || 0}`);
    if (extra.error) {
      const code = getInteractionErrorCode(extra.error);
      if (code) parts.push(`code=${code}`);
      parts.push(`error=${cleanString(extra.error?.message || extra.error, 180)}`);
    }
    logError(parts.join(" "));
  }

  async function safeDeferReply(interaction, payload = { flags: MessageFlags.Ephemeral }) {
    if (isInteractionAcknowledged(interaction)) {
      logInteraction(interaction, "already_acknowledged");
      return { ok: true, alreadyAcknowledged: true };
    }
    const startedAt = Date.now();
    try {
      await interaction.deferReply(payload);
      markInteractionAcknowledged(interaction);
      logInteraction(interaction, "ack_ok", { acknowledgedAtMs: Date.now() - startedAt });
      return { ok: true };
    } catch (error) {
      if (isUnknownInteractionError(error)) {
        logInteraction(interaction, "expired_before_ack", { error });
        return { ok: false, expired: true, error };
      }
      if (isAlreadyAcknowledgedError(error)) {
        logInteraction(interaction, "already_acknowledged", { error });
        markInteractionAcknowledged(interaction);
        return { ok: true, alreadyAcknowledged: true };
      }
      logInteraction(interaction, "ack_failed", { error });
      throw error;
    }
  }

  async function safeDeferUpdate(interaction) {
    if (isInteractionAcknowledged(interaction)) {
      logInteraction(interaction, "already_acknowledged");
      return { ok: true, alreadyAcknowledged: true };
    }
    const startedAt = Date.now();
    try {
      await interaction.deferUpdate();
      markInteractionAcknowledged(interaction);
      logInteraction(interaction, "ack_ok", { acknowledgedAtMs: Date.now() - startedAt });
      return { ok: true };
    } catch (error) {
      if (isUnknownInteractionError(error)) {
        logInteraction(interaction, "expired_before_ack", { error });
        return { ok: false, expired: true, error };
      }
      if (isAlreadyAcknowledgedError(error)) {
        logInteraction(interaction, "already_acknowledged", { error });
        markInteractionAcknowledged(interaction);
        return { ok: true, alreadyAcknowledged: true };
      }
      logInteraction(interaction, "ack_failed", { error });
      throw error;
    }
  }

  async function safeReply(interaction, payload) {
    try {
      if (isInteractionAcknowledged(interaction)) {
        if (typeof interaction.editReply === "function") {
          await interaction.editReply(payload);
          return true;
        }
        if (typeof interaction.followUp === "function") {
          await interaction.followUp(payload);
          return true;
        }
        return false;
      }
      await interaction.reply(payload);
      markInteractionAcknowledged(interaction, "replied");
      return true;
    } catch (error) {
      if (isUnknownInteractionError(error) || isAlreadyAcknowledgedError(error)) {
        logInteraction(interaction, isUnknownInteractionError(error) ? "expired_before_ack" : "already_acknowledged", { error });
        return false;
      }
      throw error;
    }
  }

  async function safeEditReply(interaction, payload) {
    try {
      await interaction.editReply(payload);
      return true;
    } catch (error) {
      if (isUnknownInteractionError(error) || isAlreadyAcknowledgedError(error)) {
        logInteraction(interaction, isUnknownInteractionError(error) ? "expired_before_ack" : "already_acknowledged", { error });
        return false;
      }
      throw error;
    }
  }

  async function safeDeleteReply(interaction) {
    if (typeof interaction?.deleteReply !== "function") return false;
    try {
      await interaction.deleteReply();
      return true;
    } catch (error) {
      if (isUnknownInteractionError(error) || isAlreadyAcknowledgedError(error)) {
        logInteraction(interaction, isUnknownInteractionError(error) ? "expired_before_ack" : "already_acknowledged", { error });
        return false;
      }
      throw error;
    }
  }

  async function safeFollowUp(interaction, payload) {
    if (typeof interaction?.followUp !== "function") return false;
    try {
      await interaction.followUp(payload);
      return true;
    } catch (error) {
      if (isUnknownInteractionError(error) || isAlreadyAcknowledgedError(error)) {
        logInteraction(interaction, isUnknownInteractionError(error) ? "expired_before_ack" : "already_acknowledged", { error });
        return false;
      }
      throw error;
    }
  }

  async function safeUpdate(interaction, payload) {
    if (isInteractionAcknowledged(interaction)) {
      return safeEditReply(interaction, payload);
    }
    try {
      await interaction.update(payload);
      markInteractionAcknowledged(interaction, "replied");
      return true;
    } catch (error) {
      if (isUnknownInteractionError(error) || isAlreadyAcknowledgedError(error)) {
        logInteraction(interaction, isUnknownInteractionError(error) ? "expired_before_ack" : "already_acknowledged", { error });
        return false;
      }
      throw error;
    }
  }

  async function safeShowModal(interaction, modal) {
    if (isInteractionAcknowledged(interaction)) {
      logInteraction(interaction, "already_acknowledged");
      return false;
    }
    try {
      await interaction.showModal(modal);
      markInteractionAcknowledged(interaction, "replied");
      logInteraction(interaction, "ack_ok");
      return true;
    } catch (error) {
      if (isUnknownInteractionError(error) || isAlreadyAcknowledgedError(error)) {
        logInteraction(interaction, isUnknownInteractionError(error) ? "expired_before_ack" : "already_acknowledged", { error });
        return false;
      }
      throw error;
    }
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

  function canCloseTicket(interaction, ticket = {}) {
    return cleanString(interaction?.user?.id, 80) === ticket.createdBy || hasAdmin(interaction?.member);
  }

  function buildExtraPingPayload(ticket = {}, config = createDefaultAntiteamConfig()) {
    if (ticket.kind === "clan") return null;
    const mode = normalizeAntiteamPingMode(config.pingMode, "battalion");
    if (mode === "custom_role") {
      const roleId = cleanString(config.extraPingRoleId, 80);
      return roleId
        ? { content: `<@&${roleId}>`, allowedMentions: { roles: [roleId] } }
        : null;
    }
    if (mode === "everyone") {
      return { content: "@everyone", allowedMentions: { parse: ["everyone"] } };
    }
    return null;
  }

  function scheduleTransientPingDelete(message = null, delayMs = ANTITEAM_TRANSIENT_PING_DELETE_MS) {
    if (typeof message?.delete !== "function") return;
    const timer = scheduleTimeout(() => {
      Promise.resolve(message.delete()).catch((error) => {
        logError("Antiteam transient ping cleanup failed:", error?.message || error);
      });
    }, delayMs);
    if (timer && typeof timer.unref === "function") timer.unref();
  }

  async function sendEditPingMessage(thread, ticket = {}, config = createDefaultAntiteamConfig()) {
    if (ticket.kind === "clan") return null;
    const mode = normalizeAntiteamPingMode(config.pingMode, "battalion");
    if (mode !== "edit_roles") return null;
    const roleIds = getEditPingRoleIds(config);
    if (!roleIds.length || !thread?.send) return null;

    const bufferMessage = await thread.send({
      content: ".",
      allowedMentions: { parse: [] },
    });
    try {
      if (typeof bufferMessage?.edit !== "function") return bufferMessage;
      await bufferMessage.edit({
        content: roleIds.map((roleId) => `<@&${roleId}>`).join(" "),
        allowedMentions: { roles: roleIds },
      });
      return bufferMessage;
    } finally {
      scheduleTransientPingDelete(bufferMessage, ANTITEAM_EDIT_PING_DELETE_MS);
    }
  }

  async function sendTicketPingMessages(thread, ticket = {}, config = createDefaultAntiteamConfig()) {
    const pingRoleIds = getTicketPingRoleIds(ticket, config);
    let pingMessage = null;
    if (thread && pingRoleIds.length) {
      pingMessage = await thread.send({
        content: pingRoleIds.map((roleId) => `<@&${roleId}>`).join(" "),
        allowedMentions: { roles: pingRoleIds },
      }).catch(() => null);
    }

    if (thread && normalizeAntiteamPingMode(config.pingMode, "battalion") === "edit_roles") {
      await sendEditPingMessage(thread, ticket, config).catch((error) => {
        logError("Antiteam edit ping failed:", error?.message || error);
        return null;
      });
    }

    const extraPayload = buildExtraPingPayload(ticket, config);
    if (thread && extraPayload) {
      const extraMessage = await thread.send(extraPayload).catch((error) => {
        logError("Antiteam extra ping failed:", error?.message || error);
        return null;
      });
      scheduleTransientPingDelete(extraMessage);
    }

    return pingMessage;
  }

  async function cleanupClosedTicketResources(ticket = {}) {
    const threadId = cleanString(ticket.message?.threadId, 80);
    if (!threadId) return;
    const thread = await fetchTextChannel(threadId).catch(() => null);
    if (!thread) return;

    const pingMessageId = cleanString(ticket.message?.pingMessageId, 80);
    if (pingMessageId && thread.messages?.fetch) {
      const pingMessage = await thread.messages.fetch(pingMessageId).catch(() => null);
      if (pingMessage?.delete) {
        await pingMessage.delete().catch((error) => {
          logError("Antiteam ping cleanup failed:", error?.message || error);
        });
      }
    }

    if (typeof thread.setLocked === "function") {
      await thread.setLocked(true, "antiteam mission closed").catch((error) => {
        logError("Antiteam thread lock failed:", error?.message || error);
      });
    }
    if (typeof thread.setArchived === "function") {
      await thread.setArchived(true, "antiteam mission closed").catch((error) => {
        logError("Antiteam thread archive failed:", error?.message || error);
      });
    }
  }

  async function finalizeClosedTicket(ticket = {}) {
    await syncTicketMessages(ticket).catch(() => {});
    await cleanupClosedTicketResources(ticket).catch(() => {});
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

  async function grantConfiguredRole(userId, roleId, reason = "antiteam role grant") {
    const normalizedRoleId = cleanString(roleId, 80);
    if (!normalizedRoleId) return { skipped: "missing-role" };
    if (typeof options.grantRole === "function") {
      const result = await options.grantRole(userId, normalizedRoleId, reason);
      return result || { granted: true, roleId: normalizedRoleId };
    }
    const member = typeof options.fetchMember === "function" ? await options.fetchMember(userId).catch(() => null) : null;
    if (!member?.roles?.add) return { skipped: "missing-member" };
    if (member.roles.cache?.has?.(normalizedRoleId)) return { skipped: "already-has-role" };
    await member.roles.add(normalizedRoleId, reason);
    return { granted: true, roleId: normalizedRoleId };
  }

  async function removeConfiguredRole(userId, roleId, reason = "antiteam role cleanup") {
    const normalizedRoleId = cleanString(roleId, 80);
    if (!normalizedRoleId) return { skipped: "missing-role" };
    if (typeof options.removeRole === "function") {
      const result = await options.removeRole(userId, normalizedRoleId, reason);
      return result || { removed: true, roleId: normalizedRoleId };
    }
    const member = typeof options.fetchMember === "function" ? await options.fetchMember(userId).catch(() => null) : null;
    if (!member?.roles?.remove) return { skipped: "missing-member" };
    if (member.roles.cache?.has?.(normalizedRoleId) === false) return { skipped: "member-missing-role" };
    await member.roles.remove(normalizedRoleId, reason);
    return { removed: true, roleId: normalizedRoleId };
  }

  async function grantBattalionRole(userId, reason = "antiteam participant") {
    const roleId = cleanString(getConfig().battalionRoleId, 80);
    if (!roleId) return { skipped: "missing-role" };
    return grantConfiguredRole(userId, roleId, reason);
  }

  function shouldRetryBattalionRoleGrant(result = null, error = null) {
    if (error) return true;
    const hasRoleGrantTransport = typeof options.grantRole === "function" || typeof options.fetchMember === "function";
    if (!hasRoleGrantTransport) return false;
    const skipped = cleanString(result?.skipped, 80);
    return skipped === "missing-member" || skipped === "missing-member-or-role";
  }

  function ensureBattalionRoleGrantedEventually(ticket = {}) {
    const ticketId = cleanString(ticket?.id, 80) || "unknown";
    const userId = cleanString(ticket?.createdBy, 80);
    if (!userId) return;

    const attemptGrant = async (attemptIndex = 0) => {
      const startedAt = nowMs();
      let roleResult = null;
      let roleError = null;
      try {
        roleResult = await grantBattalionRole(userId, "antiteam request created");
      } catch (error) {
        roleError = error;
      }

      const outcome = roleResult?.granted ? "granted" : roleResult?.skipped || (roleError ? "error" : "failed");
      emitAntiteamLatency("submit_role_grant", {
        ticketId,
        attempt: attemptIndex + 1,
        durationMs: nowMs() - startedAt,
        outcome,
      });

      if (roleResult?.granted || roleResult?.skipped === "already-has-role") return;

      const retryDelayMs = ANTITEAM_ROLE_GRANT_RETRY_DELAYS_MS[attemptIndex];
      if (Number.isFinite(retryDelayMs) && shouldRetryBattalionRoleGrant(roleResult, roleError)) {
        logError(
          `Antiteam battalion role grant retry scheduled [${ticketId}/${userId}] attempt ${attemptIndex + 1}:`,
          roleError?.message || roleResult?.skipped || "unknown"
        );
        runDetached(() => attemptGrant(attemptIndex + 1), noop, { delayMs: retryDelayMs });
        return;
      }

      if (roleError) {
        logError(`Antiteam battalion role grant failed [${ticketId}/${userId}] attempt ${attemptIndex + 1}:`, roleError?.message || roleError);
        return;
      }
      if (roleResult?.skipped) {
        logError(`Antiteam battalion role grant incomplete [${ticketId}/${userId}] attempt ${attemptIndex + 1}: ${roleResult.skipped}`);
        return;
      }
      logError(`Antiteam battalion role grant failed [${ticketId}/${userId}] attempt ${attemptIndex + 1}: unknown`);
    };

    runDetached(() => attemptGrant(0), noop);
  }

  function getConfiguredHelperRewardRoleIds(config = getConfig()) {
    const roleIds = [];
    for (const threshold of ANTITEAM_HELPER_REWARD_THRESHOLDS) {
      const roleId = cleanString(config.helperRewardRoles?.[String(threshold)], 80);
      if (roleId) roleIds.push(roleId);
    }
    return [...new Set(roleIds)];
  }

  function getHelperRewardRoleIds(stats = {}, config = getConfig()) {
    const points = Number(stats?.confirmedArrived) || 0;
    if (points <= 0) return [];
    let desiredRoleId = "";
    for (const threshold of ANTITEAM_HELPER_REWARD_THRESHOLDS) {
      if (points < threshold) continue;
      const roleId = cleanString(config.helperRewardRoles?.[String(threshold)], 80);
      if (roleId) desiredRoleId = roleId;
    }
    return desiredRoleId ? [desiredRoleId] : [];
  }

  async function grantHelperRewardRoles(userId, stats = {}, reason = "antiteam helper reward") {
    const roleIds = getHelperRewardRoleIds(stats);
    const staleRoleIds = roleIds.length
      ? getConfiguredHelperRewardRoleIds().filter((roleId) => !roleIds.includes(roleId))
      : [];
    let granted = 0;
    let removed = 0;
    let desiredRoleReady = roleIds.length === 0;
    for (const roleId of roleIds) {
      const result = await grantConfiguredRole(userId, roleId, reason).catch((error) => {
        logError(`Antiteam helper reward role failed [${userId}/${roleId}]:`, error?.message || error);
        return null;
      });
      if (result && (result.skipped === "already-has-role" || !result.skipped)) desiredRoleReady = true;
      if (result && !result.skipped) granted += 1;
    }
    if (desiredRoleReady) {
      for (const roleId of staleRoleIds) {
        const result = await removeConfiguredRole(userId, roleId, reason).catch((error) => {
          logError(`Antiteam helper reward role cleanup failed [${userId}/${roleId}]:`, error?.message || error);
          return null;
        });
        if (result && !result.skipped) removed += 1;
      }
    }
    return { users: roleIds.length ? 1 : 0, roles: granted, removed };
  }

  async function syncHelperRewardRoles(userIds = null) {
    const helpers = getState().stats?.helpers || {};
    const ids = Array.isArray(userIds) ? userIds : Object.keys(helpers);
    let users = 0;
    let roles = 0;
    let removed = 0;
    for (const userId of ids) {
      const stats = helpers[userId];
      if (!stats) continue;
      const result = await grantHelperRewardRoles(userId, stats, "antiteam helper reward sync");
      users += result.users;
      roles += result.roles;
      removed += result.removed || 0;
    }
    return { users, roles, removed };
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

  async function resendStartPanelAfterSubmit() {
    if (submitPanelResendInFlight) {
      submitPanelResendQueued = true;
      return submitPanelResendInFlight;
    }

    submitPanelResendInFlight = (async () => {
      let result = null;
      do {
        submitPanelResendQueued = false;
        result = await publishStartPanel();
      } while (submitPanelResendQueued);
      return result;
    })().finally(() => {
      submitPanelResendInFlight = null;
      submitPanelResendQueued = false;
    });

    return submitPanelResendInFlight;
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

  async function refreshStartPanel() {
    const edited = await editPublishedStartPanel();
    if (edited.edited || edited.reason !== "message-not-found") return edited;
    return publishStartPanel("Стартовая панель антитима восстановлена после старта.");
  }

  function isConcreteRobloxGameId(gameId = "") {
    const value = cleanString(gameId, 120);
    return Boolean(value) && !value.startsWith("opaque:") && !value.startsWith("root:");
  }

  function getConfiguredRobloxPlaceId() {
    const config = getConfig();
    const optionPlaceId = typeof options.robloxPlaceId === "function" ? options.robloxPlaceId() : options.robloxPlaceId;
    return cleanString(config.roblox.jjsPlaceId || optionPlaceId, 40);
  }

  function getDirectJoinPlaceId(presence = {}) {
    return cleanString(presence?.placeId || presence?.rootPlaceId || getConfiguredRobloxPlaceId(), 40);
  }

  function getApiPresenceMatchKey(presence = {}, fallbackGameId = "") {
    const concreteGameId = cleanString(presence?.gameId, 120);
    if (isConcreteRobloxGameId(concreteGameId)) return `game:${concreteGameId}`;

    const rootPlaceId = cleanString(presence?.rootPlaceId, 40);
    if (rootPlaceId) return `root:${rootPlaceId}`;

    const placeId = cleanString(presence?.placeId, 40);
    if (placeId) return `place:${placeId}`;

    const runtimeGameId = cleanString(fallbackGameId, 120);
    if (runtimeGameId) return `runtime:${runtimeGameId}`;
    return "";
  }

  function getTicketRuntimeTargetGameId(ticket = {}) {
    const runtimeState = getRobloxRuntimeState();
    const activeSessions = runtimeState?.activeSessionsByDiscordUserId || {};
    const targetUserId = getFriendRequestTargetUserId(ticket);
    return cleanString(activeSessions[targetUserId]?.gameId, 120);
  }

  async function collectApiPresentHelperIds(ticket = {}) {
    if (ticket.status === "closed") return [];
    const helpers = Object.values(ticket.helpers || {}).filter((helper) => cleanString(helper.userId, 80));
    if (!helpers.length) return [];

    const presentIds = new Set();
    const runtimeState = getRobloxRuntimeState();
    const activeSessions = runtimeState?.activeSessionsByDiscordUserId || {};
    const runtimeTargetGameId = getTicketRuntimeTargetGameId(ticket);
    if (runtimeTargetGameId) {
      for (const helper of helpers) {
        const helperGameId = cleanString(activeSessions[helper.userId]?.gameId, 120);
        if (helperGameId && helperGameId === runtimeTargetGameId) presentIds.add(helper.userId);
      }
    }

    if (typeof options.fetchRobloxPresences !== "function") return [...presentIds];
    const targetRobloxId = cleanString(ticket.roblox?.userId, 40);
    const helperRobloxByDiscordId = new Map();
    for (const helper of helpers) {
      const helperRobloxId = cleanString(helper.robloxUserId, 40) || getHelperRobloxSnapshot(helper.userId).userId;
      if (helperRobloxId) helperRobloxByDiscordId.set(helper.userId, helperRobloxId);
    }
    const requestedIds = [...new Set([targetRobloxId, ...helperRobloxByDiscordId.values()].filter(Boolean))];
    if (!targetRobloxId || requestedIds.length < 2) return [...presentIds];

    const presences = await options.fetchRobloxPresences(requestedIds).catch((error) => {
      logError("Antiteam helper presence scan failed:", error?.message || error);
      return [];
    });
    const presenceByRobloxId = new Map();
    for (const [index, presence] of (Array.isArray(presences) ? presences : []).entries()) {
      const presenceUserId = cleanString(presence?.userId, 40) || requestedIds[index];
      if (presenceUserId) presenceByRobloxId.set(presenceUserId, presence);
    }

    const targetPresence = presenceByRobloxId.get(targetRobloxId);
    const targetMatchKey = getApiPresenceMatchKey(targetPresence, runtimeTargetGameId);
    if (!targetMatchKey) return [...presentIds];
    for (const [helperUserId, helperRobloxId] of helperRobloxByDiscordId.entries()) {
      const helperPresence = presenceByRobloxId.get(helperRobloxId);
      if (getApiPresenceMatchKey(helperPresence) === targetMatchKey) presentIds.add(helperUserId);
    }
    return [...presentIds];
  }

  async function syncTicketMessages(ticket) {
    const config = getConfig();
    const publicPayloadOptions = {
      apiPresentHelperIds: await collectApiPresentHelperIds(ticket).catch(() => []),
    };
    const publicMessageSync = (async () => {
      const channel = await fetchTextChannel(ticket.message?.channelId).catch(() => null);
      if (!channel || !ticket.message?.messageId) return;
      const message = await channel.messages?.fetch?.(ticket.message.messageId).catch(() => null);
      if (message) await message.edit(buildTicketPublicPayload(ticket, config, publicPayloadOptions)).catch(() => {});
    })();

    const threadSync = (async () => {
      const thread = await fetchTextChannel(ticket.message?.threadId).catch(() => null);
      if (!thread) return;
      if (ticket.status === "closed" && typeof thread.setName === "function") {
        await thread.setName(buildThreadName(ticket).slice(0, 100), "antiteam mission closed").catch(() => {});
      }
      if (!ticket.message?.threadPanelMessageId) return;
      const panel = await thread.messages?.fetch?.(ticket.message.threadPanelMessageId).catch(() => null);
      if (panel) await panel.edit(buildThreadPanelPayload(ticket, config)).catch(() => {});
    })();

    await Promise.all([publicMessageSync, threadSync]);
  }

  function getDraftPublishError(draft = {}) {
    if (!cleanString(draft.description, 900)) {
      return draft.kind === "clan"
        ? "Для ФАЙТ С КЛАНОМ нужно описание врагов и ситуации."
        : "Описание обязательно: укажи, кто тимится, кого бить, ники/kills или ситуацию любым понятным способом.";
    }
    return "";
  }

  async function requestDraftPhoto(userId) {
    const channelId = getConfig().channelId;
    await persist("antiteam-photo-request", () => {
      const state = getState();
      state.photoRequests[userId] = { userId, channelId, createdAt: nowIso() };
      return { mutated: true };
    });
    return { needsPhoto: true, draft: getAntiteamDraft(db, userId) };
  }

  async function beginTicketPublish(userId, { skipPhoto = false } = {}) {
    const draft = getAntiteamDraft(db, userId);
    if (!draft) throw new Error("Черновик антитима истёк. Начни заново.");

    const draftError = getDraftPublishError(draft);
    if (draftError) throw new Error(draftError);

    if (draft.photoWanted && !draft.photo && !skipPhoto) {
      return requestDraftPhoto(userId);
    }

    const config = getConfig();
    if (!config.channelId) throw new Error("Канал антитима не настроен.");

    const ticket = await persist("antiteam-ticket-create", () => createAntiteamTicketFromDraft(db, draft, {
      now: nowIso(),
      friendEligibleDiscordUserIds: [],
    }));
    return { draft, ticket };
  }

  async function finalizeTicketPublish(ticket, draft) {
    const finalizeStartedAt = nowMs();
    const config = getConfig();
    const channel = await fetchTextChannel(config.channelId);
    if (!channel?.isTextBased?.()) throw new Error("Канал антитима не найден или не текстовый.");
    const channelType = Number(channel.type);
    if (Number.isSafeInteger(channelType) && channelType !== ChannelType.GuildText) {
      throw new Error("Канал антитима должен быть обычным текстовым каналом, чтобы миссии создавали Public Thread.");
    }

    const friendEligibleStartedAt = nowMs();
    const friendEligibleDiscordUserIdsPromise = collectFriendEligibleDiscordIds(draft);
    const publicPayload = buildTicketPublicPayload(ticket, config, {
      attachPhoto: Boolean(ticket.photos?.length || ticket.photo?.url),
    });
    const publicSendStartedAt = nowMs();
    const publicMessage = await channel.send(publicPayload);
    const publicSendMs = nowMs() - publicSendStartedAt;
    // Discord creates a public thread when a thread starts from a public channel message.
    const threadStartStartedAt = nowMs();
    const thread = typeof publicMessage.startThread === "function"
      ? await publicMessage.startThread({
        name: buildThreadName(ticket).slice(0, 100),
        autoArchiveDuration: Math.max(60, Math.min(10080, Number(config.missionAutoArchiveMinutes) || 60)),
      })
      : null;
    const threadStartMs = nowMs() - threadStartStartedAt;
    const threadPanelStartedAt = nowMs();
    const threadPanel = thread
      ? await thread.send(buildThreadPanelPayload(ticket, config)).catch(() => null)
      : null;
    const threadPanelMs = nowMs() - threadPanelStartedAt;
    const pingStartedAt = nowMs();
    const pingMessage = thread ? await sendTicketPingMessages(thread, ticket, config) : null;
    const pingMs = nowMs() - pingStartedAt;
    const friendEligibleDiscordUserIds = await friendEligibleDiscordUserIdsPromise;
    const friendEligibleMs = nowMs() - friendEligibleStartedAt;

    const refsPersistStartedAt = nowMs();
    const updatedTicket = await persist("antiteam-ticket-message-refs", () => updateAntiteamTicket(db, ticket.id, (current) => {
      current.friendEligibleDiscordUserIds = friendEligibleDiscordUserIds;
      current.message = {
        guildId: cleanString(thread?.guildId || publicMessage.guildId || channel.guildId, 80),
        channelId: channel.id,
        messageId: publicMessage.id,
        threadId: thread?.id || "",
        threadPanelMessageId: threadPanel?.id || "",
        pingMessageId: pingMessage?.id || "",
        photoAttachmentName: publicPayload.files?.[0]?.name || "",
        photoAttachmentNames: (publicPayload.files || []).map((file) => file.name).filter(Boolean),
      };
      current.updatedAt = nowIso();
      return current;
    }));
    const refsPersistMs = nowMs() - refsPersistStartedAt;

    const publicEditStartedAt = nowMs();
    if (typeof publicMessage.edit === "function") {
      await publicMessage.edit(buildTicketPublicPayload(updatedTicket, config)).catch(() => {});
    }
    const publicEditMs = nowMs() - publicEditStartedAt;

    ensureBattalionRoleGrantedEventually(ticket);
    runDetached(async () => {
      const panelResendStartedAt = nowMs();
      const panelResult = await resendStartPanelAfterSubmit();
      emitAntiteamLatency("submit_panel_resend", {
        ticketId: ticket.id,
        durationMs: nowMs() - panelResendStartedAt,
        outcome: panelResult?.message ? "published" : panelResult?.reason || "unknown",
      });
    }, (error) => {
      logError("Antiteam panel resend failed:", error?.message || error);
    });
    emitAntiteamLatency("submit_finalize", {
      ticketId: ticket.id,
      publicSendMs,
      threadStartMs,
      threadPanelMs,
      pingMs,
      friendScanMs: friendEligibleMs,
      refsPersistMs,
      publicEditMs,
      totalMs: nowMs() - finalizeStartedAt,
      roleGrant: "detached",
      panelResend: "detached",
    });
    return { ticket: updatedTicket, publicMessage, thread };
  }

  async function rollbackTicketPublish(userId, ticket, draft) {
    await persist("antiteam-ticket-publish-rollback", () => {
      const current = getState();
      delete current.tickets[ticket.id];
      current.drafts[userId] = draft;
      return { mutated: true };
    });
  }

  async function publishTicketFromDraft(userId, { skipPhoto = false } = {}) {
    const started = await beginTicketPublish(userId, { skipPhoto });
    if (started?.needsPhoto) return started;
    try {
      return await finalizeTicketPublish(started.ticket, started.draft);
    } catch (error) {
      await rollbackTicketPublish(userId, started.ticket, started.draft);
      throw error;
    }
  }

  function buildRobloxUserJoinUrl(robloxUserId = "") {
    const userId = cleanString(robloxUserId, 40);
    return userId ? `https://www.roblox.com/games/start?userId=${encodeURIComponent(userId)}` : "";
  }

  async function resolveDirectJoinUrlForRobloxUserId(robloxUserId = "") {
    return (await resolveDirectJoinTargetForRobloxUserId(robloxUserId))?.directJoinUrl || "";
  }

  async function fetchRobloxPresenceMap(robloxUserIds = [], errorLabel = "Antiteam Roblox presence lookup failed:") {
    const requestedIds = [...new Set((Array.isArray(robloxUserIds) ? robloxUserIds : [])
      .map((userId) => cleanString(userId, 40))
      .filter(Boolean))];
    if (!requestedIds.length || typeof options.fetchRobloxPresences !== "function") return new Map();

    const presences = await options.fetchRobloxPresences(requestedIds).catch((error) => {
      logError(errorLabel, error?.message || error);
      return [];
    });

    const presenceByRobloxId = new Map();
    for (const [index, presence] of (Array.isArray(presences) ? presences : []).entries()) {
      const presenceUserId = cleanString(presence?.userId, 40) || requestedIds[index];
      if (presenceUserId) presenceByRobloxId.set(presenceUserId, presence);
    }
    return presenceByRobloxId;
  }

  function getExactDirectJoinTarget(presenceByRobloxId, robloxUserId = "", { requiredGameId = "" } = {}) {
    const config = getConfig();
    const userId = cleanString(robloxUserId, 40);
    const expectedGameId = cleanString(requiredGameId, 120);
    const presence = presenceByRobloxId.get(userId);
    const gameId = cleanString(presence?.gameId, 120);
    const placeId = getDirectJoinPlaceId(presence);
    if (!userId || !isConcreteRobloxGameId(gameId) || !placeId) return null;
    if (expectedGameId && gameId !== expectedGameId) return null;
    return {
      userId,
      gameId,
      placeId,
      directJoinUrl: buildTemplateUrl(config.roblox.directJoinUrlTemplate, { placeId, gameId }),
    };
  }

  function getRuntimeDirectJoinTarget(ticket = {}, { requiredGameId = "" } = {}) {
    const targetDiscordUserId = getFriendRequestTargetUserId(ticket);
    const runtimeState = getRobloxRuntimeState();
    const session = runtimeState?.activeSessionsByDiscordUserId?.[targetDiscordUserId] || null;
    const gameId = cleanString(session?.gameId, 120);
    const expectedGameId = cleanString(requiredGameId, 120);
    const placeId = cleanString(session?.placeId || session?.rootPlaceId, 40) || getConfiguredRobloxPlaceId();
    if (!isConcreteRobloxGameId(gameId) || !placeId) return null;
    if (expectedGameId && gameId !== expectedGameId) return null;
    return {
      userId: cleanString(ticket.roblox?.userId, 40),
      gameId,
      placeId,
      directJoinUrl: buildTemplateUrl(getConfig().roblox.directJoinUrlTemplate, { placeId, gameId }),
    };
  }

  async function resolveDirectJoinTargetForRobloxUserId(robloxUserId = "", { requiredGameId = "" } = {}) {
    const userId = cleanString(robloxUserId, 40);
    const presenceByRobloxId = await fetchRobloxPresenceMap([robloxUserId], "Antiteam direct-join lookup failed:");
    const exactTarget = getExactDirectJoinTarget(presenceByRobloxId, userId, { requiredGameId });
    if (exactTarget) return exactTarget;
    if (requiredGameId) return null;
    const fallbackUrl = buildRobloxUserJoinUrl(userId);
    return fallbackUrl ? { userId, gameId: "", placeId: "", directJoinUrl: fallbackUrl } : null;
  }

  async function resolveDirectJoinTarget(ticket = {}, { requiredGameId = "" } = {}) {
    return getRuntimeDirectJoinTarget(ticket, { requiredGameId })
      || resolveDirectJoinTargetForRobloxUserId(ticket.roblox?.userId, { requiredGameId });
  }

  async function resolveDirectJoinUrl(ticket = {}) {
    return (await resolveDirectJoinTarget(ticket))?.directJoinUrl || "";
  }

  async function findRuntimeBridgeTarget(ticket = {}, helperRoblox = {}) {
    const helperRobloxUserId = cleanString(helperRoblox.userId, 40);
    if (!helperRobloxUserId || typeof options.fetchRobloxFriends !== "function") return null;
    const runtimeState = getRobloxRuntimeState();
    const activeSessions = runtimeState?.activeSessionsByDiscordUserId || {};
    const targetDiscordUserId = getFriendRequestTargetUserId(ticket);
    const runtimeTargetGameId = cleanString(activeSessions[targetDiscordUserId]?.gameId, 120);
    if (!isConcreteRobloxGameId(runtimeTargetGameId)) return null;

    const targetRoute = await resolveDirectJoinTarget(ticket, { requiredGameId: runtimeTargetGameId });
    if (!targetRoute) return null;

    let helperFriendDiscordIds = [];
    try {
      const friends = await options.fetchRobloxFriends(helperRobloxUserId);
      helperFriendDiscordIds = matchRobloxFriendsToDiscordProfiles(db.profiles, friends);
    } catch (error) {
      logError("Antiteam helper friend scan failed:", error?.message || error);
      return null;
    }

    const candidates = [];
    for (const discordUserId of helperFriendDiscordIds) {
      if (discordUserId === targetDiscordUserId) continue;
      const session = activeSessions[discordUserId];
      if (!session || cleanString(session.gameId, 120) !== targetRoute.gameId) continue;
      const roblox = getStoredRobloxSnapshot(discordUserId);
      if (!roblox?.userId) continue;
      candidates.push({ discordUserId, roblox });
    }
    if (!candidates.length) return null;

    const presenceByRobloxId = await fetchRobloxPresenceMap(
      candidates.map(({ roblox }) => roblox.userId),
      "Antiteam bridge direct-join lookup failed:"
    );

    for (const candidate of candidates) {
      const exactRoute = getExactDirectJoinTarget(presenceByRobloxId, candidate.roblox.userId, {
        requiredGameId: targetRoute.gameId,
      });
      if (!exactRoute) continue;
      return {
        discordUserId: candidate.discordUserId,
        roblox: candidate.roblox,
        directJoinUrl: exactRoute.directJoinUrl,
      };
    }
    return null;
  }

  function getFriendRequestTargetUserId(ticket = {}) {
    return ticket.kind === "clan" && cleanString(ticket.anchorUserId, 80)
      ? ticket.anchorUserId
      : ticket.createdBy;
  }

  function buildFriendRequestNoticeText(ticket = {}, helper = {}) {
    const targetUserId = getFriendRequestTargetUserId(ticket);
    const friendRequestsUrl = getConfig().roblox.friendRequestsUrl;
    return [
      `<@${targetUserId}>`,
      `<@${helper.userId}> отправил тебе friend request в Roblox, чтобы подключиться к ${ticket.kind === "clan" ? "ФАЙТ С КЛАНОМ" : "антитиму"}.`,
      helper.robloxUsername
        ? `Roblox helper-а: **${helper.robloxUsername}**${helper.robloxUserId ? ` (${helper.robloxUserId})` : ""}.`
        : "Roblox helper-а в базе не найден, ориентируйся по Discord упоминанию.",
      friendRequestsUrl ? `Принять заявки: ${friendRequestsUrl}` : "",
    ].filter(Boolean).join("\n");
  }

  async function notifyTicketAuthorForFriendRequest(ticket = {}, helper = {}) {
    const targetUserId = getFriendRequestTargetUserId(ticket);
    const helperText = buildFriendRequestNoticeText(ticket, helper);
    const thread = await fetchTextChannel(ticket.message?.threadId).catch(() => null);
    if (thread?.send) {
      const sent = await thread.send({
        content: helperText,
        allowedMentions: { users: [targetUserId, helper.userId].filter(Boolean) },
      }).catch(() => null);
      if (sent) return true;
    }
    if (typeof options.sendDirectMessage !== "function") return false;
    await options.sendDirectMessage(targetUserId, { content: helperText }).catch(() => null);
    return true;
  }

  function getHelperRobloxSnapshot(userId) {
    const profile = typeof options.getProfile === "function" ? options.getProfile(userId) : db.profiles?.[userId];
    const identity = resolveProfileRobloxIdentity(profile);
    return identity
      ? { username: identity.username, userId: identity.userId }
      : { username: "", userId: "" };
  }

  function resolveProfileRobloxIdentity(profile = null) {
    const source = profile && typeof profile === "object" ? profile : null;
    if (!source) return null;
    const legacyProfileRoblox = {
      userId: source.robloxUserId,
      username: source.robloxUsername,
      displayName: source.robloxDisplayName,
      avatarUrl: source.robloxAvatarUrl,
      profileUrl: source.robloxProfileUrl,
      verificationStatus: source.verificationStatus,
      verifiedAt: source.robloxVerifiedAt,
      hasVerifiedAccount: source.hasVerifiedAccount,
    };
    const candidates = [
      source.domains?.roblox,
      source.summary?.roblox,
      source.roblox,
      legacyProfileRoblox,
    ].filter(Boolean);

    for (const roblox of candidates) {
      const identity = resolveUsableVerifiedRobloxIdentity(roblox);
      if (identity) return identity;
    }
    return null;
  }

  function getStoredRobloxSnapshot(userId) {
    const profile = typeof options.getProfile === "function" ? options.getProfile(userId) : db.profiles?.[userId];
    const identity = resolveProfileRobloxIdentity(profile);
    if (identity) {
      return {
        id: identity.userId,
        userId: identity.userId,
        name: identity.username,
        username: identity.username,
        displayName: identity.displayName,
        avatarUrl: identity.avatarUrl,
        profileUrl: identity.profileUrl,
      };
    }
    return null;
  }

  async function handleStartPanelOpenInteraction(interaction) {
    if (!interaction?.isButton?.()) return false;
    const ack = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    const storedRoblox = getStoredRobloxSnapshot(interaction.user.id);
    if (storedRoblox) {
      const confirmation = getRobloxConfirmation(db, interaction.user.id);
      if (confirmation?.robloxUserId !== storedRoblox.userId) {
        if (ack.ok) await safeEditReply(interaction, buildRobloxConfirmPayload(storedRoblox));
        return true;
      }
      return await openTicketDraftWithRoblox(interaction, storedRoblox, "standard", {
        response: "editReply",
        statusText: `Roblox взят из твоего профиля: ${storedRoblox.username}.`,
      });
    }
    const rawProfile = typeof options.getProfile === "function" ? options.getProfile(interaction.user.id) : db.profiles?.[interaction.user.id];
    if (ack.ok) {
      await safeEditReply(interaction, buildRobloxMissingPayload({
        reasonText: getRobloxBindingRecoveryText(rawProfile, { audience: "antiteam" }),
      }));
    }
    return true;
  }

  async function openTicketDraftWithRoblox(interaction, robloxUser, kind = "standard", { response = "reply", statusText = "", anchorUser = null } = {}) {
    const draft = writeDraft(interaction.user.id, {
      kind,
      userTag: getUserTag(interaction.user),
      anchorUserId: kind === "clan" ? cleanString(anchorUser?.id, 80) : "",
      anchorUserTag: kind === "clan" ? getUserTag(anchorUser) : "",
      roblox: robloxUser,
      level: "medium",
      count: "2-4",
      directJoinEnabled: false,
      photoWanted: false,
    });
    const payload = buildTicketSetupPayload(draft, getConfig(), statusText || `Roblox готов: ${draft.roblox.username}.`);
    if (response === "editReply") {
      await safeEditReply(interaction, payload);
    } else {
      await safeReply(interaction, payload);
    }
    if (kind !== "clan") await grantBattalionRole(interaction.user.id, "antiteam roblox ready").catch(() => null);
    return true;
  }

  async function notifyDraftSubmitError(interaction, userId, error) {
    const draft = getAntiteamDraft(db, userId);
    const payload = draft
      ? buildTicketSetupPayload(draft, getConfig(), `Ошибка: ${error?.message || error}`)
      : { content: `Ошибка: ${error?.message || error}`, components: [], flags: MessageFlags.Ephemeral };
    const sent = await safeFollowUp(interaction, payload);
    if (!sent) logError("Antiteam detached draft submit failed:", error?.message || error);
  }

  async function handleHelp(interaction, ticketId) {
    const state = getState();
    const ticket = state.tickets[ticketId];
    if (!ticket || ticket.status !== "open") {
      await interaction.reply({ content: "Эта миссия уже закрыта или не найдена.", flags: MessageFlags.Ephemeral });
      return true;
    }
    if (cleanString(interaction.user.id, 80) === cleanString(ticket.createdBy, 80)) {
      await interaction.reply({ content: "Ты уже позвал помощь по этой заявке. Самому откликаться нельзя.", flags: MessageFlags.Ephemeral });
      return true;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const helperRoblox = getHelperRobloxSnapshot(interaction.user.id);
    const isFriendEligible = ticket.friendEligibleDiscordUserIds.includes(interaction.user.id);
    const targetRoute = await resolveDirectJoinTarget(ticket);
    const bridgeTarget = !ticket.directJoinEnabled && !isFriendEligible
      ? await findRuntimeBridgeTarget(ticket, helperRoblox)
      : null;
    const linkKind = ticket.directJoinEnabled
      ? "direct"
      : isFriendEligible
        ? "friend_direct"
        : bridgeTarget
          ? "bridge_direct"
          : "friend_request";
    const directJoinUrl = linkKind === "bridge_direct"
      ? bridgeTarget.directJoinUrl
      : targetRoute?.directJoinUrl || "";
    const profileUrl = getTicketProfileUrl(ticket);
    const previousHelper = ticket.helpers?.[interaction.user.id] || null;
    const alreadyResponded = Boolean(previousHelper?.respondedAt);
    const alreadyGrantedLink = Boolean(previousHelper?.linkGrantedAt);
    const helperRecord = {
      userId: interaction.user.id,
      discordTag: getUserTag(interaction.user),
      robloxUsername: helperRoblox.username,
      robloxUserId: helperRoblox.userId,
      linkKind,
      bridgeDiscordUserId: bridgeTarget?.discordUserId || "",
      bridgeRobloxUsername: bridgeTarget?.roblox?.username || "",
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

    await interaction.editReply(buildHelpReplyPayload({
      ticket: updated,
      linkKind,
      directJoinUrl,
      profileUrl,
      friendRequestsUrl: getConfig().roblox.friendRequestsUrl,
      bridgeLabel: bridgeTarget?.roblox?.username || "",
      helperRobloxKnown: Boolean(helperRoblox.userId),
      friendRequestNotified: Boolean(updated.helpers?.[interaction.user.id]?.friendRequestNotifiedAt),
    }));

    await syncTicketMessages(updated).catch(() => {});
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
      const anchorUser = typeof interaction.options?.getUser === "function"
        ? interaction.options.getUser("target", true)
        : null;
      if (!anchorUser?.id) {
        await interaction.reply({ content: "Укажи игрока-якоря через target в команде.", flags: MessageFlags.Ephemeral });
        return true;
      }
      if (anchorUser.bot) {
        await interaction.reply({ content: "Якорем должен быть живой участник сервера, не бот.", flags: MessageFlags.Ephemeral });
        return true;
      }
      const storedRoblox = getStoredRobloxSnapshot(anchorUser.id);
      if (!storedRoblox) {
        await interaction.reply({
          content: `У <@${anchorUser.id}> нет проверенного Roblox в профиле. Сначала привяжите ему Roblox, потом вызывай ФАЙТ С КЛАНОМ.`,
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      return await openTicketDraftWithRoblox(interaction, storedRoblox, "clan", {
        response: "editReply",
        anchorUser,
        statusText: `Якорь: <@${anchorUser.id}> • Roblox: ${storedRoblox.username}. Он должен оставаться на сервере.`,
      });
    }

    return false;
  }

  async function handleButtonInteraction(interaction) {
    if (!interaction?.isButton?.() || !cleanString(interaction.customId, 100).startsWith("at:")) return false;
    const id = interaction.customId;

    if (id === ANTITEAM_CUSTOM_IDS.open) {
      return await handleStartPanelOpenInteraction(interaction);
    }

    if (id === ANTITEAM_CUSTOM_IDS.progress) {
      const ack = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
      if (!ack.ok) return true;
      try {
        const helperStats = getState().stats?.helpers?.[interaction.user.id] || {};
        const points = Number(helperStats.confirmedArrived) || 0;
        const model = getSupportProgressModel(points);
        const displayName = getUserTag(interaction.user);
        const cacheKey = buildSupportProgressCacheKey(interaction.user.id, displayName, helperStats);
        const progressStartedAt = nowMs();
        const renderCard = typeof options.renderSupportProgressCard === "function"
          ? options.renderSupportProgressCard
          : renderSupportProgressCard;
        const { image, cache } = await getOrRenderSupportProgressCard(cacheKey, async () => {
          return await renderCard({
            model,
            points,
            stats: helperStats,
            displayName,
          });
        });
        const attachmentName = "antiteam-support-progress.png";
        await safeEditReply(interaction, {
          ...buildSupportProgressPayload(model, { attachmentName }),
          files: [new AttachmentBuilder(image, { name: attachmentName })],
        });
        emitAntiteamLatency("progress_card", {
          userId: interaction.user.id,
          points,
          cache,
          totalMs: nowMs() - progressStartedAt,
        });
      } catch (error) {
        logError("Antiteam support progress render failed:", error?.message || error);
        await safeEditReply(interaction, { content: "Не удалось собрать PNG прогресса. Попробуй ещё раз чуть позже.", components: [] });
      }
      return true;
    }

    if (id === ANTITEAM_CUSTOM_IDS.guide) {
      await safeReply(interaction, buildStartGuidePayload(getConfig()));
      return true;
    }

    if (id === ANTITEAM_CUSTOM_IDS.joinBattalion) {
      const ack = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
      if (!ack.ok) return true;
      let result = null;
      try {
        result = await grantBattalionRole(interaction.user.id, "antiteam battalion self-join");
      } catch (error) {
        logError("Antiteam battalion self-join failed:", error?.message || error);
        await safeEditReply(interaction, { content: "Не смог выдать роль батальёна. Проверь права бота и роль в настройках.", components: [] });
        return true;
      }
      const message = result?.skipped === "missing-role"
        ? "Роль батальёна пока не настроена."
        : result?.skipped === "missing-member"
          ? "Не смог найти тебя на сервере для выдачи роли."
          : result?.skipped === "already-has-role"
            ? "Ты уже в батальоне."
            : "Готово, выдал роль батальёна.";
      await safeEditReply(interaction, { content: message, components: [] });
      return true;
    }

    if (id === ANTITEAM_CUSTOM_IDS.requestRobloxNick || id === ANTITEAM_CUSTOM_IDS.changeRoblox) {
      await safeShowModal(interaction, buildRobloxUsernameModal({ customId: "at:roblox" }));
      return true;
    }

    if (id === ANTITEAM_CUSTOM_IDS.confirmRoblox) {
      const storedRoblox = getStoredRobloxSnapshot(interaction.user.id);
      if (!storedRoblox) {
        await safeReply(interaction, { content: "Roblox в профиле больше не найден. Внеси ник вручную.", flags: MessageFlags.Ephemeral });
        return true;
      }
      const ack = await safeDeferUpdate(interaction);
      await persist("antiteam-roblox-confirm", () => markRobloxConfirmed(db, interaction.user.id, storedRoblox.userId, { now: nowIso() }));
      if (!ack.ok) return true;
      return await openTicketDraftWithRoblox(interaction, storedRoblox, "standard", {
        response: "editReply",
        statusText: `Roblox подтверждён: ${storedRoblox.username}.`,
      });
    }

    if (id === ANTITEAM_CUSTOM_IDS.config) {
      if (!isModerator(interaction.member)) {
        await replyNoPermission(interaction);
        return true;
      }
      await safeShowModal(interaction, buildConfigModal(getConfig()));
      return true;
    }

    if (id === ANTITEAM_CUSTOM_IDS.pingConfig) {
      if (!isModerator(interaction.member)) {
        await replyNoPermission(interaction);
        return true;
      }
      await safeShowModal(interaction, buildPingConfigModal(getConfig()));
      return true;
    }

    if (id === ANTITEAM_CUSTOM_IDS.panelText) {
      if (!isModerator(interaction.member)) {
        await replyNoPermission(interaction);
        return true;
      }
      await safeShowModal(interaction, buildPanelTextModal(getConfig()));
      return true;
    }

    if (id === ANTITEAM_CUSTOM_IDS.configAdvanced) {
      if (!isModerator(interaction.member)) {
        await replyNoPermission(interaction);
        return true;
      }
      await safeShowModal(interaction, buildAdvancedConfigModal(getConfig()));
      return true;
    }

    if (id === ANTITEAM_CUSTOM_IDS.publishPanel) {
      if (!isModerator(interaction.member)) {
        await replyNoPermission(interaction);
        return true;
      }
      const ack = await safeDeferUpdate(interaction);
      try {
        const result = await publishStartPanel();
        if (ack.ok) await safeEditReply(interaction, buildModeratorPanelPayload(getState(), result.statusText));
      } catch (error) {
        if (ack.ok) await safeEditReply(interaction, buildModeratorPanelPayload(getState(), `Ошибка: ${error?.message || error}`));
      }
      return true;
    }

    if (id === ANTITEAM_CUSTOM_IDS.refreshPanel) {
      if (!isModerator(interaction.member)) {
        await replyNoPermission(interaction);
        return true;
      }
      await safeUpdate(interaction, buildModeratorPanelPayload(getState()));
      return true;
    }

    if (id === ANTITEAM_CUSTOM_IDS.stats) {
      if (!isModerator(interaction.member)) {
        await replyNoPermission(interaction);
        return true;
      }
      await safeUpdate(interaction, buildHelperStatsPayload(getState()));
      return true;
    }

    if (id === ANTITEAM_CUSTOM_IDS.statsClear) {
      if (!isModerator(interaction.member)) {
        await replyNoPermission(interaction);
        return true;
      }
      await safeUpdate(interaction, buildHelperStatsPayload(getState(), 0, "", { confirmClear: true }));
      return true;
    }

    if (id === ANTITEAM_CUSTOM_IDS.statsClearConfirm) {
      if (!isModerator(interaction.member)) {
        await replyNoPermission(interaction);
        return true;
      }
      const ack = await safeDeferUpdate(interaction);
      const count = await persist("antiteam-helper-stats-clear", () => clearHelperStats(db));
      if (ack.ok) await safeEditReply(interaction, buildHelperStatsPayload(getState(), 0, `Очищено записей: **${count}**.`));
      return true;
    }

    if (id === ANTITEAM_CUSTOM_IDS.statsRoles) {
      if (!isModerator(interaction.member)) {
        await replyNoPermission(interaction);
        return true;
      }
      await safeShowModal(interaction, buildHelperRewardRolesModal(getConfig()));
      return true;
    }

    if (id === ANTITEAM_CUSTOM_IDS.statsSyncRoles) {
      if (!isModerator(interaction.member)) {
        await replyNoPermission(interaction);
        return true;
      }
      const ack = await safeDeferUpdate(interaction);
      const result = await syncHelperRewardRoles();
      if (ack.ok) await safeEditReply(interaction, buildHelperStatsPayload(
        getState(),
        0,
        `Роли проверены: пользователей с порогами **${result.users}**, успешных выдач/проверок **${result.roles}**, снятий старых ролей **${result.removed}**.`
      ));
      return true;
    }

    if (id.startsWith("at:stats:page:") || id.startsWith("at:stats:delete:")) {
      if (!isModerator(interaction.member)) {
        await replyNoPermission(interaction);
        return true;
      }
      const statsParts = id.split(":");
      const action = statsParts[2];
      if (action === "page") {
        const raw = statsParts[3] || "0";
        await safeUpdate(interaction, buildHelperStatsPayload(getState(), Number.parseInt(raw, 10) || 0));
        return true;
      }
      const helperId = statsParts[3] || "";
      const pageRaw = statsParts[4] || "0";
      const ack = await safeDeferUpdate(interaction);
      const deleted = await persist("antiteam-helper-stats-delete", () => deleteHelperStats(db, helperId));
      if (ack.ok) await safeEditReply(interaction, buildHelperStatsPayload(
        getState(),
        Number.parseInt(pageRaw, 10) || 0,
        deleted ? `Удалена статистика <@${helperId}>.` : "Запись уже не найдена."
      ));
      return true;
    }

    if (id === ANTITEAM_CUSTOM_IDS.toggleDirect || id === ANTITEAM_CUSTOM_IDS.togglePhoto) {
      const draft = getAntiteamDraft(db, interaction.user.id);
      if (!draft) {
        await safeReply(interaction, { content: "Черновик истёк. Начни заново.", flags: MessageFlags.Ephemeral });
        return true;
      }
      const ack = await safeDeferUpdate(interaction);
      const patch = id === ANTITEAM_CUSTOM_IDS.toggleDirect
        ? { directJoinEnabled: !draft.directJoinEnabled }
        : { photoWanted: !draft.photoWanted };
      try {
        const updated = writeDraft(interaction.user.id, patch);
        if (ack.ok) await safeEditReply(interaction, buildTicketSetupPayload(updated, getConfig()));
      } catch (error) {
        const fallbackDraft = getAntiteamDraft(db, interaction.user.id) || draft;
        if (ack.ok) await safeEditReply(interaction, buildTicketSetupPayload(fallbackDraft, getConfig(), `Ошибка: ${error?.message || error}`));
      }
      return true;
    }

    if (id === ANTITEAM_CUSTOM_IDS.editDescription) {
      const draft = getAntiteamDraft(db, interaction.user.id);
      if (!draft) {
        await safeReply(interaction, { content: "Черновик истёк. Начни заново.", flags: MessageFlags.Ephemeral });
        return true;
      }
      await safeShowModal(interaction, buildDescriptionModal(draft));
      return true;
    }

    if (id === ANTITEAM_CUSTOM_IDS.cancelDraft) {
      const draft = getAntiteamDraft(db, interaction.user.id);
      if (!draft) {
        await safeReply(interaction, { content: "Черновик истёк. Начни заново.", flags: MessageFlags.Ephemeral });
        return true;
      }
      const ack = await safeDeferUpdate(interaction);
      await persist("antiteam-draft-cancel", () => {
        clearAntiteamDraft(db, interaction.user.id);
        return { mutated: true };
      });
      if (ack.ok) {
        if (await safeDeleteReply(interaction)) return true;
        await safeEditReply(interaction, {
          content: "Заявка антитима отменена.",
          components: [],
          flags: MessageFlags.Ephemeral,
        });
      }
      return true;
    }

    if (id === ANTITEAM_CUSTOM_IDS.submitDraft || id === ANTITEAM_CUSTOM_IDS.submitWithoutPhoto) {
      const ack = await safeDeferUpdate(interaction);
      let started = null;
      try {
        started = await beginTicketPublish(interaction.user.id, { skipPhoto: id === ANTITEAM_CUSTOM_IDS.submitWithoutPhoto });
        if (started.needsPhoto) {
          if (ack.ok) await safeEditReply(interaction, buildPhotoRequestPayload(started.draft));
        } else {
          const closedReply = ack.ok ? await safeDeleteReply(interaction) : false;
          if (closedReply) {
            runDetached(async () => {
              try {
                await finalizeTicketPublish(started.ticket, started.draft);
              } catch (error) {
                if (started?.ticket && started?.draft) {
                  await rollbackTicketPublish(interaction.user.id, started.ticket, started.draft).catch(() => {});
                }
                await notifyDraftSubmitError(interaction, interaction.user.id, error);
              }
            }, (error) => {
              logError("Antiteam detached submit task failed:", error?.message || error);
            });
          } else {
            if (ack.ok) {
              await safeEditReply(interaction, {
                content: `Заявка принята: ${started.ticket ? `\`${started.ticket.id}\`` : "готово"}. Публикую...`,
                components: [],
                flags: MessageFlags.Ephemeral,
              });
            }
            const result = await finalizeTicketPublish(started.ticket, started.draft);
            if (ack.ok) {
              await safeEditReply(interaction, {
                content: `Заявка опубликована: ${result.ticket ? `\`${result.ticket.id}\`` : "готово"}.`,
                components: [],
                flags: MessageFlags.Ephemeral,
              });
            }
          }
        }
      } catch (error) {
        if (started?.ticket && started?.draft) {
          await rollbackTicketPublish(interaction.user.id, started.ticket, started.draft).catch(() => {});
        }
        const draft = getAntiteamDraft(db, interaction.user.id);
        if (ack.ok) {
          if (draft) {
            await safeEditReply(interaction, buildTicketSetupPayload(draft, getConfig(), `Ошибка: ${error?.message || error}`));
          } else {
            await safeEditReply(interaction, { content: `Ошибка: ${error?.message || error}`, components: [], flags: MessageFlags.Ephemeral });
          }
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

    if (action === "help") return await handleHelp(interaction, ticketId);

    if (action === "toggle_direct") {
      if (!ticket || ticket.status !== "open") {
        await safeReply(interaction, { content: "Эта миссия уже закрыта или не найдена.", flags: MessageFlags.Ephemeral });
        return true;
      }
      if (!canCloseTicket(interaction, ticket)) {
        await replyNoPermission(interaction);
        return true;
      }
      const ack = await safeDeferUpdate(interaction);
      const updated = await persist("antiteam-ticket-toggle-direct", () => updateAntiteamTicket(db, ticket.id, (current) => {
        current.directJoinEnabled = !current.directJoinEnabled;
        current.updatedAt = nowIso();
        current.lastActivityAt = nowIso();
        return current;
      }));
      if (ack.ok) await safeEditReply(interaction, buildThreadPanelPayload(updated, getConfig()));
      await syncTicketMessages(updated).catch(() => {});
      return true;
    }

    if (action === "friend_request_sent") {
      if (!ticket || ticket.status !== "open") {
        await safeReply(interaction, { content: "Эта миссия уже закрыта или не найдена.", flags: MessageFlags.Ephemeral });
        return true;
      }
      const helper = ticket.helpers?.[interaction.user.id];
      if (!helper) {
        await safeReply(interaction, { content: "Сначала нажми «Помочь», чтобы бот записал тебя в миссию.", flags: MessageFlags.Ephemeral });
        return true;
      }
      const ack = await safeDeferUpdate(interaction);
      if (helper.friendRequestNotifiedAt) {
        if (ack.ok) await safeEditReply(interaction, buildHelpReplyPayload({
          ticket,
          linkKind: "friend_request",
          directJoinUrl: await resolveDirectJoinUrl(ticket),
          profileUrl: getTicketProfileUrl(ticket),
          friendRequestsUrl: getConfig().roblox.friendRequestsUrl,
          helperRobloxKnown: Boolean(helper.robloxUserId),
          friendRequestNotified: true,
        }));
        return true;
      }
      const updated = await persist("antiteam-friend-request-sent", () => updateAntiteamTicket(db, ticket.id, (current) => {
        current.helpers ||= {};
        current.helpers[interaction.user.id] ||= helper;
        current.helpers[interaction.user.id].friendRequestNotifiedAt = nowIso();
        current.updatedAt = nowIso();
        current.lastActivityAt = nowIso();
        return current;
      }));
      await notifyTicketAuthorForFriendRequest(updated, updated.helpers[interaction.user.id]).catch(() => false);
      if (ack.ok) await safeEditReply(interaction, buildHelpReplyPayload({
        ticket: updated,
        linkKind: "friend_request",
        directJoinUrl: await resolveDirectJoinUrl(updated),
        profileUrl: getTicketProfileUrl(updated),
        friendRequestsUrl: getConfig().roblox.friendRequestsUrl,
        helperRobloxKnown: Boolean(updated.helpers?.[interaction.user.id]?.robloxUserId),
        friendRequestNotified: true,
      }));
      return true;
    }

    if (action === "report") {
      if (!ticket) {
        await safeReply(interaction, { content: "Миссия не найдена.", flags: MessageFlags.Ephemeral });
        return true;
      }
      await safeShowModal(interaction, buildReportModal(ticketId));
      return true;
    }

    if (action === "escalate") {
      if (!ticket || ticket.kind === "clan" || ticket.status !== "open") {
        await safeReply(interaction, { content: "Повысить эту миссию нельзя.", flags: MessageFlags.Ephemeral });
        return true;
      }
      if (!canManageTicket(interaction, ticket)) {
        await replyNoPermission(interaction);
        return true;
      }
      const nextLevel = getNextEscalationLevel(ticket.level);
      if (!nextLevel) {
        await safeReply(interaction, { content: "Опасность уже на максимуме.", flags: MessageFlags.Ephemeral });
        return true;
      }
      await safeShowModal(interaction, buildEscalateModal(ticketId, nextLevel));
      return true;
    }

    if (action === "close") {
      if (!ticket || ticket.status !== "open") {
        await safeReply(interaction, { content: "Миссия уже закрыта или не найдена.", flags: MessageFlags.Ephemeral });
        return true;
      }
      if (!canCloseTicket(interaction, ticket)) {
        await replyNoPermission(interaction);
        return true;
      }
      await safeReply(interaction, buildCloseReviewPayload(ticket));
      return true;
    }

    if (action === "close_page") {
      if (!ticket || !canCloseTicket(interaction, ticket)) {
        await replyNoPermission(interaction);
        return true;
      }
      await safeUpdate(interaction, buildCloseReviewPayload(ticket, Number.parseInt(extra, 10) || 0));
      return true;
    }

    if (action === "arrived") {
      if (!ticket || !canCloseTicket(interaction, ticket)) {
        await replyNoPermission(interaction);
        return true;
      }
      const [helperId, pageRaw = "0"] = extra.split(":");
      const current = ticket.helpers?.[helperId];
      if (!current) {
        await safeReply(interaction, { content: "Helper не найден в этой миссии.", flags: MessageFlags.Ephemeral });
        return true;
      }
      const page = Number.parseInt(pageRaw, 10) || 0;
      const arrived = current.arrived === false;
      const optimisticTicket = {
        ...ticket,
        helpers: {
          ...(ticket.helpers || {}),
          [helperId]: {
            ...current,
            arrived,
            arrivedSetAt: nowIso(),
          },
        },
      };
      await safeUpdate(interaction, buildCloseReviewPayload(optimisticTicket, page));
      await persist("antiteam-arrival-toggle", () => setTicketHelperArrival(db, ticket.id, helperId, arrived, { now: nowIso() }));
      return true;
    }

    if (action === "close_finish") {
      if (!ticket || !canCloseTicket(interaction, ticket)) {
        await replyNoPermission(interaction);
        return true;
      }
      await safeShowModal(interaction, buildCloseSummaryModal(ticketId));
      return true;
    }

    return false;
  }

  async function handleSelectMenuInteraction(interaction) {
    if (!interaction?.isStringSelectMenu?.() || !cleanString(interaction.customId, 100).startsWith("at:")) return false;
    const draft = getAntiteamDraft(db, interaction.user.id);
    if (!draft) {
      await safeReply(interaction, { content: "Черновик истёк. Начни заново.", flags: MessageFlags.Ephemeral });
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
    const ack = await safeDeferUpdate(interaction);
    try {
      const updated = writeDraft(interaction.user.id, patch);
      if (ack.ok) await safeEditReply(interaction, buildTicketSetupPayload(updated, getConfig()));
    } catch (error) {
      const fallbackDraft = getAntiteamDraft(db, interaction.user.id) || draft;
      if (ack.ok) await safeEditReply(interaction, buildTicketSetupPayload(fallbackDraft, getConfig(), `Ошибка: ${error?.message || error}`));
    }
    return true;
  }

  async function handleRobloxModal(interaction, kind = "standard") {
    const username = normalizeUsernameInput(interaction.fields.getTextInputValue("roblox_username"));
    const ack = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    const robloxUser = await fetchRobloxUserByUsername(username);
    if (!robloxUser?.userId && !robloxUser?.id) {
      if (ack.ok) await safeEditReply(interaction, "Такой Roblox ник не найден через Roblox API.");
      return true;
    }

    let statusText = kind === "clan"
      ? `Якорь подтверждён: ${cleanString(robloxUser.username || robloxUser.name, 120)}. Это не привязка к твоему профилю.`
      : `Roblox найден через API: ${cleanString(robloxUser.username || robloxUser.name, 120)}.`;

    if (kind === "standard") {
      try {
        await writeRobloxBinding(interaction.user.id, robloxUser, "antiteam_modal");
        await persist("antiteam-roblox-confirm", () => markRobloxConfirmed(
          db,
          interaction.user.id,
          robloxUser.userId || robloxUser.id,
          { now: nowIso() }
        ));
        statusText = `${statusText} Профиль обновлён, подтверждение для антитима сохранено.`;
      } catch (error) {
        logError("Antiteam Roblox profile sync failed:", error?.message || error);
        statusText = `${statusText} Черновик открыт, но профиль не удалось обновить автоматически.`;
      }
    }

    return await openTicketDraftWithRoblox(interaction, robloxUser, kind, {
      response: "editReply",
      statusText,
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
        const ack = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
        if (ack.ok) await safeEditReply(interaction, { content: "Черновик истёк. Начни заново.", components: [] });
        return true;
      }
      const description = interaction.fields.getTextInputValue("description");
      const updated = writeDraft(interaction.user.id, { description });
      const payload = buildTicketSetupPayload(updated, getConfig());
      if (interaction.message && typeof interaction.update === "function") {
        await safeUpdate(interaction, payload);
        return true;
      }
      const ack = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
      if (ack.ok) await safeEditReply(interaction, payload);
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

    if (id === "at:ping:config_modal") {
      if (!isModerator(interaction.member)) {
        await replyNoPermission(interaction);
        return true;
      }
      const previous = getConfig();
      const nextConfig = createDefaultAntiteamConfig({
        ...previous,
        pingMode: parsePingModeInput(interaction.fields.getTextInputValue("ping_mode"), previous.pingMode),
        extraPingRoleId: parseEntityId(interaction.fields.getTextInputValue("extra_ping_role_id")),
        battalionPingRoleIds: parseEntityIdList(interaction.fields.getTextInputValue("battalion_ping_role_ids")),
        editPingRoleIds: parseEntityIdList(interaction.fields.getTextInputValue("edit_ping_role_ids")),
      });
      await persist("antiteam-ping-config", () => {
        const state = getState();
        state.config = nextConfig;
        return { mutated: true };
      });
      const editResult = await editPublishedStartPanel().catch(() => ({ edited: false }));
      await interaction.reply(buildModeratorPanelPayload(
        getState(),
        editResult.edited
          ? "Пинг-система сохранена и обновлена в стартовой панели."
          : "Пинг-система сохранена."
      ));
      return true;
    }

    if (id === "at:stats:roles_modal") {
      if (!isModerator(interaction.member)) {
        await replyNoPermission(interaction);
        return true;
      }
      const previous = getConfig();
      const helperRewardRoles = {};
      for (const threshold of ANTITEAM_HELPER_REWARD_THRESHOLDS) {
        helperRewardRoles[String(threshold)] = parseEntityId(interaction.fields.getTextInputValue(`role_${threshold}`));
      }
      const nextConfig = createDefaultAntiteamConfig({
        ...previous,
        helperRewardRoles,
      });
      await persist("antiteam-helper-reward-roles", () => {
        const state = getState();
        state.config = nextConfig;
        return { mutated: true };
      });
      await interaction.reply(buildHelperStatsPayload(getState(), 0, "Роли за очки помощи сохранены."));
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
      if (!canCloseTicket(interaction, ticket)) {
        await replyNoPermission(interaction);
        return true;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const summary = interaction.fields.getTextInputValue("summary");
      const confirmedHelperIds = Object.values(ticket.helpers || {}).filter((helper) => helper.arrived !== false).map((helper) => helper.userId);
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
      await syncHelperRewardRoles(confirmedHelperIds).catch((error) => {
        logError("Antiteam helper reward sync after close failed:", error?.message || error);
      });
      await finalizeClosedTicket(updated);
      await interaction.editReply({ content: "Антитим закрыт. Итог записан в заявку.", components: [] });
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
    const photoAttachments = attachments.filter(isImageAttachment).slice(0, 10);
    if (!photoAttachments.length) return false;

    const capturedAt = nowIso();
    const photos = photoAttachments.map((attachment) => normalizeAttachmentPhoto(attachment, capturedAt));
    await persist("antiteam-photo-captured", () => setAntiteamDraft(db, message.author.id, {
      photo: photos[0],
      photos,
    }, { now: capturedAt }));
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
        confirmedHelperIds: Object.values(ticket.helpers || {}).filter((helper) => helper.arrived !== false).map((helper) => helper.userId),
        autoClosed: true,
      }));
      await finalizeClosedTicket(updated).catch(() => {});
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
    refreshStartPanel,
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
