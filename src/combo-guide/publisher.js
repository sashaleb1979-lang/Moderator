"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const { AttachmentBuilder, ChannelType } = require("discord.js");
const { parseComboFile, parseTechsFile, resolveCharacterImage } = require("./parser");
const {
  splitCombosIntoMessages,
  splitTechsIntoMessages,
  injectTechLinks,
  buildNavigationMessages,
} = require("./splitter");

const RATE_LIMIT_DELAY = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Download a Discord attachment URL to a Buffer.
 */
function downloadUrl(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https") ? https : http;
    protocol.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadUrl(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

/**
 * Send a message to a channel, respecting rate limits.
 */
async function sendMessage(channel, payload) {
  const msg = await channel.send(payload);
  await sleep(RATE_LIMIT_DELAY);
  return msg;
}

/**
 * Build the combo guide state object for the database.
 */
function createGuideState(channelId) {
  return {
    channelId,
    guildId: "",
    navTop: [],
    navBottom: [],
    generalTechsThreadId: null,
    generalTechsMessageIds: [],
    characters: [],
  };
}

/**
 * Publish the full combo guide to a channel.
 *
 * @param {Object} options
 * @param {import('discord.js').TextChannel} options.channel - Target channel
 * @param {string} options.comboText - Raw combo file content
 * @param {string} options.techsText - Raw techs file content
 * @param {string} options.assetsDir - Path to assets/characters/ directory
 * @param {Function} options.onProgress - Progress callback (step, total, description)
 * @returns {Object} Guide state for DB storage
 */
async function publishFullGuide({ channel, comboText, techsText, assetsDir, onProgress }) {
  const progress = onProgress || (() => {});
  const guildId = channel.guild.id;

  // ── 1. Parse files ──
  progress(1, 6, "Парсинг файлов…");
  const combo = parseComboFile(comboText);
  const techs = parseTechsFile(techsText);

  const state = createGuideState(channel.id);
  state.guildId = guildId;

  // ── 2. Publish character content (Pass 1: without tech links, without nav) ──
  progress(2, 6, "Публикация персонажей…");

  for (let ci = 0; ci < combo.characters.length; ci++) {
    const char = combo.characters[ci];
    progress(2, 6, `Публикация: ${char.emoji} ${char.name} (${ci + 1}/${combo.characters.length})`);

    const charState = {
      id: char.id,
      name: char.name,
      emoji: char.emoji,
      roleMention: char.roleMention,
      imageMessageId: null,
      comboMessageIds: [],
      markerMessageId: null,
      threadId: null,
      techMessageIds: [],
    };

    // ── 2a. Character image message ──
    const imageFile = resolveCharacterImage(char.name);
    const imagePath = path.join(assetsDir, imageFile);
    let headerContent = `${char.emoji} **${char.name}**`;
    if (char.roleMention) headerContent += ` — ${char.roleMention}`;

    const imagePayload = { content: headerContent };
    if (fs.existsSync(imagePath)) {
      imagePayload.files = [new AttachmentBuilder(imagePath, { name: imageFile })];
    }

    const imageMsg = await sendMessage(channel, imagePayload);
    charState.imageMessageId = imageMsg.id;

    // ── 2b. Combo messages ──
    const comboMessages = splitCombosIntoMessages(char.combos);
    for (const text of comboMessages) {
      const msg = await sendMessage(channel, { content: text });
      charState.comboMessageIds.push(msg.id);
    }

    // ── 2c. Marker message (for thread + scalability) ──
    const markerMsg = await sendMessage(channel, { content: "⠀" }); // invisible char
    charState.markerMessageId = markerMsg.id;

    // ── 2d. Create thread from marker ──
    const threadName = `${char.emoji} ${char.name} — Техи`;
    const thread = await markerMsg.startThread({
      name: threadName.slice(0, 100),
      autoArchiveDuration: 10080, // 7 days
    });
    charState.threadId = thread.id;
    await sleep(RATE_LIMIT_DELAY);

    // ── 2e. Publish techs into thread ──
    const charTechs = techs.characters[char.name] || [];
    if (charTechs.length > 0) {
      const techMessages = splitTechsIntoMessages(charTechs);
      for (const text of techMessages) {
        const msg = await sendMessage(thread, { content: text });
        charState.techMessageIds.push(msg.id);
      }
    } else {
      const placeholder = await sendMessage(thread, { content: "_Техи будут добавлены позже._" });
      charState.techMessageIds.push(placeholder.id);
    }

    state.characters.push(charState);
  }

  // ── 3. General techs thread ──
  progress(3, 6, "Публикация общих техов…");

  if (techs.general.length > 0) {
    // Create a standalone message for general techs thread anchor
    const generalAnchor = await sendMessage(channel, { content: "🛠️ **Общие техи** — см. ветку ↓" });
    const generalThread = await generalAnchor.startThread({
      name: "🛠️ Общие техи",
      autoArchiveDuration: 10080,
    });
    state.generalTechsThreadId = generalThread.id;
    await sleep(RATE_LIMIT_DELAY);

    const generalMessages = splitTechsIntoMessages(techs.general);
    for (const text of generalMessages) {
      const msg = await sendMessage(generalThread, { content: text });
      state.generalTechsMessageIds.push(msg.id);
    }
  }

  // ── 4. Inject tech links into combo messages (Pass 2) ──
  progress(4, 6, "Подстановка ссылок на техи…");

  for (const charState of state.characters) {
    // Build tech link map: techName → message URL in the character's thread
    const charTechs = techs.characters[charState.name] || [];
    if (!charTechs.length || !charState.techMessageIds.length) continue;

    const techLinkMap = buildTechLinkMap(charTechs, charState, guildId);
    if (!Object.keys(techLinkMap).length) continue;

    // Re-fetch each combo message and edit with injected links
    for (const msgId of charState.comboMessageIds) {
      try {
        const msg = await channel.messages.fetch(msgId);
        const updated = injectTechLinks(msg.content, techLinkMap);
        if (updated !== msg.content) {
          await msg.edit({ content: updated });
          await sleep(RATE_LIMIT_DELAY);
        }
      } catch (e) {
        console.warn(`Failed to inject tech links into message ${msgId}:`, e.message);
      }
    }
  }

  // ── 5. Navigation (top) ──
  progress(5, 6, "Публикация навигации…");

  const navMessages = buildNavigationMessages(
    state.characters, guildId, channel.id,
    { generalTechsThreadId: state.generalTechsThreadId }
  );

  // We need to send nav ABOVE all content. Discord doesn't allow reordering, so we
  // use a two-pass: the content is already published, now we add bottom nav,
  // then prepend the top nav by editing placeholder messages we haven't created yet.
  // Actually — we publish top nav AFTER all, then move it mentally. But Discord
  // channels show newest at bottom, messages in order. So we already published
  // everything. The nav posted now goes at the BOTTOM. We need top nav posted FIRST.
  //
  // Solution: we published everything, now add bottom nav. For top nav, we can't
  // move messages in Discord. Instead we edit the approach:
  //   - Bottom nav: post now (at the bottom of channel)
  //   - "Top nav": users see the channel from top = oldest messages first,
  //     but we published chars first without nav.
  //
  // Better approach: We should have published nav first. Let's just post bottom nav
  // now, and note that for `/combo publish` we need to restructure the order.
  //
  // Actually the simplest approach: after publishing everything, we can't insert
  // at the top. So let's restructure: pass 1 publishes nav placeholder, then chars,
  // then bottom nav. Then pass 2 edits nav placeholders with real links.

  // Post bottom navigation
  for (const navText of navMessages) {
    const msg = await sendMessage(channel, { content: navText });
    state.navBottom.push(msg.id);
  }

  // ── 6. Done ──
  progress(6, 6, "Готово!");

  return state;
}

/**
 * Publish full guide with correct ordering: nav first, then content, then nav again.
 * This is the main entry point.
 */
async function publishGuideOrdered({ channel, comboText, techsText, assetsDir, onProgress }) {
  const progress = onProgress || (() => {});
  const guildId = channel.guild.id;

  // ── 1. Parse ──
  progress(1, 7, "Парсинг файлов…");
  const combo = parseComboFile(comboText);
  const techs = parseTechsFile(techsText);

  const state = createGuideState(channel.id);
  state.guildId = guildId;

  // ── 2. Top navigation placeholders ──
  progress(2, 7, "Создание навигации (заглушки)…");
  // We don't know message IDs yet, so post placeholder text
  const navPlaceholder1 = await sendMessage(channel, { content: "🗺️ _Навигация загружается…_" });
  state.navTop.push(navPlaceholder1.id);

  // Check if we'll need 2 nav messages
  const needsSecondNav = combo.characters.length > 9;
  if (needsSecondNav) {
    const navPlaceholder2 = await sendMessage(channel, { content: "🗺️ _Навигация загружается… (часть 2)_" });
    state.navTop.push(navPlaceholder2.id);
  }

  // ── 3. General techs ──
  progress(3, 7, "Публикация общих техов…");
  if (techs.general.length > 0) {
    const generalAnchor = await sendMessage(channel, { content: "🛠️ **Общие техи** — см. ветку ↓" });
    const generalThread = await generalAnchor.startThread({
      name: "🛠️ Общие техи",
      autoArchiveDuration: 10080,
    });
    state.generalTechsThreadId = generalThread.id;
    await sleep(RATE_LIMIT_DELAY);

    const generalMessages = splitTechsIntoMessages(techs.general);
    for (const text of generalMessages) {
      const msg = await sendMessage(generalThread, { content: text });
      state.generalTechsMessageIds.push(msg.id);
    }
  }

  // ── 4. Publish characters ──
  progress(4, 7, "Публикация персонажей…");
  for (let ci = 0; ci < combo.characters.length; ci++) {
    const char = combo.characters[ci];
    progress(4, 7, `${char.emoji} ${char.name} (${ci + 1}/${combo.characters.length})`);

    const charState = {
      id: char.id,
      name: char.name,
      emoji: char.emoji,
      roleMention: char.roleMention,
      imageMessageId: null,
      comboMessageIds: [],
      markerMessageId: null,
      threadId: null,
      techMessageIds: [],
    };

    // Image
    const imageFile = resolveCharacterImage(char.name);
    const imagePath = path.join(assetsDir, imageFile);
    let headerContent = `${char.emoji} **${char.name}**`;
    if (char.roleMention) headerContent += ` — ${char.roleMention}`;

    const imagePayload = { content: headerContent };
    if (fs.existsSync(imagePath)) {
      imagePayload.files = [new AttachmentBuilder(imagePath, { name: imageFile })];
    }

    const imageMsg = await sendMessage(channel, imagePayload);
    charState.imageMessageId = imageMsg.id;

    // Combos
    const comboMessages = splitCombosIntoMessages(char.combos);
    for (const text of comboMessages) {
      const msg = await sendMessage(channel, { content: text });
      charState.comboMessageIds.push(msg.id);
    }

    // Marker
    const markerMsg = await sendMessage(channel, { content: "⠀" });
    charState.markerMessageId = markerMsg.id;

    // Thread
    const threadName = `${char.emoji} ${char.name} — Техи`;
    const thread = await markerMsg.startThread({
      name: threadName.slice(0, 100),
      autoArchiveDuration: 10080,
    });
    charState.threadId = thread.id;
    await sleep(RATE_LIMIT_DELAY);

    // Techs in thread
    const charTechs = techs.characters[char.name] || [];
    if (charTechs.length > 0) {
      const techMsgs = splitTechsIntoMessages(charTechs);
      for (const text of techMsgs) {
        const msg = await sendMessage(thread, { content: text });
        charState.techMessageIds.push(msg.id);
      }
    } else {
      const ph = await sendMessage(thread, { content: "_Техи будут добавлены позже._" });
      charState.techMessageIds.push(ph.id);
    }

    state.characters.push(charState);
  }

  // ── 5. Inject tech links (Pass 2) ──
  progress(5, 7, "Подстановка ссылок на техи…");
  for (const charState of state.characters) {
    const charTechs = techs.characters[charState.name] || [];
    if (!charTechs.length || !charState.techMessageIds.length) continue;

    const techLinkMap = buildTechLinkMap(charTechs, charState, guildId);
    if (!Object.keys(techLinkMap).length) continue;

    for (const msgId of charState.comboMessageIds) {
      try {
        const msg = await channel.messages.fetch(msgId);
        const updated = injectTechLinks(msg.content, techLinkMap);
        if (updated !== msg.content) {
          await msg.edit({ content: updated });
          await sleep(RATE_LIMIT_DELAY);
        }
      } catch (e) {
        console.warn(`Failed to inject tech links into ${msgId}:`, e.message);
      }
    }
  }

  // ── 6. Update top navigation + post bottom navigation ──
  progress(6, 7, "Обновление навигации…");
  const navMessages = buildNavigationMessages(
    state.characters, guildId, channel.id,
    { generalTechsThreadId: state.generalTechsThreadId }
  );

  // Edit top nav placeholders
  for (let i = 0; i < state.navTop.length; i++) {
    try {
      const msg = await channel.messages.fetch(state.navTop[i]);
      await msg.edit({ content: navMessages[i] || "⠀" });
      await sleep(RATE_LIMIT_DELAY);
    } catch (e) {
      console.warn(`Failed to update top nav ${i}:`, e.message);
    }
  }

  // Post bottom nav
  for (const navText of navMessages) {
    const msg = await sendMessage(channel, { content: navText });
    state.navBottom.push(msg.id);
  }

  progress(7, 7, "Готово!");
  return state;
}

/**
 * Add a single character to an existing guide.
 */
async function addCharacterToGuide({ channel, comboText, techsText, assetsDir, guideState, onProgress }) {
  const progress = onProgress || (() => {});
  const guildId = channel.guild.id;

  progress(1, 5, "Парсинг файлов…");
  const combo = parseComboFile(comboText);
  const techs = parseTechsFile(techsText);

  if (!combo.characters.length) {
    throw new Error("В файле не найдено ни одного персонажа.");
  }

  // ── 1. Delete bottom nav ──
  progress(2, 5, "Удаление нижней навигации…");
  for (const msgId of guideState.navBottom) {
    try {
      const msg = await channel.messages.fetch(msgId);
      await msg.delete();
      await sleep(RATE_LIMIT_DELAY);
    } catch (e) {
      console.warn(`Failed to delete bottom nav ${msgId}:`, e.message);
    }
  }
  guideState.navBottom = [];

  // ── 2. Publish new characters ──
  progress(3, 5, "Публикация новых персонажей…");
  for (const char of combo.characters) {
    const charState = {
      id: char.id,
      name: char.name,
      emoji: char.emoji,
      roleMention: char.roleMention,
      imageMessageId: null,
      comboMessageIds: [],
      markerMessageId: null,
      threadId: null,
      techMessageIds: [],
    };

    // Image
    const imageFile = resolveCharacterImage(char.name);
    const imagePath = path.join(assetsDir, imageFile);
    let headerContent = `${char.emoji} **${char.name}**`;
    if (char.roleMention) headerContent += ` — ${char.roleMention}`;

    const imagePayload = { content: headerContent };
    if (fs.existsSync(imagePath)) {
      imagePayload.files = [new AttachmentBuilder(imagePath, { name: imageFile })];
    }

    const imageMsg = await sendMessage(channel, imagePayload);
    charState.imageMessageId = imageMsg.id;

    // Combos
    const comboMessages = splitCombosIntoMessages(char.combos);
    for (const text of comboMessages) {
      const msg = await sendMessage(channel, { content: text });
      charState.comboMessageIds.push(msg.id);
    }

    // Marker + thread
    const markerMsg = await sendMessage(channel, { content: "⠀" });
    charState.markerMessageId = markerMsg.id;

    const threadName = `${char.emoji} ${char.name} — Техи`;
    const thread = await markerMsg.startThread({
      name: threadName.slice(0, 100),
      autoArchiveDuration: 10080,
    });
    charState.threadId = thread.id;
    await sleep(RATE_LIMIT_DELAY);

    // Techs
    const charTechs = techs.characters[char.name] || [];
    if (charTechs.length > 0) {
      const techMsgs = splitTechsIntoMessages(charTechs);
      for (const text of techMsgs) {
        const msg = await sendMessage(thread, { content: text });
        charState.techMessageIds.push(msg.id);
      }
    } else {
      const ph = await sendMessage(thread, { content: "_Техи будут добавлены позже._" });
      charState.techMessageIds.push(ph.id);
    }

    // Inject tech links
    const techLinkMap = buildTechLinkMap(charTechs, charState, guildId);
    if (Object.keys(techLinkMap).length) {
      for (const msgId of charState.comboMessageIds) {
        try {
          const msg = await channel.messages.fetch(msgId);
          const updated = injectTechLinks(msg.content, techLinkMap);
          if (updated !== msg.content) {
            await msg.edit({ content: updated });
            await sleep(RATE_LIMIT_DELAY);
          }
        } catch (e) {
          console.warn(`Failed to inject tech links into ${msgId}:`, e.message);
        }
      }
    }

    guideState.characters.push(charState);
  }

  // ── 3. Update top nav + re-post bottom nav ──
  progress(4, 5, "Обновление навигации…");
  const navMessages = buildNavigationMessages(
    guideState.characters, guildId, channel.id,
    { generalTechsThreadId: guideState.generalTechsThreadId }
  );

  // Edit top nav
  for (let i = 0; i < guideState.navTop.length; i++) {
    try {
      const msg = await channel.messages.fetch(guideState.navTop[i]);
      await msg.edit({ content: navMessages[i] || "⠀" });
      await sleep(RATE_LIMIT_DELAY);
    } catch (e) {
      console.warn(`Failed to update top nav:`, e.message);
    }
  }

  // If we now need more top nav messages (was 1, now need 2)
  if (navMessages.length > guideState.navTop.length) {
    // Can't insert in the middle, so just post extra at bottom and note it
    console.warn("Navigation grew beyond original placeholder count — consider republishing.");
  }

  // Post bottom nav
  for (const navText of navMessages) {
    const msg = await sendMessage(channel, { content: navText });
    guideState.navBottom.push(msg.id);
  }

  progress(5, 5, "Готово!");
  return guideState;
}

/**
 * Remove a character from the guide.
 */
async function removeCharacterFromGuide({ channel, guideState, characterId, onProgress }) {
  const progress = onProgress || (() => {});
  const guildId = channel.guild.id;
  const charIndex = guideState.characters.findIndex((c) => c.id === characterId);
  if (charIndex === -1) throw new Error(`Персонаж ${characterId} не найден в гайде.`);

  const charState = guideState.characters[charIndex];

  progress(1, 3, `Удаление ${charState.name}…`);

  // Delete all character messages
  const allMsgIds = [
    charState.imageMessageId,
    ...charState.comboMessageIds,
    charState.markerMessageId,
  ].filter(Boolean);

  for (const msgId of allMsgIds) {
    try {
      const msg = await channel.messages.fetch(msgId);
      await msg.delete();
      await sleep(RATE_LIMIT_DELAY);
    } catch (e) {
      /* already deleted */
    }
  }

  // Thread is auto-deleted when parent message is deleted

  guideState.characters.splice(charIndex, 1);

  // Update navigation
  progress(2, 3, "Обновление навигации…");
  await refreshNavigation({ channel, guideState });

  progress(3, 3, "Готово!");
  return guideState;
}

/**
 * Refresh navigation messages (top + bottom).
 */
async function refreshNavigation({ channel, guideState }) {
  const guildId = guideState.guildId || channel.guild.id;
  const navMessages = buildNavigationMessages(
    guideState.characters, guildId, channel.id,
    { generalTechsThreadId: guideState.generalTechsThreadId }
  );

  // Edit top nav
  for (let i = 0; i < guideState.navTop.length; i++) {
    try {
      const msg = await channel.messages.fetch(guideState.navTop[i]);
      await msg.edit({ content: navMessages[i] || "⠀" });
      await sleep(RATE_LIMIT_DELAY);
    } catch (e) {
      console.warn(`Failed to update top nav:`, e.message);
    }
  }

  // Delete old bottom nav
  for (const msgId of guideState.navBottom) {
    try {
      const msg = await channel.messages.fetch(msgId);
      await msg.delete();
      await sleep(RATE_LIMIT_DELAY);
    } catch (e) { /* ok */ }
  }
  guideState.navBottom = [];

  // Post new bottom nav
  for (const navText of navMessages) {
    const msg = await channel.send(navText);
    guideState.navBottom.push(msg.id);
    await sleep(RATE_LIMIT_DELAY);
  }
}

/**
 * Delete the entire guide from a channel.
 */
async function deleteFullGuide({ channel, guideState }) {
  // Collect all message IDs
  const allIds = [
    ...guideState.navTop,
    ...guideState.navBottom,
  ];

  for (const char of guideState.characters) {
    if (char.imageMessageId) allIds.push(char.imageMessageId);
    allIds.push(...char.comboMessageIds);
    if (char.markerMessageId) allIds.push(char.markerMessageId);
  }

  // Delete in batches of 100 (bulkDelete)
  const unique = [...new Set(allIds.filter(Boolean))];
  const TWO_WEEKS = 14 * 24 * 60 * 60 * 1000;

  for (let i = 0; i < unique.length; i += 100) {
    const batch = unique.slice(i, i + 100);
    try {
      // Filter recent messages for bulkDelete
      const messages = [];
      for (const id of batch) {
        try {
          const msg = await channel.messages.fetch(id);
          messages.push(msg);
        } catch (e) { /* already deleted */ }
      }

      const recent = messages.filter((m) => Date.now() - m.createdTimestamp < TWO_WEEKS);
      const old = messages.filter((m) => Date.now() - m.createdTimestamp >= TWO_WEEKS);

      if (recent.length > 1) {
        await channel.bulkDelete(recent);
      } else {
        for (const m of recent) await m.delete().catch(() => {});
      }

      for (const m of old) {
        await m.delete().catch(() => {});
        await sleep(RATE_LIMIT_DELAY);
      }
    } catch (e) {
      console.warn(`Bulk delete failed, falling back to individual:`, e.message);
      for (const id of batch) {
        try {
          const msg = await channel.messages.fetch(id);
          await msg.delete();
          await sleep(500);
        } catch (e2) { /* ok */ }
      }
    }
  }
}

// ── Helpers ──

/**
 * Build a map from tech name to Discord message URL.
 * Maps each tech to the thread message that contains it.
 */
function buildTechLinkMap(charTechs, charState, guildId) {
  if (!charTechs.length || !charState.threadId) return {};

  const techMsgTexts = splitTechsIntoMessages(charTechs);
  const map = {};

  for (let mi = 0; mi < techMsgTexts.length; mi++) {
    const msgId = charState.techMessageIds[mi];
    if (!msgId) continue;

    const url = `https://discord.com/channels/${guildId}/${charState.threadId}/${msgId}`;

    // Find which tech names are in this message
    for (const tech of charTechs) {
      if (techMsgTexts[mi].includes(`**${tech.name}**`)) {
        map[tech.name] = url;
      }
    }
  }

  return map;
}

module.exports = {
  publishGuideOrdered,
  addCharacterToGuide,
  removeCharacterFromGuide,
  refreshNavigation,
  deleteFullGuide,
  downloadUrl,
  buildTechLinkMap,
};
