"use strict";

const NON_FAKE_TIER_KEY = 6;
const NON_FAKE_TIER_LABEL = "Не фейкостановцы";

function cleanUserId(value) {
  return String(value || "").trim();
}

function normalizeTierlistSpecialState(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    nonFakeUserIds: [...new Set(
      (Array.isArray(source.nonFakeUserIds) ? source.nonFakeUserIds : [])
        .map((entry) => cleanUserId(entry))
        .filter(Boolean)
    )],
  };
}

function ensureTierlistSpecialState(dbConfig = {}) {
  dbConfig.tierlistSpecial = normalizeTierlistSpecialState(dbConfig.tierlistSpecial);
  return dbConfig.tierlistSpecial;
}

function getTierlistNonFakeUserIds(dbConfig = {}) {
  return [...ensureTierlistSpecialState(dbConfig).nonFakeUserIds];
}

function getTierlistNonFakeUserIdSet(dbConfig = {}) {
  return new Set(getTierlistNonFakeUserIds(dbConfig));
}

function setTierlistNonFakeUser(dbConfig = {}, userId, enabled = true) {
  const normalizedUserId = cleanUserId(userId);
  const state = ensureTierlistSpecialState(dbConfig);
  if (!normalizedUserId) {
    return { changed: false, enabled: false, userIds: [...state.nonFakeUserIds] };
  }

  const current = new Set(state.nonFakeUserIds);
  const hadUser = current.has(normalizedUserId);
  if (enabled) {
    current.add(normalizedUserId);
  } else {
    current.delete(normalizedUserId);
  }

  state.nonFakeUserIds = [...current];
  return {
    changed: hadUser !== Boolean(enabled),
    enabled: current.has(normalizedUserId),
    userIds: [...state.nonFakeUserIds],
  };
}

function applyTierlistSpecialMembers(entries = [], options = {}) {
  const nonFakeUserIds = options.nonFakeUserIds instanceof Set
    ? options.nonFakeUserIds
    : new Set(
      (Array.isArray(options.nonFakeUserIds) ? options.nonFakeUserIds : [])
        .map((entry) => cleanUserId(entry))
        .filter(Boolean)
    );

  return (Array.isArray(entries) ? entries : [])
    .map((entry) => {
      const normalizedUserId = cleanUserId(entry?.userId);
      const isNonFakeTierMember = Boolean(normalizedUserId && nonFakeUserIds.has(normalizedUserId));
      return {
        ...entry,
        displayTier: isNonFakeTierMember
          ? NON_FAKE_TIER_KEY
          : Number(entry?.displayTier ?? entry?.killTier ?? entry?.tier) || null,
        isNonFakeTierMember,
      };
    })
    .sort((left, right) => {
      if (Boolean(left.isNonFakeTierMember) !== Boolean(right.isNonFakeTierMember)) {
        return Number(Boolean(left.isNonFakeTierMember)) - Number(Boolean(right.isNonFakeTierMember));
      }

      const leftKills = Number(left?.approvedKills) || 0;
      const rightKills = Number(right?.approvedKills) || 0;
      if (rightKills !== leftKills) return rightKills - leftKills;

      return String(left?.displayName || left?.name || left?.userId || "")
        .localeCompare(String(right?.displayName || right?.name || right?.userId || ""), "ru");
    });
}

module.exports = {
  NON_FAKE_TIER_KEY,
  NON_FAKE_TIER_LABEL,
  applyTierlistSpecialMembers,
  ensureTierlistSpecialState,
  getTierlistNonFakeUserIdSet,
  getTierlistNonFakeUserIds,
  normalizeTierlistSpecialState,
  setTierlistNonFakeUser,
};