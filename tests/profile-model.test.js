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
          mainName: "Gojo",
          influenceMultiplier: 1.2,
        },
        roblox: {
          hasVerifiedAccount: true,
          currentUsername: "GojoMain",
          profileUrl: "https://www.roblox.com/users/123/profile",
          serverFriendsCount: 3,
          jjsMinutes30d: 420,
          frequentNonFriendCount: 1,
          lastSeenInJjsAt: "2026-05-11T09:00:00.000Z",
        },
        verification: {
          status: "verified",
          decision: "approved",
          reviewedAt: "2026-05-02T12:00:00.000Z",
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

  assert.equal(readModel.userId, "user-1");
  assert.equal(readModel.displayName, "Sasha");
  assert.equal(readModel.isSelf, false);
  assert.match(readModel.sections.overview[0].lines.join("\n"), /Kills: 120/);
  assert.match(readModel.sections.progress[0].lines.join("\n"), /Место по kills: #2/);
  assert.match(readModel.sections.progress[1].lines.join("\n"), /ELO: 145/);
  assert.match(readModel.sections.activity[1].lines.join("\n"), /Сообщения 90д: 400/);
  assert.match(readModel.sections.social[0].lines.join("\n"), /GojoMain/);
  assert.equal(readModel.comboLinks[0].label, "Gojo");
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
  assert.match(readModel.sections.overview[0].lines.join("\n"), /Профиль ещё не заполнен/i);
  assert.equal(readModel.verificationLines, null);
  assert.match(readModel.emptyStateNote, /После онбординга профиль заполнится автоматически/i);
  assert.deepEqual(readModel.comboLinks, []);
  assert.equal(readModel.robloxProfileUrl, null);
});