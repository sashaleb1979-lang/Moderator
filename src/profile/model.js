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
  resolveUsableVerifiedRobloxIdentity,
} = require("../integrations/shared-profile");

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

const PROFILE_DISPLAY_MODES = Object.freeze(["viewer", "self", "compact-card"]);
const DEFAULT_HIDDEN_PROFILE_ROLE_IDS = Object.freeze(["1146511958305144883"]);
const JJS_WIKI_CHARACTERS_URL = "https://jujutsu-shenanigans.fandom.com/wiki/Characters";
const PROFILE_LEVEL_AXES = Object.freeze(["form", "chat", "kills", "stability", "growth", "social"]);
const PROFILE_LEVEL_CONFIDENCE_MULTIPLIERS = Object.freeze({
  reliable: 1,
  partial: 0.85,
  heuristic: 0.65,
  outdated: 0.35,
  unavailable: 0,
});
const PROFILE_LEVEL_AXIS_LABELS = Object.freeze({
  form: { emoji: "🏃", label: "Форма" },
  chat: { emoji: "💬", label: "Чат" },
  kills: { emoji: "⚔️", label: "Килы" },
  stability: { emoji: "🛡️", label: "Стабильность" },
  growth: { emoji: "📈", label: "Развитие" },
  social: { emoji: "🤝", label: "Соц" },
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
    { title: "⚡ Главное", tone: "summary", density: "compact", titles: ["✨ Обзор", "🧬 Уровень профиля", "🎭 Роли и места"] },
    { title: "🧩 Сила", tone: "dossier", density: "normal", titles: ["Буквы и места", "Main Core", "📚 Мейны"] },
  ],
  activity: [
    { title: "📊 Итог", tone: "summary", density: "compact", titles: ["📊 Итог активности", "Activity mix", "Voice-срез"] },
    { title: "🧭 Режим", tone: "dossier", density: "normal", titles: ["Farm profile", "Prime time МСК", "Prime time confidence"] },
    { title: "🏆 Сезон", tone: "dossier", density: "normal", titles: ["Лучшие периоды", "Weekly rollups", "Season consistency", "Comeback metrics"] },
  ],
  progress: [
    { title: "⚔️ Рост и proof", tone: "summary", density: "normal", titles: ["Практический прогресс", "🏅 Вклад", "📈 Последний рост по kills", "Proof gap"] },
    { title: "📜 История и рейтинги", tone: "dossier", density: "dense", titles: ["🧾 История approved ростов", "📬 Заявки и проверки", "📊 ELO и Tierlist", "Antiteam support"] },
  ],
  social: [
    { title: "✅ Проверенные связи", tone: "summary", density: "normal", titles: ["🤝 Roblox и соц", "Проверенный круг", "Roblox-друзья на сервере", "Кто из друзей уже здесь"] },
    { title: "🗺️ Социальная карта", tone: "dossier", density: "normal", titles: ["Социальная карта", "Voice + game overlap", "🎮 С кем чаще всего играет", "Скрытый круг"] },
    { title: "🎭 Main dossier", tone: "dossier", density: "compact", titles: ["📚 Мейны и гайды", "Социальная эволюция"] },
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
  if (/Обзор|Уровень|Роли|Main Core|Буквы|Готовность|Activity mix|Proof gap|Практический/.test(title)) return 10;
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
  return PROFILE_LEVEL_CONFIDENCE_MULTIPLIERS[key] ?? PROFILE_LEVEL_CONFIDENCE_MULTIPLIERS.heuristic;
}

function getAxisInfluenceMultiplier(axis = {}) {
  const debuff = Math.max(0, Math.min(100, normalizeFiniteNumber(axis?.influenceDebuffPercent, 0)));
  return 1 - (debuff / 100);
}

function calculateProfileLevel(totalXp = 0) {
  let remainingXp = Math.max(0, Math.round(Number(totalXp) || 0));
  let level = 1;
  let nextLevelXp = 800 + (180 * level) + Math.floor(35 * (level ** 1.35));

  while (remainingXp >= nextLevelXp) {
    remainingXp -= nextLevelXp;
    level += 1;
    nextLevelXp = 800 + (180 * level) + Math.floor(35 * (level ** 1.35));
  }

  return {
    level,
    currentLevelXp: remainingXp,
    nextLevelXp,
    nextLevel: level + 1,
  };
}

function buildProfileLevelState({ tierlist = null, profile = null } = {}) {
  const axes = PROFILE_LEVEL_AXES.map((axisName) => tierlist?.[axisName]).filter(Boolean);
  const letterXp = Math.round(axes.reduce((sum, axis) => {
    const score = normalizeFiniteNumber(axis?.score);
    if (!Number.isFinite(score)) return sum;
    return sum + (score * getAxisConfidenceMultiplier(axis) * getAxisInfluenceMultiplier(axis) * 100);
  }, 0));
  const weeklyRollups = Array.isArray(profile?.domains?.seasonArchive?.weeklyRollups)
    ? profile.domains.seasonArchive.weeklyRollups
    : [];
  const weeklyXp = Math.round(weeklyRollups.reduce((sum, rollup) => {
    const score = normalizeFiniteNumber(rollup?.composite?.score);
    if (!Number.isFinite(score)) return sum;
    const coveragePercent = normalizeFiniteNumber(rollup?.coverage?.coveragePercent, 100);
    const coverageMultiplier = Math.max(0, Math.min(100, coveragePercent)) / 100;
    return sum + (score * coverageMultiplier * 35);
  }, 0));
  const totalXp = Math.max(0, letterXp + weeklyXp);
  const levelState = calculateProfileLevel(totalXp);
  const progressPercent = levelState.nextLevelXp > 0
    ? (levelState.currentLevelXp / levelState.nextLevelXp) * 100
    : 0;

  return {
    ...levelState,
    totalXp,
    letterXp,
    weeklyXp,
    axisCount: axes.length,
    weeklyWindowCount: weeklyRollups.length,
    progressPercent,
  };
}

function buildXpBar(percent = 0, size = 8) {
  const normalizedSize = Math.max(4, Number(size) || 8);
  const filled = Math.max(0, Math.min(normalizedSize, Math.round((Math.max(0, Math.min(100, Number(percent) || 0)) / 100) * normalizedSize)));
  return `${"▰".repeat(filled)}${"▱".repeat(normalizedSize - filled)}`;
}

function buildScoreBar(score = 0, size = 5) {
  return buildXpBar(Math.max(0, Math.min(100, Number(score) || 0)), size);
}

function formatProfileLevelLine(levelState = {}) {
  return [
    `🧬 Ур. ${formatNumber(levelState.level)}`,
    buildXpBar(levelState.progressPercent),
    `${formatNumber(levelState.currentLevelXp)}/${formatNumber(levelState.nextLevelXp)} XP до ${formatNumber(levelState.nextLevel)}`,
  ].join(" ");
}

function formatProfileLevelSourceLine(levelState = {}) {
  return `📚 XP: буквы ${formatNumber(levelState.letterXp)} • недели ${formatNumber(levelState.weeklyXp)} • всего ${formatNumber(levelState.totalXp)}`;
}

function buildProfileLevelAxisEntries(tierlist = null) {
  return PROFILE_LEVEL_AXES.map((axisName) => {
    const axis = tierlist?.[axisName];
    const score = normalizeFiniteNumber(axis?.score);
    if (!Number.isFinite(score)) return null;
    const meta = PROFILE_LEVEL_AXIS_LABELS[axisName] || { emoji: "▫️", label: axisName };
    const confidenceState = cleanString(axis?.confidenceState, 40) || "heuristic";
    const debuffPercent = Math.max(0, Math.min(100, normalizeFiniteNumber(axis?.influenceDebuffPercent, 0)));
    const adjustedXp = Math.round(score * getAxisConfidenceMultiplier(axis) * getAxisInfluenceMultiplier(axis) * 100);
    return {
      axisName,
      ...meta,
      grade: cleanString(axis?.grade, 10) || "N/A",
      score,
      confidenceState,
      debuffPercent,
      adjustedXp,
      isHistoricalFallback: axis?.isHistoricalFallback === true,
      dataAgeDays: normalizeNullableFiniteNumber(axis?.dataAgeDays),
    };
  }).filter(Boolean);
}

function formatLevelAxis(entry = {}) {
  return `${entry.emoji} ${entry.label} ${entry.grade} ${buildScoreBar(entry.score)} ${formatNumber(entry.score)}`;
}

function buildProfileLevelLines({ levelState = {}, tierlist = null } = {}) {
  const lines = [
    formatProfileLevelLine(levelState),
    formatProfileLevelSourceLine(levelState),
  ];
  const axes = buildProfileLevelAxisEntries(tierlist);
  if (!axes.length) {
    lines.push("Буквы пока не набрали достаточно сигналов для XP-разбора.");
    return lines;
  }

  const strongest = axes.slice().sort((left, right) => right.adjustedXp - left.adjustedXp)[0];
  const weakest = axes.slice().sort((left, right) => left.score - right.score)[0];
  const currentCount = axes.filter((entry) => entry.isHistoricalFallback !== true).length;
  const historicalCount = axes.filter((entry) => entry.isHistoricalFallback === true).length;
  const maxDebuff = axes.reduce((max, entry) => Math.max(max, entry.debuffPercent), 0);

  lines.push(`Сильнее всего даёт XP: ${formatLevelAxis(strongest)} • +${formatNumber(strongest.adjustedXp)} XP`);
  lines.push(`Где тоньше: ${formatLevelAxis(weakest)} • оценка ${formatNumber(weakest.score)}`);
  lines.push(`Буквы: ${axes.map((entry) => formatLevelAxis(entry)).join(" • ")}`);
  lines.push(
    [
      "Вес букв",
      `текущий расчёт ${formatNumber(currentCount)}/${formatNumber(axes.length)}`,
      historicalCount ? `старые данные ${formatNumber(historicalCount)}` : "",
      maxDebuff > 0 ? `макс. вес -${formatNumber(maxDebuff)}%` : "без штрафа веса",
      `недель ${formatNumber(levelState.weeklyWindowCount)}`,
    ].filter(Boolean).join(" • ")
  );
  return lines;
}

function buildTierlistBadgeLine(tierlist = null) {
  const parts = PROFILE_LEVEL_AXES
    .map((axisName) => {
      const axis = tierlist?.[axisName];
      const meta = PROFILE_LEVEL_AXIS_LABELS[axisName] || { label: axisName };
      const grade = cleanString(axis?.grade, 10);
      if (!grade || grade === "N/A") return `${meta.label} нет базы`;
      const debuff = normalizeFiniteNumber(axis?.influenceDebuffPercent, 0);
      const age = normalizeNullableFiniteNumber(axis?.dataAgeDays);
      const suffix = axis?.isHistoricalFallback === true && Number.isFinite(age)
        ? `данные ${formatNumber(age)}д назад`
        : "текущий расчёт";
      const weight = debuff > 0 ? `, вес -${formatNumber(debuff)}%` : "";
      return `${meta.label} ${grade} (${suffix}${weight})`;
    })
    .filter(Boolean);
  return parts.length ? `🏷️ Буквы: ${parts.join(" • ")}` : "🏷️ Буквы: нет базы";
}

function buildProfileTrustBadges({ tierlist = null, levelState = {}, robloxUsability = {}, progress = null } = {}) {
  const axes = PROFILE_LEVEL_AXES.map((axisName) => tierlist?.[axisName]).filter(Boolean);
  const reliableAxes = axes.filter((axis) => normalizeTrustState(axis?.confidenceState || axis?.freshnessState) === "reliable").length;
  const unavailableAxes = axes.filter((axis) => normalizeTrustState(axis?.confidenceState || axis?.freshnessState) === "unavailable").length;
  const proofState = progress?.proofGap?.freshnessState || progress?.proofGap?.confidenceState || "unavailable";
  return [
    {
      key: "letters",
      label: "Буквы",
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
      state: Number(levelState.weeklyWindowCount) >= 3 ? "reliable" : (Number(levelState.weeklyWindowCount) > 0 ? "partial" : "unavailable"),
      text: Number(levelState.weeklyWindowCount) > 0 ? `${formatNumber(levelState.weeklyWindowCount)} окон` : "нет базы",
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
  heroTitle = "Кто ты сейчас",
  baseHeroLines = [],
  levelState = {},
  tierlist = null,
  trustBadges = [],
  mainCharacterLabels = [],
  verifiedRobloxLabel = "",
  robloxSummary = {},
  robloxDisplayState = null,
  approvedKills = null,
  standing = {},
  activitySummary = {},
} = {}) {
  const mainLabel = (Array.isArray(mainCharacterLabels) ? mainCharacterLabels : [])
    .map((entry) => cleanString(entry, 80))
    .filter(Boolean)
    .slice(0, 2)
    .join(", ") || "мейны не выбраны";
  const activityRole = cleanString(activitySummary?.appliedActivityRoleKey || activitySummary?.desiredActivityRoleKey, 80) || "роль не накоплена";
  const killPlace = Number.isFinite(Number(standing?.rank)) && Number.isFinite(Number(standing?.totalVerified))
    ? `#${formatNumber(standing.rank)}/${formatNumber(standing.totalVerified)} по kills`
    : "место по kills ждёт базу";
  const robloxStatus = verifiedRobloxLabel
    ? `Roblox ${verifiedRobloxLabel}`
    : (robloxDisplayState?.readinessLabel || formatRobloxReadiness(robloxSummary));
  const killText = Number.isFinite(approvedKills) ? `${formatNumber(approvedKills)} kills` : "kills ждут proof";

  return {
    title: heroTitle,
    lines: [
      formatProfileLevelLine(levelState),
      formatProfileLevelSourceLine(levelState),
      buildTierlistBadgeLine(tierlist),
      `🎭 Main: ${mainLabel} • ${robloxStatus}`,
      `🏆 ${killText} • ${killPlace} • активность ${activityRole}`,
      ...((Array.isArray(baseHeroLines) ? baseHeroLines : []).slice(0, 1)),
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

function buildRoleShowcaseLines({
  mainCharacterIds = [],
  mainCharacterLabels = [],
  characterStats = [],
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
      const stat = findCharacterStat({ id: main.id, label: main.label, stats: normalizedStats });
      const role = stat?.roleId && !hiddenRoleIds.has(stat.roleId) ? `<@&${stat.roleId}>` : main.label;
      lines.push(`🎭 ${main.label}: ${role} • место ${formatPlace(stat ? { rank: stat.rank, total: stat.total } : {})} по мейнам`);
    }
  } else {
    lines.push("🎭 Мейны: место N/A • персонажи ещё не выбраны");
  }

  const activityRole = cleanString(activitySummary?.appliedActivityRoleKey || activitySummary?.desiredActivityRoleKey, 80);
  const activityPlace = buildMetricPlace(activitySummary?.activityScore, collectPopulationActivityScores(populationProfiles));
  lines.push(`⚡ Активность: ${activityRole || "роль N/A"} • место ${formatPlace(activityPlace)} по activity score`);

  const killPlace = { rank: standing?.rank, total: standing?.totalVerified };
  lines.push(`⚔️ Kill-role: ${Number.isFinite(Number(killTier)) ? `tier ${formatNumber(killTier)}` : "tier N/A"} • место ${formatPlace(killPlace)} по kills`);

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

function computeGuideCoverage(mainCharacterLabels = [], comboLinks = []) {
  const mains = (Array.isArray(mainCharacterLabels) ? mainCharacterLabels : [])
    .map((entry) => cleanString(entry, 80))
    .filter(Boolean);
  const coveredMainGuideKeys = new Set(
    (Array.isArray(comboLinks) ? comboLinks : [])
      .filter((entry) => entry?.kind === "main")
      .map((entry) => normalizeComboLookupKey(entry?.mainLabel || entry?.label))
      .filter(Boolean)
  );
  const coveredMainWikiKeys = new Set(
    (Array.isArray(comboLinks) ? comboLinks : [])
      .filter((entry) => entry?.kind === "wiki")
      .map((entry) => normalizeComboLookupKey(entry?.mainLabel || entry?.label))
      .filter(Boolean)
  );

  return {
    mainCount: mains.length,
    coveredMainCount: mains.filter((entry) => coveredMainGuideKeys.has(normalizeComboLookupKey(entry))).length,
    coveredMainWikiCount: mains.filter((entry) => coveredMainWikiKeys.has(normalizeComboLookupKey(entry))).length,
    hasGeneralGuide: (Array.isArray(comboLinks) ? comboLinks : []).some((entry) => entry?.kind === "general"),
  };
}

function buildMainAndGuideLines({
  mainCharacterIds = [],
  mainCharacterLabels = [],
  comboLinks = [],
  characterStats = [],
  hiddenRoleIds = new Set(),
  tierlistMainName = "",
  accessGrantedAt = null,
  nonGgsAccessGrantedAt = null,
} = {}) {
  const lines = [];
  const mains = (Array.isArray(mainCharacterLabels) ? mainCharacterLabels : [])
    .map((entry) => cleanString(entry, 80))
    .filter(Boolean);
  const mainLookup = new Set(mains.map((entry) => normalizeComboLookupKey(entry)));
  const guideCoverage = computeGuideCoverage(mainCharacterLabels, comboLinks);
  const mainGuideLookup = new Set(
    (Array.isArray(comboLinks) ? comboLinks : [])
      .filter((entry) => entry?.kind === "main")
      .map((entry) => normalizeComboLookupKey(entry?.mainLabel || entry?.label))
      .filter(Boolean)
  );
  const mainWikiLookup = new Set(
    (Array.isArray(comboLinks) ? comboLinks : [])
      .filter((entry) => entry?.kind === "wiki")
      .map((entry) => normalizeComboLookupKey(entry?.mainLabel || entry?.label))
      .filter(Boolean)
  );
  const normalizedStats = normalizeCharacterStats(characterStats);

  if (mains.length) {
    lines.push(`Основные персонажи: ${mains.join(", ")}`);
    lines.push(`Гайды по мейнам: ${guideCoverage.coveredMainCount}/${mains.length}`);
    if (guideCoverage.coveredMainWikiCount) {
      lines.push(`JJS wiki по мейнам: ${guideCoverage.coveredMainWikiCount}/${mains.length}`);
    }
    for (let index = 0; index < mains.length; index += 1) {
      const mainLabel = mains[index];
      const mainId = Array.isArray(mainCharacterIds) ? mainCharacterIds[index] : "";
      const stat = findCharacterStat({ id: mainId, label: mainLabel, stats: normalizedStats });
      const guideBits = [
        mainGuideLookup.has(normalizeComboLookupKey(mainLabel)) ? "гайд доступен по кнопке" : "гайд пока не привязан",
      ];
      if (mainWikiLookup.has(normalizeComboLookupKey(mainLabel))) {
        guideBits.push("JJS wiki доступна по кнопке");
      }
      if (stat?.roleId && !hiddenRoleIds.has(stat.roleId)) {
        guideBits.push(`роль <@&${stat.roleId}>`);
      }
      if (stat) {
        guideBits.push(`место ${formatPlace({ rank: stat.rank, total: stat.total })} по мейнам`);
      }
      lines.push(`${index + 1}. ${mainLabel} — ${guideBits.join(" • ")}`);
    }
  } else {
    lines.push("Мейны пока не указаны.");
  }

  const normalizedTierlistMainName = cleanString(tierlistMainName, 120);
  if (normalizedTierlistMainName) {
    lines.push(
      `Основной tierlist-пик: ${normalizedTierlistMainName}${mainLookup.has(normalizeComboLookupKey(normalizedTierlistMainName)) ? " • входит в список мейнов" : ""}`
    );
  }

  if (guideCoverage.hasGeneralGuide) {
    lines.push("Общие техи: доступны по кнопке.");
  } else if (mains.length) {
    lines.push("Общие техи пока не привязаны.");
  }

  if (accessGrantedAt) {
    lines.push(`JJS доступ: ${formatDateTime(accessGrantedAt)}`);
  }
  if (nonGgsAccessGrantedAt) {
    lines.push(`Non-JJS доступ: ${formatDateTime(nonGgsAccessGrantedAt)}`);
  }

  return lines;
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
  const trackingState = cleanString(canonicalSummary.trackingState, 40);
  const isLinked = canonicalSummary.hasVerifiedAccount === true;
  const isTrackable = canonicalSummary.isTrackable === true;
  const needsRebind = isLinked && !isTrackable && ["repairable", "manual_only"].includes(trackingState);
  const username = cleanString(canonicalSummary.currentUsername || canonicalSummary.username, 120);
  const userId = cleanString(canonicalSummary.userId, 80);
  const label = canonicalSummary.identityUsable === true || isTrackable
    ? (username || userId)
    : "";
  const statusLine = isLinked
    ? (isTrackable
      ? "Roblox-связка: подтверждена"
      : "Roblox привязан, JJS-активность не обновляется")
    : formatRobloxBindingStatusLine(profile || canonicalSummary);
  const readinessLabel = isLinked
    ? (isTrackable ? "Roblox готов" : "Roblox привязан, трекер ждёт обновления")
    : formatRobloxReadinessLabel(canonicalSummary);
  const canShowIdentityMedia = canonicalSummary.identityUsable === true || isTrackable;

  return {
    isLinked,
    isTrackable,
    needsRebind,
    state: trackingState || (isLinked ? "verified" : "unverified"),
    trackingBlocker: cleanString(canonicalSummary.trackingBlocker, 80),
    username,
    userId,
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
  const robloxOverviewLabel = verifiedRobloxLabel
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
  if (!profile && !pendingSubmission && !latestSubmission) {
    overviewLines.push("Профиль ещё не заполнен.");
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
  const profileLevelState = buildProfileLevelState({
    tierlist: synergy?.viewerTierlist,
    profile,
  });
  const profileLevelLines = buildProfileLevelLines({
    levelState: profileLevelState,
    tierlist: synergy?.viewerTierlist,
  });
  const roleShowcaseLines = buildRoleShowcaseLines({
    mainCharacterIds,
    mainCharacterLabels,
    characterStats: options.characterStats,
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
  const heroTitle = cleanString(synergy?.blocks?.viewerHero?.title, 120) || "Быстрый статус";
  const baseHeroLines = Array.isArray(synergy?.blocks?.viewerHero?.lines) && synergy.blocks.viewerHero.lines.length
    ? synergy.blocks.viewerHero.lines
    : defaultHeroLines;
  const trustBadges = buildProfileTrustBadges({
    tierlist: synergy?.viewerTierlist,
    levelState: profileLevelState,
    robloxUsability,
    progress: synergy?.progress,
  });
  const heroSummary = buildHeroSummary({
    heroTitle,
    baseHeroLines,
    levelState: profileLevelState,
    tierlist: synergy?.viewerTierlist,
    trustBadges,
    mainCharacterLabels,
    verifiedRobloxLabel,
    robloxSummary,
    robloxDisplayState,
    approvedKills,
    standing,
    activitySummary,
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
  const rawVoiceHours30d = Number.isFinite(Number(voiceSummary.voiceDurationSeconds30d))
    ? Number(voiceSummary.voiceDurationSeconds30d) / 3600
    : null;
  activityLines.push(robloxDisplayState.isLinked
    ? (robloxDisplayState.isTrackable ? "Roblox/JJS: трекается" : "Roblox привязан, JJS-активность не обновляется")
    : "Roblox/JJS: нет привязки");
  if (activitySummary.appliedActivityRoleKey || activitySummary.desiredActivityRoleKey) {
    activityLines.push(`Роль активности: ${cleanString(activitySummary.appliedActivityRoleKey || activitySummary.desiredActivityRoleKey, 80)}`);
  }
  if (Number.isFinite(Number(activitySummary.activityScore))) {
    activityLines.push(`Счёт активности: ${formatNumber(activitySummary.activityScore)}`);
  }
  if (Number.isFinite(Number(robloxSummary.jjsMinutes7d)) || Number.isFinite(Number(robloxSummary.jjsMinutes30d))) {
    activityLines.push(`JJS: ${formatJjsHoursFromMinutes(robloxSummary.jjsMinutes7d)} за 7д • ${formatJjsHoursFromMinutes(robloxSummary.jjsMinutes30d)} за 30д`);
  }
  if (Number.isFinite(Number(activitySummary.messages7d)) || Number.isFinite(Number(activitySummary.messages30d))) {
    activityLines.push(`Чат: ${formatNumber(activitySummary.messages7d)} msg за 7д • ${formatNumber(activitySummary.messages30d)} за 30д`);
  }
  if (Number.isFinite(Number(activitySummary.sessions7d)) || Number.isFinite(Number(activitySummary.sessions30d))) {
    activityLines.push(`Discord-сессии: ${formatNumber(activitySummary.sessions7d)} за 7д • ${formatNumber(activitySummary.sessions30d)} за 30д`);
  }
  if (Number.isFinite(Number(activitySummary.activeDays30d))) {
    activityLines.push(`Активные дни 30д: ${formatNumber(activitySummary.activeDays30d)}`);
  }
  if (Number.isFinite(rawVoiceHours30d) || Number.isFinite(Number(activitySummary.effectiveVoiceHours30d))) {
    activityLines.push(`Voice: ${formatHours(rawVoiceHours30d)} ч за 30д • активный вес ${formatHours(activitySummary.effectiveVoiceHours30d)} ч`);
  }
  if (Number.isFinite(Number(activitySummary.effectiveActiveVoiceSignalHours30d)) || Number.isFinite(Number(activitySummary.effectiveVoiceDays30d))) {
    activityLines.push(`Активный voice: ${formatHours(activitySummary.effectiveActiveVoiceSignalHours30d)} ч • ${formatHours(activitySummary.effectiveVoiceDays30d)} активных дней`);
  }
  if (Number.isFinite(Number(activitySummary.voiceEngagementRatio30d))
    || Number.isFinite(Number(activitySummary.voiceEngagementMultiplier))
    || Number.isFinite(Number(activitySummary.voicePart))
    || Number.isFinite(Number(activitySummary.activeVoicePart))) {
    activityLines.push(
      `Voice-вклад: ${formatPercent(Number(activitySummary.voiceEngagementRatio30d) * 100)} • x${formatHours(activitySummary.voiceEngagementMultiplier, 2)} • ${formatHours(activitySummary.voicePart)} + ${formatHours(activitySummary.activeVoicePart)}`
    );
  }
  if (Number.isFinite(Number(activitySummary.daysSinceGuildJoin))) {
    activityLines.push(`На сервере: ${formatNumber(Math.round(Number(activitySummary.daysSinceGuildJoin)))} дн.`);
  }
  if (activitySummary.lastSeenAt) {
    activityLines.push(`Последняя активность: ${formatDateTime(activitySummary.lastSeenAt)}`);
  }

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

  const mainAndGuideLines = buildMainAndGuideLines({
    mainCharacterIds,
    mainCharacterLabels,
    comboLinks,
    characterStats: options.characterStats,
    hiddenRoleIds,
    tierlistMainName: tierlistSummary.mainName,
    accessGrantedAt: profile?.accessGrantedAt,
    nonGgsAccessGrantedAt: profile?.nonGgsAccessGrantedAt,
  });

  const socialPeerLines = buildTopCoPlayPeerLines(robloxSummary.topCoPlayPeers, 3);
  const compactCardLines = [
    `Игрок: <@${userId}>`,
    `Roblox: ${robloxOverviewLabel}`,
    `Kills: ${Number.isFinite(approvedKills) ? formatNumber(approvedKills) : "—"}`,
    Number.isFinite(Number(currentElo)) || Number.isFinite(Number(currentEloTier))
      ? `ELO: ${[Number.isFinite(Number(currentElo)) ? formatNumber(currentElo) : "", Number.isFinite(Number(currentEloTier)) ? `tier ${formatNumber(currentEloTier)}` : ""].filter(Boolean).join(" / ")}`
      : (eloSubmissionStatus ? `ELO: статус ${cleanString(eloSubmissionStatus, 80)}` : "ELO: —"),
    `Мейны: ${mainCharacterLabels.length ? mainCharacterLabels.join(", ") : "—"}`,
  ];

  const compactSections = [
    { title: displayMode === "compact-card" && Boolean(options.isSelf) ? "Моя карточка" : "Карточка", lines: compactCardLines },
    { title: "Готовность", lines: overviewStatusLines },
  ];

  if (Number.isFinite(Number(currentElo)) || Number.isFinite(Number(currentEloTier)) || eloSubmissionStatus || tierlistSummary.hasSubmission === true || tierlistSummary.hasSubmission === false) {
    compactSections.push({ title: "ELO и Tierlist", lines: rankingLines });
  }

  if (hasVerifiedRoblox || robloxSummary.verificationStatus) {
    compactSections.push({
      title: "Roblox и соц",
      lines: robloxLines.slice(0, 6),
    });
  }

  const sections = {
    overview: [
      { title: "✨ Обзор", lines: overviewLines },
      { title: "🧬 Уровень профиля", lines: profileLevelLines },
      { title: "🎭 Роли и места", lines: roleShowcaseLines },
      ...(synergy?.blocks?.viewerLetterPlaces ? [synergy.blocks.viewerLetterPlaces] : []),
      ...(synergy?.blocks?.viewerMainCore ? [synergy.blocks.viewerMainCore] : []),
      { title: "📚 Мейны", lines: mainAndGuideLines.slice(0, 5) },
    ],
    activity: [
      { title: "📊 Итог активности", lines: activityLines.slice(0, 8) },
      ...(synergy?.blocks?.activityMix ? [synergy.blocks.activityMix] : []),
      ...(synergy?.blocks?.voiceSummary ? [synergy.blocks.voiceSummary] : []),
      ...(synergy?.blocks?.farmProfile ? [synergy.blocks.farmProfile] : []),
      ...(synergy?.blocks?.primeTime ? [synergy.blocks.primeTime] : []),
      ...(synergy?.blocks?.primeTimeConfidence ? [synergy.blocks.primeTimeConfidence] : []),
      ...(synergy?.blocks?.bestPeriods ? [synergy.blocks.bestPeriods] : []),
      ...(synergy?.blocks?.weeklyRollups ? [synergy.blocks.weeklyRollups] : []),
      ...(synergy?.blocks?.seasonConsistency ? [synergy.blocks.seasonConsistency] : []),
      ...(synergy?.blocks?.comebackMetrics ? [synergy.blocks.comebackMetrics] : []),
    ],
    progress: [
      ...(synergy?.blocks?.selfProgress ? [synergy.blocks.selfProgress] : []),
      { title: "🏅 Вклад", lines: contributionLines },
      { title: "📈 Последний рост по kills", lines: progressHistoryLines },
      { title: "🧾 История approved ростов", lines: progressTimelineLines },
      { title: "📬 Заявки и проверки", lines: submissionLines },
      { title: "📊 ELO и Tierlist", lines: rankingLines },
      ...(synergy?.blocks?.antiteamSupport ? [synergy.blocks.antiteamSupport] : []),
      ...(synergy?.blocks?.proofGap ? [synergy.blocks.proofGap] : []),
    ],
    social: [
      { title: "🤝 Roblox и соц", lines: robloxLines },
      ...(synergy?.blocks?.friendOverlap ? [synergy.blocks.friendOverlap] : []),
      ...(synergy?.blocks?.friendsAlreadyHere ? [synergy.blocks.friendsAlreadyHere] : []),
      ...(synergy?.blocks?.socialEvolution ? [synergy.blocks.socialEvolution] : []),
      { title: "🎮 С кем чаще всего играет", lines: socialPeerLines },
      ...(synergy?.blocks?.socialSuggestions ? [synergy.blocks.socialSuggestions] : []),
      { title: "📚 Мейны и гайды", lines: mainAndGuideLines },
      ...(synergy?.blocks?.verifiedCircle ? [synergy.blocks.verifiedCircle] : []),
      ...(synergy?.blocks?.socialMap ? [synergy.blocks.socialMap] : []),
      ...(synergy?.blocks?.voiceGameOverlap ? [synergy.blocks.voiceGameOverlap] : []),
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
    profileLevelState,
    profileLevelLines,
    roleShowcaseLines,
    mandatoryLinks,
    trustBadges,
    surfaceState,
    componentBudget: PROFILE_COMPONENT_BUDGET,
    primaryAvatarUrl: primaryAvatar?.url || null,
    primaryAvatarDescription: primaryAvatar?.description || null,
    mediaGalleryItems,
    robloxProfileUrl,
    robloxDisplayState,
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
