"use strict";

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  ModalBuilder,
  SectionBuilder,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  ThumbnailBuilder,
} = require("discord.js");
const {
  ANTITEAM_COUNTS,
  ANTITEAM_HELPER_REWARD_THRESHOLDS,
  ANTITEAM_LEVELS,
  KV_APPROVAL_PING_ROLE_ID,
  KV_APPROVAL_PING_USER_ID,
  cleanString,
  createDefaultAntiteamConfig,
  normalizeAntiteamCount,
  normalizeAntiteamLevel,
  normalizeAntiteamPingMode,
} = require("./state");
const {
  SUPPORT_PROGRESS_LEVELS,
  getSupportProgressModel,
} = require("./support-progress");

const ANTITEAM_COMMAND_NAME = "антитим";
const CLAN_WAR_LABEL = "ФАЙТ С КЛАНОМ";
const CLAN_WAR_ACCENT_COLOR = 0x8E24AA;
const KV_LABEL = "КВ";
const KV_PENDING_LABEL = "ВОЗМОЖНО КВ";
const KV_ACCENT_COLOR = 0x5E35B1;
const KV_PENDING_ACCENT_COLOR = 0x7E57C2;
const KV_LEVEL_OPTION = Object.freeze({
  id: "kv",
  emoji: "🟪",
  label: "КВ (клан-вар)",
  description: "Заявка «возможно кв» — её одобряют админы.",
});

function isKvTicket(ticket = {}) {
  return ticket?.kind === "kv";
}

function isKvPending(ticket = {}) {
  return ticket?.kind === "kv" && ticket?.status === "pending_approval";
}

function formatKvApprovalTargets(config = createDefaultAntiteamConfig()) {
  const roleId = cleanString(config.kvApprovalRoleId, 80) || KV_APPROVAL_PING_ROLE_ID;
  const userId = cleanString(config.kvApprovalUserId, 80) || KV_APPROVAL_PING_USER_ID;
  return { roleId, userId, mention: `<@&${roleId}> <@${userId}>` };
}

const ANTITEAM_CUSTOM_IDS = Object.freeze({
  open: "at:open",
  progress: "at:progress",
  leaders: "at:leaders",
  guide: "at:guide",
  requestRobloxNick: "at:roblox:request",
  confirmRoblox: "at:roblox:confirm",
  changeRoblox: "at:roblox:change",
  // Twink / alt Roblox bound only for the current mission (profile untouched).
  twinkOpen: "at:twink_open",
  twinkConfirm: "at:twink_confirm",
  twinkCancel: "at:twink_cancel",
  joinBattalion: "at:battalion:join",
  config: "at:config",
  configAdvanced: "at:config:advanced",
  pingConfig: "at:ping:config",
  toggleTestMode: "at:test_mode:toggle",
  panelText: "at:panel:text",
  publishPanel: "at:panel:publish",
  refreshPanel: "at:panel:refresh",
  stats: "at:stats",
  statsClear: "at:stats:clear",
  statsClearConfirm: "at:stats:clear_confirm",
  statsRoles: "at:stats:roles",
  statsSyncRoles: "at:stats:sync_roles",
  levelSelect: "at:level",
  countSelect: "at:count",
  clanRolesSelect: "at:clan_roles",
  toggleDirect: "at:toggle:direct",
  togglePhoto: "at:toggle:photo",
  // KV (clan war) anchor entry from the setup panel.
  kvAnchor: "at:kv_anchor:open",
  setDirectLink: "at:direct_link:set",
  directLinkGuide: "at:direct_link:guide",
  editDescription: "at:desc:open",
  submitDraft: "at:submit",
  submitWithoutPhoto: "at:photo:skip",
  cancelDraft: "at:cancel",
});

function flags(ephemeral = false) {
  return ephemeral ? (MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral) : MessageFlags.IsComponentsV2;
}

function joinContentLines(lines = [], fallback = "—", limit = 3600) {
  const body = (Array.isArray(lines) ? lines : [lines])
    .map((line) => cleanString(line, 900))
    .filter(Boolean)
    .join("\n")
    .slice(0, Math.max(1, Number(limit) || 3600));
  return body || fallback;
}

function buildText(title, lines = [], fallback = "—", limit = 3600) {
  const heading = cleanString(title, 120) || "Блок";
  const body = joinContentLines(lines, fallback, limit);
  return new TextDisplayBuilder().setContent(`### ${heading}\n${body || fallback}`);
}

function formatRoleMention(roleId) {
  const id = cleanString(roleId, 80);
  return id ? `<@&${id}>` : "не настроена";
}

function formatChannelMention(channelId) {
  const id = cleanString(channelId, 80);
  return id ? `<#${id}>` : "не настроен";
}

function getBattalionPingRoleIds(config = createDefaultAntiteamConfig()) {
  const normalized = createDefaultAntiteamConfig(config);
  return [
    normalized.battalionRoleId,
    ...(Array.isArray(normalized.battalionPingRoleIds) ? normalized.battalionPingRoleIds : []),
  ]
    .map((roleId) => cleanString(roleId, 80))
    .filter(Boolean)
    .filter((roleId, index, roleIds) => roleIds.indexOf(roleId) === index);
}

function formatRoleMentionList(roleIds = [], fallback = "не настроены") {
  const mentions = (Array.isArray(roleIds) ? roleIds : [])
    .map((roleId) => cleanString(roleId, 80))
    .filter(Boolean)
    .map(formatRoleMention);
  return mentions.length ? mentions.join(", ") : fallback;
}

function formatAntiteamPingMode(config = createDefaultAntiteamConfig()) {
  const normalized = createDefaultAntiteamConfig(config);
  const mode = normalizeAntiteamPingMode(normalized.pingMode, "battalion");
  const basePing = formatRoleMentionList(getBattalionPingRoleIds(normalized), "батальён не настроен");
  if (mode === "everyone") return `${basePing} + автоудаляемый @everyone`;
  if (mode === "custom_role") return `${basePing} + автоудаляемая роль ${formatRoleMention(normalized.extraPingRoleId)}`;
  if (mode === "edit_roles") return `${basePing} + buffer-edit роли ${formatRoleMentionList(normalized.editPingRoleIds)}`;
  return basePing;
}

function formatStartPanelPingLine(config = createDefaultAntiteamConfig()) {
  const normalized = createDefaultAntiteamConfig(config);
  const basePing = formatRoleMentionList(getBattalionPingRoleIds(normalized), "батальён пока не настроен");
  const mode = normalizeAntiteamPingMode(normalized.pingMode, "battalion");
  if (mode === "edit_roles") {
    return `Пингуются те, кто в ${basePing}; edit-test: ${formatRoleMentionList(normalized.editPingRoleIds)}`;
  }
  return `Пингуются те, кто в ${basePing}`;
}

function getPhotoAttachmentName(photo = {}) {
  if (!photo || typeof photo !== "object") return "antiteam-photo.png";
  const rawName = cleanString(photo.name, 180).replace(/[^A-Za-z0-9._-]+/g, "_");
  if (rawName && /\.[A-Za-z0-9]{2,8}$/.test(rawName)) return rawName.slice(0, 120);
  const contentType = cleanString(photo.contentType, 80).toLowerCase();
  const extension = contentType.includes("webp")
    ? "webp"
    : contentType.includes("gif")
      ? "gif"
      : contentType.includes("jpeg") || contentType.includes("jpg")
        ? "jpg"
        : "png";
  return `antiteam-photo.${extension}`;
}

function getTicketPhotos(ticket = {}) {
  const source = Array.isArray(ticket.photos) && ticket.photos.length ? ticket.photos : [ticket.photo];
  const photos = [];
  const seen = new Set();
  for (const entry of source) {
    const url = cleanString(entry?.url, 2000);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    photos.push(entry);
    if (photos.length >= 10) break;
  }
  return photos;
}

function withUniquePhotoName(name, index, used) {
  const baseName = cleanString(name, 180) || `antiteam-photo-${index + 1}.png`;
  let candidate = baseName;
  if (!used.has(candidate)) {
    used.add(candidate);
    return candidate;
  }
  const match = baseName.match(/^(.*?)(\.[A-Za-z0-9]{2,8})$/);
  const base = match ? match[1] : baseName;
  const extension = match ? match[2] : "";
  let suffix = 2;
  do {
    candidate = `${base}-${suffix}${extension}`;
    suffix += 1;
  } while (used.has(candidate));
  used.add(candidate);
  return candidate;
}

function getPhotoAttachmentNames(ticket = {}, photos = getTicketPhotos(ticket)) {
  const storedNames = Array.isArray(ticket.message?.photoAttachmentNames)
    ? ticket.message.photoAttachmentNames.map((name) => cleanString(name, 180)).filter(Boolean)
    : [];
  if (!storedNames.length && cleanString(ticket.message?.photoAttachmentName, 180)) {
    storedNames.push(cleanString(ticket.message.photoAttachmentName, 180));
  }
  const used = new Set();
  return photos.map((photo, index) => withUniquePhotoName(storedNames[index] || getPhotoAttachmentName(photo), index, used));
}

function getLevelMeta(level) {
  return ANTITEAM_LEVELS[normalizeAntiteamLevel(level, "medium")] || ANTITEAM_LEVELS.medium;
}

function getCountMeta(count) {
  return ANTITEAM_COUNTS[normalizeAntiteamCount(count, "3-5")] || ANTITEAM_COUNTS["3-5"];
}

function formatRequesterName(ticket = {}, limit = 32) {
  const raw = cleanString(ticket.createdByTag || ticket.createdBy, 80);
  const name = cleanString(raw.split("#")[0].replace(/^@+/, "").trim(), limit);
  return name || "автор";
}


function formatCountHeadline(count) {
  const meta = getCountMeta(count);
  if (meta.id === "2") return "2 тимера";
  return `${meta.label} тимеров`;
}

function buildQuotedDescription(value = "", fallback = "описание не добавлено") {
  const text = cleanString(value, 900);
  if (!text) return fallback;
  return text
    .split(/\r?\n/)
    .map((line) => cleanString(line, 800))
    .filter(Boolean)
    .map((line) => `> ${line}`)
    .join("\n");
}

function buildPayload(container, { ephemeral = false, extraComponents = [] } = {}) {
  return {
    flags: flags(ephemeral),
    allowedMentions: { parse: [] },
    components: [container, ...(Array.isArray(extraComponents) ? extraComponents.filter(Boolean) : [])],
  };
}

function buildStartPanelPayload(config = createDefaultAntiteamConfig()) {
  const normalized = createDefaultAntiteamConfig(config);
  const panel = normalized.panel;
  const container = new ContainerBuilder()
    .setAccentColor(panel.accentColor)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# ${panel.title}`),
      new TextDisplayBuilder().setContent(panel.description),
      new TextDisplayBuilder().setContent([
        normalized.testMode ? "🧪 **Тестовый режим включён** — новые миссии публикуются без пинга батальона." : "",
        formatStartPanelPingLine(normalized),
        panel.details,
      ].filter(Boolean).join("\n"))
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(ANTITEAM_CUSTOM_IDS.open)
          .setLabel(panel.buttonLabel)
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(ANTITEAM_CUSTOM_IDS.joinBattalion)
          .setLabel("Вступить в батальён")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(ANTITEAM_CUSTOM_IDS.progress)
          .setLabel("🛡️ Мой прогресс")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(ANTITEAM_CUSTOM_IDS.leaders)
          .setLabel("🏆 Лидеры")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(ANTITEAM_CUSTOM_IDS.guide)
          .setLabel(panel.guideButtonLabel)
          .setStyle(ButtonStyle.Secondary)
      )
    );

  return buildPayload(container);
}

function getHelperStatsEntries(state = {}) {
  return Object.entries(state.stats?.helpers || {})
    .map(([userId, stats]) => ({
      userId,
      responded: Number(stats?.responded) || 0,
      linkGranted: Number(stats?.linkGranted) || 0,
      confirmedArrived: Number(stats?.confirmedArrived) || 0,
      points: Number(stats?.confirmedArrived) || 0,
      lastTicketId: cleanString(stats?.lastTicketId, 80),
      lastHelpedAt: cleanString(stats?.lastHelpedAt, 80),
    }))
    .sort((left, right) => (right.confirmedArrived - left.confirmedArrived)
      || (right.responded - left.responded)
      || left.userId.localeCompare(right.userId));
}

function getSupportLeaderboardEntries(state = {}) {
  return getHelperStatsEntries(state).filter((entry) => entry.points > 0);
}

function formatSupportLeaderboardRank(rankIndex = 0) {
  if (rankIndex === 0) return "🥇";
  if (rankIndex === 1) return "🥈";
  if (rankIndex === 2) return "🥉";
  return `#${rankIndex + 1}`;
}

function formatSupportLeaderboardEntry(entry = {}, rankIndex = 0) {
  return `${formatSupportLeaderboardRank(rankIndex)} <@${entry.userId}> — **${entry.points} очк.** • отклики: ${entry.responded} • ссылки: ${entry.linkGranted}`;
}

function buildSupportLeaderboardPayload(state = {}, viewerUserId = "", options = {}) {
  const config = createDefaultAntiteamConfig(state.config);
  const helpers = getSupportLeaderboardEntries(state);
  const normalizedViewerUserId = cleanString(viewerUserId, 80);
  const maxVisible = Math.max(1, Math.min(10, Number.parseInt(options.limit, 10) || 10));
  const visibleHelpers = helpers.slice(0, maxVisible);
  const viewerIndex = normalizedViewerUserId
    ? helpers.findIndex((entry) => entry.userId === normalizedViewerUserId)
    : -1;
  const viewerEntry = viewerIndex >= 0 ? helpers[viewerIndex] : null;

  const summaryLines = [
    `Записей в таблице: **${helpers.length}**`,
    "Очки = подтверждённые приходы после закрытия миссии.",
    viewerEntry
      ? `Твоё место: **#${viewerIndex + 1}** • очков: **${viewerEntry.points}** • откликов: **${viewerEntry.responded}**`
      : "Тебя пока нет в таблице. Первый балл появится после закрытой миссии, где твой приход подтвердили.",
  ];

  const container = new ContainerBuilder()
    .setAccentColor(0xF9A825)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("# 🏆 Лидеры батальона"),
      new TextDisplayBuilder().setContent(summaryLines.join("\n"))
    );

  if (visibleHelpers.length) {
    container.addTextDisplayComponents(buildText(
      "Топ helper-ов",
      visibleHelpers.map((entry, index) => formatSupportLeaderboardEntry(entry, index)),
      "Пока пусто"
    ));
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      "Пока никто не закрыл миссию с подтверждённым приходом. Первый helper откроет лидерборд."
    ));
  }

  if (viewerEntry && viewerIndex >= visibleHelpers.length) {
    container.addTextDisplayComponents(buildText(
      "Твоя позиция",
      [formatSupportLeaderboardEntry(viewerEntry, viewerIndex)],
      "—"
    ));
  }

  if (helpers.length > visibleHelpers.length) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `Показан топ-${visibleHelpers.length}. Ещё в таблице: **${helpers.length - visibleHelpers.length}**.`
    ));
  }

  container
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(ANTITEAM_CUSTOM_IDS.progress)
          .setLabel("🛡️ Мой прогресс")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(ANTITEAM_CUSTOM_IDS.guide)
          .setLabel(config.panel.guideButtonLabel)
          .setStyle(ButtonStyle.Secondary)
      )
    );

  return buildPayload(container, { ephemeral: true });
}

function buildSupportProgressPayload(modelInput = {}, { attachmentName = "antiteam-support-progress.png" } = {}) {
  const model = modelInput?.displayLevel ? modelInput : getSupportProgressModel(modelInput?.points || 0);
  const accentColor = Number.isSafeInteger(model.displayLevel?.accentColor)
    ? model.displayLevel.accentColor
    : 0xE53935;
  const container = new ContainerBuilder()
    .setAccentColor(accentColor)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("# 🛡️ Прогресс помощи"),
      new TextDisplayBuilder().setContent([
        `**${model.title}** • ${model.pointsText}`,
        model.nextText,
        model.displayLevel?.description || "",
      ].filter(Boolean).join("\n"))
    )
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder()
          .setURL(`attachment://${cleanString(attachmentName, 180) || "antiteam-support-progress.png"}`)
      )
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      SUPPORT_PROGRESS_LEVELS
        .map((level) => `${model.points >= level.threshold ? "●" : "○"} ${level.label}: ${level.threshold}+`)
        .join("   ")
    ));
  return buildPayload(container, { ephemeral: true });
}

function formatHelpThreshold(value) {
  const number = Math.max(0, Number.parseInt(value, 10) || 0);
  const lastTwo = number % 100;
  const last = number % 10;
  const word = lastTwo >= 11 && lastTwo <= 14
    ? "помощей"
    : last === 1
      ? "помощь"
      : last >= 2 && last <= 4
        ? "помощи"
        : "помощей";
  return `${number}+ ${word}`;
}

function buildStartGuidePayload(config = createDefaultAntiteamConfig()) {
  const rankLines = SUPPORT_PROGRESS_LEVELS
    .map((level) => `• **${level.label}** — ${formatHelpThreshold(level.threshold)}`)
    .join("\n");
  const container = new ContainerBuilder()
    .setAccentColor(config.panel?.accentColor || 0xE53935)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("# Как работает антитим"),
      new TextDisplayBuilder().setContent([
        "1. Если Roblox уже привязан к профилю, бот возьмёт его сам.",
        "2. Если привязки нет, появится короткая форма только для Roblox ника.",
        "3. Выбери опасность, число тимеров и по возможности добавь ники/киллы целей.",
        "4. После отправки появится заявка и thread, где батальён сможет быстро подключиться.",
        "5. Если включён прямой вход или helper уже есть в друзьях Roblox, бот даст быстрый join/profile путь.",
      ].join("\n")),
      new TextDisplayBuilder().setContent([
        "### Ранги помощи",
        "Очко засчитывается после закрытия миссии, если тебя отметили как пришедшего helper-а.",
        rankLines,
        "Личный щит и прогресс открываются кнопкой **Мой прогресс**, а общий топ виден в **Лидеры**.",
      ].join("\n"))
    );
  return buildPayload(container, { ephemeral: true });
}

function buildRobloxMissingPayload({ reasonText = "" } = {}) {
  const container = new ContainerBuilder()
    .setAccentColor(0x1565C0)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("# Roblox ник"),
      new TextDisplayBuilder().setContent([
        "В профиле пока нет Roblox аккаунта для антитима.",
        cleanString(reasonText, 400),
        "Внеси ник: бот проверит его через Roblox API и сразу откроет заявку.",
      ].filter(Boolean).join("\n"))
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(ANTITEAM_CUSTOM_IDS.requestRobloxNick)
          .setLabel("✍️ Внести ник")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(ANTITEAM_CUSTOM_IDS.cancelDraft)
          .setLabel("✖️ Отмена")
          .setStyle(ButtonStyle.Secondary)
      )
    );
  return buildPayload(container, { ephemeral: true });
}

function buildRobloxConfirmPayload(roblox = {}) {
  const username = cleanString(roblox.username || roblox.name, 120) || "Roblox";
  const userId = cleanString(roblox.userId || roblox.id, 40);
  const profileUrl = cleanString(roblox.profileUrl, 500) || (userId ? `https://www.roblox.com/users/${userId}/profile` : "");
  const buttons = [
    new ButtonBuilder()
      .setCustomId(ANTITEAM_CUSTOM_IDS.confirmRoblox)
      .setLabel("✅ Да, это мой")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(ANTITEAM_CUSTOM_IDS.changeRoblox)
      .setLabel("✏️ Другой ник")
      .setStyle(ButtonStyle.Secondary),
  ];
  if (profileUrl) {
    buttons.push(new ButtonBuilder().setLabel("👤 Профиль").setStyle(ButtonStyle.Link).setURL(profileUrl));
  }
  const container = new ContainerBuilder()
    .setAccentColor(0x1565C0)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("# Подтверди Roblox"),
      new TextDisplayBuilder().setContent([
        `В профиле найден: **${username}**${userId ? ` (${userId})` : ""}.`,
        "Это одноразовая проверка перед первой заявкой антитима.",
      ].join("\n"))
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addActionRowComponents(new ActionRowBuilder().addComponents(...buttons.slice(0, 5)));
  return buildPayload(container, { ephemeral: true });
}

function buildModeratorPanelPayload(state = {}, statusText = "") {
  const config = createDefaultAntiteamConfig(state.config);
  const tickets = Object.values(state.tickets || {});
  const openCount = tickets.filter((ticket) => ticket.status === "open").length;
  const closedCount = tickets.filter((ticket) => ticket.status === "closed").length;
  const helperCount = Object.keys(state.stats?.helpers || {}).length;
  const container = new ContainerBuilder()
    .setAccentColor(0x455A64)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("# Antiteam Control"),
      new TextDisplayBuilder().setContent([
        `Канал: ${formatChannelMention(config.channelId)}`,
        `Панель: ${config.panelMessageId ? `\`${config.panelMessageId}\`` : "не опубликована"}`,
        `Открыто миссий: **${openCount}**`,
        `Закрыто миссий: **${closedCount}**`,
        `Помощников в статистике: **${helperCount}**`,
        `Автоархив thread: **${config.missionAutoArchiveMinutes} мин**`,
        `Автозакрытие обычных миссий: **${config.missionAutoCloseMinutes} мин**`,
        "Клан-вар: без автооффа по idle-таймеру",
        `Пинг-система: **${formatAntiteamPingMode(config)}**`,
        `🧪 Тестовый режим: **${config.testMode ? "ВКЛ — миссии без пинга" : "выкл"}**`,
        `Roblox place id: ${config.roblox?.jjsPlaceId ? `\`${config.roblox.jjsPlaceId}\`` : "из общего конфига"}`,
      ].join("\n"))
    );

  if (statusText) {
    container.addTextDisplayComponents(buildText("Последнее действие", statusText));
  }

  container
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(buildText("Роли", [
      `Батальён: ${formatRoleMention(config.battalionRoleId)}`,
      `Доп. роли базового пинга: ${formatRoleMentionList(config.battalionPingRoleIds)}`,
      `Тихая роль: ${formatRoleMention(config.extraPingRoleId)}`,
      `Edit-test роли: ${formatRoleMentionList(config.editPingRoleIds)}`,
      `Глава батальона: ${formatRoleMention(config.battalionLeadRoleId)}`,
      `Уполномоченные на клан-вар: ${formatRoleMention(config.clanCallerRoleId)}`,
    ]))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(ANTITEAM_CUSTOM_IDS.publishPanel).setLabel("Опубликовать панель").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(ANTITEAM_CUSTOM_IDS.panelText).setLabel("Редактировать старт").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(ANTITEAM_CUSTOM_IDS.config).setLabel("Настройки").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(ANTITEAM_CUSTOM_IDS.configAdvanced).setLabel("Roblox/тайминги").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(ANTITEAM_CUSTOM_IDS.refreshPanel).setLabel("Обновить").setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(ANTITEAM_CUSTOM_IDS.pingConfig).setLabel("Пинг-система").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(ANTITEAM_CUSTOM_IDS.toggleTestMode)
          .setLabel(config.testMode ? "🧪 Тест: ВКЛ" : "🧪 Тест: выкл")
          .setStyle(config.testMode ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(ANTITEAM_CUSTOM_IDS.stats).setLabel("📊 Статистика помощи").setStyle(ButtonStyle.Secondary)
      )
    );

  return buildPayload(container, { ephemeral: true });
}

function statsButtonId(action, extra = "") {
  return ["at", "stats", action, extra].map((part) => cleanString(part, 80)).filter(Boolean).join(":").slice(0, 100);
}

function buildHelperStatsPayload(state = {}, page = 0, statusText = "", { confirmClear = false } = {}) {
  const config = createDefaultAntiteamConfig(state.config);
  const helpers = getHelperStatsEntries(state);
  const totalPoints = helpers.reduce((sum, helper) => sum + helper.points, 0);
  const rewardRows = ANTITEAM_HELPER_REWARD_THRESHOLDS.map((threshold) => {
    const roleId = config.helperRewardRoles?.[String(threshold)] || "";
    return `**${threshold}+**: ${formatRoleMention(roleId)}`;
  });
  const hasRewardRoles = ANTITEAM_HELPER_REWARD_THRESHOLDS.some((threshold) => cleanString(config.helperRewardRoles?.[String(threshold)], 80));
  const pageSize = 5;
  const totalPages = Math.max(1, Math.ceil(helpers.length / pageSize));
  const currentPage = Math.min(Math.max(Number.parseInt(page, 10) || 0, 0), totalPages - 1);
  const visibleHelpers = helpers.slice(currentPage * pageSize, currentPage * pageSize + pageSize);
  const container = new ContainerBuilder()
    .setAccentColor(confirmClear ? 0xC62828 : 0x1565C0)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("# 📊 Статистика помощи"),
      new TextDisplayBuilder().setContent([
        `Записей: **${helpers.length}** • очков: **${totalPoints}** • страница **${currentPage + 1}/${totalPages}**`,
        "Очки = подтверждённые приходы при закрытии миссии.",
        statusText,
        confirmClear ? "Подтверди полную очистку. История заявок не будет удалена." : "",
      ].filter(Boolean).join("\n"))
    );

  container.addTextDisplayComponents(buildText("Роли за очки помощи", rewardRows));

  if (!visibleHelpers.length) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent("Пока нет сохранённой статистики helper-ов."));
  }

  for (const helper of visibleHelpers) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
          `<@${helper.userId}>`,
          `Очки помощи: **${helper.points}**`,
          `Откликнулся: **${helper.responded}** • ссылки: **${helper.linkGranted}** • пришёл: **${helper.confirmedArrived}**`,
          helper.lastHelpedAt ? `Последняя активность: ${helper.lastHelpedAt}` : "",
        ].filter(Boolean).join("\n")))
        .setButtonAccessory(
          new ButtonBuilder()
            .setCustomId(statsButtonId("delete", `${helper.userId}:${currentPage}`))
            .setLabel("🗑️ Удалить")
            .setStyle(ButtonStyle.Danger)
        )
    );
  }

  if (totalPages > 1) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(statsButtonId("page", String(Math.max(0, currentPage - 1))))
          .setLabel("◀️ Назад")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(currentPage === 0),
        new ButtonBuilder()
          .setCustomId(statsButtonId("page", String(Math.min(totalPages - 1, currentPage + 1))))
          .setLabel("Вперёд ▶️")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(currentPage >= totalPages - 1)
      )
    );
  }

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(ANTITEAM_CUSTOM_IDS.refreshPanel).setLabel("↩️ В панель").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(ANTITEAM_CUSTOM_IDS.statsRoles).setLabel("🎖️ Роли").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(ANTITEAM_CUSTOM_IDS.statsSyncRoles)
        .setLabel("🔁 Выдать роли")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!helpers.length || !hasRewardRoles),
      new ButtonBuilder()
        .setCustomId(confirmClear ? ANTITEAM_CUSTOM_IDS.statsClearConfirm : ANTITEAM_CUSTOM_IDS.statsClear)
        .setLabel(confirmClear ? "🔥 Да, стереть всё" : "🧹 Очистить всё")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!helpers.length)
    )
  );

  return buildPayload(container, { ephemeral: true });
}

function buildHelperRewardRolesModal(config = createDefaultAntiteamConfig()) {
  const normalized = createDefaultAntiteamConfig(config);
  const rows = ANTITEAM_HELPER_REWARD_THRESHOLDS.map((threshold) => {
    const key = String(threshold);
    return new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId(`role_${key}`)
        .setLabel(`Роль за ${key}+ помощи`)
        .setPlaceholder("@role или id; пусто = не выдавать")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(80)
        .setValue(cleanString(normalized.helperRewardRoles?.[key], 80))
    );
  });
  return new ModalBuilder()
    .setCustomId("at:stats:roles_modal")
    .setTitle("Роли за помощь")
    .addComponents(...rows);
}

function buildPanelTextModal(config = createDefaultAntiteamConfig()) {
  const panel = createDefaultAntiteamConfig(config).panel;
  return new ModalBuilder()
    .setCustomId("at:panel_text:modal")
    .setTitle("Стартовая панель антитима")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("title")
          .setLabel("Заголовок")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(80)
          .setValue(cleanString(panel.title, 80))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("description")
          .setLabel("Главный текст")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(700)
          .setValue(cleanString(panel.description, 700))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("details")
          .setLabel("Нижняя строка/подсказка")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(700)
          .setValue(cleanString(panel.details, 700))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("button_label")
          .setLabel("Текст кнопки заявки")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(80)
          .setValue(cleanString(panel.buttonLabel, 80))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("accent_color")
          .setLabel("Цвет панели hex")
          .setPlaceholder("#E53935")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(10)
          .setValue(`#${Number(panel.accentColor || 0xE53935).toString(16).padStart(6, "0").toUpperCase()}`)
      )
    );
}

function buildRobloxUsernameModal({
  customId = "at:roblox",
  title = "Roblox не найден в профиле",
  label = "Roblox ник аккаунта",
  placeholder = "Например Builderman",
  initialValue = "",
} = {}) {
  const input = new TextInputBuilder()
    .setCustomId("roblox_username")
    .setLabel(cleanString(label, 45) || "Roblox ник")
    .setPlaceholder(cleanString(placeholder, 100) || "Например Builderman")
    .setStyle(TextInputStyle.Short)
    .setMinLength(3)
    .setMaxLength(20)
    .setRequired(true);
  const value = cleanString(initialValue, 20);
  if (value) input.setValue(value);

  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addComponents(
      new ActionRowBuilder().addComponents(input)
    );
}

// Modal for binding a twink/alt Roblox to one mission only. customId differs per
// surface: "at:twink_modal" on the setup panel, "at:change_roblox_modal:<id>" in
// a published ticket thread.
function buildTwinkRobloxModal({ customId = "at:twink_modal", initialValue = "" } = {}) {
  return buildRobloxUsernameModal({
    customId,
    title: "Другой Roblox на эту заявку",
    label: "Roblox ник твинка",
    placeholder: "Ник действующего аккаунта",
    initialValue,
  });
}

// Private confirmation step after a twink nick is found through the Roblox API.
// Lets the requester eyeball the account before it's attached to the mission.
function buildTwinkConfirmPayload(roblox = {}, { kind = "standard" } = {}) {
  const username = cleanString(roblox.username || roblox.name, 120) || "Roblox";
  const userId = cleanString(roblox.userId || roblox.id, 40);
  const profileUrl = cleanString(roblox.profileUrl, 500) || (userId ? `https://www.roblox.com/users/${userId}/profile` : "");
  const targetLine = kind === "clan"
    ? "Этот аккаунт будет показан как якорь ФАЙТ С КЛАНОМ."
    : kind === "kv"
      ? "Этот аккаунт будет показан как якорь КВ — по нему подключаются помощники."
      : "Этот аккаунт будет показан в заявке вместо основного.";
  const buttons = [
    new ButtonBuilder()
      .setCustomId(ANTITEAM_CUSTOM_IDS.twinkConfirm)
      .setLabel("✅ Привязать к заявке")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(ANTITEAM_CUSTOM_IDS.twinkCancel)
      .setLabel("✖️ Отмена")
      .setStyle(ButtonStyle.Secondary),
  ];
  if (profileUrl) {
    buttons.push(new ButtonBuilder().setLabel("👤 Профиль").setStyle(ButtonStyle.Link).setURL(profileUrl));
  }
  const container = new ContainerBuilder()
    .setAccentColor(0x6A1B9A)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("# 🎭 Проверь твинк"),
      new TextDisplayBuilder().setContent([
        `Аккаунт найден через Roblox API: **${username}**${userId ? ` (${userId})` : ""}.`,
        targetLine,
        "Основная привязка Roblox в твоём профиле **не изменится** — это только на эту заявку.",
      ].join("\n"))
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addActionRowComponents(new ActionRowBuilder().addComponents(...buttons.slice(0, 5)));
  return buildPayload(container, { ephemeral: true });
}

function buildConfigModal(config = createDefaultAntiteamConfig()) {
  const clanRolesText = config.clanPingRoles
    .map((entry) => `${entry.label}=${entry.roleId || ""}:${entry.defaultEnabled ? "on" : "off"}`)
    .join("\n")
    .slice(0, 1000);
  return new ModalBuilder()
    .setCustomId("at:config:modal")
    .setTitle("Antiteam настройки")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("channel_id")
          .setLabel("Канал антитима")
          .setPlaceholder("#channel или id")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(80)
          .setValue(config.channelId.slice(0, 80))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("battalion_role_id")
          .setLabel("Роль батальён")
          .setPlaceholder("@роль или id")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(80)
          .setValue(config.battalionRoleId.slice(0, 80))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("battalion_lead_role_id")
          .setLabel("Роль глава батальона")
          .setPlaceholder("@роль или id")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(80)
          .setValue(config.battalionLeadRoleId.slice(0, 80))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("clan_caller_role_id")
          .setLabel("Роль вызова клан-вара")
          .setPlaceholder("@роль или id")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(80)
          .setValue(config.clanCallerRoleId.slice(0, 80))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("clan_ping_roles")
          .setLabel("Клан ping роли: label=roleId:on/off")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(1000)
          .setValue(clanRolesText)
      )
    );
}

function buildPingConfigModal(config = createDefaultAntiteamConfig()) {
  const normalized = createDefaultAntiteamConfig(config);
  const modeValue = normalized.pingMode === "custom_role"
    ? "role"
    : normalized.pingMode === "edit_roles"
      ? "edit"
      : normalized.pingMode;
  return new ModalBuilder()
    .setCustomId("at:ping:config_modal")
    .setTitle("Пинг антитима")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("ping_mode")
          .setLabel("Режим: battalion / role / everyone / edit")
          .setPlaceholder("battalion, role, everyone или edit")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(40)
          .setValue(modeValue)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("extra_ping_role_id")
          .setLabel("Тихая роль для режима role")
          .setPlaceholder("@role или id; пусто = без доп. роли")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(80)
          .setValue(cleanString(normalized.extraPingRoleId, 80))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("battalion_ping_role_ids")
          .setLabel("Доп. роли базового пинга")
          .setPlaceholder("по одной роли/id на строку; основную роль сюда не нужно")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(1000)
          .setValue((normalized.battalionPingRoleIds || []).join("\n").slice(0, 1000))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("edit_ping_role_ids")
          .setLabel("Edit-test роли")
          .setPlaceholder("по одной роли/id на строку; ожидаемо около 5")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(1000)
          .setValue((normalized.editPingRoleIds || []).join("\n").slice(0, 1000))
      )
    );
}

function buildAdvancedConfigModal(config = createDefaultAntiteamConfig()) {
  return new ModalBuilder()
    .setCustomId("at:config_advanced:modal")
    .setTitle("Antiteam тайминги/Roblox")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("archive_minutes")
          .setLabel("Автоархив thread, минуты")
          .setPlaceholder("60, 1440, 4320 или 10080")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(6)
          .setValue(String(config.missionAutoArchiveMinutes || 60))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("close_minutes")
          .setLabel("Автозакрытие обычных миссий, минуты")
          .setPlaceholder("120; клан-вар не закрывается")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(6)
          .setValue(String(config.missionAutoCloseMinutes || 120))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("place_id")
          .setLabel("Roblox place id JJS")
          .setPlaceholder("Можно оставить пустым, если берётся из общего конфига")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(40)
          .setValue(cleanString(config.roblox?.jjsPlaceId, 40))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("direct_join_template")
          .setLabel("Direct join template")
          .setPlaceholder("https://www.roblox.com/games/start?placeId={placeId}&gameInstanceId={gameId}")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(500)
          .setValue(cleanString(config.roblox?.directJoinUrlTemplate, 500))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("friend_requests_url")
          .setLabel("Roblox friend requests URL")
          .setPlaceholder("https://www.roblox.com/users/friends#!/friend-requests")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(500)
          .setValue(cleanString(config.roblox?.friendRequestsUrl, 500))
      )
    );
}

function buildDescriptionModal(draft = {}, customId = "at:desc:modal") {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(draft.kind === "clan" ? `Описание: ${CLAN_WAR_LABEL}` : "Описание антитима")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("description")
          .setLabel(draft.kind === "clan" ? "Кто против нас и что происходит" : "Ники/киллы целей или ситуация")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(900)
          .setPlaceholder(draft.kind === "clan" ? "Клан, ники, кто точно держит сервер..." : "Кто тимится, сколько их, кого бить, ники/kills или любое понятное описание.")
          .setValue(cleanString(draft.description, 900))
      )
    );
}

function buildLevelSelect(draft = {}) {
  const isKv = draft.kind === "kv";
  const selected = normalizeAntiteamLevel(draft.level, "medium");
  const levelOptions = Object.values(ANTITEAM_LEVELS).map((level) => ({
    label: level.label,
    value: level.id,
    description: level.description.slice(0, 100),
    emoji: level.emoji,
    default: !isKv && level.id === selected,
  }));
  // 4th danger mode: КВ. Picking it switches the request into clan-war mode with
  // an admin-approved "возможно кв" gate (handled in the select interaction).
  levelOptions.push({
    label: KV_LEVEL_OPTION.label,
    value: KV_LEVEL_OPTION.id,
    description: KV_LEVEL_OPTION.description.slice(0, 100),
    emoji: KV_LEVEL_OPTION.emoji,
    default: isKv,
  });
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(ANTITEAM_CUSTOM_IDS.levelSelect)
      .setPlaceholder("Опасность тимеров")
      .addOptions(levelOptions)
  );
}

function buildCountSelect(draft = {}) {
  const selected = normalizeAntiteamCount(draft.count, "2-4");
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(ANTITEAM_CUSTOM_IDS.countSelect)
      .setPlaceholder("Примерное число тимеров")
      .addOptions(Object.values(ANTITEAM_COUNTS).map((count) => ({
        label: count.label,
        value: count.id,
        description: count.description,
        default: count.id === selected,
      })))
  );
}

function buildClanRolesSelect(draft = {}, config = createDefaultAntiteamConfig()) {
  const selected = new Set(Array.isArray(draft.selectedClanPingKeys) ? draft.selectedClanPingKeys : []);
  const options = config.clanPingRoles.map((entry) => ({
    label: entry.label,
    value: entry.key,
    description: entry.roleId ? `Пинг ${entry.roleId}` : "Роль пока не настроена",
    default: selected.has(entry.key),
  }));
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(ANTITEAM_CUSTOM_IDS.clanRolesSelect)
      .setPlaceholder("Кого пинговать")
      .setMinValues(0)
      .setMaxValues(Math.max(1, options.length))
      .addOptions(options)
  );
}

function getDraftRobloxLine(draft = {}, statusText = "") {
  const robloxLabel = `Roblox: **${draft.roblox?.username || "—"}**${draft.roblox?.userId ? ` (${draft.roblox.userId})` : ""}`;
  if (draft.robloxTemporary) return `${robloxLabel} • 🎭 твинк на эту заявку`;
  const status = cleanString(statusText, 240);
  if (/взят из твоего профиля/i.test(status)) return `${robloxLabel} • взят из профиля`;
  if (/подтвержд[её]н|найден через API/i.test(status)) return `${robloxLabel} • подтверждён`;
  if (/готов/i.test(status)) return `${robloxLabel} • готов`;
  return robloxLabel;
}

function buildDraftDescriptionRow(draft = {}) {
  const hasDescription = Boolean(cleanString(draft.description, 900));
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(ANTITEAM_CUSTOM_IDS.editDescription)
      .setLabel(hasDescription ? "📝 Изменить описание" : "📝 Заполнить описание")
      .setStyle(hasDescription ? ButtonStyle.Secondary : ButtonStyle.Primary)
  );
}

function buildDraftSettingsSections(draft = {}) {
  return [
    new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent([
        "**Вход без друзей**",
        "Ставь «есть», если Roblox разрешает подключаться к тебе без добавления в друзья.",
      ].join("\n")))
      .setButtonAccessory(
        new ButtonBuilder()
          .setCustomId(ANTITEAM_CUSTOM_IDS.toggleDirect)
          .setLabel(draft.directJoinEnabled ? "🔓 Есть" : "🔒 Нету")
          .setStyle(draft.directJoinEnabled ? ButtonStyle.Success : ButtonStyle.Secondary)
      ),
    new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent([
        "**Фото к заявке**",
        "При «есть» бот попросит следующим сообщением отправить один или несколько скринов.",
      ].join("\n")))
      .setButtonAccessory(
        new ButtonBuilder()
          .setCustomId(ANTITEAM_CUSTOM_IDS.togglePhoto)
          .setLabel(draft.photoWanted ? "📸 Есть" : "🖼️ Нету")
          .setStyle(draft.photoWanted ? ButtonStyle.Success : ButtonStyle.Secondary)
      ),
  ];
}

function buildDraftSubmitRow(draft = {}) {
  const hasDescription = Boolean(cleanString(draft.description, 900));
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(ANTITEAM_CUSTOM_IDS.submitDraft)
      .setLabel(draft.photoWanted ? "📸 Дальше к фото" : "🚀 Отправить заявку")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!hasDescription),
    new ButtonBuilder()
      .setCustomId(ANTITEAM_CUSTOM_IDS.cancelDraft)
      .setLabel("✖️ Отменить")
      .setStyle(ButtonStyle.Secondary)
  );
}

function buildKvAnchorLine(draft = {}, statusText = "") {
  if (!cleanString(draft.anchorUserId, 80)) {
    return "⚓ Якорь не указан — нажми «Указать якоря» ниже.";
  }
  return `⚓ Якорь: <@${draft.anchorUserId}> • ${getDraftRobloxLine(draft, statusText)}`;
}

function buildKvSetupPayload(draft = {}, config = createDefaultAntiteamConfig(), statusText = "") {
  const targets = formatKvApprovalTargets(config);
  const hasAnchor = Boolean(cleanString(draft.anchorUserId, 80));
  const hasNote = Boolean(cleanString(draft.anchorNote, 700));
  const hasRoblox = Boolean(cleanString(draft.roblox?.userId, 40));
  const ready = hasAnchor && hasNote && hasRoblox;
  const container = new ContainerBuilder()
    .setAccentColor(KV_PENDING_ACCENT_COLOR)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# 🟪 ${KV_PENDING_LABEL}`),
      new TextDisplayBuilder().setContent([
        buildKvAnchorLine(draft, statusText),
        `Уйдёт как «возможно кв»: пинг только ${targets.mention}. Админы могут НЕ одобрить — тогда заявка закроется без отметок.`,
        statusText && !/roblox (взят|подтвержд|найден|готов)/i.test(cleanString(statusText, 240)) ? statusText : "",
      ].filter(Boolean).join("\n"))
    );

  // Anchor + reason live together: a single modal collects who the anchor is and
  // why they matter (people will keep joining them, so they must not leave).
  container.addActionRowComponents(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(ANTITEAM_CUSTOM_IDS.kvAnchor)
      .setLabel(hasAnchor ? "⚓ Изменить якоря и причину" : "⚓ Указать якоря и почему он важен")
      .setStyle(hasAnchor && hasNote ? ButtonStyle.Secondary : ButtonStyle.Primary)
  ));

  container
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      "**Кто якорь и почему он важен**",
      cleanString(draft.anchorNote, 700) || "Опиши якоря: кто это, почему на него будут стабильно заходить и почему он не ливнёт.",
    ].join("\n")));

  // Anchor Roblox — helpers connect through it, so it is mandatory before submit.
  container
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      "**Roblox якоря**",
      hasRoblox
        ? `Roblox: **${cleanString(draft.roblox?.username, 120) || "—"}** — помощники подключаются по нему.`
        : "Укажи действующий Roblox якоря — без него помощники не подключатся.",
    ].join("\n")))
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(ANTITEAM_CUSTOM_IDS.twinkOpen)
        .setLabel(hasRoblox ? "🎭 Сменить Roblox якоря" : "🎭 Указать Roblox якоря")
        .setStyle(hasRoblox ? ButtonStyle.Success : ButtonStyle.Primary)
    ));

  {
    const link = cleanString(draft.manualDirectJoinUrl, 2000);
    container
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent([
        "**🔗 Прямая ссылка (необязательно)**",
        link
          ? "Прямая ссылка добавлена ✅ — помощники смогут зайти к якорю по ней."
          : "Необязательно: вставь прямую ссылку подключения к якорю.",
      ].join("\n")))
      .addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(ANTITEAM_CUSTOM_IDS.setDirectLink)
          .setLabel(link ? "🔗 Изменить ссылку" : "🔗 Вставить ссылку")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(ANTITEAM_CUSTOM_IDS.directLinkGuide)
          .setLabel("❓ Где взять ссылку")
          .setStyle(ButtonStyle.Secondary)
      ));
  }

  container
    .addSeparatorComponents(new SeparatorBuilder().setDivider(false))
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(ANTITEAM_CUSTOM_IDS.submitDraft)
        .setLabel("🟪 Отправить «возможно кв»")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!ready),
      new ButtonBuilder()
        .setCustomId(ANTITEAM_CUSTOM_IDS.cancelDraft)
        .setLabel("✖️ Отменить")
        .setStyle(ButtonStyle.Secondary)
    ));
  return buildPayload(container, { ephemeral: true });
}

function buildTicketSetupPayload(draft = {}, config = createDefaultAntiteamConfig(), statusText = "") {
  if (draft.kind === "kv") return buildKvSetupPayload(draft, config, statusText);
  const isClan = draft.kind === "clan";
  const level = getLevelMeta(draft.level);
  const count = getCountMeta(draft.count);
  const container = new ContainerBuilder()
    .setAccentColor(isClan ? CLAN_WAR_ACCENT_COLOR : level.accentColor)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(isClan ? `# 🟣 ${CLAN_WAR_LABEL}` : "# Заявка антитима"),
      new TextDisplayBuilder().setContent([
        isClan && draft.anchorUserId
          ? `Якорь: <@${draft.anchorUserId}> • ${getDraftRobloxLine(draft, statusText)}`
          : getDraftRobloxLine(draft, statusText),
        isClan ? `${CLAN_WAR_LABEL}: якорь не должен выходить с сервера. По нему будут подключаться помощники.` : `${level.emoji} **${level.label}** • ${count.label} тимеров`,
        statusText && !/roblox (взят|подтвержд|найден|готов)/i.test(cleanString(statusText, 240)) ? statusText : "",
      ].filter(Boolean).join("\n"))
    );

  if (isClan) {
    container.addActionRowComponents(buildClanRolesSelect(draft, config));
  } else {
    container.addActionRowComponents(buildLevelSelect(draft), buildCountSelect(draft));
  }

  // Twink / alt Roblox just for this mission — handy for players whose main isn't
  // online. It only changes the account shown on the mission, never the profile.
  container.addActionRowComponents(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(ANTITEAM_CUSTOM_IDS.twinkOpen)
      .setLabel(draft.robloxTemporary ? "🎭 Сменить твинк заявки" : "🎭 Другой Roblox на эту заявку")
      .setStyle(draft.robloxTemporary ? ButtonStyle.Success : ButtonStyle.Secondary)
  ));

  container
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      "**Описание обязательно**",
      draft.description || "Опиши, кто тимится, что происходит и кого бить: ники, kills, место или любой понятный метод.",
    ].join("\n")))
    .addActionRowComponents(buildDraftDescriptionRow(draft));

  // Optional direct connect link — its OWN option, fully separate from the lock.
  // Always visible (clan war included); if left empty it simply isn't offered to
  // helpers, who then fall back to a friend request.
  {
    const link = cleanString(draft.manualDirectJoinUrl, 2000);
    const joinTarget = isClan ? "к якорю" : "к тебе";
    container
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent([
        "**🔗 Добавить прямую ссылку**",
        link
          ? `Прямая ссылка добавлена ✅ — помощники смогут зайти ${joinTarget} по ней. Можно изменить.`
          : `Необязательно: вставь прямую ссылку подключения — помощники смогут зайти ${joinTarget} по ней. Не добавишь — её просто не будет.`,
      ].join("\n")))
      .addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(ANTITEAM_CUSTOM_IDS.setDirectLink)
          .setLabel(link ? "🔗 Изменить ссылку" : "🔗 Вставить ссылку")
          .setStyle(link ? ButtonStyle.Secondary : ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(ANTITEAM_CUSTOM_IDS.directLinkGuide)
          .setLabel("❓ Где взять ссылку")
          .setStyle(ButtonStyle.Secondary)
      ));
  }

  container
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addSectionComponents(...buildDraftSettingsSections(draft))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(false))
    .addActionRowComponents(buildDraftSubmitRow(draft));
  return buildPayload(container, { ephemeral: true });
}

function buildPhotoRequestPayload(draft = {}, statusText = "") {
  const container = new ContainerBuilder()
    .setAccentColor(0x1565C0)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("# Фото к заявке"),
      new TextDisplayBuilder().setContent([
        "Отправь следующим сообщением в антитим-канал один или несколько скринов.",
        "Можно кинуть несколько изображений сразу одним сообщением. Бот прикрепит их к заявке и удалит исходное сообщение.",
        "⚠️ Пока ждём фото, любое твоё сообщение без картинки в этом канале бот удалит — кидай именно изображение.",
        statusText,
      ].filter(Boolean).join("\n"))
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(ANTITEAM_CUSTOM_IDS.submitWithoutPhoto).setLabel("Отправить без фото").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(ANTITEAM_CUSTOM_IDS.cancelDraft).setLabel("Отменить").setStyle(ButtonStyle.Secondary)
      )
    );
  return buildPayload(container, { ephemeral: true });
}

function buildTicketTitle(ticket = {}) {
  const isClosed = ticket.status === "closed" || ticket.status === "cancelled";
  const testPrefix = ticket.test ? "🧪 ТЕСТ • " : "";
  if (ticket.kind === "kv") {
    if (isKvPending(ticket)) return `${testPrefix}🟪 ${KV_PENDING_LABEL}`;
    return `${testPrefix}${isClosed ? "⚫" : "🟪"} ${KV_LABEL}`;
  }
  if (ticket.kind === "clan") return `${testPrefix}${isClosed ? "⚫" : "🟣"} ${CLAN_WAR_LABEL}`;
  return `${testPrefix}${isClosed ? "⚫ Завершено" : `${getLevelMeta(ticket.level).emoji} Нужна помощь`} • ${formatCountHeadline(ticket.count)}`;
}

function buildThreadName(ticket = {}) {
  const isClosed = ticket.status === "closed" || ticket.status === "cancelled";
  const testPrefix = ticket.test ? "🧪 ТЕСТ " : "";
  if (ticket.kind === "kv") {
    if (isKvPending(ticket)) return `${testPrefix}🟪 ${KV_PENDING_LABEL}`;
    return `${testPrefix}${isClosed ? "⚫" : "🟪"} ${KV_LABEL}`;
  }
  if (ticket.kind === "clan") return `${testPrefix}${isClosed ? "⚫" : "🟣"} ${CLAN_WAR_LABEL}`;
  return `${testPrefix}${isClosed ? "⚫" : getLevelMeta(ticket.level).emoji} ${formatCountHeadline(ticket.count)} • ${formatRequesterName(ticket)}`;
}

function formatPublicRobloxLink(ticket = {}) {
  const profileUrl = cleanString(ticket.roblox?.profileUrl, 500)
    || (ticket.roblox?.userId ? `https://www.roblox.com/users/${ticket.roblox.userId}/profile` : "");
  const username = cleanString(ticket.roblox?.username, 120);
  if (!username) return "**—**";
  return `**${username}**${profileUrl ? ` ([профиль](${profileUrl}))` : ""}`;
}

function formatPublicDifficulty(ticket = {}) {
  const isClosed = ticket.status === "closed";
  const level = getLevelMeta(ticket.level);
  const descriptions = {
    low: "почти вся команда до ~2k kills.",
    medium: "команда в основном 2k-8k kills.",
    high: "8k+ kills у заметной части команды.",
  };
  return `${isClosed ? "⚫" : level.emoji} **${level.label}**: ${descriptions[level.id] || level.description}`;
}

function buildDiscordChannelUrl(guildId = "", channelId = "", messageId = "") {
  const normalizedGuildId = cleanString(guildId, 80);
  const normalizedChannelId = cleanString(channelId, 80);
  const normalizedMessageId = cleanString(messageId, 80);
  if (!normalizedGuildId || !normalizedChannelId) return "";
  return normalizedMessageId
    ? `https://discord.com/channels/${normalizedGuildId}/${normalizedChannelId}/${normalizedMessageId}`
    : `https://discord.com/channels/${normalizedGuildId}/${normalizedChannelId}`;
}

function buildPublicHelpJumpUrl(ticket = {}) {
  const guildId = cleanString(ticket.message?.guildId, 80);
  const threadId = cleanString(ticket.message?.threadId, 80);
  const threadPanelMessageId = cleanString(ticket.message?.threadPanelMessageId, 80);
  if (!guildId || !threadId) return "";
  return buildDiscordChannelUrl(guildId, threadId, threadPanelMessageId);
}

function normalizeHelperIdSet(values = []) {
  return new Set((Array.isArray(values) ? values : [])
    .map((value) => cleanString(value, 80))
    .filter(Boolean));
}

function didHelperArrive(helper = {}, options = {}) {
  const confirmedHelperIds = options.confirmedHelperIds instanceof Set
    ? options.confirmedHelperIds
    : normalizeHelperIdSet(options.confirmedHelperIds);
  const userId = cleanString(helper.userId, 80);
  if (confirmedHelperIds.size && userId) return confirmedHelperIds.has(userId);
  return helper?.arrived !== false;
}

function formatHelpersBlock(ticket = {}, options = {}) {
  const helpers = Object.values(ticket.helpers || {})
    .sort((left, right) => String(left.respondedAt || "").localeCompare(String(right.respondedAt || "")) || String(left.userId || "").localeCompare(String(right.userId || "")));
  const confirmedHelperIds = normalizeHelperIdSet(ticket.closeSummary?.confirmedHelperIds);
  const confirmed = helpers.filter((helper) => didHelperArrive(helper, { confirmedHelperIds }));
  const apiPresentIds = normalizeHelperIdSet(options.apiPresentHelperIds);
  const apiPresentCount = helpers.filter((helper) => apiPresentIds.has(cleanString(helper.userId, 80))).length;
  const isClosed = ticket.status === "closed";
  if (!helpers.length) return "Пока никто не отозвался.";
  // Show everyone who responded — no "+N" collapse. A high cap stays only to
  // avoid blowing past Discord's text-component limit on absurd counts.
  const HELPER_DISPLAY_CAP = 60;
  const helperLine = helpers.slice(0, HELPER_DISPLAY_CAP)
    .map((helper) => {
      // Show the Roblox nick next to the closed ✅/❌ so it matches the
      // close-review buttons (which also show the nick) — reviewers were thrown
      // off when the mention rendered a different name than the button label.
      const nick = cleanString(helper.robloxUsername, 40);
      return isClosed
        ? `${didHelperArrive(helper, { confirmedHelperIds }) ? "✅" : "❌"} <@${helper.userId}>${nick ? ` (${nick})` : ""}`
        : `<@${helper.userId}>`;
    })
    .join(" • ");
  const overflow = helpers.length > HELPER_DISPLAY_CAP ? ` +${helpers.length - HELPER_DISPLAY_CAP}` : "";
  const responseLine = isClosed
    ? `Откликнулись: **${helpers.length}** • пришли: **${confirmed.length}**`
    : `Откликнулись: **${helpers.length}**${apiPresentCount > 0 ? ` (API в игре: **${apiPresentCount}**)` : ""}`;
  return [
    responseLine,
    `${helperLine}${overflow}`,
    ticket.closeSummary?.text ? `Итог: ${ticket.closeSummary.text}` : "",
  ].filter(Boolean).join("\n");
}

function buildTicketPublicPayload(ticket = {}, config = createDefaultAntiteamConfig(), options = {}) {
  const isClosed = ticket.status === "closed" || ticket.status === "cancelled";
  const isClan = ticket.kind === "clan";
  const isKv = ticket.kind === "kv";
  const isPending = isKvPending(ticket);
  const isAnchored = isClan || isKv;
  const level = getLevelMeta(ticket.level);
  const authorLine = isAnchored && ticket.anchorUserId
    ? `Попросил 👤 <@${ticket.createdBy}> • Якорь <@${ticket.anchorUserId}> • ${formatPublicRobloxLink(ticket)}`
    : `Попросил 👤 <@${ticket.createdBy}> • ${formatPublicRobloxLink(ticket)}`;
  let dangerText;
  if (isKv) {
    dangerText = isPending
      ? `🟪 **${KV_PENDING_LABEL}**: ждём решения админов. Могут НЕ одобрить — тогда заявка закроется без отметок.`
      : `🟪 **${KV_LABEL}**: якорь должен оставаться в игре до конца. По нему подключаются помощники.`;
  } else if (isClan) {
    dangerText = `🟣 **${CLAN_WAR_LABEL}**: якорь должен оставаться в игре до завершения тревоги.`;
  } else {
    dangerText = formatPublicDifficulty(ticket);
  }
  // Direct-join shown as a bare lock emoji only (🔓 open / 🔒 closed); the
  // open/closed status text is dropped — the title already says Завершено/Нужна
  // помощь and the card greys out when done.
  const directEmoji = ticket.directJoinEnabled ? "🔓" : "🔒";
  const avatarUrl = cleanString(ticket.roblox?.avatarUrl, 1000);
  const titleDisplay = new TextDisplayBuilder().setContent(`# ${buildTicketTitle(ticket)}`);
  const infoDisplay = new TextDisplayBuilder().setContent(joinContentLines([
    authorLine,
    `${dangerText} ${directEmoji}`,
  ], "—", 1400));
  const kvAccent = isPending ? KV_PENDING_ACCENT_COLOR : KV_ACCENT_COLOR;
  const container = new ContainerBuilder()
    .setAccentColor(isClosed ? 0x607D8B : isKv ? kvAccent : isClan ? CLAN_WAR_ACCENT_COLOR : level.accentColor);
  if (avatarUrl) {
    // Roblox avatar on the right of the header (same URL-thumbnail pattern as the
    // profile card — Discord fetches the URL itself, no bot-side download).
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(titleDisplay, infoDisplay)
        .setThumbnailAccessory(
          new ThumbnailBuilder()
            .setURL(avatarUrl)
            .setDescription(`Аватар Roblox ${cleanString(ticket.roblox?.username, 80) || "автора"}`)
        )
    );
  } else {
    container.addTextDisplayComponents(titleDisplay, infoDisplay);
  }
  const descHeading = isKv ? "Кто якорь и почему важен" : "Описание";
  const descBody = isKv
    ? buildQuotedDescription(ticket.anchorNote || ticket.description, "якорь не описан")
    : buildQuotedDescription(ticket.description);
  container
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${descHeading}\n${descBody}`));
  if (isPending) {
    container
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        "### Статус\nПомощь откроется только после одобрения админами. Если отклонят — заявка закроется без отметок."));
  } else {
    container
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### Помощники\n${formatHelpersBlock(ticket, options)}`));
  }

  const photos = getTicketPhotos(ticket);
  const shouldAttachPhoto = options.attachPhoto === true && photos.length > 0;
  const photoAttachmentNames = getPhotoAttachmentNames(ticket, photos);
  if (photos.length) {
    const storedAttachmentCount = Array.isArray(ticket.message?.photoAttachmentNames)
      ? ticket.message.photoAttachmentNames.map((name) => cleanString(name, 180)).filter(Boolean).length
      : cleanString(ticket.message?.photoAttachmentName, 180) ? 1 : 0;
    const hasStoredAttachments = storedAttachmentCount >= photos.length;
    const media = new MediaGalleryBuilder().addItems(...photos.map((photo, index) => {
      const url = cleanString(photo.url, 2000);
      const attachmentName = photoAttachmentNames[index];
      return new MediaGalleryItemBuilder()
        .setURL(shouldAttachPhoto || hasStoredAttachments ? `attachment://${attachmentName}` : url)
        .setDescription(photos.length > 1 ? `Скрин антитима ${index + 1}` : "Скрин антитима");
    }));
    container
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
      .addMediaGalleryComponents(media);
  }

  const publicHelpJumpUrl = (isClosed || isPending) ? "" : buildPublicHelpJumpUrl(ticket);
  const payload = buildPayload(container, {
    extraComponents: publicHelpJumpUrl ? [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel("🙋 Прийти на помощь")
          .setStyle(ButtonStyle.Link)
          .setURL(publicHelpJumpUrl)
      ),
    ] : [],
  });
  if (shouldAttachPhoto) {
    payload.files = photos.map((photo, index) => ({
      attachment: cleanString(photo.url, 2000),
      name: photoAttachmentNames[index],
    }));
  }
  return payload;
}

function ticketButtonId(action, ticketId, extra = "") {
  return ["at", action, ticketId, extra].map((part) => cleanString(part, 80)).filter(Boolean).join(":").slice(0, 100);
}

function buildKvApprovalPanelPayload(ticket = {}) {
  // The "возможно кв" review panel: admins approve (open + ping edit-test) or
  // reject (close, nobody marked). Author can still fix the anchor link/Roblox.
  const hasDirectLink = Boolean(cleanString(ticket.manualDirectJoinUrl, 2000));
  return {
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(ticketButtonId("kv_approve", ticket.id))
          .setLabel("✅ Одобрить КВ")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(ticketButtonId("kv_reject", ticket.id))
          .setLabel("🚫 Отклонить")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(ticketButtonId("report", ticket.id))
          .setLabel("⚠️ Пожаловаться")
          .setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(ticketButtonId("set_direct_link", ticket.id))
          .setLabel(hasDirectLink ? "🔗 Изменить ссылку" : "🔗 Добавить ссылку")
          .setStyle(hasDirectLink ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(ticketButtonId("change_roblox", ticket.id))
          .setLabel("🎭 Сменить якорь-Roblox")
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
  };
}

function buildThreadPanelPayload(ticket = {}, config = createDefaultAntiteamConfig()) {
  if (isKvPending(ticket)) return buildKvApprovalPanelPayload(ticket);
  const isClosed = ticket.status === "closed" || ticket.status === "cancelled";
  const autoCloseMinutes = Math.max(1, Number.parseInt(config?.missionAutoCloseMinutes, 10) || 120);
  const autoCloseEnabled = ticket.autoCloseEnabled !== false;
  const isAnchored = ticket.kind === "clan" || ticket.kind === "kv";
  const components = [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(ticketButtonId("help", ticket.id))
      .setLabel("🙋 Помочь")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(isClosed),
    new ButtonBuilder()
      .setCustomId(ticketButtonId("toggle_direct", ticket.id))
      .setLabel(ticket.directJoinEnabled ? "🔓 Вход без др: есть" : "🔒 Вход без др: нет")
      .setStyle(ticket.directJoinEnabled ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(isClosed),
    new ButtonBuilder()
      .setCustomId(ticketButtonId("report", ticket.id))
      .setLabel("⚠️ Пожаловаться")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(isClosed),
    new ButtonBuilder()
      .setCustomId(ticketButtonId("close", ticket.id))
      .setLabel(isClosed ? "✅ Закрыто" : "✅ Завершить")
      .setStyle(ButtonStyle.Success)
      .setDisabled(isClosed)
  )];

  const hasDirectLink = Boolean(cleanString(ticket.manualDirectJoinUrl, 2000));
  const secondRow = new ActionRowBuilder();
  // Auto-close toggle is meaningless for clan war / KV (no idle auto-close).
  if (!isAnchored) {
    secondRow.addComponents(
      new ButtonBuilder()
        .setCustomId(ticketButtonId("toggle_auto_close", ticket.id))
        .setLabel(autoCloseEnabled ? `⏱ Закрывать через ${autoCloseMinutes} мин` : "⏸ Не закрывать автоматически")
        .setStyle(autoCloseEnabled ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setDisabled(isClosed)
    );
  }
  // Direct link + on-the-spot Roblox/twink swap — now available for clan war too,
  // so the anti-clan flow has parity with regular antiteam.
  secondRow.addComponents(
    new ButtonBuilder()
      .setCustomId(ticketButtonId("set_direct_link", ticket.id))
      .setLabel(hasDirectLink ? "🔗 Изменить ссылку" : "🔗 Добавить ссылку")
      .setStyle(hasDirectLink ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(isClosed),
    new ButtonBuilder()
      .setCustomId(ticketButtonId("change_roblox", ticket.id))
      .setLabel(isAnchored ? "🎭 Сменить якорь-Roblox" : "🎭 Сменить Roblox")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(isClosed)
  );
  components.push(secondRow);

  return {
    components,
  };
}

function buildHelpReplyPayload({
  ticket = {},
  linkKind = "",
  directJoinUrl = "",
  profileUrl = "",
  friendRequestsUrl = "",
  bridgeLabel = "",
  helperRobloxKnown = true,
  friendRequestNotified = false,
} = {}) {
  const lines = [];
  const targetLabel = (ticket.kind === "clan" || ticket.kind === "kv") ? "якоря" : "автора";
  if (linkKind === "direct") {
    lines.push("Прямой вход включён. Можно подключаться сразу.");
  } else if (linkKind === "friend_direct") {
    lines.push(`Ты уже Roblox-друг ${targetLabel}. Можно подключаться напрямую.`);
  } else if (linkKind === "bridge_direct") {
    lines.push(`Автор сейчас в игре с твоим Roblox-другом${bridgeLabel ? `: **${bridgeLabel}**` : ""}. Можно подключиться через него.`);
  }

  if (linkKind === "direct" || linkKind === "friend_direct" || linkKind === "bridge_direct") {
    if (directJoinUrl) lines.push(`[Прямая ссылка подключения](${directJoinUrl})`);
    if (profileUrl) lines.push(`[Roblox профиль ${targetLabel}](${profileUrl})`);
    if (directJoinUrl && profileUrl) lines.push("Если подключение не работает, открой профиль и нажми **Join**.");
  } else {
    lines.push(helperRobloxKnown
      ? `Открой профиль ${targetLabel} ниже и кинь friend request.`
      : `Roblox у тебя не привязан — бот не знает, друзья ли вы с ${targetLabel}. Открой профиль ниже и кинь заявку.`);
    if (directJoinUrl) lines.push(`[Прямая ссылка](${directJoinUrl}) заработает после добавления в друзья.`);
    lines.push(friendRequestNotified
      ? "Автор уже получил пинг в ветке."
      : "Добавился — жми кнопку ниже, чтобы автор принял.");
  }

  const container = new ContainerBuilder()
    .setAccentColor(0x1565C0)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("# Помощь принята"),
      new TextDisplayBuilder().setContent(lines.join("\n"))
    );

  const buttons = [];
  if (directJoinUrl) {
    buttons.push(new ButtonBuilder().setLabel("🔗 Подключиться").setStyle(ButtonStyle.Link).setURL(directJoinUrl));
  }
  if (profileUrl) {
    buttons.push(new ButtonBuilder().setLabel("👤 Профиль").setStyle(ButtonStyle.Link).setURL(profileUrl));
  }
  if (linkKind === "friend_request") {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(ticketButtonId("friend_request_sent", ticket.id))
        .setLabel(friendRequestNotified ? "📨 Автор уже пингован" : "📨 Отправил др, пусть примет")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(friendRequestNotified)
    );
  }
  if (buttons.length) container.addActionRowComponents(new ActionRowBuilder().addComponents(...buttons.slice(0, 5)));
  return buildPayload(container, { ephemeral: true });
}

function buildReportModal(ticketId) {
  return new ModalBuilder()
    .setCustomId(ticketButtonId("report_modal", ticketId))
    .setTitle("Жалоба на антитим")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("reason")
          .setLabel("Что не так")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(900)
      )
    );
}

function buildCloseSummaryModal(ticketId) {
  return new ModalBuilder()
    .setCustomId(ticketButtonId("close_modal", ticketId))
    .setTitle("Итог антитима")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("summary")
          .setLabel("Как закончилось, необязательно")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(1200)
      )
    );
}

function buildKvAnchorModal(draft = {}) {
  return new ModalBuilder()
    .setCustomId("at:kv_anchor:modal")
    .setTitle("Якорь КВ")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("anchor")
          .setLabel("Якорь: @упоминание или ID")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(80)
          .setValue(cleanString(draft?.anchorUserId, 80))
          .setPlaceholder("Например 1011666449963688027 или @ник")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("anchor_note")
          .setLabel("Кто это и почему он важен")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(700)
          .setValue(cleanString(draft?.anchorNote, 700))
          .setPlaceholder("Кто якорь, почему на него будут стабильно заходить и почему он не должен ливать.")
      )
    );
}

function buildDirectLinkModal(draft = {}) {
  return new ModalBuilder()
    .setCustomId("at:direct_link:modal")
    .setTitle("Прямая ссылка подключения")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("direct_link")
          .setLabel("Прямая ссылка подключения")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(2000)
          .setValue(cleanString(draft?.manualDirectJoinUrl, 2000))
          .setPlaceholder("Вставь ссылку (Ctrl+V) и нажми отправить")
      )
    );
}

function buildTicketDirectLinkModal(ticket = {}) {
  return new ModalBuilder()
    .setCustomId(ticketButtonId("direct_link_modal", ticket.id))
    .setTitle("Прямая ссылка подключения")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("direct_link")
          .setLabel("Прямая ссылка подключения")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(2000)
          .setValue(cleanString(ticket?.manualDirectJoinUrl, 2000))
          .setPlaceholder("Вставь ссылку (Ctrl+V) и нажми отправить")
      )
    );
}

// On-the-spot Roblox/twink swap from inside a published ticket thread.
function buildTicketRobloxModal(ticket = {}) {
  return buildRobloxUsernameModal({
    customId: ticketButtonId("change_roblox_modal", ticket.id),
    title: ticket.kind === "clan" ? "Сменить якорь-Roblox" : "Сменить Roblox заявки",
    label: "Действующий Roblox ник",
    placeholder: "Ник аккаунта",
    initialValue: cleanString(ticket.roblox?.username, 20),
  });
}

function buildCloseReviewPayload(ticket = {}, page = 0, options = {}) {
  const helpers = Object.values(ticket.helpers || {})
    .sort((left, right) => String(left.respondedAt || "").localeCompare(String(right.respondedAt || "")) || String(left.userId || "").localeCompare(String(right.userId || "")));
  // Arrived state comes from the live (in-memory) close session when provided,
  // so toggles don't touch the database — DB is written once on "Записать итог".
  const arrivedOverride = options.arrivedByUserId && typeof options.arrivedByUserId === "object"
    ? options.arrivedByUserId
    : null;
  const isArrived = (helper) => {
    const uid = cleanString(helper.userId, 80);
    if (arrivedOverride && Object.prototype.hasOwnProperty.call(arrivedOverride, uid)) {
      return Boolean(arrivedOverride[uid]);
    }
    return didHelperArrive(helper);
  };
  const pageSize = 5;
  const totalPages = Math.max(1, Math.ceil(helpers.length / pageSize));
  const currentPage = Math.min(Math.max(Number.parseInt(page, 10) || 0, 0), totalPages - 1);
  const visibleHelpers = helpers.slice(currentPage * pageSize, currentPage * pageSize + pageSize);
  const arrivedCount = helpers.filter((helper) => isArrived(helper)).length;
  const container = new ContainerBuilder()
    .setAccentColor(0x1565C0)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("# Завершение антитима"),
      new TextDisplayBuilder().setContent(helpers.length
        ? "Зелёная кнопка = пришёл, серая = не пришёл. По умолчанию все отмечены как пришёл — переведи в серый тех, кто не пришёл. «Записать итог» сохранит результат."
        : "Пока никто не получал ссылки помощи. Можно закрыть без отметок."),
      new TextDisplayBuilder().setContent(`Страница **${currentPage + 1}/${totalPages}** • откликнулось: **${helpers.length}** • пришло: **${arrivedCount}**`)
    );

  for (const helper of visibleHelpers) {
    const arrived = isArrived(helper);
    const nick = cleanString(helper.robloxUsername, 40);
    // Prefer the server display name so the button reads like the public <@id>
    // mention; the Roblox nick is the shared anchor between the two views.
    const name = cleanString(helper.displayName || helper.discordTag || helper.userId, 60);
    const label = `${arrived ? "Пришёл" : "Не пришёл"} • ${name}${nick ? ` (${nick})` : ""}`.slice(0, 80);
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(ticketButtonId("arrived", ticket.id, `${helper.userId}:${currentPage}`))
          .setLabel(label)
          .setStyle(arrived ? ButtonStyle.Success : ButtonStyle.Secondary)
      )
    );
  }

  if (helpers.length) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(ticketButtonId("mark_all", ticket.id, String(currentPage)))
          .setLabel("✅ Отметить всех")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(ticketButtonId("unmark_all", ticket.id, String(currentPage)))
          .setLabel("⬜ Отменить всех")
          .setStyle(ButtonStyle.Secondary)
      )
    );
  }

  if (totalPages > 1) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(ticketButtonId("close_page", ticket.id, String(Math.max(0, currentPage - 1))))
          .setLabel("Назад")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(currentPage === 0),
        new ButtonBuilder()
          .setCustomId(ticketButtonId("close_page", ticket.id, String(Math.min(totalPages - 1, currentPage + 1))))
          .setLabel("Вперёд")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(currentPage >= totalPages - 1)
      )
    );
  }

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(ticketButtonId("close_finish", ticket.id)).setLabel("Записать итог").setStyle(ButtonStyle.Primary)
    )
  );

  return buildPayload(container, { ephemeral: true });
}

module.exports = {
  ANTITEAM_COMMAND_NAME,
  ANTITEAM_CUSTOM_IDS,
  buildAdvancedConfigModal,
  buildCloseReviewPayload,
  buildCloseSummaryModal,
  buildConfigModal,
  buildDescriptionModal,
  buildDirectLinkModal,
  buildTicketDirectLinkModal,
  buildTicketRobloxModal,
  buildTwinkRobloxModal,
  buildTwinkConfirmPayload,
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
  buildSupportLeaderboardPayload,
  buildRobloxMissingPayload,
  buildRobloxUsernameModal,
  buildStartPanelPayload,
  buildSupportProgressPayload,
  buildStartGuidePayload,
  buildThreadName,
  buildThreadPanelPayload,
  buildTicketPublicPayload,
  buildTicketSetupPayload,
  buildTicketTitle,
  buildPayload,
  formatChannelMention,
  formatRoleMention,
  getLevelMeta,
  SUPPORT_PROGRESS_LEVELS,
  ticketButtonId,
};
