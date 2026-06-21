"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("welcome-bot tournament Roblox snapshot uses the shared profile nickname base", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "welcome-bot.js"), "utf8");
  const snapshotStart = source.indexOf("function getTournamentPlayerSnapshot(userId) {");
  const operatorStart = source.indexOf("function getTournamentOperator() {");

  assert.match(
    source,
    /const \{[\s\S]*normalizeRobloxDomainState,[\s\S]*resolveUsableVerifiedRobloxIdentity,[\s\S]*\} = require\("\.\/src\/integrations\/shared-profile"\);/
  );
  assert.ok(snapshotStart >= 0, "expected tournament snapshot adapter");
  assert.ok(source.indexOf("profile.summary?.roblox", snapshotStart) > snapshotStart, "expected tournament to read summary Roblox state");
  assert.ok(source.indexOf("profile.robloxUsername", snapshotStart) > snapshotStart, "expected tournament to read legacy Roblox nick state");
  assert.ok(source.indexOf("normalizeRobloxDomainState(entry)", snapshotStart) > snapshotStart, "expected canonical Roblox normalization");
  assert.ok(source.indexOf("resolveUsableVerifiedRobloxIdentity(entry)", snapshotStart) > snapshotStart, "expected verified identity resolver");
  assert.ok(operatorStart > snapshotStart, "expected operator wiring after snapshot adapter");
  assert.ok(source.indexOf("writeRobloxBinding:", operatorStart) > operatorStart, "expected tournament to write main Roblox lookups back to profile");
});
