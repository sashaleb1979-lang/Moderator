"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  applyConfiguredCharacterRoleBindings,
  buildConfiguredCharacterCatalogView,
  clearNativeCharacterRecord,
  writeNativeCharacterRecord,
} = require("../src/sot/native-characters");

test("buildConfiguredCharacterCatalogView enriches only configured characters from SoT records", () => {
  const result = buildConfiguredCharacterCatalogView({
    configuredCharacters: [
      { id: "honored_one", label: "Honored One", roleId: "", wikiUrl: "https://wiki/honored_one" },
      { id: "vessel", label: "Vessel", roleId: "", wikiUrl: "https://wiki/vessel-configured" },
    ],
    resolvedRecords: [
      {
        id: "vessel",
        label: "Юджи",
        englishLabel: "Vessel",
        roleId: "role-yuji",
        source: "discovered",
        verifiedAt: "2026-05-04T10:00:00.000Z",
        wikiUrl: "https://wiki/vessel-resolved",
      },
      {
        id: "manual_only",
        label: "Manual Only",
        englishLabel: "Manual Only",
        roleId: "role-manual",
        source: "manual",
      },
    ],
  });

  assert.deepEqual(result, [
    {
      id: "honored_one",
      label: "Honored One",
      englishLabel: "Honored One",
      roleId: "",
      source: "default",
      verifiedAt: "",
      evidence: undefined,
      wikiUrl: "https://wiki/honored_one",
    },
    {
      id: "vessel",
      label: "Юджи",
      englishLabel: "Vessel",
      roleId: "role-yuji",
      source: "discovered",
      verifiedAt: "2026-05-04T10:00:00.000Z",
      evidence: undefined,
      wikiUrl: "https://wiki/vessel-resolved",
    },
  ]);
});

test("writeNativeCharacterRecord stores native-owned character binding in db.sot", () => {
  const db = {};

  const result = writeNativeCharacterRecord(db, {
    characterId: "vessel",
    label: "Юджи",
    englishLabel: "Vessel",
    roleId: "role-yuji",
    source: "discovered",
    verifiedAt: "2026-05-04T10:00:00.000Z",
    evidence: { overlap: 2 },
    wikiUrl: "https://wiki/vessel",
  });

  assert.equal(result.mutated, true);
  assert.equal(db.sot.characters.vessel.roleId, "role-yuji");
  assert.equal(db.sot.characters.vessel.label, "Юджи");
  assert.equal(db.sot.characters.vessel.wikiUrl, "https://wiki/vessel");
  assert.deepEqual(db.sot.characters.vessel.evidence, {
    overlap: 2,
    nativeWriter: true,
  });
});

test("clearNativeCharacterRecord clears binding but keeps native ownership marker", () => {
  const db = {
    sot: {
      sotVersion: 1,
      characters: {
        vessel: {
          id: "vessel",
          label: "Юджи",
          englishLabel: "Vessel",
          wikiUrl: "https://wiki/vessel",
          roleId: "role-yuji",
          source: "discovered",
          verifiedAt: "2026-05-04T10:00:00.000Z",
          evidence: { nativeWriter: true, overlap: 2 },
        },
      },
    },
  };

  const result = clearNativeCharacterRecord(db, {
    characterId: "vessel",
    label: "Vessel",
    englishLabel: "Vessel",
  });

  assert.equal(result.mutated, true);
  assert.equal(db.sot.characters.vessel.roleId, "");
  assert.equal(db.sot.characters.vessel.label, "Vessel");
  assert.equal(db.sot.characters.vessel.wikiUrl, "https://wiki/vessel");
  assert.deepEqual(db.sot.characters.vessel.evidence, {
    nativeWriter: true,
  });
});

test("writeNativeCharacterRecord does not overwrite explicit manual overrides", () => {
  const db = {
    sot: {
      sotVersion: 1,
      characters: {
        vessel: {
          id: "vessel",
          label: "Юджи manual",
          englishLabel: "Vessel",
          roleId: "role-manual",
          source: "manual",
          verifiedAt: null,
          evidence: { manualOverride: true },
        },
      },
    },
  };

  const result = writeNativeCharacterRecord(db, {
    characterId: "vessel",
    label: "Юджи auto",
    englishLabel: "Vessel",
    roleId: "role-auto",
    source: "discovered",
  });

  assert.equal(result.mutated, false);
  assert.equal(result.preserved, true);
  assert.equal(db.sot.characters.vessel.roleId, "role-manual");
  assert.equal(db.sot.characters.vessel.label, "Юджи manual");
});

test("writeNativeCharacterRecord preserves existing history entries", () => {
  const db = {
    sot: {
      sotVersion: 1,
      characters: {
        vessel: {
          id: "vessel",
          label: "Юджи",
          englishLabel: "Vessel",
          roleId: "role-yuji",
          source: "discovered",
          verifiedAt: "2026-05-04T10:00:00.000Z",
          evidence: { nativeWriter: true },
          history: [
            { at: "2026-05-03T12:00:00.000Z", from: "configured", to: "discovered", oldValue: "role-old" },
          ],
        },
      },
    },
  };

  writeNativeCharacterRecord(db, {
    characterId: "vessel",
    label: "Юджи",
    englishLabel: "Vessel",
    roleId: "role-yuji",
    source: "discovered",
    verifiedAt: "2026-05-04T11:00:00.000Z",
  });

  assert.deepEqual(db.sot.characters.vessel.history, [
    { at: "2026-05-03T12:00:00.000Z", from: "configured", to: "discovered", oldValue: "role-old" },
  ]);
});

test("applyConfiguredCharacterRoleBindings repairs stale duplicate role owners on startup", () => {
  const db = {
    config: {
      generatedRoles: {
        characters: { ryu: "role-black-death" },
        characterLabels: { ryu: "Рю" },
      },
      characters: [
        { id: "ryu", label: "Ryu", roleId: "role-black-death" },
      ],
    },
    sot: {
      sotVersion: 1,
      characters: {
        ryu: {
          id: "ryu",
          label: "Рю",
          englishLabel: "Ryu",
          roleId: "role-black-death",
          source: "recovered",
          verifiedAt: "2026-05-22T01:42:46.437Z",
          evidence: { nativeWriter: true },
        },
      },
    },
  };

  const result = applyConfiguredCharacterRoleBindings(db, {
    characters: [
      { id: "ryu", label: "Ryu", roleId: "" },
      { id: "black_death", label: "Black Death", roleId: "role-black-death", wikiUrl: "https://wiki/black_death" },
    ],
  }, {
    verifiedAt: "2026-05-23T08:00:00.000Z",
  });

  assert.equal(result.mutated, true);
  assert.deepEqual(result.writtenIds, ["black_death"]);
  assert.deepEqual(result.duplicateClearedIds, ["ryu"]);
  assert.equal(db.sot.characters.ryu.roleId, "");
  assert.equal(db.sot.characters.black_death.roleId, "role-black-death");
  assert.equal(db.sot.characters.black_death.source, "configured");
  assert.equal(db.sot.characters.black_death.wikiUrl, "https://wiki/black_death");
  assert.deepEqual(db.config.generatedRoles.characters, { black_death: "role-black-death" });
  assert.equal(db.config.generatedRoles.characterLabels.black_death, "Black Death");
  assert.deepEqual(db.config.characters, [
    { id: "ryu", label: "Ryu", roleId: "" },
    { id: "black_death", label: "Black Death", roleId: "role-black-death" },
  ]);
});
