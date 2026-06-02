"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildAnalyticsSummary,
  normalizeAnalyticsState,
  recordAnalyticsEvent,
} = require("../src/analytics/state");

test("recordAnalyticsEvent stores detailed events and summarizes unique users", () => {
  let state = normalizeAnalyticsState({});
  state = recordAnalyticsEvent(state, {
    id: "evt-1",
    at: "2026-06-02T10:00:00.000Z",
    feature: "profile",
    action: "open_card",
    actorUserId: "user-1",
    interactionType: "button",
  }, { now: "2026-06-02T10:00:00.000Z" }).state;
  state = recordAnalyticsEvent(state, {
    id: "evt-2",
    at: "2026-06-02T10:01:00.000Z",
    feature: "profile",
    action: "nav_activity",
    actorUserId: "user-1",
    interactionType: "button",
  }, { now: "2026-06-02T10:01:00.000Z" }).state;
  state = recordAnalyticsEvent(state, {
    id: "evt-3",
    at: "2026-06-02T10:02:00.000Z",
    feature: "antiteam",
    action: "leaders",
    actorUserId: "user-2",
    interactionType: "button",
  }, { now: "2026-06-02T10:02:00.000Z" }).state;

  const summary = buildAnalyticsSummary(state);
  assert.equal(summary.total, 3);
  assert.equal(summary.uniqueUserCount, 2);
  assert.equal(summary.featureList[0].feature, "profile");
  assert.equal(summary.featureList[0].total, 2);
  assert.equal(summary.userList[0].userId, "user-1");
  assert.equal(summary.userList[0].total, 2);
});

test("recordAnalyticsEvent compacts old events into daily archive", () => {
  let state = normalizeAnalyticsState({ retentionDays: 90 });
  state = recordAnalyticsEvent(state, {
    id: "old",
    at: "2026-01-01T10:00:00.000Z",
    feature: "combo_guide",
    action: "redirect",
    interactionType: "link",
    metadata: { redirect: true },
  }, { now: "2026-01-01T10:00:00.000Z" }).state;

  const result = recordAnalyticsEvent(state, {
    id: "new",
    at: "2026-06-02T10:00:00.000Z",
    feature: "profile",
    action: "open_card",
    actorUserId: "user-1",
  }, { now: "2026-06-02T10:00:00.000Z" });

  assert.equal(result.archived, 1);
  assert.equal(result.state.events.length, 1);
  assert.equal(result.state.archiveDaily["2026-01-01"].total, 1);

  const summary = buildAnalyticsSummary(result.state);
  assert.equal(summary.total, 2);
  assert.equal(summary.archivedTotal, 1);
  assert.equal(summary.linkClicks, 1);
});
