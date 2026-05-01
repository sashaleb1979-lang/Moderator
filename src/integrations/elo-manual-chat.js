"use strict";

function cleanString(value, limit = 4000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function extractFirstUserReference(rawText = "") {
  const text = cleanString(rawText, 4000);
  if (!text) return { userId: "", token: "" };

  const mentionMatch = text.match(/<@!?(\d{5,25})>/);
  if (mentionMatch) {
    return {
      userId: mentionMatch[1],
      token: mentionMatch[0],
    };
  }

  const idMatch = text.match(/\b\d{15,25}\b/);
  if (idMatch) {
    return {
      userId: idMatch[0],
      token: idMatch[0],
    };
  }

  return { userId: "", token: "" };
}

function parseLegacyEloManualChatInput(rawValue, fallbackTargetUserId = "") {
  const originalText = cleanString(rawValue, 4000);
  const fallback = cleanString(fallbackTargetUserId, 80);
  const extracted = extractFirstUserReference(originalText);

  let rawText = originalText;
  if (extracted.token) {
    const tokenIndex = rawText.indexOf(extracted.token);
    if (tokenIndex >= 0) {
      rawText = `${rawText.slice(0, tokenIndex)} ${rawText.slice(tokenIndex + extracted.token.length)}`;
    }
  }

  rawText = rawText.replace(/\s+/g, " ").trim();

  return {
    originalText,
    explicitUserId: extracted.userId,
    targetUserId: extracted.userId || fallback,
    rawText,
  };
}

module.exports = {
  parseLegacyEloManualChatInput,
};