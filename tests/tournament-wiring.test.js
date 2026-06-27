"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("welcome-bot tournament Roblox snapshot uses the shared profile nickname base", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "welcome-bot.js"), "utf8");
  const snapshotStart = source.indexOf("async function getTournamentPlayerSnapshot(userId, options = {}) {");
  const operatorStart = source.indexOf("function getTournamentOperator() {");
  const snapshotAdapterBlock = source.slice(Math.max(0, snapshotStart - 6000), operatorStart);

  assert.match(
    source,
    /const \{[\s\S]*normalizeRobloxDomainState,[\s\S]*resolveUsableVerifiedRobloxIdentity,[\s\S]*\} = require\("\.\/src\/integrations\/shared-profile"\);/
  );
  assert.ok(snapshotStart >= 0, "expected tournament snapshot adapter");
  assert.match(source, /profile\.summary\?\.roblox/);
  assert.match(source, /profile\.robloxUsername/);
  assert.match(source, /normalizeRobloxDomainState\(entry\)/);
  assert.match(source, /resolveUsableVerifiedRobloxIdentity\(entry\)/);
  assert.match(snapshotAdapterBlock, /function pickTournamentApprovedKills/);
  assert.match(source, /function findTournamentProfileByRegistration/);
  assert.match(snapshotAdapterBlock, /function pickTournamentTextTierlistProfileKills/);
  assert.match(snapshotAdapterBlock, /function pickTournamentRecentSubmissionKills/);
  assert.match(snapshotAdapterBlock, /getApprovedTierlistEntries\(\)/);
  assert.match(snapshotAdapterBlock, /normalizeTournamentRobloxUsername\(registration\?\.robloxUsername\)/);
  assert.match(snapshotAdapterBlock, /pickTournamentApprovedSubmissionKills\(profile, registration\)/);
  assert.match(snapshotAdapterBlock, /pickTournamentTextTierlistProfileKills\(registration\)/);
  assert.match(snapshotAdapterBlock, /pickTournamentRecentSubmissionKills\(registration\)/);
  assert.match(snapshotAdapterBlock, /resolveTournamentProofImageUrl\(profile, snapshotRegistration\)/);
  assert.match(snapshotAdapterBlock, /resolveTournamentSubmissionImageUrl\(proofSubmission\)/);
  assert.match(source, /async function buildTournamentProofMedia\(url, includeFile\)/);
  assert.match(source, /const buffer = await downloadToBuffer\(liveUrl\);/);
  assert.match(source, /lastScreenshotUrl: `attachment:\/\/\$\{filename\}`/);
  assert.match(source, /lastScreenshotBuffer: buffer/);
  assert.match(source, /lastScreenshotUnavailable: true/);
  assert.match(source, /reviewImage\.startsWith\("attachment:\/\/"\)/);
  assert.match(source, /fetchReviewMessage\(client, submission\)/);
  assert.match(source, /submission\.reviewAttachmentUrl = fresh/);
  assert.match(snapshotAdapterBlock, /const snapshotRegistration = \{ \.\.\.registration, userId: registration\.userId \|\| userId \};/);
  assert.match(snapshotAdapterBlock, /submission\.status === "rejected"/);
  assert.ok(source.indexOf("const approvedKills = pickTournamentApprovedKills(profile, snapshotRegistration);", snapshotStart) > snapshotStart, "expected tournament snapshot to avoid zero-first kill fallback");
  assert.ok(operatorStart > snapshotStart, "expected operator wiring after snapshot adapter");
  assert.match(source.slice(operatorStart, operatorStart + 1000), /createTournamentOperator\(\{\s*db,\s*appConfig,/);
  assert.ok(source.indexOf("writeRobloxBinding:", operatorStart) > operatorStart, "expected tournament to write main Roblox lookups back to profile");
});
