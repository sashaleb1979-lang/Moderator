"use strict";

// All Discord payload builders for the tournament module: setup/hub panels,
// public announcement, management panel, registration-flow screens, and the
// match-result panel. Each function returns a plain payload object
// ({ content?, embeds?, components?, files?, allowedMentions? }); the operator
// decides where to send it.

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  MessageFlags,
  ChannelType,
} = require("discord.js");

const { ACTIONS, COLORS, buildCustomId } = require("./commands");
const { formatStartTime } = require("./time");
const { TWINK_THRESHOLD } = require("./state");
const seeding = require("./seeding");

const TWINK_WARNING =
  "⚠️ Твинки без согласования с админами и реального количества килов — быстрая дисквалификация при подозрении. " +
  "В заявке должно фигурировать примерно истинное количество килов.";

const SEEDING_MODE_LABELS = Object.freeze({
  similar: "Близкие килы (равные бои)",
  seed: "Посевная сетка (сильный vs слабый)",
});

// Representative kills buckets for self-declared strength.
const KILLS_BUCKETS = Object.freeze([
  { value: 500, label: "до 1k килов", min: 0 },
  { value: 2000, label: "1k–3k килов", min: 0 },
  { value: 5000, label: "3k–6k килов", min: 3001 },
  { value: 7500, label: "6k–9k килов", min: 3001 },
  { value: 12000, label: "9k–15k килов", min: 3001 },
  { value: 18000, label: "15k+ килов", min: 3001 },
]);

function ephemeral(payload) {
  return { ...payload, flags: MessageFlags.Ephemeral };
}

function fmtNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("ru-RU") : "0";
}

function playerName(player) {
  if (!player) return "—";
  return player.robloxUsername || player.discordName || `<@${player.userId || player.id}>`;
}

function playerLabel(player) {
  if (!player) return "—";
  return `${playerName(player)} (${fmtNumber(player.kills)})`;
}

function colorDot(color) {
  return color === seeding.COLOR_RED ? "🔴" : "🔵";
}

// ---------------------------------------------------------------------------
// Moderator hub
// ---------------------------------------------------------------------------

function buildHubPayload(tournaments = [], { statusText = "" } = {}) {
  const active = tournaments.filter((t) => t.status !== "completed" && t.status !== "cancelled");
  const embed = new EmbedBuilder()
    .setTitle("🏆 Панель турниров")
    .setColor(COLORS.primary)
    .setDescription(
      active.length
        ? active
            .map(
              (t) =>
                `• **${t.name}** — ${statusLabel(t.status)} · ${fmtNumber(
                  Object.keys(t.registrations || {}).length
                )}/${fmtNumber(t.slots)} · ${t.startsAtIso ? formatStartTime(t.startsAtIso) : "время не задано"}`
            )
            .join("\n")
        : "Активных турниров нет. Создай новый."
    );
  if (statusText) embed.addFields({ name: "Последнее действие", value: statusText });

  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(buildCustomId(ACTIONS.SETUP_OPEN, "new"))
        .setLabel("Создать турнир")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(buildCustomId(ACTIONS.HUB_REFRESH))
        .setLabel("Обновить")
        .setStyle(ButtonStyle.Secondary)
    ),
  ];
  for (const t of active.slice(0, 4)) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(buildCustomId(ACTIONS.MANAGE_OPEN, t.id))
          .setLabel(`Управление: ${t.name}`.slice(0, 80))
          .setStyle(ButtonStyle.Primary)
      )
    );
  }

  return ephemeral({ embeds: [embed], components: rows });
}

function statusLabel(status) {
  return (
    {
      draft: "черновик",
      registration: "идёт набор",
      seeded: "распределён",
      running: "идёт",
      completed: "завершён",
      cancelled: "отменён",
    }[status] || status
  );
}

// ---------------------------------------------------------------------------
// Test harness panel
// ---------------------------------------------------------------------------

function buildTestPanelPayload(testTournaments = [], { statusText = "" } = {}) {
  const embed = new EmbedBuilder()
    .setTitle("🧪 Тестовая песочница турниров")
    .setColor(COLORS.neutral)
    .setDescription(
      [
        "Быстро создавай учебный турнир с ботами, прогоняй сетку и откатывай в один клик.",
        "Тестовые турниры помечены и не мешают боевым.",
        "",
        testTournaments.length
          ? testTournaments
              .map(
                (t) =>
                  `• **${t.name}** — ${statusLabel(t.status)} · ${fmtNumber(
                    Object.keys(t.registrations || {}).length
                  )}/${fmtNumber(t.slots)}`
              )
              .join("\n")
          : "_Активных тестов нет._",
      ].join("\n")
    );
  if (statusText) embed.addFields({ name: "Последнее действие", value: statusText });

  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(buildCustomId(ACTIONS.TEST_CREATE, "", "16")).setLabel("Создать тест (16)").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(buildCustomId(ACTIONS.TEST_CREATE, "", "8")).setLabel("Создать тест (8)").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(buildCustomId(ACTIONS.TEST_CREATE, "", "15")).setLabel("Создать тест (15, байи)").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(buildCustomId(ACTIONS.TEST_REFRESH)).setLabel("Обновить").setStyle(ButtonStyle.Secondary)
    ),
  ];

  for (const t of testTournaments.slice(0, 3)) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(buildCustomId(ACTIONS.TEST_FILL, t.id, "full")).setLabel(`Заполнить ботами`).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(buildCustomId(ACTIONS.MANAGE_OPEN, t.id)).setLabel("Управление").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(buildCustomId(ACTIONS.TEST_RESET, t.id)).setLabel("Сброс").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(buildCustomId(ACTIONS.TEST_DELETE, t.id)).setLabel("Удалить").setStyle(ButtonStyle.Danger)
      )
    );
  }

  if (testTournaments.length) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(buildCustomId(ACTIONS.TEST_PURGE)).setLabel("Удалить ВСЕ тесты").setStyle(ButtonStyle.Danger)
      )
    );
  }

  return ephemeral({ embeds: [embed], components: rows });
}

// ---------------------------------------------------------------------------
// Setup panel (draft)
// ---------------------------------------------------------------------------

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
  const embed = new EmbedBuilder()
    .setTitle("⚙️ Новый турнир — настройка")
    .setColor(COLORS.primary)
    .addFields(
      { name: "Название", value: String(draft.name || "—").slice(0, 256), inline: true },
      { name: "Открытых мест", value: draft.slots ? fmtNumber(draft.slots) : "—", inline: true },
      { name: "Планируется", value: draft.plannedPlayers ? fmtNumber(draft.plannedPlayers) : "—", inline: true },
      { name: "Время (МСК)", value: draft.startsAtIso ? formatStartTime(draft.startsAtIso) : "—", inline: false },
      { name: "Режим распределения", value: SEEDING_MODE_LABELS[mode], inline: false },
      {
        name: "Пинг-роли",
        value: pingRoles.length ? pingRoles.map((id) => `<@&${id}>`).join(" ") : "—",
        inline: false,
      },
      {
        name: "Награды",
        value:
          [rewards.first && `🥇 ${rewards.first}`, rewards.second && `🥈 ${rewards.second}`, rewards.third && `🥉 ${rewards.third}`, rewards.extra]
            .filter(Boolean)
            .join("\n") || "—",
        inline: false,
      },
      { name: "Условия", value: String(draft.conditions || "—").slice(0, 1024), inline: false },
      {
        name: "Канал анонса",
        value: draft.announceChannelId ? `<#${draft.announceChannelId}>` : "—",
        inline: false,
      }
    )
    .setFooter({ text: setupReady(draft) ? "Готово к публикации." : "Заполни название, места, время и канал." });
  if (statusText) embed.addFields({ name: "—", value: statusText });

  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(buildCustomId(ACTIONS.SETUP_BASICS)).setLabel("Основное").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(buildCustomId(ACTIONS.SETUP_TIME)).setLabel("Время МСК").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(buildCustomId(ACTIONS.SETUP_REWARDS)).setLabel("Награды").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(buildCustomId(ACTIONS.SETUP_CONDITIONS)).setLabel("Условия").setStyle(ButtonStyle.Primary)
    ),
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(buildCustomId(ACTIONS.SETUP_MODE))
        .setPlaceholder("Режим распределения пар")
        .addOptions(
          { label: SEEDING_MODE_LABELS.similar, value: "similar", default: mode === "similar" },
          { label: SEEDING_MODE_LABELS.seed, value: "seed", default: mode === "seed" }
        )
    ),
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(buildCustomId(ACTIONS.SETUP_PING))
        .setPlaceholder("Роли для пинга")
        .setMinValues(0)
        .setMaxValues(10)
    ),
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(buildCustomId(ACTIONS.SETUP_CHANNEL))
        .setPlaceholder("Канал для анонса")
        .addChannelTypes(ChannelType.GuildText)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(buildCustomId(ACTIONS.SETUP_PUBLISH))
        .setLabel("Опубликовать анонс")
        .setStyle(ButtonStyle.Success)
        .setDisabled(!setupReady(draft)),
      new ButtonBuilder().setCustomId(buildCustomId(ACTIONS.SETUP_CANCEL)).setLabel("Отмена").setStyle(ButtonStyle.Danger)
    ),
  ];

  return ephemeral({ embeds: [embed], components: rows });
}

function buildBasicsModal(draft = {}) {
  return new ModalBuilder()
    .setCustomId(buildCustomId(ACTIONS.SETUP_BASICS))
    .setTitle("Основное")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("name")
          .setLabel("Название турнира")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(120)
          .setValue(String(draft.name || ""))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("slots")
          .setLabel("Сколько открытых мест (16, 32, …)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(4)
          .setValue(draft.slots ? String(draft.slots) : "16")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("planned")
          .setLabel("Сколько человек планируется (необязательно)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(4)
          .setValue(draft.plannedPlayers ? String(draft.plannedPlayers) : "")
      )
    );
}

function buildTimeModal(draft = {}) {
  return new ModalBuilder()
    .setCustomId(buildCustomId(ACTIONS.SETUP_TIME))
    .setTitle("Время по МСК")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("time")
          .setLabel("Дата и время МСК")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder("25.06 20:00  или  25.06.2026 20:00")
          .setMaxLength(40)
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
          new TextInputBuilder()
            .setCustomId(place)
            .setLabel(`${idx + 1} место`)
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(200)
            .setValue(String(rewards[place] || ""))
        )
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("extra")
          .setLabel("Доп. награды / примечание")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(400)
          .setValue(String(rewards.extra || ""))
      )
    );
}

function buildConditionsModal(draft = {}) {
  return new ModalBuilder()
    .setCustomId(buildCustomId(ACTIONS.SETUP_CONDITIONS))
    .setTitle("Условия участия")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("conditions")
          .setLabel("Условия (персонажи не забанены и т.д.)")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(1000)
          .setValue(String(draft.conditions || ""))
      )
    );
}

// ---------------------------------------------------------------------------
// Public announcement
// ---------------------------------------------------------------------------

function buildAnnouncementPayload(tournament, { ping = false } = {}) {
  const taken = Object.keys(tournament.registrations || {}).length;
  const slots = tournament.slots || 16;
  const rewards = tournament.rewards || {};
  const open = tournament.registrationOpen !== false;

  const embed = new EmbedBuilder()
    .setTitle(`🏆 ${tournament.name}`)
    .setColor(COLORS.gold)
    .setDescription(
      [
        "Формат: **1 на 1, FT6** (6 боёв на пару).",
        tournament.startsAtIso ? `🗓 Старт: ${formatStartTime(tournament.startsAtIso)}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    )
    .addFields(
      { name: "Занято мест", value: `# **${fmtNumber(taken)} / ${fmtNumber(slots)}**`, inline: true },
      { name: "Статус", value: open ? "🟢 Набор открыт" : "🔴 Набор закрыт", inline: true }
    );

  const rewardLines = [
    rewards.first && `🥇 ${rewards.first}`,
    rewards.second && `🥈 ${rewards.second}`,
    rewards.third && `🥉 ${rewards.third}`,
    rewards.extra,
  ].filter(Boolean);
  if (rewardLines.length) embed.addFields({ name: "Награды", value: rewardLines.join("\n") });
  if (tournament.conditions) embed.addFields({ name: "Условия", value: String(tournament.conditions).slice(0, 1024) });
  embed.addFields({ name: "Важно", value: TWINK_WARNING });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(buildCustomId(ACTIONS.REGISTER_OPEN, tournament.id))
      .setLabel(open ? "Записаться" : "Набор закрыт")
      .setEmoji("✍️")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!open)
  );

  const pingRoles = Array.isArray(tournament.pingRoleIds) ? tournament.pingRoleIds : [];
  const payload = {
    content: ping && pingRoles.length ? pingRoles.map((id) => `<@&${id}>`).join(" ") : "",
    embeds: [embed],
    components: [row],
    allowedMentions: ping ? { roles: pingRoles } : { parse: [] },
  };
  return payload;
}

// ---------------------------------------------------------------------------
// Registration flow (player-facing, ephemeral)
// ---------------------------------------------------------------------------

function backRow(tournamentId, extraComponents = []) {
  return new ActionRowBuilder().addComponents(
    ...extraComponents,
    new ButtonBuilder().setCustomId(buildCustomId(ACTIONS.REG_BACK, tournamentId)).setLabel("Назад").setStyle(ButtonStyle.Secondary)
  );
}

function regBaseEmbed(tournament, title) {
  return new EmbedBuilder().setTitle(title).setColor(COLORS.primary).setFooter({ text: TWINK_WARNING.slice(0, 2048) });
}

// Player has a verified main + known kills.
function buildRegMainConfirmPayload(tournament, info = {}) {
  const embed = regBaseEmbed(tournament, `Заявка — ${tournament.name}`).setDescription(
    [
      `У нас сохранён твой Roblox: **${info.robloxUsername || "—"}**`,
      `Зарегистрировано килов: **${fmtNumber(info.kills)}**`,
      "",
      "На этом аккаунте будешь играть?",
    ].join("\n")
  );
  if (info.avatarUrl) embed.setThumbnail(info.avatarUrl);
  if (info.screenshotUrl) embed.setImage(info.screenshotUrl);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(buildCustomId(ACTIONS.REG_USE_MAIN, tournament.id)).setLabel("Да, на этом").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(buildCustomId(ACTIONS.REG_USE_OTHER, tournament.id)).setLabel("Буду с другого").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(buildCustomId(ACTIONS.REG_WITHDRAW, tournament.id)).setLabel("Отмена").setStyle(ButtonStyle.Secondary)
  );
  return ephemeral({ embeds: [embed], components: [row] });
}

// No Roblox account on file.
function buildRegNoAccountPayload(tournament, info = {}) {
  const embed = regBaseEmbed(tournament, `Заявка — ${tournament.name}`).setDescription(
    [
      "У нас нет привязанного Roblox-аккаунта.",
      `Зарегистрировано килов: **${fmtNumber(info.kills)}**`,
      "",
      "Укажи точный ник своего аккаунта (мы проверим и подвяжем), либо отметь, что это твинк.",
    ].join("\n")
  );
  if (info.screenshotUrl) embed.setImage(info.screenshotUrl);

  const buttons = [
    new ButtonBuilder().setCustomId(buildCustomId(ACTIONS.REG_LINK_ROBLOX, tournament.id, "main")).setLabel("Зарегать Roblox ник").setStyle(ButtonStyle.Success),
  ];
  if (info.canTwink) {
    buttons.push(
      new ButtonBuilder().setCustomId(buildCustomId(ACTIONS.REG_DECLARE_TWINK, tournament.id)).setLabel("Это твинк").setStyle(ButtonStyle.Primary)
    );
  }
  buttons.push(
    new ButtonBuilder().setCustomId(buildCustomId(ACTIONS.REG_WITHDRAW, tournament.id)).setLabel("Отмена").setStyle(ButtonStyle.Secondary)
  );
  return ephemeral({ embeds: [embed], components: [new ActionRowBuilder().addComponents(...buttons)] });
}

function buildRobloxNickModal(tournamentId, kind = "main") {
  const isAlt = kind !== "main";
  return new ModalBuilder()
    .setCustomId(buildCustomId(ACTIONS.REG_LINK_ROBLOX, tournamentId, kind))
    .setTitle(isAlt ? "Доп. аккаунт Roblox" : "Твой Roblox ник")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("nick")
          .setLabel("Точный Roblox ник")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(3)
          .setMaxLength(20)
          .setPlaceholder("3–20 символов: буквы, цифры, _")
      )
    );
}

// Pick declared real strength (kills bucket). minKills filters buckets (twinks
// declaring true power must pick a bucket above the twink band).
function buildDeclareStrengthPayload(tournament, { robloxUsername, kind = "alt", minKills = 0 } = {}) {
  const embed = regBaseEmbed(tournament, `Заявка — ${tournament.name}`).setDescription(
    [
      robloxUsername ? `Аккаунт **${robloxUsername}** подтверждён ✅` : "Аккаунт подтверждён ✅",
      "",
      kind === "twink"
        ? "Укажи свою **истинную силу** (реальное количество килов)."
        : "Укажи примерно своё реальное количество килов на этом аккаунте.",
    ].join("\n")
  );

  const options = KILLS_BUCKETS.filter((bucket) => bucket.value >= minKills).map((bucket) => ({
    label: bucket.label,
    value: String(bucket.value),
  }));

  const select = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId(ACTIONS.REG_PICK_KILLS, tournament.id, kind))
    .setPlaceholder("Реальное количество килов")
    .addOptions(options);

  return ephemeral({
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(select), backRow(tournament.id)],
  });
}

function buildRegFinalConfirmPayload(tournament, registration = {}) {
  const embed = regBaseEmbed(tournament, `Подтверждение заявки — ${tournament.name}`).setDescription(
    [
      `Roblox: **${registration.robloxUsername || "—"}**`,
      `Аккаунт: **${{ main: "основной", alt: "доп. аккаунт", twink: "твинк" }[registration.accountKind] || registration.accountKind}**`,
      `Сила (килы для распределения): **${fmtNumber(registration.effectiveKills)}**`,
      "",
      "Всё верно? Жми «Подтвердить заявку».",
    ].join("\n")
  );
  if (registration.robloxAvatarUrl) embed.setThumbnail(registration.robloxAvatarUrl);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(buildCustomId(ACTIONS.REG_CONFIRM, tournament.id)).setLabel("Подтвердить заявку").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(buildCustomId(ACTIONS.REG_BACK, tournament.id)).setLabel("Назад").setStyle(ButtonStyle.Secondary)
  );
  return ephemeral({ embeds: [embed], components: [row] });
}

function buildRegisteredPayload(tournament, { seatNumber } = {}) {
  const embed = new EmbedBuilder()
    .setTitle("✅ Ты в заявке!")
    .setColor(COLORS.green)
    .setDescription(
      [
        `Турнир: **${tournament.name}**`,
        seatNumber ? `Твоё место: **№${seatNumber}**` : null,
        tournament.startsAtIso ? `Старт: ${formatStartTime(tournament.startsAtIso)}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(buildCustomId(ACTIONS.REG_WITHDRAW, tournament.id)).setLabel("Отозвать заявку").setStyle(ButtonStyle.Danger)
  );
  return ephemeral({ embeds: [embed], components: [row] });
}

function buildSimpleEphemeral(text) {
  return ephemeral({ content: text, components: [], embeds: [] });
}

// ---------------------------------------------------------------------------
// Management panel
// ---------------------------------------------------------------------------

function buildManagePanelPayload(tournament, { statusText = "", serverCount = 1 } = {}) {
  const taken = Object.keys(tournament.registrations || {}).length;
  const open = tournament.registrationOpen !== false;
  const embed = new EmbedBuilder()
    .setTitle(`${tournament.isTest ? "🧪 " : "🛠 "}Управление — ${tournament.name}${tournament.isTest ? " (ТЕСТ)" : ""}`)
    .setColor(tournament.isTest ? COLORS.neutral : COLORS.primary)
    .addFields(
      { name: "Статус", value: statusLabel(tournament.status), inline: true },
      { name: "Заявок", value: `${fmtNumber(taken)} / ${fmtNumber(tournament.slots)}`, inline: true },
      { name: "Набор", value: open ? "🟢 открыт" : "🔴 закрыт", inline: true },
      { name: "Серверов", value: fmtNumber(serverCount), inline: true },
      { name: "Режим", value: SEEDING_MODE_LABELS[tournament.seedingMode] || tournament.seedingMode, inline: true },
      { name: "Старт", value: tournament.startsAtIso ? formatStartTime(tournament.startsAtIso) : "—", inline: false }
    );
  if (statusText) embed.addFields({ name: "Последнее действие", value: statusText });

  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(buildCustomId(ACTIONS.MANAGE_REFRESH, tournament.id)).setLabel("Обновить").setStyle(ButtonStyle.Secondary),
      open
        ? new ButtonBuilder().setCustomId(buildCustomId(ACTIONS.MANAGE_CLOSE_REG, tournament.id)).setLabel("Закрыть заявки").setStyle(ButtonStyle.Danger)
        : new ButtonBuilder().setCustomId(buildCustomId(ACTIONS.MANAGE_OPEN_REG, tournament.id)).setLabel("Открыть заявки").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(buildCustomId(ACTIONS.MANAGE_FORM_DUELS, tournament.id)).setLabel("Сформировать дуэты").setStyle(ButtonStyle.Primary)
    ),
  ];

  // launch buttons (v1: typically a single server)
  const launchButtons = [];
  for (let i = 0; i < Math.min(serverCount, 4); i += 1) {
    const server = tournament.servers?.[String(i)];
    launchButtons.push(
      new ButtonBuilder()
        .setCustomId(buildCustomId(ACTIONS.MANAGE_LAUNCH_SERVER, tournament.id, String(i)))
        .setLabel(`Запустить сервер ${i + 1}`)
        .setStyle(server?.launched ? ButtonStyle.Secondary : ButtonStyle.Success)
        .setDisabled(Boolean(server?.launched))
    );
  }
  if (launchButtons.length) rows.push(new ActionRowBuilder().addComponents(...launchButtons));

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(buildCustomId(ACTIONS.MANAGE_START, tournament.id, "0")).setLabel("Открыть панель боёв").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(buildCustomId(ACTIONS.MANAGE_CANCEL, tournament.id)).setLabel("Отменить турнир").setStyle(ButtonStyle.Danger)
    )
  );

  return ephemeral({ embeds: [embed], components: rows });
}

// Roster / duel-formation table: number, nick, color, target stage-1 cell.
function buildRosterPayload(tournament, stagePlan, { serverIndex = 0 } = {}) {
  const lines = [];
  const matches = seeding.listStageMatches(stagePlan);
  matches.forEach((match, idx) => {
    const runTag = stagePlan.runs.length > 1 ? ` · прогон ${match.runIndex + 1}` : "";
    lines.push(`**Бой ${idx + 1}**${runTag}`);
    lines.push(`  ${colorDot("red")} ячейка ${match.cellRed} — ${playerLabel(match.red)}`);
    lines.push(`  ${colorDot("blue")} ячейка ${match.cellBlue} — ${playerLabel(match.blue)}`);
  });
  if (stagePlan.bye) lines.push(`🎟 ${playerLabel(stagePlan.bye)} — проходит дальше (бай)`);

  const embed = new EmbedBuilder()
    .setTitle(`📋 Распределение — сервер ${serverIndex + 1}`)
    .setColor(COLORS.primary)
    .setDescription(lines.join("\n").slice(0, 4000) || "Нет игроков.")
    .setFooter({ text: "Красные ячейки нечётные, синие чётные. Этап 1." });
  return ephemeral({ embeds: [embed] });
}

// ---------------------------------------------------------------------------
// Preliminary placement bracket (posted publicly; v1 = embed, v2 = PNG)
// ---------------------------------------------------------------------------

function buildPreliminaryBracketPayload(tournament, stagePlan, { serverIndex = 0 } = {}) {
  const matches = seeding.listStageMatches(stagePlan);
  const lines = matches.map((match, idx) => {
    const runTag = stagePlan.runs.length > 1 ? ` (прогон ${match.runIndex + 1})` : "";
    return `**${idx + 1}.**${runTag} ${colorDot("red")} ${playerLabel(match.red)}  🆚  ${colorDot("blue")} ${playerLabel(match.blue)}`;
  });
  if (stagePlan.bye) lines.push(`🎟 ${playerLabel(stagePlan.bye)} — бай`);

  const embed = new EmbedBuilder()
    .setTitle(`🗺 Предварительное размещение — сервер ${serverIndex + 1}`)
    .setColor(COLORS.gold)
    .setDescription(lines.join("\n").slice(0, 4000) || "—")
    .setFooter({ text: `${tournament.name} · FT6` });
  return { embeds: [embed] };
}

// ---------------------------------------------------------------------------
// Match-result panel
// ---------------------------------------------------------------------------

function stageTitle(stagePlan) {
  if (stagePlan.kind === "placement") return "Финал и матч за 3-е место";
  if (stagePlan.isSemifinal) return "Полуфинал";
  return `Этап ${stagePlan.stage}`;
}

function buildMatchPanelPayload(tournament, server, { statusText = "" } = {}) {
  const stagePlan = server.currentStage;
  if (!stagePlan) {
    return ephemeral({ content: "Сервер ещё не запущен или этап не сформирован.", components: [] });
  }

  if (server.done) return buildServerDonePayload(tournament, server);

  const decisions = server.decisions || {};
  const runs = Array.isArray(stagePlan.runs) ? stagePlan.runs : [];
  const runIndex = Math.min(Math.max(0, Number(server.runIndex) || 0), Math.max(0, runs.length - 1));
  const currentRun = runs[runIndex] || { matches: [] };
  const matches = Array.isArray(currentRun.matches) ? currentRun.matches : [];
  const multiRun = runs.length > 1;

  const embed = new EmbedBuilder()
    .setTitle(
      `⚔️ Сервер ${server.index + 1} — ${stageTitle(stagePlan)}${multiRun ? ` · прогон ${runIndex + 1}/${runs.length}` : ""}`
    )
    .setColor(COLORS.primary);

  const rows = [];
  matches.forEach((match, idx) => {
    const decision = decisions[match.key] || {};
    const winnerId = resolveDecidedWinnerId(match, decision);
    const placementTag = match.placement === "bronze" ? " · за 3-е место" : match.placement === "final" ? " · ФИНАЛ" : "";
    embed.addFields({
      name: `Бой ${idx + 1}${placementTag}`,
      value: [
        `${colorDot("red")} [яч.${match.cellRed}] ${playerLabel(match.red)}${winnerId && winnerId === idOf(match.red) ? " — ✅ победил" : ""}`,
        `${colorDot("blue")} [яч.${match.cellBlue}] ${playerLabel(match.blue)}${winnerId && winnerId === idOf(match.blue) ? " — ✅ победил" : ""}`,
      ].join("\n"),
    });

    const decided = Boolean(winnerId) || decision.void;
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(buildCustomId(ACTIONS.MATCH_WIN, tournament.id, String(server.index), match.key, idOf(match.red)))
          .setLabel(`🔴 ${shortName(match.red)}`)
          .setStyle(ButtonStyle.Danger)
          .setDisabled(decided),
        new ButtonBuilder()
          .setCustomId(buildCustomId(ACTIONS.MATCH_WIN, tournament.id, String(server.index), match.key, idOf(match.blue)))
          .setLabel(`🔵 ${shortName(match.blue)}`)
          .setStyle(ButtonStyle.Primary)
          .setDisabled(decided),
        new ButtonBuilder()
          .setCustomId(buildCustomId(ACTIONS.MATCH_NOSHOW, tournament.id, String(server.index), match.key, idOf(match.red)))
          .setLabel("🔴 не пришёл")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(decided),
        new ButtonBuilder()
          .setCustomId(buildCustomId(ACTIONS.MATCH_NOSHOW, tournament.id, String(server.index), match.key, idOf(match.blue)))
          .setLabel("🔵 не пришёл")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(decided),
        decided
          ? new ButtonBuilder()
              .setCustomId(buildCustomId(ACTIONS.MATCH_UNDO, tournament.id, String(server.index), match.key))
              .setLabel("↺")
              .setStyle(ButtonStyle.Secondary)
          : new ButtonBuilder()
              .setCustomId(buildCustomId(ACTIONS.MATCH_UNDO, tournament.id, String(server.index), match.key, "noop"))
              .setLabel("·")
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(true)
      )
    );
  });

  const runComplete = matches.every((match) => {
    const outcome = seeding.resolveMatchOutcome(match, decisions[match.key] || {});
    return Boolean(outcome.winner) || outcome.void;
  });
  const isLastRun = runIndex >= runs.length - 1;
  let advanceLabel = "Следующий прогон ▶";
  if (isLastRun) advanceLabel = stagePlan.kind === "placement" ? "Завершить турнир ▶" : "Дальше ▶";
  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(buildCustomId(ACTIONS.STAGE_ADVANCE, tournament.id, String(server.index)))
        .setLabel(advanceLabel)
        .setStyle(ButtonStyle.Success)
        .setDisabled(!runComplete)
    )
  );

  if (statusText) embed.setFooter({ text: statusText.slice(0, 2048) });
  // Discord caps at 5 action rows; with ≤4 matches + advance row we are within limits.
  return ephemeral({ embeds: [embed], components: rows.slice(0, 5) });
}

function buildServerDonePayload(tournament, server) {
  const placement = server.placement || {};
  const embed = new EmbedBuilder()
    .setTitle(`🏁 Сервер ${server.index + 1} — завершён`)
    .setColor(COLORS.gold)
    .setDescription(
      [
        placement.first ? `🥇 ${playerLabel(placement.first)}` : null,
        placement.second ? `🥈 ${playerLabel(placement.second)}` : null,
        placement.third ? `🥉 ${playerLabel(placement.third)}` : null,
      ]
        .filter(Boolean)
        .join("\n") || "Результаты записаны."
    );
  return ephemeral({ embeds: [embed], components: [] });
}

function idOf(player) {
  return player ? String(player.userId || player.id || "") : "";
}

function shortName(player) {
  return String(playerName(player)).slice(0, 24);
}

function resolveDecidedWinnerId(match, decision) {
  const outcome = seeding.resolveMatchOutcome(match, decision);
  return outcome.winner ? idOf(outcome.winner) : null;
}

function buildServerThreadName(tournament, serverIndex) {
  return `${tournament.name} · сервер ${serverIndex + 1}`.slice(0, 100);
}

module.exports = {
  TWINK_WARNING,
  SEEDING_MODE_LABELS,
  KILLS_BUCKETS,
  ephemeral,
  playerName,
  playerLabel,
  buildHubPayload,
  buildTestPanelPayload,
  buildSetupPanelPayload,
  setupReady,
  buildBasicsModal,
  buildTimeModal,
  buildRewardsModal,
  buildConditionsModal,
  buildAnnouncementPayload,
  buildRegMainConfirmPayload,
  buildRegNoAccountPayload,
  buildRobloxNickModal,
  buildDeclareStrengthPayload,
  buildRegFinalConfirmPayload,
  buildRegisteredPayload,
  buildSimpleEphemeral,
  buildManagePanelPayload,
  buildRosterPayload,
  buildPreliminaryBracketPayload,
  buildMatchPanelPayload,
  buildServerDonePayload,
  buildServerThreadName,
};
