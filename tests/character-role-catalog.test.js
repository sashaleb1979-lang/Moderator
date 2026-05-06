"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildHistoricalManagedCharacterUserIds,
  buildHistoricalManagedCharacterRoleIds,
  buildManagedCharacterRoleRecoveryPlan,
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

test("buildManagedCharacterEntries prefers configured, historical, then generated role ids", () => {
  const result = buildManagedCharacterEntries({
    managedCharacters: [
      { id: "honored_one", label: "Honored One", roleId: "role-configured" },
      { id: "vessel", label: "Vessel", roleId: "" },
      { id: "ten_shadows", label: "Ten Shadows", roleId: "" },
    ],
    historicalRoleIds: {
      honored_one: "role-historical-ignored",
      vessel: "role-vessel-historical",
    },
    generatedRoleIds: {
      honored_one: "role-generated",
      vessel: "role-vessel-generated",
      ten_shadows: "role-ten-generated",
      crowd_charmer: "role-junk",
    },
  });

  assert.deepEqual(result, [
    { id: "honored_one", label: "Honored One", roleId: "role-configured" },
    { id: "vessel", label: "Vessel", roleId: "role-vessel-historical" },
    { id: "ten_shadows", label: "Ten Shadows", roleId: "role-ten-generated" },
  ]);
});

test("buildHistoricalManagedCharacterRoleIds restores role ids from profiles and submissions", () => {
  const result = buildHistoricalManagedCharacterRoleIds({
    managedCharacters: [
      { id: "honored_one", label: "Honored One" },
      { id: "vessel", label: "Vessel" },
      { id: "ten_shadows", label: "Ten Shadows" },
    ],
    profiles: [
      {
        mainCharacterIds: ["honored_one", "vessel"],
        characterRoleIds: ["role-honored", "role-vessel"],
      },
      {
        mainCharacterIds: ["honored_one"],
        characterRoleIds: ["role-honored"],
      },
      {
        mainCharacterIds: ["outsider"],
        characterRoleIds: ["role-junk"],
      },
    ],
    submissions: [
      {
        mainCharacterIds: ["vessel"],
        mainRoleIds: ["role-vessel-submission"],
      },
      {
        mainCharacterIds: ["vessel", "ten_shadows"],
        mainRoleIds: ["role-vessel", "role-ten"],
      },
    ],
  });

  assert.deepEqual(result, {
    honored_one: "role-honored",
    vessel: "role-vessel",
    ten_shadows: "role-ten",
  });
});

test("buildHistoricalManagedCharacterUserIds tracks users per stable character id", () => {
  const result = buildHistoricalManagedCharacterUserIds({
    managedCharacters: [
      { id: "honored_one", label: "Honored One" },
      { id: "vessel", label: "Vessel" },
    ],
    profiles: {
      user_a: { mainCharacterIds: ["honored_one"] },
      user_b: { userId: "user_b", mainCharacterIds: ["vessel"] },
    },
    submissions: [
      { userId: "user_a", mainCharacterIds: ["vessel"] },
      { userId: "outsider", mainCharacterIds: ["other_character"] },
    ],
  });

  assert.deepEqual(result, {
    honored_one: ["user_a"],
    vessel: ["user_b", "user_a"],
  });
});

test("buildManagedCharacterRoleRecoveryPlan restores surviving roles and live role names", () => {
  const result = buildManagedCharacterRoleRecoveryPlan({
    managedCharacters: [
      { id: "honored_one", label: "Honored One" },
      { id: "vessel", label: "Vessel" },
      { id: "ten_shadows", label: "Ten Shadows" },
    ],
    profiles: {
      user_1: { mainCharacterIds: ["honored_one"] },
      user_2: { mainCharacterIds: ["honored_one"] },
      user_3: { mainCharacterIds: ["vessel"] },
      user_4: { mainCharacterIds: ["ten_shadows"] },
    },
    submissions: [
      { userId: "user_3", mainCharacterIds: ["vessel"] },
    ],
    guildRoles: [
      { id: "role_gojo", name: "Годжо", memberUserIds: ["user_1", "user_2"] },
      { id: "role_yuji", name: "Юджи", memberUserIds: ["user_3"] },
      { id: "role_megumi", name: "Мегуми", memberUserIds: ["user_4"] },
      { id: "role_noise", name: "Лишняя роль", memberUserIds: ["user_9"] },
    ],
  });

  assert.deepEqual(result.recoveredRoleIds, {
    honored_one: "role_gojo",
    vessel: "role_yuji",
    ten_shadows: "role_megumi",
  });
  assert.deepEqual(result.recoveredRoleLabels, {
    honored_one: "Годжо",
    vessel: "Юджи",
    ten_shadows: "Мегуми",
  });
  assert.deepEqual(result.ambiguous, []);
  assert.deepEqual(result.unresolved, []);
});

test("buildManagedCharacterRoleRecoveryPlan recovers a unique alias-named role without historical evidence", () => {
  const result = buildManagedCharacterRoleRecoveryPlan({
    managedCharacters: [
      {
        id: "aspiring_mangaka",
        label: "Aspiring Mangaka",
        evidence: { aliasNames: ["Чарльз", "Шарль"] },
      },
    ],
    guildRoles: [
      { id: "role_charles", name: "Чарльз", memberUserIds: [] },
    ],
  });

  assert.deepEqual(result.recoveredRoleIds, {
    aspiring_mangaka: "role_charles",
  });
  assert.deepEqual(result.recoveredRoleLabels, {
    aspiring_mangaka: "Чарльз",
  });
  assert.deepEqual(result.ambiguous, []);
  assert.deepEqual(result.unresolved, []);
});

test("buildManagedCharacterRoleRecoveryPlan keeps unresolved entries when overlap is ambiguous", () => {
  const result = buildManagedCharacterRoleRecoveryPlan({
    managedCharacters: [
      { id: "vessel", label: "Vessel" },
    ],
    profiles: {
      user_1: { mainCharacterIds: ["vessel"] },
      user_2: { mainCharacterIds: ["vessel"] },
    },
    guildRoles: [
      { id: "role_a", name: "Юджи", memberUserIds: ["user_1"] },
      { id: "role_b", name: "Сукуна", memberUserIds: ["user_2"] },
    ],
  });

  assert.deepEqual(result.recoveredRoleIds, {});
  assert.equal(result.ambiguous.length, 1);
  assert.equal(result.ambiguous[0].characterId, "vessel");
});