"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("welcome-bot approval flow appends proof-window snapshots before saveDb", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "welcome-bot.js"), "utf8");

  assert.match(
    source,
    /const\s*\{[\s\S]*?appendProofWindowSnapshot[\s\S]*?\}\s*=\s*require\("\.\/src\/profile\/synergy-snapshots"\);/,
    "expected welcome-bot to import the proof-window snapshot helper"
  );

  const match = source.match(
    /async function approveSubmission\(client, submission, moderatorTag\) \{[\s\S]*?appendProofWindowSnapshot\(profile, \{([\s\S]*?)\}\);[\s\S]*?try \{\s*saveDb\(\);/
  );

  assert.ok(match, "expected approveSubmission to append a proof-window snapshot before saveDb");
  assert.match(match[1], /approvedKills:\s*profile\.approvedKills/);
  assert.match(match[1], /killTier:\s*profile\.killTier/);
  assert.match(match[1], /reviewedAt:\s*submission\.reviewedAt/);
  assert.match(match[1], /reviewedBy:\s*submission\.reviewedBy/);
  assert.match(match[1], /roblox:\s*profile\?\.domains\?\.roblox\s*\|\|\s*profile/);
});