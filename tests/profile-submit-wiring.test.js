"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const source = fs.readFileSync(path.join(__dirname, "..", "welcome-bot.js"), "utf8");

test("welcome-bot wires profile submit capture before legacy channel guards", () => {
  assert.match(source, /createProfileSubmitCaptureStore\(\)/);
  const captureIndex = source.indexOf("handleProfileSubmitCaptureMessage(message)");
  const legacyEloIndex = source.indexOf("const legacyEloState = getLiveLegacyEloState();", captureIndex);
  const welcomeGuardIndex = source.indexOf("if (message.channelId !== getResolvedChannelId(\"welcome\")) return;", captureIndex);

  assert.ok(captureIndex > 0, "profile capture message handler must be called");
  assert.ok(legacyEloIndex > captureIndex, "profile capture should run before legacy ELO channel guard");
  assert.ok(welcomeGuardIndex > captureIndex, "profile capture should run before welcome-only guard");
});

test("welcome-bot starts current-channel scoped sessions from profile CTA buttons", () => {
  assert.match(source, /interaction\.customId === "elo_submit_open"[\s\S]*?isProfileSubmitSourceInteraction\(interaction\)[\s\S]*?PROFILE_SUBMIT_ACTIONS\.ELO/);
  assert.match(source, /interaction\.customId === "onboard_begin"[\s\S]*?profileScopedBegin[\s\S]*?PROFILE_SUBMIT_ACTIONS\.KILLS/);
  assert.match(source, new RegExp("interaction\\.customId === PROFILE_SUBMIT_CANCEL_CUSTOM_ID[\\s\\S]*?clearProfileSubmitCapture"));
});

test("welcome-bot treats the full bot-helper panel as a profile submit source", () => {
  assert.match(source, /function isProfileSubmitSourceInteraction[\s\S]*?getBotHelperPanelRequiredCustomIds\(\)\.every/);
  assert.match(source, /source: isBotHelperPanelSourceInteraction\(interaction\) \? "bot_helper_elo_button" : "profile_elo_button"/);
  assert.match(source, /source: isBotHelperPanelSourceInteraction\(interaction\) \? "bot_helper_kills_button" : "profile_kills_button"/);
});

test("profile and bot-helper kills wait until mains are selected before message capture starts", () => {
  const noDraftBranchStart = source.indexOf("await openCharacterPicker(interaction, \"full\", \"reply\", {");
  const noDraftBranchEnd = source.indexOf("} catch (error) {", noDraftBranchStart);
  const noDraftBranch = source.slice(noDraftBranchStart, noDraftBranchEnd);

  assert.ok(noDraftBranchStart > 0, "profile-scoped no-draft branch must open the picker with capture metadata");
  assert.match(source, /afterSelectionProfileSubmitAction: PROFILE_SUBMIT_ACTIONS\.KILLS/);
  assert.match(source, /pickerSession\?\.afterSelectionProfileSubmitAction === PROFILE_SUBMIT_ACTIONS\.KILLS[\s\S]*?startProfileSubmitCapture/);
  assert.doesNotMatch(noDraftBranch, /startProfileSubmitCapture\(interaction\.user\.id/);
});

test("profile and bot-helper mains buttons use quick mains update instead of full submit flow", () => {
  assert.match(
    source,
    /interaction\.customId === "onboard_change_mains"[\s\S]*?openCharacterPicker\(interaction, isProfileSubmitSourceInteraction\(interaction\) \? "quick" : "full", "reply"\)/
  );
});
