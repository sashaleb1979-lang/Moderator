"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { publishSotChanges, snapshotSotState } = require("./bus");
const { ensureSotState } = require("./schema");

function writeJsonAtomic(filePath, value, options = {}) {
  const fsModule = options.fsModule || fs;
  const space = Number.isInteger(options.space) ? options.space : 2;
  const directory = path.dirname(filePath);
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

  fsModule.mkdirSync(directory, { recursive: true });
  try {
    fsModule.writeFileSync(tempPath, JSON.stringify(value, null, space), "utf8");
    fsModule.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      if (fsModule.existsSync(tempPath)) fsModule.unlinkSync(tempPath);
    } catch {
      // noop
    }
    throw error;
  }

  return filePath;
}

function loadSotState(db = {}, schemaOptions = {}) {
  return ensureSotState(db, schemaOptions);
}

function saveSotState({
  dbPath,
  db,
  schemaOptions = {},
  beforeWrite,
  eventBus,
  changeReason = "save",
  fsModule = fs,
  space = 2,
} = {}) {
  if (!dbPath) throw new Error("dbPath is required");
  if (!db || typeof db !== "object") throw new Error("db is required");

  const previousSot = snapshotSotState(db.sot);
  const state = ensureSotState(db, schemaOptions);
  if (typeof beforeWrite === "function") {
    beforeWrite({ dbPath, db, sot: state.sot });
  }
  writeJsonAtomic(dbPath, db, { fsModule, space });
  const changes = publishSotChanges(eventBus, {
    previousState: previousSot,
    nextState: state.sot,
    reason: changeReason,
  });

  return {
    ...state,
    changes,
    db,
    dbPath,
  };
}

function syncSotShadowState(db = {}, schemaOptions = {}) {
  return ensureSotState(db, {
    ...schemaOptions,
    refreshFromLegacy: true,
  });
}

module.exports = {
  loadSotState,
  saveSotState,
  syncSotShadowState,
  writeJsonAtomic,
};