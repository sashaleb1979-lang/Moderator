"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  RobloxApiError,
  buildRobloxProfileUrl,
  createRobloxApiClient,
  normalizeRobloxFriendRecord,
  normalizeRobloxPresenceRecord,
  normalizeRobloxUserProfile,
  splitIntoBatches,
} = require("../src/integrations/roblox-service");

test("buildRobloxProfileUrl formats canonical profile links", () => {
  assert.equal(buildRobloxProfileUrl(123456), "https://www.roblox.com/users/123456/profile");
  assert.equal(buildRobloxProfileUrl(""), null);
});

test("splitIntoBatches keeps all ids reachable in stable chunks", () => {
  assert.deepEqual(splitIntoBatches([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test("normalizeRobloxUserProfile maps the public user shape into canonical fields", () => {
  assert.deepEqual(normalizeRobloxUserProfile({
    id: 1,
    name: "Roblox",
    displayName: "Roblox",
    description: "Welcome",
    created: "2006-02-27T21:06:40.300Z",
    isBanned: false,
    hasVerifiedBadge: true,
  }), {
    userId: 1,
    username: "Roblox",
    displayName: "Roblox",
    description: "Welcome",
    createdAt: "2006-02-27T21:06:40.300Z",
    isBanned: false,
    hasVerifiedBadge: true,
    profileUrl: "https://www.roblox.com/users/1/profile",
  });
});

test("normalizeRobloxFriendRecord keeps social richness including frequents", () => {
  assert.deepEqual(normalizeRobloxFriendRecord({
    id: 55,
    name: "GojoMain",
    displayName: "Gojo",
    isOnline: true,
    presenceType: 2,
    friendFrequentScore: 88,
    friendFrequentRank: 3,
    hasVerifiedBadge: false,
  }), {
    userId: 55,
    username: "GojoMain",
    displayName: "Gojo",
    description: null,
    createdAt: null,
    isBanned: false,
    hasVerifiedBadge: false,
    isOnline: true,
    presenceType: "in_game",
    friendFrequentScore: 88,
    friendFrequentRank: 3,
  });
});

test("normalizeRobloxPresenceRecord maps JJS-relevant fields from presence", () => {
  assert.deepEqual(normalizeRobloxPresenceRecord({
    userId: 10,
    userPresenceType: 2,
    lastLocation: "Jujutsu Shinigans",
    placeId: 111,
    rootPlaceId: 222,
    gameId: "session-1",
    universeId: 333,
  }), {
    userId: 10,
    presenceType: "in_game",
    lastLocation: "Jujutsu Shinigans",
    placeId: 111,
    rootPlaceId: 222,
    gameId: "session-1",
    universeId: 333,
  });
});

test("createRobloxApiClient shapes username and presence requests and normalizes responses", async () => {
  const calls = [];
  const client = createRobloxApiClient({
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      if (String(url).includes("/v1/usernames/users")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            data: [{ id: 1, name: "RynexV", displayName: "Rynex", hasVerifiedBadge: true }],
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          userPresences: [{ userId: 1, userPresenceType: 2, placeId: 10, rootPlaceId: 20, gameId: "g-1", universeId: 30 }],
        }),
      };
    },
  });

  const users = await client.fetchUsersByUsernames(["RynexV", "rynexv", " "]);
  const presences = await client.fetchUserPresences([1, 1, 2]);

  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /users\.roblox\.com\/v1\/usernames\/users$/);
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    usernames: ["RynexV"],
    excludeBannedUsers: false,
  });
  assert.match(calls[1].url, /presence\.roblox\.com\/v1\/presence\/users$/);
  assert.deepEqual(JSON.parse(calls[1].init.body), { userIds: [1, 2] });
  assert.equal(users[0].username, "RynexV");
  assert.equal(users[0].profileUrl, "https://www.roblox.com/users/1/profile");
  assert.equal(presences[0].presenceType, "in_game");
});

test("createRobloxApiClient throws RobloxApiError with upstream details on failure", async () => {
  const client = createRobloxApiClient({
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      text: async () => JSON.stringify({ errors: [{ code: 9, message: "The flood limit has been exceeded." }] }),
    }),
  });

  await assert.rejects(
    () => client.fetchUserProfile(1),
    (error) => {
      assert.ok(error instanceof RobloxApiError);
      assert.equal(error.status, 429);
      assert.equal(error.code, 9);
      assert.match(error.message, /flood limit/i);
      return true;
    }
  );
});