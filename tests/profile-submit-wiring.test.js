"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const source = fs.readFileSync(path.join(__dirname, "..", "welcome-bot.js"), "utf8");

test("welcome-bot resolves launch source from message-bound profile context before panel snapshots", () => {
  assert.match(
    source,
    /function resolveSubmitLaunchSource\(interaction\) \{[\s\S]*?getProfileSurfaceContext\(messageId, userId\)[\s\S]*?return profileContext\.source;[\s\S]*?getResolvedBotHelperPanelSnapshot\(\)[\s\S]*?SUBMIT_INTAKE_SOURCES\.helper;[\s\S]*?getResolvedWelcomePanelSnapshot\(\)[\s\S]*?SUBMIT_INTAKE_SOURCES\.welcome;/
  );
});

test("welcome-bot remembers only full self-profile surfaces as source carriers", () => {
  assert.match(
    source,
    /function rememberProfileSurfaceContext\([\s\S]*?normalizedDisplayMode === "compact-card"[\s\S]*?return null;[\s\S]*?source: SUBMIT_INTAKE_SOURCES\.profile/
  );
});

test("shared CTA handlers arm intake from the resolved launch source", () => {
  assert.match(
    source,
    /interaction\.customId === "elo_submit_open"[\s\S]*?const launchSource = resolveSubmitLaunchSource\(interaction\)[\s\S]*?source: launchSource/
  );
  assert.match(
    source,
    /interaction\.customId === "onboard_begin"[\s\S]*?const launchSource = resolveSubmitLaunchSource\(interaction\)[\s\S]*?openCharacterPicker\(interaction, "full", "reply", \{[\s\S]*?source: launchSource/
  );
});

test("shared mains buttons keep their current picker contracts", () => {
  assert.match(
    source,
    /interaction\.customId === "onboard_change_mains"[\s\S]*?openCharacterPicker\(interaction, "full", "reply", \{[\s\S]*?source: resolveSubmitLaunchSource\(interaction\)/
  );
  assert.match(
    source,
    /interaction\.customId === "onboard_quick_mains"[\s\S]*?openCharacterPicker\(interaction, "quick", "reply", \{[\s\S]*?source: SUBMIT_INTAKE_SOURCES\.welcome/
  );
});

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

test("welcome-bot keeps bot-helper CTA buttons out of profile submit capture detection", () => {
  const functionStart = source.indexOf("function isProfileSubmitSourceInteraction");
  const functionEnd = source.indexOf("function isBotHelperPanelSourceInteraction", functionStart);
  const functionBody = source.slice(functionStart, functionEnd);

  assert.ok(functionStart > 0 && functionEnd > functionStart, "isProfileSubmitSourceInteraction must exist");
  assert.doesNotMatch(functionBody, /getBotHelperPanelRequiredCustomIds\(\)\.every/);
});

test("profile kills wait until mains are selected before message capture starts", () => {
  const noDraftBranchStart = source.indexOf("await openCharacterPicker(interaction, \"full\", \"reply\", {");
  const noDraftBranchEnd = source.indexOf("} catch (error) {", noDraftBranchStart);
  const noDraftBranch = source.slice(noDraftBranchStart, noDraftBranchEnd);

  assert.ok(noDraftBranchStart > 0, "profile-scoped no-draft branch must open the picker with capture metadata");
  assert.match(source, /afterSelectionProfileSubmitAction: PROFILE_SUBMIT_ACTIONS\.KILLS/);
  assert.match(source, /pickerSession\?\.afterSelectionProfileSubmitAction === PROFILE_SUBMIT_ACTIONS\.KILLS[\s\S]*?startProfileSubmitCapture/);
  assert.doesNotMatch(noDraftBranch, /startProfileSubmitCapture\(interaction\.user\.id/);
});

test("profile mains stay quick while helper mains keep the shared full-picker route", () => {
  assert.match(
    source,
    /interaction\.customId === "onboard_change_mains"[\s\S]*?if \(isProfileSubmitSourceInteraction\(interaction\)\) \{[\s\S]*?openCharacterPicker\(interaction, isProfileSubmitSourceInteraction\(interaction\) \? "quick" : "full", "reply"\)[\s\S]*?openCharacterPicker\(interaction, "full", "reply", \{[\s\S]*?source: resolveSubmitLaunchSource\(interaction\)/
  );
});
