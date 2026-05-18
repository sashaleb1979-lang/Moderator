"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  BOT_HELPER_PANEL_ACTION_IDS,
  BOT_HELPER_PANEL_CHANNEL_INPUT_ID,
  BOT_HELPER_PANEL_CONFIG_BUTTON_ID,
  BOT_HELPER_PANEL_CONFIG_MODAL_ID,
  BOT_HELPER_PANEL_SLOT,
  buildBotHelperPanelPayload,
  getBotHelperPanelRequiredCustomIds,
} = require("../src/onboard/bot-helper-panel");

test("bot helper panel payload renders the four MVP actions", () => {
  const payload = buildBotHelperPanelPayload();

  assert.equal(payload.embeds.length, 1);
  assert.match(payload.embeds[0].data.title, /bot chat helper/i);
  assert.equal(payload.components.length, 2);
  assert.deepEqual(
    payload.components.flatMap((row) => row.toJSON().components.map((component) => component.custom_id)),
    [
      BOT_HELPER_PANEL_ACTION_IDS.kills,
      BOT_HELPER_PANEL_ACTION_IDS.roblox,
      BOT_HELPER_PANEL_ACTION_IDS.elo,
      BOT_HELPER_PANEL_ACTION_IDS.mains,
    ]
  );
});

test("bot helper panel exports stable slot and config ids", () => {
  assert.equal(BOT_HELPER_PANEL_SLOT, "botHelper");
  assert.equal(BOT_HELPER_PANEL_CONFIG_BUTTON_ID, "panel_config_bot_helper");
  assert.equal(BOT_HELPER_PANEL_CONFIG_MODAL_ID, "panel_config_bot_helper_modal");
  assert.equal(BOT_HELPER_PANEL_CHANNEL_INPUT_ID, "panel_channel_bot_helper");
  assert.deepEqual(getBotHelperPanelRequiredCustomIds(), [
    "onboard_begin",
    "profile_bind_roblox",
    "elo_submit_open",
    "onboard_change_mains",
  ]);
});