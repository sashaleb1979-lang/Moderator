"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { MessageFlags } = require("discord.js");

const { createProfileOperator } = require("../src/profile/operator");

function makeMember(roleIds = [], { userId = "user-1", username = "Sasha", displayName = "Sasha" } = {}) {
  const roles = roleIds.map((roleId, index) => ({
    id: roleId,
    position: roleIds.length - index,
    guild: { id: "guild-1" },
  }));
  return {
    guild: { id: "guild-1" },
    displayName,
    user: { id: userId, username },
    roles: {
      cache: new Map(roles.map((role) => [role.id, role])),
    },
  };
}

test("profile operator builds private payload from injected runtime readers", async () => {
  const operator = createProfileOperator({
    guildId: "guild-1",
    getViewerTagRoleIds: () => ["tag-role"],
    hasStaffBypass: () => false,
    getRequesterProfile: () => ({ domains: { activity: { desiredActivityRoleKey: "active" } } }),
    getTargetProfile: () => ({
      approvedKills: 120,
      killTier: 4,
      accessGrantedAt: "2026-05-01T10:00:00.000Z",
      mainCharacterIds: ["gojo"],
      mainCharacterLabels: ["Gojo"],
      summary: {
        preferredDisplayName: "Sasha",
        onboarding: { approvedKills: 120, killTier: 4 },
        activity: {
          appliedActivityRoleKey: "active",
          activityScore: 77,
          messages7d: 35,
          messages30d: 210,
        },
        elo: {
          currentElo: 145,
          currentTier: 2,
          lastSubmissionStatus: "approved",
        },
        tierlist: {
          mainName: "Gojo",
          influenceMultiplier: 1.2,
        },
        roblox: {
          hasVerifiedAccount: true,
          currentUsername: "GojoMain",
          profileUrl: "https://www.roblox.com/users/123/profile",
        },
        verification: {
          status: "verified",
          decision: "approved",
        },
      },
    }),
    getTargetDisplayName: () => "Sasha",
    fetchMember: async () => makeMember(["role-1", "role-2"], { userId: "user-1", username: "Sasha", displayName: "Sasha Display" }),
    fetchUser: async () => ({ id: "user-1", username: "Sasha", globalName: "Sasha Global" }),
    getPendingSubmissionForUser: () => null,
    getLatestSubmissionForUser: () => ({ reviewedAt: "2026-05-02T12:00:00.000Z" }),
    getApprovedEntries: () => [
      { userId: "user-2", displayName: "Top", approvedKills: 200 },
      { userId: "user-1", displayName: "Sasha", approvedKills: 120 },
    ],
    getRecentKillChangeForUser: () => ({
      userId: "user-1",
      from: 100,
      to: 120,
      fromAt: Date.parse("2026-05-01T00:00:00.000Z"),
      toAt: Date.parse("2026-05-10T00:00:00.000Z"),
    }),
    getEloProfile: () => ({ currentElo: 145, currentTier: 2, lastSubmissionStatus: "approved" }),
    getTierlistProfile: () => ({ mainName: "Gojo", influenceMultiplier: 1.2 }),
    getComboGuideState: () => ({
      generalTechsThreadId: "general-thread",
      characters: [{ id: "gojo", name: "Gojo", threadId: "thread-1" }],
    }),
  });

  const access = operator.resolveProfileAccessForRequester({
    requesterUserId: "requester",
    requesterMember: makeMember(["tag-role"], { userId: "requester", username: "Requester", displayName: "Requester" }),
    targetUserId: "user-1",
  });
  assert.equal(access.allowed, true);

  const payload = await operator.buildPrivateProfilePayload({
    targetUserId: "user-1",
    requesterUserId: "requester",
    isSelf: false,
  });

  assert.equal(payload.flags, MessageFlags.IsComponentsV2);
  const container = payload.components[0].toJSON();
  assert.equal(container.type, 17);
  assert.ok(container.components.some((component) => component.type === 10 && /# Профиль/.test(component.content)));
  assert.ok(container.components.some((component) => component.type === 10 && /### Обзор/.test(component.content)));
});

test("profile operator exposes deny payload text through the runtime seam", () => {
  const operator = createProfileOperator({
    getViewerTagRoleIds: () => ["tag-role"],
    hasStaffBypass: () => false,
    getRequesterProfile: () => ({ domains: { activity: { desiredActivityRoleKey: "active" } } }),
  });

  const access = operator.resolveProfileAccessForRequester({
    requesterUserId: "requester",
    requesterMember: makeMember([], { userId: "requester", username: "Requester", displayName: "Requester" }),
    targetUserId: "target",
  });

  assert.equal(access.allowed, false);
  assert.match(operator.getProfileAccessDeniedText(access), /серверным tag/i);
  assert.equal(operator.buildProfileAccessDeniedPayload(access).flags, MessageFlags.Ephemeral);
});