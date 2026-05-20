"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildLegacyEloSubmitStepPayload,
  getLegacyEloSubmitMessageError,
  resolveLegacyEloSubmitTargetChannelId,
} = require("../src/integrations/elo-submit-flow");

test("legacy ELO submit step payload asks for one message with elo and screenshot by default", () => {
  const payload = buildLegacyEloSubmitStepPayload({ channelText: "<#elo>" });

  assert.equal(payload.embeds.length, 1);
  assert.match(payload.embeds[0].data.title, /elo и скрин/i);
  assert.match(payload.embeds[0].data.description, /одним следующим сообщением/i);
  assert.match(payload.embeds[0].data.description, /73 elo/i);
  assert.equal(payload.components.length, 1);
  assert.equal(payload.components[0].toJSON().components[0].custom_id, "elo_submit_cancel");
});

test("legacy ELO submit step payload preserves modal-era fallback when raw text already exists", () => {
  const payload = buildLegacyEloSubmitStepPayload({
    channelText: "<#elo>",
    rawText: "73 elo",
  });

  assert.match(payload.embeds[0].data.description, /ELO: \*\*73\*\*\./);
  assert.match(payload.embeds[0].data.description, /Tier по ELO: \*\*4\*\*\./);
  assert.match(payload.embeds[0].data.title, /elo-скрин/i);
});

test("legacy ELO submit message validation requires elo text and screenshot together", () => {
  assert.match(
    getLegacyEloSubmitMessageError({ rawText: "", hasImageAttachment: false }),
    /число ELO минимум 10/i
  );
  assert.match(
    getLegacyEloSubmitMessageError({ rawText: "73 elo", hasImageAttachment: false }),
    /скрин во вложении/i
  );
  assert.match(
    getLegacyEloSubmitMessageError({ rawText: "abc", hasImageAttachment: true }),
    /число ELO минимум 10/i
  );
  assert.equal(
    getLegacyEloSubmitMessageError({ rawText: "73 elo", hasImageAttachment: true }),
    ""
  );
});

test("legacy ELO submit target channel prefers session, then panel, then fallback channel", () => {
  assert.equal(resolveLegacyEloSubmitTargetChannelId({
    sessionChannelId: "session-channel",
    panelChannelId: "panel-channel",
    fallbackChannelId: "fallback-channel",
  }), "session-channel");
  assert.equal(resolveLegacyEloSubmitTargetChannelId({
    sessionChannelId: "",
    panelChannelId: "panel-channel",
    fallbackChannelId: "fallback-channel",
  }), "panel-channel");
  assert.equal(resolveLegacyEloSubmitTargetChannelId({
    sessionChannelId: "",
    panelChannelId: "",
    fallbackChannelId: "fallback-channel",
  }), "fallback-channel");
});