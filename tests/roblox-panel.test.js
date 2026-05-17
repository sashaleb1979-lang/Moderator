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
    },
    calls,
  };
}

test("getRobloxStatsPanelSnapshot keeps aggregate truth and builds a seen-first verified list", async () => {
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
    repairedBindingCount: 2,
    unresolvedBindingCount: 1,
    failedRepairBatchCount: 1,
    sanitizedBindingCount: 3,
  }))();
  await telemetry.wrapJob("runtime_flush", async () => ({
    saved: true,
    dirtyUserCount: 2,
    flushedAt: "2026-05-09T12:06:01.000Z",
  }))();

  const snapshot = getRobloxStatsPanelSnapshot({
    db: {
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
    },
    runtimeState: {
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
    },
    telemetry,
    appConfig: {
      roblox: {
        jjsUniverseId: 0,
        jjsRootPlaceId: 0,
        jjsPlaceId: 0,
      },
    },
  });

  assert.equal(snapshot.totals.verifiedUsers, 3);
  assert.equal(snapshot.totals.verifiedSeenUsers, 2);
  assert.equal(snapshot.totals.verifiedUnseenUsers, 1);
  assert.equal(snapshot.totals.refreshErrorUsers, 1);
  assert.equal(snapshot.totals.activeJjsUsers, 1);
  assert.equal(snapshot.jobs.playtimeSync.summary.repairedBindingCount, 2);
  assert.equal(snapshot.jobs.playtimeSync.summary.unresolvedBindingCount, 1);
  assert.deepEqual(
    snapshot.lists.verifiedEntries.map((entry) => entry.userId),
    ["active_user", "problem_user", "stale_user"]
  );
  assert.match(snapshot.issues[0], /JJS ids/i);
});

test("buildRobloxStatsPanelPayload renders one simple authenticated list with seen markers", () => {
  const payload = buildRobloxStatsPanelPayload({
    db: {
      profiles: {
        seen_user: {
          userId: "seen_user",
          displayName: "Gojo",
          domains: {
            roblox: {
              username: "GojoRb",
              userId: "1",
              verificationStatus: "verified",
              playtime: {
                totalJjsMinutes: 15,
              },
            },
          },
        },
        repairable_user: {
          userId: "repairable_user",
          displayName: "Repairable User",
          domains: {
            roblox: {
              username: "RepairableRb",
              verificationStatus: "verified",
            },
          },
        },
        manual_user: {
          userId: "manual_user",
          displayName: "Manual User",
          domains: {
            roblox: {
              verificationStatus: "verified",
            },
          },
        },
      },
    },
    statusText: "manual refresh completed",
  });

  assert.equal(payload.components.length, 1);
  assert.equal(payload.components[0].components.length, 2);
  assert.equal(payload.components[0].components[0].data.custom_id, "roblox_stats_refresh");
  assert.equal(payload.components[0].components[1].data.custom_id, "roblox_stats_back");

  const embed = payload.embeds[0].data;
  assert.equal(embed.title, "Roblox");
  assert.match(embed.description, /Список подтверждённых Roblox-профилей/i);
  assert.match(embed.description, /Подтверждено: \*\*3\*\*/i);
  assert.match(embed.description, /С галочкой: \*\*1\*\*/i);
  assert.match(embed.description, /Без галочки: \*\*2\*\*/i);
  assert.match(embed.description, /✓ Gojo -> GojoRb/);
  assert.match(embed.description, /— Manual User/);
  assert.match(embed.description, /— Repairable User -> RepairableRb/);
  assert.equal(embed.fields.length, 1);
  assert.equal(embed.fields[0].name, "Последнее действие");
  assert.equal(embed.fields[0].value, "manual refresh completed");
});

test("buildRobloxStatsPanelPayload keeps passive verified users in the list even without runtime visibility", () => {
  const payload = buildRobloxStatsPanelPayload({
    db: {
      profiles: {
        pending_user: {
          userId: "pending_user",
          displayName: "Pending User",
          domains: {
            roblox: {
              username: "PendingRb",
              verificationStatus: "pending",
            },
          },
        },
        manual_user: {
          userId: "manual_user",
          displayName: "Manual User",
          domains: {
            roblox: {
              verificationStatus: "verified",
            },
          },
        },
      },
    },
  });

  assert.doesNotMatch(payload.embeds[0].data.description, /Pending User/);
  assert.match(payload.embeds[0].data.description, /— Manual User/);
});

test("handleRobloxStatsPanelButtonInteraction gates permissions and rerenders simple panel for refresh and legacy buttons", async () => {
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

  const refresh = createInteraction("roblox_stats_refresh:coverage");
  const refreshHandled = await handleRobloxStatsPanelButtonInteraction({
    interaction: refresh.interaction,
    client: {},
    db: {},
    runtimeState: {},
    appConfig: {},
    isModerator: () => true,
    replyNoPermission: () => refresh.interaction.reply({ content: "Нет прав." }),
    buildModeratorPanelPayload: async () => ({ content: "main" }),
    buildRobloxPanelPayload: ({ statusText = "" } = {}) => ({ content: statusText }),
  });

  assert.equal(refreshHandled, true);
  assert.equal(refresh.calls.updates[0].content, "Панель Roblox обновлена.");

  const legacyView = createInteraction("roblox_stats_view_activity");
  await handleRobloxStatsPanelButtonInteraction({
    interaction: legacyView.interaction,
    client: {},
    db: {},
    runtimeState: {},
    appConfig: {},
    isModerator: () => true,
    replyNoPermission: () => legacyView.interaction.reply({ content: "Нет прав." }),
    buildModeratorPanelPayload: async () => ({ content: "main" }),
    buildRobloxPanelPayload: ({ statusText = "" } = {}) => ({ content: statusText }),
  });

  assert.equal(legacyView.calls.updates[0].content, "Панель упрощена. Используй Обновить или Назад.");

  const openPanel = createInteraction("panel_open_roblox_stats");
  await handleRobloxStatsPanelButtonInteraction({
    interaction: openPanel.interaction,
    client: {},
    db: {},
    runtimeState: {},
    appConfig: {},
    isModerator: () => true,
    replyNoPermission: () => openPanel.interaction.reply({ content: "Нет прав." }),
    buildModeratorPanelPayload: async () => ({ content: "main" }),
    buildRobloxPanelPayload: ({ statusText = "" } = {}) => ({ content: statusText || "opened" }),
  });

  assert.equal(openPanel.calls.updates[0].content, "opened");

  const back = createInteraction("roblox_stats_back:overview");
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

test("handleRobloxStatsPanelButtonInteraction ignores unrelated custom ids", async () => {
  const unknown = createInteraction("roblox_stats_unknown");
  const handled = await handleRobloxStatsPanelButtonInteraction({
    interaction: unknown.interaction,
    client: {},
    db: {},
    runtimeState: {},
    appConfig: {},
    isModerator: () => true,
    replyNoPermission: () => unknown.interaction.reply({ content: "Нет прав." }),
    buildModeratorPanelPayload: async () => ({ content: "main" }),
  });

  assert.equal(handled, false);
  assert.equal(unknown.calls.updates.length, 0);
});