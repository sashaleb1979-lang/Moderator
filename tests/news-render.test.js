"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { compileDailyNewsDigest } = require("../src/news/compiler");
const { renderDailyNewsIssue } = require("../src/news/render");
const { ensureNewsState } = require("../src/news/state");

const DENY_ALLOWED_MENTIONS = { parse: [], users: [], roles: [], repliedUser: false };

function buildNewsDb() {
  return {
    profiles: {
      "user-1": {
        displayName: "Prime",
        domains: {
          activity: {
            activityScore: 58,
            appliedActivityRoleKey: "active",
          },
          support: {
            antiteam: {
              sourceAvailable: true,
              confirmedArrived: 5,
            },
          },
          tierlist: {
            mainId: "char-sukuna",
            mainName: "Sukuna",
            influenceMultiplier: 1.4,
            submittedAt: "2026-05-14T12:00:00.000Z",
          },
        },
      },
      "user-2": {
        displayName: "Echo",
        domains: {
          activity: {
            activityScore: 31,
            appliedActivityRoleKey: "warm",
          },
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
          tierlist: {
            mainId: "char-gojo",
            mainName: "Gojo",
            influenceMultiplier: 1.5,
          },
        },
      },
      "user-3": {
        displayName: "Nova",
        domains: {
          activity: {
            activityScore: 12,
            appliedActivityRoleKey: "cold",
          },
        },
      },
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
          activity: {
            topMoversCount: 2,
          },
          presentation: {
            masthead: "Moderator Chronicle",
            accentColor: "#E6B450",
            accentColorAlt: "#5DA9E9",
            backgroundColor: "#101418",
          },
        },
        history: {
          daySnapshots: {
            "2026-05-13": {
              "user-1": {
                displayName: "Prime",
                activityScore: 40,
                appliedActivityRoleKey: "warm",
                tierlistMainId: "char-gojo",
                tierlistMainName: "Gojo",
                tierlistInfluenceMultiplier: 1,
                antiteamSupportPoints: 0,
              },
              "user-2": {
                displayName: "Echo",
                activityScore: 45,
                appliedActivityRoleKey: "active",
                tierlistMainId: "char-gojo",
                tierlistMainName: "Gojo",
                tierlistInfluenceMultiplier: 1,
                antiteamSupportPoints: 0,
              },
              "user-3": {
                displayName: "Nova",
                activityScore: 12,
                appliedActivityRoleKey: "cold",
                antiteamSupportPoints: 0,
              },
            },
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
  assert.match(issue.publicMessage.content, /Самый большой рывок/);
  assert.match(issue.publicMessage.content, /⚔️ апы киллов/);
  assert.doesNotMatch(issue.publicMessage.content, /<@/);
  assert.doesNotMatch(issue.publicMessage.content, /Главный рывок дня|резкие апы|редкие/);
  assert.deepEqual(issue.publicMessage.allowedMentions, DENY_ALLOWED_MENTIONS);

  const embed = issue.publicMessage.embeds[0];
  assert.equal(embed.color, 0xE6B450);
  assert.match(embed.description, /Акценты дня/);
  assert.match(embed.description, /⚠️ частично \+ неоднозначно/);
  assert.deepEqual(embed.fields.map((field) => field.name), [
    "⚡ Сильные изменения",
    "💬 Активность · топ сообщений",
    "🎮 JJS · топ игры",
    "🎙️ Voice · лидеры эфира",
    "🛡️ Модерация",
    "🧩 Тирлист · обновления",
    "🛡️ Антитим · новые ранги",
    "📡 Покрытие",
  ]);
  assert.match(embed.fields[0].value, /Prime/);
  assert.match(embed.fields[0].value, /за .*дн\./);
  assert.match(embed.fields[0].value, /антитим/);
  assert.match(embed.fields[1].value, /Echo/);
  assert.match(embed.fields[1].value, /Prime/);
  assert.match(embed.fields[1].value, /\+18 активности/);
  assert.match(embed.fields[2].value, /Echo/);
  assert.match(embed.fields[3].value, /Echo/);
  assert.match(embed.fields[4].value, /Shadow/);
  assert.match(embed.fields[4].value, /бан/);
  assert.match(embed.fields[5].value, /Gojo → Sukuna/);
  assert.match(embed.fields[6].value, /Саппорт/);
  assert.match(embed.fields[7].value, /activity_rows_without_precise_timestamps/);
  assert.doesNotMatch(JSON.stringify(embed), /<@|highlights|резкие апы|редкие/);

  assert.ok(issue.publicThreadMessages.some((message) => {
    return /Полный voice-лидерборд/.test(message.content)
      && /Echo/.test(message.content)
      && /Nova/.test(message.content)
      && JSON.stringify(message.allowedMentions) === JSON.stringify(DENY_ALLOWED_MENTIONS);
  }));
  assert.ok(issue.publicThreadMessages.some((message) => /Все апы киллов/.test(message.content) && /\/день/.test(message.content)));
  assert.ok(issue.publicThreadMessages.some((message) => /Рост активности/.test(message.content)));
  assert.ok(issue.publicThreadMessages.some((message) => /Падение активности/.test(message.content)));
  assert.ok(issue.publicThreadMessages.some((message) => /Полный топ времени JJS/.test(message.content)));
});

test("renderDailyNewsIssue keeps rejected pending and ambiguous evidence in staff payload", () => {
  const { state, digest } = compileFixture();
  const issue = renderDailyNewsIssue({ digest, config: state.config });
  const staffEmbed = issue.staffMessage.embeds[0];

  assert.match(issue.staffMessage.content, /🧾 Staff Audit/);
  assert.match(issue.staffMessage.content, /⚠️ частично \+ неоднозначно/);

  const bucketField = staffEmbed.fields.find((field) => field.name === "📊 Bucket trail");
  assert.match(bucketField.value, /🔴 rejected: \*\*1\*\*/);
  assert.match(bucketField.value, /🟡 pending: \*\*1\*\*/);
  assert.match(bucketField.value, /⚠️ ambiguous: \*\*2\*\*/);

  const killTrail = staffEmbed.fields.find((field) => field.name === "⚔️ Kills staff trail");
  assert.match(killTrail.value, /\*\*Echo\*\* · rejected · 500 kills · bad screenshot/);
  assert.match(killTrail.value, /\*\*Nova\*\* · pending · 220 kills · pending_kill_review/);

  const watchlist = staffEmbed.fields.find((field) => field.name === "👀 Audit watchlist");
  assert.match(watchlist.value, /\*\*Nova\*\* · модерация · ambiguous · leave_ambiguous/);
  assert.match(watchlist.value, /\*\*Nova\*\* · активность · ambiguous · activity_daily_row_without_precise_timestamp/);

  const activityDiagnostics = staffEmbed.fields.find((field) => field.name === "💬 Activity diagnostics");
  assert.match(activityDiagnostics.value, /imprecise rows: \*\*1\*\*/);
  assert.match(activityDiagnostics.value, /changed \/ \*\*3\*\* compared|\*\*2\*\* changed/);

  const moderationDiagnostics = staffEmbed.fields.find((field) => field.name === "🛡️ Moderation diagnostics");
  assert.match(moderationDiagnostics.value, /ambiguous: \*\*1\*\*/);

  const tierlistDiagnostics = staffEmbed.fields.find((field) => field.name === "🧩 Tierlist diagnostics");
  assert.match(tierlistDiagnostics.value, /historical changes/);
});

test("renderDailyNewsIssue uses silent user mentions and avoids duplicate public kill entries", () => {
  const digest = {
    dayKey: "2026-05-15",
    compiledAt: "2026-05-15T18:00:00.000Z",
    coverageWindow: {
      startAt: "2026-05-14T21:00:00.000Z",
      endAt: "2026-05-15T18:00:00.000Z",
      timeZone: "Europe/Moscow",
    },
    publicEdition: {
      voice: { enabled: false, topVisitors: [], visitorCount: 0, allVisitorsLine: null, publishFullListInThread: false },
      moderation: { enabled: false, highlights: [] },
      kills: {
        enabled: true,
        upgradeCount: 1,
        topUpgrades: [{
          userId: "123456789012345678",
          displayName: "@everyone <@999999999999999999>",
          from: 120,
          to: 180,
          delta: 60,
          dayCount: 3,
          averagePerDay: 20,
          toAt: "2026-05-15T12:00:00.000Z",
        }],
      },
      activity: { enabled: false, topMessageAuthors: [], activeUserCount: 0, totalMessagesCount: 0 },
    },
    kills: {
      allUpgrades: [{
        userId: "123456789012345678",
        displayName: "@everyone <@999999999999999999>",
        from: 120,
        to: 180,
        delta: 60,
        dayCount: 3,
        averagePerDay: 20,
        toAt: "2026-05-15T12:00:00.000Z",
      }],
    },
    coverage: { partial: false, ambiguous: false, reasons: [] },
    audit: { rawCandidateCounts: { total: 1 }, bucketCounts: { published_public: 1 } },
    staffDigest: {
      moderation: { totalCount: 0, ambiguousCount: 0 },
      kills: { items: [] },
      activity: { sourceRowCount: 0, impreciseRowCount: 0, movers: { reason: "no_daily_activity_baseline_yet" } },
      gameplay: { items: [] },
    },
  };

  const issue = renderDailyNewsIssue({ digest });
  const publicText = JSON.stringify(issue.publicMessage);
  const threadText = issue.publicThreadMessages.map((message) => message.content).join("\n");

  assert.match(publicText, /<@123456789012345678>/);
  assert.doesNotMatch(publicText, /@everyone|<@999999999999999999>/);
  assert.deepEqual(issue.publicMessage.allowedMentions, DENY_ALLOWED_MENTIONS);
  assert.equal(issue.publicMessage.embeds[0].fields.some((field) => field.name === "⚔️ Киллы · апы"), false);
  assert.match(issue.publicMessage.embeds[0].fields[0].value, /\+60 · за 3 дн\. · ~20\/день/);
  assert.match(threadText, /Все апы киллов/);
  assert.match(threadText, /<@123456789012345678>/);
  assert.ok(issue.publicThreadMessages.every((message) => {
    return JSON.stringify(message.allowedMentions) === JSON.stringify(DENY_ALLOWED_MENTIONS);
  }));
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
  assert.match(issue.publicMessage.embeds[0].description, /окно/);
  assert.equal(issue.publicMessage.embeds[0].fields.length, 0);
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

  assert.match(publicThreadText, /Полный чат-лидерборд/);
  assert.match(publicThreadText, /Safe6/);
  assert.doesNotMatch(publicThreadText, /StaffOnlyImprecise/);
  assert.match(issue.staffMessage.embeds[0].fields.find((field) => field.name === "💬 Activity diagnostics").value, /imprecise rows: \*\*1\*\*/);
});

test("renderDailyNewsIssue surfaces activity role dead transitions and antiteam rank upgrades", () => {
  const db = {
    profiles: {
      returner: {
        displayName: "Returner",
        domains: {
          activity: { activityScore: 22, appliedActivityRoleKey: "weak" },
        },
      },
      fader: {
        displayName: "Fader",
        domains: {
          activity: { activityScore: 0, appliedActivityRoleKey: "dead" },
        },
      },
      helper: {
        displayName: "Helper",
        domains: {
          activity: { activityScore: 33, appliedActivityRoleKey: "weak" },
          support: {
            antiteam: {
              sourceAvailable: true,
              confirmedArrived: 10,
            },
          },
        },
      },
    },
    sot: {
      news: {
        history: {
          daySnapshots: {
            "2026-05-13": {
              returner: {
                displayName: "Returner",
                activityScore: 5,
                appliedActivityRoleKey: "dead",
                antiteamSupportPoints: 0,
              },
              fader: {
                displayName: "Fader",
                activityScore: 20,
                appliedActivityRoleKey: "weak",
                antiteamSupportPoints: 0,
              },
              helper: {
                displayName: "Helper",
                activityScore: 30,
                appliedActivityRoleKey: "weak",
                antiteamSupportPoints: 5,
              },
            },
          },
        },
      },
    },
  };
  const state = ensureNewsState(db);
  const digest = compileDailyNewsDigest({
    db,
    targetDayKey: "2026-05-14",
    now: "2026-05-14T18:00:00.000Z",
    windowEndAt: "2026-05-14T18:00:00.000Z",
  }).digest;

  const issue = renderDailyNewsIssue({ digest, config: state.config });
  const fieldsByName = new Map(issue.publicMessage.embeds[0].fields.map((field) => [field.name, field.value]));
  const publicText = JSON.stringify(issue.publicMessage);

  assert.equal(issue.diagnostics.hasPublicHighlights, true);
  assert.match(fieldsByName.get("⚡ Сильные изменения"), /Returner/);
  assert.match(fieldsByName.get("☠️ Мертвецы"), /вышел из мертвецов/);
  assert.match(fieldsByName.get("☠️ Мертвецы"), /стал мертвецом/);
  assert.match(fieldsByName.get("🛡️ Антитим · новые ранги"), /Helper/);
  assert.match(fieldsByName.get("🛡️ Антитим · новые ранги"), /Саппорт/);
  assert.doesNotMatch(publicText, /<@/);
  assert.ok(issue.publicThreadMessages.some((message) => /Рост активности/.test(message.content) && /Returner/.test(message.content)));
  assert.ok(issue.publicThreadMessages.some((message) => /Падение активности/.test(message.content) && /Fader/.test(message.content)));
  assert.ok(issue.publicThreadMessages.some((message) => /Антитим-очки/.test(message.content) && /Helper/.test(message.content)));
});
