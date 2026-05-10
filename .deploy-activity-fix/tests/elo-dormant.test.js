"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  applyDormantEloSync,
  clearDormantEloSync,
  importDormantEloSyncFromFile,
  normalizeLegacyEloDb,
} = require("../src/integrations/elo-dormant");

test("normalizeLegacyEloDb keeps only relevant config, ratings, and submissions fields", () => {
  const normalized = normalizeLegacyEloDb({
    config: {
      submitPanel: { channelId: "111", messageId: "222" },
      graphicTierlist: { dashboardChannelId: "333", dashboardMessageId: "444", lastUpdated: 1714564800000 },
    },
    ratings: {
      user1: { elo: "73", tier: "4", name: "Gojo", username: "satoru", proofUrl: "https://proof", avatarUrl: "https://avatar" },
    },
    submissions: {
      sub1: { id: "sub1", userId: "user1", elo: 73, tier: 4, status: "approved", createdAt: "2026-05-01T10:00:00.000Z" },
    },
  });

  assert.equal(normalized.config.submitPanel.channelId, "111");
  assert.equal(normalized.config.graphicTierlist.dashboardMessageId, "444");
  assert.equal(normalized.config.graphicTierlist.lastUpdated, "2024-05-01T12:00:00.000Z");
  assert.equal(normalized.ratings.user1.elo, 73);
  assert.equal(normalized.ratings.user1.tier, 4);
  assert.equal(normalized.submissions.sub1.status, "approved");
});

test("applyDormantEloSync projects ratings and latest submissions into shared profiles and integration state", () => {
  const db = {
    config: {
      integrations: {
        elo: {
          sourcePath: "legacy/elo-db.json",
        },
      },
    },
    profiles: {
      user1: {
        userId: "user1",
        displayName: "Existing Name",
        approvedKills: 3200,
        killTier: 3,
      },
      staleUser: {
        userId: "staleUser",
        domains: {
          elo: {
            currentElo: 55,
            currentTier: 3,
          },
        },
      },
    },
  };

  const result = applyDormantEloSync(db, {
    config: {
      submitPanel: { channelId: "submit-1", messageId: "submit-msg" },
      graphicTierlist: { dashboardChannelId: "graphic-1", dashboardMessageId: "graphic-msg", lastUpdated: "2026-05-01T15:00:00.000Z" },
    },
    ratings: {
      user1: { userId: "user1", name: "Gojo", username: "satoru", elo: 110, tier: 5, proofUrl: "https://proof/approved", updatedAt: "2026-05-01T15:30:00.000Z" },
    },
    submissions: {
      oldPending: { id: "oldPending", userId: "user1", status: "pending", elo: 90, tier: 4, createdAt: "2026-05-01T14:00:00.000Z" },
      latestApproved: {
        id: "latestApproved",
        userId: "user1",
        status: "approved",
        elo: 110,
        tier: 5,
        createdAt: "2026-05-01T15:00:00.000Z",
        reviewedAt: "2026-05-01T15:10:00.000Z",
        reviewChannelId: "review-1",
        reviewMessageId: "review-msg",
        reviewAttachmentUrl: "https://proof/review",
      },
      user2Pending: {
        id: "user2Pending",
        userId: "user2",
        name: "Yuji",
        username: "itadori",
        status: "pending",
        elo: 40,
        tier: 3,
        createdAt: "2026-05-01T16:00:00.000Z",
        screenshotUrl: "https://proof/pending",
      },
    },
  }, {
    sourcePath: "legacy/elo-db.json",
    syncedAt: "2026-05-01T16:30:00.000Z",
  });

  assert.equal(result.importedUserCount, 2);
  assert.equal(result.syncedProfiles, 2);
  assert.equal(db.config.integrations.elo.status, "in_progress");
  assert.equal(db.config.integrations.elo.submitPanel.channelId, "submit-1");
  assert.equal(db.config.integrations.elo.graphicBoard.messageId, "graphic-msg");
  assert.equal(db.config.integrations.elo.lastImportAt, "2026-05-01T16:30:00.000Z");
  assert.equal(db.sot.integrations.elo.status, "in_progress");
  assert.equal(db.sot.integrations.elo.submitPanel.channelId, "submit-1");

  assert.equal(db.profiles.user1.displayName, "Existing Name");
  assert.equal(db.profiles.user1.domains.elo.currentElo, 110);
  assert.equal(db.profiles.user1.domains.elo.currentTier, 5);
  assert.equal(db.profiles.user1.domains.elo.lastSubmissionId, "latestApproved");
  assert.equal(db.profiles.user1.domains.elo.lastSubmissionStatus, "approved");
  assert.equal(db.profiles.user1.domains.elo.lastSubmissionCreatedAt, "2026-05-01T15:00:00.000Z");
  assert.equal(db.profiles.user1.domains.elo.lastSubmissionElo, 110);
  assert.equal(db.profiles.user1.domains.elo.lastSubmissionTier, 5);
  assert.equal(db.profiles.user1.domains.elo.reviewChannelId, "review-1");
  assert.equal(db.profiles.user1.summary.elo.currentElo, 110);
  assert.equal(db.profiles.user1.summary.elo.hasRating, true);

  assert.equal(db.profiles.user2.displayName, "Yuji");
  assert.equal(db.profiles.user2.username, "itadori");
  assert.equal(db.profiles.user2.domains.elo.currentElo, null);
  assert.equal(db.profiles.user2.domains.elo.lastSubmissionStatus, "pending");
  assert.equal(db.profiles.user2.domains.elo.lastSubmissionCreatedAt, "2026-05-01T16:00:00.000Z");
  assert.equal(db.profiles.user2.domains.elo.lastSubmissionElo, 40);
  assert.equal(db.profiles.user2.domains.elo.lastSubmissionTier, 3);
  assert.equal(db.profiles.user2.domains.elo.proofUrl, "https://proof/pending");
  assert.equal(db.profiles.user2.summary.elo.hasRating, false);

  assert.equal(db.profiles.staleUser.domains.elo.currentElo, null);
  assert.equal(db.profiles.staleUser.summary.elo.hasRating, false);
});

test("importDormantEloSyncFromFile reads a legacy db file relative to baseDir", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "moderator-elo-"));
  const legacyPath = path.join(tempDir, "elo-db.json");
  fs.writeFileSync(legacyPath, JSON.stringify({
    ratings: {
      user3: { userId: "user3", name: "Megumi", username: "fushiguro", elo: 70, tier: 4 },
    },
    submissions: {},
    config: {
      submitPanel: { channelId: "submit-x", messageId: "submit-y" },
      graphicTierlist: { dashboardChannelId: "graphic-x", dashboardMessageId: "graphic-y" },
    },
  }), "utf8");

  const db = { config: { integrations: {} }, profiles: {} };
  const result = importDormantEloSyncFromFile(db, {
    sourcePath: "elo-db.json",
    baseDir: tempDir,
    syncedAt: "2026-05-01T17:00:00.000Z",
  });

  assert.equal(result.imported, true);
  assert.equal(result.error, null);
  assert.equal(db.config.integrations.elo.submitPanel.messageId, "submit-y");
  assert.equal(db.profiles.user3.domains.elo.currentElo, 70);
  assert.equal(db.profiles.user3.summary.elo.currentTier, 4);
});

test("clearDormantEloSync resets integration state and removes stale elo projections", () => {
  const db = {
    config: {
      integrations: {
        elo: {
          sourcePath: "legacy/elo-db.json",
          status: "in_progress",
          lastImportAt: "2026-05-01T15:00:00.000Z",
          submitPanel: { channelId: "submit", messageId: "msg" },
          graphicBoard: { channelId: "graphic", messageId: "graphic-msg", lastUpdated: "2026-05-01T16:00:00.000Z" },
        },
      },
    },
    profiles: {
      user1: {
        userId: "user1",
        domains: {
          elo: { currentElo: 70, currentTier: 4 },
        },
      },
    },
  };

  const result = clearDormantEloSync(db, { syncedAt: "2026-05-01T18:00:00.000Z", sourcePath: "" });

  assert.equal(result.clearedProfiles, 1);
  assert.equal(db.config.integrations.elo.sourcePath, "");
  assert.equal(db.config.integrations.elo.status, "not_started");
  assert.equal(db.config.integrations.elo.lastImportAt, null);
  assert.equal(db.config.integrations.elo.submitPanel.channelId, "");
  assert.equal(db.sot.integrations.elo.sourcePath, "");
  assert.equal(db.sot.integrations.elo.status, "not_started");
  assert.equal(db.profiles.user1.domains.elo.currentElo, null);
  assert.equal(db.profiles.user1.summary.elo.hasRating, false);
});

test("applyDormantEloSync preserves resolver-backed integration fields over stale legacy shadow", () => {
  const db = {
    config: {
      integrations: {
        elo: {
          mode: "legacy-stale",
          roleGrantEnabled: true,
        },
      },
    },
    sot: {
      integrations: {
        elo: {
          mode: "native-manual",
          roleGrantEnabled: false,
        },
      },
    },
    profiles: {},
  };

  applyDormantEloSync(db, {
    config: {
      submitPanel: { channelId: "submit-1", messageId: "submit-msg" },
      graphicTierlist: { dashboardChannelId: "graphic-1", dashboardMessageId: "graphic-msg" },
    },
    ratings: {},
    submissions: {},
  }, {
    sourcePath: "legacy/elo-db.json",
    syncedAt: "2026-05-01T16:30:00.000Z",
  });

  assert.equal(db.sot.integrations.elo.mode, "native-manual");
  assert.equal(db.sot.integrations.elo.roleGrantEnabled, false);
  assert.equal(db.config.integrations.elo.mode, "native-manual");
  assert.equal(db.config.integrations.elo.roleGrantEnabled, false);
});