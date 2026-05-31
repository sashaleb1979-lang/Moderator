"use strict";

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function createLegacyEloReviewSync(options = {}) {
  const buildReviewPayload = typeof options.buildReviewPayload === "function"
    ? options.buildReviewPayload
    : null;
  const fetchReviewMessage = typeof options.fetchReviewMessage === "function"
    ? options.fetchReviewMessage
    : null;

  if (!buildReviewPayload) {
    throw new TypeError("buildReviewPayload must be a function");
  }

  if (!fetchReviewMessage) {
    throw new TypeError("fetchReviewMessage must be a function");
  }

  async function syncReviewMessage(client, submission, statusLabel, syncOptions = {}) {
    const reviewPayload = buildReviewPayload(submission, statusLabel, syncOptions.components || []);
    const reviewMessage = await fetchReviewMessage(client, submission);
    const updatedReviewMessage = reviewMessage
      ? await reviewMessage.edit(reviewPayload).catch(() => null)
      : null;

    return {
      reviewPayload,
      reviewMessageUpdated: Boolean(updatedReviewMessage),
      updatedReviewMessage,
    };
  }

  async function updateReviewStatusFromInteraction(client, interaction, submission, statusLabel, noticeText = "", syncOptions = {}) {
    const reviewPayload = buildReviewPayload(submission, statusLabel, syncOptions.components || []);
    const interactionReviewMessageId = cleanString(interaction?.message?.id, 80);
    const canonicalReviewMessageId = cleanString(submission?.reviewMessageId, 80);

    if (interactionReviewMessageId && canonicalReviewMessageId && interactionReviewMessageId === canonicalReviewMessageId) {
      await interaction.update(reviewPayload);
      return {
        usedCanonicalInteractionMessage: true,
        reviewMessageUpdated: true,
        updatedReviewMessage: null,
        reviewPayload,
      };
    }

    const syncResult = await syncReviewMessage(client, submission, statusLabel, syncOptions);
    const fallbackNotice = syncResult.reviewMessageUpdated
      ? "Основное review-сообщение обновлено."
      : "Заявка обработана, но основное review-сообщение не удалось обновить.";
    const resolvedNotice = syncResult.reviewMessageUpdated
      ? cleanString(noticeText || fallbackNotice)
      : cleanString(syncOptions.degradedNoticeText || fallbackNotice);

    await interaction.update({
      content: resolvedNotice || fallbackNotice,
      embeds: [],
      components: [],
    });

    return {
      usedCanonicalInteractionMessage: false,
      reviewMessageUpdated: syncResult.reviewMessageUpdated,
      updatedReviewMessage: syncResult.updatedReviewMessage,
      reviewPayload,
    };
  }

  return {
    syncReviewMessage,
    updateReviewStatusFromInteraction,
  };
}

module.exports = {
  createLegacyEloReviewSync,
};