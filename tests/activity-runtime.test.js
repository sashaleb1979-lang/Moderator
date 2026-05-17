"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  flushActivityRuntime,
  recordActivityMessage,
  recordActivityVoiceState,
  rebuildActivitySnapshots,
  rebuildActivityUserSnapshot,
  resumeActivityRuntime,
} = require("../src/activity/runtime");
const { upsertWatchedChannel } = require("../src/activity/state");

function approxEqual(actual, expected, epsilon = 0.000001) {
  assert.equal(Math.abs(Number(actual) - Number(expected)) <= epsilon, true, `${actual} ~= ${expected}`);
}

function seedWatchedChannels(db) {
  upsertWatchedChannel(db, {
    channelId: "main-1",
    channelType: "main_chat",
    channelNameCache: "Main",
    now: "2026-05-01T00:00:00.000Z",
  });
  upsertWatchedChannel(db, {
    channelId: "small-1",
    channelType: "small_chat",
    channelNameCache: "Small",
    now: "2026-05-01T00:00:00.000Z",
  });
  upsertWatchedChannel(db, {
    channelId: "media-1",
    channelType: "media",
    channelNameCache: "Media",
    now: "2026-05-01T00:00:00.000Z",
  });
}

test("recordActivityMessage groups watched channels into one global session and rotates after the gap", () => {
  const db = {};
  seedWatchedChannels(db);

  recordActivityMessage({
    db,
    message: {
      guildId: "guild-1",
      userId: "user-1",
      channelId: "main-1",
      messageId: "m-1",
      createdAt: "2026-05-09T12:00:00.000Z",
    },
  });
  recordActivityMessage({
    db,
    message: {
      guildId: "guild-1",
      userId: "user-1",
      channelId: "small-1",
      messageId: "m-2",
      createdAt: "2026-05-09T12:15:00.000Z",
    },
  });
  recordActivityMessage({
    db,
    message: {
      guildId: "guild-1",
      userId: "user-1",
      channelId: "media-1",
      messageId: "m-3",
      createdAt: "2026-05-09T12:35:00.000Z",
    },
  });

  const rotated = recordActivityMessage({
    db,
    message: {
      guildId: "guild-1",
      userId: "user-1",
      channelId: "main-1",
      messageId: "m-4",
      createdAt: "2026-05-09T13:30:00.000Z",
    },
  });

  assert.equal(rotated.rotatedPreviousSession, true);
  assert.equal(db.sot.activity.globalUserSessions.length, 1);
  const firstSession = db.sot.activity.globalUserSessions[0];
  assert.equal(firstSession.guildId, "guild-1");
  assert.equal(firstSession.userId, "user-1");
  assert.equal(firstSession.messageCount, 3);
  approxEqual(firstSession.weightedMessageCount, 2.85);
  approxEqual(firstSession.effectiveValue, 0.7125);
  assert.equal(firstSession.mainChannelId, "main-1");
  assert.deepEqual(Object.keys(firstSession.channelBreakdown).sort(), ["main-1", "media-1", "small-1"]);
  assert.equal(db.sot.activity.runtime.openSessions["user-1"].messageCount, 1);
  assert.equal(db.sot.activity.runtime.openSessions["user-1"].startedAt, "2026-05-09T13:30:00.000Z");
});

test("recordActivityVoiceState tracks voice lifecycle, active voice time, and streaming time separately", () => {
  const db = {};

  recordActivityVoiceState({
    db,
    oldState: { guildId: "guild-1", userId: "user-1", channelId: null },
    newState: { guildId: "guild-1", userId: "user-1", channelId: "voice-main", selfMute: false },
    now: "2026-05-09T12:00:00.000Z",
  });
  recordActivityVoiceState({
    db,
    oldState: { guildId: "guild-1", userId: "user-1", channelId: "voice-main", selfMute: false },
    newState: { guildId: "guild-1", userId: "user-1", channelId: "voice-main", selfMute: true },
    now: "2026-05-09T12:10:00.000Z",
  });
  recordActivityVoiceState({
    db,
    oldState: { guildId: "guild-1", userId: "user-1", channelId: "voice-main", selfMute: true, streaming: false },
    newState: { guildId: "guild-1", userId: "user-1", channelId: "voice-main", selfMute: true, streaming: true },
    now: "2026-05-09T12:20:00.000Z",
  });
  recordActivityVoiceState({
    db,
    oldState: { guildId: "guild-1", userId: "user-1", channelId: "voice-main", selfMute: true, streaming: true },
    newState: { guildId: "guild-1", userId: "user-1", channelId: "voice-side", selfMute: false, streaming: true },
    now: "2026-05-09T12:25:00.000Z",
  });
  const leaveResult = recordActivityVoiceState({
    db,
    oldState: { guildId: "guild-1", userId: "user-1", channelId: "voice-side", selfMute: false, streaming: true },
    newState: { guildId: "guild-1", userId: "user-1", channelId: null },
    now: "2026-05-09T12:35:00.000Z",
  });

  assert.equal(leaveResult.action, "leave");
  assert.equal(db.sot.activity.runtime.openVoiceSessions["user-1"], undefined);
  assert.equal(db.sot.activity.globalVoiceSessions.length, 1);
  assert.equal(db.sot.activity.userVoiceDailyStats.length, 1);

  const finalizedSession = db.sot.activity.globalVoiceSessions[0];
  assert.equal(finalizedSession.durationSeconds, 2100);
  assert.equal(finalizedSession.activeVoiceDurationSeconds, 1200);
  assert.equal(finalizedSession.streamingDurationSeconds, 900);
  assert.equal(finalizedSession.videoDurationSeconds, 0);
  assert.equal(finalizedSession.moveCount, 1);
  assert.deepEqual(finalizedSession.enteredChannelIds, ["voice-main", "voice-side"]);

  const dailyRow = db.sot.activity.userVoiceDailyStats[0];
  assert.equal(dailyRow.voiceDurationSeconds, 2100);
  assert.equal(dailyRow.activeVoiceDurationSeconds, 1200);
  assert.equal(dailyRow.streamingDurationSeconds, 900);
  assert.equal(dailyRow.sessionsCount, 1);
});

test("rebuildActivityUserSnapshot projects open voice sessions into current metrics and score", () => {
  const db = {
    profiles: {
      "user-1": {
        userId: "user-1",
        username: "todo",
      },
    },
    sot: {
      activity: {
        config: {},
        watchedChannels: [],
        globalUserSessions: [],
        globalVoiceSessions: [],
        channelDailyStats: [],
        userChannelDailyStats: [],
        userVoiceDailyStats: [],
        userSnapshots: {},
        calibrationRuns: [],
        ops: { moderationAuditLog: [] },
        runtime: {
          openSessions: {},
          openVoiceSessions: {
            "user-1": {
              guildId: "guild-1",
              userId: "user-1",
              joinedAt: "2026-05-09T12:00:00.000Z",
              lastStateChangedAt: "2026-05-09T12:00:00.000Z",
              currentChannelId: "voice-main",
              enteredChannelIds: ["voice-main"],
              moveCount: 0,
              voiceDurationSeconds: 0,
              activeVoiceDurationSeconds: 0,
              streamingDurationSeconds: 0,
              videoDurationSeconds: 0,
              dayBreakdown: {},
              selfMute: false,
              selfDeaf: false,
              serverMute: false,
              serverDeaf: false,
              streaming: true,
              selfVideo: false,
            },
          },
          dirtyUsers: [],
        },
      },
    },
  };

  const snapshot = rebuildActivityUserSnapshot({
    db,
    userId: "user-1",
    now: "2026-05-09T12:30:00.000Z",
    memberActivityMeta: {
      joinedAt: "2026-05-01T12:00:00.000Z",
    },
  });

  assert.equal(snapshot.voiceDurationSeconds30d, 1800);
  assert.equal(snapshot.activeVoiceDurationSeconds30d, 1800);
  assert.equal(snapshot.streamingDurationSeconds30d, 1800);
  assert.equal(snapshot.voiceSessions30d, 1);
  assert.equal(snapshot.voiceActiveDays30d, 1);
  assert.equal(snapshot.activeDays30d, 1);
  assert.equal(snapshot.lastSeenAt, "2026-05-09T12:30:00.000Z");
  assert.equal(snapshot.baseActivityScore > 0, true);
});

test("rebuildActivityUserSnapshot computes 7/30/90 metrics and a desired role from persisted facts", () => {
  const db = {
    profiles: {
      "user-1": {
        userId: "user-1",
        username: "todo",
        domains: {
          activity: {
            trustScore: 540,
            manualOverride: true,
            autoRoleFrozen: true,
          },
        },
      },
    },
    sot: {
      activity: {
        config: {
          sessionGapMinutes: 45,
          scoreWindowDays: 30,
        },
        watchedChannels: [
          {
            channelId: "main-1",
            channelType: "main_chat",
            channelWeight: 1,
            enabled: true,
            countMessages: true,
            countSessions: true,
            countForTrust: true,
            countForRoles: true,
          },
          {
            channelId: "media-1",
            channelType: "media",
            channelWeight: 0.7,
            enabled: true,
            countMessages: true,
            countSessions: true,
            countForTrust: true,
            countForRoles: true,
          },
        ],
        globalUserSessions: [
          {
            id: "s-1",
            guildId: "guild-1",
            userId: "user-1",
            startedAt: "2026-05-07T12:00:00.000Z",
            endedAt: "2026-05-07T12:20:00.000Z",
            messageCount: 4,
            weightedMessageCount: 4,
            effectiveValue: 0.75,
            mainChannelId: "main-1",
            channelBreakdown: {
              "main-1": { messageCount: 4, weightedMessageCount: 4, sessionMessageCount: 4, channelWeight: 1 },
            },
          },
          {
            id: "s-2",
            guildId: "guild-1",
            userId: "user-1",
            startedAt: "2026-04-19T12:00:00.000Z",
            endedAt: "2026-04-19T12:10:00.000Z",
            messageCount: 3,
            weightedMessageCount: 2.1,
            effectiveValue: 0.7,
            mainChannelId: "media-1",
            channelBreakdown: {
              "media-1": { messageCount: 3, weightedMessageCount: 2.1, sessionMessageCount: 3, channelWeight: 0.7 },
            },
          },
          {
            id: "s-3",
            guildId: "guild-1",
            userId: "user-1",
            startedAt: "2026-02-18T12:00:00.000Z",
            endedAt: "2026-02-18T12:10:00.000Z",
            messageCount: 2,
            weightedMessageCount: 2,
            effectiveValue: 0.75,
            mainChannelId: "main-1",
            channelBreakdown: {
              "main-1": { messageCount: 2, weightedMessageCount: 2, sessionMessageCount: 2, channelWeight: 1 },
            },
          },
        ],
        channelDailyStats: [],
        userChannelDailyStats: [
          {
            guildId: "guild-1",
            channelId: "main-1",
            userId: "user-1",
            date: "2026-05-07",
            messagesCount: 4,
            weightedMessagesCount: 4,
            sessionsCount: 1,
            effectiveSessionsCount: 0.75,
            firstMessageAt: "2026-05-07T12:00:00.000Z",
            lastMessageAt: "2026-05-07T12:20:00.000Z",
          },
          {
            guildId: "guild-1",
            channelId: "media-1",
            userId: "user-1",
            date: "2026-04-19",
            messagesCount: 3,
            weightedMessagesCount: 2.1,
            sessionsCount: 1,
            effectiveSessionsCount: 0.7,
            firstMessageAt: "2026-04-19T12:00:00.000Z",
            lastMessageAt: "2026-04-19T12:10:00.000Z",
          },
          {
            guildId: "guild-1",
            channelId: "main-1",
            userId: "user-1",
            date: "2026-02-18",
            messagesCount: 2,
            weightedMessagesCount: 2,
            sessionsCount: 1,
            effectiveSessionsCount: 0.75,
            firstMessageAt: "2026-02-18T12:00:00.000Z",
            lastMessageAt: "2026-02-18T12:10:00.000Z",
          },
        ],
        userSnapshots: {},
        calibrationRuns: [],
        ops: { moderationAuditLog: [] },
        runtime: { openSessions: {}, dirtyUsers: [] },
      },
    },
  };

  const snapshot = rebuildActivityUserSnapshot({
    db,
    userId: "user-1",
    now: "2026-05-09T12:00:00.000Z",
  });

  assert.equal(snapshot.messages7d, 4);
  assert.equal(snapshot.messages30d, 7);
  assert.equal(snapshot.messages90d, 9);
  assert.equal(snapshot.sessions7d, 1);
  assert.equal(snapshot.sessions30d, 2);
  assert.equal(snapshot.sessions90d, 3);
  assert.equal(snapshot.activeDays7d, 1);
  assert.equal(snapshot.activeDays30d, 2);
  assert.equal(snapshot.activeDays90d, 3);
  approxEqual(snapshot.weightedMessages30d, 6.1);
  approxEqual(snapshot.globalEffectiveSessions30d, 1.45);
  assert.equal(snapshot.activeWatchedChannels30d, 2);
  assert.equal(snapshot.daysAbsent, 2);
  assert.equal(snapshot.baseActivityScore, 22);
  assert.equal(snapshot.activityScore, 22);
  assert.equal(snapshot.activityScoreMultiplier, 1);
  assert.equal(snapshot.guildJoinedAt, null);
  assert.equal(snapshot.daysSinceGuildJoin, null);
  assert.equal(snapshot.roleEligibilityStatus, "join_age_unknown");
  assert.equal(snapshot.roleEligibleForActivityRole, false);
  assert.equal(snapshot.desiredActivityRoleKey, null);
  assert.equal(snapshot.trustScore, 540);
  assert.equal(snapshot.manualOverride, true);
  assert.equal(snapshot.autoRoleFrozen, true);
});

test("rebuildActivityUserSnapshot gates very new members and applies a temporary decay boost after day 3", () => {
  const db = {
    profiles: {
      "user-1": {
        userId: "user-1",
        username: "todo",
      },
    },
    sot: {
      activity: {
        config: {},
        watchedChannels: [
          {
            channelId: "main-1",
            channelType: "main_chat",
            enabled: true,
            channelWeight: 1,
            countMessages: true,
            countSessions: true,
            countForTrust: true,
            countForRoles: true,
          },
        ],
        globalUserSessions: [
          {
            guildId: "guild-1",
            userId: "user-1",
            startedAt: "2026-05-08T12:00:00.000Z",
            endedAt: "2026-05-08T12:10:00.000Z",
            effectiveValue: 1,
          },
        ],
        userChannelDailyStats: [
          {
            guildId: "guild-1",
            channelId: "main-1",
            userId: "user-1",
            date: "2026-05-08",
            messagesCount: 8,
            weightedMessagesCount: 8,
            sessionsCount: 1,
            effectiveSessionsCount: 1,
            firstMessageAt: "2026-05-08T12:00:00.000Z",
            lastMessageAt: "2026-05-08T12:10:00.000Z",
          },
        ],
        userSnapshots: {},
        calibrationRuns: [],
        ops: { moderationAuditLog: [] },
        runtime: { openSessions: {}, dirtyUsers: [] },
      },
    },
  };

  const gatedSnapshot = rebuildActivityUserSnapshot({
    db,
    userId: "user-1",
    now: "2026-05-09T12:00:00.000Z",
    memberActivityMeta: {
      joinedAt: "2026-05-07T12:00:00.000Z",
    },
  });
  assert.equal(gatedSnapshot.baseActivityScore, 21);
  assert.equal(gatedSnapshot.activityScore, 21);
  assert.equal(gatedSnapshot.activityScoreMultiplier, 1);
  assert.equal(gatedSnapshot.roleEligibilityStatus, "gated_new_member");
  assert.equal(gatedSnapshot.roleEligibleForActivityRole, false);
  assert.equal(gatedSnapshot.desiredActivityRoleKey, null);

  const boostedSnapshot = rebuildActivityUserSnapshot({
    db,
    userId: "user-1",
    now: "2026-05-09T12:00:00.000Z",
    memberActivityMeta: {
      joinedAt: "2026-05-06T12:00:00.000Z",
    },
  });
  assert.equal(boostedSnapshot.baseActivityScore, 21);
  assert.equal(boostedSnapshot.activityScoreMultiplier, 1.15);
  assert.equal(boostedSnapshot.activityScore, 24);
  assert.equal(boostedSnapshot.roleEligibilityStatus, "boosted_new_member");
  assert.equal(boostedSnapshot.roleEligibleForActivityRole, true);
  assert.equal(boostedSnapshot.desiredActivityRoleKey, "weak");

  const decayedSnapshot = rebuildActivityUserSnapshot({
    db,
    userId: "user-1",
    now: "2026-05-09T12:00:00.000Z",
    memberActivityMeta: {
      joinedAt: "2026-05-05T12:00:00.000Z",
    },
  });
  assert.equal(decayedSnapshot.activityScoreMultiplier, 1.1125);
  assert.equal(decayedSnapshot.activityScore, 23);
  assert.equal(decayedSnapshot.roleEligibilityStatus, "boosted_new_member");
});

test("rebuildActivitySnapshots preserves rebuilt snapshot index on db.sot.activity", async () => {
  const db = {
    profiles: {
      "user-1": {
        userId: "user-1",
        username: "todo",
      },
    },
    sot: {
      activity: {
        config: {},
        watchedChannels: [
          {
            channelId: "main-1",
            channelType: "main_chat",
            enabled: true,
            channelWeight: 1,
            countMessages: true,
            countSessions: true,
            countForTrust: true,
            countForRoles: true,
          },
        ],
        globalUserSessions: [
          {
            guildId: "guild-1",
            userId: "user-1",
            startedAt: "2026-05-08T12:00:00.000Z",
            endedAt: "2026-05-08T12:10:00.000Z",
            effectiveValue: 1,
          },
        ],
        userChannelDailyStats: [
          {
            guildId: "guild-1",
            channelId: "main-1",
            userId: "user-1",
            date: "2026-05-08",
            messagesCount: 8,
            weightedMessagesCount: 8,
            sessionsCount: 1,
            effectiveSessionsCount: 1,
            firstMessageAt: "2026-05-08T12:00:00.000Z",
            lastMessageAt: "2026-05-08T12:10:00.000Z",
          },
        ],
        userSnapshots: {},
        calibrationRuns: [],
        ops: { moderationAuditLog: [] },
        runtime: { openSessions: {}, dirtyUsers: [] },
      },
    },
  };

  const result = await rebuildActivitySnapshots({
    db,
    userIds: ["user-1"],
    now: "2026-05-09T12:00:00.000Z",
    resolveMemberActivityMeta() {
      return {
        joinedAt: "2026-05-06T12:00:00.000Z",
      };
    },
  });

  assert.equal(result.rebuiltUserCount, 1);
  assert.equal(db.sot.activity.userSnapshots["user-1"].desiredActivityRoleKey, "weak");
  assert.equal(db.sot.activity.userSnapshots["user-1"].roleEligibilityStatus, "boosted_new_member");
});

test("rebuildActivitySnapshots records member metadata lookup failures on activity runtime state", async () => {
  const db = {
    profiles: {
      "user-1": {
        userId: "user-1",
        username: "todo",
      },
    },
    sot: {
      activity: {
        config: {},
        watchedChannels: [
          {
            channelId: "main-1",
            channelType: "main_chat",
            enabled: true,
            channelWeight: 1,
            countMessages: true,
            countSessions: true,
            countForTrust: true,
            countForRoles: true,
          },
        ],
        globalUserSessions: [
          {
            guildId: "guild-1",
            userId: "user-1",
            startedAt: "2026-05-08T12:00:00.000Z",
            endedAt: "2026-05-08T12:10:00.000Z",
            effectiveValue: 1,
          },
        ],
        userChannelDailyStats: [
          {
            guildId: "guild-1",
            channelId: "main-1",
            userId: "user-1",
            date: "2026-05-08",
            messagesCount: 8,
            weightedMessagesCount: 8,
            sessionsCount: 1,
            effectiveSessionsCount: 1,
            firstMessageAt: "2026-05-08T12:00:00.000Z",
            lastMessageAt: "2026-05-08T12:10:00.000Z",
          },
        ],
        userSnapshots: {},
        calibrationRuns: [],
        ops: { moderationAuditLog: [] },
        runtime: { openSessions: {}, dirtyUsers: [] },
      },
    },
  };

  const result = await rebuildActivitySnapshots({
    db,
    userIds: ["user-1"],
    now: "2026-05-09T12:00:00.000Z",
    resolveMemberActivityMeta() {
      throw new Error("meta boom");
    },
  });

  assert.equal(result.rebuiltUserCount, 1);
  assert.deepEqual(db.runtime, undefined);
  assert.deepEqual(db.sot.activity.runtime.errors, [
    {
      scope: "member_activity_meta",
      userId: "user-1",
      createdAt: "2026-05-09T12:00:00.000Z",
      reason: "meta boom",
    },
  ]);
});

test("flushActivityRuntime finalizes stale sessions, keeps fresh sessions open, and mirrors activity snapshots into profiles", async () => {
  const db = {
    profiles: {
      "user-stale": { userId: "user-stale", username: "stale" },
      "user-fresh": { userId: "user-fresh", username: "fresh" },
    },
  };
  seedWatchedChannels(db);

  recordActivityMessage({
    db,
    message: {
      guildId: "guild-1",
      userId: "user-stale",
      channelId: "main-1",
      messageId: "stale-1",
      createdAt: "2026-05-09T10:00:00.000Z",
    },
  });
  recordActivityMessage({
    db,
    message: {
      guildId: "guild-1",
      userId: "user-stale",
      channelId: "small-1",
      messageId: "stale-2",
      createdAt: "2026-05-09T10:20:00.000Z",
    },
  });
  recordActivityMessage({
    db,
    message: {
      guildId: "guild-1",
      userId: "user-fresh",
      channelId: "media-1",
      messageId: "fresh-1",
      createdAt: "2026-05-09T12:20:00.000Z",
    },
  });

  const saved = [];
  const result = await flushActivityRuntime({
    db,
    now: "2026-05-09T12:50:00.000Z",
    saveDb() {
      saved.push("saved");
    },
  });

  assert.equal(result.finalizedSessionCount, 1);
  assert.equal(result.rebuiltUserCount, 2);
  assert.equal(saved.length, 1);
  assert.equal(db.sot.activity.globalUserSessions.length, 1);
  assert.equal(db.sot.activity.runtime.openSessions["user-stale"], undefined);
  assert.equal(Boolean(db.sot.activity.runtime.openSessions["user-fresh"]), true);
  assert.equal(db.profiles["user-stale"].domains.activity.messages30d, 2);
  assert.equal(db.profiles["user-stale"].summary.activity.roleEligibilityStatus, "join_age_unknown");
  assert.equal(db.profiles["user-stale"].summary.activity.desiredActivityRoleKey, null);
  assert.equal(db.profiles["user-fresh"].domains.activity.messages30d, 1);
  assert.equal(db.profiles["user-fresh"].summary.activity.sessions30d, 1);
  assert.equal(db.sot.activity.runtime.lastFlushAt, "2026-05-09T12:50:00.000Z");
});

test("flushActivityRuntime records member metadata lookup failures and keeps unknown join age role-safe", async () => {
  const db = {
    profiles: {
      "user-stale": { userId: "user-stale", username: "stale" },
    },
  };
  seedWatchedChannels(db);

  recordActivityMessage({
    db,
    message: {
      guildId: "guild-1",
      userId: "user-stale",
      channelId: "main-1",
      messageId: "stale-1",
      createdAt: "2026-05-09T10:00:00.000Z",
    },
  });

  const result = await flushActivityRuntime({
    db,
    now: "2026-05-09T12:50:00.000Z",
    resolveMemberActivityMeta() {
      throw new Error("discord member fetch failed");
    },
  });

  assert.equal(result.rebuiltUserCount, 1);
  assert.equal(db.profiles["user-stale"].domains.activity.roleEligibilityStatus, "join_age_unknown");
  assert.equal(db.profiles["user-stale"].domains.activity.roleEligibleForActivityRole, false);
  assert.equal(db.profiles["user-stale"].domains.activity.desiredActivityRoleKey, null);
  assert.deepEqual(db.sot.activity.runtime.errors, [
    {
      scope: "member_activity_meta",
      userId: "user-stale",
      createdAt: "2026-05-09T12:50:00.000Z",
      reason: "discord member fetch failed",
    },
  ]);
});

test("resumeActivityRuntime normalizes state and stamps resume time", async () => {
  const db = {};

  const result = await resumeActivityRuntime({
    db,
    now: "2026-05-09T12:00:00.000Z",
  });

  assert.equal(result.resumedAt, "2026-05-09T12:00:00.000Z");
  assert.equal(result.promotedUserCount, 0);
  assert.equal(db.sot.activity.runtime.lastResumeAt, "2026-05-09T12:00:00.000Z");
  assert.deepEqual(db.sot.activity.runtime.dirtyUsers, []);
});

test("resumeActivityRuntime promotes persisted activity mirrors into the canonical snapshot index", async () => {
  const db = {
    profiles: {
      mirrorOnly: {
        userId: "mirrorOnly",
        domains: {
          activity: {
            activityScore: 61,
            baseActivityScore: 58,
            desiredActivityRoleKey: "active",
            appliedActivityRoleKey: null,
            roleEligibilityStatus: "eligible",
            roleEligibleForActivityRole: true,
            recalculatedAt: "2026-05-08T12:00:00.000Z",
            lastSeenAt: "2026-05-08T11:50:00.000Z",
          },
        },
        summary: {
          activity: {
            activityScore: 61,
            baseActivityScore: 58,
            desiredActivityRoleKey: "active",
            appliedActivityRoleKey: null,
            roleEligibilityStatus: "eligible",
            roleEligibleForActivityRole: true,
            recalculatedAt: "2026-05-08T12:00:00.000Z",
            lastSeenAt: "2026-05-08T11:50:00.000Z",
          },
        },
      },
    },
    sot: {
      activity: {
        config: {},
        watchedChannels: [],
        globalUserSessions: [],
        userChannelDailyStats: [],
        userSnapshots: {},
        calibrationRuns: [],
        ops: { moderationAuditLog: [] },
        runtime: { openSessions: {}, dirtyUsers: [] },
      },
    },
  };

  const result = await resumeActivityRuntime({
    db,
    now: "2026-05-09T12:00:00.000Z",
  });

  assert.equal(result.promotedUserCount, 1);
  assert.deepEqual(Object.keys(db.sot.activity.userSnapshots), ["mirrorOnly"]);
  assert.equal(db.sot.activity.userSnapshots.mirrorOnly.desiredActivityRoleKey, "active");
  assert.equal(db.sot.activity.runtime.lastResumeAt, "2026-05-09T12:00:00.000Z");
});

test("resumeActivityRuntime hydrates current voice occupants and closes stale open voice sessions on startup", async () => {
  const db = {
    profiles: {
      hydrated: { userId: "hydrated" },
      stale: { userId: "stale" },
    },
    sot: {
      activity: {
        config: {},
        watchedChannels: [],
        globalUserSessions: [],
        globalVoiceSessions: [],
        userChannelDailyStats: [],
        userVoiceDailyStats: [],
        userSnapshots: {},
        calibrationRuns: [],
        ops: { moderationAuditLog: [] },
        runtime: {
          openSessions: {},
          openVoiceSessions: {
            stale: {
              guildId: "guild-1",
              userId: "stale",
              joinedAt: "2026-05-09T11:00:00.000Z",
              lastStateChangedAt: "2026-05-09T11:00:00.000Z",
              currentChannelId: "voice-old",
              enteredChannelIds: ["voice-old"],
              moveCount: 0,
              voiceDurationSeconds: 0,
              activeVoiceDurationSeconds: 0,
              streamingDurationSeconds: 0,
              videoDurationSeconds: 0,
              dayBreakdown: {},
              selfMute: false,
              selfDeaf: false,
              serverMute: false,
              serverDeaf: false,
              streaming: false,
              selfVideo: false,
            },
          },
          dirtyUsers: [],
        },
      },
    },
  };

  const result = await resumeActivityRuntime({
    db,
    now: "2026-05-09T12:00:00.000Z",
    listCurrentVoiceStates: async () => [{
      guildId: "guild-1",
      userId: "hydrated",
      channelId: "voice-main",
      selfMute: false,
      selfDeaf: false,
      serverMute: false,
      serverDeaf: false,
      streaming: true,
      selfVideo: false,
    }],
    resolveMemberActivityMeta: async () => ({
      joinedAt: "2026-05-01T12:00:00.000Z",
    }),
  });

  assert.equal(result.hydratedVoiceUserCount, 1);
  assert.equal(result.finalizedOfflineVoiceUserCount, 1);
  assert.equal(result.rebuiltUserCount, 2);
  assert.equal(result.openVoiceSessionCount, 1);
  assert.deepEqual(Object.keys(db.sot.activity.runtime.openVoiceSessions), ["hydrated"]);
  assert.deepEqual(db.sot.activity.runtime.dirtyUsers, []);
  assert.equal(db.sot.activity.runtime.openVoiceSessions.hydrated.incomplete, true);
  assert.equal(db.sot.activity.runtime.openVoiceSessions.hydrated.incompleteReason, "hydrated_on_startup");
  assert.equal(db.sot.activity.globalVoiceSessions.length, 1);
  assert.equal(db.sot.activity.globalVoiceSessions[0].userId, "stale");
  assert.equal(db.sot.activity.globalVoiceSessions[0].incomplete, true);
  assert.equal(db.sot.activity.globalVoiceSessions[0].incompleteReason, "ended_while_offline");
  assert.equal(db.sot.activity.globalVoiceSessions[0].durationSeconds, 3600);
});