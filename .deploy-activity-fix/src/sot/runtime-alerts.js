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

function getActionableSotCharacterAlertState(diagnostics = {}, options = {}) {
  const staleHours = Number.isFinite(Number(options.staleHours)) ? Math.max(1, Math.floor(Number(options.staleHours))) : 24;
  const unresolvedEntries = Array.isArray(diagnostics.unresolvedEntries) ? diagnostics.unresolvedEntries : [];
  const actionableUnresolvedCount = unresolvedEntries.filter((entry) => Number(entry?.evidenceCount || 0) > 0).length;
  const ambiguousCount = Number(diagnostics.ambiguousCount || 0);
  const staleCount = Number(diagnostics.staleCount || 0);
  const staleVerificationCount = Number(diagnostics.staleVerificationCount || 0);
  const attentionEntries = Array.isArray(diagnostics.attentionEntries) ? diagnostics.attentionEntries : [];

  const issueParts = [];
  if (actionableUnresolvedCount) issueParts.push(`unresolved=${actionableUnresolvedCount}`);
  if (ambiguousCount) issueParts.push(`ambiguous=${ambiguousCount}`);
  if (staleCount) issueParts.push(`staleRole=${staleCount}`);
  if (staleVerificationCount) issueParts.push(`staleVerification>${staleHours}h=${staleVerificationCount}`);

  const attentionLines = attentionEntries
    .filter((entry) => entry && (entry.status !== "unresolved" || Number(entry.evidenceCount || 0) > 0))
    .map((entry) => String(entry.line || "").trim())
    .filter(Boolean);

  return {
    issueParts,
    attentionLines,
  };
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
  getActionableSotCharacterAlertState,
  runSotStartupAlerts,
  scheduleSotAlertTicks,
};