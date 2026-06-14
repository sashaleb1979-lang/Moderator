"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveDailyNewsWindowEndAt,
  runDailyNewsCompileTick,
  runDailyNewsReleaseTick,
  shouldRunDailyNewsCompileTick,
} = require("../src/news/scheduler");

test("shouldRunDailyNewsCompileTick waits for Moscow publish hour and respects disabled state", () => {
  const disabledDb = { sot: { news: { config: { enabled: false } } } };
  const disabledResult = shouldRunDailyNewsCompileTick({
    db: disabledDb,
    now: "2026-05-14T18:00:00.000Z",
  });

  assert.equal(disabledResult.shouldRun, false);
  assert.equal(disabledResult.reason, "disabled");

  const beforeHourDb = { sot: { news: { config: { enabled: true, schedule: { publishHourMsk: 21 } } } } };
  const beforeHourResult = shouldRunDailyNewsCompileTick({
    db: beforeHourDb,
    now: "2026-05-14T17:59:59.000Z",
  });

  assert.equal(beforeHourResult.shouldRun, false);
  assert.equal(beforeHourResult.reason, "before_publish_hour");
  assert.equal(beforeHourResult.dayKey, "2026-05-14");
});

test("runDailyNewsCompileTick compiles the current Moscow day once after publish hour", async () => {
  const calls = [];
  let saveCount = 0;
  const db = {
    sot: {
      news: {
        config: {
          enabled: true,
          schedule: {
            publishHourMsk: 21,
          },
        },
      },
    },
  };

  const result = await runDailyNewsCompileTick({
    db,
    now: "2026-05-14T20:40:00.000Z",
    saveDb() {
      saveCount += 1;
    },
    compileDailyNewsDigestFn(args) {
      calls.push(args);
      db.sot.news.runtime.lastCompiledDayKey = args.targetDayKey;
      return { digest: { dayKey: args.targetDayKey } };
    },
  });

  assert.equal(result.compiled, true);
  assert.equal(result.mode, "shadow");
  assert.equal(result.dayKey, "2026-05-14");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].targetDayKey, "2026-05-14");
  assert.equal(calls[0].windowEndAt, resolveDailyNewsWindowEndAt("2026-05-14", 21));
  assert.equal(calls[0].historySnapshotMode, "capture_if_current_day");
  assert.equal(db.sot.news.runtime.lastCompileStatus, "shadow_compiled");
  assert.equal(db.sot.news.runtime.lastPublishStatus, null);
  assert.equal(saveCount, 1);

  const secondResult = await runDailyNewsCompileTick({
    db,
    now: "2026-05-14T20:45:00.000Z",
    compileDailyNewsDigestFn() {
      throw new Error("should not rerun for the same day");
    },
  });

  assert.equal(secondResult.compiled, false);
  assert.equal(secondResult.reason, "already_compiled");
});

test("runDailyNewsCompileTick runs beforeCompile hook before compiling the digest", async () => {
  let beforeCompileCount = 0;
  const db = {
    sot: {
      news: {
        config: {
          enabled: true,
          schedule: { publishHourMsk: 21 },
        },
        moderation: {
          events: [
            {
              eventType: "member_remove",
              guildId: "guild-1",
              userId: "user-1",
              displayName: "KickLater",
              occurredAt: "2026-05-14T18:00:00.000Z",
              resolution: "leave_or_kick_ambiguous",
            },
          ],
        },
      },
    },
  };

  const result = await runDailyNewsCompileTick({
    db,
    now: "2026-05-14T20:40:00.000Z",
    async beforeCompile() {
      beforeCompileCount += 1;
      db.sot.news.moderation.events[0].resolution = "kick_confirmed";
    },
    compileDailyNewsDigestFn(args) {
      assert.equal(db.sot.news.moderation.events[0].resolution, "kick_confirmed");
      db.sot.news.runtime.lastCompiledDayKey = args.targetDayKey;
      return { digest: { dayKey: args.targetDayKey } };
    },
  });

  assert.equal(result.compiled, true);
  assert.equal(beforeCompileCount, 1);
});

test("runDailyNewsReleaseTick recompiles an already compiled day when beforeCompile changes reconciliation state", async () => {
  const compileCalls = [];
  const publishCalls = [];
  const db = {
    sot: {
      news: {
        config: {
          enabled: true,
          publish: {
            autoPublishEnabled: true,
          },
          schedule: {
            publishHourMsk: 21,
          },
          channels: {
            publicChannelId: "public-room",
          },
        },
        dailyDigests: {
          "2026-05-14": {
            dayKey: "2026-05-14",
            stamp: "stale",
          },
        },
        runtime: {
          lastCompiledDayKey: "2026-05-14",
          lastCompileStatus: "shadow_compiled",
        },
        moderation: {
          events: [
            {
              eventType: "member_remove",
              resolution: "leave_or_kick_ambiguous",
            },
          ],
        },
      },
    },
  };

  const result = await runDailyNewsReleaseTick({
    db,
    now: "2026-05-14T20:45:00.000Z",
    async beforeCompile() {
      db.sot.news.moderation.events[0].resolution = "kick_confirmed";
      return { updatedCount: 1 };
    },
    compileDailyNewsDigestFn(args) {
      compileCalls.push({
        ...args,
        resolution: db.sot.news.moderation.events[0].resolution,
      });
      db.sot.news.runtime.lastCompiledDayKey = args.targetDayKey;
      db.sot.news.dailyDigests[args.targetDayKey] = { dayKey: args.targetDayKey, stamp: "refreshed" };
      return { digest: { dayKey: args.targetDayKey, stamp: "refreshed" } };
    },
    publishDailyNewsIssueFn(args) {
      publishCalls.push(args);
      return {
        published: true,
        skipped: false,
        dayKey: args.dayKey,
        result: { publicMessageId: "public-3" },
      };
    },
  });

  assert.equal(result.compiled, true);
  assert.equal(compileCalls.length, 1);
  assert.equal(compileCalls[0].resolution, "kick_confirmed");
  assert.equal(publishCalls.length, 1);
  assert.equal(publishCalls[0].digest.stamp, "refreshed");
});

test("runDailyNewsReleaseTick auto-publishes after compile when enabled", async () => {
  const compileCalls = [];
  const publishCalls = [];
  const db = {
    sot: {
      news: {
        config: {
          enabled: true,
          publish: {
            autoPublishEnabled: true,
          },
          schedule: {
            publishHourMsk: 21,
          },
          channels: {
            publicChannelId: "public-room",
            staffChannelId: "staff-room",
          },
        },
      },
    },
  };

  const result = await runDailyNewsReleaseTick({
    db,
    now: "2026-05-14T20:40:00.000Z",
    compileDailyNewsDigestFn(args) {
      compileCalls.push(args);
      db.sot.news.runtime.lastCompiledDayKey = args.targetDayKey;
      return { digest: { dayKey: args.targetDayKey } };
    },
    publishDailyNewsIssueFn(args) {
      publishCalls.push(args);
      return {
        published: true,
        skipped: false,
        dayKey: args.dayKey,
        result: { publicMessageId: "public-1" },
      };
    },
  });

  assert.equal(result.compiled, true);
  assert.equal(result.published, true);
  assert.equal(result.publishSkipped, false);
  assert.equal(result.releaseMode, "auto_publish");
  assert.equal(compileCalls.length, 1);
  assert.equal(publishCalls.length, 1);
  assert.equal(publishCalls[0].dayKey, "2026-05-14");
  assert.equal(publishCalls[0].publishMode, "public");
});

test("runDailyNewsReleaseTick retries publish for an already compiled day when auto-publish is enabled", async () => {
  const publishCalls = [];
  const db = {
    sot: {
      news: {
        config: {
          enabled: true,
          publish: {
            autoPublishEnabled: true,
          },
          schedule: {
            publishHourMsk: 21,
          },
          channels: {
            publicChannelId: "public-room",
          },
        },
        dailyDigests: {
          "2026-05-14": {
            dayKey: "2026-05-14",
          },
        },
        runtime: {
          lastCompiledDayKey: "2026-05-14",
          lastCompileStatus: "shadow_compiled",
        },
      },
    },
  };

  const result = await runDailyNewsReleaseTick({
    db,
    now: "2026-05-14T20:45:00.000Z",
    compileDailyNewsDigestFn() {
      throw new Error("compile should not rerun");
    },
    publishDailyNewsIssueFn(args) {
      publishCalls.push(args);
      return {
        published: true,
        skipped: false,
        dayKey: args.dayKey,
        result: { publicMessageId: "public-2" },
      };
    },
  });

  assert.equal(result.compiled, false);
  assert.equal(result.reason, "already_compiled");
  assert.equal(result.published, true);
  assert.equal(publishCalls.length, 1);
  assert.equal(publishCalls[0].dayKey, "2026-05-14");
});

test("runDailyNewsReleaseTick does not duplicate an already published auto day from stored metadata", async () => {
  const publishCalls = [];
  const db = {
    sot: {
      news: {
        config: {
          enabled: true,
          publish: {
            autoPublishEnabled: true,
          },
          schedule: {
            publishHourMsk: 21,
          },
          channels: {
            publicChannelId: "public-room",
          },
        },
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
          lastCompiledDayKey: "2026-05-14",
          lastCompileStatus: "shadow_compiled",
          lastPublishedDayKey: null,
          lastPublishStatus: null,
        },
      },
    },
  };

  const result = await runDailyNewsReleaseTick({
    db,
    now: "2026-05-14T20:45:00.000Z",
    compileDailyNewsDigestFn() {
      throw new Error("compile should not rerun");
    },
    publishDailyNewsIssueFn(args) {
      publishCalls.push(args);
      return {
        published: false,
        skipped: true,
        reason: "already_published",
        dayKey: args.dayKey,
        result: db.sot.news.dailyDigests["2026-05-14"].publish,
      };
    },
  });

  assert.equal(result.releaseMode, "auto_publish");
  assert.equal(result.published, false);
  assert.equal(result.publishSkipped, true);
  assert.equal(result.publishReason, "already_published");
  assert.equal(publishCalls.length, 1);
});

test("runDailyNewsReleaseTick keeps compile-only mode when auto-publish is disabled", async () => {
  let publishCalled = false;
  const db = {
    sot: {
      news: {
        config: {
          enabled: true,
          publish: {
            autoPublishEnabled: false,
          },
          schedule: {
            publishHourMsk: 21,
          },
          channels: {
            publicChannelId: "public-room",
          },
        },
      },
    },
  };

  const result = await runDailyNewsReleaseTick({
    db,
    now: "2026-05-14T20:40:00.000Z",
    compileDailyNewsDigestFn(args) {
      db.sot.news.runtime.lastCompiledDayKey = args.targetDayKey;
      return { digest: { dayKey: args.targetDayKey } };
    },
    publishDailyNewsIssueFn() {
      publishCalled = true;
      throw new Error("publish should stay disabled");
    },
  });

  assert.equal(result.compiled, true);
  assert.equal(result.published, false);
  assert.equal(result.publishSkipped, true);
  assert.equal(result.publishReason, "auto_publish_disabled");
  assert.equal(result.releaseMode, "manual_only");
  assert.equal(publishCalled, false);
});

test("runDailyNewsReleaseTick recompiles historical queue items before publishing them", async () => {
  const compileCalls = [];
  const publishCalls = [];
  const db = {
    sot: {
      news: {
        config: {
          enabled: false,
          publish: {
            autoPublishEnabled: false,
          },
          channels: {
            publicChannelId: "public-room",
          },
        },
        dailyDigests: {
          "2026-05-20": {
            dayKey: "2026-05-20",
            stamp: "prepared",
          },
        },
        runtime: {
          releaseQueue: {
            active: true,
            dayKeys: ["2026-05-20", "2026-05-21"],
          },
        },
      },
    },
  };

  const result = await runDailyNewsReleaseTick({
    db,
    now: "2026-05-23T10:00:00.000Z",
    compileDailyNewsDigestFn(args) {
      compileCalls.push(args);
      return { digest: { dayKey: args.targetDayKey, stamp: "recompiled-for-queue" } };
    },
    publishDailyNewsIssueFn(args) {
      publishCalls.push(args);
      return {
        published: true,
        skipped: false,
        dayKey: args.dayKey,
        result: { publicMessageId: "public-queue-1" },
      };
    },
  });

  assert.equal(compileCalls.length, 1);
  assert.equal(compileCalls[0].targetDayKey, "2026-05-20");
  assert.equal(result.releaseMode, "history_queue");
  assert.equal(result.dayKey, "2026-05-20");
  assert.equal(result.published, true);
  assert.equal(result.publishSkipped, false);
  assert.equal(publishCalls.length, 1);
  assert.equal(publishCalls[0].force, false);
  assert.equal(publishCalls[0].digest.stamp, "recompiled-for-queue");
  assert.deepEqual(db.sot.news.runtime.releaseQueue.dayKeys, ["2026-05-21"]);
  assert.equal(db.sot.news.runtime.releaseQueue.active, true);
  assert.equal(db.sot.news.runtime.releaseQueue.lastReleasedDayKey, "2026-05-20");
  assert.equal(db.sot.news.runtime.releaseQueue.completedDayCount, 1);
  assert.equal(db.sot.news.runtime.releaseQueue.currentDayKey, null);
});

test("runDailyNewsReleaseTick compiles missing historical queue digest and stops when queue is drained", async () => {
  const compileCalls = [];
  const db = {
    sot: {
      news: {
        config: {
          enabled: false,
          publish: {
            autoPublishEnabled: false,
          },
          channels: {
            publicChannelId: "public-room",
          },
        },
        runtime: {
          releaseQueue: {
            active: true,
            dayKeys: ["2026-05-22"],
          },
        },
      },
    },
  };

  const result = await runDailyNewsReleaseTick({
    db,
    now: "2026-05-23T10:05:00.000Z",
    compileDailyNewsDigestFn(args) {
      compileCalls.push(args);
      db.sot.news.dailyDigests = {
        ...(db.sot.news.dailyDigests || {}),
        [args.targetDayKey]: { dayKey: args.targetDayKey, stamp: "compiled-on-demand" },
      };
      return { digest: { dayKey: args.targetDayKey, stamp: "compiled-on-demand" } };
    },
    publishDailyNewsIssueFn(args) {
      return {
        published: true,
        skipped: false,
        dayKey: args.dayKey,
        result: { publicMessageId: "public-queue-2" },
      };
    },
  });

  assert.equal(compileCalls.length, 1);
  assert.equal(compileCalls[0].targetDayKey, "2026-05-22");
  assert.equal(result.compiled, true);
  assert.equal(result.releaseMode, "history_queue");
  assert.deepEqual(db.sot.news.runtime.releaseQueue.dayKeys, []);
  assert.equal(db.sot.news.runtime.releaseQueue.active, false);
  assert.equal(db.sot.news.runtime.releaseQueue.lastReleasedDayKey, "2026-05-22");
  assert.equal(db.sot.news.runtime.releaseQueue.completedDayCount, 1);
});

test("runDailyNewsReleaseTick keeps the historical queue item when publish is skipped", async () => {
  const compileCalls = [];
  const db = {
    sot: {
      news: {
        config: {
          enabled: false,
          publish: {
            autoPublishEnabled: false,
          },
          channels: {
            publicChannelId: "public-room",
          },
        },
        dailyDigests: {
          "2026-05-20": {
            dayKey: "2026-05-20",
            stamp: "prepared",
          },
        },
        runtime: {
          releaseQueue: {
            active: true,
            dayKeys: ["2026-05-20", "2026-05-21"],
            lastReleasedDayKey: null,
            lastReleasedAt: null,
          },
        },
      },
    },
  };

  const result = await runDailyNewsReleaseTick({
    db,
    now: "2026-05-23T10:00:00.000Z",
    compileDailyNewsDigestFn(args) {
      compileCalls.push(args);
      return { digest: { dayKey: args.targetDayKey, stamp: "recompiled" } };
    },
    publishDailyNewsIssueFn() {
      return {
        published: false,
        skipped: true,
        reason: "temporary_delivery_guard",
      };
    },
  });

  assert.equal(result.releaseMode, "history_queue");
  assert.equal(result.dayKey, "2026-05-20");
  assert.equal(result.published, false);
  assert.equal(result.publishSkipped, true);
  assert.equal(result.publishFailed, true);
  assert.equal(result.publishReason, "temporary_delivery_guard");
  assert.equal(compileCalls.length, 1);
  assert.equal(result.queueRemainingCount, 2);
  assert.deepEqual(db.sot.news.runtime.releaseQueue.dayKeys, ["2026-05-20", "2026-05-21"]);
  assert.equal(db.sot.news.runtime.releaseQueue.active, true);
  assert.equal(db.sot.news.runtime.releaseQueue.currentDayKey, "2026-05-20");
  assert.equal(db.sot.news.runtime.releaseQueue.lastFailedDayKey, "2026-05-20");
  assert.equal(db.sot.news.runtime.releaseQueue.lastFailureMessage, "temporary_delivery_guard");
  assert.equal(db.sot.news.runtime.releaseQueue.lastReleasedDayKey, null);
  assert.equal(db.sot.news.runtime.releaseQueue.lastReleasedAt, null);
});

test("runDailyNewsReleaseTick skips already published historical queue items without sending again", async () => {
  const compileCalls = [];
  const publishCalls = [];
  const db = {
    sot: {
      news: {
        config: {
          channels: {
            publicChannelId: "public-room",
          },
        },
        dailyDigests: {
          "2026-05-20": {
            dayKey: "2026-05-20",
            publish: {
              publishMode: "public",
              publicMessageId: "public-old",
            },
          },
        },
        runtime: {
          releaseQueue: {
            active: true,
            dayKeys: ["2026-05-20", "2026-05-21"],
          },
        },
      },
    },
  };

  const result = await runDailyNewsReleaseTick({
    db,
    now: "2026-05-23T10:00:00.000Z",
    compileDailyNewsDigestFn(args) {
      compileCalls.push(args);
      return { digest: { dayKey: args.targetDayKey, stamp: "fresh-format" } };
    },
    publishDailyNewsIssueFn(args) {
      publishCalls.push(args);
      return {
        published: true,
        skipped: false,
        dayKey: args.dayKey,
        result: { publicMessageId: "public-new" },
      };
    },
  });

  assert.equal(compileCalls.length, 0);
  assert.equal(publishCalls.length, 0);
  assert.equal(result.releaseMode, "history_queue");
  assert.equal(result.dayKey, "2026-05-20");
  assert.equal(result.published, false);
  assert.equal(result.publishSkipped, true);
  assert.equal(result.publishReason, "already_published");
  assert.deepEqual(db.sot.news.runtime.releaseQueue.dayKeys, ["2026-05-21"]);
  assert.equal(db.sot.news.runtime.releaseQueue.lastReleasedDayKey, "2026-05-20");
  assert.equal(db.sot.news.runtime.releaseQueue.skippedAlreadyPublishedCount, 1);
  assert.equal(db.sot.news.runtime.releaseQueue.lastFailedDayKey, null);
});

test("runDailyNewsReleaseTick republishes already published historical queue items when forced", async () => {
  const compileCalls = [];
  const publishCalls = [];
  const db = {
    sot: {
      news: {
        config: {
          channels: {
            publicChannelId: "public-room",
          },
        },
        dailyDigests: {
          "2026-05-20": {
            dayKey: "2026-05-20",
            publish: {
              publishMode: "public",
              publicMessageId: "public-old",
            },
          },
        },
        runtime: {
          releaseQueue: {
            active: true,
            forceRepublish: true,
            dayKeys: ["2026-05-20", "2026-05-21"],
          },
        },
      },
    },
  };

  const result = await runDailyNewsReleaseTick({
    db,
    now: "2026-05-23T10:00:00.000Z",
    compileDailyNewsDigestFn(args) {
      compileCalls.push(args);
      return { digest: { dayKey: args.targetDayKey, stamp: "fresh-format" } };
    },
    publishDailyNewsIssueFn(args) {
      publishCalls.push(args);
      return {
        published: true,
        skipped: false,
        dayKey: args.dayKey,
        result: { publicMessageId: "public-new" },
      };
    },
  });

  assert.equal(compileCalls.length, 1);
  assert.equal(publishCalls.length, 1);
  assert.equal(publishCalls[0].force, true);
  assert.equal(result.releaseMode, "history_queue");
  assert.equal(result.dayKey, "2026-05-20");
  assert.equal(result.published, true);
  assert.equal(result.publishSkipped, false);
  assert.deepEqual(db.sot.news.runtime.releaseQueue.dayKeys, ["2026-05-21"]);
  assert.equal(db.sot.news.runtime.releaseQueue.completedDayCount, 1);
  assert.equal(db.sot.news.runtime.releaseQueue.skippedAlreadyPublishedCount, 0);
});

test("runDailyNewsReleaseTick keeps historical queue item when publish throws", async () => {
  const compileCalls = [];
  const db = {
    sot: {
      news: {
        config: {
          channels: {
            publicChannelId: "public-room",
          },
        },
        dailyDigests: {
          "2026-05-20": {
            dayKey: "2026-05-20",
            stamp: "prepared",
          },
        },
        runtime: {
          releaseQueue: {
            active: true,
            dayKeys: ["2026-05-20", "2026-05-21"],
          },
        },
      },
    },
  };

  const result = await runDailyNewsReleaseTick({
    db,
    now: "2026-05-23T10:00:00.000Z",
    compileDailyNewsDigestFn(args) {
      compileCalls.push(args);
      return { digest: { dayKey: args.targetDayKey, stamp: "recompiled" } };
    },
    publishDailyNewsIssueFn() {
      throw new Error("send failed");
    },
  });

  assert.equal(result.releaseMode, "history_queue");
  assert.equal(result.dayKey, "2026-05-20");
  assert.equal(result.publishFailed, true);
  assert.equal(result.publishReason, "publish_failed");
  assert.equal(compileCalls.length, 1);
  assert.deepEqual(db.sot.news.runtime.releaseQueue.dayKeys, ["2026-05-20", "2026-05-21"]);
  assert.equal(db.sot.news.runtime.releaseQueue.active, true);
  assert.equal(db.sot.news.runtime.releaseQueue.currentDayKey, "2026-05-20");
  assert.equal(db.sot.news.runtime.releaseQueue.lastFailedDayKey, "2026-05-20");
  assert.match(db.sot.news.runtime.releaseQueue.lastFailureMessage, /send failed/);
  assert.equal(db.sot.news.runtime.releaseQueue.lastFailureAt, "2026-05-23T10:00:00.000Z");
  assert.match(db.sot.news.runtime.lastFailure.message, /send failed/);
});

test("runDailyNewsReleaseTick records waiting state when historical queue has no public channel", async () => {
  const db = {
    sot: {
      news: {
        config: {
          channels: {
            publicChannelId: "",
          },
        },
        runtime: {
          releaseQueue: {
            active: true,
            dayKeys: ["2026-05-20"],
          },
        },
      },
    },
  };

  const result = await runDailyNewsReleaseTick({
    db,
    now: "2026-05-23T10:00:00.000Z",
    compileDailyNewsDigestFn() {
      throw new Error("should wait before compiling");
    },
    publishDailyNewsIssueFn() {
      throw new Error("should wait before publishing");
    },
  });

  assert.equal(result.publishReason, "missing_public_channel");
  assert.deepEqual(db.sot.news.runtime.releaseQueue.dayKeys, ["2026-05-20"]);
  assert.equal(db.sot.news.runtime.releaseQueue.lastFailedDayKey, "2026-05-20");
  assert.match(db.sot.news.runtime.releaseQueue.lastFailureMessage, /публичный канал/);
});
