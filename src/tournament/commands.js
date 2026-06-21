"use strict";

// Slash command definition + custom-id routing helpers for the tournament module.
// Everything the operator routes on lives in the `t:` custom-id namespace.

const TOURNAMENT_COMMAND_NAME = "турнир";
const TOURNAMENT_PANEL_SUBCOMMAND = "панель";
const TOURNAMENT_TEST_SUBCOMMAND = "тест";

const CUSTOM_ID_PREFIX = "t";

// Action keys carried in custom ids (kept short — Discord caps custom_id at 100).
const ACTIONS = Object.freeze({
  // moderator hub / setup
  HUB_REFRESH: "hub",
  SETUP_OPEN: "setup",
  SETUP_BASICS: "sb", // modal: name / players / slots
  SETUP_TIME: "stime", // modal: MSK time
  SETUP_REWARDS: "srew", // modal: rewards
  SETUP_CONDITIONS: "scond", // modal: conditions
  SETUP_MODE: "smode", // select: similar | seed
  SETUP_PING: "sping", // role select
  SETUP_CHANNEL: "schan", // channel select
  SETUP_PUBLISH: "spub",
  SETUP_CANCEL: "scancel",

  // public announcement
  REGISTER_OPEN: "reg", // player clicks "Записаться"

  // registration flow
  REG_USE_MAIN: "rmain",
  REG_USE_OTHER: "rother",
  REG_LINK_ROBLOX: "rlink", // modal: enter exact nick (no account on file)
  REG_LINK_ALT: "ralt", // modal: enter alt nick
  REG_DECLARE_TWINK: "rtwink",
  REG_PICK_TIER: "rtier", // select declared tier
  REG_PICK_KILLS: "rkills", // select approximate kills bucket
  REG_BACK: "rback",
  REG_CONFIRM: "rconfirm",
  REG_WITHDRAW: "rwd",

  // management panel
  MANAGE_OPEN: "mgr",
  MANAGE_REFRESH: "mref",
  MANAGE_CLOSE_REG: "mclose",
  MANAGE_OPEN_REG: "mopen",
  MANAGE_FORM_DUELS: "mform", // compute seeding / roster
  MANAGE_LAUNCH_SERVER: "mlaunch", // launch server N -> thread + preliminary bracket
  MANAGE_START: "mstart", // open match-result panel
  MANAGE_CANCEL: "mcancel",
  MANAGE_REMOVE_PLAYER: "mrm",

  // match-result panel
  MATCH_WIN: "mw", // a side won
  MATCH_NOSHOW: "mns", // a side did not show
  MATCH_UNDO: "mu",
  STAGE_ADVANCE: "adv", // proceed to next run / stage

  // test harness (mod-only, isolated, quick rollback)
  TEST_REFRESH: "tref",
  TEST_CREATE: "tcreate", // extra: slots
  TEST_FILL: "tfill", // extra: tournamentId, count ("full" | N)
  TEST_RESET: "treset", // clear bracket + registrations, keep tournament
  TEST_DELETE: "tdel", // delete tournament + best-effort message/thread cleanup
  TEST_PURGE: "tpurge", // delete ALL test tournaments
});

const COLORS = Object.freeze({
  primary: 0x5865f2,
  red: 0xed4245,
  blue: 0x3b82f6,
  green: 0x57f287,
  gold: 0xfee75c,
  neutral: 0x2b2d31,
});

// build a custom id: t:<action>:<tournamentId>:<...extra>
function buildCustomId(action, tournamentId = "", ...extra) {
  return [CUSTOM_ID_PREFIX, action, tournamentId, ...extra]
    .map((part) => String(part == null ? "" : part))
    .join(":");
}

// parse a custom id back into { action, tournamentId, extra: [...] } or null if
// it is not ours.
function parseCustomId(customId) {
  const text = String(customId || "");
  if (!text.startsWith(`${CUSTOM_ID_PREFIX}:`)) return null;
  const parts = text.split(":");
  return {
    action: parts[1] || "",
    tournamentId: parts[2] || "",
    extra: parts.slice(3),
  };
}

function isTournamentCustomId(customId) {
  return parseCustomId(customId) != null;
}

function buildTournamentCommands() {
  const { SlashCommandBuilder } = require("discord.js");
  return [
    new SlashCommandBuilder()
      .setName(TOURNAMENT_COMMAND_NAME)
      .setDescription("Турниры — создание, заявки и проведение")
      .addSubcommand((sub) =>
        sub.setName(TOURNAMENT_PANEL_SUBCOMMAND).setDescription("Открыть панель управления турнирами")
      )
      .addSubcommand((sub) =>
        sub.setName(TOURNAMENT_TEST_SUBCOMMAND).setDescription("Тестовая песочница: запустить и быстро откатить турнир")
      ),
  ].map((command) => command.toJSON());
}

module.exports = {
  TOURNAMENT_COMMAND_NAME,
  TOURNAMENT_PANEL_SUBCOMMAND,
  TOURNAMENT_TEST_SUBCOMMAND,
  CUSTOM_ID_PREFIX,
  ACTIONS,
  COLORS,
  buildCustomId,
  parseCustomId,
  isTournamentCustomId,
  buildTournamentCommands,
};
