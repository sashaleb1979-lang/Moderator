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

function makeAntiteamSupportPopulationProfile(userId, {
  responded = 0,
  linkGranted = 0,
  confirmedArrived = 0,
  lastHelpedAt = null,
} = {}) {
  return {
    userId,
    profile: {
      summary: {
        support: {
          antiteam: {
            sourceAvailable: true,
            responded,
            linkGranted,
            confirmedArrived,
            lastHelpedAt,
            source: "sot.antiteam.stats.helpers",
          },
        },
      },
    },
  };
}

function makeRelativeComponentPopulationProfile(userId, {
  messages30d = 0,
  sessions30d = 0,
  voiceHours30d = 0,
  activeVoiceShare = 0,
  voiceSessions30d = 0,
  jjsHours30d = 0,
  jjsSessionCount = 0,
  fromKills = 1000,
  toKills = 1000,
  fromDay = "2026-05-01",
  toDay = "2026-05-06",
  antiteamPoints = 0,
} = {}) {
  const effectiveVoiceHours30d = Math.max(0, Number(voiceHours30d) || 0);
  const effectiveActiveVoiceSignalHours30d = effectiveVoiceHours30d * Math.max(0, Number(activeVoiceShare) || 0) / 100;
  return {
    userId,
    profile: {
      approvedKills: toKills,
      summary: {
        activity: {
          messages30d,
          sessions30d,
          effectiveVoiceHours30d,
          effectiveActiveVoiceSignalHours30d,
        },
        roblox: {
          hasVerifiedAccount: true,
          jjsMinutes30d: jjsHours30d * 60,
          sessionCount: jjsSessionCount,
          totalJjsMinutes: jjsHours30d * 60,
        },
        voice: {
          voiceDurationSeconds30d: voiceHours30d * 3600,
          sessionCount30d: voiceSessions30d,
        },
        support: {
          antiteam: {
            sourceAvailable: true,
            confirmedArrived: antiteamPoints,
            responded: antiteamPoints,
            linkGranted: Math.floor(antiteamPoints / 2),
            source: "sot.antiteam.stats.helpers",
          },
        },
      },
      domains: {
        progress: {
          proofWindows: [
            {
              approvedKills: fromKills,
              reviewedAt: `${fromDay}T00:00:00.000Z`,
              playtimeTracked: true,
              totalJjsMinutes: 0,
            },
            {
              approvedKills: toKills,
              reviewedAt: `${toDay}T00:00:00.000Z`,
              playtimeTracked: true,
              totalJjsMinutes: Math.max(1, jjsHours30d) * 60,
            },
          ],
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

function makeWeeklyRollup(weekKey, {
  startDayKey = "2026-05-04",
  score = 50,
  grade = "C",
  coveragePercent = 100,
  jjsMinutes = 0,
  messages = 0,
  sessions = 0,
  voiceSeconds = 0,
  approvedKillsDelta = 0,
  antiteamPointsDelta = 0,
} = {}) {
  const coveredDays = Math.round((coveragePercent / 100) * 7);
  return {
    weekKey,
    startDayKey,
    endDayKey: shiftIsoDayKey(startDayKey, 6),
    coverage: {
      expectedDays: 7,
      coveredDays,
      missingDays: Math.max(0, 7 - coveredDays),
      coveragePercent,
    },
    totals: {
      jjsMinutes,
      messages,
      sessions,
      voiceSeconds,
      approvedKillsDelta,
      antiteamPointsDelta,
    },
    composite: {
      score,
      grade,
      confidenceState: coveragePercent >= 85 ? "reliable" : "partial",
      influenceDebuffPercent: coveragePercent >= 85 ? 0 : 15,
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
  assert.equal(state.proofGap.freshnessState, "partial");
  assert.equal(state.proofGap.influenceDebuffPercent, 5);
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

test("buildProfileSynergyState does not fabricate zero kills when only proof history remains", () => {
  const state = buildProfileSynergyState({
    now: "2026-05-16T12:00:00.000Z",
    isSelf: true,
    approvedKills: null,
    killTier: null,
    profile: {
      domains: {
        progress: {
          proofWindows: [
            {
              approvedKills: 120,
              killTier: 4,
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

  const progressText = state.blocks.selfProgress.lines.join("\n");

  assert.match(progressText, /Зарегистрированные kills пока не подтверждены\./);
  assert.match(progressText, /С последнего рега: 36 ч по времени .* 13 ч JJS/);
  assert.doesNotMatch(progressText, /Зарегистрировано: 0 kills/);
  assert.doesNotMatch(progressText, /До следующего tier|До milestone/);
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
  const weakPopulationState = buildProfileSynergyState({
    ...baseOptions,
    populationProfiles: [
      makePopulationProfile({ userId: "weak-1", approvedKills: 15, killTier: 1, activityScore: 8, messages7d: 2, jjsMinutes7d: 12, totalJjsMinutes: 20, reviewedAt: "2026-04-01T00:00:00.000Z" }),
      makePopulationProfile({ userId: "weak-2", approvedKills: 20, killTier: 1, activityScore: 12, messages7d: 3, jjsMinutes7d: 18, totalJjsMinutes: 30, reviewedAt: "2026-04-05T00:00:00.000Z" }),
      makePopulationProfile({ userId: "weak-3", approvedKills: 25, killTier: 1, activityScore: 16, messages7d: 4, jjsMinutes7d: 24, totalJjsMinutes: 40, reviewedAt: "2026-04-08T00:00:00.000Z" }),
      makePopulationProfile({ userId: "weak-4", approvedKills: 30, killTier: 1, activityScore: 20, messages7d: 5, jjsMinutes7d: 30, totalJjsMinutes: 50, reviewedAt: "2026-04-10T00:00:00.000Z" }),
      makePopulationProfile({ userId: "weak-5", approvedKills: 40, killTier: 1, activityScore: 24, messages7d: 6, jjsMinutes7d: 36, totalJjsMinutes: 60, reviewedAt: "2026-04-12T00:00:00.000Z" }),
    ],
  });
  const weakPopulationGrades = extractViewerGrades(weakPopulationState.blocks.viewerHero.lines[0]);

  assert.ok(GRADE_RANK[strongPopulationGrades.form] < GRADE_RANK[localGrades.form]);
  assert.ok(GRADE_RANK[weakPopulationGrades.form] > GRADE_RANK[localGrades.form]);
  assert.equal(weakPopulationState.blocks.viewerLetterPlaces.title, "Буквы и места");
  assert.match(weakPopulationState.blocks.viewerLetterPlaces.lines.join("\n"), /Форма S\+ \(#1\/5\).* Чат S\+ \(#1\/5\).* Килы S\+ \(#1\/5\)/);
  assert.match(weakPopulationState.blocks.viewerLetterPlaces.lines.join("\n"), /Надёжность букв: reliable 3\/6 .* partial 3 .* baseline min 5 .* max debuff 15%/);
});

test("buildProfileSynergyState exposes antiteam support points and population place", () => {
  const state = buildProfileSynergyState({
    now: "2026-05-16T12:00:00.000Z",
    isSelf: false,
    supportSummary: {
      antiteam: {
        sourceAvailable: true,
        responded: 4,
        linkGranted: 2,
        confirmedArrived: 3,
        lastHelpedAt: "2026-05-16T10:30:00.000Z",
        source: "sot.antiteam.stats.helpers",
      },
    },
    populationProfiles: [
      makeAntiteamSupportPopulationProfile("support-1", { responded: 5, linkGranted: 4, confirmedArrived: 4 }),
      makeAntiteamSupportPopulationProfile("support-2", { responded: 4, linkGranted: 2, confirmedArrived: 3 }),
      makeAntiteamSupportPopulationProfile("support-3", { responded: 3, linkGranted: 2, confirmedArrived: 2 }),
      makeAntiteamSupportPopulationProfile("support-4", { responded: 2, linkGranted: 1, confirmedArrived: 1 }),
      makeAntiteamSupportPopulationProfile("support-5", { responded: 1, linkGranted: 0, confirmedArrived: 0 }),
    ],
  });

  assert.equal(state.blocks.antiteamSupport.title, "Antiteam support");
  assert.match(state.blocks.antiteamSupport.lines.join("\n"), /Support points: confirmed arrivals 3 .* responded 4 .* link grants 2/);
  assert.match(state.blocks.antiteamSupport.lines.join("\n"), /Место по antiteam support: #2\/5/);
  assert.match(state.blocks.antiteamSupport.lines.join("\n"), /confidence reliable .* debuff 0% .* source sot\.antiteam\.stats\.helpers/);
  assert.match(state.blocks.antiteamSupport.lines.join("\n"), /last help/);
});

test("buildProfileSynergyState surfaces proof gap and applies kill-backed debuff to letters", () => {
  const state = buildProfileSynergyState({
    now: "2026-05-16T12:00:00.000Z",
    isSelf: false,
    approvedKills: 4300,
    killTier: 3,
    profile: {
      approvedKills: 4300,
      killTier: 3,
      domains: {
        progress: {
          proofWindows: [
            {
              approvedKills: 4300,
              reviewedAt: "2026-05-01T12:00:00.000Z",
              playtimeTracked: true,
              totalJjsMinutes: 100,
            },
          ],
        },
      },
    },
    robloxSummary: {
      hasVerifiedAccount: true,
      isTrackable: true,
      trackingState: "trackable",
      totalJjsMinutes: 4300,
      jjsMinutes7d: 600,
    },
    populationProfiles: [
      makePopulationProfile({ userId: "peer-1", approvedKills: 5000, killTier: 4, activityScore: 60, messages7d: 20, jjsMinutes7d: 500, totalJjsMinutes: 5000 }),
      makePopulationProfile({ userId: "peer-2", approvedKills: 4200, killTier: 3, activityScore: 55, messages7d: 18, jjsMinutes7d: 420, totalJjsMinutes: 4200 }),
      makePopulationProfile({ userId: "peer-3", approvedKills: 3500, killTier: 3, activityScore: 50, messages7d: 16, jjsMinutes7d: 360, totalJjsMinutes: 3600 }),
      makePopulationProfile({ userId: "peer-4", approvedKills: 2500, killTier: 2, activityScore: 40, messages7d: 12, jjsMinutes7d: 240, totalJjsMinutes: 2500 }),
      makePopulationProfile({ userId: "peer-5", approvedKills: 1000, killTier: 2, activityScore: 30, messages7d: 8, jjsMinutes7d: 120, totalJjsMinutes: 1000 }),
    ],
  });

  assert.equal(state.progress.proofGap.freshnessState, "outdated");
  assert.equal(state.progress.proofGap.influenceDebuffPercent, 90);
  assert.match(state.blocks.proofGap.lines.join("\n"), /JJS после proof: 70 ч .* proof сильно отстал от игры/);
  assert.match(state.blocks.proofGap.lines.join("\n"), /Trust: outdated .* kill-backed debuff 90%/);
  assert.match(state.blocks.viewerLetterPlaces.lines.join("\n"), /max debuff 90%/);
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

test("buildProfileSynergyState builds verified circle and social map without exact party claims", () => {
  const state = buildProfileSynergyState({
    now: "2026-05-16T12:00:00.000Z",
    profile: {
      domains: {
        social: {
          suggestions: [
            {
              peerUserId: "peer-3",
              peerDisplayName: "Inferred",
              peerRobloxUsername: "InferredRb",
              minutesTogether: 45,
              sessionsTogether: 2,
              sharedJjsSessionCount: 2,
              sourceComputedAt: "2026-05-16T10:00:00.000Z",
            },
          ],
        },
      },
    },
    robloxSummary: {
      serverFriendsCount: 2,
      serverFriendsUserIds: ["rbx-1", "rbx-2"],
      serverFriendsComputedAt: "2026-05-16T08:00:00.000Z",
      topCoPlayPeers: [
        {
          peerUserId: "friend-1",
          minutesTogether: 210,
          sessionsTogether: 5,
          sharedJjsSessionCount: 5,
          isRobloxFriend: true,
          lastSeenTogetherAt: "2026-05-16T09:00:00.000Z",
        },
        {
          peerUserId: "peer-2",
          minutesTogether: 140,
          sessionsTogether: 3,
          sharedJjsSessionCount: 3,
          isRobloxFriend: false,
          isFrequentNonFriend: true,
          lastSeenTogetherAt: "2026-05-16T09:30:00.000Z",
        },
      ],
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
    ],
  });

  assert.equal(state.blocks.verifiedCircle.title, "Проверенный круг");
  assert.match(state.blocks.verifiedCircle.lines.join("\n"), /Проверенный круг: verified\+friend\+JJS 1 .* verified friends 1 .* active 7д 1 .* JJS 7д 1/);
  assert.match(state.blocks.verifiedCircle.lines.join("\n"), /<@friend-1> .* Gojo .* Roblox GojoRb .* verified Roblox .* Roblox-друг .* 210 мин вместе .* 5 общ\. сесс\. .* JJS 7д 150 мин/);
  assert.match(state.blocks.verifiedCircle.lines.join("\n"), /Trust: reliable .* no exact party claim/);
  assert.equal(state.blocks.socialMap.title, "Социальная карта");
  assert.match(state.blocks.socialMap.lines.join("\n"), /Социальная карта: strong 1 .* medium 1 .* friends here 1 .* inferred 1/);
  assert.match(state.blocks.socialMap.lines.join("\n"), /Strong ties: <@friend-1> .* verified Roblox .* Roblox-друг/);
  assert.match(state.blocks.socialMap.lines.join("\n"), /Medium ties: <@peer-2> .* частый non-friend .* 140 мин вместе .* 3 общ\. сесс\./);
  assert.match(state.blocks.socialMap.lines.join("\n"), /Inferred ties: <@peer-3> .* Inferred .* Roblox InferredRb .* inferred .* 45 мин вместе .* 2 общ\. сесс\./);
  assert.match(state.blocks.socialMap.lines.join("\n"), /sources Roblox friends\/co-play\/social suggestions .* no exact party claim/);
});

test("buildProfileSynergyState gates voice plus game overlap until voice contact source exists", () => {
  const state = buildProfileSynergyState({
    now: "2026-05-16T12:00:00.000Z",
    robloxSummary: {
      topCoPlayPeers: [
        {
          peerUserId: "peer-1",
          minutesTogether: 90,
          sessionsTogether: 2,
          sharedJjsSessionCount: 2,
          lastSeenTogetherAt: "2026-05-16T09:00:00.000Z",
        },
      ],
    },
    voiceSummary: {
      voiceDurationSeconds30d: 3600,
      sessionCount30d: 1,
      lastCapturedAt: "2026-05-16T10:00:00.000Z",
    },
  });

  assert.equal(state.blocks.voiceGameOverlap.title, "Voice + game overlap");
  assert.match(state.blocks.voiceGameOverlap.lines.join("\n"), /Voice \+ JJS overlap: ждёт voice contact source .* JJS overlap есть .* voice summary есть/);
  assert.match(state.blocks.voiceGameOverlap.lines.join("\n"), /source gap: profile\.domains\.voice\.contacts\[\]/);
});

test("buildProfileSynergyState uses mirrored voice contacts for voice plus game overlap", () => {
  const state = buildProfileSynergyState({
    now: "2026-05-16T12:00:00.000Z",
    profile: {
      domains: {
        voice: {
          contacts: [
            {
              peerUserId: "peer-1",
              peerDisplayName: "Todo",
              secondsTogether: 7200,
              sessionCount: 2,
              sourceComputedAt: "2026-05-16T09:00:00.000Z",
            },
            {
              peerUserId: "voice-only",
              peerDisplayName: "Voice Only",
              secondsTogether: 3600,
              sessionCount: 1,
              sourceComputedAt: "2026-05-16T09:00:00.000Z",
            },
          ],
        },
      },
    },
    robloxSummary: {
      topCoPlayPeers: [
        {
          peerUserId: "peer-1",
          minutesTogether: 90,
          sessionsTogether: 2,
          sharedJjsSessionCount: 2,
          lastSeenTogetherAt: "2026-05-16T08:00:00.000Z",
        },
      ],
    },
  });

  assert.equal(state.blocks.voiceGameOverlap.title, "Voice + game overlap");
  assert.match(state.blocks.voiceGameOverlap.lines.join("\n"), /Voice \+ JJS overlap: 1 совпадений .* voice contacts 2 .* JJS peers 1/);
  assert.match(state.blocks.voiceGameOverlap.lines.join("\n"), /<@peer-1> .* Todo .* voice 2 ч .* 2 voice сесс\. .* JJS 90 мин .* 2 JJS сесс\./);
  assert.match(state.blocks.voiceGameOverlap.lines.join("\n"), /Trust: reliable .* no exact party claim/);
});

test("buildProfileSynergyState exposes voice summary from canonical mirror", () => {
  const state = buildProfileSynergyState({
    now: "2026-05-16T12:00:00.000Z",
    activitySummary: {
      effectiveVoiceHours30d: 2.1,
      effectiveActiveVoiceSignalHours30d: 1.7,
      voiceEngagementRatio30d: 0.81,
      voiceEngagementMultiplier: 0.91,
      voicePart: 6.1,
      activeVoicePart: 4.4,
    },
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
  assert.match(state.blocks.voiceSummary.lines.join("\n"), /В score: effective 30д 2,1 ч .* active signal 1,7 ч .* engagement 81,0% .* x0,91/);
  assert.match(state.blocks.voiceSummary.lines.join("\n"), /Voice credit: 6,1 \+ 4,4 очков/);
  assert.match(state.blocks.voiceSummary.lines.join("\n"), /Сейчас в voice: <#voice-lounge> .* 16\.05\.2026/);
  assert.match(state.blocks.voiceSummary.lines.join("\n"), /Топ voice-каналы: <#voice-main> \(2\), <#voice-lounge> \(1\), <#voice-side> \(1\)/);
  assert.match(state.blocks.voiceSummary.lines.join("\n"), /Voice-срез обновлялся ~1,5 ч назад/);
});

test("buildProfileSynergyState derives Discord vs Roblox activity mix", () => {
  const state = buildProfileSynergyState({
    activitySummary: {
      messages30d: 210,
    },
    robloxSummary: {
      jjsMinutes30d: 420,
    },
    voiceSummary: {
      voiceDurationSeconds30d: 9000,
    },
  });

  assert.equal(state.blocks.activityMix.title, "Activity mix");
  assert.match(state.blocks.activityMix.lines.join("\n"), /Discord vs Roblox: больше Discord chat/);
  assert.match(state.blocks.activityMix.lines.join("\n"), /JJS 7 ч 30д .* chat 210 msg 30д .* voice 2,5 ч 30д/);
  assert.match(state.blocks.activityMix.lines.join("\n"), /Mix: chat 60% .* JJS 30% .* voice 11% .* confidence reliable/);
});

test("buildProfileSynergyState derives a stable grinder farm profile from playtime buckets", () => {
  const state = buildProfileSynergyState({
    profile: {
      domains: {
        roblox: {
          playtime: {
            dailyBuckets: {
              "2026-05-01": 60,
              "2026-05-02": 65,
              "2026-05-03": 70,
              "2026-05-04": 60,
              "2026-05-05": 65,
              "2026-05-06": 70,
              "2026-05-07": 60,
              "2026-05-08": 65,
              "2026-05-09": 70,
              "2026-05-10": 65,
            },
            hourlyBucketsMsk: {
              "2026-05-08T19": 60,
              "2026-05-08T20": 45,
              "2026-05-09T19": 55,
              "2026-05-09T20": 50,
              "2026-05-10T19": 65,
              "2026-05-10T20": 60,
            },
          },
        },
      },
    },
    robloxSummary: {
      jjsMinutes30d: 650,
      totalJjsMinutes: 900,
      sessionCount: 12,
    },
  });

  assert.equal(state.blocks.farmProfile.title, "Farm profile");
  assert.match(state.blocks.farmProfile.lines.join("\n"), /Farm profile: стабильный гриндер .* длинные сессии \(proxy\) .* confidence partial/);
  assert.match(state.blocks.farmProfile.lines.join("\n"), /Daily rhythm: active days 10 .* span 10д .* avg active day 1,1 ч .* top day 11% .* top3 32%/);
  assert.match(state.blocks.farmProfile.lines.join("\n"), /Session proxy: avg 75 мин\/session .* sessions 12 .* lifetime proxy .* avg active hour/);
  assert.match(state.blocks.farmProfile.lines.join("\n"), /no strong farm claim without session histograms/);
});

test("buildProfileSynergyState marks bursty short farm profile as proxy only", () => {
  const state = buildProfileSynergyState({
    profile: {
      domains: {
        roblox: {
          playtime: {
            dailyBuckets: {
              "2026-05-01": 300,
              "2026-05-05": 20,
              "2026-05-10": 10,
            },
          },
        },
      },
    },
    robloxSummary: {
      jjsMinutes30d: 330,
      totalJjsMinutes: 330,
      sessionCount: 20,
    },
  });

  assert.equal(state.blocks.farmProfile.title, "Farm profile");
  assert.match(state.blocks.farmProfile.lines.join("\n"), /Farm profile: вспышками .* короткие рывки \(proxy\) .* confidence heuristic/);
  assert.match(state.blocks.farmProfile.lines.join("\n"), /Daily rhythm: active days 3 .* span 10д .* avg active day 1,8 ч .* top day 91% .* top3 100%/);
  assert.match(state.blocks.farmProfile.lines.join("\n"), /Session proxy: avg 16,5 мин\/session .* sessions 20 .* lifetime proxy/);
  assert.match(state.blocks.farmProfile.lines.join("\n"), /Trust: proxy/);
});

test("buildProfileSynergyState promotes farm profile when JJS session history exists", () => {
  const state = buildProfileSynergyState({
    profile: {
      domains: {
        roblox: {
          playtime: {
            totalJjsMinutes: 300,
            jjsMinutes30d: 300,
            sessionCount: 4,
            dailyBuckets: {
              "2026-05-01": 70,
              "2026-05-02": 80,
              "2026-05-03": 90,
              "2026-05-04": 60,
            },
            hourlyBucketsMsk: {
              "2026-05-01T20": 70,
              "2026-05-02T20": 80,
              "2026-05-03T20": 90,
              "2026-05-04T20": 60,
            },
            sessionHistory: [
              { startedAt: "2026-05-01T17:00:00.000Z", endedAt: "2026-05-01T18:10:00.000Z", durationMinutes: 70 },
              { startedAt: "2026-05-02T17:00:00.000Z", endedAt: "2026-05-02T18:20:00.000Z", durationMinutes: 80 },
              { startedAt: "2026-05-03T17:00:00.000Z", endedAt: "2026-05-03T18:30:00.000Z", durationMinutes: 90 },
              { startedAt: "2026-05-04T17:00:00.000Z", endedAt: "2026-05-04T18:00:00.000Z", durationMinutes: 60 },
              { startedAt: "2026-05-05T17:00:00.000Z", endedAt: "2026-05-05T18:15:00.000Z", durationMinutes: 75 },
            ],
          },
        },
      },
    },
    robloxSummary: {
      totalJjsMinutes: 300,
      jjsMinutes30d: 300,
      sessionCount: 4,
    },
  });

  assert.equal(state.blocks.farmProfile.title, "Farm profile");
  assert.match(state.blocks.farmProfile.lines.join("\n"), /Farm profile: .* длинные сессии .* confidence reliable/);
  assert.match(state.blocks.farmProfile.lines.join("\n"), /Session histogram: avg 75 мин\/session .* median 75 min .* long>=60 100% .* sessions 5/);
  assert.match(state.blocks.farmProfile.lines.join("\n"), /Trust: session-history .* strong farm claim bounded by captured sessions/);
});

test("buildProfileSynergyState exposes separate relative places for core components", () => {
  const state = buildProfileSynergyState({
    now: "2026-05-16T12:00:00.000Z",
    approvedKills: 4300,
    profile: {
      approvedKills: 4300,
      domains: {
        progress: {
          proofWindows: [
            {
              approvedKills: 4000,
              reviewedAt: "2026-05-10T00:00:00.000Z",
              playtimeTracked: true,
              totalJjsMinutes: 900,
            },
            {
              approvedKills: 4300,
              reviewedAt: "2026-05-15T00:00:00.000Z",
              playtimeTracked: true,
              totalJjsMinutes: 1200,
            },
          ],
        },
      },
    },
    activitySummary: {
      messages30d: 210,
      sessions30d: 25,
      effectiveVoiceHours30d: 2.1,
      effectiveActiveVoiceSignalHours30d: 1.7,
    },
    robloxSummary: {
      hasVerifiedAccount: true,
      isTrackable: true,
      trackingState: "trackable",
      jjsMinutes30d: 420,
      sessionCount: 9,
      totalJjsMinutes: 1260,
    },
    voiceSummary: {
      voiceDurationSeconds30d: 9000,
      sessionCount30d: 2,
    },
    supportSummary: {
      antiteam: {
        sourceAvailable: true,
        confirmedArrived: 3,
        responded: 4,
        linkGranted: 2,
        source: "sot.antiteam.stats.helpers",
      },
    },
    populationProfiles: [
      makeRelativeComponentPopulationProfile("relative-1", { messages30d: 250, sessions30d: 30, voiceHours30d: 5, activeVoiceShare: 90, voiceSessions30d: 4, jjsHours30d: 10, jjsSessionCount: 10, fromKills: 1000, toKills: 1400, antiteamPoints: 4 }),
      makeRelativeComponentPopulationProfile("relative-2", { messages30d: 200, sessions30d: 20, voiceHours30d: 3, activeVoiceShare: 80, voiceSessions30d: 3, jjsHours30d: 8, jjsSessionCount: 8, fromKills: 1000, toKills: 1300, antiteamPoints: 3 }),
      makeRelativeComponentPopulationProfile("relative-3", { messages30d: 100, sessions30d: 10, voiceHours30d: 2, activeVoiceShare: 50, voiceSessions30d: 2, jjsHours30d: 6, jjsSessionCount: 7, fromKills: 1000, toKills: 1200, antiteamPoints: 2 }),
      makeRelativeComponentPopulationProfile("relative-4", { messages30d: 50, sessions30d: 5, voiceHours30d: 1, activeVoiceShare: 30, voiceSessions30d: 1, jjsHours30d: 4, jjsSessionCount: 4, fromKills: 1000, toKills: 1100, antiteamPoints: 1 }),
      makeRelativeComponentPopulationProfile("relative-5", { messages30d: 10, sessions30d: 1, voiceHours30d: 0.5, activeVoiceShare: 10, voiceSessions30d: 0, jjsHours30d: 2, jjsSessionCount: 1, fromKills: 1000, toKills: 1050, antiteamPoints: 0 }),
    ],
  });

  assert.equal(state.blocks.relativeComponents.title, "Места по метрикам");
  assert.match(state.blocks.relativeComponents.lines.join("\n"), /voice hours 2,5 ч \(#3\/5, reliable\)/);
  assert.match(state.blocks.relativeComponents.lines.join("\n"), /active voice 81% \(#2\/5, reliable\)/);
  assert.match(state.blocks.relativeComponents.lines.join("\n"), /messages 210 \(#2\/5, reliable\)/);
  assert.match(state.blocks.relativeComponents.lines.join("\n"), /Discord sessions 25 \(#2\/5, reliable\)/);
  assert.match(state.blocks.relativeComponents.lines.join("\n"), /JJS time 7 ч \(#3\/5, reliable\)/);
  assert.match(state.blocks.relativeComponents.lines.join("\n"), /JJS sessions 9 \(#2\/5, reliable\)/);
  assert.match(state.blocks.relativeComponents.lines.join("\n"), /kills\/day 60 \(#2\/5, reliable\)/);
  assert.match(state.blocks.relativeComponents.lines.join("\n"), /antiteam 3 \(#2\/5, reliable\)/);
});

test("buildProfileSynergyState prefers persisted population snapshot for relative component places", () => {
  const state = buildProfileSynergyState({
    activitySummary: {
      messages30d: 210,
      sessions30d: 25,
    },
    robloxSummary: {
      jjsMinutes30d: 420,
      sessionCount: 9,
    },
    voiceSummary: {
      voiceDurationSeconds30d: 9000,
      sessionCount30d: 2,
    },
    supportSummary: {
      antiteam: {
        sourceAvailable: true,
        confirmedArrived: 3,
        source: "sot.antiteam.stats.helpers",
      },
    },
    populationSnapshot: {
      dayKey: "2026-05-20",
      axes: {
        discord_messages_30d: { values: [10, 50, 100, 200, 250] },
        discord_sessions_30d: { values: [1, 5, 10, 20, 30] },
        jjs_time_30d: { values: [2, 4, 6, 8, 10] },
        jjs_session_count: { values: [1, 4, 7, 8, 10] },
        voice_hours_30d: { values: [0.5, 1, 2, 3, 5] },
        voice_sessions_30d: { values: [0, 1, 2, 3, 4] },
        antiteam_support_points: { values: [0, 1, 2, 3, 4] },
      },
    },
  });

  assert.equal(state.blocks.relativeComponents.title, "Места по метрикам");
  assert.match(state.blocks.relativeComponents.lines.join("\n"), /messages 210 \(#2\/5, reliable\)/);
  assert.match(state.blocks.relativeComponents.lines.join("\n"), /Discord sessions 25 \(#2\/5, reliable\)/);
  assert.match(state.blocks.relativeComponents.lines.join("\n"), /JJS time 7 ч \(#3\/5, reliable\)/);
  assert.match(state.blocks.relativeComponents.lines.join("\n"), /voice hours 2,5 ч \(#3\/5, reliable\)/);
  assert.match(state.blocks.relativeComponents.lines.join("\n"), /antiteam 3 \(#2\/5, reliable\)/);
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

test("buildProfileSynergyState derives prime time confidence across weekly hourly buckets", () => {
  const state = buildProfileSynergyState({
    profile: {
      domains: {
        roblox: {
          playtime: {
            hourlyBucketsMsk: {
              "2026-05-05T19": 60,
              "2026-05-05T20": 40,
              "2026-05-05T21": 20,
              "2026-05-12T19": 30,
              "2026-05-12T20": 80,
              "2026-05-12T21": 20,
              "2026-05-19T20": 70,
              "2026-05-19T21": 60,
              "2026-05-19T22": 20,
            },
          },
        },
      },
    },
  });

  assert.equal(state.blocks.primeTimeConfidence.title, "Prime time confidence");
  assert.match(state.blocks.primeTimeConfidence.lines.join("\n"), /Prime confidence: stable .* 3\/3 weeks near 19:00-23:00 МСК/);
  assert.match(state.blocks.primeTimeConfidence.lines.join("\n"), /Weekly windows: 2026-W19 18:00-22:00 .* 2026-W20 18:00-22:00 .* 2026-W21 19:00-23:00/);
  assert.match(state.blocks.primeTimeConfidence.lines.join("\n"), /Trust: reliable .* active hourly weeks 3/);
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
  assert.match(state.blocks.bestPeriods.lines.join("\n"), /coverage 100% \(35\/35 дн\).* complete 100% .* fragmented 0% .* без дыр/);
  assert.match(state.blocks.bestPeriods.lines.join("\n"), /Пик 7д: 15\.04\.2026-21\.04\.2026 .* 15 ч JJS .* activity 70 .* voice 1,5 ч .* 3 частых напарн\./);
  assert.match(state.blocks.bestPeriods.lines.join("\n"), /Контур 7д-пика: 4.?200 kills .* tier 3 .* мейн Gojo .* Roblox-друзей 2 .* кандидатов 4/);
  assert.match(state.blocks.bestPeriods.lines.join("\n"), /Пик 30д: 04\.04\.2026-03\.05\.2026 .* 40 ч JJS .* activity 82 .* voice 5 ч .* 3 частых напарн\./);
});

test("buildProfileSynergyState summarizes season consistency without pretending rolling snapshots are exact days", () => {
  const snapshots = [
    {
      dayKey: "2026-05-01",
      capturedAt: "2026-05-01T12:00:00.000Z",
      activityScore: 20,
      messages7d: 10,
      sessions7d: 1,
      jjsMinutes7d: 60,
      voiceDurationSeconds7d: 0,
      topCoPlayPeerUserIds: [],
      serverFriendsCount: 1,
      socialSuggestionCount: 0,
      antiteamSupportPoints: 0,
    },
    ...Array.from({ length: 6 }, (_entry, index) => {
      const dayKey = shiftIsoDayKey("2026-05-02", index);
      return {
        dayKey,
        capturedAt: `${dayKey}T12:00:00.000Z`,
        activityScore: index === 4 ? 90 : 45 + index * 4,
        messages7d: index === 4 ? 220 : 40 + index * 10,
        sessions7d: index === 4 ? 20 : 4 + index,
        jjsMinutes7d: index === 4 ? 900 : 180 + index * 30,
        voiceDurationSeconds7d: index === 4 ? 7200 : 600 * index,
        topCoPlayPeerUserIds: index === 4 ? ["peer-1", "peer-2", "peer-3"] : ["peer-1"],
        serverFriendsCount: 2,
        socialSuggestionCount: index === 4 ? 3 : 1,
        antiteamSupportPoints: index === 4 ? 3 : 0,
      };
    }),
  ];
  const state = buildProfileSynergyState({
    profile: {
      domains: {
        seasonArchive: {
          snapshots,
        },
      },
    },
  });

  assert.equal(state.blocks.seasonConsistency.title, "Season consistency");
  assert.match(state.blocks.seasonConsistency.lines.join("\n"), /Season consistency: вспышками .* average day .* spread .* snapshots 7/);
  assert.match(state.blocks.seasonConsistency.lines.join("\n"), /Best snapshot day: 06\.05\.2026 .* JJS 15 ч rolling 7д .* activity 90 .* msg 220 .* voice 2 ч .* social 3 peers .* antiteam 3/);
  assert.match(state.blocks.seasonConsistency.lines.join("\n"), /Weakest snapshot day: 01\.05\.2026 .* JJS 1 ч rolling 7д .* activity 20 .* msg 10/);
  assert.match(state.blocks.seasonConsistency.lines.join("\n"), /Trust: reliable .* coverage 100% \(7\/7 дн\).* rolling snapshots, not exact single-day deltas/);
});

test("buildProfileSynergyState exposes season archive coverage gaps as trust metrics", () => {
  const snapshots = buildSeasonArchiveSnapshots({
    startDayKey: "2026-04-01",
    dayCount: 8,
    peak7Index: 7,
  }).filter((snapshot) => snapshot.dayKey !== "2026-04-04");
  const state = buildProfileSynergyState({
    profile: {
      domains: {
        seasonArchive: {
          snapshots,
        },
      },
    },
  });

  assert.equal(state.blocks.bestPeriods.title, "Лучшие периоды");
  assert.match(state.blocks.bestPeriods.lines.join("\n"), /coverage 88% \(7\/8 дн\).* complete 88% .* fragmented 13% .* дыр 1/);
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

test("buildProfileSynergyState summarizes persisted weekly season rollups", () => {
  const state = buildProfileSynergyState({
    profile: {
      domains: {
        seasonArchive: {
          weeklyRollups: [
            {
              weekKey: "2026-W20",
              startDayKey: "2026-05-11",
              endDayKey: "2026-05-17",
              coverage: {
                expectedDays: 7,
                coveredDays: 5,
                missingDays: 2,
                coveragePercent: 71.4,
              },
              totals: {
                jjsMinutes: 420,
                messages: 80,
                sessions: 8,
                voiceSeconds: 1800,
                approvedKillsDelta: 100,
                antiteamPointsDelta: 0,
              },
              composite: {
                score: 44,
                grade: "C-",
                confidenceState: "partial",
                influenceDebuffPercent: 15,
              },
            },
            {
              weekKey: "2026-W21",
              startDayKey: "2026-05-18",
              endDayKey: "2026-05-24",
              coverage: {
                expectedDays: 7,
                coveredDays: 7,
                missingDays: 0,
                coveragePercent: 100,
              },
              totals: {
                jjsMinutes: 900,
                messages: 210,
                sessions: 18,
                voiceSeconds: 7200,
                approvedKillsDelta: 400,
                antiteamPointsDelta: 2,
              },
              composite: {
                score: 84,
                grade: "A",
                confidenceState: "reliable",
                influenceDebuffPercent: 0,
              },
            },
          ],
        },
      },
    },
  });

  assert.equal(state.blocks.weeklyRollups.title, "Strongest week");
  assert.match(state.blocks.weeklyRollups.lines.join("\n"), /Strongest week: 2026-W21 .* A \(84\) .* coverage 7\/7д \(100%\)/);
  assert.match(state.blocks.weeklyRollups.lines.join("\n"), /Signals: JJS 15 ч .* msg 210 .* sessions 18 .* voice 2 ч .* kills \+400 .* antiteam \+2/);
  assert.match(state.blocks.weeklyRollups.lines.join("\n"), /Window: 18\.05\.2026-24\.05\.2026 .* confidence reliable .* debuff 0%/);
});

test("buildProfileSynergyState summarizes comeback and active streak from weekly rollups", () => {
  const state = buildProfileSynergyState({
    profile: {
      domains: {
        seasonArchive: {
          weeklyRollups: [
            makeWeeklyRollup("2026-W19", {
              startDayKey: "2026-05-04",
              score: 18,
              grade: "D",
              jjsMinutes: 0,
              messages: 5,
              sessions: 1,
            }),
            makeWeeklyRollup("2026-W20", {
              startDayKey: "2026-05-11",
              score: 64,
              grade: "B-",
              jjsMinutes: 600,
              messages: 120,
              sessions: 10,
              voiceSeconds: 3600,
              approvedKillsDelta: 80,
            }),
            makeWeeklyRollup("2026-W21", {
              startDayKey: "2026-05-18",
              score: 72,
              grade: "B+",
              jjsMinutes: 720,
              messages: 150,
              sessions: 14,
              voiceSeconds: 5400,
              approvedKillsDelta: 120,
            }),
            makeWeeklyRollup("2026-W22", {
              startDayKey: "2026-05-25",
              score: 78,
              grade: "A-",
              jjsMinutes: 780,
              messages: 180,
              sessions: 18,
              voiceSeconds: 7200,
              approvedKillsDelta: 200,
              antiteamPointsDelta: 1,
            }),
          ],
        },
      },
    },
  });

  assert.equal(state.blocks.comebackMetrics.title, "Comeback metrics");
  assert.match(state.blocks.comebackMetrics.lines.join("\n"), /восстановился после паузы .* вернулся после просадки .* держит серию активных окон .* active streak 3w .* latest 2026-W22 A- \(78\)/);
  assert.match(state.blocks.comebackMetrics.lines.join("\n"), /Windows: 2026-W19 D \(18\) -> 2026-W20 B- \(64\) -> 2026-W21 B\+ \(72\) -> 2026-W22 A- \(78\)/);
  assert.match(state.blocks.comebackMetrics.lines.join("\n"), /Latest signals: JJS 13 ч .* msg 180 .* sessions 18 .* voice 2 ч .* kills \+200 .* antiteam \+1/);
  assert.match(state.blocks.comebackMetrics.lines.join("\n"), /Trust: reliable .* windows 4 .* min coverage 100% .* claims require 3\+ comparable weekly windows/);
});

test("buildProfileSynergyState detects three-window slowdown without short-history overclaim", () => {
  const slowingState = buildProfileSynergyState({
    profile: {
      domains: {
        seasonArchive: {
          weeklyRollups: [
            makeWeeklyRollup("2026-W20", { startDayKey: "2026-05-11", score: 85, grade: "A", jjsMinutes: 900, messages: 220, sessions: 20, voiceSeconds: 7200 }),
            makeWeeklyRollup("2026-W21", { startDayKey: "2026-05-18", score: 72, grade: "B+", jjsMinutes: 720, messages: 160, sessions: 15, voiceSeconds: 5400 }),
            makeWeeklyRollup("2026-W22", { startDayKey: "2026-05-25", score: 58, grade: "C+", jjsMinutes: 420, messages: 95, sessions: 8, voiceSeconds: 1800 }),
          ],
        },
      },
    },
  });

  assert.match(slowingState.blocks.comebackMetrics.lines.join("\n"), /замедляется 3 окна подряд .* остывает второе окно/);
  assert.match(slowingState.blocks.comebackMetrics.lines.join("\n"), /Windows: 2026-W20 A \(85\) -> 2026-W21 B\+ \(72\) -> 2026-W22 C\+ \(58\)/);

  const shortState = buildProfileSynergyState({
    profile: {
      domains: {
        seasonArchive: {
          weeklyRollups: [
            makeWeeklyRollup("2026-W21", { startDayKey: "2026-05-18", score: 30, grade: "D+", jjsMinutes: 60, messages: 12, sessions: 2 }),
            makeWeeklyRollup("2026-W22", { startDayKey: "2026-05-25", score: 72, grade: "B+", jjsMinutes: 720, messages: 150, sessions: 14 }),
          ],
        },
      },
    },
  });

  assert.equal(shortState.blocks.comebackMetrics.title, "Comeback metrics");
  assert.match(shortState.blocks.comebackMetrics.lines.join("\n"), /Comeback metrics: история короткая .* windows 2\/3 .* no comeback claim/);
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
