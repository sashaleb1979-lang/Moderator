"use strict";

const KILL_TIER_THRESHOLDS = Object.freeze([
  { tier: 2, kills: 1000 },
  { tier: 3, kills: 3000 },
  { tier: 4, kills: 7000 },
  { tier: 5, kills: 11000 },
]);

const KILL_MILESTONES = Object.freeze([20000, 30000]);
const MIN_POPULATION_BASELINE = 5;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const VIEWER_TIERLIST_AXES = Object.freeze([
  ["form", "Форма"],
  ["chat", "Общение"],
  ["kills", "Килы"],
  ["stability", "Стабильность"],
  ["growth", "Рост"],
  ["social", "Связи"],
]);

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function normalizeFiniteNumber(value, fallback = null) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : fallback;
}

function normalizeNullableFiniteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  return normalizeFiniteNumber(value, fallback);
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

function formatJjsHoursFromMinutes(value, digits = 1) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) return "—";
  const hours = Math.floor((minutes / 60) * 10) / 10;
  return `${formatHours(hours, digits)} ч`;
}

function formatPercent(value, digits = 1) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return `${new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: Math.max(0, Number(digits) || 0),
    maximumFractionDigits: Math.max(0, Number(digits) || 0),
  }).format(amount)}%`;
}

function buildShareBar(value = 0, size = 6) {
  const normalizedSize = Math.max(4, Number(size) || 6);
  const amount = clampScore(value, 0, 100);
  const filled = Math.max(0, Math.min(normalizedSize, Math.round((amount / 100) * normalizedSize)));
  return `${"▰".repeat(filled)}${"▱".repeat(normalizedSize - filled)}`;
}

function formatDays(value, digits = 1) {
  return `${formatHours(value, digits)} д`;
}

function formatDateTime(value) {
  const timestamp = Number.isFinite(Number(value))
    ? Number(value)
    : Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) return "—";
  return new Date(timestamp).toLocaleString("ru-RU");
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
  if (score === null || score === undefined || score === "") {
    return {
      score: null,
      grade: "N/A",
      ...extras,
    };
  }

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

function buildAxisPlace(rawScore = null, populationScores = [], options = {}) {
  const normalizedRawScore = normalizeFiniteNumber(rawScore);
  const direction = cleanString(options.direction || "desc", 10) === "asc" ? "asc" : "desc";
  const samples = (Array.isArray(populationScores) ? populationScores : [])
    .map((entry) => normalizeFiniteNumber(entry))
    .filter((entry) => Number.isFinite(entry));

  if (!Number.isFinite(normalizedRawScore) || samples.length < MIN_POPULATION_BASELINE) {
    return {
      rank: null,
      total: samples.length,
      tieCount: 0,
      direction,
      basis: samples.length >= MIN_POPULATION_BASELINE ? "population" : "insufficient_population",
    };
  }

  let betterCount = 0;
  let equalCount = 0;
  for (const sample of samples) {
    if (sample === normalizedRawScore) {
      equalCount += 1;
      continue;
    }
    if (direction === "desc" ? sample > normalizedRawScore : sample < normalizedRawScore) {
      betterCount += 1;
    }
  }

  return {
    rank: betterCount + 1,
    total: samples.length,
    tieCount: equalCount,
    direction,
    basis: "population",
  };
}

function normalizeInfluenceDebuffPercent(value, fallback = 0) {
  const amount = normalizeFiniteNumber(value, fallback);
  return clampScore(amount, 0, 100);
}

function applyAxisTrustState(axisState = {}, trustOptions = {}) {
  const trustDebuff = normalizeInfluenceDebuffPercent(trustOptions.influenceDebuffPercent, 0);
  const baseDebuff = normalizeInfluenceDebuffPercent(axisState.influenceDebuffPercent, 0);
  const freshnessState = cleanString(trustOptions.freshnessState, 40) || axisState.freshnessState || "fresh";

  return {
    ...axisState,
    freshnessState,
    influenceDebuffPercent: Math.max(baseDebuff, trustDebuff),
    trustSource: cleanString(trustOptions.trustSource, 80) || axisState.trustSource || null,
  };
}

function buildPopulationCalibratedAxisState(rawScore = null, populationScores = [], options = {}) {
  const normalizedRawScore = normalizeNullableFiniteNumber(rawScore);
  const samples = (Array.isArray(populationScores) ? populationScores : [])
    .map((entry) => normalizeFiniteNumber(entry))
    .filter((entry) => Number.isFinite(entry));
  const place = buildAxisPlace(normalizedRawScore, samples);

  if (!Number.isFinite(normalizedRawScore)) {
    return buildAxisState(null, {
      rawScore: null,
      rawGrade: "N/A",
      source: "unavailable",
      populationSize: samples.length,
      percentileScore: null,
      place,
      confidenceState: "unavailable",
      freshnessState: "unavailable",
      influenceDebuffPercent: 90,
    });
  }

  const rawState = buildAxisState(normalizedRawScore);
  if (samples.length < MIN_POPULATION_BASELINE) {
    return applyAxisTrustState({
      ...rawState,
      rawScore: rawState.score,
      rawGrade: rawState.grade,
      source: "local_fallback",
      populationSize: samples.length,
      percentileScore: null,
      place,
      confidenceState: "partial",
      freshnessState: "partial",
      influenceDebuffPercent: 15,
    }, options);
  }

  const percentileScore = buildPercentileScore(normalizedRawScore, samples);
  const calibratedState = buildAxisState(percentileScore);
  return applyAxisTrustState({
    ...calibratedState,
    rawScore: rawState.score,
    rawGrade: rawState.grade,
    source: "population",
    populationSize: samples.length,
    percentileScore: calibratedState.score,
    place,
    confidenceState: "reliable",
    freshnessState: "fresh",
    influenceDebuffPercent: 0,
  }, options);
}

function resolveDataAgeDays(capturedAt = null, now = null) {
  const capturedTimestamp = resolveTimestamp(capturedAt);
  const nowTimestamp = resolveNowTimestamp(now);
  if (!Number.isFinite(capturedTimestamp) || !Number.isFinite(nowTimestamp)) return null;
  return Math.max(0, Math.floor((nowTimestamp - capturedTimestamp) / MS_PER_DAY));
}

function computeAgeDebuffPercent(dataAgeDays = null) {
  const age = normalizeNullableFiniteNumber(dataAgeDays);
  if (!Number.isFinite(age)) return 90;
  if (age <= 2) return 0;
  if (age <= 7) return 15;
  if (age <= 14) return 30;
  if (age <= 30) return 55;
  return 75;
}

function getLatestSeasonSnapshot(profile = {}) {
  const snapshots = Array.isArray(profile?.domains?.seasonArchive?.snapshots)
    ? profile.domains.seasonArchive.snapshots
    : [];
  return snapshots
    .filter((entry) => entry && typeof entry === "object")
    .slice()
    .sort((left, right) => resolveTimestamp(right?.capturedAt || right?.dayKey) - resolveTimestamp(left?.capturedAt || left?.dayKey))[0] || null;
}

function getLatestWeeklyRollup(profile = {}) {
  const rollups = Array.isArray(profile?.domains?.seasonArchive?.weeklyRollups)
    ? profile.domains.seasonArchive.weeklyRollups
    : [];
  return rollups
    .filter((entry) => entry && typeof entry === "object")
    .slice()
    .sort((left, right) => {
      const rightTime = resolveTimestamp(right?.endDayKey || right?.capturedAt || right?.weekKey);
      const leftTime = resolveTimestamp(left?.endDayKey || left?.capturedAt || left?.weekKey);
      if (Number.isFinite(rightTime) && Number.isFinite(leftTime) && rightTime !== leftTime) return rightTime - leftTime;
      return cleanString(right?.weekKey, 20).localeCompare(cleanString(left?.weekKey, 20));
    })[0] || null;
}

function buildHistoricalAxisFallbackRawScores({ profile = null, now } = {}) {
  const snapshot = getLatestSeasonSnapshot(profile || {});
  const weekly = getLatestWeeklyRollup(profile || {});
  const capturedAt = snapshot?.capturedAt || snapshot?.dayKey || weekly?.endDayKey || weekly?.weekKey || null;
  if (!snapshot && !weekly) {
    return { scores: {}, capturedAt: null, dataAgeDays: null, ageDebuffPercent: 90 };
  }

  const weeklyScore = normalizeNullableFiniteNumber(weekly?.composite?.score);
  const approvedKills = normalizeNullableFiniteNumber(snapshot?.approvedKills);
  const killTier = normalizeNullableFiniteNumber(snapshot?.killTier);
  const jjsMinutes7d = normalizeNullableFiniteNumber(snapshot?.jjsMinutes7d ?? snapshot?.dayJjsMinutes);
  const activityScore = normalizeNullableFiniteNumber(snapshot?.activityScore);
  const messages7d = normalizeNullableFiniteNumber(snapshot?.messages7d);
  const sessions7d = normalizeNullableFiniteNumber(snapshot?.sessions7d);
  const activeDays7d = normalizeNullableFiniteNumber(snapshot?.activeDays7d);
  const serverFriendsCount = normalizeNullableFiniteNumber(snapshot?.serverFriendsCount);
  const peerCount = Array.isArray(snapshot?.topCoPlayPeerUserIds) ? snapshot.topCoPlayPeerUserIds.length : normalizeNullableFiniteNumber(snapshot?.peerCount);
  const suggestionCount = normalizeNullableFiniteNumber(snapshot?.socialSuggestionCount);
  const dataAgeDays = resolveDataAgeDays(capturedAt, now);

  const scores = {};
  scores.form = Number.isFinite(jjsMinutes7d) || Number.isFinite(activityScore)
    ? Math.min(55, Math.max(0, Number(jjsMinutes7d) || 0) / 8) + Math.min(35, Math.max(0, Number(activityScore) || 0) / 3)
    : weeklyScore;
  scores.chat = Number.isFinite(messages7d) || Number.isFinite(sessions7d) || Number.isFinite(activeDays7d)
    ? Math.min(55, Math.max(0, Number(messages7d) || 0)) + Math.min(25, Math.max(0, Number(sessions7d) || 0) * 2.5) + Math.min(20, Math.max(0, Number(activeDays7d) || 0) * (20 / 7))
    : weeklyScore;
  scores.kills = Number.isFinite(killTier) || Number.isFinite(approvedKills)
    ? Math.min(72, Math.max(0, Number(killTier) || 0) * 18) + Math.min(18, Math.log10(Math.max(1, (Number(approvedKills) || 0) + 1)) * 6)
    : weeklyScore;
  scores.stability = weeklyScore;
  scores.growth = weeklyScore;
  scores.social = Number.isFinite(serverFriendsCount) || Number.isFinite(peerCount) || Number.isFinite(suggestionCount)
    ? Math.min(40, Math.max(0, Number(serverFriendsCount) || 0) * 8) + Math.min(35, Math.max(0, Number(peerCount) || 0) * 8) + Math.min(20, Math.max(0, Number(suggestionCount) || 0) * 5)
    : weeklyScore;

  return {
    scores,
    capturedAt,
    dataAgeDays,
    ageDebuffPercent: computeAgeDebuffPercent(dataAgeDays),
  };
}

function buildAxisStateWithHistoricalFallback(rawScore = null, populationScores = [], options = {}) {
  if (Number.isFinite(normalizeNullableFiniteNumber(rawScore))) {
    return {
      ...buildPopulationCalibratedAxisState(rawScore, populationScores, options),
      isHistoricalFallback: false,
      dataAgeDays: 0,
    };
  }

  const historicalScore = normalizeNullableFiniteNumber(options.historicalRawScore);
  if (!Number.isFinite(historicalScore)) {
    return buildPopulationCalibratedAxisState(rawScore, populationScores, options);
  }

  const ageDebuff = normalizeInfluenceDebuffPercent(options.ageDebuffPercent, 90);
  const fallbackState = buildPopulationCalibratedAxisState(historicalScore, populationScores, {
    freshnessState: "outdated",
    influenceDebuffPercent: ageDebuff,
    trustSource: "season_archive",
  });
  return {
    ...fallbackState,
    isHistoricalFallback: true,
    dataAgeDays: normalizeNullableFiniteNumber(options.dataAgeDays),
    historicalCapturedAt: cleanString(options.capturedAt, 80) || null,
    historicalRawScore: historicalScore,
    confidenceState: ageDebuff >= 55 ? "outdated" : "partial",
    freshnessState: "outdated",
    influenceDebuffPercent: Math.min(90, Math.max(normalizeInfluenceDebuffPercent(fallbackState.influenceDebuffPercent, 0), ageDebuff)),
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

function parseIsoDayKey(value) {
  const text = cleanString(value, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return NaN;
  const [year, month, day] = text.split("-").map((entry) => Number(entry));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return NaN;
  return Date.UTC(year, month - 1, day, 12, 0, 0, 0);
}

function shiftIsoDayKey(value, offsetDays = 0) {
  const timestamp = parseIsoDayKey(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp + Math.trunc(offsetDays) * MS_PER_DAY).toISOString().slice(0, 10);
}

function formatDayLabel(value) {
  const timestamp = parseIsoDayKey(value);
  if (!Number.isFinite(timestamp)) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(timestamp));
}

function formatDayRangeLabel(startDayKey, endDayKey) {
  const startLabel = formatDayLabel(startDayKey);
  const endLabel = formatDayLabel(endDayKey);
  if (startLabel === "—") return endLabel;
  if (endLabel === "—") return startLabel;
  return `${startLabel}-${endLabel}`;
}

function computeDaySpan(firstDayKey, lastDayKey) {
  const firstTimestamp = parseIsoDayKey(firstDayKey);
  const lastTimestamp = parseIsoDayKey(lastDayKey);
  if (!Number.isFinite(firstTimestamp) || !Number.isFinite(lastTimestamp) || lastTimestamp < firstTimestamp) return null;
  return Math.round((lastTimestamp - firstTimestamp) / MS_PER_DAY) + 1;
}

function getSeasonArchiveSnapshots(profile = {}) {
  return (Array.isArray(profile?.domains?.seasonArchive?.snapshots) ? profile.domains.seasonArchive.snapshots : [])
    .filter((entry) => cleanString(entry?.dayKey, 20))
    .slice()
    .sort((left, right) => cleanString(left?.dayKey, 20).localeCompare(cleanString(right?.dayKey, 20)));
}

function getSeasonArchiveWeeklyRollups(profile = {}) {
  return (Array.isArray(profile?.domains?.seasonArchive?.weeklyRollups) ? profile.domains.seasonArchive.weeklyRollups : [])
    .filter((entry) => cleanString(entry?.weekKey, 20))
    .slice()
    .sort((left, right) => cleanString(left?.weekKey, 20).localeCompare(cleanString(right?.weekKey, 20)));
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

function computeProofGapInfluenceDebuff({ proofAgeHours = null, jjsGapHours = null, hasReliableJjsGap = false } = {}) {
  const normalizedProofAgeHours = normalizeFiniteNumber(proofAgeHours);
  const normalizedJjsGapHours = normalizeFiniteNumber(jjsGapHours);
  const ageDebuff = Number.isFinite(normalizedProofAgeHours)
    ? (normalizedProofAgeHours <= 72
      ? 0
      : ((Math.min(normalizedProofAgeHours, 30 * 24) - 72) / ((30 * 24) - 72)) * 60)
    : 90;
  let activityDebuff = 0;

  if (hasReliableJjsGap && Number.isFinite(normalizedJjsGapHours)) {
    activityDebuff = normalizedJjsGapHours <= 10
      ? 0
      : ((Math.min(normalizedJjsGapHours, 60) - 10) / 50) * 90;
  } else if (!hasReliableJjsGap) {
    activityDebuff = Number.isFinite(normalizedProofAgeHours) && normalizedProofAgeHours <= 7 * 24 ? 15 : 45;
  }

  return Math.round(clampScore(Math.max(ageDebuff, activityDebuff), 0, 90));
}

function resolveProofGapFreshnessState(debuffPercent = 0) {
  const debuff = normalizeInfluenceDebuffPercent(debuffPercent, 0);
  if (debuff <= 0) return "fresh";
  if (debuff <= 30) return "partial";
  if (debuff < 90) return "stale";
  return "outdated";
}

function buildProofGapState({
  latestProofWindow = null,
  approvedKills = null,
  hoursSinceLastApprovedKillsUpdate = null,
  jjsHoursSinceLastApprovedKillsUpdate = null,
  hasReliableJjsSinceLastApproved = false,
} = {}) {
  const normalizedApprovedKills = normalizeNullableFiniteNumber(approvedKills);
  if (!latestProofWindow) {
    return {
      hasProof: false,
      latestApprovedKills: null,
      currentApprovedKills: normalizedApprovedKills,
      hoursSinceLastApprovedKillsUpdate: null,
      jjsHoursSinceLastApprovedKillsUpdate: null,
      hasReliableJjsSinceLastApproved: false,
      freshnessState: "unavailable",
      confidenceState: "unavailable",
      influenceDebuffPercent: 90,
      source: "proof_windows",
    };
  }

  const proofAgeHours = normalizeFiniteNumber(hoursSinceLastApprovedKillsUpdate);
  const jjsGapHours = normalizeFiniteNumber(jjsHoursSinceLastApprovedKillsUpdate);
  const influenceDebuffPercent = computeProofGapInfluenceDebuff({
    proofAgeHours,
    jjsGapHours,
    hasReliableJjsGap: hasReliableJjsSinceLastApproved,
  });
  const freshnessState = resolveProofGapFreshnessState(influenceDebuffPercent);

  return {
    hasProof: true,
    latestApprovedKills: normalizeNullableFiniteNumber(latestProofWindow?.approvedKills),
    currentApprovedKills: normalizedApprovedKills,
    reviewedAt: cleanString(latestProofWindow?.reviewedAt, 80) || null,
    hoursSinceLastApprovedKillsUpdate: proofAgeHours,
    jjsHoursSinceLastApprovedKillsUpdate: jjsGapHours,
    jjsMinutesSinceLastApprovedKillsUpdate: Number.isFinite(jjsGapHours) ? jjsGapHours * 60 : null,
    hasReliableJjsSinceLastApproved,
    freshnessState,
    confidenceState: hasReliableJjsSinceLastApproved ? "measured" : "heuristic",
    influenceDebuffPercent,
    source: hasReliableJjsSinceLastApproved ? "proof_windows+roblox.totalJjsMinutes" : "proof_windows",
  };
}

function buildProofBackedAxisTrustOptions(proofGapState = null) {
  if (!proofGapState || typeof proofGapState !== "object") return {};
  return {
    freshnessState: proofGapState.freshnessState,
    influenceDebuffPercent: proofGapState.influenceDebuffPercent,
    trustSource: "proof_gap",
  };
}

function hasUsableRobloxSummary(robloxSummary = {}) {
  const trackingState = cleanString(robloxSummary?.trackingState, 40);
  return robloxSummary?.isTrackable === true
    || trackingState === "trackable"
    || (!trackingState
      && robloxSummary?.hasVerifiedAccount === true
      && Boolean(cleanString(robloxSummary?.userId, 80))
      && Boolean(cleanString(robloxSummary?.currentUsername || robloxSummary?.username, 120)));
}

function hasExplicitRobloxActivityBlocker(robloxSummary = {}) {
  const trackingState = cleanString(robloxSummary?.trackingState, 40).toLowerCase();
  const verificationStatus = cleanString(robloxSummary?.verificationStatus, 40).toLowerCase();
  return robloxSummary?.isTrackable === false
    || ["repairable", "manual_only", "pending", "failed", "unverified"].includes(trackingState)
    || ["pending", "failed", "unverified"].includes(verificationStatus);
}

function hasUsableRobloxActivitySummary(robloxSummary = {}) {
  if (hasExplicitRobloxActivityBlocker(robloxSummary)) return false;
  if (hasUsableRobloxSummary(robloxSummary)) return true;
  return Number.isFinite(normalizeNullableFiniteNumber(robloxSummary?.jjsMinutes7d))
    || Number.isFinite(normalizeNullableFiniteNumber(robloxSummary?.totalJjsMinutes))
    || Boolean(robloxSummary?.currentSessionStartedAt || robloxSummary?.lastSeenInJjsAt);
}

function hasReliableTrackedJjsDelta(latestProofWindow = null, robloxSummary = {}) {
  const currentTotalJjsMinutes = normalizeFiniteNumber(robloxSummary?.totalJjsMinutes);
  const snapshotTotalJjsMinutes = normalizeFiniteNumber(latestProofWindow?.totalJjsMinutes);
  const trackingState = cleanString(robloxSummary?.trackingState, 40);
  const hasTrackableRoblox = robloxSummary?.isTrackable === true
    || trackingState === "trackable"
    || ((robloxSummary?.isTrackable !== false && !trackingState)
      && (robloxSummary?.hasVerifiedAccount === true
        || (cleanString(robloxSummary?.verificationStatus, 40) === "verified" && Boolean(cleanString(robloxSummary?.userId, 80)))))
    ;

  return latestProofWindow?.playtimeTracked === true
    && hasTrackableRoblox
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
  const amount = normalizeNullableFiniteNumber(approvedKills);
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
  const amount = normalizeNullableFiniteNumber(approvedKills);
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
  const hasUsableRoblox = hasUsableRobloxActivitySummary(robloxSummary);
  const jjsMinutes7d = hasUsableRoblox ? normalizeFiniteNumber(robloxSummary?.jjsMinutes7d) : null;
  const activityScore = normalizeFiniteNumber(activitySummary?.activityScore);
  const hoursSinceLastApproved = normalizeNullableFiniteNumber(progressState?.hoursSinceLastApprovedKillsUpdate);
  const hoursSinceLastSeenInJjs = hasUsableRoblox
    ? computeElapsedHours(robloxSummary?.currentSessionStartedAt || robloxSummary?.lastSeenInJjsAt, now)
    : null;

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
    const approvedKills = normalizeNullableFiniteNumber(profile?.approvedKills ?? onboardingSummary.approvedKills);
    const killTier = normalizeNullableFiniteNumber(profile?.killTier ?? onboardingSummary.killTier);
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
  profile = null,
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
  const proofBackedTrust = buildProofBackedAxisTrustOptions(progressState?.proofGap);
  const historicalFallback = buildHistoricalAxisFallbackRawScores({ profile, now });
  const fallbackOptions = (axisName, baseOptions = {}) => ({
    ...baseOptions,
    historicalRawScore: historicalFallback.scores?.[axisName],
    capturedAt: historicalFallback.capturedAt,
    dataAgeDays: historicalFallback.dataAgeDays,
    ageDebuffPercent: historicalFallback.ageDebuffPercent,
  });

  return {
    form: buildAxisStateWithHistoricalFallback(rawScores.form, populationSamples.form, fallbackOptions("form")),
    chat: buildAxisStateWithHistoricalFallback(rawScores.chat, populationSamples.chat, fallbackOptions("chat")),
    kills: buildAxisStateWithHistoricalFallback(rawScores.kills, populationSamples.kills, fallbackOptions("kills", proofBackedTrust)),
    stability: buildAxisStateWithHistoricalFallback(rawScores.stability, populationSamples.stability, fallbackOptions("stability", proofBackedTrust)),
    growth: buildAxisStateWithHistoricalFallback(rawScores.growth, populationSamples.growth, fallbackOptions("growth", proofBackedTrust)),
    social: buildAxisStateWithHistoricalFallback(rawScores.social, populationSamples.social, fallbackOptions("social")),
  };
}

function buildWeeklyArchetypeHint(profile = null) {
  const windows = getComparableComebackWindows(profile);
  if (windows.length < 3) return null;

  const latest = windows.at(-1);
  const activeStreakCount = countTrailingActiveWindows(windows);
  const minCoverage = windows.reduce((min, entry) => {
    const coverage = normalizeFiniteNumber(entry?.coveragePercent);
    return Number.isFinite(coverage) ? Math.min(min, coverage) : min;
  }, 100);
  if (minCoverage < 50) {
    return `weekly baseline sparse (${formatNumber(windows.length)}w, min coverage ${formatPercent(minCoverage, 0)})`;
  }

  const flags = {
    returnedAfterDrop: hasRecentLowToActiveTransition(windows),
    recoveredAfterPause: hasRecentLowToActiveTransition(windows, { pauseOnly: true }),
    activeStreak: activeStreakCount >= 3,
    slowingDown: hasThreeWindowSlowdown(windows),
    coolingOff: hasCoolingOff(windows),
  };
  const labels = [];
  if (flags.recoveredAfterPause) labels.push("восстановился после паузы");
  else if (flags.returnedAfterDrop) labels.push("вернулся после просадки");
  if (flags.activeStreak) labels.push(`держит ${formatNumber(activeStreakCount)}w серию`);
  if (flags.slowingDown) labels.push("замедляется 3 окна подряд");
  else if (flags.coolingOff) labels.push("остывает второе окно");
  if (!labels.length && latest?.isActive) labels.push("активная неделя");
  if (!labels.length && latest?.isLow) labels.push("слабая неделя");
  if (!labels.length) labels.push("без резкого weekly-сдвига");

  const trust = minCoverage >= 85 ? "reliable" : "partial";
  return `weekly baseline: ${labels.join(", ")} (${latest.weekKey} ${latest.grade}, ${trust})`;
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
  const weeklyHint = buildWeeklyArchetypeHint(profile);
  if (weeklyHint) parts.push(weeklyHint);
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
  if (hasUsableRobloxSummary(robloxSummary) && cleanString(robloxSummary?.currentUsername, 120)) {
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
    parts.push(`${formatJjsHoursFromMinutes(topPeer.minutesTogether)} вместе`);
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
  const mainWikiCount = links.filter((entry) => entry?.kind === "wiki").length;
  const hasGeneralGuide = links.some((entry) => entry?.kind === "general");
  const parts = [];

  if (mains.length) {
    parts.push(`гайды ${formatNumber(Math.min(mainGuideCount, mains.length))}/${formatNumber(mains.length)} по мейнам`);
    if (mainWikiCount) {
      parts.push(`wiki ${formatNumber(Math.min(mainWikiCount, mains.length))}/${formatNumber(mains.length)} по мейнам`);
    }
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

function buildSocialSuggestionsIntroLine({ suggestions = [], robloxSummary = {} } = {}) {
  const suggestionCount = Array.isArray(suggestions) ? suggestions.length : 0;
  const serverFriendsCount = normalizeFiniteNumber(robloxSummary?.serverFriendsCount);
  if (!suggestionCount) {
    if (Number.isFinite(serverFriendsCount) && serverFriendsCount > 0) {
      return `Скрытый круг: явных frequent non-friend пересечений пока не видно, хотя Roblox-друзья на сервере уже есть (${formatNumber(serverFriendsCount)}).`;
    }
    return "Скрытый круг: frequent non-friend пересечения в JJS пока не накопились.";
  }

  const parts = [`Скрытый круг: ${formatNumber(suggestionCount)} кандидата по частым пересечениям в JJS`];
  if (Number.isFinite(serverFriendsCount)) {
    parts.push(`Roblox-друзей на сервере: ${formatNumber(serverFriendsCount)}`);
  }
  parts.push("это не точный кооп, а frequent non-friend сигнал");
  return parts.join(" • ");
}

function buildSocialSuggestionEntryLine(entry = {}, index = 0) {
  const ordinal = Number(index) + 1;
  const parts = [`${ordinal}. <@${cleanString(entry?.peerUserId, 80) || "unknown"}>`];
  const displayName = cleanString(entry?.peerDisplayName, 120);
  const robloxUsername = cleanString(entry?.peerRobloxUsername, 120);
  const minutesTogether = normalizeFiniteNumber(entry?.minutesTogether);
  const sessionsTogether = normalizeFiniteNumber(entry?.sharedJjsSessionCount, normalizeFiniteNumber(entry?.sessionsTogether));

  if (displayName && displayName !== cleanString(entry?.peerUserId, 80)) {
    parts.push(displayName);
  }
  if (robloxUsername) {
    parts.push(`Roblox ${robloxUsername}`);
  }
  if (Number.isFinite(minutesTogether) && minutesTogether > 0) {
    parts.push(`${formatJjsHoursFromMinutes(minutesTogether)} вместе`);
  }
  if (Number.isFinite(sessionsTogether) && sessionsTogether > 0) {
    parts.push(`${formatNumber(sessionsTogether)} общ. сесс.`);
  }
  if (entry?.peerHasVerifiedRoblox === true) {
    parts.push("verified Roblox");
  }

  return parts.join(" • ");
}

function buildSocialSuggestionsFreshnessLine(suggestions = [], now) {
  const latestComputedAt = (Array.isArray(suggestions) ? suggestions : [])
    .map((entry) => cleanString(entry?.sourceComputedAt, 80))
    .filter(Boolean)
    .sort()
    .at(-1);
  if (!latestComputedAt) return null;

  const hoursSinceComputed = computeElapsedHours(latestComputedAt, now);
  if (!Number.isFinite(hoursSinceComputed)) {
    return null;
  }
  if (hoursSinceComputed <= 24) {
    return `Social-срез: обновлялся ~${formatHours(hoursSinceComputed)} ч назад.`;
  }
  return `Social-срез: уже ~${formatHours(hoursSinceComputed)} ч назад, так что часть пересечений могла устареть.`;
}

function buildSocialSuggestionsBlock({ profile = null, robloxSummary = {}, isSelf = false, now } = {}) {
  const domainSuggestions = Array.isArray(profile?.domains?.social?.suggestions) ? profile.domains.social.suggestions : [];
  const summarySuggestions = Array.isArray(profile?.summary?.social?.suggestions) ? profile.summary.social.suggestions : [];
  const suggestions = (domainSuggestions.length ? domainSuggestions : summarySuggestions).slice(0, 3);

  if (!suggestions.length && isSelf) {
    return {
      title: "Скрытый круг",
      lines: [buildSocialSuggestionsIntroLine({ suggestions, robloxSummary })],
    };
  }
  if (!suggestions.length && !Number.isFinite(normalizeFiniteNumber(robloxSummary?.serverFriendsCount))) {
    return null;
  }

  const lines = [buildSocialSuggestionsIntroLine({ suggestions, robloxSummary })];
  for (let index = 0; index < suggestions.length; index += 1) {
    lines.push(buildSocialSuggestionEntryLine(suggestions[index], index));
  }
  const freshnessLine = buildSocialSuggestionsFreshnessLine(suggestions, now);
  if (freshnessLine) {
    lines.push(freshnessLine);
  }

  return {
    title: "Скрытый круг",
    lines,
  };
}

function buildFriendOverlapState({ robloxSummary = {}, populationProfiles = [] } = {}) {
  const serverFriendRobloxIds = [...new Set(
    (Array.isArray(robloxSummary?.serverFriendsUserIds) ? robloxSummary.serverFriendsUserIds : [])
      .map((entry) => cleanString(entry, 80))
      .filter(Boolean)
  )];
  const overlapSet = new Set(serverFriendRobloxIds);
  const overlaps = [];
  const seenDiscordUserIds = new Set();

  for (const entry of normalizePopulationProfileEntries(populationProfiles)) {
    const profile = entry?.profile && typeof entry.profile === "object" ? entry.profile : {};
    const summary = profile?.summary && typeof profile.summary === "object" ? profile.summary : {};
    const activitySummary = summary?.activity && typeof summary.activity === "object" ? summary.activity : {};
    const summaryRoblox = summary?.roblox && typeof summary.roblox === "object" ? summary.roblox : {};
    const domainRoblox = profile?.domains?.roblox && typeof profile.domains.roblox === "object" ? profile.domains.roblox : {};
    const discordUserId = cleanString(entry?.userId, 80);
    const robloxUserId = cleanString(summaryRoblox?.userId || domainRoblox?.userId, 80);
    if (!discordUserId || !robloxUserId || !overlapSet.has(robloxUserId) || seenDiscordUserIds.has(discordUserId)) continue;
    seenDiscordUserIds.add(discordUserId);

    const jjsMinutes7d = normalizeFiniteNumber(summaryRoblox?.jjsMinutes7d);
    const messages7d = normalizeFiniteNumber(activitySummary?.messages7d);
    const sessions7d = normalizeFiniteNumber(activitySummary?.sessions7d);

    overlaps.push({
      userId: discordUserId,
      displayName: cleanString(summary?.preferredDisplayName || profile?.displayName || profile?.username || discordUserId, 120),
      robloxUsername: cleanString(summaryRoblox?.currentUsername || summaryRoblox?.username || domainRoblox?.username, 120),
      hasVerifiedRoblox: summaryRoblox?.hasVerifiedAccount === true
        || (cleanString(summaryRoblox?.verificationStatus || domainRoblox?.verificationStatus, 40) === "verified" && Boolean(robloxUserId)),
      appliedActivityRoleKey: cleanString(activitySummary?.appliedActivityRoleKey || activitySummary?.desiredActivityRoleKey, 80),
      messages7d,
      sessions7d,
      jjsMinutes7d,
      isActive7d: (Number.isFinite(messages7d) && messages7d > 0)
        || (Number.isFinite(sessions7d) && sessions7d > 0)
        || (Number.isFinite(jjsMinutes7d) && jjsMinutes7d > 0),
      playedJjs7d: Number.isFinite(jjsMinutes7d) && jjsMinutes7d > 0,
    });
  }

  overlaps.sort((left, right) => {
    if (right.playedJjs7d !== left.playedJjs7d) return right.playedJjs7d ? 1 : -1;
    if (right.isActive7d !== left.isActive7d) return right.isActive7d ? 1 : -1;
    const jjsDiff = (Number(right.jjsMinutes7d) || 0) - (Number(left.jjsMinutes7d) || 0);
    if (jjsDiff) return jjsDiff;
    const messageDiff = (Number(right.messages7d) || 0) - (Number(left.messages7d) || 0);
    if (messageDiff) return messageDiff;
    return cleanString(left.displayName, 120).localeCompare(cleanString(right.displayName, 120), "ru");
  });

  return {
    totalServerFriends: Number.isFinite(normalizeFiniteNumber(robloxSummary?.serverFriendsCount))
      ? normalizeFiniteNumber(robloxSummary.serverFriendsCount)
      : serverFriendRobloxIds.length,
    overlaps,
    verifiedCount: overlaps.filter((entry) => entry.hasVerifiedRoblox === true).length,
    active7dCount: overlaps.filter((entry) => entry.isActive7d === true).length,
    jjs7dCount: overlaps.filter((entry) => entry.playedJjs7d === true).length,
    computedAt: cleanString(robloxSummary?.serverFriendsComputedAt, 80) || null,
  };
}

function buildFriendOverlapFreshnessLine(state = {}, now) {
  const hoursSinceComputed = computeElapsedHours(state?.computedAt, now);
  if (!Number.isFinite(hoursSinceComputed)) return null;
  if (hoursSinceComputed <= 24) {
    return `Список друзей обновлялся ~${formatHours(hoursSinceComputed)} ч назад.`;
  }
  return `Список друзей уже ~${formatHours(hoursSinceComputed)} ч не обновлялся, так что часть overlap могла устареть.`;
}

function buildFriendOverlapBlock({ robloxSummary = {}, populationProfiles = [], now } = {}) {
  const state = buildFriendOverlapState({ robloxSummary, populationProfiles });
  if (!Number.isFinite(state.totalServerFriends) || state.totalServerFriends <= 0) {
    return null;
  }

  const lines = [
    [
      `Roblox-друзей на сервере: ${formatNumber(state.totalServerFriends)}`,
      `видимых профилей: ${formatNumber(state.overlaps.length)}`,
      `verified: ${formatNumber(state.verifiedCount)}`,
      `активны 7д: ${formatNumber(state.active7dCount)}`,
      `играли в JJS 7д: ${formatNumber(state.jjs7dCount)}`,
    ].join(" • "),
  ];

  const freshnessLine = buildFriendOverlapFreshnessLine(state, now);
  if (freshnessLine) lines.push(freshnessLine);

  return {
    title: "Roblox-друзья на сервере",
    lines,
  };
}

function buildFriendOverlapEntryLine(entry = {}, index = 0) {
  const parts = [`${Number(index) + 1}. <@${cleanString(entry?.userId, 80) || "unknown"}>`];
  const displayName = cleanString(entry?.displayName, 120);
  const robloxUsername = cleanString(entry?.robloxUsername, 120);
  if (displayName && displayName !== cleanString(entry?.userId, 80)) {
    parts.push(displayName);
  }
  if (robloxUsername) {
    parts.push(`Roblox ${robloxUsername}`);
  }
  if (entry?.hasVerifiedRoblox === true) {
    parts.push("verified Roblox");
  }
  if (Number.isFinite(entry?.jjsMinutes7d) && entry.jjsMinutes7d > 0) {
    parts.push(`JJS 7д ${formatJjsHoursFromMinutes(entry.jjsMinutes7d)}`);
  }
  if (cleanString(entry?.appliedActivityRoleKey, 80)) {
    parts.push(`activity ${cleanString(entry.appliedActivityRoleKey, 80)}`);
  } else if (Number.isFinite(entry?.messages7d) && entry.messages7d > 0) {
    parts.push(`${formatNumber(entry.messages7d)} msg 7д`);
  }
  return parts.join(" • ");
}

function buildFriendsAlreadyHereBlock({ robloxSummary = {}, populationProfiles = [] } = {}) {
  const state = buildFriendOverlapState({ robloxSummary, populationProfiles });
  if (!state.overlaps.length) return null;

  return {
    title: "Кто из друзей уже здесь",
    lines: state.overlaps.slice(0, 3).map((entry, index) => buildFriendOverlapEntryLine(entry, index)),
  };
}

function getTopCoPlayPeers(robloxSummary = {}) {
  return (Array.isArray(robloxSummary?.topCoPlayPeers) ? robloxSummary.topCoPlayPeers : [])
    .filter((entry) => cleanString(entry?.peerUserId, 80));
}

function getSharedJjsSessionCount(peer = {}) {
  return Math.max(
    normalizeFiniteNumber(peer?.sharedJjsSessionCount, 0),
    normalizeFiniteNumber(peer?.sessionsTogether, 0)
  );
}

function hasCoPlaySignal(peer = {}) {
  return (Number.isFinite(Number(peer?.minutesTogether)) && Number(peer.minutesTogether) > 0)
    || getSharedJjsSessionCount(peer) > 0
    || (Number.isFinite(Number(peer?.daysTogether)) && Number(peer.daysTogether) > 0);
}

function buildCoPlayPeerMap(robloxSummary = {}) {
  const map = new Map();
  for (const peer of getTopCoPlayPeers(robloxSummary)) {
    const peerUserId = cleanString(peer?.peerUserId, 80);
    if (!peerUserId || map.has(peerUserId)) continue;
    map.set(peerUserId, peer);
  }
  return map;
}

function buildSocialFreshnessConfidence(timestamps = [], now) {
  const latestTimestamp = (Array.isArray(timestamps) ? timestamps : [])
    .map((entry) => cleanString(entry, 80))
    .filter(Boolean)
    .sort()
    .at(-1);
  if (!latestTimestamp) return "heuristic";

  const hoursSinceCaptured = computeElapsedHours(latestTimestamp, now);
  if (!Number.isFinite(hoursSinceCaptured)) return "heuristic";
  if (hoursSinceCaptured <= 24) return "reliable";
  if (hoursSinceCaptured <= 168) return "partial";
  return "outdated";
}

function buildSocialTieFromOverlap(overlap = {}, peer = null, labels = []) {
  const userId = cleanString(overlap?.userId, 80);
  if (!userId) return null;

  const minutesTogether = normalizeFiniteNumber(peer?.minutesTogether);
  const sessionsTogether = getSharedJjsSessionCount(peer || {});
  return {
    userId,
    displayName: cleanString(overlap?.displayName, 120),
    robloxUsername: cleanString(overlap?.robloxUsername, 120),
    labels: [...labels],
    minutesTogether,
    sessionsTogether,
    jjsMinutes7d: normalizeFiniteNumber(overlap?.jjsMinutes7d),
    lastSeenTogetherAt: cleanString(peer?.lastSeenTogetherAt, 80),
  };
}

function buildSocialTieFromPeer(peer = {}, labels = []) {
  const userId = cleanString(peer?.peerUserId, 80);
  if (!userId) return null;

  return {
    userId,
    displayName: cleanString(peer?.peerDisplayName, 120),
    robloxUsername: cleanString(peer?.peerRobloxUsername, 120),
    labels: [...labels],
    minutesTogether: normalizeFiniteNumber(peer?.minutesTogether),
    sessionsTogether: getSharedJjsSessionCount(peer),
    jjsMinutes7d: null,
    lastSeenTogetherAt: cleanString(peer?.lastSeenTogetherAt, 80),
  };
}

function buildSocialTieFromSuggestion(entry = {}, labels = []) {
  const userId = cleanString(entry?.peerUserId, 80);
  if (!userId) return null;

  return {
    userId,
    displayName: cleanString(entry?.peerDisplayName, 120),
    robloxUsername: cleanString(entry?.peerRobloxUsername, 120),
    labels: [...labels],
    minutesTogether: normalizeFiniteNumber(entry?.minutesTogether),
    sessionsTogether: normalizeFiniteNumber(entry?.sharedJjsSessionCount, normalizeFiniteNumber(entry?.sessionsTogether)),
    jjsMinutes7d: null,
    lastSeenTogetherAt: cleanString(entry?.lastSeenTogetherAt, 80),
  };
}

function getSocialGraphTies(profile = null) {
  const domainTies = Array.isArray(profile?.domains?.social?.graph?.ties) ? profile.domains.social.graph.ties : [];
  const summaryTies = Array.isArray(profile?.summary?.social?.graph?.ties) ? profile.summary.social.graph.ties : [];
  return (domainTies.length ? domainTies : summaryTies)
    .map((entry) => {
      const userId = cleanString(entry?.peerUserId ?? entry?.userId, 80);
      if (!userId) return null;
      return {
        userId,
        displayName: cleanString(entry?.peerDisplayName ?? entry?.displayName, 120),
        robloxUsername: cleanString(entry?.peerRobloxUsername, 120),
        labels: Array.isArray(entry?.labels) ? entry.labels.map((label) => cleanString(label, 80)).filter(Boolean) : [],
        strength: cleanString(entry?.strength, 40) || "inferred",
        mutualFriendUserIds: Array.isArray(entry?.mutualFriendUserIds)
          ? entry.mutualFriendUserIds.map((item) => cleanString(item, 80)).filter(Boolean)
          : [],
        minutesTogether: normalizeFiniteNumber(entry?.minutesTogether),
        sessionsTogether: normalizeFiniteNumber(entry?.sessionsTogether),
        voiceSecondsTogether: normalizeFiniteNumber(entry?.voiceSecondsTogether),
        voiceSessionsTogether: normalizeFiniteNumber(entry?.voiceSessionsTogether),
        lastSeenTogetherAt: cleanString(entry?.lastSeenTogetherAt, 80),
        sourceComputedAt: cleanString(entry?.sourceComputedAt, 80),
      };
    })
    .filter(Boolean);
}

function buildSocialTieFromGraph(entry = {}, labels = []) {
  const userId = cleanString(entry?.userId ?? entry?.peerUserId, 80);
  if (!userId) return null;
  return {
    userId,
    displayName: cleanString(entry?.displayName ?? entry?.peerDisplayName, 120),
    robloxUsername: cleanString(entry?.robloxUsername ?? entry?.peerRobloxUsername, 120),
    labels: [...(Array.isArray(entry?.labels) ? entry.labels : []), ...labels],
    minutesTogether: normalizeFiniteNumber(entry?.minutesTogether),
    sessionsTogether: normalizeFiniteNumber(entry?.sessionsTogether),
    jjsMinutes7d: null,
    voiceSecondsTogether: normalizeFiniteNumber(entry?.voiceSecondsTogether),
    voiceSessionsTogether: normalizeFiniteNumber(entry?.voiceSessionsTogether),
    mutualFriendUserIds: Array.isArray(entry?.mutualFriendUserIds) ? entry.mutualFriendUserIds : [],
    lastSeenTogetherAt: cleanString(entry?.lastSeenTogetherAt, 80),
  };
}

function enrichSocialTieWithGraph(tie = null, graphTie = null) {
  if (!tie || !graphTie) return tie;
  return {
    ...tie,
    displayName: cleanString(tie.displayName, 120) || cleanString(graphTie.displayName, 120),
    robloxUsername: cleanString(tie.robloxUsername, 120) || cleanString(graphTie.robloxUsername, 120),
    labels: [...new Set([
      ...(Array.isArray(tie.labels) ? tie.labels : []),
      ...(Array.isArray(graphTie.labels) ? graphTie.labels : []),
    ].map((entry) => cleanString(entry, 80)).filter(Boolean))],
    minutesTogether: Number.isFinite(Number(tie.minutesTogether)) ? tie.minutesTogether : graphTie.minutesTogether,
    sessionsTogether: Number.isFinite(Number(tie.sessionsTogether)) ? tie.sessionsTogether : graphTie.sessionsTogether,
    voiceSecondsTogether: normalizeFiniteNumber(tie.voiceSecondsTogether, graphTie.voiceSecondsTogether),
    voiceSessionsTogether: normalizeFiniteNumber(tie.voiceSessionsTogether, graphTie.voiceSessionsTogether),
    mutualFriendUserIds: [...new Set([
      ...(Array.isArray(tie.mutualFriendUserIds) ? tie.mutualFriendUserIds : []),
      ...(Array.isArray(graphTie.mutualFriendUserIds) ? graphTie.mutualFriendUserIds : []),
    ].map((entry) => cleanString(entry, 80)).filter(Boolean))],
    lastSeenTogetherAt: cleanString(tie.lastSeenTogetherAt, 80) || cleanString(graphTie.lastSeenTogetherAt, 80),
  };
}

function pushUniqueSocialTie(target = [], seen = new Set(), tie = null) {
  if (!tie?.userId || seen.has(tie.userId)) return;
  seen.add(tie.userId);
  target.push(tie);
}

function sortSocialTies(left = {}, right = {}) {
  const leftScore = (Number(left.minutesTogether) || 0)
    + (Number(left.sessionsTogether) || 0) * 20
    + (Number(left.jjsMinutes7d) || 0) * 0.5
    + (Number(left.voiceSecondsTogether) || 0) / 60
    + (Array.isArray(left.mutualFriendUserIds) ? left.mutualFriendUserIds.length : 0) * 30;
  const rightScore = (Number(right.minutesTogether) || 0)
    + (Number(right.sessionsTogether) || 0) * 20
    + (Number(right.jjsMinutes7d) || 0) * 0.5
    + (Number(right.voiceSecondsTogether) || 0) / 60
    + (Array.isArray(right.mutualFriendUserIds) ? right.mutualFriendUserIds.length : 0) * 30;
  if (rightScore !== leftScore) return rightScore - leftScore;
  return cleanString(left.displayName || left.userId, 120).localeCompare(cleanString(right.displayName || right.userId, 120), "ru");
}

function formatSocialTie(tie = {}) {
  const parts = [`<@${cleanString(tie?.userId, 80) || "unknown"}>`];
  const displayName = cleanString(tie?.displayName, 120);
  const robloxUsername = cleanString(tie?.robloxUsername, 120);
  if (displayName && displayName !== cleanString(tie?.userId, 80)) {
    parts.push(displayName);
  }
  if (robloxUsername) {
    parts.push(`Roblox ${robloxUsername}`);
  }
  for (const label of Array.isArray(tie?.labels) ? tie.labels : []) {
    const normalized = cleanString(label, 80);
    if (normalized) parts.push(normalized);
  }
  if (Number.isFinite(Number(tie?.minutesTogether)) && Number(tie.minutesTogether) > 0) {
    parts.push(`${formatJjsHoursFromMinutes(tie.minutesTogether)} вместе`);
  }
  if (Number.isFinite(Number(tie?.sessionsTogether)) && Number(tie.sessionsTogether) > 0) {
    parts.push(`${formatNumber(tie.sessionsTogether)} общ. сесс.`);
  }
  if (Number.isFinite(Number(tie?.voiceSecondsTogether)) && Number(tie.voiceSecondsTogether) > 0) {
    parts.push(`voice ${formatHours(Number(tie.voiceSecondsTogether) / 3600)} h`);
  }
  if (Number.isFinite(Number(tie?.voiceSessionsTogether)) && Number(tie.voiceSessionsTogether) > 0) {
    parts.push(`${formatNumber(tie.voiceSessionsTogether)} voice sess.`);
  }
  const mutualCount = Array.isArray(tie?.mutualFriendUserIds) ? tie.mutualFriendUserIds.length : 0;
  if (mutualCount > 0) {
    parts.push(`mutual friends ${formatNumber(mutualCount)}`);
  }
  if (Number.isFinite(Number(tie?.jjsMinutes7d)) && Number(tie.jjsMinutes7d) > 0) {
    parts.push(`JJS 7д ${formatJjsHoursFromMinutes(tie.jjsMinutes7d)}`);
  }
  return parts.join(" • ");
}

function buildSocialTieListLine(label = "", ties = [], emptyText = "нет явных связей") {
  const items = (Array.isArray(ties) ? ties : []).slice(0, 3);
  if (!items.length) return `${label}: ${emptyText}`;
  return `${label}: ${items.map((entry) => formatSocialTie(entry)).join("; ")}`;
}

function buildVerifiedCircleBlock({ robloxSummary = {}, populationProfiles = [], now } = {}) {
  const state = buildFriendOverlapState({ robloxSummary, populationProfiles });
  if (!Number.isFinite(state.totalServerFriends) || state.totalServerFriends <= 0) {
    return null;
  }

  const coPlayByUserId = buildCoPlayPeerMap(robloxSummary);
  const verifiedCircle = state.overlaps
    .filter((entry) => entry?.hasVerifiedRoblox === true)
    .filter((entry) => entry?.playedJjs7d === true || hasCoPlaySignal(coPlayByUserId.get(entry.userId)))
    .map((entry) => buildSocialTieFromOverlap(entry, coPlayByUserId.get(entry.userId), ["verified Roblox", "Roblox-друг"]))
    .filter(Boolean)
    .sort(sortSocialTies);

  const lines = [
    [
      `Проверенный круг: verified+friend+JJS ${formatNumber(verifiedCircle.length)}`,
      `verified friends ${formatNumber(state.verifiedCount)}`,
      `active 7д ${formatNumber(state.active7dCount)}`,
      `JJS 7д ${formatNumber(state.jjs7dCount)}`,
    ].join(" • "),
  ];

  if (verifiedCircle.length) {
    lines.push(buildSocialTieListLine("Топ verified ties", verifiedCircle));
  } else if (state.verifiedCount > 0) {
    lines.push("Verified-друзья есть, но связка verified+friend+JJS пока не подтверждена.");
  } else {
    lines.push("Verified-друзья среди видимых профилей пока не найдены.");
  }

  const freshnessLine = buildFriendOverlapFreshnessLine(state, now);
  if (freshnessLine) lines.push(freshnessLine);
  lines.push(`Trust: ${buildSocialFreshnessConfidence([state.computedAt], now)} • sources verified Roblox + server friends + JJS overlap • no exact party claim.`);

  return {
    title: "Проверенный круг",
    lines,
  };
}

function getSocialSuggestions(profile = null) {
  const domainSuggestions = Array.isArray(profile?.domains?.social?.suggestions) ? profile.domains.social.suggestions : [];
  const summarySuggestions = Array.isArray(profile?.summary?.social?.suggestions) ? profile.summary.social.suggestions : [];
  return (domainSuggestions.length ? domainSuggestions : summarySuggestions).slice(0, 5);
}

function buildSocialMapBlock({ profile = null, robloxSummary = {}, populationProfiles = [], now } = {}) {
  const friendState = buildFriendOverlapState({ robloxSummary, populationProfiles });
  const coPlayPeers = getTopCoPlayPeers(robloxSummary);
  const coPlayByUserId = buildCoPlayPeerMap(robloxSummary);
  const suggestions = getSocialSuggestions(profile);
  const graphTies = getSocialGraphTies(profile);
  const graphByUserId = new Map(graphTies.map((entry) => [entry.userId, entry]));
  if (!friendState.overlaps.length && !coPlayPeers.length && !suggestions.length && !graphTies.length) {
    return null;
  }

  const strong = [];
  const medium = [];
  const inferred = [];
  const seenStrong = new Set();
  const seenMedium = new Set();
  const seenInferred = new Set();

  for (const overlap of friendState.overlaps) {
    const peer = coPlayByUserId.get(overlap.userId);
    if (overlap?.playedJjs7d === true || hasCoPlaySignal(peer)) {
      const labels = ["Roblox-друг"];
      if (overlap?.hasVerifiedRoblox === true) labels.unshift("verified Roblox");
      pushUniqueSocialTie(strong, seenStrong, enrichSocialTieWithGraph(
        buildSocialTieFromOverlap(overlap, peer, labels),
        graphByUserId.get(overlap.userId)
      ));
      continue;
    }
    if (overlap?.isActive7d === true) {
      const labels = ["Roblox-друг", "active"];
      if (overlap?.hasVerifiedRoblox === true) labels.unshift("verified Roblox");
      pushUniqueSocialTie(medium, seenMedium, enrichSocialTieWithGraph(
        buildSocialTieFromOverlap(overlap, peer, labels),
        graphByUserId.get(overlap.userId)
      ));
    }
  }

  for (const peer of coPlayPeers) {
    if (seenStrong.has(cleanString(peer?.peerUserId, 80))) continue;
    if (peer?.isRobloxFriend === true && hasCoPlaySignal(peer)) {
      pushUniqueSocialTie(strong, seenStrong, enrichSocialTieWithGraph(
        buildSocialTieFromPeer(peer, ["Roblox-друг"]),
        graphByUserId.get(cleanString(peer?.peerUserId, 80))
      ));
      continue;
    }
    if (peer?.isFrequentNonFriend === true || hasCoPlaySignal(peer)) {
      pushUniqueSocialTie(medium, seenMedium, enrichSocialTieWithGraph(
        buildSocialTieFromPeer(peer, [peer?.isFrequentNonFriend === true ? "частый non-friend" : "JJS peer"]),
        graphByUserId.get(cleanString(peer?.peerUserId, 80))
      ));
    }
  }

  for (const suggestion of suggestions) {
    const peerUserId = cleanString(suggestion?.peerUserId, 80);
    if (!peerUserId || seenStrong.has(peerUserId) || seenMedium.has(peerUserId)) continue;
    pushUniqueSocialTie(inferred, seenInferred, enrichSocialTieWithGraph(
      buildSocialTieFromSuggestion(suggestion, ["inferred"]),
      graphByUserId.get(peerUserId)
    ));
  }

  for (const graphTie of graphTies) {
    const peerUserId = cleanString(graphTie?.userId, 80);
    if (!peerUserId || seenStrong.has(peerUserId) || seenMedium.has(peerUserId) || seenInferred.has(peerUserId)) continue;
    const tie = buildSocialTieFromGraph(graphTie, ["persisted graph"]);
    if (graphTie.strength === "strong") {
      pushUniqueSocialTie(strong, seenStrong, tie);
    } else if (graphTie.strength === "medium") {
      pushUniqueSocialTie(medium, seenMedium, tie);
    } else {
      pushUniqueSocialTie(inferred, seenInferred, tie);
    }
  }

  strong.sort(sortSocialTies);
  medium.sort(sortSocialTies);
  inferred.sort(sortSocialTies);

  const socialComputedAtValues = [
    friendState.computedAt,
    profile?.domains?.social?.graph?.computedAt,
    ...suggestions.map((entry) => entry?.sourceComputedAt),
    ...coPlayPeers.map((entry) => entry?.lastSeenTogetherAt),
    ...graphTies.map((entry) => entry?.sourceComputedAt || entry?.lastSeenTogetherAt),
  ];
  const mutualTieCount = graphTies.filter((entry) => Array.isArray(entry?.mutualFriendUserIds) && entry.mutualFriendUserIds.length > 0).length;
  const lines = [
    [
      `Социальная карта: strong ${formatNumber(strong.length)}`,
      `medium ${formatNumber(medium.length)}`,
      `friends here ${formatNumber(friendState.overlaps.length)}`,
      `inferred ${formatNumber(inferred.length)}`,
      `mutual ${formatNumber(mutualTieCount)}`,
    ].join(" • "),
    buildSocialTieListLine("Strong ties", strong),
    buildSocialTieListLine("Medium ties", medium),
    buildSocialTieListLine("Inferred ties", inferred, "нет inferred ties"),
    `Trust: ${buildSocialFreshnessConfidence(socialComputedAtValues, now)} • sources Roblox friends/co-play/social suggestions + persisted graph • no exact party claim.`,
  ];

  return {
    title: "Социальная карта",
    lines,
  };
}

function normalizeVoiceContactEntries(profile = null) {
  const rawContacts = Array.isArray(profile?.domains?.voice?.contacts)
    ? profile.domains.voice.contacts
    : (Array.isArray(profile?.summary?.voice?.contacts) ? profile.summary.voice.contacts : []);

  return rawContacts
    .map((entry) => {
      const peerUserId = cleanString(entry?.peerUserId ?? entry?.userId, 80);
      if (!peerUserId) return null;
      return {
        peerUserId,
        displayName: cleanString(entry?.peerDisplayName ?? entry?.displayName, 120),
        voiceSecondsTogether: normalizeFiniteNumber(entry?.voiceSecondsTogether ?? entry?.durationSecondsTogether ?? entry?.durationSeconds ?? entry?.secondsTogether, 0),
        voiceSessionsTogether: normalizeFiniteNumber(entry?.voiceSessionsTogether ?? entry?.sessionCount ?? entry?.sessionsTogether, 0),
        lastSeenTogetherAt: cleanString(entry?.lastSeenTogetherAt ?? entry?.lastVoiceSeenAt, 80),
        sourceComputedAt: cleanString(entry?.sourceComputedAt ?? entry?.computedAt, 80),
      };
    })
    .filter(Boolean);
}

function hasVoiceSummarySignal(voiceSummary = {}, activitySummary = {}) {
  return voiceSummary?.isInVoiceNow === true
    || Boolean(cleanString(voiceSummary?.lastVoiceSeenAt, 80))
    || Boolean(cleanString(voiceSummary?.lastCapturedAt, 80))
    || (Number.isFinite(Number(voiceSummary?.voiceDurationSeconds30d)) && Number(voiceSummary.voiceDurationSeconds30d) > 0)
    || (Number.isFinite(Number(voiceSummary?.sessionCount30d)) && Number(voiceSummary.sessionCount30d) > 0)
    || (Number.isFinite(Number(activitySummary?.effectiveVoiceHours30d)) && Number(activitySummary.effectiveVoiceHours30d) > 0);
}

function formatVoiceGameOverlapEntry(entry = {}) {
  const parts = [`<@${cleanString(entry?.peerUserId, 80) || "unknown"}>`];
  const displayName = cleanString(entry?.displayName, 120);
  if (displayName && displayName !== cleanString(entry?.peerUserId, 80)) {
    parts.push(displayName);
  }
  if (Number.isFinite(Number(entry?.voiceSecondsTogether)) && Number(entry.voiceSecondsTogether) > 0) {
    parts.push(`voice ${formatHours(Number(entry.voiceSecondsTogether) / 3600)} ч`);
  }
  if (Number.isFinite(Number(entry?.voiceSessionsTogether)) && Number(entry.voiceSessionsTogether) > 0) {
    parts.push(`${formatNumber(entry.voiceSessionsTogether)} voice сесс.`);
  }
  if (Number.isFinite(Number(entry?.minutesTogether)) && Number(entry.minutesTogether) > 0) {
    parts.push(`JJS ${formatJjsHoursFromMinutes(entry.minutesTogether)}`);
  }
  if (Number.isFinite(Number(entry?.sessionsTogether)) && Number(entry.sessionsTogether) > 0) {
    parts.push(`${formatNumber(entry.sessionsTogether)} JJS сесс.`);
  }
  return parts.join(" • ");
}

function buildVoiceGameOverlapBlock({ profile = null, robloxSummary = {}, voiceSummary = {}, activitySummary = {}, now } = {}) {
  const voiceContacts = normalizeVoiceContactEntries(profile);
  const coPlayByUserId = buildCoPlayPeerMap(robloxSummary);
  const coPlayPeers = getTopCoPlayPeers(robloxSummary);
  const hasVoiceSignal = hasVoiceSummarySignal(voiceSummary, activitySummary);
  const hasJjsOverlap = coPlayPeers.some((entry) => hasCoPlaySignal(entry));

  if (!voiceContacts.length) {
    if (!hasVoiceSignal && !hasJjsOverlap) return null;
    return {
      title: "Voice + game overlap",
      lines: [
        [
          "Voice + JJS overlap: ждёт voice contact source",
          `JJS overlap ${hasJjsOverlap ? "есть" : "нет"}`,
          `voice summary ${hasVoiceSignal ? "есть" : "нет"}`,
        ].join(" • "),
        "Trust: unavailable • source gap: profile.domains.voice.contacts[] • person-level voice ties пока не заявляем.",
      ],
    };
  }

  const overlaps = voiceContacts
    .map((contact) => {
      const peer = coPlayByUserId.get(contact.peerUserId);
      if (!peer || !hasCoPlaySignal(peer)) return null;
      return {
        ...contact,
        minutesTogether: normalizeFiniteNumber(peer?.minutesTogether, 0),
        sessionsTogether: getSharedJjsSessionCount(peer),
        lastSeenTogetherAt: cleanString(peer?.lastSeenTogetherAt, 80) || contact.lastSeenTogetherAt,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const rightScore = (Number(right.voiceSecondsTogether) || 0) + (Number(right.minutesTogether) || 0) * 60;
      const leftScore = (Number(left.voiceSecondsTogether) || 0) + (Number(left.minutesTogether) || 0) * 60;
      if (rightScore !== leftScore) return rightScore - leftScore;
      return cleanString(left.peerUserId, 80).localeCompare(cleanString(right.peerUserId, 80), "ru");
    });

  const confidence = buildSocialFreshnessConfidence([
    ...voiceContacts.map((entry) => entry?.sourceComputedAt || entry?.lastSeenTogetherAt),
    ...coPlayPeers.map((entry) => entry?.lastSeenTogetherAt),
  ], now);
  const lines = [
    [
      `Voice + JJS overlap: ${formatNumber(overlaps.length)} совпадений`,
      `voice contacts ${formatNumber(voiceContacts.length)}`,
      `JJS peers ${formatNumber(coPlayPeers.length)}`,
    ].join(" • "),
  ];
  if (overlaps.length) {
    lines.push(`Overlap ties: ${overlaps.slice(0, 3).map((entry) => formatVoiceGameOverlapEntry(entry)).join("; ")}`);
  } else {
    lines.push("Voice contacts есть, но с JJS co-play peers они пока не пересеклись.");
  }
  lines.push(`Trust: ${confidence} • sources profile.domains.voice.contacts[] + Roblox co-play • no exact party claim.`);

  return {
    title: "Voice + game overlap",
    lines,
  };
}

function buildSocialEvolutionRangeLine(snapshots = []) {
  const items = Array.isArray(snapshots) ? snapshots : [];
  if (!items.length) return null;
  const firstDayKey = cleanString(items[0]?.dayKey, 20);
  const lastDayKey = cleanString(items.at(-1)?.dayKey, 20);
  return `Соц-архив: ${formatNumber(items.length)} дневных срезов • ${formatDayRangeLabel(firstDayKey, lastDayKey)}`;
}

function getSocialEvolutionCount(snapshot = {}, fieldName = "serverFriendsCount") {
  const value = normalizeFiniteNumber(snapshot?.[fieldName]);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function buildSocialEvolutionDeltaLabel(delta = 0) {
  const amount = Number(delta) || 0;
  if (amount > 0) return `+${formatNumber(amount)}`;
  if (amount < 0) return `-${formatNumber(Math.abs(amount))}`;
  return formatNumber(amount);
}

function findPeakSocialSnapshot(snapshots = []) {
  let best = null;

  for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
    const peerCount = Array.isArray(snapshot?.topCoPlayPeerUserIds) ? snapshot.topCoPlayPeerUserIds.length : 0;
    const friendCount = getSocialEvolutionCount(snapshot, "serverFriendsCount");
    const suggestionCount = getSocialEvolutionCount(snapshot, "socialSuggestionCount");
    const totalScore = peerCount * 100 + friendCount * 10 + suggestionCount;

    if (!best) {
      best = { snapshot, totalScore, peerCount, friendCount, suggestionCount };
      continue;
    }

    if (totalScore > best.totalScore) {
      best = { snapshot, totalScore, peerCount, friendCount, suggestionCount };
      continue;
    }

    if (totalScore === best.totalScore
      && cleanString(snapshot?.dayKey, 20).localeCompare(cleanString(best.snapshot?.dayKey, 20)) > 0) {
      best = { snapshot, totalScore, peerCount, friendCount, suggestionCount };
    }
  }

  return best;
}

function buildSocialEvolutionBlock({ profile = null } = {}) {
  const snapshots = getSeasonArchiveSnapshots(profile);
  if (!snapshots.length) return null;

  const firstSnapshot = snapshots[0];
  const latestSnapshot = snapshots.at(-1);
  const firstPeers = new Set(Array.isArray(firstSnapshot?.topCoPlayPeerUserIds) ? firstSnapshot.topCoPlayPeerUserIds.map((entry) => cleanString(entry, 80)).filter(Boolean) : []);
  const latestPeers = new Set(Array.isArray(latestSnapshot?.topCoPlayPeerUserIds) ? latestSnapshot.topCoPlayPeerUserIds.map((entry) => cleanString(entry, 80)).filter(Boolean) : []);
  const retainedPeers = [...latestPeers].filter((entry) => firstPeers.has(entry)).length;
  const newPeers = [...latestPeers].filter((entry) => !firstPeers.has(entry)).length;
  const droppedPeers = [...firstPeers].filter((entry) => !latestPeers.has(entry)).length;
  const firstPeerCount = firstPeers.size;
  const latestPeerCount = latestPeers.size;
  const firstFriendCount = getSocialEvolutionCount(firstSnapshot, "serverFriendsCount");
  const latestFriendCount = getSocialEvolutionCount(latestSnapshot, "serverFriendsCount");
  const firstSuggestionCount = getSocialEvolutionCount(firstSnapshot, "socialSuggestionCount");
  const latestSuggestionCount = getSocialEvolutionCount(latestSnapshot, "socialSuggestionCount");
  const peak = findPeakSocialSnapshot(snapshots);

  const lines = [buildSocialEvolutionRangeLine(snapshots)];
  if (snapshots.length < 7) {
    lines.push(`Социальная эволюция: история ещё короткая (${formatNumber(snapshots.length)}/7 дневных срезов).`);
    return {
      title: "Социальная эволюция",
      lines: lines.filter(Boolean),
    };
  }

  lines.push(
    [
      `Игровой круг: ${formatNumber(firstPeerCount)} -> ${formatNumber(latestPeerCount)} частых напарн. (${buildSocialEvolutionDeltaLabel(latestPeerCount - firstPeerCount)})`,
      `Roblox-друзей: ${formatNumber(firstFriendCount)} -> ${formatNumber(latestFriendCount)} (${buildSocialEvolutionDeltaLabel(latestFriendCount - firstFriendCount)})`,
      `скрытый круг: ${formatNumber(firstSuggestionCount)} -> ${formatNumber(latestSuggestionCount)} (${buildSocialEvolutionDeltaLabel(latestSuggestionCount - firstSuggestionCount)})`,
    ].join(" • ")
  );

  lines.push(
    [
      `Смена ядра: удержались ${formatNumber(retainedPeers)}`,
      `новых ${formatNumber(newPeers)}`,
      `выпало ${formatNumber(droppedPeers)}`,
      "считается только по top peer archive, не по всему social graph",
    ].join(" • ")
  );

  if (peak?.snapshot) {
    lines.push(
      [
        `Пик круга: ${formatDayLabel(peak.snapshot.dayKey)}`,
        `${formatNumber(peak.peerCount)} частых напарн.`,
        `Roblox-друзей ${formatNumber(peak.friendCount)}`,
        `кандидатов ${formatNumber(peak.suggestionCount)}`,
      ].join(" • ")
    );
  }

  return {
    title: "Социальная эволюция",
    lines: lines.filter(Boolean),
  };
}

function formatVoiceHoursFromSeconds(value, digits = 1) {
  const seconds = normalizeFiniteNumber(value);
  if (!Number.isFinite(seconds)) return "—";
  return `${formatHours(seconds / 3600, digits)} ч`;
}

function formatChannelMention(channelId) {
  const normalized = cleanString(channelId, 80);
  return normalized ? `<#${normalized}>` : null;
}

function buildVoiceTopChannelsLine(topChannels = [], limit = 3) {
  const items = (Array.isArray(topChannels) ? topChannels : [])
    .slice(0, Math.max(1, Number(limit) || 3))
    .map((entry) => {
      const channelMention = formatChannelMention(entry?.channelId);
      if (!channelMention) return null;
      const sessionCount = normalizeFiniteNumber(entry?.sessionCount);
      return `${channelMention}${Number.isFinite(sessionCount) ? ` (${formatNumber(sessionCount)})` : ""}`;
    })
    .filter(Boolean);

  if (!items.length) return null;
  return `Топ voice-каналы: ${items.join(", ")}`;
}

function buildVoiceFreshnessLine(voiceSummary = {}, now) {
  const hoursSinceCaptured = computeElapsedHours(voiceSummary?.lastCapturedAt, now);
  if (!Number.isFinite(hoursSinceCaptured)) return null;
  if (hoursSinceCaptured <= 24) {
    return `Voice-срез обновлялся ~${formatHours(hoursSinceCaptured)} ч назад.`;
  }
  return `Voice-срез уже ~${formatHours(hoursSinceCaptured)} ч не обновлялся, так что часть voice-активности могла не попасть.`;
}

function buildVoiceSummaryBlock({ voiceSummary = {}, activitySummary = {}, now } = {}) {
  const summary = voiceSummary && typeof voiceSummary === "object" ? voiceSummary : {};
  const activity = activitySummary && typeof activitySummary === "object" ? activitySummary : {};
  const sessionCount7d = normalizeFiniteNumber(summary.sessionCount7d);
  const sessionCount30d = normalizeFiniteNumber(summary.sessionCount30d);
  const incompleteSessionCount30d = normalizeFiniteNumber(summary.incompleteSessionCount30d);
  const voiceDurationSeconds7d = normalizeFiniteNumber(summary.voiceDurationSeconds7d);
  const voiceDurationSeconds30d = normalizeFiniteNumber(summary.voiceDurationSeconds30d);
  const lifetimeSessionCount = normalizeFiniteNumber(summary.lifetimeSessionCount);
  const effectiveVoiceHours30d = normalizeNullableFiniteNumber(activity.effectiveVoiceHours30d);
  const effectiveActiveVoiceSignalHours30d = normalizeNullableFiniteNumber(activity.effectiveActiveVoiceSignalHours30d);
  const voiceEngagementRatio30d = normalizeNullableFiniteNumber(activity.voiceEngagementRatio30d);
  const voiceEngagementMultiplier = normalizeNullableFiniteNumber(activity.voiceEngagementMultiplier);
  const voicePart = normalizeNullableFiniteNumber(activity.voicePart);
  const activeVoicePart = normalizeNullableFiniteNumber(activity.activeVoicePart);
  const topChannels = Array.isArray(summary.topChannels) ? summary.topChannels : [];
  const hasSignal = summary.isInVoiceNow === true
    || Boolean(summary.lastVoiceSeenAt)
    || topChannels.length > 0
    || (Number.isFinite(sessionCount7d) && sessionCount7d > 0)
    || (Number.isFinite(sessionCount30d) && sessionCount30d > 0)
    || (Number.isFinite(voiceDurationSeconds7d) && voiceDurationSeconds7d > 0)
    || (Number.isFinite(voiceDurationSeconds30d) && voiceDurationSeconds30d > 0)
    || (Number.isFinite(lifetimeSessionCount) && lifetimeSessionCount > 0);
  if (!hasSignal) return null;

  const lines = [];
  const totalsBits = [];
  if (Number.isFinite(voiceDurationSeconds7d) || Number.isFinite(voiceDurationSeconds30d)) {
    totalsBits.push(`Voice 7д/30д: ${formatVoiceHoursFromSeconds(voiceDurationSeconds7d)} / ${formatVoiceHoursFromSeconds(voiceDurationSeconds30d)}`);
  }
  if (Number.isFinite(sessionCount7d) || Number.isFinite(sessionCount30d)) {
    totalsBits.push(`сессии 7д/30д: ${formatNumber(sessionCount7d)} / ${formatNumber(sessionCount30d)}`);
  }
  if (Number.isFinite(lifetimeSessionCount) && lifetimeSessionCount > 0) {
    totalsBits.push(`lifetime сессии: ${formatNumber(lifetimeSessionCount)}`);
  }
  if (Number.isFinite(incompleteSessionCount30d) && incompleteSessionCount30d > 0) {
    totalsBits.push(`неполных 30д: ${formatNumber(incompleteSessionCount30d)}`);
  }
  if (totalsBits.length) {
    lines.push(totalsBits.join(" • "));
  }

  const explainBits = [];
  if (Number.isFinite(effectiveVoiceHours30d)) {
    explainBits.push(`effective 30д ${formatHours(effectiveVoiceHours30d)} ч`);
  }
  if (Number.isFinite(effectiveActiveVoiceSignalHours30d)) {
    explainBits.push(`active signal ${formatHours(effectiveActiveVoiceSignalHours30d)} ч`);
  }
  if (Number.isFinite(voiceEngagementRatio30d)) {
    explainBits.push(`engagement ${formatPercent(voiceEngagementRatio30d * 100)}`);
  }
  if (Number.isFinite(voiceEngagementMultiplier)) {
    explainBits.push(`x${formatHours(voiceEngagementMultiplier, 2)}`);
  }
  if (explainBits.length) {
    lines.push(`В score: ${explainBits.join(" • ")}`);
  }

  if (Number.isFinite(voicePart) || Number.isFinite(activeVoicePart)) {
    lines.push(`Voice credit: ${formatHours(voicePart)} + ${formatHours(activeVoicePart)} очков`);
  }

  const statusBits = [];
  if (summary.isInVoiceNow === true) {
    statusBits.push(`Сейчас в voice: ${formatChannelMention(summary.currentChannelId) || "канал не определён"}`);
    if (summary.currentSessionStartedAt) {
      statusBits.push(`с ${formatDateTime(summary.currentSessionStartedAt)}`);
    }
  } else if (summary.lastVoiceSeenAt) {
    statusBits.push(`Последний voice: ${formatDateTime(summary.lastVoiceSeenAt)}`);
  }
  if (summary.lastSessionEndedAt && summary.isInVoiceNow !== true) {
    statusBits.push(`последняя завершённая сессия ${formatDateTime(summary.lastSessionEndedAt)}`);
  }
  if (statusBits.length) {
    lines.push(statusBits.join(" • "));
  }

  const topChannelsLine = buildVoiceTopChannelsLine(topChannels, 3);
  if (topChannelsLine) {
    lines.push(topChannelsLine);
  }

  const freshnessLine = buildVoiceFreshnessLine(summary, now);
  if (freshnessLine) {
    lines.push(freshnessLine);
  }

  return {
    title: "Voice-срез",
    lines,
  };
}

function buildActivityMixState({ activitySummary = {}, robloxSummary = {}, voiceSummary = {} } = {}) {
  const messages30d = normalizeNullableFiniteNumber(activitySummary?.messages30d);
  const jjsMinutes30d = normalizeNullableFiniteNumber(robloxSummary?.jjsMinutes30d);
  const voiceSeconds30d = normalizeNullableFiniteNumber(
    voiceSummary?.voiceDurationSeconds30d
      ?? activitySummary?.voiceDurationSeconds30d
      ?? (Number.isFinite(Number(activitySummary?.effectiveVoiceHours30d)) ? Number(activitySummary.effectiveVoiceHours30d) * 3600 : null)
  );
  const chatScore = Number.isFinite(messages30d) ? Math.min(1.5, Math.max(0, messages30d) / 300) : null;
  const jjsScore = Number.isFinite(jjsMinutes30d) ? Math.min(1.5, Math.max(0, jjsMinutes30d) / 1200) : null;
  const voiceScore = Number.isFinite(voiceSeconds30d) ? Math.min(1.5, Math.max(0, voiceSeconds30d) / (20 * 3600)) : null;
  const availableScores = [chatScore, jjsScore, voiceScore].filter((entry) => Number.isFinite(entry));
  const totalScore = availableScores.reduce((sum, entry) => sum + entry, 0);
  if (!availableScores.length || totalScore <= 0) return null;

  const chatShare = Number.isFinite(chatScore) ? (chatScore / totalScore) * 100 : null;
  const jjsShare = Number.isFinite(jjsScore) ? (jjsScore / totalScore) * 100 : null;
  const voiceShare = Number.isFinite(voiceScore) ? (voiceScore / totalScore) * 100 : null;
  const discordShare = (Number(chatShare) || 0) + (Number(voiceShare) || 0);
  let balanceLabel = "смешанный режим";
  if (Number.isFinite(jjsShare) && jjsShare >= 55 && jjsShare - discordShare >= 15) {
    balanceLabel = "больше JJS";
  } else if (discordShare >= 60 && discordShare - (Number(jjsShare) || 0) >= 15) {
    balanceLabel = Number(voiceShare) > Number(chatShare) * 1.15 ? "больше Discord voice" : "больше Discord chat";
  } else if (Number.isFinite(jjsShare) && Math.abs(discordShare - jjsShare) <= 15) {
    balanceLabel = "ровно Discord + JJS";
  }

  const sourceCount = availableScores.length;
  return {
    messages30d,
    jjsMinutes30d,
    voiceSeconds30d,
    chatShare,
    jjsShare,
    voiceShare,
    discordShare,
    balanceLabel,
    confidenceState: sourceCount >= 3 ? "reliable" : sourceCount === 2 ? "partial" : "heuristic",
    sourceCount,
  };
}

function buildActivityMixBlock({ activitySummary = {}, robloxSummary = {}, voiceSummary = {} } = {}) {
  const state = buildActivityMixState({ activitySummary, robloxSummary, voiceSummary });
  if (!state) return null;

  const rawBits = [];
  if (Number.isFinite(state.jjsMinutes30d)) rawBits.push(`JJS ${formatHours(state.jjsMinutes30d / 60)} ч 30д`);
  if (Number.isFinite(state.messages30d)) rawBits.push(`chat ${formatNumber(state.messages30d)} msg 30д`);
  if (Number.isFinite(state.voiceSeconds30d)) rawBits.push(`voice ${formatHours(state.voiceSeconds30d / 3600)} ч 30д`);

  const shareBits = [];
  if (Number.isFinite(state.chatShare)) shareBits.push(`chat ${buildShareBar(state.chatShare)} ${formatPercent(state.chatShare, 0)}`);
  if (Number.isFinite(state.jjsShare)) shareBits.push(`JJS ${buildShareBar(state.jjsShare)} ${formatPercent(state.jjsShare, 0)}`);
  if (Number.isFinite(state.voiceShare)) shareBits.push(`voice ${buildShareBar(state.voiceShare)} ${formatPercent(state.voiceShare, 0)}`);

  return {
    title: "Activity mix",
    lines: [
      `Discord vs Roblox: ${state.balanceLabel}`,
      rawBits.join(" • "),
      `Шкала: ${shareBits.join(" • ")} • доверие ${state.confidenceState}`,
    ].filter(Boolean),
  };
}

function listDailyJjsBuckets(profile = null) {
  return Object.entries(profile?.domains?.roblox?.playtime?.dailyBuckets || {})
    .filter(([dayKey, minutes]) => /^\d{4}-\d{2}-\d{2}$/.test(dayKey) && Number(minutes) > 0)
    .map(([dayKey, minutes]) => ({
      dayKey,
      minutes: Number(minutes) || 0,
    }))
    .sort((left, right) => left.dayKey.localeCompare(right.dayKey));
}

function sumNumbers(values = []) {
  return (Array.isArray(values) ? values : []).reduce((sum, value) => {
    const amount = normalizeFiniteNumber(value, 0);
    return Number.isFinite(amount) ? sum + amount : sum;
  }, 0);
}

function listJjsSessionHistory(profile = null) {
  return (Array.isArray(profile?.domains?.roblox?.playtime?.sessionHistory) ? profile.domains.roblox.playtime.sessionHistory : [])
    .map((entry) => {
      const durationMinutes = normalizeFiniteNumber(entry?.durationMinutes);
      if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return null;
      return {
        startedAt: cleanString(entry?.startedAt, 80),
        endedAt: cleanString(entry?.endedAt, 80),
        durationMinutes,
        gameId: cleanString(entry?.gameId, 120),
      };
    })
    .filter(Boolean)
    .sort((left, right) => cleanString(left.endedAt, 80).localeCompare(cleanString(right.endedAt, 80)));
}

function medianNumber(values = []) {
  const items = (Array.isArray(values) ? values : [])
    .map((entry) => normalizeFiniteNumber(entry))
    .filter((entry) => Number.isFinite(entry))
    .sort((left, right) => left - right);
  if (!items.length) return null;
  const middle = Math.floor(items.length / 2);
  return items.length % 2 ? items[middle] : (items[middle - 1] + items[middle]) / 2;
}

function buildFarmProfileState({ profile = null, robloxSummary = {} } = {}) {
  const dailyBuckets = listDailyJjsBuckets(profile);
  const hourlyBuckets = listHourlyMskBuckets(profile);
  const sessionHistory = listJjsSessionHistory(profile);
  const sessionDurations = sessionHistory.map((entry) => entry.durationMinutes);
  const dailyMinutes = dailyBuckets.map((entry) => entry.minutes).filter((entry) => Number.isFinite(entry) && entry > 0);
  const hourlyMinutes = hourlyBuckets.map((entry) => entry.minutes).filter((entry) => Number.isFinite(entry) && entry > 0);
  const totalDailyMinutes = sumNumbers(dailyMinutes);
  const totalHourlyMinutes = sumNumbers(hourlyMinutes);
  const totalSessionHistoryMinutes = sumNumbers(sessionDurations);
  const summaryJjsMinutes30d = normalizeNullableFiniteNumber(robloxSummary?.jjsMinutes30d);
  const totalJjsMinutes = normalizeNullableFiniteNumber(robloxSummary?.totalJjsMinutes);
  const sessionCount = normalizeNullableFiniteNumber(robloxSummary?.sessionCount);
  const observedMinutes = totalDailyMinutes > 0
    ? totalDailyMinutes
    : (totalHourlyMinutes > 0 ? totalHourlyMinutes : (Number.isFinite(summaryJjsMinutes30d) ? summaryJjsMinutes30d : totalJjsMinutes));

  if (!Number.isFinite(observedMinutes) || observedMinutes <= 0) return null;

  const activeDays = dailyMinutes.length;
  const activeHours = hourlyMinutes.length;
  const daySpan = activeDays > 0 ? computeDaySpan(dailyBuckets[0]?.dayKey, dailyBuckets.at(-1)?.dayKey) : null;
  const dailyCoveragePercent = Number.isFinite(daySpan) && daySpan > 0 ? (activeDays / daySpan) * 100 : null;
  const averageActiveDayMinutes = activeDays > 0 ? totalDailyMinutes / activeDays : null;
  const averageActiveHourMinutes = activeHours > 0 ? totalHourlyMinutes / activeHours : null;
  const sortedDailyMinutes = dailyMinutes.slice().sort((left, right) => right - left);
  const topDayShare = totalDailyMinutes > 0 && sortedDailyMinutes[0] > 0 ? (sortedDailyMinutes[0] / totalDailyMinutes) * 100 : null;
  const top3Share = totalDailyMinutes > 0 ? (sumNumbers(sortedDailyMinutes.slice(0, 3)) / totalDailyMinutes) * 100 : null;
  const hasSessionHistogram = sessionDurations.length > 0;
  const averageSessionHistoryMinutes = hasSessionHistogram ? totalSessionHistoryMinutes / sessionDurations.length : null;
  const medianSessionMinutes = hasSessionHistogram ? medianNumber(sessionDurations) : null;
  const longSessionShare = hasSessionHistogram
    ? (sessionDurations.filter((entry) => entry >= 60).length / sessionDurations.length) * 100
    : null;
  const shortSessionShare = hasSessionHistogram
    ? (sessionDurations.filter((entry) => entry <= 25).length / sessionDurations.length) * 100
    : null;
  const averageSessionMinutes = hasSessionHistogram
    ? averageSessionHistoryMinutes
    : Number.isFinite(totalJjsMinutes) && totalJjsMinutes > 0 && Number.isFinite(sessionCount) && sessionCount > 0
      ? totalJjsMinutes / sessionCount
      : null;

  let cadenceLabel = "смешанный темп";
  if (activeDays >= 8 && Number.isFinite(top3Share) && top3Share <= 50) {
    cadenceLabel = "стабильный гриндер";
  } else if (activeDays > 0 && activeDays <= 4 && Number.isFinite(top3Share) && top3Share >= 70) {
    cadenceLabel = "вспышками";
  } else if (Number.isFinite(topDayShare) && topDayShare >= 45) {
    cadenceLabel = "одна сильная вспышка";
  }

  let sessionShapeLabel = "session shape пока неясен";
  if (Number.isFinite(averageSessionMinutes)) {
    if (averageSessionMinutes >= 60) {
      sessionShapeLabel = "длинные сессии (proxy)";
    } else if (averageSessionMinutes <= 25) {
      sessionShapeLabel = "короткие рывки (proxy)";
    } else {
      sessionShapeLabel = "средние сессии (proxy)";
    }
  } else if (Number.isFinite(averageActiveHourMinutes)) {
    if (averageActiveHourMinutes >= 45) {
      sessionShapeLabel = "длинные hourly-окна";
    } else if (averageActiveHourMinutes <= 20) {
      sessionShapeLabel = "короткие hourly-рывки";
    } else {
      sessionShapeLabel = "средние hourly-окна";
    }
  }

  if (hasSessionHistogram) {
    sessionShapeLabel = sessionShapeLabel.replace(" (proxy)", "");
  }

  const sourceCount = [
    activeDays > 0,
    activeHours > 0,
    Number.isFinite(averageSessionMinutes),
    hasSessionHistogram,
  ].filter(Boolean).length;
  const confidenceState = hasSessionHistogram && sessionDurations.length >= 5 && activeDays > 0
    ? "reliable"
    : hasSessionHistogram
      ? "partial"
      : sourceCount >= 3 ? "partial" : sourceCount === 2 ? "heuristic" : "sparse";

  return {
    cadenceLabel,
    sessionShapeLabel,
    confidenceState,
    observedMinutes,
    activeDays,
    daySpan,
    dailyCoveragePercent,
    averageActiveDayMinutes,
    activeHours,
    averageActiveHourMinutes,
    topDayShare,
    top3Share,
    averageSessionMinutes,
    medianSessionMinutes,
    longSessionShare,
    shortSessionShare,
    sessionCount,
    sessionHistoryCount: sessionDurations.length,
    hasSessionHistogram,
    hasDailyBuckets: activeDays > 0,
    hasHourlyBuckets: activeHours > 0,
    hasSessionProxy: Number.isFinite(averageSessionMinutes),
  };
}

function buildFarmProfileBlock({ profile = null, robloxSummary = {} } = {}) {
  const state = buildFarmProfileState({ profile, robloxSummary });
  if (!state) return null;

  const dailyBits = [];
  if (state.hasDailyBuckets) {
    dailyBits.push(`active days ${formatNumber(state.activeDays)}`);
    if (Number.isFinite(state.daySpan)) dailyBits.push(`span ${formatNumber(state.daySpan)}д`);
    if (Number.isFinite(state.averageActiveDayMinutes)) dailyBits.push(`avg active day ${formatHours(state.averageActiveDayMinutes / 60)} ч`);
    if (Number.isFinite(state.topDayShare)) dailyBits.push(`top day ${formatPercent(state.topDayShare, 0)}`);
    if (Number.isFinite(state.top3Share)) dailyBits.push(`top3 ${formatPercent(state.top3Share, 0)}`);
  } else {
    dailyBits.push("daily buckets missing");
  }

  const sessionBits = [];
  const sessionLineTitle = state.hasSessionHistogram ? "Session histogram" : "Session proxy";
  if (Number.isFinite(state.averageSessionMinutes)) {
    sessionBits.push(`avg ${formatJjsHoursFromMinutes(state.averageSessionMinutes)}/session`);
    if (state.hasSessionHistogram) {
      if (Number.isFinite(state.medianSessionMinutes)) sessionBits.push(`median ${formatJjsHoursFromMinutes(state.medianSessionMinutes)}`);
      if (Number.isFinite(state.longSessionShare)) sessionBits.push(`long>=60 ${formatPercent(state.longSessionShare, 0)}`);
      if (Number.isFinite(state.shortSessionShare)) sessionBits.push(`short<=25 ${formatPercent(state.shortSessionShare, 0)}`);
      sessionBits.push(`sessions ${formatNumber(state.sessionHistoryCount)}`);
    } else {
      sessionBits.push(`sessions ${formatNumber(state.sessionCount)}`);
      sessionBits.push("lifetime proxy");
    }
  } else {
    sessionBits.push("per-session histogram missing");
  }
  if (Number.isFinite(state.averageActiveHourMinutes)) {
    sessionBits.push(`avg active hour ${formatNumber(state.averageActiveHourMinutes)} мин`);
  }

  return {
    title: "Farm profile",
    lines: [
      `Farm profile: ${state.cadenceLabel} • ${state.sessionShapeLabel} • confidence ${state.confidenceState}`,
      `Daily rhythm: ${dailyBits.join(" • ")}`,
      `${sessionLineTitle}: ${sessionBits.join(" • ")}`,
      state.hasSessionHistogram
        ? "Trust: session-history • sources playtime.sessionHistory/dailyBuckets/hourlyBuckets • strong farm claim bounded by captured sessions."
        : "Trust: proxy • sources dailyBuckets/hourlyBuckets/summary.roblox.sessionCount • no strong farm claim without session histograms.",
    ],
  };
}

function listHourlyMskBuckets(profile = null) {
  return Object.entries(profile?.domains?.roblox?.playtime?.hourlyBucketsMsk || {})
    .filter(([bucketKey, minutes]) => /^\d{4}-\d{2}-\d{2}T\d{2}$/.test(bucketKey) && Number(minutes) > 0)
    .map(([bucketKey, minutes]) => ({
      bucketKey,
      minutes: Number(minutes) || 0,
      hour: Number(bucketKey.slice(11, 13)),
    }))
    .filter((entry) => Number.isFinite(entry.hour) && entry.hour >= 0 && entry.hour <= 23)
    .sort((left, right) => left.bucketKey.localeCompare(right.bucketKey));
}

function resolveMskHourKeyTimestamp(bucketKey) {
  const match = String(bucketKey || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour] = match;
  const timestamp = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour) - 3,
    0,
    0,
    0
  );
  return Number.isFinite(timestamp) ? timestamp : null;
}

function formatHourLabel(hour) {
  const normalizedHour = Number(hour);
  if (!Number.isFinite(normalizedHour)) return "—";
  return `${String(((normalizedHour % 24) + 24) % 24).padStart(2, "0")}:00`;
}

function buildPrimeTimeState({ profile = null } = {}) {
  const buckets = listHourlyMskBuckets(profile);
  if (!buckets.length) {
    return {
      buckets,
      totalMinutes: 0,
      activeHourCount: 0,
      latestBucketKey: null,
      peakHour: null,
      bestWindow: null,
      insufficient: true,
    };
  }

  const totalsByHour = Array.from({ length: 24 }, () => 0);
  let totalMinutes = 0;
  for (const entry of buckets) {
    totalsByHour[entry.hour] += entry.minutes;
    totalMinutes += entry.minutes;
  }

  const activeHourCount = totalsByHour.filter((entry) => entry > 0).length;
  const peakHour = totalsByHour.reduce((bestIndex, value, index, source) => {
    if (!Number.isFinite(source[bestIndex]) || value > source[bestIndex]) return index;
    return bestIndex;
  }, 0);

  let bestWindow = null;
  for (let startHour = 0; startHour < 24; startHour += 1) {
    let minutes = 0;
    for (let offset = 0; offset < 4; offset += 1) {
      minutes += totalsByHour[(startHour + offset) % 24] || 0;
    }
    if (!bestWindow || minutes > bestWindow.minutes) {
      bestWindow = {
        startHour,
        endHourExclusive: (startHour + 4) % 24,
        minutes,
      };
    }
  }

  return {
    buckets,
    totalMinutes,
    activeHourCount,
    latestBucketKey: buckets.at(-1)?.bucketKey || null,
    peakHour,
    bestWindow,
    insufficient: buckets.length < 3 || totalMinutes < 90,
  };
}

function buildPrimeTimeFreshnessLine(state = {}, now) {
  const latestBucketTimestamp = resolveMskHourKeyTimestamp(state?.latestBucketKey);
  const hoursSinceLatestBucket = computeElapsedHours(latestBucketTimestamp, now);
  if (!Number.isFinite(hoursSinceLatestBucket)) return null;
  if (hoursSinceLatestBucket <= 24) {
    return `Hourly-срез обновлялся ~${formatHours(hoursSinceLatestBucket)} ч назад.`;
  }
  return `Hourly-срез уже ~${formatHours(hoursSinceLatestBucket)} ч не обновлялся, так что prime time может быть неполным.`;
}

function buildPrimeTimeBlock({ profile = null, now } = {}) {
  const state = buildPrimeTimeState({ profile });
  if (!state.buckets.length) return null;

  const lines = [];
  if (state.insufficient || !state.bestWindow || state.bestWindow.minutes <= 0) {
    lines.push(`Hourly buckets пока ещё короткие: активных часов ${formatNumber(state.activeHourCount)} • tracked ${formatJjsHoursFromMinutes(state.totalMinutes)}.`);
  } else {
    lines.push(
      `Чаще всего играет с ${formatHourLabel(state.bestWindow.startHour)} до ${formatHourLabel(state.bestWindow.endHourExclusive)} МСК • окно ${formatJjsHoursFromMinutes(state.bestWindow.minutes)}`
    );
    lines.push(
      `Пиковый час: ${formatHourLabel(state.peakHour)} • активных часов: ${formatNumber(state.activeHourCount)} • tracked ${formatJjsHoursFromMinutes(state.totalMinutes)} в bucket-слое`
    );
  }

  const freshnessLine = buildPrimeTimeFreshnessLine(state, now);
  if (freshnessLine) {
    lines.push(freshnessLine);
  }

  return {
    title: "Prime time МСК",
    lines,
  };
}

function getIsoWeekKeyFromDayKey(dayKey) {
  const timestamp = parseIsoDayKey(dayKey);
  if (!Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  const isoDay = date.getUTCDay() || 7;
  const thursdayTimestamp = timestamp + (4 - isoDay) * MS_PER_DAY;
  const thursday = new Date(thursdayTimestamp);
  const year = thursday.getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1, 12, 0, 0, 0);
  const week = Math.ceil((((thursdayTimestamp - yearStart) / MS_PER_DAY) + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function buildPrimeTimeWindowSummaryFromBuckets(buckets = []) {
  const items = Array.isArray(buckets) ? buckets : [];
  const totalsByHour = Array.from({ length: 24 }, () => 0);
  let totalMinutes = 0;
  for (const entry of items) {
    const hour = normalizeFiniteNumber(entry?.hour);
    const minutes = normalizeFiniteNumber(entry?.minutes, 0);
    if (!Number.isFinite(hour) || hour < 0 || hour > 23 || !Number.isFinite(minutes) || minutes <= 0) continue;
    totalsByHour[hour] += minutes;
    totalMinutes += minutes;
  }

  const activeHourCount = totalsByHour.filter((entry) => entry > 0).length;
  const peakHour = totalsByHour.reduce((bestIndex, value, index, source) => {
    if (!Number.isFinite(source[bestIndex]) || value > source[bestIndex]) return index;
    return bestIndex;
  }, 0);

  let bestWindow = null;
  for (let startHour = 0; startHour < 24; startHour += 1) {
    let minutes = 0;
    for (let offset = 0; offset < 4; offset += 1) {
      minutes += totalsByHour[(startHour + offset) % 24] || 0;
    }
    if (!bestWindow || minutes > bestWindow.minutes) {
      bestWindow = {
        startHour,
        endHourExclusive: (startHour + 4) % 24,
        minutes,
      };
    }
  }

  return {
    totalMinutes,
    activeHourCount,
    peakHour,
    bestWindow,
    insufficient: items.length < 3 || totalMinutes < 90,
  };
}

function buildWindowHourSet(window = {}) {
  const startHour = normalizeFiniteNumber(window?.startHour);
  if (!Number.isFinite(startHour)) return new Set();
  return new Set(Array.from({ length: 4 }, (_entry, offset) => ((startHour + offset) % 24 + 24) % 24));
}

function computePrimeWindowOverlapHours(left = {}, right = {}) {
  const leftHours = buildWindowHourSet(left);
  const rightHours = buildWindowHourSet(right);
  let overlap = 0;
  for (const hour of leftHours) {
    if (rightHours.has(hour)) overlap += 1;
  }
  return overlap;
}

function buildPrimeTimeWeeklyStates(profile = null) {
  const grouped = new Map();
  for (const bucket of listHourlyMskBuckets(profile)) {
    const dayKey = cleanString(bucket?.bucketKey, 20).slice(0, 10);
    const weekKey = getIsoWeekKeyFromDayKey(dayKey);
    if (!weekKey) continue;
    if (!grouped.has(weekKey)) grouped.set(weekKey, []);
    grouped.get(weekKey).push(bucket);
  }

  return [...grouped.entries()]
    .map(([weekKey, buckets]) => ({
      weekKey,
      bucketCount: buckets.length,
      ...buildPrimeTimeWindowSummaryFromBuckets(buckets),
    }))
    .sort((left, right) => cleanString(left.weekKey, 20).localeCompare(cleanString(right.weekKey, 20)));
}

function buildPrimeTimeConfidenceBlock({ profile = null } = {}) {
  const state = buildPrimeTimeState({ profile });
  if (!state.buckets.length || !state.bestWindow) return null;

  const weeklyStates = buildPrimeTimeWeeklyStates(profile);
  const validWeeks = weeklyStates.filter((entry) => entry.bestWindow && !entry.insufficient && entry.bestWindow.minutes > 0);
  if (validWeeks.length < 2) {
    return {
      title: "Prime time confidence",
      lines: [
        [
          "Prime confidence: короткая история",
          `недель с данными ${formatNumber(validWeeks.length)}/2`,
          `hourly buckets ${formatNumber(state.buckets.length)}`,
          `tracked ${formatJjsHoursFromMinutes(state.totalMinutes)}`,
        ].join(" • "),
        "Trust: partial • нужно минимум 2 недельных среза; текущее окно не считаем устойчивым.",
      ],
    };
  }

  const matchingWeeks = validWeeks.filter((entry) => computePrimeWindowOverlapHours(entry.bestWindow, state.bestWindow) >= 3);
  const matchRatio = matchingWeeks.length / validWeeks.length;
  const label = matchRatio >= 0.67 ? "stable" : matchRatio >= 0.4 ? "mixed" : "volatile";
  const confidenceState = validWeeks.length >= 3 && matchRatio >= 0.67 ? "reliable" : "partial";
  const weeklyWindowLine = validWeeks
    .slice(-4)
    .map((entry) => `${entry.weekKey} ${formatHourLabel(entry.bestWindow.startHour)}-${formatHourLabel(entry.bestWindow.endHourExclusive)} (${formatJjsHoursFromMinutes(entry.bestWindow.minutes)})`)
    .join("; ");

  return {
    title: "Prime time confidence",
    lines: [
      [
        `Prime confidence: ${label}`,
        `${formatNumber(matchingWeeks.length)}/${formatNumber(validWeeks.length)} weeks near ${formatHourLabel(state.bestWindow.startHour)}-${formatHourLabel(state.bestWindow.endHourExclusive)} МСК`,
        `global window ${formatNumber(state.bestWindow.minutes)} мин`,
      ].join(" • "),
      weeklyWindowLine ? `Weekly windows: ${weeklyWindowLine}` : null,
      `Trust: ${confidenceState} • active hourly weeks ${formatNumber(validWeeks.length)} • no claim when hourly buckets are stale.`,
    ].filter(Boolean),
  };
}

function selectBestSeasonArchiveSnapshot(snapshots = [], metricField = "jjsMinutes7d") {
  let best = null;

  for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
    const metric = normalizeFiniteNumber(snapshot?.[metricField]);
    if (!Number.isFinite(metric) || metric <= 0) continue;

    if (!best) {
      best = snapshot;
      continue;
    }

    const bestMetric = normalizeFiniteNumber(best?.[metricField], 0);
    if (metric > bestMetric) {
      best = snapshot;
      continue;
    }

    if (metric === bestMetric) {
      const activityScore = normalizeFiniteNumber(snapshot?.activityScore, -1);
      const bestActivityScore = normalizeFiniteNumber(best?.activityScore, -1);
      if (activityScore > bestActivityScore) {
        best = snapshot;
        continue;
      }

      if (activityScore === bestActivityScore
        && cleanString(snapshot?.dayKey, 20).localeCompare(cleanString(best?.dayKey, 20)) > 0) {
        best = snapshot;
      }
    }
  }

  return best;
}

function buildBestPeriodState(snapshot = null, windowDays = 7) {
  if (!snapshot) return null;

  const normalizedWindowDays = Math.max(1, Number(windowDays) || 1);
  const endDayKey = cleanString(snapshot?.dayKey, 20);
  const startDayKey = shiftIsoDayKey(endDayKey, -(normalizedWindowDays - 1)) || endDayKey;
  const windowMinutes = normalizeFiniteNumber(
    normalizedWindowDays >= 30 ? snapshot?.jjsMinutes30d : snapshot?.jjsMinutes7d
  );
  const voiceDurationSeconds = normalizeFiniteNumber(
    normalizedWindowDays >= 30 ? snapshot?.voiceDurationSeconds30d : snapshot?.voiceDurationSeconds7d
  );
  const mainCharacterLabels = Array.isArray(snapshot?.mainCharacterLabels) ? snapshot.mainCharacterLabels : [];

  return {
    dayKey: endDayKey,
    rangeLabel: formatDayRangeLabel(startDayKey, endDayKey),
    jjsHours: Number.isFinite(windowMinutes) ? windowMinutes / 60 : null,
    activityScore: normalizeFiniteNumber(snapshot?.activityScore),
    voiceHours: Number.isFinite(voiceDurationSeconds) ? voiceDurationSeconds / 3600 : null,
    approvedKills: normalizeFiniteNumber(snapshot?.approvedKills),
    killTier: normalizeFiniteNumber(snapshot?.killTier),
    mainLabel: cleanString(mainCharacterLabels[0] || snapshot?.tierlistMainName, 120) || null,
    peerCount: Array.isArray(snapshot?.topCoPlayPeerUserIds) ? snapshot.topCoPlayPeerUserIds.length : 0,
    serverFriendsCount: normalizeFiniteNumber(snapshot?.serverFriendsCount),
    socialSuggestionCount: normalizeFiniteNumber(snapshot?.socialSuggestionCount),
  };
}

function buildBestPeriodLine(label, periodState = null, snapshotCount = 0, windowDays = 7) {
  if (!periodState) {
    if (snapshotCount < windowDays) {
      return `Пик ${label}: данные сезона ещё копятся (${formatNumber(snapshotCount)}/${formatNumber(windowDays)} дневных срезов).`;
    }
    return `Пик ${label}: в архиве ещё нет явного Roblox-окна.`;
  }

  const bits = [
    `Пик ${label}: ${periodState.rangeLabel}`,
    `${formatHours(periodState.jjsHours)} ч JJS`,
  ];
  if (Number.isFinite(periodState.activityScore)) {
    bits.push(`activity ${formatNumber(periodState.activityScore)}`);
  }
  if (Number.isFinite(periodState.voiceHours) && periodState.voiceHours > 0) {
    bits.push(`voice ${formatHours(periodState.voiceHours)} ч`);
  }
  if (Number.isFinite(periodState.peerCount) && periodState.peerCount > 0) {
    bits.push(`${formatNumber(periodState.peerCount)} частых напарн.`);
  }
  return bits.join(" • ");
}

function buildBestPeriodContourLine(label, periodState = null) {
  if (!periodState) return null;

  const bits = [];
  if (Number.isFinite(periodState.approvedKills)) {
    bits.push(`${formatNumber(periodState.approvedKills)} kills`);
  }
  if (Number.isFinite(periodState.killTier) && periodState.killTier > 0) {
    bits.push(`tier ${formatNumber(periodState.killTier)}`);
  }
  if (periodState.mainLabel) {
    bits.push(`мейн ${periodState.mainLabel}`);
  }
  if (Number.isFinite(periodState.serverFriendsCount) && periodState.serverFriendsCount > 0) {
    bits.push(`Roblox-друзей ${formatNumber(periodState.serverFriendsCount)}`);
  }
  if (Number.isFinite(periodState.socialSuggestionCount) && periodState.socialSuggestionCount > 0) {
    bits.push(`кандидатов ${formatNumber(periodState.socialSuggestionCount)}`);
  }
  if (!bits.length) return null;

  return `Контур ${label}-пика: ${bits.join(" • ")}`;
}

function buildSeasonArchiveCoverageLine(snapshots = []) {
  const items = Array.isArray(snapshots) ? snapshots : [];
  if (!items.length) return null;
  const firstDayKey = cleanString(items[0]?.dayKey, 20);
  const lastDayKey = cleanString(items.at(-1)?.dayKey, 20);
  const spanDays = computeDaySpan(firstDayKey, lastDayKey);
  const coveredDayKeys = new Set(items.map((entry) => cleanString(entry?.dayKey, 20)).filter(Boolean));
  const expectedDays = Number.isFinite(spanDays) && spanDays > 0 ? spanDays : coveredDayKeys.size;
  const coveredDays = coveredDayKeys.size;
  const missingDays = Math.max(0, expectedDays - coveredDays);
  const coveragePercent = expectedDays > 0 ? (coveredDays / expectedDays) * 100 : null;
  const fragmentedPercent = Number.isFinite(coveragePercent) ? Math.max(0, 100 - coveragePercent) : null;
  const bits = [
    `Архив сезона: ${formatNumber(items.length)} дневных срезов`,
    formatDayRangeLabel(firstDayKey, lastDayKey),
  ];
  if (Number.isFinite(coveragePercent)) {
    bits.push(`coverage ${formatPercent(coveragePercent, 0)} (${formatNumber(coveredDays)}/${formatNumber(expectedDays)} дн)`);
    bits.push(`complete ${formatPercent(coveragePercent, 0)} • fragmented ${formatPercent(fragmentedPercent, 0)}`);
  }
  if (missingDays > 0) {
    bits.push(`дыр ${formatNumber(missingDays)}`);
  } else if (expectedDays > 0) {
    bits.push("без дыр");
  }
  return bits.join(" • ");
}

function buildBestPeriodsBlock({ profile = null } = {}) {
  const snapshots = getSeasonArchiveSnapshots(profile);
  if (!snapshots.length) return null;

  const best7 = snapshots.length >= 7
    ? buildBestPeriodState(selectBestSeasonArchiveSnapshot(snapshots, "jjsMinutes7d"), 7)
    : null;
  const best30 = snapshots.length >= 30
    ? buildBestPeriodState(selectBestSeasonArchiveSnapshot(snapshots, "jjsMinutes30d"), 30)
    : null;
  const lines = [
    buildSeasonArchiveCoverageLine(snapshots),
    buildBestPeriodLine("7д", best7, snapshots.length, 7),
    buildBestPeriodContourLine("7д", best7),
    buildBestPeriodLine("30д", best30, snapshots.length, 30),
  ];

  const best30ContourLine = best30 && best30.dayKey !== best7?.dayKey
    ? buildBestPeriodContourLine("30д", best30)
    : null;
  if (best30ContourLine) {
    lines.push(best30ContourLine);
  }

  return {
    title: "Лучшие периоды",
    lines: lines.filter(Boolean),
  };
}

function buildSeasonStoryNarrative(firstSnapshot = null, latestSnapshot = null) {
  const firstKills = normalizeFiniteNumber(firstSnapshot?.approvedKills);
  const latestKills = normalizeFiniteNumber(latestSnapshot?.approvedKills);
  const firstActivity = normalizeFiniteNumber(firstSnapshot?.activityScore);
  const latestActivity = normalizeFiniteNumber(latestSnapshot?.activityScore);
  const firstPeers = Array.isArray(firstSnapshot?.topCoPlayPeerUserIds) ? firstSnapshot.topCoPlayPeerUserIds.length : 0;
  const latestPeers = Array.isArray(latestSnapshot?.topCoPlayPeerUserIds) ? latestSnapshot.topCoPlayPeerUserIds.length : 0;
  const killDelta = Number.isFinite(firstKills) && Number.isFinite(latestKills) ? latestKills - firstKills : null;
  const activityDelta = Number.isFinite(firstActivity) && Number.isFinite(latestActivity) ? latestActivity - firstActivity : null;
  const peerDelta = latestPeers - firstPeers;

  if ((Number(killDelta) || 0) > 0 && (Number(activityDelta) || 0) > 0 && peerDelta > 0) {
    return "Нарратив: сезон разогнался: kills, activity и игровой круг выросли вместе.";
  }
  if ((Number(killDelta) || 0) > 0 && (Number(activityDelta) || 0) < 0) {
    return "Нарратив: kills росли, но живая активность к концу сезона стала тише.";
  }
  if ((Number(killDelta) || 0) <= 0 && (Number(activityDelta) || 0) > 0) {
    return "Нарратив: онлайн и activity ожили, но kill-прогресс почти не сдвинулся.";
  }
  if (peerDelta > 0) {
    return "Нарратив: ядро круга стало шире, даже без резкого скачка по kills.";
  }
  return "Нарратив: сезон шёл ровно, без явного разворота по форме и кругу.";
}

function buildSeasonStoryFocusLine(firstSnapshot = null, latestSnapshot = null) {
  const firstMain = cleanString(firstSnapshot?.mainCharacterLabels?.[0] || firstSnapshot?.tierlistMainName, 120);
  const latestMain = cleanString(latestSnapshot?.mainCharacterLabels?.[0] || latestSnapshot?.tierlistMainName, 120);
  if (!firstMain && !latestMain) {
    return "Фокус сезона: main и tierlist-фокус ещё не читаются из архива.";
  }
  if (firstMain && latestMain && firstMain.toLowerCase() === latestMain.toLowerCase()) {
    return `Фокус сезона: ${latestMain} удержался главным опорным персонажем.`;
  }
  if (firstMain && latestMain) {
    return `Фокус сезона: акцент сместился с ${firstMain} на ${latestMain}.`;
  }
  return `Фокус сезона: текущий опорный персонаж — ${latestMain || firstMain}.`;
}

function buildSeasonStoryPeakLine(snapshots = []) {
  const peakSnapshot = selectBestSeasonArchiveSnapshot(snapshots, "jjsMinutes7d");
  if (!peakSnapshot) return null;

  const bits = [
    `Сильнейший срез: ${formatDayLabel(peakSnapshot.dayKey)}`,
    `${formatHours((normalizeFiniteNumber(peakSnapshot.jjsMinutes7d, 0)) / 60)} ч JJS за rolling 7д`,
  ];
  if (Number.isFinite(normalizeFiniteNumber(peakSnapshot.activityScore))) {
    bits.push(`activity ${formatNumber(peakSnapshot.activityScore)}`);
  }
  if (Number.isFinite(normalizeFiniteNumber(peakSnapshot.voiceDurationSeconds7d)) && Number(peakSnapshot.voiceDurationSeconds7d) > 0) {
    bits.push(`voice ${formatHours(Number(peakSnapshot.voiceDurationSeconds7d) / 3600)} ч`);
  }
  const peerCount = Array.isArray(peakSnapshot?.topCoPlayPeerUserIds) ? peakSnapshot.topCoPlayPeerUserIds.length : 0;
  if (peerCount > 0) {
    bits.push(`${formatNumber(peerCount)} частых напарн.`);
  }
  return bits.join(" • ");
}

function buildSeasonStoryBlock({ profile = null } = {}) {
  const snapshots = getSeasonArchiveSnapshots(profile);
  if (!snapshots.length) return null;

  const firstSnapshot = snapshots[0];
  const latestSnapshot = snapshots.at(-1);
  const firstKills = normalizeFiniteNumber(firstSnapshot?.approvedKills);
  const latestKills = normalizeFiniteNumber(latestSnapshot?.approvedKills);
  const firstActivity = normalizeFiniteNumber(firstSnapshot?.activityScore);
  const latestActivity = normalizeFiniteNumber(latestSnapshot?.activityScore);
  const firstPeers = Array.isArray(firstSnapshot?.topCoPlayPeerUserIds) ? firstSnapshot.topCoPlayPeerUserIds.length : 0;
  const latestPeers = Array.isArray(latestSnapshot?.topCoPlayPeerUserIds) ? latestSnapshot.topCoPlayPeerUserIds.length : 0;

  const lines = [buildSeasonArchiveCoverageLine(snapshots)];
  if (snapshots.length < 7) {
    lines.push(`История сезона: данные ещё копятся (${formatNumber(snapshots.length)}/7 дневных срезов).`);
    return {
      title: "История сезона",
      lines: lines.filter(Boolean),
    };
  }

  lines.push([
    `Траектория: ${formatNumber(firstKills)} -> ${formatNumber(latestKills)} kills (${formatSignedNumber((latestKills || 0) - (firstKills || 0))})`,
    `activity ${formatNumber(firstActivity)} -> ${formatNumber(latestActivity)} (${formatSignedNumber((latestActivity || 0) - (firstActivity || 0))})`,
    `${formatNumber(firstPeers)} -> ${formatNumber(latestPeers)} частых напарн.`,
  ].join(" • "));
  lines.push(buildSeasonStoryNarrative(firstSnapshot, latestSnapshot));
  lines.push(buildSeasonStoryFocusLine(firstSnapshot, latestSnapshot));
  lines.push(buildSeasonStoryPeakLine(snapshots));

  return {
    title: "История сезона",
    lines: lines.filter(Boolean),
  };
}

function selectStrongestWeeklyRollup(rollups = []) {
  return (Array.isArray(rollups) ? rollups : [])
    .slice()
    .sort((left, right) => {
      const scoreDiff = normalizeFiniteNumber(right?.composite?.score, -1) - normalizeFiniteNumber(left?.composite?.score, -1);
      if (scoreDiff) return scoreDiff;
      const coverageDiff = normalizeFiniteNumber(right?.coverage?.coveragePercent, -1) - normalizeFiniteNumber(left?.coverage?.coveragePercent, -1);
      if (coverageDiff) return coverageDiff;
      return cleanString(right?.weekKey, 20).localeCompare(cleanString(left?.weekKey, 20));
    })[0] || null;
}

function buildWeeklyRollupsBlock({ profile = null } = {}) {
  const rollups = getSeasonArchiveWeeklyRollups(profile);
  if (!rollups.length) return null;
  const strongest = selectStrongestWeeklyRollup(rollups);
  if (!strongest) return null;

  const coverage = strongest.coverage && typeof strongest.coverage === "object" ? strongest.coverage : {};
  const totals = strongest.totals && typeof strongest.totals === "object" ? strongest.totals : {};
  const composite = strongest.composite && typeof strongest.composite === "object" ? strongest.composite : {};
  const expectedDays = normalizeFiniteNumber(coverage.expectedDays, 7);
  const coveredDays = normalizeFiniteNumber(coverage.coveredDays, 0);
  const missingDays = normalizeFiniteNumber(coverage.missingDays, Math.max(0, expectedDays - coveredDays));
  const coveragePercent = normalizeFiniteNumber(coverage.coveragePercent);
  const debuff = normalizeFiniteNumber(composite.influenceDebuffPercent, 0);
  const signalBits = [
    `JJS ${formatHours((normalizeFiniteNumber(totals.jjsMinutes, 0)) / 60)} ч`,
    `msg ${formatNumber(totals.messages)}`,
    `sessions ${formatNumber(totals.sessions)}`,
    `voice ${formatHours((normalizeFiniteNumber(totals.voiceSeconds, 0)) / 3600)} ч`,
  ];
  if (Number.isFinite(normalizeFiniteNumber(totals.approvedKillsDelta))) {
    signalBits.push(`kills ${formatSignedNumber(totals.approvedKillsDelta)}`);
  }
  if (Number.isFinite(normalizeFiniteNumber(totals.antiteamPointsDelta))) {
    signalBits.push(`antiteam ${formatSignedNumber(totals.antiteamPointsDelta)}`);
  }

  return {
    title: "Strongest week",
    lines: [
      `Strongest week: ${cleanString(strongest.weekKey, 20)} • ${cleanString(composite.grade, 10) || "N/A"} (${formatNumber(composite.score)}) • coverage ${formatNumber(coveredDays)}/${formatNumber(expectedDays)}д${Number.isFinite(coveragePercent) ? ` (${formatPercent(coveragePercent, 0)})` : ""}`,
      `Signals: ${signalBits.join(" • ")}`,
      `Window: ${formatDayRangeLabel(strongest.startDayKey, strongest.endDayKey)} • confidence ${cleanString(composite.confidenceState, 40) || "partial"} • debuff ${formatNumber(debuff)}%${missingDays > 0 ? ` • дыр ${formatNumber(missingDays)}` : ""}`,
    ],
  };
}

function normalizeComebackWeeklyWindow(rollup = {}) {
  const totals = rollup?.totals && typeof rollup.totals === "object" ? rollup.totals : {};
  const coverage = rollup?.coverage && typeof rollup.coverage === "object" ? rollup.coverage : {};
  const composite = rollup?.composite && typeof rollup.composite === "object" ? rollup.composite : {};
  const score = normalizeFiniteNumber(composite?.score);
  if (!cleanString(rollup?.weekKey, 20) || !Number.isFinite(score)) return null;

  const coveragePercent = normalizeFiniteNumber(coverage?.coveragePercent);
  const jjsMinutes = normalizeFiniteNumber(totals?.jjsMinutes, 0);
  const messages = normalizeFiniteNumber(totals?.messages, 0);
  const sessions = normalizeFiniteNumber(totals?.sessions, 0);
  const voiceSeconds = normalizeFiniteNumber(totals?.voiceSeconds, 0);
  const approvedKillsDelta = normalizeFiniteNumber(totals?.approvedKillsDelta, 0);
  const antiteamPointsDelta = normalizeFiniteNumber(totals?.antiteamPointsDelta, 0);
  const activitySignal = Math.max(0, jjsMinutes) + Math.max(0, messages) * 2 + Math.max(0, sessions) * 12 + (Math.max(0, voiceSeconds) / 60);

  return {
    weekKey: cleanString(rollup.weekKey, 20),
    startDayKey: cleanString(rollup?.startDayKey, 20),
    endDayKey: cleanString(rollup?.endDayKey, 20),
    score,
    grade: cleanString(composite?.grade, 10) || buildLetterGrade(score),
    confidenceState: cleanString(composite?.confidenceState, 40) || (Number(coveragePercent) >= 85 ? "reliable" : "partial"),
    coveragePercent,
    jjsMinutes,
    messages,
    sessions,
    voiceSeconds,
    approvedKillsDelta,
    antiteamPointsDelta,
    activitySignal,
    isActive: score >= 55 && (!Number.isFinite(coveragePercent) || coveragePercent >= 50),
    isLow: score <= 35 || activitySignal <= 120,
    isPauseLike: score <= 25 || (jjsMinutes < 60 && messages < 15 && sessions < 2 && voiceSeconds < 900),
  };
}

function getComparableComebackWindows(profile = null) {
  return getSeasonArchiveWeeklyRollups(profile)
    .map((entry) => normalizeComebackWeeklyWindow(entry))
    .filter(Boolean)
    .sort((left, right) => left.weekKey.localeCompare(right.weekKey));
}

function countTrailingActiveWindows(windows = []) {
  let count = 0;
  for (let index = (Array.isArray(windows) ? windows.length : 0) - 1; index >= 0; index -= 1) {
    if (!windows[index]?.isActive) break;
    count += 1;
  }
  return count;
}

function hasRecentLowToActiveTransition(windows = [], { pauseOnly = false } = {}) {
  const items = Array.isArray(windows) ? windows : [];
  if (items.length < 2) return false;
  const recent = items.slice(-4);
  for (let index = 1; index < recent.length; index += 1) {
    const previous = recent[index - 1];
    const current = recent[index];
    const lowEnough = pauseOnly ? previous?.isPauseLike === true : previous?.isLow === true;
    if (lowEnough && current?.isActive === true && current.score - previous.score >= 18) {
      return true;
    }
  }
  return false;
}

function hasThreeWindowSlowdown(windows = []) {
  const lastThree = (Array.isArray(windows) ? windows : []).slice(-3);
  if (lastThree.length < 3) return false;
  const [first, second, third] = lastThree;
  return first.score - second.score >= 5
    && second.score - third.score >= 5
    && first.score - third.score >= 12;
}

function hasCoolingOff(windows = []) {
  const lastThree = (Array.isArray(windows) ? windows : []).slice(-3);
  if (lastThree.length < 3) return false;
  const [first, second, third] = lastThree;
  return third?.isActive === true
    && first.score > second.score
    && second.score > third.score
    && first.score - third.score >= 8;
}

function buildComebackTrendLabel(flags = {}) {
  const labels = [];
  if (flags.recoveredAfterPause) labels.push("восстановился после паузы");
  if (flags.returnedAfterDrop) labels.push("вернулся после просадки");
  if (flags.activeStreak) labels.push("держит серию активных окон");
  if (flags.slowingDown) labels.push("замедляется 3 окна подряд");
  if (flags.coolingOff) labels.push("остывает второе окно");
  if (!labels.length) labels.push("без явного comeback-сигнала");
  return labels.join(" • ");
}

function formatComebackWindowLine(windows = []) {
  const items = (Array.isArray(windows) ? windows : []).slice(-4);
  if (!items.length) return null;
  return `Windows: ${items.map((entry) => `${entry.weekKey} ${entry.grade} (${formatNumber(entry.score)})`).join(" -> ")}`;
}

function formatComebackLatestSignals(window = null) {
  if (!window) return null;
  const bits = [
    `Latest signals: JJS ${formatHours(window.jjsMinutes / 60)} ч`,
    `msg ${formatNumber(window.messages)}`,
    `sessions ${formatNumber(window.sessions)}`,
    `voice ${formatHours(window.voiceSeconds / 3600)} ч`,
  ];
  if (Number.isFinite(window.approvedKillsDelta)) {
    bits.push(`kills ${formatSignedNumber(window.approvedKillsDelta)}`);
  }
  if (Number.isFinite(window.antiteamPointsDelta)) {
    bits.push(`antiteam ${formatSignedNumber(window.antiteamPointsDelta)}`);
  }
  return bits.join(" • ");
}

function buildComebackMetricsBlock({ profile = null } = {}) {
  const windows = getComparableComebackWindows(profile);
  if (!windows.length) return null;

  if (windows.length < 3) {
    return {
      title: "Comeback metrics",
      lines: [
        [
          "Comeback metrics: история короткая",
          `windows ${formatNumber(windows.length)}/3`,
          "no comeback claim",
        ].join(" • "),
        formatComebackWindowLine(windows),
      ].filter(Boolean),
    };
  }

  const latest = windows.at(-1);
  const activeStreakCount = countTrailingActiveWindows(windows);
  const minCoverage = windows.reduce((min, entry) => {
    const coverage = normalizeFiniteNumber(entry?.coveragePercent);
    return Number.isFinite(coverage) ? Math.min(min, coverage) : min;
  }, 100);
  const flags = {
    returnedAfterDrop: hasRecentLowToActiveTransition(windows),
    recoveredAfterPause: hasRecentLowToActiveTransition(windows, { pauseOnly: true }),
    activeStreak: activeStreakCount >= 3,
    slowingDown: hasThreeWindowSlowdown(windows),
    coolingOff: hasCoolingOff(windows),
  };
  const trust = minCoverage >= 85 ? "reliable" : minCoverage >= 50 ? "partial" : "sparse";

  return {
    title: "Comeback metrics",
    lines: [
      [
        `Comeback metrics: ${buildComebackTrendLabel(flags)}`,
        `active streak ${formatNumber(activeStreakCount)}w`,
        `latest ${latest.weekKey} ${latest.grade} (${formatNumber(latest.score)})`,
      ].join(" • "),
      formatComebackWindowLine(windows),
      formatComebackLatestSignals(latest),
      [
        `Trust: ${trust}`,
        `windows ${formatNumber(windows.length)}`,
        `min coverage ${formatPercent(minCoverage, 0)}`,
        "claims require 3+ comparable weekly windows",
      ].join(" • "),
    ].filter(Boolean),
  };
}

function buildSeasonArchiveCoverageState(snapshots = []) {
  const items = Array.isArray(snapshots) ? snapshots : [];
  const firstDayKey = cleanString(items[0]?.dayKey, 20);
  const lastDayKey = cleanString(items.at(-1)?.dayKey, 20);
  const spanDays = computeDaySpan(firstDayKey, lastDayKey);
  const coveredDayKeys = new Set(items.map((entry) => cleanString(entry?.dayKey, 20)).filter(Boolean));
  const expectedDays = Number.isFinite(spanDays) && spanDays > 0 ? spanDays : coveredDayKeys.size;
  const coveredDays = coveredDayKeys.size;
  const missingDays = Math.max(0, expectedDays - coveredDays);
  const coveragePercent = expectedDays > 0 ? (coveredDays / expectedDays) * 100 : null;
  return {
    firstDayKey,
    lastDayKey,
    expectedDays,
    coveredDays,
    missingDays,
    coveragePercent,
  };
}

function buildSeasonSnapshotComposite(snapshot = {}) {
  const deltas = snapshot?.dayDeltas && typeof snapshot.dayDeltas === "object" ? snapshot.dayDeltas : {};
  const usesExactDayDeltas = deltas.hasPreviousSnapshot === true;
  const messages7d = normalizeFiniteNumber(snapshot?.messages7d, 0);
  const sessions7d = usesExactDayDeltas && Number.isFinite(normalizeFiniteNumber(deltas.sessionCount))
    ? normalizeFiniteNumber(deltas.sessionCount, 0)
    : normalizeFiniteNumber(snapshot?.sessions7d, 0);
  const jjsMinutes7d = usesExactDayDeltas && Number.isFinite(normalizeFiniteNumber(deltas.jjsMinutes))
    ? normalizeFiniteNumber(deltas.jjsMinutes, 0)
    : normalizeFiniteNumber(snapshot?.jjsMinutes7d, 0);
  const voiceSeconds7d = usesExactDayDeltas && Number.isFinite(normalizeFiniteNumber(deltas.voiceSeconds))
    ? normalizeFiniteNumber(deltas.voiceSeconds, 0)
    : normalizeFiniteNumber(snapshot?.voiceDurationSeconds7d, 0);
  const activityScore = normalizeFiniteNumber(snapshot?.activityScore);
  const peerCount = Array.isArray(snapshot?.topCoPlayPeerUserIds) ? snapshot.topCoPlayPeerUserIds.length : 0;
  const serverFriendsCount = normalizeFiniteNumber(snapshot?.serverFriendsCount, 0);
  const socialSuggestionCount = normalizeFiniteNumber(snapshot?.socialSuggestionCount, 0);
  const antiteamSupportPoints = usesExactDayDeltas && Number.isFinite(normalizeFiniteNumber(deltas.antiteamSupportPoints))
    ? normalizeFiniteNumber(deltas.antiteamSupportPoints, 0)
    : normalizeFiniteNumber(snapshot?.antiteamSupportPoints, 0);
  const approvedKillsDelta = usesExactDayDeltas && Number.isFinite(normalizeFiniteNumber(deltas.approvedKills))
    ? normalizeFiniteNumber(deltas.approvedKills, 0)
    : 0;

  const score = clampScore(
    Math.min(18, Math.max(0, messages7d) / 160 * 18)
    + Math.min(10, Math.max(0, sessions7d) / 14 * 10)
    + Math.min(24, Math.max(0, jjsMinutes7d) / 720 * 24)
    + Math.min(14, Math.max(0, voiceSeconds7d) / (4 * 3600) * 14)
    + (Number.isFinite(activityScore) ? Math.min(18, Math.max(0, activityScore) / 100 * 18) : 0)
    + Math.min(12, Math.max(0, peerCount) * 3 + Math.max(0, serverFriendsCount) + Math.max(0, socialSuggestionCount) * 1.5)
    + Math.min(6, Math.max(0, approvedKillsDelta) / 120 * 6)
    + Math.min(4, Math.max(0, antiteamSupportPoints) * 2)
  );

  return {
    snapshot,
    score,
    grade: buildLetterGrade(score),
    messages7d,
    sessions7d,
    jjsMinutes7d,
    voiceSeconds7d,
    activityScore,
    peerCount,
    serverFriendsCount,
    socialSuggestionCount,
    antiteamSupportPoints,
    approvedKillsDelta,
    usesExactDayDeltas,
  };
}

function selectSeasonCompositeExtreme(composites = [], direction = "best") {
  const sorted = (Array.isArray(composites) ? composites : []).slice().sort((left, right) => {
    const scoreDiff = direction === "worst" ? left.score - right.score : right.score - left.score;
    if (scoreDiff) return scoreDiff;
    const leftDayKey = cleanString(left?.snapshot?.dayKey, 20);
    const rightDayKey = cleanString(right?.snapshot?.dayKey, 20);
    return direction === "worst" ? leftDayKey.localeCompare(rightDayKey) : rightDayKey.localeCompare(leftDayKey);
  });
  return sorted[0] || null;
}

function formatSeasonCompositeSnapshotLine(label = "", composite = null) {
  if (!composite?.snapshot) return null;
  const bits = [
    `${label}: ${formatDayLabel(composite.snapshot.dayKey)}`,
    `${composite.grade} (${formatNumber(composite.score)})`,
    `JJS ${formatHours(composite.jjsMinutes7d / 60)} ч ${composite.usesExactDayDeltas ? "exact day" : "rolling 7д"}`,
  ];
  if (Number.isFinite(composite.activityScore)) {
    bits.push(`activity ${formatNumber(composite.activityScore)}`);
  }
  if (Number.isFinite(composite.messages7d) && composite.messages7d > 0) {
    bits.push(`msg ${formatNumber(composite.messages7d)}`);
  }
  if (Number.isFinite(composite.voiceSeconds7d) && composite.voiceSeconds7d > 0) {
    bits.push(`voice ${formatHours(composite.voiceSeconds7d / 3600)} ч`);
  }
  if (Number.isFinite(composite.peerCount) && composite.peerCount > 0) {
    bits.push(`social ${formatNumber(composite.peerCount)} peers`);
  }
  if (Number.isFinite(composite.antiteamSupportPoints) && composite.antiteamSupportPoints > 0) {
    bits.push(`antiteam ${formatNumber(composite.antiteamSupportPoints)}`);
  }
  if (Number.isFinite(composite.approvedKillsDelta) && composite.approvedKillsDelta > 0) {
    bits.push(`kills +${formatNumber(composite.approvedKillsDelta)}`);
  }
  return bits.join(" • ");
}

function buildSeasonConsistencyBlock({ profile = null } = {}) {
  const snapshots = getSeasonArchiveSnapshots(profile);
  if (!snapshots.length) return null;

  const coverage = buildSeasonArchiveCoverageState(snapshots);
  if (snapshots.length < 7) {
    return {
      title: "Season consistency",
      lines: [
        [
          "Season consistency: история короткая",
          `${formatNumber(snapshots.length)}/7 дневных срезов`,
          Number.isFinite(coverage.coveragePercent) ? `coverage ${formatPercent(coverage.coveragePercent, 0)}` : null,
        ].filter(Boolean).join(" • "),
        "Trust: partial • нужен хотя бы недельный baseline; rolling snapshots, not exact single-day deltas.",
      ],
    };
  }

  const composites = snapshots.map((entry) => buildSeasonSnapshotComposite(entry));
  const hasExactDayDeltas = composites.some((entry) => entry.usesExactDayDeltas === true);
  const best = selectSeasonCompositeExtreme(composites, "best");
  const worst = selectSeasonCompositeExtreme(composites, "worst");
  const totalScore = composites.reduce((sum, entry) => sum + entry.score, 0);
  const averageScore = composites.length ? totalScore / composites.length : 0;
  const variance = composites.length
    ? composites.reduce((sum, entry) => sum + (entry.score - averageScore) ** 2, 0) / composites.length
    : 0;
  const deviation = Math.sqrt(Math.max(0, variance));
  const spread = Number(best?.score) - Number(worst?.score);
  const consistencyLabel = spread <= 15 && deviation <= 7
    ? "ровный сезон"
    : (spread <= 28 && deviation <= 12 ? "умеренно ровный" : "вспышками");
  const trust = Number(coverage.coveragePercent) >= 90 ? "reliable" : "partial";

  return {
    title: "Season consistency",
    lines: [
      [
        `Season consistency: ${consistencyLabel}`,
        `average day ${buildLetterGrade(averageScore)} (${formatNumber(averageScore)})`,
        `spread ${formatNumber(spread)}`,
        `std ${formatHours(deviation)}`,
        `snapshots ${formatNumber(snapshots.length)}`,
      ].join(" • "),
      formatSeasonCompositeSnapshotLine("Best snapshot day", best),
      formatSeasonCompositeSnapshotLine("Weakest snapshot day", worst),
      [
        `Trust: ${trust}`,
        Number.isFinite(coverage.coveragePercent) ? `coverage ${formatPercent(coverage.coveragePercent, 0)} (${formatNumber(coverage.coveredDays)}/${formatNumber(coverage.expectedDays)} дн)` : null,
        coverage.missingDays > 0 ? `дыр ${formatNumber(coverage.missingDays)}` : "без дыр",
        hasExactDayDeltas ? "exact day deltas available where cumulative counters exist" : "rolling snapshots, not exact single-day deltas",
      ].filter(Boolean).join(" • "),
    ].filter(Boolean),
  };
}

function buildElapsedRecencyLabel(hours) {
  const normalizedHours = normalizeNullableFiniteNumber(hours);
  if (!Number.isFinite(normalizedHours)) return null;
  if (normalizedHours < 48) {
    return `~${formatHours(normalizedHours)} ч назад`;
  }
  return `~${formatDays(normalizedHours / 24)}`;
}

function scoreWarReadiness({ robloxSummary = {}, activitySummary = {}, progressState = {}, primeTimeState = {} } = {}) {
  let score = 0;
  const jjsMinutes7d = hasUsableRobloxActivitySummary(robloxSummary) ? normalizeFiniteNumber(robloxSummary?.jjsMinutes7d) : null;
  if (Number.isFinite(jjsMinutes7d) && jjsMinutes7d > 0) {
    if (jjsMinutes7d >= 600) score += 35;
    else if (jjsMinutes7d >= 300) score += 25;
    else if (jjsMinutes7d >= 120) score += 15;
    else score += 8;
  }

  const discordSeenHours = computeElapsedHours(activitySummary?.lastSeenAt, progressState?.now);
  if (Number.isFinite(discordSeenHours)) {
    if (discordSeenHours <= 48) score += 25;
    else if (discordSeenHours <= 7 * 24) score += 18;
    else if (discordSeenHours <= 14 * 24) score += 10;
  }

  const proofFreshnessHours = normalizeNullableFiniteNumber(progressState?.hoursSinceLastApprovedKillsUpdate);
  if (Number.isFinite(proofFreshnessHours)) {
    if (proofFreshnessHours <= 72) score += 25;
    else if (proofFreshnessHours <= 7 * 24) score += 15;
    else if (proofFreshnessHours <= 14 * 24) score += 6;
  }

  if (primeTimeState?.bestWindow?.minutes > 0) {
    score += primeTimeState.insufficient ? 8 : 15;
  }

  return score;
}

function buildWarReadinessLevel(score = 0) {
  const normalizedScore = normalizeFiniteNumber(score, 0);
  if (normalizedScore >= 70) return "высокая";
  if (normalizedScore >= 45) return "средняя";
  return "слабая";
}

function buildPersonalWarReadinessBlock({ profile = null, robloxSummary = {}, activitySummary = {}, progressState = {}, now } = {}) {
  const primeTimeState = buildPrimeTimeState({ profile });
  const jjsMinutes7d = hasUsableRobloxActivitySummary(robloxSummary) ? normalizeFiniteNumber(robloxSummary?.jjsMinutes7d) : null;
  const discordSeenHours = computeElapsedHours(activitySummary?.lastSeenAt, now);
  const proofFreshnessHours = normalizeNullableFiniteNumber(progressState?.hoursSinceLastApprovedKillsUpdate);
  const hasSignal = (Number.isFinite(jjsMinutes7d) && jjsMinutes7d > 0)
    || Number.isFinite(discordSeenHours)
    || Number.isFinite(proofFreshnessHours)
    || primeTimeState.buckets.length > 0;
  if (!hasSignal) return null;

  const score = scoreWarReadiness({
    robloxSummary,
    activitySummary,
    progressState: {
      ...progressState,
      now,
    },
    primeTimeState,
  });

  const lines = [
    `Готовность к вару: ${buildWarReadinessLevel(score)}`,
    [
      `Roblox 7д: ${Number.isFinite(jjsMinutes7d) ? `${formatHours(jjsMinutes7d / 60)} ч` : "нет сигнала"}`,
      `Discord last seen: ${buildElapsedRecencyLabel(discordSeenHours) || "нет сигнала"}`,
      `proof freshness: ${buildElapsedRecencyLabel(proofFreshnessHours) || "нет approved history"}`,
    ].join(" • "),
  ];

  if (primeTimeState.buckets.length) {
    if (primeTimeState.insufficient || !primeTimeState.bestWindow || primeTimeState.bestWindow.minutes <= 0) {
      lines.push("Prime time: hourly buckets пока ещё короткие.");
    } else {
      lines.push(`Prime time: ${formatHourLabel(primeTimeState.bestWindow.startHour)}-${formatHourLabel(primeTimeState.bestWindow.endHourExclusive)} МСК`);
    }
  } else {
    lines.push("Prime time: ещё не накоплен.");
  }

  return {
    title: "War Readiness",
    lines,
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
      `Текст-тирлист: Форма ${tierlist.form.grade} • Общение ${tierlist.chat.grade} • Килы ${tierlist.kills.grade} • Стабильность ${tierlist.stability.grade} • Рост ${tierlist.growth.grade} • Связи ${tierlist.social.grade}`,
      buildViewerArchetypeLine({ tierlist, approvedKills, killTier, mainCharacterLabels, progressState, profile }),
      buildViewerAnchorLine({ standing, killTier, eloSummary, robloxSummary, activitySummary }),
    ],
  };
}

function formatAxisPlaceSegment(axis = {}, label = "Ось") {
  const grade = cleanString(axis?.grade, 10) || "N/A";
  if (!grade || grade === "N/A") return `${label}: нет данных`;
  const place = axis?.place && typeof axis.place === "object" ? axis.place : {};
  const rank = normalizeNullableFiniteNumber(place.rank);
  const total = normalizeNullableFiniteNumber(place.total);
  const populationSize = normalizeNullableFiniteNumber(axis?.populationSize, total);
  const debuff = normalizeInfluenceDebuffPercent(axis?.influenceDebuffPercent, 0);
  const age = normalizeNullableFiniteNumber(axis?.dataAgeDays);
  const stateText = axis?.isHistoricalFallback === true
    ? `данные ${Number.isFinite(age) ? `${formatNumber(age)}д назад` : "из архива"}`
    : "текущий расчёт";
  const weightText = debuff > 0 ? ` · вес -${formatNumber(debuff)}%` : "";

  if (Number.isFinite(rank) && Number.isFinite(total) && total > 0) {
    return `${label} ${grade} (#${formatNumber(rank)}/${formatNumber(total)}) · ${stateText}${weightText}`;
  }

  if (Number.isFinite(populationSize) && populationSize > 0) {
    return `${label} ${grade} (место ждёт базу ${formatNumber(populationSize)}/${formatNumber(MIN_POPULATION_BASELINE)}) · ${stateText}${weightText}`;
  }

  return `${label} ${grade} (место ждёт базу) · ${stateText}${weightText}`;
}

function buildAxisConfidenceSummaryLine(tierlist = {}) {
  const axes = VIEWER_TIERLIST_AXES
    .map(([axisName]) => tierlist?.[axisName])
    .filter((axis) => axis && typeof axis === "object");
  if (!axes.length) return null;

  const currentCount = axes.filter((axis) => (
    axis?.isHistoricalFallback !== true
      && cleanString(axis?.confidenceState, 40) !== "unavailable"
      && cleanString(axis?.grade, 10) !== "N/A"
  )).length;
  const historicalCount = axes.filter((axis) => axis?.isHistoricalFallback === true).length;
  const unavailableCount = axes.filter((axis) => cleanString(axis?.confidenceState, 40) === "unavailable").length;
  const maxDebuff = axes.reduce((max, axis) => {
    const debuff = normalizeFiniteNumber(axis?.influenceDebuffPercent, 0);
    return Number.isFinite(debuff) ? Math.max(max, debuff) : max;
  }, 0);

  const parts = [`Оценка профиля: текущий расчёт ${formatNumber(currentCount)}/${formatNumber(axes.length)}`];
  if (historicalCount > 0) parts.push(`старые данные ${formatNumber(historicalCount)}`);
  if (unavailableCount > 0) parts.push(`нет данных ${formatNumber(unavailableCount)}`);
  if (maxDebuff > 0) parts.push(`самый сильный штраф веса -${formatNumber(maxDebuff)}%`);
  if (currentCount + historicalCount < axes.length) {
    parts.push("часть осей ждёт данных");
  }

  return parts.join(" • ");
}

function buildViewerLetterPlacesBlock({ isSelf = false, tierlist = null } = {}) {
  if (isSelf || !tierlist) return null;

  const segments = VIEWER_TIERLIST_AXES.map(([axisName, label]) => (
    formatAxisPlaceSegment(tierlist?.[axisName], label)
  ));
  const confidenceLine = buildAxisConfidenceSummaryLine(tierlist);

  return {
    title: "Оценка профиля",
    lines: [
      segments.slice(0, 3).join(" • "),
      segments.slice(3).join(" • "),
      confidenceLine,
    ].filter(Boolean),
  };
}

function resolveAntiteamSupportSummary(supportSummary = {}) {
  const antiteam = supportSummary?.antiteam && typeof supportSummary.antiteam === "object"
    ? supportSummary.antiteam
    : {};
  if (antiteam.sourceAvailable !== true) return null;

  return {
    sourceAvailable: true,
    responded: normalizeFiniteNumber(antiteam.responded, 0),
    linkGranted: normalizeFiniteNumber(antiteam.linkGranted, 0),
    confirmedArrived: normalizeFiniteNumber(antiteam.confirmedArrived, 0),
    lastHelpedAt: cleanString(antiteam.lastHelpedAt, 80) || null,
    source: cleanString(antiteam.source, 120) || "sot.antiteam.stats.helpers",
  };
}

function resolveProfileAntiteamSupportSummary(profile = {}) {
  const summarySupport = profile?.summary?.support && typeof profile.summary.support === "object"
    ? profile.summary.support
    : null;
  const domainSupport = profile?.domains?.support && typeof profile.domains.support === "object"
    ? profile.domains.support
    : null;
  return resolveAntiteamSupportSummary(summarySupport || domainSupport || {});
}

function buildAntiteamSupportPopulationSamples(populationProfiles = []) {
  const samples = [];
  for (const entry of normalizePopulationProfileEntries(populationProfiles)) {
    const support = resolveProfileAntiteamSupportSummary(entry.profile);
    if (!support) continue;
    if (Number.isFinite(support.confirmedArrived)) {
      samples.push(support.confirmedArrived);
    }
  }
  return samples;
}

function buildAntiteamSupportState({ supportSummary = {}, populationProfiles = [] } = {}) {
  const support = resolveAntiteamSupportSummary(supportSummary);
  if (!support) {
    return {
      available: false,
      points: null,
      place: buildAxisPlace(null, []),
      populationSize: 0,
      confidenceState: "unavailable",
      influenceDebuffPercent: 100,
    };
  }

  const populationSamples = buildAntiteamSupportPopulationSamples(populationProfiles);
  const place = buildAxisPlace(support.confirmedArrived, populationSamples);
  const hasPopulationPlace = Number.isFinite(place.rank) && Number.isFinite(place.total) && place.total >= MIN_POPULATION_BASELINE;

  return {
    available: true,
    ...support,
    points: support.confirmedArrived,
    place,
    populationSize: populationSamples.length,
    confidenceState: hasPopulationPlace ? "reliable" : "partial",
    influenceDebuffPercent: hasPopulationPlace ? 0 : 15,
  };
}

function buildAntiteamSupportPlaceLine(state = {}) {
  const rank = normalizeNullableFiniteNumber(state?.place?.rank);
  const total = normalizeNullableFiniteNumber(state?.place?.total);
  if (Number.isFinite(rank) && Number.isFinite(total) && total > 0) {
    return `Место по antiteam support: #${formatNumber(rank)}/${formatNumber(total)}`;
  }
  return `Место по antiteam support: baseline ${formatNumber(state.populationSize)}/${formatNumber(MIN_POPULATION_BASELINE)}`;
}

function buildAntiteamSupportBlock({ supportSummary = {}, populationProfiles = [] } = {}) {
  const state = buildAntiteamSupportState({ supportSummary, populationProfiles });
  if (!state.available) return null;

  const totals = [
    `confirmed arrivals ${formatNumber(state.confirmedArrived)}`,
    `responded ${formatNumber(state.responded)}`,
    `link grants ${formatNumber(state.linkGranted)}`,
  ];
  const reliability = [
    `confidence ${state.confidenceState}`,
    `debuff ${formatNumber(state.influenceDebuffPercent)}%`,
    `source ${state.source}`,
  ];

  if (state.lastHelpedAt) {
    reliability.push(`last help ${formatDateTime(state.lastHelpedAt)}`);
  }

  return {
    title: "Antiteam support",
    lines: [
      `Support points: ${totals.join(" • ")}`,
      buildAntiteamSupportPlaceLine(state),
      reliability.join(" • "),
    ],
  };
}

function buildActiveVoiceShare(activitySummary = {}, voiceSummary = {}) {
  const effectiveVoiceHours = normalizeNullableFiniteNumber(activitySummary?.effectiveVoiceHours30d);
  const effectiveActiveVoiceHours = normalizeNullableFiniteNumber(activitySummary?.effectiveActiveVoiceSignalHours30d);
  if (Number.isFinite(effectiveVoiceHours) && effectiveVoiceHours > 0 && Number.isFinite(effectiveActiveVoiceHours)) {
    return clampScore((effectiveActiveVoiceHours / effectiveVoiceHours) * 100);
  }

  const activeVoiceSeconds = normalizeNullableFiniteNumber(activitySummary?.activeVoiceDurationSeconds30d);
  const voiceSeconds = normalizeNullableFiniteNumber(voiceSummary?.voiceDurationSeconds30d ?? activitySummary?.voiceDurationSeconds30d);
  if (Number.isFinite(voiceSeconds) && voiceSeconds > 0 && Number.isFinite(activeVoiceSeconds)) {
    return clampScore((activeVoiceSeconds / voiceSeconds) * 100);
  }

  return null;
}

function buildKillsPerCoveredDay(progressState = {}) {
  const latestWindow = progressState?.latestGrowthWindow && typeof progressState.latestGrowthWindow === "object"
    ? progressState.latestGrowthWindow
    : null;
  const deltaKills = normalizeNullableFiniteNumber(latestWindow?.deltaKills);
  const wallClockDays = normalizeNullableFiniteNumber(latestWindow?.wallClockDays);
  if (!Number.isFinite(deltaKills) || !Number.isFinite(wallClockDays) || wallClockDays <= 0) return null;
  return deltaKills / wallClockDays;
}

function secondsToHours(value) {
  const seconds = normalizeNullableFiniteNumber(value);
  return Number.isFinite(seconds) ? seconds / 3600 : null;
}

function minutesToHours(value) {
  const minutes = normalizeNullableFiniteNumber(value);
  return Number.isFinite(minutes) ? minutes / 60 : null;
}

function buildRelativeComponentRawValues({
  activitySummary = {},
  robloxSummary = {},
  voiceSummary = {},
  progressState = {},
  supportSummary = {},
} = {}) {
  const antiteamSupport = resolveAntiteamSupportSummary(supportSummary);
  return {
    voiceHours30d: secondsToHours(voiceSummary?.voiceDurationSeconds30d),
    activeVoiceShare30d: buildActiveVoiceShare(activitySummary, voiceSummary),
    voiceSessions30d: normalizeNullableFiniteNumber(voiceSummary?.sessionCount30d ?? activitySummary?.voiceSessions30d),
    discordSessions30d: normalizeNullableFiniteNumber(activitySummary?.sessions30d),
    discordMessages30d: normalizeNullableFiniteNumber(activitySummary?.messages30d),
    jjsHours30d: minutesToHours(robloxSummary?.jjsMinutes30d),
    jjsSessionCount: normalizeNullableFiniteNumber(robloxSummary?.sessionCount),
    killsPerCoveredDay: buildKillsPerCoveredDay(progressState),
    antiteamSupportPoints: antiteamSupport ? normalizeNullableFiniteNumber(antiteamSupport.confirmedArrived) : null,
  };
}

function normalizeRelativeComponentValue(value) {
  return Number.isFinite(value) ? value : null;
}

const RELATIVE_COMPONENT_DEFINITIONS = Object.freeze([
  {
    key: "voiceHours30d",
    snapshotAxisKey: "voice_hours_30d",
    label: "voice hours",
    source: "profile.summary.voice.voiceDurationSeconds30d",
    format: (value) => `${formatHours(value)} ч`,
  },
  {
    key: "activeVoiceShare30d",
    snapshotAxisKey: "active_voice_share_30d",
    label: "active voice",
    source: "profile.summary.activity.effectiveActiveVoiceSignalHours30d",
    format: (value) => formatPercent(value, 0),
  },
  {
    key: "voiceSessions30d",
    snapshotAxisKey: "voice_sessions_30d",
    label: "voice sessions",
    source: "profile.summary.voice.sessionCount30d",
    format: (value) => formatNumber(value),
  },
  {
    key: "discordSessions30d",
    snapshotAxisKey: "discord_sessions_30d",
    label: "Discord sessions",
    source: "profile.summary.activity.sessions30d",
    format: (value) => formatNumber(value),
  },
  {
    key: "discordMessages30d",
    snapshotAxisKey: "discord_messages_30d",
    label: "messages",
    source: "profile.summary.activity.messages30d",
    format: (value) => formatNumber(value),
  },
  {
    key: "jjsHours30d",
    snapshotAxisKey: "jjs_time_30d",
    label: "JJS time",
    source: "profile.summary.roblox.jjsMinutes30d",
    format: (value) => `${formatHours(value)} ч`,
  },
  {
    key: "jjsSessionCount",
    snapshotAxisKey: "jjs_session_count",
    label: "JJS sessions",
    source: "profile.summary.roblox.sessionCount",
    format: (value) => formatNumber(value),
  },
  {
    key: "killsPerCoveredDay",
    snapshotAxisKey: "kills_per_covered_day",
    label: "kills/day",
    source: "profile.domains.progress.proofWindows",
    proofBacked: true,
    format: (value) => formatHours(value, 1),
  },
  {
    key: "antiteamSupportPoints",
    snapshotAxisKey: "antiteam_support_points",
    label: "antiteam",
    source: "profile.summary.support.antiteam.confirmedArrived",
    format: (value) => formatNumber(value),
  },
]);

function resolveProfileSummaryDomain(profile = {}, key = "") {
  const summary = profile?.summary && typeof profile.summary === "object" ? profile.summary : {};
  const domains = profile?.domains && typeof profile.domains === "object" ? profile.domains : {};
  return summary[key] && typeof summary[key] === "object"
    ? summary[key]
    : (domains[key] && typeof domains[key] === "object" ? domains[key] : {});
}

function resolvePopulationSnapshotAxisValues(populationSnapshot = null, axisKey = "") {
  const axis = populationSnapshot?.axes?.[axisKey];
  const values = axis && typeof axis === "object" && Array.isArray(axis.values) ? axis.values : [];
  return values
    .map((entry) => normalizeFiniteNumber(entry))
    .filter((entry) => Number.isFinite(entry));
}

function buildRelativeComponentPopulationSamples({ populationProfiles = [], populationSnapshot = null, approvedEntries = [], now } = {}) {
  const samples = Object.fromEntries(RELATIVE_COMPONENT_DEFINITIONS.map((definition) => [definition.key, []]));
  let hasPersistedAxis = false;
  for (const definition of RELATIVE_COMPONENT_DEFINITIONS) {
    const persistedValues = resolvePopulationSnapshotAxisValues(populationSnapshot, definition.snapshotAxisKey);
    if (!persistedValues.length) continue;
    samples[definition.key] = persistedValues;
    hasPersistedAxis = true;
  }
  if (hasPersistedAxis) return samples;

  for (const entry of normalizePopulationProfileEntries(populationProfiles)) {
    const profile = entry.profile;
    const summary = profile?.summary && typeof profile.summary === "object" ? profile.summary : {};
    const onboardingSummary = summary.onboarding && typeof summary.onboarding === "object" ? summary.onboarding : {};
    const activitySummary = resolveProfileSummaryDomain(profile, "activity");
    const robloxSummary = resolveProfileSummaryDomain(profile, "roblox");
    const voiceSummary = resolveProfileSummaryDomain(profile, "voice");
    const supportSummary = resolveProfileSummaryDomain(profile, "support");
    const progressState = buildProgressSynergyState({
      profile,
      robloxSummary,
      approvedKills: normalizeNullableFiniteNumber(profile?.approvedKills ?? onboardingSummary.approvedKills),
      now,
    });
    const rawValues = buildRelativeComponentRawValues({
      activitySummary,
      robloxSummary,
      voiceSummary,
      progressState,
      supportSummary,
    });

    for (const definition of RELATIVE_COMPONENT_DEFINITIONS) {
      const value = normalizeRelativeComponentValue(rawValues[definition.key]);
      if (Number.isFinite(value)) samples[definition.key].push(value);
    }
  }

  return samples;
}

function buildRelativeComponentsState({
  activitySummary = {},
  robloxSummary = {},
  voiceSummary = {},
  progressState = {},
  supportSummary = {},
  populationProfiles = [],
  populationSnapshot = null,
  approvedEntries = [],
  now,
} = {}) {
  const rawValues = buildRelativeComponentRawValues({
    activitySummary,
    robloxSummary,
    voiceSummary,
    progressState,
    supportSummary,
  });
  const populationSamples = buildRelativeComponentPopulationSamples({
    populationProfiles,
    populationSnapshot,
    approvedEntries,
    now,
  });
  const proofTrust = buildProofBackedAxisTrustOptions(progressState?.proofGap);

  return RELATIVE_COMPONENT_DEFINITIONS.map((definition) => {
    const rawValue = normalizeRelativeComponentValue(rawValues[definition.key]);
    const samples = populationSamples[definition.key] || [];
    const place = buildAxisPlace(rawValue, samples);
    if (!Number.isFinite(rawValue)) {
      return {
        ...definition,
        rawValue: null,
        place,
        populationSize: samples.length,
        confidenceState: "unavailable",
        freshnessState: "unavailable",
        influenceDebuffPercent: 100,
      };
    }

    const hasPopulationPlace = Number.isFinite(place.rank) && Number.isFinite(place.total) && place.total >= MIN_POPULATION_BASELINE;
    const baseDebuff = hasPopulationPlace ? 0 : 15;
    const trustDebuff = definition.proofBacked ? normalizeInfluenceDebuffPercent(proofTrust.influenceDebuffPercent, 0) : 0;
    const freshnessState = definition.proofBacked && proofTrust.freshnessState
      ? proofTrust.freshnessState
      : (hasPopulationPlace ? "fresh" : "partial");

    return {
      ...definition,
      rawValue,
      displayValue: definition.format(rawValue),
      place,
      populationSize: samples.length,
      confidenceState: hasPopulationPlace ? "reliable" : "partial",
      freshnessState,
      influenceDebuffPercent: Math.max(baseDebuff, trustDebuff),
    };
  });
}

function formatRelativeComponentSegment(component = {}) {
  if (!Number.isFinite(component?.rawValue)) {
    return `${component.label} N/A`;
  }

  const rank = normalizeNullableFiniteNumber(component?.place?.rank);
  const total = normalizeNullableFiniteNumber(component?.place?.total);
  const placeText = Number.isFinite(rank) && Number.isFinite(total) && total > 0
    ? `#${formatNumber(rank)}/${formatNumber(total)}`
    : `baseline ${formatNumber(component.populationSize)}/${formatNumber(MIN_POPULATION_BASELINE)}`;
  const debuff = normalizeInfluenceDebuffPercent(component.influenceDebuffPercent, 0);
  const debuffText = debuff > 0 ? `, debuff ${formatNumber(debuff)}%` : "";
  return `${component.label} ${component.displayValue} (${placeText}, ${component.confidenceState}${debuffText})`;
}

function buildRelativeComponentsBlock(options = {}) {
  const components = buildRelativeComponentsState(options);
  const available = components.filter((component) => Number.isFinite(component.rawValue));
  if (!available.length) return null;

  const byKey = Object.fromEntries(components.map((component) => [component.key, component]));
  return {
    title: "Места по метрикам",
    lines: [
      [
        formatRelativeComponentSegment(byKey.voiceHours30d),
        formatRelativeComponentSegment(byKey.activeVoiceShare30d),
        formatRelativeComponentSegment(byKey.voiceSessions30d),
      ].join(" • "),
      [
        formatRelativeComponentSegment(byKey.discordMessages30d),
        formatRelativeComponentSegment(byKey.discordSessions30d),
        formatRelativeComponentSegment(byKey.jjsHours30d),
        formatRelativeComponentSegment(byKey.jjsSessionCount),
      ].join(" • "),
      [
        formatRelativeComponentSegment(byKey.killsPerCoveredDay),
        formatRelativeComponentSegment(byKey.antiteamSupportPoints),
      ].join(" • "),
    ].filter(Boolean),
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
  const normalizedApprovedKills = normalizeNullableFiniteNumber(approvedKills);
  const normalizedKillTier = normalizeNullableFiniteNumber(killTier);
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

function buildProofGapVerdict(state = {}) {
  switch (cleanString(state?.freshnessState, 40)) {
    case "fresh":
      return "разрыв маленький";
    case "partial":
      return "разрыв уже заметный";
    case "stale":
      return "разрыв большой";
    case "outdated":
      return "proof сильно отстал от игры";
    default:
      return "доверие к proof неясно";
  }
}

function buildProofGapBlock({ progressState = {} } = {}) {
  const state = progressState?.proofGap && typeof progressState.proofGap === "object"
    ? progressState.proofGap
    : null;
  if (!state) return null;

  if (!state.hasProof) {
    if (!Number.isFinite(state.currentApprovedKills)) return null;
    return {
      title: "Proof gap",
      lines: [
        `Proof gap: approved proof-window не найден • текущие approved kills ${formatNumber(state.currentApprovedKills)}`,
        `Trust: ${state.freshnessState} • kill-backed debuff ${formatNumber(state.influenceDebuffPercent)}% • source ${state.source}`,
      ],
    };
  }

  const currentApprovedKills = normalizeNullableFiniteNumber(state.currentApprovedKills);
  const latestApprovedKills = normalizeNullableFiniteNumber(state.latestApprovedKills);
  const proofBits = [
    `last proof ${state.reviewedAt ? formatDateTime(state.reviewedAt) : "—"}`,
    Number.isFinite(state.hoursSinceLastApprovedKillsUpdate)
      ? `${formatHours(state.hoursSinceLastApprovedKillsUpdate)} ч назад`
      : "age N/A",
  ];
  if (Number.isFinite(latestApprovedKills)) {
    proofBits.push(`approved ${formatNumber(latestApprovedKills)} kills`);
  }
  if (Number.isFinite(currentApprovedKills) && Number.isFinite(latestApprovedKills) && currentApprovedKills !== latestApprovedKills) {
    proofBits.push(`current ${formatNumber(currentApprovedKills)} (${formatSignedNumber(currentApprovedKills - latestApprovedKills)})`);
  }

  const jjsLine = state.hasReliableJjsSinceLastApproved && Number.isFinite(state.jjsHoursSinceLastApprovedKillsUpdate)
    ? `JJS после proof: ${formatHours(state.jjsHoursSinceLastApprovedKillsUpdate)} ч • ${buildProofGapVerdict(state)}`
    : `JJS после proof: Roblox baseline ненадёжен • ${buildProofGapVerdict(state)}`;

  return {
    title: "Proof gap",
    lines: [
      `Proof gap: ${proofBits.join(" • ")}`,
      jjsLine,
      `Trust: ${state.freshnessState} • confidence ${state.confidenceState} • kill-backed debuff ${formatNumber(state.influenceDebuffPercent)}% • source ${state.source}`,
    ],
  };
}

function buildProgressSynergyState({ profile = null, robloxSummary = {}, recentKillChanges = [], approvedKills: optionApprovedKills = null, now } = {}) {
  const latestProofWindow = getLatestProofWindow(profile);
  const hoursSinceLastApprovedKillsUpdate = computeElapsedHours(latestProofWindow?.reviewedAt, now);
  const growthWindows = buildGrowthWindows({ profile, recentKillChanges });
  const latestGrowthWindow = growthWindows[0] || null;
  const windowComparison = buildWindowComparisonState(growthWindows);
  const lifetimePace = buildLifetimePaceState(growthWindows);
  const approvedKills = normalizeNullableFiniteNumber(profile?.approvedKills ?? profile?.summary?.onboarding?.approvedKills ?? optionApprovedKills);

  if (!latestProofWindow) {
    const proofGap = buildProofGapState({
      latestProofWindow: null,
      approvedKills,
    });
    return {
      latestProofWindow: null,
      latestGrowthWindow,
      growthWindows,
      windowComparison,
      lifetimePace,
      proofGap,
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
  const proofGap = buildProofGapState({
    latestProofWindow,
    approvedKills,
    hoursSinceLastApprovedKillsUpdate,
    jjsHoursSinceLastApprovedKillsUpdate,
    hasReliableJjsSinceLastApproved,
  });

  return {
    latestProofWindow,
    latestGrowthWindow,
    growthWindows,
    windowComparison,
    lifetimePace,
    proofGap,
    hoursSinceLastApprovedKillsUpdate,
    jjsHoursSinceLastApprovedKillsUpdate,
    jjsMinutesSinceLastApprovedKillsUpdate,
    hasReliableJjsSinceLastApproved,
    reminderEligible: Number.isFinite(jjsHoursSinceLastApprovedKillsUpdate) && jjsHoursSinceLastApprovedKillsUpdate >= 10,
  };
}

function buildProfileSynergyState(options = {}) {
  const progress = buildProgressSynergyState(options);
  const viewerTierlist = buildViewerTierlistState({
      ...options,
      progressState: progress,
    });

  return {
    progress,
    viewerTierlist,
    blocks: {
      selfProgress: buildSelfProgressBlock({
        ...options,
        progressState: progress,
      }),
      proofGap: buildProofGapBlock({
        progressState: progress,
      }),
      friendOverlap: buildFriendOverlapBlock({
        ...options,
      }),
      friendsAlreadyHere: buildFriendsAlreadyHereBlock({
        ...options,
      }),
      verifiedCircle: buildVerifiedCircleBlock({
        ...options,
      }),
      socialMap: buildSocialMapBlock({
        ...options,
      }),
      voiceGameOverlap: buildVoiceGameOverlapBlock({
        ...options,
      }),
      socialEvolution: buildSocialEvolutionBlock({
        ...options,
      }),
      voiceSummary: buildVoiceSummaryBlock({
        ...options,
      }),
      activityMix: buildActivityMixBlock({
        ...options,
      }),
      farmProfile: buildFarmProfileBlock({
        ...options,
      }),
      relativeComponents: buildRelativeComponentsBlock({
        ...options,
        progressState: progress,
      }),
      primeTime: buildPrimeTimeBlock({
        ...options,
      }),
      primeTimeConfidence: buildPrimeTimeConfidenceBlock({
        ...options,
      }),
      bestPeriods: buildBestPeriodsBlock({
        ...options,
      }),
      seasonStory: buildSeasonStoryBlock({
        ...options,
      }),
      weeklyRollups: buildWeeklyRollupsBlock({
        ...options,
      }),
      seasonConsistency: buildSeasonConsistencyBlock({
        ...options,
      }),
      comebackMetrics: buildComebackMetricsBlock({
        ...options,
      }),
      personalWarReadiness: buildPersonalWarReadinessBlock({
        ...options,
        progressState: progress,
      }),
      socialSuggestions: buildSocialSuggestionsBlock({
        ...options,
      }),
      viewerMainCore: buildViewerMainCoreBlock({
        ...options,
        progressState: progress,
        tierlist: viewerTierlist,
      }),
      viewerLetterPlaces: buildViewerLetterPlacesBlock({
        ...options,
        tierlist: viewerTierlist,
      }),
      antiteamSupport: buildAntiteamSupportBlock({
        ...options,
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
