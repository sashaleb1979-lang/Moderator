"use strict";

const DEFAULT_ROBLOX_API_BASES = {
  users: "https://users.roblox.com",
  thumbnails: "https://thumbnails.roblox.com",
  friends: "https://friends.roblox.com",
  presence: "https://presence.roblox.com",
  groups: "https://groups.roblox.com",
};

const ROBLOX_FRIENDSHIP_STATUSES = {
  0: "not_friends",
  1: "friends",
  2: "request_sent",
  3: "request_received",
};

const ROBLOX_PRESENCE_TYPES = {
  0: "offline",
  1: "online",
  2: "in_game",
  3: "in_studio",
};

function assertFunction(value, name) {
  if (typeof value !== "function") {
    throw new TypeError(`${name} must be a function`);
  }
}

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function normalizeNullableString(value, limit = 2000) {
  const text = cleanString(value, limit);
  return text || null;
}

function normalizeNullableBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

function normalizeNullableInteger(value, options = {}) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) return null;
  if (Number.isFinite(options.min) && amount < options.min) return null;
  if (Number.isFinite(options.max) && amount > options.max) return null;
  return amount;
}

function normalizeNonNegativeInteger(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : fallback;
}

function normalizeIntegerArray(values = [], options = {}) {
  const limit = Math.max(0, Number(options.limit) || 0) || values.length || 0;
  const unique = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = normalizeNullableInteger(value, { min: 1 });
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
    if (unique.length >= limit) break;
  }
  return unique;
}

function normalizeStringArray(values = [], options = {}) {
  const limit = Math.max(0, Number(options.limit) || 0) || values.length || 0;
  const unique = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = normalizeNullableString(value, options.itemLimit || 200);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(normalized);
    if (unique.length >= limit) break;
  }
  return unique;
}

function splitIntoBatches(values = [], batchSize = 100) {
  const normalizedBatchSize = Math.max(1, Number(batchSize) || 100);
  const items = Array.isArray(values) ? [...values] : [];
  const batches = [];
  for (let index = 0; index < items.length; index += normalizedBatchSize) {
    batches.push(items.slice(index, index + normalizedBatchSize));
  }
  return batches;
}

function buildRobloxProfileUrl(userId) {
  const normalizedUserId = normalizeNullableInteger(userId, { min: 1 });
  return normalizedUserId ? `https://www.roblox.com/users/${normalizedUserId}/profile` : null;
}

function normalizeRobloxUserProfile(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const userId = normalizeNullableInteger(source.id ?? source.userId, { min: 1 });
  return {
    userId,
    username: normalizeNullableString(source.name ?? source.username, 120),
    displayName: normalizeNullableString(source.displayName, 120),
    description: normalizeNullableString(source.description, 2000),
    createdAt: normalizeNullableString(source.created, 80),
    isBanned: Boolean(source.isBanned),
    hasVerifiedBadge: normalizeNullableBoolean(source.hasVerifiedBadge),
    profileUrl: buildRobloxProfileUrl(userId),
  };
}

function normalizeRobloxAvatarHeadshot(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    userId: normalizeNullableInteger(source.targetId ?? source.userId, { min: 1 }),
    imageUrl: normalizeNullableString(source.imageUrl, 2000),
    state: normalizeNullableString(source.state, 40),
    version: normalizeNullableString(source.version, 40),
  };
}

function normalizeRobloxFriendRecord(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    userId: normalizeNullableInteger(source.id ?? source.userId, { min: 1 }),
    username: normalizeNullableString(source.name ?? source.username, 120),
    displayName: normalizeNullableString(source.displayName, 120),
    description: normalizeNullableString(source.description, 2000),
    createdAt: normalizeNullableString(source.created, 80),
    isBanned: Boolean(source.isBanned),
    hasVerifiedBadge: normalizeNullableBoolean(source.hasVerifiedBadge),
    isOnline: normalizeNullableBoolean(source.isOnline),
    presenceType: ROBLOX_PRESENCE_TYPES[Number(source.presenceType)] || null,
    friendFrequentScore: normalizeNonNegativeInteger(source.friendFrequentScore, 0),
    friendFrequentRank: normalizeNonNegativeInteger(source.friendFrequentRank, 0),
  };
}

function normalizeRobloxFriendStatusRecord(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const userId = normalizeNullableInteger(source.id ?? source.userId, { min: 1 });
  const rawStatus = Number(source.status);
  return {
    userId,
    status: Object.prototype.hasOwnProperty.call(ROBLOX_FRIENDSHIP_STATUSES, rawStatus)
      ? ROBLOX_FRIENDSHIP_STATUSES[rawStatus]
      : "unknown",
  };
}

function normalizeRobloxPresenceRecord(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const rawType = Number(source.userPresenceType);
  return {
    userId: normalizeNullableInteger(source.userId, { min: 1 }),
    presenceType: Object.prototype.hasOwnProperty.call(ROBLOX_PRESENCE_TYPES, rawType)
      ? ROBLOX_PRESENCE_TYPES[rawType]
      : "unknown",
    lastLocation: normalizeNullableString(source.lastLocation, 200),
    placeId: normalizeNullableInteger(source.placeId, { min: 1 }),
    rootPlaceId: normalizeNullableInteger(source.rootPlaceId, { min: 1 }),
    gameId: normalizeNullableString(source.gameId, 80),
    universeId: normalizeNullableInteger(source.universeId, { min: 1 }),
  };
}

function normalizeRobloxGroupMembership(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const group = source.group && typeof source.group === "object" ? source.group : {};
  const role = source.role && typeof source.role === "object" ? source.role : {};
  return {
    groupId: normalizeNullableInteger(group.id, { min: 1 }),
    groupName: normalizeNullableString(group.name, 200),
    groupMemberCount: normalizeNonNegativeInteger(group.memberCount, 0),
    groupHasVerifiedBadge: normalizeNullableBoolean(group.hasVerifiedBadge),
    roleId: normalizeNullableInteger(role.id, { min: 1 }),
    roleName: normalizeNullableString(role.name, 120),
    roleRank: normalizeNullableInteger(role.rank, { min: 0, max: 255 }),
  };
}

function normalizeRobloxUsernameHistoryEntry(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const name = normalizeNullableString(source.name ?? source.username ?? source.value, 120);
  if (!name) return null;
  return {
    name,
  };
}

class RobloxApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "RobloxApiError";
    this.status = normalizeNullableInteger(details.status, { min: 100, max: 599 });
    this.url = normalizeNullableString(details.url, 2000);
    this.code = normalizeNullableInteger(details.code, { min: 0 });
    this.details = details.details || null;
  }
}

function createRobloxApiClient(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const bases = {
    ...DEFAULT_ROBLOX_API_BASES,
    ...(options.bases && typeof options.bases === "object" ? options.bases : {}),
  };

  assertFunction(fetchImpl, "fetchImpl");

  async function requestJson(url, init = {}) {
    const response = await fetchImpl(url, init);
    const text = typeof response?.text === "function"
      ? await response.text()
      : "";
    const payload = text ? JSON.parse(text) : null;

    if (!response?.ok) {
      const firstError = Array.isArray(payload?.errors) ? payload.errors[0] : null;
      throw new RobloxApiError(
        normalizeNullableString(firstError?.message, 400) || `Roblox API request failed (${response?.status || "unknown"})`,
        {
          status: response?.status,
          url,
          code: firstError?.code,
          details: payload,
        }
      );
    }

    return payload;
  }

  async function fetchUsersByUsernames(usernames = [], options = {}) {
    const normalizedUsernames = normalizeStringArray(usernames, { limit: 100, itemLimit: 120 });
    if (!normalizedUsernames.length) return [];
    const payload = await requestJson(`${bases.users}/v1/usernames/users`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        usernames: normalizedUsernames,
        excludeBannedUsers: options.excludeBannedUsers === true,
      }),
    });
    return Array.isArray(payload?.data) ? payload.data.map((entry) => normalizeRobloxUserProfile(entry)) : [];
  }

  async function fetchUserProfile(userId) {
    const normalizedUserId = normalizeNullableInteger(userId, { min: 1 });
    if (!normalizedUserId) return null;
    const payload = await requestJson(`${bases.users}/v1/users/${normalizedUserId}`);
    return normalizeRobloxUserProfile(payload);
  }

  async function fetchUserUsernameHistory(userId, options = {}) {
    const normalizedUserId = normalizeNullableInteger(userId, { min: 1 });
    if (!normalizedUserId) return [];
    const query = new URLSearchParams({
      limit: String(Math.max(1, Math.min(100, Number(options.limit) || 100))),
      sortOrder: cleanString(options.sortOrder || "Desc", 10) || "Desc",
    });
    const payload = await requestJson(`${bases.users}/v1/users/${normalizedUserId}/username-history?${query.toString()}`);
    return Array.isArray(payload?.data)
      ? payload.data
        .map((entry) => normalizeRobloxUsernameHistoryEntry(entry))
        .filter(Boolean)
      : [];
  }

  async function fetchUserAvatarHeadshots(userIds = [], options = {}) {
    const normalizedUserIds = normalizeIntegerArray(userIds, { limit: 100 });
    if (!normalizedUserIds.length) return [];
    const query = new URLSearchParams({
      userIds: normalizedUserIds.join(","),
      size: cleanString(options.size || "150x150", 20),
      format: cleanString(options.format || "Png", 10),
      isCircular: options.isCircular === true ? "true" : "false",
    });
    const payload = await requestJson(`${bases.thumbnails}/v1/users/avatar-headshot?${query.toString()}`);
    return Array.isArray(payload?.data) ? payload.data.map((entry) => normalizeRobloxAvatarHeadshot(entry)) : [];
  }

  async function fetchUserFriends(userId) {
    const normalizedUserId = normalizeNullableInteger(userId, { min: 1 });
    if (!normalizedUserId) return [];
    const payload = await requestJson(`${bases.friends}/v1/users/${normalizedUserId}/friends`);
    return Array.isArray(payload?.data) ? payload.data.map((entry) => normalizeRobloxFriendRecord(entry)) : [];
  }

  async function fetchUserFriendCount(userId) {
    const normalizedUserId = normalizeNullableInteger(userId, { min: 1 });
    if (!normalizedUserId) return 0;
    const payload = await requestJson(`${bases.friends}/v1/users/${normalizedUserId}/friends/count`);
    return normalizeNonNegativeInteger(payload?.count, 0);
  }

  async function fetchFriendStatuses(userId, targetUserIds = []) {
    const normalizedUserId = normalizeNullableInteger(userId, { min: 1 });
    const normalizedTargetIds = normalizeIntegerArray(targetUserIds, { limit: 100 });
    if (!normalizedUserId || !normalizedTargetIds.length) return [];
    const query = new URLSearchParams({ userIds: normalizedTargetIds.join(",") });
    const payload = await requestJson(`${bases.friends}/v1/users/${normalizedUserId}/friends/statuses?${query.toString()}`);
    return Array.isArray(payload?.data) ? payload.data.map((entry) => normalizeRobloxFriendStatusRecord(entry)) : [];
  }

  async function fetchUserPresences(userIds = []) {
    const normalizedUserIds = normalizeIntegerArray(userIds, { limit: 100 });
    if (!normalizedUserIds.length) return [];
    const payload = await requestJson(`${bases.presence}/v1/presence/users`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userIds: normalizedUserIds }),
    });
    return Array.isArray(payload?.userPresences)
      ? payload.userPresences.map((entry) => normalizeRobloxPresenceRecord(entry))
      : [];
  }

  async function fetchUserGroups(userId, options = {}) {
    const normalizedUserId = normalizeNullableInteger(userId, { min: 1 });
    if (!normalizedUserId) return [];
    const query = new URLSearchParams({
      includeLocked: options.includeLocked === true ? "true" : "false",
      includeNotificationPreferences: options.includeNotificationPreferences === true ? "true" : "false",
      discoveryType: String(Number.isSafeInteger(Number(options.discoveryType)) ? Number(options.discoveryType) : 0),
    });
    const payload = await requestJson(`${bases.groups}/v2/users/${normalizedUserId}/groups/roles?${query.toString()}`);
    return Array.isArray(payload?.data) ? payload.data.map((entry) => normalizeRobloxGroupMembership(entry)) : [];
  }

  return {
    fetchFriendStatuses,
    fetchUserAvatarHeadshots,
    fetchUserFriendCount,
    fetchUserFriends,
    fetchUserGroups,
    fetchUserPresences,
    fetchUserProfile,
    fetchUserUsernameHistory,
    fetchUsersByUsernames,
  };
}

module.exports = {
  DEFAULT_ROBLOX_API_BASES,
  RobloxApiError,
  buildRobloxProfileUrl,
  createRobloxApiClient,
  normalizeRobloxAvatarHeadshot,
  normalizeRobloxFriendRecord,
  normalizeRobloxFriendStatusRecord,
  normalizeRobloxGroupMembership,
  normalizeRobloxPresenceRecord,
  normalizeRobloxUsernameHistoryEntry,
  normalizeRobloxUserProfile,
  splitIntoBatches,
};