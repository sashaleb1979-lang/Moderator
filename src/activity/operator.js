"use strict";

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require("discord.js");
const { ensureSharedProfile } = require("../integrations/shared-profile");
const { flushActivityRuntime, recordActivityMessage } = require("./runtime");
const { ensureActivityState } = require("./state");

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function normalizeNullableString(value, limit = 2000) {
  const text = cleanString(value, limit);
  return text || null;
}

function normalizeIsoTimestamp(value, fallback = null) {
  const text = cleanString(value, 80);
  if (!text) return fallback;
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

function normalizeStringArray(value, limit = 2000) {
  if (!Array.isArray(value)) return [];
  const normalized = [];
  const seen = new Set();
  for (const entry of value) {
    const text = cleanString(entry, 80);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    normalized.push(text);
    if (normalized.length >= limit) break;
  }
  return normalized;
}

function resolveNowIso(now) {
  if (typeof now === "function") {
    return normalizeIsoTimestamp(now(), new Date().toISOString());
  }
  return normalizeIsoTimestamp(now, new Date().toISOString());
}

function formatDateTime(value) {
  const timestamp = Date.parse(value || "");
  if (!Number.isFinite(timestamp)) return "—";
  return new Date(timestamp).toLocaleString("ru-RU");
}

function getActivitySessionGapMs(config = {}) {
  return Math.max(1, Number(config.sessionGapMinutes) || 45) * 60 * 1000;
}

function listActivityManagedRoleIds(config = {}) {
  return normalizeStringArray(Object.values(config.activityRoleIds || {}));
}

function ensureProfileRecord(db, userId) {
  db.profiles ||= {};
  const profile = db.profiles[userId] && typeof db.profiles[userId] === "object"
    ? db.profiles[userId]
    : { userId };
  db.profiles[userId] = ensureSharedProfile(profile, userId).profile;
  return db.profiles[userId];
}

function syncAppliedActivityRoleMetadata(db, userId, { appliedActivityRoleKey, lastRoleAppliedAt }) {
  const profile = ensureProfileRecord(db, userId);
  const nextProfile = clone(profile);
  nextProfile.domains ||= {};
  const nextActivity = nextProfile.domains.activity && typeof nextProfile.domains.activity === "object"
    ? clone(nextProfile.domains.activity)
    : {};
  nextActivity.appliedActivityRoleKey = normalizeNullableString(appliedActivityRoleKey, 80);
  nextActivity.lastRoleAppliedAt = normalizeIsoTimestamp(lastRoleAppliedAt, null);
  nextProfile.domains.activity = nextActivity;
  db.profiles[userId] = ensureSharedProfile(nextProfile, userId).profile;

  const state = ensureActivityState(db);
  if (state.userSnapshots && state.userSnapshots[userId] && typeof state.userSnapshots[userId] === "object") {
    state.userSnapshots[userId] = {
      ...state.userSnapshots[userId],
      appliedActivityRoleKey: nextActivity.appliedActivityRoleKey,
      lastRoleAppliedAt: nextActivity.lastRoleAppliedAt,
    };
  }

  return db.profiles[userId];
}

function collectActivityAssignmentTargetUserIds(db, explicitUserIds = []) {
  const state = ensureActivityState(db);
  const targetUserIds = new Set(normalizeStringArray(explicitUserIds, 5000));

  for (const userId of Object.keys(state.userSnapshots || {})) {
    const normalizedUserId = cleanString(userId, 80);
    if (normalizedUserId) targetUserIds.add(normalizedUserId);
  }

  for (const userId of Object.keys(db.profiles || {})) {
    const normalizedUserId = cleanString(userId, 80);
    if (normalizedUserId) targetUserIds.add(normalizedUserId);
  }

  return [...targetUserIds];
}

function buildActivityOperatorPanelPayload({ db = {}, statusText = "" } = {}) {
  const state = ensureActivityState(db);
  const watchedChannelCount = Array.isArray(state.watchedChannels) ? state.watchedChannels.length : 0;
  const mappedRoleCount = listActivityManagedRoleIds(state.config || {}).length;
  const snapshotCount = Object.keys(state.userSnapshots || {}).length;
  const openSessionCount = Object.keys(state.runtime?.openSessions || {}).length;
  const dirtyUserCount = Array.isArray(state.runtime?.dirtyUsers) ? state.runtime.dirtyUsers.length : 0;
  const activityProfileCount = Object.values(db.profiles || {}).filter((profile) => profile?.domains?.activity).length;
  const lastCalibrationRun = Array.isArray(state.calibrationRuns) && state.calibrationRuns.length
    ? state.calibrationRuns[state.calibrationRuns.length - 1]
    : null;

  const embed = new EmbedBuilder()
    .setTitle("Activity Panel")
    .setDescription([
      "Закрытая мод-панель активности.",
      "Публичных activity panel у бота нет.",
      "Здесь видны runtime, calibration и initial role assignment state.",
    ].join("\n"))
    .addFields(
      {
        name: "State",
        value: [
          `Watched channels: **${watchedChannelCount}**`,
          `Mapped roles: **${mappedRoleCount}**`,
          `Snapshots: **${snapshotCount}**`,
          `Profiles with activity: **${activityProfileCount}**`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "Runtime",
        value: [
          `Open sessions: **${openSessionCount}**`,
          `Dirty users: **${dirtyUserCount}**`,
          `Last flush: ${formatDateTime(state.runtime?.lastFlushAt)}`,
          `Last full recalc: ${formatDateTime(state.runtime?.lastFullRecalcAt)}`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "Calibration",
        value: lastCalibrationRun
          ? [
            `Last run: **${cleanString(lastCalibrationRun.mode, 80) || "unknown"}**`,
            `Completed: ${formatDateTime(lastCalibrationRun.completedAt)}`,
            `${Number(lastCalibrationRun.importedEntryCount || 0)} entries`,
            `${Number(lastCalibrationRun.importedUserCount || 0)} users`,
            `${Number(lastCalibrationRun.appliedRoleCount || 0)} role assignments`,
          ].join("\n")
          : "Исторический import ещё не запускался.",
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
        new ButtonBuilder().setCustomId("activity_panel_refresh").setLabel("Обновить").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("activity_panel_historical_import").setLabel("Historical Import").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("activity_panel_assign_roles").setLabel("Initial roles").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("activity_panel_back").setLabel("Назад").setStyle(ButtonStyle.Secondary)
      ),
    ],
  };
}

function buildActivityRoleAssignmentPlan({ db = {}, userId = "", memberRoleIds = [] } = {}) {
  const normalizedUserId = cleanString(userId, 80);
  if (!normalizedUserId) {
    return {
      userId: "",
      shouldApply: false,
      skipReason: "missing_user_id",
      desiredRoleKey: null,
      desiredRoleId: null,
      addRoleIds: [],
      removeRoleIds: [],
    };
  }

  const state = ensureActivityState(db);
  const config = state.config || {};
  const profile = ensureProfileRecord(db, normalizedUserId);
  const activity = profile?.domains?.activity || {};
  const desiredRoleKey = normalizeNullableString(activity.desiredActivityRoleKey, 80);
  const desiredRoleId = desiredRoleKey
    ? normalizeNullableString(config.activityRoleIds?.[desiredRoleKey], 80)
    : null;
  const normalizedMemberRoleIds = normalizeStringArray(memberRoleIds, 5000);
  const managedRoleIds = listActivityManagedRoleIds(config);

  if (activity.manualOverride === true) {
    return {
      userId: normalizedUserId,
      shouldApply: false,
      skipReason: "manual_override",
      desiredRoleKey,
      desiredRoleId,
      addRoleIds: [],
      removeRoleIds: [],
    };
  }

  if (activity.autoRoleFrozen === true) {
    return {
      userId: normalizedUserId,
      shouldApply: false,
      skipReason: "auto_role_frozen",
      desiredRoleKey,
      desiredRoleId,
      addRoleIds: [],
      removeRoleIds: [],
    };
  }

  if (!desiredRoleKey) {
    return {
      userId: normalizedUserId,
      shouldApply: false,
      skipReason: "missing_desired_role",
      desiredRoleKey: null,
      desiredRoleId: null,
      addRoleIds: [],
      removeRoleIds: [],
    };
  }

  if (!desiredRoleId) {
    return {
      userId: normalizedUserId,
      shouldApply: false,
      skipReason: "missing_role_mapping",
      desiredRoleKey,
      desiredRoleId: null,
      addRoleIds: [],
      removeRoleIds: [],
    };
  }

  const addRoleIds = normalizedMemberRoleIds.includes(desiredRoleId) ? [] : [desiredRoleId];
  const removeRoleIds = managedRoleIds.filter((roleId) => roleId !== desiredRoleId && normalizedMemberRoleIds.includes(roleId));
  const metadataAlreadySynced = cleanString(activity.appliedActivityRoleKey, 80) === desiredRoleKey;

  if (!addRoleIds.length && !removeRoleIds.length && metadataAlreadySynced) {
    return {
      userId: normalizedUserId,
      shouldApply: false,
      skipReason: "unchanged",
      desiredRoleKey,
      desiredRoleId,
      addRoleIds: [],
      removeRoleIds: [],
    };
  }

  return {
    userId: normalizedUserId,
    shouldApply: true,
    skipReason: null,
    desiredRoleKey,
    desiredRoleId,
    addRoleIds,
    removeRoleIds,
  };
}

async function applyInitialActivityRoleAssignments({
  db = {},
  userIds,
  resolveMemberRoleIds,
  applyRoleChanges,
  now,
  saveDb,
  runSerialized,
} = {}) {
  const execute = async () => {
    const state = ensureActivityState(db);
    const appliedAt = resolveNowIso(now);
    const targetUserIds = collectActivityAssignmentTargetUserIds(db, userIds);
    const appliedUserIds = [];
    const skippedUserIds = [];
    const skippedReasons = {};

    for (const userId of targetUserIds) {
      const memberRoleIds = typeof resolveMemberRoleIds === "function"
        ? await Promise.resolve(resolveMemberRoleIds(userId))
        : [];
      const plan = buildActivityRoleAssignmentPlan({
        db,
        userId,
        memberRoleIds,
      });

      if (!plan.shouldApply) {
        skippedUserIds.push(userId);
        skippedReasons[userId] = plan.skipReason;
        continue;
      }

      if (typeof applyRoleChanges !== "function") {
        skippedUserIds.push(userId);
        skippedReasons[userId] = "missing_apply_callback";
        continue;
      }

      const applyResult = await Promise.resolve(applyRoleChanges({
        userId,
        desiredRoleKey: plan.desiredRoleKey,
        desiredRoleId: plan.desiredRoleId,
        addRoleIds: plan.addRoleIds,
        removeRoleIds: plan.removeRoleIds,
      }));

      if (applyResult === false) {
        skippedUserIds.push(userId);
        skippedReasons[userId] = "apply_declined";
        continue;
      }

      syncAppliedActivityRoleMetadata(db, userId, {
        appliedActivityRoleKey: plan.desiredRoleKey,
        lastRoleAppliedAt: appliedAt,
      });
      appliedUserIds.push(userId);
    }

    db.sot.activity = state;
    if (typeof saveDb === "function") {
      saveDb();
    }

    return {
      appliedAt,
      appliedCount: appliedUserIds.length,
      skippedCount: skippedUserIds.length,
      appliedUserIds,
      skippedUserIds,
      skippedReasons,
    };
  };

  if (typeof runSerialized === "function") {
    return runSerialized(execute, "activity-initial-role-assignment");
  }
  return execute();
}

function normalizeHistoricalImportEntry(entry = {}) {
  const source = entry && typeof entry === "object" ? entry : {};
  const guildId = cleanString(source.guildId, 80);
  const userId = cleanString(source.userId, 80);
  const channelId = cleanString(source.channelId, 80);
  const createdAt = normalizeIsoTimestamp(source.createdAt, null);
  if (!guildId || !userId || !channelId || !createdAt) return null;

  return {
    guildId,
    userId,
    channelId,
    createdAt,
    messageId: normalizeNullableString(source.messageId, 80),
  };
}

function buildHistoricalImportFlushAt(entries, config = {}, fallbackNow) {
  const latestCreatedAt = [...entries]
    .map((entry) => normalizeIsoTimestamp(entry.createdAt, null))
    .filter(Boolean)
    .sort()
    .at(-1);

  if (!latestCreatedAt) return resolveNowIso(fallbackNow);
  return new Date(new Date(latestCreatedAt).getTime() + getActivitySessionGapMs(config) + 1000).toISOString();
}

async function importHistoricalActivity({
  db = {},
  entries,
  requestedByUserId,
  now,
  resolveMemberRoleIds,
  applyRoleChanges,
  saveDb,
  runSerialized,
} = {}) {
  const execute = async () => {
    const state = ensureActivityState(db);
    const requestedAt = resolveNowIso(now);
    const normalizedEntries = (Array.isArray(entries) ? entries : [])
      .map((entry) => normalizeHistoricalImportEntry(entry))
      .filter(Boolean)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const touchedUserIds = new Set();
    let importedEntryCount = 0;
    let ignoredEntryCount = Array.isArray(entries) ? entries.length - normalizedEntries.length : 0;

    for (const entry of normalizedEntries) {
      const result = recordActivityMessage({
        db,
        message: entry,
      });
      if (result.ignored) {
        ignoredEntryCount += 1;
        continue;
      }

      touchedUserIds.add(entry.userId);
      importedEntryCount += 1;
    }

    const flushAt = buildHistoricalImportFlushAt(normalizedEntries, state.config || {}, requestedAt);
    const flushResult = await flushActivityRuntime({
      db,
      now: flushAt,
    });
    const initialRoleAssignment = await applyInitialActivityRoleAssignments({
      db,
      userIds: [...touchedUserIds],
      resolveMemberRoleIds,
      applyRoleChanges,
      now: flushAt,
    });
    const liveState = ensureActivityState(db);

    const calibrationRun = {
      id: ["historical_import", cleanString(requestedByUserId, 80) || "system", requestedAt].join(":"),
      mode: "historical_import",
      requestedByUserId: normalizeNullableString(requestedByUserId, 80),
      requestedAt,
      completedAt: flushAt,
      importedEntryCount,
      ignoredEntryCount,
      rebuiltUserCount: flushResult.rebuiltUserCount,
      finalizedSessionCount: flushResult.finalizedSessionCount,
      appliedRoleCount: initialRoleAssignment.appliedCount,
      importedUserCount: touchedUserIds.size,
    };

    liveState.calibrationRuns ||= [];
    liveState.calibrationRuns.push(calibrationRun);
    liveState.runtime.lastFullRecalcAt = flushAt;
    liveState.ops ||= {};
    liveState.ops.moderationAuditLog ||= [];
    liveState.ops.moderationAuditLog.push({
      actionType: "historical_import",
      moderatorUserId: normalizeNullableString(requestedByUserId, 80),
      createdAt: requestedAt,
      importedEntryCount,
      ignoredEntryCount,
      appliedRoleCount: initialRoleAssignment.appliedCount,
    });

    db.sot.activity = liveState;
    if (typeof saveDb === "function") {
      saveDb();
    }

    return {
      importedEntryCount,
      ignoredEntryCount,
      importedUserCount: touchedUserIds.size,
      finalizedSessionCount: flushResult.finalizedSessionCount,
      rebuiltUserCount: flushResult.rebuiltUserCount,
      flushedAt: flushResult.flushedAt,
      calibrationRun,
      initialRoleAssignment,
    };
  };

  if (typeof runSerialized === "function") {
    return runSerialized(execute, "activity-historical-import");
  }
  return execute();
}

async function importHistoricalActivityFromWatchedChannels({
  db = {},
  requestedByUserId,
  fetchChannel,
  now,
  resolveMemberRoleIds,
  applyRoleChanges,
  saveDb,
  runSerialized,
} = {}) {
  const execute = async () => {
    if (typeof fetchChannel !== "function") {
      throw new TypeError("fetchChannel must be a function");
    }

    const state = ensureActivityState(db);
    const watchedChannels = Array.isArray(state.watchedChannels) ? state.watchedChannels : [];
    const collectedEntries = [];
    const channelUpdates = new Map();
    let scannedChannelCount = 0;
    let scannedMessageCount = 0;

    for (const watchedChannel of watchedChannels) {
      if (!watchedChannel || watchedChannel.enabled === false) continue;

      const channel = await fetchChannel(watchedChannel.channelId).catch(() => null);
      if (!channel?.isTextBased?.()) continue;
      scannedChannelCount += 1;

      let before = null;
      let newestImportedMessageId = null;
      let lastScannedMessageId = null;
      let reachedCursor = false;

      while (true) {
        const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => null);
        if (!batch?.size) break;

        for (const message of batch.values()) {
          scannedMessageCount += 1;
          lastScannedMessageId = cleanString(message?.id, 80) || lastScannedMessageId;

          if (message?.id && message.id === watchedChannel.importedUntilMessageId) {
            reachedCursor = true;
            break;
          }

          if (!message?.author?.id || message.author.bot) continue;
          const createdAt = normalizeIsoTimestamp(message.createdAt, null);
          const guildId = cleanString(message.guildId ?? message.guild?.id ?? watchedChannel.guildId, 80);
          if (!createdAt || !guildId) continue;

          newestImportedMessageId ||= cleanString(message.id, 80) || null;
          collectedEntries.push({
            guildId,
            userId: cleanString(message.author.id, 80),
            channelId: watchedChannel.channelId,
            messageId: cleanString(message.id, 80),
            createdAt,
          });
        }

        if (reachedCursor) break;
        before = cleanString(batch.last()?.id, 80) || null;
        if (!before || batch.size < 100) break;
      }

      channelUpdates.set(watchedChannel.channelId, {
        importedUntilMessageId: newestImportedMessageId || cleanString(watchedChannel.importedUntilMessageId, 80),
        lastScannedMessageId,
      });
    }

    const importResult = await importHistoricalActivity({
      db,
      entries: collectedEntries,
      requestedByUserId,
      now,
      resolveMemberRoleIds,
      applyRoleChanges,
    });
    const liveState = ensureActivityState(db);

    for (const watchedChannel of liveState.watchedChannels || []) {
      const update = channelUpdates.get(watchedChannel.channelId);
      if (!update) continue;
      watchedChannel.importedUntilMessageId = cleanString(update.importedUntilMessageId, 80);
      watchedChannel.lastScannedMessageId = cleanString(update.lastScannedMessageId, 80);
      watchedChannel.lastImportAt = importResult.flushedAt;
    }

    db.sot.activity = liveState;
    if (typeof saveDb === "function") {
      saveDb();
    }

    return {
      ...importResult,
      scannedChannelCount,
      scannedMessageCount,
    };
  };

  if (typeof runSerialized === "function") {
    return runSerialized(execute, "activity-historical-channel-import");
  }
  return execute();
}

async function handleActivityPanelButtonInteraction({
  interaction,
  client,
  db,
  isModerator,
  replyNoPermission,
  buildModeratorPanelPayload,
  buildActivityPanelPayload = buildActivityOperatorPanelPayload,
  runHistoricalImport = importHistoricalActivityFromWatchedChannels,
  runInitialRoleAssignment = applyInitialActivityRoleAssignments,
  fetchChannel,
  resolveMemberRoleIds,
  applyRoleChanges,
  saveDb,
  runSerialized,
} = {}) {
  const customId = String(interaction?.customId || "").trim();
  if (!["panel_open_activity", "activity_panel_refresh", "activity_panel_historical_import", "activity_panel_assign_roles", "activity_panel_back"].includes(customId)) {
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

  if (!isModerator(interaction?.member)) {
    await replyNoPermission(interaction);
    return true;
  }

  if (customId === "panel_open_activity") {
    await interaction.update(buildActivityPanelPayload({ db, statusText: "" }));
    return true;
  }

  if (customId === "activity_panel_refresh") {
    await interaction.update(buildActivityPanelPayload({
      db,
      statusText: "Activity panel refreshed.",
    }));
    return true;
  }

  if (customId === "activity_panel_back") {
    await interaction.update(await buildModeratorPanelPayload(client, "", false));
    return true;
  }

  await interaction.deferUpdate();
  if (customId === "activity_panel_historical_import") {
    const result = await runHistoricalImport({
      db,
      client,
      requestedByUserId: cleanString(interaction?.user?.id, 80),
      fetchChannel,
      resolveMemberRoleIds,
      applyRoleChanges,
      saveDb,
      runSerialized,
    });
    await interaction.editReply(buildActivityPanelPayload({
      db,
      statusText: `Historical import завершён. Imported ${result.importedEntryCount}, ignored ${result.ignoredEntryCount}.`,
    }));
    return true;
  }

  const result = await runInitialRoleAssignment({
    db,
    resolveMemberRoleIds,
    applyRoleChanges,
    saveDb,
    runSerialized,
  });
  await interaction.editReply(buildActivityPanelPayload({
    db,
    statusText: `Initial role assignment завершён. Applied ${result.appliedCount}, skipped ${result.skippedCount}.`,
  }));
  return true;
}

module.exports = {
  applyInitialActivityRoleAssignments,
  buildActivityRoleAssignmentPlan,
  buildActivityOperatorPanelPayload,
  handleActivityPanelButtonInteraction,
  importHistoricalActivity,
  importHistoricalActivityFromWatchedChannels,
};