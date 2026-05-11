"use strict";

const http = require("node:http");

const DISCORD_API_BASE_URL = "https://discord.com/api/v10";
const VERIFICATION_OAUTH_SCOPES = ["identify", "guilds"];

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function normalizeStringArray(value, limit = 100, itemLimit = 120) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => cleanString(entry, itemLimit)).filter(Boolean))].slice(0, limit);
}

function formatLogToken(value, limit = 12) {
  const text = cleanString(value, 200);
  if (!text) return "missing";
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function getCallbackPath(value) {
  const text = cleanString(value, 500);
  if (!text) return "/verification/callback";

  try {
    const url = new URL(text);
    return cleanString(url.pathname, 200) || "/verification/callback";
  } catch {
    return text.startsWith("/") ? text : `/${text}`;
  }
}

function normalizeVerificationRuntimeConfig(options = {}) {
  const source = options && typeof options === "object" && !Array.isArray(options) ? options : {};
  const integration = source.integration && typeof source.integration === "object" && !Array.isArray(source.integration)
    ? source.integration
    : {};
  const env = source.env && typeof source.env === "object" ? source.env : process.env;
  const callbackBaseUrl = cleanString(
    source.callbackBaseUrl
    || env.DISCORD_OAUTH_REDIRECT_URI
    || integration.callbackBaseUrl,
    500
  );
  const callbackPath = getCallbackPath(callbackBaseUrl || source.callbackPath || env.VERIFICATION_CALLBACK_PATH);
  const explicitPort = Number(env.VERIFICATION_PORT || env.PORT || 0);

  return {
    enabled: integration.enabled === true,
    clientId: cleanString(env.DISCORD_OAUTH_CLIENT_ID, 120),
    clientSecret: cleanString(env.DISCORD_OAUTH_CLIENT_SECRET, 200),
    redirectUri: callbackBaseUrl,
    callbackBaseUrl,
    callbackPath,
    listenHost: cleanString(env.VERIFICATION_HOST, 120) || "0.0.0.0",
    listenPort: Number.isSafeInteger(explicitPort) && explicitPort > 0 ? explicitPort : 3000,
    scopes: [...VERIFICATION_OAUTH_SCOPES],
  };
}

function buildDiscordOAuthAuthorizeUrl(options = {}) {
  const config = normalizeVerificationRuntimeConfig(options);
  if (!config.clientId) {
    throw new Error("DISCORD_OAUTH_CLIENT_ID не настроен.");
  }
  if (!config.redirectUri) {
    throw new Error("DISCORD_OAUTH_REDIRECT_URI не настроен.");
  }

  const state = cleanString(options.state, 200);
  if (!state) {
    throw new Error("OAuth state обязателен.");
  }

  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", config.scopes.join(" "));
  url.searchParams.set("prompt", "none");
  url.searchParams.set("state", state);
  return url.toString();
}

function normalizeOauthGuildRecord(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    id: cleanString(source.id, 80),
    name: cleanString(source.name, 120),
    owner: source.owner === true,
    permissions: cleanString(source.permissions_new || source.permissions, 40),
  };
}

function evaluateVerificationRisk(options = {}) {
  const source = options && typeof options === "object" && !Array.isArray(options) ? options : {};
  const oauthUser = source.oauthUser && typeof source.oauthUser === "object" ? source.oauthUser : {};
  const oauthGuilds = Array.isArray(source.oauthGuilds) ? source.oauthGuilds : [];
  const riskRules = source.riskRules && typeof source.riskRules === "object" && !Array.isArray(source.riskRules)
    ? source.riskRules
    : {};

  const enemyGuildIds = new Set(normalizeStringArray(riskRules.enemyGuildIds, 200, 80));
  const enemyUserIds = new Set(normalizeStringArray(riskRules.enemyUserIds, 200, 80));
  const enemyInviteCodes = normalizeStringArray(riskRules.enemyInviteCodes, 200, 80);
  const enemyInviterUserIds = normalizeStringArray(riskRules.enemyInviterUserIds, 200, 80);

  const observedGuilds = oauthGuilds
    .map((entry) => normalizeOauthGuildRecord(entry))
    .filter((entry) => entry.id);
  const matchedEnemyGuildIds = observedGuilds
    .map((entry) => entry.id)
    .filter((guildId) => enemyGuildIds.has(guildId));
  const matchedEnemyUserIds = enemyUserIds.has(cleanString(oauthUser.id, 80))
    ? [cleanString(oauthUser.id, 80)]
    : [];

  return {
    observedGuilds,
    observedGuildIds: observedGuilds.map((entry) => entry.id),
    observedGuildNames: observedGuilds.map((entry) => entry.name).filter(Boolean),
    matchedEnemyGuildIds,
    matchedEnemyUserIds,
    matchedEnemyInviteCodes: enemyInviteCodes,
    matchedEnemyInviterUserIds: enemyInviterUserIds,
    missingObservedGuilds: observedGuilds.length === 0,
    requiresManualReview: observedGuilds.length === 0 || matchedEnemyGuildIds.length > 0 || matchedEnemyUserIds.length > 0 || enemyInviteCodes.length > 0 || enemyInviterUserIds.length > 0,
  };
}

async function exchangeDiscordOAuthCode(options = {}) {
  const fetchImpl = typeof options.fetchImpl === "function" ? options.fetchImpl : fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch API недоступен для Discord OAuth.");
  }

  const clientId = cleanString(options.clientId, 120);
  const clientSecret = cleanString(options.clientSecret, 200);
  const redirectUri = cleanString(options.redirectUri, 500);
  const code = cleanString(options.code, 200);

  if (!clientId || !clientSecret || !redirectUri || !code) {
    throw new Error("OAuth config/code заполнены не полностью.");
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });

  const response = await fetchImpl(`${DISCORD_API_BASE_URL}/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!response?.ok) {
    throw new Error(`Discord OAuth token exchange failed: HTTP ${response?.status || 0}`);
  }

  return response.json();
}

async function fetchDiscordOAuthIdentity(options = {}) {
  const fetchImpl = typeof options.fetchImpl === "function" ? options.fetchImpl : fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch API недоступен для Discord OAuth.");
  }

  const accessToken = cleanString(options.accessToken, 500);
  if (!accessToken) {
    throw new Error("OAuth access token отсутствует.");
  }

  async function fetchJson(url) {
    const response = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!response?.ok) {
      throw new Error(`Discord OAuth fetch failed: HTTP ${response?.status || 0}`);
    }
    return response.json();
  }

  const [user, guilds] = await Promise.all([
    fetchJson(`${DISCORD_API_BASE_URL}/users/@me`),
    fetchJson(`${DISCORD_API_BASE_URL}/users/@me/guilds`),
  ]);

  return {
    user,
    guilds: Array.isArray(guilds) ? guilds : [],
  };
}

function buildVerificationCallbackHtml(options = {}) {
  const title = cleanString(options.title, 120) || "Verification";
  const description = cleanString(options.description, 2000) || "Окно можно закрыть и вернуться в Discord.";
  const color = cleanString(options.color, 20) || "#1f6feb";

  return [
    "<!doctype html>",
    "<html lang=\"ru\">",
    "<head>",
    "<meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
    `<title>${title}</title>`,
    "</head>",
    `<body style=\"margin:0;font-family:Segoe UI,Arial,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px;\">`,
    `<main style=\"max-width:640px;background:#111827;border:1px solid #334155;border-radius:16px;padding:28px;box-shadow:0 20px 60px rgba(0,0,0,.35);\">`,
    `<h1 style=\"margin:0 0 12px;font-size:28px;color:${color};\">${title}</h1>`,
    `<p style=\"margin:0;font-size:16px;line-height:1.6;white-space:pre-line;\">${description}</p>`,
    "</main>",
    "</body>",
    "</html>",
  ].join("");
}

function writeHtmlResponse(response, statusCode, html) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(html);
}

function createVerificationCallbackHandler(options = {}) {
  const source = options && typeof options === "object" && !Array.isArray(options) ? options : {};
  const config = normalizeVerificationRuntimeConfig(source.config || source);
  const consumeState = typeof source.consumeState === "function" ? source.consumeState : (() => null);
  const exchangeCode = typeof source.exchangeCode === "function" ? source.exchangeCode : exchangeDiscordOAuthCode;
  const fetchIdentity = typeof source.fetchIdentity === "function" ? source.fetchIdentity : fetchDiscordOAuthIdentity;
  const onApproved = typeof source.onApproved === "function" ? source.onApproved : (async () => {});
  const onManualReview = typeof source.onManualReview === "function" ? source.onManualReview : (async () => {});
  const onFailure = typeof source.onFailure === "function" ? source.onFailure : (async () => {});

  return async function handleVerificationCallback(request, response) {
    const baseUrl = config.callbackBaseUrl || `http://${config.listenHost}:${config.listenPort}${config.callbackPath}`;
    const url = new URL(request.url || "/", baseUrl);

    if (url.pathname !== config.callbackPath) {
      writeHtmlResponse(response, 404, buildVerificationCallbackHtml({
        title: "Verification route not found",
        description: "Этот callback route не принадлежит verification-системе.",
        color: "#f97316",
      }));
      return false;
    }

    if (String(request.method || "GET").toUpperCase() !== "GET") {
      writeHtmlResponse(response, 405, buildVerificationCallbackHtml({
        title: "Method not allowed",
        description: "Verification callback принимает только GET-запросы.",
        color: "#f97316",
      }));
      return true;
    }

    const state = cleanString(url.searchParams.get("state"), 200);
    const code = cleanString(url.searchParams.get("code"), 200);
    const oauthError = cleanString(url.searchParams.get("error"), 200);
    let session = null;

    try {
      if (!state) {
        throw new Error("OAuth state отсутствует.");
      }

      session = await Promise.resolve(consumeState(state));
      if (!session || !cleanString(session.userId, 80)) {
        throw new Error("Verification session истекла или не найдена.");
      }

      if (oauthError) {
        throw new Error(`Discord OAuth returned error: ${oauthError}`);
      }
      if (!code) {
        throw new Error("OAuth code отсутствует.");
      }

      const token = await exchangeCode({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        redirectUri: config.redirectUri,
        code,
        fetchImpl: source.fetchImpl,
      });
      const identity = await fetchIdentity({
        accessToken: token.access_token,
        fetchImpl: source.fetchImpl,
      });
      const oauthUserId = cleanString(identity?.user?.id, 80);
      if (oauthUserId !== cleanString(session.userId, 80)) {
        throw new Error("OAuth account не совпадает с Discord участником verification session.");
      }

      const risk = evaluateVerificationRisk({
        oauthUser: identity.user,
        oauthGuilds: identity.guilds,
        riskRules: session.riskRules,
      });
      const payload = {
        session,
        oauthUser: identity.user,
        oauthGuilds: identity.guilds,
        token,
        risk,
      };

      if (risk.requiresManualReview) {
        console.log(`[verification-runtime] CALLBACK_MANUAL_REVIEW user=${cleanString(session.userId, 80) || "unknown"} state=${formatLogToken(state)} guilds=${risk.observedGuilds.length}`);
        await onManualReview(payload);
        writeHtmlResponse(response, 200, buildVerificationCallbackHtml({
          title: "Проверка отправлена модераторам",
          description: "OAuth завершён, но система пометила профиль для ручной проверки модератором. Вернись в Discord и жди решения.",
          color: "#f59e0b",
        }));
        return true;
      }

      console.log(`[verification-runtime] CALLBACK_READY_FOR_REVIEW user=${cleanString(session.userId, 80) || "unknown"} state=${formatLogToken(state)} guilds=${risk.observedGuilds.length}`);
      await onManualReview(payload);
      writeHtmlResponse(response, 200, buildVerificationCallbackHtml({
        title: "Проверка завершена",
        description: "OAuth успешно завершён. Данные уже отправлены модераторам, а доступ выдаётся только после их решения. Вернись в Discord и жди ответа.",
        color: "#2563eb",
      }));
      return true;
    } catch (error) {
      console.warn(`[verification-runtime] CALLBACK_FAILED user=${cleanString(session?.userId, 80) || "unknown"} state=${formatLogToken(state)} error=${cleanString(error?.message || error, 200) || "unknown"}`);
      await onFailure({ session, state, code, error });
      writeHtmlResponse(response, 400, buildVerificationCallbackHtml({
        title: "Проверка не завершена",
        description: cleanString(error?.message || error || "Не удалось завершить OAuth verification.", 2000),
        color: "#ef4444",
      }));
      return true;
    }
  };
}

function createVerificationCallbackServer(options = {}) {
  const source = options && typeof options === "object" && !Array.isArray(options) ? options : {};
  const config = normalizeVerificationRuntimeConfig(source.config || source);
  const requestHandler = typeof source.requestHandler === "function"
    ? source.requestHandler
    : createVerificationCallbackHandler(source);
  const createServerFn = typeof source.createServer === "function" ? source.createServer : http.createServer;
  let server = null;

  return {
    config,
    isListening() {
      return Boolean(server?.listening);
    },
    async start() {
      if (server?.listening) return { started: false, alreadyListening: true, config };
      server = createServerFn((request, response) => {
        Promise.resolve(requestHandler(request, response)).catch((error) => {
          response.statusCode = 500;
          response.setHeader("Content-Type", "text/plain; charset=utf-8");
          response.end(cleanString(error?.message || error || "Verification callback failed.", 2000));
        });
      });

      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.listenPort, config.listenHost, () => {
          server.off("error", reject);
          resolve();
        });
      });

      return { started: true, config };
    },
    async stop() {
      if (!server) return { stopped: false };
      const current = server;
      server = null;
      await new Promise((resolve, reject) => {
        current.close((error) => error ? reject(error) : resolve());
      });
      return { stopped: true };
    },
  };
}

module.exports = {
  DISCORD_API_BASE_URL,
  VERIFICATION_OAUTH_SCOPES,
  buildDiscordOAuthAuthorizeUrl,
  buildVerificationCallbackHtml,
  createVerificationCallbackHandler,
  createVerificationCallbackServer,
  evaluateVerificationRisk,
  exchangeDiscordOAuthCode,
  fetchDiscordOAuthIdentity,
  normalizeVerificationRuntimeConfig,
};