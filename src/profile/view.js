"use strict";

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} = require("discord.js");
const {
  buildProfileNavCustomId,
  buildProfileOpenCustomId,
} = require("./entry");
const { buildProfileReadModel } = require("./model");

const PROFILE_VIEWS = Object.freeze(["overview", "activity", "progress", "social"]);
const PROFILE_VIEW_LABELS = Object.freeze({
  overview: "Обзор",
  activity: "Активность",
  progress: "Прогресс",
  social: "Соц",
});
const PROFILE_BLOCK_TITLE_LABELS = Object.freeze({
  "Main Core": "🧩 Ядро профиля",
  "War Readiness": "🛡️ Готовность к вару",
  "Voice-срез": "🎙️ Voice-срез",
  "Prime time МСК": "🕒 Prime time МСК",
  "Лучшие периоды": "🏆 Лучшие периоды",
  "История сезона": "📜 История сезона",
  "Weekly rollups": "🗓️ Weekly baseline",
  "Activity mix": "🧭 Где живёт игрок",
  "Farm profile": "🌾 Профиль фарма",
  "Relative component places": "📍 Места по метрикам",
  "Prime time confidence": "🕒 Уверенность prime time",
  "Season consistency": "📏 Ровность сезона",
  "Comeback metrics": "🔁 Комбек-метрики",
  "Практический прогресс": "💪 Практический прогресс",
  "Proof gap": "🧾 Разрыв proof",
  "Antiteam support": "🛟 Антитим-помощь",
  "Roblox-друзья на сервере": "🤝 Roblox-друзья на сервере",
  "Кто из друзей уже здесь": "🫂 Кто из друзей уже здесь",
  "Социальная эволюция": "📈 Социальная эволюция",
  "Скрытый круг": "🕵️ Скрытый круг",
  "Проверенный круг": "✅ Проверенный круг",
  "Социальная карта": "🗺️ Социальная карта",
  "Voice + game overlap": "🎙️ Voice + JJS",
});

function normalizeProfileDisplayMode(value, isSelf = false) {
  const normalized = cleanString(value, 40).toLowerCase();
  if (["self", "viewer", "compact-card"].includes(normalized)) return normalized;
  return isSelf ? "self" : "viewer";
}

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function normalizeNullableString(value, limit = 2000) {
  const text = cleanString(value, limit);
  return text || null;
}

function buildFieldValue(lines, fallback = "—", limit = 1024) {
  if (!Array.isArray(lines)) return fallback;
  let value = "";
  const max = Math.max(1, Number(limit) || 1024);

  for (const entry of lines) {
    const line = cleanString(entry, 1000);
    if (!line) continue;
    const next = value ? `${value}\n${line}` : line;
    if (next.length > max) {
      value = value ? `${value}\n…` : `${cleanString(line, Math.max(1, max - 1))}…`;
      break;
    }
    value = next;
  }

  return value || fallback;
}

function simplifyProfileLine(value = "") {
  return cleanString(value, 1000)
    .replace(/\bmax debuff\b/gi, "макс. снижение веса")
    .replace(/\bkill-backed debuff\b/gi, "снижение веса proof")
    .replace(/\bbaseline min\b/gi, "база сравнения")
    .replace(/\bbaseline\b/gi, "база сравнения")
    .replace(/^Trust:/i, "Надёжность:")
    .replace(/\bconfidence\b/gi, "оценка")
    .replace(/\bsources\b/gi, "по данным")
    .replace(/\bsource\b/gi, "по данным")
    .replace(/\bdebuff\b/gi, "снижение веса")
    .replace(/\breliable\b/gi, "точный расчёт")
    .replace(/\bfresh\b/gi, "точный расчёт")
    .replace(/\bpartial\b/gi, "частично")
    .replace(/\boutdated\b/gi, "старые данные")
    .replace(/\bstale\b/gi, "старые данные")
    .replace(/\bheuristic\b/gi, "примерно")
    .replace(/\binferred\b/gi, "примерно")
    .replace(/\bproxy\b/gi, "примерно")
    .replace(/\bsparse\b/gi, "мало базы")
    .replace(/\bunavailable\b/gi, "нет базы")
    .replace(/\blocal_fallback\b/gi, "локальная оценка")
    .replace(/\bN\/A\b/g, "нет базы")
    .replace(/\bDiscord last seen\b/gi, "Discord")
    .replace(/\bproof freshness\b/gi, "proof")
    .replace(/\bapproved history\b/gi, "approved-истории")
    .replace(/\bno exact party claim\b/gi, "без заявления про точное пати")
    .replace(/\bno strong farm claim without session histograms\b/gi, "без сильного вывода без истории сессий")
    .replace(/\bstrong farm claim bounded by captured sessions\b/gi, "вывод ограничен пойманными сессиями")
    .replace(/\brolling snapshots, not exact single-day deltas\b/gi, "это rolling-срезы, не точные дневные дельты")
    .replace(/\bclaims require 3\+ comparable weekly windows\b/gi, "выводы требуют 3+ сравнимых weekly окон")
    .replace(/\bno comeback claim\b/gi, "без вывода про comeback");
}

function buildTextDisplay(title, lines, fallback = "—", limit = 4000) {
  const normalizedTitle = cleanString(title, 120) || "Блок";
  const heading = PROFILE_BLOCK_TITLE_LABELS[normalizedTitle] || normalizedTitle;
  const displayLines = Array.isArray(lines) ? lines.map((line) => simplifyProfileLine(line)) : lines;
  const body = buildFieldValue(displayLines, fallback, Math.max(64, limit - heading.length - 5));
  return new TextDisplayBuilder().setContent(`### ${heading}\n${body}`);
}

function buildSectionMarkdown(block = {}) {
  const normalizedTitle = cleanString(block?.title, 120) || "Блок";
  const heading = PROFILE_BLOCK_TITLE_LABELS[normalizedTitle] || normalizedTitle;
  const lines = Array.isArray(block?.lines)
    ? block.lines.map((line) => simplifyProfileLine(line)).filter(Boolean)
    : [];
  return `### ${heading}\n${buildFieldValue(lines, "—", 1600)}`;
}

function buildSectionGroupMarkdown(group = {}, blockLimit = 1350) {
  const title = normalizeNullableString(group?.title, 120);
  const blocks = Array.isArray(group?.blocks) ? group.blocks : [];
  const parts = [];
  if (title) parts.push(`## ${title}`);
  for (const block of blocks) {
    parts.push(buildSectionMarkdown(block).replace(/\n([\s\S]*)$/, (match, body) => `\n${buildFieldValue(body.split("\n"), "—", blockLimit)}`));
  }
  return parts.join("\n");
}

function buildSectionTextDisplays(blocks = [], limit = 3900, options = {}) {
  const displays = [];
  let current = "";
  const max = Math.max(1000, Number(limit) || 3900);
  const maxDisplays = Math.max(1, Number(options.maxDisplays) || 6);
  const blockLimit = Math.max(500, Number(options.blockLimit) || 1350);
  const entries = Array.isArray(options.groups) && options.groups.length
    ? options.groups.map((group) => buildSectionGroupMarkdown(group, blockLimit))
    : (Array.isArray(blocks) ? blocks : []).map((block) => buildSectionMarkdown(block));

  for (const nextBlock of entries) {
    const next = current ? `${current}\n\n${nextBlock}` : nextBlock;
    if (current && next.length > max) {
      displays.push(new TextDisplayBuilder().setContent(current));
      if (displays.length >= maxDisplays) return displays;
      current = nextBlock;
    } else {
      current = next;
    }
  }

  if (current) {
    displays.push(new TextDisplayBuilder().setContent(current));
  }

  return displays.slice(0, maxDisplays);
}

function buildHeroSection({ heroTitle = "Быстрый статус", heroLines = [], primaryAvatarUrl = null, primaryAvatarDescription = null } = {}) {
  const url = normalizeNullableString(primaryAvatarUrl, 1000);
  const lines = Array.isArray(heroLines)
    ? heroLines.map((entry) => simplifyProfileLine(entry)).map((entry) => cleanString(entry, 300)).filter(Boolean)
    : [];
  if (!url || !lines.length) return null;

  const description = cleanString(primaryAvatarDescription, 200) || "Аватар профиля";
  const section = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`### ${cleanString(heroTitle, 120) || "Быстрый статус"}`),
      new TextDisplayBuilder().setContent(buildFieldValue(lines, "После онбординга здесь появится быстрая сводка.", 1200))
    );

  if (url) {
    section.setThumbnailAccessory(
      new ThumbnailBuilder()
        .setURL(url)
        .setDescription(description)
    );
  }

  return section;
}

function buildHeroTextDisplay(heroLines = [], heroTitle = "Быстрый статус") {
  const lines = Array.isArray(heroLines)
    ? heroLines.map((entry) => simplifyProfileLine(entry)).map((entry) => cleanString(entry, 300)).filter(Boolean)
    : [];
  if (!lines.length) return null;
  return buildTextDisplay(cleanString(heroTitle, 120) || "Быстрый статус", lines, "После онбординга здесь появится быстрая сводка.", 1500);
}

function buildProfileMediaGallery(mediaGalleryItems = []) {
  const items = [];

  for (const entry of Array.isArray(mediaGalleryItems) ? mediaGalleryItems : []) {
    const url = normalizeNullableString(entry?.url, 1000);
    if (!url) continue;

    const item = new MediaGalleryItemBuilder().setURL(url);
    const description = normalizeNullableString(entry?.description, 200);
    if (description) item.setDescription(description);
    items.push(item);
    if (items.length >= 4) break;
  }

  return items.length ? new MediaGalleryBuilder().addItems(items) : null;
}

function buildButtonRows(buttons = [], maxPerRow = 5) {
  const rows = [];
  const normalizedMaxPerRow = Math.max(1, Number(maxPerRow) || 5);

  for (let index = 0; index < buttons.length; index += normalizedMaxPerRow) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(index, index + normalizedMaxPerRow)));
  }

  return rows;
}

function buildLinkButton(link = {}) {
  const url = normalizeNullableString(link?.url, 1000);
  if (!url) return null;
  return new ButtonBuilder()
    .setStyle(ButtonStyle.Link)
    .setLabel(cleanString(link?.buttonLabel || link?.label, 80) || "Ссылка")
    .setURL(url);
}

function buildLinkButtons({ mandatoryLinks = [], robloxProfileUrl = null } = {}) {
  const buttons = [];
  const seenUrls = new Set();

  function pushButton(link) {
    const url = normalizeNullableString(link?.url, 1000);
    if (!url || seenUrls.has(url)) return;
    const button = buildLinkButton(link);
    if (!button) return;
    seenUrls.add(url);
    buttons.push(button);
  }

  const mandatory = Array.isArray(mandatoryLinks) ? mandatoryLinks : [];
  if (mandatory.length) {
    for (const link of mandatory) pushButton(link);
  } else {
    const normalizedRobloxProfileUrl = normalizeNullableString(robloxProfileUrl, 1000);
    if (normalizedRobloxProfileUrl) {
      pushButton({
        label: "Roblox профиль",
        buttonLabel: "Roblox профиль",
        url: normalizedRobloxProfileUrl,
      });
    }
  }

  return buttons.length ? buildButtonRows(buttons.slice(0, 2), 5) : [];
}

function normalizeProfileView(value) {
  const normalized = cleanString(value, 40).toLowerCase();
  return PROFILE_VIEWS.includes(normalized) ? normalized : PROFILE_VIEWS[0];
}

function buildProfileNavRow({ requesterUserId = "", targetUserId = "", currentView = "overview" } = {}) {
  const activeView = normalizeProfileView(currentView);
  return new ActionRowBuilder().addComponents(
    PROFILE_VIEWS.map((view) => new ButtonBuilder()
      .setCustomId(buildProfileNavCustomId(requesterUserId, targetUserId, view))
      .setLabel(PROFILE_VIEW_LABELS[view])
      .setStyle(view === activeView ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(view === activeView))
  );
}

function buildProfileActionRows({ isSelf = false, selfActionState = {} } = {}) {
  if (!isSelf) return [];

  const hasMains = selfActionState.hasMains === true;
  const hasVerifiedRoblox = selfActionState.hasVerifiedRoblox === true;
  const prefixLabel = (emoji, label, fallback) => {
    const text = cleanString(label, 80) || fallback;
    return text.startsWith(emoji) ? text : `${emoji} ${text}`;
  };

  return buildButtonRows([
    new ButtonBuilder()
      .setCustomId("onboard_begin")
      .setLabel(prefixLabel("⚔️", selfActionState.killsLabel, "Добавить kills"))
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("onboard_change_mains")
      .setLabel(prefixLabel("🎭", selfActionState.mainsLabel, "Сменить мейнов"))
      .setStyle(hasMains ? ButtonStyle.Secondary : ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("profile_bind_roblox")
      .setLabel(prefixLabel("🔗", selfActionState.robloxLabel, "Привязать Roblox"))
      .setStyle(hasVerifiedRoblox ? ButtonStyle.Secondary : ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("elo_submit_open")
      .setLabel(prefixLabel("📈", selfActionState.eloLabel, "ELO: текст + скрин"))
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("rate_new_characters")
      .setLabel("🏆 Оценить персонажей по скилу")
      .setStyle(ButtonStyle.Secondary),
  ], 5);
}

function buildProfileHelperMessagePayload({ requesterUserId = "", targetUserId = "", isSelf = false, targetLabel = "" } = {}) {
  const label = cleanString(targetLabel, 120) || (isSelf ? "свой профиль" : `профиль <@${cleanString(targetUserId, 80)}>`);
  return {
    content: isSelf
      ? "Нажми кнопку ниже, чтобы открыть свой профиль приватно. Сообщение исчезнет само."
      : `Нажми кнопку ниже, чтобы открыть приватно ${label}. Сообщение исчезнет само.`,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(buildProfileOpenCustomId(requesterUserId, targetUserId))
          .setLabel(isSelf ? "Открыть свой профиль" : "Открыть профиль")
          .setStyle(ButtonStyle.Primary)
      ),
    ],
  };
}

function buildProfilePayload(options = {}) {
  const readModel = options.readModel && typeof options.readModel === "object"
    ? options.readModel
    : buildProfileReadModel(options);
  const userId = cleanString(readModel.userId, 80);
  const displayName = cleanString(readModel.displayName, 200) || `Пользователь ${userId}`;
  const displayMode = normalizeProfileDisplayMode(readModel.displayMode, readModel.isSelf);
  const currentView = normalizeProfileView(options.view);
  const componentBudget = readModel.componentBudget && typeof readModel.componentBudget === "object"
    ? readModel.componentBudget
    : {};
  const heroSummary = readModel.heroSummary && typeof readModel.heroSummary === "object"
    ? readModel.heroSummary
    : null;
  const heroSection = buildHeroSection({
    heroTitle: heroSummary?.title || readModel.heroTitle,
    heroLines: heroSummary?.lines || readModel.heroLines,
    primaryAvatarUrl: readModel.primaryAvatarUrl,
    primaryAvatarDescription: readModel.primaryAvatarDescription,
  });
  const identityMediaGallery = buildProfileMediaGallery(readModel.identityMediaItems);
  const mediaGallery = buildProfileMediaGallery(readModel.mediaGalleryItems);

  const container = new ContainerBuilder()
    .setAccentColor(0x1565C0)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        displayMode === "compact-card"
          ? `${readModel.isSelf ? "# Моя карточка" : `# Карточка • ${displayName}`}`
          : `${readModel.isSelf ? "# Твой профиль" : `# Профиль • ${displayName}`}\n**${PROFILE_VIEW_LABELS[currentView]}**`
      )
    );

  if (displayMode !== "compact-card" && identityMediaGallery) {
    container.addMediaGalleryComponents(identityMediaGallery);
  }

  if (heroSection) {
    container.addSectionComponents(heroSection);
  } else {
    const heroTextDisplay = buildHeroTextDisplay(heroSummary?.lines || readModel.heroLines, heroSummary?.title || readModel.heroTitle);
    if (heroTextDisplay) {
      container.addTextDisplayComponents(heroTextDisplay);
    }
  }

  if (displayMode !== "compact-card") {
    container.addActionRowComponents(
        buildProfileNavRow({
          requesterUserId: options.requesterUserId,
          targetUserId: userId,
          currentView,
        })
      );
  }

  container
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true));

  const sectionKey = displayMode === "compact-card" ? "compact" : currentView;
  const sectionBlocks = Array.isArray(readModel.sections?.[sectionKey]) ? readModel.sections[sectionKey] : [];
  const sectionGroups = Array.isArray(readModel.sectionGroups?.[sectionKey]) ? readModel.sectionGroups[sectionKey] : [];
  if (sectionBlocks.length) {
    container.addTextDisplayComponents(...buildSectionTextDisplays(
      sectionBlocks,
      componentBudget.sectionTextLimit,
      {
        groups: sectionGroups,
        maxDisplays: displayMode === "compact-card" ? 3 : componentBudget.maxSectionTextDisplays,
        blockLimit: componentBudget.blockTextLimit,
      }
    ));
  }

  if (Array.isArray(readModel.verificationLines) && readModel.verificationLines.length) {
    container.addTextDisplayComponents(
      buildTextDisplay("Верификация", readModel.verificationLines)
    );
  }

  if (readModel.emptyStateNote) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`*${cleanString(readModel.emptyStateNote, 4000)}*`)
    );
  }

  if (displayMode !== "compact-card" && mediaGallery && (currentView === "overview" || currentView === "social")) {
    container
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
      .addMediaGalleryComponents(mediaGallery);
  }

  if (displayMode !== "compact-card") {
    const actionRows = buildProfileActionRows({
      isSelf: readModel.isSelf,
      selfActionState: readModel.selfActionState,
    });
    if (actionRows.length) {
      container
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
        .addActionRowComponents(...actionRows);
    }
  }

  if (displayMode !== "compact-card") {
    const linkRows = buildLinkButtons({
      mandatoryLinks: readModel.mandatoryLinks,
      robloxProfileUrl: readModel.robloxProfileUrl,
    });
    if (linkRows.length) {
      container
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
        .addActionRowComponents(...linkRows);
    }
  }

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
  };
}

function buildProfileFallbackPayload({ view = "overview", message = "" } = {}) {
  const label = PROFILE_VIEW_LABELS[normalizeProfileView(view)] || "раздел";
  const text = cleanString(message, 500)
    || `Раздел «${label}» сейчас не собрался. Я оставил профиль живым, чтобы кнопка не зависала.`;
  const container = new ContainerBuilder()
    .setAccentColor(0xC62828)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# Профиль\n**${label}**`),
      new TextDisplayBuilder().setContent(`### Раздел временно недоступен\n${text}`)
    );

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
  };
}

module.exports = {
  PROFILE_VIEWS,
  buildProfileFallbackPayload,
  buildProfileHelperMessagePayload,
  buildProfilePayload,
};
