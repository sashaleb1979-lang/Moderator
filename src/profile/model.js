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

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

const PROFILE_DISPLAY_MODES = Object.freeze(["viewer", "self", "compact-card"]);
const DEFAULT_HIDDEN_PROFILE_ROLE_IDS = Object.freeze(["1146511958305144883"]);
const JJS_WIKI_CHARACTERS_URL = "https://jujutsu-shenanigans.fandom.com/wiki/Characters";
const PROFILE_RATING_AXES = Object.freeze(["form", "chat", "kills", "stability", "growth", "social"]);
const PROFILE_RATING_CONFIDENCE_MULTIPLIERS = Object.freeze({
  reliable: 1,
  partial: 0.85,
  heuristic: 0.65,
  outdated: 0.35,
  unavailable: 0,
});
const PROFILE_RATING_AXIS_LABELS = Object.freeze({
  form: { emoji: "🏃", label: "Форма" },
  chat: { emoji: "💬", label: "Общение" },
  kills: { emoji: "⚔️", label: "Килы" },
  stability: { emoji: "🛡️", label: "Стабильность" },
  growth: { emoji: "📈", label: "Рост" },
  social: { emoji: "🤝", label: "Связи" },
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
    { title: "⚡ Главное", tone: "summary", density: "compact", titles: ["⚡ Главное", "🔥 Оценка профиля"] },
    { title: "🎭 Мейны", tone: "dossier", density: "normal", titles: ["🎭 Мейны и места"] },
    { title: "🧩 Ядро", tone: "dossier", density: "compact", titles: ["Main Core", "🧩 Ядро профиля"] },
  ],
  activity: [
    { title: "📊 Итог", tone: "summary", density: "compact", titles: ["📊 Итог активности", "Activity mix", "Voice-срез"] },
    { title: "🧭 Режим", tone: "dossier", density: "normal", titles: ["Farm profile", "Prime time МСК", "Prime time confidence"] },
    { title: "🏆 Сезон", tone: "dossier", density: "normal", titles: ["Лучшие периоды", "Weekly rollups", "Season consistency", "Comeback metrics"] },
  ],
  progress: [
    { title: "⚔️ Рост и proof", tone: "summary", density: "normal", titles: ["Практический прогресс", "🏅 Вклад", "📈 Последний рост по kills", "Proof gap", "🧾 Proof"] },
    { title: "📜 История и рейтинги", tone: "dossier", density: "dense", titles: ["🧾 История approved ростов", "📬 Заявки и проверки", "📊 ELO и Tierlist", "Antiteam support"] },
  ],
  social: [
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
  maxSectionTextDisplays: 5,
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
  const approvedKills = Number(currentEntry?.approvedKills);
  const shareOfServerKills = Number.isFinite(approvedKills) && totalKills > 0
    ? (approvedKills / totalKills) * 100
    : null;

  return {
    rank: index >= 0 ? index + 1 : null,
    totalVerified: ranked.length,
    totalKills,
    shareOfServerKills,
  };
}

function getAxisConfidenceMultiplier(axis = {}) {
  const key = cleanString(axis?.confidenceState, 40).toLowerCase();
  return PROFILE_RATING_CONFIDENCE_MULTIPLIERS[key] ?? PROFILE_RATING_CONFIDENCE_MULTIPLIERS.heuristic;
}

function getAxisInfluenceMultiplier(axis = {}) {
  const debuff = Math.max(0, Math.min(100, normalizeFiniteNumber(axis?.influenceDebuffPercent, 0)));
  return 1 - (debuff / 100);
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

function buildProfileRatingAxisEntries(tierlist = null) {
  return PROFILE_RATING_AXES.map((axisName) => {
    const axis = tierlist?.[axisName];
    const score = normalizeFiniteNumber(axis?.score);
    if (!Number.isFinite(score)) return null;
    const meta = PROFILE_RATING_AXIS_LABELS[axisName] || { emoji: "▫️", label: axisName };
    const confidenceState = cleanString(axis?.confidenceState, 40) || "heuristic";
    const debuffPercent = Math.max(0, Math.min(100, normalizeFiniteNumber(axis?.influenceDebuffPercent, 0)));
    const confidenceMultiplier = getAxisConfidenceMultiplier(axis);
    const influenceMultiplier = getAxisInfluenceMultiplier(axis);
    const effectiveWeightPercent = Math.round(confidenceMultiplier * influenceMultiplier * 100);
    const scoreContributionPercent = Math.round(score * confidenceMultiplier * influenceMultiplier) / 100;
    const place = axis?.place && typeof axis.place === "object" ? axis.place : {};
    return {
      axisName,
      ...meta,
      grade: cleanString(axis?.grade, 10) || "N/A",
      score,
      confidenceState,
      debuffPercent,
      confidenceMultiplier,
      influenceMultiplier,
      effectiveWeightPercent,
      scoreContributionPercent,
      place: {
        rank: normalizeNullableFiniteNumber(place.rank),
        total: normalizeNullableFiniteNumber(place.total),
      },
      isHistoricalFallback: axis?.isHistoricalFallback === true,
      dataAgeDays: normalizeNullableFiniteNumber(axis?.dataAgeDays),
    };
  }).filter(Boolean);
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

function buildProfileScoreAxes(tierlist = null) {
  return buildProfileRatingAxisEntries(tierlist)
    .filter((entry) => (
      Number.isFinite(Number(entry.score))
        && cleanString(entry.grade, 10)
        && entry.grade !== "N/A"
        && normalizeTrustState(entry.confidenceState, "partial") !== "unavailable"
    ));
}

function formatProfileAxisRank(axis = {}) {
  const rank = normalizeNullableFiniteNumber(axis?.place?.rank);
  const total = normalizeNullableFiniteNumber(axis?.place?.total);
  return Number.isFinite(rank) && Number.isFinite(total) && total > 0
    ? ` #${formatNumber(rank)}/${formatNumber(total)}`
    : "";
}

function getProfileAxisSourceLabel(axis = {}) {
  const age = normalizeNullableFiniteNumber(axis.dataAgeDays);
  if (axis.isHistoricalFallback === true) {
    return Number.isFinite(age) ? `архив ${formatNumber(age)}д` : "архив";
  }
  const labels = {
    form: "live 30д",
    chat: "чат 30д",
    kills: "proof",
    stability: "сезон",
    growth: "рост",
    social: "связи",
  };
  return labels[axis.axisName] || "текущий расчёт";
}

function formatProfileRatingAxisLine(axis = {}) {
  const weight = Math.max(0, Math.min(100, normalizeFiniteNumber(axis.effectiveWeightPercent, 0)));
  return `${axis.label} ${axis.grade}${formatProfileAxisRank(axis)} · ${getProfileAxisSourceLabel(axis)} · учёт ${formatNumber(weight)}% ${buildStatBar(weight, 5)}`;
}

function buildProfileMiniRadarLine(axes = []) {
  const items = (Array.isArray(axes) ? axes : [])
    .slice()
    .sort((left, right) => right.score - left.score)
    .slice(0, 4)
    .map((axis) => `${axis.label} ${buildScoreBar(axis.score, 4)}`);
  return items.length ? `Радар: ${items.join(" · ")}` : "";
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

function buildProfileRatingSummary({ axes = [] } = {}) {
  const availableAxes = Array.isArray(axes) ? axes : [];
  const weightSum = availableAxes.reduce((sum, axis) => sum + Math.max(0, normalizeFiniteNumber(axis.effectiveWeightPercent, 0)), 0);
  const score = weightSum > 0
    ? availableAxes.reduce((sum, axis) => sum + (Number(axis.score) * Math.max(0, normalizeFiniteNumber(axis.effectiveWeightPercent, 0))), 0) / weightSum
    : null;
  const grade = Number.isFinite(Number(score)) ? buildProfileGrade(score) : "N/A";
  const strongestAxis = availableAxes.slice().sort((left, right) => right.score - left.score)[0] || null;
  const radarLine = buildProfileMiniRadarLine(availableAxes);
  const hiddenAxisCount = Math.max(0, PROFILE_RATING_AXES.length - availableAxes.length);
  const liveWeightPercent = Math.round(Math.max(0, Math.min(100, weightSum / PROFILE_RATING_AXES.length)));
  const place = resolveProfileRatingPlace(availableAxes);
  const lines = [
    Number.isFinite(score)
      ? `Рейтинг профиля: ${grade} · ${formatProfileRatingScore(score)}/100${formatProfileRatingRank(place)}`
      : "Рейтинг профиля откроется после активности, proof и связей.",
    availableAxes.length ? `Учёт данных: ${formatNumber(liveWeightPercent)}% ${buildStatBar(liveWeightPercent, 6)}` : "",
    radarLine,
  ].filter(Boolean);
  if (strongestAxis) {
    lines.push(`Сильная сторона: ${strongestAxis.label} ${strongestAxis.grade} · ${formatProfileRatingScore(strongestAxis.score)}/100`);
  }
  if (hiddenAxisCount > 0) {
    lines.push(`Часть рейтинга откроется после активности, proof и связей: ${formatNumber(hiddenAxisCount)}/${formatNumber(PROFILE_RATING_AXES.length)}.`);
  }

  return {
    grade,
    score,
    rank: place.rank,
    total: place.total,
    liveWeightPercent,
    axisCount: availableAxes.length,
    hiddenAxisCount,
    strongestAxis,
    radarLine,
    lines,
  };
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
  trustBadges = [],
  mainCharacterLabels = [],
  mainStandings = [],
  profileRatingSummary = null,
  verifiedRobloxLabel = "",
  robloxSummary = {},
  robloxDisplayState = null,
  approvedKills = null,
  standing = {},
  activitySummary = {},
  activityPlace = {},
  proofGap = null,
  robloxSyncHealth = null,
} = {}) {
  const mainLabel = (Array.isArray(mainCharacterLabels) ? mainCharacterLabels : [])
    .map((entry) => cleanString(entry, 80))
    .filter(Boolean)
    .slice(0, 2)
    .join(", ") || "мейны не выбраны";
  const activityRole = cleanString(activitySummary?.appliedActivityRoleKey || activitySummary?.desiredActivityRoleKey, 80) || "роль не накоплена";
  const killPlace = Number.isFinite(Number(standing?.rank)) && Number(standing.rank) > 0
    && Number.isFinite(Number(standing?.totalVerified)) && Number(standing.totalVerified) > 0
    ? `kills #${formatNumber(standing.rank)}/${formatNumber(standing.totalVerified)}`
    : "";
  const activityPlaceText = formatPlace(activityPlace);
  const activityText = activityPlaceText !== "N/A"
    ? `активность ${activityPlaceText}`
    : `активность ${activityRole}`;
  const mainStandingText = (Array.isArray(mainStandings) ? mainStandings : [])
    .filter((entry) => entry?.available)
    .slice(0, 1)
    .map(formatMainStandingShort)[0] || "";
  const robloxStatus = verifiedRobloxLabel
    ? `Roblox ${verifiedRobloxLabel}`
    : (robloxDisplayState?.readinessLabel || formatRobloxReadiness(robloxSummary));
  const killText = Number.isFinite(approvedKills) ? `${formatNumber(approvedKills)} kills` : "kills ждут proof";
  const scoreGrade = cleanString(profileRatingSummary?.grade, 10) || "N/A";
  const scoreValue = formatProfileRatingScore(profileRatingSummary?.score);
  const ratingRank = formatProfileRatingRank(profileRatingSummary);
  const warningLine = (() => {
    if (robloxSyncHealth?.critical && robloxSyncHealth?.line) {
      return `⚠️ ${cleanString(robloxSyncHealth.line, 180)}`;
    }
    if (robloxDisplayState?.isLinked && !robloxDisplayState?.isTrackable) {
      return "⚠️ Roblox привязан, но JJS-активность не обновляется.";
    }
    if (proofGap && Number(proofGap.influenceDebuffPercent) >= 55) {
      return "⚠️ Proof отстал: килы и рост учитываются слабее.";
    }
    if (Number(profileRatingSummary?.axisCount) === 0) {
      return "⚠️ Рейтинг откроется после активности, proof и связей.";
    }
    if (Number(profileRatingSummary?.axisCount) > 0 && Number(profileRatingSummary.axisCount) < 3) {
      return "⚠️ Рейтинг станет точнее после активности, proof и связей.";
    }
    return "";
  })();
  const identityText = [
    cleanString(displayName, 80) || (userId ? `<@${userId}>` : "Игрок"),
    robloxStatus,
    `Main: ${mainLabel}`,
  ].filter(Boolean).join(" · ");
  const placesText = [
    killPlace || killText,
    activityText,
    mainStandingText,
  ].filter(Boolean).join(" · ");

  return {
    title: heroTitle,
    lines: [
      `👤 ${identityText}`,
      hasProfileRatingScore(profileRatingSummary?.score)
        ? `🔥 Рейтинг ${scoreGrade} · ${scoreValue}/100${ratingRank}`
        : "🔥 Рейтинг профиля откроется после данных",
      placesText ? `🏆 Места: ${placesText}` : `🏆 ${killText} · ${activityRole}`,
      warningLine,
    ].filter(Boolean),
    state: (trustBadges || []).some((badge) => badge.state === "outdated") ? "degraded" : "rich",
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
  const parts = [];
  if (standing.roleMention) parts.push(standing.roleMention);
  if (standing.available) {
    const placePower = Number(standing.total) > 0
      ? ((Number(standing.total) - Number(standing.rank) + 1) / Number(standing.total)) * 100
      : 0;
    parts.push(`#${formatNumber(standing.rank)}/${formatNumber(standing.total)} среди ${label}-main ${buildStatBar(placePower, 4)}`);
    if (standing.isLeader) {
      parts.push("👑 лидер мейна");
    } else if (Number.isFinite(Number(standing.killsToNext)) && Number.isFinite(Number(standing.nextRank))) {
      parts.push(`до апа: +${formatNumber(standing.killsToNext)} kills до #${formatNumber(standing.nextRank)}`);
    }
  }
  return `${label}: ${parts.length ? parts.join(" · ") : "место откроется после рейтинга мейнов"}`;
}

function formatMainStandingShort(standing = {}) {
  if (!standing?.available) return cleanString(standing?.label, 80);
  const label = cleanString(standing.label, 80);
  const place = `${label} #${formatNumber(standing.rank)}/${formatNumber(standing.total)}`;
  if (standing.isLeader) return `${place} лидер`;
  if (Number.isFinite(Number(standing.killsToNext)) && Number.isFinite(Number(standing.nextRank))) {
    return `${place} (+${formatNumber(standing.killsToNext)} до #${formatNumber(standing.nextRank)})`;
  }
  return place;
}

function buildRoleShowcaseLines({
  mainCharacterIds = [],
  mainCharacterLabels = [],
  characterStats = [],
  mainStandings = [],
  activitySummary = {},
  populationProfiles = [],
  killTier = null,
  standing = {},
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

  const activityRole = cleanString(activitySummary?.appliedActivityRoleKey || activitySummary?.desiredActivityRoleKey, 80);
  const activityPlace = buildMetricPlace(activitySummary?.activityScore, collectPopulationActivityScores(populationProfiles));
  const activityBits = [activityRole || "роль ещё не накоплена"];
  const activityPlaceText = formatPlace(activityPlace);
  if (activityPlaceText !== "N/A") activityBits.push(`${activityPlaceText} по активности`);
  lines.push(`⚡ Активность: ${activityBits.join(" · ")}`);

  const killPlace = { rank: standing?.rank, total: standing?.totalVerified };
  const killBits = [];
  if (Number.isFinite(Number(killTier))) killBits.push(`tier ${formatNumber(killTier)}`);
  const killPlaceText = formatPlace(killPlace);
  if (killPlaceText !== "N/A") killBits.push(`${killPlaceText} по kills`);
  lines.push(`⚔️ Kill-role: ${killBits.length ? killBits.join(" · ") : "откроется после proof"}`);

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
  const normalizedLimit = Math.max(1, Number(limit) || 3);
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
    list.push({ from, to, fromAt, toAt });
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
  const recentKillChanges = normalizeRecentKillChanges(options.recentKillChanges, recentKillChange, 3);
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
  }) ? buildProfileScoreAxes(synergy?.viewerTierlist) : [];
  const profileRatingSummary = buildProfileRatingSummary({
    axes: profileRatingAxes,
  });
  const profileRatingLines = [
    ...profileRatingSummary.lines,
    ...(profileRatingAxes.length
      ? profileRatingAxes.map((entry) => formatProfileRatingAxisLine(entry))
      : ["Оценка профиля откроется после данных по активности, proof и связям."]),
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
    activitySummary,
    populationProfiles,
    killTier,
    standing,
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

  const activityLines = [];
  const rawActivityVoiceHours30d = Number.isFinite(Number(activitySummary.voiceDurationSeconds30d))
    ? Number(activitySummary.voiceDurationSeconds30d) / 3600
    : null;
  const rawVoiceMirrorHours30d = Number.isFinite(Number(voiceSummary.voiceDurationSeconds30d))
    ? Number(voiceSummary.voiceDurationSeconds30d) / 3600
    : null;
  const rawVoiceHours30d = Number.isFinite(rawActivityVoiceHours30d) ? rawActivityVoiceHours30d : rawVoiceMirrorHours30d;
  const jjsHours30d = Number.isFinite(Number(robloxSummary.jjsMinutes30d)) ? Number(robloxSummary.jjsMinutes30d) / 60 : null;
  const chatMessages30d = normalizeNullableFiniteNumber(activitySummary.messages30d);
  const voiceHours30d = Number.isFinite(rawVoiceHours30d)
    ? rawVoiceHours30d
    : normalizeNullableFiniteNumber(activitySummary.effectiveVoiceHours30d);
  const modeParts = [];
  if (Number.isFinite(jjsHours30d) || Number.isFinite(Number(robloxSummary.jjsMinutes7d))) {
    const jjsBits = [];
    if (Number.isFinite(Number(robloxSummary.jjsMinutes7d))) jjsBits.push(`${formatJjsHoursFromMinutes(robloxSummary.jjsMinutes7d)}/7д`);
    if (Number.isFinite(Number(robloxSummary.jjsMinutes30d))) jjsBits.push(`${formatJjsHoursFromMinutes(robloxSummary.jjsMinutes30d)}/30д`);
    modeParts.push(`JJS ${jjsBits.join(" · ")}`);
  }
  if (Number.isFinite(chatMessages30d)) modeParts.push(`чат ${formatNumber(chatMessages30d)} msg`);
  if (Number.isFinite(voiceHours30d)) {
    const effectiveVoiceHours30d = normalizeNullableFiniteNumber(activitySummary.effectiveVoiceHours30d);
    const voiceCreditSuffix = Number.isFinite(effectiveVoiceHours30d) && Math.abs(effectiveVoiceHours30d - voiceHours30d) >= 0.2
      ? ` · учёт ${formatHours(effectiveVoiceHours30d)} ч`
      : "";
    modeParts.push(`voice ${formatHours(voiceHours30d)} ч${voiceCreditSuffix}`);
  }
  const dominantActivity = [
    { label: "JJS", value: Number.isFinite(jjsHours30d) ? jjsHours30d : -1 },
    { label: "Discord chat", value: Number.isFinite(chatMessages30d) ? chatMessages30d / 30 : -1 },
    { label: "voice", value: Number.isFinite(voiceHours30d) ? voiceHours30d : -1 },
  ].sort((left, right) => right.value - left.value)[0];
  activityLines.push(robloxDisplayState.state === "suspicious"
    ? "Статус: Roblox требует перепривязки"
    : robloxDisplayState.isLinked
      ? (robloxDisplayState.isTrackable ? "Статус: Roblox/JJS трекается" : "Статус: Roblox привязан, JJS не обновляется")
      : "Статус: Roblox не привязан");
  if (robloxDisplayState.isTrackable && robloxSyncHealth?.critical && robloxSyncHealth?.line) {
    activityLines.push(robloxSyncHealth.line);
  }
  if (modeParts.length) {
    const totalMix = [jjsHours30d, Number.isFinite(chatMessages30d) ? chatMessages30d / 30 : null, voiceHours30d]
      .filter((entry) => Number.isFinite(Number(entry)) && Number(entry) > 0)
      .reduce((sum, entry) => sum + Number(entry), 0);
    const mixBar = totalMix > 0
      ? [
        `JJS ${buildStatBar((Number.isFinite(jjsHours30d) ? jjsHours30d : 0) / totalMix * 100, 3)}`,
        `чат ${buildStatBar((Number.isFinite(chatMessages30d) ? chatMessages30d / 30 : 0) / totalMix * 100, 3)}`,
        `voice ${buildStatBar((Number.isFinite(voiceHours30d) ? voiceHours30d : 0) / totalMix * 100, 3)}`,
      ].join(" · ")
      : "";
    activityLines.push(`Режим: ${modeParts.join(" · ")}${dominantActivity?.value >= 0 ? ` → больше ${dominantActivity.label}` : ""}`);
    if (mixBar) activityLines.push(`Микс: ${mixBar}`);
  } else {
    activityLines.push("Режим откроется после JJS, чата или voice.");
  }
  const activityBits = [];
  const activityRole = cleanString(activitySummary.appliedActivityRoleKey || activitySummary.desiredActivityRoleKey, 80);
  if (activityRole) activityBits.push(activityRole);
  if (Number.isFinite(Number(activitySummary.activityScore))) activityBits.push(`score ${formatNumber(activitySummary.activityScore)}`);
  const activityPlaceText = formatPlace(activityPlace);
  if (activityPlaceText !== "N/A") activityBits.push(`${activityPlaceText} среди активных`);
  if (Number.isFinite(Number(activitySummary.activeDays30d))) activityBits.push(`${formatNumber(activitySummary.activeDays30d)} активных дней`);
  if (activityBits.length) activityLines.push(`Активность: ${activityBits.join(" · ")}`);

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
    if (Number.isFinite(Number(robloxSummary.jjsMinutes7d))) {
      robloxLines.push(`JJS 7д: ${formatJjsHoursFromMinutes(robloxSummary.jjsMinutes7d)}`);
    }
    if (Number.isFinite(Number(robloxSummary.jjsMinutes30d))) {
      robloxLines.push(`JJS 30д: ${formatJjsHoursFromMinutes(robloxSummary.jjsMinutes30d)}`);
    }
    if (Number.isFinite(Number(robloxSummary.totalJjsMinutes))) {
      robloxLines.push(`JJS всего: ${formatJjsHoursFromMinutes(robloxSummary.totalJjsMinutes)}`);
    }
    if (Number.isFinite(Number(robloxSummary.frequentNonFriendCount))) {
      robloxLines.push(`Частые non-friend: ${formatNumber(robloxSummary.frequentNonFriendCount)}`);
    }
    if (Number.isFinite(Number(robloxSummary.nonFriendPeerCount))) {
      robloxLines.push(`Всего non-friend peers: ${formatNumber(robloxSummary.nonFriendPeerCount)}`);
    }
    if (Number.isFinite(Number(robloxSummary.sessionCount))) {
      robloxLines.push(`JJS сессий всего: ${formatNumber(robloxSummary.sessionCount)}`);
    }
    if (robloxSummary.currentSessionStartedAt) {
      robloxLines.push(`Текущая JJS сессия с: ${formatDateTime(robloxSummary.currentSessionStartedAt)}`);
    }
    if (robloxSummary.lastSeenInJjsAt) {
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
    ...includeProfileBlock(synergy?.blocks?.activityMix, 2),
    ...includeProfileBlock(synergy?.blocks?.farmProfile, 2),
    ...includeProfileBlock(synergy?.blocks?.primeTime, 2),
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
  const compactMainStanding = mainStandings.find((entry) => entry.available);
  const compactModeLine = activityLines.find((line) => /^Режим:/.test(line)) || "Режим откроется после JJS, чата или voice.";
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
      { title: "⚡ Главное", lines: overviewLines.slice(0, 4) },
      { title: "🔥 Оценка профиля", lines: profileRatingLines },
      { title: "🎭 Мейны и места", lines: roleShowcaseLines },
      ...(synergy?.blocks?.viewerMainCore ? [synergy.blocks.viewerMainCore] : []),
    ],
    activity: [
      { title: "📊 Итог активности", lines: activityLines.slice(0, 4) },
      ...activityModeBlocks,
      ...seasonBlocks,
    ],
    progress: [
      ...(synergy?.blocks?.selfProgress ? [synergy.blocks.selfProgress] : []),
      { title: "🏅 Вклад", lines: contributionLines },
      { title: "📈 Последний рост по kills", lines: progressHistoryLines },
      { title: "🧾 История approved ростов", lines: progressTimelineLines },
      { title: "📬 Заявки и проверки", lines: submissionLines },
      { title: "📊 ELO и Tierlist", lines: rankingLines },
      ...(synergy?.blocks?.antiteamSupport ? [synergy.blocks.antiteamSupport] : []),
      ...(proofGapBlock ? [proofGapBlock] : []),
    ],
    social: [
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
    identityMediaItems,
    profileRatingSummary,
    profileRatingAxes,
    roleShowcaseLines,
    mainStandings,
    hiddenSectionReasons,
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
