"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createPresentationDefaults, ensurePresentationConfig, resolvePresentation } = require("../src/onboard/presentation");
const { parseKillsFromSubmittedText, resolveEffectiveSubmittedKills } = require("../src/onboard/submission-message");

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

  assert.match(resolved.welcome.description, /если текущий режим требует дополнительной проверки/i);
  assert.ok(resolved.welcome.steps.some((step) => /указать kills/i.test(step)));
  assert.ok(resolved.welcome.steps.some((step) => /roblox username/i.test(step)));
  assert.ok(resolved.welcome.steps.every((step) => !/следующим сообщением/i.test(step)));
  assert.ok(resolved.welcome.steps.every((step) => !/сразу даст access-role/i.test(step)));
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
  assert.match(dbConfig.presentation.welcome.description, /если текущий режим требует дополнительной проверки/i);
  assert.ok(dbConfig.presentation.welcome.steps.some((step) => /указать kills/i.test(step)));
  assert.ok(dbConfig.presentation.welcome.steps.some((step) => /roblox username/i.test(step)));
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
