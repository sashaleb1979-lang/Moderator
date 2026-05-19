"use strict";

const { MessageFlags } = require("discord.js");

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

module.exports = {
  isUnknownInteractionError,
  safeDeferEphemeralReply,
};