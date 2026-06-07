"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function loadPostVerificationManualReport() {
  const source = fs.readFileSync(path.join(__dirname, "..", "welcome-bot.js"), "utf8");
  const startToken = "async function postVerificationManualReport(client, userId, statusNote = \"\", options = {}) {";
  const endToken = "\nasync function ensureVerificationEntryMessage(client) {";
  const startIndex = source.indexOf(startToken);
  const endIndex = source.indexOf(endToken, startIndex);

  assert.ok(startIndex >= 0 && endIndex > startIndex, "expected to find postVerificationManualReport in welcome-bot.js");
  const functionSource = source.slice(startIndex, endIndex).trimEnd();

  return new Function(
    "resolveVerificationReportChannel",
    "finalizeStoredProfile",
    "createVerificationAuditAttachment",
    "buildVerificationReportPayload",
    "buildVerificationDegradedReportPayload",
    "logVerificationRuntimeEvent",
    "cleanVerificationText",
    `return (${functionSource});`
  );
}

function loadHandleVerificationManualReviewCallback() {
  const source = fs.readFileSync(path.join(__dirname, "..", "welcome-bot.js"), "utf8");
  const startToken = "async function handleVerificationManualReviewCallback(client, payload = {}) {";
  const endToken = "\nasync function handleVerificationFailedCallback(client, payload = {}) {";
  const startIndex = source.indexOf(startToken);
  const endIndex = source.indexOf(endToken, startIndex);

  assert.ok(startIndex >= 0 && endIndex > startIndex, "expected to find handleVerificationManualReviewCallback in welcome-bot.js");
  const functionSource = source.slice(startIndex, endIndex).trimEnd();

  return new Function(
    "cleanVerificationText",
    "reconcileVerificationAssignmentForMember",
    "logVerificationRuntimeEvent",
    "updateVerificationProfile",
    "buildVerificationOauthUsername",
    "normalizeVerificationObservedGuilds",
    "postVerificationManualReport",
    "grantVerificationTemporaryReviewAccess",
    "nowIso",
    `return (${functionSource});`
  );
}

function loadHandleVerificationApprovedCallback() {
  const source = fs.readFileSync(path.join(__dirname, "..", "welcome-bot.js"), "utf8");
  const startToken = "async function handleVerificationApprovedCallback(client, payload = {}) {";
  const endToken = "\nasync function handleVerificationManualReviewCallback(client, payload = {}) {";
  const startIndex = source.indexOf(startToken);
  const endIndex = source.indexOf(endToken, startIndex);

  assert.ok(startIndex >= 0 && endIndex > startIndex, "expected to find handleVerificationApprovedCallback in welcome-bot.js");
  const functionSource = source.slice(startIndex, endIndex).trimEnd();

  return new Function(
    "cleanVerificationText",
    "reconcileVerificationAssignmentForMember",
    "logVerificationRuntimeEvent",
    "updateVerificationProfile",
    "buildVerificationOauthUsername",
    "normalizeVerificationObservedGuilds",
    "grantVerificationTemporaryReviewAccess",
    "postVerificationManualReport",
    "nowIso",
    `return (${functionSource});`
  );
}

function loadRunVerificationDeadlineSweep() {
  const source = fs.readFileSync(path.join(__dirname, "..", "welcome-bot.js"), "utf8");
  const startToken = "async function runVerificationDeadlineSweep(client) {";
  const endToken = "\nasync function handleVerificationApprovedCallback(client, payload = {}) {";
  const startIndex = source.indexOf(startToken);
  const endIndex = source.indexOf(endToken, startIndex);

  assert.ok(startIndex >= 0 && endIndex > startIndex, "expected to find runVerificationDeadlineSweep in welcome-bot.js");
  const functionSource = source.slice(startIndex, endIndex).trimEnd();

  return new Function(
    "isVerificationEnabled",
    "db",
    "finalizeStoredProfile",
    "reconcileVerificationAssignmentForMember",
    "cleanVerificationText",
    "postVerificationManualReport",
    "updateVerificationProfile",
    "nowIso",
    "logVerificationRuntimeEvent",
    `return (${functionSource});`
  );
}

function loadHandleVerificationEntryStartInteraction() {
  const source = fs.readFileSync(path.join(__dirname, "..", "welcome-bot.js"), "utf8");
  const startToken = "async function handleVerificationEntryStartInteraction(client, interaction) {";
  const endToken = "\nasync function startAnalyticsRuntime(client) {";
  const startIndex = source.indexOf(startToken);
  const endIndex = source.indexOf(endToken, startIndex);

  assert.ok(startIndex >= 0 && endIndex > startIndex, "expected to find handleVerificationEntryStartInteraction in welcome-bot.js");
  const functionSource = source.slice(startIndex, endIndex).trimEnd();

  return new Function(
    "isVerificationEnabled",
    "isVerificationOauthConfigured",
    "getVerifyAccessRoleId",
    "cleanVerificationText",
    "ephemeralPayload",
    "MessageFlags",
    "fetchMember",
    "reconcileVerificationAssignmentForMember",
    "memberHasVerificationRole",
    "formatRoleMention",
    "verificationCallbackServer",
    "startVerificationRuntime",
    "nowIso",
    "ensureVerificationPendingProfile",
    "computeVerificationReportDueAt",
    "createVerificationOauthState",
    "logVerificationRuntimeEvent",
    "formatVerificationStateLogToken",
    "buildDiscordOAuthAuthorizeUrl",
    "getVerificationIntegrationState",
    "buildVerificationLaunchPayload",
    "buildVerificationStatusText",
    `return (${functionSource});`
  );
}

test("postVerificationManualReport falls back to degraded payload when rich report send fails", async () => {
  const calls = [];
  let sendAttempt = 0;
  const buildFunction = loadPostVerificationManualReport();
  const postVerificationManualReport = buildFunction(
    async () => ({
      id: "report-room",
      async send(payload) {
        sendAttempt += 1;
        calls.push(["send", sendAttempt, payload]);
        if (sendAttempt === 1) {
          throw new Error("embed too large");
        }
        return { id: `message-${sendAttempt}` };
      },
    }),
    () => ({ userId: "user-1", domains: { verification: {} }, summary: { verification: {} } }),
    () => ({ name: "verification-audit-user-1.md" }),
    () => ({ embeds: [{ title: "rich-report" }], files: ["audit"], components: ["buttons"] }),
    (options) => ({ content: `fallback:${options.userId}:${options.fallbackError}`, components: ["buttons"] }),
    async (_client, message, level = "info") => {
      calls.push(["log", level, message]);
    },
    (value, max) => String(value || "").trim().slice(0, max || 400)
  );

  const result = await postVerificationManualReport({}, "user-1", "note");

  assert.equal(result.degraded, true);
  assert.equal(calls[0][0], "send");
  assert.ok(calls[0][2].embeds);
  assert.equal(calls[1][0], "send");
  assert.equal(calls[1][2].content, "fallback:user-1:embed too large");
  assert.equal(calls.some((entry) => entry[0] === "log" && entry[1] === "warn" && /VERIFICATION_REPORT_DEGRADED/.test(entry[2])), true);
  assert.equal(calls.some((entry) => entry[0] === "log" && /VERIFICATION_REPORT_SENT/.test(entry[2]) && /degraded=true/.test(entry[2])), true);
});

test("handleVerificationApprovedCallback routes clean OAuth to manual review with temporary access", async () => {
  const calls = [];
  const buildFunction = loadHandleVerificationApprovedCallback();
  const handleVerificationApprovedCallback = buildFunction(
    (value, max) => String(value || "").trim().slice(0, max || 400),
    async () => ({ active: true, stopped: false }),
    async (_client, message, level = "info") => {
      calls.push(["log", level, message]);
    },
    (userId, patch) => {
      calls.push(["update", userId, patch]);
      return { userId, domains: { verification: patch } };
    },
    () => "discord-user",
    (value) => value,
    async (_client, userId, reason) => {
      calls.push(["temporaryAccess", userId, reason]);
      return { granted: true, roleId: "wartime-role", accessMode: "wartime" };
    },
    async (_client, userId, statusNote, options) => {
      calls.push(["post", userId, statusNote, options]);
      return { degraded: false };
    },
    () => "2026-05-10T00:00:00.000Z"
  );

  await handleVerificationApprovedCallback({}, {
    session: { userId: "user-1" },
    oauthUser: { id: "oauth-1", username: "discord-user" },
    risk: {
      observedGuilds: [{ id: "guild-1", name: "Guild" }],
      observedGuildIds: ["guild-1"],
      observedGuildNames: ["Guild"],
      observedFriendIds: [],
      matchedEnemyGuildIds: [],
      matchedEnemyUserIds: [],
      matchedEnemyFriendIds: [],
      matchedEnemyInviteCodes: [],
      matchedEnemyInviterUserIds: [],
      suspiciousSignals: [],
    },
  });

  assert.equal(calls[0][0], "update");
  assert.equal(Object.prototype.hasOwnProperty.call(calls[0][2], "status"), false);
  assert.deepEqual(calls[1][2], {
    status: "manual_review",
    decision: "manual_review",
    decisionReason: "oauth_completed_waiting_moderator",
    lastError: "",
  });
  assert.deepEqual(calls[2], ["temporaryAccess", "user-1", "verification clean oauth pending moderator review"]);
  assert.equal(calls[3][0], "post");
  assert.equal(calls[3][1], "user-1");
  assert.match(calls[3][2], /Кейс отправлен на ручное решение модератора/);
  assert.equal(calls[3][3], undefined);
  assert.deepEqual(calls[4], ["update", "user-1", { reportSentAt: "2026-05-10T00:00:00.000Z" }]);
  assert.equal(calls.some((entry) => entry[0] === "log" && /VERIFICATION_READY_FOR_REVIEW:/.test(entry[2])), true);
});

test("handleVerificationApprovedCallback keeps clean OAuth retryable when report delivery fails", async () => {
  const calls = [];
  const buildFunction = loadHandleVerificationApprovedCallback();
  const handleVerificationApprovedCallback = buildFunction(
    (value, max) => String(value || "").trim().slice(0, max || 400),
    async () => ({ active: true, stopped: false }),
    async (_client, message, level = "info") => {
      calls.push(["log", level, message]);
    },
    (userId, patch) => {
      calls.push(["update", userId, patch]);
      return { userId, domains: { verification: patch } };
    },
    () => "discord-user",
    (value) => value,
    async (_client, userId, reason) => {
      calls.push(["temporaryAccess", userId, reason]);
      return { granted: true, roleId: "wartime-role", accessMode: "wartime" };
    },
    async () => {
      throw new Error("report channel unavailable");
    },
    () => "2026-05-10T00:00:00.000Z"
  );

  await handleVerificationApprovedCallback({}, {
    session: { userId: "user-1" },
    oauthUser: { id: "oauth-1", username: "discord-user" },
    risk: {},
  });

  assert.equal(calls.some((entry) => entry[0] === "temporaryAccess"), true);
  assert.equal(calls.some((entry) => entry[0] === "update" && entry[2]?.status === "verified"), false);
  assert.equal(calls.some((entry) => entry[0] === "update" && entry[2]?.reportSentAt), false);
  assert.equal(calls.some((entry) => entry[0] === "update" && entry[2]?.reportDueAt === "2026-05-10T00:00:00.000Z"), true);
  assert.equal(calls.some((entry) => entry[0] === "log" && entry[1] === "error" && /VERIFICATION_READY_FOR_REVIEW_REPORT_FAILED/.test(entry[2])), true);
});

test("handleVerificationManualReviewCallback stamps reportSentAt only after report delivery succeeds", async () => {
  const calls = [];
  const buildFunction = loadHandleVerificationManualReviewCallback();
  const handleVerificationManualReviewCallback = buildFunction(
    (value, max) => String(value || "").trim().slice(0, max || 400),
    async () => ({ active: true, stopped: false }),
    async (_client, message) => {
      calls.push(["log", message]);
    },
    (userId, patch) => {
      calls.push(["update", userId, patch]);
      return { userId, domains: { verification: patch } };
    },
    () => "discord-user",
    (value) => value,
    async (_client, userId, statusNote) => {
      calls.push(["post", userId, statusNote]);
      return { degraded: false };
    },
    async (_client, userId, reason) => {
      calls.push(["temporaryAccess", userId, reason]);
      return { granted: true, roleId: "wartime-role", accessMode: "wartime" };
    },
    () => "2026-05-10T00:00:00.000Z"
  );

  await handleVerificationManualReviewCallback({}, {
    session: { userId: "user-1" },
    oauthUser: { id: "oauth-1", username: "discord-user" },
    risk: {
      requiresManualReview: false,
      missingObservedGuilds: false,
      observedGuilds: [],
      observedGuildIds: [],
      observedGuildNames: [],
      matchedEnemyGuildIds: [],
      matchedEnemyUserIds: [],
      matchedEnemyInviteCodes: [],
      matchedEnemyInviterUserIds: [],
    },
  });

  assert.equal(calls[0][0], "update");
  assert.equal(Object.prototype.hasOwnProperty.call(calls[0][2], "reportSentAt"), false);
  assert.deepEqual(calls[1], ["temporaryAccess", "user-1", "verification manual review temporary access"]);
  assert.deepEqual(calls[2], ["post", "user-1", "OAuth завершён. Кейс отправлен на ручную проверку модератора. Временная роль доступа выдана до решения модератора."]);
  assert.equal(calls[3][0], "update");
  assert.deepEqual(calls[3][2], { reportSentAt: "2026-05-10T00:00:00.000Z" });
});

test("handleVerificationManualReviewCallback keeps failed report delivery retryable", async () => {
  const calls = [];
  const buildFunction = loadHandleVerificationManualReviewCallback();
  const handleVerificationManualReviewCallback = buildFunction(
    (value, max) => String(value || "").trim().slice(0, max || 400),
    async () => ({ active: true, stopped: false }),
    async (_client, message, level = "info") => {
      calls.push(["log", level, message]);
    },
    (userId, patch) => {
      calls.push(["update", userId, patch]);
      return { userId, domains: { verification: patch } };
    },
    () => "discord-user",
    (value) => value,
    async () => {
      throw new Error("send failed");
    },
    async (_client, userId, reason) => {
      calls.push(["temporaryAccess", userId, reason]);
      return { granted: true, roleId: "wartime-role", accessMode: "wartime" };
    },
    () => "2026-05-10T00:00:00.000Z"
  );

  await handleVerificationManualReviewCallback({}, {
    session: { userId: "user-1" },
    oauthUser: { id: "oauth-1", username: "discord-user" },
    risk: {
      requiresManualReview: true,
      missingObservedGuilds: false,
      observedGuilds: [],
      observedGuildIds: [],
      observedGuildNames: [],
      matchedEnemyGuildIds: [],
      matchedEnemyUserIds: [],
      matchedEnemyInviteCodes: [],
      matchedEnemyInviterUserIds: [],
    },
  });

  assert.equal(calls.length, 4);
  assert.equal(calls[0][0], "update");
  assert.equal(Object.prototype.hasOwnProperty.call(calls[0][2], "reportSentAt"), false);
  assert.deepEqual(calls[1], ["temporaryAccess", "user-1", "verification manual review temporary access"]);
  assert.deepEqual(calls[2][2], {
    reportDueAt: "2026-05-10T00:00:00.000Z",
    lastError: "verification report delivery failed: send failed",
  });
  assert.equal(calls[3][0], "log");
  assert.equal(calls[3][1], "error");
  assert.match(calls[3][2], /VERIFICATION_MANUAL_REVIEW_REPORT_FAILED/);
});

test("runVerificationDeadlineSweep continues after one overdue report fails", async () => {
  const originalDateNow = Date.now;
  Date.now = () => Date.parse("2026-05-10T00:00:00.000Z");

  try {
    const calls = [];
    const db = {
      profiles: {
        "user-fail": {
          summary: {
            verification: {
              status: "pending",
              reportDueAt: "2026-05-09T00:00:00.000Z",
              reportSentAt: "",
            },
          },
        },
        "user-ok": {
          summary: {
            verification: {
              status: "failed",
              reportDueAt: "2026-05-09T00:00:00.000Z",
              reportSentAt: "",
            },
          },
        },
        "user-manual": {
          summary: {
            verification: {
              status: "manual_review",
              reportDueAt: "2026-05-09T00:00:00.000Z",
              reportSentAt: "",
            },
          },
        },
        "user-future": {
          summary: {
            verification: {
              status: "pending",
              reportDueAt: "2026-05-11T00:00:00.000Z",
              reportSentAt: "",
            },
          },
        },
        "user-sent": {
          summary: {
            verification: {
              status: "pending",
              reportDueAt: "2026-05-09T00:00:00.000Z",
              reportSentAt: "2026-05-09T01:00:00.000Z",
            },
          },
        },
      },
    };
    const buildFunction = loadRunVerificationDeadlineSweep();
    const runVerificationDeadlineSweep = buildFunction(
      () => true,
      db,
      (userId) => db.profiles[userId],
      async () => ({ active: true, stopped: false }),
      (value, max) => String(value || "").trim().slice(0, max || 400),
      async (_client, userId, statusNote) => {
        calls.push(["post", userId, statusNote]);
        if (userId === "user-fail") {
          throw new Error("report channel unavailable");
        }
        return { message: { id: `report-${userId}` } };
      },
      (userId, patch) => {
        calls.push(["update", userId, patch]);
        return { userId, domains: { verification: patch } };
      },
      () => "2026-05-10T00:00:00.000Z",
      async (_client, message, level = "info") => {
        calls.push(["log", level, message]);
      }
    );

    const result = await runVerificationDeadlineSweep({});

    assert.deepEqual(result, { scanned: 3, reported: 2, failed: 1 });
    assert.deepEqual(calls.filter((entry) => entry[0] === "post").map((entry) => entry[1]), ["user-fail", "user-ok", "user-manual"]);
    assert.deepEqual(calls.filter((entry) => entry[0] === "update").map((entry) => entry[1]), ["user-ok", "user-manual"]);
    assert.deepEqual(calls.find((entry) => entry[0] === "update")?.[2], {
      status: "manual_review",
      decision: "manual_review",
      decisionReason: "pending_timeout",
      reportSentAt: "2026-05-10T00:00:00.000Z",
    });
    assert.equal(calls.some((entry) => entry[0] === "log" && entry[1] === "error" && /user-fail/.test(entry[2])), true);
  } finally {
    Date.now = originalDateNow;
  }
});

test("handleVerificationEntryStartInteraction rejects disabled verification before defer", async () => {
  const calls = [];
  const buildFunction = loadHandleVerificationEntryStartInteraction();
  const handleVerificationEntryStartInteraction = buildFunction(
    () => false,
    () => true,
    () => "verify-role",
    (value, max) => String(value || "").trim().slice(0, max || 400),
    (payload) => ({ ...payload, flags: 64 }),
    { Ephemeral: 64 },
    async () => {
      calls.push(["fetchMember"]);
      return null;
    },
    async () => ({ active: false, stopped: false }),
    () => true,
    (roleId) => `<@&${roleId}>`,
    null,
    async () => {
      calls.push(["startRuntime"]);
      return { callbackStarted: true };
    },
    () => "2026-05-10T00:00:00.000Z",
    () => calls.push(["ensurePending"]),
    () => "2026-05-17T00:00:00.000Z",
    () => "state-1",
    async () => calls.push(["log"]),
    (state) => state,
    () => "https://discord.com/oauth2/authorize?state=state-1",
    () => ({}),
    () => ({ content: "launch" }),
    () => "status"
  );

  await handleVerificationEntryStartInteraction({}, {
    user: { id: "user-1" },
    async reply(payload) {
      calls.push(["reply", payload]);
    },
    async deferReply(payload) {
      calls.push(["deferReply", payload]);
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "reply");
  assert.match(calls[0][1].content, /выключена/);
});

test("handleVerificationEntryStartInteraction defers before runtime start and edits launch payload", async () => {
  const calls = [];
  const member = {
    roles: {
      cache: {
        has: (roleId) => roleId === "verify-role",
      },
    },
  };
  const buildFunction = loadHandleVerificationEntryStartInteraction();
  const handleVerificationEntryStartInteraction = buildFunction(
    () => true,
    () => true,
    () => "verify-role",
    (value, max) => String(value || "").trim().slice(0, max || 400),
    (payload) => ({ ...payload, flags: 64 }),
    { Ephemeral: 64 },
    async () => {
      calls.push(["fetchMember"]);
      return member;
    },
    async () => {
      calls.push(["reconcile"]);
      return { active: false, stopped: false };
    },
    (currentMember, roleId) => currentMember.roles.cache.has(roleId),
    (roleId) => `<@&${roleId}>`,
    null,
    async () => {
      calls.push(["startRuntime"]);
      return { callbackStarted: true };
    },
    () => "2026-05-10T00:00:00.000Z",
    (_userId, patch) => calls.push(["ensurePending", patch]),
    () => "2026-05-17T00:00:00.000Z",
    () => "state-1",
    async () => calls.push(["log"]),
    (state) => state,
    () => "https://discord.com/oauth2/authorize?state=state-1",
    () => ({ enabled: true }),
    (payload) => ({ content: "launch", payload }),
    () => "Статус: pending"
  );

  await handleVerificationEntryStartInteraction({}, {
    user: { id: "user-1" },
    member,
    async deferReply(payload) {
      calls.push(["deferReply", payload]);
    },
    async editReply(payload) {
      calls.push(["editReply", payload]);
    },
  });

  assert.deepEqual(calls.map((entry) => entry[0]), [
    "deferReply",
    "reconcile",
    "startRuntime",
    "ensurePending",
    "log",
    "editReply",
  ]);
  assert.equal(calls[0][1].flags, 64);
  assert.equal(calls.at(-1)[1].content, "launch");
});

test("handleVerificationEntryStartInteraction blocks users without verify-role", async () => {
  const calls = [];
  const member = {
    roles: {
      cache: {
        has: () => false,
      },
    },
  };
  const buildFunction = loadHandleVerificationEntryStartInteraction();
  const handleVerificationEntryStartInteraction = buildFunction(
    () => true,
    () => true,
    () => "verify-role",
    (value, max) => String(value || "").trim().slice(0, max || 400),
    (payload) => ({ ...payload, flags: 64 }),
    { Ephemeral: 64 },
    async () => member,
    async () => ({ active: true, stopped: true }),
    () => false,
    (roleId) => `<@&${roleId}>`,
    null,
    async () => {
      calls.push(["startRuntime"]);
      return { callbackStarted: true };
    },
    () => "2026-05-10T00:00:00.000Z",
    () => calls.push(["ensurePending"]),
    () => "2026-05-17T00:00:00.000Z",
    () => "state-1",
    async () => calls.push(["log"]),
    (state) => state,
    () => "https://discord.com/oauth2/authorize?state=state-1",
    () => ({ enabled: true }),
    () => ({ content: "launch" }),
    () => "status"
  );

  await handleVerificationEntryStartInteraction({}, {
    user: { id: "user-1" },
    member,
    async deferReply(payload) {
      calls.push(["deferReply", payload]);
    },
    async editReply(payload) {
      calls.push(["editReply", payload]);
    },
  });

  assert.deepEqual(calls.map((entry) => entry[0]), ["deferReply", "editReply"]);
  assert.match(calls[1][1], /verify-ролью/);
});
