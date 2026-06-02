"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
  buildAnalyticsRedirectUrl,
  createAnalyticsRedirectHandler,
} = require("../src/analytics/runtime");
const { createAnalyticsStore } = require("../src/analytics/store");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function makeStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "analytics-runtime-"));
  return createAnalyticsStore({ analyticsPath: path.join(dir, "analytics-db.json") });
}

function makeResponse() {
  const response = new EventEmitter();
  response.headers = {};
  response.setHeader = (key, value) => {
    response.headers[key] = value;
  };
  response.end = (body = "") => {
    response.body = body;
    response.emit("finish");
  };
  return response;
}

test("buildAnalyticsRedirectUrl creates persisted tokenized redirect URL", () => {
  const store = makeStore();
  const url = buildAnalyticsRedirectUrl({
    store,
    publicBaseUrl: "https://bot.example",
    targetUrl: "https://discord.com/channels/g/c/m",
    feature: "combo_guide",
    action: "open_character_anchor",
    targetKind: "character_anchor",
  });

  assert.match(url, /^https:\/\/bot\.example\/a\/r\/[A-Za-z0-9_-]+$/);
  const token = url.split("/").at(-1);
  assert.equal(store.resolveRedirect(token).targetUrl, "https://discord.com/channels/g/c/m");
});

test("analytics redirect handler records anonymous click and redirects", async () => {
  const store = makeStore();
  const url = buildAnalyticsRedirectUrl({
    store,
    publicBaseUrl: "https://bot.example",
    targetUrl: "https://discord.com/channels/g/c/m",
    feature: "tierlist",
    action: "open_text_tierlist",
    targetKind: "text_tierlist_summary",
  });
  const token = url.split("/").at(-1);
  const handler = createAnalyticsRedirectHandler({
    store,
    publicBaseUrl: "https://bot.example",
  });
  const response = makeResponse();

  const handled = await handler({
    method: "GET",
    url: `/a/r/${token}`,
    headers: { "user-agent": "node-test" },
  }, response);

  assert.equal(handled, true);
  assert.equal(response.statusCode, 302);
  assert.equal(response.headers.Location, "https://discord.com/channels/g/c/m");
  assert.equal(store.resolveRedirect(token).clickCount, 1);
  const event = store.getState().events[0];
  assert.equal(event.feature, "tierlist");
  assert.equal(event.action, "redirect");
  assert.equal(event.actorUserId, "");
  assert.equal(event.metadata.targetKind, "text_tierlist_summary");
});

test("analytics redirect handler ignores unrelated routes", async () => {
  const store = makeStore();
  const handler = createAnalyticsRedirectHandler({
    store,
    publicBaseUrl: "https://bot.example",
  });
  const response = makeResponse();

  const handled = await handler({ method: "GET", url: "/verification/callback" }, response);

  assert.equal(handled, false);
  assert.equal(response.statusCode, undefined);
});
