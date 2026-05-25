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
const { buildDailyNewsCoverAttachment } = require("./cover");
const { compileDailyNewsPreview, renderStoredDailyNewsPreview } = require("./preview");
const { publishDailyNewsIssue } = require("./publisher");
const { ensureNewsState } = require("./state");

const DAILY_NEWS_OPERATOR_ACTIONS = Object.freeze({
  STATUS: "status",
  PREVIEW_TODAY: "preview_today",
  PREVIEW_DAY: "preview_day",
  RERUN_DAY: "rerun_day",
  PUBLISH_NOW: "publish_now",
  PUBLISH_STAFF_ONLY: "publish_staff_only",
});

const DAILY_NEWS_PANEL_OPEN_ID = "panel_open_daily_news";
const DAILY_NEWS_PANEL_REFRESH_ID = "daily_news_panel_refresh";
const DAILY_NEWS_PANEL_PREVIEW_TODAY_ID = "daily_news_panel_preview_today";
const DAILY_NEWS_PANEL_PREVIEW_DAY_ID = "daily_news_panel_preview_day";
const DAILY_NEWS_PANEL_RERUN_DAY_ID = "daily_news_panel_rerun_day";
const DAILY_NEWS_PANEL_PUBLISH_NOW_ID = "daily_news_panel_publish_now";
const DAILY_NEWS_PANEL_PUBLISH_STAFF_ONLY_ID = "daily_news_panel_publish_staff_only";
const DAILY_NEWS_PANEL_BACK_ID = "daily_news_panel_back";
const DAILY_NEWS_PANEL_PREVIEW_DAY_MODAL_ID = "daily_news_panel_preview_day_modal";
const DAILY_NEWS_PANEL_RERUN_DAY_MODAL_ID = "daily_news_panel_rerun_day_modal";
const DAILY_NEWS_PANEL_DAY_KEY_INPUT_ID = "day_key";

const DAILY_NEWS_PANEL_BUTTON_IDS = Object.freeze([
  DAILY_NEWS_PANEL_OPEN_ID,
  DAILY_NEWS_PANEL_REFRESH_ID,
  DAILY_NEWS_PANEL_PREVIEW_TODAY_ID,
  DAILY_NEWS_PANEL_PREVIEW_DAY_ID,
  DAILY_NEWS_PANEL_RERUN_DAY_ID,
  DAILY_NEWS_PANEL_PUBLISH_NOW_ID,
  DAILY_NEWS_PANEL_PUBLISH_STAFF_ONLY_ID,
  DAILY_NEWS_PANEL_BACK_ID,
]);

const DAILY_NEWS_PANEL_MODAL_IDS = Object.freeze([
  DAILY_NEWS_PANEL_PREVIEW_DAY_MODAL_ID,
  DAILY_NEWS_PANEL_RERUN_DAY_MODAL_ID,
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
      return "staff-only smoke";
    case "public":
      return "public";
    default:
      return "—";
  }
}

function buildDailyNewsPanelRows(state = {}) {
  const publicChannelId = cleanString(state.config?.channels?.publicChannelId, 80);
  const staffChannelId = cleanString(state.config?.channels?.staffChannelId, 80);
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(DAILY_NEWS_PANEL_REFRESH_ID).setLabel("Обзор").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(DAILY_NEWS_PANEL_PREVIEW_TODAY_ID).setLabel("Preview сегодня").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(DAILY_NEWS_PANEL_PREVIEW_DAY_ID).setLabel("Preview день").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(DAILY_NEWS_PANEL_RERUN_DAY_ID).setLabel("Rerun день").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(DAILY_NEWS_PANEL_PUBLISH_NOW_ID)
        .setLabel("Опубликовать")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!publicChannelId)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(DAILY_NEWS_PANEL_PUBLISH_STAFF_ONLY_ID)
        .setLabel("Staff-only smoke")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!staffChannelId),
      new ButtonBuilder().setCustomId(DAILY_NEWS_PANEL_BACK_ID).setLabel("Назад").setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function buildDailyNewsStatusPayload(db = {}) {
  const state = ensureNewsState(db);
  const coverage = state.runtime.lastCoverageSummary || {};
  const audit = state.runtime.lastAuditCounts || {};
  return {
    content: [
      "## 🗞️ Daily News status",
      `compile: **${formatCompileStatusLabel(state.runtime.lastCompileStatus)}** · day **${state.runtime.lastCompiledDayKey || "—"}**`,
      `publish: **${formatPublishStatusLabel(state.runtime.lastPublishStatus)}** · day **${state.runtime.lastPublishedDayKey || "—"}**`,
      `coverage: **${coverage.partial ? "partial" : "clean"}${coverage.ambiguous ? " + ambiguous" : ""}**`,
      `candidates: **${audit.rawCandidateCounts?.total || 0}**`,
      state.runtime.lastFailure?.message ? `last failure: **${state.runtime.lastFailure.message}**` : "last failure: **—**",
    ].join("\n"),
    allowedMentions: { parse: [] },
  };
}

function buildDailyNewsOperatorPanelPayload({ db = {}, statusText = "", includeFlags = true } = {}) {
  const state = ensureNewsState(db);
  const coverage = state.runtime.lastCoverageSummary || {};
  const audit = state.runtime.lastAuditCounts || {};
  const publishResult = state.runtime.lastPublishResult || {};

  const embed = new EmbedBuilder()
    .setColor(normalizeHexColor(state.config?.presentation?.accentColor, 0xD6A441))
    .setTitle("Daily News Operator")
    .setDescription([
      `Мастхед: **${cleanString(state.config?.presentation?.masthead, 120) || "Daily Edition"}**`,
      `Ежедневный тик: **${state.config?.enabled ? "включён" : "выключен"}** · ${Number(state.config?.schedule?.publishHourMsk) || 21}:00 МСК`,
      "Режим выпуска: **manual-only**",
      `Public: ${formatChannelMention(state.config?.channels?.publicChannelId)}`,
      `Staff: ${formatChannelMention(state.config?.channels?.staffChannelId)}`,
      "Scheduler делает только shadow compile; live publish запускается кнопкой «Опубликовать».",
    ].join("\n"))
    .addFields(
      {
        name: "Compile",
        value: [
          `Статус: **${formatCompileStatusLabel(state.runtime.lastCompileStatus)}**`,
          `Day: **${cleanString(state.runtime.lastCompiledDayKey, 40) || "—"}**`,
          `Финиш: **${formatDateTime(state.runtime.lastCompileFinishedAt)}**`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "Publish",
        value: [
          `Статус: **${formatPublishStatusLabel(state.runtime.lastPublishStatus)}**`,
          `Day: **${cleanString(state.runtime.lastPublishedDayKey, 40) || "—"}**`,
          `Финиш: **${formatDateTime(state.runtime.lastPublishFinishedAt)}**`,
          `Режим: **${formatPublishModeLabel(publishResult.publishMode)}**`,
          `Delivery msg: **${cleanString(publishResult.deliveryMessageId, 80) || "—"}**`,
          `Audit msg: **${cleanString(publishResult.staffMessageId, 80) || "—"}**`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "Coverage / audit",
        value: [
          `Coverage: **${coverage.partial ? "partial" : "clean"}${coverage.ambiguous ? " + ambiguous" : ""}**`,
          `Candidates: **${audit.rawCandidateCounts?.total || 0}**`,
          `Last preview: **${formatPreviewRequest(state.runtime.lastPreviewRequest)}**`,
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

function buildDayKeyModal(action = DAILY_NEWS_OPERATOR_ACTIONS.PREVIEW_DAY) {
  const isRerun = action === DAILY_NEWS_OPERATOR_ACTIONS.RERUN_DAY;
  return new ModalBuilder()
    .setCustomId(isRerun ? DAILY_NEWS_PANEL_RERUN_DAY_MODAL_ID : DAILY_NEWS_PANEL_PREVIEW_DAY_MODAL_ID)
    .setTitle(isRerun ? "Daily News rerun day" : "Daily News preview day")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(DAILY_NEWS_PANEL_DAY_KEY_INPUT_ID)
          .setLabel("Day key")
          .setPlaceholder("2026-05-14")
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
    const result = compileDailyNewsPreview({ db, targetDayKey: dayKey, now, windowEndAt, saveDb });
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
    const preview = compileDailyNewsPreview({
      db,
      targetDayKey: dayKey,
      now,
      windowEndAt,
      saveDb,
      historySnapshotMode: "capture_if_current_day",
    });
    const publish = await publishDailyNewsIssue({
      db,
      digest: preview.digest,
      issue: preview.issue,
      client,
      publicChannel,
      staffChannel,
      publishMode: normalizedAction === DAILY_NEWS_OPERATOR_ACTIONS.PUBLISH_STAFF_ONLY ? "staff_only" : "public",
      force,
      now,
      saveDb,
    });
    return {
      action: normalizedAction,
      dayKey: preview.dayKey,
      digest: preview.digest,
      issue: preview.issue,
      publish,
      payload: buildDailyNewsStatusPayload(db),
    };
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

  if (customId === DAILY_NEWS_PANEL_PREVIEW_DAY_ID || customId === DAILY_NEWS_PANEL_RERUN_DAY_ID) {
    return runDailyNewsOperatorInteractionAction({
      interaction,
      replyError: options.replyError,
      customId,
      errorPrefix: "Не удалось открыть форму Daily News",
      action: async () => {
        await interaction.showModal(buildDayKeyModal(
          customId === DAILY_NEWS_PANEL_RERUN_DAY_ID
            ? DAILY_NEWS_OPERATOR_ACTIONS.RERUN_DAY
            : DAILY_NEWS_OPERATOR_ACTIONS.PREVIEW_DAY
        ));
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
            : `Выпуск **${result.dayKey}** опубликован. Public message: **${cleanString(result.publish?.result?.publicMessageId, 80) || "—"}**.`;
        await interaction.editReply(buildDailyNewsOperatorPanelPayload({
          db: options.db,
          statusText,
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

  const dayKey = normalizeDayKey(interaction?.fields?.getTextInputValue?.(DAILY_NEWS_PANEL_DAY_KEY_INPUT_ID));
  if (!dayKey) {
    await replyDailyNewsOperatorError(interaction, options.replyError, "Day key должен быть в формате YYYY-MM-DD.");
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
        : DAILY_NEWS_OPERATOR_ACTIONS.PREVIEW_DAY;
      const result = await runDailyNewsOperatorAction({
        db: options.db,
        action,
        dayKey,
        now: options.now,
        saveDb: options.saveDb,
      });
      await sendDailyNewsPreviewMessages(interaction, result.issue, "editReply");
    },
  });
}

module.exports = {
  DAILY_NEWS_OPERATOR_ACTIONS,
  DAILY_NEWS_PANEL_BACK_ID,
  DAILY_NEWS_PANEL_BUTTON_IDS,
  DAILY_NEWS_PANEL_MODAL_IDS,
  DAILY_NEWS_PANEL_OPEN_ID,
  DAILY_NEWS_PANEL_PUBLISH_NOW_ID,
  DAILY_NEWS_PANEL_PUBLISH_STAFF_ONLY_ID,
  DAILY_NEWS_PANEL_REFRESH_ID,
  DAILY_NEWS_PANEL_RERUN_DAY_ID,
  DAILY_NEWS_PANEL_RERUN_DAY_MODAL_ID,
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
