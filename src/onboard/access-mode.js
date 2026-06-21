"use strict";

const ONBOARD_ACCESS_MODES = Object.freeze({
  NORMAL: "normal",
  WARTIME: "wartime",
  APOCALYPSE: "apocalypse",
});

const ONBOARD_ACCESS_MODE_LABELS = Object.freeze({
  [ONBOARD_ACCESS_MODES.NORMAL]: "Обычное время",
  [ONBOARD_ACCESS_MODES.WARTIME]: "Военное время",
  [ONBOARD_ACCESS_MODES.APOCALYPSE]: "Апокалипсис",
});

function normalizeOnboardAccessMode(value) {
  const normalized = String(value || "").trim().toLowerCase();

  if (normalized === ONBOARD_ACCESS_MODES.WARTIME) return ONBOARD_ACCESS_MODES.WARTIME;
  if (normalized === ONBOARD_ACCESS_MODES.APOCALYPSE) return ONBOARD_ACCESS_MODES.APOCALYPSE;
  return ONBOARD_ACCESS_MODES.NORMAL;
}

function createOnboardModeState(value = {}) {
  const state = value && typeof value === "object" ? value : {};
  const changedAt = String(state.changedAt || "").trim();

  return {
    mode: normalizeOnboardAccessMode(state.mode),
    changedAt: changedAt || null,
    changedBy: String(state.changedBy || "").trim(),
  };
}

function getOnboardAccessModeLabel(value) {
  return ONBOARD_ACCESS_MODE_LABELS[normalizeOnboardAccessMode(value)] || ONBOARD_ACCESS_MODE_LABELS[ONBOARD_ACCESS_MODES.NORMAL];
}

function isApocalypseMode(value) {
  return normalizeOnboardAccessMode(value) === ONBOARD_ACCESS_MODES.APOCALYPSE;
}

function isWartimeMode(value) {
  return normalizeOnboardAccessMode(value) === ONBOARD_ACCESS_MODES.WARTIME;
}

function cleanRoleId(value) {
  return String(value || "").trim();
}

function normalizeHeldRoleIds(value) {
  if (value instanceof Set) {
    return new Set([...value].map((entry) => cleanRoleId(entry)).filter(Boolean));
  }
  if (Array.isArray(value)) {
    return new Set(value.map((entry) => cleanRoleId(entry)).filter(Boolean));
  }
  return new Set();
}

function resolveGrantedAccessRoleId({
  mode = ONBOARD_ACCESS_MODES.NORMAL,
  normalAccessRoleId = "",
  wartimeAccessRoleId = "",
  heldRoleIds = [],
} = {}) {
  const normalizedMode = normalizeOnboardAccessMode(mode);
  const normalRoleId = cleanRoleId(normalAccessRoleId);
  const wartimeRoleId = cleanRoleId(wartimeAccessRoleId);
  const heldRoleIdSet = normalizeHeldRoleIds(heldRoleIds);

  if (normalizedMode === ONBOARD_ACCESS_MODES.WARTIME) {
    return wartimeRoleId || normalRoleId;
  }

  return normalRoleId || (wartimeRoleId && heldRoleIdSet.has(wartimeRoleId) ? wartimeRoleId : "");
}

function resolveSelfServiceAccessGrantBlockReason({
  mode = ONBOARD_ACCESS_MODES.NORMAL,
  roleId = "",
  normalAccessRoleId = "",
  nonJjsAccessRoleId = "",
  accessCompanionRoleId = "",
} = {}) {
  if (!isWartimeMode(mode)) return "";

  const targetRoleId = cleanRoleId(roleId);
  if (!targetRoleId) return "";

  const blockedRoleIds = normalizeHeldRoleIds([
    normalAccessRoleId,
    nonJjsAccessRoleId,
    accessCompanionRoleId,
  ]);

  return blockedRoleIds.has(targetRoleId) ? "wartime_access_self_service" : "";
}

// Wartime mode grants the restricted "wartime" access role to *new* members instead of
// the full normal access role. An established member who already holds the full normal
// access role must never be downgraded to the wartime role — e.g. when they merely
// resubmit kills to refresh their stats while wartime is active. Returns true when such a
// member should keep their existing normal access untouched.
function shouldPreserveNormalAccessDuringWartime({
  mode = ONBOARD_ACCESS_MODES.NORMAL,
  normalAccessRoleId = "",
  heldRoleIds = [],
} = {}) {
  if (normalizeOnboardAccessMode(mode) !== ONBOARD_ACCESS_MODES.WARTIME) return false;
  const normalRoleId = cleanRoleId(normalAccessRoleId);
  if (!normalRoleId) return false;
  return normalizeHeldRoleIds(heldRoleIds).has(normalRoleId);
}

module.exports = {
  ONBOARD_ACCESS_MODES,
  ONBOARD_ACCESS_MODE_LABELS,
  createOnboardModeState,
  getOnboardAccessModeLabel,
  isApocalypseMode,
  isWartimeMode,
  normalizeOnboardAccessMode,
  resolveGrantedAccessRoleId,
  resolveSelfServiceAccessGrantBlockReason,
  shouldPreserveNormalAccessDuringWartime,
};
