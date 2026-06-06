"use strict";

const { cleanString } = require("./state");

const DEFAULT_ANALYTICS_REDIRECT_PREFIX = "/a/r";

function normalizeAnalyticsRuntimeConfig(options = {}) {
  const env = options.env && typeof options.env === "object" ? options.env : process.env;
  const publicBaseUrl = cleanString(options.publicBaseUrl || env.ANALYTICS_PUBLIC_BASE_URL, 500).replace(/\/+$/, "");
  const redirectPrefix = cleanString(options.redirectPrefix || env.ANALYTICS_REDIRECT_PREFIX || DEFAULT_ANALYTICS_REDIRECT_PREFIX, 120)
    .replace(/\/+$/, "") || DEFAULT_ANALYTICS_REDIRECT_PREFIX;
  const explicitPort = Number(env.ANALYTICS_PORT || env.VERIFICATION_PORT || env.PORT || 0);
  return {
    enabled: Boolean(publicBaseUrl),
    publicBaseUrl,
    redirectPrefix: redirectPrefix.startsWith("/") ? redirectPrefix : `/${redirectPrefix}`,
    listenHost: cleanString(env.ANALYTICS_HOST || env.VERIFICATION_HOST, 120) || "0.0.0.0",
    listenPort: Number.isSafeInteger(explicitPort) && explicitPort > 0 ? explicitPort : 3000,
  };
}

function buildAnalyticsRedirectUrl(options = {}) {
  const store = options.store;
  const config = normalizeAnalyticsRuntimeConfig(options.config || options);
  const targetUrl = cleanString(options.targetUrl, 2000);
  if (!store || !config.enabled || !targetUrl) return targetUrl;

  const redirect = store.ensureRedirect({
    targetUrl,
    feature: options.feature || "links",
    action: options.action || "open",
    targetKind: options.targetKind || "",
    metadata: options.metadata || {},
  });
  if (!redirect?.token) return targetUrl;
  return `${config.publicBaseUrl}${config.redirectPrefix}/${encodeURIComponent(redirect.token)}`;
}

function writeText(response, statusCode, text) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.end(text);
}

function createAnalyticsRedirectHandler(options = {}) {
  const store = options.store;
  const config = normalizeAnalyticsRuntimeConfig(options.config || options);

  return async function handleAnalyticsRedirect(request, response) {
    const baseUrl = config.publicBaseUrl || `http://${config.listenHost}:${config.listenPort}`;
    const url = new URL(request.url || "/", baseUrl);
    const prefix = config.redirectPrefix.replace(/\/+$/, "");
    if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) {
      return false;
    }

    if (String(request.method || "GET").toUpperCase() !== "GET") {
      writeText(response, 405, "Analytics redirect accepts only GET requests.");
      return true;
    }

    const token = cleanString(decodeURIComponent(url.pathname.slice(prefix.length).replace(/^\/+/, "")), 120);
    if (!token || !store?.resolveRedirect) {
      writeText(response, 404, "Analytics redirect not found.");
      return true;
    }

    const redirect = store.resolveRedirect(token);
    if (!redirect?.targetUrl) {
      writeText(response, 404, "Analytics redirect not found.");
      return true;
    }

    store.recordRedirectClick(token, {
      guildId: cleanString(url.searchParams.get("guild_id"), 80),
      channelId: cleanString(url.searchParams.get("channel_id"), 80) || cleanString(redirect.metadata?.channelId, 80),
      messageId: cleanString(url.searchParams.get("message_id"), 80) || cleanString(redirect.metadata?.messageId, 80),
      metadata: {
        userAgent: cleanString(request.headers?.["user-agent"], 300),
      },
    });

    response.statusCode = 302;
    response.setHeader("Location", redirect.targetUrl);
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.end("Redirecting...");
    return true;
  };
}

module.exports = {
  DEFAULT_ANALYTICS_REDIRECT_PREFIX,
  buildAnalyticsRedirectUrl,
  createAnalyticsRedirectHandler,
  normalizeAnalyticsRuntimeConfig,
};
