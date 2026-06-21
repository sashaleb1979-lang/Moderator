"use strict";

// Tournament interaction operator. Factory mirrors src/antiteam/operator.js:
// createTournamentOperator(deps) returns handleSlashCommand / handleButtonInteraction
// / handleSelectMenuInteraction / handleModalSubmitInteraction, each returning a
// boolean "handled". All Discord I/O goes through injected deps so the module
// stays decoupled from welcome-bot.js internals.

const { MessageFlags, ChannelType, AttachmentBuilder } = require("discord.js");

const {
  TOURNAMENT_COMMAND_NAME,
  TOURNAMENT_TEST_SUBCOMMAND,
  ACTIONS,
  parseCustomId,
} = require("./commands");
const view = require("./view");
const { parseMskDateTime } = require("./time");
const seeding = require("./seeding");
const state = require("./state");
const bracketImage = require("./bracket-image");

const UNKNOWN_INTERACTION_CODES = new Set([10062, 40060]);

function isUnknownInteractionError(error) {
  return Boolean(error && UNKNOWN_INTERACTION_CODES.has(error.code));
}

function toPositiveIntOrNull(value) {
  const number = Number(String(value).replace(/[^\d]/g, ""));
  return Number.isSafeInteger(number) && number > 0 ? number : null;
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
  } = deps;

  // Short-lived, in-memory registration sessions (not persisted — if the bot
  // restarts mid-flow the player simply clicks "Записаться" again).
  const pending = new Map();
  const pendingKey = (tournamentId, userId) => `${tournamentId}:${userId}`;

  // ---- response helpers (tolerate expired interactions) -------------------

  async function safeUpdate(interaction, payload) {
    try {
      if (interaction.deferred || interaction.replied) return await interaction.editReply(payload);
      return await interaction.update(payload);
    } catch (error) {
      if (isUnknownInteractionError(error)) return null;
      throw error;
    }
  }

  async function safeReply(interaction, payload) {
    try {
      if (interaction.deferred || interaction.replied) {
        return await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
      }
      return await interaction.reply(payload);
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

  // ---- announcement upkeep ------------------------------------------------

  async function refreshAnnouncement(tournament) {
    const announce = tournament.announce || {};
    if (!announce.channelId || !announce.messageId) return;
    const channel = await fetchChannel(announce.channelId).catch(() => null);
    if (!channel?.messages?.fetch) return;
    const message = await channel.messages.fetch(announce.messageId).catch(() => null);
    if (!message?.edit) return;
    await message.edit(view.buildAnnouncementPayload(tournament, { ping: false })).catch(() => {});
  }

  function serverCount(tournament) {
    return seeding.serverCountForSlots(tournament.slots);
  }

  // ---- v2 image art (graceful: returns null / falls back to embeds) -------

  const imagesEnabled = typeof renderImage === "function";

  // Fetch Roblox avatar buffers for every registered player, keyed by userId.
  async function collectTournamentAvatars(tournament) {
    if (typeof fetchImageBuffer !== "function") return {};
    const avatars = {};
    const tasks = [];
    for (const player of state.tournamentPlayers(tournament)) {
      const id = String(player.userId || player.id || "");
      const url = player.robloxAvatarUrl;
      if (!id || !url || avatars[id] !== undefined) continue;
      avatars[id] = null; // reserve to dedupe
      tasks.push(
        Promise.resolve(fetchImageBuffer(url))
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
        avatars,
      });
      return await renderImage("renderBracketCard", model);
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

  // Build a sendable payload: PNG attachment when available, else embed fallback.
  function imageOrEmbed(buffer, filename, fallbackPayload, extra = {}) {
    if (buffer) {
      return { ...extra, files: [new AttachmentBuilder(buffer, { name: filename })], embeds: [] };
    }
    return { ...extra, embeds: fallbackPayload.embeds || [] };
  }

  // Post a server's result bracket + the grand summary once finished (idempotent
  // via stored flags). Runs after the advance mutation, outside the serialized
  // lock, so rendering never blocks the click handler.
  async function postCompletionArtIfNeeded(tournamentId, serverIndex) {
    const tournament = state.getTournament(db, tournamentId);
    if (!tournament) return;
    const server = state.getServer(tournament, serverIndex);
    const channel = await fetchChannel(tournament.announce?.channelId).catch(() => null);
    const thread = server?.threadId
      ? await fetchChannel(server.threadId).catch(() => null)
      : null;

    let avatars = null;
    const getAvatars = async () => {
      if (!avatars) avatars = await collectTournamentAvatars(tournament);
      return avatars;
    };

    if (server?.done && !server.resultImagePosted) {
      const buffer = await renderServerBracketBuffer(tournament, server, await getAvatars());
      const fallback = view.buildPreliminaryBracketPayload(tournament, server.currentStage, { serverIndex });
      const payload = imageOrEmbed(buffer, `bracket-server-${serverIndex + 1}.png`, fallback, {
        content: `🏁 Сервер ${serverIndex + 1} — итоги`,
        allowedMentions: { parse: [] },
      });
      if (channel?.send) await channel.send(payload).catch(() => {});
      if (thread?.send) await thread.send(payload).catch(() => {});
      await persist("tournament-result-posted", async () => {
        const fresh = state.getServer(state.getTournament(db, tournamentId), serverIndex);
        if (fresh) fresh.resultImagePosted = true;
      });
    }

    if (tournament.status === "completed" && !tournament.summaryPosted) {
      const buffer = await renderSummaryBuffer(tournament, await getAvatars());
      if (channel?.send) {
        if (buffer) {
          await channel
            .send({ content: "🏆 Итоги турнира", files: [new AttachmentBuilder(buffer, { name: "tournament-summary.png" })], allowedMentions: { parse: [] } })
            .catch(() => {});
        } else {
          const r = tournament.results || {};
          const lines = [
            r.first && `🥇 ${view.playerLabel(r.first)}`,
            r.second && `🥈 ${view.playerLabel(r.second)}`,
            r.third && `🥉 ${view.playerLabel(r.third)}`,
          ].filter(Boolean);
          await channel.send({ content: `🏆 **${tournament.name}** — итоги\n${lines.join("\n")}`, allowedMentions: { parse: [] } }).catch(() => {});
        }
      }
      await persist("tournament-summary-posted", async () => {
        state.updateTournament(db, tournamentId, { summaryPosted: true });
      });
    }
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
    const sub = (() => {
      try { return interaction.options.getSubcommand(); } catch { return null; }
    })();
    if (sub === TOURNAMENT_TEST_SUBCOMMAND) {
      await safeReply(interaction, view.buildTestPanelPayload(state.listTestTournaments(db)));
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
      case ACTIONS.MANAGE_REFRESH:
        return renderManage(interaction, tournamentId, { edit: action === ACTIONS.MANAGE_REFRESH });
      case ACTIONS.MANAGE_CLOSE_REG:
        return toggleRegistration(interaction, tournamentId, false);
      case ACTIONS.MANAGE_OPEN_REG:
        return toggleRegistration(interaction, tournamentId, true);
      case ACTIONS.MANAGE_FORM_DUELS:
        return formDuels(interaction, tournamentId);
      case ACTIONS.MANAGE_LAUNCH_SERVER:
        return launchServer(interaction, tournamentId, Number(extra[0]) || 0);
      case ACTIONS.MANAGE_START:
        return openMatchPanel(interaction, tournamentId, Number(extra[0]) || 0);
      case ACTIONS.MANAGE_CANCEL:
        return cancelTournament(interaction, tournamentId);

      // ----- match results -----
      case ACTIONS.MATCH_WIN:
        return recordMatch(interaction, tournamentId, extra, "win");
      case ACTIONS.MATCH_NOSHOW:
        return recordMatch(interaction, tournamentId, extra, "noshow");
      case ACTIONS.MATCH_UNDO:
        return recordMatch(interaction, tournamentId, extra, "undo");
      case ACTIONS.STAGE_ADVANCE:
        return advanceStage(interaction, tournamentId, Number(extra[0]) || 0);

      // ----- test harness -----
      case ACTIONS.TEST_REFRESH:
        await safeUpdate(interaction, view.buildTestPanelPayload(state.listTestTournaments(db)));
        return true;
      case ACTIONS.TEST_CREATE:
        return createTestTournament(interaction, Number(extra[0]) || 16);
      case ACTIONS.TEST_FILL:
        return fillTestTournament(interaction, tournamentId, extra[0] || "full");
      case ACTIONS.TEST_RESET:
        return resetTestTournament(interaction, tournamentId);
      case ACTIONS.TEST_DELETE:
        return deleteTestTournament(interaction, tournamentId, { purge: false });
      case ACTIONS.TEST_PURGE:
        return purgeTestTournaments(interaction);

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
      case ACTIONS.REG_PICK_KILLS:
        return pickStrength(interaction, tournamentId, extra[0] || "alt", Number(values[0]) || 0);
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

    const message = await channel.send(view.buildAnnouncementPayload(tournament, { ping: true })).catch((error) => {
      logError("tournament: failed to post announcement", error?.message || error);
      return null;
    });
    if (!message) {
      await safeReply(interaction, ephemeralText("Не удалось опубликовать анонс."));
      return true;
    }

    await persist("tournament-announce-link", async () => {
      state.updateTournament(db, tournament.id, {
        announce: { channelId: channel.id, messageId: message.id },
      });
      state.clearDraft(db, interaction.user.id);
    });

    const fresh = state.getTournament(db, tournament.id);
    const payload = view.buildManagePanelPayload(fresh, {
      statusText: "Турнир опубликован ✅",
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
      const payload = view.buildRegisteredPayload(tournament, { seatNumber: seat });
      edit ? await safeUpdate(interaction, payload) : await safeReply(interaction, payload);
      return true;
    }
    if (tournament.registrationOpen === false) {
      await safeReply(interaction, ephemeralText("Набор на этот турнир закрыт."));
      return true;
    }

    const snapshot = (await Promise.resolve(getPlayerSnapshot(userId)).catch(() => ({}))) || {};
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
        kills: approvedKills,
        avatarUrl: snapshot.robloxAvatarUrl,
        screenshotUrl: snapshot.lastScreenshotUrl,
      });
      edit ? await safeUpdate(interaction, payload) : await safeReply(interaction, payload);
      return true;
    }

    pending.set(pendingKey(tournamentId, userId), { accountKind: "main", approvedKills });
    const payload = view.buildRegNoAccountPayload(tournament, {
      kills: approvedKills,
      screenshotUrl: snapshot.lastScreenshotUrl,
      canTwink: state.canSelfDeclareTwink(approvedKills),
    });
    edit ? await safeUpdate(interaction, payload) : await safeReply(interaction, payload);
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
    if (!resolved?.userId) {
      await safeReply(interaction, ephemeralText("Такой Roblox аккаунт не найден. Проверь ник."));
      return true;
    }

    const userId = interaction.user.id;
    const session = pending.get(pendingKey(tournamentId, userId)) || { approvedKills: 0 };
    session.robloxUsername = resolved.username || nick;
    session.robloxUserId = resolved.userId;
    session.robloxAvatarUrl = resolved.avatarUrl || null;

    if (kind === "main") {
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
      robloxAvatarUrl: session.robloxAvatarUrl,
      accountKind: session.accountKind,
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
    if (state.isFull(tournament) && !state.getRegistration(tournament, interaction.user.id)) {
      await safeReply(interaction, ephemeralText("Все места заняты."));
      return true;
    }

    const userId = interaction.user.id;
    await persist("tournament-register", async () => {
      const fresh = state.getTournament(db, tournamentId);
      state.upsertRegistration(fresh, {
        userId,
        discordName: interaction.user.tag,
        robloxUserId: session.robloxUserId,
        robloxUsername: session.robloxUsername,
        robloxAvatarUrl: session.robloxAvatarUrl,
        accountKind: session.accountKind,
        approvedKills: session.approvedKills,
        declaredKills: session.declaredKills ?? null,
      });
    });
    pending.delete(pendingKey(tournamentId, userId));

    const fresh = state.getTournament(db, tournamentId);
    await refreshAnnouncement(fresh);
    await safeUpdate(interaction, view.buildRegisteredPayload(fresh, { seatNumber: registrationSeat(fresh, userId) }));
    return true;
  }

  async function withdrawRegistration(interaction, tournamentId) {
    const userId = interaction.user.id;
    await persist("tournament-withdraw", async () => {
      const fresh = state.getTournament(db, tournamentId);
      if (fresh) state.removeRegistration(fresh, userId);
    });
    pending.delete(pendingKey(tournamentId, userId));
    const fresh = state.getTournament(db, tournamentId);
    if (fresh) await refreshAnnouncement(fresh);
    await safeUpdate(interaction, { content: "Заявка отозвана.", embeds: [], components: [], flags: MessageFlags.Ephemeral });
    return true;
  }

  function registrationSeat(tournament, userId) {
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
    const payload = view.buildManagePanelPayload(tournament, { statusText, serverCount: serverCount(tournament) });
    edit ? await safeUpdate(interaction, payload) : await safeReply(interaction, payload);
    return true;
  }

  async function toggleRegistration(interaction, tournamentId, open) {
    if (!requireMod(interaction)) return true;
    await persist("tournament-toggle-reg", async () => {
      state.updateTournament(db, tournamentId, { registrationOpen: open });
    });
    const tournament = state.getTournament(db, tournamentId);
    await refreshAnnouncement(tournament);
    return renderManage(interaction, tournamentId, { edit: true, statusText: open ? "Набор открыт." : "Набор закрыт." });
  }

  async function formDuels(interaction, tournamentId) {
    if (!requireMod(interaction)) return true;
    const tournament = state.getTournament(db, tournamentId);
    if (!tournament) {
      await safeReply(interaction, ephemeralText("Турнир не найден."));
      return true;
    }
    const players = state.tournamentPlayers(tournament);
    if (players.length < 2) {
      await safeReply(interaction, ephemeralText("Недостаточно участников для распределения."));
      return true;
    }
    // persist seed numbers + server assignment (single server for v1)
    await persist("tournament-form", async () => {
      const fresh = state.getTournament(db, tournamentId);
      const seeded = seeding.assignSeedNumbers(state.tournamentPlayers(fresh));
      for (const player of seeded) {
        const reg = state.getRegistration(fresh, player.userId || player.id);
        if (reg) {
          reg.seedNumber = player.seedNumber;
          reg.serverIndex = 0;
        }
      }
      state.updateTournament(db, tournamentId, { status: "seeded" });
    });
    const fresh = state.getTournament(db, tournamentId);
    const plan = seeding.buildStage(state.tournamentPlayers(fresh), fresh.seedingMode, 1);
    await safeReply(interaction, view.buildRosterPayload(fresh, plan, { serverIndex: 0 }));
    return true;
  }

  async function launchServer(interaction, tournamentId, serverIndex) {
    if (!requireMod(interaction)) return true;
    const acked = await safeDeferUpdate(interaction);
    const tournament = state.getTournament(db, tournamentId);
    if (!tournament) {
      await safeReply(interaction, ephemeralText("Турнир не найден."));
      return true;
    }
    const count = serverCount(tournament);
    const players = state.tournamentPlayers(tournament, count > 1 ? { serverIndex } : {});
    if (players.length < 2) {
      await safeReply(interaction, ephemeralText("Недостаточно участников на сервере."));
      return true;
    }

    const plan = seeding.planNextStage({
      survivors: players,
      mode: tournament.seedingMode,
      stageNumber: 1,
    });
    const stagePlan = plan.type === "stage" || plan.type === "placement" ? plan.stage : null;
    if (!stagePlan) {
      await safeReply(interaction, ephemeralText("Не удалось сформировать сетку."));
      return true;
    }

    // Render the preliminary bracket (PNG art with embed fallback).
    const transientServer = { index: serverIndex, currentStage: stagePlan, decisions: {}, history: [], done: false };
    const avatars = await collectTournamentAvatars(tournament);
    const bracketBuffer = await renderServerBracketBuffer(tournament, transientServer, avatars);
    const fallback = view.buildPreliminaryBracketPayload(tournament, stagePlan, { serverIndex });
    const bracketPayload = imageOrEmbed(bracketBuffer, `bracket-server-${serverIndex + 1}.png`, fallback, {
      allowedMentions: { parse: [] },
    });

    // Post the preliminary bracket and open a private participant thread.
    const channel = await fetchChannel(tournament.announce.channelId).catch(() => null);
    let threadId = "";
    let launchMessageId = "";
    if (channel?.send) {
      const announceMsg = await channel
        .send({ ...bracketPayload, content: `🚀 Сервер ${serverIndex + 1} начинает работу!` })
        .catch(() => null);
      launchMessageId = announceMsg?.id || "";

      if (channel.threads?.create) {
        const thread = await channel.threads
          .create({
            name: view.buildServerThreadName(tournament, serverIndex),
            type: ChannelType.PrivateThread,
            invitable: false,
            autoArchiveDuration: 1440,
          })
          .catch((error) => {
            logError("tournament: private thread create failed", error?.message || error);
            return null;
          });
        if (thread) {
          threadId = thread.id;
          // re-attach a fresh buffer copy for the thread message
          const threadBuffer = bracketBuffer || (await renderServerBracketBuffer(tournament, transientServer, avatars));
          await thread.send(imageOrEmbed(threadBuffer, `bracket-server-${serverIndex + 1}.png`, fallback, { allowedMentions: { parse: [] } })).catch(() => {});
          // only real Discord snowflakes get pinged (test "bot" players have synthetic ids)
          const ids = players.map((p) => String(p.userId || p.id)).filter((id) => /^\d+$/.test(id));
          if (ids.length) {
            await thread
              .send({ content: ids.map((id) => `<@${id}>`).join(" "), allowedMentions: { users: ids } })
              .catch(() => {});
          }
          await thread.setLocked(true).catch(() => {});
        }
      }
    }

    await persist("tournament-launch", async () => {
      const fresh = state.getTournament(db, tournamentId);
      const server = state.ensureServer(fresh, serverIndex);
      server.launched = true;
      server.launchMessageId = launchMessageId;
      server.threadId = threadId;
      server.stageNumber = 1;
      server.runIndex = 0;
      server.currentStage = stagePlan;
      server.decisions = {};
      server.semifinalLosers = [];
      state.updateTournament(db, tournamentId, { status: "running" });
    });

    return renderManage(interaction, tournamentId, {
      edit: acked,
      statusText: `Сервер ${serverIndex + 1} запущен${threadId ? " · ветка создана" : ""}.`,
    });
  }

  async function openMatchPanel(interaction, tournamentId, serverIndex) {
    if (!requireMod(interaction)) return true;
    const tournament = state.getTournament(db, tournamentId);
    const server = tournament ? state.getServer(tournament, serverIndex) : null;
    if (!server || !server.currentStage) {
      await safeReply(interaction, ephemeralText("Сначала запусти сервер."));
      return true;
    }
    await safeReply(interaction, view.buildMatchPanelPayload(tournament, server));
    return true;
  }

  async function cancelTournament(interaction, tournamentId) {
    if (!requireMod(interaction)) return true;
    await persist("tournament-cancel", async () => {
      state.updateTournament(db, tournamentId, { status: "cancelled", registrationOpen: false });
    });
    const tournament = state.getTournament(db, tournamentId);
    if (tournament) await refreshAnnouncement(tournament);
    return renderManage(interaction, tournamentId, { edit: true, statusText: "Турнир отменён." });
  }

  // =========================================================================
  // Match results + advancement
  // =========================================================================

  async function recordMatch(interaction, tournamentId, extra, kind) {
    if (!requireMod(interaction)) return true;
    const serverIndex = Number(extra[0]) || 0;
    const matchKey = extra[1];
    const targetId = extra[2];

    await persist("tournament-record", async () => {
      const fresh = state.getTournament(db, tournamentId);
      const server = fresh ? state.getServer(fresh, serverIndex) : null;
      if (!server) return;
      server.decisions = server.decisions || {};
      const current = server.decisions[matchKey] || { winnerId: null, noShowIds: [] };

      if (kind === "undo") {
        delete server.decisions[matchKey];
        return;
      }
      if (kind === "win") {
        current.winnerId = targetId;
      } else if (kind === "noshow") {
        const set = new Set(current.noShowIds || []);
        set.add(String(targetId));
        current.noShowIds = [...set];
        current.winnerId = null;
      }
      server.decisions[matchKey] = current;
    });

    const tournament = state.getTournament(db, tournamentId);
    const server = state.getServer(tournament, serverIndex);
    await safeUpdate(interaction, view.buildMatchPanelPayload(tournament, server));
    return true;
  }

  async function advanceStage(interaction, tournamentId, serverIndex) {
    if (!requireMod(interaction)) return true;

    let statusText = "";
    await persist("tournament-advance", async () => {
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

    const tournament = state.getTournament(db, tournamentId);
    const server = state.getServer(tournament, serverIndex);
    await safeUpdate(interaction, view.buildMatchPanelPayload(tournament, server, { statusText }));
    // Post result/summary art after the click is answered (never blocks the UI).
    postCompletionArtIfNeeded(tournamentId, serverIndex).catch((error) =>
      logError("tournament: completion art failed", error?.message || error)
    );
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
    const count = serverCount(tournament);
    const servers = Object.values(tournament.servers || {});
    const launched = servers.filter((s) => s.launched);
    const allDone = launched.length >= count && launched.every((s) => s.done);
    if (!allDone) return;
    // v1 single-server: copy the server placement to tournament results
    const primary = servers.find((s) => s.done) || null;
    state.updateTournament(db, tournament.id, {
      status: "completed",
      results: primary
        ? {
            first: primary.placement?.first || null,
            second: primary.placement?.second || null,
            third: primary.placement?.third || null,
            organizerComment: tournament.results?.organizerComment || null,
          }
        : tournament.results,
    });
  }

  // =========================================================================
  // Test harness — isolated sandbox tournaments (flagged isTest) with quick rollback
  // =========================================================================

  async function refreshTestPanel(interaction, statusText) {
    await safeUpdate(interaction, view.buildTestPanelPayload(state.listTestTournaments(db), { statusText }));
    return true;
  }

  async function createTestTournament(interaction, slots) {
    if (!requireMod(interaction)) return true;
    const acked = await safeDeferUpdate(interaction);
    const channelId = interaction.channelId || interaction.channel?.id;
    const channel = channelId ? await fetchChannel(channelId).catch(() => null) : null;
    if (!channel?.send) {
      await safeReply(interaction, ephemeralText("Не получилось определить канал. Запусти команду в текстовом канале."));
      return true;
    }

    const tournament = await persist("tournament-test-create", async () =>
      state.createTournamentFromDraft(
        db,
        {
          name: `ТЕСТ · ${slots} игроков`,
          slots,
          plannedPlayers: slots,
          seedingMode: "similar",
          isTest: true,
          createdBy: interaction.user.id,
          createdByTag: interaction.user.tag,
          startsAtIso: new Date(Date.now() + 3600 * 1000).toISOString(),
          announceChannelId: channel.id,
          pingRoleIds: [],
          rewards: { first: "🏅 тестовая награда" },
          conditions: "Тестовый турнир — можно смело прогонять и удалять.",
        },
        { id: state.makeId() }
      )
    );

    const message = await channel.send(view.buildAnnouncementPayload(tournament, { ping: false })).catch(() => null);
    if (message) {
      await persist("tournament-test-link", async () => {
        state.updateTournament(db, tournament.id, { announce: { channelId: channel.id, messageId: message.id } });
      });
    }
    void acked;
    return refreshTestPanel(interaction, `Создан тестовый турнир на ${slots}. Жми «Заполнить ботами».`);
  }

  async function attachTestAvatars(registrations) {
    if (typeof fetchAvatarHeadshots !== "function") return;
    const ids = registrations.map((r) => r.robloxUserId).filter(Boolean);
    if (!ids.length) return;
    try {
      const heads = await fetchAvatarHeadshots(ids);
      const map = new Map((heads || []).map((h) => [String(h.targetId), h.imageUrl]));
      for (const reg of registrations) {
        const url = map.get(String(reg.robloxUserId));
        if (url) reg.robloxAvatarUrl = url;
      }
    } catch {
      /* offline-safe: renderer falls back to initials */
    }
  }

  async function fillTestTournament(interaction, tournamentId, countSpec) {
    if (!requireMod(interaction)) return true;
    const acked = await safeDeferUpdate(interaction);
    const tournament = state.getTournament(db, tournamentId);
    if (!tournament || !tournament.isTest) {
      await safeReply(interaction, ephemeralText("Тестовый турнир не найден."));
      return true;
    }
    const target = countSpec === "full" ? tournament.slots : Math.min(tournament.slots, Number(countSpec) || tournament.slots);
    const fakes = state.buildFakeRegistrations(target);
    await attachTestAvatars(fakes);

    await persist("tournament-test-fill", async () => {
      const fresh = state.getTournament(db, tournamentId);
      state.clearTournamentPlay(fresh); // replace any prior bots
      for (const reg of fakes) state.upsertRegistration(fresh, reg);
    });
    const fresh = state.getTournament(db, tournamentId);
    await refreshAnnouncement(fresh);
    void acked;
    return refreshTestPanel(interaction, `Заполнено ${fakes.length} ботов. Открой «Управление» → «Запустить сервер».`);
  }

  async function resetTestTournament(interaction, tournamentId) {
    if (!requireMod(interaction)) return true;
    await persist("tournament-test-reset", async () => {
      const fresh = state.getTournament(db, tournamentId);
      if (fresh) state.clearTournamentPlay(fresh);
    });
    const fresh = state.getTournament(db, tournamentId);
    if (fresh) await refreshAnnouncement(fresh);
    return refreshTestPanel(interaction, "Турнир сброшен к набору. Боты убраны, сетка очищена.");
  }

  async function cleanupTournamentMessages(tournament) {
    const channel = await fetchChannel(tournament.announce?.channelId).catch(() => null);
    if (channel?.messages?.fetch && tournament.announce?.messageId) {
      const message = await channel.messages.fetch(tournament.announce.messageId).catch(() => null);
      if (message?.delete) await message.delete().catch(() => {});
    }
    for (const server of Object.values(tournament.servers || {})) {
      if (!server.threadId) continue;
      const thread = await fetchChannel(server.threadId).catch(() => null);
      if (thread?.delete) await thread.delete().catch(() => {});
    }
  }

  async function deleteTestTournament(interaction, tournamentId) {
    if (!requireMod(interaction)) return true;
    const acked = await safeDeferUpdate(interaction);
    const tournament = state.getTournament(db, tournamentId);
    if (tournament) {
      await cleanupTournamentMessages(tournament);
      await persist("tournament-test-delete", async () => state.deleteTournament(db, tournamentId));
    }
    void acked;
    return refreshTestPanel(interaction, "Тестовый турнир удалён.");
  }

  async function purgeTestTournaments(interaction) {
    if (!requireMod(interaction)) return true;
    const acked = await safeDeferUpdate(interaction);
    const tests = state.listTestTournaments(db);
    for (const tournament of tests) {
      await cleanupTournamentMessages(tournament);
      await persist("tournament-test-purge", async () => state.deleteTournament(db, tournament.id));
    }
    void acked;
    return refreshTestPanel(interaction, `Удалено тестовых турниров: ${tests.length}.`);
  }

  return {
    handleSlashCommand,
    handleButtonInteraction,
    handleSelectMenuInteraction,
    handleModalSubmitInteraction,
  };
}

module.exports = { createTournamentOperator };
