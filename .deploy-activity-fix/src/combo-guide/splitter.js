"use strict";

const COMBO_MSG_LIMIT = 1500;
const TECH_MSG_LIMIT = 1800;
const DISCORD_HARD_LIMIT = 2000;

// Approximate overhead per tech link: [TechName](https://discord.com/channels/g/c/m)
// URL part is ~58 chars + markdown brackets = ~62 chars on top of the tech name itself
const TECH_LINK_OVERHEAD = 65;

/**
 * Split an array of combo objects into message chunks.
 * Each chunk is a string that fits within the limit.
 * Combos are never broken across messages.
 *
 * @param {Array<{notation, rawText, techs, damage}>} combos
 * @param {number} limit
 * @returns {string[]} Array of message content strings
 */
function splitCombosIntoMessages(combos, limit = COMBO_MSG_LIMIT) {
  const messages = [];
  let current = "";

  for (const combo of combos) {
    const block = combo.rawText;
    // Estimate link overhead: each tech name will be replaced with a link
    const linkOverhead = (combo.techs || []).length * TECH_LINK_OVERHEAD;
    const effectiveLen = block.length + linkOverhead;

    if (!current) {
      // First combo in a message
      current = block;
    } else if (current.length + 1 + effectiveLen <= limit) {
      // Fits in current message (add separator newline)
      current += "\n" + block;
    } else {
      // Doesn't fit — flush current, start new
      messages.push(current);
      current = block;
    }
  }

  if (current) {
    messages.push(current);
  }

  return messages;
}

/**
 * Split tech entries into message chunks for a thread.
 * Groups by level, never breaks a tech description.
 *
 * @param {Array<{level, name, text}>} techs
 * @param {number} limit
 * @returns {string[]} Array of message content strings
 */
function splitTechsIntoMessages(techs, limit = TECH_MSG_LIMIT) {
  if (!techs || !techs.length) return [];

  const messages = [];
  let current = "";
  let currentLevel = null;

  for (const tech of techs) {
    let block = "";

    // Add level header if changed
    if (tech.level && tech.level !== currentLevel) {
      currentLevel = tech.level;
      block += `**${currentLevel}**\n\n`;
    }

    block += tech.text;

    if (!current) {
      current = block;
    } else if (current.length + 2 + block.length <= limit) {
      current += "\n\n" + block;
    } else {
      messages.push(current);
      current = block;
    }
  }

  if (current) {
    messages.push(current);
  }

  return messages;
}

/**
 * Replace tech name references in combo text with Discord message links.
 * Only replaces techs that are mentioned inside > • Техи: lines.
 *
 * @param {string} comboText - Original combo message text
 * @param {Object<string, string>} techLinks - Map of tech name → Discord message URL
 * @returns {string} Updated text with tech names as links
 */
function injectTechLinks(comboText, techLinks) {
  if (!techLinks || !Object.keys(techLinks).length) return comboText;

  let result = comboText;

  // Replace tech names in "Техи:" lines with links
  // Pattern: find lines with > • Техи: and replace each tech name
  result = result.replace(/(>\s*•\s*Техи:\s*)(.+)/g, (match, prefix, techsPart) => {
    let updated = techsPart;
    for (const [techName, url] of Object.entries(techLinks)) {
      // Replace exact tech name (possibly with extra context in parens)
      const escaped = techName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      updated = updated.replace(
        new RegExp(`(?<!\\[)${escaped}(?!\\])`, "g"),
        `[${techName}](${url})`
      );
    }
    return prefix + updated;
  });

  return result;
}

/**
 * Build navigation text for all characters.
 * Returns array of 1-2 message strings.
 *
 * @param {Array<{emoji, name, imageMessageId}>} characters
 * @param {string} guildId
 * @param {string} channelId
 * @param {{generalTechsThreadId?: string}} options
 * @returns {string[]}
 */
function buildNavigationMessages(characters, guildId, channelId, options = {}) {
  const lines = ["# 🗺️ Навигация по комбо-гайдам\n"];

  for (const char of characters) {
    if (char.imageMessageId) {
      const url = `https://discord.com/channels/${guildId}/${channelId}/${char.imageMessageId}`;
      lines.push(`${char.emoji} [**${char.name}**](${url})`);
    } else {
      lines.push(`${char.emoji} **${char.name}**`);
    }
  }

  if (options.generalTechsThreadId) {
    const url = `https://discord.com/channels/${guildId}/${options.generalTechsThreadId}`;
    lines.push(`\n🛠️ [**Общие техи**](${url})`);
  }

  const fullText = lines.join("\n");

  // Split into 2 messages if too long
  if (fullText.length <= DISCORD_HARD_LIMIT) {
    return [fullText];
  }

  const mid = Math.ceil(characters.length / 2);
  const part1Lines = ["# 🗺️ Навигация по комбо-гайдам\n"];
  const part2Lines = [];

  for (let i = 0; i < characters.length; i++) {
    const char = characters[i];
    const line = char.imageMessageId
      ? `${char.emoji} [**${char.name}**](https://discord.com/channels/${guildId}/${channelId}/${char.imageMessageId})`
      : `${char.emoji} **${char.name}**`;

    if (i < mid) {
      part1Lines.push(line);
    } else {
      part2Lines.push(line);
    }
  }

  if (options.generalTechsThreadId) {
    const url = `https://discord.com/channels/${guildId}/${options.generalTechsThreadId}`;
    part2Lines.push(`\n🛠️ [**Общие техи**](${url})`);
  }

  return [part1Lines.join("\n"), part2Lines.join("\n")];
}

/**
 * Validate that no message exceeds Discord's hard limit.
 */
function validateMessageLengths(messages) {
  const errors = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].length > DISCORD_HARD_LIMIT) {
      errors.push(`Message ${i + 1}: ${messages[i].length} chars (limit ${DISCORD_HARD_LIMIT})`);
    }
  }
  return errors;
}

module.exports = {
  COMBO_MSG_LIMIT,
  TECH_MSG_LIMIT,
  DISCORD_HARD_LIMIT,
  splitCombosIntoMessages,
  splitTechsIntoMessages,
  injectTechLinks,
  buildNavigationMessages,
  validateMessageLengths,
};
