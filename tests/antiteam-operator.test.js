"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { MessageFlags } = require("discord.js");
const { createAntiteamOperator } = require("../src/antiteam/operator");
const { ANTITEAM_COMMAND_NAME, ANTITEAM_CUSTOM_IDS, ticketButtonId } = require("../src/antiteam/view");
const {
  createAntiteamTicketFromDraft,
  ensureAntiteamState,
  setAntiteamDraft,
} = require("../src/antiteam/state");

function createModalInteraction(
  customId,
  fields = {},
  user = { id: "user-1", username: "User" },
  member = { permissions: { has: () => false }, roles: { cache: new Map() } }
) {
  const calls = [];
  return {
    calls,
    customId,
    user,
    member,
    isModalSubmit: () => true,
    fields: {
      getTextInputValue(name) {
        return fields[name] || "";
      },
    },
    async deferReply(payload) {
      calls.push(["deferReply", payload]);
    },
    async editReply(payload) {
      calls.push(["editReply", payload]);
    },
    async reply(payload) {
      calls.push(["reply", payload]);
    },
  };
}

function createButtonInteraction(customId, user = { id: "helper-1", username: "Helper" }) {
  const calls = [];
  return {
    calls,
    customId,
    user,
    member: { permissions: { has: () => false }, roles: { cache: new Map() } },
    isButton: () => true,
    async reply(payload) {
      calls.push(["reply", payload]);
    },
    async update(payload) {
      calls.push(["update", payload]);
    },
    async deferUpdate() {
      calls.push(["deferUpdate"]);
    },
    async deferReply(payload) {
      calls.push(["deferReply", payload]);
    },
    async editReply(payload) {
      calls.push(["editReply", payload]);
    },
    async showModal(payload) {
      calls.push(["showModal", payload]);
    },
  };
}

function createSelectInteraction(customId, values = [], user = { id: "user-1", username: "User" }) {
  const calls = [];
  return {
    calls,
    customId,
    values,
    user,
    isStringSelectMenu: () => true,
    async reply(payload) {
      calls.push(["reply", payload]);
    },
    async update(payload) {
      calls.push(["update", payload]);
    },
    async deferUpdate() {
      calls.push(["deferUpdate"]);
    },
    async editReply(payload) {
      calls.push(["editReply", payload]);
    },
  };
}

function createSlashInteraction(subcommand, {
  user = { id: "mod-1", username: "Mod" },
  member = { permissions: { has: () => true }, roles: { cache: new Map() } },
  target = null,
} = {}) {
  const calls = [];
  return {
    calls,
    commandName: ANTITEAM_COMMAND_NAME,
    user,
    member,
    isChatInputCommand: () => true,
    options: {
      getSubcommand: () => subcommand,
      getUser: () => target,
    },
    async reply(payload) {
      calls.push(["reply", payload]);
    },
    async deferReply(payload) {
      calls.push(["deferReply", payload]);
    },
    async editReply(payload) {
      calls.push(["editReply", payload]);
    },
    async showModal(payload) {
      calls.push(["showModal", payload]);
    },
  };
}

test("roblox modal uses API lookup only for the current draft, grants battalion role and does not rewrite profile binding", async () => {
  const db = {};
  ensureAntiteamState(db).state.config.battalionRoleId = "battalion-role";
  let binding = null;
  const granted = [];
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:00:00.000Z",
    saveDb() {},
    resolveRobloxUserByUsername: async () => ({
      id: "101",
      name: "Anchor",
      displayName: "Anchor Display",
      avatarUrl: "https://tr.rbxcdn.com/anchor-headshot.png",
    }),
    writeRobloxBinding: async (userId, robloxUser, source) => {
      binding = { userId, robloxUser, source };
    },
    grantRole: async (userId, roleId) => {
      granted.push({ userId, roleId });
    },
  });
  const interaction = createModalInteraction("at:roblox", { roblox_username: "Anchor" });

  assert.equal(await operator.handleModalSubmitInteraction(interaction), true);

  assert.equal(binding, null);
  assert.deepEqual(granted, [{ userId: "user-1", roleId: "battalion-role" }]);
  assert.equal(db.sot.antiteam.drafts["user-1"].roblox.username, "Anchor");
  assert.equal(db.sot.antiteam.drafts["user-1"].roblox.avatarUrl, "https://tr.rbxcdn.com/anchor-headshot.png");
  assert.equal(interaction.calls[0][0], "deferReply");
  assert.match(JSON.stringify(interaction.calls.at(-1)[1].components[0].toJSON()), /Roblox: \*\*Anchor\*\* \(101\) • подтверждён/);
  assert.equal(interaction.calls.at(-1)[1].flags, MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
});

test("clan roblox modal verifies anchor without rebinding caller profile", async () => {
  const db = {};
  ensureAntiteamState(db);
  let binding = null;
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:00:00.000Z",
    saveDb() {},
    resolveRobloxUserByUsername: async () => ({ id: "202", name: "ClanAnchor", displayName: "Clan Anchor" }),
    writeRobloxBinding: async (userId, robloxUser, source) => {
      binding = { userId, robloxUser, source };
    },
  });
  const interaction = createModalInteraction("at:clan_roblox", { roblox_username: "ClanAnchor" });

  assert.equal(await operator.handleModalSubmitInteraction(interaction), true);

  assert.equal(binding, null);
  assert.equal(db.sot.antiteam.drafts["user-1"].kind, "clan");
  assert.equal(db.sot.antiteam.drafts["user-1"].roblox.username, "ClanAnchor");
  assert.match(JSON.stringify(interaction.calls.at(-1)[1].components[0].toJSON()), /Это не привязка к твоему профилю/);
});

test("clan slash command uses target profile as anchor without opening username modal", async () => {
  const db = {};
  ensureAntiteamState(db);
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:00:00.000Z",
    saveDb() {},
    getProfile: (userId) => userId === "anchor-1" ? {
      domains: {
        roblox: {
          userId: "202",
          username: "AnchorTarget",
          displayName: "Anchor Target",
          verificationStatus: "verified",
        },
      },
    } : null,
  });
  const interaction = createSlashInteraction("clan", {
    target: { id: "anchor-1", username: "AnchorDiscord" },
  });

  assert.equal(await operator.handleSlashCommand(interaction), true);

  assert.deepEqual(interaction.calls.map((call) => call[0]), ["deferReply", "editReply"]);
  assert.equal(db.sot.antiteam.drafts["mod-1"].kind, "clan");
  assert.equal(db.sot.antiteam.drafts["mod-1"].anchorUserId, "anchor-1");
  assert.equal(db.sot.antiteam.drafts["mod-1"].roblox.username, "AnchorTarget");
  assert.match(JSON.stringify(interaction.calls.at(-1)[1].components[0].toJSON()), /Якорь: <@anchor-1>/);
});

test("clan slash command rejects target without verified Roblox profile", async () => {
  const db = {};
  ensureAntiteamState(db);
  const operator = createAntiteamOperator({
    db,
    saveDb() {},
    getProfile: () => null,
  });
  const interaction = createSlashInteraction("clan", {
    target: { id: "anchor-1", username: "AnchorDiscord" },
  });

  assert.equal(await operator.handleSlashCommand(interaction), true);

  assert.equal(interaction.calls[0][0], "reply");
  assert.match(interaction.calls[0][1].content, /нет проверенного Roblox/);
  assert.equal(db.sot.antiteam.drafts["mod-1"], undefined);
});

test("start panel submit button opens the Roblox username modal only when profile has no Roblox", async () => {
  const db = {};
  ensureAntiteamState(db);
  const operator = createAntiteamOperator({
    db,
    saveDb() {},
  });
  const interaction = createButtonInteraction(ANTITEAM_CUSTOM_IDS.open, { id: "user-1", username: "User" });

  assert.equal(await operator.handleButtonInteraction(interaction), true);
  assert.equal(interaction.calls[0][0], "showModal");
  assert.equal(interaction.calls[0][1].data.custom_id, "at:roblox");
});

test("start panel submit button ignores Roblox records without verified trust markers", async () => {
  const db = {};
  ensureAntiteamState(db);
  const operator = createAntiteamOperator({
    db,
    saveDb() {},
    getProfile: () => ({
      domains: {
        roblox: {
          userId: "101",
          username: "MaybeWrong",
        },
      },
    }),
  });
  const interaction = createButtonInteraction(ANTITEAM_CUSTOM_IDS.open, { id: "user-1", username: "User" });

  assert.equal(await operator.handleButtonInteraction(interaction), true);

  assert.equal(interaction.calls[0][0], "showModal");
  assert.equal(interaction.calls[0][1].data.custom_id, "at:roblox");
});

test("start panel submit button reuses verified Roblox from profile", async () => {
  const db = {};
  ensureAntiteamState(db).state.config.battalionRoleId = "battalion-role";
  const granted = [];
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:00:00.000Z",
    saveDb() {},
    getProfile: () => ({
      domains: {
        roblox: {
          userId: "101",
          username: "AlreadyLinked",
          displayName: "Already Linked",
          verificationStatus: "verified",
        },
      },
    }),
    grantRole: async (userId, roleId) => {
      granted.push({ userId, roleId });
    },
  });
  const interaction = createButtonInteraction(ANTITEAM_CUSTOM_IDS.open, { id: "user-1", username: "User" });

  assert.equal(await operator.handleButtonInteraction(interaction), true);

  assert.equal(interaction.calls[0][0], "deferReply");
  assert.equal(interaction.calls[1][0], "editReply");
  assert.equal(db.sot.antiteam.drafts["user-1"].roblox.username, "AlreadyLinked");
  assert.deepEqual(granted, [{ userId: "user-1", roleId: "battalion-role" }]);
  assert.match(JSON.stringify(interaction.calls[1][1].components[0].toJSON()), /Roblox: \*\*AlreadyLinked\*\* \(101\) • взят из профиля/);
});

test("start panel submit resets a stale clan draft back to the caller Roblox profile", async () => {
  const db = {};
  setAntiteamDraft(db, "user-1", {
    kind: "clan",
    userTag: "User",
    anchorUserId: "anchor-1",
    anchorUserTag: "Anchor",
    roblox: { userId: "202", username: "AnchorTarget" },
    description: "Старый клан-черновик.",
  }, { now: "2026-05-16T10:00:00.000Z" });
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:01:00.000Z",
    saveDb() {},
    getProfile: () => ({
      domains: {
        roblox: {
          userId: "101",
          username: "AlreadyLinked",
          displayName: "Already Linked",
          verificationStatus: "verified",
        },
      },
    }),
  });
  const interaction = createButtonInteraction(ANTITEAM_CUSTOM_IDS.open, { id: "user-1", username: "User" });

  assert.equal(await operator.handleButtonInteraction(interaction), true);

  const draft = db.sot.antiteam.drafts["user-1"];
  assert.equal(draft.kind, "standard");
  assert.equal(draft.anchorUserId, "");
  assert.equal(draft.anchorUserTag, "");
  assert.equal(draft.roblox.username, "AlreadyLinked");
});

test("help button records friend-request path and notifies author only after helper confirms request", async () => {
  const db = {};
  const state = ensureAntiteamState(db).state;
  state.config.channelId = "channel-1";
  const draft = setAntiteamDraft(db, "author-1", {
    userTag: "Author",
    roblox: { userId: "101", username: "Anchor", profileUrl: "https://www.roblox.com/users/101/profile" },
    level: "medium",
    count: "2-4",
  }, { now: "2026-05-16T10:00:00.000Z" });
  createAntiteamTicketFromDraft(db, draft, {
    id: "ticket-1",
    now: "2026-05-16T10:01:00.000Z",
  });
  db.sot.antiteam.tickets["ticket-1"].message.threadId = "thread-1";

  const dm = [];
  const threadNotices = [];
  const thread = {
    id: "thread-1",
    send: async (payload) => {
      threadNotices.push(payload);
      return { id: `notice-${threadNotices.length}` };
    },
  };
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:02:00.000Z",
    saveDb() {},
    getProfile: () => ({ domains: { roblox: { userId: "202", username: "HelperRoblox", verificationStatus: "verified" } } }),
    sendDirectMessage: async (userId, payload) => {
      dm.push({ userId, payload });
    },
    fetchChannel: async (channelId) => channelId === "thread-1" ? thread : null,
  });
  const interaction = createButtonInteraction("at:help:ticket-1");

  assert.equal(await operator.handleButtonInteraction(interaction), true);
  assert.equal(await operator.handleButtonInteraction(createButtonInteraction("at:help:ticket-1")), true);

  const ticket = db.sot.antiteam.tickets["ticket-1"];
  assert.equal(ticket.helpers["helper-1"].linkKind, "friend_request");
  assert.equal(db.sot.antiteam.stats.helpers["helper-1"].responded, 1);
  assert.equal(db.sot.antiteam.stats.helpers["helper-1"].linkGranted, 1);
  assert.equal(threadNotices.length, 0);
  assert.equal(dm.length, 0);
  assert.match(JSON.stringify(interaction.calls.at(-1)[1].components[0].toJSON()), /Отправил др, пусть примет/);

  const sentInteraction = createButtonInteraction(ticketButtonId("friend_request_sent", "ticket-1"));
  assert.equal(await operator.handleButtonInteraction(sentInteraction), true);

  assert.equal(threadNotices.length, 1);
  assert.match(threadNotices[0].content, /<@author-1>/);
  assert.match(threadNotices[0].content, /<@helper-1> отправил тебе friend request/);
  assert.match(threadNotices[0].content, /Принять заявки/);
  assert.deepEqual(threadNotices[0].allowedMentions.users, ["author-1", "helper-1"]);
  assert.match(JSON.stringify(sentInteraction.calls.at(-1)[1].components[0].toJSON()), /Помощь принята/);
});

test("help button acknowledges before ticket sync without thread notice spam", async () => {
  const db = {};
  const state = ensureAntiteamState(db).state;
  state.config.channelId = "channel-1";
  const draft = setAntiteamDraft(db, "author-1", {
    userTag: "Author",
    roblox: { userId: "101", username: "Anchor", profileUrl: "https://www.roblox.com/users/101/profile" },
    level: "medium",
    count: "2-4",
    description: "Нужна помощь в центре.",
  }, { now: "2026-05-16T10:00:00.000Z" });
  createAntiteamTicketFromDraft(db, draft, {
    id: "ticket-1",
    now: "2026-05-16T10:01:00.000Z",
  });
  db.sot.antiteam.tickets["ticket-1"].message = {
    channelId: "channel-1",
    messageId: "message-1",
    threadId: "thread-1",
    threadPanelMessageId: "panel-1",
  };

  const events = [];
  const interaction = createButtonInteraction("at:help:ticket-1");
  interaction.deferReply = async (payload) => {
    events.push("deferReply");
    interaction.calls.push(["deferReply", payload]);
  };
  interaction.editReply = async (payload) => {
    events.push("editReply");
    interaction.calls.push(["editReply", payload]);
  };
  interaction.reply = async (payload) => {
    events.push("reply");
    interaction.calls.push(["reply", payload]);
  };

  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:02:00.000Z",
    saveDb() {},
    getProfile: () => ({ domains: { roblox: { userId: "202", username: "HelperRoblox", verificationStatus: "verified" } } }),
    fetchChannel: async (channelId) => {
      if (channelId === "channel-1") {
        return {
          messages: {
            fetch: async (messageId) => messageId === "message-1"
              ? {
                edit: async () => {
                  events.push("public.edit");
                },
              }
              : null,
          },
        };
      }

      if (channelId === "thread-1") {
        return {
          send: async () => {
            events.push("thread.send");
            return { id: "notice-1" };
          },
          messages: {
            fetch: async (messageId) => messageId === "panel-1"
              ? {
                edit: async () => {
                  events.push("panel.edit");
                },
              }
              : null,
          },
        };
      }

      return null;
    },
  });

  assert.equal(await operator.handleButtonInteraction(interaction), true);

  assert.deepEqual(events.slice(0, 2), ["deferReply", "editReply"]);
  assert.deepEqual(interaction.calls.map((call) => call[0]), ["deferReply", "editReply"]);
  assert.ok(!events.includes("thread.send"));
  assert.ok(events.includes("public.edit"));
  assert.ok(events.includes("panel.edit"));
});

test("ticket sync annotates public helper count with API-present helpers", async () => {
  const db = {
    profiles: {
      "helper-1": {
        domains: { roblox: { userId: "202", username: "HelperRoblox", verificationStatus: "verified" } },
      },
    },
  };
  const state = ensureAntiteamState(db).state;
  state.config.channelId = "channel-1";
  const draft = setAntiteamDraft(db, "author-1", {
    userTag: "Author",
    roblox: { userId: "101", username: "Anchor", profileUrl: "https://www.roblox.com/users/101/profile" },
    level: "medium",
    count: "2-4",
    description: "Нужна помощь в центре.",
  }, { now: "2026-05-16T10:00:00.000Z" });
  createAntiteamTicketFromDraft(db, draft, {
    id: "ticket-1",
    now: "2026-05-16T10:01:00.000Z",
  });
  db.sot.antiteam.tickets["ticket-1"].message = {
    channelId: "channel-1",
    messageId: "message-1",
    threadId: "thread-1",
    threadPanelMessageId: "panel-1",
  };

  let publicEdit = null;
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:02:00.000Z",
    saveDb() {},
    getRobloxRuntimeState: () => ({
      activeSessionsByDiscordUserId: {
        "author-1": { gameId: "game-1" },
        "helper-1": { gameId: "game-1" },
      },
    }),
    fetchChannel: async (channelId) => {
      if (channelId === "channel-1") {
        return {
          messages: {
            fetch: async () => ({
              edit: async (payload) => {
                publicEdit = payload;
              },
            }),
          },
        };
      }
      return {
        messages: {
          fetch: async () => ({ edit: async () => {} }),
        },
      };
    },
  });
  const interaction = createButtonInteraction("at:help:ticket-1");

  assert.equal(await operator.handleButtonInteraction(interaction), true);

  const json = JSON.stringify(publicEdit.components[0].toJSON());
  assert.match(json, /Откликнулись: \*\*1\*\* \(API в игре: \*\*1\*\*\)/);
  assert.doesNotMatch(json, /пришли: \*\*0\*\*/);
});

test("clan friend-request notice pings the selected anchor in the thread", async () => {
  const db = {};
  const state = ensureAntiteamState(db).state;
  state.config.channelId = "channel-1";
  const draft = setAntiteamDraft(db, "caller-1", {
    kind: "clan",
    userTag: "Caller",
    anchorUserId: "anchor-1",
    anchorUserTag: "Anchor",
    roblox: { userId: "101", username: "AnchorRb", profileUrl: "https://www.roblox.com/users/101/profile" },
    description: "Клан держит сервер.",
  }, { now: "2026-05-16T10:00:00.000Z" });
  createAntiteamTicketFromDraft(db, draft, {
    id: "ticket-clan",
    now: "2026-05-16T10:01:00.000Z",
  });
  db.sot.antiteam.tickets["ticket-clan"].message.threadId = "thread-1";

  const threadNotices = [];
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:02:00.000Z",
    saveDb() {},
    getProfile: () => ({ domains: { roblox: { userId: "202", username: "HelperRoblox", verificationStatus: "verified" } } }),
    fetchChannel: async () => ({
      send: async (payload) => {
        threadNotices.push(payload);
        return { id: "notice-1" };
      },
    }),
  });

  assert.equal(await operator.handleButtonInteraction(createButtonInteraction("at:help:ticket-clan")), true);
  assert.equal(threadNotices.length, 0);
  assert.equal(await operator.handleButtonInteraction(createButtonInteraction(ticketButtonId("friend_request_sent", "ticket-clan"))), true);

  assert.equal(threadNotices.length, 1);
  assert.match(threadNotices[0].content, /<@anchor-1>/);
  assert.match(threadNotices[0].content, /клан-аларму/);
  assert.deepEqual(threadNotices[0].allowedMentions.users, ["anchor-1", "helper-1"]);
});

test("help button can route through a Roblox friend currently in the author's game", async () => {
  const db = {
    profiles: {
      "helper-1": {
        domains: { roblox: { userId: "202", username: "HelperRoblox", verificationStatus: "verified" } },
      },
      "bridge-1": {
        domains: { roblox: { userId: "303", username: "BridgeFriend", verificationStatus: "verified" } },
      },
    },
  };
  const state = ensureAntiteamState(db).state;
  state.config.channelId = "channel-1";
  state.config.roblox.jjsPlaceId = "place-1";
  const draft = setAntiteamDraft(db, "author-1", {
    userTag: "Author",
    roblox: { userId: "101", username: "Anchor", profileUrl: "https://www.roblox.com/users/101/profile" },
    level: "medium",
    count: "2-4",
    description: "Цели A/B.",
  }, { now: "2026-05-16T10:00:00.000Z" });
  createAntiteamTicketFromDraft(db, draft, {
    id: "ticket-1",
    now: "2026-05-16T10:01:00.000Z",
  });
  db.sot.antiteam.tickets["ticket-1"].message = {
    channelId: "channel-1",
    messageId: "message-1",
    threadId: "thread-1",
    threadPanelMessageId: "panel-1",
  };

  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:02:00.000Z",
    saveDb() {},
    getRobloxRuntimeState: () => ({
      activeSessionsByDiscordUserId: {
        "author-1": { gameId: "game-1" },
        "bridge-1": { gameId: "game-1" },
      },
    }),
    fetchRobloxFriends: async (robloxUserId) => robloxUserId === "202" ? [{ userId: "303" }] : [],
    fetchRobloxPresences: async (robloxUserIds) => robloxUserIds[0] === "303"
      ? [{ userId: 303, placeId: "place-1", gameId: "game-1" }]
      : [],
    fetchChannel: async () => ({
      messages: {
        fetch: async () => ({ edit: async () => {} }),
      },
    }),
  });
  const interaction = createButtonInteraction("at:help:ticket-1");

  assert.equal(await operator.handleButtonInteraction(interaction), true);

  const ticket = db.sot.antiteam.tickets["ticket-1"];
  assert.equal(ticket.helpers["helper-1"].linkKind, "bridge_direct");
  assert.equal(ticket.helpers["helper-1"].bridgeDiscordUserId, "bridge-1");
  const json = JSON.stringify(interaction.calls.at(-1)[1].components[0].toJSON());
  assert.match(json, /BridgeFriend/);
  assert.match(json, /Прямая ссылка подключения/);
  assert.doesNotMatch(json, /Отправил др/);
});

test("close review rejects moderator role without admin permissions", async () => {
  const db = {};
  const draft = setAntiteamDraft(db, "author-1", {
    userTag: "Author",
    roblox: { userId: "101", username: "Anchor" },
    level: "medium",
    count: "2-4",
    description: "Нужна помощь.",
  }, { now: "2026-05-16T10:00:00.000Z" });
  createAntiteamTicketFromDraft(db, draft, {
    id: "ticket-1",
    now: "2026-05-16T10:01:00.000Z",
  });

  const operator = createAntiteamOperator({
    db,
    saveDb() {},
    isModerator: () => true,
  });
  const interaction = createButtonInteraction("at:close:ticket-1", { id: "mod-1", username: "Mod" });
  interaction.member = {
    permissions: { has: () => false },
    roles: { cache: new Map() },
  };

  assert.equal(await operator.handleButtonInteraction(interaction), true);
  assert.equal(interaction.calls[0][0], "reply");
  assert.equal(interaction.calls[0][1].content, "Нет прав.");
});

test("close modal rejects moderator role without admin permissions", async () => {
  const db = {};
  const draft = setAntiteamDraft(db, "author-1", {
    userTag: "Author",
    roblox: { userId: "101", username: "Anchor" },
    level: "medium",
    count: "2-4",
    description: "Нужна помощь.",
  }, { now: "2026-05-16T10:00:00.000Z" });
  createAntiteamTicketFromDraft(db, draft, {
    id: "ticket-1",
    now: "2026-05-16T10:01:00.000Z",
  });

  const operator = createAntiteamOperator({
    db,
    saveDb() {},
    isModerator: () => true,
  });
  const interaction = createModalInteraction(
    ticketButtonId("close_modal", "ticket-1"),
    { summary: "готово" },
    { id: "mod-1", username: "Mod" },
    {
      permissions: { has: () => false },
      roles: { cache: new Map() },
    }
  );

  assert.equal(await operator.handleModalSubmitInteraction(interaction), true);
  assert.equal(interaction.calls[0][0], "reply");
  assert.equal(interaction.calls[0][1].content, "Нет прав.");
});

test("draft submit asks for photo when photo toggle is enabled", async () => {
  const db = {};
  ensureAntiteamState(db).state.config.channelId = "channel-1";
  setAntiteamDraft(db, "user-1", {
    userTag: "User",
    roblox: { userId: "101", username: "Anchor" },
    description: "Два ника около 4k.",
    photoWanted: true,
  }, { now: "2026-05-16T10:00:00.000Z" });
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:01:00.000Z",
    saveDb() {},
  });
  const interaction = createButtonInteraction(ANTITEAM_CUSTOM_IDS.submitDraft, { id: "user-1", username: "User" });

  assert.equal(await operator.handleButtonInteraction(interaction), true);
  assert.equal(db.sot.antiteam.photoRequests["user-1"].channelId, "channel-1");
  assert.match(JSON.stringify(interaction.calls.at(-1)[1].components[0].toJSON()), /Фото к заявке/);
});

test("clan draft submit publishes without photo", async () => {
  const db = {};
  ensureAntiteamState(db).state.config.channelId = "channel-1";
  setAntiteamDraft(db, "caller-1", {
    kind: "clan",
    userTag: "Caller",
    anchorUserId: "anchor-1",
    anchorUserTag: "Anchor",
    roblox: { userId: "1265862594", username: "Krutoikira" },
    description: "ФАЙТ С ХН",
  }, { now: "2026-05-16T10:00:00.000Z" });
  const sentToChannel = [];
  const sentToThread = [];
  const thread = {
    id: "thread-1",
    isTextBased: () => true,
    messages: { fetch: async () => null },
    send: async (payload) => {
      sentToThread.push(payload);
      return { id: `thread-message-${sentToThread.length}` };
    },
  };
  const channel = {
    id: "channel-1",
    isTextBased: () => true,
    messages: { fetch: async () => null },
    send: async (payload) => {
      sentToChannel.push(payload);
      return {
        id: `message-${sentToChannel.length}`,
        startThread: async () => thread,
      };
    },
  };
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:01:00.000Z",
    saveDb() {},
    fetchChannel: async (channelId) => channelId === "channel-1" ? channel : thread,
  });
  const interaction = createButtonInteraction(ANTITEAM_CUSTOM_IDS.submitDraft, { id: "caller-1", username: "Caller" });

  assert.equal(await operator.handleButtonInteraction(interaction), true);

  const ticket = Object.values(db.sot.antiteam.tickets)[0];
  assert.equal(ticket.kind, "clan");
  assert.equal(sentToChannel.length, 2);
  assert.equal(sentToChannel[0].files, undefined);
  assert.match(JSON.stringify(sentToChannel[0].components[0].toJSON()), /ФАЙТ С ХН/);
  assert.deepEqual(interaction.calls.map((call) => call[0]), ["deferUpdate", "editReply"]);
  assert.match(interaction.calls.at(-1)[1].content, /Заявка опубликована/);
});

test("draft toggle and select acknowledge before editing the setup panel", async () => {
  const db = {};
  setAntiteamDraft(db, "user-1", {
    userTag: "User",
    roblox: { userId: "101", username: "Anchor" },
    description: "Тимятся двое у центра.",
  }, { now: "2026-05-16T10:00:00.000Z" });
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:01:00.000Z",
    saveDb() {},
  });

  const toggle = createButtonInteraction(ANTITEAM_CUSTOM_IDS.toggleDirect, { id: "user-1", username: "User" });
  assert.equal(await operator.handleButtonInteraction(toggle), true);
  assert.deepEqual(toggle.calls.map((call) => call[0]), ["deferUpdate", "editReply"]);

  const select = createSelectInteraction(ANTITEAM_CUSTOM_IDS.countSelect, ["4-10"]);
  assert.equal(await operator.handleSelectMenuInteraction(select), true);
  assert.deepEqual(select.calls.map((call) => call[0]), ["deferUpdate", "editReply"]);
  assert.equal(db.sot.antiteam.drafts["user-1"].count, "4-10");
});

test("description modal updates the same setup message when update is available", async () => {
  const db = {};
  setAntiteamDraft(db, "user-1", {
    userTag: "User",
    roblox: { userId: "101", username: "Anchor" },
  }, { now: "2026-05-16T10:00:00.000Z" });
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:01:00.000Z",
    saveDb() {},
  });
  const interaction = createModalInteraction("at:desc:modal", { description: "Бить A/B у центра." });
  interaction.update = async (payload) => {
    interaction.calls.push(["update", payload]);
  };

  assert.equal(await operator.handleModalSubmitInteraction(interaction), true);

  assert.equal(db.sot.antiteam.drafts["user-1"].description, "Бить A/B у центра.");
  assert.deepEqual(interaction.calls.map((call) => call[0]), ["update"]);
  assert.match(JSON.stringify(interaction.calls[0][1].components[0].toJSON()), /Бить A\/B у центра/);
});

test("moderator stats controls delete one helper and clear the aggregate table", async () => {
  const db = {};
  const state = ensureAntiteamState(db).state;
  state.stats.helpers["helper-1"] = { responded: 2, linkGranted: 2, confirmedArrived: 1, lastHelpedAt: "2026-05-16T10:00:00.000Z" };
  state.stats.helpers["helper-2"] = { responded: 1, linkGranted: 1, confirmedArrived: 0, lastHelpedAt: "2026-05-16T10:01:00.000Z" };
  const operator = createAntiteamOperator({
    db,
    saveDb() {},
  });
  const member = { permissions: { has: () => true }, roles: { cache: new Map() } };

  const open = createButtonInteraction(ANTITEAM_CUSTOM_IDS.stats, { id: "mod-1", username: "Mod" });
  open.member = member;
  assert.equal(await operator.handleButtonInteraction(open), true);
  assert.match(JSON.stringify(open.calls[0][1].components[0].toJSON()), /Статистика помощи/);

  const deleteOne = createButtonInteraction("at:stats:delete:helper-1:0", { id: "mod-1", username: "Mod" });
  deleteOne.member = member;
  assert.equal(await operator.handleButtonInteraction(deleteOne), true);
  assert.equal(db.sot.antiteam.stats.helpers["helper-1"], undefined);
  assert.equal(db.sot.antiteam.stats.helpers["helper-2"].responded, 1);

  const clearAll = createButtonInteraction(ANTITEAM_CUSTOM_IDS.statsClearConfirm, { id: "mod-1", username: "Mod" });
  clearAll.member = member;
  assert.equal(await operator.handleButtonInteraction(clearAll), true);
  assert.deepEqual(db.sot.antiteam.stats.helpers, {});
});

test("photo collector publishes ticket with reattached image and deletes upload", async () => {
  const db = {};
  ensureAntiteamState(db).state.config.channelId = "channel-1";
  setAntiteamDraft(db, "user-1", {
    userTag: "User",
    roblox: { userId: "101", username: "Anchor" },
    description: "Тимятся у центра, нужны A/B.",
    photoWanted: true,
  }, { now: "2026-05-16T10:00:00.000Z" });
  const state = ensureAntiteamState(db).state;
  state.photoRequests["user-1"] = {
    userId: "user-1",
    channelId: "channel-1",
    createdAt: "2026-05-16T10:00:10.000Z",
  };

  const sentToChannel = [];
  const sentToThread = [];
  const thread = {
    id: "thread-1",
    isTextBased: () => true,
    messages: { fetch: async () => null },
    send: async (payload) => {
      sentToThread.push(payload);
      return { id: `thread-message-${sentToThread.length}` };
    },
  };
  const channel = {
    id: "channel-1",
    isTextBased: () => true,
    messages: { fetch: async () => null },
    send: async (payload) => {
      sentToChannel.push(payload);
      return {
        id: `message-${sentToChannel.length}`,
        startThread: async () => thread,
      };
    },
  };
  let deleted = false;
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:01:00.000Z",
    saveDb() {},
    fetchChannel: async () => channel,
  });

  assert.equal(await operator.handlePhotoMessage({
    author: { id: "user-1", bot: false },
    channelId: "channel-1",
    attachments: new Map([["a1", {
      url: "https://cdn.discordapp.com/attachments/1/2/team.png",
      name: "team.png",
      contentType: "image/png",
      size: 1234,
    }]]),
    delete: async () => {
      deleted = true;
    },
  }), true);

  const ticket = Object.values(db.sot.antiteam.tickets)[0];
  assert.equal(ticket.message.photoAttachmentName, "team.png");
  assert.equal(sentToChannel[0].files[0].name, "team.png");
  assert.equal(deleted, true);
});

test("closing ticket edits messages and renames thread with gray marker", async () => {
  const db = {};
  const draft = setAntiteamDraft(db, "author-1", {
    userTag: "Author",
    roblox: { userId: "101", username: "Anchor" },
    level: "high",
    count: "2-4",
    description: "Цели A/B.",
  }, { now: "2026-05-16T10:00:00.000Z" });
  createAntiteamTicketFromDraft(db, draft, {
    id: "ticket-1",
    now: "2026-05-16T10:01:00.000Z",
  });
  db.sot.antiteam.tickets["ticket-1"].message = {
    channelId: "channel-1",
    messageId: "message-1",
    threadId: "thread-1",
    threadPanelMessageId: "thread-panel-1",
  };
  let publicEdit = null;
  let threadPanelEdit = null;
  let renamedTo = "";
  const channel = {
    messages: {
      fetch: async () => ({
        edit: async (payload) => {
          publicEdit = payload;
        },
      }),
    },
  };
  const thread = {
    setName: async (name) => {
      renamedTo = name;
    },
    messages: {
      fetch: async () => ({
        edit: async (payload) => {
          threadPanelEdit = payload;
        },
      }),
    },
  };
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:02:00.000Z",
    saveDb() {},
    fetchChannel: async (channelId) => channelId === "channel-1" ? channel : thread,
  });
  const interaction = createModalInteraction(
    ticketButtonId("close_modal", "ticket-1"),
    { summary: "готово" },
    { id: "author-1", username: "Author" }
  );

  assert.equal(await operator.handleModalSubmitInteraction(interaction), true);

  assert.equal(renamedTo, "⚫ 2-4 тимеров • Author");
  assert.match(JSON.stringify(publicEdit.components[0].toJSON()), /⚫ Завершено • 2-4 тимеров/);
  assert.match(JSON.stringify(threadPanelEdit.components[0].toJSON()), /✅ Закрыто/);
});

test("closing ticket removes ping message, locks thread, archives it, and removes non-admin members", async () => {
  const db = {};
  const draft = setAntiteamDraft(db, "author-1", {
    userTag: "Author",
    roblox: { userId: "101", username: "Anchor" },
    level: "high",
    count: "2-4",
    description: "Цели A/B.",
  }, { now: "2026-05-16T10:00:00.000Z" });
  createAntiteamTicketFromDraft(db, draft, {
    id: "ticket-1",
    now: "2026-05-16T10:01:00.000Z",
  });
  db.sot.antiteam.tickets["ticket-1"].message = {
    channelId: "channel-1",
    messageId: "message-1",
    threadId: "thread-1",
    threadPanelMessageId: "thread-panel-1",
    pingMessageId: "ping-1",
  };

  let pingDeleted = false;
  let archived = null;
  let locked = null;
  const removedMembers = [];
  const channel = {
    messages: {
      fetch: async () => ({
        edit: async () => {},
      }),
    },
  };
  const thread = {
    setName: async () => {},
    setArchived: async (value) => {
      archived = value;
    },
    setLocked: async (value) => {
      locked = value;
    },
    members: {
      fetch: async () => new Map([
        ["author-1", { id: "author-1", user: { id: "author-1", bot: false } }],
        ["helper-1", { id: "helper-1", user: { id: "helper-1", bot: false } }],
        ["admin-1", { id: "admin-1", user: { id: "admin-1", bot: false }, permissions: { has: () => true } }],
      ]),
      remove: async (userId) => {
        removedMembers.push(userId);
      },
    },
    messages: {
      fetch: async (messageId) => {
        if (messageId === "ping-1") {
          return {
            delete: async () => {
              pingDeleted = true;
            },
          };
        }
        return {
          edit: async () => {},
        };
      },
    },
  };
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:02:00.000Z",
    saveDb() {},
    fetchChannel: async (channelId) => channelId === "channel-1" ? channel : thread,
  });
  const interaction = createModalInteraction(
    ticketButtonId("close_modal", "ticket-1"),
    { summary: "готово" },
    { id: "author-1", username: "Author" }
  );

  assert.equal(await operator.handleModalSubmitInteraction(interaction), true);

  assert.equal(pingDeleted, true);
  assert.equal(archived, true);
  assert.equal(locked, true);
  assert.deepEqual(removedMembers, ["helper-1"]);
});

test("closing ticket writes helper result markers into the public message", async () => {
  const db = {};
  const draft = setAntiteamDraft(db, "author-1", {
    userTag: "Author",
    roblox: { userId: "101", username: "Anchor" },
    level: "high",
    count: "2-4",
    description: "Цели A/B.",
  }, { now: "2026-05-16T10:00:00.000Z" });
  createAntiteamTicketFromDraft(db, draft, {
    id: "ticket-1",
    now: "2026-05-16T10:01:00.000Z",
  });
  db.sot.antiteam.tickets["ticket-1"].helpers = {
    "helper-1": {
      userId: "helper-1",
      discordTag: "Helper 1",
      respondedAt: "2026-05-16T10:02:00.000Z",
      arrived: true,
    },
    "helper-2": {
      userId: "helper-2",
      discordTag: "Helper 2",
      respondedAt: "2026-05-16T10:03:00.000Z",
      arrived: false,
    },
  };
  db.sot.antiteam.tickets["ticket-1"].message = {
    channelId: "channel-1",
    messageId: "message-1",
    threadId: "thread-1",
    threadPanelMessageId: "thread-panel-1",
  };

  let publicEdit = null;
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:04:00.000Z",
    saveDb() {},
    fetchChannel: async (channelId) => channelId === "channel-1"
      ? {
        messages: {
          fetch: async () => ({
            edit: async (payload) => {
              publicEdit = payload;
            },
          }),
        },
      }
      : {
        setName: async () => {},
        messages: {
          fetch: async () => ({
            edit: async () => {},
          }),
        },
      },
  });
  const interaction = createModalInteraction(
    ticketButtonId("close_modal", "ticket-1"),
    { summary: "готово" },
    { id: "author-1", username: "Author" }
  );

  assert.equal(await operator.handleModalSubmitInteraction(interaction), true);

  assert.match(JSON.stringify(publicEdit.components[0].toJSON()), /### Помощники/);
  assert.match(JSON.stringify(publicEdit.components[0].toJSON()), /✅ <@helper-1> • ❌ <@helper-2>/);
});

test("auto-close reuses thread cleanup and archives the mission", async () => {
  const db = {};
  const state = ensureAntiteamState(db).state;
  state.config.missionAutoCloseMinutes = 120;
  const draft = setAntiteamDraft(db, "author-1", {
    userTag: "Author",
    roblox: { userId: "101", username: "Anchor" },
    level: "high",
    count: "2-4",
    description: "Цели A/B.",
  }, { now: "2026-05-16T10:00:00.000Z" });
  createAntiteamTicketFromDraft(db, draft, {
    id: "ticket-1",
    now: "2026-05-16T10:01:00.000Z",
  });
  db.sot.antiteam.tickets["ticket-1"].message = {
    channelId: "channel-1",
    messageId: "message-1",
    threadId: "thread-1",
    threadPanelMessageId: "thread-panel-1",
    pingMessageId: "ping-1",
  };
  db.sot.antiteam.tickets["ticket-1"].lastActivityAt = "2026-05-16T10:01:00.000Z";

  let archived = false;
  let locked = false;
  let pingDeleted = false;
  const removedMembers = [];
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T12:05:00.000Z",
    saveDb() {},
    fetchChannel: async (channelId) => channelId === "channel-1"
      ? {
        messages: {
          fetch: async () => ({
            edit: async () => {},
          }),
        },
      }
      : {
        setName: async () => {},
        setArchived: async () => {
          archived = true;
        },
        setLocked: async () => {
          locked = true;
        },
        members: {
          fetch: async () => new Map([
            ["author-1", { id: "author-1", user: { id: "author-1", bot: false } }],
            ["helper-1", { id: "helper-1", user: { id: "helper-1", bot: false } }],
          ]),
          remove: async (userId) => {
            removedMembers.push(userId);
          },
        },
        messages: {
          fetch: async (messageId) => messageId === "ping-1"
            ? {
              delete: async () => {
                pingDeleted = true;
              },
            }
            : {
              edit: async () => {},
            },
        },
      },
  });

  const result = await operator.sweepIdleTickets();

  assert.equal(result.closedCount, 1);
  assert.equal(db.sot.antiteam.tickets["ticket-1"].status, "closed");
  assert.equal(pingDeleted, true);
  assert.equal(locked, true);
  assert.equal(archived, true);
  assert.deepEqual(removedMembers, ["helper-1"]);
});

test("advanced config modal updates timing and Roblox link settings", async () => {
  const db = {};
  ensureAntiteamState(db);
  const operator = createAntiteamOperator({
    db,
    saveDb() {},
  });
  const interaction = createModalInteraction(
    "at:config_advanced:modal",
    {
      archive_minutes: "1440",
      close_minutes: "180",
      place_id: "12345",
      direct_join_template: "https://example.test/start?placeId={placeId}&gameId={gameId}",
      friend_requests_url: "https://example.test/friends",
    },
    { id: "mod-1", username: "Mod" },
    { permissions: { has: () => true }, roles: { cache: new Map() } }
  );

  assert.equal(await operator.handleModalSubmitInteraction(interaction), true);

  const config = db.sot.antiteam.config;
  assert.equal(config.missionAutoArchiveMinutes, 1440);
  assert.equal(config.missionAutoCloseMinutes, 180);
  assert.equal(config.roblox.jjsPlaceId, "12345");
  assert.equal(config.roblox.directJoinUrlTemplate, "https://example.test/start?placeId={placeId}&gameId={gameId}");
  assert.equal(config.roblox.friendRequestsUrl, "https://example.test/friends");
  assert.match(JSON.stringify(interaction.calls.at(-1)[1].components[0].toJSON()), /Roblox-ссылки/);
});

test("panel text modal updates and edits the published start panel", async () => {
  const db = {};
  const state = ensureAntiteamState(db).state;
  state.config.channelId = "channel-1";
  state.config.panelMessageId = "message-1";
  let editedPayload = null;
  const operator = createAntiteamOperator({
    db,
    saveDb() {},
    fetchChannel: async () => ({
      id: "channel-1",
      isTextBased: () => true,
      messages: {
        fetch: async () => ({
          id: "message-1",
          edit: async (payload) => {
            editedPayload = payload;
          },
        }),
      },
    }),
  });
  const interaction = createModalInteraction(
    "at:panel_text:modal",
    {
      title: "🔥 Срочный антитим",
      description: "Жми кнопку и собирай батальён.",
      details: "Укажи Roblox ник, угрозу и цели.",
      button_label: "🚨 Подать заявку",
      accent_color: "#AA2244",
    },
    { id: "mod-1", username: "Mod" },
    { permissions: { has: () => true }, roles: { cache: new Map() } }
  );

  assert.equal(await operator.handleModalSubmitInteraction(interaction), true);

  assert.equal(db.sot.antiteam.config.panel.title, "🔥 Срочный антитим");
  assert.equal(db.sot.antiteam.config.panel.accentColor, 0xAA2244);
  assert.match(JSON.stringify(editedPayload.components[0].toJSON()), /Срочный антитим/);
  assert.match(JSON.stringify(interaction.calls.at(-1)[1].components[0].toJSON()), /обновлена в канале/);
});
