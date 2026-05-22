"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { MessageFlags } = require("discord.js");

const {
  PROFILE_VIEWS,
  buildProfileHelperMessagePayload,
  buildProfilePayload,
} = require("../src/profile/view");

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

function getProfileContainer(payload) {
  const container = payload.components[0].toJSON();
  return {
    container,
    textDisplays: container.components.filter((component) => component.type === 10),
    actionRows: container.components.filter((component) => component.type === 1),
  };
}

test("profile helper message payload builds one private-open button", () => {
  const payload = buildProfileHelperMessagePayload({
    requesterUserId: "requester",
    targetUserId: "target",
    isSelf: false,
    targetLabel: "профиль target",
  });

  assert.match(payload.content, /приватно/i);
  assert.equal(payload.components.length, 1);
  assert.equal(payload.components[0].toJSON().components[0].custom_id, "profile_open:requester:target");
});

test("profile payload renders overview, activity, rankings, roblox, and link buttons", () => {
  const payload = buildProfilePayload({
    now: "2026-05-16T12:00:00.000Z",
    guildId: "guild-1",
    userId: "user-1",
    requesterUserId: "requester",
    targetDisplayName: "Sasha",
    targetAvatarUrl: "https://cdn.discordapp.com/avatars/user-1/profile.png",
    isSelf: false,
    roleMentions: ["<@&role-1>", "<@&role-2>"],
    profile: {
      approvedKills: 120,
      killTier: 4,
      accessGrantedAt: "2026-05-01T10:00:00.000Z",
      mainCharacterIds: ["gojo"],
      mainCharacterLabels: ["Gojo"],
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
        seasonArchive: {
          snapshots: buildSeasonArchiveSnapshots({
            startDayKey: "2026-05-01",
            dayCount: 12,
            peak7Index: 11,
          }),
        },
      },
      summary: {
        preferredDisplayName: "Sasha",
        onboarding: { approvedKills: 120, killTier: 4 },
        activity: {
          appliedActivityRoleKey: "active",
          activityScore: 77,
          messages7d: 35,
          messages30d: 210,
          sessions7d: 8,
          sessions30d: 25,
          activeDays30d: 12,
          daysSinceGuildJoin: 240,
          lastSeenAt: "2026-05-10T12:00:00.000Z",
        },
        elo: {
          currentElo: 145,
          currentTier: 2,
          lastSubmissionStatus: "approved",
        },
        tierlist: {
          hasSubmission: true,
          mainName: "Gojo",
          lockUntil: "2026-05-20T12:00:00.000Z",
          influenceMultiplier: 1.2,
        },
        roblox: {
          hasVerifiedAccount: true,
          isTrackable: true,
          trackingState: "trackable",
          userId: "123",
          currentUsername: "GojoMain",
          profileUrl: "https://www.roblox.com/users/123/profile",
          avatarUrl: "https://tr.rbxcdn.com/gojo-avatar.png",
          serverFriendsCount: 3,
          jjsMinutes7d: 180,
          sessionCount: 9,
          nonFriendPeerCount: 4,
          jjsMinutes30d: 420,
          frequentNonFriendCount: 1,
          lastSeenInJjsAt: "2026-05-11T09:00:00.000Z",
          topCoPlayPeers: [
            {
              peerUserId: "peer-1",
              minutesTogether: 210,
              sessionsTogether: 5,
              isRobloxFriend: true,
              lastSeenTogetherAt: "2026-05-12T08:00:00.000Z",
            },
          ],
        },
        verification: {
          status: "verified",
          decision: "approved",
          reviewedAt: "2026-05-02T12:00:00.000Z",
          oauthAvatarUrl: "https://cdn.discordapp.com/oauth-avatar.png",
        },
      },
    },
    latestSubmission: {
      reviewedAt: "2026-05-02T12:00:00.000Z",
    },
    eloProfile: {
      currentElo: 145,
      currentTier: 2,
      lastSubmissionStatus: "approved",
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
  });

  assert.equal(payload.flags, MessageFlags.IsComponentsV2);
  assert.equal(payload.components.length, 1);
  const { container, textDisplays, actionRows } = getProfileContainer(payload);
  assert.equal(container.type, 17);
  assert.ok(textDisplays.some((component) => /# Профиль/.test(component.content)));
  assert.match(JSON.stringify(container), /### ⚡ Главное/);
  assert.match(JSON.stringify(container), /🔥 Рейтинг .* \d+\/100/);
  assert.match(JSON.stringify(container), /Main: Gojo/);
  assert.ok(textDisplays.some((component) => /### ⚡ Главное/.test(component.content) && /Игрок: <@user-1>/.test(component.content) && /Подтверждённые kills: 120/.test(component.content)));
  assert.ok(textDisplays.some((component) => /### 🔥 Оценка профиля/.test(component.content) && /Рейтинг профиля:/.test(component.content) && /Учёт данных:/.test(component.content) && /учёт \d+%/.test(component.content)));
  assert.ok(textDisplays.some((component) => /### 🎭 Мейны и места/.test(component.content) && /Gojo: .*#2\/2 среди Gojo-main .* до апа: \+81 kills до #1/.test(component.content)));
  assert.ok(textDisplays.some((component) => /### 🧩 Ядро профиля/.test(component.content) && /Ядро пиков: Gojo-main/.test(component.content) && /Серверный контур: форма .* рост .* стабильность .* #2 по kills .* ELO 145 \/ tier 2/.test(component.content) && /Игровая связка: чаще всего с <@peer-1>/.test(component.content)));
  assert.doesNotMatch(JSON.stringify(container), /Гайд-контур|### 📚 Мейны|### 📚 Мейны и гайды|гайд доступен по кнопке/);
  assert.doesNotMatch(JSON.stringify(container), /### Ключевые факты/);
  assert.doesNotMatch(JSON.stringify(container), /### 🛡️ Готовность|### 🛡️ Готовность к вару/);
  assert.doesNotMatch(JSON.stringify(container), /Буквы|confidence|source|debuff|Discord last seen|proof freshness|baseline|fresh|XP|Ур\./);
  assert.ok(textDisplays.some((component) => /### Верификация/.test(component.content) && /verified/.test(component.content)));
  assert.match(JSON.stringify(container), /https:\/\/cdn\.discordapp\.com\/avatars\/user-1\/profile\.png/);
  assert.equal(actionRows.length, 2);
  const navButtons = actionRows[0].components;
  assert.deepEqual(navButtons.map((button) => button.label), PROFILE_VIEWS.map((view) => ({
    overview: "Обзор",
    activity: "Активность",
    progress: "Прогресс",
    social: "Соц",
  })[view]));
  assert.equal(navButtons[0].disabled, true);
  const buttons = actionRows[1].components;
  assert.ok(buttons.some((button) => button.label === "Roblox профиль"));
  assert.ok(buttons.some((button) => button.label === "JJS Wiki: персонажи"));
  assert.ok(buttons.length <= 2);
  assert.doesNotMatch(JSON.stringify(container), /"label":"Гайд: Gojo"|"label":"JJS Wiki: Gojo"|"label":"Общие техи"/);
});

test("profile payload switches sections by requested view", () => {
  const payload = buildProfilePayload({
    now: "2026-05-16T12:00:00.000Z",
    guildId: "guild-1",
    userId: "user-1",
    requesterUserId: "requester",
    targetDisplayName: "Sasha",
    view: "activity",
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
        seasonArchive: {
          snapshots: buildSeasonArchiveSnapshots({
            startDayKey: "2026-05-01",
            dayCount: 12,
            peak7Index: 11,
          }),
        },
      },
      summary: {
        preferredDisplayName: "Sasha",
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
          messages7d: 35,
          messages30d: 210,
          messages90d: 400,
          sessions7d: 8,
          sessions30d: 25,
          sessions90d: 40,
          activeDays7d: 4,
          activeDays30d: 12,
          activeWatchedChannels30d: 5,
          daysAbsent: 2,
          roleEligibilityStatus: "eligible",
        },
        roblox: {
          hasVerifiedAccount: true,
          isTrackable: true,
          trackingState: "trackable",
          userId: "123",
          currentUsername: "GojoMain",
          jjsMinutes7d: 180,
          jjsMinutes30d: 420,
        },
      },
    },
  });

  const { textDisplays } = getProfileContainer(payload);
  assert.ok(textDisplays.some((component) => /\*\*Активность\*\*/.test(component.content)));
  assert.ok(textDisplays.some((component) => /### 📊 Итог активности/.test(component.content) && /Режим: JJS 3 ч\/7д .* 7 ч\/30д .* чат 210 msg .* voice 2,5 ч/.test(component.content) && /Активность: active/.test(component.content)));
  assert.ok(textDisplays.some((component) => /### 🕒 Prime time МСК/.test(component.content) && /Чаще всего играет с 19:00 до 23:00 МСК .* окно 5 ч/.test(component.content) && /Пиковый час: 20:00/.test(component.content)));
  assert.ok(textDisplays.some((component) => /### 🏆 Сезон/.test(component.content) && /Сезон откроется после 3 недель истории/.test(component.content)));
  assert.ok(textDisplays.some((component) => /### 🧭 Где живёт игрок/.test(component.content) && /Discord vs Roblox/.test(component.content)));
  assert.ok(!textDisplays.some((component) => /### 🔎 Детали activity/.test(component.content)));
});

test("profile payload renders enriched progress and social sections", () => {
  const progressPayload = buildProfilePayload({
    guildId: "guild-1",
    userId: "user-1",
    requesterUserId: "requester",
    targetDisplayName: "Sasha",
    view: "progress",
    profile: {
      approvedKills: 120,
      killTier: 4,
      accessGrantedAt: "2026-05-01T10:00:00.000Z",
      nonGgsAccessGrantedAt: "2026-05-03T10:00:00.000Z",
      mainCharacterIds: ["gojo"],
      mainCharacterLabels: ["Gojo"],
      summary: {
        preferredDisplayName: "Sasha",
        onboarding: { approvedKills: 120, killTier: 4 },
        elo: {
          currentElo: 145,
          currentTier: 2,
          lastSubmissionStatus: "approved",
        },
        tierlist: {
          hasSubmission: true,
          mainName: "Gojo",
          lockUntil: "2026-05-20T12:00:00.000Z",
          influenceMultiplier: 1.2,
        },
        roblox: {
          hasVerifiedAccount: true,
          isTrackable: true,
          trackingState: "trackable",
          userId: "123",
          currentUsername: "GojoMain",
          profileUrl: "https://www.roblox.com/users/123/profile",
        },
      },
    },
    latestSubmission: {
      reviewedAt: "2026-05-02T12:00:00.000Z",
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
  });

  const progressDisplays = getProfileContainer(progressPayload).textDisplays;
  assert.ok(progressDisplays.some((component) => /\*\*Прогресс\*\*/.test(component.content)));
  assert.ok(progressDisplays.some((component) => /### 📈 Последний рост по kills/.test(component.content) && /Прирост: \+20 kills/.test(component.content)));
  assert.ok(progressDisplays.some((component) => /### 🧾 История approved ростов/.test(component.content) && /1\. 100 -> 120/.test(component.content) && /2\. 80 -> 100/.test(component.content)));
  assert.ok(progressDisplays.some((component) => /### 📬 Заявки и проверки/.test(component.content) && /Последняя проверка:/.test(component.content)));
  assert.ok(progressDisplays.some((component) => /### 📊 ELO и Tierlist/.test(component.content) && /Текущий рейтинг: ELO 145 \/ tier 2/.test(component.content) && /Tierlist-заявка: есть/.test(component.content)));

  const socialEvolutionPayload = buildProfilePayload({
    guildId: "guild-1",
    userId: "user-1",
    requesterUserId: "requester",
    targetDisplayName: "Sasha",
    view: "social",
    profile: {
      summary: {
        preferredDisplayName: "Sasha",
        roblox: {
          hasVerifiedAccount: true,
          currentUsername: "GojoMain",
          serverFriendsCount: 3,
          topCoPlayPeers: [
            {
              peerUserId: "peer-1",
              minutesTogether: 210,
              sessionsTogether: 5,
              isRobloxFriend: true,
            },
          ],
        },
      },
      domains: {
        seasonArchive: {
          snapshots: buildSeasonArchiveSnapshots({
            startDayKey: "2026-05-01",
            dayCount: 12,
            peak7Index: 11,
          }),
        },
      },
    },
  });

  const socialSectionDisplays = getProfileContainer(socialEvolutionPayload).textDisplays;
  assert.ok(socialSectionDisplays.some((component) => /\*\*Соц\*\*/.test(component.content)));
  assert.ok(socialSectionDisplays.some((component) => /### 📈 Социальная эволюция/.test(component.content) && /Соц-архив: 12 дневных срезов/.test(component.content) && /Игровой круг: 1 -> 3 частых напарн\./.test(component.content)));

  const selfProgressPayload = buildProfilePayload({
    now: "2026-05-16T12:00:00.000Z",
    guildId: "guild-1",
    userId: "user-1",
    requesterUserId: "user-1",
    targetDisplayName: "Sasha",
    isSelf: true,
    view: "progress",
    profile: {
      approvedKills: 4300,
      killTier: 3,
      mainCharacterIds: ["gojo"],
      mainCharacterLabels: ["Gojo"],
      summary: {
        preferredDisplayName: "Sasha",
        onboarding: { approvedKills: 4300, killTier: 3 },
        elo: {
          currentElo: 145,
          currentTier: 2,
        },
        roblox: {
          hasVerifiedAccount: true,
          isTrackable: true,
          trackingState: "trackable",
          userId: "123",
          currentUsername: "GojoMain",
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

  const selfProgressContainer = getProfileContainer(selfProgressPayload);
  const selfProgressDisplays = selfProgressContainer.textDisplays;
  assert.ok(selfProgressDisplays.some((component) => /### 💪 Практический прогресс/.test(component.content) && /С последнего рега: 36 ч по времени .* 6 ч JJS/.test(component.content) && /Сравнение окон: последний ап 60 kills\/ч/.test(component.content) && /Динамика: темп ускорился относительно прошлого окна/.test(component.content) && /Средний темп за отслеженный период: 53,3 kills\/ч JJS/.test(component.content) && /До следующего tier: 2.?700 kills/.test(component.content) && /Фокус: темп выше прошлого окна/.test(component.content)));
  assert.deepEqual(selfProgressContainer.actionRows[1].components.map((button) => button.label), [
    "⚔️ Обновить kills",
    "🎭 Сменить мейнов",
    "🔗 Обновить Roblox",
    "📈 Обновить ELO",
    "🏆 Оценить персонажей по скилу",
  ]);

  const socialPayload = buildProfilePayload({
    now: "2026-05-16T12:00:00.000Z",
    guildId: "guild-1",
    userId: "user-1",
    requesterUserId: "requester",
    targetDisplayName: "Sasha",
    view: "social",
    targetAvatarUrl: "https://cdn.discordapp.com/avatars/user-1/profile.png",
    characterStats: [{ id: "gojo", main: "Gojo", roleId: "role-gojo" }],
    profile: {
      accessGrantedAt: "2026-05-01T10:00:00.000Z",
      nonGgsAccessGrantedAt: "2026-05-03T10:00:00.000Z",
      mainCharacterIds: ["gojo"],
      mainCharacterLabels: ["Gojo"],
      summary: {
        preferredDisplayName: "Sasha",
        roblox: {
          hasVerifiedAccount: true,
          currentUsername: "GojoMain",
          userId: "123",
          profileUrl: "https://www.roblox.com/users/123/profile",
          avatarUrl: "https://tr.rbxcdn.com/gojo-avatar.png",
          serverFriendsCount: 3,
          serverFriendsUserIds: ["rbx-friend-1", "rbx-friend-2", "rbx-friend-3"],
          serverFriendsComputedAt: "2026-05-16T08:00:00.000Z",
          topCoPlayPeers: [
            {
              peerUserId: "peer-1",
              minutesTogether: 210,
              sessionsTogether: 5,
              isRobloxFriend: true,
              lastSeenTogetherAt: "2026-05-12T08:00:00.000Z",
            },
          ],
        },
        verification: {
          oauthAvatarUrl: "https://cdn.discordapp.com/oauth-avatar.png",
        },
        social: {
          suggestionCount: 2,
          suggestions: [
            {
              peerUserId: "peer-7",
              peerDisplayName: "Todo",
              peerRobloxUsername: "TodoRb",
              peerHasVerifiedRoblox: true,
              minutesTogether: 70,
              sharedJjsSessionCount: 2,
              sourceComputedAt: "2026-05-16T10:00:00.000Z",
            },
          ],
        },
      },
      domains: {
        social: {
          suggestions: [
            {
              peerUserId: "peer-7",
              peerDisplayName: "Todo",
              peerRobloxUsername: "TodoRb",
              peerHasVerifiedRoblox: true,
              minutesTogether: 70,
              sharedJjsSessionCount: 2,
              sourceComputedAt: "2026-05-16T10:00:00.000Z",
            },
          ],
        },
      },
    },
    comboGuideState: {
      generalTechsThreadId: "general-thread",
      characters: [{ id: "gojo", name: "Gojo", threadId: "thread-1" }],
    },
    approvedEntries: [
      { userId: "user-2", displayName: "Top", approvedKills: 200, mains: ["Gojo"] },
      { userId: "user-1", displayName: "Sasha", approvedKills: 120, mains: ["Gojo"] },
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

  const socialViewDisplays = getProfileContainer(socialPayload).textDisplays;
  assert.ok(socialViewDisplays.some((component) => /\*\*Соц\*\*/.test(component.content)));
  assert.ok(socialViewDisplays.some((component) => /### 🤝 Roblox и соц/.test(component.content) && /Roblox-связка: подтверждена/.test(component.content)));
  assert.ok(socialViewDisplays.some((component) => /### 🤝 Roblox-друзья на сервере/.test(component.content) && /Roblox-друзей на сервере: 3 .* видимых профилей: 2 .* verified: 2 .* активны 7д: 2 .* играли в JJS 7д: 1/.test(component.content)));
  assert.ok(socialViewDisplays.some((component) => /### 🫂 Кто из друзей уже здесь/.test(component.content) && /1\. <@friend-1> .* Friend One .* Roblox FriendOneRb .* verified Roblox .* JJS 7д 2,6 ч .* activity active/.test(component.content) && /2\. <@friend-2> .* Friend Two .* Roblox FriendTwoRb .* verified Roblox .* 4 msg 7д/.test(component.content)));
  assert.ok(socialViewDisplays.some((component) => /### 🎮 С кем чаще всего играет/.test(component.content) && /<@peer-1> • 3,5 ч вместе • 5 сесс\. • Roblox-друг/.test(component.content)));
  assert.ok(socialViewDisplays.some((component) => /### 🕵️ Скрытый круг/.test(component.content) && /1 кандидата по частым пересечениям в JJS/.test(component.content) && /<@peer-7> .* Todo .* Roblox TodoRb .* 1,1 ч вместе .* 2 общ\. сесс\. .* verified Roblox/.test(component.content)));
  assert.ok(!socialViewDisplays.some((component) => /### 📚 Мейны и гайды|гайд доступен по кнопке|Гайды по мейнам/.test(component.content)));
  assert.match(JSON.stringify(getProfileContainer(socialPayload).container), /https:\/\/tr\.rbxcdn\.com\/gojo-avatar\.png/);
  assert.match(JSON.stringify(getProfileContainer(socialPayload).container), /https:\/\/cdn\.discordapp\.com\/oauth-avatar\.png/);
});

test("profile payload handles empty profiles gracefully", () => {
  const payload = buildProfilePayload({
    guildId: "guild-1",
    userId: "user-1",
    requesterUserId: "requester",
    targetDisplayName: "New User",
    isSelf: true,
  });

  const { textDisplays, actionRows } = getProfileContainer(payload);
  assert.ok(textDisplays.some((component) => /### ⚡ Главное/.test(component.content) && /Рейтинг профиля/.test(component.content)));
  assert.ok(textDisplays.some((component) => /# Твой профиль/.test(component.content)));
  assert.ok(textDisplays.some((component) => /### ⚡ Главное/.test(component.content) && /ещё не заполнен/i.test(component.content)));
  assert.ok(textDisplays.some((component) => /### 🔥 Оценка профиля/.test(component.content) && /откроется после данных/i.test(component.content)));
  assert.ok(!textDisplays.some((component) => /### 🛡️ Готовность/.test(component.content)));
  assert.ok(!textDisplays.some((component) => /### 📈 ELO submit/.test(component.content)));
  assert.ok(textDisplays.some((component) => /После онбординга профиль заполнится автоматически/i.test(component.content)));
  assert.deepEqual(actionRows[1].components.map((button) => button.label), [
    "⚔️ Добавить kills",
    "🎭 Выбрать мейнов",
    "🔗 Привязать Roblox",
    "📈 ELO: текст + скрин",
    "🏆 Оценить персонажей по скилу",
  ]);
});

test("profile payload keeps bottom links limited to canonical profile/wiki links", () => {
  const payload = buildProfilePayload({
    requesterUserId: "requester",
    userId: "user-1",
    readModel: {
      userId: "user-1",
      displayName: "Sasha",
      isSelf: false,
      comboLinks: [
        { label: "One", buttonLabel: "Кнопка 1", url: "https://example.com/1" },
        { label: "Two", buttonLabel: "Кнопка 2", url: "https://example.com/2" },
        { label: "Three", buttonLabel: "Кнопка 3", url: "https://example.com/3" },
        { label: "Four", buttonLabel: "Кнопка 4", url: "https://example.com/4" },
        { label: "Five", buttonLabel: "Кнопка 5", url: "https://example.com/5" },
        { label: "Six", buttonLabel: "Кнопка 6", url: "https://example.com/6" },
      ],
      primaryAvatarUrl: null,
      primaryAvatarDescription: null,
      mediaGalleryItems: [],
      robloxProfileUrl: "https://www.roblox.com/users/123/profile",
      sections: {
        overview: [{ title: "Обзор", lines: ["ok"] }],
      },
      verificationLines: null,
      emptyStateNote: null,
    },
  });

  const { actionRows } = getProfileContainer(payload);
  assert.equal(actionRows.length, 2);
  assert.deepEqual(actionRows[1].components.map((button) => button.label), ["Roblox профиль"]);
});

test("profile payload supports canonical compact-card mode without nav and self actions", () => {
  const payload = buildProfilePayload({
    requesterUserId: "user-1",
    userId: "user-1",
    readModel: {
      userId: "user-1",
      displayName: "Sasha",
      isSelf: true,
      displayMode: "compact-card",
      comboLinks: [
        { label: "Gojo", buttonLabel: "Гайд: Gojo", url: "https://example.com/gojo" },
      ],
      heroTitle: "Кто ты сейчас",
      heroLines: ["Текст-тирлист: Форма B+"],
      primaryAvatarUrl: null,
      primaryAvatarDescription: null,
      mediaGalleryItems: [],
      robloxProfileUrl: "https://www.roblox.com/users/123/profile",
      sections: {
        compact: [
          { title: "Моя карточка", lines: ["Игрок: <@user-1>", "ELO: 145 / tier 2"] },
          { title: "Готовность", lines: ["JJS доступ: открыт"] },
        ],
      },
      verificationLines: ["Статус: verified"],
      emptyStateNote: null,
      selfActionState: {
        killsLabel: "Обновить kills",
      },
    },
  });

  const { textDisplays, actionRows, container } = getProfileContainer(payload);
  assert.ok(textDisplays.some((component) => /# Моя карточка/.test(component.content)));
  assert.ok(textDisplays.some((component) => /### Моя карточка/.test(component.content) && /ELO: 145 \/ tier 2/.test(component.content)));
  assert.ok(textDisplays.some((component) => /### Готовность/.test(component.content) && /JJS доступ: открыт/.test(component.content)));
  assert.equal(actionRows.length, 0);
  assert.doesNotMatch(JSON.stringify(container), /Roblox профиль/);
  assert.doesNotMatch(JSON.stringify(container), /Гайд: Gojo/);
});
