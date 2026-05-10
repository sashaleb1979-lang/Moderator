"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { estimateNavigationMessageCount } = require("../src/combo-guide/publisher");

function makeCharacters(count) {
  return Array.from({ length: count }, (_, index) => ({
    emoji: "🔹",
    name: `Character ${index + 1}`,
  }));
}

test("publisher reserves exact top navigation placeholder count", () => {
  assert.equal(estimateNavigationMessageCount(makeCharacters(19), "1", "2"), 1);
  assert.equal(estimateNavigationMessageCount(makeCharacters(26), "1", "2"), 1);
  assert.equal(estimateNavigationMessageCount(makeCharacters(27), "1", "2"), 2);
});