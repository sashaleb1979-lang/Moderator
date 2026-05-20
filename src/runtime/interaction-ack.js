"use strict";

const { MessageFlags } = require("discord.js");

const INTERACTION_PAYLOAD_TIMEOUT_CODE = "INTERACTION_PAYLOAD_TIMEOUT";
const DEFAULT_INTERACTION_PAYLOAD_TIMEOUT_MS = 5000;

function isUnknownInteractionError(error) {
  if (Number(error?.code) === 10062) return true;
  return /Unknown interaction/i.test(String(error?.message || error || ""));
}

function getAckLabel(interaction, label = "") {
  const explicitLabel = String(label || "").trim();
  if (explicitLabel) return explicitLabel;

  const commandName = String(interaction?.commandName || "").trim();
  if (commandName) return commandName;

  const customId = String(interaction?.customId || "").trim();
  if (customId) return customId;

  return "interaction";
}

function isInteractionPayloadTimeoutError(error) {
  return String(error?.code || "").trim() === INTERACTION_PAYLOAD_TIMEOUT_CODE
    || String(error?.name || "").trim() === "InteractionPayloadTimeoutError";
}

async function resolveInteractionPayloadWithTimeout(buildPayload, options = {}) {
  if (typeof buildPayload !== "function") {
    throw new TypeError("buildPayload must be a function");
  }

  const timeoutMs = Math.max(1, Number(options.timeoutMs) || DEFAULT_INTERACTION_PAYLOAD_TIMEOUT_MS);
  const ackLabel = getAckLabel(null, options.label);
  const logWarning = typeof options.logWarning === "function"
    ? options.logWarning
    : () => {};

  let timeoutHandle = null;
  const payloadOutcomePromise = Promise.resolve()
    .then(() => buildPayload())
    .then(
      (value) => ({ status: "fulfilled", value }),
      (error) => ({ status: "rejected", error })
    );
  const timeoutOutcomePromise = new Promise((resolve) => {
    timeoutHandle = setTimeout(() => resolve({ status: "timeout" }), timeoutMs);
  });

  const outcome = await Promise.race([payloadOutcomePromise, timeoutOutcomePromise]);
  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
  }

  if (outcome.status === "fulfilled") {
    return outcome.value;
  }

  if (outcome.status === "rejected") {
    throw outcome.error;
  }

  const error = new Error(`${ackLabel}: interaction payload build timed out after ${timeoutMs}ms.`);
  error.code = INTERACTION_PAYLOAD_TIMEOUT_CODE;
  error.name = "InteractionPayloadTimeoutError";
  error.timeoutMs = timeoutMs;
  logWarning(error.message);
  throw error;
}

async function safeDeferEphemeralReply(interaction, options = {}) {
  if (!interaction) return false;
  if (interaction.deferred || interaction.replied) return true;

  const logWarning = typeof options.logWarning === "function"
    ? options.logWarning
    : () => {};
  const ackLabel = getAckLabel(interaction, options.label);

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return true;
  } catch (error) {
    if (isUnknownInteractionError(error)) {
      logWarning(`${ackLabel}: interaction ack expired before deferReply.`);
      return false;
    }
    throw error;
  }
}

async function safeDeferComponentUpdate(interaction, options = {}) {
  if (!interaction) return false;
  if (interaction.deferred || interaction.replied) return true;

  const logWarning = typeof options.logWarning === "function"
    ? options.logWarning
    : () => {};
  const ackLabel = getAckLabel(interaction, options.label);

  try {
    await interaction.deferUpdate();
    return true;
  } catch (error) {
    if (isUnknownInteractionError(error)) {
      logWarning(`${ackLabel}: interaction ack expired before deferUpdate.`);
      return false;
    }
    throw error;
  }
}

module.exports = {
  DEFAULT_INTERACTION_PAYLOAD_TIMEOUT_MS,
  isUnknownInteractionError,
  isInteractionPayloadTimeoutError,
  resolveInteractionPayloadWithTimeout,
  safeDeferComponentUpdate,
  safeDeferEphemeralReply,
};