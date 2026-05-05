"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  handleSotReportButtonInteraction,
  handleSotReportModalOpenInteraction,
  handleSotReportModalSubmitInteraction,
} = require("../src/sot/report-operator");

function createInteraction(customId, member = { userId: "mod" }) {
  const calls = {
    reply: [],
    deferUpdate: 0,
    editReply: [],
  };

  return {
    interaction: {
      customId,
      member,
      async reply(payload) {
        calls.reply.push(payload);
      },
      async deferUpdate() {
        calls.deferUpdate += 1;
      },
      async editReply(payload) {
        calls.editReply.push(payload);
      },
      async showModal(payload) {
        calls.showModal = payload;
      },
      fields: {
        getTextInputValue() {
          return "";
        },
      },
    },
    calls,
  };
}

function createDeps(overrides = {}) {
  const calls = {
    report: [],
    recover: [],
    alert: [],
    cleanup: [],
    payload: [],
    noPermission: [],
  };

  return {
    calls,
    deps: {
      client: overrides.client || { id: "client" },
      isModerator: overrides.isModerator || (() => true),
      async replyNoPermission(interaction) {
        calls.noPermission.push(interaction.customId);
        await interaction.reply({ content: "Нет прав." });
      },
      async replyWithGroundTruthSotReport(interaction, client) {
        calls.report.push({ interaction: interaction.customId, client });
      },
      async ensureManagedRoles(client) {
        calls.recover.push(client);
        return overrides.managed || {
          resolvedCharacters: 5,
          recoveredCharacters: 2,
          ambiguousCharacters: 1,
          unresolvedCharacters: 3,
        };
      },
      async maybeLogSotCharacterHealthAlert(client, reason) {
        calls.alert.push({ client, reason });
      },
      async cleanupOrphanCharacterRoles(client) {
        calls.cleanup.push(client);
        return overrides.cleanupResult || { removed: 0 };
      },
      async buildGroundTruthSotReportPayload(client, statusText, includeFlags) {
        calls.payload.push({ client, statusText, includeFlags });
        return { statusText, includeFlags };
      },
    },
  };
}

function getModalInputCustomIds(modal) {
  const json = modal.toJSON();
  return json.components.map((row) => row.components[0].custom_id);
}

function createModalSubmitInteraction(customId, values = {}, member = { userId: "mod" }) {
  const { interaction, calls } = createInteraction(customId, member);
  interaction.fields = {
    getTextInputValue(fieldId) {
      return values[fieldId] ?? "";
    },
  };
  return { interaction, calls };
}

function createModalSubmitDeps(overrides = {}) {
  const calls = {
    noPermission: [],
    error: [],
    report: [],
    clearCharacter: [],
    writeCharacter: [],
    saveDb: 0,
    invalidate: 0,
    writePanel: [],
    linkChannel: [],
    clearRole: [],
    writeRole: [],
  };
  const guild = overrides.guild || {
    roles: {
      cache: new Map((overrides.roles || []).map((role) => [role.id, role])),
      async fetch(roleId) {
        if (!roleId) return null;
        return this.cache.get(roleId) || null;
      },
    },
  };

  return {
    calls,
    deps: {
      client: overrides.client || { id: "client" },
      isModerator: overrides.isModerator || (() => true),
      async replyNoPermission(interaction) {
        calls.noPermission.push(interaction.customId);
        await interaction.reply({ content: "Нет прав." });
      },
      async replyError(_interaction, text) {
        calls.error.push(text);
      },
      async replyWithGroundTruthSotReport(_interaction, client, statusText) {
        calls.report.push({ client, statusText });
      },
      parseRequestedRoleId: overrides.parseRequestedRoleId || ((value) => String(value || "").trim()),
      parseRequestedChannelId: overrides.parseRequestedChannelId || ((value) => String(value || "").trim()),
      normalizeSotReportChannelSlot: overrides.normalizeSotReportChannelSlot || ((value) => String(value || "").trim() || ""),
      normalizeNativeRoleSlot: overrides.normalizeNativeRoleSlot || ((value) => value ? { canonical: value, label: `Role ${value}` } : null),
      getConfiguredManagedCharacterCatalog: overrides.getConfiguredManagedCharacterCatalog || (() => [{ id: "honored_one", label: "Honored One" }]),
      getManagedCharacterCatalog: overrides.getManagedCharacterCatalog || (() => [{ id: "honored_one", label: "Gojo", englishLabel: "Honored One" }]),
      clearNativeCharacterRecord(options) {
        calls.clearCharacter.push(options);
        return overrides.clearCharacterResult || { mutated: true };
      },
      writeNativeCharacterRecord(options) {
        calls.writeCharacter.push(options);
        return overrides.writeCharacterResult || { mutated: true };
      },
      async getGuild() {
        return overrides.guild === null ? null : guild;
      },
      getManagedCharacterRecoveryExcludedRoleIds: overrides.getManagedCharacterRecoveryExcludedRoleIds || (() => new Set()),
      nowIso: overrides.nowIso || (() => "2026-05-05T12:00:00.000Z"),
      saveDb() {
        calls.saveDb += 1;
      },
      invalidateLiveCharacterStatsContext() {
        calls.invalidate += 1;
      },
      formatRoleMention: overrides.formatRoleMention || ((roleId) => `<@&${roleId}>`),
      formatChannelMention: overrides.formatChannelMention || ((channelId) => `<#${channelId}>`),
      previewText: overrides.previewText || ((text) => text),
      normalizeNativePanelSlot: overrides.normalizeNativePanelSlot || ((value) => value ? { canonical: value, label: `Panel ${value}` } : null),
      async writeAndApplyNativePanelOverride(client, slot, channelId) {
        calls.writePanel.push({ client, slot, channelId });
        return overrides.writePanelResult || {
          slotInfo: { canonical: slot, label: `Panel ${slot}` },
          channel: channelId ? { id: channelId } : null,
          cleared: !channelId,
        };
      },
      async applyGroundTruthReportChannelLink(client, slot, channelId) {
        calls.linkChannel.push({ client, slot, channelId });
        return overrides.linkChannelStatus || `linked:${slot}:${channelId}`;
      },
      clearNativeRoleRecord(options) {
        calls.clearRole.push(options);
        return overrides.clearRoleResult || { mutated: true };
      },
      writeNativeRoleRecord(options) {
        calls.writeRole.push(options);
        return overrides.writeRoleResult || { mutated: true };
      },
    },
  };
}

test("handleSotReportButtonInteraction opens the ground-truth report for moderators", async () => {
  const { interaction, calls: interactionCalls } = createInteraction("panel_sot_report");
  const { deps, calls } = createDeps();

  const handled = await handleSotReportButtonInteraction({
    interaction,
    ...deps,
  });

  assert.equal(handled, true);
  assert.equal(calls.report.length, 1);
  assert.equal(interactionCalls.reply.length, 0);
  assert.equal(interactionCalls.deferUpdate, 0);
});

test("handleSotReportButtonInteraction rejects non-moderators before running actions", async () => {
  const { interaction, calls: interactionCalls } = createInteraction("sot_report_refresh", { userId: "guest" });
  const { deps, calls } = createDeps({ isModerator: () => false });

  const handled = await handleSotReportButtonInteraction({
    interaction,
    ...deps,
  });

  assert.equal(handled, true);
  assert.deepEqual(calls.noPermission, ["sot_report_refresh"]);
  assert.equal(interactionCalls.deferUpdate, 0);
  assert.equal(calls.payload.length, 0);
});

test("handleSotReportButtonInteraction runs recover flow and refreshes the report payload", async () => {
  const { interaction, calls: interactionCalls } = createInteraction("sot_report_recover_characters");
  const { deps, calls } = createDeps();

  const handled = await handleSotReportButtonInteraction({
    interaction,
    ...deps,
  });

  assert.equal(handled, true);
  assert.equal(interactionCalls.deferUpdate, 1);
  assert.equal(calls.recover.length, 1);
  assert.deepEqual(calls.alert, [{ client: deps.client, reason: "sot-report-recover" }]);
  assert.deepEqual(calls.payload, [{
    client: deps.client,
    statusText: "Character recovery выполнен. Resolved 5, recovered 2, ambiguous 1, unresolved 3.",
    includeFlags: false,
  }]);
  assert.deepEqual(interactionCalls.editReply, [{
    statusText: "Character recovery выполнен. Resolved 5, recovered 2, ambiguous 1, unresolved 3.",
    includeFlags: false,
  }]);
});

test("handleSotReportButtonInteraction reports orphan cleanup results", async () => {
  const { interaction, calls: interactionCalls } = createInteraction("sot_report_cleanup_orphans");
  const { deps, calls } = createDeps({ cleanupResult: { removed: 4 } });

  const handled = await handleSotReportButtonInteraction({
    interaction,
    ...deps,
  });

  assert.equal(handled, true);
  assert.equal(interactionCalls.deferUpdate, 1);
  assert.equal(calls.cleanup.length, 1);
  assert.deepEqual(calls.payload, [{
    client: deps.client,
    statusText: "Legacy orphan character bindings очищены: 4.",
    includeFlags: false,
  }]);
});

test("handleSotReportButtonInteraction refreshes the report for verify and refresh buttons", async () => {
  for (const customId of ["sot_report_refresh", "sot_report_verify_now"]) {
    const { interaction, calls: interactionCalls } = createInteraction(customId);
    const { deps, calls } = createDeps();

    const handled = await handleSotReportButtonInteraction({
      interaction,
      ...deps,
    });

    assert.equal(handled, true);
    assert.equal(interactionCalls.deferUpdate, 1);
    assert.deepEqual(calls.payload, [{
      client: deps.client,
      statusText: "Ground-truth отчёт обновлён.",
      includeFlags: false,
    }]);
  }
});

test("handleSotReportButtonInteraction returns false for unrelated custom ids", async () => {
  const { interaction } = createInteraction("graphic_panel_refresh");
  const { deps } = createDeps();

  const handled = await handleSotReportButtonInteraction({
    interaction,
    ...deps,
  });

  assert.equal(handled, false);
});

test("handleSotReportModalOpenInteraction rejects non-moderators before opening a modal", async () => {
  const { interaction, calls: interactionCalls } = createInteraction("sot_report_manual_character", { userId: "guest" });

  const handled = await handleSotReportModalOpenInteraction({
    interaction,
    isModerator: () => false,
    replyNoPermission: async (currentInteraction) => {
      await currentInteraction.reply({ content: "Нет прав." });
    },
  });

  assert.equal(handled, true);
  assert.equal(interactionCalls.reply.length, 1);
  assert.equal(interactionCalls.showModal, undefined);
});

test("handleSotReportModalOpenInteraction opens the expected manual character modal", async () => {
  const { interaction, calls: interactionCalls } = createInteraction("sot_report_manual_character");

  const handled = await handleSotReportModalOpenInteraction({
    interaction,
    isModerator: () => true,
    replyNoPermission: async () => assert.fail("replyNoPermission should not be called"),
  });

  assert.equal(handled, true);
  assert.equal(interactionCalls.showModal.toJSON().custom_id, "sot_report_manual_character_modal");
  assert.equal(interactionCalls.showModal.toJSON().title, "Ручной SoT bind персонажа");
  assert.deepEqual(getModalInputCustomIds(interactionCalls.showModal), ["sot_character_id", "sot_role_id"]);
});

test("handleSotReportModalOpenInteraction opens the expected channel, role, and panel modals", async () => {
  const scenarios = [
    {
      customId: "sot_report_link_channel",
      modalId: "sot_report_link_channel_modal",
      title: "SoT report: link channel",
      inputIds: ["sot_channel_slot", "sot_channel_id"],
    },
    {
      customId: "sot_report_manual_role",
      modalId: "sot_report_manual_role_modal",
      title: "Manual SoT role override",
      inputIds: ["sot_manual_role_slot", "sot_manual_role_id"],
    },
    {
      customId: "sot_report_manual_panel",
      modalId: "sot_report_manual_panel_modal",
      title: "Manual SoT panel override",
      inputIds: ["sot_manual_panel_slot", "sot_manual_panel_channel"],
    },
  ];

  for (const scenario of scenarios) {
    const { interaction, calls: interactionCalls } = createInteraction(scenario.customId);

    const handled = await handleSotReportModalOpenInteraction({
      interaction,
      isModerator: () => true,
      replyNoPermission: async () => assert.fail("replyNoPermission should not be called"),
    });

    assert.equal(handled, true);
    assert.equal(interactionCalls.showModal.toJSON().custom_id, scenario.modalId);
    assert.equal(interactionCalls.showModal.toJSON().title, scenario.title);
    assert.deepEqual(getModalInputCustomIds(interactionCalls.showModal), scenario.inputIds);
  }
});

test("handleSotReportModalOpenInteraction returns false for unrelated custom ids", async () => {
  const { interaction } = createInteraction("sot_report_refresh");

  const handled = await handleSotReportModalOpenInteraction({
    interaction,
    isModerator: () => true,
    replyNoPermission: async () => assert.fail("replyNoPermission should not be called"),
  });

  assert.equal(handled, false);
});

test("handleSotReportModalSubmitInteraction rejects non-moderators before submit flows", async () => {
  const { interaction } = createModalSubmitInteraction("sot_report_manual_role_modal");
  const { deps, calls } = createModalSubmitDeps({ isModerator: () => false });

  const handled = await handleSotReportModalSubmitInteraction({
    interaction,
    ...deps,
  });

  assert.equal(handled, true);
  assert.deepEqual(calls.noPermission, ["sot_report_manual_role_modal"]);
});

test("handleSotReportModalSubmitInteraction validates missing canonical characters", async () => {
  const { interaction } = createModalSubmitInteraction("sot_report_manual_character_modal", {
    sot_character_id: "missing",
    sot_role_id: "",
  });
  const { deps, calls } = createModalSubmitDeps({ getConfiguredManagedCharacterCatalog: () => [] });

  const handled = await handleSotReportModalSubmitInteraction({
    interaction,
    ...deps,
  });

  assert.equal(handled, true);
  assert.deepEqual(calls.error, ["Такого canonical character id нет в bot.config.json."]);
});

test("handleSotReportModalSubmitInteraction saves a manual character override and refreshes the report", async () => {
  const { interaction } = createModalSubmitInteraction("sot_report_manual_character_modal", {
    sot_character_id: "honored_one",
    sot_role_id: "role-gojo",
  });
  const { deps, calls } = createModalSubmitDeps({
    roles: [{ id: "role-gojo", name: "Gojo Role" }],
  });

  const handled = await handleSotReportModalSubmitInteraction({
    interaction,
    ...deps,
  });

  assert.equal(handled, true);
  assert.deepEqual(calls.writeCharacter, [{
    characterId: "honored_one",
    label: "Gojo Role",
    englishLabel: "Honored One",
    roleId: "role-gojo",
    source: "manual",
    verifiedAt: "2026-05-05T12:00:00.000Z",
  }]);
  assert.equal(calls.saveDb, 1);
  assert.equal(calls.invalidate, 1);
  assert.deepEqual(calls.report, [{
    client: deps.client,
    statusText: "Manual override сохранён: Honored One → <@&role-gojo> (Gojo Role).",
  }]);
});

test("handleSotReportModalSubmitInteraction clears a manual panel override through the shared writer", async () => {
  const { interaction } = createModalSubmitInteraction("sot_report_manual_panel_modal", {
    sot_manual_panel_slot: "welcome",
    sot_manual_panel_channel: "",
  });
  const { deps, calls } = createModalSubmitDeps();

  const handled = await handleSotReportModalSubmitInteraction({
    interaction,
    ...deps,
  });

  assert.equal(handled, true);
  assert.deepEqual(calls.writePanel, [{
    client: deps.client,
    slot: "welcome",
    channelId: "",
  }]);
  assert.deepEqual(calls.report, [{
    client: deps.client,
    statusText: "Manual SoT panel override сброшен: Panel welcome. Ground-truth panel section остаётся legacy-backed.",
  }]);
});

test("handleSotReportModalSubmitInteraction links a channel and refreshes the report", async () => {
  const { interaction } = createModalSubmitInteraction("sot_report_link_channel_modal", {
    sot_channel_slot: "review",
    sot_channel_id: "channel-1",
  });
  const { deps, calls } = createModalSubmitDeps();

  const handled = await handleSotReportModalSubmitInteraction({
    interaction,
    ...deps,
  });

  assert.equal(handled, true);
  assert.deepEqual(calls.linkChannel, [{
    client: deps.client,
    slot: "review",
    channelId: "channel-1",
  }]);
  assert.deepEqual(calls.report, [{
    client: deps.client,
    statusText: "linked:review:channel-1",
  }]);
});

test("handleSotReportModalSubmitInteraction clears a manual role override and refreshes the report", async () => {
  const { interaction } = createModalSubmitInteraction("sot_report_manual_role_modal", {
    sot_manual_role_slot: "moderator",
    sot_manual_role_id: "",
  });
  const { deps, calls } = createModalSubmitDeps();

  const handled = await handleSotReportModalSubmitInteraction({
    interaction,
    ...deps,
  });

  assert.equal(handled, true);
  assert.deepEqual(calls.clearRole, [{ slot: "moderator" }]);
  assert.equal(calls.saveDb, 1);
  assert.deepEqual(calls.report, [{
    client: deps.client,
    statusText: "Manual SoT role override сброшен: Role moderator. Ground-truth role section остаётся legacy-backed.",
  }]);
});

test("handleSotReportModalSubmitInteraction returns false for unrelated modal ids", async () => {
  const { interaction } = createModalSubmitInteraction("rolepanel_compose_plain_modal");
  const { deps } = createModalSubmitDeps();

  const handled = await handleSotReportModalSubmitInteraction({
    interaction,
    ...deps,
  });

  assert.equal(handled, false);
});