"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { compileDailyNewsDigest } = require("../src/news/compiler");
const {
  DAILY_NEWS_OPERATOR_ACTIONS,
  DAILY_NEWS_PANEL_CONFIG_INFRA_ID,
  DAILY_NEWS_PANEL_CONFIG_INFRA_MODAL_ID,
  DAILY_NEWS_PANEL_OPEN_ID,
  DAILY_NEWS_PANEL_PREPARE_RANGE_MODAL_ID,
  DAILY_NEWS_PANEL_PREVIEW_DAY_ID,
  DAILY_NEWS_PANEL_PREVIEW_DAY_MODAL_ID,
  DAILY_NEWS_PANEL_PUBLISH_DAY_ID,
  DAILY_NEWS_PANEL_PUBLISH_DAY_MODAL_ID,
  DAILY_NEWS_PANEL_PUBLISH_STAFF_ONLY_ID,
  DAILY_NEWS_PANEL_PREVIEW_TODAY_ID,
  DAILY_NEWS_PANEL_START_RELEASE_QUEUE_ID,
  DAILY_NEWS_PANEL_STOP_RELEASE_QUEUE_ID,
  buildDailyNewsOperatorPanelPayload,
  buildDailyNewsStatusPayload,
  handleDailyNewsPanelButtonInteraction,
  handleDailyNewsPanelModalSubmitInteraction,
  runDailyNewsOperatorAction,
} = require("../src/news/operator");

const DENY_ALLOWED_MENTIONS = { parse: [], users: [], roles: [], repliedUser: false };

function createFakeChannel(id = "public") {
  return {
    id,
    sent: [],
    async send(payload) {
      const message = { id: `${id}-${this.sent.length + 1}`, payload };
      this.sent.push(message);
      return message;
    },
  };
}

function createButtonInteraction(customId) {
  return {
    customId,
    member: { id: "mod-1" },
    followUps: [],
    edits: [],
    updates: [],
    deferred: false,
    replied: false,
    async update(payload) {
      this.updatedPayload = payload;
      this.updates.push(payload);
      this.replied = true;
    },
    async deferUpdate() {
      this.deferred = true;
    },
    async editReply(payload) {
      this.edits.push(payload);
    },
    async followUp(payload) {
      this.followUps.push(payload);
      this.replied = true;
    },
    async reply(payload) {
      this.replyPayload = payload;
      this.replied = true;
    },
    async showModal(modal) {
      this.shownModal = modal;
      this.replied = true;
    },
  };
}

function createModalInteraction(customId, fieldValues) {
  const values = fieldValues && typeof fieldValues === "object" && !Array.isArray(fieldValues)
    ? fieldValues
    : { day_key: fieldValues };
  return {
    customId,
    member: { id: "mod-1" },
    followUps: [],
    edits: [],
    deferred: false,
    replied: false,
    fields: {
      getTextInputValue(fieldId) {
        return values[fieldId] || "";
      },
    },
    async deferReply() {
      this.deferred = true;
    },
    async editReply(payload) {
      this.edits.push(payload);
      this.replied = true;
    },
    async followUp(payload) {
      this.followUps.push(payload);
      this.replied = true;
    },
    async reply(payload) {
      this.replyPayload = payload;
      this.replied = true;
    },
  };
}

test("runDailyNewsOperatorAction previews and reports status", async () => {
  const db = {
    profiles: {},
    sot: { news: { config: { presentation: { masthead: "Ops Desk" } } } },
  };

  const preview = await runDailyNewsOperatorAction({
    db,
    action: DAILY_NEWS_OPERATOR_ACTIONS.PREVIEW_DAY,
    dayKey: "2026-05-14",
    now: "2026-05-14T18:00:00.000Z",
  });
  assert.equal(preview.dayKey, "2026-05-14");
  assert.match(preview.payload.content, /Ops Desk/);

  const status = buildDailyNewsStatusPayload(db);
  assert.match(status.content, /сборка: \*\*готово для preview\*\*/);
  assert.match(status.content, /публикация: \*\*не опубликовано\*\*/);
  assert.match(status.content, /период: \*\*на паузе\*\*/);
});

test("runDailyNewsOperatorAction publishes through publisher owner", async () => {
  const publicChannel = createFakeChannel("public");
  const db = {
    profiles: {
      "user-1": {
        displayName: "Alpha",
        domains: {
          activity: {
            activityScore: 44,
            appliedActivityRoleKey: "active",
          },
        },
      },
    },
    sot: { news: { config: { channels: { publicChannelId: "public" } } } },
  };

  const result = await runDailyNewsOperatorAction({
    db,
    action: DAILY_NEWS_OPERATOR_ACTIONS.PUBLISH_NOW,
    dayKey: "2026-05-14",
    now: "2026-05-14T18:00:00.000Z",
    publicChannel,
  });

  assert.equal(result.publish.published, true);
  assert.equal(publicChannel.sent.length, 1);
  assert.equal(db.sot.news.runtime.lastPublishStatus, "published");
  assert.equal(db.sot.news.history.daySnapshots["2026-05-14"]["user-1"].activityScore, 44);
  assert.match(result.payload.content, /публикация: \*\*опубликовано\*\*/);
});

test("runDailyNewsOperatorAction allows repeated manual public publish for the same day", async () => {
  const publicChannel = createFakeChannel("public");
  const db = {
    profiles: {},
    sot: { news: { config: { channels: { publicChannelId: "public" } } } },
  };

  await runDailyNewsOperatorAction({
    db,
    action: DAILY_NEWS_OPERATOR_ACTIONS.PUBLISH_NOW,
    dayKey: "2026-05-14",
    now: "2026-05-14T18:00:00.000Z",
    publicChannel,
  });

  const second = await runDailyNewsOperatorAction({
    db,
    action: DAILY_NEWS_OPERATOR_ACTIONS.PUBLISH_NOW,
    dayKey: "2026-05-14",
    now: "2026-05-14T18:05:00.000Z",
    publicChannel,
  });

  assert.equal(second.publish.published, true);
  assert.equal(second.republished, true);
  assert.equal(publicChannel.sent.length, 2);
});

test("runDailyNewsOperatorAction marks manual publish as repeated for an older day with stored public publish metadata", async () => {
  const publicChannel = createFakeChannel("public");
  const db = {
    profiles: {},
    sot: {
      news: {
        config: { channels: { publicChannelId: "public" } },
        dailyDigests: {
          "2026-05-14": {
            dayKey: "2026-05-14",
            publish: {
              publishMode: "public",
              publicMessageId: "public-old",
            },
          },
        },
        runtime: {
          lastPublishedDayKey: "2026-05-20",
          lastPublishStatus: "published",
        },
      },
    },
  };

  const result = await runDailyNewsOperatorAction({
    db,
    action: DAILY_NEWS_OPERATOR_ACTIONS.PUBLISH_DAY,
    dayKey: "2026-05-14",
    now: "2026-05-21T18:00:00.000Z",
    publicChannel,
  });

  assert.equal(result.publish.published, true);
  assert.equal(result.republished, true);
  assert.equal(publicChannel.sent.length, 1);
});

test("runDailyNewsOperatorAction can send a staff-only smoke publish", async () => {
  const staffChannel = createFakeChannel("staff");
  const db = {
    profiles: {
      "user-1": {
        displayName: "Alpha",
        domains: {
          activity: {
            activityScore: 44,
            appliedActivityRoleKey: "active",
          },
        },
      },
    },
    sot: { news: { config: { channels: { staffChannelId: "staff" } } } },
  };

  const result = await runDailyNewsOperatorAction({
    db,
    action: DAILY_NEWS_OPERATOR_ACTIONS.PUBLISH_STAFF_ONLY,
    dayKey: "2026-05-14",
    now: "2026-05-14T18:00:00.000Z",
    staffChannel,
  });

  assert.equal(result.publish.published, true);
  assert.equal(result.publish.publishMode, "staff_only");
  assert.equal(staffChannel.sent.length, 2);
  assert.equal(db.sot.news.runtime.lastPublishStatus, "staff_published");
  assert.equal(db.sot.news.runtime.lastPublishResult.publishMode, "staff_only");
  assert.equal(db.sot.news.runtime.lastPublishResult.deliveryMessageId, "staff-1");
  assert.equal(db.sot.news.runtime.lastPublishResult.staffMessageId, "staff-2");
  assert.equal(db.sot.news.history.daySnapshots["2026-05-14"]["user-1"].activityScore, 44);
  assert.match(result.payload.content, /публикация: \*\*отправлено только в staff\*\*/);
});

test("buildDailyNewsOperatorPanelPayload shows runtime summary and disables publish without public channel", () => {
  const payload = buildDailyNewsOperatorPanelPayload({
    db: { sot: { news: { config: { presentation: { masthead: "Ops Desk" } } } } },
    includeFlags: false,
  });

  assert.equal(payload.embeds[0].data.title, "Оператор Daily News");
  assert.match(payload.embeds[0].data.description, /Ops Desk/);
  assert.match(payload.embeds[0].data.description, /Ежедневный тик: \*\*выключен\*\*/);
  assert.match(payload.embeds[0].data.description, /Режим выпуска: \*\*ручной\*\*/);
  assert.match(payload.embeds[0].data.description, /Публикация периода: \*\*на паузе\*\*/);
  assert.match(payload.embeds[0].data.fields[0].value, /Статус: \*\*не запускалась\*\*/);
  assert.match(payload.embeds[0].data.fields[1].value, /Статус: \*\*не опубликовано\*\*/);
  assert.equal(payload.components[0].components[4].data.disabled, true);
  assert.equal(payload.components[1].components[0].data.disabled, true);
  assert.equal(payload.components[1].components[2].data.label, "Подготовить период");
  assert.equal(payload.components[1].components[3].data.label, "Запустить период");
  assert.equal(payload.components[2].components[0].data.custom_id, DAILY_NEWS_PANEL_CONFIG_INFRA_ID);
});

test("buildDailyNewsOperatorPanelPayload shows persisted publish delivery summary after reopen", () => {
  const payload = buildDailyNewsOperatorPanelPayload({
    db: {
      sot: {
        news: {
          config: {
            presentation: { masthead: "Ops Desk" },
          },
          runtime: {
            lastPublishedDayKey: "2026-05-14",
            lastPublishStatus: "staff_published",
            lastPublishFinishedAt: "2026-05-14T18:00:00.000Z",
            lastPublishResult: {
              publishMode: " staff_only ",
              deliveryMessageId: " staff-1 ",
              staffMessageId: " staff-2 ",
            },
          },
        },
      },
    },
    includeFlags: false,
  });

  assert.match(payload.embeds[0].data.fields[1].value, /Режим: \*\*только staff\*\*/);
  assert.match(payload.embeds[0].data.fields[1].value, /Сообщение: \*\*staff-1\*\*/);
  assert.match(payload.embeds[0].data.fields[1].value, /Аудит: \*\*staff-2\*\*/);
  assert.match(payload.embeds[0].data.fields[1].value, /Предупреждения: \*\*0\*\*/);
});

test("buildDailyNewsOperatorPanelPayload shows blocked auto-publish state for invalid legacy config", () => {
  const payload = buildDailyNewsOperatorPanelPayload({
    db: {
      sot: {
        news: {
          config: {
            enabled: false,
            publish: { autoPublishEnabled: true },
            channels: { publicChannelId: "" },
          },
        },
      },
    },
    includeFlags: false,
  });

  assert.match(payload.embeds[0].data.description, /Режим выпуска: \*\*автовыпуск заблокирован\*\*/);
  assert.match(payload.embeds[0].data.description, /Автовыпуск заблокирован/);
});

test("handleDailyNewsPanelButtonInteraction opens panel previews today and exact-day modal", async () => {
  const db = {
    profiles: {},
    sot: { news: { config: { presentation: { masthead: "Ops Desk" } } } },
  };
  const openInteraction = createButtonInteraction(DAILY_NEWS_PANEL_OPEN_ID);
  const previewInteraction = createButtonInteraction(DAILY_NEWS_PANEL_PREVIEW_TODAY_ID);
  const dayModalInteraction = createButtonInteraction(DAILY_NEWS_PANEL_PREVIEW_DAY_ID);
  const configInteraction = createButtonInteraction(DAILY_NEWS_PANEL_CONFIG_INFRA_ID);

  await handleDailyNewsPanelButtonInteraction({
    interaction: openInteraction,
    db,
    isModerator: () => true,
    replyNoPermission: async () => {},
    buildBackPayload: async () => ({ content: "back" }),
  });
  assert.equal(openInteraction.updatedPayload.embeds[0].data.title, "Оператор Daily News");

  await handleDailyNewsPanelButtonInteraction({
    interaction: previewInteraction,
    db,
    isModerator: () => true,
    replyNoPermission: async () => {},
    now: "2026-05-14T18:00:00.000Z",
  });
  assert.equal(previewInteraction.deferred, true);
  assert.ok(previewInteraction.followUps.length >= 3);
  assert.match(previewInteraction.followUps[0].content, /Preview · public issue/);
  assert.equal(previewInteraction.followUps[1].files[0].name, "daily-news-2026-05-14.png");
  assert.equal(previewInteraction.edits[0].embeds[0].data.title, "Оператор Daily News");

  await handleDailyNewsPanelButtonInteraction({
    interaction: dayModalInteraction,
    db,
    isModerator: () => true,
    replyNoPermission: async () => {},
  });
  assert.equal(dayModalInteraction.shownModal.toJSON().custom_id, DAILY_NEWS_PANEL_PREVIEW_DAY_MODAL_ID);

  await handleDailyNewsPanelButtonInteraction({
    interaction: configInteraction,
    db,
    isModerator: () => true,
    replyNoPermission: async () => {},
  });
  assert.equal(configInteraction.shownModal.toJSON().custom_id, DAILY_NEWS_PANEL_CONFIG_INFRA_MODAL_ID);
});

test("handleDailyNewsPanelButtonInteraction opens publish-day modal", async () => {
  const interaction = createButtonInteraction(DAILY_NEWS_PANEL_PUBLISH_DAY_ID);

  await handleDailyNewsPanelButtonInteraction({
    interaction,
    db: { sot: { news: { config: { channels: { publicChannelId: "public" } } } } },
    isModerator: () => true,
    replyNoPermission: async () => {},
  });

  assert.equal(interaction.shownModal.toJSON().custom_id, DAILY_NEWS_PANEL_PUBLISH_DAY_MODAL_ID);
});

test("handleDailyNewsPanelButtonInteraction can run staff-only smoke publish", async () => {
  const interaction = createButtonInteraction(DAILY_NEWS_PANEL_PUBLISH_STAFF_ONLY_ID);
  const staffChannel = createFakeChannel("staff");
  const db = {
    profiles: {},
    sot: { news: { config: { channels: { staffChannelId: "staff" }, presentation: { masthead: "Ops Desk" } } } },
  };

  await handleDailyNewsPanelButtonInteraction({
    interaction,
    db,
    staffChannel,
    isModerator: () => true,
    replyNoPermission: async () => {},
    now: "2026-05-14T18:00:00.000Z",
  });

  assert.equal(interaction.deferred, true);
  assert.equal(staffChannel.sent.length, 2);
  assert.match(interaction.edits[0].embeds[0].data.fields.at(-1).value, /Staff-only smoke/);
});

test("handleDailyNewsPanelModalSubmitInteraction previews an exact day ephemerally", async () => {
  const interaction = createModalInteraction(DAILY_NEWS_PANEL_PREVIEW_DAY_MODAL_ID, "2026-05-14");
  const db = {
    profiles: {},
    sot: { news: { config: { presentation: { masthead: "Ops Desk" } } } },
  };

  await handleDailyNewsPanelModalSubmitInteraction({
    interaction,
    db,
    isModerator: () => true,
    replyNoPermission: async () => {},
  });

  assert.equal(interaction.deferred, true);
  assert.match(interaction.edits[0].content, /Preview · public issue · 2026-05-14/);
  assert.deepEqual(interaction.edits[0].allowedMentions, DENY_ALLOWED_MENTIONS);
  assert.equal(interaction.followUps[0].files[0].name, "daily-news-2026-05-14.png");
  assert.deepEqual(interaction.followUps[0].allowedMentions, DENY_ALLOWED_MENTIONS);
  assert.ok(interaction.followUps.length >= 2);
  assert.ok(interaction.followUps.every((payload) => {
    return JSON.stringify(payload.allowedMentions) === JSON.stringify(DENY_ALLOWED_MENTIONS);
  }));
});

test("handleDailyNewsPanelModalSubmitInteraction publishes an exact day manually", async () => {
  const interaction = createModalInteraction(DAILY_NEWS_PANEL_PUBLISH_DAY_MODAL_ID, "2026-05-14");
  const publicChannel = createFakeChannel("public");
  const db = {
    profiles: {},
    sot: { news: { config: { channels: { publicChannelId: "public" }, presentation: { masthead: "Ops Desk" } } } },
  };

  await handleDailyNewsPanelModalSubmitInteraction({
    interaction,
    db,
    publicChannel,
    isModerator: () => true,
    replyNoPermission: async () => {},
    now: "2026-05-14T18:00:00.000Z",
  });

  assert.equal(interaction.deferred, true);
  assert.equal(publicChannel.sent.length, 1);
  assert.match(interaction.edits[0].embeds[0].data.fields.at(-1).value, /опубликован вручную/);
});

test("handleDailyNewsPanelModalSubmitInteraction saves infra config and refreshes the panel", async () => {
  const interaction = createModalInteraction(DAILY_NEWS_PANEL_CONFIG_INFRA_MODAL_ID, {
    daily_news_enabled: "да",
    daily_news_auto_publish: "да",
    daily_news_public_channel: "<#123456789012345678>",
    daily_news_staff_channel: "234567890123456789",
    daily_news_publish_hour_msk: "22",
  });
  const db = {
    sot: {
      news: {
        config: {
          presentation: { masthead: "Ops Desk" },
        },
      },
    },
  };

  await handleDailyNewsPanelModalSubmitInteraction({
    interaction,
    db,
    isModerator: () => true,
    replyNoPermission: async () => {},
  });

  assert.equal(interaction.deferred, true);
  assert.equal(db.sot.news.config.enabled, true);
  assert.equal(db.sot.news.config.publish.autoPublishEnabled, true);
  assert.equal(db.sot.news.config.channels.publicChannelId, "123456789012345678");
  assert.equal(db.sot.news.config.channels.staffChannelId, "234567890123456789");
  assert.equal(db.sot.news.config.schedule.publishHourMsk, 22);
  assert.match(interaction.edits[0].embeds[0].data.description, /Режим выпуска: \*\*автовыпуск\*\*/);
  assert.match(interaction.edits[0].embeds[0].data.fields.at(-1).value, /Настройки Daily News сохранены/);
});

test("handleDailyNewsPanelModalSubmitInteraction resolves exact channel names through the provided helper", async () => {
  const interaction = createModalInteraction(DAILY_NEWS_PANEL_CONFIG_INFRA_MODAL_ID, {
    daily_news_enabled: "yes",
    daily_news_auto_publish: "no",
    daily_news_public_channel: "daily-news-feed",
    daily_news_staff_channel: "staff-news-room",
    daily_news_publish_hour_msk: "21",
  });
  const db = { sot: { news: { config: {} } } };

  await handleDailyNewsPanelModalSubmitInteraction({
    interaction,
    db,
    isModerator: () => true,
    replyNoPermission: async () => {},
    resolveRequestedChannelId(value) {
      if (value === "daily-news-feed") return "123456789012345678";
      if (value === "staff-news-room") return "234567890123456789";
      return "";
    },
  });

  assert.equal(interaction.deferred, true);
  assert.equal(db.sot.news.config.channels.publicChannelId, "123456789012345678");
  assert.equal(db.sot.news.config.channels.staffChannelId, "234567890123456789");
  assert.equal(db.sot.news.config.publish.autoPublishEnabled, false);
  assert.match(interaction.edits[0].embeds[0].data.fields.at(-1).value, /Настройки Daily News сохранены/);
});

test("handleDailyNewsPanelModalSubmitInteraction prepares a historical range and seeds the release queue", async () => {
  const interaction = createModalInteraction(DAILY_NEWS_PANEL_PREPARE_RANGE_MODAL_ID, {
    range_start_day_key: "2026-05-20",
    range_end_day_key: "2026-05-22",
  });
  const db = { sot: { news: { config: {} } } };

  await handleDailyNewsPanelModalSubmitInteraction({
    interaction,
    db,
    isModerator: () => true,
    replyNoPermission: async () => {},
    now: "2026-05-23T10:00:00.000Z",
  });

  assert.equal(interaction.deferred, true);
  assert.deepEqual(db.sot.news.runtime.releaseQueue.dayKeys, ["2026-05-20", "2026-05-21", "2026-05-22"]);
  assert.equal(db.sot.news.runtime.releaseQueue.active, false);
  assert.equal(db.sot.news.runtime.releaseQueue.lastPreparedDayCount, 3);
  assert.equal(db.sot.news.runtime.releaseQueue.skippedAlreadyPublishedCount, 0);
  assert.equal(db.sot.news.runtime.releaseQueue.alreadyPublishedDayCount, 0);
  assert.equal(db.sot.news.runtime.releaseQueue.completedDayCount, 0);
  assert.equal(db.sot.news.dailyDigests?.["2026-05-20"], undefined);
  assert.match(interaction.edits[0].embeds[0].data.fields.at(-1).value, /Период .* подготовлен/);
  assert.match(interaction.edits[0].embeds[0].data.fields.at(-1).value, /В очередь: \*\*3\*\*/);
});

test("handleDailyNewsPanelModalSubmitInteraction skips already published days in the prepared range", async () => {
  const interaction = createModalInteraction(DAILY_NEWS_PANEL_PREPARE_RANGE_MODAL_ID, {
    range_start_day_key: "2026-05-20",
    range_end_day_key: "2026-05-22",
  });
  const db = {
    sot: {
      news: {
        config: {},
        dailyDigests: {
          "2026-05-21": {
            dayKey: "2026-05-21",
            publish: {
              publishMode: "public",
              publicMessageId: "public-old",
            },
          },
        },
      },
    },
  };

  await handleDailyNewsPanelModalSubmitInteraction({
    interaction,
    db,
    isModerator: () => true,
    replyNoPermission: async () => {},
    now: "2026-05-23T10:00:00.000Z",
  });

  assert.deepEqual(db.sot.news.runtime.releaseQueue.dayKeys, ["2026-05-20", "2026-05-22"]);
  assert.equal(db.sot.news.runtime.releaseQueue.lastPreparedDayCount, 3);
  assert.equal(db.sot.news.runtime.releaseQueue.skippedAlreadyPublishedCount, 1);
  assert.equal(db.sot.news.runtime.releaseQueue.alreadyPublishedDayCount, 1);
  assert.match(interaction.edits[0].embeds[0].data.fields.at(-1).value, /Уже опубликованные дни пропущены: \*\*1\*\*/);
});

test("handleDailyNewsPanelButtonInteraction starts and stops the historical release queue", async () => {
  const startInteraction = createButtonInteraction(DAILY_NEWS_PANEL_START_RELEASE_QUEUE_ID);
  const stopInteraction = createButtonInteraction(DAILY_NEWS_PANEL_STOP_RELEASE_QUEUE_ID);
  const db = {
    sot: {
      news: {
        config: { channels: { publicChannelId: "public" } },
        runtime: {
          releaseQueue: {
            active: false,
            dayKeys: ["2026-05-20", "2026-05-21"],
          },
        },
      },
    },
  };

  await handleDailyNewsPanelButtonInteraction({
    interaction: startInteraction,
    db,
    isModerator: () => true,
    replyNoPermission: async () => {},
    now: "2026-05-23T10:00:00.000Z",
  });

  assert.equal(startInteraction.deferred, true);
  assert.equal(db.sot.news.runtime.releaseQueue.active, true);
  assert.match(startInteraction.edits[0].embeds[0].data.fields.at(-1).value, /Публикация периода запущена/);

  await handleDailyNewsPanelButtonInteraction({
    interaction: stopInteraction,
    db,
    isModerator: () => true,
    replyNoPermission: async () => {},
    now: "2026-05-23T10:01:00.000Z",
  });

  assert.equal(stopInteraction.deferred, true);
  assert.equal(db.sot.news.runtime.releaseQueue.active, false);
  assert.match(stopInteraction.edits[0].embeds[0].data.fields.at(-1).value, /Публикация периода остановлена/);
});

test("handleDailyNewsPanelModalSubmitInteraction rejects auto-publish without required tick and public channel", async () => {
  const interaction = createModalInteraction(DAILY_NEWS_PANEL_CONFIG_INFRA_MODAL_ID, {
    daily_news_enabled: "нет",
    daily_news_auto_publish: "да",
    daily_news_public_channel: "",
    daily_news_staff_channel: "",
    daily_news_publish_hour_msk: "21",
  });
  const db = { sot: { news: { config: {} } } };

  await handleDailyNewsPanelModalSubmitInteraction({
    interaction,
    db,
    isModerator: () => true,
    replyNoPermission: async () => {},
  });

  assert.equal(interaction.deferred, true);
  assert.match(interaction.edits[0].content, /Автопубликация требует:/);
  assert.equal(db.sot.news.config.publish.autoPublishEnabled, false);
});

test("runDailyNewsOperatorAction rerun uses the stored digest when it already exists", async () => {
  const db = {
    profiles: {
      "user-1": { displayName: "Stored Alpha" },
      "user-2": { displayName: "Live Beta" },
    },
    submissions: {
      base: {
        id: "base",
        userId: "user-1",
        displayName: "Stored Alpha",
        kills: 10,
        status: "approved",
        createdAt: "2026-05-14T09:00:00.000Z",
        reviewedAt: "2026-05-14T10:00:00.000Z",
      },
      storedJump: {
        id: "storedJump",
        userId: "user-1",
        displayName: "Stored Alpha",
        kills: 50,
        status: "approved",
        createdAt: "2026-05-14T11:00:00.000Z",
        reviewedAt: "2026-05-14T12:00:00.000Z",
      },
    },
    sot: {
      news: {
        config: {
          presentation: { masthead: "Ops Desk" },
        },
      },
    },
  };

  compileDailyNewsDigest({
    db,
    targetDayKey: "2026-05-14",
    now: "2026-05-14T18:00:00.000Z",
    windowEndAt: "2026-05-14T18:00:00.000Z",
  });

  db.submissions = {
    base: {
      id: "base",
      userId: "user-2",
      displayName: "Live Beta",
      kills: 5,
      status: "approved",
      createdAt: "2026-05-14T09:00:00.000Z",
      reviewedAt: "2026-05-14T10:00:00.000Z",
    },
    liveJump: {
      id: "liveJump",
      userId: "user-2",
      displayName: "Live Beta",
      kills: 105,
      status: "approved",
      createdAt: "2026-05-14T11:00:00.000Z",
      reviewedAt: "2026-05-14T12:00:00.000Z",
    },
  };

  const result = await runDailyNewsOperatorAction({
    db,
    action: DAILY_NEWS_OPERATOR_ACTIONS.RERUN_DAY,
    dayKey: "2026-05-14",
    now: "2026-05-15T08:00:00.000Z",
  });

  assert.equal(result.digest.publicEdition.kills.topUpgrades[0].displayName, "Stored Alpha");
  assert.equal(db.sot.news.runtime.lastPreviewRequest.dayKey, "2026-05-14");
  assert.equal(db.sot.news.runtime.lastPreviewRequest.status, "stored_rendered");
});
