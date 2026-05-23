"use strict";

const { renderDailyNewsIssue } = require("./render");
const { ensureNewsState } = require("./state");

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function resolveNowIso(now) {
  if (typeof now === "function") return cleanString(now(), 80) || new Date().toISOString();
  return cleanString(now, 80) || new Date().toISOString();
}

async function resolveChannel({ client, channel, channelId, label }) {
  if (channel) return channel;
  const normalizedChannelId = cleanString(channelId, 80);
  if (!normalizedChannelId) throw new Error(`${label} channel id is not configured`);
  if (!client?.channels?.fetch || typeof client.channels.fetch !== "function") {
    throw new Error(`${label} channel resolver is not available`);
  }
  const resolved = await client.channels.fetch(normalizedChannelId);
  if (!resolved || typeof resolved.send !== "function") {
    throw new Error(`${label} channel is not sendable`);
  }
  return resolved;
}

async function sendThreadMessages(publicMessage, issue, state) {
  const messages = Array.isArray(issue.publicThreadMessages) ? issue.publicThreadMessages : [];
  if (!messages.length || state.config?.presentation?.postThreadEnabled !== true) {
    return { thread: null, sentThreadMessages: [] };
  }
  if (!publicMessage || typeof publicMessage.startThread !== "function") {
    throw new Error("public message cannot start a Daily News thread");
  }
  const thread = await publicMessage.startThread({
    name: cleanString(issue.publicThreadTitle, 100) || `Daily News ${issue.dayKey}`,
    autoArchiveDuration: 1440,
  });
  if (!thread || typeof thread.send !== "function") {
    throw new Error("Daily News thread is not sendable");
  }

  const sentThreadMessages = [];
  for (const payload of messages) {
    sentThreadMessages.push(await thread.send(payload));
  }
  return { thread, sentThreadMessages };
}

function resolveDigest({ db = {}, digest = null, dayKey = "" } = {}) {
  if (digest && typeof digest === "object" && !Array.isArray(digest)) return digest;
  const state = ensureNewsState(db);
  const resolvedDayKey = cleanString(dayKey, 40) || state.runtime.lastCompiledDayKey;
  const stored = resolvedDayKey ? state.dailyDigests?.[resolvedDayKey] : null;
  if (!stored) throw new Error("daily news digest not found for publish");
  return stored;
}

async function publishDailyNewsIssue({
  db = {},
  digest = null,
  issue = null,
  dayKey = "",
  client = null,
  publicChannel = null,
  staffChannel = null,
  force = false,
  now,
  saveDb,
} = {}) {
  const state = ensureNewsState(db);
  const publishStartedAt = resolveNowIso(now);
  const resolvedDigest = resolveDigest({ db, digest, dayKey });
  const resolvedDayKey = cleanString(resolvedDigest.dayKey || dayKey, 40);
  if (!resolvedDayKey) throw new Error("daily news dayKey is required for publish");

  if (!force && state.runtime.lastPublishedDayKey === resolvedDayKey && state.runtime.lastPublishStatus === "published") {
    return {
      published: false,
      skipped: true,
      reason: "already_published",
      dayKey: resolvedDayKey,
      result: state.runtime.lastPublishResult || null,
    };
  }

  state.runtime.lastPublishStartedAt = publishStartedAt;
  state.runtime.lastPublishStatus = "running";
  state.runtime.lastFailure = null;

  try {
    const resolvedIssue = issue || renderDailyNewsIssue({ digest: resolvedDigest, config: state.config });
    const resolvedPublicChannel = await resolveChannel({
      client,
      channel: publicChannel,
      channelId: state.config?.channels?.publicChannelId,
      label: "public Daily News",
    });
    const publicMessage = await resolvedPublicChannel.send(resolvedIssue.publicMessage);
    const { thread, sentThreadMessages } = await sendThreadMessages(publicMessage, resolvedIssue, state);

    let staffMessage = null;
    const staffChannelId = cleanString(state.config?.channels?.staffChannelId, 80);
    if (staffChannel || staffChannelId) {
      const resolvedStaffChannel = await resolveChannel({
        client,
        channel: staffChannel,
        channelId: staffChannelId,
        label: "staff Daily News",
      });
      staffMessage = await resolvedStaffChannel.send(resolvedIssue.staffMessage);
    }

    const publishFinishedAt = resolveNowIso(now);
    const result = {
      dayKey: resolvedDayKey,
      publishedAt: publishFinishedAt,
      publicChannelId: cleanString(resolvedPublicChannel.id, 80) || state.config?.channels?.publicChannelId || null,
      publicMessageId: cleanString(publicMessage?.id, 80) || null,
      threadId: cleanString(thread?.id, 80) || null,
      threadMessageCount: sentThreadMessages.length,
      staffChannelId: cleanString(staffChannel?.id, 80) || staffChannelId || null,
      staffMessageId: cleanString(staffMessage?.id, 80) || null,
    };

    state.runtime.lastPublishedDayKey = resolvedDayKey;
    state.runtime.lastPublishStatus = "published";
    state.runtime.lastPublishFinishedAt = publishFinishedAt;
    state.runtime.lastPublishResult = result;
    state.runtime.lastFailure = null;
    state.dailyDigests[resolvedDayKey] = {
      ...resolvedDigest,
      publish: result,
    };

    if (typeof saveDb === "function") await saveDb();

    return {
      published: true,
      skipped: false,
      dayKey: resolvedDayKey,
      result,
      issue: resolvedIssue,
    };
  } catch (error) {
    const failedAt = resolveNowIso(now);
    state.runtime.lastPublishStatus = "failed";
    state.runtime.lastPublishFinishedAt = failedAt;
    state.runtime.lastFailure = {
      stage: "publish_daily_news_issue",
      dayKey: resolvedDayKey,
      message: cleanString(error?.message, 400) || "unknown_error",
      occurredAt: failedAt,
    };
    if (typeof saveDb === "function") await saveDb();
    throw error;
  }
}

module.exports = {
  publishDailyNewsIssue,
};
