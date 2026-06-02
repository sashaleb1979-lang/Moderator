"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildAnalyticsEventFromInteraction,
  classifyInteraction,
} = require("../src/analytics/catalog");

function button(customId) {
  return {
    customId,
    user: { id: "user-1" },
    guildId: "guild-1",
    channelId: "channel-1",
    message: { id: "message-1" },
    isChatInputCommand: () => false,
    isButton: () => true,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
  };
}

test("classifyInteraction maps profile navigation custom ids", () => {
  const classified = classifyInteraction(button("profile_nav:user-1:user-2:activity"));

  assert.equal(classified.feature, "profile");
  assert.equal(classified.action, "nav_activity");
  assert.equal(classified.targetUserId, "user-2");
  assert.equal(classified.metadata.view, "activity");
});

test("classifyInteraction maps antiteam and combo ids", () => {
  assert.deepEqual(classifyInteraction(button("at:leaders")).feature, "antiteam");
  assert.equal(classifyInteraction(button("at:ticket:help:ticket-1")).action, "ticket_help");
  assert.equal(classifyInteraction(button("combo_panel_refresh_nav")).feature, "combo_guide");
});

test("buildAnalyticsEventFromInteraction maps slash command subcommand", () => {
  const interaction = {
    commandName: "combo",
    user: { id: "user-1" },
    guildId: "guild-1",
    channelId: "channel-1",
    options: { getSubcommand: () => "panel" },
    isChatInputCommand: () => true,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
  };
  const event = buildAnalyticsEventFromInteraction(interaction);

  assert.equal(event.feature, "combo_guide");
  assert.equal(event.action, "slash_panel");
  assert.equal(event.actorUserId, "user-1");
  assert.equal(event.interactionType, "command");
});

test("buildAnalyticsEventFromInteraction maps role grant metadata", () => {
  const event = buildAnalyticsEventFromInteraction(button("rolepanel_grant:abc:2"));

  assert.equal(event.feature, "role_panel");
  assert.equal(event.action, "grant_role");
  assert.equal(event.metadata.recordId, "abc");
  assert.equal(event.metadata.buttonIndex, "2");
});
