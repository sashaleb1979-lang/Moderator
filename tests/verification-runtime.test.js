"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildDiscordOAuthAuthorizeUrl,
  createVerificationCallbackHandler,
  createVerificationCallbackServer,
  evaluateVerificationRisk,
  normalizeVerificationRuntimeConfig,
} = require("../src/verification/runtime");

function createMockCallbackServer() {
  const handlers = new Map();
  return {
    listening: false,
    once(event, handler) {
      handlers.set(event, handler);
    },
    off(event, handler) {
      if (handlers.get(event) === handler) {
        handlers.delete(event);
      }
    },
    emit(event, value) {
      const handler = handlers.get(event);
      if (event === "error") {
        handlers.delete(event);
      }
      if (typeof handler === "function") {
        handler(value);
      }
    },
    listen(_port, _host, callback) {
      this.listening = true;
      callback();
    },
    close(callback) {
      this.listening = false;
      callback(null);
    },
  };
}

function createResponseRecorder() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(value = "") {
      this.body = String(value || "");
    },
  };
}

test("normalizeVerificationRuntimeConfig derives callback path and listen defaults", () => {
  const config = normalizeVerificationRuntimeConfig({
    integration: {
      enabled: true,
      callbackBaseUrl: "https://verify.example.com/oauth/discord/callback",
    },
    env: {
      DISCORD_OAUTH_CLIENT_ID: "client-id",
      DISCORD_OAUTH_CLIENT_SECRET: "secret",
      PORT: "8080",
    },
  });

  assert.equal(config.enabled, true);
  assert.equal(config.clientId, "client-id");
  assert.equal(config.redirectUri, "https://verify.example.com/oauth/discord/callback");
  assert.equal(config.callbackPath, "/oauth/discord/callback");
  assert.equal(config.listenPort, 8080);
});

test("buildDiscordOAuthAuthorizeUrl shapes Discord authorize URL with state", () => {
  const url = new URL(buildDiscordOAuthAuthorizeUrl({
    integration: {
      enabled: true,
      callbackBaseUrl: "https://verify.example.com/oauth/discord/callback",
    },
    env: {
      DISCORD_OAUTH_CLIENT_ID: "client-id",
      DISCORD_OAUTH_CLIENT_SECRET: "secret",
      DISCORD_OAUTH_REDIRECT_URI: "https://verify.example.com/oauth/discord/callback",
    },
    state: "state-123",
  }));

  assert.equal(url.origin, "https://discord.com");
  assert.equal(url.pathname, "/oauth2/authorize");
  assert.equal(url.searchParams.get("client_id"), "client-id");
  assert.equal(url.searchParams.get("redirect_uri"), "https://verify.example.com/oauth/discord/callback");
  assert.equal(url.searchParams.get("scope"), "identify guilds");
  assert.equal(url.searchParams.get("state"), "state-123");
});

test("evaluateVerificationRisk flags enemy guild and user matches for manual review", () => {
  const result = evaluateVerificationRisk({
    oauthUser: { id: "user-1" },
    oauthGuilds: [
      { id: "guild-1", name: "Guild One", owner: true, permissions: "8" },
      { id: "guild-2", name: "Guild Two", permissions: "2048" },
    ],
    riskRules: {
      enemyGuildIds: ["guild-2"],
      enemyUserIds: ["user-1"],
      enemyInviteCodes: ["invite-1"],
    },
  });

  assert.deepEqual(result.observedGuildIds, ["guild-1", "guild-2"]);
  assert.deepEqual(result.observedGuilds, [
    { id: "guild-1", name: "Guild One", owner: true, permissions: "8" },
    { id: "guild-2", name: "Guild Two", owner: false, permissions: "2048" },
  ]);
  assert.deepEqual(result.matchedEnemyGuildIds, ["guild-2"]);
  assert.deepEqual(result.matchedEnemyUserIds, ["user-1"]);
  assert.deepEqual(result.matchedEnemyInviteCodes, ["invite-1"]);
  assert.equal(result.requiresManualReview, true);
  assert.equal(result.missingObservedGuilds, false);
});

test("evaluateVerificationRisk forces manual review when Discord OAuth returns no guilds", () => {
  const result = evaluateVerificationRisk({
    oauthUser: { id: "user-1" },
    oauthGuilds: [],
    riskRules: {},
  });

  assert.deepEqual(result.observedGuildIds, []);
  assert.equal(result.missingObservedGuilds, true);
  assert.equal(result.requiresManualReview, true);
});

test("evaluateVerificationRisk includes friend matches and suspicious account signals", () => {
  const result = evaluateVerificationRisk({
    oauthUser: { id: "175928847299117063" },
    oauthGuilds: [{ id: "safe-guild", name: "Safe Guild" }],
    oauthFriends: [{ id: "friend-1" }, { user: { id: "friend-2", username: "ally" } }],
    riskRules: {
      enemyFriendUserIds: ["friend-2"],
      suspiciousAccountUserIds: ["175928847299117063"],
      suspiciousOldAccountDays: 1,
    },
  });

  assert.deepEqual(result.observedFriendIds, ["friend-1", "friend-2"]);
  assert.deepEqual(result.matchedEnemyFriendIds, ["friend-2"]);
  assert.equal(result.suspiciousSignals.includes("manual_suspicious_account_match"), true);
  assert.equal(result.suspiciousSignals.includes("old_discord_account"), true);
  assert.equal(result.requiresManualReview, true);
});

test("createVerificationCallbackHandler routes clean OAuth to ready-for-review callback", async () => {
  const approvals = [];
  const manualReviews = [];
  const failures = [];
  const handler = createVerificationCallbackHandler({
    config: {
      integration: {
        enabled: true,
        callbackBaseUrl: "https://verify.example.com/oauth/discord/callback",
      },
      env: {
        DISCORD_OAUTH_CLIENT_ID: "client-id",
        DISCORD_OAUTH_CLIENT_SECRET: "secret",
        DISCORD_OAUTH_REDIRECT_URI: "https://verify.example.com/oauth/discord/callback",
      },
    },
    consumeState: (state) => state === "good-state" ? {
      userId: "user-1",
      riskRules: {
        enemyGuildIds: ["enemy-guild"],
      },
    } : null,
    exchangeCode: async () => ({ access_token: "access-token" }),
    fetchIdentity: async () => ({
      user: { id: "user-1", username: "discord-user" },
      guilds: [{ id: "safe-guild", name: "Safe Guild" }],
    }),
    onApproved: async (payload) => {
      approvals.push(payload);
    },
    onManualReview: async (payload) => {
      manualReviews.push(payload);
    },
    onFailure: async (payload) => {
      failures.push(payload);
    },
  });

  const response = createResponseRecorder();
  const handled = await handler({ method: "GET", url: "/oauth/discord/callback?state=good-state&code=oauth-code" }, response);

  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].oauthUser.username, "discord-user");
  assert.equal(approvals[0].risk.requiresManualReview, false);
  assert.equal(manualReviews.length, 0);
  assert.equal(failures.length, 0);
  assert.match(response.body, /Проверка принята/);
  assert.match(response.body, /решение будет вынесено вручную/);
});

test("createVerificationCallbackHandler treats already-consumed state as idempotent success", async () => {
  const approvals = [];
  const manualReviews = [];
  const failures = [];
  const handler = createVerificationCallbackHandler({
    config: {
      integration: {
        enabled: true,
        callbackBaseUrl: "https://verify.example.com/oauth/discord/callback",
      },
      env: {
        DISCORD_OAUTH_CLIENT_ID: "client-id",
        DISCORD_OAUTH_CLIENT_SECRET: "secret",
        DISCORD_OAUTH_REDIRECT_URI: "https://verify.example.com/oauth/discord/callback",
      },
    },
    consumeState: () => ({
      userId: "user-1",
      alreadyConsumed: true,
      riskRules: {},
    }),
    onApproved: async (payload) => {
      approvals.push(payload);
    },
    onManualReview: async (payload) => {
      manualReviews.push(payload);
    },
    onFailure: async (payload) => {
      failures.push(payload);
    },
  });

  const response = createResponseRecorder();
  const handled = await handler({ method: "GET", url: "/oauth/discord/callback?state=good-state&code=oauth-code" }, response);

  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  assert.equal(approvals.length, 0);
  assert.equal(manualReviews.length, 0);
  assert.equal(failures.length, 0);
  assert.match(response.body, /Проверка уже обработана/);
});

test("createVerificationCallbackHandler routes risky OAuth result into manual review", async () => {
  const manualReviews = [];
  const handler = createVerificationCallbackHandler({
    config: {
      integration: {
        enabled: true,
        callbackBaseUrl: "https://verify.example.com/oauth/discord/callback",
      },
      env: {
        DISCORD_OAUTH_CLIENT_ID: "client-id",
        DISCORD_OAUTH_CLIENT_SECRET: "secret",
        DISCORD_OAUTH_REDIRECT_URI: "https://verify.example.com/oauth/discord/callback",
      },
    },
    consumeState: () => ({
      userId: "user-1",
      riskRules: {
        enemyGuildIds: ["enemy-guild"],
      },
    }),
    exchangeCode: async () => ({ access_token: "access-token" }),
    fetchIdentity: async () => ({
      user: { id: "user-1", username: "discord-user" },
      guilds: [{ id: "enemy-guild", name: "Enemy Guild" }],
    }),
    onManualReview: async (payload) => {
      manualReviews.push(payload);
    },
  });

  const response = createResponseRecorder();
  await handler({ method: "GET", url: "/oauth/discord/callback?state=good-state&code=oauth-code" }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(manualReviews.length, 1);
  assert.equal(manualReviews[0].risk.requiresManualReview, true);
  assert.deepEqual(manualReviews[0].risk.matchedEnemyGuildIds, ["enemy-guild"]);
  assert.match(response.body, /ручной проверки/);
});

test("createVerificationCallbackHandler routes empty OAuth guild list into manual review", async () => {
  const approvals = [];
  const manualReviews = [];
  const failures = [];
  const handler = createVerificationCallbackHandler({
    config: {
      integration: {
        enabled: true,
        callbackBaseUrl: "https://verify.example.com/oauth/discord/callback",
      },
      env: {
        DISCORD_OAUTH_CLIENT_ID: "client-id",
        DISCORD_OAUTH_CLIENT_SECRET: "secret",
        DISCORD_OAUTH_REDIRECT_URI: "https://verify.example.com/oauth/discord/callback",
      },
    },
    consumeState: () => ({
      userId: "user-1",
      riskRules: {},
    }),
    exchangeCode: async () => ({ access_token: "access-token" }),
    fetchIdentity: async () => ({
      user: { id: "user-1", username: "discord-user" },
      guilds: [],
    }),
    onApproved: async (payload) => {
      approvals.push(payload);
    },
    onManualReview: async (payload) => {
      manualReviews.push(payload);
    },
    onFailure: async (payload) => {
      failures.push(payload);
    },
  });

  const response = createResponseRecorder();
  await handler({ method: "GET", url: "/oauth/discord/callback?state=good-state&code=oauth-code" }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(approvals.length, 0);
  assert.equal(manualReviews.length, 1);
  assert.equal(manualReviews[0].risk.missingObservedGuilds, true);
  assert.equal(failures.length, 0);
  assert.match(response.body, /ручной проверки/);
});

test("createVerificationCallbackHandler reports missing state through onFailure", async () => {
  const failures = [];
  const handler = createVerificationCallbackHandler({
    config: {
      integration: {
        enabled: true,
        callbackBaseUrl: "https://verify.example.com/oauth/discord/callback",
      },
      env: {
        DISCORD_OAUTH_CLIENT_ID: "client-id",
        DISCORD_OAUTH_CLIENT_SECRET: "secret",
        DISCORD_OAUTH_REDIRECT_URI: "https://verify.example.com/oauth/discord/callback",
      },
    },
    onFailure: async (payload) => {
      failures.push(payload);
    },
  });

  const response = createResponseRecorder();
  const handled = await handler({ method: "GET", url: "/oauth/discord/callback" }, response);

  assert.equal(handled, true);
  assert.equal(response.statusCode, 400);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].state, "");
  assert.match(String(failures[0].error?.message || failures[0].error), /OAuth state отсутствует/);
  assert.match(response.body, /OAuth state отсутствует/);
});

test("createVerificationCallbackServer starts once, reports already-listening state, and stops cleanly", async () => {
  let createdServer = null;
  const runtime = createVerificationCallbackServer({
    config: {
      integration: {
        enabled: true,
        callbackBaseUrl: "https://verify.example.com/oauth/discord/callback",
      },
      env: {
        VERIFICATION_PORT: "3015",
      },
    },
    createServer: () => {
      createdServer = createMockCallbackServer();
      return createdServer;
    },
    requestHandler: async () => true,
  });

  const firstStart = await runtime.start();
  const secondStart = await runtime.start();
  const stopResult = await runtime.stop();
  const secondStop = await runtime.stop();

  assert.equal(firstStart.started, true);
  assert.equal(runtime.isListening(), false);
  assert.equal(secondStart.started, false);
  assert.equal(secondStart.alreadyListening, true);
  assert.equal(stopResult.stopped, true);
  assert.equal(secondStop.stopped, false);
  assert.equal(createdServer.listening, false);
});

test("createVerificationCallbackServer clears failed start state so stop stays harmless", async () => {
  const runtime = createVerificationCallbackServer({
    config: {
      integration: {
        enabled: true,
        callbackBaseUrl: "https://verify.example.com/oauth/discord/callback",
      },
      env: {
        VERIFICATION_PORT: "3016",
      },
    },
    createServer: () => {
      const server = createMockCallbackServer();
      server.listen = function listen() {
        this.emit("error", new Error("bind failed"));
      };
      server.close = function close(callback) {
        callback(new Error("close should not run after failed start"));
      };
      return server;
    },
    requestHandler: async () => true,
  });

  await assert.rejects(runtime.start(), /bind failed/);
  assert.equal(runtime.isListening(), false);
  await assert.doesNotReject(runtime.stop());
  assert.deepEqual(await runtime.stop(), { stopped: false });
});
