"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  applyRobloxAccountSnapshot,
  buildRobloxProfileUrl,
  INTEGRATION_MODE_DORMANT,
  SHARED_PROFILE_VERSION,
  deriveProfileMainView,
  ensureSharedProfile,
  normalizeRobloxDomainState,
  normalizeIntegrationState,
  normalizeVerificationDomainState,
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
    robloxUsername: "RynexV",
    robloxUserId: "123456",
    verificationStatus: "verified",
  };

  const result = ensureSharedProfile(legacyProfile, legacyProfile.userId);

  assert.equal(result.profile.sharedProfileVersion, SHARED_PROFILE_VERSION);
  assert.deepEqual(result.profile.mainCharacterIds, ["honored_one", "vessel"]);
  assert.deepEqual(result.profile.domains.onboarding.mainCharacterIds, ["honored_one", "vessel"]);
  assert.deepEqual(result.profile.domains.onboarding.raw.mainCharacterIds, ["honored_one", "honored_one", "vessel"]);
  assert.deepEqual(result.profile.domains.onboarding.raw.mainCharacterLabels, ["Honored One", "Vessel"]);
  assert.deepEqual(result.profile.domains.onboarding.raw.characterRoleIds, ["10", "20", "20"]);
  assert.deepEqual(result.profile.domains.onboarding.characterRoleIds, ["10", "20"]);
  assert.equal(result.profile.domains.onboarding.approvedKills, 3120);
  assert.equal(result.profile.domains.onboarding.killTier, 3);
  assert.equal(result.profile.summary.preferredDisplayName, "Sukuna");
  assert.equal(result.profile.summary.onboarding.hasAccess, true);
  assert.equal(result.profile.summary.onboarding.mainsCount, 2);
  assert.equal(result.profile.summary.elo.hasRating, false);
  assert.equal(result.profile.summary.tierlist.hasSubmission, false);
  assert.deepEqual(result.profile.domains.roblox, {
    username: "RynexV",
    displayName: null,
    userId: "123456",
    avatarUrl: null,
    profileUrl: "https://www.roblox.com/users/123456/profile",
    createdAt: null,
    description: null,
    hasVerifiedBadge: null,
    accountStatus: null,
    verificationStatus: "verified",
    verifiedAt: null,
    updatedAt: null,
    lastSubmissionId: null,
    lastReviewedAt: null,
    reviewedBy: null,
    source: null,
    lastRefreshAt: null,
    refreshStatus: null,
    refreshError: null,
    usernameHistory: [
      {
        name: "RynexV",
        firstSeenAt: null,
        lastSeenAt: null,
      },
    ],
    displayNameHistory: [],
    serverFriends: {
      userIds: [],
      computedAt: null,
    },
    playtime: {
      totalJjsMinutes: 0,
      jjsMinutes7d: 0,
      jjsMinutes30d: 0,
      sessionCount: 0,
      currentSessionStartedAt: null,
      lastSeenInJjsAt: null,
      dailyBuckets: {},
    },
    coPlay: {
      peers: [],
      computedAt: null,
    },
  });
  assert.equal(result.profile.summary.roblox.hasVerifiedAccount, true);
  assert.equal(result.profile.summary.roblox.username, "RynexV");
  assert.equal(result.profile.summary.roblox.profileUrl, "https://www.roblox.com/users/123456/profile");
  assert.equal(result.profile.summary.roblox.serverFriendsCount, 0);
  assert.equal(result.profile.summary.roblox.totalJjsMinutes, 0);
});

test("ensureSharedProfile keeps the first raw onboarding snapshot immutable across later syncs", () => {
  const first = ensureSharedProfile({
    userId: "100",
    mainCharacterIds: ["honored_one", "honored_one", "vessel"],
    mainCharacterLabels: ["Honored One", "Vessel"],
    characterRoleIds: ["10", "20", "20"],
  }, "100").profile;

  first.mainCharacterIds = ["vessel"];
  first.mainCharacterLabels = ["Vessel"];
  first.characterRoleIds = ["99"];

  const second = ensureSharedProfile(first, "100").profile;

  assert.deepEqual(second.mainCharacterIds, ["vessel"]);
  assert.deepEqual(second.characterRoleIds, ["99"]);
  assert.deepEqual(second.domains.onboarding.raw.mainCharacterIds, ["honored_one", "honored_one", "vessel"]);
  assert.deepEqual(second.domains.onboarding.raw.mainCharacterLabels, ["Honored One", "Vessel"]);
  assert.deepEqual(second.domains.onboarding.raw.characterRoleIds, ["10", "20", "20"]);
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

test("ensureSharedProfile normalizes the activity domain and exposes an activity summary", () => {
  const result = ensureSharedProfile({
    userId: "300",
    username: "todo",
    domains: {
      activity: {
        baseActivityScore: "64",
        activityScore: "72",
        activityScoreMultiplier: "1.125",
        trustScore: "540",
        messages7d: "28",
        messages30d: "110",
        messages90d: "180",
        sessions7d: 6,
        sessions30d: 18,
        sessions90d: 31,
        activeDays7d: 5,
        activeDays30d: 12,
        activeDays90d: 20,
        activeWatchedChannels30d: 3,
        weightedMessages30d: "120.5",
        globalEffectiveSessions30d: "19.25",
        effectiveActiveDays30d: 11.5,
        daysAbsent: 2,
        guildJoinedAt: "2026-05-01T10:00:00.000Z",
        daysSinceGuildJoin: "8.5",
        lastSeenAt: "2026-05-08T10:00:00.000Z",
        roleEligibilityStatus: "eligible",
        roleEligibleForActivityRole: true,
        desiredActivityRoleKey: "stable",
        appliedActivityRoleKey: "active",
        manualOverride: true,
        autoRoleFrozen: true,
        recalculatedAt: "2026-05-09T12:00:00.000Z",
        lastRoleAppliedAt: "2026-05-08T15:00:00.000Z",
      },
    },
  }, "300");

  assert.equal(result.profile.domains.activity.baseActivityScore, 64);
  assert.equal(result.profile.domains.activity.activityScore, 72);
  assert.equal(result.profile.domains.activity.activityScoreMultiplier, 1.125);
  assert.equal(result.profile.domains.activity.trustScore, 540);
  assert.equal(result.profile.domains.activity.messages7d, 28);
  assert.equal(result.profile.domains.activity.messages30d, 110);
  assert.equal(result.profile.domains.activity.messages90d, 180);
  assert.equal(result.profile.domains.activity.sessions7d, 6);
  assert.equal(result.profile.domains.activity.sessions30d, 18);
  assert.equal(result.profile.domains.activity.sessions90d, 31);
  assert.equal(result.profile.domains.activity.activeDays7d, 5);
  assert.equal(result.profile.domains.activity.activeDays30d, 12);
  assert.equal(result.profile.domains.activity.activeDays90d, 20);
  assert.equal(result.profile.domains.activity.activeWatchedChannels30d, 3);
  assert.equal(result.profile.domains.activity.weightedMessages30d, 120.5);
  assert.equal(result.profile.domains.activity.globalEffectiveSessions30d, 19.25);
  assert.equal(result.profile.domains.activity.effectiveActiveDays30d, 11.5);
  assert.equal(result.profile.domains.activity.daysAbsent, 2);
  assert.equal(result.profile.domains.activity.guildJoinedAt, "2026-05-01T10:00:00.000Z");
  assert.equal(result.profile.domains.activity.daysSinceGuildJoin, 8.5);
  assert.equal(result.profile.domains.activity.lastSeenAt, "2026-05-08T10:00:00.000Z");
  assert.equal(result.profile.domains.activity.roleEligibilityStatus, "eligible");
  assert.equal(result.profile.domains.activity.roleEligibleForActivityRole, true);
  assert.equal(result.profile.domains.activity.desiredActivityRoleKey, "stable");
  assert.equal(result.profile.domains.activity.appliedActivityRoleKey, "active");
  assert.equal(result.profile.domains.activity.manualOverride, true);
  assert.equal(result.profile.domains.activity.autoRoleFrozen, true);
  assert.equal(result.profile.domains.activity.recalculatedAt, "2026-05-09T12:00:00.000Z");
  assert.equal(result.profile.domains.activity.lastRoleAppliedAt, "2026-05-08T15:00:00.000Z");
  assert.equal(result.profile.summary.activity.baseActivityScore, 64);
  assert.equal(result.profile.summary.activity.activityScore, 72);
  assert.equal(result.profile.summary.activity.activityScoreMultiplier, 1.125);
  assert.equal(result.profile.summary.activity.trustScore, 540);
  assert.equal(result.profile.summary.activity.messages7d, 28);
  assert.equal(result.profile.summary.activity.messages30d, 110);
  assert.equal(result.profile.summary.activity.messages90d, 180);
  assert.equal(result.profile.summary.activity.sessions7d, 6);
  assert.equal(result.profile.summary.activity.sessions30d, 18);
  assert.equal(result.profile.summary.activity.sessions90d, 31);
  assert.equal(result.profile.summary.activity.activeDays7d, 5);
  assert.equal(result.profile.summary.activity.activeDays30d, 12);
  assert.equal(result.profile.summary.activity.activeDays90d, 20);
  assert.equal(result.profile.summary.activity.weightedMessages30d, 120.5);
  assert.equal(result.profile.summary.activity.globalEffectiveSessions30d, 19.25);
  assert.equal(result.profile.summary.activity.effectiveActiveDays30d, 11.5);
  assert.equal(result.profile.summary.activity.daysAbsent, 2);
  assert.equal(result.profile.summary.activity.guildJoinedAt, "2026-05-01T10:00:00.000Z");
  assert.equal(result.profile.summary.activity.daysSinceGuildJoin, 8.5);
  assert.equal(result.profile.summary.activity.lastSeenAt, "2026-05-08T10:00:00.000Z");
  assert.equal(result.profile.summary.activity.roleEligibilityStatus, "eligible");
  assert.equal(result.profile.summary.activity.roleEligibleForActivityRole, true);
  assert.equal(result.profile.summary.activity.desiredActivityRoleKey, "stable");
  assert.equal(result.profile.summary.activity.appliedActivityRoleKey, "active");
  assert.equal(result.profile.summary.activity.manualOverride, true);
  assert.equal(result.profile.summary.activity.autoRoleFrozen, true);
  assert.equal(result.profile.summary.activity.recalculatedAt, "2026-05-09T12:00:00.000Z");
  assert.equal(result.profile.summary.activity.lastRoleAppliedAt, "2026-05-08T15:00:00.000Z");
});

test("normalizeVerificationDomainState keeps autonomous verification state separate from onboarding and roblox", () => {
  assert.deepEqual(normalizeVerificationDomainState({
    status: "manual_review",
    decision: "manual_review",
    assignedAt: "2026-05-01T10:00:00.000Z",
    startedAt: "2026-05-01T10:05:00.000Z",
    completedAt: "2026-05-01T10:10:00.000Z",
    reportDueAt: "2026-05-08T10:00:00.000Z",
    reportSentAt: "2026-05-08T12:00:00.000Z",
    oauthUserId: "oauth-1",
    oauthUsername: "discord-user",
    observedGuildIds: ["guild-1", "guild-1", "guild-2"],
    matchedEnemyGuildIds: ["enemy-1", "enemy-1"],
    matchedEnemyUserIds: ["user-1"],
    matchedEnemyInviteCodes: ["invite-1"],
    matchedEnemyInviterUserIds: ["inviter-1"],
    manualTags: ["fresh", "fresh", "watch"],
    reviewedBy: "mod#1",
    reviewedAt: "2026-05-08T12:01:00.000Z",
    decisionReason: "manual check",
    lastError: "none",
  }), {
    status: "manual_review",
    decision: "manual_review",
    assignedAt: "2026-05-01T10:00:00.000Z",
    startedAt: "2026-05-01T10:05:00.000Z",
    completedAt: "2026-05-01T10:10:00.000Z",
    reportDueAt: "2026-05-08T10:00:00.000Z",
    reportSentAt: "2026-05-08T12:00:00.000Z",
    lastState: null,
    oauthUserId: "oauth-1",
    oauthUsername: "discord-user",
    oauthAvatarUrl: null,
    matchedEnemyGuildIds: ["enemy-1"],
    matchedEnemyUserIds: ["user-1"],
    matchedEnemyInviteCodes: ["invite-1"],
    matchedEnemyInviterUserIds: ["inviter-1"],
    manualTags: ["fresh", "watch"],
    observedGuildIds: ["guild-1", "guild-2"],
    observedGuildNames: [],
    reviewedBy: "mod#1",
    reviewedAt: "2026-05-08T12:01:00.000Z",
    decisionReason: "manual check",
    lastError: "none",
  });
});

test("ensureSharedProfile exposes verification summary without leaking it into onboarding or roblox", () => {
  const result = ensureSharedProfile({
    userId: "400",
    domains: {
      verification: {
        status: "pending",
        decision: "none",
        assignedAt: "2026-05-01T10:00:00.000Z",
        reportDueAt: "2026-05-08T10:00:00.000Z",
        oauthUsername: "verify-user",
        observedGuildIds: ["guild-1", "guild-2", "guild-3"],
        matchedEnemyGuildIds: ["enemy-1"],
        manualTags: ["watch"],
      },
    },
  }, "400");

  assert.equal(result.profile.sharedProfileVersion, SHARED_PROFILE_VERSION);
  assert.equal(result.profile.domains.verification.status, "pending");
  assert.equal(result.profile.domains.onboarding.accessGrantedAt, null);
  assert.equal(result.profile.domains.roblox.userId, null);
  assert.equal(result.profile.summary.verification.isBlocked, true);
  assert.equal(result.profile.summary.verification.isApproved, false);
  assert.equal(result.profile.summary.verification.oauthUsername, "verify-user");
  assert.equal(result.profile.summary.verification.observedGuildCount, 3);
  assert.equal(result.profile.summary.verification.matchedEnemyGuildCount, 1);
  assert.equal(result.profile.summary.verification.manualTagCount, 1);
});

test("deriveProfileMainView recalculates labels and role ids from current character entries", () => {
  const derived = deriveProfileMainView({
    mainCharacterIds: ["honored_one", "vessel"],
    mainCharacterLabels: ["Old Gojo", "Old Yuji"],
    characterRoleIds: ["stale-gojo", "stale-yuji"],
    domains: {
      onboarding: {
        raw: {
          mainCharacterLabels: ["Raw Gojo", "Raw Yuji"],
        },
      },
    },
  }, [
    { id: "honored_one", label: "Gojo Satoru", roleId: "role-gojo" },
    { id: "vessel", label: "Yuji Itadori", roleId: "role-yuji" },
  ]);

  assert.deepEqual(derived.mainCharacterIds, ["honored_one", "vessel"]);
  assert.deepEqual(derived.mainCharacterLabels, ["Gojo Satoru", "Yuji Itadori"]);
  assert.deepEqual(derived.characterRoleIds, ["role-gojo", "role-yuji"]);
});

test("deriveProfileMainView keeps label fallback for missing entries but drops stale role ids", () => {
  const derived = deriveProfileMainView({
    mainCharacterIds: ["archived_main"],
    mainCharacterLabels: ["Archived Main"],
    characterRoleIds: ["stale-role"],
    domains: {
      onboarding: {
        raw: {
          mainCharacterLabels: ["Raw Archived Main"],
        },
      },
    },
  }, []);

  assert.deepEqual(derived.mainCharacterIds, ["archived_main"]);
  assert.deepEqual(derived.mainCharacterLabels, ["Archived Main"]);
  assert.deepEqual(derived.characterRoleIds, []);
});

test("normalizeIntegrationState creates dormant elo, tierlist, and verification scaffolding", () => {
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
    verification: {
      enabled: true,
      status: "in_progress",
      callbackBaseUrl: "https://example.com/oauth/discord",
      verificationChannelId: "verify-room",
      reportChannelId: "report-room",
      lastSyncAt: "2026-05-09T09:00:00.000Z",
      stageTexts: {
        entry: "Пройди verify",
      },
      riskRules: {
        enemyGuildIds: ["guild-1", "guild-1", "guild-2"],
        manualTags: ["fresh", "fresh", "watch"],
      },
      deadline: {
        pendingDays: 7,
        reportOnly: true,
      },
      entryMessage: {
        channelId: "verify-room",
        messageId: "verify-message",
        lastUpdated: "2026-05-09T10:00:00.000Z",
      },
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
  assert.equal(result.integrations.verification.mode, INTEGRATION_MODE_DORMANT);
  assert.equal(result.integrations.verification.status, "in_progress");
  assert.equal(result.integrations.verification.enabled, true);
  assert.equal(result.integrations.verification.callbackBaseUrl, "https://example.com/oauth/discord");
  assert.equal(result.integrations.verification.verificationChannelId, "verify-room");
  assert.equal(result.integrations.verification.entryMessage.messageId, "verify-message");
  assert.deepEqual(result.integrations.verification.riskRules.enemyGuildIds, ["guild-1", "guild-2"]);
  assert.deepEqual(result.integrations.verification.riskRules.manualTags, ["fresh", "watch"]);
  assert.equal(result.integrations.verification.deadline.pendingDays, 7);
  assert.equal(result.integrations.verification.deadline.reportOnly, true);
});

test("normalizeRobloxDomainState defaults to unverified when binding is missing", () => {
  assert.deepEqual(normalizeRobloxDomainState({ username: "RynexV" }), {
    username: "RynexV",
    displayName: null,
    userId: null,
    avatarUrl: null,
    profileUrl: null,
    createdAt: null,
    description: null,
    hasVerifiedBadge: null,
    accountStatus: null,
    verificationStatus: "unverified",
    verifiedAt: null,
    updatedAt: null,
    lastSubmissionId: null,
    lastReviewedAt: null,
    reviewedBy: null,
    source: null,
    lastRefreshAt: null,
    refreshStatus: null,
    refreshError: null,
    usernameHistory: [
      {
        name: "RynexV",
        firstSeenAt: null,
        lastSeenAt: null,
      },
    ],
    displayNameHistory: [],
    serverFriends: {
      userIds: [],
      computedAt: null,
    },
    playtime: {
      totalJjsMinutes: 0,
      jjsMinutes7d: 0,
      jjsMinutes30d: 0,
      sessionCount: 0,
      currentSessionStartedAt: null,
      lastSeenInJjsAt: null,
      dailyBuckets: {},
    },
    coPlay: {
      peers: [],
      computedAt: null,
    },
  });
});

test("ensureSharedProfile does not leak Discord identity fields into Roblox domain without an explicit binding", () => {
  const result = ensureSharedProfile({
    userId: "200",
    username: "discord_ryomen",
    displayName: "Discord Sukuna",
  }, "200");

  assert.equal(result.profile.domains.roblox.username, null);
  assert.equal(result.profile.domains.roblox.displayName, null);
  assert.equal(result.profile.summary.roblox.hasVerifiedAccount, false);
  assert.equal(result.profile.summary.roblox.username, null);
});

test("ensureSharedProfile summary exposes rename, server friend, and frequent non-friend Roblox read fields", () => {
  const result = ensureSharedProfile({
    userId: "300",
    domains: {
      roblox: {
        username: "CurrentName",
        displayName: "Current Display",
        userId: "777",
        verificationStatus: "verified",
        usernameHistory: [
          { name: "CurrentName", firstSeenAt: null, lastSeenAt: null },
          { name: "OldName", firstSeenAt: "2026-05-01T00:00:00.000Z", lastSeenAt: "2026-05-08T00:00:00.000Z" },
        ],
        displayNameHistory: [
          { name: "Current Display", firstSeenAt: null, lastSeenAt: null },
          { name: "Old Display", firstSeenAt: "2026-05-02T00:00:00.000Z", lastSeenAt: "2026-05-09T00:00:00.000Z" },
        ],
        serverFriends: {
          userIds: ["friend-1", "friend-2"],
          computedAt: "2026-05-09T10:00:00.000Z",
        },
        playtime: {
          totalJjsMinutes: 180,
          jjsMinutes7d: 60,
          jjsMinutes30d: 120,
          sessionCount: 3,
          currentSessionStartedAt: "2026-05-09T12:00:00.000Z",
          lastSeenInJjsAt: "2026-05-09T12:10:00.000Z",
          dailyBuckets: {},
        },
        coPlay: {
          computedAt: "2026-05-09T12:12:00.000Z",
          peers: [
            {
              peerUserId: "infrequent-non-friend",
              isRobloxFriend: false,
              minutesTogether: 15,
              sessionsTogether: 1,
              sharedJjsSessionCount: 1,
              lastSeenTogetherAt: "2026-05-09T12:11:00.000Z",
            },
            {
              peerUserId: "frequent-non-friend",
              isRobloxFriend: false,
              minutesTogether: 75,
              sessionsTogether: 1,
              sharedJjsSessionCount: 1,
              lastSeenTogetherAt: "2026-05-09T12:12:00.000Z",
            },
            {
              peerUserId: "friend-peer",
              isRobloxFriend: true,
              minutesTogether: 90,
              sessionsTogether: 3,
              sharedJjsSessionCount: 3,
              lastSeenTogetherAt: "2026-05-09T12:13:00.000Z",
            },
          ],
        },
      },
    },
  }, "300");

  assert.equal(result.profile.summary.roblox.currentUsername, "CurrentName");
  assert.equal(result.profile.summary.roblox.currentDisplayName, "Current Display");
  assert.equal(result.profile.summary.roblox.previousUsername, "OldName");
  assert.equal(result.profile.summary.roblox.previousDisplayName, "Old Display");
  assert.equal(result.profile.summary.roblox.renameCount, 1);
  assert.equal(result.profile.summary.roblox.displayRenameCount, 1);
  assert.equal(result.profile.summary.roblox.lastRenameSeenAt, "2026-05-09T00:00:00.000Z");
  assert.deepEqual(result.profile.summary.roblox.serverFriendsUserIds, ["friend-1", "friend-2"]);
  assert.equal(result.profile.summary.roblox.serverFriendsCount, 2);
  assert.equal(result.profile.summary.roblox.serverFriendsComputedAt, "2026-05-09T10:00:00.000Z");
  assert.equal(result.profile.summary.roblox.nonFriendPeerCount, 2);
  assert.equal(result.profile.summary.roblox.frequentNonFriendCount, 1);
  assert.equal(result.profile.summary.roblox.sessionCount, 3);
  assert.equal(result.profile.summary.roblox.currentSessionStartedAt, "2026-05-09T12:00:00.000Z");
  assert.deepEqual(result.profile.summary.roblox.topCoPlayPeers.map((entry) => entry.peerUserId), [
    "friend-peer",
    "frequent-non-friend",
    "infrequent-non-friend",
  ]);
  assert.equal(result.profile.summary.roblox.topCoPlayPeers[1].isFrequentNonFriend, true);
  assert.equal(result.profile.summary.roblox.topCoPlayPeers[2].isFrequentNonFriend, false);
});

test("normalizeRobloxDomainState keeps current names first and normalizes social and playtime scaffolding", () => {
  const result = normalizeRobloxDomainState({
    robloxUsername: "NewName",
    robloxDisplayName: "Display New",
    robloxUserId: "321",
    isBanned: false,
    robloxUsernameHistory: [
      { name: "OldName", firstSeenAt: "2026-05-01T00:00:00.000Z", lastSeenAt: "2026-05-02T00:00:00.000Z" },
      { name: "newname" },
    ],
    robloxDisplayNameHistory: ["Display Old", "Display New"],
    robloxServerFriends: {
      userIds: ["u1", "u2", "u2"],
      computedAt: "2026-05-03T00:00:00.000Z",
    },
    robloxPlaytime: {
      totalJjsMinutes: 123,
      jjsMinutes7d: 45,
      jjsMinutes30d: 67,
      sessionCount: 8,
      currentSessionStartedAt: "2026-05-04T00:00:00.000Z",
      lastSeenInJjsAt: "2026-05-05T00:00:00.000Z",
      dailyBuckets: {},
    },
    robloxCoPlay: {
      computedAt: "2026-05-06T00:00:00.000Z",
      peers: [
        { peerUserId: "friend-1", minutesTogether: 90, sessionsTogether: 4, daysTogether: 2, sharedJjsSessionCount: 4, lastSeenTogetherAt: "2026-05-06T01:00:00.000Z", isRobloxFriend: true },
        { peerUserId: "nonfriend-1", minutesTogether: 140, sessionsTogether: 6, daysTogether: 3, sharedJjsSessionCount: 5, lastSeenTogetherAt: "2026-05-06T02:00:00.000Z", isRobloxFriend: false },
      ],
    },
  });

  assert.equal(result.profileUrl, buildRobloxProfileUrl("321"));
  assert.equal(result.accountStatus, "active");
  assert.deepEqual(result.usernameHistory, [
    { name: "NewName", firstSeenAt: null, lastSeenAt: null },
    { name: "OldName", firstSeenAt: "2026-05-01T00:00:00.000Z", lastSeenAt: "2026-05-02T00:00:00.000Z" },
  ]);
  assert.deepEqual(result.displayNameHistory, [
    { name: "Display New", firstSeenAt: null, lastSeenAt: null },
    { name: "Display Old", firstSeenAt: null, lastSeenAt: null },
  ]);
  assert.deepEqual(result.serverFriends, {
    userIds: ["u1", "u2"],
    computedAt: "2026-05-03T00:00:00.000Z",
  });
  assert.equal(result.playtime.totalJjsMinutes, 123);
  assert.equal(result.playtime.sessionCount, 8);
  assert.equal(result.coPlay.peers.length, 2);
  assert.equal(result.coPlay.peers[1].isRobloxFriend, false);
});

test("applyRobloxAccountSnapshot writes canonical pending Roblox state and preserves existing social scaffolding", () => {
  const profile = {
    domains: {
      roblox: {
        username: "OldName",
        displayName: "Old Display",
        userId: "111",
        verificationStatus: "verified",
        verifiedAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
        serverFriends: {
          userIds: ["friend-1"],
          computedAt: "2026-05-02T00:00:00.000Z",
        },
        playtime: {
          totalJjsMinutes: 33,
          jjsMinutes7d: 10,
          jjsMinutes30d: 20,
          sessionCount: 2,
          currentSessionStartedAt: null,
          lastSeenInJjsAt: "2026-05-03T00:00:00.000Z",
          dailyBuckets: {},
        },
        coPlay: {
          peers: [{ peerUserId: "peer-1", minutesTogether: 10 }],
          computedAt: "2026-05-04T00:00:00.000Z",
        },
      },
    },
  };

  const result = applyRobloxAccountSnapshot(profile, {
    username: "NewName",
    displayName: "New Display",
    userId: "222",
    avatarUrl: "https://cdn.example/avatar.png",
    createdAt: "2020-01-01T00:00:00.000Z",
    description: "Bound by moderator",
    hasVerifiedBadge: true,
    accountStatus: "active",
  }, {
    verificationStatus: "pending",
    verifiedAt: null,
    updatedAt: "2026-05-05T00:00:00.000Z",
    lastSubmissionId: "sub-1",
    lastReviewedAt: null,
    reviewedBy: null,
    source: "onboarding",
  });

  assert.equal(result.userId, "222");
  assert.equal(result.profileUrl, buildRobloxProfileUrl("222"));
  assert.equal(result.avatarUrl, "https://cdn.example/avatar.png");
  assert.equal(result.createdAt, "2020-01-01T00:00:00.000Z");
  assert.equal(result.description, "Bound by moderator");
  assert.equal(result.hasVerifiedBadge, true);
  assert.equal(result.accountStatus, "active");
  assert.equal(result.verificationStatus, "pending");
  assert.equal(result.verifiedAt, null);
  assert.equal(result.lastSubmissionId, "sub-1");
  assert.equal(result.source, "onboarding");
  assert.equal(result.serverFriends.userIds[0], "friend-1");
  assert.equal(result.playtime.totalJjsMinutes, 33);
  assert.equal(result.coPlay.peers[0].peerUserId, "peer-1");
  assert.deepEqual(result.usernameHistory, [
    { name: "NewName", firstSeenAt: null, lastSeenAt: null },
    { name: "OldName", firstSeenAt: null, lastSeenAt: "2026-05-05T00:00:00.000Z" },
  ]);
  assert.deepEqual(result.displayNameHistory, [
    { name: "New Display", firstSeenAt: null, lastSeenAt: null },
    { name: "Old Display", firstSeenAt: null, lastSeenAt: "2026-05-05T00:00:00.000Z" },
  ]);
  assert.equal(profile.domains.roblox.userId, "222");
});

test("applyRobloxAccountSnapshot preserves existing verification timestamp when a failed review does not override it", () => {
  const profile = {
    domains: {
      roblox: {
        username: "StableName",
        userId: "123",
        verificationStatus: "verified",
        verifiedAt: "2026-05-01T00:00:00.000Z",
      },
    },
  };

  const result = applyRobloxAccountSnapshot(profile, {
    username: "StableName",
    userId: "123",
  }, {
    verificationStatus: "failed",
    updatedAt: "2026-05-10T00:00:00.000Z",
    lastSubmissionId: "sub-2",
    lastReviewedAt: "2026-05-10T00:00:00.000Z",
    reviewedBy: "mod#0001",
    source: "onboarding",
  });

  assert.equal(result.verificationStatus, "failed");
  assert.equal(result.verifiedAt, "2026-05-01T00:00:00.000Z");
  assert.equal(result.lastReviewedAt, "2026-05-10T00:00:00.000Z");
  assert.equal(result.reviewedBy, "mod#0001");
});