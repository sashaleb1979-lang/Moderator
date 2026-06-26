"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildCloseReviewPayload,
  buildTicketPublicPayload,
} = require("../src/antiteam/view");

function jsonOf(payload) {
  return JSON.stringify(payload.components.map((component) => component.toJSON()));
}

const ticket = {
  id: "ticket-1",
  kind: "standard",
  status: "open",
  createdBy: "author-1",
  level: "medium",
  count: "3-5",
  description: "Цели A/B.",
  roblox: { userId: "101", username: "Anchor" },
  helpers: {
    "h1": { userId: "h1", discordTag: "ccrymore.", displayName: "repka", robloxUsername: "23vovka", respondedAt: "2026-06-26T10:00:00.000Z", arrived: false },
    "h2": { userId: "h2", discordTag: "ron", displayName: "Ronald", robloxUsername: "Ronald47419", respondedAt: "2026-06-26T10:01:00.000Z", arrived: true },
  },
};

test("close-review button shows the server display name, not the raw username", () => {
  const json = jsonOf(buildCloseReviewPayload(ticket, 0));
  // The reviewer should see the same name the public mention renders ("repka"),
  // with the Roblox nick as the shared anchor between the two views.
  assert.match(json, /Не пришёл • repka \(23vovka\)/);
  assert.doesNotMatch(json, /ccrymore/);
});

test("closed public helper block shows the Roblox nick next to each mention", () => {
  const closed = { ...ticket, status: "closed", closeSummary: { confirmedHelperIds: ["h2"], text: "" } };
  const json = jsonOf(buildTicketPublicPayload(closed));
  // h1 was not confirmed -> ❌ with its nick so it cross-references the panel.
  assert.match(json, /❌ <@h1> \(23vovka\)/);
  assert.match(json, /✅ <@h2> \(Ronald47419\)/);
});
