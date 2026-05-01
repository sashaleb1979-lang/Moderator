"use strict";

function normalizeKills(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function getMedianNumber(values) {
  const sorted = [...values]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);

  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function createTierTotals() {
  return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
}

function parseTrackedNumber(value) {
  if (value === null || value === undefined) return NaN;
  if (typeof value === "string" && !value.trim()) return NaN;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : NaN;
}

function hasTrackedKills(entry) {
  const approvedKills = parseTrackedNumber(entry?.approvedKills);
  const killTier = parseTrackedNumber(entry?.killTier);
  return Number.isFinite(approvedKills) && approvedKills >= 0 && Number.isFinite(killTier) && killTier >= 1 && killTier <= 5;
}

function getTierlistStats(entries = [], submissions = []) {
  const pendingCount = submissions.filter((submission) => submission && submission.status === "pending").length;
  const approvedCount = submissions.filter((submission) => submission && submission.status === "approved").length;
  const rejectedCount = submissions.filter((submission) => submission && submission.status === "rejected").length;
  const decidedCount = approvedCount + rejectedCount;
  const totalsByTier = createTierTotals();
  let totalKills = 0;

  for (const entry of entries) {
    totalKills += normalizeKills(entry.approvedKills);
    const tier = Number(entry.killTier);
    if (totalsByTier[tier] !== undefined) totalsByTier[tier] += 1;
  }

  const averageKills = entries.length ? Math.round(totalKills / entries.length) : 0;
  const medianKills = getMedianNumber(entries.map((entry) => entry.approvedKills));

  return {
    totalVerified: entries.length,
    pendingCount,
    approvedCount,
    rejectedCount,
    decidedCount,
    approvalRate: decidedCount ? (approvedCount / decidedCount) * 100 : 0,
    rejectRate: decidedCount ? (rejectedCount / decidedCount) * 100 : 0,
    totalKills,
    averageKills,
    medianKills,
    totalsByTier,
    topEntry: entries[0] || null,
    bottomEntry: entries[entries.length - 1] || null,
  };
}

function getMainStats(entries = []) {
  const statsByMain = new Map();

  for (const entry of entries) {
    const uniqueMains = [...new Set((entry.mains || []).map((value) => String(value || "").trim()).filter(Boolean))];
    for (const main of uniqueMains) {
      if (!statsByMain.has(main)) {
        statsByMain.set(main, {
          main,
          playerCount: 0,
          totalKills: 0,
          kills: [],
          totalsByTier: createTierTotals(),
        });
      }

      const stat = statsByMain.get(main);
      stat.playerCount += 1;
      stat.totalKills += normalizeKills(entry.approvedKills);
      stat.kills.push(normalizeKills(entry.approvedKills));
      const tier = Number(entry.killTier);
      if (stat.totalsByTier[tier] !== undefined) stat.totalsByTier[tier] += 1;
    }
  }

  return [...statsByMain.values()]
    .map((stat) => ({
      main: stat.main,
      playerCount: stat.playerCount,
      averageKills: stat.playerCount ? Math.round(stat.totalKills / stat.playerCount) : 0,
      medianKills: getMedianNumber(stat.kills),
      totalsByTier: stat.totalsByTier,
    }))
    .sort((left, right) => {
      if (right.playerCount !== left.playerCount) return right.playerCount - left.playerCount;
      if (right.averageKills !== left.averageKills) return right.averageKills - left.averageKills;
      return left.main.localeCompare(right.main, "ru");
    });
}

function getTrackedMemberStats(entries = []) {
  const totalsByTier = createTierTotals();
  const rememberedEntries = entries.filter(hasTrackedKills);
  let totalKills = 0;

  for (const entry of rememberedEntries) {
    totalKills += normalizeKills(entry.approvedKills);
    const tier = Number(entry.killTier);
    if (totalsByTier[tier] !== undefined) totalsByTier[tier] += 1;
  }

  const averageKills = rememberedEntries.length ? Math.round(totalKills / rememberedEntries.length) : 0;
  const medianKills = getMedianNumber(rememberedEntries.map((entry) => entry.approvedKills));

  return {
    totalRoleHolders: entries.length,
    rememberedCount: rememberedEntries.length,
    totalKills,
    averageKills,
    medianKills,
    totalsByTier,
  };
}

function getCharacterRoleStats(entries = []) {
  return entries
    .map((entry) => {
      const main = String(entry?.main || "").trim();
      const roleId = String(entry?.roleId || "").trim();
      const rememberedMembers = Array.isArray(entry?.rememberedMembers)
        ? entry.rememberedMembers.filter(hasTrackedKills)
        : [];
      const rememberedCount = rememberedMembers.length;
      const roleHolderCount = Math.max(Number(entry?.roleHolderCount) || 0, rememberedCount);
      const totalKills = rememberedMembers.reduce((sum, member) => sum + normalizeKills(member.approvedKills), 0);
      const totalsByTier = createTierTotals();

      for (const member of rememberedMembers) {
        const tier = Number(member.killTier);
        if (totalsByTier[tier] !== undefined) totalsByTier[tier] += 1;
      }

      return {
        main,
        roleId,
        roleHolderCount,
        rememberedCount,
        totalKills,
        averageKills: rememberedCount ? Math.round(totalKills / rememberedCount) : 0,
        medianKills: getMedianNumber(rememberedMembers.map((member) => member.approvedKills)),
        totalsByTier,
      };
    })
    .filter((entry) => entry.main && entry.roleHolderCount > 0)
    .sort((left, right) => {
      if (right.roleHolderCount !== left.roleHolderCount) return right.roleHolderCount - left.roleHolderCount;
      if (right.rememberedCount !== left.rememberedCount) return right.rememberedCount - left.rememberedCount;
      if (right.averageKills !== left.averageKills) return right.averageKills - left.averageKills;
      return left.main.localeCompare(right.main, "ru");
    });
}

module.exports = {
  getCharacterRoleStats,
  getMainStats,
  getTrackedMemberStats,
  getTierlistStats,
};
