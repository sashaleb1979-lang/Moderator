"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  listCharacterRecords,
  resolveAllCharacterRecords,
  resolveCharacterRecord,
} = require("../src/sot/resolver/characters");

test("resolveCharacterRecord prefers persisted db.sot characters over configured and generated entries", () => {
  const result = resolveCharacterRecord({
    characterId: "honored_one",
    db: {
      sot: {
        characters: {
          honored_one: {
            id: "honored_one",
            label: "Годжо",
            englishLabel: "Honored One",
            roleId: "role-sot",
            source: "manual",
            verifiedAt: "2026-05-03T12:00:00.000Z",
          },
        },
      },
      config: {
        generatedRoles: {
          characters: {
            honored_one: "role-generated",
          },
          characterLabels: {
            honored_one: "Годжо из guild",
          },
        },
      },
    },
    appConfig: {
      characters: [
        { id: "honored_one", label: "Honored One", roleId: "role-configured" },
      ],
    },
  });

  assert.deepEqual(result, {
    id: "honored_one",
    label: "Годжо",
    englishLabel: "Honored One",
    roleId: "role-sot",
    source: "manual",
    verifiedAt: "2026-05-03T12:00:00.000Z",
    evidence: undefined,
  });
});

test("resolveCharacterRecord falls back to recovery plan and keeps overlap evidence", () => {
  const result = resolveCharacterRecord({
    characterId: "vessel",
    appConfig: {
      characters: [
        { id: "vessel", label: "Vessel" },
      ],
    },
    profiles: {
      user_1: { mainCharacterIds: ["vessel"] },
      user_2: { mainCharacterIds: ["vessel"] },
    },
    guildRoles: [
      { id: "role_yuji", name: "Юджи", memberUserIds: ["user_1", "user_2"] },
      { id: "role_noise", name: "Лишняя роль", memberUserIds: ["user_9"] },
    ],
    verifiedRoleIds: ["role_yuji"],
    verifiedAt: "2026-05-03T12:05:00.000Z",
  });

  assert.equal(result.id, "vessel");
  assert.equal(result.label, "Юджи");
  assert.equal(result.englishLabel, "Vessel");
  assert.equal(result.roleId, "role_yuji");
  assert.equal(result.source, "recovered");
  assert.equal(result.verifiedAt, "2026-05-03T12:05:00.000Z");
  assert.equal(result.evidence.overlap, 2);
  assert.equal(result.evidence.coverage, 1);
  assert.equal(result.evidence.preferredMatch, false);
});

test("resolveCharacterRecord does not auto-prefer stale profile role snapshots over live overlap evidence", () => {
  const result = resolveCharacterRecord({
    characterId: "vessel",
    appConfig: {
      characters: [
        { id: "vessel", label: "Vessel" },
      ],
    },
    profiles: {
      user_1: {
        mainCharacterIds: ["vessel"],
        characterRoleIds: ["role_stale"],
      },
    },
    guildRoles: [
      { id: "role_stale", name: "Старая роль", memberUserIds: ["user_9"] },
      { id: "role_live", name: "Юджи", memberUserIds: ["user_1"] },
    ],
    verifiedRoleIds: ["role_live"],
    verifiedAt: "2026-05-03T12:20:00.000Z",
  });

  assert.equal(result.roleId, "role_live");
  assert.equal(result.source, "recovered");
  assert.equal(result.verifiedAt, "2026-05-03T12:20:00.000Z");
  assert.equal(result.label, "Юджи");
  assert.equal(result.evidence.preferredMatch, false);
});

test("resolveCharacterRecord falls through stale configured role ids to a verified recovered candidate", () => {
  const result = resolveCharacterRecord({
    characterId: "vessel",
    appConfig: {
      characters: [
        { id: "vessel", label: "Vessel", roleId: "role-stale-config" },
      ],
    },
    recoveryPlan: {
      recoveredRoleIds: {
        vessel: "role-live",
      },
      recoveredRoleLabels: {
        vessel: "Юджи",
      },
      ambiguous: [],
      unresolved: [],
      analysisByCharacterId: {},
    },
    verifiedRoleIds: ["role-live"],
    verifiedAt: "2026-05-03T12:25:00.000Z",
  });

  assert.equal(result.roleId, "role-live");
  assert.equal(result.source, "recovered");
  assert.equal(result.label, "Юджи");
  assert.equal(result.verifiedAt, "2026-05-03T12:25:00.000Z");
});

test("resolveCharacterRecord ignores stale generated fallback when persisted native SoT record owns the slot", () => {
  const result = resolveCharacterRecord({
    characterId: "vessel",
    db: {
      sot: {
        characters: {
          vessel: {
            id: "vessel",
            label: "Vessel",
            englishLabel: "Vessel",
            roleId: "",
            source: "default",
            verifiedAt: null,
            evidence: { nativeWriter: true },
          },
        },
      },
      config: {
        generatedRoles: {
          characters: {
            vessel: "role-generated-stale",
          },
          characterLabels: {
            vessel: "Юджи legacy",
          },
        },
      },
    },
    appConfig: {
      characters: [
        { id: "vessel", label: "Vessel" },
      ],
    },
  });

  assert.equal(result.roleId, "");
  assert.equal(result.label, "Vessel");
  assert.equal(result.source, "default");
});

test("resolveAllCharacterRecords keeps canonical catalog entries and ignores generated-only leak ids", () => {
  const result = resolveAllCharacterRecords({
    db: {
      sot: {
        characters: {
          manual_only: {
            id: "manual_only",
            label: "Manual Only",
            englishLabel: "Manual Only",
            roleId: "role-manual",
            source: "manual",
          },
        },
      },
      config: {
        generatedRoles: {
          characters: {
            outsider: "role-outsider",
          },
          characterLabels: {
            outsider: "Outsider",
          },
        },
      },
    },
    appConfig: {
      characters: [
        { id: "vessel", label: "Vessel" },
      ],
    },
  });

  assert.deepEqual(Object.keys(result).sort(), ["manual_only", "vessel"]);
  assert.equal(result.manual_only.roleId, "role-manual");
  assert.equal(result.vessel.roleId, "");
});

test("listCharacterRecords can hide unresolved entries while keeping resolved ones first for picker usage", () => {
  const result = listCharacterRecords({
    pickerOnly: true,
    includeUnresolved: false,
    verifiedRoleIds: ["role-gojo"],
    verifiedAt: "2026-05-03T12:00:00.000Z",
    db: {
      sot: {
        characters: {
          honored_one: {
            id: "honored_one",
            label: "Годжо",
            englishLabel: "Honored One",
            roleId: "role-gojo",
            source: "manual",
          },
        },
      },
    },
    appConfig: {
      characters: [
        { id: "honored_one", label: "Honored One" },
        { id: "vessel", label: "Vessel" },
      ],
    },
  });

  assert.deepEqual(result.map((entry) => entry.id), ["honored_one"]);
});

test("listCharacterRecords excludes stale bindings from pickerOnly output even when roleId is present", () => {
  const result = listCharacterRecords({
    pickerOnly: true,
    db: {
      sot: {
        characters: {
          honored_one: {
            id: "honored_one",
            label: "Годжо",
            englishLabel: "Honored One",
            roleId: "role-gojo",
            source: "manual",
          },
          vessel: {
            id: "vessel",
            label: "Юджи",
            englishLabel: "Vessel",
            roleId: "role-yuji",
            source: "manual",
          },
        },
      },
    },
    verifiedRoleIds: ["role-gojo"],
    verifiedAt: "2026-05-03T12:10:00.000Z",
  });

  assert.deepEqual(result.map((entry) => entry.id), ["honored_one"]);
  assert.equal(result[0].verifiedAt, "2026-05-03T12:10:00.000Z");
});

test("listCharacterRecords ignores compat db.config.characters and still applies excluded ids to configured catalog", () => {
  const result = listCharacterRecords({
    includeUnresolved: true,
    excludedCharacterIds: ["mahito"],
    appConfig: {
      characters: [
        { id: "vessel", label: "Vessel" },
        { id: "mahito", label: "Mahito" },
      ],
    },
    db: {
      config: {
        characters: [
          { id: "legacy_only", label: "Legacy Only" },
        ],
      },
    },
  });

  assert.deepEqual(result.map((entry) => entry.id), ["vessel"]);
});

test("listCharacterRecords preserves configured character order before label sort", () => {
  const result = listCharacterRecords({
    db: {
      sot: {
        characters: {
          honored_one: {
            id: "honored_one",
            label: "Годжо",
            englishLabel: "Honored One",
            roleId: "role-gojo",
            source: "manual",
          },
          vessel: {
            id: "vessel",
            label: "Юджи",
            englishLabel: "Vessel",
            roleId: "role-yuji",
            source: "manual",
          },
          ten_shadows: {
            id: "ten_shadows",
            label: "Мегуми",
            englishLabel: "Ten Shadows",
            roleId: "role-megumi",
            source: "manual",
          },
          manual_only: {
            id: "manual_only",
            label: "Ручной",
            englishLabel: "Manual Only",
            roleId: "role-manual",
            source: "manual",
          },
        },
      },
    },
    appConfig: {
      characters: [
        { id: "honored_one", label: "Honored One" },
        { id: "vessel", label: "Vessel" },
        { id: "ten_shadows", label: "Ten Shadows" },
      ],
    },
  });

  assert.deepEqual(result.map((entry) => entry.id), [
    "honored_one",
    "vessel",
    "ten_shadows",
    "manual_only",
  ]);
});