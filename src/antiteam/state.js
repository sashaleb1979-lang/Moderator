"use strict";

const crypto = require("node:crypto");

const ANTITEAM_VERSION = 1;

const ANTITEAM_LEVELS = Object.freeze({
  low: {
    id: "low",
    emoji: "🟢",
    label: "Лоутабельные",
    shortLabel: "Лоу",
    description: "Все или почти все до ~2k kills. Если есть 8k+ игрок, поднимай минимум до среднего.",
    accentColor: 0x2E7D32,
  },
  medium: {
    id: "medium",
    emoji: "🟠",
    label: "Средние",
    shortLabel: "Сред",
    description: "Половина или почти все выше 2k и до ~8k kills.",
    accentColor: 0xEF6C00,
  },
  high: {
    id: "high",
    emoji: "🔴",
    label: "Высокие",
    shortLabel: "Хай",
    description: "8k+ kills. Если таких хотя бы треть команды, выбирай этот режим.",
    accentColor: 0xC62828,
  },
});

const ANTITEAM_COUNTS = Object.freeze({
  "2": { id: "2", label: "2", description: "ровно двое" },
  "3-5": { id: "3-5", label: "3-5", description: "небольшая тима" },
  "6-10": { id: "6-10", label: "6-10", description: "большая тима" },
});

// Map legacy stored counts onto the current buckets so old tickets keep rendering.
const ANTITEAM_COUNT_ALIASES = Object.freeze({
  "2-4": "3-5",
  "3-4": "3-5",
  "4-10": "6-10",
  "5-10": "6-10",
  "5-6": "6-10",
});

const ANTITEAM_TICKET_KINDS = Object.freeze(["standard", "clan", "kv"]);
const ANTITEAM_TICKET_STATUSES = Object.freeze(["draft", "photo_pending", "pending_approval", "open", "closed", "cancelled"]);
const ANTITEAM_PING_MODES = Object.freeze(["battalion", "custom_role", "everyone", "edit_roles"]);

// "КВ" (clan war) is a 4th danger mode: registering it publishes a "возможно кв"
// that only pings the two approval targets below. Admins approve it into a real
// KV (which then pings the edit-test roles and opens the thread for helpers) or
// reject it, ending the request with nobody marked. These default targets are the
// IDs the moderation team asked for; they can be overridden via config later.
const KV_APPROVAL_PING_ROLE_ID = "1519762809066361037";
const KV_APPROVAL_PING_USER_ID = "1011666449963688027";

// Kinds that pin the request to a named anchor player (helpers connect through
// them) instead of the requester's own Roblox.
const ANTITEAM_ANCHOR_KINDS = Object.freeze(["clan", "kv"]);

function isAnchorKind(kind) {
  return ANTITEAM_ANCHOR_KINDS.includes(cleanString(kind, 40).toLowerCase());
}
const DISCORD_THREAD_AUTO_ARCHIVE_MINUTES = Object.freeze([60, 1440, 4320, 10080]);
const ANTITEAM_HELPER_REWARD_THRESHOLDS = Object.freeze([1, 5, 10, 20, 50]);

const DEFAULT_CLAN_PING_ROLES = Object.freeze([
  { key: "battalion", label: "Батальён", roleId: "", defaultEnabled: true },
  { key: "battalion_lead", label: "Глава батальонов", roleId: "", defaultEnabled: true },
  { key: "cavalry", label: "Конная дивизия", roleId: "", defaultEnabled: false },
  { key: "eleven_k", label: "11k+", roleId: "", defaultEnabled: false },
  { key: "lcorp", label: "LCorp clan", roleId: "", defaultEnabled: false },
  { key: "core", label: "ЯДРО", roleId: "", defaultEnabled: false },
  { key: "regular", label: "Постоялец", roleId: "", defaultEnabled: false },
]);

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

function normalizeBoolean(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeNonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function normalizePositiveInteger(value, fallback = 1) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function normalizeIntegerDelta(value, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : fallback;
}

function normalizeColorInteger(value, fallback = 0x1565C0) {
  if (Number.isSafeInteger(value) && value >= 0 && value <= 0xFFFFFF) return value;
  const text = cleanString(value, 20).replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(text)) return Number.parseInt(text, 16);
  return fallback;
}

function normalizeThreadAutoArchiveMinutes(value, fallback = 60) {
  const normalizedFallback = DISCORD_THREAD_AUTO_ARCHIVE_MINUTES.includes(Number(fallback)) ? Number(fallback) : 60;
  const number = Number(value);
  return DISCORD_THREAD_AUTO_ARCHIVE_MINUTES.includes(number) ? number : normalizedFallback;
}

function normalizeIsoTimestamp(value, fallback = null) {
  const text = cleanString(value, 80);
  if (!text) return fallback;
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fallback;
}

function normalizeAntiteamLevel(value, fallback = "medium") {
  const normalized = cleanString(value, 40).toLowerCase();
  return ANTITEAM_LEVELS[normalized] ? normalized : fallback;
}

function normalizeAntiteamCount(value, fallback = "3-5") {
  const normalized = cleanString(value, 20);
  if (ANTITEAM_COUNTS[normalized]) return normalized;
  const alias = ANTITEAM_COUNT_ALIASES[normalized];
  if (alias && ANTITEAM_COUNTS[alias]) return alias;
  return ANTITEAM_COUNTS[fallback] ? fallback : "3-5";
}

function normalizeTicketKind(value, fallback = "standard") {
  const normalized = cleanString(value, 40).toLowerCase();
  return ANTITEAM_TICKET_KINDS.includes(normalized) ? normalized : fallback;
}

function normalizeTicketStatus(value, fallback = "open") {
  const normalized = cleanString(value, 40).toLowerCase();
  return ANTITEAM_TICKET_STATUSES.includes(normalized) ? normalized : fallback;
}

function normalizeAntiteamPingMode(value, fallback = "battalion") {
  const normalizedFallback = ANTITEAM_PING_MODES.includes(fallback) ? fallback : "battalion";
  const normalized = cleanString(value, 40).toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "role" || normalized === "custom" || normalized === "custom_ping") return "custom_role";
  if (["edit", "edit_role", "edit_ping", "probe", "test", "buffer", "тест", "буфер"].includes(normalized)) return "edit_roles";
  return ANTITEAM_PING_MODES.includes(normalized) ? normalized : normalizedFallback;
}

function createTicketId(nowIso = new Date().toISOString(), randomBytes = crypto.randomBytes) {
  const day = cleanString(nowIso, 20).slice(0, 10).replace(/-/g, "") || "ticket";
  const suffix = randomBytes(4).toString("hex");
  return `at_${day}_${suffix}`;
}

function normalizeClanPingRole(value = {}, fallback = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const fallbackSource = fallback && typeof fallback === "object" ? fallback : {};
  const label = cleanString(source.label || fallbackSource.label, 80);
  const key = cleanString(source.key || fallbackSource.key || label.toLowerCase().replace(/[^a-z0-9]+/g, "_"), 80);
  if (!key && !label) return null;
  return {
    key: key || label,
    label: label || key,
    roleId: cleanString(source.roleId ?? fallbackSource.roleId, 80),
    defaultEnabled: normalizeBoolean(source.defaultEnabled, fallbackSource.defaultEnabled === true),
  };
}

function normalizeClanPingRoles(value = []) {
  const configured = Array.isArray(value) ? value : [];
  const byKey = new Map();

  for (const defaultRole of DEFAULT_CLAN_PING_ROLES) {
    const override = configured.find((entry) => cleanString(entry?.key, 80) === defaultRole.key) || {};
    const normalized = normalizeClanPingRole({ ...defaultRole, ...override }, defaultRole);
    if (normalized) byKey.set(normalized.key, normalized);
  }

  for (const entry of configured) {
    const normalized = normalizeClanPingRole(entry);
    if (normalized && !byKey.has(normalized.key)) byKey.set(normalized.key, normalized);
  }

  return [...byKey.values()].slice(0, 25);
}

function normalizeStartPanelConfig(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    title: cleanString(source.title, 80) || "⚔️ Антитим",
    description: cleanString(source.description, 700) || "Быстрый вызов батальёна против тимеров. Roblox ник проверяется автоматически, после заявки создаётся ветка миссии.",
    details: cleanString(source.details, 700) || "Если Roblox уже привязан в профиле, ник спрашивать не будем. Для заявки нужны сила команды, число тимеров и ники/киллы целей.",
    buttonLabel: cleanString(source.buttonLabel, 80) || "⚔️ Подать заявку",
    guideButtonLabel: cleanString(source.guideButtonLabel, 80) || "Что дальше?",
    accentColor: normalizeColorInteger(source.accentColor, 0xE53935),
  };
}

function normalizeHelperRewardRoles(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const roles = {};
  for (const threshold of ANTITEAM_HELPER_REWARD_THRESHOLDS) {
    const key = String(threshold);
    roles[key] = cleanString(source[key] ?? source[threshold] ?? source[`role${threshold}`] ?? source[`points${threshold}`], 80);
  }
  return roles;
}

function createDefaultAntiteamConfig(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const roblox = source.roblox && typeof source.roblox === "object" && !Array.isArray(source.roblox) ? source.roblox : {};
  const config = {
    channelId: cleanString(source.channelId, 80),
    panelMessageId: cleanString(source.panelMessageId, 80),
    panelMessageIds: normalizeUniqueStringArray(source.panelMessageIds, 20, 80),
    battalionRoleId: cleanString(source.battalionRoleId, 80),
    battalionPingRoleIds: normalizeUniqueStringArray(
      source.battalionPingRoleIds ?? source.basePingRoleIds ?? source.extraBattalionPingRoleIds,
      25,
      80
    ),
    editPingRoleIds: normalizeUniqueStringArray(
      source.editPingRoleIds ?? source.bufferPingRoleIds ?? source.probePingRoleIds,
      25,
      80
    ),
    battalionLeadRoleId: cleanString(source.battalionLeadRoleId, 80),
    clanCallerRoleId: cleanString(source.clanCallerRoleId, 80),
    // KV "возможно кв" approval ping targets. Empty falls back to the built-in
    // defaults (KV_APPROVAL_PING_ROLE_ID / KV_APPROVAL_PING_USER_ID).
    kvApprovalRoleId: cleanString(source.kvApprovalRoleId, 80),
    kvApprovalUserId: cleanString(source.kvApprovalUserId, 80),
    pingMode: normalizeAntiteamPingMode(source.pingMode, "battalion"),
    testMode: normalizeBoolean(source.testMode, false),
    extraPingRoleId: cleanString(source.extraPingRoleId ?? source.customPingRoleId, 80),
    missionAutoArchiveMinutes: normalizeThreadAutoArchiveMinutes(source.missionAutoArchiveMinutes, 60),
    missionAutoCloseMinutes: normalizePositiveInteger(source.missionAutoCloseMinutes, 120),
    panel: normalizeStartPanelConfig(source.panel),
    clanPingRoles: normalizeClanPingRoles(source.clanPingRoles),
    helperRewardRoles: normalizeHelperRewardRoles(source.helperRewardRoles),
    roblox: {
      jjsPlaceId: cleanString(roblox.jjsPlaceId || source.robloxPlaceId, 40),
      profileUrlTemplate: cleanString(roblox.profileUrlTemplate, 500) || "https://www.roblox.com/users/{userId}/profile",
      directJoinUrlTemplate: cleanString(roblox.directJoinUrlTemplate, 500) || "https://www.roblox.com/games/start?placeId={placeId}&gameInstanceId={gameId}",
      gameUrlTemplate: cleanString(roblox.gameUrlTemplate, 500) || "https://www.roblox.com/games/{placeId}",
      friendRequestsUrl: cleanString(roblox.friendRequestsUrl, 500) || "https://www.roblox.com/users/friends#!/friend-requests",
    },
  };
  for (const role of config.clanPingRoles) {
    if (role.key === "battalion" && !role.roleId) role.roleId = config.battalionRoleId;
    if (role.key === "battalion_lead" && !role.roleId) role.roleId = config.battalionLeadRoleId;
  }
  return config;
}

function normalizePendingTwink(value = null) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : null;
  if (!source) return null;
  const userId = cleanString(source.userId ?? source.id ?? source.robloxUserId, 40);
  if (!userId) return null;
  return normalizeRobloxSnapshot(source);
}

function normalizeRobloxSnapshot(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const userId = cleanString(source.userId ?? source.id ?? source.robloxUserId, 40);
  return {
    userId,
    username: cleanString(source.username ?? source.name ?? source.robloxUsername, 120),
    displayName: cleanString(source.displayName ?? source.robloxDisplayName, 120),
    avatarUrl: cleanString(source.avatarUrl ?? source.robloxAvatarUrl, 2000),
    profileUrl: cleanString(source.profileUrl, 500) || (userId ? `https://www.roblox.com/users/${userId}/profile` : ""),
  };
}

function normalizeSelectedClanPingKeys(value = [], config = createDefaultAntiteamConfig()) {
  const allowed = new Set(config.clanPingRoles.map((entry) => entry.key));
  const selected = [];
  const seen = new Set();
  for (const raw of Array.isArray(value) ? value : []) {
    const key = cleanString(raw, 80);
    if (!key || !allowed.has(key) || seen.has(key)) continue;
    seen.add(key);
    selected.push(key);
  }
  if (selected.length) return selected;
  return config.clanPingRoles.filter((entry) => entry.defaultEnabled).map((entry) => entry.key);
}

function normalizeAntiteamDraft(value = {}, config = createDefaultAntiteamConfig()) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const kind = normalizeTicketKind(source.kind, "standard");
  const anchored = isAnchorKind(kind);
  const anchorUserId = anchored ? cleanString(source.anchorUserId, 80) : "";
  const anchorUserTag = anchored ? cleanString(source.anchorUserTag, 120) : "";
  const now = new Date().toISOString();
  const photos = normalizePhotos(source.photos, source.photo);
  return {
    kind,
    userId: cleanString(source.userId, 80),
    userTag: cleanString(source.userTag, 120),
    anchorUserId,
    anchorUserTag,
    // Why the anchor matters / who they are — required for KV so helpers know who
    // to protect. Stored separately from the situation description.
    anchorNote: anchored ? cleanString(source.anchorNote, 700) : "",
    roblox: normalizeRobloxSnapshot(source.roblox),
    // A twink/alt Roblox bound just for this mission — it never touches the
    // author's profile binding. Set when the requester confirms a temporary nick.
    robloxTemporary: normalizeBoolean(source.robloxTemporary, false),
    // Candidate twink awaiting the requester's confirmation in the setup panel.
    pendingTwink: normalizePendingTwink(source.pendingTwink),
    level: anchored ? kind : normalizeAntiteamLevel(source.level, "medium"),
    count: anchored ? kind : normalizeAntiteamCount(source.count, "3-5"),
    description: cleanString(source.description, 900),
    directJoinEnabled: normalizeBoolean(source.directJoinEnabled, false),
    manualDirectJoinUrl: cleanString(source.manualDirectJoinUrl, 2000),
    photoWanted: normalizeBoolean(source.photoWanted, false),
    photo: photos[0] || null,
    photos,
    selectedClanPingKeys: normalizeSelectedClanPingKeys(source.selectedClanPingKeys, config),
    createdAt: normalizeIsoTimestamp(source.createdAt, now),
    updatedAt: normalizeIsoTimestamp(source.updatedAt, now),
  };
}

function normalizePhoto(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const url = cleanString(source.url, 2000);
  if (!url) return null;
  return {
    url,
    proxyUrl: cleanString(source.proxyUrl, 2000),
    name: cleanString(source.name, 180),
    contentType: cleanString(source.contentType, 120),
    size: normalizeNonNegativeInteger(source.size, 0),
    capturedAt: normalizeIsoTimestamp(source.capturedAt, null),
  };
}

function normalizePhotos(value = [], fallback = null) {
  const input = Array.isArray(value) ? value : [];
  const photos = [];
  const seen = new Set();
  for (const entry of input) {
    const photo = normalizePhoto(entry);
    if (!photo || seen.has(photo.url)) continue;
    seen.add(photo.url);
    photos.push(photo);
    if (photos.length >= 10) break;
  }
  if (!photos.length) {
    const photo = normalizePhoto(fallback);
    if (photo) photos.push(photo);
  }
  return photos;
}

function normalizeHelperRecord(value = {}, userId = "") {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    userId: cleanString(source.userId || userId, 80),
    discordTag: cleanString(source.discordTag, 120),
    robloxUsername: cleanString(source.robloxUsername, 120),
    robloxUserId: cleanString(source.robloxUserId, 40),
    bridgeDiscordUserId: cleanString(source.bridgeDiscordUserId, 80),
    bridgeRobloxUsername: cleanString(source.bridgeRobloxUsername, 120),
    respondedAt: normalizeIsoTimestamp(source.respondedAt, null),
    linkKind: cleanString(source.linkKind, 40),
    linkGrantedAt: normalizeIsoTimestamp(source.linkGrantedAt, null),
    friendRequestNotifiedAt: normalizeIsoTimestamp(source.friendRequestNotifiedAt, null),
    arrived: normalizeBoolean(source.arrived, true),
    arrivedSetAt: normalizeIsoTimestamp(source.arrivedSetAt, null),
  };
}

function normalizeMessageRefs(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    guildId: cleanString(source.guildId, 80),
    channelId: cleanString(source.channelId, 80),
    messageId: cleanString(source.messageId, 80),
    threadId: cleanString(source.threadId, 80),
    threadPanelMessageId: cleanString(source.threadPanelMessageId, 80),
    pingMessageId: cleanString(source.pingMessageId, 80),
    photoAttachmentName: cleanString(source.photoAttachmentName, 180),
    photoAttachmentNames: normalizeUniqueStringArray(source.photoAttachmentNames, 10, 180),
  };
}

function normalizeKvApproval(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const decision = cleanString(source.decision, 20).toLowerCase();
  return {
    decision: ["approved", "rejected"].includes(decision) ? decision : "",
    decidedBy: cleanString(source.decidedBy, 80),
    decidedAt: normalizeIsoTimestamp(source.decidedAt, null),
  };
}

function normalizeAntiteamTicket(value = {}, config = createDefaultAntiteamConfig()) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const kind = normalizeTicketKind(source.kind, "standard");
  const anchored = isAnchorKind(kind);
  const anchorUserId = anchored ? cleanString(source.anchorUserId, 80) : "";
  const anchorUserTag = anchored ? cleanString(source.anchorUserTag, 120) : "";
  const photos = normalizePhotos(source.photos, source.photo);
  const helpers = {};
  for (const [helperUserId, helper] of Object.entries(source.helpers || {})) {
    const normalized = normalizeHelperRecord(helper, helperUserId);
    if (normalized.userId) helpers[normalized.userId] = normalized;
  }
  const now = new Date().toISOString();
  return {
    id: cleanString(source.id, 80),
    kind,
    status: normalizeTicketStatus(source.status, "open"),
    createdBy: cleanString(source.createdBy, 80),
    createdByTag: cleanString(source.createdByTag, 120),
    anchorUserId,
    anchorUserTag,
    anchorNote: anchored ? cleanString(source.anchorNote, 700) : "",
    kvApproval: kind === "kv" ? normalizeKvApproval(source.kvApproval) : normalizeKvApproval(),
    roblox: normalizeRobloxSnapshot(source.roblox),
    robloxTemporary: normalizeBoolean(source.robloxTemporary, false),
    level: anchored ? kind : normalizeAntiteamLevel(source.level, "medium"),
    count: anchored ? kind : normalizeAntiteamCount(source.count, "3-5"),
    description: cleanString(source.description, 1200),
    directJoinEnabled: normalizeBoolean(source.directJoinEnabled, false),
    manualDirectJoinUrl: cleanString(source.manualDirectJoinUrl, 2000),
    autoCloseEnabled: normalizeBoolean(source.autoCloseEnabled, kind !== "clan"),
    test: normalizeBoolean(source.test, false),
    photoWanted: normalizeBoolean(source.photoWanted, false),
    photo: photos[0] || null,
    photos,
    friendEligibleDiscordUserIds: normalizeUniqueStringArray(source.friendEligibleDiscordUserIds, 500, 80),
    selectedClanPingKeys: normalizeSelectedClanPingKeys(source.selectedClanPingKeys, config),
    helpers,
    reports: normalizeReports(source.reports),
    escalationHistory: normalizeEscalations(source.escalationHistory),
    message: normalizeMessageRefs(source.message),
    closeSummary: normalizeCloseSummary(source.closeSummary),
    createdAt: normalizeIsoTimestamp(source.createdAt, now),
    updatedAt: normalizeIsoTimestamp(source.updatedAt, now),
    lastActivityAt: normalizeIsoTimestamp(source.lastActivityAt, source.updatedAt || source.createdAt || now),
    closedAt: normalizeIsoTimestamp(source.closedAt, null),
    closedBy: cleanString(source.closedBy, 80),
    autoClosed: normalizeBoolean(source.autoClosed, false),
  };
}

function normalizeReports(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => ({
      byUserId: cleanString(entry?.byUserId, 80),
      byTag: cleanString(entry?.byTag, 120),
      reason: cleanString(entry?.reason, 900),
      createdAt: normalizeIsoTimestamp(entry?.createdAt, null),
    }))
    .filter((entry) => entry.byUserId && entry.reason)
    .slice(0, 100);
}

function normalizeEscalations(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => ({
      fromLevel: normalizeAntiteamLevel(entry?.fromLevel, "medium"),
      toLevel: normalizeAntiteamLevel(entry?.toLevel, "high"),
      reason: cleanString(entry?.reason, 900),
      byUserId: cleanString(entry?.byUserId, 80),
      byTag: cleanString(entry?.byTag, 120),
      createdAt: normalizeIsoTimestamp(entry?.createdAt, null),
    }))
    .filter((entry) => entry.byUserId && entry.reason)
    .slice(0, 50);
}

function normalizeCloseSummary(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    text: cleanString(source.text, 1200),
    confirmedHelperIds: normalizeUniqueStringArray(source.confirmedHelperIds, 500, 80),
  };
}

function normalizeUniqueStringArray(value = [], limit = 200, itemLimit = 120) {
  const result = [];
  const seen = new Set();
  for (const raw of Array.isArray(value) ? value : []) {
    const normalized = cleanString(raw, itemLimit);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function normalizeHelperStats(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const helpers = {};
  for (const [userId, raw] of Object.entries(source.helpers || {})) {
    const normalizedUserId = cleanString(userId, 80);
    if (!normalizedUserId) continue;
    const entry = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    helpers[normalizedUserId] = {
      responded: normalizeNonNegativeInteger(entry.responded, 0),
      linkGranted: normalizeNonNegativeInteger(entry.linkGranted, 0),
      confirmedArrived: normalizeNonNegativeInteger(entry.confirmedArrived, 0),
      lastTicketId: cleanString(entry.lastTicketId, 80),
      lastHelpedAt: normalizeIsoTimestamp(entry.lastHelpedAt, null),
    };
  }
  return { helpers };
}

function normalizeRobloxConfirmations(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const result = {};
  for (const [userId, raw] of Object.entries(source)) {
    const normalizedUserId = cleanString(userId, 80);
    if (!normalizedUserId) continue;
    const entry = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const robloxUserId = cleanString(entry.robloxUserId, 40);
    if (!robloxUserId) continue;
    result[normalizedUserId] = {
      userId: normalizedUserId,
      robloxUserId,
      confirmedAt: normalizeIsoTimestamp(entry.confirmedAt, null),
    };
  }
  return result;
}

function normalizeAntiteamState(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const config = createDefaultAntiteamConfig(source.config);
  const drafts = {};
  for (const [userId, draft] of Object.entries(source.drafts || {})) {
    const normalizedUserId = cleanString(userId, 80);
    if (!normalizedUserId) continue;
    drafts[normalizedUserId] = normalizeAntiteamDraft({ ...draft, userId: draft?.userId || normalizedUserId }, config);
  }

  const tickets = {};
  for (const [ticketId, ticket] of Object.entries(source.tickets || {})) {
    const normalized = normalizeAntiteamTicket({ id: ticket?.id || ticketId, ...ticket }, config);
    if (normalized.id) tickets[normalized.id] = normalized;
  }

  return {
    version: ANTITEAM_VERSION,
    config,
    drafts,
    photoRequests: normalizePhotoRequests(source.photoRequests, config),
    robloxConfirmations: normalizeRobloxConfirmations(source.robloxConfirmations),
    tickets,
    stats: normalizeHelperStats(source.stats),
  };
}

function normalizePhotoRequests(value = {}, config = createDefaultAntiteamConfig()) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const result = {};
  for (const [userId, raw] of Object.entries(source)) {
    const normalizedUserId = cleanString(userId, 80);
    if (!normalizedUserId) continue;
    const entry = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    result[normalizedUserId] = {
      userId: normalizedUserId,
      channelId: cleanString(entry.channelId || config.channelId, 80),
      createdAt: normalizeIsoTimestamp(entry.createdAt, new Date().toISOString()),
    };
  }
  return result;
}

// Marks a container that has already been through normalizeAntiteamState in this
// process. Symbol-keyed + non-enumerable, so it is never serialized to disk
// (JSON.stringify ignores Symbol keys) and never leaks into the saved db — on
// reload the loaded object is untagged and gets normalized exactly once.
const ANTITEAM_NORMALIZED_TAG = Symbol("antiteamNormalized");

function ensureAntiteamState(db = {}) {
  if (!db.sot || typeof db.sot !== "object" || Array.isArray(db.sot)) {
    db.sot = {};
  }
  const existing = db.sot.antiteam;
  // Fast path: this exact container was already normalized to the current
  // version and the in-memory mutation helpers (which only ever write normalized
  // values back through the same reference) have kept it valid. Skip the deep
  // re-normalize + double full-state JSON.stringify that previously ran on EVERY
  // getState/getConfig/update call — by far the hottest antiteam CPU cost, and
  // the source of event-loop stalls that made interactions slow/lost.
  if (existing && typeof existing === "object" && existing[ANTITEAM_NORMALIZED_TAG] === ANTITEAM_VERSION) {
    return { state: existing, mutated: false };
  }
  const normalized = normalizeAntiteamState(existing);
  const mutated = JSON.stringify(existing || null) !== JSON.stringify(normalized);
  Object.defineProperty(normalized, ANTITEAM_NORMALIZED_TAG, {
    value: ANTITEAM_VERSION,
    enumerable: false,
    configurable: true,
    writable: true,
  });
  db.sot.antiteam = normalized;
  return { state: normalized, mutated };
}

function setAntiteamDraft(db = {}, userId, patch = {}, options = {}) {
  const { state } = ensureAntiteamState(db);
  const normalizedUserId = cleanString(userId, 80);
  if (!normalizedUserId) throw new Error("userId is required");
  const previous = state.drafts[normalizedUserId] || {};
  const draft = normalizeAntiteamDraft({
    ...previous,
    ...clone(patch),
    userId: normalizedUserId,
    updatedAt: options.now || new Date().toISOString(),
  }, state.config);
  state.drafts[normalizedUserId] = draft;
  return draft;
}

function clearAntiteamDraft(db = {}, userId) {
  const { state } = ensureAntiteamState(db);
  const normalizedUserId = cleanString(userId, 80);
  if (!normalizedUserId) return false;
  const existed = Object.prototype.hasOwnProperty.call(state.drafts, normalizedUserId);
  delete state.drafts[normalizedUserId];
  delete state.photoRequests[normalizedUserId];
  return existed;
}

function getAntiteamDraft(db = {}, userId) {
  const { state } = ensureAntiteamState(db);
  const normalizedUserId = cleanString(userId, 80);
  return normalizedUserId ? state.drafts[normalizedUserId] || null : null;
}

function getRobloxConfirmation(db = {}, userId) {
  const { state } = ensureAntiteamState(db);
  const normalizedUserId = cleanString(userId, 80);
  return normalizedUserId ? state.robloxConfirmations[normalizedUserId] || null : null;
}

function markRobloxConfirmed(db = {}, userId, robloxUserId, options = {}) {
  const { state } = ensureAntiteamState(db);
  const normalizedUserId = cleanString(userId, 80);
  const normalizedRobloxUserId = cleanString(robloxUserId, 40);
  if (!normalizedUserId || !normalizedRobloxUserId) return null;
  const entry = {
    userId: normalizedUserId,
    robloxUserId: normalizedRobloxUserId,
    confirmedAt: cleanString(options.now, 80) || new Date().toISOString(),
  };
  state.robloxConfirmations[normalizedUserId] = entry;
  return entry;
}

function createAntiteamTicketFromDraft(db = {}, draft = {}, options = {}) {
  const { state } = ensureAntiteamState(db);
  const normalizedDraft = normalizeAntiteamDraft(draft, state.config);
  const now = cleanString(options.now, 80) || new Date().toISOString();
  const id = cleanString(options.id, 80) || createTicketId(now);
  const status = normalizedDraft.kind === "kv" ? "pending_approval" : "open";
  const ticket = normalizeAntiteamTicket({
    id,
    kind: normalizedDraft.kind,
    status: normalizeTicketStatus(options.status, status),
    createdBy: normalizedDraft.userId,
    createdByTag: normalizedDraft.userTag,
    anchorUserId: normalizedDraft.anchorUserId,
    anchorUserTag: normalizedDraft.anchorUserTag,
    anchorNote: normalizedDraft.anchorNote,
    roblox: normalizedDraft.roblox,
    robloxTemporary: normalizedDraft.robloxTemporary,
    level: normalizedDraft.level,
    count: normalizedDraft.count,
    description: normalizedDraft.description,
    directJoinEnabled: normalizedDraft.directJoinEnabled,
    manualDirectJoinUrl: normalizedDraft.manualDirectJoinUrl,
    test: options.test === true,
    photoWanted: normalizedDraft.photoWanted,
    photo: normalizedDraft.photo,
    photos: normalizedDraft.photos,
    selectedClanPingKeys: normalizedDraft.selectedClanPingKeys,
    friendEligibleDiscordUserIds: options.friendEligibleDiscordUserIds,
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
  }, state.config);
  state.tickets[id] = ticket;
  delete state.drafts[normalizedDraft.userId];
  delete state.photoRequests[normalizedDraft.userId];
  return ticket;
}

function updateAntiteamTicket(db = {}, ticketId, updater) {
  const { state } = ensureAntiteamState(db);
  const id = cleanString(ticketId, 80);
  const current = id ? state.tickets[id] : null;
  if (!current) return null;
  const nextValue = typeof updater === "function" ? updater(clone(current)) : { ...current, ...(updater || {}) };
  const next = normalizeAntiteamTicket(nextValue, state.config);
  state.tickets[id] = next;
  return next;
}

function recordAntiteamHelper(db = {}, ticketId, helper = {}, options = {}) {
  const now = cleanString(options.now, 80) || new Date().toISOString();
  const helperUserId = cleanString(helper.userId, 80);
  if (!helperUserId) throw new Error("helper userId is required");
  return updateAntiteamTicket(db, ticketId, (ticket) => {
    const previous = normalizeHelperRecord(ticket.helpers?.[helperUserId], helperUserId);
    ticket.helpers ||= {};
    ticket.helpers[helperUserId] = normalizeHelperRecord({
      ...previous,
      ...helper,
      userId: helperUserId,
      respondedAt: previous.respondedAt || now,
      linkGrantedAt: helper.linkKind ? now : previous.linkGrantedAt,
    }, helperUserId);
    ticket.updatedAt = now;
    ticket.lastActivityAt = now;
    return ticket;
  });
}

function incrementHelperStats(db = {}, helperUserId, patch = {}, options = {}) {
  const { state } = ensureAntiteamState(db);
  const userId = cleanString(helperUserId, 80);
  if (!userId) return null;
  const current = state.stats.helpers[userId] || {
    responded: 0,
    linkGranted: 0,
    confirmedArrived: 0,
    lastTicketId: "",
    lastHelpedAt: null,
  };
  const now = cleanString(options.now, 80) || new Date().toISOString();
  const next = {
    ...current,
    responded: current.responded + normalizeNonNegativeInteger(patch.responded, 0),
    linkGranted: current.linkGranted + normalizeNonNegativeInteger(patch.linkGranted, 0),
    confirmedArrived: current.confirmedArrived + normalizeNonNegativeInteger(patch.confirmedArrived, 0),
    lastTicketId: cleanString(patch.lastTicketId || current.lastTicketId, 80),
    lastHelpedAt: patch.touch === false ? current.lastHelpedAt : now,
  };
  state.stats.helpers[userId] = next;
  return next;
}

function adjustHelperStatsPoints(db = {}, helperUserId, pointsDelta = 0, options = {}) {
  const { state } = ensureAntiteamState(db);
  const userId = cleanString(helperUserId, 80);
  if (!userId) return null;
  const current = state.stats.helpers[userId] || {
    responded: 0,
    linkGranted: 0,
    confirmedArrived: 0,
    lastTicketId: "",
    lastHelpedAt: null,
  };
  const requestedDelta = normalizeIntegerDelta(pointsDelta, 0);
  const before = normalizeNonNegativeInteger(current.confirmedArrived, 0);
  const after = Math.max(0, before + requestedDelta);
  const now = cleanString(options.now, 80) || new Date().toISOString();
  const next = {
    ...current,
    responded: normalizeNonNegativeInteger(current.responded, 0),
    linkGranted: normalizeNonNegativeInteger(current.linkGranted, 0),
    confirmedArrived: after,
    lastTicketId: cleanString(options.lastTicketId || current.lastTicketId, 80),
    lastHelpedAt: options.touch === false ? current.lastHelpedAt : now,
  };
  state.stats.helpers[userId] = next;
  return {
    userId,
    before,
    after,
    requestedDelta,
    appliedDelta: after - before,
    stats: next,
  };
}

function deleteHelperStats(db = {}, helperUserId) {
  const { state } = ensureAntiteamState(db);
  const userId = cleanString(helperUserId, 80);
  if (!userId || !state.stats.helpers[userId]) return false;
  delete state.stats.helpers[userId];
  return true;
}

function clearHelperStats(db = {}) {
  const { state } = ensureAntiteamState(db);
  const count = Object.keys(state.stats.helpers || {}).length;
  state.stats.helpers = {};
  return count;
}

function setTicketHelperArrival(db = {}, ticketId, helperUserId, arrived, options = {}) {
  const now = cleanString(options.now, 80) || new Date().toISOString();
  return updateAntiteamTicket(db, ticketId, (ticket) => {
    const userId = cleanString(helperUserId, 80);
    if (!userId || !ticket.helpers?.[userId]) return ticket;
    ticket.helpers[userId].arrived = arrived === true;
    ticket.helpers[userId].arrivedSetAt = now;
    ticket.updatedAt = now;
    return ticket;
  });
}

function setAllTicketHelpersArrival(db = {}, ticketId, arrived, options = {}) {
  const now = cleanString(options.now, 80) || new Date().toISOString();
  return updateAntiteamTicket(db, ticketId, (ticket) => {
    for (const helper of Object.values(ticket.helpers || {})) {
      helper.arrived = arrived === true;
      helper.arrivedSetAt = now;
    }
    ticket.updatedAt = now;
    return ticket;
  });
}

function setKvApprovalDecision(db = {}, ticketId, decision, options = {}) {
  const now = cleanString(options.now, 80) || new Date().toISOString();
  const normalizedDecision = cleanString(decision, 20).toLowerCase();
  return updateAntiteamTicket(db, ticketId, (ticket) => {
    if (ticket.kind !== "kv") return ticket;
    ticket.kvApproval = normalizeKvApproval({
      decision: normalizedDecision,
      decidedBy: cleanString(options.decidedBy, 80),
      decidedAt: now,
    });
    if (normalizedDecision === "approved") {
      ticket.status = "open";
    } else if (normalizedDecision === "rejected") {
      ticket.status = "cancelled";
      ticket.closedAt = now;
      ticket.closedBy = cleanString(options.decidedBy, 80);
    }
    ticket.updatedAt = now;
    ticket.lastActivityAt = now;
    return ticket;
  });
}

function closeAntiteamTicket(db = {}, ticketId, options = {}) {
  const now = cleanString(options.now, 80) || new Date().toISOString();
  return updateAntiteamTicket(db, ticketId, (ticket) => {
    ticket.status = "closed";
    ticket.closedAt = now;
    ticket.closedBy = cleanString(options.closedBy, 80);
    ticket.autoClosed = options.autoClosed === true;
    ticket.closeSummary = normalizeCloseSummary({
      text: options.summaryText,
      confirmedHelperIds: options.confirmedHelperIds,
    });
    ticket.updatedAt = now;
    return ticket;
  });
}

function listOpenAntiteamTickets(db = {}) {
  const { state } = ensureAntiteamState(db);
  return Object.values(state.tickets).filter((ticket) =>
    ticket.status === "open" || ticket.status === "photo_pending" || ticket.status === "pending_approval");
}

function findIdleAntiteamTickets(db = {}, now = new Date().toISOString()) {
  const { state } = ensureAntiteamState(db);
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) return [];
  const closeMs = Math.max(1, state.config.missionAutoCloseMinutes) * 60 * 1000;
  return listOpenAntiteamTickets(db).filter((ticket) => {
    if (ticket.kind === "clan" || ticket.kind === "kv") return false;
    if (ticket.status !== "open") return false;
    if (ticket.autoCloseEnabled === false) return false;
    const lastMs = Date.parse(ticket.lastActivityAt || ticket.updatedAt || ticket.createdAt || "");
    return Number.isFinite(lastMs) && nowMs - lastMs >= closeMs;
  });
}

function matchRobloxFriendsToDiscordProfiles(profiles = {}, friends = []) {
  const friendRobloxIds = new Set((Array.isArray(friends) ? friends : [])
    .map((friend) => cleanString(friend?.userId ?? friend?.id, 40))
    .filter(Boolean));
  if (!friendRobloxIds.size) return [];

  const matched = [];
  for (const [discordUserId, profile] of Object.entries(profiles || {})) {
    const roblox = profile?.domains?.roblox || profile?.summary?.roblox || {};
    const robloxUserId = cleanString(roblox.userId || roblox.robloxUserId, 40);
    const status = cleanString(roblox.verificationStatus, 40);
    if (robloxUserId && friendRobloxIds.has(robloxUserId) && status === "verified") {
      matched.push(discordUserId);
    }
  }
  return normalizeUniqueStringArray(matched, 500, 80);
}

module.exports = {
  ANTITEAM_ANCHOR_KINDS,
  ANTITEAM_COUNTS,
  ANTITEAM_HELPER_REWARD_THRESHOLDS,
  ANTITEAM_LEVELS,
  ANTITEAM_PING_MODES,
  ANTITEAM_TICKET_KINDS,
  ANTITEAM_TICKET_STATUSES,
  ANTITEAM_VERSION,
  DEFAULT_CLAN_PING_ROLES,
  KV_APPROVAL_PING_ROLE_ID,
  KV_APPROVAL_PING_USER_ID,
  cleanString,
  adjustHelperStatsPoints,
  clearAntiteamDraft,
  clearHelperStats,
  closeAntiteamTicket,
  createAntiteamTicketFromDraft,
  createDefaultAntiteamConfig,
  createTicketId,
  deleteHelperStats,
  ensureAntiteamState,
  findIdleAntiteamTickets,
  getAntiteamDraft,
  getRobloxConfirmation,
  incrementHelperStats,
  isAnchorKind,
  listOpenAntiteamTickets,
  markRobloxConfirmed,
  matchRobloxFriendsToDiscordProfiles,
  normalizeAntiteamCount,
  normalizeAntiteamDraft,
  normalizeAntiteamLevel,
  normalizeAntiteamPingMode,
  normalizeAntiteamState,
  normalizeAntiteamTicket,
  normalizeClanPingRoles,
  recordAntiteamHelper,
  setAllTicketHelpersArrival,
  setAntiteamDraft,
  setKvApprovalDecision,
  setTicketHelperArrival,
  updateAntiteamTicket,
};
