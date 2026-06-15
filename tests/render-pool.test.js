"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { renderOffThread, isWorkerRenderAvailable, shutdownRenderPool } = require("../src/runtime/render-pool");

const FIXTURE = require.resolve("./fixtures/render-fixture.js");

test.after(async () => {
  await shutdownRenderPool();
});

test("worker_threads is available in this runtime", () => {
  assert.equal(isWorkerRenderAvailable(), true);
});

test("renderOffThread runs the export in a worker and returns its buffer", async () => {
  const result = await renderOffThread(
    { modulePath: FIXTURE, exportName: "echo", args: [{ a: 1, b: "x" }] },
    () => Buffer.from("inline")
  );
  assert.ok(Buffer.isBuffer(result));
  assert.equal(result.toString(), 'echo:{"a":1,"b":"x"}');
});

test("renderOffThread reuses the worker across calls", async () => {
  const first = await renderOffThread({ modulePath: FIXTURE, exportName: "echo", args: [1] }, () => Buffer.from("inline"));
  const second = await renderOffThread({ modulePath: FIXTURE, exportName: "echo", args: [2] }, () => Buffer.from("inline"));
  assert.equal(first.toString(), "echo:1");
  assert.equal(second.toString(), "echo:2");
});

test("renderOffThread falls back to inline when the worker export throws", async () => {
  const result = await renderOffThread(
    { modulePath: FIXTURE, exportName: "boom", args: [] },
    () => Buffer.from("inline-fallback")
  );
  assert.equal(result.toString(), "inline-fallback");
});

test("renderOffThread falls back to inline for a missing export", async () => {
  const result = await renderOffThread(
    { modulePath: FIXTURE, exportName: "nope", args: [] },
    () => Buffer.from("inline-missing")
  );
  assert.equal(result.toString(), "inline-missing");
});
