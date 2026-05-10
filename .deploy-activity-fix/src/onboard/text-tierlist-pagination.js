"use strict";

function normalizePositiveInt(value, fallback = 1) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return Math.max(1, Math.floor(fallback) || 1);
  return Math.max(1, Math.floor(amount));
}

function clampPageIndex(value, pageCount) {
  const totalPages = normalizePositiveInt(pageCount, 1);
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Math.min(Math.floor(amount), totalPages - 1);
}

function normalizeTextTierlistPaginationState(state = {}) {
  const target = state && typeof state === "object" ? state : {};
  if (!Number.isFinite(Number(target.page)) || Number(target.page) < 0) target.page = 0;
  else target.page = Math.floor(Number(target.page));

  if (!Number.isFinite(Number(target.recentPage)) || Number(target.recentPage) < 0) target.recentPage = 0;
  else target.recentPage = Math.floor(Number(target.recentPage));

  if (!Number.isFinite(Number(target.lastInteractionAt)) || Number(target.lastInteractionAt) < 0) target.lastInteractionAt = 0;
  else target.lastInteractionAt = Number(target.lastInteractionAt);

  return target;
}

function resolveTextTierlistPageState(state = {}, options = {}) {
  const rankPageCount = normalizePositiveInt(options.rankPageCount, 1);
  const recentPageCount = normalizePositiveInt(options.recentPageCount, 1);

  return {
    rankPageCount,
    recentPageCount,
    page: clampPageIndex(state?.page, rankPageCount),
    recentPage: clampPageIndex(state?.recentPage, recentPageCount),
  };
}

function applyTextTierlistPaginationAction(state = {}, action = "", options = {}) {
  const resolved = resolveTextTierlistPageState(state, options);
  let nextPage = resolved.page;
  let nextRecentPage = resolved.recentPage;

  switch (String(action || "").trim()) {
    case "rank_first":
      nextPage = 0;
      break;
    case "rank_prev":
      nextPage = Math.max(0, resolved.page - 1);
      break;
    case "rank_next":
      nextPage = Math.min(resolved.rankPageCount - 1, resolved.page + 1);
      break;
    case "recent_first":
      nextRecentPage = 0;
      break;
    case "recent_prev":
      nextRecentPage = Math.max(0, resolved.recentPage - 1);
      break;
    case "recent_next":
      nextRecentPage = Math.min(resolved.recentPageCount - 1, resolved.recentPage + 1);
      break;
    default:
      break;
  }

  return {
    rankPageCount: resolved.rankPageCount,
    recentPageCount: resolved.recentPageCount,
    page: nextPage,
    recentPage: nextRecentPage,
  };
}

module.exports = {
  applyTextTierlistPaginationAction,
  normalizeTextTierlistPaginationState,
  resolveTextTierlistPageState,
};