"use strict";

const KILL_TIER_THRESHOLDS = Object.freeze([
  { tier: 2, kills: 1000 },
  { tier: 3, kills: 3000 },
  { tier: 4, kills: 7000 },
  { tier: 5, kills: 11000 },
]);

const KILL_MILESTONES = Object.freeze([20000, 30000]);

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

function getProofWindows(profile = {}) {
  return Array.isArray(profile?.domains?.progress?.proofWindows)
    ? profile.domains.progress.proofWindows
    : [];
}

function resolveNowTimestamp(now) {
  if (typeof now === "function") return resolveNowTimestamp(now());
  const fromValue = Number.isFinite(Number(now)) ? Number(now) : Date.parse(String(now || ""));
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
  const fromTimestamp = Number.isFinite(Number(fromValue)) ? Number(fromValue) : Date.parse(String(fromValue || ""));
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

function buildLatestGrowthWindow({ profile = null, recentKillChanges = [] } = {}) {
  const latestProofWindow = getLatestProofWindow(profile);
  const previousProofWindow = getPreviousProofWindow(profile);

  if (previousProofWindow && latestProofWindow) {
    const fromKills = normalizeFiniteNumber(previousProofWindow?.approvedKills);
    const toKills = normalizeFiniteNumber(latestProofWindow?.approvedKills);
    const wallClockHours = computeElapsedHours(previousProofWindow?.reviewedAt, latestProofWindow?.reviewedAt);
    if (Number.isFinite(fromKills) && Number.isFinite(toKills) && toKills >= fromKills && Number.isFinite(wallClockHours) && wallClockHours > 0) {
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
  }

  const fallbackChange = Array.isArray(recentKillChanges) ? recentKillChanges[0] : null;
  if (!fallbackChange) return null;
  const fromKills = normalizeFiniteNumber(fallbackChange.from);
  const toKills = normalizeFiniteNumber(fallbackChange.to);
  const fromAt = Number.isFinite(Number(fallbackChange.fromAt)) ? Number(fallbackChange.fromAt) : Date.parse(String(fallbackChange.fromAt || ""));
  const toAt = Number.isFinite(Number(fallbackChange.toAt)) ? Number(fallbackChange.toAt) : Date.parse(String(fallbackChange.toAt || ""));
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
  recentKillChanges = [],
  profile = null,
} = {}) {
  if (!isSelf) return null;

  const lines = [];
  const normalizedApprovedKills = normalizeFiniteNumber(approvedKills);
  const normalizedKillTier = normalizeFiniteNumber(killTier);
  const latestGrowthWindow = buildLatestGrowthWindow({ profile, recentKillChanges });
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

  if (progressState?.reminderEligible) {
    lines.push(`Есть смысл обновить kills: после последнего апрува уже ${formatHours(progressState.jjsHoursSinceLastApprovedKillsUpdate)} ч JJS.`);
  }

  return {
    title: "Практический прогресс",
    lines,
  };
}

function buildProgressSynergyState({ profile = null, robloxSummary = {}, now } = {}) {
  const latestProofWindow = getLatestProofWindow(profile);
  const hoursSinceLastApprovedKillsUpdate = computeElapsedHours(latestProofWindow?.reviewedAt, now);

  if (!latestProofWindow) {
    return {
      latestProofWindow: null,
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
    hoursSinceLastApprovedKillsUpdate,
    jjsHoursSinceLastApprovedKillsUpdate,
    jjsMinutesSinceLastApprovedKillsUpdate,
    hasReliableJjsSinceLastApproved,
    reminderEligible: Number.isFinite(jjsHoursSinceLastApprovedKillsUpdate) && jjsHoursSinceLastApprovedKillsUpdate >= 10,
  };
}

function buildProfileSynergyState(options = {}) {
  const progress = buildProgressSynergyState(options);
  return {
    progress,
    blocks: {
      selfProgress: buildSelfProgressBlock({
        ...options,
        progressState: progress,
      }),
    },
  };
}

module.exports = {
  buildProfileSynergyState,
  buildProgressSynergyState,
};