"use strict";

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const { compileDailyNewsDigest, resolveMoscowDayKey } = require("./compiler");
const { buildDailyNewsCoverAttachment } = require("./cover");
const { compileDailyNewsPreview, renderStoredDailyNewsPreview } = require("./preview");
const { publishDailyNewsIssue } = require("./publisher");
const { ensureNewsState, normalizeNewsConfig } = require("./state");

const DAILY_NEWS_OPERATOR_ACTIONS = Object.freeze({
  STATUS: "status",
  PREVIEW_TODAY: "preview_today",
  PREVIEW_DAY: "preview_day",
  RERUN_DAY: "rerun_day",
  PUBLISH_NOW: "publish_now",
  PUBLISH_DAY: "publish_day",
  PUBLISH_STAFF_ONLY: "publish_staff_only",
  PREPARE_RANGE: "prepare_range",
  START_RELEASE_QUEUE: "start_release_queue",
  STOP_RELEASE_QUEUE: "stop_release_queue",
});

const DAILY_NEWS_PANEL_OPEN_ID = "panel_open_daily_news";
const DAILY_NEWS_PANEL_REFRESH_ID = "daily_news_panel_refresh";
const DAILY_NEWS_PANEL_PREVIEW_TODAY_ID = "daily_news_panel_preview_today";
const DAILY_NEWS_PANEL_PREVIEW_DAY_ID = "daily_news_panel_preview_day";
const DAILY_NEWS_PANEL_RERUN_DAY_ID = "daily_news_panel_rerun_day";
const DAILY_NEWS_PANEL_PUBLISH_NOW_ID = "daily_news_panel_publish_now";
const DAILY_NEWS_PANEL_PUBLISH_DAY_ID = "daily_news_panel_publish_day";
const DAILY_NEWS_PANEL_PUBLISH_STAFF_ONLY_ID = "daily_news_panel_publish_staff_only";
const DAILY_NEWS_PANEL_PREPARE_RANGE_ID = "daily_news_panel_prepare_range";
const DAILY_NEWS_PANEL_START_RELEASE_QUEUE_ID = "daily_news_panel_start_release_queue";
const DAILY_NEWS_PANEL_STOP_RELEASE_QUEUE_ID = "daily_news_panel_stop_release_queue";
const DAILY_NEWS_PANEL_CONFIG_INFRA_ID = "daily_news_panel_config_infra";
const DAILY_NEWS_PANEL_BACK_ID = "daily_news_panel_back";
const DAILY_NEWS_PANEL_CONFIG_INFRA_MODAL_ID = "daily_news_panel_config_infra_modal";
const DAILY_NEWS_PANEL_PREVIEW_DAY_MODAL_ID = "daily_news_panel_preview_day_modal";
const DAILY_NEWS_PANEL_RERUN_DAY_MODAL_ID = "daily_news_panel_rerun_day_modal";
const DAILY_NEWS_PANEL_PUBLISH_DAY_MODAL_ID = "daily_news_panel_publish_day_modal";
const DAILY_NEWS_PANEL_PREPARE_RANGE_MODAL_ID = "daily_news_panel_prepare_range_modal";
const DAILY_NEWS_PANEL_DAY_KEY_INPUT_ID = "day_key";
const DAILY_NEWS_PANEL_RANGE_START_DAY_KEY_INPUT_ID = "range_start_day_key";
const DAILY_NEWS_PANEL_RANGE_END_DAY_KEY_INPUT_ID = "range_end_day_key";
const DAILY_NEWS_PANEL_ENABLED_INPUT_ID = "daily_news_enabled";
const DAILY_NEWS_PANEL_AUTO_PUBLISH_INPUT_ID = "daily_news_auto_publish";
const DAILY_NEWS_PANEL_PUBLIC_CHANNEL_INPUT_ID = "daily_news_public_channel";
const DAILY_NEWS_PANEL_STAFF_CHANNEL_INPUT_ID = "daily_news_staff_channel";
const DAILY_NEWS_PANEL_PUBLISH_HOUR_INPUT_ID = "daily_news_publish_hour_msk";

const DAILY_NEWS_PANEL_BUTTON_IDS = Object.freeze([
  DAILY_NEWS_PANEL_OPEN_ID,
  DAILY_NEWS_PANEL_REFRESH_ID,
  DAILY_NEWS_PANEL_PREVIEW_TODAY_ID,
  DAILY_NEWS_PANEL_PREVIEW_DAY_ID,
  DAILY_NEWS_PANEL_RERUN_DAY_ID,
  DAILY_NEWS_PANEL_PUBLISH_NOW_ID,
  DAILY_NEWS_PANEL_PUBLISH_DAY_ID,
  DAILY_NEWS_PANEL_PUBLISH_STAFF_ONLY_ID,
  DAILY_NEWS_PANEL_PREPARE_RANGE_ID,
  DAILY_NEWS_PANEL_START_RELEASE_QUEUE_ID,
  DAILY_NEWS_PANEL_STOP_RELEASE_QUEUE_ID,
  DAILY_NEWS_PANEL_CONFIG_INFRA_ID,
  DAILY_NEWS_PANEL_BACK_ID,
]);

const DAILY_NEWS_PANEL_MODAL_IDS = Object.freeze([
  DAILY_NEWS_PANEL_CONFIG_INFRA_MODAL_ID,
  DAILY_NEWS_PANEL_PREVIEW_DAY_MODAL_ID,
  DAILY_NEWS_PANEL_RERUN_DAY_MODAL_ID,
  DAILY_NEWS_PANEL_PUBLISH_DAY_MODAL_ID,
  DAILY_NEWS_PANEL_PREPARE_RANGE_MODAL_ID,
]);

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function normalizeHexColor(value, fallback = 0xD6A441) {
  const text = cleanString(value, 16).replace(/^#/, "");
  return /^[0-9a-fA-F]{6}$/.test(text) ? Number.parseInt(text, 16) : fallback;
}

function formatDateTime(value) {
  const timestamp = Date.parse(value || "");
  if (!Number.isFinite(timestamp)) return "—";
  return new Date(timestamp).toLocaleString("ru-RU");
}

function formatChannelMention(channelId) {
  const normalizedChannelId = cleanString(channelId, 80);
  return normalizedChannelId ? `<#${normalizedChannelId}>` : "—";
}

function normalizeDayKey(value) {
  const text = cleanString(value, 40);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function parseDayKeyTimestamp(dayKey) {
  const normalized = normalizeDayKey(dayKey);
  if (!normalized) return Number.NaN;
  return Date.parse(`${normalized}T00:00:00.000Z`);
}

function buildInclusiveDayKeyRange(startDayKey, endDayKey, limit = 62) {
  const startMs = parseDayKeyTimestamp(startDayKey);
  const endMs = parseDayKeyTimestamp(endDayKey);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    throw new Error("диапазон дней должен быть в формате YYYY-MM-DD и идти слева направо");
  }

  const maxItems = Math.max(1, Number(limit) || 1);
  const dayKeys = [];
  for (let cursor = startMs; cursor <= endMs; cursor += 24 * 60 * 60 * 1000) {
    dayKeys.push(new Date(cursor).toISOString().slice(0, 10));
    if (dayKeys.length > maxItems) {
      throw new Error(`диапазон слишком большой: максимум ${maxItems} дней за один запуск`);
    }
  }
  return dayKeys;
}

function resolveNowIso(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date().toISOString();
}

function normalizeModalValue(value, fallback = "", limit = 4000) {
  const text = cleanString(value, limit);
  return text || cleanString(fallback, limit);
}

function parseRequestedChannelId(value, fallbackChannelId = "") {
  const text = cleanString(value, 120);
  if (!text) return cleanString(fallbackChannelId, 80);

  const mentionMatch = text.match(/^<#(\d+)>$/);
  const candidate = mentionMatch ? mentionMatch[1] : text.replace(/\s+/g, "");
  return /^\d{5,25}$/.test(candidate) ? candidate : "";
}

function parseBooleanInput(value, fallback = null) {
  const text = cleanString(value, 40).toLowerCase();
  if (!text) return fallback;
  if (["1", "true", "yes", "y", "on", "да", "д"].includes(text)) return true;
  if (["0", "false", "no", "n", "off", "нет", "н"].includes(text)) return false;
  return null;
}

function parsePublishHourInput(value, fallback = 21) {
  const text = cleanString(value, 40);
  if (!text) return Number.isSafeInteger(Number(fallback)) ? Number(fallback) : 21;
  const hour = Number.parseInt(text, 10);
  if (!Number.isSafeInteger(hour) || hour < 0 || hour > 23) return null;
  return hour;
}

function withEphemeralFlag(payload, includeFlags = true) {
  if (!includeFlags) return payload;
  if (payload && typeof payload === "object" && !Array.isArray(payload) && Object.prototype.hasOwnProperty.call(payload, "flags")) {
    return payload;
  }
  return {
    ...(payload && typeof payload === "object" && !Array.isArray(payload) ? payload : { content: cleanString(payload, 2000) || "Готово." }),
    flags: MessageFlags.Ephemeral,
  };
}

function normalizeReplyPayload(payload, includeFlags = true) {
  if (typeof payload === "string") {
    return withEphemeralFlag({ content: cleanString(payload, 2000) || "Готово.", embeds: [], components: [] }, includeFlags);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return withEphemeralFlag({ content: cleanString(payload, 2000) || "Готово.", embeds: [], components: [] }, includeFlags);
  }
  return withEphemeralFlag(payload, includeFlags);
}

function normalizeEditPayload(payload) {
  if (typeof payload === "string") {
    return { content: cleanString(payload, 2000) || "Готово.", embeds: [], components: [] };
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { content: cleanString(payload, 2000) || "Готово.", embeds: [], components: [] };
  }
  const next = { ...payload };
  delete next.flags;
  return next;
}

function prefixPayload(payload, header = "") {
  const next = payload && typeof payload === "object" && !Array.isArray(payload)
    ? { ...payload }
    : { content: cleanString(payload, 2000) || "Готово." };
  const prefix = cleanString(header, 300);
  if (!prefix) return next;
  next.content = next.content ? `${prefix}\n\n${next.content}` : prefix;
  return next;
}

function formatPreviewRequest(lastPreviewRequest = null) {
  if (!lastPreviewRequest || typeof lastPreviewRequest !== "object") {
    return "—";
  }
  const dayKey = cleanString(lastPreviewRequest.dayKey, 40) || "—";
  const requestedAt = formatDateTime(lastPreviewRequest.requestedAt);
  const threadMessageCount = Number(lastPreviewRequest.publicThreadMessageCount) || 0;
  return `${dayKey} · ${requestedAt} · thread ${threadMessageCount}`;
}

function formatCompileStatusLabel(status) {
  switch (cleanString(status, 80)) {
    case "shadow_compiled":
      return "shadow compile (без публикации)";
    case "compiled":
      return "готово для preview";
    case "running":
      return "идёт сборка";
    case "failed":
      return "ошибка сборки";
    default:
      return "не запускалась";
  }
}

function formatPublishStatusLabel(status) {
  switch (cleanString(status, 80)) {
    case "staff_published":
      return "отправлено только в staff";
    case "published":
      return "опубликовано";
    case "running":
      return "идёт публикация";
    case "failed":
      return "ошибка публикации";
    default:
      return "не опубликовано";
  }
}

function formatPublishModeLabel(mode) {
  switch (cleanString(mode, 40)) {
    case "staff_only":
      return "только staff";
    case "public":
      return "публичный выпуск";
    default:
      return "—";
  }
}

function collectDailyNewsAutoPublishBlockers(config = {}) {
  if (config?.publish?.autoPublishEnabled !== true) {
    return [];
  }

  const blockers = [];
  if (config?.enabled !== true) {
    blockers.push("включённый Shadow compile tick");
  }
  if (!cleanString(config?.channels?.publicChannelId, 80)) {
    blockers.push("привязанный Public channel");
  }
  return blockers;
}

function formatReleaseModeLabel(config = {}) {
  if (config?.publish?.autoPublishEnabled !== true) {
    return "ручной";
  }
  return collectDailyNewsAutoPublishBlockers(config).length ? "автовыпуск заблокирован" : "автовыпуск";
}

function formatReleaseModeSummary(config = {}) {
  if (config?.publish?.autoPublishEnabled !== true) {
    return "Scheduler делает только shadow compile; live-выпуск запускается вручную кнопками публикации.";
  }

  const blockers = collectDailyNewsAutoPublishBlockers(config);
  if (blockers.length) {
    return `Автовыпуск заблокирован: нужен ${blockers.join(", ")}.`;
  }

  return "Scheduler делает shadow compile и может автоматически отправлять публичный выпуск после cutoff.";
}

function formatReleaseQueueState(queue = {}) {
  return queue?.active ? "запущена" : "на паузе";
}

function formatReleaseQueueSummary(queue = {}) {
  const dayKeys = Array.isArray(queue?.dayKeys) ? queue.dayKeys : [];
  const nextDayKey = cleanString(dayKeys[0], 40);
  return [
    `Публикация периода: **${formatReleaseQueueState(queue)}**`,
    `дней **${dayKeys.length}**`,
    nextDayKey ? `следующий **${nextDayKey}**` : null,
  ].filter(Boolean).join(" · ");
}

async function prepareDailyNewsReleaseRange({
  db = {},
  startDayKey = "",
  endDayKey = "",
  now,
  saveDb,
  compileDailyNewsDigestFn = compileDailyNewsDigest,
} = {}) {
  const normalizedStartDayKey = normalizeDayKey(startDayKey);
  const normalizedEndDayKey = normalizeDayKey(endDayKey);
  if (!normalizedStartDayKey || !normalizedEndDayKey) {
    throw new Error("даты диапазона должны быть в формате YYYY-MM-DD");
  }

  const todayDayKey = normalizeDayKey(resolveMoscowDayKey(now));
  if ((normalizedStartDayKey > todayDayKey) || (normalizedEndDayKey > todayDayKey)) {
    throw new Error("можно подготавливать только текущий или прошлые дни");
  }

  const dayKeys = buildInclusiveDayKeyRange(normalizedStartDayKey, normalizedEndDayKey, 62);
  for (const dayKey of dayKeys) {
    await Promise.resolve(compileDailyNewsDigestFn({
      db,
      targetDayKey: dayKey,
      now,
    }));
  }

  const state = ensureNewsState(db);
  state.runtime.releaseQueue = {
    ...state.runtime.releaseQueue,
    active: false,
    dayKeys,
    lastPreparedAt: resolveNowIso(now),
    lastPreparedRangeStartDayKey: dayKeys[0] || null,
    lastPreparedRangeEndDayKey: dayKeys[dayKeys.length - 1] || null,
  };

  if (typeof saveDb === "function") {
    await Promise.resolve(saveDb());
  }

  return { dayKeys, queue: state.runtime.releaseQueue };
}

async function setDailyNewsReleaseQueueActive({ db = {}, active = false, now, saveDb } = {}) {
  const state = ensureNewsState(db);
  const queue = state.runtime.releaseQueue;
  const hasQueuedDays = Array.isArray(queue?.dayKeys) && queue.dayKeys.length > 0;
  if (active && !hasQueuedDays) {
    throw new Error("историческая очередь пуста: сначала подготовьте диапазон дней");
  }

  state.runtime.releaseQueue = {
    ...queue,
    active: active === true,
    lastPreparedAt: queue?.lastPreparedAt || resolveNowIso(now),
  };

  if (typeof saveDb === "function") {
    await Promise.resolve(saveDb());
  }

  return state.runtime.releaseQueue;
}

function buildDailyNewsPanelRows(state = {}) {
  const publicChannelId = cleanString(state.config?.channels?.publicChannelId, 80);
  const staffChannelId = cleanString(state.config?.channels?.staffChannelId, 80);
  const queue = state.runtime?.releaseQueue || {};
  const queueHasItems = Array.isArray(queue.dayKeys) && queue.dayKeys.length > 0;
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(DAILY_NEWS_PANEL_REFRESH_ID).setLabel("Обзор").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(DAILY_NEWS_PANEL_PREVIEW_TODAY_ID).setLabel("Превью сегодня").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(DAILY_NEWS_PANEL_PREVIEW_DAY_ID).setLabel("Превью день").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(DAILY_NEWS_PANEL_RERUN_DAY_ID).setLabel("Пересобрать день").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(DAILY_NEWS_PANEL_PUBLISH_NOW_ID)
        .setLabel("Опубликовать сегодня")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!publicChannelId)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(DAILY_NEWS_PANEL_PUBLISH_DAY_ID)
        .setLabel("Опубликовать день")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!publicChannelId),
      new ButtonBuilder()
        .setCustomId(DAILY_NEWS_PANEL_PUBLISH_STAFF_ONLY_ID)
        .setLabel("Smoke только в staff")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!staffChannelId),
      new ButtonBuilder().setCustomId(DAILY_NEWS_PANEL_PREPARE_RANGE_ID).setLabel("Подготовить период").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(DAILY_NEWS_PANEL_START_RELEASE_QUEUE_ID)
        .setLabel("Запустить период")
        .setStyle(ButtonStyle.Success)
        .setDisabled(!publicChannelId || !queueHasItems),
      new ButtonBuilder()
        .setCustomId(DAILY_NEWS_PANEL_STOP_RELEASE_QUEUE_ID)
        .setLabel("Остановить период")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(queue?.active !== true)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(DAILY_NEWS_PANEL_CONFIG_INFRA_ID).setLabel("Настроить").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(DAILY_NEWS_PANEL_BACK_ID).setLabel("Назад").setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function buildDailyNewsStatusPayload(db = {}) {
  const state = ensureNewsState(db);
  const coverage = state.runtime.lastCoverageSummary || {};
  const audit = state.runtime.lastAuditCounts || {};
  const queue = state.runtime.releaseQueue || {};
  return {
    content: [
      "## 🗞️ Статус Daily News",
      `сборка: **${formatCompileStatusLabel(state.runtime.lastCompileStatus)}** · день **${state.runtime.lastCompiledDayKey || "—"}**`,
      `публикация: **${formatPublishStatusLabel(state.runtime.lastPublishStatus)}** · день **${state.runtime.lastPublishedDayKey || "—"}**`,
      `период: **${formatReleaseQueueState(queue)}** · дней **${Array.isArray(queue.dayKeys) ? queue.dayKeys.length : 0}**${queue.dayKeys?.[0] ? ` · следующий **${queue.dayKeys[0]}**` : ""}`,
      `покрытие: **${coverage.partial ? "частичное" : "чистое"}${coverage.ambiguous ? " + неоднозначное" : ""}**`,
      `кандидаты: **${audit.rawCandidateCounts?.total || 0}**`,
      state.runtime.lastFailure?.message ? `последний сбой: **${state.runtime.lastFailure.message}**` : "последний сбой: **—**",
    ].join("\n"),
    allowedMentions: { parse: [] },
  };
}

function buildDailyNewsOperatorPanelPayload({ db = {}, statusText = "", includeFlags = true } = {}) {
  const state = ensureNewsState(db);
  const coverage = state.runtime.lastCoverageSummary || {};
  const audit = state.runtime.lastAuditCounts || {};
  const publishResult = state.runtime.lastPublishResult || {};
  const publishWarnings = Array.isArray(publishResult.warnings) ? publishResult.warnings : [];
  const queue = state.runtime.releaseQueue || {};

  const embed = new EmbedBuilder()
    .setColor(normalizeHexColor(state.config?.presentation?.accentColor, 0xD6A441))
    .setTitle("Оператор Daily News")
    .setDescription([
      `Мастхед: **${cleanString(state.config?.presentation?.masthead, 120) || "Daily Edition"}**`,
      `Ежедневный тик: **${state.config?.enabled ? "включён" : "выключен"}** · ${Number(state.config?.schedule?.publishHourMsk) || 21}:00 МСК`,
      `Режим выпуска: **${formatReleaseModeLabel(state.config)}**`,
      `Публичный канал: ${formatChannelMention(state.config?.channels?.publicChannelId)}`,
      `Staff канал: ${formatChannelMention(state.config?.channels?.staffChannelId)}`,
      formatReleaseQueueSummary(queue),
      formatReleaseModeSummary(state.config),
    ].join("\n"))
    .addFields(
      {
        name: "Сборка",
        value: [
          `Статус: **${formatCompileStatusLabel(state.runtime.lastCompileStatus)}**`,
          `Day: **${cleanString(state.runtime.lastCompiledDayKey, 40) || "—"}**`,
          `Финиш: **${formatDateTime(state.runtime.lastCompileFinishedAt)}**`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "Публикация",
        value: [
          `Статус: **${formatPublishStatusLabel(state.runtime.lastPublishStatus)}**`,
          `Day: **${cleanString(state.runtime.lastPublishedDayKey, 40) || "—"}**`,
          `Финиш: **${formatDateTime(state.runtime.lastPublishFinishedAt)}**`,
          `Режим: **${formatPublishModeLabel(publishResult.publishMode)}**`,
          `Сообщение: **${cleanString(publishResult.deliveryMessageId, 80) || "—"}**`,
          `Аудит: **${cleanString(publishResult.staffMessageId, 80) || "—"}**`,
          `Предупреждения: **${Number(publishResult.warningCount) || 0}**`,
          publishWarnings.length ? `Последнее предупреждение: ${cleanString(publishWarnings[0], 220)}` : null,
        ].join("\n"),
        inline: true,
      },
      {
        name: "Покрытие / аудит",
        value: [
          `Coverage: **${coverage.partial ? "partial" : "clean"}${coverage.ambiguous ? " + ambiguous" : ""}**`,
          `Кандидаты: **${audit.rawCandidateCounts?.total || 0}**`,
          `Последнее превью: **${formatPreviewRequest(state.runtime.lastPreviewRequest)}**`,
        ].join("\n"),
        inline: false,
      }
    );

  if (state.runtime.lastFailure?.message) {
    embed.addFields({
      name: "Последний failure",
      value: [
        `Stage: **${cleanString(state.runtime.lastFailure.stage, 80) || "—"}**`,
        `Day: **${cleanString(state.runtime.lastFailure.dayKey, 40) || "—"}**`,
        cleanString(state.runtime.lastFailure.message, 900) || "—",
      ].join("\n"),
      inline: false,
    });
  }

  if (statusText) {
    embed.addFields({
      name: "Последнее действие",
      value: cleanString(statusText, 1000) || "—",
      inline: false,
    });
  }

  return normalizeReplyPayload({
    embeds: [embed],
    components: buildDailyNewsPanelRows(state),
  }, includeFlags);
}

function buildDailyNewsInfraConfigModal(config = {}) {
  return new ModalBuilder()
    .setCustomId(DAILY_NEWS_PANEL_CONFIG_INFRA_MODAL_ID)
    .setTitle("Настройки Daily News")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(DAILY_NEWS_PANEL_ENABLED_INPUT_ID)
          .setLabel("Shadow compile включён? (да/нет)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(10)
          .setValue(config.enabled === true ? "да" : "нет")
          .setPlaceholder("да")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(DAILY_NEWS_PANEL_AUTO_PUBLISH_INPUT_ID)
          .setLabel("Автопубликация включена? (да/нет)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(10)
          .setValue(config.publish?.autoPublishEnabled === true ? "да" : "нет")
          .setPlaceholder("нет")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(DAILY_NEWS_PANEL_PUBLIC_CHANNEL_INPUT_ID)
          .setLabel("Публичный канал: ID, mention или имя")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(120)
          .setValue(normalizeModalValue(config.channels?.publicChannelId, ""))
          .setPlaceholder("например, <#123...>")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(DAILY_NEWS_PANEL_STAFF_CHANNEL_INPUT_ID)
          .setLabel("Staff канал: ID, mention или имя")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(120)
          .setValue(normalizeModalValue(config.channels?.staffChannelId, ""))
          .setPlaceholder("например, <#123...>")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(DAILY_NEWS_PANEL_PUBLISH_HOUR_INPUT_ID)
          .setLabel("Час публикации по МСК (0-23)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(2)
          .setValue(String(Number(config.schedule?.publishHourMsk) || 21))
          .setPlaceholder("21")
      )
    );
}

function buildDayKeyModal(action = DAILY_NEWS_OPERATOR_ACTIONS.PREVIEW_DAY) {
  const isRerun = action === DAILY_NEWS_OPERATOR_ACTIONS.RERUN_DAY;
  const isPublishDay = action === DAILY_NEWS_OPERATOR_ACTIONS.PUBLISH_DAY;
  return new ModalBuilder()
    .setCustomId(
      isRerun
        ? DAILY_NEWS_PANEL_RERUN_DAY_MODAL_ID
        : isPublishDay
          ? DAILY_NEWS_PANEL_PUBLISH_DAY_MODAL_ID
          : DAILY_NEWS_PANEL_PREVIEW_DAY_MODAL_ID
    )
    .setTitle(
      isRerun
        ? "Пересобрать день Daily News"
        : isPublishDay
          ? "Опубликовать день Daily News"
          : "Превью дня Daily News"
    )
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(DAILY_NEWS_PANEL_DAY_KEY_INPUT_ID)
          .setLabel("Дата выпуска")
          .setPlaceholder("2026-05-14")
          .setRequired(true)
          .setMinLength(10)
          .setMaxLength(10)
          .setStyle(TextInputStyle.Short)
      )
    );
}

function buildPrepareRangeModal() {
  return new ModalBuilder()
    .setCustomId(DAILY_NEWS_PANEL_PREPARE_RANGE_MODAL_ID)
    .setTitle("Подготовить период Daily News")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(DAILY_NEWS_PANEL_RANGE_START_DAY_KEY_INPUT_ID)
          .setLabel("Дата начала")
          .setPlaceholder("2026-05-20")
          .setRequired(true)
          .setMinLength(10)
          .setMaxLength(10)
          .setStyle(TextInputStyle.Short)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(DAILY_NEWS_PANEL_RANGE_END_DAY_KEY_INPUT_ID)
          .setLabel("Дата конца")
          .setPlaceholder("2026-05-27")
          .setRequired(true)
          .setMinLength(10)
          .setMaxLength(10)
          .setStyle(TextInputStyle.Short)
      )
    );
}

async function replyDailyNewsOperatorError(interaction, replyError, message) {
  const payload = normalizeReplyPayload({
    content: cleanString(message, 500) || "Не удалось обработать действие Daily News.",
  }, true);

  if (typeof replyError === "function") {
    await replyError(interaction, payload);
    return;
  }

  if (interaction?.deferred && typeof interaction.editReply === "function") {
    await interaction.editReply(normalizeEditPayload(payload)).catch(() => {});
    return;
  }

  if (interaction?.replied && typeof interaction.followUp === "function") {
    await interaction.followUp(payload).catch(() => {});
    return;
  }

  if (typeof interaction?.reply === "function") {
    await interaction.reply(payload).catch(() => {});
  }
}

async function sendDailyNewsPreviewMessages(interaction, issue, firstMethod = "followUp") {
  const queue = [];
  queue.push(prefixPayload(issue.publicMessage, `## 🗞️ Preview · public issue · ${issue.dayKey}`));

  try {
    const coverAttachment = await buildDailyNewsCoverAttachment(issue);
    queue.push({
      content: `## 🖼️ Preview · cover · ${issue.dayKey}`,
      files: [coverAttachment],
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    queue.push({
      content: `## 🖼️ Preview · cover · ${issue.dayKey}\n\ncover render failed: ${cleanString(error?.message || error, 300) || "unknown error"}`,
      allowedMentions: { parse: [] },
    });
  }

  for (let index = 0; index < issue.publicThreadMessages.length; index += 1) {
    queue.push(prefixPayload(
      issue.publicThreadMessages[index],
      `## 🧵 Preview thread ${index + 1}/${issue.publicThreadMessages.length} · ${issue.dayKey}`
    ));
  }

  queue.push(prefixPayload(issue.staffMessage, `## 🛠️ Preview · staff digest · ${issue.dayKey}`));

  for (let index = 0; index < queue.length; index += 1) {
    const payload = queue[index];
    if (index === 0 && firstMethod === "reply" && typeof interaction?.reply === "function") {
      await interaction.reply(normalizeReplyPayload(payload, true));
      continue;
    }
    if (index === 0 && firstMethod === "editReply" && typeof interaction?.editReply === "function") {
      await interaction.editReply(normalizeEditPayload(payload));
      continue;
    }
    if (typeof interaction?.followUp === "function") {
      await interaction.followUp(normalizeReplyPayload(payload, true));
    }
  }
}

async function runDailyNewsOperatorInteractionAction({
  interaction,
  replyError,
  customId,
  errorPrefix,
  action,
}) {
  try {
    await action();
    return true;
  } catch (error) {
    console.error(`Daily News operator interaction failed (${customId}):`, error?.message || error);
    await replyDailyNewsOperatorError(
      interaction,
      replyError,
      `${errorPrefix}: ${cleanString(error?.message || error, 300) || "unknown error"}.`
    );
    return true;
  }
}

async function runDailyNewsOperatorAction({
  db = {},
  action = DAILY_NEWS_OPERATOR_ACTIONS.STATUS,
  dayKey = "",
  now,
  windowEndAt = null,
  client = null,
  publicChannel = null,
  staffChannel = null,
  force = false,
  saveDb,
} = {}) {
  const normalizedAction = cleanString(action, 80) || DAILY_NEWS_OPERATOR_ACTIONS.STATUS;

  if (normalizedAction === DAILY_NEWS_OPERATOR_ACTIONS.STATUS) {
    return { action: normalizedAction, payload: buildDailyNewsStatusPayload(db) };
  }

  if (normalizedAction === DAILY_NEWS_OPERATOR_ACTIONS.PREVIEW_TODAY || normalizedAction === DAILY_NEWS_OPERATOR_ACTIONS.PREVIEW_DAY || normalizedAction === DAILY_NEWS_OPERATOR_ACTIONS.RERUN_DAY) {
    let result = null;
    if (normalizedAction === DAILY_NEWS_OPERATOR_ACTIONS.RERUN_DAY) {
      try {
        result = renderStoredDailyNewsPreview({ db, dayKey, now, saveDb });
      } catch (error) {
        if (cleanString(error?.message, 200) !== "daily news digest not found for preview") {
          throw error;
        }
      }
    }
    if (!result) {
      result = compileDailyNewsPreview({ db, targetDayKey: dayKey, now, windowEndAt, saveDb });
    }
    return {
      action: normalizedAction,
      dayKey: result.dayKey,
      digest: result.digest,
      issue: result.issue,
      payload: result.issue.publicMessage,
      staffPayload: result.issue.staffMessage,
    };
  }

  if (normalizedAction === DAILY_NEWS_OPERATOR_ACTIONS.PUBLISH_NOW || normalizedAction === DAILY_NEWS_OPERATOR_ACTIONS.PUBLISH_STAFF_ONLY) {
    const state = ensureNewsState(db);
    const normalizedRequestedDayKey = normalizeDayKey(dayKey);
    const existingPublicPublish = normalizedRequestedDayKey
      ? state.dailyDigests?.[normalizedRequestedDayKey]?.publish
      : null;
    const preview = compileDailyNewsPreview({
      db,
      targetDayKey: dayKey,
      now,
      windowEndAt,
      saveDb,
      historySnapshotMode: "capture_if_current_day",
    });
    const republished = normalizedAction !== DAILY_NEWS_OPERATOR_ACTIONS.PUBLISH_STAFF_ONLY
      && (
        (state.runtime.lastPublishStatus === "published" && cleanString(state.runtime.lastPublishedDayKey, 40) === preview.dayKey)
        || cleanString(existingPublicPublish?.publishMode, 40) === "public"
      );
    const publish = await publishDailyNewsIssue({
      db,
      digest: preview.digest,
      issue: preview.issue,
      client,
      publicChannel,
      staffChannel,
      publishMode: normalizedAction === DAILY_NEWS_OPERATOR_ACTIONS.PUBLISH_STAFF_ONLY ? "staff_only" : "public",
      force: normalizedAction === DAILY_NEWS_OPERATOR_ACTIONS.PUBLISH_STAFF_ONLY ? force === true : true,
      now,
      saveDb,
    });
    return {
      action: normalizedAction,
      dayKey: preview.dayKey,
      digest: preview.digest,
      issue: preview.issue,
      publish,
      republished,
      payload: buildDailyNewsStatusPayload(db),
    };
  }

  if (normalizedAction === DAILY_NEWS_OPERATOR_ACTIONS.PUBLISH_DAY) {
    return runDailyNewsOperatorAction({
      db,
      action: DAILY_NEWS_OPERATOR_ACTIONS.PUBLISH_NOW,
      dayKey,
      now,
      windowEndAt,
      client,
      publicChannel,
      staffChannel,
      force: true,
      saveDb,
    });
  }

  throw new Error(`unknown Daily News operator action: ${normalizedAction}`);
}

async function handleDailyNewsPanelButtonInteraction(options = {}) {
  const interaction = options.interaction;
  const customId = cleanString(interaction?.customId, 120);
  if (!DAILY_NEWS_PANEL_BUTTON_IDS.includes(customId)) {
    return false;
  }

  if (typeof options.isModerator !== "function") {
    throw new TypeError("isModerator must be a function");
  }
  if (typeof options.replyNoPermission !== "function") {
    throw new TypeError("replyNoPermission must be a function");
  }

  if (!options.isModerator(interaction?.member)) {
    await options.replyNoPermission(interaction);
    return true;
  }

  if (customId === DAILY_NEWS_PANEL_OPEN_ID || customId === DAILY_NEWS_PANEL_REFRESH_ID) {
    return runDailyNewsOperatorInteractionAction({
      interaction,
      replyError: options.replyError,
      customId,
      errorPrefix: "Не удалось открыть панель Daily News",
      action: async () => {
        await interaction.update(buildDailyNewsOperatorPanelPayload({
          db: options.db,
          statusText: customId === DAILY_NEWS_PANEL_REFRESH_ID ? "Daily News panel обновлена." : "",
          includeFlags: false,
        }));
      },
    });
  }

  if (customId === DAILY_NEWS_PANEL_BACK_ID) {
    return runDailyNewsOperatorInteractionAction({
      interaction,
      replyError: options.replyError,
      customId,
      errorPrefix: "Не удалось вернуть onboarding panel",
      action: async () => {
        if (typeof options.buildBackPayload !== "function") {
          throw new TypeError("buildBackPayload must be a function");
        }
        await interaction.update(await options.buildBackPayload());
      },
    });
  }

  if (customId === DAILY_NEWS_PANEL_CONFIG_INFRA_ID) {
    return runDailyNewsOperatorInteractionAction({
      interaction,
      replyError: options.replyError,
      customId,
      errorPrefix: "Не удалось открыть настройки Daily News",
      action: async () => {
        await interaction.showModal(buildDailyNewsInfraConfigModal(ensureNewsState(options.db).config || {}));
      },
    });
  }

  if (customId === DAILY_NEWS_PANEL_PREVIEW_DAY_ID || customId === DAILY_NEWS_PANEL_RERUN_DAY_ID || customId === DAILY_NEWS_PANEL_PUBLISH_DAY_ID) {
    return runDailyNewsOperatorInteractionAction({
      interaction,
      replyError: options.replyError,
      customId,
      errorPrefix: "Не удалось открыть форму Daily News",
      action: async () => {
        await interaction.showModal(buildDayKeyModal(
          customId === DAILY_NEWS_PANEL_RERUN_DAY_ID
            ? DAILY_NEWS_OPERATOR_ACTIONS.RERUN_DAY
            : customId === DAILY_NEWS_PANEL_PUBLISH_DAY_ID
              ? DAILY_NEWS_OPERATOR_ACTIONS.PUBLISH_DAY
              : DAILY_NEWS_OPERATOR_ACTIONS.PREVIEW_DAY
        ));
      },
    });
  }

  if (customId === DAILY_NEWS_PANEL_PREPARE_RANGE_ID) {
    return runDailyNewsOperatorInteractionAction({
      interaction,
      replyError: options.replyError,
      customId,
      errorPrefix: "Не удалось открыть форму диапазона Daily News",
      action: async () => {
        await interaction.showModal(buildPrepareRangeModal());
      },
    });
  }

  if (customId === DAILY_NEWS_PANEL_PREVIEW_TODAY_ID) {
    return runDailyNewsOperatorInteractionAction({
      interaction,
      replyError: options.replyError,
      customId,
      errorPrefix: "Не удалось собрать preview Daily News",
      action: async () => {
        await interaction.deferUpdate();
        const result = await runDailyNewsOperatorAction({
          db: options.db,
          action: DAILY_NEWS_OPERATOR_ACTIONS.PREVIEW_TODAY,
          now: options.now,
          saveDb: options.saveDb,
        });
        await sendDailyNewsPreviewMessages(interaction, result.issue, "followUp");
        await interaction.editReply(buildDailyNewsOperatorPanelPayload({
          db: options.db,
          statusText: `Превью собрано для **${result.dayKey}**. Public/staff payloads отправлены эпhemeral-сообщениями.`,
          includeFlags: false,
        }));
      },
    });
  }

  if (customId === DAILY_NEWS_PANEL_PUBLISH_NOW_ID || customId === DAILY_NEWS_PANEL_PUBLISH_STAFF_ONLY_ID) {
    return runDailyNewsOperatorInteractionAction({
      interaction,
      replyError: options.replyError,
      customId,
      errorPrefix: "Не удалось опубликовать Daily News",
      action: async () => {
        await interaction.deferUpdate();
        const result = await runDailyNewsOperatorAction({
          db: options.db,
          action: customId === DAILY_NEWS_PANEL_PUBLISH_STAFF_ONLY_ID
            ? DAILY_NEWS_OPERATOR_ACTIONS.PUBLISH_STAFF_ONLY
            : DAILY_NEWS_OPERATOR_ACTIONS.PUBLISH_NOW,
          now: options.now,
          client: options.client,
          publicChannel: options.publicChannel,
          staffChannel: options.staffChannel,
          force: options.force === true,
          saveDb: options.saveDb,
        });
        const statusText = result.publish?.skipped
          ? `Публикация пропущена: **${cleanString(result.publish.reason, 80) || "already_published"}**.`
          : result.publish?.result?.publishMode === "staff_only"
            ? `Staff-only smoke для **${result.dayKey}** отправлен. Smoke message: **${cleanString(result.publish?.result?.deliveryMessageId, 80) || "—"}** · audit: **${cleanString(result.publish?.result?.staffMessageId, 80) || "—"}**.`
            : result.republished
              ? `Выпуск **${result.dayKey}** опубликован повторно. Public message: **${cleanString(result.publish?.result?.publicMessageId, 80) || "—"}**.`
              : `Выпуск **${result.dayKey}** опубликован. Public message: **${cleanString(result.publish?.result?.publicMessageId, 80) || "—"}**.`;
        await interaction.editReply(buildDailyNewsOperatorPanelPayload({
          db: options.db,
          statusText,
          includeFlags: false,
        }));
      },
    });
  }

  if (customId === DAILY_NEWS_PANEL_START_RELEASE_QUEUE_ID || customId === DAILY_NEWS_PANEL_STOP_RELEASE_QUEUE_ID) {
    return runDailyNewsOperatorInteractionAction({
      interaction,
      replyError: options.replyError,
      customId,
      errorPrefix: "Не удалось обновить очередь Daily News",
      action: async () => {
        await interaction.deferUpdate();
        const queue = await setDailyNewsReleaseQueueActive({
          db: options.db,
          active: customId === DAILY_NEWS_PANEL_START_RELEASE_QUEUE_ID,
          now: options.now,
          saveDb: options.saveDb,
        });
        await interaction.editReply(buildDailyNewsOperatorPanelPayload({
          db: options.db,
          statusText: customId === DAILY_NEWS_PANEL_START_RELEASE_QUEUE_ID
            ? `Публикация периода запущена. Следующий выпуск: **${cleanString(queue.dayKeys?.[0], 40) || "—"}**.`
            : "Публикация периода остановлена.",
          includeFlags: false,
        }));
      },
    });
  }

  return true;
}

async function handleDailyNewsPanelModalSubmitInteraction(options = {}) {
  const interaction = options.interaction;
  const customId = cleanString(interaction?.customId, 120);
  if (!DAILY_NEWS_PANEL_MODAL_IDS.includes(customId)) {
    return false;
  }

  if (typeof options.isModerator !== "function") {
    throw new TypeError("isModerator must be a function");
  }
  if (typeof options.replyNoPermission !== "function") {
    throw new TypeError("replyNoPermission must be a function");
  }

  if (!options.isModerator(interaction?.member)) {
    await options.replyNoPermission(interaction);
    return true;
  }

  if (customId === DAILY_NEWS_PANEL_CONFIG_INFRA_MODAL_ID) {
    return runDailyNewsOperatorInteractionAction({
      interaction,
      replyError: options.replyError,
      customId,
      errorPrefix: "Не удалось сохранить настройки Daily News",
      action: async () => {
        if (typeof interaction.deferReply === "function") {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        }

        const state = ensureNewsState(options.db);
        const enabledRaw = interaction.fields.getTextInputValue(DAILY_NEWS_PANEL_ENABLED_INPUT_ID);
        const autoPublishRaw = interaction.fields.getTextInputValue(DAILY_NEWS_PANEL_AUTO_PUBLISH_INPUT_ID);
        const publicChannelRaw = interaction.fields.getTextInputValue(DAILY_NEWS_PANEL_PUBLIC_CHANNEL_INPUT_ID);
        const staffChannelRaw = interaction.fields.getTextInputValue(DAILY_NEWS_PANEL_STAFF_CHANNEL_INPUT_ID);
        const publishHourRaw = interaction.fields.getTextInputValue(DAILY_NEWS_PANEL_PUBLISH_HOUR_INPUT_ID);

        const enabled = parseBooleanInput(enabledRaw, state.config?.enabled === true);
        const autoPublishEnabled = parseBooleanInput(autoPublishRaw, state.config?.publish?.autoPublishEnabled === true);
        if (enabled === null) {
          await interaction.editReply({ content: "Shadow compile должно быть yes/no, true/false или да/нет." });
          return;
        }
        if (autoPublishEnabled === null) {
          await interaction.editReply({ content: "Автопубликация должна быть yes/no, true/false или да/нет." });
          return;
        }

        const resolveRequestedChannelId = typeof options.resolveRequestedChannelId === "function"
          ? options.resolveRequestedChannelId
          : async (value, fallbackChannelId = "") => {
            if (typeof options.parseRequestedChannelId === "function") {
              return options.parseRequestedChannelId(value, fallbackChannelId);
            }
            return parseRequestedChannelId(value, fallbackChannelId);
          };

        const publicChannelId = await Promise.resolve(resolveRequestedChannelId(publicChannelRaw, ""));
        const staffChannelId = await Promise.resolve(resolveRequestedChannelId(staffChannelRaw, ""));
        if (cleanString(publicChannelRaw, 120) && !publicChannelId) {
          await interaction.editReply({ content: "Public канал должен быть Channel ID, <#...> или точным именем канала." });
          return;
        }
        if (cleanString(staffChannelRaw, 120) && !staffChannelId) {
          await interaction.editReply({ content: "Staff канал должен быть Channel ID, <#...> или точным именем канала." });
          return;
        }

        const publishHourMsk = parsePublishHourInput(publishHourRaw, state.config?.schedule?.publishHourMsk);
        if (publishHourMsk === null) {
          await interaction.editReply({ content: "Publish hour МСК должен быть числом от 0 до 23." });
          return;
        }

        const nextConfig = normalizeNewsConfig({
          ...state.config,
          enabled,
          publish: {
            ...state.config?.publish,
            autoPublishEnabled,
          },
          schedule: {
            ...state.config?.schedule,
            publishHourMsk,
          },
          channels: {
            ...state.config?.channels,
            publicChannelId,
            staffChannelId,
          },
        });

        const autoPublishBlockers = collectDailyNewsAutoPublishBlockers(nextConfig);
        if (autoPublishBlockers.length) {
          await interaction.editReply({ content: `Автопубликация требует: ${autoPublishBlockers.join(", ")}.` });
          return;
        }

        state.config = nextConfig;

        if (typeof options.saveDb === "function") {
          options.saveDb();
        }

        const savedTargets = [];
        if (publicChannelId) savedTargets.push(`public ${formatChannelMention(publicChannelId)}`);
        if (staffChannelId) savedTargets.push(`staff ${formatChannelMention(staffChannelId)}`);
        const statusText = [
          `Настройки Daily News сохранены. Tick: **${enabled ? "включён" : "выключен"}**.`,
          `Режим выпуска: **${formatReleaseModeLabel(state.config)}**.`,
          `Publish hour: **${publishHourMsk}:00 МСК**.`,
          savedTargets.length ? `Каналы: ${savedTargets.join(" · ")}.` : "Каналы не привязаны.",
        ].join(" ");

        await interaction.editReply(buildDailyNewsOperatorPanelPayload({
          db: options.db,
          statusText,
          includeFlags: false,
        }));
      },
    });
  }

  if (customId === DAILY_NEWS_PANEL_PREPARE_RANGE_MODAL_ID) {
    return runDailyNewsOperatorInteractionAction({
      interaction,
      replyError: options.replyError,
      customId,
      errorPrefix: "Не удалось подготовить диапазон Daily News",
      action: async () => {
        if (typeof interaction.deferReply === "function") {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        }
        const startDayKey = normalizeDayKey(interaction?.fields?.getTextInputValue?.(DAILY_NEWS_PANEL_RANGE_START_DAY_KEY_INPUT_ID));
        const endDayKey = normalizeDayKey(interaction?.fields?.getTextInputValue?.(DAILY_NEWS_PANEL_RANGE_END_DAY_KEY_INPUT_ID));
        if (!startDayKey || !endDayKey) {
          await interaction.editReply({ content: "Обе даты диапазона должны быть в формате YYYY-MM-DD." });
          return;
        }

        const result = await prepareDailyNewsReleaseRange({
          db: options.db,
          startDayKey,
          endDayKey,
          now: options.now,
          saveDb: options.saveDb,
        });
        await interaction.editReply(buildDailyNewsOperatorPanelPayload({
          db: options.db,
          statusText: `Период **${startDayKey} → ${endDayKey}** подготовлен. Собрано дней: **${result.dayKeys.length}**. Публикация остановлена до ручного запуска.`,
          includeFlags: false,
        }));
      },
    });
  }

  const dayKey = normalizeDayKey(interaction?.fields?.getTextInputValue?.(DAILY_NEWS_PANEL_DAY_KEY_INPUT_ID));
  if (!dayKey) {
    await replyDailyNewsOperatorError(interaction, options.replyError, "Дата должна быть в формате YYYY-MM-DD.");
    return true;
  }

  return runDailyNewsOperatorInteractionAction({
    interaction,
    replyError: options.replyError,
    customId,
    errorPrefix: "Не удалось собрать Daily News по дню",
    action: async () => {
      if (typeof interaction.deferReply === "function") {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      }
      const action = customId === DAILY_NEWS_PANEL_RERUN_DAY_MODAL_ID
        ? DAILY_NEWS_OPERATOR_ACTIONS.RERUN_DAY
        : customId === DAILY_NEWS_PANEL_PUBLISH_DAY_MODAL_ID
          ? DAILY_NEWS_OPERATOR_ACTIONS.PUBLISH_DAY
          : DAILY_NEWS_OPERATOR_ACTIONS.PREVIEW_DAY;
      const result = await runDailyNewsOperatorAction({
        db: options.db,
        action,
        dayKey,
        now: options.now,
        client: options.client,
        publicChannel: options.publicChannel,
        staffChannel: options.staffChannel,
        saveDb: options.saveDb,
      });
      if (action === DAILY_NEWS_OPERATOR_ACTIONS.PUBLISH_DAY) {
        await interaction.editReply(buildDailyNewsOperatorPanelPayload({
          db: options.db,
          statusText: result.republished
            ? `Выпуск **${result.dayKey}** опубликован повторно.`
            : `Выпуск **${result.dayKey}** опубликован вручную.`,
          includeFlags: false,
        }));
        return;
      }
      await sendDailyNewsPreviewMessages(interaction, result.issue, "editReply");
    },
  });
}

module.exports = {
  DAILY_NEWS_OPERATOR_ACTIONS,
  DAILY_NEWS_PANEL_BACK_ID,
  DAILY_NEWS_PANEL_BUTTON_IDS,
  DAILY_NEWS_PANEL_CONFIG_INFRA_ID,
  DAILY_NEWS_PANEL_CONFIG_INFRA_MODAL_ID,
  DAILY_NEWS_PANEL_MODAL_IDS,
  DAILY_NEWS_PANEL_OPEN_ID,
  DAILY_NEWS_PANEL_PREPARE_RANGE_ID,
  DAILY_NEWS_PANEL_PREPARE_RANGE_MODAL_ID,
  DAILY_NEWS_PANEL_PUBLISH_DAY_ID,
  DAILY_NEWS_PANEL_PUBLISH_DAY_MODAL_ID,
  DAILY_NEWS_PANEL_PUBLISH_NOW_ID,
  DAILY_NEWS_PANEL_PUBLISH_STAFF_ONLY_ID,
  DAILY_NEWS_PANEL_REFRESH_ID,
  DAILY_NEWS_PANEL_RERUN_DAY_ID,
  DAILY_NEWS_PANEL_RERUN_DAY_MODAL_ID,
  DAILY_NEWS_PANEL_START_RELEASE_QUEUE_ID,
  DAILY_NEWS_PANEL_STOP_RELEASE_QUEUE_ID,
  DAILY_NEWS_PANEL_PREVIEW_DAY_ID,
  DAILY_NEWS_PANEL_PREVIEW_DAY_MODAL_ID,
  DAILY_NEWS_PANEL_PREVIEW_TODAY_ID,
  buildDailyNewsOperatorPanelPayload,
  buildDailyNewsStatusPayload,
  handleDailyNewsPanelButtonInteraction,
  handleDailyNewsPanelModalSubmitInteraction,
  renderStoredDailyNewsPreview,
  runDailyNewsOperatorAction,
};
