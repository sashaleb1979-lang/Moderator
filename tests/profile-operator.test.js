"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { MessageFlags } = require("discord.js");

const { buildProfileNavCustomId, buildProfileOpenCustomId } = require("../src/profile/entry");
const { collectUserRecentKillChangeHistory } = require("../src/onboard/tierlist-ranking");
const { createProfileOperator } = require("../src/profile/operator");

function makePrimaryGuild(tag = "TAG", { identityEnabled = true } = {}) {
  return {
    identityGuildId: "guild-1",
    identityEnabled,
    tag,
    badge: "badge-hash",
  };
}

function makeMember({ roleIds = [], userId = "user-1", username = "Sasha", displayName = "Sasha", primaryGuild = null } = {}) {
  const roles = roleIds.map((roleId, index) => ({
    id: roleId,
    position: roleIds.length - index,
    guild: { id: "guild-1" },
  }));
  return {
    guild: { id: "guild-1" },
    displayName,
    user: {
      id: userId,
      username,
      ...(primaryGuild ? { primaryGuild } : {}),
    },
    roles: {
      cache: new Map(roles.map((role) => [role.id, role])),
    },
  };
}

function createTestOperator(overrides = {}) {
  return createProfileOperator({
    commandName: "профиль",
    guildId: "guild-1",
    hiddenProfileRoleIds: ["1146511958305144883"],
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
    fetchAccessUser: async (_userId, seedUser) => seedUser || null,
    fetchMember: async (userId) => makeMember({ roleIds: ["role-1", "1146511958305144883", "role-2"], userId, username: "Sasha", displayName: "Sasha Display" }),
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
    getPopulationProfiles: () => [
      {
        userId: "user-2",
        profile: {
          approvedKills: 200,
          killTier: 4,
          summary: {
            activity: { activityScore: 84, messages7d: 42 },
            roblox: { hasVerifiedAccount: true, jjsMinutes7d: 240 },
          },
        },
      },
      {
        userId: "user-1",
        profile: {
          approvedKills: 120,
          killTier: 4,
          summary: {
            activity: { activityScore: 77, messages7d: 35 },
            roblox: { hasVerifiedAccount: true, jjsMinutes7d: 180 },
          },
        },
      },
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
    getTierlistStatsUrl: () => "https://discord.com/channels/guild-1/tierlist/summary",
    getCharacterStatsContext: () => ({
      characterStats: [
        { id: "gojo", main: "Gojo", roleId: "role-gojo" },
      ],
    }),
    getComboGuideState: () => ({
      generalTechsThreadId: "general-thread",
      characters: [{ id: "gojo", name: "Gojo", threadId: "thread-1" }],
    }),
    getCharacterCatalog: () => ([
      {
        id: "gojo",
        label: "Gojo",
        wikiUrl: "https://jujutsu-shenanigans.fandom.com/wiki/Gojo",
      },
    ]),
    buildProfileRobloxBindModal: ({ initialValue = "" } = {}) => ({
      customId: "profile_bind_roblox_modal",
      initialValue,
    }),
    resolveRobloxUserInput: async (value) => ({
      id: "123",
      name: String(value || "").trim() || "Builderman",
      displayName: "Builderman",
    }),
    writeProfileRobloxBinding: async () => {},
    ...overrides,
  });
}

test("profile operator builds private payload from injected runtime readers", async () => {
  const operator = createTestOperator();

  const access = await operator.resolveProfileAccessForRequester({
    requesterUserId: "requester",
    requesterMember: makeMember({
      userId: "requester",
      username: "Requester",
      displayName: "Requester",
      primaryGuild: makePrimaryGuild("TAG"),
    }),
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
  assert.ok(container.components.some((component) => component.type === 10 && /### 🏅 Вклад/.test(component.content)));
  assert.ok(container.components.some((component) => component.type === 10 && /### 🧾 История approved ростов/.test(component.content)));
  assert.ok(container.components.some((component) => component.type === 1 && component.components.some((button) => button.label === "JJS Wiki: персонажи")));
  assert.ok(!container.components.some((component) => component.type === 1 && component.components.some((button) => button.label === "JJS Wiki: Gojo")));
  assert.match(JSON.stringify(container), /https:\/\/cdn\.discordapp\.com\/avatars\/user-1\/profile\.png/);
});

test("profile operator injects UX-only role and character stats context without noisy links", async () => {
  const operator = createTestOperator();

  const payload = await operator.buildPrivateProfilePayload({
    targetUserId: "user-1",
    requesterUserId: "requester",
    isSelf: false,
    view: "overview",
  });

  const container = payload.components[0].toJSON();
  const serialized = JSON.stringify(container);
  assert.match(serialized, /### 🎭 Мейны и места/);
  assert.match(serialized, /Gojo: <@&role-gojo>/);
  assert.match(serialized, /JJS Wiki: персонажи/);
  assert.doesNotMatch(serialized, /Текст-тирлист и статистика|JJS Wiki: Gojo|Гайд: Gojo/);
  assert.doesNotMatch(serialized, /1146511958305144883/);
});

test("profile operator exposes deny payload text through the runtime seam", () => {
  const operator = createTestOperator();

  return operator.resolveProfileAccessForRequester({
    requesterUserId: "requester",
    requesterMember: makeMember({ userId: "requester", username: "Requester", displayName: "Requester" }),
    targetUserId: "target",
  }).then((access) => {
    assert.equal(access.allowed, false);
    assert.match(operator.getProfileAccessDeniedText(access), /серверным tag/i);
    assert.equal(operator.buildProfileAccessDeniedPayload(access).flags, MessageFlags.Ephemeral);
  });
});

test("profile operator can fetch requester server tag for access", async () => {
  const operator = createTestOperator({
    fetchAccessUser: async (userId) => ({
      id: userId,
      username: "Requester",
      primaryGuild: makePrimaryGuild("TAG"),
    }),
  });

  const access = await operator.resolveProfileAccessForRequester({
    requesterUserId: "requester",
    requesterUser: { id: "requester", username: "Requester" },
    requesterMember: makeMember({ userId: "requester", username: "Requester", displayName: "Requester" }),
    targetUserId: "target",
  });

  assert.equal(access.allowed, true);
  assert.equal(access.hasViewerServerTag, true);
});

test("profile operator handles profile message trigger and schedules helper cleanup", async () => {
  const operator = createTestOperator();
  const replies = [];
  const scheduled = [];
  const denied = [];
  const message = {
    content: "профиль",
    author: { id: "requester", username: "Requester", bot: false },
    member: makeMember({
      userId: "requester",
      username: "Requester",
      displayName: "Requester",
      primaryGuild: makePrimaryGuild("TAG"),
    }),
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
    member: makeMember({
      userId: "requester",
      username: "Requester",
      displayName: "Requester",
      primaryGuild: makePrimaryGuild("TAG"),
    }),
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
    member: makeMember({
      userId: "requester",
      username: "Requester",
      displayName: "Requester",
      primaryGuild: makePrimaryGuild("TAG"),
    }),
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
    member: makeMember({
      userId: "requester",
      username: "Requester",
      displayName: "Requester",
      primaryGuild: makePrimaryGuild("TAG"),
    }),
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
    member: makeMember({
      userId: "requester",
      username: "Requester",
      displayName: "Requester",
      primaryGuild: makePrimaryGuild("TAG"),
    }),
    reply: async (payload) => navCalls.push({ step: "reply", payload }),
    deferUpdate: async () => navCalls.push({ step: "deferUpdate" }),
    editReply: async (payload) => navCalls.push({ step: "editReply", payload }),
  };

  const navHandled = await operator.handleProfileButtonInteraction({
    interaction: navInteraction,
  });

  assert.equal(navHandled, true);
  assert.deepEqual(navCalls.map((entry) => entry.step), ["deferUpdate", "editReply"]);
  assert.equal(navCalls[1].payload.flags, MessageFlags.IsComponentsV2);
});

test("profile operator returns a safe fallback when profile nav payload build fails", async () => {
  const warnings = [];
  const operator = createTestOperator({
    getTargetProfile: () => {
      throw new Error("broken profile build");
    },
    logWarning: (message) => warnings.push(message),
  });
  const calls = [];

  const handled = await operator.handleProfileButtonInteraction({
    interaction: {
      customId: buildProfileNavCustomId("requester", "user-1", "activity"),
      user: { id: "requester", username: "Requester" },
      member: makeMember({
        userId: "requester",
        username: "Requester",
        displayName: "Requester",
        primaryGuild: makePrimaryGuild("TAG"),
      }),
      reply: async (payload) => calls.push({ step: "reply", payload }),
      deferUpdate: async () => calls.push({ step: "deferUpdate" }),
      editReply: async (payload) => calls.push({ step: "editReply", payload }),
    },
  });

  assert.equal(handled, true);
  assert.deepEqual(calls.map((entry) => entry.step), ["deferUpdate", "editReply"]);
  assert.equal(calls[1].payload.flags, MessageFlags.IsComponentsV2);
  assert.match(JSON.stringify(calls[1].payload.components[0].toJSON()), /Раздел временно недоступен/);
  assert.ok(warnings.some((message) => /profile nav payload failed \(activity\/user-1\): broken profile build/.test(message)));
});

test("profile operator opens Roblox bind modal from the self action button", async () => {
  const operator = createTestOperator({
    getTargetProfile: () => ({
      summary: {
        roblox: {
          currentUsername: "GojoMain",
          verificationStatus: "verified",
          userId: "123",
        },
      },
    }),
  });
  const calls = [];

  const handled = await operator.handleProfileButtonInteraction({
    interaction: {
      customId: "profile_bind_roblox",
      user: { id: "user-1", username: "Sasha" },
      showModal: async (payload) => calls.push(payload),
    },
  });

  assert.equal(handled, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].customId, "profile_bind_roblox_modal");
  assert.equal(calls[0].initialValue, "GojoMain");
});

test("profile operator pre-fills Roblox bind modal from canonical domains state", async () => {
  const operator = createTestOperator({
    getTargetProfile: () => ({
      summary: {
        roblox: {
          currentUsername: "WrongSummaryName",
          verificationStatus: "unverified",
        },
      },
      domains: {
        roblox: {
          username: "CanonicalRb",
          verificationStatus: "verified",
          userId: "123",
        },
      },
    }),
  });
  const calls = [];

  const handled = await operator.handleProfileButtonInteraction({
    interaction: {
      customId: "profile_bind_roblox",
      user: { id: "user-1", username: "Sasha" },
      showModal: async (payload) => calls.push(payload),
    },
  });

  assert.equal(handled, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].initialValue, "CanonicalRb");
});

test("profile operator routes elo self-card button into canonical compact-card payload", async () => {
  const operator = createTestOperator();
  const calls = [];

  const handled = await operator.handleProfileButtonInteraction({
    interaction: {
      customId: "elo_submit_card",
      user: { id: "user-1", username: "Sasha" },
      member: makeMember({
        userId: "user-1",
        username: "Sasha",
        displayName: "Sasha",
        primaryGuild: makePrimaryGuild("TAG"),
      }),
      reply: async (payload) => calls.push({ step: "reply", payload }),
      deferReply: async (payload) => calls.push({ step: "deferReply", payload }),
      editReply: async (payload) => calls.push({ step: "editReply", payload }),
    },
    checkActorGuard: async () => false,
  });

  assert.equal(handled, true);
  assert.deepEqual(calls.map((entry) => entry.step), ["deferReply", "editReply"]);
  assert.equal(calls[0].payload.flags, MessageFlags.Ephemeral);
  assert.equal(calls[1].payload.flags, MessageFlags.IsComponentsV2);

  const payloadJson = JSON.stringify(calls[1].payload.components[0].toJSON());
  assert.match(payloadJson, /# Моя карточка/);
  assert.doesNotMatch(payloadJson, /profile_nav:/);
  assert.doesNotMatch(payloadJson, /profile_bind_roblox/);
});

test("profile operator resolves and saves Roblox binding through modal submit", async () => {
  const calls = [];
  const operator = createTestOperator({
    resolveRobloxUserInput: async (value) => {
      calls.push({ step: "resolve", value });
      return {
        id: "42",
        name: "Builderman",
        displayName: "Builderman",
      };
    },
    writeProfileRobloxBinding: async (userId, robloxUser, context) => {
      calls.push({ step: "write", userId, robloxUser, source: context.source });
    },
    logProfileRobloxBinding: async ({ userId, robloxUser }) => {
      calls.push({ step: "log", userId, robloxUser });
    },
  });
  const replies = [];

  const handled = await operator.handleProfileModalSubmitInteraction({
    interaction: {
      customId: "profile_bind_roblox_modal",
      user: { id: "user-1", username: "Sasha" },
      member: makeMember({ userId: "user-1", username: "Sasha", displayName: "Sasha" }),
      fields: {
        getTextInputValue(name) {
          assert.equal(name, "roblox_username");
          return "https://www.roblox.com/users/42/profile";
        },
      },
      deferReply: async (payload) => replies.push({ step: "deferReply", payload }),
      editReply: async (payload) => replies.push({ step: "editReply", payload }),
    },
  });

  assert.equal(handled, true);
  assert.deepEqual(replies[0], { step: "deferReply", payload: { flags: MessageFlags.Ephemeral } });
  assert.match(replies[1].payload, /Roblox аккаунт подтверждён: \*\*Builderman\*\* \(ID 42\)/);
  assert.deepEqual(calls.map((entry) => entry.step), ["resolve", "write", "log"]);
  assert.equal(calls[0].value, "https://www.roblox.com/users/42/profile");
});

test("profile operator logs resolve failures during Roblox bind modal submit", async () => {
  const warnings = [];
  const replies = [];
  const operator = createTestOperator({
    resolveRobloxUserInput: async () => {
      throw new Error("roblox api down");
    },
    logWarning: (message) => warnings.push(message),
  });

  const handled = await operator.handleProfileModalSubmitInteraction({
    interaction: {
      customId: "profile_bind_roblox_modal",
      user: { id: "user-1", username: "Sasha" },
      member: makeMember({ userId: "user-1", username: "Sasha", displayName: "Sasha" }),
      fields: {
        getTextInputValue() {
          return "Builderman";
        },
      },
      deferReply: async (payload) => replies.push({ step: "deferReply", payload }),
      editReply: async (payload) => replies.push({ step: "editReply", payload }),
    },
  });

  assert.equal(handled, true);
  assert.deepEqual(replies[0], { step: "deferReply", payload: { flags: MessageFlags.Ephemeral } });
  assert.equal(replies[1].payload, "roblox api down");
  assert.deepEqual(warnings, ["profile_bind_roblox resolve failed (user-1): roblox api down"]);
});

test("profile operator logs write failures during Roblox bind modal submit", async () => {
  const warnings = [];
  const replies = [];
  const operator = createTestOperator({
    resolveRobloxUserInput: async () => ({
      id: "42",
      name: "Builderman",
      displayName: "Builderman",
    }),
    writeProfileRobloxBinding: async () => {
      throw new Error("db write failed");
    },
    logWarning: (message) => warnings.push(message),
  });

  const handled = await operator.handleProfileModalSubmitInteraction({
    interaction: {
      customId: "profile_bind_roblox_modal",
      user: { id: "user-1", username: "Sasha" },
      member: makeMember({ userId: "user-1", username: "Sasha", displayName: "Sasha" }),
      fields: {
        getTextInputValue() {
          return "Builderman";
        },
      },
      deferReply: async (payload) => replies.push({ step: "deferReply", payload }),
      editReply: async (payload) => replies.push({ step: "editReply", payload }),
    },
  });

  assert.equal(handled, true);
  assert.deepEqual(replies[0], { step: "deferReply", payload: { flags: MessageFlags.Ephemeral } });
  assert.equal(replies[1].payload, "db write failed");
  assert.deepEqual(warnings, ["profile_bind_roblox write failed (user-1): db write failed"]);
});
