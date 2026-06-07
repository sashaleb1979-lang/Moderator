"use strict";

const DENY_ALLOWED_MENTIONS = Object.freeze({
  parse: [],
  users: [],
  roles: [],
  repliedUser: false,
});

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function withoutMentions(payload = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { content: cleanString(payload, 2000) || "", allowedMentions: DENY_ALLOWED_MENTIONS };
  }
  return {
    ...payload,
    allowedMentions: DENY_ALLOWED_MENTIONS,
  };
}

module.exports = {
  DENY_ALLOWED_MENTIONS,
  withoutMentions,
};
