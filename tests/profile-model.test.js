"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildProfileReadModel } = require("../src/profile/model");

function shiftIsoDayKey(dayKey = "", offsetDays = 0) {
  const timestamp = Date.parse(`${dayKey}T12:00:00.000Z`);
  return new Date(timestamp + offsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function buildSeasonArchiveSnapshots({ startDayKey = "2026-05-01", dayCount = 12, peak7Index = null } = {}) {
  const normalizedPeak7Index = Number.isInteger(peak7Index) ? peak7Index : Math.max(0, dayCount - 1);

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
      jjsMinutes30d: 600 + index * 25,
      voiceDurationSeconds7d: index === normalizedPeak7Index ? 5400 : index * 300,
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
  jjsMinutes = 0,
  messages = 0,
  sessions = 0,
  voiceSeconds = 0,
} = {}) {
  return {
    weekKey,
    startDayKey,
    endDayKey: shiftIsoDayKey(startDayKey, 6),
    coverage: {
      expectedDays: 7,
      coveredDays: 7,
      missingDays: 0,
      coveragePercent: 100,
    },
    totals: {
      jjsMinutes,
      messages,
      sessions,
      voiceSeconds,
      approvedKillsDelta: 0,
      antiteamPointsDelta: 0,
    },
    composite: {
      score,
      grade,
      confidenceState: "reliable",
      influenceDebuffPercent: 0,
    },
  };
}

function makeAntiteamSupportPopulationProfile(userId, {
  responded = 0,
  linkGranted = 0,
  confirmedArrived = 0,
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
            source: "sot.antiteam.stats.helpers",
          },
        },
      },
    },
  };
}

test("profile read-model composes derived sections, links, and verification facts", () => {
  const readModel = buildProfileReadModel({
    now: "2026-05-16T12:00:00.000Z",
    guildId: "guild-1",
    userId: "user-1",
    targetDisplayName: "Sasha",
    isSelf: false,
    roleMentions: ["<@&role-1>", "<@&role-2>"],
    profile: {
      approvedKills: 120,
      killTier: 4,
      accessGrantedAt: "2026-05-01T10:00:00.000Z",
      mainCharacterIds: ["gojo"],
      mainCharacterLabels: ["Gojo"],
      summary: {
        preferredDisplayName: "Sasha",
        onboarding: { approvedKills: 120, killTier: 4 },
        progress: {
          proofWindowCount: 1,
          lastProofWindowReviewedAt: "2026-05-15T00:00:00.000Z",
          lastProofWindowApprovedKills: 120,
        },
        voice: {
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
        activity: {
          appliedActivityRoleKey: "active",
          activityScore: 77,
          voiceScoringMode: "smart",
          messages7d: 35,
          messages30d: 210,
          messages90d: 400,
          sessions7d: 8,
          sessions30d: 25,
          sessions90d: 40,
          activeDays7d: 4,
          activeDays30d: 12,
          effectiveVoiceHours30d: 2.1,
          effectiveActiveVoiceSignalHours30d: 1.7,
          effectiveVoiceDays30d: 1.6,
          voiceEngagementRatio30d: 0.81,
          voiceEngagementMultiplier: 0.91,
          voicePart: 6.1,
          activeVoicePart: 4.4,
          activeWatchedChannels30d: 5,
          daysAbsent: 2,
          roleEligibilityStatus: "eligible",
          daysSinceGuildJoin: 240,
          lastSeenAt: "2026-05-10T12:00:00.000Z",
        },
        elo: {
          currentElo: 145,
          currentTier: 2,
          lastSubmissionStatus: "approved",
          lastSubmissionId: "elo-approved-1",
          lastSubmissionCreatedAt: "2026-05-01T12:00:00.000Z",
          proofUrl: "https://proof/approved",
        },
        tierlist: {
          hasSubmission: true,
          mainName: "Gojo",
          lockUntil: "2026-05-20T12:00:00.000Z",
          influenceMultiplier: 1.2,
        },
        roblox: {
          hasVerifiedAccount: true,
          currentUsername: "GojoMain",
          currentDisplayName: "Gojo The Strongest",
          userId: "rbx-main",
          previousUsername: "OldGojo",
          renameCount: 2,
          profileUrl: "https://www.roblox.com/users/123/profile",
          avatarUrl: "https://tr.rbxcdn.com/gojo-avatar.png",
          serverFriendsCount: 3,
          serverFriendsUserIds: ["rbx-friend-1", "rbx-friend-2", "rbx-friend-3"],
          serverFriendsComputedAt: "2026-05-16T08:00:00.000Z",
          jjsMinutes7d: 180,
          jjsMinutes30d: 420,
          totalJjsMinutes: 5000,
          sessionCount: 9,
          currentSessionStartedAt: "2026-05-12T11:30:00.000Z",
          nonFriendPeerCount: 4,
          frequentNonFriendCount: 1,
          lastSeenInJjsAt: "2026-05-11T09:00:00.000Z",
          lastRefreshAt: "2026-05-12T09:00:00.000Z",
          refreshStatus: "fresh",
          topCoPlayPeers: [
            {
              peerUserId: "peer-1",
              minutesTogether: 210,
              sessionsTogether: 5,
              isRobloxFriend: true,
              lastSeenTogetherAt: "2026-05-12T08:00:00.000Z",
            },
            {
              peerUserId: "peer-2",
              minutesTogether: 140,
              sessionsTogether: 3,
              isFrequentNonFriend: true,
              lastSeenTogetherAt: "2026-05-11T08:00:00.000Z",
            },
          ],
        },
        verification: {
          status: "verified",
          decision: "approved",
          reviewedAt: "2026-05-02T12:00:00.000Z",
          oauthUsername: "SashaDiscord",
          oauthAvatarUrl: "https://cdn.discordapp.com/oauth-avatar.png",
        },
      },
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
        progress: {
          proofWindows: [
            {
              approvedKills: 120,
              killTier: 4,
              reviewedAt: "2026-05-15T00:00:00.000Z",
              playtimeTracked: true,
              totalJjsMinutes: 180,
            },
          ],
        },
        seasonArchive: {
          snapshots: buildSeasonArchiveSnapshots({
            startDayKey: "2026-05-01",
            dayCount: 12,
            peak7Index: 11,
          }),
        },
      },
    },
    targetAvatarUrl: "https://cdn.discordapp.com/avatars/user-1/profile.png",
    latestSubmission: {
      reviewedAt: "2026-05-02T12:00:00.000Z",
    },
    eloProfile: {
      currentElo: 145,
      currentTier: 2,
      lastSubmissionStatus: "approved",
      lastSubmissionId: "elo-approved-1",
      lastSubmissionCreatedAt: "2026-05-01T12:00:00.000Z",
      proofUrl: "https://proof/approved",
    },
    tierlistProfile: {
      mainName: "Gojo",
      influenceMultiplier: 1.2,
      lockUntil: "2026-05-20T12:00:00.000Z",
    },
    approvedEntries: [
      { userId: "user-2", displayName: "Top", approvedKills: 200 },
      { userId: "user-1", displayName: "Sasha", approvedKills: 120 },
    ],
    recentKillChange: {
      userId: "user-1",
      from: 100,
      to: 120,
      fromAt: Date.parse("2026-05-01T00:00:00.000Z"),
      toAt: Date.parse("2026-05-10T00:00:00.000Z"),
    },
    recentKillChanges: [
      {
        userId: "user-1",
        from: 80,
        to: 100,
        fromAt: Date.parse("2026-04-26T00:00:00.000Z"),
        toAt: Date.parse("2026-05-01T00:00:00.000Z"),
      },
      {
        userId: "user-1",
        from: 100,
        to: 120,
        fromAt: Date.parse("2026-05-01T00:00:00.000Z"),
        toAt: Date.parse("2026-05-10T00:00:00.000Z"),
      },
    ],
    comboGuideState: {
      generalTechsThreadId: "general-thread",
      characters: [{ id: "gojo", name: "Gojo", threadId: "thread-1" }],
    },
    characterCatalog: [
      {
        id: "gojo",
        label: "Gojo",
        wikiUrl: "https://jujutsu-shenanigans.fandom.com/wiki/Gojo",
      },
    ],
    populationProfiles: [
      {
        userId: "friend-1",
        profile: {
          summary: {
            preferredDisplayName: "Friend One",
            activity: {
              appliedActivityRoleKey: "active",
              messages7d: 10,
            },
            roblox: {
              userId: "rbx-friend-1",
              currentUsername: "FriendOneRb",
              hasVerifiedAccount: true,
              jjsMinutes7d: 160,
            },
          },
        },
      },
      {
        userId: "friend-2",
        profile: {
          summary: {
            preferredDisplayName: "Friend Two",
            activity: {
              messages7d: 4,
            },
            roblox: {
              userId: "rbx-friend-2",
              currentUsername: "FriendTwoRb",
              hasVerifiedAccount: true,
              jjsMinutes7d: 0,
            },
          },
        },
      },
    ],
  });

  assert.equal(readModel.userId, "user-1");
  assert.equal(readModel.displayName, "Sasha");
  assert.equal(readModel.isSelf, false);
  assert.equal(readModel.heroTitle, "Кто ты сейчас");
  assert.match(readModel.heroLines.join("\n"), /Текст-тирлист: Форма B\+ .* Чат B .* Килы A .* Стабильность C- .* Развитие C- .* Соц B-/);
  assert.match(readModel.heroLines.join("\n"), /Сейчас это живой core-игрок .* Gojo-main .* рост ещё только собирается .* держит заметный игровой круг/);
  assert.match(readModel.heroLines.join("\n"), /Опора профиля: #2 по kills .* tier 4 .* ELO 145 \/ tier 2 .* Roblox GojoMain .* активность active/);
  assert.equal(readModel.primaryAvatarUrl, "https://cdn.discordapp.com/avatars/user-1/profile.png");
  assert.deepEqual(readModel.mediaGalleryItems.map((entry) => entry.url), [
    "https://tr.rbxcdn.com/gojo-avatar.png",
    "https://cdn.discordapp.com/oauth-avatar.png",
  ]);
  assert.match(readModel.sections.overview[0].lines.join("\n"), /Игрок: <@user-1>/);
  assert.match(readModel.sections.overview[0].lines.join("\n"), /Роли: <@&role-1>, <@&role-2>/);
  assert.match(readModel.sections.overview[0].lines.join("\n"), /Roblox: GojoMain/);
  assert.match(readModel.sections.overview[0].lines.join("\n"), /Подтверждённые kills: 120/);
  assert.match(readModel.sections.overview[0].lines.join("\n"), /ELO: 145 \/ tier 2/);
  assert.equal(readModel.sections.overview[1].title, "Main Core");
  assert.match(readModel.sections.overview[1].lines.join("\n"), /Ядро пиков: Gojo-main/);
  assert.match(readModel.sections.overview[1].lines.join("\n"), /Серверный контур: форма B\+ .* #2 по kills .* ELO 145 \/ tier 2/);
  assert.match(readModel.sections.overview[1].lines.join("\n"), /Игровая связка: чаще всего с <@peer-1> .* Roblox-друг/);
  assert.match(readModel.sections.overview[1].lines.join("\n"), /Гайд-контур: гайды 1\/1 по мейнам .* wiki 1\/1 по мейнам .* общие техи доступны/);
  assert.equal(readModel.sections.overview[2].title, "Буквы и места");
  assert.match(readModel.sections.overview[2].lines.join("\n"), /Форма B\+ \(baseline 2\/5\).* Чат B \(baseline 2\/5\).* Килы A \(место N\/A\)/);
  assert.match(readModel.sections.overview[2].lines.join("\n"), /Надёжность букв: reliable 0\/6 .* partial 6 .* max debuff 90%/);
  assert.match(readModel.sections.overview[3].lines.join("\n"), /JJS доступ: открыт с/);
  assert.match(readModel.sections.overview[3].lines.join("\n"), /Верификация: verified/);
  assert.match(readModel.sections.overview[3].lines.join("\n"), /Roblox-связка: подтверждена/);
  assert.equal(readModel.sections.overview[4].title, "War Readiness");
  assert.match(readModel.sections.overview[4].lines.join("\n"), /Готовность к вару: высокая/);
  assert.match(readModel.sections.overview[4].lines.join("\n"), /Roblox 7д: 3 ч .* Discord last seen: ~6 д .* proof freshness: ~36 ч назад/);
  assert.match(readModel.sections.overview[4].lines.join("\n"), /Prime time: 19:00-23:00 МСК/);
  assert.match(readModel.sections.progress[0].lines.join("\n"), /Место по kills: #2/);
  assert.match(readModel.sections.progress[1].lines.join("\n"), /Прирост: \+20 kills/);
  assert.match(readModel.sections.progress[2].lines.join("\n"), /1\. 100 -> 120/);
  assert.match(readModel.sections.progress[2].lines.join("\n"), /2\. 80 -> 100/);
  assert.match(readModel.sections.progress[3].lines.join("\n"), /Последняя проверка:/);
  assert.match(readModel.sections.progress[4].lines.join("\n"), /Текущий рейтинг: ELO 145 \/ tier 2/);
  assert.match(readModel.sections.progress[4].lines.join("\n"), /ID ELO заявки: elo-approved-1/);
  assert.match(readModel.sections.progress[4].lines.join("\n"), /Последний ELO submit:/);
  assert.match(readModel.sections.progress[4].lines.join("\n"), /Скрин ELO: https:\/\/proof\/approved/);
  assert.match(readModel.sections.progress[4].lines.join("\n"), /Tierlist-заявка: есть/);
  assert.equal(readModel.sections.progress[5].title, "Proof gap");
  assert.match(readModel.sections.progress[5].lines.join("\n"), /Proof gap: last proof .* approved 120 kills/);
  assert.match(readModel.sections.progress[5].lines.join("\n"), /JJS после proof: 80,3 ч .* proof сильно отстал от игры/);
  assert.match(readModel.sections.progress[5].lines.join("\n"), /Trust: outdated .* kill-backed debuff 90%/);
  assert.equal(readModel.sections.activity[1].title, "Voice-срез");
  assert.match(readModel.sections.activity[1].lines.join("\n"), /Voice 7д\/30д: 1,5 ч \/ 2,5 ч .* сессии 7д\/30д: 1 \/ 2 .* lifetime сессии: 2 .* неполных 30д: 1/);
  assert.match(readModel.sections.activity[1].lines.join("\n"), /Сейчас в voice: <#voice-lounge> .* 16\.05\.2026/);
  assert.match(readModel.sections.activity[1].lines.join("\n"), /Топ voice-каналы: <#voice-main> \(2\), <#voice-lounge> \(1\), <#voice-side> \(1\)/);
  assert.equal(readModel.sections.activity[2].title, "Prime time МСК");
  assert.match(readModel.sections.activity[2].lines.join("\n"), /Чаще всего играет с 19:00 до 23:00 МСК .* окно 305 мин/);
  assert.match(readModel.sections.activity[2].lines.join("\n"), /Пиковый час: 20:00 .* активных часов: 5 .* tracked минут в bucket-слое: 315/);
  assert.equal(readModel.sections.activity[3].title, "Лучшие периоды");
  assert.match(readModel.sections.activity[3].lines.join("\n"), /Архив сезона: 12 дневных срезов .* 01\.05\.2026-12\.05\.2026/);
  assert.match(readModel.sections.activity[3].lines.join("\n"), /Пик 7д: 06\.05\.2026-12\.05\.2026 .* 15 ч JJS .* activity 61 .* voice 1,5 ч/);
  assert.match(readModel.sections.activity[3].lines.join("\n"), /Пик 30д: данные сезона ещё копятся \(12\/30 дневных срезов\)\./);
  assert.equal(readModel.sections.activity[4].title, "История сезона");
  assert.match(readModel.sections.activity[4].lines.join("\n"), /Траектория: 3.?200 -> 3.?750 kills \(\+550\) .* activity 50 -> 61 \(\+11\) .* 1 -> 3 частых напарн\./);
  assert.match(readModel.sections.activity[4].lines.join("\n"), /Нарратив: сезон разогнался: kills, activity и игровой круг выросли вместе\./);
  assert.match(readModel.sections.activity[4].lines.join("\n"), /Фокус сезона: Gojo удержался главным опорным персонажем\./);
  assert.match(readModel.sections.activity[5].lines.join("\n"), /Сообщения 90д: 400/);
  assert.match(readModel.sections.activity[0].lines.join("\n"), /Voice raw\/effective 30д: 2,5 ч \/ 2,1 ч/);
  assert.match(readModel.sections.activity[0].lines.join("\n"), /Voice signal 30д: 1,7 ч .* effective дни: 1,6/);
  assert.match(readModel.sections.activity[0].lines.join("\n"), /Voice engagement: 81\.0% .* credit x0,91 .* вклад 6,1 \+ 4,4/);
  assert.match(readModel.sections.activity[1].lines.join("\n"), /В score: effective 30д 2,1 ч .* active signal 1,7 ч .* engagement 81,0% .* x0,91/);
  assert.match(readModel.sections.activity[1].lines.join("\n"), /Voice credit: 6,1 \+ 4,4 очков/);
  const activityMixBlock = readModel.sections.activity.find((section) => section.title === "Activity mix");
  assert.ok(activityMixBlock);
  assert.match(activityMixBlock.lines.join("\n"), /Discord vs Roblox: больше Discord chat/);
  assert.match(activityMixBlock.lines.join("\n"), /Mix: chat 60% .* JJS 30% .* voice 11% .* confidence reliable/);
  const farmProfileBlock = readModel.sections.activity.find((section) => section.title === "Farm profile");
  assert.ok(farmProfileBlock);
  assert.match(farmProfileBlock.lines.join("\n"), /Farm profile: .* confidence heuristic/);
  assert.match(farmProfileBlock.lines.join("\n"), /Session proxy: avg .*\/session .* lifetime proxy/);
  assert.match(farmProfileBlock.lines.join("\n"), /no strong farm claim without session histograms/);
  const primeConfidenceBlock = readModel.sections.activity.find((section) => section.title === "Prime time confidence");
  assert.ok(primeConfidenceBlock);
  assert.match(primeConfidenceBlock.lines.join("\n"), /Prime confidence: короткая история .* hourly buckets 8/);
  const seasonConsistencyBlock = readModel.sections.activity.find((section) => section.title === "Season consistency");
  assert.ok(seasonConsistencyBlock);
  assert.match(seasonConsistencyBlock.lines.join("\n"), /Season consistency: .* average day .* snapshots 12/);
  assert.match(seasonConsistencyBlock.lines.join("\n"), /rolling snapshots, not exact single-day deltas/);
  assert.match(readModel.sections.social[0].lines.join("\n"), /Связка Roblox: подтверждена/);
  assert.match(readModel.sections.social[0].lines.join("\n"), /Аккаунт: GojoMain/);
  assert.match(readModel.sections.social[0].lines.join("\n"), /Display в Roblox: Gojo The Strongest/);
  assert.match(readModel.sections.social[0].lines.join("\n"), /Смен username Roblox: 2/);
  assert.match(readModel.sections.social[0].lines.join("\n"), /JJS минут 7д: 180/);
  assert.match(readModel.sections.social[0].lines.join("\n"), /JJS сессий всего: 9/);
  assert.equal(readModel.sections.social[1].title, "Roblox-друзья на сервере");
  assert.match(readModel.sections.social[1].lines.join("\n"), /Roblox-друзей на сервере: 3 .* видимых профилей: 2 .* verified: 2 .* активны 7д: 2 .* играли в JJS 7д: 1/);
  assert.equal(readModel.sections.social[2].title, "Кто из друзей уже здесь");
  assert.match(readModel.sections.social[2].lines.join("\n"), /1\. <@friend-1> .* Friend One .* Roblox FriendOneRb .* verified Roblox .* JJS 7д 160 мин .* activity active/);
  assert.match(readModel.sections.social[2].lines.join("\n"), /2\. <@friend-2> .* Friend Two .* Roblox FriendTwoRb .* verified Roblox .* 4 msg 7д/);
  assert.equal(readModel.sections.social[3].title, "Социальная эволюция");
  assert.match(readModel.sections.social[3].lines.join("\n"), /Соц-архив: 12 дневных срезов .* 01\.05\.2026-12\.05\.2026/);
  assert.match(readModel.sections.social[3].lines.join("\n"), /Игровой круг: 1 -> 3 частых напарн\. \(\+2\) .* Roblox-друзей: 2 -> 2 \(0\) .* скрытый круг: 0 -> 3 \(\+3\)/);
  assert.match(readModel.sections.social[3].lines.join("\n"), /Смена ядра: удержались 1 .* новых 2 .* выпало 0 .* top peer archive/);
  assert.match(readModel.sections.social[4].lines.join("\n"), /<@peer-1> • 210 мин вместе • 5 сесс\. • Roblox-друг/);
  assert.match(readModel.sections.social[4].lines.join("\n"), /<@peer-2> • 140 мин вместе • 3 сесс\. • частый non-friend/);
  assert.equal(readModel.sections.social[5].title, "Скрытый круг");
  assert.match(readModel.sections.social[5].lines.join("\n"), /явных frequent non-friend пересечений пока не видно, хотя Roblox-друзья на сервере уже есть \(3\)/);
  assert.match(readModel.sections.social[6].lines.join("\n"), /Гайды по мейнам: 1\/1/);
  assert.match(readModel.sections.social[6].lines.join("\n"), /JJS wiki по мейнам: 1\/1/);
  assert.match(readModel.sections.social[6].lines.join("\n"), /1\. Gojo — гайд доступен по кнопке .* JJS wiki доступна по кнопке/);
  assert.match(readModel.sections.social[6].lines.join("\n"), /Основной tierlist-пик: Gojo • входит в список мейнов/);
  assert.match(readModel.sections.social[6].lines.join("\n"), /Общие техи: доступны по кнопке\./);
  const verifiedCircleBlock = readModel.sections.social.find((section) => section.title === "Проверенный круг");
  assert.ok(verifiedCircleBlock);
  assert.match(verifiedCircleBlock.lines.join("\n"), /Проверенный круг: verified\+friend\+JJS 1 .* verified friends 2 .* active 7д 2 .* JJS 7д 1/);
  const socialMapBlock = readModel.sections.social.find((section) => section.title === "Социальная карта");
  assert.ok(socialMapBlock);
  assert.match(socialMapBlock.lines.join("\n"), /Социальная карта: strong 2 .* medium 2 .* friends here 2 .* inferred 0/);
  assert.match(socialMapBlock.lines.join("\n"), /sources Roblox friends\/co-play\/social suggestions .* no exact party claim/);
  const voiceGameOverlapBlock = readModel.sections.social.find((section) => section.title === "Voice + game overlap");
  assert.ok(voiceGameOverlapBlock);
  assert.match(voiceGameOverlapBlock.lines.join("\n"), /Voice \+ JJS overlap: ждёт voice contact source .* JJS overlap есть .* voice summary есть/);
  assert.equal(readModel.comboLinks[0].label, "Gojo");
  assert.equal(readModel.comboLinks[0].buttonLabel, "Гайд: Gojo");
  assert.equal(readModel.comboLinks[1].buttonLabel, "JJS Wiki: Gojo");
  assert.equal(readModel.robloxProfileUrl, "https://www.roblox.com/users/123/profile");
  assert.ok(readModel.verificationLines.some((line) => /verified/.test(line)));
  assert.equal(readModel.emptyStateNote, null);
});

test("profile read-model appends comeback metrics from weekly rollups", () => {
  const readModel = buildProfileReadModel({
    now: "2026-05-16T12:00:00.000Z",
    guildId: "guild-1",
    userId: "user-1",
    targetDisplayName: "Sasha",
    profile: {
      domains: {
        seasonArchive: {
          weeklyRollups: [
            makeWeeklyRollup("2026-W20", { startDayKey: "2026-05-11", score: 25, grade: "D", jjsMinutes: 30, messages: 6, sessions: 1 }),
            makeWeeklyRollup("2026-W21", { startDayKey: "2026-05-18", score: 62, grade: "B-", jjsMinutes: 600, messages: 120, sessions: 10, voiceSeconds: 3600 }),
            makeWeeklyRollup("2026-W22", { startDayKey: "2026-05-25", score: 70, grade: "B+", jjsMinutes: 720, messages: 160, sessions: 14, voiceSeconds: 5400 }),
          ],
        },
      },
    },
  });

  const comebackBlock = readModel.sections.activity.find((section) => section.title === "Comeback metrics");
  assert.ok(comebackBlock);
  assert.match(comebackBlock.lines.join("\n"), /восстановился после паузы .* вернулся после просадки/);
  assert.match(comebackBlock.lines.join("\n"), /Windows: 2026-W20 D \(25\) -> 2026-W21 B- \(62\) -> 2026-W22 B\+ \(70\)/);
});

test("profile read-model places antiteam support as its own overview block", () => {
  const readModel = buildProfileReadModel({
    now: "2026-05-16T12:00:00.000Z",
    guildId: "guild-1",
    userId: "user-1",
    targetDisplayName: "Sasha",
    isSelf: false,
    profile: {
      summary: {
        support: {
          antiteam: {
            sourceAvailable: true,
            responded: 4,
            linkGranted: 2,
            confirmedArrived: 3,
            source: "sot.antiteam.stats.helpers",
          },
        },
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

  const supportBlock = readModel.sections.overview.find((section) => section.title === "Antiteam support");
  assert.ok(supportBlock);
  assert.match(supportBlock.lines.join("\n"), /Support points: confirmed arrivals 3 .* responded 4 .* link grants 2/);
  assert.match(supportBlock.lines.join("\n"), /Место по antiteam support: #2\/5/);
  assert.match(supportBlock.lines.join("\n"), /confidence reliable .* debuff 0%/);
});

test("profile read-model exposes compact-card composition through the canonical stack", () => {
  const readModel = buildProfileReadModel({
    guildId: "guild-1",
    userId: "user-1",
    targetDisplayName: "Sasha",
    isSelf: true,
    displayMode: "compact-card",
    profile: {
      approvedKills: 120,
      killTier: 4,
      mainCharacterLabels: ["Gojo"],
      summary: {
        preferredDisplayName: "Sasha",
        onboarding: { approvedKills: 120, killTier: 4 },
        verification: { status: "verified" },
        roblox: {
          hasVerifiedAccount: true,
          isTrackable: true,
          trackingState: "trackable",
          userId: "123",
          currentUsername: "GojoMain",
          profileUrl: "https://www.roblox.com/users/123/profile",
        },
        elo: {
          currentElo: 145,
          currentTier: 2,
          lastSubmissionStatus: "approved",
          lastSubmissionId: "elo-compact-1",
          lastSubmissionCreatedAt: "2026-05-01T12:00:00.000Z",
          proofUrl: "https://proof/compact",
        },
        tierlist: {
          hasSubmission: true,
          mainName: "Gojo",
        },
      },
    },
  });

  assert.equal(readModel.displayMode, "compact-card");
  assert.equal(readModel.sections.compact[0].title, "Моя карточка");
  assert.match(readModel.sections.compact[0].lines.join("\n"), /Игрок: <@user-1>/);
  assert.match(readModel.sections.compact[0].lines.join("\n"), /Roblox: GojoMain/);
  assert.match(readModel.sections.compact[0].lines.join("\n"), /ELO: 145 \/ tier 2/);
  assert.equal(readModel.sections.compact[1].title, "Готовность");
  assert.equal(readModel.sections.compact[2].title, "ELO и Tierlist");
  assert.match(readModel.sections.compact[2].lines.join("\n"), /ID ELO заявки: elo-compact-1/);
  assert.match(readModel.sections.compact[2].lines.join("\n"), /Скрин ELO: https:\/\/proof\/compact/);
});

test("profile read-model marks empty profiles without fabricating data sections", () => {
  const readModel = buildProfileReadModel({
    now: "2026-05-16T12:00:00.000Z",
    guildId: "guild-1",
    userId: "user-1",
    targetDisplayName: "New User",
    isSelf: true,
  });

  assert.equal(readModel.displayName, "New User");
  assert.equal(readModel.isSelf, true);
  assert.equal(readModel.heroTitle, "Быстрый статус");
  assert.match(readModel.heroLines.join("\n"), /Готовность: JJS доступ не выдан .* верификация не начата .* Roblox не подтверждён/);
  assert.match(readModel.sections.overview[0].lines.join("\n"), /Профиль ещё не заполнен/i);
  assert.match(readModel.sections.overview[0].lines.join("\n"), /Роли: —/);
  assert.match(readModel.sections.overview[0].lines.join("\n"), /Roblox: не привязан/i);
  assert.match(readModel.sections.overview[0].lines.join("\n"), /Подтверждённые kills: —/);
  assert.match(readModel.sections.overview[0].lines.join("\n"), /ELO: —/);
  assert.match(readModel.sections.overview[1].lines.join("\n"), /JJS доступ: пока не выдан/i);
  assert.match(readModel.sections.overview[1].lines.join("\n"), /Верификация: не начата/i);
  assert.match(readModel.sections.overview[1].lines.join("\n"), /Roblox-связка: не подтверждена/i);
  assert.equal(readModel.verificationLines, null);
  assert.match(readModel.emptyStateNote, /После онбординга профиль заполнится автоматически/i);
  assert.deepEqual(readModel.comboLinks, []);
  assert.equal(readModel.primaryAvatarUrl, null);
  assert.deepEqual(readModel.mediaGalleryItems, []);
  assert.equal(readModel.robloxProfileUrl, null);
});

test("profile read-model hides unverified Roblox identity details from the profile surface", () => {
  const readModel = buildProfileReadModel({
    now: "2026-05-16T12:00:00.000Z",
    guildId: "guild-1",
    userId: "user-1",
    targetDisplayName: "Sasha",
    isSelf: true,
    profile: {
      summary: {
        preferredDisplayName: "Sasha",
        roblox: {
          hasVerifiedAccount: false,
          verificationStatus: "unverified",
          currentUsername: "RandomNick",
          currentDisplayName: "Random Display",
          profileUrl: "https://www.roblox.com/users/123/profile",
          avatarUrl: "https://tr.rbxcdn.com/random-avatar.png",
        },
      },
    },
  });

  assert.doesNotMatch(readModel.heroLines.join("\n"), /RandomNick/);
  assert.equal(readModel.heroTitle, "Быстрый статус");
  assert.match(readModel.sections.overview[0].lines.join("\n"), /Roblox: не привязан/);
  assert.match(readModel.sections.social[0].lines.join("\n"), /Связка Roblox: unverified/);
  assert.doesNotMatch(readModel.sections.social[0].lines.join("\n"), /RandomNick|Профиль Roblox/);
  assert.equal(readModel.primaryAvatarUrl, null);
  assert.equal(readModel.robloxProfileUrl, null);
});

test("profile read-model does not present repairable Roblox data as a linked account", () => {
  const readModel = buildProfileReadModel({
    now: "2026-05-16T12:00:00.000Z",
    guildId: "guild-1",
    userId: "user-1",
    targetDisplayName: "Sasha",
    isSelf: true,
    profile: {
      summary: {
        preferredDisplayName: "Sasha",
        roblox: {
          hasVerifiedAccount: true,
          isTrackable: false,
          trackingState: "repairable",
          trackingBlocker: "invalid_user_id",
          verificationStatus: "verified",
          currentUsername: "DiscordLikeName",
          currentDisplayName: "Discord Display",
          profileUrl: "https://www.roblox.com/users/123/profile",
          avatarUrl: "https://tr.rbxcdn.com/wrong-avatar.png",
        },
      },
    },
  });

  assert.doesNotMatch(readModel.heroLines.join("\n"), /DiscordLikeName/);
  assert.match(readModel.heroLines.join("\n"), /Roblox требует перепривязки/);
  assert.match(readModel.sections.overview[0].lines.join("\n"), /Roblox: не привязан/);
  assert.match(readModel.sections.overview[1].lines.join("\n"), /нужна перепривязка/i);
  assert.match(readModel.sections.social[0].lines.join("\n"), /требует перепривязки/i);
  assert.doesNotMatch(readModel.sections.social[0].lines.join("\n"), /DiscordLikeName|Профиль Roblox/);
  assert.equal(readModel.selfActionState.hasVerifiedRoblox, false);
  assert.equal(readModel.selfActionState.robloxLabel, "Перепривязать Roblox");
  assert.equal(readModel.primaryAvatarUrl, null);
  assert.equal(readModel.robloxProfileUrl, null);
});

test("profile read-model keeps Roblox-hours line honest when proof snapshot has no reliable playtime baseline", () => {
  const readModel = buildProfileReadModel({
    now: "2026-05-16T12:00:00.000Z",
    guildId: "guild-1",
    userId: "user-1",
    isSelf: true,
    profile: {
      approvedKills: 120,
      killTier: 4,
      summary: {
        preferredDisplayName: "Sasha",
        onboarding: { approvedKills: 120, killTier: 4 },
        roblox: {
          hasVerifiedAccount: true,
          totalJjsMinutes: 5000,
        },
      },
      domains: {
        progress: {
          proofWindows: [
            {
              approvedKills: 120,
              killTier: 4,
              reviewedAt: "2026-05-15T00:00:00.000Z",
              playtimeTracked: false,
              totalJjsMinutes: 100,
            },
          ],
        },
      },
    },
  });

  assert.equal(readModel.sections.progress[0].title, "Практический прогресс");
  assert.match(readModel.sections.progress[0].lines.join("\n"), /С последнего рега: 36 ч по времени .* Roblox-часы пока ненадёжны/);
  assert.match(readModel.sections.progress[0].lines.join("\n"), /Динамика: для устойчивого паттерна нужно хотя бы ещё одно окно роста/);
  assert.doesNotMatch(readModel.sections.progress[0].lines.join("\n"), /Есть смысл обновить kills/);
});

test("profile read-model shows a soft self reminder after enough reliable JJS hours since last approved update", () => {
  const readModel = buildProfileReadModel({
    now: "2026-05-16T12:00:00.000Z",
    guildId: "guild-1",
    userId: "user-1",
    isSelf: true,
    profile: {
      approvedKills: 120,
      killTier: 4,
      summary: {
        preferredDisplayName: "Sasha",
        onboarding: { approvedKills: 120, killTier: 4 },
        roblox: {
          hasVerifiedAccount: true,
          totalJjsMinutes: 900,
        },
      },
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
  });

  assert.equal(readModel.sections.progress[0].title, "Практический прогресс");
  assert.match(readModel.sections.progress[0].lines.join("\n"), /С последнего рега: 36 ч по времени .* 13 ч JJS/);
  assert.match(readModel.sections.progress[0].lines.join("\n"), /CTA: После последнего рега уже 13 ч JJS .* пора обновить kills/);
});

test("profile read-model keeps unapproved onboarding state null even when proof history remains", () => {
  const readModel = buildProfileReadModel({
    now: "2026-05-16T12:00:00.000Z",
    guildId: "guild-1",
    userId: "user-1",
    isSelf: true,
    profile: {
      approvedKills: null,
      killTier: null,
      summary: {
        preferredDisplayName: "Sasha",
        onboarding: { approvedKills: null, killTier: null },
        roblox: {
          hasVerifiedAccount: true,
          totalJjsMinutes: 900,
        },
      },
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
  });

  const progressText = readModel.sections.progress[0].lines.join("\n");

  assert.match(readModel.sections.overview[0].lines.join("\n"), /Подтверждённые kills: —/);
  assert.equal(readModel.selfActionState.killsLabel, "Добавить kills");
  assert.match(progressText, /Зарегистрированные kills пока не подтверждены\./);
  assert.match(progressText, /С последнего рега: 36 ч по времени .* 13 ч JJS/);
  assert.doesNotMatch(progressText, /Зарегистрировано: 0 kills/);
  assert.doesNotMatch(progressText, /До следующего tier|До milestone/);
});

test("profile read-model prepends the self-progress block before generic progress sections", () => {
  const readModel = buildProfileReadModel({
    now: "2026-05-16T12:00:00.000Z",
    guildId: "guild-1",
    userId: "user-1",
    isSelf: true,
    profile: {
      approvedKills: 4300,
      killTier: 3,
      summary: {
        preferredDisplayName: "Sasha",
        onboarding: { approvedKills: 4300, killTier: 3 },
        roblox: {
          hasVerifiedAccount: true,
          totalJjsMinutes: 1560,
        },
      },
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
  });

  assert.equal(readModel.sections.progress[0].title, "Практический прогресс");
  assert.equal(readModel.sections.progress[1].title, "Вклад");
  assert.match(readModel.sections.progress[0].lines.join("\n"), /Сравнение окон: последний ап 60 kills\/ч .* прошлый 50 kills\/ч/);
  assert.match(readModel.sections.progress[0].lines.join("\n"), /Средний темп за отслеженный период: 53,3 kills\/ч JJS/);
  assert.match(readModel.sections.progress[0].lines.join("\n"), /До следующего tier: 2.?700 kills/);
  assert.match(readModel.sections.progress[0].lines.join("\n"), /До milestone 20.?000: 15.?700 kills/);
});
