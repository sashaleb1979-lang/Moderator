"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  createLegacyEloReviewSync,
} = require("../src/integrations/elo-review-sync");

const welcomeBotSource = fs.readFileSync(path.join(__dirname, "..", "welcome-bot.js"), "utf8");

test("updateLegacyEloReviewStatusFromInteraction edits the clicked message when it is the canonical review message", async () => {
  const payloads = [];
  let fetchCalls = 0;
  const reviewSync = createLegacyEloReviewSync({
    buildReviewPayload: (submission, statusLabel) => ({ embeds: [{ submissionId: submission.id, statusLabel }], components: [] }),
    fetchReviewMessage: async () => {
      fetchCalls += 1;
      return null;
    },
  });

  const submission = { id: "sub-1", reviewMessageId: "review-1" };
  const interaction = {
    message: { id: "review-1" },
    async update(payload) {
      payloads.push(payload);
    },
  };

  const result = await reviewSync.updateReviewStatusFromInteraction({}, interaction, submission, "approved", "ignored");

  assert.equal(fetchCalls, 0);
  assert.deepEqual(payloads, [
    { embeds: [{ submissionId: "sub-1", statusLabel: "approved" }], components: [] },
  ]);
  assert.deepEqual(result, {
    usedCanonicalInteractionMessage: true,
    reviewMessageUpdated: true,
    updatedReviewMessage: null,
    reviewPayload: { embeds: [{ submissionId: "sub-1", statusLabel: "approved" }], components: [] },
  });
});

test("updateLegacyEloReviewStatusFromInteraction edits the stored review message and clears noncanonical review previews", async () => {
  const interactionPayloads = [];
  const reviewEdits = [];
  const reviewSync = createLegacyEloReviewSync({
    buildReviewPayload: (submission, statusLabel) => ({ embeds: [{ submissionId: submission.id, statusLabel }], components: [] }),
    fetchReviewMessage: async () => ({
      async edit(payload) {
        reviewEdits.push(payload);
        return { id: "review-1" };
      },
    }),
  });

  const submission = { id: "sub-1", reviewMessageId: "review-1" };
  const interaction = {
    message: { id: "preview-1" },
    async update(payload) {
      interactionPayloads.push(payload);
    },
  };

  const result = await reviewSync.updateReviewStatusFromInteraction(
    {},
    interaction,
    submission,
    "approved",
    "Одобрено. Основное review-сообщение обновлено."
  );

  assert.deepEqual(reviewEdits, [
    { embeds: [{ submissionId: "sub-1", statusLabel: "approved" }], components: [] },
  ]);
  assert.deepEqual(interactionPayloads, [
    {
      content: "Одобрено. Основное review-сообщение обновлено.",
      embeds: [],
      components: [],
    },
  ]);
  assert.deepEqual(result, {
    usedCanonicalInteractionMessage: false,
    reviewMessageUpdated: true,
    updatedReviewMessage: { id: "review-1" },
    reviewPayload: { embeds: [{ submissionId: "sub-1", statusLabel: "approved" }], components: [] },
  });
});

test("updateLegacyEloReviewStatusFromInteraction falls back to a degraded notice when the canonical review message is missing", async () => {
  const interactionPayloads = [];
  const reviewSync = createLegacyEloReviewSync({
    buildReviewPayload: (submission, statusLabel) => ({ embeds: [{ submissionId: submission.id, statusLabel }], components: [] }),
    fetchReviewMessage: async () => null,
  });

  const submission = { id: "sub-1", reviewMessageId: "review-1" };
  const interaction = {
    message: { id: "preview-1" },
    async update(payload) {
      interactionPayloads.push(payload);
    },
  };

  const result = await reviewSync.updateReviewStatusFromInteraction({}, interaction, submission, "rejected");

  assert.deepEqual(interactionPayloads, [
    {
      content: "Заявка обработана, но основное review-сообщение не удалось обновить.",
      embeds: [],
      components: [],
    },
  ]);
  assert.deepEqual(result, {
    usedCanonicalInteractionMessage: false,
    reviewMessageUpdated: false,
    updatedReviewMessage: null,
    reviewPayload: { embeds: [{ submissionId: "sub-1", statusLabel: "rejected" }], components: [] },
  });
});

test("updateLegacyEloReviewStatusFromInteraction uses explicit degraded notice when preview cleanup cannot update the canonical message", async () => {
  const interactionPayloads = [];
  const reviewSync = createLegacyEloReviewSync({
    buildReviewPayload: (submission, statusLabel) => ({ embeds: [{ submissionId: submission.id, statusLabel }], components: [] }),
    fetchReviewMessage: async () => ({
      async edit() {
        return null;
      },
    }),
  });

  const result = await reviewSync.updateReviewStatusFromInteraction(
    {},
    {
      message: { id: "preview-1" },
      async update(payload) {
        interactionPayloads.push(payload);
      },
    },
    { id: "sub-1", reviewMessageId: "review-1" },
    "approved",
    "Одобрено. Основное review-сообщение обновлено.",
    { degradedNoticeText: "Одобрено, но основное review-сообщение не удалось обновить." }
  );

  assert.deepEqual(interactionPayloads, [
    {
      content: "Одобрено, но основное review-сообщение не удалось обновить.",
      embeds: [],
      components: [],
    },
  ]);
  assert.equal(result.reviewMessageUpdated, false);
});

test("syncReviewMessage preserves provided review components for pending review updates", async () => {
  const reviewEdits = [];
  const reviewSync = createLegacyEloReviewSync({
    buildReviewPayload: (submission, statusLabel, components = []) => ({ embeds: [{ submissionId: submission.id, statusLabel }], components }),
    fetchReviewMessage: async () => ({
      async edit(payload) {
        reviewEdits.push(payload);
        return { id: "review-1" };
      },
    }),
  });

  const result = await reviewSync.syncReviewMessage({}, { id: "sub-1", reviewMessageId: "review-1" }, "pending", {
    components: [{ id: "row-1" }],
  });

  assert.deepEqual(reviewEdits, [
    { embeds: [{ submissionId: "sub-1", statusLabel: "pending" }], components: [{ id: "row-1" }] },
  ]);
  assert.deepEqual(result, {
    reviewPayload: { embeds: [{ submissionId: "sub-1", statusLabel: "pending" }], components: [{ id: "row-1" }] },
    reviewMessageUpdated: true,
    updatedReviewMessage: { id: "review-1" },
  });
});

test("welcome-bot modal ELO review paths surface degraded notices when canonical review sync fails", () => {
  assert.match(
    welcomeBotSource,
    /const reviewStatus = await legacyEloReviewSync\.syncReviewMessage\(client, edited\.submission, "pending", \{[\s\S]*?content: reviewStatus\.reviewMessageUpdated[\s\S]*?ELO обновлено: \$\{edited\.submission\.elo\} \(тир \$\{edited\.submission\.tier\}\), но основное review-сообщение не удалось обновить\./
  );

  assert.match(
    welcomeBotSource,
    /const reviewStatus = await legacyEloReviewSync\.syncReviewMessage\(client, rejected\.submission, "rejected"\);[\s\S]*?content: reviewStatus\.reviewMessageUpdated[\s\S]*?Отклонено, но основное review-сообщение не удалось обновить\./
  );

  assert.match(
    welcomeBotSource,
    /const reviewStatus = await legacyEloReviewSync\.syncReviewMessage\(client, expired\.submission, "expired"\);[\s\S]*?content: reviewStatus\.reviewMessageUpdated[\s\S]*?Заявка протухла и помечена expired, но основное review-сообщение не удалось обновить\./
  );
});