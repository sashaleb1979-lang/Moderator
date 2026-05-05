"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { syncSotShadowState } = require("../src/sot/loader");
const { compareSotVsLegacy, summarizeCompareMismatches } = require("../src/sot/legacy-bridge/compare");

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
        killTierRoleIds: {
          3: "tier-3-config",
        },
      },
      characters: [
        { id: "vessel", label: "Vessel" },
      ],
    },
    db: {
      config: {
        welcomePanel: {
          channelId: "welcome-channel",
          messageId: "welcome-message",
        },
        reviewChannelId: "review-channel",
        tierlistBoard: {
          text: {
            channelId: "tier-text-channel",
            messageId: "tier-main-message",
            messageIdSummary: "tier-summary-message",
            messageIdPages: "tier-pages-message",
          },
          graphic: {
            channelId: "tier-graphic-channel",
            messageId: "tier-graphic-message",
            lastUpdated: "2026-05-03T12:00:00.000Z",
          },
        },
        notificationChannelId: "log-channel",
        generatedRoles: {
          characters: {
            vessel: "role-vessel",
          },
          characterLabels: {
            vessel: "Юджи",
          },
          tiers: {
            3: "tier-3-generated",
          },
        },
        presentation: {
          welcome: {
            title: "Welcome title",
          },
        },
        nonJjsUi: {
          title: "Captcha title",
        },
        onboardMode: {
          value: "peace",
        },
        integrations: {
          elo: {
            status: "ready",
            sourcePath: "elo/db.json",
            roleGrantEnabled: false,
            submitPanel: {
              channelId: "elo-submit-channel",
              messageId: "elo-submit-message",
            },
          },
          tierlist: {
            status: "idle",
            sourcePath: "tierlist/state.json",
            summary: {
              channelId: "tierlist-summary-channel",
              messageId: "tierlist-summary-message",
            },
          },
        },
      },
    },
  };
}

test("compareSotVsLegacy returns no mismatches when db.sot is an up-to-date legacy shadow", () => {
  const context = createContext();
  syncSotShadowState(context.db, { appConfig: context.appConfig });

  assert.deepEqual(compareSotVsLegacy(context), []);
});

test("compareSotVsLegacy reports persisted SoT drift against legacy-backed channels, characters, and presentation", () => {
  const context = createContext();
  syncSotShadowState(context.db, { appConfig: context.appConfig });

  context.db.sot.channels.review.value = "review-drift";
  context.db.sot.characters.vessel.label = "Wrong label";
  context.db.sot.presentation.welcome.title = "Wrong welcome";

  const mismatches = compareSotVsLegacy(context);

  assert.deepEqual(
    mismatches
      .filter((entry) => ["channels:review", "characters:vessel", "presentation:welcome"].includes(`${entry.domain}:${entry.key}`))
      .map((entry) => `${entry.domain}:${entry.key}:${entry.status}`),
    [
      "channels:review:mismatch",
      "characters:vessel:mismatch",
      "presentation:welcome:mismatch",
    ]
  );
  assert.equal(mismatches.find((entry) => entry.domain === "channels" && entry.key === "review").expected.value, "review-channel");
  assert.equal(mismatches.find((entry) => entry.domain === "characters" && entry.key === "vessel").expected.label, "Юджи");
});

test("compareSotVsLegacy marks extra persisted SoT entries that are absent from legacy state", () => {
  const context = createContext();
  syncSotShadowState(context.db, { appConfig: context.appConfig });

  context.db.sot.characters.extra_entry = {
    id: "extra_entry",
    label: "Extra",
    englishLabel: "Extra",
    roleId: "role-extra",
    source: "manual",
    verifiedAt: null,
  };

  const mismatches = compareSotVsLegacy(context);
  const extra = mismatches.find((entry) => entry.domain === "characters" && entry.key === "extra_entry");

  assert.equal(extra.status, "extra-in-sot");
  assert.equal(extra.actual.roleId, "role-extra");
  assert.equal(extra.expected, null);
});

test("compareSotVsLegacy keeps influence clean when the legacy bridge is seeded with non-default multipliers", () => {
  const context = createContext();
  const influence = {
    default: 7,
    tiers: {
      1: 1,
      2: 2,
      3: 3,
      4: 4,
      5: 5,
    },
  };

  syncSotShadowState(context.db, { appConfig: context.appConfig, influence });

  assert.deepEqual(compareSotVsLegacy({ ...context, influence }), []);
});

test("summarizeCompareMismatches groups counts by domain and builds a bounded preview", () => {
  const summary = summarizeCompareMismatches([
    { domain: "channels", key: "review", status: "mismatch" },
    { domain: "roles", key: "accessNormal", status: "mismatch" },
    { domain: "roles", key: "killTier.5", status: "missing-in-sot" },
  ], { limit: 2 });

  assert.equal(summary.total, 3);
  assert.deepEqual(summary.countsByDomain, {
    channels: 1,
    roles: 2,
  });
  assert.deepEqual(summary.preview, [
    "channels.review:mismatch",
    "roles.accessNormal:mismatch",
  ]);
});