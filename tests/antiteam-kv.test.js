"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createAntiteamOperator } = require("../src/antiteam/operator");
const { ANTITEAM_CUSTOM_IDS, ticketButtonId } = require("../src/antiteam/view");
const {
  createAntiteamTicketFromDraft,
  ensureAntiteamState,
  setAntiteamDraft,
} = require("../src/antiteam/state");

function createButtonInteraction(customId, user = { id: "user-1", username: "User" }, member = { permissions: { has: () => false }, roles: { cache: new Map() } }) {
  const calls = [];
  return {
    calls,
    customId,
    user,
    member,
    isButton: () => true,
    async reply(payload) { calls.push(["reply", payload]); this.replied = true; },
    async update(payload) { calls.push(["update", payload]); this.replied = true; },
    async deferUpdate() { calls.push(["deferUpdate"]); this.deferred = true; },
    async deferReply(payload) { calls.push(["deferReply", payload]); this.deferred = true; },
    async editReply(payload) { calls.push(["editReply", payload]); },
    async showModal(payload) { calls.push(["showModal", payload]); this.replied = true; },
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
    async reply(payload) { calls.push(["reply", payload]); this.replied = true; },
    async deferUpdate() { calls.push(["deferUpdate"]); this.deferred = true; },
    async editReply(payload) { calls.push(["editReply", payload]); },
  };
}

function createModalInteraction(customId, fields = {}, user = { id: "user-1", username: "User" }) {
  const calls = [];
  return {
    calls,
    customId,
    user,
    member: { permissions: { has: () => false }, roles: { cache: new Map() } },
    isModalSubmit: () => true,
    fields: { getTextInputValue(name) { return fields[name] || ""; } },
    async deferReply(payload) { calls.push(["deferReply", payload]); this.deferred = true; },
    async editReply(payload) { calls.push(["editReply", payload]); },
    async reply(payload) { calls.push(["reply", payload]); this.replied = true; },
  };
}

function buildPublishChannelMocks() {
  const sentToChannel = [];
  const sentToThread = [];
  const thread = {
    id: "thread-1",
    guildId: "guild-1",
    locked: false,
    archived: false,
    isTextBased: () => true,
    messages: { fetch: async () => ({ edit: async () => {} }) },
    setName: async () => {},
    setLocked: async () => { thread.locked = true; },
    setArchived: async () => { thread.archived = true; },
    send: async (payload) => {
      sentToThread.push(payload);
      return { id: `thread-message-${sentToThread.length}`, edit: async () => {}, delete: async () => {} };
    },
  };
  const channel = {
    id: "channel-1",
    guildId: "guild-1",
    isTextBased: () => true,
    messages: { fetch: async () => ({ edit: async () => {} }) },
    send: async (payload) => {
      sentToChannel.push(payload);
      return {
        id: `message-${sentToChannel.length}`,
        guildId: "guild-1",
        edit: async () => {},
        startThread: async () => thread,
      };
    },
  };
  return { channel, thread, sentToChannel, sentToThread };
}

test("selecting КВ in the danger dropdown switches the draft into KV mode and drops the author Roblox", async () => {
  const db = {};
  setAntiteamDraft(db, "user-1", {
    userTag: "User",
    roblox: { userId: "101", username: "Main" },
    level: "medium",
    count: "3-5",
    description: "Старое описание.",
  }, { now: "2026-06-25T10:00:00.000Z" });
  const operator = createAntiteamOperator({ db, now: () => "2026-06-25T10:01:00.000Z", saveDb() {} });

  const select = createSelectInteraction(ANTITEAM_CUSTOM_IDS.levelSelect, ["kv"], { id: "user-1", username: "User" });
  assert.equal(await operator.handleSelectMenuInteraction(select), true);

  const draft = db.sot.antiteam.drafts["user-1"];
  assert.equal(draft.kind, "kv");
  assert.equal(draft.roblox.userId, "");
  assert.match(JSON.stringify(select.calls.at(-1)[1].components[0].toJSON()), /ВОЗМОЖНО КВ/);
});

test("KV anchor modal records the anchor, reason and pulls the anchor profile Roblox", async () => {
  const db = {};
  setAntiteamDraft(db, "user-1", { kind: "kv", userTag: "User" }, { now: "2026-06-25T10:00:00.000Z" });
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-06-25T10:01:00.000Z",
    saveDb() {},
    getProfile: (userId) => userId === "1011666449963688027" ? {
      domains: { roblox: { userId: "555", username: "AnchorRb", displayName: "Anchor", verificationStatus: "verified" } },
    } : null,
    fetchMember: async (userId) => ({ user: { id: userId, username: "AnchorUser" } }),
  });

  const modal = createModalInteraction(
    "at:kv_anchor:modal",
    { anchor: "<@1011666449963688027>", anchor_note: "Это вход, держит точку и не ливает." },
    { id: "user-1", username: "User" }
  );
  assert.equal(await operator.handleModalSubmitInteraction(modal), true);

  const draft = db.sot.antiteam.drafts["user-1"];
  assert.equal(draft.anchorUserId, "1011666449963688027");
  assert.match(draft.anchorNote, /держит точку/);
  assert.equal(draft.roblox.userId, "555");
});

test("two concurrent submits create only one ticket", async () => {
  const db = {};
  const state = ensureAntiteamState(db).state;
  state.config.channelId = "channel-1";
  state.config.battalionRoleId = "battalion-role";
  setAntiteamDraft(db, "user-1", {
    userTag: "User",
    roblox: { userId: "101", username: "Main" },
    description: "Двое тимеров у центра.",
  }, { now: "2026-06-25T10:00:00.000Z" });
  const { channel } = buildPublishChannelMocks();
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-06-25T10:01:00.000Z",
    saveDb() {},
    saveDbDurable() {},
    fetchChannel: async () => channel,
  });

  const i1 = createButtonInteraction(ANTITEAM_CUSTOM_IDS.submitDraft, { id: "user-1", username: "User" });
  const i2 = createButtonInteraction(ANTITEAM_CUSTOM_IDS.submitDraft, { id: "user-1", username: "User" });
  const [r1, r2] = await Promise.all([
    operator.handleButtonInteraction(i1),
    operator.handleButtonInteraction(i2),
  ]);

  assert.equal(r1, true);
  assert.equal(r2, true);
  assert.equal(Object.keys(db.sot.antiteam.tickets).length, 1);
  const allText = [...i1.calls, ...i2.calls].map((call) => JSON.stringify(call[1] || "")).join(" ");
  assert.match(allText, /уже отправляется/);
});

test("KV submit publishes a pending-approval ticket pinging only the approval targets", async () => {
  const db = {};
  const state = ensureAntiteamState(db).state;
  state.config.channelId = "channel-1";
  state.config.battalionRoleId = "battalion-role";
  setAntiteamDraft(db, "user-1", {
    kind: "kv",
    userTag: "User",
    anchorUserId: "777",
    anchorUserTag: "AnchorUser",
    anchorNote: "Это вход, держит точку.",
    roblox: { userId: "555", username: "AnchorRb" },
  }, { now: "2026-06-25T10:00:00.000Z" });
  const { channel, sentToThread } = buildPublishChannelMocks();
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-06-25T10:01:00.000Z",
    saveDb() {},
    saveDbDurable() {},
    fetchChannel: async () => channel,
  });

  const submit = createButtonInteraction(ANTITEAM_CUSTOM_IDS.submitDraft, { id: "user-1", username: "User" });
  assert.equal(await operator.handleButtonInteraction(submit), true);

  const ticket = Object.values(db.sot.antiteam.tickets)[0];
  assert.equal(ticket.kind, "kv");
  assert.equal(ticket.status, "pending_approval");
  const ping = sentToThread.at(-1);
  assert.match(ping.content, /Возможно КВ/);
  assert.match(ping.content, /<@&1519762809066361037>/);
  assert.match(ping.content, /<@1011666449963688027>/);
  assert.deepEqual(ping.allowedMentions, { roles: ["1519762809066361037"], users: ["1011666449963688027"] });
  assert.ok(!sentToThread.some((p) => /battalion-role/.test(JSON.stringify(p))));
});

test("admin KV approval opens the ticket and pings everything in edit-test", async () => {
  const db = {};
  const state = ensureAntiteamState(db).state;
  state.config.channelId = "channel-1";
  state.config.editPingRoleIds = ["edit-1", "edit-2"];
  const draft = setAntiteamDraft(db, "author-1", {
    kind: "kv",
    userTag: "Author",
    anchorUserId: "777",
    anchorNote: "вход",
    roblox: { userId: "555", username: "AnchorRb" },
  }, { now: "2026-06-25T10:00:00.000Z" });
  createAntiteamTicketFromDraft(db, draft, { id: "kv-1", now: "2026-06-25T10:01:00.000Z" });
  db.sot.antiteam.tickets["kv-1"].message = {
    channelId: "channel-1", messageId: "m1", threadId: "thread-1", threadPanelMessageId: "tp1",
  };
  const { channel, thread, sentToThread } = buildPublishChannelMocks();
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-06-25T10:02:00.000Z",
    saveDb() {},
    saveDbDurable() {},
    fetchChannel: async (id) => id === "thread-1" ? thread : channel,
  });

  const approve = createButtonInteraction(
    ticketButtonId("kv_approve", "kv-1"),
    { id: "admin-1", username: "Admin" },
    { permissions: { has: () => true }, roles: { cache: new Map() } }
  );
  assert.equal(await operator.handleButtonInteraction(approve), true);

  assert.equal(db.sot.antiteam.tickets["kv-1"].status, "open");
  assert.equal(db.sot.antiteam.tickets["kv-1"].kvApproval.decision, "approved");
  assert.equal(db.sot.antiteam.tickets["kv-1"].kvApproval.decidedBy, "admin-1");
  assert.ok(sentToThread.some((p) => /<@&edit-1>/.test(JSON.stringify(p))));
});

test("admin KV rejection closes the ticket with nobody marked", async () => {
  const db = {};
  const state = ensureAntiteamState(db).state;
  state.config.channelId = "channel-1";
  const draft = setAntiteamDraft(db, "author-1", {
    kind: "kv",
    userTag: "Author",
    anchorUserId: "777",
    anchorNote: "вход",
    roblox: { userId: "555", username: "AnchorRb" },
  }, { now: "2026-06-25T10:00:00.000Z" });
  createAntiteamTicketFromDraft(db, draft, { id: "kv-1", now: "2026-06-25T10:01:00.000Z" });
  db.sot.antiteam.tickets["kv-1"].message = {
    channelId: "channel-1", messageId: "m1", threadId: "thread-1", threadPanelMessageId: "tp1",
  };
  const { channel, thread } = buildPublishChannelMocks();
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-06-25T10:02:00.000Z",
    saveDb() {},
    saveDbDurable() {},
    fetchChannel: async (id) => id === "thread-1" ? thread : channel,
  });

  const reject = createButtonInteraction(
    ticketButtonId("kv_reject", "kv-1"),
    { id: "admin-1", username: "Admin" },
    { permissions: { has: () => true }, roles: { cache: new Map() } }
  );
  assert.equal(await operator.handleButtonInteraction(reject), true);

  assert.equal(db.sot.antiteam.tickets["kv-1"].status, "cancelled");
  assert.equal(db.sot.antiteam.tickets["kv-1"].kvApproval.decision, "rejected");
  assert.equal(thread.locked, true);
  assert.deepEqual(db.sot.antiteam.stats.helpers, {});
});

test("KV approval is rejected for non-admins", async () => {
  const db = {};
  const state = ensureAntiteamState(db).state;
  state.config.channelId = "channel-1";
  const draft = setAntiteamDraft(db, "author-1", {
    kind: "kv",
    userTag: "Author",
    anchorUserId: "777",
    anchorNote: "вход",
    roblox: { userId: "555", username: "AnchorRb" },
  }, { now: "2026-06-25T10:00:00.000Z" });
  createAntiteamTicketFromDraft(db, draft, { id: "kv-1", now: "2026-06-25T10:01:00.000Z" });
  const operator = createAntiteamOperator({ db, now: () => "2026-06-25T10:02:00.000Z", saveDb() {} });

  const approve = createButtonInteraction(ticketButtonId("kv_approve", "kv-1"), { id: "user-2", username: "Rando" });
  assert.equal(await operator.handleButtonInteraction(approve), true);

  assert.equal(db.sot.antiteam.tickets["kv-1"].status, "pending_approval");
  assert.match(JSON.stringify(approve.calls.at(-1)[1]), /Нет прав/);
});
