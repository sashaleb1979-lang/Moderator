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

test("welcome-bot review approve flow defers early and guards duplicate clicks", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "welcome-bot.js"), "utf8");
  const branchStart = source.indexOf('if (action === "approve") {');
  const guardIndex = source.indexOf("if (reviewApprovalProcessingIds.has(submissionId)) {", branchStart);
  const addIndex = source.indexOf("reviewApprovalProcessingIds.add(submissionId);", guardIndex);
  const deferIndex = source.indexOf("const acked = await safeDeferEphemeralReply(interaction, {", addIndex);
  const claimSetIndex = source.indexOf("submission.approveClaim = { claimedBy: interaction.user.tag, claimedAt: nowIso() };", deferIndex);
  const saveIndex = source.indexOf("saveDb();", claimSetIndex);
  const progressIndex = source.indexOf('await interaction.editReply("Одобряю заявку. Не нажимай кнопку повторно.")', saveIndex);
  const detachedIndex = source.indexOf("runDetached(", progressIndex);
  const helperIndex = source.indexOf("() => processApprovalInteraction(client, interaction, submission, interaction.user.tag)", detachedIndex);
  const directApproveIndex = source.indexOf("await approveSubmission(client, submission, interaction.user.tag);", branchStart);

  assert.ok(branchStart >= 0, "expected onboarding review approve branch");
  assert.ok(guardIndex > branchStart, "expected duplicate approve guard before heavy processing");
  assert.ok(addIndex > guardIndex, "expected approve branch to claim processing state before ack");
  assert.ok(deferIndex > addIndex, "expected approve branch to ack before slow work");
  assert.ok(claimSetIndex > deferIndex, "expected durable approve claim only after the interaction is acknowledged");
  assert.ok(saveIndex > claimSetIndex, "expected durable approve claim to be saved after acknowledgement");
  assert.ok(progressIndex > deferIndex, "expected approve branch to send immediate progress text");
  assert.ok(detachedIndex > progressIndex, "expected approve branch to detach heavy processing");
  assert.ok(helperIndex > detachedIndex, "expected detached helper to own approve finalize");
  assert.equal(directApproveIndex, -1, "expected approve branch to avoid awaiting heavy approval inline");
});

test("welcome-bot approve flow persists and clears durable DB claim around detached processing", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "welcome-bot.js"), "utf8");
  const branchStart = source.indexOf('if (action === "approve") {');

  // durable claim check exists in handler
  const claimCheckIndex = source.indexOf("const existingClaim = submission.approveClaim;", branchStart);
  assert.ok(claimCheckIndex > branchStart, "expected durable claim check in approve handler");

  // in-memory guard exists before ack, durable claim after ack
  const addIndex = source.indexOf("reviewApprovalProcessingIds.add(submissionId);", claimCheckIndex);
  const deferIndex = source.indexOf("const acked = await safeDeferEphemeralReply(interaction, {", addIndex);
  const claimSetIndex = source.indexOf("submission.approveClaim = { claimedBy:", deferIndex);
  const saveClaimIndex = source.indexOf("saveDb();", claimSetIndex);
  assert.ok(addIndex > claimCheckIndex, "expected in-memory approve guard before ack");
  assert.ok(deferIndex > addIndex, "expected approve branch to acknowledge before durable save");
  assert.ok(claimSetIndex > deferIndex, "expected approveClaim to be set only after defer succeeds");
  assert.ok(saveClaimIndex > claimSetIndex, "expected durable claim save after claim assignment");

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

test("welcome-bot edit kills modal skips empty prefill values for broken legacy submissions", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "welcome-bot.js"), "utf8");
  const branchStart = source.indexOf('if (action === "edit") {');
  const normalizeIndex = source.indexOf('const currentKillsValue = String(submission.kills ?? "").trim();', branchStart);
  const guardIndex = source.indexOf("if (currentKillsValue) {", normalizeIndex);
  const setValueIndex = source.indexOf("input.setValue(currentKillsValue);", guardIndex);

  assert.ok(branchStart >= 0, "expected onboarding review edit branch");
  assert.ok(normalizeIndex > branchStart, "expected edit kills modal to normalize the current kills value");
  assert.ok(guardIndex > normalizeIndex, "expected edit kills modal to guard empty default values");
  assert.ok(setValueIndex > guardIndex, "expected edit kills modal to prefill only non-empty values");
});

test("welcome-bot reject flow defers before durable reject work", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "welcome-bot.js"), "utf8");
  const branchStart = source.indexOf('if (kind === "reject_reason") {');
  const reasonIndex = source.indexOf('const reason = String(interaction.fields.getTextInputValue("reason") || "").trim().slice(0, 800);', branchStart);
  const deferIndex = source.indexOf('const acked = await safeDeferEphemeralReply(interaction, {', reasonIndex);
  const rejectIndex = source.indexOf('await rejectSubmission(client, submission, interaction.user.tag, reason);', deferIndex);
  const successIndex = source.indexOf('await interaction.editReply("Заявка отклонена.").catch(() => {});', rejectIndex);

  assert.ok(branchStart >= 0, "expected onboarding review reject modal branch");
  assert.ok(reasonIndex > branchStart, "expected reject modal to read the reason before processing");
  assert.ok(deferIndex > reasonIndex, "expected reject modal to acknowledge before slow reject work");
  assert.ok(rejectIndex > deferIndex, "expected rejectSubmission to run only after defer succeeds");
  assert.ok(successIndex > rejectIndex, "expected success reply after rejectSubmission finishes");
});

test("welcome-bot tierlist refresh is coalesced via scheduleCoalescedTierlistRefresh", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "welcome-bot.js"), "utf8");

  assert.ok(source.includes("function scheduleCoalescedTierlistRefresh(client, source)"), "expected coalesced refresh helper defined");
  assert.ok(source.includes('scheduleCoalescedTierlistRefresh(client, "submit")'), "expected coalesced refresh on submit");
  assert.ok(source.includes('scheduleCoalescedTierlistRefresh(client, "approve")'), "expected coalesced refresh on approve");
  assert.ok(source.includes('scheduleCoalescedTierlistRefresh(client, "reject")'), "expected coalesced refresh on reject");
  assert.ok(source.includes('scheduleCoalescedTierlistRefresh(client, "expire")'), "expected coalesced refresh on expire");
});