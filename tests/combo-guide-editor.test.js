"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildComboPanelPayload,
  buildMessageSelectPayload,
  normalizeComboGuideEditorRoleIds,
} = require("../src/combo-guide/editor");

function makeGuideState() {
  return {
    channelId: "456",
    editorRoleIds: ["111", " 222 ", "111", ""],
    generalTechsThreadId: "789",
    generalTechsMessageIds: ["901"],
    characters: [
      {
        id: "gojo",
        name: "Gojo",
        emoji: "⚪",
        comboMessageIds: ["100", "101"],
        techMessageIds: ["200"],
        threadId: "300",
      },
    ],
  };
}

test("editor role ids are normalized for combo guide access", () => {
  assert.deepEqual(normalizeComboGuideEditorRoleIds(["111", " 222 ", "", "111", null]), ["111", "222"]);
});

test("moderator combo panel includes role access controls", () => {
  const payload = buildComboPanelPayload(makeGuideState(), "ok", {
    canManage: true,
    canEdit: true,
  });

  assert.equal(payload.components.length, 4);
  assert.equal(payload.components[0].toJSON().components[0].custom_id, "combo_select_character");
  assert.equal(payload.components[1].toJSON().components[0].custom_id, "combo_panel_refresh_nav");
  assert.equal(payload.components[2].toJSON().components[0].custom_id, "combo_panel_pick_editor_role");
  assert.equal(payload.components[3].toJSON().components[0].custom_id, "combo_panel_clear_editor_roles");

  const embed = payload.embeds[0].toJSON();
  const accessField = embed.fields.find((field) => field.name === "Доп. доступ к панели");
  assert.ok(accessField);
  assert.match(accessField.value, /<@&111>/);
  assert.match(accessField.value, /<@&222>/);
});

test("editor-only combo panel hides moderator actions", () => {
  const payload = buildComboPanelPayload(makeGuideState(), "ok", {
    canManage: false,
    canEdit: true,
  });

  assert.equal(payload.components.length, 1);
  assert.equal(payload.components[0].toJSON().components[0].custom_id, "combo_select_character");
});

test("message picker hides remove button for extra editors", () => {
  const guideState = makeGuideState();
  const payload = buildMessageSelectPayload(guideState.characters[0], guideState, {
    canManage: false,
  });

  assert.equal(payload.components.length, 1);
  assert.equal(payload.components[0].toJSON().components[0].custom_id, "combo_select_message");
});
