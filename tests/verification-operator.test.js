"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  VERIFY_PANEL_REFRESH_ID,
  buildVerificationPanelPayload,
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