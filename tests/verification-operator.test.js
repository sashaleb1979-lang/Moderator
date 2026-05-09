"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  VERIFY_ENTRY_START_ID,
  VERIFY_ENTRY_STATUS_ID,
  VERIFY_PANEL_REFRESH_ID,
  buildVerificationEntryPayload,
  buildVerificationLaunchPayload,
  buildVerificationPanelPayload,
  buildVerificationReportPayload,
  parseVerificationReportAction,
} = require("../src/verification/operator");

test("buildVerificationPanelPayload summarizes autonomous verification config", () => {
  const payload = buildVerificationPanelPayload({
    integration: {
      enabled: true,
      status: "configured",
      verificationChannelId: "verify-room",
      reportChannelId: "report-room",
      stageTexts: {
        entry: "hello",
        warning: "warn",
      },
      riskRules: {
        enemyGuildIds: ["guild-1", "guild-2"],
        enemyUserIds: ["user-1"],
        enemyInviteCodes: ["code-1"],
        enemyInviterUserIds: [],
        manualTags: ["flag-a", "flag-b", "flag-a"],
      },
      deadline: {
        pendingDays: 7,
      },
    },
    verifyRoleId: "verify-role",
    accessRoleId: "base-role",
    wartimeAccessRoleId: "wartime-role",
    oauthConfigured: true,
  });

  assert.equal(payload.components[0].toJSON().components[0].custom_id, VERIFY_PANEL_REFRESH_ID);
  assert.equal(payload.embeds[0].data.title, "Verification Panel");
  assert.match(payload.embeds[0].data.fields[1].value, /<@&verify-role>/);
  assert.match(payload.embeds[0].data.fields[2].value, /Enemy guilds: \*\*2\*\*/);
  assert.match(payload.embeds[0].data.fields[3].value, /7 дн\./);
});

test("buildVerificationEntryPayload exposes user-facing OAuth and status buttons", () => {
  const payload = buildVerificationEntryPayload({
    integration: {
      stageTexts: {
        entry: "Пройди отдельную проверку.",
      },
      deadline: {
        pendingDays: 7,
      },
    },
    statusText: "Система готова.",
  });

  const row = payload.components[0].toJSON().components;
  assert.equal(payload.embeds[0].data.title, "Verification Access");
  assert.equal(row[0].custom_id, VERIFY_ENTRY_START_ID);
  assert.equal(row[1].custom_id, VERIFY_ENTRY_STATUS_ID);
  assert.match(payload.embeds[0].data.description, /7 дн\./);
});

test("buildVerificationLaunchPayload returns a link button for Discord OAuth", () => {
  const payload = buildVerificationLaunchPayload({
    authorizeUrl: "https://discord.com/oauth2/authorize?state=abc",
  });

  const row = payload.components[0].toJSON().components;
  assert.equal(row[0].style, 5);
  assert.equal(row[0].url, "https://discord.com/oauth2/authorize?state=abc");
  assert.equal(row[1].custom_id, VERIFY_ENTRY_STATUS_ID);
});

test("buildVerificationReportPayload and parseVerificationReportAction round-trip manual actions", () => {
  const payload = buildVerificationReportPayload({
    userId: "user-1",
    profile: {
      userId: "user-1",
      domains: {
        verification: {
          status: "manual_review",
          decision: "manual_review",
          oauthUsername: "discord-user",
          reportDueAt: "2026-05-08T10:00:00.000Z",
          matchedEnemyGuildIds: ["guild-1"],
          matchedEnemyUserIds: ["user-2"],
          matchedEnemyInviteCodes: ["invite-1"],
          matchedEnemyInviterUserIds: ["inviter-1"],
        },
      },
      summary: {
        verification: {
          oauthUsername: "discord-user",
          observedGuildCount: 3,
          matchedEnemyGuildCount: 1,
          matchedEnemyUserCount: 1,
          matchedEnemyInviteCount: 1,
          matchedEnemyInviterCount: 1,
          manualTagCount: 0,
          status: "manual_review",
          decision: "manual_review",
          reportDueAt: "2026-05-08T10:00:00.000Z",
        },
      },
    },
  });

  const row = payload.components[0].toJSON().components;
  assert.equal(payload.embeds[0].data.title, "Verification Manual Review");
  assert.deepEqual(parseVerificationReportAction(row[0].custom_id), { action: "approve", userId: "user-1" });
  assert.deepEqual(parseVerificationReportAction(row[1].custom_id), { action: "reject", userId: "user-1" });
});