"use strict";

// Tournament interaction operator. Factory mirrors src/antiteam/operator.js:
// createTournamentOperator(deps) returns handleSlashCommand / handleButtonInteraction
// / handleSelectMenuInteraction / handleModalSubmitInteraction, each returning a
// boolean "handled". All Discord I/O goes through injected deps so the module
// stays decoupled from welcome-bot.js internals.

const { MessageFlags, ChannelType, AttachmentBuilder } = require("discord.js");

const {
  TOURNAMENT_COMMAND_NAME,
  ACTIONS,
  buildCustomId,
  parseCustomId,
} = require("./commands");
const view = require("./view");
const { parseMskDateTime } = require("./time");
const seeding = require("./seeding");
const state = require("./state");
const bracketImage = require("./bracket-image");
const { killTierFor } = require("../onboard/kill-tiers");

const UNKNOWN_INTERACTION_CODES = new Set([10062, 40060]);
const DEFAULT_THREAD_ADMIN_ROLE_IDS = Object.freeze(["1486459664546926866"]);
const AVATAR_FETCH_TIMEOUT_MS = 2500;
const SERVER_IMAGE_RENDER_TIMEOUT_MS = 12000;

function isUnknownInteractionError(error) {
  return Boolean(error && UNKNOWN_INTERACTION_CODES.has(error.code));
}

function toPositiveIntOrNull(value) {
  const number = Number(String(value).replace(/[^\d]/g, ""));
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function toPositiveKills(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function normalizeSnowflakeIds(values = []) {
  const source = Array.isArray(values) ? values : [values];
  return source
    .map((value) => String(value || "").trim())
    .filter((id) => /^\d{5,25}$/.test(id))
    .filter((id, index, ids) => ids.indexOf(id) === index);
}

function withTimeout(promise, timeoutMs, fallback = null) {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(fallback), timeoutMs);
      if (typeof timer.unref === "function") timer.unref();
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function createTournamentOperator(deps = {}) {
  const {
    db,
    saveDb = () => {},
    runSerializedMutation = async (opts) => opts.mutate(),
    isModerator = () => false,
    logError = () => {},
    resolveRobloxUser = async () => null,
    getPlayerSnapshot = () => ({}),
    fetchChannel = async () => null,
    fetchImageBuffer = null, // (url) => Promise<Buffer|null>  (v2 art)
    renderImage = null, // (exportName, model) => Promise<Buffer>  (v2 art, off-thread)
    fetchAvatarHeadshots = null, // (robloxUserIds) => Promise<[{targetId,imageUrl}]>  (test harness)
    logLine = async () => {},
    writeRobloxBinding = async () => null,
    grantRole = async () => ({ skipped: "no-grant-dep" }), // (userId, roleId, reason)
    removeRole = async () => ({ skipped: "no-remove-dep" }), // (userId, roleId, reason)
    fetchMember = async () => null, // (userId) => member|null
    threadAdminRoleIds = DEFAULT_THREAD_ADMIN_ROLE_IDS,
  } = deps;
  const privateThreadAdminRoleIds = normalizeSnowflakeIds(threadAdminRoleIds);

  // Short-lived, in-memory registration sessions (not persisted — if the bot
  // restarts mid-flow the player simply clicks "Записаться" again).
  const pending = new Map();
  const pendingKey = (tournamentId, userId) => `${tournamentId}:${userId}`;

  // ---- response helpers (tolerate expired interactions) -------------------

  function withoutEphemeralFlag(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
    if (payload.flags == null) return payload;
    const next = { ...payload };
    const numericFlags = Number(next.flags);
    if (Number.isFinite(numericFlags)) {
      const stripped = numericFlags & ~MessageFlags.Ephemeral;
      if (stripped > 0) next.flags = stripped;
      else delete next.flags;
      return next;
    }
    delete next.flags;
    return next;
  }

  async function safeUpdate(interaction, payload) {
    const updatePayload = withoutEphemeralFlag(payload);
    try {
      if (interaction.deferred || interaction.replied) return await interaction.editReply(updatePayload);
      const result = await interaction.update(updatePayload);
      interaction.replied = true;
      return result;
    } catch (error) {
      if (isUnknownInteractionError(error)) return null;
      throw error;
    }
  }

  // Ensure a payload is ephemeral while preserving other flags (e.g. IsComponentsV2).
  function ensureEphemeral(payload) {
    if (!payload || typeof payload !== "object") return payload;
    const flags = Number(payload.flags) || 0;
    return { ...payload, flags: flags | MessageFlags.Ephemeral };
  }

  async function safeReply(interaction, payload) {
    const ephemeralPayload = ensureEphemeral(payload);
    try {
      if (interaction.deferred || interaction.replied) {
        return await interaction.followUp(ephemeralPayload);
      }
      const result = await interaction.reply(ephemeralPayload);
      interaction.replied = true;
      return result;
    } catch (error) {
      if (isUnknownInteractionError(error)) return null;
      throw error;
    }
  }

  async function safeDeferUpdate(interaction) {
    if (interaction.deferred || interaction.replied) return true;
    try {
      await interaction.deferUpdate();
      return true;
    } catch (error) {
      if (isUnknownInteractionError(error)) return false;
      throw error;
    }
  }

  function ephemeralText(text) {
    return { content: text, flags: MessageFlags.Ephemeral };
  }

  // For mutations whose body has an `await` (read-modify-write that can
  // interleave) — goes through the shared serialized runner.
  async function persist(label, mutate) {
    return runSerializedMutation({
      label,
      mutate: async () => {
        const result = await mutate();
        saveDb();
        return result;
      },
    });
  }

  // Fast path for SYNCHRONOUS mutations (the common case: setting object
  // properties). Node is single-threaded, so a sync mutate is already atomic —
  // no need to queue behind other modules' work in the shared runner. This is
  // the main latency win for the hot paths (match results, draft edits, toggles).
  function quickMutate(mutate) {
    const result = mutate();
    saveDb();
    return result;
  }

  // In-memory only mutation — does NOT trigger a DB flush. Used for the very hot
  // match-result clicks: persisting the whole DB (a multi-MB serialize) on every
  // single click is what froze the panel. Decisions live in memory during a run
  // and are committed to disk once on the confirmed run/stage advance. Worst case
  // on a crash mid-run: the mod re-enters the current run's few clicks.
  function mutateLocal(mutate) {
    return mutate();
  }

  async function safeLogLine(text) {
    try {
      await logLine(text);
    } catch (error) {
      logError("tournament: log line failed", error?.message || error);
    }
  }

  // ---- announcement upkeep ------------------------------------------------

  function announcementRefreshResult(status, messageId = "") {
    return {
      ok: status === "updated" || status === "relinked" || status === "republished",
      status,
      messageId,
      toString() {
        return this.ok ? "true" : "";
      },
      valueOf() {
        return this.ok;
      },
    };
  }

  function announcementStatusText(result) {
    return result?.status || (result ? "updated" : "not-updated");
  }

  function collectionValues(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value.values === "function") return [...value.values()];
    if (typeof value === "object") return Object.values(value);
    return [];
  }

  function messageMatchesAnnouncement(message, tournament) {
    if (!message || !tournament) return false;
    const registerCustomId = buildCustomId(ACTIONS.REGISTER_OPEN, tournament.id);
    const componentText = JSON.stringify(message.components || []);
    if (componentText.includes(registerCustomId)) return true;
    const expectedTitle = `🏆 ${tournament.name}`;
    return collectionValues(message.embeds).some((embed) => String(embed?.title || embed?.data?.title || "") === expectedTitle);
  }

  async function saveAnnouncementBinding(tournamentId, channelId, messageId) {
    await persist("tournament-announce-relink", async () => {
      const fresh = state.getTournament(db, tournamentId);
      if (fresh) {
        state.updateTournament(db, tournamentId, {
          announce: { channelId, messageId },
        });
      }
    });
  }

  async function editAnnouncementMessage(message, tournament, reason, source) {
    if (!message?.edit) return null;
    await message.edit(view.buildAnnouncementPayload(tournament, { ping: false }));
    const messageId = String(message.id || tournament.announce?.messageId || "");
    if (messageId && messageId !== String(tournament.announce?.messageId || "")) {
      await saveAnnouncementBinding(tournament.id, String(message.channelId || tournament.announce?.channelId || ""), messageId);
      await safeLogLine(`TOURNAMENT_ANNOUNCE_RELINK: id=${tournament.id} reason=${reason} source=${source} message=${messageId}`);
      return announcementRefreshResult("relinked", messageId);
    }
    return announcementRefreshResult("updated", messageId);
  }

  async function findAnnouncementMessage(channel, tournament, context) {
    if (!channel?.messages?.fetch) return null;
    const fetched = await channel.messages.fetch({ limit: 50 }).catch((error) => {
      logError(`tournament: announcement recent-message search failed (${context})`, error?.message || error);
      return null;
    });
    return collectionValues(fetched).find((message) => messageMatchesAnnouncement(message, tournament) && message?.edit) || null;
  }

  async function republishAnnouncement(channel, tournament, context) {
    if (!channel?.send) {
      logError(`tournament: announcement republish skipped (${context}) channel cannot send`);
      return announcementRefreshResult("failed");
    }
    const message = await channel.send(view.buildAnnouncementPayload(tournament, { ping: false })).catch((error) => {
      logError(`tournament: announcement republish failed (${context})`, error?.message || error);
      return null;
    });
    if (!message?.id) return announcementRefreshResult("failed");
    await saveAnnouncementBinding(tournament.id, String(message.channelId || channel.id || tournament.announce?.channelId || ""), String(message.id));
    await safeLogLine(`TOURNAMENT_ANNOUNCE_REPUBLISHED: ${context} newMessage=${message.id}`);
    return announcementRefreshResult("republished", String(message.id));
  }

  async function refreshAnnouncement(tournament, reason = "update") {
    if (!tournament) return announcementRefreshResult("failed");
    const announce = tournament.announce || {};
    const context = `id=${tournament.id || "unknown"} reason=${reason} channel=${announce.channelId || "none"} message=${announce.messageId || "none"}`;
    if (!announce.channelId) {
      logError(`tournament: announcement refresh skipped (${context}) missing announcement binding`);
      return announcementRefreshResult("failed");
    }
    const channel = await fetchChannel(announce.channelId).catch((error) => {
      logError(`tournament: announcement channel fetch failed (${context})`, error?.message || error);
      return null;
    });
    if (!channel) return announcementRefreshResult("failed");

    if (announce.messageId && channel.messages?.fetch) {
      const message = await channel.messages.fetch(announce.messageId).catch((error) => {
        logError(`tournament: announcement message fetch failed (${context})`, error?.message || error);
        return null;
      });
      if (message?.edit) {
        try {
          return await editAnnouncementMessage(message, tournament, reason, "stored-message");
        } catch (error) {
          logError(`tournament: announcement edit failed (${context})`, error?.message || error);
          await safeLogLine(`TOURNAMENT_ANNOUNCE_REFRESH_FAILED: ${context} error=${error?.message || error}`);
        }
      }
    }

    const discovered = await findAnnouncementMessage(channel, tournament, context);
    if (discovered) {
      try {
        return await editAnnouncementMessage(discovered, tournament, reason, "recent-search");
      } catch (error) {
        logError(`tournament: discovered announcement edit failed (${context})`, error?.message || error);
      }
    }

    return republishAnnouncement(channel, tournament, context);
  }

  const MAX_SERVERS = 3;
  function serverCount(tournament) {
    return Math.min(MAX_SERVERS, seeding.serverCountForSlots(state.activeRegistrationLimit(tournament)));
  }
  function isMultiServer(tournament) {
    return serverCount(tournament) > 1;
  }
  const FINAL_SERVER_INDEX = 90; // distinct key for the cross-server final

  // base servers that have qualified their top-4 to the final
  function qualifiedBaseServers(tournament) {
    const out = [];
    for (let i = 0; i < serverCount(tournament); i += 1) {
      const s = state.getServer(tournament, i);
      if (s && s.qualifying && Array.isArray(s.qualified) && s.qualified.length) out.push(s);
    }
    return out;
  }
  function allBaseServersQualified(tournament) {
    return isMultiServer(tournament) && qualifiedBaseServers(tournament).length >= serverCount(tournament);
  }

  function normalizeResolvedRobloxUser(value = {}, fallbackUsername = "") {
    const source = value && typeof value === "object" ? value : {};
    const userId = String(source.userId ?? source.id ?? source.robloxUserId ?? "").trim();
    const username = String(source.username ?? source.name ?? source.robloxUsername ?? fallbackUsername ?? "").trim();
    const displayName = String(source.displayName ?? source.robloxDisplayName ?? username).trim();
    if (!userId || !username) return null;
    return {
      userId,
      id: userId,
      username,
      name: username,
      displayName,
      avatarUrl: source.avatarUrl || source.robloxAvatarUrl || null,
      profileUrl: source.profileUrl || source.robloxProfileUrl || null,
      createdAt: source.createdAt || null,
      description: source.description || null,
      hasVerifiedBadge: source.hasVerifiedBadge,
      accountStatus: source.accountStatus || null,
    };
  }

  // ---- v2 image art (graceful: returns null / falls back to embeds) -------

  const imagesEnabled = typeof renderImage === "function";

  // Fetch Roblox avatar buffers for every registered player, keyed by userId.
  async function collectTournamentAvatars(tournament, players = null) {
    if (typeof fetchImageBuffer !== "function") return {};
    const avatars = {};
    const tasks = [];
    const sourcePlayers = Array.isArray(players) ? players : state.tournamentPlayers(tournament);
    for (const player of sourcePlayers) {
      const id = String(player.userId || player.id || "");
      const url = player.robloxAvatarUrl;
      if (!id || !url || avatars[id] !== undefined) continue;
      avatars[id] = null; // reserve to dedupe
      tasks.push(
        withTimeout(Promise.resolve(fetchImageBuffer(url)), AVATAR_FETCH_TIMEOUT_MS, null)
          .then((buffer) => { if (buffer) avatars[id] = buffer; })
          .catch(() => {})
      );
    }
    await Promise.allSettled(tasks);
    for (const id of Object.keys(avatars)) if (!avatars[id]) delete avatars[id];
    return avatars;
  }

  async function renderServerBracketBuffer(tournament, server, avatars) {
    if (!imagesEnabled) return null;
    try {
      const model = bracketImage.buildBracketModel({
        tournament,
        server,
        history: server.history || [],
        livePlan: server.done ? null : server.currentStage,
        liveDecisions: server.decisions || {},
        liveRunIndex: server.runIndex || 0,
        avatars,
      });
      return await withTimeout(renderImage("renderBracketCard", model), SERVER_IMAGE_RENDER_TIMEOUT_MS, null);
    } catch (error) {
      logError("tournament: bracket render failed", error?.message || error);
      return null;
    }
  }

  async function renderSummaryBuffer(tournament, avatars) {
    if (!imagesEnabled) return null;
    try {
      const model = bracketImage.buildSummaryModel({ tournament, avatars });
      return await renderImage("renderSummaryCard", model);
    } catch (error) {
      logError("tournament: summary render failed", error?.message || error);
      return null;
    }
  }

  function buildPreviewServers(tournament) {
    const count = serverCount(tournament);
    const activePlayers = state.tournamentPlayers(tournament);
    const hasStoredSplit = count > 1 && activePlayers.length > 0 && activePlayers.every((player) => {
      const index = Number(player.serverIndex);
      return Number.isInteger(index) && index >= 0 && index < count;
    });
    const buckets = hasStoredSplit
      ? Array.from({ length: count }, (_, index) => state.tournamentPlayers(tournament, { serverIndex: index }))
      : seeding.splitIntoServers(activePlayers, count);
    return buckets.map((players, index) => {
      const seededPlayers = seeding.assignSeedNumbers(players);
      return {
        index,
        label: `Сервер ${index + 1}`,
        players: seededPlayers,
        playerCount: seededPlayers.length,
        qualifyCount: count > 1 ? Math.min(seeding.QUALIFY_PER_SERVER, Math.max(1, seededPlayers.length)) : 0,
        stage: seeding.buildStage(seededPlayers, tournament.seedingMode, 1),
      };
    });
  }

  async function renderPreviewBuffer(tournament, avatars) {
    if (!imagesEnabled) return null;
    try {
      const servers = buildPreviewServers(tournament);
      const model = bracketImage.buildPreviewModel({
        tournament: {
          ...tournament,
          previewServerCount: serverCount(tournament),
          waitlistCount: state.listWaitlistRegistrations(tournament).length,
        },
        servers,
        waitlist: state.listWaitlistRegistrations(tournament),
        avatars,
      });
      return await renderImage("renderPreviewCard", model);
    } catch (error) {
      logError("tournament: preview render failed", error?.message || error);
      return null;
    }
  }

  // Attach a rendered PNG to a V2 payload (the payload's MediaGallery already
  // references attachment://<filename>). No-op when there is no buffer.
  function attachImage(payload, buffer, filename) {
    if (!buffer) return payload;
    return { ...payload, files: [...(payload.files || []), new AttachmentBuilder(buffer, { name: filename })] };
  }

  // Re-upload the player's kill-proof screenshot as a real attachment (the
  // snapshot already downloaded the bytes) so the registration card renders it
  // reliably instead of leaning on an expiring CDN URL. No-op without a buffer.
  function attachProofImage(payload, snapshot) {
    return snapshot?.lastScreenshotBuffer
      ? attachImage(payload, snapshot.lastScreenshotBuffer, snapshot.lastScreenshotFilename || "tournament-proof.png")
      : payload;
  }

  function realDiscordUserIds(players = []) {
    return normalizeSnowflakeIds(players.map((p) => p?.userId || p?.id || ""));
  }

  async function addPlayersToPrivateThread(thread, players = []) {
    const ids = realDiscordUserIds(players);
    if (!ids.length || typeof thread?.members?.add !== "function") return { ids, added: 0, failed: 0 };

    let added = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        await thread.members.add(id);
        added += 1;
      } catch (error) {
        failed += 1;
        logError(`tournament: private thread member add failed user=${id}`, error?.message || error);
      }
    }
    return { ids, added, failed };
  }

  // Edit a server's existing bracket message in place when we know its id, else
  // post a fresh one (only when allowed). Returns the message id to remember.
  // Replacing an attachment requires dropping the old one (attachments: []); we
  // keep the SAME filename so the attachment:// reference stays stable on edit.
  async function editOrSendBracketMessage(target, storedId, payload, buffer, filename, { allowCreate = true } = {}) {
    if (!target) return storedId || "";
    const files = buffer ? [new AttachmentBuilder(buffer, { name: filename })] : [];
    if (storedId && typeof target.messages?.fetch === "function") {
      const message = await target.messages.fetch(storedId).catch(() => null);
      if (message?.edit) {
        const edited = await message
          .edit({ ...payload, files, attachments: [], allowedMentions: { parse: [] } })
          .catch((error) => {
            logError("tournament: bracket edit failed", error?.message || error);
            return null;
          });
        if (edited) return String(edited.id || storedId);
      }
    }
    if (!allowCreate || typeof target.send !== "function") return storedId || "";
    const sent = await target
      .send({ ...payload, files, allowedMentions: { parse: [] } })
      .catch((error) => {
        logError("tournament: bracket send failed", error?.message || error);
        return null;
      });
    return sent?.id ? String(sent.id) : storedId || "";
  }

  // Build the live bracket payload + PNG for a server in its CURRENT state
  // (completed stages + the in-progress stage, or the final podium when done).
  async function buildServerBracketArt(tournament, server, serverIndex, avatars) {
    const isFinal = serverIndex === FINAL_SERVER_INDEX;
    const label = isFinal ? "ФИНАЛ" : `сервер ${serverIndex + 1}`;
    const filename = isFinal ? "bracket-final.png" : `bracket-server-${serverIndex + 1}.png`;
    const buffer = await renderServerBracketBuffer(tournament, server, avatars);
    const qualifying = server.qualifying;
    const playerCount = state.tournamentPlayers(tournament, serverCount(tournament) > 1 ? { serverIndex } : {}).length;
    let title;
    let headline;
    if (server.done) {
      title = qualifying ? "✅ Квалификация" : isFinal ? "🏆 Итоги финала" : "🏁 Итоги сервера";
      headline = qualifying
        ? `Сервер ${serverIndex + 1}: топ-${(server.qualified || []).length} вышли в финал`
        : isFinal
        ? "Финал завершён"
        : `Сервер ${serverIndex + 1} завершён`;
    } else {
      title = isFinal ? "🏆 ФИНАЛ" : "🗺 Сетка";
      headline = isFinal ? "🏆 Финал идёт" : `⚔️ Сервер ${serverIndex + 1} · идёт игра`;
    }
    const details = [
      isFinal
        ? `Финальная сетка: ${playerCount} игроков, прошедших из базовых серверов.`
        : `Эта сетка относится только к серверу ${serverIndex + 1}: ${playerCount} участников.`,
      "Бои проводятся через модераторскую панель. Приватная ветка под этим сервером содержит только участников этой сетки и админов с доступом к каналу.",
    ].join("\n");
    const payload = view.buildBracketPostPayload(tournament, server.currentStage, {
      serverIndex,
      serverLabel: label,
      imageFilename: buffer ? filename : "",
      title,
      headline,
      details,
    });
    return { payload, buffer, filename };
  }

  // Keep the SINGLE bracket message per server up to date: it is published once at
  // launch and then EDITED in place on every advance (run → run, stage → stage,
  // completion) so the picture the moderator first posted is the one that always
  // reflects the live state — never a fresh repost. The grand summary is the only
  // extra post, made once when the whole tournament finishes. Runs after the
  // advance mutation, outside the serialized lock, so rendering never blocks the
  // click handler.
  // Coalescing wrapper around the bracket-art render. The render is heavy (PNG +
  // avatar fetch) and, if the off-thread worker is unavailable, falls back to an
  // INLINE render that blocks the event loop. To stop that from stacking up (rapid
  // advances) and starving interaction acks, we keep at most ONE art render in
  // flight per server, coalesce extra requests into a single trailing re-render,
  // and kick it off on a `setImmediate` so the click's ack always lands first.
  const artJobs = new Map(); // `${tid}:${serverIndex}` -> { running, pending }
  function scheduleServerArtUpdate(tournamentId, serverIndex) {
    const key = `${tournamentId}:${serverIndex}`;
    let job = artJobs.get(key);
    if (!job) {
      job = { running: false, pending: false };
      artJobs.set(key, job);
    }
    job.pending = true;
    if (job.running) return;
    job.running = true;
    const pump = () => {
      job.pending = false;
      setImmediate(() => {
        updateServerArtIfNeeded(tournamentId, serverIndex)
          .catch((error) => logError("tournament: bracket art update failed", error?.message || error))
          .finally(() => {
            if (job.pending) pump();
            else job.running = false;
          });
      });
    };
    pump();
  }

  async function updateServerArtIfNeeded(tournamentId, serverIndex) {
    const tournament = state.getTournament(db, tournamentId);
    if (!tournament) return;
    const server = state.getServer(tournament, serverIndex);

    if (server && server.launched) {
      const players = state.tournamentPlayers(tournament, serverCount(tournament) > 1 ? { serverIndex } : {});
      const avatars = await collectTournamentAvatars(tournament, players);
      const { payload, buffer, filename } = await buildServerBracketArt(tournament, server, serverIndex, avatars);
      const channel = await fetchChannel(tournament.announce?.channelId).catch(() => null);
      const thread = server.threadId ? await fetchChannel(server.threadId).catch(() => null) : null;
      // Edit-only during play: launch owns the initial post, so a mid-tournament
      // advance never creates a duplicate image.
      const channelMsgId = await editOrSendBracketMessage(channel, server.launchMessageId, payload, buffer, filename, { allowCreate: false });
      const threadMsgId = await editOrSendBracketMessage(thread, server.threadBracketMessageId, payload, buffer, filename, { allowCreate: false });
      if ((channelMsgId && channelMsgId !== server.launchMessageId) || (threadMsgId && threadMsgId !== server.threadBracketMessageId)) {
        await persist("tournament-bracket-refresh", async () => {
          const fresh = state.getServer(state.getTournament(db, tournamentId), serverIndex);
          if (fresh) {
            if (channelMsgId) fresh.launchMessageId = channelMsgId;
            if (threadMsgId) fresh.threadBracketMessageId = threadMsgId;
          }
        });
      }
    }

    // The public grand summary is published explicitly from the organizer's
    // completion window, after they have a chance to add the final comment.
  }

  async function buildCompletionWindowPayload(tournament, statusText = "") {
    const filename = "tournament-summary.png";
    const buffer = await renderSummaryBuffer(tournament, await collectTournamentAvatars(tournament));
    const payload = view.buildCompletionPanelPayload(tournament, {
      imageFilename: buffer ? filename : "",
      statusText,
    });
    return attachImage(payload, buffer, filename);
  }

  async function renderCompletionWindow(interaction, tournamentId, { edit = false, statusText = "" } = {}) {
    if (!requireMod(interaction)) return true;
    const tournament = state.getTournament(db, tournamentId);
    if (!tournament) {
      await safeReply(interaction, ephemeralText("Турнир не найден."));
      return true;
    }
    const payload = await buildCompletionWindowPayload(tournament, statusText);
    edit ? await safeUpdate(interaction, payload) : await safeReply(interaction, payload);
    return true;
  }

  async function publishTournamentSummary(tournamentId) {
    const tournament = state.getTournament(db, tournamentId);
    if (!tournament) return { ok: false, reason: "missing-tournament" };
    if (tournament.status !== "completed") return { ok: false, reason: "not-completed" };
    if (tournament.summaryPosted) return { ok: true, skipped: "already-posted" };

    const channel = await fetchChannel(tournament.announce?.channelId).catch(() => null);
    if (!channel?.send) return { ok: false, reason: "missing-channel" };

    const filename = "tournament-summary.png";
    const buffer = await renderSummaryBuffer(tournament, await collectTournamentAvatars(tournament));
    const payload = view.buildSummaryPostPayload(tournament, { imageFilename: buffer ? filename : "" });
    const sendable = { ...attachImage(payload, buffer, filename), allowedMentions: { parse: [] } };
    const message = await channel.send(sendable).catch((error) => {
      logError("tournament: summary publish failed", error?.message || error);
      return null;
    });
    if (!message) return { ok: false, reason: "send-failed" };

    await persist("tournament-summary-posted", async () => {
      state.updateTournament(db, tournamentId, {
        summaryPosted: true,
        summaryPostedAt: new Date().toISOString(),
        summaryMessageId: String(message.id || ""),
        summaryChannelId: String(message.channelId || channel.id || ""),
      });
    });
    return { ok: true, messageId: String(message.id || "") };
  }

  // ---- participant role + announcement throttle + kills authority ----------

  function grantParticipantRole(tournament, userId) {
    const roleId = tournament?.participantRoleId;
    if (!roleId) return Promise.resolve(null);
    return Promise.resolve(grantRole(userId, roleId, `tournament ${tournament.id} participant`)).catch((error) =>
      logError("tournament: grant participant role failed", userId, error?.message || error)
    );
  }

  function removeParticipantRole(tournament, userId) {
    const roleId = tournament?.participantRoleId;
    if (!roleId) return Promise.resolve(null);
    return Promise.resolve(removeRole(userId, roleId, `tournament ${tournament.id} participant removed`)).catch((error) =>
      logError("tournament: remove participant role failed", userId, error?.message || error)
    );
  }

  async function syncParticipantRoles(tournament) {
    const roleId = tournament?.participantRoleId;
    if (!roleId) return { granted: 0, removed: 0 };
    const activeIds = new Set(state.listActiveRegistrations(tournament).map((reg) => String(reg.userId)));
    let granted = 0;
    let removed = 0;
    for (const reg of state.listRegistrations(tournament)) {
      if (!/^\d{5,25}$/.test(String(reg.userId))) continue;
      if (activeIds.has(String(reg.userId))) {
        const result = await Promise.resolve(grantRole(reg.userId, roleId, `tournament ${tournament.id} active participant`)).catch(() => null);
        if (result?.granted) granted += 1;
      } else {
        const result = await Promise.resolve(removeRole(reg.userId, roleId, `tournament ${tournament.id} waitlist`)).catch(() => null);
        if (result?.removed) removed += 1;
      }
    }
    return { granted, removed };
  }

  // Debounced announcement refresh — never blocks the click; coalesces bursts of
  // registrations into at most one edit every ~1.5s per tournament.
  const announceTimers = new Map();
  function scheduleAnnouncementRefresh(tournamentId, reason) {
    if (announceTimers.has(tournamentId)) return;
    const timer = setTimeout(() => {
      announceTimers.delete(tournamentId);
      const fresh = state.getTournament(db, tournamentId);
      if (fresh) refreshAnnouncement(fresh, reason).catch((error) => logError("tournament: scheduled announce refresh failed", error?.message || error));
    }, 1500);
    if (typeof timer.unref === "function") timer.unref();
    announceTimers.set(tournamentId, timer);
  }

  // Re-resolve a player's kills authoritatively from their profile (never trust
  // the losable in-memory session). Returns { approvedKills, killsSource, roblox… }.
  async function resolveAuthoritativeSnapshot(userId, registrationHint = {}) {
    const snapshot = (await Promise.resolve(getPlayerSnapshot(userId, { registration: registrationHint })).catch((error) => {
      logError("tournament: authoritative snapshot failed", userId, error?.message || error);
      return {};
    })) || {};
    return snapshot;
  }

  // =========================================================================
  // Slash command
  // =========================================================================

  async function handleSlashCommand(interaction) {
    if (interaction.commandName !== TOURNAMENT_COMMAND_NAME) return false;
    if (!isModerator(interaction.member)) {
      await safeReply(interaction, ephemeralText("Нужны права модератора."));
      return true;
    }
    await safeReply(interaction, view.buildHubPayload(state.listTournaments(db)));
    return true;
  }

  // =========================================================================
  // Buttons
  // =========================================================================

  async function handleButtonInteraction(interaction) {
    const parsed = parseCustomId(interaction.customId);
    if (!parsed) return false;
    const { action, tournamentId, extra } = parsed;

    switch (action) {
      // ----- hub / setup -----
      case ACTIONS.HUB_REFRESH:
        await safeUpdate(interaction, view.buildHubPayload(state.listTournaments(db)));
        return true;
      case ACTIONS.SETUP_OPEN:
        return openSetup(interaction);
      case ACTIONS.SETUP_BASICS:
        await interaction.showModal(view.buildBasicsModal(state.getDraft(db, interaction.user.id) || {}));
        return true;
      case ACTIONS.SETUP_TIME:
        await interaction.showModal(view.buildTimeModal(state.getDraft(db, interaction.user.id) || {}));
        return true;
      case ACTIONS.SETUP_REWARDS:
        await interaction.showModal(view.buildRewardsModal(state.getDraft(db, interaction.user.id) || {}));
        return true;
      case ACTIONS.SETUP_CONDITIONS:
        await interaction.showModal(view.buildConditionsModal(state.getDraft(db, interaction.user.id) || {}));
        return true;
      case ACTIONS.SETUP_PUBLISH:
        return publishTournament(interaction);
      case ACTIONS.SETUP_CANCEL:
        await persist("tournament-draft-cancel", async () => state.clearDraft(db, interaction.user.id));
        await safeUpdate(interaction, view.buildHubPayload(state.listTournaments(db), { statusText: "Черновик удалён." }));
        return true;

      // ----- registration flow -----
      case ACTIONS.REGISTER_OPEN:
        return openRegistration(interaction, tournamentId);
      case ACTIONS.REG_USE_MAIN:
        return confirmMainRegistration(interaction, tournamentId);
      case ACTIONS.REG_USE_OTHER:
        await interaction.showModal(view.buildRobloxNickModal(tournamentId, "alt"));
        return true;
      case ACTIONS.REG_LINK_ROBLOX:
        await interaction.showModal(view.buildRobloxNickModal(tournamentId, extra[0] || "main"));
        return true;
      case ACTIONS.REG_DECLARE_TWINK:
        await interaction.showModal(view.buildRobloxNickModal(tournamentId, "twink"));
        return true;
      case ACTIONS.REG_BACK:
        return openRegistration(interaction, tournamentId, { edit: true });
      case ACTIONS.REG_CONFIRM:
        return confirmRegistration(interaction, tournamentId);
      case ACTIONS.REG_WITHDRAW:
        return withdrawRegistration(interaction, tournamentId);

      // ----- management -----
      case ACTIONS.MANAGE_OPEN:
        return renderManage(interaction, tournamentId, { edit: true });
      case ACTIONS.MANAGE_REFRESH:
        return refreshManage(interaction, tournamentId);
      case ACTIONS.MANAGE_CLOSE_REG:
        return toggleRegistration(interaction, tournamentId, false);
      case ACTIONS.MANAGE_OPEN_REG:
        return toggleRegistration(interaction, tournamentId, true);
      case ACTIONS.MANAGE_FORM_DUELS:
        return formDuels(interaction, tournamentId);
      case ACTIONS.MANAGE_PUBLISH_PREVIEW:
        return publishPreviewAction(interaction, tournamentId);
      case ACTIONS.MANAGE_LAUNCH_SERVER:
        return launchServer(interaction, tournamentId, Number(extra[0]) || 0);
      case ACTIONS.MANAGE_LAUNCH_FINAL:
        return launchFinalServer(interaction, tournamentId);
      case ACTIONS.MANAGE_START:
        return openMatchPanel(interaction, tournamentId, Number(extra[0]) || 0);
      case ACTIONS.MANAGE_RETRY_THREAD:
        return retryThreadSideEffects(interaction, tournamentId, Number(extra[0]) || 0);
      case ACTIONS.MANAGE_CANCEL:
        return cancelTournament(interaction, tournamentId);
      case ACTIONS.SUMMARY_OPEN:
        return renderCompletionWindow(interaction, tournamentId, { edit: true });
      case ACTIONS.SUMMARY_COMMENT: {
        if (!requireMod(interaction)) return true;
        const tournament = state.getTournament(db, tournamentId);
        if (!tournament) {
          await safeReply(interaction, ephemeralText("Турнир не найден."));
          return true;
        }
        await interaction.showModal(view.buildSummaryCommentModal(tournament));
        return true;
      }
      case ACTIONS.SUMMARY_PUBLISH:
        return publishSummaryAction(interaction, tournamentId);

      // ----- roster / participants -----
      case ACTIONS.MANAGE_ROSTER:
        return openRoster(interaction, tournamentId, 0);
      case ACTIONS.ROSTER_PAGE:
        return openRoster(interaction, tournamentId, Number(extra[0]) || 0, { edit: true });
      case ACTIONS.ROSTER_KILLS_REFRESH:
        return refreshRosterKills(interaction, tournamentId);
      case ACTIONS.MANAGE_ADD_PLAYER:
        return openAddPlayer(interaction, tournamentId);
      case ACTIONS.ADD_PLAYER_MODAL:
        await interaction.showModal(view.buildAddPlayerModal(tournamentId));
        return true;
      case ACTIONS.MANAGE_REMOVE_PLAYER:
        return openRemovePlayer(interaction, tournamentId);
      case ACTIONS.MANAGE_SYNC_ROLES:
        return syncRolesAction(interaction, tournamentId);

      // ----- match results -----
      case ACTIONS.MATCH_WIN:
        return recordMatch(interaction, tournamentId, extra, "win");
      case ACTIONS.MATCH_NOSHOW:
        return recordMatch(interaction, tournamentId, extra, "noshow");
      case ACTIONS.MATCH_UNDO:
        return recordMatch(interaction, tournamentId, extra, "undo");
      case ACTIONS.STAGE_ADVANCE:
        return advanceStage(interaction, tournamentId, Number(extra[0]) || 0);

      // ----- phantom auto-fill -----
      case ACTIONS.MANAGE_FILL_ALL:
        return fillAllPlayers(interaction, tournamentId);
      case ACTIONS.MANAGE_CLEAR_PHANTOMS:
        return clearPhantoms(interaction, tournamentId);

      default:
        return false;
    }
  }

  // =========================================================================
  // Select menus
  // =========================================================================

  async function handleSelectMenuInteraction(interaction) {
    const parsed = parseCustomId(interaction.customId);
    if (!parsed) return false;
    const { action, tournamentId, extra } = parsed;
    const values = interaction.values || [];

    switch (action) {
      case ACTIONS.SETUP_MODE:
        await persist("tournament-draft-mode", async () =>
          state.setDraft(db, interaction.user.id, { seedingMode: values[0] === "seed" ? "seed" : "similar" })
        );
        return renderSetup(interaction, { edit: true });
      case ACTIONS.SETUP_PING:
        await persist("tournament-draft-ping", async () =>
          state.setDraft(db, interaction.user.id, { pingRoleIds: values })
        );
        return renderSetup(interaction, { edit: true });
      case ACTIONS.SETUP_CHANNEL:
        await persist("tournament-draft-channel", async () =>
          state.setDraft(db, interaction.user.id, { announceChannelId: values[0] || "" })
        );
        return renderSetup(interaction, { edit: true });
      case ACTIONS.SETUP_ROLE:
        await persist("tournament-draft-role", async () =>
          state.setDraft(db, interaction.user.id, { participantRoleId: values[0] || "" })
        );
        return renderSetup(interaction, { edit: true });
      case ACTIONS.REG_PICK_KILLS:
        return pickStrength(interaction, tournamentId, extra[0] || "alt", Number(values[0]) || 0);
      case ACTIONS.ADD_PLAYER_SELECT:
        return addPlayerFromSelect(interaction, tournamentId, values[0]);
      case ACTIONS.REMOVE_PLAYER_SELECT:
        return removePlayerFromSelect(interaction, tournamentId, values[0]);
      default:
        return false;
    }
  }

  // =========================================================================
  // Modal submits
  // =========================================================================

  async function handleModalSubmitInteraction(interaction) {
    const parsed = parseCustomId(interaction.customId);
    if (!parsed) return false;
    const { action, tournamentId, extra } = parsed;

    switch (action) {
      case ACTIONS.SETUP_BASICS:
        return submitBasics(interaction);
      case ACTIONS.SETUP_TIME:
        return submitTime(interaction);
      case ACTIONS.SETUP_REWARDS:
        return submitRewards(interaction);
      case ACTIONS.SETUP_CONDITIONS:
        return submitConditions(interaction);
      case ACTIONS.REG_LINK_ROBLOX:
        return submitRobloxNick(interaction, tournamentId, extra[0] || "main");
      case ACTIONS.SUMMARY_COMMENT:
        return submitSummaryComment(interaction, tournamentId);
      case ACTIONS.ADD_PLAYER_MODAL:
        return submitAddPlayer(interaction, tournamentId);
      default:
        return false;
    }
  }

  // =========================================================================
  // Setup implementation
  // =========================================================================

  async function openSetup(interaction) {
    await persist("tournament-draft-open", async () => {
      const existing = state.getDraft(db, interaction.user.id);
      if (!existing) {
        state.setDraft(db, interaction.user.id, {
          createdBy: interaction.user.id,
          createdByTag: interaction.user.tag,
          seedingMode: "similar",
          slots: 16,
        });
      }
    });
    return renderSetup(interaction, { edit: true });
  }

  async function renderSetup(interaction, { edit = false, statusText = "" } = {}) {
    const draft = state.getDraft(db, interaction.user.id) || {};
    const payload = view.buildSetupPanelPayload(draft, { statusText });
    if (edit) await safeUpdate(interaction, payload);
    else await safeReply(interaction, payload);
    return true;
  }

  async function submitBasics(interaction) {
    const name = interaction.fields.getTextInputValue("name");
    const slots = toPositiveIntOrNull(interaction.fields.getTextInputValue("slots"));
    const plannedRaw = interaction.fields.getTextInputValue("planned");
    const planned = toPositiveIntOrNull(plannedRaw);
    if (!slots) {
      await safeReply(interaction, ephemeralText("Число мест должно быть положительным."));
      return true;
    }
    await persist("tournament-draft-basics", async () =>
      state.setDraft(db, interaction.user.id, {
        name,
        slots,
        plannedPlayers: planned || slots,
      })
    );
    return renderSetup(interaction, { edit: true, statusText: "Основное обновлено." });
  }

  async function submitTime(interaction) {
    const raw = interaction.fields.getTextInputValue("time");
    const parsed = parseMskDateTime(raw);
    if (!parsed.ok) {
      await safeReply(interaction, ephemeralText(parsed.error));
      return true;
    }
    await persist("tournament-draft-time", async () =>
      state.setDraft(db, interaction.user.id, { startsAtIso: parsed.iso })
    );
    return renderSetup(interaction, { edit: true, statusText: "Время сохранено." });
  }

  async function submitRewards(interaction) {
    await safeDeferUpdate(interaction);
    const rewards = {
      first: interaction.fields.getTextInputValue("first"),
      second: interaction.fields.getTextInputValue("second"),
      third: interaction.fields.getTextInputValue("third"),
      extra: interaction.fields.getTextInputValue("extra"),
    };
    await persist("tournament-draft-rewards", async () =>
      state.setDraft(db, interaction.user.id, { rewards })
    );
    return renderSetup(interaction, { edit: true, statusText: "Награды сохранены." });
  }

  async function submitConditions(interaction) {
    const conditions = interaction.fields.getTextInputValue("conditions");
    await persist("tournament-draft-conditions", async () =>
      state.setDraft(db, interaction.user.id, { conditions })
    );
    return renderSetup(interaction, { edit: true, statusText: "Условия сохранены." });
  }

  async function publishTournament(interaction) {
    const draft = state.getDraft(db, interaction.user.id);
    if (!draft || !view.setupReady(draft)) {
      await safeReply(interaction, ephemeralText("Заполни название, места, время и канал перед публикацией."));
      return true;
    }
    const acked = await safeDeferUpdate(interaction);
    const channel = await fetchChannel(draft.announceChannelId).catch(() => null);
    if (!channel?.send) {
      await safeReply(interaction, ephemeralText("Не удалось найти канал для анонса."));
      return true;
    }

    const tournament = await persist("tournament-create", async () =>
      state.createTournamentFromDraft(db, draft, { id: state.makeId() })
    );

    // Announcement carries NO ping in its body — the ping goes into the thread.
    const message = await channel.send(view.buildAnnouncementPayload(tournament, { ping: false })).catch((error) => {
      logError("tournament: failed to post announcement", error?.message || error);
      return null;
    });
    if (!message) {
      await safeReply(interaction, ephemeralText("Не удалось опубликовать анонс."));
      return true;
    }

    // A discussion thread named after the tournament, hung right under the
    // announcement. Role pings happen INSIDE it (not in the channel).
    let threadId = "";
    if (typeof message.startThread === "function") {
      const thread = await message
        .startThread({ name: tournament.name.slice(0, 100), autoArchiveDuration: 4320 })
        .catch((error) => {
          logError("tournament: announcement thread create failed", error?.message || error);
          return null;
        });
      threadId = thread?.id || "";
      const pingRoles = Array.isArray(tournament.pingRoleIds) ? tournament.pingRoleIds : [];
      if (thread?.send && pingRoles.length) {
        await thread
          .send({ content: pingRoles.map((id) => `<@&${id}>`).join(" ") + " — открыт набор на турнир! Жми «Записаться» выше.", allowedMentions: { roles: pingRoles } })
          .catch(() => {});
      }
    }

    quickMutate(() => {
      state.updateTournament(db, tournament.id, {
        announce: { channelId: channel.id, messageId: message.id, threadId },
      });
      state.clearDraft(db, interaction.user.id);
    });

    const fresh = state.getTournament(db, tournament.id);
    await safeLogLine(`TOURNAMENT_PUBLISH: ${fresh.name} id=${fresh.id} channel=<#${channel.id}> message=${message.id} thread=${threadId || "none"} by=<@${interaction.user.id}>`);
    const payload = view.buildManagePanelPayload(fresh, {
      statusText: threadId ? "Турнир опубликован ✅ Ветка создана, роли пингнуты." : "Турнир опубликован ✅",
      serverCount: serverCount(fresh),
    });
    if (acked) await safeUpdate(interaction, payload);
    else await safeReply(interaction, payload);
    return true;
  }

  // =========================================================================
  // Registration implementation
  // =========================================================================

  async function openRegistration(interaction, tournamentId, { edit = false } = {}) {
    const tournament = state.getTournament(db, tournamentId);
    if (!tournament) {
      await safeReply(interaction, ephemeralText("Турнир не найден."));
      return true;
    }
    const userId = interaction.user.id;

    if (state.getRegistration(tournament, userId)) {
      const seat = registrationSeat(tournament, userId);
      const payload = view.buildRegisteredPayload(tournament, {
        seatNumber: seat,
        queueInfo: state.registrationQueueInfo(tournament, userId),
      });
      edit ? await safeUpdate(interaction, payload) : await safeReply(interaction, payload);
      return true;
    }
    if (tournament.registrationOpen === false) {
      await safeReply(interaction, ephemeralText("Набор на этот турнир закрыт."));
      return true;
    }

    const collectingPayload = view.buildRegCollectingPayload(tournament);
    if (edit) await safeUpdate(interaction, collectingPayload);
    else await safeReply(interaction, collectingPayload);

    const snapshot = (await Promise.resolve(getPlayerSnapshot(userId, { includeProofFile: true })).catch(() => ({}))) || {};
    const approvedKills = Number(snapshot.approvedKills) || 0;

    if (snapshot.hasRobloxAccount) {
      pending.set(pendingKey(tournamentId, userId), {
        accountKind: "main",
        approvedKills,
        robloxUsername: snapshot.robloxUsername || null,
        robloxUserId: snapshot.robloxUserId || null,
        robloxAvatarUrl: snapshot.robloxAvatarUrl || null,
      });
      const payload = view.buildRegMainConfirmPayload(tournament, {
        robloxUsername: snapshot.robloxUsername,
        robloxUserId: snapshot.robloxUserId,
        kills: approvedKills,
        avatarUrl: snapshot.robloxAvatarUrl,
        screenshotUrl: snapshot.lastScreenshotUrl,
        screenshotUnavailable: snapshot.lastScreenshotUnavailable,
      });
      await safeUpdate(interaction, attachProofImage(payload, snapshot));
      return true;
    }

    pending.set(pendingKey(tournamentId, userId), { accountKind: "main", approvedKills });
    const payload = view.buildRegNoAccountPayload(tournament, {
      kills: approvedKills,
      screenshotUrl: snapshot.lastScreenshotUrl,
      screenshotUnavailable: snapshot.lastScreenshotUnavailable,
      canTwink: state.canSelfDeclareTwink(approvedKills),
    });
    await safeUpdate(interaction, attachProofImage(payload, snapshot));
    return true;
  }

  async function confirmMainRegistration(interaction, tournamentId) {
    const userId = interaction.user.id;
    const session = pending.get(pendingKey(tournamentId, userId)) || { accountKind: "main", approvedKills: 0 };
    session.accountKind = "main";
    session.effectiveKills = session.approvedKills;
    pending.set(pendingKey(tournamentId, userId), session);
    return finalizeRegistration(interaction, tournamentId, session);
  }

  async function submitRobloxNick(interaction, tournamentId, kind) {
    const tournament = state.getTournament(db, tournamentId);
    if (!tournament) {
      await safeReply(interaction, ephemeralText("Турнир не найден."));
      return true;
    }
    await safeDeferUpdate(interaction);
    const nick = interaction.fields.getTextInputValue("nick");

    let resolved = null;
    try {
      resolved = await resolveRobloxUser(nick);
    } catch (error) {
      await safeReply(interaction, ephemeralText(`Не удалось проверить аккаунт: ${error?.message || "ошибка"}.`));
      return true;
    }
    const robloxUser = normalizeResolvedRobloxUser(resolved, nick);
    if (!robloxUser?.userId) {
      await safeReply(interaction, ephemeralText("Такой Roblox аккаунт не найден. Проверь ник."));
      return true;
    }

    const userId = interaction.user.id;
    const session = pending.get(pendingKey(tournamentId, userId)) || { approvedKills: 0 };
    session.robloxUsername = robloxUser.username;
    session.robloxUserId = robloxUser.userId;
    session.robloxAvatarUrl = robloxUser.avatarUrl || null;

    if (kind === "main") {
      await Promise.resolve(writeRobloxBinding(userId, robloxUser, "tournament")).catch((error) => {
        logError("tournament: Roblox binding write failed", error?.message || error);
      });
      session.accountKind = "main";
      session.effectiveKills = session.approvedKills;
      pending.set(pendingKey(tournamentId, userId), session);
      await safeUpdate(interaction, view.buildRegFinalConfirmPayload(tournament, normalizePreview(session)));
      return true;
    }

    // alt / twink → declare real strength
    session.accountKind = kind === "twink" ? "twink" : "alt";
    pending.set(pendingKey(tournamentId, userId), session);
    const minKills = kind === "twink" ? state.TWINK_THRESHOLD + 1 : 0;
    await safeUpdate(
      interaction,
      view.buildDeclareStrengthPayload(tournament, {
        robloxUsername: session.robloxUsername,
        kind: session.accountKind,
        minKills,
      })
    );
    return true;
  }

  async function pickStrength(interaction, tournamentId, kind, declaredKills) {
    const tournament = state.getTournament(db, tournamentId);
    if (!tournament) {
      await safeReply(interaction, ephemeralText("Турнир не найден."));
      return true;
    }
    const userId = interaction.user.id;
    const session = pending.get(pendingKey(tournamentId, userId)) || {};
    session.accountKind = kind === "twink" ? "twink" : "alt";
    session.declaredKills = declaredKills;
    session.effectiveKills = state.resolveEffectiveKills({
      accountKind: session.accountKind,
      approvedKills: session.approvedKills,
      declaredKills,
    });
    pending.set(pendingKey(tournamentId, userId), session);
    await safeUpdate(interaction, view.buildRegFinalConfirmPayload(tournament, normalizePreview(session)));
    return true;
  }

  function normalizePreview(session) {
    return {
      robloxUsername: session.robloxUsername,
      robloxUserId: session.robloxUserId,
      robloxAvatarUrl: session.robloxAvatarUrl,
      accountKind: session.accountKind,
      approvedKills: session.approvedKills,
      declaredKills: session.declaredKills,
      effectiveKills:
        session.effectiveKills != null
          ? session.effectiveKills
          : state.resolveEffectiveKills({
              accountKind: session.accountKind,
              approvedKills: session.approvedKills,
              declaredKills: session.declaredKills,
            }),
    };
  }

  async function confirmRegistration(interaction, tournamentId) {
    const userId = interaction.user.id;
    const session = pending.get(pendingKey(tournamentId, userId));
    if (!session) {
      await safeReply(interaction, ephemeralText("Сессия заявки истекла. Нажми «Записаться» заново."));
      return true;
    }
    return finalizeRegistration(interaction, tournamentId, session);
  }

  function registrationNeedsKillHydration(reg = {}) {
    if (!reg || typeof reg !== "object") return false;
    const effectiveKills = Number(reg.effectiveKills);
    if (Number.isSafeInteger(effectiveKills) && effectiveKills > 0) return false;
    const declaredKills = toPositiveKills(reg.declaredKills);
    const approvedKills = toPositiveKills(reg.approvedKills);
    return declaredKills === null && approvedKills === null;
  }

  async function hydrateZeroKillRegistrations(tournament) {
    const registrations = state.listRegistrations(tournament);
    let changed = 0;

    for (const reg of registrations) {
      if (!registrationNeedsKillHydration(reg)) continue;
      const snapshot = (await Promise.resolve(getPlayerSnapshot(reg.userId, {
        registration: reg,
        tournamentId: tournament?.id || "",
      })).catch((error) => {
        logError("tournament: player kill hydration failed", reg.userId, error?.message || error);
        return {};
      })) || {};
      const approvedKills = toPositiveKills(snapshot.approvedKills);
      if (approvedKills === null) continue;
      reg.approvedKills = approvedKills;
      reg.effectiveKills = state.resolveEffectiveKills({
        accountKind: reg.accountKind,
        approvedKills,
        declaredKills: reg.declaredKills,
        declaredTier: reg.declaredTier,
      });
      reg.effectiveTier = killTierFor(reg.effectiveKills);
      changed += 1;
    }

    return changed;
  }

  function hasLaunchedTournamentPlay(tournament) {
    return Object.values(tournament?.servers || {}).some((server) => (
      server && (server.launched || server.currentStage || server.done)
    ));
  }

  function resetSeededTournamentAfterRosterChange(tournament) {
    if (!tournament || tournament.status !== "seeded" || hasLaunchedTournamentPlay(tournament)) return false;
    tournament.servers = {};
    for (const reg of state.listRegistrations(tournament)) {
      reg.serverIndex = null;
      reg.seedNumber = null;
    }
    tournament.status = "registration";
    return true;
  }

  // Snake-split the current roster across servers and stamp each registration
  // with its serverIndex + seedNumber. Shared by «Пересобрать дуэты» and phantom
  // auto-fill so a freshly filled bracket is immediately launchable (otherwise
  // newly-added players keep serverIndex=null and get filtered out at launch).
  function applyRosterSeeding(tournament, { allowDuringPlay = false } = {}) {
    if (!tournament) return false;
    if (!allowDuringPlay && hasLaunchedTournamentPlay(tournament)) return false;
    const count = serverCount(tournament);
    tournament.servers = {};
    const buckets = seeding.splitIntoServers(state.tournamentPlayers(tournament), count);
    buckets.forEach((bucket, serverIndex) => {
      seeding.assignSeedNumbers(bucket).forEach((player) => {
        const reg = state.getRegistration(tournament, player.userId || player.id);
        if (reg) {
          reg.seedNumber = player.seedNumber;
          reg.serverIndex = serverIndex;
        }
      });
    });
    state.updateTournament(db, tournament.id, { status: "seeded" });
    return true;
  }

  function hasUsableServerAssignments(tournament) {
    const count = serverCount(tournament);
    if (count <= 1) return true;
    const activePlayers = state.tournamentPlayers(tournament);
    if (!activePlayers.length) return true;
    return activePlayers.every((player) => {
      const index = Number(player.serverIndex);
      return Number.isInteger(index) && index >= 0 && index < count;
    });
  }

  function shouldRepairServerAssignmentsForLaunch(tournament, serverIndex) {
    if (!tournament || hasLaunchedTournamentPlay(tournament)) return false;
    const count = serverCount(tournament);
    if (count <= 1) return false;
    const activePlayers = state.tournamentPlayers(tournament);
    if (activePlayers.length < 2) return false;
    if (!hasUsableServerAssignments(tournament)) return true;
    return state.tournamentPlayers(tournament, { serverIndex }).length < 2;
  }

  function buildInitialServerStage(tournament, serverIndex) {
    const count = serverCount(tournament);
    const players = state.tournamentPlayers(tournament, count > 1 ? { serverIndex } : {});
    if (players.length < 2) return { ok: false, reason: "players", count, players };
    const plan = seeding.planNextStage({ survivors: players, mode: tournament.seedingMode, stageNumber: 1 });
    const stagePlan = plan.type === "stage" || plan.type === "placement" ? plan.stage : null;
    if (!stagePlan) return { ok: false, reason: "stage", count, players };
    return { ok: true, count, players, stagePlan };
  }

  function stampInitialServerState(tournament, serverIndex, stagePlan, count) {
    const server = state.ensureServer(tournament, serverIndex);
    server.role = count > 1 ? "base" : "single";
    server.launched = true;
    server.done = false;
    server.qualifying = false;
    server.qualified = [];
    server.stageNumber = 1;
    server.runIndex = 0;
    server.currentStage = stagePlan;
    server.decisions = {};
    server.semifinalLosers = [];
    server.history = [];
    server.threadFailed = false;
    server.threadId = "";
    server.launchMessageId = "";
    server.threadBracketMessageId = "";
    return server;
  }

  function ensureRunnableServerState(tournament, serverIndex, { preserveExisting = true } = {}) {
    if (!tournament) return { ok: false, reason: "missing" };
    const existing = state.getServer(tournament, serverIndex);
    if (preserveExisting && existing?.launched && (existing.currentStage || existing.done)) {
      return { ok: true, already: true, server: existing, playerCount: state.tournamentPlayers(tournament, serverCount(tournament) > 1 ? { serverIndex } : {}).length };
    }
    if (preserveExisting && existing?.currentStage) {
      existing.launched = true;
      return { ok: true, repaired: true, server: existing, playerCount: state.tournamentPlayers(tournament, serverCount(tournament) > 1 ? { serverIndex } : {}).length };
    }
    const built = buildInitialServerStage(tournament, serverIndex);
    if (!built.ok) return built;
    const server = stampInitialServerState(tournament, serverIndex, built.stagePlan, built.count);
    return { ok: true, repaired: Boolean(existing), server, playerCount: built.players.length };
  }

  async function finalizeRegistration(interaction, tournamentId, session) {
    const tournament = state.getTournament(db, tournamentId);
    if (!tournament) {
      await safeReply(interaction, ephemeralText("Турнир не найден."));
      return true;
    }
    if (tournament.registrationOpen === false && !state.getRegistration(tournament, interaction.user.id)) {
      await safeReply(interaction, ephemeralText("Набор закрыт."));
      return true;
    }
    const userId = interaction.user.id;
    const acked = await safeDeferUpdate(interaction);
    if (acked) {
      await safeUpdate(interaction, view.buildNoticePayload("Модератор фиксирует вашу заявку…"));
    }

    // Authoritative kills: re-resolve from the profile so a lost in-memory
    // session can never store a zero. main → profile kills; alt/twink → declared.
    const snapshot = await resolveAuthoritativeSnapshot(userId, {
      robloxUserId: session.robloxUserId,
      robloxUsername: session.robloxUsername,
    });
    const profileKills = toPositiveKills(snapshot.approvedKills);
    const accountKind = session.accountKind || "main";
    const approvedKills = profileKills != null ? profileKills : toPositiveKills(session.approvedKills);
    const declaredKills = session.declaredKills ?? null;

    // Everyone who can see the announcement has kills, so a missing value is our
    // bug — refuse to register a zero rather than poison the bracket.
    if (accountKind === "main" && (approvedKills == null || approvedKills <= 0)) {
      await safeReply(
        interaction,
        ephemeralText("Не нашли твои зарегистрированные килы. Зарегистрируй килы через /onboard или напиши админу — без них в турнир нельзя.")
      );
      return true;
    }

    const killsSource = accountKind === "main" ? snapshot.killsSource || "profile" : "declared";
    let playReset = false;
    quickMutate(() => {
      const fresh = state.getTournament(db, tournamentId);
      state.upsertRegistration(fresh, {
        userId,
        discordName: interaction.user.tag,
        robloxUserId: session.robloxUserId || snapshot.robloxUserId,
        robloxUsername: session.robloxUsername || snapshot.robloxUsername,
        robloxAvatarUrl: session.robloxAvatarUrl || snapshot.robloxAvatarUrl,
        accountKind,
        approvedKills: approvedKills || 0,
        declaredKills,
        killsSource,
      });
      const queue = state.registrationQueueInfo(fresh, userId);
      if (queue.active) playReset = resetSeededTournamentAfterRosterChange(fresh);
    });
    pending.delete(pendingKey(tournamentId, userId));

    const fresh = state.getTournament(db, tournamentId);
    syncParticipantRoles(fresh).catch((error) => logError("tournament: participant role sync after registration failed", error?.message || error));
    scheduleAnnouncementRefresh(tournamentId, "register");
    const registration = state.getRegistration(fresh, userId) || {};
    const queueInfo = state.registrationQueueInfo(fresh, userId);
    await safeLogLine(
      `TOURNAMENT_REGISTER: <@${userId}> tournament="${fresh.name}" id=${fresh.id} player=${registration.robloxUsername || "unknown"} account=${registration.accountKind || "unknown"} kills=${registration.effectiveKills || 0} source=${registration.killsSource || "?"} queue=${queueInfo.active ? "active" : `waitlist#${queueInfo.waitlistPosition}`} count=${state.registrationCount(fresh)}/${fresh.slots}`
    );
    await safeUpdate(interaction, view.buildRegisteredPayload(fresh, { seatNumber: registrationSeat(fresh, userId), queueInfo, playReset }));
    return true;
  }

  async function withdrawRegistration(interaction, tournamentId) {
    const userId = interaction.user.id;
    await safeDeferUpdate(interaction);
    const removed = await persist("tournament-withdraw", async () => {
      const fresh = state.getTournament(db, tournamentId);
      const existing = fresh ? state.getRegistration(fresh, userId) : null;
      let playReset = false;
      if (fresh) {
        state.removeRegistration(fresh, userId);
        playReset = resetSeededTournamentAfterRosterChange(fresh);
      }
      return { existing, playReset };
    });
    pending.delete(pendingKey(tournamentId, userId));
    const fresh = state.getTournament(db, tournamentId);
    if (fresh) {
      removeParticipantRole(fresh, userId);
      syncParticipantRoles(fresh).catch((error) => logError("tournament: participant role sync after withdrawal failed", error?.message || error));
      scheduleAnnouncementRefresh(tournamentId, "withdraw");
      await safeLogLine(
        `TOURNAMENT_WITHDRAW: <@${userId}> tournament="${fresh.name}" id=${fresh.id} player=${removed?.existing?.robloxUsername || "unknown"} count=${state.registrationCount(fresh)}/${fresh.slots} playReset=${removed?.playReset ? "yes" : "no"}`
      );
    }
    await safeUpdate(
      interaction,
      view.buildNoticePayload(
        removed?.playReset
          ? "Заявка отозвана. Старое распределение сброшено, потому что состав изменился."
          : "Заявка отозвана."
      )
    );
    return true;
  }

  function registrationSeat(tournament, userId) {
    const queue = state.registrationQueueInfo(tournament, userId);
    if (!queue.active) return null;
    const players = seeding.assignSeedNumbers(state.tournamentPlayers(tournament));
    const found = players.find((p) => String(p.userId || p.id) === String(userId));
    return found ? found.seedNumber : null;
  }

  // =========================================================================
  // Management implementation
  // =========================================================================

  function requireMod(interaction) {
    if (isModerator(interaction.member)) return true;
    safeReply(interaction, ephemeralText("Нужны права модератора.")).catch(() => {});
    return false;
  }

  async function renderManage(interaction, tournamentId, { edit = false, statusText = "" } = {}) {
    if (!requireMod(interaction)) return true;
    const tournament = state.getTournament(db, tournamentId);
    if (!tournament) {
      await safeReply(interaction, ephemeralText("Турнир не найден."));
      return true;
    }
    const payload = view.buildManagePanelPayload(tournament, {
      statusText,
      serverCount: serverCount(tournament),
      finalReady: allBaseServersQualified(tournament),
      finalServer: state.getServer(tournament, FINAL_SERVER_INDEX),
      finalIndex: FINAL_SERVER_INDEX,
    });
    edit ? await safeUpdate(interaction, payload) : await safeReply(interaction, payload);
    return true;
  }

  async function refreshManage(interaction, tournamentId) {
    if (!requireMod(interaction)) return true;
    const acked = await safeDeferUpdate(interaction);
    const tournament = state.getTournament(db, tournamentId);
    if (!tournament) {
      await safeReply(interaction, ephemeralText("Турнир не найден."));
      return true;
    }
    const refreshed = await refreshAnnouncement(tournament, "manage-refresh");
    await safeLogLine(
      `TOURNAMENT_MANAGE_REFRESH: tournament="${tournament.name}" id=${tournament.id} count=${state.registrationCount(tournament)}/${tournament.slots} announcement=${announcementStatusText(refreshed)} by=<@${interaction.user.id}>`
    );
    return renderManage(interaction, tournamentId, {
      edit: acked,
      statusText: `Панель обновлена. Анонс: ${announcementStatusText(refreshed)}.`,
    });
  }

  async function submitSummaryComment(interaction, tournamentId) {
    if (!requireMod(interaction)) return true;
    const comment = String(interaction.fields.getTextInputValue("comment") || "").trim();
    await safeDeferUpdate(interaction);
    await persist("tournament-summary-comment", async () => {
      const fresh = state.getTournament(db, tournamentId);
      if (!fresh) return;
      fresh.results = {
        ...(fresh.results || {}),
        organizerComment: comment || null,
      };
    });
    await safeLogLine(`TOURNAMENT_SUMMARY_COMMENT: id=${tournamentId} chars=${comment.length} by=<@${interaction.user.id}>`);
    return renderCompletionWindow(interaction, tournamentId, {
      edit: true,
      statusText: comment ? "Комментарий сохранён. Карточка пересобрана." : "Комментарий очищен.",
    });
  }

  async function publishSummaryAction(interaction, tournamentId) {
    if (!requireMod(interaction)) return true;
    const acked = await safeDeferUpdate(interaction);
    const result = await publishTournamentSummary(tournamentId);
    const statusText = result.ok
      ? result.skipped === "already-posted"
        ? "Итоги уже были опубликованы."
        : "Итоги опубликованы в канале анонса."
      : "Не удалось опубликовать итоги: проверь канал анонса и права бота.";
    await safeLogLine(
      `TOURNAMENT_SUMMARY_PUBLISH: id=${tournamentId} ok=${result.ok ? "yes" : "no"} reason=${result.reason || result.skipped || "sent"} by=<@${interaction.user.id}>`
    );
    return renderCompletionWindow(interaction, tournamentId, { edit: acked, statusText });
  }

  async function toggleRegistration(interaction, tournamentId, open) {
    if (!requireMod(interaction)) return true;
    // sync mutate → single round-trip (no defer, no shared queue, no network)
    quickMutate(() => state.updateTournament(db, tournamentId, { registrationOpen: open }));
    const tournament = state.getTournament(db, tournamentId);
    scheduleAnnouncementRefresh(tournamentId, open ? "open-registration" : "close-registration");
    if (tournament) {
      safeLogLine(
        `TOURNAMENT_REGISTRATION_${open ? "OPEN" : "CLOSE"}: id=${tournament.id} count=${state.registrationCount(tournament)}/${tournament.slots} by=<@${interaction.user.id}>`
      ).catch(() => {});
    }
    return renderManage(interaction, tournamentId, { edit: true, statusText: open ? "Набор открыт." : "Набор закрыт." });
  }

  // (Re)build duels at any time. Clears any prior bracket so the seeding is
  // recomputed from the current roster, then shows the cell layout.
  async function formDuels(interaction, tournamentId) {
    if (!requireMod(interaction)) return true;
    const acked = await safeDeferUpdate(interaction);
    const tournament = state.getTournament(db, tournamentId);
    if (!tournament) {
      await safeReply(interaction, ephemeralText("Турнир не найден."));
      return true;
    }
    if (state.tournamentPlayers(tournament).length < 2) {
      await safeReply(interaction, ephemeralText("Недостаточно участников для распределения (нужно минимум 2)."));
      return true;
    }
    if (hasLaunchedTournamentPlay(tournament)) {
      return renderManage(interaction, tournamentId, {
        edit: acked,
        statusText: "Сервер уже запущен: пересобирать дуэты нельзя, чтобы не стереть текущую сетку.",
      });
    }
    const count = serverCount(tournament);
    const hydratedCount = await persist("tournament-form", async () => {
      const fresh = state.getTournament(db, tournamentId);
      const repaired = await hydrateZeroKillRegistrations(fresh);
      // snake-split across servers (single server → everyone on index 0)
      applyRosterSeeding(fresh);
      return repaired;
    });
    const fresh = state.getTournament(db, tournamentId);
    if (hydratedCount > 0) {
      await safeLogLine(`TOURNAMENT_KILLS_HYDRATE: id=${fresh.id} repaired=${hydratedCount} by=<@${interaction.user.id}>`);
    }
    // show per-server cell layout (server 0; others reachable via launch)
    const plan = seeding.buildStage(state.tournamentPlayers(fresh, count > 1 ? { serverIndex: 0 } : {}), fresh.seedingMode, 1);
    const payload = view.buildRosterPayload(fresh, plan, { serverIndex: 0, serverCount: count });
    acked ? await safeUpdate(interaction, payload) : await safeReply(interaction, payload);
    return true;
  }

  async function publishPreviewAction(interaction, tournamentId) {
    if (!requireMod(interaction)) return true;
    const acked = await safeDeferUpdate(interaction);
    const tournament = state.getTournament(db, tournamentId);
    if (!tournament) {
      await safeReply(interaction, ephemeralText("Турнир не найден."));
      return true;
    }
    if (hasLaunchedTournamentPlay(tournament)) {
      return renderManage(interaction, tournamentId, {
        edit: acked,
        statusText: "Сервер уже запущен: предпубликация больше не нужна, текущая сетка живёт в серверных постах.",
      });
    }

    const repaired = await persist("tournament-preview-hydrate", async () => {
      const fresh = state.getTournament(db, tournamentId);
      return fresh ? await hydrateZeroKillRegistrations(fresh) : 0;
    });
    const fresh = state.getTournament(db, tournamentId);
    const activePlayers = state.tournamentPlayers(fresh);
    if (!activePlayers.length) {
      await safeReply(interaction, ephemeralText("Некого публиковать: в основном составе пока нет игроков."));
      return true;
    }

    const channel = await fetchChannel(fresh.announce?.channelId).catch(() => null);
    if (!channel?.send) {
      await safeReply(interaction, ephemeralText("Не нашёл канал анонса для предпубликации."));
      return true;
    }

    const filename = "tournament-preview.png";
    const buffer = await renderPreviewBuffer(fresh, await collectTournamentAvatars(fresh));
    const payload = view.buildPreviewPostPayload(fresh, {
      imageFilename: buffer ? filename : "",
      serverCount: serverCount(fresh),
      activeCount: activePlayers.length,
      waitlistCount: state.listWaitlistRegistrations(fresh).length,
    });
    const message = await channel
      .send({ ...attachImage(payload, buffer, filename), allowedMentions: { parse: [] } })
      .catch((error) => {
        logError("tournament: preview publish failed", error?.message || error);
        return null;
      });
    if (!message) {
      await safeReply(interaction, ephemeralText("Не удалось отправить предпубликацию. Проверь права бота в канале."));
      return true;
    }

    await persist("tournament-preview-posted", async () => {
      state.updateTournament(db, tournamentId, {
        preview: {
          channelId: String(message.channelId || channel.id || ""),
          messageId: String(message.id || ""),
          postedAt: new Date().toISOString(),
        },
      });
    });
    await safeLogLine(
      `TOURNAMENT_PREVIEW_PUBLISH: id=${fresh.id} servers=${serverCount(fresh)} active=${activePlayers.length} waitlist=${state.listWaitlistRegistrations(fresh).length} repaired=${repaired} by=<@${interaction.user.id}>`
    );
    return renderManage(interaction, tournamentId, {
      edit: acked,
      statusText: `Предпубликация отправлена${repaired ? `, килы обновлены у ${repaired}` : ""}.`,
    });
  }

  // Launch a server: persist the runnable bracket FIRST, then fire the thread /
  // ping / art as best-effort side-effects. The match panel works regardless.
  async function launchServer(interaction, tournamentId, serverIndex) {
    if (!requireMod(interaction)) return true;
    const acked = await safeDeferUpdate(interaction);
    const launchResult = await persist("tournament-launch", async () => {
      const fresh = state.getTournament(db, tournamentId);
      if (!fresh) return { ok: false, reason: "missing" };
      // Re-hydrate kills so the bracket never seeds on a stale zero. Also repair
      // pre-launch multi-server rosters that have registrations but lost their
      // serverIndex split (for example, old phantom-filled panels after a reset).
      await hydrateZeroKillRegistrations(fresh);
      let repairedSplit = false;
      if (shouldRepairServerAssignmentsForLaunch(fresh, serverIndex)) {
        repairedSplit = applyRosterSeeding(fresh);
      }

      // PERSIST the bracket immediately and atomically with launch preparation.
      // If this server is already running, keep its live stage/decisions intact.
      const serverResult = ensureRunnableServerState(fresh, serverIndex, { preserveExisting: true });
      if (!serverResult.ok) return serverResult;
      state.updateTournament(db, tournamentId, { status: "running" });
      return { ok: true, repairedSplit, already: serverResult.already, repaired: serverResult.repaired, playerCount: serverResult.playerCount };
    });

    if (!launchResult?.ok) {
      const text = launchResult?.reason === "missing"
        ? "Турнир не найден."
        : launchResult?.reason === "players"
          ? "Недостаточно участников на сервере."
          : "Не удалось сформировать сетку.";
      await safeReply(interaction, ephemeralText(text));
      return true;
    }

    if (launchResult.repairedSplit) {
      await safeLogLine(`TOURNAMENT_LAUNCH_RESEED: id=${tournamentId} server=${serverIndex + 1} by=<@${interaction.user.id}>`);
    }

    // Snappy: re-render management now; side-effects run in the background.
    await renderManage(interaction, tournamentId, {
      edit: acked,
      statusText: launchResult.already
        ? `Сервер ${serverIndex + 1} уже запущен. Панель боёв готова.`
        : `Сервер ${serverIndex + 1} запущен. Панель боёв готова. Открываю закрытую ветку только для участников сервера…`,
    });
    if (!launchResult.already) {
      runServerSideEffects(tournamentId, serverIndex, { postChannel: true }).catch((error) =>
        logError("tournament: launch side-effects failed", error?.message || error)
      );
    }
    return true;
  }

  // Launch the cross-server FINAL — seeds the top-4 qualifiers from every base
  // server onto a single final server that runs to placement (overall 1/2/3).
  async function launchFinalServer(interaction, tournamentId) {
    if (!requireMod(interaction)) return true;
    const acked = await safeDeferUpdate(interaction);
    const launchResult = await persist("tournament-final-launch", async () => {
      const fresh = state.getTournament(db, tournamentId);
      if (!fresh) return { ok: false, reason: "missing" };
      if (!allBaseServersQualified(fresh)) return { ok: false, reason: "not-ready" };
      const finalists = [];
      for (const s of qualifiedBaseServers(fresh)) {
        for (const p of s.qualified || []) finalists.push(p);
      }
      if (finalists.length < 2) return { ok: false, reason: "players" };
      const plan = seeding.planNextStage({ survivors: finalists, mode: fresh.seedingMode, stageNumber: 1 });
      const stagePlan = plan.type === "stage" || plan.type === "placement" ? plan.stage : null;
      if (!stagePlan) return { ok: false, reason: "stage" };

      // pin finalists to the final server so its private thread adds only them
      for (const p of finalists) {
        const reg = state.getRegistration(fresh, p.userId || p.id);
        if (reg) reg.serverIndex = FINAL_SERVER_INDEX;
      }
      const server = state.ensureServer(fresh, FINAL_SERVER_INDEX);
      server.role = "final";
      server.launched = true;
      server.done = false;
      server.qualifying = false;
      server.stageNumber = 1;
      server.runIndex = 0;
      server.currentStage = stagePlan;
      server.decisions = {};
      server.semifinalLosers = [];
      server.history = [];
      server.threadFailed = false;
      server.threadId = "";
      server.launchMessageId = "";
      server.threadBracketMessageId = "";
      return { ok: true, finalistCount: finalists.length };
    });

    if (!launchResult?.ok) {
      const text = launchResult?.reason === "missing"
        ? "Турнир не найден."
        : launchResult?.reason === "not-ready"
          ? "Финал откроется, когда все базовые сервера выведут свои топ-4."
          : launchResult?.reason === "players"
            ? "Недостаточно финалистов."
            : "Не удалось сформировать финальную сетку.";
      await safeReply(interaction, ephemeralText(text));
      return true;
    }

    await safeLogLine(`TOURNAMENT_FINAL_LAUNCH: id=${tournamentId} finalists=${launchResult.finalistCount} by=<@${interaction.user.id}>`);
    await renderManage(interaction, tournamentId, {
      edit: acked,
      statusText: `🏆 Финал запущен (${launchResult.finalistCount} игроков). Открываю закрытую ветку только для финалистов…`,
    });
    runServerSideEffects(tournamentId, FINAL_SERVER_INDEX, { postChannel: true }).catch((error) =>
      logError("tournament: final launch side-effects failed", error?.message || error)
    );
    return true;
  }

  // Post the bracket art, open the private thread, add + ping members, lock it.
  // Best-effort: any failure is recorded (threadFailed) but never aborts launch.
  async function runServerSideEffects(tournamentId, serverIndex, { postChannel = true } = {}) {
    const tournament = state.getTournament(db, tournamentId);
    const server = tournament ? state.getServer(tournament, serverIndex) : null;
    if (!tournament || !server || !server.currentStage) return;

    const players = state.tournamentPlayers(tournament, serverCount(tournament) > 1 ? { serverIndex } : {});
    const channel = await fetchChannel(tournament.announce?.channelId).catch(() => null);
    let launchMessageId = server.launchMessageId || "";
    let threadId = server.threadId || "";
    let threadBracketMessageId = server.threadBracketMessageId || "";
    let threadFailed = false;
    let existingThread = threadId ? await fetchChannel(threadId).catch(() => null) : null;
    if (!existingThread && channel?.threads?.create) {
      const thread = await channel.threads
        .create({ name: view.buildServerThreadName(tournament, serverIndex), type: ChannelType.PrivateThread, invitable: false, autoArchiveDuration: 1440 })
        .catch((error) => {
          logError("tournament: private thread create failed", error?.message || error);
          return null;
        });
      existingThread = thread || null;
      threadId = thread?.id || "";
      if (!thread?.id) threadFailed = true;
      else threadBracketMessageId = ""; // fresh thread → its bracket message is new
    } else if (!channel?.threads?.create) {
      threadFailed = true;
    }

    let memberResult = { ids: [], added: 0, failed: 0 };
    let pingFailed = false;
    if (existingThread?.send) {
      memberResult = await addPlayersToPrivateThread(existingThread, players);
      const pingRoleIds = privateThreadAdminRoleIds;
      if (memberResult.ids.length || pingRoleIds.length) {
        const label = serverIndex === FINAL_SERVER_INDEX ? "Финал" : `Сервер ${serverIndex + 1}`;
        const mentions = [
          ...pingRoleIds.map((id) => `<@&${id}>`),
          ...memberResult.ids.map((id) => `<@${id}>`),
        ].join(" ");
        await existingThread
          .send({
            content: [
              mentions,
              "",
              `**${label} готов.** Админы и участники этой сетки добавлены в приватную ветку. Бои ведёт модератор через панель; здесь лежит актуальная картинка ветки.`,
            ].join("\n"),
            allowedMentions: { users: memberResult.ids, roles: pingRoleIds },
          })
          .catch((error) => {
            pingFailed = true;
            logError("tournament: private thread ping failed", error?.message || error);
          });
      }
    }
    if (memberResult.failed > 0 || pingFailed) threadFailed = true;

    await persist("tournament-launch-thread", async () => {
      const s = state.getServer(state.getTournament(db, tournamentId), serverIndex);
      if (s && s.currentStage) {
        s.threadId = threadId;
        s.threadFailed = threadFailed;
        s.threadParticipantUserIds = memberResult.ids;
        s.threadParticipantAddFailed = memberResult.failed;
        s.threadParticipantPingFailed = pingFailed;
      }
    });

    // Render/post art after the thread ping. Slow avatar CDN or PNG rendering must
    // never delay the private thread becoming visible.
    const avatars = await collectTournamentAvatars(tournament, players);
    const { payload: bracketPayload, buffer, filename } = await buildServerBracketArt(tournament, server, serverIndex, avatars);
    if (postChannel && channel) {
      launchMessageId = await editOrSendBracketMessage(channel, launchMessageId, bracketPayload, buffer, filename, { allowCreate: true });
    }
    if (existingThread?.send) {
      threadBracketMessageId = await editOrSendBracketMessage(existingThread, threadBracketMessageId, bracketPayload, buffer, filename, { allowCreate: true });
      await existingThread.setLocked?.(true).catch(() => {});
    }

    await persist("tournament-launch-side", async () => {
      const s = state.getServer(state.getTournament(db, tournamentId), serverIndex);
      if (s && s.currentStage) {
        s.launchMessageId = launchMessageId;
        s.threadId = threadId;
        s.threadBracketMessageId = threadBracketMessageId;
        s.threadFailed = threadFailed;
        s.threadParticipantUserIds = memberResult.ids;
        s.threadParticipantAddFailed = memberResult.failed;
        s.threadParticipantPingFailed = pingFailed;
      }
    });
    await safeLogLine(
      `TOURNAMENT_LAUNCH: id=${tournamentId} server=${serverIndex + 1} thread=${threadId || "none"} threadFailed=${threadFailed} players=${players.length} threadMembers=${memberResult.ids.length} addFailed=${memberResult.failed} pingFailed=${pingFailed}`
    );
  }

  async function retryThreadSideEffects(interaction, tournamentId, serverIndex) {
    if (!requireMod(interaction)) return true;
    const acked = await safeDeferUpdate(interaction);
    await renderManage(interaction, tournamentId, { edit: acked, statusText: "Повторно создаю ветку и пингую участников…" });
    runServerSideEffects(tournamentId, serverIndex, { postChannel: false }).catch((error) =>
      logError("tournament: thread retry failed", error?.message || error)
    );
    return true;
  }

  async function openMatchPanel(interaction, tournamentId, serverIndex) {
    if (!requireMod(interaction)) return true;
    let tournament = state.getTournament(db, tournamentId);
    if (tournament?.status === "completed") {
      return renderCompletionWindow(interaction, tournamentId);
    }
    let server = tournament ? state.getServer(tournament, serverIndex) : null;
    if (!server || !server.currentStage) {
      const repair = await persist("tournament-open-panel-repair", async () => {
        const fresh = state.getTournament(db, tournamentId);
        if (!fresh) return { ok: false, reason: "missing" };
        const freshServer = state.getServer(fresh, serverIndex);
        if (freshServer?.currentStage || freshServer?.done) {
          if (!freshServer.launched) freshServer.launched = true;
          return { ok: true, already: true };
        }
        if (fresh.status !== "running" && !freshServer?.launched) return { ok: false, reason: "not-launched" };
        const result = ensureRunnableServerState(fresh, serverIndex, { preserveExisting: false });
        if (!result.ok) return result;
        state.updateTournament(db, tournamentId, { status: "running" });
        return { ok: true, repaired: true };
      });
      tournament = state.getTournament(db, tournamentId);
      server = tournament ? state.getServer(tournament, serverIndex) : null;
      if (repair?.repaired) {
        await safeLogLine(`TOURNAMENT_SERVER_REPAIRED: id=${tournamentId} server=${serverIndex + 1} source=open-panel by=<@${interaction.user.id}>`);
      }
    }
    if (!server || !server.currentStage) {
      await safeReply(interaction, ephemeralText("Сначала запусти сервер."));
      return true;
    }
    await safeReply(interaction, view.buildMatchPanelPayload(tournament, server));
    return true;
  }

  async function cancelTournament(interaction, tournamentId) {
    if (!requireMod(interaction)) return true;
    const acked = await safeDeferUpdate(interaction);
    const before = state.getTournament(db, tournamentId);
    const roster = before ? state.listRegistrations(before) : [];
    await persist("tournament-cancel", async () => {
      state.updateTournament(db, tournamentId, { status: "cancelled", registrationOpen: false });
    });
    const tournament = state.getTournament(db, tournamentId);
    if (tournament) {
      for (const reg of roster) removeParticipantRole(tournament, reg.userId);
      scheduleAnnouncementRefresh(tournamentId, "cancel");
    }
    return renderManage(interaction, tournamentId, { edit: acked, statusText: "Турнир отменён. Роли участников сняты." });
  }

  // =========================================================================
  // Roster + manual add/remove + role sync
  // =========================================================================

  async function openRoster(interaction, tournamentId, page, { edit = false } = {}) {
    if (!requireMod(interaction)) return true;
    const tournament = state.getTournament(db, tournamentId);
    if (!tournament) {
      await safeReply(interaction, ephemeralText("Турнир не найден."));
      return true;
    }
    const players = state.tournamentPlayers(tournament, { includeWaitlist: true });
    const payload = view.buildRosterViewerPayload(tournament, players, { page });
    edit ? await safeUpdate(interaction, payload) : await safeReply(interaction, payload);
    return true;
  }

  async function refreshRosterKills(interaction, tournamentId) {
    if (!requireMod(interaction)) return true;
    const acked = await safeDeferUpdate(interaction);
    const repaired = await persist("tournament-roster-hydrate", async () => {
      const fresh = state.getTournament(db, tournamentId);
      return fresh ? await hydrateZeroKillRegistrations(fresh) : 0;
    });
    const tournament = state.getTournament(db, tournamentId);
    const players = state.tournamentPlayers(tournament, { includeWaitlist: true });
    const payload = view.buildRosterViewerPayload(tournament, players, { page: 0, statusText: `Килы обновлены (исправлено: ${repaired}).` });
    acked ? await safeUpdate(interaction, payload) : await safeReply(interaction, payload);
    return true;
  }

  async function openAddPlayer(interaction, tournamentId) {
    if (!requireMod(interaction)) return true;
    const tournament = state.getTournament(db, tournamentId);
    if (!tournament) {
      await safeReply(interaction, ephemeralText("Турнир не найден."));
      return true;
    }
    if (hasLaunchedTournamentPlay(tournament)) {
      return renderManage(interaction, tournamentId, {
        edit: true,
        statusText: "Сервер уже запущен: менять состав нельзя, чтобы не сломать текущую сетку.",
      });
    }
    await safeUpdate(interaction, view.buildAddPlayerPayload(tournament));
    return true;
  }

  async function openRemovePlayer(interaction, tournamentId) {
    if (!requireMod(interaction)) return true;
    const tournament = state.getTournament(db, tournamentId);
    if (!tournament) {
      await safeReply(interaction, ephemeralText("Турнир не найден."));
      return true;
    }
    if (hasLaunchedTournamentPlay(tournament)) {
      return renderManage(interaction, tournamentId, {
        edit: true,
        statusText: "Сервер уже запущен: менять состав нельзя, чтобы не сломать текущую сетку.",
      });
    }
    await safeUpdate(interaction, view.buildRemovePlayerPayload(tournament));
    return true;
  }

  async function addPlayerFromSelect(interaction, tournamentId, targetUserId) {
    if (!requireMod(interaction)) return true;
    const acked = await safeDeferUpdate(interaction);
    const userId = String(targetUserId || "");
    const snapshot = await resolveAuthoritativeSnapshot(userId);
    const kills = toPositiveKills(snapshot.approvedKills);
    if (!snapshot.hasRobloxAccount || kills == null || kills <= 0) {
      await safeReply(
        interaction,
        ephemeralText("У игрока нет привязанного Roblox/килов в профиле. Добавь вручную через «Ввести вручную (ник + килы)».")
      );
      return true;
    }
    const member = await Promise.resolve(fetchMember(userId)).catch(() => null);
    const result = await persist("tournament-add-player", async () => {
      const fresh = state.getTournament(db, tournamentId);
      if (!fresh) return { ok: false, reason: "missing" };
      if (hasLaunchedTournamentPlay(fresh)) return { ok: false, reason: "locked" };
      state.upsertRegistration(fresh, {
        userId,
        discordName: member?.user?.tag || snapshot.robloxUsername || userId,
        robloxUserId: snapshot.robloxUserId,
        robloxUsername: snapshot.robloxUsername,
        robloxAvatarUrl: snapshot.robloxAvatarUrl,
        accountKind: "main",
        approvedKills: kills,
        killsSource: snapshot.killsSource || "profile",
        addedManually: true,
      });
      return { ok: true };
    });
    if (!result?.ok) {
      const text = result?.reason === "locked"
        ? "Сервер уже запущен: менять состав нельзя, чтобы не сломать текущую сетку."
        : "Турнир не найден.";
      return renderManage(interaction, tournamentId, { edit: acked, statusText: text });
    }
    const tournament = state.getTournament(db, tournamentId);
    syncParticipantRoles(tournament).catch((error) => logError("tournament: participant role sync after manual add failed", error?.message || error));
    scheduleAnnouncementRefresh(tournamentId, "manual-add");
    await safeLogLine(`TOURNAMENT_ADD_PLAYER: <@${userId}> id=${tournamentId} kills=${kills} by=<@${interaction.user.id}>`);
    return renderManage(interaction, tournamentId, { edit: acked, statusText: `Добавлен <@${userId}> (${snapshot.robloxUsername}, ${kills} килов).` });
  }

  async function submitAddPlayer(interaction, tournamentId) {
    if (!requireMod(interaction)) return true;
    await safeDeferUpdate(interaction);
    const nick = interaction.fields.getTextInputValue("nick");
    const killsRaw = interaction.fields.getTextInputValue("kills");
    const discordId = String(interaction.fields.getTextInputValue("discord") || "").replace(/[^\d]/g, "");
    const kills = toPositiveKills(Number(String(killsRaw).replace(/[^\d]/g, "")));
    if (kills == null) {
      await safeReply(interaction, ephemeralText("Килы должны быть положительным числом."));
      return true;
    }
    let resolved = null;
    try {
      resolved = normalizeResolvedRobloxUser(await resolveRobloxUser(nick), nick);
    } catch (error) {
      await safeReply(interaction, ephemeralText(`Не удалось проверить Roblox ник: ${error?.message || "ошибка"}.`));
      return true;
    }
    if (!resolved?.userId) {
      await safeReply(interaction, ephemeralText("Такой Roblox аккаунт не найден."));
      return true;
    }
    const userId = discordId || `manual-${resolved.userId}`; // no ':' (our custom-id separator)
    const result = await persist("tournament-add-player-manual", async () => {
      const fresh = state.getTournament(db, tournamentId);
      if (!fresh) return { ok: false, reason: "missing" };
      if (hasLaunchedTournamentPlay(fresh)) return { ok: false, reason: "locked" };
      state.upsertRegistration(fresh, {
        userId,
        discordName: resolved.username,
        robloxUserId: resolved.userId,
        robloxUsername: resolved.username,
        robloxAvatarUrl: resolved.avatarUrl,
        accountKind: "main",
        approvedKills: kills,
        killsSource: "manual",
        addedManually: true,
      });
      return { ok: true };
    });
    if (!result?.ok) {
      const text = result?.reason === "locked"
        ? "Сервер уже запущен: менять состав нельзя, чтобы не сломать текущую сетку."
        : "Турнир не найден.";
      return renderManage(interaction, tournamentId, { edit: true, statusText: text });
    }
    const tournament = state.getTournament(db, tournamentId);
    syncParticipantRoles(tournament).catch((error) => logError("tournament: participant role sync after manual add failed", error?.message || error));
    scheduleAnnouncementRefresh(tournamentId, "manual-add");
    await safeLogLine(`TOURNAMENT_ADD_PLAYER_MANUAL: ${resolved.username} id=${tournamentId} kills=${kills} discord=${discordId || "none"} by=<@${interaction.user.id}>`);
    return renderManage(interaction, tournamentId, { edit: true, statusText: `Добавлен ${resolved.username} (${kills} килов).` });
  }

  async function removePlayerFromSelect(interaction, tournamentId, targetUserId) {
    if (!requireMod(interaction)) return true;
    const acked = await safeDeferUpdate(interaction);
    const userId = String(targetUserId || "");
    const result = await persist("tournament-remove-player", async () => {
      const fresh = state.getTournament(db, tournamentId);
      if (!fresh) return { ok: false, reason: "missing", removed: false };
      if (hasLaunchedTournamentPlay(fresh)) return { ok: false, reason: "locked", removed: false };
      const existed = state.getRegistration(fresh, userId);
      state.removeRegistration(fresh, userId);
      resetSeededTournamentAfterRosterChange(fresh);
      return { ok: true, removed: Boolean(existed) };
    });
    if (!result?.ok) {
      const text = result?.reason === "locked"
        ? "Сервер уже запущен: менять состав нельзя, чтобы не сломать текущую сетку."
        : "Турнир не найден.";
      return renderManage(interaction, tournamentId, { edit: acked, statusText: text });
    }
    const removed = Boolean(result.removed);
    const tournament = state.getTournament(db, tournamentId);
    if (tournament) {
      removeParticipantRole(tournament, userId);
      syncParticipantRoles(tournament).catch((error) => logError("tournament: participant role sync after manual remove failed", error?.message || error));
      scheduleAnnouncementRefresh(tournamentId, "manual-remove");
    }
    await safeLogLine(`TOURNAMENT_REMOVE_PLAYER: <@${userId}> id=${tournamentId} existed=${removed} by=<@${interaction.user.id}>`);
    return renderManage(interaction, tournamentId, { edit: acked, statusText: removed ? `Убран <@${userId}>.` : "Этого игрока не было в заявке." });
  }

  async function syncRolesAction(interaction, tournamentId) {
    if (!requireMod(interaction)) return true;
    const acked = await safeDeferUpdate(interaction);
    const tournament = state.getTournament(db, tournamentId);
    if (!tournament) {
      await safeReply(interaction, ephemeralText("Турнир не найден."));
      return true;
    }
    if (!tournament.participantRoleId) {
      await safeReply(interaction, ephemeralText("Роль участника не выбрана для этого турнира."));
      return true;
    }
    const { granted, removed } = await syncParticipantRoles(tournament);
    await safeLogLine(`TOURNAMENT_SYNC_ROLES: id=${tournamentId} granted=${granted} removed=${removed} by=<@${interaction.user.id}>`);
    return renderManage(interaction, tournamentId, { edit: acked, statusText: `Роли синхронизированы. Выдано: ${granted}, снято с резерва: ${removed}.` });
  }

  // =========================================================================
  // Match results + advancement
  // =========================================================================

  // ---- match panel: ONE in-place panel + transient "думает" ----------------
  // A tap is acked with deferUpdate() — the SAME panel is edited IN PLACE (no new
  // messages, no cascade of panels). While we work we show a tiny ephemeral
  // "думает" message and remove it the instant the panel is repainted. Per-panel
  // edits are serialized so rapid taps can never land out of order (the old "mark
  // one, un-mark two" race stays impossible) — each repaint reads authoritative
  // in-memory state.
  const panelChains = new Map(); // `${tournamentId}:${serverIndex}` -> tail Promise

  function serializePanelEdit(key, fn) {
    const prev = panelChains.get(key) || Promise.resolve();
    const next = prev.then(fn, fn);
    panelChains.set(key, next.catch(() => {}));
    return next;
  }

  // Repaint the match panel in place. The deferUpdate that already ran is the
  // ack (Discord shows its own loading state), so this is a single editReply —
  // no extra "thinking" message, no delete round-trips. Serialized per panel so
  // rapid clicks can't race their edits.
  async function paintPanel(interaction, tournamentId, serverIndex, statusText = "") {
    const key = `${tournamentId}:${serverIndex}`;
    await serializePanelEdit(key, async () => {
      const tournament = state.getTournament(db, tournamentId);
      const server = tournament ? state.getServer(tournament, serverIndex) : null;
      if (!tournament || !server) return;
      const payload = withoutEphemeralFlag(view.buildMatchPanelPayload(tournament, server, { statusText }));
      try {
        await interaction.editReply(payload);
      } catch (error) {
        if (!isUnknownInteractionError(error)) logError("tournament: match panel render failed", error?.message || error);
      }
    });
  }

  async function recordMatch(interaction, tournamentId, extra, kind) {
    // Ack instantly (panel stays in place, NOT a new message). paintPanel shows
    // the "думает" loader and removes it when the panel refreshes.
    const acked = await safeDeferUpdate(interaction);
    if (!requireMod(interaction)) return true;
    const serverIndex = Number(extra[0]) || 0;
    const matchKey = extra[1];
    const side = extra[2]; // "r" | "b"

    // in-memory only — NO DB flush per click (committed on run/stage advance)
    mutateLocal(() => {
      const fresh = state.getTournament(db, tournamentId);
      const server = fresh ? state.getServer(fresh, serverIndex) : null;
      if (!server || !server.currentStage) return;
      server.decisions = server.decisions || {};
      if (kind === "undo") {
        delete server.decisions[matchKey];
        return;
      }
      // resolve the actual winner/loser from the match (never trust an id in the
      // custom_id — player ids may contain our ':' separator)
      const match = seeding.listStageMatches(server.currentStage).find((m) => m.key === matchKey);
      if (!match) return;
      const targetId = side === "b" ? matchSideId(match.blue) : matchSideId(match.red);
      const current = server.decisions[matchKey] || { winnerId: null, noShowIds: [] };
      if (kind === "win") {
        current.winnerId = targetId;
        current.noShowIds = [];
      } else if (kind === "noshow") {
        const set = new Set(current.noShowIds || []);
        set.add(String(targetId));
        current.noShowIds = [...set];
        current.winnerId = null;
      }
      server.decisions[matchKey] = current;
    });

    if (acked) await paintPanel(interaction, tournamentId, serverIndex);
    return true;
  }

  function matchSideId(player) {
    return player ? String(player.userId || player.id || "") : "";
  }

  async function advanceStage(interaction, tournamentId, serverIndex) {
    const acked = await safeDeferUpdate(interaction);
    if (!requireMod(interaction)) return true;

    let statusText = "";
    quickMutate(() => {
      const fresh = state.getTournament(db, tournamentId);
      const server = fresh ? state.getServer(fresh, serverIndex) : null;
      if (!server || !server.currentStage) return;
      const stagePlan = server.currentStage;
      const runs = Array.isArray(stagePlan.runs) ? stagePlan.runs : [];

      // advance run cursor first
      if ((server.runIndex || 0) < runs.length - 1) {
        server.runIndex = (server.runIndex || 0) + 1;
        statusText = `Прогон ${server.runIndex + 1}/${runs.length}`;
        return;
      }

      const results = seeding.resolveStageResults(stagePlan, server.decisions || {});

      if (stagePlan.kind === "placement") {
        finalizePlacement(fresh, server, stagePlan);
        statusText = "Турнир завершён";
        return;
      }

      // snapshot the completed stage for the result bracket art
      server.history = server.history || [];
      server.history.push(bracketImage.stageEntryFromPlan(stagePlan, server.decisions || {}));

      // base server (multi-server): stop once survivors fit the cross-server
      // final quota — those players qualify, the server is done qualifying.
      if (server.role === "base" && results.winners.length <= seeding.QUALIFY_PER_SERVER) {
        server.qualified = results.winners;
        server.qualifying = true;
        server.done = true;
        statusText = `Сервер ${serverIndex + 1}: топ-${results.winners.length} вышли в финал`;
        return;
      }

      let semifinalLosers = server.semifinalLosers || [];
      if (stagePlan.isSemifinal) semifinalLosers = results.losers;

      const plan = seeding.planNextStage({
        survivors: results.winners,
        mode: fresh.seedingMode,
        stageNumber: (server.stageNumber || 1) + 1,
        semifinalLosers,
      });

      if (plan.type === "complete") {
        server.done = true;
        server.champion = plan.winner;
        server.placement = { first: plan.winner, second: null, third: null };
        maybeCompleteTournament(fresh);
        statusText = "Турнир завершён";
        return;
      }

      server.currentStage = plan.stage;
      server.stageNumber = (server.stageNumber || 1) + 1;
      server.runIndex = 0;
      server.decisions = {};
      server.semifinalLosers = semifinalLosers;
      statusText = `Этап ${server.stageNumber}`;
    });

    const afterAdvance = state.getTournament(db, tournamentId);
    // Repaint the SAME panel in place for the next run/stage. On the final
    // advance, switch the organizer to the completion window with the generated
    // summary card and comment/publish controls.
    if (acked) {
      if (afterAdvance?.status === "completed") {
        await renderCompletionWindow(interaction, tournamentId, { edit: true, statusText: "Турнир завершён. Проверь итоги перед публикацией." });
      } else {
        await paintPanel(interaction, tournamentId, serverIndex, statusText);
      }
    }
    // Edit the server's single bracket image in place. The grand summary is
    // published later from the organizer completion window.
    scheduleServerArtUpdate(tournamentId, serverIndex);
    return true;
  }

  function finalizePlacement(tournament, server, stagePlan) {
    // snapshot the placement stage so the result bracket shows the final + bronze
    server.history = server.history || [];
    server.history.push(bracketImage.stageEntryFromPlan(stagePlan, server.decisions || {}));

    const matches = seeding.listStageMatches(stagePlan);
    const decisions = server.decisions || {};
    const placement = { first: null, second: null, third: null };

    const finalMatch = matches.find((m) => m.placement === "final") || matches[0];
    if (finalMatch) {
      const outcome = seeding.resolveMatchOutcome(finalMatch, decisions[finalMatch.key] || {});
      if (outcome.winner) {
        placement.first = outcome.winner;
        const winnerId = String(outcome.winner.userId || outcome.winner.id);
        for (const side of [finalMatch.red, finalMatch.blue]) {
          if (side && String(side.userId || side.id) !== winnerId) placement.second = side;
        }
      }
    }
    const bronzeMatch = matches.find((m) => m.placement === "bronze");
    if (bronzeMatch) {
      const outcome = seeding.resolveMatchOutcome(bronzeMatch, decisions[bronzeMatch.key] || {});
      if (outcome.winner) placement.third = outcome.winner;
    }

    server.done = true;
    server.champion = placement.first;
    server.placement = placement;
    maybeCompleteTournament(tournament);
  }

  function maybeCompleteTournament(tournament) {
    // multi-server: the tournament is decided by the cross-server FINAL server.
    if (isMultiServer(tournament)) {
      const finalServer = state.getServer(tournament, FINAL_SERVER_INDEX);
      if (!finalServer || !finalServer.done || !finalServer.placement) return;
      state.updateTournament(db, tournament.id, {
        status: "completed",
        results: {
          first: finalServer.placement.first || null,
          second: finalServer.placement.second || null,
          third: finalServer.placement.third || null,
          organizerComment: tournament.results?.organizerComment || null,
        },
      });
      return;
    }
    // single-server: completed when that server reaches its placement.
    const primary = state.getServer(tournament, 0);
    if (!primary || !primary.done || !primary.placement) return;
    state.updateTournament(db, tournament.id, {
      status: "completed",
      results: {
        first: primary.placement.first || null,
        second: primary.placement.second || null,
        third: primary.placement.third || null,
        organizerComment: tournament.results?.organizerComment || null,
      },
    });
  }

  // =========================================================================
  // Phantom auto-fill — drop one-off made-up players into empty slots so a
  // tournament can be run end-to-end. Safe by design: phantom players use
  // synthetic non-Discord ids (never pinged / never get real roles), real
  // registrations are untouched, and the tournament is flagged `isPhantom` so it
  // is never counted anywhere.
  // =========================================================================

  async function attachPhantomAvatars(registrations) {
    if (typeof fetchAvatarHeadshots !== "function") return;
    const ids = [...new Set(registrations.map((r) => r.robloxUserId).filter(Boolean))];
    if (!ids.length) return;
    try {
      const heads = await fetchAvatarHeadshots(ids);
      const map = new Map((heads || []).map((h) => [String(h.targetId), h.imageUrl]));
      for (const reg of registrations) {
        const url = map.get(String(reg.robloxUserId));
        if (url) reg.robloxAvatarUrl = url;
      }
    } catch {
      /* offline-safe: bracket art falls back to initials */
    }
  }

  async function fillAllPlayers(interaction, tournamentId) {
    if (!requireMod(interaction)) return true;
    const acked = await safeDeferUpdate(interaction);
    const tournament = state.getTournament(db, tournamentId);
    if (!tournament) {
      await safeReply(interaction, ephemeralText("Турнир не найден."));
      return true;
    }
    if (hasLaunchedTournamentPlay(tournament)) {
      return renderManage(interaction, tournamentId, {
        edit: acked,
        statusText: "Сервер уже запущен: фантомами больше нельзя менять состав текущей сетки.",
      });
    }
    const need = Math.max(0, (Number(tournament.slots) || 0) - state.registrationCount(tournament));
    if (need <= 0) {
      return renderManage(interaction, tournamentId, { edit: acked, statusText: "Места уже заполнены — фантомы не нужны." });
    }

    const runTag = state.makeId().slice(0, 6);
    const phantoms = state.buildPhantomRegistrations(need, { runTag });
    await attachPhantomAvatars(phantoms);

    let seeded = false;
    quickMutate(() => {
      const fresh = state.getTournament(db, tournamentId);
      if (!fresh) return;
      fresh.isPhantom = true; // tournament is now phantom — not counted anywhere
      for (const reg of phantoms) {
        if (state.registrationCount(fresh) >= fresh.slots) break;
        state.upsertRegistration(fresh, reg);
      }
      // Seed the freshly-filled roster so phantoms get a serverIndex and the
      // bracket is launchable right away (no separate «Пересобрать дуэты» step).
      if (!hasLaunchedTournamentPlay(fresh)) {
        seeded = applyRosterSeeding(fresh);
      }
    });

    const fresh = state.getTournament(db, tournamentId);
    scheduleAnnouncementRefresh(tournamentId, "phantom-fill");
    await safeLogLine(`TOURNAMENT_PHANTOM_FILL: id=${tournamentId} added=${phantoms.length} total=${state.registrationCount(fresh)}/${fresh.slots} by=<@${interaction.user.id}>`);
    return renderManage(interaction, tournamentId, {
      edit: acked,
      statusText: seeded
        ? `👻 Добавлено фантомов: ${phantoms.length}. Дуэты пересобраны — можно сразу «Запустить сервер».`
        : `👻 Добавлено фантомов: ${phantoms.length}. Турнир стал фантомным (не учитывается). Жми «Пересобрать дуэты».`,
    });
  }

  async function clearPhantoms(interaction, tournamentId) {
    if (!requireMod(interaction)) return true;
    const acked = await safeDeferUpdate(interaction);
    const tournament = state.getTournament(db, tournamentId);
    if (!tournament) {
      await safeReply(interaction, ephemeralText("Турнир не найден."));
      return true;
    }
    if (hasLaunchedTournamentPlay(tournament)) {
      return renderManage(interaction, tournamentId, {
        edit: acked,
        statusText: "Сервер уже запущен: фантомов нельзя убирать из текущей сетки.",
      });
    }
    let removed = 0;
    quickMutate(() => {
      const fresh = state.getTournament(db, tournamentId);
      if (!fresh) return;
      removed = state.removePhantomRegistrations(fresh);
      if (state.phantomCount(fresh) === 0) fresh.isPhantom = false;
      resetSeededTournamentAfterRosterChange(fresh);
    });
    const fresh = state.getTournament(db, tournamentId);
    if (fresh) scheduleAnnouncementRefresh(tournamentId, "phantom-clear");
    await safeLogLine(`TOURNAMENT_PHANTOM_CLEAR: id=${tournamentId} removed=${removed} by=<@${interaction.user.id}>`);
    return renderManage(interaction, tournamentId, { edit: acked, statusText: `🧹 Убрано фантомов: ${removed}. Реальные игроки на месте.` });
  }

  return {
    handleSlashCommand,
    handleButtonInteraction,
    handleSelectMenuInteraction,
    handleModalSubmitInteraction,
  };
}

module.exports = { createTournamentOperator };
