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

module.exports = {
  ONBOARD_ACCESS_MODES,
  ONBOARD_ACCESS_MODE_LABELS,
  createOnboardModeState,
  getOnboardAccessModeLabel,
  isApocalypseMode,
  normalizeOnboardAccessMode,
};