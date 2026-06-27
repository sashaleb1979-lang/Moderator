"use strict";

function letterForIndex(value) {
  let index = Math.max(0, Math.floor(Number(value) || 0));
  let out = "";
  do {
    out = String.fromCharCode(65 + (index % 26)) + out;
    index = Math.floor(index / 26) - 1;
  } while (index >= 0);
  return out;
}

function prosieveLabel(index, { lower = false, start = false } = {}) {
  const label = `${lower ? "просев" : "Просев"} ${letterForIndex(index)}`;
  return start ? `${label} · старт` : label;
}

function finalLabel({ lower = false, start = false } = {}) {
  const label = lower ? "финал" : "Финал";
  return start ? `${label} · старт` : label;
}

function branchLabel(index, options = {}) {
  return Number(index) >= 90 ? finalLabel(options) : prosieveLabel(index, options);
}

module.exports = {
  branchLabel,
  finalLabel,
  letterForIndex,
  prosieveLabel,
};
