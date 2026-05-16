"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { MessageFlags } = require("discord.js");

const {
  PROFILE_VIEWS,
  buildProfileHelperMessagePayload,
  buildProfilePayload,
} = require("../src/profile/view");

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
          currentUsername: "GojoMain",
          profileUrl: "https://www.roblox.com/users/123/profile",
          avatarUrl: "https://tr.rbxcdn.com/gojo-avatar.png",
          serverFriendsCount: 3,
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
  });

  assert.equal(payload.flags, MessageFlags.IsComponentsV2);
  assert.equal(payload.components.length, 1);
  const { container, textDisplays, actionRows } = getProfileContainer(payload);
  assert.equal(container.type, 17);
  assert.ok(textDisplays.some((component) => /# Профиль/.test(component.content)));
  assert.match(JSON.stringify(container), /### Быстрый статус/);
  assert.match(JSON.stringify(container), /Сейчас: 120 kills/);
  assert.match(JSON.stringify(container), /Готовность: JJS доступ открыт/);
  assert.ok(textDisplays.some((component) => /### Обзор/.test(component.content) && /Игрок: <@user-1>/.test(component.content) && /Подтверждённые kills: 120/.test(component.content) && /ELO: 145 \/ tier 2/.test(component.content)));
  assert.doesNotMatch(JSON.stringify(container), /### Ключевые факты/);
  assert.ok(textDisplays.some((component) => /### Готовность/.test(component.content) && /JJS доступ: открыт с/.test(component.content) && /Верификация: verified/.test(component.content) && /Roblox-связка: подтверждена/.test(component.content)));
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
  const buttons = actionRows[1].components;
  assert.ok(buttons.some((button) => button.label === "Гайд: Gojo"));
  assert.ok(buttons.some((button) => button.label === "Общие техи"));
  assert.ok(buttons.some((button) => button.label === "Roblox профиль"));
});

test("profile payload switches sections by requested view", () => {
  const payload = buildProfilePayload({
    guildId: "guild-1",
    userId: "user-1",
    requesterUserId: "requester",
    targetDisplayName: "Sasha",
    view: "activity",
    profile: {
      summary: {
        preferredDisplayName: "Sasha",
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
      },
    },
  });

  const { textDisplays } = getProfileContainer(payload);
  assert.ok(textDisplays.some((component) => /\*\*Секция:\*\* Активность/.test(component.content)));
  assert.ok(textDisplays.some((component) => /### Активность/.test(component.content) && /Бакет: active/.test(component.content)));
  assert.ok(textDisplays.some((component) => /### Детали activity/.test(component.content) && /Сообщения 90д: 400/.test(component.content)));
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
          currentUsername: "GojoMain",
          profileUrl: "https://www.roblox.com/users/123/profile",
        },
      },
    },
    latestSubmission: {
      reviewedAt: "2026-05-02T12:00:00.000Z",
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
  });

  const progressDisplays = getProfileContainer(progressPayload).textDisplays;
  assert.ok(progressDisplays.some((component) => /\*\*Секция:\*\* Прогресс/.test(component.content)));
  assert.ok(progressDisplays.some((component) => /### Последний рост по kills/.test(component.content) && /Прирост: \+20 kills/.test(component.content)));
  assert.ok(progressDisplays.some((component) => /### История approved ростов/.test(component.content) && /1\. 100 -> 120/.test(component.content) && /2\. 80 -> 100/.test(component.content)));
  assert.ok(progressDisplays.some((component) => /### Заявки и проверки/.test(component.content) && /Последняя проверка:/.test(component.content)));
  assert.ok(progressDisplays.some((component) => /### ELO и Tierlist/.test(component.content) && /Текущий рейтинг: ELO 145 \/ tier 2/.test(component.content) && /Tierlist-заявка: есть/.test(component.content)));

  const socialPayload = buildProfilePayload({
    guildId: "guild-1",
    userId: "user-1",
    requesterUserId: "requester",
    targetDisplayName: "Sasha",
    view: "social",
    targetAvatarUrl: "https://cdn.discordapp.com/avatars/user-1/profile.png",
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
          profileUrl: "https://www.roblox.com/users/123/profile",
          avatarUrl: "https://tr.rbxcdn.com/gojo-avatar.png",
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
      },
    },
    comboGuideState: {
      generalTechsThreadId: "general-thread",
      characters: [{ id: "gojo", name: "Gojo", threadId: "thread-1" }],
    },
  });

  const socialDisplays = getProfileContainer(socialPayload).textDisplays;
  assert.ok(socialDisplays.some((component) => /\*\*Секция:\*\* Соц/.test(component.content)));
  assert.ok(socialDisplays.some((component) => /### Roblox и соц/.test(component.content) && /Связка Roblox: подтверждена/.test(component.content)));
  assert.ok(socialDisplays.some((component) => /### С кем чаще всего играет/.test(component.content) && /<@peer-1> • 210 мин вместе • 5 сесс\. • Roblox-друг/.test(component.content)));
  assert.ok(socialDisplays.some((component) => /### Мейны и гайды/.test(component.content) && /Основные персонажи: Gojo/.test(component.content) && /Гайды по мейнам: 1\/1/.test(component.content) && /1\. Gojo — гайд доступен по кнопке/.test(component.content) && /Общие техи: доступны по кнопке\./.test(component.content)));
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
  assert.ok(textDisplays.some((component) => /### Быстрый статус/.test(component.content) && /Готовность: JJS доступ не выдан/i.test(component.content)));
  assert.ok(textDisplays.some((component) => /# Твой профиль/.test(component.content)));
  assert.ok(textDisplays.some((component) => /### Обзор/.test(component.content) && /ещё не заполнен/i.test(component.content)));
  assert.ok(textDisplays.some((component) => /### Готовность/.test(component.content) && /JJS доступ: пока не выдан/i.test(component.content) && /Верификация: не начата/i.test(component.content)));
  assert.ok(textDisplays.some((component) => /### ELO/.test(component.content) && /Сначала отправь текст с числом ELO/i.test(component.content) && /Потом следующим сообщением кинь скрин/i.test(component.content)));
  assert.ok(textDisplays.some((component) => /После онбординга профиль заполнится автоматически/i.test(component.content)));
  assert.deepEqual(actionRows[1].components.map((button) => button.label), [
    "Добавить kills",
    "Сменить мейнов",
    "Привязать Roblox",
    "ELO: текст + скрин",
    "Оценить персонажей",
  ]);
});

test("profile payload splits many link buttons into multiple rows", () => {
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
  assert.equal(actionRows.length, 3);
  assert.deepEqual(actionRows[1].components.map((button) => button.label), ["Кнопка 1", "Кнопка 2", "Кнопка 3", "Кнопка 4", "Кнопка 5"]);
  assert.deepEqual(actionRows[2].components.map((button) => button.label), ["Кнопка 6", "Roblox профиль"]);
});