"use strict";

const { buildProfileSynergyState } = require("./synergy");
const {
  formatRobloxBindingStatusLine,
  formatRobloxReadinessLabel,
} = require("../integrations/roblox-binding-status");
const {
  buildRobloxProfileUrl,
  deriveProfileMainView,
  getRobloxTrackabilityBlocker,
  getRobloxTrackabilityState,
  normalizeRobloxDomainState,
  resolveRobloxDisplayIdentity,
  resolveUsableVerifiedRobloxIdentity,
} = require("../integrations/shared-profile");
const {
  BASE_KILL_TIER_THRESHOLDS,
  KILL_MILESTONE_THRESHOLDS,
} = require("../onboard/kill-tiers");

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

const PROFILE_DISPLAY_MODES = Object.freeze(["viewer", "self", "compact-card"]);
const DEFAULT_HIDDEN_PROFILE_ROLE_IDS = Object.freeze(["1146511958305144883"]);
const JJS_WIKI_CHARACTERS_URL = "https://jujutsu-shenanigans.fandom.com/wiki/Characters";
const PROFILE_RATING_AXES = Object.freeze(["activity", "kills", "jjs"]);
const PROFILE_RATING_AXIS_WEIGHTS = Object.freeze({
  activity: 0.3,
  kills: 0.4,
  jjs: 0.3,
});
const PROFILE_RATING_LOCK_PENALTY_PERCENT = 20;
const PROFILE_RATING_KILLS_LOCK_PENALTY_PERCENT = 40;
const PROFILE_RATING_LOCK_PENALTY_CAP_PERCENT = 80;
const PROFILE_KILLS_DAY_OUTLIER_LIMIT = 400;
const PROFILE_RATING_AXIS_LABELS = Object.freeze({
  activity: { emoji: "🟣", label: "Активность" },
  kills: { emoji: "⚔️", label: "Kills" },
  jjs: { emoji: "🎮", label: "JJS" },
});
const PROFILE_TRUST_LABELS = Object.freeze({
  reliable: "точный расчёт",
  fresh: "точный расчёт",
  measured: "точный расчёт",
  partial: "частичный расчёт",
  stale: "старые данные",
  outdated: "старые данные",
  heuristic: "примерная оценка",
  inferred: "примерная оценка",
  proxy: "примерная оценка",
  sparse: "мало базы",
  unavailable: "нет базы",
  empty: "нет базы",
});
const PROFILE_SECTION_GROUPS = Object.freeze({
  overview: [
    { title: "🔥 Рейтинг", tone: "summary", density: "compact", titles: ["🔥 Рейтинг профиля"] },
    { title: "📊 Активность", tone: "summary", density: "compact", titles: ["📊 Сводка активности"] },
    { title: "🧩 Ядро", tone: "dossier", density: "compact", titles: ["Main Core", "🧩 Ядро профиля"] },
  ],
  activity: [
    { title: "📊 Итог", tone: "summary", density: "compact", titles: ["📊 Итог активности", "💬 Сообщения", "🎙️ Voice", "🎮 JJS"] },
    { title: "🗓️ Неделя", tone: "dossier", density: "normal", titles: ["🗓️ Неделя", "⚔️ Рост активности", "Prime time МСК", "Prime time confidence"] },
    { title: "🏆 Сезон", tone: "dossier", density: "normal", titles: ["Лучшие периоды", "Weekly rollups", "Season consistency", "Comeback metrics", "🏆 Сезон"] },
  ],
  progress: [
    { title: "⚔️ Матч-репорт", tone: "summary", density: "compact", titles: ["⚔️ Сейчас", "📈 Темп", "🧾 Proof"] },
    { title: "🗓️ Динамика", tone: "dossier", density: "compact", titles: ["🗓️ Недели", "💡 До апа", "🏆 Прайм и рекорды", "Antiteam support"] },
  ],
  social: [
    { title: "🚧 Статус", tone: "summary", density: "compact", titles: ["🚧 Соц-карта"] },
    { title: "✅ Проверенные связи", tone: "summary", density: "normal", titles: ["🤝 Roblox и соц", "Проверенный круг", "Roblox-друзья на сервере", "Кто из друзей уже здесь"] },
    { title: "🗺️ Социальная карта", tone: "dossier", density: "normal", titles: ["Социальная карта", "Voice + game overlap", "🎮 С кем чаще всего играет", "Скрытый круг"] },
    { title: "🎭 Main dossier", tone: "dossier", density: "compact", titles: ["Социальная эволюция"] },
  ],
  compact: [
    { title: "⚡ Карточка", tone: "summary", density: "compact", titles: ["Карточка", "Моя карточка", "Готовность", "ELO и Tierlist", "Roblox и соц"] },
  ],
});
const PROFILE_COMPONENT_BUDGET = Object.freeze({
  maxTextDisplays: 8,
  maxSectionTextDisplays: 8,
  sectionTextLimit: 3900,
  blockTextLimit: 1350,
});

function normalizeProfileDisplayMode(value, { isSelf = false } = {}) {
  const normalized = cleanString(value, 40).toLowerCase();
  if (PROFILE_DISPLAY_MODES.includes(normalized)) return normalized;
  return isSelf ? "self" : "viewer";
}

function normalizeFiniteNumber(value, fallback = null) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : fallback;
}

function normalizeNullableFiniteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  return normalizeFiniteNumber(value, fallback);
}

function normalizeTrustState(value = "", fallback = "partial") {
  const normalized = cleanString(value, 40).toLowerCase();
  if (["fresh", "reliable", "measured", "session-history"].includes(normalized)) return "reliable";
  if (["partial", "short", "local_fallback"].includes(normalized)) return "partial";
  if (["stale", "outdated"].includes(normalized)) return "outdated";
  if (["heuristic", "inferred", "proxy", "sparse"].includes(normalized)) return "heuristic";
  if (["unavailable", "n/a", "empty", "none"].includes(normalized)) return "unavailable";
  return fallback;
}

function formatTrustLabel(value = "", fallback = "partial") {
  return PROFILE_TRUST_LABELS[normalizeTrustState(value, fallback)] || PROFILE_TRUST_LABELS.partial;
}

function inferBlockTrustState(block = {}) {
  const explicit = cleanString(block?.trustState || block?.confidenceState || block?.freshnessState, 40);
  if (explicit) return normalizeTrustState(explicit);

  const text = [
    cleanString(block?.title, 120),
    ...(Array.isArray(block?.lines) ? block.lines : []),
  ].join("\n").toLowerCase();
  if (/outdated|устар|stale|proof сильно отстал/.test(text)) return "outdated";
  if (/unavailable|нет базы|source gap|n\/a|место n\/a|нет сигнала|пока не|ещё не|insufficient|недостат/.test(text)) return "unavailable";
  if (/heuristic|inferred|proxy|эврист|rolling|коротк|частич|partial|sparse/.test(text)) return "partial";
  if (/reliable|fresh|measured|session-history|свеж|подтвержд|verified/.test(text)) return "reliable";
  return "partial";
}

function inferBlockSurfaceState(block = {}) {
  const trust = inferBlockTrustState(block);
  const text = (Array.isArray(block?.lines) ? block.lines : []).join("\n").toLowerCase();
  if (trust === "unavailable") return /пока|ещё|нет|n\/a/.test(text) ? "empty" : "degraded";
  if (trust === "outdated") return "degraded";
  if (trust === "partial" || trust === "heuristic") return "partial";
  return "rich";
}

function inferBlockPriority(block = {}) {
  const title = cleanString(block?.title, 120);
  if (/Обзор|Главное|Оценка профиля|Уровень|Роли|Main Core|Готовность|Activity mix|Proof gap|Практический/.test(title)) return 10;
  if (/Voice|Prime|Лучшие|Weekly|История сезона|Вклад|ELO|Roblox|Проверенный|Социальная карта/.test(title)) return 20;
  return 30;
}

function annotateProfileBlock(block = {}, overrides = {}) {
  const title = cleanString(block?.title, 120) || "Блок";
  const lines = Array.isArray(block?.lines) ? block.lines : [];
  const state = cleanString(overrides.state, 40) || inferBlockSurfaceState(block);
  const trustState = cleanString(overrides.trustState, 40) || inferBlockTrustState(block);
  const density = cleanString(overrides.density, 40) || (lines.length > 5 ? "dense" : "normal");
  const priority = normalizeFiniteNumber(overrides.priority, inferBlockPriority(block));
  const presentation = {
    priority,
    density,
    state,
    trustState,
    trustLabel: formatTrustLabel(trustState),
  };
  return {
    ...block,
    title,
    lines,
    priority,
    density,
    state,
    trustLabel: presentation.trustLabel,
    presentation,
  };
}

function isSparseProfileBlock(block = {}) {
  const lines = Array.isArray(block?.lines) ? block.lines.filter(Boolean) : [];
  if (!lines.length) return true;
  const text = lines.join("\n").toLowerCase();
  return lines.length <= 2 && /нет замет|пока нет|ещё нет|не найден|не хватает|нет данных|нет базы|n\/a|unavailable|insufficient/.test(text);
}

function compactProfileBlock(block = {}, maxLines = 3) {
  if (!block || typeof block !== "object") return null;
  const lines = (Array.isArray(block.lines) ? block.lines : [])
    .filter(Boolean)
    .slice(0, Math.max(1, Number(maxLines) || 3));
  if (!lines.length) return null;
  return {
    ...block,
    lines,
  };
}

function includeProfileBlock(block = {}, maxLines = 3) {
  const compact = compactProfileBlock(block, maxLines);
  return compact && !isSparseProfileBlock(compact) ? [compact] : [];
}

function buildSectionGroups(sections = {}) {
  const result = {};
  for (const [sectionKey, blocks] of Object.entries(sections || {})) {
    const annotatedBlocks = (Array.isArray(blocks) ? blocks : [])
      .map((block) => annotateProfileBlock(block))
      .filter((block) => block.lines.length);
    const used = new Set();
    const groups = [];

    for (const groupDef of PROFILE_SECTION_GROUPS[sectionKey] || []) {
      const wanted = new Set(groupDef.titles || []);
      const groupBlocks = annotatedBlocks.filter((block, index) => {
        if (used.has(index) || !wanted.has(block.title)) return false;
        used.add(index);
        return true;
      });
      if (groupBlocks.length) {
        groups.push({
          title: groupDef.title,
          tone: groupDef.tone,
          density: groupDef.density,
          blocks: groupBlocks,
        });
      }
    }

    const extras = annotatedBlocks.filter((_, index) => !used.has(index));
    if (extras.length) {
      groups.push({
        title: "📌 Дополнительно",
        tone: "technical",
        density: "dense",
        blocks: extras,
      });
    }

    result[sectionKey] = groups;
  }
  return result;
}

function formatNumber(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? new Intl.NumberFormat("ru-RU").format(amount) : "—";
}

function formatSignedNumber(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  if (amount > 0) return `+${formatNumber(amount)}`;
  if (amount < 0) return `-${formatNumber(Math.abs(amount))}`;
  return formatNumber(amount);
}

function formatPercent(value, digits = 1) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return `${amount.toFixed(Math.max(0, Number(digits) || 0))}%`;
}

function formatDateTime(value) {
  const timestamp = Number.isFinite(Number(value))
    ? Number(value)
    : Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) return "—";
  return new Date(timestamp).toLocaleString("ru-RU");
}

function formatDurationDaysSince(value) {
  const timestamp = Number.isFinite(Number(value))
    ? Number(value)
    : Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) return "—";
  const diffMs = Math.max(0, Date.now() - timestamp);
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  return `${diffDays} дн.`;
}

function formatHours(value, digits = 1) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.max(0, Number(digits) || 0),
  }).format(amount);
}

function formatJjsHoursFromMinutes(value, digits = 1) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) return "—";
  const hours = Math.floor((minutes / 60) * 10) / 10;
  return `${formatHours(hours, digits)} ч`;
}

function buildRobloxSyncHealth({ jobState = null, playtimePollMinutes = 2, now = null } = {}) {
  const job = jobState && typeof jobState === "object" && !Array.isArray(jobState) ? jobState : null;
  if (!job) return null;

  const status = cleanString(job.status, 40).toLowerCase();
  const summary = job.summary && typeof job.summary === "object" ? job.summary : {};
  const pollMs = Math.max(1, Number(playtimePollMinutes) || 2) * 60 * 1000;
  const nowMs = Number.isFinite(Number(now)) ? Number(now) : Date.parse(String(now || "")) || Date.now();
  const lastHeartbeat = cleanString(job.lastFinishedAt || job.lastStartedAt, 80);
  const lastHeartbeatMs = Date.parse(lastHeartbeat || "");
  const skippedReason = cleanString(summary.skippedReason, 120);

  if (skippedReason === "jjs_ids_not_configured") {
    return {
      state: "broken",
      critical: true,
      line: "JJS sync не работает: не настроены JJS place IDs.",
    };
  }
  if (status === "error") {
    return {
      state: "broken",
      critical: true,
      line: `JJS sync не работает: ${cleanString(job.errorText, 120) || "последний запуск упал"}.`,
    };
  }
  if (!Number.isFinite(lastHeartbeatMs)) {
    return {
      state: "missing",
      critical: true,
      line: "JJS sync ещё не запускался после перезапуска.",
    };
  }

  const ageMs = Math.max(0, nowMs - lastHeartbeatMs);
  if (ageMs > pollMs * 2) {
    return {
      state: "stale",
      critical: true,
      line: `JJS sync молчит ${formatHours(ageMs / (60 * 60 * 1000))} ч.`,
    };
  }
  if (normalizeFiniteNumber(summary.failedBatches, 0) > 0) {
    return {
      state: "degraded",
      critical: true,
      line: `JJS sync теряет пачки Roblox: ${formatNumber(summary.failedBatches)}.`,
    };
  }

  return {
    state: status === "running" ? "running" : "ok",
    critical: false,
    line: "",
  };
}

function normalizeMediaUrl(value, limit = 2000) {
  const text = cleanString(value, limit);
  return /^https?:\/\//i.test(text) ? text : null;
}

function normalizeHiddenRoleIds(values = []) {
  return new Set([
    ...DEFAULT_HIDDEN_PROFILE_ROLE_IDS,
    ...(Array.isArray(values) ? values : []),
  ].map((entry) => cleanString(entry, 80)).filter(Boolean));
}

function extractRoleMentionId(value = "") {
  const text = cleanString(value, 120);
  const match = text.match(/^<@&([^>]+)>$/);
  return match ? cleanString(match[1], 80) : text;
}

function filterDisplayRoleMentions(roleMentions = [], hiddenRoleIds = new Set()) {
  return (Array.isArray(roleMentions) ? roleMentions : [])
    .filter(Boolean)
    .filter((mention) => !hiddenRoleIds.has(extractRoleMentionId(mention)));
}

function computeKillStanding(entries = [], userId = "") {
  const normalizedUserId = cleanString(userId, 80);
  const ranked = (Array.isArray(entries) ? entries : [])
    .filter((entry) => Number.isFinite(Number(entry?.approvedKills)))
    .slice();

  ranked.sort((left, right) => {
    const leftKills = Number(left?.approvedKills) || 0;
    const rightKills = Number(right?.approvedKills) || 0;
    if (rightKills !== leftKills) return rightKills - leftKills;
    return cleanString(left?.displayName, 200).localeCompare(cleanString(right?.displayName, 200), "ru");
  });

  const totalKills = ranked.reduce((sum, entry) => sum + (Number(entry?.approvedKills) || 0), 0);
  const index = ranked.findIndex((entry) => cleanString(entry?.userId, 80) === normalizedUserId);
  const currentEntry = index >= 0 ? ranked[index] : null;
  const previousEntry = index > 0 ? ranked[index - 1] : null;
  const leaderEntry = ranked[0] || null;
  const approvedKills = Number(currentEntry?.approvedKills);
  const shareOfServerKills = Number.isFinite(approvedKills) && totalKills > 0
    ? (approvedKills / totalKills) * 100
    : null;
  const killsToNextRank = previousEntry && Number.isFinite(approvedKills)
    ? Math.max(1, Math.floor((Number(previousEntry.approvedKills) || 0) - approvedKills + 1))
    : null;
  const killsToLeader = leaderEntry && Number.isFinite(approvedKills) && cleanString(leaderEntry?.userId, 80) !== normalizedUserId
    ? Math.max(1, Math.floor((Number(leaderEntry.approvedKills) || 0) - approvedKills + 1))
    : 0;

  return {
    rank: index >= 0 ? index + 1 : null,
    totalVerified: ranked.length,
    totalKills,
    shareOfServerKills,
    killsToNextRank,
    killsToLeader,
    currentEntry: normalizeProfileLeaderboardEntry(currentEntry),
    nextRankEntry: normalizeProfileLeaderboardEntry(previousEntry),
    leaderEntry: normalizeProfileLeaderboardEntry(leaderEntry),
  };
}

function normalizeProfileLeaderboardEntry(entry = null) {
  if (!entry || typeof entry !== "object") return null;
  const profile = entry?.profile && typeof entry.profile === "object" ? entry.profile : entry;
  const summary = profile?.summary && typeof profile.summary === "object" ? profile.summary : {};
  const displayName = cleanString(
    entry.displayName
    || entry.username
    || summary.preferredDisplayName
    || profile.displayName
    || profile.username,
    120
  );
  const userId = cleanString(entry.userId || profile.userId || profile.discordUserId || profile.id, 80);
  const approvedKills = normalizeNullableFiniteNumber(entry.approvedKills ?? profile.approvedKills ?? summary?.onboarding?.approvedKills);
  if (!displayName && !userId && !Number.isFinite(approvedKills)) return null;
  return {
    userId,
    displayName,
    approvedKills,
  };
}

function getProfileWeeklyWindowCount(profile = null) {
  const weeklyRollups = Array.isArray(profile?.domains?.seasonArchive?.weeklyRollups)
    ? profile.domains.seasonArchive.weeklyRollups
    : [];
  return weeklyRollups.length;
}

function buildStatBar(percent = 0, size = 8) {
  const normalizedSize = Math.max(4, Number(size) || 8);
  const filled = Math.max(0, Math.min(normalizedSize, Math.round((Math.max(0, Math.min(100, Number(percent) || 0)) / 100) * normalizedSize)));
  return `${"▰".repeat(filled)}${"▱".repeat(normalizedSize - filled)}`;
}

function buildScoreBar(score = 0, size = 5) {
  return buildStatBar(Math.max(0, Math.min(100, Number(score) || 0)), size);
}

function formatProfileRatingScore(score = null) {
  if (score === null || score === undefined || score === "") return "—";
  const amount = normalizeFiniteNumber(score);
  return Number.isFinite(amount) ? formatNumber(Math.round(amount)) : "—";
}

function hasProfileRatingScore(score = null) {
  if (score === null || score === undefined || score === "") return false;
  return Number.isFinite(Number(score));
}

function formatProfileRatingRank(summary = {}) {
  const rank = normalizeNullableFiniteNumber(summary?.rank);
  const total = normalizeNullableFiniteNumber(summary?.total);
  return Number.isFinite(rank) && Number.isFinite(total) && total > 0
    ? ` · #${formatNumber(rank)}/${formatNumber(total)}`
    : "";
}

function getActivityVoiceHours(activitySummary = {}, period = "30d") {
  const suffix = period === "7d" ? "7d" : "30d";
  const rawSeconds = normalizeNullableFiniteNumber(activitySummary?.[`voiceDurationSeconds${suffix}`]);
  if (Number.isFinite(rawSeconds)) return rawSeconds / 3600;
  const effectiveHours = normalizeNullableFiniteNumber(activitySummary?.[`effectiveVoiceHours${suffix}`]);
  return Number.isFinite(effectiveHours) ? effectiveHours : null;
}

function getActivityActiveDays(activitySummary = {}, period = "7d") {
  const direct = normalizeNullableFiniteNumber(activitySummary?.[`activeDays${period === "7d" ? "7d" : "30d"}`]);
  if (Number.isFinite(direct)) return direct;
  if (period === "7d") {
    const fallback30d = normalizeNullableFiniteNumber(activitySummary?.activeDays30d);
    if (Number.isFinite(fallback30d)) return Math.min(7, fallback30d);
  }
  return null;
}

function buildProfileGrade(score = null) {
  if (score === null || score === undefined || score === "") return "N/A";
  const amount = Number(score);
  if (!Number.isFinite(amount)) return "N/A";
  if (amount >= 97) return "S+";
  if (amount >= 92) return "S";
  if (amount >= 87) return "A+";
  if (amount >= 82) return "A";
  if (amount >= 77) return "A-";
  if (amount >= 72) return "B+";
  if (amount >= 67) return "B";
  if (amount >= 62) return "B-";
  if (amount >= 55) return "C+";
  if (amount >= 48) return "C";
  if (amount >= 42) return "C-";
  if (amount >= 35) return "D+";
  if (amount >= 28) return "D";
  return "D-";
}

function formatProfileAxisRank(axis = {}) {
  const rank = normalizeNullableFiniteNumber(axis?.place?.rank);
  const total = normalizeNullableFiniteNumber(axis?.place?.total);
  return Number.isFinite(rank) && Number.isFinite(total) && total > 0
    ? ` #${formatNumber(rank)}/${formatNumber(total)}`
    : "";
}

function resolveProfileRatingPlace(axes = []) {
  const rankedAxes = (Array.isArray(axes) ? axes : [])
    .map((axis) => ({
      rank: normalizeNullableFiniteNumber(axis?.place?.rank),
      total: normalizeNullableFiniteNumber(axis?.place?.total),
    }))
    .filter((entry) => Number.isFinite(entry.rank) && Number.isFinite(entry.total) && entry.total > 1);
  if (!rankedAxes.length) return { rank: null, total: null };

  const total = Math.max(...rankedAxes.map((entry) => entry.total));
  const averagePercentile = rankedAxes.reduce((sum, entry) => (
    sum + ((entry.rank - 1) / Math.max(1, entry.total - 1))
  ), 0) / rankedAxes.length;

  return {
    rank: Math.max(1, Math.min(total, Math.round((averagePercentile * (total - 1)) + 1))),
    total,
  };
}

const PROFILE_GRADE_TARGETS = Object.freeze([
  { grade: "D", score: 28 },
  { grade: "D+", score: 35 },
  { grade: "C-", score: 42 },
  { grade: "C", score: 48 },
  { grade: "C+", score: 55 },
  { grade: "B-", score: 62 },
  { grade: "B", score: 67 },
  { grade: "B+", score: 72 },
  { grade: "A-", score: 77 },
  { grade: "A", score: 82 },
  { grade: "A+", score: 87 },
  { grade: "S", score: 92 },
  { grade: "S+", score: 97 },
]);

function clampRatingScore(value, min = 0, max = 100) {
  const amount = normalizeFiniteNumber(value, min);
  return Math.max(min, Math.min(max, Number.isFinite(amount) ? amount : min));
}

function formatRatingModifier(value = 0) {
  const amount = Math.round(normalizeFiniteNumber(value, 0));
  if (amount > 0) return `+${formatNumber(amount)}%`;
  if (amount < 0) return `-${formatNumber(Math.abs(amount))}%`;
  return "±0%";
}

function getNextGradeTarget(score = null) {
  const amount = normalizeFiniteNumber(score);
  if (!Number.isFinite(amount)) return PROFILE_GRADE_TARGETS[0];
  return PROFILE_GRADE_TARGETS.find((entry) => amount < entry.score) || null;
}

function normalizeRatingTarget(value = null, { floor = 0, target = 100 } = {}) {
  const amount = normalizeFiniteNumber(value);
  if (!Number.isFinite(amount)) return 0;
  const normalizedFloor = normalizeFiniteNumber(floor, 0);
  const normalizedTarget = Math.max(normalizedFloor + 0.1, normalizeFiniteNumber(target, 100));
  return clampRatingScore(((amount - normalizedFloor) / (normalizedTarget - normalizedFloor)) * 100);
}

function buildPeakTarget(samples = [], multiplier = 0.8, fallbackTarget = 100) {
  const values = (Array.isArray(samples) ? samples : [])
    .map((entry) => normalizeFiniteNumber(entry))
    .filter((entry) => Number.isFinite(entry) && entry > 0);
  const fallback = Math.max(0.1, normalizeFiniteNumber(fallbackTarget, 100));
  if (!values.length) return fallback;
  return Math.max(fallback, Math.max(...values) * multiplier);
}

function getSPlusGradeTarget() {
  return PROFILE_GRADE_TARGETS.find((entry) => entry.grade === "S+") || { grade: "S+", score: 97 };
}

function formatShortDate(value = null) {
  const timestamp = Number.isFinite(Number(value)) ? Number(value) : Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) return "дата неизвестна";
  const date = new Date(timestamp);
  return `${String(date.getUTCDate()).padStart(2, "0")}.${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatDateRange(fromAt = null, toAt = null) {
  const fromLabel = formatShortDate(fromAt);
  const toLabel = formatShortDate(toAt);
  if (fromLabel === "дата неизвестна" && toLabel === "дата неизвестна") return "даты неизвестны";
  if (fromLabel === "дата неизвестна") return `до ${toLabel}`;
  if (toLabel === "дата неизвестна") return `с ${fromLabel}`;
  return `${fromLabel} → ${toLabel}`;
}

function resolveProfileBenchmarkOwner(entry = null, fallback = "лучший профиль в выборке") {
  if (!entry || typeof entry !== "object") {
    return { label: fallback, hasName: false, userId: "" };
  }
  const normalized = normalizeProfileLeaderboardEntry(entry) || {};
  const profile = entry?.profile && typeof entry.profile === "object" ? entry.profile : entry;
  const summary = profile?.summary && typeof profile.summary === "object" ? profile.summary : {};
  const displayName = cleanString(
    normalized.displayName
    || (entry.hasName === false || entry.ownerHasName === false ? "" : entry.label)
    || entry.ownerLabel
    || entry.displayName
    || entry.username
    || summary.preferredDisplayName
    || profile.displayName
    || profile.username,
    120
  );
  const userId = cleanString(normalized.userId || entry.userId || profile.userId || profile.discordUserId || profile.id, 80);
  if (displayName) return { label: displayName, hasName: true, userId };
  if (userId) return { label: `профиль ${userId}`, hasName: true, userId };
  return { label: fallback, hasName: false, userId: "" };
}

function formatProfileBenchmarkOwner(entry = null, valueText = "") {
  const owner = resolveProfileBenchmarkOwner(entry);
  const suffix = cleanString(valueText, 120);
  return `${owner.label}${suffix ? ` · ${suffix}` : ""}${owner.hasName ? "" : ", имя не передано"}`;
}

function formatMissingAmount(current = null, target = null, unit = "") {
  const currentValue = normalizeNullableFiniteNumber(current);
  const targetValue = normalizeNullableFiniteNumber(target);
  const unitLabel = cleanString(unit, 30);
  if (!Number.isFinite(currentValue) || !Number.isFinite(targetValue)) return "не хватает данных для расчёта";
  const gap = targetValue - currentValue;
  const formattedGap = unitLabel === "ч" ? formatHours(Math.abs(gap)) : formatNumber(Math.ceil(Math.abs(gap)));
  const suffix = unitLabel ? `${unitLabel === "ч" ? "" : " "}${unitLabel}` : "";
  if (gap <= 0) return `планка уже закрыта, запас +${formattedGap}${suffix}`;
  return `не хватает ${formattedGap}${suffix}`;
}

function formatDaysCoverageLine({ coveredDays = 0, targetDays = 6, label = "kill-days" } = {}) {
  const covered = Math.max(0, Math.min(Number(targetDays) || 6, Math.round(normalizeFiniteNumber(coveredDays, 0))));
  const target = Math.max(1, Math.round(normalizeFiniteNumber(targetDays, 6)));
  const missing = Math.max(0, target - covered);
  if (missing > 0) {
    return `Покрыто ${formatNumber(covered)}/${formatNumber(target)} ${label}: не хватает ещё ${formatNumber(missing)} дня роста для полного учёта.`;
  }
  return `Покрыто ${formatNumber(covered)}/${formatNumber(target)} ${label}: штрафа за нехватку дней нет.`;
}

function formatGradePathLines({ currentScore = null, nextGrade = null, sPlusTarget = null } = {}) {
  const score = clampRatingScore(currentScore);
  const next = nextGrade || getNextGradeTarget(score);
  const sPlus = sPlusTarget || getSPlusGradeTarget();
  const lines = [];
  lines.push(`Текущая оценка: ${buildProfileGrade(score)}, ${formatProfileRatingScore(score)}/100.`);
  if (next) {
    lines.push(`До следующей буквы ${next.grade}: нужно +${formatProfileRatingScore(Math.max(0, next.score - score))} очков оценки.`);
  } else {
    lines.push("Следующая буква уже закрыта: это минимальный S+ или выше.");
  }
  lines.push(`До минимального S+: нужно +${formatProfileRatingScore(Math.max(0, sPlus.score - score))} очков оценки.`);
  return lines;
}

function formatEffectShareLine({ label = "Компонент", points = 0, totalScore = 100 } = {}) {
  const componentPoints = normalizeFiniteNumber(points, 0);
  const totalPoints = Math.max(0.1, normalizeFiniteNumber(totalScore, 100));
  const share = Math.round((componentPoints / totalPoints) * 100);
  return `${label} дал ${formatProfileRatingScore(componentPoints)} очка из ${formatProfileRatingScore(totalPoints)}: это ${formatNumber(share)}% текущей оценки.`;
}

function formatAxisWeightLine(axisName = "") {
  const meta = PROFILE_RATING_AXIS_LABELS[axisName] || { label: cleanString(axisName, 40) || "Эта оценка" };
  const weightPercent = Math.round((PROFILE_RATING_AXIS_WEIGHTS[axisName] || 0) * 100);
  const totalImpact = Math.round(weightPercent / 10);
  return `${meta.label} весит ${formatNumber(weightPercent)}% общего рейтинга: +10 очков ${meta.label} примерно дают +${formatNumber(totalImpact)} очка к общему рейтингу.`;
}

function estimateMissingUnitsForScoreGap({ scoreGap = 0, componentWeight = 1, targetValue = 1, currentValue = 0, round = "ceil" } = {}) {
  const gap = normalizeFiniteNumber(scoreGap, 0);
  const weight = Math.max(0.1, normalizeFiniteNumber(componentWeight, 1));
  const target = Math.max(0.1, normalizeFiniteNumber(targetValue, 1));
  const current = Math.max(0, normalizeFiniteNumber(currentValue, 0));
  if (gap <= 0) return 0;
  const missingToFull = Math.max(0, target - current);
  const needed = Math.min(missingToFull, (gap / weight) * target);
  if (round === "tenth") return Math.ceil(needed * 10) / 10;
  return Math.ceil(needed);
}

function formatMinutesPerDay(hours = null) {
  const amount = normalizeNullableFiniteNumber(hours);
  if (!Number.isFinite(amount)) return "—";
  return formatNumber(Math.ceil((amount * 60) / 7));
}

function formatKillWindowLine(window = {}, stateText = "учтено полностью") {
  const from = normalizeNullableFiniteNumber(window?.from);
  const to = normalizeNullableFiniteNumber(window?.to);
  const delta = Number.isFinite(Number(window?.delta)) ? Number(window.delta) : (Number.isFinite(from) && Number.isFinite(to) ? to - from : null);
  const dayCount = normalizeNullableFiniteNumber(window?.dayCount);
  const averagePerDay = Number.isFinite(Number(window?.averagePerDay))
    ? Number(window.averagePerDay)
    : (Number.isFinite(delta) && Number.isFinite(dayCount) && dayCount > 0 ? delta / dayCount : null);
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return `Окно ${Number.isFinite(delta) ? formatSignedNumber(delta) : "kills"} не учтено: нет двух значений kills.`;
  }
  if (!Number.isFinite(dayCount) || dayCount <= 0 || window?.sourceGap === true) {
    return `Окно ${formatSignedNumber(delta)} kills не учтено: нет двух дат, нельзя понять, за сколько дней это набрано.`;
  }
  return `${formatDateRange(window.fromAt, window.toAt)}: ${formatNumber(from)} → ${formatNumber(to)}, ${formatSignedNumber(delta)} kills за ${formatNumber(dayCount)} дней = ${formatNumber(Math.round(averagePerDay * 10) / 10)}/день, ${stateText}.`;
}

function getRawVoiceHours(activitySummary = {}, voiceSummary = {}, period = "7d") {
  const suffix = period === "7d" ? "7d" : "30d";
  const activitySeconds = normalizeNullableFiniteNumber(activitySummary?.[`voiceDurationSeconds${suffix}`]);
  if (Number.isFinite(activitySeconds)) return activitySeconds / 3600;
  const voiceSeconds = normalizeNullableFiniteNumber(voiceSummary?.[`voiceDurationSeconds${suffix}`]);
  if (Number.isFinite(voiceSeconds)) return voiceSeconds / 3600;
  const effectiveHours = normalizeNullableFiniteNumber(activitySummary?.[`effectiveVoiceHours${suffix}`]);
  return Number.isFinite(effectiveHours) ? effectiveHours : null;
}

function getCleanVoiceHours(activitySummary = {}, rawVoiceHours = null, period = "7d") {
  const suffix = period === "7d" ? "7d" : "30d";
  const direct = normalizeNullableFiniteNumber(activitySummary?.[`effectiveVoiceHours${suffix}`]);
  if (Number.isFinite(direct)) return Math.max(0, direct);
  const activeSignal = normalizeNullableFiniteNumber(activitySummary?.[`effectiveActiveVoiceSignalHours${suffix}`]);
  if (Number.isFinite(activeSignal)) return Math.max(0, activeSignal);
  if (period === "7d") {
    const monthly = normalizeNullableFiniteNumber(activitySummary?.effectiveVoiceHours30d);
    if (Number.isFinite(monthly) && Number.isFinite(rawVoiceHours) && monthly >= rawVoiceHours) {
      return Math.max(0, rawVoiceHours);
    }
  }
  return 0;
}

function buildActivityLeagueMetrics(activitySummary = {}, voiceSummary = {}) {
  const rawVoiceHours = normalizeNullableFiniteNumber(getRawVoiceHours(activitySummary, voiceSummary, "7d"), 0);
  const cleanVoiceHours = Math.min(rawVoiceHours, getCleanVoiceHours(activitySummary, rawVoiceHours, "7d"));
  const rawExtraVoiceHours = Math.max(0, rawVoiceHours - cleanVoiceHours);
  const voiceRatingHours = cleanVoiceHours + rawExtraVoiceHours * 0.7;
  return {
    rawVoiceHours,
    cleanVoiceHours,
    rawExtraVoiceHours,
    voiceRatingHours,
    messageSessions: normalizeNullableFiniteNumber(activitySummary?.sessions7d, 0),
    messages: normalizeNullableFiniteNumber(activitySummary?.messages7d, 0),
  };
}

function getPopulationActivityMetrics(populationProfiles = []) {
  return (Array.isArray(populationProfiles) ? populationProfiles : [])
    .map((entry) => {
      const profile = entry?.profile && typeof entry.profile === "object" ? entry.profile : entry;
      const summary = profile?.summary && typeof profile.summary === "object" ? profile.summary : {};
      return {
        ...buildActivityLeagueMetrics(summary.activity || {}, summary.voice || {}),
        ...resolveProfileBenchmarkOwner(entry),
        originalEntry: entry,
      };
    });
}

function getPopulationJjsHours(populationProfiles = []) {
  return (Array.isArray(populationProfiles) ? populationProfiles : [])
    .map((entry) => {
      const profile = entry?.profile && typeof entry.profile === "object" ? entry.profile : entry;
      const summary = profile?.summary && typeof profile.summary === "object" ? profile.summary : {};
      const roblox = summary.roblox && typeof summary.roblox === "object" ? summary.roblox : {};
      const minutes = normalizeNullableFiniteNumber(roblox.jjsMinutes7d);
      if (!Number.isFinite(minutes)) return null;
      return {
        hours: minutes / 60,
        minutes,
        ...resolveProfileBenchmarkOwner(entry),
        originalEntry: entry,
      };
    })
    .filter((entry) => entry && Number.isFinite(entry.hours));
}

function pickTopMetricOwner(entries = [], metricKey = "value", currentEntry = null) {
  const candidates = [
    ...(Array.isArray(entries) ? entries : []),
    currentEntry,
  ]
    .filter(Boolean)
    .filter((entry) => Number.isFinite(Number(entry?.[metricKey])));
  if (!candidates.length) return null;
  return candidates.slice().sort((left, right) => Number(right[metricKey]) - Number(left[metricKey]))[0];
}

function buildRatingCardAxis({
  axisName,
  score = null,
  rawScore = null,
  place = {},
  valuesLine = "",
  totalModifierPercent = 0,
  effectiveWeightPercent = 100,
  primaryHintLine = "",
  detailItems = [],
  locked = false,
  lockReason = "",
  lockedPenaltyPercent = PROFILE_RATING_LOCK_PENALTY_PERCENT,
  hiddenBecauseTooOld = false,
  extra = {},
} = {}) {
  const meta = PROFILE_RATING_AXIS_LABELS[axisName] || { emoji: "▫️", label: axisName };
  if (locked) {
    const cardTitle = `🔒 ${meta.label} закрыт · рейтинг -${formatNumber(lockedPenaltyPercent)}%`;
    const needLine = cleanString(lockReason, 220) || "Нужно больше данных.";
    const hintLine = axisName === "kills"
      ? "💡 обнови kills — недели заполнятся задним числом"
      : axisName === "jjs"
        ? "💡 нужен trackable Roblox/JJS playtime"
        : "💡 добери voice + chat за неделю";
    const cardLines = [cardTitle, needLine, hintLine].filter(Boolean).slice(0, 3);
    return {
      axisName,
      ...meta,
      grade: "",
      score: null,
      rawScore: normalizeNullableFiniteNumber(rawScore),
      place: { rank: null, total: normalizeNullableFiniteNumber(place?.total) },
      effectiveWeightPercent: 0,
      scoreContributionPercent: 0,
      totalModifierPercent: -Math.abs(normalizeFiniteNumber(lockedPenaltyPercent, PROFILE_RATING_LOCK_PENALTY_PERCENT)),
      confidenceState: "unavailable",
      isLocked: true,
      displayState: "locked",
      lockedPenaltyPercent,
      lockReason: needLine,
      hiddenBecauseTooOld,
      cardTitle,
      cardLines,
      lines: cardLines.slice(1),
      primaryHintLine: hintLine,
      detailLine: "",
      detailItems: [],
      lockedLines: cardLines.slice(1),
      ...extra,
    };
  }

  const normalizedScore = clampRatingScore(score);
  const grade = buildProfileGrade(normalizedScore);
  const cardRank = formatProfileAxisRank({ place });
  const cardTitle = `${meta.emoji} ${meta.label} ${grade} · ${formatProfileRatingScore(normalizedScore)}/100${cardRank}`;
  const weight = Math.round(Math.max(0, Math.min(100, normalizeFiniteNumber(effectiveWeightPercent, 100))));
  const modifierLine = `${formatRatingModifier(totalModifierPercent)} · учёт ${formatNumber(weight)}% ${buildStatBar(weight, 5)}`;
  const hintLine = cleanString(primaryHintLine, 180);
  const compactDetails = (Array.isArray(detailItems) ? detailItems : [])
    .map((entry) => cleanString(entry, 120))
    .filter(Boolean)
    .slice(0, 2);
  const detailLine = compactDetails.length ? `↳ ${compactDetails.join(" · ")}` : "";
  const cardLines = [
    cardTitle,
    cleanString(valuesLine, 220),
    modifierLine,
    hintLine ? `💡 ${hintLine.replace(/^💡\s*/u, "")}` : "",
    detailLine,
  ].filter(Boolean).slice(0, 5);

  return {
    axisName,
    ...meta,
    grade,
    score: normalizedScore,
    rawScore: normalizeNullableFiniteNumber(rawScore, normalizedScore),
    place: {
      rank: normalizeNullableFiniteNumber(place?.rank),
      total: normalizeNullableFiniteNumber(place?.total),
    },
    effectiveWeightPercent: weight,
    scoreContributionPercent: Math.round(normalizedScore * (weight / 100) * 100) / 100,
    totalModifierPercent: Math.round(normalizeFiniteNumber(totalModifierPercent, 0)),
    confidenceState: weight >= 90 ? "reliable" : "partial",
    isLocked: false,
    displayState: "open",
    lockedPenaltyPercent: 0,
    lockReason: "",
    cardTitle,
    cardLines,
    lines: cardLines.slice(1),
    primaryHintLine: hintLine ? `💡 ${hintLine.replace(/^💡\s*/u, "")}` : "",
    detailLine,
    detailItems: compactDetails,
    lockedLines: [],
    ...extra,
  };
}

function buildActivityRatingAxis({ activitySummary = {}, voiceSummary = {}, populationProfiles = [], currentProfileLabel = "" } = {}) {
  const current = buildActivityLeagueMetrics(activitySummary, voiceSummary);
  const population = getPopulationActivityMetrics(populationProfiles);
  const currentOwner = {
    ...current,
    label: cleanString(currentProfileLabel, 120) || "этот профиль",
    hasName: true,
  };
  const voiceSamples = [...population.map((entry) => entry.voiceRatingHours), current.voiceRatingHours];
  const sessionSamples = [...population.map((entry) => entry.messageSessions), current.messageSessions];
  const messageSamples = [...population.map((entry) => entry.messages), current.messages];
  const topObservedVoiceHours = Math.max(0, ...voiceSamples.map((entry) => normalizeFiniteNumber(entry, 0)).filter((entry) => Number.isFinite(entry)));
  const topObservedSessions = Math.max(0, ...sessionSamples.map((entry) => normalizeFiniteNumber(entry, 0)).filter((entry) => Number.isFinite(entry)));
  const topObservedMessages = Math.max(0, ...messageSamples.map((entry) => normalizeFiniteNumber(entry, 0)).filter((entry) => Number.isFinite(entry)));
  const topVoiceOwner = pickTopMetricOwner(population, "voiceRatingHours", currentOwner);
  const topSessionsOwner = pickTopMetricOwner(population, "messageSessions", currentOwner);
  const topMessagesOwner = pickTopMetricOwner(population, "messages", currentOwner);
  const voiceTarget = buildPeakTarget(voiceSamples, 0.7, 2);
  const sessionsTarget = buildPeakTarget(sessionSamples, 0.7, 5);
  const messagesTarget = buildPeakTarget(messageSamples, 0.7, 150);
  const hasAnySignal = current.voiceRatingHours >= 0.5 || current.messageSessions >= 2 || current.messages >= 25;
  if (!hasAnySignal) {
    return buildRatingCardAxis({
      axisName: "activity",
      locked: true,
      lockReason: "Нужно: 0,5ч voice или 2 chat-сессии или 25 msg за неделю.",
      lockedPenaltyPercent: PROFILE_RATING_LOCK_PENALTY_PERCENT,
    });
  }

  const voiceScore = Math.min(100, (current.voiceRatingHours / voiceTarget) * 100);
  const sessionScore = Math.min(100, (current.messageSessions / sessionsTarget) * 100);
  const messageScore = Math.min(100, (current.messages / messagesTarget) * 100);
  const voiceContribution = voiceScore * 0.45;
  const sessionContribution = sessionScore * 0.35;
  const messageContribution = messageScore * 0.2;
  const uncappedScore = voiceContribution + sessionContribution + messageContribution;
  const hasVoice = current.voiceRatingHours >= 0.5;
  const hasChat = current.messageSessions >= 2 || current.messages >= 25;
  const cappedScore = (!hasVoice || !hasChat) ? Math.min(84, uncappedScore) : uncappedScore;
  const capPenalty = cappedScore - uncappedScore;
  const pureModeCapApplied = capPenalty < -0.5;
  const samples = population.map((entry) => {
    const sampleVoiceTarget = voiceTarget || 2;
    const sampleSessionsTarget = sessionsTarget || 5;
    const sampleMessagesTarget = messagesTarget || 150;
    const sampleScore = Math.min(100, (entry.voiceRatingHours / sampleVoiceTarget) * 100) * 0.45
      + Math.min(100, (entry.messageSessions / sampleSessionsTarget) * 100) * 0.35
      + Math.min(100, (entry.messages / sampleMessagesTarget) * 100) * 0.2;
    const sampleHasVoice = entry.voiceRatingHours >= 0.5;
    const sampleHasChat = entry.messageSessions >= 2 || entry.messages >= 25;
    return (!sampleHasVoice || !sampleHasChat) ? Math.min(84, sampleScore) : sampleScore;
  });
  const score = clampRatingScore(cappedScore);
  const next = getNextGradeTarget(score);
  const sPlus = getSPlusGradeTarget();
  const scoreGap = next ? Math.max(0, next.score - score) : 0;
  const sPlusGap = Math.max(0, sPlus.score - score);
  const voiceNeed = estimateMissingUnitsForScoreGap({ scoreGap, componentWeight: 45, targetValue: voiceTarget, currentValue: current.voiceRatingHours, round: "tenth" });
  const sessionNeed = estimateMissingUnitsForScoreGap({ scoreGap, componentWeight: 35, targetValue: sessionsTarget, currentValue: current.messageSessions });
  const messageNeed = estimateMissingUnitsForScoreGap({ scoreGap, componentWeight: 20, targetValue: messagesTarget, currentValue: current.messages });
  const voiceNeedForSPlus = estimateMissingUnitsForScoreGap({ scoreGap: sPlusGap, componentWeight: 45, targetValue: voiceTarget, currentValue: current.voiceRatingHours, round: "tenth" });
  const sessionNeedForSPlus = estimateMissingUnitsForScoreGap({ scoreGap: sPlusGap, componentWeight: 35, targetValue: sessionsTarget, currentValue: current.messageSessions });
  const messageNeedForSPlus = estimateMissingUnitsForScoreGap({ scoreGap: sPlusGap, componentWeight: 20, targetValue: messagesTarget, currentValue: current.messages });
  const voiceGapToTarget = Math.max(0, voiceTarget - current.voiceRatingHours);
  const sessionsGapToTarget = Math.max(0, sessionsTarget - current.messageSessions);
  const messagesGapToTarget = Math.max(0, messagesTarget - current.messages);
  const weakestComponent = [
    { label: "voice", lost: Math.max(0, 45 - voiceContribution) },
    { label: "chat-сессии", lost: Math.max(0, 35 - sessionContribution) },
    { label: "сообщения", lost: Math.max(0, 20 - messageContribution) },
  ].sort((left, right) => right.lost - left.lost)[0];
  const detailItems = [];
  detailItems.push(`планка: voice ${formatHours(voiceTarget)}ч · ${formatNumber(Math.round(sessionsTarget))} сесс. · ${formatNumber(Math.round(messagesTarget))} msg`);
  if (current.rawExtraVoiceHours > 0) detailItems.push("сырой voice считается слабее на 30%");
  if (!hasVoice && hasChat) detailItems.push("нужен voice для снятия потолка");
  else if (hasVoice && !hasChat) detailItems.push("нужен chat для снятия потолка");
  else if (capPenalty < -0.5) detailItems.push(hasVoice ? "chat-потолок" : "voice-потолок");
  detailItems.push(pureModeCapApplied ? "потолок 84 сработал" : "потолок не сработал");

  const buildActivityBenchmarkLines = ({ metricLabel, topEntry, metricKey, currentValue, targetValue, fallbackValue, unitLabel, formatValue }) => {
    const topValue = normalizeFiniteNumber(topEntry?.[metricKey], 0);
    const ownerText = formatProfileBenchmarkOwner(topEntry, `${formatValue(topValue)}${unitLabel} за 7д`);
    const baseLine = `${metricLabel}-планку задаёт ${ownerText}. Для оценки берём 70% от этого: ${formatValue(topValue * 0.7)}${unitLabel}.`;
    const fallbackLine = targetValue > topValue * 0.7 + 0.01
      ? `Так как 70% от топа ниже минимума, сработала запасная минимальная планка ${formatValue(fallbackValue)}${unitLabel}.`
      : "";
    const currentLine = `Твой ${metricLabel}: ${formatValue(currentValue)}${unitLabel}; ${formatMissingAmount(currentValue, targetValue, unitLabel)} до полной планки.`;
    return [baseLine, fallbackLine, currentLine].filter(Boolean);
  };

  const formulaLines = [
    "Период оценки: последние 7 дней.",
    "Activity складывается из трёх частей: voice, chat-сессии и сообщения.",
    "Voice весит 45% оценки, chat-сессии 35%, сообщения 20%.",
    "JJS здесь не участвует: игровое время считается отдельно в оценке JJS.",
    "Если есть только voice или только chat, оценка не может подняться выше 84/100.",
    formatAxisWeightLine("activity"),
  ];
  const inputLines = [
    `За 7 дней у тебя: ${formatHours(current.voiceRatingHours)}ч зачтённого voice, ${formatNumber(current.messageSessions)} chat-сессий, ${formatNumber(current.messages)} сообщений.`,
    `Voice исходно: ${formatHours(current.rawVoiceHours)}ч. В зачёт пошло ${formatHours(current.voiceRatingHours)}ч: лишняя или сыроватая часть считается на 30% слабее.`,
    "Chat-сессии показывают не количество сообщений, а сколько раз ты реально включался в общение.",
    "Сообщения дают отдельные очки, но у них самый маленький вес: 20%.",
  ];
  const peakLines = [
    "Планка берётся от лучших результатов сервера за тот же период.",
    ...buildActivityBenchmarkLines({ metricLabel: "Voice", topEntry: topVoiceOwner, metricKey: "voiceRatingHours", currentValue: current.voiceRatingHours, targetValue: voiceTarget, fallbackValue: 2, unitLabel: "ч", formatValue: formatHours }),
    ...buildActivityBenchmarkLines({ metricLabel: "Chat", topEntry: topSessionsOwner, metricKey: "messageSessions", currentValue: current.messageSessions, targetValue: sessionsTarget, fallbackValue: 5, unitLabel: " сессий", formatValue: (value) => formatNumber(Math.round(value)) }),
    ...buildActivityBenchmarkLines({ metricLabel: "Msg", topEntry: topMessagesOwner, metricKey: "messages", currentValue: current.messages, targetValue: messagesTarget, fallbackValue: 150, unitLabel: " сообщений", formatValue: (value) => formatNumber(Math.round(value)) }),
  ];
  const modifierLines = [
    `Voice: ${formatHours(current.voiceRatingHours)}ч из ${formatHours(voiceTarget)}ч планки = ${formatNumber(Math.round(voiceScore))}% компонента, вклад ${formatProfileRatingScore(voiceContribution)} очков из 45.`,
    `Chat-сессии: ${formatNumber(current.messageSessions)} из ${formatNumber(Math.round(sessionsTarget))} планки = ${formatNumber(Math.round(sessionScore))}% компонента, вклад ${formatProfileRatingScore(sessionContribution)} очков из 35.`,
    `Сообщения: ${formatNumber(current.messages)} из ${formatNumber(Math.round(messagesTarget))} планки = ${formatNumber(Math.round(messageScore))}% компонента, вклад ${formatProfileRatingScore(messageContribution)} очков из 20.`,
    `Итог до потолка: ${formatProfileRatingScore(uncappedScore)}/100. ${pureModeCapApplied ? `Потолок сработал и снял ${formatProfileRatingScore(Math.abs(capPenalty))} очков.` : "Потолок не сработал, потому что есть и voice, и chat."}`,
    weakestComponent?.lost > 0.5 ? `Главное слабое место сейчас: ${weakestComponent.label}, там потеряно около ${formatProfileRatingScore(weakestComponent.lost)} очков Activity.` : "Все компоненты Activity близко к своим планкам.",
    formatEffectShareLine({ label: "Voice", points: voiceContribution, totalScore: score }),
  ];
  const sourceLines = [
    "Voice берётся из summary.activity и summary.voice за 7 дней.",
    "Chat берётся из sessions7d и messages7d activity-окон.",
    `Серверная выборка для планки: ${formatNumber(population.length)} профилей плюс текущий профиль.`,
    `Текущие разрывы до полной планки: voice ${formatMissingAmount(current.voiceRatingHours, voiceTarget, "ч")}; chat ${formatMissingAmount(current.messageSessions, sessionsTarget, " сессий")}; msg ${formatMissingAmount(current.messages, messagesTarget, " сообщений")}.`,
  ];
  const upgradeLines = [
    ...formatGradePathLines({ currentScore: score, nextGrade: next, sPlusTarget: sPlus }),
    next ? `Быстрый путь до ${next.grade}: +${formatHours(voiceNeed)}ч voice или +${formatNumber(sessionNeed)} chat-сессий или +${formatNumber(messageNeed)} сообщений за 7 дней.` : "Следующая буква уже закрыта; дальше цель только удерживать S+.",
    `До минимального S+: примерно +${formatHours(voiceNeedForSPlus)}ч voice или +${formatNumber(sessionNeedForSPlus)} chat-сессий или +${formatNumber(messageNeedForSPlus)} сообщений, если добирать одной частью.`,
    voiceNeedForSPlus > 0 ? `Если идти через voice, это около +${formatNumber(Math.ceil((voiceNeedForSPlus * 60) / 7))} минут в день в течение недели.` : "Voice-планка для S+ по этой оси уже закрыта.",
  ];

  return buildRatingCardAxis({
    axisName: "activity",
    score,
    rawScore: uncappedScore,
    place: buildMetricPlace(score, [...samples, score]),
    valuesLine: `Voice ${formatHours(current.voiceRatingHours)}ч · chat-сессии ${formatNumber(current.messageSessions)} · msg ${formatNumber(current.messages)}`,
    totalModifierPercent: capPenalty,
    effectiveWeightPercent: 100,
    primaryHintLine: next ? `до ${next.grade}: +${formatHours(voiceNeed)}ч voice или +${formatNumber(sessionNeed)} chat-сессии` : "S+ уже открыт",
    detailItems,
    extra: {
      cleanVoiceHours: current.cleanVoiceHours,
      rawVoiceHours: current.rawVoiceHours,
      rawExtraVoiceHours: current.rawExtraVoiceHours,
      voiceRatingHours: current.voiceRatingHours,
      messageSessions: current.messageSessions,
      messages: current.messages,
      voiceRawPenaltyPercent: 30,
      targetValues: { voiceHours: voiceTarget, sessions: sessionsTarget, messages: messagesTarget },
      topObservedValues: { voiceHours: topObservedVoiceHours, sessions: topObservedSessions, messages: topObservedMessages },
      topVoiceOwner,
      topSessionsOwner,
      topMessagesOwner,
      voiceGapToTarget,
      sessionsGapToTarget,
      messagesGapToTarget,
      voiceNeedForNextGrade: voiceNeed,
      sessionsNeedForNextGrade: sessionNeed,
      messagesNeedForNextGrade: messageNeed,
      voiceNeedForSPlus,
      sessionsNeedForSPlus: sessionNeedForSPlus,
      messagesNeedForSPlus: messageNeedForSPlus,
      voiceScorePercent: voiceScore,
      sessionScorePercent: sessionScore,
      messageScorePercent: messageScore,
      voiceContributionPoints: voiceContribution,
      sessionContributionPoints: sessionContribution,
      messageContributionPoints: messageContribution,
      pureModeCapApplied,
      formulaLine: "voice 45% + chat-сессии 35% + сообщения 20%; чистый chat/voice ограничен до 84/100",
      peakLine: `планка: voice ${formatHours(voiceTarget)}ч · ${formatNumber(Math.round(sessionsTarget))} сесс. · ${formatNumber(Math.round(messagesTarget))} msg · ${pureModeCapApplied ? "потолок включён" : "потолок не включён"}`,
      formulaLines,
      inputLines,
      peakLines,
      modifierLines,
      sourceLines,
      upgradeLines,
    },
  });
}

function parseRatingTimestamp(value = null) {
  if (Number.isFinite(Number(value))) return Number(value);
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : null;
}

function normalizeRatingProofWindows(profile = null) {
  const proofWindows = Array.isArray(profile?.domains?.progress?.proofWindows)
    ? profile.domains.progress.proofWindows
    : [];
  return proofWindows
    .map((entry, index) => {
      const approvedKills = normalizeNullableFiniteNumber(entry?.approvedKills);
      const reviewedAt = cleanString(entry?.reviewedAt || entry?.proofAt || entry?.createdAt, 80);
      const reviewedTimestamp = parseRatingTimestamp(reviewedAt);
      if (!Number.isFinite(approvedKills)) return null;
      return {
        ...entry,
        approvedKills,
        reviewedAt,
        reviewedTimestamp,
        originalIndex: index,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (Number.isFinite(left.reviewedTimestamp) && Number.isFinite(right.reviewedTimestamp)) {
        return left.reviewedTimestamp - right.reviewedTimestamp;
      }
      return left.originalIndex - right.originalIndex;
    });
}

function buildKillChangeFromProofPair(previous = null, latest = null) {
  const from = normalizeNullableFiniteNumber(previous?.approvedKills);
  const to = normalizeNullableFiniteNumber(latest?.approvedKills);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;

  const fromAt = parseRatingTimestamp(previous?.reviewedAt || previous?.proofAt || previous?.createdAt);
  const toAt = parseRatingTimestamp(latest?.reviewedAt || latest?.proofAt || latest?.createdAt);
  const hasDateRange = Number.isFinite(fromAt) && Number.isFinite(toAt) && toAt >= fromAt;
  const dayCount = hasDateRange
    ? Math.max(1, Math.round((toAt - fromAt) / (24 * 60 * 60 * 1000)))
    : null;

  return {
    from,
    to,
    fromAt,
    toAt,
    dayCount,
    source: "proofWindow",
    sourceLabel: "proof",
    sourceGap: !hasDateRange,
  };
}

function buildRatingKillChanges({ profile = null, recentKillChanges = [], limit = Number.POSITIVE_INFINITY } = {}) {
  const limitNumber = Number(limit);
  const normalizedLimit = Number.isFinite(limitNumber) ? Math.max(6, limitNumber) : Number.POSITIVE_INFINITY;
  const windows = [];
  const seen = new Set();
  const proofWindows = normalizeRatingProofWindows(profile);

  function pushWindow(change = null, sourceLabel = "recent") {
    if (!change || typeof change !== "object") return;
    const from = normalizeNullableFiniteNumber(change?.from);
    const to = normalizeNullableFiniteNumber(change?.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return;
    const toAt = parseRatingTimestamp(change?.toAt);
    const key = `${from}:${to}:${Number.isFinite(toAt) ? toAt : "na"}`;
    if (seen.has(key)) return;
    seen.add(key);
    windows.push({
      ...change,
      from,
      to,
      fromAt: parseRatingTimestamp(change?.fromAt),
      toAt,
      dayCount: normalizeNullableFiniteNumber(change?.dayCount),
      source: cleanString(change?.source, 40) || (sourceLabel === "proof" ? "proofWindow" : "recentChange"),
      sourceLabel: cleanString(change?.sourceLabel, 40) || sourceLabel,
      sourceGap: change?.sourceGap === true,
    });
  }

  for (const change of Array.isArray(recentKillChanges) ? recentKillChanges : []) {
    pushWindow(change, "recent");
  }

  for (let index = proofWindows.length - 1; index >= 1; index -= 1) {
    pushWindow(buildKillChangeFromProofPair(proofWindows[index - 1], proofWindows[index]), "proof");
  }

  return windows
    .sort((left, right) => (Number(right.toAt) || 0) - (Number(left.toAt) || 0))
    .slice(0, normalizedLimit);
}

function buildRecentKillPaceState({ recentKillChanges = [], now = null } = {}) {
  const nowTimestamp = Number.isFinite(Number(now)) ? Number(now) : Date.parse(String(now || ""));
  const normalizedNow = Number.isFinite(nowTimestamp) ? nowTimestamp : Date.now();
  const allWindows = (Array.isArray(recentKillChanges) ? recentKillChanges : [])
    .map((change) => {
      const from = normalizeNullableFiniteNumber(change?.from);
      const to = normalizeNullableFiniteNumber(change?.to);
      const fromAt = parseRatingTimestamp(change?.fromAt);
      const toAt = parseRatingTimestamp(change?.toAt);
      const dayCount = Number.isFinite(fromAt) && Number.isFinite(toAt)
        ? Math.max(1, Math.round((toAt - fromAt) / (24 * 60 * 60 * 1000)))
        : normalizeNullableFiniteNumber(change?.dayCount);
      const delta = Number.isFinite(from) && Number.isFinite(to) ? to - from : normalizeNullableFiniteNumber(change?.delta);
      if (!Number.isFinite(delta)) return null;
      const averagePerDay = Number.isFinite(dayCount) && dayCount > 0 ? delta / dayCount : null;
      return {
        from,
        to,
        delta,
        dayCount,
        averagePerDay,
        fromAt,
        toAt,
        source: cleanString(change?.source, 40) || "recentChange",
        sourceLabel: cleanString(change?.sourceLabel, 40) || "recent",
        sourceGap: change?.sourceGap === true,
      };
    })
    .filter(Boolean)
    .sort((left, right) => (Number(right.toAt) || 0) - (Number(left.toAt) || 0));
  const ignoredNeutralWindows = allWindows.filter((entry) => entry.delta <= 0);
  const ignoredSourceGapWindows = allWindows.filter((entry) => entry.delta > 0 && (!Number.isFinite(entry.dayCount) || entry.dayCount <= 0 || entry.sourceGap));
  const scoredCandidates = allWindows.filter((entry) => entry.delta > 0 && Number.isFinite(entry.dayCount) && entry.dayCount > 0 && !entry.sourceGap);
  const ignoredOutlierWindows = scoredCandidates.filter((entry) => entry.averagePerDay > PROFILE_KILLS_DAY_OUTLIER_LIMIT);
  const windows = scoredCandidates.filter((entry) => entry.averagePerDay <= PROFILE_KILLS_DAY_OUTLIER_LIMIT);

  let remainingDays = 6;
  let coveredDays = 0;
  let weightedKills = 0;
  const usedWindows = [];
  for (const window of windows) {
    if (remainingDays <= 0) break;
    const days = Math.min(remainingDays, window.dayCount);
    weightedKills += window.averagePerDay * days;
    coveredDays += days;
    remainingDays -= days;
    usedWindows.push({ ...window, usedDays: days });
  }
  const usedWindowKeys = new Set(usedWindows.map((entry) => `${entry.from}:${entry.to}:${Number.isFinite(entry.toAt) ? entry.toAt : "na"}`));
  const olderKillWindows = windows.filter((entry) => !usedWindowKeys.has(`${entry.from}:${entry.to}:${Number.isFinite(entry.toAt) ? entry.toAt : "na"}`));
  const ignoredKillWindows = [
    ...ignoredOutlierWindows.map((entry) => ({ ...entry, ignoredReason: `выше лимита ${formatNumber(PROFILE_KILLS_DAY_OUTLIER_LIMIT)}/день` })),
    ...ignoredSourceGapWindows.map((entry) => ({ ...entry, ignoredReason: "нет двух дат" })),
    ...ignoredNeutralWindows.map((entry) => ({ ...entry, ignoredReason: "нет роста" })),
  ];
  const coveredTimestamps = usedWindows
    .flatMap((entry) => [entry.fromAt, entry.toAt])
    .filter((entry) => Number.isFinite(Number(entry)))
    .map(Number);
  const firstCoveredDay = coveredTimestamps.length ? Math.min(...coveredTimestamps) : null;
  const lastCoveredDay = coveredTimestamps.length ? Math.max(...coveredTimestamps) : null;
  const latestToAt = windows.find((entry) => Number.isFinite(entry.toAt))?.toAt ?? null;
  const dataAgeDays = Number.isFinite(latestToAt)
    ? Math.max(0, Math.floor((normalizedNow - latestToAt) / (24 * 60 * 60 * 1000)))
    : null;
  let stalePenaltyPercent = 0;
  if (Number.isFinite(dataAgeDays)) {
    if (dataAgeDays <= 7) stalePenaltyPercent = 0;
    else if (dataAgeDays <= 14) stalePenaltyPercent = ((dataAgeDays - 7) / 7) * 40;
    else if (dataAgeDays <= 21) stalePenaltyPercent = 40 + ((dataAgeDays - 14) / 7) * 30;
    else stalePenaltyPercent = 100;
  }
  const averageKillsPerDay = coveredDays >= 4 ? weightedKills / coveredDays : null;
  return {
    averageKillsPerDay,
    coveredDays,
    dataAgeDays,
    stalePenaltyPercent: Math.round(stalePenaltyPercent),
    hiddenBecauseTooOld: Number.isFinite(dataAgeDays) && dataAgeDays > 21,
    usedWindows,
    ignoredOutlierWindows,
    ignoredNeutralWindows,
    ignoredSourceGapWindows,
    candidateWindows: allWindows,
    validWindows: windows,
    olderKillWindows,
    ignoredKillWindows,
    allKillWindows: allWindows,
    scoredKillWindows: usedWindows,
    coveredKillDays: coveredDays,
    missingKillDays: Math.max(0, 6 - coveredDays),
    firstCoveredDay,
    lastCoveredDay,
    coveredDayRangeLabel: coveredTimestamps.length ? formatDateRange(firstCoveredDay, lastCoveredDay) : "нет закрытых дней с датами",
  };
}

function computeKillsGrowthModifierPercent(averageKillsPerDay = null) {
  const pace = normalizeNullableFiniteNumber(averageKillsPerDay);
  if (!Number.isFinite(pace)) return null;
  if (pace <= 10) return -20;
  if (pace <= 20) return -20 + ((pace - 10) / 10) * 20;
  if (pace <= 30) return ((pace - 20) / 10) * 20;
  if (pace <= 40) return 20 + ((pace - 30) / 10) * 10;
  return 30 + ((pace - 40) * 0.3);
}

function buildKillsRatingAxis({ profile = null, approvedKills = null, standing = {}, recentKillChanges = [], robloxSummary = {}, robloxDisplayState = null, now = null } = {}) {
  const approvedKillsAmount = normalizeNullableFiniteNumber(approvedKills);
  if (!Number.isFinite(approvedKillsAmount)) {
    return buildRatingCardAxis({
      axisName: "kills",
      locked: true,
      lockReason: "Нужен approved proof по kills.",
      lockedPenaltyPercent: PROFILE_RATING_KILLS_LOCK_PENALTY_PERCENT,
    });
  }
  const ratingKillChanges = buildRatingKillChanges({ profile, recentKillChanges, limit: Number.POSITIVE_INFINITY });
  const pace = buildRecentKillPaceState({ recentKillChanges: ratingKillChanges, now });
  const proofWindowCount = normalizeRatingProofWindows(profile).length;
  const proofChangeWindowCount = ratingKillChanges.filter((entry) => entry.sourceLabel === "proof").length;
  const recentChangeCount = ratingKillChanges.filter((entry) => entry.sourceLabel !== "proof").length;
  if (pace.hiddenBecauseTooOld) {
    return buildRatingCardAxis({
      axisName: "kills",
      locked: true,
      lockReason: `Последние 6 kill-days старше 2 недель: ${formatNumber(pace.dataAgeDays)}д назад.`,
      lockedPenaltyPercent: PROFILE_RATING_KILLS_LOCK_PENALTY_PERCENT,
      hiddenBecauseTooOld: true,
      extra: {
        ...pace,
        proofWindowCount,
        recentChangeCount,
        formulaLines: [
          "Kills оценивает approved kills, темп роста и эффективность относительно JJS.",
          "Оценка роста смотрит на последние 6 kill-days.",
          "Если последние окна старше 21 дня, Kills закрывается до нового proof.",
          formatAxisWeightLine("kills"),
        ],
        inputLines: [`Approved kills: ${formatNumber(approvedKillsAmount)}.`, `Последние данные: ${formatNumber(pace.dataAgeDays)} дней назад.`],
        peakLines: ["Верхняя планка появится после свежего approved proof."],
        modifierLines: [`Свежесть proof: окно старше лимита, поэтому Kills получает штраф -${formatNumber(PROFILE_RATING_KILLS_LOCK_PENALTY_PERCENT)}% и закрывается.`],
        sourceLines: buildKillsRatingSourceLines({
          proofWindowCount,
          recentChangeCount,
          usedWindows: pace.usedWindows,
          olderKillWindows: pace.olderKillWindows,
          ignoredOutlierWindows: pace.ignoredOutlierWindows,
          ignoredNeutralWindows: pace.ignoredNeutralWindows,
          ignoredSourceGapWindows: pace.ignoredSourceGapWindows,
          allKillWindows: pace.allKillWindows,
        }),
        upgradeLines: ["Обнови kills proof: новые окна заполнят последние 6 kill-days задним числом.", "До следующей буквы и S+ путь появится после свежего окна."],
      },
    });
  }

  const rank = normalizeNullableFiniteNumber(standing?.rank);
  const total = normalizeNullableFiniteNumber(standing?.totalVerified);
  const rankScore = Number.isFinite(rank) && Number.isFinite(total) && total > 1
    ? (1 - ((rank - 1) / Math.max(1, total - 1))) * 100
    : Math.min(100, Math.log10(Math.max(1, approvedKillsAmount + 1)) * 25);
  const growthModifier = computeKillsGrowthModifierPercent(pace.averageKillsPerDay);
  const jjsHours7d = robloxDisplayState?.isTrackable === true && Number.isFinite(Number(robloxSummary?.jjsMinutes7d))
    ? Number(robloxSummary.jjsMinutes7d) / 60
    : null;
  const killsPerJjsHour = Number.isFinite(pace.averageKillsPerDay) && Number.isFinite(jjsHours7d) && jjsHours7d > 0
    ? (pace.averageKillsPerDay * 7) / jjsHours7d
    : null;
  const efficiencyModifier = Number.isFinite(killsPerJjsHour)
    ? Math.max(-15, Math.min(15, (killsPerJjsHour - 5) * 3))
    : 0;
  const coveragePenalty = Number.isFinite(pace.averageKillsPerDay) && pace.coveredDays < 6 ? 20 : 0;
  const stalePenalty = Math.min(70, Math.max(0, normalizeFiniteNumber(pace.stalePenaltyPercent, 0)));
  const totalModifier = (Number.isFinite(growthModifier) ? growthModifier : 0) + efficiencyModifier - coveragePenalty - stalePenalty;
  let score = rankScore * (1 + ((Number.isFinite(growthModifier) ? growthModifier : 0) / 100)) * (1 + (efficiencyModifier / 100));
  score *= (1 - (coveragePenalty / 100)) * (1 - (stalePenalty / 100));
  if (!Number.isFinite(pace.averageKillsPerDay)) score = Math.min(86, score);
  const finalScore = clampRatingScore(score);
  const next = getNextGradeTarget(finalScore);
  const sPlus = getSPlusGradeTarget();
  const sPlusScoreGap = Math.max(0, sPlus.score - finalScore);
  const nextKills = next && Number.isFinite(rankScore)
    ? Math.max(1, Math.ceil(((next.score - finalScore) / 100) * Math.max(100, approvedKillsAmount || 100)))
    : null;
  const sPlusKills = sPlusScoreGap > 0 && Number.isFinite(rankScore)
    ? Math.max(1, Math.ceil((sPlusScoreGap / 100) * Math.max(100, approvedKillsAmount || 100)))
    : 0;
  const nextPaceTarget = Math.max(20, Math.ceil((pace.averageKillsPerDay || 20) + 4));
  const sPlusPaceTarget = Math.max(nextPaceTarget, Math.ceil((pace.averageKillsPerDay || 20) + Math.max(8, sPlusScoreGap / 2)));
  const daysToNextAtCurrentPace = Number.isFinite(pace.averageKillsPerDay) && pace.averageKillsPerDay > 0 && Number.isFinite(nextKills)
    ? Math.ceil(nextKills / pace.averageKillsPerDay)
    : null;
  const daysToSPlusAtCurrentPace = Number.isFinite(pace.averageKillsPerDay) && pace.averageKillsPerDay > 0 && sPlusKills > 0
    ? Math.ceil(sPlusKills / pace.averageKillsPerDay)
    : null;
  const leaderEntry = standing?.leaderEntry || null;
  const nextRankEntry = standing?.nextRankEntry || null;
  const killsToLeader = normalizeNullableFiniteNumber(standing?.killsToLeader);
  const killsToNextRank = normalizeNullableFiniteNumber(standing?.killsToNextRank ?? standing?.killsToNext);
  const detailItems = [];
  if (pace.ignoredOutlierWindows?.length) {
    const outlier = pace.ignoredOutlierWindows[0];
    detailItems.push(`${formatNumber(Math.round(outlier.averagePerDay))}/день не учтено`);
  }
  const sourceBits = [];
  if (proofChangeWindowCount) sourceBits.push(`proof ${formatNumber(proofChangeWindowCount)}`);
  if (recentChangeCount) sourceBits.push(`recent ${formatNumber(recentChangeCount)}`);
  detailItems.push(`окна: ${formatNumber(pace.coveredDays)}/6д${sourceBits.length ? ` из ${sourceBits.join("+")}` : ""}`);
  if (Number.isFinite(growthModifier)) detailItems.push(`рост ${formatRatingModifier(growthModifier)}`);
  else detailItems.push("нет kills/day: потолок A+");
  if (stalePenalty > 0) detailItems.unshift(`просрочка -${formatNumber(stalePenalty)}%`);
  if (coveragePenalty > 0) detailItems.unshift(`покрытие -20%`);
  const values = [
    `Approved ${formatNumber(approvedKillsAmount)}`,
    Number.isFinite(pace.averageKillsPerDay) ? `${formatNumber(Math.round(pace.averageKillsPerDay * 10) / 10)}/день` : "kills/day нет",
    Number.isFinite(killsPerJjsHour) ? `${formatNumber(Math.round(killsPerJjsHour * 10) / 10)} kills/ч` : null,
  ].filter(Boolean).join(" · ");
  const nextRankOwner = resolveProfileBenchmarkOwner(nextRankEntry, "игрок выше");
  const leaderOwner = resolveProfileBenchmarkOwner(leaderEntry, "лидер рейтинга");
  const nextRankLine = nextRankEntry && Number.isFinite(killsToNextRank)
    ? `Игрок выше: ${nextRankOwner.label} — ${formatNumber(nextRankEntry.approvedKills)} kills. До него не хватает +${formatNumber(killsToNextRank)} kills.`
    : (Number.isFinite(rank) && rank === 1 ? "Ты сейчас лидер по approved kills среди переданных игроков." : "Игрок выше не передан в модель, поэтому показываю только твоё место.");
  const leaderLine = leaderEntry && Number.isFinite(leaderEntry.approvedKills)
    ? (Number.isFinite(killsToLeader) && killsToLeader > 0
      ? `Сейчас лидер: ${leaderOwner.label}, ${formatNumber(leaderEntry.approvedKills)} kills. До лидера нужно +${formatNumber(killsToLeader)} kills.`
      : `Сейчас лидер: ${leaderOwner.label}, ${formatNumber(leaderEntry.approvedKills)} kills. Ты уже на этой планке.`)
    : "Лидер по kills не передан в модель, поэтому показываю только твоё место и общий размер рейтинга.";
  const coverageLine = formatDaysCoverageLine({ coveredDays: pace.coveredDays, targetDays: 6, label: "kill-days" });
  const coveredRangeLine = pace.coveredDays > 0
    ? `Закрытые дни: ${pace.coveredDayRangeLabel}, всего ${formatNumber(pace.coveredDays)}/6.`
    : "Закрытых kill-days с датами пока нет.";
  const missingCoverageLine = pace.missingKillDays > 0
    ? `Не хватает ещё ${formatNumber(pace.missingKillDays)} дней роста. Поэтому рост считается частично${coveragePenalty > 0 ? ", а покрытие даёт штраф -20%." : "."}`
    : "Пробелов нет: штрафа за покрытие нет.";
  const scoreLostToCoverage = score - (score * (1 - (coveragePenalty / 100)));
  const scoreLostToStaleness = score - (score * (1 - (stalePenalty / 100)));
  const sourceLines = buildKillsRatingSourceLines({
    proofWindowCount,
    recentChangeCount,
    usedWindows: pace.usedWindows,
    olderKillWindows: pace.olderKillWindows,
    ignoredOutlierWindows: pace.ignoredOutlierWindows,
    ignoredNeutralWindows: pace.ignoredNeutralWindows,
    ignoredSourceGapWindows: pace.ignoredSourceGapWindows,
    allKillWindows: pace.allKillWindows,
  });
  const formulaLines = [
    "Kills оценивает три вещи: сколько approved kills загружено, как быстро kills растут, и сколько kills получается на час JJS.",
    "База оценки — твоё место среди игроков с загруженными approved kills.",
    "Рост считается по окнам proof/recent: берём изменения kills между двумя проверками и делим на число дней.",
    `Окна выше ${formatNumber(PROFILE_KILLS_DAY_OUTLIER_LIMIT)} kills/день показываются в разборе, но не дают очки.`,
    "Если закрыто меньше 6 kill-days, оценка получает штраф за неполное покрытие.",
    formatAxisWeightLine("kills"),
  ];
  const inputLines = [
    `Approved kills: ${formatNumber(approvedKillsAmount)}. Это число загружено в профиль и участвует в серверном kill-рейтинге.`,
    Number.isFinite(rank) && Number.isFinite(total) ? `Место: #${formatNumber(rank)} из ${formatNumber(total)} игроков с approved kills.` : "Место по kills не передано, поэтому база считается по самому числу kills.",
    nextRankLine,
    Number.isFinite(pace.averageKillsPerDay)
      ? `Рост: ${formatNumber(Math.round(pace.averageKillsPerDay * 10) / 10)} kills/день, потому что последние засчитанные окна закрыли ${formatNumber(pace.coveredDays)} дней.`
      : `Рост пока не считается: закрыто ${formatNumber(pace.coveredDays)}/6 kill-days, для темпа нужно минимум 4 дня.`,
    Number.isFinite(jjsHours7d) && Number.isFinite(killsPerJjsHour)
      ? `JJS для эффективности: ${formatHours(jjsHours7d)}ч за 7 дней. Это даёт ${formatNumber(Math.round(killsPerJjsHour * 10) / 10)} kills на час JJS.`
      : "JJS для эффективности пока не участвует: нет отслеживаемых часов JJS за неделю.",
    coverageLine,
    coveredRangeLine,
    missingCoverageLine,
  ];
  const peakLines = [
    "Верхняя планка по kills — это лидер среди игроков с загруженными approved kills.",
    leaderLine,
    next ? `Для следующей буквы ${next.grade} сейчас нужно примерно +${formatNumber(nextKills)} kills или темп ${formatNumber(nextPaceTarget)} kills/день.` : "Следующая буква уже закрыта: Kills на уровне S+.",
    sPlusKills > 0 ? `Для минимального S+ нужно добрать примерно +${formatNumber(sPlusKills)} kills или держать около ${formatNumber(sPlusPaceTarget)} kills/день до следующей проверки.` : "Минимальный S+ по Kills уже закрыт.",
  ];
  const modifierLines = [
    Number.isFinite(rank) && Number.isFinite(total)
      ? `Место по kills даёт базу оценки: #${formatNumber(rank)}/${formatNumber(total)} превращается примерно в ${formatProfileRatingScore(rankScore)} очков базы.`
      : `Число kills без места в рейтинге превращается примерно в ${formatProfileRatingScore(rankScore)} очков базы.`,
    Number.isFinite(growthModifier)
      ? `Рост ${formatNumber(Math.round(pace.averageKillsPerDay * 10) / 10)}/день даёт ${formatRatingModifier(growthModifier)} по шкале роста.`
      : "Рост даёт 0%: нужно минимум 4 валидных kill-day.",
    Number.isFinite(killsPerJjsHour)
      ? `Эффективность: ${formatNumber(Math.round(killsPerJjsHour * 10) / 10)} kills/ч JJS. По шкале эффективности это ${formatRatingModifier(efficiencyModifier)}.`
      : "Эффективность по JJS сейчас 0%: нет связки kills/ч.",
    `Покрытие: ${formatNumber(pace.coveredDays)}/6 kill-days${coveragePenalty > 0 ? `, штраф -${formatNumber(coveragePenalty)}%. Потеря около ${formatProfileRatingScore(scoreLostToCoverage)} очков Kills.` : ", штраф 0%."}`,
    Number.isFinite(pace.dataAgeDays) ? `Свежесть proof: последнее окно ${formatNumber(pace.dataAgeDays)} дней назад${stalePenalty > 0 ? `, штраф -${formatNumber(stalePenalty)}%. Потеря около ${formatProfileRatingScore(scoreLostToStaleness)} очков Kills.` : ", штраф 0%."}` : "Свежесть proof не посчитана: нет дат.",
    `Итоговый множитель: ${formatRatingModifier(totalModifier)}. Это сильно влияет на профиль, потому что Kills весит 40% общего рейтинга.`,
  ];
  const upgradeLines = [
    ...formatGradePathLines({ currentScore: finalScore, nextGrade: next, sPlusTarget: sPlus }),
    next ? `До следующей буквы ${next.grade} нужно +${formatNumber(nextKills)} kills или поднять темп до ${formatNumber(nextPaceTarget)} kills/день.` : "Следующая буква уже закрыта; задача — удержать темп и свежие proof-окна.",
    Number.isFinite(daysToNextAtCurrentPace) ? `Если держать текущие ${formatNumber(Math.round(pace.averageKillsPerDay * 10) / 10)}/день, это примерно ${formatNumber(daysToNextAtCurrentPace)} дней до +${formatNumber(nextKills)} kills.` : "Срок до следующей буквы появится после валидного темпа роста.",
    sPlusKills > 0 ? `До минимального S+ нужно +${formatNumber(sPlusKills)} kills или темп около ${formatNumber(sPlusPaceTarget)}/день.` : "До минимального S+ по очкам Kills уже хватает.",
    Number.isFinite(daysToSPlusAtCurrentPace) ? `Если идти текущим темпом, это примерно ${formatNumber(daysToSPlusAtCurrentPace)} дней.` : "Срок до S+ появится после валидного темпа роста.",
    "Самый короткий путь сейчас: регулярно обновлять proof и держать 6/6 kill-days без пробелов.",
  ];

  return buildRatingCardAxis({
    axisName: "kills",
    score: finalScore,
    rawScore: rankScore,
    place: { rank, total },
    valuesLine: values,
    totalModifierPercent: totalModifier,
    effectiveWeightPercent: Math.max(0, 100 - stalePenalty - coveragePenalty),
    primaryHintLine: next ? `до ${next.grade}: +${formatNumber(nextKills)} kills или держи ${formatNumber(nextPaceTarget)}/день` : "S+ уже открыт",
    detailItems,
    extra: {
      approvedKills: approvedKillsAmount,
      rankScore,
      averageKillsPerDay: pace.averageKillsPerDay,
      killDayCoverage: pace.coveredDays,
      killDataAgeDays: pace.dataAgeDays,
      stalePenaltyPercent: stalePenalty,
      coveragePenaltyPercent: coveragePenalty,
      growthModifierPercent: Number.isFinite(growthModifier) ? Math.round(growthModifier) : null,
      jjsEfficiencyModifierPercent: Math.round(efficiencyModifier),
      killsPerJjsHour,
      jjsHours7d,
      ignoredOutlierWindows: pace.ignoredOutlierWindows || [],
      ignoredNeutralWindows: pace.ignoredNeutralWindows || [],
      ignoredSourceGapWindows: pace.ignoredSourceGapWindows || [],
      usedKillWindows: pace.usedWindows || [],
      olderKillWindows: pace.olderKillWindows || [],
      ignoredKillWindows: pace.ignoredKillWindows || [],
      allKillWindows: pace.allKillWindows || [],
      scoredKillWindows: pace.scoredKillWindows || [],
      candidateKillWindows: pace.candidateWindows || [],
      validKillWindows: pace.validWindows || [],
      coveredKillDays: pace.coveredKillDays,
      missingKillDays: pace.missingKillDays,
      firstCoveredDay: pace.firstCoveredDay,
      lastCoveredDay: pace.lastCoveredDay,
      coveredDayRangeLabel: pace.coveredDayRangeLabel,
      proofWindowCount,
      proofChangeWindowCount,
      recentChangeCount,
      nextKills,
      sPlusKills,
      nextPaceTarget,
      sPlusPaceTarget,
      daysToNextAtCurrentPace,
      daysToSPlusAtCurrentPace,
      leaderEntry,
      nextRankEntry,
      killsToLeader,
      killsToNextRank,
      scoreLostToCoverage,
      scoreLostToStaleness,
      peakLine: `окна: ${formatNumber(pace.coveredDays)}/6 дней · ${sourceBits.length ? sourceBits.join(" + ") : "история короткая"}`,
      formulaLines,
      inputLines,
      peakLines,
      modifierLines,
      sourceLines,
      upgradeLines,
    },
  });
}

function buildKillsRatingSourceLines({
  proofWindowCount = 0,
  recentChangeCount = 0,
  usedWindows = [],
  olderKillWindows = [],
  ignoredOutlierWindows = [],
  ignoredNeutralWindows = [],
  ignoredSourceGapWindows = [],
  allKillWindows = [],
} = {}) {
  const lines = [`Использованы ${formatNumber(proofWindowCount)} proof-снимка и ${formatNumber(recentChangeCount)} recent-изменений.`];
  const used = Array.isArray(usedWindows) ? usedWindows : [];
  const old = Array.isArray(olderKillWindows) ? olderKillWindows : [];
  const outliers = Array.isArray(ignoredOutlierWindows) ? ignoredOutlierWindows : [];
  const gaps = Array.isArray(ignoredSourceGapWindows) ? ignoredSourceGapWindows : [];
  const neutral = Array.isArray(ignoredNeutralWindows) ? ignoredNeutralWindows : [];
  for (const window of used.slice(0, 4)) {
    lines.push(formatKillWindowLine(window, window.usedDays && window.usedDays < window.dayCount ? `учтено ${formatNumber(window.usedDays)} дней из окна` : "учтено полностью"));
  }
  for (const window of old.slice(0, 2)) {
    lines.push(formatKillWindowLine(window, "старое окно, сохранено в истории, но не вошло в последние 6 kill-days"));
  }
  for (const window of outliers.slice(0, 2)) {
    lines.push(formatKillWindowLine(window, `не учтено: выше лимита ${formatNumber(PROFILE_KILLS_DAY_OUTLIER_LIMIT)}/день`));
  }
  for (const window of gaps.slice(0, 2)) {
    lines.push(formatKillWindowLine(window, "не учтено: нет двух дат"));
  }
  for (const window of neutral.slice(0, 2)) {
    lines.push(formatKillWindowLine(window, "не учтено: нет роста"));
  }
  const shownCount = Math.min(used.length, 4) + Math.min(old.length, 2) + Math.min(outliers.length, 2) + Math.min(gaps.length, 2) + Math.min(neutral.length, 2);
  const totalWindows = Array.isArray(allKillWindows) && allKillWindows.length ? allKillWindows.length : used.length + old.length + outliers.length + gaps.length + neutral.length;
  if (totalWindows > shownCount) {
    lines.push(`Ещё ${formatNumber(totalWindows - shownCount)} старых окон сохранены в истории, но не показаны здесь, чтобы блок не стал слишком длинным.`);
  }
  if (!used.length && !old.length && !outliers.length && !gaps.length && !neutral.length) {
    lines.push("истории окон пока нет");
  }
  return lines.slice(0, 10);
}

function getLatestWeeklyCoveragePercent(profile = null) {
  const rollups = Array.isArray(profile?.domains?.seasonArchive?.weeklyRollups)
    ? profile.domains.seasonArchive.weeklyRollups
    : [];
  const latest = rollups.slice().sort((left, right) => {
    const rightTime = Date.parse(String(right?.endDayKey || right?.weekKey || ""));
    const leftTime = Date.parse(String(left?.endDayKey || left?.weekKey || ""));
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
  })[0];
  return normalizeNullableFiniteNumber(latest?.coverage?.coveragePercent, null);
}

function buildJjsRatingAxis({ profile = null, robloxSummary = {}, robloxDisplayState = null, populationProfiles = [], currentProfileLabel = "" } = {}) {
  const canTrack = robloxDisplayState?.isTrackable === true || robloxSummary?.isTrackable === true;
  const jjsHours7d = canTrack && Number.isFinite(Number(robloxSummary?.jjsMinutes7d))
    ? Number(robloxSummary.jjsMinutes7d) / 60
    : null;
  if (!canTrack || !Number.isFinite(jjsHours7d)) {
    return buildRatingCardAxis({
      axisName: "jjs",
      locked: true,
      lockReason: canTrack ? "Нет JJS playtime за неделю." : "Roblox привязан не полностью или JJS не trackable.",
      lockedPenaltyPercent: PROFILE_RATING_LOCK_PENALTY_PERCENT,
    });
  }
  const jjsPopulationEntries = getPopulationJjsHours(populationProfiles);
  const jjsPopulationHours = jjsPopulationEntries.map((entry) => entry.hours);
  const jjsSamples = [...jjsPopulationHours, jjsHours7d];
  const topObservedHours = Math.max(0, ...jjsSamples.map((entry) => normalizeFiniteNumber(entry, 0)).filter((entry) => Number.isFinite(entry)));
  const currentOwner = {
    hours: jjsHours7d,
    label: cleanString(currentProfileLabel, 120) || "этот профиль",
    hasName: true,
  };
  const topObservedOwner = pickTopMetricOwner(jjsPopulationEntries, "hours", currentOwner);
  const target = buildPeakTarget(jjsSamples, 0.7, 6);
  const coveragePercent = normalizeNullableFiniteNumber(getLatestWeeklyCoveragePercent(profile), 100);
  const coverageWeight = Math.max(0.1, Math.min(1, coveragePercent / 100));
  const jjsFloor = 1;
  const rawScore = normalizeRatingTarget(jjsHours7d, { floor: jjsFloor, target });
  const score = clampRatingScore(rawScore * coverageWeight);
  const next = getNextGradeTarget(score);
  const sPlus = getSPlusGradeTarget();
  const nextHours = next
    ? Math.max(0.1, ((next.score / coverageWeight) / 100) * Math.max(0.1, target - jjsFloor) + jjsFloor - jjsHours7d)
    : 0;
  const hoursToSPlus = Math.max(0, ((sPlus.score / coverageWeight) / 100) * Math.max(0.1, target - jjsFloor) + jjsFloor - jjsHours7d);
  const hoursToTarget = Math.max(0, target - jjsHours7d);
  const coverageLostPercent = Math.max(0, 100 - coveragePercent);
  const scoreLostToCoverage = Math.max(0, rawScore - score);
  const lastSignal = cleanString(robloxSummary?.lastRefreshAt || robloxSummary?.lastSeenInJjsAt || robloxSummary?.lastPresenceAt, 80);
  const topOwnerLine = formatProfileBenchmarkOwner(topObservedOwner, `${formatHours(topObservedOwner?.hours || topObservedHours)}ч за 7 дней`);
  const targetFromTop = (topObservedHours || 0) * 0.7;
  const detailItems = [];
  detailItems.push(`планка: ${formatHours(target)}ч JJS`);
  if (coveragePercent < 100) detailItems.push(`покрытие недели -${formatNumber(Math.round(100 - coveragePercent))}%`);
  else detailItems.push("покрытие недели полное");
  const formulaLines = [
    "JJS оценивает игровое время за последние 7 дней.",
    "Сначала часы JJS сравниваются с верхней планкой сервера.",
    "Потом результат умножается на покрытие недели: если трекер видел не всю неделю, оценка уменьшается.",
    "Минимальная нижняя точка — 1ч: меньше этого почти не даёт очков.",
    formatAxisWeightLine("jjs"),
  ];
  const inputLines = [
    `За 7 дней у тебя ${formatHours(jjsHours7d)}ч JJS, то есть ${formatNumber(Math.round(jjsHours7d * 60))} минут.`,
    `Покрытие недели: ${formatPercent(coveragePercent, 0)}. Это показывает, какую часть недели трекер смог подтвердить данными.`,
    robloxDisplayState?.readinessLabel || (canTrack ? "Roblox-связка готова, JJS можно отслеживать." : "Roblox-связка не готова."),
    lastSignal ? `Последний JJS-сигнал: ${formatDateTime(lastSignal)}, данные считаются свежими относительно этой отметки.` : "Последний JJS-сигнал не передан в модель.",
  ];
  const peakLines = [
    "Планку задаёт лучший JJS-результат в серверной выборке за 7 дней.",
    `Сейчас топ: ${topOwnerLine}.`,
    `Для S+ берётся 70% от топа: ${formatHours(topObservedHours)}ч × 70% = ${formatHours(targetFromTop)}ч.`,
    target > targetFromTop + 0.01 ? `Запасная минимальная планка — ${formatHours(target)}ч. Она нужна, если в выборке мало данных.` : `Итоговая S+ планка: ${formatHours(target)}ч.`,
    `Твоя неделя: ${formatHours(jjsHours7d)}ч. До S+ планки ${formatMissingAmount(jjsHours7d, target, "ч")} за 7 дней.`,
  ];
  const modifierLines = [
    `Исходные очки по часам: ${formatHours(jjsHours7d)}ч из ${formatHours(target)}ч планки = ${formatProfileRatingScore(rawScore)}/100.`,
    `Покрытие недели: ${formatPercent(coveragePercent, 0)}, поэтому ${formatProfileRatingScore(rawScore)} очков умножаются на ${coverageWeight.toFixed(2)}.`,
    `Итог JJS: ${formatProfileRatingScore(score)}/100.`,
    `Потеря из-за покрытия: примерно ${formatProfileRatingScore(scoreLostToCoverage)} очков JJS (${formatNumber(Math.round(coverageLostPercent))}% недели не подтверждено).`,
    "JJS весит 30% общего рейтинга, поэтому эта потеря заметна, но не ломает весь профиль одна.",
  ];
  const sourceLines = [
    robloxSummary?.playtimeSource ? `Источник игрового времени: ${cleanString(robloxSummary.playtimeSource, 160)}.` : "Источник игрового времени: domains.roblox.playtime / summary.roblox.",
    "Покрытие берётся из последнего weekly rollup seasonArchive.",
    `Серверная выборка для JJS-планки: ${formatNumber(jjsPopulationEntries.length)} профилей плюс текущий профиль.`,
    lastSignal ? `Последний сигнал: ${formatDateTime(lastSignal)}.` : "Время последнего сигнала не передано.",
  ];
  const upgradeLines = [
    ...formatGradePathLines({ currentScore: score, nextGrade: next, sPlusTarget: sPlus }),
    next ? `До следующей буквы ${next.grade} нужно примерно +${formatHours(nextHours)}ч JJS за 7 дней.` : "Следующая буква уже закрыта; цель — удерживать S+.",
    next ? `Это примерно +${formatMinutesPerDay(nextHours)} минут JJS в день в течение недели.` : "Минуты в день до следующей буквы сейчас не нужны.",
    `До минимального S+ нужно примерно +${formatHours(hoursToSPlus)}ч JJS за 7 дней.`,
    `Это примерно +${formatMinutesPerDay(hoursToSPlus)} минут JJS в день в течение недели.`,
    hoursToTarget > 0 ? "Самый прямой путь: закрывать игровые дни равномерно, чтобы часы росли и покрытие не проседало." : "S+ планка по часам закрыта; теперь важно не потерять покрытие недели.",
  ];
  return buildRatingCardAxis({
    axisName: "jjs",
    score,
    rawScore,
    place: buildMetricPlace(jjsHours7d, jjsSamples),
    valuesLine: `${formatHours(jjsHours7d)}ч/7д · S+ от ${formatHours(target)}ч · покрытие ${formatPercent(coveragePercent, 0)}`,
    totalModifierPercent: coveragePercent - 100,
    effectiveWeightPercent: coveragePercent,
    primaryHintLine: next ? `до ${next.grade}: +${formatHours(nextHours)}ч JJS` : "S+ уже открыт",
    detailItems,
    extra: {
      targetHoursForSPlus: target,
      floorHours: jjsFloor,
      coveragePercent,
      coverageWeight,
      topObservedHours,
      topObservedOwner,
      targetMultiplierPercent: 70,
      fallbackTargetHours: 6,
      rawScore,
      finalScore: score,
      nextHours,
      hoursToSPlus,
      hoursToTarget,
      coverageLostPercent,
      scoreLostToCoverage,
      peakLine: `планка: ${formatHours(target)}ч JJS · покрытие ${formatPercent(coveragePercent, 0)}`,
      formulaLines,
      inputLines,
      peakLines,
      modifierLines,
      sourceLines,
      upgradeLines,
    },
  });
}

function buildProfileRatingLeagues({
  profile = null,
  activitySummary = {},
  voiceSummary = {},
  robloxSummary = {},
  robloxDisplayState = null,
  approvedKills = null,
  standing = {},
  populationProfiles = [],
  recentKillChanges = [],
  currentProfileLabel = "",
  now = null,
} = {}) {
  return [
    buildActivityRatingAxis({ activitySummary, voiceSummary, populationProfiles, currentProfileLabel }),
    buildKillsRatingAxis({ profile, approvedKills, standing, recentKillChanges, robloxSummary, robloxDisplayState, now }),
    buildJjsRatingAxis({ profile, robloxSummary, robloxDisplayState, populationProfiles, currentProfileLabel }),
  ];
}

function buildProfileRatingSummary({ axes = [] } = {}) {
  const allAxes = Array.isArray(axes) ? axes : [];
  const availableAxes = allAxes.filter((axis) => axis?.isLocked !== true && Number.isFinite(Number(axis?.score)));
  const lockedAxes = allAxes.filter((axis) => axis?.isLocked === true);
  const openWeightSum = availableAxes.reduce((sum, axis) => sum + (PROFILE_RATING_AXIS_WEIGHTS[axis.axisName] || 0), 0);
  const rawScore = openWeightSum > 0
    ? availableAxes.reduce((sum, axis) => sum + (Number(axis.score) * (PROFILE_RATING_AXIS_WEIGHTS[axis.axisName] || 0)), 0) / openWeightSum
    : null;
  const lockedAxisPenaltyPercent = Math.min(
    PROFILE_RATING_LOCK_PENALTY_CAP_PERCENT,
    lockedAxes.reduce((sum, axis) => sum + Math.max(0, normalizeFiniteNumber(axis.lockedPenaltyPercent, PROFILE_RATING_LOCK_PENALTY_PERCENT)), 0)
  );
  const score = rawScore !== null && rawScore !== undefined && Number.isFinite(Number(rawScore))
    ? Math.max(0, Number(rawScore) * (1 - (lockedAxisPenaltyPercent / 100)))
    : null;
  const grade = Number.isFinite(Number(score)) ? buildProfileGrade(score) : "N/A";
  const strongestAxis = availableAxes.slice().sort((left, right) => right.score - left.score)[0] || null;
  const hiddenAxisCount = lockedAxes.length;
  const liveWeightPercent = Math.round(Math.max(0, Math.min(100, openWeightSum * 100)));
  const place = resolveProfileRatingPlace(availableAxes);
  const lines = [
    Number.isFinite(score)
      ? `🔥 Рейтинг ${grade} · ${formatProfileRatingScore(score)}/100${formatProfileRatingRank(place)}`
      : "🔥 Рейтинг профиля откроется после активности, kills и JJS.",
    strongestAxis ? `★ Пик: ${strongestAxis.label} ${strongestAxis.grade} · ${formatRatingModifier(strongestAxis.totalModifierPercent)}` : "",
    lockedAxisPenaltyPercent > 0 ? `Закрыто: ${lockedAxes.map((axis) => `${axis.label} -${formatNumber(axis.lockedPenaltyPercent)}%`).join(" · ")}` : "",
  ].filter(Boolean);

  return {
    grade,
    score,
    rawScore,
    rank: place.rank,
    total: place.total,
    liveWeightPercent,
    axisCount: availableAxes.length,
    lockedAxisCount: lockedAxes.length,
    lockedAxisPenaltyPercent,
    hiddenAxisCount,
    strongestAxis,
    radarLine: "",
    lines,
  };
}

function buildRatingDetailBlocks(axis = {}) {
  const meta = PROFILE_RATING_AXIS_LABELS[axis?.axisName] || { emoji: "▫️", label: cleanString(axis?.axisName, 40) || "Оценка" };
  const keepDetailLines = (lines = [], limit = 10) => (Array.isArray(lines) ? lines : [])
    .map((entry) => cleanString(entry, 500))
    .filter(Boolean)
    .slice(0, limit);
  if (!axis || typeof axis !== "object") {
    return {
      axisName: "",
      title: "Разбор оценки",
      blocks: [{ title: "Нет данных", lines: ["Эта оценка сейчас не найдена в профиле."] }],
    };
  }

  if (axis.isLocked) {
    const formulaLines = Array.isArray(axis.formulaLines) && axis.formulaLines.length
      ? axis.formulaLines
      : [`${meta.label} считается после открытия данных.`];
    const inputLines = Array.isArray(axis.inputLines) && axis.inputLines.length
      ? axis.inputLines
      : [cleanString(axis.lockReason, 220) || "Нужно больше данных."];
    const peakLines = Array.isArray(axis.peakLines) && axis.peakLines.length
      ? axis.peakLines
      : ["Планка появится после открытия рейтинга."];
    const modifierLines = Array.isArray(axis.modifierLines) && axis.modifierLines.length
      ? axis.modifierLines
      : [`Закрыто · рейтинг -${formatNumber(axis.lockedPenaltyPercent)}%`];
    const sourceLines = Array.isArray(axis.sourceLines) && axis.sourceLines.length
      ? axis.sourceLines
      : ["источники появятся после первой валидной записи"];
    const upgradeLines = Array.isArray(axis.upgradeLines) && axis.upgradeLines.length
      ? axis.upgradeLines
      : [cleanString(axis.primaryHintLine, 220) || "добери данные и обнови профиль"];
    return {
      axisName: axis.axisName,
      title: `${meta.emoji} ${meta.label} · разбор оценки`,
      blocks: [
        { title: "Итог", lines: [`Закрыто · рейтинг -${formatNumber(axis.lockedPenaltyPercent)}%`, cleanString(axis.lockReason, 220) || "Нужно больше данных."] },
        { title: "🧮 Как считается", lines: keepDetailLines(formulaLines) },
        { title: "📌 Входные данные", lines: keepDetailLines(inputLines) },
        { title: "🏔️ Пик / планка", lines: keepDetailLines(peakLines) },
        { title: "📉 Что влияет на оценку", lines: keepDetailLines(modifierLines) },
        { title: "🧾 Источники", lines: keepDetailLines(sourceLines, 12) },
        { title: "💡 До апа", lines: keepDetailLines(upgradeLines) },
      ],
    };
  }

  const rankLine = formatProfileAxisRank(axis).trim();
  const headline = `${axis.grade} · ${formatProfileRatingScore(axis.score)}/100${rankLine ? ` · ${rankLine}` : ""}`;
  const formulaLines = Array.isArray(axis.formulaLines) && axis.formulaLines.length ? axis.formulaLines : [axis.formulaLine || "Формула пока не собрана."];
  const inputLines = Array.isArray(axis.inputLines) && axis.inputLines.length ? axis.inputLines : [axis.cardLines?.[1] || "Входные данные не собраны."].filter(Boolean);
  const peakLines = Array.isArray(axis.peakLines) && axis.peakLines.length ? axis.peakLines : [axis.peakLine || axis.detailLine || "Планка пока не собрана."].filter(Boolean);
  const modifierLines = Array.isArray(axis.modifierLines) && axis.modifierLines.length ? axis.modifierLines : [axis.detailLine ? axis.detailLine.replace(/^↳\s*/u, "") : `${formatRatingModifier(axis.totalModifierPercent)} · учёт ${formatNumber(axis.effectiveWeightPercent)}%`].filter(Boolean);
  const sourceLines = Array.isArray(axis.sourceLines) && axis.sourceLines.length ? axis.sourceLines : ["источники пока не собраны"];
  const upgradeLines = Array.isArray(axis.upgradeLines) && axis.upgradeLines.length ? axis.upgradeLines : [cleanString(axis.primaryHintLine, 220) || "S+ уже открыт"];

  return {
    axisName: axis.axisName,
    title: `${meta.emoji} ${meta.label} · разбор оценки`,
    blocks: [
      { title: "Итог", lines: [headline] },
      { title: "🧮 Как считается", lines: keepDetailLines(formulaLines) },
      { title: "📌 Входные данные", lines: keepDetailLines(inputLines) },
      { title: "🏔️ Пик / планка", lines: keepDetailLines(peakLines) },
      { title: "📉 Что влияет на оценку", lines: keepDetailLines(modifierLines) },
      { title: "🧾 Источники", lines: keepDetailLines(sourceLines, 12) },
      { title: "💡 До апа", lines: keepDetailLines(upgradeLines) },
    ],
  };
}

function buildRatingDetailCards(axes = []) {
  return Object.fromEntries((Array.isArray(axes) ? axes : [])
    .filter((axis) => axis?.axisName)
    .map((axis) => [axis.axisName, buildRatingDetailBlocks(axis)]));
}

function hasProfileScoreSignals({
  profile = null,
  approvedKills = null,
  activitySummary = {},
  robloxSummary = {},
  voiceSummary = {},
  progressSummary = {},
} = {}) {
  if (!profile) return false;
  if (Number.isFinite(Number(approvedKills))) return true;
  if (Number.isFinite(Number(activitySummary.activityScore))
    || Number.isFinite(Number(activitySummary.messages7d))
    || Number.isFinite(Number(activitySummary.messages30d))
    || Number.isFinite(Number(activitySummary.sessions30d))
    || Number.isFinite(Number(activitySummary.activeDays30d))
    || Number.isFinite(Number(activitySummary.voiceDurationSeconds30d))) {
    return true;
  }
  if (Number.isFinite(Number(robloxSummary.jjsMinutes7d))
    || Number.isFinite(Number(robloxSummary.jjsMinutes30d))
    || Number.isFinite(Number(robloxSummary.totalJjsMinutes))
    || Number.isFinite(Number(robloxSummary.sessionCount))) {
    return true;
  }
  if (Number.isFinite(Number(voiceSummary.voiceDurationSeconds30d))
    || Number.isFinite(Number(voiceSummary.sessionCount30d))) {
    return true;
  }
  if (Array.isArray(profile?.domains?.progress?.proofWindows) && profile.domains.progress.proofWindows.length) return true;
  if (Array.isArray(profile?.domains?.seasonArchive?.weeklyRollups) && profile.domains.seasonArchive.weeklyRollups.length) return true;
  if (Array.isArray(profile?.domains?.seasonArchive?.snapshots) && profile.domains.seasonArchive.snapshots.length) return true;
  if (Number.isFinite(Number(progressSummary?.averageKillsPerDay)) || Number.isFinite(Number(progressSummary?.growthScore))) return true;
  return false;
}

function buildProfileTrustBadges({ tierlist = null, weeklyWindowCount = 0, robloxUsability = {}, progress = null } = {}) {
  const axes = PROFILE_RATING_AXES.map((axisName) => tierlist?.[axisName]).filter(Boolean);
  const reliableAxes = axes.filter((axis) => normalizeTrustState(axis?.confidenceState || axis?.freshnessState) === "reliable").length;
  const unavailableAxes = axes.filter((axis) => normalizeTrustState(axis?.confidenceState || axis?.freshnessState) === "unavailable").length;
  const proofState = progress?.proofGap?.freshnessState || progress?.proofGap?.confidenceState || "unavailable";
  const normalizedWeeklyWindowCount = Math.max(0, normalizeFiniteNumber(weeklyWindowCount, 0));
  return [
    {
      key: "profileScore",
      label: "Оценка",
      state: unavailableAxes > 0 ? "partial" : (reliableAxes >= Math.ceil(axes.length / 2) ? "reliable" : "partial"),
      text: axes.length ? `${formatNumber(reliableAxes)}/${formatNumber(axes.length)} текущий расчёт` : "нет базы",
    },
    {
      key: "roblox",
      label: "Roblox",
      state: robloxUsability.usable ? "reliable" : (robloxUsability.state ? "outdated" : "unavailable"),
      text: robloxUsability.usable ? "привязан" : (robloxUsability.state === "repairable" || robloxUsability.state === "manual_only" ? "нужно обновить" : "нет связки"),
    },
    {
      key: "weekly",
      label: "Weekly",
      state: normalizedWeeklyWindowCount >= 3 ? "reliable" : (normalizedWeeklyWindowCount > 0 ? "partial" : "unavailable"),
      text: normalizedWeeklyWindowCount > 0 ? `${formatNumber(normalizedWeeklyWindowCount)} окон` : "нет базы",
    },
    {
      key: "proof",
      label: "Proof",
      state: normalizeTrustState(proofState, "unavailable"),
      text: formatTrustLabel(proofState, "unavailable"),
    },
  ].map((badge) => ({
    ...badge,
    trustLabel: formatTrustLabel(badge.state),
  }));
}

function formatTrustBadgesLine(badges = []) {
  const parts = (Array.isArray(badges) ? badges : [])
    .map((badge) => `${badge.label}: ${badge.text}`)
    .filter(Boolean);
  return parts.length ? `🧪 Данные: ${parts.join(" • ")}` : "🧪 Данные: нет базы";
}

function buildHeroSummary({
  heroTitle = "Игровое досье",
  userId = "",
  displayName = "",
  mainCharacterLabels = [],
  mainStandings = [],
  profileRatingSummary = null,
  robloxSummary = {},
  robloxDisplayState = null,
  approvedKills = null,
  standing = {},
  activitySummary = {},
  proofGap = null,
  robloxSyncHealth = null,
} = {}) {
  const fallbackMainLabel = (Array.isArray(mainCharacterLabels) ? mainCharacterLabels : [])
    .map((entry) => cleanString(entry, 80))
    .filter(Boolean)
    .slice(0, 2)
    .join(", ") || "мейны не выбраны";
  const killPlace = Number.isFinite(Number(standing?.rank)) && Number(standing.rank) > 0
    && Number.isFinite(Number(standing?.totalVerified)) && Number(standing.totalVerified) > 0
    ? `kills #${formatNumber(standing.rank)}/${formatNumber(standing.totalVerified)}`
    : "";
  const mainStandingText = (Array.isArray(mainStandings) ? mainStandings : [])
    .filter((entry) => entry?.available)
    .slice(0, 2)
    .map(formatMainStandingShort)
    .join(", ") || fallbackMainLabel;
  const scoreGrade = cleanString(profileRatingSummary?.grade, 10) || "N/A";
  const scoreValue = formatProfileRatingScore(profileRatingSummary?.score);
  const ratingRank = formatProfileRatingRank(profileRatingSummary);
  const jjsMinutes30d = robloxDisplayState?.isTrackable === true && Number.isFinite(Number(robloxSummary?.jjsMinutes30d))
    ? Number(robloxSummary.jjsMinutes30d)
    : null;
  const chatMessages30d = normalizeNullableFiniteNumber(activitySummary?.messages30d);
  const voiceHours30d = getActivityVoiceHours(activitySummary, "30d");
  const activeVoiceQuality = buildActivityQualityPercent(activitySummary);
  const robloxStatus = robloxDisplayState?.isLinked
    ? (robloxDisplayState.isTrackable ? "Roblox готов" : "Roblox привязан, JJS не обновляется")
    : (robloxDisplayState?.state === "suspicious" ? "Roblox требует перепривязки" : "Roblox не привязан");
  const warningLine = (() => {
    if (robloxSyncHealth?.critical && robloxSyncHealth?.line) {
      return `⚠️ ${cleanString(robloxSyncHealth.line, 180)}`;
    }
    if (robloxDisplayState?.isLinked && !robloxDisplayState?.isTrackable) {
      return "⚠️ Roblox привязан, но JJS-активность не обновляется.";
    }
    return "";
  })();
  const activityLine = [
    Number.isFinite(jjsMinutes30d) ? `JJS ${formatJjsHoursFromMinutes(jjsMinutes30d)}` : null,
    Number.isFinite(chatMessages30d) ? `chat ${formatNumber(chatMessages30d)}` : null,
    Number.isFinite(voiceHours30d) ? `voice ${formatHours(voiceHours30d)}ч` : null,
    Number.isFinite(activeVoiceQuality) ? `активное ${formatPercent(activeVoiceQuality, 0)}` : null,
    robloxStatus,
  ].filter(Boolean).join(" · ");

  const lines = [
    hasProfileRatingScore(profileRatingSummary?.score)
      ? `🔥 Рейтинг ${scoreGrade} · ${scoreValue}/100${ratingRank}`
      : "🔥 Рейтинг профиля откроется после данных",
    `🎭 ${mainStandingText}${killPlace ? ` · ${killPlace}` : (Number.isFinite(approvedKills) ? ` · kills ${formatNumber(approvedKills)}` : "")}`,
    warningLine || activityLine,
  ].filter(Boolean).slice(0, 3);

  return {
    title: heroTitle,
    lines,
    state: warningLine ? "degraded" : "rich",
  };
}

function buildMetricPlace(value = null, samples = []) {
  const current = normalizeFiniteNumber(value);
  const normalizedSamples = (Array.isArray(samples) ? samples : [])
    .map((entry) => normalizeFiniteNumber(entry))
    .filter((entry) => Number.isFinite(entry));
  if (!Number.isFinite(current) || normalizedSamples.length < 1) {
    return { rank: null, total: normalizedSamples.length };
  }
  const sorted = (normalizedSamples.some((entry) => entry === current)
    ? normalizedSamples.slice()
    : [...normalizedSamples, current])
    .sort((left, right) => right - left);
  return {
    rank: sorted.findIndex((entry) => entry === current) + 1,
    total: sorted.length,
  };
}

function formatPlace(place = {}) {
  return Number.isFinite(Number(place?.rank)) && Number.isFinite(Number(place?.total)) && Number(place.total) > 0
    ? `#${formatNumber(place.rank)}/${formatNumber(place.total)}`
    : "N/A";
}

function buildProfileProofGapBlock(proofGap = null) {
  const state = proofGap && typeof proofGap === "object" ? proofGap : null;
  if (!state) return null;

  const debuff = Math.max(0, Math.min(90, normalizeFiniteNumber(state.influenceDebuffPercent, 0)));
  const weight = Math.max(0, 100 - debuff);
  const currentApprovedKills = normalizeNullableFiniteNumber(state.currentApprovedKills);
  const latestApprovedKills = normalizeNullableFiniteNumber(state.latestApprovedKills);

  if (!state.hasProof) {
    if (!Number.isFinite(currentApprovedKills)) return null;
    return {
      title: "🧾 Proof",
      lines: [
        `Proof ждёт первый approved-срез · текущие kills ${formatNumber(currentApprovedKills)}`,
        `Учёт kills: ${formatNumber(weight)}% ${buildStatBar(weight, 5)}`,
      ],
    };
  }

  const ageText = Number.isFinite(Number(state.hoursSinceLastApprovedKillsUpdate))
    ? `${formatHours(Number(state.hoursSinceLastApprovedKillsUpdate) / 24)} д назад`
    : "возраст proof неизвестен";
  const verdict = debuff <= 0
    ? "Proof нормальный"
    : (debuff >= 55 ? "Proof отстал" : "Proof частично отстал");
  const proofLine = [
    state.reviewedAt ? formatDateTime(state.reviewedAt) : null,
    ageText,
    Number.isFinite(latestApprovedKills) ? `approved ${formatNumber(latestApprovedKills)}` : null,
    Number.isFinite(currentApprovedKills) && Number.isFinite(latestApprovedKills) && currentApprovedKills !== latestApprovedKills
      ? `сейчас ${formatNumber(currentApprovedKills)} (${formatSignedNumber(currentApprovedKills - latestApprovedKills)})`
      : null,
  ].filter(Boolean).join(" · ");
  const jjsLine = state.hasReliableJjsSinceLastApproved && Number.isFinite(Number(state.jjsHoursSinceLastApprovedKillsUpdate))
    ? `После proof: ${formatHours(state.jjsHoursSinceLastApprovedKillsUpdate)} ч JJS`
    : "После proof: JJS-разрыв нельзя точно измерить";

  return {
    title: "🧾 Proof",
    lines: [
      `${verdict} · учёт kills ${formatNumber(weight)}% ${buildStatBar(weight, 5)}`,
      proofLine ? `Срез: ${proofLine}` : "",
      jjsLine,
    ].filter(Boolean),
  };
}

function getNextKillTierTargetLine(approvedKills = null) {
  const kills = normalizeNullableFiniteNumber(approvedKills);
  if (!Number.isFinite(kills)) return "До tier: нужен approved proof";
  for (const tier of Object.keys(BASE_KILL_TIER_THRESHOLDS).map(Number).sort((a, b) => a - b)) {
    const target = normalizeNullableFiniteNumber(BASE_KILL_TIER_THRESHOLDS[tier]);
    if (Number.isFinite(target) && kills < target) {
      return `До tier ${formatNumber(tier)}: +${formatNumber(Math.ceil(target - kills))} kills`;
    }
  }
  return "Kill tier: максимум открыт";
}

function getNextKillMilestoneTargetLine(approvedKills = null) {
  const kills = normalizeNullableFiniteNumber(approvedKills);
  if (!Number.isFinite(kills)) return "";
  for (const [milestone, target] of Object.entries(KILL_MILESTONE_THRESHOLDS).sort((a, b) => Number(a[1]) - Number(b[1]))) {
    if (kills < target) {
      return `До milestone ${milestone}: +${formatNumber(Math.ceil(target - kills))} kills`;
    }
  }
  return "Kill milestones: максимум открыт";
}

function buildProgressCurrentLines({ approvedKills = null, standing = {} } = {}) {
  const lines = [];
  const kills = normalizeNullableFiniteNumber(approvedKills);
  const rank = normalizeNullableFiniteNumber(standing?.rank);
  const total = normalizeNullableFiniteNumber(standing?.totalVerified);
  const share = normalizeNullableFiniteNumber(standing?.shareOfServerKills);
  const nextKills = normalizeNullableFiniteNumber(standing?.killsToNextRank ?? standing?.killsToNext);
  lines.push([
    Number.isFinite(kills) ? `Kills ${formatNumber(kills)}` : "Kills ждут proof",
    Number.isFinite(rank) && Number.isFinite(total) ? `#${formatNumber(rank)}/${formatNumber(total)}` : null,
    Number.isFinite(share) ? `${formatPercent(share, 1)} серверных kills` : null,
  ].filter(Boolean).join(" · "));
  if (Number.isFinite(nextKills) && Number.isFinite(rank) && rank > 1) {
    lines.push(`До #${formatNumber(rank - 1)}: +${formatNumber(nextKills)} kills`);
  } else if (Number.isFinite(rank) && rank === 1) {
    lines.push("Место по kills: лидер");
  } else {
    lines.push("Место по kills откроется после общего рейтинга.");
  }
  lines.push(getNextKillTierTargetLine(kills));
  return lines.slice(0, 3);
}

function buildProgressPaceLines(killsAxis = null, recentKillChanges = []) {
  if (!killsAxis || killsAxis.isLocked) {
    return [
      killsAxis?.lockReason || "Темп откроется после approved proof.",
      "Нужно минимум 4 валидных kill-day.",
    ];
  }
  const recentWindows = Array.isArray(recentKillChanges) && recentKillChanges.length
    ? recentKillChanges
    : (Array.isArray(killsAxis.usedKillWindows) ? killsAxis.usedKillWindows : []);
  const deltas = recentWindows
    .map((entry) => {
      const delta = normalizeNullableFiniteNumber(entry?.delta);
      if (Number.isFinite(delta) && delta > 0) return delta;
      const from = normalizeNullableFiniteNumber(entry?.from);
      const to = normalizeNullableFiniteNumber(entry?.to);
      return Number.isFinite(from) && Number.isFinite(to) && to > from ? to - from : null;
    })
    .filter((entry) => Number.isFinite(entry) && entry > 0)
    .slice(0, 3);
  const lines = [
    Number.isFinite(killsAxis.averageKillsPerDay)
      ? `${formatNumber(Math.round(killsAxis.averageKillsPerDay * 10) / 10)}/день · ${formatNumber(killsAxis.killDayCoverage)} валидных дней · ${formatRatingModifier(killsAxis.growthModifierPercent)} к Kills`
      : `${formatNumber(killsAxis.killDayCoverage || 0)} валидных дней · рост не участвует`,
    deltas.length ? `Последние окна: ${deltas.map((entry) => formatSignedNumber(entry)).join(" · ")}` : "Последние окна: история proof ещё короткая",
  ];
  const ignored = Array.isArray(killsAxis.ignoredOutlierWindows) ? killsAxis.ignoredOutlierWindows : [];
  if (ignored.length) {
    lines.push(`${formatNumber(Math.round(ignored[0].averagePerDay))}/день не учтено: выше лимита ${formatNumber(PROFILE_KILLS_DAY_OUTLIER_LIMIT)}`);
  } else if (killsAxis.stalePenaltyPercent > 0) {
    lines.push(`Старость данных: -${formatNumber(killsAxis.stalePenaltyPercent)}%`);
  } else if (Number.isFinite(killsAxis.averageKillsPerDay)) {
    lines.push("Outlier выше 400/день не найден.");
  }
  return lines.slice(0, 3);
}

function buildProgressProofLines({ proofGapBlock = null, latestSubmission = null, pendingSubmission = null } = {}) {
  if (proofGapBlock?.lines?.length) return proofGapBlock.lines.slice(0, 3);
  if (pendingSubmission) {
    return [
      `Proof ждёт проверки · ${formatNumber(pendingSubmission.kills)} kills`,
      pendingSubmission.createdAt ? `Отправлен: ${formatDateTime(pendingSubmission.createdAt)}` : "Дата заявки неизвестна",
    ];
  }
  if (latestSubmission?.reviewedAt) {
    return [
      "Proof нормальный · учёт kills 100%",
      `Последняя проверка: ${formatDateTime(latestSubmission.reviewedAt)}`,
    ];
  }
  return ["Proof откроется после первого approved-среза."];
}

function buildProgressWeeklyLines(profile = null) {
  const rollups = Array.isArray(profile?.domains?.seasonArchive?.weeklyRollups)
    ? profile.domains.seasonArchive.weeklyRollups
    : [];
  if (!rollups.length) {
    return ["Неделя откроется после 7 дней покрытия · сейчас 0/7"];
  }
  return rollups.slice().sort((left, right) => {
    const rightTime = Date.parse(String(right?.endDayKey || right?.weekKey || ""));
    const leftTime = Date.parse(String(left?.endDayKey || left?.weekKey || ""));
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
  }).slice(0, 4).map((rollup) => {
    const weekKey = cleanString(rollup?.weekKey, 40) || "Неделя";
    const grade = cleanString(rollup?.composite?.grade, 10) || "—";
    const killsDelta = normalizeNullableFiniteNumber(rollup?.totals?.approvedKillsDelta);
    const jjsMinutes = normalizeNullableFiniteNumber(rollup?.totals?.jjsMinutes);
    const coverage = normalizeNullableFiniteNumber(rollup?.coverage?.coveragePercent);
    if (Number.isFinite(coverage) && coverage < 50) {
      return `${weekKey} закрыта · покрытие ${formatPercent(coverage, 0)}`;
    }
    return [
      `${weekKey} ${grade}`,
      Number.isFinite(killsDelta) ? `${formatSignedNumber(killsDelta)} kills` : null,
      Number.isFinite(jjsMinutes) ? `${formatJjsHoursFromMinutes(jjsMinutes)} JJS` : null,
      Number.isFinite(coverage) ? `покрытие ${formatPercent(coverage, 0)}` : null,
    ].filter(Boolean).join(" · ");
  });
}

function buildUpgradeHintLines(profileRatingAxes = [], approvedKills = null, standing = {}) {
  const axes = Array.isArray(profileRatingAxes) ? profileRatingAxes : [];
  const lines = [];
  const rank = normalizeNullableFiniteNumber(standing?.rank);
  const nextKills = normalizeNullableFiniteNumber(standing?.killsToNextRank ?? standing?.killsToNext);
  if (Number.isFinite(rank) && rank > 1 && Number.isFinite(nextKills)) {
    lines.push(`Kills #${formatNumber(rank - 1)}: +${formatNumber(nextKills)} kills`);
  }
  const tierLine = getNextKillTierTargetLine(approvedKills);
  if (tierLine && !/максимум/.test(tierLine)) lines.push(tierLine);
  const milestone = getNextKillMilestoneTargetLine(approvedKills);
  if (milestone && !/максимум/.test(milestone)) lines.push(milestone);
  lines.push(...axes
    .filter((axis) => axis?.axisName && axis?.primaryHintLine)
    .map((axis) => `${axis.label}: ${axis.primaryHintLine.replace(/^💡\s*/u, "")}`));
  return lines.slice(0, 4);
}

function buildPrimeRecordLines({ profile = null, synergy = null } = {}) {
  const weeklyRollups = Array.isArray(profile?.domains?.seasonArchive?.weeklyRollups)
    ? profile.domains.seasonArchive.weeklyRollups
    : [];
  const bestWeek = weeklyRollups.slice().sort((left, right) => (
    normalizeFiniteNumber(right?.composite?.score, 0) - normalizeFiniteNumber(left?.composite?.score, 0)
  ))[0];
  const lines = [];
  if (bestWeek) {
    lines.push(`Лучшая неделя: ${cleanString(bestWeek.weekKey, 40) || "—"} · ${cleanString(bestWeek?.composite?.grade, 10) || "—"}`);
  }
  const bestPeriodsLine = synergy?.blocks?.bestPeriods?.lines?.[0] ? cleanString(synergy.blocks.bestPeriods.lines[0], 220) : "";
  if (bestPeriodsLine) lines.push(bestPeriodsLine);
  const primeLine = synergy?.blocks?.primeTime?.lines?.[0] ? cleanString(synergy.blocks.primeTime.lines[0], 220) : "";
  if (primeLine) lines.push(primeLine);
  if (!lines.length) lines.push("Прайм и рекорды откроются после недельной истории и JJS hourly buckets.");
  return lines.slice(0, 3);
}

function buildProgressDashboard({
  profile = null,
  approvedKills = null,
  standing = {},
  profileRatingAxes = [],
  recentKillChanges = [],
  latestSubmission = null,
  pendingSubmission = null,
  proofGapBlock = null,
  synergy = null,
} = {}) {
  const killsAxis = (Array.isArray(profileRatingAxes) ? profileRatingAxes : []).find((axis) => axis?.axisName === "kills") || null;
  return {
    blocks: [
      { title: "⚔️ Сейчас", lines: buildProgressCurrentLines({ approvedKills, standing }) },
      { title: "📈 Темп", lines: buildProgressPaceLines(killsAxis, recentKillChanges) },
      { title: "🧾 Proof", lines: buildProgressProofLines({ proofGapBlock, latestSubmission, pendingSubmission }) },
      { title: "🗓️ Недели", lines: buildProgressWeeklyLines(profile) },
      { title: "💡 До апа", lines: buildUpgradeHintLines(profileRatingAxes, approvedKills, standing) },
      { title: "🏆 Прайм и рекорды", lines: buildPrimeRecordLines({ profile, synergy }) },
    ],
  };
}

function getSupportAntiteamSummary(supportSummary = {}) {
  const antiteam = supportSummary?.antiteam && typeof supportSummary.antiteam === "object"
    ? supportSummary.antiteam
    : supportSummary;
  return antiteam && typeof antiteam === "object" ? antiteam : {};
}

function getPopulationActivityTotal(populationProfiles = [], field = "messages30d") {
  return (Array.isArray(populationProfiles) ? populationProfiles : [])
    .map((entry) => entry?.profile || entry)
    .map((profile) => profile?.summary?.activity?.[field] ?? profile?.domains?.activity?.[field])
    .map((entry) => normalizeFiniteNumber(entry, 0))
    .filter((entry) => Number.isFinite(entry) && entry > 0)
    .reduce((sum, entry) => sum + entry, 0);
}

function formatActivityMetric(value, fallback = "—") {
  const amount = normalizeNullableFiniteNumber(value);
  return Number.isFinite(amount) ? formatNumber(amount) : fallback;
}

function formatVoiceHoursFromSeconds(value) {
  const seconds = normalizeNullableFiniteNumber(value);
  return Number.isFinite(seconds) ? `${formatHours(seconds / 3600)} ч` : "—";
}

function buildActivityQualityPercent(activitySummary = {}) {
  const effectiveActive = normalizeNullableFiniteNumber(activitySummary?.effectiveActiveVoiceSignalHours30d);
  const effectiveVoice = normalizeNullableFiniteNumber(activitySummary?.effectiveVoiceHours30d);
  if (Number.isFinite(effectiveActive) && Number.isFinite(effectiveVoice) && effectiveVoice > 0) {
    return Math.max(0, Math.min(100, (effectiveActive / effectiveVoice) * 100));
  }
  const activeSeconds = normalizeNullableFiniteNumber(activitySummary?.activeVoiceDurationSeconds30d);
  const rawSeconds = normalizeNullableFiniteNumber(activitySummary?.voiceDurationSeconds30d);
  if (Number.isFinite(activeSeconds) && Number.isFinite(rawSeconds) && rawSeconds > 0) {
    return Math.max(0, Math.min(100, (activeSeconds / rawSeconds) * 100));
  }
  return null;
}

function buildActivityMixMeter({ jjsHours30d = null, messages30d = null, voiceHours30d = null } = {}) {
  const chatProxy = Number.isFinite(messages30d) ? messages30d / 30 : null;
  const values = [
    { label: "JJS", value: jjsHours30d },
    { label: "Chat", value: chatProxy },
    { label: "Voice", value: voiceHours30d },
  ];
  const total = values
    .map((entry) => entry.value)
    .filter((entry) => Number.isFinite(entry) && entry > 0)
    .reduce((sum, entry) => sum + entry, 0);
  if (total <= 0) return "нет сигнала";
  return values
    .filter((entry) => Number.isFinite(entry.value) && entry.value > 0)
    .map((entry) => `${entry.label} ${buildStatBar((entry.value / total) * 100, 4)}`)
    .join(" · ");
}

function buildActivityDashboard({
  activitySummary = {},
  robloxSummary = {},
  supportSummary = {},
  robloxDisplayState = null,
  robloxSyncHealth = null,
  populationProfiles = [],
  synergy = null,
  progressState = {},
  weeklyWindowCount = 0,
} = {}) {
  const support = getSupportAntiteamSummary(supportSummary);
  const canShowJjs = robloxDisplayState?.isTrackable === true;
  const jjsHours7d = canShowJjs && Number.isFinite(Number(robloxSummary?.jjsMinutes7d)) ? Number(robloxSummary.jjsMinutes7d) / 60 : null;
  const jjsHours30d = canShowJjs && Number.isFinite(Number(robloxSummary?.jjsMinutes30d)) ? Number(robloxSummary.jjsMinutes30d) / 60 : null;
  const messages7d = normalizeNullableFiniteNumber(activitySummary?.messages7d);
  const messages30d = normalizeNullableFiniteNumber(activitySummary?.messages30d);
  const messages90d = normalizeNullableFiniteNumber(activitySummary?.messages90d);
  const rawVoiceHours30d = getActivityVoiceHours(activitySummary, "30d");
  const rawVoiceHours7d = getActivityVoiceHours(activitySummary, "7d");
  const effectiveVoiceHours30d = normalizeNullableFiniteNumber(activitySummary?.effectiveVoiceHours30d);
  const activeVoiceQuality = buildActivityQualityPercent(activitySummary);
  const antiteamArrived = normalizeNullableFiniteNumber(support?.confirmedArrived);
  const messageTotal30d = getPopulationActivityTotal(populationProfiles, "messages30d") + (Number.isFinite(messages30d) ? messages30d : 0);
  const messageShare30d = Number.isFinite(messages30d) && messageTotal30d > 0 ? (messages30d / messageTotal30d) * 100 : null;
  const activeDays30d = normalizeNullableFiniteNumber(activitySummary?.activeDays30d);
  const activeDays7d = getActivityActiveDays(activitySummary, "7d");
  const activityRole = cleanString(activitySummary?.appliedActivityRoleKey || activitySummary?.desiredActivityRoleKey, 80);
  const mixMeter = buildActivityMixMeter({ jjsHours30d, messages30d, voiceHours30d: rawVoiceHours30d });
  const voiceSessions = normalizeNullableFiniteNumber(activitySummary?.voiceSessions30d);
  const jjsSessions = normalizeNullableFiniteNumber(robloxSummary?.sessionCount);
  const primeBlock = synergy?.blocks?.primeTime;
  const weeklyScore = synergy?.blocks?.weeklyRollups?.lines?.[0] || null;
  const growthWindow = progressState?.latestGrowthWindow && typeof progressState.latestGrowthWindow === "object"
    ? progressState.latestGrowthWindow
    : null;

  const statusLine = robloxDisplayState?.isLinked
    ? (robloxDisplayState.isTrackable ? "Roblox готов" : "Roblox привязан, JJS не обновляется")
    : (robloxDisplayState?.state === "suspicious" ? "Roblox требует перепривязки" : "Roblox не привязан");

  const summaryLines = [
    `JJS ${Number.isFinite(Number(robloxSummary?.jjsMinutes30d)) && canShowJjs ? `${formatJjsHoursFromMinutes(robloxSummary.jjsMinutes30d)}/30д ${buildStatBar(Math.min(100, (jjsHours30d / 20) * 100), 5)}` : "—"} · ${statusLine}`,
    robloxDisplayState?.isTrackable && robloxSyncHealth?.critical && robloxSyncHealth?.line
      ? robloxSyncHealth.line
      : "",
    `Chat ${formatActivityMetric(messages30d)} msg/30д${Number.isFinite(messages30d) ? ` ${buildStatBar(Math.min(100, (messages30d / 1000) * 100), 5)}` : ""}${Number.isFinite(activeDays30d) ? ` · ${formatNumber(activeDays30d)}/30 активных дней` : ""}`,
    `Voice ${Number.isFinite(rawVoiceHours30d) ? `${formatHours(rawVoiceHours30d)} ч` : "—"}${Number.isFinite(effectiveVoiceHours30d) ? ` · активное ${formatHours(effectiveVoiceHours30d)} ч` : ""}${Number.isFinite(activeVoiceQuality) ? ` · качество ${formatPercent(activeVoiceQuality, 0)} ${buildStatBar(activeVoiceQuality, 5)}` : ""}`,
    [
      activityRole ? `роль ${activityRole}` : null,
      Number.isFinite(antiteamArrived) ? `Antiteam ${formatNumber(antiteamArrived)} отклик` : "Antiteam —",
      mixMeter ? `mix ${mixMeter}` : null,
    ].filter(Boolean).join(" · "),
  ].filter(Boolean);

  const messageLines = [
    `7д ${formatActivityMetric(messages7d)} · 30д ${formatActivityMetric(messages30d)} · 90д ${formatActivityMetric(messages90d)}`,
    Number.isFinite(messageShare30d)
      ? `Доля от видимого чата: ${formatPercent(messageShare30d, 1)} ${buildStatBar(messageShare30d, 5)}`
      : "Доля от видимого чата откроется после population-среза.",
    Number.isFinite(activeDays7d) || Number.isFinite(activeDays30d)
      ? `Ритм: ${Number.isFinite(activeDays7d) ? `${formatNumber(activeDays7d)}/7д` : "—"} · ${Number.isFinite(activeDays30d) ? `${formatNumber(activeDays30d)}/30д` : "—"} активных дней`
      : "Ритм откроется после дневной истории.",
  ];

  const voiceLines = [
    `Raw ${Number.isFinite(rawVoiceHours30d) ? `${formatHours(rawVoiceHours30d)} ч` : "—"} · учёт ${Number.isFinite(effectiveVoiceHours30d) ? `${formatHours(effectiveVoiceHours30d)} ч` : "—"}${Number.isFinite(activeVoiceQuality) ? ` · качество ${formatPercent(activeVoiceQuality, 0)}` : ""}`,
    `7д ${Number.isFinite(rawVoiceHours7d) ? `${formatHours(rawVoiceHours7d)} ч` : "—"} · sessions ${Number.isFinite(voiceSessions) ? formatNumber(voiceSessions) : "—"}`,
    Number.isFinite(activeVoiceQuality) ? `Качество ${buildStatBar(activeVoiceQuality, 5)} · активное voice` : "Качество voice откроется после active-сигналов.",
  ];

  const jjsLines = [
    `7д ${Number.isFinite(Number(robloxSummary?.jjsMinutes7d)) && canShowJjs ? formatJjsHoursFromMinutes(robloxSummary.jjsMinutes7d) : "—"} · 30д ${Number.isFinite(Number(robloxSummary?.jjsMinutes30d)) && canShowJjs ? formatJjsHoursFromMinutes(robloxSummary.jjsMinutes30d) : "—"} · sessions ${Number.isFinite(jjsSessions) ? formatNumber(jjsSessions) : "—"}`,
    primeBlock?.lines?.[0] ? cleanString(primeBlock.lines[0], 220) : "Prime time откроется после hourly buckets.",
    Number.isFinite(jjsHours7d) ? `Покрытие недели: ${buildStatBar(Math.min(100, (jjsHours7d / 3) * 100), 5)} · база 3 ч для боевой формы` : "Покрытие недели откроется после JJS sync.",
  ];

  const weekLines = weeklyWindowCount >= 1
    ? [
      weeklyScore || `Weekly история: ${formatNumber(weeklyWindowCount)} окно`,
      weeklyWindowCount >= 3
        ? "Стабильность доступна: 3+ weekly окна"
        : `🔒 Стабильность откроется после 3 weekly окон · сейчас ${formatNumber(weeklyWindowCount)}/3`,
    ]
    : ["🔒 Неделя откроется после 7 дней покрытия · сейчас 0/7"];

  const growthLines = growthWindow
    ? [
      `Kills: ${formatSignedNumber(growthWindow.deltaKills)} за ${formatNumber(growthWindow.wallClockDays)} дн.`,
      Number.isFinite(growthWindow.killsPerDay) ? `Темп: ${formatHours(growthWindow.killsPerDay, 1)} kills/день` : "",
      Number.isFinite(progressState?.jjsHoursSinceLastApprovedKillsUpdate)
        ? `После proof: ${formatHours(progressState.jjsHoursSinceLastApprovedKillsUpdate)} ч JJS`
        : "JJS после proof не покрыт.",
    ].filter(Boolean)
    : ["🔒 Рост откроется после 2 proof-срезов или JJS после proof."];

  return {
    summaryLines: summaryLines.slice(0, 4),
    blocks: [
      { title: "📊 Итог активности", lines: summaryLines.slice(0, 4) },
      { title: "💬 Сообщения", lines: messageLines.slice(0, 3) },
      { title: "🎙️ Voice", lines: voiceLines.slice(0, 3) },
      { title: "🎮 JJS", lines: jjsLines.slice(0, 3) },
      { title: "🗓️ Неделя", lines: weekLines.slice(0, 3) },
      { title: "⚔️ Рост активности", lines: growthLines.slice(0, 3) },
    ],
  };
}

function collectPopulationActivityScores(populationProfiles = []) {
  return (Array.isArray(populationProfiles) ? populationProfiles : [])
    .map((entry) => entry?.profile || entry)
    .map((profile) => profile?.summary?.activity?.activityScore ?? profile?.domains?.activity?.activityScore)
    .map((entry) => normalizeFiniteNumber(entry))
    .filter((entry) => Number.isFinite(entry));
}

function normalizeCharacterStats(characterStats = []) {
  return (Array.isArray(characterStats) ? characterStats : [])
    .map((entry, index) => ({
      ...entry,
      id: cleanString(entry?.id, 80),
      main: cleanString(entry?.main || entry?.label, 120),
      roleId: cleanString(entry?.roleId, 80),
      rank: index + 1,
      total: characterStats.length,
    }))
    .filter((entry) => entry.id || entry.main || entry.roleId);
}

function findCharacterStat({ id = "", label = "", stats = [] } = {}) {
  const normalizedId = normalizeComboLookupKey(id);
  const normalizedLabel = normalizeComboLookupKey(label);
  return stats.find((entry) => (normalizedId && normalizeComboLookupKey(entry.id) === normalizedId)
    || (normalizedLabel && normalizeComboLookupKey(entry.main) === normalizedLabel)) || null;
}

function extractApprovedEntryMainKeys(entry = {}) {
  const values = [];
  for (const field of ["mains", "mainCharacterLabels", "mainCharacterIds", "mainIds", "mainLabels"]) {
    if (Array.isArray(entry?.[field])) values.push(...entry[field]);
  }
  for (const field of ["mainName", "main", "tierlistMainName", "primaryMain"]) {
    if (entry?.[field]) values.push(entry[field]);
  }
  return new Set(values
    .map((value) => normalizeComboLookupKey(value))
    .filter(Boolean));
}

function buildMainStandings({
  approvedEntries = [],
  userId = "",
  mainCharacterIds = [],
  mainCharacterLabels = [],
  characterStats = [],
  hiddenRoleIds = new Set(),
} = {}) {
  const normalizedStats = normalizeCharacterStats(characterStats);
  const normalizedUserId = cleanString(userId, 80);
  const entries = (Array.isArray(approvedEntries) ? approvedEntries : [])
    .map((entry) => ({
      ...entry,
      userId: cleanString(entry?.userId, 80),
      approvedKills: normalizeNullableFiniteNumber(entry?.approvedKills),
      mainKeys: extractApprovedEntryMainKeys(entry),
      displayName: cleanString(entry?.displayName, 200),
    }))
    .filter((entry) => entry.userId && Number.isFinite(entry.approvedKills) && entry.mainKeys.size > 0);

  return (Array.isArray(mainCharacterLabels) ? mainCharacterLabels : [])
    .map((label, index) => {
      const mainLabel = cleanString(label, 80);
      const mainId = Array.isArray(mainCharacterIds) ? cleanString(mainCharacterIds[index], 80) : "";
      if (!mainLabel) return null;

      const mainKeys = new Set([normalizeComboLookupKey(mainLabel), normalizeComboLookupKey(mainId)].filter(Boolean));
      const stat = findCharacterStat({ id: mainId, label: mainLabel, stats: normalizedStats });
      const roleId = cleanString(stat?.roleId, 80);
      const roleMention = roleId && !hiddenRoleIds.has(roleId) ? `<@&${roleId}>` : "";
      const ranked = entries
        .filter((entry) => [...mainKeys].some((key) => entry.mainKeys.has(key)))
        .slice()
        .sort((left, right) => {
          if (right.approvedKills !== left.approvedKills) return right.approvedKills - left.approvedKills;
          return cleanString(left.displayName || left.userId, 200).localeCompare(cleanString(right.displayName || right.userId, 200), "ru");
        });
      const indexInMain = ranked.findIndex((entry) => entry.userId === normalizedUserId);
      const currentEntry = indexInMain >= 0 ? ranked[indexInMain] : null;
      const previousEntry = indexInMain > 0 ? ranked[indexInMain - 1] : null;
      const mainKillsTotal = ranked.reduce((sum, entry) => sum + (Number(entry.approvedKills) || 0), 0);
      const mainKillSharePercent = currentEntry && mainKillsTotal > 0
        ? (Number(currentEntry.approvedKills) / mainKillsTotal) * 100
        : null;
      const killsToNext = previousEntry
        ? Math.max(1, Math.floor(previousEntry.approvedKills - currentEntry.approvedKills + 1))
        : null;

      return {
        id: mainId,
        label: mainLabel,
        roleId,
        roleMention,
        rank: indexInMain >= 0 ? indexInMain + 1 : null,
        total: ranked.length,
        currentKills: currentEntry?.approvedKills ?? null,
        mainKillsTotal,
        mainKillSharePercent,
        killsToNext,
        nextRank: indexInMain > 0 ? indexInMain : null,
        isLeader: indexInMain === 0 && ranked.length > 0,
        available: indexInMain >= 0 && ranked.length > 0,
      };
    })
    .filter(Boolean);
}

function formatMainStandingLine(standing = {}) {
  const label = cleanString(standing.label, 80);
  if (!label) return "";
  const suffixParts = [];
  if (standing.available) {
    suffixParts.push(`#${formatNumber(standing.rank)}/${formatNumber(standing.total)}`);
    if (Number.isFinite(Number(standing.mainKillSharePercent))) {
      suffixParts.push(`${formatPercent(standing.mainKillSharePercent, 0)} kills мейна`);
    }
    if (standing.isLeader) {
      suffixParts.push("👑 лидер");
    } else if (Number.isFinite(Number(standing.killsToNext)) && Number.isFinite(Number(standing.nextRank))) {
      suffixParts.push(`+${formatNumber(standing.killsToNext)} kills до #${formatNumber(standing.nextRank)}`);
    }
  }
  const role = standing.roleMention ? ` ${standing.roleMention}` : "";
  return `${label}${role}${suffixParts.length ? ` (${suffixParts.join(" · ")})` : " (место откроется после рейтинга мейнов)"}`;
}

function formatMainStandingShort(standing = {}) {
  if (!standing?.available) return cleanString(standing?.label, 80);
  const label = cleanString(standing.label, 80);
  const place = `${label} #${formatNumber(standing.rank)}/${formatNumber(standing.total)}`;
  const share = Number.isFinite(Number(standing.mainKillSharePercent))
    ? ` · ${formatPercent(standing.mainKillSharePercent, 0)} kills`
    : "";
  if (standing.isLeader) return `${place}${share} · лидер`;
  if (Number.isFinite(Number(standing.killsToNext)) && Number.isFinite(Number(standing.nextRank))) {
    return `${place}${share} · +${formatNumber(standing.killsToNext)} до #${formatNumber(standing.nextRank)}`;
  }
  return `${place}${share}`;
}

function buildRoleShowcaseLines({
  mainCharacterIds = [],
  mainCharacterLabels = [],
  characterStats = [],
  mainStandings = [],
  hiddenRoleIds = new Set(),
} = {}) {
  const lines = [];
  const normalizedStats = normalizeCharacterStats(characterStats);
  const mains = (Array.isArray(mainCharacterLabels) ? mainCharacterLabels : [])
    .map((label, index) => ({
      id: Array.isArray(mainCharacterIds) ? mainCharacterIds[index] : "",
      label: cleanString(label, 80),
    }))
    .filter((entry) => entry.label)
    .slice(0, 3);

  if (mains.length) {
    for (const main of mains) {
      const standingForMain = (Array.isArray(mainStandings) ? mainStandings : []).find((entry) => (
        normalizeComboLookupKey(entry?.id) === normalizeComboLookupKey(main.id)
          || normalizeComboLookupKey(entry?.label) === normalizeComboLookupKey(main.label)
      ));
      const stat = findCharacterStat({ id: main.id, label: main.label, stats: normalizedStats });
      const fallbackRoleId = cleanString(stat?.roleId, 80);
      const fallbackRole = fallbackRoleId && !hiddenRoleIds.has(fallbackRoleId) ? `<@&${fallbackRoleId}>` : "";
      lines.push(`🎭 ${formatMainStandingLine(standingForMain || {
        ...main,
        roleMention: fallbackRole,
        available: false,
      })}`);
    }
  } else {
    lines.push("🎭 Мейны откроются после выбора персонажей.");
  }

  return lines;
}

function buildMandatoryLinks({ robloxProfileUrl = "" } = {}) {
  const links = [];
  const normalizedRobloxUrl = normalizeMediaUrl(robloxProfileUrl, 2000);
  if (normalizedRobloxUrl) {
    links.push({
      kind: "mandatory-roblox",
      label: "Roblox профиль",
      buttonLabel: "Roblox профиль",
      url: normalizedRobloxUrl,
    });
  }
  links.push({
    kind: "mandatory-jjs-wiki",
    label: "JJS Wiki: персонажи",
    buttonLabel: "JJS Wiki: персонажи",
    url: JJS_WIKI_CHARACTERS_URL,
  });
  return links;
}

function summarizeRecentKillChange(change = {}) {
  const from = Number(change?.from) || 0;
  const to = Number(change?.to) || 0;
  const delta = to - from;
  const fromAt = Date.parse(String(change?.fromAt || ""));
  const toAt = Date.parse(String(change?.toAt || ""));
  const diffDays = Number.isFinite(fromAt) && Number.isFinite(toAt) && toAt > fromAt
    ? Math.max(1, Math.ceil((toAt - fromAt) / (24 * 60 * 60 * 1000)))
    : 1;

  return {
    delta,
    dayCount: diffDays,
    averagePerDay: delta / diffDays,
  };
}

function normalizeRecentKillChanges(changes = [], fallbackChange = null, limit = 3) {
  const limitNumber = Number(limit);
  const normalizedLimit = Number.isFinite(limitNumber) ? Math.max(1, limitNumber) : Number.POSITIVE_INFINITY;
  const list = [];
  const seen = new Set();

  function pushChange(change) {
    if (!change || typeof change !== "object") return;
    const from = normalizeFiniteNumber(change.from);
    const to = normalizeFiniteNumber(change.to);
    const fromAt = Number.isFinite(Number(change.fromAt)) ? Number(change.fromAt) : Date.parse(String(change.fromAt || ""));
    const toAt = Number.isFinite(Number(change.toAt)) ? Number(change.toAt) : Date.parse(String(change.toAt || ""));
    if (!Number.isFinite(from) || !Number.isFinite(to) || !(to > from)) return;
    const key = `${from}:${to}:${Number.isFinite(toAt) ? toAt : "na"}`;
    if (seen.has(key)) return;
    seen.add(key);
    list.push({
      ...change,
      from,
      to,
      fromAt,
      toAt,
      dayCount: normalizeNullableFiniteNumber(change.dayCount),
      source: cleanString(change.source, 40),
      sourceLabel: cleanString(change.sourceLabel, 40),
      sourceGap: change.sourceGap === true,
    });
  }

  for (const change of Array.isArray(changes) ? changes : []) {
    pushChange(change);
    if (list.length >= normalizedLimit) break;
  }
  if (!list.length) pushChange(fallbackChange);

  return list
    .sort((left, right) => (Number.isFinite(right.toAt) ? right.toAt : 0) - (Number.isFinite(left.toAt) ? left.toAt : 0))
    .slice(0, normalizedLimit);
}

function buildRecentKillHistoryLines(changes = []) {
  const lines = [];
  const items = Array.isArray(changes) ? changes : [];
  if (!items.length) {
    lines.push("Подробной истории approved ростов по kills пока нет.");
    return lines;
  }

  for (let index = 0; index < items.length; index += 1) {
    const change = items[index];
    const summary = summarizeRecentKillChange(change);
    lines.push(
      `${index + 1}. ${formatNumber(change.from)} -> ${formatNumber(change.to)} (${formatSignedNumber(summary.delta)} за ${formatNumber(summary.dayCount)} дн., ${formatNumber(summary.averagePerDay)}/день)`
    );
    if (change.toAt) {
      lines.push(`Проверено: ${formatDateTime(change.toAt)}`);
    }
  }

  return lines;
}

function buildTopCoPlayPeerLines(peers = [], limit = 3) {
  const lines = [];
  const items = (Array.isArray(peers) ? peers : []).slice(0, Math.max(1, Number(limit) || 3));
  if (!items.length) {
    lines.push("Нет заметных совместных сессий в JJS.");
    return lines;
  }

  for (const peer of items) {
    const peerId = cleanString(peer?.peerUserId, 80) || "unknown";
    const parts = [`<@${peerId}>`];
    if (Number.isFinite(Number(peer?.minutesTogether)) && Number(peer.minutesTogether) > 0) {
      parts.push(`${formatJjsHoursFromMinutes(peer.minutesTogether)} вместе`);
    }
    if (Number.isFinite(Number(peer?.sessionsTogether)) && Number(peer.sessionsTogether) > 0) {
      parts.push(`${formatNumber(peer.sessionsTogether)} сесс.`);
    }
    if (peer?.isRobloxFriend === true) {
      parts.push("Roblox-друг");
    } else if (peer?.isFrequentNonFriend === true) {
      parts.push("частый non-friend");
    }
    if (peer?.lastSeenTogetherAt) {
      parts.push(`последний раз ${formatDateTime(peer.lastSeenTogetherAt)}`);
    }
    lines.push(parts.join(" • "));
  }

  return lines;
}

function buildDiscordChannelUrl(guildId, channelId) {
  const normalizedGuildId = cleanString(guildId, 80);
  const normalizedChannelId = cleanString(channelId, 80);
  if (!normalizedGuildId || !normalizedChannelId) return null;
  return `https://discord.com/channels/${normalizedGuildId}/${normalizedChannelId}`;
}

function normalizeComboLookupKey(value) {
  return cleanString(value, 120).toLowerCase();
}

function buildComboThreadLinks({ guideState = {}, mainCharacterIds = [], mainCharacterLabels = [], guildId = "" } = {}) {
  const characters = Array.isArray(guideState?.characters) ? guideState.characters : [];
  const guideById = new Map();
  const guideByName = new Map();
  for (const entry of characters) {
    const keyId = normalizeComboLookupKey(entry?.id);
    const keyName = normalizeComboLookupKey(entry?.name);
    if (keyId) guideById.set(keyId, entry);
    if (keyName) guideByName.set(keyName, entry);
  }

  const links = [];
  const seenThreadIds = new Set();
  const ids = Array.isArray(mainCharacterIds) ? mainCharacterIds : [];
  const labels = Array.isArray(mainCharacterLabels) ? mainCharacterLabels : [];

  for (let index = 0; index < Math.max(ids.length, labels.length); index += 1) {
    const mainId = normalizeComboLookupKey(ids[index]);
    const mainLabel = cleanString(labels[index], 80);
    const entry = (mainId && guideById.get(mainId)) || guideByName.get(normalizeComboLookupKey(mainLabel));
    const threadId = cleanString(entry?.threadId, 80);
    const url = buildDiscordChannelUrl(guildId, threadId);
    if (!threadId || !url || seenThreadIds.has(threadId)) continue;
    seenThreadIds.add(threadId);
    const resolvedLabel = cleanString(mainLabel || entry?.name || entry?.id, 80) || `Main ${links.length + 1}`;
    links.push({
      label: resolvedLabel,
      buttonLabel: cleanString(`Гайд: ${resolvedLabel}`, 80) || "Гайд",
      kind: "main",
      mainLabel: resolvedLabel,
      url,
    });
    if (links.length >= 2) break;
  }

  const generalTechsUrl = buildDiscordChannelUrl(guildId, cleanString(guideState?.generalTechsThreadId, 80));
  if (generalTechsUrl && links.length < 3) {
    links.push({
      label: "Общие техи",
      buttonLabel: "Общие техи",
      kind: "general",
      url: generalTechsUrl,
    });
  }

  return links;
}

function buildCharacterWikiLinks({ characterCatalog = [], mainCharacterIds = [], mainCharacterLabels = [] } = {}) {
  const catalog = Array.isArray(characterCatalog) ? characterCatalog : [];
  const catalogById = new Map();
  const catalogByLabel = new Map();

  for (const entry of catalog) {
    const keyId = normalizeComboLookupKey(entry?.id);
    if (keyId) catalogById.set(keyId, entry);

    for (const candidate of [entry?.label, entry?.englishLabel]) {
      const keyLabel = normalizeComboLookupKey(candidate);
      if (keyLabel && !catalogByLabel.has(keyLabel)) {
        catalogByLabel.set(keyLabel, entry);
      }
    }
  }

  const ids = Array.isArray(mainCharacterIds) ? mainCharacterIds : [];
  const labels = Array.isArray(mainCharacterLabels) ? mainCharacterLabels : [];
  const links = [];
  const seenUrls = new Set();

  for (let index = 0; index < Math.max(ids.length, labels.length); index += 1) {
    const mainId = normalizeComboLookupKey(ids[index]);
    const mainLabel = cleanString(labels[index], 80);
    const entry = (mainId && catalogById.get(mainId)) || catalogByLabel.get(normalizeComboLookupKey(mainLabel));
    const url = normalizeMediaUrl(entry?.wikiUrl, 2000);
    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);
    const resolvedLabel = cleanString(mainLabel || entry?.label || entry?.englishLabel || entry?.id, 80) || `Main ${links.length + 1}`;
    links.push({
      label: resolvedLabel,
      buttonLabel: cleanString(`JJS Wiki: ${resolvedLabel}`, 80) || "JJS Wiki",
      kind: "wiki",
      mainLabel: resolvedLabel,
      url,
    });
    if (links.length >= 2) break;
  }

  return links;
}

function mergeProfileLinks(guideLinks = [], wikiLinks = []) {
  const mainGuideLinks = (Array.isArray(guideLinks) ? guideLinks : []).filter((entry) => entry?.kind === "main");
  const generalGuideLinks = (Array.isArray(guideLinks) ? guideLinks : []).filter((entry) => entry?.kind === "general");
  const merged = [];
  const seenUrls = new Set();

  for (const entry of [...mainGuideLinks, ...(Array.isArray(wikiLinks) ? wikiLinks : []), ...generalGuideLinks]) {
    const url = normalizeMediaUrl(entry?.url, 2000);
    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);
    merged.push({
      ...entry,
      url,
    });
  }

  return merged;
}

function buildOverviewStatusLines({
  profile = null,
  verificationSummary = {},
  robloxSummary = {},
  robloxDisplayState = null,
  pendingSubmission = null,
} = {}) {
  const lines = [];

  if (profile?.accessGrantedAt) {
    lines.push(`JJS доступ: открыт с ${formatDateTime(profile.accessGrantedAt)}`);
  } else if (pendingSubmission) {
    lines.push("JJS доступ: ждёт одобрения proof.");
  } else {
    lines.push("JJS доступ: пока не выдан.");
  }

  if (profile?.nonGgsAccessGrantedAt) {
    lines.push(`Non-JJS доступ: открыт с ${formatDateTime(profile.nonGgsAccessGrantedAt)}`);
  }

  lines.push(`Верификация: ${cleanString(verificationSummary.status, 80) || "не начата"}`);

  lines.push(robloxDisplayState?.statusLine || formatRobloxBindingStatusLine(profile || robloxSummary));

  return lines;
}

function hasOwn(source, key) {
  return Boolean(source) && Object.prototype.hasOwnProperty.call(source, key);
}

function firstCleanString(values = [], limit = 2000) {
  for (const value of Array.isArray(values) ? values : []) {
    const text = cleanString(value, limit);
    if (text) return text;
  }
  return "";
}

function hasMeaningfulRobloxDomain(source = {}) {
  const value = source && typeof source === "object" ? source : {};
  return [
    value.username,
    value.currentUsername,
    value.userId,
    value.robloxUserId,
    value.profileUrl,
    value.avatarUrl,
    value.verificationStatus,
    value.verifiedAt,
  ].some((entry) => cleanString(entry, 200))
    || Boolean(value.playtime && typeof value.playtime === "object");
}

function buildRobloxLegacyCandidate(profile = {}) {
  const source = profile && typeof profile === "object" ? profile : {};
  return {
    username: source.robloxUsername,
    currentUsername: source.robloxUsername,
    displayName: source.robloxDisplayName,
    currentDisplayName: source.robloxDisplayName,
    userId: source.robloxUserId,
    avatarUrl: source.robloxAvatarUrl,
    profileUrl: source.robloxProfileUrl,
    verificationStatus: source.verificationStatus,
    verifiedAt: source.robloxVerifiedAt || source.verifiedAt,
  };
}

function isRobloxCandidateLinked(candidate = {}) {
  const source = candidate && typeof candidate === "object" ? candidate : {};
  const status = cleanString(source.verificationStatus || source.status, 40).toLowerCase();
  if (["failed", "unverified", "rejected", "denied"].includes(status)) return false;
  return status === "verified"
    || source.hasVerifiedAccount === true
    || Boolean(cleanString(source.verifiedAt || source.robloxVerifiedAt, 80));
}

function normalizeSummaryRobloxToDomainShape(summary = {}) {
  const source = summary && typeof summary === "object" ? summary : {};
  return {
    username: source.username || source.currentUsername,
    displayName: source.displayName || source.currentDisplayName,
    userId: source.userId,
    avatarUrl: source.avatarUrl,
    profileUrl: source.profileUrl,
    verificationStatus: source.verificationStatus || (source.hasVerifiedAccount === true ? "verified" : null),
    verifiedAt: source.verifiedAt,
    lastRefreshAt: source.lastRefreshAt,
    refreshStatus: source.refreshStatus,
    refreshError: source.refreshError,
  };
}

function pickRobloxPlaytimeValue(domainPlaytime = {}, summary = {}, key = "") {
  const domainValue = normalizeNullableFiniteNumber(domainPlaytime?.[key]);
  if (hasOwn(domainPlaytime, key) && Number.isFinite(domainValue)) {
    return domainValue;
  }
  const summaryValue = normalizeNullableFiniteNumber(summary?.[key]);
  if (hasOwn(summary, key) && Number.isFinite(summaryValue)) {
    return summaryValue;
  }
  return null;
}

function buildCanonicalRobloxSummary({ profile = null, summaryRoblox = {} } = {}) {
  const rawDomain = profile?.domains?.roblox && typeof profile.domains.roblox === "object"
    ? profile.domains.roblox
    : null;
  const normalizedDomain = rawDomain ? normalizeRobloxDomainState(rawDomain) : null;
  const normalizedSummary = normalizeRobloxDomainState(normalizeSummaryRobloxToDomainShape(summaryRoblox));
  const legacy = normalizeRobloxDomainState(buildRobloxLegacyCandidate(profile || {}));
  const identityCandidates = [normalizedDomain, normalizedSummary, legacy]
    .filter((entry) => entry && hasMeaningfulRobloxDomain(entry));
  const usableIdentity = identityCandidates
    .map((entry) => resolveUsableVerifiedRobloxIdentity(entry))
    .find(Boolean) || null;
  const linkedCandidate = identityCandidates.find(isRobloxCandidateLinked) || null;
  const identity = usableIdentity || linkedCandidate || normalizedDomain || normalizedSummary || legacy || {};
  const domainPlaytime = rawDomain?.playtime && typeof rawDomain.playtime === "object" ? rawDomain.playtime : {};
  const trackingState = cleanString(summaryRoblox?.trackingState, 40)
    || (linkedCandidate ? getRobloxTrackabilityState(linkedCandidate) : getRobloxTrackabilityState(identity));
  const trackingBlocker = cleanString(summaryRoblox?.trackingBlocker, 80)
    || getRobloxTrackabilityBlocker(linkedCandidate || identity, trackingState);
  const username = firstCleanString([usableIdentity?.username, identity.username, summaryRoblox.currentUsername, summaryRoblox.username], 120);
  const displayName = firstCleanString([usableIdentity?.displayName, identity.displayName, summaryRoblox.currentDisplayName, summaryRoblox.displayName], 120);
  const userId = firstCleanString([usableIdentity?.userId, identity.userId, summaryRoblox.userId], 80);
  const builtProfileUrl = /^\d+$/.test(userId) ? buildRobloxProfileUrl(userId) : "";
  const profileUrl = normalizeMediaUrl(firstCleanString([
    usableIdentity?.profileUrl,
    identity.profileUrl,
    summaryRoblox.profileUrl,
    builtProfileUrl,
  ], 2000), 2000);
  const avatarUrl = normalizeMediaUrl(firstCleanString([usableIdentity?.avatarUrl, identity.avatarUrl, summaryRoblox.avatarUrl], 2000), 2000);
  const isLinked = Boolean(usableIdentity || linkedCandidate || (username && cleanString(identity.verificationStatus, 40) === "verified"));
  const isTrackable = trackingState === "trackable" && Boolean(userId);
  const hasPlaytimeDomain = Boolean(rawDomain?.playtime && typeof rawDomain.playtime === "object");

  return {
    ...summaryRoblox,
    identityUsable: Boolean(usableIdentity),
    hasVerifiedAccount: isLinked,
    isTrackable,
    trackingState: trackingState || (isLinked ? "manual_only" : "unverified"),
    trackingBlocker: trackingBlocker || (isTrackable ? "none" : "unverified"),
    username,
    currentUsername: username,
    displayName,
    currentDisplayName: displayName,
    userId,
    avatarUrl,
    profileUrl,
    totalJjsMinutes: pickRobloxPlaytimeValue(domainPlaytime, summaryRoblox, "totalJjsMinutes"),
    jjsMinutes7d: pickRobloxPlaytimeValue(domainPlaytime, summaryRoblox, "jjsMinutes7d"),
    jjsMinutes30d: pickRobloxPlaytimeValue(domainPlaytime, summaryRoblox, "jjsMinutes30d"),
    sessionCount: pickRobloxPlaytimeValue(domainPlaytime, summaryRoblox, "sessionCount"),
    currentSessionStartedAt: firstCleanString([domainPlaytime.currentSessionStartedAt, summaryRoblox.currentSessionStartedAt], 80) || null,
    lastSeenInJjsAt: firstCleanString([domainPlaytime.lastSeenInJjsAt, summaryRoblox.lastSeenInJjsAt], 80) || null,
    hourlyBucketsMsk: domainPlaytime.hourlyBucketsMsk || summaryRoblox.hourlyBucketsMsk,
    playtimeSource: hasPlaytimeDomain ? "domains.roblox.playtime" : "summary.roblox",
  };
}

function buildRobloxDisplayState({ profile = null, summaryRoblox = {} } = {}) {
  const canonicalSummary = buildCanonicalRobloxSummary({ profile, summaryRoblox });
  const displayIdentity = resolveRobloxDisplayIdentity(profile || { summary: { roblox: summaryRoblox } });
  const isSuspicious = displayIdentity.state === "suspicious";
  const trackingState = cleanString(canonicalSummary.trackingState, 40);
  const isLinked = !isSuspicious && canonicalSummary.hasVerifiedAccount === true;
  const isTrackable = !isSuspicious && canonicalSummary.isTrackable === true;
  const needsRebind = isSuspicious || (isLinked && !isTrackable && ["repairable", "manual_only"].includes(trackingState));
  const username = cleanString(canonicalSummary.currentUsername || canonicalSummary.username, 120);
  const userId = cleanString(canonicalSummary.userId, 80);
  const label = canonicalSummary.identityUsable === true || isTrackable
    ? (username || userId)
    : "";
  const statusLine = isSuspicious
    ? "Roblox-связка: нужна перепривязка, старые данные похожи на Discord-ник"
    : isLinked
    ? (isTrackable
      ? "Roblox-связка: подтверждена"
      : "Roblox привязан, JJS-активность не обновляется")
    : formatRobloxBindingStatusLine(profile || canonicalSummary);
  const readinessLabel = isSuspicious
    ? "Roblox требует перепривязки"
    : isLinked
    ? (isTrackable ? "Roblox готов" : "Roblox привязан, трекер ждёт обновления")
    : formatRobloxReadinessLabel(canonicalSummary);
  const canShowIdentityMedia = !isSuspicious && (canonicalSummary.identityUsable === true || isTrackable);

  return {
    isLinked,
    isTrackable,
    needsRebind,
    state: isSuspicious ? "suspicious" : trackingState || (isLinked ? "verified" : "unverified"),
    trackingBlocker: isSuspicious ? "suspicious_identity" : cleanString(canonicalSummary.trackingBlocker, 80),
    username: isSuspicious ? null : username,
    userId: isSuspicious ? null : userId,
    label,
    avatarUrl: canShowIdentityMedia ? normalizeMediaUrl(canonicalSummary.avatarUrl, 2000) : null,
    profileUrl: canShowIdentityMedia ? normalizeMediaUrl(canonicalSummary.profileUrl, 2000) : null,
    summary: canonicalSummary,
    statusLine,
    readinessLabel,
  };
}

function formatRobloxReadiness(robloxSummary = {}) {
  return formatRobloxReadinessLabel(robloxSummary);
}

function buildHeroLines({
  userId = "",
  approvedKills = null,
  killTier = null,
  standing = {},
  mainCharacterLabels = [],
  verificationSummary = {},
  robloxSummary = {},
  tierlistSummary = {},
  eloSummary = {},
  activitySummary = {},
  profile = null,
  pendingSubmission = null,
} = {}) {
  const lines = [];
  const progressBits = [];
  if (Number.isFinite(approvedKills)) {
    progressBits.push(`${formatNumber(approvedKills)} kills`);
  }
  if (Number.isFinite(killTier) && killTier > 0) {
    progressBits.push(`тир ${killTier}`);
  }
  if (standing.rank) {
    progressBits.push(`#${standing.rank} по kills`);
  }
  if (progressBits.length) {
    lines.push(`Сейчас: ${progressBits.join(" • ")}`);
  }

  const focusBits = [];
  const mainLabel = (Array.isArray(mainCharacterLabels) ? mainCharacterLabels : [])
    .map((entry) => cleanString(entry, 80))
    .filter(Boolean)
    .slice(0, 2);
  if (mainLabel.length) {
    focusBits.push(`мейны ${mainLabel.join(", ")}`);
  }
  if ((robloxSummary?.isTrackable === true || robloxSummary?.identityUsable === true)
    && cleanString(robloxSummary.currentUsername || robloxSummary.username, 120)) {
    focusBits.push(`Roblox ${cleanString(robloxSummary.currentUsername || robloxSummary.username, 120)}`);
  }
  if (activitySummary.appliedActivityRoleKey || activitySummary.desiredActivityRoleKey) {
    focusBits.push(`активность ${cleanString(activitySummary.appliedActivityRoleKey || activitySummary.desiredActivityRoleKey, 80)}`);
  }
  if (focusBits.length) {
    lines.push(`Фокус: ${focusBits.join(" • ")}`);
  }

  const readinessBits = [];
  readinessBits.push(
    profile?.accessGrantedAt
      ? "JJS доступ открыт"
      : pendingSubmission
        ? "JJS доступ ждёт proof"
        : "JJS доступ не выдан"
  );
  readinessBits.push(`верификация ${cleanString(verificationSummary.status, 80) || "не начата"}`);
  readinessBits.push(formatRobloxReadiness(robloxSummary));
  if (tierlistSummary.hasSubmission === true || tierlistSummary.hasSubmission === false) {
    readinessBits.push(`tierlist ${tierlistSummary.hasSubmission ? "есть" : "пуст"}`);
  }
  if (Number.isFinite(Number(eloSummary.currentElo)) || Number.isFinite(Number(eloSummary.currentTier))) {
    readinessBits.push(`ELO ${formatNumber(eloSummary.currentElo)} / tier ${formatNumber(eloSummary.currentTier)}`);
  }
  lines.push(`Готовность: ${readinessBits.join(" • ")}`);

  if (!lines.length) {
    lines.push(`Игрок: <@${cleanString(userId, 80)}>`);
  }

  return lines;
}

function buildProfileReadModel(options = {}) {
  const userId = cleanString(options.userId, 80);
  const profile = options.profile && typeof options.profile === "object" ? options.profile : null;
  const summary = profile?.summary && typeof profile.summary === "object" ? profile.summary : {};
  const onboardingSummary = summary.onboarding && typeof summary.onboarding === "object" ? summary.onboarding : {};
  const activitySummary = summary.activity && typeof summary.activity === "object" ? summary.activity : {};
  const eloSummary = summary.elo && typeof summary.elo === "object" ? summary.elo : {};
  const tierlistSummary = summary.tierlist && typeof summary.tierlist === "object" ? summary.tierlist : {};
  const rawRobloxSummary = summary.roblox && typeof summary.roblox === "object" ? summary.roblox : {};
  const robloxDisplayState = buildRobloxDisplayState({ profile, summaryRoblox: rawRobloxSummary });
  const robloxSyncHealth = buildRobloxSyncHealth({
    jobState: options.robloxJobState,
    playtimePollMinutes: options.robloxPlaytimePollMinutes,
    now: options.now,
  });
  const robloxSummary = robloxDisplayState.summary;
  const verificationSummary = summary.verification && typeof summary.verification === "object" ? summary.verification : {};
  const progressSummary = summary.progress && typeof summary.progress === "object" ? summary.progress : {};
  const voiceSummary = summary.voice && typeof summary.voice === "object" ? summary.voice : {};
  const supportSummary = summary.support && typeof summary.support === "object" ? summary.support : {};
  const pendingSubmission = options.pendingSubmission && typeof options.pendingSubmission === "object" ? options.pendingSubmission : null;
  const latestSubmission = options.latestSubmission && typeof options.latestSubmission === "object" ? options.latestSubmission : null;
  const approvedEntries = Array.isArray(options.approvedEntries) ? options.approvedEntries : [];
  const populationProfiles = Array.isArray(options.populationProfiles) ? options.populationProfiles : [];
  const characterCatalog = Array.isArray(options.characterCatalog) ? options.characterCatalog : [];
  const recentKillChange = options.recentKillChange && typeof options.recentKillChange === "object" ? options.recentKillChange : null;
  const recentKillChanges = normalizeRecentKillChanges(options.recentKillChanges, recentKillChange, Number.POSITIVE_INFINITY);
  const hiddenRoleIds = normalizeHiddenRoleIds(options.hiddenProfileRoleIds);
  const roleMentions = filterDisplayRoleMentions(options.roleMentions, hiddenRoleIds);
  const displayMode = normalizeProfileDisplayMode(options.displayMode, { isSelf: options.isSelf });
  const derivedMainView = deriveProfileMainView(profile || {}, characterCatalog);
  const mainCharacterIds = derivedMainView.mainCharacterIds;
  const mainCharacterLabels = derivedMainView.mainCharacterLabels;
  const displayName = cleanString(
    options.targetDisplayName
    || summary.preferredDisplayName
    || profile?.displayName
    || profile?.username,
    200
  ) || `User ${userId}`;
  const standing = computeKillStanding(approvedEntries, userId);
  const approvedKills = normalizeNullableFiniteNumber(profile?.approvedKills ?? onboardingSummary.approvedKills);
  const killTier = normalizeNullableFiniteNumber(profile?.killTier ?? onboardingSummary.killTier);
  const comboGuideLinks = buildComboThreadLinks({
    guideState: options.comboGuideState,
    mainCharacterIds,
    mainCharacterLabels,
    guildId: options.guildId,
  });
  const characterWikiLinks = buildCharacterWikiLinks({
    characterCatalog,
    mainCharacterIds,
    mainCharacterLabels,
  });
  const comboLinks = mergeProfileLinks(comboGuideLinks, characterWikiLinks);
  const targetAvatarUrl = normalizeMediaUrl(options.targetAvatarUrl, 2000);
  const robloxUsability = {
    usable: robloxDisplayState.isLinked,
    state: robloxDisplayState.state,
    username: robloxDisplayState.username,
    userId: robloxDisplayState.userId,
  };
  const hasVerifiedRoblox = robloxDisplayState.isLinked;
  const needsRobloxRebind = robloxDisplayState.needsRebind;
  const verifiedRobloxLabel = hasVerifiedRoblox ? cleanString(robloxDisplayState.label, 120) : "";
  const robloxOverviewLabel = robloxDisplayState.state === "suspicious"
    ? "нужна перепривязка"
    : verifiedRobloxLabel
    || (hasVerifiedRoblox ? "привязан, нужно обновить" : "не привязан");
  const robloxAvatarUrl = hasVerifiedRoblox ? robloxDisplayState.avatarUrl : null;
  const robloxProfileUrl = hasVerifiedRoblox ? robloxDisplayState.profileUrl : null;
  const mandatoryLinks = buildMandatoryLinks({
    robloxProfileUrl,
  });
  const verificationAvatarUrl = normalizeMediaUrl(verificationSummary.oauthAvatarUrl, 2000);
  const currentElo = options.eloProfile?.currentElo ?? eloSummary.currentElo;
  const currentEloTier = options.eloProfile?.currentTier ?? eloSummary.currentTier;
  const eloSubmissionStatus = options.eloProfile?.lastSubmissionStatus || eloSummary.lastSubmissionStatus;
  const eloSubmissionId = cleanString(options.eloProfile?.lastSubmissionId || eloSummary.lastSubmissionId, 80);
  const eloSubmissionCreatedAt = options.eloProfile?.lastSubmissionCreatedAt || eloSummary.lastSubmissionCreatedAt || null;
  const eloProofUrl = cleanString(options.eloProfile?.proofUrl || eloSummary.proofUrl, 1000);
  const robloxIdentityHint = cleanString(
    robloxDisplayState.username
      || robloxSummary.currentUsername
      || profile?.domains?.roblox?.username
      || profile?.robloxUsername,
    120
  );
  const selfActionState = {
    hasApprovedKills: Number.isFinite(approvedKills),
    hasMains: mainCharacterLabels.length > 0,
    hasVerifiedRoblox,
    hasElo: Number.isFinite(Number(currentElo)),
    killsLabel: Number.isFinite(approvedKills) ? "Обновить kills" : "Добавить kills",
    mainsLabel: mainCharacterLabels.length ? "Сменить мейнов" : "Выбрать мейнов",
    robloxLabel: hasVerifiedRoblox
      ? (needsRobloxRebind ? "Перепривязать Roblox" : "Обновить Roblox")
      : (needsRobloxRebind ? "Перепривязать Roblox" : (robloxIdentityHint ? "Проверить Roblox" : "Привязать Roblox")),
    eloLabel: Number.isFinite(Number(currentElo)) ? "Обновить ELO" : "ELO: текст + скрин",
  };
  const discordAvatarItem = targetAvatarUrl ? {
    url: targetAvatarUrl,
    description: `Аватар Discord${displayName ? ` • ${displayName}` : ""}`,
  } : null;
  const robloxAvatarItem = robloxAvatarUrl ? {
    url: robloxAvatarUrl,
    description: verifiedRobloxLabel
      ? `Аватар Roblox • ${verifiedRobloxLabel}`
      : "Аватар Roblox",
  } : null;
  const identityMediaItems = [discordAvatarItem, robloxAvatarItem].filter(Boolean);
  const primaryAvatar = [
    {
      url: targetAvatarUrl,
      description: `Аватар Discord${displayName ? ` • ${displayName}` : ""}`,
    },
    {
      url: verificationAvatarUrl,
      description: verificationSummary.oauthUsername
        ? `OAuth-аватар Discord • ${cleanString(verificationSummary.oauthUsername, 120)}`
        : "OAuth-аватар Discord",
    },
    {
      url: robloxAvatarUrl,
      description: verifiedRobloxLabel
        ? `Аватар Roblox • ${verifiedRobloxLabel}`
        : "Аватар Roblox",
    },
  ].find((entry) => entry.url) || null;
  const mediaGalleryItems = [];
  const seenMediaUrls = new Set(primaryAvatar?.url ? [primaryAvatar.url] : []);

  function pushMediaGalleryItem(url, description) {
    const normalizedUrl = normalizeMediaUrl(url, 2000);
    if (!normalizedUrl || seenMediaUrls.has(normalizedUrl)) return;
    seenMediaUrls.add(normalizedUrl);
    mediaGalleryItems.push({
      url: normalizedUrl,
      description: cleanString(description, 200) || "Доп. изображение профиля",
    });
  }

  pushMediaGalleryItem(
    robloxAvatarUrl,
    verifiedRobloxLabel
      ? `Аватар Roblox • ${verifiedRobloxLabel}`
      : "Аватар Roblox"
  );
  pushMediaGalleryItem(
    verificationAvatarUrl,
    verificationSummary.oauthUsername
      ? `OAuth-аватар Discord • ${cleanString(verificationSummary.oauthUsername, 120)}`
      : "OAuth-аватар Discord"
  );

  const overviewLines = [];
  overviewLines.push(`Игрок: <@${userId}>`);
  overviewLines.push(`Роли: ${roleMentions.length ? roleMentions.join(", ") : "—"}`);
  overviewLines.push(`Roblox: ${robloxOverviewLabel}${robloxDisplayState.isLinked && !robloxDisplayState.isTrackable ? " • JJS-трекер ждёт обновления" : ""}`);
  if (!profile && !pendingSubmission && !latestSubmission) {
    overviewLines.push("Профиль ещё не заполнен.");
  }
  overviewLines.push(`Подтверждённые kills: ${Number.isFinite(approvedKills) ? formatNumber(approvedKills) : "—"}`);
  if (Number.isFinite(Number(currentElo)) || Number.isFinite(Number(currentEloTier))) {
    const eloBits = [];
    if (Number.isFinite(Number(currentElo))) {
      eloBits.push(formatNumber(currentElo));
    }
    if (Number.isFinite(Number(currentEloTier))) {
      eloBits.push(`tier ${formatNumber(currentEloTier)}`);
    }
    overviewLines.push(`ELO: ${eloBits.join(" / ")}`);
  } else if (eloSubmissionStatus) {
    overviewLines.push(`ELO: статус ${cleanString(eloSubmissionStatus, 80)}`);
  } else {
    overviewLines.push("ELO: —");
  }

  const synergy = buildProfileSynergyState({
    profile,
    robloxSummary,
    voiceSummary,
    progressSummary,
    supportSummary,
    activitySummary,
    eloSummary,
    tierlistSummary,
    verificationSummary,
    comboLinks,
    approvedEntries,
    populationProfiles,
    approvedKills,
    killTier,
    standing,
    mainCharacterLabels,
    recentKillChanges,
    isSelf: options.isSelf,
    now: options.now,
  });
  const weeklyWindowCount = getProfileWeeklyWindowCount(profile);
  const profileRatingAxes = hasProfileScoreSignals({
    profile,
    approvedKills,
    activitySummary,
    robloxSummary,
    voiceSummary,
    progressSummary,
  }) ? buildProfileRatingLeagues({
      profile,
      activitySummary,
      voiceSummary,
      robloxSummary,
      robloxDisplayState,
      approvedKills,
      standing,
      populationProfiles,
      recentKillChanges,
      currentProfileLabel: displayName,
      now: options.now,
    }) : [];
  const profileRatingSummary = buildProfileRatingSummary({
    axes: profileRatingAxes,
  });
  const ratingDetailCards = buildRatingDetailCards(profileRatingAxes);
  const lockedAxisReasons = Object.fromEntries(profileRatingAxes
    .filter((axis) => axis.isLocked === true)
    .map((axis) => [axis.axisName, axis.lockReason]));
  const profileRatingBlocks = [
    { title: "🔥 Рейтинг профиля", lines: profileRatingSummary.lines },
    ...(profileRatingAxes.length
      ? profileRatingAxes.map((entry) => ({
        title: entry.cardTitle,
        lines: entry.lines,
      }))
      : [{ title: "🔒 Рейтинг закрыт", lines: ["Нужны данные по активности, kills и JJS.", "💡 начни с voice/chat, proof и Roblox/JJS playtime"] }]),
  ];
  const mainStandings = buildMainStandings({
    approvedEntries,
    userId,
    mainCharacterIds,
    mainCharacterLabels,
    characterStats: options.characterStats,
    hiddenRoleIds,
  });
  const activityPlace = buildMetricPlace(activitySummary?.activityScore, collectPopulationActivityScores(populationProfiles));
  const roleShowcaseLines = buildRoleShowcaseLines({
    mainCharacterIds,
    mainCharacterLabels,
    characterStats: options.characterStats,
    mainStandings,
    hiddenRoleIds,
  });

  const defaultHeroLines = buildHeroLines({
    userId,
    approvedKills,
    killTier,
    standing,
    mainCharacterLabels,
    verificationSummary,
    robloxSummary,
    tierlistSummary,
    eloSummary,
    activitySummary,
    profile,
    pendingSubmission,
  });
  const heroTitle = "⚡ Главное";
  const baseHeroLines = Array.isArray(synergy?.blocks?.viewerHero?.lines) && synergy.blocks.viewerHero.lines.length
    ? synergy.blocks.viewerHero.lines
    : defaultHeroLines;
  const trustBadges = buildProfileTrustBadges({
    tierlist: synergy?.viewerTierlist,
    weeklyWindowCount,
    robloxUsability,
    progress: synergy?.progress,
  });
  const heroSummary = buildHeroSummary({
    heroTitle,
    userId,
    displayName,
    trustBadges,
    mainCharacterLabels,
    mainStandings,
    profileRatingSummary,
    verifiedRobloxLabel,
    robloxSummary,
    robloxDisplayState,
    approvedKills,
    standing,
    activitySummary,
    activityPlace,
    proofGap: synergy?.progress?.proofGap,
    robloxSyncHealth,
  });
  const heroLines = heroSummary.lines;

  const overviewStatusLines = buildOverviewStatusLines({
    profile,
    verificationSummary,
    robloxSummary,
    robloxDisplayState,
    pendingSubmission,
  });

  const activityDashboard = buildActivityDashboard({
    activitySummary,
    robloxSummary,
    supportSummary,
    robloxDisplayState,
    robloxSyncHealth,
    populationProfiles,
    synergy,
    progressState: synergy?.progress,
    weeklyWindowCount,
  });

  const contributionLines = [];
  if (Number.isFinite(approvedKills)) {
    contributionLines.push(`Подтверждённые kills: ${formatNumber(approvedKills)}`);
  }
  if (Number.isFinite(killTier) && killTier > 0) {
    contributionLines.push(`Тир по kills: ${killTier}`);
  }
  if (standing.rank) {
    contributionLines.push(`Место по kills: #${standing.rank} из ${formatNumber(standing.totalVerified)}`);
  }
  if (standing.totalKills) {
    contributionLines.push(`Всего kills на сервере: ${formatNumber(standing.totalKills)}`);
  }
  if (standing.shareOfServerKills !== null) {
    contributionLines.push(`Доля серверных kills: ${formatPercent(standing.shareOfServerKills)}`);
  }
  if (!contributionLines.length) {
    contributionLines.push("Подтверждённых kills пока нет.");
  }

  const progressHistoryLines = [];
  if (recentKillChanges.length) {
    const latestKillChange = recentKillChanges[0];
    const recentSummary = summarizeRecentKillChange(latestKillChange);
    progressHistoryLines.push(`Последний proof-срез: ${formatNumber(latestKillChange.from)} -> ${formatNumber(latestKillChange.to)}`);
    progressHistoryLines.push(`Прирост: ${formatSignedNumber(recentSummary.delta)} kills за ${formatNumber(recentSummary.dayCount)} дн.`);
    progressHistoryLines.push(`Темп: ${formatNumber(recentSummary.averagePerDay)} kills/день`);
    if (latestKillChange.fromAt) {
      progressHistoryLines.push(`Старт среза: ${formatDateTime(latestKillChange.fromAt)}`);
    }
    if (latestKillChange.toAt) {
      progressHistoryLines.push(`Финиш среза: ${formatDateTime(latestKillChange.toAt)}`);
      progressHistoryLines.push(`С прошлого proof-среза: ${formatDurationDaysSince(latestKillChange.toAt)}`);
    }
  } else {
    progressHistoryLines.push("Свежей истории роста по kills пока нет.");
  }

  const progressTimelineLines = buildRecentKillHistoryLines(recentKillChanges);

  const submissionLines = [];
  if (latestSubmission?.reviewedAt) {
    submissionLines.push(`Последняя проверка: ${formatDateTime(latestSubmission.reviewedAt)}`);
  } else if (latestSubmission?.createdAt) {
    submissionLines.push(`Последняя заявка: ${formatDateTime(latestSubmission.createdAt)}`);
  }
  if (pendingSubmission) {
    submissionLines.push(`Ожидающий proof: ${formatNumber(pendingSubmission.kills)} kills`);
    submissionLines.push(`Отправлена: ${formatDateTime(pendingSubmission.createdAt)}`);
  }
  if (!submissionLines.length) {
    submissionLines.push("Сейчас нет активных заявок или свежих проверок.");
  }

  const rankingLines = [];
  const tierlistMainName = options.tierlistProfile?.mainName || tierlistSummary.mainName;
  const tierlistLockUntil = options.tierlistProfile?.lockUntil || tierlistSummary.lockUntil;
  const tierlistInfluence = options.tierlistProfile?.influenceMultiplier ?? tierlistSummary.influenceMultiplier;

  if (Number.isFinite(Number(currentElo)) || Number.isFinite(Number(currentEloTier))) {
    rankingLines.push(`Текущий рейтинг: ELO ${formatNumber(currentElo)} / tier ${formatNumber(currentEloTier)}`);
  }
  if (Number.isFinite(Number(options.eloProfile?.currentElo ?? eloSummary.currentElo))) {
    rankingLines.push(`ELO: ${formatNumber(options.eloProfile?.currentElo ?? eloSummary.currentElo)}`);
  }
  if (Number.isFinite(Number(options.eloProfile?.currentTier ?? eloSummary.currentTier))) {
    rankingLines.push(`ELO tier: ${formatNumber(options.eloProfile?.currentTier ?? eloSummary.currentTier)}`);
  }
  if (eloSubmissionStatus) {
    rankingLines.push(`Статус ELO submit: ${cleanString(eloSubmissionStatus, 80)}`);
  }
  if (eloSubmissionId) {
    rankingLines.push(`ID ELO заявки: ${eloSubmissionId}`);
  }
  if (eloSubmissionCreatedAt) {
    rankingLines.push(`Последний ELO submit: ${formatDateTime(eloSubmissionCreatedAt)}`);
  }
  if (eloProofUrl) {
    rankingLines.push(`Скрин ELO: ${eloProofUrl}`);
  }
  if (tierlistMainName) {
    rankingLines.push(`Основной tierlist-пик: ${cleanString(tierlistMainName, 120)}`);
  }
  if (tierlistLockUntil) {
    rankingLines.push(`Tierlist lock до: ${formatDateTime(tierlistLockUntil)}`);
  }
  if (Number.isFinite(Number(tierlistInfluence)) && Number(tierlistInfluence) !== 1) {
    rankingLines.push(`Множитель влияния: x${Number(tierlistInfluence).toFixed(2)}`);
  }
  if (tierlistSummary.hasSubmission === true || tierlistSummary.hasSubmission === false) {
    rankingLines.push(`Tierlist-заявка: ${tierlistSummary.hasSubmission ? "есть" : "нет"}`);
  }
  if (!rankingLines.length) {
    rankingLines.push("ELO и tierlist данные пока не заполнены.");
  }

  const robloxLines = [];
  if (hasVerifiedRoblox) {
    robloxLines.push(robloxDisplayState.statusLine);
    robloxLines.push(`Аккаунт: ${verifiedRobloxLabel || "нужно обновить привязку"}`);
  } else if (robloxDisplayState.state === "suspicious") {
    robloxLines.push("Roblox-связка требует перепривязки: старые данные похожи на Discord-ник.");
  } else if (robloxDisplayState.state === "repairable") {
    robloxLines.push("Roblox привязан, но нужно обновить userId.");
  } else if (robloxDisplayState.state === "manual_only") {
    robloxLines.push("Roblox привязан, но не хватает полного аккаунта.");
  } else if (robloxSummary.verificationStatus) {
    robloxLines.push(`Связка Roblox: ${cleanString(robloxSummary.verificationStatus, 80)}`);
  } else {
    robloxLines.push("Связка Roblox ещё не подтверждена.");
  }
  if (hasVerifiedRoblox) {
    if (robloxProfileUrl) {
      robloxLines.push("Профиль Roblox: доступен по кнопке ниже");
    }
    if (robloxSummary.currentDisplayName
      && cleanString(robloxSummary.currentDisplayName, 120) !== cleanString(robloxSummary.currentUsername, 120)) {
      robloxLines.push(`Display в Roblox: ${cleanString(robloxSummary.currentDisplayName, 120)}`);
    }
    if (robloxSummary.previousUsername) {
      robloxLines.push(`Прошлый username Roblox: ${cleanString(robloxSummary.previousUsername, 120)}`);
    }
    if (robloxSummary.previousDisplayName) {
      robloxLines.push(`Прошлый display в Roblox: ${cleanString(robloxSummary.previousDisplayName, 120)}`);
    }
    if (Number.isFinite(Number(robloxSummary.renameCount)) && Number(robloxSummary.renameCount) > 0) {
      robloxLines.push(`Смен username Roblox: ${formatNumber(robloxSummary.renameCount)}`);
    }
    if (Number.isFinite(Number(robloxSummary.displayRenameCount)) && Number(robloxSummary.displayRenameCount) > 0) {
      robloxLines.push(`Смен display-name Roblox: ${formatNumber(robloxSummary.displayRenameCount)}`);
    }
    if (robloxSummary.lastRenameSeenAt) {
      robloxLines.push(`Последний rename Roblox: ${formatDateTime(robloxSummary.lastRenameSeenAt)}`);
    }
    if (robloxSummary.hasVerifiedBadge === true) {
      robloxLines.push("Есть Roblox verified badge");
    }
    if (robloxSummary.accountStatus) {
      robloxLines.push(`Статус аккаунта: ${cleanString(robloxSummary.accountStatus, 80)}`);
    }
    if (Number.isFinite(Number(robloxSummary.serverFriendsCount))) {
      robloxLines.push(`Друзья на сервере: ${formatNumber(robloxSummary.serverFriendsCount)}`);
    }
    if (robloxDisplayState.isTrackable && Number.isFinite(Number(robloxSummary.jjsMinutes7d))) {
      robloxLines.push(`JJS 7д: ${formatJjsHoursFromMinutes(robloxSummary.jjsMinutes7d)}`);
    }
    if (robloxDisplayState.isTrackable && Number.isFinite(Number(robloxSummary.jjsMinutes30d))) {
      robloxLines.push(`JJS 30д: ${formatJjsHoursFromMinutes(robloxSummary.jjsMinutes30d)}`);
    }
    if (robloxDisplayState.isTrackable && Number.isFinite(Number(robloxSummary.totalJjsMinutes))) {
      robloxLines.push(`JJS всего: ${formatJjsHoursFromMinutes(robloxSummary.totalJjsMinutes)}`);
    }
    if (Number.isFinite(Number(robloxSummary.frequentNonFriendCount))) {
      robloxLines.push(`Частые non-friend: ${formatNumber(robloxSummary.frequentNonFriendCount)}`);
    }
    if (Number.isFinite(Number(robloxSummary.nonFriendPeerCount))) {
      robloxLines.push(`Всего non-friend peers: ${formatNumber(robloxSummary.nonFriendPeerCount)}`);
    }
    if (robloxDisplayState.isTrackable && Number.isFinite(Number(robloxSummary.sessionCount))) {
      robloxLines.push(`JJS сессий всего: ${formatNumber(robloxSummary.sessionCount)}`);
    }
    if (robloxDisplayState.isTrackable && robloxSummary.currentSessionStartedAt) {
      robloxLines.push(`Текущая JJS сессия с: ${formatDateTime(robloxSummary.currentSessionStartedAt)}`);
    }
    if (robloxDisplayState.isTrackable && robloxSummary.lastSeenInJjsAt) {
      robloxLines.push(`Последний JJS online: ${formatDateTime(robloxSummary.lastSeenInJjsAt)}`);
    }
    if (robloxSummary.lastRefreshAt) {
      robloxLines.push(`Последнее обновление: ${formatDateTime(robloxSummary.lastRefreshAt)}`);
    }
    if (robloxSummary.refreshError) {
      robloxLines.push("Обновление Roblox сломалось.");
    }
  }

  const socialPeerLines = buildTopCoPlayPeerLines(robloxSummary.topCoPlayPeers, 3);
  const hiddenSectionReasons = {
    season: weeklyWindowCount >= 3
      ? ""
      : `Сезон откроется после 3 недель истории (${formatNumber(weeklyWindowCount)}/3).`,
    voiceGameOverlap: isSparseProfileBlock(synergy?.blocks?.voiceGameOverlap)
      ? "Voice + JJS откроется после пересечений в voice и игре."
      : "",
    socialMap: isSparseProfileBlock(synergy?.blocks?.socialMap)
      ? "Социальная карта откроется после устойчивых связей."
      : "",
  };
  const activityModeBlocks = [
    ...includeProfileBlock(synergy?.blocks?.primeTimeConfidence, 2),
  ];
  const seasonBlocks = weeklyWindowCount >= 3
    ? [
      ...includeProfileBlock(synergy?.blocks?.bestPeriods, 3),
      ...includeProfileBlock(synergy?.blocks?.weeklyRollups, 3),
      ...includeProfileBlock(synergy?.blocks?.seasonConsistency, 3),
      ...includeProfileBlock(synergy?.blocks?.comebackMetrics, 3),
    ]
    : [{ title: "🏆 Сезон", lines: [hiddenSectionReasons.season] }];
  const socialBlocks = [
    ...includeProfileBlock(synergy?.blocks?.friendOverlap, 3),
    ...includeProfileBlock(synergy?.blocks?.friendsAlreadyHere, 3),
    ...includeProfileBlock(synergy?.blocks?.socialEvolution, 2),
    ...(isSparseProfileBlock({ title: "🎮 С кем чаще всего играет", lines: socialPeerLines })
      ? []
      : [{ title: "🎮 С кем чаще всего играет", lines: socialPeerLines.slice(0, 3) }]),
    ...includeProfileBlock(synergy?.blocks?.socialSuggestions, 2),
    ...includeProfileBlock(synergy?.blocks?.verifiedCircle, 3),
    ...includeProfileBlock(synergy?.blocks?.socialMap, 3),
    ...includeProfileBlock(synergy?.blocks?.voiceGameOverlap, 3),
  ];
  const proofGapBlock = buildProfileProofGapBlock(synergy?.progress?.proofGap);
  const progressDashboard = buildProgressDashboard({
    profile,
    approvedKills,
    standing,
    profileRatingAxes,
    recentKillChanges,
    latestSubmission,
    pendingSubmission,
    proofGapBlock,
    synergy,
  });
  const compactMainStanding = mainStandings.find((entry) => entry.available);
  const compactModeLine = (activityDashboard.summaryLines || []).find((line) => /JJS|Chat|Voice/.test(line))
    || "Активность откроется после JJS, чата или voice.";
  const compactCardLines = [
    hasProfileRatingScore(profileRatingSummary.score)
      ? `🔥 Рейтинг ${profileRatingSummary.grade} · ${formatProfileRatingScore(profileRatingSummary.score)}/100`
      : `🔥 Рейтинг профиля откроется после данных`,
    compactMainStanding
      ? `Main: ${formatMainStandingShort(compactMainStanding)}`
      : `Мейны: ${mainCharacterLabels.length ? mainCharacterLabels.join(", ") : "—"}`,
    standing.rank
      ? `Kills #${formatNumber(standing.rank)}/${formatNumber(standing.totalVerified)} · Roblox ${robloxOverviewLabel}`
      : `Kills ${Number.isFinite(approvedKills) ? formatNumber(approvedKills) : "—"} · Roblox ${robloxOverviewLabel}`,
    compactModeLine,
  ];

  const compactSections = [
    { title: displayMode === "compact-card" && Boolean(options.isSelf) ? "Моя карточка" : "Карточка", lines: compactCardLines },
  ];

  const sections = {
    overview: [
      ...profileRatingBlocks,
      { title: "📊 Сводка активности", lines: activityDashboard.summaryLines.slice(0, 4) },
    ],
    activity: [
      ...activityDashboard.blocks,
      ...activityModeBlocks,
      ...seasonBlocks,
    ],
    progress: [
      ...progressDashboard.blocks,
      ...(synergy?.blocks?.antiteamSupport ? [synergy.blocks.antiteamSupport] : []),
    ],
    social: [
      { title: "🚧 Соц-карта", lines: ["Соц-карта в разработке: связи показываются только там, где есть проверяемые сигналы."] },
      { title: "🤝 Roblox и соц", lines: robloxLines.slice(0, 5) },
      ...socialBlocks,
    ],
    compact: compactSections,
  };
  const sectionGroups = buildSectionGroups(sections);
  const surfaceState = !profile && !pendingSubmission && !latestSubmission
    ? "empty"
    : (needsRobloxRebind ? "degraded" : (trustBadges.some((badge) => badge.state === "unavailable") ? "partial" : "rich"));

  return {
    userId,
    displayName,
    isSelf: Boolean(options.isSelf),
    displayMode,
    comboLinks,
    heroTitle,
    heroLines,
    heroSummary,
    identityPreview: {
      discordAvatarUrl: targetAvatarUrl,
      robloxAvatarUrl,
      robloxStatus: robloxDisplayState.isTrackable ? "Roblox готов" : robloxDisplayState.readinessLabel,
    },
    identityMediaItems,
    profileRatingSummary,
    profileRatingAxes,
    ratingDetailCards,
    ratingDashboard: {
      summary: profileRatingSummary,
      axes: profileRatingAxes,
      leagueCards: profileRatingAxes,
      detailCards: ratingDetailCards,
      lockedAxisReasons,
    },
    activityDashboard,
    progressDashboard,
    weeklyRatingState: {
      weeklyWindowCount,
      stabilityOpen: weeklyWindowCount >= 3,
    },
    roleShowcaseLines,
    mainStandings,
    hiddenSectionReasons,
    lockedAxisReasons,
    mandatoryLinks,
    trustBadges,
    surfaceState,
    componentBudget: PROFILE_COMPONENT_BUDGET,
    primaryAvatarUrl: primaryAvatar?.url || null,
    primaryAvatarDescription: primaryAvatar?.description || null,
    mediaGalleryItems,
    robloxProfileUrl,
    robloxDisplayState,
    robloxSyncHealth,
    selfActionState,
    sections,
    sectionGroups,
    verificationLines: verificationSummary.status && verificationSummary.status !== "not_started"
      ? [
        `Статус: ${cleanString(verificationSummary.status, 80)}`,
        verificationSummary.decision && verificationSummary.decision !== "none"
          ? `Решение: ${cleanString(verificationSummary.decision, 80)}`
          : "",
        verificationSummary.reportDueAt ? `Дедлайн: ${formatDateTime(verificationSummary.reportDueAt)}` : "",
        verificationSummary.reviewedAt ? `Проверено: ${formatDateTime(verificationSummary.reviewedAt)}` : "",
        verificationSummary.lastError ? `Ошибка: ${cleanString(verificationSummary.lastError, 180)}` : "",
      ]
      : null,
    emptyStateNote: !profile && !pendingSubmission && !latestSubmission
      ? "Полных данных пока нет. После онбординга профиль заполнится автоматически."
      : null,
  };
}

module.exports = {
  buildProfileReadModel,
};
