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
