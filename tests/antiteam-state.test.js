"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  closeAntiteamTicket,
  createAntiteamTicketFromDraft,
  ensureAntiteamState,
  incrementHelperStats,
  matchRobloxFriendsToDiscordProfiles,
  recordAntiteamHelper,
  setAntiteamDraft,
} = require("../src/antiteam/state");

test("antiteam state normalizes config, drafts, tickets and helper stats", () => {
  const db = {
    sot: {
      antiteam: {
        config: {
          battalionRoleId: "battalion-role",
          battalionLeadRoleId: "lead-role",
          missionAutoArchiveMinutes: 90,
        },
      },
    },
  };
  const { state, mutated } = ensureAntiteamState(db);

  assert.equal(mutated, true);
  assert.equal(state.config.missionAutoArchiveMinutes, 60);
  assert.equal(state.config.missionAutoCloseMinutes, 120);
  assert.equal(state.config.clanPingRoles[0].key, "battalion");
  assert.equal(state.config.clanPingRoles.find((role) => role.key === "battalion").roleId, "battalion-role");
  assert.equal(state.config.clanPingRoles.find((role) => role.key === "battalion_lead").roleId, "lead-role");
  assert.deepEqual(state.tickets, {});
  assert.deepEqual(state.stats.helpers, {});
});

test("antiteam ticket lifecycle records helpers and closes mission", () => {
  const db = {};
  const draft = setAntiteamDraft(db, "author-1", {
    userTag: "Author",
    roblox: { userId: "101", username: "Anchor" },
    level: "low",
    count: "2",
    description: "enemy nick 2k",
  }, { now: "2026-05-16T10:00:00.000Z" });

  const ticket = createAntiteamTicketFromDraft(db, draft, {
    id: "ticket-1",
    now: "2026-05-16T10:01:00.000Z",
    friendEligibleDiscordUserIds: ["helper-1"],
  });
  assert.equal(ticket.id, "ticket-1");
  assert.equal(db.sot.antiteam.drafts["author-1"], undefined);
  assert.deepEqual(ticket.friendEligibleDiscordUserIds, ["helper-1"]);

  recordAntiteamHelper(db, "ticket-1", {
    userId: "helper-1",
    discordTag: "Helper",
    linkKind: "friend_direct",
  }, { now: "2026-05-16T10:02:00.000Z" });
  incrementHelperStats(db, "helper-1", {
    responded: 1,
    linkGranted: 1,
    lastTicketId: "ticket-1",
  }, { now: "2026-05-16T10:02:00.000Z" });

  const closed = closeAntiteamTicket(db, "ticket-1", {
    now: "2026-05-16T10:03:00.000Z",
    closedBy: "author-1",
    summaryText: "won",
    confirmedHelperIds: ["helper-1"],
  });

  assert.equal(closed.status, "closed");
  assert.equal(closed.closeSummary.text, "won");
  assert.equal(db.sot.antiteam.stats.helpers["helper-1"].responded, 1);
});

test("matchRobloxFriendsToDiscordProfiles only returns verified matching profiles", () => {
  const profiles = {
    "discord-1": {
      domains: {
        roblox: { userId: "101", verificationStatus: "verified" },
      },
    },
    "discord-2": {
      domains: {
        roblox: { userId: "102", verificationStatus: "pending" },
      },
    },
    "discord-3": {
      domains: {
        roblox: { userId: "103", verificationStatus: "verified" },
      },
    },
  };

  assert.deepEqual(matchRobloxFriendsToDiscordProfiles(profiles, [
    { userId: 101 },
    { id: 102 },
    { id: 999 },
  ]), ["discord-1"]);
});
