"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { DAILY_NEWS_OPERATOR_ACTIONS, buildDailyNewsStatusPayload, runDailyNewsOperatorAction } = require("../src/news/operator");

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
  assert.match(status.content, /compile: \*\*compiled\*\*/);
  assert.match(status.content, /publish: \*\*idle\*\*/);
});

test("runDailyNewsOperatorAction publishes through publisher owner", async () => {
  const publicChannel = createFakeChannel("public");
  const db = {
    profiles: {},
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
  assert.match(result.payload.content, /publish: \*\*published\*\*/);
});
