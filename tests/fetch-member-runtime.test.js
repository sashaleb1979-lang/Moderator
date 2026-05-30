"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function loadParseGuildMemberFetchRetryAfterMs() {
  const source = fs.readFileSync(path.join(__dirname, "..", "welcome-bot.js"), "utf8");
  const startToken = "function parseGuildMemberFetchRetryAfterMs(error) {";
  const endToken = "\n\nfunction hasFreshLiveCharacterMemberSnapshot";
  const startIndex = source.indexOf(startToken);
  const endIndex = source.indexOf(endToken, startIndex);

  assert.ok(startIndex >= 0 && endIndex > startIndex, "expected to find parseGuildMemberFetchRetryAfterMs in welcome-bot.js");
  const functionSource = source.slice(startIndex, endIndex).trimEnd();
  return new Function(`return (${functionSource});`)();
}

function loadFetchMember() {
  const source = fs.readFileSync(path.join(__dirname, "..", "welcome-bot.js"), "utf8");
  const startToken = "async function fetchMember(client, userId) {";
  const endToken = "\nasync function syncProfileNamesFromDiscord(client) {";
  const startIndex = source.indexOf(startToken);
  const endIndex = source.indexOf(endToken, startIndex);

  assert.ok(startIndex >= 0 && endIndex > startIndex, "expected to find fetchMember in welcome-bot.js");
  const functionSource = source.slice(startIndex, endIndex).trimEnd();
  return new Function(
    "getGuild",
    "parseGuildMemberFetchRetryAfterMs",
    `return (${functionSource});`
  );
}

test("fetchMember returns cached guild member without hitting the API", async () => {
  const parseRetryAfter = loadParseGuildMemberFetchRetryAfterMs();
  const buildFetchMember = loadFetchMember();
  const cachedMember = { id: "user-1" };
  let fetchCalls = 0;
  const guild = {
    members: {
      cache: new Map([["user-1", cachedMember]]),
      fetch: async () => {
        fetchCalls += 1;
        return null;
      },
    },
  };
  const fetchMember = buildFetchMember(async () => guild, parseRetryAfter);

  const result = await fetchMember({}, "user-1");

  assert.equal(result, cachedMember);
  assert.equal(fetchCalls, 0);
});

test("fetchMember waits out a member-fetch rate limit and retries once", async () => {
  const parseRetryAfter = loadParseGuildMemberFetchRetryAfterMs();
  const buildFetchMember = loadFetchMember();
  const capturedTimeouts = [];
  const originalSetTimeout = global.setTimeout;
  let fetchCalls = 0;
  const fetchedMember = { id: "user-2" };
  const guild = {
    members: {
      cache: new Map(),
      fetch: async () => {
        fetchCalls += 1;
        if (fetchCalls === 1) {
          throw new Error("Request with opcode 8 was rate limited. Retry after 20.419 seconds.");
        }
        return fetchedMember;
      },
    },
  };
  const fetchMember = buildFetchMember(async () => guild, parseRetryAfter);

  global.setTimeout = (callback, delay, ...args) => {
    capturedTimeouts.push(delay);
    callback(...args);
    return 0;
  };

  try {
    const result = await fetchMember({}, "user-2");
    assert.equal(result, fetchedMember);
  } finally {
    global.setTimeout = originalSetTimeout;
  }

  assert.equal(fetchCalls, 2);
  assert.deepEqual(capturedTimeouts, [20420]);
});
