"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  INTEGRATION_MODE_DORMANT,
  SHARED_PROFILE_VERSION,
  ensureSharedProfile,
  normalizeIntegrationState,
  syncSharedProfiles,
} = require("../src/integrations/shared-profile");

test("ensureSharedProfile migrates onboarding fields into domains and summary", () => {
  const legacyProfile = {
    userId: "100",
    displayName: "Sukuna",
    username: "ryomen",
    mainCharacterIds: ["honored_one", "honored_one", "vessel"],
    mainCharacterLabels: ["Honored One", "Vessel"],
    characterRoleIds: ["10", "20", "20"],
    approvedKills: "3120",
    killTier: "3",
    accessGrantedAt: "2026-05-01T10:00:00.000Z",
    lastSubmissionStatus: "approved",
  };

  const result = ensureSharedProfile(legacyProfile, legacyProfile.userId);

  assert.equal(result.profile.sharedProfileVersion, SHARED_PROFILE_VERSION);
  assert.deepEqual(result.profile.mainCharacterIds, ["honored_one", "vessel"]);
  assert.deepEqual(result.profile.domains.onboarding.mainCharacterIds, ["honored_one", "vessel"]);
  assert.deepEqual(result.profile.domains.onboarding.characterRoleIds, ["10", "20"]);
  assert.equal(result.profile.domains.onboarding.approvedKills, 3120);
  assert.equal(result.profile.domains.onboarding.killTier, 3);
  assert.equal(result.profile.summary.preferredDisplayName, "Sukuna");
  assert.equal(result.profile.summary.onboarding.hasAccess, true);
  assert.equal(result.profile.summary.onboarding.mainsCount, 2);
  assert.equal(result.profile.summary.elo.hasRating, false);
  assert.equal(result.profile.summary.tierlist.hasSubmission, false);
});

test("syncSharedProfiles backfills missing shared state and keeps onboarding snapshot synced", () => {
  const db = {
    profiles: {
      "100": {
        userId: "100",
        username: "megumi",
        mainCharacterIds: ["ten_shadows"],
        mainCharacterLabels: ["Ten Shadows"],
        approvedKills: 999,
        killTier: 1,
      },
    },
  };

  const first = syncSharedProfiles(db);
  assert.equal(first.mutated, true);
  assert.equal(db.profiles["100"].domains.onboarding.approvedKills, 999);
  assert.equal(db.profiles["100"].summary.onboarding.killTier, 1);

  db.profiles["100"].approvedKills = 7000;
  db.profiles["100"].killTier = 4;
  db.profiles["100"].mainCharacterIds = ["ten_shadows", "vessel"];
  db.profiles["100"].mainCharacterLabels = ["Ten Shadows", "Vessel"];

  const second = syncSharedProfiles(db);
  assert.equal(second.mutated, true);
  assert.equal(db.profiles["100"].domains.onboarding.approvedKills, 7000);
  assert.equal(db.profiles["100"].domains.onboarding.killTier, 4);
  assert.equal(db.profiles["100"].summary.onboarding.mainsCount, 2);
});

test("normalizeIntegrationState creates dormant elo and tierlist scaffolding", () => {
  const result = normalizeIntegrationState({
    elo: {
      mode: "active",
      status: "migrated",
      sourcePath: "./legacy/elo-db.json",
      submitPanel: { channelId: "123", messageId: "456" },
      graphicBoard: { channelId: "234", messageId: "567", lastUpdated: "2026-05-01T12:00:00.000Z" },
    },
    tierlist: {
      status: "weird-status",
      dashboard: { channelId: "999", messageId: "888" },
      summary: { channelId: "777", messageId: "666", lastUpdated: "2026-05-01T12:30:00.000Z" },
    },
  });

  assert.equal(result.integrations.elo.mode, INTEGRATION_MODE_DORMANT);
  assert.equal(result.integrations.elo.status, "migrated");
  assert.equal(result.integrations.elo.submitPanel.channelId, "123");
  assert.equal(result.integrations.elo.graphicBoard.lastUpdated, "2026-05-01T12:00:00.000Z");
  assert.equal(result.integrations.tierlist.mode, INTEGRATION_MODE_DORMANT);
  assert.equal(result.integrations.tierlist.status, "not_started");
  assert.equal(result.integrations.tierlist.dashboard.channelId, "999");
  assert.equal(result.integrations.tierlist.summary.messageId, "666");
});