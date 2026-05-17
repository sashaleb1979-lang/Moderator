"use strict";

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require("discord.js");
const { ensureSharedProfile } = require("./shared-profile");

const ROBLOX_PANEL_TOP_LIMIT = 5;
const ROBLOX_PANEL_ISSUE_LIMIT = 4;
const ROBLOX_PANEL_DEFAULT_VIEW = "overview";
const ROBLOX_PANEL_VIEW_LABELS = {
  overview: "Обзор",
  coverage: "Покрытие",
  activity: "Активность",
  errors: "Ошибки",
};

const ROBLOX_PANEL_JOB_KEYS = {
  profile_refresh: "profileRefresh",
  profileRefresh: "profileRefresh",
  playtime_sync: "playtimeSync",
  playtimeSync: "playtimeSync",
  runtime_flush: "runtimeFlush",
  runtimeFlush: "runtimeFlush",
};

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function truncateText(value, limit = 120) {
  const text = cleanString(value, limit + 1);
  if (!text) return null;
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…` : text;
}

function normalizeNonNegativeInteger(value, fallback = 0) {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : fallback;
}

function resolveNowIso(now) {
  if (typeof now === "function") {
    const value = cleanString(now(), 80);
    if (value) return value;
  }
  return new Date().toISOString();
}

function formatDateTime(value) {
  const timestamp = Date.parse(value || "");
  if (!Number.isFinite(timestamp)) return "—";
  return new Date(timestamp).toLocaleString("ru-RU");
}

function formatMinutes(value) {
  return `${normalizeNonNegativeInteger(value, 0)} мин`;
}

function normalizeTelemetryJobKey(kind) {
  return ROBLOX_PANEL_JOB_KEYS[String(kind || "").trim()] || null;
}

function normalizeRobloxPanelViewMode(viewMode) {
  const normalized = cleanString(viewMode, 40).toLowerCase();
  return ROBLOX_PANEL_VIEW_LABELS[normalized] ? normalized : ROBLOX_PANEL_DEFAULT_VIEW;
}

function parseRobloxPanelCustomId(customId) {
  const normalized = cleanString(customId, 120);
  const [baseCustomId, scopedViewMode] = normalized.split(":", 2);
  return {
    baseCustomId: cleanString(baseCustomId, 120),
    viewMode: normalizeRobloxPanelViewMode(scopedViewMode),
  };
}

function buildRobloxPanelScopedCustomId(baseCustomId, viewMode) {
  return `${cleanString(baseCustomId, 120)}:${normalizeRobloxPanelViewMode(viewMode)}`;
}

function resolveRobloxPanelNavigationViewMode(baseCustomId, fallbackViewMode) {
  if (baseCustomId === "roblox_stats_view_coverage") return "coverage";
  if (baseCustomId === "roblox_stats_view_activity") return "activity";
  if (baseCustomId === "roblox_stats_view_errors") return "errors";
  if (baseCustomId === "roblox_stats_view_overview") return "overview";
  return normalizeRobloxPanelViewMode(fallbackViewMode);
}

function getRobloxPanelViewLabel(viewMode) {
  return ROBLOX_PANEL_VIEW_LABELS[normalizeRobloxPanelViewMode(viewMode)] || ROBLOX_PANEL_VIEW_LABELS[ROBLOX_PANEL_DEFAULT_VIEW];
}

function formatJobStatus(status) {
  const normalized = cleanString(status, 40) || "idle";
  if (normalized === "running") return "в работе";
  if (normalized === "ok") return "успешно";
  if (normalized === "error") return "ошибка";
  if (normalized === "pending_flush") return "ожидает flush";
  return "ожидание";
}

function formatVerificationStatus(status) {
  const normalized = cleanString(status, 40) || "unverified";
  if (normalized === "verified") return "проверен";
  if (normalized === "pending") return "ждёт сверки";
  if (normalized === "failed") return "сверка не пройдена";
  return "не привязан";
}

function createTelemetryJobState(label) {
  return {
    label,
    status: "idle",
    lastStartedAt: null,
    lastFinishedAt: null,
    errorText: null,
    summary: {},
    runCount: 0,
    pendingPromise: null,
  };
}

function summarizeTelemetryResult(kind, result = {}) {
  const summary = result && typeof result === "object" ? result : {};
  if (kind === "profileRefresh") {
    return {
      totalCandidates: normalizeNonNegativeInteger(summary.totalCandidates, 0),
      refreshedCount: normalizeNonNegativeInteger(summary.refreshedCount, 0),
      failedCount: normalizeNonNegativeInteger(summary.failedCount, 0),
      avatarErrors: normalizeNonNegativeInteger(summary.avatarErrors, 0),
    };
  }
  if (kind === "playtimeSync") {
    return {
      totalCandidates: normalizeNonNegativeInteger(summary.totalCandidates, 0),
      totalBatches: normalizeNonNegativeInteger(summary.totalBatches, 0),
      processedBatches: normalizeNonNegativeInteger(summary.processedBatches, 0),
      failedBatches: normalizeNonNegativeInteger(summary.failedBatches, 0),
      processedUserIds: normalizeNonNegativeInteger(summary.processedUserIds, 0),
      failedUserIds: normalizeNonNegativeInteger(summary.failedUserIds, 0),
      activeJjsUsers: normalizeNonNegativeInteger(summary.activeJjsUsers, 0),
      opaqueInGameUsers: normalizeNonNegativeInteger(summary.opaqueInGameUsers, 0),
      touchedUserCount: normalizeNonNegativeInteger(summary.touchedUserCount, 0),
      startedSessionCount: normalizeNonNegativeInteger(summary.startedSessionCount, 0),
      closedSessionCount: normalizeNonNegativeInteger(summary.closedSessionCount, 0),
      activeCoPlayPairCount: normalizeNonNegativeInteger(summary.activeCoPlayPairCount, 0),
      repairedBindingCount: normalizeNonNegativeInteger(summary.repairedBindingCount, 0),
      unresolvedBindingCount: normalizeNonNegativeInteger(summary.unresolvedBindingCount, 0),
      failedRepairBatchCount: normalizeNonNegativeInteger(summary.failedRepairBatchCount, 0),
      sanitizedBindingCount: normalizeNonNegativeInteger(summary.sanitizedBindingCount, 0),
      skippedReason: cleanString(summary.skippedReason, 80) || null,
    };
  }
  if (kind === "runtimeFlush") {
    return {
      saved: summary.saved === true,
      dirtyUserCount: normalizeNonNegativeInteger(summary.dirtyUserCount, 0),
      flushedAt: cleanString(summary.flushedAt, 80) || null,
    };
  }
  return {};
}

function createRobloxPanelTelemetry(options = {}) {
  const telemetry = {
    jobs: {
      profileRefresh: createTelemetryJobState("Обновление профилей"),
      playtimeSync: createTelemetryJobState("Синк playtime"),
      runtimeFlush: createTelemetryJobState("Сохранение runtime"),
    },
    wrapJob(kind, job) {
      const normalizedKind = normalizeTelemetryJobKey(kind);
      if (!normalizedKind) {
        throw new TypeError("Unsupported Roblox panel telemetry job kind");
      }
      if (typeof job !== "function") {
        throw new TypeError("job must be a function");
      }

      return async (...args) => {
        const state = telemetry.jobs[normalizedKind];
        if (state.pendingPromise) {
          return state.pendingPromise;
        }

        state.status = "running";
        state.lastStartedAt = resolveNowIso(options.now);
        state.errorText = null;

        state.pendingPromise = Promise.resolve()
          .then(() => job(...args))
          .then((result) => {
            state.status = "ok";
            state.lastFinishedAt = resolveNowIso(options.now);
            state.errorText = null;
            state.summary = summarizeTelemetryResult(normalizedKind, result);
            state.runCount += 1;
            return result;
          })
          .catch((error) => {
            state.status = "error";
            state.lastFinishedAt = resolveNowIso(options.now);
            state.errorText = truncateText(error?.message || error, 240) || "неизвестная ошибка";
            state.summary = summarizeTelemetryResult(normalizedKind, state.summary);
            state.runCount += 1;
            throw error;
          })
          .finally(() => {
            state.pendingPromise = null;
          });

        return state.pendingPromise;
      };
    },
  };

  return telemetry;
}

function getRuntimeActiveSessionCount(runtimeState = {}) {
  return Object.keys(runtimeState?.activeSessionsByDiscordUserId || {}).length;
}

function getRuntimeActiveCoPlayPairCount(runtimeState = {}) {
  return Object.keys(runtimeState?.activeCoPlayPairsByKey || {}).length;
}

function getRuntimeDirtyUserCount(runtimeState = {}) {
  if (runtimeState?.dirtyDiscordUserIds instanceof Set) {
    return runtimeState.dirtyDiscordUserIds.size;
  }
  if (Array.isArray(runtimeState?.dirtyDiscordUserIds)) {
    return runtimeState.dirtyDiscordUserIds.length;
  }
  return 0;
}

function hasRuntimeDirtyUser(runtimeState = {}, userId = "") {
  const normalizedUserId = cleanString(userId, 80);
  if (!normalizedUserId) return false;
  if (runtimeState?.dirtyDiscordUserIds instanceof Set) {
    return runtimeState.dirtyDiscordUserIds.has(normalizedUserId);
  }
  if (Array.isArray(runtimeState?.dirtyDiscordUserIds)) {
    return runtimeState.dirtyDiscordUserIds.includes(normalizedUserId);
  }
  return false;
}

function isJjsConfigured(appConfig = {}) {
  const roblox = appConfig?.roblox || {};
  return Boolean(
    normalizeNonNegativeInteger(roblox.jjsUniverseId, 0)
    || normalizeNonNegativeInteger(roblox.jjsRootPlaceId, 0)
    || normalizeNonNegativeInteger(roblox.jjsPlaceId, 0)
  );
}

function isMetadataRefreshEnabled(appConfig = {}) {
  return appConfig?.roblox?.metadataRefreshEnabled !== false;
}

function isPlaytimeTrackingEnabled(appConfig = {}) {
  return appConfig?.roblox?.playtimeTrackingEnabled !== false;
}

function isRuntimeFlushEnabled(appConfig = {}) {
  return appConfig?.roblox?.runtimeFlushEnabled !== false;
}

function getPlaytimePollMinutes(appConfig = {}) {
  return Math.max(1, normalizeNonNegativeInteger(appConfig?.roblox?.playtimePollMinutes, 2) || 2);
}

function resolvePanelAppConfig(appConfig = {}, getAppConfig = null) {
  if (typeof getAppConfig === "function") {
    const resolved = getAppConfig();
    if (resolved && typeof resolved === "object" && !Array.isArray(resolved)) {
      return resolved;
    }
  }

  return appConfig && typeof appConfig === "object" && !Array.isArray(appConfig) ? appConfig : {};
}

function shouldIncludeRobloxEntry(roblox = {}) {
  return Boolean(
    cleanString(roblox.userId, 40)
    || cleanString(roblox.username, 120)
    || cleanString(roblox.verificationStatus, 40) !== "unverified"
    || cleanString(roblox.lastRefreshAt, 80)
    || cleanString(roblox.refreshError, 500)
    || normalizeNonNegativeInteger(roblox.totalJjsMinutes, 0) > 0
  );
}

function buildRobloxEntryNote(entry = {}, options = {}) {
  const showRefreshDiagnostics = options.showRefreshDiagnostics !== false;
  const parts = [];
  if (entry.trackingState === "manual_only") {
    parts.push("проверен, но нет валидного userId и username");
  } else if (entry.trackingState === "repairable") {
    parts.push("проверен, но userId отсутствует; можно repair по username");
  }

  if (entry.refreshError) {
    parts.push(`ошибка обновления: ${truncateText(entry.refreshError, 70)}`);
  } else if (entry.verificationStatus === "failed") {
    parts.push("сверка не пройдена");
  } else if (entry.verificationStatus === "pending") {
    parts.push("ждёт сверки");
  } else if (showRefreshDiagnostics && entry.verificationStatus === "verified" && !entry.lastRefreshAt) {
    parts.push("ждёт обновления профиля");
  }

  if (entry.isActiveInRuntime) {
    parts.push("сейчас в JJS");
  } else if (entry.currentSessionStartedAt) {
    parts.push("остался session marker");
  }

  if (entry.dirtyRuntime) {
    parts.push("ожидает сохранения runtime");
  }

  if (!parts.length && entry.activityState === "never_seen") {
    parts.push("ещё не был замечен в JJS");
  }

  if (!parts.length && entry.lastSeenInJjsAt) {
    parts.push(`последний раз замечен ${formatDateTime(entry.lastSeenInJjsAt)}`);
  }

  return parts.join(" | ") || "норма";
}

function getRobloxEntryPriority(entry = {}, options = {}) {
  const showRefreshDiagnostics = options.showRefreshDiagnostics !== false;
  let score = normalizeNonNegativeInteger(entry.totalJjsMinutes, 0);
  if (entry.isActiveInRuntime) score += 1000000;
  if (entry.trackingState === "repairable") score += 2250000;
  if (entry.trackingState === "manual_only") score += 3250000;
  if (showRefreshDiagnostics && entry.verificationStatus === "verified" && !entry.lastRefreshAt) score += 2500000;
  if (entry.verificationStatus === "pending") score += 3000000;
  if (entry.verificationStatus === "failed") score += 4000000;
  if (entry.refreshError) score += 5000000;
  if (entry.dirtyRuntime) score += 500000;
  return score;
}

function getRobloxTrackingState(entry = {}) {
  if (entry.verificationStatus === "verified") {
    if (entry.robloxUserId) {
      return "trackable";
    }
    if (entry.robloxUsername) {
      return "repairable";
    }
    return "manual_only";
  }
  if (entry.verificationStatus === "pending") {
    return "pending";
  }
  if (entry.verificationStatus === "failed") {
    return "failed";
  }
  return "unverified";
}

function getRobloxActivityState(entry = {}) {
  if (entry.trackingState !== "trackable") {
    return null;
  }
  if (entry.isActiveInRuntime) {
    return "active_now";
  }
  if (entry.currentSessionStartedAt) {
    return "stale_session_marker";
  }
  if (entry.lastSeenInJjsAt || normalizeNonNegativeInteger(entry.totalJjsMinutes, 0) > 0) {
    return "seen_before";
  }
  return "never_seen";
}

function getRobloxTrackingBlocker(entry = {}, options = {}) {
  const showRefreshDiagnostics = options.showRefreshDiagnostics !== false;
  if (entry.verificationStatus !== "verified") {
    return "none";
  }
  if (!entry.robloxUserId) {
    return entry.robloxUsername ? "invalid_user_id" : "missing_username";
  }
  if (showRefreshDiagnostics && entry.refreshError) {
    return "refresh_error";
  }
  if (showRefreshDiagnostics && !entry.lastRefreshAt) {
    return "never_refreshed";
  }
  if (!entry.isActiveInRuntime && !entry.currentSessionStartedAt && !entry.lastSeenInJjsAt && normalizeNonNegativeInteger(entry.totalJjsMinutes, 0) === 0) {
    return "zero_minutes";
  }
  return "none";
}

function collectRobloxPanelEntries(db = {}, runtimeState = {}, options = {}) {
  const showRefreshDiagnostics = options.showRefreshDiagnostics !== false;
  return Object.entries(db?.profiles || {})
    .map(([userId, rawProfile]) => {
      const profile = ensureSharedProfile(rawProfile, userId).profile;
      const summary = profile?.summary?.roblox || {};
      if (!shouldIncludeRobloxEntry(summary)) {
        return null;
      }

      const runtimeSession = runtimeState?.activeSessionsByDiscordUserId?.[userId] || null;
      const entry = {
        userId: cleanString(userId, 80),
        displayName: cleanString(profile?.displayName, 200) || cleanString(profile?.username, 120) || `User ${userId}`,
        discordUsername: cleanString(profile?.username, 120) || null,
        robloxUsername: cleanString(summary.currentUsername || summary.username, 120) || null,
        robloxDisplayName: cleanString(summary.currentDisplayName || summary.displayName, 120) || null,
        robloxUserId: cleanString(summary.userId, 40) || null,
        verificationStatus: cleanString(summary.verificationStatus, 40) || "unverified",
        refreshStatus: cleanString(summary.refreshStatus, 40) || null,
        refreshError: showRefreshDiagnostics ? cleanString(summary.refreshError, 500) || null : null,
        lastRefreshAt: cleanString(summary.lastRefreshAt, 80) || null,
        totalJjsMinutes: normalizeNonNegativeInteger(summary.totalJjsMinutes, 0),
        currentSessionStartedAt: cleanString(summary.currentSessionStartedAt, 80) || null,
        lastSeenInJjsAt: cleanString(summary.lastSeenInJjsAt, 80) || null,
        dirtyRuntime: hasRuntimeDirtyUser(runtimeState, userId),
        isActiveInRuntime: Boolean(runtimeSession),
      };
      entry.trackingState = getRobloxTrackingState(entry);
      entry.activityState = getRobloxActivityState(entry);
      entry.trackingBlocker = getRobloxTrackingBlocker(entry, { showRefreshDiagnostics });
      entry.note = buildRobloxEntryNote(entry, { showRefreshDiagnostics });
      entry.displayReason = entry.note;
      entry.priorityScore = getRobloxEntryPriority(entry, { showRefreshDiagnostics });
      return entry;
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (right.priorityScore !== left.priorityScore) {
        return right.priorityScore - left.priorityScore;
      }
      if (right.totalJjsMinutes !== left.totalJjsMinutes) {
        return right.totalJjsMinutes - left.totalJjsMinutes;
      }
      return String(left.displayName).localeCompare(String(right.displayName), "ru");
    });
}

function cloneTelemetryJobState(job = {}, runtimeState = {}) {
  return {
    label: cleanString(job.label, 80),
    status: cleanString(job.status, 40) || "idle",
    lastStartedAt: cleanString(job.lastStartedAt, 80) || null,
    lastFinishedAt: cleanString(job.lastFinishedAt, 80) || null,
    errorText: cleanString(job.errorText, 500) || null,
    runCount: normalizeNonNegativeInteger(job.runCount, 0),
    summary: { ...(job.summary || {}) },
    runtime: {
      activeSessionCount: getRuntimeActiveSessionCount(runtimeState),
      activeCoPlayPairCount: getRuntimeActiveCoPlayPairCount(runtimeState),
      dirtyUserCount: getRuntimeDirtyUserCount(runtimeState),
    },
  };
}

function formatRobloxListEntry(entry = {}, index = 0) {
  const label = entry.robloxUsername
    ? `${entry.displayName} -> ${entry.robloxUsername}`
    : entry.displayName;
  return `${index + 1}. ${label} | ${truncateText(entry.displayReason || entry.note, 90) || "норма"}`;
}

function buildRobloxListSection(title, entries = [], totalCount = 0, emptyText = "нет") {
  const lines = [`${title}: **${normalizeNonNegativeInteger(totalCount, 0)}**`];
  if (!entries.length) {
    lines.push(emptyText);
    return lines.join("\n");
  }
  lines.push(...entries.map((entry, index) => formatRobloxListEntry(entry, index)));
  if (totalCount > entries.length) {
    lines.push(`+${totalCount - entries.length} ещё`);
  }
  return lines.join("\n");
}

function countEntries(entries = [], predicate) {
  if (typeof predicate !== "function") {
    return 0;
  }
  return entries.filter((entry) => predicate(entry)).length;
}

function filterEntries(entries = [], predicate, limit = ROBLOX_PANEL_TOP_LIMIT) {
  if (typeof predicate !== "function") {
    return [];
  }
  return entries.filter((entry) => predicate(entry)).slice(0, limit);
}

function hasRobloxEverSeenInGame(entry = {}) {
  return Boolean(
    entry.isActiveInRuntime
    || cleanString(entry.lastSeenInJjsAt, 80)
    || normalizeNonNegativeInteger(entry.totalJjsMinutes, 0) > 0
  );
}

function formatRobloxAuthenticatedEntryLabel(entry = {}) {
  return entry.robloxUsername
    ? `${entry.displayName} -> ${entry.robloxUsername}`
    : entry.displayName;
}

function compareRobloxAuthenticatedEntries(left = {}, right = {}) {
  const leftSeen = hasRobloxEverSeenInGame(left);
  const rightSeen = hasRobloxEverSeenInGame(right);
  if (leftSeen !== rightSeen) {
    return Number(rightSeen) - Number(leftSeen);
  }
  return String(left.displayName).localeCompare(String(right.displayName), "ru");
}

function buildRobloxAuthenticatedListText(entries = [], limit = 3200) {
  const verifiedEntries = Array.isArray(entries) ? entries : [];
  if (!verifiedEntries.length) {
    return "Пока нет подтверждённых Roblox-профилей.";
  }

  const lines = [];
  let remainingCount = 0;
  for (const entry of verifiedEntries) {
    const line = `${hasRobloxEverSeenInGame(entry) ? "✓" : "—"} ${formatRobloxAuthenticatedEntryLabel(entry)}`;
    const nextText = [...lines, line].join("\n");
    if (nextText.length > limit) {
      remainingCount += 1;
      continue;
    }
    lines.push(line);
  }

  if (!lines.length) {
    return `Пока не удалось показать список целиком. Всего подтверждённых: ${verifiedEntries.length}.`;
  }

  if (remainingCount > 0) {
    const overflowLine = `+${remainingCount} ещё`;
    const nextText = [...lines, overflowLine].join("\n");
    if (nextText.length <= limit) {
      lines.push(overflowLine);
    }
  }

  return lines.join("\n");
}

function buildRobloxSimplePanelDescription(snapshot = {}) {
  const summaryLines = [
    "Список подтверждённых Roblox-профилей.",
    "✓ = бот хотя бы раз фиксировал пользователя в игре.",
    `Подтверждено: **${snapshot.totals?.verifiedUsers || 0}**`,
    `С галочкой: **${snapshot.totals?.verifiedSeenUsers || 0}**`,
    `Без галочки: **${snapshot.totals?.verifiedUnseenUsers || 0}**`,
    "",
  ];
  const prefix = summaryLines.join("\n");
  const remainingLimit = Math.max(200, 4096 - prefix.length - 1);
  const listText = buildRobloxAuthenticatedListText(snapshot.lists?.verifiedEntries, remainingLimit);
  return `${prefix}${listText}`;
}

function buildRobloxPanelIssues(snapshot = {}) {
  const issues = [];
  const metadataRefreshEnabled = snapshot.config?.metadataRefreshEnabled !== false;
  const playtimeTrackingEnabled = snapshot.config?.playtimeTrackingEnabled !== false;
  const runtimeFlushEnabled = snapshot.config?.runtimeFlushEnabled !== false;

  if (playtimeTrackingEnabled && !snapshot.config?.jjsReady) {
    issues.push("JJS IDs не настроены: сбор playtime не начнётся, пока jjsUniverseId, jjsRootPlaceId и jjsPlaceId равны 0.");
  }

  if (metadataRefreshEnabled && snapshot.jobs?.profileRefresh?.status === "error") {
    issues.push(`Обновление профилей упало: ${snapshot.jobs.profileRefresh.errorText}`);
  } else if (metadataRefreshEnabled && normalizeNonNegativeInteger(snapshot.jobs?.profileRefresh?.summary?.failedCount, 0) > 0) {
    issues.push(`Обновление профилей завершилось с ошибками: ${snapshot.jobs.profileRefresh.summary.failedCount}.`);
  }

  if (playtimeTrackingEnabled && snapshot.jobs?.playtimeSync?.status === "error") {
    issues.push(`Синк playtime упал: ${snapshot.jobs.playtimeSync.errorText}`);
  } else if (playtimeTrackingEnabled && normalizeNonNegativeInteger(snapshot.jobs?.playtimeSync?.summary?.failedBatches, 0) > 0) {
    issues.push(
      `Синк playtime потерял пачки: ${snapshot.jobs.playtimeSync.summary.failedBatches} шт., пользователей с ошибкой: ${normalizeNonNegativeInteger(snapshot.jobs?.playtimeSync?.summary?.failedUserIds, 0)}.`
    );
  } else if (playtimeTrackingEnabled && normalizeNonNegativeInteger(snapshot.jobs?.playtimeSync?.summary?.opaqueInGameUsers, 0) > 0) {
    issues.push(`Roblox API вернула in_game без universe/root/place ids для ${snapshot.jobs.playtimeSync.summary.opaqueInGameUsers} профилей; playtime по ним учитывается через fallback и может быть неточным.`);
  }

  if (runtimeFlushEnabled && snapshot.jobs?.runtimeFlush?.status === "error") {
    issues.push(`Сохранение runtime упало: ${snapshot.jobs.runtimeFlush.errorText}`);
  }

  if (metadataRefreshEnabled && snapshot.totals?.refreshErrorUsers > 0) {
    const names = snapshot.topEntries
      .filter((entry) => entry.refreshError)
      .slice(0, ROBLOX_PANEL_ISSUE_LIMIT)
      .map((entry) => entry.robloxUsername || entry.displayName);
    issues.push(`У пользователей остались ошибки обновления: ${names.join(", ")}${snapshot.totals.refreshErrorUsers > names.length ? ", ..." : ""}.`);
  }

  return issues.slice(0, ROBLOX_PANEL_ISSUE_LIMIT);
}

function getRobloxStatsPanelSnapshot({ db = {}, runtimeState = {}, telemetry = null, appConfig = {} } = {}) {
  const metadataRefreshEnabled = isMetadataRefreshEnabled(appConfig);
  const entries = collectRobloxPanelEntries(db, runtimeState, {
    showRefreshDiagnostics: metadataRefreshEnabled,
  });
  const verifiedEntries = entries
    .filter((entry) => entry.verificationStatus === "verified")
    .sort(compareRobloxAuthenticatedEntries);
  const verifiedTrackableUsers = countEntries(entries, (entry) => entry.trackingState === "trackable");
  const verifiedRepairableUsers = countEntries(entries, (entry) => entry.trackingState === "repairable");
  const verifiedManualOnlyUsers = countEntries(entries, (entry) => entry.trackingState === "manual_only");
  const verifiedSeenInJjsUsers = countEntries(entries, (entry) => entry.trackingState === "trackable" && entry.activityState && entry.activityState !== "never_seen");
  const verifiedNeverSeenInJjsUsers = countEntries(entries, (entry) => entry.trackingState === "trackable" && entry.activityState === "never_seen");
  const verifiedZeroMinuteUsers = countEntries(entries, (entry) => entry.trackingState === "trackable" && normalizeNonNegativeInteger(entry.totalJjsMinutes, 0) === 0);
  const staleSessionMarkerUsers = countEntries(entries, (entry) => entry.activityState === "stale_session_marker");
  const verifiedSeenUsers = countEntries(verifiedEntries, (entry) => hasRobloxEverSeenInGame(entry));
  const topEntries = entries.slice(0, ROBLOX_PANEL_TOP_LIMIT);
  const snapshot = {
    config: {
      jjsReady: isJjsConfigured(appConfig),
      metadataRefreshEnabled,
      playtimeTrackingEnabled: isPlaytimeTrackingEnabled(appConfig),
      runtimeFlushEnabled: isRuntimeFlushEnabled(appConfig),
      playtimePollMinutes: getPlaytimePollMinutes(appConfig),
      jjsUniverseId: normalizeNonNegativeInteger(appConfig?.roblox?.jjsUniverseId, 0),
      jjsRootPlaceId: normalizeNonNegativeInteger(appConfig?.roblox?.jjsRootPlaceId, 0),
      jjsPlaceId: normalizeNonNegativeInteger(appConfig?.roblox?.jjsPlaceId, 0),
    },
    totals: {
      footprintUsers: entries.length,
      linkedUsers: entries.length,
      verifiedUsers: entries.filter((entry) => entry.verificationStatus === "verified").length,
      verifiedTrackableUsers,
      verifiedRepairableUsers,
      verifiedManualOnlyUsers,
      verifiedSeenUsers,
      verifiedUnseenUsers: Math.max(0, verifiedEntries.length - verifiedSeenUsers),
      verifiedSeenInJjsUsers,
      verifiedNeverSeenInJjsUsers,
      verifiedZeroMinuteUsers,
      staleSessionMarkerUsers,
      pendingUsers: entries.filter((entry) => entry.verificationStatus === "pending").length,
      failedUsers: entries.filter((entry) => entry.verificationStatus === "failed").length,
      refreshErrorUsers: entries.filter((entry) => Boolean(entry.refreshError)).length,
      neverRefreshedVerifiedUsers: entries.filter((entry) => entry.verificationStatus === "verified" && !entry.lastRefreshAt).length,
      activeJjsUsers: getRuntimeActiveSessionCount(runtimeState),
      dirtyRuntimeUsers: getRuntimeDirtyUserCount(runtimeState),
      activeCoPlayPairs: getRuntimeActiveCoPlayPairCount(runtimeState),
    },
    jobs: {
      profileRefresh: cloneTelemetryJobState(telemetry?.jobs?.profileRefresh, runtimeState),
      playtimeSync: cloneTelemetryJobState(telemetry?.jobs?.playtimeSync, runtimeState),
      runtimeFlush: cloneTelemetryJobState(telemetry?.jobs?.runtimeFlush, runtimeState),
    },
    lists: {
      verifiedEntries,
      repairableEntries: filterEntries(entries, (entry) => entry.trackingState === "repairable"),
      manualOnlyEntries: filterEntries(entries, (entry) => entry.trackingState === "manual_only"),
      activeNowEntries: filterEntries(entries, (entry) => entry.activityState === "active_now"),
      neverSeenEntries: filterEntries(entries, (entry) => entry.activityState === "never_seen"),
      refreshErrorEntries: filterEntries(entries, (entry) => Boolean(entry.refreshError)),
      staleSessionEntries: filterEntries(entries, (entry) => entry.activityState === "stale_session_marker"),
    },
    topEntries,
  };
  snapshot.issues = buildRobloxPanelIssues(snapshot);
  return snapshot;
}

function buildPlaytimeRepairSummaryPieces(summary = {}) {
  const pieces = [];
  if (normalizeNonNegativeInteger(summary?.sanitizedBindingCount, 0) > 0) {
    pieces.push(`санитизировано ${summary.sanitizedBindingCount}`);
  }
  if (normalizeNonNegativeInteger(summary?.repairedBindingCount, 0) > 0) {
    pieces.push(`починено по username ${summary.repairedBindingCount}`);
  }
  if (normalizeNonNegativeInteger(summary?.unresolvedBindingCount, 0) > 0) {
    pieces.push(`без repair осталось ${summary.unresolvedBindingCount}`);
  }
  if (normalizeNonNegativeInteger(summary?.failedRepairBatchCount, 0) > 0) {
    pieces.push(`ошибок repair batch ${summary.failedRepairBatchCount}`);
  }
  return pieces;
}

function formatRobloxJobLine(job = {}) {
  const status = formatJobStatus(job.status);
  const pieces = [status];
  if (job.lastFinishedAt) {
    pieces.push(formatDateTime(job.lastFinishedAt));
  } else if (job.lastStartedAt) {
    pieces.push(`запущено ${formatDateTime(job.lastStartedAt)}`);
  }
  if (job.status === "error" && job.errorText) {
    pieces.push(job.errorText);
  }
  if (normalizeNonNegativeInteger(job.summary?.failedCount, 0) > 0) {
    pieces.push(`ошибок ${job.summary.failedCount}`);
  }
  if (normalizeNonNegativeInteger(job.summary?.failedBatches, 0) > 0) {
    pieces.push(`потеряно пачек ${job.summary.failedBatches}`);
  }
  if (normalizeNonNegativeInteger(job.summary?.touchedUserCount, 0) > 0) {
    pieces.push(`затронуто ${job.summary.touchedUserCount}`);
  }
  if (normalizeNonNegativeInteger(job.summary?.dirtyUserCount, 0) > 0) {
    pieces.push(`грязных ${job.summary.dirtyUserCount}`);
  }
  const repairPieces = buildPlaytimeRepairSummaryPieces(job.summary);
  if (repairPieces.length) {
    pieces.push(repairPieces.join(", "));
  }
  return pieces.join(" | ");
}

function formatRobloxRuntimeFlushLine(job = {}) {
  const runtimeDirtyUserCount = Math.max(
    normalizeNonNegativeInteger(job.summary?.dirtyUserCount, 0),
    normalizeNonNegativeInteger(job.runtime?.dirtyUserCount, 0)
  );
  const normalizedStatus = cleanString(job.status, 40) || "idle";
  const effectiveStatus = runtimeDirtyUserCount > 0 && ["idle", "ok"].includes(normalizedStatus)
    ? "pending_flush"
    : normalizedStatus;

  return formatRobloxJobLine({
    ...job,
    status: effectiveStatus,
    summary: {
      ...(job.summary || {}),
      dirtyUserCount: runtimeDirtyUserCount,
    },
  });
}

function formatTopEntry(entry = {}, index = 0) {
  const label = entry.robloxUsername
    ? `${entry.displayName} -> ${entry.robloxUsername}`
    : entry.displayName;
  return [
    `${index + 1}. ${label}`,
    formatVerificationStatus(entry.verificationStatus),
    formatMinutes(entry.totalJjsMinutes),
    truncateText(entry.note, 90) || "норма",
  ].join(" | ");
}

function buildToggleLabel(prefix, enabled) {
  return `${prefix}: ${enabled ? "ВКЛ" : "ВЫКЛ"}`;
}

function getToggleButtonStyle(enabled) {
  return enabled ? ButtonStyle.Success : ButtonStyle.Secondary;
}

function getPollButtonStyle(currentMinutes, buttonMinutes) {
  return Number(currentMinutes) === Number(buttonMinutes) ? ButtonStyle.Success : ButtonStyle.Secondary;
}

function getRobloxPanelViewButtonStyle(currentViewMode, buttonViewMode) {
  return normalizeRobloxPanelViewMode(currentViewMode) === normalizeRobloxPanelViewMode(buttonViewMode)
    ? ButtonStyle.Success
    : ButtonStyle.Secondary;
}

function buildPlaytimeSyncStatusText(result = {}) {
  const skippedReason = cleanString(result.skippedReason, 80) || null;
  const repairPieces = buildPlaytimeRepairSummaryPieces(result);
  const repairText = repairPieces.length ? ` Перед синком: ${repairPieces.join(", ")}.` : "";
  if (skippedReason === "jjs_ids_not_configured") {
    return `Синк playtime пропущен: JJS IDs не настроены.${repairText}`;
  }
  if (skippedReason === "no_verified_candidates") {
    return `Синк playtime пропущен: нет ни одной подтверждённой Roblox-привязки с userId.${repairText}`;
  }

  const totalCandidates = normalizeNonNegativeInteger(result.totalCandidates, 0);
  const activeJjsUsers = normalizeNonNegativeInteger(result.activeJjsUsers, 0);
  const opaqueInGameUsers = normalizeNonNegativeInteger(result.opaqueInGameUsers, 0);
  const touchedUserCount = normalizeNonNegativeInteger(result.touchedUserCount, 0);
  const failedUserIds = normalizeNonNegativeInteger(result.failedUserIds, 0);
  const baseText = `Синк playtime завершён. Кандидатов: ${totalCandidates}, активных в JJS: ${activeJjsUsers}, затронуто профилей: ${touchedUserCount}, ошибок пользователей: ${failedUserIds}.`;

  if (opaqueInGameUsers > 0) {
    return `${baseText}${repairText} Roblox API скрыла universe/root/place ids у ${opaqueInGameUsers} in-game профилей, поэтому они учтены через fallback-режим.`;
  }

  if (totalCandidates > 0 && activeJjsUsers === 0 && failedUserIds === 0) {
    return `${baseText}${repairText} В configured JJS сейчас никого не видно.`;
  }

  return `${baseText}${repairText}`;
}

function buildRobloxModeFieldValue(snapshot = {}) {
  const metadataRefreshEnabled = snapshot.config?.metadataRefreshEnabled !== false;
  const playtimeTrackingEnabled = snapshot.config?.playtimeTrackingEnabled !== false;
  const runtimeFlushEnabled = snapshot.config?.runtimeFlushEnabled !== false;
  return [
    `Учёт JJS: **${playtimeTrackingEnabled ? "включён" : "выключен"}**`,
    `Обновление профилей: **${metadataRefreshEnabled ? "включено" : "выключено"}**`,
    `Сохранение runtime: **${runtimeFlushEnabled ? "включено" : "выключено"}**`,
    `Интервал опроса: **${snapshot.config?.playtimePollMinutes} мин**`,
  ].join("\n");
}

function buildRobloxCoverageFieldValue(snapshot = {}) {
  const metadataRefreshEnabled = snapshot.config?.metadataRefreshEnabled !== false;
  return [
    `Проверено: **${snapshot.totals?.verifiedUsers || 0}**`,
    `Trackable для playtime: **${snapshot.totals?.verifiedTrackableUsers || 0}**`,
    `Починится по username: **${snapshot.totals?.verifiedRepairableUsers || 0}**`,
    `Нужен manual rebind: **${snapshot.totals?.verifiedManualOnlyUsers || 0}**`,
    `Ждут сверки: **${snapshot.totals?.pendingUsers || 0}**`,
    `Сверка не пройдена: **${snapshot.totals?.failedUsers || 0}**`,
    `${metadataRefreshEnabled ? "С ошибками обновления" : "Исторические ошибки обновления скрыты"}: **${metadataRefreshEnabled ? snapshot.totals?.refreshErrorUsers || 0 : 0}**`,
    `${metadataRefreshEnabled ? "Проверены, но не обновлялись" : "Без полного профиля"}: **${snapshot.totals?.neverRefreshedVerifiedUsers || 0}**`,
  ].join("\n");
}

function buildRobloxRuntimeFieldValue(snapshot = {}) {
  const playtimeTrackingEnabled = snapshot.config?.playtimeTrackingEnabled !== false;
  return [
    `Сейчас в JJS: **${snapshot.totals?.activeJjsUsers || 0}**`,
    `Несохранённых runtime-профилей: **${snapshot.totals?.dirtyRuntimeUsers || 0}**`,
    `Активных co-play пар: **${snapshot.totals?.activeCoPlayPairs || 0}**`,
    playtimeTrackingEnabled
      ? `Последний синк playtime: ${formatDateTime(snapshot.jobs?.playtimeSync?.lastFinishedAt || snapshot.jobs?.playtimeSync?.lastStartedAt)}`
      : "Последний синк playtime: выключен в настройках",
  ].join("\n");
}

function buildRobloxBackgroundJobsFieldValue(snapshot = {}) {
  const metadataRefreshEnabled = snapshot.config?.metadataRefreshEnabled !== false;
  const playtimeTrackingEnabled = snapshot.config?.playtimeTrackingEnabled !== false;
  const runtimeFlushEnabled = snapshot.config?.runtimeFlushEnabled !== false;
  return [
    `Обновление профилей: ${metadataRefreshEnabled ? formatRobloxJobLine(snapshot.jobs?.profileRefresh) : "выключено для passive tracking"}`,
    `Синк playtime: ${playtimeTrackingEnabled ? formatRobloxJobLine(snapshot.jobs?.playtimeSync) : "выключено в настройках"}`,
    `Сохранение runtime: ${runtimeFlushEnabled ? formatRobloxRuntimeFlushLine(snapshot.jobs?.runtimeFlush) : "выключено в настройках"}`,
  ].join("\n");
}

function buildRobloxBindingRepairFieldValue(snapshot = {}) {
  const bindingCoverageText = buildRobloxListSection(
    "Автопочинка по username",
    snapshot.lists?.repairableEntries,
    snapshot.totals?.verifiedRepairableUsers || 0,
    "Сейчас нет verified-профилей, которые чинятся только username repair-ом."
  );
  const manualRebindText = buildRobloxListSection(
    "Нужен manual rebind",
    snapshot.lists?.manualOnlyEntries,
    snapshot.totals?.verifiedManualOnlyUsers || 0,
    "Сейчас нет verified-профилей без userId и username."
  );
  return [bindingCoverageText, manualRebindText].join("\n\n");
}

function buildRobloxActivitySummaryFieldValue(snapshot = {}) {
  return [
    `Trackable профилей: **${snapshot.totals?.verifiedTrackableUsers || 0}**`,
    `Уже замечены в JJS: **${snapshot.totals?.verifiedSeenInJjsUsers || 0}**`,
    `Ещё не замечены в JJS: **${snapshot.totals?.verifiedNeverSeenInJjsUsers || 0}**`,
    `Trackable с 0 минут: **${snapshot.totals?.verifiedZeroMinuteUsers || 0}**`,
    `Stale session markers: **${snapshot.totals?.staleSessionMarkerUsers || 0}**`,
  ].join("\n");
}

function buildRobloxErrorsSummaryFieldValue(snapshot = {}) {
  return snapshot.issues?.length ? snapshot.issues.join("\n") : "Критичных блокеров сейчас не видно.";
}

function buildRobloxPanelFields(snapshot = {}, viewMode = ROBLOX_PANEL_DEFAULT_VIEW) {
  const normalizedViewMode = normalizeRobloxPanelViewMode(viewMode);
  if (normalizedViewMode === "coverage") {
    return [
      {
        name: "Режим",
        value: buildRobloxModeFieldValue(snapshot),
        inline: false,
      },
      {
        name: "Покрытие",
        value: buildRobloxCoverageFieldValue(snapshot),
        inline: false,
      },
      {
        name: "Кого чинить",
        value: buildRobloxBindingRepairFieldValue(snapshot),
        inline: false,
      },
    ];
  }

  if (normalizedViewMode === "activity") {
    return [
      {
        name: "Режим",
        value: buildRobloxModeFieldValue(snapshot),
        inline: false,
      },
      {
        name: "JJS и runtime",
        value: buildRobloxRuntimeFieldValue(snapshot),
        inline: false,
      },
      {
        name: "Активность профилей",
        value: buildRobloxActivitySummaryFieldValue(snapshot),
        inline: false,
      },
      {
        name: "Сейчас в JJS",
        value: buildRobloxListSection(
          "Активные профили",
          snapshot.lists?.activeNowEntries,
          snapshot.totals?.activeJjsUsers || 0,
          "Сейчас нет активных профилей в runtime."
        ),
        inline: false,
      },
      {
        name: "Ещё не были замечены в JJS",
        value: buildRobloxListSection(
          "Никогда не замечались",
          snapshot.lists?.neverSeenEntries,
          snapshot.totals?.verifiedNeverSeenInJjsUsers || 0,
          "Сейчас нет trackable verified-профилей без истории JJS."
        ),
        inline: false,
      },
    ];
  }

  if (normalizedViewMode === "errors") {
    return [
      {
        name: "Ошибки и блокеры",
        value: buildRobloxErrorsSummaryFieldValue(snapshot),
        inline: false,
      },
      {
        name: "Ошибки обновления",
        value: buildRobloxListSection(
          "Refresh errors",
          snapshot.lists?.refreshErrorEntries,
          snapshot.totals?.refreshErrorUsers || 0,
          "Сейчас нет профилей с refresh error."
        ),
        inline: false,
      },
      {
        name: "Stale session markers",
        value: buildRobloxListSection(
          "Подвисшие session markers",
          snapshot.lists?.staleSessionEntries,
          snapshot.totals?.staleSessionMarkerUsers || 0,
          "Сейчас нет stale session markers."
        ),
        inline: false,
      },
      {
        name: "Нужен manual rebind",
        value: buildRobloxListSection(
          "Manual rebind required",
          snapshot.lists?.manualOnlyEntries,
          snapshot.totals?.verifiedManualOnlyUsers || 0,
          "Сейчас нет verified-профилей без userId и username."
        ),
        inline: false,
      },
    ];
  }

  return [
    {
      name: "Режим",
      value: buildRobloxModeFieldValue(snapshot),
      inline: false,
    },
    {
      name: "Покрытие",
      value: buildRobloxCoverageFieldValue(snapshot),
      inline: false,
    },
    {
      name: "JJS и runtime",
      value: buildRobloxRuntimeFieldValue(snapshot),
      inline: false,
    },
    {
      name: "Фоновые задачи",
      value: buildRobloxBackgroundJobsFieldValue(snapshot),
      inline: false,
    },
    {
      name: "Кого чинить",
      value: buildRobloxBindingRepairFieldValue(snapshot),
      inline: false,
    },
    {
      name: "Ошибки и блокеры",
      value: buildRobloxErrorsSummaryFieldValue(snapshot),
      inline: false,
    },
  ];
}

function buildRobloxStatsPanelPayload({ db = {}, runtimeState = {}, telemetry = null, appConfig = {}, statusText = "", viewMode = ROBLOX_PANEL_DEFAULT_VIEW } = {}) {
  const snapshot = getRobloxStatsPanelSnapshot({ db, runtimeState, telemetry, appConfig });
  const embed = new EmbedBuilder()
    .setTitle("Roblox")
    .setDescription(buildRobloxSimplePanelDescription(snapshot));

  if (statusText) {
    embed.addFields({
      name: "Последнее действие",
      value: cleanString(statusText, 1000),
      inline: false,
    });
  }

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("roblox_stats_refresh").setLabel("Обновить").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("roblox_stats_back").setLabel("Назад").setStyle(ButtonStyle.Secondary)
      ),
    ],
  };
}

async function handleRobloxStatsPanelButtonInteraction({
  interaction,
  client,
  db,
  runtimeState,
  telemetry,
  appConfig,
  getAppConfig,
  isModerator,
  replyNoPermission,
  buildModeratorPanelPayload,
  buildRobloxPanelPayload,
  updateRobloxSettings,
  clearRefreshDiagnostics,
  runProfileRefreshJob,
  runPlaytimeSyncJob,
  runRuntimeFlush,
} = {}) {
  const customId = String(interaction?.customId || "").trim();
  const { baseCustomId } = parseRobloxPanelCustomId(customId);
  if (![
    "panel_open_roblox_stats",
    "roblox_stats_view_overview",
    "roblox_stats_view_coverage",
    "roblox_stats_view_activity",
    "roblox_stats_view_errors",
    "roblox_stats_refresh",
    "roblox_stats_run_profile_refresh",
    "roblox_stats_run_playtime_sync",
    "roblox_stats_run_flush",
    "roblox_stats_toggle_playtime",
    "roblox_stats_toggle_metadata",
    "roblox_stats_toggle_flush",
    "roblox_stats_set_poll_1",
    "roblox_stats_set_poll_3",
    "roblox_stats_set_poll_5",
    "roblox_stats_set_poll_10",
    "roblox_stats_clear_refresh_errors",
    "roblox_stats_back",
  ].includes(baseCustomId)) {
    return false;
  }

  if (typeof isModerator !== "function") {
    throw new TypeError("isModerator must be a function");
  }
  if (typeof replyNoPermission !== "function") {
    throw new TypeError("replyNoPermission must be a function");
  }
  if (typeof buildModeratorPanelPayload !== "function") {
    throw new TypeError("buildModeratorPanelPayload must be a function");
  }
  if (getAppConfig != null && typeof getAppConfig !== "function") {
    throw new TypeError("getAppConfig must be a function");
  }

  const readAppConfig = () => resolvePanelAppConfig(appConfig, getAppConfig);

  const renderPanel = typeof buildRobloxPanelPayload === "function"
    ? buildRobloxPanelPayload
    : ({ statusText = "" } = {}) => buildRobloxStatsPanelPayload({
      db,
      runtimeState,
      telemetry,
      appConfig: readAppConfig(),
      statusText,
    });

  if (!isModerator(interaction?.member)) {
    await replyNoPermission(interaction);
    return true;
  }

  if (baseCustomId === "panel_open_roblox_stats") {
    await interaction.update(renderPanel({ statusText: "" }));
    return true;
  }

  if (baseCustomId === "roblox_stats_refresh") {
    await interaction.update(renderPanel({ statusText: "Панель Roblox обновлена." }));
    return true;
  }

  if (baseCustomId === "roblox_stats_back") {
    await interaction.update(await buildModeratorPanelPayload(client, "", false));
    return true;
  }

  await interaction.update(renderPanel({
    statusText: "Панель упрощена. Используй Обновить или Назад.",
  }));
  return true;
}

module.exports = {
  buildRobloxStatsPanelPayload,
  createRobloxPanelTelemetry,
  getRobloxStatsPanelSnapshot,
  handleRobloxStatsPanelButtonInteraction,
};