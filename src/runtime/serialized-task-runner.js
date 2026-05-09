"use strict";

function formatErrorText(error) {
  return error?.message || error;
}

function createSerializedTaskRunner({ logError = () => {} } = {}) {
  if (typeof logError !== "function") {
    throw new TypeError("logError must be a function");
  }

  let queueTail = Promise.resolve();

  return function runSerializedTask(task, label = "task") {
    if (typeof task !== "function") {
      throw new TypeError("task must be a function");
    }

    const taskLabel = String(label || "task").trim() || "task";
    const scheduledTask = queueTail.then(
      () => Promise.resolve().then(task),
      () => Promise.resolve().then(task)
    );

    queueTail = scheduledTask.catch((error) => {
      logError(`Serialized task failed [${taskLabel}]:`, formatErrorText(error));
      return null;
    });

    return scheduledTask;
  };
}

function createSerializedMutationRunner({ logError = () => {} } = {}) {
  const runSerializedTask = createSerializedTaskRunner({ logError });

  return function runSerializedMutation({
    label = "mutation",
    mutate,
    shouldPersist = null,
    persist = null,
    rollback = null,
    afterPersist = null,
  } = {}) {
    if (typeof mutate !== "function") {
      throw new TypeError("mutate must be a function");
    }
    if (persist != null && typeof persist !== "function") {
      throw new TypeError("persist must be a function");
    }
    if (rollback != null && typeof rollback !== "function") {
      throw new TypeError("rollback must be a function");
    }
    if (afterPersist != null && typeof afterPersist !== "function") {
      throw new TypeError("afterPersist must be a function");
    }

    return runSerializedTask(async () => {
      let result;

      try {
        result = await Promise.resolve().then(mutate);
        const persistResult = typeof shouldPersist === "function"
          ? shouldPersist(result)
          : shouldPersist !== false;

        if (persistResult && typeof persist === "function") {
          await Promise.resolve().then(persist);
        }

        if (typeof afterPersist === "function") {
          await Promise.resolve().then(() => afterPersist(result));
        }

        return result;
      } catch (error) {
        if (typeof rollback === "function") {
          await Promise.resolve().then(() => rollback(error, result));
        }
        throw error;
      }
    }, label);
  };
}

function createSerializedMutationTaskAdapter(runSerializedMutation) {
  if (typeof runSerializedMutation !== "function") {
    throw new TypeError("runSerializedMutation must be a function");
  }

  return function runSerializedTask(task, label = "task") {
    return runSerializedMutation({
      label,
      mutate: task,
      shouldPersist: false,
    });
  };
}

module.exports = {
  createSerializedMutationTaskAdapter,
  createSerializedMutationRunner,
  createSerializedTaskRunner,
};