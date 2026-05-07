"use strict";

const ONBOARD_BEGIN_ROUTES = Object.freeze({
  REQUIRED_ROBLOX: "required_roblox",
  OPTIONAL_ROBLOX: "optional_roblox",
  PENDING: "pending",
  COOLDOWN: "cooldown",
  SUBMIT: "submit",
  DRAFT: "draft",
  PICKER: "picker",
});

function resolveOnboardBeginRoute(value = {}) {
  const state = value && typeof value === "object" ? value : {};
  const cooldownLeft = Math.max(0, Number(state.cooldownLeft) || 0);

  if (state.hasPendingProof) {
    return { type: ONBOARD_BEGIN_ROUTES.REQUIRED_ROBLOX, cooldownLeft };
  }

  if (state.hasPendingMissingRoblox) {
    return { type: ONBOARD_BEGIN_ROUTES.OPTIONAL_ROBLOX, cooldownLeft };
  }

  if (state.hasPendingSubmission) {
    return { type: ONBOARD_BEGIN_ROUTES.PENDING, cooldownLeft };
  }

  if (cooldownLeft > 0) {
    return { type: ONBOARD_BEGIN_ROUTES.COOLDOWN, cooldownLeft };
  }

  if (state.hasSubmitSession) {
    return { type: ONBOARD_BEGIN_ROUTES.SUBMIT, cooldownLeft };
  }

  if (state.hasMainDraft) {
    return { type: ONBOARD_BEGIN_ROUTES.DRAFT, cooldownLeft };
  }

  return { type: ONBOARD_BEGIN_ROUTES.PICKER, cooldownLeft };
}

module.exports = {
  ONBOARD_BEGIN_ROUTES,
  resolveOnboardBeginRoute,
};