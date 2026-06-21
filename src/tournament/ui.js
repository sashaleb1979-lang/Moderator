"use strict";

// Components V2 primitives for the tournament UI. Components V2 (discord.js
// 14.16+, MessageFlags.IsComponentsV2) lets us build rich, accent-colored
// Container panels with text, sections, dividers, inline images and buttons
// placed right next to the content they act on — instead of plain embeds.
//
// Rules we rely on:
//  - A V2 message carries NO `content` and NO `embeds`; everything is in
//    `components`, and the message MUST set the IsComponentsV2 flag.
//  - Once a message is V2 it stays V2: every edit/update keeps the flag.
//  - A message is capped at 40 components total (nested counts), and ~4000
//    chars of text across all TextDisplay components.

const {
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  ActionRowBuilder,
} = require("discord.js");

const IS_V2 = MessageFlags.IsComponentsV2;
const EPHEMERAL = MessageFlags.Ephemeral;

// Wrap one or more top-level components into a sendable ephemeral V2 payload.
function v2Ephemeral(components, extra = {}) {
  return { components: asArray(components), flags: IS_V2 | EPHEMERAL, ...extra };
}

// Public (non-ephemeral) V2 payload. `extra` may carry files / allowedMentions.
function v2Public(components, extra = {}) {
  return { components: asArray(components), flags: IS_V2, ...extra };
}

function asArray(value) {
  return Array.isArray(value) ? value : [value];
}

function td(content) {
  return new TextDisplayBuilder().setContent(String(content == null ? "" : content).slice(0, 4000) || "​");
}

function separator({ divider = true, big = false } = {}) {
  return new SeparatorBuilder()
    .setDivider(divider)
    .setSpacing(big ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small);
}

function row(...components) {
  return new ActionRowBuilder().addComponents(...components.flat().filter(Boolean));
}

// A media gallery holding a single image (attachment://… or an https URL).
function mediaImage(url, description = "") {
  const gallery = new MediaGalleryBuilder();
  gallery.addItems((item) => {
    item.setURL(String(url));
    if (description) item.setDescription(String(description).slice(0, 256));
    return item;
  });
  return gallery;
}

// Build a Container with an accent color; `build(container)` adds children.
function container(accentColor, build) {
  const c = new ContainerBuilder();
  if (Number.isFinite(accentColor)) c.setAccentColor(accentColor);
  if (typeof build === "function") build(c);
  return c;
}

module.exports = {
  IS_V2,
  EPHEMERAL,
  v2Ephemeral,
  v2Public,
  td,
  separator,
  row,
  mediaImage,
  container,
};
