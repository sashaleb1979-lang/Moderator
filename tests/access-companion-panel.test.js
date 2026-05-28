"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const welcomeBotSource = fs.readFileSync(path.join(__dirname, "..", "welcome-bot.js"), "utf8");
const activityOperatorSource = fs.readFileSync(path.join(__dirname, "..", "src", "activity", "operator.js"), "utf8");

test("main onboarding panel exposes access companion controls and status", () => {
  assert.match(welcomeBotSource, /name: "Чат постояльцев"/);
  assert.match(welcomeBotSource, /setCustomId\("panel_access_companion_toggle"\)/);
  assert.match(welcomeBotSource, /setCustomId\("panel_access_companion_role"\)/);
  assert.match(welcomeBotSource, /setCustomId\("panel_sync_access_companion"\)/);
});

test("access companion role modal writes or clears the SoT accessCompanion role", () => {
  const modalStart = welcomeBotSource.indexOf('interaction.customId === "panel_access_companion_role_modal"');
  const modalEnd = welcomeBotSource.indexOf('if (interaction.customId === BOT_HELPER_PANEL_CONFIG_MODAL_ID)', modalStart);
  const modalBody = welcomeBotSource.slice(modalStart, modalEnd);

  assert.ok(modalStart > 0, "access companion role modal handler exists");
  assert.match(modalBody, /writeNativeRoleRecord\(db, \{[\s\S]*slot: "accessCompanion"/);
  assert.match(modalBody, /clearNativeRoleRecord\(db, \{ slot: "accessCompanion" \}\)/);
  assert.match(modalBody, /syncAccessCompanionRoles\(client/);
});

test("role sync and activity sync include access companion reconciliation", () => {
  assert.match(welcomeBotSource, /panel_sync_roles[\s\S]*?syncAccessCompanionRoles\(client/);
  assert.match(welcomeBotSource, /runSyncRoles: async \(args\) => \{[\s\S]*?runActivityRoleSyncFromSnapshots\(args\)[\s\S]*?syncAccessCompanionRoles\(client/);
  assert.match(welcomeBotSource, /runDailyActivityRoleSync: async \(\) => \{[\s\S]*?syncAccessCompanionRoles\(client/);
  assert.match(activityOperatorSource, /accessCompanionSummary/);
});
