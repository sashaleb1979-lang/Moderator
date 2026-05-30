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

test("welcome-bot approval flow preflights roles before mutating submission state", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "welcome-bot.js"), "utf8");
  const preflightStart = source.indexOf("async function preflightSubmissionApprovalRoles(client, submission, profile = null) {");
  const approveStart = source.indexOf("async function approveSubmission(client, submission, moderatorTag) {");
  const preflightCallIndex = source.indexOf("await preflightSubmissionApprovalRoles(client, submission, profile);", approveStart);
  const ensureTierIndex = source.indexOf('await ensureSingleTierRole(client, submission.userId, tier, "approved welcome submission");', approveStart);
  const approvedStatusIndex = source.indexOf('submission.status = "approved";', approveStart);

  assert.ok(preflightStart >= 0, "expected approval role preflight helper to exist");
  assert.ok(preflightCallIndex > approveStart, "expected approveSubmission to call role preflight");
  assert.ok(ensureTierIndex > preflightCallIndex, "expected role mutations to start after preflight");
  assert.ok(approvedStatusIndex > preflightCallIndex, "expected submission status mutation after preflight");
});

test("welcome-bot approval flow rolls back db state when post-preflight work fails", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "welcome-bot.js"), "utf8");
  const approveStart = source.indexOf("async function approveSubmission(client, submission, moderatorTag) {");
  const tryIndex = source.indexOf("try {", approveStart);
  const ensureTierIndex = source.indexOf('await ensureSingleTierRole(client, submission.userId, tier, "approved welcome submission");', approveStart);
  const accessGrantIndex = source.indexOf('await maybeGrantAccessRoleAtStage(client, submission.userId, ONBOARD_ACCESS_GRANT_MODES.AFTER_APPROVE, "welcome submission approved");', approveStart);
  const restoreSubmissionIndex = source.indexOf("restoreRecordValue(db.submissions, submission.id, previousSubmission, true);", approveStart);
  const restoreProfileIndex = source.indexOf("restoreRecordValue(db.profiles, submission.userId, previousProfile, true);", approveStart);

  assert.ok(tryIndex > approveStart, "expected approveSubmission to wrap post-preflight work in try/catch");
  assert.ok(ensureTierIndex > tryIndex, "expected tier role mutation inside rollback guard");
  assert.ok(accessGrantIndex > tryIndex, "expected access role mutation inside rollback guard");
  assert.ok(restoreSubmissionIndex > accessGrantIndex, "expected submission rollback after post-preflight work");
  assert.ok(restoreProfileIndex > restoreSubmissionIndex, "expected profile rollback after submission rollback");
});

test("welcome-bot review approve flow defers early and guards duplicate clicks", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "welcome-bot.js"), "utf8");
  const branchStart = source.indexOf('if (action === "approve") {');
  const guardIndex = source.indexOf("if (reviewApprovalProcessingIds.has(submissionId)) {", branchStart);
  const addIndex = source.indexOf("reviewApprovalProcessingIds.add(submissionId);", guardIndex);
  const deferIndex = source.indexOf("const acked = await safeDeferEphemeralReply(interaction, {", addIndex);
  const progressIndex = source.indexOf('await interaction.editReply("Одобряю заявку. Не нажимай кнопку повторно.")', deferIndex);
  const detachedIndex = source.indexOf("runDetached(", progressIndex);
  const helperIndex = source.indexOf("() => processApprovalInteraction(client, interaction, submission, interaction.user.tag)", detachedIndex);
  const directApproveIndex = source.indexOf("await approveSubmission(client, submission, interaction.user.tag);", branchStart);

  assert.ok(branchStart >= 0, "expected onboarding review approve branch");
  assert.ok(guardIndex > branchStart, "expected duplicate approve guard before heavy processing");
  assert.ok(addIndex > guardIndex, "expected approve branch to claim processing state before ack");
  assert.ok(deferIndex > addIndex, "expected approve branch to ack before slow work");
  assert.ok(progressIndex > deferIndex, "expected approve branch to send immediate progress text");
  assert.ok(detachedIndex > progressIndex, "expected approve branch to detach heavy processing");
  assert.ok(helperIndex > detachedIndex, "expected detached helper to own approve finalize");
  assert.equal(directApproveIndex, -1, "expected approve branch to avoid awaiting heavy approval inline");
});

test("welcome-bot approve flow uses durable DB claim before heavy processing", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "welcome-bot.js"), "utf8");
  const branchStart = source.indexOf('if (action === "approve") {');

  // durable claim check exists in handler
  const claimCheckIndex = source.indexOf("const existingClaim = submission.approveClaim;", branchStart);
  assert.ok(claimCheckIndex > branchStart, "expected durable claim check in approve handler");

  // claim set on submission before safeDeferEphemeralReply
  const claimSetIndex = source.indexOf("submission.approveClaim = { claimedBy:", claimCheckIndex);
  const deferIndex = source.indexOf("const acked = await safeDeferEphemeralReply(interaction, {", claimCheckIndex);
  assert.ok(claimSetIndex > claimCheckIndex, "expected approveClaim to be set before ack");
  assert.ok(claimSetIndex < deferIndex, "expected approveClaim to be set before defer");

  // claim deleted inside approveSubmission before saveDb
  const approveStart = source.indexOf("async function approveSubmission(client, submission, moderatorTag)");
  const deleteClaimIndex = source.indexOf("delete submission.approveClaim;", approveStart);
  const saveInApproveIndex = source.indexOf("saveDb();", deleteClaimIndex);
  assert.ok(deleteClaimIndex > approveStart, "expected approveClaim cleared inside approveSubmission before save");
  assert.ok(saveInApproveIndex > deleteClaimIndex, "expected saveDb after delete claim in approveSubmission");

  // finally block in processApprovalInteraction cleans up DB claim
  const finallyIndex = source.indexOf("reviewApprovalProcessingIds.delete(submission.id);");
  const liveSubIndex = source.indexOf("db.submissions[submission.id]", finallyIndex);
  assert.ok(liveSubIndex > finallyIndex, "expected DB claim cleanup in processApprovalInteraction finally");

  // startup cleanup function exists
  assert.ok(source.includes("function clearStaleApproveClaims()"), "expected clearStaleApproveClaims function at startup");
  assert.ok(source.includes("clearStaleApproveClaims();"), "expected clearStaleApproveClaims to be called at startup");
});

test("welcome-bot tierlist refresh is coalesced via scheduleCoalescedTierlistRefresh", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "welcome-bot.js"), "utf8");

  assert.ok(source.includes("function scheduleCoalescedTierlistRefresh(client, source)"), "expected coalesced refresh helper defined");
  assert.ok(source.includes('scheduleCoalescedTierlistRefresh(client, "submit")'), "expected coalesced refresh on submit");
  assert.ok(source.includes('scheduleCoalescedTierlistRefresh(client, "approve")'), "expected coalesced refresh on approve");
  assert.ok(source.includes('scheduleCoalescedTierlistRefresh(client, "reject")'), "expected coalesced refresh on reject");
  assert.ok(source.includes('scheduleCoalescedTierlistRefresh(client, "expire")'), "expected coalesced refresh on expire");
});