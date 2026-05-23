"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildCharacterFactData,
  collectApprovedKillEvents,
  collectRecentKillChanges,
  collectUserRecentKillChangeHistory,
  paginateRecentKillChanges,
  summarizeRecentKillChange,
} = require("../src/onboard/tierlist-ranking");

test("buildCharacterFactData applies people-count threshold to all facts except global and rare", () => {
  const items = [
    {
      id: "gojo",
      legacyId: "gojo",
      main: "Годжо",
      roleId: "role-gojo",
      peopleCount: 2,
      trackedCount: 2,
      medKills: 5000,
      highCount: 2,
      cluster: { name: "скил", avg: 2 },
    },
    {
      id: "yuji",
      legacyId: "yuji",
      main: "Юджи",
      roleId: "role-yuji",
      peopleCount: 3,
      trackedCount: 3,
      medKills: 4000,
      highCount: 1,
      cluster: { name: "мид", avg: 1 },
    },
    {
      id: "megumi",
      legacyId: "megumi",
      main: "Мегуми",
      roleId: "role-megumi",
      peopleCount: 4,
      trackedCount: 4,
      medKills: 3000,
      highCount: 0,
      cluster: { name: "анскил", avg: 0 },
    },
    {
      id: "nobara",
      legacyId: "nobara",
      main: "Нобара",
      roleId: "role-nobara",
      peopleCount: 1,
      trackedCount: 1,
      medKills: 1000,
      highCount: 1,
      cluster: { name: "лоу", avg: -1 },
    },
  ];

  const factData = buildCharacterFactData(items, [
    { id: "gojo", name: "скил", avg: 2 },
    { id: "yuji", name: "мид", avg: 1 },
    { id: "megumi", name: "анскил", avg: 0 },
    { id: "nobara", name: "лоу", avg: -1 },
  ], { minPeopleCount: 3 });

  assert.deepEqual(factData.medianTop.flatMap((position) => position.items.map((item) => item.id)), ["yuji", "megumi"]);
  assert.deepEqual(factData.highCountTop.flatMap((position) => position.items.map((item) => item.id)), ["yuji"]);
  assert.deepEqual(factData.popularTop.flatMap((position) => position.items.map((item) => item.id)), ["megumi", "yuji"]);
  assert.deepEqual(factData.globalTop.flatMap((position) => position.items.map((item) => item.id)), ["gojo", "yuji", "megumi"]);
  assert.deepEqual(factData.rareTop.flatMap((position) => position.items.map((item) => item.id)), ["nobara", "gojo", "yuji"]);
});

test("collectRecentKillChanges keeps only approved upward changes sorted by latest review", () => {
  const changes = collectRecentKillChanges([
    { userId: "u1", status: "approved", kills: 1000, reviewedAt: "2026-05-01T00:00:00.000Z" },
    { userId: "u1", status: "approved", kills: 1800, reviewedAt: "2026-05-03T00:00:00.000Z" },
    { userId: "u2", status: "approved", kills: 2500, reviewedAt: "2026-05-02T00:00:00.000Z" },
    { userId: "u2", status: "approved", kills: 2400, reviewedAt: "2026-05-04T00:00:00.000Z" },
    { userId: "u3", status: "pending", kills: 5000, reviewedAt: "2026-05-05T00:00:00.000Z" },
    { userId: "u4", status: "approved", kills: 900, reviewedAt: "2026-05-01T00:00:00.000Z" },
    { userId: "u4", status: "approved", kills: 1600, reviewedAt: "2026-05-05T00:00:00.000Z" },
  ]);

  assert.deepEqual(changes, [
    { userId: "u4", from: 900, to: 1600, fromAt: Date.parse("2026-05-01T00:00:00.000Z"), toAt: Date.parse("2026-05-05T00:00:00.000Z") },
    { userId: "u1", from: 1000, to: 1800, fromAt: Date.parse("2026-05-01T00:00:00.000Z"), toAt: Date.parse("2026-05-03T00:00:00.000Z") },
  ]);
});

test("collectRecentKillChanges recovers approved history from profile-backed pending submissions", () => {
  const changes = collectRecentKillChanges([
    { id: "old", userId: "u1", status: "pending", kills: 6117, createdAt: "2026-05-18T04:15:42.353Z" },
    { id: "new", userId: "u1", status: "pending", kills: 6332, createdAt: "2026-05-23T03:49:47.000Z" },
  ], {
    profiles: {
      u1: {
        approvedKills: 6332,
        lastSubmissionStatus: "approved",
        lastSubmissionId: "new",
        lastReviewedAt: "2026-05-23T03:52:00.000Z",
      },
    },
  });

  assert.deepEqual(changes, [
    {
      userId: "u1",
      from: 6117,
      to: 6332,
      fromAt: Date.parse("2026-05-18T04:15:42.353Z"),
      toAt: Date.parse("2026-05-23T03:52:00.000Z"),
    },
  ]);
});

test("collectApprovedKillEvents does not promote active pending updates", () => {
  const events = collectApprovedKillEvents([
    { id: "old", userId: "u1", status: "approved", kills: 1000, reviewedAt: "2026-05-01T00:00:00.000Z" },
    { id: "pending", userId: "u1", status: "pending", kills: 1200, createdAt: "2026-05-02T00:00:00.000Z" },
  ], {
    profiles: {
      u1: {
        approvedKills: 1000,
        lastSubmissionStatus: "pending",
        lastSubmissionId: "pending",
        lastReviewedAt: "2026-05-01T00:00:00.000Z",
      },
    },
  });

  assert.deepEqual(events, [
    { userId: "u1", kills: 1000, at: Date.parse("2026-05-01T00:00:00.000Z") },
  ]);
});

test("collectRecentKillChanges can use proof-window history when submissions were lost", () => {
  const changes = collectRecentKillChanges([], {
    profiles: {
      u1: {
        domains: {
          progress: {
            proofWindows: [
              { approvedKills: 4000, reviewedAt: "2026-05-10T10:00:00.000Z" },
              { approvedKills: 4320, reviewedAt: "2026-05-18T10:00:00.000Z" },
            ],
          },
        },
      },
    },
  });

  assert.deepEqual(changes, [
    {
      userId: "u1",
      from: 4000,
      to: 4320,
      fromAt: Date.parse("2026-05-10T10:00:00.000Z"),
      toAt: Date.parse("2026-05-18T10:00:00.000Z"),
    },
  ]);
});

test("collectUserRecentKillChangeHistory keeps the latest approved upward history for one user", () => {
  const changes = collectUserRecentKillChangeHistory([
    { userId: "u1", status: "approved", kills: 900, reviewedAt: "2026-05-01T00:00:00.000Z" },
    { userId: "u1", status: "approved", kills: 1300, reviewedAt: "2026-05-03T00:00:00.000Z" },
    { userId: "u1", status: "rejected", kills: 1500, reviewedAt: "2026-05-04T00:00:00.000Z" },
    { userId: "u1", status: "approved", kills: 1700, reviewedAt: "2026-05-05T00:00:00.000Z" },
    { userId: "u1", status: "approved", kills: 1650, reviewedAt: "2026-05-06T00:00:00.000Z" },
    { userId: "u1", status: "approved", kills: 2200, reviewedAt: "2026-05-08T00:00:00.000Z" },
    { userId: "u2", status: "approved", kills: 500, reviewedAt: "2026-05-01T00:00:00.000Z" },
    { userId: "u2", status: "approved", kills: 700, reviewedAt: "2026-05-02T00:00:00.000Z" },
  ], "u1", { limit: 3 });

  assert.deepEqual(changes, [
    { userId: "u1", from: 1650, to: 2200, fromAt: Date.parse("2026-05-06T00:00:00.000Z"), toAt: Date.parse("2026-05-08T00:00:00.000Z") },
    { userId: "u1", from: 1300, to: 1700, fromAt: Date.parse("2026-05-03T00:00:00.000Z"), toAt: Date.parse("2026-05-05T00:00:00.000Z") },
    { userId: "u1", from: 900, to: 1300, fromAt: Date.parse("2026-05-01T00:00:00.000Z"), toAt: Date.parse("2026-05-03T00:00:00.000Z") },
  ]);
});

test("summarizeRecentKillChange reports elapsed days and average per day", () => {
  assert.deepEqual(
    summarizeRecentKillChange({
      from: 900,
      to: 1600,
      fromAt: Date.parse("2026-05-01T00:00:00.000Z"),
      toAt: Date.parse("2026-05-05T00:00:00.000Z"),
    }),
    {
      delta: 700,
      dayCount: 4,
      averagePerDay: 175,
    }
  );

  assert.deepEqual(
    summarizeRecentKillChange({
      from: 100,
      to: 160,
      fromAt: Date.parse("2026-05-05T08:00:00.000Z"),
      toAt: Date.parse("2026-05-05T22:00:00.000Z"),
    }),
    {
      delta: 60,
      dayCount: 1,
      averagePerDay: 60,
    }
  );
});

test("paginateRecentKillChanges caps the feed at four pages of five entries", () => {
  const changes = Array.from({ length: 30 }, (_, index) => ({
    userId: `u${index + 1}`,
    from: index,
    to: index + 100,
    fromAt: index,
    toAt: 1000 - index,
  }));

  const page = paginateRecentKillChanges(changes, { page: 3, pageSize: 5, maxPages: 4 });

  assert.equal(page.totalCount, 20);
  assert.equal(page.pageCount, 4);
  assert.equal(page.page, 3);
  assert.equal(page.items.length, 5);
  assert.equal(page.items[0].userId, "u16");
  assert.equal(page.items[4].userId, "u20");
});
