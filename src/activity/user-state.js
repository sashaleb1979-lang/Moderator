"use strict";

const { ensureActivityState } = require("./state");

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
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

function createExplicitActivityUserIdFilter(explicitUserIds = []) {
  const normalizedUserIds = normalizeStringArray(explicitUserIds, 5000);
  return normalizedUserIds.length ? new Set(normalizedUserIds) : null;
}

function addFilteredActivityUserId(targetUserIds, explicitUserIdFilter, userId) {
  const normalizedUserId = cleanString(userId, 80);
  if (!normalizedUserId) return;
  if (explicitUserIdFilter && !explicitUserIdFilter.has(normalizedUserId)) return;
  targetUserIds.add(normalizedUserId);
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function getActivityProfileMirror(profile = {}) {
  const activity = profile?.domains?.activity || profile?.activity || profile?.summary?.activity;
  return activity && typeof activity === "object" && !Array.isArray(activity)
    ? activity
    : null;
}

function hasPersistedActivitySnapshotLikeData(activity = null) {
  if (!activity || typeof activity !== "object" || Array.isArray(activity)) {
    return false;
  }

  if (normalizeIsoTimestamp(activity.recalculatedAt, null)) return true;
  if (normalizeIsoTimestamp(activity.lastSeenAt, null)) return true;
  if (cleanString(activity.desiredActivityRoleKey, 80)) return true;
  if (cleanString(activity.roleEligibilityStatus, 80)) return true;
  if (Number.isFinite(Number(activity.activityScore))) return true;
  if (Number.isFinite(Number(activity.baseActivityScore))) return true;
  return false;
}

function getActivitySnapshotIntegrityIssue(snapshot = null) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return null;
  }

  const roleEligibilityStatus = cleanString(snapshot.roleEligibilityStatus, 80) || null;
  const desiredRoleKey = cleanString(snapshot.desiredActivityRoleKey, 80) || null;
  const roleEligibleForActivityRole = snapshot.roleEligibleForActivityRole === true;

  if (
    (roleEligibilityStatus === "join_age_unknown" || roleEligibilityStatus === "gated_new_member")
    && (roleEligibleForActivityRole || desiredRoleKey !== null)
  ) {
    return "blocked_role_status_has_role_output";
  }

  if (
    (roleEligibilityStatus === "eligible" || roleEligibilityStatus === "boosted_new_member")
    && snapshot.roleEligibleForActivityRole === false
  ) {
    return "eligible_status_missing_role_eligibility";
  }

  return null;
}

function collectActivityAssignmentTargetUserIds(db, explicitUserIds = [], managedRoleUserIds = []) {
  const state = ensureActivityState(db);
  const explicitUserIdFilter = createExplicitActivityUserIdFilter(explicitUserIds);
  const targetUserIds = new Set();

  for (const userId of normalizeStringArray(managedRoleUserIds, 5000)) {
    addFilteredActivityUserId(targetUserIds, explicitUserIdFilter, userId);
  }

  for (const userId of Object.keys(state.userSnapshots || {})) {
    addFilteredActivityUserId(targetUserIds, explicitUserIdFilter, userId);
  }

  for (const userId of Object.keys(state.runtime?.openSessions || {})) {
    addFilteredActivityUserId(targetUserIds, explicitUserIdFilter, userId);
  }

  for (const userId of Array.isArray(state.runtime?.dirtyUsers) ? state.runtime.dirtyUsers : []) {
    addFilteredActivityUserId(targetUserIds, explicitUserIdFilter, userId);
  }

  for (const session of Array.isArray(state.globalUserSessions) ? state.globalUserSessions : []) {
    addFilteredActivityUserId(targetUserIds, explicitUserIdFilter, session?.userId);
  }

  for (const row of Array.isArray(state.userChannelDailyStats) ? state.userChannelDailyStats : []) {
    addFilteredActivityUserId(targetUserIds, explicitUserIdFilter, row?.userId);
  }

  return [...targetUserIds];
}

function collectActivityHistoryTargetUserIds(db, explicitUserIds = []) {
  const state = ensureActivityState(db);
  const explicitUserIdFilter = createExplicitActivityUserIdFilter(explicitUserIds);
  const targetUserIds = new Set();

  for (const userId of Object.keys(state.runtime?.openSessions || {})) {
    addFilteredActivityUserId(targetUserIds, explicitUserIdFilter, userId);
  }

  for (const userId of Array.isArray(state.runtime?.dirtyUsers) ? state.runtime.dirtyUsers : []) {
    addFilteredActivityUserId(targetUserIds, explicitUserIdFilter, userId);
  }

  for (const session of Array.isArray(state.globalUserSessions) ? state.globalUserSessions : []) {
    addFilteredActivityUserId(targetUserIds, explicitUserIdFilter, session?.userId);
  }

  for (const row of Array.isArray(state.userChannelDailyStats) ? state.userChannelDailyStats : []) {
    addFilteredActivityUserId(targetUserIds, explicitUserIdFilter, row?.userId);
  }

  return [...targetUserIds];
}

function collectActivityProfileMirrorTargetUserIds(db = {}, explicitUserIds = []) {
  const state = ensureActivityState(db);
  const explicitUserIdFilter = createExplicitActivityUserIdFilter(explicitUserIds);
  const indexedSnapshotUserIds = new Set(
    Object.keys(state.userSnapshots || {})
      .map((entry) => cleanString(entry, 80))
      .filter(Boolean)
  );
  const targetUserIds = new Set();

  for (const [userId, profile] of Object.entries(db.profiles || {})) {
    const normalizedUserId = cleanString(userId, 80);
    if (!normalizedUserId || indexedSnapshotUserIds.has(normalizedUserId)) continue;
    if (explicitUserIdFilter && !explicitUserIdFilter.has(normalizedUserId)) continue;
    if (!hasPersistedActivitySnapshotLikeData(getActivityProfileMirror(profile))) continue;
    targetUserIds.add(normalizedUserId);
  }

  return [...targetUserIds];
}

function collectActivitySnapshotTargetUserIds(db, explicitUserIds = []) {
  const state = ensureActivityState(db);
  const explicitUserIdFilter = createExplicitActivityUserIdFilter(explicitUserIds);
  const targetUserIds = new Set();

  for (const userId of Object.keys(state.userSnapshots || {})) {
    addFilteredActivityUserId(targetUserIds, explicitUserIdFilter, userId);
  }

  for (const userId of collectActivityProfileMirrorTargetUserIds(db, explicitUserIds)) {
    targetUserIds.add(userId);
  }

  return [...targetUserIds];
}

function getActivityPersistedSnapshotRecord(db = {}, userId = "") {
  const normalizedUserId = cleanString(userId, 80);
  if (!normalizedUserId) {
    return {
      snapshot: null,
      source: "none",
      hasSnapshotIndex: false,
      hasProfileMirror: false,
    };
  }

  const state = ensureActivityState(db);
  const indexedSnapshot = state.userSnapshots?.[normalizedUserId];
  if (indexedSnapshot && typeof indexedSnapshot === "object" && !Array.isArray(indexedSnapshot)) {
    return {
      snapshot: clone(indexedSnapshot),
      source: "state_snapshot",
      hasSnapshotIndex: true,
      hasProfileMirror: hasPersistedActivitySnapshotLikeData(getActivityProfileMirror(db.profiles?.[normalizedUserId])),
    };
  }

  const profileMirror = getActivityProfileMirror(db.profiles?.[normalizedUserId]);
  if (hasPersistedActivitySnapshotLikeData(profileMirror)) {
    return {
      snapshot: clone(profileMirror),
      source: "profile_mirror",
      hasSnapshotIndex: false,
      hasProfileMirror: true,
    };
  }

  return {
    snapshot: null,
    source: "none",
    hasSnapshotIndex: false,
    hasProfileMirror: Boolean(profileMirror),
  };
}

function getActivityUserLocalHistoryStats(db = {}, userId = "") {
  const normalizedUserId = cleanString(userId, 80);
  const state = ensureActivityState(db);
  const openSession = state.runtime?.openSessions?.[normalizedUserId] || null;
  const dirtyUserIds = new Set(
    (Array.isArray(state.runtime?.dirtyUsers) ? state.runtime.dirtyUsers : [])
      .map((entry) => cleanString(entry, 80))
      .filter(Boolean)
  );
  const finalizedSessionCount = (Array.isArray(state.globalUserSessions) ? state.globalUserSessions : [])
    .filter((entry) => cleanString(entry?.userId, 80) === normalizedUserId)
    .length;
  const dailyRowCount = (Array.isArray(state.userChannelDailyStats) ? state.userChannelDailyStats : [])
    .filter((entry) => cleanString(entry?.userId, 80) === normalizedUserId)
    .length;

  return {
    hasOpenSession: Boolean(openSession),
    isDirty: dirtyUserIds.has(normalizedUserId),
    finalizedSessionCount,
    dailyRowCount,
    hasLocalHistory: Boolean(openSession) || dirtyUserIds.has(normalizedUserId) || finalizedSessionCount > 0 || dailyRowCount > 0,
  };
}

function resolveActivityUserInspectionDiagnosis({
  snapshot = null,
  snapshotSource = "none",
  hasLocalHistory = false,
  integrityIssue = null,
  roleAssignmentPlan = null,
} = {}) {
  const roleEligibilityStatus = cleanString(snapshot?.roleEligibilityStatus, 80) || null;
  const desiredRoleKey = cleanString(snapshot?.desiredActivityRoleKey, 80) || null;

  if (!snapshot && !hasLocalHistory) {
    return {
      statusCode: "no_local_data",
      summary: "Локальные activity-данные по пользователю не найдены.",
      recommendedAction: "Сначала проверь tracking-каналы и исторический импорт.",
    };
  }

  if (integrityIssue) {
    return {
      statusCode: "contradictory_persisted_state",
      summary: "Сохранённый activity snapshot противоречит правилам gate/eligibility и не выглядит надёжным источником правды.",
      recommendedAction: hasLocalHistory
        ? "Сначала запусти полный rebuild+sync с валидным member metadata, чтобы переписать конфликтный snapshot."
        : "Roles-only sync по этому persisted state небезопасен: сначала проверь member metadata и восстанови локальную history-базу или источник mirror-а.",
    };
  }

  if (roleEligibilityStatus === "gated_new_member") {
    return {
      statusCode: "gated_new_member",
      summary: "Пользователь младше порога и пока не может получить activity-роль.",
      recommendedAction: "Ждать окончания gate; импорт или sync это правило не обойдут.",
    };
  }

  if (roleEligibilityStatus === "join_age_unknown") {
    return {
      statusCode: "join_age_unknown",
      summary: "Не удалось определить время входа на сервер, поэтому role gate заблокировал выдачу.",
      recommendedAction: "Нужен полный пересчёт с валидным member metadata, затем повторная выдача ролей.",
    };
  }

  if (snapshot?.manualOverride === true) {
    return {
      statusCode: "manual_override",
      summary: "На пользователе стоит manual override, автоматическая activity-выдача отключена.",
      recommendedAction: "Сначала сними manual override, если хочешь вернуть автоуправление ролями.",
    };
  }

  if (snapshot?.autoRoleFrozen === true) {
    return {
      statusCode: "auto_role_frozen",
      summary: "Автоматическое обновление activity-роли заморожено для этого пользователя.",
      recommendedAction: "Сними freeze, если роль снова должна управляться автоматически.",
    };
  }

  if (snapshotSource === "profile_mirror" && !hasLocalHistory) {
    return {
      statusCode: "profile_mirror_only",
      summary: "У пользователя есть сохранённый profile activity mirror, но нет локальной history-базы для полного пересчёта.",
      recommendedAction: "Можно применить роль по готовым данным через roles-only sync; для полного пересчёта сначала нужен импорт истории.",
    };
  }

  if (!hasLocalHistory && snapshot) {
    return {
      statusCode: "missing_local_history",
      summary: "Есть сохранённый snapshot, но нет локальной history-базы для полного пересчёта.",
      recommendedAction: "Если snapshot актуален, можно использовать roles-only sync. Для rebuild+sync нужен импорт истории.",
    };
  }

  if (desiredRoleKey === "dead") {
    return {
      statusCode: "below_threshold",
      summary: "Пользователь ниже минимального порога activity и роль сейчас не должна выдаваться.",
      recommendedAction: "Действий не требуется, кроме ручной проверки формулы или watched-channel покрытия.",
    };
  }

  if (roleAssignmentPlan?.skipReason === "missing_role_mapping") {
    return {
      statusCode: "missing_role_mapping",
      summary: "Нужный activity-tier посчитан, но для него не привязана Discord-роль.",
      recommendedAction: "Заполни role mapping для нужного tier и затем повтори выдачу ролей.",
    };
  }

  if (roleAssignmentPlan?.skipReason === "unchanged") {
    return {
      statusCode: "role_synced",
      summary: "Роль уже соответствует текущему рассчитанному activity-tier.",
      recommendedAction: "Ничего делать не нужно.",
    };
  }

  if (roleAssignmentPlan?.shouldApply) {
    return {
      statusCode: "ready_to_apply",
      summary: "Данные выглядят валидно, activity-роль можно применить прямо сейчас.",
      recommendedAction: "Используй roles-only sync для быстрой выдачи или полный пересчёт, если score мог устареть.",
    };
  }

  return {
    statusCode: cleanString(roleAssignmentPlan?.skipReason, 80) || "review_needed",
    summary: "Нужна ручная проверка состояния пользователя.",
    recommendedAction: "Проверь локальную историю, desired/applied role и текущие Discord-роли пользователя.",
  };
}

function getActivityUserInspection({
  db = {},
  userId = "",
  memberRoleIds = [],
  resolveRoleAssignmentPlan,
} = {}) {
  const normalizedUserId = cleanString(userId, 80);
  if (!normalizedUserId) {
    return {
      userId: "",
      snapshot: null,
      snapshotSource: "none",
      hasSnapshotIndex: false,
      hasProfileMirror: false,
      history: {
        hasOpenSession: false,
        isDirty: false,
        finalizedSessionCount: 0,
        dailyRowCount: 0,
        hasLocalHistory: false,
      },
      visibility: {
        canRunRebuildAndSync: false,
        canRunRolesOnlySync: false,
      },
      roleAssignmentPlan: null,
      diagnosis: resolveActivityUserInspectionDiagnosis(),
    };
  }

  const persistedSnapshot = getActivityPersistedSnapshotRecord(db, normalizedUserId);
  const history = getActivityUserLocalHistoryStats(db, normalizedUserId);
  const integrityIssue = getActivitySnapshotIntegrityIssue(persistedSnapshot.snapshot);
  const normalizedMemberRoleIds = normalizeStringArray(memberRoleIds, 5000);
  const roleAssignmentPlan = typeof resolveRoleAssignmentPlan === "function"
    ? resolveRoleAssignmentPlan({
      db,
      userId: normalizedUserId,
      memberRoleIds: normalizedMemberRoleIds,
    })
    : null;

  return {
    userId: normalizedUserId,
    snapshot: persistedSnapshot.snapshot,
    snapshotSource: persistedSnapshot.source,
    hasSnapshotIndex: persistedSnapshot.hasSnapshotIndex,
    hasProfileMirror: persistedSnapshot.hasProfileMirror,
    integrityIssue,
    history,
    visibility: {
      canRunRebuildAndSync: history.hasLocalHistory,
      canRunRolesOnlySync: Boolean(persistedSnapshot.snapshot),
    },
    roleAssignmentPlan,
    diagnosis: resolveActivityUserInspectionDiagnosis({
      snapshot: persistedSnapshot.snapshot,
      snapshotSource: persistedSnapshot.source,
      hasLocalHistory: history.hasLocalHistory,
      integrityIssue,
      roleAssignmentPlan,
    }),
  };
}

module.exports = {
  collectActivityAssignmentTargetUserIds,
  collectActivityHistoryTargetUserIds,
  collectActivitySnapshotTargetUserIds,
  getActivityPersistedSnapshotRecord,
  getActivitySnapshotIntegrityIssue,
  getActivityUserInspection,
};