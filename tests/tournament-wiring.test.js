"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("welcome-bot tournament Roblox snapshot uses the shared profile nickname base", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "welcome-bot.js"), "utf8");
  const snapshotStart = source.indexOf("function getTournamentPlayerSnapshot(userId, options = {}) {");
  const operatorStart = source.indexOf("function getTournamentOperator() {");
  const snapshotAdapterBlock = source.slice(Math.max(0, snapshotStart - 6000), operatorStart);

  assert.match(
    source,
    /const \{[\s\S]*normalizeRobloxDomainState,[\s\S]*resolveUsableVerifiedRobloxIdentity,[\s\S]*\} = require\("\.\/src\/integrations\/shared-profile"\);/
  );
  assert.ok(snapshotStart >= 0, "expected tournament snapshot adapter");
  assert.match(snapshotAdapterBlock, /profile\.summary\?\.roblox/);
  assert.match(snapshotAdapterBlock, /profile\.robloxUsername/);
  assert.match(snapshotAdapterBlock, /normalizeRobloxDomainState\(entry\)/);
  assert.match(snapshotAdapterBlock, /resolveUsableVerifiedRobloxIdentity\(entry\)/);
  assert.match(snapshotAdapterBlock, /function pickTournamentApprovedKills/);
  assert.match(snapshotAdapterBlock, /function findTournamentProfileByRegistration/);
  assert.match(snapshotAdapterBlock, /function pickTournamentTextTierlistProfileKills/);
  assert.match(snapshotAdapterBlock, /getApprovedTierlistEntries\(\)/);
  assert.match(snapshotAdapterBlock, /normalizeTournamentRobloxUsername\(registration\?\.robloxUsername\)/);
  assert.match(snapshotAdapterBlock, /pickTournamentApprovedSubmissionKills\(profile, registration\)/);
  assert.match(snapshotAdapterBlock, /pickTournamentTextTierlistProfileKills\(registration\)/);
  assert.ok(source.indexOf("const approvedKills = pickTournamentApprovedKills(profile, registration);", snapshotStart) > snapshotStart, "expected tournament snapshot to avoid zero-first kill fallback");
  assert.ok(operatorStart > snapshotStart, "expected operator wiring after snapshot adapter");
  assert.ok(source.indexOf("writeRobloxBinding:", operatorStart) > operatorStart, "expected tournament to write main Roblox lookups back to profile");
});
