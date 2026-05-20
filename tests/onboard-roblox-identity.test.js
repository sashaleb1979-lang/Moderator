"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildProfileRobloxIdentitySession,
  canManageWelcomeRobloxIdentity,
  getWelcomeRobloxIdentityLockText,
  hasConfirmedRobloxIdentity,
  parseRobloxIdentityInput,
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

test("buildProfileRobloxIdentitySession keeps user id only for verified profile states", () => {
  assert.deepEqual(buildProfileRobloxIdentitySession({
    currentUsername: "KolhozU",
    currentDisplayName: "Kolhoz",
    userId: "9843941555",
    verificationStatus: "verified",
  }), {
    robloxUsername: "KolhozU",
    robloxUserId: "9843941555",
    robloxDisplayName: "Kolhoz",
  });

  assert.deepEqual(buildProfileRobloxIdentitySession({
    currentUsername: "KolhozU",
    currentDisplayName: "Kolhoz",
    userId: "9843941555",
    verificationStatus: "unverified",
  }), {
    robloxUsername: "",
    robloxUserId: "",
    robloxDisplayName: "",
  });

  assert.deepEqual(buildProfileRobloxIdentitySession({
    currentUsername: "KolhozU",
    currentDisplayName: "Kolhoz",
    userId: "9843941555",
    verifiedAt: "2026-05-19T10:00:00.000Z",
  }), {
    robloxUsername: "KolhozU",
    robloxUserId: "9843941555",
    robloxDisplayName: "Kolhoz",
  });

  assert.deepEqual(buildProfileRobloxIdentitySession({
    currentUsername: "KolhozU",
    currentDisplayName: "Kolhoz",
    userId: "9843941555",
    hasVerifiedAccount: true,
    verificationStatus: "failed",
  }), {
    robloxUsername: "",
    robloxUserId: "",
    robloxDisplayName: "",
  });

  assert.deepEqual(buildProfileRobloxIdentitySession({
    currentUsername: "KolhozU",
    currentDisplayName: "Kolhoz",
    userId: "not-a-number",
    verificationStatus: "verified",
  }), {
    robloxUsername: "",
    robloxUserId: "",
    robloxDisplayName: "",
  });

  assert.deepEqual(buildProfileRobloxIdentitySession({
    userId: "12345",
    username: "DiscordLikeName",
    displayName: "Discord Display",
    verifiedAt: "2026-05-19T10:00:00.000Z",
  }), {
    robloxUsername: "",
    robloxUserId: "",
    robloxDisplayName: "",
  });
});

test("parseRobloxIdentityInput accepts username, user id and Roblox profile URL", () => {
  assert.deepEqual(parseRobloxIdentityInput("Builderman"), {
    ok: true,
    kind: "username",
    username: "Builderman",
    fallbackUserId: "",
    source: "username",
    rawInput: "Builderman",
  });

  assert.deepEqual(parseRobloxIdentityInput("123456789"), {
    ok: true,
    kind: "username",
    username: "123456789",
    fallbackUserId: "123456789",
    source: "username_or_userId",
    rawInput: "123456789",
  });

  assert.deepEqual(parseRobloxIdentityInput("https://www.roblox.com/users/42/profile"), {
    ok: true,
    kind: "userId",
    userId: "42",
    source: "profile_url",
    rawInput: "https://www.roblox.com/users/42/profile",
  });
});

test("parseRobloxIdentityInput rejects unsupported text", () => {
  assert.equal(parseRobloxIdentityInput("").ok, false);
  assert.match(parseRobloxIdentityInput("not a valid roblox handle!").error, /username|userId|ссылку/i);
  assert.match(parseRobloxIdentityInput("https://example.com/users/42/profile").error, /username|userId|ссылку/i);
});

test("welcome-bot bootstraps resumable Roblox submit sessions through the shared identity helper", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "welcome-bot.js"), "utf8");
  const match = source.match(
    /function buildSubmitSessionBootstrap\([\s\S]*?const robloxIdentity = buildProfileRobloxIdentitySession\([\s\S]*?robloxUsername:\s*robloxIdentity\.robloxUsername \|\| ""[\s\S]*?robloxUserId:\s*robloxIdentity\.robloxUserId \|\| ""/
  );

  assert.ok(match, "expected resumable submit bootstrap to reuse buildProfileRobloxIdentitySession");
});