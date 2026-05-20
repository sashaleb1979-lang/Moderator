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
    "nowIso",
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
  assert.deepEqual(calls[1], ["post", "user-1", "OAuth завершён. Доступ не выдаётся автоматически: кейс остаётся в карантине до ручного решения модератора."]);
  assert.equal(calls[2][0], "update");
  assert.deepEqual(calls[2][2], { reportSentAt: "2026-05-10T00:00:00.000Z" });
});

test("handleVerificationManualReviewCallback leaves reportSentAt empty when report delivery fails", async () => {
  const calls = [];
  const buildFunction = loadHandleVerificationManualReviewCallback();
  const handleVerificationManualReviewCallback = buildFunction(
    (value, max) => String(value || "").trim().slice(0, max || 400),
    async () => ({ active: true, stopped: false }),
    async () => {},
    (userId, patch) => {
      calls.push(["update", userId, patch]);
      return { userId, domains: { verification: patch } };
    },
    () => "discord-user",
    (value) => value,
    async () => {
      throw new Error("send failed");
    },
    () => "2026-05-10T00:00:00.000Z"
  );

  await assert.rejects(() => handleVerificationManualReviewCallback({}, {
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
  }), /send failed/);

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "update");
  assert.equal(Object.prototype.hasOwnProperty.call(calls[0][2], "reportSentAt"), false);
});