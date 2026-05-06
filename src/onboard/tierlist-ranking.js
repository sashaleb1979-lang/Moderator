"use strict";

function cleanString(value, limit = 200) {
  return String(value || "").trim().slice(0, limit);
}

function normalizeFiniteNumber(value, fallback = 0) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : fallback;
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

function collectRecentKillChanges(submissions = []) {
  const approved = (Array.isArray(submissions) ? submissions : [])
    .filter((submission) => submission && submission.status === "approved" && submission.userId && Number.isFinite(Number(submission.kills)))
    .sort((left, right) => {
      const leftAt = Date.parse(left.reviewedAt || left.createdAt || 0) || 0;
      const rightAt = Date.parse(right.reviewedAt || right.createdAt || 0) || 0;
      return leftAt - rightAt;
    });

  const lastByUser = new Map();
  for (const submission of approved) {
    const nextKills = Number(submission.kills);
    const nextAt = Date.parse(submission.reviewedAt || submission.createdAt || 0) || 0;
    const previous = lastByUser.get(submission.userId);
    if (!previous) {
      lastByUser.set(submission.userId, { prev: null, prevAt: 0, current: nextKills, currentAt: nextAt });
      continue;
    }
    lastByUser.set(submission.userId, { prev: previous.current, prevAt: previous.currentAt, current: nextKills, currentAt: nextAt });
  }

  const upgrades = [];
  for (const [userId, record] of lastByUser) {
    if (record.prev == null) continue;
    if (!(record.current > record.prev)) continue;
    upgrades.push({
      userId,
      from: record.prev,
      to: record.current,
      fromAt: record.prevAt,
      toAt: record.currentAt,
    });
  }

  upgrades.sort((left, right) => right.toAt - left.toAt);
  return upgrades;
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
  collectRecentKillChanges,
  paginateRecentKillChanges,
};"use strict";

function cleanString(value, limit = 200) {
  return String(value || "").trim().slice(0, limit);
}

function normalizeFiniteNumber(value, fallback = 0) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : fallback;
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

function collectRecentKillChanges(submissions = []) {
  const approved = (Array.isArray(submissions) ? submissions : [])
    .filter((submission) => submission && submission.status === "approved" && submission.userId && Number.isFinite(Number(submission.kills)))
    .sort((left, right) => {
      const leftAt = Date.parse(left.reviewedAt || left.createdAt || 0) || 0;
      const rightAt = Date.parse(right.reviewedAt || right.createdAt || 0) || 0;
      return leftAt - rightAt;
    });

  const lastByUser = new Map();
  for (const submission of approved) {
    const nextKills = Number(submission.kills);
    const nextAt = Date.parse(submission.reviewedAt || submission.createdAt || 0) || 0;
    const previous = lastByUser.get(submission.userId);
    if (!previous) {
      lastByUser.set(submission.userId, { prev: null, prevAt: 0, current: nextKills, currentAt: nextAt });
      continue;
    }
    lastByUser.set(submission.userId, { prev: previous.current, prevAt: previous.currentAt, current: nextKills, currentAt: nextAt });
  }

  const upgrades = [];
  for (const [userId, record] of lastByUser) {
    if (record.prev == null) continue;
    if (!(record.current > record.prev)) continue;
    upgrades.push({
      userId,
      from: record.prev,
      to: record.current,
      fromAt: record.prevAt,
      toAt: record.currentAt,
    });
  }

  upgrades.sort((left, right) => right.toAt - left.toAt);
  return upgrades;
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
  collectRecentKillChanges,
  paginateRecentKillChanges,
};