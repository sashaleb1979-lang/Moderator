"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  attachLegacyEloReviewRecord,
  approveLegacyEloSubmission,
  editLegacyEloSubmission,
  expireLegacyEloSubmission,
  getLegacyEloRating,
  isLegacyEloSubmissionExpired,
  listLegacyEloPendingSubmissions,
  loadLegacyEloDbFile,
  removeLegacyEloRating,
  rejectLegacyEloSubmission,
  rebuildLegacyEloRatings,
  saveLegacyEloDbFile,
  supersedeLegacyEloPendingSubmissions,
  tierForLegacyElo,
  upsertDirectLegacyEloRating,
  wipeLegacyEloRatings,
} = require("../src/integrations/elo-review-store");

test("tierForLegacyElo uses current legacy thresholds", () => {
  assert.equal(tierForLegacyElo(9), null);
  assert.equal(tierForLegacyElo(10), 1);
  assert.equal(tierForLegacyElo(20), 2);
  assert.equal(tierForLegacyElo(40), 3);
  assert.equal(tierForLegacyElo(70), 4);
  assert.equal(tierForLegacyElo(110), 5);
});

test("loadLegacyEloDbFile and saveLegacyEloDbFile round-trip the legacy db shape", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "moderator-elo-review-"));
  const dbPath = path.join(tempDir, "elo-db.json");

  saveLegacyEloDbFile(dbPath, {
    submissions: {
      sub1: { id: "sub1", userId: "user1", elo: 73, tier: 4, status: "pending", createdAt: "2026-05-01T12:00:00.000Z" },
    },
  });

  const loaded = loadLegacyEloDbFile({ sourcePath: "elo-db.json", baseDir: tempDir });

  assert.equal(loaded.ok, true);
  assert.equal(loaded.error, null);
  assert.equal(loaded.rawDb.submissions.sub1.userId, "user1");
  assert.deepEqual(Object.keys(loaded.rawDb.ratings), []);
});

test("approveLegacyEloSubmission updates submission and rating from legacy pending queue", () => {
  const rawDb = {
    submissions: {
      sub1: {
        id: "sub1",
        userId: "user1",
        name: "Gojo",
        elo: 110,
        tier: 5,
        screenshotUrl: "https://proof/original",
        reviewAttachmentUrl: "https://proof/review",
        status: "pending",
        createdAt: "2026-05-01T12:00:00.000Z",
      },
    },
    ratings: {
      user1: {
        userId: "user1",
        avatarUrl: "https://avatar/gojo",
      },
    },
  };

  const result = approveLegacyEloSubmission(rawDb, "sub1", {
    reviewedBy: "mod#0001",
    reviewedAt: "2026-05-01T13:00:00.000Z",
    username: "satoru",
  });

  assert.equal(result.submission.status, "approved");
  assert.equal(result.submission.reviewedBy, "mod#0001");
  assert.equal(result.rating.userId, "user1");
  assert.equal(result.rating.username, "satoru");
  assert.equal(result.rating.elo, 110);
  assert.equal(result.rating.tier, 5);
  assert.equal(result.rating.proofUrl, "https://proof/review");
  assert.equal(result.rating.avatarUrl, "https://avatar/gojo");
});

test("editLegacyEloSubmission updates ELO and tier while submission remains pending", () => {
  const rawDb = {
    submissions: {
      sub1: {
        id: "sub1",
        userId: "user1",
        elo: 39,
        tier: 2,
        status: "pending",
        createdAt: "2026-05-01T12:00:00.000Z",
      },
    },
  };

  const result = editLegacyEloSubmission(rawDb, "sub1", "70");

  assert.equal(result.submission.status, "pending");
  assert.equal(result.submission.elo, 70);
  assert.equal(result.submission.tier, 4);
});

test("rejectLegacyEloSubmission and expireLegacyEloSubmission change submission lifecycle status", () => {
  const rawDb = {
    submissions: {
      sub1: {
        id: "sub1",
        userId: "user1",
        elo: 73,
        tier: 4,
        status: "pending",
        createdAt: "2026-05-01T12:00:00.000Z",
      },
      sub2: {
        id: "sub2",
        userId: "user2",
        elo: 20,
        tier: 2,
        status: "pending",
        createdAt: "2026-05-01T10:00:00.000Z",
      },
    },
  };

  const rejected = rejectLegacyEloSubmission(rawDb, "sub1", {
    reviewedBy: "mod#0001",
    reviewedAt: "2026-05-01T14:00:00.000Z",
    reason: "Нужен новый скрин",
  });
  const expired = expireLegacyEloSubmission(rawDb, "sub2", {
    reviewedAt: "2026-05-03T14:00:00.000Z",
  });

  assert.equal(rejected.submission.status, "rejected");
  assert.equal(rejected.submission.rejectReason, "Нужен новый скрин");
  assert.equal(expired.submission.status, "expired");
});

test("listLegacyEloPendingSubmissions and isLegacyEloSubmissionExpired work on the live legacy queue", () => {
  const rawDb = {
    submissions: {
      sub1: {
        id: "sub1",
        userId: "user1",
        elo: 73,
        tier: 4,
        status: "pending",
        createdAt: "2026-05-01T12:00:00.000Z",
      },
      sub2: {
        id: "sub2",
        userId: "user2",
        elo: 110,
        tier: 5,
        status: "pending",
        createdAt: "2026-05-01T15:00:00.000Z",
      },
      sub3: {
        id: "sub3",
        userId: "user3",
        elo: 20,
        tier: 2,
        status: "approved",
        createdAt: "2026-05-01T16:00:00.000Z",
      },
    },
  };

  const pending = listLegacyEloPendingSubmissions(rawDb, { limit: 10 });

  assert.equal(pending.length, 2);
  assert.equal(pending[0].id, "sub2");
  assert.equal(pending[1].id, "sub1");
  assert.equal(
    isLegacyEloSubmissionExpired({ createdAt: "2026-05-01T12:00:00.000Z" }, {
      nowMs: Date.parse("2026-05-03T13:00:00.000Z"),
      pendingExpireHours: 48,
    }),
    true
  );
});

test("removeLegacyEloRating removes a live rating and related mini-card entry", () => {
  const rawDb = {
    ratings: {
      user1: {
        userId: "user1",
        name: "Gojo",
        elo: 110,
        tier: 5,
        cardMessageId: "legacy-card-1",
      },
    },
    miniCards: {
      user1: "mini-card-1",
    },
  };

  const result = removeLegacyEloRating(rawDb, "user1");

  assert.equal(result.removed, true);
  assert.equal(result.removedRating.userId, "user1");
  assert.equal(result.removedMiniCardId, "mini-card-1");
  assert.equal(result.removedCardMessageId, "legacy-card-1");
  assert.equal(getLegacyEloRating(rawDb, "user1"), null);
  assert.deepEqual(rawDb.miniCards, {});
});

test("wipeLegacyEloRatings clears ratings and mini-cards and hard mode cleans legacy links", () => {
  const rawDb = {
    config: {
      indexMessageId: "legacy-index",
    },
    ratings: {
      user1: {
        userId: "user1",
        elo: 110,
        tier: 5,
        cardMessageId: "legacy-card-1",
      },
      user2: {
        userId: "user2",
        elo: 70,
        tier: 4,
      },
    },
    miniCards: {
      user1: "mini-1",
      user2: "mini-2",
    },
  };

  const result = wipeLegacyEloRatings(rawDb, { mode: "hard" });

  assert.equal(result.mode, "hard");
  assert.equal(result.removedRatings, 2);
  assert.equal(result.removedMiniCards, 2);
  assert.deepEqual(result.removedUserIds, ["user1", "user2"]);
  assert.equal(result.cleanup.clearedCardLinks, 1);
  assert.equal(result.cleanup.clearedIndexLink, true);
  assert.deepEqual(rawDb.ratings, {});
  assert.deepEqual(rawDb.miniCards, {});
  assert.equal(rawDb.config.indexMessageId, "");
});

test("rebuildLegacyEloRatings recalculates tiers and clears legacy text board links", () => {
  const rawDb = {
    config: {
      indexMessageId: "legacy-index",
    },
    ratings: {
      user1: {
        userId: "user1",
        elo: 110,
        tier: 4,
        cardMessageId: "legacy-card-1",
      },
      user2: {
        userId: "user2",
        elo: 9,
        tier: 1,
      },
      user3: {
        userId: "user3",
        elo: 70,
        tier: 4,
      },
    },
  };

  const result = rebuildLegacyEloRatings(rawDb, {
    rebuiltAt: "2026-05-01T18:00:00.000Z",
  });

  assert.equal(result.total, 3);
  assert.equal(result.retiered, 2);
  assert.equal(result.hidden, 1);
  assert.equal(result.rolesSynced, 0);
  assert.equal(result.cleanup.clearedCards, 1);
  assert.equal(result.cleanup.clearedIndexLink, true);
  assert.equal(rawDb.config.indexMessageId, "");
  assert.equal(rawDb.ratings.user1.tier, 5);
  assert.equal(rawDb.ratings.user1.updatedAt, "2026-05-01T18:00:00.000Z");
  assert.equal(Object.prototype.hasOwnProperty.call(rawDb.ratings.user1, "cardMessageId"), false);
  assert.equal(rawDb.ratings.user2.tier, null);
  assert.equal(rawDb.ratings.user3.tier, 4);
});

test("upsertDirectLegacyEloRating supersedes pending submissions and creates manual approved state", () => {
  const rawDb = {
    submissions: {
      pending1: {
        id: "pending1",
        userId: "user1",
        elo: 70,
        tier: 4,
        status: "pending",
        createdAt: "2026-05-01T10:00:00.000Z",
      },
    },
    ratings: {
      user1: {
        userId: "user1",
        name: "Old Name",
        username: "old_user",
        avatarUrl: "https://avatar/old",
      },
    },
  };

  const result = upsertDirectLegacyEloRating(rawDb, {
    submissionId: "manual1",
    userId: "user1",
    displayName: "Gojo",
    username: "satoru",
    rawText: "110 elo",
    screenshotUrl: "https://proof/original.png",
    reviewedBy: "mod#0001",
    reviewedAt: "2026-05-01T12:00:00.000Z",
    createdAt: "2026-05-01T12:00:00.000Z",
    avatarUrl: "https://avatar/new",
  });

  assert.equal(result.supersededCount, 1);
  assert.deepEqual(result.supersededSubmissionIds, ["pending1"]);
  assert.equal(rawDb.submissions.pending1.status, "superseded");
  assert.equal(rawDb.submissions.pending1.rejectReason, "Добавлено/обновлено модератором напрямую");
  assert.equal(result.submission.id, "manual1");
  assert.equal(result.submission.status, "approved");
  assert.equal(result.submission.manual, true);
  assert.equal(result.rating.userId, "user1");
  assert.equal(result.rating.elo, 110);
  assert.equal(result.rating.tier, 5);
  assert.equal(result.rating.name, "Gojo");
  assert.equal(result.rating.username, "satoru");
  assert.equal(result.rating.proofUrl, "https://proof/original.png");
  assert.equal(result.rating.avatarUrl, "https://avatar/new");
});

test("attachLegacyEloReviewRecord writes review links back to submission and rating proof", () => {
  const rawDb = {
    submissions: {
      manual1: {
        id: "manual1",
        userId: "user1",
        screenshotUrl: "https://proof/original.png",
        reviewImage: "attachment://proof.png",
        status: "approved",
        reviewedAt: "2026-05-01T12:00:00.000Z",
      },
    },
    ratings: {
      user1: {
        userId: "user1",
        name: "Gojo",
        elo: 110,
        tier: 5,
        proofUrl: "https://proof/original.png",
      },
    },
  };

  const result = attachLegacyEloReviewRecord(rawDb, "manual1", {
    reviewChannelId: "review-1",
    reviewMessageId: "review-msg-1",
    reviewAttachmentUrl: "https://cdn.discordapp.com/review-proof.png",
    updatedAt: "2026-05-01T12:10:00.000Z",
  });

  assert.equal(result.submission.reviewChannelId, "review-1");
  assert.equal(result.submission.reviewMessageId, "review-msg-1");
  assert.equal(result.submission.reviewAttachmentUrl, "https://cdn.discordapp.com/review-proof.png");
  assert.equal(result.submission.reviewImage, "https://cdn.discordapp.com/review-proof.png");
  assert.equal(result.rating.proofUrl, "https://cdn.discordapp.com/review-proof.png");
  assert.equal(result.rating.updatedAt, "2026-05-01T12:10:00.000Z");
});

test("supersedeLegacyEloPendingSubmissions only touches pending records for one user", () => {
  const rawDb = {
    submissions: {
      pending1: { id: "pending1", userId: "user1", status: "pending" },
      approved1: { id: "approved1", userId: "user1", status: "approved" },
      pending2: { id: "pending2", userId: "user2", status: "pending" },
    },
  };

  const result = supersedeLegacyEloPendingSubmissions(rawDb, "user1", {
    reviewedBy: "mod#0001",
    reviewedAt: "2026-05-01T13:00:00.000Z",
    reason: "manual override",
  });

  assert.equal(result.changed, 1);
  assert.deepEqual(result.changedIds, ["pending1"]);
  assert.equal(rawDb.submissions.pending1.status, "superseded");
  assert.equal(rawDb.submissions.pending1.reviewedBy, "mod#0001");
  assert.equal(rawDb.submissions.pending1.rejectReason, "manual override");
  assert.equal(rawDb.submissions.approved1.status, "approved");
  assert.equal(rawDb.submissions.pending2.status, "pending");
});