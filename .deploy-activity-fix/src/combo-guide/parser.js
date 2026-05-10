"use strict";

/**
 * CHARACTER_IMAGE_MAP: maps character name (from combo file) to PNG filename in assets/characters/.
 * Keys are lowercase for case-insensitive lookup.
 */
const CHARACTER_IMAGE_MAP = {
  "honored one": "honored_one.png",
  "vessel": "vessel.png",
  "restless gambler": "restless_gambler.png",
  "ten shadows": "ten_shadows.png",
  "mahoraga": "ten_shadows.png",
  "perfection": "perfection.png",
  "blood manipulator": "blood_manipulator.png",
  "switcher": "switcher.png",
  "defense attorney": "defense_attorney.png",
  "cursed partners": "cursed_partners.png",
  "puppet master": "puppet_master.png",
  "head of the hei": "head_of_the_hei.png",
  "salaryman": "salaryman.png",
  "disaster plants": "disaster_plants.png",
  "true cannon": "ryu.png",
  "locust guy": "locust_guy.png",
  "star rage": "star_rage.png",
  "aspiring mangaka": "aspiring_mangaka.png",
  "lucky coward": "lucky_coward.png",
  "crow charmer": "crow_charmer.png",
};

/**
 * Slugify a character name to a filesystem-safe id.
 * "Honored One" → "honored_one"
 */
function slugify(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

/**
 * Resolve the image filename for a character name.
 */
function resolveCharacterImage(name) {
  return CHARACTER_IMAGE_MAP[name.toLowerCase().trim()] || `${slugify(name)}.png`;
}

// ───────── Combo parser ─────────

/**
 * Detect whether a line is a character header.
 * Pattern: emoji + **Name** + optional ` - <@&roleId>`
 * Examples:
 *   🔵 **Honored One**  - <@&1488952717044089064>
 *   🔴 **Vessel** - <@&1489063258227998821>
 */
const CHARACTER_HEADER_RE = /^(.+?)\s*\*\*(.+?)\*\*\s*(?:-\s*(<@&\d+>))?\s*$/;

/**
 * Detect whether a line starts a combo notation.
 * Pattern: **bold text containing typical combo keywords**
 * Must start with ** and contain at least one of: M1, Uppercut, Downslam, Dash, Front Dash, Side, R, or digit
 */
const COMBO_NOTATION_RE = /^\*\*(.+?)\*\*\s*$/;
function looksLikeComboNotation(boldContent) {
  // Real combo notations always contain " + " separating terms
  return boldContent.includes(" + ");
}

/**
 * Extract tech names from a blockquote line like:
 *   > • Техи: Rapid Kick, RRTP
 *   > • Техи: Blue Downslam, Kick 'n Slam
 */
function extractTechs(line) {
  const match = line.match(/>\s*•\s*Техи:\s*(.+)/i);
  if (!match) return [];
  return match[1].split(/,\s*/).map((t) => t.trim()).filter(Boolean);
}

/**
 * Extract damage from a blockquote line like:
 *   > **Урон:** 71.25
 *   > **Урон:** ~79.75
 *   > **Урон:** 74.25 (84.25, если попал R)
 */
function extractDamage(line) {
  const match = line.match(/>\s*\*\*Урон:\*\*\s*(.+)/);
  return match ? match[1].trim() : null;
}

/**
 * Parse a combo text file into an array of character objects.
 *
 * @param {string} text - Raw content of combo.txt
 * @returns {{ preamble: string, characters: Array<{emoji, name, roleMention, id, imageFile, combos: Array}> }}
 */
function parseComboFile(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const characters = [];
  let preamble = "";
  let current = null; // current character
  let currentCombo = null; // current combo block

  function flushCombo() {
    if (currentCombo && current) {
      currentCombo.rawText = currentCombo._lines.join("\n").trim();
      delete currentCombo._lines;
      current.combos.push(currentCombo);
    }
    currentCombo = null;
  }

  function flushCharacter() {
    flushCombo();
    if (current) characters.push(current);
    current = null;
  }

  let inPreamble = true;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for character header (skip blockquote lines)
    const headerMatch = !line.trimStart().startsWith(">") && line.match(CHARACTER_HEADER_RE);
    if (headerMatch && headerMatch[2]) {
      const potentialEmoji = headerMatch[1].trim();
      const potentialName = headerMatch[2].trim();
      // Validate this is really a character header (emoji should be short, name should look like a name)
      if (potentialName.length >= 2 && potentialEmoji.length <= 6) {
        inPreamble = false;
        flushCharacter();
        current = {
          emoji: potentialEmoji,
          name: potentialName,
          roleMention: headerMatch[3] || "",
          id: slugify(potentialName),
          imageFile: resolveCharacterImage(potentialName),
          combos: [],
        };
        continue;
      }
    }

    if (inPreamble) {
      preamble += line + "\n";
      continue;
    }

    if (!current) continue;

    // Check for combo notation start
    const notationMatch = line.match(COMBO_NOTATION_RE);
    if (notationMatch && looksLikeComboNotation(notationMatch[1])) {
      flushCombo();
      currentCombo = {
        notation: notationMatch[1].trim(),
        rawText: "",
        techs: [],
        damage: null,
        _lines: [line],
      };
      continue;
    }

    // Inside a combo block — accumulate lines
    if (currentCombo) {
      currentCombo._lines.push(line);

      // Extract techs
      const techs = extractTechs(line);
      if (techs.length) currentCombo.techs.push(...techs);

      // Extract damage
      const damage = extractDamage(line);
      if (damage) currentCombo.damage = damage;
      continue;
    }

    // Lines between character header and first combo (e.g., blank lines) — ignore
  }

  flushCharacter();

  return { preamble: preamble.trim(), characters };
}

// ───────── Techs parser ─────────

/**
 * Parse a techs text file.
 *
 * @param {string} text - Raw content of techs.txt
 * @returns {{ preamble: string, general: Array<{level, name, text}>, characters: Object<string, Array<{level, name, text}>> }}
 */
function parseTechsFile(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const result = {
    preamble: "",
    general: [],
    characters: {},
  };

  let section = "preamble"; // "preamble" | "general" | characterName
  let currentLevel = "";
  let currentTech = null;
  let preambleLines = [];

  const GENERAL_HEADER_RE = /^🛠️\s*\*\*Общие техи\*\*/;
  const LEVEL_RE = /^\*\*(Новичок|Средний уровень|Продвинутый уровень)\*\*\s*$/;
  const TECH_NAME_RE = /^\*\*(.+?)\*\*\s*$/;

  function flushTech() {
    if (!currentTech) return;
    currentTech.text = currentTech._lines.join("\n").trim();
    delete currentTech._lines;

    if (section === "general") {
      result.general.push(currentTech);
    } else if (section && section !== "preamble") {
      if (!result.characters[section]) result.characters[section] = [];
      result.characters[section].push(currentTech);
    }
    currentTech = null;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // General techs header
    if (GENERAL_HEADER_RE.test(line)) {
      flushTech();
      section = "general";
      currentLevel = "";
      continue;
    }

    // Character header in techs file (same emoji + **Name** pattern, skip blockquotes)
    const charHeader = !line.trimStart().startsWith(">") && line.match(CHARACTER_HEADER_RE);
    if (charHeader && charHeader[2] && section !== "preamble") {
      const potentialName = charHeader[2].trim();
      if (potentialName.length >= 2 && charHeader[1].trim().length <= 6) {
        flushTech();
        section = potentialName;
        currentLevel = "";
        continue;
      }
    }

    // Level header
    const levelMatch = line.match(LEVEL_RE);
    if (levelMatch && section !== "preamble") {
      flushTech();
      currentLevel = levelMatch[1];
      continue;
    }

    // Tech name (bold line that's not a level, not a blockquote, not a combo notation)
    const techMatch = !line.trimStart().startsWith(">") && line.match(TECH_NAME_RE);
    if (techMatch && section !== "preamble") {
      flushTech();
      currentTech = {
        level: currentLevel,
        name: techMatch[1].trim(),
        text: "",
        _lines: [line],
      };
      continue;
    }

    // Accumulate lines
    if (section === "preamble") {
      preambleLines.push(line);
    } else if (currentTech) {
      currentTech._lines.push(line);
    }
  }

  flushTech();
  result.preamble = preambleLines.join("\n").trim();
  return result;
}

module.exports = {
  CHARACTER_IMAGE_MAP,
  slugify,
  resolveCharacterImage,
  parseComboFile,
  parseTechsFile,
};
