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

function normalizeMediaUrl(value, limit = 2000) {
  const text = cleanString(value, limit);
  return /^https?:\/\//i.test(text) ? text : null;
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
  const targetAvatarUrl = normalizeMediaUrl(options.targetAvatarUrl, 2000);
  const robloxAvatarUrl = normalizeMediaUrl(robloxSummary.avatarUrl, 2000);
  const verificationAvatarUrl = normalizeMediaUrl(verificationSummary.oauthAvatarUrl, 2000);
  const primaryAvatar = [
    {
      url: targetAvatarUrl,
      description: `Discord avatar${displayName ? ` • ${displayName}` : ""}`,
    },
    {
      url: verificationAvatarUrl,
      description: verificationSummary.oauthUsername
        ? `Discord OAuth avatar • ${cleanString(verificationSummary.oauthUsername, 120)}`
        : "Discord OAuth avatar",
    },
    {
      url: robloxAvatarUrl,
      description: robloxSummary.currentUsername
        ? `Roblox avatar • ${cleanString(robloxSummary.currentUsername, 120)}`
        : "Roblox avatar",
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
    robloxSummary.currentUsername
      ? `Roblox avatar • ${cleanString(robloxSummary.currentUsername, 120)}`
      : "Roblox avatar"
  );
  pushMediaGalleryItem(
    verificationAvatarUrl,
    verificationSummary.oauthUsername
      ? `Discord OAuth avatar • ${cleanString(verificationSummary.oauthUsername, 120)}`
      : "Discord OAuth avatar"
  );

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
  if (Number.isFinite(approvedKills)) {
    contributionLines.push(`Подтверждённые kills: ${formatNumber(approvedKills)}`);
  }
  if (Number.isFinite(killTier) && killTier > 0) {
    contributionLines.push(`Kill-tier: ${killTier}`);
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

  const progressHistoryLines = [];
  if (recentKillChange) {
    const recentSummary = summarizeRecentKillChange(recentKillChange);
    progressHistoryLines.push(`Срез proof: ${formatNumber(recentKillChange.from)} -> ${formatNumber(recentKillChange.to)}`);
    progressHistoryLines.push(`Прирост: ${formatSignedNumber(recentSummary.delta)} kills за ${formatNumber(recentSummary.dayCount)} дн.`);
    progressHistoryLines.push(`Темп: ${formatNumber(recentSummary.averagePerDay)} kills/день`);
    if (recentKillChange.fromAt) {
      progressHistoryLines.push(`Старт среза: ${formatDateTime(recentKillChange.fromAt)}`);
    }
    if (recentKillChange.toAt) {
      progressHistoryLines.push(`Финиш среза: ${formatDateTime(recentKillChange.toAt)}`);
      progressHistoryLines.push(`С прошлого proof: ${formatDurationDaysSince(recentKillChange.toAt)}`);
    }
  } else {
    progressHistoryLines.push("Свежей истории роста по kills пока нет.");
  }

  const submissionLines = [];
  if (latestSubmission?.reviewedAt) {
    submissionLines.push(`Последняя проверка: ${formatDateTime(latestSubmission.reviewedAt)}`);
  } else if (latestSubmission?.createdAt) {
    submissionLines.push(`Последняя заявка: ${formatDateTime(latestSubmission.createdAt)}`);
  }
  if (pendingSubmission) {
    submissionLines.push(`Pending proof: ${formatNumber(pendingSubmission.kills)} kills`);
    submissionLines.push(`Отправлена: ${formatDateTime(pendingSubmission.createdAt)}`);
  }
  if (!submissionLines.length) {
    submissionLines.push("Сейчас нет активных заявок или свежих проверок.");
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
    robloxLines.push("Связка Roblox: подтверждена");
    robloxLines.push(`Аккаунт: ${cleanString(robloxSummary.currentUsername, 120) || cleanString(robloxSummary.userId, 80) || "verified"}`);
  } else if (robloxSummary.verificationStatus) {
    robloxLines.push(`Связка Roblox: ${cleanString(robloxSummary.verificationStatus, 80)}`);
  } else {
    robloxLines.push("Связка Roblox ещё не подтверждена.");
  }
  if (robloxSummary.profileUrl) {
    robloxLines.push("Профиль Roblox: доступен по кнопке ниже");
  }
  if (robloxSummary.currentDisplayName
    && cleanString(robloxSummary.currentDisplayName, 120) !== cleanString(robloxSummary.currentUsername, 120)) {
    robloxLines.push(`Display name: ${cleanString(robloxSummary.currentDisplayName, 120)}`);
  }
  if (robloxSummary.previousUsername) {
    robloxLines.push(`Прошлый username: ${cleanString(robloxSummary.previousUsername, 120)}`);
  }
  if (robloxSummary.previousDisplayName) {
    robloxLines.push(`Прошлый display: ${cleanString(robloxSummary.previousDisplayName, 120)}`);
  }
  if (Number.isFinite(Number(robloxSummary.renameCount)) && Number(robloxSummary.renameCount) > 0) {
    robloxLines.push(`Смен username: ${formatNumber(robloxSummary.renameCount)}`);
  }
  if (Number.isFinite(Number(robloxSummary.displayRenameCount)) && Number(robloxSummary.displayRenameCount) > 0) {
    robloxLines.push(`Смен display-name: ${formatNumber(robloxSummary.displayRenameCount)}`);
  }
  if (robloxSummary.lastRenameSeenAt) {
    robloxLines.push(`Последний rename: ${formatDateTime(robloxSummary.lastRenameSeenAt)}`);
  }
  if (robloxSummary.hasVerifiedBadge === true) {
    robloxLines.push("Есть verified badge");
  }
  if (robloxSummary.accountStatus) {
    robloxLines.push(`Статус аккаунта: ${cleanString(robloxSummary.accountStatus, 80)}`);
  }
  if (Number.isFinite(Number(robloxSummary.serverFriendsCount))) {
    robloxLines.push(`Друзья на сервере: ${formatNumber(robloxSummary.serverFriendsCount)}`);
  }
  if (Number.isFinite(Number(robloxSummary.jjsMinutes7d))) {
    robloxLines.push(`JJS минут 7д: ${formatNumber(robloxSummary.jjsMinutes7d)}`);
  }
  if (Number.isFinite(Number(robloxSummary.jjsMinutes30d))) {
    robloxLines.push(`JJS минут 30д: ${formatNumber(robloxSummary.jjsMinutes30d)}`);
  }
  if (Number.isFinite(Number(robloxSummary.totalJjsMinutes))) {
    robloxLines.push(`JJS минут всего: ${formatNumber(robloxSummary.totalJjsMinutes)}`);
  }
  if (Number.isFinite(Number(robloxSummary.frequentNonFriendCount))) {
    robloxLines.push(`Частые non-friend: ${formatNumber(robloxSummary.frequentNonFriendCount)}`);
  }
  if (robloxSummary.lastSeenInJjsAt) {
    robloxLines.push(`Последний JJS online: ${formatDateTime(robloxSummary.lastSeenInJjsAt)}`);
  }
  if (robloxSummary.lastRefreshAt) {
    robloxLines.push(`Последний refresh: ${formatDateTime(robloxSummary.lastRefreshAt)}`);
  }
  if (robloxSummary.refreshStatus) {
    robloxLines.push(`Статус refresh: ${cleanString(robloxSummary.refreshStatus, 80)}`);
  }
  if (robloxSummary.refreshError) {
    robloxLines.push(`Ошибка refresh: ${cleanString(robloxSummary.refreshError, 180)}`);
  }

  const mainAndGuideLines = [];
  if (mainCharacterLabels.length) {
    mainAndGuideLines.push(`Основные персонажи: ${mainCharacterLabels.join(", ")}`);
  } else {
    mainAndGuideLines.push("Мейны пока не указаны.");
  }
  if (comboLinks.length) {
    mainAndGuideLines.push(`Доступные гайды: ${comboLinks.map((entry) => entry.label).join(", ")}`);
  }
  if (profile?.accessGrantedAt) {
    mainAndGuideLines.push(`JJS доступ: ${formatDateTime(profile.accessGrantedAt)}`);
  }
  if (profile?.nonGgsAccessGrantedAt) {
    mainAndGuideLines.push(`Non-JJS доступ: ${formatDateTime(profile.nonGgsAccessGrantedAt)}`);
  }

  return {
    userId,
    displayName,
    isSelf: Boolean(options.isSelf),
    comboLinks,
    primaryAvatarUrl: primaryAvatar?.url || null,
    primaryAvatarDescription: primaryAvatar?.description || null,
    mediaGalleryItems,
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
        { title: "Последний рост по kills", lines: progressHistoryLines },
        { title: "Заявки и проверки", lines: submissionLines },
        { title: "ELO и Tierlist", lines: rankingLines },
      ],
      social: [
        { title: "Roblox и соц", lines: robloxLines },
        { title: "Мейны и гайды", lines: mainAndGuideLines },
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