"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { MessageFlags } = require("discord.js");
const {
  ANTITEAM_CUSTOM_IDS,
  buildCloseReviewPayload,
  buildModeratorPanelPayload,
  buildStartPanelPayload,
  buildThreadPanelPayload,
  buildTicketPublicPayload,
  buildTicketSetupPayload,
  ticketButtonId,
} = require("../src/antiteam/view");
const { normalizeAntiteamState } = require("../src/antiteam/state");

function payloadJson(payload) {
  return JSON.stringify(payload.components.map((component) => component.toJSON()));
}

test("start panel is Components V2 and exposes submit button", () => {
  const payload = buildStartPanelPayload({ battalionRoleId: "role-1" });

  assert.equal(payload.flags, MessageFlags.IsComponentsV2);
  assert.match(payloadJson(payload), /Антитим/);
  assert.match(payloadJson(payload), new RegExp(ANTITEAM_CUSTOM_IDS.open.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("draft setup renders level, count and toggles compactly", () => {
  const draft = {
    kind: "standard",
    userId: "user-1",
    roblox: { username: "Anchor", userId: "101" },
    level: "high",
    count: "4-10",
    directJoinEnabled: true,
    photoWanted: true,
  };
  const payload = buildTicketSetupPayload(draft, normalizeAntiteamState({}).config);
  const json = payloadJson(payload);

  assert.equal(payload.flags, MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
  assert.match(json, /Высокие/);
  assert.match(json, /4-10/);
  assert.match(json, /Вход без др: да/);
  assert.match(json, /Фото: да/);
});

test("public ticket and thread panel disable actions after close", () => {
  const ticket = {
    id: "ticket-1",
    kind: "standard",
    status: "closed",
    createdBy: "author-1",
    roblox: { username: "Anchor", userId: "101" },
    level: "medium",
    count: "2-4",
    helpers: {
      "helper-1": { userId: "helper-1", arrived: true },
    },
    closeSummary: { text: "done", confirmedHelperIds: ["helper-1"] },
  };

  assert.match(payloadJson(buildTicketPublicPayload(ticket)), /закрыто/);
  assert.doesNotMatch(payloadJson(buildThreadPanelPayload(ticket)), /Помочь/);
  assert.equal(ticketButtonId("help", "ticket-1"), "at:help:ticket-1");
});

test("public ticket can reattach photo into the application message", () => {
  const payload = buildTicketPublicPayload({
    id: "ticket-1",
    kind: "standard",
    status: "open",
    createdBy: "author-1",
    roblox: { username: "Anchor", userId: "101" },
    level: "medium",
    count: "2-4",
    photo: {
      url: "https://cdn.discordapp.com/attachments/1/2/screen shot.png",
      name: "screen shot.png",
      contentType: "image/png",
    },
  }, undefined, { attachPhoto: true });
  const json = payloadJson(payload);

  assert.equal(payload.files[0].name, "screen_shot.png");
  assert.match(json, /attachment:\/\/screen_shot\.png/);
});

test("public ticket keeps stored photo attachment reference on edits", () => {
  const payload = buildTicketPublicPayload({
    id: "ticket-1",
    kind: "standard",
    status: "open",
    createdBy: "author-1",
    roblox: { username: "Anchor", userId: "101" },
    level: "medium",
    count: "2-4",
    photo: {
      url: "https://cdn.discordapp.com/attachments/1/2/original.png",
      name: "original.png",
      contentType: "image/png",
    },
    message: { photoAttachmentName: "stored.png" },
  });
  const json = payloadJson(payload);

  assert.equal(payload.files, undefined);
  assert.match(json, /attachment:\/\/stored\.png/);
});

test("moderator panel renders setup controls", () => {
  const state = normalizeAntiteamState({
    config: { channelId: "channel-1", battalionRoleId: "role-1" },
    tickets: { t1: { id: "t1", status: "open" } },
  });
  const payload = buildModeratorPanelPayload(state);
  const json = payloadJson(payload);

  assert.equal(payload.flags, MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
  assert.match(json, /Antiteam Control/);
  assert.match(json, /Опубликовать панель/);
  assert.match(json, /Roblox\/тайминги/);
  assert.match(json, /Автозакрытие миссии/);
});

test("close review payload paginates helper arrival toggles", () => {
  const helpers = {};
  for (let index = 0; index < 12; index += 1) {
    helpers[`helper-${index}`] = {
      userId: `helper-${index}`,
      discordTag: `Helper ${index}`,
      respondedAt: `2026-05-16T10:${String(index).padStart(2, "0")}:00.000Z`,
    };
  }

  const firstPage = payloadJson(buildCloseReviewPayload({ id: "ticket-1", helpers }, 0));
  const secondPage = payloadJson(buildCloseReviewPayload({ id: "ticket-1", helpers }, 1));

  assert.match(firstPage, /Страница/);
  assert.match(firstPage, /Helper 0/);
  assert.doesNotMatch(firstPage, /Helper 11/);
  assert.match(firstPage, /Вперёд/);
  assert.match(secondPage, /Helper 11/);
  assert.match(secondPage, /Назад/);
});
