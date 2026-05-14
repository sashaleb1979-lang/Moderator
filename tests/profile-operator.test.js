"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { MessageFlags } = require("discord.js");

const { buildProfileNavCustomId, buildProfileOpenCustomId } = require("../src/profile/entry");
const { collectUserRecentKillChangeHistory } = require("../src/onboard/tierlist-ranking");
const { createProfileOperator } = require("../src/profile/operator");

function makeMember(roleIds = [], { userId = "user-1", username = "Sasha", displayName = "Sasha" } = {}) {
  const roles = roleIds.map((roleId, index) => ({
    id: roleId,
    position: roleIds.length - index,
    guild: { id: "guild-1" },
  }));
  return {
    guild: { id: "guild-1" },
    displayName,
    user: { id: userId, username },
    roles: {
      cache: new Map(roles.map((role) => [role.id, role])),
    },
  };
}

function createTestOperator(overrides = {}) {
  return createProfileOperator({
    commandName: "профиль",
    guildId: "guild-1",
    getViewerTagRoleIds: () => ["tag-role"],
    hasStaffBypass: () => false,
    getRequesterProfile: () => ({ domains: { activity: { desiredActivityRoleKey: "active" } } }),
    getTargetProfile: () => ({
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
        },
        elo: {
          currentElo: 145,
          currentTier: 2,
          lastSubmissionStatus: "approved",
        },
        tierlist: {
          hasSubmission: true,
          mainName: "Gojo",
          influenceMultiplier: 1.2,
        },
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
          status: "verified",
          decision: "approved",
          oauthAvatarUrl: "https://cdn.discordapp.com/oauth-avatar.png",
        },
      },
    }),
    getTargetDisplayName: () => "Sasha",
    fetchMember: async (userId) => makeMember(["role-1", "role-2"], { userId, username: "Sasha", displayName: "Sasha Display" }),
    fetchUser: async (userId) => ({
      id: userId,
      username: "Sasha",
      globalName: "Sasha Global",
      displayAvatarURL: () => `https://cdn.discordapp.com/avatars/${userId}/profile.png`,
    }),
    getPendingSubmissionForUser: () => null,
    getLatestSubmissionForUser: () => ({ reviewedAt: "2026-05-02T12:00:00.000Z" }),
    getApprovedEntries: () => [
      { userId: "user-2", displayName: "Top", approvedKills: 200 },
      { userId: "user-1", displayName: "Sasha", approvedKills: 120 },
    ],
    getRecentKillChangesForUser: (userId) => collectUserRecentKillChangeHistory([
      { userId, status: "approved", kills: 80, reviewedAt: "2026-04-26T00:00:00.000Z" },
      { userId, status: "approved", kills: 100, reviewedAt: "2026-05-01T00:00:00.000Z" },
      { userId, status: "approved", kills: 120, reviewedAt: "2026-05-10T00:00:00.000Z" },
    ], userId, { limit: 3 }),
    getRecentKillChangeForUser: () => ({
      userId: "user-1",
      from: 100,
      to: 120,
      fromAt: Date.parse("2026-05-01T00:00:00.000Z"),
      toAt: Date.parse("2026-05-10T00:00:00.000Z"),
    }),
    getEloProfile: () => ({ currentElo: 145, currentTier: 2, lastSubmissionStatus: "approved" }),
    getTierlistProfile: () => ({ mainName: "Gojo", influenceMultiplier: 1.2 }),
    getComboGuideState: () => ({
      generalTechsThreadId: "general-thread",
      characters: [{ id: "gojo", name: "Gojo", threadId: "thread-1" }],
    }),
    ...overrides,
  });
}

test("profile operator builds private payload from injected runtime readers", async () => {
  const operator = createTestOperator();

  const access = operator.resolveProfileAccessForRequester({
    requesterUserId: "requester",
    requesterMember: makeMember(["tag-role"], { userId: "requester", username: "Requester", displayName: "Requester" }),
    targetUserId: "user-1",
  });
  assert.equal(access.allowed, true);

    const payload = await operator.buildPrivateProfilePayload({
    targetUserId: "user-1",
    requesterUserId: "requester",
    isSelf: false,
      view: "progress",
    });

  assert.equal(payload.flags, MessageFlags.IsComponentsV2);
  const container = payload.components[0].toJSON();
  assert.equal(container.type, 17);
  assert.ok(container.components.some((component) => component.type === 10 && /# Профиль/.test(component.content)));
  assert.ok(container.components.some((component) => component.type === 1 && component.components.some((button) => button.custom_id === buildProfileNavCustomId("requester", "user-1", "progress"))));
  assert.ok(container.components.some((component) => component.type === 10 && /### Вклад/.test(component.content)));
  assert.ok(container.components.some((component) => component.type === 10 && /### История approved ростов/.test(component.content)));
  assert.match(JSON.stringify(container), /https:\/\/cdn\.discordapp\.com\/avatars\/user-1\/profile\.png/);
});

test("profile operator exposes deny payload text through the runtime seam", () => {
  const operator = createTestOperator();

  const access = operator.resolveProfileAccessForRequester({
    requesterUserId: "requester",
    requesterMember: makeMember([], { userId: "requester", username: "Requester", displayName: "Requester" }),
    targetUserId: "target",
  });

  assert.equal(access.allowed, false);
  assert.match(operator.getProfileAccessDeniedText(access), /серверным tag/i);
  assert.equal(operator.buildProfileAccessDeniedPayload(access).flags, MessageFlags.Ephemeral);
});

test("profile operator handles profile message trigger and schedules helper cleanup", async () => {
  const operator = createTestOperator();
  const replies = [];
  const scheduled = [];
  const denied = [];
  const message = {
    content: "профиль",
    author: { id: "requester", username: "Requester", bot: false },
    member: makeMember(["tag-role"], { userId: "requester", username: "Requester", displayName: "Requester" }),
    mentions: { users: new Map() },
    reference: null,
    reply: async (payload) => {
      replies.push(payload);
      return { id: "helper-message" };
    },
  };

  const handled = await operator.handleProfileMessage({
    message,
    replyAndDelete: async (_message, text) => denied.push(text),
    scheduleDeleteMessage: (messageToDelete, delayMs) => scheduled.push({ messageToDelete, delayMs }),
    helperDeleteMs: 20000,
  });

  assert.equal(handled, true);
  assert.deepEqual(denied, []);
  assert.equal(replies.length, 1);
  assert.match(replies[0].content, /открыть свой профиль/i);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delayMs, 20000);
});

test("profile operator handles slash command and edits ephemeral reply", async () => {
  const operator = createTestOperator();
  const calls = [];
  const interaction = {
    commandName: "профиль",
    user: { id: "requester", username: "Requester" },
    member: makeMember(["tag-role"], { userId: "requester", username: "Requester", displayName: "Requester" }),
    options: {
      getUser(name) {
        assert.equal(name, "target");
        return { id: "user-1", username: "Sasha" };
      },
    },
    reply: async (payload) => calls.push({ step: "reply", payload }),
    deferReply: async (payload) => calls.push({ step: "deferReply", payload }),
    editReply: async (payload) => calls.push({ step: "editReply", payload }),
  };

  const handled = await operator.handleProfileSlashCommand({
    interaction,
    checkActorGuard: async () => false,
  });

  assert.equal(handled, true);
  assert.equal(calls[0].step, "deferReply");
  assert.equal(calls[0].payload.flags, MessageFlags.Ephemeral);
  assert.equal(calls[1].step, "editReply");
  assert.equal(calls[1].payload.flags, MessageFlags.IsComponentsV2);
});

test("profile operator resolves slash target from replied message when explicit target is missing", async () => {
  const operator = createTestOperator({
    fetchChannelMessage: async (_channelId, messageId) => ({
      id: messageId,
      author: { id: "user-2", username: "ReplyTarget", bot: false },
    }),
  });
  const calls = [];
  const interaction = {
    commandName: "профиль",
    channelId: "channel-1",
    reference: { messageId: "message-1" },
    user: { id: "requester", username: "Requester" },
    member: makeMember(["tag-role"], { userId: "requester", username: "Requester", displayName: "Requester" }),
    options: {
      getUser(name) {
        assert.equal(name, "target");
        return null;
      },
    },
    deferReply: async (payload) => calls.push({ step: "deferReply", payload }),
    editReply: async (payload) => calls.push({ step: "editReply", payload }),
  };

  const handled = await operator.handleProfileSlashCommand({
    interaction,
    checkActorGuard: async () => false,
  });

  assert.equal(handled, true);
  assert.equal(calls[1].payload.flags, MessageFlags.IsComponentsV2);
  assert.match(JSON.stringify(calls[1].payload.components[0].toJSON()), /profile_nav:requester:user-2:overview/);
});

test("profile operator handles open and nav buttons through one runtime seam", async () => {
  const operator = createTestOperator();
  const openCalls = [];
  const openInteraction = {
    customId: buildProfileOpenCustomId("requester", "user-1"),
    user: { id: "requester", username: "Requester" },
    member: makeMember(["tag-role"], { userId: "requester", username: "Requester", displayName: "Requester" }),
    message: {
      delete: async () => openCalls.push({ step: "deleteMessage" }),
    },
    reply: async (payload) => openCalls.push({ step: "reply", payload }),
    deferReply: async (payload) => openCalls.push({ step: "deferReply", payload }),
    editReply: async (payload) => openCalls.push({ step: "editReply", payload }),
  };

  const openHandled = await operator.handleProfileButtonInteraction({
    interaction: openInteraction,
    checkActorGuard: async () => false,
  });

  assert.equal(openHandled, true);
  assert.deepEqual(openCalls.map((entry) => entry.step), ["deferReply", "editReply", "deleteMessage"]);
  assert.equal(openCalls[0].payload.flags, MessageFlags.Ephemeral);
  assert.equal(openCalls[1].payload.flags, MessageFlags.IsComponentsV2);

  const navCalls = [];
  const navInteraction = {
    customId: buildProfileNavCustomId("requester", "user-1", "activity"),
    user: { id: "requester", username: "Requester" },
    member: makeMember(["tag-role"], { userId: "requester", username: "Requester", displayName: "Requester" }),
    reply: async (payload) => navCalls.push({ step: "reply", payload }),
    update: async (payload) => navCalls.push({ step: "update", payload }),
  };

  const navHandled = await operator.handleProfileButtonInteraction({
    interaction: navInteraction,
  });

  assert.equal(navHandled, true);
  assert.deepEqual(navCalls.map((entry) => entry.step), ["update"]);
  assert.equal(navCalls[0].payload.flags, MessageFlags.IsComponentsV2);
});