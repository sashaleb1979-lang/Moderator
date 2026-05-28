"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  BOT_HELPER_PANEL_ACTION_IDS,
  BOT_HELPER_PANEL_AUTO_RESEND_INTERVAL_HOURS,
  BOT_HELPER_PANEL_AUTO_RESEND_INTERVAL_MS,
  BOT_HELPER_PANEL_CHANNEL_INPUT_ID,
  BOT_HELPER_PANEL_CONFIG_BUTTON_ID,
  BOT_HELPER_PANEL_CONFIG_MODAL_ID,
  BOT_HELPER_PANEL_EDITOR_CUSTOM_IDS,
  BOT_HELPER_PANEL_SLOT,
  buildBotHelperPanelPayload,
  buildBotHelperSettingsPayload,
  getBotHelperPanelResendDisposition,
  getBotHelperPanelRequiredCustomIds,
} = require("../src/onboard/bot-helper-panel");

const fs = require("node:fs");
const path = require("node:path");

const welcomeBotSource = fs.readFileSync(path.join(__dirname, "..", "welcome-bot.js"), "utf8");

test("bot helper panel payload renders the four MVP actions", () => {
  const payload = buildBotHelperPanelPayload();

  assert.equal(payload.embeds.length, 1);
  assert.match(payload.embeds[0].data.title, /bot chat helper/i);
  assert.equal(payload.embeds[0].data.color, 0x5865F2);
  assert.doesNotMatch(payload.embeds[0].data.description, /12|час/i);
  assert.deepEqual(
    payload.embeds[0].data.fields.map((field) => field.name),
    ["Заявки", "Профиль"]
  );
  assert.equal(payload.components.length, 1);
  assert.deepEqual(
    payload.components.flatMap((row) => row.toJSON().components.map((component) => component.custom_id)),
    [
      BOT_HELPER_PANEL_ACTION_IDS.kills,
      BOT_HELPER_PANEL_ACTION_IDS.roblox,
      BOT_HELPER_PANEL_ACTION_IDS.elo,
      BOT_HELPER_PANEL_ACTION_IDS.mains,
    ]
  );
  assert.deepEqual(
    payload.components.flatMap((row) => row.toJSON().components.map((component) => component.label)),
    ["Kills", "Roblox", "ELO", "Персонажи"]
  );
});

test("bot helper panel exports stable slot and config ids", () => {
  assert.equal(BOT_HELPER_PANEL_SLOT, "botHelper");
  assert.equal(BOT_HELPER_PANEL_CONFIG_BUTTON_ID, "panel_config_bot_helper");
  assert.equal(BOT_HELPER_PANEL_CONFIG_MODAL_ID, "panel_config_bot_helper_modal");
  assert.equal(BOT_HELPER_PANEL_CHANNEL_INPUT_ID, "panel_channel_bot_helper");
  assert.equal(BOT_HELPER_PANEL_AUTO_RESEND_INTERVAL_HOURS, 12);
  assert.deepEqual(getBotHelperPanelRequiredCustomIds(), [
    "onboard_begin",
    "bot_helper_bind_roblox",
    "elo_submit_open",
    "onboard_change_mains",
  ]);
});

test("bot helper settings payload exposes channel, resend, refresh and disable controls", () => {
  const payload = buildBotHelperSettingsPayload({
    channelText: "<#channel>",
    messageText: "message-1",
    checkCadenceText: "каждые 5 минут",
    lastSentText: "сейчас",
    activityText: "есть активность ниже",
    autoResendText: "12 часов",
    statusText: "Панель готова.",
  });

  assert.equal(payload.embeds.length, 1);
  assert.match(payload.embeds[0].data.title, /bot helper settings/i);
  assert.match(JSON.stringify(payload.embeds[0].data.fields), /5 минут/i);
  assert.equal(payload.components.length, 2);
  assert.deepEqual(
    payload.components.flatMap((row) => row.toJSON().components.map((component) => component.custom_id)),
    [
      BOT_HELPER_PANEL_EDITOR_CUSTOM_IDS.setChannel,
      BOT_HELPER_PANEL_EDITOR_CUSTOM_IDS.resendNow,
      BOT_HELPER_PANEL_EDITOR_CUSTOM_IDS.refresh,
      BOT_HELPER_PANEL_EDITOR_CUSTOM_IDS.disable,
      BOT_HELPER_PANEL_EDITOR_CUSTOM_IDS.close,
    ]
  );
});

test("bot helper resend disposition waits for both activity below and the 12-hour interval", () => {
  const ready = getBotHelperPanelResendDisposition({
    panelMessageId: "panel-1",
    lastChannelMessageId: "user-2",
    lastSentAt: "2026-05-18T00:00:00.000Z",
    now: Date.parse("2026-05-18T12:00:00.000Z"),
    autoResendIntervalMs: BOT_HELPER_PANEL_AUTO_RESEND_INTERVAL_MS,
  });
  assert.equal(ready.hasActivityBelow, true);
  assert.equal(ready.isOverdue, true);
  assert.equal(ready.needsResend, true);

  const tooEarly = getBotHelperPanelResendDisposition({
    panelMessageId: "panel-1",
    lastChannelMessageId: "user-2",
    lastSentAt: "2026-05-18T06:30:00.000Z",
    now: Date.parse("2026-05-18T12:00:00.000Z"),
    autoResendIntervalMs: BOT_HELPER_PANEL_AUTO_RESEND_INTERVAL_MS,
  });
  assert.equal(tooEarly.hasActivityBelow, true);
  assert.equal(tooEarly.isOverdue, false);
  assert.equal(tooEarly.needsResend, false);

  const noActivity = getBotHelperPanelResendDisposition({
    panelMessageId: "panel-1",
    lastChannelMessageId: "panel-1",
    lastSentAt: "2026-05-18T00:00:00.000Z",
    now: Date.parse("2026-05-18T12:00:00.000Z"),
  });
  assert.equal(noActivity.hasActivityBelow, false);
  assert.equal(noActivity.needsResend, false);
});

test("bot helper force resend resolves and deletes the managed message before sending a new one", () => {
  const functionStart = welcomeBotSource.indexOf("async function refreshBotHelperPanel");
  const functionEnd = welcomeBotSource.indexOf("async function repostBotHelperPanelToChannel", functionStart);
  const body = welcomeBotSource.slice(functionStart, functionEnd);

  assert.ok(functionStart > 0, "refreshBotHelperPanel must exist");
  assert.doesNotMatch(body, /if \(!options\.forceRecreate\)\s*{\s*message = await resolveBotHelperPanelManagedMessage/);
  assert.ok(
    body.indexOf("message = await resolveBotHelperPanelManagedMessage(client, channel, state);")
      < body.indexOf("if (message && (options.bump || options.forceRecreate))"),
    "force resend should resolve the old managed message before delete/send"
  );
});
