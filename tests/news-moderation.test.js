"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  recordGuildBanEvent,
  recordMemberRemovalEvent,
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

test("recordMemberRemovalEvent captures ambiguous leave-or-kick removals", () => {
  const db = {};

  const result = recordMemberRemovalEvent({
    db,
    member: createMemberFixture({ displayName: "LeftAlpha" }),
    now: "2026-05-14T20:10:00.000Z",
  });

  assert.equal(result.action, "member_remove");
  assert.equal(db.sot.news.moderation.events.length, 1);
  assert.equal(db.sot.news.moderation.events[0].displayName, "LeftAlpha");
  assert.equal(db.sot.news.moderation.events[0].resolution, "leave_or_kick_ambiguous");
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