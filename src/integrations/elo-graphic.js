"use strict";

const { tierForLegacyElo } = require("./elo-review-store");

const GRAPHIC_IMAGE_LIMITS = {
  width: { min: 1200, max: 4096, defaultValue: 2000 },
  height: { min: 700, max: 2160, defaultValue: 1200 },
  icon: { min: 64, max: 256, defaultValue: 112 },
};

const DEFAULT_LEGACY_ELO_TIER_LABELS = {
  1: "1",
  2: "2",
  3: "3",
  4: "4",
  5: "5",
};

const DEFAULT_LEGACY_ELO_TIER_COLORS = {
  1: "#54a0ff",
  2: "#1dd1a1",
  3: "#feca57",
  4: "#ff9f43",
  5: "#ff6b6b",
};

const LEGACY_ELO_GRAPHIC_TIER_ORDER = [5, 4, 3, 2, 1];

const DEFAULT_LEGACY_ELO_GRAPHIC_TITLE = "ELO Tier List";
const DEFAULT_LEGACY_ELO_GRAPHIC_MESSAGE_TEXT = "Главное отображение ELO тир-листа. Текстовый tierlist-канал больше не используется.";

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function normalizeNullableInteger(value, options = {}) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) return null;
  if (Number.isFinite(options.min) && amount < options.min) return null;
  if (Number.isFinite(options.max) && amount > options.max) return null;
  return amount;
}

function normalizeIsoLike(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return new Date(value).toISOString();
  }

  const text = cleanString(value, 80);
  if (!text) return null;

  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function previewText(value, maxLen = 170) {
  const text = cleanString(value, Math.max(maxLen * 4, 4000)).replace(/\s+/g, " ");
  if (!text) return "—";
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(1, maxLen - 1)).trimEnd()}…`;
}

function normalizeHexColor(input) {
  const raw = cleanString(input, 20);
  if (!raw) return null;
  const match = raw.match(/^#?([0-9a-fA-F]{6})$/);
  if (!match) return null;
  return `#${match[1].toLowerCase()}`;
}

function normalizeTierKey(value) {
  const tier = normalizeNullableInteger(value, { min: 1, max: 5 });
  return tier ? String(tier) : "";
}

function normalizeTierLabels(source = {}) {
  const normalized = {};
  for (let tier = 1; tier <= 5; tier += 1) {
    normalized[tier] = cleanString(source?.[tier], 60) || DEFAULT_LEGACY_ELO_TIER_LABELS[tier];
  }
  return normalized;
}

function normalizeTierColors(source = {}) {
  const normalized = {};
  for (let tier = 1; tier <= 5; tier += 1) {
    normalized[tier] = normalizeHexColor(source?.[tier]) || DEFAULT_LEGACY_ELO_TIER_COLORS[tier];
  }
  return normalized;
}

function ensureLegacyEloGraphicState(rawDb = {}, options = {}) {
  const db = rawDb && typeof rawDb === "object" ? rawDb : {};
  db.config ||= {};
  db.ratings ||= {};
  db.submissions ||= {};
  db.cooldowns ||= {};
  db.miniCards ||= {};

  db.config.tierLabels = normalizeTierLabels(db.config.tierLabels);
  db.config.graphicTierlist ||= {};
  db.config.graphicTierlist.image ||= {};
  db.config.graphicTierlist.panel ||= {};

  const state = db.config.graphicTierlist;
  const defaultChannelId = cleanString(options.defaultChannelId, 40);

  state.title = cleanString(state.title, 80) || DEFAULT_LEGACY_ELO_GRAPHIC_TITLE;
  state.messageText = cleanString(state.messageText, 4000) || DEFAULT_LEGACY_ELO_GRAPHIC_MESSAGE_TEXT;
  state.dashboardChannelId = cleanString(state.dashboardChannelId, 40) || defaultChannelId || "";
  state.dashboardMessageId = cleanString(state.dashboardMessageId, 40);
  state.lastUpdated = normalizeIsoLike(state.lastUpdated);
  state.image = {
    width: normalizeNullableInteger(state.image?.width, GRAPHIC_IMAGE_LIMITS.width),
    height: normalizeNullableInteger(state.image?.height, GRAPHIC_IMAGE_LIMITS.height),
    icon: normalizeNullableInteger(state.image?.icon, GRAPHIC_IMAGE_LIMITS.icon),
  };
  state.tierColors = normalizeTierColors(state.tierColors);
  state.panel = {
    selectedTier: normalizeNullableInteger(state.panel?.selectedTier, { min: 1, max: 5 }) || 5,
  };

  return state;
}

function getLegacyEloGraphicTierLabels(rawDb = {}) {
  ensureLegacyEloGraphicState(rawDb);
  return { ...rawDb.config.tierLabels };
}

function formatLegacyEloTierTitle(rawDb = {}, tier) {
  const labels = getLegacyEloGraphicTierLabels(rawDb);
  const tierKey = normalizeTierKey(tier);
  return labels[tierKey || tier] || String(tier || "—");
}

function getLegacyEloGraphicTierColors(rawDb = {}) {
  return { ...ensureLegacyEloGraphicState(rawDb).tierColors };
}

function getLegacyEloGraphicImageConfig(rawDb = {}, options = {}) {
  const state = ensureLegacyEloGraphicState(rawDb, options);
  return {
    W: Math.max(GRAPHIC_IMAGE_LIMITS.width.min, Number(state.image?.width) || GRAPHIC_IMAGE_LIMITS.width.defaultValue),
    H: Math.max(GRAPHIC_IMAGE_LIMITS.height.min, Number(state.image?.height) || GRAPHIC_IMAGE_LIMITS.height.defaultValue),
    ICON: Math.max(GRAPHIC_IMAGE_LIMITS.icon.min, Number(state.image?.icon) || GRAPHIC_IMAGE_LIMITS.icon.defaultValue),
  };
}

function getLegacyEloGraphicTitle(rawDb = {}, options = {}) {
  return ensureLegacyEloGraphicState(rawDb, options).title;
}

function setLegacyEloGraphicTitle(rawDb = {}, title, options = {}) {
  const nextTitle = cleanString(title, 80);
  if (!nextTitle) return false;
  ensureLegacyEloGraphicState(rawDb, options).title = nextTitle;
  return true;
}

function getLegacyEloGraphicMessageText(rawDb = {}, options = {}) {
  return ensureLegacyEloGraphicState(rawDb, options).messageText;
}

function previewLegacyEloGraphicMessageText(rawDb = {}, maxLen = 170, options = {}) {
  return previewText(getLegacyEloGraphicMessageText(rawDb, options), maxLen);
}

function setLegacyEloGraphicMessageText(rawDb = {}, text, options = {}) {
  const nextText = cleanString(text, 4000);
  if (!nextText) return false;
  ensureLegacyEloGraphicState(rawDb, options).messageText = nextText;
  return true;
}

function setLegacyEloGraphicSelectedTier(rawDb = {}, tier, options = {}) {
  const nextTier = normalizeNullableInteger(tier, { min: 1, max: 5 });
  if (!nextTier) return false;
  ensureLegacyEloGraphicState(rawDb, options).panel.selectedTier = nextTier;
  return true;
}

function applyLegacyEloGraphicImageDelta(rawDb = {}, kind, delta, options = {}) {
  const state = ensureLegacyEloGraphicState(rawDb, options);
  const cfg = getLegacyEloGraphicImageConfig(rawDb, options);

  if (kind === "icon") {
    state.image.icon = Math.max(GRAPHIC_IMAGE_LIMITS.icon.min, Math.min(GRAPHIC_IMAGE_LIMITS.icon.max, cfg.ICON + Number(delta || 0)));
    return true;
  }
  if (kind === "width") {
    state.image.width = Math.max(GRAPHIC_IMAGE_LIMITS.width.min, Math.min(GRAPHIC_IMAGE_LIMITS.width.max, cfg.W + Number(delta || 0)));
    return true;
  }
  if (kind === "height") {
    state.image.height = Math.max(GRAPHIC_IMAGE_LIMITS.height.min, Math.min(GRAPHIC_IMAGE_LIMITS.height.max, cfg.H + Number(delta || 0)));
    return true;
  }
  return false;
}

function resetLegacyEloGraphicImageOverrides(rawDb = {}, options = {}) {
  const state = ensureLegacyEloGraphicState(rawDb, options);
  state.image.width = null;
  state.image.height = null;
  state.image.icon = null;
}

function setLegacyEloGraphicTierColor(rawDb = {}, tier, color, options = {}) {
  const tierKey = normalizeTierKey(tier);
  const hex = normalizeHexColor(color);
  if (!tierKey || !hex) return false;
  ensureLegacyEloGraphicState(rawDb, options).tierColors[tierKey] = hex;
  return true;
}

function resetLegacyEloGraphicTierColor(rawDb = {}, tier, options = {}) {
  const tierKey = normalizeTierKey(tier);
  if (!tierKey) return false;
  ensureLegacyEloGraphicState(rawDb, options).tierColors[tierKey] = DEFAULT_LEGACY_ELO_TIER_COLORS[tierKey];
  return true;
}

function resetAllLegacyEloGraphicTierColors(rawDb = {}, options = {}) {
  ensureLegacyEloGraphicState(rawDb, options).tierColors = { ...DEFAULT_LEGACY_ELO_TIER_COLORS };
}

function setLegacyEloTierLabel(rawDb = {}, tier, name) {
  const tierKey = normalizeTierKey(tier);
  const nextName = cleanString(name, 60);
  if (!tierKey || !nextName) return false;
  ensureLegacyEloGraphicState(rawDb);
  rawDb.config.tierLabels[tierKey] = nextName;
  return true;
}

function setLegacyEloTierLabels(rawDb = {}, nextLabels = {}) {
  ensureLegacyEloGraphicState(rawDb);
  for (let tier = 1; tier <= 5; tier += 1) {
    const value = cleanString(nextLabels[tier], 60);
    if (!value) return false;
  }
  rawDb.config.tierLabels = normalizeTierLabels(nextLabels);
  return true;
}

function setLegacyEloGraphicDashboardChannel(rawDb = {}, channelId, options = {}) {
  const nextChannelId = cleanString(channelId, 40);
  const state = ensureLegacyEloGraphicState(rawDb, options);
  state.dashboardChannelId = nextChannelId;
  if (!nextChannelId) {
    state.dashboardMessageId = "";
    state.lastUpdated = null;
  }
  return true;
}

function buildLegacyEloGraphicEntries(rawDb = {}) {
  ensureLegacyEloGraphicState(rawDb);
  return Object.entries(rawDb.ratings || {})
    .map(([fallbackUserId, rating]) => {
      const userId = cleanString(rating?.userId || fallbackUserId, 80);
      const elo = normalizeNullableInteger(rating?.elo, { min: 1 });
      const tier = normalizeNullableInteger(rating?.tier, { min: 1, max: 5 }) || tierForLegacyElo(elo);
      if (!userId || !elo || !tier) return null;

      const displayName = cleanString(rating?.name, 200) || cleanString(rating?.username, 120) || userId;
      const username = cleanString(rating?.username, 120) || displayName;

      return {
        userId,
        name: displayName,
        username,
        kills: elo,
        elo,
        tier,
        avatarUrl: cleanString(rating?.avatarUrl, 1000),
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if ((right.elo || 0) !== (left.elo || 0)) return (right.elo || 0) - (left.elo || 0);
      return String(left.name || "").localeCompare(String(right.name || ""), "ru");
    });
}

function buildLegacyEloGraphicPanelSnapshot(rawDb = {}, options = {}) {
  const state = ensureLegacyEloGraphicState(rawDb, options);
  const cfg = getLegacyEloGraphicImageConfig(rawDb, options);
  const selectedTier = state.panel.selectedTier || 5;
  const tierColors = getLegacyEloGraphicTierColors(rawDb);
  const tierLabels = getLegacyEloGraphicTierLabels(rawDb);

  return {
    title: state.title,
    messageText: state.messageText,
    messagePreview: previewLegacyEloGraphicMessageText(rawDb, 170, options),
    dashboardChannelId: state.dashboardChannelId || "",
    dashboardMessageId: state.dashboardMessageId || "",
    lastUpdated: state.lastUpdated || null,
    image: cfg,
    selectedTier,
    selectedTierLabel: tierLabels[selectedTier] || String(selectedTier),
    selectedTierColor: tierColors[selectedTier] || DEFAULT_LEGACY_ELO_TIER_COLORS[selectedTier],
    tierLabels,
    tierColors,
    totalEntries: buildLegacyEloGraphicEntries(rawDb).length,
  };
}

function buildLegacyEloGraphicStatusLines(rawDb = {}, options = {}) {
  const snapshot = buildLegacyEloGraphicPanelSnapshot(rawDb, options);
  return [
    `title: ${snapshot.title}`,
    `messageText: ${previewText(snapshot.messageText, 120)}`,
    `channelId: ${snapshot.dashboardChannelId || "—"}`,
    `messageId: ${snapshot.dashboardMessageId || "—"}`,
    `img: ${snapshot.image.W}x${snapshot.image.H}, icon=${snapshot.image.ICON}`,
    `selectedTier: ${snapshot.selectedTier} -> ${snapshot.selectedTierLabel}`,
    `tierColors: ${LEGACY_ELO_GRAPHIC_TIER_ORDER.map((tier) => `${tier}=${snapshot.tierColors[tier] || DEFAULT_LEGACY_ELO_TIER_COLORS[tier]}`).join(", ")}`,
    `lastUpdated: ${snapshot.lastUpdated ? new Date(snapshot.lastUpdated).toLocaleString("ru-RU") : "—"}`,
  ];
}

module.exports = {
  DEFAULT_LEGACY_ELO_GRAPHIC_MESSAGE_TEXT,
  DEFAULT_LEGACY_ELO_GRAPHIC_TITLE,
  DEFAULT_LEGACY_ELO_TIER_LABELS,
  LEGACY_ELO_GRAPHIC_TIER_ORDER,
  applyLegacyEloGraphicImageDelta,
  buildLegacyEloGraphicEntries,
  buildLegacyEloGraphicPanelSnapshot,
  buildLegacyEloGraphicStatusLines,
  ensureLegacyEloGraphicState,
  formatLegacyEloTierTitle,
  getLegacyEloGraphicImageConfig,
  getLegacyEloGraphicMessageText,
  getLegacyEloGraphicTierColors,
  getLegacyEloGraphicTierLabels,
  getLegacyEloGraphicTitle,
  normalizeLegacyEloGraphicHexColor: normalizeHexColor,
  previewLegacyEloGraphicMessageText,
  resetAllLegacyEloGraphicTierColors,
  resetLegacyEloGraphicImageOverrides,
  resetLegacyEloGraphicTierColor,
  setLegacyEloGraphicDashboardChannel,
  setLegacyEloGraphicMessageText,
  setLegacyEloGraphicSelectedTier,
  setLegacyEloGraphicTierColor,
  setLegacyEloGraphicTitle,
  setLegacyEloTierLabel,
  setLegacyEloTierLabels,
};