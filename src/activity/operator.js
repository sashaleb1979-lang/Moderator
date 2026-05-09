"use strict";

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const { ensureSharedProfile } = require("../integrations/shared-profile");
const { flushActivityRuntime, rebuildActivitySnapshots, recordActivityMessage } = require("./runtime");
const {
  ACTIVITY_CHANNEL_TYPES,
  ensureActivityState,
  getWatchedChannel,
  removeWatchedChannel,
  updateActivityConfig,
  upsertWatchedChannel,
} = require("./state");

const ACTIVITY_PANEL_BUTTON_IDS = Object.freeze([
  "panel_open_activity",
  "activity_panel_refresh",
  "activity_panel_historical_import",
  "activity_panel_assign_roles",
  "activity_panel_config_access",
  "activity_panel_config_roles_primary",
  "activity_panel_config_roles_secondary",
  "activity_panel_config_watch_save",
  "activity_panel_config_watch_remove",
  "activity_panel_back",
]);

    const ACTIVITY_PANEL_MODAL_IDS = Object.freeze([
      "activity_panel_config_access_modal",
      "activity_panel_config_roles_primary_modal",
      "activity_panel_config_roles_secondary_modal",
      "activity_panel_config_watch_save_modal",
      "activity_panel_config_watch_remove_modal",
    ]);

    const ACTIVITY_ROLE_MAPPING_PRIMARY_KEYS = Object.freeze(["core", "stable", "active"]);
    const ACTIVITY_ROLE_MAPPING_SECONDARY_KEYS = Object.freeze(["floating", "weak", "dead"]);
    const ACTIVE_HISTORICAL_IMPORTS = new WeakSet();

    function clone(value) {
      if (value === undefined) return undefined;
      return JSON.parse(JSON.stringify(value));
    }

    function cleanString(value, limit = 2000) {
      return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
    }

    function normalizeNullableString(value, limit = 2000) {
      const text = cleanString(value, limit);
      return text || null;
    }

    function normalizeIsoTimestamp(value, fallback = null) {
      const text = cleanString(value, 80);
      if (!text) return fallback;
      const date = new Date(text);
      return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
    }

    function normalizeStringArray(value, limit = 2000) {
      if (!Array.isArray(value)) return [];
      const normalized = [];
      const seen = new Set();
      for (const entry of value) {
        const text = cleanString(entry, 80);
        if (!text || seen.has(text)) continue;
        seen.add(text);
        normalized.push(text);
        if (normalized.length >= limit) break;
      }
      return normalized;
    }

    function resolveNowIso(now) {
      if (typeof now === "function") {
        return normalizeIsoTimestamp(now(), new Date().toISOString());
      }
      return normalizeIsoTimestamp(now, new Date().toISOString());
    }

    function assertFunction(value, name) {
      if (typeof value !== "function") {
        throw new TypeError(`${name} must be a function`);
      }
    }

    function formatDateTime(value) {
      const timestamp = Date.parse(value || "");
      if (!Number.isFinite(timestamp)) return "—";
      return new Date(timestamp).toLocaleString("ru-RU");
    }

    function getActivitySessionGapMs(config = {}) {
      return Math.max(1, Number(config.sessionGapMinutes) || 45) * 60 * 1000;
    }

    function listActivityManagedRoleIds(config = {}) {
      return normalizeStringArray(Object.values(config.activityRoleIds || {}));
    }

    function formatRoleIdPreview(roleId) {
      return cleanString(roleId, 80) || "—";
    }

    function formatRoleIdListPreview(roleIds = []) {
      const normalized = normalizeStringArray(roleIds, 25, 80);
      return normalized.length ? normalized.join(", ") : "—";
    }

    function buildActivityRoleMappingPreview(config = {}, roleKeys = []) {
      return roleKeys
        .map((roleKey) => `${roleKey}: ${formatRoleIdPreview(config.activityRoleIds?.[roleKey])}`)
        .join(" • ");
    }

    function formatChannelPreview(record = {}) {
      const channelId = cleanString(record.channelId, 80) || "unknown";
      return `${cleanString(record.channelNameCache, 80) || channelId} (${channelId})`;
    }

    function buildWatchedChannelPreview(state = {}, limit = 4) {
      const watchedChannels = Array.isArray(state.watchedChannels) ? state.watchedChannels : [];
      if (!watchedChannels.length) return "Список каналов ещё не настроен.";

      const lines = watchedChannels
        .slice(0, Math.max(1, Number(limit) || 1))
        .map((record, index) => `${index + 1}. ${formatChannelPreview(record)}`);
      if (watchedChannels.length > lines.length) {
        lines.push(`… ещё ${watchedChannels.length - lines.length}`);
      }
      return lines.join("\n");
    }

function parseOptionalPositiveNumber(value = "") {
  const text = cleanString(value, 80);
  if (!text) {
    return {
      number: undefined,
      invalidToken: null,
    };
  }

  const amount = Number(text.replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      number: undefined,
      invalidToken: text,
    };
  }

  return {
    number: amount,
    invalidToken: null,
  };
}

function buildWatchedChannelFlagDefaults(existingRecord = null) {
  return {
    enabled: existingRecord?.enabled !== false,
    countMessages: existingRecord?.countMessages !== false,
    countSessions: existingRecord?.countSessions !== false,
    countForTrust: existingRecord?.countForTrust !== false,
    countForRoles: existingRecord?.countForRoles !== false,
  };
}

function parseWatchedChannelFlags(value = "", existingRecord = null) {
  const defaults = buildWatchedChannelFlagDefaults(existingRecord);
  const text = cleanString(value, 400);
  if (!text) return { ...defaults };

  const next = { ...defaults };
  for (const token of text.split(/[\s,;|]+/).map((entry) => entry.trim().toLowerCase()).filter(Boolean)) {
    if (["enabled", "on"].includes(token)) next.enabled = true;
    else if (["disabled", "off"].includes(token)) next.enabled = false;
    else if (["messages", "count_messages"].includes(token)) next.countMessages = true;
    else if (["no_messages", "skip_messages"].includes(token)) next.countMessages = false;
    else if (["sessions", "count_sessions"].includes(token)) next.countSessions = true;
    else if (["no_sessions", "skip_sessions"].includes(token)) next.countSessions = false;
    else if (["trust", "count_trust"].includes(token)) next.countForTrust = true;
    else if (["no_trust", "skip_trust"].includes(token)) next.countForTrust = false;
    else if (["roles", "count_roles"].includes(token)) next.countForRoles = true;
    else if (["no_roles", "skip_roles"].includes(token)) next.countForRoles = false;
  }

  return next;
}

function parseRequestedRoleIds(value = "", parseRequestedRoleId) {
  const text = cleanString(value, 4000);
  if (!text) {
    return {
      roleIds: [],
      invalidTokens: [],
    };
  }

  const normalized = [];
  const seen = new Set();
  const invalidTokens = [];
  for (const token of text.split(/[\s,;|]+/).map((entry) => entry.trim()).filter(Boolean)) {
    const roleId = parseRequestedRoleId(token, "");
    if (!roleId) {
      invalidTokens.push(token);
      continue;
    }
    if (seen.has(roleId)) continue;
    seen.add(roleId);
    normalized.push(roleId);
  }

  return {
    roleIds: normalized,
    invalidTokens,
  };
}

function parseRequestedChannelIds(value = "", parseRequestedChannelId) {
  const text = cleanString(value, 4000);
  if (!text) {
    return {
      channelIds: [],
      invalidTokens: [],
    };
  }

  const normalized = [];
  const seen = new Set();
  const invalidTokens = [];
  for (const token of text.split(/[\s,;|]+/).map((entry) => entry.trim()).filter(Boolean)) {
    const channelId = parseRequestedChannelId(token, "");
    if (!channelId) {
      invalidTokens.push(token);
      continue;
    }
    if (seen.has(channelId)) continue;
    seen.add(channelId);
    normalized.push(channelId);
  }

  return {
    channelIds: normalized,
    invalidTokens,
  };
}

function parseOptionalRequestedRoleId(value = "", parseRequestedRoleId) {
  const text = cleanString(value, 120);
  if (!text) {
    return {
      roleId: "",
      invalidToken: null,
    };
  }

  const roleId = parseRequestedRoleId(text, "");
  return {
    roleId,
    invalidToken: roleId ? null : text,
  };
}

function buildActivityAccessConfigModal(config = {}) {
  return new ModalBuilder()
    .setCustomId("activity_panel_config_access_modal")
    .setTitle("Activity access")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("activity_access_moderator_roles")
          .setLabel("Activity moderators")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(1000)
          .setPlaceholder("Role IDs или <@&...>, несколько через пробел/запятую/новую строку")
          .setValue(normalizeStringArray(config.moderatorRoleIds, 25, 80).join("\n"))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("activity_access_admin_roles")
          .setLabel("Activity admins")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(1000)
          .setPlaceholder("Role IDs или <@&...>, несколько через пробел/запятую/новую строку")
          .setValue(normalizeStringArray(config.adminRoleIds, 25, 80).join("\n"))
      )
    );
}

function buildActivityRoleMappingModal({ config = {}, modalId = "", title = "", roleKeys = [] } = {}) {
  return new ModalBuilder()
    .setCustomId(cleanString(modalId, 80))
    .setTitle(cleanString(title, 45) || "Activity roles")
    .addComponents(
      ...roleKeys.map((roleKey) => new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(`activity_role_${roleKey}`)
          .setLabel(`Role for ${roleKey}`)
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(80)
          .setPlaceholder("Role ID или <@&...>, пусто = сброс")
          .setValue(cleanString(config.activityRoleIds?.[roleKey], 80))
      ))
    );
}

function buildWatchedChannelSaveModal() {
  return new ModalBuilder()
    .setCustomId("activity_panel_config_watch_save_modal")
    .setTitle("Список каналов")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("activity_watch_channel_list")
          .setLabel("Каналы")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(2000)
          .setPlaceholder("Один канал на строку: 123456789012345678 или <#123456789012345678>")
      )
    );
}

function buildWatchedChannelRemoveModal() {
  return new ModalBuilder()
    .setCustomId("activity_panel_config_watch_remove_modal")
    .setTitle("Remove watched channel")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("activity_watch_remove_channel_id")
          .setLabel("Channel ID / mention")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(80)
          .setPlaceholder("123456789012345678 или <#123456789012345678>")
      )
    );
}

function appendActivityAuditLog(db, entry = {}) {
  const state = ensureActivityState(db);
  state.ops ||= {};
  state.ops.moderationAuditLog ||= [];
  state.ops.moderationAuditLog.push(clone(entry));
  db.sot.activity = state;
  return state;
}

function appendActivityRuntimeError(db, entry = {}) {
  const state = ensureActivityState(db);
  state.runtime ||= {};
  const errors = Array.isArray(state.runtime.errors) ? state.runtime.errors.slice(-9) : [];
  errors.push(clone(entry));
  state.runtime.errors = errors;
  db.sot.activity = state;
  return state;
}

function ensureProfileRecord(db, userId) {
  db.profiles ||= {};
  const profile = db.profiles[userId] && typeof db.profiles[userId] === "object"
    ? db.profiles[userId]
    : { userId };
  db.profiles[userId] = ensureSharedProfile(profile, userId).profile;
  return db.profiles[userId];
}

function syncAppliedActivityRoleMetadata(db, userId, { appliedActivityRoleKey, lastRoleAppliedAt }) {
  const profile = ensureProfileRecord(db, userId);
  const nextProfile = clone(profile);
  nextProfile.domains ||= {};
  const nextActivity = nextProfile.domains.activity && typeof nextProfile.domains.activity === "object"
    ? clone(nextProfile.domains.activity)
    : {};
  nextActivity.appliedActivityRoleKey = normalizeNullableString(appliedActivityRoleKey, 80);
  nextActivity.lastRoleAppliedAt = normalizeIsoTimestamp(lastRoleAppliedAt, null);
  nextProfile.domains.activity = nextActivity;
  db.profiles[userId] = ensureSharedProfile(nextProfile, userId).profile;

  const state = ensureActivityState(db);
  if (state.userSnapshots && state.userSnapshots[userId] && typeof state.userSnapshots[userId] === "object") {
    state.userSnapshots[userId] = {
      ...state.userSnapshots[userId],
      appliedActivityRoleKey: nextActivity.appliedActivityRoleKey,
      lastRoleAppliedAt: nextActivity.lastRoleAppliedAt,
    };
  }

  return db.profiles[userId];
}

function collectActivityAssignmentTargetUserIds(db, explicitUserIds = []) {
  const state = ensureActivityState(db);
  const targetUserIds = new Set(normalizeStringArray(explicitUserIds, 5000));

  for (const userId of Object.keys(state.userSnapshots || {})) {
    const normalizedUserId = cleanString(userId, 80);
    if (normalizedUserId) targetUserIds.add(normalizedUserId);
  }

  for (const userId of Object.keys(db.profiles || {})) {
    const normalizedUserId = cleanString(userId, 80);
    if (normalizedUserId) targetUserIds.add(normalizedUserId);
  }

  return [...targetUserIds];
}

function buildActivityOperatorPanelPayload({ db = {}, statusText = "" } = {}) {
  const state = ensureActivityState(db);
  const config = state.config || {};
  const watchedChannelCount = Array.isArray(state.watchedChannels) ? state.watchedChannels.length : 0;
  const mappedRoleCount = listActivityManagedRoleIds(config).length;
  const snapshotCount = Object.keys(state.userSnapshots || {}).length;
  const openSessions = Object.values(state.runtime?.openSessions || {});
  const openSessionCount = openSessions.length;
  const dirtyUserCount = Array.isArray(state.runtime?.dirtyUsers) ? state.runtime.dirtyUsers.length : 0;
  const activityProfileCount = Object.values(db.profiles || {}).filter((profile) => profile?.domains?.activity).length;
  const lastCalibrationRun = Array.isArray(state.calibrationRuns) && state.calibrationRuns.length
    ? state.calibrationRuns[state.calibrationRuns.length - 1]
    : null;
  const snapshotRecords = Object.values(state.userSnapshots || {}).filter((entry) => entry && typeof entry === "object");
  const analyzedMessageCount = (
    (Array.isArray(state.userChannelDailyStats) ? state.userChannelDailyStats : [])
      .reduce((sum, entry) => sum + Number(entry?.messagesCount || 0), 0)
  ) + openSessions.reduce((sum, entry) => sum + Number(entry?.messageCount || 0), 0);
  const analyzedWeightedMessageCount = (
    (Array.isArray(state.userChannelDailyStats) ? state.userChannelDailyStats : [])
      .reduce((sum, entry) => sum + Number(entry?.weightedMessagesCount || 0), 0)
  ) + openSessions.reduce((sum, entry) => sum + Number(entry?.weightedMessageCount || 0), 0);
  const finalizedSessionCount = Array.isArray(state.globalUserSessions) ? state.globalUserSessions.length : 0;
  const gatedSnapshotCount = snapshotRecords.filter((entry) => entry.roleEligibilityStatus === "gated_new_member").length;
  const boostedSnapshotCount = snapshotRecords.filter((entry) => entry.roleEligibilityStatus === "boosted_new_member").length;
  const flushStats = state.runtime?.lastFlushStats && typeof state.runtime.lastFlushStats === "object"
    ? state.runtime.lastFlushStats
    : null;
  const dailyRoleSyncStats = state.runtime?.lastDailyRoleSyncStats && typeof state.runtime.lastDailyRoleSyncStats === "object"
    ? state.runtime.lastDailyRoleSyncStats
    : null;
  const thresholds = config.activityRoleThresholds || {};
  const roleBoostMaxMultiplier = Math.max(1, Number(config.roleBoostMaxMultiplier) || 1);

  const embed = new EmbedBuilder()
    .setTitle("Activity Panel")
    .setDescription([
      "Закрытая мод-панель активности.",
      "Публичных activity panel у бота нет.",
      "Здесь видны runtime, calibration и initial role assignment state.",
    ].join("\n"))
    .addFields(
      {
        name: "State",
        value: [
          `Watched channels: **${watchedChannelCount}**`,
          `Mapped roles: **${mappedRoleCount}**`,
          `Snapshots: **${snapshotCount}**`,
          `Profiles with activity: **${activityProfileCount}**`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "Runtime",
        value: [
          `Open sessions: **${openSessionCount}**`,
          `Dirty users: **${dirtyUserCount}**`,
          `Last flush: ${formatDateTime(state.runtime?.lastFlushAt)}`,
          flushStats
            ? `Last flush result: ${Number(flushStats.rebuiltUserCount || 0)} users, ${Number(flushStats.finalizedSessionCount || 0)} finalized sessions`
            : "Last flush result: n/a",
          `Last full recalc: ${formatDateTime(state.runtime?.lastFullRecalcAt)}`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "Processing",
        value: [
          `Analyzed messages: **${analyzedMessageCount}**`,
          `Weighted messages: **${Number(analyzedWeightedMessageCount.toFixed(2))}**`,
          `Finalized sessions: **${finalizedSessionCount}**`,
          `Open-session messages: **${openSessions.reduce((sum, entry) => sum + Number(entry?.messageCount || 0), 0)}**`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "Calibration",
        value: lastCalibrationRun
          ? [
            `Last run: **${cleanString(lastCalibrationRun.mode, 80) || "unknown"}**`,
            `Completed: ${formatDateTime(lastCalibrationRun.completedAt)}`,
            `${Number(lastCalibrationRun.importedEntryCount || 0)} entries`,
            `${Number(lastCalibrationRun.importedUserCount || 0)} users`,
            `${Number(lastCalibrationRun.appliedRoleCount || 0)} role assignments`,
          ].join("\n")
          : "Исторический import ещё не запускался.",
        inline: false,
      },
      {
        name: "Scoring",
        value: [
          `Role gate: after **${Number(config.roleEligibilityMinMemberDays || 0)}** days on server`,
          `Newcomer boost: **x${roleBoostMaxMultiplier.toFixed(2)}** -> x1.00 by day **${Number(config.roleBoostEndMemberDays || 0)}**`,
          `Snapshots gated/boosted: **${gatedSnapshotCount}** / **${boostedSnapshotCount}**`,
          `Weights S/D/F/M/B: ${Number(config.activityScoreWeights?.sessions || 0)}/${Number(config.activityScoreWeights?.days || 0)}/${Number(config.activityScoreWeights?.freshness || 0)}/${Number(config.activityScoreWeights?.messages || 0)}/${Number(config.activityScoreWeights?.diversity || 0)}`,
          `Thresholds: weak ${Number(thresholds.weak ?? 18)}, floating ${Number(thresholds.floating ?? 38)}, active ${Number(thresholds.active ?? 55)}, stable ${Number(thresholds.stable ?? 70)}, core ${Number(thresholds.core ?? 85)}`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "Role Sync",
        value: dailyRoleSyncStats
          ? [
            `Last daily sync: ${formatDateTime(state.runtime?.lastDailyRoleSyncAt)}`,
            `Targets: **${Number(dailyRoleSyncStats.targetUserCount || 0)}**`,
            `Rebuilt: **${Number(dailyRoleSyncStats.rebuiltUserCount || 0)}**`,
            `Applied: **${Number(dailyRoleSyncStats.appliedCount || 0)}**, skipped: **${Number(dailyRoleSyncStats.skippedCount || 0)}**`,
          ].join("\n")
          : "Ежедневный role sync ещё не запускался.",
        inline: false,
      },
      {
        name: "Config",
        value: [
          `Activity moderators: ${formatRoleIdListPreview(config.moderatorRoleIds)}`,
          `Activity admins: ${formatRoleIdListPreview(config.adminRoleIds)}`,
          buildActivityRoleMappingPreview(config, ACTIVITY_ROLE_MAPPING_PRIMARY_KEYS),
          buildActivityRoleMappingPreview(config, ACTIVITY_ROLE_MAPPING_SECONDARY_KEYS),
        ].join("\n"),
        inline: false,
      },
      {
        name: "Список каналов",
        value: buildWatchedChannelPreview(state),
        inline: false,
      }
    );

  if (statusText) {
    embed.addFields({
      name: "Последнее действие",
      value: cleanString(statusText, 1000),
      inline: false,
    });
  }

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("activity_panel_refresh").setLabel("Обновить").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("activity_panel_historical_import").setLabel("Импорт истории").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("activity_panel_assign_roles").setLabel("Пересчитать роли").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("activity_panel_config_access").setLabel("Кто видит панель").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("activity_panel_back").setLabel("Назад").setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("activity_panel_config_roles_primary").setLabel("Роли активности 1/2").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("activity_panel_config_roles_secondary").setLabel("Роли активности 2/2").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("activity_panel_config_watch_save").setLabel("Список каналов").setStyle(ButtonStyle.Secondary)
      ),
    ],
  };
}

function buildActivityRoleAssignmentPlan({ db = {}, userId = "", memberRoleIds = [] } = {}) {
  const normalizedUserId = cleanString(userId, 80);
  if (!normalizedUserId) {
    return {
      userId: "",
      shouldApply: false,
      skipReason: "missing_user_id",
      desiredRoleKey: null,
      desiredRoleId: null,
      addRoleIds: [],
      removeRoleIds: [],
    };
  }

  const state = ensureActivityState(db);
  const config = state.config || {};
  const profile = ensureProfileRecord(db, normalizedUserId);
  const activity = profile?.domains?.activity || {};
  const desiredRoleKey = normalizeNullableString(activity.desiredActivityRoleKey, 80);
  const desiredRoleId = desiredRoleKey
    ? normalizeNullableString(config.activityRoleIds?.[desiredRoleKey], 80)
    : null;
  const roleEligibilityStatus = cleanString(activity.roleEligibilityStatus, 80) || null;
  const roleEligibleForActivityRole = activity.roleEligibleForActivityRole !== false
    && roleEligibilityStatus !== "gated_new_member";
  const normalizedMemberRoleIds = normalizeStringArray(memberRoleIds, 5000);
  const managedRoleIds = listActivityManagedRoleIds(config);

  if (activity.manualOverride === true) {
    return {
      userId: normalizedUserId,
      shouldApply: false,
      skipReason: "manual_override",
      desiredRoleKey,
      desiredRoleId,
      addRoleIds: [],
      removeRoleIds: [],
    };
  }

  if (activity.autoRoleFrozen === true) {
    return {
      userId: normalizedUserId,
      shouldApply: false,
      skipReason: "auto_role_frozen",
      desiredRoleKey,
      desiredRoleId,
      addRoleIds: [],
      removeRoleIds: [],
    };
  }

  if (!roleEligibleForActivityRole) {
    const removeRoleIds = managedRoleIds.filter((roleId) => normalizedMemberRoleIds.includes(roleId));
    if (!removeRoleIds.length) {
      return {
        userId: normalizedUserId,
        shouldApply: false,
        skipReason: "member_too_new",
        desiredRoleKey: null,
        desiredRoleId: null,
        addRoleIds: [],
        removeRoleIds: [],
      };
    }

    return {
      userId: normalizedUserId,
      shouldApply: true,
      skipReason: null,
      desiredRoleKey: null,
      desiredRoleId: null,
      addRoleIds: [],
      removeRoleIds,
    };
  }

  if (!desiredRoleKey) {
    return {
      userId: normalizedUserId,
      shouldApply: false,
      skipReason: "missing_desired_role",
      desiredRoleKey: null,
      desiredRoleId: null,
      addRoleIds: [],
      removeRoleIds: [],
    };
  }

  if (!desiredRoleId) {
    return {
      userId: normalizedUserId,
      shouldApply: false,
      skipReason: "missing_role_mapping",
      desiredRoleKey,
      desiredRoleId: null,
      addRoleIds: [],
      removeRoleIds: [],
    };
  }

  const addRoleIds = normalizedMemberRoleIds.includes(desiredRoleId) ? [] : [desiredRoleId];
  const removeRoleIds = managedRoleIds.filter((roleId) => roleId !== desiredRoleId && normalizedMemberRoleIds.includes(roleId));
  const metadataAlreadySynced = cleanString(activity.appliedActivityRoleKey, 80) === desiredRoleKey;

  if (!addRoleIds.length && !removeRoleIds.length && metadataAlreadySynced) {
    return {
      userId: normalizedUserId,
      shouldApply: false,
      skipReason: "unchanged",
      desiredRoleKey,
      desiredRoleId,
      addRoleIds: [],
      removeRoleIds: [],
    };
  }

  return {
    userId: normalizedUserId,
    shouldApply: true,
    skipReason: null,
    desiredRoleKey,
    desiredRoleId,
    addRoleIds,
    removeRoleIds,
  };
}

async function applyInitialActivityRoleAssignments({
  db = {},
  userIds,
  resolveMemberRoleIds,
  applyRoleChanges,
  now,
  saveDb,
  runSerialized,
} = {}) {
  const execute = async () => {
    const state = ensureActivityState(db);
    const appliedAt = resolveNowIso(now);
    const targetUserIds = collectActivityAssignmentTargetUserIds(db, userIds);
    const appliedUserIds = [];
    const skippedUserIds = [];
    const skippedReasons = {};

    for (const userId of targetUserIds) {
      const memberRoleIds = typeof resolveMemberRoleIds === "function"
        ? await Promise.resolve(resolveMemberRoleIds(userId))
        : [];
      const plan = buildActivityRoleAssignmentPlan({
        db,
        userId,
        memberRoleIds,
      });

      if (!plan.shouldApply) {
        skippedUserIds.push(userId);
        skippedReasons[userId] = plan.skipReason;
        continue;
      }

      if (typeof applyRoleChanges !== "function") {
        skippedUserIds.push(userId);
        skippedReasons[userId] = "missing_apply_callback";
        continue;
      }

      const applyResult = await Promise.resolve(applyRoleChanges({
        userId,
        desiredRoleKey: plan.desiredRoleKey,
        desiredRoleId: plan.desiredRoleId,
        addRoleIds: plan.addRoleIds,
        removeRoleIds: plan.removeRoleIds,
      }));

      if (applyResult === false) {
        skippedUserIds.push(userId);
        skippedReasons[userId] = "apply_declined";
        continue;
      }

      syncAppliedActivityRoleMetadata(db, userId, {
        appliedActivityRoleKey: plan.desiredRoleKey,
        lastRoleAppliedAt: appliedAt,
      });
      appliedUserIds.push(userId);
    }

    db.sot.activity = state;
    if (typeof saveDb === "function") {
      saveDb();
    }

    return {
      appliedAt,
      appliedCount: appliedUserIds.length,
      skippedCount: skippedUserIds.length,
      appliedUserIds,
      skippedUserIds,
      skippedReasons,
    };
  };

  if (typeof runSerialized === "function") {
    return runSerialized(execute, "activity-initial-role-assignment");
  }
  return execute();
}

function normalizeHistoricalImportEntry(entry = {}) {
  const source = entry && typeof entry === "object" ? entry : {};
  const guildId = cleanString(source.guildId, 80);
  const userId = cleanString(source.userId, 80);
  const channelId = cleanString(source.channelId, 80);
  const createdAt = normalizeIsoTimestamp(source.createdAt, null);
  if (!guildId || !userId || !channelId || !createdAt) return null;

  return {
    guildId,
    userId,
    channelId,
    createdAt,
    messageId: normalizeNullableString(source.messageId, 80),
  };
}

function buildHistoricalImportFlushAt(entries, config = {}, fallbackNow) {
  const latestCreatedAt = [...entries]
    .map((entry) => normalizeIsoTimestamp(entry.createdAt, null))
    .filter(Boolean)
    .sort()
    .at(-1);

  if (!latestCreatedAt) return resolveNowIso(fallbackNow);
  return new Date(new Date(latestCreatedAt).getTime() + getActivitySessionGapMs(config) + 1000).toISOString();
}

async function importHistoricalActivity({
  db = {},
  entries,
  requestedByUserId,
  now,
  resolveMemberRoleIds,
  resolveMemberActivityMeta,
  applyRoleChanges,
  saveDb,
  runSerialized,
} = {}) {
  const execute = async () => {
    const state = ensureActivityState(db);
    const requestedAt = resolveNowIso(now);
    const normalizedEntries = (Array.isArray(entries) ? entries : [])
      .map((entry) => normalizeHistoricalImportEntry(entry))
      .filter(Boolean)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const touchedUserIds = new Set();
    let importedEntryCount = 0;
    let ignoredEntryCount = Array.isArray(entries) ? entries.length - normalizedEntries.length : 0;

    for (const entry of normalizedEntries) {
      const result = recordActivityMessage({
        db,
        message: entry,
      });
      if (result.ignored) {
        ignoredEntryCount += 1;
        continue;
      }

      touchedUserIds.add(entry.userId);
      importedEntryCount += 1;
    }

    const flushAt = buildHistoricalImportFlushAt(normalizedEntries, state.config || {}, requestedAt);
    const flushResult = await flushActivityRuntime({
      db,
      now: flushAt,
      resolveMemberActivityMeta,
    });
    const initialRoleAssignment = await applyInitialActivityRoleAssignments({
      db,
      userIds: [...touchedUserIds],
      resolveMemberRoleIds,
      applyRoleChanges,
      now: flushAt,
    });
    const liveState = ensureActivityState(db);

    const calibrationRun = {
      id: ["historical_import", cleanString(requestedByUserId, 80) || "system", requestedAt].join(":"),
      mode: "historical_import",
      requestedByUserId: normalizeNullableString(requestedByUserId, 80),
      requestedAt,
      completedAt: flushAt,
      importedEntryCount,
      ignoredEntryCount,
      rebuiltUserCount: flushResult.rebuiltUserCount,
      finalizedSessionCount: flushResult.finalizedSessionCount,
      appliedRoleCount: initialRoleAssignment.appliedCount,
      importedUserCount: touchedUserIds.size,
    };

    liveState.calibrationRuns ||= [];
    liveState.calibrationRuns.push(calibrationRun);
    liveState.runtime.lastFullRecalcAt = flushAt;
    liveState.ops ||= {};
    liveState.ops.moderationAuditLog ||= [];
    liveState.ops.moderationAuditLog.push({
      actionType: "historical_import",
      moderatorUserId: normalizeNullableString(requestedByUserId, 80),
      createdAt: requestedAt,
      importedEntryCount,
      ignoredEntryCount,
      appliedRoleCount: initialRoleAssignment.appliedCount,
    });

    db.sot.activity = liveState;
    if (typeof saveDb === "function") {
      saveDb();
    }

    return {
      importedEntryCount,
      ignoredEntryCount,
      importedUserCount: touchedUserIds.size,
      finalizedSessionCount: flushResult.finalizedSessionCount,
      rebuiltUserCount: flushResult.rebuiltUserCount,
      flushedAt: flushResult.flushedAt,
      calibrationRun,
      initialRoleAssignment,
    };
  };

  if (typeof runSerialized === "function") {
    return runSerialized(execute, "activity-historical-import");
  }
  return execute();
}

async function runDailyActivityRoleSync({
  db = {},
  userIds,
  resolveMemberRoleIds,
  resolveMemberActivityMeta,
  applyRoleChanges,
  now,
  saveDb,
  runSerialized,
} = {}) {
  const execute = async () => {
    const syncedAt = resolveNowIso(now);
    const targetUserIds = collectActivityAssignmentTargetUserIds(db, userIds);
    const rebuildResult = await rebuildActivitySnapshots({
      db,
      userIds: targetUserIds,
      now: syncedAt,
      resolveMemberActivityMeta,
    });
    const roleAssignment = await applyInitialActivityRoleAssignments({
      db,
      userIds: targetUserIds,
      resolveMemberRoleIds,
      applyRoleChanges,
      now: syncedAt,
    });

    const state = ensureActivityState(db);
    state.runtime.lastFullRecalcAt = syncedAt;
    state.runtime.lastDailyRoleSyncAt = syncedAt;
    state.runtime.lastDailyRoleSyncStats = {
      targetUserCount: targetUserIds.length,
      rebuiltUserCount: rebuildResult.rebuiltUserCount,
      appliedCount: roleAssignment.appliedCount,
      skippedCount: roleAssignment.skippedCount,
    };
    db.sot.activity = state;
    if (typeof saveDb === "function") {
      saveDb();
    }

    return {
      syncedAt,
      targetUserCount: targetUserIds.length,
      rebuiltUserCount: rebuildResult.rebuiltUserCount,
      rebuiltUsers: rebuildResult.rebuiltUsers,
      roleAssignment,
    };
  };

  if (typeof runSerialized === "function") {
    return runSerialized(execute, "activity-daily-role-sync");
  }
  return execute();
}

async function importHistoricalActivityFromWatchedChannels({
  db = {},
  requestedByUserId,
  fetchChannel,
  now,
  resolveMemberRoleIds,
  applyRoleChanges,
  saveDb,
  runSerialized,
} = {}) {
  const execute = async () => {
    if (typeof fetchChannel !== "function") {
      throw new TypeError("fetchChannel must be a function");
    }

    if (ACTIVE_HISTORICAL_IMPORTS.has(db)) {
      return {
        alreadyRunning: true,
        importedEntryCount: 0,
        ignoredEntryCount: 0,
        importedUserCount: 0,
        finalizedSessionCount: 0,
        rebuiltUserCount: 0,
        flushedAt: resolveNowIso(now),
        calibrationRun: null,
        initialRoleAssignment: {
          appliedCount: 0,
          skippedCount: 0,
          appliedUserIds: [],
          skippedUserIds: [],
          skippedReasons: {},
        },
        scannedChannelCount: 0,
        scannedMessageCount: 0,
        failedChannelCount: 0,
        failedChannels: [],
      };
    }

    ACTIVE_HISTORICAL_IMPORTS.add(db);
    try {
      const state = ensureActivityState(db);
      const watchedChannels = Array.isArray(state.watchedChannels) ? state.watchedChannels : [];
      const collectedEntries = [];
      const channelUpdates = new Map();
      const failedChannels = [];
      const errorTimestamp = resolveNowIso(now);
      let scannedChannelCount = 0;
      let scannedMessageCount = 0;

      for (const watchedChannel of watchedChannels) {
        if (!watchedChannel || watchedChannel.enabled === false) continue;

        let newestImportedMessageId = null;
        let lastScannedMessageId = null;

        try {
          const channel = await fetchChannel(watchedChannel.channelId);
          if (!channel?.isTextBased?.()) {
            failedChannels.push({
              channelId: watchedChannel.channelId,
              reason: "channel_not_accessible",
            });
            continue;
          }
          scannedChannelCount += 1;

          let before = null;
          let reachedCursor = false;

          while (true) {
            const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
            if (!batch?.size) break;

            for (const message of batch.values()) {
              scannedMessageCount += 1;
              lastScannedMessageId = cleanString(message?.id, 80) || lastScannedMessageId;

              if (message?.id && message.id === watchedChannel.importedUntilMessageId) {
                reachedCursor = true;
                break;
              }

              if (!message?.author?.id || message.author.bot) continue;
              const createdAt = normalizeIsoTimestamp(message.createdAt, null);
              const guildId = cleanString(message.guildId ?? message.guild?.id ?? watchedChannel.guildId, 80);
              if (!createdAt || !guildId) continue;

              newestImportedMessageId ||= cleanString(message.id, 80) || null;
              collectedEntries.push({
                guildId,
                userId: cleanString(message.author.id, 80),
                channelId: watchedChannel.channelId,
                messageId: cleanString(message.id, 80),
                createdAt,
              });
            }

            if (reachedCursor) break;
            before = cleanString(batch.last()?.id, 80) || null;
            if (!before || batch.size < 100) break;
          }

          channelUpdates.set(watchedChannel.channelId, {
            importedUntilMessageId: newestImportedMessageId || cleanString(watchedChannel.importedUntilMessageId, 80),
            lastScannedMessageId,
          });
        } catch (error) {
          if (newestImportedMessageId || lastScannedMessageId) {
            channelUpdates.set(watchedChannel.channelId, {
              importedUntilMessageId: newestImportedMessageId || cleanString(watchedChannel.importedUntilMessageId, 80),
              lastScannedMessageId,
            });
          }
          failedChannels.push({
            channelId: watchedChannel.channelId,
            reason: cleanString(error?.message || error, 200) || "import_failed",
          });
        }
      }

      const importResult = await importHistoricalActivity({
        db,
        entries: collectedEntries,
        requestedByUserId,
        now,
        resolveMemberRoleIds,
        applyRoleChanges,
      });
      const liveState = ensureActivityState(db);

      for (const watchedChannel of liveState.watchedChannels || []) {
        const update = channelUpdates.get(watchedChannel.channelId);
        if (!update) continue;
        watchedChannel.importedUntilMessageId = cleanString(update.importedUntilMessageId, 80);
        watchedChannel.lastScannedMessageId = cleanString(update.lastScannedMessageId, 80);
        watchedChannel.lastImportAt = importResult.flushedAt;
      }

      if (importResult.calibrationRun && typeof importResult.calibrationRun === "object") {
        importResult.calibrationRun.failedChannelCount = failedChannels.length;
      }
      if (Array.isArray(liveState.calibrationRuns) && liveState.calibrationRuns.length) {
        liveState.calibrationRuns[liveState.calibrationRuns.length - 1] = {
          ...liveState.calibrationRuns[liveState.calibrationRuns.length - 1],
          failedChannelCount: failedChannels.length,
        };
      }
      if (failedChannels.length) {
        const existingErrors = Array.isArray(liveState.runtime?.errors) ? liveState.runtime.errors : [];
        const retainedErrors = existingErrors.slice(-Math.max(0, 10 - failedChannels.length));
        const nextErrors = [...retainedErrors];
        for (const failedChannel of failedChannels) {
          nextErrors.push({
            scope: "historical_import",
            createdAt: errorTimestamp,
            channelId: failedChannel.channelId,
            reason: failedChannel.reason,
          });
        }
        liveState.runtime = {
          ...(liveState.runtime || {}),
          errors: nextErrors,
        };
      }

      db.sot.activity = liveState;
      if (typeof saveDb === "function") {
        saveDb();
      }

      return {
        ...importResult,
        scannedChannelCount,
        scannedMessageCount,
        failedChannelCount: failedChannels.length,
        failedChannels,
        alreadyRunning: false,
      };
    } finally {
      ACTIVE_HISTORICAL_IMPORTS.delete(db);
    }
  };

  if (typeof runSerialized === "function") {
    return runSerialized(execute, "activity-historical-import-from-watched-channels");
  }
  return execute();
}

async function handleActivityPanelButtonInteraction({
  interaction,
  client,
  db = {},
  isModerator,
  replyNoPermission,
  buildModeratorPanelPayload,
  buildActivityPanelPayload,
  runHistoricalImport = importHistoricalActivityFromWatchedChannels,
  runInitialRoleAssignment = runDailyActivityRoleSync,
  fetchChannel,
  resolveMemberRoleIds,
  resolveMemberActivityMeta,
  applyRoleChanges,
  saveDb,
  runSerialized,
} = {}) {
  const customId = String(interaction?.customId || "").trim();
  if (!ACTIVITY_PANEL_BUTTON_IDS.includes(customId)) {
    return false;
  }

  if (typeof isModerator !== "function") {
    throw new TypeError("isModerator must be a function");
  }
  if (typeof replyNoPermission !== "function") {
    throw new TypeError("replyNoPermission must be a function");
  }
  if (typeof buildModeratorPanelPayload !== "function") {
    throw new TypeError("buildModeratorPanelPayload must be a function");
  }

  if (!isModerator(interaction?.member)) {
    await replyNoPermission(interaction);
    return true;
  }

  if (customId === "panel_open_activity") {
    await interaction.update(buildActivityPanelPayload({ db, statusText: "" }));
    return true;
  }

  if (customId === "activity_panel_refresh") {
    await interaction.update(buildActivityPanelPayload({
      db,
      statusText: "Activity panel refreshed.",
    }));
    return true;
  }

  if (customId === "activity_panel_back") {
    await interaction.update(await buildModeratorPanelPayload(client, "", false));
    return true;
  }

  if (customId === "activity_panel_config_access") {
    await interaction.showModal(buildActivityAccessConfigModal(ensureActivityState(db).config || {}));
    return true;
  }

  if (customId === "activity_panel_config_roles_primary") {
    await interaction.showModal(buildActivityRoleMappingModal({
      config: ensureActivityState(db).config || {},
      modalId: "activity_panel_config_roles_primary_modal",
      title: "Activity roles 1/2",
      roleKeys: ACTIVITY_ROLE_MAPPING_PRIMARY_KEYS,
    }));
    return true;
  }

  if (customId === "activity_panel_config_roles_secondary") {
    await interaction.showModal(buildActivityRoleMappingModal({
      config: ensureActivityState(db).config || {},
      modalId: "activity_panel_config_roles_secondary_modal",
      title: "Activity roles 2/2",
      roleKeys: ACTIVITY_ROLE_MAPPING_SECONDARY_KEYS,
    }));
    return true;
  }

  if (customId === "activity_panel_config_watch_save") {
    await interaction.showModal(buildWatchedChannelSaveModal());
    return true;
  }

  if (customId === "activity_panel_config_watch_remove") {
    await interaction.showModal(buildWatchedChannelRemoveModal());
    return true;
  }

  await interaction.deferUpdate();
  if (customId === "activity_panel_historical_import") {
    let result;
    try {
      result = await runHistoricalImport({
        db,
        client,
        requestedByUserId: cleanString(interaction?.user?.id, 80),
        fetchChannel,
        resolveMemberRoleIds,
        resolveMemberActivityMeta,
        applyRoleChanges,
        saveDb,
        runSerialized,
      });
    } catch (error) {
      await interaction.editReply(buildActivityPanelPayload({
        db,
        statusText: `Historical import failed: ${cleanString(error?.message || error, 500) || "unknown error"}.`,
      }));
      return true;
    }

    const statusText = result.alreadyRunning
      ? "Импорт истории уже выполняется. Дождись завершения текущего запуска."
      : [
        `Импорт истории завершён. Импортировано ${result.importedEntryCount}, пропущено ${result.ignoredEntryCount}.`,
        result.failedChannelCount ? `Каналов с ошибками: ${result.failedChannelCount}.` : "Все каналы обработаны без ошибок.",
      ].join(" ");
    await interaction.editReply(buildActivityPanelPayload({
      db,
      statusText,
    }));
    return true;
  }

  const result = await runInitialRoleAssignment({
    db,
    resolveMemberRoleIds,
    resolveMemberActivityMeta,
    applyRoleChanges,
    saveDb,
    runSerialized,
  });
  await interaction.editReply(buildActivityPanelPayload({
    db,
    statusText: `Initial role assignment завершён. Applied ${result.appliedCount}, skipped ${result.skippedCount}.`,
  }));
  return true;
}

async function handleActivityPanelModalSubmitInteraction({
  interaction,
  db,
  isModerator,
  replyNoPermission,
  replyError,
  replySuccess,
  parseRequestedRoleId,
  parseRequestedChannelId,
  resolveChannel,
  saveDb,
  runSerialized,
  now,
} = {}) {
  const customId = String(interaction?.customId || "").trim();
  if (!ACTIVITY_PANEL_MODAL_IDS.includes(customId)) {
    return false;
  }

  assertFunction(isModerator, "isModerator");
  assertFunction(replyNoPermission, "replyNoPermission");
  assertFunction(replyError, "replyError");
  assertFunction(replySuccess, "replySuccess");

  if (!isModerator(interaction?.member)) {
    await replyNoPermission(interaction);
    return true;
  }

  const execute = async () => {
    const changedAt = resolveNowIso(now);
    const requestedByUserId = normalizeNullableString(interaction?.user?.id, 80);

    if (customId === "activity_panel_config_watch_save_modal") {
      assertFunction(parseRequestedChannelId, "parseRequestedChannelId");
      assertFunction(resolveChannel, "resolveChannel");

      const parsedChannels = parseRequestedChannelIds(
        interaction.fields.getTextInputValue("activity_watch_channel_list"),
        parseRequestedChannelId
      );
      if (parsedChannels.invalidTokens.length) {
        return {
          ok: false,
          message: `Некорректные каналы: ${parsedChannels.invalidTokens.join(", ")}. Используй Channel ID или <#...>.`,
        };
      }
      if (!parsedChannels.channelIds.length) {
        return {
          ok: false,
          message: "Список каналов пуст. Укажи хотя бы один Channel ID или <#...>.",
        };
      }

      const resolvedChannels = [];
      for (const channelId of parsedChannels.channelIds) {
        const resolvedChannel = await Promise.resolve(resolveChannel(channelId));
        if (!resolvedChannel?.isTextBased?.()) {
          return {
            ok: false,
            message: `Канал не найден или не является text channel, доступным боту: ${channelId}.`,
          };
        }
        resolvedChannels.push({
          channelId,
          resolvedChannel,
          existingRecord: getWatchedChannel(db, channelId),
        });
      }

      const desiredChannelIds = new Set(resolvedChannels.map((entry) => entry.channelId));
      const currentChannels = Array.isArray(ensureActivityState(db).watchedChannels)
        ? [...ensureActivityState(db).watchedChannels]
        : [];
      let addedCount = 0;
      let updatedCount = 0;
      let removedCount = 0;

      for (const { channelId, resolvedChannel, existingRecord } of resolvedChannels) {
        const upsertResult = upsertWatchedChannel(db, {
          channelId,
          guildId: cleanString(resolvedChannel.guildId ?? resolvedChannel.guild?.id, 80) || existingRecord?.guildId || null,
          channelNameCache: cleanString(resolvedChannel.name, 200) || existingRecord?.channelNameCache || "",
          channelType: "normal_chat",
          channelWeight: 1,
          enabled: true,
          countMessages: true,
          countSessions: true,
          countForTrust: true,
          countForRoles: true,
          now: changedAt,
        });

        if (upsertResult.created) addedCount += 1;
        else if (upsertResult.mutated) updatedCount += 1;
      }

      for (const record of currentChannels) {
        if (!desiredChannelIds.has(record.channelId)) {
          const removeResult = removeWatchedChannel(db, { channelId: record.channelId });
          if (removeResult.removed) removedCount += 1;
        }
      }

      appendActivityAuditLog(db, {
        actionType: "watch_channel_sync",
        moderatorUserId: requestedByUserId,
        createdAt: changedAt,
        channelIds: [...desiredChannelIds],
        addedCount,
        updatedCount,
        removedCount,
      });
      if (typeof saveDb === "function") {
        saveDb();
      }

      return {
        ok: true,
        message: `Список каналов сохранён. Сейчас каналов: ${desiredChannelIds.size}. Добавлено: ${addedCount}, обновлено: ${updatedCount}, удалено: ${removedCount}. Все каналы считаются одинаково.`,
      };
    }

    if (customId === "activity_panel_config_watch_remove_modal") {
      assertFunction(parseRequestedChannelId, "parseRequestedChannelId");

      const channelId = parseRequestedChannelId(
        interaction.fields.getTextInputValue("activity_watch_remove_channel_id"),
        ""
      );
      if (!channelId) {
        return {
          ok: false,
          message: "Некорректный channel input. Используй Channel ID или <#...>.",
        };
      }

      const removeResult = removeWatchedChannel(db, { channelId });
      if (!removeResult.removed) {
        return {
          ok: false,
          message: `Watched channel не найден: ${channelId}.`,
        };
      }

      appendActivityAuditLog(db, {
        actionType: "watch_channel_remove",
        moderatorUserId: requestedByUserId,
        createdAt: changedAt,
        channelId,
      });
      if (typeof saveDb === "function") {
        saveDb();
      }

      return {
        ok: true,
        message: `Watched channel удалён: ${formatChannelPreview(removeResult.record)}. Нажми «Обновить» в Activity Panel.`,
      };
    }

    assertFunction(parseRequestedRoleId, "parseRequestedRoleId");

    if (customId === "activity_panel_config_access_modal") {
      const moderatorRoles = parseRequestedRoleIds(
        interaction.fields.getTextInputValue("activity_access_moderator_roles"),
        parseRequestedRoleId
      );
      const adminRoles = parseRequestedRoleIds(
        interaction.fields.getTextInputValue("activity_access_admin_roles"),
        parseRequestedRoleId
      );
      const invalidTokens = [...moderatorRoles.invalidTokens, ...adminRoles.invalidTokens];
      if (invalidTokens.length) {
        return {
          ok: false,
          message: `Некорректные role tokens: ${invalidTokens.join(", ")}. Используй Role ID или <@&...>.`,
        };
      }

      const updateResult = updateActivityConfig(db, {
        moderatorRoleIds: moderatorRoles.roleIds,
        adminRoleIds: adminRoles.roleIds,
      });

      if (!updateResult.mutated) {
        return {
          ok: true,
          message: "Activity access без изменений.",
        };
      }

      appendActivityAuditLog(db, {
        actionType: "activity_access_config_update",
        moderatorUserId: requestedByUserId,
        createdAt: changedAt,
        moderatorRoleIds: moderatorRoles.roleIds,
        adminRoleIds: adminRoles.roleIds,
      });
      if (typeof saveDb === "function") {
        saveDb();
      }

      return {
        ok: true,
        message: `Activity access обновлён. Moderator roles: ${moderatorRoles.roleIds.length}, admin roles: ${adminRoles.roleIds.length}. Нажми «Обновить» в Activity Panel.`,
      };
    }

    const roleKeys = customId === "activity_panel_config_roles_primary_modal"
      ? ACTIVITY_ROLE_MAPPING_PRIMARY_KEYS
      : ACTIVITY_ROLE_MAPPING_SECONDARY_KEYS;
    const activityRoleIds = {};
    const invalidRoleInputs = [];
    for (const roleKey of roleKeys) {
      const parsed = parseOptionalRequestedRoleId(
        interaction.fields.getTextInputValue(`activity_role_${roleKey}`),
        parseRequestedRoleId
      );
      if (parsed.invalidToken) {
        invalidRoleInputs.push(`${roleKey}=${parsed.invalidToken}`);
        continue;
      }
      activityRoleIds[roleKey] = parsed.roleId || null;
    }

    if (invalidRoleInputs.length) {
      return {
        ok: false,
        message: `Некорректные role inputs: ${invalidRoleInputs.join(", ")}. Используй Role ID или <@&...>.`,
      };
    }

    const updateResult = updateActivityConfig(db, {
      activityRoleIds,
    });

    if (!updateResult.mutated) {
      return {
        ok: true,
        message: "Activity role mapping без изменений.",
      };
    }

    appendActivityAuditLog(db, {
      actionType: "activity_role_mapping_update",
      moderatorUserId: requestedByUserId,
      createdAt: changedAt,
      activityRoleIds,
      updatedRoleKeys: roleKeys,
    });
    if (typeof saveDb === "function") {
      saveDb();
    }

    return {
      ok: true,
      message: `Activity role mapping обновлён. Total mapped roles: ${listActivityManagedRoleIds(updateResult.config).length}. Нажми «Обновить» в Activity Panel.`,
    };
  };

  const result = typeof runSerialized === "function"
    ? await runSerialized(execute, `activity-config-submit:${customId}`)
    : await execute();

  if (!result.ok) {
    await replyError(interaction, result.message);
    return true;
  }

  await replySuccess(interaction, result.message);
  return true;
}

module.exports = {
  applyInitialActivityRoleAssignments,
  buildActivityRoleAssignmentPlan,
  buildActivityOperatorPanelPayload,
  handleActivityPanelButtonInteraction,
  handleActivityPanelModalSubmitInteraction,
  importHistoricalActivity,
  importHistoricalActivityFromWatchedChannels,
  runDailyActivityRoleSync,
};