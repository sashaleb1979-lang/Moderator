"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const source = fs.readFileSync(path.join(__dirname, "..", "welcome-bot.js"), "utf8");

function extractBlock(startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.ok(start >= 0, `${startNeedle} must exist`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(end > start, `${endNeedle} must follow ${startNeedle}`);
  return source.slice(start, end);
}

test("ELO intake target resolver routes helper, profile, welcome, and unknown sources separately", () => {
  const resolver = extractBlock(
    "function resolveEloIntakeTargetChannelId(options = {})",
    "function getLegacyEloHelperTargetChannelId(options = {})"
  );

  assert.match(
    resolver,
    /source === SUBMIT_INTAKE_SOURCES\.helper[\s\S]*?getResolvedBotHelperPanelSnapshot\(\)\.channelId \|\| interactionChannelId/,
    "helper source should prefer the bot-helper panel channel, then the interaction channel"
  );
  assert.match(
    resolver,
    /source === SUBMIT_INTAKE_SOURCES\.profile[\s\S]*?return interactionChannelId;/,
    "profile source should keep capture scoped to the current interaction channel"
  );
  assert.match(
    resolver,
    /source === SUBMIT_INTAKE_SOURCES\.welcome[\s\S]*?getResolvedWelcomePanelSnapshot\(\)\.channelId \|\| interactionChannelId/,
    "welcome source should prefer the welcome panel channel, then the interaction channel"
  );
  assert.match(
    resolver,
    /panelChannelId: legacySubmitPanelChannelId \|\| options\.panelChannelId[\s\S]*?fallbackChannelId: interactionChannelId \|\| options\.fallbackChannelId/,
    "unknown source fallback should retain the legacy raw submit panel hub"
  );
});

test("legacy ELO helper arming accepts an explicit channelId before legacy panel fallback", () => {
  const helper = extractBlock(
    "function getLegacyEloHelperTargetChannelId(options = {})",
    "function setHelperIntakeSession(userId, value = {})"
  );
  const armer = extractBlock(
    "function armLegacyEloHelperIntakeSession(userId, options = {})",
    "function getResolvedEloSubmitPanelSnapshot()"
  );

  assert.match(helper, /channelId: options\.channelId/);
  assert.match(armer, /const channelId = getLegacyEloHelperTargetChannelId\(options\)/);
});

test("elo_submit_open arms helper sessions with the source-aware target channel", () => {
  const branch = extractBlock(
    "if (interaction.customId === \"elo_submit_open\")",
    "if (interaction.customId === \"elo_submit_cancel\")"
  );

  assert.match(branch, /const launchSource = resolveSubmitLaunchSource\(interaction\)/);
  assert.match(branch, /const sourceAwareTargetChannelId = resolveEloIntakeTargetChannelId\(\{[\s\S]*?source: launchSource,[\s\S]*?interactionChannelId: interaction\.channelId,[\s\S]*?legacySubmitPanelChannelId: submitPanel\.channelId/);
  assert.match(branch, /armLegacyEloHelperIntakeSession\(interaction\.user\.id, \{[\s\S]*?source: launchSource,[\s\S]*?channelId: sourceAwareTargetChannelId/);
});

test("profile ELO button still starts current-channel capture", () => {
  const branch = extractBlock(
    "if (interaction.customId === \"elo_submit_open\")",
    "if (interaction.customId === \"elo_submit_cancel\")"
  );

  assert.match(branch, /if \(isProfileSubmitSourceInteraction\(interaction\)\) \{[\s\S]*?startProfileSubmitCapture\(interaction\.user\.id, \{[\s\S]*?action: PROFILE_SUBMIT_ACTIONS\.ELO,[\s\S]*?channelId: interaction\.channelId/);
});
