"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildConfiguredCharacterCatalogView,
  clearNativeCharacterRecord,
  writeNativeCharacterRecord,
} = require("../src/sot/native-characters");

test("buildConfiguredCharacterCatalogView enriches only configured characters from SoT records", () => {
  const result = buildConfiguredCharacterCatalogView({
    configuredCharacters: [
      { id: "honored_one", label: "Honored One", roleId: "" },
      { id: "vessel", label: "Vessel", roleId: "" },
    ],
    resolvedRecords: [
      {
        id: "vessel",
        label: "Юджи",
        englishLabel: "Vessel",
        roleId: "role-yuji",
        source: "discovered",
        verifiedAt: "2026-05-04T10:00:00.000Z",
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
    },
    {
      id: "vessel",
      label: "Юджи",
      englishLabel: "Vessel",
      roleId: "role-yuji",
      source: "discovered",
      verifiedAt: "2026-05-04T10:00:00.000Z",
      evidence: undefined,
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
  });

  assert.equal(result.mutated, true);
  assert.equal(db.sot.characters.vessel.roleId, "role-yuji");
  assert.equal(db.sot.characters.vessel.label, "Юджи");
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