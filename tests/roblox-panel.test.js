"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildRobloxStatsPanelPayload,
  createRobloxPanelTelemetry,
  getRobloxStatsPanelSnapshot,
  handleRobloxStatsPanelButtonInteraction,
} = require("../src/integrations/roblox-panel");

function createNowQueue(values) {
  const queue = [...values];
  return () => queue.shift() || values.at(-1) || "2026-05-09T00:00:00.000Z";
}

function createInteraction(customId, overrides = {}) {
  const calls = {
    replies: [],
    updates: [],
    edits: [],
    deferred: 0,
  };

  return {
    interaction: {
      customId,
      member: overrides.member || { roles: { cache: new Set(["mod"]) } },
      user: overrides.user || { id: "mod-user", tag: "Moderator#0001" },
      async reply(payload) {
        calls.replies.push(payload);
      },
      async update(payload) {
        calls.updates.push(payload);
      },
      async deferUpdate() {
        calls.deferred += 1;
      },
      async editReply(payload) {
        calls.edits.push(payload);
      },
    },
    calls,
  };
}

test("getRobloxStatsPanelSnapshot aggregates linked users, job telemetry, and control issues", async () => {
  const telemetry = createRobloxPanelTelemetry({
    now: createNowQueue([
      "2026-05-09T12:00:00.000Z",
      "2026-05-09T12:00:01.000Z",
      "2026-05-09T12:05:00.000Z",
      "2026-05-09T12:05:01.000Z",
      "2026-05-09T12:06:00.000Z",
      "2026-05-09T12:06:01.000Z",
    ]),
  });

  await telemetry.wrapJob("profile_refresh", async () => ({
    totalCandidates: 4,
    refreshedCount: 3,
    failedCount: 1,
    avatarErrors: 0,
  }))();
  await telemetry.wrapJob("playtime_sync", async () => ({
    totalCandidates: 3,
    totalBatches: 2,
    processedBatches: 1,
    failedBatches: 1,
    processedUserIds: 1,
    failedUserIds: 2,
    activeJjsUsers: 1,
    touchedUserCount: 1,
    activeCoPlayPairCount: 1,
  }))();
  await telemetry.wrapJob("runtime_flush", async () => ({
    saved: true,
    dirtyUserCount: 2,
    flushedAt: "2026-05-09T12:06:01.000Z",
  }))();

  const runtimeState = {
    activeSessionsByDiscordUserId: {
      active_user: {
        startedAt: "2026-05-09T12:04:00.000Z",
        lastSeenAt: "2026-05-09T12:05:00.000Z",
        gameId: "server-1",
      },
    },
    activeCoPlayPairsByKey: {
      "active_user:problem_user": {
        lastSeenAt: "2026-05-09T12:05:00.000Z",
        gameId: "server-1",
      },
    },
    dirtyDiscordUserIds: new Set(["problem_user", "active_user"]),
  };

  const db = {
    profiles: {
      problem_user: {
        userId: "problem_user",
        displayName: "Problem Child",
        domains: {
          roblox: {
            username: "ProblemRb",
            userId: "101",
            verificationStatus: "verified",
            refreshStatus: "error",
            refreshError: "temporary upstream outage",
            lastRefreshAt: "2026-05-09T11:00:00.000Z",
            playtime: {
              totalJjsMinutes: 10,
            },
          },
        },
      },
      pending_user: {
        userId: "pending_user",
        displayName: "Pending User",
        domains: {
          roblox: {
            username: "PendingRb",
            userId: "202",
            verificationStatus: "pending",
          },
        },
      },
      active_user: {
        userId: "active_user",
        displayName: "Active User",
        domains: {
          roblox: {
            username: "ActiveRb",
            userId: "303",
            verificationStatus: "verified",
            refreshStatus: "ok",
            lastRefreshAt: "2026-05-09T11:59:00.000Z",
            playtime: {
              totalJjsMinutes: 150,
              currentSessionStartedAt: "2026-05-09T12:04:00.000Z",
              lastSeenInJjsAt: "2026-05-09T12:05:00.000Z",
            },
          },
        },
      },
      stale_user: {
        userId: "stale_user",
        displayName: "Stale User",
        domains: {
          roblox: {
            username: "StaleRb",
            userId: "404",
            verificationStatus: "verified",
            refreshStatus: null,
            lastRefreshAt: null,
          },
        },
      },
      failed_user: {
        userId: "failed_user",
        displayName: "Failed User",
        domains: {
          roblox: {
            username: "FailedRb",
            userId: "505",
            verificationStatus: "failed",
          },
        },
      },
    },
  };

  const snapshot = getRobloxStatsPanelSnapshot({
    db,
    runtimeState,
    telemetry,
    appConfig: {
      roblox: {
        jjsUniverseId: 0,
        jjsRootPlaceId: 0,
        jjsPlaceId: 0,
      },
    },
  });

  assert.deepEqual(snapshot.totals, {
    linkedUsers: 5,
    verifiedUsers: 3,
    pendingUsers: 1,
    failedUsers: 1,
    refreshErrorUsers: 1,
    neverRefreshedVerifiedUsers: 1,
    activeJjsUsers: 1,
    dirtyRuntimeUsers: 2,
    activeCoPlayPairs: 1,
  });
  assert.equal(snapshot.jobs.profileRefresh.summary.failedCount, 1);
  assert.equal(snapshot.jobs.playtimeSync.summary.failedBatches, 1);
  assert.equal(snapshot.jobs.runtimeFlush.summary.dirtyUserCount, 2);
  assert.equal(snapshot.topEntries[0].userId, "problem_user");
  assert.equal(snapshot.topEntries[1].userId, "failed_user");
  assert.match(snapshot.issues[0], /JJS ids/i);
  assert.match(snapshot.issues[1], /Обновление профилей завершилось с ошибками/i);
  assert.match(snapshot.issues[2], /Синк playtime потерял пачки/i);
});

test("buildRobloxStatsPanelPayload renders manual controls and blocker field", () => {
  const payload = buildRobloxStatsPanelPayload({
    db: {
      profiles: {
        user_1: {
          userId: "user_1",
          displayName: "Gojo",
          domains: {
            roblox: {
              username: "GojoRb",
              userId: "1",
              verificationStatus: "verified",
            },
          },
        },
      },
    },
    appConfig: {
      roblox: {
        jjsUniverseId: 0,
        jjsRootPlaceId: 0,
        jjsPlaceId: 0,
      },
    },
    statusText: "manual refresh completed",
  });

  assert.equal(payload.components[0].components.length, 5);
  assert.equal(payload.components[0].components[0].data.custom_id, "roblox_stats_refresh");
  assert.equal(payload.components[0].components[4].data.custom_id, "roblox_stats_back");
  assert.equal(payload.components[0].components[1].data.label, "Обновить профили");
  assert.equal(payload.components[0].components[2].data.label, "Синк playtime");
  assert.equal(payload.components[0].components[3].data.label, "Сохранить runtime");
  assert.equal(payload.embeds[0].data.fields.at(-1).name, "Последнее действие");
  assert.match(payload.embeds[0].data.fields[3].value, /Gojo/);
  assert.match(payload.embeds[0].data.fields[4].value, /JJS IDs/i);
});

test("handleRobloxStatsPanelButtonInteraction gates permissions and delegates manual actions", async () => {
  const denied = createInteraction("panel_open_roblox_stats", {
    member: { roles: { cache: new Set() } },
  });

  const deniedHandled = await handleRobloxStatsPanelButtonInteraction({
    interaction: denied.interaction,
    client: {},
    db: {},
    runtimeState: {},
    appConfig: {},
    isModerator: () => false,
    replyNoPermission: () => denied.interaction.reply({ content: "Нет прав." }),
    buildModeratorPanelPayload: async () => ({ content: "main" }),
  });

  assert.equal(deniedHandled, true);
  assert.equal(denied.calls.replies.length, 1);

  const manual = createInteraction("roblox_stats_run_playtime_sync");
  let playtimeRuns = 0;
  const manualHandled = await handleRobloxStatsPanelButtonInteraction({
    interaction: manual.interaction,
    client: {},
    db: {},
    runtimeState: {},
    appConfig: {},
    telemetry: createRobloxPanelTelemetry(),
    isModerator: () => true,
    replyNoPermission: () => manual.interaction.reply({ content: "Нет прав." }),
    buildModeratorPanelPayload: async () => ({ content: "main" }),
    buildRobloxPanelPayload: ({ statusText = "" } = {}) => ({ content: statusText }),
    runProfileRefreshJob: async () => ({}),
    runPlaytimeSyncJob: async () => {
      playtimeRuns += 1;
      return {
        activeJjsUsers: 2,
        touchedUserCount: 3,
        failedUserIds: 1,
      };
    },
    runRuntimeFlush: async () => ({}),
  });

  assert.equal(manualHandled, true);
  assert.equal(playtimeRuns, 1);
  assert.equal(manual.calls.deferred, 1);
  assert.match(manual.calls.edits[0].content, /Активных в JJS: 2, затронуто профилей: 3, ошибок пользователей: 1/i);

  const back = createInteraction("roblox_stats_back");
  await handleRobloxStatsPanelButtonInteraction({
    interaction: back.interaction,
    client: { id: "client" },
    db: {},
    runtimeState: {},
    appConfig: {},
    isModerator: () => true,
    replyNoPermission: () => back.interaction.reply({ content: "Нет прав." }),
    buildModeratorPanelPayload: async (_client, statusText, includeFlags) => ({ statusText, includeFlags }),
  });

  assert.deepEqual(back.calls.updates[0], { statusText: "", includeFlags: false });
});