"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createTournamentOperator } = require("../src/tournament/operator");
const { ACTIONS, buildCustomId } = require("../src/tournament/commands");
const state = require("../src/tournament/state");

function createModalInteraction(customId, values = {}, calls = []) {
  return {
    customId,
    user: { id: "mod-1", tag: "mod#0001" },
    member: { mod: true },
    deferred: false,
    replied: false,
    fields: {
      getTextInputValue(fieldId) {
        return values[fieldId] ?? "";
      },
    },
    async deferUpdate() {
      calls.push("deferUpdate");
      this.deferred = true;
    },
    async editReply(payload) {
      calls.push("editReply");
      this.editedPayload = payload;
      return payload;
    },
    async update(payload) {
      calls.push("update");
      this.updatedPayload = payload;
      return payload;
    },
    async reply(payload) {
      calls.push("reply");
      this.replied = true;
      this.replyPayload = payload;
      return payload;
    },
    async followUp(payload) {
      calls.push("followUp");
      this.followUpPayload = payload;
      return payload;
    },
    async showModal(payload) {
      calls.push("showModal");
      this.shownModal = payload;
      return payload;
    },
  };
}

function createButtonInteraction(customId, calls = []) {
  return {
    customId,
    user: { id: "user-1", tag: "user#0001" },
    member: {},
    deferred: false,
    replied: false,
    async deferUpdate() {
      calls.push("deferUpdate");
      this.deferred = true;
    },
    async editReply(payload) {
      calls.push("editReply");
      this.editedPayload = payload;
      return payload;
    },
    async update(payload) {
      calls.push("update");
      this.updatedPayload = payload;
      return payload;
    },
    async reply(payload) {
      calls.push("reply");
      this.replyPayload = payload;
      return payload;
    },
    async followUp(payload) {
      calls.push("followUp");
      this.followUpPayload = payload;
      return payload;
    },
  };
}

test("tournament rewards modal defers before saving and edits the setup panel", async () => {
  const calls = [];
  const db = {};
  const operator = createTournamentOperator({
    db,
    saveDb: () => calls.push("saveDb"),
    runSerializedMutation: async ({ mutate }) => {
      calls.push("mutate");
      return mutate();
    },
    isModerator: (member) => Boolean(member?.mod),
  });
  const interaction = createModalInteraction(
    buildCustomId(ACTIONS.SETUP_REWARDS),
    {
      first: "Роль победитель турнира",
      second: "ничего",
      third: "тройничёк с холмом и дешем",
      extra: "тестовая заметка",
    },
    calls
  );

  const handled = await operator.handleModalSubmitInteraction(interaction);

  assert.equal(handled, true);
  assert.deepEqual(calls, ["deferUpdate", "mutate", "saveDb", "editReply"]);
  assert.equal(db.tournament.drafts["mod-1"].rewards.first, "Роль победитель турнира");
  assert.ok(interaction.editedPayload, "expected setup panel edit after deferred modal submit");
});

test("tournament registration refreshes the public announcement and writes a log line", async () => {
  const calls = [];
  const logs = [];
  const db = {};
  const tournament = state.createTournamentFromDraft(
    db,
    {
      name: "Тестовый турнир",
      slots: 16,
      startsAtIso: "2026-06-21T20:00:00.000Z",
      announceChannelId: "channel-1",
    },
    { id: "tour-1", now: "2026-06-21T18:00:00.000Z" }
  );
  state.updateTournament(db, tournament.id, {
    announce: { channelId: "channel-1", messageId: "message-1" },
  });
  const message = {
    async edit(payload) {
      calls.push("announcementEdit");
      this.editedPayload = payload;
      return payload;
    },
  };
  const channel = {
    id: "channel-1",
    messages: {
      async fetch(messageId) {
        calls.push(`messageFetch:${messageId}`);
        return message;
      },
    },
  };
  const operator = createTournamentOperator({
    db,
    saveDb: () => calls.push("saveDb"),
    runSerializedMutation: async ({ mutate }) => mutate(),
    fetchChannel: async (channelId) => {
      calls.push(`channelFetch:${channelId}`);
      return channel;
    },
    logLine: async (line) => logs.push(line),
  });
  const interaction = createButtonInteraction(buildCustomId(ACTIONS.REG_USE_MAIN, tournament.id), calls);

  const handled = await operator.handleButtonInteraction(interaction);

  assert.equal(handled, true);
  assert.equal(state.registrationCount(state.getTournament(db, tournament.id)), 1);
  assert.ok(calls.indexOf("deferUpdate") < calls.indexOf("saveDb"), "expected interaction ack before save");
  assert.ok(calls.includes("announcementEdit"), "expected announcement message edit after registration");
  assert.match(JSON.stringify(message.editedPayload), /# \*\*1 \/ 16\*\*/);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /TOURNAMENT_REGISTER:/);
  assert.match(logs[0], /announcement=updated/);
});

test("tournament registration relinks and edits a visible announcement when stored message id is stale", async () => {
  const calls = [];
  const logs = [];
  const db = {};
  const tournament = state.createTournamentFromDraft(
    db,
    {
      name: "Тестовый турнир",
      slots: 16,
      startsAtIso: "2026-06-21T20:00:00.000Z",
      announceChannelId: "channel-1",
    },
    { id: "tour-1", now: "2026-06-21T18:00:00.000Z" }
  );
  state.updateTournament(db, tournament.id, {
    announce: { channelId: "channel-1", messageId: "stale-message" },
  });
  const visibleMessage = {
    id: "visible-message",
    channelId: "channel-1",
    components: [{ components: [{ customId: buildCustomId(ACTIONS.REGISTER_OPEN, tournament.id) }] }],
    async edit(payload) {
      calls.push("visibleAnnouncementEdit");
      this.editedPayload = payload;
      return payload;
    },
  };
  const channel = {
    id: "channel-1",
    messages: {
      async fetch(arg) {
        if (arg === "stale-message") {
          calls.push("staleFetch");
          return null;
        }
        calls.push("recentSearch");
        return new Map([[visibleMessage.id, visibleMessage]]);
      },
    },
  };
  const operator = createTournamentOperator({
    db,
    saveDb: () => calls.push("saveDb"),
    runSerializedMutation: async ({ mutate }) => mutate(),
    fetchChannel: async () => channel,
    logLine: async (line) => logs.push(line),
  });
  const interaction = createButtonInteraction(buildCustomId(ACTIONS.REG_USE_MAIN, tournament.id), calls);

  const handled = await operator.handleButtonInteraction(interaction);

  assert.equal(handled, true);
  assert.ok(calls.includes("visibleAnnouncementEdit"), "expected recent visible announcement to be edited");
  assert.equal(state.getTournament(db, tournament.id).announce.messageId, "visible-message");
  assert.match(JSON.stringify(visibleMessage.editedPayload), /# \*\*1 \/ 16\*\*/);
  assert.ok(logs.some((line) => /TOURNAMENT_ANNOUNCE_RELINK/.test(line)));
  assert.ok(logs.some((line) => /TOURNAMENT_REGISTER:/.test(line) && /announcement=relinked/.test(line)));
});

test("tournament manage refresh republishes the announcement when no editable message is found", async () => {
  const calls = [];
  const logs = [];
  const db = {};
  const tournament = state.createTournamentFromDraft(
    db,
    {
      name: "Тестовый турнир",
      slots: 16,
      startsAtIso: "2026-06-21T20:00:00.000Z",
      announceChannelId: "channel-1",
    },
    { id: "tour-1", now: "2026-06-21T18:00:00.000Z" }
  );
  state.updateTournament(db, tournament.id, {
    announce: { channelId: "channel-1", messageId: "missing-message" },
  });
  for (let i = 1; i <= 6; i += 1) {
    state.upsertRegistration(tournament, { userId: `user-${i}`, discordName: `user-${i}` });
  }
  const channel = {
    id: "channel-1",
    messages: {
      async fetch(arg) {
        calls.push(typeof arg === "string" ? `fetch:${arg}` : "recentSearch");
        return typeof arg === "string" ? null : new Map();
      },
    },
    async send(payload) {
      calls.push("announcementSend");
      this.sentPayload = payload;
      return { id: "new-message", channelId: "channel-1" };
    },
  };
  const operator = createTournamentOperator({
    db,
    saveDb: () => calls.push("saveDb"),
    runSerializedMutation: async ({ mutate }) => mutate(),
    isModerator: (member) => Boolean(member?.mod),
    fetchChannel: async () => channel,
    logLine: async (line) => logs.push(line),
  });
  const interaction = createButtonInteraction(buildCustomId(ACTIONS.MANAGE_REFRESH, tournament.id), calls);
  interaction.member = { mod: true };
  interaction.user = { id: "mod-1", tag: "mod#0001" };

  const handled = await operator.handleButtonInteraction(interaction);

  assert.equal(handled, true);
  assert.ok(calls.includes("announcementSend"), "expected manage refresh to republish missing announcement");
  assert.equal(state.getTournament(db, tournament.id).announce.messageId, "new-message");
  assert.match(JSON.stringify(channel.sentPayload), /# \*\*6 \/ 16\*\*/);
  assert.match(JSON.stringify(interaction.editedPayload), /Анонс: republished/);
  assert.equal(Object.prototype.hasOwnProperty.call(interaction.editedPayload, "flags"), false);
  assert.ok(logs.some((line) => /TOURNAMENT_MANAGE_REFRESH:/.test(line) && /announcement=republished/.test(line)));
});

test("tournament Roblox modal accepts id/name API results and opens kill selection for alt accounts", async () => {
  const calls = [];
  const db = {};
  const tournament = state.createTournamentFromDraft(
    db,
    {
      name: "Тестовый турнир",
      slots: 16,
      startsAtIso: "2026-06-21T20:00:00.000Z",
      announceChannelId: "channel-1",
    },
    { id: "tour-1", now: "2026-06-21T18:00:00.000Z" }
  );
  const operator = createTournamentOperator({
    db,
    resolveRobloxUser: async () => ({ id: "4242", name: "ZavozAccount", displayName: "Zavoz" }),
  });
  const interaction = createModalInteraction(
    buildCustomId(ACTIONS.REG_LINK_ROBLOX, tournament.id, "alt"),
    { nick: "https://www.roblox.com/users/4242/profile" },
    calls
  );

  const handled = await operator.handleModalSubmitInteraction(interaction);

  assert.equal(handled, true);
  assert.deepEqual(calls, ["deferUpdate", "editReply"]);
  const payloadJson = JSON.stringify(interaction.editedPayload);
  assert.match(payloadJson, /ZavozAccount/);
  assert.match(payloadJson, /Реальное количество килов/);
  assert.match(payloadJson, new RegExp(buildCustomId(ACTIONS.REG_PICK_KILLS, tournament.id, "alt").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("tournament Roblox modal writes main account lookups back into the shared nickname base", async () => {
  const calls = [];
  const writes = [];
  const db = {};
  const tournament = state.createTournamentFromDraft(
    db,
    {
      name: "Тестовый турнир",
      slots: 16,
      startsAtIso: "2026-06-21T20:00:00.000Z",
      announceChannelId: "channel-1",
    },
    { id: "tour-1", now: "2026-06-21T18:00:00.000Z" }
  );
  const operator = createTournamentOperator({
    db,
    resolveRobloxUser: async () => ({ id: "5151", name: "MainZavoz", avatarUrl: "https://example.test/avatar.png" }),
    writeRobloxBinding: async (userId, robloxUser, source) => writes.push({ userId, robloxUser, source }),
  });
  const interaction = createModalInteraction(
    buildCustomId(ACTIONS.REG_LINK_ROBLOX, tournament.id, "main"),
    { nick: "MainZavoz" },
    calls
  );
  interaction.user = { id: "user-1", tag: "user#0001" };

  const handled = await operator.handleModalSubmitInteraction(interaction);

  assert.equal(handled, true);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], {
    userId: "user-1",
    source: "tournament",
    robloxUser: {
      userId: "5151",
      id: "5151",
      username: "MainZavoz",
      name: "MainZavoz",
      displayName: "MainZavoz",
      avatarUrl: "https://example.test/avatar.png",
      profileUrl: null,
      createdAt: null,
      description: null,
      hasVerifiedBadge: undefined,
      accountStatus: null,
    },
  });
  assert.match(JSON.stringify(interaction.editedPayload), /MainZavoz/);
});

test("tournament form hydrates zero-kill main registrations before seeding", async () => {
  const calls = [];
  const logs = [];
  const snapshotCalls = [];
  const db = {};
  const tournament = state.createTournamentFromDraft(
    db,
    {
      name: "Тестовый турнир",
      slots: 16,
      startsAtIso: "2026-06-21T20:00:00.000Z",
      announceChannelId: "channel-1",
    },
    { id: "tour-1", now: "2026-06-21T18:00:00.000Z" }
  );
  state.upsertRegistration(tournament, {
    userId: "zero-main",
    discordName: "zero#0001",
    robloxUsername: "ZeroMain",
    accountKind: "main",
    approvedKills: 0,
    effectiveKills: 0,
  });
  state.upsertRegistration(tournament, {
    userId: "known-main",
    discordName: "known#0001",
    robloxUsername: "KnownMain",
    accountKind: "main",
    approvedKills: 3200,
    effectiveKills: 3200,
  });
  const operator = createTournamentOperator({
    db,
    saveDb: () => calls.push("saveDb"),
    runSerializedMutation: async ({ mutate }) => mutate(),
    isModerator: (member) => Boolean(member?.mod),
    getPlayerSnapshot: async (userId, context) => {
      snapshotCalls.push({ userId, context });
      return userId === "zero-main" ? { approvedKills: 8275 } : { approvedKills: 0 };
    },
    logLine: async (line) => logs.push(line),
  });
  const interaction = createButtonInteraction(buildCustomId(ACTIONS.MANAGE_FORM_DUELS, tournament.id), calls);
  interaction.member = { mod: true };
  interaction.user = { id: "mod-1", tag: "mod#0001" };

  const handled = await operator.handleButtonInteraction(interaction);

  assert.equal(handled, true);
  const repaired = state.getRegistration(state.getTournament(db, tournament.id), "zero-main");
  assert.equal(repaired.approvedKills, 8275);
  assert.equal(repaired.effectiveKills, 8275);
  assert.equal(repaired.seedNumber, 1);
  assert.equal(snapshotCalls[0].context.registration.robloxUsername, "ZeroMain");
  assert.match(JSON.stringify(interaction.replyPayload), /ZeroMain \(8\s*275\)/);
  assert.ok(logs.some((line) => /TOURNAMENT_KILLS_HYDRATE:/.test(line) && /repaired=1/.test(line)));
});

test("tournament withdraw resets stale seeded roster before play is launched", async () => {
  const calls = [];
  const logs = [];
  const db = {};
  const tournament = state.createTournamentFromDraft(
    db,
    {
      name: "Тестовый турнир",
      slots: 16,
      startsAtIso: "2026-06-21T20:00:00.000Z",
      announceChannelId: "channel-1",
    },
    { id: "tour-1", now: "2026-06-21T18:00:00.000Z" }
  );
  state.upsertRegistration(tournament, {
    userId: "user-1",
    discordName: "one#0001",
    robloxUsername: "One",
    approvedKills: 7000,
    effectiveKills: 7000,
    seedNumber: 1,
    serverIndex: 0,
  });
  state.upsertRegistration(tournament, {
    userId: "user-2",
    discordName: "two#0001",
    robloxUsername: "Two",
    approvedKills: 5000,
    effectiveKills: 5000,
    seedNumber: 2,
    serverIndex: 0,
  });
  state.updateTournament(db, tournament.id, { status: "seeded" });
  const operator = createTournamentOperator({
    db,
    saveDb: () => calls.push("saveDb"),
    runSerializedMutation: async ({ mutate }) => mutate(),
    logLine: async (line) => logs.push(line),
  });
  const interaction = createButtonInteraction(buildCustomId(ACTIONS.REG_WITHDRAW, tournament.id), calls);
  interaction.user = { id: "user-1", tag: "one#0001" };

  const handled = await operator.handleButtonInteraction(interaction);

  assert.equal(handled, true);
  const fresh = state.getTournament(db, tournament.id);
  assert.equal(state.getRegistration(fresh, "user-1"), null);
  assert.equal(fresh.status, "registration");
  assert.deepEqual(fresh.servers, {});
  assert.equal(state.getRegistration(fresh, "user-2").seedNumber, null);
  assert.equal(state.getRegistration(fresh, "user-2").serverIndex, null);
  assert.match(interaction.editedPayload.content, /распределение сброшено/i);
  assert.ok(logs.some((line) => /TOURNAMENT_WITHDRAW:/.test(line) && /playReset=yes/.test(line)));
});

test("tournament launch refuses to mark server running when private thread cannot be created", async () => {
  const calls = [];
  const logs = [];
  const db = {};
  const tournament = state.createTournamentFromDraft(
    db,
    {
      name: "Тестовый турнир",
      slots: 16,
      startsAtIso: "2026-06-21T20:00:00.000Z",
      announceChannelId: "channel-1",
    },
    { id: "tour-1", now: "2026-06-21T18:00:00.000Z" }
  );
  for (let i = 1; i <= 2; i += 1) {
    state.upsertRegistration(tournament, {
      userId: `10000000000000000${i}`,
      discordName: `user-${i}`,
      robloxUsername: `Player${i}`,
      approvedKills: i * 1000,
      effectiveKills: i * 1000,
    });
  }
  const channel = {
    id: "channel-1",
    async send() {
      calls.push("send");
      return { id: "message-1" };
    },
    threads: {
      async create() {
        calls.push("threadCreate");
        throw new Error("Missing Permissions");
      },
    },
  };
  const operator = createTournamentOperator({
    db,
    saveDb: () => calls.push("saveDb"),
    runSerializedMutation: async ({ mutate }) => mutate(),
    isModerator: (member) => Boolean(member?.mod),
    fetchChannel: async () => channel,
    logError: (...args) => logs.push(args.join(" ")),
  });
  const interaction = createButtonInteraction(buildCustomId(ACTIONS.MANAGE_LAUNCH_SERVER, tournament.id, "0"), calls);
  interaction.member = { mod: true };
  interaction.user = { id: "mod-1", tag: "mod#0001" };

  const handled = await operator.handleButtonInteraction(interaction);

  assert.equal(handled, true);
  assert.deepEqual(calls, ["deferUpdate", "threadCreate", "editReply"]);
  assert.equal(state.getServer(state.getTournament(db, tournament.id), 0), null);
  assert.equal(state.getTournament(db, tournament.id).status, "registration");
  assert.match(JSON.stringify(interaction.editedPayload), /Сервер не запущен/i);
  assert.ok(logs.some((line) => /private thread create failed/.test(line)));
});

test("tournament launch creates an unlocked private thread and adds real Discord players", async () => {
  const calls = [];
  const addedMembers = [];
  let lockedValue = null;
  const db = {};
  const tournament = state.createTournamentFromDraft(
    db,
    {
      name: "Тестовый турнир",
      slots: 16,
      startsAtIso: "2026-06-21T20:00:00.000Z",
      announceChannelId: "channel-1",
    },
    { id: "tour-1", now: "2026-06-21T18:00:00.000Z" }
  );
  for (let i = 1; i <= 2; i += 1) {
    state.upsertRegistration(tournament, {
      userId: `10000000000000000${i}`,
      discordName: `user-${i}`,
      robloxUsername: `Player${i}`,
      approvedKills: i * 1000,
      effectiveKills: i * 1000,
    });
  }
  const thread = {
    id: "thread-1",
    async send(payload) {
      calls.push(payload.content ? "threadPing" : "threadBracket");
      return { id: `thread-message-${calls.length}` };
    },
    members: {
      async add(userId) {
        addedMembers.push(userId);
      },
    },
    async setLocked(value) {
      lockedValue = value;
    },
  };
  const channel = {
    id: "channel-1",
    async send() {
      calls.push("announceSend");
      return { id: "launch-message-1" };
    },
    threads: {
      async create(options) {
        calls.push(`threadCreate:${options.type}`);
        return thread;
      },
    },
  };
  const operator = createTournamentOperator({
    db,
    saveDb: () => calls.push("saveDb"),
    runSerializedMutation: async ({ mutate }) => mutate(),
    isModerator: (member) => Boolean(member?.mod),
    fetchChannel: async () => channel,
  });
  const interaction = createButtonInteraction(buildCustomId(ACTIONS.MANAGE_LAUNCH_SERVER, tournament.id, "0"), calls);
  interaction.member = { mod: true };
  interaction.user = { id: "mod-1", tag: "mod#0001" };

  const handled = await operator.handleButtonInteraction(interaction);

  assert.equal(handled, true);
  const server = state.getServer(state.getTournament(db, tournament.id), 0);
  assert.equal(server.launched, true);
  assert.equal(server.threadId, "thread-1");
  assert.equal(server.launchMessageId, "launch-message-1");
  assert.deepEqual(addedMembers, ["100000000000000001", "100000000000000002"]);
  assert.equal(lockedValue, null);
  assert.match(JSON.stringify(interaction.editedPayload), /приватная ветка создана/i);
});
