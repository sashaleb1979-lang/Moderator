"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildProfileReadModel } = require("../src/profile/model");

test("profile read-model composes derived sections, links, and verification facts", () => {
  const readModel = buildProfileReadModel({
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
          currentDisplayName: "Gojo The Strongest",
          previousUsername: "OldGojo",
          renameCount: 2,
          profileUrl: "https://www.roblox.com/users/123/profile",
          avatarUrl: "https://tr.rbxcdn.com/gojo-avatar.png",
          serverFriendsCount: 3,
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
    },
    targetAvatarUrl: "https://cdn.discordapp.com/avatars/user-1/profile.png",
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

  assert.equal(readModel.userId, "user-1");
  assert.equal(readModel.displayName, "Sasha");
  assert.equal(readModel.isSelf, false);
  assert.match(readModel.heroLines.join("\n"), /Сейчас: 120 kills .* тир 4 .* #2 по kills/);
  assert.match(readModel.heroLines.join("\n"), /Фокус: мейны Gojo .* Roblox GojoMain .* активность active/);
  assert.match(readModel.heroLines.join("\n"), /Готовность: JJS доступ открыт .* верификация verified .* Roblox связан .* tierlist есть .* ELO 145 \/ tier 2/);
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
  assert.match(readModel.sections.overview[1].lines.join("\n"), /JJS доступ: открыт с/);
  assert.match(readModel.sections.overview[1].lines.join("\n"), /Верификация: verified/);
  assert.match(readModel.sections.overview[1].lines.join("\n"), /Roblox-связка: подтверждена/);
  assert.match(readModel.sections.progress[0].lines.join("\n"), /Место по kills: #2/);
  assert.match(readModel.sections.progress[1].lines.join("\n"), /Прирост: \+20 kills/);
  assert.match(readModel.sections.progress[2].lines.join("\n"), /1\. 100 -> 120/);
  assert.match(readModel.sections.progress[2].lines.join("\n"), /2\. 80 -> 100/);
  assert.match(readModel.sections.progress[3].lines.join("\n"), /Последняя проверка:/);
  assert.match(readModel.sections.progress[4].lines.join("\n"), /Текущий рейтинг: ELO 145 \/ tier 2/);
  assert.match(readModel.sections.progress[4].lines.join("\n"), /Tierlist-заявка: есть/);
  assert.match(readModel.sections.activity[1].lines.join("\n"), /Сообщения 90д: 400/);
  assert.match(readModel.sections.social[0].lines.join("\n"), /Связка Roblox: подтверждена/);
  assert.match(readModel.sections.social[0].lines.join("\n"), /Аккаунт: GojoMain/);
  assert.match(readModel.sections.social[0].lines.join("\n"), /Display в Roblox: Gojo The Strongest/);
  assert.match(readModel.sections.social[0].lines.join("\n"), /Смен username Roblox: 2/);
  assert.match(readModel.sections.social[0].lines.join("\n"), /JJS минут 7д: 180/);
  assert.match(readModel.sections.social[0].lines.join("\n"), /JJS сессий всего: 9/);
  assert.match(readModel.sections.social[1].lines.join("\n"), /<@peer-1> • 210 мин вместе • 5 сесс\. • Roblox-друг/);
  assert.match(readModel.sections.social[1].lines.join("\n"), /<@peer-2> • 140 мин вместе • 3 сесс\. • частый non-friend/);
  assert.match(readModel.sections.social[2].lines.join("\n"), /Гайды по мейнам: 1\/1/);
  assert.match(readModel.sections.social[2].lines.join("\n"), /1\. Gojo — гайд доступен по кнопке/);
  assert.match(readModel.sections.social[2].lines.join("\n"), /Основной tierlist-пик: Gojo • входит в список мейнов/);
  assert.match(readModel.sections.social[2].lines.join("\n"), /Общие техи: доступны по кнопке\./);
  assert.equal(readModel.comboLinks[0].label, "Gojo");
  assert.equal(readModel.comboLinks[0].buttonLabel, "Гайд: Gojo");
  assert.equal(readModel.robloxProfileUrl, "https://www.roblox.com/users/123/profile");
  assert.ok(readModel.verificationLines.some((line) => /verified/.test(line)));
  assert.equal(readModel.emptyStateNote, null);
});

test("profile read-model marks empty profiles without fabricating data sections", () => {
  const readModel = buildProfileReadModel({
    guildId: "guild-1",
    userId: "user-1",
    targetDisplayName: "New User",
    isSelf: true,
  });

  assert.equal(readModel.displayName, "New User");
  assert.equal(readModel.isSelf, true);
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