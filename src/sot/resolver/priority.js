"use strict";

const { normalizeRecord } = require("../schema");

function selectPreferredRecord(layers = [], fallbackSource = "default") {
  for (const layer of Array.isArray(layers) ? layers : []) {
    const normalized = normalizeRecord(layer, fallbackSource);
    if (normalized) return normalized;
  }
  return null;
}

module.exports = {
  selectPreferredRecord,
};