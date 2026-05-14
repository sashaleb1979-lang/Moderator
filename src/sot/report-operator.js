"use strict";

const {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

const SOT_REPORT_REFRESH_ACTION_IDS = new Set([
  "sot_report_refresh",
  "sot_report_verify_now",
  "sot_report_recover_characters",
  "sot_report_cleanup_orphans",
]);

const SOT_REPORT_MODAL_BUILDERS = {
  sot_report_manual_character: () => new ModalBuilder()
    .setCustomId("sot_report_manual_character_modal")
    .setTitle("Ручной SoT bind персонажа")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("sot_character_id")
          .setLabel("Character ID")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(80)
          .setPlaceholder("Например honored_one")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("sot_role_id")
          .setLabel("Role ID / mention / пусто")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(80)
          .setPlaceholder("123456789012345678, <@&123456789012345678> или пусто для сброса")
      )
    ),
  sot_report_link_channel: () => new ModalBuilder()
    .setCustomId("sot_report_link_channel_modal")
    .setTitle("SoT report: link channel")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("sot_channel_slot")
          .setLabel("Slot")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(40)
          .setPlaceholder("welcome / review / tierlistText / tierlistGraphic / log")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("sot_channel_id")
          .setLabel("Channel ID или mention")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(80)
          .setPlaceholder("123456789012345678 или <#123456789012345678>")
      )
    ),
  sot_report_manual_role: () => new ModalBuilder()
    .setCustomId("sot_report_manual_role_modal")
    .setTitle("Manual SoT role override")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("sot_manual_role_slot")
          .setLabel("Role slot")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(40)
          .setPlaceholder("moderator / accessNormal / killTier:1 / killMilestone:20k / legacyEloTier:1")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("sot_manual_role_id")
          .setLabel("Role ID / mention / пусто")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(80)
          .setPlaceholder("123456789012345678, <@&...> или пусто для сброса")
      )
    ),
  sot_report_manual_panel: () => new ModalBuilder()
    .setCustomId("sot_report_manual_panel_modal")
    .setTitle("Manual SoT panel override")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("sot_manual_panel_slot")
          .setLabel("Panel slot")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(40)
          .setPlaceholder("welcome / nonGgs / eloSubmit / eloGraphic / dashboard / summary")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("sot_manual_panel_channel")
          .setLabel("Channel ID / mention / пусто")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(80)
          .setPlaceholder("123456789012345678, <#...> или пусто для сброса")
      )
    ),
};

function assertFunction(value, name) {
  if (typeof value !== "function") {
    throw new TypeError(`${name} must be a function`);
  }
}

async function handleSotReportButtonInteraction({
  interaction,
  client,
  isModerator,
  replyNoPermission,
  replyWithGroundTruthSotReport,
  ensureManagedRoles,
  maybeLogSotCharacterHealthAlert,
  cleanupOrphanCharacterRoles,
  buildGroundTruthSotReportPayload,
} = {}) {
  const customId = String(interaction?.customId || "").trim();
  if (!customId) return false;

  if (customId === "panel_sot_report") {
    assertFunction(isModerator, "isModerator");
    assertFunction(replyNoPermission, "replyNoPermission");
    assertFunction(replyWithGroundTruthSotReport, "replyWithGroundTruthSotReport");

    if (!isModerator(interaction?.member)) {
      await replyNoPermission(interaction);
      return true;
    }

    await replyWithGroundTruthSotReport(interaction, client);
    return true;
  }

  if (!SOT_REPORT_REFRESH_ACTION_IDS.has(customId)) {
    return false;
  }

  assertFunction(isModerator, "isModerator");
  assertFunction(replyNoPermission, "replyNoPermission");
  assertFunction(ensureManagedRoles, "ensureManagedRoles");
  assertFunction(maybeLogSotCharacterHealthAlert, "maybeLogSotCharacterHealthAlert");
  assertFunction(cleanupOrphanCharacterRoles, "cleanupOrphanCharacterRoles");
  assertFunction(buildGroundTruthSotReportPayload, "buildGroundTruthSotReportPayload");

  if (!isModerator(interaction?.member)) {
    await replyNoPermission(interaction);
    return true;
  }

  await interaction.deferUpdate();

  let statusText = "Ground-truth отчёт обновлён.";
  if (customId === "sot_report_recover_characters") {
    const managed = await ensureManagedRoles(client);
    await maybeLogSotCharacterHealthAlert(client, "sot-report-recover");
    statusText = `Character recovery выполнен. Resolved ${managed.resolvedCharacters}, recovered ${managed.recoveredCharacters}, ambiguous ${managed.ambiguousCharacters}, unresolved ${managed.unresolvedCharacters}.`;
  } else if (customId === "sot_report_cleanup_orphans") {
    const result = await cleanupOrphanCharacterRoles(client);
    statusText = result.removed
      ? `Legacy orphan character bindings очищены: ${result.removed}.`
      : "Legacy orphan character bindings не найдены.";
  }

  await interaction.editReply(await buildGroundTruthSotReportPayload(client, statusText, false));
  return true;
}

async function handleSotReportModalOpenInteraction({
  interaction,
  isModerator,
  replyNoPermission,
} = {}) {
  const customId = String(interaction?.customId || "").trim();
  const buildModal = SOT_REPORT_MODAL_BUILDERS[customId] || null;
  if (!buildModal) return false;

  assertFunction(isModerator, "isModerator");
  assertFunction(replyNoPermission, "replyNoPermission");

  if (!isModerator(interaction?.member)) {
    await replyNoPermission(interaction);
    return true;
  }

  await interaction.showModal(buildModal());
  return true;
}

async function handleSotReportModalSubmitInteraction({
  interaction,
  client,
  isModerator,
  replyNoPermission,
  replyError,
  replyWithGroundTruthSotReport,
  parseRequestedRoleId,
  parseRequestedChannelId,
  normalizeSotReportChannelSlot,
  normalizeNativeRoleSlot,
  getConfiguredManagedCharacterCatalog,
  getManagedCharacterCatalog,
  clearNativeCharacterRecord,
  writeNativeCharacterRecord,
  getGuild,
  getManagedCharacterRecoveryExcludedRoleIds,
  nowIso,
  saveDb,
  invalidateLiveCharacterStatsContext,
  formatRoleMention,
  formatChannelMention,
  previewText,
  normalizeNativePanelSlot,
  writeAndApplyNativePanelOverride,
  applyGroundTruthReportChannelLink,
  clearNativeRoleRecord,
  writeNativeRoleRecord,
} = {}) {
  const customId = String(interaction?.customId || "").trim();
  if (![
    "sot_report_manual_character_modal",
    "sot_report_manual_panel_modal",
    "sot_report_link_channel_modal",
    "sot_report_manual_role_modal",
  ].includes(customId)) {
    return false;
  }

  assertFunction(isModerator, "isModerator");
  assertFunction(replyNoPermission, "replyNoPermission");
  assertFunction(replyError, "replyError");
  assertFunction(replyWithGroundTruthSotReport, "replyWithGroundTruthSotReport");

  if (!isModerator(interaction?.member)) {
    await replyNoPermission(interaction);
    return true;
  }

  if (customId === "sot_report_manual_character_modal") {
    assertFunction(parseRequestedRoleId, "parseRequestedRoleId");
    assertFunction(getConfiguredManagedCharacterCatalog, "getConfiguredManagedCharacterCatalog");
    assertFunction(getManagedCharacterCatalog, "getManagedCharacterCatalog");
    assertFunction(clearNativeCharacterRecord, "clearNativeCharacterRecord");
    assertFunction(writeNativeCharacterRecord, "writeNativeCharacterRecord");
    assertFunction(getGuild, "getGuild");
    assertFunction(getManagedCharacterRecoveryExcludedRoleIds, "getManagedCharacterRecoveryExcludedRoleIds");
    assertFunction(nowIso, "nowIso");
    assertFunction(saveDb, "saveDb");
    assertFunction(invalidateLiveCharacterStatsContext, "invalidateLiveCharacterStatsContext");
    assertFunction(formatRoleMention, "formatRoleMention");
    assertFunction(previewText, "previewText");

    const characterId = String(interaction.fields.getTextInputValue("sot_character_id") || "").trim();
    const roleId = parseRequestedRoleId(interaction.fields.getTextInputValue("sot_role_id"), "");
    const configuredCharacter = getConfiguredManagedCharacterCatalog().find((entry) => entry.id === characterId) || null;

    if (!configuredCharacter) {
      await replyError(interaction, "Такого canonical character id нет в bot.config.json.");
      return true;
    }

    let writeResult;
    let statusText;
    if (!roleId) {
      const currentCharacter = getManagedCharacterCatalog().find((entry) => entry.id === characterId) || configuredCharacter;
      writeResult = clearNativeCharacterRecord({
        characterId,
        label: currentCharacter?.label || configuredCharacter.label || characterId,
        englishLabel: configuredCharacter.label || currentCharacter?.englishLabel || characterId,
        source: "default",
      });
      statusText = `Manual override сброшен: ${configuredCharacter.label}.`;
    } else {
      const guild = await getGuild(client).catch(() => null);
      if (!guild) {
        await replyError(interaction, "Не удалось получить guild для проверки роли.");
        return true;
      }

      await guild.roles.fetch().catch(() => null);
      const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
      if (!role) {
        await replyError(interaction, "Роль не найдена на сервере.");
        return true;
      }

      if (getManagedCharacterRecoveryExcludedRoleIds(guild).has(role.id)) {
        await replyError(interaction, "Эту роль нельзя привязывать как character role: она входит в служебный/access/tier pool.");
        return true;
      }

      writeResult = writeNativeCharacterRecord({
        characterId,
        label: role.name,
        englishLabel: configuredCharacter.label || role.name || characterId,
        roleId: role.id,
        source: "manual",
        verifiedAt: nowIso(),
      });
      statusText = `Manual override сохранён: ${configuredCharacter.label} → ${formatRoleMention(role.id)} (${previewText(role.name, 80)}).`;
    }

    if (writeResult.mutated) {
      saveDb();
      invalidateLiveCharacterStatsContext();
    }

    await replyWithGroundTruthSotReport(interaction, client, statusText);
    return true;
  }

  if (customId === "sot_report_manual_panel_modal") {
    assertFunction(normalizeNativePanelSlot, "normalizeNativePanelSlot");
    assertFunction(parseRequestedChannelId, "parseRequestedChannelId");
    assertFunction(writeAndApplyNativePanelOverride, "writeAndApplyNativePanelOverride");
    assertFunction(formatChannelMention, "formatChannelMention");

    const slotInfo = normalizeNativePanelSlot(interaction.fields.getTextInputValue("sot_manual_panel_slot"));
    const channelId = parseRequestedChannelId(interaction.fields.getTextInputValue("sot_manual_panel_channel"), "");
    if (!slotInfo) {
      await replyError(interaction, "Неизвестный panel slot. Используй welcome / nonGgs / eloSubmit / eloGraphic / dashboard / summary.");
      return true;
    }

    let statusText;
    try {
      const result = await writeAndApplyNativePanelOverride(client, slotInfo.canonical, channelId);
      statusText = result.cleared
        ? `Manual SoT panel override сброшен: ${result.slotInfo.label}. Ground-truth panel section остаётся legacy-backed.`
        : `Manual SoT panel override сохранён: ${result.slotInfo.label} → ${formatChannelMention(result.channel?.id || channelId)}. Ground-truth panel section остаётся legacy-backed.`;
    } catch (error) {
      await replyError(interaction, String(error?.message || error || "Не удалось обновить panel override."));
      return true;
    }

    await replyWithGroundTruthSotReport(interaction, client, statusText);
    return true;
  }

  if (customId === "sot_report_link_channel_modal") {
    assertFunction(normalizeSotReportChannelSlot, "normalizeSotReportChannelSlot");
    assertFunction(parseRequestedChannelId, "parseRequestedChannelId");
    assertFunction(applyGroundTruthReportChannelLink, "applyGroundTruthReportChannelLink");

    const slot = normalizeSotReportChannelSlot(interaction.fields.getTextInputValue("sot_channel_slot"));
    const channelId = parseRequestedChannelId(interaction.fields.getTextInputValue("sot_channel_id"), "");
    if (!slot) {
      await replyError(interaction, "Неизвестный slot. Используй welcome / review / tierlistText / tierlistGraphic / log.");
      return true;
    }
    if (!channelId) {
      await replyError(interaction, "Некорректный Channel ID или mention канала.");
      return true;
    }

    try {
      const statusText = await applyGroundTruthReportChannelLink(client, slot, channelId);
      await replyWithGroundTruthSotReport(interaction, client, statusText);
    } catch (error) {
      await replyError(interaction, String(error?.message || error || "Не удалось привязать канал."));
    }
    return true;
  }

  assertFunction(normalizeNativeRoleSlot, "normalizeNativeRoleSlot");
  assertFunction(parseRequestedRoleId, "parseRequestedRoleId");
  assertFunction(clearNativeRoleRecord, "clearNativeRoleRecord");
  assertFunction(writeNativeRoleRecord, "writeNativeRoleRecord");
  assertFunction(getGuild, "getGuild");
  assertFunction(nowIso, "nowIso");
  assertFunction(saveDb, "saveDb");
  assertFunction(formatRoleMention, "formatRoleMention");
  assertFunction(previewText, "previewText");

  const slotInfo = normalizeNativeRoleSlot(interaction.fields.getTextInputValue("sot_manual_role_slot"));
  const roleId = parseRequestedRoleId(interaction.fields.getTextInputValue("sot_manual_role_id"), "");
  if (!slotInfo) {
    await replyError(interaction, "Неизвестный role slot. Используй moderator / accessNormal / accessWartime / accessNonJjs / killTier:1..5 / killMilestone:20k|30k / legacyEloTier:1..4.");
    return true;
  }

  let writeResult;
  let statusText;
  if (!roleId) {
    writeResult = clearNativeRoleRecord({ slot: slotInfo.canonical });
    statusText = `Manual SoT role override сброшен: ${slotInfo.label}. Ground-truth role section остаётся legacy-backed.`;
  } else {
    const guild = await getGuild(client).catch(() => null);
    if (!guild) {
      await replyError(interaction, "Не удалось получить guild для проверки роли.");
      return true;
    }

    await guild.roles.fetch().catch(() => null);
    const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
    if (!role) {
      await replyError(interaction, "Роль не найдена на сервере.");
      return true;
    }

    writeResult = writeNativeRoleRecord({
      slot: slotInfo.canonical,
      roleId: role.id,
      source: "manual",
      verifiedAt: nowIso(),
      evidence: {
        manualOverride: true,
        guildRoleName: role.name,
      },
    });
    statusText = `Manual SoT role override сохранён: ${slotInfo.label} → ${formatRoleMention(role.id)} (${previewText(role.name, 80)}). Ground-truth role section остаётся legacy-backed.`;
  }

  if (writeResult.mutated) {
    saveDb();
  }

  await replyWithGroundTruthSotReport(interaction, client, statusText);
  return true;
}

module.exports = {
  handleSotReportButtonInteraction,
  handleSotReportModalOpenInteraction,
  handleSotReportModalSubmitInteraction,
};