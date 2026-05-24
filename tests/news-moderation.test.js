"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  collectPendingMemberRemovalEvents,
  createMemberRemovalReconciliationId,
  reconcileMemberRemovalEvents,
  recordGuildBanEvent,
  recordMemberRemovalEvent,
  recordMemberTimeoutEvent,
} = require("../src/news/moderation");

function createMemberFixture(overrides = {}) {
  return {
    guild: { id: overrides.guildId || "guild-1" },
    id: overrides.userId || "user-1",
    displayName: overrides.displayName || "Alpha",
    user: {
      id: overrides.userId || "user-1",
      username: overrides.username || "alpha_user",
    },
  };
}

function createBanFixture(overrides = {}) {
  return {
    guild: { id: overrides.guildId || "guild-1" },
    user: {
      id: overrides.userId || "user-2",
      username: overrides.username || "banned_user",
      globalName: overrides.displayName || "BannedAlpha",
    },
  };
}

test("recordMemberRemovalEvent captures ambiguous leave-or-kick removals", async () => {
  const db = {};

  const result = await recordMemberRemovalEvent({
    db,
    member: createMemberFixture({ displayName: "LeftAlpha" }),
    now: "2026-05-14T20:10:00.000Z",
  });

  assert.equal(result.action, "member_remove");
  assert.equal(db.sot.news.moderation.events.length, 1);
  assert.equal(db.sot.news.moderation.events[0].displayName, "LeftAlpha");
  assert.equal(db.sot.news.moderation.events[0].resolution, "leave_or_kick_ambiguous");
});

test("recordMemberRemovalEvent captures confirmed kicks when audit reconciliation resolves them", async () => {
  const db = {};

  const result = await recordMemberRemovalEvent({
    db,
    member: createMemberFixture({ displayName: "KickAlpha" }),
    now: "2026-05-14T20:11:00.000Z",
    resolveRemovalResolution: async () => ({
      resolution: "kick_confirmed",
      reason: "kick by ModAlpha",
    }),
  });

  assert.equal(result.action, "member_remove");
  assert.equal(db.sot.news.moderation.events[0].resolution, "kick_confirmed");
  assert.equal(db.sot.news.moderation.events[0].reason, "kick by ModAlpha");
});

test("recordGuildBanEvent captures confirmed bans", () => {
  const db = {};

  const result = recordGuildBanEvent({
    db,
    ban: createBanFixture({ displayName: "BanAlpha" }),
    eventType: "ban_add",
    now: "2026-05-14T20:20:00.000Z",
  });

  assert.equal(result.action, "ban_add");
  assert.equal(db.sot.news.moderation.events.length, 1);
  assert.equal(db.sot.news.moderation.events[0].eventType, "ban_add");
  assert.equal(db.sot.news.moderation.events[0].resolution, "ban_confirmed");
  assert.equal(db.sot.news.runtime.lastModerationCaptureAt, "2026-05-14T20:20:00.000Z");
});

test("reconcileMemberRemovalEvents upgrades pending ambiguous removals when delayed resolutions arrive", () => {
  const db = {
    sot: {
      news: {
        moderation: {
          events: [
            {
              eventType: "member_remove",
              guildId: "guild-1",
              userId: "user-1",
              displayName: "KickLater",
              occurredAt: "2026-05-14T20:10:00.000Z",
              resolution: "leave_or_kick_ambiguous",
            },
            {
              eventType: "ban_add",
              guildId: "guild-1",
              userId: "user-2",
              displayName: "BanOther",
              occurredAt: "2026-05-14T20:11:00.000Z",
              resolution: "ban_confirmed",
            },
          ],
        },
      },
    },
  };

  const pending = collectPendingMemberRemovalEvents({ db, now: "2026-05-14T21:00:00.000Z" });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].reconciliationId, createMemberRemovalReconciliationId(db.sot.news.moderation.events[0]));

  const result = reconcileMemberRemovalEvents({
    db,
    resolutionsByEventId: {
      [pending[0].reconciliationId]: {
        resolution: "kick_confirmed",
        reason: "kick by ModLate",
      },
    },
  });

  assert.equal(result.pendingCount, 1);
  assert.equal(result.updatedCount, 1);
  assert.equal(db.sot.news.moderation.events[0].resolution, "kick_confirmed");
  assert.equal(db.sot.news.moderation.events[0].reason, "kick by ModLate");
});

test("recordGuildBanEvent captures confirmed unbans", () => {
  const db = {};

  const result = recordGuildBanEvent({
    db,
    ban: createBanFixture({ displayName: "UnbanAlpha" }),
    eventType: "ban_remove",
    now: "2026-05-14T20:30:00.000Z",
  });

  assert.equal(result.action, "ban_remove");
  assert.equal(db.sot.news.moderation.events[0].eventType, "ban_remove");
  assert.equal(db.sot.news.moderation.events[0].resolution, "unban_confirmed");
});

test("recordMemberTimeoutEvent captures timeout apply transitions", () => {
  const db = {};

  const result = recordMemberTimeoutEvent({
    db,
    oldMember: createMemberFixture({ displayName: "TimeoutAlpha" }),
    newMember: {
      ...createMemberFixture({ displayName: "TimeoutAlpha" }),
      communicationDisabledUntilTimestamp: Date.parse("2026-05-14T21:30:00.000Z"),
    },
    now: "2026-05-14T20:40:00.000Z",
  });

  assert.equal(result.action, "timeout_add");
  assert.equal(db.sot.news.moderation.events[0].eventType, "timeout_add");
  assert.equal(db.sot.news.moderation.events[0].resolution, "timeout_confirmed");
  assert.match(db.sot.news.moderation.events[0].reason, /2026-05-14T21:30:00.000Z/);
});

test("recordMemberTimeoutEvent captures timeout removal transitions", () => {
  const db = {};

  const result = recordMemberTimeoutEvent({
    db,
    oldMember: {
      ...createMemberFixture({ displayName: "TimeoutBeta" }),
      communicationDisabledUntilTimestamp: Date.parse("2026-05-14T21:30:00.000Z"),
    },
    newMember: createMemberFixture({ displayName: "TimeoutBeta" }),
    now: "2026-05-14T20:50:00.000Z",
  });

  assert.equal(result.action, "timeout_remove");
  assert.equal(db.sot.news.moderation.events[0].eventType, "timeout_remove");
  assert.equal(db.sot.news.moderation.events[0].resolution, "timeout_removed_confirmed");
  assert.match(db.sot.news.moderation.events[0].reason, /previously until/);
});