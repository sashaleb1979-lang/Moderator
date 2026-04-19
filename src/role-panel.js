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

const ROLE_PANEL_PICKER_PAGE_SIZE = 25;
const ROLE_PANEL_PICKER_SCOPES = Object.freeze({
  COMPOSE_CHANNEL: "compose_channel",
  COMPOSE_ROLE: "compose_role",
  COMPOSE_BUTTON_ROLE: "compose_button_role",
  CLEANUP_ROLE: "cleanup_role",
  COMBO_GUIDE_EDITOR_ROLE: "combo_guide_editor_role",
});

const ROLE_PANEL_MAX_BUTTONS = 20;

const ROLE_PANEL_AUTO_RESEND_INTERVALS = Object.freeze([
  { value: 0, label: "Выключено" },
  { value: 3600000, label: "Каждый час" },
  { value: 21600000, label: "Каждые 6 часов" },
  { value: 43200000, label: "Каждые 12 часов" },
  { value: 86400000, label: "Каждые 24 часа" },
]);

const ROLE_PANEL_AUTO_RESEND_TICK_MS = 5 * 60 * 1000;

function trimText(value, limit = 4000) {
  return String(value || "").trim().slice(0, limit);
}

function normalizeRoleButton(rawValue = {}, options = {}) {
  const defaultLabel = trimText(options.defaultButtonLabel || DEFAULT_ROLE_PANEL_BUTTON_LABEL, 80) || DEFAULT_ROLE_PANEL_BUTTON_LABEL;
  return {
    roleId: trimText(rawValue?.roleId, 40),
    label: trimText(rawValue?.label, 80) || defaultLabel,
  };
}

function normalizeRoleButtons(rawValue, options = {}) {
  if (!Array.isArray(rawValue) || rawValue.length === 0) return [];
  return rawValue
    .slice(0, ROLE_PANEL_MAX_BUTTONS)
    .map((b) => normalizeRoleButton(b, options))
    .filter((b) => b.roleId);
}

function normalizeRoleMessageDraft(rawValue = {}, options = {}) {
  const defaultButtonLabel = trimText(options.defaultButtonLabel || DEFAULT_ROLE_PANEL_BUTTON_LABEL, 80) || DEFAULT_ROLE_PANEL_BUTTON_LABEL;
  const format = rawValue?.format === ROLE_PANEL_FORMATS.EMBED ? ROLE_PANEL_FORMATS.EMBED : ROLE_PANEL_FORMATS.PLAIN;

  let buttons = normalizeRoleButtons(rawValue?.buttons, options);
  if (buttons.length === 0 && rawValue?.roleId) {
    buttons = [{ roleId: trimText(rawValue.roleId, 40), label: trimText(rawValue.buttonLabel, 80) || defaultButtonLabel }];
  }

  return {
    channelId: trimText(rawValue?.channelId, 40),
    format,
    content: trimText(rawValue?.content, 4000),
    embedTitle: trimText(rawValue?.embedTitle, 256),
    embedDescription: trimText(rawValue?.embedDescription, 4000),
    buttons,
    editingButtonIndex: Number.isInteger(rawValue?.editingButtonIndex) ? Number(rawValue.editingButtonIndex) : -1,
    autoResendIntervalMs: Math.max(0, Number(rawValue?.autoResendIntervalMs) || 0),
  };
}

function validateRoleMessageDraft(rawValue = {}, options = {}) {
  const draft = normalizeRoleMessageDraft(rawValue, options);
  const errors = [];

  if (!draft.channelId) errors.push("channelId");
  if (!draft.buttons.length) errors.push("buttons");

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

function buildRoleGrantCustomId(recordId, buttonIndex = 0) {
  const id = trimText(recordId, 64);
  return id ? `rolepanel_grant:${id}:${Number(buttonIndex) || 0}` : "";
}

function parseRoleGrantCustomId(customId) {
  const value = trimText(customId, 120);
  if (!value.startsWith("rolepanel_grant:")) return null;
  const rest = value.slice("rolepanel_grant:".length);
  const sepIdx = rest.lastIndexOf(":");
  if (sepIdx === -1) {
    const recordId = rest.trim();
    return recordId ? { recordId, buttonIndex: 0 } : null;
  }
  const recordId = rest.slice(0, sepIdx).trim();
  const buttonIndex = Number(rest.slice(sepIdx + 1)) || 0;
  return recordId ? { recordId, buttonIndex } : null;
}

function normalizeRoleGrantRecord(rawValue = {}, options = {}) {
  const id = trimText(rawValue?.id, 64);
  const channelId = trimText(rawValue?.channelId, 40);
  const messageId = trimText(rawValue?.messageId, 40);
  const createdBy = trimText(rawValue?.createdBy, 40);
  const createdAt = trimText(rawValue?.createdAt, 64);
  const disabledAt = trimText(rawValue?.disabledAt, 64);
  const disabledReason = trimText(rawValue?.disabledReason, 300);
  const autoResendIntervalMs = Math.max(0, Number(rawValue?.autoResendIntervalMs) || 0);
  const lastAutoResendAt = trimText(rawValue?.lastAutoResendAt, 64);
  const draft = normalizeRoleMessageDraft(rawValue, options);

  if (!id || !channelId || !messageId || !draft.buttons.length) return null;

  return {
    id,
    channelId,
    messageId,
    buttons: draft.buttons,
    format: draft.format,
    content: draft.content,
    embedTitle: draft.embedTitle,
    embedDescription: draft.embedDescription,
    createdBy,
    createdAt,
    disabledAt,
    disabledReason,
    autoResendIntervalMs,
    lastAutoResendAt,
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
    .filter((record) => {
      if (activeOnly && record.disabledAt) return false;
      if (roleId && !record.buttons.some((b) => b.roleId === roleId)) return false;
      return true;
    })
    .sort((left, right) => Date.parse(right.createdAt || 0) - Date.parse(left.createdAt || 0));
}

function createRoleMessageDraftFromRecord(rawValue = {}, options = {}) {
  const record = normalizeRoleGrantRecord(rawValue, options);
  if (!record) return normalizeRoleMessageDraft({}, options);
  return normalizeRoleMessageDraft(record, options);
}

function normalizeRolePanelPickerState(rawValue = {}) {
  const rawScope = trimText(rawValue?.scope, 40);
  const scope = Object.values(ROLE_PANEL_PICKER_SCOPES).includes(rawScope)
    ? rawScope
    : ROLE_PANEL_PICKER_SCOPES.COMPOSE_CHANNEL;
  const page = Math.max(0, Number(rawValue?.page) || 0);

  return {
    scope,
    query: trimText(rawValue?.query, 80),
    page,
  };
}

function filterRolePanelPickerItems(items = [], rawQuery = "") {
  const query = trimText(rawQuery, 80).toLowerCase();
  if (!query) return [...items];

  const tokens = query.split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    const haystack = [item?.label, item?.description, item?.keywords, item?.id]
      .map((value) => String(value || "").toLowerCase())
      .join(" ");
    return tokens.every((token) => haystack.includes(token));
  });
}

function paginateRolePanelPickerItems(items = [], rawPage = 0, pageSize = ROLE_PANEL_PICKER_PAGE_SIZE) {
  const safePageSize = Math.max(1, Number(pageSize) || ROLE_PANEL_PICKER_PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(items.length / safePageSize));
  const page = Math.min(Math.max(0, Number(rawPage) || 0), pageCount - 1);
  const start = page * safePageSize;

  return {
    items: items.slice(start, start + safePageSize),
    totalCount: items.length,
    page,
    pageCount,
    hasPrev: page > 0,
    hasNext: page + 1 < pageCount,
  };
}

module.exports = {
  DEFAULT_ROLE_PANEL_BUTTON_LABEL,
  ROLE_PANEL_AUTO_RESEND_INTERVALS,
  ROLE_PANEL_AUTO_RESEND_TICK_MS,
  ROLE_PANEL_CLEANUP_BEHAVIORS,
  ROLE_PANEL_COMMAND_NAME,
  ROLE_PANEL_DRAFT_EXPIRE_MS,
  ROLE_PANEL_FORMATS,
  ROLE_PANEL_MAX_BUTTONS,
  ROLE_PANEL_PICKER_PAGE_SIZE,
  ROLE_PANEL_PICKER_SCOPES,
  buildRoleGrantCustomId,
  createRoleMessageDraftFromRecord,
  filterRolePanelPickerItems,
  getRoleGrantRecords,
  normalizeRoleButton,
  normalizeRoleButtons,
  normalizeRoleGrantRecord,
  normalizeRoleGrantRegistry,
  normalizeRoleMessageDraft,
  normalizeRolePanelPickerState,
  paginateRolePanelPickerItems,
  parseRoleGrantCustomId,
  validateRoleMessageDraft,
};