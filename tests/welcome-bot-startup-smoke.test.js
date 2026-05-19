"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
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

test("welcome-bot modal smoke covers SoT Activity and bot-helper submit wiring", () => {
  const repoRoot = path.join(__dirname, "..");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "welcome-bot-modal-smoke-"));
  const script = String.raw`
    const failures = [];
    const calls = [];

    process.env.DISCORD_TOKEN = "smoke-token";
    process.env.GUILD_ID = "123";
    process.env.BOT_DATA_DIR = ${JSON.stringify(tempDir)};
    process.env.DB_PATH = "welcome-db.json";

    function render(value) {
      try {
        return JSON.stringify(value, (_key, entry) => {
          if (typeof entry === "function") return "[function]";
          if (entry && typeof entry === "object" && entry.constructor && entry.constructor.name !== "Object" && !Array.isArray(entry)) {
            if (entry.data) return entry.data;
          }
          return entry;
        });
      } catch {
        return String(value);
      }
    }

    function recordFailure(error) {
      const text = error && typeof error === "object" && error.stack ? error.stack : String(error);
      failures.push(text);
    }

    process.on("uncaughtException", recordFailure);
    process.on("unhandledRejection", recordFailure);

    const originalConsoleError = console.error;
    console.error = (...args) => {
      const rendered = args.map((arg) => (arg && typeof arg === "object" && arg.stack) ? arg.stack : String(arg)).join(" ");
      if (/\bReferenceError\b|\bis not defined\b|not a function/i.test(rendered)) {
        failures.push(rendered);
      }
      originalConsoleError(...args);
    };

    const discord = require("discord.js");
    const originalEmit = discord.Client.prototype.emit;
    const role = {
      id: "123456789012345678",
      name: "Access Companion Smoke",
      managed: false,
      editable: true,
      members: new discord.Collection(),
    };
    const sentMessage = {
      id: "333333333333333333",
      channelId: "223456789012345678",
      createdAt: new Date("2026-05-19T00:00:00.000Z"),
      createdTimestamp: Date.parse("2026-05-19T00:00:00.000Z"),
      edit: async () => sentMessage,
      delete: async () => true,
    };
    const channel = {
      id: "223456789012345678",
      name: "bot-chat",
      guildId: "123",
      type: 0,
      isTextBased: () => true,
      messages: {
        fetch: async (query) => {
          if (query && typeof query === "object") return { first: () => sentMessage };
          if (String(query || "") === sentMessage.id) return sentMessage;
          return null;
        },
      },
      send: async () => sentMessage,
    };
    const channelCache = new discord.Collection([[channel.id, channel]]);
    const roleCache = new discord.Collection([[role.id, role]]);
    const memberCache = new discord.Collection();
    const guild = {
      id: "123",
      name: "smoke-guild",
      commands: { set: async (commands) => commands },
      channels: {
        cache: channelCache,
        fetch: async (channelId) => channelId ? (channelId === channel.id ? channel : null) : channelCache,
      },
      members: {
        cache: memberCache,
        fetch: async () => memberCache,
      },
      roles: {
        cache: roleCache,
        create: async (options = {}) => {
          const created = {
            id: String(900000000000000000n + BigInt(roleCache.size + 1)),
            name: String(options.name || "created-smoke-role"),
            managed: false,
            editable: true,
            members: new discord.Collection(),
          };
          roleCache.set(created.id, created);
          return created;
        },
        fetch: async (roleId) => roleId ? (roleId === role.id ? role : null) : roleCache,
      },
    };

    function makeModalInteraction(customId, fieldValues) {
      const interaction = {
        customId,
        commandName: "",
        user: { id: "999999999999999999", tag: "Smoke#0001", username: "Smoke" },
        member: {
          displayName: "Smoke",
          permissions: { has: () => true },
          roles: { cache: new discord.Collection() },
        },
        guild,
        client: null,
        deferred: false,
        replied: false,
        fields: {
          getTextInputValue(fieldId) {
            if (!Object.prototype.hasOwnProperty.call(fieldValues, fieldId)) {
              throw new Error("missing modal field " + fieldId);
            }
            return fieldValues[fieldId];
          },
        },
        isModalSubmit: () => true,
        isButton: () => false,
        isStringSelectMenu: () => false,
        isChatInputCommand: () => false,
        async reply(payload) {
          interaction.replied = true;
          calls.push([customId, "reply", render(payload)]);
          return payload;
        },
        async deferReply(payload) {
          interaction.deferred = true;
          calls.push([customId, "deferReply", render(payload)]);
          return payload;
        },
        async editReply(payload) {
          calls.push([customId, "editReply", render(payload)]);
          return payload;
        },
        async followUp(payload) {
          calls.push([customId, "followUp", render(payload)]);
          return payload;
        },
      };
      return interaction;
    }

    discord.Client.prototype.login = function login() {
      this.user = { id: "1", tag: "SmokeBot#0001" };
      this.guilds = { fetch: async () => guild };
      this.channels = { cache: channelCache, fetch: async (channelId) => channelId === channel.id ? channel : null };
      this.users = { fetch: async () => ({ send: async () => null }) };
      this.destroy = () => {};

      setImmediate(() => originalEmit.call(this, "clientReady"));
      setTimeout(() => {
        const interactions = [
          makeModalInteraction("sot_report_manual_role_modal", {
            sot_manual_role_slot: "accessCompanion",
            sot_manual_role_id: role.id,
          }),
          makeModalInteraction("activity_panel_config_roles_secondary_modal", {
            activity_role_floating: "1502643572468617347",
            activity_role_weak: "1502644337928962049",
            activity_role_newcomer: "",
            activity_role_dead: "1502644583543083150",
          }),
          makeModalInteraction("panel_config_bot_helper_modal", {
            panel_channel_bot_helper: channel.id,
          }),
        ];

        for (const interaction of interactions) {
          interaction.client = this;
          originalEmit.call(this, "interactionCreate", interaction);
        }
      }, 150);

      setTimeout(() => {
        const renderedCalls = calls.map((entry) => entry.join(" ")).join("\n");
        if (/\bReferenceError\b|\bis not defined\b|normalizeNativeRoleSlot|normalizeNativePanelSlot|clearNativePanelRecord|writeNativePanelRecord|not a function/i.test(renderedCalls)) {
          failures.push(renderedCalls);
        }

        for (const customId of ["sot_report_manual_role_modal", "activity_panel_config_roles_secondary_modal", "panel_config_bot_helper_modal"]) {
          if (!calls.some((entry) => entry[0] === customId && ["reply", "deferReply", "editReply", "followUp"].includes(entry[1]))) {
            failures.push("no response for " + customId);
          }
        }

        if (failures.length) {
          console.error(failures.join("\n---\n"));
          process.exit(1);
          return;
        }

        console.log("modal-smoke-ok");
        process.exit(0);
      }, 1600);

      return Promise.resolve("smoke-login");
    };

    require("./welcome-bot.js");
  `;

  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 20000,
  });

  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Best effort cleanup for Windows temp files held briefly by the child process.
  }

  if (result.error) {
    throw result.error;
  }

  assert.equal(
    result.status,
    0,
    `modal smoke failed\nstdout:\n${result.stdout || ""}\nstderr:\n${result.stderr || ""}`
  );
  assert.match(
    result.stdout || "",
    /modal-smoke-ok/,
    `expected modal smoke marker\nstdout:\n${result.stdout || ""}\nstderr:\n${result.stderr || ""}`
  );
});