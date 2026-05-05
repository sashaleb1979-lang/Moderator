"use strict";

const HARD_DEFAULT_GRAPHIC_TIER_COLORS = {
  1: "#54a0ff",
  2: "#1dd1a1",
  3: "#feca57",
  4: "#ff9f43",
  5: "#ff6b6b",
};

const LEGACY_WELCOME_DESCRIPTION = "Нажми кнопку ниже, выбери 1 или 2 мейнов, укажи точное количество kills и отправь следующим сообщением скрин. После подачи заявки бот сразу выдаст тебе роль доступа, а kill-tier роль прилетит после проверки модератором.";
const LEGACY_WELCOME_STEPS = [
  "Нажми **Получить роль**.",
  "Выбери **1 или 2** мейнов.",
  "Введи **точное количество kills**.",
  "Следующим сообщением отправь **скрин** в этот канал.",
  "Бот удалит скрин после обработки, сразу даст access-role, а kill-tier прилетит после проверки модератором.",
];
const COMBINED_SUBMISSION_WELCOME_DESCRIPTION = "Нажми кнопку ниже, выбери 1 или 2 мейнов, затем укажи точное количество kills и отправь скрин одним сообщением, чтобы получить роль доступа. Kill-tier роль прилетит после проверки модератором.";
const COMBINED_SUBMISSION_WELCOME_STEPS = [
  "Нажми **Получить роль**.",
  "Выбери **1 или 2** мейнов в панели и подтверди.",
  "Одним сообщением нужно **указать kills** числом и прикрепить скрин в этот канал.",
  "Бот удалит сообщение после обработки, сразу даст access-role, а kill-tier прилетит после проверки модератором.",
];

const HARD_DEFAULT_PRESENTATION = {
  welcome: {
    title: "Jujutsu Shinigans Onboarding",
    description: COMBINED_SUBMISSION_WELCOME_DESCRIPTION,
    steps: COMBINED_SUBMISSION_WELCOME_STEPS,
    buttons: {
      begin: "Получить роль",
      quickMains: "Быстро сменить мейнов",
      myCard: "Моя карточка",
    },
  },
  tierlist: {
    textTitle: "Текстовый тир-лист",
    graphicTitle: "Графический тир-лист",
    graphicMessageText: "Подтверждённые игроки и текущая расстановка по kills",
    labels: {
      1: "Низший ранг",
      2: "Средний ранг",
      3: "Высший ранг",
      4: "Особый ранг",
      5: "Абсолютный ранг",
    },
    graphic: {
      image: {
        width: null,
        height: null,
        icon: null,
      },
      colors: { ...HARD_DEFAULT_GRAPHIC_TIER_COLORS },
      panel: {
        selectedTier: 5,
      },
    },
  },
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function cleanString(value) {
  const text = String(value || "").trim();
  return text || "";
}

function isLegacyWelcomeCopy(text) {
  const normalized = cleanString(text).toLowerCase();
  return Boolean(normalized) && normalized.includes("следующим сообщением") && normalized.includes("скрин");
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = cleanString(value);
    if (text) return text;
  }
  return "";
}

function normalizeSteps(value, fallback) {
  if (Array.isArray(value)) {
    const steps = value.map((step) => cleanString(step)).filter(Boolean);
    if (steps.length) return steps.slice(0, 5);
  }
  return [...fallback];
}

function normalizeWelcomeDescription(value, fallback) {
  const text = cleanString(value);
  if (!text) return cleanString(fallback);
  return isLegacyWelcomeCopy(text) ? cleanString(fallback) : text;
}

function normalizeWelcomeSteps(value, fallback) {
  const steps = normalizeSteps(value, fallback);
  return steps.some((step) => isLegacyWelcomeCopy(step)) ? [...fallback] : steps;
}

function normalizeTierMap(value, fallback) {
  const out = { ...fallback };
  const source = value && typeof value === "object" ? value : {};
  for (const tier of [1, 2, 3, 4, 5]) {
    const next = cleanString(source[tier] ?? source[String(tier)]);
    if (next) out[tier] = next;
  }
  return out;
}

function normalizeGraphicImage(value, fallback) {
  const source = value && typeof value === "object" ? value : {};
  const out = { ...fallback };

  for (const key of ["width", "height", "icon"]) {
    const raw = source[key];
    if (raw === null || raw === undefined || raw === "") continue;
    const next = Number(raw);
    if (Number.isFinite(next) && next > 0) out[key] = next;
  }

  return out;
}

function normalizeNonGgsPresentation(value, fallback = {}) {
  const source = value && typeof value === "object" ? value : {};
  const base = fallback && typeof fallback === "object" ? fallback : {};
  const next = { ...base };

  for (const key of ["title", "description", "buttonLabel"]) {
    const text = cleanString(source[key]);
    if (!text) continue;
    next[key] = text;
  }

  return next;
}

function createPresentationDefaults(fileConfig = {}, options = {}) {
  const graphicColors = {
    ...HARD_DEFAULT_GRAPHIC_TIER_COLORS,
    ...(options.defaultGraphicTierColors || {}),
  };
  const hardDefaults = clone(HARD_DEFAULT_PRESENTATION);
  hardDefaults.tierlist.graphic.colors = { ...graphicColors };

  const welcomeEmbed = fileConfig.welcomeEmbed || {};
  const welcomeButtons = welcomeEmbed.buttons || {};
  const ui = fileConfig.ui || {};
  const graphicTierlist = fileConfig.graphicTierlist || {};

  return {
    welcome: {
      title: firstNonEmpty(welcomeEmbed.title, ui.welcomeTitle, hardDefaults.welcome.title),
      description: normalizeWelcomeDescription(
        firstNonEmpty(welcomeEmbed.description, ui.welcomeDescription),
        hardDefaults.welcome.description
      ),
      steps: normalizeWelcomeSteps(welcomeEmbed.steps, hardDefaults.welcome.steps),
      buttons: {
        begin: firstNonEmpty(welcomeButtons.begin, ui.getRoleButtonLabel, hardDefaults.welcome.buttons.begin),
        quickMains: firstNonEmpty(welcomeButtons.quickMains, ui.quickMainsButtonLabel, hardDefaults.welcome.buttons.quickMains),
        myCard: firstNonEmpty(welcomeButtons.myCard, ui.myCardButtonLabel, hardDefaults.welcome.buttons.myCard),
      },
    },
    tierlist: {
      textTitle: firstNonEmpty(ui.tierlistTitle, hardDefaults.tierlist.textTitle),
      graphicTitle: firstNonEmpty(graphicTierlist.title, hardDefaults.tierlist.graphicTitle),
      graphicMessageText: firstNonEmpty(
        graphicTierlist.messageText,
        graphicTierlist.subtitle,
        hardDefaults.tierlist.graphicMessageText
      ),
      labels: normalizeTierMap(fileConfig.killTierLabels, hardDefaults.tierlist.labels),
      graphic: {
        image: { ...hardDefaults.tierlist.graphic.image },
        colors: normalizeTierMap(graphicTierlist.tierColors, graphicColors),
        panel: {
          selectedTier: 5,
        },
      },
    },
  };
}

function ensureWelcomePanelState(dbConfig, defaultChannelId = "") {
  const fallbackChannelId = cleanString(defaultChannelId);
  const previousChannelId = cleanString(dbConfig?.welcomePanel?.channelId);
  const previousMessageId = cleanString(dbConfig?.welcomePanel?.messageId);

  dbConfig.welcomePanel ||= { channelId: fallbackChannelId, messageId: "" };

  const nextChannelId = previousChannelId || fallbackChannelId;
  const nextMessageId = previousMessageId;
  dbConfig.welcomePanel.channelId = nextChannelId;
  dbConfig.welcomePanel.messageId = nextMessageId;

  return {
    state: dbConfig.welcomePanel,
    migrated: previousChannelId !== nextChannelId || previousMessageId !== nextMessageId,
  };
}

function ensureNonGgsPanelState(dbConfig, defaultChannelId = "", fallbackChannelId = "") {
  const fallback = cleanString(fallbackChannelId || defaultChannelId);
  const previousChannelId = cleanString(dbConfig?.nonGgsPanel?.channelId);
  const previousMessageId = cleanString(dbConfig?.nonGgsPanel?.messageId);

  dbConfig.nonGgsPanel ||= { channelId: fallback, messageId: "" };

  const nextChannelId = previousChannelId || fallback;
  const nextMessageId = previousMessageId;
  dbConfig.nonGgsPanel.channelId = nextChannelId;
  dbConfig.nonGgsPanel.messageId = nextMessageId;

  return {
    state: dbConfig.nonGgsPanel,
    migrated: previousChannelId !== nextChannelId || previousMessageId !== nextMessageId,
  };
}

function ensureTierlistBoardState(dbConfig, defaultChannelId = "") {
  const legacyBoard = dbConfig.tierlistBoard && typeof dbConfig.tierlistBoard === "object" ? dbConfig.tierlistBoard : {};
  const legacyGraphic = dbConfig.graphicTierlist && typeof dbConfig.graphicTierlist === "object" ? dbConfig.graphicTierlist : {};
  const hasNestedState = legacyBoard.text && legacyBoard.graphic;
  const legacyTextMessageId = cleanString(legacyBoard.textMessageId || legacyBoard.messageId);

  if (!hasNestedState) {
    dbConfig.tierlistBoard = {
      text: {
        channelId: cleanString(legacyBoard.channelId || defaultChannelId),
        messageIdSummary: legacyTextMessageId,
        messageIdPages: "",
      },
      graphic: {
        channelId: cleanString(legacyBoard.graphicChannelId || legacyGraphic.dashboardChannelId || legacyBoard.channelId || defaultChannelId),
        messageId: cleanString(legacyBoard.graphicMessageId || legacyGraphic.dashboardMessageId),
        lastUpdated: legacyGraphic.lastUpdated ?? null,
      },
    };
    return { state: dbConfig.tierlistBoard, migrated: true };
  }

  const state = legacyBoard;
  state.text ||= {};
  state.graphic ||= {};
  let migrated = false;

  const nextTextChannelId = cleanString(state.text.channelId || defaultChannelId);
  if (state.text.channelId !== nextTextChannelId) migrated = true;
  state.text.channelId = nextTextChannelId;

  const legacyNestedMessageId = cleanString(state.text.messageId || "");
  const nextSummaryMessageId = cleanString(state.text.messageIdSummary || "") || legacyNestedMessageId;
  const nextPagesMessageId = cleanString(state.text.messageIdPages || "");

  if (state.text.messageIdSummary !== nextSummaryMessageId) migrated = true;
  state.text.messageIdSummary = nextSummaryMessageId;
  if (state.text.messageIdPages !== nextPagesMessageId) migrated = true;
  state.text.messageIdPages = nextPagesMessageId;
  if (Object.prototype.hasOwnProperty.call(state.text, "messageId")) {
    delete state.text.messageId;
    migrated = true;
  }

  const nextGraphicChannelId = cleanString(state.graphic.channelId || defaultChannelId);
  if (state.graphic.channelId !== nextGraphicChannelId) migrated = true;
  state.graphic.channelId = nextGraphicChannelId;
  const nextGraphicMessageId = cleanString(state.graphic.messageId || "");
  if (state.graphic.messageId !== nextGraphicMessageId) migrated = true;
  state.graphic.messageId = nextGraphicMessageId;
  if (state.graphic.lastUpdated === undefined) {
    state.graphic.lastUpdated = null;
    migrated = true;
  }

  return { state, migrated };
}

function ensurePresentationConfig(dbConfig, options = {}) {
  let mutated = false;
  const defaults = options.defaults || createPresentationDefaults({}, options);

  const welcomePanelResult = ensureWelcomePanelState(dbConfig, options.defaultWelcomeChannelId || "");
  if (welcomePanelResult.migrated) mutated = true;
  const nonGgsPanelResult = ensureNonGgsPanelState(
    dbConfig,
    options.defaultWelcomeChannelId || "",
    welcomePanelResult.state.channelId || options.defaultWelcomeChannelId || ""
  );
  if (nonGgsPanelResult.migrated) mutated = true;
  const boardResult = ensureTierlistBoardState(dbConfig, options.defaultTextTierlistChannelId || "");
  if (boardResult.migrated) mutated = true;

  dbConfig.generatedRoles ||= { characters: {}, tiers: {} };
  dbConfig.presentation ||= {};
  dbConfig.presentation.welcome ||= {};
  dbConfig.presentation.welcome.buttons ||= {};
  dbConfig.presentation.tierlist ||= {};
  dbConfig.presentation.tierlist.labels ||= {};
  dbConfig.presentation.tierlist.graphic ||= {};
  dbConfig.presentation.tierlist.graphic.image ||= {};
  dbConfig.presentation.tierlist.graphic.colors ||= {};
  dbConfig.presentation.tierlist.graphic.panel ||= { selectedTier: 5 };
  dbConfig.presentation.nonGgs ||= {};

  const presentation = dbConfig.presentation;
  const legacyGraphic = dbConfig.graphicTierlist && typeof dbConfig.graphicTierlist === "object" ? dbConfig.graphicTierlist : {};
  const legacyNonGgs = dbConfig.nonJjsUi && typeof dbConfig.nonJjsUi === "object"
    ? dbConfig.nonJjsUi
    : dbConfig.nonGgsUi && typeof dbConfig.nonGgsUi === "object"
      ? dbConfig.nonGgsUi
      : {};

  if (legacyGraphic.title && presentation.tierlist.graphicTitle === undefined) {
    presentation.tierlist.graphicTitle = cleanString(legacyGraphic.title);
    mutated = true;
  }
  if (legacyGraphic.messageText && presentation.tierlist.graphicMessageText === undefined) {
    presentation.tierlist.graphicMessageText = cleanString(legacyGraphic.messageText);
    mutated = true;
  }
  if (legacyGraphic.tierLabels && !Object.keys(presentation.tierlist.labels).length) {
    presentation.tierlist.labels = normalizeTierMap(legacyGraphic.tierLabels, defaults.tierlist.labels);
    mutated = true;
  }
  if (legacyGraphic.tierColors && !Object.keys(presentation.tierlist.graphic.colors).length) {
    presentation.tierlist.graphic.colors = normalizeTierMap(legacyGraphic.tierColors, defaults.tierlist.graphic.colors);
    mutated = true;
  }
  if (legacyGraphic.image && !Object.keys(presentation.tierlist.graphic.image).length) {
    presentation.tierlist.graphic.image = normalizeGraphicImage(legacyGraphic.image, defaults.tierlist.graphic.image);
    mutated = true;
  }
  if (
    legacyGraphic.panel?.selectedTier &&
    (presentation.tierlist.graphic.panel.selectedTier === undefined || presentation.tierlist.graphic.panel.selectedTier === 5)
  ) {
    presentation.tierlist.graphic.panel = { selectedTier: Number(legacyGraphic.panel.selectedTier) || 5 };
    mutated = true;
  }
  if (isLegacyWelcomeCopy(presentation.welcome.description)) {
    presentation.welcome.description = defaults.welcome.description;
    mutated = true;
  }
  if (Array.isArray(presentation.welcome.steps) && presentation.welcome.steps.some((step) => isLegacyWelcomeCopy(step))) {
    presentation.welcome.steps = [...defaults.welcome.steps];
    mutated = true;
  }

  const nextNonGgs = normalizeNonGgsPresentation(legacyNonGgs, normalizeNonGgsPresentation(presentation.nonGgs));
  if (JSON.stringify(presentation.nonGgs) !== JSON.stringify(nextNonGgs)) {
    presentation.nonGgs = nextNonGgs;
    mutated = true;
  }
  if (dbConfig.nonJjsUi !== undefined) {
    delete dbConfig.nonJjsUi;
    mutated = true;
  }
  if (dbConfig.nonGgsUi !== undefined) {
    delete dbConfig.nonGgsUi;
    mutated = true;
  }

  return { mutated, presentation };
}

function resolvePresentation(dbConfig = {}, fileConfig = {}, options = {}) {
  const defaults = createPresentationDefaults(fileConfig, options);
  const overrides = dbConfig.presentation && typeof dbConfig.presentation === "object" ? dbConfig.presentation : {};
  const welcome = overrides.welcome && typeof overrides.welcome === "object" ? overrides.welcome : {};
  const tierlist = overrides.tierlist && typeof overrides.tierlist === "object" ? overrides.tierlist : {};
  const graphic = tierlist.graphic && typeof tierlist.graphic === "object" ? tierlist.graphic : {};
  const nonGgs = overrides.nonGgs && typeof overrides.nonGgs === "object" ? overrides.nonGgs : {};
  const legacyNonGgs = dbConfig.nonJjsUi && typeof dbConfig.nonJjsUi === "object"
    ? dbConfig.nonJjsUi
    : dbConfig.nonGgsUi && typeof dbConfig.nonGgsUi === "object"
      ? dbConfig.nonGgsUi
      : {};

  return {
    welcome: {
      title: firstNonEmpty(welcome.title, defaults.welcome.title),
      description: normalizeWelcomeDescription(welcome.description, defaults.welcome.description),
      steps: normalizeWelcomeSteps(welcome.steps, defaults.welcome.steps),
      buttons: {
        begin: firstNonEmpty(welcome.buttons?.begin, defaults.welcome.buttons.begin),
        quickMains: firstNonEmpty(welcome.buttons?.quickMains, defaults.welcome.buttons.quickMains),
        myCard: firstNonEmpty(welcome.buttons?.myCard, defaults.welcome.buttons.myCard),
      },
    },
    tierlist: {
      textTitle: firstNonEmpty(tierlist.textTitle, defaults.tierlist.textTitle),
      graphicTitle: firstNonEmpty(tierlist.graphicTitle, defaults.tierlist.graphicTitle),
      graphicMessageText: firstNonEmpty(tierlist.graphicMessageText, defaults.tierlist.graphicMessageText),
      labels: normalizeTierMap(tierlist.labels, defaults.tierlist.labels),
      graphic: {
        image: normalizeGraphicImage(graphic.image, defaults.tierlist.graphic.image),
        colors: normalizeTierMap(graphic.colors, defaults.tierlist.graphic.colors),
        panel: {
          selectedTier: Number(graphic.panel?.selectedTier) || defaults.tierlist.graphic.panel.selectedTier || 5,
        },
      },
    },
    nonGgs: {
      title: firstNonEmpty(nonGgs.title, legacyNonGgs.title),
      description: firstNonEmpty(nonGgs.description, legacyNonGgs.description),
      buttonLabel: firstNonEmpty(nonGgs.buttonLabel, legacyNonGgs.buttonLabel),
    },
  };
}

function getWelcomePanelState(dbConfig, defaultChannelId = "") {
  return ensureWelcomePanelState(dbConfig, defaultChannelId).state;
}

function getNonGgsPanelState(dbConfig, defaultChannelId = "", fallbackChannelId = "") {
  return ensureNonGgsPanelState(dbConfig, defaultChannelId, fallbackChannelId).state;
}

function getTextTierlistBoardState(dbConfig, defaultChannelId = "") {
  return ensureTierlistBoardState(dbConfig, defaultChannelId).state.text;
}

function getGraphicTierlistBoardState(dbConfig, defaultChannelId = "") {
  return ensureTierlistBoardState(dbConfig, defaultChannelId).state.graphic;
}

function getTierLabel(presentation, tier) {
  const key = String(tier);
  return cleanString(presentation?.tierlist?.labels?.[key] ?? presentation?.tierlist?.labels?.[Number(tier)]) || `Tier ${key}`;
}

module.exports = {
  HARD_DEFAULT_GRAPHIC_TIER_COLORS,
  HARD_DEFAULT_PRESENTATION,
  createPresentationDefaults,
  ensurePresentationConfig,
  getGraphicTierlistBoardState,
  getNonGgsPanelState,
  getTextTierlistBoardState,
  getTierLabel,
  getWelcomePanelState,
  resolvePresentation,
};
