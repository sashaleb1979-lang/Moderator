"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { MessageFlags } = require("discord.js");
const {
  ANTITEAM_CUSTOM_IDS,
  buildCloseReviewPayload,
  buildHelperRewardRolesModal,
  buildHelperStatsPayload,
  buildHelpReplyPayload,
  buildModeratorPanelPayload,
  buildPanelTextModal,
  buildPingConfigModal,
  buildPhotoRequestPayload,
  buildRobloxConfirmPayload,
  buildRobloxMissingPayload,
  buildRobloxUsernameModal,
  buildStartPanelPayload,
  buildStartGuidePayload,
  buildSupportProgressPayload,
  buildThreadName,
  buildThreadPanelPayload,
  buildTicketPublicPayload,
  buildTicketSetupPayload,
  buildTicketTitle,
  ticketButtonId,
} = require("../src/antiteam/view");
const { normalizeAntiteamState } = require("../src/antiteam/state");
const { getSupportProgressModel } = require("../src/antiteam/support-progress");

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
  assert.deepEqual(payload.allowedMentions, { parse: [] });
  assert.match(payloadJson(payload), /Вызов батальона/);
  assert.match(payloadJson(payload), /Создать антитим/);
  assert.match(payloadJson(payload), /Система пинга/);
  assert.doesNotMatch(payloadJson(payload), /Батальён:/);
  assert.match(payloadJson(payload), /Вступить в батальён/);
  assert.match(payloadJson(payload), new RegExp(ANTITEAM_CUSTOM_IDS.joinBattalion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.ok(payloadJson(payload).indexOf(ANTITEAM_CUSTOM_IDS.progress) < payloadJson(payload).indexOf(ANTITEAM_CUSTOM_IDS.guide));
  assert.match(payloadJson(payload), /Мой прогресс/);
  assert.match(payloadJson(payload), new RegExp(ANTITEAM_CUSTOM_IDS.guide.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(payloadJson(payload), new RegExp(ANTITEAM_CUSTOM_IDS.open.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("support progress payload renders personal level card attachment", () => {
  const zero = getSupportProgressModel(0);
  const middle = getSupportProgressModel(7);
  const max = getSupportProgressModel(55);
  const payload = buildSupportProgressPayload(middle, { attachmentName: "progress.png" });
  const json = payloadJson(payload);

  assert.equal(zero.title, "Саппорт Ⅰ ур.");
  assert.equal(zero.remaining, 1);
  assert.equal(middle.title, "Саппорт Ⅱ ур.");
  assert.equal(middle.next.label, "Саппорт Ⅲ ур.");
  assert.equal(middle.remaining, 3);
  assert.equal(max.title, "Саппорт Ⅴ ур.");
  assert.equal(max.isMaxLevel, true);
  assert.equal(payload.flags, MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
  assert.match(json, /Прогресс помощи/);
  assert.match(json, /Саппорт Ⅱ ур\./);
  assert.match(json, /До Саппорт Ⅲ ур\.: 3 помощи/);
  assert.match(json, /attachment:\/\/progress\.png/);
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
  assert.match(payloadJson(buildStartGuidePayload(config)), /Ранги помощи/);
  assert.match(payloadJson(buildStartGuidePayload(config)), /Саппорт Ⅴ ур\./);
  assert.match(payloadJson(buildStartGuidePayload(config)), /Мой прогресс/);
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
  assert.equal(emptyInput.label, "Roblox ник аккаунта");
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
  assert.match(json, /Вход без друзей/);
  assert.match(json, /🔓 Есть/);
  assert.match(json, /📸 Есть/);
  assert.match(json, /Roblox разрешает подключаться к тебе без добавления в друзья/);
  assert.match(json, /Описание обязательно/);
  assert.doesNotMatch(json, /"disabled":true/);
});

test("roblox identity panels gate missing and first-time confirmed profiles", () => {
  const missing = buildRobloxMissingPayload({
    reasonText: "Старая Roblox-связка повреждена: в профиле нет валидного Roblox userId, поэтому бот не возьмёт её автоматически.",
  });
  const confirm = buildRobloxConfirmPayload({
    username: "Krutoikira",
    userId: "1265862594",
    profileUrl: "https://www.roblox.com/users/1265862594/profile",
  });
  const missingJson = payloadJson(missing);
  const confirmJson = payloadJson(confirm);

  assert.equal(missing.flags, MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
  assert.match(missingJson, /Roblox ник/);
  assert.match(missingJson, /нет валидного Roblox userId/);
  assert.match(missingJson, /Внести ник/);
  assert.match(missingJson, new RegExp(ANTITEAM_CUSTOM_IDS.requestRobloxNick.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(confirmJson, /Подтверди Roblox/);
  assert.match(confirmJson, /Krutoikira/);
  assert.match(confirmJson, /Да, это мой/);
  assert.match(confirmJson, /Другой ник/);
  assert.match(confirmJson, /https:\/\/www\.roblox\.com\/users\/1265862594\/profile/);
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
  assert.match(json, /🔒 Нету/);
  assert.match(json, /Заполнить описание/);
  assert.match(json, /"disabled":true/);
});

test("public ticket is the main compact post and thread panel is buttons only", () => {
  const ticket = {
    id: "ticket-1",
    kind: "standard",
    status: "open",
    createdBy: "author-1",
    createdByTag: "Gnom#1234",
    roblox: {
      username: "Anchor",
      userId: "101",
      avatarUrl: "https://tr.rbxcdn.com/anchor-headshot.png",
    },
    level: "low",
    count: "4-10",
    description: "Бить A/B, тимятся у центра.",
    directJoinEnabled: false,
  };
  const json = payloadJson(buildTicketPublicPayload(ticket));
  const threadJson = payloadJson(buildThreadPanelPayload(ticket));

  assert.equal(buildThreadName(ticket), "🟢 4-10 тимеров • Gnom");
  assert.equal(buildTicketTitle(ticket), "🟢 Нужна помощь • 4-10 тимеров");
  assert.match(json, /# 🟢 Нужна помощь • 4-10 тимеров/);
  assert.match(json, /Попросил 👤 <@author-1> • \*\*Anchor\*\*/);
  assert.doesNotMatch(json, /🎮/);
  assert.doesNotMatch(json, /Маршрут:/);
  assert.match(json, /🟢 \*\*Лоутабельные\*\*: почти вся команда до ~2k kills\./);
  assert.match(json, /### Помощники/);
  assert.match(json, /Пока никто не отозвался/);
  assert.match(json, /### Описание/);
  assert.match(json, /> Бить A\/B, тимятся у центра\./);
  assert.ok(json.indexOf("### Описание") < json.indexOf("### Помощники"));
  assert.match(threadJson, /🙋 Помочь/);
  assert.match(threadJson, /🔒 Вход без др: нет/);
  assert.match(threadJson, /⚠️ Пожаловаться/);
  assert.match(threadJson, /📈 Повысить/);
  assert.match(threadJson, /✅ Завершить/);
  assert.doesNotMatch(threadJson, /Сбор помощи|Контекст|Маршрут|Бить A\/B/);
});

test("public ticket exposes an external help jump button once the thread panel exists", () => {
  const payload = buildTicketPublicPayload({
    id: "ticket-1",
    kind: "standard",
    status: "open",
    createdBy: "author-1",
    roblox: { username: "Anchor", userId: "101" },
    level: "medium",
    count: "2-4",
    description: "Бить A/B.",
    message: {
      guildId: "guild-1",
      threadId: "thread-1",
      threadPanelMessageId: "panel-1",
    },
  });
  const json = payloadJson(payload);

  assert.match(json, /🙋 Прийти на помощь/);
  assert.match(json, /https:\/\/discord\.com\/channels\/guild-1\/thread-1\/panel-1/);
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
  assert.match(payloadJson(ticketPayload), /Попросил 👤 <@caller-1> • Якорь <@anchor-1>/);
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
    message: { guildId: "guild-1", threadId: "thread-1", threadPanelMessageId: "panel-1" },
    closeSummary: { text: "done", confirmedHelperIds: ["helper-1"] },
  };

  assert.match(payloadJson(buildTicketPublicPayload(ticket)), /# ⚫ Завершено • 2-4 тимеров/);
  assert.equal(buildTicketTitle(ticket), "⚫ Завершено • 2-4 тимеров");
  assert.equal(buildThreadName(ticket), "⚫ 2-4 тимеров • author-1");
  assert.match(payloadJson(buildTicketPublicPayload(ticket)), /⚫ \*\*Средние\*\*: команда в основном 2k-8k kills/);
  assert.doesNotMatch(payloadJson(buildTicketPublicPayload(ticket)), /Прийти на помощь/);
  assert.match(payloadJson(buildThreadPanelPayload(ticket)), /✅ Закрыто/);
  assert.match(payloadJson(buildThreadPanelPayload(ticket)), /🔒 Вход без др: нет/);
  assert.match(payloadJson(buildThreadPanelPayload(ticket)), /"disabled":true/);
  assert.equal(ticketButtonId("help", "ticket-1"), "at:help:ticket-1");
});

test("public ticket shows live helper mentions in response order", () => {
  const payload = buildTicketPublicPayload({
    id: "ticket-1",
    kind: "standard",
    status: "open",
    createdBy: "author-1",
    roblox: { username: "Anchor", userId: "101" },
    level: "medium",
    count: "2-4",
    description: "Бить A/B, тимятся у центра.",
    helpers: {
      "helper-2": {
        userId: "helper-2",
        discordTag: "Helper 2",
        respondedAt: "2026-05-16T10:02:00.000Z",
      },
      "helper-1": {
        userId: "helper-1",
        discordTag: "Helper 1",
        respondedAt: "2026-05-16T10:01:00.000Z",
      },
    },
  });
  const json = payloadJson(payload);

  assert.match(json, /### Помощники/);
  assert.match(json, /Откликнулись: \*\*2\*\*/);
  assert.doesNotMatch(json, /пришли: \*\*0\*\*/);
  assert.match(json, /<@helper-1> • <@helper-2>/);
  assert.doesNotMatch(json, /👥 Отклик:/);
});

test("open public ticket shows API present count only when runtime detects arrivals", () => {
  const baseTicket = {
    id: "ticket-1",
    kind: "standard",
    status: "open",
    createdBy: "author-1",
    roblox: { username: "Anchor", userId: "101" },
    level: "medium",
    count: "2-4",
    description: "Бить A/B.",
    helpers: {
      "helper-1": { userId: "helper-1", respondedAt: "2026-05-16T10:01:00.000Z" },
      "helper-2": { userId: "helper-2", respondedAt: "2026-05-16T10:02:00.000Z" },
    },
  };

  const withoutApi = payloadJson(buildTicketPublicPayload(baseTicket));
  const withApi = payloadJson(buildTicketPublicPayload(baseTicket, undefined, { apiPresentHelperIds: ["helper-2"] }));

  assert.match(withoutApi, /Откликнулись: \*\*2\*\*/);
  assert.doesNotMatch(withoutApi, /API в игре/);
  assert.match(withApi, /Откликнулись: \*\*2\*\* \(API в игре: \*\*1\*\*\)/);
});

test("closed public ticket shows helper result markers", () => {
  const payload = buildTicketPublicPayload({
    id: "ticket-1",
    kind: "standard",
    status: "closed",
    createdBy: "author-1",
    roblox: { username: "Anchor", userId: "101" },
    level: "medium",
    count: "2-4",
    description: "Бить A/B, тимятся у центра.",
    helpers: {
      "helper-1": {
        userId: "helper-1",
        discordTag: "Helper 1",
        respondedAt: "2026-05-16T10:01:00.000Z",
        arrived: true,
      },
      "helper-2": {
        userId: "helper-2",
        discordTag: "Helper 2",
        respondedAt: "2026-05-16T10:02:00.000Z",
        arrived: false,
      },
    },
    closeSummary: { text: "done", confirmedHelperIds: ["helper-1"] },
  });
  const json = payloadJson(payload);

  assert.match(json, /### Помощники/);
  assert.match(json, /✅ <@helper-1> • ❌ <@helper-2>/);
  assert.match(json, /Итог: done/);
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

test("public ticket can reattach multiple photos into the application message", () => {
  const payload = buildTicketPublicPayload({
    id: "ticket-1",
    kind: "standard",
    status: "open",
    createdBy: "author-1",
    roblox: { username: "Anchor", userId: "101" },
    level: "medium",
    count: "2-4",
    photos: [{
      url: "https://cdn.discordapp.com/attachments/1/2/screen shot.png",
      name: "screen shot.png",
      contentType: "image/png",
    }, {
      url: "https://cdn.discordapp.com/attachments/1/2/screen shot.png?second=1",
      name: "screen shot.png",
      contentType: "image/png",
    }],
  }, undefined, { attachPhoto: true });
  const json = payloadJson(payload);

  assert.equal(payload.files.length, 2);
  assert.deepEqual(payload.files.map((file) => file.name), ["screen_shot.png", "screen_shot-2.png"]);
  assert.match(json, /attachment:\/\/screen_shot\.png/);
  assert.match(json, /attachment:\/\/screen_shot-2\.png/);
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

test("photo request copy allows several images in one message", () => {
  const payload = buildPhotoRequestPayload({});
  const json = payloadJson(payload);

  assert.match(json, /несколько изображений сразу одним сообщением/);
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
  assert.match(json, /Пинг-система/);
  assert.match(json, /Roblox\/тайминги/);
  assert.match(json, /Автозакрытие миссии/);
  assert.match(json, /Статистика помощи/);
});

test("helper reply exposes friend-request action only after help path needs it", () => {
  const friendRequest = payloadJson(buildHelpReplyPayload({
    ticket: { id: "ticket-1", kind: "standard" },
    linkKind: "friend_request",
    directJoinUrl: "https://www.roblox.com/games/start?placeId=1&gameInstanceId=2",
    profileUrl: "https://www.roblox.com/users/101/profile",
    friendRequestsUrl: "https://www.roblox.com/users/friends#!/friend-requests",
  }));
  const alreadyFriend = payloadJson(buildHelpReplyPayload({
    ticket: { id: "ticket-1", kind: "standard" },
    linkKind: "friend_direct",
    directJoinUrl: "https://www.roblox.com/games/start?placeId=1&gameInstanceId=2",
    profileUrl: "https://www.roblox.com/users/101/profile",
  }));
  const unknownHelper = payloadJson(buildHelpReplyPayload({
    ticket: { id: "ticket-1", kind: "standard" },
    linkKind: "friend_request",
    directJoinUrl: "https://www.roblox.com/games/start?userId=101",
    profileUrl: "https://www.roblox.com/users/101/profile",
    friendRequestsUrl: "https://www.roblox.com/users/friends#!/friend-requests",
    helperRobloxKnown: false,
    friendRequestNotified: true,
  }));

  assert.match(friendRequest, /станет рабочей после добавления в друзья/);
  assert.match(friendRequest, /открой профиль и нажми \*\*Join\*\*/);
  assert.match(friendRequest, /📨 Отправил др, пусть примет/);
  assert.match(alreadyFriend, /Ты уже Roblox-друг автора/);
  assert.match(alreadyFriend, /Если подключение не работает, открой профиль и нажми \*\*Join\*\*/);
  assert.doesNotMatch(alreadyFriend, /Отправил др/);
  assert.match(unknownHelper, /Roblox у тебя не привязан/);
  assert.match(unknownHelper, /Автор уже получил уведомление/);
  assert.match(unknownHelper, /"disabled":true/);
});

test("ping config modal exposes the three ping systems", () => {
  const modal = buildPingConfigModal({
    pingMode: "custom_role",
    extraPingRoleId: "role-2",
    battalionPingRoleIds: ["role-3", "role-4"],
  });
  const json = JSON.stringify(modal.toJSON());

  assert.match(json, /battalion \/ role \/ everyone/);
  assert.match(json, /role-2/);
  assert.match(json, /Доп\. роли базового пинга/);
  assert.match(json, /role-3\\nrole-4/);
});

test("helper stats payload supports per-helper delete and full clear confirmation", () => {
  const state = normalizeAntiteamState({
    config: {
      helperRewardRoles: {
        "1": "role-1",
        "5": "role-5",
      },
    },
    stats: {
      helpers: {
        "helper-1": { responded: 3, linkGranted: 2, confirmedArrived: 1, lastHelpedAt: "2026-05-16T10:00:00.000Z" },
      },
    },
  });
  const payload = buildHelperStatsPayload(state);
  const confirmPayload = buildHelperStatsPayload(state, 0, "", { confirmClear: true });
  const json = payloadJson(payload);

  assert.equal(payload.flags, MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
  assert.match(json, /<@helper-1>/);
  assert.match(json, /очков: \*\*1\*\*/);
  assert.match(json, /Очки помощи: \*\*1\*\*/);
  assert.match(json, /Роли за очки помощи/);
  assert.match(json, /<@&role-1>/);
  assert.match(json, /🎖️ Роли/);
  assert.match(json, /🔁 Выдать роли/);
  assert.match(json, /🗑️ Удалить/);
  assert.match(json, /🧹 Очистить всё/);
  assert.match(payloadJson(confirmPayload), /Да, стереть всё/);
  const modal = buildHelperRewardRolesModal(state.config).toJSON();
  assert.equal(modal.custom_id, "at:stats:roles_modal");
  assert.equal(modal.components[0].components[0].custom_id, "role_1");
  assert.equal(modal.components[1].components[0].value, "role-5");
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
