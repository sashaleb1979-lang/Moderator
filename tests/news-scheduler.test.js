"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveDailyNewsWindowEndAt,
  runDailyNewsCompileTick,
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

test("runDailyNewsCompileTick compiles the current Moscow day once after publish hour", () => {
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

  const result = runDailyNewsCompileTick({
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

  const secondResult = runDailyNewsCompileTick({
    db,
    now: "2026-05-14T20:45:00.000Z",
    compileDailyNewsDigestFn() {
      throw new Error("should not rerun for the same day");
    },
  });

  assert.equal(secondResult.compiled, false);
  assert.equal(secondResult.reason, "already_compiled");
});

test("runDailyNewsCompileTick runs beforeCompile hook before compiling the digest", () => {
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

  const result = runDailyNewsCompileTick({
    db,
    now: "2026-05-14T20:40:00.000Z",
    beforeCompile() {
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