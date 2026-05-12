"use strict";

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function normalizeFiniteNumber(value, fallback = null) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : fallback;
}

function formatNumber(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? new Intl.NumberFormat("ru-RU").format(amount) : "—";
}

function formatPercent(value, digits = 1) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return `${amount.toFixed(Math.max(0, Number(digits) || 0))}%`;
}

function formatDateTime(value) {
  const timestamp = Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) return "—";
  return new Date(timestamp).toLocaleString("ru-RU");
}

function formatDurationDaysSince(value) {
  const timestamp = Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) return "—";
  const diffMs = Math.max(0, Date.now() - timestamp);
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  return `${diffDays} дн.`;
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
    links.push({
      label: cleanString(mainLabel || entry?.name || entry?.id, 80) || `Main ${links.length + 1}`,
      url,
    });
    if (links.length >= 2) break;
  }

  const generalTechsUrl = buildDiscordChannelUrl(guildId, cleanString(guideState?.generalTechsThreadId, 80));
  if (generalTechsUrl && links.length < 3) {
    links.push({ label: "Общие техи", url: generalTechsUrl });
  }

  return links;
}

function buildProfileReadModel(options = {}) {
  const userId = cleanString(options.userId, 80);
  const profile = options.profile && typeof options.profile === "object" ? options.profile : null;
  const summary = profile?.summary && typeof profile.summary === "object" ? profile.summary : {};
  const onboardingSummary = summary.onboarding && typeof summary.onboarding === "object" ? summary.onboarding : {};
  const activitySummary = summary.activity && typeof summary.activity === "object" ? summary.activity : {};
  const eloSummary = summary.elo && typeof summary.elo === "object" ? summary.elo : {};
  const tierlistSummary = summary.tierlist && typeof summary.tierlist === "object" ? summary.tierlist : {};
  const robloxSummary = summary.roblox && typeof summary.roblox === "object" ? summary.roblox : {};
  const verificationSummary = summary.verification && typeof summary.verification === "object" ? summary.verification : {};
  const pendingSubmission = options.pendingSubmission && typeof options.pendingSubmission === "object" ? options.pendingSubmission : null;
  const latestSubmission = options.latestSubmission && typeof options.latestSubmission === "object" ? options.latestSubmission : null;
  const approvedEntries = Array.isArray(options.approvedEntries) ? options.approvedEntries : [];
  const recentKillChange = options.recentKillChange && typeof options.recentKillChange === "object" ? options.recentKillChange : null;
  const roleMentions = Array.isArray(options.roleMentions) ? options.roleMentions.filter(Boolean) : [];
  const mainCharacterIds = Array.isArray(profile?.mainCharacterIds) ? profile.mainCharacterIds : [];
  const mainCharacterLabels = Array.isArray(profile?.mainCharacterLabels) ? profile.mainCharacterLabels : [];
  const displayName = cleanString(
    options.targetDisplayName
    || summary.preferredDisplayName
    || profile?.displayName
    || profile?.username,
    200
  ) || `User ${userId}`;
  const standing = computeKillStanding(approvedEntries, userId);
  const approvedKills = normalizeFiniteNumber(profile?.approvedKills ?? onboardingSummary.approvedKills);
  const killTier = normalizeFiniteNumber(profile?.killTier ?? onboardingSummary.killTier);
  const comboLinks = buildComboThreadLinks({
    guideState: options.comboGuideState,
    mainCharacterIds,
    mainCharacterLabels,
    guildId: options.guildId,
  });

  const overviewLines = [];
  overviewLines.push(`Игрок: <@${userId}>`);
  if (mainCharacterLabels.length) {
    overviewLines.push(`Мейны: ${mainCharacterLabels.join(", ")}`);
  }
  if (roleMentions.length) {
    overviewLines.push(`Роли: ${roleMentions.join(", ")}`);
  }
  if (Number.isFinite(approvedKills)) {
    overviewLines.push(`Kills: ${formatNumber(approvedKills)}`);
  }
  if (Number.isFinite(killTier) && killTier > 0) {
    overviewLines.push(`Kill-tier: ${killTier}`);
  }
  if (profile?.accessGrantedAt) {
    overviewLines.push(`Стартовый доступ: ${formatDateTime(profile.accessGrantedAt)}`);
  }
  if (profile?.nonGgsAccessGrantedAt) {
    overviewLines.push(`Отдельный доступ без JJS: ${formatDateTime(profile.nonGgsAccessGrantedAt)}`);
  }
  if (!profile && !pendingSubmission && !latestSubmission) {
    overviewLines.push("Профиль ещё не заполнен.");
  }

  const activityLines = [];
  if (activitySummary.appliedActivityRoleKey || activitySummary.desiredActivityRoleKey) {
    activityLines.push(`Bucket: ${cleanString(activitySummary.appliedActivityRoleKey || activitySummary.desiredActivityRoleKey, 80)}`);
  }
  if (Number.isFinite(Number(activitySummary.activityScore))) {
    activityLines.push(`Score: ${formatNumber(activitySummary.activityScore)}`);
  }
  if (Number.isFinite(Number(activitySummary.messages7d)) || Number.isFinite(Number(activitySummary.messages30d))) {
    activityLines.push(`Сообщения 7д/30д: ${formatNumber(activitySummary.messages7d)} / ${formatNumber(activitySummary.messages30d)}`);
  }
  if (Number.isFinite(Number(activitySummary.sessions7d)) || Number.isFinite(Number(activitySummary.sessions30d))) {
    activityLines.push(`Сессии 7д/30д: ${formatNumber(activitySummary.sessions7d)} / ${formatNumber(activitySummary.sessions30d)}`);
  }
  if (Number.isFinite(Number(activitySummary.activeDays30d))) {
    activityLines.push(`Активные дни 30д: ${formatNumber(activitySummary.activeDays30d)}`);
  }
  if (Number.isFinite(Number(activitySummary.daysSinceGuildJoin))) {
    activityLines.push(`На сервере: ${formatNumber(Math.round(Number(activitySummary.daysSinceGuildJoin)))} дн.`);
  }
  if (activitySummary.lastSeenAt) {
    activityLines.push(`Последняя активность: ${formatDateTime(activitySummary.lastSeenAt)}`);
  }

  const contributionLines = [];
  if (standing.rank) {
    contributionLines.push(`Место по kills: #${standing.rank} из ${formatNumber(standing.totalVerified)}`);
  }
  if (standing.shareOfServerKills !== null) {
    contributionLines.push(`Доля серверных kills: ${formatPercent(standing.shareOfServerKills)}`);
  }
  if (recentKillChange) {
    const recentSummary = summarizeRecentKillChange(recentKillChange);
    contributionLines.push(
      `Последний рост: ${formatNumber(recentKillChange.from)} -> ${formatNumber(recentKillChange.to)} (+${formatNumber(recentSummary.delta)}, ${formatNumber(recentSummary.averagePerDay)}/день)`
    );
    contributionLines.push(`С прошлого proof: ${formatDurationDaysSince(recentKillChange.toAt)}`);
  }
  if (latestSubmission?.reviewedAt) {
    contributionLines.push(`Последняя проверка: ${formatDateTime(latestSubmission.reviewedAt)}`);
  } else if (latestSubmission?.createdAt) {
    contributionLines.push(`Последняя заявка: ${formatDateTime(latestSubmission.createdAt)}`);
  }
  if (pendingSubmission) {
    contributionLines.push(`Pending: ${formatNumber(pendingSubmission.kills)} kills с ${formatDateTime(pendingSubmission.createdAt)}`);
  }

  const rankingLines = [];
  if (Number.isFinite(Number(options.eloProfile?.currentElo ?? eloSummary.currentElo))) {
    rankingLines.push(`ELO: ${formatNumber(options.eloProfile?.currentElo ?? eloSummary.currentElo)}`);
  }
  if (Number.isFinite(Number(options.eloProfile?.currentTier ?? eloSummary.currentTier))) {
    rankingLines.push(`ELO tier: ${formatNumber(options.eloProfile?.currentTier ?? eloSummary.currentTier)}`);
  }
  if (options.eloProfile?.lastSubmissionStatus || eloSummary.lastSubmissionStatus) {
    rankingLines.push(`ELO submit: ${cleanString(options.eloProfile?.lastSubmissionStatus || eloSummary.lastSubmissionStatus, 80)}`);
  }
  if (options.tierlistProfile?.mainName || tierlistSummary.mainName) {
    rankingLines.push(`Tierlist main: ${cleanString(options.tierlistProfile?.mainName || tierlistSummary.mainName, 120)}`);
  }
  if (options.tierlistProfile?.lockUntil) {
    rankingLines.push(`Lock до: ${formatDateTime(options.tierlistProfile.lockUntil)}`);
  }
  if (Number.isFinite(Number(options.tierlistProfile?.influenceMultiplier ?? tierlistSummary.influenceMultiplier))
    && Number(options.tierlistProfile?.influenceMultiplier ?? tierlistSummary.influenceMultiplier) !== 1) {
    rankingLines.push(`Influence: x${Number(options.tierlistProfile?.influenceMultiplier ?? tierlistSummary.influenceMultiplier).toFixed(2)}`);
  }

  const robloxLines = [];
  if (robloxSummary.hasVerifiedAccount) {
    robloxLines.push(`Roblox: ${cleanString(robloxSummary.currentUsername, 120) || cleanString(robloxSummary.userId, 80) || "verified"}`);
  } else if (robloxSummary.verificationStatus) {
    robloxLines.push(`Roblox status: ${cleanString(robloxSummary.verificationStatus, 80)}`);
  }
  if (Number.isFinite(Number(robloxSummary.serverFriendsCount))) {
    robloxLines.push(`Друзья на сервере: ${formatNumber(robloxSummary.serverFriendsCount)}`);
  }
  if (Number.isFinite(Number(robloxSummary.jjsMinutes30d))) {
    robloxLines.push(`JJS минут 30д: ${formatNumber(robloxSummary.jjsMinutes30d)}`);
  }
  if (Number.isFinite(Number(robloxSummary.frequentNonFriendCount))) {
    robloxLines.push(`Частые non-friend: ${formatNumber(robloxSummary.frequentNonFriendCount)}`);
  }
  if (robloxSummary.lastSeenInJjsAt) {
    robloxLines.push(`Последний JJS online: ${formatDateTime(robloxSummary.lastSeenInJjsAt)}`);
  }

  return {
    userId,
    displayName,
    isSelf: Boolean(options.isSelf),
    comboLinks,
    robloxProfileUrl: cleanString(robloxSummary.profileUrl, 1000) || null,
    sections: {
      overview: [
        { title: "Обзор", lines: overviewLines },
        {
          title: "Ключевые факты",
          lines: [
            standing.rank ? `Место по kills: #${standing.rank}` : "",
            standing.shareOfServerKills !== null ? `Доля kills: ${formatPercent(standing.shareOfServerKills)}` : "",
            tierlistSummary.mainName ? `Tierlist main: ${cleanString(tierlistSummary.mainName, 120)}` : "",
            eloSummary.currentElo !== null && eloSummary.currentElo !== undefined ? `ELO: ${formatNumber(eloSummary.currentElo)}` : "",
            robloxSummary.currentUsername ? `Roblox: ${cleanString(robloxSummary.currentUsername, 120)}` : "",
          ],
        },
      ],
      activity: [
        { title: "Активность", lines: activityLines },
        {
          title: "Детали activity",
          lines: [
            Number.isFinite(Number(activitySummary.messages90d)) ? `Сообщения 90д: ${formatNumber(activitySummary.messages90d)}` : "",
            Number.isFinite(Number(activitySummary.sessions90d)) ? `Сессии 90д: ${formatNumber(activitySummary.sessions90d)}` : "",
            Number.isFinite(Number(activitySummary.activeDays7d)) ? `Активные дни 7д: ${formatNumber(activitySummary.activeDays7d)}` : "",
            Number.isFinite(Number(activitySummary.activeWatchedChannels30d)) ? `Активные каналы 30д: ${formatNumber(activitySummary.activeWatchedChannels30d)}` : "",
            Number.isFinite(Number(activitySummary.daysAbsent)) ? `Отсутствие: ${formatNumber(activitySummary.daysAbsent)} дн.` : "",
            activitySummary.roleEligibilityStatus ? `Eligibility: ${cleanString(activitySummary.roleEligibilityStatus, 80)}` : "",
          ],
        },
      ],
      progress: [
        { title: "Вклад", lines: contributionLines },
        { title: "ELO и Tierlist", lines: rankingLines },
      ],
      social: [
        { title: "Roblox и соц", lines: robloxLines },
        {
          title: "Мейны и ссылки",
          lines: [
            mainCharacterLabels.length ? `Мейны: ${mainCharacterLabels.join(", ")}` : "",
            comboLinks.length ? `Combo links: ${comboLinks.map((entry) => entry.label).join(", ")}` : "",
            robloxSummary.profileUrl ? "Есть Roblox ссылка" : "",
          ],
        },
      ],
    },
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