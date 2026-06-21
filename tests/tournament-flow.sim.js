"use strict";

// Standalone end-to-end simulation (not a unit test) that drives the operator
// with mocked Discord objects through the full lifecycle. Run: node tests/tournament-flow.sim.js
const assert = require("node:assert/strict");
const { createTournamentOperator } = require("../src/tournament/operator");
const { buildCustomId, ACTIONS, TOURNAMENT_COMMAND_NAME } = require("../src/tournament/commands");
const state = require("../src/tournament/state");
const seeding = require("../src/tournament/seeding");

const db = {};
let lastChannelMessageId = 1000;

function makeMessage(id) {
  return { id: String(id), edit: async () => {}, delete: async () => {} };
}
const channel = {
  id: "chan1",
  send: async () => makeMessage(++lastChannelMessageId),
  messages: { fetch: async () => makeMessage(1) },
  delete: async () => {},
  threads: {
    create: async () => ({
      id: "thread1",
      send: async () => makeMessage(++lastChannelMessageId),
      setLocked: async () => {},
      delete: async () => {},
    }),
  },
};

const snapshots = new Map();
function setSnapshot(userId, snap) { snapshots.set(userId, snap); }

const op = createTournamentOperator({
  db,
  saveDb: () => {},
  runSerializedMutation: async ({ mutate }) => mutate(),
  isModerator: (member) => Boolean(member?.mod),
  logError: (...a) => console.error("[err]", ...a),
  resolveRobloxUser: async (nick) => ({ userId: "rb_" + nick, username: nick, avatarUrl: "http://avatar/" + nick }),
  getPlayerSnapshot: (userId) => snapshots.get(userId) || {},
  fetchChannel: async () => channel,
  fetchAvatarHeadshots: async (ids) => ids.map((id) => ({ targetId: id, imageUrl: "http://avatar/" + id })),
});

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

  const draft = state.getDraft(db, MOD);
  assert.ok(draft.startsAtIso, "time saved");
  assert.equal(draft.announceChannelId, "chan1", "channel saved");

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

  // 5) close reg, form duels
  await op.handleButtonInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.MANAGE_CLOSE_REG, t.id), userId: MOD, mod: true }));
  await op.handleButtonInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.MANAGE_FORM_DUELS, t.id), userId: MOD, mod: true }));
  assert.equal(state.getTournament(db, t.id).status, "seeded");
  console.log("✓ formed duels");

  // 6) launch server 0
  await op.handleButtonInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.MANAGE_LAUNCH_SERVER, t.id, "0"), userId: MOD, mod: true }));
  let server = state.getServer(state.getTournament(db, t.id), 0);
  assert.ok(server.launched && server.currentStage, "server launched with stage 1");
  assert.equal(server.threadId, "thread1", "private thread created");
  console.log("✓ launched server (stage 1, 2 runs)");

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
