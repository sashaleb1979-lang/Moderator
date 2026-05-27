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
