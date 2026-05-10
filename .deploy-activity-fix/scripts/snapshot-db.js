"use strict";

require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");
const { loadJsonFile } = require("../src/db/store");

function resolvePathFromBase(baseDir, rawPath, fallbackRelative = "") {
  const target = String(rawPath || fallbackRelative || "").trim();
  if (!target) return path.resolve(baseDir, fallbackRelative || ".");
  return path.isAbsolute(target) ? target : path.resolve(baseDir, target);
}

function resolveDataRoot({ projectRoot, env = process.env, fsModule = fs } = {}) {
  const explicitRoot = String(env.BOT_DATA_DIR || env.RAILWAY_VOLUME_MOUNT_PATH || "").trim();
  if (explicitRoot) return resolvePathFromBase(projectRoot, explicitRoot);
  if (env.RAILWAY_ENVIRONMENT_NAME && fsModule.existsSync("/data")) return "/data";
  return projectRoot;
}

function formatSnapshotDirName(timestamp = new Date()) {
  const isoValue = timestamp instanceof Date ? timestamp.toISOString() : new Date(timestamp).toISOString();
  return isoValue.replace(/:/g, "-");
}

function resolveSnapshotOutputRoot({ projectRoot, env = process.env } = {}) {
  const configured = String(env.SNAPSHOT_OUTPUT_DIR || "").trim();
  return resolvePathFromBase(projectRoot, configured || "backups");
}

function collectSnapshotEntries({ db, dataRoot, dbPath }) {
  const entries = [
    {
      key: "db",
      kind: "db",
      configuredPath: dbPath,
      sourcePath: dbPath,
      destination: path.join("db", path.basename(dbPath)),
    },
  ];

  for (const domain of ["elo", "tierlist"]) {
    const configuredPath = String(db?.config?.integrations?.[domain]?.sourcePath || "").trim();
    if (!configuredPath) {
      entries.push({
        key: `integrations.${domain}`,
        kind: domain,
        configuredPath: "",
        sourcePath: "",
        destination: path.join("integrations", domain),
      });
      continue;
    }

    const sourcePath = resolvePathFromBase(dataRoot, configuredPath);
    entries.push({
      key: `integrations.${domain}`,
      kind: domain,
      configuredPath,
      sourcePath,
      destination: path.join("integrations", domain, path.basename(sourcePath)),
    });
  }

  return entries;
}

function snapshotDb({
  projectRoot = path.resolve(__dirname, ".."),
  env = process.env,
  fsModule = fs,
  timestamp = new Date(),
  outputRoot,
} = {}) {
  const dataRoot = resolveDataRoot({ projectRoot, env, fsModule });
  const dbPath = resolvePathFromBase(dataRoot, env.DB_PATH || "welcome-db.json");
  if (!fsModule.existsSync(dbPath)) {
    throw new Error(`DB snapshot source not found: ${dbPath}`);
  }

  const db = loadJsonFile(dbPath, null);
  const snapshotRoot = outputRoot || resolveSnapshotOutputRoot({ projectRoot, env });
  const snapshotDir = path.join(snapshotRoot, formatSnapshotDirName(timestamp));
  fsModule.mkdirSync(snapshotDir, { recursive: true });

  const entries = collectSnapshotEntries({ db, dataRoot, dbPath }).map((entry) => {
    const status = !entry.sourcePath
      ? "not-configured"
      : fsModule.existsSync(entry.sourcePath)
        ? "copied"
        : "missing";
    const snapshotPath = status === "copied"
      ? path.join(snapshotDir, entry.destination)
      : null;
    if (snapshotPath) {
      fsModule.mkdirSync(path.dirname(snapshotPath), { recursive: true });
      fsModule.copyFileSync(entry.sourcePath, snapshotPath);
    }
    return {
      key: entry.key,
      kind: entry.kind,
      configuredPath: entry.configuredPath,
      sourcePath: entry.sourcePath,
      snapshotPath,
      status,
    };
  });

  const manifest = {
    createdAt: timestamp instanceof Date ? timestamp.toISOString() : new Date(timestamp).toISOString(),
    projectRoot,
    dataRoot,
    dbPath,
    snapshotDir,
    entries,
  };

  const manifestPath = path.join(snapshotDir, "manifest.json");
  fsModule.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  return {
    snapshotDir,
    manifestPath,
    manifest,
  };
}

function formatCliSummary(result) {
  const lines = [`Snapshot ready: ${result.snapshotDir}`];
  for (const entry of result.manifest.entries) {
    if (entry.status === "copied") {
      lines.push(`- ${entry.key}: ${entry.snapshotPath}`);
      continue;
    }
    if (entry.status === "missing") {
      lines.push(`- ${entry.key}: missing source ${entry.sourcePath}`);
      continue;
    }
    lines.push(`- ${entry.key}: not configured`);
  }
  return lines.join("\n");
}

if (require.main === module) {
  try {
    const result = snapshotDb();
    console.log(formatCliSummary(result));
  } catch (error) {
    console.error(error.message || String(error));
    process.exitCode = 1;
  }
}

module.exports = {
  collectSnapshotEntries,
  formatCliSummary,
  formatSnapshotDirName,
  resolveDataRoot,
  resolvePathFromBase,
  resolveSnapshotOutputRoot,
  snapshotDb,
};