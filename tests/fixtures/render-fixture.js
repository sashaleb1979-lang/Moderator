"use strict";

// Fixture module used by tests/render-pool.test.js to exercise the worker.
module.exports = {
  echo(value) {
    return Buffer.from(`echo:${JSON.stringify(value)}`);
  },
  boom() {
    throw new Error("fixture boom");
  },
};
