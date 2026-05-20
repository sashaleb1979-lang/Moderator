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

function shiftIsoDayKey(dayKey = "", offsetDays = 0) {
  const timestamp = Date.parse(`${dayKey}T12:00:00.000Z`);
  return new Date(timestamp + offsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function buildSeasonArchiveSnapshots({ startDayKey = "2026-04-01", dayCount = 12, peak7Index = null, peak30Index = null } = {}) {
  const normalizedPeak7Index = Number.isInteger(peak7Index) ? peak7Index : Math.max(0, dayCount - 1);
  const normalizedPeak30Index = Number.isInteger(peak30Index) ? peak30Index : Math.max(0, dayCount - 1);

  return Array.from({ length: dayCount }, (_entry, index) => {
    const dayKey = shiftIsoDayKey(startDayKey, index);
    return {
      dayKey,
      capturedAt: `${dayKey}T12:00:00.000Z`,
      approvedKills: 3200 + index * 50,
      killTier: 3,
      mainCharacterLabels: ["Gojo"],
      tierlistMainName: "Gojo",
      activityScore: 50 + index,
      jjsMinutes7d: index === normalizedPeak7Index ? 900 : 180 + index * 20,
      jjsMinutes30d: index === normalizedPeak30Index ? 2400 : 600 + index * 25,
      voiceDurationSeconds7d: index === normalizedPeak7Index ? 5400 : index * 300,
      voiceDurationSeconds30d: index === normalizedPeak30Index ? 18000 : index * 600,
      topCoPlayPeerUserIds: Array.from({ length: Math.min(3, Math.floor(index / 4) + 1) }, (_peer, peerIndex) => `peer-${peerIndex + 1}`),
      socialSuggestionCount: Math.min(4, Math.floor(index / 3)),
      serverFriendsCount: 2,
    };
  });
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

test("buildProgressSynergyState does not overclaim reliable JJS delta for verified-but-repairable Roblox", () => {
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
      isTrackable: false,
      trackingState: "repairable",
      totalJjsMinutes: 900,
    },
  });

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
        kind: "wiki",
        label: "Gojo",
        mainLabel: "Gojo",
        url: "https://jujutsu-shenanigans.fandom.com/wiki/Gojo",
      },
      {
        kind: "general",
        label: "Общие техи",
        url: "https://discord.com/channels/guild-1/general-thread",
      },
    ],
    robloxSummary: {
      hasVerifiedAccount: true,
      isTrackable: true,
      trackingState: "trackable",
      userId: "123",
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
  assert.match(state.blocks.viewerMainCore.lines.join("\n"), /Гайд-контур: гайды 1\/1 по мейнам .* wiki 1\/1 по мейнам .* общие техи доступны/);
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

test("buildProfileSynergyState derives friend overlap from server friend ids and population profiles", () => {
  const state = buildProfileSynergyState({
    now: "2026-05-16T12:00:00.000Z",
    robloxSummary: {
      serverFriendsCount: 3,
      serverFriendsUserIds: ["rbx-1", "rbx-2", "rbx-3"],
      serverFriendsComputedAt: "2026-05-16T08:00:00.000Z",
    },
    populationProfiles: [
      {
        userId: "friend-1",
        profile: {
          summary: {
            preferredDisplayName: "Gojo",
            activity: {
              appliedActivityRoleKey: "active",
              messages7d: 12,
            },
            roblox: {
              userId: "rbx-1",
              currentUsername: "GojoRb",
              hasVerifiedAccount: true,
              jjsMinutes7d: 150,
            },
          },
        },
      },
      {
        userId: "friend-2",
        profile: {
          summary: {
            preferredDisplayName: "Megumi",
            activity: {
              messages7d: 0,
              sessions7d: 0,
            },
            roblox: {
              userId: "rbx-2",
              currentUsername: "MegumiRb",
              hasVerifiedAccount: true,
              jjsMinutes7d: 0,
            },
          },
        },
      },
      {
        userId: "outsider",
        profile: {
          summary: {
            preferredDisplayName: "Out",
            roblox: {
              userId: "rbx-9",
              currentUsername: "OutRb",
              hasVerifiedAccount: true,
              jjsMinutes7d: 320,
            },
          },
        },
      },
    ],
  });

  assert.equal(state.blocks.friendOverlap.title, "Roblox-друзья на сервере");
  assert.match(state.blocks.friendOverlap.lines.join("\n"), /Roblox-друзей на сервере: 3 .* видимых профилей: 2 .* verified: 2 .* активны 7д: 1 .* играли в JJS 7д: 1/);
  assert.match(state.blocks.friendOverlap.lines.join("\n"), /Список друзей обновлялся ~4 ч назад/);
  assert.equal(state.blocks.friendsAlreadyHere.title, "Кто из друзей уже здесь");
  assert.match(state.blocks.friendsAlreadyHere.lines.join("\n"), /1\. <@friend-1> .* Gojo .* Roblox GojoRb .* verified Roblox .* JJS 7д 150 мин .* activity active/);
  assert.match(state.blocks.friendsAlreadyHere.lines.join("\n"), /2\. <@friend-2> .* Megumi .* Roblox MegumiRb .* verified Roblox/);
});

test("buildProfileSynergyState exposes voice summary from canonical mirror", () => {
  const state = buildProfileSynergyState({
    now: "2026-05-16T12:00:00.000Z",
    voiceSummary: {
      lifetimeSessionCount: 2,
      sessionCount7d: 1,
      sessionCount30d: 2,
      incompleteSessionCount30d: 1,
      voiceDurationSeconds7d: 5400,
      voiceDurationSeconds30d: 9000,
      lastVoiceSeenAt: "2026-05-16T10:30:00.000Z",
      lastCapturedAt: "2026-05-16T10:30:00.000Z",
      isInVoiceNow: true,
      currentChannelId: "voice-lounge",
      currentSessionStartedAt: "2026-05-16T11:10:00.000Z",
      topChannels: [
        { channelId: "voice-main", sessionCount: 2 },
        { channelId: "voice-lounge", sessionCount: 1 },
        { channelId: "voice-side", sessionCount: 1 },
      ],
    },
  });

  assert.equal(state.blocks.voiceSummary.title, "Voice-срез");
  assert.match(state.blocks.voiceSummary.lines.join("\n"), /Voice 7д\/30д: 1,5 ч \/ 2,5 ч .* сессии 7д\/30д: 1 \/ 2 .* lifetime сессии: 2 .* неполных 30д: 1/);
  assert.match(state.blocks.voiceSummary.lines.join("\n"), /Сейчас в voice: <#voice-lounge> .* 16\.05\.2026/);
  assert.match(state.blocks.voiceSummary.lines.join("\n"), /Топ voice-каналы: <#voice-main> \(2\), <#voice-lounge> \(1\), <#voice-side> \(1\)/);
  assert.match(state.blocks.voiceSummary.lines.join("\n"), /Voice-срез обновлялся ~1,5 ч назад/);
});

test("buildProfileSynergyState derives prime time from hourly MSK buckets", () => {
  const state = buildProfileSynergyState({
    now: "2026-05-16T12:00:00.000Z",
    profile: {
      domains: {
        roblox: {
          playtime: {
            hourlyBucketsMsk: {
              "2026-05-14T19": 20,
              "2026-05-14T20": 50,
              "2026-05-14T21": 35,
              "2026-05-15T19": 40,
              "2026-05-15T20": 70,
              "2026-05-15T21": 60,
              "2026-05-15T22": 30,
              "2026-05-16T09": 10,
            },
          },
        },
      },
    },
  });

  assert.equal(state.blocks.primeTime.title, "Prime time МСК");
  assert.match(state.blocks.primeTime.lines.join("\n"), /Чаще всего играет с 19:00 до 23:00 МСК .* окно 305 мин/);
  assert.match(state.blocks.primeTime.lines.join("\n"), /Пиковый час: 20:00 .* активных часов: 5 .* tracked минут в bucket-слое: 315/);
  assert.match(state.blocks.primeTime.lines.join("\n"), /Hourly-срез обновлялся ~6 ч назад/);
});

test("buildProfileSynergyState derives personal war readiness from existing profile signals", () => {
  const state = buildProfileSynergyState({
    now: "2026-05-16T12:00:00.000Z",
    profile: {
      domains: {
        progress: {
          proofWindows: [
            {
              approvedKills: 120,
              reviewedAt: "2026-05-15T00:00:00.000Z",
              playtimeTracked: true,
              totalJjsMinutes: 120,
            },
          ],
        },
        roblox: {
          playtime: {
            hourlyBucketsMsk: {
              "2026-05-14T19": 20,
              "2026-05-14T20": 50,
              "2026-05-14T21": 35,
              "2026-05-15T19": 40,
              "2026-05-15T20": 70,
              "2026-05-15T21": 60,
              "2026-05-15T22": 30,
              "2026-05-16T09": 10,
            },
          },
        },
      },
    },
    robloxSummary: {
      hasVerifiedAccount: true,
      totalJjsMinutes: 300,
      jjsMinutes7d: 180,
    },
    activitySummary: {
      lastSeenAt: "2026-05-10T12:00:00.000Z",
    },
  });

  assert.equal(state.blocks.personalWarReadiness.title, "War Readiness");
  assert.match(state.blocks.personalWarReadiness.lines.join("\n"), /Готовность к вару: высокая/);
  assert.match(state.blocks.personalWarReadiness.lines.join("\n"), /Roblox 7д: 3 ч .* Discord last seen: ~6 д .* proof freshness: ~36 ч назад/);
  assert.match(state.blocks.personalWarReadiness.lines.join("\n"), /Prime time: 19:00-23:00 МСК/);
});

test("buildProfileSynergyState summarizes best periods from season archive snapshots", () => {
  const state = buildProfileSynergyState({
    profile: {
      domains: {
        seasonArchive: {
          snapshots: buildSeasonArchiveSnapshots({
            startDayKey: "2026-04-01",
            dayCount: 35,
            peak7Index: 20,
            peak30Index: 32,
          }),
        },
      },
    },
  });

  assert.equal(state.blocks.bestPeriods.title, "Лучшие периоды");
  assert.match(state.blocks.bestPeriods.lines.join("\n"), /Архив сезона: 35 дневных срезов .* 01\.04\.2026-05\.05\.2026/);
  assert.match(state.blocks.bestPeriods.lines.join("\n"), /Пик 7д: 15\.04\.2026-21\.04\.2026 .* 15 ч JJS .* activity 70 .* voice 1,5 ч .* 3 частых напарн\./);
  assert.match(state.blocks.bestPeriods.lines.join("\n"), /Контур 7д-пика: 4.?200 kills .* tier 3 .* мейн Gojo .* Roblox-друзей 2 .* кандидатов 4/);
  assert.match(state.blocks.bestPeriods.lines.join("\n"), /Пик 30д: 04\.04\.2026-03\.05\.2026 .* 40 ч JJS .* activity 82 .* voice 5 ч .* 3 частых напарн\./);
});

test("buildProfileSynergyState keeps best-periods copy honest while 30-day history is still short", () => {
  const state = buildProfileSynergyState({
    profile: {
      domains: {
        seasonArchive: {
          snapshots: buildSeasonArchiveSnapshots({
            startDayKey: "2026-05-01",
            dayCount: 12,
            peak7Index: 11,
            peak30Index: 11,
          }),
        },
      },
    },
  });

  assert.equal(state.blocks.bestPeriods.title, "Лучшие периоды");
  assert.match(state.blocks.bestPeriods.lines.join("\n"), /Пик 7д: 06\.05\.2026-12\.05\.2026 .* 15 ч JJS .* activity 61 .* voice 1,5 ч/);
  assert.match(state.blocks.bestPeriods.lines.join("\n"), /Пик 30д: данные сезона ещё копятся \(12\/30 дневных срезов\)\./);
});

test("buildProfileSynergyState summarizes social evolution from season archive snapshots without overstating the graph", () => {
  const state = buildProfileSynergyState({
    profile: {
      domains: {
        seasonArchive: {
          snapshots: [
            {
              dayKey: "2026-05-01",
              capturedAt: "2026-05-01T12:00:00.000Z",
              topCoPlayPeerUserIds: ["peer-1"],
              serverFriendsCount: 1,
              socialSuggestionCount: 0,
            },
            {
              dayKey: "2026-05-03",
              capturedAt: "2026-05-03T12:00:00.000Z",
              topCoPlayPeerUserIds: ["peer-1", "peer-2"],
              serverFriendsCount: 1,
              socialSuggestionCount: 1,
            },
            {
              dayKey: "2026-05-05",
              capturedAt: "2026-05-05T12:00:00.000Z",
              topCoPlayPeerUserIds: ["peer-1", "peer-2", "peer-3"],
              serverFriendsCount: 2,
              socialSuggestionCount: 2,
            },
            {
              dayKey: "2026-05-06",
              capturedAt: "2026-05-06T12:00:00.000Z",
              topCoPlayPeerUserIds: ["peer-1", "peer-2", "peer-3"],
              serverFriendsCount: 2,
              socialSuggestionCount: 2,
            },
            {
              dayKey: "2026-05-07",
              capturedAt: "2026-05-07T12:00:00.000Z",
              topCoPlayPeerUserIds: ["peer-1", "peer-2", "peer-4"],
              serverFriendsCount: 2,
              socialSuggestionCount: 3,
            },
            {
              dayKey: "2026-05-08",
              capturedAt: "2026-05-08T12:00:00.000Z",
              topCoPlayPeerUserIds: ["peer-1", "peer-2", "peer-4"],
              serverFriendsCount: 3,
              socialSuggestionCount: 3,
            },
            {
              dayKey: "2026-05-09",
              capturedAt: "2026-05-09T12:00:00.000Z",
              topCoPlayPeerUserIds: ["peer-1", "peer-2", "peer-4"],
              serverFriendsCount: 3,
              socialSuggestionCount: 3,
            },
          ],
        },
      },
    },
  });

  assert.equal(state.blocks.socialEvolution.title, "Социальная эволюция");
  assert.match(state.blocks.socialEvolution.lines.join("\n"), /Соц-архив: 7 дневных срезов .* 01\.05\.2026-09\.05\.2026/);
  assert.match(state.blocks.socialEvolution.lines.join("\n"), /Игровой круг: 1 -> 3 частых напарн\. \(\+2\) .* Roblox-друзей: 1 -> 3 \(\+2\) .* скрытый круг: 0 -> 3 \(\+3\)/);
  assert.match(state.blocks.socialEvolution.lines.join("\n"), /Смена ядра: удержались 1 .* новых 2 .* выпало 0 .* top peer archive/);
  assert.match(state.blocks.socialEvolution.lines.join("\n"), /Пик круга: 09\.05\.2026 .* 3 частых напарн\. .* Roblox-друзей 3 .* кандидатов 3/);
});

test("buildProfileSynergyState keeps social evolution gated while archive history is still short", () => {
  const state = buildProfileSynergyState({
    profile: {
      domains: {
        seasonArchive: {
          snapshots: [
            {
              dayKey: "2026-05-01",
              capturedAt: "2026-05-01T12:00:00.000Z",
              topCoPlayPeerUserIds: ["peer-1"],
              serverFriendsCount: 1,
              socialSuggestionCount: 0,
            },
            {
              dayKey: "2026-05-02",
              capturedAt: "2026-05-02T12:00:00.000Z",
              topCoPlayPeerUserIds: ["peer-1", "peer-2"],
              serverFriendsCount: 1,
              socialSuggestionCount: 1,
            },
            {
              dayKey: "2026-05-03",
              capturedAt: "2026-05-03T12:00:00.000Z",
              topCoPlayPeerUserIds: ["peer-1", "peer-2"],
              serverFriendsCount: 2,
              socialSuggestionCount: 1,
            },
          ],
        },
      },
    },
  });

  assert.equal(state.blocks.socialEvolution.title, "Социальная эволюция");
  assert.match(state.blocks.socialEvolution.lines.join("\n"), /Социальная эволюция: история ещё короткая \(3\/7 дневных срезов\)\./);
});

test("buildProfileSynergyState derives a season story narrative from season archive snapshots", () => {
  const state = buildProfileSynergyState({
    profile: {
      domains: {
        seasonArchive: {
          snapshots: buildSeasonArchiveSnapshots({
            startDayKey: "2026-05-01",
            dayCount: 12,
            peak7Index: 11,
            peak30Index: 11,
          }),
        },
      },
    },
  });

  assert.equal(state.blocks.seasonStory.title, "История сезона");
  assert.match(state.blocks.seasonStory.lines.join("\n"), /Архив сезона: 12 дневных срезов .* 01\.05\.2026-12\.05\.2026/);
  assert.match(state.blocks.seasonStory.lines.join("\n"), /Траектория: 3.?200 -> 3.?750 kills \(\+550\) .* activity 50 -> 61 \(\+11\) .* 1 -> 3 частых напарн\./);
  assert.match(state.blocks.seasonStory.lines.join("\n"), /Нарратив: сезон разогнался: kills, activity и игровой круг выросли вместе\./);
  assert.match(state.blocks.seasonStory.lines.join("\n"), /Фокус сезона: Gojo удержался главным опорным персонажем\./);
  assert.match(state.blocks.seasonStory.lines.join("\n"), /Сильнейший срез: 12\.05\.2026 .* 15 ч JJS за rolling 7д .* activity 61 .* voice 1,5 ч .* 3 частых напарн\./);
});

test("buildProfileSynergyState keeps season story gated while archive history is still short", () => {
  const state = buildProfileSynergyState({
    profile: {
      domains: {
        seasonArchive: {
          snapshots: buildSeasonArchiveSnapshots({
            startDayKey: "2026-05-01",
            dayCount: 3,
            peak7Index: 2,
            peak30Index: 2,
          }),
        },
      },
    },
  });

  assert.equal(state.blocks.seasonStory.title, "История сезона");
  assert.match(state.blocks.seasonStory.lines.join("\n"), /История сезона: данные ещё копятся \(3\/7 дневных срезов\)\./);
});