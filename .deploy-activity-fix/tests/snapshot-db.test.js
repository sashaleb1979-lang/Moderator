"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { formatSnapshotDirName, snapshotDb } = require("../scripts/snapshot-db");

test("formatSnapshotDirName produces a Windows-safe ISO folder name", () => {
  assert.equal(formatSnapshotDirName("2026-05-03T12:34:56.000Z"), "2026-05-03T12-34-56.000Z");
});

test("snapshotDb copies welcome-db and configured integration files into one snapshot folder", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "moderator-snapshot-project-"));
  const dataRoot = path.join(projectRoot, "data");
  const backupRoot = path.join(projectRoot, "backups");
  const dbPath = path.join(dataRoot, "welcome-db.json");
  const eloPath = path.join(dataRoot, "legacy", "elo-db.json");
  const tierlistPath = path.join(projectRoot, "external-tierlist", "state.json");

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.mkdirSync(path.dirname(eloPath), { recursive: true });
  fs.mkdirSync(path.dirname(tierlistPath), { recursive: true });

  fs.writeFileSync(dbPath, JSON.stringify({
    config: {
      integrations: {
        elo: { sourcePath: "legacy/elo-db.json" },
        tierlist: { sourcePath: tierlistPath },
      },
    },
  }, null, 2), "utf8");
  fs.writeFileSync(eloPath, JSON.stringify({ ratings: { user1: { elo: 110 } } }, null, 2), "utf8");
  fs.writeFileSync(tierlistPath, JSON.stringify({ meta: { updatedAt: "2026-05-03T12:00:00.000Z" } }, null, 2), "utf8");

  const result = snapshotDb({
    projectRoot,
    env: {
      BOT_DATA_DIR: dataRoot,
      DB_PATH: "welcome-db.json",
    },
    outputRoot: backupRoot,
    timestamp: new Date("2026-05-03T12:34:56.000Z"),
  });

  assert.equal(path.basename(result.snapshotDir), "2026-05-03T12-34-56.000Z");
  assert.equal(fs.existsSync(path.join(result.snapshotDir, "db", "welcome-db.json")), true);
  assert.equal(fs.existsSync(path.join(result.snapshotDir, "integrations", "elo", "elo-db.json")), true);
  assert.equal(fs.existsSync(path.join(result.snapshotDir, "integrations", "tierlist", "state.json")), true);

  const manifest = JSON.parse(fs.readFileSync(result.manifestPath, "utf8"));
  assert.equal(manifest.entries.find((entry) => entry.key === "db").status, "copied");
  assert.equal(manifest.entries.find((entry) => entry.key === "integrations.elo").status, "copied");
  assert.equal(manifest.entries.find((entry) => entry.key === "integrations.tierlist").status, "copied");
});

test("snapshotDb fails loudly when the primary welcome db is missing", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "moderator-snapshot-missing-"));

  assert.throws(
    () => snapshotDb({
      projectRoot,
      env: {
        BOT_DATA_DIR: path.join(projectRoot, "data"),
        DB_PATH: "welcome-db.json",
      },
      outputRoot: path.join(projectRoot, "backups"),
      timestamp: new Date("2026-05-03T12:34:56.000Z"),
    }),
    /DB snapshot source not found/
  );
});