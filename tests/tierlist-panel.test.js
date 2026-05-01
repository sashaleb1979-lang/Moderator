"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getDormantTierlistEntries,
  getDormantTierlistPanelSnapshot,
  getDormantTierlistProfileSnapshot,
} = require("../src/integrations/tierlist-panel");

test("getDormantTierlistEntries returns only meaningful tierlist projections", () => {
  const entries = getDormantTierlistEntries({
    profiles: {
      user1: {
        userId: "user1",
        displayName: "Gojo",
        domains: {
          tierlist: {
            mainId: "gojo",
            mainName: "Gojo Satoru",
            submittedAt: "2026-05-01T10:00:00.000Z",
            influenceMultiplier: 2.5,
          },
        },
      },
      user2: {
        userId: "user2",
        username: "megumi",
        domains: {
          tierlist: {},
        },
      },
    },
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].userId, "user1");
  assert.equal(entries[0].mainName, "Gojo Satoru");
  assert.equal(entries[0].influenceMultiplier, 2.5);
});

test("getDormantTierlistPanelSnapshot summarizes integration and strongest influence entry", () => {
  const snapshot = getDormantTierlistPanelSnapshot({
    config: {
      integrations: {
        tierlist: {
          sourcePath: "./tierlist/state.json",
          status: "in_progress",
          lastImportAt: "2026-05-01T12:00:00.000Z",
          lastSyncAt: "2026-05-01T12:01:00.000Z",
          dashboard: { channelId: "111", messageId: "222", lastUpdated: "2026-05-01T12:02:00.000Z" },
          summary: { channelId: "333", messageId: "444", lastUpdated: "2026-05-01T12:03:00.000Z" },
        },
      },
    },
    profiles: {
      user1: {
        userId: "user1",
        displayName: "Gojo",
        domains: {
          tierlist: {
            mainId: "gojo",
            submittedAt: "2026-05-01T11:00:00.000Z",
            influenceMultiplier: 4,
            lockUntil: "2999-01-01T00:00:00.000Z",
          },
        },
      },
      user2: {
        userId: "user2",
        displayName: "Yuji",
        domains: {
          tierlist: {
            mainId: "yuji",
            submittedAt: "2026-05-01T10:00:00.000Z",
            influenceMultiplier: 2,
          },
        },
      },
    },
  });

  assert.equal(snapshot.sourcePath, "./tierlist/state.json");
  assert.equal(snapshot.dashboard.channelId, "111");
  assert.equal(snapshot.summary.messageId, "444");
  assert.equal(snapshot.trackedProfiles, 2);
  assert.equal(snapshot.submittedProfiles, 2);
  assert.equal(snapshot.mainSelectedProfiles, 2);
  assert.equal(snapshot.lockedProfiles, 1);
  assert.equal(snapshot.strongestInfluence.userId, "user1");
});

test("getDormantTierlistProfileSnapshot returns exact user snapshot", () => {
  const snapshot = getDormantTierlistProfileSnapshot({
    profiles: {
      user7: {
        userId: "user7",
        displayName: "Nobara",
        domains: {
          tierlist: {
            mainId: "nobara",
            mainName: "Nobara Kugisaki",
            submittedAt: "2026-05-01T09:00:00.000Z",
            lockUntil: "2026-05-02T09:00:00.000Z",
            influenceMultiplier: 3,
            influenceRoleId: "role-7",
            dashboardSyncedAt: "2026-05-01T12:00:00.000Z",
            summarySyncedAt: "2026-05-01T12:05:00.000Z",
          },
        },
      },
    },
  }, "user7");

  assert.equal(snapshot.userId, "user7");
  assert.equal(snapshot.mainId, "nobara");
  assert.equal(snapshot.mainName, "Nobara Kugisaki");
  assert.equal(snapshot.influenceMultiplier, 3);
  assert.equal(snapshot.influenceRoleId, "role-7");
});