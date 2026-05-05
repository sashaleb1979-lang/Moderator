"use strict";

function formatErrorText(error) {
  return error?.message || error;
}

function assertFunction(value, name) {
  if (typeof value !== "function") {
    throw new TypeError(`${name} must be a function`);
  }
}

function callAlert(handler, client, reason, failurePrefix, logError) {
  return Promise.resolve()
    .then(() => handler(client, reason))
    .catch((error) => {
      logError(failurePrefix, formatErrorText(error));
    });
}

async function runSotStartupAlerts(client, options = {}) {
  const {
    maybeLogSotCharacterHealthAlert,
    maybeLogSotDriftAlert,
    logError = () => {},
  } = options;

  assertFunction(maybeLogSotCharacterHealthAlert, "maybeLogSotCharacterHealthAlert");
  assertFunction(maybeLogSotDriftAlert, "maybeLogSotDriftAlert");
  assertFunction(logError, "logError");

  await callAlert(
    maybeLogSotCharacterHealthAlert,
    client,
    "startup",
    "SoT character startup alert failed:",
    logError
  );
  await callAlert(
    maybeLogSotDriftAlert,
    client,
    "startup",
    "SoT drift startup alert failed:",
    logError
  );
}

function scheduleSotAlertTicks(client, options = {}) {
  const {
    maybeLogSotCharacterHealthAlert,
    maybeLogSotDriftAlert,
    characterPeriodicMs,
    driftPeriodicMs = characterPeriodicMs,
    setIntervalFn = setInterval,
    logError = () => {},
  } = options;

  assertFunction(maybeLogSotCharacterHealthAlert, "maybeLogSotCharacterHealthAlert");
  assertFunction(maybeLogSotDriftAlert, "maybeLogSotDriftAlert");
  assertFunction(setIntervalFn, "setIntervalFn");
  assertFunction(logError, "logError");

  const intervals = [];
  intervals.push(setIntervalFn(
    () => callAlert(
      maybeLogSotCharacterHealthAlert,
      client,
      "periodic",
      "SoT character alert tick failed:",
      logError
    ),
    characterPeriodicMs
  ));
  intervals.push(setIntervalFn(
    () => callAlert(
      maybeLogSotDriftAlert,
      client,
      "periodic",
      "SoT drift alert tick failed:",
      logError
    ),
    driftPeriodicMs
  ));

  return intervals;
}

module.exports = {
  runSotStartupAlerts,
  scheduleSotAlertTicks,
};