"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { compileDailyNewsDigest } = require("../src/news/compiler");
const { renderDailyNewsIssue } = require("../src/news/render");
const { publishDailyNewsIssue } = require("../src/news/publisher");
const { ensureNewsState } = require("../src/news/state");

function createFakeChannel(id = "channel-1") {
  const sent = [];
  return {
    id,
    sent,
    async send(payload) {
      const message = {
        id: `${id}-message-${sent.length + 1}`,
        payload,
        threadMessages: [],
        async startThread(options) {
          this.thread = {
            id: `${this.id}-thread`,
            options,
            sent: this.threadMessages,
            async send(threadPayload) {
              this.sent.push(threadPayload);
              return { id: `${this.id}-thread-message-${this.sent.length}`, payload: threadPayload };
            },
          };
          return this.thread;
        },
      };
      sent.push(message);
      return message;
    },
  };
}

test("publishDailyNewsIssue sends public thread and staff payload once per day", async () => {
  let saveCount = 0;
  const db = {
    profiles: {},
    sot: {
      news: {
        config: {
          channels: { publicChannelId: "public", staffChannelId: "staff" },
          voice: { includeFullList: true, publishFullListInThread: true },
          presentation: { postThreadEnabled: true },
        },
        voice: {
          finalizedSessions: [
            { userId: "user-1", displayName: "VoiceOne", joinedAt: "2026-05-14T10:00:00.000Z", endedAt: "2026-05-14T10:30:00.000Z" },
          ],
        },
      },
    },
  };
  const state = ensureNewsState(db);
  const result = compileDailyNewsDigest({ db, targetDayKey: "2026-05-14", now: "2026-05-14T18:00:00.000Z" });
  const issue = renderDailyNewsIssue({ digest: result.digest, config: state.config });
  const publicChannel = createFakeChannel("public");
  const staffChannel = createFakeChannel("staff");

  const published = await publishDailyNewsIssue({
    db,
    digest: result.digest,
    issue,
    publicChannel,
    staffChannel,
    now: "2026-05-14T18:05:00.000Z",
    saveDb: () => { saveCount += 1; },
  });

  assert.equal(published.published, true);
  assert.equal(publicChannel.sent.length, 1);
  assert.equal(publicChannel.sent[0].payload.files[0].name, "daily-news-2026-05-14.png");
  assert.equal(publicChannel.sent[0].payload.embeds[0].image.url, "attachment://daily-news-2026-05-14.png");
  assert.equal(publicChannel.sent[0].threadMessages.length, 1);
  assert.equal(staffChannel.sent.length, 1);
  assert.equal(db.sot.news.runtime.lastPublishStatus, "published");
  assert.equal(db.sot.news.runtime.lastPublishedDayKey, "2026-05-14");
  assert.equal(db.sot.news.runtime.lastPublishResult.publicMessageId, "public-message-1");
  assert.equal(db.sot.news.runtime.lastPublishResult.coverFileName, "daily-news-2026-05-14.png");
  assert.equal(saveCount, 1);

  const duplicate = await publishDailyNewsIssue({ db, digest: result.digest, publicChannel, staffChannel });
  assert.equal(duplicate.skipped, true);
  assert.equal(duplicate.reason, "already_published");
  assert.equal(publicChannel.sent.length, 1);
});

test("publishDailyNewsIssue records failure without marking publish success", async () => {
  const db = {
    sot: {
      news: {
        config: { channels: { publicChannelId: "public" } },
        dailyDigests: {
          "2026-05-14": {
            dayKey: "2026-05-14",
            compiledAt: "2026-05-14T18:00:00.000Z",
            coverageWindow: { startAt: "2026-05-13T21:00:00.000Z", endAt: "2026-05-14T18:00:00.000Z" },
            publicEdition: {},
            staffDigest: {},
            coverage: {},
            audit: { rawCandidateCounts: { total: 0 }, bucketCounts: {} },
          },
        },
      },
    },
  };
  const failingChannel = { id: "public", async send() { throw new Error("send failed"); } };

  await assert.rejects(
    () => publishDailyNewsIssue({ db, dayKey: "2026-05-14", publicChannel: failingChannel }),
    /send failed/
  );
  assert.equal(db.sot.news.runtime.lastPublishStatus, "failed");
  assert.equal(db.sot.news.runtime.lastPublishedDayKey, null);
  assert.equal(db.sot.news.runtime.lastFailure.stage, "publish_daily_news_issue");
});

test("publishDailyNewsIssue can deliver a staff-only smoke issue without marking the day as publicly published", async () => {
  let saveCount = 0;
  const db = {
    profiles: {},
    sot: {
      news: {
        config: {
          channels: { staffChannelId: "staff" },
          voice: { includeFullList: true, publishFullListInThread: true },
          presentation: { postThreadEnabled: true },
        },
        voice: {
          finalizedSessions: [
            { userId: "user-1", displayName: "VoiceOne", joinedAt: "2026-05-14T10:00:00.000Z", endedAt: "2026-05-14T10:30:00.000Z" },
          ],
        },
      },
    },
  };
  const state = ensureNewsState(db);
  const result = compileDailyNewsDigest({ db, targetDayKey: "2026-05-14", now: "2026-05-14T18:00:00.000Z" });
  const issue = renderDailyNewsIssue({ digest: result.digest, config: state.config });
  const staffChannel = createFakeChannel("staff");

  const published = await publishDailyNewsIssue({
    db,
    digest: result.digest,
    issue,
    staffChannel,
    publishMode: "staff_only",
    now: "2026-05-14T18:05:00.000Z",
    saveDb: () => { saveCount += 1; },
  });

  assert.equal(published.published, true);
  assert.equal(published.publishMode, "staff_only");
  assert.equal(staffChannel.sent.length, 2);
  assert.equal(staffChannel.sent[0].payload.files[0].name, "daily-news-2026-05-14.png");
  assert.equal(staffChannel.sent[0].threadMessages.length, 1);
  assert.equal(db.sot.news.runtime.lastPublishStatus, "staff_published");
  assert.equal(db.sot.news.runtime.lastPublishedDayKey, "2026-05-14");
  assert.equal(db.sot.news.runtime.lastPublishResult.publishMode, "staff_only");
  assert.equal(db.sot.news.runtime.lastPublishResult.publicMessageId, null);
  assert.equal(db.sot.news.runtime.lastPublishResult.deliveryMessageId, "staff-message-1");
  assert.equal(db.sot.news.runtime.lastPublishResult.staffMessageId, "staff-message-2");
  assert.equal(saveCount, 1);

  const rerun = await publishDailyNewsIssue({
    db,
    digest: result.digest,
    issue,
    staffChannel,
    publishMode: "staff_only",
  });
  assert.equal(rerun.published, true);
  assert.equal(staffChannel.sent.length, 4);
});

test("publishDailyNewsIssue does not duplicate the public release when staff audit delivery fails", async () => {
  const db = {
    profiles: {},
    sot: {
      news: {
        config: {
          channels: { publicChannelId: "public", staffChannelId: "staff" },
          voice: { includeFullList: true, publishFullListInThread: false },
          presentation: { postThreadEnabled: false },
        },
        voice: {
          finalizedSessions: [
            { userId: "user-1", displayName: "VoiceOne", joinedAt: "2026-05-14T10:00:00.000Z", endedAt: "2026-05-14T10:30:00.000Z" },
          ],
        },
      },
    },
  };
  const state = ensureNewsState(db);
  const result = compileDailyNewsDigest({ db, targetDayKey: "2026-05-14", now: "2026-05-14T18:00:00.000Z" });
  const issue = renderDailyNewsIssue({ digest: result.digest, config: state.config });
  const publicChannel = createFakeChannel("public");
  const failingStaffChannel = {
    id: "staff",
    async send() {
      throw new Error("staff send failed");
    },
  };

  const published = await publishDailyNewsIssue({
    db,
    digest: result.digest,
    issue,
    publicChannel,
    staffChannel: failingStaffChannel,
    now: "2026-05-14T18:05:00.000Z",
  });

  assert.equal(published.published, true);
  assert.equal(db.sot.news.runtime.lastPublishStatus, "published");
  assert.equal(db.sot.news.runtime.lastPublishedDayKey, "2026-05-14");
  assert.equal(publicChannel.sent.length, 1);
  assert.equal(published.result.warningCount, 1);
  assert.match(published.result.warnings[0], /audit message delivery failed: staff send failed/i);

  const duplicate = await publishDailyNewsIssue({
    db,
    digest: result.digest,
    publicChannel,
    staffChannel: failingStaffChannel,
  });

  assert.equal(duplicate.skipped, true);
  assert.equal(duplicate.reason, "already_published");
  assert.equal(publicChannel.sent.length, 1);
});
