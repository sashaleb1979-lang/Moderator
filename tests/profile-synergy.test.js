"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildProgressSynergyState, buildProfileSynergyState } = require("../src/profile/synergy");

const GRADE_RANK = Object.freeze({
  "N/A": -1,
  "D-": 0,
  D: 1,
  "D+": 2,
  "C-": 3,
  C: 4,
  "C+": 5,
  "B-": 6,
  B: 7,
  "B+": 8,
  "A-": 9,
  A: 10,
  "A+": 11,
  S: 12,
  "S+": 13,
});

function extractViewerGrades(line = "") {
  const match = String(line).match(/Форма (S\+|S|A\+|A|A-|B\+|B|B-|C\+|C|C-|D\+|D|D-|N\/A) • Чат (S\+|S|A\+|A|A-|B\+|B|B-|C\+|C|C-|D\+|D|D-|N\/A) • Килы (S\+|S|A\+|A|A-|B\+|B|B-|C\+|C|C-|D\+|D|D-|N\/A) • Стабильность (S\+|S|A\+|A|A-|B\+|B|B-|C\+|C|C-|D\+|D|D-|N\/A) • Развитие (S\+|S|A\+|A|A-|B\+|B|B-|C\+|C|C-|D\+|D|D-|N\/A) • Соц (S\+|S|A\+|A|A-|B\+|B|B-|C\+|C|C-|D\+|D|D-|N\/A)/);
  return match
    ? {
      form: match[1],
      chat: match[2],
      kills: match[3],
      stability: match[4],
      growth: match[5],
      social: match[6],
    }
    : null;
}

function makePopulationProfile({
  userId,
  approvedKills = 0,
  killTier = 0,
  activityScore = 0,
  messages7d = 0,
  jjsMinutes7d = 0,
  lastSeenInJjsAt = "2026-05-15T00:00:00.000Z",
  reviewedAt = "2026-05-14T00:00:00.000Z",
  totalJjsMinutes = 0,
} = {}) {
  return {
    userId,
    profile: {
      approvedKills,
      killTier,
      summary: {
        onboarding: { approvedKills, killTier },
        activity: {
          activityScore,
          messages7d,
        },
        roblox: {
          hasVerifiedAccount: true,
          jjsMinutes7d,
          lastSeenInJjsAt,
          totalJjsMinutes,
        },
      },
      domains: {
        progress: {
          proofWindows: reviewedAt
            ? [
              {
                approvedKills,
                reviewedAt,
                playtimeTracked: true,
                totalJjsMinutes,
              },
            ]
            : [],
        },
      },
    },
  };
}

test("buildProgressSynergyState derives wall-clock and JJS hours since latest approved proof window", () => {
  const state = buildProgressSynergyState({
    now: "2026-05-16T12:00:00.000Z",
    profile: {
      domains: {
        progress: {
          proofWindows: [
            {
              approvedKills: 4300,
              reviewedAt: "2026-05-15T00:00:00.000Z",
              playtimeTracked: true,
              totalJjsMinutes: 120,
            },
          ],
        },
      },
    },
    robloxSummary: {
      hasVerifiedAccount: true,
      totalJjsMinutes: 900,
    },
  });

  assert.equal(state.latestProofWindow.approvedKills, 4300);
  assert.equal(state.hoursSinceLastApprovedKillsUpdate, 36);
  assert.equal(state.jjsMinutesSinceLastApprovedKillsUpdate, 780);
  assert.equal(state.jjsHoursSinceLastApprovedKillsUpdate, 13);
  assert.equal(state.hasReliableJjsSinceLastApproved, true);
  assert.equal(state.reminderEligible, true);
});

test("buildProgressSynergyState stays honest when tracked Roblox baseline is unreliable", () => {
  const state = buildProgressSynergyState({
    now: "2026-05-16T12:00:00.000Z",
    profile: {
      domains: {
        progress: {
          proofWindows: [
            {
              approvedKills: 4300,
              reviewedAt: "2026-05-15T00:00:00.000Z",
              playtimeTracked: false,
              totalJjsMinutes: 120,
            },
          ],
        },
      },
    },
    robloxSummary: {
      hasVerifiedAccount: true,
      totalJjsMinutes: 900,
    },
  });

  assert.equal(state.hoursSinceLastApprovedKillsUpdate, 36);
  assert.equal(state.jjsHoursSinceLastApprovedKillsUpdate, null);
  assert.equal(state.hasReliableJjsSinceLastApproved, false);
  assert.equal(state.reminderEligible, false);
});

test("buildProfileSynergyState builds a self-progress block with growth window and countdowns", () => {
  const state = buildProfileSynergyState({
    now: "2026-05-16T12:00:00.000Z",
    isSelf: true,
    approvedKills: 4300,
    killTier: 3,
    profile: {
      domains: {
        progress: {
          proofWindows: [
            {
              approvedKills: 3500,
              killTier: 3,
              reviewedAt: "2026-05-05T00:00:00.000Z",
              playtimeTracked: true,
              totalJjsMinutes: 300,
            },
            {
              approvedKills: 4000,
              killTier: 3,
              reviewedAt: "2026-05-10T00:00:00.000Z",
              playtimeTracked: true,
              totalJjsMinutes: 900,
            },
            {
              approvedKills: 4300,
              killTier: 3,
              reviewedAt: "2026-05-15T00:00:00.000Z",
              playtimeTracked: true,
              totalJjsMinutes: 1200,
            },
          ],
        },
      },
    },
    robloxSummary: {
      hasVerifiedAccount: true,
      totalJjsMinutes: 1980,
    },
  });

  assert.equal(state.blocks.selfProgress.title, "Практический прогресс");
  assert.match(state.blocks.selfProgress.lines.join("\n"), /Зарегистрировано: 4.?300 kills .* tier 3/);
  assert.match(state.blocks.selfProgress.lines.join("\n"), /С последнего рега: 36 ч по времени .* 13 ч JJS/);
  assert.match(state.blocks.selfProgress.lines.join("\n"), /Последнее окно роста: 4.?000 -> 4.?300 kills .* \+300 .* 5 ч JJS .* 5 д .* 60 kills\/ч/);
  assert.match(state.blocks.selfProgress.lines.join("\n"), /Сравнение окон: последний ап 60 kills\/ч .* прошлый 50 kills\/ч .* выше прошлого окна/);
  assert.match(state.blocks.selfProgress.lines.join("\n"), /Динамика: темп ускорился относительно прошлого окна/);
  assert.match(state.blocks.selfProgress.lines.join("\n"), /Средний темп за отслеженный период: 53,3 kills\/ч JJS .* 800 kills за 15 ч JJS .* 2 окна/);
  assert.match(state.blocks.selfProgress.lines.join("\n"), /До следующего tier: 2.?700 kills .* при текущем темпе/);
  assert.match(state.blocks.selfProgress.lines.join("\n"), /До milestone 20.?000: 15.?700 kills .* при текущем темпе/);
  assert.match(state.blocks.selfProgress.lines.join("\n"), /CTA: После последнего рега уже 13 ч JJS .* темп выше прошлого окна .* пора обновить kills/);
});

test("buildProfileSynergyState builds a viewer-first hero block and Main Core summary", () => {
  const state = buildProfileSynergyState({
    now: "2026-05-16T12:00:00.000Z",
    isSelf: false,
    approvedKills: 120,
    killTier: 4,
    standing: {
      rank: 2,
      totalVerified: 2,
    },
    mainCharacterLabels: ["Gojo"],
    profile: {
      accessGrantedAt: "2026-05-01T10:00:00.000Z",
      domains: {
        progress: {
          proofWindows: [
            {
              approvedKills: 120,
              reviewedAt: "2026-05-15T00:00:00.000Z",
              playtimeTracked: true,
              totalJjsMinutes: 180,
            },
          ],
        },
      },
    },
    recentKillChanges: [
      {
        from: 80,
        to: 100,
        fromAt: Date.parse("2026-04-26T00:00:00.000Z"),
        toAt: Date.parse("2026-05-01T00:00:00.000Z"),
      },
      {
        from: 100,
        to: 120,
        fromAt: Date.parse("2026-05-01T00:00:00.000Z"),
        toAt: Date.parse("2026-05-10T00:00:00.000Z"),
      },
    ],
    activitySummary: {
      appliedActivityRoleKey: "active",
      activityScore: 77,
      messages7d: 35,
      sessions7d: 8,
      activeDays7d: 4,
    },
    eloSummary: {
      currentElo: 145,
      currentTier: 2,
    },
    tierlistSummary: {
      mainName: "Gojo",
    },
    comboLinks: [
      {
        kind: "main",
        label: "Gojo",
        mainLabel: "Gojo",
        url: "https://discord.com/channels/guild-1/thread-1",
      },
      {
        kind: "general",
        label: "Общие техи",
        url: "https://discord.com/channels/guild-1/general-thread",
      },
    ],
    robloxSummary: {
      hasVerifiedAccount: true,
      currentUsername: "GojoMain",
      serverFriendsCount: 3,
      jjsMinutes7d: 180,
      topCoPlayPeers: [
        {
          peerUserId: "peer-1",
          minutesTogether: 210,
          sessionsTogether: 5,
          isRobloxFriend: true,
        },
        { sessionsTogether: 3 },
      ],
      nonFriendPeerCount: 4,
      frequentNonFriendCount: 1,
      lastSeenInJjsAt: "2026-05-11T09:00:00.000Z",
    },
  });

  assert.equal(state.blocks.viewerHero.title, "Кто ты сейчас");
  assert.match(state.blocks.viewerHero.lines.join("\n"), /Текст-тирлист: Форма B\+ .* Чат B .* Килы A .* Стабильность C- .* Развитие C- .* Соц B-/);
  assert.match(state.blocks.viewerHero.lines.join("\n"), /Сейчас это живой core-игрок .* Gojo-main .* рост ещё только собирается .* держит заметный игровой круг/);
  assert.match(state.blocks.viewerHero.lines.join("\n"), /Опора профиля: #2 по kills .* tier 4 .* ELO 145 \/ tier 2 .* Roblox GojoMain .* активность active/);
  assert.equal(state.blocks.viewerMainCore.title, "Main Core");
  assert.match(state.blocks.viewerMainCore.lines.join("\n"), /Ядро пиков: Gojo-main/);
  assert.match(state.blocks.viewerMainCore.lines.join("\n"), /Серверный контур: форма B\+ .* рост C- .* стабильность C- .* #2 по kills .* ELO 145 \/ tier 2/);
  assert.match(state.blocks.viewerMainCore.lines.join("\n"), /Игровая связка: чаще всего с <@peer-1> .* 210 мин вместе .* 5 сесс\. .* Roblox-друг/);
  assert.match(state.blocks.viewerMainCore.lines.join("\n"), /Гайд-контур: гайды 1\/1 по мейнам .* общие техи доступны/);
});

test("buildProfileSynergyState calibrates viewer grades against population baseline", () => {
  const baseOptions = {
    now: "2026-05-16T12:00:00.000Z",
    isSelf: false,
    approvedKills: 120,
    killTier: 3,
    standing: {
      rank: 3,
      totalVerified: 6,
    },
    approvedEntries: [
      { userId: "top-1", displayName: "Top 1", approvedKills: 400 },
      { userId: "top-2", displayName: "Top 2", approvedKills: 260 },
      { userId: "target", displayName: "Target", approvedKills: 120 },
      { userId: "mid-1", displayName: "Mid 1", approvedKills: 90 },
      { userId: "mid-2", displayName: "Mid 2", approvedKills: 60 },
      { userId: "low-1", displayName: "Low 1", approvedKills: 20 },
    ],
    profile: {
      domains: {
        progress: {
          proofWindows: [
            {
              approvedKills: 120,
              reviewedAt: "2026-05-15T00:00:00.000Z",
              playtimeTracked: true,
              totalJjsMinutes: 180,
            },
          ],
        },
      },
    },
    activitySummary: {
      activityScore: 52,
      messages7d: 12,
    },
    robloxSummary: {
      hasVerifiedAccount: true,
      jjsMinutes7d: 120,
      lastSeenInJjsAt: "2026-05-15T08:00:00.000Z",
      totalJjsMinutes: 180,
    },
  };

  const localGrades = extractViewerGrades(buildProfileSynergyState(baseOptions).blocks.viewerHero.lines[0]);
  const strongPopulationGrades = extractViewerGrades(buildProfileSynergyState({
    ...baseOptions,
    populationProfiles: [
      makePopulationProfile({ userId: "strong-1", approvedKills: 500, killTier: 5, activityScore: 95, messages7d: 70, jjsMinutes7d: 480, totalJjsMinutes: 900 }),
      makePopulationProfile({ userId: "strong-2", approvedKills: 420, killTier: 5, activityScore: 91, messages7d: 64, jjsMinutes7d: 420, totalJjsMinutes: 840 }),
      makePopulationProfile({ userId: "strong-3", approvedKills: 360, killTier: 4, activityScore: 88, messages7d: 58, jjsMinutes7d: 360, totalJjsMinutes: 780 }),
      makePopulationProfile({ userId: "strong-4", approvedKills: 300, killTier: 4, activityScore: 82, messages7d: 48, jjsMinutes7d: 300, totalJjsMinutes: 720 }),
      makePopulationProfile({ userId: "strong-5", approvedKills: 250, killTier: 4, activityScore: 76, messages7d: 40, jjsMinutes7d: 240, totalJjsMinutes: 660 }),
    ],
  }).blocks.viewerHero.lines[0]);
  const weakPopulationGrades = extractViewerGrades(buildProfileSynergyState({
    ...baseOptions,
    populationProfiles: [
      makePopulationProfile({ userId: "weak-1", approvedKills: 15, killTier: 1, activityScore: 8, messages7d: 2, jjsMinutes7d: 12, totalJjsMinutes: 20, reviewedAt: "2026-04-01T00:00:00.000Z" }),
      makePopulationProfile({ userId: "weak-2", approvedKills: 20, killTier: 1, activityScore: 12, messages7d: 3, jjsMinutes7d: 18, totalJjsMinutes: 30, reviewedAt: "2026-04-05T00:00:00.000Z" }),
      makePopulationProfile({ userId: "weak-3", approvedKills: 25, killTier: 1, activityScore: 16, messages7d: 4, jjsMinutes7d: 24, totalJjsMinutes: 40, reviewedAt: "2026-04-08T00:00:00.000Z" }),
      makePopulationProfile({ userId: "weak-4", approvedKills: 30, killTier: 1, activityScore: 20, messages7d: 5, jjsMinutes7d: 30, totalJjsMinutes: 50, reviewedAt: "2026-04-10T00:00:00.000Z" }),
      makePopulationProfile({ userId: "weak-5", approvedKills: 40, killTier: 1, activityScore: 24, messages7d: 6, jjsMinutes7d: 36, totalJjsMinutes: 60, reviewedAt: "2026-04-12T00:00:00.000Z" }),
    ],
  }).blocks.viewerHero.lines[0]);

  assert.ok(GRADE_RANK[strongPopulationGrades.form] < GRADE_RANK[localGrades.form]);
  assert.ok(GRADE_RANK[weakPopulationGrades.form] > GRADE_RANK[localGrades.form]);
});

test("buildProfileSynergyState exposes social suggestions from canonical cache without overclaiming coop", () => {
  const state = buildProfileSynergyState({
    now: "2026-05-16T12:00:00.000Z",
    isSelf: true,
    profile: {
      domains: {
        social: {
          suggestions: [
            {
              peerUserId: "peer-1",
              peerDisplayName: "Gojo",
              peerRobloxUsername: "GojoRb",
              peerHasVerifiedRoblox: true,
              minutesTogether: 80,
              sessionsTogether: 1,
              sharedJjsSessionCount: 1,
              sourceComputedAt: "2026-05-16T09:00:00.000Z",
            },
            {
              peerUserId: "peer-4",
              peerDisplayName: "junpei",
              peerHasVerifiedRoblox: false,
              minutesTogether: 40,
              sessionsTogether: 3,
              sharedJjsSessionCount: 3,
              sourceComputedAt: "2026-05-16T09:00:00.000Z",
            },
          ],
        },
      },
    },
    robloxSummary: {
      serverFriendsCount: 2,
    },
  });

  assert.equal(state.blocks.socialSuggestions.title, "Скрытый круг");
  assert.match(state.blocks.socialSuggestions.lines.join("\n"), /Скрытый круг: 2 кандидата .* Roblox-друзей на сервере: 2 .* не точный кооп/);
  assert.match(state.blocks.socialSuggestions.lines.join("\n"), /1\. <@peer-1> .* Gojo .* Roblox GojoRb .* 80 мин вместе .* 1 общ\. сесс\. .* verified Roblox/);
  assert.match(state.blocks.socialSuggestions.lines.join("\n"), /2\. <@peer-4> .* junpei .* 40 мин вместе .* 3 общ\. сесс\./);
  assert.match(state.blocks.socialSuggestions.lines.join("\n"), /Social-срез: обновлялся ~3 ч назад/);
});