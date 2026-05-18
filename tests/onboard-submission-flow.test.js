"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createPresentationDefaults, ensurePresentationConfig, resolvePresentation } = require("../src/onboard/presentation");
const {
  parseKillsFromSubmittedText,
  resolveEffectiveSubmittedKills,
  resolveResumableMainCharacterIds,
} = require("../src/onboard/submission-message");

const DEFAULT_GRAPHIC_TIER_COLORS = {
  1: "#111111",
  2: "#222222",
  3: "#333333",
  4: "#444444",
  5: "#555555",
};

test("legacy welcome copy is normalized to the mains-first submission flow", () => {
  const legacyDescription = "Нажми кнопку ниже, выбери 1 или 2 мейнов, укажи точное количество kills и отправь следующим сообщением скрин. После подачи заявки бот сразу выдаст тебе роль доступа, а kill-tier роль прилетит после проверки модератором.";
  const legacySteps = [
    "Нажми **Получить роль**.",
    "Выбери **1 или 2** мейнов.",
    "Введи **точное количество kills**.",
    "Следующим сообщением отправь **скрин** в этот канал.",
    "Бот удалит скрин после обработки, сразу даст access-role, а kill-tier роль прилетит после проверки модератором.",
  ];

  const resolved = resolvePresentation({
    presentation: {
      welcome: {
        description: legacyDescription,
        steps: legacySteps,
      },
    },
  }, {}, {
    defaultGraphicTierColors: DEFAULT_GRAPHIC_TIER_COLORS,
  });

  assert.match(resolved.welcome.description, /Выбор → пруф → доступ/i);
  assert.equal(resolved.welcome.steps.length, 3);
  assert.ok(resolved.welcome.steps.some((step) => /\*\*kills\*\* числом/i.test(step)));
  assert.ok(resolved.welcome.steps.some((step) => /roblox username/i.test(step)));
  assert.ok(resolved.welcome.steps.some((step) => /доступ выдаётся сразу после отправки/i.test(step)));
  assert.ok(resolved.welcome.steps.every((step) => !/следующим сообщением/i.test(step)));
  assert.ok(resolved.welcome.steps.every((step) => !/сразу даст access-role/i.test(step)));
  assert.ok(resolved.welcome.steps.every((step) => !/доступ откроется по режиму сервера/i.test(step)));
  assert.ok(resolved.welcome.steps.every((step) => !/бот откроет доступ/i.test(step)));
});

test("ensurePresentationConfig rewrites persisted legacy welcome text", () => {
  const dbConfig = {
    presentation: {
      welcome: {
        description: "Нажми кнопку ниже, выбери 1 или 2 мейнов, укажи точное количество kills и отправь следующим сообщением скрин. После подачи заявки бот сразу выдаст тебе роль доступа, а kill-tier роль прилетит после проверки модератором.",
        steps: [
          "Нажми **Получить роль**.",
          "Выбери **1 или 2** мейнов.",
          "Введи **точное количество kills**.",
          "Следующим сообщением отправь **скрин** в этот канал.",
          "Бот удалит скрин после обработки, сразу даст access-role, а kill-tier роль прилетит после проверки модератором.",
        ],
      },
    },
  };

  const result = ensurePresentationConfig(dbConfig, {
    defaults: createPresentationDefaults({}, { defaultGraphicTierColors: DEFAULT_GRAPHIC_TIER_COLORS }),
    defaultWelcomeChannelId: "welcome-home",
    defaultTextTierlistChannelId: "text-home",
    defaultGraphicTierColors: DEFAULT_GRAPHIC_TIER_COLORS,
  });

  assert.equal(result.mutated, true);
  assert.match(dbConfig.presentation.welcome.description, /Выбор → пруф → доступ/i);
  assert.equal(dbConfig.presentation.welcome.steps.length, 3);
  assert.ok(dbConfig.presentation.welcome.steps.some((step) => /\*\*kills\*\* числом/i.test(step)));
  assert.ok(dbConfig.presentation.welcome.steps.some((step) => /roblox username/i.test(step)));
  assert.ok(dbConfig.presentation.welcome.steps.some((step) => /доступ выдаётся сразу после отправки/i.test(step)));
});

test("ensurePresentationConfig removes outdated compact welcome summary", () => {
  const dbConfig = {
    presentation: {
      welcome: {
        description: "Маршрут простой: emoji-мейны, один пруф, мод-чек. Без лишней анкеты: если текущий режим требует сверку, бот сам попросит Roblox username.",
        steps: [
          "Жми **Получить роль** и выбери **1-2 emoji-мейнов** кнопками.",
          "Отправь **одно сообщение**: **kills** числом + скрин, где видны kills и **Roblox username**.",
          "После отправки бот откроет доступ; **kill-tier** прилетит после мод-чека.",
        ],
      },
    },
  };

  const result = ensurePresentationConfig(dbConfig, {
    defaults: createPresentationDefaults({}, { defaultGraphicTierColors: DEFAULT_GRAPHIC_TIER_COLORS }),
    defaultWelcomeChannelId: "welcome-home",
    defaultTextTierlistChannelId: "text-home",
    defaultGraphicTierColors: DEFAULT_GRAPHIC_TIER_COLORS,
  });

  assert.equal(result.mutated, true);
  assert.match(dbConfig.presentation.welcome.description, /Выбор → пруф → доступ/i);
  assert.ok(dbConfig.presentation.welcome.steps.some((step) => /доступ выдаётся сразу после отправки/i.test(step)));
  assert.ok(dbConfig.presentation.welcome.steps.every((step) => !/бот откроет доступ/i.test(step)));
});

test("ensurePresentationConfig compacts persisted long welcome flow", () => {
  const dbConfig = {
    presentation: {
      welcome: {
        description: "Здесь получаем доступ после простого опроса",
        steps: [
          "Нажми **Получить роль**.",
          "Выбери **1 или 2** мейнов.",
          "Отправь одним сообщением скрин экрана с открытым табом и точное количество килов.",
          "Бот удалит скрин после обработки, сразу даст доступ к серверу.",
          "Не обязательно укажи свой точный юзернейм в роблокс.",
        ],
      },
    },
  };

  const result = ensurePresentationConfig(dbConfig, {
    defaults: createPresentationDefaults({}, { defaultGraphicTierColors: DEFAULT_GRAPHIC_TIER_COLORS }),
    defaultWelcomeChannelId: "welcome-home",
    defaultTextTierlistChannelId: "text-home",
    defaultGraphicTierColors: DEFAULT_GRAPHIC_TIER_COLORS,
  });

  assert.equal(result.mutated, true);
  assert.match(dbConfig.presentation.welcome.description, /Выбор → пруф → доступ/i);
  assert.equal(dbConfig.presentation.welcome.steps.length, 3);
  assert.ok(dbConfig.presentation.welcome.steps.every((step) => !/не обязательно/i.test(step)));
});

test("parseKillsFromSubmittedText extracts a single kills value from free text", () => {
  assert.deepEqual(parseKillsFromSubmittedText("3120 kills"), { kills: 3120, reason: null });
  assert.deepEqual(parseKillsFromSubmittedText("kills: 3 120"), { kills: 3120, reason: null });
  assert.deepEqual(parseKillsFromSubmittedText(""), { kills: null, reason: "missing" });
});

test("parseKillsFromSubmittedText rejects ambiguous multi-number messages", () => {
  const result = parseKillsFromSubmittedText("kills 3120, main 2");

  assert.equal(result.kills, null);
  assert.equal(result.reason, "ambiguous");
  assert.deepEqual(result.candidates, ["3120", "2"]);
});

test("resolveEffectiveSubmittedKills falls back to suggested kills only when text has no explicit number", () => {
  assert.deepEqual(resolveEffectiveSubmittedKills("", 4200), {
    kills: null,
    reason: "missing",
    effectiveKills: 4200,
  });

  assert.deepEqual(resolveEffectiveSubmittedKills("4201 kills", 4200), {
    kills: 4201,
    reason: null,
    effectiveKills: 4201,
  });

  assert.deepEqual(resolveEffectiveSubmittedKills("kills 3120, main 2", 4200), {
    kills: null,
    reason: "ambiguous",
    candidates: ["3120", "2"],
    effectiveKills: null,
  });
});

test("resolveResumableMainCharacterIds prefers stored mains and falls back to live role mains", () => {
  assert.deepEqual(resolveResumableMainCharacterIds({
    storedMainCharacterIds: ["vessel", "vessel", "ten_shadows"],
    liveMainCharacterIds: ["honored_one"],
  }), ["vessel", "ten_shadows"]);

  assert.deepEqual(resolveResumableMainCharacterIds({
    storedMainCharacterIds: [],
    liveMainCharacterIds: ["honored_one", "honored_one", "vessel"],
  }), ["honored_one", "vessel"]);
});
