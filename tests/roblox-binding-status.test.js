"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  formatRobloxBindingStatusLine,
  formatRobloxReadinessLabel,
  getRobloxBindingRecoveryText,
  resolveRobloxBindingReason,
} = require("../src/integrations/roblox-binding-status");

test("roblox binding status helper keeps repairable, pending and usable reasons stable", () => {
  assert.equal(
    formatRobloxBindingStatusLine({ trackingState: "repairable", trackingBlocker: "invalid_user_id" }),
    "Roblox-связка: нужна перепривязка, нет валидного Roblox userId."
  );
  assert.equal(
    formatRobloxReadinessLabel({ trackingState: "pending", verificationStatus: "pending" }),
    "Roblox ждёт проверки"
  );
  assert.equal(
    formatRobloxReadinessLabel({ trackingState: "trackable", isTrackable: true, currentUsername: "GojoMain", userId: "123" }),
    "Roblox связан"
  );
});

test("roblox binding status helper flags suspicious Discord-like Roblox identity from profile context", () => {
  const reason = resolveRobloxBindingReason({
    userId: "user-1",
    username: "discord-clone",
    displayName: "discord-clone",
    domains: {
      roblox: {
        username: "discord-clone",
        verificationStatus: "verified",
      },
    },
  });

  assert.equal(reason.code, "suspicious_identity");
  assert.equal(
    getRobloxBindingRecoveryText({
      userId: "user-1",
      username: "discord-clone",
      displayName: "discord-clone",
      domains: {
        roblox: {
          username: "discord-clone",
          verificationStatus: "verified",
        },
      },
    }, { audience: "onboarding" }),
    "Старая Roblox-связка выглядит недостоверной и не будет переиспользована. Укажи аккаунт заново."
  );
});