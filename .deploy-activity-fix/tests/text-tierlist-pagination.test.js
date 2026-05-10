"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  applyTextTierlistPaginationAction,
  normalizeTextTierlistPaginationState,
  resolveTextTierlistPageState,
} = require("../src/onboard/text-tierlist-pagination");

test("normalizeTextTierlistPaginationState seeds missing rank and recent page fields", () => {
  const state = normalizeTextTierlistPaginationState({});

  assert.deepEqual(state, {
    page: 0,
    recentPage: 0,
    lastInteractionAt: 0,
  });
});

test("resolveTextTierlistPageState clamps rank and recent pages independently", () => {
  assert.deepEqual(
    resolveTextTierlistPageState({ page: 9, recentPage: 4 }, { rankPageCount: 3, recentPageCount: 2 }),
    {
      rankPageCount: 3,
      recentPageCount: 2,
      page: 2,
      recentPage: 1,
    }
  );
});

test("applyTextTierlistPaginationAction changes only the targeted section", () => {
  const afterRank = applyTextTierlistPaginationAction(
    { page: 1, recentPage: 2 },
    "rank_next",
    { rankPageCount: 4, recentPageCount: 5 }
  );
  assert.deepEqual(afterRank, {
    rankPageCount: 4,
    recentPageCount: 5,
    page: 2,
    recentPage: 2,
  });

  const afterRecent = applyTextTierlistPaginationAction(
    { page: 2, recentPage: 2 },
    "recent_prev",
    { rankPageCount: 4, recentPageCount: 5 }
  );
  assert.deepEqual(afterRecent, {
    rankPageCount: 4,
    recentPageCount: 5,
    page: 2,
    recentPage: 1,
  });
});