"use strict";
const { createTournamentOperator } = require("./src/tournament/operator");
const { ACTIONS, buildCustomId } = require("./src/tournament/commands");
const state = require("./src/tournament/state");

const calls = [];
function mkBtn(customId, userId = "mod-1") {
  return {
    customId, user: { id: userId, tag: userId + "#0001" }, member: { mod: true }, deferred: false, replied: false,
    async deferUpdate() { this.deferred = true; },
    async deferReply() { this.deferred = true; },
    async editReply(p) { this.editedPayload = p; return p; },
    async update(p) { this.updatedPayload = p; return p; },
    async reply(p) { this.replied = true; this.replyPayload = p; return p; },
    async followUp(p) { return { id: "fu" }; },
    async showModal(p) { return p; },
  };
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const db = {};
  const tournament = state.createTournamentFromDraft(
    db,
    { name: "Phantom Cup", slots: 32, plannedPlayers: 32, startsAtIso: "2026-07-01T20:00:00.000Z", announceChannelId: "chan1" },
    { id: "tour-1", now: "2026-06-27T18:00:00.000Z" }
  );
  state.updateTournament(db, tournament.id, { announce: { channelId: "chan1", messageId: "msg1" } });

  const fakeChannel = {
    id: "chan1", isTextBased: () => true,
    async send(p) { return { id: "m" + Math.random(), channelId: "chan1", edit: async () => ({}) }; },
    messages: { async fetch() { return { id: "msg1", edit: async () => ({}), components: [] }; } },
    threads: { async create() { return { id: "thread1", send: async () => ({}), setLocked: async () => ({}), members: { add: async () => ({}) } }; } },
  };

  const op = createTournamentOperator({
    db,
    saveDb: () => {},
    isModerator: () => true,
    runSerializedMutation: async ({ mutate }) => mutate(),
    getPlayerSnapshot: async () => ({ hasRobloxAccount: true, approvedKills: 5000, killsSource: "profile" }),
    grantRole: async () => ({ granted: true }),
    removeRole: async () => ({ removed: true }),
    fetchMember: async () => null,
    fetchChannel: async (id) => (id === "chan1" || id === "thread1" ? fakeChannel : null),
    fetchAvatarHeadshots: async () => [],
    logLine: async () => {},
    logError: (...a) => console.log("LOGERR:", ...a.map(String)),
    renderPreviewBuffer: async () => null,
    buildServerBracketArt: async () => ({ payload: { flags: 0 }, buffer: null, filename: "b.png" }),
    resolveRobloxUser: async () => null,
    writeRobloxBinding: async () => {},
    renderTournamentImage: async () => null,
    collectTournamentAvatars: async () => ({}),
  });

  async function click(action, extra) {
    const id = extra != null ? buildCustomId(action, tournament.id, String(extra)) : buildCustomId(action, tournament.id);
    const it = mkBtn(id);
    try {
      await op.handleButtonInteraction(it);
      const status = JSON.stringify(it.editedPayload || it.updatedPayload || it.replyPayload || {});
      const m = status.match(/Недостаточно[^"]*|Не удалось[^"]*|не найден[^"]*|запущен[^"]*|Добавлено фантомов[^"]*/);
      console.log("OK", action, extra ?? "", "->", m ? m[0].slice(0, 60) : "(rendered)");
    } catch (e) {
      console.log("THREW", action, extra ?? "", "->", e && e.message, "\n", (e && e.stack || "").split("\n").slice(1, 4).join("\n"));
    }
  }

  console.log("slots:", tournament.slots);
  await click(ACTIONS.MANAGE_FILL_ALL);
  console.log("after fill: regs =", state.registrationCount(state.getTournament(db, tournament.id)), "isPhantom =", state.getTournament(db, tournament.id).isPhantom);
  await click(ACTIONS.MANAGE_CLOSE_REG);
  await click(ACTIONS.MANAGE_FORM_DUELS);
  const seeded = state.getTournament(db, tournament.id);
  console.log("after formDuels: status =", seeded.status, "serverCount via regs serverIndex:", [...new Set(Object.values(seeded.registrations).map(r => r.serverIndex))]);
  await click(ACTIONS.MANAGE_LAUNCH_SERVER, 0);
  await click(ACTIONS.MANAGE_LAUNCH_SERVER, 1);
  await delay(50);
  const s0 = state.getServer(state.getTournament(db, tournament.id), 0);
  const s1 = state.getServer(state.getTournament(db, tournament.id), 1);
  console.log("server0 launched:", !!(s0 && s0.launched), "currentStage:", !!(s0 && s0.currentStage));
  console.log("server1 launched:", !!(s1 && s1.launched), "currentStage:", !!(s1 && s1.currentStage));
})().catch((e) => console.error("FATAL", e));
