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

const ACTIVITY_PANEL_DEFAULT_VIEW = "overview";
const ACTIVITY_PANEL_VIEWS = Object.freeze(["overview", "channels", "roles", "runtime"]);
const ACTIVITY_PANEL_VIEW_TITLES = Object.freeze({
  overview: "Обзор",
  channels: "Каналы и импорт",
  roles: "Роли и правила",
  runtime: "Процессы",
});

const ACTIVITY_ROLE_SYNC_SKIP_REASON_LABELS = Object.freeze({
  missing_user_id: "нет user id",
  manual_override: "manual override",
  auto_role_frozen: "автороли заморожены",
  member_too_new: "ещё не прошёл gate",
  missing_desired_role: "нет целевой роли",
  missing_role_mapping: "нет mapping для роли",
  unchanged: "без изменений",
  missing_apply_callback: "нет apply callback",
  apply_declined: "Discord apply отклонён",
});

const ACTIVITY_PANEL_BUTTON_IDS = Object.freeze([
  "panel_open_activity",
  "activity_panel_view_overview",
  "activity_panel_view_channels",
  "activity_panel_view_roles",
  "activity_panel_view_runtime",
  "activity_panel_refresh_overview",
  "activity_panel_refresh_channels",
  "activity_panel_refresh_roles",
  "activity_panel_refresh_runtime",
  "activity_panel_historical_import",
  "activity_panel_rebuild_metrics",
  "activity_panel_sync_roles",
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

    function normalizeActivityPanelView(value) {
      const view = cleanString(value, 40).toLowerCase();
      return ACTIVITY_PANEL_VIEWS.includes(view) ? view : ACTIVITY_PANEL_DEFAULT_VIEW;
    }

    function getActivityPanelViewTitle(view) {
      return ACTIVITY_PANEL_VIEW_TITLES[normalizeActivityPanelView(view)] || ACTIVITY_PANEL_VIEW_TITLES[ACTIVITY_PANEL_DEFAULT_VIEW];
    }

    function getActivityPanelViewButtonId(view) {
      return `activity_panel_view_${normalizeActivityPanelView(view)}`;
    }

    function getActivityPanelRefreshButtonId(view) {
      return `activity_panel_refresh_${normalizeActivityPanelView(view)}`;
    }

    function parseActivityPanelButtonView(customId = "") {
      const normalizedCustomId = cleanString(customId, 120);
      if (normalizedCustomId.startsWith("activity_panel_view_")) {
        return normalizeActivityPanelView(normalizedCustomId.slice("activity_panel_view_".length));
      }
      if (normalizedCustomId.startsWith("activity_panel_refresh_")) {
        return normalizeActivityPanelView(normalizedCustomId.slice("activity_panel_refresh_".length));
      }
      return null;
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

    function buildWatchedChannelImportPreview(state = {}, limit = 4) {
      const watchedChannels = Array.isArray(state.watchedChannels) ? state.watchedChannels : [];
      if (!watchedChannels.length) return "Список каналов ещё не настроен.";

      const lines = watchedChannels
        .slice(0, Math.max(1, Number(limit) || 1))
        .map((record, index) => [
          `${index + 1}. ${formatChannelPreview(record)}`,
          `   Последний import: ${formatDateTime(record?.lastImportAt)} • cursor: ${cleanString(record?.importedUntilMessageId, 32) || "—"} • scan: ${cleanString(record?.lastScannedMessageId, 32) || "—"}`,
        ].join("\n"));
      if (watchedChannels.length > lines.length) {
        lines.push(`… ещё ${watchedChannels.length - lines.length}`);
      }
      return lines.join("\n");
    }

    function buildActivityRuntimeErrorPreview(state = {}, limit = 3) {
      const errors = Array.isArray(state.runtime?.errors) ? state.runtime.errors.slice(-Math.max(1, Number(limit) || 1)).reverse() : [];
      if (!errors.length) return "Ошибок не зафиксировано.";

      return errors
        .map((entry, index) => {
          const scope = cleanString(entry?.scope, 40) || "runtime";
          const target = cleanString(entry?.channelId, 80) || cleanString(entry?.userId, 80) || "—";
          const reason = cleanString(entry?.reason || entry?.message, 120) || "unknown";
          return `${index + 1}. ${scope} • ${target} • ${reason} • ${formatDateTime(entry?.createdAt)}`;
        })
        .join("\n");
    }

    function formatActivityRoleSyncMode(syncMode) {
      return cleanString(syncMode, 40) === "roles_only"
        ? "Только синхронизация ролей"
        : "Пересчёт метрик + синхронизация ролей";
    }

    function summarizeActivitySkipReasonCounts(skippedReasons = {}) {
      const counts = {};
      const source = skippedReasons && typeof skippedReasons === "object" && !Array.isArray(skippedReasons)
        ? skippedReasons
        : {};

      for (const reason of Object.values(source)) {
        const normalizedReason = cleanString(reason, 80);
        if (!normalizedReason) continue;
        counts[normalizedReason] = Number(counts[normalizedReason] || 0) + 1;
      }

      return counts;
    }

    function formatActivitySkipReasonLabel(reason) {
      const normalizedReason = cleanString(reason, 80);
      return ACTIVITY_ROLE_SYNC_SKIP_REASON_LABELS[normalizedReason] || normalizedReason || "прочее";
    }

    function buildActivitySkipReasonPreview(skipReasonCounts = {}, limit = 4) {
      const source = skipReasonCounts && typeof skipReasonCounts === "object" && !Array.isArray(skipReasonCounts)
        ? skipReasonCounts
        : {};
      const entries = Object.entries(source)
        .map(([reason, count]) => [cleanString(reason, 80), Number(count || 0)])
        .filter(([reason, count]) => reason && count > 0)
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));

      if (!entries.length) return "Skipped reasons не зафиксированы.";

      const lines = entries
        .slice(0, Math.max(1, Number(limit) || 1))
        .map(([reason, count]) => `${formatActivitySkipReasonLabel(reason)}: **${count}**`);
      if (entries.length > lines.length) {
        lines.push(`… ещё ${entries.length - lines.length}`);
      }
      return lines.join("\n");
    }

    function countActivityRuntimeErrors(state = {}) {
      return Array.isArray(state.runtime?.errors) ? state.runtime.errors.length : 0;
    }

    function buildActivityPanelDiagnosticEmbed({ title = "", description = "", fields = [] } = {}) {
      const embed = new EmbedBuilder().setTitle(cleanString(title, 200) || "Activity Panel • Диагностика");
      const normalizedDescription = cleanString(description, 2000);
      if (normalizedDescription) {
        embed.setDescription(normalizedDescription);
      }
      if (Array.isArray(fields) && fields.length) {
        embed.addFields(fields);
      }
      return embed;
    }

    function buildActivityPanelNextStepPreview({
      view = ACTIVITY_PANEL_DEFAULT_VIEW,
      watchedChannelCount = 0,
      mappedRoleCount = 0,
      runtimeErrorCount = 0,
      channelsWithoutImportCheckpointCount = 0,
      missingLocalHistoryUserCount = 0,
      openSessionCount = 0,
      dirtyUserCount = 0,
      lastCalibrationRun = null,
      dailyRoleSyncStats = null,
    } = {}) {
      const normalizedView = normalizeActivityPanelView(view);

      if (normalizedView === "channels") {
        if (!watchedChannelCount) {
          return "Сначала добавь хотя бы один watched channel и сохрани список.";
        }
        if (runtimeErrorCount > 0) {
          return "Есть ошибки import/runtime: проверь доступ к каналам и повтори import при необходимости.";
        }
        if (!lastCalibrationRun) {
          return "После настройки списка запусти «Импорт истории», чтобы заполнить локальную активность за старые сообщения.";
        }
        if (channelsWithoutImportCheckpointCount > 0) {
          return `У ${channelsWithoutImportCheckpointCount} каналов ещё нет import checkpoint: после проверки списка запусти «Импорт истории».`;
        }
        return "Checkpoint-ы уже есть. Повторный import нужен после расширения списка каналов или если нужно добрать старую активность.";
      }

      if (normalizedView === "roles") {
        if (!mappedRoleCount) {
          return "Сначала заполни activity role mapping, иначе sync roles не сможет корректно выдать роли.";
        }
        if (missingLocalHistoryUserCount > 0) {
          return `Есть ${missingLocalHistoryUserCount} users без локальной истории: сначала historical import, потом sync roles.`;
        }
        if (Number(dailyRoleSyncStats?.skippedCount || 0) > 0) {
          return "Посмотри breakdown skipped ниже: он покажет, нужен ли import, role mapping или ручная проверка.";
        }
        return "Если score уже актуален, «Синхронизировать роли» можно использовать как отдельное безопасное выравнивание без rebuild metrics.";
      }

      if (normalizedView === "runtime") {
        if (runtimeErrorCount > 0) {
          return "Сначала проверь последние ошибки runtime. Ручной rebuild metrics имеет смысл только после устранения блокеров.";
        }
        if (openSessionCount > 0 || dirtyUserCount > 0) {
          return "Runtime ещё живой: дождись flush или обнови раздел позже, если нужна самая свежая картина.";
        }
        return "Runtime спокоен: ручной пересчёт нужен только после import, для forced reconciliation или проверки новых правил.";
      }

      if (!watchedChannelCount) {
        return "Начни с раздела «Каналы и импорт»: без watched channels activity не накопится.";
      }
      if (!mappedRoleCount) {
        return "Потом заполни раздел «Роли и правила», иначе sync roles будет неполным.";
      }
      if (missingLocalHistoryUserCount > 0) {
        return "Есть users без локальной истории: запусти «Импорт истории» перед sync roles.";
      }
      if (runtimeErrorCount > 0) {
        return "Есть runtime errors: открой раздел «Процессы» и проверь последние сбои.";
      }
      return "Явных блокеров нет. Используй import для старой истории, rebuild для нового score и sync для точечной выдачи ролей.";
    }

    function buildActivityPanelNavigationRow(activeView = ACTIVITY_PANEL_DEFAULT_VIEW) {
      const normalizedView = normalizeActivityPanelView(activeView);
      return new ActionRowBuilder().addComponents(
        ...ACTIVITY_PANEL_VIEWS.map((view) => new ButtonBuilder()
          .setCustomId(getActivityPanelViewButtonId(view))
          .setLabel(getActivityPanelViewTitle(view))
          .setStyle(view === normalizedView ? ButtonStyle.Primary : ButtonStyle.Secondary)),
        new ButtonBuilder().setCustomId("activity_panel_back").setLabel("Назад").setStyle(ButtonStyle.Secondary)
      );
    }

    function buildActivityPanelActionRows(activeView = ACTIVITY_PANEL_DEFAULT_VIEW) {
      const normalizedView = normalizeActivityPanelView(activeView);

      if (normalizedView === "channels") {
        return [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(getActivityPanelRefreshButtonId(normalizedView)).setLabel("Обновить").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("activity_panel_historical_import").setLabel("Импорт истории").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("activity_panel_config_watch_save").setLabel("Редактировать").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("activity_panel_config_watch_remove").setLabel("Убрать канал").setStyle(ButtonStyle.Secondary)
          ),
        ];
      }

      if (normalizedView === "roles") {
        return [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(getActivityPanelRefreshButtonId(normalizedView)).setLabel("Обновить").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("activity_panel_sync_roles").setLabel("Синхронизировать роли").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId("activity_panel_config_access").setLabel("Доступ").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("activity_panel_config_roles_primary").setLabel("Роли 1/2").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("activity_panel_config_roles_secondary").setLabel("Роли 2/2").setStyle(ButtonStyle.Secondary)
          ),
        ];
      }

      if (normalizedView === "runtime") {
        return [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(getActivityPanelRefreshButtonId(normalizedView)).setLabel("Обновить").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("activity_panel_rebuild_metrics").setLabel("Пересчитать метрики").setStyle(ButtonStyle.Primary)
          ),
        ];
      }

      return [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(getActivityPanelRefreshButtonId(normalizedView)).setLabel("Обновить").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("activity_panel_historical_import").setLabel("Импорт истории").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("activity_panel_rebuild_metrics").setLabel("Пересчитать метрики").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId("activity_panel_sync_roles").setLabel("Синхронизировать роли").setStyle(ButtonStyle.Success)
        ),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("activity_panel_config_access").setLabel("Доступ").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("activity_panel_config_roles_primary").setLabel("Роли 1/2").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("activity_panel_config_roles_secondary").setLabel("Роли 2/2").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("activity_panel_config_watch_save").setLabel("Каналы").setStyle(ButtonStyle.Secondary)
        ),
      ];
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

function collectActivityAssignmentTargetUserIds(db, explicitUserIds = [], managedRoleUserIds = []) {
  const state = ensureActivityState(db);
  const targetUserIds = new Set([
    ...normalizeStringArray(explicitUserIds, 5000),
    ...normalizeStringArray(managedRoleUserIds, 5000),
  ]);

  for (const userId of Object.keys(state.userSnapshots || {})) {
    const normalizedUserId = cleanString(userId, 80);
    if (normalizedUserId) targetUserIds.add(normalizedUserId);
  }

  for (const userId of Object.keys(state.runtime?.openSessions || {})) {
    const normalizedUserId = cleanString(userId, 80);
    if (normalizedUserId) targetUserIds.add(normalizedUserId);
  }

  for (const userId of Array.isArray(state.runtime?.dirtyUsers) ? state.runtime.dirtyUsers : []) {
    const normalizedUserId = cleanString(userId, 80);
    if (normalizedUserId) targetUserIds.add(normalizedUserId);
  }

  for (const session of Array.isArray(state.globalUserSessions) ? state.globalUserSessions : []) {
    const normalizedUserId = cleanString(session?.userId, 80);
    if (normalizedUserId) targetUserIds.add(normalizedUserId);
  }

  for (const row of Array.isArray(state.userChannelDailyStats) ? state.userChannelDailyStats : []) {
    const normalizedUserId = cleanString(row?.userId, 80);
    if (normalizedUserId) targetUserIds.add(normalizedUserId);
  }

  return [...targetUserIds];
}

function collectActivityHistoryTargetUserIds(db, explicitUserIds = []) {
  const state = ensureActivityState(db);
  const targetUserIds = new Set(normalizeStringArray(explicitUserIds, 5000));

  for (const userId of Object.keys(state.runtime?.openSessions || {})) {
    const normalizedUserId = cleanString(userId, 80);
    if (normalizedUserId) targetUserIds.add(normalizedUserId);
  }

  for (const userId of Array.isArray(state.runtime?.dirtyUsers) ? state.runtime.dirtyUsers : []) {
    const normalizedUserId = cleanString(userId, 80);
    if (normalizedUserId) targetUserIds.add(normalizedUserId);
  }

  for (const session of Array.isArray(state.globalUserSessions) ? state.globalUserSessions : []) {
    const normalizedUserId = cleanString(session?.userId, 80);
    if (normalizedUserId) targetUserIds.add(normalizedUserId);
  }

  for (const row of Array.isArray(state.userChannelDailyStats) ? state.userChannelDailyStats : []) {
    const normalizedUserId = cleanString(row?.userId, 80);
    if (normalizedUserId) targetUserIds.add(normalizedUserId);
  }

  return [...targetUserIds];
}

function collectActivitySnapshotTargetUserIds(db, explicitUserIds = []) {
  const state = ensureActivityState(db);
  const targetUserIds = new Set(normalizeStringArray(explicitUserIds, 5000));

  for (const userId of Object.keys(state.userSnapshots || {})) {
    const normalizedUserId = cleanString(userId, 80);
    if (normalizedUserId) targetUserIds.add(normalizedUserId);
  }

  return [...targetUserIds];
}

function getActivitySyncStatsRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function resolveActivitySyncHistory(runtime = {}) {
  const latestRoleSyncAt = cleanString(runtime?.lastDailyRoleSyncAt, 80) || null;
  const latestRoleSyncStats = getActivitySyncStatsRecord(runtime?.lastDailyRoleSyncStats);
  const latestRoleSyncMode = cleanString(latestRoleSyncStats?.syncMode, 40) || "";

  const lastRebuildAndRoleSyncStats = getActivitySyncStatsRecord(runtime?.lastRebuildAndRoleSyncStats)
    || (latestRoleSyncMode === "rebuild_and_sync" ? latestRoleSyncStats : null);
  const lastRebuildAndRoleSyncAt = cleanString(runtime?.lastRebuildAndRoleSyncAt, 80)
    || (latestRoleSyncMode === "rebuild_and_sync" ? latestRoleSyncAt : null)
    || null;
  const lastRolesOnlySyncStats = getActivitySyncStatsRecord(runtime?.lastRolesOnlySyncStats)
    || (latestRoleSyncMode === "roles_only" ? latestRoleSyncStats : null);
  const lastRolesOnlySyncAt = cleanString(runtime?.lastRolesOnlySyncAt, 80)
    || (latestRoleSyncMode === "roles_only" ? latestRoleSyncAt : null)
    || null;

  return {
    latestRoleSyncAt,
    latestRoleSyncStats,
    lastRebuildAndRoleSyncAt,
    lastRebuildAndRoleSyncStats,
    lastRolesOnlySyncAt,
    lastRolesOnlySyncStats,
  };
}

function buildActivitySyncOperationLines(label, at, stats, options = {}) {
  const normalizedStats = getActivitySyncStatsRecord(stats);
  if (!normalizedStats) {
    return [`${label}: ещё не запускался.`];
  }

  const lines = [
    `${label}: ${formatDateTime(at)}`,
    `Targets: **${Number(normalizedStats.targetUserCount || 0)}**`,
  ];

  if (options.includeRebuiltCount || cleanString(normalizedStats.syncMode, 40) === "rebuild_and_sync") {
    lines.push(`Rebuilt: **${Number(normalizedStats.rebuiltUserCount || 0)}**`);
  }

  lines.push(`Applied: **${Number(normalizedStats.appliedCount || 0)}**, skipped: **${Number(normalizedStats.skippedCount || 0)}**`);

  const missingLocalHistoryUserCount = Number(normalizedStats.missingLocalHistoryUserCount || 0);
  if (missingLocalHistoryUserCount > 0) {
    lines.push(`Need import rerun for old history: **${missingLocalHistoryUserCount}**`);
  }

  if (options.includeSkipReasons) {
    lines.push(buildActivitySkipReasonPreview(normalizedStats.skipReasonCounts));
  }

  return lines;
}

function buildActivityOperatorPanelPayload({ db = {}, statusText = "", view = ACTIVITY_PANEL_DEFAULT_VIEW } = {}) {
  const state = ensureActivityState(db);
  const config = state.config || {};
  const syncHistory = resolveActivitySyncHistory(state.runtime || {});
  const normalizedView = normalizeActivityPanelView(view);
  const watchedChannels = Array.isArray(state.watchedChannels) ? state.watchedChannels : [];
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
  const dailyRoleSyncStats = syncHistory.latestRoleSyncStats;
  const fullRebuildAndRoleSyncStats = syncHistory.lastRebuildAndRoleSyncStats;
  const rolesOnlySyncStats = syncHistory.lastRolesOnlySyncStats;
  const thresholds = config.activityRoleThresholds || {};
  const roleBoostMaxMultiplier = Math.max(1, Number(config.roleBoostMaxMultiplier) || 1);
  const syncMode = cleanString(dailyRoleSyncStats?.syncMode, 40) || "rebuild_and_sync";
  const runtimeErrorCount = countActivityRuntimeErrors(state);
  const channelsWithImportCursorCount = watchedChannels.filter((record) => cleanString(record?.importedUntilMessageId, 80)).length;
  const channelsWithCompletedImportCount = watchedChannels.filter((record) => cleanString(record?.lastImportAt, 80)).length;
  const channelsWithoutImportCheckpointCount = watchedChannels.filter((record) => !cleanString(record?.lastImportAt, 80) && !cleanString(record?.importedUntilMessageId, 80)).length;
  const missingLocalHistoryUserCount = Number(
    dailyRoleSyncStats?.missingLocalHistoryUserCount
    || rolesOnlySyncStats?.missingLocalHistoryUserCount
    || fullRebuildAndRoleSyncStats?.missingLocalHistoryUserCount
    || 0
  );
  const supportEmbeds = [];

  const embed = new EmbedBuilder()
    .setTitle(`Activity Panel • ${getActivityPanelViewTitle(normalizedView)}`);

  if (normalizedView === "channels") {
    embed
      .setDescription([
        "Здесь настраиваются каналы tracking и запускается historical import.",
        "Редактор каналов полностью заменяет текущий список watched channels.",
      ].join("\n"))
      .addFields(
        {
          name: "Импорт истории",
          value: lastCalibrationRun
            ? [
              `Последний запуск: **${cleanString(lastCalibrationRun.mode, 80) || "unknown"}**`,
              `Завершён: ${formatDateTime(lastCalibrationRun.completedAt)}`,
              `Импортировано сообщений: **${Number(lastCalibrationRun.importedEntryCount || 0)}**`,
              `Пользователей затронуто: **${Number(lastCalibrationRun.importedUserCount || 0)}**`,
              `Role assignments после import: **${Number(lastCalibrationRun.appliedRoleCount || 0)}**`,
              Number(lastCalibrationRun.failedChannelCount || 0)
                ? `Каналов с ошибками: **${Number(lastCalibrationRun.failedChannelCount || 0)}**`
                : "Каналы обработаны без ошибок.",
            ].join("\n")
            : [
              "Historical import ещё не запускался.",
              "Используй его, если нужно подтянуть старые сообщения до включения tracking.",
            ].join("\n"),
          inline: false,
        },
        {
          name: `Каналы tracking • ${watchedChannelCount}`,
          value: buildWatchedChannelImportPreview(state),
          inline: false,
        },
        {
          name: "Подсказка",
          value: [
            "Импорт истории не меняет список каналов.",
            "Кнопка «Редактировать» открывает полный список каналов и сохраняет его целиком.",
          ].join("\n"),
          inline: false,
        }
      );
    supportEmbeds.push(buildActivityPanelDiagnosticEmbed({
      title: "Activity Panel • Каналы • Диагностика",
      description: "Checkpoint-и, ошибки и краткая подсказка по кнопкам.",
      fields: [
        {
          name: "Checkpoint-и",
          value: [
            `Каналов с import cursor: **${channelsWithImportCursorCount}**`,
            `Каналов с completed import: **${channelsWithCompletedImportCount}**`,
            `Каналов без import checkpoint: **${channelsWithoutImportCheckpointCount}**`,
            `Ошибки import/runtime: **${runtimeErrorCount}**`,
          ].join("\n"),
          inline: false,
        },
        {
          name: "Когда использовать кнопки",
          value: [
            "Импорт истории: когда нужно подтянуть старые сообщения до включения tracking.",
            "Редактировать: когда меняется полный список watched channels.",
            "Убрать канал: когда нужно быстро удалить один channel из текущего списка.",
          ].join("\n"),
          inline: false,
        },
        {
          name: "Следующий шаг",
          value: buildActivityPanelNextStepPreview({
            view: normalizedView,
            watchedChannelCount,
            mappedRoleCount,
            runtimeErrorCount,
            channelsWithoutImportCheckpointCount,
            missingLocalHistoryUserCount,
            openSessionCount,
            dirtyUserCount,
            lastCalibrationRun,
            dailyRoleSyncStats,
          }),
          inline: false,
        },
      ],
    }));
  } else if (normalizedView === "roles") {
    embed
      .setDescription([
        "Здесь собраны правила activity-ролей и все действия по их выравниванию.",
        "Синхронизация ролей не пересчитывает score: она только сверяет Discord-роли с уже сохранёнными snapshots.",
      ].join("\n"))
      .addFields(
        {
          name: "Правила",
          value: [
            `Role gate: after **${Number(config.roleEligibilityMinMemberDays || 0)}** days on server`,
            `Newcomer boost: **x${roleBoostMaxMultiplier.toFixed(2)}** -> x1.00 by day **${Number(config.roleBoostEndMemberDays || 0)}**`,
            `Snapshots gated/boosted: **${gatedSnapshotCount}** / **${boostedSnapshotCount}**`,
            `Thresholds: weak ${Number(thresholds.weak ?? 18)}, floating ${Number(thresholds.floating ?? 38)}, active ${Number(thresholds.active ?? 55)}, stable ${Number(thresholds.stable ?? 70)}, core ${Number(thresholds.core ?? 85)}`,
          ].join("\n"),
          inline: false,
        },
        {
          name: "Маппинг и доступ",
          value: [
            `Activity moderators: ${formatRoleIdListPreview(config.moderatorRoleIds)}`,
            `Activity admins: ${formatRoleIdListPreview(config.adminRoleIds)}`,
            buildActivityRoleMappingPreview(config, ACTIVITY_ROLE_MAPPING_PRIMARY_KEYS),
            buildActivityRoleMappingPreview(config, ACTIVITY_ROLE_MAPPING_SECONDARY_KEYS),
          ].join("\n"),
          inline: false,
        },
        {
          name: "Последние операции",
          value: [
            ...buildActivitySyncOperationLines(
              "Последний полный rebuild+sync",
              syncHistory.lastRebuildAndRoleSyncAt,
              fullRebuildAndRoleSyncStats,
              { includeRebuiltCount: true }
            ),
            ...buildActivitySyncOperationLines(
              "Последний roles-only sync",
              syncHistory.lastRolesOnlySyncAt,
              rolesOnlySyncStats
            ),
            "Source: local saved activity sessions/stats only.",
          ].join("\n"),
          inline: false,
        }
      );
    supportEmbeds.push(buildActivityPanelDiagnosticEmbed({
      title: "Activity Panel • Роли • Диагностика",
      description: "Отдельно видно, почему sync roles что-то пропускает и какой следующий шаг нужен.",
      fields: [
        {
          name: "Full rebuild + sync",
          value: buildActivitySyncOperationLines(
            "Последний полный rebuild+sync",
            syncHistory.lastRebuildAndRoleSyncAt,
            fullRebuildAndRoleSyncStats,
            { includeRebuiltCount: true, includeSkipReasons: true }
          ).join("\n"),
          inline: false,
        },
        {
          name: "Roles-only sync",
          value: buildActivitySyncOperationLines(
            "Последний roles-only sync",
            syncHistory.lastRolesOnlySyncAt,
            rolesOnlySyncStats,
            { includeSkipReasons: true }
          ).join("\n"),
          inline: false,
        },
        {
          name: "Риски",
          value: [
            `Mapped roles: **${mappedRoleCount}**`,
            `Need import rerun for old history: **${missingLocalHistoryUserCount}**`,
            `Ошибки runtime: **${runtimeErrorCount}**`,
          ].join("\n"),
          inline: false,
        },
        {
          name: "Следующий шаг",
          value: buildActivityPanelNextStepPreview({
            view: normalizedView,
            watchedChannelCount,
            mappedRoleCount,
            runtimeErrorCount,
            channelsWithoutImportCheckpointCount,
            missingLocalHistoryUserCount,
            openSessionCount,
            dirtyUserCount,
            lastCalibrationRun,
            dailyRoleSyncStats,
          }),
          inline: false,
        },
      ],
    }));
  } else if (normalizedView === "runtime") {
    embed
      .setDescription([
        "Здесь видно текущее состояние runtime и последнего пересчёта activity-метрик.",
        "Кнопка «Пересчитать метрики» пересобирает snapshots из локальной истории и затем запускает sync roles.",
      ].join("\n"))
      .addFields(
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
          name: "Обработка",
          value: [
            `Analyzed messages: **${analyzedMessageCount}**`,
            `Weighted messages: **${Number(analyzedWeightedMessageCount.toFixed(2))}**`,
            `Finalized sessions: **${finalizedSessionCount}**`,
            `Open-session messages: **${openSessions.reduce((sum, entry) => sum + Number(entry?.messageCount || 0), 0)}**`,
            `Profiles with activity: **${activityProfileCount}**`,
          ].join("\n"),
          inline: false,
        },
        {
          name: "Последние ошибки",
          value: buildActivityRuntimeErrorPreview(state),
          inline: false,
        }
      );
    supportEmbeds.push(buildActivityPanelDiagnosticEmbed({
      title: "Activity Panel • Процессы • Диагностика",
      description: "Коротко о очереди, последнем flush и том, нужен ли ручной rebuild metrics.",
      fields: [
        {
          name: "Очередь",
          value: [
            `Open sessions: **${openSessionCount}**`,
            `Dirty users: **${dirtyUserCount}**`,
            `Finalized sessions: **${finalizedSessionCount}**`,
            `Ошибки runtime: **${runtimeErrorCount}**`,
          ].join("\n"),
          inline: false,
        },
        {
          name: "Последний rebuild",
          value: [
            `Last full recalc: ${formatDateTime(state.runtime?.lastFullRecalcAt)}`,
            ...buildActivitySyncOperationLines(
              "Последний полный rebuild+sync",
              syncHistory.lastRebuildAndRoleSyncAt,
              fullRebuildAndRoleSyncStats,
              { includeRebuiltCount: true }
            ),
            flushStats
              ? `Flush rebuilt users: **${Number(flushStats.rebuiltUserCount || 0)}** • finalized sessions: **${Number(flushStats.finalizedSessionCount || 0)}**`
              : "Flush stats ещё не зафиксированы.",
          ].join("\n"),
          inline: false,
        },
        {
          name: "Следующий шаг",
          value: buildActivityPanelNextStepPreview({
            view: normalizedView,
            watchedChannelCount,
            mappedRoleCount,
            runtimeErrorCount,
            channelsWithoutImportCheckpointCount,
            missingLocalHistoryUserCount,
            openSessionCount,
            dirtyUserCount,
            lastCalibrationRun,
            dailyRoleSyncStats,
          }),
          inline: false,
        },
      ],
    }));
  } else {
    embed
      .setDescription([
        "Закрытая мод-панель активности.",
        "Кнопки ниже разделены по смыслу: история, пересчёт метрик и отдельная синхронизация ролей.",
      ].join("\n"))
      .addFields(
        {
          name: "Сводка",
          value: [
            `Watched channels: **${watchedChannelCount}**`,
            `Mapped roles: **${mappedRoleCount}**`,
            `Snapshots: **${snapshotCount}**`,
            `Profiles with activity: **${activityProfileCount}**`,
          ].join("\n"),
          inline: false,
        },
        {
          name: "Что делает каждая кнопка",
          value: [
            "Импорт истории: подтягивает старые сообщения из watched channels.",
            "Пересчитать метрики: пересобирает activity snapshots из локальной истории и затем sync roles.",
            "Синхронизировать роли: только выравнивает роли по уже посчитанным snapshots, без нового score.",
          ].join("\n"),
          inline: false,
        },
        {
          name: "Импорт и роли",
          value: [
            lastCalibrationRun
              ? `Последний import: ${formatDateTime(lastCalibrationRun.completedAt)} • ${Number(lastCalibrationRun.importedEntryCount || 0)} entries`
              : "Historical import ещё не запускался.",
            fullRebuildAndRoleSyncStats
              ? `Последний полный rebuild+sync: ${formatDateTime(syncHistory.lastRebuildAndRoleSyncAt)}`
              : "Полный rebuild+sync ещё не запускался.",
            rolesOnlySyncStats
              ? `Последний roles-only sync: ${formatDateTime(syncHistory.lastRolesOnlySyncAt)}`
              : "Roles-only sync ещё не запускался.",
            dailyRoleSyncStats
              ? `Последний режим sync: ${formatActivityRoleSyncMode(syncMode)}`
              : "Последний режим sync: n/a.",
            dailyRoleSyncStats
              ? `Need import rerun for old history: **${missingLocalHistoryUserCount}**`
              : "Для старой активности до включения tracking нужен historical import.",
          ].join("\n"),
          inline: false,
        },
        {
          name: "Процессы",
          value: [
            `Open sessions: **${openSessionCount}**`,
            `Dirty users: **${dirtyUserCount}**`,
            `Analyzed messages: **${analyzedMessageCount}**`,
            `Snapshots gated/boosted: **${gatedSnapshotCount}** / **${boostedSnapshotCount}**`,
          ].join("\n"),
          inline: false,
        }
      );
    supportEmbeds.push(buildActivityPanelDiagnosticEmbed({
      title: "Activity Panel • Что важно",
      description: "Короткий dashboard по блокерам, последнему sync и рекомендуемому следующему действию.",
      fields: [
        {
          name: "Диагностика",
          value: [
            `Ошибки runtime: **${runtimeErrorCount}**`,
            `Каналов без import checkpoint: **${channelsWithoutImportCheckpointCount}**`,
            `Need import rerun for old history: **${missingLocalHistoryUserCount}**`,
            `Mapped roles: **${mappedRoleCount}**`,
          ].join("\n"),
          inline: false,
        },
        {
          name: "Последние роли",
          value: dailyRoleSyncStats
            ? [
              fullRebuildAndRoleSyncStats
                ? `Полный rebuild+sync: ${formatDateTime(syncHistory.lastRebuildAndRoleSyncAt)}`
                : "Полный rebuild+sync: ещё не запускался.",
              rolesOnlySyncStats
                ? `Roles-only sync: ${formatDateTime(syncHistory.lastRolesOnlySyncAt)}`
                : "Roles-only sync: ещё не запускался.",
              `Последний режим: ${formatActivityRoleSyncMode(syncMode)}`,
              `Applied: **${Number(dailyRoleSyncStats.appliedCount || 0)}**, skipped: **${Number(dailyRoleSyncStats.skippedCount || 0)}**`,
              buildActivitySkipReasonPreview(dailyRoleSyncStats.skipReasonCounts),
            ].join("\n")
            : "Синхронизация ролей ещё не запускалась.",
          inline: false,
        },
        {
          name: "Следующий шаг",
          value: buildActivityPanelNextStepPreview({
            view: normalizedView,
            watchedChannelCount,
            mappedRoleCount,
            runtimeErrorCount,
            channelsWithoutImportCheckpointCount,
            missingLocalHistoryUserCount,
            openSessionCount,
            dirtyUserCount,
            lastCalibrationRun,
            dailyRoleSyncStats,
          }),
          inline: false,
        },
      ],
    }));
  }

  if (statusText) {
    embed.addFields({
      name: "Последнее действие",
      value: cleanString(statusText, 1000),
      inline: false,
    });
  }

  return {
    embeds: [embed, ...supportEmbeds],
    components: [
      buildActivityPanelNavigationRow(normalizedView),
      ...buildActivityPanelActionRows(normalizedView),
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

  const managedRolesHeld = managedRoleIds.filter((roleId) => normalizedMemberRoleIds.includes(roleId));

  if (!desiredRoleKey) {
    if (!managedRolesHeld.length) {
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

    return {
      userId: normalizedUserId,
      shouldApply: true,
      skipReason: null,
      desiredRoleKey: null,
      desiredRoleId: null,
      addRoleIds: [],
      removeRoleIds: managedRolesHeld,
    };
  }

  if (!desiredRoleId) {
    if (!managedRolesHeld.length) {
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

    return {
      userId: normalizedUserId,
      shouldApply: true,
      skipReason: null,
      desiredRoleKey,
      desiredRoleId: null,
      addRoleIds: [],
      removeRoleIds: managedRolesHeld,
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
    const targetUserIds = userIds === undefined
      ? collectActivityAssignmentTargetUserIds(db)
      : normalizeStringArray(userIds, 5000);
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
  listManagedActivityRoleUserIds,
  resolveMemberRoleIds,
  resolveMemberActivityMeta,
  applyRoleChanges,
  now,
  saveDb,
  runSerialized,
} = {}) {
  const execute = async () => {
    const syncedAt = resolveNowIso(now);
    const localActivityTargetUserIds = collectActivityHistoryTargetUserIds(db, userIds);
    const managedRoleUserIds = typeof listManagedActivityRoleUserIds === "function"
      ? await Promise.resolve(listManagedActivityRoleUserIds())
      : [];
    const normalizedManagedRoleUserIds = normalizeStringArray(managedRoleUserIds, 5000);
    const targetUserIds = [...localActivityTargetUserIds];
    const localActivityTargetUserIdSet = new Set(localActivityTargetUserIds);
    const missingLocalHistoryUserIds = normalizedManagedRoleUserIds.filter((userId) => !localActivityTargetUserIdSet.has(userId));
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
    state.runtime.lastRebuildAndRoleSyncAt = syncedAt;
    state.runtime.lastDailyRoleSyncAt = syncedAt;
    state.runtime.lastDailyRoleSyncStats = {
      targetUserCount: targetUserIds.length,
      managedRoleHolderCount: normalizedManagedRoleUserIds.length,
      localActivityTargetCount: localActivityTargetUserIds.length,
      missingLocalHistoryUserCount: missingLocalHistoryUserIds.length,
      rebuiltUserCount: rebuildResult.rebuiltUserCount,
      appliedCount: roleAssignment.appliedCount,
      skippedCount: roleAssignment.skippedCount,
      skipReasonCounts: summarizeActivitySkipReasonCounts(roleAssignment.skippedReasons),
      syncMode: "rebuild_and_sync",
    };
    state.runtime.lastRebuildAndRoleSyncStats = clone(state.runtime.lastDailyRoleSyncStats);
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

async function runActivityRoleSyncFromSnapshots({
  db = {},
  userIds,
  listManagedActivityRoleUserIds,
  resolveMemberRoleIds,
  applyRoleChanges,
  now,
  saveDb,
  runSerialized,
} = {}) {
  const execute = async () => {
    const syncedAt = resolveNowIso(now);
    const localActivityTargetUserIds = collectActivitySnapshotTargetUserIds(db, userIds);
    const managedRoleUserIds = typeof listManagedActivityRoleUserIds === "function"
      ? await Promise.resolve(listManagedActivityRoleUserIds())
      : [];
    const normalizedManagedRoleUserIds = normalizeStringArray(managedRoleUserIds, 5000);
    const targetUserIds = [...localActivityTargetUserIds];
    const localActivityTargetUserIdSet = new Set(localActivityTargetUserIds);
    const missingLocalHistoryUserIds = normalizedManagedRoleUserIds.filter((userId) => !localActivityTargetUserIdSet.has(userId));
    const roleAssignment = await applyInitialActivityRoleAssignments({
      db,
      userIds: targetUserIds,
      resolveMemberRoleIds,
      applyRoleChanges,
      now: syncedAt,
    });

    const state = ensureActivityState(db);
    state.runtime.lastRolesOnlySyncAt = syncedAt;
    state.runtime.lastDailyRoleSyncAt = syncedAt;
    state.runtime.lastDailyRoleSyncStats = {
      targetUserCount: targetUserIds.length,
      managedRoleHolderCount: normalizedManagedRoleUserIds.length,
      localActivityTargetCount: localActivityTargetUserIds.length,
      missingLocalHistoryUserCount: missingLocalHistoryUserIds.length,
      rebuiltUserCount: 0,
      appliedCount: roleAssignment.appliedCount,
      skippedCount: roleAssignment.skippedCount,
      skipReasonCounts: summarizeActivitySkipReasonCounts(roleAssignment.skippedReasons),
      syncMode: "roles_only",
    };
    state.runtime.lastRolesOnlySyncStats = clone(state.runtime.lastDailyRoleSyncStats);
    db.sot.activity = state;
    if (typeof saveDb === "function") {
      saveDb();
    }

    return {
      syncedAt,
      targetUserCount: targetUserIds.length,
      localActivityTargetCount: localActivityTargetUserIds.length,
      missingLocalHistoryUserCount: missingLocalHistoryUserIds.length,
      roleAssignment,
    };
  };

  if (typeof runSerialized === "function") {
    return runSerialized(execute, "activity-role-sync-from-snapshots");
  }
  return execute();
}

async function importHistoricalActivityFromWatchedChannels({
  db = {},
  requestedByUserId,
  fetchChannel,
  now,
  resolveMemberRoleIds,
  resolveMemberActivityMeta,
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
        resolveMemberActivityMeta,
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
  runRebuildMetrics = runDailyActivityRoleSync,
  runSyncRoles = runActivityRoleSyncFromSnapshots,
  fetchChannel,
  listManagedActivityRoleUserIds,
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
    await interaction.update(buildActivityPanelPayload({ db, statusText: "", view: ACTIVITY_PANEL_DEFAULT_VIEW }));
    return true;
  }

  const requestedView = parseActivityPanelButtonView(customId);
  if (customId.startsWith("activity_panel_view_") && requestedView) {
    await interaction.update(buildActivityPanelPayload({
      db,
      view: requestedView,
      statusText: "",
    }));
    return true;
  }

  if (customId.startsWith("activity_panel_refresh_") && requestedView) {
    await interaction.update(buildActivityPanelPayload({
      db,
      view: requestedView,
      statusText: "Панель обновлена.",
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
        view: "channels",
        statusText: `Импорт истории не выполнен: ${cleanString(error?.message || error, 500) || "unknown error"}.`,
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
      view: "channels",
      statusText,
    }));
    return true;
  }

  if (customId === "activity_panel_rebuild_metrics") {
    let result;
    try {
      result = await runRebuildMetrics({
        db,
        listManagedActivityRoleUserIds,
        resolveMemberRoleIds,
        resolveMemberActivityMeta,
        applyRoleChanges,
        saveDb,
        runSerialized,
      });
    } catch (error) {
      await interaction.editReply(buildActivityPanelPayload({
        db,
        view: "runtime",
        statusText: `Пересчёт метрик не выполнен: ${cleanString(error?.message || error, 500) || "unknown error"}.`,
      }));
      return true;
    }

    await interaction.editReply(buildActivityPanelPayload({
      db,
      view: "runtime",
      statusText: `Пересчёт метрик завершён. Пересобрано ${Number(result?.rebuiltUserCount || 0)}, роли применены ${Number(result?.roleAssignment?.appliedCount || 0)}, пропущено ${Number(result?.roleAssignment?.skippedCount || 0)}.`,
    }));
    return true;
  }

  if (customId === "activity_panel_sync_roles") {
    let result;
    try {
      result = await runSyncRoles({
        db,
        listManagedActivityRoleUserIds,
        resolveMemberRoleIds,
        applyRoleChanges,
        saveDb,
        runSerialized,
      });
    } catch (error) {
      await interaction.editReply(buildActivityPanelPayload({
        db,
        view: "roles",
        statusText: `Синхронизация ролей не выполнена: ${cleanString(error?.message || error, 500) || "unknown error"}.`,
      }));
      return true;
    }

    await interaction.editReply(buildActivityPanelPayload({
      db,
      view: "roles",
      statusText: `Синхронизация ролей завершена. Применено ${Number(result?.roleAssignment?.appliedCount || 0)}, пропущено ${Number(result?.roleAssignment?.skippedCount || 0)}. Score не пересчитывался.`,
    }));
    return true;
  }

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
  runActivityRoleSyncFromSnapshots,
  runDailyActivityRoleSync,
};