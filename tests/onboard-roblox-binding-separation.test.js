"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function sliceFunction(source, pattern, label) {
  const match = source.match(pattern);
  assert.ok(match, `expected to find function slice for ${label}`);
  return match[0];
}

test("welcome-bot keeps pending onboarding Roblox state out of the canonical binding seam", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "welcome-bot.js"), "utf8");
  const createPendingSlice = sliceFunction(
    source,
    /async function createPendingSubmissionFromAttachment\(client, input\) \{[\s\S]*?(?=\r?\nasync function processPendingSubmissionMessage\(client, message, options\) \{)/,
    "createPendingSubmissionFromAttachment"
  );
  const rejectSlice = sliceFunction(
    source,
    /async function rejectSubmission\(client, submission, moderatorTag, reason\) \{[\s\S]*?(?=\r?\nasync function updateSubmissionKills\(client, submission, kills, moderatorTag\) \{)/,
    "rejectSubmission"
  );
  const updatePendingSlice = sliceFunction(
    source,
    /async function updatePendingSubmissionRobloxIdentity\(client, submission, robloxUser, moderatorTag = null\) \{[\s\S]*?(?=\r?\nasync function createManualApprovedRecord\(client, targetUser, screenshotAttachment, kills, moderatorTag\) \{)/,
    "updatePendingSubmissionRobloxIdentity"
  );
  const approveSlice = sliceFunction(
    source,
    /async function approveSubmission\(client, submission, moderatorTag\) \{[\s\S]*?(?=\r?\nasync function processApprovalInteraction\(client, interaction, submission, moderatorTag\) \{)/,
    "approveSubmission"
  );

  assert.doesNotMatch(createPendingSlice, /writeCanonicalRobloxBinding\s*\(/);
  assert.doesNotMatch(rejectSlice, /writeCanonicalRobloxBinding\s*\(/);
  assert.doesNotMatch(updatePendingSlice, /writeCanonicalRobloxBinding\s*\(/);
  assert.match(updatePendingSlice, /writePendingSubmissionRobloxIdentity\s*\(/);
  assert.match(approveSlice, /writeCanonicalRobloxBinding\s*\(/);
});