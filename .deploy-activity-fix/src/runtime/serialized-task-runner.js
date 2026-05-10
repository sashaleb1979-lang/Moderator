"use strict";

function formatErrorText(error) {
  return error?.message || error;
}

function normalizePositiveInteger(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

function createSerializedTaskRunner({
  logError = () => {},
  logWarning = () => {},
  taskTimeoutMs = 0,
  queueWarningThreshold = 0,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  if (typeof logError !== "function") {
    throw new TypeError("logError must be a function");
  }
  if (typeof logWarning !== "function") {
    throw new TypeError("logWarning must be a function");
  }
  if (typeof setTimeoutFn !== "function") {
    throw new TypeError("setTimeoutFn must be a function");
  }
  if (typeof clearTimeoutFn !== "function") {
    throw new TypeError("clearTimeoutFn must be a function");
  }

  let queueTail = Promise.resolve();
  let pendingTasks = 0;
  let queueDepthWarningActive = false;
  const normalizedTaskTimeoutMs = normalizePositiveInteger(taskTimeoutMs, 0);
  const normalizedQueueWarningThreshold = normalizePositiveInteger(queueWarningThreshold, 0);

  const updateQueueDepthState = (taskLabel) => {
    if (normalizedQueueWarningThreshold <= 0) {
      return;
    }

    if (!queueDepthWarningActive && pendingTasks > normalizedQueueWarningThreshold) {
      queueDepthWarningActive = true;
      logWarning(`Serialized task queue depth high [${taskLabel}]:`, String(pendingTasks));
      return;
    }

    if (queueDepthWarningActive && pendingTasks <= normalizedQueueWarningThreshold) {
      queueDepthWarningActive = false;
      logWarning("Serialized task queue depth recovered:", String(pendingTasks));
    }
  };

  return function runSerializedTask(task, label = "task") {
    if (typeof task !== "function") {
      throw new TypeError("task must be a function");
    }

    const taskLabel = String(label || "task").trim() || "task";
    pendingTasks += 1;
    updateQueueDepthState(taskLabel);

    const scheduledTask = queueTail.then(
      () => {
        let timeoutHandle = null;
        if (normalizedTaskTimeoutMs > 0) {
          timeoutHandle = setTimeoutFn(() => {
            logWarning(`Serialized task still running [${taskLabel}] after ${normalizedTaskTimeoutMs}ms`);
          }, normalizedTaskTimeoutMs);
          if (typeof timeoutHandle?.unref === "function") {
            timeoutHandle.unref();
          }
        }

        return Promise.resolve()
          .then(task)
          .finally(() => {
            if (timeoutHandle != null) {
              clearTimeoutFn(timeoutHandle);
            }
          });
      },
      () => {
        let timeoutHandle = null;
        if (normalizedTaskTimeoutMs > 0) {
          timeoutHandle = setTimeoutFn(() => {
            logWarning(`Serialized task still running [${taskLabel}] after ${normalizedTaskTimeoutMs}ms`);
          }, normalizedTaskTimeoutMs);
          if (typeof timeoutHandle?.unref === "function") {
            timeoutHandle.unref();
          }
        }

        return Promise.resolve()
          .then(task)
          .finally(() => {
            if (timeoutHandle != null) {
              clearTimeoutFn(timeoutHandle);
            }
          });
      }
    );

    queueTail = scheduledTask
      .catch((error) => {
        logError(`Serialized task failed [${taskLabel}]:`, formatErrorText(error));
        return null;
      })
      .finally(() => {
        pendingTasks = Math.max(0, pendingTasks - 1);
        updateQueueDepthState(taskLabel);
      });

    return scheduledTask;
  };
}

function createSerializedMutationRunner(options = {}) {
  const runSerializedTask = createSerializedTaskRunner(options);

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

module.exports = {
  createSerializedMutationRunner,
  createSerializedTaskRunner,
};