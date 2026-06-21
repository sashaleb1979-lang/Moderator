"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  ONBOARD_ACCESS_MODES,
  normalizeOnboardAccessMode,
  shouldPreserveNormalAccessDuringWartime,
} = require("../src/onboard/access-mode");

const welcomeBotSource = fs.readFileSync(path.join(__dirname, "..", "welcome-bot.js"), "utf8");

function sliceFunction(startToken, endToken, label) {
  const startIndex = welcomeBotSource.indexOf(startToken);
  const endIndex = welcomeBotSource.indexOf(endToken, startIndex);

  assert.ok(startIndex >= 0 && endIndex > startIndex, `expected to find ${label} in welcome-bot.js`);
  return welcomeBotSource.slice(startIndex, endIndex).trimEnd();
}

function loadApproveSubmission() {
  const functionSource = sliceFunction(
    "async function approveSubmission(client, submission, moderatorTag) {",
    "async function processApprovalInteraction(client, interaction, submission, moderatorTag) {",
    "approveSubmission"
  );

  return new Function(
    "killTierFor",
    "getProfile",
    "buildProfileRobloxIdentitySession",
    "refreshDerivedProfileMainFields",
    "cloneJsonValue",
    "nowIso",
    "writeCanonicalRobloxBinding",
    "appendProofWindowSnapshot",
    "saveDb",
    "flushDbNow",
    "restoreRecordValue",
    "db",
    "fetchReviewMessage",
    "buildReviewEmbed",
    "formatRuntimeError",
    "dmUser",
    "logLine",
    "formatTierLabel",
    "scheduleCoalescedTierlistRefresh",
    "syncApprovedSubmissionRoles",
    "normalizeApprovedRoleSyncWarnings",
    `return (${functionSource});`
  );
}

function loadProcessApprovalInteraction() {
  const functionSource = sliceFunction(
    "async function processApprovalInteraction(client, interaction, submission, moderatorTag) {",
    "async function rejectSubmission(client, submission, moderatorTag, reason) {",
    "processApprovalInteraction"
  );

  return new Function(
    "approveSubmission",
    "normalizeApprovedRoleSyncWarnings",
    "formatRuntimeError",
    "reviewApprovalProcessingIds",
    "db",
    "saveDb",
    `return (${functionSource});`
  );
}

function loadSyncApprovedAccessRoles() {
  const functionSource = sliceFunction(
    "async function syncApprovedAccessRoles(client, targetUserId = null, options = {}) {",
    "function createAccessCompanionSyncSummary() {",
    "syncApprovedAccessRoles"
  );

  return new Function(
    "createApprovedAccessSyncSummary",
    "db",
    "fetchMember",
    "getManagedStartAccessRoleIds",
    "getGrantedAccessRoleIdForMode",
    "getCurrentOnboardMode",
    "grantAccessRole",
    "nowIso",
    "formatRuntimeError",
    "saveDb",
    `return (${functionSource});`
  );
}

function loadGrantAccessRole() {
  const functionSource = sliceFunction(
    "async function grantAccessRole(client, userId, reason = \"welcome application submitted\") {",
    "async function maybeGrantAccessRoleAtStage(client, userId, stage, reason = \"welcome application submitted\") {",
    "grantAccessRole"
  );

  return new Function(
    "fetchMember",
    "getCurrentOnboardMode",
    "getOnboardModeValidationError",
    "getGrantedAccessRoleIdForMode",
    "normalizeOnboardAccessMode",
    "ONBOARD_ACCESS_MODES",
    "getManagedStartAccessRoleIds",
    "getVerificationQuarantineRoleIds",
    "getAccessCompanionRoleId",
    "getRolePoolSnapshot",
    "restoreRolePoolSnapshot",
    "ensureAccessCompanionRoleForMemberBestEffort",
    "formatRuntimeError",
    "getNormalAccessRoleId",
    "shouldPreserveNormalAccessDuringWartime",
    `return (${functionSource});`
  );
}

test("welcome-bot wires approved access repair into startup and panel role sync flows", () => {
  assert.match(welcomeBotSource, /panel_sync_roles[\s\S]*?syncApprovedAccessRoles\(client, null,/);
  assert.match(welcomeBotSource, /runClientReadyCore\(client, \{[\s\S]*?syncApprovedAccessRoles:/);
});

function buildWartimeGrantAccessRole(member, calls) {
  const buildGrantAccessRole = loadGrantAccessRole();
  return buildGrantAccessRole(
    async () => member,
    () => ONBOARD_ACCESS_MODES.WARTIME,
    () => "",
    () => "wartime-role",
    normalizeOnboardAccessMode,
    ONBOARD_ACCESS_MODES,
    () => ["base-role", "wartime-role"],
    () => ["base-role", "wartime-role", "nonjjs-role"],
    () => "companion-role",
    (currentMember, roleIds) => [...roleIds].filter((roleId) => currentMember.roles.cache.has(roleId)),
    async () => {
      throw new Error("rollback should not run");
    },
    async () => {
      calls.push(["companion"]);
    },
    (error) => String(error?.message || error),
    () => "base-role",
    shouldPreserveNormalAccessDuringWartime
  );
}

function buildRoleMember(roleIds, calls) {
  const roleState = new Map(roleIds.map((roleId) => [roleId, { id: roleId }]));
  return {
    id: "user-1",
    roleState,
    roles: {
      cache: roleState,
      async remove(roleId, reason) {
        calls.push(["remove", roleId, reason]);
        roleState.delete(roleId);
      },
      async add(roleId, reason) {
        calls.push(["add", roleId, reason]);
        roleState.set(roleId, { id: roleId });
      },
    },
  };
}

test("grantAccessRole in wartime grants only the wartime access role for new members", async () => {
  const calls = [];
  // Newcomer arriving during wartime: holds no full access role yet.
  const member = buildRoleMember(["nonjjs-role", "companion-role"], calls);
  const grantAccessRole = buildWartimeGrantAccessRole(member, calls);

  const granted = await grantAccessRole({}, "user-1", "wartime auto grant");

  assert.equal(granted, true);
  assert.deepEqual([...member.roleState.keys()].sort(), ["wartime-role"]);
  assert.deepEqual(calls, [
    ["remove", "nonjjs-role", "wartime auto grant"],
    ["remove", "companion-role", "wartime auto grant"],
    ["add", "wartime-role", "wartime auto grant"],
  ]);
});

test("grantAccessRole in wartime never downgrades an established normal-access holder", async () => {
  const calls = [];
  // Long-standing member who already passed onboarding and holds the full normal access
  // role — resubmitting kills during wartime must not strip it or swap to the wartime role.
  const member = buildRoleMember(["base-role", "companion-role"], calls);
  const grantAccessRole = buildWartimeGrantAccessRole(member, calls);

  const granted = await grantAccessRole({}, "user-1", "kills refresh");

  assert.equal(granted, true);
  // Roles are untouched apart from the best-effort companion ensure (a no-op add here).
  assert.deepEqual([...member.roleState.keys()].sort(), ["base-role", "companion-role"]);
  assert.deepEqual(calls, [["companion"]]);
});

test("approveSubmission saves approval state before best-effort role sync warnings", async () => {
  const db = {
    submissions: {},
    profiles: {},
  };
  const submission = {
    id: "sub-1",
    userId: "user-1",
    mainCharacterIds: ["gojo"],
    displayName: "User One",
    username: "userone",
    kills: 321,
    status: "pending",
    robloxUsername: "RobloxUser",
    robloxUserId: "42",
    approveClaim: { claimedBy: "Mod#1" },
  };
  const profile = { userId: "user-1" };
  db.submissions[submission.id] = submission;
  db.profiles[submission.userId] = profile;

  const snapshots = [];
  const buildApproveSubmission = loadApproveSubmission();
  const approveSubmission = buildApproveSubmission(
    () => 4,
    () => profile,
    () => ({ robloxUsername: "", robloxUserId: "", robloxDisplayName: "" }),
    () => {},
    (value) => JSON.parse(JSON.stringify(value || null)),
    () => "2026-05-30T12:00:00.000Z",
    (_userId, currentProfile) => {
      currentProfile.domains = { roblox: { username: "RobloxUser", userId: "42" } };
      return { snapshot: { username: "RobloxUser", userId: "42" } };
    },
    () => {},
    () => {
      snapshots.push({
        submissionStatus: submission.status,
        profileStatus: profile.lastSubmissionStatus,
      });
    },
    async () => {},
    (collection, key, value) => {
      collection[key] = value;
    },
    db,
    async () => null,
    () => ({}),
    (error) => String(error?.message || error),
    async () => {},
    async () => {},
    () => "Tier 4",
    () => {},
    async () => {
      assert.equal(snapshots.length, 1, "expected durable approval save before role sync starts");
      assert.deepEqual(snapshots[0], {
        submissionStatus: "approved",
        profileStatus: "approved",
      });
      return { warnings: ["tier-role: missing perms"] };
    },
    (roleSync) => Array.isArray(roleSync?.warnings) ? roleSync.warnings.filter(Boolean) : []
  );

  const result = await approveSubmission({}, submission, "Mod#1");

  assert.equal(submission.status, "approved");
  assert.equal(profile.lastSubmissionStatus, "approved");
  assert.equal(snapshots.length, 1);
  assert.deepEqual(result.warnings, ["tier-role: missing perms"]);
  assert.equal("approveClaim" in submission, false);
});

test("approveSubmission preserves an already verified Roblox binding during kills-only approval", async () => {
  const db = {
    submissions: {},
    profiles: {},
  };
  const submission = {
    id: "sub-2",
    userId: "user-2",
    mainCharacterIds: ["gojo"],
    displayName: "User Two",
    username: "usertwo",
    kills: 777,
    status: "pending",
    robloxUsername: "OldSnapshot",
    robloxUserId: "42",
    approveClaim: { claimedBy: "Mod#2" },
  };
  const profile = {
    userId: "user-2",
    domains: {
      roblox: {
        username: "CurrentVerified",
        userId: "999",
        verificationStatus: "verified",
      },
    },
  };
  db.submissions[submission.id] = submission;
  db.profiles[submission.userId] = profile;

  let writeCalls = 0;
  const proofSnapshots = [];
  const buildApproveSubmission = loadApproveSubmission();
  const approveSubmission = buildApproveSubmission(
    () => 2,
    () => profile,
    (source) => ({
      robloxUsername: String(source?.username || source?.robloxUsername || "").trim(),
      robloxUserId: String(source?.userId || source?.robloxUserId || "").trim(),
      robloxDisplayName: String(source?.displayName || source?.robloxDisplayName || "").trim(),
    }),
    () => {},
    (value) => JSON.parse(JSON.stringify(value || null)),
    () => "2026-06-02T12:00:00.000Z",
    () => {
      writeCalls += 1;
      throw new Error("existing verified Roblox binding should not be overwritten");
    },
    (_targetProfile, snapshot) => {
      proofSnapshots.push(snapshot);
    },
    () => {},
    async () => {},
    (collection, key, value) => {
      collection[key] = value;
    },
    db,
    async () => null,
    () => ({}),
    (error) => String(error?.message || error),
    async () => {},
    async () => {},
    () => "Tier 2",
    () => {},
    async () => ({ warnings: [] }),
    (roleSync) => Array.isArray(roleSync?.warnings) ? roleSync.warnings.filter(Boolean) : []
  );

  await approveSubmission({}, submission, "Mod#2");

  assert.equal(writeCalls, 0);
  assert.equal(profile.domains.roblox.username, "CurrentVerified");
  assert.equal(profile.domains.roblox.userId, "999");
  assert.equal(proofSnapshots.length, 1);
  assert.equal(proofSnapshots[0].approvedKills, 777);
});

test("processApprovalInteraction surfaces degraded role sync warnings and clears durable claim state", async () => {
  const replies = [];
  const db = {
    submissions: {
      "sub-1": {
        id: "sub-1",
        approveClaim: { claimedBy: "Mod#1" },
      },
    },
  };
  const submission = db.submissions["sub-1"];
  const reviewApprovalProcessingIds = new Set([submission.id]);
  let saveCalls = 0;

  const buildProcessApprovalInteraction = loadProcessApprovalInteraction();
  const processApprovalInteraction = buildProcessApprovalInteraction(
    async () => ({ warnings: ["tier-role: missing perms"] }),
    (roleSync) => Array.isArray(roleSync?.warnings) ? roleSync.warnings.filter(Boolean) : [],
    (error) => String(error?.message || error),
    reviewApprovalProcessingIds,
    db,
    () => {
      saveCalls += 1;
    }
  );

  await processApprovalInteraction({}, {
    async editReply(message) {
      replies.push(message);
    },
  }, submission, "Mod#1");

  assert.equal(replies.length, 1);
  assert.match(replies[0], /Заявка одобрена, но синхронизация ролей завершилась с предупреждениями:/);
  assert.equal(reviewApprovalProcessingIds.has(submission.id), false);
  assert.equal("approveClaim" in db.submissions[submission.id], false);
  assert.equal(saveCalls, 1);
});

test("manual approve path surfaces degraded role sync warnings instead of unconditional success", () => {
  assert.match(welcomeBotSource, /manualApproval = await createManualApprovedRecord\(client, target, screenshot, kills, interaction\.user\.tag\);/);
  assert.match(welcomeBotSource, /const manualWarnings = normalizeApprovedRoleSyncWarnings\(manualApproval\?\.roleSync\);/);
  assert.match(welcomeBotSource, /Профиль одобрен для <@\$\{target\.id\}>: kills \$\{kills\}, tier \$\{killTierFor\(kills\)\}\. Но синхронизация ролей завершилась с предупреждениями:/);
});

test("approveSubmission DM warns the user when role sync completes with warnings", () => {
  assert.match(welcomeBotSource, /Синхронизация ролей завершилась с предупреждением\. Если роль не появилась сразу, модератор досинхронизирует её отдельно\./);
});

test("syncApprovedAccessRoles does not grant missing onboarding access during bulk sync", async () => {
  const db = {
    profiles: {
      "user-missing": { lastSubmissionStatus: "approved" },
      "user-present": { lastSubmissionStatus: "approved" },
      "user-pending": { lastSubmissionStatus: "pending" },
    },
  };
  const targetRoleId = "access-normal";
  const members = {
    "user-missing": { roles: { cache: new Map() } },
    "user-present": { roles: { cache: new Map([[targetRoleId, { id: targetRoleId }]]) } },
  };
  const grantCalls = [];
  let saveCalls = 0;

  const buildSyncApprovedAccessRoles = loadSyncApprovedAccessRoles();
  const syncApprovedAccessRoles = buildSyncApprovedAccessRoles(
    () => ({ processed: 0, granted: 0, alreadyHad: 0, missingMembers: 0, failed: 0, updatedProfiles: 0 }),
    db,
    async (_client, userId) => members[userId] || null,
    () => [targetRoleId, "access-wartime"],
    () => targetRoleId,
    () => "normal",
    async (_client, userId, reason) => {
      grantCalls.push([userId, reason]);
      members[userId].roles.cache.set(targetRoleId, { id: targetRoleId });
      return true;
    },
    () => "2026-05-30T12:00:00.000Z",
    (error) => String(error?.message || error),
    () => {
      saveCalls += 1;
    }
  );

  const result = await syncApprovedAccessRoles({}, null, { reason: "startup approved access sync" });

  assert.deepEqual(grantCalls, []);
  assert.equal(db.profiles["user-missing"].accessGrantedAt, undefined);
  assert.equal(db.profiles["user-present"].accessGrantedAt, "2026-05-30T12:00:00.000Z");
  assert.equal(db.profiles["user-pending"].accessGrantedAt, undefined);
  assert.equal(saveCalls, 1);
  assert.deepEqual(result, {
    processed: 2,
    granted: 0,
    alreadyHad: 1,
    missingMembers: 0,
    failed: 1,
    updatedProfiles: 1,
  });
});

test("syncApprovedAccessRoles does not convert existing normal access during wartime bulk sync", async () => {
  const db = {
    profiles: {
      "user-normal": { lastSubmissionStatus: "approved" },
    },
  };
  const normalRoleId = "access-normal";
  const wartimeRoleId = "access-wartime";
  const member = {
    roles: {
      cache: new Map([[normalRoleId, { id: normalRoleId }]]),
    },
  };
  let saveCalls = 0;

  const buildSyncApprovedAccessRoles = loadSyncApprovedAccessRoles();
  const syncApprovedAccessRoles = buildSyncApprovedAccessRoles(
    () => ({ processed: 0, granted: 0, alreadyHad: 0, missingMembers: 0, failed: 0, updatedProfiles: 0 }),
    db,
    async () => member,
    () => [normalRoleId, wartimeRoleId],
    () => wartimeRoleId,
    () => ONBOARD_ACCESS_MODES.WARTIME,
    async () => {
      throw new Error("bulk sync must not migrate normal access to wartime");
    },
    () => "2026-06-07T08:30:00.000Z",
    (error) => String(error?.message || error),
    () => {
      saveCalls += 1;
    }
  );

  const result = await syncApprovedAccessRoles({}, null, { reason: "startup approved access sync" });

  assert.deepEqual([...member.roles.cache.keys()], [normalRoleId]);
  assert.equal(db.profiles["user-normal"].accessGrantedAt, "2026-06-07T08:30:00.000Z");
  assert.equal(saveCalls, 1);
  assert.deepEqual(result, {
    processed: 1,
    granted: 0,
    alreadyHad: 1,
    missingMembers: 0,
    failed: 0,
    updatedProfiles: 1,
  });
});
