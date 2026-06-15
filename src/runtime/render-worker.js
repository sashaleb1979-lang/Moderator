"use strict";

// Generic render worker. Receives { id, modulePath, exportName, args }, requires
// the module, calls the named export with the args, and posts the result back.
// Kept deliberately dumb: the heavy CPU work (pureimage drawing/encoding) runs
// here, off the main event loop, while the main thread stays responsive.

const { parentPort } = require("node:worker_threads");

if (parentPort) {
  parentPort.on("message", async (message) => {
    const { id, modulePath, exportName, args } = message || {};
    try {
      const mod = require(modulePath);
      const fn = mod && mod[exportName];
      if (typeof fn !== "function") {
        throw new Error(`render worker: export "${exportName}" not found in ${modulePath}`);
      }
      const result = await fn(...(Array.isArray(args) ? args : []));
      parentPort.postMessage({ id, ok: true, result });
    } catch (error) {
      parentPort.postMessage({ id, ok: false, error: String(error?.message || error) });
    }
  });
}
