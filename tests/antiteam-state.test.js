"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ANTITEAM_HELPER_REWARD_THRESHOLDS,
  closeAntiteamTicket,
  createAntiteamTicketFromDraft,
  clearHelperStats,
  deleteHelperStats,
  ensureAntiteamState,
  getRobloxConfirmation,
  incrementHelperStats,
  markRobloxConfirmed,
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
          helperRewardRoles: {
            "1": "role-one",
            "5": "<@&role-five>",
            role10: "role-ten",
          },
          missionAutoArchiveMinutes: 90,
          panel: {
            title: "Custom",
            accentColor: "#112233",
          },
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
  assert.equal(state.config.panel.title, "Custom");
  assert.equal(state.config.panel.accentColor, 0x112233);
  assert.deepEqual(ANTITEAM_HELPER_REWARD_THRESHOLDS, [1, 5, 10, 20, 50]);
  assert.equal(state.config.helperRewardRoles["1"], "role-one");
  assert.equal(state.config.helperRewardRoles["5"], "<@&role-five>");
  assert.equal(state.config.helperRewardRoles["10"], "role-ten");
  assert.equal(state.config.helperRewardRoles["20"], "");
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

test("antiteam draft and ticket preserve multiple photos with first-photo compatibility", () => {
  const db = {};
  const draft = setAntiteamDraft(db, "author-1", {
    userTag: "Author",
    roblox: { userId: "101", username: "Anchor" },
    description: "enemy nick 2k",
    photos: [{
      url: "https://cdn.discordapp.com/attachments/1/2/a.png",
      name: "a.png",
      contentType: "image/png",
    }, {
      url: "https://cdn.discordapp.com/attachments/1/2/b.webp",
      name: "b.webp",
      contentType: "image/webp",
    }],
  }, { now: "2026-05-16T10:00:00.000Z" });

  assert.equal(draft.photo.name, "a.png");
  assert.equal(draft.photos.length, 2);

  const ticket = createAntiteamTicketFromDraft(db, draft, {
    id: "ticket-photos",
    now: "2026-05-16T10:01:00.000Z",
  });

  assert.equal(ticket.photo.name, "a.png");
  assert.deepEqual(ticket.photos.map((photo) => photo.name), ["a.png", "b.webp"]);
});

test("antiteam helper stats can delete one helper or clear the aggregate table", () => {
  const db = {};
  incrementHelperStats(db, "helper-1", { responded: 2, linkGranted: 1 }, { now: "2026-05-16T10:00:00.000Z" });
  incrementHelperStats(db, "helper-2", { responded: 1, confirmedArrived: 1 }, { now: "2026-05-16T10:01:00.000Z" });

  assert.equal(deleteHelperStats(db, "helper-1"), true);
  assert.equal(deleteHelperStats(db, "missing"), false);
  assert.equal(db.sot.antiteam.stats.helpers["helper-1"], undefined);
  assert.equal(db.sot.antiteam.stats.helpers["helper-2"].confirmedArrived, 1);
  assert.equal(clearHelperStats(db), 1);
  assert.deepEqual(db.sot.antiteam.stats.helpers, {});
});

test("antiteam stores one-time Roblox confirmation per Discord user and account", () => {
  const db = {};
  const first = markRobloxConfirmed(db, "user-1", "101", { now: "2026-05-16T10:00:00.000Z" });

  assert.equal(first.robloxUserId, "101");
  assert.deepEqual(getRobloxConfirmation(db, "user-1"), {
    userId: "user-1",
    robloxUserId: "101",
    confirmedAt: "2026-05-16T10:00:00.000Z",
  });

  const { state } = ensureAntiteamState({
    sot: {
      antiteam: {
        robloxConfirmations: {
          "user-2": { robloxUserId: "202", confirmedAt: "bad-date" },
          "bad-user": { robloxUserId: "" },
        },
      },
    },
  });

  assert.equal(state.robloxConfirmations["user-2"].robloxUserId, "202");
  assert.equal(state.robloxConfirmations["bad-user"], undefined);
});

test("clan ticket keeps selected Discord anchor metadata", () => {
  const db = {};
  const draft = setAntiteamDraft(db, "caller-1", {
    kind: "clan",
    userTag: "Caller",
    anchorUserId: "anchor-1",
    anchorUserTag: "Anchor",
    roblox: { userId: "202", username: "AnchorRb" },
    description: "Клан держит сервер.",
  }, { now: "2026-05-16T10:00:00.000Z" });

  const ticket = createAntiteamTicketFromDraft(db, draft, {
    id: "ticket-clan",
    now: "2026-05-16T10:01:00.000Z",
  });

  assert.equal(ticket.kind, "clan");
  assert.equal(ticket.createdBy, "caller-1");
  assert.equal(ticket.anchorUserId, "anchor-1");
  assert.equal(ticket.anchorUserTag, "Anchor");
  assert.equal(ticket.roblox.username, "AnchorRb");
});

test("standard draft drops legacy anchor metadata", () => {
  const db = {};

  const draft = setAntiteamDraft(db, "author-1", {
    kind: "standard",
    userTag: "Author",
    anchorUserId: "anchor-1",
    anchorUserTag: "Anchor",
    roblox: { userId: "101", username: "AuthorRb" },
    description: "Обычная заявка без якоря.",
  }, { now: "2026-05-16T10:00:00.000Z" });

  assert.equal(draft.kind, "standard");
  assert.equal(draft.anchorUserId, "");
  assert.equal(draft.anchorUserTag, "");
  assert.equal(draft.roblox.username, "AuthorRb");
});

test("standard ticket drops legacy anchor metadata from draft", () => {
  const db = {};
  const draft = setAntiteamDraft(db, "author-1", {
    kind: "standard",
    userTag: "Author",
    anchorUserId: "anchor-1",
    anchorUserTag: "Anchor",
    roblox: { userId: "101", username: "AuthorRb" },
    level: "medium",
    count: "2-4",
    description: "Обычная заявка без якоря.",
  }, { now: "2026-05-16T10:00:00.000Z" });

  const ticket = createAntiteamTicketFromDraft(db, draft, {
    id: "ticket-standard",
    now: "2026-05-16T10:01:00.000Z",
  });

  assert.equal(ticket.kind, "standard");
  assert.equal(ticket.anchorUserId, "");
  assert.equal(ticket.anchorUserTag, "");
  assert.equal(ticket.roblox.username, "AuthorRb");
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
