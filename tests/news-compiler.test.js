"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildMoscowWallClockMs,
  compileDailyNewsDigest,
  resolveMoscowDayKey,
} = require("../src/news/compiler");

test("resolveMoscowDayKey uses fixed Moscow wall clock boundaries", () => {
  assert.equal(resolveMoscowDayKey("2026-05-14T20:59:59.999Z"), "2026-05-14");
  assert.equal(resolveMoscowDayKey("2026-05-14T21:00:00.000Z"), "2026-05-15");
});

test("compileDailyNewsDigest aggregates Moscow-day voice visitors including open sessions", () => {
  const db = {
    sot: {
      news: {
        voice: {
          openSessions: {
            "user-3": {
              guildId: "guild-1",
              userId: "user-3",
              displayName: "Gamma",
              joinedAt: "2026-05-14T17:30:00.000Z",
              currentChannelId: "voice-gamma",
              enteredChannelIds: ["voice-gamma"],
              moveCount: 0,
              incomplete: false,
              incompleteReason: null,
            },
          },
          finalizedSessions: [
            {
              guildId: "guild-1",
              userId: "user-1",
              displayName: "NightOwl",
              joinedAt: "2026-05-13T20:30:00.000Z",
              endedAt: "2026-05-13T22:30:00.000Z",
              durationSeconds: 7200,
              enteredChannelIds: ["voice-night"],
              finalChannelId: "voice-night",
              moveCount: 1,
              incomplete: false,
              incompleteReason: null,
            },
            {
              guildId: "guild-1",
              userId: "user-2",
              displayName: "Alpha",
              joinedAt: "2026-05-14T14:00:00.000Z",
              endedAt: "2026-05-14T16:00:00.000Z",
              durationSeconds: 7200,
              enteredChannelIds: ["voice-alpha"],
              finalChannelId: "voice-alpha",
              moveCount: 0,
              incomplete: false,
              incompleteReason: null,
            },
            {
              guildId: "guild-1",
              userId: "user-4",
              displayName: "RecoveredBeta",
              joinedAt: null,
              endedAt: "2026-05-14T17:45:00.000Z",
              durationSeconds: 0,
              enteredChannelIds: ["voice-recovered"],
              finalChannelId: "voice-recovered",
              moveCount: 0,
              incomplete: true,
              incompleteReason: "missing_open_session",
            },
          ],
        },
        moderation: {
          events: [],
        },
      },
    },
  };

  const result = compileDailyNewsDigest({
    db,
    targetDayKey: "2026-05-14",
    now: "2026-05-14T18:00:00.000Z",
  });

  assert.equal(result.compiled, true);
  assert.equal(result.dayKey, "2026-05-14");
  assert.equal(result.digest.coverageWindow.startAt, "2026-05-13T21:00:00.000Z");
  assert.equal(result.digest.coverageWindow.endAt, "2026-05-14T18:00:00.000Z");
  assert.equal(result.digest.coverageWindow.mode, "publish_snapshot");

  assert.equal(result.digest.voice.visitorCount, 4);
  assert.deepEqual(result.digest.voice.topVisitors.map((entry) => entry.displayName), [
    "Alpha",
    "NightOwl",
    "Gamma",
    "RecoveredBeta",
  ]);
  assert.equal(result.digest.voice.topVisitors[0].totalDurationSeconds, 7200);
  assert.equal(result.digest.voice.topVisitors[1].totalDurationSeconds, 5400);
  assert.equal(result.digest.voice.topVisitors[2].totalDurationSeconds, 1800);
  assert.equal(result.digest.voice.topVisitors[3].totalDurationSeconds, 0);
  assert.equal(result.digest.voice.allVisitorsLine, "NightOwl, Alpha, Gamma, RecoveredBeta");
  assert.equal(result.digest.voice.partial, true);
  assert.deepEqual(result.digest.voice.partialReasons, ["incomplete_voice_recovery"]);
  assert.equal(result.digest.audit.rawCandidateCounts.voiceSessions, 4);
  assert.equal(result.digest.audit.bucketCounts.published_public, 3);
  assert.equal(result.digest.audit.bucketCounts.ambiguous_source, 1);
  assert.equal(db.sot.news.runtime.lastCompiledDayKey, "2026-05-14");
  assert.equal(db.sot.news.runtime.lastCompileStatus, "compiled");
  assert.equal(db.sot.news.runtime.lastCoverageSummary.partial, true);
});

test("compileDailyNewsDigest respects a fixed Moscow cutoff even when the compile starts later", () => {
  const db = {
    sot: {
      news: {
        voice: {
          openSessions: {},
          finalizedSessions: [
            {
              guildId: "guild-1",
              userId: "user-1",
              displayName: "LateNight",
              joinedAt: "2026-05-14T17:30:00.000Z",
              endedAt: "2026-05-14T20:30:00.000Z",
              durationSeconds: 10800,
              enteredChannelIds: ["voice-late"],
              finalChannelId: "voice-late",
              moveCount: 0,
              incomplete: false,
              incompleteReason: null,
            },
          ],
        },
        moderation: {
          events: [],
        },
      },
    },
  };

  const windowEndAt = new Date(buildMoscowWallClockMs("2026-05-14", 21)).toISOString();
  const result = compileDailyNewsDigest({
    db,
    targetDayKey: "2026-05-14",
    now: "2026-05-14T20:40:00.000Z",
    windowEndAt,
  });

  assert.equal(result.digest.coverageWindow.endAt, "2026-05-14T18:00:00.000Z");
  assert.equal(result.digest.coverageWindow.requestedEndAt, "2026-05-14T18:00:00.000Z");
  assert.equal(result.digest.coverageWindow.mode, "fixed_cutoff");
  assert.equal(result.digest.voice.topVisitors[0].totalDurationSeconds, 1800);
});

test("compileDailyNewsDigest keeps ambiguous removals staff-only and publishes clear bans", () => {
  const db = {
    sot: {
      news: {
        voice: {
          openSessions: {},
          finalizedSessions: [],
        },
        moderation: {
          events: [
            {
              eventType: "member_remove",
              guildId: "guild-1",
              userId: "user-10",
              displayName: "GoneAlpha",
              occurredAt: "2026-05-14T15:30:00.000Z",
              resolution: "leave_or_kick_ambiguous",
            },
            {
              eventType: "ban_add",
              guildId: "guild-1",
              userId: "user-11",
              displayName: "BannedBeta",
              occurredAt: "2026-05-14T16:00:00.000Z",
              resolution: "ban_confirmed",
            },
            {
              eventType: "ban_remove",
              guildId: "guild-1",
              userId: "user-12",
              displayName: "UnbannedGamma",
              occurredAt: "2026-05-14T17:00:00.000Z",
              resolution: "unban_confirmed",
            },
          ],
        },
      },
    },
  };

  const result = compileDailyNewsDigest({
    db,
    targetDayKey: "2026-05-14",
    now: "2026-05-14T18:00:00.000Z",
  });

  assert.equal(result.digest.moderation.totalCount, 3);
  assert.equal(result.digest.moderation.ambiguousCount, 1);
  assert.deepEqual(result.digest.moderation.publicHighlights.map((entry) => entry.displayName), [
    "BannedBeta",
    "UnbannedGamma",
  ]);
  assert.deepEqual(result.digest.staffDigest.moderation.events.map((entry) => entry.displayName), [
    "GoneAlpha",
    "BannedBeta",
    "UnbannedGamma",
  ]);
  assert.deepEqual(result.digest.staffDigest.moderation.events.map((entry) => entry.bucket), [
    "ambiguous_source",
    "published_public",
    "published_public",
  ]);
  assert.equal(result.digest.coverage.ambiguous, true);
  assert.deepEqual(result.digest.coverage.reasons, ["ambiguous_moderation"]);
  assert.equal(db.sot.news.runtime.lastAuditCounts.rawCandidateCounts.total, 3);
  assert.equal(db.sot.news.runtime.lastAuditCounts.emittedCounts.publicModerationHighlights, 2);
  assert.equal(result.digest.audit.bucketCounts.published_public, 2);
  assert.equal(result.digest.audit.bucketCounts.ambiguous_source, 1);
});