"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { compareSotChannelsVsLegacy, compareSotCharactersVsLegacy, compareSotInfluenceVsLegacy, compareSotIntegrationsVsLegacy, compareSotPanelsVsLegacy, compareSotPresentationVsLegacy, compareSotRolesVsLegacy } = require("../src/sot/legacy-bridge/compare");
const { syncLegacyCharacterWrites, syncLegacyChannelWrites, syncLegacyInfluenceWrites, syncLegacyIntegrationWrites, syncLegacyPanelWrites, syncLegacyPresentationWrites, syncLegacyRoleWrites } = require("../src/sot/legacy-bridge/write");

function createContext() {
  return {
    appConfig: {
      channels: {
        welcomeChannelId: "welcome-config",
        reviewChannelId: "review-config",
        tierlistChannelId: "tierlist-config",
        logChannelId: "log-config",
      },
      roles: {
        moderatorRoleId: "moderator-config",
        accessRoleId: "access-config",
        wartimeAccessRoleId: "wartime-config",
        nonJjsAccessRoleId: "nonjjs-config",
        verifyAccessRoleId: "verify-config",
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
          1: "elo-1-config",
          2: "elo-2-config",
        },
      },
    },
    db: {
      sot: {
        sotVersion: 1,
        channels: {
          review: { value: "stale-review", source: "manual", verifiedAt: null },
        },
        roles: {
          moderator: { value: "moderator-role", source: "configured", verifiedAt: null },
          accessNormal: null,
          accessWartime: null,
          accessNonJjs: null,
          verifyAccess: null,
          killTier: {
            1: null,
            2: null,
            3: null,
            4: null,
            5: null,
          },
          killMilestone: {
            "20k": null,
            "30k": null,
          },
          legacyEloTier: {
            1: null,
            2: null,
            3: null,
            4: null,
          },
        },
        characters: {
          vessel: {
            id: "vessel",
            label: "Old Vessel",
            englishLabel: "Old Vessel",
            roleId: "stale-vessel-role",
            source: "discovered",
            verifiedAt: null,
          },
        },
        panels: {
          welcome: {
            channelId: { value: "stale-welcome-channel", source: "manual", verifiedAt: null },
            messageIds: {
              main: { value: "stale-welcome-message", source: "manual", verifiedAt: null },
            },
            lastUpdated: null,
          },
        },
        integrations: {
          elo: {
            status: "stale",
          },
          tierlist: {},
        },
        presentation: {
          welcome: {
            title: "Old welcome title",
          },
          tierlist: {},
          nonGgs: {},
        },
      },
      config: {
        characters: [
          { id: "vessel", label: "Vessel" },
          { id: "king", label: "King" },
        ],
        welcomePanel: {
          channelId: "welcome-manual",
          messageId: "welcome-message",
        },
        reviewChannelId: "review-manual",
        tierlistBoard: {
          text: {
            channelId: "tier-text-manual",
            messageId: "tier-text-message",
            messageIdSummary: "tier-summary-message",
            messageIdPages: "tier-pages-message",
          },
          graphic: {
            channelId: "tier-graphic-manual",
            messageId: "tier-graphic-message",
          },
        },
        notificationChannelId: "log-manual",
        presentation: {
          welcome: {
            title: "Welcome title",
          },
          tierlist: {
            textTitle: "Tier title",
          },
        },
        nonJjsUi: {
          title: "Captcha title",
        },
        generatedRoles: {
          characters: {
            vessel: "vessel-role-generated",
          },
          characterLabels: {
            vessel: "Юджи",
          },
          tiers: {
            5: "tier-5-generated",
          },
        },
        integrations: {
          elo: {
            submitPanel: {
              channelId: "elo-submit-manual",
            },
            graphicBoard: {
              channelId: "elo-graphic-manual",
            },
          },
          tierlist: {
            dashboard: {
              channelId: "tier-dashboard-manual",
            },
            summary: {
              channelId: "tier-summary-manual",
            },
          },
        },
      },
    },
  };
}

function createPresentationOptions() {
  return {
    presentation: {
      welcome: {
        title: "Welcome title",
      },
      tierlist: {
        textTitle: "Tier title",
      },
      nonGgs: {},
    },
    nonGgsPresentation: {
      title: "Captcha title",
    },
  };
}

function createInfluenceOptions() {
  return {
    influence: {
      default: 7,
      tiers: {
        1: 1,
        2: 2,
        3: 3,
        4: 4,
        5: 5,
      },
      milestones: {
        "20k": 6,
        "30k": 8,
      },
    },
  };
}

test("syncLegacyChannelWrites updates only channel slots from legacy-backed values", () => {
  const context = createContext();

  const result = syncLegacyChannelWrites(context.db, { appConfig: context.appConfig });

  assert.equal(result.mutated, true);
  assert.deepEqual(result.writtenSlots.sort(), [
    "eloGraphic",
    "eloSubmit",
    "log",
    "review",
    "tierlistDashboard",
    "tierlistGraphic",
    "tierlistSummary",
    "tierlistText",
    "welcome",
  ]);
  assert.equal(context.db.sot.channels.review.value, "review-manual");
  assert.equal(context.db.sot.channels.log.value, "log-manual");
  assert.equal(context.db.sot.roles.moderator.value, "moderator-role");
});

test("syncLegacyRoleWrites updates configured and generated role slots without touching channels", () => {
  const context = createContext();

  const result = syncLegacyRoleWrites(context.db, { appConfig: context.appConfig });

  assert.equal(result.mutated, true);
  assert.deepEqual(result.writtenSlots.sort(), [
    "accessNonJjs",
    "accessNormal",
    "accessWartime",
    "killMilestone.20k",
    "killMilestone.30k",
    "killTier.1",
    "killTier.2",
    "killTier.3",
    "killTier.5",
    "legacyEloTier.1",
    "legacyEloTier.2",
    "moderator",
    "verifyAccess",
  ]);
  assert.equal(context.db.sot.roles.moderator.value, "moderator-config");
  assert.equal(context.db.sot.roles.accessNormal.value, "access-config");
  assert.equal(context.db.sot.roles.verifyAccess.value, "verify-config");
  assert.equal(context.db.sot.roles.killTier[5].value, "tier-5-generated");
  assert.equal(context.db.sot.roles.killMilestone["20k"].value, "milestone-20k-config");
  assert.equal(context.db.sot.roles.killMilestone["30k"].value, "milestone-30k-config");
  assert.equal(context.db.sot.roles.killTier[4], null);
  assert.equal(context.db.sot.channels.review.value, "stale-review");
});

test("syncLegacyRoleWrites preserves explicit manual role overrides against configured legacy values", () => {
  const context = createContext();
  context.db.sot.roles.moderator = {
    value: "moderator-manual",
    source: "manual",
    verifiedAt: "2026-05-03T12:00:00.000Z",
  };

  const result = syncLegacyRoleWrites(context.db, { appConfig: context.appConfig });

  assert.equal(result.writtenSlots.includes("moderator"), false);
  assert.equal(context.db.sot.roles.moderator.value, "moderator-manual");
  assert.equal(context.db.sot.roles.moderator.source, "manual");
});

test("syncLegacyCharacterWrites updates character slots without touching channels or roles", () => {
  const context = createContext();

  const result = syncLegacyCharacterWrites(context.db, { appConfig: context.appConfig });

  assert.equal(result.mutated, true);
  assert.deepEqual(result.writtenSlots.sort(), [
    "king",
    "vessel",
  ]);
  assert.equal(context.db.sot.characters.vessel.roleId, "vessel-role-generated");
  assert.equal(context.db.sot.characters.vessel.label, "Юджи");
  assert.equal(context.db.sot.characters.king.roleId, "");
  assert.equal(context.db.sot.channels.review.value, "stale-review");
  assert.equal(context.db.sot.roles.moderator.value, "moderator-role");
});

test("syncLegacyCharacterWrites keeps manual-only entries and preserves explicit manual character overrides", () => {
  const context = createContext();
  context.db.sot.characters.manual_only = {
    id: "manual_only",
    label: "Manual Only",
    englishLabel: "Manual Only",
    roleId: "role-manual",
    source: "manual",
    verifiedAt: "2026-05-03T12:00:00.000Z",
    evidence: { overlap: 9 },
  };
  context.db.sot.characters.vessel = {
    id: "vessel",
    label: "Manual Vessel",
    englishLabel: "Manual Vessel",
    roleId: "manual-vessel-role",
    source: "manual",
    verifiedAt: "2026-05-03T12:01:00.000Z",
    evidence: { manualOverride: true },
  };

  const result = syncLegacyCharacterWrites(context.db, { appConfig: context.appConfig });

  assert.equal(result.writtenSlots.includes("manual_only"), false);
  assert.equal(context.db.sot.characters.manual_only.roleId, "role-manual");
  assert.equal(context.db.sot.characters.vessel.roleId, "manual-vessel-role");
  assert.equal(context.db.sot.characters.vessel.label, "Manual Vessel");
  assert.deepEqual(context.db.sot.characters.vessel.evidence, { manualOverride: true });
});

test("syncLegacyCharacterWrites preserves native-owned SoT character records against legacy bridge refresh", () => {
  const context = createContext();
  context.db.sot.characters.vessel = {
    id: "vessel",
    label: "Юджи native",
    englishLabel: "Vessel",
    roleId: "native-vessel-role",
    source: "discovered",
    verifiedAt: "2026-05-04T10:00:00.000Z",
    evidence: { nativeWriter: true, overlap: 3 },
  };

  const result = syncLegacyCharacterWrites(context.db, { appConfig: context.appConfig });

  assert.equal(result.writtenSlots.includes("vessel"), false);
  assert.equal(context.db.sot.characters.vessel.roleId, "native-vessel-role");
  assert.equal(context.db.sot.characters.vessel.label, "Юджи native");
  assert.deepEqual(context.db.sot.characters.vessel.evidence, { nativeWriter: true, overlap: 3 });
});

test("syncLegacyCharacterWrites excludes legacy tierlist custom ids from SoT character slots", () => {
  const context = createContext();
  context.db.config.characters.push({ id: "mahito", label: "Mahito" });

  const result = syncLegacyCharacterWrites(context.db, {
    appConfig: context.appConfig,
    excludedCharacterIds: ["mahito"],
  });

  assert.equal(result.writtenSlots.includes("mahito"), false);
  assert.equal(context.db.sot.characters.mahito, undefined);
});

test("syncLegacyPanelWrites updates panel slots without touching channels, roles, or characters", () => {
  const context = createContext();

  const result = syncLegacyPanelWrites(context.db);

  assert.equal(result.mutated, true);
  assert.deepEqual(result.writtenSlots.sort(), [
    "eloGraphic",
    "eloSubmit",
    "tierlistDashboard",
    "tierlistGraphic",
    "tierlistSummary",
    "tierlistText",
    "welcome",
  ]);
  assert.equal(context.db.sot.panels.welcome.channelId.value, "welcome-manual");
  assert.equal(context.db.sot.panels.welcome.messageIds.main.value, "welcome-message");
  assert.equal(context.db.sot.panels.tierlistText.messageIds.main, null);
  assert.equal(context.db.sot.panels.tierlistText.messageIds.summary.value, "tier-summary-message");
  assert.equal(context.db.sot.channels.review.value, "stale-review");
  assert.equal(context.db.sot.roles.moderator.value, "moderator-role");
  assert.equal(context.db.sot.characters.vessel.roleId, "stale-vessel-role");
});

test("syncLegacyIntegrationWrites updates integration slots without touching other SoT domains", () => {
  const context = createContext();

  const result = syncLegacyIntegrationWrites(context.db);

  assert.equal(result.mutated, true);
  assert.deepEqual(result.writtenSlots.sort(), [
    "elo",
    "tierlist",
    "verification",
  ]);
  assert.equal(context.db.sot.integrations.elo.status, "");
  assert.equal(context.db.sot.integrations.elo.submitPanel.channelId, "elo-submit-manual");
  assert.equal(context.db.sot.integrations.tierlist.summary.channelId, "tier-summary-manual");
  assert.equal(context.db.sot.integrations.verification.status, "");
  assert.equal(context.db.sot.channels.review.value, "stale-review");
  assert.equal(context.db.sot.panels.welcome.channelId.value, "stale-welcome-channel");
});

test("syncLegacyPresentationWrites updates presentation slots without touching other SoT domains", () => {
  const context = createContext();
  const presentationOptions = createPresentationOptions();

  const result = syncLegacyPresentationWrites(context.db, presentationOptions);

  assert.equal(result.mutated, true);
  assert.deepEqual(result.writtenSlots.sort(), [
    "nonGgs",
    "tierlist",
    "welcome",
  ]);
  assert.equal(context.db.sot.presentation.welcome.title, "Welcome title");
  assert.equal(context.db.sot.presentation.tierlist.textTitle, "Tier title");
  assert.equal(context.db.sot.presentation.nonGgs.title, "Captcha title");
  assert.equal(context.db.sot.channels.review.value, "stale-review");
  assert.equal(context.db.sot.integrations.elo.status, "stale");
});

test("syncLegacyInfluenceWrites updates influence without touching other SoT domains", () => {
  const context = createContext();
  const influenceOptions = createInfluenceOptions();

  const result = syncLegacyInfluenceWrites(context.db, influenceOptions);

  assert.equal(result.mutated, true);
  assert.deepEqual(result.writtenSlots, ["current"]);
  assert.equal(context.db.sot.influence.default, 7);
  assert.equal(context.db.sot.influence.tiers[5], 5);
  assert.equal(context.db.sot.influence.milestones["20k"], 6);
  assert.equal(context.db.sot.influence.milestones["30k"], 8);
  assert.equal(context.db.sot.channels.review.value, "stale-review");
  assert.equal(context.db.sot.presentation.welcome.title, "Old welcome title");
});

test("compareSotChannelsVsLegacy is clean after channel dual-write sync and flags later drift", () => {
  const context = createContext();
  syncLegacyChannelWrites(context.db, { appConfig: context.appConfig });

  assert.deepEqual(compareSotChannelsVsLegacy({ db: context.db, appConfig: context.appConfig }), []);

  context.db.sot.channels.review.value = "review-drift";

  assert.deepEqual(
    compareSotChannelsVsLegacy({ db: context.db, appConfig: context.appConfig }).map((entry) => `${entry.domain}:${entry.key}:${entry.status}`),
    ["channels:review:mismatch"]
  );
});

test("compareSotRolesVsLegacy is clean after role dual-write sync and flags later drift", () => {
  const context = createContext();
  syncLegacyRoleWrites(context.db, { appConfig: context.appConfig });

  assert.deepEqual(compareSotRolesVsLegacy({ db: context.db, appConfig: context.appConfig }), []);

  context.db.sot.roles.accessNormal.value = "access-drift";

  assert.deepEqual(
    compareSotRolesVsLegacy({ db: context.db, appConfig: context.appConfig }).map((entry) => `${entry.domain}:${entry.key}:${entry.status}`),
    ["roles:accessNormal:mismatch"]
  );
});

test("compareSotCharactersVsLegacy is clean after character dual-write sync and flags later drift", () => {
  const context = createContext();
  syncLegacyCharacterWrites(context.db, { appConfig: context.appConfig });

  assert.deepEqual(compareSotCharactersVsLegacy({ db: context.db, appConfig: context.appConfig }), []);

  context.db.sot.characters.vessel.label = "Vessel drift";

  assert.deepEqual(
    compareSotCharactersVsLegacy({ db: context.db, appConfig: context.appConfig }).map((entry) => `${entry.domain}:${entry.key}:${entry.status}`),
    ["characters:vessel:mismatch"]
  );
});

test("compareSotCharactersVsLegacy ignores native-owned character drift after cutover", () => {
  const context = createContext();
  syncLegacyCharacterWrites(context.db, { appConfig: context.appConfig });
  context.db.sot.characters.vessel = {
    id: "vessel",
    label: "Юджи native",
    englishLabel: "Vessel",
    roleId: "native-vessel-role",
    source: "discovered",
    verifiedAt: "2026-05-04T10:00:00.000Z",
    evidence: { nativeWriter: true },
  };

  assert.deepEqual(compareSotCharactersVsLegacy({ db: context.db, appConfig: context.appConfig }), []);
});

test("compareSotPanelsVsLegacy is clean after panel dual-write sync and flags later drift", () => {
  const context = createContext();
  syncLegacyPanelWrites(context.db);

  assert.deepEqual(compareSotPanelsVsLegacy({ db: context.db }), []);

  context.db.sot.panels.welcome.messageIds.main.value = "welcome-message-drift";

  assert.deepEqual(
    compareSotPanelsVsLegacy({ db: context.db }).map((entry) => `${entry.domain}:${entry.key}:${entry.status}`),
    ["panels:welcome:mismatch"]
  );
});

test("compareSotIntegrationsVsLegacy is clean after integration dual-write sync and flags later drift", () => {
  const context = createContext();
  syncLegacyIntegrationWrites(context.db);

  assert.deepEqual(compareSotIntegrationsVsLegacy({ db: context.db }), []);

  context.db.sot.integrations.elo.status = "drift";

  assert.deepEqual(
    compareSotIntegrationsVsLegacy({ db: context.db }).map((entry) => `${entry.domain}:${entry.key}:${entry.status}`),
    ["integrations:elo:mismatch"]
  );
});

test("compareSotPresentationVsLegacy is clean after presentation dual-write sync and flags later drift", () => {
  const context = createContext();
  const presentationOptions = createPresentationOptions();
  syncLegacyPresentationWrites(context.db, presentationOptions);

  assert.deepEqual(compareSotPresentationVsLegacy({ db: context.db, ...presentationOptions }), []);

  context.db.sot.presentation.welcome.title = "Welcome drift";

  assert.deepEqual(
    compareSotPresentationVsLegacy({ db: context.db, ...presentationOptions }).map((entry) => `${entry.domain}:${entry.key}:${entry.status}`),
    ["presentation:welcome:mismatch"]
  );
});

test("compareSotInfluenceVsLegacy is clean after influence dual-write sync and flags later drift", () => {
  const context = createContext();
  const influenceOptions = createInfluenceOptions();
  syncLegacyInfluenceWrites(context.db, influenceOptions);

  assert.deepEqual(compareSotInfluenceVsLegacy({ db: context.db, ...influenceOptions }), []);

  context.db.sot.influence.tiers[5] = 999;

  assert.deepEqual(
    compareSotInfluenceVsLegacy({ db: context.db, ...influenceOptions }).map((entry) => `${entry.domain}:${entry.key}:${entry.status}`),
    ["influence:current:mismatch"]
  );
});