"use strict";

const fs = require("fs");
const path = require("path");

const { ensureSharedProfile, normalizeIntegrationState } = require("./shared-profile");
const { writeNativeIntegrationSnapshot } = require("../sot/native-integrations");
const { resolveIntegrationRecord } = require("../sot/resolver/integrations");

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function normalizeNullableString(value, limit = 2000) {
  const text = cleanString(value, limit);
  return text || null;
}

function normalizeNullableInteger(value, options = {}) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  if (Number.isFinite(options.min) && amount < options.min) return null;
  if (Number.isFinite(options.max) && amount > options.max) return null;
  return amount;
}

function normalizePositiveNumber(value, fallback = 1) {
  if (value === null || value === undefined || value === "") return fallback;
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : fallback;
}

function normalizeIsoLike(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return new Date(value).toISOString();
  }

  const text = cleanString(value, 80);
  if (!text) return null;

  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : text;
}

function buildCharacterNameMap(characterCatalog = []) {
  const map = new Map();

  for (const entry of Array.isArray(characterCatalog) ? characterCatalog : []) {
    if (!entry || typeof entry !== "object") continue;
    const id = cleanString(entry.id, 80);
    if (!id) continue;
    const name = cleanString(entry.name || entry.label, 120);
    if (!name) continue;
    map.set(id, name);
  }

  return map;
}

function normalizeTierlistBoardState(rawValue = {}) {
  const source = rawValue && typeof rawValue === "object" ? rawValue : {};
  return {
    channelId: cleanString(source.channelId, 40),
    messageId: cleanString(source.messageId, 40),
    lastUpdated: normalizeIsoLike(source.lastUpdated),
  };
}

function normalizeLegacyTierlistUser(rawValue = {}, fallbackUserId = "") {
  const source = rawValue && typeof rawValue === "object" ? rawValue : {};
  return {
    userId: cleanString(source.userId || fallbackUserId, 80),
    mainId: normalizeNullableString(source.mainId, 80),
    lockUntil: normalizeIsoLike(source.lockUntil),
    lastSubmitAt: normalizeIsoLike(source.lastSubmitAt),
    influenceMultiplier: normalizePositiveNumber(source.influenceMultiplier, 1),
    influenceRoleId: normalizeNullableString(source.influenceRoleId, 40),
  };
}

function countLegacyTierlistVotes(voteMap) {
  if (!voteMap || typeof voteMap !== "object" || Array.isArray(voteMap)) return 0;
  return Object.values(voteMap).filter((tierKey) => cleanString(tierKey, 2)).length;
}

function normalizeLegacyTierlistState(rawValue = {}, options = {}) {
  const source = rawValue && typeof rawValue === "object" ? rawValue : {};
  const settings = source.settings && typeof source.settings === "object" ? source.settings : {};
  const rawUsers = source.users && typeof source.users === "object" ? source.users : {};
  const rawFinalVotes = source.finalVotes && typeof source.finalVotes === "object" ? source.finalVotes : {};

  const users = {};
  for (const [userId, rawUser] of Object.entries(rawUsers)) {
    const user = normalizeLegacyTierlistUser(rawUser, userId);
    if (!user.userId) continue;
    users[user.userId] = user;
  }

  const finalVoteCounts = {};
  for (const [userId, voteMap] of Object.entries(rawFinalVotes)) {
    const normalizedUserId = cleanString(userId, 80);
    if (!normalizedUserId) continue;
    finalVoteCounts[normalizedUserId] = countLegacyTierlistVotes(voteMap);
    if (!users[normalizedUserId]) {
      users[normalizedUserId] = normalizeLegacyTierlistUser({}, normalizedUserId);
    }
  }

  return {
    settings: {
      dashboard: normalizeTierlistBoardState({
        channelId: settings.channelId,
        messageId: settings.dashboardMessageId,
        lastUpdated: settings.lastUpdated,
      }),
      summary: normalizeTierlistBoardState({
        channelId: settings.summaryChannelId,
        messageId: settings.summaryMessageId,
        lastUpdated: settings.summaryLastUpdated,
      }),
    },
    users,
    finalVoteCounts,
    characterNameById: buildCharacterNameMap(options.characterCatalog),
  };
}

function buildDormantTierlistDomainState(user = {}, options = {}) {
  const mainId = normalizeNullableString(user.mainId, 80);
  const hasSubmission = Boolean(options.hasSubmission || user.lastSubmitAt);
  const submittedAt = hasSubmission
    ? normalizeIsoLike(user.lastSubmitAt) || normalizeIsoLike(options.syncedAt)
    : null;

  return {
    mainId,
    mainName: mainId ? normalizeNullableString(options.mainName, 120) : null,
    submittedAt,
    lockUntil: normalizeIsoLike(user.lockUntil),
    influenceMultiplier: normalizePositiveNumber(user.influenceMultiplier, 1),
    influenceRoleId: normalizeNullableString(user.influenceRoleId, 40),
    dashboardSyncedAt: normalizeIsoLike(options.dashboardSyncedAt),
    summarySyncedAt: normalizeIsoLike(options.summarySyncedAt),
  };
}

function applyDormantTierlistSync(db, legacyTierlistState, options = {}) {
  if (!db || typeof db !== "object") throw new Error("Moderator db is required");

  const syncedAt = normalizeIsoLike(options.syncedAt) || new Date().toISOString();
  const sourcePath = cleanString(options.sourcePath, 500);
  const normalized = normalizeLegacyTierlistState(legacyTierlistState, options);
  const userIds = new Set([
    ...Object.keys(normalized.users || {}),
    ...Object.keys(normalized.finalVoteCounts || {}),
  ]);

  db.config ||= {};
  const normalizedIntegrations = normalizeIntegrationState(db.config.integrations);
  db.config.integrations = normalizedIntegrations.integrations;
  db.profiles ||= {};
  const currentIntegration = resolveIntegrationRecord({ slot: "tierlist", db });

  const tierlistState = {
    ...currentIntegration,
    sourcePath: sourcePath || currentIntegration.sourcePath || "",
    status: sourcePath || userIds.size ? "in_progress" : currentIntegration.status,
    lastImportAt: syncedAt,
    lastSyncAt: syncedAt,
    dashboard: { ...normalized.settings.dashboard },
    summary: { ...normalized.settings.summary },
  };
  writeNativeIntegrationSnapshot(db, { slot: "tierlist", patch: tierlistState });

  let mutated = normalizedIntegrations.mutated;
  let syncedProfiles = 0;
  let clearedProfiles = 0;

  for (const userId of userIds) {
    const existing = db.profiles[userId] || { userId };
    const user = normalized.users[userId] || normalizeLegacyTierlistUser({}, userId);
    const hasSubmission = (normalized.finalVoteCounts[userId] || 0) > 0 || Boolean(user.lastSubmitAt);
    const mainName = user.mainId
      ? normalized.characterNameById.get(user.mainId) || cleanString(existing?.domains?.tierlist?.mainName, 120)
      : null;

    const nextProfile = {
      ...existing,
      userId,
      domains: {
        ...(existing.domains || {}),
        tierlist: buildDormantTierlistDomainState(user, {
          hasSubmission,
          syncedAt,
          mainName,
          dashboardSyncedAt: normalized.settings.dashboard.lastUpdated,
          summarySyncedAt: normalized.settings.summary.lastUpdated,
        }),
      },
    };

    const ensured = ensureSharedProfile(nextProfile, userId);
    mutated ||= JSON.stringify(existing) !== JSON.stringify(ensured.profile);
    db.profiles[userId] = ensured.profile;
    syncedProfiles += 1;
  }

  for (const [userId, existing] of Object.entries(db.profiles || {})) {
    if (userIds.has(userId)) continue;
    if (!existing?.domains?.tierlist) continue;

    const cleared = {
      ...existing,
      domains: {
        ...(existing.domains || {}),
        tierlist: {},
      },
    };
    const ensured = ensureSharedProfile(cleared, userId);
    mutated ||= JSON.stringify(existing) !== JSON.stringify(ensured.profile);
    db.profiles[userId] = ensured.profile;
    clearedProfiles += 1;
  }

  return {
    mutated,
    syncedProfiles,
    clearedProfiles,
    importedUserCount: userIds.size,
    dashboardChannelId: tierlistState.dashboard.channelId,
    summaryChannelId: tierlistState.summary.channelId,
  };
}

function clearDormantTierlistSync(db, options = {}) {
  if (!db || typeof db !== "object") throw new Error("Moderator db is required");

  const syncedAt = normalizeIsoLike(options.syncedAt) || new Date().toISOString();
  const sourcePath = cleanString(options.sourcePath, 500);

  db.config ||= {};
  const normalizedIntegrations = normalizeIntegrationState(db.config.integrations);
  db.config.integrations = normalizedIntegrations.integrations;
  db.profiles ||= {};
  const currentIntegration = resolveIntegrationRecord({ slot: "tierlist", db });

  const tierlistState = {
    ...currentIntegration,
    sourcePath,
    status: sourcePath ? currentIntegration.status : "not_started",
    lastSyncAt: syncedAt,
  };

  if (!sourcePath) {
    tierlistState.lastImportAt = null;
    tierlistState.dashboard = { channelId: "", messageId: "", lastUpdated: null };
    tierlistState.summary = { channelId: "", messageId: "", lastUpdated: null };
  }

  writeNativeIntegrationSnapshot(db, { slot: "tierlist", patch: tierlistState });

  let mutated = normalizedIntegrations.mutated;
  let clearedProfiles = 0;

  for (const [userId, existing] of Object.entries(db.profiles || {})) {
    if (!existing?.domains?.tierlist) continue;

    const cleared = {
      ...existing,
      domains: {
        ...(existing.domains || {}),
        tierlist: {},
      },
    };
    const ensured = ensureSharedProfile(cleared, userId);
    mutated ||= JSON.stringify(existing) !== JSON.stringify(ensured.profile);
    db.profiles[userId] = ensured.profile;
    clearedProfiles += 1;
  }

  return {
    mutated,
    clearedProfiles,
  };
}

function importDormantTierlistSyncFromFile(db, options = {}) {
  const rawSourcePath = cleanString(options.sourcePath, 500);
  if (!rawSourcePath) {
    return {
      mutated: false,
      imported: false,
      sourcePath: "",
      resolvedPath: "",
      error: null,
    };
  }

  const baseDir = cleanString(options.baseDir, 2000) || process.cwd();
  const resolvedPath = path.isAbsolute(rawSourcePath)
    ? rawSourcePath
    : path.resolve(baseDir, rawSourcePath);

  if (!fs.existsSync(resolvedPath)) {
    return {
      mutated: false,
      imported: false,
      sourcePath: rawSourcePath,
      resolvedPath,
      error: null,
    };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
    const syncResult = applyDormantTierlistSync(db, raw, {
      sourcePath: rawSourcePath,
      syncedAt: options.syncedAt,
      characterCatalog: options.characterCatalog,
    });
    return {
      ...syncResult,
      imported: true,
      sourcePath: rawSourcePath,
      resolvedPath,
      error: null,
    };
  } catch (error) {
    return {
      mutated: false,
      imported: false,
      sourcePath: rawSourcePath,
      resolvedPath,
      error: String(error?.message || error),
    };
  }
}

module.exports = {
  applyDormantTierlistSync,
  buildCharacterNameMap,
  clearDormantTierlistSync,
  importDormantTierlistSyncFromFile,
  normalizeLegacyTierlistState,
};