"use strict";

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");
const {
  buildAnalyticsSummary,
  cleanString,
} = require("./state");

const ANALYTICS_COMMAND_NAME = "analytics";
const ANALYTICS_PANEL_OPEN_ID = "panel_open_analytics";
const ANALYTICS_PANEL_REFRESH_ID = "analytics_panel_refresh";
const ANALYTICS_PANEL_BACK_ID = "analytics_panel_back";
const ANALYTICS_PANEL_VIEWS = Object.freeze(["overview", "features", "users", "links", "recent"]);
const ANALYTICS_PANEL_VIEW_IDS = Object.freeze(Object.fromEntries(
  ANALYTICS_PANEL_VIEWS.map((view) => [view, `analytics_panel_view_${view}`])
));
const ANALYTICS_PANEL_BUTTON_IDS = Object.freeze([
  ANALYTICS_PANEL_OPEN_ID,
  ANALYTICS_PANEL_REFRESH_ID,
  ANALYTICS_PANEL_BACK_ID,
  ...Object.values(ANALYTICS_PANEL_VIEW_IDS),
]);

function formatNumber(value) {
  return new Intl.NumberFormat("ru-RU").format(Math.max(0, Number(value) || 0));
}

function formatDateTime(value = "") {
  const time = Date.parse(String(value || ""));
  if (!Number.isFinite(time)) return "—";
  return new Date(time).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
}

function previewText(value = "", limit = 950) {
  const text = cleanString(value, Math.max(1, Number(limit) || 950));
  return text || "—";
}

function normalizeAnalyticsPanelView(value = "") {
  const normalized = cleanString(value, 40).toLowerCase();
  return ANALYTICS_PANEL_VIEWS.includes(normalized) ? normalized : "overview";
}

function parseAnalyticsPanelViewCustomId(customId = "") {
  const normalized = cleanString(customId, 120);
  const match = normalized.match(/^analytics_panel_view_([a-z_]+)$/);
  return match ? normalizeAnalyticsPanelView(match[1]) : "";
}

function buildNavigationRows(activeView = "overview") {
  const view = normalizeAnalyticsPanelView(activeView);
  const labels = {
    overview: "Обзор",
    features: "Фичи",
    users: "Юзеры",
    links: "Ссылки",
    recent: "События",
  };
  return [
    new ActionRowBuilder().addComponents(
      ANALYTICS_PANEL_VIEWS.map((entry) => new ButtonBuilder()
        .setCustomId(ANALYTICS_PANEL_VIEW_IDS[entry])
        .setLabel(labels[entry])
        .setStyle(entry === view ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setDisabled(entry === view))
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(ANALYTICS_PANEL_REFRESH_ID).setLabel("Обновить").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(ANALYTICS_PANEL_BACK_ID).setLabel("В мод-панель").setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function featureLine(feature) {
  return [
    `**${previewText(feature.feature, 60)}**`,
    `total ${formatNumber(feature.total)}`,
    `unique ${formatNumber(feature.uniqueUserCount)}`,
    feature.anonymous ? `anon ${formatNumber(feature.anonymous)}` : "",
    feature.linkClicks ? `links ${formatNumber(feature.linkClicks)}` : "",
    `last ${formatDateTime(feature.lastAt)}`,
  ].filter(Boolean).join(" • ");
}

function userLine(user) {
  const features = user.topFeatures.map((entry) => `${entry.key}:${entry.count}`).join(", ");
  return `<@${user.userId}> • total ${formatNumber(user.total)} • last ${formatDateTime(user.lastAt)}${features ? ` • ${features}` : ""}`;
}

function redirectLine(record) {
  return [
    `**${previewText(record.feature, 40)}**/${previewText(record.targetKind || record.action, 40)}`,
    `clicks ${formatNumber(record.clickCount)}`,
    `last ${formatDateTime(record.lastUsedAt)}`,
    previewText(record.targetUrl, 160),
  ].join(" • ");
}

function recentLine(event) {
  const actor = event.actorUserId ? `<@${event.actorUserId}>` : "anonymous";
  const target = event.targetUserId ? ` → <@${event.targetUserId}>` : "";
  return `${formatDateTime(event.at)} • ${actor}${target} • **${previewText(event.feature, 40)}**/${previewText(event.action, 60)} • ${previewText(event.interactionType, 30)}`;
}

function buildOverviewEmbed(summary, options = {}) {
  const redirectEnabled = options.redirectEnabled === true;
  const embed = new EmbedBuilder()
    .setTitle("Analytics Panel")
    .setDescription([
      `Всего событий: **${formatNumber(summary.total)}**`,
      `Уникальных Discord users: **${formatNumber(summary.uniqueUserCount)}**`,
      `Детальная история: **${formatNumber(summary.detailedCount)}** events / retention **${formatNumber(summary.retentionDays)}д**`,
      `Архивировано: **${formatNumber(summary.archivedTotal)}**`,
      `Redirect clicks: **${formatNumber(summary.linkClicks)}**`,
      `Redirect tracking: **${redirectEnabled ? "enabled" : "disabled: ANALYTICS_PUBLIC_BASE_URL не задан"}**`,
    ].join("\n"));

  const topFeatures = summary.featureList.slice(0, 8).map(featureLine).join("\n");
  const topUsers = summary.userList.slice(0, 8).map(userLine).join("\n");
  embed.addFields(
    { name: "Top features", value: previewText(topFeatures, 1024), inline: false },
    { name: "Top users", value: previewText(topUsers, 1024), inline: false }
  );
  if (summary.lastCompactedAt) {
    embed.setFooter({ text: `Last compacted: ${formatDateTime(summary.lastCompactedAt)}` });
  }
  return embed;
}

function buildFeaturesEmbed(summary) {
  const lines = summary.featureList.slice(0, 20).map((feature) => {
    const actions = feature.topActions.map((entry) => `${entry.key}:${entry.count}`).join(", ");
    return `${featureLine(feature)}${actions ? `\nactions: ${actions}` : ""}`;
  }).join("\n\n");
  return new EmbedBuilder()
    .setTitle("Analytics • Features")
    .setDescription(previewText(lines, 4000));
}

function buildUsersEmbed(summary) {
  const lines = summary.userList.slice(0, 20).map((user) => {
    const actions = user.topActions.map((entry) => `${entry.key}:${entry.count}`).join(", ");
    return `${userLine(user)}${actions ? `\nactions: ${actions}` : ""}`;
  }).join("\n\n");
  return new EmbedBuilder()
    .setTitle("Analytics • Users")
    .setDescription(previewText(lines, 4000));
}

function buildLinksEmbed(summary, options = {}) {
  const redirectEnabled = options.redirectEnabled === true;
  const lines = summary.redirects.slice(0, 20).map(redirectLine).join("\n\n");
  return new EmbedBuilder()
    .setTitle("Analytics • Links")
    .setDescription(previewText(lines || (redirectEnabled ? "Redirect-ссылок ещё нет." : "Redirect tracking disabled: ANALYTICS_PUBLIC_BASE_URL не задан."), 4000));
}

function buildRecentEmbed(summary) {
  const lines = summary.recent.slice(0, 25).map(recentLine).join("\n");
  return new EmbedBuilder()
    .setTitle("Analytics • Recent")
    .setDescription(previewText(lines || "Событий пока нет.", 4000));
}

function buildAnalyticsPanelPayload(options = {}) {
  const view = normalizeAnalyticsPanelView(options.view);
  const summary = buildAnalyticsSummary(options.state || {}, { recentLimit: 30 });
  const embed = view === "features"
    ? buildFeaturesEmbed(summary)
    : view === "users"
      ? buildUsersEmbed(summary)
      : view === "links"
        ? buildLinksEmbed(summary, options)
        : view === "recent"
          ? buildRecentEmbed(summary)
          : buildOverviewEmbed(summary, options);

  const statusText = cleanString(options.statusText, 500);
  if (statusText) {
    embed.addFields({ name: "Статус", value: statusText, inline: false });
  }

  const payload = {
    embeds: [embed],
    components: buildNavigationRows(view),
  };

  return options.includeFlags === false ? payload : { ...payload, flags: MessageFlags.Ephemeral };
}

module.exports = {
  ANALYTICS_COMMAND_NAME,
  ANALYTICS_PANEL_BACK_ID,
  ANALYTICS_PANEL_BUTTON_IDS,
  ANALYTICS_PANEL_OPEN_ID,
  ANALYTICS_PANEL_REFRESH_ID,
  ANALYTICS_PANEL_VIEW_IDS,
  ANALYTICS_PANEL_VIEWS,
  buildAnalyticsPanelPayload,
  normalizeAnalyticsPanelView,
  parseAnalyticsPanelViewCustomId,
};
