"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { MessageFlags } = require("discord.js");
const { createTournamentOperator } = require("../src/tournament/operator");
const { ACTIONS, buildCustomId } = require("../src/tournament/commands");
const state = require("../src/tournament/state");

// announcement refreshes are debounced (~1.5s) and launch side-effects are
// fire-and-forget; wait long enough for them to settle.
const delay = (ms = 1700) => new Promise((r) => setTimeout(r, ms));
const isV2 = (payload) => Boolean(Number(payload && payload.flags) & MessageFlags.IsComponentsV2);

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
    // authoritative kills come from the profile snapshot now
    getPlayerSnapshot: async () => ({ approvedKills: 4200, killsSource: "profile", hasRobloxAccount: true }),
    logLine: async (line) => logs.push(line),
  });
  const interaction = createButtonInteraction(buildCustomId(ACTIONS.REG_USE_MAIN, tournament.id), calls);

  const handled = await operator.handleButtonInteraction(interaction);

  assert.equal(handled, true);
  assert.equal(state.registrationCount(state.getTournament(db, tournament.id)), 1);
  const reg = state.getRegistration(state.getTournament(db, tournament.id), "user-1");
  assert.equal(reg.effectiveKills, 4200, "authoritative kills resolved (never zero)");
  assert.ok(calls.indexOf("deferUpdate") < calls.indexOf("saveDb"), "expected interaction ack before save");
  assert.ok(logs.some((line) => /TOURNAMENT_REGISTER:/.test(line)), "expected register log");
  // announcement refresh is debounced — fires shortly after, not synchronously
  await delay();
  assert.ok(calls.includes("announcementEdit"), "expected debounced announcement edit");
  assert.match(JSON.stringify(message.editedPayload), /Занято мест: 1 \/ 16/);
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
    getPlayerSnapshot: async () => ({ approvedKills: 4200, killsSource: "profile", hasRobloxAccount: true }),
    logLine: async (line) => logs.push(line),
  });
  const interaction = createButtonInteraction(buildCustomId(ACTIONS.REG_USE_MAIN, tournament.id), calls);

  const handled = await operator.handleButtonInteraction(interaction);

  assert.equal(handled, true);
  assert.ok(logs.some((line) => /TOURNAMENT_REGISTER:/.test(line)), "expected register log");
  // the (debounced) announcement refresh relinks to the visible message
  await delay();
  assert.ok(calls.includes("visibleAnnouncementEdit"), "expected recent visible announcement to be edited");
  assert.equal(state.getTournament(db, tournament.id).announce.messageId, "visible-message");
  assert.match(JSON.stringify(visibleMessage.editedPayload), /Занято мест: 1 \/ 16/);
  assert.ok(logs.some((line) => /TOURNAMENT_ANNOUNCE_RELINK/.test(line)));
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
  assert.match(JSON.stringify(channel.sentPayload), /Занято мест: 6 \/ 16/);
  assert.match(JSON.stringify(interaction.editedPayload), /Анонс: republished/);
  // management panel is now a Components V2 message (ephemeral flag stripped on update, V2 flag kept)
  assert.ok(isV2(interaction.editedPayload), "expected V2 management panel");
  assert.equal(Number(interaction.editedPayload.flags) & MessageFlags.Ephemeral, 0, "ephemeral flag stripped on update");
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
  // form duels now defers, so the roster (V2) lands in editedPayload
  const rosterJson = JSON.stringify(interaction.editedPayload);
  assert.match(rosterJson, /ZeroMain/);
  assert.match(rosterJson, /8[\s ]?275/);
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
  // withdrawal notice is now a Components V2 message (text lives in components)
  assert.ok(isV2(interaction.editedPayload), "expected V2 withdrawal notice");
  assert.match(JSON.stringify(interaction.editedPayload), /распределение сброшено/i);
  assert.ok(logs.some((line) => /TOURNAMENT_WITHDRAW:/.test(line) && /playReset=yes/.test(line)));
});

test("tournament launch persists a runnable bracket even when the private thread fails", async () => {
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
  // bracket is persisted + runnable immediately, regardless of the thread
  const server = state.getServer(state.getTournament(db, tournament.id), 0);
  assert.ok(server && server.launched && server.currentStage, "bracket persisted on launch");
  assert.equal(state.getTournament(db, tournament.id).status, "running");
  assert.match(JSON.stringify(interaction.editedPayload), /Панель боёв готова/i);
  // thread failure is recorded by the background side-effects (not fatal)
  await delay(60);
  assert.equal(state.getServer(state.getTournament(db, tournament.id), 0).threadFailed, true);
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
  // bracket persists synchronously; thread/ping happen in the background
  const server = state.getServer(state.getTournament(db, tournament.id), 0);
  assert.equal(server.launched, true);
  assert.ok(server.currentStage, "bracket persisted");
  assert.match(JSON.stringify(interaction.editedPayload), /Панель боёв готова/i);
  await delay(60);
  const settled = state.getServer(state.getTournament(db, tournament.id), 0);
  assert.equal(settled.threadId, "thread-1");
  assert.equal(settled.launchMessageId, "launch-message-1");
  assert.equal(settled.threadFailed, false);
  assert.deepEqual(addedMembers, ["100000000000000001", "100000000000000002"]);
  assert.equal(lockedValue, true, "participant thread is locked so players can't chat");
});

test("match panel acks each tap and repaints via a single coalesced render; supports one-tap re-pick", async () => {
  const seeding = require("../src/tournament/seeding");
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
      accountKind: "main",
      approvedKills: i * 1000,
      effectiveKills: i * 1000,
    });
  }
  const channel = {
    id: "channel-1",
    async send() { return { id: "m1" }; },
    threads: {
      async create() {
        return { id: "th", async send() { return { id: "x" }; }, members: { async add() {} }, async setLocked() {} };
      },
    },
  };
  const operator = createTournamentOperator({
    db,
    saveDb: () => {},
    runSerializedMutation: async ({ mutate }) => mutate(),
    isModerator: (member) => Boolean(member?.mod),
    fetchChannel: async () => channel,
  });

  const launch = createButtonInteraction(buildCustomId(ACTIONS.MANAGE_LAUNCH_SERVER, tournament.id, "0"));
  launch.member = { mod: true };
  launch.user = { id: "mod-1", tag: "mod#0001" };
  await operator.handleButtonInteraction(launch);

  const server = state.getServer(state.getTournament(db, tournament.id), 0);
  const match = seeding.listStageMatches(server.currentStage)[0];
  const redId = String(match.red.userId || match.red.id);
  const blueId = String(match.blue.userId || match.blue.id);

  // click RED winner — the tap is ack'd instantly with deferUpdate() (so Discord
  // never shows "interaction failed"), then the panel is repainted from
  // authoritative state via the coalescing renderer's editReply(). No racing
  // per-tap interaction.update() that could land out of order.
  const redCalls = [];
  const clickRed = createButtonInteraction(buildCustomId(ACTIONS.MATCH_WIN, tournament.id, "0", match.key, "r"), redCalls);
  clickRed.member = { mod: true };
  clickRed.user = { id: "mod-1", tag: "mod#0001" };
  await operator.handleButtonInteraction(clickRed);
  assert.deepEqual(redCalls, ["deferUpdate", "editReply"], "winner tap: instant ack, then a single coalesced repaint");
  assert.equal(state.getServer(state.getTournament(db, tournament.id), 0).decisions[match.key].winnerId, redId);

  // re-pick the OTHER side in one tap (buttons stay enabled — no undo dance)
  const blueCalls = [];
  const clickBlue = createButtonInteraction(buildCustomId(ACTIONS.MATCH_WIN, tournament.id, "0", match.key, "b"), blueCalls);
  clickBlue.member = { mod: true };
  clickBlue.user = { id: "mod-1", tag: "mod#0001" };
  await operator.handleButtonInteraction(clickBlue);
  assert.deepEqual(blueCalls, ["deferUpdate", "editReply"], "re-pick: ack + single repaint");
  assert.equal(state.getServer(state.getTournament(db, tournament.id), 0).decisions[match.key].winnerId, blueId, "winner switched in one tap");
  assert.match(JSON.stringify(clickBlue.editedPayload), /✅/, "chosen winner highlighted");

  // advancing the (placement) stage acks first, then repaints + completes
  const advCalls = [];
  const advance = createButtonInteraction(buildCustomId(ACTIONS.STAGE_ADVANCE, tournament.id, "0"), advCalls);
  advance.member = { mod: true };
  advance.user = { id: "mod-1", tag: "mod#0001" };
  await operator.handleButtonInteraction(advance);
  assert.deepEqual(advCalls, ["deferUpdate", "editReply"], "advance: instant ack, then a single repaint");
  assert.equal(state.getTournament(db, tournament.id).status, "completed");
  const champ = state.getServer(state.getTournament(db, tournament.id), 0).placement.first;
  assert.equal(String(champ.userId || champ.id), blueId, "the re-picked winner took the final");
});

test("the single bracket image is edited in place across advances; one run advance never finishes the server", async () => {
  const db = {};
  const tournament = state.createTournamentFromDraft(
    db,
    {
      name: "Кубок",
      slots: 16,
      startsAtIso: "2026-06-21T20:00:00.000Z",
      announceChannelId: "channel-1",
    },
    { id: "tour-1", now: "2026-06-21T18:00:00.000Z" }
  );
  for (let i = 1; i <= 16; i += 1) {
    state.upsertRegistration(tournament, {
      userId: `1000000000000000${i}`,
      discordName: `user-${i}`,
      robloxUsername: `Player${i}`,
      accountKind: "main",
      approvedKills: i * 1000,
      effectiveKills: i * 1000,
    });
  }

  // A channel that distinguishes a fresh post (send) from an in-place update
  // (edit) and serves the stored bracket message back through messages.fetch.
  const sends = [];
  const edits = [];
  let bracketMsg = null;
  const channel = {
    id: "channel-1",
    async send(payload) {
      sends.push(payload);
      if (!bracketMsg) bracketMsg = { id: "bracket-1", channelId: "channel-1", async edit(p) { edits.push(p); return this; } };
      return bracketMsg;
    },
    messages: { async fetch(id) { return id === "bracket-1" ? bracketMsg : null; } },
    threads: {
      async create() {
        return { id: "th", async send() { return { id: "th-msg" }; }, members: { async add() {} }, async setLocked() {} };
      },
    },
  };
  const operator = createTournamentOperator({
    db,
    saveDb: () => {},
    runSerializedMutation: async ({ mutate }) => mutate(),
    isModerator: (member) => Boolean(member?.mod),
    fetchChannel: async (id) => (id === "channel-1" ? channel : null),
  });
  const asMod = (interaction) => {
    interaction.member = { mod: true };
    interaction.user = { id: "mod-1", tag: "mod#0001" };
    return interaction;
  };

  await operator.handleButtonInteraction(asMod(createButtonInteraction(buildCustomId(ACTIONS.MANAGE_LAUNCH_SERVER, tournament.id, "0"))));
  await delay(80); // launch side-effects post the initial bracket in the background
  const sendsAfterLaunch = sends.length;
  assert.equal(sendsAfterLaunch, 1, "exactly one bracket is published at launch");
  const launched = state.getServer(state.getTournament(db, tournament.id), 0);
  assert.equal(launched.launchMessageId, "bracket-1");
  assert.ok(launched.currentStage.runs.length >= 2, "16-player stage 1 has multiple runs");

  const decideCurrentRunAndAdvance = async () => {
    const srv = state.getServer(state.getTournament(db, tournament.id), 0);
    const run = srv.currentStage.runs[srv.runIndex || 0];
    for (const match of run.matches) {
      await operator.handleButtonInteraction(asMod(createButtonInteraction(buildCustomId(ACTIONS.MATCH_WIN, tournament.id, "0", match.key, "r"))));
    }
    await operator.handleButtonInteraction(asMod(createButtonInteraction(buildCustomId(ACTIONS.STAGE_ADVANCE, tournament.id, "0"))));
    await delay(40); // bracket art update is fire-and-forget
  };

  // closing ONE run only moves the run cursor — the server stays alive
  await decideCurrentRunAndAdvance();
  const afterRun = state.getServer(state.getTournament(db, tournament.id), 0);
  assert.equal(afterRun.done, false, "one run advance must NOT finish the server");
  assert.equal(afterRun.runIndex, 1, "run cursor advanced to the next run");
  assert.equal(sends.length, sendsAfterLaunch, "no new image posted on advance — the first one is edited");
  assert.ok(edits.length >= 1, "the published bracket image was edited in place");

  // drive the rest to completion
  for (let guard = 0; guard < 30; guard += 1) {
    if (state.getServer(state.getTournament(db, tournament.id), 0).done) break;
    await decideCurrentRunAndAdvance();
  }
  const finished = state.getServer(state.getTournament(db, tournament.id), 0);
  assert.ok(finished.done, "server finished");
  assert.equal(state.getTournament(db, tournament.id).status, "completed");
  assert.ok(edits.length >= 2, "bracket kept being edited in place across advances");
  assert.equal(sends.length, sendsAfterLaunch + 1, "the only extra post is the grand summary — never a per-advance repost");
});
