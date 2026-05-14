"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { diagnoseSotState } = require("../src/sot/diagnostics");

test("diagnoseSotState summarizes resolver-backed channel role and character statuses", () => {
  const report = diagnoseSotState({
    db: {
      sot: {
        channels: {
          review: { value: "review-live", source: "manual", verifiedAt: null },
        },
        roles: {
          moderator: { value: "moderator-live", source: "manual", verifiedAt: null },
          accessNormal: null,
          accessWartime: null,
          accessNonJjs: null,
          killTier: { 1: null, 2: null, 3: null, 4: null, 5: null },
          legacyEloTier: { 1: null, 2: null, 3: null, 4: null },
        },
        characters: {
          honored_one: {
            id: "honored_one",
            label: "Годжо",
            englishLabel: "Honored One",
            roleId: "role-gojo",
            source: "manual",
          },
        },
      },
    },
    appConfig: {
      characters: [
        { id: "honored_one", label: "Honored One" },
      ],
    },
    guildSnapshot: {
      channelIds: ["review-live"],
      roleIds: ["role-gojo"],
      verifiedAt: "2026-05-03T12:15:00.000Z",
    },
  });

  assert.equal(report.channels.entries.find((entry) => entry.slot === "review").status, "ok");
  assert.equal(report.roles.entries.find((entry) => entry.slot === "moderator").status, "stale");
  assert.equal(Boolean(report.roles.entries.find((entry) => entry.slot === "killMilestone.20k")), true);
  assert.equal(report.characters.entries.find((entry) => entry.id === "honored_one").status, "ok");
  assert.equal(report.characters.entries.find((entry) => entry.id === "honored_one").verifiedAt, "2026-05-03T12:15:00.000Z");
  assert.equal(report.summary.liveChannels, 1);
  assert.equal(report.summary.staleCharacters, 0);
});

test("diagnoseSotState surfaces ambiguous and unresolved character recovery states", () => {
  const report = diagnoseSotState({
    appConfig: {
      characters: [
        { id: "vessel", label: "Vessel" },
        { id: "ten_shadows", label: "Ten Shadows" },
      ],
    },
    profiles: {
      user_1: { mainCharacterIds: ["vessel"] },
      user_2: { mainCharacterIds: ["vessel"] },
      user_3: { mainCharacterIds: ["ten_shadows"] },
    },
    guildSnapshot: {
      guildRoles: [
        { id: "role_a", name: "Юджи", memberUserIds: ["user_1"] },
        { id: "role_b", name: "Сукуна", memberUserIds: ["user_2"] },
      ],
      roleIds: ["role_a", "role_b"],
    },
  });

  assert.equal(report.characters.ambiguousCount, 1);
  assert.equal(report.characters.unresolvedCount, 1);
  assert.equal(report.characters.entries.find((entry) => entry.id === "vessel").status, "ambiguous");
  assert.equal(report.characters.entries.find((entry) => entry.id === "ten_shadows").status, "unresolved");
});

test("diagnoseSotState exposes panel and integration snapshots from legacy-backed state", () => {
  const report = diagnoseSotState({
    db: {
      config: {
        welcomePanel: {
          channelId: "welcome-channel",
          messageId: "welcome-message",
        },
        integrations: {
          elo: {
            status: "ready",
            sourcePath: "elo/db.json",
            submitPanel: {
              channelId: "elo-submit-channel",
              messageId: "elo-submit-message",
            },
          },
          tierlist: {
            status: "idle",
            sourcePath: "tierlist/state.json",
            dashboard: {
              channelId: "tierlist-dashboard-channel",
              messageId: "tierlist-dashboard-message",
            },
          },
        },
      },
    },
    appConfig: {
      channels: {
        welcomeChannelId: "welcome-config",
      },
    },
  });

  assert.equal(report.panels.entries.find((entry) => entry.slot === "welcome").channelId, "welcome-channel");
  assert.equal(report.integrations.entries.find((entry) => entry.slot === "elo").status, "ready");
  assert.equal(report.integrations.entries.find((entry) => entry.slot === "elo").sourcePath, "elo/db.json");
  assert.equal(report.integrations.entries.find((entry) => entry.slot === "elo").submitPanel.channelId, "elo-submit-channel");
  assert.equal(report.integrations.entries.find((entry) => entry.slot === "elo").submitPanel.messageId, "elo-submit-message");
  assert.equal(report.integrations.entries.find((entry) => entry.slot === "tierlist").dashboard.channelId, "tierlist-dashboard-channel");
  assert.equal(report.integrations.entries.find((entry) => entry.slot === "tierlist").dashboard.messageId, "tierlist-dashboard-message");
  assert.equal(report.summary.trackedPanels >= 3, true);
  assert.equal(report.summary.trackedIntegrationPanels >= 2, true);
});