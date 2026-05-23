"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { compileDailyNewsPreview, renderStoredDailyNewsPreview } = require("../src/news/preview");

test("compileDailyNewsPreview compiles stores and renders a preview issue", () => {
  let saveCount = 0;
  const db = {
    profiles: {
      "user-1": { displayName: "Alpha" },
    },
    submissions: {
      old: {
        id: "old",
        userId: "user-1",
        displayName: "Alpha",
        kills: 10,
        status: "approved",
        createdAt: "2026-05-14T09:00:00.000Z",
        reviewedAt: "2026-05-14T10:00:00.000Z",
      },
      jump: {
        id: "jump",
        userId: "user-1",
        displayName: "Alpha",
        kills: 50,
        status: "approved",
        createdAt: "2026-05-14T11:00:00.000Z",
        reviewedAt: "2026-05-14T12:00:00.000Z",
      },
    },
    sot: {
      news: {
        config: {
          presentation: {
            masthead: "Preview Desk",
          },
        },
      },
    },
  };

  const result = compileDailyNewsPreview({
    db,
    targetDayKey: "2026-05-14",
    now: "2026-05-14T18:00:00.000Z",
    windowEndAt: "2026-05-14T18:00:00.000Z",
    saveDb: () => {
      saveCount += 1;
    },
  });

  assert.equal(result.compiled, true);
  assert.equal(result.issue.coverSpec.masthead, "Preview Desk");
  assert.match(result.issue.publicMessage.content, /Preview Desk/);
  assert.equal(db.sot.news.runtime.lastPreviewRequest.status, "rendered");
  assert.equal(db.sot.news.runtime.lastPreviewRequest.dayKey, "2026-05-14");
  assert.equal(saveCount, 1);

  const stored = renderStoredDailyNewsPreview({ db, dayKey: "2026-05-14" });
  assert.match(stored.issue.publicMessage.embeds[0].fields[0].value, /Alpha/);
});

test("renderStoredDailyNewsPreview reports missing digests clearly", () => {
  assert.throws(
    () => renderStoredDailyNewsPreview({ db: { sot: { news: {} } }, dayKey: "2026-05-14" }),
    /daily news digest not found for preview/
  );
});
