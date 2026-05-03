"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildLegacyCharacterSyncIndex,
  getLegacyMainsBackfillDisposition,
  getLegacyTierlistClusterStatusNote,
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

test("legacy mains backfill keeps tracked users when member snapshot is missing", () => {
  assert.deepEqual(
    getLegacyMainsBackfillDisposition({ member: null, isTrackedUser: true }),
    { shouldSync: false, skippedReason: "missing_member" }
  );

  assert.deepEqual(
    getLegacyMainsBackfillDisposition({ member: null, isTrackedUser: false }),
    { shouldSync: true, skippedReason: "" }
  );

  assert.deepEqual(
    getLegacyMainsBackfillDisposition({ member: { id: "user-1" }, isTrackedUser: true }),
    { shouldSync: true, skippedReason: "" }
  );
});

test("cluster status note ignores unconfigured tierlist path but flags real failures", () => {
  assert.equal(getLegacyTierlistClusterStatusNote("Legacy Tierlist sourcePath не задан."), "");
  assert.equal(getLegacyTierlistClusterStatusNote("  Legacy Tierlist sourcePath не задан.  "), "");
  assert.equal(
    getLegacyTierlistClusterStatusNote("Legacy Tierlist state не найден: C:/tierlist/state.json"),
    "_Кластеры tierlist временно недоступны._"
  );
});
