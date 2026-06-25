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
      this.deferred = true;
    },
    async editReply(payload) {
      calls.push(["editReply", payload]);
    },
    async reply(payload) {
      calls.push(["reply", payload]);
      this.replied = true;
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
      this.replied = true;
    },
    async update(payload) {
      calls.push(["update", payload]);
      this.replied = true;
    },
    async deferUpdate() {
      calls.push(["deferUpdate"]);
      this.deferred = true;
    },
    async deferReply(payload) {
      calls.push(["deferReply", payload]);
      this.deferred = true;
    },
    async editReply(payload) {
      calls.push(["editReply", payload]);
    },
    async showModal(payload) {
      calls.push(["showModal", payload]);
      this.replied = true;
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
      this.replied = true;
    },
    async update(payload) {
      calls.push(["update", payload]);
      this.replied = true;
    },
    async deferUpdate() {
      calls.push(["deferUpdate"]);
      this.deferred = true;
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
  strings = {},
  integers = {},
  role = null,
  roles = {},
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
      getUser: (name) => (name === "target" ? target : null),
      getString: (name) => strings[name] ?? null,
      getInteger: (name) => integers[name] ?? null,
      getRole: (name) => roles[name] || (name === "role" ? role : null),
    },
    async reply(payload) {
      calls.push(["reply", payload]);
      this.replied = true;
    },
    async deferReply(payload) {
      calls.push(["deferReply", payload]);
      this.deferred = true;
    },
    async editReply(payload) {
      calls.push(["editReply", payload]);
    },
    async showModal(payload) {
      calls.push(["showModal", payload]);
      this.replied = true;
    },
  };
}

test("roblox modal promotes resolved Roblox into profile binding and antiteam confirmation", async () => {
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

  assert.deepEqual(binding, {
    userId: "user-1",
    robloxUser: {
      id: "101",
      name: "Anchor",
      displayName: "Anchor Display",
      avatarUrl: "https://tr.rbxcdn.com/anchor-headshot.png",
    },
    source: "antiteam_modal",
  });
  assert.equal(db.sot.antiteam.robloxConfirmations["user-1"].robloxUserId, "101");
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

test("clan slash command opens a draft and prompts for an anchor twink when no profile Roblox", async () => {
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

  // It now opens the draft instead of rejecting, and nudges the caller to set
  // the anchor Roblox via the twink button.
  assert.equal(interaction.calls[0][0], "deferReply");
  const editCall = interaction.calls.find((call) => call[0] === "editReply");
  assert.ok(editCall, "clan setup panel was sent");
  const draft = db.sot.antiteam.drafts["mod-1"];
  assert.ok(draft, "clan draft was created");
  assert.equal(draft.kind, "clan");
  assert.equal(draft.anchorUserId, "anchor-1");
  assert.equal(draft.roblox?.userId, "");
});

test("clan draft without an anchor Roblox cannot publish", async () => {
  const db = {};
  ensureAntiteamState(db).state.config.channelId = "channel-1";
  setAntiteamDraft(db, "mod-1", {
    kind: "clan",
    userTag: "Mod",
    anchorUserId: "anchor-1",
    anchorUserTag: "Anchor",
    description: "Клан держит центр, нужны все.",
  }, { now: "2026-05-16T10:00:00.000Z" });
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:01:00.000Z",
    saveDb() {},
  });
  const interaction = createButtonInteraction(ANTITEAM_CUSTOM_IDS.submitDraft, { id: "mod-1", username: "Mod" });
  assert.equal(await operator.handleButtonInteraction(interaction), true);
  // No ticket gets created without an anchor Roblox.
  assert.equal(Object.keys(db.sot.antiteam.tickets).length, 0);
  const lastPayload = interaction.calls.at(-1)?.[1];
  assert.match(JSON.stringify(lastPayload), /Roblox якоря/);
});

test("points slash command adjusts multiple antiteam helpers and syncs reward roles", async () => {
  const db = {};
  const state = ensureAntiteamState(db).state;
  state.config.helperRewardRoles = { "1": "role-1", "5": "role-5", "10": "", "20": "", "50": "" };
  state.stats.helpers["222222"] = {
    responded: 1,
    linkGranted: 1,
    confirmedArrived: 4,
    lastTicketId: "ticket-old",
    lastHelpedAt: "2026-05-16T09:00:00.000Z",
  };
  const roleCacheByUserId = new Map([
    ["111111", new Map()],
    ["222222", new Map([["role-1", { id: "role-1" }]])],
    ["333333", new Map()],
  ]);
  const added = [];
  const removed = [];
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:00:00.000Z",
    saveDb() {},
    fetchMember: async (userId) => ({
      roles: {
        cache: roleCacheByUserId.get(userId) || new Map(),
        add: async (roleId, reason) => {
          added.push({ userId, roleId, reason });
          roleCacheByUserId.get(userId)?.set(roleId, { id: roleId });
        },
        remove: async (roleId, reason) => {
          removed.push({ userId, roleId, reason });
          roleCacheByUserId.get(userId)?.delete(roleId);
        },
      },
    }),
  });
  const interaction = createSlashInteraction("points", {
    strings: {
      action: "add",
      targets: "<@111111> 222222",
      user_ids: "333333",
      note: "ручная компенсация",
    },
    integers: { amount: 2 },
  });

  assert.equal(await operator.handleSlashCommand(interaction), true);

  assert.deepEqual(interaction.calls.map((call) => call[0]), ["deferReply", "editReply"]);
  assert.equal(db.sot.antiteam.stats.helpers["111111"].confirmedArrived, 2);
  assert.equal(db.sot.antiteam.stats.helpers["222222"].confirmedArrived, 6);
  assert.equal(db.sot.antiteam.stats.helpers["333333"].confirmedArrived, 2);
  assert.deepEqual(added, [
    { userId: "111111", roleId: "role-1", reason: "antiteam helper reward sync" },
    { userId: "222222", roleId: "role-5", reason: "antiteam helper reward sync" },
    { userId: "333333", roleId: "role-1", reason: "antiteam helper reward sync" },
  ]);
  assert.deepEqual(removed, [
    { userId: "222222", roleId: "role-1", reason: "antiteam helper reward sync" },
  ]);
  assert.match(interaction.calls.at(-1)[1], /Начислено по \*\*2\*\*/);
  assert.match(interaction.calls.at(-1)[1], /<@222222>: \*\*4 → 6\*\* \(\+2\)/);
  assert.match(interaction.calls.at(-1)[1], /ручная компенсация/);
});

test("points slash command removes points from role targets and clears stale reward roles at zero", async () => {
  const db = {};
  const state = ensureAntiteamState(db).state;
  state.config.helperRewardRoles = { "1": "role-1", "5": "role-5", "10": "", "20": "", "50": "" };
  state.stats.helpers["111111"] = {
    responded: 1,
    linkGranted: 1,
    confirmedArrived: 1,
    lastTicketId: "ticket-old",
    lastHelpedAt: "2026-05-16T09:00:00.000Z",
  };
  const sourceRole = {
    id: "source-role",
    name: "Helpers",
    members: new Map([
      ["111111", { id: "111111", user: { id: "111111", bot: false } }],
      ["999999", { id: "999999", user: { id: "999999", bot: true } }],
    ]),
  };
  const roleCache = new Map([
    ["role-1", { id: "role-1" }],
    ["role-5", { id: "role-5" }],
  ]);
  const removed = [];
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T11:00:00.000Z",
    saveDb() {},
    fetchMember: async () => ({
      roles: {
        cache: roleCache,
        add: async () => {},
        remove: async (roleId, reason) => {
          removed.push({ roleId, reason });
          roleCache.delete(roleId);
        },
      },
    }),
  });
  const interaction = createSlashInteraction("points", {
    strings: { action: "remove" },
    integers: { amount: 2 },
    role: sourceRole,
  });

  assert.equal(await operator.handleSlashCommand(interaction), true);

  assert.equal(db.sot.antiteam.stats.helpers["111111"].confirmedArrived, 0);
  assert.deepEqual(removed, [
    { roleId: "role-1", reason: "antiteam helper reward sync" },
    { roleId: "role-5", reason: "antiteam helper reward sync" },
  ]);
  assert.match(interaction.calls.at(-1)[1], /Убрано по \*\*2\*\*/);
  assert.match(interaction.calls.at(-1)[1], /<@111111>: \*\*1 → 0\*\* \(-1\)/);
  assert.match(interaction.calls.at(-1)[1], /Источник по роли: <@&source-role> \(Helpers\)/);
});

test("start panel submit button shows a small Roblox panel when profile has no Roblox", async () => {
  const db = {};
  ensureAntiteamState(db);
  const operator = createAntiteamOperator({
    db,
    saveDb() {},
  });
  const interaction = createButtonInteraction(ANTITEAM_CUSTOM_IDS.open, { id: "user-1", username: "User" });

  assert.equal(await operator.handleButtonInteraction(interaction), true);
  assert.deepEqual(interaction.calls.map((call) => call[0]), ["deferReply", "editReply"]);
  assert.match(JSON.stringify(interaction.calls[1][1].components[0].toJSON()), /Внести ник/);

  const request = createButtonInteraction(ANTITEAM_CUSTOM_IDS.requestRobloxNick, { id: "user-1", username: "User" });
  assert.equal(await operator.handleButtonInteraction(request), true);
  assert.equal(request.calls[0][0], "showModal");
  assert.equal(request.calls[0][1].data.custom_id, "at:roblox");
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

  assert.deepEqual(interaction.calls.map((call) => call[0]), ["deferReply", "editReply"]);
  assert.match(JSON.stringify(interaction.calls[1][1].components[0].toJSON()), /Roblox ник/);
});

test("start panel accepts legacy verified Roblox records with verifiedAt fallback", async () => {
  const db = {};
  ensureAntiteamState(db);
  const operator = createAntiteamOperator({
    db,
    saveDb() {},
    getProfile: () => ({
      robloxUserId: "101",
      robloxUsername: "LegacyLinked",
      robloxDisplayName: "Legacy Linked",
      robloxVerifiedAt: "2026-05-16T10:00:00.000Z",
    }),
  });
  const interaction = createButtonInteraction(ANTITEAM_CUSTOM_IDS.open, { id: "user-1", username: "User" });

  assert.equal(await operator.handleButtonInteraction(interaction), true);

  assert.deepEqual(interaction.calls.map((call) => call[0]), ["deferReply", "editReply"]);
  assert.match(JSON.stringify(interaction.calls[1][1].components[0].toJSON()), /Подтверди Roblox/);
});

test("start panel ignores legacy verified Roblox records with invalid Roblox user id", async () => {
  const db = {};
  ensureAntiteamState(db);
  const operator = createAntiteamOperator({
    db,
    saveDb() {},
    getProfile: () => ({
      robloxUserId: "broken-id",
      robloxUsername: "LegacyLinked",
      robloxDisplayName: "Legacy Linked",
      robloxVerifiedAt: "2026-05-16T10:00:00.000Z",
    }),
  });
  const interaction = createButtonInteraction(ANTITEAM_CUSTOM_IDS.open, { id: "user-1", username: "User" });

  assert.equal(await operator.handleButtonInteraction(interaction), true);

  assert.deepEqual(interaction.calls.map((call) => call[0]), ["deferReply", "editReply"]);
  assert.match(JSON.stringify(interaction.calls[1][1].components[0].toJSON()), /Roblox ник/);
  assert.match(JSON.stringify(interaction.calls[1][1].components[0].toJSON()), /нет валидного Roblox userId/);
});

test("start panel rejects failed Roblox records even with stale verified markers", async () => {
  const db = {};
  ensureAntiteamState(db);
  const operator = createAntiteamOperator({
    db,
    saveDb() {},
    getProfile: () => ({
      summary: {
        roblox: {
          userId: "101",
          currentUsername: "BrokenLinked",
          hasVerifiedAccount: true,
          verificationStatus: "failed",
        },
      },
    }),
  });
  const interaction = createButtonInteraction(ANTITEAM_CUSTOM_IDS.open, { id: "user-1", username: "User" });

  assert.equal(await operator.handleButtonInteraction(interaction), true);

  assert.deepEqual(interaction.calls.map((call) => call[0]), ["deferReply", "editReply"]);
  assert.match(JSON.stringify(interaction.calls[1][1].components[0].toJSON()), /Roblox ник/);
});

test("start panel asks to confirm verified Roblox once, then reuses it", async () => {
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

  assert.deepEqual(interaction.calls.map((call) => call[0]), ["deferReply", "editReply"]);
  assert.match(JSON.stringify(interaction.calls[1][1].components[0].toJSON()), /Подтверди Roblox/);
  assert.equal(db.sot.antiteam.drafts["user-1"], undefined);

  const confirm = createButtonInteraction(ANTITEAM_CUSTOM_IDS.confirmRoblox, { id: "user-1", username: "User" });
  assert.equal(await operator.handleButtonInteraction(confirm), true);

  assert.deepEqual(confirm.calls.map((call) => call[0]), ["deferUpdate", "editReply"]);
  assert.equal(db.sot.antiteam.drafts["user-1"].roblox.username, "AlreadyLinked");
  assert.equal(db.sot.antiteam.robloxConfirmations["user-1"].robloxUserId, "101");
  assert.deepEqual(granted, [{ userId: "user-1", roleId: "battalion-role" }]);
  assert.match(JSON.stringify(confirm.calls[1][1].components[0].toJSON()), /Roblox: \*\*AlreadyLinked\*\* \(101\) • подтверждён/);

  const secondOpen = createButtonInteraction(ANTITEAM_CUSTOM_IDS.open, { id: "user-1", username: "User" });
  assert.equal(await operator.handleButtonInteraction(secondOpen), true);
  assert.deepEqual(secondOpen.calls.map((call) => call[0]), ["deferReply", "editReply"]);
  assert.match(JSON.stringify(secondOpen.calls[1][1].components[0].toJSON()), /взят из профиля/);
});

test("support progress button renders personal PNG from helper stats", async () => {
  const db = {};
  const state = ensureAntiteamState(db).state;
  state.stats.helpers["helper-1"] = {
    responded: 8,
    linkGranted: 8,
    confirmedArrived: 7,
    lastHelpedAt: "2026-05-16T10:00:00.000Z",
  };
  const rendered = [];
  const operator = createAntiteamOperator({
    db,
    saveDb() {},
    renderSupportProgressCard: async (options) => {
      rendered.push(options);
      return Buffer.from("fake-png");
    },
  });
  const interaction = createButtonInteraction(ANTITEAM_CUSTOM_IDS.progress, { id: "helper-1", username: "Helper" });

  assert.equal(await operator.handleButtonInteraction(interaction), true);

  assert.equal(interaction.calls[0][0], "deferReply");
  assert.equal(rendered[0].model.title, "Саппорт Ⅱ ур.");
  assert.equal(rendered[0].model.remaining, 3);
  assert.equal(interaction.calls.at(-1)[0], "editReply");
  assert.match(JSON.stringify(interaction.calls.at(-1)[1].components[0].toJSON()), /Саппорт Ⅱ ур\./);
  assert.equal(interaction.calls.at(-1)[1].files[0].name, "antiteam-support-progress.png");
});

test("support progress button reuses cached PNG while helper stats are unchanged", async () => {
  const db = {};
  const state = ensureAntiteamState(db).state;
  state.stats.helpers["helper-1"] = {
    responded: 8,
    linkGranted: 8,
    confirmedArrived: 7,
    lastHelpedAt: "2026-05-16T10:00:00.000Z",
  };
  let currentMs = 1000;
  const rendered = [];
  const operator = createAntiteamOperator({
    db,
    saveDb() {},
    nowMs: () => currentMs,
    renderSupportProgressCard: async (options) => {
      rendered.push(options);
      return Buffer.from(`fake-png-${rendered.length}`);
    },
  });

  const first = createButtonInteraction(ANTITEAM_CUSTOM_IDS.progress, { id: "helper-1", username: "Helper" });
  assert.equal(await operator.handleButtonInteraction(first), true);

  currentMs += 1000;
  const second = createButtonInteraction(ANTITEAM_CUSTOM_IDS.progress, { id: "helper-1", username: "Helper" });
  assert.equal(await operator.handleButtonInteraction(second), true);

  assert.equal(rendered.length, 1);
  assert.equal(second.calls.at(-1)[1].files[0].name, "antiteam-support-progress.png");
});

test("support progress button shares one PNG render across concurrent identical requests", async () => {
  const db = {};
  const state = ensureAntiteamState(db).state;
  state.stats.helpers["helper-1"] = {
    responded: 8,
    linkGranted: 8,
    confirmedArrived: 7,
    lastHelpedAt: "2026-05-16T10:00:00.000Z",
  };
  const rendered = [];
  let releaseRender = null;
  let resolveRenderStarted = null;
  const renderStarted = new Promise((resolve) => {
    resolveRenderStarted = resolve;
  });
  const operator = createAntiteamOperator({
    db,
    saveDb() {},
    renderSupportProgressCard: async (options) => {
      rendered.push(options);
      resolveRenderStarted();
      await new Promise((resolve) => {
        releaseRender = resolve;
      });
      return Buffer.from("fake-png-shared");
    },
  });

  const first = createButtonInteraction(ANTITEAM_CUSTOM_IDS.progress, { id: "helper-1", username: "Helper" });
  const second = createButtonInteraction(ANTITEAM_CUSTOM_IDS.progress, { id: "helper-1", username: "Helper" });

  const firstPending = operator.handleButtonInteraction(first);
  const secondPending = operator.handleButtonInteraction(second);
  await renderStarted;

  assert.equal(rendered.length, 1);

  releaseRender();
  assert.equal(await firstPending, true);
  assert.equal(await secondPending, true);

  assert.equal(rendered.length, 1);
  assert.equal(first.calls.at(-1)[1].files[0].name, "antiteam-support-progress.png");
  assert.equal(second.calls.at(-1)[1].files[0].name, "antiteam-support-progress.png");
});

test("leaders button replies with helper leaderboard and viewer position", async () => {
  const db = {};
  const state = ensureAntiteamState(db).state;
  for (let index = 1; index <= 11; index += 1) {
    state.stats.helpers[`helper-${index}`] = {
      responded: 20 - index,
      linkGranted: 15 - index,
      confirmedArrived: 12 - index,
      lastHelpedAt: `2026-05-16T10:${String(index).padStart(2, "0")}:00.000Z`,
    };
  }
  state.stats.helpers["helper-zero"] = {
    responded: 99,
    linkGranted: 99,
    confirmedArrived: 0,
  };
  const operator = createAntiteamOperator({
    db,
    saveDb() {},
  });
  const interaction = createButtonInteraction(ANTITEAM_CUSTOM_IDS.leaders, { id: "helper-11", username: "Helper" });

  assert.equal(await operator.handleButtonInteraction(interaction), true);

  assert.equal(interaction.calls[0][0], "reply");
  assert.match(JSON.stringify(interaction.calls[0][1].components[0].toJSON()), /Лидеры батальона/);
  assert.match(JSON.stringify(interaction.calls[0][1].components[0].toJSON()), /Твоё место: \*\*#11\*\*/);
  assert.match(JSON.stringify(interaction.calls[0][1].components[0].toJSON()), /🥇 <@helper-1>/);
  assert.doesNotMatch(JSON.stringify(interaction.calls[0][1].components[0].toJSON()), /helper-zero/);
});

test("join battalion button grants the base battalion role only", async () => {
  const db = {};
  const state = ensureAntiteamState(db).state;
  state.config.battalionRoleId = "battalion-role";
  state.config.battalionPingRoleIds = ["extra-ping-role"];
  const granted = [];
  const operator = createAntiteamOperator({
    db,
    saveDb() {},
    grantRole: async (userId, roleId, reason) => {
      granted.push({ userId, roleId, reason });
      return { granted: true, roleId };
    },
  });
  const interaction = createButtonInteraction(ANTITEAM_CUSTOM_IDS.joinBattalion, { id: "user-1", username: "User" });

  assert.equal(await operator.handleButtonInteraction(interaction), true);

  assert.deepEqual(interaction.calls.map((call) => call[0]), ["deferReply", "editReply"]);
  assert.equal(interaction.calls.at(-1)[1].content, "Готово, выдал роль батальёна.");
  assert.deepEqual(granted, [
    { userId: "user-1", roleId: "battalion-role", reason: "antiteam battalion self-join" },
  ]);
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
  assert.equal(await operator.handleButtonInteraction(createButtonInteraction(ANTITEAM_CUSTOM_IDS.confirmRoblox, { id: "user-1", username: "User" })), true);

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
  state.config.roblox.jjsPlaceId = "place-1";
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
    getRobloxRuntimeState: () => ({
      activeSessionsByDiscordUserId: {
        "author-1": { gameId: "game-1" },
      },
    }),
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
  const helpJson = JSON.stringify(interaction.calls.at(-1)[1].components[0].toJSON());
  assert.match(helpJson, /Отправил др, пусть примет/);
  // No manual direct link was added — the auto-generated profile URL is NOT shown
  // in friend_request mode (it's useless before the friend request is accepted).
  assert.doesNotMatch(helpJson, /Ссылка подключения/);
  assert.doesNotMatch(helpJson, /🔗 Подключиться/);
  // Profile button is still offered (helper visits it to send the friend request).
  assert.match(helpJson, /👤 Профиль/);

  const sentInteraction = createButtonInteraction(ticketButtonId("friend_request_sent", "ticket-1"));
  assert.equal(await operator.handleButtonInteraction(sentInteraction), true);

  assert.equal(threadNotices.length, 1);
  assert.match(threadNotices[0].content, /<@author-1>/);
  assert.match(threadNotices[0].content, /<@helper-1> отправил тебе friend request/);
  assert.match(threadNotices[0].content, /Принять заявки/);
  assert.deepEqual(threadNotices[0].allowedMentions.users, ["author-1", "helper-1"]);
  const sentJson = JSON.stringify(sentInteraction.calls.at(-1)[1].components[0].toJSON());
  assert.match(sentJson, /Помощь принята/);
  assert.match(sentJson, /Автор уже получил пинг в ветке/);
  assert.match(sentJson, /"disabled":true/);

  assert.equal(await operator.handleButtonInteraction(createButtonInteraction(ticketButtonId("friend_request_sent", "ticket-1"))), true);
  assert.equal(threadNotices.length, 1);
});

test("help button does not persist repairable helper Roblox username as a usable helper identity", async () => {
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

  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:02:00.000Z",
    saveDb() {},
    getProfile: () => ({
      domains: {
        roblox: {
          username: "DiscordLikeName",
          verificationStatus: "verified",
        },
      },
      summary: {
        roblox: {
          hasVerifiedAccount: true,
          isTrackable: false,
          trackingState: "repairable",
          currentUsername: "DiscordLikeName",
          verificationStatus: "verified",
        },
      },
    }),
  });

  const interaction = createButtonInteraction("at:help:ticket-1");
  assert.equal(await operator.handleButtonInteraction(interaction), true);

  const helper = db.sot.antiteam.tickets["ticket-1"].helpers["helper-1"];
  assert.equal(helper.robloxUsername, "");
  assert.equal(helper.robloxUserId, "");
  assert.match(JSON.stringify(interaction.calls.at(-1)[1].components[0].toJSON()), /Roblox у тебя не привязан/);
});

test("friend-request help omits connection URL when no manual direct link is set", async () => {
  const db = {};
  const state = ensureAntiteamState(db).state;
  state.config.channelId = "channel-1";
  const draft = setAntiteamDraft(db, "author-1", {
    userTag: "Author",
    roblox: { userId: "101", username: "Anchor", profileUrl: "https://www.roblox.com/users/101/profile" },
    level: "medium",
    count: "2-4",
    description: "Тимятся у центра.",
    directJoinEnabled: false,
  }, { now: "2026-05-16T10:00:00.000Z" });
  createAntiteamTicketFromDraft(db, draft, {
    id: "ticket-user-link",
    now: "2026-05-16T10:01:00.000Z",
  });
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:02:00.000Z",
    saveDb() {},
    getProfile: () => ({ domains: { roblox: {} } }),
  });
  const interaction = createButtonInteraction("at:help:ticket-user-link");

  assert.equal(await operator.handleButtonInteraction(interaction), true);

  const ticket = db.sot.antiteam.tickets["ticket-user-link"];
  assert.equal(ticket.helpers["helper-1"].linkKind, "friend_request");
  const json = JSON.stringify(interaction.calls.at(-1)[1].components[0].toJSON());
  // No manual direct link — the auto-generated profile URL must NOT appear in the
  // friend_request flow (it's useless before the friend request is accepted).
  assert.doesNotMatch(json, /Ссылка подключения/);
  assert.doesNotMatch(json, /games\/start\?userId=101/);
  assert.doesNotMatch(json, /🔗 Подключиться/);
  assert.match(json, /Roblox у тебя не привязан/);
  // Profile button is still shown so the helper can open the profile and send fr.
  assert.match(json, /👤 Профиль/);
});

test("ticket direct-join toggle is limited to author or admin and updates the mission", async () => {
  const db = {};
  const state = ensureAntiteamState(db).state;
  state.config.channelId = "channel-1";
  const draft = setAntiteamDraft(db, "author-1", {
    userTag: "Author",
    roblox: { userId: "101", username: "Anchor", profileUrl: "https://www.roblox.com/users/101/profile" },
    level: "medium",
    count: "2-4",
    description: "Тимятся у центра.",
    directJoinEnabled: false,
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
  let panelEdit = null;
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:02:00.000Z",
    saveDb() {},
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
      if (channelId === "thread-1") {
        return {
          messages: {
            fetch: async () => ({
              edit: async (payload) => {
                panelEdit = payload;
              },
            }),
          },
        };
      }
      return null;
    },
  });
  const denied = createButtonInteraction(ticketButtonId("toggle_direct", "ticket-1"), { id: "any-1", username: "Any" });

  assert.equal(await operator.handleButtonInteraction(denied), true);
  assert.equal(db.sot.antiteam.tickets["ticket-1"].directJoinEnabled, false);
  assert.deepEqual(denied.calls.map((call) => call[0]), ["reply"]);

  const authorToggle = createButtonInteraction(ticketButtonId("toggle_direct", "ticket-1"), { id: "author-1", username: "Author" });
  assert.equal(await operator.handleButtonInteraction(authorToggle), true);
  assert.equal(db.sot.antiteam.tickets["ticket-1"].directJoinEnabled, true);
  assert.deepEqual(authorToggle.calls.map((call) => call[0]), ["deferUpdate", "editReply"]);
  assert.match(JSON.stringify(authorToggle.calls.at(-1)[1].components[0].toJSON()), /🔓 Вход без др: есть/);
  // Public card now shows only the lock emoji (no "Вход без др" text, no open/closed status).
  assert.match(JSON.stringify(publicEdit.components[0].toJSON()), /🔓/);
  assert.doesNotMatch(JSON.stringify(publicEdit.components[0].toJSON()), /Вход без др|открыто|закрыто/);
  assert.match(JSON.stringify(panelEdit.components[0].toJSON()), /🔓 Вход без др: есть/);
  assert.equal(Object.keys(db.sot.antiteam.tickets["ticket-1"].helpers).length, 0);
  assert.deepEqual(db.sot.antiteam.stats.helpers, {});

  const adminToggle = createButtonInteraction(ticketButtonId("toggle_direct", "ticket-1"), { id: "admin-1", username: "Admin" });
  adminToggle.member = { permissions: { has: () => true }, roles: { cache: new Map() } };
  assert.equal(await operator.handleButtonInteraction(adminToggle), true);
  assert.equal(db.sot.antiteam.tickets["ticket-1"].directJoinEnabled, false);
});

test("ticket auto-close toggle disables idle finish for this mission", async () => {
  const db = {};
  const state = ensureAntiteamState(db).state;
  state.config.missionAutoCloseMinutes = 180;
  const draft = setAntiteamDraft(db, "author-1", {
    userTag: "Author",
    roblox: { userId: "101", username: "Anchor" },
    level: "medium",
    count: "2-4",
    description: "Тимятся у центра.",
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

  let panelEdit = null;
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:02:00.000Z",
    saveDb() {},
    fetchChannel: async (channelId) => {
      if (channelId === "channel-1") {
        return {
          messages: {
            fetch: async () => ({
              edit: async () => {},
            }),
          },
        };
      }
      if (channelId === "thread-1") {
        return {
          messages: {
            fetch: async () => ({
              edit: async (payload) => {
                panelEdit = payload;
              },
            }),
          },
        };
      }
      return null;
    },
  });

  const denied = createButtonInteraction(ticketButtonId("toggle_auto_close", "ticket-1"), { id: "any-1", username: "Any" });
  assert.equal(await operator.handleButtonInteraction(denied), true);
  assert.equal(db.sot.antiteam.tickets["ticket-1"].autoCloseEnabled, true);
  assert.deepEqual(denied.calls.map((call) => call[0]), ["reply"]);

  const authorToggle = createButtonInteraction(ticketButtonId("toggle_auto_close", "ticket-1"), { id: "author-1", username: "Author" });
  assert.equal(await operator.handleButtonInteraction(authorToggle), true);
  assert.equal(db.sot.antiteam.tickets["ticket-1"].autoCloseEnabled, false);
  assert.deepEqual(authorToggle.calls.map((call) => call[0]), ["deferUpdate", "editReply"]);
  assert.match(JSON.stringify(authorToggle.calls.at(-1)[1].components[1].toJSON()), /Не закрывать автоматически/);
  assert.match(JSON.stringify(panelEdit.components[1].toJSON()), /Не закрывать автоматически/);

  db.sot.antiteam.tickets["ticket-1"].lastActivityAt = "2026-05-16T10:01:00.000Z";
  const sweepOperator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T13:05:00.000Z",
    saveDb() {},
  });
  const sweepResult = await sweepOperator.sweepIdleTickets();
  assert.equal(sweepResult.closedCount, 0);
  assert.equal(db.sot.antiteam.tickets["ticket-1"].status, "open");

  const adminToggle = createButtonInteraction(ticketButtonId("toggle_auto_close", "ticket-1"), { id: "admin-1", username: "Admin" });
  adminToggle.member = { permissions: { has: () => true }, roles: { cache: new Map() } };
  assert.equal(await operator.handleButtonInteraction(adminToggle), true);
  assert.equal(db.sot.antiteam.tickets["ticket-1"].autoCloseEnabled, true);
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

test("ticket author cannot respond to their own help request", async () => {
  const db = {};
  const state = ensureAntiteamState(db).state;
  state.config.channelId = "channel-1";
  const draft = setAntiteamDraft(db, "author-1", {
    userTag: "Author",
    roblox: { userId: "101", username: "Anchor", profileUrl: "https://www.roblox.com/users/101/profile" },
    level: "medium",
    count: "2-4",
    description: "Нужна помощь у центра.",
  }, { now: "2026-05-16T10:00:00.000Z" });
  createAntiteamTicketFromDraft(db, draft, {
    id: "ticket-own",
    now: "2026-05-16T10:01:00.000Z",
  });

  const operator = createAntiteamOperator({
    db,
    saveDb() {},
  });
  const interaction = createButtonInteraction("at:help:ticket-own", { id: "author-1", username: "Author" });

  assert.equal(await operator.handleButtonInteraction(interaction), true);

  assert.equal(interaction.calls[0][0], "reply");
  assert.equal(interaction.calls[0][1].content, "Ты уже позвал помощь по этой заявке. Самому откликаться нельзя.");
  assert.equal(interaction.calls[0][1].flags, MessageFlags.Ephemeral);
  assert.deepEqual(db.sot.antiteam.tickets["ticket-own"].helpers, {});
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

test("ticket sync counts API-present helpers by shared root place when gameId is unavailable", async () => {
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
    id: "ticket-root-api",
    now: "2026-05-16T10:01:00.000Z",
  });
  db.sot.antiteam.tickets["ticket-root-api"].message = {
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
    getProfile: () => ({ domains: { roblox: { userId: "202", username: "HelperRoblox", verificationStatus: "verified" } } }),
    fetchRobloxPresences: async (robloxUserIds) => robloxUserIds
      .map((robloxUserId) => {
        if (robloxUserId === "101") return { userId: 101, rootPlaceId: 555 };
        if (robloxUserId === "202") return { userId: 202, rootPlaceId: 555 };
        return null;
      })
      .filter(Boolean),
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

  assert.equal(await operator.handleButtonInteraction(createButtonInteraction("at:help:ticket-root-api")), true);

  const json = JSON.stringify(publicEdit.components[0].toJSON());
  assert.match(json, /Откликнулись: \*\*1\*\* \(API в игре: \*\*1\*\*\)/);
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
  assert.match(threadNotices[0].content, /ФАЙТ С КЛАНОМ/);
  assert.deepEqual(threadNotices[0].allowedMentions.users, ["anchor-1", "helper-1"]);
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

test("arrival toggle persists helper.arrived so the result survives a restart", async () => {
  const db = {};
  const draft = setAntiteamDraft(db, "author-1", {
    userTag: "Author",
    roblox: { userId: "101", username: "Anchor" },
    level: "medium",
    count: "3-5",
    description: "Нужна помощь.",
  }, { now: "2026-05-16T10:00:00.000Z" });
  createAntiteamTicketFromDraft(db, draft, {
    id: "ticket-1",
    now: "2026-05-16T10:01:00.000Z",
  });
  db.sot.antiteam.tickets["ticket-1"].helpers = {
    "helper-1": {
      userId: "helper-1",
      discordTag: "Helper",
      robloxUsername: "HelperRb",
      respondedAt: "2026-05-16T10:02:00.000Z",
      arrived: true,
    },
  };

  let persistCalls = 0;
  const interaction = createButtonInteraction(ticketButtonId("arrived", "ticket-1", "helper-1:0"), { id: "author-1", username: "Author" });
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:03:00.000Z",
    saveDb() {},
    runSerializedMutation: async ({ mutate }) => {
      persistCalls += 1;
      return mutate();
    },
  });

  assert.equal(await operator.handleButtonInteraction(interaction), true);

  assert.deepEqual(interaction.calls.map((call) => call[0]), ["deferUpdate", "editReply"]);
  // Panel flips to "Не пришёл" and shows the Roblox nick…
  assert.match(JSON.stringify(interaction.calls.at(-1)[1].components[0].toJSON()), /Не пришёл • Helper \(HelperRb\)/);
  // …and the toggle is written straight to the ticket, so a restart mid-review
  // (or the close summary) can never disagree with what the reviewer saw.
  assert.equal(persistCalls, 1);
  assert.equal(db.sot.antiteam.tickets["ticket-1"].helpers["helper-1"].arrived, false);
});

test("close modal counts untouched helpers as arrived by default", async () => {
  const db = {};
  const state = ensureAntiteamState(db).state;
  state.config.helperRewardRoles = { "1": "role-1", "5": "", "10": "", "20": "", "50": "" };
  state.stats.helpers["helper-1"] = { responded: 1, linkGranted: 1, confirmedArrived: 0, lastHelpedAt: "2026-05-16T09:00:00.000Z" };
  const draft = setAntiteamDraft(db, "author-1", {
    userTag: "Author",
    roblox: { userId: "101", username: "Anchor" },
    level: "high",
    count: "2-4",
    description: "Цели A/B.",
  }, { now: "2026-05-16T10:00:00.000Z" });
  createAntiteamTicketFromDraft(db, draft, {
    id: "ticket-default-arrived",
    now: "2026-05-16T10:01:00.000Z",
  });
  db.sot.antiteam.tickets["ticket-default-arrived"].helpers = {
    "helper-1": {
      userId: "helper-1",
      discordTag: "Helper 1",
      respondedAt: "2026-05-16T10:02:00.000Z",
    },
  };
  db.sot.antiteam.tickets["ticket-default-arrived"].message = {
    channelId: "channel-1",
    messageId: "message-1",
    threadId: "thread-1",
    threadPanelMessageId: "thread-panel-1",
  };

  const granted = [];
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:04:00.000Z",
    saveDb() {},
    grantRole: async (userId, roleId) => {
      granted.push({ userId, roleId });
    },
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
        messages: {
          fetch: async () => ({
            edit: async () => {},
          }),
        },
      },
  });
  const interaction = createModalInteraction(
    ticketButtonId("close_modal", "ticket-default-arrived"),
    { summary: "готово" },
    { id: "author-1", username: "Author" }
  );

  assert.equal(await operator.handleModalSubmitInteraction(interaction), true);
  assert.deepEqual(db.sot.antiteam.tickets["ticket-default-arrived"].closeSummary.confirmedHelperIds, ["helper-1"]);
  assert.equal(db.sot.antiteam.stats.helpers["helper-1"].confirmedArrived, 1);
  assert.deepEqual(granted, [{ userId: "helper-1", roleId: "role-1" }]);
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

test("standard draft submit sends battalion ping and transient configured role ping", async () => {
  const db = {};
  const state = ensureAntiteamState(db).state;
  state.config.channelId = "channel-1";
  state.config.battalionRoleId = "battalion-role";
  state.config.battalionPingRoleIds = ["extra-base-role"];
  state.config.pingMode = "custom_role";
  state.config.extraPingRoleId = "extra-role";
  setAntiteamDraft(db, "user-1", {
    userTag: "User",
    roblox: { userId: "101", username: "Anchor" },
    description: "Два ника около 4k.",
  }, { now: "2026-05-16T10:00:00.000Z" });

  const sentToChannel = [];
  const sentToThread = [];
  const deletedMessages = [];
  const scheduledDelays = [];
  const thread = {
    id: "thread-1",
    isTextBased: () => true,
    messages: { fetch: async () => null },
    send: async (payload) => {
      sentToThread.push(payload);
      const id = `thread-message-${sentToThread.length}`;
      return {
        id,
        delete: async () => {
          deletedMessages.push(id);
        },
      };
    },
  };
  const channel = {
    id: "channel-1",
    guildId: "guild-1",
    isTextBased: () => true,
    messages: { fetch: async () => null },
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
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:01:00.000Z",
    saveDb() {},
    fetchChannel: async (channelId) => channelId === "channel-1" ? channel : thread,
    setTimeout: (callback, delay) => {
      scheduledDelays.push(delay);
      callback();
      return { unref() {} };
    },
  });
  const interaction = createButtonInteraction(ANTITEAM_CUSTOM_IDS.submitDraft, { id: "user-1", username: "User" });

  assert.equal(await operator.handleButtonInteraction(interaction), true);

  const ticket = Object.values(db.sot.antiteam.tickets)[0];
  assert.equal(ticket.message.threadPanelMessageId, "thread-message-1");
  assert.equal(ticket.message.pingMessageId, "thread-message-2");
  assert.equal(sentToThread.length, 3);
  assert.match(JSON.stringify(sentToThread[0].components[0].toJSON()), /Помочь/);
  assert.equal(sentToThread[1].content, "<@&battalion-role> <@&extra-base-role>");
  assert.deepEqual(sentToThread[1].allowedMentions, { roles: ["battalion-role", "extra-base-role"] });
  assert.equal(sentToThread[2].content, "<@&extra-role>");
  assert.deepEqual(sentToThread[2].allowedMentions, { roles: ["extra-role"] });
  assert.deepEqual(scheduledDelays, [250]);
  assert.deepEqual(deletedMessages, ["thread-message-3"]);
});

test("standard draft submit sends a real edit-test ping and auto-deletes it", async () => {
  const db = {};
  const state = ensureAntiteamState(db).state;
  state.config.channelId = "channel-1";
  state.config.battalionRoleId = "battalion-role";
  state.config.battalionPingRoleIds = ["extra-base-role"];
  state.config.pingMode = "edit_roles";
  state.config.editPingRoleIds = ["edit-role-1", "edit-role-2"];
  setAntiteamDraft(db, "user-1", {
    userTag: "User",
    roblox: { userId: "101", username: "Anchor" },
    description: "Два ника около 4k.",
  }, { now: "2026-05-16T10:00:00.000Z" });

  const sentToThread = [];
  const editedMessages = [];
  const deletedMessages = [];
  const scheduledDelays = [];
  const thread = {
    id: "thread-1",
    isTextBased: () => true,
    messages: { fetch: async () => null },
    send: async (payload) => {
      sentToThread.push(payload);
      const id = `thread-message-${sentToThread.length}`;
      return {
        id,
        edit: async (editPayload) => {
          editedMessages.push({ id, payload: editPayload });
        },
        delete: async () => {
          deletedMessages.push(id);
        },
      };
    },
  };
  const channel = {
    id: "channel-1",
    guildId: "guild-1",
    isTextBased: () => true,
    messages: { fetch: async () => null },
    send: async () => ({
      id: "message-1",
      guildId: "guild-1",
      edit: async () => {},
      startThread: async () => thread,
    }),
  };
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:01:00.000Z",
    saveDb() {},
    fetchChannel: async (channelId) => channelId === "channel-1" ? channel : thread,
    setTimeout: (callback, delay) => {
      scheduledDelays.push(delay);
      callback();
      return { unref() {} };
    },
  });
  const interaction = createButtonInteraction(ANTITEAM_CUSTOM_IDS.submitDraft, { id: "user-1", username: "User" });

  assert.equal(await operator.handleButtonInteraction(interaction), true);

  const ticket = Object.values(db.sot.antiteam.tickets)[0];
  assert.equal(ticket.message.threadPanelMessageId, "thread-message-1");
  assert.equal(ticket.message.pingMessageId, "thread-message-2");
  assert.equal(sentToThread.length, 3);
  assert.match(JSON.stringify(sentToThread[0].components[0].toJSON()), /Помочь/);
  assert.equal(sentToThread[1].content, "<@&battalion-role> <@&extra-base-role>");
  assert.deepEqual(sentToThread[1].allowedMentions, { roles: ["battalion-role", "extra-base-role"] });
  // Real ping: the edit-test roles are mentioned at SEND time (no buffer/edit),
  // so Discord actually notifies them; the message is auto-deleted afterwards.
  assert.equal(sentToThread[2].content, "<@&edit-role-1> <@&edit-role-2>");
  assert.deepEqual(sentToThread[2].allowedMentions, { roles: ["edit-role-1", "edit-role-2"] });
  assert.deepEqual(editedMessages, []);
  assert.deepEqual(scheduledDelays, [5000]);
  assert.deepEqual(deletedMessages, ["thread-message-3"]);
});

test("standard draft submit skips edit-test buffer when edit roles are empty", async () => {
  const db = {};
  const state = ensureAntiteamState(db).state;
  state.config.channelId = "channel-1";
  state.config.battalionRoleId = "battalion-role";
  state.config.pingMode = "edit_roles";
  setAntiteamDraft(db, "user-1", {
    userTag: "User",
    roblox: { userId: "101", username: "Anchor" },
    description: "Два ника около 4k.",
  }, { now: "2026-05-16T10:00:00.000Z" });

  const sentToThread = [];
  const editedMessages = [];
  const scheduledDelays = [];
  const thread = {
    id: "thread-1",
    isTextBased: () => true,
    messages: { fetch: async () => null },
    send: async (payload) => {
      sentToThread.push(payload);
      const id = `thread-message-${sentToThread.length}`;
      return {
        id,
        edit: async (editPayload) => {
          editedMessages.push({ id, payload: editPayload });
        },
        delete: async () => {},
      };
    },
  };
  const channel = {
    id: "channel-1",
    guildId: "guild-1",
    isTextBased: () => true,
    messages: { fetch: async () => null },
    send: async () => ({
      id: "message-1",
      guildId: "guild-1",
      edit: async () => {},
      startThread: async () => thread,
    }),
  };
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:01:00.000Z",
    saveDb() {},
    fetchChannel: async (channelId) => channelId === "channel-1" ? channel : thread,
    setTimeout: (callback, delay) => {
      scheduledDelays.push(delay);
      callback();
      return { unref() {} };
    },
  });
  const interaction = createButtonInteraction(ANTITEAM_CUSTOM_IDS.submitDraft, { id: "user-1", username: "User" });

  assert.equal(await operator.handleButtonInteraction(interaction), true);

  const ticket = Object.values(db.sot.antiteam.tickets)[0];
  assert.equal(ticket.message.threadPanelMessageId, "thread-message-1");
  assert.equal(ticket.message.pingMessageId, "thread-message-2");
  assert.equal(sentToThread.length, 2);
  assert.match(JSON.stringify(sentToThread[0].components[0].toJSON()), /Помочь/);
  assert.equal(sentToThread[1].content, "<@&battalion-role>");
  assert.deepEqual(editedMessages, []);
  assert.deepEqual(scheduledDelays, []);
});

test("standard draft submit tolerates an edit-test ping send failure without aborting ticket publish", async () => {
  const db = {};
  const state = ensureAntiteamState(db).state;
  state.config.channelId = "channel-1";
  state.config.battalionRoleId = "battalion-role";
  state.config.pingMode = "edit_roles";
  state.config.editPingRoleIds = ["edit-role-1"];
  setAntiteamDraft(db, "user-1", {
    userTag: "User",
    roblox: { userId: "101", username: "Anchor" },
    description: "Два ника около 4k.",
  }, { now: "2026-05-16T10:00:00.000Z" });

  const sentToThread = [];
  const deletedMessages = [];
  const logErrors = [];
  const thread = {
    id: "thread-1",
    isTextBased: () => true,
    messages: { fetch: async () => null },
    send: async (payload) => {
      // The edit-test ping is now a real ping; simulate its send rejecting.
      if (typeof payload.content === "string" && payload.content.includes("edit-role-1")) {
        throw new Error("send failed");
      }
      sentToThread.push(payload);
      const id = `thread-message-${sentToThread.length}`;
      return {
        id,
        edit: async () => {},
        delete: async () => {
          deletedMessages.push(id);
        },
      };
    },
  };
  const channel = {
    id: "channel-1",
    guildId: "guild-1",
    isTextBased: () => true,
    messages: { fetch: async () => null },
    send: async () => ({
      id: "message-1",
      guildId: "guild-1",
      edit: async () => {},
      startThread: async () => thread,
    }),
  };
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:01:00.000Z",
    saveDb() {},
    fetchChannel: async (channelId) => channelId === "channel-1" ? channel : thread,
    logError: (...args) => logErrors.push(args.join(" ")),
    setTimeout: (callback) => {
      callback();
      return { unref() {} };
    },
  });
  const interaction = createButtonInteraction(ANTITEAM_CUSTOM_IDS.submitDraft, { id: "user-1", username: "User" });

  assert.equal(await operator.handleButtonInteraction(interaction), true);

  const ticket = Object.values(db.sot.antiteam.tickets)[0];
  assert.equal(ticket.message.threadPanelMessageId, "thread-message-1");
  assert.equal(ticket.message.pingMessageId, "thread-message-2");
  // The edit-test ping send threw, but publish still completed; only battalion
  // (sentToThread[1]) landed and the failure was logged.
  assert.equal(sentToThread.length, 2);
  assert.deepEqual(deletedMessages, []);
  assert.match(logErrors.join("\n"), /Antiteam edit ping failed: send failed/);
});

test("standard draft submit sends a real edit-test ping and auto-deletes it", async () => {
  const db = {};
  const state = ensureAntiteamState(db).state;
  state.config.channelId = "channel-1";
  state.config.battalionRoleId = "battalion-role";
  state.config.battalionPingRoleIds = ["extra-base-role"];
  state.config.pingMode = "edit_roles";
  state.config.editPingRoleIds = ["edit-role-1", "edit-role-2"];
  setAntiteamDraft(db, "user-1", {
    userTag: "User",
    roblox: { userId: "101", username: "Anchor" },
    description: "Два ника около 4k.",
  }, { now: "2026-05-16T10:00:00.000Z" });

  const sentToThread = [];
  const editedMessages = [];
  const deletedMessages = [];
  const scheduledDelays = [];
  const thread = {
    id: "thread-1",
    isTextBased: () => true,
    messages: { fetch: async () => null },
    send: async (payload) => {
      sentToThread.push(payload);
      const id = `thread-message-${sentToThread.length}`;
      return {
        id,
        edit: async (editPayload) => {
          editedMessages.push({ id, payload: editPayload });
        },
        delete: async () => {
          deletedMessages.push(id);
        },
      };
    },
  };
  const channel = {
    id: "channel-1",
    guildId: "guild-1",
    isTextBased: () => true,
    messages: { fetch: async () => null },
    send: async () => ({
      id: "message-1",
      guildId: "guild-1",
      edit: async () => {},
      startThread: async () => thread,
    }),
  };
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:01:00.000Z",
    saveDb() {},
    fetchChannel: async (channelId) => channelId === "channel-1" ? channel : thread,
    setTimeout: (callback, delay) => {
      scheduledDelays.push(delay);
      callback();
      return { unref() {} };
    },
  });
  const interaction = createButtonInteraction(ANTITEAM_CUSTOM_IDS.submitDraft, { id: "user-1", username: "User" });

  assert.equal(await operator.handleButtonInteraction(interaction), true);

  const ticket = Object.values(db.sot.antiteam.tickets)[0];
  assert.equal(ticket.message.threadPanelMessageId, "thread-message-1");
  assert.equal(ticket.message.pingMessageId, "thread-message-2");
  assert.equal(sentToThread.length, 3);
  assert.match(JSON.stringify(sentToThread[0].components[0].toJSON()), /Помочь/);
  assert.equal(sentToThread[1].content, "<@&battalion-role> <@&extra-base-role>");
  assert.deepEqual(sentToThread[1].allowedMentions, { roles: ["battalion-role", "extra-base-role"] });
  // Real ping: the edit-test roles are mentioned at SEND time (no buffer/edit),
  // so Discord actually notifies them; the message is auto-deleted afterwards.
  assert.equal(sentToThread[2].content, "<@&edit-role-1> <@&edit-role-2>");
  assert.deepEqual(sentToThread[2].allowedMentions, { roles: ["edit-role-1", "edit-role-2"] });
  assert.deepEqual(editedMessages, []);
  assert.deepEqual(scheduledDelays, [5000]);
  assert.deepEqual(deletedMessages, ["thread-message-3"]);
});

test("standard draft submit skips edit-test buffer when edit roles are empty", async () => {
  const db = {};
  const state = ensureAntiteamState(db).state;
  state.config.channelId = "channel-1";
  state.config.battalionRoleId = "battalion-role";
  state.config.pingMode = "edit_roles";
  setAntiteamDraft(db, "user-1", {
    userTag: "User",
    roblox: { userId: "101", username: "Anchor" },
    description: "Два ника около 4k.",
  }, { now: "2026-05-16T10:00:00.000Z" });

  const sentToThread = [];
  const editedMessages = [];
  const scheduledDelays = [];
  const thread = {
    id: "thread-1",
    isTextBased: () => true,
    messages: { fetch: async () => null },
    send: async (payload) => {
      sentToThread.push(payload);
      const id = `thread-message-${sentToThread.length}`;
      return {
        id,
        edit: async (editPayload) => {
          editedMessages.push({ id, payload: editPayload });
        },
        delete: async () => {},
      };
    },
  };
  const channel = {
    id: "channel-1",
    guildId: "guild-1",
    isTextBased: () => true,
    messages: { fetch: async () => null },
    send: async () => ({
      id: "message-1",
      guildId: "guild-1",
      edit: async () => {},
      startThread: async () => thread,
    }),
  };
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:01:00.000Z",
    saveDb() {},
    fetchChannel: async (channelId) => channelId === "channel-1" ? channel : thread,
    setTimeout: (callback, delay) => {
      scheduledDelays.push(delay);
      callback();
      return { unref() {} };
    },
  });
  const interaction = createButtonInteraction(ANTITEAM_CUSTOM_IDS.submitDraft, { id: "user-1", username: "User" });

  assert.equal(await operator.handleButtonInteraction(interaction), true);

  const ticket = Object.values(db.sot.antiteam.tickets)[0];
  assert.equal(ticket.message.threadPanelMessageId, "thread-message-1");
  assert.equal(ticket.message.pingMessageId, "thread-message-2");
  assert.equal(sentToThread.length, 2);
  assert.match(JSON.stringify(sentToThread[0].components[0].toJSON()), /Помочь/);
  assert.equal(sentToThread[1].content, "<@&battalion-role>");
  assert.deepEqual(editedMessages, []);
  assert.deepEqual(scheduledDelays, []);
});

test("standard draft submit tolerates an edit-test ping send failure without aborting ticket publish", async () => {
  const db = {};
  const state = ensureAntiteamState(db).state;
  state.config.channelId = "channel-1";
  state.config.battalionRoleId = "battalion-role";
  state.config.pingMode = "edit_roles";
  state.config.editPingRoleIds = ["edit-role-1"];
  setAntiteamDraft(db, "user-1", {
    userTag: "User",
    roblox: { userId: "101", username: "Anchor" },
    description: "Два ника около 4k.",
  }, { now: "2026-05-16T10:00:00.000Z" });

  const sentToThread = [];
  const deletedMessages = [];
  const logErrors = [];
  const thread = {
    id: "thread-1",
    isTextBased: () => true,
    messages: { fetch: async () => null },
    send: async (payload) => {
      // The edit-test ping is now a real ping; simulate its send rejecting.
      if (typeof payload.content === "string" && payload.content.includes("edit-role-1")) {
        throw new Error("send failed");
      }
      sentToThread.push(payload);
      const id = `thread-message-${sentToThread.length}`;
      return {
        id,
        edit: async () => {},
        delete: async () => {
          deletedMessages.push(id);
        },
      };
    },
  };
  const channel = {
    id: "channel-1",
    guildId: "guild-1",
    isTextBased: () => true,
    messages: { fetch: async () => null },
    send: async () => ({
      id: "message-1",
      guildId: "guild-1",
      edit: async () => {},
      startThread: async () => thread,
    }),
  };
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:01:00.000Z",
    saveDb() {},
    fetchChannel: async (channelId) => channelId === "channel-1" ? channel : thread,
    logError: (...args) => logErrors.push(args.join(" ")),
    setTimeout: (callback) => {
      callback();
      return { unref() {} };
    },
  });
  const interaction = createButtonInteraction(ANTITEAM_CUSTOM_IDS.submitDraft, { id: "user-1", username: "User" });

  assert.equal(await operator.handleButtonInteraction(interaction), true);

  const ticket = Object.values(db.sot.antiteam.tickets)[0];
  assert.equal(ticket.message.threadPanelMessageId, "thread-message-1");
  assert.equal(ticket.message.pingMessageId, "thread-message-2");
  // The edit-test ping send threw, but publish still completed; only battalion
  // (sentToThread[1]) landed and the failure was logged.
  assert.equal(sentToThread.length, 2);
  assert.deepEqual(deletedMessages, []);
  assert.match(logErrors.join("\n"), /Antiteam edit ping failed: send failed/);
});

test("draft cancel clears a live draft and confirms cancellation", async () => {
  const db = {};
  setAntiteamDraft(db, "user-1", {
    userTag: "User",
    roblox: { userId: "101", username: "Anchor" },
    description: "Два ника около 4k.",
  }, { now: "2026-05-16T10:00:00.000Z" });
  const operator = createAntiteamOperator({
    db,
    saveDb() {},
  });
  const interaction = createButtonInteraction(ANTITEAM_CUSTOM_IDS.cancelDraft, { id: "user-1", username: "User" });

  assert.equal(await operator.handleButtonInteraction(interaction), true);

  assert.equal(interaction.calls[0][0], "deferUpdate");
  assert.equal(db.sot.antiteam.drafts["user-1"], undefined);
  assert.equal(interaction.calls.at(-1)[0], "editReply");
  assert.equal(interaction.calls.at(-1)[1].content, "Заявка антитима отменена.");
});

test("draft cancel closes the setup reply when deleteReply is available", async () => {
  const db = {};
  setAntiteamDraft(db, "user-1", {
    userTag: "User",
    roblox: { userId: "101", username: "Anchor" },
    description: "Два ника около 4k.",
  }, { now: "2026-05-16T10:00:00.000Z" });
  const operator = createAntiteamOperator({
    db,
    saveDb() {},
  });
  const interaction = createButtonInteraction(ANTITEAM_CUSTOM_IDS.cancelDraft, { id: "user-1", username: "User" });
  interaction.deleteReply = async () => {
    interaction.calls.push(["deleteReply"]);
  };

  assert.equal(await operator.handleButtonInteraction(interaction), true);

  assert.equal(db.sot.antiteam.drafts["user-1"], undefined);
  assert.deepEqual(interaction.calls.map((call) => call[0]), ["deferUpdate", "deleteReply"]);
});

test("draft cancel does not reply again when the interaction is already deferred", async () => {
  const db = {};
  setAntiteamDraft(db, "user-1", {
    userTag: "User",
    roblox: { userId: "101", username: "Anchor" },
    description: "Нужна помощь.",
  }, { now: "2026-05-16T10:00:00.000Z" });
  const errors = [];
  const operator = createAntiteamOperator({
    db,
    saveDb() {},
    logError: (...args) => errors.push(args.join(" ")),
  });
  const interaction = createButtonInteraction(ANTITEAM_CUSTOM_IDS.cancelDraft, { id: "user-1", username: "User" });
  interaction.deferred = true;

  assert.equal(await operator.handleButtonInteraction(interaction), true);

  assert.deepEqual(interaction.calls.map((call) => call[0]), ["editReply"]);
  assert.equal(db.sot.antiteam.drafts["user-1"], undefined);
  assert.doesNotMatch(errors.join("\n"), /already been sent or deferred/i);
});

test("draft cancel fails gracefully when the draft already expired", async () => {
  const db = {};
  const operator = createAntiteamOperator({
    db,
    saveDb() {},
  });
  const interaction = createButtonInteraction(ANTITEAM_CUSTOM_IDS.cancelDraft, { id: "user-1", username: "User" });

  assert.equal(await operator.handleButtonInteraction(interaction), true);

  assert.equal(interaction.calls[0][0], "reply");
  assert.equal(interaction.calls[0][1].content, "Черновик истёк. Начни заново.");
  assert.equal(interaction.calls[0][1].flags, MessageFlags.Ephemeral);
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
  const publicEdits = [];
  let startThreadOptions = null;
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
        guildId: "guild-1",
        edit: async (editPayload) => {
          publicEdits.push(editPayload);
        },
        startThread: async (options) => {
          startThreadOptions = options;
          return thread;
        },
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
  // Friend scan + public edit now run in a detached tail after publish; let it
  // finish before asserting the edit happened.
  await new Promise((resolve) => setImmediate(resolve));

  const ticket = Object.values(db.sot.antiteam.tickets)[0];
  assert.equal(ticket.kind, "clan");
  assert.equal(ticket.message.guildId, "guild-1");
  assert.equal(sentToChannel.length, 2);
  assert.equal(publicEdits.length, 1);
  assert.equal(sentToChannel[0].files, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(startThreadOptions, "type"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(startThreadOptions, "invitable"), false);
  assert.equal(startThreadOptions.autoArchiveDuration, 60);
  assert.match(JSON.stringify(sentToChannel[0].components[0].toJSON()), /ФАЙТ С ХН/);
  assert.match(JSON.stringify(publicEdits[0].components[1].toJSON()), /Прийти на помощь/);
  assert.deepEqual(interaction.calls.map((call) => call[0]), ["deferUpdate", "editReply", "editReply"]);
  assert.match(interaction.calls[1][1].content, /Заявка принята/);
  assert.match(interaction.calls.at(-1)[1].content, /Заявка опубликована/);
});

test("draft submit confirms acceptance before publish finalize finishes", async () => {
  const db = {};
  ensureAntiteamState(db).state.config.channelId = "channel-1";
  setAntiteamDraft(db, "user-1", {
    userTag: "User",
    roblox: { userId: "101", username: "Anchor" },
    description: "Тимятся двое у центра.",
  }, { now: "2026-05-16T10:00:00.000Z" });

  let releaseChannelSend = null;
  let resolveChannelSendStarted = null;
  const channelSendStarted = new Promise((resolve) => {
    resolveChannelSendStarted = resolve;
  });
  const thread = {
    id: "thread-1",
    isTextBased: () => true,
    messages: { fetch: async () => null },
    send: async (payload) => ({
      id: payload?.content ? "thread-ping-1" : "thread-panel-1",
      delete: async () => {},
    }),
  };
  const channel = {
    id: "channel-1",
    guildId: "guild-1",
    type: 0,
    isTextBased: () => true,
    messages: { fetch: async () => null },
    send: async () => {
      if (!releaseChannelSend) {
        resolveChannelSendStarted();
        await new Promise((resolve) => {
          releaseChannelSend = resolve;
        });
      }
      return {
        id: "message-1",
        guildId: "guild-1",
        edit: async () => {},
        startThread: async () => thread,
      };
    },
  };
  const interaction = createButtonInteraction(ANTITEAM_CUSTOM_IDS.submitDraft, { id: "user-1", username: "User" });
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:01:00.000Z",
    saveDb() {},
    fetchChannel: async (channelId) => channelId === "channel-1" ? channel : thread,
  });

  const pending = operator.handleButtonInteraction(interaction);
  await channelSendStarted;

  assert.deepEqual(interaction.calls.map((call) => call[0]), ["deferUpdate", "editReply"]);
  assert.match(interaction.calls[1][1].content, /Заявка принята/);

  releaseChannelSend();
  assert.equal(await pending, true);
  assert.deepEqual(interaction.calls.map((call) => call[0]), ["deferUpdate", "editReply", "editReply"]);
  assert.match(interaction.calls.at(-1)[1].content, /Заявка опубликована/);
});

test("draft submit closes the setup reply immediately and publishes in the background when deleteReply is available", async () => {
  const db = {};
  ensureAntiteamState(db).state.config.channelId = "channel-1";
  setAntiteamDraft(db, "user-1", {
    userTag: "User",
    roblox: { userId: "101", username: "Anchor" },
    description: "Тимятся двое у центра.",
  }, { now: "2026-05-16T10:00:00.000Z" });

  let releaseChannelSend = null;
  let resolveChannelSendStarted = null;
  const channelSendStarted = new Promise((resolve) => {
    resolveChannelSendStarted = resolve;
  });
  const thread = {
    id: "thread-1",
    isTextBased: () => true,
    messages: { fetch: async () => null },
    send: async (payload) => ({
      id: payload?.content ? "thread-ping-1" : "thread-panel-1",
      delete: async () => {},
    }),
  };
  const channel = {
    id: "channel-1",
    guildId: "guild-1",
    type: 0,
    isTextBased: () => true,
    messages: { fetch: async () => null },
    send: async () => {
      resolveChannelSendStarted();
      await new Promise((resolve) => {
        releaseChannelSend = resolve;
      });
      return {
        id: "message-1",
        guildId: "guild-1",
        edit: async () => {},
        startThread: async () => thread,
      };
    },
  };
  const interaction = createButtonInteraction(ANTITEAM_CUSTOM_IDS.submitDraft, { id: "user-1", username: "User" });
  interaction.deleteReply = async () => {
    interaction.calls.push(["deleteReply"]);
  };
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:01:00.000Z",
    saveDb() {},
    fetchChannel: async (channelId) => channelId === "channel-1" ? channel : thread,
  });

  const result = await Promise.race([
    operator.handleButtonInteraction(interaction).then(() => "resolved"),
    new Promise((resolve) => setTimeout(() => resolve("timeout"), 200)),
  ]);

  assert.equal(result, "resolved");
  assert.deepEqual(interaction.calls.map((call) => call[0]), ["deferUpdate", "deleteReply"]);

  await channelSendStarted;
  releaseChannelSend();
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(interaction.calls.map((call) => call[0]), ["deferUpdate", "deleteReply"]);
});

test("draft submit does not wait for detached panel resend after publish finalize", async () => {
  const db = {};
  ensureAntiteamState(db).state.config.channelId = "channel-1";
  setAntiteamDraft(db, "user-1", {
    userTag: "User",
    roblox: { userId: "101", username: "Anchor" },
    description: "Тимятся двое у центра.",
  }, { now: "2026-05-16T10:00:00.000Z" });

  let sendCount = 0;
  let releasePanelResend = null;
  const thread = {
    id: "thread-1",
    isTextBased: () => true,
    messages: { fetch: async () => null },
    send: async (payload) => ({
      id: payload?.content ? `thread-ping-${sendCount}` : `thread-panel-${sendCount}`,
      delete: async () => {},
    }),
  };
  const channel = {
    id: "channel-1",
    guildId: "guild-1",
    type: 0,
    isTextBased: () => true,
    messages: { fetch: async () => null },
    send: async () => {
      sendCount += 1;
      if (sendCount === 1) {
        return {
          id: "message-1",
          guildId: "guild-1",
          edit: async () => {},
          startThread: async () => thread,
        };
      }
      await new Promise((resolve) => {
        releasePanelResend = resolve;
      });
      return {
        id: `message-${sendCount}`,
        guildId: "guild-1",
        edit: async () => {},
        startThread: async () => thread,
      };
    },
  };
  const interaction = createButtonInteraction(ANTITEAM_CUSTOM_IDS.submitDraft, { id: "user-1", username: "User" });
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:01:00.000Z",
    saveDb() {},
    fetchChannel: async (channelId) => channelId === "channel-1" ? channel : thread,
  });

  const result = await Promise.race([
    operator.handleButtonInteraction(interaction).then(() => "resolved"),
    new Promise((resolve) => setTimeout(() => resolve("timeout"), 200)),
  ]);

  assert.equal(result, "resolved");
  assert.match(interaction.calls.at(-1)[1].content, /Заявка опубликована/);

  await Promise.resolve();
  if (releasePanelResend) releasePanelResend();
});

test("draft submit does not wait for detached battalion role grant after publish finalize", async () => {
  const db = {};
  const state = ensureAntiteamState(db).state;
  state.config.channelId = "channel-1";
  state.config.battalionRoleId = "battalion-role";
  setAntiteamDraft(db, "user-1", {
    userTag: "User",
    roblox: { userId: "101", username: "Anchor" },
    description: "Тимятся двое у центра.",
  }, { now: "2026-05-16T10:00:00.000Z" });

  let releaseRoleGrant = null;
  let resolveRoleGrantStarted = null;
  const roleGrantStarted = new Promise((resolve) => {
    resolveRoleGrantStarted = resolve;
  });
  const granted = [];
  const thread = {
    id: "thread-1",
    isTextBased: () => true,
    messages: { fetch: async () => null },
    send: async (payload) => ({
      id: payload?.content ? "thread-ping-1" : "thread-panel-1",
      delete: async () => {},
    }),
  };
  const channel = {
    id: "channel-1",
    guildId: "guild-1",
    type: 0,
    isTextBased: () => true,
    messages: { fetch: async () => null },
    send: async () => ({
      id: "message-1",
      guildId: "guild-1",
      edit: async () => {},
      startThread: async () => thread,
    }),
  };
  const interaction = createButtonInteraction(ANTITEAM_CUSTOM_IDS.submitDraft, { id: "user-1", username: "User" });
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:01:00.000Z",
    saveDb() {},
    fetchChannel: async (channelId) => channelId === "channel-1" ? channel : thread,
    grantRole: async (userId, roleId, reason) => {
      granted.push({ userId, roleId, reason });
      resolveRoleGrantStarted();
      await new Promise((resolve) => {
        releaseRoleGrant = resolve;
      });
      return { granted: true, roleId };
    },
  });

  const result = await Promise.race([
    operator.handleButtonInteraction(interaction).then(() => "resolved"),
    new Promise((resolve) => setTimeout(() => resolve("timeout"), 200)),
  ]);

  assert.equal(result, "resolved");
  assert.match(interaction.calls.at(-1)[1].content, /Заявка опубликована/);

  await roleGrantStarted;
  assert.deepEqual(granted, [{ userId: "user-1", roleId: "battalion-role", reason: "antiteam request created" }]);

  if (releaseRoleGrant) releaseRoleGrant();
});

test("draft submit retries detached battalion role grant after a transient failure", async () => {
  const db = {};
  const state = ensureAntiteamState(db).state;
  state.config.channelId = "channel-1";
  state.config.battalionRoleId = "battalion-role";
  setAntiteamDraft(db, "user-1", {
    userTag: "User",
    roblox: { userId: "101", username: "Anchor" },
    description: "Тимятся двое у центра.",
  }, { now: "2026-05-16T10:00:00.000Z" });

  const scheduled = [];
  const errors = [];
  const granted = [];
  let grantAttempts = 0;
  const thread = {
    id: "thread-1",
    isTextBased: () => true,
    messages: { fetch: async () => null },
    send: async (payload) => ({
      id: payload?.content ? "thread-ping-1" : "thread-panel-1",
      delete: async () => {},
    }),
  };
  const channel = {
    id: "channel-1",
    guildId: "guild-1",
    type: 0,
    isTextBased: () => true,
    messages: { fetch: async () => null },
    send: async () => ({
      id: "message-1",
      guildId: "guild-1",
      edit: async () => {},
      startThread: async () => thread,
    }),
  };
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:01:00.000Z",
    saveDb() {},
    fetchChannel: async (channelId) => channelId === "channel-1" ? channel : thread,
    logError: (...args) => errors.push(args.join(" ")),
    setTimeout: (callback, delay) => {
      scheduled.push({ callback, delay });
      return { unref() {} };
    },
    grantRole: async (userId, roleId, reason) => {
      grantAttempts += 1;
      if (grantAttempts === 1) throw new Error("temporary grant failure");
      granted.push({ userId, roleId, reason });
      return { granted: true, roleId };
    },
  });
  const interaction = createButtonInteraction(ANTITEAM_CUSTOM_IDS.submitDraft, { id: "user-1", username: "User" });

  assert.equal(await operator.handleButtonInteraction(interaction), true);
  assert.match(interaction.calls.at(-1)[1].content, /Заявка опубликована/);

  await Promise.resolve();

  assert.equal(grantAttempts, 1);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 2000);
  assert.match(errors.join("\n"), /role grant retry scheduled/i);

  scheduled[0].callback();
  await Promise.resolve();

  assert.equal(grantAttempts, 2);
  assert.deepEqual(granted, [{ userId: "user-1", roleId: "battalion-role", reason: "antiteam request created" }]);
});

test("concurrent draft submits serialize panel resend and replay once after an in-flight resend", async () => {
  const db = {};
  const state = ensureAntiteamState(db).state;
  state.config.channelId = "channel-1";
  setAntiteamDraft(db, "user-1", {
    userTag: "User One",
    roblox: { userId: "101", username: "AnchorOne" },
    description: "Тимятся двое у центра.",
  }, { now: "2026-05-16T10:00:00.000Z" });
  setAntiteamDraft(db, "user-2", {
    userTag: "User Two",
    roblox: { userId: "202", username: "AnchorTwo" },
    description: "Тимятся трое у моста.",
  }, { now: "2026-05-16T10:00:00.000Z" });

  let sendCount = 0;
  const panelSendOrder = [];
  let releaseFirstPanelSend = null;
  let resolveFirstPanelSendStarted = null;
  let resolveSecondPanelSendStarted = null;
  const firstPanelSendStarted = new Promise((resolve) => {
    resolveFirstPanelSendStarted = resolve;
  });
  const secondPanelSendStarted = new Promise((resolve) => {
    resolveSecondPanelSendStarted = resolve;
  });
  const thread = {
    id: "thread-1",
    isTextBased: () => true,
    messages: { fetch: async () => null },
    send: async (payload) => ({
      id: payload?.content ? `thread-ping-${sendCount}` : `thread-panel-${sendCount}`,
      delete: async () => {},
    }),
  };
  const channel = {
    id: "channel-1",
    guildId: "guild-1",
    type: 0,
    isTextBased: () => true,
    messages: { fetch: async () => null },
    send: async () => {
      sendCount += 1;
      if (sendCount === 1 || sendCount === 3) {
        return {
          id: `message-${sendCount}`,
          guildId: "guild-1",
          edit: async () => {},
          startThread: async () => thread,
        };
      }
      panelSendOrder.push(sendCount);
      if (sendCount === 2) {
        resolveFirstPanelSendStarted();
        await new Promise((resolve) => {
          releaseFirstPanelSend = resolve;
        });
      }
      if (sendCount === 4) resolveSecondPanelSendStarted();
      return {
        id: `panel-${sendCount}`,
        guildId: "guild-1",
        delete: async () => {},
      };
    },
  };
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:01:00.000Z",
    saveDb() {},
    fetchChannel: async (channelId) => channelId === "channel-1" ? channel : thread,
  });

  const firstInteraction = createButtonInteraction(ANTITEAM_CUSTOM_IDS.submitDraft, { id: "user-1", username: "UserOne" });
  const secondInteraction = createButtonInteraction(ANTITEAM_CUSTOM_IDS.submitDraft, { id: "user-2", username: "UserTwo" });

  assert.equal(await operator.handleButtonInteraction(firstInteraction), true);
  await firstPanelSendStarted;

  const secondResult = await Promise.race([
    operator.handleButtonInteraction(secondInteraction).then(() => "resolved"),
    new Promise((resolve) => setTimeout(() => resolve("timeout"), 200)),
  ]);

  assert.equal(secondResult, "resolved");
  assert.deepEqual(panelSendOrder, [2]);

  releaseFirstPanelSend();
  const replayResult = await Promise.race([
    secondPanelSendStarted.then(() => "replayed"),
    new Promise((resolve) => setTimeout(() => resolve("timeout"), 200)),
  ]);

  assert.equal(replayResult, "replayed");
  assert.deepEqual(panelSendOrder, [2, 4]);
  assert.match(secondInteraction.calls.at(-1)[1].content, /Заявка опубликована/);
});

test("draft toggle and select update the setup panel immediately", async () => {
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

  const select = createSelectInteraction(ANTITEAM_CUSTOM_IDS.countSelect, ["6-10"]);
  assert.equal(await operator.handleSelectMenuInteraction(select), true);
  assert.deepEqual(select.calls.map((call) => call[0]), ["deferUpdate", "editReply"]);
  assert.equal(db.sot.antiteam.drafts["user-1"].count, "6-10");
});

test("draft toggle bypasses serialized persistence queue and updates immediately", async () => {
  const db = {};
  setAntiteamDraft(db, "user-1", {
    userTag: "User",
    roblox: { userId: "101", username: "Anchor" },
    description: "Тимятся двое у центра.",
  }, { now: "2026-05-16T10:00:00.000Z" });

  const toggle = createButtonInteraction(ANTITEAM_CUSTOM_IDS.toggleDirect, { id: "user-1", username: "User" });
  let serializedMutationCalled = false;
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:01:00.000Z",
    saveDb() {},
    runSerializedMutation: async () => {
      serializedMutationCalled = true;
      throw new Error("draft toggle should not enter serialized persistence queue");
    },
  });

  assert.equal(await operator.handleButtonInteraction(toggle), true);
  assert.equal(serializedMutationCalled, false);
  assert.deepEqual(toggle.calls.map((call) => call[0]), ["deferUpdate", "editReply"]);
  assert.equal(db.sot.antiteam.drafts["user-1"].directJoinEnabled, true);
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
  interaction.message = { id: "setup-1" };
  interaction.update = async (payload) => {
    interaction.calls.push(["update", payload]);
  };
  assert.equal(await operator.handleModalSubmitInteraction(interaction), true);

  assert.equal(db.sot.antiteam.drafts["user-1"].description, "Бить A/B у центра.");
  assert.deepEqual(interaction.calls.map((call) => call[0]), ["update"]);
  assert.match(JSON.stringify(interaction.calls[0][1].components[0].toJSON()), /Бить A\/B у центра/);
});

test("description modal keeps saved text when the interaction expired before ack", async () => {
  const db = {};
  setAntiteamDraft(db, "user-1", {
    userTag: "User",
    roblox: { userId: "101", username: "Anchor" },
  }, { now: "2026-05-16T10:00:00.000Z" });
  const errors = [];
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:01:00.000Z",
    saveDb() {},
    logError: (...args) => errors.push(args.join(" ")),
  });
  const interaction = createModalInteraction("at:desc:modal", { description: "Бить C/D у моста." });
  interaction.deferReply = async () => {
    interaction.calls.push(["deferReply"]);
    throw new Error("Unknown interaction");
  };

  assert.equal(await operator.handleModalSubmitInteraction(interaction), true);

  assert.equal(db.sot.antiteam.drafts["user-1"].description, "Бить C/D у моста.");
  assert.deepEqual(interaction.calls.map((call) => call[0]), ["deferReply"]);
  assert.match(errors.join("\n"), /expired_before_ack/i);
});

test("moderator stats controls delete one helper and clear the aggregate table", async () => {
  const db = {};
  const state = ensureAntiteamState(db).state;
  state.config.helperRewardRoles = { "1": "role-1", "5": "role-5", "10": "", "20": "", "50": "" };
  state.stats.helpers["helper-1"] = { responded: 2, linkGranted: 2, confirmedArrived: 1, lastHelpedAt: "2026-05-16T10:00:00.000Z" };
  state.stats.helpers["helper-2"] = { responded: 1, linkGranted: 1, confirmedArrived: 5, lastHelpedAt: "2026-05-16T10:01:00.000Z" };
  const granted = [];
  const operator = createAntiteamOperator({
    db,
    saveDb() {},
    grantRole: async (userId, roleId) => {
      granted.push({ userId, roleId });
    },
  });
  const member = { permissions: { has: () => true }, roles: { cache: new Map() } };

  const open = createButtonInteraction(ANTITEAM_CUSTOM_IDS.stats, { id: "mod-1", username: "Mod" });
  open.member = member;
  assert.equal(await operator.handleButtonInteraction(open), true);
  assert.match(JSON.stringify(open.calls[0][1].components[0].toJSON()), /Статистика помощи/);

  const rolesPanel = createButtonInteraction(ANTITEAM_CUSTOM_IDS.statsRoles, { id: "mod-1", username: "Mod" });
  rolesPanel.member = member;
  assert.equal(await operator.handleButtonInteraction(rolesPanel), true);
  assert.equal(rolesPanel.calls[0][0], "showModal");
  assert.equal(rolesPanel.calls[0][1].data.custom_id, "at:stats:roles_modal");

  const syncRoles = createButtonInteraction(ANTITEAM_CUSTOM_IDS.statsSyncRoles, { id: "mod-1", username: "Mod" });
  syncRoles.member = member;
  assert.equal(await operator.handleButtonInteraction(syncRoles), true);
  assert.deepEqual(granted, [
    { userId: "helper-1", roleId: "role-1" },
    { userId: "helper-2", roleId: "role-5" },
  ]);

  const rolesModal = createModalInteraction("at:stats:roles_modal", {
    role_1: "<@&11111>",
    role_5: "22222",
    role_10: "",
    role_20: "",
    role_50: "",
  }, { id: "mod-1", username: "Mod" }, member);
  assert.equal(await operator.handleModalSubmitInteraction(rolesModal), true);
  assert.equal(db.sot.antiteam.config.helperRewardRoles["1"], "11111");
  assert.equal(db.sot.antiteam.config.helperRewardRoles["5"], "22222");

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

test("helper reward role sync keeps only the highest configured reached role", async () => {
  const db = {};
  const state = ensureAntiteamState(db).state;
  state.config.helperRewardRoles = { "1": "role-1", "5": "role-5", "10": "role-10", "20": "", "50": "" };
  state.stats.helpers["helper-1"] = { responded: 5, linkGranted: 5, confirmedArrived: 5, lastHelpedAt: "2026-05-16T10:00:00.000Z" };
  const roleCache = new Map([["role-1", { id: "role-1" }]]);
  const added = [];
  const removed = [];
  const operator = createAntiteamOperator({
    db,
    saveDb() {},
    fetchMember: async () => ({
      roles: {
        cache: roleCache,
        add: async (roleId, reason) => {
          added.push({ roleId, reason });
          roleCache.set(roleId, { id: roleId });
        },
        remove: async (roleId, reason) => {
          removed.push({ roleId, reason });
          roleCache.delete(roleId);
        },
      },
    }),
  });
  const interaction = createButtonInteraction(ANTITEAM_CUSTOM_IDS.statsSyncRoles, { id: "mod-1", username: "Mod" });
  interaction.member = { permissions: { has: () => true }, roles: { cache: new Map() } };

  assert.equal(await operator.handleButtonInteraction(interaction), true);

  assert.deepEqual(added, [{ roleId: "role-5", reason: "antiteam helper reward sync" }]);
  assert.deepEqual(removed, [{ roleId: "role-1", reason: "antiteam helper reward sync" }]);
  assert.equal(roleCache.has("role-1"), false);
  assert.equal(roleCache.has("role-5"), true);
  assert.match(JSON.stringify(interaction.calls.at(-1)[1].components[0].toJSON()), /снятий старых ролей \*\*1\*\*/);
});

test("photo collector publishes ticket with multiple reattached images from one upload message", async () => {
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
    }], ["a2", {
      url: "https://cdn.discordapp.com/attachments/1/2/team-2.webp",
      name: "team-2.webp",
      contentType: "image/webp",
      size: 4321,
    }], ["note", {
      url: "https://cdn.discordapp.com/attachments/1/2/readme.txt",
      name: "readme.txt",
      contentType: "text/plain",
      size: 111,
    }]]),
    delete: async () => {
      deleted = true;
    },
  }), true);

  const ticket = Object.values(db.sot.antiteam.tickets)[0];
  assert.equal(ticket.photos.length, 2);
  assert.equal(ticket.message.photoAttachmentName, "team.png");
  assert.deepEqual(ticket.message.photoAttachmentNames, ["team.png", "team-2.webp"]);
  assert.equal(sentToChannel[0].files.length, 2);
  assert.equal(sentToChannel[0].files[0].name, "team.png");
  assert.equal(sentToChannel[0].files[1].name, "team-2.webp");
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

  assert.deepEqual(interaction.calls.map((call) => call[0]), ["deferReply", "editReply"]);
  assert.equal(interaction.calls.at(-1)[1].content, "Антитим закрыт. Итог записан в заявку.");
  assert.equal(renamedTo, "⚫ 3-5 тимеров • Author");
  assert.match(JSON.stringify(publicEdit.components[0].toJSON()), /⚫ Завершено • 3-5 тимеров/);
  assert.match(JSON.stringify(threadPanelEdit.components[0].toJSON()), /✅ Закрыто/);
});

test("closing ticket removes ping message, keeps thread members, locks thread, and archives it", async () => {
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
  let membersFetched = false;
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
      fetch: async () => {
        membersFetched = true;
        return new Map([
          ["author-1", { id: "author-1", user: { id: "author-1", bot: false } }],
          ["helper-1", { id: "helper-1", user: { id: "helper-1", bot: false } }],
          ["admin-1", { id: "admin-1", user: { id: "admin-1", bot: false }, permissions: { has: () => true } }],
        ]);
      },
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
  assert.equal(membersFetched, false);
  assert.deepEqual(removedMembers, []);
});

test("closing ticket writes helper result markers into the public message", async () => {
  const db = {};
  const state = ensureAntiteamState(db).state;
  state.config.helperRewardRoles = { "1": "role-1", "5": "role-5", "10": "", "20": "", "50": "" };
  state.stats.helpers["helper-1"] = { responded: 4, linkGranted: 4, confirmedArrived: 4, lastHelpedAt: "2026-05-16T09:00:00.000Z" };
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
  const granted = [];
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:04:00.000Z",
    saveDb() {},
    grantRole: async (userId, roleId) => {
      granted.push({ userId, roleId });
    },
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
  assert.equal(db.sot.antiteam.stats.helpers["helper-1"].confirmedArrived, 5);
  assert.deepEqual(granted, [
    { userId: "helper-1", roleId: "role-5" },
  ]);
});

test("auto-close reuses thread cleanup, keeps thread members, and archives the mission", async () => {
  const db = {};
  const state = ensureAntiteamState(db).state;
  state.config.missionAutoCloseMinutes = 180;
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
  let membersFetched = false;
  const removedMembers = [];
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T13:05:00.000Z",
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
          fetch: async () => {
            membersFetched = true;
            return new Map([
              ["author-1", { id: "author-1", user: { id: "author-1", bot: false } }],
              ["helper-1", { id: "helper-1", user: { id: "helper-1", bot: false } }],
            ]);
          },
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
  assert.equal(db.sot.antiteam.tickets["ticket-1"].closeSummary.text, "Автозавершено: 180 мин без движения.");
  assert.equal(pingDeleted, true);
  assert.equal(locked, true);
  assert.equal(archived, true);
  assert.equal(membersFetched, false);
  assert.deepEqual(removedMembers, []);
});

test("auto-close sweep skips clan war tickets", async () => {
  const db = {};
  const state = ensureAntiteamState(db).state;
  state.config.missionAutoCloseMinutes = 120;
  const draft = setAntiteamDraft(db, "caller-1", {
    kind: "clan",
    userTag: "Caller",
    anchorUserId: "anchor-1",
    anchorUserTag: "Anchor",
    roblox: { userId: "101", username: "Anchor" },
    description: "Вражеский клан держит сервер.",
  }, { now: "2026-05-16T10:00:00.000Z" });
  createAntiteamTicketFromDraft(db, draft, {
    id: "ticket-clan-1",
    now: "2026-05-16T10:01:00.000Z",
  });
  db.sot.antiteam.tickets["ticket-clan-1"].lastActivityAt = "2026-05-16T10:01:00.000Z";

  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T12:05:00.000Z",
    saveDb() {},
  });

  const result = await operator.sweepIdleTickets();

  assert.equal(result.closedCount, 0);
  assert.equal(db.sot.antiteam.tickets["ticket-clan-1"].status, "open");
  assert.equal(db.sot.antiteam.tickets["ticket-clan-1"].autoClosed, false);
});

test("auto-close sweep skips tickets with per-ticket auto-close disabled", async () => {
  const db = {};
  const state = ensureAntiteamState(db).state;
  state.config.missionAutoCloseMinutes = 120;
  const draft = setAntiteamDraft(db, "author-1", {
    userTag: "Author",
    roblox: { userId: "101", username: "Anchor" },
    level: "medium",
    count: "2-4",
    description: "Цели A/B.",
  }, { now: "2026-05-16T10:00:00.000Z" });
  createAntiteamTicketFromDraft(db, draft, {
    id: "ticket-1",
    now: "2026-05-16T10:01:00.000Z",
  });
  db.sot.antiteam.tickets["ticket-1"].autoCloseEnabled = false;
  db.sot.antiteam.tickets["ticket-1"].lastActivityAt = "2026-05-16T10:01:00.000Z";

  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T12:05:00.000Z",
    saveDb() {},
  });

  const result = await operator.sweepIdleTickets();

  assert.equal(result.closedCount, 0);
  assert.equal(db.sot.antiteam.tickets["ticket-1"].status, "open");
  assert.equal(db.sot.antiteam.tickets["ticket-1"].autoClosed, false);
});

test("advanced config modal updates timing and Roblox link settings", async () => {
  const db = {};
  ensureAntiteamState(db).state;
  const draft = setAntiteamDraft(db, "author-1", {
    userTag: "Author",
    roblox: { userId: "101", username: "Anchor" },
    level: "medium",
    count: "2-4",
    description: "Цели A/B.",
  }, { now: "2026-05-16T10:00:00.000Z" });
  const ticket = createAntiteamTicketFromDraft(db, draft, {
    id: "ticket-1",
    now: "2026-05-16T10:01:00.000Z",
  });
  ticket.message = {
    channelId: "channel-1",
    messageId: "message-1",
    threadId: "thread-1",
    threadPanelMessageId: "panel-1",
  };

  let panelEdit = null;
  const operator = createAntiteamOperator({
    db,
    saveDb() {},
    fetchChannel: async (channelId) => {
      if (channelId === "channel-1") {
        return {
          messages: {
            fetch: async () => ({
              edit: async () => {},
            }),
          },
        };
      }
      if (channelId === "thread-1") {
        return {
          messages: {
            fetch: async (messageId) => messageId === "panel-1"
              ? {
                edit: async (payload) => {
                  panelEdit = payload;
                },
              }
              : null,
          },
        };
      }
      return null;
    },
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
  assert.match(JSON.stringify(interaction.calls.at(-1)[1].components[0].toJSON()), /Обновлено открытых миссий: \*\*1\*\*/);
  assert.match(JSON.stringify(panelEdit.components[1].toJSON()), /Закрывать через 180 мин/);
});

test("publishing the start panel sends the new panel before deleting the old one", async () => {
  const db = {};
  const state = ensureAntiteamState(db).state;
  state.config.channelId = "channel-1";
  state.config.panelMessageId = "old-panel-1";

  const order = [];
  const channel = {
    id: "channel-1",
    isTextBased: () => true,
    messages: {
      fetch: async (id) => (id === "old-panel-1"
        ? { id: "old-panel-1", delete: async () => { order.push("delete-old"); } }
        : null),
    },
    send: async () => {
      order.push("send-new");
      return { id: "new-panel-1" };
    },
  };
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:01:00.000Z",
    saveDb() {},
    isModerator: () => true,
    fetchChannel: async (channelId) => (channelId === "channel-1" ? channel : null),
  });
  const interaction = createButtonInteraction(ANTITEAM_CUSTOM_IDS.publishPanel, { id: "admin-1", username: "Admin" });

  assert.equal(await operator.handleButtonInteraction(interaction), true);

  // New panel is sent first so the "создать антитим" button never disappears.
  assert.deepEqual(order, ["send-new", "delete-old"]);
  assert.equal(db.sot.antiteam.config.panelMessageId, "new-panel-1");
});

test("publishing the start panel cleans leaked previous-day panels discovered in recent messages", async () => {
  const db = {};
  const state = ensureAntiteamState(db).state;
  state.config.channelId = "channel-1";
  state.config.panelMessageId = "known-panel";
  state.config.panelMessageIds = ["older-known-panel"];

  const deleted = [];
  const channel = {
    id: "channel-1",
    isTextBased: () => true,
    messages: {
      fetch: async (arg) => {
        if (arg && typeof arg === "object") {
          return new Map([
            ["yesterday-panel", {
              id: "yesterday-panel",
              components: [{ components: [{ custom_id: ANTITEAM_CUSTOM_IDS.open }] }],
            }],
            ["ticket-message", {
              id: "ticket-message",
              components: [{ components: [{ custom_id: ticketButtonId("help", "ticket-1") }] }],
            }],
          ]);
        }
        return null;
      },
      delete: async (messageId) => {
        deleted.push(messageId);
      },
    },
    send: async () => ({ id: "new-panel-1" }),
  };
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-17T00:05:00.000Z",
    saveDb() {},
    isModerator: () => true,
    fetchChannel: async (channelId) => (channelId === "channel-1" ? channel : null),
  });
  const interaction = createButtonInteraction(ANTITEAM_CUSTOM_IDS.publishPanel, { id: "admin-1", username: "Admin" });

  assert.equal(await operator.handleButtonInteraction(interaction), true);

  assert.deepEqual(deleted, ["known-panel", "older-known-panel", "yesterday-panel"]);
  assert.equal(db.sot.antiteam.config.panelMessageId, "new-panel-1");
  assert.deepEqual(db.sot.antiteam.config.panelMessageIds, ["new-panel-1"]);
});

test("test mode toggle flips config and is moderator-only", async () => {
  const db = {};
  ensureAntiteamState(db);

  const denied = createButtonInteraction(ANTITEAM_CUSTOM_IDS.toggleTestMode, { id: "any-1", username: "Any" });
  const deniedOperator = createAntiteamOperator({ db, saveDb() {}, isModerator: () => false });
  assert.equal(await deniedOperator.handleButtonInteraction(denied), true);
  assert.equal(db.sot.antiteam.config.testMode, false);
  assert.equal(denied.calls[0][0], "reply");

  const operator = createAntiteamOperator({ db, saveDb() {}, isModerator: () => true });
  const on = createButtonInteraction(ANTITEAM_CUSTOM_IDS.toggleTestMode, { id: "admin-1", username: "Admin" });
  assert.equal(await operator.handleButtonInteraction(on), true);
  assert.equal(db.sot.antiteam.config.testMode, true);

  const off = createButtonInteraction(ANTITEAM_CUSTOM_IDS.toggleTestMode, { id: "admin-1", username: "Admin" });
  assert.equal(await operator.handleButtonInteraction(off), true);
  assert.equal(db.sot.antiteam.config.testMode, false);
});

test("test mode publishes a marked mission without pinging the battalion", async () => {
  const db = {};
  const state = ensureAntiteamState(db).state;
  state.config.channelId = "channel-1";
  state.config.battalionRoleId = "battalion-role";
  state.config.testMode = true;
  setAntiteamDraft(db, "user-1", {
    userTag: "User",
    roblox: { userId: "101", username: "Anchor" },
    description: "Два ника около 4k.",
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
    guildId: "guild-1",
    type: 0,
    isTextBased: () => true,
    messages: { fetch: async () => null },
    send: async (payload) => {
      sentToChannel.push(payload);
      return { id: "message-1", guildId: "guild-1", edit: async () => {}, startThread: async () => thread };
    },
  };
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:01:00.000Z",
    saveDb() {},
    fetchChannel: async (channelId) => (channelId === "channel-1" ? channel : thread),
  });
  const interaction = createButtonInteraction(ANTITEAM_CUSTOM_IDS.submitDraft, { id: "user-1", username: "User" });

  assert.equal(await operator.handleButtonInteraction(interaction), true);
  await new Promise((resolve) => setImmediate(resolve));

  const ticket = Object.values(db.sot.antiteam.tickets)[0];
  assert.equal(ticket.test, true);
  // The mission is published and marked as a test...
  assert.match(JSON.stringify(sentToChannel[0].components[0].toJSON()), /🧪 ТЕСТ/);
  // ...but nobody is pinged: only the thread panel was sent, no battalion mention.
  assert.equal(sentToThread.length, 1);
  assert.doesNotMatch(JSON.stringify(sentToThread), /<@&battalion-role>/);
});

test("ping config controls are available in moderator panel and save mode", async () => {
  const db = {};
  ensureAntiteamState(db);
  const operator = createAntiteamOperator({
    db,
    saveDb() {},
  });
  const member = { permissions: { has: () => true }, roles: { cache: new Map() } };
  const open = createButtonInteraction(ANTITEAM_CUSTOM_IDS.pingConfig, { id: "mod-1", username: "Mod" });
  open.member = member;

  assert.equal(await operator.handleButtonInteraction(open), true);
  assert.equal(open.calls[0][0], "showModal");
  assert.match(JSON.stringify(open.calls[0][1].toJSON()), /battalion \/ role \/ everyone \/ edit/);

  const modal = createModalInteraction(
    "at:ping:config_modal",
    {
      ping_mode: "buffer",
      extra_ping_role_id: "<@&55555>",
      battalion_ping_role_ids: "<@&66666>\n77777\n<@&66666>",
      edit_ping_role_ids: "<@&88888>\n99999\n<@&88888>",
    },
    { id: "mod-1", username: "Mod" },
    member
  );

  assert.equal(await operator.handleModalSubmitInteraction(modal), true);
  assert.equal(db.sot.antiteam.config.pingMode, "edit_roles");
  assert.equal(db.sot.antiteam.config.extraPingRoleId, "55555");
  assert.deepEqual(db.sot.antiteam.config.battalionPingRoleIds, ["66666", "77777"]);
  assert.deepEqual(db.sot.antiteam.config.editPingRoleIds, ["88888", "99999"]);
  assert.match(JSON.stringify(modal.calls.at(-1)[1].components[0].toJSON()), /Пинг-система сохранена/);
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

test("close review toggles persist immediately and drive the close result", async () => {
  const db = {};
  const draft = setAntiteamDraft(db, "author-1", {
    userTag: "Author",
    roblox: { userId: "101", username: "Anchor" },
    level: "medium",
    count: "3-5",
    description: "Цели A/B.",
  }, { now: "2026-05-16T10:00:00.000Z" });
  createAntiteamTicketFromDraft(db, draft, { id: "ticket-1", now: "2026-05-16T10:01:00.000Z" });
  db.sot.antiteam.tickets["ticket-1"].helpers = {
    "helper-1": { userId: "helper-1", discordTag: "H1", respondedAt: "2026-05-16T10:02:00.000Z" },
    "helper-2": { userId: "helper-2", discordTag: "H2", respondedAt: "2026-05-16T10:03:00.000Z" },
  };

  let persistCount = 0;
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-05-16T10:05:00.000Z",
    saveDb() {},
    isModerator: () => true,
    fetchChannel: async () => null,
    runSerializedMutation: async ({ mutate }) => { persistCount += 1; return mutate(); },
  });

  const openClose = createButtonInteraction(ticketButtonId("close", "ticket-1"), { id: "author-1", username: "Author" });
  assert.equal(await operator.handleButtonInteraction(openClose), true);

  const toggle = createButtonInteraction(ticketButtonId("arrived", "ticket-1", "helper-2:0"), { id: "author-1", username: "Author" });
  assert.equal(await operator.handleButtonInteraction(toggle), true);

  // Opening the review is read-only; the toggle persists straight to the ticket.
  assert.equal(persistCount, 1);
  assert.equal(db.sot.antiteam.tickets["ticket-1"].helpers["helper-2"].arrived, false);
  assert.notEqual(db.sot.antiteam.tickets["ticket-1"].helpers["helper-1"].arrived, false);

  const modal = createModalInteraction(
    ticketButtonId("close_modal", "ticket-1"),
    { summary: "ок" },
    { id: "author-1", username: "Author" },
    { permissions: { has: () => true }, roles: { cache: new Map() } }
  );
  assert.equal(await operator.handleModalSubmitInteraction(modal), true);

  const closed = db.sot.antiteam.tickets["ticket-1"];
  assert.equal(closed.status, "closed");
  // Only helper-1 (left green) is counted; helper-2 was toggled off.
  assert.equal(db.sot.antiteam.stats.helpers["helper-1"].confirmedArrived, 1);
  assert.equal(db.sot.antiteam.stats.helpers["helper-2"], undefined);
});

test("direct-link modal saves the author's connect link onto the draft", async () => {
  const db = {};
  setAntiteamDraft(db, "user-1", {
    userTag: "User",
    roblox: { userId: "101", username: "Anchor" },
    description: "Цели A/B.",
    directJoinEnabled: true,
  }, { now: "2026-05-16T10:00:00.000Z" });
  const operator = createAntiteamOperator({ db, now: () => "2026-05-16T10:01:00.000Z", saveDb() {} });

  const link = "https://www.roblox.com/games/start?placeId=1&gameInstanceId=2";
  const modal = createModalInteraction("at:direct_link:modal", { direct_link: link }, { id: "user-1", username: "User" });
  assert.equal(await operator.handleModalSubmitInteraction(modal), true);
  assert.equal(db.sot.antiteam.drafts["user-1"].manualDirectJoinUrl, link);

  // A non-URL is rejected and not stored.
  const badModal = createModalInteraction("at:direct_link:modal", { direct_link: "не ссылка" }, { id: "user-1", username: "User" });
  assert.equal(await operator.handleModalSubmitInteraction(badModal), true);
  assert.equal(db.sot.antiteam.drafts["user-1"].manualDirectJoinUrl, link);
});

test("direct-join help hands out the author's manual connect link", async () => {
  const db = {};
  const draft = setAntiteamDraft(db, "author-1", {
    userTag: "Author",
    roblox: { userId: "101", username: "Anchor" },
    level: "medium",
    count: "3-5",
    description: "Цели A/B.",
    directJoinEnabled: true,
    manualDirectJoinUrl: "https://roblox.test/join/abc",
  }, { now: "2026-05-16T10:00:00.000Z" });
  createAntiteamTicketFromDraft(db, draft, { id: "ticket-1", now: "2026-05-16T10:01:00.000Z" });
  const operator = createAntiteamOperator({ db, now: () => "2026-05-16T10:02:00.000Z", saveDb() {}, fetchChannel: async () => null });

  const help = createButtonInteraction("at:help:ticket-1", { id: "helper-1", username: "Helper" });
  assert.equal(await operator.handleButtonInteraction(help), true);
  assert.match(JSON.stringify(help.calls.at(-1)[1]), /roblox\.test\/join\/abc/);
});

test("twink binds an alt Roblox to the draft only, never the profile", async () => {
  const db = {};
  ensureAntiteamState(db).state.config.channelId = "channel-1";
  setAntiteamDraft(db, "user-1", {
    userTag: "User",
    roblox: { userId: "100", username: "MainAcc" },
    description: "Тимятся у центра.",
    level: "medium",
    count: "3-5",
  }, { now: "2026-06-21T10:00:00.000Z" });

  let profileWrites = 0;
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-06-21T10:01:00.000Z",
    saveDb() {},
    writeRobloxBinding() { profileWrites += 1; },
    resolveRobloxUserByUsername: async () => ({
      userId: "999",
      username: "TwinkAcc",
      displayName: "Twink",
      profileUrl: "https://www.roblox.com/users/999/profile",
    }),
  });

  const modal = {
    calls: [],
    customId: "at:twink_modal",
    user: { id: "user-1", username: "User" },
    message: { id: "panel-1" },
    isModalSubmit: () => true,
    fields: { getTextInputValue: () => "TwinkAcc" },
    async deferUpdate() { this.deferred = true; this.calls.push(["deferUpdate"]); },
    async editReply(payload) { this.calls.push(["editReply", payload]); },
    async reply(payload) { this.replied = true; this.calls.push(["reply", payload]); },
  };
  assert.equal(await operator.handleModalSubmitInteraction(modal), true);
  assert.equal(db.sot.antiteam.drafts["user-1"].pendingTwink.userId, "999");
  assert.equal(db.sot.antiteam.drafts["user-1"].roblox.userId, "100", "main roblox unchanged before confirm");
  assert.match(JSON.stringify(modal.calls.at(-1)[1]), /Проверь твинк/);

  const confirm = createButtonInteraction(ANTITEAM_CUSTOM_IDS.twinkConfirm, { id: "user-1", username: "User" });
  confirm.message = { id: "panel-1" };
  assert.equal(await operator.handleButtonInteraction(confirm), true);

  const draft = db.sot.antiteam.drafts["user-1"];
  assert.equal(draft.roblox.userId, "999", "draft now uses the twink");
  assert.equal(draft.robloxTemporary, true);
  assert.equal(draft.pendingTwink, null);
  assert.equal(profileWrites, 0, "profile binding never written for a twink");
});

test("twink modal reports a clear error when the nick is not found", async () => {
  const db = {};
  ensureAntiteamState(db).state.config.channelId = "channel-1";
  setAntiteamDraft(db, "user-1", {
    userTag: "User",
    roblox: { userId: "100", username: "MainAcc" },
    description: "desc",
  }, { now: "2026-06-21T10:00:00.000Z" });
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-06-21T10:01:00.000Z",
    saveDb() {},
    resolveRobloxUserByUsername: async () => null,
  });
  const modal = {
    calls: [],
    customId: "at:twink_modal",
    user: { id: "user-1", username: "User" },
    message: { id: "panel-1" },
    isModalSubmit: () => true,
    fields: { getTextInputValue: () => "ghost" },
    async deferUpdate() { this.deferred = true; this.calls.push(["deferUpdate"]); },
    async editReply(payload) { this.calls.push(["editReply", payload]); },
    async reply(payload) { this.replied = true; this.calls.push(["reply", payload]); },
  };
  assert.equal(await operator.handleModalSubmitInteraction(modal), true);
  assert.equal(db.sot.antiteam.drafts["user-1"].pendingTwink, null);
  assert.match(JSON.stringify(modal.calls.at(-1)[1]), /не найден через Roblox API/);
});

test("photo mode deletes a non-image message and keeps the request open", async () => {
  const db = {};
  ensureAntiteamState(db).state.config.channelId = "channel-1";
  setAntiteamDraft(db, "user-1", {
    userTag: "User",
    roblox: { userId: "100", username: "Main" },
    description: "desc",
    photoWanted: true,
  }, { now: "2026-06-21T10:00:00.000Z" });
  const state = ensureAntiteamState(db).state;
  state.photoRequests["user-1"] = { userId: "user-1", channelId: "channel-1", createdAt: "2026-06-21T10:00:10.000Z" };

  const operator = createAntiteamOperator({ db, now: () => "2026-06-21T10:01:00.000Z", saveDb() {} });

  let deleted = false;
  let hintSent = null;
  const textMessage = {
    author: { id: "user-1", bot: false },
    channelId: "channel-1",
    content: "вот сейчас скину",
    attachments: new Map(),
    delete: async () => { deleted = true; },
    channel: { send: async (payload) => { hintSent = payload; return { id: "hint-1", delete: async () => {} }; } },
  };
  assert.equal(await operator.handlePhotoMessage(textMessage), true);
  assert.equal(deleted, true);
  assert.match(hintSent.content, /изображение/);
  // The request stays open so the user can still send the real screenshot.
  assert.ok(db.sot.antiteam.photoRequests["user-1"]);
});

test("photo mode leaves an empty message untouched (possible missing intent)", async () => {
  const db = {};
  ensureAntiteamState(db).state.config.channelId = "channel-1";
  setAntiteamDraft(db, "user-1", {
    userTag: "User",
    roblox: { userId: "100", username: "Main" },
    description: "desc",
    photoWanted: true,
  }, { now: "2026-06-21T10:00:00.000Z" });
  const state = ensureAntiteamState(db).state;
  state.photoRequests["user-1"] = { userId: "user-1", channelId: "channel-1", createdAt: "2026-06-21T10:00:10.000Z" };

  const logs = [];
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-06-21T10:01:00.000Z",
    saveDb() {},
    logError: (...parts) => logs.push(parts.join(" ")),
  });

  let deleted = false;
  const emptyMessage = {
    author: { id: "user-1", bot: false },
    channelId: "channel-1",
    content: "",
    attachments: new Map(),
    delete: async () => { deleted = true; },
    channel: { send: async () => ({ id: "x", delete: async () => {} }) },
  };
  assert.equal(await operator.handlePhotoMessage(emptyMessage), false);
  assert.equal(deleted, false);
  assert.ok(logs.some((line) => /MESSAGE CONTENT/.test(line)));
});

test("closed lock always shows the notify-author button, even with a direct link", async () => {
  const db = {};
  const state = ensureAntiteamState(db).state;
  state.config.channelId = "channel-1";
  state.config.roblox.jjsPlaceId = "place-1";
  const draft = setAntiteamDraft(db, "author-1", {
    userTag: "Author",
    roblox: { userId: "101", username: "Anchor", profileUrl: "https://www.roblox.com/users/101/profile" },
    level: "medium",
    count: "3-5",
    directJoinEnabled: false,
    manualDirectJoinUrl: "https://www.roblox.com/share?code=abc&type=Server",
  }, { now: "2026-06-21T10:00:00.000Z" });
  createAntiteamTicketFromDraft(db, draft, { id: "ticket-lock", now: "2026-06-21T10:01:00.000Z" });
  db.sot.antiteam.tickets["ticket-lock"].message.threadId = "thread-1";

  const operator = createAntiteamOperator({
    db,
    now: () => "2026-06-21T10:02:00.000Z",
    saveDb() {},
    getProfile: () => ({ domains: { roblox: { userId: "202", username: "HelperRoblox", verificationStatus: "verified" } } }),
  });
  const interaction = createButtonInteraction("at:help:ticket-lock");
  assert.equal(await operator.handleButtonInteraction(interaction), true);

  assert.equal(db.sot.antiteam.tickets["ticket-lock"].helpers["helper-1"].linkKind, "friend_request");
  const json = JSON.stringify(interaction.calls.at(-1)[1].components[0].toJSON());
  assert.match(json, /Отправил др, пусть примет/, "notify-author button present");
  assert.match(json, /share\?code=abc/, "author direct link still offered");
  assert.match(json, /🔗 Подключиться/);
});

test("open lock offers a straight join without the friend-request button", async () => {
  const db = {};
  const state = ensureAntiteamState(db).state;
  state.config.channelId = "channel-1";
  state.config.roblox.jjsPlaceId = "place-1";
  const draft = setAntiteamDraft(db, "author-2", {
    userTag: "Author2",
    roblox: { userId: "303", username: "OpenAcc", profileUrl: "https://www.roblox.com/users/303/profile" },
    level: "low",
    count: "2",
    directJoinEnabled: true,
  }, { now: "2026-06-21T10:00:00.000Z" });
  createAntiteamTicketFromDraft(db, draft, { id: "ticket-open", now: "2026-06-21T10:01:00.000Z" });
  db.sot.antiteam.tickets["ticket-open"].message.threadId = "thread-2";

  const operator = createAntiteamOperator({
    db,
    now: () => "2026-06-21T10:02:00.000Z",
    saveDb() {},
    getProfile: () => ({ domains: { roblox: { userId: "202", username: "HelperRoblox", verificationStatus: "verified" } } }),
  });
  const interaction = createButtonInteraction("at:help:ticket-open");
  assert.equal(await operator.handleButtonInteraction(interaction), true);

  assert.equal(db.sot.antiteam.tickets["ticket-open"].helpers["helper-1"].linkKind, "direct");
  const json = JSON.stringify(interaction.calls.at(-1)[1].components[0].toJSON());
  assert.doesNotMatch(json, /Отправил др, пусть примет/, "no friend-request button when lock is open");
  assert.match(json, /Прямой вход включён/);
});

test("ticket creation persists durably to survive a deploy/crash window", async () => {
  const db = {};
  ensureAntiteamState(db).state.config.channelId = "channel-1";
  setAntiteamDraft(db, "user-1", {
    userTag: "User",
    roblox: { userId: "101", username: "Anchor" },
    description: "Тимятся у центра, нужны бойцы.",
    level: "medium",
    count: "3-5",
  }, { now: "2026-06-21T10:00:00.000Z" });

  let durableSaves = 0;
  let scheduledSaves = 0;
  const thread = { id: "thread-1", isTextBased: () => true, messages: { fetch: async () => null }, send: async () => ({ id: "tp-1" }) };
  const channel = {
    id: "channel-1",
    isTextBased: () => true,
    messages: { fetch: async () => null },
    send: async () => ({ id: "message-1", startThread: async () => thread }),
  };
  const operator = createAntiteamOperator({
    db,
    now: () => "2026-06-21T10:01:00.000Z",
    saveDb() { scheduledSaves += 1; },
    saveDbDurable() { durableSaves += 1; },
    fetchChannel: async () => channel,
  });

  const submit = createButtonInteraction(ANTITEAM_CUSTOM_IDS.submitDraft, { id: "user-1", username: "User" });
  assert.equal(await operator.handleButtonInteraction(submit), true);
  // Let the detached finalize tail run.
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(Object.keys(db.sot.antiteam.tickets).length, 1, "ticket created");
  assert.ok(durableSaves >= 1, "ticket lifecycle used a durable flush");
});
