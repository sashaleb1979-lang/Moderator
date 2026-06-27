"use strict";

// Slash command definition + custom-id routing helpers for the tournament module.
// Everything the operator routes on lives in the `t:` custom-id namespace.

const TOURNAMENT_COMMAND_NAME = "турнир";
const TOURNAMENT_PANEL_SUBCOMMAND = "панель";

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
  SETUP_ROLE: "srole", // role select: participant role
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
  MANAGE_FORM_DUELS: "mform", // (re)compute seeding / roster before launch
  MANAGE_PUBLISH_PREVIEW: "mprev", // publish a one-image preview of all branches/servers
  MANAGE_LAUNCH_SERVER: "mlaunch", // launch server N -> persist bracket, then side-effects
  MANAGE_LAUNCH_FINAL: "mfinal", // launch the cross-server final (top-4 from each)
  MANAGE_RETRY_THREAD: "mthr", // re-run thread/ping side-effects for a server
  MANAGE_START: "mstart", // open match-result panel
  MANAGE_CANCEL: "mcancel",
  SUMMARY_OPEN: "msum", // open completed tournament summary panel
  SUMMARY_COMMENT: "scom", // modal: organizer comment for final summary
  SUMMARY_PUBLISH: "spost", // publish final summary to announcement channel

  // roster / participants
  MANAGE_ROSTER: "mrost", // open the "who registered" viewer
  ROSTER_PAGE: "rpg", // extra: page index
  ROSTER_KILLS_REFRESH: "rkr", // re-hydrate kills for everyone
  MANAGE_ADD_PLAYER: "madd", // open add-player (user select)
  ADD_PLAYER_SELECT: "madds", // user select submitted
  ADD_PLAYER_MODAL: "maddm", // modal: nick + kills (no profile on file)
  MANAGE_REMOVE_PLAYER: "mrm", // open remove-player (user select)
  REMOVE_PLAYER_SELECT: "mrms", // user select submitted
  MANAGE_SYNC_ROLES: "msync", // grant participant role to all registrants
  MANAGE_FILL_ALL: "mfill", // fill empty slots with one-off phantom players (→ tournament becomes phantom)
  MANAGE_CLEAR_PHANTOMS: "mclr", // remove only the phantom players (keep real ones)

  // match-result panel
  MATCH_WIN: "mw", // a side won
  MATCH_NOSHOW: "mns", // a side did not show
  MATCH_UNDO: "mu",
  STAGE_ADVANCE: "adv", // proceed to next run / stage
});

const COLORS = Object.freeze({
  primary: 0x5865f2,
  red: 0xed4245,
  blue: 0x3b82f6,
  green: 0x57f287,
  gold: 0xfee75c,
  neutral: 0x2b2d31,
  purple: 0x9b59b6,
  slate: 0x4e5d94,
  orange: 0xe67e22,
  teal: 0x1abc9c,
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
      ),
  ].map((command) => command.toJSON());
}

module.exports = {
  TOURNAMENT_COMMAND_NAME,
  TOURNAMENT_PANEL_SUBCOMMAND,
  CUSTOM_ID_PREFIX,
  ACTIONS,
  COLORS,
  buildCustomId,
  parseCustomId,
  isTournamentCustomId,
  buildTournamentCommands,
};
