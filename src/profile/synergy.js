"use strict";

const KILL_TIER_THRESHOLDS = Object.freeze([
  { tier: 2, kills: 1000 },
  { tier: 3, kills: 3000 },
  { tier: 4, kills: 7000 },
  { tier: 5, kills: 11000 },
]);

const KILL_MILESTONES = Object.freeze([20000, 30000]);
const MIN_POPULATION_BASELINE = 5;

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

function formatHours(value, digits = 1) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.max(0, Number(digits) || 0),
  }).format(amount);
}

function formatDays(value, digits = 1) {
  return `${formatHours(value, digits)} д`;
}

function clampScore(value, min = 0, max = 100) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return min;
  return Math.min(max, Math.max(min, amount));
}

function buildLetterGrade(score = null) {
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

function buildAxisState(score = null, extras = {}) {
  const amount = Number(score);
  if (!Number.isFinite(amount)) {
    return {
      score: null,
      grade: "N/A",
      ...extras,
    };
  }

  const normalizedScore = clampScore(amount);
  return {
    score: normalizedScore,
    grade: buildLetterGrade(normalizedScore),
    ...extras,
  };
}

function buildPercentileScore(score = null, populationScores = []) {
  const normalizedScore = normalizeFiniteNumber(score);
  const samples = (Array.isArray(populationScores) ? populationScores : [])
    .map((entry) => normalizeFiniteNumber(entry))
    .filter((entry) => Number.isFinite(entry))
    .sort((left, right) => left - right);

  if (!Number.isFinite(normalizedScore) || samples.length < 2) {
    return null;
  }

  let lessCount = 0;
  let equalCount = 0;
  for (const sample of samples) {
    if (sample < normalizedScore) lessCount += 1;
    else if (sample === normalizedScore) equalCount += 1;
  }

  if (!equalCount) {
    return clampScore((lessCount / (samples.length - 1)) * 100);
  }

  const minRank = lessCount + 1;
  const maxRank = lessCount + equalCount;
  const averageRank = (minRank + maxRank) / 2;
  return clampScore(((averageRank - 1) / (samples.length - 1)) * 100);
}

function buildPopulationCalibratedAxisState(rawScore = null, populationScores = []) {
  const normalizedRawScore = normalizeFiniteNumber(rawScore);
  const samples = (Array.isArray(populationScores) ? populationScores : [])
    .map((entry) => normalizeFiniteNumber(entry))
    .filter((entry) => Number.isFinite(entry));

  if (!Number.isFinite(normalizedRawScore)) {
    return buildAxisState(null, {
      rawScore: null,
      rawGrade: "N/A",
      source: "unavailable",
      populationSize: samples.length,
      percentileScore: null,
    });
  }

  const rawState = buildAxisState(normalizedRawScore);
  if (samples.length < MIN_POPULATION_BASELINE) {
    return {
      ...rawState,
      rawScore: rawState.score,
      rawGrade: rawState.grade,
      source: "local_fallback",
      populationSize: samples.length,
      percentileScore: null,
    };
  }

  const percentileScore = buildPercentileScore(normalizedRawScore, samples);
  const calibratedState = buildAxisState(percentileScore);
  return {
    ...calibratedState,
    rawScore: rawState.score,
    rawGrade: rawState.grade,
    source: "population",
    populationSize: samples.length,
    percentileScore: calibratedState.score,
  };
}

function resolveTimestamp(value) {
  return Number.isFinite(Number(value)) ? Number(value) : Date.parse(String(value || ""));
}

function getProofWindows(profile = {}) {
  return Array.isArray(profile?.domains?.progress?.proofWindows)
    ? profile.domains.progress.proofWindows
    : [];
}

function resolveNowTimestamp(now) {
  if (typeof now === "function") return resolveNowTimestamp(now());
  const fromValue = resolveTimestamp(now);
  return Number.isFinite(fromValue) ? fromValue : Date.now();
}

function getLatestProofWindow(profile = {}) {
  const proofWindows = getProofWindows(profile);
  return proofWindows.length ? proofWindows.at(-1) : null;
}

function getPreviousProofWindow(profile = {}) {
  const proofWindows = getProofWindows(profile);
  return proofWindows.length >= 2 ? proofWindows.at(-2) : null;
}

function computeElapsedHours(fromValue, now) {
  const fromTimestamp = resolveTimestamp(fromValue);
  const nowTimestamp = resolveNowTimestamp(now);
  if (!Number.isFinite(fromTimestamp) || !Number.isFinite(nowTimestamp) || nowTimestamp < fromTimestamp) return null;
  return (nowTimestamp - fromTimestamp) / (60 * 60 * 1000);
}

function hasReliableTrackedJjsDelta(latestProofWindow = null, robloxSummary = {}) {
  const currentTotalJjsMinutes = normalizeFiniteNumber(robloxSummary?.totalJjsMinutes);
  const snapshotTotalJjsMinutes = normalizeFiniteNumber(latestProofWindow?.totalJjsMinutes);
  const hasVerifiedRoblox = robloxSummary?.hasVerifiedAccount === true
    || (cleanString(robloxSummary?.verificationStatus, 40) === "verified" && Boolean(cleanString(robloxSummary?.userId, 80)));

  return latestProofWindow?.playtimeTracked === true
    && hasVerifiedRoblox
    && Number.isFinite(currentTotalJjsMinutes)
    && Number.isFinite(snapshotTotalJjsMinutes)
    && currentTotalJjsMinutes >= snapshotTotalJjsMinutes;
}

function hasReliableProofWindowPair(previousProofWindow = null, latestProofWindow = null) {
  const previousMinutes = normalizeFiniteNumber(previousProofWindow?.totalJjsMinutes);
  const latestMinutes = normalizeFiniteNumber(latestProofWindow?.totalJjsMinutes);
  const previousKills = normalizeFiniteNumber(previousProofWindow?.approvedKills);
  const latestKills = normalizeFiniteNumber(latestProofWindow?.approvedKills);
  const previousReviewedAt = Date.parse(String(previousProofWindow?.reviewedAt || ""));
  const latestReviewedAt = Date.parse(String(latestProofWindow?.reviewedAt || ""));

  return previousProofWindow?.playtimeTracked === true
    && latestProofWindow?.playtimeTracked === true
    && Number.isFinite(previousMinutes)
    && Number.isFinite(latestMinutes)
    && latestMinutes >= previousMinutes
    && Number.isFinite(previousKills)
    && Number.isFinite(latestKills)
    && latestKills >= previousKills
    && Number.isFinite(previousReviewedAt)
    && Number.isFinite(latestReviewedAt)
    && latestReviewedAt > previousReviewedAt;
}

function getNextKillTierTarget(approvedKills = null) {
  const amount = normalizeFiniteNumber(approvedKills);
  if (!Number.isFinite(amount)) return null;
  const target = KILL_TIER_THRESHOLDS.find((entry) => amount < entry.kills) || null;
  if (!target) return null;
  return {
    tier: target.tier,
    targetKills: target.kills,
    remainingKills: Math.max(0, target.kills - amount),
  };
}

function getNextKillMilestoneTarget(approvedKills = null) {
  const amount = normalizeFiniteNumber(approvedKills);
  if (!Number.isFinite(amount)) return null;
  const targetKills = KILL_MILESTONES.find((entry) => amount < entry) || null;
  if (!targetKills) return null;
  return {
    targetKills,
    remainingKills: Math.max(0, targetKills - amount),
  };
}

function buildGrowthWindowFromProofPair(previousProofWindow = null, latestProofWindow = null) {
  const fromKills = normalizeFiniteNumber(previousProofWindow?.approvedKills);
  const toKills = normalizeFiniteNumber(latestProofWindow?.approvedKills);
  const wallClockHours = computeElapsedHours(previousProofWindow?.reviewedAt, latestProofWindow?.reviewedAt);
  if (!Number.isFinite(fromKills) || !Number.isFinite(toKills) || toKills < fromKills || !Number.isFinite(wallClockHours) || wallClockHours <= 0) {
    return null;
  }

  const deltaKills = toKills - fromKills;
  const reliableJjs = hasReliableProofWindowPair(previousProofWindow, latestProofWindow);
  const previousMinutes = normalizeFiniteNumber(previousProofWindow?.totalJjsMinutes);
  const latestMinutes = normalizeFiniteNumber(latestProofWindow?.totalJjsMinutes);
  const jjsMinutes = reliableJjs ? Math.max(0, latestMinutes - previousMinutes) : null;
  const jjsHours = Number.isFinite(jjsMinutes) ? jjsMinutes / 60 : null;
  const killsPerJjsHour = Number.isFinite(jjsHours) && jjsHours > 0 ? deltaKills / jjsHours : null;

  return {
    source: "proof_windows",
    fromKills,
    toKills,
    deltaKills,
    reviewedFromAt: cleanString(previousProofWindow?.reviewedAt, 80) || null,
    reviewedToAt: cleanString(latestProofWindow?.reviewedAt, 80) || null,
    wallClockHours,
    wallClockDays: wallClockHours / 24,
    jjsMinutes,
    jjsHours,
    killsPerJjsHour,
    reliableJjs,
  };
}

function buildGrowthWindowFromHistoryChange(change = null) {
  const fromKills = normalizeFiniteNumber(change?.from);
  const toKills = normalizeFiniteNumber(change?.to);
  const fromAt = resolveTimestamp(change?.fromAt);
  const toAt = resolveTimestamp(change?.toAt);
  if (!Number.isFinite(fromKills) || !Number.isFinite(toKills) || toKills < fromKills || !Number.isFinite(fromAt) || !Number.isFinite(toAt) || toAt <= fromAt) {
    return null;
  }

  const wallClockHours = (toAt - fromAt) / (60 * 60 * 1000);
  return {
    source: "approved_history",
    fromKills,
    toKills,
    deltaKills: toKills - fromKills,
    reviewedFromAt: new Date(fromAt).toISOString(),
    reviewedToAt: new Date(toAt).toISOString(),
    wallClockHours,
    wallClockDays: wallClockHours / 24,
    jjsMinutes: null,
    jjsHours: null,
    killsPerJjsHour: null,
    reliableJjs: false,
  };
}

function buildGrowthWindowKey(window = {}) {
  return [
    cleanString(window?.source, 40) || "unknown",
    Number.isFinite(window?.fromKills) ? Number(window.fromKills) : "na",
    Number.isFinite(window?.toKills) ? Number(window.toKills) : "na",
    cleanString(window?.reviewedToAt, 80) || "na",
  ].join(":");
}

function buildGrowthWindows({ profile = null, recentKillChanges = [], limit = 10 } = {}) {
  const windows = [];
  const seen = new Set();
  const normalizedLimit = Math.max(1, Number(limit) || 10);
  const proofWindows = getProofWindows(profile);

  function pushWindow(window) {
    if (!window) return;
    const key = buildGrowthWindowKey(window);
    if (seen.has(key)) return;
    seen.add(key);
    windows.push(window);
  }

  for (let index = proofWindows.length - 1; index >= 1 && windows.length < normalizedLimit; index -= 1) {
    pushWindow(buildGrowthWindowFromProofPair(proofWindows[index - 1], proofWindows[index]));
  }

  for (const change of Array.isArray(recentKillChanges) ? recentKillChanges : []) {
    if (windows.length >= normalizedLimit) break;
    pushWindow(buildGrowthWindowFromHistoryChange(change));
  }

  return windows;
}

function buildWindowComparisonState(growthWindows = []) {
  const latestWindow = Array.isArray(growthWindows) ? growthWindows[0] : null;
  const previousWindow = Array.isArray(growthWindows) ? growthWindows[1] : null;
  if (!latestWindow || !previousWindow) {
    return {
      status: "insufficient_history",
      latestWindow,
      previousWindow,
    };
  }

  const latestPaceKillsPerJjsHour = normalizeFiniteNumber(latestWindow?.killsPerJjsHour);
  const previousPaceKillsPerJjsHour = normalizeFiniteNumber(previousWindow?.killsPerJjsHour);
  const hasLatestPace = Number.isFinite(latestPaceKillsPerJjsHour) && latestPaceKillsPerJjsHour > 0;
  const hasPreviousPace = Number.isFinite(previousPaceKillsPerJjsHour) && previousPaceKillsPerJjsHour > 0;

  if (hasLatestPace && hasPreviousPace) {
    const deltaRatio = previousPaceKillsPerJjsHour > 0
      ? (latestPaceKillsPerJjsHour - previousPaceKillsPerJjsHour) / previousPaceKillsPerJjsHour
      : null;
    let trend = "steady";
    if (Number.isFinite(deltaRatio) && deltaRatio >= 0.15) trend = "up";
    else if (Number.isFinite(deltaRatio) && deltaRatio <= -0.15) trend = "down";

    return {
      status: "ok",
      latestWindow,
      previousWindow,
      latestPaceKillsPerJjsHour,
      previousPaceKillsPerJjsHour,
      deltaRatio,
      trend,
    };
  }

  if (hasLatestPace) {
    return {
      status: "previous_unreliable",
      latestWindow,
      previousWindow,
      latestPaceKillsPerJjsHour,
      previousPaceKillsPerJjsHour,
    };
  }

  if (hasPreviousPace) {
    return {
      status: "latest_unreliable",
      latestWindow,
      previousWindow,
      latestPaceKillsPerJjsHour,
      previousPaceKillsPerJjsHour,
    };
  }

  return {
    status: "unreliable",
    latestWindow,
    previousWindow,
    latestPaceKillsPerJjsHour,
    previousPaceKillsPerJjsHour,
  };
}

function buildWindowComparisonLine(comparisonState = {}) {
  switch (comparisonState?.status) {
    case "ok": {
      let verdict = "форма роста держится близко к прошлому окну";
      if (comparisonState?.trend === "up") verdict = "форма роста выше прошлого окна";
      else if (comparisonState?.trend === "down") verdict = "форма роста ниже прошлого окна";

      return `Сравнение окон: последний ап ${formatHours(comparisonState.latestPaceKillsPerJjsHour)} kills/ч • прошлый ${formatHours(comparisonState.previousPaceKillsPerJjsHour)} kills/ч • ${verdict}`;
    }
    case "previous_unreliable":
      return `Сравнение окон: последний ап ${formatHours(comparisonState.latestPaceKillsPerJjsHour)} kills/ч • прошлое окно ещё без надёжных Roblox-часов`;
    case "latest_unreliable":
      return "Сравнение окон: последнее окно ещё без надёжных Roblox-часов";
    case "unreliable":
      return "Сравнение окон: Roblox-часы по последним окнам ещё ненадёжны";
    default:
      return "Сравнение окон: нужно ещё одно окно роста";
  }
}

function buildLifetimePaceState(growthWindows = []) {
  const reliableWindows = (Array.isArray(growthWindows) ? growthWindows : []).filter((window) => {
    const jjsHours = normalizeFiniteNumber(window?.jjsHours);
    const deltaKills = normalizeFiniteNumber(window?.deltaKills);
    return window?.reliableJjs === true
      && Number.isFinite(jjsHours)
      && jjsHours > 0
      && Number.isFinite(deltaKills)
      && deltaKills >= 0;
  });

  if (!reliableWindows.length) {
    return {
      status: "unavailable",
      reliableWindowCount: 0,
      totalKills: null,
      totalJjsHours: null,
      paceKillsPerJjsHour: null,
    };
  }

  const totalKills = reliableWindows.reduce((sum, window) => sum + (Number(window?.deltaKills) || 0), 0);
  const totalJjsHours = reliableWindows.reduce((sum, window) => sum + (Number(window?.jjsHours) || 0), 0);
  return {
    status: Number.isFinite(totalJjsHours) && totalJjsHours > 0 ? "ok" : "unavailable",
    reliableWindowCount: reliableWindows.length,
    totalKills,
    totalJjsHours,
    paceKillsPerJjsHour: Number.isFinite(totalJjsHours) && totalJjsHours > 0 ? totalKills / totalJjsHours : null,
  };
}

function buildLifetimePaceLine(lifetimePace = {}) {
  if (lifetimePace?.status !== "ok") {
    return "Средний темп за отслеженный период: надёжных Roblox-часов ещё мало";
  }

  return [
    `Средний темп за отслеженный период: ${formatHours(lifetimePace.paceKillsPerJjsHour)} kills/ч JJS`,
    `${formatNumber(lifetimePace.totalKills)} kills за ${formatHours(lifetimePace.totalJjsHours)} ч JJS`,
    `${formatNumber(lifetimePace.reliableWindowCount)} окна`,
  ].join(" • ");
}

function buildStabilityNarrativeLine(progressState = {}) {
  switch (progressState?.windowComparison?.status) {
    case "ok":
      if (progressState.windowComparison.trend === "up") {
        return "Динамика: темп ускорился относительно прошлого окна и рост пошёл заметно бодрее.";
      }
      if (progressState.windowComparison.trend === "down") {
        return "Динамика: темп просел относительно прошлого окна, так что рост сейчас идёт осторожнее.";
      }
      return "Динамика: растёшь ровно, без заметных скачков между последними окнами.";
    case "previous_unreliable":
      return "Динамика: последнее окно уже выглядит сильным, но прошлое ещё без надёжных Roblox-часов.";
    case "latest_unreliable":
      return "Динамика: новое окно уже появилось, но его темп пока нельзя честно сравнить.";
    case "unreliable":
      return "Динамика: Roblox-часы по последним окнам ещё ненадёжны, поэтому ускорение пока нечестно оценивать.";
    default:
      return "Динамика: для устойчивого паттерна нужно хотя бы ещё одно окно роста.";
  }
}

function buildSelfProgressFocusLine({ progressState = {}, nextTierTarget = null, paceKillsPerJjsHour = null } = {}) {
  const jjsHoursSinceLastApproved = normalizeFiniteNumber(progressState?.jjsHoursSinceLastApprovedKillsUpdate);
  const trend = cleanString(progressState?.windowComparison?.trend, 20);

  if (progressState?.reminderEligible && Number.isFinite(jjsHoursSinceLastApproved)) {
    const parts = [`После последнего рега уже ${formatHours(jjsHoursSinceLastApproved)} ч JJS`];
    if (trend === "up") {
      parts.push("темп выше прошлого окна");
    } else if (trend === "steady") {
      parts.push("темп держится ровно");
    } else if (trend === "down") {
      parts.push("даже с просадкой темпа окно уже созрело");
    }
    if (nextTierTarget?.remainingKills > 0) {
      parts.push(`до следующего tier осталось ${formatNumber(nextTierTarget.remainingKills)} kills`);
    }
    return `CTA: ${parts.join(" • ")}. Похоже, пора обновить kills.`;
  }

  if (nextTierTarget?.remainingKills > 0 && Number.isFinite(paceKillsPerJjsHour) && paceKillsPerJjsHour > 0) {
    if (trend === "up") {
      return `Фокус: темп выше прошлого окна, так что ${formatNumber(nextTierTarget.remainingKills)} kills до следующего tier уже выглядят рабочей дистанцией.`;
    }
    if (trend === "down") {
      return `Фокус: до следующего tier ещё ${formatNumber(nextTierTarget.remainingKills)} kills, но темп просел и его стоит выровнять.`;
    }
    return `Фокус: текущий темп рабочий, можно спокойно добирать ${formatNumber(nextTierTarget.remainingKills)} kills до следующего tier.`;
  }

  if (nextTierTarget?.remainingKills > 0) {
    return `Фокус: пока темп только копится, ориентир простой — ${formatNumber(nextTierTarget.remainingKills)} kills до следующего tier.`;
  }

  return null;
}

function buildFormAxisScore({ robloxSummary = {}, activitySummary = {}, progressState = {}, now } = {}) {
  const jjsMinutes7d = normalizeFiniteNumber(robloxSummary?.jjsMinutes7d);
  const activityScore = normalizeFiniteNumber(activitySummary?.activityScore);
  const hoursSinceLastApproved = normalizeFiniteNumber(progressState?.hoursSinceLastApprovedKillsUpdate);
  const hoursSinceLastSeenInJjs = computeElapsedHours(robloxSummary?.currentSessionStartedAt || robloxSummary?.lastSeenInJjsAt, now);

  let score = 0;
  let hasSignal = false;

  if (Number.isFinite(jjsMinutes7d)) {
    score += Math.min(45, jjsMinutes7d / 6);
    hasSignal = true;
  }
  if (Number.isFinite(activityScore)) {
    score += Math.min(25, Math.max(0, activityScore) / 4);
    hasSignal = true;
  }
  if (Number.isFinite(hoursSinceLastApproved)) {
    score += hoursSinceLastApproved <= 72 ? 20 : hoursSinceLastApproved <= 168 ? 14 : hoursSinceLastApproved <= 336 ? 8 : 3;
    hasSignal = true;
  }
  if (Number.isFinite(hoursSinceLastSeenInJjs)) {
    score += hoursSinceLastSeenInJjs <= 48 ? 10 : hoursSinceLastSeenInJjs <= 168 ? 5 : 1;
    hasSignal = true;
  }

  return hasSignal ? score : null;
}

function buildChatAxisScore(activitySummary = {}) {
  const messages7d = normalizeFiniteNumber(activitySummary?.messages7d);
  const sessions7d = normalizeFiniteNumber(activitySummary?.sessions7d);
  const activeDays7d = normalizeFiniteNumber(activitySummary?.activeDays7d, normalizeFiniteNumber(activitySummary?.activeDays30d) / 4);

  let score = 0;
  let hasSignal = false;

  if (Number.isFinite(messages7d)) {
    score += Math.min(50, Math.max(0, messages7d));
    hasSignal = true;
  }
  if (Number.isFinite(sessions7d)) {
    score += Math.min(25, Math.max(0, sessions7d) * 2.5);
    hasSignal = true;
  }
  if (Number.isFinite(activeDays7d)) {
    score += Math.min(25, Math.max(0, activeDays7d) * (25 / 7));
    hasSignal = true;
  }

  return hasSignal ? score : null;
}

function buildKillsAxisScore({ approvedKills = null, killTier = null, standing = {} } = {}) {
  let score = 0;
  let hasSignal = false;

  if (Number.isFinite(killTier) && killTier > 0) {
    score += Math.min(72, Number(killTier) * 18);
    hasSignal = true;
  }
  if (Number.isFinite(approvedKills) && approvedKills >= 0) {
    score += Math.min(12, Math.log10(Math.max(1, approvedKills + 1)) * 5);
    hasSignal = true;
  }
  if (Number.isFinite(standing?.rank) && Number.isFinite(standing?.totalVerified) && Number(standing.totalVerified) > 0) {
    const totalVerified = Number(standing.totalVerified);
    const percentile = totalVerified <= 1
      ? 100
      : (1 - ((Number(standing.rank) - 1) / (totalVerified - 1))) * 100;
    score += Math.max(0, percentile) * 0.2;
    hasSignal = true;
  }

  return hasSignal ? score : null;
}

function buildStabilityAxisScore(progressState = {}) {
  const comparisonState = progressState?.windowComparison || {};
  if (comparisonState.status === "ok") {
    const deltaRatio = Math.abs(Number(comparisonState.deltaRatio) || 0);
    if (deltaRatio <= 0.12) return 84;
    if (deltaRatio <= 0.35) return comparisonState.trend === "down" ? 64 : 74;
    return 56;
  }

  if (progressState?.latestGrowthWindow?.reliableJjs === true) {
    return 60;
  }
  if (progressState?.latestGrowthWindow) {
    return 46;
  }

  return null;
}

function buildGrowthAxisScore(progressState = {}) {
  const latestPace = normalizeFiniteNumber(progressState?.latestGrowthWindow?.killsPerJjsHour);
  if (!Number.isFinite(latestPace) || latestPace <= 0) {
    return progressState?.latestGrowthWindow ? 45 : null;
  }

  let score = Math.min(72, latestPace * 1.1);
  if (progressState?.windowComparison?.trend === "up") score += 14;
  else if (progressState?.windowComparison?.trend === "steady") score += 8;
  else if (progressState?.windowComparison?.trend === "down") score -= 6;

  const lifetimePace = normalizeFiniteNumber(progressState?.lifetimePace?.paceKillsPerJjsHour);
  if (Number.isFinite(lifetimePace) && lifetimePace > 0 && latestPace >= lifetimePace) {
    score += 5;
  }

  return score;
}

function buildSocialAxisScore(robloxSummary = {}) {
  const serverFriendsCount = normalizeFiniteNumber(robloxSummary?.serverFriendsCount);
  const nonFriendPeerCount = normalizeFiniteNumber(robloxSummary?.nonFriendPeerCount);
  const frequentNonFriendCount = normalizeFiniteNumber(robloxSummary?.frequentNonFriendCount);
  const topPeers = Array.isArray(robloxSummary?.topCoPlayPeers) ? robloxSummary.topCoPlayPeers : [];
  const totalPeerSessions = topPeers.reduce((sum, peer) => sum + (Number(peer?.sessionsTogether) || 0), 0);

  let score = 0;
  let hasSignal = false;

  if (Number.isFinite(serverFriendsCount)) {
    score += Math.min(40, Math.max(0, serverFriendsCount) * 8);
    hasSignal = true;
  }
  if (Number.isFinite(nonFriendPeerCount)) {
    score += Math.min(15, Math.max(0, nonFriendPeerCount) * 3);
    hasSignal = true;
  }
  if (Number.isFinite(frequentNonFriendCount)) {
    score += Math.min(10, Math.max(0, frequentNonFriendCount) * 5);
    hasSignal = true;
  }
  if (totalPeerSessions > 0) {
    score += Math.min(35, totalPeerSessions * 3);
    hasSignal = true;
  }

  return hasSignal ? score : null;
}

function buildViewerTierlistRawScores({
  approvedKills = null,
  killTier = null,
  standing = {},
  robloxSummary = {},
  activitySummary = {},
  progressState = {},
  now,
} = {}) {
  return {
    form: buildFormAxisScore({ robloxSummary, activitySummary, progressState, now }),
    chat: buildChatAxisScore(activitySummary),
    kills: buildKillsAxisScore({ approvedKills, killTier, standing }),
    stability: buildStabilityAxisScore(progressState),
    growth: buildGrowthAxisScore(progressState),
    social: buildSocialAxisScore(robloxSummary),
  };
}

function normalizePopulationProfileEntries(populationProfiles = []) {
  return (Array.isArray(populationProfiles) ? populationProfiles : [])
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      if (entry.profile && typeof entry.profile === "object") {
        return {
          userId: cleanString(entry.userId, 80),
          profile: entry.profile,
        };
      }

      return {
        userId: cleanString(entry.userId, 80),
        profile: entry,
      };
    })
    .filter((entry) => entry?.profile && typeof entry.profile === "object");
}

function buildPopulationKillStanding(approvedEntries = [], userId = "") {
  const normalizedUserId = cleanString(userId, 80);
  const ranked = (Array.isArray(approvedEntries) ? approvedEntries : [])
    .filter((entry) => Number.isFinite(Number(entry?.approvedKills)))
    .slice();

  ranked.sort((left, right) => {
    const leftKills = Number(left?.approvedKills) || 0;
    const rightKills = Number(right?.approvedKills) || 0;
    if (rightKills !== leftKills) return rightKills - leftKills;
    return cleanString(left?.displayName || left?.userId, 200).localeCompare(cleanString(right?.displayName || right?.userId, 200), "ru");
  });

  const index = ranked.findIndex((entry) => cleanString(entry?.userId, 80) === normalizedUserId);
  return {
    rank: index >= 0 ? index + 1 : null,
    totalVerified: ranked.length,
  };
}

function buildPopulationAxisSamples({ populationProfiles = [], approvedEntries = [], now } = {}) {
  const samples = {
    form: [],
    chat: [],
    kills: [],
    stability: [],
    growth: [],
    social: [],
  };

  for (const entry of normalizePopulationProfileEntries(populationProfiles)) {
    const profile = entry.profile;
    const summary = profile?.summary && typeof profile.summary === "object" ? profile.summary : {};
    const onboardingSummary = summary.onboarding && typeof summary.onboarding === "object" ? summary.onboarding : {};
    const activitySummary = summary.activity && typeof summary.activity === "object" ? summary.activity : {};
    const robloxSummary = summary.roblox && typeof summary.roblox === "object" ? summary.roblox : {};
    const approvedKills = normalizeFiniteNumber(profile?.approvedKills ?? onboardingSummary.approvedKills);
    const killTier = normalizeFiniteNumber(profile?.killTier ?? onboardingSummary.killTier);
    const standing = buildPopulationKillStanding(approvedEntries, entry.userId);
    const progressState = buildProgressSynergyState({
      profile,
      robloxSummary,
      now,
    });
    const rawScores = buildViewerTierlistRawScores({
      approvedKills,
      killTier,
      standing,
      robloxSummary,
      activitySummary,
      progressState,
      now,
    });

    for (const axisName of Object.keys(samples)) {
      if (Number.isFinite(rawScores[axisName])) {
        samples[axisName].push(rawScores[axisName]);
      }
    }
  }

  return samples;
}

function buildViewerTierlistState({
  approvedKills = null,
  killTier = null,
  standing = {},
  robloxSummary = {},
  activitySummary = {},
  progressState = {},
  populationProfiles = [],
  approvedEntries = [],
  now,
} = {}) {
  const rawScores = buildViewerTierlistRawScores({
    approvedKills,
    killTier,
    standing,
    robloxSummary,
    activitySummary,
    progressState,
    now,
  });
  const populationSamples = buildPopulationAxisSamples({
    populationProfiles,
    approvedEntries,
    now,
  });

  return {
    form: buildPopulationCalibratedAxisState(rawScores.form, populationSamples.form),
    chat: buildPopulationCalibratedAxisState(rawScores.chat, populationSamples.chat),
    kills: buildPopulationCalibratedAxisState(rawScores.kills, populationSamples.kills),
    stability: buildPopulationCalibratedAxisState(rawScores.stability, populationSamples.stability),
    growth: buildPopulationCalibratedAxisState(rawScores.growth, populationSamples.growth),
    social: buildPopulationCalibratedAxisState(rawScores.social, populationSamples.social),
  };
}

function buildViewerArchetypeLine({ tierlist = {}, approvedKills = null, killTier = null, mainCharacterLabels = [], progressState = {}, profile = null } = {}) {
  const formScore = normalizeFiniteNumber(tierlist?.form?.score);
  const chatScore = normalizeFiniteNumber(tierlist?.chat?.score);
  const killsScore = normalizeFiniteNumber(tierlist?.kills?.score);
  const growthScore = normalizeFiniteNumber(tierlist?.growth?.score);
  const socialScore = normalizeFiniteNumber(tierlist?.social?.score);
  const mainLabel = cleanString(Array.isArray(mainCharacterLabels) ? mainCharacterLabels[0] : "", 80);

  let archetype = "ровный игрок";
  if (Number.isFinite(killsScore) && killsScore >= 80 && Number.isFinite(formScore) && formScore < 55
    && (Number(approvedKills) >= 3000 || Number(killTier) >= 5 || progressState?.lifetimePace?.status === "ok")) {
    archetype = "ветеран на просадке";
  } else if (Number.isFinite(formScore) && formScore >= 70 && Number.isFinite(chatScore) && chatScore >= 65) {
    archetype = "живой core-игрок";
  } else if (Number.isFinite(formScore) && formScore >= 70 && Number.isFinite(chatScore) && chatScore < 60) {
    archetype = "тихий гриндер";
  } else if (Number.isFinite(chatScore) && chatScore >= 70 && Number.isFinite(formScore) && formScore < 55) {
    archetype = "чатовый активист";
  } else if (Number.isFinite(chatScore) && chatScore >= 60 && Number.isFinite(socialScore) && socialScore >= 55) {
    archetype = "локальный активный игрок";
  } else if (Number.isFinite(growthScore) && growthScore >= 75) {
    archetype = "игрок, который быстро набирает ход";
  } else if (!profile) {
    archetype = "новый игрок";
  }

  let growthPhrase = "рост ещё только собирается";
  if (progressState?.windowComparison?.trend === "up") {
    growthPhrase = "рост ускорился";
  } else if (progressState?.windowComparison?.trend === "steady") {
    growthPhrase = "рост держится ровно";
  } else if (progressState?.windowComparison?.trend === "down") {
    growthPhrase = "темп просел";
  } else if (progressState?.latestGrowthWindow?.reliableJjs === true) {
    growthPhrase = "рост уже читается по темпу";
  }

  let socialPhrase = "социальный круг ещё собирается";
  if (Number.isFinite(socialScore) && socialScore >= 70) {
    socialPhrase = "уже встроен в игровой круг";
  } else if (Number.isFinite(socialScore) && socialScore >= 55) {
    socialPhrase = "держит заметный игровой круг";
  } else if (Number.isFinite(socialScore) && socialScore < 40) {
    socialPhrase = "скорее играет локально";
  }

  const parts = [`Сейчас это ${archetype}`];
  if (mainLabel) parts.push(`${mainLabel}-main`);
  parts.push(growthPhrase);
  parts.push(socialPhrase);
  return parts.join(" • ");
}

function buildViewerAnchorLine({
  standing = {},
  killTier = null,
  eloSummary = {},
  robloxSummary = {},
  activitySummary = {},
} = {}) {
  const parts = [];
  if (Number.isFinite(standing?.rank)) {
    parts.push(`#${formatNumber(standing.rank)} по kills`);
  }
  if (Number.isFinite(killTier) && killTier > 0) {
    parts.push(`tier ${formatNumber(killTier)}`);
  }
  if (Number.isFinite(Number(eloSummary?.currentElo)) || Number.isFinite(Number(eloSummary?.currentTier))) {
    parts.push(`ELO ${formatNumber(eloSummary.currentElo)} / tier ${formatNumber(eloSummary.currentTier)}`);
  }
  if (robloxSummary?.hasVerifiedAccount === true && cleanString(robloxSummary?.currentUsername, 120)) {
    parts.push(`Roblox ${cleanString(robloxSummary.currentUsername, 120)}`);
  }
  if (cleanString(activitySummary?.appliedActivityRoleKey || activitySummary?.desiredActivityRoleKey, 80)) {
    parts.push(`активность ${cleanString(activitySummary.appliedActivityRoleKey || activitySummary.desiredActivityRoleKey, 80)}`);
  }

  return parts.length ? `Опора профиля: ${parts.join(" • ")}` : "Опора профиля: данных ещё мало.";
}

function buildMainCoreIdentityLine({ mainCharacterLabels = [], tierlistSummary = {} } = {}) {
  const mains = (Array.isArray(mainCharacterLabels) ? mainCharacterLabels : [])
    .map((entry) => cleanString(entry, 80))
    .filter(Boolean);
  const tierlistMainName = cleanString(tierlistSummary?.mainName, 120);
  const parts = [];

  if (mains[0]) {
    parts.push(`${mains[0]}-main`);
  }
  if (mains.length > 1) {
    parts.push(`ещё ${formatNumber(mains.length - 1)} мейн`);
  }
  if (tierlistMainName && cleanString(mains[0], 120).toLowerCase() !== tierlistMainName.toLowerCase()) {
    parts.push(`tierlist-пик ${tierlistMainName}`);
  }

  return parts.length ? `Ядро пиков: ${parts.join(" • ")}` : "Ядро пиков: мейны и tierlist-фокус ещё не собраны.";
}

function buildMainCoreStatusLine({ tierlist = {}, standing = {}, killTier = null, eloSummary = {} } = {}) {
  const parts = [];
  if (cleanString(tierlist?.form?.grade, 10) && tierlist.form.grade !== "N/A") {
    parts.push(`форма ${tierlist.form.grade}`);
  }
  if (cleanString(tierlist?.growth?.grade, 10) && tierlist.growth.grade !== "N/A") {
    parts.push(`рост ${tierlist.growth.grade}`);
  }
  if (cleanString(tierlist?.stability?.grade, 10) && tierlist.stability.grade !== "N/A") {
    parts.push(`стабильность ${tierlist.stability.grade}`);
  }
  if (Number.isFinite(standing?.rank)) {
    parts.push(`#${formatNumber(standing.rank)} по kills`);
  }
  if (Number.isFinite(killTier) && killTier > 0) {
    parts.push(`tier ${formatNumber(killTier)}`);
  }
  if (Number.isFinite(Number(eloSummary?.currentElo)) || Number.isFinite(Number(eloSummary?.currentTier))) {
    parts.push(`ELO ${formatNumber(eloSummary.currentElo)} / tier ${formatNumber(eloSummary.currentTier)}`);
  }

  return parts.length ? `Серверный контур: ${parts.join(" • ")}` : "Серверный контур: данных ещё мало.";
}

function buildMainCorePeerLine(robloxSummary = {}) {
  const topPeer = Array.isArray(robloxSummary?.topCoPlayPeers) ? robloxSummary.topCoPlayPeers[0] : null;
  if (!topPeer) {
    return "Игровая связка: явный постоянный партнёр пока не виден.";
  }

  const parts = [];
  if (cleanString(topPeer?.peerUserId, 80)) {
    parts.push(`чаще всего с <@${cleanString(topPeer.peerUserId, 80)}>`);
  } else {
    parts.push("частый co-play партнёр");
  }
  if (Number.isFinite(Number(topPeer?.minutesTogether)) && Number(topPeer.minutesTogether) > 0) {
    parts.push(`${formatNumber(topPeer.minutesTogether)} мин вместе`);
  }
  if (Number.isFinite(Number(topPeer?.sessionsTogether)) && Number(topPeer.sessionsTogether) > 0) {
    parts.push(`${formatNumber(topPeer.sessionsTogether)} сесс.`);
  }
  if (topPeer?.isRobloxFriend === true) {
    parts.push("Roblox-друг");
  } else if (topPeer?.isFrequentNonFriend === true) {
    parts.push("частый non-friend");
  }

  return `Игровая связка: ${parts.join(" • ")}`;
}

function buildMainCoreGuideLine({ mainCharacterLabels = [], comboLinks = [] } = {}) {
  const mains = (Array.isArray(mainCharacterLabels) ? mainCharacterLabels : [])
    .map((entry) => cleanString(entry, 80))
    .filter(Boolean);
  const links = Array.isArray(comboLinks) ? comboLinks : [];
  const mainGuideCount = links.filter((entry) => entry?.kind === "main").length;
  const hasGeneralGuide = links.some((entry) => entry?.kind === "general");
  const parts = [];

  if (mains.length) {
    parts.push(`гайды ${formatNumber(Math.min(mainGuideCount, mains.length))}/${formatNumber(mains.length)} по мейнам`);
  }
  if (hasGeneralGuide) {
    parts.push("общие техи доступны");
  } else if (mains.length) {
    parts.push("общие техи пока не привязаны");
  }

  return parts.length ? `Гайд-контур: ${parts.join(" • ")}` : "Гайд-контур: по мейнам и общим техам ссылок пока нет.";
}

function buildViewerMainCoreBlock({
  isSelf = false,
  tierlist = null,
  standing = {},
  killTier = null,
  eloSummary = {},
  robloxSummary = {},
  mainCharacterLabels = [],
  tierlistSummary = {},
  comboLinks = [],
} = {}) {
  if (isSelf || !tierlist) return null;

  return {
    title: "Main Core",
    lines: [
      buildMainCoreIdentityLine({ mainCharacterLabels, tierlistSummary }),
      buildMainCoreStatusLine({ tierlist, standing, killTier, eloSummary }),
      buildMainCorePeerLine(robloxSummary),
      buildMainCoreGuideLine({ mainCharacterLabels, comboLinks }),
    ],
  };
}

function buildViewerHeroBlock({
  isSelf = false,
  approvedKills = null,
  activitySummary = {},
  eloSummary = {},
  mainCharacterLabels = [],
  progressState = {},
  profile = null,
  robloxSummary = {},
  standing = {},
  killTier = null,
  tierlist = null,
} = {}) {
  if (isSelf) return null;
  if (!tierlist) return null;

  return {
    title: "Кто ты сейчас",
    lines: [
      `Текст-тирлист: Форма ${tierlist.form.grade} • Чат ${tierlist.chat.grade} • Килы ${tierlist.kills.grade} • Стабильность ${tierlist.stability.grade} • Развитие ${tierlist.growth.grade} • Соц ${tierlist.social.grade}`,
      buildViewerArchetypeLine({ tierlist, approvedKills, killTier, mainCharacterLabels, progressState, profile }),
      buildViewerAnchorLine({ standing, killTier, eloSummary, robloxSummary, activitySummary }),
    ],
  };
}

function buildEstimatedTargetLine(label, target = null, paceKillsPerJjsHour = null) {
  if (!target) return null;
  if (Number.isFinite(paceKillsPerJjsHour) && paceKillsPerJjsHour > 0) {
    const estimatedJjsHours = target.remainingKills / paceKillsPerJjsHour;
    return `${label}: ${formatNumber(target.remainingKills)} kills • ~${formatHours(estimatedJjsHours)} ч JJS при текущем темпе`;
  }
  return `${label}: ${formatNumber(target.remainingKills)} kills • темп ещё не накоплен`;
}

function buildSelfProgressBlock({
  isSelf = false,
  approvedKills = null,
  killTier = null,
  progressState = {},
} = {}) {
  if (!isSelf) return null;

  const lines = [];
  const normalizedApprovedKills = normalizeFiniteNumber(approvedKills);
  const normalizedKillTier = normalizeFiniteNumber(killTier);
  const latestGrowthWindow = progressState?.latestGrowthWindow || null;
  const nextTierTarget = getNextKillTierTarget(normalizedApprovedKills);
  const nextMilestoneTarget = getNextKillMilestoneTarget(normalizedApprovedKills);
  const currentKillsPerJjsHour = Number.isFinite(latestGrowthWindow?.killsPerJjsHour) && latestGrowthWindow.killsPerJjsHour > 0
    ? latestGrowthWindow.killsPerJjsHour
    : null;

  if (Number.isFinite(normalizedApprovedKills)) {
    const registrationBits = [`Зарегистрировано: ${formatNumber(normalizedApprovedKills)} kills`];
    if (Number.isFinite(normalizedKillTier) && normalizedKillTier > 0) {
      registrationBits.push(`tier ${formatNumber(normalizedKillTier)}`);
    }
    lines.push(registrationBits.join(" • "));
  } else {
    lines.push("Зарегистрированные kills пока не подтверждены.");
  }

  if (Number.isFinite(progressState?.hoursSinceLastApprovedKillsUpdate)) {
    if (Number.isFinite(progressState?.jjsHoursSinceLastApprovedKillsUpdate)) {
      lines.push(
        `С последнего рега: ${formatHours(progressState.hoursSinceLastApprovedKillsUpdate)} ч по времени • ${formatHours(progressState.jjsHoursSinceLastApprovedKillsUpdate)} ч JJS`
      );
    } else {
      lines.push(
        `С последнего рега: ${formatHours(progressState.hoursSinceLastApprovedKillsUpdate)} ч по времени • Roblox-часы пока ненадёжны`
      );
    }
  } else {
    lines.push("С последнего рега: первый approved update ещё не зафиксирован.");
  }

  if (latestGrowthWindow) {
    const growthBits = [
      `Последнее окно роста: ${formatNumber(latestGrowthWindow.fromKills)} -> ${formatNumber(latestGrowthWindow.toKills)} kills`,
      formatSignedNumber(latestGrowthWindow.deltaKills),
      formatDays(latestGrowthWindow.wallClockDays),
    ];
    if (Number.isFinite(latestGrowthWindow.jjsHours)) {
      growthBits.splice(2, 0, `${formatHours(latestGrowthWindow.jjsHours)} ч JJS`);
    } else {
      growthBits.push("Roblox-часы пока ненадёжны");
    }
    if (Number.isFinite(latestGrowthWindow.killsPerJjsHour) && latestGrowthWindow.killsPerJjsHour > 0) {
      growthBits.push(`${formatHours(latestGrowthWindow.killsPerJjsHour)} kills/ч`);
    }
    lines.push(growthBits.join(" • "));
  } else {
    lines.push("Последнее окно роста: история ещё короткая.");
  }

  lines.push(buildWindowComparisonLine(progressState?.windowComparison));
  lines.push(buildStabilityNarrativeLine(progressState));
  lines.push(buildLifetimePaceLine(progressState?.lifetimePace));

  const nextTierLine = buildEstimatedTargetLine("До следующего tier", nextTierTarget, currentKillsPerJjsHour);
  if (nextTierLine) {
    lines.push(nextTierLine);
  } else if (Number.isFinite(normalizedApprovedKills)) {
    lines.push("Следующий tier: уже максимальный текущий tier range.");
  }

  const nextMilestoneLine = buildEstimatedTargetLine(
    nextMilestoneTarget ? `До milestone ${formatNumber(nextMilestoneTarget.targetKills)}` : "",
    nextMilestoneTarget,
    currentKillsPerJjsHour
  );
  if (nextMilestoneLine) {
    lines.push(nextMilestoneLine);
  }

  const focusLine = buildSelfProgressFocusLine({
    progressState,
    nextTierTarget,
    paceKillsPerJjsHour: currentKillsPerJjsHour,
  });
  if (focusLine) {
    lines.push(focusLine);
  }

  return {
    title: "Практический прогресс",
    lines,
  };
}

function buildProgressSynergyState({ profile = null, robloxSummary = {}, recentKillChanges = [], now } = {}) {
  const latestProofWindow = getLatestProofWindow(profile);
  const hoursSinceLastApprovedKillsUpdate = computeElapsedHours(latestProofWindow?.reviewedAt, now);
  const growthWindows = buildGrowthWindows({ profile, recentKillChanges });
  const latestGrowthWindow = growthWindows[0] || null;
  const windowComparison = buildWindowComparisonState(growthWindows);
  const lifetimePace = buildLifetimePaceState(growthWindows);

  if (!latestProofWindow) {
    return {
      latestProofWindow: null,
      latestGrowthWindow,
      growthWindows,
      windowComparison,
      lifetimePace,
      hoursSinceLastApprovedKillsUpdate: null,
      jjsHoursSinceLastApprovedKillsUpdate: null,
      jjsMinutesSinceLastApprovedKillsUpdate: null,
      hasReliableJjsSinceLastApproved: false,
      reminderEligible: false,
    };
  }

  const currentTotalJjsMinutes = normalizeFiniteNumber(robloxSummary?.totalJjsMinutes);
  const snapshotTotalJjsMinutes = normalizeFiniteNumber(latestProofWindow?.totalJjsMinutes);
  const hasReliableJjsSinceLastApproved = hasReliableTrackedJjsDelta(latestProofWindow, robloxSummary);
  const jjsMinutesSinceLastApprovedKillsUpdate = hasReliableJjsSinceLastApproved
    ? Math.max(0, currentTotalJjsMinutes - snapshotTotalJjsMinutes)
    : null;
  const jjsHoursSinceLastApprovedKillsUpdate = hasReliableJjsSinceLastApproved
    ? jjsMinutesSinceLastApprovedKillsUpdate / 60
    : null;

  return {
    latestProofWindow,
    latestGrowthWindow,
    growthWindows,
    windowComparison,
    lifetimePace,
    hoursSinceLastApprovedKillsUpdate,
    jjsHoursSinceLastApprovedKillsUpdate,
    jjsMinutesSinceLastApprovedKillsUpdate,
    hasReliableJjsSinceLastApproved,
    reminderEligible: Number.isFinite(jjsHoursSinceLastApprovedKillsUpdate) && jjsHoursSinceLastApprovedKillsUpdate >= 10,
  };
}

function buildProfileSynergyState(options = {}) {
  const progress = buildProgressSynergyState(options);
  const viewerTierlist = options.isSelf
    ? null
    : buildViewerTierlistState({
      ...options,
      progressState: progress,
    });

  return {
    progress,
    blocks: {
      selfProgress: buildSelfProgressBlock({
        ...options,
        progressState: progress,
      }),
      viewerMainCore: buildViewerMainCoreBlock({
        ...options,
        progressState: progress,
        tierlist: viewerTierlist,
      }),
      viewerHero: buildViewerHeroBlock({
        ...options,
        progressState: progress,
        tierlist: viewerTierlist,
      }),
    },
  };
}

module.exports = {
  buildProfileSynergyState,
  buildProgressSynergyState,
};