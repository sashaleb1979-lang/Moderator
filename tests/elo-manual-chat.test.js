"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { parseLegacyEloManualChatInput } = require("../src/integrations/elo-manual-chat");

test("parseLegacyEloManualChatInput extracts mention and leaves only elo text", () => {
  const result = parseLegacyEloManualChatInput("<@123456789012345678> 110 elo");

  assert.equal(result.explicitUserId, "123456789012345678");
  assert.equal(result.targetUserId, "123456789012345678");
  assert.equal(result.rawText, "110 elo");
});

test("parseLegacyEloManualChatInput extracts plain user id token", () => {
  const result = parseLegacyEloManualChatInput("123456789012345678 73");

  assert.equal(result.explicitUserId, "123456789012345678");
  assert.equal(result.targetUserId, "123456789012345678");
  assert.equal(result.rawText, "73");
});

test("parseLegacyEloManualChatInput keeps fallback user when chat message has only elo text", () => {
  const result = parseLegacyEloManualChatInput("110 elo", "999999999999999999");

  assert.equal(result.explicitUserId, "");
  assert.equal(result.targetUserId, "999999999999999999");
  assert.equal(result.rawText, "110 elo");
});