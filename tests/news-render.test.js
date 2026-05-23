"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { compileDailyNewsDigest } = require("../src/news/compiler");
const { renderDailyNewsIssue } = require("../src/news/render");
const { ensureNewsState } = require("../src/news/state");

function buildNewsDb() {
  return {
    profiles: {
      "user-1": { displayName: "Prime" },
      "user-2": {
        displayName: "Echo",
        domains: {
          roblox: {
            playtime: {
              sessionHistory: [
                {
                  startedAt: "2026-05-14T10:00:00.000Z",
                  endedAt: "2026-05-14T11:30:00.000Z",
                },
              ],
            },
          },
        },
      },
      "user-3": { displayName: "Nova" },
      "user-4": { displayName: "Shadow" },
    },
    submissions: {
      old: {
        id: "old",
        userId: "user-1",
        displayName: "Prime",
        kills: 100,
        status: "approved",
        createdAt: "2026-05-14T07:00:00.000Z",
        reviewedAt: "2026-05-14T08:00:00.000Z",
      },
      jump: {
        id: "jump",
        userId: "user-1",
        displayName: "Prime",
        kills: 180,
        status: "approved",
        createdAt: "2026-05-14T12:00:00.000Z",
        reviewedAt: "2026-05-14T13:00:00.000Z",
      },
      rejected: {
        id: "rejected",
        userId: "user-2",
        displayName: "Echo",
        kills: 500,
        status: "rejected",
        createdAt: "2026-05-14T14:00:00.000Z",
        reviewedAt: "2026-05-14T15:00:00.000Z",
        rejectReason: "bad screenshot",
      },
      pending: {
        id: "pending",
        userId: "user-3",
        displayName: "Nova",
        kills: 220,
        status: "pending",
        createdAt: "2026-05-14T16:00:00.000Z",
      },
    },
    sot: {
      activity: {
        userChannelDailyStats: [
          {
            guildId: "guild-1",
            channelId: "chat-1",
            userId: "user-2",
            date: "2026-05-14",
            messagesCount: 42,
            weightedMessagesCount: 42,
            sessionsCount: 3,
            effectiveSessionsCount: 3,
            firstMessageAt: "2026-05-14T10:00:00.000Z",
            lastMessageAt: "2026-05-14T12:30:00.000Z",
          },
          {
            guildId: "guild-1",
            channelId: "chat-1",
            userId: "user-3",
            date: "2026-05-14",
            messagesCount: 25,
            weightedMessagesCount: 25,
          },
        ],
      },
      news: {
        config: {
          voice: {
            includeFullList: true,
            publishFullListInThread: true,
          },
          presentation: {
            masthead: "Moderator Chronicle",
            accentColor: "#E6B450",
            accentColorAlt: "#5DA9E9",
            backgroundColor: "#101418",
          },
        },
        voice: {
          finalizedSessions: [
            {
              userId: "user-2",
              displayName: "Echo",
              joinedAt: "2026-05-14T09:00:00.000Z",
              endedAt: "2026-05-14T11:30:00.000Z",
              enteredChannelIds: ["voice-main"],
              moveCount: 1,
            },
            {
              userId: "user-3",
              displayName: "Nova",
              joinedAt: "2026-05-14T12:00:00.000Z",
              endedAt: "2026-05-14T12:40:00.000Z",
              enteredChannelIds: ["voice-main"],
            },
          ],
        },
        moderation: {
          events: [
            {
              eventType: "ban_add",
              guildId: "guild-1",
              userId: "user-4",
              displayName: "Shadow",
              occurredAt: "2026-05-14T13:30:00.000Z",
              resolution: "ban_confirmed",
            },
            {
              eventType: "member_remove",
              guildId: "guild-1",
              userId: "user-3",
              displayName: "Nova",
              occurredAt: "2026-05-14T14:30:00.000Z",
              resolution: "leave_ambiguous",
            },
          ],
        },
      },
    },
  };
}

function compileFixture() {
  const db = buildNewsDb();
  const state = ensureNewsState(db);
  const result = compileDailyNewsDigest({
    db,
    targetDayKey: "2026-05-14",
    now: "2026-05-14T18:00:00.000Z",
    windowEndAt: "2026-05-14T18:00:00.000Z",
  });
  return { db, state, digest: result.digest };
}

test("renderDailyNewsIssue builds edition-style public payload from compiled digest", () => {
  const { state, digest } = compileFixture();
  const beforeDigest = JSON.stringify(digest);
  const issue = renderDailyNewsIssue({ digest, config: state.config });

  assert.equal(JSON.stringify(digest), beforeDigest);
  assert.equal(issue.dayKey, "2026-05-14");
  assert.equal(issue.coverSpec.masthead, "Moderator Chronicle");
  assert.equal(issue.coverSpec.accentColor, "#E6B450");
  assert.match(issue.publicMessage.content, /🗞️ Moderator Chronicle · 14\.05\.2026/);
  assert.match(issue.publicMessage.content, /━━━━━━━━/);
  assert.match(issue.publicMessage.content, /⚔️ kill jumps/);
  assert.deepEqual(issue.publicMessage.allowedMentions, { parse: [] });

  const embed = issue.publicMessage.embeds[0];
  assert.equal(embed.color, 0xE6B450);
  assert.match(embed.description, /Акценты дня/);
  assert.match(embed.description, /⚠️ partial \+ ambiguous/);
  assert.deepEqual(embed.fields.map((field) => field.name), [
    "⚔️ Kills · резкие апы",
    "💬 Activity · топ сообщений",
    "🎮 JJS · топ игры",
    "🆕 New · входы и верификации",
    "🎙️ Voice · лидеры эфира",
    "🛡️ Moderation · highlights",
    "🧩 Tierlist · updates",
    "📡 Coverage",
  ]);
  assert.match(embed.fields[0].value, /Prime/);
  assert.match(embed.fields[1].value, /Echo/);
  assert.match(embed.fields[2].value, /Echo/);
  assert.match(embed.fields[4].value, /Echo/);
  assert.match(embed.fields[5].value, /Shadow/);
  assert.match(embed.fields[7].value, /activity_rows_without_precise_timestamps/);

  assert.ok(issue.publicThreadMessages.some((message) => {
    return /Полный voice список/.test(message.content)
      && /Echo/.test(message.content)
      && /Nova/.test(message.content);
  }));
});

test("renderDailyNewsIssue keeps rejected pending and ambiguous evidence in staff payload", () => {
  const { state, digest } = compileFixture();
  const issue = renderDailyNewsIssue({ digest, config: state.config });
  const staffEmbed = issue.staffMessage.embeds[0];

  assert.match(issue.staffMessage.content, /🧾 Staff Audit/);
  assert.match(issue.staffMessage.content, /⚠️ partial \+ ambiguous/);

  const bucketField = staffEmbed.fields.find((field) => field.name === "📊 Bucket trail");
  assert.match(bucketField.value, /🔴 rejected: \*\*1\*\*/);
  assert.match(bucketField.value, /🟡 pending: \*\*1\*\*/);
  assert.match(bucketField.value, /⚠️ ambiguous: \*\*2\*\*/);

  const killTrail = staffEmbed.fields.find((field) => field.name === "⚔️ Kills staff trail");
  assert.match(killTrail.value, /\*\*Echo\*\* · rejected · 500 kills · bad screenshot/);
  assert.match(killTrail.value, /\*\*Nova\*\* · pending · 220 kills · pending_kill_review/);

  const activityDiagnostics = staffEmbed.fields.find((field) => field.name === "💬 Activity diagnostics");
  assert.match(activityDiagnostics.value, /imprecise rows: \*\*1\*\*/);

  const moderationDiagnostics = staffEmbed.fields.find((field) => field.name === "🛡️ Moderation diagnostics");
  assert.match(moderationDiagnostics.value, /ambiguous: \*\*1\*\*/);
});

test("renderDailyNewsIssue degrades gracefully when the digest has no public highlights", () => {
  const digest = {
    dayKey: "2026-05-15",
    compiledAt: "2026-05-15T18:00:00.000Z",
    coverageWindow: {
      startAt: "2026-05-14T21:00:00.000Z",
      endAt: "2026-05-15T18:00:00.000Z",
      timeZone: "Europe/Moscow",
    },
    publicEdition: {
      voice: { enabled: false, topVisitors: [], visitorCount: 0, allVisitorsLine: null },
      moderation: { enabled: false, highlights: [] },
      kills: { enabled: false, topUpgrades: [], upgradeCount: 0 },
      activity: { enabled: false, topMessageAuthors: [], activeUserCount: 0, totalMessagesCount: 0 },
    },
    coverage: { partial: false, ambiguous: false, reasons: [] },
    audit: { rawCandidateCounts: { total: 0 }, bucketCounts: {} },
    staffDigest: {
      moderation: { totalCount: 0, ambiguousCount: 0 },
      kills: { items: [] },
      activity: { sourceRowCount: 0, impreciseRowCount: 0, movers: { reason: "no_daily_activity_baseline_yet" } },
    },
  };

  const issue = renderDailyNewsIssue({ digest });

  assert.match(issue.publicMessage.content, /Daily Edition · 15\.05\.2026/);
  assert.match(issue.publicMessage.embeds[0].description, /День прошёл спокойно/);
  assert.match(issue.publicMessage.embeds[0].fields[0].value, /без approved kill jump/);
  assert.equal(issue.publicThreadMessages.length, 0);
  assert.equal(issue.diagnostics.hasPublicHighlights, false);
});

test("renderDailyNewsIssue keeps imprecise activity rows out of public thread", () => {
  const safeAuthors = Array.from({ length: 6 }, (_, index) => ({
    userId: `safe-${index + 1}`,
    displayName: `Safe${index + 1}`,
    messagesCount: 100 - index,
    sessionsCount: 1,
    hasImpreciseRows: false,
  }));
  const digest = {
    dayKey: "2026-05-16",
    compiledAt: "2026-05-16T18:00:00.000Z",
    coverageWindow: {
      startAt: "2026-05-15T21:00:00.000Z",
      endAt: "2026-05-16T18:00:00.000Z",
      timeZone: "Europe/Moscow",
    },
    publicEdition: {
      voice: { enabled: false, topVisitors: [], visitorCount: 0, allVisitorsLine: null, publishFullListInThread: false },
      moderation: { enabled: false, highlights: [] },
      kills: { enabled: false, topUpgrades: [], upgradeCount: 0 },
      activity: { enabled: true, topMessageAuthors: safeAuthors.slice(0, 5), activeUserCount: 7, totalMessagesCount: 640 },
    },
    activity: {
      allMessageAuthors: [
        ...safeAuthors,
        {
          userId: "imprecise-1",
          displayName: "StaffOnlyImprecise",
          messagesCount: 500,
          sessionsCount: 1,
          hasImpreciseRows: true,
        },
      ],
    },
    coverage: { partial: true, ambiguous: true, reasons: ["activity_rows_without_precise_timestamps"] },
    audit: { rawCandidateCounts: { total: 7 }, bucketCounts: { ambiguous_source: 1 } },
    staffDigest: {
      moderation: { totalCount: 0, ambiguousCount: 0 },
      kills: { items: [] },
      activity: { sourceRowCount: 7, impreciseRowCount: 1, movers: { reason: "no_daily_activity_baseline_yet" } },
    },
  };

  const issue = renderDailyNewsIssue({ digest });
  const publicThreadText = issue.publicThreadMessages.map((message) => message.content).join("\n");

  assert.match(publicThreadText, /Расширенный chat leaderboard/);
  assert.match(publicThreadText, /Safe6/);
  assert.doesNotMatch(publicThreadText, /StaffOnlyImprecise/);
  assert.match(issue.staffMessage.embeds[0].fields.find((field) => field.name === "💬 Activity diagnostics").value, /imprecise rows: \*\*1\*\*/);
});
