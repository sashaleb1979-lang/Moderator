"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DAILY_NEWS_OPERATOR_ACTIONS,
  DAILY_NEWS_PANEL_OPEN_ID,
  DAILY_NEWS_PANEL_PREVIEW_DAY_ID,
  DAILY_NEWS_PANEL_PREVIEW_DAY_MODAL_ID,
  DAILY_NEWS_PANEL_PUBLISH_STAFF_ONLY_ID,
  DAILY_NEWS_PANEL_PREVIEW_TODAY_ID,
  buildDailyNewsOperatorPanelPayload,
  buildDailyNewsStatusPayload,
  handleDailyNewsPanelButtonInteraction,
  handleDailyNewsPanelModalSubmitInteraction,
  runDailyNewsOperatorAction,
} = require("../src/news/operator");

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

function createModalInteraction(customId, dayKey) {
  return {
    customId,
    member: { id: "mod-1" },
    followUps: [],
    edits: [],
    deferred: false,
    replied: false,
    fields: {
      getTextInputValue() {
        return dayKey;
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
  assert.match(status.content, /compile: \*\*готово для preview\*\*/);
  assert.match(status.content, /publish: \*\*не опубликовано\*\*/);
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
  assert.match(result.payload.content, /publish: \*\*опубликовано\*\*/);
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
  assert.match(result.payload.content, /publish: \*\*отправлено только в staff\*\*/);
});

test("buildDailyNewsOperatorPanelPayload shows runtime summary and disables publish without public channel", () => {
  const payload = buildDailyNewsOperatorPanelPayload({
    db: { sot: { news: { config: { presentation: { masthead: "Ops Desk" } } } } },
    includeFlags: false,
  });

  assert.equal(payload.embeds[0].data.title, "Daily News Operator");
  assert.match(payload.embeds[0].data.description, /Ops Desk/);
  assert.match(payload.embeds[0].data.description, /Ежедневный тик: \*\*выключен\*\*/);
  assert.match(payload.embeds[0].data.description, /Режим выпуска: \*\*manual-only\*\*/);
  assert.equal(/Авто-публикация/.test(payload.embeds[0].data.description), false);
  assert.match(payload.embeds[0].data.fields[0].value, /Статус: \*\*не запускалась\*\*/);
  assert.match(payload.embeds[0].data.fields[1].value, /Статус: \*\*не опубликовано\*\*/);
  assert.equal(payload.components[0].components[4].data.disabled, true);
  assert.equal(payload.components[1].components[0].data.disabled, true);
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

  assert.match(payload.embeds[0].data.fields[1].value, /Режим: \*\*staff-only smoke\*\*/);
  assert.match(payload.embeds[0].data.fields[1].value, /Delivery msg: \*\*staff-1\*\*/);
  assert.match(payload.embeds[0].data.fields[1].value, /Audit msg: \*\*staff-2\*\*/);
});

test("handleDailyNewsPanelButtonInteraction opens panel previews today and exact-day modal", async () => {
  const db = {
    profiles: {},
    sot: { news: { config: { presentation: { masthead: "Ops Desk" } } } },
  };
  const openInteraction = createButtonInteraction(DAILY_NEWS_PANEL_OPEN_ID);
  const previewInteraction = createButtonInteraction(DAILY_NEWS_PANEL_PREVIEW_TODAY_ID);
  const dayModalInteraction = createButtonInteraction(DAILY_NEWS_PANEL_PREVIEW_DAY_ID);

  await handleDailyNewsPanelButtonInteraction({
    interaction: openInteraction,
    db,
    isModerator: () => true,
    replyNoPermission: async () => {},
    buildBackPayload: async () => ({ content: "back" }),
  });
  assert.equal(openInteraction.updatedPayload.embeds[0].data.title, "Daily News Operator");

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
  assert.equal(previewInteraction.edits[0].embeds[0].data.title, "Daily News Operator");

  await handleDailyNewsPanelButtonInteraction({
    interaction: dayModalInteraction,
    db,
    isModerator: () => true,
    replyNoPermission: async () => {},
  });
  assert.equal(dayModalInteraction.shownModal.toJSON().custom_id, DAILY_NEWS_PANEL_PREVIEW_DAY_MODAL_ID);
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
  assert.equal(interaction.followUps[0].files[0].name, "daily-news-2026-05-14.png");
  assert.ok(interaction.followUps.length >= 2);
});
