"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildLegacyCharacterSyncIndex,
  resolveLegacyCharacterMatch,
  resolveLegacyMainIdsFromRuntimeEntries,
} = require("../src/integrations/tierlist-character-sync");

test("character sync resolver matches explicit ids and normalized aliases", () => {
  const index = buildLegacyCharacterSyncIndex([
    { id: "yuji_itadori", name: "Yuji Itadori" },
    { id: "megumi_fushiguro", name: "Megumi Fushiguro" },
  ]);

  assert.equal(resolveLegacyCharacterMatch({ legacyId: "megumi_fushiguro" }, index)?.character?.id, "megumi_fushiguro");
  assert.equal(resolveLegacyCharacterMatch({ id: "yuji_itadori", label: "Юджи" }, index)?.character?.id, "yuji_itadori");
  assert.equal(resolveLegacyCharacterMatch({ label: " Megumi-Fushiguro " }, index)?.character?.id, "megumi_fushiguro");
});

test("character sync resolver uses matched role entries before profile fallback", () => {
  const result = resolveLegacyMainIdsFromRuntimeEntries({
    runtimeEntries: [
      { id: "mod-yuji", legacyId: "yuji_itadori", roleId: "role-yuji" },
      { id: "mod-megumi", label: "Megumi Fushiguro", roleId: "role-megumi" },
      { id: "placeholder", label: "Placeholder Role", roleId: "role-placeholder" },
    ],
    profileMainIds: ["gojo_satoru"],
    legacyCharacters: [
      { id: "yuji_itadori", name: "Yuji Itadori" },
      { id: "megumi_fushiguro", name: "Megumi Fushiguro" },
      { id: "gojo_satoru", name: "Gojo Satoru" },
    ],
  });

  assert.equal(result.source, "roles");
  assert.deepEqual(result.mainIds, ["yuji_itadori", "megumi_fushiguro"]);
  assert.deepEqual(result.matched.map((entry) => entry.legacyId), ["yuji_itadori", "megumi_fushiguro"]);
  assert.deepEqual(result.unmatched, [
    { runtimeId: "placeholder", label: "Placeholder Role", roleId: "role-placeholder" },
  ]);
});

test("character sync resolver falls back to valid profile ids when runtime roles do not map", () => {
  const result = resolveLegacyMainIdsFromRuntimeEntries({
    runtimeEntries: [
      { id: "placeholder", label: "Placeholder Role", roleId: "role-placeholder" },
    ],
    profileMainIds: [" gojo_satoru ", "unknown", "Yuji Itadori"],
    legacyCharacters: [
      { id: "gojo_satoru", name: "Gojo Satoru" },
      { id: "yuji_itadori", name: "Yuji Itadori" },
    ],
  });

  assert.equal(result.source, "profile");
  assert.deepEqual(result.mainIds, ["gojo_satoru", "yuji_itadori"]);
  assert.deepEqual(result.unmatched, [
    { runtimeId: "placeholder", label: "Placeholder Role", roleId: "role-placeholder" },
  ]);
});
