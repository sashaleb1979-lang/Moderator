"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createSerializedMutationRunner,
  createSerializedTaskRunner,
} = require("../src/runtime/serialized-task-runner");

test("createSerializedTaskRunner runs tasks sequentially", async () => {
  const runSerializedTask = createSerializedTaskRunner();
  const order = [];
  let releaseFirstTask = null;
  let markFirstTaskStarted = null;
  const firstTaskStarted = new Promise((resolve) => {
    markFirstTaskStarted = resolve;
  });

  const firstTask = runSerializedTask(async () => {
    order.push("first:start");
    markFirstTaskStarted();
    await new Promise((resolve) => {
      releaseFirstTask = resolve;
    });
    order.push("first:end");
    return "first-result";
  }, "first");

  const secondTask = runSerializedTask(async () => {
    order.push("second");
    return "second-result";
  }, "second");

  await firstTaskStarted;
  assert.deepEqual(order, ["first:start"]);

  releaseFirstTask();

  assert.equal(await firstTask, "first-result");
  assert.equal(await secondTask, "second-result");
  assert.deepEqual(order, ["first:start", "first:end", "second"]);
});

test("createSerializedTaskRunner keeps the queue alive after a failure", async () => {
  const loggedErrors = [];
  const runSerializedTask = createSerializedTaskRunner({
    logError: (...args) => loggedErrors.push(args.join(" ")),
  });

  await assert.rejects(
    runSerializedTask(async () => {
      throw new Error("boom");
    }, "explode"),
    /boom/
  );

  const value = await runSerializedTask(async () => "still-runs", "after-failure");

  assert.equal(value, "still-runs");
  assert.match(loggedErrors[0], /Serialized task failed \[explode\]: boom/);
});

test("createSerializedTaskRunner warns when queue depth grows past the configured threshold and recovers after drain", async () => {
  const warnings = [];
  const runSerializedTask = createSerializedTaskRunner({
    logWarning: (...args) => warnings.push(args.join(" ")),
    queueWarningThreshold: 1,
  });

  let releaseFirstTask = null;
  let markFirstTaskStarted = null;
  const firstTaskStarted = new Promise((resolve) => {
    markFirstTaskStarted = resolve;
  });
  const firstTask = runSerializedTask(async () => {
    markFirstTaskStarted();
    await new Promise((resolve) => {
      releaseFirstTask = resolve;
    });
  }, "first");

  const secondTask = runSerializedTask(async () => "second-result", "second");

  await firstTaskStarted;

  assert.deepEqual(warnings, ["Serialized task queue depth high [second]: 2"]);

  releaseFirstTask();

  await firstTask;
  await secondTask;

  assert.deepEqual(warnings, [
    "Serialized task queue depth high [second]: 2",
    "Serialized task queue depth recovered: 1",
  ]);
});

test("createSerializedTaskRunner logs long-running tasks through the watchdog and clears the timeout on completion", async () => {
  const warnings = [];
  const timers = [];
  const clearedTimers = [];
  const runSerializedTask = createSerializedTaskRunner({
    logWarning: (...args) => warnings.push(args.join(" ")),
    taskTimeoutMs: 50,
    setTimeoutFn(callback, delayMs) {
      const handle = { callback, delayMs };
      timers.push(handle);
      return handle;
    },
    clearTimeoutFn(handle) {
      clearedTimers.push(handle);
    },
  });

  let releaseTask = null;
  let markTaskStarted = null;
  const taskStarted = new Promise((resolve) => {
    markTaskStarted = resolve;
  });
  const taskPromise = runSerializedTask(async () => {
    markTaskStarted();
    await new Promise((resolve) => {
      releaseTask = resolve;
    });
    return "done";
  }, "watchdog");

  await taskStarted;

  assert.equal(timers.length, 1);
  assert.equal(timers[0].delayMs, 50);

  timers[0].callback();
  assert.deepEqual(warnings, ["Serialized task still running [watchdog] after 50ms"]);

  releaseTask();

  assert.equal(await taskPromise, "done");
  assert.deepEqual(clearedTimers, [timers[0]]);
});

test("createSerializedMutationRunner rolls back state when persist fails", async () => {
  const runSerializedMutation = createSerializedMutationRunner();
  const state = { value: 0 };
  let afterPersistCalls = 0;

  await assert.rejects(
    runSerializedMutation({
      label: "persist-failure",
      mutate: () => {
        state.value = 1;
        return { mutated: true };
      },
      shouldPersist: (result) => result?.mutated === true,
      persist: () => {
        throw new Error("disk failed");
      },
      rollback: () => {
        state.value = 0;
      },
      afterPersist: () => {
        afterPersistCalls += 1;
      },
    }),
    /disk failed/
  );

  assert.equal(state.value, 0);
  assert.equal(afterPersistCalls, 0);
});

test("createSerializedMutationRunner persists and runs afterPersist on success", async () => {
  const runSerializedMutation = createSerializedMutationRunner();
  const state = { persisted: false, completed: false };

  const result = await runSerializedMutation({
    label: "success",
    mutate: () => ({ mutated: true, value: 7 }),
    shouldPersist: (current) => current?.mutated === true,
    persist: () => {
      state.persisted = true;
    },
    afterPersist: (current) => {
      state.completed = current.value === 7;
    },
  });

  assert.deepEqual(result, { mutated: true, value: 7 });
  assert.equal(state.persisted, true);
  assert.equal(state.completed, true);
});