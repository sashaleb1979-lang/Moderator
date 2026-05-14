"use strict";

const HARD_DEFAULT_GRAPHIC_TIER_COLORS = {
  1: "#54a0ff",
  2: "#1dd1a1",
  3: "#feca57",
  4: "#ff9f43",
  5: "#ff6b6b",
};

const HARD_DEFAULT_PRESENTATION = {
  welcome: {
    title: "Jujutsu Shinigans Onboarding",
    description: "Нажми кнопку ниже, выбери 1 или 2 мейнов и отправь одним сообщением точное количество kills в тексте вместе со скрином. После подачи заявки бот сразу выдаст тебе роль доступа, а kill-tier роль прилетит после проверки модератором.",
    steps: [
      "Нажми **Получить роль**.",
      "Выбери **1 или 2** мейнов.",
      "Отправь **одно сообщение** в этот канал: в тексте укажи точное количество kills, а во вложении приложи скрин.",
      "Пиши в тексте только kills, например: **3120** или **3120 kills**.",
      "Бот удалит сообщение после обработки, сразу даст access-role, а kill-tier прилетит после проверки модератором.",
    ],
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
      outline: {
        roleId: "",
        color: "#ffffff",
      },
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

function normalizeGraphicOutline(value, fallback = {}) {
  const source = value && typeof value === "object" ? value : {};
  const rawColor = cleanString(source.color);
  const fallbackColor = cleanString(fallback.color) || "#ffffff";
  return {
    roleId: cleanString(source.roleId),
    color: /^#[0-9a-f]{6}$/i.test(rawColor) ? rawColor : fallbackColor,
  };
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
      description: firstNonEmpty(welcomeEmbed.description, ui.welcomeDescription, hardDefaults.welcome.description),
      steps: normalizeSteps(welcomeEmbed.steps, hardDefaults.welcome.steps),
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
        outline: normalizeGraphicOutline(graphicTierlist.outline, hardDefaults.tierlist.graphic.outline),
        panel: {
          selectedTier: 5,
        },
      },
    },
  };
}

function ensureWelcomePanelState(dbConfig, defaultChannelId = "") {
  dbConfig.welcomePanel ||= { channelId: cleanString(defaultChannelId), messageId: "" };
  dbConfig.welcomePanel.channelId ||= cleanString(defaultChannelId);
  dbConfig.welcomePanel.messageId ||= "";
  return dbConfig.welcomePanel;
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
        messageId: legacyTextMessageId,
        messageIdSummary: "",
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

  state.text.channelId ||= cleanString(defaultChannelId);
  state.text.messageId = cleanString(state.text.messageId || "");
  state.text.messageIdSummary = cleanString(state.text.messageIdSummary || "");
  state.text.messageIdPages = cleanString(state.text.messageIdPages || "");
  state.graphic.channelId ||= cleanString(defaultChannelId);
  state.graphic.messageId ||= "";
  if (state.graphic.lastUpdated === undefined) state.graphic.lastUpdated = null;

  return { state, migrated: false };
}

function ensurePresentationConfig(dbConfig, options = {}) {
  let mutated = false;
  const defaults = options.defaults || createPresentationDefaults({}, options);

  ensureWelcomePanelState(dbConfig, options.defaultWelcomeChannelId || "");
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
  dbConfig.presentation.tierlist.graphic.outline ||= {};
  dbConfig.presentation.tierlist.graphic.panel ||= { selectedTier: 5 };

  const presentation = dbConfig.presentation;
  const legacyGraphic = dbConfig.graphicTierlist && typeof dbConfig.graphicTierlist === "object" ? dbConfig.graphicTierlist : {};

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

  return { mutated, presentation };
}

function resolvePresentation(dbConfig = {}, fileConfig = {}, options = {}) {
  const defaults = createPresentationDefaults(fileConfig, options);
  const overrides = dbConfig.presentation && typeof dbConfig.presentation === "object" ? dbConfig.presentation : {};
  const welcome = overrides.welcome && typeof overrides.welcome === "object" ? overrides.welcome : {};
  const tierlist = overrides.tierlist && typeof overrides.tierlist === "object" ? overrides.tierlist : {};
  const graphic = tierlist.graphic && typeof tierlist.graphic === "object" ? tierlist.graphic : {};

  return {
    welcome: {
      title: firstNonEmpty(welcome.title, defaults.welcome.title),
      description: firstNonEmpty(welcome.description, defaults.welcome.description),
      steps: normalizeSteps(welcome.steps, defaults.welcome.steps),
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
        outline: normalizeGraphicOutline(graphic.outline, defaults.tierlist.graphic.outline),
        panel: {
          selectedTier: Number(graphic.panel?.selectedTier) || defaults.tierlist.graphic.panel.selectedTier || 5,
        },
      },
    },
  };
}

function getWelcomePanelState(dbConfig, defaultChannelId = "") {
  ensureWelcomePanelState(dbConfig, defaultChannelId);
  return dbConfig.welcomePanel;
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
  getTextTierlistBoardState,
  getTierLabel,
  getWelcomePanelState,
  resolvePresentation,
};
