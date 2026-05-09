"use strict";

function normalizeNumericCandidate(value) {
  return String(value || "").replace(/[^\d]+/g, "");
}

function parseKillsFromSubmittedText(input) {
  const text = String(input || "").trim();
  if (!text) return { kills: null, reason: "missing" };

  const matches = text.match(/\d(?:[\d\s,._]*\d)?/g) || [];
  const candidates = [...new Set(matches.map((value) => normalizeNumericCandidate(value)).filter(Boolean))];

  if (!candidates.length) return { kills: null, reason: "missing" };
  if (candidates.length > 1) {
    return {
      kills: null,
      reason: "ambiguous",
      candidates,
    };
  }

  const value = Number(candidates[0]);
  if (!Number.isSafeInteger(value) || value < 0) return { kills: null, reason: "invalid" };
  return { kills: value, reason: null };
}

function resolveEffectiveSubmittedKills(input, suggestedKills = null) {
  const result = parseKillsFromSubmittedText(input);
  const effectiveKills = result.kills !== null
    ? result.kills
    : result.reason === "missing" && Number.isSafeInteger(suggestedKills)
      ? suggestedKills
      : null;

  return {
    ...result,
    effectiveKills,
  };
}

function normalizeMainCharacterIds(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  )].slice(0, 2);
}

function resolveResumableMainCharacterIds({ storedMainCharacterIds = [], liveMainCharacterIds = [] } = {}) {
  const stored = normalizeMainCharacterIds(storedMainCharacterIds);
  if (stored.length) return stored;
  return normalizeMainCharacterIds(liveMainCharacterIds);
}

module.exports = {
  parseKillsFromSubmittedText,
  resolveEffectiveSubmittedKills,
  resolveResumableMainCharacterIds,
};
