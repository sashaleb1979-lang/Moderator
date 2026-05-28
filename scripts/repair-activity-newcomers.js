"use strict";

require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");
const {
  Client,
  GatewayIntentBits,
} = require("discord.js");

const { loadJsonFile, saveJsonFile } = require("../src/db/store");
const { repairFreshNewcomerActivityRoles } = require("../src/activity/operator");

const PROJECT_ROOT = path.resolve(__dirname, "..");

function resolvePathFromBase(baseDir, rawPath, fallbackRelative = "") {
  const target = String(rawPath || fallbackRelative || "").trim();
  if (!target) return path.resolve(baseDir, fallbackRelative || ".");
  return path.isAbsolute(target) ? target : path.resolve(baseDir, target);
}

function resolveDataRoot() {
  const explicitRoot = String(process.env.BOT_DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || "").trim();
  if (explicitRoot) return resolvePathFromBase(PROJECT_ROOT, explicitRoot);
  if (process.env.RAILWAY_ENVIRONMENT_NAME && fs.existsSync("/data")) return "/data";
  return PROJECT_ROOT;
}

function parseArgs(argv = []) {
  const args = Array.isArray(argv) ? argv : [];
  const dbArgIndex = args.indexOf("--db");
  const limitArgIndex = args.indexOf("--limit");
  return {
    applyDiscord: args.includes("--apply-discord"),
    write: args.includes("--write"),
    dbPath: dbArgIndex >= 0 && args[dbArgIndex + 1]
      ? path.resolve(args[dbArgIndex + 1])
      : null,
    limit: limitArgIndex >= 0 && args[limitArgIndex + 1]
      ? Math.max(0, Number(args[limitArgIndex + 1]) || 0)
      : 0,
  };
}

function resolveDbPath(options = {}) {
  if (options.dbPath) return options.dbPath;
  const dataRoot = resolveDataRoot();
  return resolvePathFromBase(dataRoot, process.env.DB_PATH || "welcome-db.json");
}

function countReasons(reasons = {}) {
  const counts = {};
  for (const reason of Object.values(reasons || {})) {
    const key = String(reason || "unknown").trim() || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

async function fetchGuildMembers({ token, guildId }) {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
    ],
  });
  await client.login(token);
  try {
    const guild = await client.guilds.fetch(guildId);
    await guild.members.fetch();
    return {
      client,
      guild,
      members: [...guild.members.cache.values()]
        .map((member) => ({
          userId: member.id,
          joinedAt: member.joinedAt instanceof Date ? member.joinedAt.toISOString() : null,
          roleIds: [...member.roles.cache.keys()],
          bot: member.user?.bot === true,
        })),
    };
  } catch (error) {
    client.destroy();
    throw error;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const dbPath = resolveDbPath(options);
  const db = loadJsonFile(dbPath, null);
  if (!db || typeof db !== "object") {
    throw new Error(`DB not found or unreadable: ${dbPath}`);
  }
  if (options.write && !options.applyDiscord) {
    throw new Error("--write requires --apply-discord so metadata does not drift away from live roles.");
  }

  const token = String(process.env.DISCORD_TOKEN || "").trim();
  const guildId = String(process.env.GUILD_ID || "").trim();
  if (!token) throw new Error("DISCORD_TOKEN is required to inspect and repair live member roles.");
  if (!guildId) throw new Error("GUILD_ID is required to inspect and repair live member roles.");

  const { client, guild, members } = await fetchGuildMembers({ token, guildId });
  const limitedMembers = options.limit > 0 ? members.slice(0, options.limit) : members;
  const appliedDiscordChanges = [];

  try {
    const result = await repairFreshNewcomerActivityRoles({
      db,
      members: limitedMembers,
      dryRun: !options.applyDiscord,
      applyRoleChanges: async ({ userId, addRoleIds = [], removeRoleIds = [] }) => {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return false;
        if (removeRoleIds.length) {
          await member.roles.remove(removeRoleIds, "repair mistaken activity newcomer bypass");
        }
        if (addRoleIds.length) {
          await member.roles.add(addRoleIds, "repair mistaken activity newcomer bypass");
        }
        appliedDiscordChanges.push({ userId, addRoleIds, removeRoleIds });
        return true;
      },
      now: new Date().toISOString(),
    });

    if (options.write) {
      saveJsonFile(dbPath, db);
    }

    console.log(JSON.stringify({
      dbPath,
      guildId,
      write: options.write,
      applyDiscord: options.applyDiscord,
      inspectedCount: result.inspectedCount,
      targetUserCount: result.targetUserCount,
      rebuiltUserCount: result.rebuiltUserCount,
      appliedCount: result.roleAssignment.appliedCount,
      skippedCount: result.roleAssignment.skippedCount,
      targetUserIds: result.targetUserIds.slice(0, 100),
      plannedRoleChanges: result.plannedRoleChanges.slice(0, 100),
      appliedDiscordChanges: appliedDiscordChanges.slice(0, 100),
      roleAssignmentSkippedReasonCounts: countReasons(result.roleAssignment.skippedReasons),
      prefilterSkippedReasonCounts: countReasons(result.skippedReasons),
    }, null, 2));
  } finally {
    client.destroy();
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
