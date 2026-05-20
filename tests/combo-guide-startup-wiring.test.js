"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("welcome-bot combo publish wiring imports publisher owners and cleans same-channel republish", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "welcome-bot.js"), "utf8");

  assert.match(source, /const \{[\s\S]*addCharacterToGuide,[\s\S]*deleteFullGuide,[\s\S]*downloadUrl,[\s\S]*publishGuideOrdered,[\s\S]*refreshNavigation,[\s\S]*removeCharacterFromGuide,[\s\S]*\} = require\("\.\/src\/combo-guide\/publisher"\);/);
  assert.match(source, /const existingGuideState = db\.comboGuide[\s\S]*String\(db\.comboGuide\.channelId \|\| ""\)\.trim\(\) === String\(targetChannel\?\.id \|\| ""\)\.trim\(\)[\s\S]*\? db\.comboGuide[\s\S]*: null;/);
  assert.match(source, /if \(existingGuideState\) \{[\s\S]*await deleteFullGuide\(\{[\s\S]*channel: targetChannel,[\s\S]*guideState: existingGuideState,[\s\S]*\}\);[\s\S]*\}/);
  assert.match(source, /const state = await publishGuideOrdered\(\{/);
});