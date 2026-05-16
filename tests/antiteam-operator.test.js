"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { MessageFlags } = require("discord.js");
const { createAntiteamOperator } = require("../src/antiteam/operator");
const { ANTITEAM_CUSTOM_IDS } = require("../src/antiteam/view");
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

test("start panel submit button opens the Roblox username modal", async () => {
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

  const dm = [];
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:02:00.000Z",
    saveDb() {},
    getProfile: () => ({ domains: { roblox: { userId: "202", username: "HelperRoblox", verificationStatus: "verified" } } }),
    sendDirectMessage: async (userId, payload) => {
      dm.push({ userId, payload });
    },
    fetchChannel: async () => null,
  });
  const interaction = createButtonInteraction("at:help:ticket-1");

  assert.equal(await operator.handleButtonInteraction(interaction), true);
  assert.equal(await operator.handleButtonInteraction(createButtonInteraction("at:help:ticket-1")), true);

  const ticket = db.sot.antiteam.tickets["ticket-1"];
  assert.equal(ticket.helpers["helper-1"].linkKind, "friend_request");
  assert.equal(db.sot.antiteam.stats.helpers["helper-1"].responded, 1);
  assert.equal(db.sot.antiteam.stats.helpers["helper-1"].linkGranted, 1);
  assert.equal(dm.length, 1);
  assert.equal(dm[0].userId, "author-1");
  assert.match(JSON.stringify(interaction.calls.at(-1)[1].components[0].toJSON()), /Помощь принята/);
});

test("draft submit asks for photo when photo toggle is enabled", async () => {
  const db = {};
  ensureAntiteamState(db).state.config.channelId = "channel-1";
  setAntiteamDraft(db, "user-1", {
    userTag: "User",
    roblox: { userId: "101", username: "Anchor" },
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

test("photo collector publishes ticket with reattached image and deletes upload", async () => {
  const db = {};
  ensureAntiteamState(db).state.config.channelId = "channel-1";
  setAntiteamDraft(db, "user-1", {
    userTag: "User",
    roblox: { userId: "101", username: "Anchor" },
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
