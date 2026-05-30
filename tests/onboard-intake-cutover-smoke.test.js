"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function runSmokeScript({ prefix, script, marker, errorLabel }) {
  const repoRoot = path.join(__dirname, "..");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const result = spawnSync(process.execPath, ["-e", script(tempDir)], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 30000,
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
    `${errorLabel}\nstdout:\n${result.stdout || ""}\nstderr:\n${result.stderr || ""}`
  );
  assert.match(
    result.stdout || "",
    marker,
    `expected smoke marker\nstdout:\n${result.stdout || ""}\nstderr:\n${result.stderr || ""}`
  );
}

test("helper and profile kills buttons arm the shared submit flow", () => {
  runSmokeScript({
    prefix: "intake-kills-cutover-",
    marker: /kills-cutover-smoke-ok/,
    errorLabel: "kills cutover smoke failed",
    script(tempDir) {
      return String.raw`
        const fs = require("node:fs");
        const path = require("node:path");

        process.env.DISCORD_TOKEN = "smoke-token";
        process.env.GUILD_ID = "123";
        process.env.BOT_DATA_DIR = ${JSON.stringify(tempDir)};
        process.env.DB_PATH = "welcome-db.json";
        process.env.REVIEW_CHANNEL_ID = "323456789012345678";
        process.env.ACCESS_ROLE_ID = "423456789012345678";

        const failures = [];
        const events = [];

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

        function pushEvent(label, step, payload) {
          events.push([label, step, typeof payload === "string" ? payload : render(payload)]);
        }

        function recordFailure(error) {
          failures.push(error && typeof error === "object" && error.stack ? error.stack : String(error));
        }

        process.on("uncaughtException", recordFailure);
        process.on("unhandledRejection", recordFailure);

        const dbPath = path.join(process.env.BOT_DATA_DIR, process.env.DB_PATH);
        fs.mkdirSync(process.env.BOT_DATA_DIR, { recursive: true });
        fs.writeFileSync(dbPath, JSON.stringify({
          config: {
            accessGrant: { mode: "after_submit" },
            botHelperPanel: {
              channelId: "223456789012345678",
              messageId: "",
              lastSentAt: "",
            },
            generatedRoles: {
              characters: {
                honored_one: "523456789012345678",
              },
              characterLabels: {
                honored_one: "Годжо",
              },
              tiers: {},
            },
          },
          profiles: {
            "helper-user": {
              displayName: "Helper User",
              username: "HelperUser",
              mainCharacterIds: ["honored_one"],
              domains: {
                roblox: {
                  userId: "101",
                  username: "HelperRb",
                  displayName: "HelperRb",
                  verificationStatus: "verified",
                },
              },
              summary: {
                roblox: {
                  userId: "101",
                  currentUsername: "HelperRb",
                  displayName: "HelperRb",
                  hasVerifiedAccount: true,
                  verificationStatus: "verified",
                },
              },
            },
            "profile-user": {
              displayName: "Profile User",
              username: "ProfileUser",
              mainCharacterIds: ["honored_one"],
              domains: {
                roblox: {
                  userId: "202",
                  username: "ProfileRb",
                  displayName: "ProfileRb",
                  verificationStatus: "verified",
                },
              },
              summary: {
                roblox: {
                  userId: "202",
                  currentUsername: "ProfileRb",
                  displayName: "ProfileRb",
                  hasVerifiedAccount: true,
                  verificationStatus: "verified",
                },
              },
            },
          },
          submissions: {},
          cooldowns: {},
          sot: {},
        }, null, 2), "utf8");

        const discord = require("discord.js");
        const { buildProfileOpenCustomId } = require("./src/profile/entry");
        const originalEmit = discord.Client.prototype.emit;

        function makeUser(id, username) {
          return {
            id,
            username,
            globalName: username,
            tag: username + "#0001",
            bot: false,
            primaryGuild: { tag: "TAG", identityEnabled: true },
            displayAvatarURL: () => "https://cdn.discordapp.com/avatars/" + id + "/profile.png",
            send: async () => null,
          };
        }

        function makeMember(user, displayName) {
          const accessRole = { id: "423456789012345678", position: 1, guild: { id: "123" } };
          const roleState = new discord.Collection([[accessRole.id, accessRole]]);
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
                  roleState.set(normalizedRoleId, roleCache.get(normalizedRoleId) || { id: normalizedRoleId, position: roleState.size + 1, guild: { id: "123" } });
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

        function createReplyMessage(label, channel) {
          const replyMessage = {
            id: label + "-reply",
            channel,
            delete: async () => true,
            edit: async (payload) => {
              pushEvent(label, "editReply", payload);
              return replyMessage;
            },
          };
          return replyMessage;
        }

        const helperUser = makeUser("helper-user", "HelperUser");
        const profileUser = makeUser("profile-user", "ProfileUser");
        const userCache = new Map([
          [helperUser.id, helperUser],
          [profileUser.id, profileUser],
        ]);

        const helperMember = makeMember(helperUser, "Helper User");
        const profileMember = makeMember(profileUser, "Profile User");
        const botGuildMember = {
          permissions: { has: () => true },
          roles: { highest: { position: 999 } },
        };
        const memberCache = new discord.Collection([
          [helperMember.id, helperMember],
          [profileMember.id, profileMember],
        ]);
        const roleCache = new discord.Collection([
          ["423456789012345678", { id: "423456789012345678", name: "Access", managed: false, editable: true, position: 1, members: new discord.Collection() }],
          ["523456789012345678", { id: "523456789012345678", name: "Годжо", managed: false, editable: true, position: 2, members: new discord.Collection() }],
        ]);
        const sentMessages = new discord.Collection();
        let sentCounter = 0;

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
            pushEvent("helper_channel", "botSend", payload);
            const message = {
              id: "bot-message-" + sentCounter,
              channel: helperChannel,
              channelId: helperChannel.id,
              author: { id: "1", bot: true },
              createdAt: new Date("2026-05-30T00:00:00.000Z"),
              createdTimestamp: Date.parse("2026-05-30T00:00:00.000Z"),
              edit: async (nextPayload) => {
                pushEvent("helper_channel", "botEdit", nextPayload);
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
            pushEvent("review_channel", "send", payload);
            return {
              id: "review-" + (events.filter((entry) => entry[0] === "review_channel" && entry[1] === "send").length),
              channel: reviewChannel,
              attachments: { first: () => null },
              edit: async () => null,
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
            me: botGuildMember,
            cache: memberCache,
            fetch: async (userId) => memberCache.get(String(userId || "")) || null,
            fetchMe: async () => botGuildMember,
          },
          roles: {
            cache: roleCache,
            create: async (options = {}) => {
              const created = {
                id: String(900000000000000000n + BigInt(roleCache.size + 1)),
                name: String(options.name || "created-smoke-role"),
                managed: false,
                editable: true,
                position: roleCache.size + 1,
                members: new discord.Collection(),
              };
              roleCache.set(created.id, created);
              return created;
            },
            fetch: async (roleId) => roleId ? (roleCache.get(roleId) || null) : roleCache,
          },
        };

        function makeButtonInteraction(label, user, member, customId, message, channelId) {
          return {
            customId,
            user,
            member,
            guild,
            channelId,
            message,
            isChatInputCommand: () => false,
            isButton: () => true,
            isStringSelectMenu: () => false,
            isModalSubmit: () => false,
            reply: async (payload) => {
              pushEvent(label, "reply", payload);
              return payload;
            },
            deferReply: async (payload) => {
              pushEvent(label, "deferReply", payload);
              return payload;
            },
            editReply: async (payload) => {
              pushEvent(label, "editReply", payload);
              return payload;
            },
            followUp: async (payload) => {
              pushEvent(label, "followUp", payload);
              return payload;
            },
            deferUpdate: async () => {
              pushEvent(label, "deferUpdate", "ok");
              return null;
            },
            update: async (payload) => {
              pushEvent(label, "update", payload);
              return payload;
            },
          };
        }

        function makeKillsMessage(label, user, member, rawText) {
          const attachment = { url: "https://example.com/" + label + ".png", name: label + ".png", contentType: "image/png" };
          return {
            id: label + "-message",
            content: rawText,
            author: { ...user, bot: false },
            member,
            guild,
            guildId: "123",
            channel: helperChannel,
            channelId: helperChannel.id,
            url: "https://discord.com/channels/123/" + helperChannel.id + "/" + label + "-message",
            createdAt: new Date("2026-05-30T00:01:00.000Z"),
            createdTimestamp: Date.parse("2026-05-30T00:01:00.000Z"),
            attachments: new discord.Collection([["att-1", attachment]]),
            mentions: {
              users: new discord.Collection(),
              members: new discord.Collection(),
              channels: new discord.Collection(),
              roles: new discord.Collection(),
            },
            reference: null,
            reply: async (payload) => {
              pushEvent(label, "reply", payload);
              return createReplyMessage(label, helperChannel);
            },
            delete: async () => {
              pushEvent(label, "delete", "ok");
              return true;
            },
          };
        }

        discord.Client.prototype.login = function login() {
          this.user = { id: "1", tag: "SmokeBot#0001" };
          this.guilds = { fetch: async () => guild };
          this.channels = { cache: channelCache, fetch: async (channelId) => channelCache.get(String(channelId || "")) || null };
          this.users = { fetch: async (userId) => userCache.get(String(userId || "")) || makeUser(String(userId || "unknown"), "User" + String(userId || "unknown")) };
          this.destroy = () => {};

          setImmediate(() => originalEmit.call(this, "clientReady"));

          setTimeout(() => {
            const helperPanelMessage = sentMessages.first();
            if (!helperPanelMessage) {
              failures.push("helper panel did not render on startup");
              return;
            }

            const profilePrivateMessage = {
              id: "profile-private-message",
              channelId: helperChannel.id,
              delete: async () => true,
            };

            originalEmit.call(this, "interactionCreate", makeButtonInteraction(
              "helper_begin",
              helperUser,
              helperMember,
              "onboard_begin",
              helperPanelMessage,
              helperChannel.id
            ));

            setTimeout(() => {
              originalEmit.call(this, "interactionCreate", makeButtonInteraction(
                "helper_confirm",
                helperUser,
                helperMember,
                "onboard_main_confirm",
                helperPanelMessage,
                helperChannel.id
              ));
            }, 120);

            setTimeout(() => {
              originalEmit.call(this, "messageCreate", makeKillsMessage("helper_kills", helperUser, helperMember, "3120 kills"));
            }, 300);

            setTimeout(() => {
              originalEmit.call(this, "interactionCreate", {
                customId: buildProfileOpenCustomId(profileUser.id, profileUser.id),
                user: profileUser,
                member: profileMember,
                guild,
                message: {
                  delete: async () => {
                    pushEvent("profile_open", "deleteMessage", "ok");
                    return true;
                  },
                },
                isChatInputCommand: () => false,
                isButton: () => true,
                isStringSelectMenu: () => false,
                isModalSubmit: () => false,
                reply: async (payload) => {
                  pushEvent("profile_open", "reply", payload);
                  return payload;
                },
                deferReply: async (payload) => {
                  pushEvent("profile_open", "deferReply", payload);
                  return payload;
                },
                editReply: async (payload) => {
                  pushEvent("profile_open", "editReply", payload);
                  return profilePrivateMessage;
                },
              });
            }, 320);

            setTimeout(() => {
              originalEmit.call(this, "interactionCreate", makeButtonInteraction(
                "profile_begin",
                profileUser,
                profileMember,
                "onboard_begin",
                profilePrivateMessage,
                profilePrivateMessage.channelId
              ));
            }, 500);

            setTimeout(() => {
              originalEmit.call(this, "interactionCreate", makeButtonInteraction(
                "profile_confirm",
                profileUser,
                profileMember,
                "onboard_main_confirm",
                profilePrivateMessage,
                profilePrivateMessage.channelId
              ));
            }, 650);

            setTimeout(() => {
              originalEmit.call(this, "messageCreate", makeKillsMessage("profile_kills", profileUser, profileMember, "4150"));
            }, 820);
          }, 250);

          setTimeout(() => {
            const renderedEvents = events.map((entry) => entry.join(" ")).join("\n");

            if (!events.some((entry) => entry[0] === "helper_kills" && entry[1] === "reply" && /Заявка принята\. Обрабатываю/.test(entry[2]))) {
              failures.push("helper kills flow did not accept the armed message");
            }
            if (!events.some((entry) => entry[0] === "profile_open" && entry[1] === "editReply" && /# Твой профиль/.test(entry[2]))) {
              failures.push("profile self-open did not render the private self profile payload");
            }
            if (!events.some((entry) => entry[0] === "profile_begin" && entry[1] === "reply" && /<#223456789012345678>/.test(entry[2]))) {
              failures.push("profile begin did not keep kills intake scoped to the current channel");
            }
            if (!events.some((entry) => entry[0] === "profile_kills" && entry[1] === "reply" && /Заявка принята\. Обрабатываю/.test(entry[2]))) {
              failures.push("profile kills flow did not accept the armed message");
            }
            if (events.filter((entry) => entry[0] === "review_channel" && entry[1] === "send").length < 2) {
              failures.push("review channel did not receive both kills submissions");
            }

            if (failures.length) {
              failures.push("events:\n" + renderedEvents);
              console.error(failures.join("\n---\n"));
              process.exit(1);
              return;
            }

            console.log("kills-cutover-smoke-ok");
            process.exit(0);
          }, 7000);

          return Promise.resolve("smoke-login");
        };

        require("./welcome-bot.js");
      `;
    },
  });
});

test("helper and profile elo buttons arm the shared elo flow", () => {
  runSmokeScript({
    prefix: "intake-elo-cutover-",
    marker: /elo-cutover-smoke-ok/,
    errorLabel: "elo cutover smoke failed",
    script(tempDir) {
      return String.raw`
        const fs = require("node:fs");
        const path = require("node:path");

        process.env.DISCORD_TOKEN = "smoke-token";
        process.env.GUILD_ID = "123";
        process.env.BOT_DATA_DIR = ${JSON.stringify(tempDir)};
        process.env.DB_PATH = "welcome-db.json";
        process.env.REVIEW_CHANNEL_ID = "323456789012345678";

        const failures = [];
        const events = [];

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

        function pushEvent(label, step, payload) {
          events.push([label, step, typeof payload === "string" ? payload : render(payload)]);
        }

        function recordFailure(error) {
          failures.push(error && typeof error === "object" && error.stack ? error.stack : String(error));
        }

        process.on("uncaughtException", recordFailure);
        process.on("unhandledRejection", recordFailure);

        const dbPath = path.join(process.env.BOT_DATA_DIR, process.env.DB_PATH);
        const eloDbPath = path.join(process.env.BOT_DATA_DIR, "elo-db.json");
        fs.mkdirSync(process.env.BOT_DATA_DIR, { recursive: true });
        fs.writeFileSync(eloDbPath, JSON.stringify({
          config: {
            submitPanel: {
              channelId: "223456789012345678",
              messageId: "",
            },
          },
          submissions: {},
          ratings: {},
          cooldowns: {},
          miniCards: {},
        }, null, 2), "utf8");
        fs.writeFileSync(dbPath, JSON.stringify({
          config: {
            botHelperPanel: {
              channelId: "223456789012345678",
              messageId: "",
              lastSentAt: "",
            },
            integrations: {
              elo: {
                sourcePath: "elo-db.json",
              },
            },
          },
          profiles: {
            "helper-elo-user": {
              displayName: "Helper Elo User",
              username: "HelperEloUser",
            },
            "profile-elo-user": {
              displayName: "Profile Elo User",
              username: "ProfileEloUser",
            },
          },
          submissions: {},
          cooldowns: {},
          sot: {},
        }, null, 2), "utf8");

        const discord = require("discord.js");
        const { buildProfileOpenCustomId } = require("./src/profile/entry");
        const originalEmit = discord.Client.prototype.emit;

        function makeUser(id, username) {
          return {
            id,
            username,
            globalName: username,
            tag: username + "#0001",
            bot: false,
            primaryGuild: { tag: "TAG", identityEnabled: true },
            displayAvatarURL: () => "https://cdn.discordapp.com/avatars/" + id + "/profile.png",
            send: async () => null,
          };
        }

        function makeMember(user, displayName) {
          return {
            id: user.id,
            user,
            guild: { id: "123" },
            displayName,
            permissions: { has: () => false },
            roles: { cache: new discord.Collection(), add: async () => true, remove: async () => true },
          };
        }

        const helperUser = makeUser("helper-elo-user", "HelperEloUser");
        const profileUser = makeUser("profile-elo-user", "ProfileEloUser");
        const userCache = new Map([
          [helperUser.id, helperUser],
          [profileUser.id, profileUser],
        ]);
        const helperMember = makeMember(helperUser, "Helper Elo User");
        const profileMember = makeMember(profileUser, "Profile Elo User");
        const memberCache = new discord.Collection([
          [helperMember.id, helperMember],
          [profileMember.id, profileMember],
        ]);
        const roleCache = new discord.Collection();
        const sentMessages = new discord.Collection();
        let sentCounter = 0;

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
            pushEvent("helper_channel", "botSend", payload);
            const message = {
              id: "bot-message-" + sentCounter,
              channel: helperChannel,
              channelId: helperChannel.id,
              author: { id: "1", bot: true },
              createdAt: new Date("2026-05-30T00:00:00.000Z"),
              createdTimestamp: Date.parse("2026-05-30T00:00:00.000Z"),
              edit: async (nextPayload) => {
                pushEvent("helper_channel", "botEdit", nextPayload);
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
          messages: { fetch: async () => null },
          send: async (payload) => {
            pushEvent("review_channel", "send", payload);
            return {
              id: "review-" + (events.filter((entry) => entry[0] === "review_channel" && entry[1] === "send").length),
              channel: reviewChannel,
              attachments: { first: () => ({ url: "https://cdn.discordapp.com/review-proof.png" }) },
              edit: async () => null,
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
            cache: memberCache,
            fetch: async (userId) => memberCache.get(String(userId || "")) || null,
          },
          roles: {
            cache: roleCache,
            create: async (options = {}) => ({ id: String(900000000000000000n + BigInt(roleCache.size + 1)), name: String(options.name || "created-smoke-role"), managed: false, editable: true, members: new discord.Collection() }),
            fetch: async () => roleCache,
          },
        };

        function createReplyMessage(label, channel) {
          const replyMessage = {
            id: label + "-reply",
            channel,
            delete: async () => true,
            edit: async (payload) => {
              pushEvent(label, "editReply", payload);
              return replyMessage;
            },
          };
          return replyMessage;
        }

        function makeButtonInteraction(label, user, member, customId, message, channelId) {
          return {
            customId,
            user,
            member,
            guild,
            channelId,
            message,
            isChatInputCommand: () => false,
            isButton: () => true,
            isStringSelectMenu: () => false,
            isModalSubmit: () => false,
            reply: async (payload) => {
              pushEvent(label, "reply", payload);
              return payload;
            },
            deferReply: async (payload) => {
              pushEvent(label, "deferReply", payload);
              return payload;
            },
            editReply: async (payload) => {
              pushEvent(label, "editReply", payload);
              return payload;
            },
            followUp: async (payload) => {
              pushEvent(label, "followUp", payload);
              return payload;
            },
            deferUpdate: async () => {
              pushEvent(label, "deferUpdate", "ok");
              return null;
            },
          };
        }

        function makeEloMessage(label, user, member, rawText) {
          const attachment = { url: "https://example.com/" + label + ".png", name: label + ".png", contentType: "image/png" };
          return {
            id: label + "-message",
            content: rawText,
            author: { ...user, bot: false },
            member,
            guild,
            guildId: "123",
            channel: helperChannel,
            channelId: helperChannel.id,
            url: "https://discord.com/channels/123/" + helperChannel.id + "/" + label + "-message",
            createdAt: new Date("2026-05-30T00:01:00.000Z"),
            createdTimestamp: Date.parse("2026-05-30T00:01:00.000Z"),
            attachments: new discord.Collection([["att-1", attachment]]),
            mentions: {
              users: new discord.Collection(),
              members: new discord.Collection(),
              channels: new discord.Collection(),
              roles: new discord.Collection(),
            },
            reference: null,
            reply: async (payload) => {
              pushEvent(label, "reply", payload);
              return createReplyMessage(label, helperChannel);
            },
            delete: async () => {
              pushEvent(label, "delete", "ok");
              return true;
            },
          };
        }

        discord.Client.prototype.login = function login() {
          this.user = { id: "1", tag: "SmokeBot#0001" };
          this.guilds = { fetch: async () => guild };
          this.channels = { cache: channelCache, fetch: async (channelId) => channelCache.get(String(channelId || "")) || null };
          this.users = { fetch: async (userId) => userCache.get(String(userId || "")) || makeUser(String(userId || "unknown"), "User" + String(userId || "unknown")) };
          this.destroy = () => {};

          setImmediate(() => originalEmit.call(this, "clientReady"));

          setTimeout(() => {
            const helperPanelMessage = sentMessages.first();
            if (!helperPanelMessage) {
              failures.push("helper panel did not render on startup");
              return;
            }

            const profilePrivateMessage = {
              id: "profile-elo-private-message",
              channelId: helperChannel.id,
              delete: async () => true,
            };

            originalEmit.call(this, "interactionCreate", makeButtonInteraction(
              "helper_elo_open",
              helperUser,
              helperMember,
              "elo_submit_open",
              helperPanelMessage,
              helperChannel.id
            ));

            setTimeout(() => {
              originalEmit.call(this, "messageCreate", makeEloMessage("helper_elo", helperUser, helperMember, "73 elo"));
            }, 150);

            setTimeout(() => {
              originalEmit.call(this, "interactionCreate", {
                customId: buildProfileOpenCustomId(profileUser.id, profileUser.id),
                user: profileUser,
                member: profileMember,
                guild,
                message: {
                  delete: async () => {
                    pushEvent("profile_open", "deleteMessage", "ok");
                    return true;
                  },
                },
                isChatInputCommand: () => false,
                isButton: () => true,
                isStringSelectMenu: () => false,
                isModalSubmit: () => false,
                reply: async (payload) => {
                  pushEvent("profile_open", "reply", payload);
                  return payload;
                },
                deferReply: async (payload) => {
                  pushEvent("profile_open", "deferReply", payload);
                  return payload;
                },
                editReply: async (payload) => {
                  pushEvent("profile_open", "editReply", payload);
                  return profilePrivateMessage;
                },
              });
            }, 320);

            setTimeout(() => {
              originalEmit.call(this, "interactionCreate", makeButtonInteraction(
                "profile_elo_open",
                profileUser,
                profileMember,
                "elo_submit_open",
                profilePrivateMessage,
                profilePrivateMessage.channelId
              ));
            }, 500);

            setTimeout(() => {
              originalEmit.call(this, "messageCreate", makeEloMessage("profile_elo", profileUser, profileMember, "88 elo"));
            }, 680);
          }, 250);

          setTimeout(() => {
            const renderedEvents = events.map((entry) => entry.join(" ")).join("\n");

            if (!events.some((entry) => entry[0] === "helper_elo" && entry[1] === "reply" && /ELO заявка отправлена на проверку модерам/.test(entry[2]))) {
              failures.push("helper elo flow did not accept the armed message");
            }
            if (!events.some((entry) => entry[0] === "profile_open" && entry[1] === "editReply" && /# Твой профиль/.test(entry[2]))) {
              failures.push("profile self-open did not render the private self profile payload");
            }
            if (!events.some((entry) => entry[0] === "profile_elo" && entry[1] === "reply" && /ELO заявка отправлена на проверку модерам/.test(entry[2]))) {
              failures.push("profile elo flow did not accept the armed message");
            }
            if (events.filter((entry) => entry[0] === "review_channel" && entry[1] === "send").length < 2) {
              failures.push("review channel did not receive both elo submissions");
            }

            if (failures.length) {
              failures.push("events:\n" + renderedEvents);
              console.error(failures.join("\n---\n"));
              process.exit(1);
              return;
            }

            console.log("elo-cutover-smoke-ok");
            process.exit(0);
          }, 7000);

          return Promise.resolve("smoke-login");
        };

        require("./welcome-bot.js");
      `;
    },
  });
});