"use strict";

// All Discord payload builders for the tournament module, built on Components V2
// (rich ContainerBuilder panels — see ui.js). Interactive panels return
// V2 payloads ({ components, flags: IsComponentsV2 [| Ephemeral] }); modals stay
// regular ModalBuilders. Nicks render as clickable Roblox profile links with
// kills everywhere.

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  UserSelectMenuBuilder,
  SectionBuilder,
  ThumbnailBuilder,
  ChannelType,
} = require("discord.js");

const { ACTIONS, COLORS, buildCustomId } = require("./commands");
const { formatStartTime } = require("./time");
const {
  TWINK_THRESHOLD,
  robloxProfileUrl,
  killsSourceLabel,
  phantomCount,
  activeRegistrationLimit,
  listWaitlistRegistrations,
  registrationQueueInfo,
} = require("./state");
const seeding = require("./seeding");
const ui = require("./ui");

const TWINK_WARNING =
  "⚠️ Твинки без согласования с админами и реального количества килов — быстрая дисквалификация при подозрении. " +
  "В заявке должно фигурировать примерно истинное количество килов.";

const SEEDING_MODE_LABELS = Object.freeze({
  similar: "🎯 Близкие килы (равные бои)",
  seed: "🏅 Посевная сетка (сильный vs слабый)",
});

const ACCOUNT_KIND_LABELS = Object.freeze({
  main: "основной",
  alt: "доп. аккаунт",
  twink: "твинк",
});

const KILLS_BUCKETS = Object.freeze([
  { value: 500, label: "до 1k килов", min: 0 },
  { value: 2000, label: "1k–3k килов", min: 0 },
  { value: 5000, label: "3k–6k килов", min: 3001 },
  { value: 7500, label: "6k–9k килов", min: 3001 },
  { value: 12000, label: "9k–15k килов", min: 3001 },
  { value: 18000, label: "15k+ килов", min: 3001 },
]);

const ROSTER_PAGE_SIZE = 8;

// --------------------------------------------------------------------------
// text/render helpers
// --------------------------------------------------------------------------

function fmtNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("ru-RU") : "0";
}

function hasLiveTournamentPlay(tournament) {
  return Object.values(tournament?.servers || {}).some((server) => (
    server && (server.launched || server.currentStage || server.done)
  ));
}

function playerName(player) {
  if (!player) return "—";
  return player.robloxUsername || player.discordName || `игрок ${player.userId || player.id || "?"}`;
}

// plain "Nick (kills)" — used in logs and the summary fallback.
function playerLabel(player) {
  if (!player) return "—";
  return `${playerName(player)} (${fmtNumber(player.kills != null ? player.kills : player.effectiveKills)})`;
}

// markdown: clickable Roblox link + kills (+ optional source) for V2 panels.
function playerMd(player, { withKills = true, withSource = false } = {}) {
  if (!player) return "—";
  const name = playerName(player);
  const url = player.robloxProfileUrl || robloxProfileUrl(player.robloxUserId);
  const linked = url ? `[${name}](${url})` : `**${name}**`;
  if (!withKills) return linked;
  const kills = fmtNumber(player.kills != null ? player.kills : player.effectiveKills);
  const src = withSource && player.killsSource ? ` · ${killsSourceLabel(player.killsSource)}` : "";
  return `${linked} — **${kills}** килов${src}`;
}

function colorDot(color) {
  return color === seeding.COLOR_RED ? "🔴" : "🔵";
}

function statusLabel(status) {
  return (
    {
      draft: "черновик",
      registration: "🟢 идёт набор",
      seeded: "🧩 распределён",
      running: "⚔️ идёт",
      completed: "🏁 завершён",
      cancelled: "✖ отменён",
    }[status] || status
  );
}

function btn(action, tournamentId, extra = [], { label, style = ButtonStyle.Secondary, emoji, disabled = false } = {}) {
  const b = new ButtonBuilder()
    .setCustomId(buildCustomId(action, tournamentId, ...(Array.isArray(extra) ? extra : [extra])))
    .setStyle(style)
    .setDisabled(disabled);
  if (label) b.setLabel(label.slice(0, 80));
  if (emoji) b.setEmoji(emoji);
  return b;
}

function linkBtn(url, label, emoji) {
  const b = new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url);
  if (label) b.setLabel(label.slice(0, 80));
  if (emoji) b.setEmoji(emoji);
  return b;
}

// --------------------------------------------------------------------------
// Moderator hub
// --------------------------------------------------------------------------

function buildHubPayload(tournaments = [], { statusText = "" } = {}) {
  const active = tournaments.filter((t) => t.status !== "completed" && t.status !== "cancelled");
  const c = ui.container(COLORS.primary, (container) => {
    container.addTextDisplayComponents(ui.td("# 🏆 Панель турниров"));
    container.addSeparatorComponents(ui.separator());
    if (active.length) {
      container.addTextDisplayComponents(
        ui.td(
          active
            .map(
              (t) =>
                `• **${t.name}** — ${statusLabel(t.status)} · ${fmtNumber(Object.keys(t.registrations || {}).length)}/${fmtNumber(t.slots)}` +
                (t.startsAtIso ? ` · ${formatStartTime(t.startsAtIso)}` : "")
            )
            .join("\n")
        )
      );
      for (const t of active.slice(0, 4)) {
        container.addActionRowComponents(
          ui.row(btn(ACTIONS.MANAGE_OPEN, t.id, [], { label: `Управление: ${t.name}`, style: ButtonStyle.Primary, emoji: "🛠" }))
        );
      }
    } else {
      container.addTextDisplayComponents(ui.td("_Активных турниров нет. Создай новый._"));
    }
    container.addSeparatorComponents(ui.separator());
    container.addActionRowComponents(
      ui.row(
        btn(ACTIONS.SETUP_OPEN, "new", [], { label: "Создать турнир", style: ButtonStyle.Success, emoji: "➕" }),
        btn(ACTIONS.HUB_REFRESH, "", [], { label: "Обновить", emoji: "🔄" })
      )
    );
    if (statusText) {
      container.addSeparatorComponents(ui.separator());
      container.addTextDisplayComponents(ui.td(`-# ${statusText}`));
    }
  });
  return ui.v2Ephemeral(c);
}

// --------------------------------------------------------------------------
// Setup panel (draft)
// --------------------------------------------------------------------------

function setupReady(draft) {
  return Boolean(
    draft &&
      String(draft.name || "").trim() &&
      draft.slots &&
      draft.startsAtIso &&
      String(draft.announceChannelId || "").trim()
  );
}

function buildSetupPanelPayload(draft = {}, { statusText = "" } = {}) {
  const mode = draft.seedingMode === "seed" ? "seed" : "similar";
  const pingRoles = Array.isArray(draft.pingRoleIds) ? draft.pingRoleIds : [];
  const rewards = draft.rewards || {};
  const ready = setupReady(draft);

  const c = ui.container(COLORS.purple, (container) => {
    container.addTextDisplayComponents(ui.td("# ⚙️ Новый турнир — настройка"));
    container.addSeparatorComponents(ui.separator());
    container.addTextDisplayComponents(
      ui.td(
        [
          `**Название:** ${draft.name || "—"}`,
          `**Мест:** ${draft.slots ? fmtNumber(draft.slots) : "—"} · **планируется:** ${draft.plannedPlayers ? fmtNumber(draft.plannedPlayers) : "—"}`,
          `**Время (МСК):** ${draft.startsAtIso ? formatStartTime(draft.startsAtIso) : "—"}`,
          `**Режим:** ${SEEDING_MODE_LABELS[mode]}`,
          `**Пинг-роли:** ${pingRoles.length ? pingRoles.map((id) => `<@&${id}>`).join(" ") : "—"}`,
          `**Роль участника:** ${draft.participantRoleId ? `<@&${draft.participantRoleId}>` : "—"}`,
          `**Канал анонса:** ${draft.announceChannelId ? `<#${draft.announceChannelId}>` : "—"}`,
          `**Награды:** ${[rewards.first && `🥇 ${rewards.first}`, rewards.second && `🥈 ${rewards.second}`, rewards.third && `🥉 ${rewards.third}`, rewards.extra].filter(Boolean).join(" · ") || "—"}`,
          `**Условия:** ${draft.conditions ? String(draft.conditions).slice(0, 300) : "—"}`,
        ].join("\n")
      )
    );
    container.addSeparatorComponents(ui.separator());
    container.addActionRowComponents(
      ui.row(
        btn(ACTIONS.SETUP_BASICS, "", [], { label: "Основное", style: ButtonStyle.Primary, emoji: "📝" }),
        btn(ACTIONS.SETUP_TIME, "", [], { label: "Время МСК", style: ButtonStyle.Primary, emoji: "🕒" }),
        btn(ACTIONS.SETUP_REWARDS, "", [], { label: "Награды", style: ButtonStyle.Primary, emoji: "🎁" }),
        btn(ACTIONS.SETUP_CONDITIONS, "", [], { label: "Условия", style: ButtonStyle.Primary, emoji: "📋" })
      )
    );
    container.addActionRowComponents(
      ui.row(
        new StringSelectMenuBuilder()
          .setCustomId(buildCustomId(ACTIONS.SETUP_MODE))
          .setPlaceholder("Режим распределения пар")
          .addOptions(
            { label: "Близкие килы (равные бои)", value: "similar", default: mode === "similar", emoji: "🎯" },
            { label: "Посевная сетка (сильный vs слабый)", value: "seed", default: mode === "seed", emoji: "🏅" }
          )
      )
    );
    container.addActionRowComponents(
      ui.row(new RoleSelectMenuBuilder().setCustomId(buildCustomId(ACTIONS.SETUP_PING)).setPlaceholder("Роли для пинга").setMinValues(0).setMaxValues(10))
    );
    container.addActionRowComponents(
      ui.row(new RoleSelectMenuBuilder().setCustomId(buildCustomId(ACTIONS.SETUP_ROLE)).setPlaceholder("Роль участника турнира (выдаётся при заявке)").setMinValues(0).setMaxValues(1))
    );
    container.addActionRowComponents(
      ui.row(new ChannelSelectMenuBuilder().setCustomId(buildCustomId(ACTIONS.SETUP_CHANNEL)).setPlaceholder("Канал для анонса").addChannelTypes(ChannelType.GuildText))
    );
    container.addSeparatorComponents(ui.separator());
    container.addActionRowComponents(
      ui.row(
        btn(ACTIONS.SETUP_PUBLISH, "", [], { label: "Опубликовать анонс", style: ButtonStyle.Success, emoji: "🚀", disabled: !ready }),
        btn(ACTIONS.SETUP_CANCEL, "", [], { label: "Отмена", style: ButtonStyle.Danger, emoji: "🗑" })
      )
    );
    container.addTextDisplayComponents(ui.td(ready ? "-# ✅ Готово к публикации." : "-# Заполни название, места, время и канал."));
    if (statusText) container.addTextDisplayComponents(ui.td(`-# ${statusText}`));
  });
  return ui.v2Ephemeral(c);
}

function buildBasicsModal(draft = {}) {
  return new ModalBuilder()
    .setCustomId(buildCustomId(ACTIONS.SETUP_BASICS))
    .setTitle("Основное")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("name").setLabel("Название турнира").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(120).setValue(String(draft.name || ""))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("slots").setLabel("Сколько открытых мест (16, 32, …)").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(4).setValue(draft.slots ? String(draft.slots) : "16")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("planned").setLabel("Сколько человек планируется (необязательно)").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(4).setValue(draft.plannedPlayers ? String(draft.plannedPlayers) : "")
      )
    );
}

function buildTimeModal(draft = {}) {
  return new ModalBuilder()
    .setCustomId(buildCustomId(ACTIONS.SETUP_TIME))
    .setTitle("Время по МСК")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("time").setLabel("Дата и время МСК").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("25.06 20:00  или  25.06.2026 20:00").setMaxLength(40)
      )
    );
}

function buildRewardsModal(draft = {}) {
  const rewards = draft.rewards || {};
  return new ModalBuilder()
    .setCustomId(buildCustomId(ACTIONS.SETUP_REWARDS))
    .setTitle("Награды")
    .addComponents(
      ...["first", "second", "third"].map((place, idx) =>
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId(place).setLabel(`${idx + 1} место`).setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(200).setValue(String(rewards[place] || ""))
        )
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("extra").setLabel("Доп. награды / примечание").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(400).setValue(String(rewards.extra || ""))
      )
    );
}

function buildConditionsModal(draft = {}) {
  return new ModalBuilder()
    .setCustomId(buildCustomId(ACTIONS.SETUP_CONDITIONS))
    .setTitle("Условия участия")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("conditions").setLabel("Условия (персонажи не забанены и т.д.)").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000).setValue(String(draft.conditions || ""))
      )
    );
}

// --------------------------------------------------------------------------
// Public announcement
// --------------------------------------------------------------------------

function buildAnnouncementPayload(tournament, { ping = false } = {}) {
  const taken = Object.keys(tournament.registrations || {}).length;
  const slots = tournament.slots || 16;
  const activeLimit = activeRegistrationLimit(tournament);
  const waitlistCount = Math.max(0, taken - activeLimit);
  const rewards = tournament.rewards || {};
  const open = tournament.registrationOpen !== false;
  const pingRoles = Array.isArray(tournament.pingRoleIds) ? tournament.pingRoleIds : [];

  const rewardLines = [
    rewards.first && `🥇 ${rewards.first}`,
    rewards.second && `🥈 ${rewards.second}`,
    rewards.third && `🥉 ${rewards.third}`,
    rewards.extra,
  ].filter(Boolean);

  const c = ui.container(COLORS.gold, (container) => {
    container.addTextDisplayComponents(ui.td(`# 🏆 ${tournament.name}`));
    container.addTextDisplayComponents(
      ui.td(
        ["Формат: **1 на 1, FT6** (6 боёв на пару).", tournament.startsAtIso ? `🗓 Старт: ${formatStartTime(tournament.startsAtIso)}` : null]
          .filter(Boolean)
          .join("\n")
      )
    );
    container.addSeparatorComponents(ui.separator());
    container.addTextDisplayComponents(
      ui.td(
        [
          `## Основной состав: ${Math.min(taken, activeLimit)} / ${activeLimit}`,
          waitlistCount ? `Резерв: **${waitlistCount}** · очередь двигается, если кто-то отзовёт заявку.` : null,
          `Всего заявок: ${taken}${slots && slots !== activeLimit ? ` / ${slots}` : ""}`,
          open ? "🟢 **Набор открыт**" : "🔴 **Набор закрыт**",
        ].filter(Boolean).join("\n")
      )
    );
    if (rewardLines.length) {
      container.addSeparatorComponents(ui.separator());
      container.addTextDisplayComponents(ui.td(`**Награды**\n${rewardLines.join("\n")}`));
    }
    if (tournament.conditions) {
      container.addTextDisplayComponents(ui.td(`**Условия**\n${String(tournament.conditions).slice(0, 800)}`));
    }
    container.addSeparatorComponents(ui.separator());
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(ui.td(open ? "Жми, чтобы подать заявку на участие." : "Набор на этот турнир закрыт."))
        .setButtonAccessory(
          btn(ACTIONS.REGISTER_OPEN, tournament.id, [], { label: open ? "Записаться" : "Набор закрыт", style: ButtonStyle.Success, emoji: "✍️", disabled: !open })
        )
    );
    container.addTextDisplayComponents(ui.td(`-# ${TWINK_WARNING}`));
  });

  return ui.v2Public(c, {
    content: ping && pingRoles.length ? pingRoles.map((id) => `<@&${id}>`).join(" ") : undefined,
    allowedMentions: ping ? { roles: pingRoles } : { parse: [] },
  });
}

// --------------------------------------------------------------------------
// Registration flow (player-facing, ephemeral)
// --------------------------------------------------------------------------

function regBackButton(tournamentId) {
  return btn(ACTIONS.REG_BACK, tournamentId, [], { label: "Назад", emoji: "↩" });
}

function buildRegMainConfirmPayload(tournament, info = {}) {
  const profileUrl = robloxProfileUrl(info.robloxUserId);
  const c = ui.container(COLORS.primary, (container) => {
    container.addTextDisplayComponents(ui.td(`# Заявка · ${tournament.name}`));
    container.addSeparatorComponents(ui.separator());
    const headText = ui.td(
      [
        `Сохранённый Roblox: ${profileUrl ? `[${info.robloxUsername || "—"}](${profileUrl})` : `**${info.robloxUsername || "—"}**`}`,
        `Зарегистрировано килов: **${fmtNumber(info.kills)}**`,
        "",
        "**На этом аккаунте будешь играть?**",
      ].join("\n")
    );
    if (info.avatarUrl) {
      container.addSectionComponents(
        new SectionBuilder().addTextDisplayComponents(headText).setThumbnailAccessory(new ThumbnailBuilder().setURL(info.avatarUrl))
      );
    } else {
      container.addTextDisplayComponents(headText);
    }
    if (info.screenshotUrl) container.addMediaGalleryComponents(ui.mediaImage(info.screenshotUrl, "Последний скрин-пруф"));
    else if (info.screenshotUnavailable) container.addTextDisplayComponents(ui.td("-# Скрин заявки найден, но файл не удалось прикрепить. Напиши модератору, если нужен ручной чек."));
    container.addActionRowComponents(
      ui.row(
        btn(ACTIONS.REG_USE_MAIN, tournament.id, [], { label: "Да, на этом", style: ButtonStyle.Success, emoji: "✅" }),
        btn(ACTIONS.REG_USE_OTHER, tournament.id, [], { label: "Буду с другого", style: ButtonStyle.Primary, emoji: "🔁" }),
        btn(ACTIONS.REG_WITHDRAW, tournament.id, [], { label: "Отмена", emoji: "✖" })
      )
    );
    container.addTextDisplayComponents(ui.td(`-# ${TWINK_WARNING}`));
  });
  return ui.v2Ephemeral(c);
}

function buildRegCollectingPayload(tournament) {
  const c = ui.container(COLORS.primary, (container) => {
    container.addTextDisplayComponents(ui.td(`# Заявка · ${tournament?.name || "турнир"}`));
    container.addSeparatorComponents(ui.separator());
    container.addTextDisplayComponents(
      ui.td(
        [
          "Модератор собирает вашу заявку…",
          "-# Ищу профиль, Roblox и последний скрин с киллами. Это сообщение само заменится формой.",
        ].join("\n")
      )
    );
  });
  return ui.v2Ephemeral(c);
}

function buildRegNoAccountPayload(tournament, info = {}) {
  const c = ui.container(COLORS.primary, (container) => {
    container.addTextDisplayComponents(ui.td(`# Заявка · ${tournament.name}`));
    container.addSeparatorComponents(ui.separator());
    container.addTextDisplayComponents(
      ui.td(
        [
          "У нас нет привязанного Roblox-аккаунта.",
          `Зарегистрировано килов: **${fmtNumber(info.kills)}**`,
          "",
          "Укажи точный ник своего аккаунта (мы проверим и подвяжем), либо отметь, что это твинк.",
        ].join("\n")
      )
    );
    if (info.screenshotUrl) container.addMediaGalleryComponents(ui.mediaImage(info.screenshotUrl, "Последний скрин-пруф"));
    else if (info.screenshotUnavailable) container.addTextDisplayComponents(ui.td("-# Скрин заявки найден, но файл не удалось прикрепить. Напиши модератору, если нужен ручной чек."));
    const buttons = [btn(ACTIONS.REG_LINK_ROBLOX, tournament.id, ["main"], { label: "Зарегать Roblox ник", style: ButtonStyle.Success, emoji: "🔗" })];
    if (info.canTwink) buttons.push(btn(ACTIONS.REG_DECLARE_TWINK, tournament.id, [], { label: "Это твинк", style: ButtonStyle.Primary, emoji: "🥸" }));
    buttons.push(btn(ACTIONS.REG_WITHDRAW, tournament.id, [], { label: "Отмена", emoji: "✖" }));
    container.addActionRowComponents(ui.row(...buttons));
    container.addTextDisplayComponents(ui.td(`-# ${TWINK_WARNING}`));
  });
  return ui.v2Ephemeral(c);
}

function buildRobloxNickModal(tournamentId, kind = "main") {
  const isAlt = kind !== "main";
  return new ModalBuilder()
    .setCustomId(buildCustomId(ACTIONS.REG_LINK_ROBLOX, tournamentId, kind))
    .setTitle(isAlt ? "Доп. аккаунт Roblox" : "Твой Roblox ник")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("nick").setLabel("Точный Roblox ник").setStyle(TextInputStyle.Short).setRequired(true).setMinLength(3).setMaxLength(20).setPlaceholder("3–20 символов: буквы, цифры, _")
      )
    );
}

function buildDeclareStrengthPayload(tournament, { robloxUsername, kind = "alt", minKills = 0 } = {}) {
  const options = KILLS_BUCKETS.filter((bucket) => bucket.value >= minKills).map((bucket) => ({ label: bucket.label, value: String(bucket.value) }));
  const c = ui.container(COLORS.orange, (container) => {
    container.addTextDisplayComponents(ui.td(`# Заявка · ${tournament.name}`));
    container.addSeparatorComponents(ui.separator());
    container.addTextDisplayComponents(
      ui.td(
        [
          robloxUsername ? `Аккаунт **${robloxUsername}** подтверждён ✅` : "Аккаунт подтверждён ✅",
          "",
          kind === "twink"
            ? "Укажи свою **истинную силу** (реальное количество килов)."
            : "Укажи килы на этом доп. аккаунте. Они прибавятся к твоим зарегистрированным килам.",
        ].join("\n")
      )
    );
    container.addActionRowComponents(
      ui.row(new StringSelectMenuBuilder().setCustomId(buildCustomId(ACTIONS.REG_PICK_KILLS, tournament.id, kind)).setPlaceholder("Реальное количество килов").addOptions(options))
    );
    container.addActionRowComponents(ui.row(regBackButton(tournament.id)));
    container.addTextDisplayComponents(ui.td(`-# ${TWINK_WARNING}`));
  });
  return ui.v2Ephemeral(c);
}

function buildRegFinalConfirmPayload(tournament, registration = {}) {
  const profileUrl = robloxProfileUrl(registration.robloxUserId);
  const altBreakdown = registration.accountKind === "alt" && registration.declaredKills != null
    ? `Профиль + альт: **${fmtNumber(registration.approvedKills)} + ${fmtNumber(registration.declaredKills)} = ${fmtNumber(registration.effectiveKills)}**`
    : null;
  const c = ui.container(COLORS.green, (container) => {
    container.addTextDisplayComponents(ui.td(`# Подтверждение · ${tournament.name}`));
    container.addSeparatorComponents(ui.separator());
    const text = ui.td(
      [
        `Roblox: ${profileUrl ? `[${registration.robloxUsername || "—"}](${profileUrl})` : `**${registration.robloxUsername || "—"}**`}`,
        `Аккаунт: **${ACCOUNT_KIND_LABELS[registration.accountKind] || registration.accountKind}**`,
        altBreakdown,
        `Сила (килы для распределения): **${fmtNumber(registration.effectiveKills)}**`,
        "",
        "Всё верно? Жми «Подтвердить заявку».",
      ].join("\n")
    );
    if (registration.robloxAvatarUrl) {
      container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(text).setThumbnailAccessory(new ThumbnailBuilder().setURL(registration.robloxAvatarUrl)));
    } else {
      container.addTextDisplayComponents(text);
    }
    container.addActionRowComponents(
      ui.row(
        btn(ACTIONS.REG_CONFIRM, tournament.id, [], { label: "Подтвердить заявку", style: ButtonStyle.Success, emoji: "✅" }),
        regBackButton(tournament.id)
      )
    );
    container.addTextDisplayComponents(ui.td(`-# ${TWINK_WARNING}`));
  });
  return ui.v2Ephemeral(c);
}

// A minimal V2 ephemeral notice (used to replace a V2 panel with a short message).
function buildNoticePayload(text, { accent = COLORS.neutral } = {}) {
  return ui.v2Ephemeral(ui.container(accent, (c) => c.addTextDisplayComponents(ui.td(text))));
}

function buildRegisteredPayload(tournament, { seatNumber, queueInfo = null, playReset = false } = {}) {
  const waitlisted = queueInfo && queueInfo.found && !queueInfo.active;
  const c = ui.container(waitlisted ? COLORS.orange : COLORS.green, (container) => {
    container.addTextDisplayComponents(ui.td(waitlisted ? "# 🕒 Ты в резерве" : "# ✅ Ты в заявке!"));
    container.addTextDisplayComponents(
      ui.td(
        [
          `Турнир: **${tournament.name}**`,
          waitlisted
            ? `Очередь: **резерв №${queueInfo.waitlistPosition}** · общий номер заявки **№${queueInfo.position}**`
            : seatNumber
              ? `Твоё место: **№${seatNumber}**`
              : queueInfo?.position
                ? `Номер заявки: **№${queueInfo.position}**`
                : null,
          waitlisted ? `Основной состав уже набран: **${queueInfo.activeLimit}** игроков.` : null,
          waitlisted ? "Если кто-то отзовёт заявку до запуска, очередь подвинется автоматически." : null,
          playReset && !waitlisted ? "Состав основы изменился, поэтому старое распределение сброшено." : null,
          tournament.startsAtIso ? `Старт: ${formatStartTime(tournament.startsAtIso)}` : null,
        ]
          .filter(Boolean)
          .join("\n")
      )
    );
    container.addActionRowComponents(ui.row(btn(ACTIONS.REG_WITHDRAW, tournament.id, [], { label: "Отозвать заявку", style: ButtonStyle.Danger, emoji: "🚪" })));
  });
  return ui.v2Ephemeral(c);
}

// --------------------------------------------------------------------------
// Management hub
// --------------------------------------------------------------------------

function buildManagePanelPayload(tournament, { statusText = "", serverCount = 1, finalReady = false, finalServer = null, finalIndex = 90 } = {}) {
  const taken = Object.keys(tournament.registrations || {}).length;
  const activeLimit = activeRegistrationLimit(tournament);
  const activeTaken = Math.min(taken, activeLimit);
  const waitlisted = listWaitlistRegistrations(tournament).length;
  const phantoms = phantomCount(tournament);
  const open = tournament.registrationOpen !== false;
  const servers = tournament.servers || {};
  const anyThreadFailed = Object.values(servers).some((s) => s && s.launched && s.threadFailed);
  const phantom = Boolean(tournament.isPhantom);
  const accent = phantom ? COLORS.orange : COLORS.primary;
  const playLocked = hasLiveTournamentPlay(tournament);

  const c = ui.container(accent, (container) => {
    container.addTextDisplayComponents(ui.td(`# ${phantom ? "👻 " : "🛠 "}${tournament.name}${phantom ? " · ФАНТОМ" : ""}`));
    container.addTextDisplayComponents(
      ui.td(
        [
          `Статус: ${statusLabel(tournament.status)} · Набор: ${open ? "🟢 открыт" : "🔴 закрыт"}`,
          `Основной состав: **${fmtNumber(activeTaken)} / ${fmtNumber(activeLimit)}** · Всего заявок: **${fmtNumber(taken)}**${waitlisted ? ` · Резерв: **${fmtNumber(waitlisted)}**` : ""}${phantoms ? ` (фантомов: **${phantoms}**)` : ""}`,
          `Максимум сетки: **${fmtNumber(tournament.slots)}** · Серверов: **${fmtNumber(serverCount)}**`,
          `Режим: ${SEEDING_MODE_LABELS[tournament.seedingMode] || tournament.seedingMode}`,
          `Роль участника: ${tournament.participantRoleId ? `<@&${tournament.participantRoleId}>` : "—"}`,
          `Старт: ${tournament.startsAtIso ? formatStartTime(tournament.startsAtIso) : "—"}`,
          phantom ? "-# 👻 Фантомный турнир: автозаполненные игроки нигде не учитываются." : null,
        ].filter((x) => x != null).join("\n")
      )
    );

    container.addSeparatorComponents(ui.separator());
    container.addTextDisplayComponents(ui.td("**Набор**"));
    container.addActionRowComponents(
      ui.row(
        btn(ACTIONS.MANAGE_REFRESH, tournament.id, [], { label: "Обновить", emoji: "🔄" }),
        open
          ? btn(ACTIONS.MANAGE_CLOSE_REG, tournament.id, [], { label: "Закрыть заявки", style: ButtonStyle.Danger, emoji: "🔒" })
          : btn(ACTIONS.MANAGE_OPEN_REG, tournament.id, [], { label: "Открыть заявки", style: ButtonStyle.Success, emoji: "🔓" })
      )
    );

    container.addTextDisplayComponents(ui.td("**Состав**"));
    container.addActionRowComponents(
      ui.row(
        btn(ACTIONS.MANAGE_ROSTER, tournament.id, [], { label: "Кто записался", style: ButtonStyle.Primary, emoji: "📋" }),
        btn(ACTIONS.MANAGE_ADD_PLAYER, tournament.id, [], { label: "Добавить игрока", style: ButtonStyle.Success, emoji: "➕", disabled: playLocked }),
        btn(ACTIONS.MANAGE_REMOVE_PLAYER, tournament.id, [], { label: "Убрать игрока", emoji: "➖", disabled: playLocked }),
        btn(ACTIONS.MANAGE_SYNC_ROLES, tournament.id, [], { label: "Синхр. роли", emoji: "🎭", disabled: !tournament.participantRoleId })
      )
    );
    container.addActionRowComponents(
      ui.row(
        btn(ACTIONS.MANAGE_FILL_ALL, tournament.id, [], { label: "Заполнить всё (фантом)", style: ButtonStyle.Secondary, emoji: "👻", disabled: playLocked }),
        ...(phantoms ? [btn(ACTIONS.MANAGE_CLEAR_PHANTOMS, tournament.id, [], { label: `Убрать фантомов (${phantoms})`, style: ButtonStyle.Danger, emoji: "🧹", disabled: playLocked })] : [])
      )
    );

    const multi = serverCount > 1;
    container.addTextDisplayComponents(ui.td(multi ? `**Сетка и сервера** (мультисервер ×${serverCount})` : "**Сетка и сервера**"));
    const serverLines = [];
    for (let i = 0; i < Math.min(serverCount, 3); i += 1) {
      const server = servers[String(i)];
      const playerCount = Object.values(tournament.registrations || {}).filter((reg) => !multi || reg?.serverIndex === i).length;
      const threadState = server?.threadFailed ? "ветка требует повтора" : server?.threadId ? "ветка закрыта" : server?.launched ? "ветка открывается" : "готов к запуску";
      serverLines.push(`сервер ${i + 1}: **${fmtNumber(playerCount)}** игроков · ${threadState}`);
    }
    if (multi && finalServer?.launched) {
      const finalistCount = Object.values(tournament.registrations || {}).filter((reg) => reg?.serverIndex === finalIndex).length;
      serverLines.push(`финал: **${fmtNumber(finalistCount)}** игроков · ${finalServer.threadFailed ? "ветка требует повтора" : finalServer.threadId ? "ветка закрыта" : "ветка открывается"}`);
    }
    if (serverLines.length) container.addTextDisplayComponents(ui.td(`-# ${serverLines.join("\n-# ")}`));

    // launch row: rebuild duels + per-server launch buttons
    const launchRow = [
      btn(ACTIONS.MANAGE_FORM_DUELS, tournament.id, [], { label: "Пересобрать дуэты", style: ButtonStyle.Primary, emoji: "🧩", disabled: playLocked }),
      btn(ACTIONS.MANAGE_PUBLISH_PREVIEW, tournament.id, [], { label: "Предпубликация", style: ButtonStyle.Secondary, emoji: "🗺", disabled: playLocked }),
    ];
    for (let i = 0; i < Math.min(serverCount, 3); i += 1) {
      const server = servers[String(i)];
      const qual = server?.qualifying;
      launchRow.push(
        btn(ACTIONS.MANAGE_LAUNCH_SERVER, tournament.id, [String(i)], {
          label: qual ? `Сервер ${i + 1}: топ-${(server.qualified || []).length}` : server?.launched ? `Сервер ${i + 1} ✓` : `Запустить сервер ${i + 1}`,
          style: server?.launched ? ButtonStyle.Secondary : ButtonStyle.Success,
          emoji: "🖥",
          disabled: Boolean(server?.launched),
        })
      );
    }
    container.addActionRowComponents(ui.row(...launchRow.slice(0, 5)));

    // match-panel row: one "Бои" button per launched server (+ final)
    const matchRow = [];
    for (let i = 0; i < Math.min(serverCount, 3); i += 1) {
      if (servers[String(i)]?.launched) {
        matchRow.push(btn(ACTIONS.MANAGE_START, tournament.id, [String(i)], { label: multi ? `Бои · сервер ${i + 1}` : "Панель боёв", style: ButtonStyle.Primary, emoji: "⚔️" }));
      }
    }
    if (multi) {
      if (finalServer?.launched) {
        matchRow.push(btn(ACTIONS.MANAGE_START, tournament.id, [String(finalIndex)], { label: "Бои · ФИНАЛ", style: ButtonStyle.Danger, emoji: "🏆" }));
      } else if (finalReady) {
        matchRow.push(btn(ACTIONS.MANAGE_LAUNCH_FINAL, tournament.id, [], { label: "Запустить ФИНАЛ", style: ButtonStyle.Success, emoji: "🏆" }));
      }
    }
    if (!matchRow.length) {
      matchRow.push(btn(ACTIONS.MANAGE_START, tournament.id, ["0"], { label: "Панель боёв", style: ButtonStyle.Secondary, emoji: "⚔️", disabled: true }));
    }
    container.addActionRowComponents(ui.row(...matchRow.slice(0, 5)));
    if (multi && !finalReady && Object.values(servers).some((s) => s?.launched)) {
      container.addTextDisplayComponents(ui.td(`-# Финал откроется, когда все ${serverCount} сервера выведут топ-4.`));
    }

    const bottom = [];
    if (tournament.status === "completed") {
      bottom.push(btn(ACTIONS.SUMMARY_OPEN, tournament.id, [], { label: tournament.summaryPosted ? "Итоги опубликованы" : "Окно итогов", style: ButtonStyle.Primary, emoji: "🏁" }));
    }
    if (anyThreadFailed) {
      const failedIdx = Object.keys(servers).find((k) => servers[k]?.threadFailed) || "0";
      bottom.push(btn(ACTIONS.MANAGE_RETRY_THREAD, tournament.id, [failedIdx], { label: "Ветка и пинг заново", emoji: "🧵" }));
    }
    bottom.push(btn(ACTIONS.MANAGE_CANCEL, tournament.id, [], { label: "Отменить турнир", style: ButtonStyle.Danger, emoji: "🗑" }));
    container.addSeparatorComponents(ui.separator());
    container.addActionRowComponents(ui.row(...bottom.slice(0, 5)));

    if (statusText) container.addTextDisplayComponents(ui.td(`-# ${statusText}`));
  });
  return ui.v2Ephemeral(c);
}

// --------------------------------------------------------------------------
// Roster viewer ("who registered")
// --------------------------------------------------------------------------

function buildRosterViewerPayload(tournament, players = [], { page = 0, statusText = "" } = {}) {
  const pageCount = Math.max(1, Math.ceil(players.length / ROSTER_PAGE_SIZE));
  const current = Math.min(Math.max(0, page), pageCount - 1);
  const slice = players.slice(current * ROSTER_PAGE_SIZE, current * ROSTER_PAGE_SIZE + ROSTER_PAGE_SIZE);
  const playLocked = hasLiveTournamentPlay(tournament);

  const c = ui.container(COLORS.teal, (container) => {
    container.addTextDisplayComponents(ui.td(`# 📋 Состав · ${tournament.name}`));
    const activeLimit = activeRegistrationLimit(tournament);
    const waitlisted = listWaitlistRegistrations(tournament).length;
    container.addTextDisplayComponents(
      ui.td(`Основа: **${Math.min(players.length, activeLimit)} / ${fmtNumber(activeLimit)}** · Резерв: **${fmtNumber(waitlisted)}** · всего ${players.length} · страница ${current + 1}/${pageCount}`)
    );
    container.addSeparatorComponents(ui.separator());

    if (!slice.length) {
      container.addTextDisplayComponents(ui.td("_Пока никто не записался._"));
    }
    slice.forEach((p, idx) => {
      const num = current * ROSTER_PAGE_SIZE + idx + 1;
      const queue = registrationQueueInfo(tournament, p.userId || p.id);
      const tierBadge = p.effectiveTier ? ` · T${p.effectiveTier}` : "";
      const kindBadge = p.accountKind && p.accountKind !== "main" ? ` · ${ACCOUNT_KIND_LABELS[p.accountKind]}` : "";
      const manual = p.addedManually ? " · ✋" : "";
      const queueBadge = queue.active ? " · основа" : ` · резерв #${queue.waitlistPosition}`;
      const lineText = ui.td(
        `**${num}.** ${playerMd(p, { withKills: true, withSource: true })}${tierBadge}${kindBadge}${manual}${queueBadge}\n-# <@${p.userId}>`
      );
      const url = p.robloxProfileUrl || robloxProfileUrl(p.robloxUserId);
      if (url) {
        container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(lineText).setButtonAccessory(linkBtn(url, "Roblox", "🔗")));
      } else if (p.robloxAvatarUrl) {
        container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(lineText).setThumbnailAccessory(new ThumbnailBuilder().setURL(p.robloxAvatarUrl)));
      } else {
        container.addTextDisplayComponents(lineText);
      }
    });

    container.addSeparatorComponents(ui.separator());
    container.addActionRowComponents(
      ui.row(
        btn(ACTIONS.ROSTER_PAGE, tournament.id, [String(current - 1)], { label: "‹ Назад", disabled: current <= 0 }),
        btn(ACTIONS.ROSTER_PAGE, tournament.id, [String(current + 1)], { label: "Вперёд ›", disabled: current >= pageCount - 1 }),
        btn(ACTIONS.ROSTER_KILLS_REFRESH, tournament.id, [], { label: "Обновить килы", emoji: "🔁" }),
        btn(ACTIONS.MANAGE_OPEN, tournament.id, [], { label: "К управлению", emoji: "🛠" })
      )
    );
    container.addActionRowComponents(
      ui.row(btn(ACTIONS.MANAGE_FILL_ALL, tournament.id, [], { label: "👻 Заполнить всё фантомами", style: ButtonStyle.Secondary, disabled: playLocked }))
    );
    if (statusText) container.addTextDisplayComponents(ui.td(`-# ${statusText}`));
  });
  return ui.v2Ephemeral(c);
}

function buildAddPlayerPayload(tournament) {
  const c = ui.container(COLORS.green, (container) => {
    container.addTextDisplayComponents(ui.td(`# ➕ Добавить игрока · ${tournament.name}`));
    container.addTextDisplayComponents(ui.td("Выбери участника сервера — подтянем его Roblox и килы автоматически."));
    container.addActionRowComponents(
      ui.row(new UserSelectMenuBuilder().setCustomId(buildCustomId(ACTIONS.ADD_PLAYER_SELECT, tournament.id)).setPlaceholder("Кого добавить").setMinValues(1).setMaxValues(1))
    );
    container.addActionRowComponents(
      ui.row(
        btn(ACTIONS.ADD_PLAYER_MODAL, tournament.id, [], { label: "Ввести вручную (ник + килы)", emoji: "✍️" }),
        btn(ACTIONS.MANAGE_OPEN, tournament.id, [], { label: "Назад", emoji: "↩" })
      )
    );
  });
  return ui.v2Ephemeral(c);
}

function buildRemovePlayerPayload(tournament) {
  const c = ui.container(COLORS.red, (container) => {
    container.addTextDisplayComponents(ui.td(`# ➖ Убрать игрока · ${tournament.name}`));
    container.addActionRowComponents(
      ui.row(new UserSelectMenuBuilder().setCustomId(buildCustomId(ACTIONS.REMOVE_PLAYER_SELECT, tournament.id)).setPlaceholder("Кого убрать").setMinValues(1).setMaxValues(1))
    );
    container.addActionRowComponents(ui.row(btn(ACTIONS.MANAGE_OPEN, tournament.id, [], { label: "Назад", emoji: "↩" })));
  });
  return ui.v2Ephemeral(c);
}

function buildAddPlayerModal(tournamentId) {
  return new ModalBuilder()
    .setCustomId(buildCustomId(ACTIONS.ADD_PLAYER_MODAL, tournamentId))
    .setTitle("Добавить игрока вручную")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("nick").setLabel("Roblox ник").setStyle(TextInputStyle.Short).setRequired(true).setMinLength(3).setMaxLength(20)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("kills").setLabel("Килы (число)").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(7).setPlaceholder("например 4200")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("discord").setLabel("Discord ID (необязательно, для роли/пинга)").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(25)
      )
    );
}

// --------------------------------------------------------------------------
// Duel-formation roster (cell layout) + bracket posts
// --------------------------------------------------------------------------

function matchLine(idx, match, { withRun = false } = {}) {
  const runTag = withRun && match.runIndex != null ? ` · прогон ${match.runIndex + 1}` : "";
  return [
    `**Бой ${idx + 1}**${runTag} · ячейки ${match.cellRed}–${match.cellBlue}`,
    `${colorDot("red")} [яч.${match.cellRed}] ${playerMd(match.red)}`,
    `${colorDot("blue")} [яч.${match.cellBlue}] ${playerMd(match.blue)}`,
  ].join("\n");
}

function buildRosterPayload(tournament, stagePlan, { serverIndex = 0 } = {}) {
  const matches = seeding.listStageMatches(stagePlan);
  const multiRun = stagePlan.runs.length > 1;
  const c = ui.container(COLORS.primary, (container) => {
    container.addTextDisplayComponents(ui.td(`# 🧩 Распределение · сервер ${serverIndex + 1}`));
    container.addTextDisplayComponents(ui.td("Красные ячейки нечётные, синие чётные. Этап 1."));
    container.addSeparatorComponents(ui.separator());
    // group text to stay under component budget
    const chunks = [];
    matches.forEach((match, idx) => chunks.push(matchLine(idx, match, { withRun: multiRun })));
    if (stagePlan.bye) chunks.push(`🎟 ${playerMd(stagePlan.bye)} — проходит дальше (бай)`);
    // up to ~8 matches per text block
    for (let i = 0; i < chunks.length; i += 6) {
      container.addTextDisplayComponents(ui.td(chunks.slice(i, i + 6).join("\n\n")));
    }
    container.addSeparatorComponents(ui.separator());
    container.addActionRowComponents(ui.row(btn(ACTIONS.MANAGE_OPEN, tournament.id, [], { label: "К управлению", emoji: "🛠" })));
  });
  return ui.v2Ephemeral(c);
}

// Public bracket post (V2 container). When `imageFilename` is given the caller
// attaches the PNG; otherwise the pairings are listed as text.
function buildBracketPostPayload(tournament, stagePlan, { serverIndex = 0, serverLabel = "", imageFilename = "", title = "🗺 Предварительное размещение", headline = "", details = "" } = {}) {
  const matches = seeding.listStageMatches(stagePlan);
  const multiRun = stagePlan.runs.length > 1;
  const label = serverLabel || `сервер ${serverIndex + 1}`;
  const c = ui.container(COLORS.gold, (container) => {
    if (headline) container.addTextDisplayComponents(ui.td(headline));
    container.addTextDisplayComponents(ui.td(`# ${title} · ${label}`));
    container.addTextDisplayComponents(ui.td(`-# ${tournament.name} · FT6`));
    if (details) container.addTextDisplayComponents(ui.td(details));
    if (imageFilename) {
      container.addMediaGalleryComponents(ui.mediaImage(`attachment://${imageFilename}`, "Сетка турнира"));
    } else {
      container.addSeparatorComponents(ui.separator());
      const lines = matches.map((match, idx) => {
        const runTag = multiRun && match.runIndex != null ? ` (прогон ${match.runIndex + 1})` : "";
        return `**${idx + 1}.**${runTag} ${colorDot("red")} ${playerMd(match.red)}  🆚  ${colorDot("blue")} ${playerMd(match.blue)}`;
      });
      if (stagePlan.bye) lines.push(`🎟 ${playerMd(stagePlan.bye)} — бай`);
      for (let i = 0; i < lines.length; i += 6) container.addTextDisplayComponents(ui.td(lines.slice(i, i + 6).join("\n")));
    }
  });
  return ui.v2Public(c);
}

function buildPreviewPostPayload(tournament, { imageFilename = "", serverCount = 1, activeCount = 0, waitlistCount = 0 } = {}) {
  const c = ui.container(COLORS.gold, (container) => {
    container.addTextDisplayComponents(ui.td(`# 🗺 Предварительная сетка · ${tournament.name}`));
    container.addTextDisplayComponents(
      ui.td(
        [
          `Основной состав: **${fmtNumber(activeCount)} / ${fmtNumber(activeRegistrationLimit(tournament))}**`,
          `Серверов: **${fmtNumber(serverCount)}** · формат: **1 на 1, FT6**`,
          "На картинке показана стартовая расстановка; будущие раунды пустые и заполняются после реальных боёв.",
          waitlistCount ? `Резерв: **${fmtNumber(waitlistCount)}** · не попадает в эту сетку, но очередь двигается при выходе игроков.` : null,
        ].filter(Boolean).join("\n")
      )
    );
    if (imageFilename) {
      container.addSeparatorComponents(ui.separator());
      container.addMediaGalleryComponents(ui.mediaImage(`attachment://${imageFilename}`, "Предварительная сетка турнира"));
    } else {
      container.addSeparatorComponents(ui.separator());
      container.addTextDisplayComponents(ui.td("Предварительная картинка не собралась, но состав можно пересобрать в панели турнира."));
    }
  });
  return ui.v2Public(c);
}

// kept for backwards compat with operator calls (embed-style fallback no longer
// used — returns the V2 text bracket).
function buildPreliminaryBracketPayload(tournament, stagePlan, { serverIndex = 0 } = {}) {
  return buildBracketPostPayload(tournament, stagePlan, { serverIndex });
}

// Public grand-summary post (V2). Image attached by caller when available.
function buildSummaryPostPayload(tournament, { imageFilename = "" } = {}) {
  const r = tournament.results || {};
  const c = ui.container(COLORS.gold, (container) => {
    container.addTextDisplayComponents(ui.td(`# 🏆 Итоги турнира · ${tournament.name}`));
    if (imageFilename) {
      container.addMediaGalleryComponents(ui.mediaImage(`attachment://${imageFilename}`, "Итоги турнира"));
    } else {
      container.addSeparatorComponents(ui.separator());
      container.addTextDisplayComponents(
        ui.td(
          [r.first && `🥇 ${playerMd(r.first)}`, r.second && `🥈 ${playerMd(r.second)}`, r.third && `🥉 ${playerMd(r.third)}`]
            .filter(Boolean)
            .join("\n") || "Результаты записаны."
        )
      );
    }
    if (r.organizerComment) container.addTextDisplayComponents(ui.td(`-# 💬 ${String(r.organizerComment).slice(0, 500)}`));
  });
  return ui.v2Public(c);
}

function buildCompletionPanelPayload(tournament, { imageFilename = "", statusText = "" } = {}) {
  const r = tournament.results || {};
  const posted = Boolean(tournament.summaryPosted);
  const comment = String(r.organizerComment || "").trim();
  const c = ui.container(COLORS.gold, (container) => {
    container.addTextDisplayComponents(ui.td(`# 🏁 Финальное окно · ${tournament.name}`));
    container.addTextDisplayComponents(
      ui.td(
        [
          r.first ? `🥇 ${playerMd(r.first)}` : null,
          r.second ? `🥈 ${playerMd(r.second)}` : null,
          r.third ? `🥉 ${playerMd(r.third)}` : null,
        ]
          .filter(Boolean)
          .join("\n") || "Результаты записаны."
      )
    );
    if (imageFilename) {
      container.addSeparatorComponents(ui.separator());
      container.addMediaGalleryComponents(ui.mediaImage(`attachment://${imageFilename}`, "Финальная карточка турнира"));
    }
    container.addSeparatorComponents(ui.separator());
    container.addTextDisplayComponents(
      ui.td(comment ? `**Комментарий ведущего**\n${comment.slice(0, 700)}` : "_Комментарий ведущего ещё не добавлен._")
    );
    container.addActionRowComponents(
      ui.row(
        btn(ACTIONS.SUMMARY_COMMENT, tournament.id, [], { label: comment ? "Изменить комментарий" : "Добавить комментарий", style: ButtonStyle.Primary, emoji: "💬", disabled: posted }),
        btn(ACTIONS.SUMMARY_PUBLISH, tournament.id, [], { label: posted ? "Итоги опубликованы" : "Опубликовать итоги", style: ButtonStyle.Success, emoji: "📣", disabled: posted }),
        btn(ACTIONS.MANAGE_OPEN, tournament.id, [], { label: "К управлению", emoji: "🛠" })
      )
    );
    container.addTextDisplayComponents(
      ui.td(posted ? "-# Публичный пост уже отправлен в канал анонса." : "-# Проверь картинку и комментарий, затем опубликуй итоги.")
    );
    if (statusText) container.addTextDisplayComponents(ui.td(`-# ${statusText}`));
  });
  return ui.v2Ephemeral(c);
}

function buildSummaryCommentModal(tournament) {
  const comment = String(tournament?.results?.organizerComment || "");
  return new ModalBuilder()
    .setCustomId(buildCustomId(ACTIONS.SUMMARY_COMMENT, tournament?.id || ""))
    .setTitle("Комментарий к итогам")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("comment")
          .setLabel("Комментарий ведущего")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(700)
          .setPlaceholder("Коротко: как прошёл финал, кого отметить, что сказать победителям")
          .setValue(comment.slice(0, 700))
      )
    );
}

// --------------------------------------------------------------------------
// Match-result panel (the star: buttons inside the panel, per pairing)
// --------------------------------------------------------------------------

function stageTitle(stagePlan) {
  if (stagePlan.kind === "placement") return "Финал и матч за 3-е место";
  if (stagePlan.isSemifinal) return "Полуфинал";
  return `Этап ${stagePlan.stage}`;
}

function shortName(player) {
  return String(playerName(player)).slice(0, 18);
}

function idOf(player) {
  return player ? String(player.userId || player.id || "") : "";
}

function buildMatchPanelPayload(tournament, server, { statusText = "" } = {}) {
  const stagePlan = server.currentStage;
  if (!stagePlan) {
    return ui.v2Ephemeral(
      ui.container(COLORS.neutral, (c) => {
        c.addTextDisplayComponents(ui.td("Сервер ещё не запущен или этап не сформирован."));
        c.addActionRowComponents(ui.row(btn(ACTIONS.MANAGE_OPEN, tournament.id, [], { label: "К управлению", emoji: "🛠" })));
      })
    );
  }
  if (server.done) return buildServerDonePayload(tournament, server);

  const decisions = server.decisions || {};
  const runs = Array.isArray(stagePlan.runs) ? stagePlan.runs : [];
  const runIndex = Math.min(Math.max(0, Number(server.runIndex) || 0), Math.max(0, runs.length - 1));
  const currentRun = runs[runIndex] || { matches: [] };
  const matches = Array.isArray(currentRun.matches) ? currentRun.matches : [];
  const multiRun = runs.length > 1;

  // Resolve each match's outcome ONCE (winner / no-show / void) and reuse it for
  // the text line, the buttons, the progress counter and the advance gate —
  // instead of re-resolving the same outcome several times per render.
  const cells = matches.map((match) => {
    const decision = decisions[match.key] || {};
    const outcome = seeding.resolveMatchOutcome(match, decision);
    const noShow = new Set((decision.noShowIds || []).map((id) => String(id)));
    const winnerId = outcome.winner ? idOf(outcome.winner) : null;
    return { match, outcome, noShow, winnerId, hasDecision: Boolean(winnerId) || outcome.void || noShow.size > 0 };
  });
  const decidedCount = cells.filter((cell) => Boolean(cell.winnerId) || cell.outcome.void).length;
  const runComplete = cells.every((cell) => Boolean(cell.outcome.winner) || cell.outcome.void);

  const c = ui.container(COLORS.primary, (container) => {
    container.addTextDisplayComponents(
      ui.td(`# ⚔️ Сервер ${server.index + 1} · ${stageTitle(stagePlan)}${multiRun ? ` · прогон ${runIndex + 1}/${runs.length}` : ""}`)
    );
    container.addTextDisplayComponents(
      ui.td(
        `Решено: **${decidedCount} / ${matches.length}** · жми по цвету победителя\n` +
          "-# ✖ — не пришёл (тех. победа сопернику) · ↺ — сброс · выбор можно менять в один тап"
      )
    );
    container.addSeparatorComponents(ui.separator());

    cells.forEach(({ match, outcome, noShow, winnerId, hasDecision }, idx) => {
      const placementTag = match.placement === "bronze" ? " · 🥉 за 3-е место" : match.placement === "final" ? " · 🏆 ФИНАЛ" : "";
      const redId = idOf(match.red);
      const blueId = idOf(match.blue);
      const redWon = Boolean(winnerId) && winnerId === redId;
      const blueWon = Boolean(winnerId) && winnerId === blueId;
      const redNoShow = Boolean(redId) && noShow.has(redId);
      const blueNoShow = Boolean(blueId) && noShow.has(blueId);
      const sideSuffix = (won, missed) => (won ? (outcome.byNoShow ? " ✅ тех. победа" : " ✅") : missed ? " 🚫 не пришёл" : "");

      container.addTextDisplayComponents(
        ui.td(
          [
            `**Бой ${idx + 1}**${placementTag} · ячейки ${match.cellRed}–${match.cellBlue}`,
            `${colorDot("red")} ${playerMd(match.red)}${sideSuffix(redWon, redNoShow)}`,
            `${colorDot("blue")} ${playerMd(match.blue)}${sideSuffix(blueWon, blueNoShow)}`,
          ].join("\n")
        )
      );
      // custom_id encodes only the SIDE ("r"/"b") — never a player id (player ids
      // can contain ':' which is our separator). The operator resolves the actual
      // winner from the match by key + side. Buttons stay ENABLED after a pick so
      // a mis-click is corrected in a single tap (no undo dance); the chosen
      // winner is highlighted green with ✅.
      container.addActionRowComponents(
        ui.row(
          btn(ACTIONS.MATCH_WIN, tournament.id, [String(server.index), match.key, "r"], { label: `${redWon ? "✅ " : ""}🔴 ${shortName(match.red)}`, style: redWon ? ButtonStyle.Success : ButtonStyle.Danger }),
          btn(ACTIONS.MATCH_WIN, tournament.id, [String(server.index), match.key, "b"], { label: `${blueWon ? "✅ " : ""}🔵 ${shortName(match.blue)}`, style: blueWon ? ButtonStyle.Success : ButtonStyle.Primary }),
          btn(ACTIONS.MATCH_NOSHOW, tournament.id, [String(server.index), match.key, "r"], { label: redNoShow ? "🔴 🚫" : "🔴 ✖", style: ButtonStyle.Secondary }),
          btn(ACTIONS.MATCH_NOSHOW, tournament.id, [String(server.index), match.key, "b"], { label: blueNoShow ? "🔵 🚫" : "🔵 ✖", style: ButtonStyle.Secondary }),
          btn(ACTIONS.MATCH_UNDO, tournament.id, [String(server.index), match.key], { label: "↺", disabled: !hasDecision })
        )
      );
    });

    const isLastRun = runIndex >= runs.length - 1;
    let advanceLabel = "Следующий прогон ▶";
    if (isLastRun) advanceLabel = stagePlan.kind === "placement" ? "Завершить турнир 🏁" : "Дальше ▶";

    container.addSeparatorComponents(ui.separator({ big: true }));
    container.addActionRowComponents(
      ui.row(
        btn(ACTIONS.STAGE_ADVANCE, tournament.id, [String(server.index)], { label: advanceLabel, style: ButtonStyle.Success, disabled: !runComplete }),
        btn(ACTIONS.MANAGE_OPEN, tournament.id, [], { label: "Управление", emoji: "🛠" })
      )
    );
    if (statusText) container.addTextDisplayComponents(ui.td(`-# ${statusText}`));
  });
  return ui.v2Ephemeral(c);
}

function buildServerDonePayload(tournament, server) {
  const placement = server.placement || {};
  const c = ui.container(COLORS.gold, (container) => {
    container.addTextDisplayComponents(ui.td(`# 🏁 Сервер ${server.index + 1} — завершён`));
    container.addTextDisplayComponents(
      ui.td(
        [
          placement.first ? `🥇 ${playerMd(placement.first)}` : null,
          placement.second ? `🥈 ${playerMd(placement.second)}` : null,
          placement.third ? `🥉 ${playerMd(placement.third)}` : null,
        ]
          .filter(Boolean)
          .join("\n") || "Результаты записаны."
      )
    );
    container.addActionRowComponents(ui.row(btn(ACTIONS.MANAGE_OPEN, tournament.id, [], { label: "К управлению", emoji: "🛠" })));
  });
  return ui.v2Ephemeral(c);
}

function buildServerThreadName(tournament, serverIndex) {
  const suffix = Number(serverIndex) >= 90 ? "финал" : `сервер ${Number(serverIndex) + 1}`;
  return `${tournament.name} · ${suffix}`.slice(0, 100);
}

module.exports = {
  TWINK_WARNING,
  SEEDING_MODE_LABELS,
  ACCOUNT_KIND_LABELS,
  KILLS_BUCKETS,
  ROSTER_PAGE_SIZE,
  playerName,
  playerLabel,
  playerMd,
  buildHubPayload,
  buildSetupPanelPayload,
  setupReady,
  buildBasicsModal,
  buildTimeModal,
  buildRewardsModal,
  buildConditionsModal,
  buildAnnouncementPayload,
  buildRegMainConfirmPayload,
  buildRegCollectingPayload,
  buildRegNoAccountPayload,
  buildRobloxNickModal,
  buildDeclareStrengthPayload,
  buildRegFinalConfirmPayload,
  buildRegisteredPayload,
  buildNoticePayload,
  buildManagePanelPayload,
  buildRosterViewerPayload,
  buildAddPlayerPayload,
  buildRemovePlayerPayload,
  buildAddPlayerModal,
  buildRosterPayload,
  buildBracketPostPayload,
  buildPreviewPostPayload,
  buildSummaryPostPayload,
  buildCompletionPanelPayload,
  buildSummaryCommentModal,
  buildPreliminaryBracketPayload,
  buildMatchPanelPayload,
  buildServerDonePayload,
  buildServerThreadName,
};
