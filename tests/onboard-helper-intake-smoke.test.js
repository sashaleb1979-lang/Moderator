"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("helper intake leaves idle helper-channel messages untouched without an armed session", () => {
  const repoRoot = path.join(__dirname, "..");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "helper-intake-idle-smoke-"));
  const script = String.raw`
    const fs = require("node:fs");
    const path = require("node:path");

    process.env.DISCORD_TOKEN = "smoke-token";
    process.env.GUILD_ID = "123";
    process.env.BOT_DATA_DIR = ${JSON.stringify(tempDir)};
    process.env.DB_PATH = "welcome-db.json";

    const dbPath = path.join(${JSON.stringify(tempDir)}, "welcome-db.json");
    fs.writeFileSync(dbPath, JSON.stringify({
      config: {
        botHelperPanel: {
          channelId: "223456789012345678",
          messageId: "",
          lastSentAt: "",
        },
        integrations: {
          elo: {
            submitPanel: {
              channelId: "223456789012345678",
              messageId: "",
            },
          },
        },
        reviewChannelId: "323456789012345678",
      },
      profiles: {},
      submissions: {},
      cooldowns: {},
    }, null, 2), "utf8");

    const discord = require("discord.js");
    const originalEmit = discord.Client.prototype.emit;
    const helperEvents = [];
    const failures = [];

    function pushEvent(type, payload) {
      helperEvents.push([type, typeof payload === "string" ? payload : JSON.stringify(payload)]);
    }

    const requesterUser = { id: "999999999999999999", username: "IdleUser", tag: "IdleUser#0001", bot: false };
    const requesterMember = {
      id: requesterUser.id,
      user: requesterUser,
      displayName: "IdleUser",
      permissions: { has: () => false },
      roles: { cache: new discord.Collection() },
    };

    let sentCounter = 0;
    const sentMessages = new discord.Collection();
    const helperChannel = {
      id: "223456789012345678",
      name: "bot-chat",
      guildId: "123",
      type: 0,
      isTextBased: () => true,
      messages: {
        fetch: async (query) => {
          if (query && typeof query === "object") {
            return { first: () => sentMessages.first() || null };
          }
          return sentMessages.get(String(query || "")) || null;
        },
      },
      send: async (payload) => {
        sentCounter += 1;
        pushEvent("botSend", payload);
        const message = {
          id: "bot-message-" + sentCounter,
          channelId: "223456789012345678",
          author: { id: "1", bot: true },
          createdAt: new Date("2026-05-30T00:00:00.000Z"),
          createdTimestamp: Date.parse("2026-05-30T00:00:00.000Z"),
          edit: async (nextPayload) => {
            pushEvent("botEdit", nextPayload);
            return message;
          },
          delete: async () => true,
        };
        sentMessages.set(message.id, message);
        return message;
      },
    };
    const reviewChannel = {
      id: "323456789012345678",
      name: "review-room",
      guildId: "123",
      type: 0,
      isTextBased: () => true,
      messages: {
        fetch: async () => null,
      },
      send: async (payload) => {
        pushEvent("reviewSend", payload);
        return {
          id: "review-message-1",
          channel: reviewChannel,
          attachments: { first: () => null },
        };
      },
    };
    const channelCache = new discord.Collection([
      [helperChannel.id, helperChannel],
      [reviewChannel.id, reviewChannel],
    ]);
    const guild = {
      id: "123",
      name: "smoke-guild",
      commands: { set: async (commands) => commands },
      channels: {
        cache: channelCache,
        fetch: async (channelId) => channelCache.get(String(channelId || "")) || null,
      },
      members: {
        cache: new discord.Collection([[requesterMember.id, requesterMember]]),
        fetch: async () => requesterMember,
      },
      roles: {
        cache: new discord.Collection(),
        fetch: async () => new discord.Collection(),
        create: async () => ({ id: "role-1", name: "stub-role", managed: false, editable: true, members: new discord.Collection() }),
      },
    };

    discord.Client.prototype.login = function login() {
      this.user = { id: "1", tag: "SmokeBot#0001" };
      this.guilds = { fetch: async () => guild };
      this.channels = {
        cache: channelCache,
        fetch: async (channelId) => channelCache.get(String(channelId || "")) || null,
      };
      this.users = {
        fetch: async () => requesterUser,
      };
      this.destroy = () => {};

      setImmediate(() => originalEmit.call(this, "clientReady"));

      setTimeout(() => {
        const idleMessage = {
          id: "idle-message-1",
          content: "просто текст без submit session",
          author: requesterUser,
          member: requesterMember,
          guild,
          guildId: "123",
          channel: helperChannel,
          channelId: helperChannel.id,
          createdAt: new Date("2026-05-30T00:01:00.000Z"),
          createdTimestamp: Date.parse("2026-05-30T00:01:00.000Z"),
          attachments: new discord.Collection(),
          mentions: {
            users: new discord.Collection(),
            members: new discord.Collection(),
            channels: new discord.Collection(),
            roles: new discord.Collection(),
          },
          reference: null,
          reply: async (payload) => {
            pushEvent("userReply", payload);
            return {
              id: "idle-reply-1",
              delete: async () => {
                pushEvent("replyDelete", "ok");
                return true;
              },
            };
          },
          delete: async () => {
            pushEvent("userDelete", "ok");
            return true;
          },
        };

        originalEmit.call(this, "messageCreate", idleMessage);
      }, 250);

      setTimeout(() => {
        const rendered = helperEvents.map((entry) => entry.join(" ")).join("\n");
        if (helperEvents.some((entry) => entry[0] === "userDelete")) {
          failures.push("idle helper message was deleted without an armed session");
        }
        if (helperEvents.some((entry) => entry[0] === "userReply")) {
          failures.push("idle helper message unexpectedly received an auto-reply");
        }

        if (failures.length) {
          failures.push("events:\n" + rendered);
          console.error(failures.join("\n---\n"));
          process.exit(1);
          return;
        }

        console.log("helper-intake-idle-smoke-ok");
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
    `helper intake idle smoke failed\nstdout:\n${result.stdout || ""}\nstderr:\n${result.stderr || ""}`
  );
  assert.match(
    result.stdout || "",
    /helper-intake-idle-smoke-ok/,
    `expected helper idle smoke marker\nstdout:\n${result.stdout || ""}\nstderr:\n${result.stderr || ""}`
  );
});

test("welcome intake still deletes idle welcome-channel messages without an armed session", () => {
  const repoRoot = path.join(__dirname, "..");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "welcome-intake-idle-smoke-"));
  const script = String.raw`
    const fs = require("node:fs");
    const path = require("node:path");

    process.env.DISCORD_TOKEN = "smoke-token";
    process.env.GUILD_ID = "123";
    process.env.BOT_DATA_DIR = ${JSON.stringify(tempDir)};
    process.env.DB_PATH = "welcome-db.json";
    process.env.WELCOME_CHANNEL_ID = "123456789012345678";

    const dbPath = path.join(${JSON.stringify(tempDir)}, "welcome-db.json");
    fs.writeFileSync(dbPath, JSON.stringify({
      config: {
        reviewChannelId: "323456789012345678",
      },
      profiles: {},
      submissions: {},
      cooldowns: {},
    }, null, 2), "utf8");

    const discord = require("discord.js");
    const originalEmit = discord.Client.prototype.emit;
    const welcomeEvents = [];
    const failures = [];

    function pushEvent(type, payload) {
      welcomeEvents.push([type, typeof payload === "string" ? payload : JSON.stringify(payload)]);
    }

    const requesterUser = { id: "999999999999999999", username: "WelcomeIdle", tag: "WelcomeIdle#0001", bot: false };
    const requesterMember = {
      id: requesterUser.id,
      user: requesterUser,
      displayName: "WelcomeIdle",
      permissions: { has: () => false },
      roles: { cache: new discord.Collection() },
    };

    let sentCounter = 0;
    const sentMessages = new discord.Collection();
    const welcomeChannel = {
      id: "123456789012345678",
      name: "welcome",
      guildId: "123",
      type: 0,
      isTextBased: () => true,
      messages: {
        fetch: async (query) => {
          if (query && typeof query === "object") {
            return { first: () => sentMessages.first() || null };
          }
          return sentMessages.get(String(query || "")) || null;
        },
      },
      send: async (payload) => {
        sentCounter += 1;
        pushEvent("botSend", payload);
        const message = {
          id: "bot-message-" + sentCounter,
          channelId: welcomeChannel.id,
          author: { id: "1", bot: true },
          createdAt: new Date("2026-05-30T00:00:00.000Z"),
          createdTimestamp: Date.parse("2026-05-30T00:00:00.000Z"),
          edit: async (nextPayload) => {
            pushEvent("botEdit", nextPayload);
            return message;
          },
          delete: async () => true,
        };
        sentMessages.set(message.id, message);
        return message;
      },
    };
    const reviewChannel = {
      id: "323456789012345678",
      name: "review-room",
      guildId: "123",
      type: 0,
      isTextBased: () => true,
      messages: {
        fetch: async () => null,
      },
      send: async (payload) => {
        pushEvent("reviewSend", payload);
        return {
          id: "review-message-1",
          channel: reviewChannel,
          attachments: { first: () => null },
        };
      },
    };
    const channelCache = new discord.Collection([
      [welcomeChannel.id, welcomeChannel],
      [reviewChannel.id, reviewChannel],
    ]);
    const guild = {
      id: "123",
      name: "smoke-guild",
      commands: { set: async (commands) => commands },
      channels: {
        cache: channelCache,
        fetch: async (channelId) => channelCache.get(String(channelId || "")) || null,
      },
      members: {
        cache: new discord.Collection([[requesterMember.id, requesterMember]]),
        fetch: async () => requesterMember,
      },
      roles: {
        cache: new discord.Collection(),
        fetch: async () => new discord.Collection(),
        create: async () => ({ id: "role-1", name: "stub-role", managed: false, editable: true, members: new discord.Collection() }),
      },
    };

    discord.Client.prototype.login = function login() {
      this.user = { id: "1", tag: "SmokeBot#0001" };
      this.guilds = { fetch: async () => guild };
      this.channels = {
        cache: channelCache,
        fetch: async (channelId) => channelCache.get(String(channelId || "")) || null,
      };
      this.users = {
        fetch: async () => requesterUser,
      };
      this.destroy = () => {};

      setImmediate(() => originalEmit.call(this, "clientReady"));

      setTimeout(() => {
        const idleMessage = {
          id: "welcome-idle-message-1",
          content: "просто текст в welcome без submit session",
          author: requesterUser,
          member: requesterMember,
          guild,
          guildId: "123",
          channel: welcomeChannel,
          channelId: welcomeChannel.id,
          createdAt: new Date("2026-05-30T00:01:00.000Z"),
          createdTimestamp: Date.parse("2026-05-30T00:01:00.000Z"),
          attachments: new discord.Collection(),
          mentions: {
            users: new discord.Collection(),
            members: new discord.Collection(),
            channels: new discord.Collection(),
            roles: new discord.Collection(),
          },
          reference: null,
          reply: async (payload) => {
            pushEvent("userReply", payload);
            return {
              id: "welcome-idle-reply-1",
              delete: async () => true,
            };
          },
          delete: async () => {
            pushEvent("userDelete", "ok");
            return true;
          },
        };

        originalEmit.call(this, "messageCreate", idleMessage);
      }, 250);

      setTimeout(() => {
        const rendered = welcomeEvents.map((entry) => entry.join(" ")).join("\n");
        if (!welcomeEvents.some((entry) => entry[0] === "userDelete")) {
          failures.push("idle welcome message was not deleted");
        }
        if (welcomeEvents.some((entry) => entry[0] === "userReply")) {
          failures.push("idle welcome message unexpectedly received an auto-reply");
        }

        if (failures.length) {
          failures.push("events:\n" + rendered);
          console.error(failures.join("\n---\n"));
          process.exit(1);
          return;
        }

        console.log("welcome-intake-idle-smoke-ok");
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
    `welcome intake idle smoke failed\nstdout:\n${result.stdout || ""}\nstderr:\n${result.stderr || ""}`
  );
  assert.match(
    result.stdout || "",
    /welcome-intake-idle-smoke-ok/,
    `expected welcome idle smoke marker\nstdout:\n${result.stdout || ""}\nstderr:\n${result.stderr || ""}`
  );
});