"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CHANNEL_SLOTS,
  SOT_VERSION,
  createEmptySotState,
  ensureSotState,
  normalizeSotState,
} = require("../src/sot/schema");

function createLegacyDbFixture() {
  return {
    config: {
      welcomePanel: {
        channelId: "welcome-db",
        messageId: "welcome-message",
      },
      nonGgsPanel: {
        channelId: "welcome-db",
        messageId: "non-ggs-message",
      },
      reviewChannelId: "review-db",
      notificationChannelId: "log-db",
      tierlistBoard: {
        text: {
          channelId: "tier-text-db",
          messageId: "tier-main",
          messageIdSummary: "tier-summary",
          messageIdPages: "tier-pages",
        },
        graphic: {
          channelId: "tier-graphic-db",
          messageId: "tier-graphic-message",
          lastUpdated: "2026-05-03T12:00:00.000Z",
        },
      },
      generatedRoles: {
        characters: {
          gojo: "role-gojo-discovered",
          yuta: "role-yuta-discovered",
        },
        characterLabels: {
          yuta: "Юта",
        },
        tiers: {
          3: "tier-3-generated",
        },
      },
      characters: [
        { id: "gojo", label: "Годжо", roleId: "role-gojo-configured" },
        { id: "sukuna", label: "Сукуна", roleId: "" },
      ],
      integrations: {
        elo: {
          mode: "dormant",
          status: "migrated",
          sourcePath: "legacy/elo-db.json",
          lastImportAt: "2026-05-03T10:00:00.000Z",
          lastSyncAt: "2026-05-03T11:00:00.000Z",
          roleGrantEnabled: false,
          submitPanel: {
            channelId: "elo-submit-channel",
            messageId: "elo-submit-message",
          },
          graphicBoard: {
            channelId: "elo-graphic-channel",
            messageId: "elo-graphic-message",
            lastUpdated: "2026-05-03T11:30:00.000Z",
          },
        },
        tierlist: {
          mode: "dormant",
          status: "in_progress",
          sourcePath: "legacy/tierlist/state.json",
          lastImportAt: "2026-05-03T09:00:00.000Z",
          lastSyncAt: "2026-05-03T12:00:00.000Z",
          dashboard: {
            channelId: "tier-dashboard-channel",
            messageId: "tier-dashboard-message",
            lastUpdated: "2026-05-03T12:10:00.000Z",
          },
          summary: {
            channelId: "tier-summary-channel",
            messageId: "tier-summary-message",
            lastUpdated: "2026-05-03T12:11:00.000Z",
          },
        },
        verification: {
          status: "in_progress",
          verificationChannelId: "verify-db",
          entryMessage: {
            messageId: "verify-message-db",
          },
        },
      },
      onboardMode: {
        value: "wartime",
      },
      presentation: {
        welcome: {
          title: "Welcome title",
        },
        tierlist: {
          textTitle: "Text title",
        },
      },
      nonJjsUi: {
        buttonLabel: "Я не играю в JJS",
      },
    },
  };
}

function createAppConfigFixture() {
  return {
    channels: {
      welcomeChannelId: "welcome-config",
      reviewChannelId: "review-config",
      tierlistChannelId: "tier-config",
      logChannelId: "log-config",
    },
    roles: {
      moderatorRoleId: "mod-role",
      accessRoleId: "access-role",
      wartimeAccessRoleId: "wartime-role",
      nonGgsAccessRoleId: "non-ggs-role",
      killMilestoneRoleIds: {
        "20k": "milestone-20k-config",
        "30k": "milestone-30k-config",
      },
      killTierRoleIds: {
        1: "tier-1-config",
        2: "tier-2-config",
        3: "tier-3-config",
      },
      legacyEloTierRoleIds: {
        1: "legacy-1",
        2: "legacy-2",
      },
    },
    characters: [
      { id: "gojo", label: "Годжо", roleId: "role-gojo-configured" },
      { id: "megumi", label: "Мегуми", roleId: "" },
    ],
    verification: {
      enabled: true,
      callbackBaseUrl: "https://verify.example.com/oauth/discord/callback",
      verificationChannelId: "verify-config",
      reportChannelId: "verify-report-config",
      stageTexts: {
        entry: "Пройди verify",
      },
      riskRules: {
        enemyGuildIds: ["enemy-guild"],
      },
      deadline: {
        pendingDays: 7,
      },
      entryMessage: {
        channelId: "verify-config",
      },
    },
  };
}

test("createEmptySotState seeds all core domains for v1", () => {
  const sot = createEmptySotState();

  assert.equal(sot.sotVersion, SOT_VERSION);
  assert.deepEqual(Object.keys(sot.channels), CHANNEL_SLOTS);
  assert.deepEqual(Object.keys(sot.panels.tierlistText.messageIds), ["main", "summary", "pages"]);
  assert.equal(sot.modes.onboard, null);
  assert.deepEqual(sot.integrations.roblox, {});
  assert.equal(sot.news.config.voice.topCount, 5);
  assert.equal(sot.news.config.presentation.visualMode, "edition");
  assert.equal(sot.roles.killMilestone["20k"], null);
  assert.equal(sot.influence.tiers[5], 4);
  assert.equal(sot.influence.milestones["20k"], 4.5);
});

test("ensureSotState migrates legacy config into the new v1 SoT shape", () => {
  const db = createLegacyDbFixture();
  const result = ensureSotState(db, {
    appConfig: createAppConfigFixture(),
    presentation: {
      welcome: { title: "Resolved welcome" },
      tierlist: { textTitle: "Resolved tierlist" },
    },
    influence: {
      default: 1,
      tiers: { 1: 0.5, 2: 1, 3: 5, 4: 25, 5: 100 },
      milestones: { "20k": 150, "30k": 250 },
    },
    lastVerifiedAt: "2026-05-03T12:30:00.000Z",
  });

  assert.equal(result.migrated, true);
  assert.equal(result.mutated, true);
  assert.equal(db.sot.sotVersion, 1);
  assert.equal(db.sot.lastVerifiedAt, "2026-05-03T12:30:00.000Z");
  assert.equal(db.sot.channels.welcome.value, "welcome-db");
  assert.equal(db.sot.channels.review.value, "review-db");
  assert.equal(db.sot.channels.tierlistText.value, "tier-text-db");
  assert.equal(db.sot.roles.moderator.value, "mod-role");
  assert.equal(db.sot.roles.killTier[3].value, "tier-3-config");
  assert.equal(db.sot.roles.killTier[5], null);
  assert.equal(db.sot.roles.killMilestone["20k"].value, "milestone-20k-config");
  assert.equal(db.sot.roles.killMilestone["30k"].value, "milestone-30k-config");
  assert.equal(db.sot.characters.gojo.roleId, "role-gojo-configured");
  assert.equal(db.sot.characters.megumi.roleId, "");
  assert.equal(db.sot.characters.gojo.label, "Годжо");
  assert.equal(db.sot.characters.yuta, undefined);
  assert.equal(db.sot.characters.sukuna, undefined);
  assert.equal(db.sot.panels.tierlistText.messageIds.summary.value, "tier-summary");
  assert.equal(db.sot.panels.eloGraphic.lastUpdated, "2026-05-03T11:30:00.000Z");
  assert.equal(db.sot.modes.onboard.value, "wartime");
  assert.equal(db.sot.presentation.welcome.title, "Resolved welcome");
  assert.equal(db.sot.presentation.nonGgs.buttonLabel, "Я не играю в JJS");
  assert.equal(db.sot.integrations.elo.roleGrantEnabled, false);
  assert.equal(db.sot.integrations.tierlist.summary.channelId, "tier-summary-channel");
  assert.equal(db.sot.integrations.verification.enabled, true);
  assert.equal(db.sot.integrations.verification.callbackBaseUrl, "https://verify.example.com/oauth/discord/callback");
  assert.equal(db.sot.integrations.verification.verificationChannelId, "verify-db");
  assert.equal(db.sot.integrations.verification.reportChannelId, "verify-report-config");
  assert.equal(db.sot.integrations.verification.stageTexts.entry, "Пройди verify");
  assert.deepEqual(db.sot.integrations.verification.riskRules.enemyGuildIds, ["enemy-guild"]);
  assert.equal(db.sot.integrations.verification.deadline.pendingDays, 7);
  assert.equal(db.sot.integrations.verification.entryMessage.channelId, "verify-config");
  assert.equal(db.sot.integrations.verification.entryMessage.messageId, "verify-message-db");
  assert.equal(db.sot.influence.tiers[5], 100);
  assert.equal(db.sot.influence.milestones["20k"], 150);
  assert.equal(db.sot.influence.milestones["30k"], 250);
});

test("ensureSotState normalizes existing v1 state without remigrating", () => {
  const db = {
    sot: {
      sotVersion: 1,
      channels: {
        welcome: { value: " welcome-channel ", source: "manual" },
      },
      roles: {
        killTier: {
          1: { value: "tier-1", source: "configured" },
        },
      },
      characters: {
        gojo: {
          label: "Годжо",
          roleId: "role-gojo",
          source: "configured",
        },
      },
      panels: {
        tierlistText: {
          channelId: { value: "tier-channel", source: "manual" },
          messageIds: {
            main: { value: "main-message", source: "manual" },
          },
        },
      },
      influence: {
        tiers: {
          5: 10,
        },
      },
      modes: {
        onboard: { value: "peace", source: "configured" },
      },
      news: {
        config: {
          enabled: true,
          channels: {
            publicChannelId: " daily-public ",
          },
          voice: {
            topCount: 7,
          },
        },
      },
    },
  };

  const result = ensureSotState(db);
  const normalized = normalizeSotState(db.sot);

  assert.equal(result.migrated, false);
  assert.deepEqual(db.sot, normalized);
  assert.equal(db.sot.channels.welcome.value, "welcome-channel");
  assert.equal(db.sot.panels.tierlistText.messageIds.summary, null);
  assert.deepEqual(db.sot.integrations.roblox, {});
  assert.equal(db.sot.news.config.enabled, true);
  assert.equal(db.sot.news.config.channels.publicChannelId, "daily-public");
  assert.equal(db.sot.news.config.voice.topCount, 7);
  assert.equal(db.sot.roles.killMilestone["20k"], null);
  assert.equal(db.sot.influence.tiers[1], 2);
  assert.equal(db.sot.influence.tiers[5], 10);
  assert.equal(db.sot.influence.milestones["20k"], 4.5);
});