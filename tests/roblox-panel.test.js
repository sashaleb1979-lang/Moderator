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
    deferred: 0,
    edits: [],
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

test("createRobloxPanelTelemetry persists playtime job state for runtime diagnostics", async () => {
  const persisted = [];
  const telemetry = createRobloxPanelTelemetry({
    now: createNowQueue([
      "2026-05-09T12:00:00.000Z",
      "2026-05-09T12:00:01.000Z",
    ]),
    persistJobState(kind, state) {
      persisted.push({ kind, state });
    },
  });

  await telemetry.wrapJob("playtime_sync", async () => ({
    totalCandidates: 2,
    activeJjsUsers: 1,
    staleSessionClosedCount: 1,
  }))();

  assert.equal(persisted[0].kind, "playtimeSync");
  assert.equal(persisted[0].state.status, "running");
  assert.equal(persisted[0].state.lastStartedAt, "2026-05-09T12:00:00.000Z");
  assert.equal(persisted[1].kind, "playtimeSync");
  assert.equal(persisted[1].state.status, "ok");
  assert.equal(persisted[1].state.lastFinishedAt, "2026-05-09T12:00:01.000Z");
  assert.equal(persisted[1].state.summary.activeJjsUsers, 1);
  assert.equal(persisted[1].state.summary.staleSessionClosedCount, 1);
});

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
    appConfig: {
      roblox: {
        jjsUniverseId: 100,
        jjsRootPlaceId: 200,
        jjsPlaceId: 300,
      },
    },
    statusText: "manual refresh completed",
  });

  assert.equal(payload.components.length, 5);
  assert.deepEqual(payload.components[0].components.map((component) => component.data.custom_id), [
    "roblox_stats_view_overview:overview",
    "roblox_stats_view_coverage:coverage",
    "roblox_stats_view_activity:activity",
    "roblox_stats_view_errors:errors",
  ]);
  assert.deepEqual(payload.components[1].components.map((component) => component.data.custom_id), [
    "roblox_stats_run_profile_refresh:overview",
    "roblox_stats_run_playtime_sync:overview",
    "roblox_stats_run_flush:overview",
    "roblox_stats_clear_refresh_errors:overview",
    "roblox_stats_refresh:overview",
  ]);
  assert.deepEqual(payload.components[4].components.map((component) => component.data.custom_id), [
    "roblox_stats_back:overview",
  ]);

  const embed = payload.embeds[0].data;
  assert.equal(embed.title, "Roblox • Обзор");
  assert.match(embed.description, /Список подтверждённых Roblox-профилей/i);
  assert.match(embed.description, /Подтверждено: \*\*3\*\*/i);
  assert.match(embed.description, /С галочкой: \*\*1\*\*/i);
  assert.match(embed.description, /Без галочки: \*\*2\*\*/i);
  assert.match(embed.description, /✓ Gojo -> GojoRb/);
  assert.match(embed.description, /— Manual User/);
  assert.match(embed.description, /— Repairable User -> RepairableRb/);
  assert.equal(embed.fields.length, 7);
  assert.equal(embed.fields[0].name, "Режим");
  assert.match(embed.fields[0].value, /Учёт JJS: \*\*включён\*\*/);
  assert.equal(embed.fields[1].name, "Покрытие");
  assert.match(embed.fields[1].value, /Проверено: \*\*3\*\*/);
  assert.match(embed.fields[1].value, /Trackable для playtime: \*\*1\*\*/);
  assert.match(embed.fields[1].value, /Починится по username: \*\*1\*\*/);
  assert.match(embed.fields[1].value, /Нужен manual rebind: \*\*1\*\*/);
  assert.equal(embed.fields[2].name, "JJS и runtime");
  assert.match(embed.fields[2].value, /Сейчас в JJS: \*\*0\*\*/);
  assert.match(embed.fields[2].value, /Несохранённых runtime-профилей: \*\*0\*\*/);
  assert.equal(embed.fields[3].name, "Фоновые задачи");
  assert.equal(embed.fields[4].name, "Кого чинить");
  assert.equal(embed.fields[5].name, "Ошибки и блокеры");
  assert.equal(embed.fields[5].value, "JJS sync не работает: не было успешного запуска дольше двух poll-интервалов.");
  assert.equal(embed.fields[6].name, "Последнее действие");
  assert.equal(embed.fields[6].value, "manual refresh completed");
});

test("buildRobloxStatsPanelPayload supports dedicated coverage and errors views with restored controls", () => {
  const payload = buildRobloxStatsPanelPayload({
    db: {
      profiles: {
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
      },
    },
    runtimeState: {
      dirtyDiscordUserIds: new Set(["repairable_user"]),
      dirtyReasonsByDiscordUserId: {
        repairable_user: ["binding_sanitized", "binding_repaired"],
      },
    },
    viewMode: "coverage",
  });

  const embed = payload.embeds[0].data;
  assert.equal(embed.title, "Roblox • Покрытие");
  assert.equal(embed.fields[0].name, "Режим");
  assert.equal(embed.fields[1].name, "Покрытие");
  assert.match(embed.fields[1].value, /Починится по username: \*\*1\*\*/);
  assert.equal(embed.fields[2].name, "Кого чинить");
  assert.match(embed.fields[2].value, /Автопочинка по username: \*\*1\*\*/);

  const errorsPayload = buildRobloxStatsPanelPayload({
    db: {
      profiles: {
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
      },
    },
    runtimeState: {
      dirtyDiscordUserIds: new Set(["repairable_user"]),
      dirtyReasonsByDiscordUserId: {
        repairable_user: ["binding_sanitized", "binding_repaired"],
      },
    },
    viewMode: "errors",
  });

  const errorsEmbed = errorsPayload.embeds[0].data;
  assert.equal(errorsEmbed.title, "Roblox • Ошибки");
  assert.equal(errorsEmbed.fields[0].name, "Ошибки и блокеры");
  assert.match(errorsEmbed.fields[0].value, /JJS IDs не настроены/i);
  assert.equal(errorsEmbed.fields[3].name, "Нужен manual rebind");
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

test("handleRobloxStatsPanelButtonInteraction gates permissions and restores view, settings and job actions", async () => {
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
  assert.equal(denied.calls.deferred, 0);

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
    buildRobloxPanelPayload: ({ statusText = "", viewMode = "overview" } = {}) => ({ content: `${viewMode}|${statusText}` }),
  });

  assert.equal(refreshHandled, true);
  assert.equal(refresh.calls.updates[0].content, "coverage|Панель Roblox обновлена.");
  assert.equal(refresh.calls.deferred, 0);

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
    buildRobloxPanelPayload: ({ statusText = "", viewMode = "overview" } = {}) => ({ content: `${viewMode}|${statusText}` }),
  });

  assert.equal(legacyView.calls.updates[0].content, "activity|");

  const togglePlaytime = createInteraction("roblox_stats_toggle_playtime:errors");
  const settingsPatches = [];
  await handleRobloxStatsPanelButtonInteraction({
    interaction: togglePlaytime.interaction,
    client: {},
    db: {},
    runtimeState: {},
    appConfig: { roblox: { playtimeTrackingEnabled: true } },
    isModerator: () => true,
    replyNoPermission: () => togglePlaytime.interaction.reply({ content: "Нет прав." }),
    buildModeratorPanelPayload: async () => ({ content: "main" }),
    buildRobloxPanelPayload: ({ statusText = "", viewMode = "overview" } = {}) => ({ content: `${viewMode}|${statusText}` }),
    updateRobloxSettings: async (patch) => {
      settingsPatches.push(patch);
      return { mutated: true };
    },
  });

  assert.deepEqual(settingsPatches, [{ playtimeTrackingEnabled: false }]);
  assert.equal(togglePlaytime.calls.updates[0].content, "errors|Учёт JJS: выключен.");
  assert.equal(togglePlaytime.calls.deferred, 0);

  const runPlaytime = createInteraction("roblox_stats_run_playtime_sync:coverage");
  await handleRobloxStatsPanelButtonInteraction({
    interaction: runPlaytime.interaction,
    client: {},
    db: {},
    runtimeState: {},
    appConfig: {},
    isModerator: () => true,
    replyNoPermission: () => runPlaytime.interaction.reply({ content: "Нет прав." }),
    buildModeratorPanelPayload: async () => ({ content: "main" }),
    buildRobloxPanelPayload: ({ statusText = "", viewMode = "overview" } = {}) => ({ content: `${viewMode}|${statusText}` }),
    runPlaytimeSyncJob: async () => ({
      totalCandidates: 2,
      activeJjsUsers: 1,
      touchedUserCount: 1,
      failedUserIds: 0,
    }),
  });

  assert.equal(runPlaytime.calls.deferred, 1);
  assert.match(runPlaytime.calls.edits[0].content, /^coverage\|Синк playtime завершён\./);

  const clearErrors = createInteraction("roblox_stats_clear_refresh_errors:overview");
  await handleRobloxStatsPanelButtonInteraction({
    interaction: clearErrors.interaction,
    client: {},
    db: {},
    runtimeState: {},
    appConfig: {},
    isModerator: () => true,
    replyNoPermission: () => clearErrors.interaction.reply({ content: "Нет прав." }),
    buildModeratorPanelPayload: async () => ({ content: "main" }),
    buildRobloxPanelPayload: ({ statusText = "", viewMode = "overview" } = {}) => ({ content: `${viewMode}|${statusText}` }),
    clearRefreshDiagnostics: async () => ({ mutated: true, clearedCount: 3 }),
  });

  assert.equal(clearErrors.calls.deferred, 1);
  assert.equal(clearErrors.calls.edits[0].content, "overview|Ошибки обновления очищены у 3 профилей.");

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
    buildRobloxPanelPayload: ({ statusText = "", viewMode = "overview" } = {}) => ({ content: statusText || `opened:${viewMode}` }),
  });

  assert.equal(openPanel.calls.updates[0].content, "opened:overview");

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
