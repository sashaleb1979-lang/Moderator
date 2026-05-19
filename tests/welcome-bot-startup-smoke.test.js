"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("welcome-bot startup smoke completes clientReady without missing import regressions", () => {
  const repoRoot = path.join(__dirname, "..");
  const script = String.raw`
    process.env.DISCORD_TOKEN = "smoke-token";
    process.env.GUILD_ID = "123";

    const discord = require("discord.js");
    const originalEmit = discord.Client.prototype.emit;
    const originalConsoleError = console.error;
    let sawUndefinedReference = false;

    console.error = (...args) => {
      const rendered = args
        .map((arg) => (arg && typeof arg === "object" && arg.stack) ? arg.stack : String(arg))
        .join(" ");
      if (/\bReferenceError\b|\bis not defined\b/i.test(rendered)) {
        sawUndefinedReference = true;
      }
      originalConsoleError(...args);
    };

    discord.Client.prototype.login = function login() {
      const guild = {
        id: "123",
        name: "smoke-guild",
        commands: {
          set: async (commands) => commands,
        },
        channels: {
          fetch: async () => null,
          cache: new Map(),
        },
        members: {
          fetch: async () => null,
          cache: new Map(),
        },
        roles: {
          fetch: async () => ({ cache: new Map(), filter: () => new Map() }),
          create: async () => ({ id: "role-1", name: "stub-role" }),
          cache: {
            filter: () => new Map(),
            get: () => null,
            keys: () => [],
            values: () => [],
          },
        },
      };

      this.user = { id: "1", tag: "Smoke#0001" };
      this.guilds = { fetch: async () => guild };
      this.destroy = () => {};

      setImmediate(() => originalEmit.call(this, "clientReady"));
      setTimeout(() => process.exit(sawUndefinedReference ? 1 : 0), 1800);
      return Promise.resolve("smoke-login");
    };

    require("./welcome-bot.js");
  `;

  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 15000,
  });

  if (result.error) {
    throw result.error;
  }

  assert.equal(
    result.status,
    0,
    `startup smoke failed\nstdout:\n${result.stdout || ""}\nstderr:\n${result.stderr || ""}`
  );
  assert.match(
    result.stdout || "",
    /Welcome onboarding bot is ready/,
    `expected ready log in startup smoke\nstdout:\n${result.stdout || ""}\nstderr:\n${result.stderr || ""}`
  );
});