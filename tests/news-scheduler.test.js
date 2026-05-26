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