"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createSerializedMutationTaskAdapter,
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

test("createSerializedMutationTaskAdapter adapts mutation runner to task-style activity callers", async () => {
  const calls = [];
  const runSerializedTask = createSerializedMutationTaskAdapter((options = {}) => {
    calls.push(options);
    return Promise.resolve().then(options.mutate);
  });

  const value = await runSerializedTask(async () => "ok", "activity-role-sync-from-snapshots");

  assert.equal(value, "ok");
  assert.deepEqual(calls, [
    {
      label: "activity-role-sync-from-snapshots",
      mutate: calls[0].mutate,
      shouldPersist: false,
    },
  ]);
});