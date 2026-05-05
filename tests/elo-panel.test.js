"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getDormantEloPanelSnapshot,
  getDormantEloPendingEntries,
  getDormantEloProfileSnapshot,
} = require("../src/integrations/elo-panel");

test("getDormantEloPanelSnapshot summarizes imported elo profiles and panel state", () => {
  const snapshot = getDormantEloPanelSnapshot({
    config: {
      integrations: {
        elo: {
          sourcePath: "legacy/elo-db.json",
          status: "in_progress",
          lastImportAt: "2026-05-01T15:30:00.000Z",
          lastSyncAt: "2026-05-01T16:00:00.000Z",
          submitPanel: { channelId: "submit-1", messageId: "submit-msg" },
          graphicBoard: { channelId: "graphic-1", messageId: "graphic-msg", lastUpdated: "2026-05-01T16:10:00.000Z" },
        },
      },
    },
    profiles: {
      user1: {
        userId: "user1",
        displayName: "Gojo",
        domains: {
          elo: {
            currentElo: 110,
            currentTier: 5,
            lastSubmissionStatus: "approved",
            lastSubmissionId: "sub-approved",
            lastSubmissionCreatedAt: "2026-05-01T15:00:00.000Z",
            lastSubmissionElo: 110,
            lastSubmissionTier: 5,
          },
        },
      },
      user2: {
        userId: "user2",
        displayName: "Yuji",
        domains: {
          elo: {
            currentElo: null,
            currentTier: null,
            lastSubmissionStatus: "pending",
            lastSubmissionId: "sub-pending",
            lastSubmissionCreatedAt: "2026-05-01T16:00:00.000Z",
            lastSubmissionElo: 40,
            lastSubmissionTier: 3,
          },
        },
      },
      user3: {
        userId: "user3",
        displayName: "Megumi",
      },
    },
  });

  assert.equal(snapshot.sourcePath, "legacy/elo-db.json");
  assert.equal(snapshot.status, "in_progress");
  assert.equal(snapshot.trackedProfiles, 2);
  assert.equal(snapshot.ratedProfiles, 1);
  assert.equal(snapshot.pendingProfiles, 1);
  assert.equal(snapshot.topEntry.displayName, "Gojo");
  assert.equal(snapshot.topEntry.currentElo, 110);
  assert.equal(snapshot.submitPanel.messageId, "submit-msg");
  assert.equal(snapshot.graphicBoard.channelId, "graphic-1");
});

test("getDormantEloPanelSnapshot prefers persisted SoT integration panel channels while keeping legacy fallback message ids", () => {
  const snapshot = getDormantEloPanelSnapshot({
    sot: {
      integrations: {
        elo: {
          submitPanel: {
            channelId: "submit-sot",
          },
          graphicBoard: {
            channelId: "graphic-sot",
          },
        },
      },
    },
    config: {
      integrations: {
        elo: {
          sourcePath: "legacy/elo-db.json",
          status: "in_progress",
          submitPanel: { channelId: "submit-legacy", messageId: "submit-msg" },
          graphicBoard: { channelId: "graphic-legacy", messageId: "graphic-msg", lastUpdated: "2026-05-01T16:10:00.000Z" },
        },
      },
    },
  });

  assert.equal(snapshot.submitPanel.channelId, "submit-sot");
  assert.equal(snapshot.submitPanel.messageId, "submit-msg");
  assert.equal(snapshot.graphicBoard.channelId, "graphic-sot");
  assert.equal(snapshot.graphicBoard.messageId, "graphic-msg");
});

test("getDormantEloProfileSnapshot returns a specific imported elo profile", () => {
  const db = {
    profiles: {
      user1: {
        userId: "user1",
        displayName: "Gojo",
        domains: {
          elo: {
            currentElo: 110,
            currentTier: 5,
            lastSubmissionStatus: "approved",
            lastSubmissionId: "sub-approved",
            proofUrl: "https://proof/gojo",
          },
        },
      },
    },
  };

  const profile = getDormantEloProfileSnapshot(db, "user1");

  assert.equal(profile.displayName, "Gojo");
  assert.equal(profile.currentElo, 110);
  assert.equal(profile.lastSubmissionId, "sub-approved");
  assert.equal(profile.proofUrl, "https://proof/gojo");
});

test("getDormantEloPendingEntries returns pending entries sorted by latest submission time", () => {
  const pending = getDormantEloPendingEntries({
    profiles: {
      user1: {
        userId: "user1",
        displayName: "Yuji",
        domains: {
          elo: {
            lastSubmissionStatus: "pending",
            lastSubmissionId: "sub-1",
            lastSubmissionCreatedAt: "2026-05-01T15:00:00.000Z",
          },
        },
      },
      user2: {
        userId: "user2",
        displayName: "Megumi",
        domains: {
          elo: {
            lastSubmissionStatus: "pending",
            lastSubmissionId: "sub-2",
            lastSubmissionCreatedAt: "2026-05-01T16:00:00.000Z",
          },
        },
      },
      user3: {
        userId: "user3",
        displayName: "Gojo",
        domains: {
          elo: {
            lastSubmissionStatus: "approved",
            currentElo: 120,
          },
        },
      },
    },
  }, 10);

  assert.equal(pending.length, 2);
  assert.equal(pending[0].userId, "user2");
  assert.equal(pending[1].userId, "user1");
});