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

test("roblox modal verifies user, writes binding, grants battalion role and creates draft", async () => {
  const db = {};
  ensureAntiteamState(db).state.config.battalionRoleId = "battalion-role";
  let binding = null;
  const granted = [];
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:00:00.000Z",
    saveDb() {},
    resolveRobloxUserByUsername: async () => ({ id: "101", name: "Anchor", displayName: "Anchor Display" }),
    writeRobloxBinding: async (userId, robloxUser, source) => {
      binding = { userId, robloxUser, source };
    },
    grantRole: async (userId, roleId) => {
      granted.push({ userId, roleId });
    },
  });
  const interaction = createModalInteraction("at:roblox", { roblox_username: "Anchor" });

  assert.equal(await operator.handleModalSubmitInteraction(interaction), true);

  assert.equal(binding.userId, "user-1");
  assert.equal(binding.source, "antiteam");
  assert.deepEqual(granted, [{ userId: "user-1", roleId: "battalion-role" }]);
  assert.equal(db.sot.antiteam.drafts["user-1"].roblox.username, "Anchor");
  assert.equal(interaction.calls[0][0], "deferReply");
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
  assert.match(JSON.stringify(interaction.calls[1][1].components[0].toJSON()), /Roblox взят из твоего профиля/);
});

test("help button records friend-request path and notifies author", async () => {
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
  assert.equal(threadNotices.length, 2);
  assert.equal(dm.length, 0);
  assert.match(threadNotices[0].content, /<@author-1>/);
  assert.match(threadNotices[0].content, /<@helper-1> сейчас отправит тебе friend request/);
  assert.match(threadNotices[0].content, /Принять заявки/);
  assert.deepEqual(threadNotices[0].allowedMentions.users, ["author-1", "helper-1"]);
  assert.match(JSON.stringify(interaction.calls.at(-1)[1].components[0].toJSON()), /Помощь принята/);
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

  assert.equal(threadNotices.length, 1);
  assert.match(threadNotices[0].content, /<@anchor-1>/);
  assert.match(threadNotices[0].content, /клан-аларму/);
  assert.deepEqual(threadNotices[0].allowedMentions.users, ["anchor-1", "helper-1"]);
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

  assert.equal(renamedTo, "⚫ 2-4 тимера • Author");
  assert.match(JSON.stringify(publicEdit.components[0].toJSON()), /⚫ Антитим/);
  assert.match(JSON.stringify(threadPanelEdit.components[0].toJSON()), /⚫ Миссия закрыта/);
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
