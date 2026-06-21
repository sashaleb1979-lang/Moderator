"use strict";

// Standalone end-to-end simulation (not a unit test) that drives the operator
// with mocked Discord objects through the full lifecycle. Run: node tests/tournament-flow.sim.js
const assert = require("node:assert/strict");
const { createTournamentOperator } = require("../src/tournament/operator");
const { buildCustomId, ACTIONS, TOURNAMENT_COMMAND_NAME } = require("../src/tournament/commands");
const state = require("../src/tournament/state");
const seeding = require("../src/tournament/seeding");
const view = require("../src/tournament/view");

const db = {};
let lastChannelMessageId = 1000;

function makeMessage(id) {
  return { id: String(id), edit: async () => {}, delete: async () => {} };
}
let threadCreateThrows = false;
const channel = {
  id: "chan1",
  send: async () => makeMessage(++lastChannelMessageId),
  messages: { fetch: async () => makeMessage(1) },
  delete: async () => {},
  threads: {
    create: async () => {
      if (threadCreateThrows) throw new Error("missing perms");
      return {
        id: "thread1",
        send: async () => makeMessage(++lastChannelMessageId),
        setLocked: async () => {},
        delete: async () => {},
        members: { add: async () => {} },
      };
    },
  },
};

const snapshots = new Map();
function setSnapshot(userId, snap) { snapshots.set(userId, snap); }

const roleCalls = []; // { op: 'grant'|'remove', userId, roleId }

const op = createTournamentOperator({
  db,
  saveDb: () => {},
  runSerializedMutation: async ({ mutate }) => mutate(),
  isModerator: (member) => Boolean(member?.mod),
  logError: (...a) => console.error("[err]", ...a),
  resolveRobloxUser: async (nick) => ({ userId: "rb_" + nick, username: nick, avatarUrl: "http://avatar/" + nick }),
  getPlayerSnapshot: (userId) => snapshots.get(userId) || {},
  fetchChannel: async (id) => (id === "thread1" ? { id: "thread1", send: async () => makeMessage(++lastChannelMessageId), setLocked: async () => {}, members: { add: async () => {} } } : channel),
  fetchAvatarHeadshots: async (ids) => ids.map((id) => ({ targetId: id, imageUrl: "http://avatar/" + id })),
  grantRole: async (userId, roleId) => { roleCalls.push({ op: "grant", userId, roleId }); return { granted: true, roleId }; },
  removeRole: async (userId, roleId) => { roleCalls.push({ op: "remove", userId, roleId }); return { removed: true, roleId }; },
  fetchMember: async (userId) => ({ user: { id: userId, tag: userId + "#0001" }, roles: { cache: new Map() } }),
});

// let fire-and-forget side-effects (launch thread/ping, announcement throttle) settle
const settle = () => new Promise((r) => setTimeout(r, 30));

function makeInteraction({ customId, userId = "u1", tag, mod = false, fields = {}, values = [], commandName, sub }) {
  const recorded = { replies: [], updates: [], modals: [] };
  return {
    customId,
    commandName,
    channelId: "chan1",
    channel: { id: "chan1" },
    user: { id: userId, tag: tag || userId + "#0001" },
    member: { mod },
    deferred: false,
    replied: false,
    values,
    options: { getSubcommand: () => sub },
    fields: { getTextInputValue: (k) => (fields[k] != null ? fields[k] : "") },
    async reply(p) { this.replied = true; recorded.replies.push(p); },
    async followUp(p) { recorded.replies.push(p); },
    async update(p) { this.replied = true; recorded.updates.push(p); },
    async editReply(p) { recorded.updates.push(p); return p; },
    async deferUpdate() { this.deferred = true; },
    async deferReply() { this.deferred = true; },
    async showModal(m) { recorded.modals.push(m); },
    recorded,
  };
}

async function main() {
  const MOD = "mod1";

  // 1) open hub
  await op.handleSlashCommand(makeInteraction({ commandName: TOURNAMENT_COMMAND_NAME, userId: MOD, mod: true, sub: "панель" }));

  // 2) create draft + fill via modals
  await op.handleButtonInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.SETUP_OPEN, "new"), userId: MOD, mod: true }));
  await op.handleModalSubmitInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.SETUP_BASICS), userId: MOD, mod: true, fields: { name: "Кубок", slots: "16", planned: "16" } }));
  await op.handleModalSubmitInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.SETUP_TIME), userId: MOD, mod: true, fields: { time: "25.06.2026 20:00" } }));
  await op.handleSelectMenuInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.SETUP_CHANNEL), userId: MOD, mod: true, values: ["chan1"] }));
  await op.handleSelectMenuInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.SETUP_MODE), userId: MOD, mod: true, values: ["similar"] }));
  await op.handleSelectMenuInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.SETUP_ROLE), userId: MOD, mod: true, values: ["role-participant"] }));

  const draft = state.getDraft(db, MOD);
  assert.ok(draft.startsAtIso, "time saved");
  assert.equal(draft.announceChannelId, "chan1", "channel saved");
  assert.equal(draft.participantRoleId, "role-participant", "participant role saved");

  // 3) publish
  await op.handleButtonInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.SETUP_PUBLISH), userId: MOD, mod: true }));
  const tournaments = state.listTournaments(db);
  assert.equal(tournaments.length, 1, "tournament created");
  const t = tournaments[0];
  assert.ok(t.announce.messageId, "announcement linked");
  console.log("✓ setup + publish");

  // 4) twink registration path first (low main kills, declares true strength)
  setSnapshot("twk", { hasRobloxAccount: false, approvedKills: 200 });
  await op.handleButtonInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.REGISTER_OPEN, t.id), userId: "twk" }));
  // declare twink -> modal -> submit nick
  await op.handleModalSubmitInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.REG_LINK_ROBLOX, t.id, "twink"), userId: "twk", fields: { nick: "SmurfKid" } }));
  // pick strength bucket 5000
  await op.handleSelectMenuInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.REG_PICK_KILLS, t.id, "twink"), userId: "twk", values: ["5000"] }));
  // confirm
  await op.handleButtonInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.REG_CONFIRM, t.id), userId: "twk" }));
  const twkReg = state.getRegistration(state.getTournament(db, t.id), "twk");
  assert.equal(twkReg.accountKind, "twink");
  assert.equal(twkReg.effectiveKills, 5000, "twink seeded by declared strength");
  console.log("✓ twink registration (declared strength)");

  // withdraw the twink to keep a clean 16-field for the bracket walk
  await op.handleButtonInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.REG_WITHDRAW, t.id), userId: "twk" }));
  assert.equal(state.registrationCount(state.getTournament(db, t.id)), 0);

  // 4b) register 16 players with varied kills (main accounts on file)
  for (let i = 1; i <= 16; i += 1) {
    const uid = "p" + i;
    setSnapshot(uid, { hasRobloxAccount: true, robloxUsername: "Nick" + i, robloxUserId: "rb" + i, robloxAvatarUrl: "http://a/" + i, approvedKills: i * 1000 });
    // open registration -> main confirm
    await op.handleButtonInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.REGISTER_OPEN, t.id), userId: uid }));
    // click "да, на этом"
    await op.handleButtonInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.REG_USE_MAIN, t.id), userId: uid }));
  }
  assert.equal(state.registrationCount(state.getTournament(db, t.id)), 16, "16 registered");
  console.log("✓ 16 registrations (main accounts)");

  // participant role granted on registration
  assert.ok(roleCalls.some((c) => c.op === "grant" && c.roleId === "role-participant"), "participant role granted on registration");
  console.log("✓ participant role auto-granted");

  // 5) close reg (snappy), form duels
  await op.handleButtonInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.MANAGE_CLOSE_REG, t.id), userId: MOD, mod: true }));
  await op.handleButtonInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.MANAGE_FORM_DUELS, t.id), userId: MOD, mod: true }));
  assert.equal(state.getTournament(db, t.id).status, "seeded");
  console.log("✓ formed duels");

  // 5b) roster viewer renders with Roblox links
  await op.handleButtonInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.MANAGE_ROSTER, t.id), userId: MOD, mod: true }));
  console.log("✓ roster viewer opened");

  // 6) launch server 0 — bracket must persist immediately (decoupled from thread)
  await op.handleButtonInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.MANAGE_LAUNCH_SERVER, t.id, "0"), userId: MOD, mod: true }));
  let server = state.getServer(state.getTournament(db, t.id), 0);
  assert.ok(server.launched && server.currentStage, "bracket persisted synchronously on launch");
  // match panel is reachable immediately (has interactive components)
  const panelNow = view.buildMatchPanelPayload(state.getTournament(db, t.id), server);
  assert.ok(panelNow.components && panelNow.components.length, "match panel reachable right after launch");
  await settle(); // let fire-and-forget side-effects finish
  server = state.getServer(state.getTournament(db, t.id), 0);
  assert.equal(server.threadId, "thread1", "private thread created by side-effects");
  assert.equal(server.threadFailed, false, "thread did not fail");
  console.log("✓ launched server (decoupled: bracket first, thread async)");

  // 7) walk the whole bracket: red wins every match, advancing runs then stages
  for (let guard = 0; guard < 30; guard += 1) {
    const fresh = state.getTournament(db, t.id);
    server = state.getServer(fresh, 0);
    if (server.done) break;
    const stagePlan = server.currentStage;
    const runs = stagePlan.runs;
    const run = runs[server.runIndex || 0];
    // decide every match in the current run (red wins)
    for (const match of run.matches) {
      await op.handleButtonInteraction(
        makeInteraction({
          customId: buildCustomId(ACTIONS.MATCH_WIN, t.id, "0", match.key, String(match.red.userId || match.red.id)),
          userId: MOD,
          mod: true,
        })
      );
    }
    // advance (run or stage)
    await op.handleButtonInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.STAGE_ADVANCE, t.id, "0"), userId: MOD, mod: true }));
  }

  server = state.getServer(state.getTournament(db, t.id), 0);
  assert.ok(server.done, "server finished");
  const finalT = state.getTournament(db, t.id);
  assert.equal(finalT.status, "completed", "tournament completed");
  assert.ok(server.placement.first, "1st place set");
  assert.ok(server.placement.second, "2nd place set");
  assert.ok(server.placement.third, "3rd place set");
  // red always wins => top seed (Nick16, 16000 kills) is champion
  assert.equal(server.placement.first.robloxUsername, "Nick16", "top seed champion");
  console.log("✓ full bracket walk → champion:", server.placement.first.robloxUsername,
    "| 2nd:", server.placement.second.robloxUsername, "| 3rd:", server.placement.third.robloxUsername);

  // history should hold every completed stage (stage1, stage2, semifinal, placement)
  assert.equal((server.history || []).length, 4, "server.history captured all stages");
  console.log("✓ stage history snapshots:", server.history.map((h) => h.kind === "placement" ? "placement" : (h.isSemifinal ? "semifinal" : "stage" + h.stage)).join(" → "));

  // render the result bracket + summary from the real post-tournament state
  const bi = require("../src/tournament/bracket-image");
  const fs = require("node:fs");
  const os = require("node:os");
  const pathMod = require("node:path");
  if (bi.hasRenderer()) {
    const outDir = os.tmpdir();
    const resultBuf = await bi.renderBracketCard(bi.buildBracketModel({ tournament: finalT, server, history: server.history, livePlan: null, avatars: {} }));
    const resultPath = pathMod.join(outDir, "tournament_sim_result.png");
    fs.writeFileSync(resultPath, resultBuf);
    const summaryBuf = await bi.renderSummaryCard(bi.buildSummaryModel({ tournament: finalT, avatars: {} }));
    const summaryPath = pathMod.join(outDir, "tournament_sim_summary.png");
    fs.writeFileSync(summaryPath, summaryBuf);
    console.log(`✓ rendered result + summary from real operator state → ${outDir}`);
  }

  // ---- launch survives thread-creation failure --------------------------------
  {
    const tf = state.createTournamentFromDraft(db, { name: "NoThread", slots: 16, seedingMode: "similar", createdBy: MOD, announceChannelId: "chan1", participantRoleId: "role-x" }, { id: state.makeId() });
    state.updateTournament(db, tf.id, { announce: { channelId: "chan1", messageId: "m1" } });
    for (let i = 1; i <= 8; i += 1) {
      setSnapshot("n" + i, { hasRobloxAccount: true, robloxUsername: "N" + i, robloxUserId: "r" + i, approvedKills: i * 500 });
      await op.handleButtonInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.REGISTER_OPEN, tf.id), userId: "n" + i }));
      await op.handleButtonInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.REG_USE_MAIN, tf.id), userId: "n" + i }));
    }
    threadCreateThrows = true;
    await op.handleButtonInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.MANAGE_LAUNCH_SERVER, tf.id, "0"), userId: MOD, mod: true }));
    let s = state.getServer(state.getTournament(db, tf.id), 0);
    assert.ok(s.launched && s.currentStage, "bracket persists even when thread fails");
    await settle();
    s = state.getServer(state.getTournament(db, tf.id), 0);
    assert.equal(s.threadFailed, true, "threadFailed flagged");
    const panel = view.buildMatchPanelPayload(state.getTournament(db, tf.id), s);
    assert.ok(panel.components && panel.components.length, "match panel still reachable when thread failed");
    threadCreateThrows = false;
    console.log("✓ launch survives thread failure (bracket still runnable)");
  }

  // ---- manual add / remove + kills never zero --------------------------------
  {
    const tm = state.createTournamentFromDraft(db, { name: "Manual", slots: 16, seedingMode: "similar", createdBy: MOD, announceChannelId: "chan1", participantRoleId: "role-m" }, { id: state.makeId() });
    state.updateTournament(db, tm.id, { announce: { channelId: "chan1", messageId: "m2" } });
    // manual add via user-select (snapshot has roblox + kills)
    setSnapshot("123456789", { hasRobloxAccount: true, robloxUsername: "AddedGuy", robloxUserId: "rb999", approvedKills: 7777, killsSource: "profile" });
    await op.handleSelectMenuInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.ADD_PLAYER_SELECT, tm.id), userId: MOD, mod: true, values: ["123456789"] }));
    const added = state.getRegistration(state.getTournament(db, tm.id), "123456789");
    assert.ok(added && added.effectiveKills === 7777 && added.addedManually, "manual add resolved kills + flagged");
    assert.ok(roleCalls.some((c) => c.op === "grant" && c.roleId === "role-m" && c.userId === "123456789"), "role granted on manual add");
    // manual add via modal (nick + kills, no discord)
    await op.handleModalSubmitInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.ADD_PLAYER_MODAL, tm.id), userId: MOD, mod: true, fields: { nick: "ByNick", kills: "3300", discord: "" } }));
    assert.equal(state.registrationCount(state.getTournament(db, tm.id)), 2, "modal add registered");
    // remove player
    await op.handleSelectMenuInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.REMOVE_PLAYER_SELECT, tm.id), userId: MOD, mod: true, values: ["123456789"] }));
    assert.equal(state.registrationCount(state.getTournament(db, tm.id)), 1, "remove player worked");
    assert.ok(roleCalls.some((c) => c.op === "remove" && c.userId === "123456789"), "role removed on player removal");
    // no registrant has zero kills
    for (const r of state.listRegistrations(state.getTournament(db, tm.id))) assert.ok(r.effectiveKills > 0, "no zero-kill registrant");
    // sync roles
    await op.handleButtonInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.MANAGE_SYNC_ROLES, tm.id), userId: MOD, mod: true }));
    console.log("✓ manual add/remove + role grant/remove + sync + no zero kills");
  }

  // ---- test harness scenario -------------------------------------------------
  // open test panel
  await op.handleSlashCommand(makeInteraction({ commandName: TOURNAMENT_COMMAND_NAME, userId: MOD, mod: true, sub: "тест" }));
  // create a 16-bot test tournament
  await op.handleButtonInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.TEST_CREATE, "", "16"), userId: MOD, mod: true }));
  const testT = state.listTestTournaments(db)[0];
  assert.ok(testT && testT.isTest, "test tournament created and flagged");
  // fill with bots
  await op.handleButtonInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.TEST_FILL, testT.id, "full"), userId: MOD, mod: true }));
  assert.equal(state.registrationCount(state.getTournament(db, testT.id)), 16, "test filled with 16 bots");
  const botReg = Object.values(state.getTournament(db, testT.id).registrations)[0];
  assert.ok(botReg.robloxAvatarUrl, "bots got avatar urls");
  // reset (rollback)
  await op.handleButtonInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.TEST_RESET, testT.id), userId: MOD, mod: true }));
  assert.equal(state.registrationCount(state.getTournament(db, testT.id)), 0, "reset cleared bots");
  // delete
  await op.handleButtonInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.TEST_DELETE, testT.id), userId: MOD, mod: true }));
  assert.equal(state.getTournament(db, testT.id), null, "test tournament deleted");
  console.log("✓ test harness: create → fill bots → reset → delete");

  console.log("\nALL SIM CHECKS PASSED");
}

main().catch((e) => { console.error(e); process.exit(1); });
