"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildManagedCharacterEntries,
  normalizeManagedCharacterCatalog,
} = require("../src/integrations/character-role-catalog");

test("normalizeManagedCharacterCatalog keeps only canonical configured entries", () => {
  const result = normalizeManagedCharacterCatalog([
    { id: " honored_one ", label: "Honored One" },
    { id: "", label: "Vessel" },
    { id: "honored_one", label: "Duplicate Honored One" },
    { id: "ten_shadows", label: "Ten Shadows", roleId: "role-ten" },
  ]);

  assert.deepEqual(result, [
    { id: "honored_one", label: "Honored One", roleId: "" },
    { id: "vessel", label: "Vessel", roleId: "" },
    { id: "ten_shadows", label: "Ten Shadows", roleId: "role-ten" },
  ]);
});

test("buildManagedCharacterEntries prefers configured role ids and ignores runtime extras", () => {
  const result = buildManagedCharacterEntries({
    managedCharacters: [
      { id: "honored_one", label: "Honored One", roleId: "role-configured" },
      { id: "vessel", label: "Vessel", roleId: "" },
    ],
    generatedRoleIds: {
      honored_one: "role-generated",
      vessel: "role-vessel",
      crowd_charmer: "role-junk",
    },
  });

  assert.deepEqual(result, [
    { id: "honored_one", label: "Honored One", roleId: "role-configured" },
    { id: "vessel", label: "Vessel", roleId: "role-vessel" },
  ]);
});