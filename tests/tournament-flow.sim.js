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

  // render helpers (also used for the mid-stage live snapshot below)
  const bi = require("../src/tournament/bracket-image");
  const fs = require("node:fs");
  const os = require("node:os");
  const pathMod = require("node:path");
  let midStageRendered = false;

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
          customId: buildCustomId(ACTIONS.MATCH_WIN, t.id, "0", match.key, "r"),
          userId: MOD,
          mod: true,
        })
      );
    }
    // advance (run or stage)
    await op.handleButtonInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.STAGE_ADVANCE, t.id, "0"), userId: MOD, mod: true }));

    // after the FIRST run advance, snapshot the LIVE image: run-1 winners are
    // decided and run-2 pairings still pending → proves the picture shows who
    // fights next, in each run.
    if (!midStageRendered && bi.hasRenderer()) {
      midStageRendered = true;
      const srv = state.getServer(state.getTournament(db, t.id), 0);
      const mbuf = await bi.renderBracketCard(bi.buildBracketModel({ tournament: state.getTournament(db, t.id), server: srv, history: srv.history, livePlan: srv.done ? null : srv.currentStage, liveDecisions: srv.decisions || {}, liveRunIndex: srv.runIndex || 0, avatars: {} }));
      fs.writeFileSync(pathMod.join(os.tmpdir(), "tournament_sim_midstage.png"), mbuf);
      console.log(`  ↳ mid-stage live bracket → ${pathMod.join(os.tmpdir(), "tournament_sim_midstage.png")}`);
    }
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

  // ---- multi-server (2 servers → cross-server final) -------------------------
  {
    const tms = state.createTournamentFromDraft(db, { name: "MultiCup", slots: 32, seedingMode: "similar", createdBy: MOD, announceChannelId: "chan1", participantRoleId: "role-ms" }, { id: state.makeId() });
    state.updateTournament(db, tms.id, { announce: { channelId: "chan1", messageId: "m3" } });
    for (let i = 1; i <= 32; i += 1) {
      state.upsertRegistration(state.getTournament(db, tms.id), { userId: "ms" + i, discordName: "MS" + i, robloxUsername: "MS" + i, robloxUserId: String(i), accountKind: "main", approvedKills: (33 - i) * 500 });
    }
    // form duels → snake split across 2 servers
    await op.handleButtonInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.MANAGE_FORM_DUELS, tms.id), userId: MOD, mod: true }));
    const idxs = new Set(state.listRegistrations(state.getTournament(db, tms.id)).map((r) => r.serverIndex));
    assert.deepEqual([...idxs].sort(), [0, 1], "players split across 2 servers");

    // drive a server's bracket (red wins) until it is done
    async function driveServer(tid, sIdx) {
      for (let guard = 0; guard < 40; guard += 1) {
        const srv = state.getServer(state.getTournament(db, tid), sIdx);
        if (!srv || srv.done) break;
        const run = srv.currentStage.runs[srv.runIndex || 0];
        for (const m of run.matches) {
          await op.handleButtonInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.MATCH_WIN, tid, String(sIdx), m.key, "r"), userId: MOD, mod: true }));
        }
        await op.handleButtonInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.STAGE_ADVANCE, tid, String(sIdx)), userId: MOD, mod: true }));
      }
    }

    // launch + run both base servers to qualification (top-4 each)
    for (const sIdx of [0, 1]) {
      await op.handleButtonInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.MANAGE_LAUNCH_SERVER, tms.id, String(sIdx)), userId: MOD, mod: true }));
      await driveServer(tms.id, sIdx);
      const srv = state.getServer(state.getTournament(db, tms.id), sIdx);
      assert.ok(srv.qualifying && srv.qualified.length === 4, `server ${sIdx} qualified top-4`);
    }
    console.log("✓ both base servers qualified top-4 each");

    // preview: base-server qualifier bracket → named top-4 → final panel
    try {
      const qsrv = state.getServer(state.getTournament(db, tms.id), 0);
      const qbuf = await bi.renderBracketCard(bi.buildBracketModel({ tournament: state.getTournament(db, tms.id), server: qsrv, history: qsrv.history, livePlan: null, avatars: {} }));
      const qpath = pathMod.join(os.tmpdir(), "tournament_sim_base_qualifier.png");
      fs.writeFileSync(qpath, qbuf);
      console.log(`  ↳ base qualifier bracket → ${qpath}`);
    } catch (e) { console.log("  ↳ base qualifier render skipped:", e.message); }

    // launch the cross-server final (8 finalists) and run to completion
    await op.handleButtonInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.MANAGE_LAUNCH_FINAL, tms.id), userId: MOD, mod: true }));
    const finalSrv0 = state.getServer(state.getTournament(db, tms.id), 90);
    assert.ok(finalSrv0 && finalSrv0.launched && finalSrv0.role === "final", "final server launched");

    // preview: final-server bracket at entry — 8 finalists funnelling to the
    // high/low league split (before any result).
    try {
      const fbuf = await bi.renderBracketCard(bi.buildBracketModel({ tournament: state.getTournament(db, tms.id), server: finalSrv0, history: finalSrv0.history, livePlan: finalSrv0.currentStage, liveDecisions: finalSrv0.decisions || {}, avatars: {} }));
      const fpath = pathMod.join(os.tmpdir(), "tournament_sim_final_entry.png");
      fs.writeFileSync(fpath, fbuf);
      console.log(`  ↳ final-server entry bracket → ${fpath}`);
    } catch (e) { console.log("  ↳ final entry render skipped:", e.message); }

    await driveServer(tms.id, 90);
    const finalT2 = state.getTournament(db, tms.id);
    assert.equal(finalT2.status, "completed", "multi-server tournament completed via final");
    assert.ok(finalT2.results.first && finalT2.results.second && finalT2.results.third, "overall 1/2/3 decided on final server");
    console.log("✓ cross-server final → champion:", finalT2.results.first.robloxUsername);

    // preview: final-server result — full tree to high (1–2) / low (3rd) league
    try {
      const fdone = state.getServer(state.getTournament(db, tms.id), 90);
      const fbuf2 = await bi.renderBracketCard(bi.buildBracketModel({ tournament: state.getTournament(db, tms.id), server: fdone, history: fdone.history, livePlan: null, avatars: {} }));
      const fpath2 = pathMod.join(os.tmpdir(), "tournament_sim_final_done.png");
      fs.writeFileSync(fpath2, fbuf2);
      console.log(`  ↳ final-server result (high/low league) → ${fpath2}`);
    } catch (e) { console.log("  ↳ final result render skipped:", e.message); }
  }

  // ---- phantom auto-fill (combine real players + made-up ones) ----------------
  {
    const tp = state.createTournamentFromDraft(db, { name: "PhantomCup", slots: 16, seedingMode: "similar", createdBy: MOD, announceChannelId: "chan1", participantRoleId: "role-p" }, { id: state.makeId() });
    state.updateTournament(db, tp.id, { announce: { channelId: "chan1", messageId: "m4" } });
    // 2 REAL players
    for (const uid of ["111111111", "222222222"]) {
      setSnapshot(uid, { hasRobloxAccount: true, robloxUsername: "Real" + uid.slice(0, 2), robloxUserId: "rb" + uid, approvedKills: 5000 });
      await op.handleButtonInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.REGISTER_OPEN, tp.id), userId: uid }));
      await op.handleButtonInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.REG_USE_MAIN, tp.id), userId: uid }));
    }
    assert.equal(state.registrationCount(state.getTournament(db, tp.id)), 2, "2 real players");
    const grantsBefore = roleCalls.filter((c) => c.op === "grant").length;

    // fill all → 14 phantoms, tournament becomes phantom
    await op.handleButtonInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.MANAGE_FILL_ALL, tp.id), userId: MOD, mod: true }));
    const tpf = state.getTournament(db, tp.id);
    assert.equal(state.registrationCount(tpf), 16, "filled to 16 (2 real + 14 phantom)");
    assert.equal(tpf.isPhantom, true, "tournament flagged phantom");
    assert.equal(state.phantomCount(tpf), 14, "14 phantoms");
    assert.ok(state.getRegistration(tpf, "111111111") && state.getRegistration(tpf, "222222222"), "real players untouched");
    // SAFETY: phantoms never trigger real role grants (synthetic ids skip fetchMember)
    assert.equal(roleCalls.filter((c) => c.op === "grant").length, grantsBefore, "no role grants for phantoms");
    // every registrant has positive kills
    for (const r of state.listRegistrations(tpf)) assert.ok(r.effectiveKills > 0, "no zero-kill in phantom fill");
    console.log("✓ phantom fill: 2 real + 14 phantom, flagged, no role leakage");

    // run it fully (real + phantom) to a champion
    await op.handleButtonInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.MANAGE_FORM_DUELS, tp.id), userId: MOD, mod: true }));
    await op.handleButtonInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.MANAGE_LAUNCH_SERVER, tp.id, "0"), userId: MOD, mod: true }));
    for (let guard = 0; guard < 30; guard += 1) {
      const srv = state.getServer(state.getTournament(db, tp.id), 0);
      if (!srv || srv.done) break;
      const run = srv.currentStage.runs[srv.runIndex || 0];
      for (const m of run.matches) {
        await op.handleButtonInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.MATCH_WIN, tp.id, "0", m.key, "r"), userId: MOD, mod: true }));
      }
      await op.handleButtonInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.STAGE_ADVANCE, tp.id, "0"), userId: MOD, mod: true }));
    }
    assert.equal(state.getTournament(db, tp.id).status, "completed", "phantom tournament ran to completion");
    console.log("✓ phantom tournament ran A→B to completion");

    // clear phantoms → only real players remain
    await op.handleButtonInteraction(makeInteraction({ customId: buildCustomId(ACTIONS.MANAGE_CLEAR_PHANTOMS, tp.id), userId: MOD, mod: true }));
    const tpc = state.getTournament(db, tp.id);
    assert.equal(state.registrationCount(tpc), 2, "clear phantoms keeps the 2 real players");
    assert.equal(state.phantomCount(tpc), 0, "no phantoms remain");
    assert.equal(tpc.isPhantom, false, "phantom flag cleared");
    console.log("✓ clear phantoms → real players intact, flag cleared");
  }

  console.log("\nALL SIM CHECKS PASSED");
}

main().catch((e) => { console.error(e); process.exit(1); });
