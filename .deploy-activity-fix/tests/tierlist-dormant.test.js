"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  applyDormantTierlistSync,
  clearDormantTierlistSync,
  normalizeLegacyTierlistState,
} = require("../src/integrations/tierlist-dormant");

test("normalizeLegacyTierlistState normalizes settings, users and final vote counts", () => {
  const result = normalizeLegacyTierlistState({
    settings: {
      channelId: "111",
      dashboardMessageId: "222",
      lastUpdated: 1714560000000,
      summaryChannelId: "333",
      summaryMessageId: "444",
      summaryLastUpdated: "2026-05-01T12:00:00.000Z",
    },
    users: {
      user1: {
        mainId: "gojo",
        lockUntil: 1714570000000,
        lastSubmitAt: 1714565000000,
        influenceMultiplier: "2.5",
        influenceRoleId: "999",
      },
    },
    finalVotes: {
      user1: { a: "S", b: "A" },
      user2: { c: "B" },
    },
  }, {
    characterCatalog: [{ id: "gojo", name: "Gojo Satoru" }],
  });

  assert.equal(result.settings.dashboard.channelId, "111");
  assert.equal(result.settings.dashboard.messageId, "222");
  assert.equal(result.settings.summary.messageId, "444");
  assert.equal(result.users.user1.mainId, "gojo");
  assert.equal(result.users.user1.influenceMultiplier, 2.5);
  assert.equal(result.finalVoteCounts.user1, 2);
  assert.equal(result.finalVoteCounts.user2, 1);
  assert.equal(result.characterNameById.get("gojo"), "Gojo Satoru");
});

test("applyDormantTierlistSync projects legacy tierlist state into shared profiles and integration snapshot", () => {
  const db = {
    config: {},
    profiles: {
      user1: {
        userId: "user1",
        displayName: "Yuji",
      },
      user9: {
        userId: "user9",
        domains: {
          tierlist: {
            mainId: "ghost",
            mainName: "Ghost",
          },
        },
      },
    },
  };

  const result = applyDormantTierlistSync(db, {
    settings: {
      channelId: "111",
      dashboardMessageId: "222",
      lastUpdated: "2026-05-01T12:00:00.000Z",
      summaryChannelId: "333",
      summaryMessageId: "444",
      summaryLastUpdated: "2026-05-01T12:30:00.000Z",
    },
    users: {
      user1: {
        mainId: "gojo",
        lastSubmitAt: "2026-05-01T11:00:00.000Z",
        lockUntil: "2026-05-02T11:00:00.000Z",
        influenceMultiplier: 2.5,
        influenceRoleId: "role-1",
      },
      user2: {
        mainId: "yuji",
        influenceMultiplier: 4,
      },
    },
    finalVotes: {
      user1: { c1: "S" },
      user3: { c2: "A", c3: "B" },
    },
  }, {
    sourcePath: "./tierlist/data/state.json",
    syncedAt: "2026-05-01T13:00:00.000Z",
    characterCatalog: [
      { id: "gojo", name: "Gojo Satoru" },
      { id: "yuji", label: "Yuji Itadori" },
    ],
  });

  assert.equal(result.importedUserCount, 3);
  assert.equal(result.syncedProfiles, 3);
  assert.equal(result.clearedProfiles, 1);
  assert.equal(db.config.integrations.tierlist.sourcePath, "./tierlist/data/state.json");
  assert.equal(db.config.integrations.tierlist.dashboard.channelId, "111");
  assert.equal(db.config.integrations.tierlist.summary.messageId, "444");
  assert.equal(db.sot.integrations.tierlist.sourcePath, "./tierlist/data/state.json");
  assert.equal(db.sot.integrations.tierlist.dashboard.channelId, "111");
  assert.equal(db.profiles.user1.domains.tierlist.mainId, "gojo");
  assert.equal(db.profiles.user1.domains.tierlist.mainName, "Gojo Satoru");
  assert.equal(db.profiles.user1.domains.tierlist.submittedAt, "2026-05-01T11:00:00.000Z");
  assert.equal(db.profiles.user1.domains.tierlist.influenceMultiplier, 2.5);
  assert.equal(db.profiles.user1.summary.tierlist.hasSubmission, true);
  assert.equal(db.profiles.user2.domains.tierlist.mainName, "Yuji Itadori");
  assert.equal(db.profiles.user2.domains.tierlist.submittedAt, null);
  assert.equal(db.profiles.user3.domains.tierlist.submittedAt, "2026-05-01T13:00:00.000Z");
  assert.equal(db.profiles.user3.summary.tierlist.hasSubmission, true);
  assert.equal(db.profiles.user9.domains.tierlist.mainId, null);
});

test("clearDormantTierlistSync clears projected tierlist domains and resets integration snapshot", () => {
  const db = {
    config: {
      integrations: {
        tierlist: {
          status: "in_progress",
          sourcePath: "./tierlist/state.json",
          lastImportAt: "2026-05-01T12:00:00.000Z",
          dashboard: { channelId: "111", messageId: "222", lastUpdated: "2026-05-01T12:10:00.000Z" },
          summary: { channelId: "333", messageId: "444", lastUpdated: "2026-05-01T12:20:00.000Z" },
        },
      },
    },
    profiles: {
      user1: {
        userId: "user1",
        domains: {
          tierlist: {
            mainId: "gojo",
            submittedAt: "2026-05-01T11:00:00.000Z",
          },
        },
      },
    },
  };

  const result = clearDormantTierlistSync(db, { syncedAt: "2026-05-01T13:30:00.000Z" });

  assert.equal(result.clearedProfiles, 1);
  assert.equal(db.config.integrations.tierlist.status, "not_started");
  assert.equal(db.config.integrations.tierlist.sourcePath, "");
  assert.equal(db.config.integrations.tierlist.lastImportAt, null);
  assert.equal(db.config.integrations.tierlist.dashboard.channelId, "");
  assert.equal(db.config.integrations.tierlist.summary.messageId, "");
  assert.equal(db.sot.integrations.tierlist.status, "not_started");
  assert.equal(db.sot.integrations.tierlist.sourcePath, "");
  assert.equal(db.profiles.user1.domains.tierlist.mainId, null);
  assert.equal(db.profiles.user1.summary.tierlist.hasSubmission, false);
});

test("applyDormantTierlistSync preserves resolver-backed integration fields over stale legacy shadow", () => {
  const db = {
    config: {
      integrations: {
        tierlist: {
          mode: "legacy-stale",
        },
      },
    },
    sot: {
      integrations: {
        tierlist: {
          mode: "native-manual",
        },
      },
    },
    profiles: {},
  };

  applyDormantTierlistSync(db, {
    settings: {
      channelId: "111",
      dashboardMessageId: "222",
      summaryChannelId: "333",
      summaryMessageId: "444",
    },
    users: {},
    finalVotes: {},
  }, {
    sourcePath: "./tierlist/data/state.json",
    syncedAt: "2026-05-01T13:00:00.000Z",
    characterCatalog: [],
  });

  assert.equal(db.sot.integrations.tierlist.mode, "native-manual");
  assert.equal(db.config.integrations.tierlist.mode, "native-manual");
});