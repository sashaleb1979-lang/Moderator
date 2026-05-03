"use strict";

function cleanText(value, limit = 200) {
  return String(value ?? "").trim().slice(0, limit);
}

function normalizeManagedCharacterId(value, fallback = "") {
  const text = cleanText(value, 120).toLowerCase();
  const normalized = text.replace(/[^a-zа-яё0-9]+/gi, "_").replace(/^_+|_+$/g, "");
  return normalized || cleanText(fallback, 120);
}

function normalizeManagedCharacterCatalog(characters = []) {
  const out = [];
  const seen = new Set();

  for (const entry of Array.isArray(characters) ? characters : []) {
    const label = cleanText(entry?.label || entry?.name || entry?.id, 120);
    const id = normalizeManagedCharacterId(entry?.id || label, `char_${out.length + 1}`);
    const roleId = cleanText(entry?.roleId, 80);
    if (!label || !id || seen.has(id)) continue;

    seen.add(id);
    out.push({ id, label, roleId });
  }

  return out;
}

function buildManagedCharacterEntries({ managedCharacters = [], generatedRoleIds = {} } = {}) {
  const generated = generatedRoleIds && typeof generatedRoleIds === "object" ? generatedRoleIds : {};

  return normalizeManagedCharacterCatalog(managedCharacters).map((entry) => ({
    id: entry.id,
    label: entry.label,
    roleId: cleanText(entry.roleId, 80) || cleanText(generated?.[entry.id], 80),
  }));
}

module.exports = {
  buildManagedCharacterEntries,
  normalizeManagedCharacterCatalog,
};