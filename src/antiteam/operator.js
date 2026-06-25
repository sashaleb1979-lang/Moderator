"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { AttachmentBuilder, ChannelType, MessageFlags, PermissionsBitField } = require("discord.js");
const { getRobloxBindingRecoveryText } = require("../integrations/roblox-binding-status");
const { resolveUsableVerifiedRobloxIdentity } = require("../integrations/shared-profile");
const {
  ANTITEAM_HELPER_REWARD_THRESHOLDS,
  ANTITEAM_LEVELS,
  adjustHelperStatsPoints,
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
  listOpenAntiteamTickets,
  isAnchorKind,
  markRobloxConfirmed,
  matchRobloxFriendsToDiscordProfiles,
  normalizeAntiteamPingMode,
  recordAntiteamHelper,
  setAllTicketHelpersArrival,
  setAntiteamDraft,
  setKvApprovalDecision,
  setTicketHelperArrival,
  KV_APPROVAL_PING_ROLE_ID,
  KV_APPROVAL_PING_USER_ID,
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
  buildDirectLinkModal,
  buildHelperRewardRolesModal,
  buildHelperStatsPayload,
  buildHelpReplyPayload,
  buildKvAnchorModal,
  buildModeratorPanelPayload,
  buildPanelTextModal,
  buildPingConfigModal,
  buildPhotoRequestPayload,
  buildReportModal,
  buildRobloxConfirmPayload,
  buildRobloxMissingPayload,
  buildRobloxUsernameModal,
  buildSupportLeaderboardPayload,
  buildStartPanelPayload,
  buildStartGuidePayload,
  buildSupportProgressPayload,
  buildThreadName,
  buildThreadPanelPayload,
  buildTicketDirectLinkModal,
  buildTicketRobloxModal,
  buildTwinkRobloxModal,
  buildTwinkConfirmPayload,
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
const ANTITEAM_FRIEND_SCAN_DEADLINE_MS = 8000;
const ANTITEAM_PRESENCE_CACHE_TTL_MS = 15 * 1000;
const ANTITEAM_EDIT_PING_DELETE_MS = 5000;
const ANTITEAM_ROLE_GRANT_RETRY_DELAYS_MS = [2000, 10000, 30000];
const ANTITEAM_UNKNOWN_INTERACTION_CODES = new Set([10062]);
const ANTITEAM_ALREADY_ACK_CODES = new Set([40060]);
const ANTITEAM_MANUAL_POINTS_TARGET_LIMIT = 100;
const ANTITEAM_START_PANEL_SCAN_LIMIT = 100;

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

function parseRequestedUserId(value, fallbackUserId = "") {
  const text = cleanString(value, 80);
  if (!text) return cleanString(fallbackUserId, 80);

  const mentionMatch = text.match(/^<@!?(\d+)>$/);
  const candidate = mentionMatch ? mentionMatch[1] : text.replace(/\s+/g, "");
  return /^\d{5,25}$/.test(candidate) ? candidate : "";
}

function parseRequestedUserIdList(value = "", limit = ANTITEAM_MANUAL_POINTS_TARGET_LIMIT) {
  const normalized = [];
  const invalidEntries = [];
  const seen = new Set();
  let truncated = false;
  const candidates = cleanString(value, 1200)
    .split(/[;,\n\r\t ]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const entry of candidates) {
    const userId = parseRequestedUserId(entry, "");
    if (!userId) {
      invalidEntries.push(entry);
      continue;
    }
    if (seen.has(userId)) continue;
    if (normalized.length >= limit) {
      truncated = true;
      continue;
    }
    seen.add(userId);
    normalized.push(userId);
  }

  return {
    userIds: normalized,
    invalidEntries: [...new Set(invalidEntries)],
    truncated,
  };
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
  const apiPresentCache = new Map();
  // Per-user publish guard: a draft becomes exactly one ticket. Without it a
  // rapid double-click on submit (or a submit + photo-upload race) would read the
  // same draft twice and create two tickets — and the second publish, after the
  // first consumes the draft, would also make a later photo fail with "черновик
  // истёк". Acquired synchronously before any await so re-entry is impossible.
  const publishInFlight = new Set();
  let submitPanelResendInFlight = null;
  let submitPanelResendQueued = false;

  function acquirePublishLock(userId) {
    const id = cleanString(userId, 80);
    if (!id || publishInFlight.has(id)) return false;
    publishInFlight.add(id);
    return true;
  }

  function releasePublishLock(userId) {
    publishInFlight.delete(cleanString(userId, 80));
  }

  function formatAutoCloseSummaryText(minutes) {
    const normalizedMinutes = Math.max(1, Number.parseInt(minutes, 10) || 120);
    return `Автозавершено: ${normalizedMinutes} мин без движения.`;
  }

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

  // Resolve to `fallbackValue` if `promise` doesn't settle within `ms`, so a slow
  // Roblox call can never hang a (detached) workflow. The original promise's
  // rejection is swallowed to the fallback too.
  function withDeadline(promise, ms, fallbackValue) {
    const timed = new Promise((resolve) => {
      const timer = scheduleTimeout(() => resolve(fallbackValue), Math.max(0, Number(ms) || 0));
      if (timer && typeof timer.unref === "function") timer.unref();
    });
    return Promise.race([Promise.resolve(promise).catch(() => fallbackValue), timed]);
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

  // `durable: true` forces the write to land immediately (used for rare,
  // high-value ticket lifecycle changes that a live Discord message depends on),
  // instead of riding the coalesced debounce. Falls back to the normal saveDb
  // when no durable saver is wired.
  async function persist(label, mutate, { shouldSave = true, durable = false } = {}) {
    const saver = durable && typeof options.saveDbDurable === "function"
      ? options.saveDbDurable
      : options.saveDb;
    if (typeof options.runSerializedMutation === "function") {
      return options.runSerializedMutation({
        label,
        mutate,
        shouldPersist: shouldSave,
        persist: saver,
      });
    }
    const result = await Promise.resolve().then(mutate);
    if (shouldSave && typeof saver === "function") await saver();
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

  // Content edits (direct link, anchor Roblox) are allowed on an open mission and
  // on a KV that is still awaiting approval, so the author can fix it pre-decision.
  function isTicketContentEditable(ticket = {}) {
    return ticket?.status === "open" || (ticket?.kind === "kv" && ticket?.status === "pending_approval");
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

    // Mentions MUST be present at send time. The previous "send a dot, then edit
    // in the roles" trick never notified anyone — Discord does not push a
    // notification for mentions added by a later edit, which is why edit-test
    // looked like it did nothing. Send a real ping, then auto-delete to keep the
    // channel clean (the notification has already gone out by then).
    const pingMessage = await thread.send({
      content: roleIds.map((roleId) => `<@&${roleId}>`).join(" "),
      allowedMentions: { roles: roleIds },
    });
    scheduleTransientPingDelete(pingMessage, ANTITEAM_EDIT_PING_DELETE_MS);
    return pingMessage;
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

  function getKvApprovalTargets(config = createDefaultAntiteamConfig()) {
    return {
      roleId: cleanString(config.kvApprovalRoleId, 80) || KV_APPROVAL_PING_ROLE_ID,
      userId: cleanString(config.kvApprovalUserId, 80) || KV_APPROVAL_PING_USER_ID,
    };
  }

  // The "возможно кв" ping: only the approval role + person, nobody else, so the
  // server isn't pulled in before admins decide.
  async function sendKvApprovalPing(thread, ticket = {}, config = createDefaultAntiteamConfig()) {
    if (!thread?.send) return null;
    const { roleId, userId } = getKvApprovalTargets(config);
    const mentions = [roleId ? `<@&${roleId}>` : "", userId ? `<@${userId}>` : ""].filter(Boolean).join(" ");
    if (!mentions) return null;
    return thread.send({
      content: `${mentions}\n🟪 **Возможно КВ** — нужно решение. Одобрите, чтобы открыть ветку и позвать edit-test, или отклоните (тогда никто не отметится).`,
      allowedMentions: { roles: roleId ? [roleId] : [], users: userId ? [userId] : [] },
    }).catch((error) => {
      logError("Antiteam KV approval ping failed:", error?.message || error);
      return null;
    });
  }

  // On approval the KV becomes real and pings everything in edit-test. Unlike the
  // edit_roles "buffer" trick this is a normal message, so it actually notifies.
  async function sendKvOpenPing(thread, ticket = {}, config = createDefaultAntiteamConfig()) {
    if (!thread?.send) return null;
    const roleIds = getEditPingRoleIds(config);
    if (!roleIds.length) return null;
    return thread.send({
      content: `${roleIds.map((roleId) => `<@&${roleId}>`).join(" ")}\n🟪 **КВ одобрено** — выходим к якорю!`,
      allowedMentions: { roles: roleIds },
    }).catch((error) => {
      logError("Antiteam KV open ping failed:", error?.message || error);
      return null;
    });
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
    const staleRoleIds = getConfiguredHelperRewardRoleIds().filter((roleId) => !roleIds.includes(roleId));
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

  function getMemberUserId(member = {}) {
    return cleanString(member?.id || member?.user?.id, 80);
  }

  function getRoleMemberValues(role = {}) {
    const members = role?.members;
    if (!members) return [];
    if (typeof members.values === "function") return [...members.values()];
    if (Array.isArray(members)) return members;
    return [];
  }

  async function resolveManualPointsRoleTargets(role = null, interaction = {}) {
    const roleId = cleanString(role?.id, 80);
    if (!roleId) return { roleId: "", roleName: "", targetIds: [] };

    const guild = role.guild || interaction.guild || null;
    if (guild?.members?.fetch) {
      await guild.members.fetch().catch((error) => {
        logError(`Antiteam manual points role member fetch failed [${roleId}]:`, error?.message || error);
      });
    }

    const directMembers = getRoleMemberValues(role);
    const guildMembers = directMembers.length
      ? directMembers
      : (guild?.members?.cache?.values ? [...guild.members.cache.values()] : []);
    const targetIds = guildMembers
      .filter((member) => member?.user && !member.user.bot)
      .filter((member) => directMembers.length || member.roles?.cache?.has?.(roleId))
      .map((member) => getMemberUserId(member))
      .filter(Boolean);

    return {
      roleId,
      roleName: cleanString(role?.name, 120) || roleId,
      targetIds: [...new Set(targetIds)],
    };
  }

  function buildManualPointsTargetPreview(userIds = [], limit = 10) {
    const safeUserIds = Array.isArray(userIds) ? userIds.filter(Boolean) : [];
    const preview = safeUserIds.slice(0, limit).map((userId) => `<@${userId}>`).join(", ");
    if (!preview) return "";
    return safeUserIds.length > limit ? `${preview} и ещё ${safeUserIds.length - limit}` : preview;
  }

  function buildManualPointsResultText(results = [], details = {}) {
    const actionText = details.action === "remove" ? "Убрано" : "Начислено";
    const unchanged = results.filter((entry) => !entry.appliedDelta);
    const changed = results.filter((entry) => entry.appliedDelta);
    const lines = [
      `${actionText} по **${details.amount}** очк. выбранным участникам: **${results.length}**.`,
      `Изменено: **${changed.length}** • без изменения: **${unchanged.length}**.`,
    ];

    const previewRows = results.slice(0, 12).map((entry) => {
      const sign = entry.appliedDelta > 0 ? "+" : "";
      return `<@${entry.userId}>: **${entry.before} → ${entry.after}** (${sign}${entry.appliedDelta})`;
    });
    if (previewRows.length) lines.push(previewRows.join("\n"));
    if (results.length > previewRows.length) {
      lines.push(`И ещё ${results.length - previewRows.length} участн.`);
    }
    if (details.roleId) {
      lines.push(`Источник по роли: <@&${details.roleId}> (${details.roleName || details.roleId}).`);
    }
    if (details.rewardSync) {
      lines.push(`Reward-роли проверены: выдач/проверок **${details.rewardSync.roles}**, снятий **${details.rewardSync.removed}**.`);
    }
    if (details.rewardSyncError) {
      lines.push(`Очки записаны, но роли не удалось пересинхронизировать: ${cleanString(details.rewardSyncError, 180)}`);
    }
    if (details.note) {
      lines.push(`Заметка: ${cleanString(details.note, 300)}`);
    }
    return lines.join("\n").slice(0, 1900);
  }

  async function collectFriendEligibleDiscordIds(draft = {}) {
    if (!draft.roblox?.userId || typeof options.fetchRobloxFriends !== "function") return [];
    try {
      const friends = await withDeadline(
        options.fetchRobloxFriends(draft.roblox.userId),
        ANTITEAM_FRIEND_SCAN_DEADLINE_MS,
        []
      );
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
    const knownPanelMessageIds = collectKnownStartPanelMessageIds(config);
    // Send the new panel FIRST so the "создать антитим" button is never missing,
    // then delete the old one immediately — BEFORE persisting the new id — so a
    // slow/failed state write can never leave the old panel behind.
    const message = await channel.send(payload);
    const recentPanelMessageIds = await collectRecentStartPanelMessageIds(channel, message.id);
    const stalePanelMessageIds = [
      ...new Set([
        ...knownPanelMessageIds,
        ...recentPanelMessageIds,
      ].filter((messageId) => messageId && messageId !== message.id)),
    ];
    const failedCleanupMessageIds = [];
    for (const staleMessageId of stalePanelMessageIds) {
      const cleaned = await deleteStartPanelMessage(channel, staleMessageId);
      if (!cleaned) failedCleanupMessageIds.push(staleMessageId);
    }
    await persist("antiteam-panel-publish", () => {
      const current = getState();
      current.config.panelMessageId = message.id;
      current.config.panelMessageIds = [
        message.id,
        ...failedCleanupMessageIds,
      ].slice(0, 20);
      current.config.channelId = channel.id;
      return { mutated: true };
    });
    return { message, statusText: statusText || `Стартовая панель опубликована в <#${channel.id}>.` };
  }

  // Robustly remove an old start-panel message: try the direct delete (no fetch
  // needed), fall back to fetch+delete, and log if it genuinely fails so leaked
  // panels are visible instead of silent.
  function collectKnownStartPanelMessageIds(config = {}) {
    return [
      ...new Set([
        cleanString(config.panelMessageId, 80),
        ...(Array.isArray(config.panelMessageIds) ? config.panelMessageIds.map((messageId) => cleanString(messageId, 80)) : []),
      ].filter(Boolean)),
    ];
  }

  function toMessageArray(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value.values === "function") return [...value.values()];
    if (value.cache && typeof value.cache.values === "function") return [...value.cache.values()];
    if (typeof value === "object") return Object.values(value);
    return [];
  }

  function getComponentSnapshot(component) {
    if (!component) return component;
    if (typeof component.toJSON === "function") {
      try {
        return component.toJSON();
      } catch {
        return component;
      }
    }
    return component;
  }

  function containsCustomId(value, expectedCustomId) {
    if (!value) return false;
    if (Array.isArray(value)) return value.some((entry) => containsCustomId(entry, expectedCustomId));
    if (typeof value !== "object") return false;

    const snapshot = getComponentSnapshot(value);
    if (snapshot !== value) return containsCustomId(snapshot, expectedCustomId);

    if (cleanString(value.custom_id || value.customId, 120) === expectedCustomId) return true;
    return Object.values(value).some((entry) => containsCustomId(entry, expectedCustomId));
  }

  function isStartPanelMessage(message = {}) {
    return containsCustomId(message.components, ANTITEAM_CUSTOM_IDS.open);
  }

  async function collectRecentStartPanelMessageIds(channel, currentMessageId = "") {
    if (typeof channel?.messages?.fetch !== "function") return [];
    let recentMessages = null;
    try {
      recentMessages = await channel.messages.fetch({ limit: ANTITEAM_START_PANEL_SCAN_LIMIT });
    } catch (error) {
      logError("Antiteam start-panel scan failed:", error?.message || error);
      return [];
    }

    const keepMessageId = cleanString(currentMessageId, 80);
    return toMessageArray(recentMessages)
      .filter((message) => cleanString(message?.id, 80) && cleanString(message.id, 80) !== keepMessageId)
      .filter(isStartPanelMessage)
      .map((message) => cleanString(message.id, 80));
  }

  async function deleteStartPanelMessage(channel, messageId) {
    const id = cleanString(messageId, 80);
    if (!id || !channel) return true;
    if (typeof channel.messages?.delete === "function") {
      try {
        await channel.messages.delete(id);
        return true;
      } catch (error) {
        if (isUnknownMessageError(error)) return true;
        // fall through to fetch+delete
      }
    }
    try {
      const previous = channel.messages?.fetch ? await channel.messages.fetch(id).catch(() => null) : null;
      if (previous?.delete) {
        await previous.delete();
        return true;
      }
      return true;
    } catch (error) {
      if (!isUnknownMessageError(error)) {
        logError("Antiteam start-panel cleanup failed:", error?.message || error);
        return false;
      }
      return true;
    }
  }

  function isUnknownMessageError(error = {}) {
    return getInteractionErrorCode(error) === 10008;
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

  // Roblox presence is cached briefly per ticket so rapid syncs (e.g. several
  // helpers clicking in a row) don't each hit the Roblox API.
  async function getCachedApiPresentHelperIds(ticket = {}) {
    const ticketId = cleanString(ticket.id, 80);
    if (!ticketId) return collectApiPresentHelperIds(ticket);
    const cached = apiPresentCache.get(ticketId);
    if (cached && cached.expiresAt > nowMs()) return cached.ids;
    const ids = await collectApiPresentHelperIds(ticket);
    apiPresentCache.set(ticketId, { ids, expiresAt: nowMs() + ANTITEAM_PRESENCE_CACHE_TTL_MS });
    return ids;
  }

  // Minimal "is this even a link" gate — reject obvious non-links without being
  // strict about the exact Roblox URL shape.
  function isLikelyDirectJoinUrl(value = "") {
    const url = cleanString(value, 2000);
    return /^roblox:\/\/\S+$/i.test(url) || /^https?:\/\/[^\s/]+\.[^\s/]+/i.test(url);
  }

  // Returns the author's manually added direct join URL if it looks valid, or "".
  // Used for friend_request mode where auto-resolved Roblox profile URLs are not
  // meaningful (you can't click them before the friend request is accepted).
  function getManualDirectJoinUrl(ticket = {}) {
    const url = cleanString(ticket.manualDirectJoinUrl, 2000);
    return isLikelyDirectJoinUrl(url) ? url : "";
  }

  // A clear, private explanation of WHY a pasted direct link was rejected, so the
  // author isn't left with a vague "ссылка не привязана".
  function buildInvalidDirectLinkText(rawLink = "") {
    const sample = cleanString(rawLink, 120);
    return [
      "❌ Ссылка не прикреплена к заявке.",
      "Причина: то, что ты вставил, не похоже на ссылку — она должна начинаться с `https://` или `roblox://`.",
      sample ? `Ты прислал: \`${sample}\`` : "Поле пришло пустым.",
      "Где взять: в Roblox меню → **People** → **Invite Friends** → кнопка **Copy Link**, и вставь сюда целиком (Ctrl+V).",
      "Прежняя ссылка (если была) осталась без изменений.",
    ].filter(Boolean).join("\n");
  }

  // Arrival is now persisted on the helper record itself, so the close summary,
  // re-renders and a restart mid-review all agree. Everyone defaults to arrived
  // (helper.arrived !== false) until the reviewer toggles them off.
  function resolveCloseReviewArrival(ticket = {}, helper = {}) {
    const uid = cleanString(helper.userId, 80);
    const stored = ticket.helpers?.[uid];
    return (stored ? stored.arrived : helper.arrived) !== false;
  }

  async function syncTicketMessages(ticket, { skipPresence = false } = {}) {
    const config = getConfig();
    // Skip the Roblox presence lookup on bulk/background syncs (e.g. config
    // changes refreshing every open ticket) so they don't spike Roblox load.
    const publicPayloadOptions = {
      apiPresentHelperIds: skipPresence ? [] : await getCachedApiPresentHelperIds(ticket).catch(() => []),
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

  async function syncOpenTicketMessages() {
    const tickets = listOpenAntiteamTickets(db).filter((ticket) => ticket.message?.messageId || ticket.message?.threadPanelMessageId);
    if (!tickets.length) return { updatedCount: 0 };
    const results = await Promise.allSettled(tickets.map((ticket) => syncTicketMessages(ticket, { skipPresence: true })));
    const updatedCount = results.filter((result) => result.status === "fulfilled").length;
    return { updatedCount };
  }

  function getDraftPublishError(draft = {}) {
    // KV requires an anchor, an explanation of why the anchor matters, and the
    // anchor's Roblox — situation description is folded into the anchor note.
    if (draft.kind === "kv") {
      if (!cleanString(draft.anchorUserId, 80)) {
        return "Укажи якоря кнопкой «⚓ Указать якоря и почему он важен».";
      }
      if (!cleanString(draft.anchorNote, 700)) {
        return "Опиши якоря: кто это и почему он важен (он будет стабильно держать вход).";
      }
      if (!cleanString(draft.roblox?.userId, 40)) {
        return "Укажи Roblox якоря кнопкой «🎭 Указать Roblox якоря» — без него помощники не подключатся.";
      }
      return "";
    }
    if (!cleanString(draft.description, 900)) {
      return draft.kind === "clan"
        ? "Для ФАЙТ С КЛАНОМ нужно описание врагов и ситуации."
        : "Описание обязательно: укажи, кто тимится, кого бить, ники/kills или ситуацию любым понятным способом.";
    }
    // Clan war can be opened for an anchor who has no profile binding — but it
    // can't publish until an anchor Roblox is set (helpers connect by it).
    if (draft.kind === "clan" && !cleanString(draft.roblox?.userId, 40)) {
      return "Укажи Roblox якоря кнопкой «🎭 Другой Roblox на эту заявку» — без него помощники не подключатся.";
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

    // Coalesced (non-blocking) save, NOT a durable flush: nothing points at the
    // ticket yet (no Discord message exists), so blocking the publish on a full
    // off-thread db write here only delays the post appearing. Durability is
    // reached a moment later in finalizeTicketPublish's message-refs persist
    // ({ durable: true }), which flushes the whole db — this freshly-created
    // ticket included — once a live message actually references it.
    const ticket = await persist("antiteam-ticket-create", () => createAntiteamTicketFromDraft(db, draft, {
      now: nowIso(),
      friendEligibleDiscordUserIds: [],
      test: getConfig().testMode === true,
    }));
    return { draft, ticket };
  }

  // Best-effort Roblox avatar URL for the ticket header thumbnail. Prefers the
  // value already on the draft/ticket (verified users have it), then the
  // requester's stored profile avatar, then a single headshot lookup with a
  // deadline. Never throws — returns "" if nothing is available.
  async function ensureTicketAvatarUrl(ticket = {}, draft = {}) {
    const existing = cleanString(ticket.roblox?.avatarUrl || draft?.roblox?.avatarUrl, 2000);
    if (existing) return existing;
    const stored = getStoredRobloxSnapshot(ticket.createdBy);
    const storedAvatar = cleanString(stored?.avatarUrl, 2000);
    if (storedAvatar) return storedAvatar;
    const robloxUserId = cleanString(ticket.roblox?.userId || draft?.roblox?.userId, 40);
    if (!robloxUserId || typeof options.fetchUserAvatarHeadshots !== "function") return "";
    try {
      const headshots = await withDeadline(options.fetchUserAvatarHeadshots([robloxUserId]), ANTITEAM_FRIEND_SCAN_DEADLINE_MS, []);
      return cleanString(headshots?.[0]?.imageUrl, 2000);
    } catch (error) {
      logError("Antiteam avatar headshot fetch failed:", error?.message || error);
      return "";
    }
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
    // Test missions are published but never ping. A KV starts as "возможно кв" and
    // only pings the two approval targets — the battalion/edit-test ping waits for
    // admin approval.
    let pingMessage = null;
    if (thread && !ticket.test) {
      pingMessage = ticket.kind === "kv"
        ? await sendKvApprovalPing(thread, ticket, config)
        : await sendTicketPingMessages(thread, ticket, config);
    }
    const pingMs = nowMs() - pingStartedAt;
    // Persist message refs immediately so help/close can locate the post. The
    // avatar lookup and the follow-up public edit (which only enrich the card)
    // move to a detached tail so the post and thread don't wait on them.
    const refsPersistStartedAt = nowMs();
    const updatedTicket = await persist("antiteam-ticket-message-refs", () => updateAntiteamTicket(db, ticket.id, (current) => {
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
    }), { durable: true });
    const refsPersistMs = nowMs() - refsPersistStartedAt;

    runDetached(async () => {
      const avatarUrl = await ensureTicketAvatarUrl(ticket, draft);
      let finalTicket = updatedTicket;
      if (avatarUrl && !cleanString(updatedTicket.roblox?.avatarUrl, 2000)) {
        finalTicket = await persist("antiteam-ticket-avatar", () => updateAntiteamTicket(db, ticket.id, (current) => {
          current.roblox = { ...current.roblox, avatarUrl };
          current.updatedAt = nowIso();
          return current;
        }));
      }
      // Always re-render: message refs are now persisted so the public card can
      // include the thread jump button and any freshly-fetched avatar URL.
      if (typeof publicMessage.edit === "function") {
        await publicMessage.edit(buildTicketPublicPayload(finalTicket, config)).catch(() => {});
      }
      emitAntiteamLatency("submit_finalize_tail", { ticketId: ticket.id });
    }, (error) => {
      logError("Antiteam submit finalize tail failed:", error?.message || error);
    });

    // KV runs through an anchor, not the battalion, so it never grants that role.
    if (ticket.kind !== "kv") ensureBattalionRoleGrantedEventually(ticket);
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
      refsPersistMs,
      totalMs: nowMs() - finalizeStartedAt,
      avatar: "detached",
      publicEdit: "detached",
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
    return isAnchorKind(ticket.kind) && cleanString(ticket.anchorUserId, 80)
      ? ticket.anchorUserId
      : ticket.createdBy;
  }

  function buildFriendRequestNoticeText(ticket = {}, helper = {}) {
    const targetUserId = getFriendRequestTargetUserId(ticket);
    const friendRequestsUrl = getConfig().roblox.friendRequestsUrl;
    return [
      `<@${targetUserId}>`,
      `<@${helper.userId}> отправил тебе friend request в Roblox, чтобы подключиться к ${ticket.kind === "clan" ? "ФАЙТ С КЛАНОМ" : ticket.kind === "kv" ? "КВ" : "антитиму"}.`,
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
    // No friend/presence scan anymore (it was cut for speed), so we trust the
    // author's "вход без друзей" lock. While the lock is closed
    // (directJoinEnabled === false) joining requires friendship, so we ALWAYS
    // run the friend-request flow — the notify-author button shows up next to
    // the connect link / profile, no exceptions. Only an explicitly open lock
    // skips it and offers a straight join.
    const manualDirectJoinUrl = cleanString(ticket.manualDirectJoinUrl, 2000);
    const hasDirectLink = isLikelyDirectJoinUrl(manualDirectJoinUrl);
    const friendsRequired = ticket.directJoinEnabled === false;
    const linkKind = friendsRequired ? "friend_request" : "direct";
    // Direct link if the author added one; otherwise the static profile join link
    // for the friend-request flow (no Roblox scan involved).
    // In friend_request mode there is no fallback join URL — the profile URL
    // (buildRobloxUserJoinUrl) does not become clickable before friendship, so
    // only pass a URL when the author explicitly added a manual direct link.
    const directJoinUrl = hasDirectLink
      ? manualDirectJoinUrl
      : (linkKind === "direct" ? buildRobloxUserJoinUrl(ticket.roblox?.userId) : "");
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
      bridgeDiscordUserId: "",
      bridgeRobloxUsername: "",
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
      bridgeLabel: "",
      helperRobloxKnown: Boolean(helperRoblox.userId),
      friendRequestNotified: Boolean(updated.helpers?.[interaction.user.id]?.friendRequestNotifiedAt),
    }));

    await syncTicketMessages(updated).catch(() => {});
    return true;
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
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      // An anchor without a profile binding no longer blocks the call — open the
      // draft anyway and let the caller set a temporary/twink Roblox for the
      // anchor via the 🎭 button. Publishing is still gated on having one.
      const storedRoblox = getStoredRobloxSnapshot(anchorUser.id);
      return await openTicketDraftWithRoblox(interaction, storedRoblox || {}, "clan", {
        response: "editReply",
        anchorUser,
        statusText: storedRoblox
          ? `Якорь: <@${anchorUser.id}> • Roblox: ${storedRoblox.username}. Он должен оставаться на сервере.`
          : `Якорь: <@${anchorUser.id}> • Roblox в профиле не найден — нажми «🎭 Другой Roblox на эту заявку» и укажи действующий ник якоря.`,
      });
    }

    if (subcommand === "points") {
      if (!isModerator(interaction.member)) {
        await replyNoPermission(interaction);
        return true;
      }

      const action = cleanString(interaction.options?.getString?.("action", true), 20).toLowerCase();
      if (!["add", "remove"].includes(action)) {
        await interaction.reply({ content: "Поддерживаются только action = add или remove.", flags: MessageFlags.Ephemeral });
        return true;
      }

      const amount = Number(interaction.options?.getInteger?.("amount", true));
      if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1000) {
        await interaction.reply({ content: "amount должен быть целым числом от 1 до 1000.", flags: MessageFlags.Ephemeral });
        return true;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const targetUser = interaction.options?.getUser?.("target") || null;
      const targetsInput = cleanString(interaction.options?.getString?.("targets"), 1200);
      const userIdInput = cleanString(interaction.options?.getString?.("user_id"), 80);
      const userIdsInput = cleanString(interaction.options?.getString?.("user_ids"), 1200);
      const targetRole = interaction.options?.getRole?.("role") || null;
      const note = cleanString(interaction.options?.getString?.("note"), 300);
      const parsedTargets = parseRequestedUserIdList(targetsInput);
      const parsedUserIds = parseRequestedUserIdList(userIdsInput);
      const parsedSingleUserId = parseRequestedUserId(userIdInput, "");
      const invalidEntries = [...new Set([
        ...parsedTargets.invalidEntries,
        ...parsedUserIds.invalidEntries,
        userIdInput && !parsedSingleUserId ? userIdInput : "",
      ].filter(Boolean))];
      if (invalidEntries.length) {
        await interaction.editReply("В `targets`, `user_id` и `user_ids` указывай только user mention или Discord ID, разделяя пробелами, запятыми или новыми строками.");
        return true;
      }
      if (parsedTargets.truncated || parsedUserIds.truncated) {
        await interaction.editReply(`За один запуск через текстовые списки можно обработать не больше ${ANTITEAM_MANUAL_POINTS_TARGET_LIMIT} уникальных участников на поле.`);
        return true;
      }

      const roleTargets = targetRole
        ? await resolveManualPointsRoleTargets(targetRole, interaction)
        : { roleId: "", roleName: "", targetIds: [] };
      const targetIds = [...new Set([
        targetUser?.id || "",
        parsedSingleUserId,
        ...parsedTargets.userIds,
        ...parsedUserIds.userIds,
        ...roleTargets.targetIds,
      ].filter(Boolean))];

      if (!targetIds.length) {
        await interaction.editReply("Укажи `target`, `targets`, `user_id`/`user_ids` или выбери `role`.");
        return true;
      }
      if (targetIds.length > ANTITEAM_MANUAL_POINTS_TARGET_LIMIT) {
        await interaction.editReply(`Слишком много участников: ${targetIds.length}. Максимум за один запуск: ${ANTITEAM_MANUAL_POINTS_TARGET_LIMIT}.`);
        return true;
      }

      const delta = action === "add" ? amount : -amount;
      const adjusted = await persist("antiteam-helper-points-manual", () => targetIds.map((targetId) =>
        adjustHelperStatsPoints(db, targetId, delta, { now: nowIso() })
      ).filter(Boolean));

      let rewardSync = null;
      let rewardSyncError = "";
      try {
        rewardSync = await syncHelperRewardRoles(targetIds);
      } catch (error) {
        rewardSyncError = error?.message || String(error || "unknown error");
        logError("Antiteam manual points reward sync failed:", rewardSyncError);
      }

      if (typeof options.logLine === "function") {
        const preview = buildManualPointsTargetPreview(targetIds, 20);
        await options.logLine([
          `ANTITEAM_POINTS_MANUAL: <@${interaction.user.id}> ${action} ${amount}`,
          `targets=${preview || targetIds.length}`,
          note ? `note=${note}` : "",
        ].filter(Boolean).join(" ")).catch(() => null);
      }

      await interaction.editReply(buildManualPointsResultText(adjusted, {
        action,
        amount,
        note,
        rewardSync,
        rewardSyncError,
        roleId: roleTargets.roleId,
        roleName: roleTargets.roleName,
      }));
      return true;
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

    if (id === ANTITEAM_CUSTOM_IDS.leaders) {
      await safeReply(interaction, buildSupportLeaderboardPayload(getState(), interaction.user.id));
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

    // Twink / alt Roblox for the current mission only. The setup panel opens a
    // modal, the modal shows a private confirmation, and confirming binds the
    // account to the draft WITHOUT touching the author's profile binding.
    if (id === ANTITEAM_CUSTOM_IDS.twinkOpen) {
      const draft = getAntiteamDraft(db, interaction.user.id);
      if (!draft) {
        await safeReply(interaction, { content: "Черновик истёк. Начни заново.", flags: MessageFlags.Ephemeral });
        return true;
      }
      await safeShowModal(interaction, buildTwinkRobloxModal({
        initialValue: draft.robloxTemporary ? cleanString(draft.roblox?.username, 20) : "",
      }));
      return true;
    }

    if (id === ANTITEAM_CUSTOM_IDS.twinkConfirm) {
      const draft = getAntiteamDraft(db, interaction.user.id);
      if (!draft) {
        await safeReply(interaction, { content: "Черновик истёк. Начни заново.", flags: MessageFlags.Ephemeral });
        return true;
      }
      const pending = draft.pendingTwink;
      if (!pending?.userId) {
        const ack = await safeDeferUpdate(interaction);
        if (ack.ok) await safeEditReply(interaction, buildTicketSetupPayload(draft, getConfig(), "Твинк не выбран — введи ник заново через «🎭 Другой Roblox»."));
        return true;
      }
      const ack = await safeDeferUpdate(interaction);
      const updated = writeDraft(interaction.user.id, {
        roblox: pending,
        robloxTemporary: true,
        pendingTwink: null,
      });
      if (ack.ok) {
        await safeEditReply(interaction, buildTicketSetupPayload(updated, getConfig(),
          `🎭 Roblox для этой заявки: ${cleanString(pending.username, 120)}. Основная привязка профиля не тронута.`));
      }
      return true;
    }

    if (id === ANTITEAM_CUSTOM_IDS.twinkCancel) {
      const draft = getAntiteamDraft(db, interaction.user.id);
      const ack = await safeDeferUpdate(interaction);
      if (!draft) {
        if (ack.ok) await safeEditReply(interaction, { content: "Черновик истёк. Начни заново.", components: [], flags: MessageFlags.Ephemeral });
        return true;
      }
      const updated = draft.pendingTwink ? writeDraft(interaction.user.id, { pendingTwink: null }) : draft;
      if (ack.ok) await safeEditReply(interaction, buildTicketSetupPayload(updated, getConfig(), "Привязка твинка отменена."));
      return true;
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

    if (id === ANTITEAM_CUSTOM_IDS.toggleTestMode) {
      if (!isModerator(interaction.member)) {
        await replyNoPermission(interaction);
        return true;
      }
      const ack = await safeDeferUpdate(interaction);
      await persist("antiteam-test-mode-toggle", () => {
        const state = getState();
        state.config.testMode = !state.config.testMode;
        return { mutated: true };
      });
      const enabled = getConfig().testMode;
      if (ack.ok) {
        await safeEditReply(interaction, buildModeratorPanelPayload(getState(), enabled
          ? "🧪 Тестовый режим ВКЛ: новые миссии публикуются без пинга батальона. Не забудь выключить после теста."
          : "Тестовый режим выключен — миссии снова пингуют батальон."));
      }
      // Reflect the test-mode banner on the published start panel, if any.
      await editPublishedStartPanel().catch(() => {});
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

    if (id === ANTITEAM_CUSTOM_IDS.kvAnchor) {
      const draft = getAntiteamDraft(db, interaction.user.id);
      if (!draft) {
        await safeReply(interaction, { content: "Черновик истёк. Начни заново.", flags: MessageFlags.Ephemeral });
        return true;
      }
      await safeShowModal(interaction, buildKvAnchorModal(draft));
      return true;
    }

    if (id === ANTITEAM_CUSTOM_IDS.setDirectLink) {
      const draft = getAntiteamDraft(db, interaction.user.id);
      if (!draft) {
        await safeReply(interaction, { content: "Черновик истёк. Начни заново.", flags: MessageFlags.Ephemeral });
        return true;
      }
      await safeShowModal(interaction, buildDirectLinkModal(draft));
      return true;
    }

    if (id === ANTITEAM_CUSTOM_IDS.directLinkGuide) {
      const guideText = [
        "❓ **Где взять прямую ссылку (Roblox)**",
        "**Шаг 1.** Открой меню Roblox — значок Roblox слева сверху (или клавиша Esc).",
        "**Шаг 2.** Вкладка **People** → кнопка **Invite Friends**.",
        "**Шаг 3.** В окне Invite Friends нажми **Copy Link** справа сверху — это и есть прямая ссылка. Вставь её кнопкой «Вставить ссылку».",
      ].join("\n");
      const files = [];
      try {
        const guidePath = path.resolve(__dirname, "..", "..", "assets", "antiteam", "direct-link-guide.png");
        if (fs.existsSync(guidePath)) files.push(new AttachmentBuilder(guidePath, { name: "direct-link-guide.png" }));
      } catch { /* image is optional */ }
      await safeReply(interaction, { content: guideText, files, flags: MessageFlags.Ephemeral });
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
      // Reject a second concurrent submit for the same user (double-click / submit
      // racing the photo upload) so one draft can only ever become one ticket.
      if (!acquirePublishLock(interaction.user.id)) {
        const busyAck = await safeDeferUpdate(interaction);
        if (busyAck.ok) {
          await safeEditReply(interaction, {
            content: "Заявка уже отправляется — подожди пару секунд, не жми повторно.",
            components: [],
            flags: MessageFlags.Ephemeral,
          });
        }
        return true;
      }
      const ack = await safeDeferUpdate(interaction);
      let started = null;
      let lockHandedOff = false;
      try {
        started = await beginTicketPublish(interaction.user.id, { skipPhoto: id === ANTITEAM_CUSTOM_IDS.submitWithoutPhoto });
        if (started.needsPhoto) {
          if (ack.ok) await safeEditReply(interaction, buildPhotoRequestPayload(started.draft));
        } else {
          const closedReply = ack.ok ? await safeDeleteReply(interaction) : false;
          if (closedReply) {
            lockHandedOff = true;
            runDetached(async () => {
              try {
                await finalizeTicketPublish(started.ticket, started.draft);
              } catch (error) {
                if (started?.ticket && started?.draft) {
                  await rollbackTicketPublish(interaction.user.id, started.ticket, started.draft).catch(() => {});
                }
                await notifyDraftSubmitError(interaction, interaction.user.id, error);
              } finally {
                releasePublishLock(interaction.user.id);
              }
            }, (error) => {
              releasePublishLock(interaction.user.id);
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
      } finally {
        if (!lockHandedOff) releasePublishLock(interaction.user.id);
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

    if (action === "toggle_auto_close") {
      if (!ticket || ticket.status !== "open") {
        await safeReply(interaction, { content: "Эта миссия уже закрыта или не найдена.", flags: MessageFlags.Ephemeral });
        return true;
      }
      if (ticket.kind === "clan") {
        await safeReply(interaction, { content: "Для ФАЙТ С КЛАНОМ idle-автозакрытие не используется.", flags: MessageFlags.Ephemeral });
        return true;
      }
      if (!canCloseTicket(interaction, ticket)) {
        await replyNoPermission(interaction);
        return true;
      }
      const ack = await safeDeferUpdate(interaction);
      const now = nowIso();
      const updated = await persist("antiteam-ticket-toggle-auto-close", () => updateAntiteamTicket(db, ticket.id, (current) => {
        current.autoCloseEnabled = current.autoCloseEnabled === false;
        current.updatedAt = now;
        current.lastActivityAt = now;
        return current;
      }));
      if (ack.ok) await safeEditReply(interaction, buildThreadPanelPayload(updated, getConfig()));
      await syncTicketMessages(updated).catch(() => {});
      return true;
    }

    if (action === "set_direct_link") {
      if (!ticket || !isTicketContentEditable(ticket)) {
        await safeReply(interaction, { content: "Эта миссия уже закрыта или не найдена.", flags: MessageFlags.Ephemeral });
        return true;
      }
      if (interaction.user.id !== ticket.createdBy && !isModerator(interaction.member)) {
        await replyNoPermission(interaction);
        return true;
      }
      await interaction.showModal(buildTicketDirectLinkModal(ticket));
      return true;
    }

    // On-the-spot Roblox/twink swap from a published ticket thread (author or mod).
    if (action === "change_roblox") {
      if (!ticket || !isTicketContentEditable(ticket)) {
        await safeReply(interaction, { content: "Эта миссия уже закрыта или не найдена.", flags: MessageFlags.Ephemeral });
        return true;
      }
      const allowedToEdit = ticket.kind === "clan"
        ? (canCallClan(interaction.member) || interaction.user.id === ticket.anchorUserId)
        : (interaction.user.id === ticket.createdBy || isModerator(interaction.member));
      if (!allowedToEdit) {
        await replyNoPermission(interaction);
        return true;
      }
      await interaction.showModal(buildTicketRobloxModal(ticket));
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
          directJoinUrl: getManualDirectJoinUrl(ticket),
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
        directJoinUrl: getManualDirectJoinUrl(updated),
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

    if (action === "kv_approve" || action === "kv_reject") {
      if (!ticket || ticket.kind !== "kv") {
        await safeReply(interaction, { content: "Это не КВ-заявка или она не найдена.", flags: MessageFlags.Ephemeral });
        return true;
      }
      // Approval is admins-only; the pinged role/person are just summoned to it.
      if (!hasAdmin(interaction.member)) {
        await replyNoPermission(interaction);
        return true;
      }
      if (ticket.status !== "pending_approval") {
        await safeReply(interaction, { content: "Решение по этой КВ уже принято.", flags: MessageFlags.Ephemeral });
        return true;
      }
      const approve = action === "kv_approve";
      const ack = await safeDeferUpdate(interaction);
      const updated = await persist("antiteam-kv-decision", () => setKvApprovalDecision(db, ticketId, approve ? "approved" : "rejected", {
        now: nowIso(),
        decidedBy: interaction.user.id,
      }), { durable: true });
      if (!updated) {
        if (ack.ok) await safeReply(interaction, { content: "Не удалось обновить КВ.", flags: MessageFlags.Ephemeral });
        return true;
      }
      if (ack.ok) await safeEditReply(interaction, buildThreadPanelPayload(updated, getConfig()));
      if (approve) {
        // Now a real KV: open for help and ping everything in edit-test for real.
        const thread = await fetchTextChannel(updated.message?.threadId).catch(() => null);
        if (thread && !updated.test) await sendKvOpenPing(thread, updated, getConfig()).catch(() => null);
        await syncTicketMessages(updated).catch(() => {});
      } else {
        // Rejected: no help, no points — close and lock the thread.
        await finalizeClosedTicket(updated).catch(() => {});
      }
      if (typeof options.logLine === "function") {
        await options.logLine(`ANTITEAM_KV_${approve ? "APPROVED" : "REJECTED"}: ${ticketId} by ${interaction.user.id}`).catch(() => null);
      }
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
      // Render from the persisted helper.arrived flags (everyone defaults to
      // arrived). Toggles below write straight to the ticket, so the result is
      // restart-proof and the close summary can never disagree with the panel.
      const ack = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
      if (ack.ok) await safeEditReply(interaction, buildCloseReviewPayload(ticket, 0));
      return true;
    }

    if (action === "close_page") {
      if (!ticket || !canCloseTicket(interaction, ticket)) {
        await replyNoPermission(interaction);
        return true;
      }
      const ack = await safeDeferUpdate(interaction);
      if (ack.ok) await safeEditReply(interaction, buildCloseReviewPayload(ticket, Number.parseInt(extra, 10) || 0));
      return true;
    }

    if (action === "arrived") {
      if (!ticket || !canCloseTicket(interaction, ticket)) {
        await replyNoPermission(interaction);
        return true;
      }
      const [helperId, pageRaw = "0"] = extra.split(":");
      if (!ticket.helpers?.[helperId]) {
        await safeReply(interaction, { content: "Helper не найден в этой миссии.", flags: MessageFlags.Ephemeral });
        return true;
      }
      const page = Number.parseInt(pageRaw, 10) || 0;
      const nextArrived = !resolveCloseReviewArrival(ticket, ticket.helpers[helperId]);
      const ack = await safeDeferUpdate(interaction);
      // Render the toggle from memory immediately (just as snappy as the old
      // in-memory panel) via the arrived override, then write durably in the
      // background on the coalesced flush — so the panel never waits on the DB.
      if (ack.ok) await safeEditReply(interaction, buildCloseReviewPayload(ticket, page, { arrivedByUserId: { [helperId]: nextArrived } }));
      runDetached(() => persist("antiteam-helper-arrival", () =>
        setTicketHelperArrival(db, ticketId, helperId, nextArrived, { now: nowIso() })), (error) => {
        logError("Antiteam arrival persist failed:", error?.message || error);
      });
      return true;
    }

    if (action === "mark_all" || action === "unmark_all") {
      if (!ticket || !canCloseTicket(interaction, ticket)) {
        await replyNoPermission(interaction);
        return true;
      }
      const page = Number.parseInt(extra, 10) || 0;
      const value = action === "mark_all";
      const overrides = {};
      for (const helper of Object.values(ticket.helpers || {})) {
        const uid = cleanString(helper.userId, 80);
        if (uid) overrides[uid] = value;
      }
      const ack = await safeDeferUpdate(interaction);
      if (ack.ok) await safeEditReply(interaction, buildCloseReviewPayload(ticket, page, { arrivedByUserId: overrides }));
      runDetached(() => persist("antiteam-helpers-arrival-all", () =>
        setAllTicketHelpersArrival(db, ticketId, value, { now: nowIso() })), (error) => {
        logError("Antiteam arrival persist failed:", error?.message || error);
      });
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
      if (value === "kv") {
        // Switching into КВ resets the request to anchor mode: the author's own
        // Roblox is dropped (helpers connect through the anchor, set separately).
        patch = {
          kind: "kv",
          roblox: {},
          robloxTemporary: false,
          anchorUserId: "",
          anchorUserTag: "",
          anchorNote: "",
        };
      } else if (draft.kind === "kv") {
        // Leaving КВ back to a normal danger level.
        patch = { kind: "standard", level: value };
      } else {
        patch = { level: value };
      }
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

  // Twink/alt nick entered from the setup panel. Looks the account up through the
  // Roblox API and parks it on the draft as a pending candidate; the requester
  // confirms it on the private confirmation panel before it's attached. The
  // author's profile binding is never written here.
  async function handleTwinkModal(interaction) {
    const draft = getAntiteamDraft(db, interaction.user.id);
    if (!draft) {
      const ack = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
      if (ack.ok) await safeEditReply(interaction, { content: "Черновик истёк. Начни заново.", components: [] });
      return true;
    }
    const username = normalizeUsernameInput(interaction.fields.getTextInputValue("roblox_username"));
    const ack = await safeDeferUpdate(interaction);
    let robloxUser = null;
    try {
      robloxUser = await fetchRobloxUserByUsername(username);
    } catch (error) {
      logError("Antiteam twink lookup failed:", error?.message || error);
    }
    if (!robloxUser?.userId && !robloxUser?.id) {
      if (ack.ok) {
        await safeEditReply(interaction, buildTicketSetupPayload(draft, getConfig(),
          `❌ Ник «${cleanString(username, 120)}» не найден через Roblox API. Твинк не привязан.`));
      }
      return true;
    }
    const updated = writeDraft(interaction.user.id, { pendingTwink: robloxUser });
    if (ack.ok) {
      await safeEditReply(interaction, buildTwinkConfirmPayload(updated.pendingTwink || robloxUser, { kind: draft.kind }));
    }
    return true;
  }

  async function handleModalSubmitInteraction(interaction) {
    if (!interaction?.isModalSubmit?.() || !cleanString(interaction.customId, 100).startsWith("at:")) return false;
    const id = interaction.customId;

    if (id === "at:roblox") return handleRobloxModal(interaction, "standard");
    if (id === "at:clan_roblox") return handleRobloxModal(interaction, "clan");
    if (id === "at:twink_modal") return handleTwinkModal(interaction);

    if (id === "at:kv_anchor:modal") {
      const draft = getAntiteamDraft(db, interaction.user.id);
      if (!draft) {
        const ack = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
        if (ack.ok) await safeEditReply(interaction, { content: "Черновик истёк. Начни заново.", components: [] });
        return true;
      }
      const anchorUserId = parseRequestedUserId(interaction.fields.getTextInputValue("anchor"), "");
      const anchorNote = cleanString(interaction.fields.getTextInputValue("anchor_note"), 700);
      let updated;
      let statusText;
      if (!anchorUserId) {
        updated = writeDraft(interaction.user.id, { kind: "kv", anchorNote });
        statusText = "❌ Якорь не распознан — укажи @упоминание или числовой Discord ID.";
      } else {
        // Pull the anchor's verified Roblox from their profile so helpers connect
        // by it; if they have none the author sets it via «🎭 Указать Roblox якоря».
        const anchorRoblox = getStoredRobloxSnapshot(anchorUserId);
        const anchorMember = typeof options.fetchMember === "function"
          ? await options.fetchMember(anchorUserId).catch(() => null)
          : null;
        const anchorTag = getUserTag(anchorMember?.user || anchorMember) || anchorUserId;
        const patch = { kind: "kv", anchorUserId, anchorUserTag: anchorTag, anchorNote };
        if (anchorRoblox?.userId) {
          patch.roblox = anchorRoblox;
          patch.robloxTemporary = false;
        }
        updated = writeDraft(interaction.user.id, patch);
        statusText = anchorRoblox?.userId
          ? `⚓ Якорь записан: <@${anchorUserId}> • Roblox: ${anchorRoblox.username}.`
          : `⚓ Якорь записан: <@${anchorUserId}>. Roblox якоря в профиле не найден — укажи его кнопкой «🎭 Указать Roblox якоря».`;
      }
      const payload = buildTicketSetupPayload(updated, getConfig(), statusText);
      if (interaction.message && typeof interaction.update === "function") {
        await safeUpdate(interaction, payload);
        return true;
      }
      const ack = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
      if (ack.ok) await safeEditReply(interaction, payload);
      return true;
    }

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

    if (id === "at:direct_link:modal") {
      const draft = getAntiteamDraft(db, interaction.user.id);
      if (!draft) {
        const ack = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
        if (ack.ok) await safeEditReply(interaction, { content: "Черновик истёк. Начни заново.", components: [] });
        return true;
      }
      const rawLink = cleanString(interaction.fields.getTextInputValue("direct_link"), 2000);
      if (!isLikelyDirectJoinUrl(rawLink)) {
        // Don't save junk; show the author a private, specific notice and leave
        // the setup panel untouched.
        await safeReply(interaction, {
          content: buildInvalidDirectLinkText(rawLink),
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }
      const updated = writeDraft(interaction.user.id, { manualDirectJoinUrl: rawLink });
      const payload = buildTicketSetupPayload(updated, getConfig(), "Прямая ссылка сохранена ✅");
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
      const refreshResult = await syncOpenTicketMessages().catch(() => ({ updatedCount: 0 }));
      await interaction.reply(buildModeratorPanelPayload(
        getState(),
        refreshResult.updatedCount > 0
          ? `Roblox-ссылки и тайминги антитима сохранены. Обновлено открытых миссий: **${refreshResult.updatedCount}**.`
          : "Roblox-ссылки и тайминги антитима сохранены."
      ));
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

    if (action === "direct_link_modal") {
      if (!isTicketContentEditable(ticket)) {
        await interaction.reply({ content: "Эта миссия уже закрыта.", flags: MessageFlags.Ephemeral });
        return true;
      }
      if (interaction.user.id !== ticket.createdBy && !isModerator(interaction.member)) {
        await replyNoPermission(interaction);
        return true;
      }
      const rawLink = cleanString(interaction.fields.getTextInputValue("direct_link"), 2000);
      if (!isLikelyDirectJoinUrl(rawLink)) {
        await interaction.reply({
          content: buildInvalidDirectLinkText(rawLink),
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const updated = await persist("antiteam-ticket-direct-link", () => updateAntiteamTicket(db, ticketId, (current) => {
        current.manualDirectJoinUrl = rawLink;
        current.updatedAt = nowIso();
        return current;
      }));
      await syncTicketMessages(updated).catch(() => {});
      await interaction.editReply({ content: "✅ Прямая ссылка обновлена.", components: [] });
      return true;
    }

    if (action === "change_roblox_modal") {
      if (!isTicketContentEditable(ticket)) {
        await interaction.reply({ content: "Эта миссия уже закрыта.", flags: MessageFlags.Ephemeral });
        return true;
      }
      const allowedToEdit = ticket.kind === "clan"
        ? (canCallClan(interaction.member) || interaction.user.id === ticket.anchorUserId)
        : (interaction.user.id === ticket.createdBy || isModerator(interaction.member));
      if (!allowedToEdit) {
        await replyNoPermission(interaction);
        return true;
      }
      const username = normalizeUsernameInput(interaction.fields.getTextInputValue("roblox_username"));
      const ack = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
      let robloxUser = null;
      try {
        robloxUser = await fetchRobloxUserByUsername(username);
      } catch (error) {
        logError("Antiteam ticket roblox swap lookup failed:", error?.message || error);
      }
      if (!robloxUser?.userId && !robloxUser?.id) {
        if (ack.ok) await safeEditReply(interaction, { content: `❌ Ник «${cleanString(username, 120)}» не найден через Roblox API. Roblox заявки не изменён.`, components: [] });
        return true;
      }
      const snapshot = {
        userId: cleanString(robloxUser.userId || robloxUser.id, 40),
        username: cleanString(robloxUser.username || robloxUser.name, 120),
        displayName: cleanString(robloxUser.displayName, 120),
        avatarUrl: cleanString(robloxUser.avatarUrl, 2000),
        profileUrl: cleanString(robloxUser.profileUrl, 500),
      };
      const updated = await persist("antiteam-ticket-change-roblox", () => updateAntiteamTicket(db, ticketId, (current) => {
        current.roblox = snapshot;
        current.robloxTemporary = true;
        current.updatedAt = nowIso();
        current.lastActivityAt = nowIso();
        return current;
      }));
      await syncTicketMessages(updated).catch(() => {});
      if (ack.ok) await safeEditReply(interaction, { content: `✅ Roblox заявки изменён на **${snapshot.username}**.`, components: [] });
      return true;
    }

    if (action === "close_modal") {
      if (!canCloseTicket(interaction, ticket)) {
        await replyNoPermission(interaction);
        return true;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const summary = interaction.fields.getTextInputValue("summary");
      // "Who arrived" is read from the persisted helper.arrived flags the review
      // panel wrote, so the recorded result always matches what the reviewer saw.
      const confirmedHelperIds = Object.values(ticket.helpers || {})
        .filter((helper) => resolveCloseReviewArrival(ticket, helper))
        .map((helper) => helper.userId);
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
      }, { durable: true });
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
    if (!photoAttachments.length) {
      const hasVisibleContent = Boolean(cleanString(message.content, 1)) || attachments.length > 0;
      if (!hasVisibleContent) {
        // The message looks empty from the bot's side. The usual cause is the
        // MESSAGE CONTENT privileged intent being off, which strips attachments
        // off other users' messages — so a real screenshot arrives blank. Don't
        // delete it (it may BE the photo) and surface the likely root cause.
        logError(`Antiteam photo capture saw an empty message from ${message.author.id} while a photo was requested. If users report photos not attaching, enable the MESSAGE CONTENT privileged intent for the bot in the Discord Developer Portal.`);
        return false;
      }
      // The requester is in photo mode but sent text/non-image content. Keep the
      // antiteam channel clean: remove it and nudge them to send a real image.
      await message.delete?.().catch(() => {});
      const hint = await message.channel?.send?.({
        content: `<@${message.author.id}> для заявки антитима жду именно изображение — текст и файлы в этом канале я удаляю. Скинь скрин одним сообщением.`,
        allowedMentions: { users: [message.author.id] },
      }).catch(() => null);
      if (hint?.id) scheduleTimeout(() => { hint.delete?.().catch(() => {}); }, 12000);
      return true;
    }

    const capturedAt = nowIso();
    const photos = photoAttachments.map((attachment) => normalizeAttachmentPhoto(attachment, capturedAt));
    await persist("antiteam-photo-captured", () => setAntiteamDraft(db, message.author.id, {
      photo: photos[0],
      photos,
    }, { now: capturedAt }));
    // If a button-submit is already publishing this user's draft, don't race it
    // into a second ticket — the photo is now saved on the draft, so the in-flight
    // publish picks it up. Just remove the upload message.
    if (!acquirePublishLock(message.author.id)) {
      await message.delete?.().catch(() => {});
      return true;
    }
    let result;
    try {
      result = await publishTicketFromDraft(message.author.id, { skipPhoto: true });
      await message.delete?.().catch(() => {});
    } catch (error) {
      logError("Antiteam photo publish failed:", error?.message || error);
      // Tell the requester instead of failing silently; their photo request stays
      // active so they can just re-send a photo to retry.
      await message.reply?.({
        content: `Не удалось опубликовать заявку с фото: ${cleanString(error?.message || error, 200)}. Пришли фото ещё раз или собери заявку заново через панель.`,
        allowedMentions: { repliedUser: true },
      }).catch(() => {});
      return true;
    } finally {
      releasePublishLock(message.author.id);
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
      const autoCloseMinutes = Math.max(1, Number.parseInt(getState().config?.missionAutoCloseMinutes, 10) || 120);
      const updated = await persist("antiteam-auto-close", () => closeAntiteamTicket(db, ticket.id, {
        now: nowIso(),
        closedBy: "system",
        summaryText: formatAutoCloseSummaryText(autoCloseMinutes),
        confirmedHelperIds: Object.values(ticket.helpers || {}).filter((helper) => helper.arrived !== false).map((helper) => helper.userId),
        autoClosed: true,
      }), { durable: true });
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
