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
          mainName: "Gojo",
          influenceMultiplier: 1.2,
        },
        roblox: {
          hasVerifiedAccount: true,
          currentUsername: "GojoMain",
          profileUrl: "https://www.roblox.com/users/123/profile",
          avatarUrl: "https://tr.rbxcdn.com/gojo-avatar.png",
          serverFriendsCount: 3,
          jjsMinutes30d: 420,
          frequentNonFriendCount: 1,
          lastSeenInJjsAt: "2026-05-11T09:00:00.000Z",
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
  assert.ok(textDisplays.some((component) => /### Обзор/.test(component.content) && /Kills: 120/.test(component.content)));
  assert.ok(textDisplays.some((component) => /### Verification/.test(component.content) && /verified/.test(component.content)));
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
  assert.ok(buttons.some((button) => button.label === "Техи: Gojo"));
  assert.ok(buttons.some((button) => button.label === "Roblox"));
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
  assert.ok(textDisplays.some((component) => /### Активность/.test(component.content) && /Bucket: active/.test(component.content)));
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
          mainName: "Gojo",
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
    comboGuideState: {
      generalTechsThreadId: "general-thread",
      characters: [{ id: "gojo", name: "Gojo", threadId: "thread-1" }],
    },
  });

  const progressDisplays = getProfileContainer(progressPayload).textDisplays;
  assert.ok(progressDisplays.some((component) => /\*\*Секция:\*\* Прогресс/.test(component.content)));
  assert.ok(progressDisplays.some((component) => /### Последний рост по kills/.test(component.content) && /Прирост: \+20 kills/.test(component.content)));
  assert.ok(progressDisplays.some((component) => /### Заявки и проверки/.test(component.content) && /Последняя проверка:/.test(component.content)));

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
  assert.ok(socialDisplays.some((component) => /### Мейны и гайды/.test(component.content) && /Основные персонажи: Gojo/.test(component.content) && /Доступные гайды: Gojo, Общие техи/.test(component.content)));
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

  const { textDisplays } = getProfileContainer(payload);
  assert.ok(textDisplays.some((component) => /# Твой профиль/.test(component.content)));
  assert.ok(textDisplays.some((component) => /### Обзор/.test(component.content) && /ещё не заполнен/i.test(component.content)));
  assert.ok(textDisplays.some((component) => /После онбординга профиль заполнится автоматически/i.test(component.content)));
});