require("dotenv").config();

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const {
  renderGraphicTierlistPng,
  setAvatarCacheDir,
  clearGraphicAvatarCache,
  isPureimageAvailable,
  DEFAULT_GRAPHIC_TIER_COLORS,
} = require("./graphic-tierlist");
const { buildCommands } = require("./src/onboard/commands");
const { commitMutation } = require("./src/onboard/refresh-runner");
const {
  createPresentationDefaults,
  ensurePresentationConfig,
  getGraphicTierlistBoardState,
  getTextTierlistBoardState,
  getTierLabel,
  getWelcomePanelState: readWelcomePanelState,
  resolvePresentation,
} = require("./src/onboard/presentation");
const {
  getMainStats,
  getTierlistStats,
} = require("./src/onboard/tierlist-stats");
const {
  createCaptchaChallenge,
  loadCaptchaCatalog,
  renderCaptchaPng,
} = require("./src/onboard/non-ggs-captcha");

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
const NON_GGS_CAPTCHA_ASSET_DIR = resolvePathFromBase(PROJECT_ROOT, "./assets/non-ggs-captcha");

fs.mkdirSync(DATA_ROOT, { recursive: true });
fs.mkdirSync(NON_GGS_CAPTCHA_ASSET_DIR, { recursive: true });
setAvatarCacheDir(path.join(DATA_ROOT, "graphic_avatar_cache"));

const SUBMIT_SESSION_EXPIRE_MS = 10 * 60 * 1000;
const PENDING_EXPIRE_HOURS = 72;
const TEMP_MESSAGE_DELETE_MS = 12000;
const SUBMIT_COOLDOWN_SECONDS = 120;
const WELCOME_CLEANUP_IMAGE_GRACE_MS = 2 * 60 * 1000;
const WELCOME_CLEANUP_BOT_REPLY_GRACE_MS = 20 * 1000;
const NON_GGS_CAPTCHA_EXPIRE_MS = 10 * 60 * 1000;
const NON_GGS_CAPTCHA_STAGES = 2;

let guildCache = null;
const mainDrafts = new Map();
const submitSessions = new Map();
const nonGgsCaptchaSessions = new Map();

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
      nonGgsAccessRoleId: envText("NON_GGS_ACCESS_ROLE_ID", fileConfig?.roles?.nonGgsAccessRoleId || ""),
      killTierRoleIds: {
        1: envText("TIER_ROLE_1_ID", fileConfig?.roles?.killTierRoleIds?.["1"] || ""),
        2: envText("TIER_ROLE_2_ID", fileConfig?.roles?.killTierRoleIds?.["2"] || ""),
        3: envText("TIER_ROLE_3_ID", fileConfig?.roles?.killTierRoleIds?.["3"] || ""),
        4: envText("TIER_ROLE_4_ID", fileConfig?.roles?.killTierRoleIds?.["4"] || ""),
        5: envText("TIER_ROLE_5_ID", fileConfig?.roles?.killTierRoleIds?.["5"] || ""),
      },
    },
    ui: {
      welcomeTitle: String(fileConfig?.ui?.welcomeTitle || "Jujutsu Shinigans Onboarding").trim(),
      welcomeDescription: String(
        fileConfig?.ui?.welcomeDescription ||
        "Нажми кнопку ниже, выбери 1 или 2 мейнов, укажи точное количество kills и отправь следующим сообщением скрин. После подачи заявки бот сразу выдаст тебе роль доступа, а kill-tier роль прилетит после проверки модератором."
      ).trim(),
      getRoleButtonLabel: String(fileConfig?.ui?.getRoleButtonLabel || "Получить роль").trim(),
      nonGgsTitle: String(fileConfig?.ui?.nonGgsTitle || "Я не играю в GGS").trim(),
      nonGgsDescription: String(
        fileConfig?.ui?.nonGgsDescription ||
        "Если ты не играешь в GGS, нажми кнопку ниже. Бот запустит 2 этапа капчи и после успешного прохождения выдаст отдельную роль доступа."
      ).trim(),
      nonGgsButtonLabel: String(fileConfig?.ui?.nonGgsButtonLabel || "Я не играю в GGS").trim(),
      tierlistButtonLabel: String(fileConfig?.ui?.tierlistButtonLabel || "Текстовый тир-лист").trim(),
      tierlistTitle: String(fileConfig?.ui?.tierlistTitle || "Текстовый тир-лист").trim(),
    },
    graphicTierlist: {
      title: String(fileConfig?.graphicTierlist?.title || "Графический тир-лист").trim(),
      subtitle: String(fileConfig?.graphicTierlist?.subtitle || "Подтверждённые игроки и текущая расстановка по kills").trim(),
      tierColors: {
        1: String(fileConfig?.graphicTierlist?.tierColors?.["1"] || DEFAULT_GRAPHIC_TIER_COLORS[1]).trim(),
        2: String(fileConfig?.graphicTierlist?.tierColors?.["2"] || DEFAULT_GRAPHIC_TIER_COLORS[2]).trim(),
        3: String(fileConfig?.graphicTierlist?.tierColors?.["3"] || DEFAULT_GRAPHIC_TIER_COLORS[3]).trim(),
        4: String(fileConfig?.graphicTierlist?.tierColors?.["4"] || DEFAULT_GRAPHIC_TIER_COLORS[4]).trim(),
        5: String(fileConfig?.graphicTierlist?.tierColors?.["5"] || DEFAULT_GRAPHIC_TIER_COLORS[5]).trim(),
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
      1: String(fileConfig?.killTierLabels?.["1"] || "Низший ранг").trim(),
      2: String(fileConfig?.killTierLabels?.["2"] || "Средний ранг").trim(),
      3: String(fileConfig?.killTierLabels?.["3"] || "Высший ранг").trim(),
      4: String(fileConfig?.killTierLabels?.["4"] || "Особый ранг").trim(),
      5: String(fileConfig?.killTierLabels?.["5"] || "Абсолютный ранг").trim(),
    },
    characters,
  };
}

function normalizeCharacterId(value, fallback = "") {
  const text = String(value || "").trim().toLowerCase();
  const normalized = text.replace(/[^a-zа-яё0-9]+/gi, "_").replace(/^_+|_+$/g, "");
  return normalized || String(fallback || "").trim();
}

function normalizeCharacterCatalog(value, fallback = []) {
  const source = Array.isArray(value) ? value : fallback;
  const out = [];
  const seen = new Set();

  for (const entry of source) {
    const label = String(entry?.label || "").trim();
    const id = normalizeCharacterId(entry?.id || label, `char_${out.length + 1}`);
    const roleId = String(entry?.roleId || "").trim();
    if (!label || !id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label, roleId });
  }

  return out;
}

function mergeCharacterCatalog(primary, fallback = []) {
  const merged = new Map();

  for (const entry of normalizeCharacterCatalog(fallback)) {
    merged.set(entry.id, { ...entry });
  }

  for (const entry of normalizeCharacterCatalog(primary)) {
    const previous = merged.get(entry.id) || {};
    merged.set(entry.id, {
      id: entry.id,
      label: entry.label || previous.label || entry.id,
      roleId: entry.roleId || previous.roleId || "",
    });
  }

  return [...merged.values()];
}

function sameCharacterCatalog(left, right) {
  const a = normalizeCharacterCatalog(left);
  const b = normalizeCharacterCatalog(right);
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index].id !== b[index].id) return false;
    if (a[index].label !== b[index].label) return false;
    if (a[index].roleId !== b[index].roleId) return false;
  }
  return true;
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
      nonGgsPanel: {
        channelId: appConfig.channels.welcomeChannelId,
        messageId: "",
      },
      tierlistBoard: {
        text: {
          channelId: appConfig.channels.tierlistChannelId || "",
          messageId: "",
        },
        graphic: {
          channelId: appConfig.channels.tierlistChannelId || "",
          messageId: "",
          lastUpdated: null,
        },
      },
      generatedRoles: {
        characters: {},
        tiers: {},
      },
      characters: normalizeCharacterCatalog(appConfig.characters),
    },
    profiles: {},
    submissions: {},
  };

  const db = loadJsonFile(DB_PATH, fallback);
  db.config ||= {};
  const migrated = ensurePresentationConfig(db.config, {
    defaults: createPresentationDefaults(fileConfig, { defaultGraphicTierColors: DEFAULT_GRAPHIC_TIER_COLORS }),
    defaultWelcomeChannelId: appConfig.channels.welcomeChannelId,
    defaultTextTierlistChannelId: appConfig.channels.tierlistChannelId || "",
    defaultGraphicTierColors: DEFAULT_GRAPHIC_TIER_COLORS,
  });
  db.profiles ||= {};
  db.submissions ||= {};
  db.cooldowns ||= {};
  db.config.notificationChannelId = String(db.config.notificationChannelId || "").trim();
  const mergedCharacters = mergeCharacterCatalog(db.config.characters, appConfig.characters);
  const charactersChanged = !sameCharacterCatalog(db.config.characters, mergedCharacters);
  db.config.characters = mergedCharacters;
  db.__needsSaveAfterLoad = migrated.mutated || charactersChanged;
  return db;
}

const db = loadDb();

function saveDb() {
  delete db.__needsSaveAfterLoad;
  saveJsonFile(DB_PATH, db);
}

if (db.__needsSaveAfterLoad) saveDb();

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

function getPresentation() {
  return resolvePresentation(db.config, fileConfig, { defaultGraphicTierColors: DEFAULT_GRAPHIC_TIER_COLORS });
}

function formatTierLabel(tier) {
  return getTierLabel(getPresentation(), tier);
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

function getCharacterCatalog() {
  db.config.characters = mergeCharacterCatalog(db.config.characters, appConfig.characters);
  return db.config.characters;
}

function getNotificationChannelId() {
  const configured = String(db.config.notificationChannelId || "").trim();
  return configured || String(appConfig.channels.logChannelId || "").trim();
}

function formatNumber(value) {
  const amount = Number(value) || 0;
  return amount.toLocaleString("ru-RU");
}

function formatPercent(value) {
  const amount = Number(value) || 0;
  const rounded = Math.round(amount * 10) / 10;
  return `${rounded.toLocaleString("ru-RU", {
    minimumFractionDigits: Number.isInteger(rounded) ? 0 : 1,
    maximumFractionDigits: 1,
  })}%`;
}

function previewText(value, max = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
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
  if (profile?.nonGgsAccessGrantedAt) {
    lines.push(`**Non-GGS доступ:** ${formatDateTime(profile.nonGgsAccessGrantedAt)}`);
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

function getStatsSnapshot(entries) {
  return getTierlistStats(entries, Object.values(db.submissions || {}));
}

function chunkTextLines(lines, maxLength = 3800, maxLines = 15) {
  const chunks = [];
  let chunk = [];
  let chunkLength = 0;

  const flush = () => {
    if (!chunk.length) return;
    chunks.push(chunk.join("\n"));
    chunk = [];
    chunkLength = 0;
  };

  for (const line of lines) {
    if (chunk.length >= maxLines || chunkLength + line.length + 1 > maxLength) {
      flush();
    }
    chunk.push(line);
    chunkLength += line.length + 1;
  }

  flush();
  return chunks;
}

function buildMainStatsEmbeds(entries) {
  const mainStats = getMainStats(entries);
  if (!mainStats.length) return [];

  const popularityLines = mainStats.map((stat, index) =>
    `${index + 1}. **${stat.main}** — игроков: **${formatNumber(stat.playerCount)}** • avg kills: **${formatNumber(stat.averageKills)}** • median kills: **${formatNumber(stat.medianKills)}**`
  );
  const distributionLines = mainStats.map((stat) =>
    `**${stat.main}** — T5/T4/T3/T2/T1: **${stat.totalsByTier[5]} / ${stat.totalsByTier[4]} / ${stat.totalsByTier[3]} / ${stat.totalsByTier[2]} / ${stat.totalsByTier[1]}**`
  );

  const embeds = [];

  chunkTextLines(popularityLines, 3800, 12).forEach((description, index) => {
    embeds.push(
      new EmbedBuilder()
        .setTitle(index === 0 ? "Статистика по мейнам" : `Статистика по мейнам — продолжение ${index + 1}`)
        .setDescription(description)
    );
  });

  chunkTextLines(distributionLines, 3800, 12).forEach((description, index) => {
    embeds.push(
      new EmbedBuilder()
        .setTitle(index === 0 ? "Распределение тиров по мейнам" : `Распределение тиров по мейнам — продолжение ${index + 1}`)
        .setDescription(description)
    );
  });

  return embeds;
}

function buildStatsEmbeds() {
  const entries = getApprovedTierlistEntries();
  const stats = getStatsSnapshot(entries);
  const presentation = getPresentation();

  if (!entries.length) {
    return [
      new EmbedBuilder()
        .setTitle(presentation.tierlist.textTitle)
        .setDescription([
          "Пока нет подтверждённых игроков в тир-листе.",
          `Pending заявок: **${stats.pendingCount}**`,
          `Approval rate: **${formatPercent(stats.approvalRate)}**`,
          `Reject rate: **${formatPercent(stats.rejectRate)}**`,
        ].join("\n")),
    ];
  }

  const summaryLines = [
    `Подтверждено игроков: **${formatNumber(stats.totalVerified)}**`,
    `Pending заявок: **${formatNumber(stats.pendingCount)}**`,
    `Approval rate: **${formatPercent(stats.approvalRate)}** (${formatNumber(stats.approvedCount)} одобрено)`,
    `Reject rate: **${formatPercent(stats.rejectRate)}** (${formatNumber(stats.rejectedCount)} отклонено)`,
    `Суммарно kills: **${formatNumber(stats.totalKills)}**`,
    `Среднее kills: **${formatNumber(stats.averageKills)}**`,
    `Медиана kills: **${formatNumber(stats.medianKills)}**`,
    `Tier 5/4/3/2/1: **${stats.totalsByTier[5]} / ${stats.totalsByTier[4]} / ${stats.totalsByTier[3]} / ${stats.totalsByTier[2]} / ${stats.totalsByTier[1]}**`,
    `Топ 1: **${stats.topEntry.displayName}** — **${formatNumber(stats.topEntry.approvedKills)}** kills`,
    `Последний в листе: **${stats.bottomEntry.displayName}** — **${formatNumber(stats.bottomEntry.approvedKills)}** kills`,
  ];

  return [
    new EmbedBuilder()
      .setTitle(presentation.tierlist.textTitle)
      .setDescription(summaryLines.join("\n")),
    ...buildMainStatsEmbeds(entries),
  ];
}

function buildTierlistEmbeds() {
  const entries = getApprovedTierlistEntries();
  const embeds = [...buildStatsEmbeds()];

  if (!entries.length) {
    return { embeds, flags: MessageFlags.Ephemeral };
  }

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
    const line = `${lineNumber}. [${formatTierLabel(entry.killTier)} / T${entry.killTier}] ${entry.displayName} — ${formatNumber(entry.approvedKills)} kills • mains: ${entry.mains.length ? entry.mains.join(", ") : "—"}`;
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
  const guild = await getGuild(client);
  const graphicBoard = getGraphicTierlistBoardState(db.config, appConfig.channels.tierlistChannelId || "");
  const imgCfg = getGraphicImageConfig();
  const presentation = getPresentation();

  if (!isPureimageAvailable()) {
    throw new Error("pureimage не загружен, поэтому графический PNG тир-лист не может быть собран.");
  }

  const pngBuffer = await renderGraphicTierlistPng({
    client,
    guild,
    entries,
    title: getEffectiveGraphicTitle(),
    tierLabels: presentation.tierlist.labels,
    tierColors: getEffectiveTierColors(),
    imageWidth: imgCfg.W,
    imageHeight: imgCfg.H,
    imageIcon: imgCfg.ICON,
  });
  if (!pngBuffer?.length) {
    throw new Error("PNG тир-лист не был сгенерирован.");
  }

  const embedBuilder = new EmbedBuilder()
    .setTitle(getEffectiveGraphicTitle())
    .setDescription(getEffectiveMessageText())
    .setImage("attachment://tierlist.png");

  const components = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("graphic_refresh").setLabel("Обновить PNG").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("graphic_panel").setLabel("PNG панель").setStyle(ButtonStyle.Primary)
    ),
  ];

  return {
    content: "",
    embeds: [embedBuilder],
    files: [new AttachmentBuilder(pngBuffer, { name: "tierlist.png" })],
    components,
  };
}

function buildGraphicPanelTierSelect() {
  const selected = Number(getPresentation().tierlist.graphic.panel.selectedTier) || 5;
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
  const cfg = getGraphicImageConfig();
  const presentation = getPresentation();
  const selectedTier = Number(presentation.tierlist.graphic.panel.selectedTier) || 5;
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

function buildGraphicStatusLines() {
  const graphicBoard = getGraphicTierlistBoardState(db.config, appConfig.channels.tierlistChannelId || "");
  const cfg = getGraphicImageConfig();
  const presentation = getPresentation();
  const selectedTier = Number(presentation.tierlist.graphic.panel.selectedTier) || 5;

  return [
    `title: ${presentation.tierlist.graphicTitle}`,
    `messageText: ${previewGraphicMessageText(120)}`,
    `channelId: ${graphicBoard.channelId || "—"}`,
    `messageId: ${graphicBoard.messageId || "—"}`,
    `img: ${cfg.W}x${cfg.H}, icon=${cfg.ICON}`,
    `selectedTier: ${selectedTier} -> ${formatTierLabel(selectedTier)}`,
    `tierColors: ${[5, 4, 3, 2, 1].map((tier) => `${tier}=${presentation.tierlist.graphic.colors[tier] || DEFAULT_GRAPHIC_TIER_COLORS[tier]}`).join(", ")}`,
    `lastUpdated: ${graphicBoard.lastUpdated ? new Date(graphicBoard.lastUpdated).toLocaleString("ru-RU") : "—"}`,
  ];
}

function buildWelcomeEditorPayload(statusText = "") {
  const presentation = getPresentation();
  const embed = new EmbedBuilder()
    .setTitle("Welcome Editor")
    .setDescription([
      `**Welcome title:** ${previewText(presentation.welcome.title, 140)}`,
      `**Welcome text:** ${previewText(presentation.welcome.description, 240)}`,
      `**Buttons:** ${presentation.welcome.buttons.begin} / ${presentation.welcome.buttons.quickMains} / ${presentation.welcome.buttons.myCard}`,
      `**Text tierlist:** ${presentation.tierlist.textTitle}`,
      `**PNG tierlist:** ${presentation.tierlist.graphicTitle}`,
      `**PNG message:** ${previewGraphicMessageText(140)}`,
      "",
      presentation.welcome.steps.map((step, index) => `${index + 1}. ${previewText(step, 120)}`).join("\n"),
    ].join("\n"));

  if (statusText) {
    embed.addFields({ name: "Последнее действие", value: statusText, inline: false });
  }

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("welcome_editor_text").setLabel("Welcome текст").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("welcome_editor_steps").setLabel("Шаги welcome").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("welcome_editor_buttons").setLabel("Кнопки").setStyle(ButtonStyle.Primary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("welcome_editor_tiers").setLabel("Названия тиров").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("welcome_editor_png").setLabel("PNG и tierlist").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("welcome_editor_refresh").setLabel("Пересобрать всё").setStyle(ButtonStyle.Secondary)
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("welcome_editor_close").setLabel("Закрыть").setStyle(ButtonStyle.Danger)
  );

  return ephemeralPayload({ embeds: [embed], components: [row1, row2, row3] });
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

function messageHasImageAttachment(message) {
  return [...(message?.attachments?.values?.() || [])].some((attachment) => isImageAttachment(attachment));
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
  return getCharacterCatalog().map((entry) => ({
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

  for (const entry of getCharacterCatalog()) {
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
  return readWelcomePanelState(db.config, appConfig.channels.welcomeChannelId);
}

function getNonGgsPanelState() {
  db.config.nonGgsPanel ||= {
    channelId: appConfig.channels.welcomeChannelId,
    messageId: "",
  };
  db.config.nonGgsPanel.channelId = getWelcomePanelState().channelId || appConfig.channels.welcomeChannelId;
  db.config.nonGgsPanel.messageId = String(db.config.nonGgsPanel.messageId || "").trim();
  return db.config.nonGgsPanel;
}

function getGraphicTierlistConfig() {
  db.config.presentation ||= {};
  db.config.presentation.tierlist ||= {};
  db.config.presentation.tierlist.graphic ||= {};
  db.config.presentation.tierlist.graphic.image ||= {};
  db.config.presentation.tierlist.graphic.colors ||= {};
  db.config.presentation.tierlist.graphic.panel ||= { selectedTier: 5 };
  return db.config.presentation.tierlist.graphic;
}

function getGraphicImageConfig() {
  const presentation = getPresentation();
  const img = presentation.tierlist.graphic.image || {};
  return {
    W: Math.max(1200, Number(img.width) || 2000),
    H: Math.max(700, Number(img.height) || 1200),
    ICON: Math.max(64, Math.min(256, Number(img.icon) || 112)),
  };
}

function getEffectiveTierColors() {
  return { ...getPresentation().tierlist.graphic.colors };
}

function getEffectiveGraphicTitle() {
  return getPresentation().tierlist.graphicTitle;
}

function getEffectiveMessageText() {
  return getPresentation().tierlist.graphicMessageText;
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
    nonGgsAccessGrantedAt: null,
    nonGgsCaptchaPassedAt: null,
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

async function replyAndDelete(message, content, delayMs = TEMP_MESSAGE_DELETE_MS) {
  const reply = await message.reply(content).catch(() => null);
  if (reply) scheduleDeleteMessage(reply, delayMs);
  return reply;
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

function setNonGgsCaptchaSession(userId, value) {
  nonGgsCaptchaSessions.set(userId, { ...value, createdAt: Date.now() });
}

function getNonGgsCaptchaSession(userId) {
  const session = nonGgsCaptchaSessions.get(userId);
  if (!session) return null;
  if (Date.now() - Number(session.createdAt || 0) > NON_GGS_CAPTCHA_EXPIRE_MS) {
    nonGgsCaptchaSessions.delete(userId);
    return null;
  }
  return session;
}

function clearNonGgsCaptchaSession(userId) {
  nonGgsCaptchaSessions.delete(userId);
}

function getActiveNonGgsCaptchaSessionCount() {
  let count = 0;
  for (const userId of nonGgsCaptchaSessions.keys()) {
    if (getNonGgsCaptchaSession(userId)) count += 1;
  }
  return count;
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
  const logChannelId = getNotificationChannelId();
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

function getReminderImagePath(includeFallback = false) {
  const raw = String(appConfig.reminders?.missingTierlistImagePath || "").trim();
  if (raw) return path.isAbsolute(raw) ? raw : path.resolve(PROJECT_ROOT, raw);
  if (includeFallback && fs.existsSync(DEFAULT_REMINDER_POSTER_PATH)) return DEFAULT_REMINDER_POSTER_PATH;
  return "";
}

function buildMissingTierlistReminderPayload() {
  const content = getMissingTierlistText();
  const imageUrl = String(appConfig.reminders?.missingTierlistImageUrl || "").trim();
  const imagePath = getReminderImagePath(false);
  const fallbackImagePath = imagePath ? "" : getReminderImagePath(true);

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

  if (fallbackImagePath && fs.existsSync(fallbackImagePath)) {
    const fileName = sanitizeFileName(path.basename(fallbackImagePath) || "missing-tierlist-image.png");
    const isSvg = /\.svg$/i.test(fileName);
    const payload = { content, files: [new AttachmentBuilder(fallbackImagePath, { name: fileName })] };
    if (!isSvg) {
      payload.embeds = [new EmbedBuilder().setImage(`attachment://${fileName}`)];
    }
    return payload;
  }

  return { content };
}

async function getMembersMissingTierlist(client) {
  const guild = await getGuild(client);
  if (!guild) return [];

  await guild.members.fetch();
  const accessRoleId = String(appConfig.roles.accessRoleId || "").trim();
  const tierRoleIds = new Set(getAllTierRoleIds());

  return guild.members.cache.filter((member) => {
    if (member.user.bot) return false;
    if (!accessRoleId || !member.roles.cache.has(accessRoleId)) return false;
    for (const roleId of tierRoleIds) {
      if (member.roles.cache.has(roleId)) return false;
    }
    return true;
  });
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

function getNonGgsAccessRoleId() {
  return String(appConfig.roles.nonGgsAccessRoleId || "").trim();
}

function memberHasTierRole(member) {
  if (!member?.roles?.cache) return false;
  return getAllTierRoleIds().some((roleId) => roleId && member.roles.cache.has(roleId));
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

async function grantNonGgsAccessRole(client, userId, reason = "non-GGS captcha passed") {
  const member = await fetchMember(client, userId);
  if (!member) return false;

  const roleId = getNonGgsAccessRoleId();
  if (!roleId) {
    throw new Error("NON_GGS_ACCESS_ROLE_ID не настроен. Укажи отдельную роль для non-GGS доступа.");
  }

  if (!member.roles.cache.has(roleId)) {
    await member.roles.add(roleId, reason);
  }

  return true;
}

function buildWelcomeEmbed() {
  const presentation = getPresentation();
  return new EmbedBuilder()
    .setTitle(presentation.welcome.title)
    .setDescription([
      presentation.welcome.description,
      "",
      ...presentation.welcome.steps.map((step, index) => `${index + 1}. ${step}`),
    ].join("\n"));
}

function buildWelcomeComponents() {
  const presentation = getPresentation();
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("onboard_begin")
        .setLabel(presentation.welcome.buttons.begin)
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("onboard_quick_mains")
        .setLabel(presentation.welcome.buttons.quickMains)
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("onboard_my_card")
        .setLabel(presentation.welcome.buttons.myCard)
        .setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function buildNonGgsPanelPayload() {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(appConfig.ui.nonGgsTitle)
        .setDescription(appConfig.ui.nonGgsDescription),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("onboard_non_ggs_start")
          .setLabel(appConfig.ui.nonGgsButtonLabel)
          .setStyle(ButtonStyle.Success)
      ),
    ],
  };
}

function buildNonGgsCaptchaButtons() {
  const rows = [];
  for (let row = 0; row < 3; row += 1) {
    const rowBuilder = new ActionRowBuilder();
    for (let col = 0; col < 3; col += 1) {
      const value = row * 3 + col + 1;
      rowBuilder.addComponents(
        new ButtonBuilder()
          .setCustomId(`non_ggs_captcha_answer:${value}`)
          .setLabel(String(value))
          .setStyle(ButtonStyle.Secondary)
      );
    }
    rows.push(rowBuilder);
  }
  return rows;
}

function buildNonGgsCaptchaCatalog() {
  return loadCaptchaCatalog(NON_GGS_CAPTCHA_ASSET_DIR);
}

function createNonGgsCaptchaSession(previousChallenge = null, stage = 1) {
  return {
    stage,
    challenge: createCaptchaChallenge(buildNonGgsCaptchaCatalog(), { previousChallenge }),
  };
}

function getNonGgsCaptchaStatusLines() {
  const panel = getNonGgsPanelState();
  const catalog = buildNonGgsCaptchaCatalog();
  const roleId = getNonGgsAccessRoleId();
  const foundSkillful = catalog.skillful.map((entry) => entry.slot).join(", ") || "—";
  const foundOutliers = catalog.outliers.map((entry) => entry.slot).join(", ") || "—";
  const missingSkillful = catalog.missingSkillfulSlots.join(", ") || "—";
  const missingOutliers = catalog.missingOutlierSlots.join(", ") || "—";

  return [
    `roleId: ${roleId || "не задан"}`,
    `panelChannelId: ${panel.channelId || "—"}`,
    `panelMessageId: ${panel.messageId || "—"}`,
    `assetDir: ${NON_GGS_CAPTCHA_ASSET_DIR}`,
    `skillful slots found: ${foundSkillful}`,
    `outlier slots found: ${foundOutliers}`,
    `missing skillful: ${missingSkillful}`,
    `missing outliers: ${missingOutliers}`,
    `active sessions: ${getActiveNonGgsCaptchaSessionCount()}`,
  ];
}

async function buildNonGgsCaptchaPayload(userId, noticeText = "", options = {}) {
  const session = getNonGgsCaptchaSession(userId);
  if (!session?.challenge) {
    throw new Error("Капча уже истекла. Нажми кнопку заново.");
  }

  const buffer = await renderCaptchaPng(session.challenge);
  const stage = Number(session.stage) || 1;
  const descriptionLines = [
    `Этап **${stage} из ${NON_GGS_CAPTCHA_STAGES}**.`,
    "Нажми кнопку с номером лишней картинки.",
  ];

  if (noticeText) {
    descriptionLines.unshift(noticeText);
  }

  const payload = {
    embeds: [
      new EmbedBuilder()
        .setTitle("Капча для non-GGS доступа")
        .setDescription(descriptionLines.join("\n"))
        .setImage("attachment://non-ggs-captcha.png"),
    ],
    files: [new AttachmentBuilder(buffer, { name: "non-ggs-captcha.png" })],
    components: buildNonGgsCaptchaButtons(),
  };

  return options.includeEphemeralFlag ? ephemeralPayload(payload) : payload;
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
        : "Можно выбрать одного или двух персонажей. После выбора появится шаг с кнопкой **Дальше**, где можно открыть ввод точного количества kills."
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

function buildKillsModal(initialValue = "") {
  const modal = new ModalBuilder().setCustomId("onboard_kills_modal").setTitle("Точное количество kills");
  const input = new TextInputBuilder()
    .setCustomId("kills")
    .setLabel("Введи точное число kills")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder("Например 3120");
  if (String(initialValue || "").trim()) input.setValue(String(initialValue).trim());
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

function buildKillsStepPayload(userId) {
  const draft = getMainDraft(userId);
  if (!draft?.characterIds?.length) {
    return ephemeralPayload({ content: "Сессия выбора мейнов истекла. Нажми кнопку заново." });
  }

  const selectedEntries = getSelectedCharacterEntries(draft.characterIds);
  const selectedLabels = selectedEntries.length
    ? selectedEntries.map((entry) => entry.label)
    : draft.characterIds.map((value) => String(value || "").trim()).filter(Boolean);

  const embed = new EmbedBuilder()
    .setTitle("Мейны выбраны")
    .setDescription([
      `Выбрано: **${selectedLabels.join(", ")}**`,
      "",
      "Теперь нужно указать точное число kills.",
      "Если окно ввода случайно закрылось, просто нажми **Дальше** еще раз.",
    ].join("\n"));

  return ephemeralPayload({
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("onboard_open_kills_modal").setLabel("Дальше").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("onboard_change_mains").setLabel("Выбрать заново").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("onboard_cancel").setLabel("Отмена").setStyle(ButtonStyle.Secondary)
      ),
    ],
  });
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

async function findExistingNonGgsPanelMessage(channel) {
  const botId = client.user?.id;
  return findManagedMessageInChannel(
    channel,
    (message) => message.author?.id === botId && messageHasRequiredCustomIds(message, ["onboard_non_ggs_start"])
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
      messageHasEmbedTitle(message, getPresentation().tierlist.textTitle))
  );
}

function shouldKeepWelcomeChannelMessage(message, keepMessageIds) {
  if (!message) return true;
  if (keepMessageIds.has(message.id)) return true;

  const ageMs = Date.now() - Number(message.createdTimestamp || 0);

  if (message.author?.id === client.user?.id && messageHasRequiredCustomIds(message, ["onboard_begin", "onboard_quick_mains"])) {
    return true;
  }

  if (message.author?.id === client.user?.id && messageHasRequiredCustomIds(message, ["onboard_non_ggs_start"])) {
    return true;
  }

  if (message.author?.id === client.user?.id && ageMs <= WELCOME_CLEANUP_BOT_REPLY_GRACE_MS) {
    return true;
  }

  if (messageHasImageAttachment(message)) {
    const session = getSubmitSession(message.author?.id);
    if (session) return true;
    if (ageMs <= WELCOME_CLEANUP_IMAGE_GRACE_MS) return true;
  }

  return false;
}

async function cleanupWelcomeChannelMessages(channel, keepMessageIds = []) {
  if (!channel?.isTextBased()) return 0;

  const keepIds = new Set(keepMessageIds.filter(Boolean));
  let before = null;
  let deleted = 0;

  for (let batchIndex = 0; batchIndex < 10; batchIndex += 1) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => null);
    if (!batch?.size) break;

    for (const message of batch.values()) {
      if (shouldKeepWelcomeChannelMessage(message, keepIds)) continue;
      if (!message.deletable) continue;
      await message.delete().catch(() => {});
      deleted += 1;
    }

    before = batch.last()?.id || null;
    if (!before || batch.size < 100) break;
  }

  return deleted;
}

async function unpinBotMessagesInChannel(channel) {
  if (!channel?.isTextBased()) return 0;
  const pinned = await channel.messages.fetchPins().catch(() => null);
  if (!pinned?.size) return 0;

  let changed = 0;
  for (const message of pinned.values()) {
    if (message.author?.id !== client.user?.id) continue;
    await message.unpin().catch(() => {});
    changed += 1;
  }
  return changed;
}

async function cleanupBotPins(client) {
  const textBoard = getTextTierlistBoardState(db.config, appConfig.channels.tierlistChannelId || "");
  const graphicBoard = getGraphicTierlistBoardState(db.config, appConfig.channels.tierlistChannelId || "");
  const channels = new Set([
    getWelcomePanelState().channelId,
    textBoard.channelId,
    graphicBoard.channelId,
  ].filter(Boolean));

  for (const channelId of channels) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    await unpinBotMessagesInChannel(channel);
  }
}

async function upsertManagedPanelMessage(channel, state, payload, findExisting) {
  let message = null;
  if (state.messageId) {
    message = await channel.messages.fetch(state.messageId).catch(() => null);
  }
  if (!message) {
    message = await findExisting(channel);
    if (message && state.messageId !== message.id) {
      state.messageId = message.id;
      saveDb();
    }
  }

  if (!message) {
    message = await channel.send(payload);
    state.messageId = message.id;
  } else {
    await message.edit(payload);
    await message.unpin().catch(() => {});
  }

  return message;
}

async function refreshWelcomePanel(client) {
  const panelState = getWelcomePanelState();
  const nonGgsPanelState = getNonGgsPanelState();
  const channel = await client.channels.fetch(panelState.channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    throw new Error("welcomeChannelId не указывает на текстовый канал");
  }

  const welcomePayload = {
    embeds: [buildWelcomeEmbed()],
    components: buildWelcomeComponents(),
  };
  const nonGgsPayload = buildNonGgsPanelPayload();

  const welcomeMessage = await upsertManagedPanelMessage(channel, panelState, welcomePayload, findExistingWelcomePanelMessage);
  const nonGgsMessage = await upsertManagedPanelMessage(channel, nonGgsPanelState, nonGgsPayload, findExistingNonGgsPanelMessage);

  await cleanupWelcomeChannelMessages(channel, [welcomeMessage.id, nonGgsMessage.id]);
  saveDb();
  return { welcomeMessage, nonGgsMessage };
}

async function ensureWelcomePanel(client) {
  return refreshWelcomePanel(client);
}

async function refreshGraphicTierlistBoard(client) {
  const state = getGraphicTierlistBoardState(db.config, appConfig.channels.tierlistChannelId || "");
  const channelId = state.channelId || appConfig.channels.tierlistChannelId;
  if (!channelId || isPlaceholder(channelId)) return null;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    console.warn("tierlistChannelId не указывает на текстовый канал, пропускаем graphic board");
    return null;
  }

  let message = null;
  if (state.messageId) {
    message = await channel.messages.fetch(state.messageId).catch(() => null);
  }
  if (!message) {
    message = await findExistingGraphicTierlistMessage(channel);
    if (message && state.messageId !== message.id) {
      state.messageId = message.id;
      saveDb();
    }
  }

  const payload = await buildGraphicTierlistBoardPayload(client);
  const created = !message;
  if (!message) {
    message = await channel.send(payload);
    state.messageId = message.id;
  } else {
    await message.edit({ ...payload, attachments: [] });
    await message.unpin().catch(() => {});
  }

  state.lastUpdated = Date.now();
  state.channelId = channelId;
  saveDb();
  return { message, created };
}

async function ensureGraphicTierlistBoardMessage(client) {
  return refreshGraphicTierlistBoard(client);
}

async function deleteManagedChannelMessage(client, channelId, messageId) {
  if (!channelId || !messageId) return false;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return false;
  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (!message?.deletable) return false;
  await message.delete().catch(() => {});
  return true;
}

async function repostGraphicTierlistBoardToChannel(client, targetChannelId) {
  const state = getGraphicTierlistBoardState(db.config, appConfig.channels.tierlistChannelId || "");
  const nextChannelId = String(targetChannelId || "").trim();
  if (!nextChannelId || isPlaceholder(nextChannelId)) {
    throw new Error("Нужно указать текстовый канал для графического тир-листа.");
  }

  const targetChannel = await client.channels.fetch(nextChannelId).catch(() => null);
  if (!targetChannel?.isTextBased()) {
    throw new Error("Указанный канал не является текстовым.");
  }

  const previousChannelId = state.channelId || appConfig.channels.tierlistChannelId || "";
  const previousMessageId = state.messageId || "";

  state.channelId = nextChannelId;
  state.messageId = "";
  saveDb();

  try {
    const result = await refreshGraphicTierlistBoard(client);

    if (previousMessageId && (previousChannelId !== nextChannelId || previousMessageId !== result?.message?.id)) {
      await deleteManagedChannelMessage(client, previousChannelId || nextChannelId, previousMessageId);
    }

    return {
      channelId: nextChannelId,
      previousChannelId,
      messageId: result?.message?.id || "",
    };
  } catch (error) {
    state.channelId = previousChannelId;
    state.messageId = previousMessageId;
    saveDb();
    throw error;
  }
}

async function repostTextTierlistBoardToChannel(client, targetChannelId) {
  const state = getTextTierlistBoardState(db.config, appConfig.channels.tierlistChannelId || "");
  const nextChannelId = String(targetChannelId || "").trim();
  if (!nextChannelId || isPlaceholder(nextChannelId)) {
    throw new Error("Нужно указать текстовый канал для текстового тир-листа.");
  }

  const targetChannel = await client.channels.fetch(nextChannelId).catch(() => null);
  if (!targetChannel?.isTextBased()) {
    throw new Error("Указанный канал не является текстовым.");
  }

  const previousChannelId = state.channelId || appConfig.channels.tierlistChannelId || "";
  const previousMessageId = state.messageId || "";

  state.channelId = nextChannelId;
  state.messageId = "";
  saveDb();

  try {
    const message = await refreshTextTierlistBoard(client, { forceRecreate: true });

    if (previousMessageId && (previousChannelId !== nextChannelId || previousMessageId !== message?.id)) {
      await deleteManagedChannelMessage(client, previousChannelId || nextChannelId, previousMessageId);
    }

    return {
      channelId: nextChannelId,
      previousChannelId,
      messageId: message?.id || "",
    };
  } catch (error) {
    state.channelId = previousChannelId;
    state.messageId = previousMessageId;
    saveDb();
    throw error;
  }
}

async function moveNotificationChannel(client, targetChannelId) {
  const nextChannelId = String(targetChannelId || "").trim();
  if (!nextChannelId || isPlaceholder(nextChannelId)) {
    throw new Error("Нужно указать текстовый канал для уведомлений.");
  }

  const targetChannel = await client.channels.fetch(nextChannelId).catch(() => null);
  if (!targetChannel?.isTextBased()) {
    throw new Error("Указанный канал не является текстовым.");
  }

  const previousChannelId = getNotificationChannelId();
  db.config.notificationChannelId = nextChannelId;
  saveDb();

  await logLine(client, `NOTICE_CHANNEL_MOVED: now=<#${nextChannelId}> previous=${previousChannelId ? `<#${previousChannelId}>` : "none"}`);
  return {
    channelId: nextChannelId,
    previousChannelId,
  };
}

async function refreshTextTierlistBoard(client, options = {}) {
  const state = getTextTierlistBoardState(db.config, appConfig.channels.tierlistChannelId || "");
  const channelId = state.channelId || appConfig.channels.tierlistChannelId;
  if (!channelId || isPlaceholder(channelId)) return null;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    console.warn("tierlistChannelId не указывает на текстовый канал, пропускаем text board");
    return null;
  }

  if (options.forceRecreate && state.messageId) {
    const existing = await channel.messages.fetch(state.messageId).catch(() => null);
    if (existing) await existing.delete().catch(() => {});
    state.messageId = "";
  }

  let message = null;
  if (state.messageId) {
    message = await channel.messages.fetch(state.messageId).catch(() => null);
  }
  if (!message) {
    message = await findExistingTextTierlistMessage(channel);
    if (message && state.messageId !== message.id) {
      state.messageId = message.id;
      saveDb();
    }
  }

  const payload = buildTierlistBoardPayload();
  if (!message) {
    message = await channel.send(payload);
    state.messageId = message.id;
  } else {
    await message.edit(payload);
    await message.unpin().catch(() => {});
  }

  state.channelId = channelId;
  saveDb();
  return message;
}

async function ensureTextTierlistBoardMessage(client, options = {}) {
  return refreshTextTierlistBoard(client, options);
}

async function refreshAllTierlists(client) {
  const graphicState = getGraphicTierlistBoardState(db.config, appConfig.channels.tierlistChannelId || "");
  const textState = getTextTierlistBoardState(db.config, appConfig.channels.tierlistChannelId || "");
  const hadGraphicMessage = Boolean(graphicState.messageId);
  const result = {
    graphicOk: false,
    textOk: false,
    graphicError: null,
    textError: null,
  };

  try {
    await refreshGraphicTierlistBoard(client);
    result.graphicOk = true;
  } catch (error) {
    result.graphicError = error;
    console.error("Graphic tierlist refresh failed:", error?.message || error);
  }

  try {
    await refreshTextTierlistBoard(client, { forceRecreate: !hadGraphicMessage && Boolean(textState.messageId) });
    result.textOk = true;
  } catch (error) {
    result.textError = error;
    console.error("Text tierlist refresh failed:", error?.message || error);
  }

  return result;
}

async function refreshTierlistBoard(client) {
  return refreshAllTierlists(client);
}

function buildTierlistRefreshReply(result) {
  if (result?.graphicOk && result?.textOk) {
    return "Текстовый и PNG tier-листы обновлены.";
  }

  if (result?.textOk && !result?.graphicOk) {
    const graphicError = String(result?.graphicError?.message || result?.graphicError || "неизвестная ошибка").trim();
    return `Текстовый tier-лист обновлён, но PNG не обновился: ${graphicError || "неизвестная ошибка"}.`;
  }

  if (result?.graphicOk && !result?.textOk) {
    const textError = String(result?.textError?.message || result?.textError || "неизвестная ошибка").trim();
    return `PNG tier-лист обновлён, но текстовый не обновился: ${textError || "неизвестная ошибка"}.`;
  }

  const fallback = String(result?.graphicError?.message || result?.textError?.message || result?.graphicError || result?.textError || "неизвестная ошибка").trim();
  return `Не удалось обновить tier-листы: ${fallback || "неизвестная ошибка"}.`;
}

async function applyUiMutation(client, scope, mutate) {
  return commitMutation({
    mutate,
    persist: saveDb,
    scope,
    refreshers: {
      refreshWelcomePanel: () => refreshWelcomePanel(client),
      refreshGraphicTierlistBoard: () => refreshGraphicTierlistBoard(client),
      refreshTextTierlistBoard: () => refreshTextTierlistBoard(client),
      refreshAllTierlists: () => refreshAllTierlists(client),
      refreshAll: async () => {
        await refreshWelcomePanel(client);
        await refreshAllTierlists(client);
      },
    },
  });
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
  if (profile.nonGgsAccessGrantedAt) {
    lines.push(`Non-GGS access-role выдана: **${formatDateTime(profile.nonGgsAccessGrantedAt)}**`);
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
  const stats = getStatsSnapshot(entries);

  const embed = new EmbedBuilder()
    .setTitle("Onboarding Panel")
    .setDescription([
      "Главная модераторская панель для onboarding-бота.",
      `Подтверждено игроков: **${formatNumber(stats.totalVerified)}**`,
      `Pending заявок: **${formatNumber(stats.pendingCount)}**`,
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
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("welcome_editor").setLabel("Редактор UI").setStyle(ButtonStyle.Secondary)
      ),
    ],
  };

  return includeFlags ? ephemeralPayload(payload) : payload;
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
  await refreshWelcomePanel(client);
  await refreshAllTierlists(client);
  await cleanupBotPins(client).catch(() => 0);
  console.log(`Managed roles ready. Characters: ${generated.characterRoles}, tiers: ${generated.tierRoles}`);
  console.log("Welcome onboarding bot is ready");
});

client.on("guildMemberAdd", async (member) => {
  if (member.guild.id !== GUILD_ID) return;
  const text = [
    `Добро пожаловать на сервер ${member.guild.name}.`,
    `Чтобы открыть доступ и выбрать мейнов, зайди в <#${appConfig.channels.welcomeChannelId}> и нажми кнопку **${getPresentation().welcome.buttons.begin}**.`,
    `Если ты не играешь в GGS, там же есть отдельная кнопка **${appConfig.ui.nonGgsButtonLabel}** с двухэтапной капчей.`,
  ].join("\n");
  await member.send(text).catch(() => {});
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.guildId !== GUILD_ID) return;
  if (message.channelId !== appConfig.channels.welcomeChannelId) return;

  const session = getSubmitSession(message.author.id);
  if (!session) {
    const reply = await message.reply("В этом канале можно отправлять только скрин сразу после кнопки «Получить роль». Остальные сообщения удаляются.").catch(() => null);
    if (reply) scheduleDeleteMessage(reply);
    await message.delete().catch(() => {});
    return;
  }

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
      await interaction.reply(ephemeralPayload({ embeds: buildStatsEmbeds() }));
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
        return `• <@${submission.userId}> | kills ${submission.kills} | tier ${submission.derivedTier} (${formatTierLabel(submission.derivedTier)}) | id \`${submission.id}\``;
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

    if (subcommand === "welcomeedit") {
      await interaction.reply(buildWelcomeEditorPayload());
      return;
    }

    if (subcommand === "refreshwelcome") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await refreshWelcomePanel(client);
      await interaction.editReply("Welcome-панель обновлена.");
      return;
    }

    if (subcommand === "refreshtierlists") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const refreshed = await refreshAllTierlists(client);
      const refreshedText = buildTierlistRefreshReply(refreshed);
      await interaction.editReply(refreshedText);
      return;
      await interaction.editReply(refreshed ? "Текстовый и PNG tier-листы обновлены." : "Не удалось обновить tier-листы.");
      return;
    }

    if (subcommand === "graphicpanel") {
      await interaction.reply(buildGraphicPanelPayload());
      return;
    }

    if (subcommand === "graphicstatus") {
      await interaction.reply(ephemeralPayload({ content: buildGraphicStatusLines().join("\n") }));
      return;
    }

    if (subcommand === "nonggsstatus") {
      await interaction.reply(ephemeralPayload({ content: getNonGgsCaptchaStatusLines().join("\n") }));
      return;
    }

    if (subcommand === "movegraphic") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const targetChannel = interaction.options.getChannel("channel", true);
      if (!targetChannel?.isTextBased?.()) {
        await interaction.editReply("Нужен текстовый канал.");
        return;
      }

      const result = await repostGraphicTierlistBoardToChannel(client, targetChannel.id);
      const movedText = result.previousChannelId && result.previousChannelId !== result.channelId
        ? ` Было: <#${result.previousChannelId}>.`
        : "";
      await interaction.editReply(`Графический тир-лист перезалит в <#${result.channelId}> и привязан к этому каналу для следующих обновлений.${movedText}`);
      return;
    }

    if (subcommand === "movetext") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const targetChannel = interaction.options.getChannel("channel", true);
      if (!targetChannel?.isTextBased?.()) {
        await interaction.editReply("Нужен текстовый канал.");
        return;
      }

      const result = await repostTextTierlistBoardToChannel(client, targetChannel.id);
      const movedText = result.previousChannelId && result.previousChannelId !== result.channelId
        ? ` Было: <#${result.previousChannelId}>.`
        : "";
      await interaction.editReply(`Текстовый тир-лист перенесён в <#${result.channelId}>.${movedText}`);
      return;
    }

    if (subcommand === "movenotices") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const targetChannel = interaction.options.getChannel("channel", true);
      if (!targetChannel?.isTextBased?.()) {
        await interaction.editReply("Нужен текстовый канал.");
        return;
      }

      const result = await moveNotificationChannel(client, targetChannel.id);
      const movedText = result.previousChannelId && result.previousChannelId !== result.channelId
        ? ` Было: <#${result.previousChannelId}>.`
        : "";
      await interaction.editReply(`Канал уведомлений бота теперь <#${result.channelId}>.${movedText}`);
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
      await refreshGraphicTierlistBoard(client);
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
      const graphicPresentation = getGraphicTierlistConfig();
      const selectedTier = Number(graphicPresentation.panel?.selectedTier) || 5;

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
        await applyUiMutation(client, "graphic", () => {
          const image = getGraphicTierlistConfig().image;
          image.icon = Math.max(64, Math.min(256, (image.icon || 112) + delta));
        });
        await interaction.update(buildGraphicPanelPayload());
        return;
      }

      if (interaction.customId === "graphic_panel_w_minus" || interaction.customId === "graphic_panel_w_plus") {
        const delta = interaction.customId.endsWith("plus") ? 200 : -200;
        await applyUiMutation(client, "graphic", () => {
          const image = getGraphicTierlistConfig().image;
          image.width = Math.max(1200, Math.min(4096, (image.width || 2000) + delta));
        });
        await interaction.update(buildGraphicPanelPayload());
        return;
      }

      if (interaction.customId === "graphic_panel_h_minus" || interaction.customId === "graphic_panel_h_plus") {
        const delta = interaction.customId.endsWith("plus") ? 120 : -120;
        await applyUiMutation(client, "graphic", () => {
          const image = getGraphicTierlistConfig().image;
          image.height = Math.max(700, Math.min(2160, (image.height || 1200) + delta));
        });
        await interaction.update(buildGraphicPanelPayload());
        return;
      }

      if (interaction.customId === "graphic_panel_reset_img") {
        await applyUiMutation(client, "graphic", () => {
          getGraphicTierlistConfig().image = { width: null, height: null, icon: null };
        });
        await interaction.update(buildGraphicPanelPayload());
        return;
      }

      if (interaction.customId === "graphic_panel_reset_color") {
        await applyUiMutation(client, "graphic", () => {
          const colors = getGraphicTierlistConfig().colors;
          if (colors) delete colors[selectedTier];
        });
        await interaction.update(buildGraphicPanelPayload());
        return;
      }

      if (interaction.customId === "graphic_panel_reset_colors") {
        await applyUiMutation(client, "graphic", () => {
          getGraphicTierlistConfig().colors = {};
        });
        await interaction.update(buildGraphicPanelPayload());
        return;
      }

      if (interaction.customId === "graphic_panel_clear_cache") {
        clearGraphicAvatarCache();
        await refreshGraphicTierlistBoard(client);
        await interaction.reply(ephemeralPayload({ content: "Кэш аватарок очищен и PNG пересобран." }));
        return;
      }

      if (interaction.customId === "graphic_panel_refresh") {
        await interaction.deferUpdate();
        await refreshGraphicTierlistBoard(client);
        await interaction.editReply(buildGraphicPanelPayload());
        return;
      }
    }

    if (interaction.customId === "welcome_editor") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав. Только модераторы могут редактировать." }));
        return;
      }
      await interaction.reply(buildWelcomeEditorPayload());
      return;
    }

    if (interaction.customId.startsWith("welcome_editor_")) {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const presentation = getPresentation();

      if (interaction.customId === "welcome_editor_close") {
        await interaction.update({ content: "Welcome Editor закрыт.", embeds: [], components: [] });
        return;
      }

      if (interaction.customId === "welcome_editor_refresh") {
        await interaction.deferUpdate();
        await refreshWelcomePanel(client);
        await refreshAllTierlists(client);
        await interaction.editReply(buildWelcomeEditorPayload("Welcome и tier-листы пересобраны."));
        return;
      }

      if (interaction.customId === "welcome_editor_text") {
        const modal = new ModalBuilder().setCustomId("welcome_editor_text_modal").setTitle("Welcome текст");
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("welcome_title").setLabel("Заголовок").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(256).setValue(presentation.welcome.title)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("welcome_text").setLabel("Текст описания").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(2000).setValue(presentation.welcome.description)
          )
        );
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === "welcome_editor_steps") {
        const modal = new ModalBuilder().setCustomId("welcome_editor_steps_modal").setTitle("Шаги welcome");
        const steps = [...presentation.welcome.steps];
        while (steps.length < 5) steps.push("");
        modal.addComponents(
          ...steps.slice(0, 5).map((step, index) =>
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId(`welcome_step_${index + 1}`)
                .setLabel(`Шаг ${index + 1}`)
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(160)
                .setValue(step)
            )
          )
        );
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === "welcome_editor_buttons") {
        const modal = new ModalBuilder().setCustomId("welcome_editor_buttons_modal").setTitle("Кнопки welcome");
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("button_begin").setLabel("Кнопка начала").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80).setValue(presentation.welcome.buttons.begin)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("button_quick").setLabel("Кнопка мейнов").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80).setValue(presentation.welcome.buttons.quickMains)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("button_card").setLabel("Кнопка карточки").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80).setValue(presentation.welcome.buttons.myCard)
          )
        );
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === "welcome_editor_tiers") {
        const modal = new ModalBuilder().setCustomId("welcome_editor_tiers_modal").setTitle("Названия тиров");
        modal.addComponents(
          ...[1, 2, 3, 4, 5].map((tier) =>
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId(`tier_label_${tier}`)
                .setLabel(`Тир ${tier}`)
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(60)
                .setValue(formatTierLabel(tier))
            )
          )
        );
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === "welcome_editor_png") {
        const modal = new ModalBuilder().setCustomId("welcome_editor_png_modal").setTitle("PNG и tierlist тексты");
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("text_tierlist_title").setLabel("Название текстового тир-листа").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(120).setValue(presentation.tierlist.textTitle)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("graphic_title").setLabel("Название PNG тир-листа").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(120).setValue(presentation.tierlist.graphicTitle)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("graphic_message_text").setLabel("Текст под PNG").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(4000).setValue(presentation.tierlist.graphicMessageText)
          )
        );
        await interaction.showModal(modal);
        return;
      }

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
        await refreshWelcomePanel(client);
        statusText = "Welcome-панель обновлена.";
      } else if (interaction.customId === "panel_refresh_tierlists") {
        await refreshAllTierlists(client);
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

    if (interaction.customId === "onboard_non_ggs_start") {
      const member = await fetchMember(client, interaction.user.id);
      if (!member) {
        await interaction.reply(ephemeralPayload({ content: "Не удалось получить твой профиль на сервере." }));
        return;
      }

      if (!getNonGgsAccessRoleId()) {
        await interaction.reply(ephemeralPayload({
          content: "Отдельная роль для non-GGS доступа ещё не настроена. Заполни `NON_GGS_ACCESS_ROLE_ID`, затем попробуй снова.",
        }));
        return;
      }

      const pending = getPendingSubmissionForUser(interaction.user.id);
      if (pending) {
        await interaction.reply(ephemeralPayload({
          content: `У тебя уже есть pending-заявка с kills ${pending.kills}. Дождись решения модератора.`,
        }));
        return;
      }

      if (memberHasTierRole(member)) {
        await interaction.reply(ephemeralPayload({
          content: "У тебя уже есть kill-tier роль, поэтому non-GGS капча тебе больше не нужна.",
        }));
        return;
      }

      if (appConfig.roles.accessRoleId && member.roles.cache.has(appConfig.roles.accessRoleId)) {
        await interaction.reply(ephemeralPayload({
          content: "У тебя уже есть обычная роль доступа, отдельный non-GGS доступ выдавать не нужно.",
        }));
        return;
      }

      if (member.roles.cache.has(getNonGgsAccessRoleId())) {
        await interaction.reply(ephemeralPayload({
          content: "У тебя уже есть отдельная роль доступа для non-GGS.",
        }));
        return;
      }

      clearMainDraft(interaction.user.id);
      clearSubmitSession(interaction.user.id);
      clearNonGgsCaptchaSession(interaction.user.id);

      try {
        setNonGgsCaptchaSession(interaction.user.id, createNonGgsCaptchaSession(null, 1));
        await interaction.reply(await buildNonGgsCaptchaPayload(
          interaction.user.id,
          "Пройди 2 этапа. В каждой картинке нужно нажать номер лишнего персонажа.",
          { includeEphemeralFlag: true }
        ));
      } catch (error) {
        clearNonGgsCaptchaSession(interaction.user.id);
        await interaction.reply(ephemeralPayload({
          content: `Не удалось запустить non-GGS капчу: ${String(error?.message || error || "неизвестная ошибка")}\nПапка с картинками: \`${NON_GGS_CAPTCHA_ASSET_DIR}\``,
        }));
      }
      return;
    }

    if (interaction.customId === "onboard_begin") {
      clearNonGgsCaptchaSession(interaction.user.id);
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

      const draft = getMainDraft(interaction.user.id);
      if (draft) {
        await interaction.reply(buildKillsStepPayload(interaction.user.id));
        return;
      }

      await interaction.reply(buildCharacterPickerPayload("full"));
      return;
    }

    if (interaction.customId === "onboard_quick_mains") {
      clearNonGgsCaptchaSession(interaction.user.id);
      await interaction.reply(buildCharacterPickerPayload("quick"));
      return;
    }

    if (interaction.customId === "onboard_change_mains") {
      clearSubmitSession(interaction.user.id);
      await interaction.update(buildCharacterPickerPayload("full"));
      return;
    }

    if (interaction.customId === "onboard_open_kills_modal") {
      const pending = getPendingSubmissionForUser(interaction.user.id);
      if (pending) {
        clearMainDraft(interaction.user.id);
        await interaction.reply(ephemeralPayload({ content: "У тебя уже есть pending-заявка. Дождись решения модератора." }));
        return;
      }

      const session = getSubmitSession(interaction.user.id);
      if (session) {
        clearMainDraft(interaction.user.id);
        await interaction.reply(ephemeralPayload({
          content: `Ты уже на шаге отправки скрина. Отправь картинку следующим сообщением в <#${appConfig.channels.welcomeChannelId}>.`,
        }));
        return;
      }

      const draft = getMainDraft(interaction.user.id);
      if (!draft) {
        await interaction.reply(ephemeralPayload({ content: "Сессия выбора мейнов истекла. Нажми кнопку заново." }));
        return;
      }

      await interaction.showModal(buildKillsModal());
      return;
    }

    if (interaction.customId === "onboard_cancel") {
      clearMainDraft(interaction.user.id);
      clearSubmitSession(interaction.user.id);
      await interaction.update({ content: "Ок. Процесс отменён.", embeds: [], components: [] });
      return;
    }

    if (interaction.customId.startsWith("non_ggs_captcha_answer:")) {
      const selectedIndex = Number(interaction.customId.split(":")[1]);
      const session = getNonGgsCaptchaSession(interaction.user.id);

      if (!session?.challenge) {
        await interaction.update({
          content: "Капча истекла. Нажми кнопку «Я не играю в GGS» заново и начни сначала.",
          embeds: [],
          components: [],
          attachments: [],
        });
        return;
      }

      if (selectedIndex !== Number(session.challenge.correctIndex)) {
        try {
          setNonGgsCaptchaSession(interaction.user.id, createNonGgsCaptchaSession(session.challenge, 1));
          await interaction.update({
            ...(await buildNonGgsCaptchaPayload(interaction.user.id, "Ответ неправильный. Попробуй ещё раз: капча полностью сброшена на первый этап.")),
            attachments: [],
          });
        } catch (error) {
          clearNonGgsCaptchaSession(interaction.user.id);
          await interaction.update({
            content: `Не удалось пересобрать капчу: ${String(error?.message || error || "неизвестная ошибка")}`,
            embeds: [],
            components: [],
            attachments: [],
          });
        }
        return;
      }

      if (Number(session.stage) < NON_GGS_CAPTCHA_STAGES) {
        try {
          setNonGgsCaptchaSession(interaction.user.id, createNonGgsCaptchaSession(session.challenge, Number(session.stage) + 1));
          await interaction.update({
            ...(await buildNonGgsCaptchaPayload(interaction.user.id, "Верно. Первый этап пройден, теперь второй.")),
            attachments: [],
          });
        } catch (error) {
          clearNonGgsCaptchaSession(interaction.user.id);
          await interaction.update({
            content: `Не удалось открыть следующий этап капчи: ${String(error?.message || error || "неизвестная ошибка")}`,
            embeds: [],
            components: [],
            attachments: [],
          });
        }
        return;
      }

      try {
        await grantNonGgsAccessRole(client, interaction.user.id, "non-GGS captcha passed");
        clearNonGgsCaptchaSession(interaction.user.id);

        const profile = getProfile(interaction.user.id);
        profile.nonGgsAccessGrantedAt = profile.nonGgsAccessGrantedAt || nowIso();
        profile.nonGgsCaptchaPassedAt = nowIso();
        profile.updatedAt = nowIso();
        saveDb();

        await logLine(client, `NON_GGS_ACCESS: <@${interaction.user.id}> passed captcha and received non-GGS role`);

        await interaction.update({
          content: "Готово. Капча пройдена, тебе выдана отдельная роль доступа для тех, кто не играет в GGS.",
          embeds: [],
          components: [],
          attachments: [],
        });
      } catch (error) {
        clearNonGgsCaptchaSession(interaction.user.id);
        await interaction.update({
          content: `Капча пройдена, но роль выдать не удалось: ${String(error?.message || error || "неизвестная ошибка")}`,
          embeds: [],
          components: [],
          attachments: [],
        });
      }
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
      await commitMutation({
        mutate: () => {
          getGraphicTierlistConfig().panel.selectedTier = Number(interaction.values[0]) || 5;
        },
        persist: saveDb,
      });
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
    await interaction.update(buildKillsStepPayload(interaction.user.id));
    return;
  }

  if (interaction.isModalSubmit()) {
    // === Graphic Panel modals ===
    if (interaction.customId === "graphic_panel_title_modal") {
      const title = interaction.fields.getTextInputValue("graphic_title").trim();
      if (!title) {
        await interaction.reply(ephemeralPayload({ content: "Название PNG не может быть пустым." }));
        return;
      }
      await applyUiMutation(client, "graphic", () => {
        db.config.presentation.tierlist.graphicTitle = title;
      });
      await interaction.reply(ephemeralPayload({ content: `Название PNG обновлено: **${title}**` }));
      return;
    }

    if (interaction.customId === "graphic_panel_message_text_modal") {
      const nextText = interaction.fields.getTextInputValue("graphic_message_text").trim();
      if (!nextText) {
        await interaction.reply(ephemeralPayload({ content: "Текст сообщения PNG не может быть пустым." }));
        return;
      }
      await applyUiMutation(client, "graphic", () => {
        db.config.presentation.tierlist.graphicMessageText = nextText;
      });
      await interaction.reply(ephemeralPayload({ content: `Текст сообщения обновлён.` }));
      return;
    }

    if (interaction.customId.startsWith("graphic_panel_rename_modal:")) {
      const tierKey = interaction.customId.split(":")[1];
      const tierName = interaction.fields.getTextInputValue("tier_name").trim();
      if (!tierName) {
        await interaction.reply(ephemeralPayload({ content: "Название тира не может быть пустым." }));
        return;
      }
      await applyUiMutation(client, "tierlists", () => {
        db.config.presentation.tierlist.labels ||= {};
        db.config.presentation.tierlist.labels[tierKey] = tierName;
      });
      await interaction.reply(ephemeralPayload({ content: `Тир ${tierKey} переименован: **${tierName}**` }));
      return;
    }

    if (interaction.customId.startsWith("graphic_panel_color_modal:")) {
      const tierKey = interaction.customId.split(":")[1];
      const color = interaction.fields.getTextInputValue("tier_color").trim();
      if (!/^#[0-9a-f]{6}$/i.test(color)) {
        await interaction.reply(ephemeralPayload({ content: "Некорректный HEX-цвет. Формат: #rrggbb" }));
        return;
      }
      await applyUiMutation(client, "graphic", () => {
        getGraphicTierlistConfig().colors ||= {};
        getGraphicTierlistConfig().colors[tierKey] = color;
      });
      await interaction.reply(ephemeralPayload({ content: `Цвет тира ${tierKey} обновлён: **${color}**` }));
      return;
    }

    // === Welcome Editor modals ===
    if (interaction.customId === "welcome_editor_text_modal") {
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
      await applyUiMutation(client, "welcome", () => {
        db.config.presentation.welcome.title = newTitle;
        db.config.presentation.welcome.description = newText;
      });
      await interaction.reply(buildWelcomeEditorPayload("Welcome-сообщение обновлено."));
      return;
    }

    if (interaction.customId === "welcome_editor_steps_modal") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }
      const steps = [1, 2, 3, 4, 5].map((index) => interaction.fields.getTextInputValue(`welcome_step_${index}`).trim());
      if (steps.some((step) => !step)) {
        await interaction.reply(ephemeralPayload({ content: "Все шаги должны быть заполнены." }));
        return;
      }
      await applyUiMutation(client, "welcome", () => {
        db.config.presentation.welcome.steps = steps;
      });
      await interaction.reply(buildWelcomeEditorPayload("Шаги welcome обновлены."));
      return;
    }

    if (interaction.customId === "welcome_editor_buttons_modal") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }
      const begin = interaction.fields.getTextInputValue("button_begin").trim();
      const quick = interaction.fields.getTextInputValue("button_quick").trim();
      const card = interaction.fields.getTextInputValue("button_card").trim();
      if (!begin || !quick || !card) {
        await interaction.reply(ephemeralPayload({ content: "Все подписи кнопок должны быть заполнены." }));
        return;
      }
      await applyUiMutation(client, "welcome", () => {
        db.config.presentation.welcome.buttons ||= {};
        db.config.presentation.welcome.buttons.begin = begin;
        db.config.presentation.welcome.buttons.quickMains = quick;
        db.config.presentation.welcome.buttons.myCard = card;
      });
      await interaction.reply(buildWelcomeEditorPayload("Кнопки welcome обновлены."));
      return;
    }

    if (interaction.customId === "welcome_editor_tiers_modal") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }
      const nextLabels = {};
      for (const tier of [1, 2, 3, 4, 5]) {
        const value = interaction.fields.getTextInputValue(`tier_label_${tier}`).trim();
        if (!value) {
          await interaction.reply(ephemeralPayload({ content: `Название тира ${tier} не может быть пустым.` }));
          return;
        }
        nextLabels[tier] = value;
      }
      await applyUiMutation(client, "tierlists", () => {
        db.config.presentation.tierlist.labels = nextLabels;
      });
      await interaction.reply(buildWelcomeEditorPayload("Названия тиров обновлены."));
      return;
    }

    if (interaction.customId === "welcome_editor_png_modal") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }
      const textTitle = interaction.fields.getTextInputValue("text_tierlist_title").trim();
      const graphicTitle = interaction.fields.getTextInputValue("graphic_title").trim();
      const graphicMessageText = interaction.fields.getTextInputValue("graphic_message_text").trim();
      if (!textTitle || !graphicTitle || !graphicMessageText) {
        await interaction.reply(ephemeralPayload({ content: "Все поля PNG/tierlist должны быть заполнены." }));
        return;
      }
      await applyUiMutation(client, "tierlists", () => {
        db.config.presentation.tierlist.textTitle = textTitle;
        db.config.presentation.tierlist.graphicTitle = graphicTitle;
        db.config.presentation.tierlist.graphicMessageText = graphicMessageText;
      });
      await interaction.reply(buildWelcomeEditorPayload("Тексты tier-листа и PNG обновлены."));
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
      const characterCatalog = getCharacterCatalog();
      if (characterCatalog.length >= 25) {
        await interaction.reply(ephemeralPayload({ content: "Лимит персонажей для select menu достигнут (25)." }));
        return;
      }
      const charId = normalizeCharacterId(charName, `char_${Date.now()}`);
      const existing = characterCatalog.find((c) => String(c.id).trim() === charId);
      if (existing) {
        await interaction.reply(ephemeralPayload({ content: `Персонаж с ID «${charId}» уже существует.` }));
        return;
      }
      const nextCharacter = { id: charId, label: charName, roleId: "" };
      characterCatalog.push(nextCharacter);
      const rawConfig = loadJsonFile(CONFIG_PATH, {});
      if (!Array.isArray(rawConfig.characters)) rawConfig.characters = [];
      if (!rawConfig.characters.some((entry) => String(entry?.id || "").trim() === charId)) {
        rawConfig.characters.push({ id: charId, label: charName });
      }

      const guild = await getGuild(client);
      let roleNote = "";
      if (guild) {
        try {
          const role = await ensureRoleByName(guild, charName);
          if (role) {
            nextCharacter.roleId = role.id;
            getGeneratedRoleState().characters[charId] = role.id;
            const rawCharacter = rawConfig.characters.find((entry) => String(entry?.id || "").trim() === charId);
            if (rawCharacter) rawCharacter.roleId = role.id;
            roleNote = ` Роль «${role.name}» создана/найдена.`;
          }
        } catch (err) {
          roleNote = ` Не удалось создать роль: ${err?.message || err}`;
        }
      }
      saveDb();
      saveJsonFile(CONFIG_PATH, rawConfig);
      await ensureWelcomePanel(client);
      await interaction.reply(ephemeralPayload({ content: `Персонаж «${charName}» (ID: ${charId}) добавлен в каталог и сразу доступен в выборе мейнов.${roleNote}` }));
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
