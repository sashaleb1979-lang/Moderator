"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { MessageFlags } = require("discord.js");
const {
  ANTITEAM_CUSTOM_IDS,
  buildCloseReviewPayload,
  buildModeratorPanelPayload,
  buildPanelTextModal,
  buildRobloxUsernameModal,
  buildStartPanelPayload,
  buildStartGuidePayload,
  buildThreadName,
  buildThreadPanelPayload,
  buildTicketPublicPayload,
  buildTicketSetupPayload,
  buildTicketTitle,
  ticketButtonId,
} = require("../src/antiteam/view");
const { normalizeAntiteamState } = require("../src/antiteam/state");

function payloadJson(payload) {
  return JSON.stringify(payload.components.map((component) => component.toJSON()));
}

test("start panel is Components V2 and exposes submit button", () => {
  const payload = buildStartPanelPayload({
    battalionRoleId: "role-1",
    panel: {
      title: "🔥 Вызов батальона",
      description: "Жми, если тимеры мешают серверу.",
      details: "Ники и kills ускоряют выезд.",
      buttonLabel: "🚨 Создать антитим",
      accentColor: 0xE53935,
    },
  });

  assert.equal(payload.flags, MessageFlags.IsComponentsV2);
  assert.match(payloadJson(payload), /Вызов батальона/);
  assert.match(payloadJson(payload), /Создать антитим/);
  assert.match(payloadJson(payload), new RegExp(ANTITEAM_CUSTOM_IDS.guide.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(payloadJson(payload), new RegExp(ANTITEAM_CUSTOM_IDS.open.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("start guide and panel text modal expose polished setup copy", () => {
  const config = normalizeAntiteamState({
    config: {
      panel: {
        title: "⚔️ Антитим",
        buttonLabel: "⚔️ Подать заявку",
      },
    },
  }).config;

  assert.equal(buildStartGuidePayload(config).flags, MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
  assert.match(payloadJson(buildStartGuidePayload(config)), /Как работает антитим/);
  assert.match(payloadJson(buildStartGuidePayload(config)), /уже привязан/);
  assert.equal(buildPanelTextModal(config).data.custom_id, "at:panel_text:modal");
});

test("roblox username modal does not send an empty value below min length", () => {
  const modal = buildRobloxUsernameModal({ customId: "at:roblox" }).toJSON();
  const emptyInput = buildRobloxUsernameModal({ customId: "at:roblox" }).toJSON().components[0].components[0];
  const filledInput = buildRobloxUsernameModal({ customId: "at:roblox", initialValue: "Builderman" }).toJSON().components[0].components[0];
  const clanInput = buildRobloxUsernameModal({
    customId: "at:clan_roblox",
    title: "Клан-аларм: Roblox якорь",
    label: "Roblox ник игрока-якоря",
    placeholder: "Ник игрока, который уже сидит на сервере",
  }).toJSON().components[0].components[0];

  assert.equal(modal.title, "Roblox не найден в профиле");
  assert.equal(emptyInput.label, "Roblox username аккаунта");
  assert.equal(emptyInput.min_length, 3);
  assert.equal(Object.prototype.hasOwnProperty.call(emptyInput, "value"), false);
  assert.equal(filledInput.value, "Builderman");
  assert.equal(clanInput.label, "Roblox ник игрока-якоря");
  assert.equal(clanInput.placeholder, "Ник игрока, который уже сидит на сервере");
});

test("draft setup renders level, count and toggles compactly", () => {
  const draft = {
    kind: "standard",
    userId: "user-1",
    roblox: { username: "Anchor", userId: "101" },
    level: "high",
    count: "4-10",
    description: "Ники: A/B, примерно 5k.",
    directJoinEnabled: true,
    photoWanted: true,
  };
  const payload = buildTicketSetupPayload(draft, normalizeAntiteamState({}).config);
  const json = payloadJson(payload);

  assert.equal(payload.flags, MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
  assert.match(json, /Высокие/);
  assert.match(json, /4-10/);
  assert.match(json, /Вход без др: есть/);
  assert.match(json, /Фото: есть/);
  assert.match(json, /Roblox пускает к тебе не-друзей/);
  assert.match(json, /Описание обязательно/);
  assert.doesNotMatch(json, /"disabled":true/);
});

test("draft setup requires description before submit", () => {
  const payload = buildTicketSetupPayload({
    kind: "standard",
    userId: "user-1",
    roblox: { username: "Anchor", userId: "101" },
    level: "medium",
    count: "2-4",
  }, normalizeAntiteamState({}).config);
  const json = payloadJson(payload);

  assert.match(json, /Описание обязательно/);
  assert.match(json, /Вход без др: нету/);
  assert.match(json, /Заполнить описание/);
  assert.match(json, /"disabled":true/);
});

test("public ticket and thread name stay compact", () => {
  const ticket = {
    id: "ticket-1",
    kind: "standard",
    status: "open",
    createdBy: "author-1",
    createdByTag: "Gnom#1234",
    roblox: { username: "Anchor", userId: "101" },
    level: "low",
    count: "4-10",
    description: "Бить A/B, тимятся у центра.",
    directJoinEnabled: false,
  };
  const json = payloadJson(buildTicketPublicPayload(ticket));

  assert.equal(buildThreadName(ticket), "🟢 4-10 тимера • Gnom");
  assert.match(json, /Антитим • 4-10/);
  assert.match(json, /Вход без др: \*\*нету\*\* • статус: \*\*открыто\*\*/);
  assert.match(json, /Опасность: 🟢 \*\*Лоутабельные\*\*/);
  assert.match(json, /Кого бить: Бить A\/B/);
  assert.doesNotMatch(json, /### Опасность/);
  assert.doesNotMatch(json, /### Помощь/);
});

test("clan draft and public ticket show selected Discord anchor", () => {
  const draftPayload = buildTicketSetupPayload({
    kind: "clan",
    userId: "caller-1",
    anchorUserId: "anchor-1",
    roblox: { username: "AnchorRb", userId: "202" },
    description: "Клан держит сервер.",
  }, normalizeAntiteamState({}).config);
  const ticketPayload = buildTicketPublicPayload({
    id: "ticket-1",
    kind: "clan",
    status: "open",
    createdBy: "caller-1",
    anchorUserId: "anchor-1",
    roblox: { username: "AnchorRb", userId: "202" },
    description: "Клан держит сервер.",
  });

  assert.match(payloadJson(draftPayload), /Якорь: <@anchor-1>/);
  assert.match(payloadJson(ticketPayload), /Автор: <@caller-1> • Якорь: <@anchor-1>/);
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
  assert.equal(buildTicketTitle(ticket), "⚫ Антитим • 2-4");
  assert.equal(buildThreadName(ticket), "⚫ 2-4 тимера • author-1");
  assert.match(payloadJson(buildTicketPublicPayload(ticket)), /Опасность: ⚫ \*\*Средние\*\*/);
  assert.match(payloadJson(buildThreadPanelPayload(ticket)), /⚫ Миссия закрыта/);
  assert.doesNotMatch(payloadJson(buildThreadPanelPayload(ticket)), /Помочь/);
  assert.equal(ticketButtonId("help", "ticket-1"), "at:help:ticket-1");
});

test("clan public ticket without photo does not touch photo attachment name", () => {
  const payload = buildTicketPublicPayload({
    id: "ticket-clan",
    kind: "clan",
    status: "open",
    createdBy: "caller-1",
    anchorUserId: "anchor-1",
    roblox: { username: "Krutoikira", userId: "1265862594" },
    description: "ФАЙТ С ХН",
    photo: null,
  });
  const json = payloadJson(payload);

  assert.equal(payload.files, undefined);
  assert.match(json, /Клан-аларм/);
  assert.match(json, /ФАЙТ С ХН/);
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
  assert.match(json, /Редактировать старт/);
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
