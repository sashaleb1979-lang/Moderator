"use strict";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function cleanString(value, limit = 200) {
  return String(value || "").trim().slice(0, limit);
}

function normalizeFiniteNumber(value, fallback = 0) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : fallback;
}

function normalizeNullableFiniteNumber(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

function normalizeDayTimestamp(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 0;

  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function topPositions(items = [], scoreFn, takePositions = 3) {
  const enriched = (Array.isArray(items) ? items : [])
    .map((item) => ({ item, score: Number(scoreFn(item)) }))
    .filter((entry) => Number.isFinite(entry.score));

  if (!enriched.length) return [];

  enriched.sort((left, right) => right.score - left.score);
  const positions = [];
  let index = 0;

  while (positions.length < takePositions && index < enriched.length) {
    const score = enriched[index].score;
    const tieItems = [];
    while (index < enriched.length && enriched[index].score === score) {
      tieItems.push(enriched[index].item);
      index += 1;
    }
    positions.push({ score, items: tieItems });
  }

  return positions;
}

function getProfileByUserId(profiles = {}, userId = "") {
  const normalizedUserId = cleanString(userId, 80);
  if (!normalizedUserId || !profiles || typeof profiles !== "object" || Array.isArray(profiles)) return null;
  return profiles[normalizedUserId] && typeof profiles[normalizedUserId] === "object" ? profiles[normalizedUserId] : null;
}

function getProfileReviewedAt(profile = {}) {
  return cleanString(
    profile?.lastReviewedAt
      ?? profile?.summary?.onboarding?.lastReviewedAt
      ?? profile?.domains?.onboarding?.lastReviewedAt
      ?? profile?.domains?.roblox?.lastReviewedAt,
    120
  );
}

function getProfileApprovedKills(profile = {}) {
  return normalizeNullableFiniteNumber(
    profile?.approvedKills
      ?? profile?.summary?.onboarding?.approvedKills
      ?? profile?.domains?.onboarding?.approvedKills
  );
}

function getProfileLastSubmissionStatus(profile = {}) {
  return cleanString(
    profile?.lastSubmissionStatus
      ?? profile?.summary?.onboarding?.lastSubmissionStatus
      ?? profile?.domains?.onboarding?.lastSubmissionStatus,
    40
  );
}

function getProfileLastSubmissionId(profile = {}) {
  return cleanString(
    profile?.lastSubmissionId
      ?? profile?.summary?.onboarding?.lastSubmissionId
      ?? profile?.domains?.onboarding?.lastSubmissionId,
    120
  );
}

function shouldRecoverApprovedSubmissionFromProfile(submission = {}, profile = {}) {
  const status = cleanString(submission?.status, 40);
  if (status === "approved") return true;
  if (status !== "pending") return false;

  const profileStatus = getProfileLastSubmissionStatus(profile);
  if (profileStatus !== "approved") return false;

  const approvedKills = getProfileApprovedKills(profile);
  const submissionKills = normalizeNullableFiniteNumber(submission?.kills);
  if (approvedKills === null || submissionKills === null) return false;

  const submissionId = cleanString(submission?.id, 120);
  const lastSubmissionId = getProfileLastSubmissionId(profile);
  if (submissionId && lastSubmissionId && submissionId === lastSubmissionId && submissionKills === approvedKills) {
    return true;
  }

  const profileReviewedAt = Date.parse(getProfileReviewedAt(profile) || "") || 0;
  const submissionCreatedAt = Date.parse(submission?.createdAt || "") || 0;
  return profileReviewedAt > 0
    && submissionCreatedAt > 0
    && submissionCreatedAt <= profileReviewedAt
    && submissionKills <= approvedKills;
}

function collectApprovedKillEvents(submissions = [], options = {}) {
  const profiles = options?.profiles && typeof options.profiles === "object" && !Array.isArray(options.profiles)
    ? options.profiles
    : {};
  const eventsByKey = new Map();

  const addEvent = (event = {}) => {
    const userId = cleanString(event.userId, 80);
    const kills = normalizeNullableFiniteNumber(event.kills);
    const at = Number(event.at);
    if (!userId || kills === null || !Number.isFinite(at) || at <= 0) return;

    const key = `${userId}:${Math.round(kills)}:${Math.round(at)}`;
    if (!eventsByKey.has(key)) {
      eventsByKey.set(key, {
        userId,
        kills,
        at,
      });
    }
  };

  for (const submission of Array.isArray(submissions) ? submissions : []) {
    if (!submission || typeof submission !== "object") continue;
    const userId = cleanString(submission.userId, 80);
    const profile = getProfileByUserId(profiles, userId);
    if (!shouldRecoverApprovedSubmissionFromProfile(submission, profile || {})) continue;

    const reviewedAt = Date.parse(submission.reviewedAt || "") || 0;
    const recoveredProfileAt = Date.parse(getProfileReviewedAt(profile || {}) || "") || 0;
    const createdAt = Date.parse(submission.createdAt || "") || 0;
    const isProfileCurrentSubmission = cleanString(submission.id, 120)
      && cleanString(submission.id, 120) === getProfileLastSubmissionId(profile || {});
    addEvent({
      userId,
      kills: submission.kills,
      at: reviewedAt || (isProfileCurrentSubmission ? recoveredProfileAt : 0) || createdAt,
    });
  }

  for (const [userId, profile] of Object.entries(profiles)) {
    const proofWindows = Array.isArray(profile?.domains?.progress?.proofWindows)
      ? profile.domains.progress.proofWindows
      : [];
    for (const proofWindow of proofWindows) {
      addEvent({
        userId,
        kills: proofWindow?.approvedKills,
        at: Date.parse(proofWindow?.reviewedAt || "") || 0,
      });
    }

    addEvent({
      userId,
      kills: getProfileApprovedKills(profile),
      at: Date.parse(getProfileReviewedAt(profile) || "") || 0,
    });
  }

  return [...eventsByKey.values()].sort((left, right) => {
    if (left.at !== right.at) return left.at - right.at;
    if (left.kills !== right.kills) return left.kills - right.kills;
    return left.userId.localeCompare(right.userId);
  });
}

function buildClusterRankingItems(items = [], clusterRanking = []) {
  const itemById = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const id = cleanString(item?.id, 120);
    const legacyId = cleanString(item?.legacyId, 120);
    if (id) itemById.set(id, item);
    if (legacyId) itemById.set(legacyId, item);
  }

  return (Array.isArray(clusterRanking) ? clusterRanking : []).map((entry) => {
    const id = cleanString(entry?.id, 120);
    const match = id ? itemById.get(id) : null;
    const score = normalizeFiniteNumber(entry?.avg);
    if (match) {
      return {
        ...match,
        clusterRankingAvg: score,
      };
    }

    const fallbackName = cleanString(entry?.name, 120) || id;
    return {
      id,
      legacyId: id,
      main: fallbackName,
      roleId: "",
      peopleCount: 0,
      trackedCount: 0,
      cluster: {
        name: fallbackName,
        avg: score,
      },
      clusterRankingAvg: score,
    };
  });
}

function buildCharacterFactData(items = [], clusterRanking = [], options = {}) {
  const minPeopleCount = Math.max(1, Number(options.minPeopleCount) || 3);
  const itemsWithPeople = (Array.isArray(items) ? items : []).filter((item) => normalizeFiniteNumber(item?.peopleCount) >= minPeopleCount);
  const itemsWithAnyPeople = (Array.isArray(items) ? items : []).filter((item) => normalizeFiniteNumber(item?.peopleCount) > 0);
  const clusterItems = buildClusterRankingItems(items, clusterRanking);

  return {
    medianTop: topPositions(itemsWithPeople.filter((item) => normalizeFiniteNumber(item?.trackedCount) > 0), (item) => normalizeFiniteNumber(item?.medKills), 3),
    medianBottom: topPositions(itemsWithPeople.filter((item) => normalizeFiniteNumber(item?.trackedCount) > 0), (item) => -normalizeFiniteNumber(item?.medKills), 3),
    globalTop: topPositions(clusterItems, (item) => normalizeFiniteNumber(item?.clusterRankingAvg), 3),
    globalBottom: topPositions(clusterItems, (item) => -normalizeFiniteNumber(item?.clusterRankingAvg), 3),
    highCountTop: topPositions(itemsWithPeople.filter((item) => normalizeFiniteNumber(item?.highCount) > 0), (item) => normalizeFiniteNumber(item?.highCount), 3),
    highRateTop: topPositions(itemsWithPeople.filter((item) => normalizeFiniteNumber(item?.trackedCount) > 0), (item) => Math.round((normalizeFiniteNumber(item?.highCount) / Math.max(1, normalizeFiniteNumber(item?.trackedCount))) * 100), 3),
    popularTop: topPositions(itemsWithPeople, (item) => normalizeFiniteNumber(item?.peopleCount), 3),
    rareTop: topPositions(itemsWithAnyPeople, (item) => -normalizeFiniteNumber(item?.peopleCount), 3),
  };
}

function collectRecentKillChanges(submissions = [], options = {}) {
  const approvedEvents = collectApprovedKillEvents(submissions, options);
  const eventsByUser = new Map();

  for (const event of approvedEvents) {
    const items = eventsByUser.get(event.userId) || [];
    items.push(event);
    eventsByUser.set(event.userId, items);
  }

  const upgrades = [];
  for (const [userId, events] of eventsByUser) {
    for (let index = events.length - 1; index > 0; index -= 1) {
      const current = events[index];
      const previous = events[index - 1];
      if (!(current.kills > previous.kills)) continue;

      upgrades.push({
        userId,
        from: previous.kills,
        to: current.kills,
        fromAt: previous.at,
        toAt: current.at,
      });
      break;
    }
  }

  upgrades.sort((left, right) => right.toAt - left.toAt);
  return upgrades;
}

function collectUserRecentKillChangeHistory(submissions = [], userId = "", options = {}) {
  const normalizedUserId = cleanString(userId, 80);
  const limit = Math.max(1, Number(options.limit) || 3);
  if (!normalizedUserId) return [];

  const approved = collectApprovedKillEvents(submissions, options)
    .filter((event) => event.userId === normalizedUserId)
    .map((event) => ({
      kills: event.kills,
      at: event.at,
    }));

  if (approved.length < 2) return [];

  const changes = [];
  for (let index = approved.length - 1; index > 0; index -= 1) {
    const current = approved[index];
    const previous = approved[index - 1];
    if (!(current.kills > previous.kills)) continue;
    changes.push({
      userId: normalizedUserId,
      from: previous.kills,
      to: current.kills,
      fromAt: previous.at,
      toAt: current.at,
    });
    if (changes.length >= limit) break;
  }

  return changes;
}

function summarizeRecentKillChange(change = {}) {
  const from = normalizeFiniteNumber(change?.from);
  const to = normalizeFiniteNumber(change?.to);
  const delta = to - from;
  const fromDay = normalizeDayTimestamp(change?.fromAt);
  const toDay = normalizeDayTimestamp(change?.toAt);
  const dayCount = fromDay && toDay && toDay > fromDay
    ? Math.max(1, Math.ceil((toDay - fromDay) / MS_PER_DAY))
    : 1;

  return {
    delta,
    dayCount,
    averagePerDay: delta / dayCount,
  };
}

function paginateRecentKillChanges(changes = [], options = {}) {
  const pageSize = Math.max(1, Number(options.pageSize) || 5);
  const maxPages = Math.max(1, Number(options.maxPages) || 4);
  const capped = (Array.isArray(changes) ? changes : []).slice(0, pageSize * maxPages);
  const pageCount = Math.max(1, Math.ceil(capped.length / pageSize));
  const page = Math.min(Math.max(0, Number(options.page) || 0), pageCount - 1);
  const start = page * pageSize;

  return {
    items: capped.slice(start, start + pageSize),
    totalCount: capped.length,
    page,
    pageCount,
    hasPrev: page > 0,
    hasNext: page + 1 < pageCount,
  };
}

module.exports = {
  buildCharacterFactData,
  collectApprovedKillEvents,
  collectRecentKillChanges,
  collectUserRecentKillChangeHistory,
  paginateRecentKillChanges,
  summarizeRecentKillChange,
};
