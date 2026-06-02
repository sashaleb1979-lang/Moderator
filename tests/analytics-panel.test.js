"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ANALYTICS_PANEL_BACK_ID,
  ANALYTICS_PANEL_BUTTON_IDS,
  buildAnalyticsPanelPayload,
  parseAnalyticsPanelViewCustomId,
} = require("../src/analytics/panel");
const { recordAnalyticsEvent } = require("../src/analytics/state");

function makeState() {
  let state = {};
  state = recordAnalyticsEvent(state, {
    id: "evt-1",
    at: "2026-06-02T10:00:00.000Z",
    feature: "profile",
    action: "open_card",
    actorUserId: "user-1",
  }).state;
  state = recordAnalyticsEvent(state, {
    id: "evt-2",
    at: "2026-06-02T10:01:00.000Z",
    feature: "combo_guide",
    action: "redirect",
    metadata: { redirect: true, targetUrl: "https://discord.com/channels/g/c/m" },
  }).state;
  return state;
}

test("buildAnalyticsPanelPayload renders overview with navigation buttons", () => {
  const payload = buildAnalyticsPanelPayload({
    state: makeState(),
    view: "overview",
    redirectEnabled: true,
  });
  const json = {
    embeds: payload.embeds.map((embed) => embed.toJSON()),
    components: payload.components.map((row) => row.toJSON()),
  };

  assert.match(json.embeds[0].description, /Всего событий: \*\*2\*\*/);
  assert.equal(json.components.length, 2);
  assert.equal(json.components[1].components[1].custom_id, ANALYTICS_PANEL_BACK_ID);
});

test("analytics panel supports feature and recent views", () => {
  const featurePayload = buildAnalyticsPanelPayload({ state: makeState(), view: "features", includeFlags: false });
  const recentPayload = buildAnalyticsPanelPayload({ state: makeState(), view: "recent", includeFlags: false });

  assert.equal(featurePayload.embeds[0].toJSON().title, "Analytics • Features");
  assert.equal(recentPayload.embeds[0].toJSON().title, "Analytics • Recent");
});

test("parseAnalyticsPanelViewCustomId and button id list include expected controls", () => {
  assert.equal(parseAnalyticsPanelViewCustomId("analytics_panel_view_users"), "users");
  assert.equal(parseAnalyticsPanelViewCustomId("analytics_panel_view_bad"), "overview");
  assert.equal(ANALYTICS_PANEL_BUTTON_IDS.includes("panel_open_analytics"), true);
});
