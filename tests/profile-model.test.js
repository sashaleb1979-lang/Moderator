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
    roleMentions: ["<@&role-1>", "<@&1146511958305144883>", "<@&role-2>"],
    tierlistStatsUrl: "https://discord.com/channels/guild-1/tierlist/summary",
    characterStats: [
      { id: "gojo", main: "Gojo", roleId: "role-gojo" },
    ],
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
          userId: "123",
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
      { userId: "user-2", displayName: "Top", approvedKills: 200, mains: ["Gojo"] },
      { userId: "user-1", displayName: "Sasha", approvedKills: 120, mains: ["Gojo"] },
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
  assert.equal(readModel.heroTitle, "⚡ Главное");
  assert.ok(readModel.heroLines.length <= 3);
  assert.match(readModel.heroLines.join("\n"), /🔥 Рейтинг .* \d+\/100/);
  assert.match(readModel.heroLines.join("\n"), /🎭 Gojo #2\/2 .* 38% kills .* \+81 до #1 .* kills #2\/2/);
  assert.match(readModel.heroLines.join("\n"), /JJS 7 ч .* chat 210 .* voice 2,1ч .* Roblox готов/);
  assert.doesNotMatch(readModel.heroLines.join("\n"), /Буквы|Текст-тирлист|confidence|source|debuff|fresh|baseline|XP|Ур\./);
  assert.ok(readModel.heroSummary);
  assert.doesNotMatch(readModel.heroSummary.lines.join("\n"), /🧪 Данные:/);
  assert.ok(Array.isArray(readModel.trustBadges));
  assert.ok(readModel.trustBadges.some((badge) => badge.key === "roblox" && badge.text === "привязан"));
  assert.ok(readModel.trustBadges.some((badge) => badge.key === "profileScore" && badge.label === "Оценка"));
  assert.equal(readModel.surfaceState, "partial");
  assert.ok(readModel.componentBudget.maxSectionTextDisplays > 0);
  assert.ok(Array.isArray(readModel.sectionGroups.overview));
  assert.ok(readModel.sectionGroups.overview.some((group) => group.title === "🔥 Рейтинг"));
  assert.equal(readModel.profileLevelState, undefined);
  assert.equal(readModel.profileLevelLines, undefined);
  assert.ok(readModel.profileRatingSummary.score > 0);
  assert.ok(readModel.profileRatingSummary.lockedAxisPenaltyPercent >= 0);
  assert.equal(readModel.profileRatingSummary.radarLine, "");
  assert.deepEqual(readModel.profileRatingAxes.map((axis) => axis.axisName), ["activity", "kills", "jjs"]);
  assert.ok(readModel.profileRatingAxes.every((axis) => Array.isArray(axis.cardLines) && axis.cardLines.length <= 5));
  assert.ok(readModel.profileRatingAxes.every((axis) => Number.isFinite(axis.scoreContributionPercent) && Number.isFinite(axis.effectiveWeightPercent)));
  assert.ok(readModel.profileRatingAxes.every((axis) => axis.primaryHintLine || axis.isLocked));
  assert.equal(readModel.primaryAvatarUrl, "https://cdn.discordapp.com/avatars/user-1/profile.png");
  assert.deepEqual(readModel.identityMediaItems.map((entry) => entry.url), [
    "https://cdn.discordapp.com/avatars/user-1/profile.png",
    "https://tr.rbxcdn.com/gojo-avatar.png",
  ]);
  assert.deepEqual(readModel.mediaGalleryItems.map((entry) => entry.url), [
    "https://tr.rbxcdn.com/gojo-avatar.png",
    "https://cdn.discordapp.com/oauth-avatar.png",
  ]);
  assert.deepEqual(readModel.mandatoryLinks.map((entry) => entry.label), [
    "Roblox профиль",
    "JJS Wiki: персонажи",
  ]);
  assert.equal(readModel.identityPreview.robloxStatus, "Roblox готов");
  assert.equal(readModel.sections.overview[0].title, "🔥 Рейтинг профиля");
  assert.match(readModel.sections.overview[0].lines.join("\n"), /🔥 Рейтинг .* \d+\/100/);
  assert.match(readModel.sections.overview[0].lines.join("\n"), /★ Пик: (Активность|Kills|JJS)/);
  const ratingText = readModel.sections.overview.slice(0, 4).map((section) => [section.title, ...section.lines].join("\n")).join("\n");
  assert.match(ratingText, /🟣 Активность .* \d+\/100/);
  assert.match(ratingText, /⚔️ Kills .* \d+\/100/);
  assert.match(ratingText, /🎮 JJS .* \d+\/100/);
  assert.match(ratingText, /💡 /);
  assert.match(ratingText, /↳ /);
  assert.ok(readModel.ratingDetailCards.activity);
  assert.ok(readModel.ratingDetailCards.kills);
  assert.ok(readModel.ratingDetailCards.jjs);
  assert.match(readModel.ratingDetailCards.kills.blocks.map((block) => block.title).join("\n"), /🧮 Как считается[\s\S]*📌 Входные данные[\s\S]*🏔️ Пик \/ планка[\s\S]*📉 Что влияет на оценку[\s\S]*🧾 Источники[\s\S]*💡 До апа/);
  assert.doesNotMatch(ratingText, /Боевая форма|Proof\/Kills|Стабильность|Рост|Связи|Общение|📉 Минусы|📈 Плюсы|🔎 Что нужно/);
  assert.doesNotMatch(ratingText, /Буквы|confidence|source|debuff|fresh|baseline|XP|Ур\./);
  const overviewActivity = readModel.sections.overview.find((section) => section.title === "📊 Сводка активности");
  assert.ok(overviewActivity);
  assert.match(overviewActivity.lines.join("\n"), /JJS .* Roblox готов/);
  assert.match(overviewActivity.lines.join("\n"), /JJS 7 ч\/30д[\s\S]*Chat 210 msg\/30д[\s\S]*Voice 2,1 ч .* активное 2,1 ч/);
  assert.equal(readModel.sections.overview.find((section) => section.title === "🎭 Мейны и места"), undefined);
  assert.match(readModel.heroLines.join("\n"), /Gojo #2\/2 .* 38% kills .* \+81 до #1/);
  assert.deepEqual(readModel.mainStandings.map((entry) => ({
    label: entry.label,
    rank: entry.rank,
    total: entry.total,
    killsToNext: entry.killsToNext,
    mainKillSharePercent: Math.round(entry.mainKillSharePercent),
  })), [{ label: "Gojo", rank: 2, total: 2, killsToNext: 81, mainKillSharePercent: 38 }]);
  assert.equal(readModel.sections.overview.find((section) => section.title === "Main Core"), undefined);
  assert.doesNotMatch(readModel.sections.overview.map((section) => section.title).join("\n"), /📚 Мейны|Мейны и гайды/);
  assert.deepEqual(readModel.sections.progress.slice(0, 6).map((section) => section.title), ["⚔️ Сейчас", "📈 Темп", "🧾 Proof", "🗓️ Недели", "💡 До апа", "🏆 Прайм и рекорды"]);
  assert.match(readModel.sections.progress[0].lines.join("\n"), /Kills 120 .* #2\/2 .* 37[,.]5% серверных kills/);
  assert.match(readModel.sections.progress[1].lines.join("\n"), /Последние окна: \+20 · \+20/);
  assert.match(readModel.sections.progress[2].lines.join("\n"), /Proof отстал .* учёт kills 10%/);
  assert.match(readModel.sections.progress[2].lines.join("\n"), /После proof: 80,3 ч JJS/);
  assert.match(readModel.sections.progress[4].lines.join("\n"), /Kills #1: \+81 kills|До tier/);
  assert.doesNotMatch(readModel.sections.progress.map((section) => [section.title, ...section.lines].join("\n")).join("\n"), /ELO|elo|📊 ELO и Tierlist|Последний рост по kills|История approved ростов|Заявки и проверки|Практический прогресс/);
  assert.equal(readModel.sections.activity[0].title, "📊 Итог активности");
  assert.match(readModel.sections.activity[0].lines.join("\n"), /JJS 7 ч\/30д .* Roblox готов/);
  assert.match(readModel.sections.activity[0].lines.join("\n"), /JJS 7 ч\/30д[\s\S]*Chat 210 msg\/30д[\s\S]*Voice 2,1 ч/);
  assert.match(readModel.sections.activity[0].lines.join("\n"), /роль active/);
  assert.equal(readModel.sections.activity[1].title, "💬 Сообщения");
  assert.match(readModel.sections.activity[1].lines.join("\n"), /7д 35 .* 30д 210 .* 90д 400/);
  assert.equal(readModel.sections.activity[2].title, "🎙️ Voice");
  assert.match(readModel.sections.activity[2].lines.join("\n"), /Raw 2,1 ч .* учёт 2,1 ч .* качество 81%/);
  assert.equal(readModel.sections.activity[3].title, "🎮 JJS");
  assert.match(readModel.sections.activity[3].lines.join("\n"), /7д 3 ч .* 30д 7 ч .* sessions 9/);
  assert.match(readModel.sections.activity[3].lines.join("\n"), /Чаще всего играет с 19:00 до 23:00 МСК .* окно 5 ч/);
  const seasonBlock = readModel.sections.activity.find((section) => section.title === "🏆 Сезон");
  assert.ok(seasonBlock);
  assert.equal(seasonBlock.lines.join("\n"), "Сезон откроется после 3 недель истории (0/3).");
  assert.ok(!readModel.sections.activity.some((section) => /Детали activity/.test(section.title)));
  assert.equal(readModel.sections.activity.find((section) => section.title === "Activity mix"), undefined);
  assert.equal(readModel.sections.activity.find((section) => section.title === "Farm profile"), undefined);
  const primeConfidenceBlock = readModel.sections.activity.find((section) => section.title === "Prime time confidence");
  assert.ok(primeConfidenceBlock);
  assert.match(primeConfidenceBlock.lines.join("\n"), /Prime confidence: короткая история .* hourly buckets 8/);
  assert.equal(readModel.hiddenSectionReasons.season, "Сезон откроется после 3 недель истории (0/3).");
  assert.equal(readModel.sections.social[0].title, "🚧 Соц-карта");
  assert.match(readModel.sections.social[0].lines.join("\n"), /в разработке/);
  const robloxSocialBlock = readModel.sections.social.find((section) => section.title === "🤝 Roblox и соц");
  assert.ok(robloxSocialBlock);
  assert.match(robloxSocialBlock.lines.join("\n"), /Roblox-связка: подтверждена/);
  assert.match(robloxSocialBlock.lines.join("\n"), /Аккаунт: GojoMain/);
  assert.match(robloxSocialBlock.lines.join("\n"), /Display в Roblox: Gojo The Strongest/);
  assert.ok(robloxSocialBlock.lines.length <= 5);
  const friendsBlock = readModel.sections.social.find((section) => section.title === "Roblox-друзья на сервере");
  assert.ok(friendsBlock);
  assert.match(friendsBlock.lines.join("\n"), /Roblox-друзей на сервере: 3 .* видимых профилей: 2 .* verified: 2 .* активны 7д: 2 .* играли в JJS 7д: 1/);
  const friendsHereBlock = readModel.sections.social.find((section) => section.title === "Кто из друзей уже здесь");
  assert.ok(friendsHereBlock);
  assert.match(friendsHereBlock.lines.join("\n"), /1\. <@friend-1> .* Friend One .* Roblox FriendOneRb .* verified Roblox .* JJS 7д 2,6 ч .* activity active/);
  assert.match(friendsHereBlock.lines.join("\n"), /2\. <@friend-2> .* Friend Two .* Roblox FriendTwoRb .* verified Roblox .* 4 msg 7д/);
  const socialEvolutionBlock = readModel.sections.social.find((section) => section.title === "Социальная эволюция");
  assert.ok(socialEvolutionBlock);
  assert.match(socialEvolutionBlock.lines.join("\n"), /Соц-архив: 12 дневных срезов .* 01\.05\.2026-12\.05\.2026/);
  assert.match(socialEvolutionBlock.lines.join("\n"), /Игровой круг: 1 -> 3 частых напарн\. \(\+2\) .* Roblox-друзей: 2 -> 2 \(0\) .* скрытый круг: 0 -> 3 \(\+3\)/);
  assert.ok(socialEvolutionBlock.lines.length <= 2);
  const coPlayBlock = readModel.sections.social.find((section) => section.title === "🎮 С кем чаще всего играет");
  assert.ok(coPlayBlock);
  assert.match(coPlayBlock.lines.join("\n"), /<@peer-1> • 3,5 ч вместе • 5 сесс\. • Roblox-друг/);
  assert.match(coPlayBlock.lines.join("\n"), /<@peer-2> • 2,3 ч вместе • 3 сесс\. • частый non-friend/);
  const hiddenCircleBlock = readModel.sections.social.find((section) => section.title === "Скрытый круг");
  assert.ok(hiddenCircleBlock);
  assert.match(hiddenCircleBlock.lines.join("\n"), /явных frequent non-friend пересечений пока не видно, хотя Roblox-друзья на сервере уже есть \(3\)/);
  assert.equal(readModel.sections.social.find((section) => section.title === "📚 Мейны и гайды"), undefined);
  const verifiedCircleBlock = readModel.sections.social.find((section) => section.title === "Проверенный круг");
  assert.ok(verifiedCircleBlock);
  assert.match(verifiedCircleBlock.lines.join("\n"), /Проверенный круг: verified\+friend\+JJS 1 .* verified friends 2 .* active 7д 2 .* JJS 7д 1/);
  const socialMapBlock = readModel.sections.social.find((section) => section.title === "Социальная карта");
  assert.ok(socialMapBlock);
  assert.match(socialMapBlock.lines.join("\n"), /Социальная карта: strong 2 .* medium 2 .* friends here 2 .* inferred 0/);
  assert.ok(socialMapBlock.lines.length <= 3);
  assert.equal(readModel.sections.social.find((section) => section.title === "Voice + game overlap"), undefined);
  assert.equal(readModel.hiddenSectionReasons.voiceGameOverlap, "Voice + JJS откроется после пересечений в voice и игре.");
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

test("profile read-model places antiteam support as its own progress block", () => {
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

  const supportBlock = readModel.sections.progress.find((section) => section.title === "Antiteam support");
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
  assert.ok(readModel.sections.compact[0].lines.length <= 4);
  assert.match(readModel.sections.compact[0].lines.join("\n"), /🔥 Рейтинг/);
  assert.match(readModel.sections.compact[0].lines.join("\n"), /Roblox GojoMain/);
  assert.doesNotMatch(readModel.sections.compact[0].lines.join("\n"), /XP|Ур\.|ELO/);
  assert.equal(readModel.sections.compact.length, 1);
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
  assert.equal(readModel.heroTitle, "⚡ Главное");
  assert.ok(readModel.heroLines.length <= 3);
  assert.match(readModel.heroLines.join("\n"), /Рейтинг профиля откроется/);
  assert.doesNotMatch(readModel.heroLines.join("\n"), /XP|Ур\./);
  assert.equal(readModel.sections.overview[0].title, "🔥 Рейтинг профиля");
  assert.match(readModel.sections.overview[0].lines.join("\n"), /Рейтинг профиля откроется после активности, kills и JJS/);
  const emptyActivity = readModel.sections.overview.find((section) => section.title === "📊 Сводка активности");
  assert.ok(emptyActivity);
  assert.match(emptyActivity.lines.join("\n"), /Roblox не привязан/i);
  assert.doesNotMatch(emptyActivity.lines.join("\n"), /JJS 0/);
  assert.equal(readModel.sections.overview.some((section) => section.title === "🎭 Мейны и места"), false);
  assert.equal(readModel.hiddenSectionReasons.season, "Сезон откроется после 3 недель истории (0/3).");
  assert.ok(!readModel.sections.overview.some((section) => /Готовность|War Readiness/.test(section.title)));
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
  assert.equal(readModel.heroTitle, "⚡ Главное");
  assert.match(readModel.sections.overview.find((section) => section.title === "📊 Сводка активности").lines.join("\n"), /Roblox не привязан/);
  const unverifiedRobloxBlock = readModel.sections.social.find((section) => section.title === "🤝 Roblox и соц");
  assert.ok(unverifiedRobloxBlock);
  assert.match(unverifiedRobloxBlock.lines.join("\n"), /Связка Roblox: unverified/);
  assert.doesNotMatch(unverifiedRobloxBlock.lines.join("\n"), /RandomNick|Профиль Roblox/);
  assert.equal(readModel.primaryAvatarUrl, null);
  assert.equal(readModel.robloxProfileUrl, null);
});

test("profile read-model uses domains.roblox as the canonical Roblox display state", () => {
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
          currentUsername: "WrongSummaryName",
          avatarUrl: "https://tr.rbxcdn.com/wrong-summary.png",
        },
      },
      domains: {
        roblox: {
          verificationStatus: "verified",
          userId: "123",
          username: "CanonicalRb",
          displayName: "Canonical Display",
          avatarUrl: "https://tr.rbxcdn.com/canonical.png",
          profileUrl: "https://www.roblox.com/users/123/profile",
          playtime: {
            jjsMinutes7d: 160,
            jjsMinutes30d: 600,
            totalJjsMinutes: 900,
          },
        },
      },
    },
  });

  assert.equal(readModel.robloxDisplayState.isLinked, true);
  assert.equal(readModel.robloxDisplayState.isTrackable, true);
  assert.equal(readModel.selfActionState.hasVerifiedRoblox, true);
  assert.equal(readModel.selfActionState.robloxLabel, "Обновить Roblox");
  assert.equal(readModel.identityPreview.robloxStatus, "Roblox готов");
  assert.match(readModel.heroLines.join("\n"), /Roblox готов/);
  assert.doesNotMatch(readModel.heroLines.join("\n"), /WrongSummaryName/);
  assert.equal(readModel.robloxProfileUrl, "https://www.roblox.com/users/123/profile");
  assert.deepEqual(readModel.identityMediaItems.map((entry) => entry.url), [
    "https://tr.rbxcdn.com/canonical.png",
  ]);
  assert.match(readModel.sections.activity[0].lines.join("\n"), /JJS 10 ч\/30д/);
  assert.match(readModel.sections.activity[3].lines.join("\n"), /7д 2,6 ч .* 30д 10 ч/);
});

test("profile read-model presents repairable Roblox as linked but not JJS-trackable", () => {
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
  assert.match(readModel.heroLines.join("\n"), /Roblox привязан, но JJS-активность не обновляется/);
  assert.match(readModel.sections.overview.find((section) => section.title === "📊 Сводка активности").lines.join("\n"), /Roblox привязан, JJS не обновляется/);
  const repairableRobloxBlock = readModel.sections.social.find((section) => section.title === "🤝 Roblox и соц");
  assert.ok(repairableRobloxBlock);
  assert.match(repairableRobloxBlock.lines.join("\n"), /Roblox привязан, JJS-активность не обновляется/i);
  assert.doesNotMatch(repairableRobloxBlock.lines.join("\n"), /DiscordLikeName|Профиль Roblox|JJS 7д: 0|JJS 30д: 0/);
  assert.equal(readModel.selfActionState.hasVerifiedRoblox, true);
  assert.equal(readModel.selfActionState.robloxLabel, "Перепривязать Roblox");
  assert.equal(readModel.primaryAvatarUrl, null);
  assert.equal(readModel.robloxProfileUrl, null);
});

test("profile read-model flags suspicious old Roblox bindings instead of showing fake links", () => {
  const readModel = buildProfileReadModel({
    now: "2026-05-16T12:00:00.000Z",
    guildId: "guild-1",
    userId: "1146511958305144883",
    targetDisplayName: "gno2m007",
    isSelf: true,
    profile: {
      userId: "1146511958305144883",
      username: "gno2m007",
      displayName: "gno2m007",
      domains: {
        roblox: {
          username: "gno2m007",
          profileUrl: "https://www.roblox.com/users/1146511958305144883/profile",
          verificationStatus: "verified",
        },
      },
      summary: {
        preferredDisplayName: "gno2m007",
        roblox: {
          hasVerifiedAccount: true,
          currentUsername: "gno2m007",
          profileUrl: "https://www.roblox.com/users/1146511958305144883/profile",
          verificationStatus: "verified",
        },
      },
    },
  });

  assert.equal(readModel.robloxDisplayState.state, "suspicious");
  assert.equal(readModel.robloxDisplayState.isLinked, false);
  assert.equal(readModel.robloxDisplayState.isTrackable, false);
  assert.equal(readModel.robloxProfileUrl, null);
  assert.equal(readModel.selfActionState.robloxLabel, "Перепривязать Roblox");
  assert.match(readModel.sections.overview.find((section) => section.title === "📊 Сводка активности").lines.join("\n"), /Roblox требует перепривязки/);
  const suspiciousRobloxBlock = readModel.sections.social.find((section) => section.title === "🤝 Roblox и соц");
  assert.ok(suspiciousRobloxBlock);
  assert.match(suspiciousRobloxBlock.lines.join("\n"), /Roblox-связка требует перепривязки/);
  assert.doesNotMatch(readModel.heroLines.join("\n"), /Roblox gno2m007/);
});

test("profile read-model activity uses canonical activity voice before social voice mirror", () => {
  const readModel = buildProfileReadModel({
    now: "2026-05-16T12:00:00.000Z",
    guildId: "guild-1",
    userId: "user-1",
    targetDisplayName: "Voice User",
    isSelf: true,
    profile: {
      summary: {
        activity: {
          appliedActivityRoleKey: "active",
          messages30d: 210,
          voiceDurationSeconds30d: 46413,
          effectiveVoiceHours30d: 10.9,
        },
        voice: {
          voiceDurationSeconds30d: 5567,
        },
      },
      domains: {
        roblox: {
          username: "VoiceRb",
          userId: "123",
          verificationStatus: "verified",
          playtime: {
            jjsMinutes7d: 180,
            jjsMinutes30d: 420,
          },
        },
      },
    },
  });

  const activityText = readModel.sections.activity[0].lines.join("\n");
  assert.match(activityText, /Voice 12,9 ч · активное 10,9 ч/);
  assert.doesNotMatch(activityText, /voice 1,5 ч/);
});

test("profile rating uses compact three leagues with activity voice caps", () => {
  const chatOnly = buildProfileReadModel({
    now: "2026-05-16T12:00:00.000Z",
    guildId: "guild-1",
    userId: "chat-user",
    targetDisplayName: "Chat User",
    isSelf: true,
    profile: {
      summary: {
        activity: {
          messages7d: 5000,
          sessions7d: 120,
          activeDays7d: 7,
        },
      },
    },
  });
  const chatActivity = chatOnly.profileRatingAxes.find((axis) => axis.axisName === "activity");
  assert.ok(chatActivity);
  assert.ok(chatActivity.score < 87);
  assert.doesNotMatch(chatActivity.grade, /^S/);
  assert.match(chatActivity.detailLine, /нужен voice/);

  const combo = buildProfileReadModel({
    now: "2026-05-16T12:00:00.000Z",
    guildId: "guild-1",
    userId: "combo-user",
    targetDisplayName: "Combo User",
    isSelf: true,
    profile: {
      summary: {
        activity: {
          messages7d: 5000,
          sessions7d: 120,
          voiceDurationSeconds7d: 8 * 3600,
          effectiveVoiceHours7d: 8,
          activeDays7d: 7,
        },
      },
    },
  });
  const comboActivity = combo.profileRatingAxes.find((axis) => axis.axisName === "activity");
  assert.ok(comboActivity.score >= 92);
  assert.match(comboActivity.grade, /^S/);
  assert.match(comboActivity.cardLines.join("\n"), /💡/);
  assert.match(comboActivity.cardLines.join("\n"), /↳ планка: voice/);
});

test("profile rating applies raw voice penalty and compact detail line", () => {
  const readModel = buildProfileReadModel({
    now: "2026-05-16T12:00:00.000Z",
    guildId: "guild-1",
    userId: "voice-user",
    targetDisplayName: "Voice User",
    isSelf: true,
    profile: {
      summary: {
        activity: {
          messages7d: 100,
          sessions7d: 10,
          voiceDurationSeconds7d: 5 * 3600,
          effectiveVoiceHours7d: 3,
        },
      },
    },
  });
  const activity = readModel.profileRatingAxes.find((axis) => axis.axisName === "activity");
  assert.equal(activity.rawVoiceHours, 5);
  assert.equal(activity.cleanVoiceHours, 3);
  assert.equal(Math.round(activity.voiceRatingHours * 10) / 10, 4.4);
  assert.match(activity.detailLine, /планка: voice/);
  assert.match(activity.detailLine, /сырой voice считается слабее/);
  assert.ok(activity.cardLines.length <= 5);
  const detailText = readModel.ratingDetailCards.activity.blocks.map((block) => [block.title, ...block.lines].join("\n")).join("\n");
  assert.match(detailText, /Voice весит 45%/);
  assert.match(detailText, /JJS здесь не участвует/);
  assert.match(detailText, /вклад/);
});

test("profile rating caps and hides stale kills correctly", () => {
  const missingKills = buildProfileReadModel({
    now: "2026-05-16T12:00:00.000Z",
    guildId: "guild-1",
    userId: "no-kills",
    targetDisplayName: "No Kills",
    isSelf: true,
    profile: {
      summary: {
        activity: {
          messages7d: 100,
          sessions7d: 8,
          voiceDurationSeconds7d: 2 * 3600,
          effectiveVoiceHours7d: 2,
        },
      },
    },
  });
  const missingKillsAxis = missingKills.profileRatingAxes.find((axis) => axis.axisName === "kills");
  assert.equal(missingKillsAxis.isLocked, true);
  assert.equal(missingKillsAxis.lockedPenaltyPercent, 40);
  assert.match(missingKillsAxis.cardLines.join("\n"), /Нужен approved proof/);
  assert.doesNotMatch(missingKillsAxis.cardLines.join("\n"), /Approved 0/);

  const noAverage = buildProfileReadModel({
    now: "2026-05-16T12:00:00.000Z",
    guildId: "guild-1",
    userId: "killer",
    targetDisplayName: "Killer",
    isSelf: true,
    profile: { approvedKills: 1000, summary: { onboarding: { approvedKills: 1000 } } },
    approvedEntries: [
      { userId: "killer", approvedKills: 1000 },
      { userId: "other", approvedKills: 900 },
      { userId: "third", approvedKills: 800 },
      { userId: "fourth", approvedKills: 700 },
      { userId: "fifth", approvedKills: 600 },
    ],
  });
  const noAverageKills = noAverage.profileRatingAxes.find((axis) => axis.axisName === "kills");
  assert.ok(noAverageKills.score <= 86);
  assert.doesNotMatch(noAverageKills.grade, /^S/);
  assert.match(noAverageKills.detailLine, /нет kills\/day/);

  const stale = buildProfileReadModel({
    now: "2026-05-16T12:00:00.000Z",
    guildId: "guild-1",
    userId: "killer",
    targetDisplayName: "Killer",
    isSelf: true,
    profile: { approvedKills: 1000, summary: { onboarding: { approvedKills: 1000 } } },
    approvedEntries: [
      { userId: "killer", approvedKills: 1000 },
      { userId: "other", approvedKills: 900 },
    ],
    recentKillChanges: [
      {
        userId: "killer",
        from: 500,
        to: 1000,
        fromAt: Date.parse("2026-04-10T00:00:00.000Z"),
        toAt: Date.parse("2026-04-20T00:00:00.000Z"),
      },
    ],
  });
  const staleKills = stale.profileRatingAxes.find((axis) => axis.axisName === "kills");
  assert.equal(staleKills.isLocked, true);
  assert.equal(staleKills.hiddenBecauseTooOld, true);
  assert.equal(staleKills.lockedPenaltyPercent, 40);
  assert.match(staleKills.cardLines.join("\n"), /старше 2 недель/);

  const outlier = buildProfileReadModel({
    now: "2026-05-16T12:00:00.000Z",
    guildId: "guild-1",
    userId: "killer",
    targetDisplayName: "Killer",
    isSelf: true,
    profile: { approvedKills: 3000, summary: { onboarding: { approvedKills: 3000 } } },
    approvedEntries: [
      { userId: "killer", approvedKills: 3000 },
      { userId: "other", approvedKills: 2800 },
    ],
    recentKillChanges: [
      {
        userId: "killer",
        from: 1000,
        to: 1480,
        fromAt: Date.parse("2026-05-14T00:00:00.000Z"),
        toAt: Date.parse("2026-05-15T00:00:00.000Z"),
      },
      {
        userId: "killer",
        from: 2800,
        to: 3000,
        fromAt: Date.parse("2026-05-10T00:00:00.000Z"),
        toAt: Date.parse("2026-05-16T00:00:00.000Z"),
      },
    ],
  });
  const outlierKills = outlier.profileRatingAxes.find((axis) => axis.axisName === "kills");
  assert.ok(outlierKills.ignoredOutlierWindows.length > 0);
  assert.match(outlierKills.detailLine, /480\/день не учтено/);
  assert.match(outlier.ratingDetailCards.kills.blocks.map((block) => block.lines.join("\n")).join("\n"), /480\/день[\s\S]*не учтено: выше лимита 400/);
});

test("profile rating explains all three packs and uses proof windows for Kills growth", () => {
  const readModel = buildProfileReadModel({
    now: "2026-05-16T12:00:00.000Z",
    guildId: "guild-1",
    userId: "killer",
    targetDisplayName: "Transparent Killer",
    isSelf: true,
    profile: {
      approvedKills: 6800,
      summary: {
        onboarding: { approvedKills: 6800 },
        activity: {
          messages7d: 420,
          sessions7d: 11,
          voiceDurationSeconds7d: 4.6 * 3600,
          effectiveVoiceHours7d: 4.6,
        },
        roblox: {
          hasVerifiedAccount: true,
          isTrackable: true,
          trackingState: "trackable",
          userId: "123",
          currentUsername: "KillerRb",
          jjsMinutes7d: 34.4 * 60,
          lastSeenInJjsAt: "2026-05-16T10:00:00.000Z",
        },
      },
      domains: {
        progress: {
          proofWindows: [
            { approvedKills: 6500, reviewedAt: "2026-05-01T00:00:00.000Z" },
            { approvedKills: 6620, reviewedAt: "2026-05-04T00:00:00.000Z" },
            { approvedKills: 6800, reviewedAt: "2026-05-10T00:00:00.000Z" },
          ],
        },
        seasonArchive: {
          weeklyRollups: [
            { weekKey: "2026-W20", endDayKey: "2026-05-16", coverage: { coveragePercent: 86 } },
          ],
        },
      },
    },
    approvedEntries: [
      { userId: "top", displayName: "GojoMain", approvedKills: 7200 },
      { userId: "killer", approvedKills: 6800 },
      { userId: "other", approvedKills: 5000 },
    ],
    populationProfiles: [
      {
        displayName: "Sasha",
        summary: {
          activity: { messages7d: 900, sessions7d: 14, voiceDurationSeconds7d: 6 * 3600, effectiveVoiceHours7d: 6 },
          roblox: { jjsMinutes7d: 70.3 * 60 },
        },
      },
    ],
  });

  for (const axis of readModel.profileRatingAxes) {
    assert.equal(axis.isLocked, false);
    assert.ok(axis.cardLines.length <= 5);
  }

  const kills = readModel.profileRatingAxes.find((axis) => axis.axisName === "kills");
  assert.equal(kills.proofWindowCount, 3);
  assert.equal(kills.recentChangeCount, 0);
  assert.equal(kills.killDayCoverage, 6);
  assert.equal(Math.round(kills.averageKillsPerDay), 30);
  assert.match(kills.cardLines.join("\n"), /30\/день/);
  assert.match(kills.detailLine, /proof 2/);
  assert.equal(kills.allKillWindows.length, 2);

  const killsDetail = readModel.ratingDetailCards.kills.blocks.map((block) => [block.title, ...block.lines].join("\n")).join("\n");
  assert.match(killsDetail, /Использованы 3 proof-снимка и 0 recent-изменений/);
  assert.match(killsDetail, /6\s?620 → 6\s?800|6620 → 6800/);
  assert.match(killsDetail, /учтено/);
  assert.match(killsDetail, /Игрок выше: GojoMain/);
  assert.match(killsDetail, /Покрыто 6\/6 kill-days/);
  assert.match(killsDetail, /До следующей буквы/);
  assert.match(killsDetail, /До минимального S\+/);
  assert.match(killsDetail, /старое окно/);

  const activityDetail = readModel.ratingDetailCards.activity.blocks.map((block) => [block.title, ...block.lines].join("\n")).join("\n");
  assert.match(activityDetail, /Период оценки: последние 7 дней/);
  assert.match(activityDetail, /Voice-планку задаёт Sasha/);
  assert.match(activityDetail, /не хватает|планка уже закрыта/);
  assert.match(activityDetail, /До минимального S\+/);
  assert.match(activityDetail, /Voice весит 45%/);
  assert.match(activityDetail, /chat-сессии 35%/);
  assert.match(activityDetail, /сообщения 20%/);
  assert.match(activityDetail, /[Пп]отолок/);

  const jjsDetail = readModel.ratingDetailCards.jjs.blocks.map((block) => [block.title, ...block.lines].join("\n")).join("\n");
  assert.match(jjsDetail, /За 7 дней/);
  assert.match(jjsDetail, /Сейчас топ: Sasha/);
  assert.match(jjsDetail, /не хватает .*ч/);
  assert.match(jjsDetail, /Потеря из-за покрытия/);
  assert.match(jjsDetail, /До минимального S\+/);
  assert.doesNotMatch(`${activityDetail}\n${killsDetail}\n${jjsDetail}`, /benchmark|coverage|fallback|raw score|rank score/);
});

test("profile read-model surfaces stale Roblox playtime sync telemetry", () => {
  const readModel = buildProfileReadModel({
    now: "2026-05-16T12:10:00.000Z",
    guildId: "guild-1",
    userId: "user-1",
    targetDisplayName: "Sync User",
    isSelf: true,
    robloxPlaytimePollMinutes: 2,
    robloxJobState: {
      status: "ok",
      lastFinishedAt: "2026-05-16T12:00:00.000Z",
      summary: { activeJjsUsers: 0 },
    },
    profile: {
      domains: {
        roblox: {
          username: "SyncRb",
          userId: "123",
          verificationStatus: "verified",
          playtime: {
            jjsMinutes30d: 60,
          },
        },
      },
    },
  });

  assert.equal(readModel.robloxSyncHealth.state, "stale");
  assert.match(readModel.heroLines.join("\n"), /JJS sync молчит/);
  assert.match(readModel.sections.activity[0].lines.join("\n"), /JJS sync молчит/);
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

  assert.equal(readModel.sections.progress[0].title, "⚔️ Сейчас");
  assert.equal(readModel.sections.progress[2].title, "🧾 Proof");
  assert.match(readModel.sections.progress[2].lines.join("\n"), /JJS-разрыв нельзя точно измерить|JJS baseline/);
  assert.doesNotMatch(readModel.sections.progress.map((section) => section.lines.join("\n")).join("\n"), /Есть смысл обновить kills|Практический прогресс/);
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
          isTrackable: true,
          trackingState: "trackable",
          userId: "123",
          currentUsername: "SashaRb",
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

  assert.equal(readModel.sections.progress[0].title, "⚔️ Сейчас");
  assert.equal(readModel.sections.progress[2].title, "🧾 Proof");
  assert.match(readModel.sections.progress[2].lines.join("\n"), /После proof: 13 ч JJS|После proof: .*JJS/);
  assert.match(readModel.sections.progress[4].lines.join("\n"), /Kills|JJS|Активность/);
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
          isTrackable: true,
          trackingState: "trackable",
          userId: "123",
          currentUsername: "SashaRb",
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

  const progressText = readModel.sections.progress.map((section) => section.lines.join("\n")).join("\n");

  assert.equal(readModel.sections.progress.find((section) => section.title === "🏅 Вклад"), undefined);
  assert.match(readModel.sections.progress[0].lines.join("\n"), /Kills ждут proof/);
  assert.equal(readModel.selfActionState.killsLabel, "Добавить kills");
  assert.match(progressText, /Proof|13 ч JJS|approved-срез/);
  assert.doesNotMatch(progressText, /Зарегистрировано: 0 kills/);
  assert.doesNotMatch(progressText, /До следующего tier|До milestone|🏅 Вклад/);
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

  assert.deepEqual(readModel.sections.progress.slice(0, 6).map((section) => section.title), ["⚔️ Сейчас", "📈 Темп", "🧾 Proof", "🗓️ Недели", "💡 До апа", "🏆 Прайм и рекорды"]);
  assert.match(readModel.sections.progress[0].lines.join("\n"), /Kills 4.?300/);
  assert.match(readModel.sections.progress[4].lines.join("\n"), /До tier 4: \+4.?700 kills/);
  assert.match(readModel.sections.progress[4].lines.join("\n"), /До milestone 20k: \+15.?700 kills/);
  assert.doesNotMatch(readModel.sections.progress.map((section) => section.title).join("\n"), /Практический прогресс|🏅 Вклад/);
});
