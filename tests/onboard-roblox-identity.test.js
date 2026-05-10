"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  canManageWelcomeRobloxIdentity,
  getWelcomeRobloxIdentityLockText,
  hasConfirmedRobloxIdentity,
} = require("../src/onboard/roblox-identity");

test("hasConfirmedRobloxIdentity requires both username and user id", () => {
  assert.equal(hasConfirmedRobloxIdentity({ robloxUsername: "KolhozU", robloxUserId: "9843941555" }), true);
  assert.equal(hasConfirmedRobloxIdentity({ robloxUsername: "KolhozU", robloxUserId: "" }), false);
  assert.equal(hasConfirmedRobloxIdentity({ robloxUsername: "", robloxUserId: "9843941555" }), false);
});

test("canManageWelcomeRobloxIdentity allows adding a missing Roblox identity", () => {
  assert.equal(canManageWelcomeRobloxIdentity({
    session: { robloxUsername: "", robloxUserId: "" },
    pending: null,
  }), true);
  assert.equal(getWelcomeRobloxIdentityLockText({
    session: { robloxUsername: "", robloxUserId: "" },
    pending: null,
  }), null);
});

test("canManageWelcomeRobloxIdentity blocks regular users from changing a confirmed identity", () => {
  assert.equal(canManageWelcomeRobloxIdentity({
    session: { robloxUsername: "KolhozU", robloxUserId: "9843941555" },
    pending: null,
  }), false);
  assert.match(getWelcomeRobloxIdentityLockText({
    session: { robloxUsername: "KolhozU", robloxUserId: "9843941555" },
    pending: null,
  }), /может только админ/i);
  assert.equal(canManageWelcomeRobloxIdentity({
    session: null,
    pending: { robloxUsername: "KolhozU", robloxUserId: "9843941555" },
  }), false);
});

test("canManageWelcomeRobloxIdentity allows admin override for confirmed identity", () => {
  assert.equal(canManageWelcomeRobloxIdentity({
    session: { robloxUsername: "KolhozU", robloxUserId: "9843941555" },
    pending: null,
    canManage: true,
  }), true);
  assert.equal(getWelcomeRobloxIdentityLockText({
    session: { robloxUsername: "KolhozU", robloxUserId: "9843941555" },
    pending: null,
    canManage: true,
  }), null);
});