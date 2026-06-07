"use strict";

const ONBOARD_ACCESS_GRANT_MODES = Object.freeze({
  AFTER_SUBMIT: "after_submit",
});

const ONBOARD_ACCESS_GRANT_MODE_LABELS = Object.freeze({
  [ONBOARD_ACCESS_GRANT_MODES.AFTER_SUBMIT]: "Сразу после заявки",
});

function normalizeOnboardAccessGrantMode(value) {
  void value;
  return ONBOARD_ACCESS_GRANT_MODES.AFTER_SUBMIT;
}

function createOnboardAccessGrantState(value = {}) {
  const state = value && typeof value === "object" ? value : {};
  const changedAt = String(state.changedAt || "").trim();

  return {
    mode: normalizeOnboardAccessGrantMode(state.mode),
    changedAt: changedAt || null,
    changedBy: String(state.changedBy || "").trim(),
  };
}

function getOnboardAccessGrantModeLabel(value) {
  return ONBOARD_ACCESS_GRANT_MODE_LABELS[normalizeOnboardAccessGrantMode(value)]
    || ONBOARD_ACCESS_GRANT_MODE_LABELS[ONBOARD_ACCESS_GRANT_MODES.AFTER_SUBMIT];
}

module.exports = {
  ONBOARD_ACCESS_GRANT_MODES,
  ONBOARD_ACCESS_GRANT_MODE_LABELS,
  createOnboardAccessGrantState,
  getOnboardAccessGrantModeLabel,
  normalizeOnboardAccessGrantMode,
};
