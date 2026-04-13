"use strict";

const ROLE_PANEL_COMMAND_NAME = "rolepanel";
const ROLE_PANEL_DRAFT_EXPIRE_MS = 15 * 60 * 1000;
const DEFAULT_ROLE_PANEL_BUTTON_LABEL = "Получить роль";
const ROLE_PANEL_FORMATS = Object.freeze({
  PLAIN: "plain",
  EMBED: "embed",
});

const ROLE_PANEL_CLEANUP_BEHAVIORS = Object.freeze({
  KEEP_MESSAGES: "keep_messages",
  DISABLE_MESSAGES: "disable_messages",
});

function trimText(value, limit = 4000) {
  return String(value || "").trim().slice(0, limit);
}

function normalizeRoleMessageDraft(rawValue = {}, options = {}) {
  const defaultButtonLabel = trimText(options.defaultButtonLabel || DEFAULT_ROLE_PANEL_BUTTON_LABEL, 80) || DEFAULT_ROLE_PANEL_BUTTON_LABEL;
  const format = rawValue?.format === ROLE_PANEL_FORMATS.EMBED ? ROLE_PANEL_FORMATS.EMBED : ROLE_PANEL_FORMATS.PLAIN;

  return {
    channelId: trimText(rawValue?.channelId, 40),
    roleId: trimText(rawValue?.roleId, 40),
    format,
    content: trimText(rawValue?.content, 4000),
    embedTitle: trimText(rawValue?.embedTitle, 256),
    embedDescription: trimText(rawValue?.embedDescription, 4000),
    buttonLabel: trimText(rawValue?.buttonLabel, 80) || defaultButtonLabel,
  };
}

function validateRoleMessageDraft(rawValue = {}, options = {}) {
  const draft = normalizeRoleMessageDraft(rawValue, options);
  const errors = [];

  if (!draft.channelId) errors.push("channelId");
  if (!draft.roleId) errors.push("roleId");
  if (!draft.buttonLabel) errors.push("buttonLabel");

  if (draft.format === ROLE_PANEL_FORMATS.EMBED) {
    if (!draft.embedTitle && !draft.embedDescription) errors.push("embedContent");
  } else if (!draft.content) {
    errors.push("content");
  }

  return {
    draft,
    errors,
    isValid: errors.length === 0,
  };
}

function buildRoleGrantCustomId(recordId) {
  const id = trimText(recordId, 64);
  return id ? `rolepanel_grant:${id}` : "";
}

function parseRoleGrantCustomId(customId) {
  const value = trimText(customId, 100);
  if (!value.startsWith("rolepanel_grant:")) return "";
  return value.slice("rolepanel_grant:".length).trim();
}

function normalizeRoleGrantRecord(rawValue = {}, options = {}) {
  const id = trimText(rawValue?.id, 64);
  const channelId = trimText(rawValue?.channelId, 40);
  const messageId = trimText(rawValue?.messageId, 40);
  const createdBy = trimText(rawValue?.createdBy, 40);
  const createdAt = trimText(rawValue?.createdAt, 64);
  const disabledAt = trimText(rawValue?.disabledAt, 64);
  const disabledReason = trimText(rawValue?.disabledReason, 300);
  const draft = normalizeRoleMessageDraft(rawValue, options);

  if (!id || !channelId || !messageId || !draft.roleId) return null;

  return {
    id,
    channelId,
    messageId,
    roleId: draft.roleId,
    format: draft.format,
    content: draft.content,
    embedTitle: draft.embedTitle,
    embedDescription: draft.embedDescription,
    buttonLabel: draft.buttonLabel,
    createdBy,
    createdAt,
    disabledAt,
    disabledReason,
  };
}

function normalizeRoleGrantRegistry(rawValue = {}, options = {}) {
  const source = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) ? rawValue : {};
  const registry = {};
  let mutated = !rawValue || typeof rawValue !== "object" || Array.isArray(rawValue);

  for (const [key, value] of Object.entries(source)) {
    const record = normalizeRoleGrantRecord({ id: key, ...value }, options);
    if (!record) {
      mutated = true;
      continue;
    }
    if (record.id !== key) mutated = true;
    registry[record.id] = record;
  }

  return { registry, mutated };
}

function getRoleGrantRecords(rawValue = {}, options = {}) {
  const roleId = trimText(options.roleId, 40);
  const activeOnly = options.activeOnly !== false;
  const { registry } = normalizeRoleGrantRegistry(rawValue, options);

  return Object.values(registry)
    .filter((record) => (!roleId || record.roleId === roleId) && (!activeOnly || !record.disabledAt))
    .sort((left, right) => Date.parse(right.createdAt || 0) - Date.parse(left.createdAt || 0));
}

function createRoleMessageDraftFromRecord(rawValue = {}, options = {}) {
  const record = normalizeRoleGrantRecord(rawValue, options);
  if (!record) return normalizeRoleMessageDraft({}, options);
  return normalizeRoleMessageDraft(record, options);
}

module.exports = {
  DEFAULT_ROLE_PANEL_BUTTON_LABEL,
  ROLE_PANEL_CLEANUP_BEHAVIORS,
  ROLE_PANEL_COMMAND_NAME,
  ROLE_PANEL_DRAFT_EXPIRE_MS,
  ROLE_PANEL_FORMATS,
  buildRoleGrantCustomId,
  createRoleMessageDraftFromRecord,
  getRoleGrantRecords,
  normalizeRoleGrantRecord,
  normalizeRoleGrantRegistry,
  normalizeRoleMessageDraft,
  parseRoleGrantCustomId,
  validateRoleMessageDraft,
};