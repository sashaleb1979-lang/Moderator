"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeOutlineRules,
  resolveGraphicOutlineRule,
} = require("../graphic-tierlist");

test("normalizeOutlineRules keeps per-role colors and lets the latest duplicate win", () => {
  assert.deepEqual(normalizeOutlineRules([
    { roleId: "1498650315631628318", color: "#111111" },
    { roleId: "1498650315631628320", color: "bad-color" },
    { roleId: "1498650315631628318", color: "#222222" },
  ], "#abcdef"), [
    { roleId: "1498650315631628318", color: "#222222" },
    { roleId: "1498650315631628320", color: "#abcdef" },
  ]);
});

test("resolveGraphicOutlineRule returns the first matching configured role color", async () => {
  const guild = {
    members: {
      cache: new Map([
        ["user-1", {
          roles: {
            cache: new Map([
              ["1498650315631628320", {}],
              ["1498650315631628318", {}],
            ]),
          },
        }],
      ]),
      fetch: async () => null,
    },
  };

  const rule = await resolveGraphicOutlineRule(guild, "user-1", [
    { roleId: "1498650315631628322", color: "#333333" },
    { roleId: "1498650315631628318", color: "#111111" },
    { roleId: "1498650315631628320", color: "#222222" },
  ]);

  assert.deepEqual(rule, { roleId: "1498650315631628318", color: "#111111" });
});