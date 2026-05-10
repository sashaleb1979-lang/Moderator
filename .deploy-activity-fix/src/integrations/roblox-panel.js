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

function formatJobStatus(status) {
  const normalized = cleanString(status, 40) || "idle";
  if (normalized === "running") return "в работе";
  if (normalized === "ok") return "успешно";
  if (normalized === "error") return "ошибка";
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
      touchedUserCount: normalizeNonNegativeInteger(summary.touchedUserCount, 0),
      startedSessionCount: normalizeNonNegativeInteger(summary.startedSessionCount, 0),
      closedSessionCount: normalizeNonNegativeInteger(summary.closedSessionCount, 0),
      activeCoPlayPairCount: normalizeNonNegativeInteger(summary.activeCoPlayPairCount, 0),
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
    parts.push("есть несохранённый runtime");
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
  if (showRefreshDiagnostics && entry.verificationStatus === "verified" && !entry.lastRefreshAt) score += 2500000;
  if (entry.verificationStatus === "pending") score += 3000000;
  if (entry.verificationStatus === "failed") score += 4000000;
  if (entry.refreshError) score += 5000000;
  if (entry.dirtyRuntime) score += 500000;
  return score;
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
      entry.note = buildRobloxEntryNote(entry, { showRefreshDiagnostics });
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
      linkedUsers: entries.length,
      verifiedUsers: entries.filter((entry) => entry.verificationStatus === "verified").length,
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
    topEntries,
  };
  snapshot.issues = buildRobloxPanelIssues(snapshot);
  return snapshot;
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
  return pieces.join(" | ");
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

function buildPlaytimeSyncStatusText(result = {}) {
  const skippedReason = cleanString(result.skippedReason, 80) || null;
  if (skippedReason === "jjs_ids_not_configured") {
    return "Синк playtime пропущен: JJS IDs не настроены.";
  }
  if (skippedReason === "no_verified_candidates") {
    return "Синк playtime пропущен: нет ни одной подтверждённой Roblox-привязки с userId.";
  }

  const totalCandidates = normalizeNonNegativeInteger(result.totalCandidates, 0);
  const activeJjsUsers = normalizeNonNegativeInteger(result.activeJjsUsers, 0);
  const touchedUserCount = normalizeNonNegativeInteger(result.touchedUserCount, 0);
  const failedUserIds = normalizeNonNegativeInteger(result.failedUserIds, 0);
  const baseText = `Синк playtime завершён. Кандидатов: ${totalCandidates}, активных в JJS: ${activeJjsUsers}, затронуто профилей: ${touchedUserCount}, ошибок пользователей: ${failedUserIds}.`;

  if (totalCandidates > 0 && activeJjsUsers === 0 && failedUserIds === 0) {
    return `${baseText} В configured JJS сейчас никого не видно.`;
  }

  return baseText;
}

function buildRobloxStatsPanelPayload({ db = {}, runtimeState = {}, telemetry = null, appConfig = {}, statusText = "" } = {}) {
  const snapshot = getRobloxStatsPanelSnapshot({ db, runtimeState, telemetry, appConfig });
  const metadataRefreshEnabled = snapshot.config.metadataRefreshEnabled !== false;
  const playtimeTrackingEnabled = snapshot.config.playtimeTrackingEnabled !== false;
  const runtimeFlushEnabled = snapshot.config.runtimeFlushEnabled !== false;
  const playtimePollMinutes = snapshot.config.playtimePollMinutes;
  const embed = new EmbedBuilder()
    .setTitle("Контроль Roblox")
    .setDescription([
      "Компактный мод-пульт для Roblox-привязок, пассивного учёта JJS и ручных операций.",
      `Связано аккаунтов: **${snapshot.totals.linkedUsers}**`,
      `Трекинг JJS: **${snapshot.config.jjsReady ? "готов" : "не настроен"}**`,
      `Применение настроек: **сразу на живом боте**`,
    ].join("\n"))
    .addFields(
      {
        name: "Режим",
        value: [
          `Учёт JJS: **${playtimeTrackingEnabled ? "включён" : "выключен"}**`,
          `Обновление профилей: **${metadataRefreshEnabled ? "включено" : "выключено"}**`,
          `Сохранение runtime: **${runtimeFlushEnabled ? "включено" : "выключено"}**`,
          `Интервал опроса: **${playtimePollMinutes} мин**`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "Профили",
        value: [
          `Проверено: **${snapshot.totals.verifiedUsers}**`,
          `Ждут сверки: **${snapshot.totals.pendingUsers}**`,
          `Сверка не пройдена: **${snapshot.totals.failedUsers}**`,
          `${metadataRefreshEnabled ? "С ошибками обновления" : "Исторические ошибки обновления скрыты"}: **${metadataRefreshEnabled ? snapshot.totals.refreshErrorUsers : 0}**`,
          `${metadataRefreshEnabled ? "Проверены, но не обновлялись" : "Без полного профиля"}: **${snapshot.totals.neverRefreshedVerifiedUsers}**`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "JJS и runtime",
        value: [
          `Сейчас в JJS: **${snapshot.totals.activeJjsUsers}**`,
          `Несохранённых runtime-профилей: **${snapshot.totals.dirtyRuntimeUsers}**`,
          `Активных co-play пар: **${snapshot.totals.activeCoPlayPairs}**`,
          playtimeTrackingEnabled
            ? `Последний синк playtime: ${formatDateTime(snapshot.jobs.playtimeSync.lastFinishedAt || snapshot.jobs.playtimeSync.lastStartedAt)}`
            : "Последний синк playtime: выключен в настройках",
        ].join("\n"),
        inline: false,
      },
      {
        name: "Фоновые задачи",
        value: [
          `Обновление профилей: ${metadataRefreshEnabled ? formatRobloxJobLine(snapshot.jobs.profileRefresh) : "выключено для passive tracking"}`,
          `Синк playtime: ${playtimeTrackingEnabled ? formatRobloxJobLine(snapshot.jobs.playtimeSync) : "выключено в настройках"}`,
          `Сохранение runtime: ${runtimeFlushEnabled ? formatRobloxJobLine(snapshot.jobs.runtimeFlush) : "выключено в настройках"}`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "Кого проверить первым",
        value: snapshot.topEntries.length
          ? snapshot.topEntries.map((entry, index) => formatTopEntry(entry, index)).join("\n")
          : "Пока нет Roblox-профилей для контроля.",
        inline: false,
      },
      {
        name: "Ошибки и блокеры",
        value: snapshot.issues.length ? snapshot.issues.join("\n") : "Критичных блокеров сейчас не видно.",
        inline: false,
      }
    );

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
        new ButtonBuilder().setCustomId("roblox_stats_run_playtime_sync").setLabel("Синк сейчас").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("roblox_stats_run_flush").setLabel("Сохранить runtime").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("roblox_stats_run_profile_refresh").setLabel("Обновить профили").setStyle(ButtonStyle.Secondary).setDisabled(!metadataRefreshEnabled),
        new ButtonBuilder().setCustomId("roblox_stats_back").setLabel("Назад").setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("roblox_stats_toggle_playtime").setLabel(buildToggleLabel("Учёт JJS", playtimeTrackingEnabled)).setStyle(getToggleButtonStyle(playtimeTrackingEnabled)),
        new ButtonBuilder().setCustomId("roblox_stats_toggle_metadata").setLabel(buildToggleLabel("Профили", metadataRefreshEnabled)).setStyle(getToggleButtonStyle(metadataRefreshEnabled)),
        new ButtonBuilder().setCustomId("roblox_stats_toggle_flush").setLabel(buildToggleLabel("Runtime", runtimeFlushEnabled)).setStyle(getToggleButtonStyle(runtimeFlushEnabled))
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("roblox_stats_set_poll_1").setLabel("1 мин").setStyle(getPollButtonStyle(playtimePollMinutes, 1)),
        new ButtonBuilder().setCustomId("roblox_stats_set_poll_3").setLabel("3 мин").setStyle(getPollButtonStyle(playtimePollMinutes, 3)),
        new ButtonBuilder().setCustomId("roblox_stats_set_poll_5").setLabel("5 мин").setStyle(getPollButtonStyle(playtimePollMinutes, 5)),
        new ButtonBuilder().setCustomId("roblox_stats_set_poll_10").setLabel("10 мин").setStyle(getPollButtonStyle(playtimePollMinutes, 10))
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("roblox_stats_clear_refresh_errors").setLabel("Очистить старые ошибки обновления").setStyle(ButtonStyle.Secondary)
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
  if (![
    "panel_open_roblox_stats",
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
  ].includes(customId)) {
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
  if (updateRobloxSettings != null && typeof updateRobloxSettings !== "function") {
    throw new TypeError("updateRobloxSettings must be a function");
  }
  if (clearRefreshDiagnostics != null && typeof clearRefreshDiagnostics !== "function") {
    throw new TypeError("clearRefreshDiagnostics must be a function");
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

  if (customId === "panel_open_roblox_stats") {
    await interaction.update(renderPanel({ statusText: "" }));
    return true;
  }

  if (customId === "roblox_stats_refresh") {
    await interaction.update(renderPanel({ statusText: "Панель Roblox обновлена." }));
    return true;
  }

  if (customId === "roblox_stats_back") {
    await interaction.update(await buildModeratorPanelPayload(client, "", false));
    return true;
  }

  if (customId === "roblox_stats_toggle_playtime") {
    const nextValue = !isPlaytimeTrackingEnabled(readAppConfig());
    await interaction.deferUpdate();
    await updateRobloxSettings({ playtimeTrackingEnabled: nextValue });
    await interaction.editReply(renderPanel({
      statusText: `Учёт JJS ${nextValue ? "включён" : "выключен"}.`,
    }));
    return true;
  }

  if (customId === "roblox_stats_toggle_metadata") {
    const nextValue = !isMetadataRefreshEnabled(readAppConfig());
    await interaction.deferUpdate();
    await updateRobloxSettings({ metadataRefreshEnabled: nextValue });
    await interaction.editReply(renderPanel({
      statusText: `Автообновление профилей ${nextValue ? "включено" : "выключено"}.`,
    }));
    return true;
  }

  if (customId === "roblox_stats_toggle_flush") {
    const nextValue = !isRuntimeFlushEnabled(readAppConfig());
    await interaction.deferUpdate();
    await updateRobloxSettings({ runtimeFlushEnabled: nextValue });
    await interaction.editReply(renderPanel({
      statusText: `Периодическое сохранение runtime ${nextValue ? "включено" : "выключено"}.`,
    }));
    return true;
  }

  if (["roblox_stats_set_poll_1", "roblox_stats_set_poll_3", "roblox_stats_set_poll_5", "roblox_stats_set_poll_10"].includes(customId)) {
    const nextMinutes = Number(customId.replace("roblox_stats_set_poll_", ""));
    await interaction.deferUpdate();
    await updateRobloxSettings({ playtimePollMinutes: nextMinutes });
    await interaction.editReply(renderPanel({
      statusText: `Интервал опроса переключён на ${nextMinutes} мин.`,
    }));
    return true;
  }

  if (customId === "roblox_stats_clear_refresh_errors") {
    await interaction.deferUpdate();
    const result = await clearRefreshDiagnostics();
    await interaction.editReply(renderPanel({
      statusText: `Старые ошибки обновления очищены у ${normalizeNonNegativeInteger(result?.clearedCount, 0)} профилей.`,
    }));
    return true;
  }

  if (customId === "roblox_stats_run_profile_refresh" && !isMetadataRefreshEnabled(readAppConfig())) {
    await interaction.update(renderPanel({
      statusText: "Обновление профилей выключено. Для пассивного учёта JJS оно не нужно.",
    }));
    return true;
  }

  const actionMap = {
    roblox_stats_run_profile_refresh: {
      runner: runProfileRefreshJob,
      successText: (result = {}) => `Обновление профилей завершено. Обновлено: ${normalizeNonNegativeInteger(result.refreshedCount, 0)}, с ошибками: ${normalizeNonNegativeInteger(result.failedCount, 0)}.`,
    },
    roblox_stats_run_playtime_sync: {
      runner: runPlaytimeSyncJob,
      successText: (result = {}) => buildPlaytimeSyncStatusText(result),
    },
    roblox_stats_run_flush: {
      runner: runRuntimeFlush,
      successText: (result = {}) => `Сохранение runtime завершено. Грязных профилей: ${normalizeNonNegativeInteger(result.dirtyUserCount, 0)}, сохранено: ${result.saved === true ? "да" : "нет"}.`,
    },
  };

  const action = actionMap[customId];
  if (typeof action?.runner !== "function") {
    throw new TypeError(`Missing runner for ${customId}`);
  }

  await interaction.deferUpdate();
  try {
    const result = await action.runner();
    await interaction.editReply(renderPanel({ statusText: action.successText(result) }));
  } catch (error) {
    await interaction.editReply(renderPanel({
      statusText: `Операция завершилась ошибкой: ${truncateText(error?.message || error, 240) || "неизвестная ошибка"}`,
    }));
  }
  return true;
}

module.exports = {
  buildRobloxStatsPanelPayload,
  createRobloxPanelTelemetry,
  getRobloxStatsPanelSnapshot,
  handleRobloxStatsPanelButtonInteraction,
};