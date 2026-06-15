"use strict";

// Offloads CPU-heavy image rendering (pureimage) to a long-lived worker thread
// so it never blocks the main event loop / interaction handling.
//
// Safety: renderOffThread ALWAYS falls back to running the render inline on the
// main thread if the worker is unavailable or fails. Both paths call the SAME
// module export, so the output is identical — the worker just moves the work off
// the event loop. The worker is reused across renders (pureimage + fonts stay
// warm) and respawned automatically if it dies.

const path = require("node:path");

let Worker = null;
try {
  ({ Worker } = require("node:worker_threads"));
} catch {
  Worker = null;
}

const WORKER_PATH = path.join(__dirname, "render-worker.js");

let worker = null;
let nextRequestId = 1;
const pending = new Map();

function rejectAllPending(error) {
  for (const entry of pending.values()) {
    entry.reject(error);
  }
  pending.clear();
  syncWorkerRef();
}

// Keep the worker referenced (holding the event loop open) only while renders
// are in flight; unref it when idle so it never blocks process shutdown. A bare
// pending promise does not keep the loop alive, so without this the process
// could exit mid-render when nothing else is active.
function syncWorkerRef() {
  if (!worker) return;
  if (pending.size > 0) {
    if (typeof worker.ref === "function") worker.ref();
  } else if (typeof worker.unref === "function") {
    worker.unref();
  }
}

function ensureWorker() {
  if (!Worker) return null;
  if (worker) return worker;
  try {
    const instance = new Worker(WORKER_PATH);
    instance.on("message", (message) => {
      const entry = pending.get(message?.id);
      if (!entry) return;
      pending.delete(message.id);
      syncWorkerRef();
      if (message.ok) {
        const result = Buffer.isBuffer(message.result) ? message.result : Buffer.from(message.result);
        entry.resolve(result);
      } else {
        entry.reject(new Error(message.error || "render worker error"));
      }
    });
    instance.on("error", (error) => {
      worker = null;
      rejectAllPending(error instanceof Error ? error : new Error(String(error)));
    });
    instance.on("exit", () => {
      if (worker === instance) worker = null;
      rejectAllPending(new Error("render worker exited"));
    });
    if (typeof instance.unref === "function") instance.unref();
    worker = instance;
    return worker;
  } catch {
    worker = null;
    return null;
  }
}

function isWorkerRenderAvailable() {
  return Boolean(Worker);
}

// Run `mod[exportName](...args)` in the render worker, returning a Buffer.
// If the worker can't be used or throws, falls back to `inlineFallback()`.
async function renderOffThread({ modulePath, exportName, args = [] } = {}, inlineFallback) {
  const activeWorker = ensureWorker();
  if (!activeWorker) {
    if (typeof inlineFallback === "function") return inlineFallback();
    throw new Error("render worker unavailable and no inline fallback provided");
  }

  const id = nextRequestId++;
  try {
    return await new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      syncWorkerRef();
      activeWorker.postMessage({ id, modulePath, exportName, args });
    });
  } catch (error) {
    pending.delete(id);
    syncWorkerRef();
    if (typeof inlineFallback === "function") return inlineFallback();
    throw error;
  }
}

async function shutdownRenderPool() {
  const instance = worker;
  worker = null;
  rejectAllPending(new Error("render pool shut down"));
  if (instance && typeof instance.terminate === "function") {
    try { await instance.terminate(); } catch { /* noop */ }
  }
}

module.exports = {
  renderOffThread,
  isWorkerRenderAvailable,
  shutdownRenderPool,
};
