"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("welcome-bot applies autonomy guard to combo component and modal follow-ups", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "welcome-bot.js"), "utf8");

  assert.match(source, /const isComboPanelButton = interaction\.customId === "combo_panel_refresh_nav"[\s\S]*interaction\.customId\.startsWith\("combo_panel_remove_char:"\);/);
  assert.match(source, /if \(isComboPanelButton && await replyIfAutonomyGuardBlockedActor\(interaction\)\) \{[\s\S]*return;[\s\S]*\}/);
  assert.match(source, /const isComboGuideSelectMenu = interaction\.customId === "combo_select_character"[\s\S]*interaction\.customId === "combo_select_message";/);
  assert.match(source, /if \(isComboGuideSelectMenu && await replyIfAutonomyGuardBlockedActor\(interaction\)\) \{[\s\S]*return;[\s\S]*\}/);
  assert.match(source, /if \(interaction\.customId\?\.startsWith\("combo_edit_message:"\)\) \{[\s\S]*if \(await replyIfAutonomyGuardBlockedActor\(interaction\)\) \{[\s\S]*return;[\s\S]*\}[\s\S]*if \(!hasComboGuidePanelAccess\(interaction\.member\)\)/);
});