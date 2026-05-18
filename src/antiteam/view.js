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
} = require("discord.js");
const {
  ANTITEAM_COUNTS,
  ANTITEAM_LEVELS,
  cleanString,
  createDefaultAntiteamConfig,
  normalizeAntiteamCount,
  normalizeAntiteamLevel,
} = require("./state");

const ANTITEAM_COMMAND_NAME = "антитим";

const ANTITEAM_CUSTOM_IDS = Object.freeze({
  open: "at:open",
  guide: "at:guide",
  config: "at:config",
  configAdvanced: "at:config:advanced",
  panelText: "at:panel:text",
  publishPanel: "at:panel:publish",
  refreshPanel: "at:panel:refresh",
  stats: "at:stats",
  statsClear: "at:stats:clear",
  statsClearConfirm: "at:stats:clear_confirm",
  levelSelect: "at:level",
  countSelect: "at:count",
  clanRolesSelect: "at:clan_roles",
  toggleDirect: "at:toggle:direct",
  togglePhoto: "at:toggle:photo",
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

function getLevelMeta(level) {
  return ANTITEAM_LEVELS[normalizeAntiteamLevel(level, "medium")] || ANTITEAM_LEVELS.medium;
}

function getCountMeta(count) {
  return ANTITEAM_COUNTS[normalizeAntiteamCount(count, "2-4")] || ANTITEAM_COUNTS["2-4"];
}

function formatRequesterName(ticket = {}, limit = 32) {
  const raw = cleanString(ticket.createdByTag || ticket.createdBy, 80);
  const name = cleanString(raw.split("#")[0].replace(/^@+/, "").trim(), limit);
  return name || "автор";
}

function formatDirectJoinValue(enabled) {
  return enabled ? "есть" : "нету";
}

function formatTicketStatus(ticket = {}) {
  return ticket.status === "closed" ? "закрыто" : "открыто";
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
    components: [container, ...(Array.isArray(extraComponents) ? extraComponents.filter(Boolean) : [])],
  };
}

function buildStartPanelPayload(config = createDefaultAntiteamConfig()) {
  const panel = createDefaultAntiteamConfig(config).panel;
  const container = new ContainerBuilder()
    .setAccentColor(panel.accentColor)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# ${panel.title}`),
      new TextDisplayBuilder().setContent(panel.description),
      new TextDisplayBuilder().setContent([
        `Батальён: ${formatRoleMention(config.battalionRoleId)}`,
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
          .setCustomId(ANTITEAM_CUSTOM_IDS.guide)
          .setLabel(panel.guideButtonLabel)
          .setStyle(ButtonStyle.Secondary)
      )
    );

  return buildPayload(container);
}

function buildStartGuidePayload(config = createDefaultAntiteamConfig()) {
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
      ].join("\n"))
    );
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
        `Автозакрытие миссии: **${config.missionAutoCloseMinutes} мин**`,
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
      `Глава батальона: ${formatRoleMention(config.battalionLeadRoleId)}`,
      `Уполномоченные на клан-аларм: ${formatRoleMention(config.clanCallerRoleId)}`,
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
        new ButtonBuilder().setCustomId(ANTITEAM_CUSTOM_IDS.stats).setLabel("📊 Статистика помощи").setStyle(ButtonStyle.Secondary)
      )
    );

  return buildPayload(container, { ephemeral: true });
}

function statsButtonId(action, extra = "") {
  return ["at", "stats", action, extra].map((part) => cleanString(part, 80)).filter(Boolean).join(":").slice(0, 100);
}

function buildHelperStatsPayload(state = {}, page = 0, statusText = "", { confirmClear = false } = {}) {
  const helpers = Object.entries(state.stats?.helpers || {})
    .map(([userId, stats]) => ({
      userId,
      responded: Number(stats?.responded) || 0,
      linkGranted: Number(stats?.linkGranted) || 0,
      confirmedArrived: Number(stats?.confirmedArrived) || 0,
      lastTicketId: cleanString(stats?.lastTicketId, 80),
      lastHelpedAt: cleanString(stats?.lastHelpedAt, 80),
    }))
    .sort((left, right) => (right.confirmedArrived - left.confirmedArrived)
      || (right.responded - left.responded)
      || left.userId.localeCompare(right.userId));
  const pageSize = 5;
  const totalPages = Math.max(1, Math.ceil(helpers.length / pageSize));
  const currentPage = Math.min(Math.max(Number.parseInt(page, 10) || 0, 0), totalPages - 1);
  const visibleHelpers = helpers.slice(currentPage * pageSize, currentPage * pageSize + pageSize);
  const container = new ContainerBuilder()
    .setAccentColor(confirmClear ? 0xC62828 : 0x1565C0)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("# 📊 Статистика помощи"),
      new TextDisplayBuilder().setContent([
        `Записей: **${helpers.length}** • страница **${currentPage + 1}/${totalPages}**`,
        statusText,
        confirmClear ? "Подтверди полную очистку. История заявок не будет удалена." : "",
      ].filter(Boolean).join("\n"))
    );

  if (!visibleHelpers.length) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent("Пока нет сохранённой статистики helper-ов."));
  }

  for (const helper of visibleHelpers) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
          `<@${helper.userId}>`,
          `Откликнулся: **${helper.responded}** • ссылки: **${helper.linkGranted}** • пришёл: **${helper.confirmedArrived}**`,
          helper.lastHelpedAt ? `Последняя помощь: ${helper.lastHelpedAt}` : "",
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
      new ButtonBuilder()
        .setCustomId(confirmClear ? ANTITEAM_CUSTOM_IDS.statsClearConfirm : ANTITEAM_CUSTOM_IDS.statsClear)
        .setLabel(confirmClear ? "🔥 Да, стереть всё" : "🧹 Очистить всё")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!helpers.length)
    )
  );

  return buildPayload(container, { ephemeral: true });
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
          .setLabel("Роль вызова клан-аларма")
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
          .setLabel("Автозакрытие без движения, минуты")
          .setPlaceholder("120")
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
    .setTitle(draft.kind === "clan" ? "Описание клан-аларма" : "Описание антитима")
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
  const selected = normalizeAntiteamLevel(draft.level, "medium");
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(ANTITEAM_CUSTOM_IDS.levelSelect)
      .setPlaceholder("Опасность тимеров")
      .addOptions(Object.values(ANTITEAM_LEVELS).map((level) => ({
        label: level.label,
        value: level.id,
        description: level.description.slice(0, 100),
        emoji: level.emoji,
        default: level.id === selected,
      })))
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
        "При «есть» бот попросит следующим сообщением отправить скрин.",
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

function buildTicketSetupPayload(draft = {}, config = createDefaultAntiteamConfig(), statusText = "") {
  const isClan = draft.kind === "clan";
  const level = getLevelMeta(draft.level);
  const count = getCountMeta(draft.count);
  const container = new ContainerBuilder()
    .setAccentColor(isClan ? 0xB71C1C : level.accentColor)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(isClan ? "# Клан-аларм" : "# Заявка антитима"),
      new TextDisplayBuilder().setContent([
        isClan && draft.anchorUserId
          ? `Якорь: <@${draft.anchorUserId}> • ${getDraftRobloxLine(draft, statusText)}`
          : getDraftRobloxLine(draft, statusText),
        isClan ? "Якорь не должен выходить с сервера. По нему будут подключаться помощники." : `${level.emoji} **${level.label}** • ${count.label} тимеров`,
        statusText && !/roblox (взят|подтвержд|найден|готов)/i.test(cleanString(statusText, 240)) ? statusText : "",
      ].filter(Boolean).join("\n"))
    );

  if (isClan) {
    container.addActionRowComponents(buildClanRolesSelect(draft, config));
  } else {
    container.addActionRowComponents(buildLevelSelect(draft), buildCountSelect(draft));
  }

  container
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      "**Описание обязательно**",
      draft.description || "Опиши, кто тимится, что происходит и кого бить: ники, kills, место или любой понятный метод.",
    ].join("\n")))
    .addActionRowComponents(buildDraftDescriptionRow(draft))
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
        "Отправь следующим сообщением в антитим-канал один скрин.",
        "Бот прикрепит его к заявке и удалит исходное сообщение.",
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
  const isClosed = ticket.status === "closed";
  if (ticket.kind === "clan") return `${isClosed ? "⚫" : "⚔️"} Клан-аларм`;
  return `${isClosed ? "⚫ Завершено" : `${getLevelMeta(ticket.level).emoji} Нужна помощь`} • ${formatCountHeadline(ticket.count)}`;
}

function buildThreadName(ticket = {}) {
  const isClosed = ticket.status === "closed";
  if (ticket.kind === "clan") return `${isClosed ? "⚫" : "⚔️"} Война с кланом`;
  return `${isClosed ? "⚫" : getLevelMeta(ticket.level).emoji} ${formatCountHeadline(ticket.count)} • ${formatRequesterName(ticket)}`;
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
    low: "почти вся команда до ~2k kills; если есть 8k+ игрок, повышай минимум до средних.",
    medium: "команда в основном 2k-8k kills; если 8k+ хотя бы треть, повышай до высоких.",
    high: "8k+ kills; выбирай, если таких хотя бы треть команды.",
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

function formatHelpersBlock(ticket = {}, options = {}) {
  const helpers = Object.values(ticket.helpers || {})
    .sort((left, right) => String(left.respondedAt || "").localeCompare(String(right.respondedAt || "")) || String(left.userId || "").localeCompare(String(right.userId || "")));
  const confirmed = helpers.filter((helper) => helper.arrived === true);
  const apiPresentIds = normalizeHelperIdSet(options.apiPresentHelperIds);
  const apiPresentCount = helpers.filter((helper) => apiPresentIds.has(cleanString(helper.userId, 80))).length;
  const isClosed = ticket.status === "closed";
  if (!helpers.length) return "Пока никто не отозвался.";
  const helperLine = helpers.slice(0, 8)
    .map((helper) => isClosed ? `${helper.arrived ? "✅" : "❌"} <@${helper.userId}>` : `<@${helper.userId}>`)
    .join(" • ");
  const overflow = helpers.length > 8 ? ` +${helpers.length - 8}` : "";
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
  const isClosed = ticket.status === "closed";
  const isClan = ticket.kind === "clan";
  const level = getLevelMeta(ticket.level);
  const authorLine = isClan && ticket.anchorUserId
    ? `Попросил 👤 <@${ticket.createdBy}> • Якорь <@${ticket.anchorUserId}> • ${formatPublicRobloxLink(ticket)}`
    : `Попросил 👤 <@${ticket.createdBy}> • ${formatPublicRobloxLink(ticket)}`;
  const dangerText = isClan
    ? "Клан-аларм: якорь должен оставаться в игре до завершения тревоги."
    : formatPublicDifficulty(ticket);
  const statusEmoji = isClosed ? "⚫" : "🟢";
  const directEmoji = ticket.directJoinEnabled ? "🔓" : "🔒";
  const container = new ContainerBuilder()
    .setAccentColor(isClosed ? 0x607D8B : isClan ? 0xB71C1C : level.accentColor)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# ${buildTicketTitle(ticket)}`),
      new TextDisplayBuilder().setContent(joinContentLines([
        authorLine,
        dangerText,
        `${directEmoji} Вход без др: **${formatDirectJoinValue(ticket.directJoinEnabled)}** • ${statusEmoji} **${formatTicketStatus(ticket)}**`,
      ], "—", 1400))
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### Описание\n${buildQuotedDescription(ticket.description)}`))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### Помощники\n${formatHelpersBlock(ticket, options)}`));

  const photoUrl = cleanString(ticket.photo?.url, 2000);
  const shouldAttachPhoto = options.attachPhoto === true && photoUrl;
  let photoAttachmentName = "";
  if (photoUrl) {
    photoAttachmentName = cleanString(ticket.message?.photoAttachmentName, 180) || getPhotoAttachmentName(ticket.photo);
    const media = new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder()
        .setURL(shouldAttachPhoto || ticket.message?.photoAttachmentName ? `attachment://${photoAttachmentName}` : photoUrl)
        .setDescription("Скрин антитима")
    );
    container
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
      .addMediaGalleryComponents(media);
  }

  const publicHelpJumpUrl = isClosed ? "" : buildPublicHelpJumpUrl(ticket);
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
    payload.files = [{ attachment: photoUrl, name: photoAttachmentName }];
  }
  return payload;
}

function ticketButtonId(action, ticketId, extra = "") {
  return ["at", action, ticketId, extra].map((part) => cleanString(part, 80)).filter(Boolean).join(":").slice(0, 100);
}

function buildThreadPanelPayload(ticket = {}, config = createDefaultAntiteamConfig()) {
  const isClosed = ticket.status === "closed";
  return {
    components: [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(ticketButtonId("help", ticket.id))
      .setLabel("🙋 Помочь")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(isClosed),
    new ButtonBuilder()
      .setCustomId(ticketButtonId("report", ticket.id))
      .setLabel("⚠️ Пожаловаться")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(isClosed),
    new ButtonBuilder()
      .setCustomId(ticketButtonId("escalate", ticket.id))
      .setLabel("📈 Повысить")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(isClosed || ticket.kind === "clan"),
    new ButtonBuilder()
      .setCustomId(ticketButtonId("close", ticket.id))
      .setLabel(isClosed ? "✅ Закрыто" : "✅ Завершить")
      .setStyle(ButtonStyle.Success)
      .setDisabled(isClosed)
    )],
  };
}

function buildHelpReplyPayload({ ticket = {}, linkKind = "", directJoinUrl = "", profileUrl = "", friendRequestsUrl = "", bridgeLabel = "" } = {}) {
  const lines = [];
  const targetLabel = ticket.kind === "clan" ? "якоря" : "автора";
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
  } else {
    lines.push(`Отправь ${targetLabel} friend request в Roblox.`);
    if (directJoinUrl) lines.push(`[Ссылка подключения](${directJoinUrl}) станет рабочей после добавления в друзья.`);
    if (profileUrl) lines.push(`[Roblox профиль ${targetLabel}](${profileUrl})`);
    if (friendRequestsUrl) lines.push(`[Где принимают заявки Roblox](${friendRequestsUrl})`);
    lines.push("После отправки friend request нажми кнопку ниже, чтобы пингануть автора в ветке.");
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
        .setLabel("📨 Отправил др, пусть примет")
        .setStyle(ButtonStyle.Primary)
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

function buildEscalateModal(ticketId, nextLevel = "high") {
  return new ModalBuilder()
    .setCustomId(ticketButtonId("escalate_modal", ticketId, nextLevel))
    .setTitle("Повысить опасность")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("reason")
          .setLabel("Причина повышения")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(900)
          .setPlaceholder("Злоупотребление повышением без причины ведёт к наказанию.")
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

function buildCloseReviewPayload(ticket = {}, page = 0) {
  const helpers = Object.values(ticket.helpers || {})
    .sort((left, right) => String(left.respondedAt || "").localeCompare(String(right.respondedAt || "")) || String(left.userId || "").localeCompare(String(right.userId || "")));
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(helpers.length / pageSize));
  const currentPage = Math.min(Math.max(Number.parseInt(page, 10) || 0, 0), totalPages - 1);
  const visibleHelpers = helpers.slice(currentPage * pageSize, currentPage * pageSize + pageSize);
  const container = new ContainerBuilder()
    .setAccentColor(0x1565C0)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("# Завершение антитима"),
      new TextDisplayBuilder().setContent(helpers.length
        ? "Отметь каждого, кто реально пришёл. Даже если помогал мало, рычаг нужно выставить честно."
        : "Пока никто не получал ссылки помощи. Можно закрыть без отметок."),
      new TextDisplayBuilder().setContent(`Страница **${currentPage + 1}/${totalPages}** • helper-ов: **${helpers.length}**`)
    );

  for (const helper of visibleHelpers) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(ticketButtonId("arrived", ticket.id, `${helper.userId}:${currentPage}`))
          .setLabel(`${helper.arrived ? "Пришёл" : "Не отмечен"} • ${helper.discordTag || helper.userId}`.slice(0, 80))
          .setStyle(helper.arrived ? ButtonStyle.Success : ButtonStyle.Secondary)
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
  buildEscalateModal,
  buildHelperStatsPayload,
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
  buildTicketTitle,
  buildPayload,
  formatChannelMention,
  formatRoleMention,
  getLevelMeta,
  ticketButtonId,
};
