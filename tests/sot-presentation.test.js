"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { resolveAllPresentations, resolvePresentation } = require("../src/sot/resolver/presentation");

test("resolvePresentation merges persisted overrides on top of legacy-backed presentation", () => {
  const db = {
    sot: {
      presentation: {
        welcome: {
          title: "Sot Welcome",
        },
        tierlist: {
          labels: {
            2: "Mid S",
          },
        },
      },
    },
    config: {
      presentation: {
        welcome: {
          title: "Legacy Welcome",
          description: "Legacy description",
          buttons: { confirm: "Join" },
        },
        tierlist: {
          labels: {
            1: "Low S",
            2: "High S",
          },
          graphic: {
            colors: {
              1: "#111111",
            },
          },
        },
      },
    },
  };

  const welcome = resolvePresentation({ slot: "welcome", db });
  const tierlist = resolvePresentation({ slot: "tierlist", db });

  assert.equal(welcome.title, "Sot Welcome");
  assert.equal(welcome.description, "Legacy description");
  assert.equal(welcome.buttons.confirm, "Join");
  assert.equal(tierlist.labels[1], "Low S");
  assert.equal(tierlist.labels[2], "Mid S");
  assert.equal(tierlist.graphic.colors[1], "#111111");
});

test("resolvePresentation supports nonJjs alias and legacy nonJjsUi fallback", () => {
  const result = resolvePresentation({
    slot: "nonJjs",
    db: {
      config: {
        nonJjsUi: {
          title: "Captcha",
          description: "Legacy non JJS presentation",
          buttonLabel: "Начать",
        },
      },
    },
  });

  assert.equal(result.title, "Captcha");
  assert.equal(result.buttonLabel, "Начать");
});

test("resolvePresentation prefers canonical nonGgs presentation over legacy nonJjsUi fallback", () => {
  const result = resolvePresentation({
    slot: "nonGgs",
    db: {
      config: {
        presentation: {
          nonGgs: {
            title: "Canonical captcha",
            description: "Canonical description",
            buttonLabel: "Canonical button",
          },
        },
        nonJjsUi: {
          title: "Legacy captcha",
          description: "Legacy description",
          buttonLabel: "Legacy button",
        },
      },
    },
  });

  assert.equal(result.title, "Canonical captcha");
  assert.equal(result.description, "Canonical description");
  assert.equal(result.buttonLabel, "Canonical button");
});

test("resolveAllPresentations returns all canonical slots", () => {
  const result = resolveAllPresentations({ db: {} });

  assert.deepEqual(Object.keys(result), ["welcome", "tierlist", "nonGgs"]);
});