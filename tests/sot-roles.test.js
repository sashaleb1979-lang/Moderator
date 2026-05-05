"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveAllRoleRecords,
  resolveKillTierRole,
  resolveLegacyEloTierRole,
  resolveRoleRecord,
} = require("../src/sot/resolver/roles");
const {
  clearNativeRoleRecord,
  normalizeRoleSlot,
  writeNativeRoleRecord,
} = require("../src/sot/native-roles");

function createContext(overrides = {}) {
  return {
    db: overrides.db || {
      config: {
        generatedRoles: {
          tiers: {
            3: "tier-3-generated",
            5: "tier-5-generated",
          },
        },
      },
    },
    appConfig: overrides.appConfig || {
      roles: {
        moderatorRoleId: "moderator-config",
        accessRoleId: "access-config",
        wartimeAccessRoleId: "wartime-config",
        nonGgsAccessRoleId: "nonjjs-config",
        killTierRoleIds: {
          1: "tier-1-config",
          2: "tier-2-config",
          3: "tier-3-config",
        },
        legacyEloTierRoleIds: {
          1: "legacy-1-config",
          2: "legacy-2-config",
        },
      },
    },
  };
}

test("resolveRoleRecord prefers persisted db.sot records for base roles", () => {
  const result = resolveRoleRecord({
    slot: "moderator",
    db: {
      sot: {
        roles: {
          moderator: { value: "moderator-sot", source: "manual", verifiedAt: "2026-05-03T12:00:00.000Z" },
        },
      },
    },
    appConfig: createContext().appConfig,
  });

  assert.deepEqual(result, {
    value: "moderator-sot",
    source: "manual",
    verifiedAt: "2026-05-03T12:00:00.000Z",
  });
});

test("resolveKillTierRole prefers configured ids, then generated ids when config is absent", () => {
  const context = createContext();

  assert.deepEqual(resolveKillTierRole({ tier: 3, ...context }), {
    value: "tier-3-config",
    source: "configured",
    verifiedAt: null,
  });
  assert.deepEqual(resolveKillTierRole({
    tier: 5,
    db: context.db,
    appConfig: {
      roles: {
        killTierRoleIds: {},
      },
    },
  }), {
    value: "tier-5-generated",
    source: "discovered",
    verifiedAt: null,
  });
});

test("resolveKillTierRole and resolveLegacyEloTierRole prefer persisted db.sot overrides", () => {
  const result = resolveAllRoleRecords({
    db: {
      config: {
        generatedRoles: {
          tiers: {
            3: "tier-3-generated",
          },
        },
      },
      sot: {
        roles: {
          killTier: {
            3: { value: "tier-3-sot", source: "manual", verifiedAt: "2026-05-04T10:00:00.000Z" },
          },
          legacyEloTier: {
            2: { value: "legacy-2-sot", source: "manual", verifiedAt: "2026-05-04T10:05:00.000Z" },
          },
        },
      },
    },
    appConfig: createContext().appConfig,
  });

  assert.deepEqual(result.killTier[3], {
    value: "tier-3-sot",
    source: "manual",
    verifiedAt: "2026-05-04T10:00:00.000Z",
  });
  assert.deepEqual(result.legacyEloTier[2], {
    value: "legacy-2-sot",
    source: "manual",
    verifiedAt: "2026-05-04T10:05:00.000Z",
  });
});

test("resolveLegacyEloTierRole and accessNonJjs fall back to configured aliases", () => {
  assert.deepEqual(resolveLegacyEloTierRole({ tier: 2, ...createContext() }), {
    value: "legacy-2-config",
    source: "configured",
    verifiedAt: null,
  });
  assert.deepEqual(resolveRoleRecord({
    slot: "accessNonJjs",
    db: {},
    appConfig: {
      roles: {
        nonJjsAccessRoleId: "nonjjs-legacy-config",
      },
    },
  }), {
    value: "nonjjs-legacy-config",
    source: "configured",
    verifiedAt: null,
  });
});

test("resolveAllRoleRecords returns all base and tier role slots", () => {
  const result = resolveAllRoleRecords(createContext());

  assert.equal(result.moderator.value, "moderator-config");
  assert.equal(result.accessNormal.value, "access-config");
  assert.equal(result.killTier[1].value, "tier-1-config");
  assert.equal(result.killTier[5].value, "tier-5-generated");
  assert.equal(result.legacyEloTier[1].value, "legacy-1-config");
});

test("writeNativeRoleRecord stores manual base-role override and resolveRoleRecord prefers it", () => {
  const context = createContext();

  const result = writeNativeRoleRecord(context.db, {
    slot: "accessNormal",
    roleId: "access-manual",
    source: "manual",
    verifiedAt: "2026-05-05T09:00:00.000Z",
  });

  assert.equal(result.mutated, true);
  assert.equal(result.record.value, "access-manual");
  assert.equal(result.record.source, "manual");
  assert.equal(result.record.verifiedAt, "2026-05-05T09:00:00.000Z");
  assert.equal(result.record.evidence.nativeWriter, true);
  assert.equal(result.record.evidence.manualOverride, true);

  const resolved = resolveRoleRecord({ slot: "accessNormal", ...context });
  assert.equal(resolved.value, "access-manual");
  assert.equal(resolved.source, "manual");
});

test("writeNativeRoleRecord stores manual kill-tier override and resolveKillTierRole prefers it", () => {
  const context = createContext();

  const result = writeNativeRoleRecord(context.db, {
    slot: "killTier:3",
    roleId: "tier-3-manual",
    source: "manual",
    verifiedAt: "2026-05-05T09:10:00.000Z",
  });

  assert.equal(result.mutated, true);
  assert.equal(result.slot, "killTier:3");
  assert.equal(context.db.sot.roles.killTier[3].value, "tier-3-manual");

  const resolved = resolveKillTierRole({ tier: 3, ...context });
  assert.deepEqual(resolved, {
    value: "tier-3-manual",
    source: "manual",
    verifiedAt: "2026-05-05T09:10:00.000Z",
    evidence: {
      nativeWriter: true,
      manualOverride: true,
    },
  });
});

test("clearNativeRoleRecord removes manual legacy ELO tier override and falls back to configured value", () => {
  const context = createContext();

  writeNativeRoleRecord(context.db, {
    slot: "legacyEloTier:2",
    roleId: "legacy-2-manual",
    source: "manual",
    verifiedAt: "2026-05-05T09:20:00.000Z",
  });

  const result = clearNativeRoleRecord(context.db, { slot: "legacyEloTier:2" });
  assert.equal(result.mutated, true);
  assert.equal(context.db.sot.roles.legacyEloTier[2], null);

  const resolved = resolveLegacyEloTierRole({ tier: 2, ...context });
  assert.deepEqual(resolved, {
    value: "legacy-2-config",
    source: "configured",
    verifiedAt: null,
  });
});

test("clearNativeRoleRecord removes manual base-role override and falls back to configured value", () => {
  const context = createContext({
    db: {
      config: {
        generatedRoles: {
          tiers: {},
        },
      },
    },
  });

  writeNativeRoleRecord(context.db, {
    slot: "accessNormal",
    roleId: "access-manual",
    source: "manual",
    verifiedAt: "2026-05-05T09:00:00.000Z",
  });

  const result = clearNativeRoleRecord(context.db, { slot: "accessNormal" });
  assert.equal(result.mutated, true);
  assert.equal(context.db.sot.roles.accessNormal, null);

  const resolved = resolveRoleRecord({ slot: "accessNormal", ...context });
  assert.deepEqual(resolved, {
    value: "access-config",
    source: "configured",
    verifiedAt: null,
  });
});

test("normalizeRoleSlot accepts nonJjs aliases and rejects unknown slots", () => {
  assert.deepEqual(normalizeRoleSlot("accessNonJjs"), {
    canonical: "accessNonJjs",
    label: "Access nonJJS",
    domain: "base",
    key: "accessNonJjs",
  });
  assert.deepEqual(normalizeRoleSlot("non-ggs"), {
    canonical: "accessNonJjs",
    label: "Access nonJJS",
    domain: "base",
    key: "accessNonJjs",
  });
  assert.deepEqual(normalizeRoleSlot("killTier:4"), {
    canonical: "killTier:4",
    label: "Kill tier 4",
    domain: "killTier",
    key: "4",
  });
  assert.deepEqual(normalizeRoleSlot("elo-3"), {
    canonical: "legacyEloTier:3",
    label: "Legacy ELO tier 3",
    domain: "legacyEloTier",
    key: "3",
  });
  assert.equal(normalizeRoleSlot("unknown-slot"), null);
});