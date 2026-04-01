require("dotenv").config();

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const { renderGraphicTierlistPng, setAvatarCacheDir, clearGraphicAvatarCache, isPureimageAvailable, DEFAULT_GRAPHIC_TIER_COLORS } = require("./graphic-tierlist");

const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  SlashCommandBuilder,
  MessageFlags,
} = require("discord.js");

const PROJECT_ROOT = __dirname;

function resolvePathFromBase(baseDir, rawPath, fallbackRelative = "") {
  const target = String(rawPath || fallbackRelative || "").trim();
  if (!target) return path.resolve(baseDir, fallbackRelative || ".");
  return path.isAbsolute(target) ? target : path.resolve(baseDir, target);
}

function resolveDataRoot() {
  const explicitRoot = String(process.env.BOT_DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || "").trim();
  if (explicitRoot) return resolvePathFromBase(PROJECT_ROOT, explicitRoot);
  if (process.env.RAILWAY_ENVIRONMENT_NAME && fs.existsSync("/data")) return "/data";
  return PROJECT_ROOT;
}

const DATA_ROOT = resolveDataRoot();
const DISCORD_TOKEN = String(process.env.DISCORD_TOKEN || "").trim();
const GUILD_ID = String(process.env.GUILD_ID || "").trim();
const DB_PATH = resolvePathFromBase(DATA_ROOT, process.env.DB_PATH || "welcome-db.json");
const CONFIG_PATH = resolvePathFromBase(PROJECT_ROOT, process.env.CONFIG_PATH || "./bot.config.json");
const DEFAULT_REMINDER_POSTER_PATH = resolvePathFromBase(PROJECT_ROOT, "./assets/missing-tierlist-poster.svg");

fs.mkdirSync(DATA_ROOT, { recursive: true });
setAvatarCacheDir(path.join(DATA_ROOT, "graphic_avatar_cache"));

const SUBMIT_SESSION_EXPIRE_MS = 10 * 60 * 1000;
const PENDING_EXPIRE_HOURS = 72;
const TEMP_MESSAGE_DELETE_MS = 12000;
const SUBMIT_COOLDOWN_SECONDS = 120;

let guildCache = null;
const mainDrafts = new Map();
const submitSessions = new Map();

function envText(name, fallback = "") {
  const raw = process.env[name];
  if (raw === undefined || raw === null) return String(fallback || "").trim();
  return String(raw).trim();
}

function loadJsonFile(filePath, fallbackValue) {
  try {
    if (!fs.existsSync(filePath)) return fallbackValue;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Не удалось прочитать JSON из ${filePath}: ${error.message}`);
  }
}

function saveJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function isPlaceholder(value) {
  const text = String(value || "").trim();
  return !text || text.startsWith("REPLACE_") || text.startsWith("YOUR_");
}

function parseCharacterConfig(rawValue) {
  if (!rawValue) return [];
  if (Array.isArray(rawValue)) return rawValue;
  try {
    const parsed = JSON.parse(String(rawValue));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    throw new Error("CHARACTER_CONFIG_JSON должен быть валидным JSON-массивом");
  }
}

function buildRuntimeConfig(fileConfig = {}) {
  const fileCharacters = Array.isArray(fileConfig?.characters) ? fileConfig.characters : [];
  const envCharacters = envText("CHARACTER_CONFIG_JSON", "");
  const characters = envCharacters ? parseCharacterConfig(envCharacters) : fileCharacters;

  return {
    channels: {
      welcomeChannelId: envText("WELCOME_CHANNEL_ID", fileConfig?.channels?.welcomeChannelId || ""),
      reviewChannelId: envText("REVIEW_CHANNEL_ID", fileConfig?.channels?.reviewChannelId || ""),
      tierlistChannelId: envText("TIERLIST_CHANNEL_ID", fileConfig?.channels?.tierlistChannelId || ""),
      logChannelId: envText("LOG_CHANNEL_ID", fileConfig?.channels?.logChannelId || ""),
    },
    roles: {
      moderatorRoleId: envText("MODERATOR_ROLE_ID", fileConfig?.roles?.moderatorRoleId || ""),
      accessRoleId: envText("ACCESS_ROLE_ID", fileConfig?.roles?.accessRoleId || ""),
      killTierRoleIds: {
        1: envText("TIER_ROLE_1_ID", fileConfig?.roles?.killTierRoleIds?.["1"] || ""),
        2: envText("TIER_ROLE_2_ID", fileConfig?.roles?.killTierRoleIds?.["2"] || ""),
        3: envText("TIER_ROLE_3_ID", fileConfig?.roles?.killTierRoleIds?.["3"] || ""),
        4: envText("TIER_ROLE_4_ID", fileConfig?.roles?.killTierRoleIds?.["4"] || ""),
        5: envText("TIER_ROLE_5_ID", fileConfig?.roles?.killTierRoleIds?.["5"] || ""),
      },
    },
    ui: {
      welcomeTitle: envText("WELCOME_TITLE", fileConfig?.ui?.welcomeTitle || "Jujutsu Shinigans Onboarding"),
      welcomeDescription: envText("WELCOME_DESCRIPTION", fileConfig?.ui?.welcomeDescription || "Нажми кнопку ниже, выбери 1 или 2 мейнов, укажи точное количество kills и отправь следующим сообщением скрин. После подачи заявки бот сразу выдаст тебе роль доступа, а kill-tier роль прилетит после проверки модератором."),
      getRoleButtonLabel: envText("GET_ROLE_BUTTON_LABEL", fileConfig?.ui?.getRoleButtonLabel || "Получить роль"),
      tierlistButtonLabel: envText("TIERLIST_BUTTON_LABEL", fileConfig?.ui?.tierlistButtonLabel || "Текстовый тир-лист"),
      tierlistTitle: envText("TIERLIST_TITLE", fileConfig?.ui?.tierlistTitle || "Текстовый тир-лист"),
    },
    graphicTierlist: {
      title: envText("GRAPHIC_TIERLIST_TITLE", fileConfig?.graphicTierlist?.title || "Графический тир-лист"),
      subtitle: envText(
        "GRAPHIC_TIERLIST_SUBTITLE",
        fileConfig?.graphicTierlist?.subtitle || "Подтверждённые игроки и текущая расстановка по kills"
      ),
      tierColors: {
        1: envText("GRAPHIC_TIER_COLOR_1", fileConfig?.graphicTierlist?.tierColors?.["1"] || DEFAULT_GRAPHIC_TIER_COLORS[1]),
        2: envText("GRAPHIC_TIER_COLOR_2", fileConfig?.graphicTierlist?.tierColors?.["2"] || DEFAULT_GRAPHIC_TIER_COLORS[2]),
        3: envText("GRAPHIC_TIER_COLOR_3", fileConfig?.graphicTierlist?.tierColors?.["3"] || DEFAULT_GRAPHIC_TIER_COLORS[3]),
        4: envText("GRAPHIC_TIER_COLOR_4", fileConfig?.graphicTierlist?.tierColors?.["4"] || DEFAULT_GRAPHIC_TIER_COLORS[4]),
        5: envText("GRAPHIC_TIER_COLOR_5", fileConfig?.graphicTierlist?.tierColors?.["5"] || DEFAULT_GRAPHIC_TIER_COLORS[5]),
      },
    },
    reminders: {
      missingTierlistText: envText(
        "MISSING_TIERLIST_TEXT",
        fileConfig?.reminders?.missingTierlistText || "Враг народа избегает получения роли!!! Не будь врагом!!! Стань товарищем!!!"
      ),
      missingTierlistImageUrl: envText(
        "MISSING_TIERLIST_IMAGE_URL",
        fileConfig?.reminders?.missingTierlistImageUrl || ""
      ),
      missingTierlistImagePath: envText(
        "MISSING_TIERLIST_IMAGE_PATH",
        fileConfig?.reminders?.missingTierlistImagePath || ""
      ),
    },
    killTierLabels: {
      1: envText("KILL_TIER_LABEL_1", fileConfig?.killTierLabels?.["1"] || "Низший ранг"),
      2: envText("KILL_TIER_LABEL_2", fileConfig?.killTierLabels?.["2"] || "Средний ранг"),
      3: envText("KILL_TIER_LABEL_3", fileConfig?.killTierLabels?.["3"] || "Высший ранг"),
      4: envText("KILL_TIER_LABEL_4", fileConfig?.killTierLabels?.["4"] || "Особый ранг"),
      5: envText("KILL_TIER_LABEL_5", fileConfig?.killTierLabels?.["5"] || "Абсолютный ранг"),
    },
    characters,
  };
}

function validateRuntimeConfig(config) {
  const errors = [];

  if (!DISCORD_TOKEN) errors.push("DISCORD_TOKEN отсутствует в .env");
  if (!GUILD_ID) errors.push("GUILD_ID отсутствует в .env");
  if (!config || typeof config !== "object") errors.push("bot.config.json не найден или повреждён");

  if (config?.channels) {
    if (isPlaceholder(config.channels.welcomeChannelId)) errors.push("channels.welcomeChannelId не заполнен");
    if (isPlaceholder(config.channels.reviewChannelId)) errors.push("channels.reviewChannelId не заполнен");
  } else {
    errors.push("channels отсутствует в bot.config.json");
  }

  if (config?.roles) {
    if (isPlaceholder(config.roles.moderatorRoleId)) errors.push("roles.moderatorRoleId не заполнен");
    if (isPlaceholder(config.roles.accessRoleId)) errors.push("roles.accessRoleId не заполнен");
  } else {
    errors.push("roles отсутствует в bot.config.json");
  }

  if (!Array.isArray(config?.characters) || !config.characters.length) {
    errors.push("characters должен содержать хотя бы одного персонажа");
  } else {
    if (config.characters.length > 25) {
      errors.push("characters не должен содержать больше 25 опций для select menu");
    }

    const seenIds = new Set();
    for (const character of config.characters) {
      const id = String(character?.id || "").trim();
      const label = String(character?.label || "").trim();

      if (!id) errors.push("У одного из characters отсутствует id");
      if (!label) errors.push(`У персонажа ${id || "(без id)"} отсутствует label`);
      if (seenIds.has(id)) errors.push(`Повторяющийся character id: ${id}`);
      seenIds.add(id);
    }
  }

  if (errors.length) {
    throw new Error(`Конфиг заполнен не полностью:\n- ${errors.join("\n- ")}`);
  }
}

const fileConfig = loadJsonFile(CONFIG_PATH, {});
const appConfig = buildRuntimeConfig(fileConfig);
validateRuntimeConfig(appConfig);

function loadDb() {
  const fallback = {
    config: {
      welcomePanel: {
        channelId: appConfig.channels.welcomeChannelId,
        messageId: "",
      },
      tierlistBoard: {
        channelId: appConfig.channels.tierlistChannelId || "",
        graphicMessageId: "",
        textMessageId: "",
      },
      generatedRoles: {
        characters: {},
        tiers: {},
      },
    },
    profiles: {},
    submissions: {},
  };

  const db = loadJsonFile(DB_PATH, fallback);
  db.config ||= {};
  db.config.welcomePanel ||= { channelId: appConfig.channels.welcomeChannelId, messageId: "" };
  db.config.tierlistBoard ||= { channelId: appConfig.channels.tierlistChannelId || "", graphicMessageId: "", textMessageId: "" };
  if (db.config.tierlistBoard.messageId && !db.config.tierlistBoard.textMessageId) {
    db.config.tierlistBoard.textMessageId = db.config.tierlistBoard.messageId;
  }
  db.config.tierlistBoard.graphicMessageId ||= "";
  db.config.tierlistBoard.textMessageId ||= "";
  db.config.generatedRoles ||= { characters: {}, tiers: {} };
  db.config.graphicTierlist ||= {
    title: "",
    tierColors: {},
    tierLabels: {},
    image: { width: null, height: null, icon: null },
    panel: { selectedTier: 5 },
    messageText: "",
    lastUpdated: null,
  };
  db.config.graphicTierlist.image ||= { width: null, height: null, icon: null };
  db.config.graphicTierlist.panel ||= { selectedTier: 5 };
  db.profiles ||= {};
  db.submissions ||= {};
  db.cooldowns ||= {};
  return db;
}

const db = loadDb();

function saveDb() {
  saveJsonFile(DB_PATH, db);
}

function nowIso() {
  return new Date().toISOString();
}

function makeId() {
  return (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)).toUpperCase();
}

function formatDateTime(value) {
  const ts = Date.parse(value || "");
  if (!Number.isFinite(ts)) return "—";
  return new Date(ts).toLocaleString("ru-RU");
}

function hoursSince(value) {
  const ts = Date.parse(value || "");
  if (!Number.isFinite(ts)) return Number.POSITIVE_INFINITY;
  return (Date.now() - ts) / 36e5;
}

function parseKillCount(input) {
  const digits = String(input || "").replace(/[^\d]+/g, "");
  if (!digits.length) return null;
  const value = Number(digits);
  if (!Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

function killTierFor(kills) {
  const amount = Number(kills);
  if (!Number.isFinite(amount) || amount < 0) return null;
  if (amount >= 11000) return 5;
  if (amount >= 7000) return 4;
  if (amount >= 3000) return 3;
  if (amount >= 1000) return 2;
  return 1;
}

function formatTierLabel(tier) {
  return appConfig.killTierLabels?.[String(tier)] || `Tier ${tier}`;
}

function ephemeralPayload(payload) {
  return { ...payload, flags: MessageFlags.Ephemeral };
}

function getCharacterSelectValue(characterId) {
  return `main_${String(characterId || "x").trim() || "x"}`;
}

function getCharacterIdFromSelectValue(value) {
  return String(value || "").replace(/^main_/, "").trim();
}

function normalizeCharacterSelectLabel(label) {
  const normalized = String(label || "").trim();
  if (normalized.length >= 2) return normalized.slice(0, 100);
  if (normalized.length === 1) return `${normalized} •`;
  return "??";
}

function getGeneratedRoleState() {
  db.config.generatedRoles ||= { characters: {}, tiers: {} };
  db.config.generatedRoles.characters ||= {};
  db.config.generatedRoles.tiers ||= {};
  return db.config.generatedRoles;
}

function formatNumber(value) {
  const amount = Number(value) || 0;
  return amount.toLocaleString("ru-RU");
}

function getProfileDisplayName(userId, profile = null) {
  const currentProfile = profile || db.profiles?.[userId] || {};
  if (currentProfile.displayName) return String(currentProfile.displayName).trim();
  if (currentProfile.username) return String(currentProfile.username).trim();

  const latestSubmission = getLatestSubmissionForUser(userId);
  if (latestSubmission?.displayName) return String(latestSubmission.displayName).trim();
  if (latestSubmission?.username) return String(latestSubmission.username).trim();
  return `User ${userId}`;
}

function getSubmitCooldownLeftSeconds(userId) {
  const last = Number(db.cooldowns?.[userId]) || 0;
  if (!last) return 0;
  return Math.max(0, SUBMIT_COOLDOWN_SECONDS - Math.floor((Date.now() - last) / 1000));
}

function setSubmitCooldown(userId) {
  db.cooldowns ||= {};
  db.cooldowns[userId] = Date.now();
  saveDb();
}

function buildMyCardEmbed(userId) {
  const profile = db.profiles?.[userId];
  const pending = getPendingSubmissionForUser(userId);
  const displayName = getProfileDisplayName(userId);

  if (!profile && !pending) {
    return new EmbedBuilder()
      .setTitle("Моя карточка")
      .setDescription("У тебя ещё нет профиля. Нажми **Получить роль** чтобы начать.");
  }

  const lines = [`**Игрок:** ${displayName}`];
  if (profile?.mainCharacterLabels?.length) {
    lines.push(`**Мейны:** ${profile.mainCharacterLabels.join(", ")}`);
  }
  if (Number.isFinite(profile?.approvedKills)) {
    lines.push(`**Kills:** ${formatNumber(profile.approvedKills)}`);
    lines.push(`**Тир:** ${profile.killTier} (${formatTierLabel(profile.killTier)})`);
  }
  if (profile?.lastSubmissionStatus) {
    lines.push(`**Статус последней заявки:** ${profile.lastSubmissionStatus}`);
  }
  if (pending) {
    lines.push("");
    lines.push(`⏳ **Pending-заявка:** kills ${pending.kills}, ${formatTierLabel(pending.derivedTier)} — ожидает проверки.`);
  }

  return new EmbedBuilder().setTitle("Моя карточка").setDescription(lines.join("\n"));
}

function getApprovedTierlistEntries() {
  return Object.entries(db.profiles || {})
    .map(([userId, profile]) => ({
      userId,
      profile,
      approvedKills: Number(profile?.approvedKills),
      killTier: Number(profile?.killTier),
      displayName: getProfileDisplayName(userId, profile),
      mains: Array.isArray(profile?.mainCharacterLabels) ? profile.mainCharacterLabels : [],
      updatedAt: profile?.updatedAt || null,
    }))
    .filter((entry) => Number.isFinite(entry.approvedKills) && entry.approvedKills >= 0 && Number.isFinite(entry.killTier) && entry.killTier >= 1)
    .sort((left, right) => {
      if (right.approvedKills !== left.approvedKills) return right.approvedKills - left.approvedKills;
      return left.displayName.localeCompare(right.displayName, "ru");
    });
}

function getTierlistStats(entries) {
  const pendingCount = Object.values(db.submissions || {}).filter((submission) => isSubmissionActive(submission)).length;
  const totalsByTier = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let totalKills = 0;

  for (const entry of entries) {
    totalKills += entry.approvedKills;
    if (totalsByTier[entry.killTier] !== undefined) totalsByTier[entry.killTier] += 1;
  }

  const averageKills = entries.length ? Math.round(totalKills / entries.length) : 0;
  const medianKills = entries.length
    ? entries[Math.floor((entries.length - 1) / 2)].approvedKills
    : 0;

  return {
    totalVerified: entries.length,
    pendingCount,
    totalKills,
    averageKills,
    medianKills,
    totalsByTier,
    topEntry: entries[0] || null,
    bottomEntry: entries[entries.length - 1] || null,
  };
}

function buildTierlistEmbeds() {
  const entries = getApprovedTierlistEntries();
  const stats = getTierlistStats(entries);

  if (!entries.length) {
    return {
      embeds: [
        new EmbedBuilder()
          .setTitle(appConfig.ui.tierlistTitle || "Текстовый тир-лист")
          .setDescription([
            "Пока нет подтверждённых игроков в тир-листе.",
            `Pending заявок: **${stats.pendingCount}**`,
          ].join("\n")),
      ],
      flags: MessageFlags.Ephemeral,
    };
  }

  const summaryLines = [
    `Подтверждено игроков: **${formatNumber(stats.totalVerified)}**`,
    `Pending заявок: **${formatNumber(stats.pendingCount)}**`,
    `Суммарно kills: **${formatNumber(stats.totalKills)}**`,
    `Среднее kills: **${formatNumber(stats.averageKills)}**`,
    `Медиана kills: **${formatNumber(stats.medianKills)}**`,
    `Tier 5/4/3/2/1: **${stats.totalsByTier[5]} / ${stats.totalsByTier[4]} / ${stats.totalsByTier[3]} / ${stats.totalsByTier[2]} / ${stats.totalsByTier[1]}**`,
    `Топ 1: **${stats.topEntry.displayName}** — **${formatNumber(stats.topEntry.approvedKills)}** kills`,
    `Последний в листе: **${stats.bottomEntry.displayName}** — **${formatNumber(stats.bottomEntry.approvedKills)}** kills`,
  ];

  const embeds = [
    new EmbedBuilder()
      .setTitle(appConfig.ui.tierlistTitle || "Текстовый тир-лист")
      .setDescription(summaryLines.join("\n")),
  ];

  let chunk = [];
  let chunkStart = 1;
  let chunkLength = 0;

  const flushChunk = () => {
    if (!chunk.length) return;
    embeds.push(
      new EmbedBuilder()
        .setTitle(`Рейтинг #${chunkStart}-${chunkStart + chunk.length - 1}`)
        .setDescription(chunk.join("\n"))
    );
    chunk = [];
    chunkLength = 0;
  };

  entries.forEach((entry, index) => {
    const lineNumber = index + 1;
    const line = `${lineNumber}. [T${entry.killTier}] ${entry.displayName} — ${formatNumber(entry.approvedKills)} kills • mains: ${entry.mains.length ? entry.mains.join(", ") : "—"}`;
    if (!chunk.length) chunkStart = lineNumber;

    if (chunk.length >= 15 || chunkLength + line.length + 1 > 3800) {
      flushChunk();
      chunkStart = lineNumber;
    }

    chunk.push(line);
    chunkLength += line.length + 1;
  });

  flushChunk();

  return { embeds, flags: MessageFlags.Ephemeral };
}

function buildTierlistBoardPayload() {
  const payload = buildTierlistEmbeds();
  return {
    content: "Текстовый тир-лист. Полный порядок игроков находится в этом сообщении и обновляется автоматически.",
    embeds: payload.embeds.slice(0, 10),
    components: [],
  };
}

async function buildGraphicTierlistBoardPayload(client) {
  const entries = getApprovedTierlistEntries();
  const stats = getTierlistStats(entries);
  const guild = await getGuild(client);
  const gfx = getGraphicTierlistConfig();
  const imgCfg = getGraphicImageConfig();

  let pngBuffer = null;
  if (isPureimageAvailable()) {
    try {
      pngBuffer = await renderGraphicTierlistPng({
        client,
        guild,
        entries,
        title: getEffectiveGraphicTitle(),
        tierLabels: { ...appConfig.killTierLabels, ...(gfx.tierLabels || {}) },
        tierColors: getEffectiveTierColors(),
        imageWidth: imgCfg.W,
        imageHeight: imgCfg.H,
        imageIcon: imgCfg.ICON,
      });
      gfx.lastUpdated = Date.now();
      saveDb();
    } catch (err) {
      console.error("PNG tierlist render failed:", err?.message || err);
    }
  }

  const tierSummary = [1, 2, 3, 4, 5].map((tier) => {
    const count = stats.totalsByTier[tier] || 0;
    return `${formatTierLabel(tier)}: **${count}**`;
  }).join(" | ");

  const topLines = entries.slice(0, 5).map((entry, index) =>
    `**#${index + 1}** ${entry.displayName} — ${formatNumber(entry.approvedKills)} kills (${formatTierLabel(entry.killTier)})`
  );

  const description = [
    getEffectiveMessageText(),
    "",
    tierSummary,
    "",
    topLines.length ? topLines.join("\n") : "Пока нет подтверждённых игроков.",
    "",
    `Всего: **${formatNumber(stats.totalVerified)}** | Kills: **${formatNumber(stats.totalKills)}** | Среднее: **${formatNumber(stats.averageKills)}**`,
  ].join("\n");

  const embedBuilder = new EmbedBuilder()
    .setTitle(getEffectiveGraphicTitle())
    .setDescription(description);

  const files = [];
  if (pngBuffer) {
    files.push(new AttachmentBuilder(pngBuffer, { name: "tierlist.png" }));
    embedBuilder.setImage("attachment://tierlist.png");
  }

  const components = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("graphic_refresh").setLabel("Обновить PNG").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("graphic_panel").setLabel("PNG панель").setStyle(ButtonStyle.Primary)
    ),
  ];

  return {
    content: "Графический тир-лист. Ниже бот поддерживает полный текстовый рейтинг тем же порядком.",
    embeds: [embedBuilder],
    files,
    components,
  };
}

function buildGraphicPanelTierSelect() {
  const gfx = getGraphicTierlistConfig();
  const selected = Number(gfx.panel?.selectedTier) || 5;
  const options = [5, 4, 3, 2, 1].map((t) => ({
    label: `Тир ${t} — ${formatTierLabel(t)}`,
    value: String(t),
    default: t === selected,
  }));
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId("graphic_panel_select_tier").setPlaceholder("Выбрать тир").addOptions(options)
  );
}

function buildGraphicPanelPayload() {
  const gfx = getGraphicTierlistConfig();
  const cfg = getGraphicImageConfig();
  const selectedTier = Number(gfx.panel?.selectedTier) || 5;
  const tierColors = getEffectiveTierColors();
  const tierColor = tierColors[selectedTier] || DEFAULT_GRAPHIC_TIER_COLORS[selectedTier];

  const embed = new EmbedBuilder()
    .setTitle("PNG Panel")
    .setDescription([
      `**Title:** ${getEffectiveGraphicTitle()}`,
      `**Картинка:** ${cfg.W}×${cfg.H}`,
      `**Иконки:** ${cfg.ICON}px`,
      `**Выбранный тир:** ${selectedTier} → **${formatTierLabel(selectedTier)}**`,
      `**Цвет тира:** ${tierColor}`,
      `**Текст сообщения:** ${previewGraphicMessageText(170)}`,
      "",
      "Панель меняет только PNG-контур и связанные подписи и цвета.",
    ].join("\n"));

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("graphic_panel_refresh").setLabel("Пересобрать").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("graphic_panel_title").setLabel("Название PNG").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("graphic_panel_message_text").setLabel("Текст сообщения").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("graphic_panel_rename").setLabel("Переименовать тир").setStyle(ButtonStyle.Primary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("graphic_panel_icon_minus").setLabel("Иконки −").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("graphic_panel_icon_plus").setLabel("Иконки +").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("graphic_panel_w_minus").setLabel("Ширина −").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("graphic_panel_w_plus").setLabel("Ширина +").setStyle(ButtonStyle.Secondary)
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("graphic_panel_h_minus").setLabel("Высота −").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("graphic_panel_h_plus").setLabel("Высота +").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("graphic_panel_set_color").setLabel("Цвет тира").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("graphic_panel_reset_color").setLabel("Сброс цвета тира").setStyle(ButtonStyle.Secondary)
  );

  const row4 = buildGraphicPanelTierSelect();

  const row5 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("graphic_panel_reset_img").setLabel("Сбросить размеры").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("graphic_panel_reset_colors").setLabel("Сбросить все цвета").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("graphic_panel_clear_cache").setLabel("Сбросить кэш ав").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("graphic_panel_fonts").setLabel("Шрифты").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("graphic_panel_close").setLabel("Закрыть").setStyle(ButtonStyle.Danger)
  );

  return ephemeralPayload({ embeds: [embed], components: [row1, row2, row3, row4, row5] });
}

function sanitizeFileName(name, fallbackExt = "png") {
  const base = String(name || "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);

  if (!base) return `proof.${fallbackExt}`;
  if (!/\.[a-z0-9]{2,5}$/i.test(base)) return `${base}.${fallbackExt}`;
  return base;
}

function isImageAttachment(attachment) {
  if (!attachment) return false;
  const contentType = String(attachment.contentType || "");
  if (contentType.startsWith("image/")) return true;
  const url = String(attachment.url || "").toLowerCase();
  return /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url);
}

async function downloadToBuffer(url, timeoutMs = 15000) {
  const headers = {
    "User-Agent": "Mozilla/5.0 JujutsuWelcomeBot/1.0",
    "Accept": "image/avif,image/webp,image/apng,image/png,image/jpeg,*/*;q=0.8",
  };

  if (typeof fetch === "function") {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal, headers });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } finally {
      clearTimeout(timer);
    }
  }

  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https:") ? https : http;
    const request = lib.get(url, { headers }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        downloadToBuffer(response.headers.location, timeoutMs).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve(Buffer.concat(chunks)));
    });

    request.on("error", reject);
    request.setTimeout(timeoutMs, () => request.destroy(new Error("timeout")));
  });
}

function getCharacterEntries() {
  const generatedRoles = getGeneratedRoleState();
  return appConfig.characters.map((entry) => ({
    id: String(entry.id).trim(),
    label: String(entry.label).trim(),
    roleId: String(entry.roleId || generatedRoles.characters?.[String(entry.id).trim()] || "").trim(),
  }));
}

function getCharacterById(characterId) {
  return getCharacterEntries().find((entry) => entry.id === characterId) || null;
}

function getCharacterRoleIds() {
  return getCharacterEntries().map((entry) => entry.roleId).filter(Boolean);
}

function getSelectedCharacterEntries(characterIds) {
  return characterIds.map((characterId) => getCharacterById(characterId)).filter(Boolean);
}

async function ensureRoleByName(guild, roleName, explicitRoleId = "") {
  const normalizedName = String(roleName || "").trim();
  const preferredRoleId = String(explicitRoleId || "").trim();
  if (!normalizedName) return null;

  if (preferredRoleId && !isPlaceholder(preferredRoleId)) {
    const exact = await guild.roles.fetch(preferredRoleId).catch(() => null);
    if (exact) return exact;
  }

  await guild.roles.fetch().catch(() => null);
  const foundByName = guild.roles.cache.find((role) => role.name === normalizedName) || null;
  if (foundByName) return foundByName;

  return guild.roles.create({
    name: normalizedName,
    permissions: BigInt(0),
    hoist: false,
    mentionable: false,
    reason: "Auto-created by onboarding bot",
  });
}

async function ensureManagedRoles(client) {
  const guild = await getGuild(client);
  if (!guild) return { characterRoles: 0, tierRoles: 0 };

  const generatedRoles = getGeneratedRoleState();
  let createdCharacterRoles = 0;
  let createdTierRoles = 0;
  let changed = false;

  for (const entry of appConfig.characters) {
    const characterId = String(entry.id || "").trim();
    const roleName = String(entry.label || "").trim();
    const explicitRoleId = String(entry.roleId || generatedRoles.characters?.[characterId] || "").trim();
    if (!characterId || !roleName) continue;

    const role = await ensureRoleByName(guild, roleName, explicitRoleId);
    if (!role) continue;
    if (!explicitRoleId || role.id !== explicitRoleId) createdCharacterRoles += 1;
    if (generatedRoles.characters[characterId] !== role.id) {
      generatedRoles.characters[characterId] = role.id;
      changed = true;
    }
  }

  for (const tier of [1, 2, 3, 4, 5]) {
    const tierKey = String(tier);
    const roleName = formatTierLabel(tier);
    const explicitRoleId = String(appConfig.roles.killTierRoleIds?.[tierKey] || generatedRoles.tiers?.[tierKey] || "").trim();
    const role = await ensureRoleByName(guild, roleName, explicitRoleId);
    if (!role) continue;
    if (!explicitRoleId || role.id !== explicitRoleId) createdTierRoles += 1;
    if (generatedRoles.tiers[tierKey] !== role.id) {
      generatedRoles.tiers[tierKey] = role.id;
      changed = true;
    }
  }

  if (changed) saveDb();
  return { characterRoles: createdCharacterRoles, tierRoles: createdTierRoles };
}

async function applyMainSelection(client, member, user, selectedCharacterIds, reason = "main character sync") {
  void client;
  const normalizedIds = [...new Set((selectedCharacterIds || []).map((value) => String(value || "").trim()).filter(Boolean))].slice(0, 2);
  const selectedEntries = await syncManagedCharacterRoles(member, normalizedIds, reason);

  const profile = getProfile(user.id);
  profile.displayName = member.displayName || user.username;
  profile.username = user.username;
  profile.mainCharacterIds = selectedEntries.map((entry) => entry.id);
  profile.mainCharacterLabels = selectedEntries.map((entry) => entry.label);
  profile.characterRoleIds = selectedEntries.map((entry) => entry.roleId);
  profile.updatedAt = nowIso();
  saveDb();

  return selectedEntries;
}

async function syncPendingSubmissionMainsForUser(client, userId, selectedEntries) {
  const pending = getPendingSubmissionForUser(userId);
  if (!pending) return false;

  pending.mainCharacterIds = selectedEntries.map((entry) => entry.id);
  pending.mainCharacterLabels = selectedEntries.map((entry) => entry.label);
  pending.mainRoleIds = selectedEntries.map((entry) => entry.roleId);
  saveDb();

  const reviewMessage = await fetchReviewMessage(client, pending);
  if (reviewMessage) {
    await reviewMessage.edit({
      embeds: [buildReviewEmbed(pending, "pending", [{ name: "Обновление", value: "Пользователь обновил мейнов", inline: false }])],
      components: [buildReviewButtons(pending.id)],
    }).catch(() => {});
  }

  return true;
}

function getWelcomePanelState() {
  db.config.welcomePanel ||= { channelId: appConfig.channels.welcomeChannelId, messageId: "" };
  if (!db.config.welcomePanel.channelId) db.config.welcomePanel.channelId = appConfig.channels.welcomeChannelId;
  return db.config.welcomePanel;
}

function getTierlistBoardState() {
  db.config.tierlistBoard ||= { channelId: appConfig.channels.tierlistChannelId || "", graphicMessageId: "", textMessageId: "" };
  if (db.config.tierlistBoard.messageId && !db.config.tierlistBoard.textMessageId) {
    db.config.tierlistBoard.textMessageId = db.config.tierlistBoard.messageId;
  }
  db.config.tierlistBoard.graphicMessageId ||= "";
  db.config.tierlistBoard.textMessageId ||= "";
  if (!db.config.tierlistBoard.channelId && appConfig.channels.tierlistChannelId) {
    db.config.tierlistBoard.channelId = appConfig.channels.tierlistChannelId;
  }
  return db.config.tierlistBoard;
}

function getGraphicTierlistConfig() {
  db.config.graphicTierlist ||= { title: "", tierColors: {}, tierLabels: {}, image: { width: null, height: null, icon: null }, panel: { selectedTier: 5 }, messageText: "", lastUpdated: null };
  db.config.graphicTierlist.image ||= { width: null, height: null, icon: null };
  db.config.graphicTierlist.panel ||= { selectedTier: 5 };
  return db.config.graphicTierlist;
}

function getGraphicImageConfig() {
  const cfg = getGraphicTierlistConfig();
  const img = cfg.image || {};
  return {
    W: Math.max(1200, Number(img.width) || 2000),
    H: Math.max(700, Number(img.height) || 1200),
    ICON: Math.max(64, Math.min(256, Number(img.icon) || 112)),
  };
}

function getEffectiveTierColors() {
  const gfx = getGraphicTierlistConfig();
  return { ...DEFAULT_GRAPHIC_TIER_COLORS, ...(appConfig.graphicTierlist?.tierColors || {}), ...(gfx.tierColors || {}) };
}

function getEffectiveGraphicTitle() {
  const gfx = getGraphicTierlistConfig();
  return gfx.title || appConfig.graphicTierlist?.title || "Графический тир-лист";
}

function getEffectiveMessageText() {
  const gfx = getGraphicTierlistConfig();
  return gfx.messageText || appConfig.graphicTierlist?.subtitle || "Подтверждённые игроки и текущая расстановка по kills";
}

function previewGraphicMessageText(maxLen = 170) {
  const text = getEffectiveMessageText();
  return text.length > maxLen ? text.slice(0, maxLen) + "…" : text;
}

function getProfile(userId) {
  db.profiles[userId] ||= {
    userId,
    displayName: "",
    username: "",
    mainCharacterIds: [],
    mainCharacterLabels: [],
    characterRoleIds: [],
    approvedKills: null,
    killTier: null,
    accessGrantedAt: null,
    updatedAt: null,
    lastSubmissionId: null,
    lastSubmissionStatus: null,
    lastReviewedAt: null,
  };
  return db.profiles[userId];
}

function scheduleDeleteMessage(message, delayMs = TEMP_MESSAGE_DELETE_MS) {
  if (!message) return;
  setTimeout(() => {
    message.delete().catch(() => {});
  }, delayMs);
}

function isSubmissionActive(submission) {
  return submission && submission.status === "pending" && hoursSince(submission.createdAt) <= PENDING_EXPIRE_HOURS;
}

function getPendingSubmissionForUser(userId) {
  const submissions = Object.values(db.submissions || {})
    .filter((submission) => submission.userId === userId && isSubmissionActive(submission))
    .sort((left, right) => Date.parse(right.createdAt || 0) - Date.parse(left.createdAt || 0));
  return submissions[0] || null;
}

function getLatestSubmissionForUser(userId) {
  const submissions = Object.values(db.submissions || {})
    .filter((submission) => submission.userId === userId)
    .sort((left, right) => Date.parse(right.reviewedAt || right.createdAt || 0) - Date.parse(left.reviewedAt || left.createdAt || 0));
  return submissions[0] || null;
}

function setMainDraft(userId, characterIds) {
  mainDrafts.set(userId, { characterIds: [...characterIds], createdAt: Date.now() });
}

function getMainDraft(userId) {
  const draft = mainDrafts.get(userId);
  if (!draft) return null;
  if (Date.now() - Number(draft.createdAt || 0) > SUBMIT_SESSION_EXPIRE_MS) {
    mainDrafts.delete(userId);
    return null;
  }
  return draft;
}

function clearMainDraft(userId) {
  mainDrafts.delete(userId);
}

function setSubmitSession(userId, value) {
  submitSessions.set(userId, { ...value, createdAt: Date.now() });
}

function getSubmitSession(userId) {
  const session = submitSessions.get(userId);
  if (!session) return null;
  if (Date.now() - Number(session.createdAt || 0) > SUBMIT_SESSION_EXPIRE_MS) {
    submitSessions.delete(userId);
    return null;
  }
  return session;
}

function clearSubmitSession(userId) {
  submitSessions.delete(userId);
}

async function getGuild(client) {
  if (guildCache) return guildCache;
  guildCache = await client.guilds.fetch(GUILD_ID).catch(() => null);
  return guildCache;
}

function isModerator(member) {
  if (!member) return false;
  if (member.permissions?.has?.(PermissionsBitField.Flags.Administrator)) return true;
  return member.roles?.cache?.has?.(appConfig.roles.moderatorRoleId) || false;
}

async function logLine(client, text) {
  const logChannelId = String(appConfig.channels.logChannelId || "").trim();
  if (!logChannelId) return;
  const channel = await client.channels.fetch(logChannelId).catch(() => null);
  if (channel?.isTextBased()) await channel.send(text).catch(() => {});
}

async function dmUser(client, userId, text) {
  const user = await client.users.fetch(userId).catch(() => null);
  if (!user) return;
  await user.send(text).catch(() => {});
}

function hasApprovedTierProfile(userId) {
  const profile = db.profiles?.[userId];
  return Number.isFinite(Number(profile?.approvedKills)) && Number.isFinite(Number(profile?.killTier));
}

function getMissingTierlistText() {
  const base = String(appConfig.reminders?.missingTierlistText || "").trim() || "Враг народа избегает получения роли!!! Не будь врагом!!! Стань товарищем!!!";
  return [
    base,
    `Получить роль и отправить заявку можно тут: <#${appConfig.channels.welcomeChannelId}>`,
  ].join("\n");
}

function getReminderImagePath() {
  const raw = String(appConfig.reminders?.missingTierlistImagePath || "").trim();
  if (raw) return path.isAbsolute(raw) ? raw : path.resolve(PROJECT_ROOT, raw);
  if (fs.existsSync(DEFAULT_REMINDER_POSTER_PATH)) return DEFAULT_REMINDER_POSTER_PATH;
  return "";
}

function buildMissingTierlistReminderPayload() {
  const content = getMissingTierlistText();
  const imageUrl = String(appConfig.reminders?.missingTierlistImageUrl || "").trim();
  const imagePath = getReminderImagePath();

  if (imagePath && fs.existsSync(imagePath)) {
    const fileName = sanitizeFileName(path.basename(imagePath) || "missing-tierlist-image.png");
    const isSvg = /\.svg$/i.test(fileName);
    const payload = { content, files: [new AttachmentBuilder(imagePath, { name: fileName })] };
    if (!isSvg) {
      payload.embeds = [new EmbedBuilder().setImage(`attachment://${fileName}`)];
    }
    return payload;
  }

  if (imageUrl) {
    return {
      content,
      embeds: [new EmbedBuilder().setImage(imageUrl)],
    };
  }

  return { content };
}

async function getMembersMissingTierlist(client) {
  const guild = await getGuild(client);
  if (!guild) return [];

  await guild.members.fetch();
  return guild.members.cache.filter((member) => !member.user.bot && !hasApprovedTierProfile(member.id));
}

async function sendMissingTierlistReminder(client) {
  const members = await getMembersMissingTierlist(client);
  const payload = buildMissingTierlistReminderPayload();

  let sent = 0;
  let failed = 0;
  for (const member of members.values()) {
    try {
      await member.send(payload);
      sent += 1;
    } catch {
      failed += 1;
    }
  }

  await logLine(client, `REMIND_MISSING_TIERLIST: sent=${sent}, failed=${failed}, total=${members.size}`);
  return { total: members.size, sent, failed };
}

async function fetchMember(client, userId) {
  const guild = await getGuild(client);
  if (!guild) return null;
  return guild.members.fetch(userId).catch(() => null);
}

async function syncManagedCharacterRoles(member, selectedCharacterIds, reason = "main character sync") {
  const selectedEntries = getSelectedCharacterEntries(selectedCharacterIds);
  const selectedRoleIds = new Set(selectedEntries.map((entry) => entry.roleId).filter(Boolean));
  const allManagedRoleIds = getCharacterRoleIds();

  for (const roleId of allManagedRoleIds) {
    if (member.roles.cache.has(roleId) && !selectedRoleIds.has(roleId)) {
      await member.roles.remove(roleId, reason).catch(() => {});
    }
  }

  for (const roleId of selectedRoleIds) {
    if (!member.roles.cache.has(roleId)) {
      await member.roles.add(roleId, reason).catch(() => {});
    }
  }

  return selectedEntries;
}

function getTierRoleId(tier) {
  const tierKey = String(tier);
  const generatedRoles = getGeneratedRoleState();
  return String(appConfig.roles.killTierRoleIds?.[tierKey] || generatedRoles.tiers?.[tierKey] || "").trim();
}

function getAllTierRoleIds() {
  return [1, 2, 3, 4, 5].map((tier) => getTierRoleId(tier)).filter(Boolean);
}

async function ensureSingleTierRole(client, userId, targetTier, reason = "kill tier sync") {
  const member = await fetchMember(client, userId);
  if (!member) return;

  const targetRoleId = getTierRoleId(targetTier);
  const allTierRoleIds = getAllTierRoleIds();

  for (const roleId of allTierRoleIds) {
    if (roleId !== targetRoleId && member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId, reason).catch(() => {});
    }
  }

  if (targetRoleId && !member.roles.cache.has(targetRoleId)) {
    await member.roles.add(targetRoleId, reason).catch(() => {});
  }
}

async function clearTierRoles(client, userId, reason = "clear kill tier") {
  const member = await fetchMember(client, userId);
  if (!member) return;

  for (const roleId of getAllTierRoleIds()) {
    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId, reason).catch(() => {});
    }
  }
}

async function grantAccessRole(client, userId, reason = "welcome application submitted") {
  const member = await fetchMember(client, userId);
  if (!member) return false;
  const accessRoleId = appConfig.roles.accessRoleId;
  if (!member.roles.cache.has(accessRoleId)) {
    await member.roles.add(accessRoleId, reason).catch(() => {});
  }
  return true;
}

function buildWelcomeEmbed() {
  const title = appConfig.welcomeEmbed?.title || appConfig.ui.welcomeTitle || "Jujutsu Shinigans Onboarding";
  const desc = appConfig.welcomeEmbed?.description || appConfig.ui.welcomeDescription || "Нажми кнопку ниже, выбери мейнов, укажи kills и отправь скрин.";
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription([
      desc,
      "",
      "1. Нажми **Получить роль**.",
      "2. Выбери **1 или 2** мейнов.",
      "3. Введи **точное количество kills**.",
      "4. Следующим сообщением отправь **скрин** в этот канал.",
      "5. Бот удалит скрин после обработки, сразу даст access-role, а kill-tier прилетит после проверки модератором.",
    ].join("\n"));
}

function buildWelcomeComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("onboard_begin")
        .setLabel(appConfig.ui.getRoleButtonLabel || "Получить роль")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("onboard_quick_mains")
        .setLabel("Быстро сменить мейнов")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("onboard_my_card")
        .setLabel("Моя карточка")
        .setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("welcome_editor")
        .setLabel("Редактор")
        .setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function buildCharacterPickerPayload(mode = "full") {
  const characterEntries = getCharacterEntries();
  if (!characterEntries.length) {
    return ephemeralPayload({ content: "Нет доступных персонажей. Проверь конфигурацию characters в bot.config.json." });
  }

  const isQuick = mode === "quick";
  const embed = new EmbedBuilder()
    .setTitle("Выбери мейнов")
    .setDescription(
      isQuick
        ? "Можно выбрать одного или двух персонажей. Этот режим быстро обновляет только мейнов и роли, без новой заявки по kills."
        : "Можно выбрать одного или двух персонажей. После выбора сразу откроется окно для точного количества kills."
    );

  const maxSelectable = Math.min(2, characterEntries.length);
  const select = new StringSelectMenuBuilder()
    .setCustomId(isQuick ? "onboard_pick_characters_quick" : "onboard_pick_characters")
    .setPlaceholder(maxSelectable === 1 ? "Выбери мейна" : "Выбери 1 или 2 мейнов")
    .setMinValues(1)
    .setMaxValues(maxSelectable)
    .addOptions(characterEntries.map((entry) => ({ label: normalizeCharacterSelectLabel(entry.label), value: getCharacterSelectValue(entry.id) })));

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(select),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("onboard_cancel").setLabel("Отмена").setStyle(ButtonStyle.Secondary)
      ),
    ],
    flags: MessageFlags.Ephemeral,
  };
}

function buildReviewButtons(submissionId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`approve:${submissionId}`).setLabel("Approve").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`edit:${submissionId}`).setLabel("Edit kills").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`reject:${submissionId}`).setLabel("Reject").setStyle(ButtonStyle.Danger)
  );
}

function buildReviewEmbed(submission, statusLabel, extraFields = []) {
  const embed = new EmbedBuilder()
    .setTitle(`Welcome-заявка (${statusLabel})`)
    .setDescription([
      `Игрок: <@${submission.userId}> (${submission.displayName})`,
      `Мейны: **${submission.mainCharacterLabels.join(", ")}**`,
      `Kills: **${submission.kills}**`,
      `Tier по kills: **${submission.derivedTier}** (${formatTierLabel(submission.derivedTier)})`,
      `ID: \`${submission.id}\``,
      `Создано: **${formatDateTime(submission.createdAt)}**`,
    ].join("\n"))
    .setImage(submission.reviewImage || submission.screenshotUrl);

  if (extraFields.length) embed.addFields(...extraFields);
  return embed;
}

function getMessageComponentCustomIds(message) {
  return (message?.components || [])
    .flatMap((row) => row.components || [])
    .map((component) => String(component.customId || "").trim())
    .filter(Boolean);
}

function messageHasRequiredCustomIds(message, requiredIds) {
  const customIds = new Set(getMessageComponentCustomIds(message));
  return requiredIds.every((customId) => customIds.has(customId));
}

function messageHasEmbedTitle(message, title) {
  return (message?.embeds || []).some((embed) => String(embed?.title || "").trim() === String(title || "").trim());
}

function messageHasAttachmentName(message, fileName) {
  return message?.attachments?.some?.((attachment) => String(attachment?.name || "").trim() === fileName) || false;
}

async function findManagedMessageInChannel(channel, predicate, limit = 75) {
  if (!channel?.isTextBased()) return null;

  const pinned = await channel.messages.fetchPins().catch(() => null);
  if (pinned?.size) {
    const pinnedMatch = [...pinned.values()]
      .sort((left, right) => Number(right.createdTimestamp || 0) - Number(left.createdTimestamp || 0))
      .find(predicate);
    if (pinnedMatch) return pinnedMatch;
  }

  const recent = await channel.messages.fetch({ limit }).catch(() => null);
  if (!recent?.size) return null;

  return [...recent.values()]
    .sort((left, right) => Number(right.createdTimestamp || 0) - Number(left.createdTimestamp || 0))
    .find(predicate) || null;
}

async function findExistingWelcomePanelMessage(channel) {
  const botId = client.user?.id;
  return findManagedMessageInChannel(
    channel,
    (message) => message.author?.id === botId && messageHasRequiredCustomIds(message, ["onboard_begin", "onboard_quick_mains"])
  );
}

async function findExistingGraphicTierlistMessage(channel) {
  const botId = client.user?.id;
  return findManagedMessageInChannel(
    channel,
    (message) =>
      message.author?.id === botId &&
      (messageHasRequiredCustomIds(message, ["graphic_refresh", "graphic_panel"]) ||
      String(message?.content || "").startsWith("Графический тир-лист.") ||
      messageHasEmbedTitle(message, getEffectiveGraphicTitle()) ||
      messageHasAttachmentName(message, "tierlist.png") ||
      messageHasAttachmentName(message, "graphic-tierlist.svg"))
  );
}

async function findExistingTextTierlistMessage(channel) {
  const botId = client.user?.id;
  return findManagedMessageInChannel(
    channel,
    (message) =>
      message.author?.id === botId &&
      (String(message?.content || "").startsWith("Текстовый тир-лист.") ||
      messageHasEmbedTitle(message, appConfig.ui.tierlistTitle || "Текстовый тир-лист"))
  );
}

async function ensureWelcomePanel(client) {
  const panelState = getWelcomePanelState();
  const channel = await client.channels.fetch(panelState.channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    throw new Error("welcomeChannelId не указывает на текстовый канал");
  }

  let message = null;
  if (panelState.messageId) {
    message = await channel.messages.fetch(panelState.messageId).catch(() => null);
  }
  if (!message) {
    message = await findExistingWelcomePanelMessage(channel);
    if (message && panelState.messageId !== message.id) {
      panelState.messageId = message.id;
      saveDb();
    }
  }

  const payload = {
    embeds: [buildWelcomeEmbed()],
    components: buildWelcomeComponents(),
  };

  if (!message) {
    message = await channel.send(payload);
    panelState.messageId = message.id;
    try {
      await message.pin();
    } catch {}
  } else {
    await message.edit(payload);
    if (!message.pinned) {
      await message.pin().catch(() => {});
    }
  }

  saveDb();
  return message;
}

async function ensureTierlistBoardMessage(client) {
  return ensureTextTierlistBoardMessage(client);
}

async function ensureGraphicTierlistBoardMessage(client) {
  const state = getTierlistBoardState();
  const channelId = state.channelId || appConfig.channels.tierlistChannelId;
  if (!channelId || isPlaceholder(channelId)) return null;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    console.warn("tierlistChannelId не указывает на текстовый канал, пропускаем graphic board");
    return null;
  }

  let message = null;
  if (state.graphicMessageId) {
    message = await channel.messages.fetch(state.graphicMessageId).catch(() => null);
  }
  if (!message) {
    message = await findExistingGraphicTierlistMessage(channel);
    if (message && state.graphicMessageId !== message.id) {
      state.graphicMessageId = message.id;
      saveDb();
    }
  }

  const payload = await buildGraphicTierlistBoardPayload(client);
  const created = !message;
  if (!message) {
    message = await channel.send(payload);
    state.graphicMessageId = message.id;
    try {
      await message.pin();
    } catch {}
  } else {
    await message.edit({ ...payload, attachments: [] });
    if (!message.pinned) {
      await message.pin().catch(() => {});
    }
  }

  state.channelId = channelId;
  saveDb();
  return { message, created };
}

async function ensureTextTierlistBoardMessage(client, options = {}) {
  const state = getTierlistBoardState();
  const channelId = state.channelId || appConfig.channels.tierlistChannelId;
  if (!channelId || isPlaceholder(channelId)) return null;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    console.warn("tierlistChannelId не указывает на текстовый канал, пропускаем text board");
    return null;
  }

  if (options.forceRecreate && state.textMessageId) {
    const existing = await channel.messages.fetch(state.textMessageId).catch(() => null);
    if (existing) await existing.delete().catch(() => {});
    state.textMessageId = "";
  }

  let message = null;
  if (state.textMessageId) {
    message = await channel.messages.fetch(state.textMessageId).catch(() => null);
  }
  if (!message) {
    message = await findExistingTextTierlistMessage(channel);
    if (message && state.textMessageId !== message.id) {
      state.textMessageId = message.id;
      saveDb();
    }
  }

  const payload = buildTierlistBoardPayload();
  if (!message) {
    message = await channel.send(payload);
    state.textMessageId = message.id;
    try {
      await message.pin();
    } catch {}
  } else {
    await message.edit(payload);
    if (!message.pinned) {
      await message.pin().catch(() => {});
    }
  }

  state.channelId = channelId;
  saveDb();
  return message;
}

async function refreshTierlistBoard(client) {
  try {
    const state = getTierlistBoardState();
    const hadGraphicMessage = Boolean(state.graphicMessageId);
    await ensureGraphicTierlistBoardMessage(client);
    await ensureTextTierlistBoardMessage(client, { forceRecreate: !hadGraphicMessage && Boolean(state.textMessageId) });
    return true;
  } catch (error) {
    console.error("Tierlist board refresh failed:", error?.message || error);
    return false;
  }
}

async function fetchReviewMessage(client, submission) {
  if (!submission?.reviewChannelId || !submission?.reviewMessageId) return null;
  const channel = await client.channels.fetch(submission.reviewChannelId).catch(() => null);
  if (!channel?.isTextBased()) return null;
  return channel.messages.fetch(submission.reviewMessageId).catch(() => null);
}

async function postReviewRecord(client, submission, fileAttachment = null, statusLabel = "pending", extraFields = [], components = []) {
  const channel = await client.channels.fetch(appConfig.channels.reviewChannelId).catch(() => null);
  if (!channel?.isTextBased()) throw new Error("reviewChannelId не указывает на текстовый канал");

  const payload = {
    embeds: [buildReviewEmbed(submission, statusLabel, extraFields)],
    components,
  };

  if (fileAttachment) payload.files = [fileAttachment];

  const sent = await channel.send(payload);
  submission.reviewChannelId = sent.channel.id;
  submission.reviewMessageId = sent.id;
  return sent;
}

function createReviewAttachmentFromBuffer(submissionId, buffer) {
  if (!buffer) return null;
  const fileName = sanitizeFileName(`${submissionId}_proof.png`);
  return new AttachmentBuilder(buffer, { name: fileName });
}

async function createPendingSubmissionFromAttachment(client, input) {
  const submissionId = makeId();
  const selectedEntries = getSelectedCharacterEntries(input.mainCharacterIds);
  const derivedTier = killTierFor(input.kills);

  let reviewAttachment = null;
  let reviewImage = input.screenshotUrl;

  try {
    const buffer = await downloadToBuffer(input.screenshotUrl);
    reviewAttachment = createReviewAttachmentFromBuffer(submissionId, buffer);
    if (reviewAttachment?.name) reviewImage = `attachment://${reviewAttachment.name}`;
  } catch {}

  const submission = {
    id: submissionId,
    userId: input.user.id,
    displayName: input.member?.displayName || input.user.username,
    username: input.user.username,
    mainCharacterIds: selectedEntries.map((entry) => entry.id),
    mainCharacterLabels: selectedEntries.map((entry) => entry.label),
    mainRoleIds: selectedEntries.map((entry) => entry.roleId),
    kills: input.kills,
    derivedTier,
    screenshotUrl: input.screenshotUrl,
    reviewImage,
    status: "pending",
    createdAt: nowIso(),
    reviewedAt: null,
    reviewedBy: null,
    rejectReason: null,
    reviewChannelId: null,
    reviewMessageId: null,
    reviewAttachmentUrl: "",
  };

  db.submissions[submissionId] = submission;

  const profile = getProfile(input.user.id);
  profile.mainCharacterIds = submission.mainCharacterIds;
  profile.mainCharacterLabels = submission.mainCharacterLabels;
  profile.characterRoleIds = submission.mainRoleIds;
  profile.displayName = submission.displayName;
  profile.username = submission.username;
  profile.lastSubmissionId = submission.id;
  profile.lastSubmissionStatus = "pending";
  profile.updatedAt = nowIso();
  setSubmitCooldown(input.user.id);
  saveDb();

  const reviewMessage = await postReviewRecord(client, submission, reviewAttachment, "pending", [], [buildReviewButtons(submissionId)]);
  const attachmentUrl = reviewMessage.attachments.first()?.url || "";
  if (attachmentUrl) {
    submission.reviewAttachmentUrl = attachmentUrl;
    if (!submission.reviewImage || submission.reviewImage.startsWith("attachment://")) {
      submission.reviewImage = attachmentUrl;
    }
    saveDb();
  }

  await refreshTierlistBoard(client);

  return submission;
}

async function expireSubmission(client, submission) {
  if (!submission || submission.status !== "pending") return;
  submission.status = "expired";
  submission.reviewedAt = nowIso();
  saveDb();

  const reviewMessage = await fetchReviewMessage(client, submission);
  if (reviewMessage) {
    await reviewMessage.edit({
      embeds: [buildReviewEmbed(submission, "expired")],
      components: [],
    }).catch(() => {});
  }

  await refreshTierlistBoard(client);
}

async function supersedePendingSubmissionsForUser(client, userId, moderatorTag) {
  let changed = 0;
  for (const submission of Object.values(db.submissions || {})) {
    if (!submission || submission.userId !== userId || submission.status !== "pending") continue;
    submission.status = "superseded";
    submission.reviewedAt = nowIso();
    submission.reviewedBy = moderatorTag;
    submission.rejectReason = "Заменено модератором напрямую";
    changed += 1;

    const reviewMessage = await fetchReviewMessage(client, submission);
    if (reviewMessage) {
      await reviewMessage.edit({
        embeds: [buildReviewEmbed(submission, "superseded", [{ name: "Причина", value: submission.rejectReason, inline: false }])],
        components: [],
      }).catch(() => {});
    }
  }

  if (changed) saveDb();
}

async function approveSubmission(client, submission, moderatorTag) {
  const tier = killTierFor(submission.kills);
  if (!tier) throw new Error("Не удалось вычислить tier по kills");

  submission.derivedTier = tier;
  submission.status = "approved";
  submission.reviewedAt = nowIso();
  submission.reviewedBy = moderatorTag;

  const profile = getProfile(submission.userId);
  profile.mainCharacterIds = submission.mainCharacterIds;
  profile.mainCharacterLabels = submission.mainCharacterLabels;
  profile.characterRoleIds = submission.mainRoleIds;
  profile.displayName = submission.displayName;
  profile.username = submission.username;
  profile.approvedKills = submission.kills;
  profile.killTier = tier;
  profile.lastSubmissionId = submission.id;
  profile.lastSubmissionStatus = "approved";
  profile.lastReviewedAt = submission.reviewedAt;
  profile.updatedAt = nowIso();
  saveDb();

  await ensureSingleTierRole(client, submission.userId, tier, "approved welcome submission");

  const reviewMessage = await fetchReviewMessage(client, submission);
  if (reviewMessage) {
    await reviewMessage.edit({
      embeds: [buildReviewEmbed(submission, "approved")],
      components: [],
    }).catch(() => {});
  }

  await dmUser(
    client,
    submission.userId,
    [
      "Твоя заявка одобрена.",
      `Kills: ${submission.kills}`,
      `Tier: ${submission.derivedTier} (${formatTierLabel(submission.derivedTier)})`,
    ].join("\n")
  );

  await logLine(client, `APPROVE: <@${submission.userId}> kills ${submission.kills} -> tier ${submission.derivedTier} by ${moderatorTag}`);
  await refreshTierlistBoard(client);
  saveDb();
}

async function rejectSubmission(client, submission, moderatorTag, reason) {
  submission.status = "rejected";
  submission.reviewedAt = nowIso();
  submission.reviewedBy = moderatorTag;
  submission.rejectReason = reason;

  const profile = getProfile(submission.userId);
  profile.lastSubmissionId = submission.id;
  profile.lastSubmissionStatus = "rejected";
  profile.lastReviewedAt = submission.reviewedAt;
  profile.updatedAt = nowIso();
  saveDb();

  const reviewMessage = await fetchReviewMessage(client, submission);
  if (reviewMessage) {
    await reviewMessage.edit({
      embeds: [buildReviewEmbed(submission, "rejected", [{ name: "Причина", value: reason, inline: false }])],
      components: [],
    }).catch(() => {});
  }

  await dmUser(
    client,
    submission.userId,
    [
      "Твоя заявка отклонена.",
      `Причина: ${reason}`,
      `Kills: ${submission.kills}`,
    ].join("\n")
  );

  await logLine(client, `REJECT: <@${submission.userId}> kills ${submission.kills} by ${moderatorTag} | reason: ${reason}`);
  await refreshTierlistBoard(client);
  saveDb();
}

async function updateSubmissionKills(client, submission, kills, moderatorTag) {
  submission.kills = kills;
  submission.derivedTier = killTierFor(kills);
  saveDb();

  const reviewMessage = await fetchReviewMessage(client, submission);
  if (reviewMessage) {
    await reviewMessage.edit({
      embeds: [buildReviewEmbed(submission, "pending", [{ name: "Изменено", value: `Kills исправил: ${moderatorTag}`, inline: false }])],
      components: [buildReviewButtons(submission.id)],
    }).catch(() => {});
  }
}

async function createManualApprovedRecord(client, targetUser, screenshotAttachment, kills, moderatorTag) {
  const member = await fetchMember(client, targetUser.id);
  const profile = getProfile(targetUser.id);
  const mainCharacterIds = [...(profile.mainCharacterIds || [])];
  const selectedEntries = getSelectedCharacterEntries(mainCharacterIds);
  const submissionId = makeId();
  const derivedTier = killTierFor(kills);

  let reviewAttachment = null;
  let reviewImage = screenshotAttachment.url;

  try {
    const buffer = await downloadToBuffer(screenshotAttachment.url);
    reviewAttachment = createReviewAttachmentFromBuffer(submissionId, buffer);
    if (reviewAttachment?.name) reviewImage = `attachment://${reviewAttachment.name}`;
  } catch {}

  const submission = {
    id: submissionId,
    userId: targetUser.id,
    displayName: member?.displayName || targetUser.username,
    username: targetUser.username,
    mainCharacterIds: selectedEntries.map((entry) => entry.id),
    mainCharacterLabels: selectedEntries.map((entry) => entry.label),
    mainRoleIds: selectedEntries.map((entry) => entry.roleId),
    kills,
    derivedTier,
    screenshotUrl: screenshotAttachment.url,
    reviewImage,
    status: "approved",
    createdAt: nowIso(),
    reviewedAt: nowIso(),
    reviewedBy: moderatorTag,
    rejectReason: null,
    reviewChannelId: null,
    reviewMessageId: null,
    reviewAttachmentUrl: "",
    manual: true,
  };

  db.submissions[submission.id] = submission;
  saveDb();

  const reviewMessage = await postReviewRecord(
    client,
    submission,
    reviewAttachment,
    "approved",
    [{ name: "Источник", value: `Ручное добавление модератором: ${moderatorTag}`, inline: false }],
    []
  );

  const attachmentUrl = reviewMessage.attachments.first()?.url || "";
  if (attachmentUrl) {
    submission.reviewAttachmentUrl = attachmentUrl;
    if (!submission.reviewImage || submission.reviewImage.startsWith("attachment://")) {
      submission.reviewImage = attachmentUrl;
    }
  }

  await approveSubmission(client, submission, moderatorTag);
  saveDb();
  return submission;
}

function buildProfilePayload(userId) {
  const profile = getProfile(userId);
  const pending = getPendingSubmissionForUser(userId);
  const latest = getLatestSubmissionForUser(userId);
  const tierlistEntries = getApprovedTierlistEntries();
  const rank = tierlistEntries.findIndex((entry) => entry.userId === userId);

  const lines = [];
  lines.push(`Имя: **${getProfileDisplayName(userId, profile)}**`);
  lines.push(`Мейны: **${profile.mainCharacterLabels?.length ? profile.mainCharacterLabels.join(", ") : "не выбраны"}**`);

  if (profile.approvedKills !== null && profile.killTier !== null) {
    lines.push(`Статус: **approved**`);
    lines.push(`Kills: **${profile.approvedKills}**`);
    lines.push(`Tier: **${profile.killTier}** (${formatTierLabel(profile.killTier)})`);
    if (rank >= 0) lines.push(`Позиция в тир-листе: **#${rank + 1} из ${tierlistEntries.length}**`);
    lines.push(`Последняя проверка: **${formatDateTime(profile.lastReviewedAt)}**`);
  } else if (pending) {
    lines.push(`Статус: **pending**`);
    lines.push(`Kills в заявке: **${pending.kills}**`);
    lines.push(`Tier по заявке: **${pending.derivedTier}** (${formatTierLabel(pending.derivedTier)})`);
    lines.push(`Создано: **${formatDateTime(pending.createdAt)}**`);
  } else if (latest?.status === "rejected") {
    lines.push(`Статус: **rejected**`);
    lines.push(`Последняя причина: **${latest.rejectReason || "не указана"}**`);
    lines.push(`Проверено: **${formatDateTime(latest.reviewedAt)}**`);
  } else {
    lines.push("Статус: **ещё не подтверждён**");
  }

  if (profile.accessGrantedAt) {
    lines.push(`Access-role выдана: **${formatDateTime(profile.accessGrantedAt)}**`);
  }

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("Профиль участника")
        .setDescription(lines.join("\n")),
    ],
    flags: MessageFlags.Ephemeral,
  };
}

function buildModeratorPanelPayload(statusText = "", includeFlags = true) {
  const entries = getApprovedTierlistEntries();
  const stats = getTierlistStats(entries);
  const pendingCount = Object.values(db.submissions || {}).filter((submission) => isSubmissionActive(submission)).length;

  const embed = new EmbedBuilder()
    .setTitle("Onboarding Panel")
    .setDescription([
      "Главная модераторская панель для onboarding-бота.",
      `Подтверждено игроков: **${formatNumber(stats.totalVerified)}**`,
      `Pending заявок: **${formatNumber(pendingCount)}**`,
      `Топ игрок: **${stats.topEntry ? `${stats.topEntry.displayName} — ${formatNumber(stats.topEntry.approvedKills)} kills` : "—"}**`,
    ].join("\n"))
    .addFields(
      { name: "Обновить welcome", value: "Пересобирает welcome-панель и закреплённое сообщение входа.", inline: true },
      { name: "Обновить тир-листы", value: "Перестраивает верхний graphic-board и нижний текстовый рейтинг в dedicated канале.", inline: true },
      { name: "Синк tier-ролей", value: "Перепривязывает tier-роли всем подтверждённым игрокам по текущей базе.", inline: true },
      { name: "Напомнить отсутствующим", value: "Шлёт DM пользователям вне тир-листа с встроенным постером из репозитория.", inline: true },
      { name: "Обновить сводку", value: "Перерисовывает саму панель и показывает текущее состояние без лишних команд.", inline: true }
    );

  if (statusText) {
    embed.addFields({ name: "Последнее действие", value: statusText, inline: false });
  }

  const payload = {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("panel_refresh_welcome").setLabel("Обновить welcome").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("panel_refresh_tierlists").setLabel("Обновить тир-листы").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("panel_sync_roles").setLabel("Синк tier-ролей").setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("panel_remind_missing").setLabel("Напомнить отсутствующим").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("panel_refresh_summary").setLabel("Обновить сводку").setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("panel_add_character").setLabel("Добавить персонажа").setStyle(ButtonStyle.Success)
      ),
    ],
  };

  return includeFlags ? ephemeralPayload(payload) : payload;
}

function buildCommands() {
  return [
    new SlashCommandBuilder()
      .setName("onboard")
      .setDescription("Welcome bot commands")
      .addSubcommand((subcommand) =>
        subcommand
          .setName("profile")
          .setDescription("Показать профиль")
          .addUserOption((option) => option.setName("target").setDescription("Игрок"))
      )
      .addSubcommand((subcommand) =>
        subcommand.setName("pending").setDescription("Показать pending-заявки")
      )
      .addSubcommand((subcommand) =>
        subcommand.setName("tierlist").setDescription("Показать текстовый тир-лист")
      )
      .addSubcommand((subcommand) =>
        subcommand.setName("stats").setDescription("Показать общую статистику")
      )
      .addSubcommand((subcommand) =>
        subcommand.setName("panel").setDescription("Открыть модераторскую панель управления")
      )
      .addSubcommand((subcommand) =>
        subcommand.setName("remindmissing").setDescription("Напомнить всем, кого нет в тир-листе")
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("modset")
          .setDescription("Вручную выставить kills и tier-role")
          .addUserOption((option) => option.setName("target").setDescription("Игрок").setRequired(true))
          .addAttachmentOption((option) => option.setName("screenshot").setDescription("Скрин-пруф").setRequired(true))
          .addIntegerOption((option) => option.setName("kills").setDescription("Точное число kills").setMinValue(0).setRequired(true))
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("removetier")
          .setDescription("Снять kill-tier роль")
          .addUserOption((option) => option.setName("target").setDescription("Игрок").setRequired(true))
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("syncroles")
          .setDescription("Синхронизировать kill-tier роли по базе")
          .addUserOption((option) => option.setName("target").setDescription("Игрок"))
      ),
  ].map((command) => command.toJSON());
}

async function registerGuildCommands(client) {
  const guild = await client.guilds.fetch(GUILD_ID);
  await guild.commands.set(buildCommands());
}

async function syncApprovedTierRoles(client, targetUserId = null) {
  if (targetUserId) {
    const profile = db.profiles[targetUserId];
    if (!profile?.killTier) return 0;
    await ensureSingleTierRole(client, targetUserId, Number(profile.killTier), "manual sync");
    return 1;
  }

  let synced = 0;
  for (const [userId, profile] of Object.entries(db.profiles || {})) {
    if (!profile?.killTier) continue;
    await ensureSingleTierRole(client, userId, Number(profile.killTier), "startup sync");
    synced += 1;
  }
  return synced;
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.on("error", (error) => {
  console.error("Discord client error:", error);
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled rejection:", error);
});

client.once("clientReady", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Data root: ${DATA_ROOT}`);
  console.log(`DB path: ${DB_PATH}`);
  const generated = await ensureManagedRoles(client);
  await registerGuildCommands(client);
  await syncApprovedTierRoles(client).catch(() => 0);
  await ensureWelcomePanel(client);
  await refreshTierlistBoard(client);
  console.log(`Managed roles ready. Characters: ${generated.characterRoles}, tiers: ${generated.tierRoles}`);
  console.log("Welcome onboarding bot is ready");
});

client.on("guildMemberAdd", async (member) => {
  if (member.guild.id !== GUILD_ID) return;
  const text = [
    `Добро пожаловать на сервер ${member.guild.name}.`,
    `Чтобы открыть доступ и выбрать мейнов, зайди в <#${appConfig.channels.welcomeChannelId}> и нажми кнопку **${appConfig.ui.getRoleButtonLabel || "Получить роль"}**.`,
  ].join("\n");
  await member.send(text).catch(() => {});
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.guildId !== GUILD_ID) return;
  if (message.channelId !== appConfig.channels.welcomeChannelId) return;

  const session = getSubmitSession(message.author.id);
  if (!session) return;

  const pending = getPendingSubmissionForUser(message.author.id);
  if (pending) {
    clearSubmitSession(message.author.id);
    const reply = await message.reply("У тебя уже есть заявка на проверке. Дождись решения модератора.").catch(() => null);
    if (reply) scheduleDeleteMessage(reply);
    await message.delete().catch(() => {});
    return;
  }

  const attachment = message.attachments.first();
  if (!attachment || !isImageAttachment(attachment)) {
    const reply = await message.reply("Сейчас нужен следующий месседж именно с картинкой. Можно просто вставить скрин через Ctrl+V.").catch(() => null);
    if (reply) scheduleDeleteMessage(reply);
    await message.delete().catch(() => {});
    return;
  }

  try {
    await createPendingSubmissionFromAttachment(client, {
      user: message.author,
      member: message.member,
      mainCharacterIds: session.mainCharacterIds,
      kills: session.kills,
      screenshotUrl: attachment.url,
    });

    await grantAccessRole(client, message.author.id, "newcomer application submitted");

    const profile = getProfile(message.author.id);
    profile.accessGrantedAt = profile.accessGrantedAt || nowIso();
    profile.updatedAt = nowIso();
    saveDb();

    clearSubmitSession(message.author.id);
    const reply = await message.reply("Заявка отправлена модераторам. Доступная роль уже выдана, kill-tier прилетит после проверки.").catch(() => null);
    if (reply) scheduleDeleteMessage(reply);

    await logLine(client, `SUBMIT: <@${message.author.id}> kills ${session.kills} mains=${session.mainCharacterIds.join(",")}`);
  } catch (error) {
    clearSubmitSession(message.author.id);
    const reply = await message.reply(String(error?.message || error || "Не удалось отправить заявку.")).catch(() => null);
    if (reply) scheduleDeleteMessage(reply, 16000);
  }

  await message.delete().catch(() => {});
});

client.on("interactionCreate", async (interaction) => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName !== "onboard") return;

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "profile") {
      const target = interaction.options.getUser("target") || interaction.user;
      await interaction.reply(buildProfilePayload(target.id));
      return;
    }

    if (subcommand === "tierlist") {
      await interaction.reply(buildTierlistEmbeds());
      return;
    }

    if (subcommand === "stats") {
      const tierlist = buildTierlistEmbeds();
      await interaction.reply(ephemeralPayload({ embeds: [tierlist.embeds[0]] }));
      return;
    }

    if (!isModerator(interaction.member)) {
      await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
      return;
    }

    if (subcommand === "pending") {
      const pendingList = Object.values(db.submissions || {})
        .filter((submission) => isSubmissionActive(submission))
        .sort((left, right) => Date.parse(right.createdAt || 0) - Date.parse(left.createdAt || 0))
        .slice(0, 15);

      if (!pendingList.length) {
        await interaction.reply(ephemeralPayload({ content: "Активных pending-заявок нет." }));
        return;
      }

      const lines = pendingList.map((submission) => {
        return `• <@${submission.userId}> | kills ${submission.kills} | tier ${submission.derivedTier} | id \`${submission.id}\``;
      });

      await interaction.reply(ephemeralPayload({
        content: `Pending (${pendingList.length}):\n${lines.join("\n")}`,
      }));
      return;
    }

    if (subcommand === "panel") {
      await interaction.reply(buildModeratorPanelPayload());
      return;
    }

    if (subcommand === "remindmissing") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await sendMissingTierlistReminder(client);
      await interaction.editReply(
        `Рассылка завершена. Всего без тир-листа: ${result.total}. Отправлено: ${result.sent}. Не доставлено: ${result.failed}.`
      );
      return;
    }

    if (subcommand === "modset") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const target = interaction.options.getUser("target", true);
      const screenshot = interaction.options.getAttachment("screenshot", true);
      const kills = interaction.options.getInteger("kills", true);

      if (!isImageAttachment(screenshot)) {
        await interaction.editReply("Нужен image attachment.");
        return;
      }

      await supersedePendingSubmissionsForUser(client, target.id, interaction.user.tag);
      await createManualApprovedRecord(client, target, screenshot, kills, interaction.user.tag);

      const profile = getProfile(target.id);
      profile.displayName = getProfileDisplayName(target.id, profile);
      profile.username = target.username;
      profile.accessGrantedAt = profile.accessGrantedAt || nowIso();
      saveDb();

      await grantAccessRole(client, target.id, "manual moderator setup");

      await interaction.editReply(`Готово. <@${target.id}> теперь имеет kills ${kills} и tier ${killTierFor(kills)}.`);
      return;
    }

    if (subcommand === "removetier") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const target = interaction.options.getUser("target", true);
      const profile = getProfile(target.id);

      profile.approvedKills = null;
      profile.killTier = null;
      profile.updatedAt = nowIso();
      saveDb();

      await clearTierRoles(client, target.id, "moderator removed kill tier");
      await refreshTierlistBoard(client);
      await interaction.editReply(`Kill-tier роль у <@${target.id}> снята, approved kills очищены.`);
      return;
    }

    if (subcommand === "syncroles") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const target = interaction.options.getUser("target");
      const synced = await syncApprovedTierRoles(client, target?.id || null);
      await interaction.editReply(target ? `Синкнут 1 профиль.` : `Синкнуто профилей: ${synced}.`);
      return;
    }
  }

  if (interaction.isButton()) {
    // === PNG Dashboard buttons ===
    if (interaction.customId === "graphic_refresh") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }
      await interaction.deferUpdate();
      await refreshTierlistBoard(client);
      return;
    }

    if (interaction.customId === "graphic_panel") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }
      await interaction.reply(buildGraphicPanelPayload());
      return;
    }

    // === PNG Panel buttons (all require moderator) ===
    if (interaction.customId.startsWith("graphic_panel_")) {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }
      const gfx = getGraphicTierlistConfig();
      const selectedTier = Number(gfx.panel?.selectedTier) || 5;

      if (interaction.customId === "graphic_panel_close") {
        await interaction.update({ content: "PNG Panel закрыта.", embeds: [], components: [] });
        return;
      }

      if (interaction.customId === "graphic_panel_fonts") {
        const { ensureGraphicFonts } = require("./graphic-tierlist");
        const ok = ensureGraphicFonts();
        await interaction.reply(ephemeralPayload({ content: ok ? "Шрифты загружены." : "Шрифты не найдены. Положи TTF в assets/fonts/." }));
        return;
      }

      if (interaction.customId === "graphic_panel_title") {
        const modal = new ModalBuilder().setCustomId("graphic_panel_title_modal").setTitle("Название PNG тир-листа");
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("graphic_title").setLabel("Название наверху картинки").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80).setValue(getEffectiveGraphicTitle())
        ));
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === "graphic_panel_message_text") {
        const modal = new ModalBuilder().setCustomId("graphic_panel_message_text_modal").setTitle("Текст сообщения PNG тир-листа");
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("graphic_message_text").setLabel("Текст под заголовком").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(4000).setValue(getEffectiveMessageText())
        ));
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === "graphic_panel_rename") {
        const modal = new ModalBuilder().setCustomId(`graphic_panel_rename_modal:${selectedTier}`).setTitle(`Переименовать тир ${selectedTier}`);
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("tier_name").setLabel("Новое название тира").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(60).setValue(formatTierLabel(selectedTier))
        ));
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === "graphic_panel_set_color") {
        const tierColors = getEffectiveTierColors();
        const modal = new ModalBuilder().setCustomId(`graphic_panel_color_modal:${selectedTier}`).setTitle(`Цвет тира ${selectedTier}`);
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("tier_color").setLabel("HEX цвет, пример #ff6b6b").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(7).setValue(tierColors[selectedTier] || "")
        ));
        await interaction.showModal(modal);
        return;
      }

      // Size adjustment buttons
      if (interaction.customId === "graphic_panel_icon_minus" || interaction.customId === "graphic_panel_icon_plus") {
        const delta = interaction.customId.endsWith("plus") ? 12 : -12;
        gfx.image.icon = Math.max(64, Math.min(256, (gfx.image.icon || 112) + delta));
        saveDb();
        await interaction.update(buildGraphicPanelPayload());
        return;
      }

      if (interaction.customId === "graphic_panel_w_minus" || interaction.customId === "graphic_panel_w_plus") {
        const delta = interaction.customId.endsWith("plus") ? 200 : -200;
        gfx.image.width = Math.max(1200, Math.min(4096, (gfx.image.width || 2000) + delta));
        saveDb();
        await interaction.update(buildGraphicPanelPayload());
        return;
      }

      if (interaction.customId === "graphic_panel_h_minus" || interaction.customId === "graphic_panel_h_plus") {
        const delta = interaction.customId.endsWith("plus") ? 120 : -120;
        gfx.image.height = Math.max(700, Math.min(2160, (gfx.image.height || 1200) + delta));
        saveDb();
        await interaction.update(buildGraphicPanelPayload());
        return;
      }

      if (interaction.customId === "graphic_panel_reset_img") {
        gfx.image = { width: null, height: null, icon: null };
        saveDb();
        await interaction.update(buildGraphicPanelPayload());
        return;
      }

      if (interaction.customId === "graphic_panel_reset_color") {
        if (gfx.tierColors) delete gfx.tierColors[selectedTier];
        saveDb();
        await interaction.update(buildGraphicPanelPayload());
        return;
      }

      if (interaction.customId === "graphic_panel_reset_colors") {
        gfx.tierColors = {};
        saveDb();
        await interaction.update(buildGraphicPanelPayload());
        return;
      }

      if (interaction.customId === "graphic_panel_clear_cache") {
        clearGraphicAvatarCache();
        await interaction.reply(ephemeralPayload({ content: "Кэш аватарок очищен." }));
        return;
      }

      if (interaction.customId === "graphic_panel_refresh") {
        await interaction.deferUpdate();
        await refreshTierlistBoard(client);
        await interaction.editReply(buildGraphicPanelPayload());
        return;
      }
    }

    if (interaction.customId === "welcome_editor") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав. Только модераторы могут редактировать." }));
        return;
      }
      const curTitle = appConfig.welcomeEmbed?.title || appConfig.ui.welcomeTitle || "Jujutsu Shinigans Onboarding";
      const curDesc = appConfig.welcomeEmbed?.description || appConfig.ui.welcomeDescription || "Нажми кнопку ниже, выбери мейнов, укажи kills и отправь скрин.";
      const modal = new ModalBuilder().setCustomId("welcome_editor_modal").setTitle("Редактор welcome-сообщения");
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("welcome_title").setLabel("Заголовок").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(256).setValue(curTitle)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("welcome_text").setLabel("Текст описания").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(2000).setValue(curDesc)
        )
      );
      await interaction.showModal(modal);
      return;
    }

    if (interaction.customId === "panel_add_character") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }
      const modal = new ModalBuilder()
        .setCustomId("panel_add_character_modal")
        .setTitle("Добавить персонажа");
      const nameInput = new TextInputBuilder()
        .setCustomId("character_name")
        .setLabel("Имя персонажа")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(100);
      modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
      await interaction.showModal(modal);
      return;
    }

    if (["panel_refresh_welcome", "panel_refresh_tierlists", "panel_sync_roles", "panel_remind_missing", "panel_refresh_summary"].includes(interaction.customId)) {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      await interaction.deferUpdate();

      let statusText = "Сводка обновлена.";
      if (interaction.customId === "panel_refresh_welcome") {
        await ensureWelcomePanel(client);
        statusText = "Welcome-панель обновлена.";
      } else if (interaction.customId === "panel_refresh_tierlists") {
        await refreshTierlistBoard(client);
        statusText = "Graphic-board и текстовый тир-лист обновлены.";
      } else if (interaction.customId === "panel_sync_roles") {
        const synced = await syncApprovedTierRoles(client);
        statusText = `Tier-роли пересинхронизированы. Профилей: ${synced}.`;
      } else if (interaction.customId === "panel_remind_missing") {
        const result = await sendMissingTierlistReminder(client);
        statusText = `DM-рассылка завершена. Всего: ${result.total}, отправлено: ${result.sent}, не доставлено: ${result.failed}.`;
      }

      await interaction.editReply(buildModeratorPanelPayload(statusText, false));
      return;
    }

    if (interaction.customId === "onboard_my_card") {
      await interaction.reply(ephemeralPayload({ embeds: [buildMyCardEmbed(interaction.user.id)] }));
      return;
    }

    if (interaction.customId === "onboard_begin") {
      const cooldownLeft = getSubmitCooldownLeftSeconds(interaction.user.id);
      if (cooldownLeft > 0) {
        await interaction.reply(ephemeralPayload({ content: `Подожди ещё ${cooldownLeft} сек. перед новой заявкой.` }));
        return;
      }

      const pending = getPendingSubmissionForUser(interaction.user.id);
      if (pending) {
        await interaction.reply(ephemeralPayload({
          content: `У тебя уже есть pending-заявка с kills ${pending.kills}. Дождись решения модератора.`,
        }));
        return;
      }

      const session = getSubmitSession(interaction.user.id);
      if (session) {
        await interaction.reply(ephemeralPayload({
          content: `Ты уже на шаге отправки скрина. Отправь картинку следующим сообщением в <#${appConfig.channels.welcomeChannelId}>.`,
        }));
        return;
      }

      await interaction.reply(buildCharacterPickerPayload("full"));
      return;
    }

    if (interaction.customId === "onboard_quick_mains") {
      await interaction.reply(buildCharacterPickerPayload("quick"));
      return;
    }

    if (interaction.customId === "onboard_cancel") {
      clearMainDraft(interaction.user.id);
      clearSubmitSession(interaction.user.id);
      await interaction.update({ content: "Ок. Процесс отменён.", embeds: [], components: [] });
      return;
    }

    const [action, submissionId] = interaction.customId.split(":");
    const submission = db.submissions[submissionId];

    if (!submission) {
      await interaction.reply(ephemeralPayload({ content: "Заявка не найдена." }));
      return;
    }

    if (!isModerator(interaction.member)) {
      await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
      return;
    }

    if (submission.status !== "pending") {
      await interaction.reply(ephemeralPayload({ content: `Заявка уже обработана: ${submission.status}.` }));
      return;
    }

    if (hoursSince(submission.createdAt) > PENDING_EXPIRE_HOURS) {
      await expireSubmission(client, submission);
      await interaction.reply(ephemeralPayload({ content: "Заявка уже истекла и была помечена как expired." }));
      return;
    }

    if (action === "approve") {
      await approveSubmission(client, submission, interaction.user.tag);
      await interaction.reply(ephemeralPayload({ content: "Заявка одобрена. Tier-role выдана." }));
      return;
    }

    if (action === "edit") {
      const modal = new ModalBuilder().setCustomId(`edit_kills:${submissionId}`).setTitle("Edit kills");
      const input = new TextInputBuilder()
        .setCustomId("kills")
        .setLabel("Новое точное количество kills")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(String(submission.kills))
        .setPlaceholder("Например 3120");
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
      return;
    }

    if (action === "reject") {
      const modal = new ModalBuilder().setCustomId(`reject_reason:${submissionId}`).setTitle("Reject reason");
      const input = new TextInputBuilder()
        .setCustomId("reason")
        .setLabel("Причина отказа")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setPlaceholder("Коротко и по делу");
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
      return;
    }
  }

  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === "graphic_panel_select_tier") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }
      const gfx = getGraphicTierlistConfig();
      gfx.panel.selectedTier = Number(interaction.values[0]) || 5;
      saveDb();
      await interaction.update(buildGraphicPanelPayload());
      return;
    }

    if (!["onboard_pick_characters", "onboard_pick_characters_quick"].includes(interaction.customId)) return;

    const isQuickSelection = interaction.customId === "onboard_pick_characters_quick";
    const selectedIds = [...new Set((interaction.values || []).map(getCharacterIdFromSelectValue).filter(Boolean))];

    const pending = getPendingSubmissionForUser(interaction.user.id);
    if (!isQuickSelection && pending) {
      await interaction.reply(ephemeralPayload({ content: "У тебя уже есть pending-заявка. Новую создавать нельзя." }));
      return;
    }

    if (!selectedIds.length || selectedIds.length > 2) {
      await interaction.reply(ephemeralPayload({ content: "Нужно выбрать одного или двух мейнов." }));
      return;
    }

    const member = await fetchMember(client, interaction.user.id);
    if (!member) {
      await interaction.reply(ephemeralPayload({ content: "Не удалось получить твой профиль на сервере." }));
      return;
    }

    const selectedEntries = await applyMainSelection(client, member, interaction.user, selectedIds, isQuickSelection ? "quick main selection" : "new main character selection");

    if (isQuickSelection) {
      const syncedPending = await syncPendingSubmissionMainsForUser(client, interaction.user.id, selectedEntries);
      await interaction.reply(ephemeralPayload({
        content: syncedPending
          ? `Мейны обновлены: **${selectedEntries.map((entry) => entry.label).join(", ")}**. Pending-заявка тоже обновлена.`
          : `Мейны обновлены: **${selectedEntries.map((entry) => entry.label).join(", ")}**.`,
      }));
      return;
    }

    setMainDraft(interaction.user.id, selectedEntries.map((entry) => entry.id));

    const modal = new ModalBuilder().setCustomId("onboard_kills_modal").setTitle("Точное количество kills");
    const input = new TextInputBuilder()
      .setCustomId("kills")
      .setLabel("Введи точное число kills")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder("Например 3120");
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
    return;
  }

  if (interaction.isModalSubmit()) {
    // === Graphic Panel modals ===
    if (interaction.customId === "graphic_panel_title_modal") {
      const gfx = getGraphicTierlistConfig();
      gfx.title = interaction.fields.getTextInputValue("graphic_title").trim();
      saveDb();
      await interaction.reply(ephemeralPayload({ content: `Название PNG обновлено: **${gfx.title}**` }));
      return;
    }

    if (interaction.customId === "graphic_panel_message_text_modal") {
      const gfx = getGraphicTierlistConfig();
      gfx.messageText = interaction.fields.getTextInputValue("graphic_message_text").trim();
      saveDb();
      await interaction.reply(ephemeralPayload({ content: `Текст сообщения обновлён.` }));
      return;
    }

    if (interaction.customId.startsWith("graphic_panel_rename_modal:")) {
      const tierKey = interaction.customId.split(":")[1];
      const gfx = getGraphicTierlistConfig();
      if (!gfx.tierLabels) gfx.tierLabels = {};
      gfx.tierLabels[tierKey] = interaction.fields.getTextInputValue("tier_name").trim();
      saveDb();
      await interaction.reply(ephemeralPayload({ content: `Тир ${tierKey} переименован: **${gfx.tierLabels[tierKey]}**` }));
      return;
    }

    if (interaction.customId.startsWith("graphic_panel_color_modal:")) {
      const tierKey = interaction.customId.split(":")[1];
      const color = interaction.fields.getTextInputValue("tier_color").trim();
      if (!/^#[0-9a-f]{6}$/i.test(color)) {
        await interaction.reply(ephemeralPayload({ content: "Некорректный HEX-цвет. Формат: #rrggbb" }));
        return;
      }
      const gfx = getGraphicTierlistConfig();
      if (!gfx.tierColors) gfx.tierColors = {};
      gfx.tierColors[tierKey] = color;
      saveDb();
      await interaction.reply(ephemeralPayload({ content: `Цвет тира ${tierKey} обновлён: **${color}**` }));
      return;
    }

    // === Welcome Editor modals ===
    if (interaction.customId === "welcome_editor_modal") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }
      const newTitle = interaction.fields.getTextInputValue("welcome_title").trim();
      const newText = interaction.fields.getTextInputValue("welcome_text").trim();
      if (!newTitle || !newText) {
        await interaction.reply(ephemeralPayload({ content: "Название и текст не могут быть пустыми." }));
        return;
      }
      appConfig.welcomeEmbed = appConfig.welcomeEmbed || {};
      appConfig.welcomeEmbed.title = newTitle;
      appConfig.welcomeEmbed.description = newText;
      const rawConfig = loadJsonFile(CONFIG_PATH, {});
      rawConfig.welcomeEmbed = rawConfig.welcomeEmbed || {};
      rawConfig.welcomeEmbed.title = newTitle;
      rawConfig.welcomeEmbed.description = newText;
      saveJsonFile(CONFIG_PATH, rawConfig);
      await ensureWelcomePanel(client);
      await interaction.reply(ephemeralPayload({ content: "Welcome-сообщение обновлено." }));
      return;
    }

    if (interaction.customId === "panel_add_character_modal") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }
      const charName = interaction.fields.getTextInputValue("character_name").trim();
      if (!charName) {
        await interaction.reply(ephemeralPayload({ content: "Имя персонажа не может быть пустым." }));
        return;
      }
      const charId = charName.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, "_").replace(/^_+|_+$/g, "") || `char_${Date.now()}`;
      const existing = appConfig.characters.find((c) => String(c.id).trim() === charId);
      if (existing) {
        await interaction.reply(ephemeralPayload({ content: `Персонаж с ID «${charId}» уже существует.` }));
        return;
      }
      appConfig.characters.push({ id: charId, label: charName });
      const rawConfig = loadJsonFile(CONFIG_PATH, {});
      if (!Array.isArray(rawConfig.characters)) rawConfig.characters = [];
      rawConfig.characters.push({ id: charId, label: charName });
      saveJsonFile(CONFIG_PATH, rawConfig);

      const guild = await getGuild(client);
      let roleNote = "";
      if (guild) {
        try {
          const role = await ensureRoleByName(guild, charName);
          if (role) roleNote = ` Роль «${role.name}» создана/найдена.`;
        } catch (err) {
          roleNote = ` Не удалось создать роль: ${err?.message || err}`;
        }
      }
      await ensureWelcomePanel(client);
      await interaction.reply(ephemeralPayload({ content: `Персонаж «${charName}» (ID: ${charId}) добавлен.${roleNote}` }));
      return;
    }

    if (interaction.customId === "onboard_kills_modal") {
      const draft = getMainDraft(interaction.user.id);
      if (!draft) {
        await interaction.reply(ephemeralPayload({ content: "Сессия выбора мейнов истекла. Нажми кнопку заново." }));
        return;
      }

      const pending = getPendingSubmissionForUser(interaction.user.id);
      if (pending) {
        clearMainDraft(interaction.user.id);
        await interaction.reply(ephemeralPayload({ content: "У тебя уже есть pending-заявка. Дождись решения модератора." }));
        return;
      }

      const kills = parseKillCount(interaction.fields.getTextInputValue("kills"));
      if (kills === null) {
        await interaction.reply(ephemeralPayload({ content: "Нужно указать точное число kills, только цифрами." }));
        return;
      }

      setSubmitSession(interaction.user.id, { mainCharacterIds: draft.characterIds, kills });
      clearMainDraft(interaction.user.id);

      await interaction.reply(ephemeralPayload({
        content: [
          `Мейны сохранены, kills сохранены: **${kills}**.`,
          `Теперь следующим сообщением отправь **скрин** в <#${appConfig.channels.welcomeChannelId}>.`,
          "Бот удалит сообщение со скрином после обработки.",
        ].join("\n"),
      }));
      return;
    }

    const [kind, submissionId] = interaction.customId.split(":");
    const submission = db.submissions[submissionId];

    if (!submission) {
      await interaction.reply(ephemeralPayload({ content: "Заявка не найдена." }));
      return;
    }

    if (!isModerator(interaction.member)) {
      await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
      return;
    }

    if (submission.status !== "pending") {
      await interaction.reply(ephemeralPayload({ content: `Заявка уже обработана: ${submission.status}.` }));
      return;
    }

    if (hoursSince(submission.createdAt) > PENDING_EXPIRE_HOURS) {
      await expireSubmission(client, submission);
      await interaction.reply(ephemeralPayload({ content: "Заявка уже истекла и была помечена как expired." }));
      return;
    }

    if (kind === "edit_kills") {
      const kills = parseKillCount(interaction.fields.getTextInputValue("kills"));
      if (kills === null) {
        await interaction.reply(ephemeralPayload({ content: "Нужно корректное число kills." }));
        return;
      }

      await updateSubmissionKills(client, submission, kills, interaction.user.tag);
      await interaction.reply(ephemeralPayload({
        content: `Kills обновлены: ${kills}. Новый tier: ${killTierFor(kills)} (${formatTierLabel(killTierFor(kills))}).`,
      }));
      return;
    }

    if (kind === "reject_reason") {
      const reason = String(interaction.fields.getTextInputValue("reason") || "").trim().slice(0, 800);
      if (!reason) {
        await interaction.reply(ephemeralPayload({ content: "Причина не может быть пустой." }));
        return;
      }

      await rejectSubmission(client, submission, interaction.user.tag, reason);
      await interaction.reply(ephemeralPayload({ content: "Заявка отклонена." }));
      return;
    }
  }
});

client.login(DISCORD_TOKEN);
