"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ONBOARD_ACCESS_GRANT_MODES,
  createOnboardAccessGrantState,
  getOnboardAccessGrantModeLabel,
  normalizeOnboardAccessGrantMode,
} = require("../src/onboard/access-grant-mode");
const { ONBOARD_BEGIN_ROUTES, resolveOnboardBeginRoute } = require("../src/onboard/begin-state");
const {
  ONBOARD_ACCESS_MODES,
  createOnboardModeState,
  getOnboardAccessModeLabel,
  isApocalypseMode,
  normalizeOnboardAccessMode,
  resolveGrantedAccessRoleId,
} = require("../src/onboard/access-mode");
const { commitMutation } = require("../src/onboard/refresh-runner");
const {
  ONBOARD_SUBCOMMAND_NAMES,
  PROFILE_COMMAND_NAME,
  ROLE_PANEL_COMMAND_NAME,
  TOP_LEVEL_COMMAND_NAMES,
  VERIFY_COMMAND_NAME,
  VERIFY_SUBCOMMAND_NAMES,
  buildCommands,
} = require("../src/onboard/commands");
const { resolveNonJjsCaptchaMode } = require("../src/onboard/non-jjs-mode");
const {
  DEFAULT_ROLE_PANEL_BUTTON_LABEL,
  ROLE_PANEL_CLEANUP_BEHAVIORS,
  ROLE_PANEL_FORMATS,
  ROLE_PANEL_PICKER_PAGE_SIZE,
  ROLE_PANEL_PICKER_SCOPES,
  buildRoleGrantCustomId,
  createRoleMessageDraftFromRecord,
  filterRolePanelPickerItems,
  getRoleGrantRecords,
  normalizeRoleGrantRegistry,
  normalizeRoleMessageDraft,
  normalizeRolePanelPickerState,
  paginateRolePanelPickerItems,
  parseRoleGrantCustomId,
  validateRoleMessageDraft,
} = require("../src/role-panel");
const {
  getCharacterRoleStats,
  getMainStats,
  getTierlistStats,
  getTrackedMemberStats,
} = require("../src/onboard/tierlist-stats");
const {
  createPresentationDefaults,
  ensurePresentationConfig,
  getGraphicTierlistBoardState,
  getNonGgsPanelState,
  getTextTierlistBoardState,
  getTierLabel,
  resolvePresentation,
} = require("../src/onboard/presentation");

const DEFAULT_GRAPHIC_TIER_COLORS = {
  1: "#111111",
  2: "#222222",
  3: "#333333",
  4: "#444444",
  5: "#555555",
};

test("migrates legacy tierlist and graphic config into unified presentation state", () => {
  const fileConfig = {
    ui: { tierlistTitle: "File text title" },
    graphicTierlist: { title: "File graphic title", subtitle: "File graphic subtitle" },
    killTierLabels: { 1: "File tier 1" },
  };
  const dbConfig = {
    tierlistBoard: {
      channelId: "text-channel",
      textMessageId: "text-message",
      graphicChannelId: "graphic-channel",
      graphicMessageId: "graphic-message",
    },
    graphicTierlist: {
      title: "Legacy graphic title",
      messageText: "Legacy graphic text",
      tierLabels: { 1: "Legacy tier one" },
      tierColors: { 5: "#abcdef" },
      image: { width: 2400, icon: 144 },
      panel: { selectedTier: 4 },
      lastUpdated: 123456,
    },
  };

  const result = ensurePresentationConfig(dbConfig, {
    defaults: createPresentationDefaults(fileConfig, { defaultGraphicTierColors: DEFAULT_GRAPHIC_TIER_COLORS }),
    defaultWelcomeChannelId: "welcome-channel",
    defaultTextTierlistChannelId: "text-channel",
    defaultGraphicTierColors: DEFAULT_GRAPHIC_TIER_COLORS,
  });

  assert.equal(result.mutated, true);
  assert.deepEqual(dbConfig.tierlistBoard.text, {
    channelId: "text-channel",
    messageIdSummary: "text-message",
    messageIdPages: "",
  });
  assert.deepEqual(dbConfig.tierlistBoard.graphic, {
    channelId: "graphic-channel",
    messageId: "graphic-message",
    lastUpdated: 123456,
  });
  assert.equal(dbConfig.presentation.tierlist.graphicTitle, "Legacy graphic title");
  assert.equal(dbConfig.presentation.tierlist.graphicMessageText, "Legacy graphic text");
  assert.equal(dbConfig.presentation.tierlist.labels[1], "Legacy tier one");
  assert.equal(dbConfig.presentation.tierlist.graphic.colors[5], "#abcdef");
  assert.equal(dbConfig.presentation.tierlist.graphic.image.width, 2400);
  assert.equal(dbConfig.presentation.tierlist.graphic.image.icon, 144);
  assert.equal(dbConfig.presentation.tierlist.graphic.panel.selectedTier, 4);
});

test("presentation resolution prefers db overrides over file defaults and hard defaults", () => {
  const fileConfig = {
    welcomeEmbed: {
      title: "File welcome title",
      description: "File welcome text",
      steps: ["F1", "F2", "F3", "F4", "F5"],
    },
    ui: {
      getRoleButtonLabel: "File start",
      quickMainsButtonLabel: "File quick",
      tierlistTitle: "File text tierlist",
    },
    graphicTierlist: {
      title: "File graphic title",
      subtitle: "File graphic text",
      tierColors: { 3: "#c0ffee" },
    },
    killTierLabels: {
      1: "File tier one",
      2: "File tier two",
    },
  };
  const dbConfig = {
    presentation: {
      welcome: {
        title: "DB welcome title",
        buttons: { begin: "DB start" },
      },
      tierlist: {
        graphicMessageText: "DB graphic text",
        labels: { 1: "DB tier one" },
      },
    },
  };

  const resolved = resolvePresentation(dbConfig, fileConfig, {
    defaultGraphicTierColors: DEFAULT_GRAPHIC_TIER_COLORS,
  });

  assert.equal(resolved.welcome.title, "DB welcome title");
  assert.equal(resolved.welcome.description, "File welcome text");
  assert.deepEqual(resolved.welcome.steps, ["F1", "F2", "F3", "F4", "F5"]);
  assert.equal(resolved.welcome.submitStep.title, "Готово. Кидай kills и общий скрин");
  assert.match(resolved.welcome.submitStep.description, /\{\{uploadTarget\}\}/);
  assert.deepEqual(resolved.welcome.buttons, {
    begin: "DB start",
    quickMains: "File quick",
  });
  assert.equal(resolved.tierlist.textTitle, "File text tierlist");
  assert.equal(resolved.tierlist.graphicTitle, "File graphic title");
  assert.equal(resolved.tierlist.graphicMessageText, "DB graphic text");
  assert.equal(getTierLabel(resolved, 1), "DB tier one");
  assert.equal(getTierLabel(resolved, 2), "File tier two");
  assert.equal(resolved.tierlist.graphic.colors[3], "#c0ffee");
  assert.equal(resolved.tierlist.graphic.colors[5], "#555555");
});

test("presentation resolution prefers submit-step overrides over defaults", () => {
  const resolved = resolvePresentation({
    presentation: {
      welcome: {
        submitStep: {
          title: "Custom submit title",
          description: "Отправь всё в {{uploadTarget}}. {{exampleNote}}",
        },
      },
    },
  }, {}, {
    defaultGraphicTierColors: DEFAULT_GRAPHIC_TIER_COLORS,
  });

  assert.equal(resolved.welcome.submitStep.title, "Custom submit title");
  assert.equal(resolved.welcome.submitStep.description, "Отправь всё в {{uploadTarget}}. {{exampleNote}}");
});

test("ensurePresentationConfig drops stale myCard button config", () => {
  const dbConfig = {
    presentation: {
      welcome: {
        buttons: {
          begin: "Start",
          quickMains: "Quick",
          myCard: "Old card",
        },
      },
    },
  };

  const result = ensurePresentationConfig(dbConfig, {
    defaults: createPresentationDefaults({}, { defaultGraphicTierColors: DEFAULT_GRAPHIC_TIER_COLORS }),
    defaultWelcomeChannelId: "welcome-home",
    defaultTextTierlistChannelId: "text-home",
    defaultGraphicTierColors: DEFAULT_GRAPHIC_TIER_COLORS,
  });

  assert.equal(result.mutated, true);
  assert.deepEqual(dbConfig.presentation.welcome.buttons, {
    begin: "Start",
    quickMains: "Quick",
  });
});

test("text and graphic board states stay separate after migration and direct updates", () => {
  const dbConfig = {
    tierlistBoard: {
      channelId: "text-home",
      textMessageId: "text-message",
      graphicChannelId: "graphic-home",
      graphicMessageId: "graphic-message",
    },
  };

  ensurePresentationConfig(dbConfig, {
    defaults: createPresentationDefaults({}, { defaultGraphicTierColors: DEFAULT_GRAPHIC_TIER_COLORS }),
    defaultWelcomeChannelId: "welcome-home",
    defaultTextTierlistChannelId: "text-home",
    defaultGraphicTierColors: DEFAULT_GRAPHIC_TIER_COLORS,
  });

  const textBoard = getTextTierlistBoardState(dbConfig, "text-home");
  const graphicBoard = getGraphicTierlistBoardState(dbConfig, "text-home");

  graphicBoard.channelId = "graphic-moved";
  graphicBoard.messageId = "graphic-new";
  textBoard.messageIdSummary = "text-summary";
  textBoard.messageIdPages = "text-pages";

  assert.deepEqual(textBoard, {
    channelId: "text-home",
    messageIdSummary: "text-summary",
    messageIdPages: "text-pages",
  });
  assert.deepEqual(graphicBoard, {
    channelId: "graphic-moved",
    messageId: "graphic-new",
    lastUpdated: null,
  });
});

test("getNonGgsPanelState keeps its own channel instead of mirroring welcome panel state on read", () => {
  const dbConfig = {
    welcomePanel: {
      channelId: "welcome-home",
      messageId: "welcome-message",
    },
    nonGgsPanel: {
      channelId: "captcha-home",
      messageId: "captcha-message",
    },
  };

  const state = getNonGgsPanelState(dbConfig, "welcome-fallback", "welcome-home");

  assert.deepEqual(state, {
    channelId: "captcha-home",
    messageId: "captcha-message",
  });
  assert.equal(dbConfig.nonGgsPanel.channelId, "captcha-home");
});

test("getNonGgsPanelState falls back to the welcome channel only when nonGgs state is missing", () => {
  const dbConfig = {
    welcomePanel: {
      channelId: "welcome-home",
      messageId: "welcome-message",
    },
  };

  const state = getNonGgsPanelState(dbConfig, "welcome-fallback", "welcome-home");

  assert.deepEqual(state, {
    channelId: "welcome-home",
    messageId: "",
  });
});

test("ensurePresentationConfig migrates nested text board legacy messageId into summary and deletes the old key", () => {
  const dbConfig = {
    tierlistBoard: {
      text: {
        channelId: "text-home",
        messageId: "legacy-summary",
      },
      graphic: {
        channelId: "graphic-home",
        messageId: "graphic-message",
      },
    },
  };

  const result = ensurePresentationConfig(dbConfig, {
    defaults: createPresentationDefaults({}, { defaultGraphicTierColors: DEFAULT_GRAPHIC_TIER_COLORS }),
    defaultWelcomeChannelId: "welcome-home",
    defaultTextTierlistChannelId: "text-home",
    defaultGraphicTierColors: DEFAULT_GRAPHIC_TIER_COLORS,
  });

  assert.equal(result.mutated, true);
  assert.deepEqual(dbConfig.tierlistBoard.text, {
    channelId: "text-home",
    messageIdSummary: "legacy-summary",
    messageIdPages: "",
  });
  assert.equal("messageId" in dbConfig.tierlistBoard.text, false);
});

test("ensurePresentationConfig clears stale nested text board messageId once split-layout ids exist", () => {
  const dbConfig = {
    tierlistBoard: {
      text: {
        channelId: "text-home",
        messageId: "stale-main",
        messageIdSummary: "text-summary",
        messageIdPages: "text-pages",
      },
      graphic: {
        channelId: "graphic-home",
        messageId: "graphic-message",
      },
    },
  };

  const result = ensurePresentationConfig(dbConfig, {
    defaults: createPresentationDefaults({}, { defaultGraphicTierColors: DEFAULT_GRAPHIC_TIER_COLORS }),
    defaultWelcomeChannelId: "welcome-home",
    defaultTextTierlistChannelId: "text-home",
    defaultGraphicTierColors: DEFAULT_GRAPHIC_TIER_COLORS,
  });

  assert.equal(result.mutated, true);
  assert.deepEqual(dbConfig.tierlistBoard.text, {
    channelId: "text-home",
    messageIdSummary: "text-summary",
    messageIdPages: "text-pages",
  });
  assert.equal("messageId" in dbConfig.tierlistBoard.text, false);
});

test("ensurePresentationConfig canonicalizes legacy nonJjsUi into presentation.nonGgs and deletes legacy keys", () => {
  const dbConfig = {
    nonJjsUi: {
      title: "Captcha title",
      description: "Captcha text",
      buttonLabel: "Start captcha",
    },
  };

  const result = ensurePresentationConfig(dbConfig, {
    defaults: createPresentationDefaults({}, { defaultGraphicTierColors: DEFAULT_GRAPHIC_TIER_COLORS }),
    defaultWelcomeChannelId: "welcome-home",
    defaultTextTierlistChannelId: "text-home",
    defaultGraphicTierColors: DEFAULT_GRAPHIC_TIER_COLORS,
  });

  assert.equal(result.mutated, true);
  assert.deepEqual(dbConfig.presentation.nonGgs, {
    title: "Captcha title",
    description: "Captcha text",
    buttonLabel: "Start captcha",
  });
  assert.equal("nonJjsUi" in dbConfig, false);
});

test("presentation resolution exposes canonical nonGgs content from presentation overrides", () => {
  const resolved = resolvePresentation({
    presentation: {
      nonGgs: {
        title: "Canonical title",
        description: "Canonical description",
        buttonLabel: "Canonical button",
      },
    },
  }, {}, { defaultGraphicTierColors: DEFAULT_GRAPHIC_TIER_COLORS });

  assert.deepEqual(resolved.nonGgs, {
    title: "Canonical title",
    description: "Canonical description",
    buttonLabel: "Canonical button",
  });
});

test("commitMutation persists before refreshing the graphic board", async () => {
  const calls = [];
  const state = { counter: 0 };

  await commitMutation({
    mutate: () => {
      state.counter += 1;
      calls.push("mutate");
    },
    persist: () => {
      calls.push(`save:${state.counter}`);
    },
    scope: "graphic",
    refreshers: {
      refreshGraphicTierlistBoard: () => {
        calls.push(`refresh:${state.counter}`);
      },
    },
  });

  assert.deepEqual(calls, ["mutate", "save:1", "refresh:1"]);
});

test("tierlist stats count approval/reject rates and per-main aggregates", () => {
  const entries = [
    { displayName: "Alpha", approvedKills: 1000, killTier: 2, mains: ["Gojo", "Megumi"] },
    { displayName: "Beta", approvedKills: 3000, killTier: 3, mains: ["Gojo"] },
    { displayName: "Gamma", approvedKills: 7000, killTier: 4, mains: ["Megumi", "Megumi"] },
  ];
  const submissions = [
    { status: "approved" },
    { status: "approved" },
    { status: "rejected" },
    { status: "pending" },
    { status: "superseded" },
  ];

  const tierlistStats = getTierlistStats(entries, submissions);
  const mainStats = getMainStats(entries);
  const gojo = mainStats.find((entry) => entry.main === "Gojo");
  const megumi = mainStats.find((entry) => entry.main === "Megumi");

  assert.equal(tierlistStats.totalVerified, 3);
  assert.equal(tierlistStats.pendingCount, 1);
  assert.equal(tierlistStats.approvedCount, 2);
  assert.equal(tierlistStats.rejectedCount, 1);
  assert.ok(Math.abs(tierlistStats.approvalRate - (200 / 3)) < 1e-9);
  assert.ok(Math.abs(tierlistStats.rejectRate - (100 / 3)) < 1e-9);
  assert.deepEqual(tierlistStats.totalsByTier, { 1: 0, 2: 1, 3: 1, 4: 1, 5: 0 });

  assert.deepEqual(mainStats.map((entry) => entry.main), ["Megumi", "Gojo"]);
  assert.equal(gojo.playerCount, 2);
  assert.equal(gojo.averageKills, 2000);
  assert.equal(gojo.medianKills, 2000);
  assert.deepEqual(gojo.totalsByTier, { 1: 0, 2: 1, 3: 1, 4: 0, 5: 0 });
  assert.equal(megumi.playerCount, 2);
  assert.equal(megumi.averageKills, 4000);
  assert.equal(megumi.medianKills, 4000);
  assert.deepEqual(megumi.totalsByTier, { 1: 0, 2: 1, 3: 0, 4: 1, 5: 0 });
});

test("tracked member stats count only live role holders with remembered approved kills", () => {
  const trackedMembers = [
    { userId: "1", approvedKills: 500, killTier: 1 },
    { userId: "2", approvedKills: 3200, killTier: 3 },
    { userId: "3", approvedKills: null, killTier: null },
    { userId: "4", approvedKills: 11000, killTier: 5 },
  ];

  assert.deepEqual(getTrackedMemberStats(trackedMembers), {
    totalRoleHolders: 4,
    rememberedCount: 3,
    totalKills: 14700,
    averageKills: 4900,
    medianKills: 3200,
    totalsByTier: { 1: 1, 2: 0, 3: 1, 4: 0, 5: 1 },
  });
});

test("tracked member stats ignore null and empty kills instead of coercing them to zero", () => {
  const trackedMembers = [
    { userId: "1", approvedKills: null, killTier: 1 },
    { userId: "2", approvedKills: "", killTier: 2 },
    { userId: "3", approvedKills: 0, killTier: 1 },
  ];

  assert.deepEqual(getTrackedMemberStats(trackedMembers), {
    totalRoleHolders: 3,
    rememberedCount: 1,
    totalKills: 0,
    averageKills: 0,
    medianKills: 0,
    totalsByTier: { 1: 1, 2: 0, 3: 0, 4: 0, 5: 0 },
  });
});

test("tracked member stats ignore leaked users without a live kill role", () => {
  const trackedMembers = [
    { userId: "1", approvedKills: 500, killTier: 1, hasLiveKillRole: true },
    { userId: "2", approvedKills: 3200, killTier: 3, hasLiveKillRole: false },
    { userId: "3", approvedKills: 11000, killTier: 5 },
  ];

  assert.deepEqual(getTrackedMemberStats(trackedMembers), {
    totalRoleHolders: 2,
    rememberedCount: 2,
    totalKills: 11500,
    averageKills: 5750,
    medianKills: 5750,
    totalsByTier: { 1: 1, 2: 0, 3: 0, 4: 0, 5: 1 },
  });
});

test("character role stats separate live holders from remembered kills", () => {
  const characterStats = getCharacterRoleStats([
    {
      main: "Юджи",
      roleId: "role-yuji",
      roleHolderCount: 28,
      rememberedMembers: [
        { userId: "1", approvedKills: 1000, killTier: 2 },
        { userId: "2", approvedKills: 3000, killTier: 3 },
      ],
    },
    {
      main: "Мегуми",
      roleId: "role-megumi",
      roleHolderCount: 15,
      rememberedMembers: [
        { userId: "3", approvedKills: 7000, killTier: 4 },
      ],
    },
    {
      main: "Нобара",
      roleId: "role-nobara",
      roleHolderCount: 28,
      rememberedMembers: [
        { userId: "4", approvedKills: 500, killTier: 1 },
        { userId: "5", approvedKills: 1500, killTier: 2 },
        { userId: "6", approvedKills: 4000, killTier: 3 },
      ],
    },
  ]);

  assert.deepEqual(characterStats.map((entry) => entry.main), ["Нобара", "Юджи", "Мегуми"]);

  const yuji = characterStats.find((entry) => entry.main === "Юджи");
  assert.deepEqual(yuji, {
    id: "",
    main: "Юджи",
    roleId: "role-yuji",
    roleHolderCount: 28,
    rememberedCount: 2,
    totalKills: 4000,
    averageKills: 143,
    medianKills: 0,
    totalsByTier: { 1: 0, 2: 1, 3: 1, 4: 0, 5: 0 },
    bestPlayer: { userId: "2", displayName: "", kills: 3000, tier: 3 },
    highCount: 0,
    lowCount: 1,
  });

  const nobara = characterStats.find((entry) => entry.main === "Нобара");
  assert.equal(nobara.roleHolderCount, 28);
  assert.equal(nobara.rememberedCount, 3);
  assert.equal(nobara.totalKills, 6000);
  assert.equal(nobara.averageKills, 214);
  assert.equal(nobara.medianKills, 0);
  assert.deepEqual(nobara.totalsByTier, { 1: 1, 2: 1, 3: 1, 4: 0, 5: 0 });
});

test("character role stats keep role holder count as the primary popularity signal", () => {
  const characterStats = getCharacterRoleStats([
    {
      main: "Юджи",
      roleId: "role-yuji",
      roleHolderCount: 50,
      rememberedMembers: [
        { userId: "1", approvedKills: 1000, killTier: 2 },
      ],
    },
    {
      main: "Мегуми",
      roleId: "role-megumi",
      roleHolderCount: 10,
      rememberedMembers: [
        { userId: "2", approvedKills: 5000, killTier: 4 },
        { userId: "3", approvedKills: 3000, killTier: 3 },
        { userId: "4", approvedKills: 8000, killTier: 4 },
      ],
    },
  ]);

  assert.deepEqual(characterStats.map((entry) => entry.main), ["Юджи", "Мегуми"]);
  assert.equal(characterStats[0].roleHolderCount, 50);
  assert.equal(characterStats[0].rememberedCount, 1);
  assert.equal(characterStats[0].averageKills, 20);
  assert.equal(characterStats[0].medianKills, 0);
  assert.equal(characterStats[1].roleHolderCount, 10);
  assert.equal(characterStats[1].rememberedCount, 3);
  assert.equal(characterStats[1].averageKills, 1600);
  assert.equal(characterStats[1].medianKills, 0);
});

test("character role stats ignore remembered members without a live kill role", () => {
  const [yuji] = getCharacterRoleStats([
    {
      main: "Юджи",
      roleId: "role-yuji",
      roleHolderCount: 2,
      rememberedMembers: [
        { userId: "1", approvedKills: 1000, killTier: 2, hasLiveKillRole: false },
        { userId: "2", approvedKills: 3000, killTier: 3, hasLiveKillRole: true },
      ],
    },
  ]);

  assert.deepEqual(yuji, {
    id: "",
    main: "Юджи",
    roleId: "role-yuji",
    roleHolderCount: 2,
    rememberedCount: 1,
    totalKills: 3000,
    averageKills: 1500,
    medianKills: 1500,
    totalsByTier: { 1: 0, 2: 0, 3: 1, 4: 0, 5: 0 },
    bestPlayer: { userId: "2", displayName: "", kills: 3000, tier: 3 },
    highCount: 0,
    lowCount: 0,
  });
});

test("non-JJS captcha switches to practice mode when the member already has access", () => {
  assert.deepEqual(
    resolveNonJjsCaptchaMode({
      hasAccessRole: true,
      hasTierRole: false,
      hasNonJjsRole: false,
    }),
    {
      mode: "practice",
      isPractice: true,
      hasTierRole: false,
      hasAccessRole: true,
      hasNonJjsRole: false,
    }
  );

  assert.deepEqual(
    resolveNonJjsCaptchaMode({
      hasAccessRole: false,
      hasTierRole: false,
      hasNonJjsRole: false,
    }),
    {
      mode: "grant",
      isPractice: false,
      hasTierRole: false,
      hasAccessRole: false,
      hasNonJjsRole: false,
    }
  );
});

test("onboard mode state normalizes persisted values and exposes readable labels", () => {
  assert.equal(normalizeOnboardAccessMode(" wartime "), ONBOARD_ACCESS_MODES.WARTIME);
  assert.equal(normalizeOnboardAccessMode("unknown"), ONBOARD_ACCESS_MODES.NORMAL);
  assert.equal(getOnboardAccessModeLabel("apocalypse"), "Апокалипсис");
  assert.equal(isApocalypseMode("apocalypse"), true);
  assert.equal(isApocalypseMode("normal"), false);
  assert.deepEqual(createOnboardModeState({ mode: " Apocalypse ", changedAt: " 2026-04-23T08:00:00.000Z ", changedBy: " mod " }), {
    mode: ONBOARD_ACCESS_MODES.APOCALYPSE,
    changedAt: "2026-04-23T08:00:00.000Z",
    changedBy: "mod",
  });
});

test("resolveGrantedAccessRoleId keeps the normal access role for returning members during wartime", () => {
  assert.equal(resolveGrantedAccessRoleId({
    mode: ONBOARD_ACCESS_MODES.WARTIME,
    normalAccessRoleId: "base-role",
    wartimeAccessRoleId: "wartime-role",
    heldRoleIds: ["base-role"],
  }), "base-role");

  assert.equal(resolveGrantedAccessRoleId({
    mode: ONBOARD_ACCESS_MODES.WARTIME,
    normalAccessRoleId: "base-role",
    wartimeAccessRoleId: "wartime-role",
    heldRoleIds: ["other-role"],
  }), "wartime-role");

  assert.equal(resolveGrantedAccessRoleId({
    mode: ONBOARD_ACCESS_MODES.WARTIME,
    normalAccessRoleId: "base-role",
    wartimeAccessRoleId: "",
    heldRoleIds: [],
  }), "base-role");
});

test("access grant mode state normalizes persisted values and exposes readable labels", () => {
  assert.equal(normalizeOnboardAccessGrantMode(" after_review_post "), ONBOARD_ACCESS_GRANT_MODES.AFTER_REVIEW_POST);
  assert.equal(normalizeOnboardAccessGrantMode("unknown"), ONBOARD_ACCESS_GRANT_MODES.AFTER_SUBMIT);
  assert.equal(getOnboardAccessGrantModeLabel("after_approve"), "Только после approve");
  assert.deepEqual(createOnboardAccessGrantState({ mode: " after_approve ", changedAt: " 2026-04-23T08:00:00.000Z ", changedBy: " mod " }), {
    mode: ONBOARD_ACCESS_GRANT_MODES.AFTER_APPROVE,
    changedAt: "2026-04-23T08:00:00.000Z",
    changedBy: "mod",
  });
});

test("onboard begin route prioritizes pending proof and pending submission over cooldown", () => {
  assert.deepEqual(resolveOnboardBeginRoute({
    hasPendingProof: true,
    hasPendingMissingRoblox: true,
    hasPendingSubmission: true,
    cooldownLeft: 42,
    hasSubmitSession: true,
    hasMainDraft: true,
  }), {
    type: ONBOARD_BEGIN_ROUTES.REQUIRED_ROBLOX,
    cooldownLeft: 42,
  });

  assert.deepEqual(resolveOnboardBeginRoute({
    hasPendingSubmission: true,
    cooldownLeft: 42,
    hasSubmitSession: true,
    hasMainDraft: true,
  }), {
    type: ONBOARD_BEGIN_ROUTES.PENDING,
    cooldownLeft: 42,
  });
});

test("onboard begin route falls through from cooldown to submit, draft, and picker", () => {
  assert.deepEqual(resolveOnboardBeginRoute({
    cooldownLeft: 17,
    hasSubmitSession: true,
    hasMainDraft: true,
  }), {
    type: ONBOARD_BEGIN_ROUTES.COOLDOWN,
    cooldownLeft: 17,
  });

  assert.deepEqual(resolveOnboardBeginRoute({
    hasSubmitSession: true,
    hasMainDraft: true,
  }), {
    type: ONBOARD_BEGIN_ROUTES.SUBMIT,
    cooldownLeft: 0,
  });

  assert.deepEqual(resolveOnboardBeginRoute({
    hasMainDraft: true,
  }), {
    type: ONBOARD_BEGIN_ROUTES.DRAFT,
    cooldownLeft: 0,
  });

  assert.deepEqual(resolveOnboardBeginRoute({}), {
    type: ONBOARD_BEGIN_ROUTES.PICKER,
    cooldownLeft: 0,
  });
});

test("command builder includes new admin refresh and editor subcommands", () => {
  assert.deepEqual(
    [...ONBOARD_SUBCOMMAND_NAMES].sort(),
    [
      "deleteprofile",
      "modset",
      "movegraphic",
      "movenotices",
      "movetext",
      "panel",
      "removetier",
      "robloxauth",
      "sotreport",
      "welcomeedit",
    ].sort()
  );
});

test("command builder registers onboard, rolepanel, verify, and profile top-level commands", () => {
  assert.deepEqual([...TOP_LEVEL_COMMAND_NAMES].sort(), ["onboard", ROLE_PANEL_COMMAND_NAME, VERIFY_COMMAND_NAME, PROFILE_COMMAND_NAME].sort());
  assert.deepEqual(buildCommands().map((command) => command.name).sort(), ["onboard", ROLE_PANEL_COMMAND_NAME, VERIFY_COMMAND_NAME, PROFILE_COMMAND_NAME].sort());
  const onboardCommand = buildCommands().find((command) => command.name === "onboard");
  const verifyCommand = buildCommands().find((command) => command.name === VERIFY_COMMAND_NAME);
  const profileCommand = buildCommands().find((command) => command.name === PROFILE_COMMAND_NAME);
  assert.equal(onboardCommand.options.some((option) => option.type === 1 && option.name === "sotreport"), true);
  assert.equal(verifyCommand.options.some((option) => option.type === 1 && option.name === "panel"), true);
  assert.equal(verifyCommand.options.some((option) => option.type === 1 && option.name === "add"), true);
  assert.equal(profileCommand.options.some((option) => option.type === 6 && option.name === "target"), true);
  assert.deepEqual(VERIFY_SUBCOMMAND_NAMES, ["panel", "add"]);
});

test("role panel draft normalization applies defaults and validation rules", () => {
  const plainDraft = normalizeRoleMessageDraft({ content: "  Привет  " });
  const singleButtonDraft = normalizeRoleMessageDraft({ roleId: "role-1" });
  const embedResult = validateRoleMessageDraft({
    channelId: "channel-1",
    roleId: "role-1",
    format: ROLE_PANEL_FORMATS.EMBED,
    embedTitle: "  Event title  ",
    buttonLabel: "  Участвовать  ",
  });

  assert.equal(plainDraft.format, ROLE_PANEL_FORMATS.PLAIN);
  assert.equal(plainDraft.content, "Привет");
  assert.deepEqual(plainDraft.buttons, []);
  assert.deepEqual(singleButtonDraft.buttons, [{ roleId: "role-1", label: DEFAULT_ROLE_PANEL_BUTTON_LABEL }]);
  assert.equal(embedResult.isValid, true);
  assert.deepEqual(embedResult.errors, []);
  assert.equal(embedResult.draft.embedTitle, "Event title");
  assert.deepEqual(embedResult.draft.buttons, [{ roleId: "role-1", label: "Участвовать" }]);

  const invalidPlain = validateRoleMessageDraft({ roleId: "role-1" });
  assert.equal(invalidPlain.isValid, false);
  assert.deepEqual(invalidPlain.errors.sort(), ["channelId", "content"].sort());
});

test("role grant registry keeps only valid records and filters inactive entries", () => {
  const normalized = normalizeRoleGrantRegistry({
    good: {
      channelId: "channel-1",
      messageId: "message-1",
      roleId: "role-1",
      format: ROLE_PANEL_FORMATS.PLAIN,
      content: "Event text",
      buttonLabel: "Взять роль",
      createdAt: "2026-04-13T12:00:00.000Z",
    },
    disabled: {
      channelId: "channel-2",
      messageId: "message-2",
      roleId: "role-1",
      format: ROLE_PANEL_FORMATS.EMBED,
      embedDescription: "Event description",
      buttonLabel: "Участвовать",
      createdAt: "2026-04-13T13:00:00.000Z",
      disabledAt: "2026-04-13T14:00:00.000Z",
    },
    broken: {
      roleId: "role-1",
    },
  });

  assert.equal(normalized.mutated, true);
  assert.deepEqual(Object.keys(normalized.registry).sort(), ["disabled", "good"]);
  assert.deepEqual(
    getRoleGrantRecords(normalized.registry, { roleId: "role-1" }).map((record) => record.id),
    ["good"]
  );
  assert.deepEqual(
    getRoleGrantRecords(normalized.registry, { roleId: "role-1", activeOnly: false }).map((record) => record.id),
    ["disabled", "good"]
  );
});

test("role grant custom ids round-trip cleanly", () => {
  const customId = buildRoleGrantCustomId("ABC123");
  const indexedCustomId = buildRoleGrantCustomId("ABC123", 2);

  assert.equal(customId, "rolepanel_grant:ABC123");
  assert.equal(indexedCustomId, "rolepanel_grant:ABC123:2");
  assert.deepEqual(parseRoleGrantCustomId(customId), { recordId: "ABC123", buttonIndex: 0 });
  assert.deepEqual(parseRoleGrantCustomId(indexedCustomId), { recordId: "ABC123", buttonIndex: 2 });
  assert.equal(parseRoleGrantCustomId("approve:ABC123"), null);
  assert.equal(ROLE_PANEL_CLEANUP_BEHAVIORS.DISABLE_MESSAGES, "disable_messages");
});

test("role panel can recreate a publish draft from an existing record", () => {
  const draft = createRoleMessageDraftFromRecord({
    id: "REC1",
    channelId: "channel-1",
    messageId: "message-1",
    roleId: "role-1",
    format: ROLE_PANEL_FORMATS.EMBED,
    embedTitle: "Ивент",
    embedDescription: "Жми кнопку",
    buttonLabel: "Участвовать",
  });

  assert.deepEqual(draft, {
    channelId: "channel-1",
    format: ROLE_PANEL_FORMATS.EMBED,
    content: "",
    embedTitle: "Ивент",
    embedDescription: "Жми кнопку",
    buttons: [{ roleId: "role-1", label: "Участвовать" }],
    editingButtonIndex: -1,
    autoResendIntervalMs: 0,
  });
});

test("role panel picker state is normalized and query filtering searches by label and id", () => {
  const state = normalizeRolePanelPickerState({
    scope: ROLE_PANEL_PICKER_SCOPES.CLEANUP_ROLE,
    query: "  Event  7788  ",
    page: -5,
  });
  const filtered = filterRolePanelPickerItems([
    { id: "1122", label: "Alpha Raid", description: "channel", keywords: "news alerts" },
    { id: "7788", label: "Event Alerts", description: "role", keywords: "special access" },
    { id: "9911", label: "Casual", description: "role", keywords: "member" },
  ], state.query);

  assert.deepEqual(state, {
    scope: ROLE_PANEL_PICKER_SCOPES.CLEANUP_ROLE,
    query: "Event  7788",
    page: 0,
  });
  assert.deepEqual(filtered.map((item) => item.id), ["7788"]);
});

test("role panel picker accepts combo guide editor role scope", () => {
  const state = normalizeRolePanelPickerState({
    scope: ROLE_PANEL_PICKER_SCOPES.COMBO_GUIDE_EDITOR_ROLE,
    query: "  helper role  ",
    page: 2,
  });

  assert.deepEqual(state, {
    scope: ROLE_PANEL_PICKER_SCOPES.COMBO_GUIDE_EDITOR_ROLE,
    query: "helper role",
    page: 2,
  });
});

test("role panel picker pagination keeps all entries reachable across pages", () => {
  const items = Array.from({ length: ROLE_PANEL_PICKER_PAGE_SIZE * 2 + 7 }, (_, index) => ({
    id: `item-${index + 1}`,
    label: `Item ${index + 1}`,
  }));

  const firstPage = paginateRolePanelPickerItems(items, 0);
  const lastPage = paginateRolePanelPickerItems(items, 99);

  assert.equal(firstPage.items.length, ROLE_PANEL_PICKER_PAGE_SIZE);
  assert.equal(firstPage.page, 0);
  assert.equal(firstPage.hasPrev, false);
  assert.equal(firstPage.hasNext, true);

  assert.equal(lastPage.pageCount, 3);
  assert.equal(lastPage.page, 2);
  assert.equal(lastPage.items.length, 7);
  assert.equal(lastPage.hasPrev, true);
  assert.equal(lastPage.hasNext, false);
  assert.deepEqual(lastPage.items.map((item) => item.id), [
    "item-51",
    "item-52",
    "item-53",
    "item-54",
    "item-55",
    "item-56",
    "item-57",
  ]);
});
