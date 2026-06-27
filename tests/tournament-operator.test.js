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
      return { id: "fu" };
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
    async deferReply() {
      calls.push("deferReply");
      this.deferred = true;
    },
    async deleteReply() {
      calls.push("deleteReply");
      this.deleted = true;
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
      return { id: "fu" };
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
  assert.match(JSON.stringify(message.editedPayload), /Основной состав: 1 \/ 16/);
});

test("tournament registration immediately shows a collecting notice and imports the kill proof image", async () => {
  const calls = [];
  const db = {};
  const tournament = state.createTournamentFromDraft(
    db,
    {
      name: "Proof Cup",
      slots: 16,
      startsAtIso: "2026-06-21T20:00:00.000Z",
      announceChannelId: "channel-1",
    },
    { id: "tour-1", now: "2026-06-21T18:00:00.000Z" }
  );
  const operator = createTournamentOperator({
    db,
    getPlayerSnapshot: async () => {
      calls.push("snapshot");
      await delay(5);
      return {
        hasRobloxAccount: true,
        robloxUsername: "ProofPlayer",
        robloxUserId: "424242",
        approvedKills: 4200,
        lastScreenshotUrl: "attachment://proof.png",
        lastScreenshotBuffer: Buffer.from("proof-image"),
        lastScreenshotFilename: "proof.png",
      };
    },
  });
  const interaction = createButtonInteraction(buildCustomId(ACTIONS.REGISTER_OPEN, tournament.id), calls);

  const handled = await operator.handleButtonInteraction(interaction);

  assert.equal(handled, true);
  assert.deepEqual(calls, ["reply", "snapshot", "editReply"]);
  assert.match(JSON.stringify(interaction.replyPayload), /Модератор собирает вашу заявку/);
  assert.match(JSON.stringify(interaction.editedPayload), /ProofPlayer/);
  assert.match(JSON.stringify(interaction.editedPayload), /attachment:\/\/proof\.png/);
  assert.doesNotMatch(JSON.stringify(interaction.editedPayload), /https:\/\/example\.test\/proof\.png/);
  assert.equal(interaction.editedPayload.files.length, 1, "proof image is re-uploaded as a Discord attachment");
  assert.equal(interaction.editedPayload.files[0].name, "proof.png");
});

test("tournament registrations over the planned field go to reserve and promote after withdrawal", async () => {
  const calls = [];
  const grants = [];
  const removals = [];
  const db = {};
  const tournament = state.createTournamentFromDraft(
    db,
    {
      name: "Queue Cup",
      slots: 4,
      plannedPlayers: 2,
      startsAtIso: "2026-06-21T20:00:00.000Z",
      announceChannelId: "channel-1",
      participantRoleId: "role-1",
    },
    { id: "tour-1", now: "2026-06-21T18:00:00.000Z" }
  );
  const operator = createTournamentOperator({
    db,
    saveDb: () => calls.push("saveDb"),
    runSerializedMutation: async ({ mutate }) => mutate(),
    getPlayerSnapshot: async (userId) => ({
      hasRobloxAccount: true,
      robloxUsername: `Player${userId.slice(-1)}`,
      robloxUserId: userId,
      approvedKills: 1000 + Number(userId.slice(-1)),
      killsSource: "profile",
    }),
    grantRole: async (userId) => {
      grants.push(userId);
      return { granted: true };
    },
    removeRole: async (userId) => {
      removals.push(userId);
      return { removed: true };
    },
  });
  const register = async (userId) => {
    const interaction = createButtonInteraction(buildCustomId(ACTIONS.REG_USE_MAIN, tournament.id), calls);
    interaction.user = { id: userId, tag: `${userId}#0001` };
    await operator.handleButtonInteraction(interaction);
    await delay(30);
    return interaction;
  };

  await register("100000000000000001");
  await register("100000000000000002");
  const third = await register("100000000000000003");

  const fresh = state.getTournament(db, tournament.id);
  assert.equal(state.registrationQueueInfo(fresh, "100000000000000001").active, true);
  assert.equal(state.registrationQueueInfo(fresh, "100000000000000002").active, true);
  assert.deepEqual(
    state.registrationQueueInfo(fresh, "100000000000000003"),
    { found: true, activeLimit: 2, position: 3, active: false, waitlistPosition: 1 }
  );
  assert.match(JSON.stringify(third.editedPayload), /резерв №1/);
  assert.ok(grants.includes("100000000000000001"));
  assert.ok(grants.includes("100000000000000002"));
  assert.equal(grants.includes("100000000000000003"), false, "waitlist user does not receive participant role");
  assert.ok(removals.includes("100000000000000003"), "waitlist role is removed if present");

  const withdraw = createButtonInteraction(buildCustomId(ACTIONS.REG_WITHDRAW, tournament.id), calls);
  withdraw.user = { id: "100000000000000001", tag: "first#0001" };
  await operator.handleButtonInteraction(withdraw);
  await delay(60);

  const promoted = state.registrationQueueInfo(state.getTournament(db, tournament.id), "100000000000000003");
  assert.equal(promoted.active, true, "first reserve moves into the active field");
  assert.ok(grants.includes("100000000000000003"), "promoted user receives the participant role");
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
  assert.match(JSON.stringify(visibleMessage.editedPayload), /Основной состав: 1 \/ 16/);
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
  assert.match(JSON.stringify(channel.sentPayload), /Основной состав: 6 \/ 16/);
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

test("tournament launch repairs phantom multi-server roster with missing server assignments", async () => {
  const calls = [];
  const logs = [];
  const db = {};
  const tournament = state.createTournamentFromDraft(
    db,
    {
      name: "Phantom Multi Cup",
      slots: 32,
      plannedPlayers: 32,
      startsAtIso: "2026-06-21T20:00:00.000Z",
      announceChannelId: "channel-1",
    },
    { id: "tour-1", now: "2026-06-21T18:00:00.000Z" }
  );
  tournament.isPhantom = true;
  for (const reg of state.buildPhantomRegistrations(32, { runTag: "lost" })) {
    state.upsertRegistration(tournament, reg);
  }
  state.updateTournament(db, tournament.id, { status: "seeded" });
  assert.equal(state.tournamentPlayers(tournament, { serverIndex: 0 }).length, 0, "fixture starts with the broken 0-player server split");

  const channel = {
    id: "channel-1",
    async send() {
      calls.push("send");
      return { id: "message-1" };
    },
    threads: {
      async create() {
        calls.push("threadCreate");
        return {
          id: "thread-1",
          async send() {
            calls.push("threadSend");
            return { id: "thread-message-1" };
          },
          members: { async add() {} },
          async setLocked() {},
        };
      },
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
  const interaction = createButtonInteraction(buildCustomId(ACTIONS.MANAGE_LAUNCH_SERVER, tournament.id, "0"), calls);
  interaction.member = { mod: true };
  interaction.user = { id: "mod-1", tag: "mod#0001" };

  const handled = await operator.handleButtonInteraction(interaction);

  assert.equal(handled, true);
  const fresh = state.getTournament(db, tournament.id);
  assert.equal(state.tournamentPlayers(fresh, { serverIndex: 0 }).length, 16);
  assert.equal(state.tournamentPlayers(fresh, { serverIndex: 1 }).length, 16);
  assert.ok(state.getServer(fresh, 0)?.launched, "server 1 launches after split repair");
  assert.equal(interaction.followUpPayload, undefined, "no insufficient-participants error");
  assert.ok(logs.some((line) => /TOURNAMENT_LAUNCH_RESEED/.test(line)));
  await delay(60);
});

test("tournament launch creates an unlocked private thread and adds real Discord players", async () => {
  const calls = [];
  const addedMembers = [];
  const threadPayloads = [];
  let threadCreateOptions = null;
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
      threadPayloads.push(payload);
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
        threadCreateOptions = options;
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
  assert.equal(threadCreateOptions.name, "Тестовый турнир · сервер 1");
  assert.ok(calls.indexOf("threadPing") < calls.indexOf("threadBracket"), "participant ping is the first thread message");
  assert.match(threadPayloads[0].content, /<@&1486459664546926866> <@100000000000000001> <@100000000000000002>/);
  assert.deepEqual(threadPayloads[0].allowedMentions, {
    users: ["100000000000000001", "100000000000000002"],
    roles: ["1486459664546926866"],
  });
  assert.equal(lockedValue, true, "participant thread is locked so players can't chat");
});

test("tournament stale roster actions after launch cannot clear a runnable server", async () => {
  const calls = [];
  const db = {};
  const tournament = state.createTournamentFromDraft(
    db,
    {
      name: "No Detach Cup",
      slots: 16,
      startsAtIso: "2026-06-21T20:00:00.000Z",
      announceChannelId: "channel-1",
    },
    { id: "tour-1", now: "2026-06-21T18:00:00.000Z" }
  );
  for (let i = 1; i <= 16; i += 1) {
    state.upsertRegistration(tournament, {
      userId: String(100000000000000000n + BigInt(i)),
      discordName: `user-${i}`,
      robloxUsername: `Player${i}`,
      approvedKills: i * 100,
      effectiveKills: i * 100,
    });
  }
  const channel = {
    id: "channel-1",
    async send() { return { id: "message-1", channelId: "channel-1" }; },
    threads: {
      async create() {
        return {
          id: "thread-1",
          async send() { return { id: "thread-message" }; },
          members: { async add() {} },
          async setLocked() {},
        };
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
  const asMod = (interaction) => {
    interaction.member = { mod: true };
    interaction.user = { id: "mod-1", tag: "mod#0001" };
    return interaction;
  };

  const launch = asMod(createButtonInteraction(buildCustomId(ACTIONS.MANAGE_LAUNCH_SERVER, tournament.id, "0"), calls));
  await operator.handleButtonInteraction(launch);
  const launchedStage = state.getServer(state.getTournament(db, tournament.id), 0)?.currentStage;
  assert.ok(launchedStage, "fixture must start with a launched runnable server");

  const staleForm = asMod(createButtonInteraction(buildCustomId(ACTIONS.MANAGE_FORM_DUELS, tournament.id), calls));
  await operator.handleButtonInteraction(staleForm);
  const afterForm = state.getServer(state.getTournament(db, tournament.id), 0);
  assert.equal(afterForm?.launched, true);
  assert.equal(afterForm?.currentStage, launchedStage, "stale mform must not reset tournament.servers");
  assert.match(JSON.stringify(staleForm.editedPayload), /пересобирать дуэты нельзя/);

  const staleFill = asMod(createButtonInteraction(buildCustomId(ACTIONS.MANAGE_FILL_ALL, tournament.id), calls));
  await operator.handleButtonInteraction(staleFill);
  const afterFill = state.getServer(state.getTournament(db, tournament.id), 0);
  assert.equal(afterFill?.launched, true);
  assert.equal(afterFill?.currentStage, launchedStage, "stale mfill must not reset the live server");
  assert.match(JSON.stringify(staleFill.editedPayload), /фантомами больше нельзя/);

  const open = asMod(createButtonInteraction(buildCustomId(ACTIONS.MANAGE_START, tournament.id, "0"), calls));
  await operator.handleButtonInteraction(open);
  assert.doesNotMatch(JSON.stringify(open.replyPayload), /Сначала запусти сервер/);
  await delay(60);
});

test("tournament launching the second server keeps both match panels reachable", async () => {
  const calls = [];
  const db = {};
  const tournament = state.createTournamentFromDraft(
    db,
    {
      name: "Two Server Cup",
      slots: 32,
      plannedPlayers: 32,
      startsAtIso: "2026-06-21T20:00:00.000Z",
      announceChannelId: "channel-1",
    },
    { id: "tour-1", now: "2026-06-21T18:00:00.000Z" }
  );
  state.updateTournament(db, tournament.id, { announce: { channelId: "channel-1", messageId: "announce-1" } });
  for (let i = 1; i <= 32; i += 1) {
    state.upsertRegistration(tournament, {
      userId: String(100000000000000000n + BigInt(i)),
      discordName: `user-${i}`,
      robloxUsername: `Player${i}`,
      approvedKills: i * 100,
      effectiveKills: i * 100,
    });
  }
  const channel = {
    id: "channel-1",
    async send() {
      return { id: `message-${calls.length + 1}`, channelId: "channel-1" };
    },
    threads: {
      async create() {
        return {
          id: `thread-${calls.length + 1}`,
          async send() { return { id: "thread-message" }; },
          members: { async add() {} },
          async setLocked() {},
        };
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
  const asMod = (interaction) => {
    interaction.member = { mod: true };
    interaction.user = { id: "mod-1", tag: "mod#0001" };
    return interaction;
  };

  const launch1 = asMod(createButtonInteraction(buildCustomId(ACTIONS.MANAGE_LAUNCH_SERVER, tournament.id, "0"), calls));
  await operator.handleButtonInteraction(launch1);
  const open1Before = asMod(createButtonInteraction(buildCustomId(ACTIONS.MANAGE_START, tournament.id, "0"), calls));
  await operator.handleButtonInteraction(open1Before);
  assert.match(JSON.stringify(open1Before.replyPayload), /Сервер 1/);
  assert.doesNotMatch(JSON.stringify(open1Before.replyPayload), /Сначала запусти сервер/);

  const launch2 = asMod(createButtonInteraction(buildCustomId(ACTIONS.MANAGE_LAUNCH_SERVER, tournament.id, "1"), calls));
  await operator.handleButtonInteraction(launch2);
  const launch2Panel = JSON.stringify(launch2.editedPayload);
  assert.match(launch2Panel, /Сервер 1 ✓/);
  assert.match(launch2Panel, /Сервер 2 ✓/);
  assert.match(launch2Panel, /Бои · сервер 1/);
  assert.match(launch2Panel, /Бои · сервер 2/);
  assert.doesNotMatch(launch2Panel, /Запустить сервер 1/);
  const fresh = state.getTournament(db, tournament.id);
  assert.equal(state.getServer(fresh, 0)?.launched, true);
  assert.equal(Boolean(state.getServer(fresh, 0)?.currentStage), true);
  assert.equal(state.getServer(fresh, 1)?.launched, true);
  assert.equal(Boolean(state.getServer(fresh, 1)?.currentStage), true);

  const open1After = asMod(createButtonInteraction(buildCustomId(ACTIONS.MANAGE_START, tournament.id, "0"), calls));
  await operator.handleButtonInteraction(open1After);
  const open2 = asMod(createButtonInteraction(buildCustomId(ACTIONS.MANAGE_START, tournament.id, "1"), calls));
  await operator.handleButtonInteraction(open2);
  assert.match(JSON.stringify(open1After.replyPayload), /Сервер 1/);
  assert.match(JSON.stringify(open2.replyPayload), /Сервер 2/);
  assert.doesNotMatch(JSON.stringify(open1After.replyPayload), /Сначала запусти сервер/);
  assert.doesNotMatch(JSON.stringify(open2.replyPayload), /Сначала запусти сервер/);
  await delay(60);
});

test("tournament launch is idempotent and stale match buttons can repair a lost server record", async () => {
  const calls = [];
  const logs = [];
  const db = {};
  const tournament = state.createTournamentFromDraft(
    db,
    {
      name: "Repair Cup",
      slots: 32,
      plannedPlayers: 32,
      startsAtIso: "2026-06-21T20:00:00.000Z",
      announceChannelId: "channel-1",
    },
    { id: "tour-1", now: "2026-06-21T18:00:00.000Z" }
  );
  state.updateTournament(db, tournament.id, { announce: { channelId: "channel-1", messageId: "announce-1" } });
  const channel = {
    id: "channel-1",
    async send() { return { id: `message-${calls.length + 1}`, channelId: "channel-1" }; },
    threads: {
      async create() {
        return {
          id: `thread-${calls.length + 1}`,
          async send() { return { id: "thread-message" }; },
          members: { async add() {} },
          async setLocked() {},
        };
      },
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
  const asMod = (interaction) => {
    interaction.member = { mod: true };
    interaction.user = { id: "mod-1", tag: "mod#0001" };
    return interaction;
  };

  await operator.handleButtonInteraction(asMod(createButtonInteraction(buildCustomId(ACTIONS.MANAGE_FILL_ALL, tournament.id), calls)));
  const seeded = state.getTournament(db, tournament.id);
  assert.equal(state.tournamentPlayers(seeded, { serverIndex: 0 }).length, 16);
  assert.equal(state.tournamentPlayers(seeded, { serverIndex: 1 }).length, 16);

  await operator.handleButtonInteraction(asMod(createButtonInteraction(buildCustomId(ACTIONS.MANAGE_LAUNCH_SERVER, tournament.id, "0"), calls)));
  const server0 = state.getServer(state.getTournament(db, tournament.id), 0);
  const firstMatch = server0.currentStage.runs[0].matches[0];
  await operator.handleButtonInteraction(asMod(createButtonInteraction(buildCustomId(ACTIONS.MATCH_WIN, tournament.id, "0", firstMatch.key, "r"), calls)));
  const decisionBefore = state.getServer(state.getTournament(db, tournament.id), 0).decisions[firstMatch.key];

  await operator.handleButtonInteraction(asMod(createButtonInteraction(buildCustomId(ACTIONS.MANAGE_LAUNCH_SERVER, tournament.id, "0"), calls)));
  const afterRepeatLaunch = state.getServer(state.getTournament(db, tournament.id), 0);
  assert.deepEqual(afterRepeatLaunch.decisions[firstMatch.key], decisionBefore, "repeat launch must not reset live decisions");
  assert.equal(afterRepeatLaunch.currentStage, server0.currentStage, "repeat launch must keep the same stage object");

  await operator.handleButtonInteraction(asMod(createButtonInteraction(buildCustomId(ACTIONS.MANAGE_LAUNCH_SERVER, tournament.id, "1"), calls)));
  const afterSecond = state.getTournament(db, tournament.id);
  assert.equal(state.getServer(afterSecond, 0)?.launched, true);
  assert.equal(state.getServer(afterSecond, 1)?.launched, true);

  delete afterSecond.servers["0"];
  const openLost = asMod(createButtonInteraction(buildCustomId(ACTIONS.MANAGE_START, tournament.id, "0"), calls));
  await operator.handleButtonInteraction(openLost);
  const repaired0 = state.getServer(state.getTournament(db, tournament.id), 0);
  assert.equal(repaired0?.launched, true);
  assert.ok(repaired0?.currentStage, "lost server record is repaired from server roster");
  assert.doesNotMatch(JSON.stringify(openLost.replyPayload), /Сначала запусти сервер/);
  assert.ok(logs.some((line) => /TOURNAMENT_SERVER_REPAIRED/.test(line)));
  await delay(60);
});

test("tournament completion window attaches generated summary art and publishes organizer comment", async () => {
  const calls = [];
  const db = {};
  const tournament = state.createTournamentFromDraft(
    db,
    {
      name: "Final Cup",
      slots: 16,
      startsAtIso: "2026-06-21T20:00:00.000Z",
      announceChannelId: "channel-1",
    },
    { id: "tour-1", now: "2026-06-21T18:00:00.000Z" }
  );
  const first = { userId: "100000000000000001", robloxUsername: "Winner", kills: 9000 };
  const second = { userId: "100000000000000002", robloxUsername: "Runner", kills: 7000 };
  const third = { userId: "100000000000000003", robloxUsername: "Third", kills: 5000 };
  state.updateTournament(db, tournament.id, {
    status: "completed",
    announce: { channelId: "channel-1", messageId: "announce-1" },
    results: { first, second, third, organizerComment: null },
  });
  let sentSummary = null;
  const channel = {
    id: "channel-1",
    async send(payload) {
      sentSummary = payload;
      return { id: "summary-1", channelId: "channel-1" };
    },
  };
  const operator = createTournamentOperator({
    db,
    saveDb: () => calls.push("saveDb"),
    runSerializedMutation: async ({ mutate }) => mutate(),
    isModerator: (member) => Boolean(member?.mod),
    fetchChannel: async () => channel,
    renderImage: async () => Buffer.from("png"),
    logLine: async () => {},
  });
  const asMod = (interaction) => {
    interaction.member = { mod: true };
    interaction.user = { id: "mod-1", tag: "mod#0001" };
    return interaction;
  };

  const open = asMod(createButtonInteraction(buildCustomId(ACTIONS.SUMMARY_OPEN, tournament.id), calls));
  await operator.handleButtonInteraction(open);
  assert.equal(open.updatedPayload.files.length, 1, "final window carries generated summary PNG");
  assert.match(JSON.stringify(open.updatedPayload), /Финальное окно/);

  const comment = asMod(createModalInteraction(buildCustomId(ACTIONS.SUMMARY_COMMENT, tournament.id), { comment: "Winner забрал финал чисто; Runner держался до конца." }, calls));
  await operator.handleModalSubmitInteraction(comment);
  assert.equal(state.getTournament(db, tournament.id).results.organizerComment, "Winner забрал финал чисто; Runner держался до конца.");
  assert.equal(comment.editedPayload.files.length, 1, "comment save rebuilds the final card");

  const publish = asMod(createButtonInteraction(buildCustomId(ACTIONS.SUMMARY_PUBLISH, tournament.id), calls));
  await operator.handleButtonInteraction(publish);
  assert.ok(sentSummary, "expected public summary send");
  assert.equal(sentSummary.files.length, 1, "public summary carries generated PNG");
  assert.match(JSON.stringify(sentSummary), /Winner забрал финал чисто/);
  assert.equal(state.getTournament(db, tournament.id).summaryPosted, true);
  assert.equal(state.getTournament(db, tournament.id).summaryMessageId, "summary-1");
});

test("tournament preview publishes one image with side branches and empty future rounds", async () => {
  const calls = [];
  const logs = [];
  const db = {};
  const tournament = state.createTournamentFromDraft(
    db,
    {
      name: "Preview Cup",
      slots: 32,
      plannedPlayers: 32,
      startsAtIso: "2026-06-21T20:00:00.000Z",
      announceChannelId: "channel-1",
    },
    { id: "tour-1", now: "2026-06-21T18:00:00.000Z" }
  );
  for (let i = 1; i <= 32; i += 1) {
    state.upsertRegistration(tournament, {
      userId: String(100000000000000000n + BigInt(i)),
      discordName: `user-${i}`,
      robloxUsername: `Player${i}`,
      approvedKills: i * 1000,
      effectiveKills: i * 1000,
    });
  }
  let sentPayload = null;
  let renderCall = null;
  const channel = {
    id: "channel-1",
    async send(payload) {
      sentPayload = payload;
      return { id: "preview-1", channelId: "channel-1" };
    },
  };
  const operator = createTournamentOperator({
    db,
    saveDb: () => calls.push("saveDb"),
    runSerializedMutation: async ({ mutate }) => mutate(),
    isModerator: (member) => Boolean(member?.mod),
    fetchChannel: async () => channel,
    renderImage: async (exportName, model) => {
      renderCall = { exportName, model };
      return Buffer.from("png");
    },
    logLine: async (line) => logs.push(line),
  });
  const interaction = createButtonInteraction(buildCustomId(ACTIONS.MANAGE_PUBLISH_PREVIEW, tournament.id), calls);
  interaction.member = { mod: true };
  interaction.user = { id: "mod-1", tag: "mod#0001" };

  const handled = await operator.handleButtonInteraction(interaction);

  assert.equal(handled, true);
  assert.equal(renderCall.exportName, "renderPreviewCard");
  assert.equal(renderCall.model.serverCount, 2, "32 planned players are shown as two branches");
  assert.equal(renderCall.model.servers.length, 2, "both server branches are present");
  assert.ok(renderCall.model.servers.every((server) => Array.isArray(server.columns)), "each branch carries bracket columns");
  for (const server of renderCall.model.servers) {
    assert.deepEqual(server.qualifiers, [], "preview must not invent qualified players");
    assert.equal(server.columns[0].matches.length, 8, "a 16-player server starts with 8 real matches");
    assert.ok(server.columns[0].matches.some((match) => match.red && match.blue), "first column contains real players");
    for (const match of server.columns.flatMap((column) => column.matches)) {
      assert.equal(match.winnerId, null, "preview must not mark winners");
    }
    for (const column of server.columns.slice(1)) {
      assert.ok(column.matches.every((match) => match.previewEmpty), "future rounds stay empty");
    }
  }
  assert.ok(sentPayload, "expected preview post");
  assert.equal(sentPayload.files.length, 1, "preview carries a single PNG");
  assert.match(JSON.stringify(sentPayload), /Предварительная сетка/);
  assert.equal(state.getTournament(db, tournament.id).preview.messageId, "preview-1");
  assert.ok(logs.some((line) => /TOURNAMENT_PREVIEW_PUBLISH/.test(line)));
  assert.match(JSON.stringify(interaction.editedPayload), /Предпубликация отправлена/);
});

test("match panel acks each tap and repaints in place via a single edit; supports one-tap re-pick", async () => {
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

  // click RED winner — ack'd instantly with deferUpdate() (Discord shows its own
  // loading state; panel stays in place, never "interaction failed"), then a SINGLE
  // editReply repaints it from authoritative state. No "думает" followUp, no
  // deleteReply round-trip (those caused the on-screen "Ошибка взаимодействия").
  const redCalls = [];
  const clickRed = createButtonInteraction(buildCustomId(ACTIONS.MATCH_WIN, tournament.id, "0", match.key, "r"), redCalls);
  clickRed.member = { mod: true };
  clickRed.user = { id: "mod-1", tag: "mod#0001" };
  await operator.handleButtonInteraction(clickRed);
  assert.deepEqual(redCalls, ["deferUpdate", "editReply"], "winner tap: defer ack + single in-place repaint");
  assert.equal(state.getServer(state.getTournament(db, tournament.id), 0).decisions[match.key].winnerId, redId);

  // re-pick the OTHER side in one tap (buttons stay enabled — no undo dance)
  const blueCalls = [];
  const clickBlue = createButtonInteraction(buildCustomId(ACTIONS.MATCH_WIN, tournament.id, "0", match.key, "b"), blueCalls);
  clickBlue.member = { mod: true };
  clickBlue.user = { id: "mod-1", tag: "mod#0001" };
  await operator.handleButtonInteraction(clickBlue);
  assert.deepEqual(blueCalls, ["deferUpdate", "editReply"], "re-pick: defer ack + single in-place repaint");
  assert.equal(state.getServer(state.getTournament(db, tournament.id), 0).decisions[match.key].winnerId, blueId, "winner switched in one tap");
  assert.match(JSON.stringify(clickBlue.editedPayload), /✅/, "chosen winner highlighted");

  // advancing the (placement) stage acks in place, then completes
  const advCalls = [];
  const advance = createButtonInteraction(buildCustomId(ACTIONS.STAGE_ADVANCE, tournament.id, "0"), advCalls);
  advance.member = { mod: true };
  advance.user = { id: "mod-1", tag: "mod#0001" };
  await operator.handleButtonInteraction(advance);
  assert.deepEqual(advCalls, ["deferUpdate", "editReply"], "advance: defer ack + single in-place repaint");
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
  assert.equal(sends.length, sendsAfterLaunch, "completion opens the organizer summary window without an automatic public repost");

  await operator.handleButtonInteraction(asMod(createButtonInteraction(buildCustomId(ACTIONS.SUMMARY_PUBLISH, tournament.id))));
  assert.equal(sends.length, sendsAfterLaunch + 1, "the only extra post is the organizer-published grand summary");
  assert.equal(state.getTournament(db, tournament.id).summaryPosted, true);
});
