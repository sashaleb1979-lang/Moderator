"use strict";

function resolveNonJjsCaptchaMode(flags = {}) {
  const hasTierRole = Boolean(flags.hasTierRole);
  const hasAccessRole = Boolean(flags.hasAccessRole);
  const hasNonJjsRole = Boolean(flags.hasNonJjsRole);
  const isPractice = hasTierRole || hasAccessRole || hasNonJjsRole;

  return {
    mode: isPractice ? "practice" : "grant",
    isPractice,
    hasTierRole,
    hasAccessRole,
    hasNonJjsRole,
  };
}

module.exports = {
  resolveNonJjsCaptchaMode,
};
