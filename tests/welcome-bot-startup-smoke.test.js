"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("welcome-bot startup smoke completes clientReady without missing import regressions", () => {
  const repoRoot = path.join(__dirname, "..");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "welcome-bot-startup-smoke-"));
  const script = String.raw`
    process.env.DISCORD_TOKEN = "smoke-token";
    process.env.GUILD_ID = "123";
    process.env.BOT_DATA_DIR = ${JSON.stringify(tempDir)};
    process.env.DB_PATH = "welcome-db.json";

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
    `startup smoke failed\nstdout:\n${result.stdout || ""}\nstderr:\n${result.stderr || ""}`
  );
  assert.match(
    result.stdout || "",
    /Welcome onboarding bot is ready/,
    `expected ready log in startup smoke\nstdout:\n${result.stdout || ""}\nstderr:\n${result.stderr || ""}`
  );
});

test("welcome-bot guildMemberAdd promotes manually removed newcomer to the scored tier", () => {
  const repoRoot = path.join(__dirname, "..");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "welcome-bot-rejoin-activity-smoke-"));
  fs.writeFileSync(path.join(tempDir, "welcome-db.json"), JSON.stringify({
    profiles: {
      "moderated-user": {
        userId: "moderated-user",
        domains: {
          activity: {
            appliedActivityRoleKey: "newcomer",
          },
        },
      },
    },
    sot: {
      activity: {
        config: {
          activityRoleIds: {
            newcomer: "role-newcomer",
            dead: "role-dead",
          },
        },
        watchedChannels: [],
        globalUserSessions: [],
        globalVoiceSessions: [],
        userChannelDailyStats: [],
        userVoiceDailyStats: [],
        userSnapshots: {},
        calibrationRuns: [],
        ops: { moderationAuditLog: [] },
        runtime: { openSessions: {}, openVoiceSessions: {}, dirtyUsers: [] },
      },
    },
  }, null, 2));

  const script = String.raw`
    process.env.DISCORD_TOKEN = "smoke-token";
    process.env.GUILD_ID = "123";
    process.env.BOT_DATA_DIR = ${JSON.stringify(tempDir)};
    process.env.DB_PATH = "welcome-db.json";

    const calls = [];
    const discord = require("discord.js");
    const originalEmit = discord.Client.prototype.emit;

    discord.Client.prototype.login = function login() {
      const guildRoles = new Map([
        ["123", { id: "123", name: "@everyone" }],
        ["role-newcomer", { id: "role-newcomer", name: "newcomer" }],
        ["role-dead", { id: "role-dead", name: "dead" }],
      ]);
      const roleCache = new Map([["123", { id: "123", name: "@everyone" }]]);
      const guildRoleCache = {
        filter(predicate) {
          return new Map([...guildRoles].filter(([, role]) => predicate(role)));
        },
        get(roleId) {
          return guildRoles.get(roleId) || null;
        },
        has(roleId) {
          return guildRoles.has(roleId);
        },
        keys() {
          return guildRoles.keys();
        },
        values() {
          return guildRoles.values();
        },
      };
      const member = {
        id: "moderated-user",
        displayName: "Moderated User",
        joinedAt: new Date("2026-05-28T10:00:00.000Z"),
        user: {
          id: "moderated-user",
          bot: false,
          tag: "Moderated#0001",
          username: "Moderated",
        },
        roles: {
          cache: roleCache,
          async remove(roleIds, reason) {
            calls.push(["remove", roleIds, reason]);
            for (const roleId of Array.isArray(roleIds) ? roleIds : [roleIds]) {
              roleCache.delete(roleId);
            }
          },
          async add(roleIds, reason) {
            calls.push(["add", roleIds, reason]);
            for (const roleId of Array.isArray(roleIds) ? roleIds : [roleIds]) {
              roleCache.set(roleId, { id: roleId, name: roleId });
            }
          },
        },
        send: async () => {},
      };
      const guild = {
        id: "123",
        name: "smoke-guild",
        commands: { set: async (commands) => commands },
        channels: {
          fetch: async () => null,
          cache: new Map(),
        },
        members: {
          cache: new Map([["moderated-user", member]]),
          fetch: async (userId) => userId === "moderated-user" ? member : null,
        },
        roles: {
          fetch: async () => ({ cache: guildRoleCache, filter: guildRoleCache.filter }),
          create: async () => ({ id: "role-created", name: "stub-role" }),
          cache: guildRoleCache,
        },
      };
      member.guild = guild;
      this.user = { id: "1", tag: "Smoke#0001" };
      this.guilds = { fetch: async () => guild };
      this.channels = { cache: new Map(), fetch: async () => null };
      this.destroy = () => {};

      setImmediate(() => originalEmit.call(this, "guildMemberAdd", member));
      setTimeout(() => {
        const rendered = JSON.stringify(calls);
        const addedDead = calls.some((entry) => entry[0] === "add" && String(entry[1]).includes("role-dead"));
        const addedNewcomer = calls.some((entry) => entry[0] === "add" && String(entry[1]).includes("role-newcomer"));
        const removedNewcomer = calls.some((entry) => entry[0] === "remove" && String(entry[1]).includes("role-newcomer"));
        if (!addedDead || removedNewcomer || addedNewcomer) {
          console.error("unexpected activity role calls:", rendered);
          process.exit(1);
        }
        console.log("activity-manual-newcomer-smoke-ok", rendered);
        process.exit(0);
      }, 1200);
      return Promise.resolve("smoke-login");
    };

    require("./welcome-bot.js");
  `;

  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 15000,
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
    `activity join smoke failed\nstdout:\n${result.stdout || ""}\nstderr:\n${result.stderr || ""}`
  );
  assert.match(
    result.stdout || "",
    /activity-manual-newcomer-smoke-ok/,
    `expected activity join smoke marker\nstdout:\n${result.stdout || ""}\nstderr:\n${result.stderr || ""}`
  );
});

test("welcome-bot guildMemberAdd keeps returning-member evidence from news moderation when activity mirror is missing", () => {
  const repoRoot = path.join(__dirname, "..");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "welcome-bot-rejoin-trace-smoke-"));
  fs.writeFileSync(path.join(tempDir, "welcome-db.json"), JSON.stringify({
    profiles: {
      "returning-user": {
        userId: "returning-user",
      },
    },
    sot: {
      activity: {
        config: {
          activityRoleIds: {
            newcomer: "role-newcomer",
            dead: "role-dead",
          },
        },
        watchedChannels: [],
        globalUserSessions: [],
        globalVoiceSessions: [],
        userChannelDailyStats: [],
        userVoiceDailyStats: [],
        userSnapshots: {},
        calibrationRuns: [],
        ops: { moderationAuditLog: [] },
        runtime: { openSessions: {}, openVoiceSessions: {}, dirtyUsers: [] },
      },
      news: {
        moderation: {
          events: [
            {
              eventType: "member_remove",
              userId: "returning-user",
              occurredAt: "2026-05-27T10:00:00.000Z",
              resolution: "left_server",
            },
          ],
        },
      },
    },
  }, null, 2));

  const script = String.raw`
    process.env.DISCORD_TOKEN = "smoke-token";
    process.env.GUILD_ID = "123";
    process.env.BOT_DATA_DIR = ${JSON.stringify(tempDir)};
    process.env.DB_PATH = "welcome-db.json";

    const fs = require("node:fs");
    const path = require("node:path");
    const discord = require("discord.js");
    const originalEmit = discord.Client.prototype.emit;

    discord.Client.prototype.login = function login() {
      const guildRoles = new Map([
        ["123", { id: "123", name: "@everyone" }],
        ["role-newcomer", { id: "role-newcomer", name: "newcomer" }],
        ["role-dead", { id: "role-dead", name: "dead" }],
      ]);
      const roleCache = new Map([["123", { id: "123", name: "@everyone" }]]);
      const guildRoleCache = {
        filter(predicate) {
          return new Map([...guildRoles].filter(([, role]) => predicate(role)));
        },
        get(roleId) {
          return guildRoles.get(roleId) || null;
        },
        has(roleId) {
          return guildRoles.has(roleId);
        },
        keys() {
          return guildRoles.keys();
        },
        values() {
          return guildRoles.values();
        },
      };
      const member = {
        id: "returning-user",
        displayName: "Returning User",
        joinedAt: new Date("2026-05-28T10:00:00.000Z"),
        user: {
          id: "returning-user",
          bot: false,
          tag: "Returning#0001",
          username: "Returning",
        },
        roles: {
          cache: roleCache,
          async remove(roleIds) {
            for (const roleId of Array.isArray(roleIds) ? roleIds : [roleIds]) {
              roleCache.delete(roleId);
            }
          },
          async add(roleIds) {
            for (const roleId of Array.isArray(roleIds) ? roleIds : [roleIds]) {
              roleCache.set(roleId, { id: roleId, name: roleId });
            }
          },
        },
        send: async () => {},
      };
      const guild = {
        id: "123",
        name: "smoke-guild",
        commands: { set: async (commands) => commands },
        channels: {
          fetch: async () => null,
          cache: new Map(),
        },
        members: {
          cache: new Map([["returning-user", member]]),
          fetch: async (userId) => userId === "returning-user" ? member : null,
        },
        roles: {
          fetch: async () => ({ cache: guildRoleCache, filter: guildRoleCache.filter }),
          create: async () => ({ id: "role-created", name: "stub-role" }),
          cache: guildRoleCache,
        },
      };
      member.guild = guild;
      this.user = { id: "1", tag: "Smoke#0001" };
      this.guilds = { fetch: async () => guild };
      this.channels = { cache: new Map(), fetch: async () => null };
      this.destroy = () => {};

      setImmediate(() => originalEmit.call(this, "guildMemberAdd", member));
      setTimeout(() => {
        const dbPath = path.join(process.env.BOT_DATA_DIR, process.env.DB_PATH);
        const db = JSON.parse(fs.readFileSync(dbPath, "utf8"));
        const activity = db.profiles?.["returning-user"]?.domains?.activity || {};
        if (activity.returningMember !== true || Number(activity.guildJoinCount) < 2) {
          console.error("unexpected returning trace state:", JSON.stringify(activity));
          process.exit(1);
        }
        console.log("activity-rejoin-trace-smoke-ok", JSON.stringify({ returningMember: activity.returningMember, guildJoinCount: activity.guildJoinCount }));
        process.exit(0);
      }, 1200);
      return Promise.resolve("smoke-login");
    };

    require("./welcome-bot.js");
  `;

  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 15000,
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
    `activity rejoin trace smoke failed\nstdout:\n${result.stdout || ""}\nstderr:\n${result.stderr || ""}`
  );
  assert.match(
    result.stdout || "",
    /activity-rejoin-trace-smoke-ok/,
    `expected activity rejoin trace smoke marker\nstdout:\n${result.stdout || ""}\nstderr:\n${result.stderr || ""}`
  );
});

test("welcome-bot clientReady auto-repairs fresh newcomers without a manual command", () => {
  const repoRoot = path.join(__dirname, "..");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "welcome-bot-auto-newcomer-repair-"));
  fs.writeFileSync(path.join(tempDir, "welcome-db.json"), JSON.stringify({
    profiles: {
      "fresh-user": {
        userId: "fresh-user",
        domains: {
          activity: {
            appliedActivityRoleKey: "dead",
          },
        },
      },
    },
    sot: {
      activity: {
        config: {
          activityRoleIds: {
            newcomer: "role-newcomer",
            dead: "role-dead",
          },
        },
        watchedChannels: [],
        globalUserSessions: [],
        globalVoiceSessions: [],
        userChannelDailyStats: [],
        userVoiceDailyStats: [],
        userSnapshots: {},
        calibrationRuns: [],
        ops: { moderationAuditLog: [] },
        runtime: { openSessions: {}, openVoiceSessions: {}, dirtyUsers: [] },
      },
    },
  }, null, 2));

  const script = String.raw`
    process.env.DISCORD_TOKEN = "smoke-token";
    process.env.GUILD_ID = "123";
    process.env.BOT_DATA_DIR = ${JSON.stringify(tempDir)};
    process.env.DB_PATH = "welcome-db.json";
    process.env.ACTIVITY_FRESH_NEWCOMER_REPAIR_INITIAL_DELAY_MS = "0";

    const calls = [];
    const discord = require("discord.js");
    const originalEmit = discord.Client.prototype.emit;

    discord.Client.prototype.login = function login() {
      const guildRoles = new Map([
        ["123", { id: "123", name: "@everyone" }],
        ["role-newcomer", { id: "role-newcomer", name: "newcomer" }],
        ["role-dead", { id: "role-dead", name: "dead" }],
      ]);
      const roleCache = new Map([
        ["123", { id: "123", name: "@everyone" }],
        ["role-dead", { id: "role-dead", name: "dead" }],
      ]);
      const guildRoleCache = {
        filter(predicate) {
          return new Map([...guildRoles].filter(([, role]) => predicate(role)));
        },
        get(roleId) {
          return guildRoles.get(roleId) || null;
        },
        has(roleId) {
          return guildRoles.has(roleId);
        },
        keys() {
          return guildRoles.keys();
        },
        values() {
          return guildRoles.values();
        },
      };
      const member = {
        id: "fresh-user",
        displayName: "Fresh User",
        joinedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        user: {
          id: "fresh-user",
          bot: false,
          tag: "Fresh#0001",
          username: "Fresh",
        },
        roles: {
          cache: roleCache,
          async remove(roleIds, reason) {
            calls.push(["remove", roleIds, reason]);
            for (const roleId of Array.isArray(roleIds) ? roleIds : [roleIds]) {
              roleCache.delete(roleId);
            }
          },
          async add(roleIds, reason) {
            calls.push(["add", roleIds, reason]);
            for (const roleId of Array.isArray(roleIds) ? roleIds : [roleIds]) {
              roleCache.set(roleId, { id: roleId, name: roleId });
            }
          },
        },
        send: async () => {},
      };
      const guild = {
        id: "123",
        name: "smoke-guild",
        commands: { set: async (commands) => commands },
        channels: {
          fetch: async () => null,
          cache: new Map(),
        },
        members: {
          cache: new Map([["fresh-user", member]]),
          fetch: async (userId) => userId ? (userId === "fresh-user" ? member : null) : { cache: new Map([["fresh-user", member]]) },
        },
        roles: {
          fetch: async () => ({ cache: guildRoleCache, filter: guildRoleCache.filter }),
          create: async () => ({ id: "role-created", name: "stub-role" }),
          cache: guildRoleCache,
        },
      };
      member.guild = guild;
      this.user = { id: "1", tag: "Smoke#0001" };
      this.guilds = { fetch: async () => guild };
      this.channels = { cache: new Map(), fetch: async () => null };
      this.destroy = () => {};

      setImmediate(() => originalEmit.call(this, "clientReady"));
      setTimeout(() => {
        const rendered = JSON.stringify(calls);
        const addedNewcomer = calls.some((entry) => entry[0] === "add" && String(entry[1]).includes("role-newcomer"));
        const removedDead = calls.some((entry) => entry[0] === "remove" && String(entry[1]).includes("role-dead"));
        if (!addedNewcomer || !removedDead) {
          console.error("unexpected auto repair role calls:", rendered);
          process.exit(1);
        }
        console.log("activity-auto-newcomer-repair-ok", rendered);
        process.exit(0);
      }, 2200);
      return Promise.resolve("smoke-login");
    };

    require("./welcome-bot.js");
  `;

  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 15000,
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
    `auto newcomer repair smoke failed\nstdout:\n${result.stdout || ""}\nstderr:\n${result.stderr || ""}`
  );
  assert.match(
    result.stdout || "",
    /activity-auto-newcomer-repair-ok/,
    `expected auto newcomer repair marker\nstdout:\n${result.stdout || ""}\nstderr:\n${result.stderr || ""}`
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

test("welcome-bot profile smoke covers helper open, self, other and compact-card routes", () => {
  const repoRoot = path.join(__dirname, "..");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "welcome-bot-profile-smoke-"));
  const script = String.raw`
    const fs = require("node:fs");
    const path = require("node:path");

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
            if (typeof entry.toJSON === "function") return entry.toJSON();
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

    const dbPath = path.join(process.env.BOT_DATA_DIR, process.env.DB_PATH);
    fs.mkdirSync(process.env.BOT_DATA_DIR, { recursive: true });
    fs.writeFileSync(dbPath, JSON.stringify({
      profiles: {
        "user-1": {
          displayName: "Smoke Self",
          username: "SmokeSelf",
          approvedKills: 120,
          killTier: 4,
          accessGrantedAt: "2026-05-01T10:00:00.000Z",
          mainCharacterIds: ["honored_one"],
          summary: {
            onboarding: { approvedKills: 120, killTier: 4 },
            activity: {
              desiredActivityRoleKey: "active",
              appliedActivityRoleKey: "active",
              activityScore: 77,
              messages7d: 35,
              messages30d: 210
            },
            roblox: {
              hasVerifiedAccount: true,
              currentUsername: "SmokeSelf",
              profileUrl: "https://www.roblox.com/users/1/profile",
              avatarUrl: "https://tr.rbxcdn.com/self.png"
            },
            verification: {
              status: "verified",
              decision: "approved"
            }
          }
        },
        "user-2": {
          displayName: "Smoke Target",
          username: "SmokeTarget",
          approvedKills: 200,
          killTier: 5,
          accessGrantedAt: "2026-05-01T10:00:00.000Z",
          mainCharacterIds: ["vessel"],
          summary: {
            onboarding: { approvedKills: 200, killTier: 5 },
            activity: {
              desiredActivityRoleKey: "active",
              appliedActivityRoleKey: "active",
              activityScore: 84,
              messages7d: 42,
              messages30d: 260
            },
            roblox: {
              hasVerifiedAccount: true,
              currentUsername: "SmokeTarget",
              profileUrl: "https://www.roblox.com/users/2/profile",
              avatarUrl: "https://tr.rbxcdn.com/target.png"
            },
            verification: {
              status: "verified",
              decision: "approved"
            }
          }
        }
      },
      submissions: {
        "sub-1": {
          id: "sub-1",
          userId: "user-1",
          status: "approved",
          kills: 120,
          reviewedAt: "2026-05-10T00:00:00.000Z",
          reviewedBy: "SmokeMod#0001",
          mainCharacterIds: ["honored_one"]
        },
        "sub-2": {
          id: "sub-2",
          userId: "user-2",
          status: "approved",
          kills: 200,
          reviewedAt: "2026-05-11T00:00:00.000Z",
          reviewedBy: "SmokeMod#0001",
          mainCharacterIds: ["vessel"]
        },
        "sub-pending": {
          id: "sub-pending",
          userId: "user-1",
          status: "pending",
          kills: 150,
          createdAt: "2026-05-20T00:00:00.000Z",
          mainCharacterIds: ["honored_one"]
        }
      },
      cooldowns: {},
      sot: {}
    }, null, 2));

    const originalConsoleError = console.error;
    console.error = (...args) => {
      const rendered = args.map((arg) => (arg && typeof arg === "object" && arg.stack) ? arg.stack : String(arg)).join(" ");
      if (/\bReferenceError\b|\bis not defined\b|not a function/i.test(rendered)) {
        failures.push(rendered);
      }
      originalConsoleError(...args);
    };

    const discord = require("discord.js");
    const { buildProfileOpenCustomId } = require("./src/profile/entry");
    const { BOT_HELPER_PANEL_ACTION_IDS } = require("./src/onboard/bot-helper-panel");
    const originalEmit = discord.Client.prototype.emit;

    function makeUser(id, username, options = {}) {
      return {
        id,
        username,
        globalName: options.globalName || username,
        tag: options.tag || username + "#0001",
        primaryGuild: options.primaryGuild || undefined,
        displayAvatarURL: () => "https://cdn.discordapp.com/avatars/" + id + "/profile.png",
      };
    }

    function makeMember(user, displayName) {
      const roleState = new discord.Collection();
      return {
        id: user.id,
        user,
        guild: { id: "123" },
        displayName,
        permissions: { has: () => false },
        roles: {
          cache: roleState,
          add: async (roleIds) => {
            const ids = Array.isArray(roleIds) ? roleIds : [roleIds];
            for (const roleId of ids) {
              const normalizedRoleId = String(roleId || "").trim();
              if (!normalizedRoleId) continue;
              roleState.set(normalizedRoleId, roleCache.get(normalizedRoleId) || { id: normalizedRoleId, position: 0 });
            }
            return true;
          },
          remove: async (roleIds) => {
            const ids = Array.isArray(roleIds) ? roleIds : [roleIds];
            for (const roleId of ids) {
              roleState.delete(String(roleId || "").trim());
            }
            return true;
          },
        },
      };
    }

    const requesterUser = makeUser("user-1", "SmokeSelf", {
      primaryGuild: { tag: "TAG", identityEnabled: true },
    });
    const targetUser = makeUser("user-2", "SmokeTarget");
    const userCache = new Map([
      [requesterUser.id, requesterUser],
      [targetUser.id, targetUser],
    ]);

    const requesterMember = makeMember(requesterUser, "Smoke Self");
    const targetMember = makeMember(targetUser, "Smoke Target");
    const memberCache = new discord.Collection([
      [requesterMember.id, requesterMember],
      [targetMember.id, targetMember],
    ]);
    const roleCache = new discord.Collection();
    const channelCache = new discord.Collection();
    const guild = {
      id: "123",
      name: "smoke-guild",
      commands: { set: async (commands) => commands },
      channels: {
        cache: channelCache,
        fetch: async (channelId) => channelId ? (channelCache.get(channelId) || null) : channelCache,
      },
      members: {
        cache: memberCache,
        fetch: async (userId) => userId ? (memberCache.get(userId) || null) : memberCache,
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
        fetch: async (roleId) => roleId ? (roleCache.get(roleId) || null) : roleCache,
      },
    };

    function pushCall(label, step, payload) {
      calls.push([label, step, render(payload)]);
    }

    function makeCommandInteraction(label, target) {
      return {
        commandName: "профиль",
        channelId: "profile-room",
        user: requesterUser,
        member: requesterMember,
        options: {
          getUser(name) {
            if (name !== "target") throw new Error("unexpected option " + name);
            return target || null;
          },
        },
        isChatInputCommand: () => true,
        isButton: () => false,
        isStringSelectMenu: () => false,
        isModalSubmit: () => false,
        reply: async (payload) => pushCall(label, "reply", payload),
        deferReply: async (payload) => pushCall(label, "deferReply", payload),
        editReply: async (payload) => pushCall(label, "editReply", payload),
      };
    }

    function makeButtonInteraction(label, customId, options = {}) {
      return {
        customId,
        user: requesterUser,
        member: requesterMember,
        guild,
        message: options.message || null,
        isChatInputCommand: () => false,
        isButton: () => true,
        isStringSelectMenu: () => false,
        isModalSubmit: () => false,
        reply: async (payload) => pushCall(label, "reply", payload),
        deferReply: async (payload) => pushCall(label, "deferReply", payload),
        editReply: async (payload) => pushCall(label, "editReply", payload),
        deferUpdate: async () => pushCall(label, "deferUpdate", "ok"),
        showModal: async (payload) => pushCall(label, "showModal", payload),
      };
    }

    discord.Client.prototype.login = function login() {
      this.user = { id: "1", tag: "SmokeBot#0001" };
      this.guilds = { fetch: async () => guild };
      this.channels = { cache: channelCache, fetch: async (channelId) => channelId ? (channelCache.get(channelId) || null) : null };
      this.users = {
        fetch: async (userId) => userCache.get(String(userId || "")) || makeUser(String(userId || "unknown"), "User" + String(userId || "unknown")),
      };
      this.destroy = () => {};

      setImmediate(() => originalEmit.call(this, "clientReady"));

      setTimeout(() => {
        const helperMessage = {
          content: "профиль",
          author: { ...requesterUser, bot: false },
          member: requesterMember,
          guildId: "123",
          channelId: "profile-room",
          createdAt: new Date("2026-05-20T00:00:00.000Z"),
          attachments: new discord.Collection(),
          mentions: { users: new discord.Collection() },
          reference: null,
          reply: async (payload) => {
            pushCall("helper", "reply", payload);
            return {
              id: "helper-reply",
              delete: async () => {
                pushCall("helper", "delete", "ok");
                return true;
              },
            };
          },
        };

        const interactions = [
          makeButtonInteraction("profile_open", buildProfileOpenCustomId(requesterUser.id, requesterUser.id), {
            message: {
              delete: async () => {
                pushCall("profile_open", "deleteMessage", "ok");
                return true;
              },
            },
          }),
          makeCommandInteraction("profile_other", targetUser),
          makeButtonInteraction("compact_card", "elo_submit_card"),
          makeButtonInteraction("helper_roblox", BOT_HELPER_PANEL_ACTION_IDS.roblox),
        ];

        originalEmit.call(this, "messageCreate", helperMessage);
        for (const interaction of interactions) {
          originalEmit.call(this, "interactionCreate", interaction);
        }
      }, 150);

      setTimeout(() => {
        const renderedCalls = calls.map((entry) => entry.join(" ")).join("\n");
        if (/\bReferenceError\b|\bis not defined\b|not a function/i.test(renderedCalls)) {
          failures.push(renderedCalls);
        }

        if (!calls.some((entry) => entry[0] === "helper" && entry[1] === "reply" && /profile_open:user-1:user-1/.test(entry[2]) && /Открыть свой профиль/.test(entry[2]))) {
          failures.push("profile helper route did not publish the self-open payload");
        }

        if (!calls.some((entry) => entry[0] === "profile_open" && entry[1] === "editReply" && /# Твой профиль/.test(entry[2]))) {
          failures.push("profile open button did not render the private self profile");
        }

        if (!calls.some((entry) => entry[0] === "profile_other" && entry[1] === "editReply" && /# Профиль/.test(entry[2]) && /Smoke Target/.test(entry[2]))) {
          failures.push("profile slash command did not render the other profile payload");
        }

        const compactCardCall = calls.find((entry) => entry[0] === "compact_card" && entry[1] === "editReply");
        if (!compactCardCall || !/# Моя карточка/.test(compactCardCall[2])) {
          failures.push("compact-card route did not render the compact card payload");
        } else {
          if (/profile_nav:/.test(compactCardCall[2])) {
            failures.push("compact-card unexpectedly rendered profile navigation");
          }
          if (/profile_bind_roblox/.test(compactCardCall[2])) {
            failures.push("compact-card unexpectedly rendered self-action buttons");
          }
        }

        const helperRobloxCall = calls.find((entry) => entry[0] === "helper_roblox" && entry[1] === "showModal");
        if (!helperRobloxCall || !/profile_bind_roblox_modal/.test(helperRobloxCall[2])) {
          failures.push("bot helper Roblox button did not open the profile bind modal while pending exists");
        } else if (/onboard_roblox_username_modal/.test(helperRobloxCall[2])) {
          failures.push("bot helper Roblox button unexpectedly routed to onboarding Roblox modal");
        }

        if (failures.length) {
          failures.push("calls:\n" + renderedCalls);
          console.error(failures.join("\n---\n"));
          process.exit(1);
          return;
        }

        console.log("profile-smoke-ok");
        process.exit(0);
      }, 1800);

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
    `profile smoke failed\nstdout:\n${result.stdout || ""}\nstderr:\n${result.stderr || ""}`
  );
  assert.match(
    result.stdout || "",
    /profile-smoke-ok/,
    `expected profile smoke marker\nstdout:\n${result.stdout || ""}\nstderr:\n${result.stderr || ""}`
  );
});
