"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { getInfluenceTierValue, resolveInfluence, resolveLegacyInfluenceConfig } = require("../src/sot/resolver/influence");

test("resolveInfluence prefers persisted db.sot values and normalizes missing tiers", () => {
  const result = resolveInfluence({
    db: {
      sot: {
        influence: {
          default: 2,
          tiers: {
            3: 7,
          },
        },
      },
    },
  });

  assert.equal(result.default, 2);
  assert.equal(result.tiers[3], 7);
  assert.equal(result.tiers[1], 2);
});

test("getInfluenceTierValue falls back to the default multiplier for unknown tiers", () => {
  const context = {
    influence: {
      default: 1.5,
      tiers: {
        2: 5,
      },
    },
  };

  assert.equal(getInfluenceTierValue(2, context), 5);
  assert.equal(getInfluenceTierValue(9, context), 1.5);
  assert.equal(getInfluenceTierValue("bad", context), 1.5);
});

test("resolveInfluence accepts legacy flat tier config without losing explicit values", () => {
  const result = resolveInfluence({
    influence: {
      default: 1.25,
      1: 2.25,
      2: 2.75,
      3: 3.25,
      4: 3.75,
      5: 4.25,
    },
  });

  assert.equal(result.default, 1.25);
  assert.equal(result.tiers[1], 2.25);
  assert.equal(result.tiers[5], 4.25);
});

test("resolveLegacyInfluenceConfig flattens db.sot influence for legacy callers", () => {
  const result = resolveLegacyInfluenceConfig({
    db: {
      sot: {
        influence: {
          default: 2,
          tiers: {
            1: 4,
            3: 7,
          },
        },
      },
    },
  });

  assert.deepEqual(result, {
    default: 2,
    1: 4,
    2: 2.5,
    3: 7,
    4: 3.5,
    5: 4,
  });
});