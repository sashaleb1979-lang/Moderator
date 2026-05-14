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

function buildTextDisplay(title, lines, fallback = "—", limit = 4000) {
  const heading = cleanString(title, 120) || "Блок";
  const body = buildFieldValue(lines, fallback, Math.max(64, limit - heading.length - 5));
  return new TextDisplayBuilder().setContent(`### ${heading}\n${body}`);
}

function buildAvatarSection({ primaryAvatarUrl = null, primaryAvatarDescription = null } = {}) {
  const url = normalizeNullableString(primaryAvatarUrl, 1000);
  if (!url) return null;

  const description = cleanString(primaryAvatarDescription, 200) || "Аватар профиля";
  return new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("### Аватар"),
      new TextDisplayBuilder().setContent(description)
    )
    .setThumbnailAccessory(
      new ThumbnailBuilder()
        .setURL(url)
        .setDescription(description)
    );
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

function buildLinkButtons({ comboLinks = [], robloxProfileUrl = null } = {}) {
  const buttons = [];

  for (const link of Array.isArray(comboLinks) ? comboLinks : []) {
    const url = normalizeNullableString(link?.url, 500);
    if (!url) continue;
    buttons.push(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel(cleanString(link?.buttonLabel || link?.label, 80) || "Ссылка")
        .setURL(url)
    );
    if (buttons.length >= 8) break;
  }

  const normalizedRobloxProfileUrl = normalizeNullableString(robloxProfileUrl, 1000);
  if (normalizedRobloxProfileUrl && buttons.length < 10) {
    buttons.push(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel("Roblox профиль")
        .setURL(normalizedRobloxProfileUrl)
    );
  }

  return buttons.length ? buildButtonRows(buttons, 5) : [];
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
      .setStyle(view === activeView ? ButtonStyle.Primary : ButtonStyle.Secondary))
  );
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
  const currentView = normalizeProfileView(options.view);
  const avatarSection = buildAvatarSection({
    primaryAvatarUrl: readModel.primaryAvatarUrl,
    primaryAvatarDescription: readModel.primaryAvatarDescription,
  });
  const mediaGallery = buildProfileMediaGallery(readModel.mediaGalleryItems);

  const container = new ContainerBuilder()
    .setAccentColor(0x1565C0)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(readModel.isSelf ? "# Твой профиль" : `# Профиль • ${displayName}`),
      new TextDisplayBuilder().setContent(
        readModel.isSelf ? `Приватный профиль ${displayName}.` : `Приватный просмотр профиля <@${userId}>.`
      ),
      new TextDisplayBuilder().setContent(`**Секция:** ${PROFILE_VIEW_LABELS[currentView]}`)
    );

  if (avatarSection) {
    container.addSectionComponents(avatarSection);
  }

  container.addActionRowComponents(
      buildProfileNavRow({
        requesterUserId: options.requesterUserId,
        targetUserId: userId,
        currentView,
      })
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true));

  const sectionBlocks = Array.isArray(readModel.sections?.[currentView]) ? readModel.sections[currentView] : [];
  if (sectionBlocks.length) {
    container.addTextDisplayComponents(
      ...sectionBlocks.map((block) => buildTextDisplay(block?.title, block?.lines))
    );
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

  if (mediaGallery && (currentView === "overview" || currentView === "social")) {
    container
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
      .addMediaGalleryComponents(mediaGallery);
  }

  const linkRows = buildLinkButtons({
    comboLinks: readModel.comboLinks,
    robloxProfileUrl: readModel.robloxProfileUrl,
  });
  if (linkRows.length) {
    container
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
      .addActionRowComponents(...linkRows);
  }

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
  };
}

module.exports = {
  PROFILE_VIEWS,
  buildProfileHelperMessagePayload,
  buildProfilePayload,
};