require("dotenv").config();

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const crypto = require("node:crypto");
const { createDbStore, loadJsonFile } = require("./src/db/store");
const {
  getChannelValue: getSotChannelValue,
  getKillTierRole: getSotKillTierRole,
  getLegacyEloTierRole: getSotLegacyEloTierRole,
  getRole: getSotRole,
  listCharacters: listSotCharacters,
  getIntegration: getSotIntegration,
  getInfluence: getSotInfluence,
  getLegacyInfluenceConfig: getSotLegacyInfluenceConfig,
  getPanel: getSotPanel,
  getPresentation: getSotPresentation,
} = require("./src/sot");
const {
  createGuildSnapshot: createSotGuildSnapshot,
  diagnoseChannels: diagnoseSotChannels,
  diagnoseIntegrations: diagnoseSotIntegrations,
  diagnosePanels: diagnoseSotPanels,
  diagnoseRoles: diagnoseSotRoles,
} = require("./src/sot/diagnostics");
const {
  buildConfiguredCharacterCatalogView,
  clearNativeCharacterRecord,
  writeNativeCharacterRecord,
} = require("./src/sot/native-characters");
const {
  clearNativeRoleRecord,
  normalizeRoleSlot: normalizeNativeRoleSlot,
  writeNativeRoleRecord,
} = require("./src/sot/native-roles");
const {
  clearNativeIntegrationSourcePath,
  writeNativeIntegrationSnapshot,
  writeNativeIntegrationRoleGrantEnabled,
  writeNativeIntegrationSourcePath,
} = require("./src/sot/native-integrations");
const {
  clearNativePanelRecord,
  normalizePanelSlot: normalizeNativePanelSlot,
  writeNativePanelRecord,
} = require("./src/sot/native-panels");
const { getCharacterAliasNames } = require("./src/sot/character-aliases");
const { compareSotVsLegacy, summarizeCompareMismatches } = require("./src/sot/legacy-bridge/compare");
const {
  handleSotReportButtonInteraction,
  handleSotReportModalOpenInteraction,
  handleSotReportModalSubmitInteraction,
} = require("./src/sot/report-operator");
const { getSotReportIntegrationSnapshots } = require("./src/sot/report-integrations");
const { resolveAllCharacterRecords } = require("./src/sot/resolver/characters");
const {
  getActionableSotCharacterAlertState,
  runSotStartupAlerts,
  scheduleSotAlertTicks,
} = require("./src/sot/runtime-alerts");
const { createSerializedMutationRunner, createSerializedTaskRunner } = require("./src/runtime/serialized-task-runner");
const {
  clearIntervalHandles,
  mergeRobloxRuntimeConfig,
  normalizeRobloxPanelSettingsPatch,
  rebuildRobloxIntervalHandles,
} = require("./src/runtime/roblox-runtime-support");
const { buildClientReadyPeriodicJobs, buildRobloxPeriodicJobs, runClientReadyCore, scheduleClientReadyIntervals, schedulePeriodicJobs } = require("./src/runtime/client-ready-core");
const {
  syncLegacyGraphicTierlistBoardSnapshot,
  syncLegacyPanelSnapshot,
  syncLegacyTextTierlistBoardSnapshot,
} = require("./src/sot/legacy-bridge/panels");
const { syncLegacyCharacterWrites, syncLegacyChannelWrites, syncLegacyInfluenceWrites, syncLegacyIntegrationWrites, syncLegacyPanelWrites, syncLegacyPresentationWrites, syncLegacyRoleWrites } = require("./src/sot/legacy-bridge/write");
const { syncSotShadowState: syncShadowSotState } = require("./src/sot/loader");
const {
  renderGraphicTierlistPng,
  setAvatarCacheDir,
  clearGraphicAvatarCache,
  clearGraphicAvatarCacheForUser,
  isPureimageAvailable,
  DEFAULT_GRAPHIC_TIER_COLORS,
} = require("./graphic-tierlist");
const { buildCommands } = require("./src/onboard/commands");
const { buildComboCommands } = require("./src/combo-guide/commands");
const {
  publishGuideOrdered,
  addCharacterToGuide,
  removeCharacterFromGuide,
  refreshNavigation,
  deleteFullGuide,
  downloadUrl,
} = require("./src/combo-guide/publisher");
const {
  buildComboPanelPayload,
  buildMessageSelectPayload,
  buildEditModal,
  normalizeComboGuideEditorRoleIds,
} = require("./src/combo-guide/editor");
const {
  DEFAULT_ROLE_PANEL_BUTTON_LABEL,
  ROLE_PANEL_AUTO_RESEND_INTERVALS,
  ROLE_PANEL_AUTO_RESEND_TICK_MS,
  ROLE_PANEL_CLEANUP_BEHAVIORS,
  ROLE_PANEL_COMMAND_NAME,
  ROLE_PANEL_DRAFT_EXPIRE_MS,
  ROLE_PANEL_FORMATS,
  ROLE_PANEL_MAX_BUTTONS,
  ROLE_PANEL_PICKER_PAGE_SIZE,
  ROLE_PANEL_PICKER_SCOPES,
  buildRoleGrantCustomId,
  createRoleMessageDraftFromRecord,
  filterRolePanelPickerItems,
  getRoleGrantRecords,
  normalizeRoleButton,
  normalizeRoleButtons,
  normalizeRoleGrantRegistry,
  normalizeRoleMessageDraft,
  normalizeRolePanelPickerState,
  paginateRolePanelPickerItems,
  parseRoleGrantCustomId,
  validateRoleMessageDraft,
} = require("./src/role-panel");
const {
  VERIFY_COMMAND_NAME,
  VERIFY_ENTRY_GUIDE_ID,
  VERIFY_ENTRY_START_ID,
  VERIFY_ENTRY_STATUS_ID,
  VERIFY_PANEL_CONFIG_INFRA_ID,
  VERIFY_PANEL_CONFIG_INFRA_MODAL_ID,
  VERIFY_PANEL_CONFIG_RISK_ID,
  VERIFY_PANEL_CONFIG_RISK_MODAL_ID,
  VERIFY_PANEL_CONFIG_TEXTS_ID,
  VERIFY_PANEL_CONFIG_TEXTS_MODAL_ID,
  VERIFY_PANEL_RESEND_REPORT_ID,
  VERIFY_PANEL_RESEND_REPORT_MODAL_ID,
  VERIFY_PANEL_MODAL_IDS,
  VERIFY_PANEL_PUBLISH_ENTRY_ID,
  VERIFY_PANEL_RUN_SWEEP_ID,
  buildVerificationEntryPayload,
  buildVerificationGuidePayload,
  buildVerificationInfraConfigModal,
  buildVerificationLaunchPayload,
  buildVerificationPanelPayload,
  buildVerificationQueuePayload,
  buildVerificationResendReportModal,
  buildVerificationReportPayload,
  buildVerificationRiskRulesModal,
  buildVerificationRuntimePayload,
  buildVerificationStageTextsModal,
  handleVerificationPanelButtonInteraction,
  handleVerificationPanelModalSubmitInteraction,
  parseVerificationReportAction,
} = require("./src/verification/operator");
const {
  buildDiscordOAuthAuthorizeUrl,
  createVerificationCallbackServer,
  normalizeVerificationRuntimeConfig,
} = require("./src/verification/runtime");
const { commitMutation } = require("./src/onboard/refresh-runner");
const {
  buildActivityOperatorPanelPayload,
  handleActivityPanelButtonInteraction,
  handleActivityPanelModalSubmitInteraction,
  runDailyActivityRoleSync,
} = require("./src/activity/operator");
const {
  flushActivityRuntime,
  recordActivityMessage,
  resumeActivityRuntime,
} = require("./src/activity/runtime");
const { ensureActivityState } = require("./src/activity/state");
const {
  addAutonomyGuardIsolatedUserId,
  classifyAutonomyGuardDeletedMessage,
  clearAutonomyGuardTargetUserId,
  collectAutonomyGuardProtectedRoleIds,
  diffAutonomyGuardProtectedRoleIds,
  ensureAutonomyGuardState,
  incrementAutonomyGuardWarningCounter,
  isAutonomyGuardIsolatedUser,
  normalizeHexColor,
  normalizeProtectedRole,
  removeAutonomyGuardIsolatedUserId,
  resolveAutonomyGuardMessageDeleteDecision,
  resolveAutonomyGuardPrimaryAdminUserId,
  setAutonomyGuardPrimaryAdminUserId,
  setAutonomyGuardProtectedRole,
  setAutonomyGuardTargetUserId,
} = require("./src/moderation/autonomy-guard");
const {
  ONBOARD_ACCESS_MODES,
  createOnboardModeState,
  getOnboardAccessModeLabel,
  isApocalypseMode,
  normalizeOnboardAccessMode,
  resolveGrantedAccessRoleId,
} = require("./src/onboard/access-mode");
const {
  ONBOARD_ACCESS_GRANT_MODES,
  createOnboardAccessGrantState,
  getOnboardAccessGrantModeLabel,
  normalizeOnboardAccessGrantMode,
} = require("./src/onboard/access-grant-mode");
const { ONBOARD_BEGIN_ROUTES, resolveOnboardBeginRoute } = require("./src/onboard/begin-state");
const {
  canManageWelcomeRobloxIdentity,
  getWelcomeRobloxIdentityLockText,
} = require("./src/onboard/roblox-identity");
const { resolveNonJjsCaptchaMode } = require("./src/onboard/non-jjs-mode");
const {
  createPresentationDefaults,
  ensurePresentationConfig,
  getGraphicTierlistBoardState,
  getNonGgsPanelState: readNonGgsPanelState,
  getTextTierlistBoardState,
  getTierLabel,
  getWelcomePanelState: readWelcomePanelState,
  resolvePresentation,
} = require("./src/onboard/presentation");
const {
  applyChannelLink: applyManagedChannelLink,
  applyChannelOverrideBatch: applyManagedChannelOverrideBatch,
  ChannelOverrideBatchError,
  clearChannelLink: clearManagedChannelLink,
  getChangedChannelOverrides: getManagedChannelOverrideChanges,
  getChannelSlotLabel: getManagedChannelSlotLabel,
  normalizeChannelSlot: normalizeManagedChannelSlot,
} = require("./src/onboard/channel-owner");
const {
  applyRobloxAccountSnapshot,
  clearAllRobloxRefreshDiagnostics,
  configureSharedProfileRuntime,
  createDefaultIntegrationState,
  deriveProfileMainView,
  ensureSharedProfile,
  normalizeIntegrationState,
  syncSharedProfiles,
} = require("./src/integrations/shared-profile");
const { createProfileOperator } = require("./src/profile/operator");
const { createAntiteamOperator } = require("./src/antiteam/operator");
const { ANTITEAM_COMMAND_NAME } = require("./src/antiteam/view");
const {
  createRobloxApiClient,
} = require("./src/integrations/roblox-service");
const {
  createRobloxJobCoordinator,
  createRobloxRuntimeState,
  flushRobloxRuntime: flushRobloxRuntimeState,
  runRobloxProfileRefreshJob: runRobloxProfileRefreshJobCore,
  runRobloxPlaytimeSyncJob,
} = require("./src/runtime/roblox-jobs");
const {
  buildRobloxStatsPanelPayload,
  createRobloxPanelTelemetry,
  handleRobloxStatsPanelButtonInteraction,
} = require("./src/integrations/roblox-panel");
const {
  buildHistoricalManagedCharacterRoleIds,
  buildManagedCharacterRoleRecoveryPlan,
  normalizeManagedCharacterCatalog,
} = require("./src/integrations/character-role-catalog");
const {
  clearDormantEloSync,
  importDormantEloSyncFromFile,
} = require("./src/integrations/elo-dormant");
const {
  clearDormantTierlistSync,
  importDormantTierlistSyncFromFile,
} = require("./src/integrations/tierlist-dormant");
const {
  LEGACY_TIERLIST_TITLE,
  addLegacyTierlistCustomCharacter,
  buildLegacyTierlistSummaryEmbed,
  computeLegacyTierlistGlobalBuckets,
  computeLegacyTierlistGlobalLayoutHash,
  getTierState,
  getLegacyTierlistFontDebugInfo,
  getLegacyTierlistImageConfig,
  getLegacyTierlistUserTierCounts,
  listLegacyTierlistCustomCharacterIds,
  loadLegacyTierlistState,
  renderLegacyTierlistFromBuckets,
  renderLegacyTierlistGlobalPng,
  renderLegacyTierlistUserPng,
  resolveLegacyTierlistCharacterImagePath,
  saveLegacyTierlistState,
} = require("./src/integrations/tierlist-live");
const {
  buildLegacyTierlistClusterLookup,
  buildLegacyCharacterSyncIndex,
  getLegacyMainsBackfillDisposition,
  getLegacyTierlistClusterStatusNote,
  resolveLegacyCharacterMatch,
  resolveLegacyMainIdsFromRuntimeEntries,
} = require("./src/integrations/tierlist-character-sync");
const {
  describeRoleSyncFailures,
  RoleSyncError,
  syncMemberCharacterRoles,
} = require("./src/onboard/character-role-sync");
const {
  attachLegacyEloReviewRecord,
  LEGACY_ELO_PENDING_EXPIRE_HOURS,
  approveLegacyEloSubmission,
  editLegacyEloSubmission,
  expireLegacyEloSubmission,
  getLegacyEloRating,
  getLegacyEloSubmission,
  isLegacyEloSubmissionExpired,
  listLegacyEloPendingSubmissions,
  loadLegacyEloDbFile,
  parseLegacyElo,
  rebuildLegacyEloRatings,
  removeLegacyEloRating,
  rejectLegacyEloSubmission,
  saveLegacyEloDbFile,
  tierForLegacyElo,
  upsertDirectLegacyEloRating,
  wipeLegacyEloRatings,
} = require("./src/integrations/elo-review-store");
const {
  getDormantEloPanelSnapshot,
  getDormantEloProfileSnapshot,
} = require("./src/integrations/elo-panel");
const {
  parseLegacyEloManualChatInput,
} = require("./src/integrations/elo-manual-chat");
const {
  getDormantTierlistPanelSnapshot,
  getDormantTierlistProfileSnapshot,
} = require("./src/integrations/tierlist-panel");
const {
  applyLegacyEloGraphicImageDelta,
  buildLegacyEloGraphicEntries,
  buildLegacyEloGraphicPanelSnapshot,
  ensureLegacyEloGraphicState,
  getLegacyEloGraphicMessageText,
  previewLegacyEloGraphicMessageText,
  resetAllLegacyEloGraphicTierColors,
  resetLegacyEloGraphicImageOverrides,
  resetLegacyEloGraphicTierColor,
  setLegacyEloGraphicDashboardChannel,
  setLegacyEloGraphicMessageText,
  setLegacyEloGraphicSelectedTier,
  setLegacyEloGraphicTierColor,
  setLegacyEloGraphicTitle,
  setLegacyEloTierLabel,
  setLegacyEloTierLabels,
} = require("./src/integrations/elo-graphic");
const {
  getCharacterRoleStats,
  getTrackedMemberStats,
  getTierlistStats,
} = require("./src/onboard/tierlist-stats");
const {
  filterEntriesByAllowedUserIds,
  hasAnyAllowedRole,
} = require("./src/onboard/tierlist-live-members");
const {
  applyTextTierlistPaginationAction,
  normalizeTextTierlistPaginationState,
  resolveTextTierlistPageState,
} = require("./src/onboard/text-tierlist-pagination");
const {
  buildCharacterFactData,
  collectRecentKillChanges,
  collectUserRecentKillChangeHistory,
  paginateRecentKillChanges,
  summarizeRecentKillChange,
} = require("./src/onboard/tierlist-ranking");
const {
  applyTierlistSpecialMembers,
  getTierlistNonFakeUserIds,
  getTierlistNonFakeUserIdSet,
  setTierlistNonFakeUser,
} = require("./src/onboard/tierlist-special-members");
const {
  parseKillsFromSubmittedText,
  resolveEffectiveSubmittedKills,
  resolveResumableMainCharacterIds,
} = require("./src/onboard/submission-message");
let nonGgsCaptchaModule = null;
try {
  nonGgsCaptchaModule = require("./src/onboard/non-jjs-captcha");
} catch (error) {
  console.warn(`non-JJS captcha module unavailable: ${String(error?.message || error)}`);
  nonGgsCaptchaModule = {
    createCaptchaChallenge() {
      throw new Error("non-JJS captcha module is unavailable");
    },
    loadCaptchaCatalog(assetDir) {
      return {
        assetDir: path.resolve(String(assetDir || ".")),
        skillful: [],
        outliers: [],
      };
    },
    renderCaptchaPng() {
      throw new Error("non-JJS captcha module is unavailable");
    },
  };
}

const {
  createCaptchaChallenge,
  loadCaptchaCatalog,
  renderCaptchaPng,
} = nonGgsCaptchaModule;

const {
  AuditLogEvent,
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require("discord.js");

const PROJECT_ROOT = __dirname;

function resolvePathFromBase(baseDir, rawPath, fallbackRelative = "") {
  const target = String(rawPath || fallbackRelative || "").trim();
  if (!target) return path.resolve(baseDir, fallbackRelative || ".");
  return path.isAbsolute(target) ? target : path.resolve(baseDir, target);
}

function resolveDataRoot() {
  const explicitRoot = String(process.env.BOT_DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || "").trim();
  if (explicitRoot) return resolvePathFromBase(PROJECT_ROOT, explicitRoot);
  if (process.env.RAILWAY_ENVIRONMENT_NAME && fs.existsSync("/data")) return "/data";
  return PROJECT_ROOT;
}

const DATA_ROOT = resolveDataRoot();
const DISCORD_TOKEN = String(process.env.DISCORD_TOKEN || "").trim();
const GUILD_ID = String(process.env.GUILD_ID || "").trim();
const DB_PATH = resolvePathFromBase(DATA_ROOT, process.env.DB_PATH || "welcome-db.json");
const CONFIG_PATH = resolvePathFromBase(PROJECT_ROOT, process.env.CONFIG_PATH || "./bot.config.json");
const CHARACTERS_ASSET_DIR = resolvePathFromBase(PROJECT_ROOT, "./assets/characters");
const DEFAULT_REMINDER_POSTER_PATH = resolvePathFromBase(PROJECT_ROOT, "./assets/missing-tierlist-poster.svg");
const NON_GGS_CAPTCHA_ASSET_DIR = resolvePathFromBase(PROJECT_ROOT, "./assets/non-jjs-captcha");

fs.mkdirSync(DATA_ROOT, { recursive: true });
fs.mkdirSync(NON_GGS_CAPTCHA_ASSET_DIR, { recursive: true });
setAvatarCacheDir(path.join(DATA_ROOT, "graphic_avatar_cache"));

const SUBMIT_SESSION_EXPIRE_MS = 10 * 60 * 1000;
const PENDING_EXPIRE_HOURS = 72;
const TEMP_MESSAGE_DELETE_MS = 12000;
const PROFILE_HELPER_MESSAGE_DELETE_MS = 20000;
const SUBMIT_COOLDOWN_SECONDS = 120;
const WELCOME_CLEANUP_IMAGE_GRACE_MS = 2 * 60 * 1000;
const WELCOME_CLEANUP_BOT_REPLY_GRACE_MS = 20 * 1000;
const NON_GGS_CAPTCHA_EXPIRE_MS = 10 * 60 * 1000;
const NON_GGS_CAPTCHA_STAGES = 2;
const LEGACY_TIERLIST_SUMMARY_REFRESH_MS = 20 * 60 * 1000;
const ACTIVITY_RUNTIME_FLUSH_INTERVAL_MS = 5 * 60 * 1000;
const LEGACY_TIERLIST_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const LEGACY_TIERLIST_MAIN_SELECT_PAGE_SIZE = 25;
const SOT_CHARACTER_ALERT_STALE_HOURS = 24;
const SOT_CHARACTER_ALERT_PERIODIC_MS = 60 * 60 * 1000;
const SOT_CHARACTER_ALERT_REPEAT_MS = 6 * 60 * 60 * 1000;
const SOT_DRIFT_ALERT_REPEAT_MS = 6 * 60 * 60 * 1000;
const RECENT_KILL_CHANGES_PAGE_SIZE = 5;
const RECENT_KILL_CHANGES_MAX_PAGES = 4;
const LEGACY_TIERLIST_ROLE_INFLUENCE = {
  1: 2.0,
  2: 2.5,
  3: 3.0,
  4: 3.5,
  5: 4.0,
};
const LEGACY_TIERLIST_PANEL_BUTTON_IDS = new Set([
  "panel_tab_config",
  "panel_tab_participants",
  "panel_part_prev",
  "panel_part_next",
  "panel_part_refresh",
  "panel_part_back",
  "panel_part_view_png",
  "panel_part_delete_votes",
  "panel_part_delete_full",
  "panel_part_cancel_delete",
  "panel_part_confirm_delete",
  "panel_close",
  "panel_refresh",
  "panel_icon_minus",
  "panel_icon_plus",
  "panel_w_minus",
  "panel_w_plus",
  "panel_h_minus",
  "panel_h_plus",
  "panel_set_img",
  "panel_role_coefficients",
  "panel_reset_img",
  "panel_fonts",
  "panel_rename",
  "panel_add_custom_character",
  "panel_wipe_votes_all",
  "panel_confirm_wipe_votes_all",
  "panel_cancel_wipe_votes_all",
]);
const NON_CHARACTER_ROLE_NAME_PATTERNS = [
  /^\d+\s*-\s*\d+к$/i,
  /^\d+к\+$/i,
  /(бот|админ|модер|клан|турнир|ивент|батальон|дивизия|форма|гномята|фантом|frieren|shimolti|опущ|проклятие|маг|зек)/i,
];

let guildCache = null;
const mainDrafts = new Map();
const submitSessions = new Map();
const mainsPickerSessions = new Map();
const legacyEloSubmitSessions = new Map();
const legacyEloManualModsetSessions = new Map();
const nonGgsCaptchaSessions = new Map();
const rolePanelDrafts = new Map();
const roleCleanupSelections = new Map();
const roleRecordSelections = new Map();
const rolePanelPickers = new Map();
let lastSotCharacterAlertSignature = "";
let lastSotCharacterAlertAt = 0;
let lastSotDriftAlertSignature = "";
let lastSotDriftAlertAt = 0;
let lastClientReadyCoreCompletedAt = "";
let lastClientReadyCoreDegraded = [];

function envText(name, fallback = "") {
  const raw = process.env[name];
  if (raw === undefined || raw === null) return String(fallback || "").trim();
  return String(raw).trim();
}

function envBoolean(name, fallback = false) {
  const raw = envText(name, "");
  if (!raw) return Boolean(fallback);
  if (/^(1|true|yes|on)$/i.test(raw)) return true;
  if (/^(0|false|no|off)$/i.test(raw)) return false;
  return Boolean(fallback);
}

function envInteger(name, fallback = 0, minimum = 0) {
  const raw = envText(name, "");
  if (!raw) return Number(fallback) || 0;
  const numeric = Number(raw);
  return Number.isSafeInteger(numeric) && numeric >= minimum ? numeric : Number(fallback) || 0;
}

function isPlaceholder(value) {
  const text = String(value || "").trim();
  return !text || text.startsWith("REPLACE_") || text.startsWith("YOUR_");
}

function parseCharacterConfig(rawValue) {
  if (!rawValue) return [];
  if (Array.isArray(rawValue)) return rawValue;
  try {
    const parsed = JSON.parse(String(rawValue));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    throw new Error("CHARACTER_CONFIG_JSON должен быть валидным JSON-массивом");
  }
}

function buildRuntimeConfig(fileConfig = {}) {
  const fileCharacters = Array.isArray(fileConfig?.characters) ? fileConfig.characters : [];
  const envCharacters = envText("CHARACTER_CONFIG_JSON", "");
  const characters = envCharacters ? parseCharacterConfig(envCharacters) : fileCharacters;
  const fileRoblox = fileConfig?.roblox && typeof fileConfig.roblox === "object" ? fileConfig.roblox : {};

  return {
    channels: {
      welcomeChannelId: envText("WELCOME_CHANNEL_ID", fileConfig?.channels?.welcomeChannelId || ""),
      reviewChannelId: envText("REVIEW_CHANNEL_ID", fileConfig?.channels?.reviewChannelId || ""),
      tierlistChannelId: envText("TIERLIST_CHANNEL_ID", fileConfig?.channels?.tierlistChannelId || ""),
      logChannelId: envText("LOG_CHANNEL_ID", fileConfig?.channels?.logChannelId || ""),
    },
    roles: {
      moderatorRoleId: envText("MODERATOR_ROLE_ID", fileConfig?.roles?.moderatorRoleId || ""),
      accessRoleId: envText("ACCESS_ROLE_ID", fileConfig?.roles?.accessRoleId || ""),
      wartimeAccessRoleId: envText("WARTIME_ACCESS_ROLE_ID", fileConfig?.roles?.wartimeAccessRoleId || ""),
      verifyAccessRoleId: envText("VERIFY_ACCESS_ROLE_ID", fileConfig?.roles?.verifyAccessRoleId || ""),
      nonJjsAccessRoleId: envText(
        "NON_JJS_ACCESS_ROLE_ID",
        envText("NON_GGS_ACCESS_ROLE_ID", fileConfig?.roles?.nonJjsAccessRoleId || fileConfig?.roles?.nonGgsAccessRoleId || "")
      ),
      killTierRoleIds: {
        1: envText("TIER_ROLE_1_ID", fileConfig?.roles?.killTierRoleIds?.["1"] || ""),
        2: envText("TIER_ROLE_2_ID", fileConfig?.roles?.killTierRoleIds?.["2"] || ""),
        3: envText("TIER_ROLE_3_ID", fileConfig?.roles?.killTierRoleIds?.["3"] || ""),
        4: envText("TIER_ROLE_4_ID", fileConfig?.roles?.killTierRoleIds?.["4"] || ""),
        5: envText("TIER_ROLE_5_ID", fileConfig?.roles?.killTierRoleIds?.["5"] || ""),
      },
      legacyEloTierRoleIds: {
        1: envText("LEGACY_ELO_TIER_ROLE_1_ID", fileConfig?.roles?.legacyEloTierRoleIds?.["1"] || ""),
        2: envText("LEGACY_ELO_TIER_ROLE_2_ID", fileConfig?.roles?.legacyEloTierRoleIds?.["2"] || ""),
        3: envText("LEGACY_ELO_TIER_ROLE_3_ID", fileConfig?.roles?.legacyEloTierRoleIds?.["3"] || ""),
        4: envText("LEGACY_ELO_TIER_ROLE_4_ID", fileConfig?.roles?.legacyEloTierRoleIds?.["4"] || ""),
      },
    },
    ui: {
      welcomeTitle: String(fileConfig?.ui?.welcomeTitle || "Jujutsu Shinigans Onboarding").trim(),
      welcomeDescription: String(
        fileConfig?.ui?.welcomeDescription ||
        "Нажми кнопку ниже, выбери 1 или 2 мейнов и отправь одним сообщением точное количество kills в тексте вместе со скрином. После подачи заявки бот сразу выдаст тебе роль доступа, а kill-tier роль прилетит после проверки модератором."
      ).trim(),
      getRoleButtonLabel: String(fileConfig?.ui?.getRoleButtonLabel || "Получить роль").trim(),
      nonGgsTitle: String(fileConfig?.ui?.nonJjsTitle || fileConfig?.ui?.nonGgsTitle || "Я не играю в JJS").trim(),
      nonGgsDescription: String(
        fileConfig?.ui?.nonJjsDescription ||
        fileConfig?.ui?.nonGgsDescription ||
        "Если ты не играешь в JJS, нажми кнопку ниже. Бот запустит 2 этапа капчи и после успешного прохождения выдаст отдельную роль доступа."
      ).trim(),
      nonGgsButtonLabel: String(fileConfig?.ui?.nonJjsButtonLabel || fileConfig?.ui?.nonGgsButtonLabel || "Я не играю в JJS").trim(),
      onboardingProofExampleImageUrl: envText(
        "ONBOARD_PROOF_EXAMPLE_IMAGE_URL",
        fileConfig?.ui?.onboardingProofExampleImageUrl || ""
      ),
      onboardingProofExampleImagePath: envText(
        "ONBOARD_PROOF_EXAMPLE_IMAGE_PATH",
        fileConfig?.ui?.onboardingProofExampleImagePath || ""
      ),
      tierlistButtonLabel: String(fileConfig?.ui?.tierlistButtonLabel || "Текстовый тир-лист").trim(),
      tierlistTitle: String(fileConfig?.ui?.tierlistTitle || "Текстовый тир-лист").trim(),
    },
    graphicTierlist: {
      title: String(fileConfig?.graphicTierlist?.title || "Графический тир-лист").trim(),
      subtitle: String(fileConfig?.graphicTierlist?.subtitle || "Подтверждённые игроки и текущая расстановка по kills").trim(),
      tierColors: {
        1: String(fileConfig?.graphicTierlist?.tierColors?.["1"] || DEFAULT_GRAPHIC_TIER_COLORS[1]).trim(),
        2: String(fileConfig?.graphicTierlist?.tierColors?.["2"] || DEFAULT_GRAPHIC_TIER_COLORS[2]).trim(),
        3: String(fileConfig?.graphicTierlist?.tierColors?.["3"] || DEFAULT_GRAPHIC_TIER_COLORS[3]).trim(),
        4: String(fileConfig?.graphicTierlist?.tierColors?.["4"] || DEFAULT_GRAPHIC_TIER_COLORS[4]).trim(),
        5: String(fileConfig?.graphicTierlist?.tierColors?.["5"] || DEFAULT_GRAPHIC_TIER_COLORS[5]).trim(),
      },
    },
    reminders: {
      missingTierlistText: envText(
        "MISSING_TIERLIST_TEXT",
        fileConfig?.reminders?.missingTierlistText || "Враг народа избегает получения роли!!! Не будь врагом!!! Стань товарищем!!!"
      ),
      missingTierlistImageUrl: envText(
        "MISSING_TIERLIST_IMAGE_URL",
        fileConfig?.reminders?.missingTierlistImageUrl || ""
      ),
      missingTierlistImagePath: envText(
        "MISSING_TIERLIST_IMAGE_PATH",
        fileConfig?.reminders?.missingTierlistImagePath || ""
      ),
    },
    killTierLabels: {
      1: String(fileConfig?.killTierLabels?.["1"] || "Низший ранг").trim(),
      2: String(fileConfig?.killTierLabels?.["2"] || "Средний ранг").trim(),
      3: String(fileConfig?.killTierLabels?.["3"] || "Высший ранг").trim(),
      4: String(fileConfig?.killTierLabels?.["4"] || "Особый ранг").trim(),
      5: String(fileConfig?.killTierLabels?.["5"] || "Абсолютный ранг").trim(),
    },
    roblox: {
      metadataRefreshEnabled: envBoolean("ROBLOX_METADATA_REFRESH_ENABLED", fileRoblox.metadataRefreshEnabled !== false),
      metadataRefreshHours: envInteger("ROBLOX_METADATA_REFRESH_HOURS", fileRoblox.metadataRefreshHours || 24, 1),
      playtimeTrackingEnabled: envBoolean("ROBLOX_PLAYTIME_TRACKING_ENABLED", fileRoblox.playtimeTrackingEnabled !== false),
      playtimePollMinutes: envInteger("ROBLOX_PLAYTIME_POLL_MINUTES", fileRoblox.playtimePollMinutes || 2, 1),
      runtimeFlushEnabled: envBoolean("ROBLOX_RUNTIME_FLUSH_ENABLED", fileRoblox.runtimeFlushEnabled !== false),
      flushIntervalMinutes: envInteger("ROBLOX_FLUSH_INTERVAL_MINUTES", fileRoblox.flushIntervalMinutes || 10, 1),
      jjsUniverseId: envInteger("ROBLOX_JJS_UNIVERSE_ID", fileRoblox.jjsUniverseId || 0, 0),
      jjsRootPlaceId: envInteger("ROBLOX_JJS_ROOT_PLACE_ID", fileRoblox.jjsRootPlaceId || 0, 0),
      jjsPlaceId: envInteger("ROBLOX_JJS_PLACE_ID", fileRoblox.jjsPlaceId || 0, 0),
      frequentNonFriendMinutes: envInteger("ROBLOX_FREQUENT_NON_FRIEND_MINUTES", fileRoblox.frequentNonFriendMinutes || 60, 1),
      frequentNonFriendSessions: envInteger("ROBLOX_FREQUENT_NON_FRIEND_SESSIONS", fileRoblox.frequentNonFriendSessions || 2, 1),
      links: {
        friendRequestsUrl: envText(
          "ROBLOX_FRIEND_REQUESTS_URL",
          fileRoblox?.links?.friendRequestsUrl || "https://www.roblox.com/users/friends#!/friend-requests"
        ),
        jjsGameUrl: envText("ROBLOX_JJS_GAME_URL", fileRoblox?.links?.jjsGameUrl || ""),
      },
    },
    verification: {
      enabled: envBoolean("VERIFICATION_ENABLED", fileConfig?.verification?.enabled === true),
      callbackBaseUrl: envText("DISCORD_OAUTH_REDIRECT_URI", fileConfig?.verification?.callbackBaseUrl || ""),
      verificationChannelId: envText("VERIFICATION_CHANNEL_ID", fileConfig?.verification?.verificationChannelId || ""),
      reportChannelId: envText("VERIFICATION_REPORT_CHANNEL_ID", fileConfig?.verification?.reportChannelId || ""),
      reportSweepMinutes: envInteger("VERIFICATION_REPORT_SWEEP_MINUTES", fileConfig?.verification?.reportSweepMinutes || 60, 5),
      stageTexts: fileConfig?.verification?.stageTexts && typeof fileConfig.verification.stageTexts === "object" ? fileConfig.verification.stageTexts : {},
      riskRules: fileConfig?.verification?.riskRules && typeof fileConfig.verification.riskRules === "object" ? fileConfig.verification.riskRules : {},
      deadline: fileConfig?.verification?.deadline && typeof fileConfig.verification.deadline === "object"
        ? {
            ...fileConfig.verification.deadline,
            pendingDays: envInteger("VERIFICATION_PENDING_DAYS", fileConfig?.verification?.deadline?.pendingDays || 7, 1),
          }
        : {
            pendingDays: envInteger("VERIFICATION_PENDING_DAYS", 7, 1),
            reportOnly: true,
          },
      entryMessage: fileConfig?.verification?.entryMessage && typeof fileConfig.verification.entryMessage === "object" ? fileConfig.verification.entryMessage : {},
    },
        moderation: {
          primaryAdminUserId: envText("PRIMARY_ADMIN_USER_ID", fileConfig?.moderation?.primaryAdminUserId || ""),
        },
    characters,
  };
}

function normalizeCharacterId(value, fallback = "") {
  const text = String(value || "").trim().toLowerCase();
  const normalized = text.replace(/[^a-zа-яё0-9]+/gi, "_").replace(/^_+|_+$/g, "");
  return normalized || String(fallback || "").trim();
}

function normalizeCharacterCatalog(value, fallback = []) {
  const source = Array.isArray(value) ? value : fallback;
  const out = [];
  const seen = new Set();

  for (const entry of source) {
    const label = String(entry?.label || "").trim();
    const id = normalizeCharacterId(entry?.id || label, `char_${out.length + 1}`);
    const roleId = String(entry?.roleId || "").trim();
    if (!label || !id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label, roleId });
  }

  return out;
}

function validateRuntimeConfig(config) {
  const errors = [];

  if (!DISCORD_TOKEN) errors.push("DISCORD_TOKEN отсутствует в .env");
  if (!GUILD_ID) errors.push("GUILD_ID отсутствует в .env");
  if (!config || typeof config !== "object") errors.push("bot.config.json не найден или повреждён");

  if (!config?.channels) {
    errors.push("channels отсутствует в bot.config.json");
  }

  if (config?.roles) {
    if (isPlaceholder(config.roles.moderatorRoleId)) errors.push("roles.moderatorRoleId не заполнен");
    if (isPlaceholder(config.roles.accessRoleId)) errors.push("roles.accessRoleId не заполнен");
  } else {
    errors.push("roles отсутствует в bot.config.json");
  }

  if (!Array.isArray(config?.characters) || !config.characters.length) {
    errors.push("characters должен содержать хотя бы одного персонажа");
  } else {
    if (config.characters.length > 25) {
      errors.push("characters не должен содержать больше 25 опций для select menu");
    }

    const seenIds = new Set();
    for (const character of config.characters) {
      const id = String(character?.id || "").trim();
      const label = String(character?.label || "").trim();

      if (!id) errors.push("У одного из characters отсутствует id");
      if (!label) errors.push(`У персонажа ${id || "(без id)"} отсутствует label`);
      if (seenIds.has(id)) errors.push(`Повторяющийся character id: ${id}`);
      seenIds.add(id);
    }
  }

  if (errors.length) {
    throw new Error(`Конфиг заполнен не полностью:\n- ${errors.join("\n- ")}`);
  }
}

const fileConfig = loadJsonFile(CONFIG_PATH, {});
const appConfig = buildRuntimeConfig(fileConfig);
validateRuntimeConfig(appConfig);

function buildSotLegacyOptions(currentDb) {
  const liveTierlistState = getLiveLegacyTierlistState(currentDb);
  const legacyTierlistCustomCharacterIds = liveTierlistState.ok
    ? listLegacyTierlistCustomCharacterIds(liveTierlistState)
    : [];
  return {
    appConfig,
    legacyTierlistCustomCharacterIds,
    presentation: resolvePresentation(currentDb?.config || {}, fileConfig, { defaultGraphicTierColors: DEFAULT_GRAPHIC_TIER_COLORS }),
    nonGgsPresentation: currentDb?.config?.presentation?.nonGgs || currentDb?.config?.nonJjsUi || currentDb?.config?.nonGgsUi || {},
    influence: liveTierlistState.ok
      ? buildLegacyTierlistInfluenceConfig(liveTierlistState.rawState)
      : {
          default: 1,
          tiers: LEGACY_TIERLIST_ROLE_INFLUENCE,
        },
  };
}

function syncSotShadowState(currentDb) {
  return syncShadowSotState(currentDb, buildSotLegacyOptions(currentDb));
}

function syncSotCoreDualWrite(currentDb) {
  const legacyOptions = buildSotLegacyOptions(currentDb);
  const channelState = syncLegacyChannelWrites(currentDb, { appConfig: legacyOptions.appConfig });
  const roleState = syncLegacyRoleWrites(currentDb, { appConfig: legacyOptions.appConfig });
  const characterState = syncLegacyCharacterWrites(currentDb, {
    appConfig: legacyOptions.appConfig,
    excludedCharacterIds: legacyOptions.legacyTierlistCustomCharacterIds,
  });
  const panelState = syncLegacyPanelWrites(currentDb);
  const integrationState = syncLegacyIntegrationWrites(currentDb);
  const presentationState = syncLegacyPresentationWrites(currentDb, legacyOptions);
  const influenceState = syncLegacyInfluenceWrites(currentDb, legacyOptions);

  return {
    mutated: Boolean(channelState.mutated || roleState.mutated || characterState.mutated || panelState.mutated || integrationState.mutated || presentationState.mutated || influenceState.mutated),
    writtenSlots: [
      ...channelState.writtenSlots.map((slot) => `channels.${slot}`),
      ...roleState.writtenSlots.map((slot) => `roles.${slot}`),
      ...characterState.writtenSlots.map((slot) => `characters.${slot}`),
      ...panelState.writtenSlots.map((slot) => `panels.${slot}`),
      ...integrationState.writtenSlots.map((slot) => `integrations.${slot}`),
      ...presentationState.writtenSlots.map((slot) => `presentation.${slot}`),
      ...influenceState.writtenSlots.map((slot) => `influence.${slot}`),
    ],
    channelState,
    characterState,
    influenceState,
    integrationState,
    panelState,
    presentationState,
    roleState,
  };
}

function logSotDrift(currentDb, reason = "save") {
  const mismatches = compareSotVsLegacy({
    db: currentDb,
    ...buildSotLegacyOptions(currentDb),
  });
  if (!mismatches.length) return mismatches;

  const summary = summarizeCompareMismatches(mismatches, { limit: 5 });
  const domainSummary = Object.entries(summary.countsByDomain)
    .map(([domain, count]) => `${domain}=${count}`)
    .join(" ");
  const preview = summary.preview.join(", ");
  console.warn(`[sot] drift after ${reason}: total=${summary.total} ${domainSummary}${preview ? ` ${preview}` : ""}`);
  return mismatches;
}

const dbStore = createDbStore({
  dbPath: DB_PATH,
  dataRoot: DATA_ROOT,
  appConfig,
  fileConfig,
  defaultGraphicTierColors: DEFAULT_GRAPHIC_TIER_COLORS,
  normalizeCharacterCatalog,
  createDefaultIntegrationState,
  createOnboardModeState,
  createOnboardAccessGrantState,
  ensurePresentationConfig,
  createPresentationDefaults,
  normalizeRoleGrantRegistry,
  normalizeIntegrationState,
  normalizeComboGuideEditorRoleIds,
  importDormantEloSyncFromFile,
  importDormantTierlistSyncFromFile,
  syncSharedProfiles,
  dualWriteSotState: syncSotCoreDualWrite,
  syncSotState: syncSotShadowState,
});

function loadDb() {
  return dbStore.load();
}

const db = loadDb();
if (appConfig?.moderation?.primaryAdminUserId) {
  setAutonomyGuardPrimaryAdminUserId(db, appConfig.moderation.primaryAdminUserId);
}
configureSharedProfileRuntime({ roblox: getEffectiveRobloxConfig() });
const robloxApiClient = createRobloxApiClient();
const robloxJobCoordinator = createRobloxJobCoordinator({
  logError: (...args) => console.error(...args),
});
const serializedDbRunnerOptions = {
  logError: (...args) => console.error(...args),
  logWarning: (...args) => console.warn(...args),
  taskTimeoutMs: 60 * 1000,
  queueWarningThreshold: 25,
};
const runSerializedDbMutation = createSerializedMutationRunner(serializedDbRunnerOptions);
const runSerializedDbTask = createSerializedTaskRunner(serializedDbRunnerOptions);
const robloxRuntimeState = createRobloxRuntimeState();
const robloxPanelTelemetry = createRobloxPanelTelemetry({ now: nowIso });
let readyClient = null;
let robloxIntervalHandles = [];

logSotDrift(db, "startup-load");

function saveDb() {
  const result = dbStore.save(db);
  logSotDrift(db, "save");
  return result;
}

if (db.__needsSaveAfterLoad) saveDb();

function nowIso() {
  return new Date().toISOString();
}

const runScheduledRobloxProfileRefreshJob = robloxPanelTelemetry.wrapJob("profile_refresh", robloxJobCoordinator.createRunner("profile_refresh", () => runRobloxProfileRefreshJobCore({
  db,
  now: nowIso,
  fetchUserProfile: robloxApiClient.fetchUserProfile.bind(robloxApiClient),
  fetchUserAvatarHeadshots: robloxApiClient.fetchUserAvatarHeadshots.bind(robloxApiClient),
  fetchUserUsernameHistory: robloxApiClient.fetchUserUsernameHistory.bind(robloxApiClient),
  logError: (...args) => console.error(...args),
})));

const syncRobloxPlaytime = robloxPanelTelemetry.wrapJob("playtime_sync", robloxJobCoordinator.createRunner("playtime_sync", () => runRobloxPlaytimeSyncJob({
  db,
  runtimeState: robloxRuntimeState,
  now: nowIso,
  roblox: getEffectiveRobloxConfig(),
  fetchUserPresences: robloxApiClient.fetchUserPresences.bind(robloxApiClient),
  logError: (...args) => console.error(...args),
})));

const flushRobloxRuntime = robloxPanelTelemetry.wrapJob("runtime_flush", robloxJobCoordinator.createRunner("runtime_flush", () => flushRobloxRuntimeState({
  db,
  runtimeState: robloxRuntimeState,
  now: nowIso,
  saveDb,
})));

function cloneJsonValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function getEffectiveRobloxConfig(currentDb = db) {
  return mergeRobloxRuntimeConfig(
    appConfig?.roblox || {},
    getResolvedIntegrationRecord("roblox", currentDb) || {}
  );
}

function getEffectiveAppConfig(currentDb = db) {
  return {
    ...appConfig,
    roblox: getEffectiveRobloxConfig(currentDb),
  };
}

function rescheduleRobloxIntervals(client = readyClient) {
  if (!client) {
    return [];
  }

  const robloxConfig = getEffectiveRobloxConfig();
  robloxIntervalHandles = rebuildRobloxIntervalHandles({
    client,
    currentHandles: robloxIntervalHandles,
    clearIntervalFn: clearInterval,
    buildRobloxPeriodicJobs,
    schedulePeriodicJobs,
    configureSharedProfileRuntime,
    runRobloxProfileRefreshJob: runScheduledRobloxProfileRefreshJob,
    syncRobloxPlaytime,
    flushRobloxRuntime,
    robloxConfig,
    logError: (...args) => console.error(...args),
  });
  return robloxIntervalHandles;
}

function restoreRecordValue(container, key, previousValue, hadValue) {
  if (!container || typeof container !== "object") return;
  if (hadValue) {
    container[key] = cloneJsonValue(previousValue);
    return;
  }
  delete container[key];
}

function formatRuntimeError(error) {
  return String(error?.message || error || "неизвестная ошибка").trim() || "неизвестная ошибка";
}

function captureRobloxIntegrationSnapshot(currentDb = db) {
  const sotIntegrations = currentDb?.sot?.integrations;
  const legacyIntegrations = currentDb?.config?.integrations;

  return {
    hadSotRoblox: Boolean(sotIntegrations) && Object.prototype.hasOwnProperty.call(sotIntegrations, "roblox"),
    hadLegacyRoblox: Boolean(legacyIntegrations) && Object.prototype.hasOwnProperty.call(legacyIntegrations, "roblox"),
    sotRoblox: cloneJsonValue(sotIntegrations?.roblox),
    legacyRoblox: cloneJsonValue(legacyIntegrations?.roblox),
  };
}

function restoreRobloxIntegrationSnapshot(snapshot = {}, currentDb = db) {
  currentDb.sot ||= {};
  currentDb.sot.integrations ||= {};
  currentDb.config ||= {};
  currentDb.config.integrations ||= {};

  if (snapshot.hadSotRoblox) {
    currentDb.sot.integrations.roblox = cloneJsonValue(snapshot.sotRoblox) || {};
  } else {
    delete currentDb.sot.integrations.roblox;
  }

  if (snapshot.hadLegacyRoblox) {
    currentDb.config.integrations.roblox = cloneJsonValue(snapshot.legacyRoblox) || {};
  } else {
    delete currentDb.config.integrations.roblox;
  }
}

function captureProfilesSnapshot(currentDb = db) {
  return cloneJsonValue(currentDb?.profiles || {});
}

function restoreProfilesSnapshot(snapshot = {}, currentDb = db) {
  currentDb.profiles = cloneJsonValue(snapshot) || {};
}

function isDiscordMissingResourceError(error) {
  const code = Number(error?.code || 0);
  return code === 10003 || code === 10008;
}

function makeId() {
  return (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)).toUpperCase();
}

function formatDateTime(value) {
  const ts = Date.parse(value || "");
  if (!Number.isFinite(ts)) return "—";
  return new Date(ts).toLocaleString("ru-RU");
}

function hoursSince(value) {
  const ts = Date.parse(value || "");
  if (!Number.isFinite(ts)) return Number.POSITIVE_INFINITY;
  return (Date.now() - ts) / 36e5;
}

function parseKillCount(input) {
  const digits = String(input || "").replace(/[^\d]+/g, "");
  if (!digits.length) return null;
  const value = Number(digits);
  if (!Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

function killTierFor(kills) {
  const amount = Number(kills);
  if (!Number.isFinite(amount) || amount < 0) return null;
  if (amount >= 11000) return 5;
  if (amount >= 7000) return 4;
  if (amount >= 3000) return 3;
  if (amount >= 1000) return 2;
  return 1;
}

function getPresentation() {
  return {
    welcome: getSotPresentation("welcome", { db, appConfig }),
    tierlist: getSotPresentation("tierlist", { db, appConfig }),
    nonGgs: getSotPresentation("nonGgs", { db, appConfig }),
  };
}

function formatTierLabel(tier) {
  return getTierLabel(getPresentation(), tier);
}

const GRAPHIC_PANEL_TIERS = Object.freeze([5, 4, 3, 2, 1, 6]);
const GRAPHIC_PANEL_RUNTIME_MARKER = "gp-2026-05-15-b";

function normalizeGraphicPanelSelectedTier(value, fallback = 5) {
  const selectedTier = Number(value);
  if (GRAPHIC_PANEL_TIERS.includes(selectedTier)) return selectedTier;

  const fallbackTier = Number(fallback);
  return GRAPHIC_PANEL_TIERS.includes(fallbackTier) ? fallbackTier : 5;
}

function ephemeralPayload(payload) {
  return { ...payload, flags: MessageFlags.Ephemeral };
}

function getCharacterSelectValue(characterId) {
  return `main_${String(characterId || "x").trim() || "x"}`;
}

function getCharacterIdFromSelectValue(value) {
  return String(value || "").replace(/^main_/, "").trim();
}

function normalizeCharacterSelectLabel(label) {
  const normalized = String(label || "").trim();
  if (normalized.length >= 2) return normalized.slice(0, 100);
  if (normalized.length === 1) return `${normalized} •`;
  return "??";
}

function getGeneratedRoleState() {
  db.config.generatedRoles ||= { characters: {}, characterLabels: {}, tiers: {} };
  db.config.generatedRoles.characters ||= {};
  db.config.generatedRoles.characterLabels ||= {};
  db.config.generatedRoles.tiers ||= {};
  return db.config.generatedRoles;
}

function getDiagnosticHistoricalManagedCharacterRoleIds(managedCharacters = getConfiguredManagedCharacterCatalog()) {
  return buildHistoricalManagedCharacterRoleIds({
    managedCharacters,
    profiles: db.profiles,
    submissions: db.submissions,
  });
}

function getLegacyReportManagedCharacterCatalog() {
  const generatedRoles = getGeneratedRoleState();

  return getConfiguredManagedCharacterCatalog().map((entry) => {
    const aliasNames = getCharacterAliasNames(entry.id);
    return {
      ...entry,
      label: String(generatedRoles.characterLabels?.[entry.id] || entry.label || "").trim() || entry.label,
      evidence: aliasNames.length ? { aliasNames } : undefined,
    };
  });
}

function getManagedCharacterCatalog(currentDb = db) {
  const excludedCharacterIds = getLegacyTierlistCustomCharacterIds(currentDb);
  const resolvedRecords = listSotCharacters({
    db: currentDb,
    appConfig,
    excludedCharacterIds,
    includeUnresolved: true,
  });

  return buildConfiguredCharacterCatalogView({
    configuredCharacters: appConfig.characters,
    resolvedRecords,
    excludedCharacterIds,
  });
}

function getConfiguredManagedCharacterCatalog() {
  return normalizeManagedCharacterCatalog(appConfig.characters);
}

function getManagedCharacterRoleIdMap(entries = getManagedCharacterCatalog()) {
  return Object.fromEntries(
    (Array.isArray(entries) ? entries : [])
      .map((entry) => [String(entry?.id || "").trim(), String(entry?.roleId || "").trim()])
      .filter(([characterId, roleId]) => characterId && roleId)
  );
}

function getLegacyTierlistCustomCharacterIds(currentDb = db) {
  const sourcePath = String(getResolvedIntegrationSourcePath("tierlist", currentDb) || "").trim();
  if (!sourcePath) return [];

  const resolvedStatePath = path.isAbsolute(sourcePath)
    ? sourcePath
    : path.resolve(DATA_ROOT || process.cwd(), sourcePath);
  const customCharactersPath = path.join(path.dirname(resolvedStatePath), "characters.custom.json");

  if (!fs.existsSync(customCharactersPath)) return [];

  return listLegacyTierlistCustomCharacterIds({ customCharactersPath });
}

function getCharacterCatalog(currentDb = db) {
  return getManagedCharacterCatalog(currentDb).map((entry) => ({
    id: String(entry?.id || "").trim(),
    label: String(entry?.label || entry?.id || "").trim(),
    roleId: String(entry?.roleId || "").trim(),
  }));
}

function getLegacyTierlistBaseCharacterCatalog(currentDb = db) {
  return getManagedCharacterCatalog(currentDb).map((entry) => ({
    id: String(entry.id || "").trim(),
    label: String(entry.label || entry.id || "").trim(),
  }));
}

function getResolvedChannelId(slot) {
  const channelId = getSotChannelValue(slot, { db, appConfig });
  return isPlaceholder(channelId) ? "" : channelId;
}

function getTextTierlistManagedMessageIds(state = null) {
  const textState = state || getResolvedTextTierlistBoardSnapshot();
  const hasSplitLayout = Boolean(
    String(textState?.messageIdSummary || "").trim()
    || String(textState?.messageIdPages || "").trim()
  );
  return [...new Set([
    String(textState?.messageIdSummary || "").trim(),
    String(textState?.messageIdPages || "").trim(),
    hasSplitLayout ? "" : String(textState?.messageId || "").trim(),
  ].filter(Boolean))];
}

function getTextTierlistSummaryMessageId(state = null) {
  const textState = state || getResolvedTextTierlistBoardSnapshot();
  return String(textState?.messageIdSummary || textState?.messageIdPages || textState?.messageId || "").trim();
}

function clearTextTierlistBoardMessageIds(state) {
  if (!state || typeof state !== "object") return;
  state.messageId = "";
  state.messageIdSummary = "";
  state.messageIdPages = "";
}

function hasTextTierlistManagedMessages(state = null) {
  return getTextTierlistManagedMessageIds(state).length > 0;
}

function getResolvedPanelRecord(slot) {
  return getSotPanel(slot, { db, appConfig }) || null;
}

function getPanelRecordValue(record, messageSlot = "main") {
  return String(record?.messageIds?.[messageSlot]?.value || "").trim();
}

function getResolvedWelcomePanelSnapshot() {
  const record = getResolvedPanelRecord("welcome");
  return {
    channelId: String(record?.channelId?.value || "").trim(),
    messageId: getPanelRecordValue(record),
    lastUpdated: record?.lastUpdated || null,
  };
}

function getResolvedNonGgsPanelSnapshot() {
  const record = getResolvedPanelRecord("nonGgs");
  return {
    channelId: String(record?.channelId?.value || "").trim(),
    messageId: getPanelRecordValue(record),
    lastUpdated: record?.lastUpdated || null,
  };
}

function getResolvedEloSubmitPanelSnapshot() {
  const record = getResolvedPanelRecord("eloSubmit");
  return {
    channelId: String(record?.channelId?.value || "").trim(),
    messageId: getPanelRecordValue(record),
    lastUpdated: record?.lastUpdated || null,
  };
}

function getResolvedEloGraphicPanelSnapshot() {
  const record = getResolvedPanelRecord("eloGraphic");
  return {
    channelId: String(record?.channelId?.value || "").trim(),
    messageId: getPanelRecordValue(record),
    lastUpdated: record?.lastUpdated || null,
  };
}

function getResolvedLegacyTierlistDashboardSnapshot() {
  const record = getResolvedPanelRecord("tierlistDashboard");
  return {
    channelId: String(record?.channelId?.value || "").trim(),
    messageId: getPanelRecordValue(record),
    lastUpdated: record?.lastUpdated || null,
  };
}

function getResolvedLegacyTierlistSummarySnapshot() {
  const record = getResolvedPanelRecord("tierlistSummary");
  return {
    channelId: String(record?.channelId?.value || "").trim(),
    messageId: getPanelRecordValue(record),
    lastUpdated: record?.lastUpdated || null,
  };
}

function getResolvedTextTierlistBoardSnapshot() {
  const record = getResolvedPanelRecord("tierlistText");
  const mainMessageId = getPanelRecordValue(record, "main");
  const summaryMessageId = getPanelRecordValue(record, "summary");
  const pagesMessageId = getPanelRecordValue(record, "pages");
  const hasSplitLayout = Boolean(summaryMessageId || pagesMessageId);
  return {
    channelId: String(record?.channelId?.value || "").trim(),
    messageId: hasSplitLayout ? "" : mainMessageId,
    messageIdSummary: summaryMessageId,
    messageIdPages: pagesMessageId,
    lastUpdated: record?.lastUpdated || null,
  };
}

function getResolvedGraphicTierlistBoardSnapshot() {
  const record = getResolvedPanelRecord("tierlistGraphic");
  return {
    channelId: String(record?.channelId?.value || "").trim(),
    messageId: getPanelRecordValue(record),
    lastUpdated: record?.lastUpdated || null,
  };
}

function getResolvedIntegrationRecord(slot, currentDb = db) {
  return getSotIntegration(slot, { db: currentDb, appConfig }) || {};
}

function getResolvedIntegrationSourcePath(slot, currentDb = db) {
  return String(getResolvedIntegrationRecord(slot, currentDb).sourcePath || "").trim();
}

function getNonJjsUiConfig() {
  const nonJjsPresentation = getPresentation().nonGgs || {};
  return {
    title: String(nonJjsPresentation.title || "Я не играю в JJS").trim(),
    description: String(
      nonJjsPresentation.description ||
      "Если ты не играешь в JJS, нажми кнопку ниже. Бот запустит 2 этапа капчи и после успешного прохождения выдаст отдельную роль доступа."
    ).trim(),
    buttonLabel: String(nonJjsPresentation.buttonLabel || "Я не играю в JJS").trim(),
  };
}

function formatNumber(value) {
  const amount = Number(value) || 0;
  return amount.toLocaleString("ru-RU");
}

function formatPercent(value) {
  const amount = Number(value) || 0;
  const rounded = Math.round(amount * 10) / 10;
  return `${rounded.toLocaleString("ru-RU", {
    minimumFractionDigits: Number.isInteger(rounded) ? 0 : 1,
    maximumFractionDigits: 1,
  })}%`;
}

function previewText(value, max = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function formatRoleMention(roleId) {
  const id = String(roleId || "").trim();
  return id ? `<@&${id}>` : "—";
}

function formatChannelMention(channelId) {
  const id = String(channelId || "").trim();
  return id ? `<#${id}>` : "—";
}

function previewFieldText(value, max = 1024) {
  const text = String(value || "").trim();
  if (!text) return "—";
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

function getProfileDisplayName(userId, profile = null) {
  const currentProfile = profile || db.profiles?.[userId] || {};
  if (currentProfile.displayName) return String(currentProfile.displayName).trim();
  if (currentProfile.username) return String(currentProfile.username).trim();

  const latestSubmission = getLatestSubmissionForUser(userId);
  if (latestSubmission?.displayName) return String(latestSubmission.displayName).trim();
  if (latestSubmission?.username) return String(latestSubmission.username).trim();
  return `User ${userId}`;
}

function getSubmitCooldownLeftSeconds(userId) {
  const last = Number(db.cooldowns?.[userId]) || 0;
  if (!last) return 0;
  return Math.max(0, SUBMIT_COOLDOWN_SECONDS - Math.floor((Date.now() - last) / 1000));
}

function setSubmitCooldown(userId) {
  db.cooldowns ||= {};
  db.cooldowns[userId] = Date.now();
}

function buildMyCardEmbed(userId) {
  const profile = db.profiles?.[userId] ? getProfile(userId) : null;
  const pending = getPendingSubmissionForUser(userId);
  const displayName = getProfileDisplayName(userId);

  if (!profile && !pending) {
    return new EmbedBuilder()
      .setTitle("Моя карточка")
      .setDescription("У тебя ещё нет профиля. Нажми **Получить роль** чтобы начать.");
  }

  const lines = [`**Игрок:** ${displayName}`];
  if (profile?.mainCharacterLabels?.length) {
    lines.push(`**Мейны:** ${profile.mainCharacterLabels.join(", ")}`);
  }
  if (Number.isFinite(profile?.approvedKills)) {
    lines.push(`**Kills:** ${formatNumber(profile.approvedKills)}`);
    lines.push(`**Тир:** ${profile.killTier} (${formatTierLabel(profile.killTier)})`);
  }
  if (profile?.lastSubmissionStatus) {
    lines.push(`**Статус последней заявки:** ${profile.lastSubmissionStatus}`);
  }
  if (profile?.nonGgsAccessGrantedAt) {
    lines.push(`**Отдельный доступ без JJS:** ${formatDateTime(profile.nonGgsAccessGrantedAt)}`);
  }
  if (pending) {
    lines.push("");
    lines.push(`⏳ **Pending-заявка:** kills ${pending.kills}, ${formatTierLabel(pending.derivedTier)} — ожидает проверки.`);
  }

  return new EmbedBuilder().setTitle("Моя карточка").setDescription(lines.join("\n"));
}

function getApprovedTierlistEntries(options = {}) {
  const liveMainsByUserId = options?.liveMainsByUserId;
  const allowedUserIds = options?.allowedUserIds instanceof Set ? options.allowedUserIds : null;
  const characterEntries = getCharacterEntries();
  const characterById = new Map(characterEntries.map((entry) => [entry.id, entry]));
  const characterByLabel = new Map(characterEntries.map((entry) => [String(entry.label).toLowerCase(), entry]));
  const buildFallbackMains = (profile) => {
    const derivedProfileMains = deriveProfileMainView(profile, characterEntries);
    const ids = derivedProfileMains.mainCharacterIds;
    const labels = derivedProfileMains.mainCharacterLabels;
    const out = [];
    const seen = new Set();
    for (const rawId of ids) {
      const id = String(rawId || "").trim();
      if (!id || seen.has(id)) continue;
      const entry = characterById.get(id);
      if (entry) {
        out.push({ id: entry.id, label: entry.label, roleId: entry.roleId });
        seen.add(id);
      } else {
        out.push({ id, label: id, roleId: "" });
        seen.add(id);
      }
    }
    if (!out.length && labels.length) {
      for (const label of labels) {
        const key = String(label || "").toLowerCase();
        if (!key) continue;
        const entry = characterByLabel.get(key);
        if (entry && !seen.has(entry.id)) {
          out.push({ id: entry.id, label: entry.label, roleId: entry.roleId });
          seen.add(entry.id);
        } else if (!seen.has(key)) {
          out.push({ id: key, label: String(label), roleId: "" });
          seen.add(key);
        }
      }
    }
    return out;
  };
  const approvedEntries = filterEntriesByAllowedUserIds(Object.entries(db.profiles || {})
    .map(([userId, profile]) => {
      const liveMains = liveMainsByUserId instanceof Map ? liveMainsByUserId.get(userId) : null;
      const mains = (Array.isArray(liveMains) && liveMains.length) ? liveMains : buildFallbackMains(profile);
      return {
        userId,
        profile,
        approvedKills: parseTrackedStatNumber(profile?.approvedKills),
        killTier: parseTrackedStatNumber(profile?.killTier),
        displayName: getProfileDisplayName(userId, profile),
        mains,
        updatedAt: profile?.updatedAt || null,
      };
    })
    .filter((entry) => Number.isFinite(entry.approvedKills) && entry.approvedKills >= 0 && Number.isFinite(entry.killTier) && entry.killTier >= 1)
    .sort((left, right) => {
      if (right.approvedKills !== left.approvedKills) return right.approvedKills - left.approvedKills;
      return left.displayName.localeCompare(right.displayName, "ru");
    }), allowedUserIds);

  return applyTierlistSpecialMembers(approvedEntries, {
    nonFakeUserIds: getTierlistNonFakeUserIdSet(db.config),
  });
}

function getLiveApprovedTierlistEntries(liveContext) {
  return getApprovedTierlistEntries({
    liveMainsByUserId: liveContext?.liveMainsByUserId,
    allowedUserIds: liveContext?.trackedUserIds,
  });
}

function buildTierlistNonFakeListText(userIds = getTierlistNonFakeUserIds(db.config)) {
  if (!userIds.length) {
    return "Remembered список не фейкостановцев пуст.";
  }

  return [
    `Remembered не фейкостановцы: ${userIds.length}.`,
    userIds.map((userId, index) => `${index + 1}. <@${userId}> (${userId})`).join("\n"),
    "У этих участников меняется только display-кластер тир-листа, но не реальный kill-tier.",
  ].join("\n\n");
}

async function applyTierlistNonFakeClusterMutation(client, targetId, enabled) {
  let result = null;
  await applyUiMutation(client, "none", () => {
    result = setTierlistNonFakeUser(db.config, targetId, enabled);
  });

  const refreshWarnings = [];
  await refreshGraphicTierlistBoard(client).catch((error) => {
    refreshWarnings.push(`PNG: ${formatRuntimeError(error)}`);
  });
  await refreshTextTierlistBoard(client, { page: 0 }).catch((error) => {
    refreshWarnings.push(`Текст: ${formatRuntimeError(error)}`);
  });

  return { result, refreshWarnings };
}

function buildTierlistNonFakeMutationText(targetId, enabled, result, refreshWarnings = []) {
  const statusText = enabled
    ? (result?.changed ? "добавлен в remembered T6-кластер" : "уже был в remembered T6-кластере")
    : (result?.changed ? "убран из remembered T6-кластера" : "уже отсутствовал в remembered T6-кластере");

  const lines = [
    `<@${targetId}> ${statusText}.`,
    `Сейчас remembered не фейкостановцев: ${result?.userIds?.length || 0}.`,
    "Kill-tier роли не меняются: меняется только display-кластер тир-листа.",
  ];
  if (refreshWarnings.length) {
    lines.push(`Борды обновлены с предупреждениями: ${refreshWarnings.join("; ")}`);
  }
  return lines.join("\n");
}

function getStatsSnapshot(entries) {
  return getTierlistStats(entries, Object.values(db.submissions || {}));
}

function normalizeCharacterReference(value) {
  if (!value) return null;
  if (typeof value === "object") {
    const id = String(value.id || "").trim();
    const label = String(value.label || value.name || value.id || "").trim();
    const roleId = String(value.roleId || "").trim();
    if (!id && !label && !roleId) return null;
    return { id, label, roleId };
  }

  const label = String(value || "").trim();
  return label ? { id: "", label, roleId: "" } : null;
}

function formatCharacterReference(value) {
  const reference = normalizeCharacterReference(value);
  if (!reference) return "—";
  return reference.roleId ? formatRoleMention(reference.roleId) : (reference.label || "—");
}

function formatCharacterReferenceList(values = []) {
  const formatted = [...new Set((Array.isArray(values) ? values : [])
    .map((value) => formatCharacterReference(value))
    .filter(Boolean))];
  return formatted.length ? formatted.join(", ") : "—";
}

function parseTrackedStatNumber(value) {
  if (value === null || value === undefined) return NaN;
  if (typeof value === "string" && !value.trim()) return NaN;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : NaN;
}

function hasTrackedProfileKills(profile) {
  const approvedKills = parseTrackedStatNumber(profile?.approvedKills);
  const killTier = parseTrackedStatNumber(profile?.killTier);
  return Number.isFinite(approvedKills) && approvedKills >= 0 && Number.isFinite(killTier) && killTier >= 1 && killTier <= 5;
}

function createTrackedLiveMemberEntry(userId, member) {
  const profile = db.profiles?.[userId];
  return {
    userId,
    displayName: member?.displayName || getProfileDisplayName(userId, profile),
    approvedKills: parseTrackedStatNumber(profile?.approvedKills),
    killTier: parseTrackedStatNumber(profile?.killTier),
    hasLiveKillRole: true,
  };
}

let liveCharacterStatsContextCache = { at: 0, value: null, promise: null };
const LIVE_CHARACTER_STATS_CACHE_TTL_MS = 60 * 1000;

function invalidateLiveCharacterStatsContext() {
  liveCharacterStatsContextCache = { at: 0, value: null, promise: null };
}

async function getLiveCharacterStatsContext(client, options = {}) {
  const now = Date.now();
  if (!options.force && liveCharacterStatsContextCache.value && (now - liveCharacterStatsContextCache.at) < LIVE_CHARACTER_STATS_CACHE_TTL_MS) {
    return liveCharacterStatsContextCache.value;
  }
  if (liveCharacterStatsContextCache.promise) {
    return liveCharacterStatsContextCache.promise;
  }
  const promise = (async () => {
    const guild = await getGuild(client);
    if (!guild) {
      throw new Error("Не удалось получить сервер для статистики ролей персонажей.");
    }

    // Use cache first; only force-fetch if cache looks empty (cold start).
    if (guild.members.cache.size < 2) {
      try { await guild.members.fetch(); } catch (error) { console.warn("guild.members.fetch failed:", error?.message || error); }
    }

    const characterEntries = getCharacterEntries().filter((entry) => isLiveCharacterEntry(entry));
    if (!characterEntries.length) {
      return {
        liveMainsByUserId: new Map(),
        trackedUserIds: new Set(),
        trackedMemberStats: getTrackedMemberStats([]),
        characterStats: [],
      };
    }

    const characterStatsInputById = new Map(
      characterEntries.map((entry) => [
        entry.id,
        {
          id: entry.id,
          main: entry.label,
          roleId: entry.roleId,
          roleHolderCount: 0,
          rememberedMembers: [],
        },
      ])
    );
    const liveMainsByUserId = new Map();
    const trackedMembersByUserId = new Map();
    const tierRoleIds = getAllTierRoleIds();

    for (const member of guild.members.cache.values()) {
      if (member.user?.bot) continue;

      const memberCharacters = characterEntries.filter((entry) => member.roles.cache.has(entry.roleId));
      if (!memberCharacters.length) continue;
      if (!hasAnyAllowedRole(member.roles.cache.keys(), tierRoleIds)) continue;

      const liveMains = memberCharacters
        .map((entry) => ({ id: entry.id, label: entry.label, roleId: entry.roleId }))
        .sort((left, right) => left.label.localeCompare(right.label, "ru"));
      liveMainsByUserId.set(member.id, liveMains);

      let trackedMember = trackedMembersByUserId.get(member.id);
      if (!trackedMember) {
        trackedMember = createTrackedLiveMemberEntry(member.id, member);
        trackedMembersByUserId.set(member.id, trackedMember);
      }

      const remembered = hasTrackedProfileKills(trackedMember);
      for (const character of memberCharacters) {
        const stat = characterStatsInputById.get(character.id);
        if (!stat) continue;
        stat.roleHolderCount += 1;
        if (remembered) stat.rememberedMembers.push(trackedMember);
      }
    }

    return {
      liveMainsByUserId,
      trackedUserIds: new Set(trackedMembersByUserId.keys()),
      trackedMemberStats: getTrackedMemberStats([...trackedMembersByUserId.values()]),
      characterStats: getCharacterRoleStats([...characterStatsInputById.values()]),
    };
  })();
  liveCharacterStatsContextCache.promise = promise;
  try {
    const value = await promise;
    liveCharacterStatsContextCache = { at: Date.now(), value, promise: null };
    return value;
  } catch (error) {
    liveCharacterStatsContextCache = { at: 0, value: null, promise: null };
    throw error;
  }
}

function chunkTextLines(lines, maxLength = 3800, maxLines = 15) {
  const chunks = [];
  let chunk = [];
  let chunkLength = 0;

  const flush = () => {
    if (!chunk.length) return;
    chunks.push(chunk.join("\n"));
    chunk = [];
    chunkLength = 0;
  };

  for (const line of lines) {
    if (chunk.length >= maxLines || chunkLength + line.length + 1 > maxLength) {
      flush();
    }
    chunk.push(line);
    chunkLength += line.length + 1;
  }

  flush();
  return chunks;
}

// Compact kills format: 6641 -> 6.6к, 252000 -> 252к, <100 -> raw number.
function formatKillsCompact(value) {
  const n = Math.max(0, Math.round(Number(value) || 0));
  if (n < 100) return String(n);
  if (n < 10000) {
    const k = n / 1000;
    return `${k.toFixed(1).replace(/\.0$/, "")}к`;
  }
  return `${Math.round(n / 1000)}к`;
}

// Round to 1k for facts: 6641 -> 7к, 124 -> 0к.
function formatKillsRoundK(value) {
  const n = Math.max(0, Math.round(Number(value) || 0));
  return `${Math.round(n / 1000)}к`;
}

function formatDateOnly(timestamp) {
  if (!timestamp) return "—";
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function medianNumber(arr) {
  const s = (Array.isArray(arr) ? arr : []).map(Number).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function cleanupOrphanCharacterRoles(client) {
  const generated = getGeneratedRoleState();
  const catalogIds = new Set(getManagedCharacterCatalog().map((entry) => String(entry.id || "").trim()));
  const orphanIds = Object.keys(generated.characters || {}).filter((id) => !catalogIds.has(String(id).trim()));
  if (!orphanIds.length) return { removed: 0, deletedRoles: 0 };

  void client;
  for (const orphanId of orphanIds) {
    delete generated.characters[orphanId];
    if (generated.characterLabels?.[orphanId]) {
      delete generated.characterLabels[orphanId];
    }
  }
  saveDb();
  invalidateLiveCharacterStatsContext();
  return { removed: orphanIds.length, deletedRoles: 0 };
}

function estimateEmbedTextLength(embed) {
  const data = typeof embed?.toJSON === "function" ? embed.toJSON() : (embed || {});
  let total = 0;

  total += String(data.title || "").length;
  total += String(data.description || "").length;
  total += String(data.footer?.text || "").length;
  total += String(data.author?.name || "").length;

  for (const field of data.fields || []) {
    total += String(field?.name || "").length;
    total += String(field?.value || "").length;
  }

  return total;
}

function buildMainStatsEmbeds(characterStats = []) {
  if (!characterStats.length) return [];

  const popularityLines = characterStats.map((stat, index) =>
    `${index + 1}. ${stat.roleId ? formatRoleMention(stat.roleId) : `**${stat.main}**`} — с kill-ролью: **${formatNumber(stat.roleHolderCount)}** • с kills: **${formatNumber(stat.rememberedCount)}** • сумма: **${formatNumber(stat.totalKills)}** • ср: **${formatNumber(stat.averageKills)}** • мед: **${formatNumber(stat.medianKills)}**`
  );
  const distributionLines = characterStats.map((stat) =>
    `${stat.roleId ? formatRoleMention(stat.roleId) : `**${stat.main}**`} — тиры T5/T4/T3/T2/T1: **${stat.totalsByTier[5]} / ${stat.totalsByTier[4]} / ${stat.totalsByTier[3]} / ${stat.totalsByTier[2]} / ${stat.totalsByTier[1]}**`
  );

  const embeds = [];

  chunkTextLines(popularityLines, 3800, 12).forEach((description, index) => {
    embeds.push(
      new EmbedBuilder()
        .setTitle(index === 0 ? "Персонажи" : `Персонажи — продолжение ${index + 1}`)
        .setDescription(description)
    );
  });

  chunkTextLines(distributionLines, 3800, 12).forEach((description, index) => {
    embeds.push(
      new EmbedBuilder()
        .setTitle(index === 0 ? "Персонажи — тиры" : `Персонажи — тиры ${index + 1}`)
        .setDescription(description)
    );
  });

  return embeds;
}

function buildStatsEmbedsFromContext(entries, liveContext) {
  const stats = getStatsSnapshot(entries);
  const trackedStats = liveContext?.trackedMemberStats || getTrackedMemberStats([]);
  const presentation = getPresentation();

  const lines = [];
  if (!entries.length && trackedStats.totalRoleHolders === 0) {
    lines.push("Пока нет подтверждённых игроков и нет участников с ролью персонажа и kill-ролью.");
  } else if (!entries.length) {
    lines.push("Подтверждённых игроков пока нет.");
  } else {
    const totalKills = stats.totalKills;
    const median = stats.medianKills;
    const avg = stats.averageKills;
    const tiers = trackedStats.totalsByTier || { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    const totalActive = tiers[5] + tiers[4] + tiers[3] + tiers[2] + tiers[1] || entries.length;
    const pct = (n) => totalActive > 0 ? `${Math.round((n / totalActive) * 100)}%` : "0%";

    lines.push(`👥 Активных игроков: **${formatNumber(entries.length)}**`);
  lines.push(`🎭 С ролью персонажа и kill-ролью: **${formatNumber(trackedStats.totalRoleHolders)}** • с сохранёнными kills: **${formatNumber(trackedStats.rememberedCount)}**`);
    lines.push(`💀 Сумма kills: **${formatNumber(totalKills)}**`);
    lines.push(`📊 Среднее: **${formatNumber(avg)}** • медиана: **${formatNumber(median)}**`);
    lines.push("");
    lines.push("**Распределение по тирам**");
    lines.push(`🔴 T5: **${tiers[5]}** (${pct(tiers[5])}) • 🟠 T4: **${tiers[4]}** (${pct(tiers[4])})`);
    lines.push(`🟡 T3: **${tiers[3]}** (${pct(tiers[3])}) • 🟢 T2: **${tiers[2]}** (${pct(tiers[2])}) • ⚪ T1: **${tiers[1]}** (${pct(tiers[1])})`);

    if (stats.topEntry || stats.bottomEntry) {
      lines.push("");
    }
    if (stats.topEntry) {
      const mention = stats.topEntry.userId ? `<@${stats.topEntry.userId}>` : `**${stats.topEntry.displayName}**`;
      lines.push(`🏆 Лидер: ${mention} — **${formatNumber(stats.topEntry.approvedKills)}** kills`);
    }
    if (stats.bottomEntry) {
      const mention = stats.bottomEntry.userId ? `<@${stats.bottomEntry.userId}>` : `**${stats.bottomEntry.displayName}**`;
      lines.push(`🌑 Хвост: ${mention} — **${formatNumber(stats.bottomEntry.approvedKills)}** kills`);
    }
  }

  return [
    new EmbedBuilder()
      .setTitle(`📋 ${presentation.tierlist.textTitle}`)
      .setColor(0x5865F2)
      .setDescription(lines.join("\n")),
    ...buildMainStatsEmbeds(liveContext?.characterStats || []),
  ];
}

async function buildStatsEmbeds(client) {
  const liveContext = await getLiveCharacterStatsContext(client);
  const entries = getLiveApprovedTierlistEntries(liveContext);
  return buildStatsEmbedsFromContext(entries, liveContext);
}

async function buildTierlistEmbeds(client) {
  const liveContext = await getLiveCharacterStatsContext(client);
  const entries = getLiveApprovedTierlistEntries(liveContext);
  const embeds = [...buildStatsEmbedsFromContext(entries, liveContext)];

  if (!entries.length) {
    return { embeds, flags: MessageFlags.Ephemeral };
  }

  let chunk = [];
  let chunkStart = 1;
  let chunkLength = 0;

  const flushChunk = () => {
    if (!chunk.length) return;
    embeds.push(
      new EmbedBuilder()
        .setTitle(`Рейтинг #${chunkStart}-${chunkStart + chunk.length - 1}`)
        .setDescription(chunk.join("\n"))
    );
    chunk = [];
    chunkLength = 0;
  };

  entries.forEach((entry, index) => {
    const lineNumber = index + 1;
    const line = `${lineNumber}. [T${entry.killTier}] ${entry.displayName} — ${formatNumber(entry.approvedKills)} kills • мейны: ${formatCharacterReferenceList(entry.mains)}`;
    if (!chunk.length) chunkStart = lineNumber;

    if (chunk.length >= 15 || chunkLength + line.length + 1 > 3800) {
      flushChunk();
      chunkStart = lineNumber;
    }

    chunk.push(line);
    chunkLength += line.length + 1;
  });

  flushChunk();

  return { embeds, flags: MessageFlags.Ephemeral };
}

async function buildTierlistBoardPayload(client, options = {}) {
  const { pagesPayload } = await buildTextTierlistPayloads(client, options);
  return pagesPayload;
}

async function buildTextTierlistPayloads(client, options = {}) {
  const liveContext = await getLiveCharacterStatsContext(client);
  const entries = getLiveApprovedTierlistEntries(liveContext);
  const recentChanges = collectRecentKillChanges(Object.values(db.submissions || {}));

  const PAGE_SIZE = 25;
  const rankPageCount = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const recentPageCount = paginateRecentKillChanges(recentChanges, {
    page: 0,
    pageSize: RECENT_KILL_CHANGES_PAGE_SIZE,
    maxPages: RECENT_KILL_CHANGES_MAX_PAGES,
  }).pageCount;
  const paginationState = resolveTextTierlistPageState({
    page: options.page,
    recentPage: options.recentPage,
  }, {
    rankPageCount,
    recentPageCount,
  });
  const pageIndex = paginationState.page;
  const recentPageIndex = paginationState.recentPage;

  const presentation = getPresentation();
  const baseTitle = presentation.tierlist.textTitle || "Tier List";
  const tierColors = { 5: 0xE53935, 4: 0xFB8C00, 3: 0xFDD835, 2: 0x43A047, 1: 0x9E9E9E };

  // ELO state for per-row links and ranking adjustments.
  const eloLive = (() => { try { return getLiveLegacyEloState(); } catch { return { ok: false }; } })();
  const eloRatings = (eloLive?.ok && eloLive.rawDb?.ratings) ? eloLive.rawDb.ratings : {};
  const eloBoard = eloLive?.ok && eloLive.rawDb?.elo?.graphic
    ? eloLive.rawDb.elo.graphic
    : (eloLive?.ok && eloLive.rawDb?.graphic ? eloLive.rawDb.graphic : null);
  const eloChannelId = String(eloBoard?.dashboardChannelId || "").trim();
  const eloMessageId = String(eloBoard?.dashboardMessageId || "").trim();
  const eloJumpUrl = (eloChannelId && eloMessageId && GUILD_ID)
    ? `https://discord.com/channels/${GUILD_ID}/${eloChannelId}/${eloMessageId}`
    : "";

  const formatEloChip = (userId) => {
    const rating = eloRatings[userId];
    if (!rating) return "";
    const eloVal = Number(rating.elo);
    const tierVal = Number(rating.tier);
    const parts = [];
    if (Number.isFinite(tierVal) && tierVal >= 1) parts.push(`T${tierVal}`);
    if (Number.isFinite(eloVal)) parts.push(String(eloVal));
    if (!parts.length) return "";
    const label = `ELO ${parts.join(" · ")}`;
    return eloJumpUrl ? `[${label}](${eloJumpUrl})` : label;
  };

  const pageEntries = entries.slice(pageIndex * PAGE_SIZE, pageIndex * PAGE_SIZE + PAGE_SIZE);
  const dominantTier = (() => {
    if (!pageEntries.length) return 0;
    const tally = new Map();
    for (const entry of pageEntries) tally.set(entry.killTier, (tally.get(entry.killTier) || 0) + 1);
    let best = 0; let bestCount = -1;
    for (const [tier, count] of tally) {
      if (count > bestCount) { best = tier; bestCount = count; }
    }
    return best;
  })();
  const embedColor = tierColors[dominantTier] || 0x5865F2;

  const summaryEmbeds = [];
  const pagesEmbeds = [];

  const baseEmbeds = buildStatsEmbedsFromContext(entries, liveContext);
  if (baseEmbeds.length) {
    const first = baseEmbeds[0];
    try { first.setColor(embedColor); } catch {}
    summaryEmbeds.push(first);
  }

  const mainsEmbed = buildCharactersRankingEmbed(entries, liveContext);
  if (mainsEmbed) summaryEmbeds.push(mainsEmbed);

  const recentEmbed = buildRecentKillChangesEmbed(
    paginateRecentKillChanges(recentChanges, {
      page: recentPageIndex,
      pageSize: RECENT_KILL_CHANGES_PAGE_SIZE,
      maxPages: RECENT_KILL_CHANGES_MAX_PAGES,
    })
  );
  if (recentEmbed) pagesEmbeds.push(recentEmbed);

  if (!entries.length) {
    pagesEmbeds.push(
      new EmbedBuilder()
        .setTitle(baseTitle)
        .setColor(embedColor)
        .setDescription("Подтверждённых игроков пока нет.")
    );
  } else {
    const rankLines = pageEntries.map((entry, idx) => {
      const rank = pageIndex * PAGE_SIZE + idx + 1;
      const mention = entry.userId ? `<@${entry.userId}>` : (entry.displayName || "—");
      const mainsText = previewText(formatCharacterReferenceList(entry.mains), 100);
      const eloChip = formatEloChip(entry.userId);
      const eloPart = eloChip ? ` · ${eloChip}` : "";
      return `**#${rank}** • T${entry.killTier} • ${mention} — ${formatNumber(entry.approvedKills)} kills • ${mainsText}${eloPart}`;
    });

    const rankEmbed = new EmbedBuilder()
      .setTitle(`${baseTitle} — стр. ${pageIndex + 1}/${rankPageCount}`)
      .setColor(embedColor)
      .setDescription(rankLines.join("\n"))
      .setFooter({ text: `Всего участников: ${entries.length} • Страница ${pageIndex + 1} из ${rankPageCount}` });
    pagesEmbeds.push(rankEmbed);
  }

  const components = [];
  if (recentPageCount > 1) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("text_tierlist_recent_first")
          .setLabel("⏮ Изменения")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(recentPageIndex === 0),
        new ButtonBuilder()
          .setCustomId("text_tierlist_recent_prev")
          .setLabel("◀ Изменения")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(recentPageIndex === 0),
        new ButtonBuilder()
          .setCustomId("text_tierlist_recent_next")
          .setLabel("Изменения ▶")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(recentPageIndex >= recentPageCount - 1)
      )
    );
  }
  if (rankPageCount > 1) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("text_tierlist_first")
          .setLabel("⏮ Рейтинг")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(pageIndex === 0),
        new ButtonBuilder()
          .setCustomId("text_tierlist_prev")
          .setLabel("◀ Рейтинг")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(pageIndex === 0),
        new ButtonBuilder()
          .setCustomId("text_tierlist_next")
          .setLabel("Рейтинг ▶")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(pageIndex >= rankPageCount - 1)
      )
    );
  }

  return {
    summaryPayload: {
      content: "",
      embeds: summaryEmbeds,
      components: [],
      allowedMentions: { parse: [] },
    },
    pagesPayload: {
      content: "",
      embeds: pagesEmbeds,
      components,
      allowedMentions: { parse: [] },
    },
  };
}

function buildCharactersRankingEmbed(entries, liveContext) {
  void entries;
  const characterStats = Array.isArray(liveContext?.characterStats) ? liveContext.characterStats : [];
  if (!characterStats.length) return null;

  const runtimeCharacters = getCharacterEntries();
  const runtimeCharacterById = new Map(runtimeCharacters.map((entry) => [String(entry.id || "").trim(), entry]));
  const runtimeCharacterByRoleId = new Map(
    runtimeCharacters
      .filter((entry) => String(entry.roleId || "").trim())
      .map((entry) => [String(entry.roleId || "").trim(), entry])
  );
  let clusterByLegacyId = new Map();
  let clusterRanking = [];
  let legacyCharacterIndex = null;
  let clusterStatusNote = "";

  try {
    const live = getLiveLegacyTierlistState();
    if (live?.ok) {
      legacyCharacterIndex = buildLegacyCharacterSyncIndex(live.characters);
      const { buckets, meta } = computeLegacyTierlistGlobalBuckets(live);
      clusterByLegacyId = buildLegacyTierlistClusterLookup({ buckets, meta, rawState: live.rawState });
      clusterRanking = Object.entries(meta || {})
        .map(([id, m]) => ({
          id: String(id),
          name: String(m?.name || id),
          avg: Number(m?.avg) || 0,
          votes: Number(m?.votes) || 0,
        }))
        .filter((x) => x.votes > 0)
        .sort((a, b) => b.avg - a.avg);
    } else if (live?.error) {
      clusterStatusNote = getLegacyTierlistClusterStatusNote(live.error);
      if (clusterStatusNote) {
        console.warn(`[characters-ranking] failed to load legacy tierlist state: ${live.error}`);
      }
    }
  } catch (error) {
    clusterStatusNote = getLegacyTierlistClusterStatusNote(error?.message || error);
    if (clusterStatusNote) {
      console.warn(`[characters-ranking] failed to resolve tierlist clusters: ${error?.message || error}`);
    }
  }

  const items = characterStats.map((stat) => {
    const id = String(stat.id || "").trim();
    const roleId = String(stat.roleId || "").trim();
    const runtimeEntry = runtimeCharacterById.get(id)
      || runtimeCharacterByRoleId.get(roleId)
      || { id, label: stat.main, main: stat.main, roleId };
    const legacyMatch = legacyCharacterIndex ? resolveLegacyCharacterMatch(runtimeEntry, legacyCharacterIndex) : null;
    const legacyId = legacyMatch?.character?.id || null;
    const cluster = legacyId ? clusterByLegacyId.get(legacyId) || null : null;

    return {
      id,
      legacyId,
      main: stat.main,
      roleId,
      peopleCount: Number(stat.roleHolderCount) || 0,
      trackedCount: Number(stat.rememberedCount) || 0,
      totalKills: Number(stat.totalKills) || 0,
      avgKills: Number(stat.averageKills) || 0,
      medKills: Number(stat.medianKills) || 0,
      bestPlayer: stat.bestPlayer || null,
      dist: stat.totalsByTier || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      highCount: Number(stat.highCount) || 0,
      lowCount: Number(stat.lowCount) || 0,
      cluster,
    };
  });

  const visible = items.filter((r) => r.peopleCount > 0);
  if (!visible.length) return null;

  visible.sort((a, b) => {
    if (b.peopleCount !== a.peopleCount) return b.peopleCount - a.peopleCount;
    if (b.trackedCount !== a.trackedCount) return b.trackedCount - a.trackedCount;
    if (b.medKills !== a.medKills) return b.medKills - a.medKills;
    if (b.totalKills !== a.totalKills) return b.totalKills - a.totalKills;
    return String(a.main).localeCompare(String(b.main), "ru");
  });

  const refOf = (r) => r.roleId ? formatRoleMention(r.roleId) : `**${r.main}**`;

  const lines = visible.map((r, idx) => {
    const place = idx + 1;
    const parts = [`#${place} ${refOf(r)}`];
    parts.push(`👥 ${r.peopleCount}`);
    parts.push(`🏷 ${r.cluster?.name || "—"}`);
    parts.push(`📊 ${r.trackedCount > 0
      ? `${formatKillsCompact(r.avgKills)}/${formatKillsCompact(r.medKills)}/${formatKillsCompact(r.totalKills)}`
      : "—/—/—"}`);
    if (r.bestPlayer && r.bestPlayer.userId && r.bestPlayer.kills > 0) {
      parts.push(`🏆 <@${r.bestPlayer.userId}> (${formatKillsCompact(r.bestPlayer.kills)})`);
    }
    return parts.join(" • ");
  });

  const facts = buildCharacterFacts(visible, clusterRanking, refOf);
  const legend = "**Что значит:** 👥 людей с ролью персонажа и kill-ролью • 🏷 кластер • 📊 сред/мед/сумм kills • 🏆 самый высокий kills";

  let body = lines.join("\n");
  if (body.length > 3300) {
    let acc = "";
    let kept = 0;
    for (const line of lines) {
      if ((acc.length + line.length + 1) > 3200) break;
      acc += (acc ? "\n" : "") + line;
      kept += 1;
    }
    body = acc + `\n…ещё ${lines.length - kept} персонажей`;
  }
  let description = `${legend}${clusterStatusNote ? `\n${clusterStatusNote}` : ""}\n\n${body}`;
  if (facts.length) description += `\n\n**✨ Доп. факты**\n${facts.join("\n\n")}`;

  return new EmbedBuilder()
    .setTitle("🎭 Персонажи — рейтинг мейнов")
    .setColor(0x9C27B0)
    .setDescription(description);
}

function buildCharacterFacts(items, clusterRanking, refOf) {
  const byId = new Map();
  for (const item of items) {
    byId.set(item.id, item);
    if (item.legacyId) byId.set(item.legacyId, item);
  }
  const factData = buildCharacterFactData(items, clusterRanking, { minPeopleCount: 3 });
  const lines = [];
  const factPlaceIcons = ["🥇", "🥈", "🥉"];

  const formatCountWord = (value, forms) => {
    const amount = Math.abs(Number(value) || 0);
    const lastTwo = amount % 100;
    const last = amount % 10;
    if (lastTwo >= 11 && lastTwo <= 14) return forms[2];
    if (last === 1) return forms[0];
    if (last >= 2 && last <= 4) return forms[1];
    return forms[2];
  };

  const formatPlayersCount = (value) => `${value} ${formatCountWord(value, ["игрок", "игрока", "игроков"])}`;
  const formatFactPlaces = (positions, renderScore) => positions
    .map((position, index) => {
      const marker = factPlaceIcons[index] || `${index + 1}.`;
      return `${marker} ${position.items.map(refOf).join(", ")} — ${renderScore(position.score)}`;
    })
    .join(" • ");
  const refOrName = (item, fallbackName) => item ? refOf(item) : `**${String(fallbackName || "—").trim()}**`;
  const formatClusterPlaces = (positions) => positions
    .map((position, index) => {
      const marker = factPlaceIcons[index] || `${index + 1}.`;
      const first = position.items[0] || null;
      const clusterName = String(first?.cluster?.name || first?.main || first?.id || "—").trim();
      return `${marker} ${position.items.map((item) => refOrName(byId.get(item.legacyId || item.id) || item, item.main || item.id)).join(", ")} — ${clusterName}`;
    })
    .join(" • ");

  // 1. Топ-3 по медиане kills
  const medTop = factData.medianTop;
  if (medTop.length) {
    lines.push(`**📈 Лучшие по медиане kills**\n${formatFactPlaces(medTop, (score) => formatKillsCompact(score))}`);
  }

  // 2. Низшая медиана kills (топ-3 снизу)
  const medBot = factData.medianBottom;
  if (medBot.length) {
    lines.push(`**📉 Самая низкая медиана kills**\n${formatFactPlaces(medBot, (score) => formatKillsCompact(-score))}`);
  }

  // 3. Глобальный рейтинг tierlist: top-3 и bottom-3
  if (factData.globalTop.length || factData.globalBottom.length) {
    const topText = factData.globalTop.length ? formatClusterPlaces(factData.globalTop) : "—";
    const bottomText = factData.globalBottom.length ? formatClusterPlaces(factData.globalBottom) : "—";
    lines.push(`**👑 Глобальный рейтинг tierlist**\nВерх: ${topText}\nНиз: ${bottomText}`);
  }

  // 4. Больше всего хай-игроков (абсолют)
  const highTop = factData.highCountTop;
  if (highTop.length) {
    lines.push(`**🔥 Хай-игроков больше всего**\n${formatFactPlaces(highTop, (score) => formatPlayersCount(score))}`);
  }

  // 5. Лучший хай-рейт (T5+T4 / remembered players)
  const rateTop = factData.highRateTop;
  if (rateTop.length) {
    lines.push(`**⚡ Лучший хай-рейт**\n${formatFactPlaces(rateTop, (score) => `${score}%`)}`);
  }

  // 6. Самый популярный
  const popTop = factData.popularTop;
  if (popTop.length) {
    lines.push(`**💖 Самые популярные**\n${formatFactPlaces(popTop, (score) => formatPlayersCount(score))}`);
  }

  // 7. Самый редкий
  const rareTop = factData.rareTop;
  if (rareTop.length) {
    lines.push(`**🪶 Самые редкие**\n${formatFactPlaces(rareTop, (score) => formatPlayersCount(-score))}`);
  }

  return lines;
}

function buildRecentKillChangesEmbed(pagination = null) {
  const formatKillsChangeValue = (value) => {
    const n = Math.max(0, Math.round(Number(value) || 0));
    if (n < 100) return String(n);
    if (n < 100000) {
      const k = n / 1000;
      return `${k.toFixed(1).replace(/\.0$/, "")}к`;
    }
    return `${Math.round(n / 1000)}к`;
  };

  const formatKillsRateValue = (value) => {
    const n = Math.max(0, Number(value) || 0);
    const rounded = n < 100 ? Math.round(n * 10) / 10 : Math.round(n);
    if (rounded < 1000) {
      return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace(/\.0$/, "");
    }

    const k = rounded / 1000;
    return `${k.toFixed(k < 100 ? 1 : 0).replace(/\.0$/, "")}к`;
  };

  const resolvedPagination = pagination && typeof pagination === "object"
    ? pagination
    : paginateRecentKillChanges(collectRecentKillChanges(Object.values(db.submissions || {})), {
      page: 0,
      pageSize: RECENT_KILL_CHANGES_PAGE_SIZE,
      maxPages: RECENT_KILL_CHANGES_MAX_PAGES,
    });
  if (!resolvedPagination.totalCount) return null;

  const lines = resolvedPagination.items.map((c) => {
    const summary = summarizeRecentKillChange(c);
    const delta = summary.delta;
    const pct = c.from > 0 ? Math.round((delta / c.from) * 100) : 100;
    return [
      `<@${c.userId}>`,
      `**${formatKillsChangeValue(c.from)} → ${formatKillsChangeValue(c.to)}** • +${formatKillsChangeValue(delta)} (+${pct}%) • ${formatDateOnly(c.fromAt)} → ${formatDateOnly(c.toAt)} (${summary.dayCount} дн.) • ср. ${formatKillsRateValue(summary.averagePerDay)}/день`,
    ].join("\n");
  });

  const start = resolvedPagination.page * RECENT_KILL_CHANGES_PAGE_SIZE + 1;
  const end = start + resolvedPagination.items.length - 1;

  return new EmbedBuilder()
    .setTitle(`⚡ Последние изменения — стр. ${resolvedPagination.page + 1}/${resolvedPagination.pageCount}`)
    .setColor(0x00897B)
    .setDescription(lines.join("\n\n"))
    .setFooter({ text: `Показано ${start}-${end} из ${resolvedPagination.totalCount}` });
}

async function buildGraphicTierlistBoardPayload(client) {
  const liveContext = await getLiveCharacterStatsContext(client);
  const entries = getLiveApprovedTierlistEntries(liveContext);
  const guild = await getGuild(client);
  const graphicBoard = getGraphicTierlistBoardState(db.config, appConfig.channels.tierlistChannelId || "");
  const imgCfg = getGraphicImageConfig();
  const presentation = getPresentation();
  const outline = getEffectiveGraphicOutlineConfig();

  if (!isPureimageAvailable()) {
    throw new Error("pureimage не загружен, поэтому графический PNG тир-лист не может быть собран.");
  }

  const pngBuffer = await renderGraphicTierlistPng({
    client,
    guild,
    entries,
    title: getEffectiveGraphicTitle(),
    tierLabels: presentation.tierlist.labels,
    tierColors: getEffectiveTierColors(),
    outlineRules: outline.rules,
    outlineRoleIds: outline.roleIds,
    outlineColor: outline.color,
    imageWidth: imgCfg.W,
    imageHeight: imgCfg.H,
    imageIcon: imgCfg.ICON,
  });
  if (!pngBuffer?.length) {
    throw new Error("PNG тир-лист не был сгенерирован.");
  }

  const embedBuilder = new EmbedBuilder()
    .setTitle(getEffectiveGraphicTitle())
    .setDescription(getEffectiveMessageText())
    .setImage("attachment://tierlist.png");

  const components = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("graphic_refresh").setLabel("Обновить PNG").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("graphic_panel").setLabel("PNG панель").setStyle(ButtonStyle.Primary)
    ),
  ];

  try {
    const textBoard = getResolvedTextTierlistBoardSnapshot();
    const textChannelId = String(textBoard?.channelId || "").trim();
    const textMessageId = getTextTierlistSummaryMessageId(textBoard);
    if (textChannelId && textMessageId && GUILD_ID) {
      const url = `https://discord.com/channels/${GUILD_ID}/${textChannelId}/${textMessageId}`;
      components.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Текстовый рейтинг и статистика").setURL(url)
        )
      );
    }
  } catch {}

  return {
    content: "",
    embeds: [embedBuilder],
    files: [new AttachmentBuilder(pngBuffer, { name: "tierlist.png" })],
    components,
  };
}

function buildGraphicPanelTierSelect() {
  const selected = normalizeGraphicPanelSelectedTier(getPresentation().tierlist.graphic.panel.selectedTier, 5);
  const options = GRAPHIC_PANEL_TIERS.map((t) => ({
    label: `Тир ${t} — ${formatTierLabel(t)}`,
    value: String(t),
    default: t === selected,
  }));
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId("graphic_panel_select_tier").setPlaceholder("Выбрать тир").addOptions(options)
  );
}

function buildGraphicPanelPayload(statusText = "", includeFlags = true) {
  const cfg = getGraphicImageConfig();
  const presentation = getPresentation();
  const selectedTier = normalizeGraphicPanelSelectedTier(presentation.tierlist.graphic.panel.selectedTier, 5);
  const tierColors = getEffectiveTierColors();
  const tierColor = tierColors[selectedTier] || DEFAULT_GRAPHIC_TIER_COLORS[selectedTier];
  const outline = getEffectiveGraphicOutlineConfig();
  const rememberedCount = getTierlistNonFakeUserIds(db.config).length;
  const outlineRoleText = formatGraphicOutlineRulesText(outline.rules, 260);

  const embed = new EmbedBuilder()
    .setTitle(`PNG Panel • ${GRAPHIC_PANEL_RUNTIME_MARKER}`)
    .setDescription([
      `**Title:** ${getEffectiveGraphicTitle()}`,
      `**Картинка:** ${cfg.W}×${cfg.H}`,
      `**Иконки:** ${cfg.ICON}px`,
      `**Выбранный тир:** ${selectedTier} → **${formatTierLabel(selectedTier)}**`,
      `**Цвет тира:** ${tierColor}`,
      `**Обводка по ролям:** ${outlineRoleText}`,
      `**Цвет по умолчанию:** ${outline.color}`,
      `**Remembered T6:** ${rememberedCount}`,
      `**Runtime:** ${GRAPHIC_PANEL_RUNTIME_MARKER} / tiers=${GRAPHIC_PANEL_TIERS.join(",")}`,
      `**Текст сообщения:** ${previewGraphicMessageText(170)}`,
      "",
      "Панель меняет PNG-контур, связанные подписи и цвета, а remembered не фейкостановцев уводит в T6-кластер.",
    ].join("\n"));

  if (statusText) {
    embed.addFields({ name: "Последнее действие", value: statusText, inline: false });
  }

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("graphic_panel_refresh").setLabel("Пересобрать").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("panel_resend_graphic").setLabel("Переотправить PNG").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("graphic_panel_title").setLabel("Название PNG").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("graphic_panel_message_text").setLabel("Текст сообщения").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("graphic_panel_rename").setLabel("Переименовать тир").setStyle(ButtonStyle.Primary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("graphic_panel_icon_minus").setLabel("Иконки −").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("graphic_panel_icon_plus").setLabel("Иконки +").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("graphic_panel_w_minus").setLabel("Ширина −").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("graphic_panel_w_plus").setLabel("Ширина +").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("graphic_panel_outline").setLabel("Обводка по ролям").setStyle(ButtonStyle.Primary)
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("graphic_panel_h_minus").setLabel("Высота −").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("graphic_panel_h_plus").setLabel("Высота +").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("graphic_panel_set_color").setLabel("Цвет тира").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("graphic_panel_reset_color").setLabel("Сброс цвета тира").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("graphic_panel_outline_clear").setLabel("Очистить обводку").setStyle(ButtonStyle.Secondary)
  );

  const row4 = buildGraphicPanelTierSelect();

  const row5 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("graphic_panel_reset_img").setLabel("Сбросить размеры").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("graphic_panel_nonfake").setLabel("Нефейк-кластер").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("graphic_panel_clear_cache").setLabel("Сбросить кэш ав").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("panel_resend_text").setLabel("Переотправить текст").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("graphic_panel_close").setLabel("Закрыть").setStyle(ButtonStyle.Danger)
  );

  const payload = { embeds: [embed], components: [row1, row2, row3, row4, row5] };
  return includeFlags ? ephemeralPayload(payload) : payload;
}

function buildGraphicStatusLines() {
  const graphicBoard = getResolvedGraphicTierlistBoardSnapshot();
  const cfg = getGraphicImageConfig();
  const presentation = getPresentation();
  const selectedTier = normalizeGraphicPanelSelectedTier(presentation.tierlist.graphic.panel.selectedTier, 5);
  const outline = getEffectiveGraphicOutlineConfig();

  return [
    `title: ${presentation.tierlist.graphicTitle}`,
    `messageText: ${previewGraphicMessageText(120)}`,
    `channelId: ${graphicBoard.channelId || "—"}`,
    `messageId: ${graphicBoard.messageId || "—"}`,
    `img: ${cfg.W}x${cfg.H}, icon=${cfg.ICON}`,
    `selectedTier: ${selectedTier} -> ${formatTierLabel(selectedTier)}`,
    `tierColors: ${GRAPHIC_PANEL_TIERS.map((tier) => `${tier}=${presentation.tierlist.graphic.colors[tier] || DEFAULT_GRAPHIC_TIER_COLORS[tier]}`).join(", ")}`,
    `outline: ${outline.rules.length ? outline.rules.map((rule) => `${rule.roleId}=${rule.color}`).join(",") : "—"}`,
    `outlineDefaultColor: ${outline.color}`,
    `rememberedT6: ${getTierlistNonFakeUserIds(db.config).length}`,
    `runtime: ${GRAPHIC_PANEL_RUNTIME_MARKER}`,
    `lastUpdated: ${graphicBoard.lastUpdated ? new Date(graphicBoard.lastUpdated).toLocaleString("ru-RU") : "—"}`,
  ];
}

function buildWelcomeEditorPayload(statusText = "") {
  const presentation = getPresentation();
  const nonJjsUi = getNonJjsUiConfig();
  const embed = new EmbedBuilder()
    .setTitle("Welcome Editor")
    .setDescription([
      `**Welcome title:** ${previewText(presentation.welcome.title, 140)}`,
      `**Welcome text:** ${previewText(presentation.welcome.description, 240)}`,
      `**Submit step:** ${previewText(presentation.welcome.submitStep?.title || "—", 100)} / ${previewText(presentation.welcome.submitStep?.description || "—", 180)}`,
      `**Buttons:** ${presentation.welcome.buttons.begin} / ${nonJjsUi.buttonLabel} / ${presentation.welcome.buttons.quickMains}`,
      `**JJS block:** ${previewText(nonJjsUi.title, 90)} / ${previewText(nonJjsUi.buttonLabel, 80)}`,
      `**JJS text:** ${previewText(nonJjsUi.description, 160)}`,
      `**Text tierlist:** ${presentation.tierlist.textTitle}`,
      `**PNG tierlist:** ${presentation.tierlist.graphicTitle}`,
      `**PNG message:** ${previewGraphicMessageText(140)}`,
      "",
      presentation.welcome.steps.map((step, index) => `${index + 1}. ${previewText(step, 120)}`).join("\n"),
    ].join("\n"));

  if (statusText) {
    embed.addFields({ name: "Последнее действие", value: statusText, inline: false });
  }

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("welcome_editor_text").setLabel("Welcome текст").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("welcome_editor_steps").setLabel("Шаги welcome").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("welcome_editor_buttons").setLabel("Кнопки").setStyle(ButtonStyle.Primary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("welcome_editor_submit").setLabel("Submit шаг").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("welcome_editor_jjs").setLabel("JJS блок").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("welcome_editor_tiers").setLabel("Названия тиров").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("welcome_editor_png").setLabel("PNG и tierlist").setStyle(ButtonStyle.Secondary)
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("welcome_editor_refresh").setLabel("Пересобрать всё").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("welcome_editor_close").setLabel("Закрыть").setStyle(ButtonStyle.Danger)
  );

  return ephemeralPayload({ embeds: [embed], components: [row1, row2, row3] });
}

function sanitizeFileName(name, fallbackExt = "png") {
  const base = String(name || "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);

  if (!base) return `proof.${fallbackExt}`;
  if (!/\.[a-z0-9]{2,5}$/i.test(base)) return `${base}.${fallbackExt}`;
  return base;
}

function isImageAttachment(attachment) {
  if (!attachment) return false;
  const contentType = String(attachment.contentType || "");
  if (contentType.startsWith("image/")) return true;
  const url = String(attachment.url || "").toLowerCase();
  return /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url);
}

function messageHasImageAttachment(message) {
  return [...(message?.attachments?.values?.() || [])].some((attachment) => isImageAttachment(attachment));
}

async function downloadToBuffer(url, timeoutMs = 15000) {
  const headers = {
    "User-Agent": "Mozilla/5.0 JujutsuWelcomeBot/1.0",
    "Accept": "image/avif,image/webp,image/apng,image/png,image/jpeg,*/*;q=0.8",
  };

  if (typeof fetch === "function") {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal, headers });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } finally {
      clearTimeout(timer);
    }
  }

  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https:") ? https : http;
    const request = lib.get(url, { headers }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        downloadToBuffer(response.headers.location, timeoutMs).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve(Buffer.concat(chunks)));
    });

    request.on("error", reject);
    request.setTimeout(timeoutMs, () => request.destroy(new Error("timeout")));
  });
}

async function fetchJson(url, options = {}, timeoutMs = 15000) {
  const method = String(options?.method || "GET").toUpperCase();
  const headers = {
    "User-Agent": "Mozilla/5.0 JujutsuWelcomeBot/1.0",
    "Accept": "application/json",
    ...(options?.headers || {}),
  };
  const body = options?.body;

  if (typeof fetch === "function") {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { method, headers, body, signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https:") ? https : http;
    const request = lib.request(url, { method, headers }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        fetchJson(response.headers.location, options, timeoutMs).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (error) {
          reject(error);
        }
      });
    });

    request.on("error", reject);
    request.setTimeout(timeoutMs, () => request.destroy(new Error("timeout")));
    if (body) request.write(body);
    request.end();
  });
}

function getCachedVerifiedCharacterRoleIds() {
  const roleCache = guildCache?.roles?.cache;
  if (!roleCache || typeof roleCache.keys !== "function") return null;

  return new Set([...roleCache.keys()].map((roleId) => String(roleId || "").trim()).filter(Boolean));
}

function hasCachedCharacterRoleSnapshot() {
  const verifiedRoleIds = getCachedVerifiedCharacterRoleIds();
  return verifiedRoleIds instanceof Set && verifiedRoleIds.size > 0;
}

function mapSotCharacterRecordToEntry(record) {
  return {
    id: String(record?.id || "").trim(),
    label: String(record?.label || record?.englishLabel || record?.id || "").trim(),
    roleId: String(record?.roleId || record?.value || "").trim(),
    source: String(record?.source || "").trim(),
    verifiedAt: String(record?.verifiedAt || "").trim(),
    evidence: record?.evidence,
  };
}

function isLiveCharacterEntry(entry) {
  const roleId = String(entry?.roleId || "").trim();
  if (!roleId) return false;
  if (!hasCachedCharacterRoleSnapshot()) return true;
  return Boolean(String(entry?.verifiedAt || "").trim());
}

function getCharacterEntries() {
  const verifiedRoleIds = getCachedVerifiedCharacterRoleIds();
  const verifiedSnapshot = verifiedRoleIds instanceof Set && verifiedRoleIds.size > 0 ? verifiedRoleIds : null;
  const verifiedAt = verifiedSnapshot ? new Date().toISOString() : undefined;

  return listSotCharacters({
    db,
    appConfig,
    excludedCharacterIds: getLegacyTierlistCustomCharacterIds(db),
    includeUnresolved: true,
    verifiedRoleIds: verifiedSnapshot || undefined,
    verifiedAt,
  }).map(mapSotCharacterRecordToEntry);
}

function getCharacterPickerEntries() {
  return getCharacterEntries().filter((entry) => entry.id && entry.label);
}

function getCharacterPickerValidationError(characterEntries) {
  if (!characterEntries.length) {
    return "Нет доступных персонажей. Проверь конфигурацию characters и синк ролей.";
  }

  if (characterEntries.length > 25) {
    return `Список мейнов слишком большой для Discord select menu: ${characterEntries.length}. Переключаюсь на ручной ввод.`;
  }

  return "";
}

function buildManualMainSelectionModal(mode = "full") {
  const modal = new ModalBuilder()
    .setCustomId(mode === "quick" ? "onboard_manual_mains_quick_modal" : "onboard_manual_mains_modal")
    .setTitle(mode === "quick" ? "Быстро сменить мейнов" : "Указать мейнов");

  const mainsInput = new TextInputBuilder()
    .setCustomId("mains")
    .setLabel("1 или 2 мейна")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setPlaceholder("Например: Honored One, Vessel");

  modal.addComponents(new ActionRowBuilder().addComponents(mainsInput));
  return modal;
}

function resolveCharacterSelectionFromText(input, options = {}) {
  const normalizedParts = String(input || "")
    .split(/[\n,;|]+/)
    .map((part) => normalizeCharacterId(part))
    .filter(Boolean);

  if (!normalizedParts.length) {
    return { entries: [], error: "Нужно указать одного или двух мейнов." };
  }

  const uniqueParts = [...new Set(normalizedParts)].slice(0, 3);
  if (uniqueParts.length > 2) {
    return { entries: [], error: "Можно указать только одного или двух мейнов." };
  }

  const entries = getCharacterPickerEntries();
  const aliases = new Map();

  for (const entry of entries) {
    aliases.set(normalizeCharacterId(entry.id), entry);
    aliases.set(normalizeCharacterId(entry.label), entry);
  }

  const selectedEntries = [];
  for (const alias of uniqueParts) {
    const entry = aliases.get(alias);
    if (!entry) {
      return {
        entries: [],
        error: `Не удалось распознать мейна: ${alias}. Укажи точное имя из welcome-панели.`,
      };
    }

    if (!selectedEntries.some((selectedEntry) => selectedEntry.id === entry.id)) {
      selectedEntries.push(entry);
    }
  }

  if (!selectedEntries.length || selectedEntries.length > 2) {
    return { entries: [], error: "Нужно выбрать одного или двух мейнов." };
  }

  return { entries: selectedEntries, error: "" };
}

async function replyWithCharacterPicker(interaction, mode = "full", method = "reply") {
  const picker = setMainsPickerSession(interaction.user.id, {
    mode,
    query: "",
    page: 0,
    selectedIds: getInitialMainsPickerSelectedIds(interaction.user.id),
  });
  const payload = buildMainsPickerPayload(interaction.user.id, {
    picker,
    includeEphemeralFlag: method !== "update",
  });
  if (method === "update") {
    await interaction.update(payload);
    return;
  }
  await interaction.reply(payload);
}

async function respondToOnboardError(interaction, message) {
  const payload = ephemeralPayload({ content: message });
  if (!interaction.replied && !interaction.deferred) {
    await interaction.reply(payload).catch(() => {});
    return;
  }

  if (interaction.deferred) {
    await interaction.editReply(payload).catch(() => {});
    return;
  }

  await interaction.followUp(payload).catch(() => {});
}

async function fallbackToManualMainSelection(interaction, mode = "full", error = null) {
  const message = String(error?.message || error || "").trim();
  if (message) {
    console.warn(`character picker fallback (${mode}): ${message}`);
  }

  clearMainsPickerSession(interaction.user.id);
  await interaction.showModal(buildManualMainSelectionModal(mode));
}

async function openCharacterPicker(interaction, mode = "full", method = "reply") {
  try {
    await replyWithCharacterPicker(interaction, mode, method);
  } catch (error) {
    try {
      await fallbackToManualMainSelection(interaction, mode, error);
    } catch (fallbackError) {
      console.error(`openCharacterPicker failed (${mode}):`, fallbackError?.message || fallbackError || error);
      const message = String(error?.message || fallbackError?.message || fallbackError || error || "неизвестная ошибка").trim();
      await respondToOnboardError(interaction, `Не удалось открыть выбор мейнов: ${message.slice(0, 220)}`);
    }
  }
}

async function completeMainSelection(interaction, selectedEntries, options = {}) {
  const isQuickSelection = options.mode === "quick";
  const responseMethod = options.responseMethod === "update" ? "update" : "reply";
  const selectedIds = selectedEntries.map((entry) => entry.id);
  let usedDeferredUpdate = false;

  const sendSelectionError = async (message) => {
    if (usedDeferredUpdate) {
      await interaction.followUp(ephemeralPayload({ content: message })).catch(() => {});
      return;
    }

    await respondToOnboardError(interaction, message);
  };

  const pending = getPendingSubmissionForUser(interaction.user.id);
  if (!isQuickSelection && pending) {
    await sendSelectionError("У тебя уже есть pending-заявка. Новую создавать нельзя.");
    return;
  }

  if (!selectedIds.length || selectedIds.length > 2) {
    await sendSelectionError("Нужно выбрать одного или двух мейнов.");
    return;
  }

  if (responseMethod === "update" && typeof interaction.deferUpdate === "function" && !interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate();
    usedDeferredUpdate = true;
  }

  const member = await fetchMember(client, interaction.user.id);
  if (!member) {
    await sendSelectionError("Не удалось получить твой профиль на сервере.");
    return;
  }

  let resolvedEntries = getSelectedCharacterEntries(selectedIds);
  if (resolvedEntries.some((entry) => !isLiveCharacterEntry(entry))) {
    await ensureManagedRoles(client).catch(() => null);
    resolvedEntries = getSelectedCharacterEntries(selectedIds);
  }

  const unresolvedEntries = resolvedEntries.filter((entry) => !isLiveCharacterEntry(entry));
  if (unresolvedEntries.length) {
    await sendSelectionError(
      `Для ${unresolvedEntries.map((entry) => entry.label).join(", ")} пока не найдена каноническая роль. Попроси модератора нажать «Синк ролей».`
    );
    return;
  }

  let appliedEntries;
  try {
    appliedEntries = await applyMainSelection(
      client,
      member,
      interaction.user,
      selectedIds,
      isQuickSelection ? "quick main selection" : "new main character selection"
    );
  } catch (error) {
    if (error instanceof RoleSyncError) {
      console.warn(`[character-role-sync] failed for ${interaction.user.id}: ${describeRoleSyncFailures(error.failures)}`);
      const failedRoleMentions = [...new Set((error.failures || [])
        .map((failure) => String(failure?.roleId || "").trim())
        .filter(Boolean))]
        .map((roleId) => formatRoleMention(roleId));
      const failedRoleText = failedRoleMentions.length ? ` (${failedRoleMentions.join(", ")})` : "";
      await sendSelectionError(
        `Не удалось синхронизировать роли мейнов${failedRoleText}. Попроси модератора проверить права бота и нажать «Синк ролей».`
      );
      return;
    }
    throw error;
  }

  if (isQuickSelection) {
    const activeSubmitSession = getSubmitSession(interaction.user.id);
    const updatedMainCharacterIds = appliedEntries.map((entry) => entry.id);
    if (activeSubmitSession?.mainCharacterIds?.length) {
      setSubmitSession(interaction.user.id, {
        ...activeSubmitSession,
        mainCharacterIds: updatedMainCharacterIds,
      });
    }

    const syncedPending = await syncPendingSubmissionMainsForUser(client, interaction.user.id, appliedEntries);
    const welcomeChannelId = getResolvedChannelId("welcome");
    const uploadTarget = welcomeChannelId ? `<#${welcomeChannelId}>` : "welcome-канал";
    const needsRobloxIdentity = !(activeSubmitSession?.robloxUsername && activeSubmitSession?.robloxUserId);
    clearMainsPickerSession(interaction.user.id);
    const content = activeSubmitSession?.mainCharacterIds?.length
      ? needsRobloxIdentity
        ? `Мейны обновлены: **${appliedEntries.map((entry) => entry.label).join(", ")}**. Текущая загрузка тоже обновлена, теперь заново укажи Roblox username.`
        : `Мейны обновлены: **${appliedEntries.map((entry) => entry.label).join(", ")}**. Текущая загрузка тоже обновлена, теперь просто отправь kills и скрин в ${uploadTarget}.`
      : syncedPending
        ? `Мейны обновлены: **${appliedEntries.map((entry) => entry.label).join(", ")}**. Pending-заявка тоже обновлена.`
        : `Мейны обновлены: **${appliedEntries.map((entry) => entry.label).join(", ")}**.`;

    if (responseMethod === "update") {
      if (usedDeferredUpdate) {
        await interaction.editReply({ content, embeds: [], components: [] });
        return;
      }

      await interaction.update({ content, embeds: [], components: [] });
      return;
    }

    await interaction.reply(ephemeralPayload({ content }));
    return;
  }

  const activeSubmitSession = getSubmitSession(interaction.user.id);
  setSubmitSession(interaction.user.id, {
    ...activeSubmitSession,
    mainCharacterIds: appliedEntries.map((entry) => entry.id),
  });
  clearMainDraft(interaction.user.id);
  clearMainsPickerSession(interaction.user.id);
  if (responseMethod === "update") {
    const payload = buildSubmitStepPayload(interaction.user.id, {
      includeEphemeralFlag: false,
      canManageRobloxIdentity: hasAdministratorAccess(interaction.member),
    });
    if (usedDeferredUpdate) {
      await interaction.editReply(payload);
      return;
    }

    await interaction.update(payload);
    return;
  }

  await interaction.reply(buildSubmitStepPayload(interaction.user.id, {
    canManageRobloxIdentity: hasAdministratorAccess(interaction.member),
  }));
}

function getCharacterById(characterId) {
  return getCharacterEntries().find((entry) => entry.id === characterId) || null;
}

function getCharacterRoleIds() {
  return getCharacterEntries().filter((entry) => isLiveCharacterEntry(entry)).map((entry) => entry.roleId).filter(Boolean);
}

function getSelectedCharacterEntries(characterIds) {
  return characterIds.map((characterId) => getCharacterById(characterId)).filter(Boolean);
}

function getDerivedProfileMainFields(profile) {
  return deriveProfileMainView(profile, getCharacterEntries());
}

function refreshDerivedProfileMainFields(profile) {
  if (!profile || typeof profile !== "object") return profile;

  const derived = getDerivedProfileMainFields(profile);
  profile.mainCharacterIds = derived.mainCharacterIds;
  profile.mainCharacterLabels = derived.mainCharacterLabels;
  profile.characterRoleIds = derived.characterRoleIds;

  if (profile.domains?.onboarding && typeof profile.domains.onboarding === "object") {
    profile.domains.onboarding.mainCharacterIds = [...derived.mainCharacterIds];
    profile.domains.onboarding.mainCharacterLabels = [...derived.mainCharacterLabels];
    profile.domains.onboarding.characterRoleIds = [...derived.characterRoleIds];
  }

  return profile;
}

function getManagedCharacterRoleNameCandidates(entry) {
  const aliasNames = Array.isArray(entry?.evidence?.aliasNames) ? entry.evidence.aliasNames : [];
  return [...new Set([
    String(entry?.label || "").trim(),
    ...aliasNames.map((value) => String(value || "").trim()),
  ].filter(Boolean))];
}

function buildNativeCharacterRecoveryEvidence(analysis) {
  if (!analysis?.best && !analysis?.second) return undefined;

  const candidates = [];
  if (analysis.best?.roleId) {
    candidates.push({
      roleId: analysis.best.roleId,
      roleName: analysis.best.roleName,
      overlap: Number(analysis.best.overlap || 0),
    });
  }
  if (analysis.second?.roleId) {
    candidates.push({
      roleId: analysis.second.roleId,
      roleName: analysis.second.roleName,
      overlap: Number(analysis.second.overlap || 0),
    });
  }

  return {
    overlap: Number(analysis.best?.overlap || 0),
    coverage: Number(analysis.best?.coverage || 0),
    roleShare: Number(analysis.best?.roleShare || 0),
    holderCount: Number(analysis.best?.holderCount || 0),
    exactName: Boolean(analysis.best?.exactName),
    preferredMatch: Boolean(analysis.best?.preferredMatch),
    candidates,
  };
}

function isManagedCharacterRoleNameCandidate(roleName) {
  const normalized = String(roleName || "").trim();
  if (!normalized) return false;
  return !NON_CHARACTER_ROLE_NAME_PATTERNS.some((pattern) => pattern.test(normalized));
}

function getManagedCharacterRecoveryExcludedRoleIds(guild) {
  return new Set([
    String(guild?.id || "").trim(),
    getModeratorRoleId(),
    getNormalAccessRoleId(),
    getWartimeAccessRoleId(),
    getNonJjsAccessRoleId(),
    ...getAllTierRoleIds(),
    ...getAllLegacyEloTierRoleIds(),
  ].filter(Boolean));
}

function buildGuildCharacterRoleCandidates(guild) {
  const excludedRoleIds = getManagedCharacterRecoveryExcludedRoleIds(guild);
  return [...guild.roles.cache.values()]
    .filter((role) => role && !role.managed && !excludedRoleIds.has(role.id) && isManagedCharacterRoleNameCandidate(role.name))
    .map((role) => ({
      id: role.id,
      name: role.name,
      memberUserIds: [...role.members.filter((member) => !member.user?.bot).keys()],
    }));
}

async function ensureRoleByName(guild, roleName, explicitRoleId = "", options = {}) {
  const { createIfMissing = true } = options;
  const normalizedNames = [...new Set((Array.isArray(roleName) ? roleName : [roleName])
    .map((value) => String(value || "").trim())
    .filter(Boolean))];
  const normalizedName = normalizedNames[0] || "";
  const preferredRoleIds = [...new Set((Array.isArray(explicitRoleId) ? explicitRoleId : [explicitRoleId])
    .map((value) => String(value || "").trim())
    .filter((roleId) => roleId && !isPlaceholder(roleId)))];
  if (!normalizedName) return null;

  for (const preferredRoleId of preferredRoleIds) {
    const exact = await guild.roles.fetch(preferredRoleId).catch(() => null);
    if (exact) return exact;
  }

  await guild.roles.fetch().catch(() => null);
  for (const candidateName of normalizedNames) {
    const matches = guild.roles.cache.filter((role) => role.name === candidateName);
    if (matches.size) {
      // Prefer the role with the most non-bot members (the original moderator-managed one).
      let best = null;
      let bestCount = -1;
      for (const role of matches.values()) {
        const count = role.members ? role.members.filter((m) => !m.user?.bot).size : 0;
        if (count > bestCount) {
          best = role;
          bestCount = count;
        }
      }
      if (best) return best;
    }
  }

  if (!createIfMissing) return null;

  return guild.roles.create({
    name: normalizedName,
    permissions: BigInt(0),
    hoist: false,
    mentionable: false,
    reason: "Auto-created by onboarding bot",
  });
}

async function reconcileCharacterRolesFromGuild(guild) {
  if (!guild) {
    return {
      resolved: 0,
      duplicateCandidates: 0,
      recoveredRoleIds: {},
      recoveredRoleLabels: {},
      ambiguous: [],
      unresolved: [],
    };
  }
  await guild.roles.fetch().catch(() => null);
  try { await guild.members.fetch(); } catch { /* best-effort */ }

  const managedCharacters = getManagedCharacterCatalog();
  const configuredCharacterMap = new Map(getConfiguredManagedCharacterCatalog().map((entry) => [entry.id, entry]));
  const currentRoleIds = getManagedCharacterRoleIdMap(managedCharacters);
  const recoveryPlan = buildManagedCharacterRoleRecoveryPlan({
    managedCharacters,
    profiles: db.profiles,
    submissions: db.submissions,
    guildRoles: buildGuildCharacterRoleCandidates(guild),
    generatedRoleIds: currentRoleIds,
  });
  let changed = false;
  let resolved = 0;
  let duplicateCandidates = 0;

  for (const entry of managedCharacters) {
    const characterId = String(entry.id || "").trim();
    const roleNames = getManagedCharacterRoleNameCandidates(entry);
    const roleName = roleNames[0] || "";
    const configuredRoleId = String(configuredCharacterMap.get(characterId)?.roleId || "").trim();
    const currentRoleId = String(currentRoleIds[characterId] || "").trim();
    const analysis = recoveryPlan.analysisByCharacterId?.[characterId] || null;
    if (!characterId || !roleName) continue;

    for (const candidateName of roleNames) {
      const matches = [...guild.roles.cache.filter((role) => role.name === candidateName).values()];
      if (matches.length > 1) duplicateCandidates += matches.length - 1;
    }

    const role = await ensureRoleByName(
      guild,
      roleNames,
      [
        currentRoleId,
        configuredRoleId,
        recoveryPlan.recoveredRoleIds[characterId],
      ],
      { createIfMissing: false }
    );
    if (!role) {
      const clearResult = clearNativeCharacterRecord(db, {
        characterId,
        label: entry.label,
        englishLabel: configuredCharacterMap.get(characterId)?.label || entry.englishLabel || entry.label || characterId,
        source: "default",
        evidence: buildNativeCharacterRecoveryEvidence(analysis),
      });
      if (clearResult.mutated) changed = true;
      continue;
    }

    const nextSource = configuredRoleId && role.id === configuredRoleId
      ? "configured"
      : String(recoveryPlan.recoveredRoleIds?.[characterId] || "").trim() === role.id
        ? "recovered"
        : currentRoleId && role.id === currentRoleId && String(entry.source || "").trim() && String(entry.source || "").trim() !== "default"
          ? String(entry.source || "").trim()
          : "discovered";
    const writeResult = writeNativeCharacterRecord(db, {
      characterId,
      label: role.name,
      englishLabel: configuredCharacterMap.get(characterId)?.label || entry.englishLabel || entry.label || characterId,
      roleId: role.id,
      source: nextSource,
      verifiedAt: nowIso(),
      evidence: nextSource === "recovered" ? buildNativeCharacterRecoveryEvidence(analysis) : undefined,
    });
    if (writeResult.mutated) changed = true;
    resolved += 1;
  }

  if (changed) {
    saveDb();
    invalidateLiveCharacterStatsContext();
  }
  return {
    resolved,
    duplicateCandidates,
    recoveredRoleIds: recoveryPlan.recoveredRoleIds,
    recoveredRoleLabels: recoveryPlan.recoveredRoleLabels,
    ambiguous: recoveryPlan.ambiguous,
    unresolved: recoveryPlan.unresolved,
  };
}

async function ensureManagedRoles(client) {
  const guild = await getGuild(client);
  if (!guild) {
    return {
      characterRoles: 0,
      tierRoles: 0,
      resolvedCharacters: 0,
      recoveredCharacters: 0,
      ambiguousCharacters: 0,
      unresolvedCharacters: 0,
    };
  }

  const managedCharacters = getManagedCharacterCatalog();
  const configuredCharacterMap = new Map(getConfiguredManagedCharacterCatalog().map((entry) => [entry.id, entry]));
  let createdCharacterRoles = 0;
  let createdTierRoles = 0;
  let changed = false;
  let reconcile = {
    resolved: 0,
    duplicateCandidates: 0,
    recoveredRoleIds: {},
    ambiguous: [],
    unresolved: [],
  };

  // Character roles are managed by moderators. Never auto-create — only
  // resolve to the existing moderator-assigned role and leave duplicates untouched.
  try {
    reconcile = await reconcileCharacterRolesFromGuild(guild);
    if (reconcile.duplicateCandidates) {
      console.warn(`Detected ${reconcile.duplicateCandidates} duplicate character role(s); leaving them untouched.`);
    }
  } catch (error) {
    console.warn("reconcileCharacterRolesFromGuild failed:", error?.message || error);
  }

  for (const entry of managedCharacters) {
    const characterId = String(entry.id || "").trim();
    const roleNames = getManagedCharacterRoleNameCandidates(entry);
    const roleName = roleNames[0] || "";
    const configuredRoleId = String(configuredCharacterMap.get(characterId)?.roleId || "").trim();
    const currentRoleId = String(entry.roleId || "").trim();
    if (!characterId || !roleName) continue;

    const role = await ensureRoleByName(
      guild,
      roleNames,
      [currentRoleId, configuredRoleId, reconcile.recoveredRoleIds[characterId]],
      { createIfMissing: false }
    );
    if (!role) continue;

    const nextSource = configuredRoleId && role.id === configuredRoleId
      ? "configured"
      : currentRoleId && role.id === currentRoleId && String(entry.source || "").trim() && String(entry.source || "").trim() !== "default"
        ? String(entry.source || "").trim()
        : "discovered";
    const writeResult = writeNativeCharacterRecord(db, {
      characterId,
      label: role.name,
      englishLabel: configuredCharacterMap.get(characterId)?.label || entry.englishLabel || entry.label || characterId,
      roleId: role.id,
      source: nextSource,
      verifiedAt: nowIso(),
    });
    if (writeResult.mutated) changed = true;
  }

  const generatedRoles = getGeneratedRoleState();
  for (const tier of [1, 2, 3, 4, 5]) {
    const tierKey = String(tier);
    const roleName = formatTierLabel(tier);
    const explicitRoleId = String(appConfig.roles.killTierRoleIds?.[tierKey] || generatedRoles.tiers?.[tierKey] || "").trim();
    const role = await ensureRoleByName(guild, roleName, explicitRoleId);
    if (!role) continue;
    if (!explicitRoleId || role.id !== explicitRoleId) createdTierRoles += 1;
    if (generatedRoles.tiers[tierKey] !== role.id) {
      generatedRoles.tiers[tierKey] = role.id;
      changed = true;
    }
  }

  if (changed) {
    saveDb();
    invalidateLiveCharacterStatsContext();
  }

  // Phase 4.4: destructive orphan cleanup перенесён в moderator-only flow.
  // `cleanupOrphanCharacterRoles` остаётся как функция для явного клика, но
  // больше не вызывается автоматически из reconcile/ensureManagedRoles.
  void client;

  return {
    characterRoles: createdCharacterRoles,
    tierRoles: createdTierRoles,
    resolvedCharacters: reconcile.resolved,
    recoveredCharacters: Object.keys(reconcile.recoveredRoleIds || {}).length,
    ambiguousCharacters: Array.isArray(reconcile.ambiguous) ? reconcile.ambiguous.length : 0,
    unresolvedCharacters: Array.isArray(reconcile.unresolved) ? reconcile.unresolved.length : 0,
  };
}

async function applyMainSelection(client, member, user, selectedCharacterIds, reason = "main character sync") {
  void client;
  const normalizedIds = [...new Set((selectedCharacterIds || []).map((value) => String(value || "").trim()).filter(Boolean))].slice(0, 2);
  const selectedEntries = await syncManagedCharacterRoles(member, normalizedIds, reason);

  const profile = getProfile(user.id);
  profile.displayName = member.displayName || user.username;
  profile.username = user.username;
  profile.mainCharacterIds = selectedEntries.map((entry) => entry.id);
  refreshDerivedProfileMainFields(profile);
  profile.updatedAt = nowIso();
  saveDb();

  return selectedEntries;
}

async function syncPendingSubmissionMainsForUser(client, userId, selectedEntries) {
  const pending = getPendingSubmissionForUser(userId);
  if (!pending) return false;

  pending.mainCharacterIds = selectedEntries.map((entry) => entry.id);
  pending.mainCharacterLabels = selectedEntries.map((entry) => entry.label);
  pending.mainRoleIds = selectedEntries.map((entry) => entry.roleId);
  saveDb();

  const reviewMessage = await fetchReviewMessage(client, pending);
  if (reviewMessage) {
    await reviewMessage.edit({
      embeds: [buildReviewEmbed(pending, "pending", [{ name: "Обновление", value: "Пользователь обновил мейнов", inline: false }])],
      components: [buildReviewButtons(pending.id)],
    }).catch(() => {});
  }

  return true;
}

function getWelcomePanelState() {
  return readWelcomePanelState(db.config, appConfig.channels.welcomeChannelId);
}

function getNonGgsPanelState() {
  return readNonGgsPanelState(
    db.config,
    appConfig.channels.welcomeChannelId,
    getWelcomePanelState().channelId || appConfig.channels.welcomeChannelId
  );
}

function getGraphicTierlistConfig() {
  db.config.presentation ||= {};
  db.config.presentation.tierlist ||= {};
  db.config.presentation.tierlist.graphic ||= {};
  db.config.presentation.tierlist.graphic.image ||= {};
  db.config.presentation.tierlist.graphic.colors ||= {};
  db.config.presentation.tierlist.graphic.panel ||= { selectedTier: 5 };
  return db.config.presentation.tierlist.graphic;
}

function getGraphicImageConfig() {
  const presentation = getPresentation();
  const img = presentation.tierlist.graphic.image || {};
  return {
    W: Math.max(1200, Number(img.width) || 2000),
    H: Math.max(700, Number(img.height) || 1200),
    ICON: Math.max(64, Math.min(256, Number(img.icon) || 112)),
  };
}

function getEffectiveTierColors() {
  return { ...getPresentation().tierlist.graphic.colors };
}

function normalizeGraphicOutlineColor(value, fallback = "#ffffff") {
  const text = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(text) ? text : fallback;
}

function normalizeGraphicOutlineRules(value, fallbackColor = "#ffffff", limit = 25) {
  const source = Array.isArray(value) ? value : [];
  const normalized = [];
  const indexByRoleId = new Map();

  for (const entry of source) {
    if (!entry || typeof entry !== "object") continue;
    const roleId = parseRequestedRoleId(entry.roleId, "");
    if (!roleId) continue;

    const color = normalizeGraphicOutlineColor(entry.color, fallbackColor);
    if (indexByRoleId.has(roleId)) {
      normalized[indexByRoleId.get(roleId)].color = color;
      continue;
    }

    normalized.push({ roleId, color });
    indexByRoleId.set(roleId, normalized.length - 1);
    if (normalized.length >= limit) break;
  }

  return normalized;
}

function formatGraphicOutlineRulesText(rules = [], max = 220) {
  if (!Array.isArray(rules) || !rules.length) return "не настроена";
  return previewText(
    rules.map((rule) => `${formatRoleMention(rule.roleId)} → ${rule.color}`).join("; "),
    max
  );
}

function getEffectiveGraphicOutlineConfig() {
  const outline = getPresentation().tierlist.graphic.outline || {};
  const color = normalizeGraphicOutlineColor(outline.color, "#ffffff");
  const rawRoleIds = Array.isArray(outline.roleIds) ? outline.roleIds : [];
  const normalizedRoleIds = [...new Set(rawRoleIds
    .map((value) => String(value || "").trim())
    .filter((value) => /^\d{5,25}$/.test(value)))];
  const fallbackRoleId = String(outline.roleId || "").trim();
  if (!normalizedRoleIds.length && /^\d{5,25}$/.test(fallbackRoleId)) {
    normalizedRoleIds.push(fallbackRoleId);
  }
  const rules = normalizeGraphicOutlineRules(
    Array.isArray(outline.rules) && outline.rules.length
      ? outline.rules
      : normalizedRoleIds.map((roleId) => ({ roleId, color })),
    color
  );
  const roleIds = rules.length ? rules.map((rule) => rule.roleId) : normalizedRoleIds;
  return {
    roleId: roleIds[0] || "",
    roleIds,
    color,
    rules,
  };
}

function getEffectiveGraphicTitle() {
  return getPresentation().tierlist.graphicTitle;
}

function getEffectiveMessageText() {
  return getPresentation().tierlist.graphicMessageText;
}

function previewGraphicMessageText(maxLen = 170) {
  const text = getEffectiveMessageText();
  return text.length > maxLen ? text.slice(0, maxLen) + "…" : text;
}

function getProfile(userId) {
  const ensured = ensureSharedProfile(db.profiles[userId], userId);
  db.profiles[userId] = refreshDerivedProfileMainFields(ensured.profile);
  return db.profiles[userId];
}

function finalizeStoredProfile(userId) {
  const ensured = ensureSharedProfile(db.profiles[userId], userId);
  db.profiles[userId] = refreshDerivedProfileMainFields(ensured.profile);
  return db.profiles[userId];
}

function hasOwnRecordKey(value, key) {
  return Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function readRobloxBindingField(source, keys = []) {
  const input = source && typeof source === "object" ? source : {};
  for (const key of Array.isArray(keys) ? keys : []) {
    if (hasOwnRecordKey(input, key)) {
      return {
        found: true,
        value: input[key],
      };
    }
  }

  return {
    found: false,
    value: undefined,
  };
}

function buildCanonicalRobloxBindingSnapshot(source = {}) {
  const input = source && typeof source === "object" ? source : {};
  const snapshot = {};

  const username = readRobloxBindingField(input, ["username", "name", "robloxUsername"]);
  if (username.found) snapshot.username = String(username.value || "").trim();

  const userId = readRobloxBindingField(input, ["userId", "id", "robloxUserId"]);
  if (userId.found) snapshot.userId = String(userId.value || "").trim();

  const displayName = readRobloxBindingField(input, ["displayName", "robloxDisplayName"]);
  if (displayName.found) snapshot.displayName = String(displayName.value || "").trim();

  const extraFields = [
    ["avatarUrl", ["avatarUrl"]],
    ["profileUrl", ["profileUrl"]],
    ["createdAt", ["createdAt"]],
    ["description", ["description"]],
    ["hasVerifiedBadge", ["hasVerifiedBadge"]],
    ["accountStatus", ["accountStatus"]],
  ];

  for (const [targetKey, sourceKeys] of extraFields) {
    const field = readRobloxBindingField(input, sourceKeys);
    if (field.found) {
      snapshot[targetKey] = field.value;
    }
  }

  return snapshot;
}

function writeCanonicalRobloxBinding(userId, profile, source = {}, options = {}) {
  const snapshot = buildCanonicalRobloxBindingSnapshot(source);
  if (!snapshot.username || !snapshot.userId) {
    return null;
  }

  const nextRoblox = applyRobloxAccountSnapshot(profile, snapshot, options);
  finalizeStoredProfile(userId);
  return {
    snapshot,
    roblox: nextRoblox,
  };
}

function scheduleDeleteMessage(message, delayMs = TEMP_MESSAGE_DELETE_MS) {
  if (!message) return;
  setTimeout(() => {
    message.delete().catch(() => {});
  }, delayMs);
}

async function replyAndDelete(message, content, delayMs = TEMP_MESSAGE_DELETE_MS) {
  const reply = await message.reply(content).catch(() => null);
  if (reply) scheduleDeleteMessage(reply, delayMs);
  return reply;
}

function isSubmissionActive(submission) {
  return submission && submission.status === "pending" && hoursSince(submission.createdAt) <= PENDING_EXPIRE_HOURS;
}

function getPendingSubmissionForUser(userId) {
  const submissions = Object.values(db.submissions || {})
    .filter((submission) => submission.userId === userId && isSubmissionActive(submission))
    .sort((left, right) => Date.parse(right.createdAt || 0) - Date.parse(left.createdAt || 0));
  return submissions[0] || null;
}

function getLatestSubmissionForUser(userId) {
  const submissions = Object.values(db.submissions || {})
    .filter((submission) => submission.userId === userId)
    .sort((left, right) => Date.parse(right.reviewedAt || right.createdAt || 0) - Date.parse(left.reviewedAt || left.createdAt || 0));
  return submissions[0] || null;
}

function setMainDraft(userId, characterIds) {
  mainDrafts.set(userId, { characterIds: [...characterIds], createdAt: Date.now() });
}

function getMainDraft(userId) {
  const draft = mainDrafts.get(userId);
  if (!draft) return null;
  if (Date.now() - Number(draft.createdAt || 0) > SUBMIT_SESSION_EXPIRE_MS) {
    mainDrafts.delete(userId);
    return null;
  }
  return draft;
}

function clearMainDraft(userId) {
  mainDrafts.delete(userId);
}

function setSubmitSession(userId, value) {
  submitSessions.set(userId, { ...value, createdAt: Date.now() });
}

function getSubmitSession(userId) {
  const session = submitSessions.get(userId);
  if (!session) return null;
  if (Date.now() - Number(session.createdAt || 0) > SUBMIT_SESSION_EXPIRE_MS) {
    submitSessions.delete(userId);
    return null;
  }
  return session;
}

function clearSubmitSession(userId) {
  submitSessions.delete(userId);
}

function getValidatedLiveMainCharacterIds(characterIds = []) {
  return [...new Set(
    getSelectedCharacterEntries(characterIds)
      .filter((entry) => isLiveCharacterEntry(entry))
      .map((entry) => entry.id)
      .filter(Boolean)
  )].slice(0, 2);
}

function getStoredProfileMainCharacterIds(userId) {
  const existingProfile = db.profiles?.[userId];
  if (!existingProfile || typeof existingProfile !== "object") return [];

  const ensuredProfile = ensureSharedProfile(existingProfile, userId).profile;
  const derived = getDerivedProfileMainFields(ensuredProfile);
  return getValidatedLiveMainCharacterIds(derived.mainCharacterIds);
}

function getLiveMemberMainCharacterIds(member) {
  if (!member?.roles?.cache) return [];
  return getValidatedLiveMainCharacterIds(
    getCharacterEntries()
      .filter((entry) => isLiveCharacterEntry(entry) && member.roles.cache.has(entry.roleId))
      .map((entry) => entry.id)
  );
}

function buildSubmitSessionBootstrap(userId, member) {
  const mainCharacterIds = resolveResumableMainCharacterIds({
    storedMainCharacterIds: getStoredProfileMainCharacterIds(userId),
    liveMainCharacterIds: getLiveMemberMainCharacterIds(member),
  });
  if (!mainCharacterIds.length) return null;

  const existingProfile = db.profiles?.[userId];
  const ensuredProfile = existingProfile && typeof existingProfile === "object"
    ? ensureSharedProfile(existingProfile, userId).profile
    : null;
  const robloxSnapshot = buildCanonicalRobloxBindingSnapshot(ensuredProfile?.domains?.roblox || ensuredProfile || {});

  return {
    mainCharacterIds,
    robloxUsername: robloxSnapshot.username || "",
    robloxUserId: robloxSnapshot.userId || "",
    robloxDisplayName: robloxSnapshot.displayName || "",
  };
}

function normalizeRobloxUsernameInput(value) {
  const username = String(value || "").trim();
  return /^[A-Za-z0-9_]{3,20}$/.test(username) ? username : "";
}

async function resolveRobloxUserByUsername(username) {
  const normalizedUsername = normalizeRobloxUsernameInput(username);
  if (!normalizedUsername) {
    throw new Error("Roblox username должен содержать от 3 до 20 символов: буквы, цифры или _.");
  }

  const matches = await robloxApiClient.fetchUsersByUsernames([normalizedUsername], {
    excludeBannedUsers: false,
  });
  const match = Array.isArray(matches) ? matches[0] : null;
  if (!match?.userId) return null;

  const [profile, avatars] = await Promise.all([
    robloxApiClient.fetchUserProfile(match.userId),
    robloxApiClient.fetchUserAvatarHeadshots([match.userId]).catch(() => []),
  ]);
  const avatar = Array.isArray(avatars) ? avatars[0] : null;
  const resolvedProfile = profile || match;

  return {
    id: String(resolvedProfile.userId || match.userId),
    name: String(resolvedProfile.username || match.username || normalizedUsername).trim(),
    displayName: String(resolvedProfile.displayName || resolvedProfile.username || match.displayName || match.username || normalizedUsername).trim(),
    avatarUrl: avatar?.imageUrl || null,
    profileUrl: resolvedProfile.profileUrl || null,
    createdAt: resolvedProfile.createdAt || null,
    description: resolvedProfile.description || null,
    hasVerifiedBadge: resolvedProfile.hasVerifiedBadge,
    accountStatus: resolvedProfile.isBanned === true
      ? "banned-or-unavailable"
      : resolvedProfile.isBanned === false
        ? "active"
        : null,
  };
}

function buildRobloxUsernameModal(customId, initialValue = "") {
  const modal = new ModalBuilder().setCustomId(customId).setTitle("Roblox username");
  const input = new TextInputBuilder()
    .setCustomId("roblox_username")
    .setLabel("Уникальный Roblox username")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(20)
    .setPlaceholder("Например Ryomen_One")
    .setValue(String(initialValue || "").trim().slice(0, 20));

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

function getOnboardingProofExampleImagePath() {
  const rawPath = String(appConfig?.ui?.onboardingProofExampleImagePath || "").trim();
  if (!rawPath) return "";
  return path.isAbsolute(rawPath) ? rawPath : path.resolve(PROJECT_ROOT, rawPath);
}

function getOnboardingProofExampleImageUrl() {
  return String(appConfig?.ui?.onboardingProofExampleImageUrl || "").trim();
}

function normalizeMainsPickerState(rawValue = {}) {
  const mode = rawValue?.mode === "quick" ? "quick" : "full";
  const query = String(rawValue?.query || "").trim().slice(0, 80);
  const page = Math.max(0, Number(rawValue?.page) || 0);
  const selectedIds = [...new Set(
    (Array.isArray(rawValue?.selectedIds) ? rawValue.selectedIds : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  )].slice(0, 2);

  return {
    mode,
    query,
    page,
    selectedIds,
  };
}

function setMainsPickerSession(userId, value) {
  const current = getMainsPickerSession(userId) || normalizeMainsPickerState(value);
  const nextValue = normalizeMainsPickerState({ ...current, ...value });
  mainsPickerSessions.set(userId, { ...nextValue, createdAt: Date.now() });
  return nextValue;
}

function getMainsPickerSession(userId) {
  const session = mainsPickerSessions.get(userId);
  if (!session) return null;
  if (Date.now() - Number(session.createdAt || 0) > SUBMIT_SESSION_EXPIRE_MS) {
    mainsPickerSessions.delete(userId);
    return null;
  }
  return normalizeMainsPickerState(session);
}

function clearMainsPickerSession(userId) {
  mainsPickerSessions.delete(userId);
}

function getMainsPickerEntries(rawQuery = "") {
  return filterRolePanelPickerItems(
    getCharacterPickerEntries().map((entry) => ({
      ...entry,
      description: entry.id,
      keywords: `${entry.label} ${entry.id}`,
    })),
    rawQuery
  );
}

function getMainsPickerSelectionLabels(selectedIds = []) {
  const selectedEntries = getSelectedCharacterEntries(selectedIds);
  return selectedEntries.length
    ? selectedEntries.map((entry) => entry.label)
    : selectedIds.map((value) => String(value || "").trim()).filter(Boolean);
}

function getInitialMainsPickerSelectedIds(userId) {
  const submitSession = getSubmitSession(userId);
  if (Array.isArray(submitSession?.mainCharacterIds) && submitSession.mainCharacterIds.length) {
    return submitSession.mainCharacterIds;
  }

  const draft = getMainDraft(userId);
  if (Array.isArray(draft?.characterIds) && draft.characterIds.length) {
    return draft.characterIds;
  }

  const profile = db.profiles?.[userId] || null;
  if (Array.isArray(profile?.mainCharacterIds) && profile.mainCharacterIds.length) {
    return profile.mainCharacterIds;
  }

  return [];
}

function getMainsPickerResultLines(pageInfo, selectedIds = []) {
  if (!pageInfo.items.length) {
    return ["Ничего не найдено. Попробуй другой запрос или сбрось поиск."];
  }

  return pageInfo.items.map((entry, index) => {
    const number = pageInfo.page * Math.min(ROLE_PANEL_PICKER_PAGE_SIZE, 25) + index + 1;
    const marker = selectedIds.includes(entry.id) ? "•" : "◦";
    return `${number}. ${marker} ${previewText(entry.label, 70)} (${entry.id})`;
  });
}

function buildMainsPickerSelectRow(picker, entries) {
  const maxSelectable = Math.min(2, entries.length);
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("onboard_picker_select")
      .setPlaceholder(maxSelectable === 1 ? "Выбери мейна" : "Выбери 1 или 2 мейнов")
      .setMinValues(1)
      .setMaxValues(maxSelectable)
      .addOptions(entries.map((entry) => ({
        label: normalizeCharacterSelectLabel(entry.label),
        value: getCharacterSelectValue(entry.id),
        default: picker.selectedIds.includes(entry.id),
      })))
  );
}

function buildMainsPickerPayload(userId, options = {}) {
  const picker = options.picker || getMainsPickerSession(userId);
  if (!picker) {
    const payload = { content: "Сессия выбора мейнов истекла. Нажми кнопку заново." };
    return options.includeEphemeralFlag === false ? payload : ephemeralPayload(payload);
  }

  const entries = getCharacterPickerEntries();
  if (!entries.length) {
    const payload = { content: "Нет доступных персонажей. Проверь конфигурацию characters в bot.config.json." };
    return options.includeEphemeralFlag === false ? payload : ephemeralPayload(payload);
  }
  if (entries.length > 25) {
    throw new Error(`Список мейнов слишком большой для Discord select menu: ${entries.length}.`);
  }

  const isQuick = picker.mode === "quick";
  const selectedLabels = getMainsPickerSelectionLabels(picker.selectedIds);
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(isQuick ? "Сменить мейнов" : "Выбери мейнов")
    .setDescription(
      [
        "Выбери одного или двух персонажей в меню ниже и нажми **Подтвердить**.",
        selectedLabels.length ? `Текущий выбор: **${selectedLabels.join(", ")}**` : null,
      ].filter(Boolean).join("\n")
    );

  const components = [
    buildMainsPickerSelectRow(picker, entries),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("onboard_picker_continue")
        .setLabel(isQuick ? "Сохранить" : "Подтвердить")
        .setStyle(ButtonStyle.Success)
        .setDisabled(!picker.selectedIds.length),
      new ButtonBuilder().setCustomId("onboard_cancel").setLabel("Отмена").setStyle(ButtonStyle.Secondary)
    ),
  ];

  const payload = { embeds: [embed], components };
  return options.includeEphemeralFlag === false ? payload : ephemeralPayload(payload);
}

function setNonGgsCaptchaSession(userId, value) {
  nonGgsCaptchaSessions.set(userId, { ...value, createdAt: Date.now() });
}

function getNonGgsCaptchaSession(userId) {
  const session = nonGgsCaptchaSessions.get(userId);
  if (!session) return null;
  if (Date.now() - Number(session.createdAt || 0) > NON_GGS_CAPTCHA_EXPIRE_MS) {
    nonGgsCaptchaSessions.delete(userId);
    return null;
  }
  return session;
}

function clearNonGgsCaptchaSession(userId) {
  nonGgsCaptchaSessions.delete(userId);
}

function getActiveNonGgsCaptchaSessionCount() {
  let count = 0;
  for (const userId of nonGgsCaptchaSessions.keys()) {
    if (getNonGgsCaptchaSession(userId)) count += 1;
  }
  return count;
}

function createRolePanelDraft(baseValue = null) {
  return normalizeRoleMessageDraft(baseValue || {});
}

function setRolePanelDraft(userId, value) {
  const current = getRolePanelDraft(userId) || createRolePanelDraft();
  const nextDraft = createRolePanelDraft({ ...current, ...value });
  rolePanelDrafts.set(userId, { ...nextDraft, createdAt: Date.now() });
  return nextDraft;
}

function getRolePanelDraft(userId) {
  const draft = rolePanelDrafts.get(userId);
  if (!draft) return null;
  if (Date.now() - Number(draft.createdAt || 0) > ROLE_PANEL_DRAFT_EXPIRE_MS) {
    rolePanelDrafts.delete(userId);
    return null;
  }
  return createRolePanelDraft(draft);
}

function ensureRolePanelDraft(userId) {
  return getRolePanelDraft(userId) || setRolePanelDraft(userId, {});
}

function clearRolePanelDraft(userId) {
  rolePanelDrafts.delete(userId);
}

function setRoleCleanupSelection(userId, roleId) {
  const nextValue = { roleId: String(roleId || "").trim(), createdAt: Date.now() };
  roleCleanupSelections.set(userId, nextValue);
  return nextValue;
}

function getRoleCleanupSelection(userId) {
  const selection = roleCleanupSelections.get(userId);
  if (!selection) return null;
  if (Date.now() - Number(selection.createdAt || 0) > ROLE_PANEL_DRAFT_EXPIRE_MS) {
    roleCleanupSelections.delete(userId);
    return null;
  }
  return { roleId: String(selection.roleId || "").trim(), createdAt: selection.createdAt };
}

function clearRoleCleanupSelection(userId) {
  roleCleanupSelections.delete(userId);
}

function setRoleRecordSelection(userId, recordId) {
  const nextValue = { recordId: String(recordId || "").trim(), createdAt: Date.now() };
  roleRecordSelections.set(userId, nextValue);
  return nextValue;
}

function getRoleRecordSelection(userId) {
  const selection = roleRecordSelections.get(userId);
  if (!selection) return null;
  if (Date.now() - Number(selection.createdAt || 0) > ROLE_PANEL_DRAFT_EXPIRE_MS) {
    roleRecordSelections.delete(userId);
    return null;
  }
  return { recordId: String(selection.recordId || "").trim(), createdAt: selection.createdAt };
}

function clearRoleRecordSelection(userId) {
  roleRecordSelections.delete(userId);
}

function setRolePanelPicker(userId, value) {
  const current = getRolePanelPicker(userId) || normalizeRolePanelPickerState(value);
  const nextValue = normalizeRolePanelPickerState({ ...current, ...value });
  rolePanelPickers.set(userId, { ...nextValue, createdAt: Date.now() });
  return nextValue;
}

function getRolePanelPicker(userId) {
  const picker = rolePanelPickers.get(userId);
  if (!picker) return null;
  if (Date.now() - Number(picker.createdAt || 0) > ROLE_PANEL_DRAFT_EXPIRE_MS) {
    rolePanelPickers.delete(userId);
    return null;
  }
  return normalizeRolePanelPickerState(picker);
}

function clearRolePanelPicker(userId) {
  rolePanelPickers.delete(userId);
}

function getRolePanelPickerSelectionId(userId, scope) {
  if (scope === ROLE_PANEL_PICKER_SCOPES.CLEANUP_ROLE) {
    return String(getRoleCleanupSelection(userId)?.roleId || "").trim();
  }

  if (scope === ROLE_PANEL_PICKER_SCOPES.COMBO_GUIDE_EDITOR_ROLE) {
    return "";
  }

  const draft = getRolePanelDraft(userId);
  if (!draft) return "";
  if (scope === ROLE_PANEL_PICKER_SCOPES.COMPOSE_CHANNEL) {
    return String(draft.channelId || "").trim();
  }

  if (scope === ROLE_PANEL_PICKER_SCOPES.COMPOSE_BUTTON_ROLE) {
    const editingIdx = Number.isInteger(draft.editingButtonIndex) ? draft.editingButtonIndex : -1;
    const existingButton = editingIdx >= 0 ? (Array.isArray(draft.buttons) ? draft.buttons[editingIdx] : null) : null;
    return String(existingButton?.roleId || "").trim();
  }

  return String(draft.roleId || "").trim();
}

function buildRolePanelPickerReturnPayload(userId, scope, statusText = "", includeFlags = true) {
  if (scope === ROLE_PANEL_PICKER_SCOPES.COMBO_GUIDE_EDITOR_ROLE) {
    const payload = buildComboPanelPayload(db.comboGuide, statusText, {
      canManage: true,
      canEdit: true,
    });
    return includeFlags ? ephemeralPayload(payload) : payload;
  }

  return scope === ROLE_PANEL_PICKER_SCOPES.CLEANUP_ROLE
    ? buildRoleCleanupPayload(userId, statusText, includeFlags)
    : buildRolePanelComposerPayload(userId, statusText, includeFlags);
}

function getRolePanelPickerMeta(scope) {
  if (scope === ROLE_PANEL_PICKER_SCOPES.COMBO_GUIDE_EDITOR_ROLE) {
    return {
      title: "Combo Guide • Доступ по ролям",
      description: "Показываются все роли сервера. Ищи по имени или ID и выбирай роль. Повторный выбор той же роли убирает её из доступа.",
      selectPlaceholder: "Добавить или убрать роль",
      searchTitle: "Поиск роли для доступа",
      searchLabel: "Имя или ID роли",
      searchPlaceholder: "Например: редактор 1234567890",
      idTitle: "Выбор роли по ID",
      idLabel: "ID роли",
      backLabel: "Назад к панели комбо-гайда",
    };
  }

  if (scope === ROLE_PANEL_PICKER_SCOPES.COMPOSE_ROLE) {
    return {
      title: "Role Panel • Выбор роли",
      description: "Показываются все роли сервера. Ищи по имени или ID, затем выбери роль для кнопки выдачи.",
      selectPlaceholder: "Выбрать роль",
      searchTitle: "Поиск роли",
      searchLabel: "Имя или ID роли",
      searchPlaceholder: "Например: ивент 1234567890",
      idTitle: "Выбор роли по ID",
      idLabel: "ID роли",
      backLabel: "Назад к конструктору",
    };
  }

  if (scope === ROLE_PANEL_PICKER_SCOPES.COMPOSE_BUTTON_ROLE) {
    return {
      title: "Role Panel • Роль для кнопки",
      description: "Выбери роль, которая будет привязана к кнопке.",
      selectPlaceholder: "Выбрать роль",
      searchTitle: "Поиск роли",
      searchLabel: "Имя или ID роли",
      searchPlaceholder: "Например: ивент 1234567890",
      idTitle: "Выбор роли по ID",
      idLabel: "ID роли",
      backLabel: "Назад к конструктору",
    };
  }

  if (scope === ROLE_PANEL_PICKER_SCOPES.CLEANUP_ROLE) {
    return {
      title: "Role Panel • Роль для снятия",
      description: "Показываются все роли сервера. Ищи по имени или ID, затем выбери роль для массового снятия.",
      selectPlaceholder: "Выбрать роль",
      searchTitle: "Поиск роли для снятия",
      searchLabel: "Имя или ID роли",
      searchPlaceholder: "Например: ивент 1234567890",
      idTitle: "Выбор роли по ID",
      idLabel: "ID роли",
      backLabel: "Назад к снятию",
    };
  }

  return {
    title: "Role Panel • Выбор канала",
    description: "Показываются все каналы, куда бот может отправить сообщение. Ищи по имени или ID, затем выбери канал публикации.",
    selectPlaceholder: "Выбрать канал",
    searchTitle: "Поиск канала",
    searchLabel: "Имя или ID канала",
    searchPlaceholder: "Например: announcements 1234567890",
    idTitle: "Выбор канала по ID",
    idLabel: "ID канала",
    backLabel: "Назад к конструктору",
  };
}

function compareRolePanelText(leftValue, rightValue) {
  return String(leftValue || "").localeCompare(String(rightValue || ""), "ru", {
    numeric: true,
    sensitivity: "base",
  });
}

function compareRolePanelChannels(left, right) {
  const leftParentPosition = Number(left.parent?.rawPosition ?? left.parent?.position ?? -1);
  const rightParentPosition = Number(right.parent?.rawPosition ?? right.parent?.position ?? -1);
  if (leftParentPosition !== rightParentPosition) return leftParentPosition - rightParentPosition;

  const parentNameCompare = compareRolePanelText(left.parent?.name || "", right.parent?.name || "");
  if (parentNameCompare) return parentNameCompare;

  const leftPosition = Number(left.rawPosition ?? left.position ?? 0);
  const rightPosition = Number(right.rawPosition ?? right.position ?? 0);
  if (leftPosition !== rightPosition) return leftPosition - rightPosition;

  return compareRolePanelText(left.name || left.id, right.name || right.id);
}

function buildRolePanelChannelEntry(channel) {
  const parentName = String(channel.parent?.name || "").trim();
  const kindLabel = channel.isThread?.() ? "тред" : "канал";
  const channelName = String(channel.name || channel.id).trim();

  return {
    id: channel.id,
    label: channel.isThread?.() ? channelName : `#${channelName}`,
    description: previewText([kindLabel, parentName || "без категории", channel.id].join(" • "), 100),
    keywords: [channelName, channel.id, parentName, channel.topic].filter(Boolean).join(" "),
  };
}

async function getRolePanelChannelEntries(client) {
  const guild = await getGuild(client);
  if (!guild) return [];

  const channels = await guild.channels.fetch().catch(() => guild.channels.cache);
  return [...channels.values()]
    .filter((channel) => channel && channel.guild?.id === guild.id)
    .filter((channel) => channel.isTextBased?.() && typeof channel.send === "function")
    .sort(compareRolePanelChannels)
    .map(buildRolePanelChannelEntry);
}

function buildRolePanelRoleEntry(role) {
  const status = role.editable
    ? "бот может выдать"
    : role.managed
      ? "роль управляется интеграцией"
      : "бот не может выдать";

  return {
    id: role.id,
    label: String(role.name || role.id).trim(),
    description: previewText(`${status} • ${role.id}`, 100),
    keywords: [role.name, role.id, status, role.managed ? "managed" : "", role.editable ? "editable" : ""].filter(Boolean).join(" "),
  };
}

async function getRolePanelRoleEntries(client) {
  const guild = await getGuild(client);
  if (!guild) return [];

  const roles = await guild.roles.fetch().catch(() => guild.roles.cache);
  return [...roles.values()]
    .filter((role) => role && role.id !== guild.id)
    .sort((left, right) => right.position - left.position || compareRolePanelText(left.name || left.id, right.name || right.id))
    .map(buildRolePanelRoleEntry);
}

async function getRolePanelPickerEntries(client, scope) {
  return scope === ROLE_PANEL_PICKER_SCOPES.COMPOSE_CHANNEL
    ? getRolePanelChannelEntries(client)
    : getRolePanelRoleEntries(client);
}

async function findRolePanelPickerEntryById(client, scope, entityId) {
  const id = String(entityId || "").trim();
  if (!id) return null;
  const entries = await getRolePanelPickerEntries(client, scope);
  return entries.find((entry) => entry.id === id) || null;
}

function buildRolePanelPickerSelectRow(userId, scope, items) {
  const meta = getRolePanelPickerMeta(scope);
  const selectedId = getRolePanelPickerSelectionId(userId, scope);
  const options = items.map((item) => ({
    label: previewText(item.label, 100) || item.id,
    description: previewText(item.description || item.id, 100),
    value: item.id,
    default: selectedId === item.id,
  }));

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("rolepanel_picker_select")
      .setPlaceholder(meta.selectPlaceholder)
      .addOptions(options)
  );
}

function getRolePanelPickerResultLines(pageInfo, selectedId) {
  if (!pageInfo.items.length) {
    return ["Ничего не найдено. Попробуй другой запрос или введи ID вручную."];
  }

  return pageInfo.items.slice(0, 10).map((item, index) => {
    const number = pageInfo.page * ROLE_PANEL_PICKER_PAGE_SIZE + index + 1;
    const marker = item.id === selectedId ? "•" : "◦";
    return `${number}. ${marker} ${previewText(item.label, 70)} (${item.id})`;
  });
}

async function buildRolePanelPickerPayload(client, userId, statusText = "", includeFlags = true) {
  const picker = getRolePanelPicker(userId);
  if (!picker) {
    return buildRolePanelHomePayload("Сессия выбора истекла. Открой выбор заново.", includeFlags);
  }

  const meta = getRolePanelPickerMeta(picker.scope);
  const entries = await getRolePanelPickerEntries(client, picker.scope);
  const filteredEntries = filterRolePanelPickerItems(entries, picker.query);
  const pageInfo = paginateRolePanelPickerItems(filteredEntries, picker.page, ROLE_PANEL_PICKER_PAGE_SIZE);
  const selectedId = getRolePanelPickerSelectionId(userId, picker.scope);
  const selectedEntry = entries.find((entry) => entry.id === selectedId) || null;

  if (pageInfo.page !== picker.page) {
    setRolePanelPicker(userId, { scope: picker.scope, query: picker.query, page: pageInfo.page });
  }

  const embed = new EmbedBuilder()
    .setTitle(meta.title)
    .setDescription(meta.description)
    .addFields(
      { name: "Текущий выбор", value: selectedEntry ? `${previewFieldText(selectedEntry.label, 200)}\n${selectedEntry.id}` : "—", inline: false },
      { name: "Поиск", value: picker.query ? previewFieldText(picker.query, 100) : "без фильтра", inline: true },
      { name: "Найдено", value: formatNumber(pageInfo.totalCount), inline: true },
      { name: "Страница", value: `${pageInfo.page + 1}/${pageInfo.pageCount}`, inline: true },
      { name: "Результаты", value: getRolePanelPickerResultLines(pageInfo, selectedId).join("\n"), inline: false }
    );

  if (statusText) {
    embed.addFields({ name: "Последнее действие", value: statusText, inline: false });
  }

  const components = [];
  if (pageInfo.items.length) {
    components.push(buildRolePanelPickerSelectRow(userId, picker.scope, pageInfo.items));
  }
  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("rolepanel_picker_prev").setLabel("Предыдущая").setStyle(ButtonStyle.Secondary).setDisabled(!pageInfo.hasPrev),
      new ButtonBuilder().setCustomId("rolepanel_picker_next").setLabel("Следующая").setStyle(ButtonStyle.Secondary).setDisabled(!pageInfo.hasNext)
    )
  );
  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("rolepanel_picker_search").setLabel("Поиск").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("rolepanel_picker_jump_id").setLabel("Выбрать по ID").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("rolepanel_picker_clear").setLabel("Сбросить поиск").setStyle(ButtonStyle.Secondary).setDisabled(!picker.query)
    )
  );
  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("rolepanel_picker_back").setLabel(meta.backLabel).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("rolepanel_home").setLabel("В корень").setStyle(ButtonStyle.Secondary)
    )
  );

  const payload = {
    embeds: [embed],
    components,
  };

  return includeFlags ? ephemeralPayload(payload) : payload;
}

async function selectRolePanelPickerValue(client, userId, scope, selectedId) {
  const entityId = String(selectedId || "").trim();

  if (scope === ROLE_PANEL_PICKER_SCOPES.COMPOSE_CHANNEL) {
    setRolePanelDraft(userId, { channelId: entityId });
    return `Канал выбран: ${formatChannelMention(entityId)}.`;
  }

  if (scope === ROLE_PANEL_PICKER_SCOPES.COMBO_GUIDE_EDITOR_ROLE) {
    const guideState = ensureComboGuideAccessState();
    const currentRoleIds = getComboGuideEditorRoleIds(guideState);

    if (currentRoleIds.includes(entityId)) {
      guideState.editorRoleIds = currentRoleIds.filter((roleId) => roleId !== entityId);
      saveDb();
      return `Доступ убран у роли ${formatRoleMention(entityId)}.`;
    }

    if (currentRoleIds.length >= 25) {
      return "Нельзя добавить больше 25 ролей. Сначала убери лишние роли из доступа.";
    }

    guideState.editorRoleIds = normalizeComboGuideEditorRoleIds([...currentRoleIds, entityId]);
    saveDb();
    return `Доступ добавлен для роли ${formatRoleMention(entityId)}.`;
  }

  const role = await fetchRoleForPanel(client, entityId);
  const warningText = role && !role.editable
    ? " Роль видна в полном списке, но бот сейчас не может ей управлять."
    : "";

  if (scope === ROLE_PANEL_PICKER_SCOPES.CLEANUP_ROLE) {
    setRoleCleanupSelection(userId, entityId);
    return `Роль для снятия выбрана: ${formatRoleMention(entityId)}.${warningText}`;
  }

  if (scope === ROLE_PANEL_PICKER_SCOPES.COMPOSE_BUTTON_ROLE) {
    const draft = ensureRolePanelDraft(userId);
    const editingIdx = Number.isInteger(draft.editingButtonIndex) && draft.editingButtonIndex >= 0 ? draft.editingButtonIndex : -1;
    const buttons = Array.isArray(draft.buttons) ? [...draft.buttons] : [];

    if (editingIdx >= 0 && editingIdx < buttons.length) {
      buttons[editingIdx] = { ...buttons[editingIdx], roleId: entityId };
      setRolePanelDraft(userId, { buttons });
      return `Роль кнопки ${editingIdx + 1} обновлена: ${formatRoleMention(entityId)}.${warningText}`;
    }

    buttons.push({ roleId: entityId, label: DEFAULT_ROLE_PANEL_BUTTON_LABEL });
    setRolePanelDraft(userId, { buttons, editingButtonIndex: buttons.length - 1 });
    return `Кнопка добавлена с ролью ${formatRoleMention(entityId)}.${warningText} Можешь переименовать её.`;
  }

  setRolePanelDraft(userId, { roleId: entityId });
  return `Роль выбрана: ${formatRoleMention(entityId)}.${warningText}`;
}

function getRoleGrantRegistry() {
  db.roleGrantMessages ||= {};
  return db.roleGrantMessages;
}

function getRoleGrantRecord(recordId) {
  const key = String(recordId || "").trim();
  return key ? getRoleGrantRegistry()[key] || null : null;
}

function listRoleGrantRecords(options = {}) {
  return getRoleGrantRecords(getRoleGrantRegistry(), options);
}

function getRoleGrantSummaryLines(records, max = 5) {
  if (!records.length) return ["Активных выдач пока нет."];
  return records.slice(0, max).map((record) => {
    const rolesMention = Array.isArray(record.buttons) && record.buttons.length
      ? record.buttons.map((b) => formatRoleMention(b.roleId)).join(", ")
      : "—";
    return `${rolesMention} -> ${formatChannelMention(record.channelId)} | ${formatDateTime(record.createdAt)}`;
  });
}

function getRoleGrantMessageUrl(record) {
  if (!record?.channelId || !record?.messageId || !GUILD_ID) return "";
  return `https://discord.com/channels/${GUILD_ID}/${record.channelId}/${record.messageId}`;
}

function getSelectedRoleGrantRecord(userId) {
  const records = listRoleGrantRecords({ activeOnly: false });
  if (!records.length) return null;

  const selection = getRoleRecordSelection(userId);
  if (selection?.recordId) {
    const selected = records.find((record) => record.id === selection.recordId);
    if (selected) return selected;
  }

  return records[0] || null;
}

function buildRoleRecordSelectRow(userId, records) {
  const selectedRecord = getSelectedRoleGrantRecord(userId);
  const options = records.slice(0, 25).map((record) => {
    const status = record.disabledAt ? "Выключено" : "Активно";
    const buttonCount = Array.isArray(record.buttons) ? record.buttons.length : 0;
    return {
      label: previewText(`${status} • ${formatDateTime(record.createdAt)} • ${buttonCount} кнопок`, 100),
      description: previewText(`${record.channelId} • ${record.messageId}`, 100),
      value: record.id,
      default: selectedRecord?.id === record.id,
    };
  });

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("rolepanel_records_select")
      .setPlaceholder("Выбрать опубликованное сообщение")
      .addOptions(options)
  );
}

function buildAutoResendSelectRow(record) {
  const currentValue = record?.autoResendIntervalMs || 0;
  const options = ROLE_PANEL_AUTO_RESEND_INTERVALS.map((entry) => ({
    label: entry.label,
    value: String(entry.value),
    default: entry.value === currentValue,
  }));

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("rolepanel_records_autoresend")
      .setPlaceholder("Авто-переотправка")
      .setDisabled(!record || Boolean(record?.disabledAt))
      .addOptions(options)
  );
}

function buildComposerAutoResendSelectRow(draft) {
  const currentValue = draft?.autoResendIntervalMs || 0;
  const options = ROLE_PANEL_AUTO_RESEND_INTERVALS.map((entry) => ({
    label: entry.label,
    value: String(entry.value),
    default: entry.value === currentValue,
  }));

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("rolepanel_compose_autoresend")
      .setPlaceholder("Авто-переотправка (опционально)")
      .addOptions(options)
  );
}

async function getGuild(client) {
  if (guildCache) return guildCache;
  guildCache = await client.guilds.fetch(GUILD_ID).catch(() => null);
  return guildCache;
}

async function getActivityGuildMember(client, userId, guildHint = null) {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) return null;

  const guild = guildHint || await getGuild(client).catch(() => null);
  if (!guild) return null;
  return guild.members?.cache?.get(normalizedUserId) || await guild.members.fetch(normalizedUserId).catch(() => null);
}

async function resolveActivityMemberRoleIds(client, userId, guildHint = null) {
  const member = await getActivityGuildMember(client, userId, guildHint);
  return member ? [...member.roles.cache.keys()] : [];
}

async function resolveActivityMemberMeta(client, userId, guildHint = null) {
  const member = await getActivityGuildMember(client, userId, guildHint);
  const joinedAt = member?.joinedAt instanceof Date && Number.isFinite(member.joinedAt.getTime())
    ? member.joinedAt.toISOString()
    : null;
  return joinedAt ? { joinedAt } : null;
}

async function listActivityRoleHolderUserIds(client, guildHint = null) {
  const guild = guildHint || await getGuild(client).catch(() => null);
  if (!guild) return [];

  await guild.members.fetch().catch(() => null);

  const managedRoleIds = Object.values(ensureActivityState(db).config?.activityRoleIds || {})
    .map((roleId) => String(roleId || "").trim())
    .filter(Boolean);
  if (!managedRoleIds.length) return [];

  return [...guild.members.cache.values()]
    .filter((member) => managedRoleIds.some((roleId) => member.roles.cache.has(roleId)))
    .map((member) => String(member.id || "").trim())
    .filter(Boolean);
}

async function applyActivityMemberRoleChanges(client, { userId, addRoleIds = [], removeRoleIds = [], reason = "activity role sync", guildHint = null } = {}) {
  const member = await getActivityGuildMember(client, userId, guildHint);
  if (!member) return false;
  try {
    if (removeRoleIds.length) {
      await member.roles.remove(removeRoleIds, reason);
    }
    if (addRoleIds.length) {
      await member.roles.add(addRoleIds, reason);
    }
    return true;
  } catch {
    return false;
  }
}

function getAutonomyGuardState() {
  return ensureAutonomyGuardState(db);
}

function getAutonomyGuardPrimaryAdminUserId() {
  return resolveAutonomyGuardPrimaryAdminUserId(db, appConfig);
}

function isAutonomyGuardPrimaryAdmin(userId) {
  const normalizedUserId = String(userId || "").trim();
  return Boolean(normalizedUserId && normalizedUserId === getAutonomyGuardPrimaryAdminUserId());
}

async function replyIfAutonomyGuardBlockedActor(interaction) {
  if (!isAutonomyGuardIsolatedUser(db, interaction?.user?.id) || isAutonomyGuardPrimaryAdmin(interaction?.user?.id)) {
    return false;
  }

  await interaction.reply({ content: "Пошёл лесом." }).catch(() => {});
  return true;
}

async function replyAutonomyGuardIsolatedTarget(interaction, userId, options = {}) {
  if (!isAutonomyGuardIsolatedUser(db, userId)) return false;

  const message = options.message || "Пользователь в изоляторе. Модераторские действия по нему отключены.";
  if (options.editReply) {
    await interaction.editReply(message).catch(() => {});
  } else {
    await interaction.reply(ephemeralPayload({ content: message })).catch(() => {});
  }
  return true;
}

function getAutonomyGuardDesiredRolePosition(role, guild) {
  const highestRole = guild?.members?.me?.roles?.highest;
  if (!highestRole || highestRole.id === role?.id) return null;
  const desiredPosition = Number(highestRole.position) - 1;
  return Number.isFinite(desiredPosition) && desiredPosition > 0 ? desiredPosition : null;
}

async function ensureAutonomyGuardRole(guild, options = {}) {
  const reason = String(options.reason || "autonomy guard role update").trim() || "autonomy guard role update";
  const currentRoleState = getAutonomyGuardState().protectedRole;
  const desiredRole = normalizeProtectedRole(options.roleOverride
    ? { ...currentRoleState, ...options.roleOverride }
    : currentRoleState);

  if (!desiredRole.name) {
    throw new Error("Сначала создай target-роль через `/onboard targetrole`.");
  }
  if (!desiredRole.color) {
    throw new Error("Для target-роли нужен валидный HEX цвет.");
  }

  let role = desiredRole.roleId
    ? await guild.roles.fetch(desiredRole.roleId).catch(() => null)
    : null;

  if (!role) {
    role = await ensureRoleByName(guild, desiredRole.name, "", { createIfMissing: true });
  }
  if (!role) {
    throw new Error("Не удалось найти или создать target-роль.");
  }

  const editPayload = {};
  if (role.name !== desiredRole.name) editPayload.name = desiredRole.name;
  if (String(role.hexColor || "").toUpperCase() !== desiredRole.color.toUpperCase()) editPayload.color = desiredRole.color;
  if (role.mentionable !== true) editPayload.mentionable = true;
  const permissionBits = typeof role.permissions?.bitfield === "bigint"
    ? role.permissions.bitfield
    : BigInt(role.permissions?.bitfield || 0);
  if (permissionBits !== BigInt(0)) editPayload.permissions = BigInt(0);

  if (Object.keys(editPayload).length) {
    role = await role.edit({ ...editPayload, reason });
  }

  const desiredPosition = getAutonomyGuardDesiredRolePosition(role, guild);
  if (desiredPosition != null && role.position !== desiredPosition) {
    const movedRole = await role.setPosition(desiredPosition, { reason }).catch(() => null);
    if (movedRole) role = movedRole;
  }

  return {
    role,
    stateChanged: setAutonomyGuardProtectedRole(db, {
      roleId: role.id,
      name: desiredRole.name,
      color: desiredRole.color,
    }),
  };
}

async function assignAutonomyGuardRoleToUser(client, userId, roleId, reason) {
  const member = await fetchMember(client, userId);
  if (!member) {
    throw new Error("Участник должен находиться на сервере.");
  }

  if (!member.roles.cache.has(roleId)) {
    markAutonomyGuardRoleMutationIgnore(userId);
    await member.roles.add(roleId, reason);
  }

  return member;
}

async function clearAutonomyGuardRoleFromUser(client, userId, roleId, reason) {
  if (!userId || !roleId) return false;
  const member = await fetchMember(client, userId);
  if (!member?.roles?.cache?.has?.(roleId)) return false;
  markAutonomyGuardRoleMutationIgnore(userId);
  await member.roles.remove(roleId, reason).catch(() => {});
  return true;
}

function getAutonomyGuardProtectedRoleIds() {
  const activityConfig = ensureActivityState(db).config || {};
  const roleGrantRoleIds = listRoleGrantRecords({ activeOnly: true }).flatMap((record) => (
    Array.isArray(record?.buttons)
      ? record.buttons.map((button) => String(button?.roleId || "").trim()).filter(Boolean)
      : []
  ));

  return collectAutonomyGuardProtectedRoleIds({
    protectedRoleId: getAutonomyGuardState().protectedRole?.roleId,
    accessRoleIds: [
      getNormalAccessRoleId(),
      getWartimeAccessRoleId(),
      getNonJjsAccessRoleId(),
      getVerifyAccessRoleId(),
    ],
    tierRoleIds: getAllTierRoleIds(),
    legacyEloTierRoleIds: getAllLegacyEloTierRoleIds(),
    characterRoleIds: getCharacterCatalog().map((entry) => String(entry?.roleId || "").trim()),
    activityRoleIds: activityConfig.activityRoleIds,
    activityAdminRoleIds: activityConfig.adminRoleIds,
    activityModeratorRoleIds: activityConfig.moderatorRoleIds,
    roleGrantRoleIds,
    extraRoleIds: [getModeratorRoleId()],
  });
}

function getAutonomyGuardPrivilegedRoleIds() {
  const activityConfig = ensureActivityState(db).config || {};
  return collectAutonomyGuardProtectedRoleIds({
    protectedRoleId: getModeratorRoleId(),
    activityAdminRoleIds: activityConfig.adminRoleIds,
    activityModeratorRoleIds: activityConfig.moderatorRoleIds,
  });
}

function getAutonomyGuardImportantManagedMessageIds() {
  const verificationState = getVerificationIntegrationState();
  return [...new Set([
    String(getResolvedWelcomePanelSnapshot().messageId || "").trim(),
    String(getResolvedNonGgsPanelSnapshot().messageId || "").trim(),
    String(getResolvedEloSubmitPanelSnapshot().messageId || "").trim(),
    String(getResolvedEloGraphicPanelSnapshot().messageId || "").trim(),
    String(getResolvedLegacyTierlistDashboardSnapshot().messageId || "").trim(),
    String(getResolvedLegacyTierlistSummarySnapshot().messageId || "").trim(),
    String(getResolvedGraphicTierlistBoardSnapshot().messageId || "").trim(),
    String(verificationState.entryMessage?.messageId || "").trim(),
    ...getTextTierlistManagedMessageIds(),
    ...listRoleGrantRecords({ activeOnly: true }).map((record) => String(record?.messageId || "").trim()),
  ].filter(Boolean))];
}

function getAutonomyGuardReviewManagedMessageIds() {
  const reviewMessageIds = [];

  for (const submission of Object.values(db.submissions || {})) {
    const reviewMessageId = String(submission?.reviewMessageId || "").trim();
    if (reviewMessageId) reviewMessageIds.push(reviewMessageId);
  }

  try {
    const legacyEloState = getLiveLegacyEloState();
    if (legacyEloState?.ok) {
      for (const submission of Object.values(legacyEloState.rawDb?.submissions || {})) {
        const reviewMessageId = String(submission?.reviewMessageId || "").trim();
        if (reviewMessageId) reviewMessageIds.push(reviewMessageId);
      }
    }
  } catch {
    // Legacy ELO state can be unavailable during startup or degraded runtime.
  }

  return [...new Set(reviewMessageIds)];
}

function getAutonomyGuardAuditEntryTargetId(entry) {
  return String(entry?.target?.id || entry?.targetId || "").trim();
}

function getAutonomyGuardAuditEntryChannelId(entry) {
  return String(entry?.extra?.channel?.id || entry?.extra?.channelId || "").trim();
}

function getAutonomyGuardAuditChangeRoleIds(entry, changeKey) {
  const change = Array.isArray(entry?.changes)
    ? entry.changes.find((item) => String(item?.key || "").trim() === changeKey)
    : null;
  const collectedRoleIds = [];

  for (const rawValue of [change?.new, change?.old]) {
    if (!Array.isArray(rawValue)) continue;
    for (const item of rawValue) {
      const roleId = String(item?.id || item || "").trim();
      if (roleId) collectedRoleIds.push(roleId);
    }
  }

  return [...new Set(collectedRoleIds)];
}

async function findRecentAutonomyGuardAuditEntry(guild, { type, limit = 6, matcher = null } = {}) {
  if (!guild || typeof matcher !== "function") return null;

  const auditLogs = await guild.fetchAuditLogs({ type, limit }).catch(() => null);
  if (!auditLogs?.entries?.size) return null;

  const now = Date.now();
  for (const entry of auditLogs.entries.values()) {
    if (!entry) continue;
    if (Number.isFinite(entry.createdTimestamp) && now - entry.createdTimestamp > AUTONOMY_GUARD_AUDIT_LOG_LOOKBACK_MS) {
      continue;
    }
    if (matcher(entry)) return entry;
  }

  return null;
}

async function findAutonomyGuardMemberRoleAuditEntry(guild, memberId, roleDiff) {
  const normalizedMemberId = String(memberId || "").trim();
  if (!guild || !normalizedMemberId || !roleDiff?.hasProtectedChanges) return null;

  return findRecentAutonomyGuardAuditEntry(guild, {
    type: AuditLogEvent.MemberRoleUpdate,
    matcher: (entry) => {
      if (getAutonomyGuardAuditEntryTargetId(entry) !== normalizedMemberId) return false;

      const addedRoleIds = getAutonomyGuardAuditChangeRoleIds(entry, "$add");
      const removedRoleIds = getAutonomyGuardAuditChangeRoleIds(entry, "$remove");
      return roleDiff.addedRoleIds.some((roleId) => addedRoleIds.includes(roleId))
        || roleDiff.removedRoleIds.some((roleId) => removedRoleIds.includes(roleId));
    },
  });
}

async function findAutonomyGuardRoleDeleteAuditEntry(guild, roleId) {
  const normalizedRoleId = String(roleId || "").trim();
  if (!guild || !normalizedRoleId) return null;

  return findRecentAutonomyGuardAuditEntry(guild, {
    type: AuditLogEvent.RoleDelete,
    matcher: (entry) => getAutonomyGuardAuditEntryTargetId(entry) === normalizedRoleId,
  });
}

async function findAutonomyGuardMessageDeleteAuditEntry(guild, message) {
  const authorUserId = String(message?.author?.id || "").trim();
  const channelId = String(message?.channelId || "").trim();
  if (!guild || !authorUserId || !channelId) return null;

  return findRecentAutonomyGuardAuditEntry(guild, {
    type: AuditLogEvent.MessageDelete,
    matcher: (entry) => getAutonomyGuardAuditEntryTargetId(entry) === authorUserId
      && getAutonomyGuardAuditEntryChannelId(entry) === channelId,
  });
}

function clearExpiredAutonomyGuardMessageDeleteAuditClaims() {
  const now = Date.now();
  for (const [entryId, claimState] of autonomyGuardMessageDeleteAuditClaims.entries()) {
    if (!entryId || !claimState || !Number.isFinite(claimState.expireAt) || claimState.expireAt <= now || claimState.remaining <= 0) {
      autonomyGuardMessageDeleteAuditClaims.delete(entryId);
    }
  }
}

function claimAutonomyGuardMessageDeleteAuditEntry(entry) {
  const entryId = String(entry?.id || "").trim();
  if (!entryId) return false;

  clearExpiredAutonomyGuardMessageDeleteAuditClaims();

  const existingClaim = autonomyGuardMessageDeleteAuditClaims.get(entryId);
  if (existingClaim) {
    if (existingClaim.remaining <= 0) return false;
    existingClaim.remaining -= 1;
    existingClaim.expireAt = Date.now() + AUTONOMY_GUARD_MESSAGE_DELETE_CLAIM_MS;
    autonomyGuardMessageDeleteAuditClaims.set(entryId, existingClaim);
    return true;
  }

  const totalDeletes = Math.max(1, Number(entry?.extra?.count) || 1);
  autonomyGuardMessageDeleteAuditClaims.set(entryId, {
    remaining: totalDeletes - 1,
    expireAt: Date.now() + AUTONOMY_GUARD_MESSAGE_DELETE_CLAIM_MS,
  });
  return true;
}

async function handleAutonomyGuardDeletedMessage(client, rawMessage) {
  let message = rawMessage;
  if (message?.partial && typeof message.fetch === "function") {
    message = await message.fetch().catch(() => message);
  }

  if (!message || message.guildId !== GUILD_ID) return;

  const targetState = getAutonomyGuardState();
  if (!Array.isArray(targetState.isolatedUserIds) || targetState.isolatedUserIds.length === 0) return;

  const auditEntry = await findAutonomyGuardMessageDeleteAuditEntry(message.guild, message);
  if (!auditEntry || !claimAutonomyGuardMessageDeleteAuditEntry(auditEntry)) return;

  const actorUserId = String(auditEntry?.executor?.id || "").trim();
  if (!actorUserId || !isAutonomyGuardIsolatedUser(db, actorUserId)) return;

  const deletedMessageKind = classifyAutonomyGuardDeletedMessage({
    ownerUserId: getAutonomyGuardPrimaryAdminUserId(),
    authorUserId: message.author?.id,
    authorIsBot: message.author?.bot === true,
    channelId: message.channelId,
    logChannelId: getResolvedChannelId("log"),
    messageId: message.id,
    importantMessageIds: getAutonomyGuardImportantManagedMessageIds(),
    reviewMessageIds: getAutonomyGuardReviewManagedMessageIds(),
  });
  if (!deletedMessageKind) return;

  let decision = resolveAutonomyGuardMessageDeleteDecision(deletedMessageKind, 0);
  if (decision.bucketKey) {
    const warningCount = incrementAutonomyGuardWarningCounter(db, actorUserId, decision.bucketKey);
    decision = resolveAutonomyGuardMessageDeleteDecision(deletedMessageKind, warningCount);
    saveDb();
  }

  if (!decision.shouldStripAdmin) {
    await logLine(
      client,
      `AUTONOMY_MESSAGE_DELETE_WARNING: actor=<@${actorUserId}> kind=${deletedMessageKind} count=${decision.warningCount} remaining=${decision.warningsRemaining} message=${message.id}`
    ).catch(() => {});
    return;
  }

  const stripResult = await stripAutonomyGuardAdminPowerFromUser(client, actorUserId, {
    guildHint: message.guild,
    reason: `autonomy sanction after deleting ${deletedMessageKind} message ${message.id}`,
  });
  if (stripResult.skipped) return;

  const removedRoleText = stripResult.removedRoleIds.length
    ? stripResult.removedRoleIds.map((roleId) => formatRoleMention(roleId)).join(", ")
    : "-";
  await logLine(
    client,
    `AUTONOMY_MESSAGE_DELETE_SANCTION: actor=<@${actorUserId}> kind=${deletedMessageKind} message=${message.id} removed=${removedRoleText}`
  ).catch(() => {});
}

async function applyAutonomyGuardProtectedRoleChanges(client, userId, {
  addRoleIds = [],
  removeRoleIds = [],
  reason = "autonomy protected role revert",
  guildHint = null,
} = {}) {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) {
    return { skipped: true, reason: "missing-user" };
  }

  const guild = guildHint && String(guildHint.id || "").trim()
    ? guildHint
    : await getGuild(client).catch(() => null);
  if (!guild) {
    return { skipped: true, reason: "missing-guild" };
  }

  const member = await guild.members.fetch(normalizedUserId).catch(() => null);
  if (!member) {
    return { skipped: true, reason: "missing-member" };
  }

  const guildRoleIdSet = new Set(guild.roles.cache.map((role) => role.id));
  const desiredAddRoleIds = [...new Set((Array.isArray(addRoleIds) ? addRoleIds : [])
    .map((roleId) => String(roleId || "").trim())
    .filter((roleId) => roleId && guildRoleIdSet.has(roleId) && !member.roles.cache.has(roleId)))];
  const desiredRemoveRoleIds = [...new Set((Array.isArray(removeRoleIds) ? removeRoleIds : [])
    .map((roleId) => String(roleId || "").trim())
    .filter((roleId) => roleId && guildRoleIdSet.has(roleId) && member.roles.cache.has(roleId) && !desiredAddRoleIds.includes(roleId)))];

  if (!desiredAddRoleIds.length && !desiredRemoveRoleIds.length) {
    return { skipped: true, reason: "already-reconciled" };
  }

  markAutonomyGuardProtectedRoleMutationIgnore(normalizedUserId);
  if (desiredAddRoleIds.length) {
    await member.roles.add(desiredAddRoleIds, reason);
  }
  if (desiredRemoveRoleIds.length) {
    await member.roles.remove(desiredRemoveRoleIds, reason);
  }

  return {
    skipped: false,
    addedRoleIds: desiredAddRoleIds,
    removedRoleIds: desiredRemoveRoleIds,
  };
}

async function stripAutonomyGuardAdminPowerFromUser(client, userId, {
  reason = "autonomy admin power strip",
  guildHint = null,
} = {}) {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) {
    return { skipped: true, reason: "missing-user" };
  }

  const guild = guildHint && String(guildHint.id || "").trim()
    ? guildHint
    : await getGuild(client).catch(() => null);
  if (!guild) {
    return { skipped: true, reason: "missing-guild" };
  }

  const member = await guild.members.fetch(normalizedUserId).catch(() => null);
  if (!member) {
    return { skipped: true, reason: "missing-member" };
  }

  const privilegedRoleIdSet = new Set(getAutonomyGuardPrivilegedRoleIds());
  const removableRoleIds = member.roles.cache
    .filter((role) => role
      && role.id !== member.guild.id
      && role.editable
      && (privilegedRoleIdSet.has(role.id) || role.permissions?.has?.(PermissionsBitField.Flags.Administrator)))
    .map((role) => role.id);

  if (!removableRoleIds.length) {
    return { skipped: true, reason: "no-admin-power" };
  }

  markAutonomyGuardProtectedRoleMutationIgnore(normalizedUserId);
  await member.roles.remove(removableRoleIds, reason);
  return {
    skipped: false,
    removedRoleIds: removableRoleIds,
  };
}

async function reconcileAutonomyGuardTargetRole(client, options = {}) {
  const state = getAutonomyGuardState();
  const targetUserId = String(options.targetUserId || state.targetUserId || "").trim();
  const reason = String(options.reason || "autonomy target reconcile").trim() || "autonomy target reconcile";
  if (!targetUserId) {
    return { skipped: true, reason: "missing-target-user" };
  }
  if (!String(state.protectedRole?.name || "").trim()) {
    return { skipped: true, reason: "missing-role-config" };
  }

  const guild = options.guildHint || await getGuild(client).catch(() => null);
  if (!guild) {
    return { skipped: true, reason: "missing-guild" };
  }

  const roleResult = await ensureAutonomyGuardRole(guild, { reason });
  if (roleResult.stateChanged) saveDb();
  await assignAutonomyGuardRoleToUser(client, targetUserId, roleResult.role.id, reason);
  return {
    skipped: false,
    targetUserId,
    roleId: roleResult.role.id,
    stateChanged: roleResult.stateChanged,
  };
}

function hasAdministratorAccess(member) {
  return Boolean(member?.permissions?.has?.(PermissionsBitField.Flags.Administrator));
}

function isModerator(member) {
  if (!member) return false;
  if (hasAdministratorAccess(member)) return true;
  return member.roles?.cache?.has?.(getModeratorRoleId()) || false;
}


let profileOperator = null;
let antiteamOperator = null;

function getProfileOperator() {
  if (profileOperator) return profileOperator;

  profileOperator = createProfileOperator({
    commandName: "профиль",
    guildId: GUILD_ID,

    hasStaffBypass: (member) => isModerator(member),
    getRequesterProfile: (userId) => db.profiles?.[userId] ? getProfile(userId) : null,
    getTargetProfile: (userId) => db.profiles?.[userId] ? getProfile(userId) : null,
    getTargetDisplayName: (userId, profile) => profile ? getProfileDisplayName(userId, profile) : "",
    fetchMember: (userId) => fetchMember(client, userId),
    fetchUser: (userId) => client.users.fetch(userId),
    getPendingSubmissionForUser,
    getLatestSubmissionForUser,
    getApprovedEntries: () => getApprovedTierlistEntries(),
    getRecentKillChangesForUser: (userId) => collectUserRecentKillChangeHistory(
      Object.values(db.submissions || {}),
      userId,
      { limit: 3 }
    ),
    getRecentKillChangeForUser: (userId) => collectRecentKillChanges(Object.values(db.submissions || {}))
      .find((entry) => entry.userId === String(userId || "").trim()) || null,
    getEloProfile: (userId) => getDormantEloProfileSnapshot(db, userId),
    getTierlistProfile: (userId) => getDormantTierlistProfileSnapshot(db, userId),
    getComboGuideState: () => db.comboGuide,
  });

  return profileOperator;
}

function getAntiteamOperator() {
  if (antiteamOperator) return antiteamOperator;

  antiteamOperator = createAntiteamOperator({
    db,
    now: nowIso,
    saveDb,
    runSerializedMutation: runSerializedDbMutation,
    isModerator,
    logError: (...args) => console.error(...args),
    robloxPlaceId: () => getEffectiveRobloxConfig().jjsPlaceId,
    resolveRobloxUserByUsername,
    fetchRobloxFriends: (robloxUserId) => robloxApiClient.fetchUserFriends(robloxUserId),
    fetchRobloxPresences: (robloxUserIds) => robloxApiClient.fetchUserPresences(robloxUserIds),
    getRobloxRuntimeState: () => robloxRuntimeState,
    getProfile: (userId) => db.profiles?.[userId] ? getProfile(userId) : null,
    writeRobloxBinding: (userId, robloxUser, source = "antiteam") => {
      const profile = getProfile(userId);
      return writeCanonicalRobloxBinding(userId, profile, robloxUser, {
        verificationStatus: "verified",
        verifiedAt: nowIso(),
        updatedAt: nowIso(),
        source,
      });
    },
    fetchMember: (userId) => fetchMember(client, userId),
    fetchChannel: async (channelId) => {
      const cachedChannel = client.channels?.cache?.get?.(channelId) || null;
      if (cachedChannel) return cachedChannel;
      return client.channels.fetch(channelId).catch(() => null);
    },
    grantRole: async (userId, roleId, reason) => {
      const member = await fetchMember(client, userId);
      if (!member || !roleId) return { skipped: "missing-member-or-role" };
      if (member.roles?.cache?.has?.(roleId)) return { skipped: "already-has-role", roleId };
      await member.roles.add(roleId, reason);
      return { granted: true, roleId };
    },
    sendDirectMessage: async (userId, payload) => {
      const user = await client.users.fetch(userId).catch(() => null);
      if (!user) return null;
      return user.send(payload);
    },
    logLine: (text) => logLine(client, text),
    replyNoPermission: (interaction) => interaction.reply(ephemeralPayload({ content: "Нет прав." })),
  });

  return antiteamOperator;
}

async function handleAntiteamInteractionSafely(interaction, methodName) {
  try {
    const operator = getAntiteamOperator();
    if (typeof operator?.[methodName] !== "function") return false;
    return await operator[methodName](interaction);
  } catch (error) {
    console.error(`Antiteam interaction failed (${interaction?.customId || interaction?.commandName || methodName}):`, error?.message || error);
    if (!interaction?.deferred && !interaction?.replied && typeof interaction?.reply === "function") {
      await interaction.reply(ephemeralPayload({
        content: "Не удалось обработать антитим-действие. Попробуй ещё раз или попроси модератора обновить панель.",
      })).catch(() => {});
    }
    return true;
  }
}

function hasActivityPanelAccess(member) {
  if (isModerator(member)) return true;
  if (!member) return false;

  const activityConfig = ensureActivityState(db).config || {};
  const accessRoleIds = [...new Set([
    ...(Array.isArray(activityConfig.moderatorRoleIds) ? activityConfig.moderatorRoleIds : []),
    ...(Array.isArray(activityConfig.adminRoleIds) ? activityConfig.adminRoleIds : []),
  ].map((roleId) => String(roleId || "").trim()).filter(Boolean))];

  return accessRoleIds.some((roleId) => member.roles?.cache?.has?.(roleId));
}

function getComboGuideEditorRoleIds(guideState = db.comboGuide) {
  return normalizeComboGuideEditorRoleIds(guideState?.editorRoleIds);
}

function ensureComboGuideAccessState() {
  if (!db.comboGuide || typeof db.comboGuide !== "object") {
    db.comboGuide = { editorRoleIds: [] };
    return db.comboGuide;
  }

  db.comboGuide.editorRoleIds = getComboGuideEditorRoleIds(db.comboGuide);
  return db.comboGuide;
}

function hasComboGuidePanelAccess(member) {
  if (isModerator(member)) return true;
  if (!member) return false;

  return getComboGuideEditorRoleIds().some((roleId) => member.roles?.cache?.has?.(roleId));
}

function buildComboPanelForMember(member, statusText = "") {
  return buildComboPanelPayload(db.comboGuide, statusText, {
    canManage: isModerator(member),
    canEdit: hasComboGuidePanelAccess(member),
  });
}

async function logLine(client, text) {
  const logChannelId = getResolvedChannelId("log");
  if (!logChannelId) return;
  const channel = await client.channels.fetch(logChannelId).catch(() => null);
  if (channel?.isTextBased()) await channel.send(text).catch(() => {});
}

function formatVerificationStateLogToken(state) {
  const normalized = typeof state === "string"
    ? state.trim()
    : state == null
      ? ""
      : String(state).trim();
  if (!normalized) return "missing";
  return normalized.length > 12 ? `${normalized.slice(0, 12)}...` : normalized;
}

async function logVerificationRuntimeEvent(client, text, level = "info") {
  const rendered = `[verification] ${text}`;
  if (level === "error") {
    console.error(rendered);
  } else if (level === "warn") {
    console.warn(rendered);
  } else {
    console.log(rendered);
  }
  await logLine(client, text).catch(() => {});
}

async function dmUser(client, userId, text) {
  const user = await client.users.fetch(userId).catch(() => null);
  if (!user) return;
  await user.send(text).catch(() => {});
}

function hasApprovedTierProfile(userId) {
  const profile = db.profiles?.[userId];
  return Number.isFinite(Number(profile?.approvedKills)) && Number.isFinite(Number(profile?.killTier));
}

function getMissingTierlistText() {
  const base = String(appConfig.reminders?.missingTierlistText || "").trim() || "Враг народа избегает получения роли!!! Не будь врагом!!! Стань товарищем!!!";
  const welcomeChannelId = getResolvedChannelId("welcome");
  return [
    base,
    welcomeChannelId ? `Получить роль и отправить заявку можно тут: <#${welcomeChannelId}>` : "Канал welcome пока не настроен.",
  ].join("\n");
}

function getReminderImagePath(includeFallback = false) {
  const raw = String(appConfig.reminders?.missingTierlistImagePath || "").trim();
  if (raw) return path.isAbsolute(raw) ? raw : path.resolve(PROJECT_ROOT, raw);
  if (includeFallback && fs.existsSync(DEFAULT_REMINDER_POSTER_PATH)) return DEFAULT_REMINDER_POSTER_PATH;
  return "";
}

function buildMissingTierlistReminderPayload() {
  const content = getMissingTierlistText();
  const imageUrl = String(appConfig.reminders?.missingTierlistImageUrl || "").trim();
  const imagePath = getReminderImagePath(false);
  const fallbackImagePath = imagePath ? "" : getReminderImagePath(true);

  if (imagePath && fs.existsSync(imagePath)) {
    const fileName = sanitizeFileName(path.basename(imagePath) || "missing-tierlist-image.png");
    const isSvg = /\.svg$/i.test(fileName);
    const payload = { content, files: [new AttachmentBuilder(imagePath, { name: fileName })] };
    if (!isSvg) {
      payload.embeds = [new EmbedBuilder().setImage(`attachment://${fileName}`)];
    }
    return payload;
  }

  if (imageUrl) {
    return {
      content,
      embeds: [new EmbedBuilder().setImage(imageUrl)],
    };
  }

  if (fallbackImagePath && fs.existsSync(fallbackImagePath)) {
    const fileName = sanitizeFileName(path.basename(fallbackImagePath) || "missing-tierlist-image.png");
    const isSvg = /\.svg$/i.test(fileName);
    const payload = { content, files: [new AttachmentBuilder(fallbackImagePath, { name: fileName })] };
    if (!isSvg) {
      payload.embeds = [new EmbedBuilder().setImage(`attachment://${fileName}`)];
    }
    return payload;
  }

  return { content };
}

async function getMembersMissingTierlist(client) {
  const guild = await getGuild(client);
  if (!guild) return [];

  await guild.members.fetch();
  const tierRoleIds = new Set(getAllTierRoleIds());

  return guild.members.cache.filter((member) => {
    if (member.user.bot) return false;
    if (!memberHasManagedStartAccessRole(member)) return false;
    for (const roleId of tierRoleIds) {
      if (member.roles.cache.has(roleId)) return false;
    }
    return true;
  });
}

async function sendMissingTierlistReminder(client) {
  const members = await getMembersMissingTierlist(client);
  const payload = buildMissingTierlistReminderPayload();

  let sent = 0;
  let failed = 0;
  for (const member of members.values()) {
    try {
      await member.send(payload);
      sent += 1;
    } catch {
      failed += 1;
    }
  }

  await logLine(client, `REMIND_MISSING_TIERLIST: sent=${sent}, failed=${failed}, total=${members.size}`);
  return { total: members.size, sent, failed };
}

async function fetchMember(client, userId) {
  const guild = await getGuild(client);
  if (!guild) return null;
  return guild.members.fetch(userId).catch(() => null);
}

async function syncProfileNamesFromDiscord(client) {
  const guild = await getGuild(client);
  if (!guild) return 0;
  const userIds = Object.keys(db.profiles || {});
  if (!userIds.length) return 0;
  let updated = 0;
  await Promise.all(
    userIds.map(async (userId) => {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) return;
      const profile = db.profiles[userId];
      if (!profile) return;
      const newDisplayName = member.displayName || member.user.username;
      const newUsername = member.user.username;
      if (profile.displayName !== newDisplayName || profile.username !== newUsername) {
        profile.displayName = newDisplayName;
        profile.username = newUsername;
        updated++;
      }
    })
  );
  if (updated > 0) saveDb();
  return updated;
}

function profileNeedsRobloxNicknameMarker(profile) {
  const approvedKills = Number(profile?.approvedKills);
  const robloxState = profile?.domains?.roblox || {};
  const hasVerifiedRoblox = robloxState.verificationStatus === "verified" && Boolean(robloxState.userId);
  return Number.isSafeInteger(approvedKills) && approvedKills >= 0 && !hasVerifiedRoblox;
}

function stripRobloxNicknameMarker(value) {
  return String(value || "").replace(/\s*❌$/, "").trimEnd();
}

function buildRobloxNicknameWithMarker(value) {
  const marker = " ❌";
  const baseName = stripRobloxNicknameMarker(value) || "Игрок";
  const maxBaseLength = Math.max(1, 32 - marker.length);
  return `${baseName.slice(0, maxBaseLength).trimEnd()}${marker}`;
}

async function syncRobloxNicknameMarkerForUser(client, userId, reason = "roblox nickname marker sync") {
  const member = await fetchMember(client, userId);
  if (!member) return { updated: false, skipped: "member_missing" };
  if (!member.manageable) return { updated: false, skipped: "member_not_manageable" };

  const fallbackName = String(member.user?.globalName || member.user?.username || "").trim();
  const currentNickname = String(member.nickname || "").trim();
  const shouldMark = isRobloxNicknameMarkerEnabled() && profileNeedsRobloxNicknameMarker(db.profiles?.[userId]);

  if (shouldMark) {
    const targetNickname = buildRobloxNicknameWithMarker(currentNickname || fallbackName);
    if (currentNickname === targetNickname) {
      return { updated: false, marked: true, skipped: "already_marked" };
    }
    await member.setNickname(targetNickname, reason);
    return { updated: true, marked: true, nickname: targetNickname };
  }

  if (!currentNickname) {
    return { updated: false, marked: false, skipped: "no_custom_nickname" };
  }

  const strippedNickname = stripRobloxNicknameMarker(currentNickname);
  if (strippedNickname === currentNickname) {
    return { updated: false, marked: false, skipped: "marker_not_present" };
  }

  const nextNickname = strippedNickname && strippedNickname !== fallbackName ? strippedNickname : null;
  await member.setNickname(nextNickname, reason);
  return { updated: true, marked: false, nickname: nextNickname || "" };
}

async function syncRobloxNicknameMarkers(client, options = {}) {
  const targetUserId = String(options.targetUserId || "").trim();
  const reason = String(options.reason || "roblox nickname marker sync").trim() || "roblox nickname marker sync";

  if (targetUserId) {
    try {
      const result = await syncRobloxNicknameMarkerForUser(client, targetUserId, reason);
      return {
        processed: 1,
        updated: result.updated ? 1 : 0,
        skipped: result.updated ? 0 : 1,
        errors: 0,
      };
    } catch (error) {
      return { processed: 1, updated: 0, skipped: 0, errors: 1, error };
    }
  }

  const userIds = Object.keys(db.profiles || {});
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const userId of userIds) {
    try {
      const result = await syncRobloxNicknameMarkerForUser(client, userId, reason);
      if (result.updated) updated += 1;
      else skipped += 1;
    } catch {
      errors += 1;
    }
  }

  return {
    processed: userIds.length,
    updated,
    skipped,
    errors,
  };
}

async function syncManagedCharacterRoles(member, selectedCharacterIds, reason = "main character sync") {
  const selectedEntries = getSelectedCharacterEntries(selectedCharacterIds);
  return syncMemberCharacterRoles({
    member,
    selectedEntries,
    allManagedRoleIds: getCharacterRoleIds(),
    reason,
  });
}

function getTierRoleId(tier) {
  return getSotKillTierRole(tier, { db, appConfig })?.value || "";
}

function getAllTierRoleIds() {
  return [1, 2, 3, 4, 5].map((tier) => getTierRoleId(tier)).filter(Boolean);
}

function getLegacyEloTierRoleId(tier) {
  return getSotLegacyEloTierRole(tier, { db, appConfig })?.value || "";
}

function getAllLegacyEloTierRoleIds() {
  return [1, 2, 3, 4, 5].map((tier) => getLegacyEloTierRoleId(tier)).filter(Boolean);
}

function getNormalAccessRoleId() {
  return getSotRole("accessNormal", { db, appConfig })?.value || "";
}

function getWartimeAccessRoleId() {
  return getSotRole("accessWartime", { db, appConfig })?.value || "";
}

function getNonJjsAccessRoleId() {
  return getSotRole("accessNonJjs", { db, appConfig })?.value || "";
}

function getVerifyAccessRoleId() {
  return getSotRole("verifyAccess", { db, appConfig })?.value || "";
}

function getModeratorRoleId() {
  return getSotRole("moderator", { db, appConfig })?.value || "";
}

function getOnboardModeState() {
  db.config.onboardMode = createOnboardModeState(db.config.onboardMode);
  return db.config.onboardMode;
}

function getOnboardAccessGrantState() {
  db.config.accessGrant = createOnboardAccessGrantState(db.config.accessGrant);
  return db.config.accessGrant;
}

function getCurrentOnboardMode() {
  return getOnboardModeState().mode;
}

function getCurrentOnboardAccessGrantMode() {
  return getOnboardAccessGrantState().mode;
}

function getOnboardAccessGrantModeRank(value) {
  const normalized = normalizeOnboardAccessGrantMode(value);
  if (normalized === ONBOARD_ACCESS_GRANT_MODES.AFTER_REVIEW_POST) return 2;
  if (normalized === ONBOARD_ACCESS_GRANT_MODES.AFTER_APPROVE) return 3;
  return 1;
}

function shouldGrantAccessRoleAtStage(stage, mode = getCurrentOnboardAccessGrantMode()) {
  return getOnboardAccessGrantModeRank(stage) >= getOnboardAccessGrantModeRank(mode);
}

function getRobloxNicknameMarkerState() {
  const rawState = db.config?.robloxNicknameMarker;
  const source = rawState && typeof rawState === "object" ? rawState : {};
  db.config.robloxNicknameMarker = {
    enabled: source.enabled === true,
    changedAt: String(source.changedAt || "").trim() || null,
    changedBy: String(source.changedBy || "").trim(),
  };
  return db.config.robloxNicknameMarker;
}

function isRobloxNicknameMarkerEnabled() {
  return getRobloxNicknameMarkerState().enabled === true;
}

function getManagedStartAccessRoleIds() {
  return [...new Set([getNormalAccessRoleId(), getWartimeAccessRoleId()].filter(Boolean))];
}

function getVerificationQuarantineRoleIds() {
  return [...new Set([
    ...getManagedStartAccessRoleIds(),
    getNonJjsAccessRoleId(),
  ].filter(Boolean))];
}

function getGrantedAccessRoleIdForMode(mode = getCurrentOnboardMode()) {
  const member = arguments.length > 1 ? arguments[1] : null;
  return resolveGrantedAccessRoleId({
    mode,
    normalAccessRoleId: getNormalAccessRoleId(),
    wartimeAccessRoleId: getWartimeAccessRoleId(),
    heldRoleIds: member?.roles?.cache ? [...member.roles.cache.keys()] : [],
  });
}

function memberHasManagedStartAccessRole(member) {
  if (!member?.roles?.cache) return false;
  return getManagedStartAccessRoleIds().some((roleId) => roleId && member.roles.cache.has(roleId));
}

function getOnboardModeValidationError(mode = getCurrentOnboardMode()) {
  const normalizedMode = normalizeOnboardAccessMode(mode);
  if (!getNormalAccessRoleId()) return "roles.accessRoleId не заполнен.";
  if (normalizedMode === ONBOARD_ACCESS_MODES.WARTIME && !getWartimeAccessRoleId()) {
    return "roles.wartimeAccessRoleId не заполнен для военного режима.";
  }
  return "";
}

function formatRoleMention(roleId) {
  return roleId ? `<@&${roleId}>` : "не настроена";
}

function cleanVerificationText(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function normalizeVerificationTextArray(value, limit = 100, itemLimit = 120) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => cleanVerificationText(entry, itemLimit)).filter(Boolean))]
    .slice(0, Math.max(0, Number(limit) || 0));
}

function buildVerificationOauthUsername(oauthUser = {}) {
  const username = cleanVerificationText(oauthUser.username || oauthUser.global_name, 120);
  const discriminator = cleanVerificationText(oauthUser.discriminator, 10);
  if (!username) return "";
  if (discriminator && discriminator !== "0") {
    return `${username}#${discriminator}`;
  }
  return username;
}

function getVerificationIntegrationState() {
  return getSotIntegration("verification", { db, appConfig }) || {};
}

function getVerificationPendingDays() {
  return Math.max(1, Number(getVerificationIntegrationState().deadline?.pendingDays) || 7);
}

function getVerificationRiskRules() {
  const riskRules = getVerificationIntegrationState().riskRules;
  return riskRules && typeof riskRules === "object" && !Array.isArray(riskRules)
    ? cloneJsonValue(riskRules)
    : {};
}

function isVerificationEnabled() {
  return getVerificationIntegrationState().enabled === true;
}

function isVerificationActiveStatus(value) {
  return ["pending", "manual_review", "failed"].includes(cleanVerificationText(value, 40));
}

function getVerificationProfileState(profile = {}) {
  return profile.summary?.verification && typeof profile.summary.verification === "object"
    ? profile.summary.verification
    : profile.domains?.verification && typeof profile.domains.verification === "object"
      ? profile.domains.verification
      : {};
}

function normalizeVerificationObservedGuilds(value = []) {
  if (!Array.isArray(value)) return [];
  const normalized = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const id = cleanVerificationText(entry.id, 80);
    if (!id) continue;
    normalized.push({
      id,
      name: cleanVerificationText(entry.name, 120),
      owner: entry.owner === true,
      permissions: cleanVerificationText(entry.permissions, 40),
    });
    if (normalized.length >= 20) break;
  }
  return normalized;
}

function clearExpiredVerificationRoleMutationIgnores() {
  const now = Date.now();
  for (const [userId, expireAt] of verificationRoleMutationIgnores.entries()) {
    if (!userId || !Number.isFinite(expireAt) || expireAt <= now) {
      verificationRoleMutationIgnores.delete(userId);
    }
  }
}

function markVerificationRoleMutationIgnore(userId, ttlMs = VERIFICATION_ROLE_MUTATION_IGNORE_MS) {
  const normalizedUserId = cleanVerificationText(userId, 80);
  if (!normalizedUserId) return;
  clearExpiredVerificationRoleMutationIgnores();
  verificationRoleMutationIgnores.set(normalizedUserId, Date.now() + Math.max(1000, Number(ttlMs) || VERIFICATION_ROLE_MUTATION_IGNORE_MS));
}

function shouldIgnoreVerificationRoleMutation(userId) {
  const normalizedUserId = cleanVerificationText(userId, 80);
  if (!normalizedUserId) return false;
  clearExpiredVerificationRoleMutationIgnores();
  return verificationRoleMutationIgnores.has(normalizedUserId);
}

function clearVerificationRoleMutationIgnore(userId) {
  const normalizedUserId = cleanVerificationText(userId, 80);
  if (!normalizedUserId) return;
  verificationRoleMutationIgnores.delete(normalizedUserId);
}

function clearExpiredAutonomyGuardRoleMutationIgnores() {
  const now = Date.now();
  for (const [userId, expireAt] of autonomyGuardRoleMutationIgnores.entries()) {
    if (!userId || !Number.isFinite(expireAt) || expireAt <= now) {
      autonomyGuardRoleMutationIgnores.delete(userId);
    }
  }
}

function markAutonomyGuardRoleMutationIgnore(userId, ttlMs = AUTONOMY_GUARD_ROLE_MUTATION_IGNORE_MS) {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) return;
  clearExpiredAutonomyGuardRoleMutationIgnores();
  autonomyGuardRoleMutationIgnores.set(normalizedUserId, Date.now() + Math.max(1000, Number(ttlMs) || AUTONOMY_GUARD_ROLE_MUTATION_IGNORE_MS));
}

function shouldIgnoreAutonomyGuardRoleMutation(userId) {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) return false;
  clearExpiredAutonomyGuardRoleMutationIgnores();
  return autonomyGuardRoleMutationIgnores.has(normalizedUserId);
}

function clearAutonomyGuardRoleMutationIgnore(userId) {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) return;
  autonomyGuardRoleMutationIgnores.delete(normalizedUserId);
}

function clearExpiredAutonomyGuardProtectedRoleMutationIgnores() {
  const now = Date.now();
  for (const [userId, expireAt] of autonomyGuardProtectedRoleMutationIgnores.entries()) {
    if (!userId || !Number.isFinite(expireAt) || expireAt <= now) {
      autonomyGuardProtectedRoleMutationIgnores.delete(userId);
    }
  }
}

function markAutonomyGuardProtectedRoleMutationIgnore(userId, ttlMs = AUTONOMY_GUARD_ROLE_MUTATION_IGNORE_MS) {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) return;
  clearExpiredAutonomyGuardProtectedRoleMutationIgnores();
  autonomyGuardProtectedRoleMutationIgnores.set(normalizedUserId, Date.now() + Math.max(1000, Number(ttlMs) || AUTONOMY_GUARD_ROLE_MUTATION_IGNORE_MS));
}

function shouldIgnoreAutonomyGuardProtectedRoleMutation(userId) {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) return false;
  clearExpiredAutonomyGuardProtectedRoleMutationIgnores();
  return autonomyGuardProtectedRoleMutationIgnores.has(normalizedUserId);
}

function clearAutonomyGuardProtectedRoleMutationIgnore(userId) {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) return;
  autonomyGuardProtectedRoleMutationIgnores.delete(normalizedUserId);
}

function computeVerificationReportDueAt(fromIso = nowIso()) {
  const date = new Date(fromIso);
  if (!Number.isFinite(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + getVerificationPendingDays());
  return date.toISOString();
}

function isVerificationOauthConfigured() {
  const runtimeConfig = normalizeVerificationRuntimeConfig({
    integration: getVerificationIntegrationState(),
    env: process.env,
  });
  return Boolean(runtimeConfig.clientId && runtimeConfig.clientSecret && runtimeConfig.redirectUri);
}

function updateVerificationProfile(userId, patch = {}, options = {}) {
  const profile = getProfile(userId);
  profile.domains = profile.domains && typeof profile.domains === "object" && !Array.isArray(profile.domains)
    ? profile.domains
    : {};
  const current = profile.domains.verification && typeof profile.domains.verification === "object" && !Array.isArray(profile.domains.verification)
    ? profile.domains.verification
    : {};
  profile.domains.verification = {
    ...current,
    ...cloneJsonValue(patch),
  };
  profile.updatedAt = nowIso();
  const finalized = finalizeStoredProfile(userId);
  if (options.save !== false) saveDb();
  return finalized;
}

function ensureVerificationPendingProfile(userId, patch = {}, options = {}) {
  const currentProfile = getProfile(userId);
  const current = currentProfile.domains?.verification && typeof currentProfile.domains.verification === "object"
    ? currentProfile.domains.verification
    : {};
  const assignedAt = cleanVerificationText(current.assignedAt, 80) || nowIso();
  const reportDueAt = cleanVerificationText(current.reportDueAt, 80) || computeVerificationReportDueAt(assignedAt);

  return updateVerificationProfile(userId, {
    status: ["verified", "rejected", "manual_review", "failed", "pending"].includes(current.status) ? current.status : "pending",
    decision: ["approved", "rejected", "manual_review"].includes(current.decision) ? current.decision : "none",
    assignedAt,
    reportDueAt,
    ...patch,
  }, options);
}

function stopVerificationCycle(userId, reason = "verify role removed", options = {}) {
  const profile = finalizeStoredProfile(userId);
  const verification = getVerificationProfileState(profile);
  const status = cleanVerificationText(verification.status, 40);
  if (!isVerificationActiveStatus(status)) {
    return { updated: false, status };
  }

  const stopReason = cleanVerificationText(reason, 200) || "verify role removed";
  const stoppedAt = nowIso();
  const nextProfile = updateVerificationProfile(userId, {
    status: "not_started",
    decision: "none",
    assignedAt: "",
    startedAt: "",
    reportDueAt: "",
    reportSentAt: "",
    completedAt: "",
    reviewedAt: "",
    reviewedBy: "",
    decisionReason: stopReason,
    lastError: "",
    oauthUserId: "",
    oauthUsername: "",
    oauthAvatarUrl: "",
    observedGuilds: [],
    observedGuildIds: [],
    observedGuildNames: [],
    matchedEnemyGuildIds: [],
    matchedEnemyUserIds: [],
    matchedEnemyInviteCodes: [],
    matchedEnemyInviterUserIds: [],
    stoppedAt,
    stopReason,
  }, options);

  return { updated: true, profile: nextProfile, status, stoppedAt, reason: stopReason };
}

async function reconcileVerificationAssignmentForMember(client, userId, member = null, options = {}) {
  const profile = finalizeStoredProfile(userId);
  const verification = getVerificationProfileState(profile);
  const status = cleanVerificationText(verification.status, 40);
  if (!isVerificationActiveStatus(status)) {
    return { userId, active: false, stopped: false, status };
  }

  const verifyRoleId = cleanVerificationText(getVerifyAccessRoleId(), 80);
  if (!verifyRoleId) {
    const stopResult = stopVerificationCycle(userId, cleanVerificationText(options.reason, 200) || "verify role is not configured anymore");
    return { userId, active: true, stopped: stopResult.updated === true, status };
  }

  const resolvedMember = member || await fetchMember(client, userId);
  if (resolvedMember?.roles?.cache?.has(verifyRoleId)) {
    return { userId, active: true, stopped: false, status };
  }

  const stopResult = stopVerificationCycle(userId, cleanVerificationText(options.reason, 200) || "verify role removed manually");
  return { userId, active: true, stopped: stopResult.updated === true, status };
}

async function reconcileVerificationAssignments(client, options = {}) {
  let checked = 0;
  let stopped = 0;

  for (const userId of Object.keys(db.profiles || {})) {
    const result = await reconcileVerificationAssignmentForMember(client, userId, null, options);
    if (!result.active) continue;
    checked += 1;
    if (result.stopped) stopped += 1;
  }

  return { checked, stopped };
}

async function grantVerifyAccessRole(client, userId, reason = "verification assigned") {
  const verifyRoleId = cleanVerificationText(getVerifyAccessRoleId(), 80);
  if (!verifyRoleId) {
    throw new Error("Не настроена verify-роль. Укажи её через панель проверки.");
  }

  const member = await fetchMember(client, userId);
  if (!member) {
    throw new Error("Участник не найден на сервере. Выдать verify-роль не удалось.");
  }

  if (member.roles.cache.has(verifyRoleId)) {
    return { granted: false, roleId: verifyRoleId, member };
  }

  try {
    await member.roles.add(verifyRoleId, reason);
  } catch (error) {
    throw new Error(`Не удалось выдать verify-роль ${verifyRoleId} пользователю ${userId}: ${formatRuntimeError(error)}`);
  }

  return { granted: true, roleId: verifyRoleId, member };
}

async function stripManagedStartAccessRolesForVerification(client, userId, member = null, reason = "verification assigned") {
  const resolvedMember = member || await fetchMember(client, userId);
  if (!resolvedMember) {
    throw new Error("Участник не найден на сервере. Снять стартовый доступ перед verification не удалось.");
  }

  const accessRoleIds = getVerificationQuarantineRoleIds();
  const previousAccessRoleIds = getRolePoolSnapshot(resolvedMember, accessRoleIds);
  if (!previousAccessRoleIds.length) {
    return { member: resolvedMember, removedRoleIds: [] };
  }

  try {
    for (const roleId of previousAccessRoleIds) {
      if (!resolvedMember.roles.cache.has(roleId)) continue;
      await resolvedMember.roles.remove(roleId, reason);
    }
  } catch (error) {
    await restoreRolePoolSnapshot(client, userId, accessRoleIds, previousAccessRoleIds, `${reason} rollback`);
    throw new Error(`Не удалось снять стартовый доступ перед verification для ${userId}: ${formatRuntimeError(error)}`);
  }

  return { member: resolvedMember, removedRoleIds: previousAccessRoleIds };
}

async function assignUserToVerification(client, userId, options = {}) {
  const assignmentReason = cleanVerificationText(options.reason, 200) || "verification moderator assign";
  const assignedBy = cleanVerificationText(options.assignedBy, 120);
  const assignmentNote = cleanVerificationText(options.note, 500);
  const assignedAt = nowIso();
  const roleResult = await grantVerifyAccessRole(client, userId, assignmentReason);
  try {
    await stripManagedStartAccessRolesForVerification(client, userId, roleResult.member, `${assignmentReason} quarantine`);
  } catch (error) {
    if (roleResult.granted && roleResult.member?.roles?.cache?.has(roleResult.roleId)) {
      markVerificationRoleMutationIgnore(userId);
      await roleResult.member.roles.remove(roleResult.roleId, `${assignmentReason} rollback`).catch(() => {});
    }
    throw error;
  }
  const reportDueAt = computeVerificationReportDueAt(assignedAt);
  const profile = ensureVerificationPendingProfile(userId, {
    status: "pending",
    decision: "none",
    assignedAt,
    startedAt: assignedAt,
    reportDueAt,
    reportSentAt: "",
    completedAt: "",
    reviewedAt: "",
    reviewedBy: "",
    decisionReason: "",
    lastError: "",
    assignedBy,
    assignmentNote,
    stoppedAt: "",
    stopReason: "",
    oauthUserId: "",
    oauthUsername: "",
    oauthAvatarUrl: "",
    observedGuilds: [],
    observedGuildIds: [],
    observedGuildNames: [],
    matchedEnemyGuildIds: [],
    matchedEnemyUserIds: [],
    matchedEnemyInviteCodes: [],
    matchedEnemyInviterUserIds: [],
  });

  const verificationChannelId = cleanVerificationText(getVerificationIntegrationState().verificationChannelId, 80);
  let entryMessageEnsured = false;
  let entryMessageWarning = "";
  if (verificationChannelId) {
    try {
      await ensureVerificationEntryMessage(client);
      entryMessageEnsured = true;
    } catch (error) {
      entryMessageWarning = cleanVerificationText(error?.message || error, 300);
    }
  }

  return {
    roleResult,
    profile,
    verificationChannelId,
    reportDueAt: cleanVerificationText(profile.domains?.verification?.reportDueAt, 80) || reportDueAt,
    entryMessageEnsured,
    entryMessageWarning,
  };
}

function buildVerificationStatusText(userId) {
  const profile = finalizeStoredProfile(userId);
  const verification = profile.summary?.verification && typeof profile.summary.verification === "object"
    ? profile.summary.verification
    : profile.domains?.verification && typeof profile.domains.verification === "object"
      ? profile.domains.verification
      : {};
  const status = cleanVerificationText(verification.status, 40) || "not_started";
  const reportDueAt = cleanVerificationText(verification.reportDueAt, 80);
  const reviewedAt = cleanVerificationText(verification.reviewedAt, 80);
  const lastError = cleanVerificationText(verification.lastError, 300);
  const verificationChannelId = cleanVerificationText(getVerificationIntegrationState().verificationChannelId, 80);

  if (status === "verified") {
    return "Статус: verified. Доступ выдан или будет выдан после sync роли.";
  }
  if (status === "manual_review") {
    return `Статус: manual review. Кейс уже ушёл модераторам${reportDueAt ? `, дедлайн был ${formatDateTime(reportDueAt)}` : ""}.`;
  }
  if (status === "rejected") {
    return `Статус: rejected${reviewedAt ? ` (${formatDateTime(reviewedAt)})` : ""}. Доступ не будет выдан.`;
  }
  if (status === "failed") {
    return `Статус: failed. ${lastError || "Последняя попытка OAuth завершилась ошибкой."}`;
  }
  if (status === "pending") {
    return `Статус: pending${reportDueAt ? `. Если кейс зависнет, escalation уйдёт модераторам после ${formatDateTime(reportDueAt)}` : ""}.`;
  }
  return verificationChannelId
    ? `Статус: not started. Открой ${formatChannelMention(verificationChannelId)} и нажми кнопку OAuth.`
    : "Статус: not started. Verification room пока не настроен.";
}

function clearExpiredVerificationOauthStates() {
  const now = Date.now();
  for (const [state, session] of verificationOauthStates.entries()) {
    if (!session || now - Number(session.createdAt) > VERIFICATION_OAUTH_STATE_EXPIRE_MS) {
      verificationOauthStates.delete(state);
    }
  }
}

function createVerificationOauthState(userId) {
  const normalizedUserId = cleanVerificationText(userId, 80);
  clearExpiredVerificationOauthStates();
  const state = `${normalizedUserId}.${crypto.randomUUID()}`;
  verificationOauthStates.set(state, {
    userId: normalizedUserId,
    createdAt: Date.now(),
    riskRules: getVerificationRiskRules(),
  });
  return state;
}

function consumeVerificationOauthState(state) {
  clearExpiredVerificationOauthStates();
  const normalizedState = cleanVerificationText(state, 200);
  if (!normalizedState) return null;
  const session = verificationOauthStates.get(normalizedState);
  verificationOauthStates.delete(normalizedState);
  if (!session || Date.now() - Number(session.createdAt) > VERIFICATION_OAUTH_STATE_EXPIRE_MS) {
    return null;
  }
  return cloneJsonValue(session);
}

function buildVerificationPanelSnapshot() {
  const integration = getVerificationIntegrationState();
  const snapshot = {
    totals: {
      pending: 0,
      manualReview: 0,
      failed: 0,
      overdue: 0,
      verified: 0,
      rejected: 0,
      blocked: 0,
      reportSent: 0,
      totalProfiles: 0,
    },
    queueEntries: [],
    issues: [],
    runtime: {
      callbackReady: Boolean(verificationCallbackServer?.isListening?.()),
      joinGateReady: Boolean(getVerifyAccessRoleId() && integration.verificationChannelId),
      entryMessagePublished: Boolean(integration.entryMessage?.messageId),
      reportChannelReady: Boolean(integration.reportChannelId),
      verificationRoomReady: Boolean(integration.verificationChannelId),
      verifyRoleReady: Boolean(getVerifyAccessRoleId()),
      lastSweepAt: cleanVerificationText(integration.lastSyncAt, 80),
      lastReportSentAt: "",
      entryMessageChannelId: cleanVerificationText(integration.entryMessage?.channelId || integration.verificationChannelId, 80),
      entryMessageId: cleanVerificationText(integration.entryMessage?.messageId, 80),
    },
  };

  if (integration.enabled !== true) snapshot.issues.push("verification disabled in config");
  if (!isVerificationOauthConfigured()) snapshot.issues.push("OAuth env is not configured");
  if (!getVerifyAccessRoleId()) snapshot.issues.push("verify-role is missing");
  if (!integration.verificationChannelId) snapshot.issues.push("verification room is missing");
  if (!integration.reportChannelId) snapshot.issues.push("report channel is missing");

  for (const userId of Object.keys(db.profiles || {})) {
    const profile = finalizeStoredProfile(userId);
    const verification = profile.summary?.verification && typeof profile.summary.verification === "object"
      ? profile.summary.verification
      : profile.domains?.verification && typeof profile.domains.verification === "object"
        ? profile.domains.verification
        : null;
    if (!verification) continue;

    snapshot.totals.totalProfiles += 1;
    const status = cleanVerificationText(verification.status, 40) || "not_started";
    const reportDueAt = cleanVerificationText(verification.reportDueAt, 80);
    const reportSentAt = cleanVerificationText(verification.reportSentAt, 80);
    const oauthUsername = cleanVerificationText(verification.oauthUsername, 120) || `<@${userId}>`;
    const isOverdue = reportDueAt && Number.isFinite(Date.parse(reportDueAt)) && Date.parse(reportDueAt) <= Date.now() && !reportSentAt;

    if (status === "pending") snapshot.totals.pending += 1;
    if (status === "manual_review") snapshot.totals.manualReview += 1;
    if (status === "failed") snapshot.totals.failed += 1;
    if (status === "verified") snapshot.totals.verified += 1;
    if (status === "rejected") snapshot.totals.rejected += 1;
    if (["pending", "manual_review", "failed"].includes(status)) snapshot.totals.blocked += 1;
    if (reportSentAt) {
      snapshot.totals.reportSent += 1;
      if (!snapshot.runtime.lastReportSentAt || Date.parse(reportSentAt) > Date.parse(snapshot.runtime.lastReportSentAt)) {
        snapshot.runtime.lastReportSentAt = reportSentAt;
      }
    }
    if (isOverdue) snapshot.totals.overdue += 1;

    if (["pending", "manual_review", "failed"].includes(status) || isOverdue) {
      snapshot.queueEntries.push([
        `<@${userId}>`,
        oauthUsername,
        status,
        reportDueAt ? `due ${formatDateTime(reportDueAt)}` : "due —",
        reportSentAt ? "report sent" : isOverdue ? "overdue" : "waiting",
      ].join(" • "));
    }
  }

  snapshot.queueEntries = snapshot.queueEntries.slice(0, 8);
  return snapshot;
}

async function resolveVerificationReportChannel(client) {
  const channelId = cleanVerificationText(getVerificationIntegrationState().reportChannelId, 80);
  if (!channelId) {
    throw new Error("verification.reportChannelId не настроен.");
  }
  const guild = await getGuild(client).catch(() => null);
  if (!guild) {
    throw new Error("Не удалось получить guild для verification report channel.");
  }

  await guild.channels.fetch().catch(() => null);
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || typeof channel.send !== "function") {
    throw new Error("verification.reportChannelId не указывает на текстовый канал.");
  }
  return channel;
}

function buildVerificationAuditMarkdown(userId, profile = {}, statusNote = "") {
  const verification = profile.domains?.verification && typeof profile.domains.verification === "object"
    ? profile.domains.verification
    : {};
  const verificationSummary = profile.summary?.verification && typeof profile.summary.verification === "object"
    ? profile.summary.verification
    : {};
  const roblox = profile.domains?.roblox && typeof profile.domains.roblox === "object"
    ? profile.domains.roblox
    : {};
  const robloxSummary = profile.summary?.roblox && typeof profile.summary.roblox === "object"
    ? profile.summary.roblox
    : {};
  const observedGuilds = normalizeVerificationObservedGuilds(verification.observedGuilds);
  const serverFriendIds = Array.isArray(robloxSummary.serverFriendsUserIds) ? robloxSummary.serverFriendsUserIds : [];
  const topCoPlayPeers = Array.isArray(robloxSummary.topCoPlayPeers) ? robloxSummary.topCoPlayPeers : [];
  const usernameHistory = Array.isArray(roblox.usernameHistory) ? roblox.usernameHistory : [];
  const displayNameHistory = Array.isArray(roblox.displayNameHistory) ? roblox.displayNameHistory : [];
  const lines = [
    "# Verification audit",
    "",
    `Сформировано: ${formatDateTime(nowIso())}`,
    `Discord ID: ${cleanVerificationText(userId, 80) || "—"}`,
    `Discord display: ${cleanVerificationText(profile.displayName || profile.username, 200) || "—"}`,
  ];

  if (statusNote) {
    lines.push(`Комментарий: ${cleanVerificationText(statusNote, 500)}`);
  }

  lines.push(
    "",
    "## Состояние проверки",
    `- Статус: ${cleanVerificationText(verification.status, 40) || "—"}`,
    `- Решение: ${cleanVerificationText(verification.decision, 40) || "—"}`,
    `- Причина решения: ${cleanVerificationText(verification.decisionReason, 120) || "—"}`,
    `- Назначена: ${formatDateTime(verification.assignedAt)}`,
    `- OAuth завершён: ${formatDateTime(verification.completedAt)}`,
    `- Дедлайн отчёта: ${formatDateTime(verification.reportDueAt)}`,
    `- Отчёт отправлен: ${formatDateTime(verification.reportSentAt)}`,
    `- Последний reviewer: ${cleanVerificationText(verification.reviewedBy, 120) || "—"}`,
    `- Ошибка: ${cleanVerificationText(verification.lastError, 400) || "—"}`,
    "",
    "## Discord OAuth",
    `- OAuth аккаунт: ${cleanVerificationText(verification.oauthUsername || verificationSummary.oauthUsername, 120) || "—"}`,
    `- OAuth user ID: ${cleanVerificationText(verification.oauthUserId || verificationSummary.oauthUserId, 80) || "—"}`,
    `- Замечено серверов: ${Number(verificationSummary.observedGuildCount) || observedGuilds.length || 0}`,
    `- Совпадения по серверам: ${Number(verificationSummary.matchedEnemyGuildCount) || 0}`,
    `- Совпадения по пользователям: ${Number(verificationSummary.matchedEnemyUserCount) || 0}`,
    `- Совпадения по invite: ${Number(verificationSummary.matchedEnemyInviteCount) || 0}`,
    `- Совпадения по inviter: ${Number(verificationSummary.matchedEnemyInviterCount) || 0}`,
    "",
    "### Замеченные серверы OAuth",
  );

  if (observedGuilds.length) {
    for (const [index, entry] of observedGuilds.entries()) {
      lines.push(`${index + 1}. ${cleanVerificationText(entry.name, 120) || "Без названия"} | ID ${cleanVerificationText(entry.id, 80) || "—"} | owner ${entry.owner === true ? "yes" : "no"} | perm ${cleanVerificationText(entry.permissions, 40) || "—"}`);
    }
  } else {
    lines.push("- Discord OAuth не вернул список серверов.");
  }

  lines.push(
    "",
    "### Точные совпадения риска",
    `- Серверы: ${normalizeVerificationTextArray(verification.matchedEnemyGuildIds, 20, 80).join(", ") || "—"}`,
    `- Пользователи: ${normalizeVerificationTextArray(verification.matchedEnemyUserIds, 20, 80).join(", ") || "—"}`,
    `- Invite-коды: ${normalizeVerificationTextArray(verification.matchedEnemyInviteCodes, 20, 80).join(", ") || "—"}`,
    `- Inviter ID: ${normalizeVerificationTextArray(verification.matchedEnemyInviterUserIds, 20, 80).join(", ") || "—"}`,
    "",
    "## Roblox / друзья",
  );

  if (!cleanVerificationText(robloxSummary.userId || roblox.userId, 80)) {
    lines.push("- Roblox аккаунт не привязан или данные отсутствуют.");
  } else {
    lines.push(
      `- Roblox user ID: ${cleanVerificationText(robloxSummary.userId || roblox.userId, 80) || "—"}`,
      `- Username: ${cleanVerificationText(robloxSummary.currentUsername || roblox.username, 120) || "—"}`,
      `- Display name: ${cleanVerificationText(robloxSummary.currentDisplayName || roblox.displayName, 120) || "—"}`,
      `- Profile URL: ${cleanVerificationText(robloxSummary.profileUrl || roblox.profileUrl, 2000) || "—"}`,
      `- Account status: ${cleanVerificationText(robloxSummary.accountStatus || roblox.accountStatus, 80) || "—"}`,
      `- Verified badge: ${robloxSummary.hasVerifiedBadge === true || roblox.hasVerifiedBadge === true ? "yes" : "no"}`,
      `- Friends on JJS server: ${Number(robloxSummary.serverFriendsCount) || 0}`,
      `- Friends computed at: ${formatDateTime(robloxSummary.serverFriendsComputedAt)}`,
      `- Frequent non-friend peers: ${Number(robloxSummary.frequentNonFriendCount) || 0}`,
      `- Last seen in JJS: ${formatDateTime(robloxSummary.lastSeenInJjsAt)}`,
      `- Sessions in JJS: ${Number(robloxSummary.sessionCount) || 0}`,
      `- Previous username: ${cleanVerificationText(robloxSummary.previousUsername, 120) || "—"}`,
      `- Previous display name: ${cleanVerificationText(robloxSummary.previousDisplayName, 120) || "—"}`,
      `- Rename count: ${Number(robloxSummary.renameCount) || 0}`,
      `- Display rename count: ${Number(robloxSummary.displayRenameCount) || 0}`,
      `- Last rename seen: ${formatDateTime(robloxSummary.lastRenameSeenAt)}`
    );
  }

  lines.push("", "### Roblox friends on server");
  if (serverFriendIds.length) {
    for (const [index, friendUserId] of serverFriendIds.entries()) {
      lines.push(`${index + 1}. ${cleanVerificationText(friendUserId, 80)}`);
    }
  } else {
    lines.push("- Не найдены.");
  }

  lines.push("", "### Частые совместные игроки");
  if (topCoPlayPeers.length) {
    for (const [index, peer] of topCoPlayPeers.entries()) {
      lines.push(
        `${index + 1}. ${cleanVerificationText(peer.peerUserId, 80) || "—"} | friend ${peer.isRobloxFriend === true ? "yes" : peer.isRobloxFriend === false ? "no" : "unknown"} | minutes ${Math.max(0, Number(peer.minutesTogether) || 0)} | sessions ${Math.max(0, Number(peer.sharedJjsSessionCount || peer.sessionsTogether) || 0)} | days ${Math.max(0, Number(peer.daysTogether) || 0)} | frequent-non-friend ${peer.isFrequentNonFriend === true ? "yes" : "no"} | last seen ${formatDateTime(peer.lastSeenTogetherAt)}`
      );
    }
  } else {
    lines.push("- Не найдены.");
  }

  lines.push("", "### История Roblox username");
  if (usernameHistory.length) {
    for (const [index, entry] of usernameHistory.entries()) {
      lines.push(`${index + 1}. ${cleanVerificationText(entry?.name, 120) || "—"} | first ${formatDateTime(entry?.firstSeenAt)} | last ${formatDateTime(entry?.lastSeenAt)}`);
    }
  } else {
    lines.push("- Нет данных.");
  }

  lines.push("", "### История Roblox display name");
  if (displayNameHistory.length) {
    for (const [index, entry] of displayNameHistory.entries()) {
      lines.push(`${index + 1}. ${cleanVerificationText(entry?.name, 120) || "—"} | first ${formatDateTime(entry?.firstSeenAt)} | last ${formatDateTime(entry?.lastSeenAt)}`);
    }
  } else {
    lines.push("- Нет данных.");
  }

  return lines.join("\n");
}

function createVerificationAuditAttachment(userId, profile = {}, statusNote = "") {
  const safeUserId = cleanVerificationText(userId, 80).replace(/[^a-zA-Z0-9_-]+/g, "_") || "unknown";
  const content = buildVerificationAuditMarkdown(userId, profile, statusNote);
  return new AttachmentBuilder(Buffer.from(content, "utf8"), {
    name: `verification-audit-${safeUserId}.md`,
  });
}

async function postVerificationManualReport(client, userId, statusNote = "", options = {}) {
  let channel = null;
  try {
    channel = await resolveVerificationReportChannel(client);
    const profile = finalizeStoredProfile(userId);
    const auditAttachment = createVerificationAuditAttachment(userId, profile, statusNote);
    const message = await channel.send(buildVerificationReportPayload({
      userId,
      profile,
      statusNote,
      disableActions: options.disableActions === true,
      files: [auditAttachment],
    }));
    await logVerificationRuntimeEvent(client, `VERIFICATION_REPORT_SENT: <@${userId}> channel=${channel.id} message=${message.id}`);
    return { channel, message, profile };
  } catch (error) {
    await logVerificationRuntimeEvent(
      client,
      `VERIFICATION_REPORT_FAILED: <@${userId}> channel=${cleanVerificationText(channel?.id, 80) || "unknown"} error=${cleanVerificationText(error?.message || error, 200) || "unknown"}`,
      "error"
    );
    throw error;
  }
}

async function ensureVerificationEntryMessage(client) {
  const integration = getVerificationIntegrationState();
  const channelId = cleanVerificationText(integration.verificationChannelId, 80);
  if (!channelId) {
    throw new Error("verification.verificationChannelId не настроен.");
  }

  const guild = await getGuild(client).catch(() => null);
  if (!guild) {
    throw new Error("Не удалось получить guild для verification room.");
  }

  await guild.channels.fetch().catch(() => null);
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || typeof channel.send !== "function") {
    throw new Error("verification.verificationChannelId не указывает на текстовый канал.");
  }

  const payload = buildVerificationEntryPayload({
    integration,
    statusText: isVerificationOauthConfigured()
      ? "OAuth runtime готов. Если кейс зависнет, модераторы увидят его в queue/report flow."
      : "OAuth env пока не настроен. Guide уже доступен, launch станет рабочим после заполнения env.",
  });

  const trackedMessageId = cleanVerificationText(integration.entryMessage?.messageId, 80);
  let message = null;
  if (trackedMessageId && channel.messages?.fetch) {
    message = await channel.messages.fetch(trackedMessageId).catch(() => null);
    if (message && message.author?.id !== client.user?.id) {
      message = null;
    }
  }

  if (message) {
    await message.edit(payload);
  } else {
    message = await channel.send(payload);
  }

  writeNativeIntegrationSnapshot(db, {
    slot: "verification",
    patch: {
      status: integration.enabled === true ? "in_progress" : cleanVerificationText(integration.status, 40),
      lastSyncAt: nowIso(),
      entryMessage: {
        channelId: channel.id,
        messageId: message.id,
      },
    },
  });
  saveDb();
  return { channelId: channel.id, messageId: message.id, updated: true };
}

async function completeVerificationApprovedAccess(client, userId, accessMode = "normal", reason = "verification approved") {
  const normalizedMode = cleanVerificationText(accessMode, 40) === "wartime" ? "wartime" : "normal";
  const targetRoleId = normalizedMode === "wartime" ? getWartimeAccessRoleId() : getNormalAccessRoleId();
  if (!targetRoleId) {
    throw new Error(normalizedMode === "wartime"
      ? "Не настроена военная роль доступа для выпуска из verification."
      : "Не настроена базовая роль доступа для выпуска из verification.");
  }

  const lifecycle = await reconcileVerificationAssignmentForMember(client, userId, null, {
    reason: "verification decision skipped because verify-role was removed",
  });
  if (!lifecycle.active || lifecycle.stopped) {
    throw new Error("Участник уже не находится на verification.");
  }

  const member = await fetchMember(client, userId);
  if (!member) {
    throw new Error("Участник не найден на сервере. Выдать доступ после verification не удалось.");
  }

  const verifyRoleId = cleanVerificationText(getVerifyAccessRoleId(), 80);
  const releaseRoleIds = getVerificationQuarantineRoleIds();
  const rolePoolIds = [...new Set([...releaseRoleIds, verifyRoleId].filter(Boolean))];
  const snapshot = getRolePoolSnapshot(member, rolePoolIds);

  try {
    for (const roleId of releaseRoleIds) {
      if (roleId !== targetRoleId && member.roles.cache.has(roleId)) {
        await member.roles.remove(roleId, reason);
      }
    }
    if (!member.roles.cache.has(targetRoleId)) {
      await member.roles.add(targetRoleId, reason);
    }
    if (verifyRoleId && member.roles.cache.has(verifyRoleId)) {
      markVerificationRoleMutationIgnore(userId);
      await member.roles.remove(verifyRoleId, reason);
    }
  } catch (error) {
    await restoreRolePoolSnapshot(client, userId, rolePoolIds, snapshot, `${reason} rollback`);
    throw new Error(`Не удалось выпустить ${userId} из verification: ${formatRuntimeError(error)}`);
  }

  return { granted: true, roleId: targetRoleId, accessMode: normalizedMode };
}

async function approveVerificationUser(client, userId, reviewedBy, accessMode = "normal", reason = "verification moderator approve") {
  const release = await completeVerificationApprovedAccess(client, userId, accessMode, reason);
  return updateVerificationProfile(userId, {
    status: "verified",
    decision: "approved",
    completedAt: nowIso(),
    reviewedAt: nowIso(),
    reviewedBy: cleanVerificationText(reviewedBy, 120),
    decisionReason: `${reason}:${release.accessMode}`,
    lastError: "",
  });
}

async function banVerificationUser(client, userId, reviewedBy, reason = "verification moderator ban") {
  const lifecycle = await reconcileVerificationAssignmentForMember(client, userId, null, {
    reason: "verification decision skipped because verify-role was removed",
  });
  if (!lifecycle.active || lifecycle.stopped) {
    throw new Error("Участник уже не находится на verification.");
  }

  const guild = await getGuild(client).catch(() => null);
  if (!guild) {
    throw new Error("Не удалось получить guild для verification ban.");
  }

  await guild.members.ban(userId, { reason });
  return updateVerificationProfile(userId, {
    status: "rejected",
    decision: "rejected",
    completedAt: nowIso(),
    reviewedAt: nowIso(),
    reviewedBy: cleanVerificationText(reviewedBy, 120),
    decisionReason: `${reason}:ban`,
    lastError: "",
  });
}

async function runVerificationDeadlineSweep(client) {
  if (!isVerificationEnabled()) {
    return { scanned: 0, reported: 0 };
  }

  let scanned = 0;
  let reported = 0;
  for (const userId of Object.keys(db.profiles || {})) {
    const profile = finalizeStoredProfile(userId);
    const verification = profile.summary?.verification && typeof profile.summary.verification === "object"
      ? profile.summary.verification
      : profile.domains?.verification && typeof profile.domains.verification === "object"
        ? profile.domains.verification
        : null;
    if (!verification) continue;

    const lifecycle = await reconcileVerificationAssignmentForMember(client, userId, null, {
      reason: "verification deadline sweep skipped because verify-role is gone",
    });
    if (!lifecycle.active || lifecycle.stopped) continue;

    const status = cleanVerificationText(verification.status, 40);
    const reportDueAt = cleanVerificationText(verification.reportDueAt, 80);
    const reportSentAt = cleanVerificationText(verification.reportSentAt, 80);
    if (!["pending", "failed"].includes(status) || !reportDueAt || reportSentAt) continue;

    const dueAt = Date.parse(reportDueAt);
    if (!Number.isFinite(dueAt) || dueAt > Date.now()) continue;

    scanned += 1;
    await postVerificationManualReport(client, userId, "Срок verification истёк. Участник всё ещё находится в verify-карантине и не завершил кейс до дедлайна.");
    updateVerificationProfile(userId, {
      status: "manual_review",
      decision: "manual_review",
      decisionReason: "pending_timeout",
      reportSentAt: nowIso(),
    });
    reported += 1;
  }

  return { scanned, reported };
}

async function handleVerificationApprovedCallback(client, payload = {}) {
  return handleVerificationManualReviewCallback(client, payload);
}

async function handleVerificationManualReviewCallback(client, payload = {}) {
  const userId = cleanVerificationText(payload.session?.userId, 80);
  if (!userId) throw new Error("Verification callback не содержит userId session.");
  const risk = payload.risk && typeof payload.risk === "object" ? payload.risk : {};
  const lifecycle = await reconcileVerificationAssignmentForMember(client, userId, null, {
    reason: "verification callback ignored because verify-role was removed",
  });
  if (!lifecycle.active || lifecycle.stopped) {
    await logVerificationRuntimeEvent(client, `VERIFICATION_CALLBACK_IGNORED: <@${userId}> verify-role уже снята, callback пропущен.`, "warn");
    return;
  }

  const decisionReason = risk.missingObservedGuilds
    ? "oauth_missing_guilds"
    : risk.requiresManualReview
      ? "oauth_risk_review"
      : "oauth_completed_waiting_moderator";
  const statusNote = risk.missingObservedGuilds
    ? "Discord OAuth не вернул список серверов. Кейс отправлен на ручную проверку и остаётся в карантине."
    : risk.requiresManualReview
      ? "OAuth завершён, система нашла совпадения по рискам. Кейс остаётся в карантине до ручного решения модератора."
      : "OAuth завершён. Доступ не выдаётся автоматически: кейс остаётся в карантине до ручного решения модератора.";

  updateVerificationProfile(userId, {
    status: "manual_review",
    decision: "manual_review",
    startedAt: nowIso(),
    completedAt: nowIso(),
    oauthUserId: cleanVerificationText(payload.oauthUser?.id, 80),
    oauthUsername: buildVerificationOauthUsername(payload.oauthUser),
    oauthAvatarUrl: cleanVerificationText(payload.oauthUser?.avatar ? `https://cdn.discordapp.com/avatars/${payload.oauthUser.id}/${payload.oauthUser.avatar}.png` : "", 2000),
    observedGuilds: normalizeVerificationObservedGuilds(risk.observedGuilds),
    observedGuildIds: Array.isArray(risk.observedGuildIds) ? risk.observedGuildIds : [],
    observedGuildNames: Array.isArray(risk.observedGuildNames) ? risk.observedGuildNames : [],
    matchedEnemyGuildIds: Array.isArray(risk.matchedEnemyGuildIds) ? risk.matchedEnemyGuildIds : [],
    matchedEnemyUserIds: Array.isArray(risk.matchedEnemyUserIds) ? risk.matchedEnemyUserIds : [],
    matchedEnemyInviteCodes: Array.isArray(risk.matchedEnemyInviteCodes) ? risk.matchedEnemyInviteCodes : [],
    matchedEnemyInviterUserIds: Array.isArray(risk.matchedEnemyInviterUserIds) ? risk.matchedEnemyInviterUserIds : [],
    decisionReason,
    reportSentAt: nowIso(),
    lastError: "",
  });
  await postVerificationManualReport(client, userId, statusNote);
  await logVerificationRuntimeEvent(
    client,
    `${risk.requiresManualReview ? "VERIFICATION_MANUAL_REVIEW" : "VERIFICATION_READY_FOR_REVIEW"}: <@${userId}> oauth=${buildVerificationOauthUsername(payload.oauthUser) || "unknown"}`
  ).catch(() => {});
}

async function handleVerificationFailedCallback(client, payload = {}) {
  const userId = cleanVerificationText(payload.session?.userId, 80);
  if (!userId) {
    await logVerificationRuntimeEvent(
      client,
      `VERIFICATION_CALLBACK_FAILED_NO_SESSION: state=${formatVerificationStateLogToken(payload.state)} error=${cleanVerificationText(payload.error?.message || payload.error, 200) || "unknown"}`,
      "warn"
    );
    return;
  }
  const lifecycle = await reconcileVerificationAssignmentForMember(client, userId, null, {
    reason: "verification failure ignored because verify-role was removed",
  });
  if (!lifecycle.active || lifecycle.stopped) {
    await logVerificationRuntimeEvent(client, `VERIFICATION_FAILURE_IGNORED: <@${userId}> verify-role уже снята, ошибка проигнорирована.`, "warn");
    return;
  }
  ensureVerificationPendingProfile(userId, {
    status: "failed",
    lastError: cleanVerificationText(payload.error?.message || payload.error, 400),
  });
  await logVerificationRuntimeEvent(client, `VERIFICATION_FAILED: <@${userId}> ${cleanVerificationText(payload.error?.message || payload.error, 200)}`, "error");
}

async function startVerificationRuntime(client) {
  if (!isVerificationEnabled()) {
    return { enabled: false, callbackStarted: false, entryPublished: false };
  }

  let callbackStarted = false;
  let entryPublished = false;

  if (isVerificationOauthConfigured()) {
    if (!verificationCallbackServer) {
      verificationCallbackServer = createVerificationCallbackServer({
        config: {
          integration: getVerificationIntegrationState(),
          env: process.env,
        },
        consumeState: consumeVerificationOauthState,
        onApproved: (payload) => handleVerificationApprovedCallback(client, payload),
        onManualReview: (payload) => handleVerificationManualReviewCallback(client, payload),
        onFailure: (payload) => handleVerificationFailedCallback(client, payload),
      });
    }

    const result = await verificationCallbackServer.start();
    callbackStarted = result.started === true || result.alreadyListening === true;
  }

  if (cleanVerificationText(getVerificationIntegrationState().verificationChannelId, 80)) {
    await ensureVerificationEntryMessage(client);
    entryPublished = true;
  }

  return { enabled: true, callbackStarted, entryPublished };
}

async function buildVerificationPanelReply(view = "home", statusText = "", includeFlags = true) {
  const integration = getVerificationIntegrationState();
  const snapshot = buildVerificationPanelSnapshot();
  const payloadOptions = {
    integration,
    verifyRoleId: getVerifyAccessRoleId(),
    accessRoleId: getNormalAccessRoleId(),
    wartimeAccessRoleId: getWartimeAccessRoleId(),
    oauthConfigured: isVerificationOauthConfigured(),
    statusText,
    snapshot,
  };

  let payload = buildVerificationPanelPayload(payloadOptions);
  if (view === "queue") {
    payload = buildVerificationQueuePayload(payloadOptions);
  } else if (view === "runtime") {
    payload = buildVerificationRuntimePayload(payloadOptions);
  } else if (view === "guide") {
    payload = buildVerificationGuidePayload({
      audience: "moderator",
      integration,
      snapshot,
      statusText,
    });
  }

  return includeFlags ? ephemeralPayload(payload) : payload;
}

function buildOnboardModeStatusLines() {
  const state = getOnboardModeState();
  const normalRoleId = getNormalAccessRoleId();
  const wartimeRoleId = getWartimeAccessRoleId();
  const activeRoleId = getGrantedAccessRoleIdForMode(state.mode);
  const lines = [
    `Текущий режим онбординга: **${getOnboardAccessModeLabel(state.mode)}**.`,
    `Базовая стартовая роль: ${formatRoleMention(normalRoleId)}.`,
    `Активная стартовая роль после регистрации: ${formatRoleMention(activeRoleId)}.`,
  ];

  if (wartimeRoleId || state.mode === ONBOARD_ACCESS_MODES.WARTIME) {
    lines.push(`Военная стартовая роль: ${formatRoleMention(wartimeRoleId)}.`);
  }

  if (isApocalypseMode(state.mode)) {
    lines.push("Новые участники без ролей удаляются сразу после входа на сервер.");
  }

  if (state.changedAt) {
    const changedByText = state.changedBy ? ` (${state.changedBy})` : "";
    lines.push(`Последнее переключение: ${formatDateTime(state.changedAt)}${changedByText}.`);
  }

  return lines;
}

function memberHasTierRole(member) {
  if (!member?.roles?.cache) return false;
  return getAllTierRoleIds().some((roleId) => roleId && member.roles.cache.has(roleId));
}

function getNonJjsCaptchaModeForMember(member) {
  const nonJjsRoleId = getNonJjsAccessRoleId();

  return resolveNonJjsCaptchaMode({
    hasTierRole: memberHasTierRole(member),
    hasAccessRole: memberHasManagedStartAccessRole(member),
    hasNonJjsRole: Boolean(nonJjsRoleId && member?.roles?.cache?.has(nonJjsRoleId)),
  });
}

function getNonJjsCaptchaStartText(modeState) {
  if (modeState?.mode === "practice") {
    return "Тренировочный режим: у тебя уже есть доступ или kill-tier, поэтому роли и профиль не изменятся.";
  }
  return "Пройди 2 этапа. В каждой картинке нужно нажать номер лишнего персонажа.";
}

function getRolePoolSnapshot(member, roleIds) {
  if (!member?.roles?.cache || !Array.isArray(roleIds)) return [];
  return roleIds.filter((roleId) => roleId && member.roles.cache.has(roleId));
}

async function restoreRolePoolSnapshot(client, userId, roleIds, previousRoleIds, reason = "role rollback") {
  const member = await fetchMember(client, userId);
  if (!member) return false;

  const previousSet = new Set((previousRoleIds || []).map((value) => String(value || "").trim()).filter(Boolean));
  for (const roleId of roleIds) {
    if (!roleId) continue;
    const hasRole = member.roles.cache.has(roleId);
    if (hasRole && !previousSet.has(roleId)) {
      try {
        await member.roles.remove(roleId, reason);
      } catch (error) {
        throw new Error(`Не удалось откатить роль ${roleId} у ${userId}: ${formatRuntimeError(error)}`);
      }
      continue;
    }
    if (!hasRole && previousSet.has(roleId)) {
      try {
        await member.roles.add(roleId, reason);
      } catch (error) {
        throw new Error(`Не удалось восстановить роль ${roleId} у ${userId}: ${formatRuntimeError(error)}`);
      }
    }
  }

  return true;
}

async function ensureSingleTierRole(client, userId, targetTier, reason = "kill tier sync") {
  const member = await fetchMember(client, userId);
  if (!member) return;

  const targetRoleId = getTierRoleId(targetTier);
  if (!targetRoleId) {
    throw new Error(`Не настроена tier-роль для kill tier ${targetTier}.`);
  }
  const allTierRoleIds = getAllTierRoleIds();
  const snapshot = getRolePoolSnapshot(member, allTierRoleIds);

  try {
    for (const roleId of allTierRoleIds) {
      if (roleId !== targetRoleId && member.roles.cache.has(roleId)) {
        try {
          await member.roles.remove(roleId, reason);
        } catch (error) {
          throw new Error(`Не удалось снять tier-роль ${roleId} у ${userId}: ${formatRuntimeError(error)}`);
        }
      }
    }

    if (!member.roles.cache.has(targetRoleId)) {
      try {
        await member.roles.add(targetRoleId, reason);
      } catch (error) {
        throw new Error(`Не удалось выдать tier-роль ${targetRoleId} пользователю ${userId}: ${formatRuntimeError(error)}`);
      }
    }
  } catch (error) {
    await restoreRolePoolSnapshot(client, userId, allTierRoleIds, snapshot, `${reason} rollback`);
    throw error;
  }
}

async function ensureSingleRoleInPool(client, userId, targetRoleId, roleIds, reason = "role sync") {
  const member = await fetchMember(client, userId);
  if (!member) return;

  if (!targetRoleId) {
    throw new Error(`Не настроена целевая роль для пула ролей пользователя ${userId}.`);
  }

  const snapshot = getRolePoolSnapshot(member, roleIds);

  try {
    for (const roleId of roleIds) {
      if (roleId !== targetRoleId && member.roles.cache.has(roleId)) {
        try {
          await member.roles.remove(roleId, reason);
        } catch (error) {
          throw new Error(`Не удалось снять роль ${roleId} у ${userId}: ${formatRuntimeError(error)}`);
        }
      }
    }

    if (!member.roles.cache.has(targetRoleId)) {
      try {
        await member.roles.add(targetRoleId, reason);
      } catch (error) {
        throw new Error(`Не удалось выдать роль ${targetRoleId} пользователю ${userId}: ${formatRuntimeError(error)}`);
      }
    }
  } catch (error) {
    await restoreRolePoolSnapshot(client, userId, roleIds, snapshot, `${reason} rollback`);
    throw error;
  }
}

async function clearTierRoles(client, userId, reason = "clear kill tier") {
  return clearRolePool(client, userId, getAllTierRoleIds(), reason);
}

async function clearRolePool(client, userId, roleIds, reason = "clear role pool") {
  const member = await fetchMember(client, userId);
  if (!member) return false;

  const snapshot = getRolePoolSnapshot(member, roleIds);
  let removed = false;
  try {
    for (const roleId of roleIds) {
      if (member.roles.cache.has(roleId)) {
        try {
          await member.roles.remove(roleId, reason);
        } catch (error) {
          throw new Error(`Не удалось снять роль ${roleId} у ${userId}: ${formatRuntimeError(error)}`);
        }
        removed = true;
      }
    }
  } catch (error) {
    await restoreRolePoolSnapshot(client, userId, roleIds, snapshot, `${reason} rollback`);
    throw error;
  }

  return removed;
}

async function grantAccessRole(client, userId, reason = "welcome application submitted") {
  const member = await fetchMember(client, userId);
  if (!member) return false;

  const mode = getCurrentOnboardMode();
  const validationError = getOnboardModeValidationError(mode);
  if (validationError) {
    throw new Error(validationError);
  }

  const targetRoleId = getGrantedAccessRoleIdForMode(mode, member);
  if (!targetRoleId) {
    throw new Error("Не настроена роль стартового доступа для текущего режима.");
  }
  const managedRoleIds = getManagedStartAccessRoleIds();
  const snapshot = getRolePoolSnapshot(member, managedRoleIds);
  try {
    for (const roleId of managedRoleIds) {
      if (roleId !== targetRoleId && member.roles.cache.has(roleId)) {
        try {
          await member.roles.remove(roleId, reason);
        } catch (error) {
          throw new Error(`Не удалось снять стартовую роль ${roleId} у ${userId}: ${formatRuntimeError(error)}`);
        }
      }
    }

    if (!member.roles.cache.has(targetRoleId)) {
      try {
        await member.roles.add(targetRoleId, reason);
      } catch (error) {
        throw new Error(`Не удалось выдать стартовую роль ${targetRoleId} пользователю ${userId}: ${formatRuntimeError(error)}`);
      }
    }
  } catch (error) {
    await restoreRolePoolSnapshot(client, userId, managedRoleIds, snapshot, `${reason} rollback`);
    throw error;
  }
  return true;
}

async function maybeGrantAccessRoleAtStage(client, userId, stage, reason = "welcome application submitted") {
  if (!shouldGrantAccessRoleAtStage(stage)) return false;

  const granted = await grantAccessRole(client, userId, reason);
  if (granted) {
    const profile = getProfile(userId);
    profile.accessGrantedAt = profile.accessGrantedAt || nowIso();
    profile.updatedAt = nowIso();
  }
  return granted;
}

async function grantNonGgsAccessRole(client, userId, reason = "non-JJS captcha passed") {
  const member = await fetchMember(client, userId);
  if (!member) return false;

  const roleId = getNonJjsAccessRoleId();
  if (!roleId) {
    throw new Error("NON_JJS_ACCESS_ROLE_ID не настроен. Укажи отдельную роль для доступа без JJS.");
  }

  if (!member.roles.cache.has(roleId)) {
    await member.roles.add(roleId, reason);
  }

  return true;
}

async function revokeAccessRole(client, userId, reason = "profile purge") {
  const member = await fetchMember(client, userId);
  if (!member) return false;

  let removed = false;
  for (const roleId of getManagedStartAccessRoleIds()) {
    if (!roleId || !member.roles.cache.has(roleId)) continue;
    try {
      await member.roles.remove(roleId, reason);
    } catch (error) {
      throw new Error(`Не удалось снять стартовую роль ${roleId} у ${userId}: ${formatRuntimeError(error)}`);
    }
    removed = true;
  }

  return removed;
}

async function revokeNonGgsAccessRole(client, userId, reason = "profile purge") {
  const member = await fetchMember(client, userId);
  if (!member) return false;

  const roleId = getNonJjsAccessRoleId();
  if (!roleId || !member.roles.cache.has(roleId)) return false;

  try {
    await member.roles.remove(roleId, reason);
  } catch (error) {
    throw new Error(`Не удалось снять non-JJS роль ${roleId} у ${userId}: ${formatRuntimeError(error)}`);
  }
  return true;
}

async function clearManagedCharacterRoles(client, userId, reason = "profile purge") {
  const member = await fetchMember(client, userId);
  if (!member) return false;

  await syncManagedCharacterRoles(member, [], reason);
  return true;
}

async function deleteSubmissionReviewMessages(client, submissions) {
  let deleted = 0;
  let missing = 0;
  for (const submission of submissions) {
    const result = await deleteTrackedMessage(
      client,
      submission?.reviewChannelId,
      submission?.reviewMessageId,
      `review-сообщение ${submission?.id || "submission"}`
    );
    if (!result.deleted) continue;
    deleted += 1;
    if (result.missing) missing += 1;
  }
  return { deleted, missing };
}

async function purgeUserProfile(client, userId, moderatorTag) {
  const userKey = String(userId || "").trim();
  const submissions = Object.entries(db.submissions || {})
    .filter(([, submission]) => submission?.userId === userKey)
    .map(([submissionId, submission]) => ({ submissionId, submission }));

  clearGraphicAvatarCacheForUser(userKey);

  const removedReviewMessages = await deleteSubmissionReviewMessages(
    client,
    submissions.map((entry) => entry.submission)
  );

  const rolesCleared = {
    tier: await clearTierRoles(client, userKey, "moderator deleted user profile"),
    access: await revokeAccessRole(client, userKey, "moderator deleted user profile"),
    nonGgs: await revokeNonGgsAccessRole(client, userKey, "moderator deleted user profile"),
    characters: await clearManagedCharacterRoles(client, userKey, "moderator deleted user profile"),
  };

  const hadProfile = Boolean(db.profiles?.[userKey]);
  if (hadProfile) delete db.profiles[userKey];

  for (const { submissionId } of submissions) {
    delete db.submissions[submissionId];
  }

  const hadCooldown = Boolean(db.cooldowns?.[userKey]);
  if (hadCooldown) delete db.cooldowns[userKey];

  const hadMainDraft = mainDrafts.has(userKey);
  clearMainDraft(userKey);

  const hadSubmitSession = submitSessions.has(userKey);
  clearSubmitSession(userKey);

  const hadNonGgsSession = nonGgsCaptchaSessions.has(userKey);
  clearNonGgsCaptchaSession(userKey);

  saveDb();
  invalidateLiveCharacterStatsContext();

  await logLine(
    client,
    `DELETE_PROFILE: <@${userKey}> by ${moderatorTag}. profile=${hadProfile ? 1 : 0}, submissions=${submissions.length}, cooldown=${hadCooldown ? 1 : 0}, reviewMessages=${removedReviewMessages.deleted}, missingReviewMessages=${removedReviewMessages.missing}`
  );

  return {
    hadProfile,
    deletedSubmissions: submissions.length,
    removedReviewMessages: removedReviewMessages.deleted,
    missingReviewMessages: removedReviewMessages.missing,
    hadCooldown,
    hadMainDraft,
    hadSubmitSession,
    hadNonGgsSession,
    rolesCleared,
  };
}

function buildWelcomeEmbed() {
  const presentation = getPresentation();
  const nonJjsUi = getNonJjsUiConfig();
  return new EmbedBuilder()
    .setTitle(presentation.welcome.title)
    .setDescription([
      presentation.welcome.description,
      "",
      ...presentation.welcome.steps.map((step, index) => `${index + 1}. ${step}`),
      "",
      `**${nonJjsUi.title}**`,
      nonJjsUi.description,
    ].join("\n"));
}

function buildWelcomeComponents() {
  const presentation = getPresentation();
  const nonJjsUi = getNonJjsUiConfig();
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("onboard_begin")
        .setLabel(presentation.welcome.buttons.begin)
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("onboard_non_ggs_start")
        .setLabel(nonJjsUi.buttonLabel)
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("onboard_quick_mains")
        .setLabel(presentation.welcome.buttons.quickMains)
        .setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function buildNonGgsPanelPayload() {
  const nonJjsUi = getNonJjsUiConfig();
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(nonJjsUi.title)
        .setDescription(nonJjsUi.description),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("onboard_non_ggs_start")
          .setLabel(nonJjsUi.buttonLabel)
          .setStyle(ButtonStyle.Success)
      ),
    ],
  };
}

function buildNonGgsCaptchaButtons() {
  const rows = [];
  for (let row = 0; row < 3; row += 1) {
    const rowBuilder = new ActionRowBuilder();
    for (let col = 0; col < 3; col += 1) {
      const value = row * 3 + col + 1;
      rowBuilder.addComponents(
        new ButtonBuilder()
          .setCustomId(`non_ggs_captcha_answer:${value}`)
          .setLabel(String(value))
          .setStyle(ButtonStyle.Secondary)
      );
    }
    rows.push(rowBuilder);
  }
  return rows;
}

function buildNonGgsCaptchaCatalog() {
  return loadCaptchaCatalog(NON_GGS_CAPTCHA_ASSET_DIR);
}

function createNonGgsCaptchaSession(previousChallenge = null, stage = 1, options = {}) {
  return {
    stage,
    mode: String(options.mode || "grant").trim() || "grant",
    challenge: createCaptchaChallenge(buildNonGgsCaptchaCatalog(), { previousChallenge }),
  };
}

function getNonGgsCaptchaStatusLines() {
  const panel = getResolvedNonGgsPanelSnapshot();
  const catalog = buildNonGgsCaptchaCatalog();
  const roleId = getNonJjsAccessRoleId();
  const foundSkillful = catalog.skillful.map((entry) => entry.slot).join(", ") || "—";
  const foundOutliers = catalog.outliers.map((entry) => entry.slot).join(", ") || "—";
  const missingSkillful = catalog.missingSkillfulSlots.join(", ") || "—";
  const missingOutliers = catalog.missingOutlierSlots.join(", ") || "—";

  return [
    "JJS captcha status:",
    `roleId: ${roleId || "не задан"}`,
    `panelChannelId: ${panel.channelId || "—"}`,
    `panelMessageId: ${panel.messageId || "—"}`,
    `assetDir: ${NON_GGS_CAPTCHA_ASSET_DIR}`,
    `skillful slots found: ${foundSkillful}`,
    `outlier slots found: ${foundOutliers}`,
    `missing skillful: ${missingSkillful}`,
    `missing outliers: ${missingOutliers}`,
    `active sessions: ${getActiveNonGgsCaptchaSessionCount()}`,
  ];
}

async function buildNonGgsCaptchaPayload(userId, noticeText = "", options = {}) {
  const session = getNonGgsCaptchaSession(userId);
  if (!session?.challenge) {
    throw new Error("Капча уже истекла. Нажми кнопку заново.");
  }

  const buffer = await renderCaptchaPng(session.challenge);
  const stage = Number(session.stage) || 1;
  const descriptionLines = [
    `Этап **${stage} из ${NON_GGS_CAPTCHA_STAGES}**.`,
    "Нажми кнопку с номером лишней картинки.",
  ];

  if (session.mode === "practice") {
    descriptionLines.splice(1, 0, "Тренировочный режим: роли и профиль не изменятся.");
  }

  if (noticeText) {
    descriptionLines.unshift(noticeText);
  }

  const title = session.mode === "practice"
    ? "JJS-капча (тренировочный режим)"
    : "Капча для отдельного доступа без JJS";

  const payload = {
    embeds: [
      new EmbedBuilder()
        .setTitle(title)
        .setDescription(descriptionLines.join("\n"))
        .setImage("attachment://jjs-captcha.png"),
    ],
    files: [new AttachmentBuilder(buffer, { name: "jjs-captcha.png" })],
    components: buildNonGgsCaptchaButtons(),
  };

  return options.includeEphemeralFlag ? ephemeralPayload(payload) : payload;
}

function buildNonGgsConfirmPayload() {
  return ephemeralPayload({
    embeds: [
      new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle("Подтверди путь без JJS")
        .setDescription([
          "Ты уверен, что хочешь продолжить?",
          "Если подтвердить этот путь, ты потеряешь большинство функций сервера.",
          "Если играешь в JJS, лучше вернись и используй обычную кнопку «Получить роль».",
        ].join("\n")),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("onboard_non_ggs_confirm").setLabel("Да, продолжить").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("onboard_non_ggs_cancel").setLabel("Отмена").setStyle(ButtonStyle.Secondary)
      ),
    ],
  });
}

function buildCharacterPickerPayload(mode = "full") {
  const characterEntries = getCharacterPickerEntries();
  const validationError = getCharacterPickerValidationError(characterEntries);
  if (validationError) {
    throw new Error(validationError);
  }

  const isQuick = mode === "quick";
  const embed = new EmbedBuilder()
    .setTitle("Выбери мейнов")
    .setDescription(
      isQuick
        ? "Можно выбрать одного или двух персонажей. Этот режим быстро обновляет только мейнов и роли, без новой заявки по kills."
        : "Можно выбрать одного или двух персонажей. После выбора сразу отправь одним сообщением kills в тексте и скрин во вложении."
    );

  const maxSelectable = Math.min(2, characterEntries.length);
  const select = new StringSelectMenuBuilder()
    .setCustomId(isQuick ? "onboard_pick_characters_quick" : "onboard_pick_characters")
    .setPlaceholder(maxSelectable === 1 ? "Выбери мейна" : "Выбери 1 или 2 мейнов")
    .setMinValues(1)
    .setMaxValues(maxSelectable)
    .addOptions(characterEntries.map((entry) => ({ label: normalizeCharacterSelectLabel(entry.label), value: getCharacterSelectValue(entry.id) })));

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(select),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("onboard_cancel").setLabel("Отмена").setStyle(ButtonStyle.Secondary)
      ),
    ],
    flags: MessageFlags.Ephemeral,
  };
}

function buildSubmitStepPayload(userId, options = {}) {
  const renderSubmitStepTemplate = (template, tokens = {}) => {
    let text = String(template || "").trim();
    for (const [key, value] of Object.entries(tokens)) {
      text = text.split(`{{${key}}}`).join(String(value || ""));
    }
    return text;
  };

  const session = getSubmitSession(userId);
  const pending = getPendingSubmissionForUser(userId);
  const mainCharacterIds = Array.isArray(options.mainCharacterIds) && options.mainCharacterIds.length
    ? options.mainCharacterIds
    : session?.mainCharacterIds;
  if (!mainCharacterIds?.length) {
    return ephemeralPayload({ content: "Сессия выбора мейнов истекла. Нажми кнопку заново." });
  }

  const selectedEntries = getSelectedCharacterEntries(mainCharacterIds);
  const selectedLabels = selectedEntries.length
    ? selectedEntries.map((entry) => entry.label)
    : mainCharacterIds.map((value) => String(value || "").trim()).filter(Boolean);
  const welcomeChannelId = getResolvedChannelId("welcome");
  const uploadTarget = welcomeChannelId ? `<#${welcomeChannelId}>` : "welcome-канал";
  const exampleImagePath = getOnboardingProofExampleImagePath();
  const exampleImageUrl = getOnboardingProofExampleImageUrl();
  const hasExampleImagePath = Boolean(exampleImagePath) && fs.existsSync(exampleImagePath);
  const hasExampleImageUrl = Boolean(exampleImageUrl);
  const hasRobloxIdentity = Boolean(session?.robloxUsername && session?.robloxUserId);
  const canManageRobloxIdentity = canManageWelcomeRobloxIdentity({
    session,
    pending,
    canManage: options.canManageRobloxIdentity === true,
  });
  const presentation = getPresentation();
  const submitStepPresentation = presentation.welcome.submitStep || {};
  const exampleNote = hasExampleImagePath || hasExampleImageUrl
    ? "Ниже прикреплён пример того, как должна выглядеть заявка."
    : "";
  const submitStepText = renderSubmitStepTemplate(submitStepPresentation.description, {
    uploadTarget,
    exampleNote,
  });

  const lines = [];
  if (options.noticeText) lines.push(options.noticeText);
  lines.push(`Мейны: **${selectedLabels.join(", ")}**.`);

  if (hasRobloxIdentity) {
    lines.push(`Roblox: **${session.robloxUsername}** (ID ${session.robloxUserId}).`);
  }
  lines.push(...submitStepText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));

  const payload = {
    embeds: [
      new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle(String(submitStepPresentation.title || "Готово. Кидай kills и общий скрин").trim())
        .setDescription(lines.filter(Boolean).join("\n")),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("onboard_change_mains").setLabel("Сменить мейнов").setStyle(ButtonStyle.Secondary)
      ),
    ],
  };

  if (hasRobloxIdentity && canManageRobloxIdentity) {
    payload.components[0].addComponents(
      new ButtonBuilder().setCustomId("onboard_set_roblox_username").setLabel("Сменить Roblox username").setStyle(ButtonStyle.Secondary)
    );
  }

  if (hasExampleImagePath) {
    const fileName = sanitizeFileName(path.basename(exampleImagePath) || "onboarding-proof-example.png");
    payload.files = [new AttachmentBuilder(exampleImagePath, { name: fileName })];
    payload.embeds[0].setImage(`attachment://${fileName}`);
  } else if (hasExampleImageUrl) {
    payload.embeds[0].setImage(exampleImageUrl);
  }

  return options.includeEphemeralFlag === false ? payload : ephemeralPayload(payload);
}

function buildRobloxUsernameStepPayload(userId, options = {}) {
  const session = getSubmitSession(userId);
  const pending = getPendingSubmissionForUser(userId);
  const mainCharacterIds = Array.isArray(options.mainCharacterIds) && options.mainCharacterIds.length
    ? options.mainCharacterIds
    : Array.isArray(session?.mainCharacterIds) && session.mainCharacterIds.length
      ? session.mainCharacterIds
      : Array.isArray(pending?.mainCharacterIds)
        ? pending.mainCharacterIds
        : [];

  if (!mainCharacterIds.length && !pending?.id) {
    return ephemeralPayload({ content: "Сессия онбординга истекла. Нажми «Получить роль» заново." });
  }

  const selectedEntries = getSelectedCharacterEntries(mainCharacterIds);
  const selectedLabels = selectedEntries.length
    ? selectedEntries.map((entry) => entry.label)
    : mainCharacterIds.map((value) => String(value || "").trim()).filter(Boolean);
  const kills = Number.isSafeInteger(options.kills)
    ? options.kills
    : Number.isSafeInteger(session?.pendingKills)
      ? session.pendingKills
      : Number.isSafeInteger(pending?.kills)
        ? pending.kills
        : null;
  const required = options.required === true;
  const lines = [];

  if (options.noticeText) lines.push(options.noticeText);
  if (selectedLabels.length) {
    lines.push(`Мейны: **${selectedLabels.join(", ")}**.`);
  }
  if (kills !== null) {
    lines.push(`Kills: **${kills}**.`);
  }
  lines.push(
    required
      ? "Теперь обязательно укажи свой Roblox username. Без этого шага заявка не уйдёт модераторам."
      : "Теперь можешь добавить Roblox username. Шаг необязателен, но тогда модератор увидит его прямо в pending-заявке."
  );
  lines.push("Модератор сравнит этот username с тем же скрином, где одновременно видны kills и уникальный Roblox username.");

  const payload = {
    embeds: [
      new EmbedBuilder()
        .setColor(required ? 0xFEE75C : 0x57F287)
        .setTitle("Шаг 3. Укажи Roblox username")
        .setDescription(lines.join("\n")),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("onboard_set_roblox_username").setLabel(required ? "Указать Roblox username" : "Добавить Roblox username").setStyle(ButtonStyle.Primary)
      ),
    ],
  };

  return options.includeEphemeralFlag === false ? payload : ephemeralPayload(payload);
}

function buildReviewButtons(submissionId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`approve:${submissionId}`).setLabel("Approve").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`edit:${submissionId}`).setLabel("Edit kills").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`reject:${submissionId}`).setLabel("Reject").setStyle(ButtonStyle.Danger)
  );
}

function buildReviewEmbed(submission, statusLabel, extraFields = []) {
  const embed = new EmbedBuilder()
    .setTitle(`Welcome-заявка (${statusLabel})`)
    .setDescription([
      `Игрок: <@${submission.userId}> (${submission.displayName})`,
      `Мейны: **${submission.mainCharacterLabels.join(", ")}**`,
      `Kills: **${submission.kills}**`,
      `Roblox: **${submission.robloxUsername || "—"}**${submission.robloxUserId ? ` (ID ${submission.robloxUserId})` : ""}`,
      `Tier по kills: **${submission.derivedTier}** (${formatTierLabel(submission.derivedTier)})`,
      `ID: \`${submission.id}\``,
      `Создано: **${formatDateTime(submission.createdAt)}**`,
    ].join("\n"))
    .setImage(submission.reviewImage || submission.screenshotUrl);

  if (extraFields.length) embed.addFields(...extraFields);
  return embed;
}

function getMessageComponentCustomIds(message) {
  return (message?.components || [])
    .flatMap((row) => row.components || [])
    .map((component) => String(component.customId || "").trim())
    .filter(Boolean);
}

function messageHasRequiredCustomIds(message, requiredIds) {
  const customIds = new Set(getMessageComponentCustomIds(message));
  return requiredIds.every((customId) => customIds.has(customId));
}

function messageHasEmbedTitle(message, title) {
  return (message?.embeds || []).some((embed) => String(embed?.title || "").trim() === String(title || "").trim());
}

function messageHasAttachmentName(message, fileName) {
  return message?.attachments?.some?.((attachment) => String(attachment?.name || "").trim() === fileName) || false;
}

async function findManagedMessageInChannel(channel, predicate, limit = 75) {
  if (!channel?.isTextBased()) return null;

  const recent = await channel.messages.fetch({ limit }).catch(() => null);
  if (!recent?.size) return null;

  return [...recent.values()]
    .sort((left, right) => Number(right.createdTimestamp || 0) - Number(left.createdTimestamp || 0))
    .find(predicate) || null;
}

async function findExistingWelcomePanelMessage(channel) {
  const botId = client.user?.id;
  return findManagedMessageInChannel(
    channel,
    (message) => message.author?.id === botId && messageHasRequiredCustomIds(message, ["onboard_begin", "onboard_quick_mains"])
  );
}

async function findExistingNonGgsPanelMessage(channel) {
  const botId = client.user?.id;
  return findManagedMessageInChannel(
    channel,
    (message) => message.author?.id === botId && messageHasRequiredCustomIds(message, ["onboard_non_ggs_start"])
  );
}

async function findExistingGraphicTierlistMessage(channel) {
  const botId = client.user?.id;
  return findManagedMessageInChannel(
    channel,
    (message) =>
      message.author?.id === botId &&
      (messageHasRequiredCustomIds(message, ["graphic_refresh", "graphic_panel"]) ||
      String(message?.content || "").startsWith("Графический тир-лист.") ||
      messageHasEmbedTitle(message, getEffectiveGraphicTitle()) ||
      messageHasAttachmentName(message, "tierlist.png") ||
      messageHasAttachmentName(message, "graphic-tierlist.svg"))
  );
}

async function findExistingLegacyEloGraphicMessage(channel) {
  const botId = client.user?.id;
  return findManagedMessageInChannel(
    channel,
    (message) =>
      message.author?.id === botId &&
      (
        messageHasRequiredCustomIds(message, ["elo_graphic_refresh", "elo_graphic_panel"]) ||
        String(message?.content || "").startsWith("ELO графический тир-лист.") ||
        messageHasAttachmentName(message, "elo-tierlist.png")
      )
  );
}

async function findExistingLegacyTierlistDashboardMessage(channel) {
  const botId = client.user?.id;
  return findManagedMessageInChannel(
    channel,
    (message) =>
      message.author?.id === botId &&
      (
        messageHasRequiredCustomIds(message, ["start_rating", "rate_new_characters", "my_status", "refresh_tierlist"]) ||
        messageHasEmbedTitle(message, LEGACY_TIERLIST_TITLE) ||
        messageHasAttachmentName(message, "tierlist.png")
      )
  );
}

async function findExistingLegacyTierlistSummaryMessage(channel) {
  const botId = client.user?.id;
  return findManagedMessageInChannel(
    channel,
    (message) =>
      message.author?.id === botId &&
      messageHasEmbedTitle(message, `${LEGACY_TIERLIST_TITLE} Summary`)
  );
}

async function findExistingTextTierlistMessage(channel) {
  const botId = client.user?.id;
  return findManagedMessageInChannel(
    channel,
    (message) =>
      message.author?.id === botId &&
      (String(message?.content || "").startsWith("Текстовый тир-лист.") ||
      messageHasEmbedTitle(message, getPresentation().tierlist.textTitle))
  );
}

async function fetchStoredBotMessage(channel, state, messageKey, botId) {
  const messageId = String(state?.[messageKey] || "").trim();
  if (!messageId) return null;

  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (!message) return null;
  if (message.author?.id === botId) return message;

  state[messageKey] = "";
  return null;
}

function shouldKeepWelcomeChannelMessage(message, keepMessageIds) {
  if (!message) return true;
  if (keepMessageIds.has(message.id)) return true;

  const ageMs = Date.now() - Number(message.createdTimestamp || 0);

  if (message.author?.id === client.user?.id && messageHasRequiredCustomIds(message, ["onboard_begin", "onboard_non_ggs_start", "onboard_quick_mains"])) {
    return true;
  }

  if (message.author?.id === client.user?.id && ageMs <= WELCOME_CLEANUP_BOT_REPLY_GRACE_MS) {
    return true;
  }

  if (messageHasImageAttachment(message)) {
    const session = getSubmitSession(message.author?.id);
    if (session) return true;
    if (ageMs <= WELCOME_CLEANUP_IMAGE_GRACE_MS) return true;
  }

  return false;
}

async function cleanupWelcomeChannelMessages(channel, keepMessageIds = []) {
  if (!channel?.isTextBased()) return 0;

  const keepIds = new Set(keepMessageIds.filter(Boolean));
  let before = null;
  let deleted = 0;

  for (let batchIndex = 0; batchIndex < 10; batchIndex += 1) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => null);
    if (!batch?.size) break;

    for (const message of batch.values()) {
      if (shouldKeepWelcomeChannelMessage(message, keepIds)) continue;
      if (!message.deletable) continue;
      await message.delete().catch(() => {});
      deleted += 1;
    }

    before = batch.last()?.id || null;
    if (!before || batch.size < 100) break;
  }

  return deleted;
}

async function upsertManagedPanelMessage(channel, state, payload, findExisting, botId) {
  let message = await fetchStoredBotMessage(channel, state, "messageId", botId);
  if (!message) {
    message = await findExisting(channel);
    if (message && state.messageId !== message.id) {
      state.messageId = message.id;
      saveDb();
    }
  }

  if (!message) {
    message = await channel.send(payload);
    state.messageId = message.id;
  } else {
    await message.edit(payload);
  }

  return message;
}

async function refreshWelcomePanel(client) {
  const panelState = syncLegacyPanelSnapshot(getWelcomePanelState(), getResolvedWelcomePanelSnapshot());
  const legacyNonGgsPanelState = getNonGgsPanelState();
  const previousNonGgsChannelId = String(legacyNonGgsPanelState.channelId || "").trim();
  const previousNonGgsMessageId = String(legacyNonGgsPanelState.messageId || "").trim();
  const nonGgsPanelState = syncLegacyPanelSnapshot(legacyNonGgsPanelState, getResolvedNonGgsPanelSnapshot());
  if (!panelState.channelId || isPlaceholder(panelState.channelId)) {
    console.warn("welcomeChannelId не задан, пропускаем refreshWelcomePanel");
    return null;
  }
  const welcomeChannel = await client.channels.fetch(panelState.channelId).catch(() => null);
  if (!welcomeChannel?.isTextBased()) {
    throw new Error("welcomeChannelId не указывает на текстовый канал");
  }

  nonGgsPanelState.channelId = welcomeChannel.id;
  nonGgsPanelState.messageId = "";

  const welcomePayload = {
    embeds: [buildWelcomeEmbed()],
    components: buildWelcomeComponents(),
  };

  const botId = client.user?.id;
  const welcomeMessage = await upsertManagedPanelMessage(welcomeChannel, panelState, welcomePayload, findExistingWelcomePanelMessage, botId);

  if (previousNonGgsMessageId) {
    await deleteManagedChannelMessage(client, previousNonGgsChannelId || welcomeChannel.id, previousNonGgsMessageId);
  }

  await cleanupWelcomeChannelMessages(welcomeChannel, [welcomeMessage.id]);
  saveDb();
  return { welcomeMessage, nonGgsMessage: null };
}

async function ensureWelcomePanel(client) {
  return refreshWelcomePanel(client);
}

async function clearWelcomeManagedPanel(client, slot) {
  const normalizedSlot = String(slot || "").trim();
  const panelState = normalizedSlot === "nonGgs" ? getNonGgsPanelState() : getWelcomePanelState();
  const previousChannelId = String(panelState.channelId || "").trim();
  const previousMessageId = String(panelState.messageId || "").trim();

  panelState.channelId = "";
  panelState.messageId = "";

  const refreshResult = await refreshWelcomePanel(client);
  const nextMessage = normalizedSlot === "nonGgs"
    ? refreshResult?.nonGgsMessage || null
    : refreshResult?.welcomeMessage || null;

  if (previousMessageId && (!nextMessage || previousChannelId !== nextMessage.channel.id || previousMessageId !== nextMessage.id)) {
    await deleteManagedChannelMessage(client, previousChannelId || nextMessage?.channel?.id || "", previousMessageId);
  }

  return {
    ok: true,
    channelId: nextMessage?.channel?.id || "",
    messageId: nextMessage?.id || "",
  };
}

async function refreshGraphicTierlistBoard(client, options = {}) {
  const state = syncLegacyGraphicTierlistBoardSnapshot(
    getGraphicTierlistBoardState(db.config, appConfig.channels.tierlistChannelId || ""),
    getResolvedGraphicTierlistBoardSnapshot()
  );
  const channelId = String(state.channelId || "").trim();
  if (!channelId || isPlaceholder(channelId)) return null;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    console.warn("tierlistChannelId не указывает на текстовый канал, пропускаем graphic board");
    return null;
  }

  if (options.forceRecreate && state.messageId) {
    const existing = await channel.messages.fetch(state.messageId).catch(() => null);
    if (existing) await existing.delete().catch(() => {});
    state.messageId = "";
  }

  let message = await fetchStoredBotMessage(channel, state, "messageId", client.user?.id);
  if (!message && !options.forceRecreate) {
    message = await findExistingGraphicTierlistMessage(channel);
    if (message && state.messageId !== message.id) {
      state.messageId = message.id;
      saveDb();
    }
  }

  const payload = await buildGraphicTierlistBoardPayload(client);
  const created = !message;
  if (!message) {
    message = await channel.send(payload);
    state.messageId = message.id;
  } else {
    await message.edit({ ...payload, attachments: [] });
  }

  state.lastUpdated = Date.now();
  state.channelId = channelId;
  saveDb();
  return { message, created };
}

async function ensureGraphicTierlistBoardMessage(client) {
  return refreshGraphicTierlistBoard(client);
}

async function deleteManagedChannelMessage(client, channelId, messageId) {
  if (!channelId || !messageId) return false;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return false;
  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (!message) return false;
  if (client?.user?.id && message.author?.id !== client.user.id) return false;
  if (!message?.deletable) return false;
  await message.delete().catch(() => {});
  return true;
}

async function repostGraphicTierlistBoardToChannel(client, targetChannelId) {
  const state = syncLegacyGraphicTierlistBoardSnapshot(
    getGraphicTierlistBoardState(db.config, appConfig.channels.tierlistChannelId || ""),
    getResolvedGraphicTierlistBoardSnapshot()
  );
  const nextChannelId = String(targetChannelId || "").trim();
  if (!nextChannelId || isPlaceholder(nextChannelId)) {
    throw new Error("Нужно указать текстовый канал для графического тир-листа.");
  }

  const targetChannel = await client.channels.fetch(nextChannelId).catch(() => null);
  if (!targetChannel?.isTextBased()) {
    throw new Error("Указанный канал не является текстовым.");
  }

  const previousChannelId = String(state.channelId || "").trim();
  const previousMessageId = state.messageId || "";

  state.channelId = nextChannelId;
  state.messageId = "";
  saveDb();

  try {
    const result = await refreshGraphicTierlistBoard(client);

    if (previousMessageId && (previousChannelId !== nextChannelId || previousMessageId !== result?.message?.id)) {
      await deleteManagedChannelMessage(client, previousChannelId || nextChannelId, previousMessageId);
    }

    return {
      channelId: nextChannelId,
      previousChannelId,
      messageId: result?.message?.id || "",
    };
  } catch (error) {
    state.channelId = previousChannelId;
    state.messageId = previousMessageId;
    saveDb();
    throw error;
  }
}

async function repostTextTierlistBoardToChannel(client, targetChannelId) {
  const state = syncLegacyTextTierlistBoardSnapshot(
    getTextTierlistBoardState(db.config, appConfig.channels.tierlistChannelId || ""),
    getResolvedTextTierlistBoardSnapshot()
  );
  const nextChannelId = String(targetChannelId || "").trim();
  if (!nextChannelId || isPlaceholder(nextChannelId)) {
    throw new Error("Нужно указать текстовый канал для текстового тир-листа.");
  }

  const targetChannel = await client.channels.fetch(nextChannelId).catch(() => null);
  if (!targetChannel?.isTextBased()) {
    throw new Error("Указанный канал не является текстовым.");
  }

  const previousChannelId = String(state.channelId || "").trim();
  const previousState = {
    channelId: String(state.channelId || "").trim(),
    messageId: String(state.messageId || "").trim(),
    messageIdSummary: String(state.messageIdSummary || "").trim(),
    messageIdPages: String(state.messageIdPages || "").trim(),
  };
  const previousMessageIds = getTextTierlistManagedMessageIds(state);

  state.channelId = nextChannelId;
  clearTextTierlistBoardMessageIds(state);
  saveDb();

  try {
    const result = await refreshTextTierlistBoard(client, { forceRecreate: true });
    const nextMessageIds = getTextTierlistManagedMessageIds(state);

    for (const previousMessageId of previousMessageIds) {
      if (!previousMessageId) continue;
      if (previousChannelId === nextChannelId && nextMessageIds.includes(previousMessageId)) continue;
      await deleteManagedChannelMessage(client, previousChannelId || nextChannelId, previousMessageId);
    }

    return {
      channelId: nextChannelId,
      previousChannelId,
      messageId: result?.summaryMessage?.id || "",
      messageIdSummary: result?.summaryMessage?.id || "",
      messageIdPages: result?.pagesMessage?.id || "",
    };
  } catch (error) {
    state.channelId = previousState.channelId;
    state.messageId = previousState.messageId;
    state.messageIdSummary = previousState.messageIdSummary;
    state.messageIdPages = previousState.messageIdPages;
    saveDb();
    throw error;
  }
}

async function moveNotificationChannel(client, targetChannelId) {
  const nextChannelId = String(targetChannelId || "").trim();
  if (!nextChannelId || isPlaceholder(nextChannelId)) {
    throw new Error("Нужно указать текстовый канал для уведомлений.");
  }

  const targetChannel = await client.channels.fetch(nextChannelId).catch(() => null);
  if (!targetChannel?.isTextBased()) {
    throw new Error("Указанный канал не является текстовым.");
  }

  const previousChannelId = getResolvedChannelId("log");
  db.config.notificationChannelId = nextChannelId;
  saveDb();

  await logLine(client, `NOTICE_CHANNEL_MOVED: now=<#${nextChannelId}> previous=${previousChannelId ? `<#${previousChannelId}>` : "none"}`);
  return {
    channelId: nextChannelId,
    previousChannelId,
  };
}

function normalizeSotReportChannelSlot(value) {
  return normalizeManagedChannelSlot(value);
}

function getSotReportChannelSlotLabel(slot) {
  return getManagedChannelSlotLabel(slot);
}

function clearGroundTruthReportChannel(slot) {
  return clearManagedChannelLink(slot, {
    clearTextTierlistBoardMessageIds,
    deleteManagedChannelMessage: (channelId, messageId) => deleteManagedChannelMessage(client, channelId, messageId),
    formatChannelMention,
    getGraphicTierlistBoardState: () => getGraphicTierlistBoardState(db.config, appConfig.channels.tierlistChannelId || ""),
    getNonGgsPanelState,
    getResolvedChannelId,
    getResolvedGraphicTierlistBoardSnapshot,
    getResolvedNonGgsPanelSnapshot,
    getResolvedTextTierlistBoardSnapshot,
    getResolvedWelcomePanelSnapshot,
    getTextTierlistBoardState: () => getTextTierlistBoardState(db.config, appConfig.channels.tierlistChannelId || ""),
    getWelcomePanelState,
    saveDb,
    setNotificationChannelId: (channelId) => {
      db.config.notificationChannelId = String(channelId || "").trim();
    },
    setReviewChannelId: (channelId) => {
      db.config.reviewChannelId = String(channelId || "").trim();
    },
    syncLegacyGraphicTierlistBoardSnapshot,
    syncLegacyPanelSnapshot,
    syncLegacyTextTierlistBoardSnapshot,
  });
}

async function applyGroundTruthReportChannelLink(client, slot, targetChannelId, { allowClear = false } = {}) {
  return applyManagedChannelLink({
    slot,
    targetChannelId,
    allowClear,
    isPlaceholder,
    clearChannel: (normalizedSlot) => clearGroundTruthReportChannel(normalizedSlot),
    linkChannel: (normalizedSlot, nextChannelId) => linkGroundTruthReportChannel(client, normalizedSlot, nextChannelId),
  });
}

async function linkGroundTruthReportChannel(client, slot, targetChannelId) {
  const normalizedSlot = normalizeSotReportChannelSlot(slot);
  if (!normalizedSlot) {
    throw new Error("Неизвестный channel slot. Используй welcome / review / tierlistText / tierlistGraphic / log.");
  }

  const nextChannelId = String(targetChannelId || "").trim();
  if (!nextChannelId || isPlaceholder(nextChannelId)) {
    throw new Error("Нужно указать текстовый канал.");
  }

  const targetChannel = await client.channels.fetch(nextChannelId).catch(() => null);
  if (!targetChannel?.isTextBased()) {
    throw new Error("Указанный канал не является текстовым.");
  }

  if (normalizedSlot === "welcome") {
    const welcomePanelState = syncLegacyPanelSnapshot(getWelcomePanelState(), getResolvedWelcomePanelSnapshot());
    const nonGgsPanelState = syncLegacyPanelSnapshot(getNonGgsPanelState(), getResolvedNonGgsPanelSnapshot());
    const previousWelcomeState = {
      channelId: String(welcomePanelState.channelId || "").trim(),
      messageId: String(welcomePanelState.messageId || "").trim(),
    };
    const previousNonGgsState = {
      channelId: String(nonGgsPanelState.channelId || "").trim(),
      messageId: String(nonGgsPanelState.messageId || "").trim(),
    };

    welcomePanelState.channelId = nextChannelId;
    welcomePanelState.messageId = "";
    nonGgsPanelState.channelId = nextChannelId;
    nonGgsPanelState.messageId = "";
    saveDb();

    try {
      await refreshWelcomePanel(client);
    } catch (error) {
      welcomePanelState.channelId = previousWelcomeState.channelId;
      welcomePanelState.messageId = previousWelcomeState.messageId;
      nonGgsPanelState.channelId = previousNonGgsState.channelId;
      nonGgsPanelState.messageId = previousNonGgsState.messageId;
      saveDb();
      throw error;
    }

    return `${getSotReportChannelSlotLabel(normalizedSlot)} и non-JJS panel перенесены в ${formatChannelMention(nextChannelId)}.`;
  }

  if (normalizedSlot === "review") {
    const previousChannelId = getResolvedChannelId("review");
    db.config.reviewChannelId = nextChannelId;
    saveDb();
    return previousChannelId && previousChannelId !== nextChannelId
      ? `${getSotReportChannelSlotLabel(normalizedSlot)} channel перенесён в ${formatChannelMention(nextChannelId)}. Было: ${formatChannelMention(previousChannelId)}.`
      : `${getSotReportChannelSlotLabel(normalizedSlot)} channel теперь ${formatChannelMention(nextChannelId)}.`;
  }

  if (normalizedSlot === "tierlistText") {
    const result = await repostTextTierlistBoardToChannel(client, nextChannelId);
    const movedText = result.previousChannelId && result.previousChannelId !== nextChannelId
      ? ` Было: ${formatChannelMention(result.previousChannelId)}.`
      : "";
    return `${getSotReportChannelSlotLabel(normalizedSlot)} перенесён в ${formatChannelMention(nextChannelId)}.${movedText}`;
  }

  if (normalizedSlot === "tierlistGraphic") {
    const result = await repostGraphicTierlistBoardToChannel(client, nextChannelId);
    const movedText = result.previousChannelId && result.previousChannelId !== nextChannelId
      ? ` Было: ${formatChannelMention(result.previousChannelId)}.`
      : "";
    return `${getSotReportChannelSlotLabel(normalizedSlot)} перенесён в ${formatChannelMention(nextChannelId)}.${movedText}`;
  }

  const result = await moveNotificationChannel(client, nextChannelId);
  const movedText = result.previousChannelId && result.previousChannelId !== nextChannelId
    ? ` Было: ${formatChannelMention(result.previousChannelId)}.`
    : "";
  return `${getSotReportChannelSlotLabel(normalizedSlot)} channel перенесён в ${formatChannelMention(nextChannelId)}.${movedText}`;
}

function getTextTierlistPaginationState() {
  db.config.textTierlist ||= {};
  return normalizeTextTierlistPaginationState(db.config.textTierlist);
}

async function refreshTextTierlistBoard(client, options = {}) {
  if (options.forceRecreate || options.invalidateCache) {
    invalidateLiveCharacterStatsContext();
  }
  const state = syncLegacyTextTierlistBoardSnapshot(
    getTextTierlistBoardState(db.config, appConfig.channels.tierlistChannelId || ""),
    getResolvedTextTierlistBoardSnapshot()
  );
  const channelId = String(state.channelId || "").trim();
  if (!channelId || isPlaceholder(channelId)) return null;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    console.warn("tierlistChannelId не указывает на текстовый канал, пропускаем text board");
    return null;
  }

  // Pagination state with 10-min auto-reset.
  const pagination = getTextTierlistPaginationState();
  const now = Date.now();
  const hasExplicitRankPage = Number.isFinite(options.page);
  const hasExplicitRecentPage = Number.isFinite(options.recentPage);
  if (hasExplicitRankPage || hasExplicitRecentPage) {
    if (hasExplicitRankPage) {
      pagination.page = Math.max(0, Math.floor(options.page));
    }
    if (hasExplicitRecentPage) {
      pagination.recentPage = Math.max(0, Math.floor(options.recentPage));
    }
    if (options.forceRecreate && hasExplicitRankPage && !hasExplicitRecentPage) {
      pagination.recentPage = 0;
    }
    if (options.forceRecreate && hasExplicitRecentPage && !hasExplicitRankPage) {
      pagination.page = 0;
    }
    pagination.lastInteractionAt = now;
  } else if (pagination.lastInteractionAt && now - pagination.lastInteractionAt > 10 * 60 * 1000) {
    pagination.page = 0;
    pagination.recentPage = 0;
  }

  const botId = client.user?.id;
  const legacySingleMessage = Boolean(String(state.messageId || "").trim() && !String(state.messageIdSummary || "").trim() && !String(state.messageIdPages || "").trim());
  let summaryMessage = null;
  let pagesMessage = null;
  let recreate = Boolean(options.forceRecreate || legacySingleMessage);

  if (!recreate) {
    summaryMessage = await fetchStoredBotMessage(channel, state, "messageIdSummary", botId);
    pagesMessage = await fetchStoredBotMessage(channel, state, "messageIdPages", botId);
    if (!summaryMessage || !pagesMessage) recreate = true;
  }

  if (recreate) {
    for (const key of ["messageIdSummary", "messageIdPages", "messageId"]) {
      const existing = await fetchStoredBotMessage(channel, state, key, botId);
      if (existing?.deletable) {
        await existing.delete().catch(() => {});
      }
    }
    clearTextTierlistBoardMessageIds(state);
    summaryMessage = null;
    pagesMessage = null;
  }

  const { summaryPayload, pagesPayload } = await buildTextTierlistPayloads(client, {
    page: pagination.page,
    recentPage: pagination.recentPage,
  });
  if (!summaryMessage || !pagesMessage) {
    summaryMessage = await channel.send(summaryPayload);
    try {
      pagesMessage = await channel.send(pagesPayload);
    } catch (error) {
      await summaryMessage.delete().catch(() => {});
      throw error;
    }
  } else {
    await summaryMessage.edit(summaryPayload);
    await pagesMessage.edit(pagesPayload);
  }

  state.channelId = channelId;
  state.messageId = "";
  state.messageIdSummary = summaryMessage.id;
  state.messageIdPages = pagesMessage.id;
  saveDb();
  return { summaryMessage, pagesMessage };
}

async function ensureTextTierlistBoardMessage(client, options = {}) {
  return refreshTextTierlistBoard(client, options);
}

async function resendAllTierlists(client) {
  const result = {
    graphicOk: false,
    textOk: false,
    graphicError: null,
    textError: null,
  };

  try {
    await refreshGraphicTierlistBoard(client, { forceRecreate: true });
    result.graphicOk = true;
  } catch (error) {
    result.graphicError = error;
    console.error("Graphic tierlist resend failed:", error?.message || error);
  }

  try {
    await refreshTextTierlistBoard(client, { forceRecreate: true });
    result.textOk = true;
  } catch (error) {
    result.textError = error;
    console.error("Text tierlist resend failed:", error?.message || error);
  }

  return result;
}

function buildTierlistResendReply(result) {
  if (result?.graphicOk && result?.textOk) {
    return "PNG и текстовый tier-листы отправлены заново.";
  }

  if (result?.textOk && !result?.graphicOk) {
    const graphicError = String(result?.graphicError?.message || result?.graphicError || "неизвестная ошибка").trim();
    return `Текстовый tier-лист пересоздан, но PNG не пересоздался: ${graphicError || "неизвестная ошибка"}.`;
  }

  if (result?.graphicOk && !result?.textOk) {
    const textError = String(result?.textError?.message || result?.textError || "неизвестная ошибка").trim();
    return `PNG tier-лист пересоздан, но текстовый не пересоздался: ${textError || "неизвестная ошибка"}.`;
  }

  const fallback = String(result?.graphicError?.message || result?.textError?.message || result?.graphicError || result?.textError || "неизвестная ошибка").trim();
  return `Не удалось отправить tier-листы заново: ${fallback || "неизвестная ошибка"}.`;
}

async function refreshAllTierlists(client) {
  invalidateLiveCharacterStatsContext();
  const graphicState = getResolvedGraphicTierlistBoardSnapshot();
  const textState = getResolvedTextTierlistBoardSnapshot();
  const hadGraphicMessage = Boolean(graphicState.messageId);
  const result = {
    graphicOk: false,
    textOk: false,
    graphicError: null,
    textError: null,
  };

  try {
    await refreshGraphicTierlistBoard(client);
    result.graphicOk = true;
  } catch (error) {
    result.graphicError = error;
    console.error("Graphic tierlist refresh failed:", error?.message || error);
  }

  try {
    await refreshTextTierlistBoard(client, { forceRecreate: !hadGraphicMessage && hasTextTierlistManagedMessages(textState) });
    result.textOk = true;
  } catch (error) {
    result.textError = error;
    console.error("Text tierlist refresh failed:", error?.message || error);
  }

  return result;
}

async function refreshTierlistBoard(client) {
  return refreshAllTierlists(client);
}

function buildTierlistRefreshReply(result) {
  if (result?.graphicOk && result?.textOk) {
    return "Текстовый и PNG tier-листы обновлены.";
  }

  if (result?.textOk && !result?.graphicOk) {
    const graphicError = String(result?.graphicError?.message || result?.graphicError || "неизвестная ошибка").trim();
    return `Текстовый tier-лист обновлён, но PNG не обновился: ${graphicError || "неизвестная ошибка"}.`;
  }

  if (result?.graphicOk && !result?.textOk) {
    const textError = String(result?.textError?.message || result?.textError || "неизвестная ошибка").trim();
    return `PNG tier-лист обновлён, но текстовый не обновился: ${textError || "неизвестная ошибка"}.`;
  }

  const fallback = String(result?.graphicError?.message || result?.textError?.message || result?.graphicError || result?.textError || "неизвестная ошибка").trim();
  return `Не удалось обновить tier-листы: ${fallback || "неизвестная ошибка"}.`;
}

async function applyUiMutation(client, scope, mutate) {
  return commitMutation({
    mutate,
    persist: saveDb,
    scope,
    refreshers: {
      refreshWelcomePanel: () => refreshWelcomePanel(client),
      refreshGraphicTierlistBoard: () => refreshGraphicTierlistBoard(client),
      refreshTextTierlistBoard: () => refreshTextTierlistBoard(client),
      refreshAllTierlists: () => refreshAllTierlists(client),
      refreshAll: async () => {
        await refreshWelcomePanel(client);
        await refreshAllTierlists(client);
      },
    },
  });
}

async function fetchReviewMessage(client, submission) {
  if (!submission?.reviewChannelId || !submission?.reviewMessageId) return null;
  const channel = await client.channels.fetch(submission.reviewChannelId).catch(() => null);
  if (!channel?.isTextBased()) return null;
  return channel.messages.fetch(submission.reviewMessageId).catch(() => null);
}

async function fetchTrackedTextMessage(client, channelId, messageId) {
  const normalizedChannelId = String(channelId || "").trim();
  const normalizedMessageId = String(messageId || "").trim();
  if (!normalizedChannelId || !normalizedMessageId) {
    return { message: null, missing: true };
  }

  let channel = null;
  try {
    channel = await client.channels.fetch(normalizedChannelId);
  } catch (error) {
    if (isDiscordMissingResourceError(error)) return { message: null, missing: true };
    throw new Error(`Не удалось получить канал ${normalizedChannelId}: ${formatRuntimeError(error)}`);
  }

  if (!channel?.isTextBased?.()) {
    return { message: null, missing: true };
  }

  try {
    return {
      message: await channel.messages.fetch(normalizedMessageId),
      missing: false,
    };
  } catch (error) {
    if (isDiscordMissingResourceError(error)) return { message: null, missing: true };
    throw new Error(`Не удалось получить сообщение ${normalizedMessageId}: ${formatRuntimeError(error)}`);
  }
}

async function deleteTrackedMessage(client, channelId, messageId, label = "сообщение") {
  const { message, missing } = await fetchTrackedTextMessage(client, channelId, messageId);
  if (!message) {
    return { deleted: Boolean(missing), missing: Boolean(missing) };
  }

  try {
    await message.delete();
    return { deleted: true, missing: false };
  } catch (error) {
    if (isDiscordMissingResourceError(error)) {
      return { deleted: true, missing: true };
    }
    throw new Error(`Не удалось удалить ${label}: ${formatRuntimeError(error)}`);
  }
}

async function postReviewRecord(client, submission, fileAttachment = null, statusLabel = "pending", extraFields = [], components = []) {
  const reviewChannelId = getResolvedChannelId("review");
  if (!reviewChannelId || isPlaceholder(reviewChannelId)) {
    throw new Error("reviewChannelId не задан. Открой мод-панель и настрой каналы.");
  }

  const channel = await client.channels.fetch(reviewChannelId).catch(() => null);
  if (!channel?.isTextBased()) throw new Error("reviewChannelId не указывает на текстовый канал");

  const payload = {
    embeds: [buildReviewEmbed(submission, statusLabel, extraFields)],
    components,
  };

  if (fileAttachment) payload.files = [fileAttachment];

  const sent = await channel.send(payload);
  submission.reviewChannelId = sent.channel.id;
  submission.reviewMessageId = sent.id;
  return sent;
}

function createReviewAttachmentFromBuffer(submissionId, buffer) {
  if (!buffer) return null;
  const fileName = sanitizeFileName(`${submissionId}_proof.png`);
  return new AttachmentBuilder(buffer, { name: fileName });
}

async function createPendingSubmissionFromAttachment(client, input) {
  const submissionId = makeId();
  const selectedEntries = getSelectedCharacterEntries(input.mainCharacterIds);
  const derivedTier = killTierFor(input.kills);

  let reviewAttachment = null;
  let reviewImage = input.screenshotUrl;

  try {
    const buffer = await downloadToBuffer(input.screenshotUrl);
    reviewAttachment = createReviewAttachmentFromBuffer(submissionId, buffer);
    if (reviewAttachment?.name) reviewImage = `attachment://${reviewAttachment.name}`;
  } catch {}

  const submission = {
    id: submissionId,
    userId: input.user.id,
    displayName: input.member?.displayName || input.user.username,
    username: input.user.username,
    mainCharacterIds: selectedEntries.map((entry) => entry.id),
    mainCharacterLabels: selectedEntries.map((entry) => entry.label),
    mainRoleIds: selectedEntries.map((entry) => entry.roleId),
    kills: input.kills,
    derivedTier,
    robloxUsername: String(input.robloxUsername || "").trim(),
    robloxUserId: String(input.robloxUserId || "").trim(),
    robloxDisplayName: String(input.robloxDisplayName || "").trim(),
    screenshotUrl: input.screenshotUrl,
    reviewImage,
    status: "pending",
    createdAt: nowIso(),
    reviewedAt: null,
    reviewedBy: null,
    rejectReason: null,
    reviewChannelId: null,
    reviewMessageId: null,
    reviewAttachmentUrl: "",
  };

  const reviewMessage = await postReviewRecord(client, submission, reviewAttachment, "pending", [], [buildReviewButtons(submissionId)]);
  const attachmentUrl = reviewMessage.attachments.first()?.url || "";
  if (attachmentUrl) {
    submission.reviewAttachmentUrl = attachmentUrl;
    if (!submission.reviewImage || submission.reviewImage.startsWith("attachment://")) {
      submission.reviewImage = attachmentUrl;
    }
  }

  const hadProfile = Boolean(db.profiles?.[input.user.id]);
  const previousProfile = cloneJsonValue(db.profiles?.[input.user.id]);
  const hadCooldown = Object.prototype.hasOwnProperty.call(db.cooldowns || {}, input.user.id);
  const previousCooldown = hadCooldown ? db.cooldowns[input.user.id] : undefined;

  try {
    db.submissions[submissionId] = submission;

    const profile = getProfile(input.user.id);
    profile.mainCharacterIds = submission.mainCharacterIds;
    refreshDerivedProfileMainFields(profile);
    profile.displayName = submission.displayName;
    profile.username = submission.username;
    profile.lastSubmissionId = submission.id;
    profile.lastSubmissionStatus = "pending";
    profile.updatedAt = nowIso();
    if (submission.robloxUsername && submission.robloxUserId) {
      writeCanonicalRobloxBinding(input.user.id, profile, submission, {
        verificationStatus: "pending",
        verifiedAt: null,
        updatedAt: profile.updatedAt,
        lastSubmissionId: submission.id,
        lastReviewedAt: null,
        reviewedBy: null,
        source: "onboarding",
      });
    }
    setSubmitCooldown(input.user.id);
    saveDb();
  } catch (error) {
    delete db.submissions[submissionId];
    restoreRecordValue(db.profiles, input.user.id, previousProfile, hadProfile);
    restoreRecordValue(db.cooldowns, input.user.id, previousCooldown, hadCooldown);
    await deleteTrackedMessage(
      client,
      reviewMessage.channel?.id || submission.reviewChannelId,
      reviewMessage.id || submission.reviewMessageId,
      `review-сообщение ${submissionId}`
    ).catch((deleteError) => {
      console.warn(`Submit rollback message cleanup failed for ${submissionId}: ${formatRuntimeError(deleteError)}`);
    });
    throw error;
  }

  await refreshTierlistBoard(client).catch((error) => {
    console.warn(`Tierlist refresh after submit failed: ${formatRuntimeError(error)}`);
  });

  return submission;
}

async function expireSubmission(client, submission) {
  if (!submission || submission.status !== "pending") return;
  submission.status = "expired";
  submission.reviewedAt = nowIso();
  saveDb();

  const reviewMessage = await fetchReviewMessage(client, submission);
  if (reviewMessage) {
    await reviewMessage.edit({
      embeds: [buildReviewEmbed(submission, "expired")],
      components: [],
    }).catch(() => {});
  }

  await refreshTierlistBoard(client);
}

async function supersedePendingSubmissionsForUser(client, userId, moderatorTag) {
  let changed = 0;
  for (const submission of Object.values(db.submissions || {})) {
    if (!submission || submission.userId !== userId || submission.status !== "pending") continue;
    submission.status = "superseded";
    submission.reviewedAt = nowIso();
    submission.reviewedBy = moderatorTag;
    submission.rejectReason = "Заменено модератором напрямую";
    changed += 1;

    const reviewMessage = await fetchReviewMessage(client, submission);
    if (reviewMessage) {
      await reviewMessage.edit({
        embeds: [buildReviewEmbed(submission, "superseded", [{ name: "Причина", value: submission.rejectReason, inline: false }])],
        components: [],
      }).catch(() => {});
    }
  }

  if (changed) saveDb();
}

async function approveSubmission(client, submission, moderatorTag) {
  const tier = killTierFor(submission.kills);
  if (!tier) throw new Error("Не удалось вычислить tier по kills");

  await ensureSingleTierRole(client, submission.userId, tier, "approved welcome submission");

  const profile = getProfile(submission.userId);
  const previousSubmission = cloneJsonValue(submission);
  const previousProfile = cloneJsonValue(profile);

  submission.derivedTier = tier;
  submission.status = "approved";
  submission.reviewedAt = nowIso();
  submission.reviewedBy = moderatorTag;

  profile.mainCharacterIds = submission.mainCharacterIds;
  refreshDerivedProfileMainFields(profile);
  profile.displayName = submission.displayName;
  profile.username = submission.username;
  profile.approvedKills = submission.kills;
  profile.killTier = tier;
  if (!profile.accessGrantedAt || getCurrentOnboardAccessGrantMode() === ONBOARD_ACCESS_GRANT_MODES.AFTER_APPROVE) {
    await maybeGrantAccessRoleAtStage(client, submission.userId, ONBOARD_ACCESS_GRANT_MODES.AFTER_APPROVE, "welcome submission approved");
  }
  profile.lastSubmissionId = submission.id;
  profile.lastSubmissionStatus = "approved";
  profile.lastReviewedAt = submission.reviewedAt;
  profile.updatedAt = nowIso();
  if (submission.robloxUsername && submission.robloxUserId) {
    writeCanonicalRobloxBinding(submission.userId, profile, submission, {
      verificationStatus: "verified",
      verifiedAt: submission.reviewedAt,
      updatedAt: profile.updatedAt,
      lastSubmissionId: submission.id,
      lastReviewedAt: submission.reviewedAt,
      reviewedBy: moderatorTag,
      source: "onboarding",
    });
  }

  try {
    saveDb();
  } catch (error) {
    restoreRecordValue(db.submissions, submission.id, previousSubmission, true);
    restoreRecordValue(db.profiles, submission.userId, previousProfile, true);
    throw error;
  }

  const reviewMessage = await fetchReviewMessage(client, submission);
  if (reviewMessage) {
    await reviewMessage.edit({
      embeds: [buildReviewEmbed(submission, "approved")],
      components: [],
    }).catch((error) => {
      console.warn(`Approve review message update failed for ${submission.id}: ${formatRuntimeError(error)}`);
    });
  }

  await dmUser(
    client,
    submission.userId,
    [
      "Твоя заявка одобрена.",
      `Kills: ${submission.kills}`,
      `Tier: ${submission.derivedTier} (${formatTierLabel(submission.derivedTier)})`,
    ].join("\n")
  ).catch((error) => {
    console.warn(`Approve DM failed for ${submission.userId}: ${formatRuntimeError(error)}`);
  });

  await logLine(client, `APPROVE: <@${submission.userId}> kills ${submission.kills} -> tier ${submission.derivedTier} by ${moderatorTag}`).catch((error) => {
    console.warn(`Approve log failed for ${submission.id}: ${formatRuntimeError(error)}`);
  });
  await refreshTierlistBoard(client).catch((error) => {
    console.warn(`Tierlist refresh after approve failed for ${submission.id}: ${formatRuntimeError(error)}`);
  });
}

async function rejectSubmission(client, submission, moderatorTag, reason) {
  const previousSubmission = cloneJsonValue(submission);
  const profile = getProfile(submission.userId);
  const previousProfile = cloneJsonValue(profile);

  submission.status = "rejected";
  submission.reviewedAt = nowIso();
  submission.reviewedBy = moderatorTag;
  submission.rejectReason = reason;

  profile.lastSubmissionId = submission.id;
  profile.lastSubmissionStatus = "rejected";
  profile.lastReviewedAt = submission.reviewedAt;
  profile.updatedAt = nowIso();
  if (submission.robloxUsername && submission.robloxUserId) {
    writeCanonicalRobloxBinding(submission.userId, profile, submission, {
      verificationStatus: "failed",
      updatedAt: profile.updatedAt,
      lastSubmissionId: submission.id,
      lastReviewedAt: submission.reviewedAt,
      reviewedBy: moderatorTag,
      source: "onboarding",
    });
  }

  try {
    saveDb();
  } catch (error) {
    restoreRecordValue(db.submissions, submission.id, previousSubmission, true);
    restoreRecordValue(db.profiles, submission.userId, previousProfile, true);
    throw error;
  }

  const reviewMessage = await fetchReviewMessage(client, submission);
  if (reviewMessage) {
    await reviewMessage.edit({
      embeds: [buildReviewEmbed(submission, "rejected", [{ name: "Причина", value: reason, inline: false }])],
      components: [],
    }).catch((error) => {
      console.warn(`Reject review message update failed for ${submission.id}: ${formatRuntimeError(error)}`);
    });
  }

  await dmUser(
    client,
    submission.userId,
    [
      "Твоя заявка отклонена.",
      `Причина: ${reason}`,
      `Kills: ${submission.kills}`,
    ].join("\n")
  ).catch((error) => {
    console.warn(`Reject DM failed for ${submission.userId}: ${formatRuntimeError(error)}`);
  });

  await logLine(client, `REJECT: <@${submission.userId}> kills ${submission.kills} by ${moderatorTag} | reason: ${reason}`).catch((error) => {
    console.warn(`Reject log failed for ${submission.id}: ${formatRuntimeError(error)}`);
  });
  await refreshTierlistBoard(client).catch((error) => {
    console.warn(`Tierlist refresh after reject failed for ${submission.id}: ${formatRuntimeError(error)}`);
  });
}

async function updateSubmissionKills(client, submission, kills, moderatorTag) {
  submission.kills = kills;
  submission.derivedTier = killTierFor(kills);
  saveDb();

  const reviewMessage = await fetchReviewMessage(client, submission);
  if (reviewMessage) {
    await reviewMessage.edit({
      embeds: [buildReviewEmbed(submission, "pending", [{ name: "Изменено", value: `Kills исправил: ${moderatorTag}`, inline: false }])],
      components: [buildReviewButtons(submission.id)],
    }).catch(() => {});
  }
}

async function updatePendingSubmissionRobloxIdentity(client, submission, robloxUser, moderatorTag = null) {
  const previousSubmission = cloneJsonValue(submission);
  const profile = getProfile(submission.userId);
  const previousProfile = cloneJsonValue(profile);

  profile.updatedAt = nowIso();
  const bindingResult = writeCanonicalRobloxBinding(submission.userId, profile, robloxUser, {
    verificationStatus: "pending",
    verifiedAt: null,
    updatedAt: profile.updatedAt,
    lastSubmissionId: submission.id,
    lastReviewedAt: null,
    reviewedBy: moderatorTag,
    source: "onboarding",
  });
  submission.robloxUsername = bindingResult?.snapshot?.username || "";
  submission.robloxUserId = bindingResult?.snapshot?.userId || "";
  submission.robloxDisplayName = bindingResult?.snapshot?.displayName || "";

  try {
    saveDb();
  } catch (error) {
    restoreRecordValue(db.submissions, submission.id, previousSubmission, true);
    restoreRecordValue(db.profiles, submission.userId, previousProfile, true);
    throw error;
  }

  const reviewMessage = await fetchReviewMessage(client, submission);
  if (reviewMessage) {
    await reviewMessage.edit({
      embeds: [buildReviewEmbed(submission, "pending", [{ name: "Изменено", value: moderatorTag ? `Roblox username подтвердил: ${moderatorTag}` : "Игрок добавил Roblox username", inline: false }])],
      components: [buildReviewButtons(submission.id)],
    }).catch(() => {});
  }
}

async function createManualApprovedRecord(client, targetUser, screenshotAttachment, kills, moderatorTag) {
  const member = await fetchMember(client, targetUser.id);
  const profile = getProfile(targetUser.id);
  const mainCharacterIds = [...(profile.mainCharacterIds || [])];
  const selectedEntries = getSelectedCharacterEntries(mainCharacterIds);
  const submissionId = makeId();
  const derivedTier = killTierFor(kills);

  let reviewAttachment = null;
  let reviewImage = screenshotAttachment.url;

  try {
    const buffer = await downloadToBuffer(screenshotAttachment.url);
    reviewAttachment = createReviewAttachmentFromBuffer(submissionId, buffer);
    if (reviewAttachment?.name) reviewImage = `attachment://${reviewAttachment.name}`;
  } catch {}

  const submission = {
    id: submissionId,
    userId: targetUser.id,
    displayName: member?.displayName || targetUser.username,
    username: targetUser.username,
    mainCharacterIds: selectedEntries.map((entry) => entry.id),
    mainCharacterLabels: selectedEntries.map((entry) => entry.label),
    mainRoleIds: selectedEntries.map((entry) => entry.roleId),
    kills,
    derivedTier,
    screenshotUrl: screenshotAttachment.url,
    reviewImage,
    status: "approved",
    createdAt: nowIso(),
    reviewedAt: nowIso(),
    reviewedBy: moderatorTag,
    rejectReason: null,
    reviewChannelId: null,
    reviewMessageId: null,
    reviewAttachmentUrl: "",
    manual: true,
  };

  const reviewMessage = await postReviewRecord(
    client,
    submission,
    reviewAttachment,
    "approved",
    [{ name: "Источник", value: `Ручное добавление модератором: ${moderatorTag}`, inline: false }],
    []
  );

  const attachmentUrl = reviewMessage.attachments.first()?.url || "";
  if (attachmentUrl) {
    submission.reviewAttachmentUrl = attachmentUrl;
    if (!submission.reviewImage || submission.reviewImage.startsWith("attachment://")) {
      submission.reviewImage = attachmentUrl;
    }
  }

  db.submissions[submission.id] = submission;
  try {
    await approveSubmission(client, submission, moderatorTag);
  } catch (error) {
    delete db.submissions[submission.id];
    await deleteTrackedMessage(
      client,
      reviewMessage.channel?.id || submission.reviewChannelId,
      reviewMessage.id || submission.reviewMessageId,
      `review-сообщение ${submission.id}`
    ).catch((deleteError) => {
      console.warn(`Manual approve rollback message cleanup failed for ${submission.id}: ${formatRuntimeError(deleteError)}`);
    });
    throw error;
  }
  return submission;
}

function buildProfilePayload(userId) {
  const profile = getProfile(userId);
  const pending = getPendingSubmissionForUser(userId);
  const latest = getLatestSubmissionForUser(userId);
  const tierlistEntries = getApprovedTierlistEntries();
  const rank = tierlistEntries.findIndex((entry) => entry.userId === userId);

  const lines = [];
  lines.push(`Имя: **${getProfileDisplayName(userId, profile)}**`);
  lines.push(`Мейны: **${profile.mainCharacterLabels?.length ? profile.mainCharacterLabels.join(", ") : "не выбраны"}**`);

  if (profile.approvedKills !== null && profile.killTier !== null) {
    lines.push(`Статус: **approved**`);
    lines.push(`Kills: **${profile.approvedKills}**`);
    lines.push(`Tier: **${profile.killTier}** (${formatTierLabel(profile.killTier)})`);
    if (rank >= 0) lines.push(`Позиция в тир-листе: **#${rank + 1} из ${tierlistEntries.length}**`);
    lines.push(`Последняя проверка: **${formatDateTime(profile.lastReviewedAt)}**`);
  } else if (pending) {
    lines.push(`Статус: **pending**`);
    lines.push(`Kills в заявке: **${pending.kills}**`);
    lines.push(`Tier по заявке: **${pending.derivedTier}** (${formatTierLabel(pending.derivedTier)})`);
    lines.push(`Создано: **${formatDateTime(pending.createdAt)}**`);
  } else if (latest?.status === "rejected") {
    lines.push(`Статус: **rejected**`);
    lines.push(`Последняя причина: **${latest.rejectReason || "не указана"}**`);
    lines.push(`Проверено: **${formatDateTime(latest.reviewedAt)}**`);
  } else {
    lines.push("Статус: **ещё не подтверждён**");
  }

  if (profile.accessGrantedAt) {
    lines.push(`Стартовая роль выдана: **${formatDateTime(profile.accessGrantedAt)}**`);
  }
  if (profile.nonGgsAccessGrantedAt) {
    lines.push(`Отдельная роль без JJS выдана: **${formatDateTime(profile.nonGgsAccessGrantedAt)}**`);
  }

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("Профиль участника")
        .setDescription(lines.join("\n")),
    ],
    flags: MessageFlags.Ephemeral,
  };
}

function getRolePanelDraftErrorText(errors) {
  const labels = {
    channelId: "канал",
    buttons: "хотя бы одна кнопка с ролью",
    content: "текст сообщения",
    embedContent: "embed-контент",
  };

  const parts = [...new Set((errors || []).map((error) => labels[error] || error))];
  return parts.length ? `Заполни: ${parts.join(", ")}.` : "Черновик заполнен не полностью.";
}

function buildRoleGrantMessagePayload(record, options = {}) {
  const disabled = Boolean(options.disabled || record?.disabledAt);
  const buttons = Array.isArray(record?.buttons) ? record.buttons : [];

  const rows = [];
  for (let rowStart = 0; rowStart < buttons.length; rowStart += 5) {
    const rowButtons = buttons.slice(rowStart, rowStart + 5).map((btn, localIdx) => {
      const globalIdx = rowStart + localIdx;
      return new ButtonBuilder()
        .setCustomId(buildRoleGrantCustomId(record.id, globalIdx) || `rolepanel_grant_disabled_${globalIdx}`)
        .setLabel(String(btn.label || DEFAULT_ROLE_PANEL_BUTTON_LABEL).trim().slice(0, 80) || DEFAULT_ROLE_PANEL_BUTTON_LABEL)
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled);
    });
    rows.push(new ActionRowBuilder().addComponents(...rowButtons));
  }

  if (rows.length === 0) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("rolepanel_grant_disabled_empty").setLabel(DEFAULT_ROLE_PANEL_BUTTON_LABEL).setStyle(ButtonStyle.Success).setDisabled(true)
    ));
  }

  const payload = { components: rows };

  if (record?.format === ROLE_PANEL_FORMATS.EMBED) {
    const embed = new EmbedBuilder();
    if (record.embedTitle) embed.setTitle(record.embedTitle);
    if (record.embedDescription) embed.setDescription(record.embedDescription);
    payload.embeds = [embed];
  } else {
    payload.content = String(record?.content || "").trim();
  }

  return payload;
}

function buildRolePanelPreviewRows(draft) {
  const buttons = Array.isArray(draft?.buttons) ? draft.buttons : [];
  if (buttons.length === 0) {
    return [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("rolepanel_preview_button_empty").setLabel(DEFAULT_ROLE_PANEL_BUTTON_LABEL).setStyle(ButtonStyle.Success).setDisabled(true)
    )];
  }
  const rows = [];
  for (let rowStart = 0; rowStart < buttons.length && rows.length < 4; rowStart += 5) {
    const rowButtons = buttons.slice(rowStart, rowStart + 5).map((btn, localIdx) =>
      new ButtonBuilder()
        .setCustomId(`rolepanel_preview_button_${rowStart + localIdx}`)
        .setLabel(String(btn.label || DEFAULT_ROLE_PANEL_BUTTON_LABEL).trim().slice(0, 80) || DEFAULT_ROLE_PANEL_BUTTON_LABEL)
        .setStyle(ButtonStyle.Success)
        .setDisabled(true)
    );
    rows.push(new ActionRowBuilder().addComponents(...rowButtons));
  }
  return rows;
}

function buildRolePanelHomePayload(statusText = "", includeFlags = true) {
  const activeRecords = listRoleGrantRecords({ activeOnly: true });
  const allRecords = listRoleGrantRecords({ activeOnly: false });
  const embed = new EmbedBuilder()
    .setTitle("Role Panel")
    .setDescription([
      "Панель для ивент-сообщений с кнопкой выдачи роли и массового снятия роли.",
      `Активных сообщений выдачи: **${formatNumber(activeRecords.length)}**`,
      `Всего сохранённых сообщений: **${formatNumber(allRecords.length)}**`,
      "Discord не умеет делать физически большие кнопки, поэтому самая заметная подача здесь - одна кнопка в отдельной строке.",
    ].join("\n"))
    .addFields(
      { name: "Конструктор сообщения", value: "Выбери канал, текст, подпись кнопки и роль, которую выдаст нажатие.", inline: true },
      { name: "Массовое снятие", value: "Снимает выбранную роль у всех участников сервера с обязательным подтверждением.", inline: true },
      { name: "Управление сообщениями", value: "Список уже опубликованных сообщений с точечным отключением и повторной публикацией.", inline: true },
      { name: "Последние активные выдачи", value: getRoleGrantSummaryLines(activeRecords).join("\n"), inline: false }
    );

  if (statusText) {
    embed.addFields({ name: "Последнее действие", value: statusText, inline: false });
  }

  const payload = {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("rolepanel_open_compose").setLabel("Создать сообщение").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("rolepanel_open_records").setLabel("Список сообщений").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("rolepanel_open_cleanup").setLabel("Забрать роль у всех").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("rolepanel_refresh_home").setLabel("Обновить").setStyle(ButtonStyle.Secondary)
      ),
    ],
  };

  return includeFlags ? ephemeralPayload(payload) : payload;
}

function buildRolePanelComposerPayload(userId, statusText = "", includeFlags = true) {
  const draft = ensureRolePanelDraft(userId);
  const validation = validateRoleMessageDraft(draft);
  const buttons = Array.isArray(draft.buttons) ? draft.buttons : [];

  const contentPreview = draft.format === ROLE_PANEL_FORMATS.EMBED
    ? [
        draft.embedTitle ? `Заголовок: ${draft.embedTitle}` : "",
        draft.embedDescription ? `Текст: ${draft.embedDescription}` : "",
      ].filter(Boolean).join("\n")
    : draft.content;

  const buttonLines = buttons.length
    ? buttons.map((b, i) => `${i + 1}. ${previewFieldText(b.label, 50)} → ${formatRoleMention(b.roleId)}`).join("\n")
    : "_нет кнопок_";

  const embed = new EmbedBuilder()
    .setTitle("Role Panel • Конструктор")
    .setDescription("Собери сообщение и опубликуй его в нужный канал. Можно добавить до 20 кнопок, каждая — со своей ролью.")
    .addFields(
      { name: "Канал", value: formatChannelMention(draft.channelId), inline: true },
      { name: "Формат", value: draft.format === ROLE_PANEL_FORMATS.EMBED ? "embed" : "обычный текст", inline: true },
      { name: "Авто-переотправка", value: getAutoResendIntervalLabel(draft.autoResendIntervalMs || 0), inline: true },
      { name: "Кнопки", value: buttonLines, inline: false },
      { name: draft.format === ROLE_PANEL_FORMATS.EMBED ? "Embed preview" : "Текст сообщения", value: previewFieldText(contentPreview), inline: false },
      {
        name: "Готовность к публикации",
        value: validation.isValid ? "Черновик заполнен. Можно публиковать." : getRolePanelDraftErrorText(validation.errors),
        inline: false,
      }
    );

  if (statusText) {
    embed.addFields({ name: "Последнее действие", value: statusText, inline: false });
  }

  const canAddButton = buttons.length < ROLE_PANEL_MAX_BUTTONS;
  const hasButtons = buttons.length > 0;

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("rolepanel_compose_pick_channel").setLabel(draft.channelId ? "Сменить канал" : "Выбрать канал").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("rolepanel_compose_format_plain").setLabel("Обычный текст").setStyle(draft.format === ROLE_PANEL_FORMATS.PLAIN ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("rolepanel_compose_format_embed").setLabel("Embed").setStyle(draft.format === ROLE_PANEL_FORMATS.EMBED ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("rolepanel_compose_edit_message").setLabel(draft.format === ROLE_PANEL_FORMATS.EMBED ? "Настроить embed" : "Текст сообщения").setStyle(ButtonStyle.Primary)
  );

  const row2Buttons = [
    new ButtonBuilder().setCustomId("rolepanel_compose_add_button").setLabel("Добавить кнопку").setStyle(ButtonStyle.Success).setDisabled(!canAddButton),
  ];

  if (hasButtons) {
    row2Buttons.push(
      new ButtonBuilder().setCustomId("rolepanel_compose_edit_button_select").setLabel("Изменить кнопку").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("rolepanel_compose_remove_button_select").setLabel("Удалить кнопку").setStyle(ButtonStyle.Danger)
    );
  }

  const row2 = new ActionRowBuilder().addComponents(...row2Buttons);

  const row3 = buildComposerAutoResendSelectRow(draft);

  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("rolepanel_compose_publish").setLabel("Опубликовать").setStyle(ButtonStyle.Success).setDisabled(!validation.isValid),
    new ButtonBuilder().setCustomId("rolepanel_compose_reset").setLabel("Сбросить").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("rolepanel_home").setLabel("Назад").setStyle(ButtonStyle.Secondary)
  );

  const payload = {
    embeds: [embed],
    components: [row1, row2, row3, row4],
  };

  return includeFlags ? ephemeralPayload(payload) : payload;
}

function buildRoleCleanupPayload(userId, statusText = "", includeFlags = true) {
  const selection = getRoleCleanupSelection(userId);
  const selectedRoleId = String(selection?.roleId || "").trim();
  const matchingRecords = selectedRoleId ? listRoleGrantRecords({ roleId: selectedRoleId, activeOnly: true }) : [];
  const embed = new EmbedBuilder()
    .setTitle("Role Panel • Массовое снятие")
    .setDescription("Выбери роль через отдельный браузер с поиском по имени или ID, проверь связанные сообщения и только потом запускай массовое снятие.")
    .addFields(
      { name: "Выбранная роль", value: formatRoleMention(selectedRoleId), inline: true },
      { name: "Активные сообщения выдачи", value: String(matchingRecords.length || 0), inline: true },
      { name: "Что произойдёт", value: "После подтверждения бот снимет роль у всех текущих участников сервера с этой ролью.", inline: false },
      { name: "Связанные сообщения", value: getRoleGrantSummaryLines(matchingRecords, 4).join("\n"), inline: false }
    );

  if (statusText) {
    embed.addFields({ name: "Последнее действие", value: statusText, inline: false });
  }

  const payload = {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("rolepanel_cleanup_pick_role").setLabel(selectedRoleId ? "Сменить роль" : "Выбрать роль").setStyle(ButtonStyle.Primary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("rolepanel_cleanup_confirm_screen").setLabel("Перейти к подтверждению").setStyle(ButtonStyle.Danger).setDisabled(!selectedRoleId),
        new ButtonBuilder().setCustomId("rolepanel_home").setLabel("Назад").setStyle(ButtonStyle.Secondary)
      ),
    ],
  };

  return includeFlags ? ephemeralPayload(payload) : payload;
}

function buildRolePanelRecordsPayload(userId, statusText = "", includeFlags = true) {
  const records = listRoleGrantRecords({ activeOnly: false });
  const record = getSelectedRoleGrantRecord(userId);
  const messageLink = getRoleGrantMessageUrl(record);
  const preview = record
    ? record.format === ROLE_PANEL_FORMATS.EMBED
      ? [
          record.embedTitle ? `Заголовок: ${record.embedTitle}` : "",
          record.embedDescription ? `Текст: ${record.embedDescription}` : "",
        ].filter(Boolean).join("\n")
      : record.content
    : "";

  const embed = new EmbedBuilder()
    .setTitle("Role Panel • Список сообщений")
    .setDescription(records.length
      ? "Выбери опубликованное сообщение и управляй им точечно: удаляй, отключай, повторно публикуй или настраивай авто-переотправку."
      : "Пока нет опубликованных сообщений этой панели.");

  if (record) {
    const recordButtons = Array.isArray(record.buttons) ? record.buttons : [];
    const buttonsValue = recordButtons.length
      ? recordButtons.map((b, i) => `${i + 1}. ${previewFieldText(b.label, 50)} → ${formatRoleMention(b.roleId)}`).join("\n")
      : "—";
    embed.addFields(
      { name: "Статус", value: record.disabledAt ? `выключено (${formatDateTime(record.disabledAt)})` : "активно", inline: true },
      { name: "Канал", value: formatChannelMention(record.channelId), inline: true },
      { name: "ID сообщения", value: record.messageId || "—", inline: true },
      { name: "Формат", value: record.format === ROLE_PANEL_FORMATS.EMBED ? "embed" : "обычный текст", inline: true },
      { name: "Авто-переотправка", value: getAutoResendIntervalLabel(record.autoResendIntervalMs || 0), inline: true },
      { name: "Кнопки", value: buttonsValue, inline: false },
      { name: "Ссылка", value: messageLink ? `[Открыть сообщение](${messageLink})` : "—", inline: false },
      { name: "Содержимое", value: previewFieldText(preview), inline: false }
    );

    if (record.disabledReason) {
      embed.addFields({ name: "Причина отключения", value: previewFieldText(record.disabledReason, 300), inline: false });
    }
  }

  if (statusText) {
    embed.addFields({ name: "Последнее действие", value: statusText, inline: false });
  }

  const disabledCount = records.filter((r) => r.disabledAt).length;
  const components = [];
  if (records.length) {
    components.push(buildRoleRecordSelectRow(userId, records));
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("rolepanel_records_delete").setLabel("Удалить сообщение").setStyle(ButtonStyle.Danger).setDisabled(!record),
        new ButtonBuilder().setCustomId("rolepanel_records_disable").setLabel("Отключить кнопку").setStyle(ButtonStyle.Danger).setDisabled(!record || Boolean(record?.disabledAt)),
        new ButtonBuilder().setCustomId("rolepanel_records_republish").setLabel("Переопубликовать").setStyle(ButtonStyle.Success).setDisabled(!record),
        new ButtonBuilder().setCustomId("rolepanel_records_load_draft").setLabel("В конструктор").setStyle(ButtonStyle.Secondary).setDisabled(!record)
      )
    );
    components.push(buildAutoResendSelectRow(record));
  }
  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("rolepanel_records_purge").setLabel(`Очистить историю (${disabledCount})`).setStyle(ButtonStyle.Secondary).setDisabled(!disabledCount),
      new ButtonBuilder().setCustomId("rolepanel_open_records").setLabel("Обновить").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("rolepanel_home").setLabel("Назад").setStyle(ButtonStyle.Secondary)
    )
  );

  const payload = {
    embeds: [embed],
    components,
  };

  return includeFlags ? ephemeralPayload(payload) : payload;
}

function buildRoleCleanupConfirmPayload(userId, statusText = "", includeFlags = true) {
  const selection = getRoleCleanupSelection(userId);
  const selectedRoleId = String(selection?.roleId || "").trim();
  if (!selectedRoleId) {
    return buildRoleCleanupPayload(userId, "Сначала выбери роль для снятия.", includeFlags);
  }

  const matchingRecords = listRoleGrantRecords({ roleId: selectedRoleId, activeOnly: true });
  const embed = new EmbedBuilder()
    .setTitle("Role Panel • Подтверждение")
    .setDescription([
      `Роль для снятия: ${formatRoleMention(selectedRoleId)}`,
      `Активных сообщений выдачи с этой ролью: **${formatNumber(matchingRecords.length)}**`,
      "Ниже выбери, оставить старые кнопки активными или сразу отключить все связанные сообщения.",
    ].join("\n"));

  if (statusText) {
    embed.addFields({ name: "Последнее действие", value: statusText, inline: false });
  }

  const payload = {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`rolepanel_cleanup_run:${ROLE_PANEL_CLEANUP_BEHAVIORS.KEEP_MESSAGES}`).setLabel("Снять и оставить кнопки").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`rolepanel_cleanup_run:${ROLE_PANEL_CLEANUP_BEHAVIORS.DISABLE_MESSAGES}`).setLabel("Снять и отключить кнопки").setStyle(ButtonStyle.Danger)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("rolepanel_open_cleanup").setLabel("Назад к выбору роли").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("rolepanel_home").setLabel("В корень").setStyle(ButtonStyle.Secondary)
      ),
    ],
  };

  return includeFlags ? ephemeralPayload(payload) : payload;
}

async function fetchRoleForPanel(client, roleId) {
  const guild = await getGuild(client);
  if (!guild) return null;
  const key = String(roleId || "").trim();
  if (!key) return null;
  return guild.roles.cache.get(key) || guild.roles.fetch(key).catch(() => null);
}

async function fetchChannelForRolePanel(client, channelId) {
  const channel = await client.channels.fetch(String(channelId || "").trim()).catch(() => null);
  if (!channel?.isTextBased?.() || typeof channel.send !== "function") return null;
  return channel;
}

async function disableRoleGrantRecord(client, record, reason = "") {
  if (!record?.id) return false;
  // Always mutate the actual db entry, not a copy from normalizeRoleGrantRegistry
  const actualRecord = getRoleGrantRegistry()[record.id];
  if (!actualRecord || actualRecord.disabledAt) return false;

  actualRecord.disabledAt = nowIso();
  actualRecord.disabledReason = String(reason || "").trim().slice(0, 300);

  const channel = await client.channels.fetch(actualRecord.channelId).catch(() => null);
  const message = channel?.messages?.fetch ? await channel.messages.fetch(actualRecord.messageId).catch(() => null) : null;
  if (message) {
    await message.edit(buildRoleGrantMessagePayload(actualRecord, { disabled: true })).catch(() => {});
  }

  return true;
}

async function deleteRoleGrantMessage(client, record, reason = "") {
  if (!record?.id) return false;
  // Remove from registry immediately — "delete" means gone, not just disabled
  const registry = getRoleGrantRegistry();
  const actualRecord = registry[record.id];
  if (!actualRecord) return false;

  await deleteTrackedMessage(
    client,
    actualRecord.channelId,
    actualRecord.messageId,
    `role grant message ${actualRecord.messageId}`
  );

  delete registry[actualRecord.id];
  // Caller is responsible for saveDb()
  return true;
}

function purgeDisabledRoleGrantRecords() {
  const registry = getRoleGrantRegistry();
  let purgedCount = 0;
  for (const [key, record] of Object.entries(registry)) {
    if (record.disabledAt) {
      delete registry[key];
      purgedCount += 1;
    }
  }
  if (purgedCount) saveDb();
  return purgedCount;
}

async function autoResendRoleGrantMessage(client, record) {
  if (!record?.id) return false;
  // Always work from the actual db entry to ensure mutations persist in saveDb()
  const actualRecord = getRoleGrantRegistry()[record.id];
  if (!actualRecord || actualRecord.disabledAt || !actualRecord.autoResendIntervalMs) return false;

  const channel = await client.channels.fetch(actualRecord.channelId).catch(() => null);
  if (!channel?.isTextBased?.() || typeof channel.send !== "function") return false;

  const lastMessages = await channel.messages.fetch({ limit: 1 }).catch(() => null);
  const lastMessage = lastMessages?.first?.();
  if (lastMessage && lastMessage.id === actualRecord.messageId) return false;

  const oldMessage = channel.messages?.cache?.get(actualRecord.messageId)
    || await channel.messages.fetch(actualRecord.messageId).catch(() => null);
  if (oldMessage) {
    await oldMessage.delete().catch(() => {});
  }

  let sentMessage;
  try {
    sentMessage = await channel.send(buildRoleGrantMessagePayload(actualRecord));
  } catch {
    return false;
  }

  actualRecord.messageId = sentMessage.id;
  actualRecord.lastAutoResendAt = nowIso();
  saveDb();
  return true;
}

async function runAutoResendTick(client) {
  const records = listRoleGrantRecords({ activeOnly: true });
  const now = Date.now();

  for (const record of records) {
    if (!record.autoResendIntervalMs || record.autoResendIntervalMs <= 0) continue;

    // Re-read from registry in case record was deleted/disabled since we built the list
    const liveRecord = getRoleGrantRecord(record.id);
    if (!liveRecord || liveRecord.disabledAt) continue;

    const lastResend = Date.parse(liveRecord.lastAutoResendAt || liveRecord.createdAt || 0);
    if (!Number.isFinite(lastResend) || now - lastResend < liveRecord.autoResendIntervalMs) continue;

    try {
      const resent = await autoResendRoleGrantMessage(client, liveRecord);
      if (resent) {
        const updated = getRoleGrantRecord(liveRecord.id);
        await logLine(client, `ROLE_PANEL_AUTO_RESEND: record=${liveRecord.id} channel=${liveRecord.channelId} newMessage=${updated?.messageId || liveRecord.messageId}`);
      } else {
        // Panel is already the last message — no resend needed, but reset the timer
        // so the tick doesn't re-check every 5 minutes until the next 12-hour window.
        const freshRecord = getRoleGrantRecord(liveRecord.id);
        if (freshRecord && !freshRecord.disabledAt && freshRecord.autoResendIntervalMs > 0) {
          freshRecord.lastAutoResendAt = nowIso();
          saveDb();
        }
      }
    } catch (error) {
      console.error(`Auto-resend error for record ${record.id}:`, error);
    }
  }
}

function getAutoResendIntervalLabel(intervalMs) {
  const entry = ROLE_PANEL_AUTO_RESEND_INTERVALS.find((i) => i.value === intervalMs);
  return entry ? entry.label : "Выключено";
}

async function disableRoleGrantMessagesForRole(client, roleId, reason = "") {
  const records = listRoleGrantRecords({ roleId, activeOnly: true });
  let disabledCount = 0;

  for (const record of records) {
    if (await disableRoleGrantRecord(client, record, reason)) {
      disabledCount += 1;
    }
  }

  if (disabledCount) saveDb();
  return disabledCount;
}

async function publishRoleGrantMessage(client, moderator, rawDraft) {
  const validation = validateRoleMessageDraft(rawDraft);
  if (!validation.isValid) {
    throw new Error(getRolePanelDraftErrorText(validation.errors));
  }

  const draft = validation.draft;

  const channel = await fetchChannelForRolePanel(client, draft.channelId);
  if (!channel) {
    throw new Error("Выбранный канал не поддерживает отправку сообщений ботом.");
  }

  const record = {
    id: makeId(),
    channelId: channel.id,
    messageId: "",
    buttons: draft.buttons,
    format: draft.format,
    content: draft.content,
    embedTitle: draft.embedTitle,
    embedDescription: draft.embedDescription,
    createdBy: String(moderator?.id || "").trim(),
    createdAt: nowIso(),
    disabledAt: "",
    disabledReason: "",
    autoResendIntervalMs: Number(draft.autoResendIntervalMs) || 0,
    lastAutoResendAt: "",
  };

  let sentMessage;
  try {
    sentMessage = await channel.send(buildRoleGrantMessagePayload(record));
  } catch (error) {
    throw new Error(`Не удалось отправить сообщение: ${String(error?.message || error || "неизвестная ошибка")}`);
  }

  record.messageId = sentMessage.id;
  getRoleGrantRegistry()[record.id] = record;
  saveDb();
  await logLine(client, `ROLE_PANEL_PUBLISH: buttons=${record.buttons.length} channel=${record.channelId} message=${record.messageId} by ${moderator?.tag || moderator?.id || "unknown"}`);
  return record;
}

async function republishRoleGrantRecord(client, moderator, record) {
  if (!record) {
    throw new Error("Сообщение для повторной публикации не найдено.");
  }

  const nextRecord = await publishRoleGrantMessage(client, moderator, createRoleMessageDraftFromRecord(record));
  // Delete the old Discord message and remove from registry so only the new record is active
  await deleteRoleGrantMessage(client, record, `superseded by republish ${nextRecord.id}`);
  saveDb();
  return nextRecord;
}

async function grantRoleFromRolePanelMessage(client, interaction, record, buttonIndex = 0) {
  if (!record) {
    await interaction.reply(ephemeralPayload({ content: "Эта выдача больше не существует." }));
    return;
  }

  if (record.disabledAt) {
    await interaction.reply(ephemeralPayload({ content: "Эта выдача уже закрыта. Попроси модератора опубликовать новое сообщение." }));
    return;
  }

  const button = Array.isArray(record.buttons) ? record.buttons[Number(buttonIndex) || 0] : null;
  if (!button?.roleId) {
    await interaction.reply(ephemeralPayload({ content: "Кнопка не найдена или роль не привязана." }));
    return;
  }

  const member = await fetchMember(client, interaction.user.id);
  if (!member) {
    await interaction.reply(ephemeralPayload({ content: "Не удалось найти тебя на сервере. Попробуй зайти заново." }));
    return;
  }

  const role = await fetchRoleForPanel(client, button.roleId);
  if (!role) {
    await interaction.reply(ephemeralPayload({ content: "Эта роль уже удалена." }));
    return;
  }

  if (!role.editable) {
    await interaction.reply(ephemeralPayload({ content: "Бот сейчас не может выдать эту роль. Нужны Manage Roles и позиция выше роли." }));
    return;
  }

  if (member.roles.cache.has(role.id)) {
    await interaction.reply(ephemeralPayload({ content: `У тебя уже есть роль ${formatRoleMention(role.id)}.` }));
    return;
  }

  try {
    await member.roles.add(role.id, `rolepanel grant ${record.id}`);
  } catch (error) {
    await interaction.reply(ephemeralPayload({ content: `Не удалось выдать роль: ${String(error?.message || error || "неизвестная ошибка")}` }));
    return;
  }

  await interaction.reply(ephemeralPayload({ content: `Готово. Тебе выдана роль ${formatRoleMention(role.id)}.` }));
}

async function removeRoleFromAllMembers(client, roleId, behavior, moderatorTag) {
  const role = await fetchRoleForPanel(client, roleId);
  if (!role) {
    const disabledCount = behavior === ROLE_PANEL_CLEANUP_BEHAVIORS.DISABLE_MESSAGES
      ? await disableRoleGrantMessagesForRole(client, roleId, `cleanup requested by ${moderatorTag}`)
      : 0;

    await logLine(client, `ROLE_PANEL_CLEANUP: role=${roleId} missing disabledMessages=${disabledCount} behavior=${behavior} by ${moderatorTag}`);
    return {
      role: null,
      missingRole: true,
      matchedMembers: 0,
      removed: 0,
      failed: 0,
      disabledCount,
    };
  }

  if (!role.editable) {
    throw new Error("Бот не может снять эту роль. Подними его выше роли и проверь Manage Roles.");
  }

  const guild = role.guild || await getGuild(client);
  if (!guild) {
    throw new Error("Не удалось получить сервер для массового снятия роли.");
  }

  await guild.members.fetch();
  const holders = guild.members.cache.filter((member) => member.roles.cache.has(role.id));
  let removed = 0;
  let failed = 0;

  for (const member of holders.values()) {
    try {
      await member.roles.remove(role.id, `rolepanel cleanup by ${moderatorTag}`);
      removed += 1;
    } catch {
      failed += 1;
    }
  }

  const disabledCount = behavior === ROLE_PANEL_CLEANUP_BEHAVIORS.DISABLE_MESSAGES
    ? await disableRoleGrantMessagesForRole(client, role.id, `cleanup requested by ${moderatorTag}`)
    : 0;

  await logLine(
    client,
    `ROLE_PANEL_CLEANUP: role=${role.id} holders=${holders.size} removed=${removed} failed=${failed} disabledMessages=${disabledCount} behavior=${behavior} by ${moderatorTag}`
  );

  return {
    role,
    missingRole: false,
    matchedMembers: holders.size,
    removed,
    failed,
    disabledCount,
  };
}

async function buildModeratorPanelPayload(client, statusText = "", includeFlags = true) {
  const liveContext = await getLiveCharacterStatsContext(client).catch(() => null);
  const entries = liveContext ? getLiveApprovedTierlistEntries(liveContext) : getApprovedTierlistEntries();
  const stats = getStatsSnapshot(entries);
  const onboardModeState = getOnboardModeState();
  const currentMode = onboardModeState.mode;
  const accessGrantState = getOnboardAccessGrantState();
  const currentAccessGrantMode = accessGrantState.mode;
  const wartimeValidationError = getOnboardModeValidationError(ONBOARD_ACCESS_MODES.WARTIME);
  const apocalypseDescription = isApocalypseMode(currentMode)
    ? "Новые участники без ролей удаляются сразу при входе."
    : "Апокалипсис выключен.";
  const changedByText = onboardModeState.changedBy ? ` (${onboardModeState.changedBy})` : "";
  const lastModeChangeText = onboardModeState.changedAt
    ? `${formatDateTime(onboardModeState.changedAt)}${changedByText}`
    : "—";
  const accessGrantChangedByText = accessGrantState.changedBy ? ` (${accessGrantState.changedBy})` : "";
  const lastAccessGrantChangeText = accessGrantState.changedAt
    ? `${formatDateTime(accessGrantState.changedAt)}${accessGrantChangedByText}`
    : "—";

  const embed = new EmbedBuilder()
    .setTitle("Onboarding Panel")
    .setDescription([
      "Главная модераторская панель для onboarding-бота.",
      `Подтверждено игроков: **${formatNumber(stats.totalVerified)}**`,
      `Pending заявок: **${formatNumber(stats.pendingCount)}**`,
      `Топ игрок: **${stats.topEntry ? `${stats.topEntry.displayName} — ${formatNumber(stats.topEntry.approvedKills)} kills` : "—"}**`,
    ].join("\n"))
    .addFields(
      { name: "Обновить welcome", value: "Пересобирает welcome-панель и сообщение входа.", inline: true },
      { name: "Обновить тир-листы", value: "Перестраивает верхний graphic-board и нижний текстовый рейтинг в dedicated канале.", inline: true },
      { name: "Синк tier-ролей", value: "Перепривязывает tier-роли всем подтверждённым игрокам по текущей базе.", inline: true },
      { name: "Напомнить отсутствующим", value: "Шлёт DM пользователям вне тир-листа с встроенным постером из репозитория.", inline: true },
      { name: "Обновить сводку", value: "Перерисовывает саму панель и показывает текущее состояние без лишних команд.", inline: true },
      {
        name: "Режим онбординга",
        value: [
          `Сейчас: **${getOnboardAccessModeLabel(currentMode)}**`,
          `Обычная стартовая роль: ${formatRoleMention(getNormalAccessRoleId())}`,
          `Военная стартовая роль: ${formatRoleMention(getWartimeAccessRoleId())}`,
          `Активная роль на выдачу: ${formatRoleMention(getGrantedAccessRoleIdForMode(currentMode))}`,
          apocalypseDescription,
          `Последнее переключение: ${lastModeChangeText}`,
          wartimeValidationError ? `Военный режим недоступен: ${wartimeValidationError}` : "Военный режим готов к переключению.",
        ].join("\n"),
        inline: false,
      },
      {
        name: "Выдача стартовой роли",
        value: [
          `Сейчас: **${getOnboardAccessGrantModeLabel(currentAccessGrantMode)}**`,
          "После заявки: роль сразу после первого шага submit.",
          "После review: роль после публикации заявки в канале модерации.",
          "После approve: роль только после решения модератора.",
          `Последнее переключение: ${lastAccessGrantChangeText}`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "Каналы",
        value: [
          `Welcome: ${formatChannelMention(getResolvedChannelId("welcome"))}`,
          `Review: ${formatChannelMention(getResolvedChannelId("review"))}`,
          `Text tierlist: ${formatChannelMention(getResolvedChannelId("tierlistText"))}`,
          `Graphic tierlist: ${formatChannelMention(getResolvedChannelId("tierlistGraphic"))}`,
          `Notice/log: ${formatChannelMention(getResolvedChannelId("log"))}`,
          "_ELO‑каналы — внутри ELO Panel; tierlist dashboard/summary — внутри Tierlist Panel._",
        ].join("\n"),
        inline: false,
      }
    );

  if (statusText) {
    embed.addFields({ name: "Последнее действие", value: statusText, inline: false });
  }

  const payload = {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("panel_refresh_welcome").setLabel("Обновить приветствие").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("panel_refresh_tierlists").setLabel("Обновить тир-листы").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("panel_sync_roles").setLabel("Синхронизировать роли").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("panel_open_roblox_stats").setLabel("Контроль Roblox").setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("panel_remind_missing").setLabel("Напомнить отсутствующим").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("panel_config_channels").setLabel("Каналы").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("panel_refresh_summary").setLabel("Обновить сводку").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("panel_open_tierlist").setLabel("Панель тир-листа").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("panel_open_elo").setLabel("Панель ELO").setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("panel_mode_normal")
          .setLabel("Обычное")
          .setStyle(currentMode === ONBOARD_ACCESS_MODES.NORMAL ? ButtonStyle.Success : ButtonStyle.Secondary)
          .setDisabled(currentMode === ONBOARD_ACCESS_MODES.NORMAL),
        new ButtonBuilder()
          .setCustomId("panel_mode_wartime")
          .setLabel("Военное")
          .setStyle(currentMode === ONBOARD_ACCESS_MODES.WARTIME ? ButtonStyle.Success : ButtonStyle.Secondary)
          .setDisabled(currentMode === ONBOARD_ACCESS_MODES.WARTIME || Boolean(wartimeValidationError)),
        new ButtonBuilder()
          .setCustomId("panel_mode_apocalypse")
          .setLabel("Апокалипсис")
          .setStyle(currentMode === ONBOARD_ACCESS_MODES.APOCALYPSE ? ButtonStyle.Danger : ButtonStyle.Secondary)
          .setDisabled(currentMode === ONBOARD_ACCESS_MODES.APOCALYPSE)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("panel_access_grant_after_submit")
          .setLabel("Роль после заявки")
          .setStyle(currentAccessGrantMode === ONBOARD_ACCESS_GRANT_MODES.AFTER_SUBMIT ? ButtonStyle.Success : ButtonStyle.Secondary)
          .setDisabled(currentAccessGrantMode === ONBOARD_ACCESS_GRANT_MODES.AFTER_SUBMIT),
        new ButtonBuilder()
          .setCustomId("panel_access_grant_after_review_post")
          .setLabel("Роль после проверки")
          .setStyle(currentAccessGrantMode === ONBOARD_ACCESS_GRANT_MODES.AFTER_REVIEW_POST ? ButtonStyle.Success : ButtonStyle.Secondary)
          .setDisabled(currentAccessGrantMode === ONBOARD_ACCESS_GRANT_MODES.AFTER_REVIEW_POST),
        new ButtonBuilder()
          .setCustomId("panel_access_grant_after_approve")
          .setLabel("Роль после одобрения")
          .setStyle(currentAccessGrantMode === ONBOARD_ACCESS_GRANT_MODES.AFTER_APPROVE ? ButtonStyle.Success : ButtonStyle.Secondary)
          .setDisabled(currentAccessGrantMode === ONBOARD_ACCESS_GRANT_MODES.AFTER_APPROVE)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("panel_add_character").setLabel("Добавить персонажа").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("panel_sot_report").setLabel("Отчёт SoT").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("panel_open_activity").setLabel("Панель активности").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("welcome_editor").setLabel("Редактор UI").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("welcome_editor_jjs").setLabel("Редактировать JJS").setStyle(ButtonStyle.Secondary)
      ),
    ],
  };

  return includeFlags ? ephemeralPayload(payload) : payload;
}

function buildModeratorApocalypseConfirmPayload(statusText = "", includeFlags = true) {
  const embed = new EmbedBuilder()
    .setTitle("Подтвердить режим апокалипсиса")
    .setDescription([
      "Этот режим опасный.",
      "После включения каждый новый участник без ролей будет удаляться сразу при входе.",
      "Уже находящихся на сервере пользователей бот не трогает.",
      "Если это не то, что нужно, вернись назад.",
    ].join("\n"));

  if (statusText) {
    embed.addFields({ name: "Статус", value: statusText, inline: false });
  }

  const payload = {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("panel_mode_apocalypse_confirm").setLabel("Да, включить").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("panel_mode_apocalypse_cancel").setLabel("Отмена").setStyle(ButtonStyle.Secondary)
      ),
    ],
  };

  return includeFlags ? ephemeralPayload(payload) : payload;
}

function formatSotReportSource(source) {
  const normalized = String(source || "").trim();
  return normalized || "missing";
}

function formatSotReportStatus(status) {
  const normalized = String(status || "").trim();
  return normalized || "unknown";
}

function buildSotReportLine(label, valueText, source, status, note = "") {
  const suffix = String(note || "").trim();
  return `• ${label}: ${valueText || "—"} [${formatSotReportSource(source)}; ${formatSotReportStatus(status)}]${suffix ? ` — ${suffix}` : ""}`;
}

function hasSotReportGuildChannel(guild, channelId) {
  const id = String(channelId || "").trim();
  if (!id) return null;
  if (!guild) return null;
  return guild.channels.cache.has(id);
}

function hasSotReportGuildRole(guild, roleId) {
  const id = String(roleId || "").trim();
  if (!id) return null;
  if (!guild) return null;
  return guild.roles.cache.has(id);
}

function getResolvedSotReportIntegrationState() {
  return getSotReportIntegrationSnapshots({ db, appConfig });
}

const SOT_REPORT_CHANNEL_LABELS = {
  welcome: "Welcome",
  review: "Review",
  tierlistText: "Text tierlist",
  tierlistGraphic: "Graphic tierlist",
  log: "Notice/log",
  eloSubmit: "ELO submit",
  eloGraphic: "ELO graphic",
  tierlistDashboard: "Tierlist dashboard",
  tierlistSummary: "Tierlist summary",
};

const SOT_REPORT_ROLE_LABELS = {
  moderator: "Moderator",
  accessNormal: "Access normal",
  accessWartime: "Access wartime",
  accessNonJjs: "Access nonJJS",
  "killTier.1": "Kill tier 1",
  "killTier.2": "Kill tier 2",
  "killTier.3": "Kill tier 3",
  "killTier.4": "Kill tier 4",
  "killTier.5": "Kill tier 5",
  "legacyEloTier.1": "Legacy ELO tier 1",
  "legacyEloTier.2": "Legacy ELO tier 2",
  "legacyEloTier.3": "Legacy ELO tier 3",
  "legacyEloTier.4": "Legacy ELO tier 4",
};

function getSotReportLineStatus(status) {
  if (status === "ok") return "OK";
  if (status === "stale") return "MISSING";
  if (status === "missing") return "missing";
  return "unverified";
}

function getResolvedSotReportDiagnostics(guild) {
  const snapshot = createSotGuildSnapshot({
    channelIds: guild?.channels?.cache ? [...guild.channels.cache.keys()] : [],
    roleIds: guild?.roles?.cache ? [...guild.roles.cache.keys()] : [],
    verifiedAt: guild ? nowIso() : null,
  });

  return {
    channels: diagnoseSotChannels({ db, appConfig, snapshot }),
    roles: diagnoseSotRoles({ db, appConfig, snapshot }),
    panels: diagnoseSotPanels({ db, appConfig }),
    integrations: diagnoseSotIntegrations({ db, appConfig }),
  };
}

function getSotReportChannelDiagnostics(guild, resolvedDiagnostics = getResolvedSotReportDiagnostics(guild)) {
  const entriesBySlot = new Map((resolvedDiagnostics?.channels?.entries || []).map((entry) => [entry.slot, entry]));

  return Object.keys(SOT_REPORT_CHANNEL_LABELS).map((slot) => {
    const entry = entriesBySlot.get(slot) || { value: "", source: "missing", status: "missing" };
    const exists = entry.status === "ok" ? true : entry.status === "stale" ? false : null;

    return {
      label: SOT_REPORT_CHANNEL_LABELS[slot],
      id: String(entry.value || "").trim(),
      source: String(entry.source || "").trim() || (entry.value ? "resolved" : "missing"),
      exists,
      line: buildSotReportLine(
        SOT_REPORT_CHANNEL_LABELS[slot],
        formatChannelMention(entry.value),
        String(entry.source || "").trim() || (entry.value ? "resolved" : "missing"),
        getSotReportLineStatus(entry.status)
      ),
    };
  });
}

function getSotReportRoleDiagnostics(guild, resolvedDiagnostics = getResolvedSotReportDiagnostics(guild)) {
  const entriesBySlot = new Map((resolvedDiagnostics?.roles?.entries || []).map((entry) => [entry.slot, entry]));

  return Object.keys(SOT_REPORT_ROLE_LABELS).map((slot) => {
    const entry = entriesBySlot.get(slot) || { value: "", source: "missing", status: "missing" };
    const exists = entry.status === "ok" ? true : entry.status === "stale" ? false : null;

    return {
      label: SOT_REPORT_ROLE_LABELS[slot],
      id: String(entry.value || "").trim(),
      source: String(entry.source || "").trim() || (entry.value ? "resolved" : "missing"),
      exists,
      line: buildSotReportLine(
        SOT_REPORT_ROLE_LABELS[slot],
        formatRoleMention(entry.value),
        String(entry.source || "").trim() || (entry.value ? "resolved" : "missing"),
        getSotReportLineStatus(entry.status)
      ),
    };
  });
}

function getSotReportPanelDiagnostics(guild, resolvedDiagnostics = getResolvedSotReportDiagnostics(guild)) {
  void guild;
  const entriesBySlot = new Map((resolvedDiagnostics?.panels?.entries || []).map((entry) => [entry.slot, entry]));
  const welcomePanelState = entriesBySlot.get("welcome") || { channelId: "", messageIds: {} };
  const nonGgsPanelState = entriesBySlot.get("nonGgs") || { channelId: "", messageIds: {} };
  const textState = entriesBySlot.get("tierlistText") || { channelId: "", messageIds: {} };
  const graphicState = entriesBySlot.get("tierlistGraphic") || { channelId: "", messageIds: {}, lastUpdated: null };
  const eloSubmitState = entriesBySlot.get("eloSubmit") || { channelId: "", messageIds: {} };
  const eloGraphicState = entriesBySlot.get("eloGraphic") || { channelId: "", messageIds: {}, lastUpdated: null };
  const tierlistDashboardState = entriesBySlot.get("tierlistDashboard") || { channelId: "", messageIds: {} };
  const tierlistSummaryState = entriesBySlot.get("tierlistSummary") || { channelId: "", messageIds: {} };
  const panelLines = [
    `• Welcome panel: ch ${formatChannelMention(welcomePanelState.channelId)} / msg ${previewFieldText(welcomePanelState.messageIds?.main || "—", 60)}`,
    `• Non-JJS panel: ch ${formatChannelMention(nonGgsPanelState.channelId)} / msg ${previewFieldText(nonGgsPanelState.messageIds?.main || "—", 60)}`,
    `• Text tierlist: ch ${formatChannelMention(textState.channelId)} / summary ${previewFieldText(textState.messageIds?.summary || textState.messageIds?.main || "—", 60)} / pages ${previewFieldText(textState.messageIds?.pages || "—", 60)}`,
    `• Graphic tierlist: ch ${formatChannelMention(graphicState.channelId)} / msg ${previewFieldText(graphicState.messageIds?.main || "—", 60)} / updated ${formatDateTime(graphicState.lastUpdated)}`,
    `• ELO submit: ch ${formatChannelMention(eloSubmitState.channelId)} / msg ${previewFieldText(eloSubmitState.messageIds?.main || "—", 60)}`,
    `• ELO graphic: ch ${formatChannelMention(eloGraphicState.channelId)} / msg ${previewFieldText(eloGraphicState.messageIds?.main || "—", 60)} / updated ${formatDateTime(eloGraphicState.lastUpdated)}`,
    `• Tierlist dashboard: ch ${formatChannelMention(tierlistDashboardState.channelId)} / msg ${previewFieldText(tierlistDashboardState.messageIds?.main || "—", 60)}`,
    `• Tierlist summary: ch ${formatChannelMention(tierlistSummaryState.channelId)} / msg ${previewFieldText(tierlistSummaryState.messageIds?.main || "—", 60)}`,
  ];

  return {
    lines: panelLines,
    trackedCount: resolvedDiagnostics?.panels?.trackedCount || panelLines.length,
  };
}

function getSotReportIntegrationDiagnostics() {
  const integrations = getResolvedSotReportIntegrationState();
  const elo = integrations.elo;
  const tierlist = integrations.tierlist;

  return {
    lines: [
      `• ELO: status ${previewFieldText(elo.status || "not_started", 40)} / mode ${previewFieldText(elo.mode || "—", 40)} / grant ${elo.roleGrantEnabled === false ? "off" : "on"} / import ${formatDateTime(elo.lastImportAt)} / sync ${formatDateTime(elo.lastSyncAt)} / path ${previewFieldText(elo.sourcePath || "—", 140)}`,
      `• Tierlist: status ${previewFieldText(tierlist.status || "not_started", 40)} / mode ${previewFieldText(tierlist.mode || "—", 40)} / import ${formatDateTime(tierlist.lastImportAt)} / sync ${formatDateTime(tierlist.lastSyncAt)} / path ${previewFieldText(tierlist.sourcePath || "—", 140)}`,
    ],
  };
}

function getSotReportCharacterSource(entry, currentRoleId, historicalRoleIds, generatedRoleIds, recoveryPlan) {
  if (String(entry?.source || "").trim()) return String(entry.source).trim();

  const configuredRoleId = String(entry?.roleId || "").trim();
  const historicalRoleId = String(historicalRoleIds?.[entry.id] || "").trim();
  const generatedRoleId = String(generatedRoleIds?.[entry.id] || "").trim();
  const recoveredRoleId = String(recoveryPlan?.recoveredRoleIds?.[entry.id] || "").trim();

  if (configuredRoleId && currentRoleId === configuredRoleId) return "configured";
  if (historicalRoleId && currentRoleId === historicalRoleId) return "historical";
  if (generatedRoleId && currentRoleId === generatedRoleId) return "generated";
  if (recoveredRoleId && currentRoleId === recoveredRoleId) return "recovered";
  return currentRoleId ? "runtime" : "missing";
}

function getSotReportCharacterDiagnostics(guild) {
  const managedCharacters = getLegacyReportManagedCharacterCatalog();
  const historicalRoleIds = getDiagnosticHistoricalManagedCharacterRoleIds(getConfiguredManagedCharacterCatalog());
  const generatedRoleIds = getGeneratedRoleState().characters || {};
  const guildRoles = guild ? buildGuildCharacterRoleCandidates(guild) : [];
  const recoveryPlan = buildManagedCharacterRoleRecoveryPlan({
    managedCharacters,
    profiles: db.profiles,
    submissions: db.submissions,
    guildRoles,
    historicalRoleIds,
    generatedRoleIds,
  });
  const characterEntries = Object.values(resolveAllCharacterRecords({
    db,
    appConfig,
    managedCharacters,
    profiles: db.profiles,
    submissions: db.submissions,
    guildRoles,
    verifiedRoleIds: guild?.roles?.cache ? [...guild.roles.cache.keys()] : [],
    recoveryPlan,
  }));
  const entryById = new Map(characterEntries.map((entry) => [entry.id, entry]));
  const ambiguousById = new Map(recoveryPlan.ambiguous.map((entry) => [entry.characterId, entry]));
  const unresolvedById = new Map(recoveryPlan.unresolved.map((entry) => [entry.characterId, entry]));
  const bindingLines = [];
  const attentionLines = [];
  const attentionEntries = [];
  let runtimeBound = 0;
  let staleCount = 0;
  let staleVerificationCount = 0;

  for (const entry of managedCharacters) {
    const currentEntry = entryById.get(entry.id) || { roleId: "" };
    const currentRoleId = String(currentEntry.roleId || "").trim();
    const ambiguous = ambiguousById.get(entry.id) || null;
    const unresolved = unresolvedById.get(entry.id) || null;
    const recoveredRoleId = String(recoveryPlan.recoveredRoleIds?.[entry.id] || "").trim();
    const source = getSotReportCharacterSource(currentEntry, currentRoleId, historicalRoleIds, generatedRoleIds, recoveryPlan);
    const exists = currentRoleId ? hasSotReportGuildRole(guild, currentRoleId) : null;
    const verificationAgeHours = currentRoleId ? hoursSince(currentEntry.verifiedAt) : 0;
    const staleVerification = currentRoleId && exists !== false && verificationAgeHours > SOT_CHARACTER_ALERT_STALE_HOURS;

    if (currentRoleId) runtimeBound += 1;
    if (currentRoleId && exists === false) staleCount += 1;
    if (staleVerification) staleVerificationCount += 1;

    let status = !currentRoleId ? "missing" : exists === false ? "stale" : exists === true ? "OK" : "unverified";
    let note = "";
    if (unresolved) {
      status = "unresolved";
      note = `evidence ${unresolved.evidenceCount}; aliases ${previewText(getManagedCharacterRoleNameCandidates(entry).join(", "), 120)}`;
    } else if (ambiguous) {
      status = "ambiguous";
      note = `best ${formatRoleMention(ambiguous.bestRoleId)} (${ambiguous.bestOverlap}), second ${formatRoleMention(ambiguous.secondRoleId)} (${ambiguous.secondOverlap}), evidence ${ambiguous.evidenceCount}`;
    } else if (recoveredRoleId && recoveredRoleId !== currentRoleId) {
      note = `recovery suggests ${formatRoleMention(recoveredRoleId)} (${previewText(recoveryPlan.recoveredRoleLabels?.[entry.id] || recoveredRoleId, 60)})`;
    } else if (staleVerification) {
      note = `verification stale ${Number.isFinite(verificationAgeHours) ? Math.floor(verificationAgeHours) : `${SOT_CHARACTER_ALERT_STALE_HOURS}+`}h`;
    }

    const line = buildSotReportLine(
      entry.label,
      currentRoleId ? formatRoleMention(currentRoleId) : "—",
      source,
      status,
      note
    );

    bindingLines.push(line);
    if (["stale", "unresolved", "ambiguous"].includes(status) || note) {
      attentionLines.push(line);
      attentionEntries.push({
        characterId: entry.id,
        status,
        line,
        evidenceCount: Number(unresolved?.evidenceCount || 0),
      });
    }
  }

  return {
    total: managedCharacters.length,
    runtimeBound,
    recoveredCount: Object.keys(recoveryPlan.recoveredRoleIds || {}).length,
    ambiguousCount: recoveryPlan.ambiguous.length,
    unresolvedCount: recoveryPlan.unresolved.length,
    ambiguousEntries: recoveryPlan.ambiguous,
    unresolvedEntries: recoveryPlan.unresolved,
    staleCount,
    staleVerificationCount,
    attentionEntries,
    attentionLines,
    bindingLines,
  };
}

async function maybeLogSotCharacterHealthAlert(client, reason = "sync") {
  const guild = await getGuild(client);
  if (!guild) return null;

  await guild.roles.fetch().catch(() => null);
  try {
    if (guild.members.cache.size < 2) await guild.members.fetch();
  } catch {
    // Best-effort hydration: role existence checks still work off the role cache.
  }

  const diagnostics = getSotReportCharacterDiagnostics(guild);
  const { issueParts, attentionLines } = getActionableSotCharacterAlertState(diagnostics, {
    staleHours: SOT_CHARACTER_ALERT_STALE_HOURS,
  });

  if (!issueParts.length) {
    lastSotCharacterAlertSignature = "";
    lastSotCharacterAlertAt = 0;
    return { sent: false, diagnostics };
  }

  const attentionPreview = previewText(attentionLines.slice(0, 3).join(" | "), 400);
  const signature = `${issueParts.join(",")}|${attentionLines
    .map((line) => String(line || "").trim())
    .filter(Boolean)
    .map((line) => line.replace(/verification stale \d+h/gi, `verification stale >${SOT_CHARACTER_ALERT_STALE_HOURS}h`))
    .join("|")}`;
  const now = Date.now();
  if (signature === lastSotCharacterAlertSignature && now - lastSotCharacterAlertAt < SOT_CHARACTER_ALERT_REPEAT_MS) {
    return { sent: false, suppressed: true, diagnostics };
  }

  lastSotCharacterAlertSignature = signature;
  lastSotCharacterAlertAt = now;
  const previewSuffix = attentionPreview ? ` details=${attentionPreview}` : "";
  await logLine(client, `SOT_CHARACTER_ALERT[${reason}]: ${issueParts.join(", ")}.${previewSuffix}`);
  return { sent: true, diagnostics };
}

async function maybeLogSotDriftAlert(client, reason = "sync") {
  const mismatches = compareSotVsLegacy({
    db,
    ...buildSotLegacyOptions(db),
  });

  if (!mismatches.length) {
    lastSotDriftAlertSignature = "";
    lastSotDriftAlertAt = 0;
    return { sent: false, mismatches };
  }

  const summary = summarizeCompareMismatches(mismatches, { limit: 5 });
  const domainSummary = Object.entries(summary.countsByDomain)
    .map(([domain, count]) => `${domain}=${count}`)
    .join(", ");
  const preview = previewText(summary.preview.join(" | "), 400);
  const signature = `${summary.total}|${domainSummary}|${preview}`;
  const now = Date.now();

  if (signature === lastSotDriftAlertSignature && now - lastSotDriftAlertAt < SOT_DRIFT_ALERT_REPEAT_MS) {
    return { sent: false, suppressed: true, mismatches, summary };
  }

  lastSotDriftAlertSignature = signature;
  lastSotDriftAlertAt = now;
  const previewSuffix = preview ? ` details=${preview}` : "";
  await logLine(client, `SOT_DRIFT_ALERT[${reason}]: total=${summary.total}; ${domainSummary}.${previewSuffix}`);
  return { sent: true, mismatches, summary };
}

async function buildGroundTruthSotReportPayload(client, statusText = "", includeFlags = true) {
  const guild = await getGuild(client).catch(() => null);
  if (guild) {
    await guild.roles.fetch().catch(() => null);
    await guild.channels.fetch().catch(() => null);
    try {
      if (guild.members.cache.size < 2) await guild.members.fetch();
    } catch {
      // best-effort diagnostic; character recovery will still run on cache
    }
  }

  const resolvedDiagnostics = getResolvedSotReportDiagnostics(guild);
  const channelDiagnostics = getSotReportChannelDiagnostics(guild, resolvedDiagnostics);
  const roleDiagnostics = getSotReportRoleDiagnostics(guild, resolvedDiagnostics);
  const panelDiagnostics = getSotReportPanelDiagnostics(guild, resolvedDiagnostics);
  const integrationDiagnostics = getSotReportIntegrationDiagnostics();
  const characterDiagnostics = getSotReportCharacterDiagnostics(guild);

  const channelConfiguredCount = channelDiagnostics.filter((entry) => entry.id).length;
  const channelLiveCount = channelDiagnostics.filter((entry) => entry.exists === true).length;
  const roleConfiguredCount = roleDiagnostics.filter((entry) => entry.id).length;
  const roleLiveCount = roleDiagnostics.filter((entry) => entry.exists === true).length;
  const startupHealthLabel = lastClientReadyCoreDegraded.length ? "DEGRADED" : "OK";
  const startupHealthTimeText = lastClientReadyCoreCompletedAt
    ? formatDateTime(lastClientReadyCoreCompletedAt)
    : "—";
  const statusLines = [
    "Ground-truth отчёт построен по текущим legacy code-path и db.config. Новый SoT facade здесь не используется.",
    `Guild: **${guild?.name || "не удалось получить"}**`,
    `Каналы: **${channelLiveCount}/${channelConfiguredCount}** live`,
    `Роли: **${roleLiveCount}/${roleConfiguredCount}** live`,
    `Персонажи: bound **${characterDiagnostics.runtimeBound}/${characterDiagnostics.total}**, stale **${characterDiagnostics.staleCount}**, stale verification **${characterDiagnostics.staleVerificationCount}**, ambiguous **${characterDiagnostics.ambiguousCount}**, unresolved **${characterDiagnostics.unresolvedCount}**, recovery candidates **${characterDiagnostics.recoveredCount}**`,
    `Панели tracked: **${panelDiagnostics.trackedCount}**`,
    `Startup health: **${startupHealthLabel}** / last ready-core ${startupHealthTimeText}`,
  ];

  const overviewEmbed = new EmbedBuilder()
    .setTitle("SoT Ground Truth")
    .setDescription(statusLines.join("\n"))
    .addFields({
      name: "Легенда",
      value: "source: configured / manual / panel / generated / historical / recovered / integration. status: OK / MISSING / stale / ambiguous / unresolved.",
      inline: false,
    });

  if (statusText) {
    overviewEmbed.addFields({ name: "Последнее действие", value: statusText, inline: false });
  }

  if (lastClientReadyCoreDegraded.length) {
    overviewEmbed.addFields({
      name: "Startup Degraded",
      value: previewFieldText(lastClientReadyCoreDegraded
        .map((entry) => `• ${previewFieldText(entry?.step || "unknown", 60)}: ${previewFieldText(entry?.message || "unknown error", 200)}`)
        .join("\n")),
      inline: false,
    });
  }

  const infraEmbed = new EmbedBuilder()
    .setTitle("SoT Ground Truth: Channels & Roles")
    .addFields(
      { name: "Channels", value: previewFieldText(channelDiagnostics.map((entry) => entry.line).join("\n")), inline: false },
      { name: "Roles", value: previewFieldText(roleDiagnostics.map((entry) => entry.line).join("\n")), inline: false }
    );

  const stateEmbed = new EmbedBuilder()
    .setTitle("SoT Ground Truth: Panels & Integrations")
    .addFields(
      { name: "Panels", value: previewFieldText(panelDiagnostics.lines.join("\n")), inline: false },
      { name: "Integrations", value: previewFieldText(integrationDiagnostics.lines.join("\n")), inline: false }
    );

  const embeds = [overviewEmbed, infraEmbed, stateEmbed];
  const attentionChunks = chunkTextLines(
    characterDiagnostics.attentionLines.length ? characterDiagnostics.attentionLines : ["• Критичных расхождений по персонажам не найдено."],
    1024,
    8
  );
  attentionChunks.forEach((chunk, index) => {
    embeds.push(
      new EmbedBuilder()
        .setTitle(index === 0 ? "SoT Ground Truth: Characters / Attention" : `SoT Ground Truth: Characters / Attention ${index + 1}`)
        .setDescription(chunk)
    );
  });

  const bindingChunks = chunkTextLines(characterDiagnostics.bindingLines, 1024, 8);
  bindingChunks.forEach((chunk, index) => {
    embeds.push(
      new EmbedBuilder()
        .setTitle(index === 0 ? "SoT Ground Truth: Characters / All Bindings" : `SoT Ground Truth: Characters / All Bindings ${index + 1}`)
        .setDescription(chunk)
    );
  });

  const reportButtons = [
    new ButtonBuilder().setCustomId("sot_report_verify_now").setLabel("Проверить заново").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("sot_report_recover_characters").setLabel("Восстановить биндинги").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("sot_report_manual_character").setLabel("Ручной bind").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("sot_report_link_channel").setLabel("Link channel").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("sot_report_cleanup_orphans").setLabel("Очистить orphan").setStyle(ButtonStyle.Danger),
  ];

  const reportAdvancedButtons = [
    new ButtonBuilder().setCustomId("sot_report_manual_role").setLabel("Manual role").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("sot_report_manual_panel").setLabel("Manual panel").setStyle(ButtonStyle.Secondary),
  ];

  const payload = {
    embeds,
    components: [
      new ActionRowBuilder().addComponents(...reportButtons),
      new ActionRowBuilder().addComponents(...reportAdvancedButtons),
    ],
  };

  return includeFlags ? ephemeralPayload(payload) : payload;
}

async function replyWithGroundTruthSotReport(interaction, client, statusText = "") {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await interaction.editReply(await buildGroundTruthSotReportPayload(client, statusText, false));
}

function getDormantEloImportStatusText(result) {
  if (result?.error) return `Не удалось прочитать legacy ELO базу: ${result.error}`;
  if (!result?.sourcePath) return "ELO sourcePath не задан. Укажи путь к legacy db.json в панели ниже.";
  if (!result?.imported) return `Файл ELO базы пока не найден: ${result.resolvedPath || result.sourcePath}`;

  return [
    `Legacy ELO база синхронизирована. Игроков: ${result.importedUserCount}.`,
    `Обновлено профилей: ${result.syncedProfiles}.`,
    result.clearedProfiles ? `Очищено stale ELO-профилей: ${result.clearedProfiles}.` : null,
  ].filter(Boolean).join(" ");
}

function refreshDormantEloImport() {
  const result = importDormantEloSyncFromFile(db, {
    sourcePath: getResolvedIntegrationSourcePath("elo"),
    baseDir: DATA_ROOT,
    syncedAt: nowIso(),
  });
  if (result.mutated) saveDb();
  return result;
}

function getDormantTierlistImportStatusText(result) {
  if (result?.error) return `Не удалось прочитать legacy Tierlist state: ${result.error}`;
  if (!result?.sourcePath) return "Tierlist sourcePath не задан. Укажи путь к legacy data/state.json в панели ниже.";
  if (!result?.imported) return `Файл Tierlist state пока не найден: ${result.resolvedPath || result.sourcePath}`;

  return [
    `Legacy Tierlist state синхронизирован. Профилей: ${result.importedUserCount}.`,
    `Обновлено профилей: ${result.syncedProfiles}.`,
    result.clearedProfiles ? `Очищено stale Tierlist-профилей: ${result.clearedProfiles}.` : null,
  ].filter(Boolean).join(" ");
}

function refreshDormantTierlistImport() {
  const result = importDormantTierlistSyncFromFile(db, {
    sourcePath: getResolvedIntegrationSourcePath("tierlist"),
    baseDir: DATA_ROOT,
    syncedAt: nowIso(),
    characterCatalog: getCharacterCatalog().map((entry) => ({ id: entry.id, label: entry.label })),
  });
  if (result.mutated) saveDb();
  return result;
}

function getLiveLegacyTierlistState(currentDb = db) {
  return loadLegacyTierlistState({
    sourcePath: getResolvedIntegrationSourcePath("tierlist", currentDb),
    baseDir: DATA_ROOT,
    baseCharacterCatalog: getLegacyTierlistBaseCharacterCatalog(currentDb),
    baseCharacterAssetsDir: CHARACTERS_ASSET_DIR,
  });
}

function buildLegacyTierlistStateErrorPayload(prefix, state, includeFlags = true) {
  const payload = {
    content: `${prefix}: ${state?.error || "неизвестная ошибка"}`,
  };
  return includeFlags ? ephemeralPayload(payload) : payload;
}

function saveLiveLegacyTierlistStateAndResync(liveState) {
  if (!liveState?.resolvedPath) {
    throw new Error("Resolved legacy Tierlist state path is missing");
  }

  saveLegacyTierlistState(liveState.resolvedPath, liveState.rawState);
  return refreshDormantTierlistImport();
}

function getLegacyTierlistSyncStatusSuffix(syncResult) {
  return syncResult?.error ? ` Синхронизация shared профилей не удалась: ${syncResult.error}` : "";
}

function isLegacyTierlistDashboardDisabled(rawState) {
  return rawState?.settings?.dashboardDisabled === true;
}

function parseLegacyTierlistTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isLegacyTierlistLocked(rawUser) {
  void rawUser;
  return false;
}

function buildLegacyTierlistDashboardComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("start_rating").setLabel("Начать оценку").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("rate_new_characters").setLabel("Оценить точечно").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("my_status").setLabel("Мой статус").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("refresh_tierlist").setLabel("Обновить тир-лист").setStyle(ButtonStyle.Secondary)
    ),
  ];
}

async function buildLegacyTierlistDashboardPayload(liveState) {
  if (!liveState?.ok) {
    throw new Error(liveState?.error || "Legacy Tierlist state недоступен");
  }

  const pngBuffer = await renderLegacyTierlistGlobalPng(liveState, { title: LEGACY_TIERLIST_TITLE });
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(LEGACY_TIERLIST_TITLE)
        .setDescription("кнопка **начать оценку** откроет полный тир-лист. Мейны подхватываются автоматически из ролей персонажей внутри Moderator. **оценить точечно** откроет удобный выбор персонажей: можно вызвать только нужные карточки или отдельно дооценить новых без полного сброса.")
        .setImage("attachment://tierlist.png"),
    ],
    files: [new AttachmentBuilder(pngBuffer, { name: "tierlist.png" })],
    components: buildLegacyTierlistDashboardComponents(),
  };
}

async function ensureLegacyTierlistDashboardMessage(client, liveState, forcedChannelId = null) {
  if (!liveState?.ok) {
    throw new Error(liveState?.error || "Legacy Tierlist state недоступен");
  }

  const rawState = liveState.rawState;
  rawState.settings ||= {};
  const resolvedSnapshot = getResolvedLegacyTierlistDashboardSnapshot();
  const channelId = String(
    forcedChannelId
    || resolvedSnapshot.channelId
    || rawState.settings.channelId
    || (isLegacyTierlistDashboardDisabled(rawState) ? "" : appConfig.channels.tierlistChannelId)
    || ""
  ).trim();
  if (!channelId) throw new Error("Не задан dashboard channel для legacy Tierlist.");

  const previousChannelId = String(rawState.settings.channelId || "").trim();
  const previousMessageId = String(rawState.settings.dashboardMessageId || "").trim();
  if (previousMessageId && previousChannelId && previousChannelId !== channelId) {
    const previousChannel = await client.channels.fetch(previousChannelId).catch(() => null);
    const previousMessage = previousChannel?.isTextBased?.()
      ? await previousChannel.messages.fetch(previousMessageId).catch(() => null)
      : null;
    if (previousMessage?.deletable) await previousMessage.delete().catch(() => {});
    rawState.settings.dashboardMessageId = null;
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) throw new Error("Legacy Tierlist dashboard channel должен быть текстовым.");

  let message = await fetchStoredBotMessage(channel, rawState.settings, "dashboardMessageId", client.user?.id);
  if (!message) {
    message = await findExistingLegacyTierlistDashboardMessage(channel);
  }

  const payload = await buildLegacyTierlistDashboardPayload(liveState);
  if (!message) {
    message = await channel.send(payload);
  } else {
    await message.edit({ ...payload, attachments: [] });
  }

  rawState.settings.channelId = channel.id;
  rawState.settings.dashboardMessageId = message.id;
  rawState.settings.lastUpdated = Date.now();
  rawState.settings.dashboardDisabled = false;
  const syncResult = saveLiveLegacyTierlistStateAndResync(liveState);
  return { ok: true, channelId: channel.id, messageId: message.id, syncResult };
}

async function refreshLegacyTierlistDashboard(client, options = {}) {
  const liveState = options.liveState || getLiveLegacyTierlistState();
  if (!liveState.ok) {
    throw new Error(liveState.error || "Legacy Tierlist state недоступен");
  }

  const channelId = String(
    options.channelId
    || getResolvedLegacyTierlistDashboardSnapshot().channelId
    || liveState.rawState?.settings?.channelId
    || (isLegacyTierlistDashboardDisabled(liveState.rawState) ? "" : appConfig.channels.tierlistChannelId)
    || ""
  ).trim();
  if (!channelId) {
    return { ok: false, reason: "not_configured", liveState };
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return { ok: false, reason: "missing_channel", liveState };

  let message = await fetchStoredBotMessage(channel, liveState.rawState?.settings, "dashboardMessageId", client.user?.id);
  if (!message) {
    const ensured = await ensureLegacyTierlistDashboardMessage(client, liveState, channelId);
    return { ok: true, ensured: true, channelId: ensured.channelId, messageId: ensured.messageId, syncResult: ensured.syncResult, liveState };
  }

  // Skip costly PNG render + message.edit if the rendered layout has not changed.
  if (!options.force) {
    const { buckets } = computeLegacyTierlistGlobalBuckets(liveState);
    const layoutHash = computeLegacyTierlistGlobalLayoutHash(liveState, buckets, LEGACY_TIERLIST_TITLE);
    const stamp = liveState.rawState?.settings?.lastDashboardLayoutHash;
    if (stamp && stamp === layoutHash) {
      return { ok: true, ensured: false, channelId: channel.id, messageId: message.id, skipped: true, liveState };
    }
    liveState.rawState.settings ||= {};
    liveState.rawState.settings.lastDashboardLayoutHash = layoutHash;
  }

  const payload = await buildLegacyTierlistDashboardPayload(liveState);
  await message.edit({ ...payload, attachments: [] });
  liveState.rawState.settings ||= {};
  liveState.rawState.settings.dashboardDisabled = false;
  liveState.rawState.settings.lastUpdated = Date.now();
  const syncResult = saveLiveLegacyTierlistStateAndResync(liveState);
  return { ok: true, ensured: false, channelId: channel.id, messageId: message.id, syncResult, liveState };
}

async function clearLegacyTierlistDashboardMessage(client, liveState) {
  if (!liveState?.ok) {
    throw new Error(liveState?.error || "Legacy Tierlist state недоступен");
  }

  const rawState = liveState.rawState;
  rawState.settings ||= {};

  const previousChannelId = String(rawState.settings.channelId || "").trim();
  let deletedMessageId = String(rawState.settings.dashboardMessageId || "").trim() || null;

  if (previousChannelId) {
    const channel = await client.channels.fetch(previousChannelId).catch(() => null);
    if (channel?.isTextBased?.()) {
      const message = await fetchStoredBotMessage(channel, rawState.settings, "dashboardMessageId", client.user?.id);
      if (message) {
        deletedMessageId = message.id;
        await message.delete().catch(() => {});
      }
    }
  }

  rawState.settings.channelId = "";
  rawState.settings.dashboardMessageId = "";
  rawState.settings.lastUpdated = null;
  rawState.settings.lastDashboardLayoutHash = null;
  rawState.settings.dashboardDisabled = true;
  const syncResult = saveLiveLegacyTierlistStateAndResync(liveState);

  return {
    ok: true,
    deletedMessageId,
    syncResult,
  };
}

async function ensureLegacyTierlistSummaryMessage(client, liveState, forcedChannelId = null) {
  if (!liveState?.ok) {
    throw new Error(liveState?.error || "Legacy Tierlist state недоступен");
  }

  const rawState = liveState.rawState;
  rawState.settings ||= {};
  const resolvedSnapshot = getResolvedLegacyTierlistSummarySnapshot();
  const channelId = String(forcedChannelId || resolvedSnapshot.channelId || rawState.settings.summaryChannelId || "").trim();
  if (!channelId) throw new Error("Не задан summary channel для legacy Tierlist.");

  const previousChannelId = String(rawState.settings.summaryChannelId || "").trim();
  const previousMessageId = String(rawState.settings.summaryMessageId || "").trim();
  if (previousMessageId && previousChannelId && previousChannelId !== channelId) {
    const previousChannel = await client.channels.fetch(previousChannelId).catch(() => null);
    const previousMessage = previousChannel?.isTextBased?.()
      ? await previousChannel.messages.fetch(previousMessageId).catch(() => null)
      : null;
    if (previousMessage?.deletable) await previousMessage.delete().catch(() => {});
    rawState.settings.summaryMessageId = null;
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) throw new Error("Legacy Tierlist summary channel должен быть текстовым.");

  let message = await fetchStoredBotMessage(channel, rawState.settings, "summaryMessageId", client.user?.id);
  if (!message) {
    message = await findExistingLegacyTierlistSummaryMessage(channel);
  }

  const payload = { embeds: [buildLegacyTierlistSummaryEmbed(liveState, { title: LEGACY_TIERLIST_TITLE })] };
  if (!message) {
    message = await channel.send(payload);
  } else {
    await message.edit(payload);
  }

  rawState.settings.summaryChannelId = channel.id;
  rawState.settings.summaryMessageId = message.id;
  rawState.settings.summaryLastUpdated = Date.now();
  const syncResult = saveLiveLegacyTierlistStateAndResync(liveState);
  return { ok: true, channelId: channel.id, messageId: message.id, syncResult };
}

async function refreshLegacyTierlistSummaryMessage(client, options = {}) {
  const liveState = options.liveState || getLiveLegacyTierlistState();
  if (!liveState.ok) {
    throw new Error(liveState.error || "Legacy Tierlist state недоступен");
  }

  const channelId = String(options.channelId || getResolvedLegacyTierlistSummarySnapshot().channelId || liveState.rawState?.settings?.summaryChannelId || "").trim();
  if (!channelId) {
    return { ok: false, reason: "not_configured", liveState };
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return { ok: false, reason: "missing_channel", liveState };

  let message = await fetchStoredBotMessage(channel, liveState.rawState?.settings, "summaryMessageId", client.user?.id);
  if (!message) {
    const ensured = await ensureLegacyTierlistSummaryMessage(client, liveState, channelId);
    return { ok: true, ensured: true, channelId: ensured.channelId, messageId: ensured.messageId, syncResult: ensured.syncResult, liveState };
  }

  await message.edit({ embeds: [buildLegacyTierlistSummaryEmbed(liveState, { title: LEGACY_TIERLIST_TITLE })] });
  liveState.rawState.settings.summaryLastUpdated = Date.now();
  const syncResult = saveLiveLegacyTierlistStateAndResync(liveState);
  return { ok: true, ensured: false, channelId: channel.id, messageId: message.id, syncResult, liveState };
}

async function clearLegacyTierlistSummaryMessage(client, liveState) {
  if (!liveState?.ok) {
    throw new Error(liveState?.error || "Legacy Tierlist state недоступен");
  }

  const rawState = liveState.rawState;
  rawState.settings ||= {};

  const previousChannelId = String(rawState.settings.summaryChannelId || "").trim();
  let deletedMessageId = String(rawState.settings.summaryMessageId || "").trim() || null;

  if (previousChannelId) {
    const channel = await client.channels.fetch(previousChannelId).catch(() => null);
    if (channel?.isTextBased?.()) {
      const message = await fetchStoredBotMessage(channel, rawState.settings, "summaryMessageId", client.user?.id);
      if (message) {
        deletedMessageId = message.id;
        await message.delete().catch(() => {});
      }
    }
  }

  rawState.settings.summaryChannelId = "";
  rawState.settings.summaryMessageId = "";
  rawState.settings.summaryLastUpdated = null;
  const syncResult = saveLiveLegacyTierlistStateAndResync(liveState);

  return {
    ok: true,
    deletedMessageId,
    syncResult,
  };
}

async function refreshLegacyTierlistPublicViews(client, options = {}) {
  const liveState = options.liveState || getLiveLegacyTierlistState();
  if (!liveState.ok) {
    throw new Error(liveState.error || "Legacy Tierlist state недоступен");
  }

  const [dashboard, summary] = await Promise.allSettled([
    refreshLegacyTierlistDashboard(client, { liveState }),
    refreshLegacyTierlistSummaryMessage(client, { liveState }),
  ]);

  return {
    liveState,
    dashboard: dashboard.status === "fulfilled" ? dashboard.value : false,
    summary: summary.status === "fulfilled" ? summary.value : false,
  };
}

async function tryRefreshLegacyTierlistPublicViews(client, liveState) {
  try {
    await refreshLegacyTierlistPublicViews(client, { liveState });
    return null;
  } catch (error) {
    return String(error?.message || error || "unknown refresh error").trim() || "unknown refresh error";
  }
}

function getLegacyTierlistRefreshWarningText(refreshError) {
  const text = String(refreshError || "").trim();
  return text ? ` Предупреждение: public views не обновились (${text}).` : "";
}

async function submitAddCharacterUnified(client, { name, idHint = "", imageUrl = "" }) {
  const trimmedName = String(name || "").trim().slice(0, 100);
  if (!trimmedName) throw new Error("Имя персонажа пустое.");

  const characterId = normalizeCharacterId(idHint || trimmedName, `char_${Date.now()}`);
  if (!characterId) throw new Error("Не удалось получить id. Укажи id латиницей или дай имя попроще.");

  const characterCatalog = getCharacterCatalog();
  if (characterCatalog.some((c) => String(c.id).trim() === characterId)) {
    throw new Error(`Персонаж с ID «${characterId}» уже существует.`);
  }

  const liveState = getLiveLegacyTierlistState();
  if (!liveState.ok) {
    throw new Error(liveState.error || "Legacy Tierlist state недоступен");
  }

  const trimmedUrl = String(imageUrl || "").trim();
  if (!trimmedUrl) throw new Error("Нужен прямой URL PNG/JPG картинки.");

  // Download/normalize image and persist as custom character.
  await addLegacyTierlistCustomCharacter(liveState, {
    id: characterId,
    name: trimmedName,
    imageUrl: trimmedUrl,
  });

  const roleNote = " Custom персонаж добавлен только в legacy tierlist и не участвует в onboarding-ролях.";

  saveDb();
  const syncResult = saveLiveLegacyTierlistStateAndResync(liveState);

  let viewsNote = "";
  try {
    const refreshed = await refreshLegacyTierlistPublicViews(client, { liveState, force: true });
    const targets = [];
    if (refreshed.dashboard && refreshed.dashboard.ok) targets.push("dashboard");
    if (refreshed.summary && refreshed.summary.ok) targets.push("summary");
    if (targets.length) viewsNote = ` Обновлено: ${targets.join(", ")}.`;
  } catch {}

  await ensureWelcomePanel(client).catch(() => {});

  return { characterId, name: trimmedName, roleNote, viewsNote, syncResult };
}

function persistLiveLegacyTierlistState(liveState) {
  if (!liveState?.resolvedPath) {
    throw new Error("Resolved legacy Tierlist state path is missing");
  }
  saveLegacyTierlistState(liveState.resolvedPath, liveState.rawState);
}

function formatLegacyTierlistMoment(value) {
  const timestamp = parseLegacyTierlistTimestamp(value);
  return timestamp ? new Date(timestamp).toLocaleString("ru-RU") : "—";
}

function normalizeLegacyTierlistMainIds(mainIds, liveState = null) {
  const values = Array.isArray(mainIds)
    ? mainIds
    : (mainIds ? [mainIds] : []);
  const charById = liveState?.charById instanceof Map ? liveState.charById : null;

  return [...new Set(values
    .map((value) => String(value || "").trim())
    .filter((value) => value && (!charById || charById.has(value))))].slice(0, 2);
}

function getLegacyTierlistMainIds(rawUser, liveState = null) {
  const normalized = normalizeLegacyTierlistMainIds(rawUser?.mainIds, liveState);
  if (normalized.length) return normalized;

  const single = String(rawUser?.mainId || "").trim();
  return normalizeLegacyTierlistMainIds(single ? [single] : [], liveState);
}

function sameLegacyTierlistMainIds(left = [], right = []) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function getLegacyTierlistMainNames(liveState, rawUser) {
  return getLegacyTierlistMainIds(rawUser, liveState)
    .map((characterId) => liveState.charById.get(characterId)?.name || characterId);
}

function formatLegacyTierlistMainSummary(liveState, rawUser, fallback = "не выбраны") {
  const names = getLegacyTierlistMainNames(liveState, rawUser);
  return names.length ? names.join(", ") : fallback;
}

function legacyTierlistMemberHasRole(member, roleId) {
  const normalizedRoleId = String(roleId || "").trim();
  if (!normalizedRoleId || !member) return false;
  if (member.roles?.cache?.has) return member.roles.cache.has(normalizedRoleId);
  if (Array.isArray(member.roles)) return member.roles.includes(normalizedRoleId);
  if (Array.isArray(member.roles?.value)) return member.roles.value.includes(normalizedRoleId);
  return false;
}

function setLegacyTierlistMainIds(liveState, userId, mainIds) {
  const user = getLegacyTierlistWizardUser(liveState.rawState, userId);
  const normalized = normalizeLegacyTierlistMainIds(mainIds, liveState);

  user.mainIds = normalized;
  user.mainId = normalized[0] || null;
  user.mainSelectPage = 0;

  return normalized;
}

function resolveLegacyTierlistMainIdsFromMember(member, profile, liveState) {
  return resolveLegacyMainIdsFromRuntimeEntries({
    runtimeEntries: getCharacterEntries().filter((entry) => entry.roleId && legacyTierlistMemberHasRole(member, entry.roleId)),
    profileMainIds: profile?.mainCharacterIds,
    legacyCharacters: liveState?.characters,
  });
}

function syncLegacyTierlistMainsForMember(liveState, userId, member, profile = null) {
  const currentUser = getLegacyTierlistWizardUser(liveState.rawState, userId);
  const currentIds = getLegacyTierlistMainIds(currentUser, liveState);
  const resolution = resolveLegacyTierlistMainIdsFromMember(member, profile || db.profiles?.[userId], liveState);
  const nextIds = resolution.mainIds;

  if (!sameLegacyTierlistMainIds(currentIds, nextIds)) {
    setLegacyTierlistMainIds(liveState, userId, nextIds);
    return { changed: true, mainIds: nextIds, resolution };
  }

  return { changed: false, mainIds: currentIds, resolution };
}

async function syncLegacyTierlistMainsForInteraction(client, liveState, interaction) {
  const freshMember = await fetchMember(client, interaction.user.id).catch(() => null);
  const member = freshMember || interaction.member;
  return syncLegacyTierlistMainsForMember(liveState, interaction.user.id, member, getProfile(interaction.user.id));
}

function getLegacyTierlistWizardUser(rawState, userId) {
  rawState.users ||= {};
  rawState.users[userId] ||= {
    mainId: null,
    mainIds: [],
    lockUntil: 0,
    lastSubmitAt: 0,
    wizQueue: null,
    wizIndex: 0,
    wizMode: null,
    influenceMultiplier: 1,
    influenceRoleId: null,
    influenceUpdatedAt: 0,
    panelTierKey: "S",
    panelTab: "config",
    panelParticipantsPage: 0,
    panelParticipantId: null,
    panelDeleteTargetId: null,
    panelDeleteMode: null,
    panelWipeAllVotesConfirm: false,
    pointRatePage: 0,
    mainSelectPage: 0,
  };

  const user = rawState.users[userId];
  user.mainIds = normalizeLegacyTierlistMainIds(
    Array.isArray(user.mainIds) && user.mainIds.length
      ? user.mainIds
      : (user.mainId ? [user.mainId] : [])
  );
  user.mainId = user.mainIds[0] || null;
  if (user.lastSubmitAt == null) user.lastSubmitAt = 0;
  if (!user.panelTierKey) user.panelTierKey = "S";
  if (!user.panelTab) user.panelTab = "config";
  if (user.panelParticipantsPage == null) user.panelParticipantsPage = 0;
  if (user.panelParticipantId == null) user.panelParticipantId = null;
  if (user.panelWipeAllVotesConfirm == null) user.panelWipeAllVotesConfirm = false;
  if (user.pointRatePage == null) user.pointRatePage = 0;
  if (user.mainSelectPage == null) user.mainSelectPage = 0;
  if (user.wizMode == null) user.wizMode = null;
  return user;
}

function getLegacyTierlistDraft(rawState, userId) {
  rawState.draftVotes ||= {};
  rawState.draftVotes[userId] ||= {};
  return rawState.draftVotes[userId];
}

function getLegacyTierlistFinal(rawState, userId) {
  rawState.finalVotes ||= {};
  rawState.finalVotes[userId] ||= {};
  return rawState.finalVotes[userId];
}

function isLegacyTierlistWizardLocked(rawState, userId) {
  void rawState;
  void userId;
  return false;
}

function hasSubmittedLegacyTierlist(rawState, userId) {
  const votes = rawState?.finalVotes?.[userId] || {};
  return Object.keys(votes).length > 0;
}

function getLegacyTierlistPendingNewCharacterIds(liveState, userId) {
  const finalVotes = getLegacyTierlistFinal(liveState.rawState, userId);
  return (liveState.characters || [])
    .map((entry) => entry.id)
    .filter((characterId) => !finalVotes[characterId]);
}

function getLegacyTierlistRateableEntries(liveState, userId) {
  const finalVotes = getLegacyTierlistFinal(liveState.rawState, userId);

  return (liveState.characters || [])
    .filter((entry) => entry?.id)
    .map((entry) => ({
      id: entry.id,
      name: entry.name || entry.id,
      currentTier: finalVotes[entry.id] || null,
    }))
    .sort((left, right) => {
      const leftNew = left.currentTier ? 1 : 0;
      const rightNew = right.currentTier ? 1 : 0;
      if (leftNew !== rightNew) return leftNew - rightNew;
      return String(left.name).localeCompare(String(right.name), "ru");
    });
}

function getLegacyTierlistPointRatePageCount(liveState, userId) {
  return Math.max(1, Math.ceil(getLegacyTierlistRateableEntries(liveState, userId).length / LEGACY_TIERLIST_MAIN_SELECT_PAGE_SIZE));
}

function clampLegacyTierlistPointRatePage(liveState, userId, page) {
  return Math.max(0, Math.min(Number(page) || 0, getLegacyTierlistPointRatePageCount(liveState, userId) - 1));
}

function canUseLegacyTierlistCurrentWizard(rawState, userId) {
  const user = getLegacyTierlistWizardUser(rawState, userId);
  return !isLegacyTierlistWizardLocked(rawState, userId) || user.wizMode === "new";
}

function findLegacyTierlistCharacterMainPage(liveState, characterId) {
  const index = (liveState.characters || []).findIndex((entry) => entry.id === characterId);
  if (index < 0) return 0;
  return Math.floor(index / LEGACY_TIERLIST_MAIN_SELECT_PAGE_SIZE);
}

function getLegacyTierlistMainSelectPageCount(liveState) {
  return Math.max(1, Math.ceil((liveState.characters || []).length / LEGACY_TIERLIST_MAIN_SELECT_PAGE_SIZE));
}

function clampLegacyTierlistMainSelectPage(liveState, page) {
  return Math.max(0, Math.min(Number(page) || 0, getLegacyTierlistMainSelectPageCount(liveState) - 1));
}

function setLegacyTierlistMain(liveState, userId, mainId) {
  setLegacyTierlistMainIds(liveState, userId, mainId ? [mainId] : []);
  const user = getLegacyTierlistWizardUser(liveState.rawState, userId);
  user.mainSelectPage = findLegacyTierlistCharacterMainPage(liveState, mainId);
}

function startLegacyTierlistWizard(liveState, userId, mode = "full", selectedIds = null) {
  const user = getLegacyTierlistWizardUser(liveState.rawState, userId);
  liveState.rawState.draftVotes ||= {};
  liveState.rawState.draftVotes[userId] = {};
  user.wizMode = mode;
  if (Array.isArray(selectedIds) && selectedIds.length) {
    const allowedIds = new Set((liveState.characters || []).map((entry) => entry.id));
    user.wizQueue = [...new Set(selectedIds
      .map((value) => String(value || "").trim())
      .filter((characterId) => characterId && allowedIds.has(characterId)))];
  } else {
    user.wizQueue = mode === "new"
      ? getLegacyTierlistPendingNewCharacterIds(liveState, userId)
      : (liveState.characters || []).map((entry) => entry.id);
  }
  user.wizIndex = 0;
}

function currentLegacyTierlistWizardChar(rawState, userId) {
  const user = getLegacyTierlistWizardUser(rawState, userId);
  const queue = user.wizQueue || [];
  const index = Math.max(0, Math.min(user.wizIndex || 0, queue.length));
  return queue[index] || null;
}

function legacyTierlistWizardDone(rawState, userId) {
  const user = getLegacyTierlistWizardUser(rawState, userId);
  const queue = user.wizQueue || [];
  return (user.wizIndex || 0) >= queue.length;
}

function setLegacyTierlistDraftTier(rawState, userId, characterId, tierKey) {
  if (!characterId) return;
  if (!["S", "A", "B", "C", "D"].includes(tierKey)) return;
  const draftVotes = getLegacyTierlistDraft(rawState, userId);
  draftVotes[characterId] = tierKey;
}

function advanceLegacyTierlistWizard(rawState, userId) {
  const user = getLegacyTierlistWizardUser(rawState, userId);
  const queue = user.wizQueue || [];
  user.wizIndex = Math.min((user.wizIndex || 0) + 1, queue.length);
}

function rewindLegacyTierlistWizard(rawState, userId) {
  const user = getLegacyTierlistWizardUser(rawState, userId);
  user.wizIndex = Math.max((user.wizIndex || 0) - 1, 0);
}

function submitLegacyTierlistVotes(rawState, userId) {
  const user = getLegacyTierlistWizardUser(rawState, userId);
  const queue = user.wizQueue || [];
  const draftVotes = getLegacyTierlistDraft(rawState, userId);
  const finalVotes = getLegacyTierlistFinal(rawState, userId);

  for (const characterId of queue) {
    finalVotes[characterId] = ["S", "A", "B", "C", "D"].includes(draftVotes[characterId]) ? draftVotes[characterId] : "B";
  }
}

function lockLegacyTierlistUser(rawState, userId) {
  const user = getLegacyTierlistWizardUser(rawState, userId);
  user.lockUntil = 0;
}

function wipeLegacyTierlistVotesOnly(rawState) {
  rawState.finalVotes = {};
  rawState.draftVotes = {};

  for (const user of Object.values(rawState?.users || {})) {
    if (!user || typeof user !== "object") continue;
    user.lockUntil = 0;
    user.lastSubmitAt = 0;
    user.wizQueue = null;
    user.wizIndex = 0;
    user.wizMode = null;
  }
}

function buildLegacyTierlistDraftBuckets(liveState, userId) {
  const rawState = liveState.rawState;
  const user = getLegacyTierlistWizardUser(rawState, userId);
  const draftVotes = getLegacyTierlistDraft(rawState, userId);
  const finalVotes = getLegacyTierlistFinal(rawState, userId);
  const useExistingVotes = user.wizMode === "new" || user.wizMode === "targeted";
  const buckets = { S: [], A: [], B: [], C: [], D: [] };

  for (const character of liveState.characters || []) {
    const baseTier = useExistingVotes && finalVotes[character.id] ? finalVotes[character.id] : "B";
    const tierKey = ["S", "A", "B", "C", "D"].includes(draftVotes[character.id]) ? draftVotes[character.id] : baseTier;
    buckets[tierKey].push(character.id);
  }

  for (const tierKey of Object.keys(buckets)) {
    buckets[tierKey].sort((left, right) => {
      const leftName = liveState.charById.get(left)?.name || left;
      const rightName = liveState.charById.get(right)?.name || right;
      return String(leftName).localeCompare(String(rightName), "ru");
    });
  }

  return buckets;
}

function buildLegacyTierlistMainSelectRows(liveState, userId) {
  void liveState;
  void userId;
  return [];
}

function buildLegacyTierlistStartButtons(liveState, userId) {
  void liveState;
  void userId;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("wiz_use_current_main").setLabel("Открыть оценку").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("wiz_cancel").setLabel("Закрыть").setStyle(ButtonStyle.Secondary)
  );
}

function buildLegacyTierlistTierButtons(disabled = false) {
  const make = (tierKey) => new ButtonBuilder()
    .setCustomId(`wiz_rate_${tierKey}`)
    .setLabel(tierKey)
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(disabled);

  return new ActionRowBuilder().addComponents(make("S"), make("A"), make("B"), make("C"), make("D"));
}

function buildLegacyTierlistWizardNavRow(rawState, userId) {
  const user = getLegacyTierlistWizardUser(rawState, userId);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("wiz_back").setLabel("Назад").setStyle(ButtonStyle.Secondary).setDisabled((user.wizIndex || 0) <= 0),
    new ButtonBuilder().setCustomId("wiz_cancel").setLabel("Закрыть").setStyle(ButtonStyle.Danger)
  );

  if (legacyTierlistWizardDone(rawState, userId)) {
    row.addComponents(new ButtonBuilder().setCustomId("wiz_submit").setLabel("Отправить").setStyle(ButtonStyle.Success));
  }
  return row;
}

function buildLegacyTierlistStartEmbed(liveState, userId) {
  const user = getLegacyTierlistWizardUser(liveState.rawState, userId);
  const mainIds = getLegacyTierlistMainIds(user, liveState);
  const mainsText = formatLegacyTierlistMainSummary(liveState, user);
  const hasFinal = hasSubmittedLegacyTierlist(liveState.rawState, userId);

  const embed = new EmbedBuilder()
    .setTitle("Оценка персонажей")
    .setDescription([
      "Твои мейны подхватываются автоматически из ролей персонажей внутри Moderator.",
      "Оценивай персонажей по одному кнопками S A B C D.",
      mainIds.length
        ? "Найденные мейны будут помечены меткой MAIN; их можно оценивать, но они не учитываются в общем тир-листе, пока остаются твоими текущими мейнами."
        : "Мейны не найдены — можешь оценивать всех персонажей.",
      hasFinal ? "Кнопка **Оценить точечно** откроет выбор нужных карточек и быструю дооценку только новых персонажей." : "После первой отправки откроется кнопка **Оценить точечно**: через неё можно будет вызывать только нужные карточки без полного сброса.",
    ].join("\n"))
    .addFields(
      { name: "Мейны", value: `**${mainsText}**`, inline: false },
      { name: "Статус", value: "Можно отправлять оценку в любой момент.", inline: false }
    );

  return embed;
}

function buildLegacyTierlistStartPayload(liveState, userId, statusText = "") {
  const embed = buildLegacyTierlistStartEmbed(liveState, userId);
  if (statusText) embed.setFooter({ text: String(statusText).slice(0, 2048) });
  return {
    embeds: [embed],
    components: [buildLegacyTierlistStartButtons(liveState, userId)],
    attachments: [],
  };
}

function buildLegacyTierlistPointRatePayload(liveState, userId, statusText = "") {
  const user = getLegacyTierlistWizardUser(liveState.rawState, userId);
  const entries = getLegacyTierlistRateableEntries(liveState, userId);
  const pendingIds = getLegacyTierlistPendingNewCharacterIds(liveState, userId);
  const page = clampLegacyTierlistPointRatePage(liveState, userId, user.pointRatePage || 0);
  const pageSize = LEGACY_TIERLIST_MAIN_SELECT_PAGE_SIZE;
  const pageCount = getLegacyTierlistPointRatePageCount(liveState, userId);
  const slice = entries.slice(page * pageSize, page * pageSize + pageSize);
  user.pointRatePage = page;

  const preview = slice.slice(0, 10).map((entry, index) => {
    const marker = entry.currentTier ? `сейчас ${entry.currentTier}` : "без оценки";
    return `${page * pageSize + index + 1}. **${entry.name}** — ${marker}`;
  });

  const embed = new EmbedBuilder()
    .setTitle("Точечная оценка")
    .setDescription([
      "Выбери одного или нескольких персонажей, и бот откроет только их карточки без полного сброса тир-листа.",
      `Страница: **${page + 1}/${pageCount}**`,
      `Без оценки: **${pendingIds.length}**`,
      `Уже оценены: **${Math.max(0, entries.length - pendingIds.length)}**`,
      "",
      preview.length ? preview.join("\n") : "Нет персонажей для точечной оценки.",
    ].join("\n"));

  const select = new StringSelectMenuBuilder()
    .setCustomId("point_rate_select")
    .setPlaceholder(slice.length ? "Выбери персонажей для точечной оценки" : "Нет доступных персонажей")
    .setMinValues(1)
    .setMaxValues(Math.max(1, Math.min(slice.length, LEGACY_TIERLIST_MAIN_SELECT_PAGE_SIZE)))
    .setDisabled(slice.length === 0);

  for (const entry of slice) {
    select.addOptions({
      label: String(entry.name).slice(0, 100),
      value: entry.id,
      description: (entry.currentTier ? `сейчас ${entry.currentTier}` : "без оценки").slice(0, 100),
    });
  }

  const components = [];
  if (slice.length) {
    components.push(new ActionRowBuilder().addComponents(select));
  }
  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("point_rate_page_prev").setLabel("⟵").setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
      new ButtonBuilder().setCustomId("point_rate_page_next").setLabel("⟶").setStyle(ButtonStyle.Secondary).setDisabled(page >= pageCount - 1),
      new ButtonBuilder().setCustomId("point_rate_new").setLabel("Только новых").setStyle(ButtonStyle.Primary).setDisabled(pendingIds.length === 0),
      new ButtonBuilder().setCustomId("point_rate_close").setLabel("Закрыть").setStyle(ButtonStyle.Secondary)
    )
  );

  return applyLegacyTierlistPanelStatus({
    embeds: [embed],
    components,
    attachments: [],
  }, statusText);
}

async function buildLegacyTierlistWizardPayload(liveState, userId) {
  const rawState = liveState.rawState;
  const user = getLegacyTierlistWizardUser(rawState, userId);
  const mainIds = getLegacyTierlistMainIds(user, liveState);
  const queue = user.wizQueue || [];
  const total = queue.length;
  const done = Math.min(user.wizIndex || 0, total);
  const currentId = currentLegacyTierlistWizardChar(rawState, userId);
  const currentName = currentId ? (liveState.charById.get(currentId)?.name || currentId) : "—";
  const mainSummary = formatLegacyTierlistMainSummary(liveState, user);
  const finished = legacyTierlistWizardDone(rawState, userId);

  const preview = await renderLegacyTierlistFromBuckets(liveState, {
    title: `${LEGACY_TIERLIST_TITLE} (твоя оценка)`,
    footerText: `progress: ${Math.min(done, total)}/${total}. ${new Date().toLocaleTimeString("ru-RU")}`,
    buckets: buildLegacyTierlistDraftBuckets(liveState, userId),
    lockedIds: mainIds,
    highlightId: finished ? null : currentId,
  });
  const files = [new AttachmentBuilder(preview, { name: "preview.png" })];

  let hasCharacterImage = false;
  if (!finished && currentId) {
    const iconPath = resolveLegacyTierlistCharacterImagePath(liveState, currentId);
    if (iconPath && fs.existsSync(iconPath)) {
      files.push(new AttachmentBuilder(fs.readFileSync(iconPath), { name: "character.png" }));
      hasCharacterImage = true;
    }
  }

  const currentEmbed = new EmbedBuilder()
    .setTitle(finished ? "Готово" : `Сейчас: ${currentName}`)
    .setDescription(
      finished
        ? "готово. проверь свой тир-лист ниже и нажми **отправить**."
        : (user.wizMode === "new"
            ? "доставь оценку только для новых персонажей кнопками S A B C D."
            : user.wizMode === "targeted"
              ? "переоцени только выбранных персонажей кнопками S A B C D."
            : "выбери тир для текущего персонажа кнопками S A B C D.")
    )
    .addFields(
      { name: "Мейны", value: mainIds.length ? `⬛ **${mainSummary}** (MAIN не учитываются в общем тир-листе)` : "не выбраны", inline: true },
      { name: "Прогресс", value: `${done}/${total}`, inline: true },
      { name: "Сейчас", value: finished ? "—" : `**${currentName}**`, inline: false }
    );

  if (hasCharacterImage) currentEmbed.setImage("attachment://character.png");

  const previewEmbed = new EmbedBuilder()
    .setTitle("Твой тир-лист")
    .setDescription("обновляется после каждого клика.")
    .setImage("attachment://preview.png");

  return {
    embeds: [currentEmbed, previewEmbed],
    components: [buildLegacyTierlistTierButtons(finished), buildLegacyTierlistWizardNavRow(rawState, userId)],
    files,
    attachments: [],
  };
}

function buildLegacyTierlistInfluenceConfig(rawState) {
  return getSotLegacyInfluenceConfig({ influence: rawState?.settings?.roleInfluence || null });
}

function getLegacyTierlistInfluenceConfig(rawState = null, currentDb = db) {
  const rawInfluence = rawState?.settings?.roleInfluence;
  if (rawInfluence && typeof rawInfluence === "object" && !Array.isArray(rawInfluence) && Object.keys(rawInfluence).length > 0) {
    return getSotLegacyInfluenceConfig({ influence: rawInfluence });
  }
  if (currentDb?.sot?.influence && typeof currentDb.sot.influence === "object" && !Array.isArray(currentDb.sot.influence)) {
    return getSotLegacyInfluenceConfig({ db: currentDb });
  }
  return buildLegacyTierlistInfluenceConfig(rawState);
}

function formatLegacyTierlistInfluenceSummary(rawState) {
  const cfg = getLegacyTierlistInfluenceConfig(rawState);
  return [
    `без роли x${cfg.default.toFixed(2)}`,
    `T1 x${cfg[1].toFixed(2)}`,
    `T2 x${cfg[2].toFixed(2)}`,
    `T3 x${cfg[3].toFixed(2)}`,
    `T4 x${cfg[4].toFixed(2)}`,
    `T5 x${cfg[5].toFixed(2)}`,
  ].join(", ");
}

function resolveLegacyTierlistInfluenceFromMember(member, rawState = null) {
  try {
    const roles = member?.roles?.cache;
    const influenceConfig = getLegacyTierlistInfluenceConfig(rawState);
    if (!roles) return { mult: influenceConfig.default, roleId: null };

    let best = influenceConfig.default;
    let bestRole = null;
    for (const tierKey of [1, 2, 3, 4, 5]) {
      const roleId = getTierRoleId(tierKey);
      const multiplier = influenceConfig[tierKey];
      if (!roleId || !multiplier) continue;
      if (roles.has(roleId) && multiplier > best) {
        best = multiplier;
        bestRole = roleId;
      }
    }
    return { mult: best, roleId: bestRole };
  } catch {
    return { mult: getLegacyTierlistInfluenceConfig(rawState).default, roleId: null };
  }
}

function applyLegacyTierlistPanelStatus(payload, statusText = "") {
  if (!statusText || !payload?.embeds?.[0]) return payload;
  payload.embeds[0].setFooter({ text: String(statusText).slice(0, 2048) });
  return payload;
}

function buildLegacyTierlistPanelTierSelect(rawState, userId) {
  const user = getLegacyTierlistWizardUser(rawState, userId);
  const selected = user.panelTierKey || "S";

  const menu = new StringSelectMenuBuilder()
    .setCustomId("panel_select_tier")
    .setPlaceholder("Выбери тир для переименования")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      { label: "S", value: "S", default: selected === "S" },
      { label: "A", value: "A", default: selected === "A" },
      { label: "B", value: "B", default: selected === "B" },
      { label: "C", value: "C", default: selected === "C" },
      { label: "D", value: "D", default: selected === "D" }
    );

  return new ActionRowBuilder().addComponents(menu);
}

function buildLegacyTierlistPanelTabsRow(rawState, userId) {
  const user = getLegacyTierlistWizardUser(rawState, userId);
  const tab = user.panelTab || "config";

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("panel_tab_config")
      .setLabel("Настройки")
      .setStyle(tab === "config" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("panel_tab_participants")
      .setLabel("Участники")
      .setStyle(tab === "participants" ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );
}

function getLegacyTierlistParticipantsList(liveState) {
  const out = [];
  const seen = new Set();
  const finalVotes = liveState?.rawState?.finalVotes || {};
  const draftVotes = liveState?.rawState?.draftVotes || {};
  const users = liveState?.rawState?.users || {};

  const addEntry = (userId, hasVotes) => {
    if (!userId || seen.has(userId)) return;
    const user = users[userId] || {};
    const mainIds = getLegacyTierlistMainIds(user, liveState);
    const draftCount = Object.keys(draftVotes[userId] || {}).length;
    if (!hasVotes && mainIds.length === 0 && draftCount === 0) return;
    const lastSubmitAt = Number(user.lastSubmitAt) || 0;
    seen.add(userId);
    out.push({
      userId,
      mainId: mainIds[0] || null,
      mainIds,
      lastSubmitAt,
      hasVotes,
      hasDrafts: draftCount > 0,
    });
  };

  for (const [userId, votes] of Object.entries(finalVotes)) {
    if (votes && Object.keys(votes).length > 0) addEntry(userId, true);
  }
  for (const userId of Object.keys(users)) addEntry(userId, false);
  for (const userId of Object.keys(draftVotes)) addEntry(userId, false);

  out.sort((left, right) => {
    if (right.lastSubmitAt !== left.lastSubmitAt) return right.lastSubmitAt - left.lastSubmitAt;
    return String(left.userId).localeCompare(String(right.userId));
  });
  return out;
}

function buildLegacyTierlistParticipantsSelectRow(liveState, userId, participants) {
  const user = getLegacyTierlistWizardUser(liveState.rawState, userId);
  const pageSize = 25;
  const maxPage = Math.max(0, Math.ceil(participants.length / pageSize) - 1);
  const page = Math.min(maxPage, Math.max(0, Number(user.panelParticipantsPage) || 0));
  const start = page * pageSize;
  const slice = participants.slice(start, start + pageSize);

  const menu = new StringSelectMenuBuilder()
    .setCustomId("panel_part_select_user")
    .setPlaceholder(slice.length ? "Выбери участника" : "Нет участников")
    .setMinValues(1)
    .setMaxValues(1)
    .setDisabled(slice.length === 0);

  for (const participant of slice) {
    const mainName = participant.mainIds?.length
      ? participant.mainIds.map((mainId) => liveState.charById.get(mainId)?.name || mainId).join(", ")
      : "—";
    menu.addOptions({
      label: String(participant.userId).slice(0, 100),
      value: participant.userId,
      description: `мейны: ${mainName}`.slice(0, 100),
      default: user.panelParticipantId === participant.userId,
    });
  }

  return new ActionRowBuilder().addComponents(menu);
}

function buildLegacyTierlistParticipantsNavRow(rawState, userId, participants) {
  const user = getLegacyTierlistWizardUser(rawState, userId);
  const pageSize = 25;
  const maxPage = Math.max(0, Math.ceil(participants.length / pageSize) - 1);
  const page = Math.min(maxPage, Math.max(0, Number(user.panelParticipantsPage) || 0));

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("panel_part_prev").setLabel("⟵").setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
    new ButtonBuilder().setCustomId("panel_part_next").setLabel("⟶").setStyle(ButtonStyle.Secondary).setDisabled(page >= maxPage),
    new ButtonBuilder().setCustomId("panel_part_refresh").setLabel("Обновить").setStyle(ButtonStyle.Secondary)
  );
}

function buildLegacyTierlistParticipantsListPayload(liveState, userId, statusText = "") {
  const user = getLegacyTierlistWizardUser(liveState.rawState, userId);
  const participants = getLegacyTierlistParticipantsList(liveState);
  const pageSize = 25;
  const maxPage = Math.max(0, Math.ceil(participants.length / pageSize) - 1);
  const page = Math.min(maxPage, Math.max(0, Number(user.panelParticipantsPage) || 0));
  const start = page * pageSize;
  const slice = participants.slice(start, start + pageSize);
  const preview = slice.slice(0, 12).map((participant, index) => {
    const mainName = participant.mainIds?.length
      ? participant.mainIds.map((mainId) => liveState.charById.get(mainId)?.name || mainId).join(", ")
      : "—";
    const when = participant.lastSubmitAt ? formatLegacyTierlistMoment(participant.lastSubmitAt) : "—";
    return `${start + index + 1}) <@${participant.userId}>  мейны: **${mainName}**  submit: ${when}`;
  });

  const embed = new EmbedBuilder()
    .setTitle("Участники тир-листа")
    .setDescription([
      `Всего: **${participants.length}**`,
      `Страница: **${page + 1}/${maxPage + 1}**`,
      "",
      preview.length ? preview.join("\n") : "Пока никто не отправлял тир-лист.",
    ].join("\n"));

  return applyLegacyTierlistPanelStatus({
    embeds: [embed],
    components: [
      buildLegacyTierlistPanelTabsRow(liveState.rawState, userId),
      buildLegacyTierlistParticipantsSelectRow(liveState, userId, participants),
      buildLegacyTierlistParticipantsNavRow(liveState.rawState, userId, participants),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("panel_close").setLabel("Закрыть").setStyle(ButtonStyle.Danger)
      ),
    ],
    attachments: [],
  }, statusText);
}

function buildLegacyTierlistParticipantsDetailPayload(liveState, userId, statusText = "") {
  const user = getLegacyTierlistWizardUser(liveState.rawState, userId);
  const targetId = user.panelParticipantId;
  const votes = targetId ? (liveState.rawState?.finalVotes?.[targetId] || null) : null;
  const targetUser = targetId ? (liveState.rawState?.users?.[targetId] || {}) : {};
  const targetMainIds = targetId ? getLegacyTierlistMainIds(targetUser, liveState) : [];
  const draftVotesCount = targetId ? Object.keys(liveState.rawState?.draftVotes?.[targetId] || {}).length : 0;
  const hasAnyData = Boolean(votes && Object.keys(votes).length > 0) || targetMainIds.length > 0 || draftVotesCount > 0;

  if (!targetId || !hasAnyData) {
    user.panelParticipantId = null;
    user.panelDeleteTargetId = null;
    user.panelDeleteMode = null;
    persistLiveLegacyTierlistState(liveState);
    return buildLegacyTierlistParticipantsListPayload(liveState, userId, statusText);
  }

  const mainName = formatLegacyTierlistMainSummary(liveState, targetUser, "—");
  const lastSubmitAt = Number(targetUser.lastSubmitAt) || 0;
  const when = lastSubmitAt ? formatLegacyTierlistMoment(lastSubmitAt) : "—";
  const counts = votes ? getLegacyTierlistUserTierCounts(votes) : { S: 0, A: 0, B: 0, C: 0, D: 0 };
  const pending = user.panelDeleteTargetId === targetId ? user.panelDeleteMode : null;
  const hasVotes = Boolean(votes && Object.keys(votes).length > 0);

  const embed = new EmbedBuilder()
    .setTitle("Участник")
    .setDescription(`<@${targetId}>`)
    .addFields(
      { name: "Мейны", value: `**${mainName}**`, inline: true },
      { name: "Submit", value: `${when}`, inline: true },
      { name: "S/A/B/C/D", value: hasVotes ? `${counts.S}/${counts.A}/${counts.B}/${counts.C}/${counts.D}` : "—", inline: false }
    );

  if (!hasVotes) {
    embed.addFields({
      name: "Состояние",
      value: `Нет финальных голосов. Черновики: ${draftVotesCount}. Можно использовать **Полный сброс** чтобы стереть все следы.`,
      inline: false,
    });
  }

  if (pending) {
    embed.addFields({
      name: "Подтверждение удаления",
      value: pending === "full"
        ? "⚠️ **Полный сброс пользователя** (удалит голос + user record + черновики). Нажми **Подтвердить** или **Отмена**."
        : "⚠️ **Удаление голоса** (уберёт вклад в общий тир-лист). Нажми **Подтвердить** или **Отмена**.",
      inline: false,
    });
  }

  const components = [buildLegacyTierlistPanelTabsRow(liveState.rawState, userId)];
  if (!pending) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("panel_part_view_png").setLabel("Показать PNG").setStyle(ButtonStyle.Primary).setDisabled(!hasVotes),
        new ButtonBuilder().setCustomId("panel_part_delete_votes").setLabel("Удалить голос").setStyle(ButtonStyle.Secondary).setDisabled(!hasVotes),
        new ButtonBuilder().setCustomId("panel_part_delete_full").setLabel("Полный сброс").setStyle(ButtonStyle.Danger)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("panel_part_back").setLabel("Назад").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("panel_close").setLabel("Закрыть").setStyle(ButtonStyle.Secondary)
      )
    );
  } else {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("panel_part_confirm_delete").setLabel("Подтвердить").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("panel_part_cancel_delete").setLabel("Отмена").setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("panel_part_back").setLabel("Назад").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("panel_close").setLabel("Закрыть").setStyle(ButtonStyle.Secondary)
      )
    );
  }

  return applyLegacyTierlistPanelStatus({ embeds: [embed], components, attachments: [] }, statusText);
}

function buildLegacyTierlistModPanelConfigPayload(liveState, userId, statusText = "") {
  const cfg = getLegacyTierlistImageConfig(liveState.rawState);
  const user = getLegacyTierlistWizardUser(liveState.rawState, userId);
  const tierKey = user.panelTierKey || "S";
  const tierName = liveState.rawState?.tiers?.[tierKey]?.name || tierKey;

  const embed = new EmbedBuilder()
    .setTitle("Tierlist Panel (mods)")
    .setDescription([
      `**Картинка:** ${cfg.W}×${cfg.H}`,
      `**Иконки:** ${cfg.ICON}px`,
      `**Переименование:** выбран **${tierKey}** → *${tierName}*`,
      `**Коэффициенты:** ${formatLegacyTierlistInfluenceSummary(liveState.rawState)}`,
      "",
      "Кнопки ниже меняют параметры и сразу пересобирают PNG.",
    ].join("\n"));

  if (user.panelWipeAllVotesConfirm) {
    embed.addFields({
      name: "Подтверждение удаления",
      value: "⚠️ Будут удалены все голоса по персонажам, черновики и submission/cooldown traces. Пользователи, их мейны, влияние и настройки панели останутся.",
      inline: false,
    });
  }

  const firstRow = user.panelWipeAllVotesConfirm
    ? new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("panel_confirm_wipe_votes_all").setLabel("Подтвердить wipe").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("panel_cancel_wipe_votes_all").setLabel("Отмена").setStyle(ButtonStyle.Secondary)
    )
    : new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("panel_refresh").setLabel("Пересобрать").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("panel_set_img").setLabel("Задать размеры").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("panel_icon_minus").setLabel("Иконки -").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("panel_icon_plus").setLabel("Иконки +").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("panel_wipe_votes_all").setLabel("Стереть все голоса").setStyle(ButtonStyle.Danger)
    );

  return applyLegacyTierlistPanelStatus({
    embeds: [embed],
    components: [
      buildLegacyTierlistPanelTabsRow(liveState.rawState, userId),
      firstRow,
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("panel_w_minus").setLabel("Ширина -").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("panel_w_plus").setLabel("Ширина +").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("panel_h_minus").setLabel("Высота -").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("panel_h_plus").setLabel("Высота +").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("panel_role_coefficients").setLabel("Коэффициенты").setStyle(ButtonStyle.Primary)
      ),
      buildLegacyTierlistPanelTierSelect(liveState.rawState, userId),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("panel_rename").setLabel("Переименовать тир").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("panel_reset_img").setLabel("Сбросить размеры").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("panel_fonts").setLabel("Шрифты").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("panel_add_custom_character").setLabel("Добавить персонажа").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("panel_close").setLabel("Закрыть").setStyle(ButtonStyle.Danger)
      ),
    ],
    attachments: [],
  }, statusText);
}

function buildLegacyTierlistModPanelPayload(liveState, userId, statusText = "") {
  const user = getLegacyTierlistWizardUser(liveState.rawState, userId);
  if ((user.panelTab || "config") === "participants") {
    return user.panelParticipantId
      ? buildLegacyTierlistParticipantsDetailPayload(liveState, userId, statusText)
      : buildLegacyTierlistParticipantsListPayload(liveState, userId, statusText);
  }
  return buildLegacyTierlistModPanelConfigPayload(liveState, userId, statusText);
}

function applyLegacyTierlistImageDelta(rawState, kind, delta) {
  rawState.settings ||= {};
  rawState.settings.image ||= { width: null, height: null, icon: null };

  const cfg = getLegacyTierlistImageConfig(rawState);
  if (kind === "icon") {
    rawState.settings.image.icon = Math.max(64, Math.min(256, cfg.ICON + delta));
  } else if (kind === "width") {
    rawState.settings.image.width = Math.max(1200, Math.min(4096, cfg.W + delta));
  } else if (kind === "height") {
    rawState.settings.image.height = Math.max(700, Math.min(2160, cfg.H + delta));
  }
}

function resetLegacyTierlistImageOverrides(rawState) {
  rawState.settings ||= {};
  rawState.settings.image = { width: null, height: null, icon: null };
}

async function backfillLegacyTierlistInfluenceForExistingVoters(client, { refresh = true } = {}) {
  const liveState = getLiveLegacyTierlistState();
  if (!liveState.ok) return { total: 0, changed: 0, skipped: true, error: liveState.error, refreshed: false, refreshError: null };

  const voterIds = Object.entries(liveState.rawState?.finalVotes || {})
    .filter(([, votes]) => votes && Object.keys(votes).length > 0)
    .map(([userId]) => userId);

  if (voterIds.length === 0) return { total: 0, changed: 0, refreshed: false, refreshError: null };

  const guild = await client.guilds.fetch(GUILD_ID);
  let changed = 0;

  for (const userId of voterIds) {
    const member = await guild.members.fetch(userId).catch(() => null);
    const influence = resolveLegacyTierlistInfluenceFromMember(member, liveState.rawState);
    const user = getLegacyTierlistWizardUser(liveState.rawState, userId);
    const prev = Number(user.influenceMultiplier) || 1;
    const prevRole = user.influenceRoleId || null;

    if (prev !== influence.mult || prevRole !== (influence.roleId || null)) {
      user.influenceMultiplier = influence.mult;
      user.influenceRoleId = influence.roleId;
      user.influenceUpdatedAt = Date.now();
      changed += 1;
    }
  }

  let refreshError = null;
  if (changed > 0) {
    saveLiveLegacyTierlistStateAndResync(liveState);
    if (refresh) {
      refreshError = await tryRefreshLegacyTierlistPublicViews(client, liveState);
    }
  }

  return { total: voterIds.length, changed, refreshed: Boolean(refresh && changed > 0 && !refreshError), refreshError };
}

async function backfillLegacyTierlistMainsForExistingMembers(client, { refresh = true } = {}) {
  const liveState = getLiveLegacyTierlistState();
  if (!liveState.ok) {
    return {
      total: 0,
      changed: 0,
      skipped: true,
      error: liveState.error,
      refreshed: false,
      refreshError: null,
      skippedMissingMembers: 0,
    };
  }

  const trackedUserIds = new Set(Object.keys(liveState.rawState?.users || {}));
  const managedCharacterRoleIds = getCharacterRoleIds();
  if (trackedUserIds.size === 0 && managedCharacterRoleIds.length === 0) {
    return { total: 0, changed: 0, refreshed: false, refreshError: null, skippedMissingMembers: 0 };
  }

  const guild = await client.guilds.fetch(GUILD_ID);
  const members = await guild.members.fetch().catch(() => null);
  if (!members) {
    return {
      total: 0,
      changed: 0,
      skipped: true,
      error: "Не удалось получить список участников guild.",
      refreshed: false,
      refreshError: null,
      skippedMissingMembers: 0,
    };
  }

  const candidateIds = new Set([...trackedUserIds]);
  for (const member of members.values()) {
    if (member.user?.bot) continue;
    if (managedCharacterRoleIds.some((roleId) => member.roles.cache.has(roleId))) {
      candidateIds.add(member.id);
    }
  }

  let changed = 0;
  let needsRefresh = false;
  let skippedMissingMembers = 0;
  for (const userId of candidateIds) {
    const member = members.get(userId) || null;
    const disposition = getLegacyMainsBackfillDisposition({
      member,
      isTrackedUser: trackedUserIds.has(userId),
    });
    if (!disposition.shouldSync) {
      if (disposition.skippedReason === "missing_member") skippedMissingMembers += 1;
      continue;
    }

    const result = syncLegacyTierlistMainsForMember(liveState, userId, member, db.profiles?.[userId]);
    if (!result.changed) continue;

    changed += 1;
    if (hasSubmittedLegacyTierlist(liveState.rawState, userId)) {
      needsRefresh = true;
    }
  }

  let refreshError = null;
  if (changed > 0) {
    saveLiveLegacyTierlistStateAndResync(liveState);
    if (refresh && needsRefresh) {
      refreshError = await tryRefreshLegacyTierlistPublicViews(client, liveState);
    }
  }

  return {
    total: candidateIds.size,
    changed,
    refreshed: Boolean(refresh && needsRefresh && changed > 0 && !refreshError),
    refreshError,
    skippedMissingMembers,
  };
}

async function syncLegacyTierlistInfluenceForMember(client, member) {
  const liveState = getLiveLegacyTierlistState();
  if (!liveState.ok) return { changed: false, skipped: true, error: liveState.error, hasVote: false, refreshError: null };

  const userId = member.id;
  const hasVote = Boolean(liveState.rawState?.finalVotes?.[userId] && Object.keys(liveState.rawState.finalVotes[userId] || {}).length > 0);
  const isTracked = Boolean(liveState.rawState?.users?.[userId]);
  if (!hasVote && !isTracked) return { changed: false, skipped: true, hasVote: false, refreshError: null };

  const influence = resolveLegacyTierlistInfluenceFromMember(member, liveState.rawState);
  const user = getLegacyTierlistWizardUser(liveState.rawState, userId);
  const prev = Number(user.influenceMultiplier) || 1;
  const prevRole = user.influenceRoleId || null;
  if (prev === influence.mult && prevRole === (influence.roleId || null)) {
    return { changed: false, hasVote, refreshError: null };
  }

  user.influenceMultiplier = influence.mult;
  user.influenceRoleId = influence.roleId;
  user.influenceUpdatedAt = Date.now();
  const syncResult = saveLiveLegacyTierlistStateAndResync(liveState);
  let refreshError = null;

  if (hasVote) {
    refreshError = await tryRefreshLegacyTierlistPublicViews(client, liveState);
  }

  return { changed: true, hasVote, syncResult, refreshError };
}

async function syncLiveLegacyTierlistMainsForMember(client, member, profile = null) {
  const liveState = getLiveLegacyTierlistState();
  if (!liveState.ok) {
    return {
      changed: false,
      skipped: true,
      error: liveState.error,
      mainIds: [],
      hasVote: false,
      refreshError: null,
    };
  }

  const result = syncLegacyTierlistMainsForMember(liveState, member.id, member, profile || db.profiles?.[member.id]);
  if (!result.changed) {
    return {
      changed: false,
      mainIds: result.mainIds,
      hasVote: hasSubmittedLegacyTierlist(liveState.rawState, member.id),
      resolution: result.resolution,
      refreshError: null,
    };
  }

  const hasVote = hasSubmittedLegacyTierlist(liveState.rawState, member.id);
  const syncResult = saveLiveLegacyTierlistStateAndResync(liveState);
  let refreshError = null;
  if (hasVote) {
    refreshError = await tryRefreshLegacyTierlistPublicViews(client, liveState);
  }

  return {
    changed: true,
    mainIds: result.mainIds,
    hasVote,
    syncResult,
    refreshError,
    resolution: result.resolution,
  };
}

function getLiveLegacyEloState(currentDb = db) {
  return loadLegacyEloDbFile({
    sourcePath: getResolvedIntegrationSourcePath("elo", currentDb),
    baseDir: DATA_ROOT,
  });
}

function buildLegacyEloStateErrorPayload(prefix, state, includeFlags = true) {
  const payload = {
    content: `${prefix}: ${state?.error || "неизвестная ошибка"}`,
  };
  return includeFlags ? ephemeralPayload(payload) : payload;
}

function getLegacyEloResyncWarning() {
  const result = refreshDormantEloImport();
  return result?.error ? ` Синхронизация shared профилей не удалась: ${result.error}` : "";
}

function saveLiveLegacyEloStateAndResync(liveState) {
  if (!liveState?.resolvedPath) {
    throw new Error("Resolved legacy ELO db path is missing");
  }

  saveLegacyEloDbFile(liveState.resolvedPath, liveState.rawDb);
  return refreshDormantEloImport();
}

function getLegacyEloSyncStatusSuffix(syncResult) {
  return syncResult?.error ? ` Синхронизация shared профилей не удалась: ${syncResult.error}` : "";
}

function buildLegacyEloReviewButtons(submissionId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`elo_review_approve:${submissionId}`).setLabel("Approve").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`elo_review_edit:${submissionId}`).setLabel("Edit ELO").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`elo_review_reject:${submissionId}`).setLabel("Reject").setStyle(ButtonStyle.Danger)
  );
}

function buildLegacyEloReviewEmbed(submission, statusLabel, extraFields = []) {
  const proofUrl = submission.reviewAttachmentUrl || submission.reviewImage || submission.screenshotUrl || "";
  const proofMessageUrl = submission.messageUrl || "";
  const normalizedExtraFields = extraFields.filter(Boolean);
  const embed = new EmbedBuilder()
    .setTitle(`ELO-заявка (${statusLabel || submission.status || "unknown"})`)
    .setDescription([
      `Игрок: <@${submission.userId}> (${submission.name || submission.username || submission.userId})`,
      `ELO: **${submission.elo !== null ? formatNumber(submission.elo) : "—"}**`,
      `Tier по ELO: **${submission.tier !== null ? submission.tier : "—"}**`,
      `ID: \`${submission.id || "—"}\``,
      `Создано: **${submission.createdAt ? formatDateTime(submission.createdAt) : "—"}**`,
    ].join("\n"));

  if (proofUrl) embed.setImage(proofUrl);
  if (proofUrl && !normalizedExtraFields.some((field) => field?.name === "Пруф")) {
    normalizedExtraFields.push({ name: "Пруф", value: proofUrl, inline: false });
  }
  if (proofMessageUrl && !normalizedExtraFields.some((field) => field?.name === "Сообщение с пруфом")) {
    normalizedExtraFields.push({ name: "Сообщение с пруфом", value: proofMessageUrl, inline: false });
  }
  if (normalizedExtraFields.length) embed.addFields(...normalizedExtraFields);
  return embed;
}

function buildLegacyEloReviewChannelPayload(submission, statusLabel, components = []) {
  return {
    embeds: [buildLegacyEloReviewEmbed(submission, statusLabel)],
    components,
  };
}

async function postLegacyEloReviewRecord(client, submission, fileAttachment = null, statusLabel = "pending", extraFields = [], components = []) {
  const reviewChannelId = String(appConfig?.channels?.reviewChannelId || "").trim();
  if (!reviewChannelId) return null;

  const reviewChannel = await client.channels.fetch(reviewChannelId).catch(() => null);
  if (!reviewChannel?.isTextBased?.()) return null;

  const payload = {
    embeds: [buildLegacyEloReviewEmbed(submission, statusLabel || submission.status || "pending", extraFields)],
    components,
  };
  if (fileAttachment) payload.files = [fileAttachment];

  const sent = await reviewChannel.send(payload).catch(() => null);
  if (!sent) return null;

  submission.reviewChannelId = sent.channel.id;
  submission.reviewMessageId = sent.id;
  return sent;
}

async function fetchLegacyEloReviewMessage(client, submission) {
  if (!submission?.reviewChannelId || !submission?.reviewMessageId) return null;
  const reviewChannel = await client.channels.fetch(submission.reviewChannelId).catch(() => null);
  if (!reviewChannel?.isTextBased?.()) return null;
  return reviewChannel.messages.fetch(submission.reviewMessageId).catch(() => null);
}

async function getLegacyEloApprovalProfileData(client, userId) {
  const user = await client.users.fetch(userId).catch(() => null);
  const member = await fetchMember(client, userId);
  return {
    displayName: member?.displayName || user?.globalName || user?.username || "",
    username: user?.username || "",
    avatarUrl: (
      member?.displayAvatarURL?.({ extension: "png", forceStatic: true, size: 256 }) ||
      user?.displayAvatarURL?.({ extension: "png", forceStatic: true, size: 256 }) ||
      user?.defaultAvatarURL ||
      ""
    ),
  };
}

function buildLegacyEloReviewPayload(submissionId, statusText = "", includeFlags = true) {
  const liveState = getLiveLegacyEloState();
  if (!liveState.ok) {
    return buildLegacyEloStateErrorPayload("Не удалось открыть ELO review-заявку", liveState, includeFlags);
  }

  const submission = getLegacyEloSubmission(liveState.rawDb, submissionId);
  if (!submission) {
    const payload = { content: "Legacy ELO заявка не найдена." };
    return includeFlags ? ephemeralPayload(payload) : payload;
  }

  const expired = submission.status === "pending" && isLegacyEloSubmissionExpired(submission, {
    pendingExpireHours: LEGACY_ELO_PENDING_EXPIRE_HOURS,
  });
  const statusLabel = expired ? "expired" : (submission.status || "unknown");
  const proofUrl = submission.reviewAttachmentUrl || submission.reviewImage || submission.screenshotUrl || "";
  const embed = buildLegacyEloReviewEmbed(submission, statusLabel, [
    { name: "Проверено", value: submission.reviewedAt ? formatDateTime(submission.reviewedAt) : "—", inline: true },
    { name: "Review channel", value: formatChannelMention(submission.reviewChannelId), inline: true },
    { name: "Review message", value: submission.reviewMessageId || "—", inline: true },
    expired ? { name: "Expired", value: `Да, больше ${LEGACY_ELO_PENDING_EXPIRE_HOURS} ч`, inline: true } : null,
  ].filter(Boolean));
  if (statusText) {
    embed.addFields({ name: "Статус", value: statusText, inline: false });
  }

  const payload = {
    embeds: [embed],
    components: submission.status === "pending" && !expired ? [buildLegacyEloReviewButtons(submission.id)] : [],
  };

  return includeFlags ? ephemeralPayload(payload) : payload;
}

function buildLegacyEloGraphicPanelTierSelect(rawDb) {
  const snapshot = buildLegacyEloGraphicPanelSnapshot(rawDb);
  const options = [5, 4, 3, 2, 1].map((tier) => ({
    label: `Tier ${tier} - ${snapshot.tierLabels[tier] || tier}`,
    value: String(tier),
    default: snapshot.selectedTier === tier,
  }));

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId("elo_graphic_panel_select_tier").setPlaceholder("Выбрать тир").addOptions(options)
  );
}

function buildLegacyEloGraphicPanelPayload(rawDb, statusText = "", includeFlags = true) {
  const snapshot = buildLegacyEloGraphicPanelSnapshot(rawDb);

  const embed = new EmbedBuilder()
    .setTitle("ELO PNG Panel")
    .setDescription([
      `**Title:** ${snapshot.title}`,
      `**Канал:** ${formatChannelMention(snapshot.dashboardChannelId)}`,
      `**Message ID:** ${snapshot.dashboardMessageId || "—"}`,
      `**Игроков в PNG:** ${formatNumber(snapshot.totalEntries)}`,
      `**Картинка:** ${snapshot.image.W}x${snapshot.image.H}`,
      `**Иконки:** ${snapshot.image.ICON}px`,
      `**Выбранный тир:** ${snapshot.selectedTier} -> **${snapshot.selectedTierLabel}**`,
      `**Цвет тира:** ${snapshot.selectedTierColor}`,
      `**Текст сообщения:** ${previewLegacyEloGraphicMessageText(rawDb, 170)}`,
      "",
      "Панель правит legacy ELO graphicTierlist и при наличии канала сразу пересобирает PNG board.",
    ].join("\n"));

  if (statusText) {
    embed.addFields({ name: "Последнее действие", value: statusText, inline: false });
  }

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("elo_graphic_panel_refresh").setLabel("Пересобрать").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("elo_graphic_panel_bump").setLabel("Отправить заново").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("elo_graphic_panel_setup").setLabel("Канал PNG").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("elo_graphic_panel_labels").setLabel("Labels").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("elo_graphic_panel_back").setLabel("Назад").setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("elo_graphic_panel_title").setLabel("Название PNG").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("elo_graphic_panel_message_text").setLabel("Текст сообщения").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("elo_graphic_panel_rename").setLabel("Переименовать тир").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("elo_graphic_panel_set_color").setLabel("Цвет тира").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("elo_graphic_panel_reset_color").setLabel("Сброс цвета тира").setStyle(ButtonStyle.Secondary)
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("elo_graphic_panel_icon_minus").setLabel("Иконки -").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("elo_graphic_panel_icon_plus").setLabel("Иконки +").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("elo_graphic_panel_w_minus").setLabel("Ширина -").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("elo_graphic_panel_w_plus").setLabel("Ширина +").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("elo_graphic_panel_h_minus").setLabel("Высота -").setStyle(ButtonStyle.Secondary)
  );

  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("elo_graphic_panel_h_plus").setLabel("Высота +").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("elo_graphic_panel_reset_img").setLabel("Сбросить размеры").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("elo_graphic_panel_reset_colors").setLabel("Сбросить все цвета").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("elo_graphic_panel_clear_cache").setLabel("Сбросить кэш ав").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("elo_graphic_panel_fonts").setLabel("Шрифты").setStyle(ButtonStyle.Secondary)
  );

  const payload = {
    embeds: [embed],
    components: [row1, row2, row3, row4, buildLegacyEloGraphicPanelTierSelect(rawDb)],
  };

  return includeFlags ? ephemeralPayload(payload) : payload;
}

async function buildLegacyEloGraphicBoardPayload(client, rawDb) {
  const snapshot = buildLegacyEloGraphicPanelSnapshot(rawDb);
  const guild = await getGuild(client).catch(() => null);

  if (!isPureimageAvailable()) {
    throw new Error("pureimage не загружен, поэтому legacy ELO PNG board не может быть собран.");
  }

  const pngBuffer = await renderGraphicTierlistPng({
    client,
    guild,
    entries: buildLegacyEloGraphicEntries(rawDb),
    title: snapshot.title,
    tierLabels: snapshot.tierLabels,
    tierColors: snapshot.tierColors,
    tierOrder: [5, 4, 3, 2, 1],
    imageWidth: snapshot.image.W,
    imageHeight: snapshot.image.H,
    imageIcon: snapshot.image.ICON,
  });
  if (!pngBuffer?.length) {
    throw new Error("Legacy ELO PNG не был сгенерирован.");
  }

  return {
    content: "ELO графический тир-лист. Сообщение обновляется из dormant legacy db.",
    embeds: [
      new EmbedBuilder()
        .setTitle(snapshot.title)
        .setDescription(getLegacyEloGraphicMessageText(rawDb))
        .setImage("attachment://elo-tierlist.png"),
    ],
    files: [new AttachmentBuilder(pngBuffer, { name: "elo-tierlist.png" })],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("elo_graphic_refresh").setLabel("Обновить PNG").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("elo_graphic_panel").setLabel("PNG панель").setStyle(ButtonStyle.Primary)
      ),
    ],
  };
}

async function refreshLegacyEloGraphicBoard(client, options = {}) {
  const liveState = options.liveState || getLiveLegacyEloState();
  if (!liveState.ok) {
    throw new Error(liveState.error || "Legacy ELO db недоступна");
  }

  const graphicState = ensureLegacyEloGraphicState(liveState.rawDb);
  const resolvedSnapshot = getResolvedEloGraphicPanelSnapshot();
  const forcedChannelId = String(options.channelId || "").trim();
  const channelId = forcedChannelId || resolvedSnapshot.channelId || String(graphicState.dashboardChannelId || "").trim();
  if (!channelId) {
    return { ok: false, reason: "not_configured", liveState };
  }

  if (forcedChannelId) {
    graphicState.dashboardChannelId = forcedChannelId;
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    throw new Error("Указанный ELO PNG канал не является текстовым.");
  }

  let message = await fetchStoredBotMessage(channel, graphicState, "dashboardMessageId", client.user?.id);
  if (!message) {
    message = await findExistingLegacyEloGraphicMessage(channel);
    if (message && graphicState.dashboardMessageId !== message.id) {
      graphicState.dashboardMessageId = message.id;
    }
  }

  const payload = await buildLegacyEloGraphicBoardPayload(client, liveState.rawDb);
  const created = !message;
  if (!message) {
    message = await channel.send(payload);
  } else {
    await message.edit({ ...payload, attachments: [] });
  }

  graphicState.dashboardChannelId = channel.id;
  graphicState.dashboardMessageId = message.id;
  graphicState.lastUpdated = nowIso();
  const syncResult = saveLiveLegacyEloStateAndResync(liveState);

  return {
    ok: true,
    created,
    message,
    channelId: channel.id,
    liveState,
    syncResult,
  };
}

async function clearLegacyEloGraphicBoard(client, liveState) {
  if (!liveState?.ok) throw new Error("Legacy ELO db недоступна");

  const graphicState = ensureLegacyEloGraphicState(liveState.rawDb);
  let deletedMessageId = String(graphicState.dashboardMessageId || "").trim() || null;
  const channelId = String(graphicState.dashboardChannelId || "").trim();

  if (channelId) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (channel?.isTextBased?.()) {
      const message = await fetchStoredBotMessage(channel, graphicState, "dashboardMessageId", client.user?.id);
      if (message) {
        deletedMessageId = message.id;
        await message.delete().catch(() => {});
      }
    }
  }

  setLegacyEloGraphicDashboardChannel(liveState.rawDb, "");
  const syncResult = saveLiveLegacyEloStateAndResync(liveState);
  return {
    ok: true,
    deletedMessageId,
    syncResult,
  };
}

async function bumpLegacyEloGraphicBoard(client, options = {}) {
  const liveState = options.liveState || getLiveLegacyEloState();
  if (!liveState.ok) {
    throw new Error(liveState.error || "Legacy ELO db недоступна");
  }

  const graphicState = ensureLegacyEloGraphicState(liveState.rawDb);
  const channelId = String(graphicState.dashboardChannelId || "").trim();
  if (!channelId) {
    return { ok: false, reason: "not_configured", liveState };
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    throw new Error("Указанный ELO PNG канал не является текстовым.");
  }

  const previousMessageId = String(graphicState.dashboardMessageId || "").trim();
  const previousMessage = previousMessageId ? await channel.messages.fetch(previousMessageId).catch(() => null) : null;
  const payload = await buildLegacyEloGraphicBoardPayload(client, liveState.rawDb);
  const message = await channel.send(payload);

  if (previousMessage?.deletable) {
    await previousMessage.delete().catch(() => {});
  }

  graphicState.dashboardMessageId = message.id;
  graphicState.lastUpdated = nowIso();
  const syncResult = saveLiveLegacyEloStateAndResync(liveState);

  return {
    ok: true,
    message,
    channelId: channel.id,
    replacedMessageId: previousMessageId || null,
    liveState,
    syncResult,
  };
}

async function persistLegacyEloGraphicMutation(client, liveState, options = {}) {
  if (options.refreshBoard) {
    try {
      const refreshResult = await refreshLegacyEloGraphicBoard(client, { liveState });
      if (refreshResult?.ok) {
        return {
          boardUpdated: true,
          refreshResult,
          syncResult: refreshResult.syncResult,
          warning: "",
        };
      }
    } catch (error) {
      const syncResult = saveLiveLegacyEloStateAndResync(liveState);
      return {
        boardUpdated: false,
        refreshResult: null,
        syncResult,
        warning: ` PNG board не обновлён: ${String(error?.message || error || "неизвестная ошибка")}`,
      };
    }
  }

  const syncResult = saveLiveLegacyEloStateAndResync(liveState);
  return {
    boardUpdated: false,
    refreshResult: null,
    syncResult,
    warning: "",
  };
}

function buildDormantEloPanelPayload(statusText = "", includeFlags = true) {
  const snapshot = getDormantEloPanelSnapshot(db);
  const submitPanelChannelText = snapshot.submitPanel.channelId
    ? formatChannelMention(snapshot.submitPanel.channelId)
    : "не задан отдельно";
  const graphicBoardChannelText = snapshot.graphicBoard.channelId
    ? formatChannelMention(snapshot.graphicBoard.channelId)
    : "не задан отдельно";

  const embed = new EmbedBuilder()
    .setTitle("ELO Panel")
    .setDescription([
      "Dormant-интеграция legacy elo-bot внутри Moderator.",
      "Отдельный runtime elo-bot не запускается; читается только legacy db и пишется проекция в shared profiles.",
      "Submit Hub и PNG board настраиваются отдельно внутри этой панели.",
      `Tracked профилей: **${formatNumber(snapshot.trackedProfiles)}**`,
      `Активных рейтингов: **${formatNumber(snapshot.ratedProfiles)}**`,
      `Pending snapshot: **${formatNumber(snapshot.pendingProfiles)}**`,
      `Топ ELO: **${snapshot.topEntry ? `${snapshot.topEntry.displayName} — ${formatNumber(snapshot.topEntry.currentElo)}` : "—"}**`,
    ].join("\n"))
    .addFields(
      {
        name: "Источник",
        value: snapshot.sourcePath ? previewFieldText(snapshot.sourcePath, 1024) : "Не задан. Можно указать относительный путь от data root или абсолютный путь к legacy db.json.",
        inline: false,
      },
      {
        name: "Статус",
        value: [
          "mode: **dormant**",
          `status: **${snapshot.status || "not_started"}**`,
          `last import: ${snapshot.lastImportAt ? formatDateTime(snapshot.lastImportAt) : "—"}`,
          `last sync: ${snapshot.lastSyncAt ? formatDateTime(snapshot.lastSyncAt) : "—"}`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "Submit Panel",
        value: [
          `Канал: ${submitPanelChannelText}`,
          `Message ID: ${snapshot.submitPanel.messageId || "—"}`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "Graphic Board",
        value: [
          `Канал: ${graphicBoardChannelText}`,
          `Message ID: ${snapshot.graphicBoard.messageId || "—"}`,
          `Updated: ${snapshot.graphicBoard.lastUpdated ? formatDateTime(snapshot.graphicBoard.lastUpdated) : "—"}`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "Важно",
        value: "Общие Welcome/Review/Tierlist каналы сюда не подставляются. Для legacy ELO используй кнопку «Каналы ELO» (общая настройка) или отдельно Submit Hub / PNG Panel.",
        inline: false,
      },
      {
        name: "Выдача ролей",
        value: isLegacyEloRoleGrantEnabled()
          ? "**ВКЛ** — Moderator выдаёт LEGACY_ELO_TIER_ROLE_* по рейтингам."
          : "**ВЫКЛ** — все 5 ELO‑ролей сняты у всех; sync пропускается.",
        inline: false,
      }
    );

  if (statusText) {
    embed.addFields({ name: "Последнее действие", value: statusText, inline: false });
  }

  const grantEnabled = isLegacyEloRoleGrantEnabled();
  const payload = {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("elo_panel_refresh_import").setLabel("Синхронизировать legacy db").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("elo_panel_set_source").setLabel("Путь к db").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("elo_panel_lookup").setLabel("Найти игрока").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("elo_panel_pending").setLabel("Pending").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("elo_panel_back").setLabel("Назад").setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("elo_panel_graphic").setLabel("PNG Panel").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("elo_panel_rebuild").setLabel("Rebuild rating").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("elo_panel_modset").setLabel("Modset игрока").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("elo_panel_remove").setLabel("Remove игрока").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("elo_panel_wipe").setLabel("Wipe rating").setStyle(ButtonStyle.Danger)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("elo_panel_channels").setLabel("Каналы ELO").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("elo_panel_submit_setup").setLabel("Submit Hub").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("elo_panel_role_grant_toggle")
          .setLabel(grantEnabled ? "Выдача ролей: ВКЛ" : "Выдача ролей: ВЫКЛ")
          .setStyle(grantEnabled ? ButtonStyle.Success : ButtonStyle.Danger)
      ),
    ],
  };

  return includeFlags ? ephemeralPayload(payload) : payload;
}

function buildDormantTierlistPanelPayload(statusText = "", includeFlags = true) {
  const snapshot = getDormantTierlistPanelSnapshot(db);
  const liveState = getLiveLegacyTierlistState();
  const liveStats = liveState.ok ? computeLegacyTierlistGlobalBuckets(liveState) : null;
  const liveImage = liveState.ok ? getLegacyTierlistImageConfig(liveState.rawState) : null;

  const embed = new EmbedBuilder()
    .setTitle("Tierlist Panel")
    .setDescription([
      "Dormant-интеграция legacy tierlist-bot внутри Moderator.",
      "Отдельный runtime tierlist-bot не запускается; читается только legacy state.json и пишется проекция в shared profiles.",
      `Tracked профилей: **${formatNumber(snapshot.trackedProfiles)}**`,
      `С отправленным tierlist: **${formatNumber(snapshot.submittedProfiles)}**`,
      `С сохранёнными мейнами: **${formatNumber(snapshot.mainSelectedProfiles)}**`,
      `Максимальное влияние: **${snapshot.strongestInfluence ? `${snapshot.strongestInfluence.displayName} — x${snapshot.strongestInfluence.influenceMultiplier}` : "—"}**`,
    ].join("\n"))
    .addFields(
      {
        name: "Источник",
        value: snapshot.sourcePath ? previewFieldText(snapshot.sourcePath, 1024) : "Не задан. Можно указать относительный путь от data root или абсолютный путь к legacy data/state.json.",
        inline: false,
      },
      {
        name: "Статус",
        value: [
          "mode: **dormant**",
          `status: **${snapshot.status || "not_started"}**`,
          `last import: ${snapshot.lastImportAt ? formatDateTime(snapshot.lastImportAt) : "—"}`,
          `last sync: ${snapshot.lastSyncAt ? formatDateTime(snapshot.lastSyncAt) : "—"}`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "Dashboard",
        value: [
          `Канал: ${formatChannelMention(snapshot.dashboard.channelId)}`,
          `Message ID: ${snapshot.dashboard.messageId || "—"}`,
          `Updated: ${snapshot.dashboard.lastUpdated ? formatDateTime(snapshot.dashboard.lastUpdated) : "—"}`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "Summary",
        value: [
          `Канал: ${formatChannelMention(snapshot.summary.channelId)}`,
          `Message ID: ${snapshot.summary.messageId || "—"}`,
          `Updated: ${snapshot.summary.lastUpdated ? formatDateTime(snapshot.summary.lastUpdated) : "—"}`,
        ].join("\n"),
        inline: true,
      }
    );

  if (liveState.ok) {
    embed.addFields({
      name: "Public views",
      value: [
        `Voters: **${formatNumber(liveStats.votersCount)}**`,
        `Characters: **${formatNumber(liveState.characters.length)}**`,
        `Image: **${liveImage.W}x${liveImage.H}**`,
        `Icon: **${liveImage.ICON}px**`,
      ].join("\n"),
      inline: false,
    });
  }

  if (statusText) {
    embed.addFields({ name: "Последнее действие", value: statusText, inline: false });
  }

  const payload = {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("tierlist_panel_refresh_import").setLabel("Синхронизировать state").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("tierlist_panel_set_source").setLabel("Путь к state").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("tierlist_panel_lookup").setLabel("Найти игрока").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("tierlist_panel_back").setLabel("Назад").setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("tierlist_panel_setup_dashboard").setLabel("Dashboard").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("tierlist_panel_setup_summary").setLabel("Summary").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("tierlist_panel_refresh_public").setLabel("Обновить public").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("tierlist_panel_mod_panel").setLabel("Графика / моды").setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("tierlist_panel_channels").setLabel("Каналы Tierlist").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("tierlist_panel_resend_messages").setLabel("Отправить заново").setStyle(ButtonStyle.Danger)
      ),
    ],
  };

  return includeFlags ? ephemeralPayload(payload) : payload;
}

function parseRequestedChannelId(value, fallbackChannelId = "") {
  const text = String(value || "").trim();
  if (!text) return String(fallbackChannelId || "").trim();

  const mentionMatch = text.match(/^<#(\d+)>$/);
  const candidate = mentionMatch ? mentionMatch[1] : text.replace(/\s+/g, "");
  return /^\d{5,25}$/.test(candidate) ? candidate : "";
}

function parseRequestedUserId(value, fallbackUserId = "") {
  const text = String(value || "").trim();
  if (!text) return String(fallbackUserId || "").trim();

  const mentionMatch = text.match(/^<@!?(\d+)>$/);
  const candidate = mentionMatch ? mentionMatch[1] : text.replace(/\s+/g, "");
  return /^\d{5,25}$/.test(candidate) ? candidate : "";
}

function parseRequestedRoleId(value, fallbackRoleId = "") {
  const text = String(value || "").trim();
  if (!text) return String(fallbackRoleId || "").trim();

  const mentionMatch = text.match(/^<@&(\d+)>$/);
  const candidate = mentionMatch ? mentionMatch[1] : text.replace(/\s+/g, "");
  return /^\d{5,25}$/.test(candidate) ? candidate : "";
}

function parseRequestedRoleIds(value, fallbackRoleIds = []) {
  const source = Array.isArray(fallbackRoleIds) ? fallbackRoleIds : [fallbackRoleIds];
  const normalized = [];
  const seen = new Set();
  const text = String(value || "").trim();
  const candidates = text
    ? text.split(/[;,\n\r\t ]+/g).map((entry) => entry.trim()).filter(Boolean)
    : source.map((entry) => String(entry || "").trim()).filter(Boolean);

  for (const entry of candidates) {
    const roleId = parseRequestedRoleId(entry, "");
    if (!roleId || seen.has(roleId)) continue;
    seen.add(roleId);
    normalized.push(roleId);
    if (normalized.length >= 25) break;
  }

  return normalized;
}

function parseRequestedGraphicOutlineRules(value, fallbackColor = "#ffffff", limit = 25) {
  const resolvedFallbackColor = normalizeGraphicOutlineColor(fallbackColor, "#ffffff");
  const normalized = [];
  const indexByRoleId = new Map();
  const lines = String(value || "")
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const parts = line.split(/[;,\t ]+/g).map((entry) => entry.trim()).filter(Boolean);
    const lineRoleIds = [];
    let lineColor = resolvedFallbackColor;

    for (const part of parts) {
      const color = normalizeGraphicOutlineColor(part, "");
      if (color) {
        lineColor = color;
        continue;
      }

      const roleId = parseRequestedRoleId(part, "");
      if (roleId) lineRoleIds.push(roleId);
    }

    for (const roleId of lineRoleIds) {
      if (indexByRoleId.has(roleId)) {
        normalized[indexByRoleId.get(roleId)].color = lineColor;
        continue;
      }

      normalized.push({ roleId, color: lineColor });
      indexByRoleId.set(roleId, normalized.length - 1);
      if (normalized.length >= limit) return normalized;
    }
  }

  return normalized;
}

function normalizeRequestedEntityName(value, prefixes = []) {
  let normalized = String(value || "").trim().toLowerCase();
  for (const prefix of prefixes) {
    if (normalized.startsWith(prefix)) {
      normalized = normalized.slice(prefix.length).trim();
    }
  }
  return normalized.replace(/\s+/g, " ");
}

async function resolveRequestedChannelIdFromGuild(client, value, fallbackChannelId = "") {
  const directChannelId = parseRequestedChannelId(value, fallbackChannelId);
  const rawValue = String(value || "").trim();
  if (directChannelId || !rawValue) return directChannelId;

  const guild = await getGuild(client).catch(() => null);
  if (!guild) return "";

  await guild.channels.fetch().catch(() => null);
  const requestedName = normalizeRequestedEntityName(rawValue, ["#"]);
  if (!requestedName) return "";

  const matches = [...guild.channels.cache.values()].filter((channel) => {
    if (!channel || typeof channel.name !== "string") return false;
    if (typeof channel.isTextBased === "function" && !channel.isTextBased()) return false;
    return normalizeRequestedEntityName(channel.name) === requestedName;
  });

  return matches.length === 1 ? String(matches[0].id || "").trim() : "";
}

async function resolveRequestedRoleIdFromGuild(client, value, fallbackRoleId = "") {
  const directRoleId = parseRequestedRoleId(value, fallbackRoleId);
  const rawValue = String(value || "").trim();
  if (directRoleId || !rawValue) return directRoleId;

  const guild = await getGuild(client).catch(() => null);
  if (!guild) return "";

  await guild.roles.fetch().catch(() => null);
  const requestedName = normalizeRequestedEntityName(rawValue, ["@"]);
  if (!requestedName) return "";

  const matches = [...guild.roles.cache.values()].filter((role) => {
    if (!role || typeof role.name !== "string") return false;
    return normalizeRequestedEntityName(role.name) === requestedName;
  });

  return matches.length === 1 ? String(matches[0].id || "").trim() : "";
}

function parseVerificationBooleanInput(value, fallback = false) {
  const text = cleanVerificationText(value, 20).toLowerCase();
  if (!text) return fallback;
  if (["1", "true", "yes", "y", "on", "да"].includes(text)) return true;
  if (["0", "false", "no", "n", "off", "нет"].includes(text)) return false;
  return null;
}

function parseVerificationListInput(value, limit = 200, itemLimit = 120) {
  const parts = String(value || "")
    .split(/\r?\n|,/)
    .map((entry) => cleanVerificationText(entry, itemLimit))
    .filter(Boolean);
  return [...new Set(parts)].slice(0, limit);
}

function isLikelyImageUrl(value) {
  const text = String(value || "").trim();
  if (!text) return false;

  try {
    const parsed = new URL(text);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    if (/\.(png|jpe?g|webp|gif)(\?|$)/i.test(parsed.pathname + parsed.search)) return true;
    return ["cdn.discordapp.com", "media.discordapp.net"].includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

async function createManualApprovedLegacyEloRecord(client, liveState, targetUserId, rawText, screenshotUrl, moderatorTag) {
  const reviewedAt = nowIso();
  const user = await client.users.fetch(targetUserId).catch(() => null);
  if (!user) throw new Error("Не удалось получить Discord user для modset.");

  const approvalProfile = await getLegacyEloApprovalProfileData(client, targetUserId);
  const submissionId = makeId();

  let reviewAttachment = null;
  let reviewImage = screenshotUrl;
  try {
    const buffer = await downloadToBuffer(screenshotUrl);
    reviewAttachment = createReviewAttachmentFromBuffer(submissionId, buffer);
    if (reviewAttachment?.name) reviewImage = `attachment://${reviewAttachment.name}`;
  } catch {}

  const directResult = upsertDirectLegacyEloRating(liveState.rawDb, {
    submissionId,
    userId: targetUserId,
    displayName: approvalProfile.displayName,
    username: approvalProfile.username || user.username || "",
    avatarUrl: approvalProfile.avatarUrl,
    rawText,
    screenshotUrl,
    messageUrl: screenshotUrl,
    reviewedBy: moderatorTag,
    reviewedAt,
    createdAt: reviewedAt,
    reviewImage,
    reviewFileName: reviewAttachment?.name || null,
  });

  const reviewMessage = await postLegacyEloReviewRecord(
    client,
    directResult.submission,
    reviewAttachment,
    "approved",
    [{ name: "Источник", value: `Ручное добавление модератором: ${moderatorTag}`, inline: false }],
    []
  );
  if (reviewMessage) {
    attachLegacyEloReviewRecord(liveState.rawDb, directResult.submission.id, {
      reviewChannelId: reviewMessage.channel.id,
      reviewMessageId: reviewMessage.id,
      reviewAttachmentUrl: reviewMessage.attachments.first()?.url || "",
      reviewImage: reviewMessage.attachments.first()?.url || directResult.submission.reviewImage || directResult.submission.screenshotUrl,
      updatedAt: reviewedAt,
    });
  }

  return {
    submissionId: directResult.submission.id,
    rating: liveState.rawDb.ratings[targetUserId] || directResult.rating,
  };
}

async function performLegacyEloManualModset(client, liveState, targetUserId, rawText, screenshotUrl, moderatorTag) {
  const created = await createManualApprovedLegacyEloRecord(
    client,
    liveState,
    targetUserId,
    rawText,
    screenshotUrl,
    moderatorTag
  );

  await syncLegacyEloTierRoles(client, liveState.rawDb, {
    targetUserId,
    reason: "legacy elo modset",
  });

  const persisted = await persistLegacyEloGraphicMutation(client, liveState, { refreshBoard: true });
  const boardUpdated = persisted.boardUpdated;
  const syncResult = persisted.syncResult;

  const latestRating = liveState.rawDb?.ratings?.[targetUserId] || created.rating;
  const eloValue = latestRating?.elo ?? created.rating?.elo ?? "—";
  const tierValue = latestRating?.tier ?? created.rating?.tier ?? "—";
  const proofUrl = latestRating?.proofUrl || screenshotUrl;

  await dmUser(
    client,
    targetUserId,
    [
      "Модератор обновил твой ELO рейтинг.",
      `ELO: ${eloValue}`,
      `Тир: ${tierValue}`,
      `Пруф: ${proofUrl}`,
    ].join("\n")
  );
  await logLine(client, `ELO MODSET: <@${targetUserId}> ELO ${eloValue} -> Tier ${tierValue} by ${moderatorTag}`);

  return {
    created,
    eloValue,
    tierValue,
    proofUrl,
    boardUpdated,
    syncResult,
    warning: persisted.warning,
  };
}

function getLegacyEloSubmitPanelState(rawDb) {
  const dbState = rawDb && typeof rawDb === "object" ? rawDb : {};
  dbState.config ||= {};
  dbState.config.submitPanel ||= { channelId: "", messageId: "" };
  return dbState.config.submitPanel;
}

function setLegacyEloSubmitSession(userId, value) {
  legacyEloSubmitSessions.set(userId, { ...value, createdAt: Date.now() });
}

function setLegacyEloManualModsetSession(userId, value) {
  legacyEloManualModsetSessions.set(userId, { ...value, createdAt: Date.now() });
}

function getLegacyEloSubmitSession(userId) {
  const session = legacyEloSubmitSessions.get(userId);
  if (!session) return null;
  if (Date.now() - Number(session.createdAt || 0) > SUBMIT_SESSION_EXPIRE_MS) {
    legacyEloSubmitSessions.delete(userId);
    return null;
  }
  return session;
}

function getLegacyEloManualModsetSession(userId) {
  const session = legacyEloManualModsetSessions.get(userId);
  if (!session) return null;
  if (Date.now() - Number(session.createdAt || 0) > SUBMIT_SESSION_EXPIRE_MS) {
    legacyEloManualModsetSessions.delete(userId);
    return null;
  }
  return session;
}

function clearLegacyEloSubmitSession(userId) {
  legacyEloSubmitSessions.delete(userId);
}

function clearLegacyEloManualModsetSession(userId) {
  legacyEloManualModsetSessions.delete(userId);
}

function getPendingLegacyEloSubmissionForUser(rawDb, userId) {
  return Object.values(rawDb?.submissions || {})
    .filter((submission) => String(submission?.userId || "") === String(userId || ""))
    .map((submission) => ({ ...submission }))
    .filter((submission) => submission.status === "pending")
    .sort((left, right) => Date.parse(String(right.createdAt || "")) - Date.parse(String(left.createdAt || "")))
    .find((submission) => !isLegacyEloSubmissionExpired(submission, { pendingExpireHours: LEGACY_ELO_PENDING_EXPIRE_HOURS })) || null;
}

function getLatestLegacyEloSubmissionForUser(rawDb, userId, allowedStatuses = null) {
  const allowed = Array.isArray(allowedStatuses) && allowedStatuses.length
    ? new Set(allowedStatuses.map((entry) => String(entry || "").trim()).filter(Boolean))
    : null;
  return Object.values(rawDb?.submissions || {})
    .filter((submission) => String(submission?.userId || "") === String(userId || ""))
    .filter((submission) => !allowed || allowed.has(String(submission?.status || "").trim()))
    .sort((left, right) => Date.parse(String(right.reviewedAt || right.createdAt || "")) - Date.parse(String(left.reviewedAt || left.createdAt || "")))[0] || null;
}

function getLegacyEloSubmitCooldownLeftSeconds(rawDb, userId) {
  const last = Number(rawDb?.cooldowns?.[userId] || 0);
  return Math.max(0, SUBMIT_COOLDOWN_SECONDS - Math.floor((Date.now() - last) / 1000));
}

function getLegacyEloSubmitEligibilityError(rawDb, userId, rawText = null) {
  const pending = getPendingLegacyEloSubmissionForUser(rawDb, userId);
  if (pending) return "У тебя уже есть заявка на проверке. Дождись решения модера.";

  const cooldownLeft = getLegacyEloSubmitCooldownLeftSeconds(rawDb, userId);
  if (cooldownLeft > 0) return `Кулдаун. Подожди ${cooldownLeft} сек и попробуй снова.`;

  if (rawText !== null) {
    const elo = parseLegacyElo(rawText);
    const tier = tierForLegacyElo(elo);
    if (!elo || !tier) return "Нужен текст с числом ELO минимум 10. Пример: 73";

    const current = getLegacyEloRating(rawDb, userId);
    if (current && Number(current.elo) === Number(elo)) {
      return "У тебя уже стоит такой же ELO в тир-листе. Если изменится — пришли новый скрин.";
    }
  }

  return "";
}

function buildLegacyEloSubmitHubEmbed() {
  return new EmbedBuilder()
    .setTitle("ELO заявки")
    .setDescription([
      "Жми кнопку отправки и сразу вводи текст с числом ELO.",
      "После этого просто отправь следующим сообщением скрин с подтверждением в этот канал.",
      "Подходит обычное вложение или вставка картинки через Ctrl+V.",
    ].join("\n"));
}

function buildLegacyEloSubmitHubComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("elo_submit_open").setLabel("Отправить заявку ELO").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("elo_submit_card").setLabel("Моя карточка").setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function buildLegacyEloSubmitAwaitPayload(channelId) {
  return ephemeralPayload({
    content: [
      `Текст принят. Теперь отправь одним следующим сообщением скрин в ${formatChannelMention(channelId) || "этот канал"}.`,
      "Можно обычным вложением или вставить картинку из буфера через Ctrl+V.",
    ].join("\n"),
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("elo_submit_cancel").setLabel("Отменить шаг").setStyle(ButtonStyle.Secondary)
      ),
    ],
  });
}

async function buildLegacyEloMyCardPayload(client, userId) {
  const liveState = getLiveLegacyEloState();
  if (!liveState.ok) {
    return buildLegacyEloStateErrorPayload("Не удалось открыть legacy ELO данные", liveState);
  }

  const rating = getLegacyEloRating(liveState.rawDb, userId);
  const pending = getPendingLegacyEloSubmissionForUser(liveState.rawDb, userId);
  const session = getLegacyEloSubmitSession(userId);

  if (rating) {
    const approvedSubmission = getLatestLegacyEloSubmissionForUser(liveState.rawDb, userId, ["approved"]);
    const proofUrl = approvedSubmission?.reviewAttachmentUrl || approvedSubmission?.screenshotUrl || rating.proofUrl || "";
    const embed = new EmbedBuilder()
      .setTitle("Моя ELO карточка")
      .setDescription([
        "Статус: **в тир-листе**",
        `ELO: **${formatNumber(rating.elo)}**`,
        `Тир: **${rating.tier ?? "—"}**`,
        rating.updatedAt ? `Обновлено: **${formatDateTime(rating.updatedAt)}**` : null,
        proofUrl ? `[Открыть скрин](${proofUrl})` : null,
      ].filter(Boolean).join("\n"));

    if (rating.avatarUrl) embed.setThumbnail(rating.avatarUrl);
    if (proofUrl) embed.setImage(proofUrl);
    return ephemeralPayload({ embeds: [embed] });
  }

  if (pending) {
    const proofUrl = pending.reviewAttachmentUrl || pending.screenshotUrl || "";
    const embed = new EmbedBuilder()
      .setTitle("Моя ELO карточка")
      .setDescription([
        "Статус: **заявка на проверке**",
        `ELO: **${formatNumber(pending.elo)}**`,
        `Тир по числу: **${pending.tier ?? "—"}**`,
        `ID: **${pending.id || "—"}**`,
        pending.createdAt ? `Создано: **${formatDateTime(pending.createdAt)}**` : null,
        proofUrl ? `[Открыть скрин](${proofUrl})` : null,
      ].filter(Boolean).join("\n"));

    if (proofUrl) embed.setImage(proofUrl);
    return ephemeralPayload({ embeds: [embed] });
  }

  if (session) {
    return buildLegacyEloSubmitAwaitPayload(session.channelId || getResolvedEloSubmitPanelSnapshot().channelId || getLegacyEloSubmitPanelState(liveState.rawDb).channelId || "");
  }

  return ephemeralPayload({ content: "Тебя пока нет в ELO тир-листе и активной заявки тоже нет." });
}

async function ensureLegacyEloSubmitHubMessage(client, liveState, forcedChannelId = null) {
  if (!liveState?.ok) throw new Error("Legacy ELO state is unavailable");

  const state = getLegacyEloSubmitPanelState(liveState.rawDb);
  const resolvedSnapshot = getResolvedEloSubmitPanelSnapshot();
  const channelId = String(forcedChannelId || resolvedSnapshot.channelId || state.channelId || "").trim();
  if (!channelId) throw new Error("Не задан submit channel для legacy ELO.");

  const previousChannelId = String(state.channelId || "").trim();
  const previousMessageId = String(state.messageId || "").trim();
  if (previousMessageId && previousChannelId && previousChannelId !== channelId) {
    const previousChannel = await client.channels.fetch(previousChannelId).catch(() => null);
    const previousMessage = previousChannel?.isTextBased?.()
      ? await previousChannel.messages.fetch(previousMessageId).catch(() => null)
      : null;
    if (previousMessage) await previousMessage.delete().catch(() => {});
    state.messageId = "";
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) throw new Error("Legacy ELO submit channel должен быть текстовым.");

  let message = null;
  if (state.messageId) {
    message = await channel.messages.fetch(state.messageId).catch(() => null);
    if (message && message.author?.id && client.user?.id && message.author.id !== client.user.id) {
      message = null;
      state.messageId = "";
    }
  }

  const payload = {
    embeds: [buildLegacyEloSubmitHubEmbed()],
    components: buildLegacyEloSubmitHubComponents(),
  };

  if (!message) {
    message = await channel.send(payload).catch(() => null);
    if (!message) throw new Error("Не удалось отправить legacy ELO submit hub в канал.");
  } else {
    const edited = await message.edit(payload).catch(() => null);
    if (!edited) {
      state.messageId = "";
      message = await channel.send(payload).catch(() => null);
      if (!message) throw new Error("Не удалось отправить legacy ELO submit hub в канал.");
    }
  }

  state.channelId = channelId;
  state.messageId = message.id;
  const syncResult = saveLiveLegacyEloStateAndResync(liveState);
  return {
    ok: true,
    channelId,
    messageId: message.id,
    syncResult,
  };
}

async function clearLegacyEloSubmitHubMessage(client, liveState) {
  if (!liveState?.ok) throw new Error("Legacy ELO state is unavailable");

  const state = getLegacyEloSubmitPanelState(liveState.rawDb);
  const previousChannelId = String(state.channelId || "").trim();
  let deletedMessageId = String(state.messageId || "").trim() || null;

  if (previousChannelId) {
    const channel = await client.channels.fetch(previousChannelId).catch(() => null);
    if (channel?.isTextBased?.()) {
      const message = await fetchStoredBotMessage(channel, state, "messageId", client.user?.id);
      if (message) {
        deletedMessageId = message.id;
        await message.delete().catch(() => {});
      }
    }
  }

  state.channelId = "";
  state.messageId = "";
  const syncResult = saveLiveLegacyEloStateAndResync(liveState);
  return {
    ok: true,
    deletedMessageId,
    syncResult,
  };
}

async function createPendingLegacyEloSubmissionFromUrl(client, liveState, input) {
  const elo = parseLegacyElo(input.rawText);
  const tier = tierForLegacyElo(elo);
  if (!input.screenshotUrl || !elo || !tier) {
    throw new Error("Нужен скрин и число ELO минимум 10.");
  }

  const blockReason = getLegacyEloSubmitEligibilityError(liveState.rawDb, input.user.id, input.rawText);
  if (blockReason) throw new Error(blockReason);

  const submissionId = makeId();
  let reviewAttachment = null;
  let reviewImage = input.screenshotUrl;

  try {
    const buffer = await downloadToBuffer(input.screenshotUrl);
    reviewAttachment = createReviewAttachmentFromBuffer(submissionId, buffer);
    if (reviewAttachment?.name) reviewImage = `attachment://${reviewAttachment.name}`;
  } catch {}

  const previousCooldown = Number(liveState.rawDb.cooldowns?.[input.user.id] || 0);
  liveState.rawDb.submissions[submissionId] = {
    id: submissionId,
    userId: input.user.id,
    name: input.member?.displayName || input.user.username,
    username: input.user.username,
    elo,
    tier,
    screenshotUrl: input.screenshotUrl,
    reviewImage,
    reviewFileName: reviewAttachment?.name || null,
    messageUrl: input.messageUrl || input.screenshotUrl,
    status: "pending",
    createdAt: nowIso(),
    reviewChannelId: null,
    reviewMessageId: null,
    reviewedAt: null,
    reviewedBy: null,
    rejectReason: null,
    reviewAttachmentUrl: "",
  };
  liveState.rawDb.cooldowns[input.user.id] = Date.now();

  const submission = liveState.rawDb.submissions[submissionId];
  const reviewMessage = await postLegacyEloReviewRecord(
    client,
    submission,
    reviewAttachment,
    "pending",
    [],
    [buildLegacyEloReviewButtons(submissionId)]
  );
  if (!reviewMessage) {
    delete liveState.rawDb.submissions[submissionId];
    if (previousCooldown) liveState.rawDb.cooldowns[input.user.id] = previousCooldown;
    else delete liveState.rawDb.cooldowns[input.user.id];
    throw new Error("Не удалось отправить заявку в review-канал.");
  }

  attachLegacyEloReviewRecord(liveState.rawDb, submissionId, {
    reviewChannelId: reviewMessage.channel.id,
    reviewMessageId: reviewMessage.id,
    reviewAttachmentUrl: reviewMessage.attachments.first()?.url || "",
    reviewImage: reviewMessage.attachments.first()?.url || submission.reviewImage || submission.screenshotUrl,
    updatedAt: submission.createdAt,
  });

  const syncResult = saveLiveLegacyEloStateAndResync(liveState);
  return {
    submissionId,
    syncResult,
    submission: liveState.rawDb.submissions[submissionId],
  };
}

function buildDormantEloProfilePayload(userId, statusText = "", includeFlags = true) {
  const snapshot = getDormantEloProfileSnapshot(db, userId);
  if (!snapshot) {
    return includeFlags
      ? ephemeralPayload({ content: "Для этого пользователя dormant ELO-проекция пока не найдена." })
      : { content: "Для этого пользователя dormant ELO-проекция пока не найдена." };
  }

  const lines = [
    `Игрок: <@${snapshot.userId}>`,
    `Имя: **${snapshot.displayName}**`,
    `Текущий ELO: **${snapshot.currentElo !== null ? formatNumber(snapshot.currentElo) : "—"}**`,
    `Текущий tier: **${snapshot.currentTier !== null ? snapshot.currentTier : "—"}**`,
    `Последний submission: **${snapshot.lastSubmissionId || "—"}**`,
    `Статус submission: **${snapshot.lastSubmissionStatus || "—"}**`,
    `Submission ELO/tier: **${snapshot.lastSubmissionElo !== null ? formatNumber(snapshot.lastSubmissionElo) : "—"} / ${snapshot.lastSubmissionTier !== null ? snapshot.lastSubmissionTier : "—"}**`,
    `Создано: **${snapshot.lastSubmissionCreatedAt ? formatDateTime(snapshot.lastSubmissionCreatedAt) : "—"}**`,
    `Проверено: **${snapshot.lastReviewedAt ? formatDateTime(snapshot.lastReviewedAt) : "—"}**`,
    `Review channel: ${formatChannelMention(snapshot.reviewChannelId)}`,
    `Review message: **${snapshot.reviewMessageId || "—"}**`,
    `Proof: ${snapshot.proofUrl || "—"}`,
  ];

  const embed = new EmbedBuilder()
    .setTitle("ELO Профиль")
    .setDescription(lines.join("\n"));

  if (statusText) {
    embed.addFields({ name: "Статус", value: statusText, inline: false });
  }

  const payload = { embeds: [embed] };
  return includeFlags ? ephemeralPayload(payload) : payload;
}

function buildDormantTierlistProfilePayload(userId, statusText = "", includeFlags = true) {
  const snapshot = getDormantTierlistProfileSnapshot(db, userId);
  if (!snapshot) {
    return includeFlags
      ? ephemeralPayload({ content: "Для этого пользователя dormant Tierlist-проекция пока не найдена." })
      : { content: "Для этого пользователя dormant Tierlist-проекция пока не найдена." };
  }

  const lines = [
    `Игрок: <@${snapshot.userId}>`,
    `Имя: **${snapshot.displayName}**`,
    `Main: **${snapshot.mainName || snapshot.mainId || "—"}**`,
    `Main ID: **${snapshot.mainId || "—"}**`,
    `Submitted: **${snapshot.submittedAt ? formatDateTime(snapshot.submittedAt) : "—"}**`,
    `Lock until: **${snapshot.lockUntil ? formatDateTime(snapshot.lockUntil) : "—"}**`,
    `Influence: **x${snapshot.influenceMultiplier || 1}**`,
    `Influence role: ${formatRoleMention(snapshot.influenceRoleId)}`,
    `Dashboard synced: **${snapshot.dashboardSyncedAt ? formatDateTime(snapshot.dashboardSyncedAt) : "—"}**`,
    `Summary synced: **${snapshot.summarySyncedAt ? formatDateTime(snapshot.summarySyncedAt) : "—"}**`,
  ];

  const embed = new EmbedBuilder()
    .setTitle("Tierlist Профиль")
    .setDescription(lines.join("\n"));

  if (statusText) {
    embed.addFields({ name: "Статус", value: statusText, inline: false });
  }

  const payload = { embeds: [embed] };
  return includeFlags ? ephemeralPayload(payload) : payload;
}

function buildDormantEloPendingPayload(limit = 10, includeFlags = true) {
  const liveState = getLiveLegacyEloState();
  if (!liveState.ok) {
    return buildLegacyEloStateErrorPayload("Не удалось открыть pending очередь ELO", liveState, includeFlags);
  }

  const entries = listLegacyEloPendingSubmissions(liveState.rawDb, { limit });
  const totalPending = Object.values(liveState.rawDb.submissions || {})
    .filter((submission) => String(submission?.status || "").trim() === "pending")
    .length;
  const description = entries.length
    ? entries.map((entry, index) => {
      const expired = isLegacyEloSubmissionExpired(entry, { pendingExpireHours: LEGACY_ELO_PENDING_EXPIRE_HOURS });
      return [
        `${index + 1}. <@${entry.userId}> — **${previewText(entry.name || entry.username || entry.userId, 60)}**`,
        `ELO **${entry.elo !== null ? formatNumber(entry.elo) : "—"}**`,
        `tier **${entry.tier !== null ? entry.tier : "—"}**`,
        `id **${entry.id}**`,
        expired ? "expired by time" : `created ${entry.createdAt ? formatDateTime(entry.createdAt) : "—"}`,
      ].join(" | ");
    }).join("\n")
    : "Pending-заявок из legacy ELO db сейчас нет.";

  const payload = {
    embeds: [
      new EmbedBuilder()
        .setTitle("ELO Pending Queue")
        .setDescription(`Показано: **${entries.length}** из **${totalPending}** pending.\n\n${description}`),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("elo_review_open").setLabel("Открыть заявку").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("elo_review_refresh_pending").setLabel("Обновить").setStyle(ButtonStyle.Secondary)
      ),
    ],
  };

  return includeFlags ? ephemeralPayload(payload) : payload;
}

async function registerGuildCommands(client) {
  const guild = await client.guilds.fetch(GUILD_ID);
  await guild.commands.set([...buildCommands(), buildComboCommands()]);
}

function getLegacyEloTierRoleTarget(rawDb, userId) {
  const rating = rawDb?.ratings?.[userId];
  const tier = Number(rating?.tier);
  return Number.isInteger(tier) && tier >= 1 && tier <= 5 ? tier : null;
}

function isLegacyEloRoleGrantEnabled(currentDb = db) {
  return getResolvedIntegrationRecord("elo", currentDb).roleGrantEnabled !== false;
}

function setLegacyEloRoleGrantEnabled(value) {
  writeNativeIntegrationRoleGrantEnabled(db, { slot: "elo", value });
}

async function revokeAllLegacyEloTierRoles(client, options = {}) {
  const pool = getAllLegacyEloTierRoleIds();
  if (pool.length === 0) {
    return { processed: 0, removed: 0, errors: 0, skipped: "legacy_elo_role_ids_not_configured" };
  }

  const reason = String(options.reason || "legacy elo role grant disabled").trim() || "legacy elo role grant disabled";
  const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
  if (!guild) return { processed: 0, removed: 0, errors: 0, skipped: "guild_not_available" };

  await guild.members.fetch().catch(() => {});

  const poolSet = new Set(pool);
  let processed = 0;
  let removed = 0;
  let errors = 0;

  for (const member of guild.members.cache.values()) {
    const matched = member.roles.cache.filter((role) => poolSet.has(role.id));
    if (matched.size === 0) continue;
    processed += 1;
    for (const roleId of matched.keys()) {
      try {
        await member.roles.remove(roleId, reason);
        removed += 1;
      } catch (error) {
        errors += 1;
      }
    }
  }

  return { processed, removed, errors };
}

async function syncLegacyEloTierRoles(client, rawDb, options = {}) {
  if (!isLegacyEloRoleGrantEnabled()) {
    return { processed: 0, assigned: 0, cleared: 0, skipped: "elo_role_grant_disabled" };
  }

  const allTierRoleIds = getAllLegacyEloTierRoleIds();
  if (allTierRoleIds.length !== 5) {
    return { processed: 0, assigned: 0, cleared: 0, skipped: "legacy_elo_role_ids_not_configured" };
  }

  const targetUserId = String(options.targetUserId || "").trim();
  const reason = String(options.reason || "legacy elo tier role sync").trim() || "legacy elo tier role sync";
  const explicitClearUserIds = Array.isArray(options.clearUserIds)
    ? options.clearUserIds.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const clearUserIds = new Set(explicitClearUserIds);
  const targetUserIds = targetUserId
    ? [targetUserId]
    : Object.keys(rawDb?.ratings || {}).map((value) => String(value || "").trim()).filter(Boolean);

  let processed = 0;
  let assigned = 0;
  let cleared = 0;

  for (const userId of targetUserIds) {
    processed += 1;
    const tier = getLegacyEloTierRoleTarget(rawDb, userId);
    if (tier) {
      await ensureSingleRoleInPool(client, userId, getLegacyEloTierRoleId(tier), allTierRoleIds, reason);
      assigned += 1;
      clearUserIds.delete(userId);
      continue;
    }

    const didClear = await clearRolePool(client, userId, allTierRoleIds, reason);
    if (didClear) cleared += 1;
    clearUserIds.delete(userId);
  }

  for (const userId of clearUserIds) {
    processed += 1;
    const didClear = await clearRolePool(client, userId, allTierRoleIds, reason);
    if (didClear) cleared += 1;
  }

  return { processed, assigned, cleared };
}

async function syncApprovedTierRoles(client, targetUserId = null) {
  if (targetUserId) {
    const profile = db.profiles[targetUserId];
    if (!profile?.killTier) return 0;
    await ensureSingleTierRole(client, targetUserId, Number(profile.killTier), "manual sync");
    return 1;
  }

  let synced = 0;
  for (const [userId, profile] of Object.entries(db.profiles || {})) {
    if (!profile?.killTier) continue;
    await ensureSingleTierRole(client, userId, Number(profile.killTier), "startup sync");
    synced += 1;
  }
  return synced;
}

async function applyManualPanelOverride(client, slot, channelId = "") {
  const normalizedSlot = String(slot || "").trim();
  if (["welcome", "nonGgs"].includes(normalizedSlot)) {
    if (channelId) {
      return refreshWelcomePanel(client);
    }
    return clearWelcomeManagedPanel(client, normalizedSlot);
  }

  if (normalizedSlot === "eloSubmit") {
    const liveState = getLiveLegacyEloState();
    if (!liveState.ok) {
      throw new Error("Legacy ELO state is unavailable");
    }

    if (channelId) {
      return ensureLegacyEloSubmitHubMessage(client, liveState, channelId);
    }
    return clearLegacyEloSubmitHubMessage(client, liveState);
  }

  if (normalizedSlot === "eloGraphic") {
    const liveState = getLiveLegacyEloState();
    if (!liveState.ok) {
      throw new Error(liveState.error || "Legacy ELO db недоступна");
    }

    if (channelId) {
      return refreshLegacyEloGraphicBoard(client, { liveState, channelId });
    }
    return clearLegacyEloGraphicBoard(client, liveState);
  }

  if (["tierlistDashboard", "tierlistSummary"].includes(normalizedSlot)) {
    const liveState = getLiveLegacyTierlistState();
    if (!liveState.ok) {
      throw new Error(liveState.error || "Legacy Tierlist state недоступен");
    }

    if (normalizedSlot === "tierlistDashboard") {
      if (channelId) {
        return ensureLegacyTierlistDashboardMessage(client, liveState, channelId);
      }
      return clearLegacyTierlistDashboardMessage(client, liveState);
    }

    if (channelId) {
      return ensureLegacyTierlistSummaryMessage(client, liveState, channelId);
    }
    return clearLegacyTierlistSummaryMessage(client, liveState);
  }

  throw new Error("Panel override для этого slot пока не поддержан.");
}

async function writeAndApplyNativePanelOverride(client, slot, channelId = "") {
  const slotInfo = normalizeNativePanelSlot(slot);
  if (!slotInfo) {
    throw new Error("Неизвестный panel slot.");
  }

  if (!channelId) {
    const writeResult = clearNativePanelRecord(db, { slot: slotInfo.canonical });
    if (writeResult.mutated) saveDb();
    const applyResult = await applyManualPanelOverride(client, slotInfo.canonical, "");
    return {
      slotInfo,
      channel: null,
      writeResult,
      applyResult,
      cleared: true,
    };
  }

  const guild = await getGuild(client).catch(() => null);
  if (!guild) {
    throw new Error("Не удалось получить guild для проверки канала.");
  }

  await guild.channels.fetch().catch(() => null);
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    throw new Error("Указанный канал не является текстовым.");
  }

  const writeResult = writeNativePanelRecord(db, {
    slot: slotInfo.canonical,
    channelId: channel.id,
    source: "manual",
    lastUpdated: nowIso(),
    evidence: {
      manualOverride: true,
      channelName: channel.name,
    },
  });
  if (writeResult.mutated) saveDb();
  const applyResult = await applyManualPanelOverride(client, slotInfo.canonical, channel.id);
  return {
    slotInfo,
    channel,
    writeResult,
    applyResult,
    cleared: false,
  };
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.on("error", (error) => {
  console.error("Discord client error:", error);
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled rejection:", error);
});

const verificationOauthStates = new Map();
const verificationRoleMutationIgnores = new Map();
const autonomyGuardRoleMutationIgnores = new Map();
const autonomyGuardProtectedRoleMutationIgnores = new Map();
const autonomyGuardMessageDeleteAuditClaims = new Map();
let verificationCallbackServer = null;
const VERIFICATION_OAUTH_STATE_EXPIRE_MS = 10 * 60 * 1000;
const VERIFICATION_ROLE_MUTATION_IGNORE_MS = 30 * 1000;
const AUTONOMY_GUARD_ROLE_MUTATION_IGNORE_MS = 30 * 1000;
const AUTONOMY_GUARD_AUDIT_LOG_LOOKBACK_MS = 30 * 1000;
const AUTONOMY_GUARD_MESSAGE_DELETE_CLAIM_MS = 30 * 1000;

client.once("clientReady", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Data root: ${DATA_ROOT}`);
  console.log(`DB path: ${DB_PATH}`);
  let generated = {
    characterRoles: 0,
    resolvedCharacters: 0,
    recoveredCharacters: 0,
    ambiguousCharacters: 0,
    unresolvedCharacters: 0,
    tierRoles: 0,
  };
  let startupDegraded = [];

  try {
    ({ generated, degraded: startupDegraded } = await runClientReadyCore(client, {
      ensureManagedRoles,
      runSotStartupAlerts: (currentClient) => runSotStartupAlerts(currentClient, {
        maybeLogSotCharacterHealthAlert,
        maybeLogSotDriftAlert,
        logError: (...args) => console.error(...args),
      }),
      registerGuildCommands,
      syncApprovedTierRoles,
      refreshWelcomePanel,
      refreshAllTierlists,
      resumeActivityRuntime: () => resumeActivityRuntime({
        db,
        saveDb,
        runSerialized: runSerializedDbTask,
      }),
      logError: (...args) => console.error(...args),
    }));
  } catch (error) {
    console.error("Client ready core failed:", error?.message || error);
    process.exitCode = 1;
    client.destroy();
    return;
  }

  lastClientReadyCoreCompletedAt = nowIso();
  lastClientReadyCoreDegraded = Array.isArray(startupDegraded)
    ? startupDegraded.map((entry) => ({
      step: String(entry?.step || "unknown").trim() || "unknown",
      message: String(entry?.message || "unknown error").trim() || "unknown error",
    }))
    : [];

  if (Array.isArray(startupDegraded) && startupDegraded.length) {
    console.warn(
      "Client ready completed in degraded mode:",
      startupDegraded
        .map((entry) => `${entry.step}: ${entry.message}`)
        .join("; ")
    );
  }

  const legacyEloState = getLiveLegacyEloState();
  if (legacyEloState.ok) {
    const submitChannelId = String(getResolvedEloSubmitPanelSnapshot().channelId || getLegacyEloSubmitPanelState(legacyEloState.rawDb).channelId || "").trim();
    const graphicChannelId = String(getResolvedEloGraphicPanelSnapshot().channelId || ensureLegacyEloGraphicState(legacyEloState.rawDb).dashboardChannelId || "").trim();
    if (submitChannelId) {
      await ensureLegacyEloSubmitHubMessage(client, legacyEloState, submitChannelId).catch((error) => {
        console.error("Legacy ELO submit hub setup failed:", error?.message || error);
      });
    }
    if (graphicChannelId) {
      await refreshLegacyEloGraphicBoard(client, { liveState: legacyEloState, channelId: graphicChannelId }).catch((error) => {
        console.error("Legacy ELO graphic board setup failed:", error?.message || error);
      });
    }

    try {
      const roleSync = await syncLegacyEloTierRoles(client, legacyEloState.rawDb, { reason: "legacy elo startup sync" });
      if (roleSync.processed > 0) {
        console.log(`[legacy-elo][roles] startup sync: assigned ${roleSync.assigned}, cleared ${roleSync.cleared}`);
      }
    } catch (error) {
      console.error("Legacy ELO tier role sync failed:", error?.message || error);
    }
  }

  const legacyTierlistState = getLiveLegacyTierlistState();
  if (legacyTierlistState.ok) {
    const dashboardChannelId = String(
      getResolvedLegacyTierlistDashboardSnapshot().channelId
      || legacyTierlistState.rawState?.settings?.channelId
      || (isLegacyTierlistDashboardDisabled(legacyTierlistState.rawState) ? "" : appConfig.channels.tierlistChannelId)
      || ""
    ).trim();
    const summaryChannelId = String(getResolvedLegacyTierlistSummarySnapshot().channelId || legacyTierlistState.rawState?.settings?.summaryChannelId || "").trim();
    if (dashboardChannelId) {
      await ensureLegacyTierlistDashboardMessage(client, legacyTierlistState, dashboardChannelId).catch((error) => {
        console.error("Legacy Tierlist dashboard setup failed:", error?.message || error);
      });
    }
    if (summaryChannelId) {
      await ensureLegacyTierlistSummaryMessage(client, legacyTierlistState, summaryChannelId).catch((error) => {
        console.error("Legacy Tierlist summary setup failed:", error?.message || error);
      });
    }
    try {
      const result = await backfillLegacyTierlistInfluenceForExistingVoters(client, { refresh: true });
      if (result.error) {
        console.warn(`[legacy-tierlist][influence] startup backfill skipped: ${result.error}`);
      }
      if (result.total > 0 || result.refreshError) {
        const parts = [`changed ${result.changed}/${result.total}`];
        if (result.refreshError) parts.push(`refresh warning: ${result.refreshError}`);
        console.log(`[legacy-tierlist][influence] startup backfill: ${parts.join(" • ")}`);
      }
    } catch (error) {
      console.error("Legacy Tierlist influence backfill failed:", error?.message || error);
    }
    try {
      const result = await backfillLegacyTierlistMainsForExistingMembers(client, { refresh: true });
      if (result.error) {
        console.warn(`[legacy-tierlist][mains] startup backfill skipped: ${result.error}`);
      }
      if (result.total > 0 || result.skippedMissingMembers > 0 || result.refreshError) {
        const parts = [`changed ${result.changed}/${result.total}`];
        if (result.skippedMissingMembers) parts.push(`skipped missing members ${result.skippedMissingMembers}`);
        if (result.refreshError) parts.push(`refresh warning: ${result.refreshError}`);
        console.log(`[legacy-tierlist][mains] startup backfill: ${parts.join(" • ")}`);
      }
    } catch (error) {
      console.error("Legacy Tierlist mains backfill failed:", error?.message || error);
    }
  }
  console.log(`Managed roles ready. Characters: ${generated.characterRoles}, resolved: ${generated.resolvedCharacters}, recovered: ${generated.recoveredCharacters}, ambiguous: ${generated.ambiguousCharacters}, unresolved: ${generated.unresolvedCharacters}, tiers: ${generated.tierRoles}`);

  try {
    const verificationRuntime = await startVerificationRuntime(client);
    if (verificationRuntime.enabled) {
      console.log(`Verification runtime ready. callback=${verificationRuntime.callbackStarted ? "yes" : "no"} entry=${verificationRuntime.entryPublished ? "yes" : "no"}`);
    }
  } catch (error) {
    console.error("Verification runtime startup failed:", error?.message || error);
  }

  try {
    const verificationReconcile = await reconcileVerificationAssignments(client, {
      reason: "verify role missing after startup",
    });
    if (verificationReconcile.stopped > 0) {
      console.log(`Verification reconcile stopped ${verificationReconcile.stopped}/${verificationReconcile.checked} active assignments without verify-role.`);
    }
  } catch (error) {
    console.error("Verification role reconcile failed:", error?.message || error);
  }

  try {
    const autonomyResult = await reconcileAutonomyGuardTargetRole(client, {
      reason: "autonomy target startup reconcile",
    });
    if (!autonomyResult.skipped) {
      console.log(`Autonomy target ready for ${autonomyResult.targetUserId} with role ${autonomyResult.roleId}.`);
    }
  } catch (error) {
    console.error("Autonomy target startup reconcile failed:", error?.message || error);
  }

  console.log("Welcome onboarding bot is ready");
  readyClient = client;

  const periodicJobs = buildClientReadyPeriodicJobs({
    runAutoResendTick,
    rolePanelAutoResendTickMs: ROLE_PANEL_AUTO_RESEND_TICK_MS,
    refreshLegacyTierlistSummaryMessage,
    legacyTierlistSummaryRefreshMs: LEGACY_TIERLIST_SUMMARY_REFRESH_MS,
    flushActivityRuntime: () => flushActivityRuntime({
      db,
      saveDb,
      runSerialized: runSerializedDbTask,
      resolveMemberActivityMeta: (userId) => resolveActivityMemberMeta(client, userId),
    }),
    activityFlushIntervalMs: ACTIVITY_RUNTIME_FLUSH_INTERVAL_MS,
    runDailyActivityRoleSync: () => runDailyActivityRoleSync({
      db,
      saveDb,
      runSerialized: runSerializedDbTask,
      listManagedActivityRoleUserIds: () => listActivityRoleHolderUserIds(client),
      resolveMemberRoleIds: (userId) => resolveActivityMemberRoleIds(client, userId),
      resolveMemberActivityMeta: (userId) => resolveActivityMemberMeta(client, userId),
      applyRoleChanges: ({ userId, addRoleIds, removeRoleIds }) => applyActivityMemberRoleChanges(client, {
        userId,
        addRoleIds,
        removeRoleIds,
        reason: "activity daily role sync",
      }),
    }),
    activityRoleSyncHours: ensureActivityState(db).config?.autoRoleSyncHours,
    runRobloxProfileRefreshJob: runScheduledRobloxProfileRefreshJob,
    syncRobloxPlaytime,
    flushRobloxRuntime,
    runVerificationDeadlineSweep: (currentClient) => runVerificationDeadlineSweep(currentClient),
    getResolvedIntegrationSourcePath,
    roblox: getEffectiveRobloxConfig(),
    verification: getVerificationIntegrationState(),
  });
  periodicJobs.push({
    run: () => getAntiteamOperator().sweepIdleTickets(),
    intervalMs: 5 * 60 * 1000,
    errorLabel: "Antiteam idle sweep failed",
  });

  const nonRobloxPeriodicJobs = periodicJobs.filter((job) => !String(job?.key || "").startsWith("roblox."));
  const startupRobloxPeriodicJobs = periodicJobs.filter((job) => String(job?.key || "").startsWith("roblox."));

  scheduleClientReadyIntervals(client, {
    periodicJobs: nonRobloxPeriodicJobs,
    scheduleSotAlertTicks: (currentClient) => scheduleSotAlertTicks(currentClient, {
      maybeLogSotCharacterHealthAlert,
      maybeLogSotDriftAlert,
      characterPeriodicMs: SOT_CHARACTER_ALERT_PERIODIC_MS,
      driftPeriodicMs: SOT_CHARACTER_ALERT_PERIODIC_MS,
      logError: (...args) => console.error(...args),
    }),
    logError: (...args) => console.error(...args),
  });

  clearIntervalHandles(robloxIntervalHandles);
  robloxIntervalHandles = schedulePeriodicJobs(client, {
    periodicJobs: startupRobloxPeriodicJobs,
    logError: (...args) => console.error(...args),
  });
});

client.on("guildMemberUpdate", async (oldMember, newMember) => {
  if (newMember.guild.id !== GUILD_ID) return;

  try {
    const result = await syncLegacyTierlistInfluenceForMember(client, newMember);
    if (result?.error) {
      console.warn(`[legacy-tierlist] influence sync skipped for ${newMember.id}: ${result.error}`);
    }
    if (result?.refreshError) {
      console.warn(`[legacy-tierlist] influence sync refresh warning for ${newMember.id}: ${result.refreshError}`);
    }
  } catch (error) {
    console.error("Legacy Tierlist influence sync failed:", error?.message || error);
  }

  try {
    const result = await syncLiveLegacyTierlistMainsForMember(client, newMember);
    if (result?.error) {
      console.warn(`[legacy-tierlist] mains sync skipped for ${newMember.id}: ${result.error}`);
    }
    if (result?.refreshError) {
      console.warn(`[legacy-tierlist] mains sync refresh warning for ${newMember.id}: ${result.refreshError}`);
    }
  } catch (error) {
    console.error("Legacy Tierlist mains sync failed:", error?.message || error);
  }

  try {
    const verifyRoleId = cleanVerificationText(getVerifyAccessRoleId(), 80);
    const hadVerifyRole = Boolean(verifyRoleId && oldMember?.roles?.cache?.has(verifyRoleId));
    const hasVerifyRole = Boolean(verifyRoleId && newMember?.roles?.cache?.has(verifyRoleId));

    if (hadVerifyRole && !hasVerifyRole) {
      if (shouldIgnoreVerificationRoleMutation(newMember.id)) {
        clearVerificationRoleMutationIgnore(newMember.id);
      } else {
        const result = await reconcileVerificationAssignmentForMember(client, newMember.id, newMember, {
          reason: "verify role removed manually",
        });
        if (result.stopped) {
          await logVerificationRuntimeEvent(client, `VERIFICATION_STOPPED: <@${newMember.id}> verify-role снята вручную, отсчёт остановлен.`, "warn");
        }
      }
    }
  } catch (error) {
    console.error("Verification role lifecycle sync failed:", error?.message || error);
  }

  try {
    const targetState = getAutonomyGuardState();
    const targetRoleId = String(targetState.protectedRole?.roleId || "").trim();
    const hadTargetRole = Boolean(targetRoleId && oldMember?.roles?.cache?.has(targetRoleId));
    const hasTargetRole = Boolean(targetRoleId && newMember?.roles?.cache?.has(targetRoleId));

    if (String(targetState.targetUserId || "").trim() === String(newMember.id || "").trim() && hadTargetRole && !hasTargetRole) {
      if (shouldIgnoreAutonomyGuardRoleMutation(newMember.id)) {
        clearAutonomyGuardRoleMutationIgnore(newMember.id);
      } else {
        const result = await reconcileAutonomyGuardTargetRole(client, {
          guildHint: newMember.guild,
          reason: "autonomy target role removed manually",
        });
        if (!result.skipped) {
          await logLine(client, `AUTONOMY_TARGET_ROLE_RESTORED: <@${newMember.id}> by automatic reconcile.`).catch(() => {});
        }
      }
    }
  } catch (error) {
    console.error("Autonomy target lifecycle sync failed:", error?.message || error);
  }

  try {
    const targetState = getAutonomyGuardState();
    if (Array.isArray(targetState.isolatedUserIds) && targetState.isolatedUserIds.length > 0) {
      const trackedTargetUserId = String(targetState.targetUserId || "").trim();
      const trackedTargetRoleId = String(targetState.protectedRole?.roleId || "").trim();
      const roleDiff = diffAutonomyGuardProtectedRoleIds({
        previousRoleIds: Array.from(oldMember?.roles?.cache?.keys?.() || []),
        nextRoleIds: Array.from(newMember?.roles?.cache?.keys?.() || []),
        protectedRoleIds: getAutonomyGuardProtectedRoleIds(),
      });

      const filteredAddedRoleIds = roleDiff.addedRoleIds.filter((roleId) => !(trackedTargetUserId && trackedTargetRoleId
        && trackedTargetUserId === String(newMember.id || "").trim()
        && roleId === trackedTargetRoleId));
      const filteredRemovedRoleIds = roleDiff.removedRoleIds.filter((roleId) => !(trackedTargetUserId && trackedTargetRoleId
        && trackedTargetUserId === String(newMember.id || "").trim()
        && roleId === trackedTargetRoleId));
      const filteredRoleDiff = {
        addedRoleIds: filteredAddedRoleIds,
        removedRoleIds: filteredRemovedRoleIds,
        changedRoleIds: [...filteredAddedRoleIds, ...filteredRemovedRoleIds],
        hasProtectedChanges: filteredAddedRoleIds.length > 0 || filteredRemovedRoleIds.length > 0,
      };

      if (filteredRoleDiff.hasProtectedChanges) {
        if (shouldIgnoreAutonomyGuardProtectedRoleMutation(newMember.id)) {
          clearAutonomyGuardProtectedRoleMutationIgnore(newMember.id);
        } else {
          const auditEntry = await findAutonomyGuardMemberRoleAuditEntry(newMember.guild, newMember.id, filteredRoleDiff);
          const actorUserId = String(auditEntry?.executor?.id || "").trim();
          if (actorUserId && actorUserId !== String(newMember.id || "").trim() && isAutonomyGuardIsolatedUser(db, actorUserId)) {
            const revertResult = await applyAutonomyGuardProtectedRoleChanges(client, newMember.id, {
              guildHint: newMember.guild,
              addRoleIds: filteredRoleDiff.removedRoleIds,
              removeRoleIds: filteredRoleDiff.addedRoleIds,
              reason: `autonomy anti-tamper revert after isolated actor ${actorUserId}`,
            });

            if (!revertResult.skipped) {
              const addedRoleText = revertResult.addedRoleIds.length
                ? revertResult.addedRoleIds.map((roleId) => formatRoleMention(roleId)).join(", ")
                : "-";
              const removedRoleText = revertResult.removedRoleIds.length
                ? revertResult.removedRoleIds.map((roleId) => formatRoleMention(roleId)).join(", ")
                : "-";
              await logLine(
                client,
                `AUTONOMY_PROTECTED_ROLE_REVERTED: actor=<@${actorUserId}> target=<@${newMember.id}> add=${addedRoleText} remove=${removedRoleText}`
              ).catch(() => {});
            }
          }
        }
      }
    }
  } catch (error) {
    console.error("Autonomy protected role anti-tamper failed:", error?.message || error);
  }
});

client.on("guildMemberAdd", async (member) => {
  if (member.guild.id !== GUILD_ID) return;

  if (member.user.bot) return;

  const currentOnboardMode = getCurrentOnboardMode();

  if (isApocalypseMode(currentOnboardMode) && member.roles.cache.size <= 1) {
    await member.send([
      `Сейчас на сервере ${member.guild.name} включён режим «${getOnboardAccessModeLabel(currentOnboardMode)}».`,
      "Новые участники без ролей автоматически удаляются.",
    ].join("\n")).catch(() => {});

    const removed = await member.kick("onboarding apocalypse mode").then(() => true).catch(() => false);
    if (removed) {
      await logLine(client, `APOCALYPSE: удалён новый участник ${member.user.tag} (${member.id}) без ролей.`);
    } else {
      await logLine(client, `APOCALYPSE: не удалось удалить нового участника ${member.user.tag} (${member.id}) без ролей.`);
    }
    return;
  }

  const nonJjsUi = getNonJjsUiConfig();
  const welcomeChannelId = getResolvedChannelId("welcome");
  const text = [
    `Добро пожаловать на сервер ${member.guild.name}.`,
    welcomeChannelId
      ? `Чтобы открыть доступ и выбрать мейнов, зайди в <#${welcomeChannelId}> и нажми кнопку **${getPresentation().welcome.buttons.begin}**.`
      : "Welcome-канал пока не настроен. Попроси модератора указать его через Onboarding Panel.",
    `Если ты не играешь в JJS, там же есть отдельная кнопка **${nonJjsUi.buttonLabel}** с двухэтапной капчей.`,
  ].join("\n");
  await member.send(text).catch(() => {});

  try {
    if (String(getAutonomyGuardState().targetUserId || "").trim() === String(member.id || "").trim()) {
      const result = await reconcileAutonomyGuardTargetRole(client, {
        guildHint: member.guild,
        reason: "autonomy target member rejoined",
      });
      if (!result.skipped) {
        await logLine(client, `AUTONOMY_TARGET_ROLE_RESTORED: <@${member.id}> after rejoin.`).catch(() => {});
      }
    }
  } catch (error) {
    console.error("Autonomy target member-add reconcile failed:", error?.message || error);
  }
});

client.on("roleUpdate", async (_oldRole, newRole) => {
  if (newRole.guild.id !== GUILD_ID) return;

  try {
    const protectedRoleId = String(getAutonomyGuardState().protectedRole?.roleId || "").trim();
    if (!protectedRoleId || protectedRoleId !== String(newRole.id || "").trim()) return;

    const result = await ensureAutonomyGuardRole(newRole.guild, {
      reason: "autonomy target role changed manually",
    });
    if (result.stateChanged) saveDb();
  } catch (error) {
    console.error("Autonomy target role update reconcile failed:", error?.message || error);
  }
});

client.on("roleDelete", async (role) => {
  if (role.guild.id !== GUILD_ID) return;

  try {
    const targetState = getAutonomyGuardState();
    if (Array.isArray(targetState.isolatedUserIds) && targetState.isolatedUserIds.length > 0) {
      const auditEntry = await findAutonomyGuardRoleDeleteAuditEntry(role.guild, role.id);
      const actorUserId = String(auditEntry?.executor?.id || "").trim();
      if (actorUserId && isAutonomyGuardIsolatedUser(db, actorUserId)) {
        const stripResult = await stripAutonomyGuardAdminPowerFromUser(client, actorUserId, {
          guildHint: role.guild,
          reason: `autonomy sanction after deleting role ${role.id}`,
        });

        if (!stripResult.skipped) {
          const removedRoleText = stripResult.removedRoleIds.length
            ? stripResult.removedRoleIds.map((roleId) => formatRoleMention(roleId)).join(", ")
            : "-";
          await logLine(
            client,
            `AUTONOMY_ROLE_DELETE_SANCTION: actor=<@${actorUserId}> deleted=${previewFieldText(role.name || role.id, 80)} removed=${removedRoleText}`
          ).catch(() => {});
        }
      }
    }
  } catch (error) {
    console.error("Autonomy isolated role delete sanction failed:", error?.message || error);
  }

  try {
    const state = getAutonomyGuardState();
    const protectedRoleId = String(state.protectedRole?.roleId || "").trim();
    const protectedRoleName = String(state.protectedRole?.name || "").trim();
    const isTrackedRole = (protectedRoleId && protectedRoleId === String(role.id || "").trim())
      || (protectedRoleName && protectedRoleName === String(role.name || "").trim());
    if (!isTrackedRole) return;

    const result = await reconcileAutonomyGuardTargetRole(client, {
      guildHint: role.guild,
      reason: "autonomy target role deleted manually",
    });
    if (!result.skipped) {
      await logLine(client, `AUTONOMY_TARGET_ROLE_RECREATED: role recreated for <@${result.targetUserId}> after delete.`).catch(() => {});
    }
  } catch (error) {
    console.error("Autonomy target role delete reconcile failed:", error?.message || error);
  }
});

client.on("messageDelete", async (message) => {
  try {
    await handleAutonomyGuardDeletedMessage(client, message);
  } catch (error) {
    console.error("Autonomy message-delete sanction failed:", error?.message || error);
  }
});

client.on("messageDeleteBulk", async (messages) => {
  for (const message of messages.values()) {
    try {
      await handleAutonomyGuardDeletedMessage(client, message);
    } catch (error) {
      console.error("Autonomy bulk message-delete sanction failed:", error?.message || error);
    }
  }
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.guildId !== GUILD_ID) return;

  try {
    recordActivityMessage({
      db,
      message: {
        guildId: message.guildId,
        userId: message.author.id,
        channelId: message.channelId,
        createdAt: message.createdAt,
      },
    });
  } catch (error) {
    console.error("Activity runtime message ingest failed:", error?.message || error);
  }

  if (await getAntiteamOperator().handlePhotoMessage(message).catch((error) => {
    console.error("Antiteam photo flow failed:", error?.message || error);
    return false;
  })) {
    return;
  }

  const legacyEloState = getLiveLegacyEloState();
  const legacyEloSubmitChannelId = legacyEloState.ok
    ? String(getResolvedEloSubmitPanelSnapshot().channelId || getLegacyEloSubmitPanelState(legacyEloState.rawDb).channelId || "").trim()
    : "";

  const legacyEloManualModsetSession = getLegacyEloManualModsetSession(message.author.id);
  if (legacyEloManualModsetSession && message.channelId === legacyEloManualModsetSession.channelId) {
    if (!isModerator(message.member)) {
      clearLegacyEloManualModsetSession(message.author.id);
      return;
    }

    const rawMessageText = String(message.content || "").trim();
    if (/^(отмена|cancel)$/i.test(rawMessageText)) {
      clearLegacyEloManualModsetSession(message.author.id);
      await replyAndDelete(message, "Ручной legacy ELO modset отменён.");
      await message.delete().catch(() => {});
      return;
    }

    const parsedManualInput = parseLegacyEloManualChatInput(
      rawMessageText,
      legacyEloManualModsetSession.targetUserId || ""
    );
    const attachment = [...message.attachments.values()].find((item) => isImageAttachment(item));
    const targetUserId = parsedManualInput.targetUserId;
    const rawText = parsedManualInput.rawText || rawMessageText;
    const eloValue = parseLegacyElo(rawText);

    if (legacyEloManualModsetSession.stage === "awaiting_user") {
      if (!targetUserId) {
        await replyAndDelete(message, "Сначала пришли ID или mention игрока. Можно сразу одним сообщением: <@игрок> 110 и картинка.");
        await message.delete().catch(() => {});
        return;
      }

      if (!attachment || !eloValue) {
        setLegacyEloManualModsetSession(message.author.id, {
          channelId: message.channelId,
          stage: "awaiting_payload",
          targetUserId,
        });
        await replyAndDelete(
          message,
          [
            `Игрок сохранён: <@${targetUserId}>.`,
            `Теперь отправь следующим сообщением в ${formatChannelMention(message.channelId) || "этот канал"} текст с числом ELO и картинку.`,
            "Можно написать просто `110` и приложить скрин.",
            "Картинка обязательна. Для отмены напиши `отмена`.",
          ].join("\n")
        );
        await message.delete().catch(() => {});
        return;
      }
    }

    if (!targetUserId) {
      await replyAndDelete(message, "Не удалось определить игрока. Пришли mention или Discord user ID.");
      await message.delete().catch(() => {});
      return;
    }

    if (!eloValue) {
      await replyAndDelete(message, "Нужен текст с числом ELO. Пример: 73 или 110 elo.");
      await message.delete().catch(() => {});
      return;
    }

    if (!attachment) {
      await replyAndDelete(message, "Нужна картинка со скрином. Без картинки ручной modset не принимается.");
      await message.delete().catch(() => {});
      return;
    }

    if (!legacyEloState.ok) {
      clearLegacyEloManualModsetSession(message.author.id);
      await replyAndDelete(message, `Не удалось открыть legacy ELO базу: ${legacyEloState.error}`);
      await message.delete().catch(() => {});
      return;
    }

    try {
      const modsetResult = await performLegacyEloManualModset(
        client,
        legacyEloState,
        targetUserId,
        rawText,
        attachment.url,
        message.author.tag
      );
      clearLegacyEloManualModsetSession(message.author.id);
      await replyAndDelete(
        message,
        [
          `Legacy ELO modset выполнен для <@${targetUserId}>.`,
          `ELO: ${modsetResult.eloValue}.`,
          `Tier: ${modsetResult.tierValue}.`,
          `Review ID: ${modsetResult.created.submissionId}.`,
          `PNG: ${modsetResult.boardUpdated ? "обновлён" : "не настроен или пропущен"}.`,
        ].join(" ") + getLegacyEloSyncStatusSuffix(modsetResult.syncResult) + (modsetResult.warning || ""),
        16000
      );
    } catch (error) {
      clearLegacyEloManualModsetSession(message.author.id);
      await replyAndDelete(message, String(error?.message || error || "Не удалось выполнить legacy ELO modset."), 16000);
    }

    await message.delete().catch(() => {});
    return;
  }

  if (legacyEloSubmitChannelId && message.channelId === legacyEloSubmitChannelId) {
    const session = getLegacyEloSubmitSession(message.author.id);
    if (!session) return;

    const pending = getPendingLegacyEloSubmissionForUser(legacyEloState.rawDb, message.author.id);
    if (pending) {
      clearLegacyEloSubmitSession(message.author.id);
      await replyAndDelete(message, "У тебя уже есть заявка на проверке. Дождись решения модера.");
      await message.delete().catch(() => {});
      return;
    }

    const attachment = [...message.attachments.values()].find((item) => isImageAttachment(item));
    if (!attachment) {
      await replyAndDelete(message, "Сейчас нужен один следующий месседж именно с картинкой. Текст уже сохранён, просто приложи скрин или вставь его через Ctrl+V.");
      await message.delete().catch(() => {});
      return;
    }

    try {
      await createPendingLegacyEloSubmissionFromUrl(client, legacyEloState, {
        user: message.author,
        member: message.member,
        rawText: session.rawText,
        screenshotUrl: attachment.url,
        messageUrl: message.url,
      });

      clearLegacyEloSubmitSession(message.author.id);
      await replyAndDelete(message, "ELO заявка отправлена на проверку модерам.");
      await logLine(client, `ELO SUBMIT: <@${message.author.id}> raw=${session.rawText}`);
    } catch (error) {
      clearLegacyEloSubmitSession(message.author.id);
      await replyAndDelete(message, String(error?.message || error || "Не удалось отправить ELO заявку."), 16000);
    }

    await message.delete().catch(() => {});
    return;
  }

  const hasActiveWelcomeSubmitSession = message.channelId === getResolvedChannelId("welcome") && Boolean(getSubmitSession(message.author.id));
  if (!hasActiveWelcomeSubmitSession && await getProfileOperator().handleProfileMessage({
    message,
    replyAndDelete,
    scheduleDeleteMessage,
    helperDeleteMs: PROFILE_HELPER_MESSAGE_DELETE_MS,
  })) {
    return;
  }

  if (message.channelId !== getResolvedChannelId("welcome")) return;

  let session = getSubmitSession(message.author.id);
  const bootstrapMember = session
    ? null
    : (message.member?.roles?.cache ? message.member : await fetchMember(client, message.author.id).catch(() => null));
  const canResumeWithAccessRole = !session && memberHasManagedStartAccessRole(bootstrapMember);
  if (!session && canResumeWithAccessRole) {
    const bootstrapSession = buildSubmitSessionBootstrap(message.author.id, bootstrapMember);
    if (bootstrapSession?.mainCharacterIds?.length) {
      setSubmitSession(message.author.id, bootstrapSession);
      session = getSubmitSession(message.author.id);
    }
  }

  if (!session) {
    const reply = await message.reply(
      canResumeWithAccessRole
        ? "Не удалось восстановить твоих мейнов автоматически. Нажми «Получить роль» и выбери их заново, затем отправь kills и скрин одним сообщением."
        : "В этом канале принимается только заявка одним сообщением после кнопки «Получить роль»: текст с точным числом kills и скрин во вложении. Остальные сообщения удаляются."
    ).catch(() => null);
    if (reply) scheduleDeleteMessage(reply);
    await message.delete().catch(() => {});
    return;
  }

  const pending = getPendingSubmissionForUser(message.author.id);
  if (pending) {
    clearSubmitSession(message.author.id);
    const reply = await message.reply("У тебя уже есть заявка на проверке. Дождись решения модератора.").catch(() => null);
    if (reply) scheduleDeleteMessage(reply);
    await message.delete().catch(() => {});
    return;
  }

  const currentAccessGrantMode = getCurrentOnboardAccessGrantMode();
  const requiresRobloxBeforeReview = currentAccessGrantMode !== ONBOARD_ACCESS_GRANT_MODES.AFTER_SUBMIT;
  const hasRobloxIdentity = Boolean(session.robloxUsername && session.robloxUserId);

  const attachment = [...message.attachments.values()].find((item) => isImageAttachment(item));
  if (!attachment) {
    const reply = await message.reply("В одной заявке должны быть и kills в тексте, и скрин во вложении. Отправь одно сообщение с числом kills и приложи картинку.").catch(() => null);
    if (reply) scheduleDeleteMessage(reply);
    await message.delete().catch(() => {});
    return;
  }

  const killsResult = resolveEffectiveSubmittedKills(message.content, session?.suggestedKills);
  const { effectiveKills } = killsResult;

  if (effectiveKills === null) {
    const reply = await message.reply(
      killsResult.reason === "ambiguous"
        ? "Не понял число kills. Укажи в тексте только одно число, например `3120`, и приложи скрин в этом же сообщении."
        : "В тексте заявки нужно указать точное число kills, например `3120` или `3120 kills`, и приложить скрин в этом же сообщении."
    ).catch(() => null);
    if (reply) scheduleDeleteMessage(reply);
    await message.delete().catch(() => {});
    return;
  }

  if (requiresRobloxBeforeReview && !hasRobloxIdentity) {
    setSubmitSession(message.author.id, {
      ...session,
      pendingKills: effectiveKills,
      pendingScreenshotUrl: attachment.url,
      pendingScreenshotName: attachment.name || "",
    });
    const reply = await message.reply("Kills и скрин приняты. Теперь нажми «Получить роль» ещё раз и укажи Roblox username — без этого заявка не уйдёт модераторам.").catch(() => null);
    if (reply) scheduleDeleteMessage(reply, 18000);
    await message.delete().catch(() => {});
    return;
  }

  const accessRoleIds = getManagedStartAccessRoleIds();
  const previousProfile = cloneJsonValue(db.profiles?.[message.author.id]);
  const hadProfile = Boolean(db.profiles?.[message.author.id]);
  const hadCooldown = Object.prototype.hasOwnProperty.call(db.cooldowns || {}, message.author.id);
  const previousCooldown = hadCooldown ? db.cooldowns[message.author.id] : undefined;
  const accessMember = await fetchMember(client, message.author.id);
  const previousAccessRoleIds = getRolePoolSnapshot(accessMember, accessRoleIds);
  const existingProfile = db.profiles?.[message.author.id] || null;
  const isKillsUpdate = hasTrackedProfileKills(existingProfile);
  let submission = null;

  try {
    if (currentAccessGrantMode === ONBOARD_ACCESS_GRANT_MODES.AFTER_SUBMIT) {
      await maybeGrantAccessRoleAtStage(client, message.author.id, ONBOARD_ACCESS_GRANT_MODES.AFTER_SUBMIT, "newcomer application submitted");
    }

    submission = await createPendingSubmissionFromAttachment(client, {
      user: message.author,
      member: message.member,
      mainCharacterIds: session.mainCharacterIds,
      kills: effectiveKills,
      robloxUsername: session.robloxUsername,
      robloxUserId: session.robloxUserId,
      robloxDisplayName: session.robloxDisplayName,
      screenshotUrl: attachment.url,
    });

    if (currentAccessGrantMode === ONBOARD_ACCESS_GRANT_MODES.AFTER_REVIEW_POST) {
      await maybeGrantAccessRoleAtStage(client, message.author.id, ONBOARD_ACCESS_GRANT_MODES.AFTER_REVIEW_POST, "newcomer application moved to moderator review");
      saveDb();
    }
  } catch (error) {
    if (submission?.id) {
      delete db.submissions[submission.id];
      restoreRecordValue(db.profiles, message.author.id, previousProfile, hadProfile);
      restoreRecordValue(db.cooldowns, message.author.id, previousCooldown, hadCooldown);
      saveDb();
      await deleteTrackedMessage(
        client,
        submission.reviewChannelId,
        submission.reviewMessageId,
        `review-сообщение ${submission.id}`
      ).catch((deleteError) => {
        console.warn(`Submit outer rollback message cleanup failed for ${submission.id}: ${formatRuntimeError(deleteError)}`);
      });
    } else {
      restoreRecordValue(db.profiles, message.author.id, previousProfile, hadProfile);
      restoreRecordValue(db.cooldowns, message.author.id, previousCooldown, hadCooldown);
    }

    await restoreRolePoolSnapshot(
      client,
      message.author.id,
      accessRoleIds,
      previousAccessRoleIds,
      "submit rollback"
    ).catch((restoreError) => {
      console.error(`Submit access-role rollback failed for ${message.author.id}: ${formatRuntimeError(restoreError)}`);
    });

    const reply = await message.reply(String(error?.message || error || "Не удалось отправить заявку.")).catch(() => null);
    if (reply) scheduleDeleteMessage(reply, 16000);
    await message.delete().catch(() => {});
    return;
  }

  clearSubmitSession(message.author.id);
  const reply = await message.reply(
    isKillsUpdate
      ? "Обновление kills отправлено модераторам. Текущие kills и tier изменятся после проверки."
      : currentAccessGrantMode === ONBOARD_ACCESS_GRANT_MODES.AFTER_SUBMIT && !hasRobloxIdentity
        ? "Заявка отправлена модераторам. Стартовая роль уже выдана, kill-tier прилетит после проверки. Если захочешь добавить Roblox username, нажми «Получить роль» ещё раз, пока заявка pending."
      : currentAccessGrantMode === ONBOARD_ACCESS_GRANT_MODES.AFTER_APPROVE
        ? "Заявка отправлена модераторам. Стартовая роль будет выдана после approve модератора, kill-tier прилетит после проверки."
        : "Заявка отправлена модераторам. Стартовая роль уже выдана, kill-tier прилетит после проверки."
  ).catch(() => null);
  if (reply) scheduleDeleteMessage(reply);

  await logLine(client, `SUBMIT: <@${message.author.id}> kills ${killsResult.kills} mains=${session.mainCharacterIds.join(",")}`).catch((error) => {
    console.warn(`Submit log failed for ${message.author.id}: ${formatRuntimeError(error)}`);
  });

  await message.delete().catch(() => {});
});

client.on("interactionCreate", async (interaction) => {
  const customId = String(interaction.customId || "");
  if (customId.startsWith("at:")) {
    const antiteamMethod = interaction.isButton?.()
      ? "handleButtonInteraction"
      : interaction.isStringSelectMenu?.()
        ? "handleSelectMenuInteraction"
        : interaction.isModalSubmit?.()
          ? "handleModalSubmitInteraction"
          : "";
    if (antiteamMethod && await handleAntiteamInteractionSafely(interaction, antiteamMethod)) {
      return;
    }
  }

  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === ANTITEAM_COMMAND_NAME) {
      if (await handleAntiteamInteractionSafely(interaction, "handleSlashCommand")) {
        return;
      }
    }

    if (interaction.commandName === ROLE_PANEL_COMMAND_NAME) {
      if (await replyIfAutonomyGuardBlockedActor(interaction)) {
        return;
      }

      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      await interaction.reply(buildRolePanelHomePayload());
      return;
    }

    if (interaction.commandName === VERIFY_COMMAND_NAME) {
      if (await replyIfAutonomyGuardBlockedActor(interaction)) {
        return;
      }

      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const subcommand = interaction.options.getSubcommand();
      if (subcommand === "panel") {
        await interaction.reply(await buildVerificationPanelReply());
        return;
      }

      if (subcommand === "add") {
        const target = interaction.options.getUser("target", true);
        const note = cleanVerificationText(interaction.options.getString("note"), 500);

        if (await replyAutonomyGuardIsolatedTarget(interaction, target.id)) {
          return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
          const result = await assignUserToVerification(client, target.id, {
            assignedBy: interaction.user.tag,
            note,
            reason: `verification assigned by ${interaction.user.tag}`,
          });

          await logVerificationRuntimeEvent(
            client,
            `VERIFICATION_ASSIGNED: <@${target.id}> by ${interaction.user.tag}${note ? ` note=${note}` : ""}`
          );

          const lines = [
            `<@${target.id}> поставлен на проверку.`,
            result.roleResult.granted
              ? `Выдана verify-роль ${formatRoleMention(result.roleResult.roleId)}.`
              : `Verify-роль ${formatRoleMention(result.roleResult.roleId)} уже была у участника.`,
            result.reportDueAt
              ? `Отсчёт запущен до ${formatDateTime(result.reportDueAt)}.`
              : "Отсчёт запущен.",
          ];

          if (result.verificationChannelId) {
            lines.push(`Канал проверки: ${formatChannelMention(result.verificationChannelId)}.`);
          }
          if (result.entryMessageEnsured) {
            lines.push("Входное сообщение проверки опубликовано или обновлено автоматически.");
          }
          if (note) {
            lines.push(`Заметка: ${note}`);
          }
          if (result.entryMessageWarning) {
            lines.push(`Предупреждение: ${result.entryMessageWarning}`);
          }

          await interaction.editReply(lines.join("\n"));
        } catch (error) {
          await interaction.editReply(`Не удалось поставить участника на проверку: ${cleanVerificationText(error?.message || error, 300)}`);
        }
        return;
      }
    }

    if (await getProfileOperator().handleProfileSlashCommand({
      interaction,
      checkActorGuard: replyIfAutonomyGuardBlockedActor,
    })) {
      return;
    }

    if (await handleAntiteamInteractionSafely(interaction, "handleSlashCommand")) {
      return;
    }

    if (interaction.commandName === "combo") {
      if (await replyIfAutonomyGuardBlockedActor(interaction)) {
        return;
      }

      const sub = interaction.options.getSubcommand();

      if (sub === "panel") {
        if (!hasComboGuidePanelAccess(interaction.member)) {
          await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
          return;
        }

        await interaction.reply(ephemeralPayload(buildComboPanelForMember(interaction.member)));
        return;
      }

      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      if (sub === "publish") {
        const comboAttachment = interaction.options.getAttachment("combo_file");
        const techsAttachment = interaction.options.getAttachment("techs_file");
        const targetChannel = interaction.options.getChannel("channel");

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
          const [comboBuffer, techsBuffer] = await Promise.all([
            downloadUrl(comboAttachment.url),
            downloadUrl(techsAttachment.url),
          ]);

          const comboText = comboBuffer.toString("utf8");
          const techsText = techsBuffer.toString("utf8");
          const state = await publishGuideOrdered({
            channel: targetChannel,
            comboText,
            techsText,
            assetsDir: CHARACTERS_ASSET_DIR,
            onProgress: async (step, total, desc) => {
              await interaction.editReply({ content: `[${step}/${total}] ${desc}` }).catch(() => {});
            },
          });

          state.editorRoleIds = getComboGuideEditorRoleIds(db.comboGuide);
          if (!db.comboGuide) db.comboGuide = {};
          db.comboGuide = state;
          saveDb();

          await interaction.editReply({
            content: `Гайд опубликован в <#${targetChannel.id}>: ${state.characters.length} персонажей.`,
          });
        } catch (error) {
          console.error("combo publish error:", error);
          await interaction.editReply({ content: `Ошибка: ${error.message}` });
        }
        return;
      }

      if (sub === "add") {
        if (!db.comboGuide || !db.comboGuide.channelId) {
          await interaction.reply(ephemeralPayload({ content: "Сначала опубликуй гайд через `/combo publish`." }));
          return;
        }

        const comboAttachment = interaction.options.getAttachment("combo_file");
        const techsAttachment = interaction.options.getAttachment("techs_file");

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
          const guideChannel = await client.channels.fetch(db.comboGuide.channelId);
          const [comboBuffer, techsBuffer] = await Promise.all([
            downloadUrl(comboAttachment.url),
            downloadUrl(techsAttachment.url),
          ]);

          const state = await addCharacterToGuide({
            channel: guideChannel,
            comboText: comboBuffer.toString("utf8"),
            techsText: techsBuffer.toString("utf8"),
            assetsDir: CHARACTERS_ASSET_DIR,
            guideState: db.comboGuide,
            onProgress: async (step, total, desc) => {
              await interaction.editReply({ content: `[${step}/${total}] ${desc}` }).catch(() => {});
            },
          });

          db.comboGuide = state;
          saveDb();

          await interaction.editReply({ content: `Персонаж добавлен. Всего: ${state.characters.length}.` });
        } catch (error) {
          console.error("combo add error:", error);
          await interaction.editReply({ content: `Ошибка: ${error.message}` });
        }
        return;
      }

      if (sub === "refresh") {
        if (!db.comboGuide || !db.comboGuide.channelId) {
          await interaction.reply(ephemeralPayload({ content: "Гайд ещё не опубликован." }));
          return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
          const guideChannel = await client.channels.fetch(db.comboGuide.channelId);
          await refreshNavigation({ channel: guideChannel, guideState: db.comboGuide });
          saveDb();
          await interaction.editReply({ content: "Навигация обновлена." });
        } catch (error) {
          await interaction.editReply({ content: `Ошибка: ${error.message}` });
        }
        return;
      }

      return;
    }
    if (interaction.commandName !== "onboard") return;

    if (await replyIfAutonomyGuardBlockedActor(interaction)) {
      return;
    }

    const subcommand = interaction.options.getSubcommand();
    const primaryAdminUserId = getAutonomyGuardPrimaryAdminUserId();
    const isIsolatorCommand = subcommand === "isolator" || subcommand === "isolatoroff";

    if (isIsolatorCommand) {
      if (!primaryAdminUserId) {
        await interaction.reply(ephemeralPayload({ content: "PRIMARY_ADMIN_USER_ID не настроен. Добавь его в env и перезапусти бота." }));
        return;
      }
      if (!isAutonomyGuardPrimaryAdmin(interaction.user.id)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }
    } else if (!isModerator(interaction.member)) {
      await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
      return;
    }

    if (subcommand === "panel") {
      try {
        await interaction.reply(await buildModeratorPanelPayload(client));
      } catch (error) {
        console.error("onboard panel failed:", error);
        await interaction.reply(ephemeralPayload({
          content: `Не удалось открыть мод-панель: ${String(error?.message || error || "неизвестная ошибка").slice(0, 220)}`,
        })).catch(() => {});
      }
      return;
    }

    if (subcommand === "sotreport") {
      await replyWithGroundTruthSotReport(interaction, client);
      return;
    }

    if (subcommand === "welcomeedit") {
      await interaction.reply(buildWelcomeEditorPayload());
      return;
    }

    if (subcommand === "movegraphic") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const targetChannel = interaction.options.getChannel("channel", true);
      if (!targetChannel?.isTextBased?.()) {
        await interaction.editReply("Нужен текстовый канал.");
        return;
      }

      const result = await repostGraphicTierlistBoardToChannel(client, targetChannel.id);
      const movedText = result.previousChannelId && result.previousChannelId !== result.channelId
        ? ` Было: <#${result.previousChannelId}>.`
        : "";
      await interaction.editReply(`Графический тир-лист перезалит в <#${result.channelId}> и привязан к этому каналу для следующих обновлений.${movedText}`);
      return;
    }

    if (subcommand === "movetext") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const targetChannel = interaction.options.getChannel("channel", true);
      if (!targetChannel?.isTextBased?.()) {
        await interaction.editReply("Нужен текстовый канал.");
        return;
      }

      const result = await repostTextTierlistBoardToChannel(client, targetChannel.id);
      const movedText = result.previousChannelId && result.previousChannelId !== result.channelId
        ? ` Было: <#${result.previousChannelId}>.`
        : "";
      await interaction.editReply(`Текстовый тир-лист перенесён в <#${result.channelId}>.${movedText}`);
      return;
    }

    if (subcommand === "movenotices") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const targetChannel = interaction.options.getChannel("channel", true);
      if (!targetChannel?.isTextBased?.()) {
        await interaction.editReply("Нужен текстовый канал.");
        return;
      }

      const result = await moveNotificationChannel(client, targetChannel.id);
      const movedText = result.previousChannelId && result.previousChannelId !== result.channelId
        ? ` Было: <#${result.previousChannelId}>.`
        : "";
      await interaction.editReply(`Канал уведомлений бота теперь <#${result.channelId}>.${movedText}`);
      return;
    }

    if (subcommand === "targetrole") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const roleName = String(interaction.options.getString("name", true) || "").trim().slice(0, 100);
      const roleColor = normalizeHexColor(interaction.options.getString("color", true));
      if (!roleName) {
        await interaction.editReply("Название target-роли не должно быть пустым.");
        return;
      }
      if (!roleColor) {
        await interaction.editReply("Цвет должен быть HEX вида #FF5500.");
        return;
      }

      const guild = interaction.guild || await getGuild(client).catch(() => null);
      if (!guild) {
        await interaction.editReply("Не удалось получить guild.");
        return;
      }

      try {
        const roleResult = await ensureAutonomyGuardRole(guild, {
          roleOverride: { name: roleName, color: roleColor },
          reason: `autonomy target role updated by ${interaction.user.tag}`,
        });
        if (roleResult.stateChanged) saveDb();

        const lines = [
          `Target-роль готова: ${formatRoleMention(roleResult.role.id)}.`,
          `Цвет: ${roleColor}. Роль поднята настолько высоко, насколько боту позволяет иерархия.`,
        ];

        const activeTargetUserId = getAutonomyGuardState().targetUserId;
        if (activeTargetUserId) {
          try {
            await assignAutonomyGuardRoleToUser(client, activeTargetUserId, roleResult.role.id, `autonomy target role sync by ${interaction.user.tag}`);
            lines.push(`Активная цель <@${activeTargetUserId}> синхронизирована с target-ролью.`);
          } catch (error) {
            lines.push(`Предупреждение: target-роль сохранена, но текущую цель не удалось синхронизировать: ${String(error?.message || error).slice(0, 220)}`);
          }
        }

        await interaction.editReply(lines.join("\n"));
      } catch (error) {
        await interaction.editReply(`Не удалось подготовить target-роль: ${String(error?.message || error || "неизвестная ошибка").slice(0, 260)}`);
      }
      return;
    }

    if (subcommand === "target") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const target = interaction.options.getUser("target", true);
      if (await replyAutonomyGuardIsolatedTarget(interaction, target.id, { editReply: true })) {
        return;
      }

      const guild = interaction.guild || await getGuild(client).catch(() => null);
      if (!guild) {
        await interaction.editReply("Не удалось получить guild.");
        return;
      }

      try {
        const roleResult = await ensureAutonomyGuardRole(guild, {
          reason: `autonomy target role ensured by ${interaction.user.tag}`,
        });
        if (roleResult.stateChanged) saveDb();

        const previousTargetUserId = getAutonomyGuardState().targetUserId;
        const targetChanged = setAutonomyGuardTargetUserId(db, target.id);

        try {
          await assignAutonomyGuardRoleToUser(client, target.id, roleResult.role.id, `autonomy target set by ${interaction.user.tag}`);
          if (previousTargetUserId && previousTargetUserId !== target.id) {
            await clearAutonomyGuardRoleFromUser(client, previousTargetUserId, roleResult.role.id, `autonomy target moved by ${interaction.user.tag}`);
          }
        } catch (error) {
          if (targetChanged) {
            setAutonomyGuardTargetUserId(db, previousTargetUserId);
          }
          await interaction.editReply(`Не удалось назначить цель: ${String(error?.message || error || "неизвестная ошибка").slice(0, 260)}`);
          return;
        }

        if (targetChanged) saveDb();
        await logLine(client, `AUTONOMY_TARGET_SET: <@${target.id}> by ${interaction.user.tag}`).catch(() => {});
        await interaction.editReply(`Текущая автономная цель: <@${target.id}>. Target-роль ${formatRoleMention(roleResult.role.id)} выдана и защита активна.`);
      } catch (error) {
        await interaction.editReply(`Не удалось подготовить автономную цель: ${String(error?.message || error || "неизвестная ошибка").slice(0, 260)}`);
      }
      return;
    }

    if (subcommand === "targetclear") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const state = getAutonomyGuardState();
      const previousTargetUserId = state.targetUserId;
      if (!previousTargetUserId) {
        await interaction.editReply("Активная автономная цель не задана.");
        return;
      }

      const roleId = state.protectedRole.roleId;
      clearAutonomyGuardTargetUserId(db);
      saveDb();

      const clearedRole = await clearAutonomyGuardRoleFromUser(client, previousTargetUserId, roleId, `autonomy target cleared by ${interaction.user.tag}`);
      await logLine(client, `AUTONOMY_TARGET_CLEARED: <@${previousTargetUserId}> by ${interaction.user.tag}`).catch(() => {});
      await interaction.editReply([
        `Автономная цель снята с <@${previousTargetUserId}>.`,
        clearedRole ? "Target-роль с участника снята." : "Target-роль у участника уже отсутствовала или участник недоступен.",
        "Конфиг target-роли сохранён и может быть переиспользован позже.",
      ].join("\n"));
      return;
    }

    if (subcommand === "isolator") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const target = interaction.options.getUser("target", true);
      if (target.id === primaryAdminUserId) {
        await interaction.editReply("Главного админа нельзя отправить в изолятор.");
        return;
      }
      if (target.id === client.user.id) {
        await interaction.editReply("Бота нельзя отправить в изолятор.");
        return;
      }
      if (target.id === getAutonomyGuardState().targetUserId) {
        await interaction.editReply("Сначала сними текущую автономную цель, потом уже отправляй пользователя в изолятор.");
        return;
      }

      const added = addAutonomyGuardIsolatedUserId(db, target.id);
      if (!added) {
        await interaction.editReply(`<@${target.id}> уже находится в изоляторе.`);
        return;
      }

      saveDb();
      await logLine(client, `AUTONOMY_ISOLATOR_ON: <@${target.id}> by ${interaction.user.tag}`).catch(() => {});
      await interaction.editReply(`<@${target.id}> добавлен в изолятор.`);
      return;
    }

    if (subcommand === "isolatoroff") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const target = interaction.options.getUser("target", true);
      const removed = removeAutonomyGuardIsolatedUserId(db, target.id);
      if (!removed) {
        await interaction.editReply(`<@${target.id}> не находится в изоляторе.`);
        return;
      }

      saveDb();
      await logLine(client, `AUTONOMY_ISOLATOR_OFF: <@${target.id}> by ${interaction.user.tag}`).catch(() => {});
      await interaction.editReply(`<@${target.id}> убран из изолятора.`);
      return;
    }

    if (subcommand === "modset") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const targetUser = interaction.options.getUser("target");
      const userIdInput = (interaction.options.getString("user_id") || "").trim();
      const screenshot = interaction.options.getAttachment("screenshot", true);
      const kills = interaction.options.getInteger("kills", true);

      let target = targetUser;
      if (!target && userIdInput) {
        if (!/^\d{17,20}$/.test(userIdInput)) {
          await interaction.editReply("user_id должен быть числовым Discord ID (17–20 цифр).");
          return;
        }
        target = await client.users.fetch(userIdInput).catch(() => null);
        if (!target) {
          await interaction.editReply(`Не удалось получить пользователя по ID ${userIdInput}.`);
          return;
        }
      }
      if (!target) {
        await interaction.editReply("Укажи `target` (пользователь в сервере) или `user_id` (для тех, кто вышел).");
        return;
      }

      if (await replyAutonomyGuardIsolatedTarget(interaction, target.id, { editReply: true })) {
        return;
      }

      if (!isImageAttachment(screenshot)) {
        await interaction.editReply("Нужен image attachment.");
        return;
      }

      const accessRoleIds = getManagedStartAccessRoleIds();
      const previousProfile = cloneJsonValue(db.profiles?.[target.id]);
      const hadProfile = Boolean(db.profiles?.[target.id]);
      const accessMember = await fetchMember(client, target.id);
      const previousAccessRoleIds = getRolePoolSnapshot(accessMember, accessRoleIds);

      try {
        const profile = getProfile(target.id);
        profile.displayName = getProfileDisplayName(target.id, profile);
        profile.username = target.username;

        await createManualApprovedRecord(client, target, screenshot, kills, interaction.user.tag);
      } catch (error) {
        restoreRecordValue(db.profiles, target.id, previousProfile, hadProfile);
        await restoreRolePoolSnapshot(
          client,
          target.id,
          accessRoleIds,
          previousAccessRoleIds,
          "manual approve rollback"
        ).catch((restoreError) => {
          console.error(`Manual approve access-role rollback failed for ${target.id}: ${formatRuntimeError(restoreError)}`);
        });
        await interaction.editReply(String(error?.message || error || "Не удалось вручную одобрить профиль."));
        return;
      }

      await supersedePendingSubmissionsForUser(client, target.id, interaction.user.tag).catch((error) => {
        console.warn(`Manual approve supersede warning for ${target.id}: ${formatRuntimeError(error)}`);
      });

      await interaction.editReply(`Готово. <@${target.id}> теперь имеет kills ${kills} и tier ${killTierFor(kills)}.`);
      return;
    }

    if (subcommand === "robloxauth") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const targetUser = interaction.options.getUser("target");
      const userIdInput = (interaction.options.getString("user_id") || "").trim();
      const robloxUsernameInput = interaction.options.getString("roblox_username", true);

      let target = targetUser;
      if (!target && userIdInput) {
        if (!/^\d{17,20}$/.test(userIdInput)) {
          await interaction.editReply("user_id должен быть числовым Discord ID (17–20 цифр).");
          return;
        }
        target = await client.users.fetch(userIdInput).catch(() => null);
        if (!target) {
          await interaction.editReply(`Не удалось получить пользователя по ID ${userIdInput}.`);
          return;
        }
      }
      if (!target) {
        await interaction.editReply("Укажи `target` (пользователь в сервере) или `user_id` (для тех, кто вышел из сервера).");
        return;
      }

      if (await replyAutonomyGuardIsolatedTarget(interaction, target.id, { editReply: true })) {
        return;
      }

      let robloxUser = null;
      try {
        robloxUser = await resolveRobloxUserByUsername(robloxUsernameInput);
      } catch (error) {
        await interaction.editReply(String(error?.message || error || "Не удалось проверить Roblox username."));
        return;
      }

      if (!robloxUser) {
        await interaction.editReply("Такой Roblox username не найден через Roblox API.");
        return;
      }

      const previousProfile = cloneJsonValue(db.profiles?.[target.id]);
      const hadProfile = Boolean(db.profiles?.[target.id]);
      const reviewedAt = nowIso();

      try {
        const profile = getProfile(target.id);
        profile.displayName = getProfileDisplayName(target.id, profile);
        profile.username = target.username;
        profile.updatedAt = reviewedAt;
        writeCanonicalRobloxBinding(target.id, profile, robloxUser, {
          verificationStatus: "verified",
          verifiedAt: reviewedAt,
          updatedAt: reviewedAt,
          lastSubmissionId: profile.lastSubmissionId || null,
          lastReviewedAt: reviewedAt,
          reviewedBy: interaction.user.tag,
          source: "manual_moderator",
        });
        saveDb();
      } catch (error) {
        restoreRecordValue(db.profiles, target.id, previousProfile, hadProfile);
        await interaction.editReply(String(error?.message || error || "Не удалось вручную подтвердить Roblox username."));
        return;
      }

      await logLine(client, `ROBLOX_AUTH_MANUAL: <@${target.id}> username=${robloxUser.name} id=${robloxUser.id} by ${interaction.user.tag}`).catch((error) => {
        console.warn(`Manual Roblox auth log failed for ${target.id}: ${formatRuntimeError(error)}`);
      });

      await interaction.editReply(`Roblox-аккаунт для <@${target.id}> подтверждён: ${robloxUser.name} (ID ${robloxUser.id}).`);
      return;
    }

    if (subcommand === "deleteprofile") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const targetUser = interaction.options.getUser("target");
      const userIdInput = (interaction.options.getString("user_id") || "").trim();
      let targetId = targetUser?.id || null;
      if (!targetId && userIdInput) {
        if (!/^\d{17,20}$/.test(userIdInput)) {
          await interaction.editReply("user_id должен быть числовым Discord ID (17–20 цифр).");
          return;
        }
        targetId = userIdInput;
      }
      if (!targetId) {
        await interaction.editReply("Укажи `target` или `user_id`.");
        return;
      }

      if (await replyAutonomyGuardIsolatedTarget(interaction, targetId, { editReply: true })) {
        return;
      }

      const result = await purgeUserProfile(client, targetId, interaction.user.tag);
      const refreshed = await refreshAllTierlists(client);
      const refreshText = buildTierlistRefreshReply(refreshed);
      await interaction.editReply([
        `Профиль <@${targetId}> полностью удалён.`,
        `Удалено заявок: ${result.deletedSubmissions}. Удалено review-сообщений: ${result.removedReviewMessages}. Отсутствовали в Discord: ${result.missingReviewMessages}.`,
        `Очищено: профиль ${result.hadProfile ? "да" : "нет"}, cooldown ${result.hadCooldown ? "да" : "нет"}, main-draft ${result.hadMainDraft ? "да" : "нет"}, submit-session ${result.hadSubmitSession ? "да" : "нет"}, non-JJS session ${result.hadNonGgsSession ? "да" : "нет"}.`,
        `Снятие ролей: tier ${result.rolesCleared.tier ? "да" : "нет"}, access ${result.rolesCleared.access ? "да" : "нет"}, non-JJS ${result.rolesCleared.nonGgs ? "да" : "нет"}, character ${result.rolesCleared.characters ? "да" : "нет"}.`,
        refreshText,
      ].join("\n"));
      return;
    }

    if (subcommand === "nonfake") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const action = String(interaction.options.getString("action", true) || "").trim().toLowerCase();

      if (action === "list") {
        await interaction.editReply(buildTierlistNonFakeListText());
        return;
      }
      if (!["add", "remove"].includes(action)) {
        await interaction.editReply("Поддерживаются только action = add, remove или list.");
        return;
      }

      const targetUser = interaction.options.getUser("target");
      const userIdInput = (interaction.options.getString("user_id") || "").trim();
      const targetId = targetUser?.id || parseRequestedUserId(userIdInput, "");
      if (!targetId) {
        await interaction.editReply("Укажи `target` или корректный `user_id`.");
        return;
      }

      if (await replyAutonomyGuardIsolatedTarget(interaction, targetId, { editReply: true })) {
        return;
      }

      try {
        const mutationResult = await applyTierlistNonFakeClusterMutation(client, targetId, action === "add");
        await interaction.editReply(buildTierlistNonFakeMutationText(
          targetId,
          action === "add",
          mutationResult.result,
          mutationResult.refreshWarnings
        ));
      } catch (error) {
        await interaction.editReply(`Не удалось обновить remembered T6-кластер: ${String(error?.message || error || "неизвестная ошибка").slice(0, 260)}`);
      }
      return;
    }

    if (subcommand === "removetier") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const targetUser = interaction.options.getUser("target");
      const userIdInput = (interaction.options.getString("user_id") || "").trim();
      let targetId = targetUser?.id || null;
      if (!targetId && userIdInput) {
        if (!/^\d{17,20}$/.test(userIdInput)) {
          await interaction.editReply("user_id должен быть числовым Discord ID (17–20 цифр).");
          return;
        }
        targetId = userIdInput;
      }
      if (!targetId) {
        await interaction.editReply("Укажи `target` или `user_id`.");
        return;
      }

      if (await replyAutonomyGuardIsolatedTarget(interaction, targetId, { editReply: true })) {
        return;
      }

      const profile = getProfile(targetId);

      profile.approvedKills = null;
      profile.killTier = null;
      profile.updatedAt = nowIso();
      saveDb();

      await clearTierRoles(client, targetId, "moderator removed kill tier");
      await refreshTierlistBoard(client);
      await interaction.editReply(`Kill-tier роль у <@${targetId}> снята, approved kills очищены.`);
      return;
    }
  }

  if (interaction.isButton()) {
    if (await getProfileOperator().handleProfileButtonInteraction({
      interaction,
      checkActorGuard: replyIfAutonomyGuardBlockedActor,
    })) {
      return;
    }

    if (await handleAntiteamInteractionSafely(interaction, "handleButtonInteraction")) {
      return;
    }

    if (await handleVerificationPanelButtonInteraction({
      interaction,
      isModerator,
      replyNoPermission: async (currentInteraction) => {
        await currentInteraction.reply(ephemeralPayload({ content: "Нет прав." }));
      },
      buildView: async (view, statusText, includeFlags) => buildVerificationPanelReply(view, statusText, includeFlags),
      buildBackPayload: async () => buildModeratorPanelPayload(client, "", false),
      buildModal: async (customId) => {
        const integration = getVerificationIntegrationState();
        if (customId === VERIFY_PANEL_CONFIG_INFRA_ID) {
          return buildVerificationInfraConfigModal({
            integration,
            verifyRoleId: getVerifyAccessRoleId(),
          });
        }
        if (customId === VERIFY_PANEL_CONFIG_RISK_ID) {
          return buildVerificationRiskRulesModal({ integration });
        }
        if (customId === VERIFY_PANEL_RESEND_REPORT_ID) {
          return buildVerificationResendReportModal();
        }
        return buildVerificationStageTextsModal({ integration });
      },
      runAction: async (action) => {
        try {
          if (action === VERIFY_PANEL_PUBLISH_ENTRY_ID) {
            const result = await ensureVerificationEntryMessage(client);
            return `Verification entry message опубликовано в <#${result.channelId}>.`;
          }
          if (action === VERIFY_PANEL_RUN_SWEEP_ID) {
            const result = await runVerificationDeadlineSweep(client);
            return `Verification sweep завершён. Проверено: ${result.scanned}, отправлено report: ${result.reported}.`;
          }
          return "Verification action завершён.";
        } catch (error) {
          return `Verification action failed: ${cleanVerificationText(error?.message || error, 300)}`;
        }
      },
    })) {
      return;
    }

    if (interaction.customId === VERIFY_ENTRY_GUIDE_ID) {
      await interaction.reply(ephemeralPayload(buildVerificationGuidePayload({
        audience: "participant",
        integration: getVerificationIntegrationState(),
      })));
      return;
    }

    if (interaction.customId === VERIFY_ENTRY_STATUS_ID) {
      await interaction.reply(ephemeralPayload({ content: buildVerificationStatusText(interaction.user.id) }));
      return;
    }

    if (interaction.customId === VERIFY_ENTRY_START_ID) {
      if (!isVerificationOauthConfigured()) {
        await interaction.reply(ephemeralPayload({ content: "OAuth env пока не настроен. Сообщи модератору." }));
        return;
      }

      try {
        if (!verificationCallbackServer?.isListening?.()) {
          await startVerificationRuntime(client);
        }

        const startedAt = nowIso();
        ensureVerificationPendingProfile(interaction.user.id, {
          status: "pending",
          decision: "none",
          startedAt,
          reportDueAt: computeVerificationReportDueAt(startedAt),
          lastError: "",
        });
        const state = createVerificationOauthState(interaction.user.id);
        await logVerificationRuntimeEvent(client, `VERIFICATION_BEGIN: <@${interaction.user.id}> state=${formatVerificationStateLogToken(state)}`);
        const authorizeUrl = buildDiscordOAuthAuthorizeUrl({
          integration: getVerificationIntegrationState(),
          env: process.env,
          state,
        });
        await interaction.reply(ephemeralPayload(buildVerificationLaunchPayload({
          authorizeUrl,
          description: [
            "Открой ссылку, авторизуйся тем же Discord-аккаунтом и дождись callback страницы.",
            buildVerificationStatusText(interaction.user.id),
          ].join("\n\n"),
        })));
      } catch (error) {
        await interaction.reply(ephemeralPayload({
          content: `Не удалось запустить verification OAuth: ${cleanVerificationText(error?.message || error, 300)}`,
        }));
      }
      return;
    }

    const verificationReportAction = parseVerificationReportAction(interaction.customId);
    if (verificationReportAction?.userId) {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      await interaction.deferUpdate();
      try {
        if (verificationReportAction.action === "approve_normal") {
          const profile = await approveVerificationUser(client, verificationReportAction.userId, interaction.user.tag, "normal", "verification moderator approve normal");
          await interaction.message.edit(buildVerificationReportPayload({
            userId: verificationReportAction.userId,
            profile,
            statusNote: `Обычный доступ выдан ${interaction.user.tag} в ${formatDateTime(profile.domains?.verification?.reviewedAt)}.`,
            disableActions: true,
          }));
          await interaction.followUp(ephemeralPayload({ content: `Verification для <@${verificationReportAction.userId}> завершена: выдана базовая роль доступа.` }));
        } else if (verificationReportAction.action === "approve_wartime") {
          const profile = await approveVerificationUser(client, verificationReportAction.userId, interaction.user.tag, "wartime", "verification moderator approve wartime");
          await interaction.message.edit(buildVerificationReportPayload({
            userId: verificationReportAction.userId,
            profile,
            statusNote: `Военный доступ выдан ${interaction.user.tag} в ${formatDateTime(profile.domains?.verification?.reviewedAt)}.`,
            disableActions: true,
          }));
          await interaction.followUp(ephemeralPayload({ content: `Verification для <@${verificationReportAction.userId}> завершена: выдана военная роль доступа.` }));
        } else {
          const profile = await banVerificationUser(client, verificationReportAction.userId, interaction.user.tag);
          await interaction.message.edit(buildVerificationReportPayload({
            userId: verificationReportAction.userId,
            profile,
            statusNote: `Участник забанен ${interaction.user.tag} в ${formatDateTime(profile.domains?.verification?.reviewedAt)}.`,
            disableActions: true,
          }));
          await interaction.followUp(ephemeralPayload({ content: `Участник <@${verificationReportAction.userId}> забанен из verification отчёта.` }));
        }
      } catch (error) {
        await interaction.followUp(ephemeralPayload({
          content: `Не удалось завершить verification review: ${cleanVerificationText(error?.message || error, 300)}`,
        }));
      }
      return;
    }

    const grantParsed = parseRoleGrantCustomId(interaction.customId);
    if (grantParsed) {
      const record = getRoleGrantRecord(grantParsed.recordId);
      await grantRoleFromRolePanelMessage(client, interaction, record, grantParsed.buttonIndex);
      return;
    }

    if (interaction.customId.startsWith("rolepanel_")) {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      if (interaction.customId === "rolepanel_home" || interaction.customId === "rolepanel_refresh_home") {
        clearRolePanelPicker(interaction.user.id);
        await interaction.update(buildRolePanelHomePayload("", false));
        return;
      }

      if (interaction.customId === "rolepanel_open_compose") {
        clearRolePanelPicker(interaction.user.id);
        ensureRolePanelDraft(interaction.user.id);
        await interaction.update(buildRolePanelComposerPayload(interaction.user.id, "", false));
        return;
      }

      if (interaction.customId === "rolepanel_open_records") {
        clearRolePanelPicker(interaction.user.id);
        await interaction.update(buildRolePanelRecordsPayload(interaction.user.id, "", false));
        return;
      }

      if (interaction.customId === "rolepanel_open_cleanup") {
        clearRolePanelPicker(interaction.user.id);
        await interaction.update(buildRoleCleanupPayload(interaction.user.id, "", false));
        return;
      }

      if (interaction.customId === "rolepanel_compose_pick_channel") {
        setRolePanelPicker(interaction.user.id, {
          scope: ROLE_PANEL_PICKER_SCOPES.COMPOSE_CHANNEL,
          query: "",
          page: 0,
        });
        await interaction.deferUpdate();
        await interaction.editReply(await buildRolePanelPickerPayload(client, interaction.user.id, "Показываю все доступные каналы.", false));
        return;
      }

      if (interaction.customId === "rolepanel_cleanup_pick_role") {
        setRolePanelPicker(interaction.user.id, {
          scope: ROLE_PANEL_PICKER_SCOPES.CLEANUP_ROLE,
          query: "",
          page: 0,
        });
        await interaction.deferUpdate();
        await interaction.editReply(await buildRolePanelPickerPayload(client, interaction.user.id, "Показываю все роли сервера.", false));
        return;
      }

      if (["rolepanel_picker_prev", "rolepanel_picker_next", "rolepanel_picker_clear", "rolepanel_picker_back", "rolepanel_picker_search", "rolepanel_picker_jump_id"].includes(interaction.customId)) {
        const picker = getRolePanelPicker(interaction.user.id);
        if (!picker) {
          await interaction.update(buildRolePanelHomePayload("Сессия выбора истекла. Открой выбор заново.", false));
          return;
        }

        if (interaction.customId === "rolepanel_picker_prev") {
          setRolePanelPicker(interaction.user.id, { page: Math.max(0, picker.page - 1) });
          await interaction.deferUpdate();
          await interaction.editReply(await buildRolePanelPickerPayload(client, interaction.user.id, "", false));
          return;
        }

        if (interaction.customId === "rolepanel_picker_next") {
          setRolePanelPicker(interaction.user.id, { page: picker.page + 1 });
          await interaction.deferUpdate();
          await interaction.editReply(await buildRolePanelPickerPayload(client, interaction.user.id, "", false));
          return;
        }

        if (interaction.customId === "rolepanel_picker_clear") {
          setRolePanelPicker(interaction.user.id, { query: "", page: 0 });
          await interaction.deferUpdate();
          await interaction.editReply(await buildRolePanelPickerPayload(client, interaction.user.id, "Поиск сброшен.", false));
          return;
        }

        if (interaction.customId === "rolepanel_picker_back") {
          clearRolePanelPicker(interaction.user.id);
          await interaction.update(buildRolePanelPickerReturnPayload(interaction.user.id, picker.scope, "", false));
          return;
        }

        if (interaction.customId === "rolepanel_picker_search") {
          const meta = getRolePanelPickerMeta(picker.scope);
          const modal = new ModalBuilder().setCustomId("rolepanel_picker_search_modal").setTitle(meta.searchTitle);
          const input = new TextInputBuilder()
            .setCustomId("query")
            .setLabel(meta.searchLabel)
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(80)
            .setPlaceholder(meta.searchPlaceholder);

          if (picker.query) input.setValue(picker.query);

          modal.addComponents(new ActionRowBuilder().addComponents(input));
          await interaction.showModal(modal);
          return;
        }

        const meta = getRolePanelPickerMeta(picker.scope);
        const modal = new ModalBuilder().setCustomId("rolepanel_picker_id_modal").setTitle(meta.idTitle);
        const input = new TextInputBuilder()
          .setCustomId("entity_id")
          .setLabel(meta.idLabel)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(40)
          .setPlaceholder("123456789012345678");

        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === "rolepanel_compose_format_plain") {
        setRolePanelDraft(interaction.user.id, { format: ROLE_PANEL_FORMATS.PLAIN });
        await interaction.update(buildRolePanelComposerPayload(interaction.user.id, "Формат переключён на обычный текст.", false));
        return;
      }

      if (interaction.customId === "rolepanel_compose_format_embed") {
        setRolePanelDraft(interaction.user.id, { format: ROLE_PANEL_FORMATS.EMBED });
        await interaction.update(buildRolePanelComposerPayload(interaction.user.id, "Формат переключён на embed.", false));
        return;
      }

      if (interaction.customId === "rolepanel_compose_edit_message") {
        const draft = ensureRolePanelDraft(interaction.user.id);

        if (draft.format === ROLE_PANEL_FORMATS.EMBED) {
          const modal = new ModalBuilder().setCustomId("rolepanel_compose_embed_modal").setTitle("Настройка embed");
          const titleInput = new TextInputBuilder()
            .setCustomId("embed_title")
            .setLabel("Заголовок embed")
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(256);
          const descriptionInput = new TextInputBuilder()
            .setCustomId("embed_description")
            .setLabel("Текст embed")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(4000);

          if (draft.embedTitle) titleInput.setValue(draft.embedTitle);
          if (draft.embedDescription) descriptionInput.setValue(draft.embedDescription);

          modal.addComponents(
            new ActionRowBuilder().addComponents(titleInput),
            new ActionRowBuilder().addComponents(descriptionInput)
          );
          await interaction.showModal(modal);
          return;
        }

        const modal = new ModalBuilder().setCustomId("rolepanel_compose_plain_modal").setTitle("Текст сообщения");
        const input = new TextInputBuilder()
          .setCustomId("content")
          .setLabel("Что будет написано в сообщении")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(4000);

        if (draft.content) input.setValue(draft.content);

        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === "rolepanel_compose_add_button") {
        const draft = ensureRolePanelDraft(interaction.user.id);
        const buttons = Array.isArray(draft.buttons) ? draft.buttons : [];
        if (buttons.length >= ROLE_PANEL_MAX_BUTTONS) {
          await interaction.update(buildRolePanelComposerPayload(interaction.user.id, `Максимум ${ROLE_PANEL_MAX_BUTTONS} кнопок.`, false));
          return;
        }
        setRolePanelDraft(interaction.user.id, { editingButtonIndex: -1 });
        setRolePanelPicker(interaction.user.id, { scope: ROLE_PANEL_PICKER_SCOPES.COMPOSE_BUTTON_ROLE, query: "", page: 0 });
        await interaction.deferUpdate();
        await interaction.editReply(await buildRolePanelPickerPayload(client, interaction.user.id, "Выбери роль для новой кнопки.", false));
        return;
      }

      if (interaction.customId === "rolepanel_compose_edit_button_select") {
        const draft = ensureRolePanelDraft(interaction.user.id);
        const buttons = Array.isArray(draft.buttons) ? draft.buttons : [];
        if (buttons.length === 0) {
          await interaction.update(buildRolePanelComposerPayload(interaction.user.id, "Нет кнопок для редактирования.", false));
          return;
        }

        const options = buttons.slice(0, 25).map((b, i) => ({
          label: previewText(`${i + 1}. ${b.label || DEFAULT_ROLE_PANEL_BUTTON_LABEL}`, 100),
          description: previewText(formatRoleMention(b.roleId), 100),
          value: String(i),
        }));

        const payload = {
          embeds: [new EmbedBuilder().setTitle("Role Panel • Выбери кнопку для редактирования").setDescription("Выбери кнопку, у которой хочешь изменить подпись или роль.")],
          components: [
            new ActionRowBuilder().addComponents(
              new StringSelectMenuBuilder().setCustomId("rolepanel_compose_button_select_edit").setPlaceholder("Выбери кнопку").addOptions(options)
            ),
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId("rolepanel_compose_back_from_button_select").setLabel("Отмена").setStyle(ButtonStyle.Secondary)
            ),
          ],
        };
        await interaction.update(payload);
        return;
      }

      if (interaction.customId === "rolepanel_compose_remove_button_select") {
        const draft = ensureRolePanelDraft(interaction.user.id);
        const buttons = Array.isArray(draft.buttons) ? draft.buttons : [];
        if (buttons.length === 0) {
          await interaction.update(buildRolePanelComposerPayload(interaction.user.id, "Нет кнопок для удаления.", false));
          return;
        }

        const options = buttons.slice(0, 25).map((b, i) => ({
          label: previewText(`${i + 1}. ${b.label || DEFAULT_ROLE_PANEL_BUTTON_LABEL}`, 100),
          description: previewText(formatRoleMention(b.roleId), 100),
          value: String(i),
        }));

        const payload = {
          embeds: [new EmbedBuilder().setTitle("Role Panel • Удалить кнопку").setDescription("Выбери кнопку для удаления.")],
          components: [
            new ActionRowBuilder().addComponents(
              new StringSelectMenuBuilder().setCustomId("rolepanel_compose_button_select_remove").setPlaceholder("Выбери кнопку для удаления").addOptions(options)
            ),
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId("rolepanel_compose_back_from_button_select").setLabel("Отмена").setStyle(ButtonStyle.Secondary)
            ),
          ],
        };
        await interaction.update(payload);
        return;
      }

      if (interaction.customId === "rolepanel_compose_back_from_button_select") {
        await interaction.update(buildRolePanelComposerPayload(interaction.user.id, "", false));
        return;
      }

      if (interaction.customId === "rolepanel_compose_edit_button_label") {
        const draft = ensureRolePanelDraft(interaction.user.id);
        const idx = Number.isInteger(draft.editingButtonIndex) && draft.editingButtonIndex >= 0 ? draft.editingButtonIndex : -1;
        const buttons = Array.isArray(draft.buttons) ? draft.buttons : [];
        const btn = idx >= 0 ? buttons[idx] : null;

        const modal = new ModalBuilder().setCustomId("rolepanel_compose_button_label_modal").setTitle(`Подпись кнопки ${btn ? idx + 1 : ""}`);
        const input = new TextInputBuilder()
          .setCustomId("button_label")
          .setLabel("Что написано на кнопке")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(80);

        if (btn?.label) input.setValue(btn.label);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === "rolepanel_compose_edit_button_role") {
        const draft = ensureRolePanelDraft(interaction.user.id);
        setRolePanelPicker(interaction.user.id, { scope: ROLE_PANEL_PICKER_SCOPES.COMPOSE_BUTTON_ROLE, query: "", page: 0 });
        await interaction.deferUpdate();
        await interaction.editReply(await buildRolePanelPickerPayload(client, interaction.user.id, `Выбери новую роль для кнопки ${(draft.editingButtonIndex >= 0 ? draft.editingButtonIndex + 1 : "")}.`, false));
        return;
      }

      if (interaction.customId === "rolepanel_compose_edit_button") {
        // Legacy: kept for backward compat in case any lingering interactions reference it
        await interaction.update(buildRolePanelComposerPayload(interaction.user.id, "", false));
        return;
      }

      if (interaction.customId === "rolepanel_compose_reset") {
        clearRolePanelDraft(interaction.user.id);
        await interaction.update(buildRolePanelComposerPayload(interaction.user.id, "Черновик сброшен.", false));
        return;
      }

      if (interaction.customId === "rolepanel_compose_publish") {
        await interaction.deferUpdate();

        try {
          const record = await publishRoleGrantMessage(client, interaction.user, ensureRolePanelDraft(interaction.user.id));
          setRoleRecordSelection(interaction.user.id, record.id);
          await interaction.editReply(buildRolePanelComposerPayload(
            interaction.user.id,
            `Сообщение опубликовано в ${formatChannelMention(record.channelId)}. ID сообщения: ${record.messageId}.`,
            false
          ));
        } catch (error) {
          await interaction.editReply(buildRolePanelComposerPayload(interaction.user.id, String(error?.message || error || "неизвестная ошибка"), false));
        }
        return;
      }

      if (interaction.customId === "rolepanel_cleanup_confirm_screen") {
        await interaction.update(buildRoleCleanupConfirmPayload(interaction.user.id, "", false));
        return;
      }

      if (interaction.customId === "rolepanel_records_disable") {
        const record = getSelectedRoleGrantRecord(interaction.user.id);
        if (!record) {
          await interaction.update(buildRolePanelRecordsPayload(interaction.user.id, "Сначала выбери сообщение.", false));
          return;
        }

        await interaction.deferUpdate();
        const changed = await disableRoleGrantRecord(client, record, `manually disabled by ${interaction.user.tag}`);
        if (changed) saveDb();
        await interaction.editReply(buildRolePanelRecordsPayload(
          interaction.user.id,
          changed ? `Сообщение ${record.messageId} отключено.` : "Это сообщение уже было отключено.",
          false
        ));
        return;
      }

      if (interaction.customId === "rolepanel_records_republish") {
        const record = getSelectedRoleGrantRecord(interaction.user.id);
        if (!record) {
          await interaction.update(buildRolePanelRecordsPayload(interaction.user.id, "Сначала выбери сообщение.", false));
          return;
        }

        await interaction.deferUpdate();

        try {
          const nextRecord = await republishRoleGrantRecord(client, interaction.user, record);
          setRoleRecordSelection(interaction.user.id, nextRecord.id);
          await interaction.editReply(buildRolePanelRecordsPayload(
            interaction.user.id,
            `Сообщение заново опубликовано в ${formatChannelMention(nextRecord.channelId)}. Новый message ID: ${nextRecord.messageId}.`,
            false
          ));
        } catch (error) {
          await interaction.editReply(buildRolePanelRecordsPayload(interaction.user.id, String(error?.message || error || "неизвестная ошибка"), false));
        }
        return;
      }

      if (interaction.customId === "rolepanel_records_load_draft") {
        const record = getSelectedRoleGrantRecord(interaction.user.id);
        if (!record) {
          await interaction.update(buildRolePanelRecordsPayload(interaction.user.id, "Сначала выбери сообщение.", false));
          return;
        }

        setRolePanelDraft(interaction.user.id, createRoleMessageDraftFromRecord(record));
        await interaction.update(buildRolePanelComposerPayload(interaction.user.id, "Черновик загружен из опубликованного сообщения.", false));
        return;
      }

      if (interaction.customId === "rolepanel_records_delete") {
        const record = getSelectedRoleGrantRecord(interaction.user.id);
        if (!record) {
          await interaction.update(buildRolePanelRecordsPayload(interaction.user.id, "Сначала выбери сообщение.", false));
          return;
        }

        await interaction.deferUpdate();
        const msgId = record.messageId;
        const recordId = record.id;
        const deleted = await deleteRoleGrantMessage(client, record, `deleted by ${interaction.user.tag}`);
        if (deleted) {
          saveDb();
          // Clear selection so UI doesn't try to display the now-deleted record
          clearRoleRecordSelection(interaction.user.id);
        }
        await logLine(client, `ROLE_PANEL_DELETE: record=${recordId} channel=${record.channelId} message=${msgId} by ${interaction.user.tag}`);
        await interaction.editReply(buildRolePanelRecordsPayload(
          interaction.user.id,
          deleted ? `Сообщение ${msgId} удалено из канала и базы.` : "Не удалось удалить сообщение.",
          false
        ));
        return;
      }

      if (interaction.customId === "rolepanel_records_purge") {
        const purgedCount = purgeDisabledRoleGrantRecords();
        await interaction.update(buildRolePanelRecordsPayload(
          interaction.user.id,
          purgedCount ? `Удалено ${purgedCount} отключённых записей из базы.` : "Нет отключённых записей для очистки.",
          false
        ));
        return;
      }

      if (interaction.customId.startsWith("rolepanel_cleanup_run:")) {
        const behavior = interaction.customId.split(":")[1];
        const selection = getRoleCleanupSelection(interaction.user.id);

        if (!selection?.roleId) {
          await interaction.update(buildRoleCleanupPayload(interaction.user.id, "Сначала выбери роль для снятия.", false));
          return;
        }

        await interaction.deferUpdate();

        try {
          const result = await removeRoleFromAllMembers(client, selection.roleId, behavior, interaction.user.tag);
          const cleanupText = result.missingRole
            ? `Роль уже удалена. Связанных сообщений отключено: ${result.disabledCount}.`
            : `Снятие завершено. Всего holders: ${result.matchedMembers}, снято: ${result.removed}, ошибок: ${result.failed}, отключено сообщений: ${result.disabledCount}.`;
          await interaction.editReply(buildRoleCleanupPayload(interaction.user.id, cleanupText, false));
        } catch (error) {
          await interaction.editReply(buildRoleCleanupConfirmPayload(interaction.user.id, String(error?.message || error || "неизвестная ошибка"), false));
        }
        return;
      }
    }

    // === PNG Dashboard buttons ===
    if (interaction.customId === "elo_graphic_refresh") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      await interaction.deferUpdate();
      const liveState = getLiveLegacyEloState();
      if (!liveState.ok) {
        await interaction.followUp(buildLegacyEloStateErrorPayload("Не удалось обновить legacy ELO PNG", liveState));
        return;
      }

      try {
        const result = await refreshLegacyEloGraphicBoard(client, { liveState });
        if (!result.ok) {
          await interaction.followUp(ephemeralPayload({ content: "Legacy ELO PNG канал пока не настроен. Открой PNG Panel и задай канал." }));
        }
      } catch (error) {
        await interaction.followUp(ephemeralPayload({ content: String(error?.message || error || "Не удалось обновить legacy ELO PNG.") }));
      }
      return;
    }

    if (interaction.customId === "elo_graphic_panel") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const liveState = getLiveLegacyEloState();
      if (!liveState.ok) {
        await interaction.reply(buildLegacyEloStateErrorPayload("Не удалось открыть legacy ELO PNG panel", liveState));
        return;
      }

      await interaction.reply(buildLegacyEloGraphicPanelPayload(liveState.rawDb));
      return;
    }

    if (interaction.customId === "graphic_refresh") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }
      await interaction.deferUpdate();
      await refreshGraphicTierlistBoard(client);
      return;
    }

    if (interaction.customId === "graphic_panel") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }
      console.log("[graphic-panel] open marker=gp-2026-05-15-b tiers=5,4,3,2,1,6 user=" + (interaction.user?.id || "unknown"));
      await interaction.reply(buildGraphicPanelPayload());
      return;
    }

    if (interaction.customId.startsWith("elo_graphic_panel_")) {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      if (interaction.customId === "elo_graphic_panel_back") {
        await interaction.update(buildDormantEloPanelPayload("", false));
        return;
      }

      const liveState = getLiveLegacyEloState();
      if (!liveState.ok) {
        await interaction.reply(buildLegacyEloStateErrorPayload("Не удалось открыть legacy ELO PNG panel", liveState));
        return;
      }

      const snapshot = buildLegacyEloGraphicPanelSnapshot(liveState.rawDb);
      const selectedTier = snapshot.selectedTier;

      if (interaction.customId === "elo_graphic_panel_fonts") {
        const { ensureGraphicFonts } = require("./graphic-tierlist");
        const ok = ensureGraphicFonts();
        await interaction.update(buildLegacyEloGraphicPanelPayload(
          liveState.rawDb,
          ok ? "Шрифты PNG загружены." : "Шрифты не найдены. Положи TTF в assets/fonts/.",
          false
        ));
        return;
      }

      if (interaction.customId === "elo_graphic_panel_title") {
        const modal = new ModalBuilder().setCustomId("elo_graphic_panel_title_modal").setTitle("Название ELO PNG тир-листа");
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("graphic_title").setLabel("Название наверху картинки").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80).setValue(snapshot.title)
        ));
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === "elo_graphic_panel_message_text") {
        const modal = new ModalBuilder().setCustomId("elo_graphic_panel_message_text_modal").setTitle("Текст сообщения ELO PNG");
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("graphic_message_text").setLabel("Текст под заголовком").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(4000).setValue(getLegacyEloGraphicMessageText(liveState.rawDb))
        ));
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === "elo_graphic_panel_setup") {
        const modal = new ModalBuilder().setCustomId("elo_graphic_panel_setup_modal").setTitle("Канал ELO PNG board");
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("elo_graphic_channel").setLabel("ID или mention текстового канала").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80).setPlaceholder("123456789012345678 или <#123456789012345678>").setValue(String(snapshot.dashboardChannelId || "").slice(0, 80))
        ));
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === "elo_graphic_panel_labels") {
        const modal = new ModalBuilder().setCustomId("elo_graphic_panel_labels_modal").setTitle("Названия ELO tiers");
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("tier_label_1").setLabel("Tier 1").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(60).setValue(snapshot.tierLabels[1] || "1")),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("tier_label_2").setLabel("Tier 2").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(60).setValue(snapshot.tierLabels[2] || "2")),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("tier_label_3").setLabel("Tier 3").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(60).setValue(snapshot.tierLabels[3] || "3")),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("tier_label_4").setLabel("Tier 4").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(60).setValue(snapshot.tierLabels[4] || "4")),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("tier_label_5").setLabel("Tier 5").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(60).setValue(snapshot.tierLabels[5] || "5"))
        );
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === "elo_graphic_panel_rename") {
        const modal = new ModalBuilder().setCustomId(`elo_graphic_panel_rename_modal:${selectedTier}`).setTitle(`Переименовать ELO tier ${selectedTier}`);
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("tier_name").setLabel("Новое название тира").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(60).setValue(snapshot.tierLabels[selectedTier] || String(selectedTier))
        ));
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === "elo_graphic_panel_set_color") {
        const modal = new ModalBuilder().setCustomId(`elo_graphic_panel_color_modal:${selectedTier}`).setTitle(`Цвет ELO tier ${selectedTier}`);
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("tier_color").setLabel("HEX цвет, пример #ff6b6b").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(7).setValue(snapshot.tierColors[selectedTier] || "")
        ));
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === "elo_graphic_panel_refresh") {
        await interaction.deferUpdate();
        try {
          const result = await refreshLegacyEloGraphicBoard(client, { liveState });
          const status = result.ok
            ? `Legacy ELO PNG пересобран в ${formatChannelMention(result.channelId)}.${getLegacyEloSyncStatusSuffix(result.syncResult)}`
            : "Legacy ELO PNG канал пока не настроен. Сначала укажи канал.";
          await interaction.editReply(buildLegacyEloGraphicPanelPayload(liveState.rawDb, status, false));
        } catch (error) {
          await interaction.editReply(buildLegacyEloGraphicPanelPayload(liveState.rawDb, String(error?.message || error || "Не удалось пересобрать legacy ELO PNG."), false));
        }
        return;
      }

      if (interaction.customId === "elo_graphic_panel_bump") {
        await interaction.deferUpdate();
        try {
          const result = await bumpLegacyEloGraphicBoard(client, { liveState });
          const status = result.ok
            ? `Legacy ELO PNG отправлен заново вниз канала ${formatChannelMention(result.channelId)}.${getLegacyEloSyncStatusSuffix(result.syncResult)}`
            : "Legacy ELO PNG канал пока не настроен. Сначала укажи канал.";
          await interaction.editReply(buildLegacyEloGraphicPanelPayload(liveState.rawDb, status, false));
        } catch (error) {
          await interaction.editReply(buildLegacyEloGraphicPanelPayload(liveState.rawDb, String(error?.message || error || "Не удалось перезалить legacy ELO PNG."), false));
        }
        return;
      }

      if (interaction.customId === "elo_graphic_panel_icon_minus" || interaction.customId === "elo_graphic_panel_icon_plus") {
        const delta = interaction.customId.endsWith("plus") ? 12 : -12;
        applyLegacyEloGraphicImageDelta(liveState.rawDb, "icon", delta);
      } else if (interaction.customId === "elo_graphic_panel_w_minus" || interaction.customId === "elo_graphic_panel_w_plus") {
        const delta = interaction.customId.endsWith("plus") ? 200 : -200;
        applyLegacyEloGraphicImageDelta(liveState.rawDb, "width", delta);
      } else if (interaction.customId === "elo_graphic_panel_h_minus" || interaction.customId === "elo_graphic_panel_h_plus") {
        const delta = interaction.customId.endsWith("plus") ? 120 : -120;
        applyLegacyEloGraphicImageDelta(liveState.rawDb, "height", delta);
      } else if (interaction.customId === "elo_graphic_panel_reset_img") {
        resetLegacyEloGraphicImageOverrides(liveState.rawDb);
      } else if (interaction.customId === "elo_graphic_panel_reset_color") {
        resetLegacyEloGraphicTierColor(liveState.rawDb, selectedTier);
      } else if (interaction.customId === "elo_graphic_panel_reset_colors") {
        resetAllLegacyEloGraphicTierColors(liveState.rawDb);
      } else if (interaction.customId === "elo_graphic_panel_clear_cache") {
        clearGraphicAvatarCache();
      } else {
        return;
      }

      await interaction.deferUpdate();
      try {
        const persisted = await persistLegacyEloGraphicMutation(client, liveState, { refreshBoard: true });
        const status = [
          interaction.customId === "elo_graphic_panel_clear_cache"
            ? "Кэш аватарок очищен."
            : "Настройки legacy ELO PNG обновлены.",
          persisted.boardUpdated ? "PNG board пересобран." : "PNG board пока не настроен.",
        ].join(" ") + getLegacyEloSyncStatusSuffix(persisted.syncResult);
        await interaction.editReply(buildLegacyEloGraphicPanelPayload(liveState.rawDb, status, false));
      } catch (error) {
        await interaction.editReply(buildLegacyEloGraphicPanelPayload(liveState.rawDb, String(error?.message || error || "Не удалось обновить legacy ELO PNG настройки."), false));
      }
      return;
    }

    // === PNG Panel buttons (all require moderator) ===
    if (interaction.customId.startsWith("graphic_panel_")) {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }
      const graphicPresentation = getGraphicTierlistConfig();
      const selectedTier = Number(graphicPresentation.panel?.selectedTier) || 5;

      if (interaction.customId === "graphic_panel_close") {
        await interaction.update({ content: "PNG Panel закрыта.", embeds: [], components: [] });
        return;
      }

      if (interaction.customId === "graphic_panel_fonts") {
        const { ensureGraphicFonts } = require("./graphic-tierlist");
        const ok = ensureGraphicFonts();
        await interaction.reply(ephemeralPayload({ content: ok ? "Шрифты загружены." : "Шрифты не найдены. Положи TTF в assets/fonts/." }));
        return;
      }

      if (interaction.customId === "graphic_panel_title") {
        const modal = new ModalBuilder().setCustomId("graphic_panel_title_modal").setTitle("Название PNG тир-листа");
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("graphic_title").setLabel("Название наверху картинки").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80).setValue(getEffectiveGraphicTitle())
        ));
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === "graphic_panel_message_text") {
        const modal = new ModalBuilder().setCustomId("graphic_panel_message_text_modal").setTitle("Текст сообщения PNG тир-листа");
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("graphic_message_text").setLabel("Текст под заголовком").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(4000).setValue(getEffectiveMessageText())
        ));
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === "graphic_panel_rename") {
        const modal = new ModalBuilder().setCustomId(`graphic_panel_rename_modal:${selectedTier}`).setTitle(`Переименовать тир ${selectedTier}`);
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("tier_name").setLabel("Новое название тира").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(60).setValue(formatTierLabel(selectedTier))
        ));
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === "graphic_panel_set_color") {
        const tierColors = getEffectiveTierColors();
        const modal = new ModalBuilder().setCustomId(`graphic_panel_color_modal:${selectedTier}`).setTitle(`Цвет тира ${selectedTier}`);
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("tier_color").setLabel("HEX цвет, пример #ff6b6b").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(7).setValue(tierColors[selectedTier] || "")
        ));
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === "graphic_panel_outline") {
        const outline = getEffectiveGraphicOutlineConfig();
        const outlineRulesText = outline.rules.length
          ? outline.rules.map((rule) => `${formatRoleMention(rule.roleId)} ${rule.color}`).join("\n")
          : outline.roleIds.map((roleId) => `${formatRoleMention(roleId)} ${outline.color}`).join("\n");
        const modal = new ModalBuilder().setCustomId("graphic_panel_outline_modal").setTitle("Обводка PNG по ролям и цветам");
        const outlineRulesInput = new TextInputBuilder()
          .setCustomId("outline_rules")
          .setLabel("Строка: role ID/mention + optional #HEX")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000)
          .setPlaceholder("<@&123456789012345678> #ff0000\n<@&987654321098765432> <@&111111111111111111> #00ff88");

        if (outlineRulesText.length >= 3) {
          outlineRulesInput.setValue(outlineRulesText.slice(0, 1000));
        }

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            outlineRulesInput
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("outline_color")
              .setLabel("Цвет по умолчанию для строк без HEX")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setMaxLength(7)
              .setValue(outline.color)
          )
        );
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === "graphic_panel_nonfake") {
        const modal = new ModalBuilder().setCustomId("graphic_panel_nonfake_modal").setTitle("Remembered T6-кластер");
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("nonfake_action")
              .setLabel("Действие: list | add | remove")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setMaxLength(12)
              .setValue("list")
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("nonfake_target")
              .setLabel("User mention или ID")
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
              .setMaxLength(80)
              .setPlaceholder("@user или 123456789012345678")
          )
        );
        await interaction.showModal(modal);
        return;
      }

      // Size adjustment buttons
      if (interaction.customId === "graphic_panel_icon_minus" || interaction.customId === "graphic_panel_icon_plus") {
        const delta = interaction.customId.endsWith("plus") ? 12 : -12;
        await applyUiMutation(client, "graphic", () => {
          const image = getGraphicTierlistConfig().image;
          image.icon = Math.max(64, Math.min(256, (image.icon || 112) + delta));
        });
        await interaction.update(buildGraphicPanelPayload());
        return;
      }

      if (interaction.customId === "graphic_panel_w_minus" || interaction.customId === "graphic_panel_w_plus") {
        const delta = interaction.customId.endsWith("plus") ? 200 : -200;
        await applyUiMutation(client, "graphic", () => {
          const image = getGraphicTierlistConfig().image;
          image.width = Math.max(1200, Math.min(4096, (image.width || 2000) + delta));
        });
        await interaction.update(buildGraphicPanelPayload());
        return;
      }

      if (interaction.customId === "graphic_panel_h_minus" || interaction.customId === "graphic_panel_h_plus") {
        const delta = interaction.customId.endsWith("plus") ? 120 : -120;
        await applyUiMutation(client, "graphic", () => {
          const image = getGraphicTierlistConfig().image;
          image.height = Math.max(700, Math.min(2160, (image.height || 1200) + delta));
        });
        await interaction.update(buildGraphicPanelPayload());
        return;
      }

      if (interaction.customId === "graphic_panel_reset_img") {
        await applyUiMutation(client, "graphic", () => {
          getGraphicTierlistConfig().image = { width: null, height: null, icon: null };
        });
        await interaction.update(buildGraphicPanelPayload());
        return;
      }

      if (interaction.customId === "graphic_panel_reset_color") {
        await applyUiMutation(client, "graphic", () => {
          const colors = getGraphicTierlistConfig().colors;
          if (colors) delete colors[selectedTier];
        });
        await interaction.update(buildGraphicPanelPayload());
        return;
      }

      if (interaction.customId === "graphic_panel_reset_colors") {
        await applyUiMutation(client, "graphic", () => {
          getGraphicTierlistConfig().colors = {};
        });
        await interaction.update(buildGraphicPanelPayload());
        return;
      }

      if (interaction.customId === "graphic_panel_outline_clear") {
        await applyUiMutation(client, "graphic", () => {
          getGraphicTierlistConfig().outline = { roleId: "", roleIds: [], color: "#ffffff", rules: [] };
        });
        await interaction.update(buildGraphicPanelPayload("Обводка PNG по ролям очищена.", false));
        return;
      }

      if (interaction.customId === "graphic_panel_clear_cache") {
        clearGraphicAvatarCache();
        await refreshGraphicTierlistBoard(client);
        await interaction.reply(ephemeralPayload({ content: "Кэш аватарок очищен и PNG пересобран." }));
        return;
      }

      if (interaction.customId === "graphic_panel_resend" || interaction.customId === "panel_resend_graphic") {
        await interaction.deferUpdate();
        let statusText;
        try {
          await refreshGraphicTierlistBoard(client, { forceRecreate: true });
          statusText = "PNG tier-лист отправлен заново.";
        } catch (error) {
          statusText = `Не удалось отправить PNG tier-лист: ${String(error?.message || error)}`;
        }
        await interaction.editReply(buildGraphicPanelPayload(statusText, false));
        return;
      }

      if (interaction.customId === "panel_resend_text") {
        await interaction.deferUpdate();
        let statusText;
        try {
          await refreshTextTierlistBoard(client, { forceRecreate: true, page: 0 });
          statusText = "Текстовый tier-лист отправлен заново.";
        } catch (error) {
          statusText = `Не удалось отправить текстовый tier-лист: ${String(error?.message || error)}`;
        }
        await interaction.editReply(buildGraphicPanelPayload(statusText, false));
        return;
      }

      if (interaction.customId === "graphic_panel_refresh") {
        await interaction.deferUpdate();
        await refreshGraphicTierlistBoard(client);
        await interaction.editReply(buildGraphicPanelPayload("PNG tier-лист пересобран.", false));
        return;
      }
    }

    if (interaction.customId === "panel_resend_graphic") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }
      await interaction.deferUpdate();
      let statusText;
      try {
        await refreshGraphicTierlistBoard(client, { forceRecreate: true });
        statusText = "PNG tier-лист отправлен заново.";
      } catch (error) {
        statusText = `Не удалось отправить PNG tier-лист: ${String(error?.message || error)}`;
      }
      await interaction.editReply(await buildModeratorPanelPayload(client, statusText, false));
      return;
    }

    if (interaction.customId === "panel_resend_text") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }
      await interaction.deferUpdate();
      let statusText;
      try {
        await refreshTextTierlistBoard(client, { forceRecreate: true, page: 0 });
        statusText = "Текстовый tier-лист отправлен заново.";
      } catch (error) {
        statusText = `Не удалось отправить текстовый tier-лист: ${String(error?.message || error)}`;
      }
      await interaction.editReply(await buildModeratorPanelPayload(client, statusText, false));
      return;
    }

    if (await handleSotReportButtonInteraction({
      interaction,
      client,
      isModerator,
      replyNoPermission: () => interaction.reply(ephemeralPayload({ content: "Нет прав." })),
      replyWithGroundTruthSotReport,
      ensureManagedRoles,
      maybeLogSotCharacterHealthAlert,
      cleanupOrphanCharacterRoles,
      buildGroundTruthSotReportPayload,
    })) {
      return;
    }

    if (await handleSotReportModalOpenInteraction({
      interaction,
      isModerator,
      replyNoPermission: () => interaction.reply(ephemeralPayload({ content: "Нет прав." })),
    })) {
      return;
    }

    if (await handleActivityPanelButtonInteraction({
      interaction,
      client,
      db,
      isModerator: hasActivityPanelAccess,
      replyNoPermission: () => interaction.reply(ephemeralPayload({ content: "Нет прав." })),
      buildModeratorPanelPayload,
      buildActivityPanelPayload: ({ statusText = "", view = "overview" } = {}) => buildActivityOperatorPanelPayload({
        db,
        statusText,
        view,
        startupHealth: {
          label: lastClientReadyCoreDegraded.length ? "DEGRADED" : "OK",
          completedAt: lastClientReadyCoreCompletedAt,
          degraded: lastClientReadyCoreDegraded,
        },
      }),
      fetchChannel: async (channelId) => {
        const guild = interaction.guild || await getGuild(client).catch(() => null);
        const cachedChannel = guild?.channels?.cache?.get(channelId) || client.channels?.cache?.get?.(channelId) || null;
        if (cachedChannel) return cachedChannel;
        return client.channels.fetch(channelId).catch(() => null);
      },
      resolveMemberRoleIds: (userId) => resolveActivityMemberRoleIds(client, userId, interaction.guild || null),
      resolveMemberActivityMeta: (userId) => resolveActivityMemberMeta(client, userId, interaction.guild || null),
      listManagedActivityRoleUserIds: () => listActivityRoleHolderUserIds(client, interaction.guild || null),
      applyRoleChanges: ({ userId, addRoleIds, removeRoleIds }) => applyActivityMemberRoleChanges(client, {
        userId,
        addRoleIds,
        removeRoleIds,
        guildHint: interaction.guild || null,
        reason: `activity role sync by ${interaction.user?.tag || interaction.user?.id || "unknown"}`,
      }),
      saveDb,
      runSerialized: runSerializedDbTask,
    })) {
      return;
    }

    if (await handleRobloxStatsPanelButtonInteraction({
      interaction,
      client,
      db,
      runtimeState: robloxRuntimeState,
      telemetry: robloxPanelTelemetry,
      appConfig: getEffectiveAppConfig(),
      getAppConfig: () => getEffectiveAppConfig(),
      isModerator,
      replyNoPermission: () => interaction.reply(ephemeralPayload({ content: "Нет прав." })),
      buildModeratorPanelPayload,
      buildRobloxPanelPayload: ({ statusText = "" } = {}) => buildRobloxStatsPanelPayload({
        db,
        runtimeState: robloxRuntimeState,
        telemetry: robloxPanelTelemetry,
        appConfig: getEffectiveAppConfig(),
        statusText,
      }),
      updateRobloxSettings: (patch = {}) => {
        const previousSnapshot = captureRobloxIntegrationSnapshot();
        return runSerializedDbMutation({
        label: "roblox-panel-settings",
        mutate: () => writeNativeIntegrationSnapshot(db, {
          slot: "roblox",
          patch: normalizeRobloxPanelSettingsPatch(patch),
        }),
        shouldPersist: (result) => result?.mutated === true,
        persist: () => saveDb(),
        rollback: () => restoreRobloxIntegrationSnapshot(previousSnapshot),
        afterPersist: (result) => {
          if (result?.mutated !== true) return;
          configureSharedProfileRuntime({ roblox: getEffectiveRobloxConfig() });
          rescheduleRobloxIntervals();
        },
      });
      },
      clearRefreshDiagnostics: () => {
        const previousProfiles = captureProfilesSnapshot();
        return runSerializedDbMutation({
        label: "roblox-panel-clear-refresh-diagnostics",
        mutate: () => clearAllRobloxRefreshDiagnostics(db.profiles),
        shouldPersist: (result) => result?.mutated === true,
        persist: () => saveDb(),
        rollback: () => restoreProfilesSnapshot(previousProfiles),
      });
      },
      runProfileRefreshJob: runScheduledRobloxProfileRefreshJob,
      runPlaytimeSyncJob: syncRobloxPlaytime,
      runRuntimeFlush: flushRobloxRuntime,
    })) {
      return;
    }

    if (interaction.customId === "welcome_editor") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав. Только модераторы могут редактировать." }));
        return;
      }
      await interaction.reply(buildWelcomeEditorPayload());
      return;
    }

    if (interaction.customId === "panel_config_channels") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const modal = new ModalBuilder().setCustomId("panel_config_channels_modal").setTitle("Каналы Moderator");
      const welcomeInput = new TextInputBuilder()
        .setCustomId("panel_channel_welcome")
        .setLabel("Welcome канал")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(40)
        .setPlaceholder("#channel или 123456789012345678")
        .setValue(String(getResolvedChannelId("welcome")).slice(0, 40));
      const reviewInput = new TextInputBuilder()
        .setCustomId("panel_channel_review")
        .setLabel("Review канал")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(40)
        .setPlaceholder("#channel или 123456789012345678")
        .setValue(String(getResolvedChannelId("review")).slice(0, 40));
      const textTierlistInput = new TextInputBuilder()
        .setCustomId("panel_channel_text_tierlist")
        .setLabel("Text tierlist канал")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(40)
        .setPlaceholder("#channel или 123456789012345678")
        .setValue(String(getResolvedChannelId("tierlistText")).slice(0, 40));
      const graphicTierlistInput = new TextInputBuilder()
        .setCustomId("panel_channel_graphic_tierlist")
        .setLabel("Graphic tierlist канал")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(40)
        .setPlaceholder("#channel или 123456789012345678")
        .setValue(String(getResolvedChannelId("tierlistGraphic")).slice(0, 40));
      const noticesInput = new TextInputBuilder()
        .setCustomId("panel_channel_notices")
        .setLabel("Notice/log канал")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(40)
        .setPlaceholder("#channel или 123456789012345678")
        .setValue(String(getResolvedChannelId("log")).slice(0, 40));

      modal.addComponents(
        new ActionRowBuilder().addComponents(welcomeInput),
        new ActionRowBuilder().addComponents(reviewInput),
        new ActionRowBuilder().addComponents(textTierlistInput),
        new ActionRowBuilder().addComponents(graphicTierlistInput),
        new ActionRowBuilder().addComponents(noticesInput)
      );
      await interaction.showModal(modal);
      return;
    }

    if (interaction.customId.startsWith("welcome_editor_")) {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const presentation = getPresentation();

      if (interaction.customId === "welcome_editor_close") {
        await interaction.update({ content: "Welcome Editor закрыт.", embeds: [], components: [] });
        return;
      }

      if (interaction.customId === "welcome_editor_refresh") {
        await interaction.deferUpdate();
        await refreshWelcomePanel(client);
        await refreshAllTierlists(client);
        await interaction.editReply(buildWelcomeEditorPayload("Welcome и tier-листы пересобраны."));
        return;
      }

      if (interaction.customId === "welcome_editor_text") {
        const modal = new ModalBuilder().setCustomId("welcome_editor_text_modal").setTitle("Welcome текст");
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("welcome_title").setLabel("Заголовок").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(256).setValue(presentation.welcome.title)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("welcome_text").setLabel("Текст описания").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(2000).setValue(presentation.welcome.description)
          )
        );
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === "welcome_editor_steps") {
        const modal = new ModalBuilder().setCustomId("welcome_editor_steps_modal").setTitle("Шаги welcome");
        const steps = [...presentation.welcome.steps];
        while (steps.length < 5) steps.push("");
        modal.addComponents(
          ...steps.slice(0, 5).map((step, index) =>
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId(`welcome_step_${index + 1}`)
                .setLabel(`Шаг ${index + 1}`)
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(160)
                .setValue(step)
            )
          )
        );
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === "welcome_editor_buttons") {
        const modal = new ModalBuilder().setCustomId("welcome_editor_buttons_modal").setTitle("Кнопки welcome");
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("button_begin").setLabel("Кнопка начала").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80).setValue(presentation.welcome.buttons.begin)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("button_quick").setLabel("Кнопка мейнов").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80).setValue(presentation.welcome.buttons.quickMains)
          )
        );
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === "welcome_editor_submit") {
        const modal = new ModalBuilder().setCustomId("welcome_editor_submit_modal").setTitle("Submit шаг");
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("submit_step_title")
              .setLabel("Заголовок")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setMaxLength(256)
              .setValue(presentation.welcome.submitStep?.title || "")
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("submit_step_text")
              .setLabel("Текст ({{uploadTarget}}, {{exampleNote}})")
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
              .setMaxLength(3000)
              .setValue(presentation.welcome.submitStep?.description || "")
          )
        );
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === "welcome_editor_jjs") {
        const nonJjsUi = getNonJjsUiConfig();
        const modal = new ModalBuilder().setCustomId("welcome_editor_jjs_modal").setTitle("JJS блок");
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("jjs_title").setLabel("Заголовок блока").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(120).setValue(nonJjsUi.title)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("jjs_text").setLabel("Описание блока").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000).setValue(nonJjsUi.description)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("jjs_button").setLabel("Текст кнопки").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80).setValue(nonJjsUi.buttonLabel)
          )
        );
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === "welcome_editor_tiers") {
        const modal = new ModalBuilder().setCustomId("welcome_editor_tiers_modal").setTitle("Названия тиров");
        modal.addComponents(
          ...[1, 2, 3, 4, 5].map((tier) =>
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId(`tier_label_${tier}`)
                .setLabel(`Тир ${tier}`)
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(60)
                .setValue(formatTierLabel(tier))
            )
          )
        );
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === "welcome_editor_png") {
        const modal = new ModalBuilder().setCustomId("welcome_editor_png_modal").setTitle("PNG и tierlist тексты");
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("text_tierlist_title").setLabel("Название текстового тир-листа").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(120).setValue(presentation.tierlist.textTitle)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("graphic_title").setLabel("Название PNG тир-листа").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(120).setValue(presentation.tierlist.graphicTitle)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("graphic_message_text").setLabel("Текст под PNG").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(4000).setValue(presentation.tierlist.graphicMessageText)
          )
        );
        await interaction.showModal(modal);
        return;
      }

      return;
    }

    if (interaction.customId === "panel_add_character") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }
      const modal = new ModalBuilder()
        .setCustomId("panel_add_character_modal")
        .setTitle("Добавить персонажа");
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("character_name")
            .setLabel("Имя персонажа")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(100)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("character_id")
            .setLabel("ID латиницей (необязательно)")
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(64)
            .setPlaceholder("например ryu")
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("character_image_url")
            .setLabel("Прямой URL PNG/JPG")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(1000)
            .setPlaceholder("https://cdn.discordapp.com/.../image.png")
        )
      );
      await interaction.showModal(modal);
      return;
    }

    if (interaction.customId === "panel_mode_apocalypse") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      await interaction.update(buildModeratorApocalypseConfirmPayload("Подтверди включение перед применением.", false));
      return;
    }

    if (interaction.customId === "panel_mode_apocalypse_confirm") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const state = getOnboardModeState();
      state.mode = ONBOARD_ACCESS_MODES.APOCALYPSE;
      state.changedAt = nowIso();
      state.changedBy = interaction.user.tag;
      saveDb();

      await interaction.update(await buildModeratorPanelPayload(
        client,
        "Режим онбординга переключён на апокалипсис. Новые участники без ролей будут удаляться при входе.",
        false
      ));
      return;
    }

    if (interaction.customId === "panel_mode_apocalypse_cancel") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      await interaction.update(await buildModeratorPanelPayload(client, "Включение апокалипсиса отменено.", false));
      return;
    }

    if (interaction.customId === "panel_open_elo") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      await interaction.update(buildDormantEloPanelPayload("", false));
      return;
    }

    if (interaction.customId === "panel_open_tierlist") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      await interaction.update(buildDormantTierlistPanelPayload("", false));
      return;
    }

    if ([
      "text_tierlist_first",
      "text_tierlist_prev",
      "text_tierlist_next",
      "text_tierlist_recent_first",
      "text_tierlist_recent_prev",
      "text_tierlist_recent_next",
    ].includes(interaction.customId)) {
      try {
        await interaction.deferUpdate().catch(() => {});
        const pagination = getTextTierlistPaginationState();
        const liveContext = await getLiveCharacterStatsContext(client);
        const total = getLiveApprovedTierlistEntries(liveContext).length;
        const recentPageCount = paginateRecentKillChanges(
          collectRecentKillChanges(Object.values(db.submissions || {})),
          {
            page: 0,
            pageSize: RECENT_KILL_CHANGES_PAGE_SIZE,
            maxPages: RECENT_KILL_CHANGES_MAX_PAGES,
          }
        ).pageCount;
        const PAGE_SIZE = 25;
        const nextPagination = applyTextTierlistPaginationAction(pagination, {
          text_tierlist_first: "rank_first",
          text_tierlist_prev: "rank_prev",
          text_tierlist_next: "rank_next",
          text_tierlist_recent_first: "recent_first",
          text_tierlist_recent_prev: "recent_prev",
          text_tierlist_recent_next: "recent_next",
        }[interaction.customId] || "", {
          rankPageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
          recentPageCount,
        });

        pagination.page = nextPagination.page;
        pagination.recentPage = nextPagination.recentPage;
        pagination.lastInteractionAt = Date.now();
        saveDb();

        const payload = await buildTierlistBoardPayload(client, {
          page: nextPagination.page,
          recentPage: nextPagination.recentPage,
        });
        await interaction.editReply({
          content: payload.content || "",
          embeds: payload.embeds || [],
          components: payload.components || [],
          allowedMentions: payload.allowedMentions || { parse: [] },
        });
      } catch (error) {
        console.error("text tierlist pagination error:", error?.message || error);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply(ephemeralPayload({ content: "Не удалось обновить страницу тир-листа." })).catch(() => {});
        } else {
          await interaction.followUp(ephemeralPayload({ content: `Не удалось обновить страницу: ${error?.message || error}` })).catch(() => {});
        }
      }
      return;
    }

    if (["tierlist_panel_refresh_import", "tierlist_panel_back", "tierlist_panel_refresh_public"].includes(interaction.customId)) {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      if (interaction.customId === "tierlist_panel_back") {
        await interaction.update(await buildModeratorPanelPayload(client, "", false));
        return;
      }

      await interaction.deferUpdate();

      if (interaction.customId === "tierlist_panel_refresh_public") {
        const liveState = getLiveLegacyTierlistState();
        if (!liveState.ok) {
          await interaction.editReply(buildDormantTierlistPanelPayload(`Legacy public views недоступны: ${liveState.error}`, false));
          return;
        }

        try {
          const result = await refreshLegacyTierlistPublicViews(client, { liveState });
          const dashboardOk = result.dashboard && result.dashboard.ok;
          const summaryOk = result.summary && result.summary.ok;
          const syncResult = result.dashboard?.syncResult || result.summary?.syncResult || null;
          const statusText = (!dashboardOk && !summaryOk)
            ? "Не нашёл ни dashboard, ни summary. Сначала настрой каналы через Tierlist Panel."
            : `Обновлено: dashboard ${dashboardOk ? "ok" : "—"}, summary ${summaryOk ? "ok" : "—"}.${getLegacyTierlistSyncStatusSuffix(syncResult)}`;
          await interaction.editReply(buildDormantTierlistPanelPayload(statusText, false));
        } catch (error) {
          await interaction.editReply(buildDormantTierlistPanelPayload(String(error?.message || error || "Не удалось обновить legacy Tierlist public views."), false));
        }
        return;
      }

      const result = refreshDormantTierlistImport();
      await interaction.editReply(buildDormantTierlistPanelPayload(getDormantTierlistImportStatusText(result), false));
      return;
    }

    if (interaction.customId === "tierlist_panel_set_source") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const modal = new ModalBuilder().setCustomId("tierlist_panel_source_modal").setTitle("Путь к legacy Tierlist state");
      const input = new TextInputBuilder()
        .setCustomId("tierlist_source_path")
        .setLabel("Путь к state.json")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(500)
        .setPlaceholder("tierlist/data/state.json или C:\\path\\to\\tierlist\\state.json")
        .setValue(getResolvedIntegrationSourcePath("tierlist").slice(0, 500));

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
      return;
    }

    if (interaction.customId === "tierlist_panel_lookup") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const modal = new ModalBuilder().setCustomId("tierlist_panel_lookup_modal").setTitle("Tierlist lookup");
      const input = new TextInputBuilder()
        .setCustomId("tierlist_lookup_user")
        .setLabel("ID или mention игрока; пусто = показать себя")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(80)
        .setPlaceholder("123456789012345678 или <@123456789012345678>");

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
      return;
    }

    if (["tierlist_panel_setup_dashboard", "tierlist_panel_setup_summary"].includes(interaction.customId)) {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const liveState = getLiveLegacyTierlistState();
      const tierlistIntegration = getResolvedIntegrationRecord("tierlist");
      const isDashboard = interaction.customId === "tierlist_panel_setup_dashboard";
      const modal = new ModalBuilder()
        .setCustomId(isDashboard ? "tierlist_panel_dashboard_setup_modal" : "tierlist_panel_summary_setup_modal")
        .setTitle(isDashboard ? "Tierlist dashboard channel" : "Tierlist summary channel");
      const input = new TextInputBuilder()
        .setCustomId(isDashboard ? "tierlist_dashboard_channel" : "tierlist_summary_channel")
        .setLabel("ID или mention текстового канала")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(80)
        .setPlaceholder("<#123456789012345678> или 123456789012345678")
        .setValue(
          String(
            isDashboard
              ? liveState?.rawState?.settings?.channelId || tierlistIntegration.dashboard?.channelId || ""
              : liveState?.rawState?.settings?.summaryChannelId || tierlistIntegration.summary?.channelId || ""
          ).slice(0, 80)
        );

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
      return;
    }

    if (interaction.customId === "tierlist_panel_channels") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const liveState = getLiveLegacyTierlistState();
  const tierlistIntegration = getResolvedIntegrationRecord("tierlist");
      const modal = new ModalBuilder().setCustomId("tierlist_panel_channels_modal").setTitle("Каналы Tierlist");

      const dashboardInput = new TextInputBuilder()
        .setCustomId("tierlist_channel_dashboard")
        .setLabel("Dashboard канал")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(80)
        .setPlaceholder("<#123456789012345678> или 123456789012345678")
        .setValue(
          String(
            liveState?.rawState?.settings?.channelId ||
            tierlistIntegration.dashboard?.channelId || ""
          ).slice(0, 80)
        );

      const summaryInput = new TextInputBuilder()
        .setCustomId("tierlist_channel_summary")
        .setLabel("Summary канал")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(80)
        .setPlaceholder("<#123456789012345678> или 123456789012345678")
        .setValue(
          String(
            liveState?.rawState?.settings?.summaryChannelId ||
            tierlistIntegration.summary?.channelId || ""
          ).slice(0, 80)
        );

      modal.addComponents(
        new ActionRowBuilder().addComponents(dashboardInput),
        new ActionRowBuilder().addComponents(summaryInput)
      );
      await interaction.showModal(modal);
      return;
    }

    if (interaction.customId === "tierlist_panel_mod_panel") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const liveState = getLiveLegacyTierlistState();
      if (!liveState.ok) {
        await interaction.reply(buildLegacyTierlistStateErrorPayload("Не удалось открыть legacy Tierlist panel", liveState));
        return;
      }

      await interaction.reply(ephemeralPayload(buildLegacyTierlistModPanelPayload(liveState, interaction.user.id)));
      return;
    }

    if (interaction.customId === "tierlist_panel_resend_messages") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const liveState = getLiveLegacyTierlistState();
      if (!liveState.ok) {
        await interaction.editReply(buildLegacyTierlistStateErrorPayload("Не удалось открыть legacy Tierlist state", liveState, false));
        return;
      }

      const rawSettings = liveState.rawState.settings || (liveState.rawState.settings = {});
      const dashboardChannelId = String(rawSettings.channelId || "").trim();
      const summaryChannelId = String(rawSettings.summaryChannelId || "").trim();

      if (!dashboardChannelId && !summaryChannelId) {
        await interaction.editReply(buildDormantTierlistPanelPayload("Каналы не настроены. Сначала укажи каналы через «Каналы Tierlist».", false));
        return;
      }

      const notes = [];

      if (dashboardChannelId) {
        const oldId = String(rawSettings.dashboardMessageId || "").trim();
        if (oldId) {
          const ch = await client.channels.fetch(dashboardChannelId).catch(() => null);
          const msg = ch?.isTextBased?.() ? await ch.messages.fetch(oldId).catch(() => null) : null;
          if (msg?.deletable) await msg.delete().catch(() => {});
          rawSettings.dashboardMessageId = null;
        }
        try {
          const result = await ensureLegacyTierlistDashboardMessage(client, liveState);
          notes.push(`Dashboard переслан в ${formatChannelMention(result.channelId)} (msg ${result.messageId}).`);
        } catch (error) {
          notes.push(`Dashboard ошибка: ${String(error?.message || error)}.`);
        }
      }

      if (summaryChannelId) {
        const oldId = String(rawSettings.summaryMessageId || "").trim();
        if (oldId) {
          const ch = await client.channels.fetch(summaryChannelId).catch(() => null);
          const msg = ch?.isTextBased?.() ? await ch.messages.fetch(oldId).catch(() => null) : null;
          if (msg?.deletable) await msg.delete().catch(() => {});
          rawSettings.summaryMessageId = null;
        }
        try {
          const result = await ensureLegacyTierlistSummaryMessage(client, liveState);
          notes.push(`Summary переслан в ${formatChannelMention(result.channelId)} (msg ${result.messageId}).`);
        } catch (error) {
          notes.push(`Summary ошибка: ${String(error?.message || error)}.`);
        }
      }

      const statusText = `Сообщения отправлены заново. ${notes.join(" ")}`.trim();
      await interaction.editReply(buildDormantTierlistPanelPayload(statusText, false));
      return;
    }

    if (interaction.customId === "start_rating") {
      const liveState = getLiveLegacyTierlistState();
      if (!liveState.ok) {
        await interaction.reply(buildLegacyTierlistStateErrorPayload("Не удалось открыть legacy Tierlist state", liveState));
        return;
      }

      const user = getLegacyTierlistWizardUser(liveState.rawState, interaction.user.id);
      if (Array.isArray(user.wizQueue) && user.wizQueue.length && canUseLegacyTierlistCurrentWizard(liveState.rawState, interaction.user.id)) {
        await interaction.reply(ephemeralPayload(await buildLegacyTierlistWizardPayload(liveState, interaction.user.id)));
        return;
      }

      const mainSync = await syncLegacyTierlistMainsForInteraction(client, liveState, interaction);
      if (mainSync.changed) persistLiveLegacyTierlistState(liveState);

      startLegacyTierlistWizard(liveState, interaction.user.id, "full");
      persistLiveLegacyTierlistState(liveState);
      await interaction.reply(ephemeralPayload(await buildLegacyTierlistWizardPayload(liveState, interaction.user.id)));
      return;
    }

    if (interaction.customId === "rate_new_characters") {
      const liveState = getLiveLegacyTierlistState();
      if (!liveState.ok) {
        await interaction.reply(buildLegacyTierlistStateErrorPayload("Не удалось открыть legacy Tierlist state", liveState));
        return;
      }

      const mainSync = await syncLegacyTierlistMainsForInteraction(client, liveState, interaction);
      if (mainSync.changed) persistLiveLegacyTierlistState(liveState);

      const user = getLegacyTierlistWizardUser(liveState.rawState, interaction.user.id);
      if (!hasSubmittedLegacyTierlist(liveState.rawState, interaction.user.id)) {
        await interaction.reply(ephemeralPayload({ content: "Сначала отправь полный тир-лист кнопкой Начать оценку." }));
        return;
      }

      if (Array.isArray(user.wizQueue) && user.wizQueue.length) {
        await interaction.reply(ephemeralPayload(await buildLegacyTierlistWizardPayload(liveState, interaction.user.id)));
        return;
      }

      const entries = getLegacyTierlistRateableEntries(liveState, interaction.user.id);
      if (!entries.length) {
        await interaction.reply(ephemeralPayload({ content: "Для тебя сейчас нет персонажей для точечной оценки." }));
        return;
      }

      user.pointRatePage = 0;
      persistLiveLegacyTierlistState(liveState);
      await interaction.reply(ephemeralPayload(buildLegacyTierlistPointRatePayload(liveState, interaction.user.id, "Выбери нужные карточки или нажми Только новых.")));
      return;
    }

    if (["point_rate_page_prev", "point_rate_page_next"].includes(interaction.customId)) {
      const liveState = getLiveLegacyTierlistState();
      if (!liveState.ok) {
        await interaction.reply(buildLegacyTierlistStateErrorPayload("Не удалось открыть legacy Tierlist state", liveState));
        return;
      }

      const user = getLegacyTierlistWizardUser(liveState.rawState, interaction.user.id);
      const delta = interaction.customId === "point_rate_page_prev" ? -1 : 1;
      user.pointRatePage = clampLegacyTierlistPointRatePage(liveState, interaction.user.id, (user.pointRatePage || 0) + delta);
      persistLiveLegacyTierlistState(liveState);
      await interaction.update(buildLegacyTierlistPointRatePayload(liveState, interaction.user.id));
      return;
    }

    if (interaction.customId === "point_rate_new") {
      const liveState = getLiveLegacyTierlistState();
      if (!liveState.ok) {
        await interaction.reply(buildLegacyTierlistStateErrorPayload("Не удалось открыть legacy Tierlist state", liveState));
        return;
      }

      const mainSync = await syncLegacyTierlistMainsForInteraction(client, liveState, interaction);
      if (mainSync.changed) persistLiveLegacyTierlistState(liveState);

      const pendingIds = getLegacyTierlistPendingNewCharacterIds(liveState, interaction.user.id);
      if (!pendingIds.length) {
        await interaction.update(buildLegacyTierlistPointRatePayload(liveState, interaction.user.id, "Для тебя пока нет новых персонажей без оценки."));
        return;
      }

      startLegacyTierlistWizard(liveState, interaction.user.id, "new");
      persistLiveLegacyTierlistState(liveState);
      await interaction.deferUpdate();
      await interaction.editReply(await buildLegacyTierlistWizardPayload(liveState, interaction.user.id));
      return;
    }

    if (interaction.customId === "point_rate_close") {
      await interaction.update({ content: "Ок, закрыто.", embeds: [], components: [], attachments: [] });
      return;
    }

    if (["main_page_prev", "main_page_next"].includes(interaction.customId)) {
      const liveState = getLiveLegacyTierlistState();
      if (!liveState.ok) {
        await interaction.reply(buildLegacyTierlistStateErrorPayload("Не удалось открыть legacy Tierlist state", liveState));
        return;
      }

      const mainSync = await syncLegacyTierlistMainsForInteraction(client, liveState, interaction);
      if (mainSync.changed) persistLiveLegacyTierlistState(liveState);
      await interaction.update(buildLegacyTierlistStartPayload(liveState, interaction.user.id, "Ручной выбор main больше не используется. Мейны берутся из ролей."));
      return;
    }

    if (interaction.customId === "wiz_use_current_main") {
      const liveState = getLiveLegacyTierlistState();
      if (!liveState.ok) {
        await interaction.reply(buildLegacyTierlistStateErrorPayload("Не удалось открыть legacy Tierlist state", liveState));
        return;
      }

      const mainSync = await syncLegacyTierlistMainsForInteraction(client, liveState, interaction);
      if (mainSync.changed) persistLiveLegacyTierlistState(liveState);

      startLegacyTierlistWizard(liveState, interaction.user.id, "full");
      persistLiveLegacyTierlistState(liveState);
      await interaction.deferUpdate();
      await interaction.editReply(await buildLegacyTierlistWizardPayload(liveState, interaction.user.id));
      return;
    }

    if (interaction.customId === "wiz_cancel") {
      await interaction.update({ content: "Ок, закрыто.", embeds: [], components: [], attachments: [] });
      return;
    }

    if (interaction.customId === "wiz_back") {
      const liveState = getLiveLegacyTierlistState();
      if (!liveState.ok) {
        await interaction.reply(buildLegacyTierlistStateErrorPayload("Не удалось открыть legacy Tierlist state", liveState));
        return;
      }

      const user = getLegacyTierlistWizardUser(liveState.rawState, interaction.user.id);
      if (!Array.isArray(user.wizQueue) || !user.wizQueue.length) {
        await interaction.update({ content: "Сессия оценки истекла. Нажми Начать оценку заново.", embeds: [], components: [], attachments: [] });
        return;
      }

      rewindLegacyTierlistWizard(liveState.rawState, interaction.user.id);
      persistLiveLegacyTierlistState(liveState);
      await interaction.deferUpdate();
      await interaction.editReply(await buildLegacyTierlistWizardPayload(liveState, interaction.user.id));
      return;
    }

    if (interaction.customId.startsWith("wiz_rate_")) {
      const liveState = getLiveLegacyTierlistState();
      if (!liveState.ok) {
        await interaction.reply(buildLegacyTierlistStateErrorPayload("Не удалось открыть legacy Tierlist state", liveState));
        return;
      }

      const tierKey = interaction.customId.slice("wiz_rate_".length).toUpperCase();
      const user = getLegacyTierlistWizardUser(liveState.rawState, interaction.user.id);
      if (!Array.isArray(user.wizQueue) || !user.wizQueue.length) {
        await interaction.update({ content: "Сессия оценки истекла. Нажми Начать оценку заново.", embeds: [], components: [], attachments: [] });
        return;
      }

      const currentId = currentLegacyTierlistWizardChar(liveState.rawState, interaction.user.id);
      if (!currentId) {
        await interaction.deferUpdate();
        await interaction.editReply(await buildLegacyTierlistWizardPayload(liveState, interaction.user.id));
        return;
      }

      setLegacyTierlistDraftTier(liveState.rawState, interaction.user.id, currentId, tierKey);
      advanceLegacyTierlistWizard(liveState.rawState, interaction.user.id);
      persistLiveLegacyTierlistState(liveState);
      await interaction.deferUpdate();
      await interaction.editReply(await buildLegacyTierlistWizardPayload(liveState, interaction.user.id));
      return;
    }

    if (interaction.customId === "wiz_submit") {
      const liveState = getLiveLegacyTierlistState();
      if (!liveState.ok) {
        await interaction.reply(buildLegacyTierlistStateErrorPayload("Не удалось открыть legacy Tierlist state", liveState));
        return;
      }

      const user = getLegacyTierlistWizardUser(liveState.rawState, interaction.user.id);
      if (!Array.isArray(user.wizQueue) || !user.wizQueue.length || !legacyTierlistWizardDone(liveState.rawState, interaction.user.id)) {
        await interaction.reply(ephemeralPayload({ content: "Сначала заверши оценку всех персонажей в текущей сессии." }));
        return;
      }

      await interaction.deferUpdate();
      const mode = user.wizMode || "full";
      submitLegacyTierlistVotes(liveState.rawState, interaction.user.id);

      const influence = resolveLegacyTierlistInfluenceFromMember(interaction.member, liveState.rawState);
      user.influenceMultiplier = influence.mult;
      user.influenceRoleId = influence.roleId;
      user.influenceUpdatedAt = Date.now();
      user.lastSubmitAt = Date.now();
      lockLegacyTierlistUser(liveState.rawState, interaction.user.id);
      user.wizQueue = null;
      user.wizIndex = 0;
      user.wizMode = null;
      liveState.rawState.draftVotes ||= {};
      liveState.rawState.draftVotes[interaction.user.id] = {};

      const syncResult = saveLiveLegacyTierlistStateAndResync(liveState);
      const refreshError = await tryRefreshLegacyTierlistPublicViews(client, liveState);
      if (refreshError) {
        console.warn(`[legacy-tierlist] wizard submit refresh warning for ${interaction.user.id}: ${refreshError}`);
      }

      const mainsText = formatLegacyTierlistMainSummary(liveState, user);
      const description = mode === "new"
        ? [
            "Новые персонажи сохранены.",
            `Мейны: **${mainsText}**`,
            `Вес голоса: x${Number(user.influenceMultiplier || 1).toFixed(1)}`,
          ].join("\n")
        : mode === "targeted"
          ? [
              "Выбранные персонажи переоценены.",
              `Мейны: **${mainsText}**`,
              `Вес голоса: x${Number(user.influenceMultiplier || 1).toFixed(1)}`,
            ].join("\n")
        : [
            "Тир-лист сохранён.",
            `Мейны: **${mainsText}**`,
            `Вес голоса: x${Number(user.influenceMultiplier || 1).toFixed(1)}`,
            "Можно сразу запускать новую оценку снова.",
          ].join("\n");

      await interaction.editReply({
        embeds: [new EmbedBuilder().setTitle(mode === "new" ? "Дооценка сохранена" : mode === "targeted" ? "Точечная оценка сохранена" : "Тир-лист сохранён").setDescription(`${description}${getLegacyTierlistSyncStatusSuffix(syncResult)}${getLegacyTierlistRefreshWarningText(refreshError)}`)],
        components: [],
        files: [],
        attachments: [],
      });
      return;
    }

    if (interaction.customId === "refresh_tierlist") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав (нужно Manage Guild)." }));
        return;
      }

      const liveState = getLiveLegacyTierlistState();
      if (!liveState.ok) {
        await interaction.reply(buildLegacyTierlistStateErrorPayload("Не удалось открыть legacy Tierlist state", liveState));
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const result = await refreshLegacyTierlistPublicViews(client, { liveState });
        const dashboardOk = result.dashboard && result.dashboard.ok;
        const summaryOk = result.summary && result.summary.ok;
        if (!dashboardOk && !summaryOk) {
          await interaction.editReply("Не нашёл ни dashboard, ни summary. Сначала настрой их через Tierlist Panel.");
          return;
        }

        const syncResult = result.dashboard?.syncResult || result.summary?.syncResult || null;
        await interaction.editReply(`Ок. Обновлено: dashboard ${dashboardOk ? "ok" : "—"}, summary ${summaryOk ? "ok" : "—"}.${getLegacyTierlistSyncStatusSuffix(syncResult)}`);
      } catch (error) {
        await interaction.editReply(String(error?.message || error || "Не удалось обновить Tierlist public views."));
      }
      return;
    }

    if (interaction.customId === "my_status") {
      const liveState = getLiveLegacyTierlistState();
      if (!liveState.ok) {
        await interaction.reply(buildLegacyTierlistStateErrorPayload("Не удалось открыть legacy Tierlist state", liveState));
        return;
      }

      const mainSync = await syncLegacyTierlistMainsForInteraction(client, liveState, interaction);
      if (mainSync.changed) persistLiveLegacyTierlistState(liveState);

      const rawUser = liveState.rawState?.users?.[interaction.user.id] || {};
      const mainName = formatLegacyTierlistMainSummary(liveState, rawUser);
      const votes = liveState.rawState?.finalVotes?.[interaction.user.id] || null;

      if (votes && Object.keys(votes).length > 0) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
          const png = await renderLegacyTierlistUserPng(liveState, interaction.user.id, "(твой тир-лист)");
          const attachment = new AttachmentBuilder(png, { name: "my-tierlist.png" });
          const lastSubmitAt = rawUser.lastSubmitAt ? formatLegacyTierlistMoment(rawUser.lastSubmitAt) : "—";
          const counts = getLegacyTierlistUserTierCounts(votes);
          const embed = new EmbedBuilder()
            .setTitle("Твой статус")
            .setDescription([
              `Мейны: **${mainName}**`,
              `Submit: ${lastSubmitAt}`,
              `S/A/B/C/D: ${counts.S}/${counts.A}/${counts.B}/${counts.C}/${counts.D}`,
              "Можно отправлять оценку: **да**",
              "Для частичного обновления используй кнопку **Оценить точечно**.",
            ].join("\n"))
            .setImage("attachment://my-tierlist.png");

          await interaction.editReply({ embeds: [embed], files: [attachment] });
        } catch (error) {
          await interaction.editReply(String(error?.message || error || "Не удалось собрать PNG твоего тир-листа."));
        }
        return;
      }

      const lines = [
        `Мейны: **${mainName}**`,
        "Ты ещё не отправлял тир-лист.",
        "Можно отправлять оценку: **да**",
      ];
      await interaction.reply(ephemeralPayload({ content: lines.join("\n") }));
      return;
    }

    if (LEGACY_TIERLIST_PANEL_BUTTON_IDS.has(interaction.customId)) {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const liveState = getLiveLegacyTierlistState();
      if (!liveState.ok) {
        await interaction.reply(buildLegacyTierlistStateErrorPayload("Не удалось открыть legacy Tierlist panel", liveState));
        return;
      }

      const userId = interaction.user.id;
      const panelUser = getLegacyTierlistWizardUser(liveState.rawState, userId);

      if (interaction.customId === "panel_tab_config") {
        panelUser.panelTab = "config";
        panelUser.panelParticipantId = null;
        panelUser.panelWipeAllVotesConfirm = false;
        persistLiveLegacyTierlistState(liveState);
        await interaction.update(buildLegacyTierlistModPanelPayload(liveState, userId));
        return;
      }

      if (interaction.customId === "panel_tab_participants") {
        panelUser.panelTab = "participants";
        panelUser.panelParticipantId = null;
        panelUser.panelParticipantsPage = 0;
        panelUser.panelWipeAllVotesConfirm = false;
        persistLiveLegacyTierlistState(liveState);
        await interaction.update(buildLegacyTierlistModPanelPayload(liveState, userId));
        return;
      }

      if (interaction.customId === "panel_part_prev") {
        panelUser.panelTab = "participants";
        panelUser.panelParticipantId = null;
        panelUser.panelParticipantsPage = Math.max(0, (Number(panelUser.panelParticipantsPage) || 0) - 1);
        persistLiveLegacyTierlistState(liveState);
        await interaction.update(buildLegacyTierlistModPanelPayload(liveState, userId));
        return;
      }

      if (interaction.customId === "panel_part_next") {
        panelUser.panelTab = "participants";
        panelUser.panelParticipantId = null;
        panelUser.panelParticipantsPage = (Number(panelUser.panelParticipantsPage) || 0) + 1;
        persistLiveLegacyTierlistState(liveState);
        await interaction.update(buildLegacyTierlistModPanelPayload(liveState, userId));
        return;
      }

      if (interaction.customId === "panel_part_refresh") {
        panelUser.panelTab = "participants";
        persistLiveLegacyTierlistState(liveState);
        await interaction.update(buildLegacyTierlistModPanelPayload(liveState, userId));
        return;
      }

      if (interaction.customId === "panel_part_back") {
        panelUser.panelTab = "participants";
        panelUser.panelParticipantId = null;
        panelUser.panelDeleteTargetId = null;
        panelUser.panelDeleteMode = null;
        panelUser.panelWipeAllVotesConfirm = false;
        persistLiveLegacyTierlistState(liveState);
        await interaction.update(buildLegacyTierlistModPanelPayload(liveState, userId));
        return;
      }

      if (interaction.customId === "panel_part_view_png") {
        const targetId = panelUser.panelParticipantId;
        const votes = targetId ? liveState.rawState?.finalVotes?.[targetId] : null;
        if (!targetId || !votes || Object.keys(votes).length === 0) {
          await interaction.reply(ephemeralPayload({ content: "У этого пользователя нет сохранённого тир-листа." }));
          return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const png = await renderLegacyTierlistUserPng(liveState, targetId, "(его тир-лист)");
        const attachment = new AttachmentBuilder(png, { name: "user-tierlist.png" });
        const embed = new EmbedBuilder()
          .setTitle("Tierlist пользователя")
          .setDescription(`<@${targetId}>`)
          .setImage("attachment://user-tierlist.png");
        await interaction.editReply({ embeds: [embed], files: [attachment] });
        return;
      }

      if (interaction.customId === "panel_part_delete_votes" || interaction.customId === "panel_part_delete_full") {
        const targetId = panelUser.panelParticipantId;
        if (!targetId) {
          await interaction.reply(ephemeralPayload({ content: "Не выбран участник." }));
          return;
        }

        panelUser.panelDeleteTargetId = targetId;
        panelUser.panelDeleteMode = interaction.customId === "panel_part_delete_full" ? "full" : "votes";
        persistLiveLegacyTierlistState(liveState);
        await interaction.update(buildLegacyTierlistModPanelPayload(liveState, userId));
        return;
      }

      if (interaction.customId === "panel_part_cancel_delete") {
        panelUser.panelDeleteTargetId = null;
        panelUser.panelDeleteMode = null;
        persistLiveLegacyTierlistState(liveState);
        await interaction.update(buildLegacyTierlistModPanelPayload(liveState, userId));
        return;
      }

      if (interaction.customId === "panel_part_confirm_delete") {
        const targetId = panelUser.panelDeleteTargetId;
        const mode = panelUser.panelDeleteMode;
        if (!targetId || !mode) {
          await interaction.reply(ephemeralPayload({ content: "Нечего подтверждать." }));
          return;
        }

        if (mode === "votes") {
          delete liveState.rawState.finalVotes[targetId];
        } else if (mode === "full") {
          delete liveState.rawState.finalVotes[targetId];
          delete liveState.rawState.draftVotes[targetId];
          delete liveState.rawState.users[targetId];
        }

        panelUser.panelDeleteTargetId = null;
        panelUser.panelDeleteMode = null;
        panelUser.panelParticipantId = null;

        await interaction.deferUpdate();
        const syncResult = saveLiveLegacyTierlistStateAndResync(liveState);
        if (mode === "full") {
          try {
            await purgeUserProfile(client, targetId, interaction.user.tag);
          } catch (error) {
            console.warn("purgeUserProfile (panel full delete) failed:", error?.message || error);
          }
        }
        invalidateLiveCharacterStatsContext();
        const refreshError = await tryRefreshLegacyTierlistPublicViews(client, liveState);
        if (refreshError) {
          console.warn(`[legacy-tierlist] panel participant delete refresh warning for ${targetId}: ${refreshError}`);
        }
        if (mode === "full") {
          try { await refreshAllTierlists(client); } catch (error) {
            console.warn("refreshAllTierlists (panel full delete) failed:", error?.message || error);
          }
        }
        await interaction.editReply(buildLegacyTierlistModPanelPayload(liveState, userId, `Удаление выполнено.${getLegacyTierlistSyncStatusSuffix(syncResult)}${getLegacyTierlistRefreshWarningText(refreshError)}`));
        return;
      }

      if (interaction.customId === "panel_wipe_votes_all") {
        panelUser.panelTab = "config";
        panelUser.panelWipeAllVotesConfirm = true;
        persistLiveLegacyTierlistState(liveState);
        await interaction.update(buildLegacyTierlistModPanelPayload(liveState, userId, "Подтверди глобальное удаление всех голосов по персонажам."));
        return;
      }

      if (interaction.customId === "panel_cancel_wipe_votes_all") {
        panelUser.panelWipeAllVotesConfirm = false;
        persistLiveLegacyTierlistState(liveState);
        await interaction.update(buildLegacyTierlistModPanelPayload(liveState, userId, "Глобальное удаление голосов отменено."));
        return;
      }

      if (interaction.customId === "panel_confirm_wipe_votes_all") {
        panelUser.panelWipeAllVotesConfirm = false;
        await interaction.deferUpdate();
        wipeLegacyTierlistVotesOnly(liveState.rawState);
        const syncResult = saveLiveLegacyTierlistStateAndResync(liveState);
        const refreshError = await tryRefreshLegacyTierlistPublicViews(client, liveState);
        if (refreshError) {
          console.warn(`[legacy-tierlist] panel wipe votes refresh warning: ${refreshError}`);
        }
        await interaction.editReply(buildLegacyTierlistModPanelPayload(liveState, userId, `Все голоса по персонажам удалены.${getLegacyTierlistSyncStatusSuffix(syncResult)}${getLegacyTierlistRefreshWarningText(refreshError)}`));
        return;
      }

      if (interaction.customId === "panel_close") {
        panelUser.panelWipeAllVotesConfirm = false;
        await interaction.update({ content: "Ок.", embeds: [], components: [], attachments: [] });
        return;
      }

      if (interaction.customId === "panel_refresh") {
        await interaction.deferUpdate();
        try {
          const result = await refreshLegacyTierlistPublicViews(client, { liveState });
          const dashboardOk = result.dashboard && result.dashboard.ok;
          const summaryOk = result.summary && result.summary.ok;
          const syncResult = result.dashboard?.syncResult || result.summary?.syncResult || null;
          await interaction.editReply(buildLegacyTierlistModPanelPayload(
            liveState,
            userId,
            `Обновлено: dashboard ${dashboardOk ? "ok" : "—"}, summary ${summaryOk ? "ok" : "—"}.${getLegacyTierlistSyncStatusSuffix(syncResult)}`
          ));
        } catch (error) {
          const refreshError = String(error?.message || error || "unknown refresh error").trim() || "unknown refresh error";
          console.warn(`[legacy-tierlist] panel refresh warning: ${refreshError}`);
          await interaction.editReply(buildLegacyTierlistModPanelPayload(
            liveState,
            userId,
            `Не удалось обновить public views.${getLegacyTierlistRefreshWarningText(refreshError)}`
          ));
        }
        return;
      }

      if (interaction.customId === "panel_role_coefficients") {
        const influenceCfg = getLegacyTierlistInfluenceConfig(liveState.rawState);
        const modal = new ModalBuilder()
          .setCustomId("panel_role_coefficients_modal")
          .setTitle("Коэффициенты влияния");

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("tierlist_influence_low")
              .setLabel("Без роли / T1 / T2")
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
              .setMaxLength(80)
              .setValue(`default=${influenceCfg.default.toFixed(2)}\n1=${influenceCfg[1].toFixed(2)}\n2=${influenceCfg[2].toFixed(2)}`)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("tierlist_influence_high")
              .setLabel("T3 / T4 / T5")
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
              .setMaxLength(80)
              .setValue(`3=${influenceCfg[3].toFixed(2)}\n4=${influenceCfg[4].toFixed(2)}\n5=${influenceCfg[5].toFixed(2)}`)
          )
        );
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === "panel_set_img") {
        const cfg = getLegacyTierlistImageConfig(liveState.rawState);
        const modal = new ModalBuilder()
          .setCustomId("panel_set_img_modal")
          .setTitle("Размеры legacy Tierlist");
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("tierlist_width")
              .setLabel("Ширина PNG (1200-4096)")
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
              .setMaxLength(4)
              .setValue(String(cfg.W))
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("tierlist_height")
              .setLabel("Высота PNG (700-2160)")
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
              .setMaxLength(4)
              .setValue(String(cfg.H))
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("tierlist_icon")
              .setLabel("Размер иконок (64-256)")
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
              .setMaxLength(3)
              .setValue(String(cfg.ICON))
          )
        );
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === "panel_icon_minus" || interaction.customId === "panel_icon_plus") {
        applyLegacyTierlistImageDelta(liveState.rawState, "icon", interaction.customId === "panel_icon_plus" ? 12 : -12);
        await interaction.deferUpdate();
        const syncResult = saveLiveLegacyTierlistStateAndResync(liveState);
        const refreshError = await tryRefreshLegacyTierlistPublicViews(client, liveState);
        if (refreshError) {
          console.warn(`[legacy-tierlist] panel icon resize refresh warning: ${refreshError}`);
        }
        const cfg = getLegacyTierlistImageConfig(liveState.rawState);
        await interaction.editReply(buildLegacyTierlistModPanelPayload(liveState, userId, `img: ${cfg.W}x${cfg.H}, icon=${cfg.ICON}.${getLegacyTierlistSyncStatusSuffix(syncResult)}${getLegacyTierlistRefreshWarningText(refreshError)}`));
        return;
      }

      if (interaction.customId === "panel_w_minus" || interaction.customId === "panel_w_plus") {
        applyLegacyTierlistImageDelta(liveState.rawState, "width", interaction.customId === "panel_w_plus" ? 200 : -200);
        await interaction.deferUpdate();
        const syncResult = saveLiveLegacyTierlistStateAndResync(liveState);
        const refreshError = await tryRefreshLegacyTierlistPublicViews(client, liveState);
        if (refreshError) {
          console.warn(`[legacy-tierlist] panel width resize refresh warning: ${refreshError}`);
        }
        const cfg = getLegacyTierlistImageConfig(liveState.rawState);
        await interaction.editReply(buildLegacyTierlistModPanelPayload(liveState, userId, `img: ${cfg.W}x${cfg.H}, icon=${cfg.ICON}.${getLegacyTierlistSyncStatusSuffix(syncResult)}${getLegacyTierlistRefreshWarningText(refreshError)}`));
        return;
      }

      if (interaction.customId === "panel_h_minus" || interaction.customId === "panel_h_plus") {
        applyLegacyTierlistImageDelta(liveState.rawState, "height", interaction.customId === "panel_h_plus" ? 120 : -120);
        await interaction.deferUpdate();
        const syncResult = saveLiveLegacyTierlistStateAndResync(liveState);
        const refreshError = await tryRefreshLegacyTierlistPublicViews(client, liveState);
        if (refreshError) {
          console.warn(`[legacy-tierlist] panel height resize refresh warning: ${refreshError}`);
        }
        const cfg = getLegacyTierlistImageConfig(liveState.rawState);
        await interaction.editReply(buildLegacyTierlistModPanelPayload(liveState, userId, `img: ${cfg.W}x${cfg.H}, icon=${cfg.ICON}.${getLegacyTierlistSyncStatusSuffix(syncResult)}${getLegacyTierlistRefreshWarningText(refreshError)}`));
        return;
      }

      if (interaction.customId === "panel_reset_img") {
        resetLegacyTierlistImageOverrides(liveState.rawState);
        await interaction.deferUpdate();
        const syncResult = saveLiveLegacyTierlistStateAndResync(liveState);
        const refreshError = await tryRefreshLegacyTierlistPublicViews(client, liveState);
        if (refreshError) {
          console.warn(`[legacy-tierlist] panel reset image refresh warning: ${refreshError}`);
        }
        const cfg = getLegacyTierlistImageConfig(liveState.rawState);
        await interaction.editReply(buildLegacyTierlistModPanelPayload(liveState, userId, `img: ${cfg.W}x${cfg.H}, icon=${cfg.ICON}.${getLegacyTierlistSyncStatusSuffix(syncResult)}${getLegacyTierlistRefreshWarningText(refreshError)}`));
        return;
      }

      if (interaction.customId === "panel_fonts") {
        const info = getLegacyTierlistFontDebugInfo();
        const lines = [
          "assets/fonts ttf files:",
          info.files.length ? info.files.map((filePath) => `- ${path.basename(filePath)}`).join("\n") : "- (none)",
          "",
          `picked regular: ${info.regularFile ? path.basename(info.regularFile) : "(null)"}`,
          `picked bold: ${info.boldFile ? path.basename(info.boldFile) : "(null)"}`,
          `fallback: ${info.usedFallback}`,
        ];
        await interaction.reply(ephemeralPayload({ content: lines.join("\n") }));
        return;
      }

      if (interaction.customId === "panel_rename") {
        const tierKey = panelUser.panelTierKey || "S";
        const currentName = liveState.rawState?.tiers?.[tierKey]?.name || tierKey;
        const modal = new ModalBuilder()
          .setCustomId(`panel_rename_modal:${tierKey}`)
          .setTitle(`Переименовать тир ${tierKey}`);
        const input = new TextInputBuilder()
          .setCustomId("tier_name")
          .setLabel("Новое название (на картинке)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(24)
          .setValue(String(currentName).slice(0, 24));
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === "panel_set_img") {
        const cfg = getLegacyTierlistImageConfig(liveState.rawState);
        const modal = new ModalBuilder()
          .setCustomId("panel_set_img_modal")
          .setTitle("Размеры legacy Tierlist");
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("tierlist_width")
              .setLabel("Ширина PNG (1200-4096)")
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
              .setMaxLength(4)
              .setValue(String(cfg.W))
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("tierlist_height")
              .setLabel("Высота PNG (700-2160)")
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
              .setMaxLength(4)
              .setValue(String(cfg.H))
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("tierlist_icon")
              .setLabel("Размер иконок (64-256)")
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
              .setMaxLength(3)
              .setValue(String(cfg.ICON))
          )
        );
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === "panel_add_custom_character") {
        const modal = new ModalBuilder()
          .setCustomId("panel_add_custom_character_modal")
          .setTitle("Добавить персонажа в legacy Tierlist");
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("character_name")
              .setLabel("Имя персонажа")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setMaxLength(100)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("character_id")
              .setLabel("ID латиницей (необязательно)")
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
              .setMaxLength(64)
              .setPlaceholder("например ryu")
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("character_image_url")
              .setLabel("Прямой URL PNG/JPG")
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
              .setMaxLength(1000)
              .setPlaceholder("https://cdn.discordapp.com/.../image.png")
          )
        );
        await interaction.showModal(modal);
        return;
      }

      await interaction.reply(ephemeralPayload({ content: "Неизвестная кнопка панели." }));
      return;
    }

    if (["elo_panel_refresh_import", "elo_panel_back"].includes(interaction.customId)) {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      if (interaction.customId === "elo_panel_back") {
        await interaction.update(await buildModeratorPanelPayload(client, "", false));
        return;
      }

      await interaction.deferUpdate();
      const result = refreshDormantEloImport();
      let statusText = getDormantEloImportStatusText(result);
      const liveState = getLiveLegacyEloState();
      if (liveState.ok) {
        const roleSync = await syncLegacyEloTierRoles(client, liveState.rawDb, { reason: "legacy elo import sync" });
        if (roleSync.processed > 0) {
          statusText += ` Роли: assigned ${roleSync.assigned}, cleared ${roleSync.cleared}.`;
        }
      }
      await interaction.editReply(buildDormantEloPanelPayload(statusText, false));
      return;
    }

    if (["elo_panel_pending", "elo_review_refresh_pending"].includes(interaction.customId)) {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      if (interaction.customId === "elo_panel_pending") {
        await interaction.reply(buildDormantEloPendingPayload(15));
        return;
      }

      await interaction.update(buildDormantEloPendingPayload(15, false));
      return;
    }

    if (interaction.customId === "elo_panel_set_source") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const modal = new ModalBuilder().setCustomId("elo_panel_source_modal").setTitle("Путь к legacy ELO db");
      const input = new TextInputBuilder()
        .setCustomId("elo_source_path")
        .setLabel("Путь к db.json")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(500)
        .setPlaceholder("elo-db.json или C:\\path\\to\\elo\\db.json")
        .setValue(getResolvedIntegrationSourcePath("elo").slice(0, 500));

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
      return;
    }

    if (interaction.customId === "elo_panel_lookup") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const modal = new ModalBuilder().setCustomId("elo_panel_lookup_modal").setTitle("ELO lookup");
      const input = new TextInputBuilder()
        .setCustomId("elo_lookup_user")
        .setLabel("ID или mention игрока; пусто = показать себя")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(80)
        .setPlaceholder("123456789012345678 или <@123456789012345678>");

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
      return;
    }

    if (interaction.customId === "elo_panel_graphic") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const liveState = getLiveLegacyEloState();
      if (!liveState.ok) {
        await interaction.update(buildLegacyEloStateErrorPayload("Не удалось открыть legacy ELO PNG panel", liveState, false));
        return;
      }

      await interaction.update(buildLegacyEloGraphicPanelPayload(liveState.rawDb, "", false));
      return;
    }

    if (interaction.customId === "elo_panel_rebuild") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const liveState = getLiveLegacyEloState();
      if (!liveState.ok) {
        await interaction.reply(buildLegacyEloStateErrorPayload("Не удалось открыть legacy ELO базу", liveState));
        return;
      }

      await interaction.deferUpdate();
      try {
        const rebuilt = rebuildLegacyEloRatings(liveState.rawDb, { rebuiltAt: nowIso() });
        const roleSync = await syncLegacyEloTierRoles(client, liveState.rawDb, { reason: "legacy elo rebuild" });

        let boardUpdated = false;
        let syncResult = null;
        const refreshResult = await refreshLegacyEloGraphicBoard(client, { liveState });
        if (refreshResult?.ok) {
          boardUpdated = true;
          syncResult = refreshResult.syncResult;
        } else {
          syncResult = saveLiveLegacyEloStateAndResync(liveState);
        }

        await logLine(
          client,
          `ELO REBUILD: total=${rebuilt.total} retiered=${rebuilt.retiered} hidden=${rebuilt.hidden} clearedCards=${rebuilt.cleanup.clearedCards} png=${boardUpdated ? "updated" : "skipped"} by ${interaction.user.tag}`
        );

        await interaction.editReply(buildDormantEloPanelPayload(
          [
            `Legacy ELO rebuild завершён.`,
            `Проверено: ${rebuilt.total}.`,
            `Сменили tier: ${rebuilt.retiered}.`,
            `Скрыто как невалидные: ${rebuilt.hidden}.`,
            `Роли: assigned ${roleSync.assigned}, cleared ${roleSync.cleared}.`,
            `Legacy card links: ${rebuilt.cleanup.clearedCards}.`,
            `Legacy index link: ${rebuilt.cleanup.clearedIndexLink ? "да" : "нет"}.`,
            `PNG: ${boardUpdated ? "обновлён" : "не настроен или пропущен"}.`,
          ].join(" ") + getLegacyEloSyncStatusSuffix(syncResult),
          false
        ));
      } catch (error) {
        await interaction.editReply(buildDormantEloPanelPayload(String(error?.message || error || "Не удалось выполнить legacy ELO rebuild."), false));
      }
      return;
    }

    if (interaction.customId === "elo_panel_modset") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      clearLegacyEloManualModsetSession(interaction.user.id);
      setLegacyEloManualModsetSession(interaction.user.id, {
        channelId: interaction.channelId,
        stage: "awaiting_user",
      });

      await interaction.reply(ephemeralPayload({
        content: [
          `Ручной legacy ELO modset запущен в ${formatChannelMention(interaction.channelId) || "этом канале"}.`,
          "Вариант 1: отправь одним сообщением `@игрок 110` и приложи картинку.",
          "Вариант 2: сначала отправь `@игрок`, потом следующим сообщением пришли `110` и картинку.",
          "Картинка обязательна. Для отмены напиши `отмена`.",
        ].join("\n"),
      }));
      return;
    }

    if (interaction.customId === "elo_panel_channels") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const liveState = getLiveLegacyEloState();
      if (!liveState.ok) {
        await interaction.reply(buildLegacyEloStateErrorPayload("Не удалось открыть legacy ELO базу", liveState));
        return;
      }

      const submitPanel = getLegacyEloSubmitPanelState(liveState.rawDb);
      const graphicState = getResolvedIntegrationRecord("elo").graphicBoard || {};
      const modal = new ModalBuilder().setCustomId("elo_panel_channels_modal").setTitle("Каналы ELO");

      const submitInput = new TextInputBuilder()
        .setCustomId("elo_channel_submit")
        .setLabel("Submit Hub канал")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(80)
        .setPlaceholder("<#123456789012345678> или 123456789012345678")
        .setValue(String(submitPanel.channelId || "").slice(0, 80));

      const graphicInput = new TextInputBuilder()
        .setCustomId("elo_channel_graphic")
        .setLabel("Graphic board (PNG) канал")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(80)
        .setPlaceholder("<#123456789012345678> или 123456789012345678")
        .setValue(String(graphicState.channelId || "").slice(0, 80));

      modal.addComponents(
        new ActionRowBuilder().addComponents(submitInput),
        new ActionRowBuilder().addComponents(graphicInput)
      );
      await interaction.showModal(modal);
      return;
    }

    if (interaction.customId === "elo_panel_role_grant_toggle") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const willEnable = !isLegacyEloRoleGrantEnabled();
      setLegacyEloRoleGrantEnabled(willEnable);
      saveDb();

      let statusText = willEnable ? "Выдача ELO‑ролей включена." : "Выдача ELO‑ролей выключена.";

      if (willEnable) {
        const liveState = getLiveLegacyEloState();
        if (liveState.ok) {
          try {
            const result = await syncLegacyEloTierRoles(client, liveState.rawDb, { reason: "elo role grant toggle on" });
            if (result.skipped) {
              statusText += ` Sync пропущен: ${result.skipped}.`;
            } else {
              statusText += ` Sync: assigned ${result.assigned}, cleared ${result.cleared}.`;
            }
          } catch (error) {
            statusText += ` Ошибка sync: ${String(error?.message || error)}.`;
          }
        } else {
          statusText += " Legacy ELO db недоступна — sync пропущен.";
        }
      } else {
        try {
          const result = await revokeAllLegacyEloTierRoles(client, { reason: "elo role grant toggled off" });
          if (result.skipped) {
            statusText += ` Снятие пропущено: ${result.skipped}.`;
          } else {
            statusText += ` Снято ролей: ${result.removed} у ${result.processed} участников.${result.errors ? ` Ошибок: ${result.errors}.` : ""}`;
          }
        } catch (error) {
          statusText += ` Ошибка снятия ролей: ${String(error?.message || error)}.`;
        }
      }

      await interaction.editReply(buildDormantEloPanelPayload(statusText, false));
      return;
    }

    if (interaction.customId === "elo_panel_submit_setup") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const liveState = getLiveLegacyEloState();
      if (!liveState.ok) {
        await interaction.reply(buildLegacyEloStateErrorPayload("Не удалось открыть legacy ELO базу", liveState));
        return;
      }

      const submitPanel = getLegacyEloSubmitPanelState(liveState.rawDb);
      const modal = new ModalBuilder().setCustomId("elo_panel_submit_setup_modal").setTitle("Legacy ELO submit hub");
      const input = new TextInputBuilder()
        .setCustomId("elo_submit_channel")
        .setLabel("ID или mention текстового канала")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(80)
        .setPlaceholder("123456789012345678 или <#123456789012345678>")
        .setValue(String(submitPanel.channelId || ""));

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
      return;
    }

    if (interaction.customId === "elo_submit_open") {
      const liveState = getLiveLegacyEloState();
      if (!liveState.ok) {
        await interaction.reply(buildLegacyEloStateErrorPayload("Не удалось открыть legacy ELO данные", liveState));
        return;
      }

      const session = getLegacyEloSubmitSession(interaction.user.id);
      const submitPanel = getLegacyEloSubmitPanelState(liveState.rawDb);
      if (session) {
        await interaction.reply(buildLegacyEloSubmitAwaitPayload(session.channelId || submitPanel.channelId || interaction.channelId));
        return;
      }

      const blockReason = getLegacyEloSubmitEligibilityError(liveState.rawDb, interaction.user.id);
      if (blockReason) {
        await interaction.reply(ephemeralPayload({ content: blockReason }));
        return;
      }

      const modal = new ModalBuilder().setCustomId("elo_submit_modal").setTitle("ELO заявка");
      const textInput = new TextInputBuilder()
        .setCustomId("elo_submit_text")
        .setLabel("Текст с числом ELO")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1000)
        .setPlaceholder("Например 73 или мой elo 73");

      modal.addComponents(new ActionRowBuilder().addComponents(textInput));
      await interaction.showModal(modal);
      return;
    }

    if (interaction.customId === "elo_submit_card") {
      await interaction.reply(await buildLegacyEloMyCardPayload(client, interaction.user.id));
      return;
    }

    if (interaction.customId === "elo_submit_cancel") {
      clearLegacyEloSubmitSession(interaction.user.id);
      await interaction.reply(ephemeralPayload({ content: "Ок. Шаг отправки ELO отменён." }));
      return;
    }

    if (interaction.customId === "elo_review_open") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const modal = new ModalBuilder().setCustomId("elo_review_open_modal").setTitle("Открыть ELO заявку");
      const input = new TextInputBuilder()
        .setCustomId("elo_review_submission_id")
        .setLabel("ID submission")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(80)
        .setPlaceholder("Например MABC123XYZ");

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
      return;
    }

    if (interaction.customId === "elo_panel_remove") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const modal = new ModalBuilder().setCustomId("elo_panel_remove_modal").setTitle("Remove ELO player");
      const input = new TextInputBuilder()
        .setCustomId("elo_remove_user")
        .setLabel("ID или mention игрока")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(80)
        .setPlaceholder("123456789012345678 или <@123456789012345678>");

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
      return;
    }

    if (interaction.customId === "elo_panel_wipe") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const modal = new ModalBuilder().setCustomId("elo_panel_wipe_modal").setTitle("Wipe ELO rating");
      const modeInput = new TextInputBuilder()
        .setCustomId("elo_wipe_mode")
        .setLabel("Режим: soft или hard")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(10)
        .setPlaceholder("soft");
      const confirmInput = new TextInputBuilder()
        .setCustomId("elo_wipe_confirm")
        .setLabel("Подтверждение: WIPE")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(10)
        .setPlaceholder("WIPE");

      modal.addComponents(
        new ActionRowBuilder().addComponents(modeInput),
        new ActionRowBuilder().addComponents(confirmInput)
      );
      await interaction.showModal(modal);
      return;
    }

    const [eloReviewAction, eloReviewSubmissionId] = interaction.customId.split(":");
    if (["elo_review_approve", "elo_review_edit", "elo_review_reject"].includes(eloReviewAction) && eloReviewSubmissionId) {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const liveState = getLiveLegacyEloState();
      if (!liveState.ok) {
        await interaction.reply(buildLegacyEloStateErrorPayload("Не удалось открыть ELO review-заявку", liveState));
        return;
      }

      const submission = getLegacyEloSubmission(liveState.rawDb, eloReviewSubmissionId);
      if (!submission) {
        await interaction.reply(ephemeralPayload({ content: "Legacy ELO заявка не найдена." }));
        return;
      }

      if (submission.status !== "pending") {
        await interaction.reply(buildLegacyEloReviewPayload(eloReviewSubmissionId, `Заявка уже обработана: ${submission.status}.`));
        return;
      }

      if (isLegacyEloSubmissionExpired(submission, { pendingExpireHours: LEGACY_ELO_PENDING_EXPIRE_HOURS })) {
        const expired = expireLegacyEloSubmission(liveState.rawDb, eloReviewSubmissionId, { reviewedAt: nowIso() });
        saveLegacyEloDbFile(liveState.resolvedPath, expired.db);
        const syncWarning = getLegacyEloResyncWarning();
        await interaction.update(buildLegacyEloReviewChannelPayload(expired.submission, "expired"));
        if (syncWarning) {
          await interaction.followUp(ephemeralPayload({ content: `Заявка протухла и помечена expired.${syncWarning}` })).catch(() => {});
        }
        return;
      }

      if (eloReviewAction === "elo_review_approve") {
        try {
          const profileData = await getLegacyEloApprovalProfileData(client, submission.userId);
          const approved = approveLegacyEloSubmission(liveState.rawDb, eloReviewSubmissionId, {
            reviewedBy: interaction.user.tag,
            reviewedAt: nowIso(),
            displayName: profileData.displayName,
            username: profileData.username,
            avatarUrl: profileData.avatarUrl,
          });
          await syncLegacyEloTierRoles(client, liveState.rawDb, {
            targetUserId: submission.userId,
            reason: "legacy elo approve",
          });
          const persisted = await persistLegacyEloGraphicMutation(client, liveState, { refreshBoard: true });
          const syncWarning = `${getLegacyEloSyncStatusSuffix(persisted.syncResult)}${persisted.warning}`;
          await dmUser(
            client,
            submission.userId,
            [
              "Твоя ELO-заявка одобрена.",
              `ELO: ${approved.submission.elo}`,
              `Тир: ${approved.submission.tier}`,
              `Пруф: ${approved.rating.proofUrl || approved.submission.screenshotUrl || "—"}`,
            ].join("\n")
          );
          await logLine(client, `ELO APPROVE: <@${submission.userId}> elo ${approved.submission.elo} -> tier ${approved.submission.tier} (id ${approved.submission.id}) by ${interaction.user.tag}`);
          await interaction.update(buildLegacyEloReviewChannelPayload(approved.submission, "approved"));
          if (syncWarning) {
            await interaction.followUp(ephemeralPayload({ content: `Одобрено.${syncWarning}` })).catch(() => {});
          }
        } catch (error) {
          await interaction.reply(ephemeralPayload({ content: String(error?.message || error || "Не удалось одобрить ELO заявку.") }));
        }
        return;
      }

      if (eloReviewAction === "elo_review_edit") {
        const modal = new ModalBuilder().setCustomId(`elo_review_edit_modal:${eloReviewSubmissionId}`).setTitle("Edit ELO");
        const input = new TextInputBuilder()
          .setCustomId("elo_review_value")
          .setLabel("Новое ELO")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(submission.elo || ""))
          .setPlaceholder("Например 73");
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
        return;
      }

      if (eloReviewAction === "elo_review_reject") {
        const modal = new ModalBuilder().setCustomId(`elo_review_reject_modal:${eloReviewSubmissionId}`).setTitle("Reject reason");
        const input = new TextInputBuilder()
          .setCustomId("elo_review_reason")
          .setLabel("Причина отказа")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setPlaceholder("Коротко и по делу");
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
        return;
      }
    }

    if ([
      "panel_refresh_welcome",
      "panel_refresh_tierlists",
      "panel_sync_roles",
      "panel_cleanup_orphan_characters",
      "panel_remind_missing",
      "panel_refresh_summary",
      "panel_mode_normal",
      "panel_mode_wartime",
      "panel_access_grant_after_submit",
      "panel_access_grant_after_review_post",
      "panel_access_grant_after_approve",
    ].includes(interaction.customId)) {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      await interaction.deferUpdate();

      let statusText = "Сводка обновлена.";
      if (interaction.customId === "panel_refresh_welcome") {
        await refreshWelcomePanel(client);
        statusText = "Welcome-панель обновлена.";
      } else if (interaction.customId === "panel_refresh_tierlists") {
        await refreshAllTierlists(client);
        statusText = "Graphic-board и текстовый тир-лист обновлены.";
      } else if (interaction.customId === "panel_sync_roles") {
        const managed = await ensureManagedRoles(client);
        await maybeLogSotCharacterHealthAlert(client, "panel-sync-roles");
        const synced = await syncApprovedTierRoles(client);
        statusText = `Роли пересинхронизированы. Tier-профилей: ${synced}. Персонажи: resolved ${managed.resolvedCharacters}, recovered ${managed.recoveredCharacters}, ambiguous ${managed.ambiguousCharacters}, unresolved ${managed.unresolvedCharacters}.`;
      } else if (interaction.customId === "panel_cleanup_orphan_characters") {
        const result = await cleanupOrphanCharacterRoles(client);
        statusText = result.removed
          ? `Legacy orphan character bindings очищены: ${result.removed}.`
          : "Legacy orphan character bindings не найдены.";
      } else if (interaction.customId === "panel_remind_missing") {
        const result = await sendMissingTierlistReminder(client);
        statusText = `DM-рассылка завершена. Всего: ${result.total}, отправлено: ${result.sent}, не доставлено: ${result.failed}.`;
      } else if (interaction.customId === "panel_mode_normal") {
        const state = getOnboardModeState();
        state.mode = ONBOARD_ACCESS_MODES.NORMAL;
        state.changedAt = nowIso();
        state.changedBy = interaction.user.tag;
        saveDb();
        statusText = "Режим онбординга переключён на обычное время.";
      } else if (interaction.customId === "panel_mode_wartime") {
        const validationError = getOnboardModeValidationError(ONBOARD_ACCESS_MODES.WARTIME);
        if (validationError) {
          statusText = validationError;
        } else {
          const state = getOnboardModeState();
          state.mode = ONBOARD_ACCESS_MODES.WARTIME;
          state.changedAt = nowIso();
          state.changedBy = interaction.user.tag;
          saveDb();
          statusText = "Режим онбординга переключён на военное время.";
        }
      } else if (interaction.customId === "panel_access_grant_after_submit") {
        const state = getOnboardAccessGrantState();
        state.mode = ONBOARD_ACCESS_GRANT_MODES.AFTER_SUBMIT;
        state.changedAt = nowIso();
        state.changedBy = interaction.user.tag;
        saveDb();
        statusText = "Выдача стартовой роли переключена на режим: сразу после заявки.";
      } else if (interaction.customId === "panel_access_grant_after_review_post") {
        const state = getOnboardAccessGrantState();
        state.mode = ONBOARD_ACCESS_GRANT_MODES.AFTER_REVIEW_POST;
        state.changedAt = nowIso();
        state.changedBy = interaction.user.tag;
        saveDb();
        statusText = "Выдача стартовой роли переключена на режим: после публикации review-заявки.";
      } else if (interaction.customId === "panel_access_grant_after_approve") {
        const state = getOnboardAccessGrantState();
        state.mode = ONBOARD_ACCESS_GRANT_MODES.AFTER_APPROVE;
        state.changedAt = nowIso();
        state.changedBy = interaction.user.tag;
        saveDb();
        statusText = "Выдача стартовой роли переключена на режим: только после approve модератора.";
      }

      await interaction.editReply(await buildModeratorPanelPayload(client, statusText, false));
      return;
    }

    if (interaction.customId === "onboard_non_ggs_start") {
      try {
        await interaction.reply(buildNonGgsConfirmPayload());
      } catch (error) {
        console.error("onboard_non_ggs_start failed:", error);
        await respondToOnboardError(
          interaction,
          `Не удалось открыть non-JJS шаг: ${String(error?.message || error || "неизвестная ошибка").slice(0, 220)}`
        );
      }
      return;
    }

    if (interaction.customId === "onboard_non_ggs_cancel") {
      await interaction.update({
        content: "Ок. Оставил обычный путь входа без изменений.",
        embeds: [],
        components: [],
        attachments: [],
      });
      return;
    }

    if (interaction.customId === "onboard_non_ggs_confirm") {
      const member = await fetchMember(client, interaction.user.id);
      if (!member) {
        await interaction.update({
          content: "Не удалось получить твой профиль на сервере.",
          embeds: [],
          components: [],
          attachments: [],
        });
        return;
      }

      const captchaMode = getNonJjsCaptchaModeForMember(member);

      if (captchaMode.mode !== "practice" && !getNonJjsAccessRoleId()) {
        await interaction.update({
          content: "Отдельная роль для доступа без JJS ещё не настроена. Заполни `NON_JJS_ACCESS_ROLE_ID`, затем попробуй снова.",
          embeds: [],
          components: [],
          attachments: [],
        });
        return;
      }

      const pending = getPendingSubmissionForUser(interaction.user.id);
      if (pending && captchaMode.mode !== "practice") {
        await interaction.update({
          content: `У тебя уже есть pending-заявка с kills ${pending.kills}. Дождись решения модератора.`,
          embeds: [],
          components: [],
          attachments: [],
        });
        return;
      }

      if (captchaMode.mode !== "practice") {
        clearMainDraft(interaction.user.id);
        clearSubmitSession(interaction.user.id);
      }
      clearNonGgsCaptchaSession(interaction.user.id);

      try {
        setNonGgsCaptchaSession(interaction.user.id, createNonGgsCaptchaSession(null, 1, { mode: captchaMode.mode }));
        await interaction.update(await buildNonGgsCaptchaPayload(
          interaction.user.id,
          getNonJjsCaptchaStartText(captchaMode),
          { includeEphemeralFlag: false }
        ));
      } catch (error) {
        clearNonGgsCaptchaSession(interaction.user.id);
        await interaction.update({
          content: `Не удалось запустить JJS-капчу: ${String(error?.message || error || "неизвестная ошибка")}\nПапка с картинками: \`${NON_GGS_CAPTCHA_ASSET_DIR}\``,
          embeds: [],
          components: [],
          attachments: [],
        });
      }
      return;
    }

    if (interaction.customId === "onboard_begin") {
      try {
        clearNonGgsCaptchaSession(interaction.user.id);
        const session = getSubmitSession(interaction.user.id);
        const pending = getPendingSubmissionForUser(interaction.user.id);
        const draft = getMainDraft(interaction.user.id);
        const cooldownLeft = getSubmitCooldownLeftSeconds(interaction.user.id);
        const beginMember = interaction.member?.roles?.cache
          ? interaction.member
          : await fetchMember(client, interaction.user.id).catch(() => null);
        const accessResumeSession = !session && !pending && memberHasManagedStartAccessRole(beginMember)
          ? buildSubmitSessionBootstrap(interaction.user.id, beginMember)
          : null;
        const beginRoute = resolveOnboardBeginRoute({
          hasPendingProof: Boolean(session?.mainCharacterIds?.length && Number.isSafeInteger(session?.pendingKills) && session?.pendingScreenshotUrl),
          hasPendingMissingRoblox: Boolean(pending && (!pending.robloxUsername || !pending.robloxUserId)),
          hasPendingSubmission: Boolean(pending),
          hasResumableAccessSubmit: Boolean(accessResumeSession?.mainCharacterIds?.length),
          cooldownLeft,
          hasSubmitSession: Boolean(session),
          hasMainDraft: Boolean(draft?.characterIds?.length),
        });

        if (beginRoute.type === ONBOARD_BEGIN_ROUTES.REQUIRED_ROBLOX) {
          await interaction.reply(buildRobloxUsernameStepPayload(interaction.user.id, {
            required: true,
            noticeText: "Kills и скрин уже приняты. Осталось указать Roblox username, чтобы отправить заявку модераторам.",
          }));
          return;
        }

        if (beginRoute.type === ONBOARD_BEGIN_ROUTES.OPTIONAL_ROBLOX) {
          await interaction.reply(buildRobloxUsernameStepPayload(interaction.user.id, {
            required: false,
            mainCharacterIds: pending.mainCharacterIds,
            kills: pending.kills,
            noticeText: `У тебя уже есть pending-заявка с kills ${pending.kills}. Если хочешь, добавь Roblox username прямо сейчас.`,
          }));
          return;
        }

        if (beginRoute.type === ONBOARD_BEGIN_ROUTES.PENDING) {
          await interaction.reply(ephemeralPayload({
            content: `У тебя уже есть pending-заявка с kills ${pending.kills}. Дождись решения модератора.`,
          }));
          return;
        }

        if (beginRoute.type === ONBOARD_BEGIN_ROUTES.COOLDOWN) {
          await interaction.reply(ephemeralPayload({ content: `Подожди ещё ${cooldownLeft} сек. перед новой заявкой.` }));
          return;
        }

        if (beginRoute.type === ONBOARD_BEGIN_ROUTES.SUBMIT) {
          if (!session?.mainCharacterIds?.length && accessResumeSession?.mainCharacterIds?.length) {
            setSubmitSession(interaction.user.id, accessResumeSession);
          }

          const welcomeChannelId = getResolvedChannelId("welcome");
          if (!welcomeChannelId) {
            await interaction.reply(ephemeralPayload({
              content: "Ты уже на шаге подачи заявки. Welcome-канал пока не настроен, попроси модератора указать его через Onboarding Panel.",
            }));
            return;
          }

          await interaction.reply(buildSubmitStepPayload(interaction.user.id, {
            canManageRobloxIdentity: hasAdministratorAccess(interaction.member),
            noticeText: `Ты уже на шаге отправки kills. Проверь число и загрузи скрин в <#${welcomeChannelId}>.`,
          }));
          return;
        }

        if (beginRoute.type === ONBOARD_BEGIN_ROUTES.DRAFT) {
          setSubmitSession(interaction.user.id, { mainCharacterIds: draft.characterIds });
          clearMainDraft(interaction.user.id);
          await interaction.reply(buildSubmitStepPayload(interaction.user.id, {
            canManageRobloxIdentity: hasAdministratorAccess(interaction.member),
          }));
          return;
        }

        await openCharacterPicker(interaction, "full");
      } catch (error) {
        console.error("onboard_begin failed:", error?.message || error);
        await respondToOnboardError(
          interaction,
          `Не удалось открыть онбординг: ${String(error?.message || error || "неизвестная ошибка").slice(0, 220)}`
        );
      }
      return;
    }

    if (interaction.customId === "onboard_quick_mains") {
      clearNonGgsCaptchaSession(interaction.user.id);
      await openCharacterPicker(interaction, "quick");
      return;
    }

    if (interaction.customId === "onboard_change_mains") {
      await openCharacterPicker(interaction, "full", "update");
      return;
    }

    if (interaction.customId === "onboard_set_roblox_username") {
      const session = getSubmitSession(interaction.user.id);
      const pending = getPendingSubmissionForUser(interaction.user.id);
      if (!session?.mainCharacterIds?.length && !pending?.id) {
        await interaction.reply(ephemeralPayload({ content: "Сессия онбординга истекла. Нажми «Получить роль» заново." }));
        return;
      }

      const robloxIdentityLockText = getWelcomeRobloxIdentityLockText({
        session,
        pending,
        canManage: hasAdministratorAccess(interaction.member),
      });
      if (robloxIdentityLockText) {
        await interaction.reply(ephemeralPayload({ content: robloxIdentityLockText }));
        return;
      }

      await interaction.showModal(buildRobloxUsernameModal(
        "onboard_roblox_username_modal",
        session?.robloxUsername || pending?.robloxUsername || ""
      ));
      return;
    }

    if (interaction.customId === "onboard_picker_continue") {
      const picker = getMainsPickerSession(interaction.user.id);
      if (!picker) {
        await interaction.update(buildMainsPickerPayload(interaction.user.id, { includeEphemeralFlag: false }));
        return;
      }

      const selectedEntries = getSelectedCharacterEntries(picker.selectedIds);
      await completeMainSelection(interaction, selectedEntries, {
        mode: picker.mode,
        responseMethod: "update",
      });
      return;
    }

    if (interaction.customId === "onboard_cancel") {
      clearMainsPickerSession(interaction.user.id);
      clearMainDraft(interaction.user.id);
      clearSubmitSession(interaction.user.id);
      await interaction.update({ content: "Ок. Процесс отменён.", embeds: [], components: [] });
      return;
    }

    if (interaction.customId.startsWith("non_ggs_captcha_answer:")) {
      const selectedIndex = Number(interaction.customId.split(":")[1]);
      const session = getNonGgsCaptchaSession(interaction.user.id);

      if (!session?.challenge) {
        await interaction.update({
          content: "Капча истекла. Нажми кнопку «Я не играю в JJS» заново и начни сначала.",
          embeds: [],
          components: [],
          attachments: [],
        });
        return;
      }

      if (selectedIndex !== Number(session.challenge.correctIndex)) {
        try {
          setNonGgsCaptchaSession(interaction.user.id, createNonGgsCaptchaSession(session.challenge, 1, { mode: session.mode }));
          await interaction.update({
            ...(await buildNonGgsCaptchaPayload(interaction.user.id, "Ответ неправильный. Попробуй ещё раз: капча полностью сброшена на первый этап.")),
            attachments: [],
          });
        } catch (error) {
          clearNonGgsCaptchaSession(interaction.user.id);
          await interaction.update({
            content: `Не удалось пересобрать капчу: ${String(error?.message || error || "неизвестная ошибка")}`,
            embeds: [],
            components: [],
            attachments: [],
          });
        }
        return;
      }

      if (Number(session.stage) < NON_GGS_CAPTCHA_STAGES) {
        try {
          setNonGgsCaptchaSession(interaction.user.id, createNonGgsCaptchaSession(session.challenge, Number(session.stage) + 1, { mode: session.mode }));
          await interaction.update({
            ...(await buildNonGgsCaptchaPayload(interaction.user.id, "Верно. Первый этап пройден, теперь второй.")),
            attachments: [],
          });
        } catch (error) {
          clearNonGgsCaptchaSession(interaction.user.id);
          await interaction.update({
            content: `Не удалось открыть следующий этап капчи: ${String(error?.message || error || "неизвестная ошибка")}`,
            embeds: [],
            components: [],
            attachments: [],
          });
        }
        return;
      }

      try {
        if (session.mode === "practice") {
          clearNonGgsCaptchaSession(interaction.user.id);
          await interaction.update({
            content: "Капча пройдена. Это был тренировочный режим, роли и профиль не менялись.",
            embeds: [],
            components: [],
            attachments: [],
          });
          return;
        }

        const grantWartimeStarterRole = normalizeOnboardAccessMode(getCurrentOnboardMode()) === ONBOARD_ACCESS_MODES.WARTIME
          && Boolean(getWartimeAccessRoleId());
        let grantedWartimeStarterRole = false;

        if (grantWartimeStarterRole) {
          await grantAccessRole(client, interaction.user.id, "non-JJS captcha passed during wartime");
          grantedWartimeStarterRole = true;
        }

        try {
          await grantNonGgsAccessRole(client, interaction.user.id, "non-JJS captcha passed");
        } catch (error) {
          if (grantedWartimeStarterRole) {
            await revokeAccessRole(client, interaction.user.id, "rollback wartime starter role after non-JJS grant failure").catch((rollbackError) => {
              console.warn(`Rollback wartime starter role failed for ${interaction.user.id}: ${formatRuntimeError(rollbackError)}`);
            });
          }
          throw error;
        }

        clearNonGgsCaptchaSession(interaction.user.id);

        const profile = getProfile(interaction.user.id);
        if (grantedWartimeStarterRole) {
          profile.accessGrantedAt = profile.accessGrantedAt || nowIso();
        }
        profile.nonGgsAccessGrantedAt = profile.nonGgsAccessGrantedAt || nowIso();
        profile.nonGgsCaptchaPassedAt = nowIso();
        profile.updatedAt = nowIso();
        saveDb();

        await logLine(
          client,
          grantedWartimeStarterRole
            ? `NON_JJS_ACCESS: <@${interaction.user.id}> passed captcha and received separate no-JJS role plus wartime starter role`
            : `NON_JJS_ACCESS: <@${interaction.user.id}> passed captcha and received separate no-JJS role`
        );

        await interaction.update({
          content: grantedWartimeStarterRole
            ? "Готово. Капча пройдена: тебе выдана отдельная роль доступа для тех, кто не играет в JJS, и военная стартовая роль текущего режима."
            : "Готово. Капча пройдена, тебе выдана отдельная роль доступа для тех, кто не играет в JJS.",
          embeds: [],
          components: [],
          attachments: [],
        });
      } catch (error) {
        clearNonGgsCaptchaSession(interaction.user.id);
        await interaction.update({
          content: `Капча пройдена, но роль выдать не удалось: ${String(error?.message || error || "неизвестная ошибка")}`,
          embeds: [],
          components: [],
          attachments: [],
        });
      }
      return;
    }

    const [action, submissionId] = interaction.customId.split(":");
    if (["approve", "edit", "reject"].includes(action) && submissionId) {
      const submission = db.submissions[submissionId];

      if (!submission) {
        await interaction.reply(ephemeralPayload({ content: "Заявка не найдена." }));
        return;
      }

      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      if (submission.status !== "pending") {
        await interaction.reply(ephemeralPayload({ content: `Заявка уже обработана: ${submission.status}.` }));
        return;
      }

      if (hoursSince(submission.createdAt) > PENDING_EXPIRE_HOURS) {
        await expireSubmission(client, submission);
        await interaction.reply(ephemeralPayload({ content: "Заявка уже истекла и была помечена как expired." }));
        return;
      }

      if (action === "approve") {
        await approveSubmission(client, submission, interaction.user.tag);
        await interaction.reply(ephemeralPayload({ content: "Заявка одобрена. Tier-role выдана." }));
        return;
      }

      if (action === "edit") {
        const modal = new ModalBuilder().setCustomId(`edit_kills:${submissionId}`).setTitle("Edit kills");
        const input = new TextInputBuilder()
          .setCustomId("kills")
          .setLabel("Новое точное количество kills")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(submission.kills))
          .setPlaceholder("Например 3120");
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
        return;
      }

      if (action === "reject") {
        const modal = new ModalBuilder().setCustomId(`reject_reason:${submissionId}`).setTitle("Reject reason");
        const input = new TextInputBuilder()
          .setCustomId("reason")
          .setLabel("Причина отказа")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setPlaceholder("Коротко и по делу");
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
        return;
      }
    }
  }

  // ── Combo guide buttons ──
  if (interaction.isButton()) {
    if (interaction.customId === "combo_panel_refresh_nav") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      if (!db.comboGuide || !db.comboGuide.channelId) {
        await interaction.reply(ephemeralPayload({ content: "Гайд ещё не опубликован." }));
        return;
      }

      await interaction.deferUpdate();
      try {
        const guideChannel = await client.channels.fetch(db.comboGuide.channelId);
        await refreshNavigation({ channel: guideChannel, guideState: db.comboGuide });
        saveDb();
        await interaction.editReply(buildComboPanelForMember(interaction.member, "Навигация обновлена."));
      } catch (error) {
        await interaction.editReply(buildComboPanelForMember(interaction.member, `Ошибка: ${error.message}`));
      }
      return;
    }

    if (interaction.customId === "combo_panel_republish") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      await interaction.reply(ephemeralPayload({
        content: "Для полного перезалива используй `/combo publish` с файлами. Старые сообщения будут удалены автоматически, если канал совпадает.",
      }));
      return;
    }

    if (interaction.customId === "combo_panel_pick_editor_role") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      setRolePanelPicker(interaction.user.id, {
        scope: ROLE_PANEL_PICKER_SCOPES.COMBO_GUIDE_EDITOR_ROLE,
        query: "",
        page: 0,
      });
      await interaction.update(await buildRolePanelPickerPayload(client, interaction.user.id, "Показываю все роли сервера.", false));
      return;
    }

    if (interaction.customId === "combo_panel_clear_editor_roles") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const guideState = ensureComboGuideAccessState();
      guideState.editorRoleIds = [];
      saveDb();
      await interaction.update(buildComboPanelForMember(interaction.member, "Дополнительный доступ очищен."));
      return;
    }

    if (interaction.customId.startsWith("combo_panel_remove_char:")) {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const charId = interaction.customId.split(":")[1];
      if (!db.comboGuide || !db.comboGuide.channelId) {
        await interaction.reply(ephemeralPayload({ content: "Гайд не найден." }));
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const guideChannel = await client.channels.fetch(db.comboGuide.channelId);
        await removeCharacterFromGuide({
          channel: guideChannel,
          guideState: db.comboGuide,
          characterId: charId,
        });
        saveDb();
        await interaction.editReply({ content: `Персонаж удалён. Осталось: ${db.comboGuide.characters.length}.` });
      } catch (error) {
        await interaction.editReply({ content: `Не удалось удалить персонажа: ${error.message}` });
      }
      return;
    }
  }

  if (interaction.isStringSelectMenu()) {
    if (await handleAntiteamInteractionSafely(interaction, "handleSelectMenuInteraction")) {
      return;
    }

    if (interaction.customId === "rolepanel_picker_select") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const picker = getRolePanelPicker(interaction.user.id);
      if (!picker) {
        await interaction.update(buildRolePanelHomePayload("Сессия выбора истекла. Открой выбор заново.", false));
        return;
      }

      const selectedId = String(interaction.values?.[0] || "").trim();
      const statusText = await selectRolePanelPickerValue(client, interaction.user.id, picker.scope, selectedId);
      clearRolePanelPicker(interaction.user.id);
      await interaction.update(buildRolePanelPickerReturnPayload(interaction.user.id, picker.scope, statusText, false));
      return;
    }

    if (interaction.customId === "select_main") {
      const liveState = getLiveLegacyTierlistState();
      if (!liveState.ok) {
        await interaction.reply(buildLegacyTierlistStateErrorPayload("Не удалось открыть legacy Tierlist state", liveState));
        return;
      }

      const mainSync = await syncLegacyTierlistMainsForInteraction(client, liveState, interaction);
      if (mainSync.changed) persistLiveLegacyTierlistState(liveState);
      await interaction.update(buildLegacyTierlistStartPayload(liveState, interaction.user.id, "Ручной выбор main больше не используется. Мейны берутся из ролей."));
      return;
    }

    if (interaction.customId === "point_rate_select") {
      const liveState = getLiveLegacyTierlistState();
      if (!liveState.ok) {
        await interaction.reply(buildLegacyTierlistStateErrorPayload("Не удалось открыть legacy Tierlist state", liveState));
        return;
      }

      const mainSync = await syncLegacyTierlistMainsForInteraction(client, liveState, interaction);
      if (mainSync.changed) persistLiveLegacyTierlistState(liveState);

      const user = getLegacyTierlistWizardUser(liveState.rawState, interaction.user.id);
      if (!hasSubmittedLegacyTierlist(liveState.rawState, interaction.user.id)) {
        await interaction.update({ content: "Сначала отправь полный тир-лист кнопкой Начать оценку.", embeds: [], components: [], attachments: [] });
        return;
      }

      if (Array.isArray(user.wizQueue) && user.wizQueue.length) {
        await interaction.deferUpdate();
        await interaction.editReply(await buildLegacyTierlistWizardPayload(liveState, interaction.user.id));
        return;
      }

      const selectedIds = [...new Set((interaction.values || []).map((value) => String(value || "").trim()).filter(Boolean))];
      if (!selectedIds.length) {
        await interaction.update(buildLegacyTierlistPointRatePayload(liveState, interaction.user.id, "Выбери хотя бы одного персонажа."));
        return;
      }

      startLegacyTierlistWizard(liveState, interaction.user.id, "targeted", selectedIds);
      const startedUser = getLegacyTierlistWizardUser(liveState.rawState, interaction.user.id);
      if (!Array.isArray(startedUser.wizQueue) || !startedUser.wizQueue.length) {
        await interaction.update(buildLegacyTierlistPointRatePayload(liveState, interaction.user.id, "Не удалось собрать очередь для точечной оценки."));
        return;
      }

      persistLiveLegacyTierlistState(liveState);
      await interaction.deferUpdate();
      await interaction.editReply(await buildLegacyTierlistWizardPayload(liveState, interaction.user.id));
      return;
    }

    if (interaction.customId === "panel_select_tier") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const liveState = getLiveLegacyTierlistState();
      if (!liveState.ok) {
        await interaction.reply(buildLegacyTierlistStateErrorPayload("Не удалось открыть legacy Tierlist panel", liveState));
        return;
      }

      const user = getLegacyTierlistWizardUser(liveState.rawState, interaction.user.id);
      user.panelTierKey = String(interaction.values?.[0] || "S").trim() || "S";
      persistLiveLegacyTierlistState(liveState);
      await interaction.update(buildLegacyTierlistModPanelPayload(liveState, interaction.user.id));
      return;
    }

    if (interaction.customId === "panel_part_select_user") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const liveState = getLiveLegacyTierlistState();
      if (!liveState.ok) {
        await interaction.reply(buildLegacyTierlistStateErrorPayload("Не удалось открыть legacy Tierlist panel", liveState));
        return;
      }

      const user = getLegacyTierlistWizardUser(liveState.rawState, interaction.user.id);
      user.panelTab = "participants";
      user.panelParticipantId = String(interaction.values?.[0] || "").trim() || null;
      user.panelDeleteTargetId = null;
      user.panelDeleteMode = null;
      persistLiveLegacyTierlistState(liveState);
      await interaction.update(buildLegacyTierlistModPanelPayload(liveState, interaction.user.id));
      return;
    }

    // ── Combo guide select menus ──
    if (interaction.customId === "combo_select_character") {
      if (!hasComboGuidePanelAccess(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const charId = interaction.values[0];
      if (charId === "__general_techs__") {
        await interaction.reply(ephemeralPayload(buildMessageSelectPayload("__general_techs__", db.comboGuide, {
          canManage: isModerator(interaction.member),
        })));
      } else {
        const charState = (db.comboGuide?.characters || []).find((c) => c.id === charId);
        if (!charState) {
          await interaction.reply(ephemeralPayload({ content: "Персонаж не найден в базе." }));
          return;
        }
        await interaction.reply(ephemeralPayload(buildMessageSelectPayload(charState, db.comboGuide, {
          canManage: isModerator(interaction.member),
        })));
      }
      return;
    }

    if (interaction.customId === "combo_select_message") {
      if (!hasComboGuidePanelAccess(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const value = interaction.values[0]; // "combo:msgId" or "tech:msgId:threadId" or "general_tech:msgId"
      const parts = value.split(":");
      const type = parts[0];
      const msgId = parts[1];
      const threadId = parts[2] || null;

      try {
        let targetChannel;
        if (threadId) {
          targetChannel = await client.channels.fetch(threadId).catch(() => null);
        }
        if (!targetChannel && db.comboGuide?.channelId) {
          targetChannel = await client.channels.fetch(db.comboGuide.channelId);
        }
        if (type === "general_tech" && db.comboGuide?.generalTechsThreadId) {
          targetChannel = await client.channels.fetch(db.comboGuide.generalTechsThreadId).catch(() => targetChannel);
        }

        if (!targetChannel) {
          await interaction.reply(ephemeralPayload({ content: "Канал не найден." }));
          return;
        }

        const msg = await targetChannel.messages.fetch(msgId);
        const modal = buildEditModal(msgId, msg.content);

        // Store thread context for the modal handler
        if (!interaction.client._comboEditCtx) interaction.client._comboEditCtx = new Map();
        interaction.client._comboEditCtx.set(interaction.user.id, {
          msgId,
          threadId: threadId || (type === "general_tech" ? db.comboGuide?.generalTechsThreadId : null),
          channelId: db.comboGuide?.channelId,
        });

        await interaction.showModal(modal);
      } catch (error) {
        await interaction.reply(ephemeralPayload({ content: `Не удалось загрузить сообщение: ${error.message}` }));
      }
      return;
    }

    if (interaction.customId === "rolepanel_records_select") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const recordId = String(interaction.values?.[0] || "").trim();
      setRoleRecordSelection(interaction.user.id, recordId);
      await interaction.update(buildRolePanelRecordsPayload(interaction.user.id, `Выбрано сообщение ${recordId}.`, false));
      return;
    }

    if (interaction.customId === "rolepanel_records_autoresend") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      await interaction.deferUpdate();

      const selection = getRoleRecordSelection(interaction.user.id);
      if (!selection?.recordId) {
        await interaction.editReply(buildRolePanelRecordsPayload(interaction.user.id, "Сначала выбери сообщение.", false));
        return;
      }

      // Write directly to the actual db entry so saveDb() persists the change
      const actualRecord = getRoleGrantRecord(selection.recordId);
      if (!actualRecord) {
        await interaction.editReply(buildRolePanelRecordsPayload(interaction.user.id, "Запись не найдена.", false));
        return;
      }

      const intervalMs = Number(interaction.values?.[0]) || 0;
      actualRecord.autoResendIntervalMs = intervalMs;
      if (intervalMs > 0 && !actualRecord.lastAutoResendAt) {
        actualRecord.lastAutoResendAt = nowIso();
      }
      if (intervalMs === 0) {
        actualRecord.lastAutoResendAt = "";
      }
      saveDb();
      const label = getAutoResendIntervalLabel(intervalMs);
      await interaction.editReply(buildRolePanelRecordsPayload(interaction.user.id, `Авто-переотправка: ${label}.`, false));
      return;
    }

    if (interaction.customId === "rolepanel_compose_autoresend") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const intervalMs = Number(interaction.values?.[0]) || 0;
      setRolePanelDraft(interaction.user.id, { autoResendIntervalMs: intervalMs });
      const label = getAutoResendIntervalLabel(intervalMs);
      await interaction.update(buildRolePanelComposerPayload(interaction.user.id, `Авто-переотправка: ${label}.`, false));
      return;
    }

    if (interaction.customId === "rolepanel_compose_button_select_remove") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const idx = Number(interaction.values?.[0]);
      const draft = ensureRolePanelDraft(interaction.user.id);
      const buttons = Array.isArray(draft.buttons) ? [...draft.buttons] : [];
      if (idx >= 0 && idx < buttons.length) {
        const removed = buttons.splice(idx, 1)[0];
        setRolePanelDraft(interaction.user.id, { buttons });
        await interaction.update(buildRolePanelComposerPayload(interaction.user.id, `Кнопка ${idx + 1} (${removed.label}) удалена.`, false));
      } else {
        await interaction.update(buildRolePanelComposerPayload(interaction.user.id, "Кнопка не найдена.", false));
      }
      return;
    }

    if (interaction.customId === "rolepanel_compose_button_select_edit") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const idx = Number(interaction.values?.[0]);
      const draft = ensureRolePanelDraft(interaction.user.id);
      const buttons = Array.isArray(draft.buttons) ? draft.buttons : [];

      if (idx < 0 || idx >= buttons.length) {
        await interaction.update(buildRolePanelComposerPayload(interaction.user.id, "Кнопка не найдена.", false));
        return;
      }

      setRolePanelDraft(interaction.user.id, { editingButtonIndex: idx });
      const btn = buttons[idx];

      const payload = {
        embeds: [new EmbedBuilder()
          .setTitle(`Role Panel • Кнопка ${idx + 1}`)
          .setDescription(`Что хочешь изменить в кнопке «${btn.label || DEFAULT_ROLE_PANEL_BUTTON_LABEL}» (→ ${formatRoleMention(btn.roleId)})?`)],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("rolepanel_compose_edit_button_label").setLabel("Изменить подпись").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("rolepanel_compose_edit_button_role").setLabel("Изменить роль").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("rolepanel_compose_back_from_button_select").setLabel("Назад").setStyle(ButtonStyle.Secondary)
          ),
        ],
      };
      await interaction.update(payload);
      return;
    }

    if (interaction.customId === "graphic_panel_select_tier") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }
      await commitMutation({
        mutate: () => {
          getGraphicTierlistConfig().panel.selectedTier = Number(interaction.values[0]) || 5;
        },
        persist: saveDb,
      });
      await interaction.update(buildGraphicPanelPayload());
      return;
    }

    if (interaction.customId === "elo_graphic_panel_select_tier") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const liveState = getLiveLegacyEloState();
      if (!liveState.ok) {
        await interaction.reply(buildLegacyEloStateErrorPayload("Не удалось открыть legacy ELO PNG panel", liveState));
        return;
      }

      setLegacyEloGraphicSelectedTier(liveState.rawDb, Number(interaction.values?.[0]) || 5);
      const syncResult = saveLiveLegacyEloStateAndResync(liveState);
      await interaction.update(buildLegacyEloGraphicPanelPayload(
        liveState.rawDb,
        `Выбран тир ${buildLegacyEloGraphicPanelSnapshot(liveState.rawDb).selectedTier}.${getLegacyEloSyncStatusSuffix(syncResult)}`,
        false
      ));
      return;
    }

    if (interaction.customId === "onboard_picker_select") {
      const picker = getMainsPickerSession(interaction.user.id);
      if (!picker) {
        await interaction.update(buildMainsPickerPayload(interaction.user.id, { includeEphemeralFlag: false }));
        return;
      }

      const nextSelectedIds = [...new Set(
        (interaction.values || []).map(getCharacterIdFromSelectValue).filter(Boolean)
      )].slice(0, 2);

      setMainsPickerSession(interaction.user.id, { selectedIds: nextSelectedIds });
      await interaction.update(buildMainsPickerPayload(interaction.user.id, {
        includeEphemeralFlag: false,
      }));
      return;
    }

    if (!["onboard_pick_characters", "onboard_pick_characters_quick"].includes(interaction.customId)) return;

    const isQuickSelection = interaction.customId === "onboard_pick_characters_quick";
    const selectedIds = [...new Set((interaction.values || []).map(getCharacterIdFromSelectValue).filter(Boolean))];
    const selectedEntries = getSelectedCharacterEntries(selectedIds);

    await completeMainSelection(interaction, selectedEntries, {
      mode: isQuickSelection ? "quick" : "full",
      responseMethod: isQuickSelection ? "reply" : "update",
    });
    return;
  }

  if (interaction.isModalSubmit()) {
    if (await handleAntiteamInteractionSafely(interaction, "handleModalSubmitInteraction")) {
      return;
    }

    if (await handleVerificationPanelModalSubmitInteraction({
      interaction,
      client,
      isModerator,
      replyNoPermission: (currentInteraction) => currentInteraction.reply(ephemeralPayload({ content: "Нет прав." })),
      buildPanelReply: (view, statusText) => buildVerificationPanelReply(view, statusText, false),
      getCurrentIntegration: getVerificationIntegrationState,
      parseBooleanInput: parseVerificationBooleanInput,
      parseListInput: parseVerificationListInput,
      parseRequestedRoleId,
      parseRequestedChannelId,
      resolveRequestedRoleId: (value, fallbackRoleId = "") => resolveRequestedRoleIdFromGuild(client, value, fallbackRoleId),
      resolveRequestedChannelId: (value, fallbackChannelId = "") => resolveRequestedChannelIdFromGuild(client, value, fallbackChannelId),
      parseRequestedUserId,
      cleanText: cleanVerificationText,
      nowIso,
      writeIntegrationSnapshot: (patch) => writeNativeIntegrationSnapshot(db, { slot: "verification", patch }),
      writeVerifyRole: (roleId) => writeNativeRoleRecord(db, { slot: "verifyAccess", roleId }),
      clearVerifyRole: () => clearNativeRoleRecord(db, { slot: "verifyAccess" }),
      saveDb,
      startRuntime: startVerificationRuntime,
      ensureEntryMessage: ensureVerificationEntryMessage,
      ensurePendingProfile: ensureVerificationPendingProfile,
      postManualReport: postVerificationManualReport,
      updateProfile: updateVerificationProfile,
      computeReportDueAt: computeVerificationReportDueAt,
    })) {
      return;
    }

    if (["onboard_manual_mains_modal", "onboard_manual_mains_quick_modal"].includes(interaction.customId)) {
      const mode = interaction.customId === "onboard_manual_mains_quick_modal" ? "quick" : "full";
      const mainsText = interaction.fields.getTextInputValue("mains");
      const resolution = resolveCharacterSelectionFromText(mainsText);

      if (resolution.error) {
        await interaction.reply(ephemeralPayload({ content: resolution.error }));
        return;
      }

      await completeMainSelection(interaction, resolution.entries, {
        mode,
        responseMethod: getMainsPickerSession(interaction.user.id) ? "update" : "reply",
      });
      return;
    }

    if (interaction.customId === "onboard_roblox_username_modal") {
      const session = getSubmitSession(interaction.user.id);
      const pending = getPendingSubmissionForUser(interaction.user.id);
      if (!session?.mainCharacterIds?.length && !pending?.id) {
        await interaction.reply(ephemeralPayload({ content: "Сессия онбординга истекла. Нажми «Получить роль» заново." }));
        return;
      }

      const robloxIdentityLockText = getWelcomeRobloxIdentityLockText({
        session,
        pending,
        canManage: hasAdministratorAccess(interaction.member),
      });
      if (robloxIdentityLockText) {
        await interaction.reply(ephemeralPayload({ content: robloxIdentityLockText }));
        return;
      }

      const robloxUsernameInput = interaction.fields.getTextInputValue("roblox_username");
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      let robloxUser = null;
      try {
        robloxUser = await resolveRobloxUserByUsername(robloxUsernameInput);
      } catch (error) {
        await interaction.editReply(String(error?.message || error || "Не удалось проверить Roblox username."));
        return;
      }

      if (!robloxUser) {
        await interaction.editReply("Такой Roblox username не найден через Roblox API. Проверь написание и попробуй ещё раз.");
        return;
      }

      const currentAccessGrantMode = getCurrentOnboardAccessGrantMode();
      const hasPendingProof = Boolean(
        session?.mainCharacterIds?.length
        && Number.isSafeInteger(session?.pendingKills)
        && session?.pendingScreenshotUrl
      );

      if (hasPendingProof) {
        const accessRoleIds = getManagedStartAccessRoleIds();
        const previousProfile = cloneJsonValue(db.profiles?.[interaction.user.id]);
        const hadProfile = Boolean(db.profiles?.[interaction.user.id]);
        const hadCooldown = Object.prototype.hasOwnProperty.call(db.cooldowns || {}, interaction.user.id);
        const previousCooldown = hadCooldown ? db.cooldowns[interaction.user.id] : undefined;
        const accessMember = await fetchMember(client, interaction.user.id);
        const previousAccessRoleIds = getRolePoolSnapshot(accessMember, accessRoleIds);
        let submission = null;

        try {
          if (currentAccessGrantMode === ONBOARD_ACCESS_GRANT_MODES.AFTER_SUBMIT) {
            await maybeGrantAccessRoleAtStage(client, interaction.user.id, ONBOARD_ACCESS_GRANT_MODES.AFTER_SUBMIT, "newcomer application submitted");
          }

          submission = await createPendingSubmissionFromAttachment(client, {
            user: interaction.user,
            member: interaction.member,
            mainCharacterIds: session.mainCharacterIds,
            kills: session.pendingKills,
            robloxUsername: robloxUser.name,
            robloxUserId: robloxUser.id,
            robloxDisplayName: robloxUser.displayName,
            screenshotUrl: session.pendingScreenshotUrl,
          });

          if (currentAccessGrantMode === ONBOARD_ACCESS_GRANT_MODES.AFTER_REVIEW_POST) {
            await maybeGrantAccessRoleAtStage(client, interaction.user.id, ONBOARD_ACCESS_GRANT_MODES.AFTER_REVIEW_POST, "newcomer application moved to moderator review");
            saveDb();
          }
        } catch (error) {
          if (submission?.id) {
            delete db.submissions[submission.id];
            restoreRecordValue(db.profiles, interaction.user.id, previousProfile, hadProfile);
            restoreRecordValue(db.cooldowns, interaction.user.id, previousCooldown, hadCooldown);
            saveDb();
            await deleteTrackedMessage(
              client,
              submission.reviewChannelId,
              submission.reviewMessageId,
              `review-сообщение ${submission.id}`
            ).catch((deleteError) => {
              console.warn(`Submit outer rollback message cleanup failed for ${submission.id}: ${formatRuntimeError(deleteError)}`);
            });
          } else {
            restoreRecordValue(db.profiles, interaction.user.id, previousProfile, hadProfile);
            restoreRecordValue(db.cooldowns, interaction.user.id, previousCooldown, hadCooldown);
          }

          await restoreRolePoolSnapshot(
            client,
            interaction.user.id,
            accessRoleIds,
            previousAccessRoleIds,
            "submit rollback"
          ).catch((restoreError) => {
            console.error(`Submit access-role rollback failed for ${interaction.user.id}: ${formatRuntimeError(restoreError)}`);
          });

          await interaction.editReply(String(error?.message || error || "Не удалось отправить заявку."));
          return;
        }

        clearSubmitSession(interaction.user.id);
        await logLine(client, `SUBMIT: <@${interaction.user.id}> kills ${session.pendingKills} mains=${session.mainCharacterIds.join(",")} with roblox ${robloxUser.name}`).catch((error) => {
          console.warn(`Submit log failed for ${interaction.user.id}: ${formatRuntimeError(error)}`);
        });

        await interaction.editReply(
          currentAccessGrantMode === ONBOARD_ACCESS_GRANT_MODES.AFTER_APPROVE
            ? `Roblox username подтверждён: **${robloxUser.name}** (ID ${robloxUser.id}). Заявка ушла модераторам. Стартовая роль будет выдана после approve.`
            : `Roblox username подтверждён: **${robloxUser.name}** (ID ${robloxUser.id}). Заявка ушла модераторам.`
        );
        return;
      }

      if (pending) {
        try {
          await updatePendingSubmissionRobloxIdentity(client, pending, robloxUser);
        } catch (error) {
          await interaction.editReply(String(error?.message || error || "Не удалось обновить pending-заявку."));
          return;
        }

        clearSubmitSession(interaction.user.id);
        await logLine(client, `ROBLOX UPDATE: <@${interaction.user.id}> -> ${robloxUser.name} (${robloxUser.id}) for ${pending.id}`).catch((error) => {
          console.warn(`Roblox update log failed for ${pending.id}: ${formatRuntimeError(error)}`);
        });
        await interaction.editReply(`Roblox username подтверждён: **${robloxUser.name}** (ID ${robloxUser.id}). Pending-заявка обновлена.`);
        return;
      }

      setSubmitSession(interaction.user.id, {
        ...session,
        robloxUsername: robloxUser.name,
        robloxUserId: robloxUser.id,
        robloxDisplayName: robloxUser.displayName,
      });

      await interaction.editReply(buildSubmitStepPayload(interaction.user.id, {
        canManageRobloxIdentity: hasAdministratorAccess(interaction.member),
        includeEphemeralFlag: false,
        noticeText: `Roblox username подтверждён: **${robloxUser.name}** (ID ${robloxUser.id}).`,
      }));
      return;
    }

    if (await handleSotReportModalSubmitInteraction({
      interaction,
      client,
      isModerator,
      replyNoPermission: () => interaction.reply(ephemeralPayload({ content: "Нет прав." })),
      replyError: (_interaction, text) => interaction.reply(ephemeralPayload({ content: text })),
      replyWithGroundTruthSotReport,
      parseRequestedRoleId,
      parseRequestedChannelId,
      normalizeSotReportChannelSlot,
      normalizeNativeRoleSlot,
      getConfiguredManagedCharacterCatalog,
      getManagedCharacterCatalog,
      clearNativeCharacterRecord: (options) => clearNativeCharacterRecord(db, options),
      writeNativeCharacterRecord: (options) => writeNativeCharacterRecord(db, options),
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
      clearNativeRoleRecord: (options) => clearNativeRoleRecord(db, options),
      writeNativeRoleRecord: (options) => writeNativeRoleRecord(db, options),
    })) {
      return;
    }

    if (await handleActivityPanelModalSubmitInteraction({
      interaction,
      db,
      isModerator: hasActivityPanelAccess,
      replyNoPermission: () => interaction.reply(ephemeralPayload({ content: "Нет прав." })),
      replyError: (_interaction, text) => interaction.reply(ephemeralPayload({ content: text })),
      replySuccess: (_interaction, text) => interaction.reply(ephemeralPayload({ content: text })),
      parseRequestedUserId,
      parseRequestedRoleId,
      parseRequestedChannelId,
      resolveMemberRoleIds: (userId) => resolveActivityMemberRoleIds(client, userId, interaction.guild || null),
      resolveChannel: async (channelId) => {
        const guild = interaction.guild || await getGuild(client).catch(() => null);
        const cachedChannel = guild?.channels?.cache?.get(channelId) || client.channels?.cache?.get?.(channelId) || null;
        if (cachedChannel) return cachedChannel;
        return client.channels.fetch(channelId).catch(() => null);
      },
      saveDb,
      runSerialized: runSerializedDbTask,
    })) {
      return;
    }

    // ── Combo guide edit modal ──
    if (interaction.customId?.startsWith("combo_edit_message:")) {
      if (!hasComboGuidePanelAccess(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const msgId = interaction.customId.replace("combo_edit_message:", "");
      const newContent = interaction.fields.getTextInputValue("content");

      if (newContent.length > 2000) {
        await interaction.reply(ephemeralPayload({
          content: `Слишком длинное сообщение: ${newContent.length}/2000 символов. Сократи текст.`,
        }));
        return;
      }

      const ctx = interaction.client._comboEditCtx?.get(interaction.user.id);

      try {
        let targetChannel;
        if (ctx?.threadId) {
          targetChannel = await client.channels.fetch(ctx.threadId).catch(() => null);
        }
        if (!targetChannel && ctx?.channelId) {
          targetChannel = await client.channels.fetch(ctx.channelId).catch(() => null);
        }
        if (!targetChannel && db.comboGuide?.channelId) {
          targetChannel = await client.channels.fetch(db.comboGuide.channelId);
        }

        const msg = await targetChannel.messages.fetch(msgId);
        await msg.edit({ content: newContent });

        await interaction.reply(ephemeralPayload({ content: "✅ Сообщение обновлено." }));
      } catch (error) {
        await interaction.reply(ephemeralPayload({ content: `Ошибка: ${error.message}` }));
      }

      interaction.client._comboEditCtx?.delete(interaction.user.id);
      return;
    }
    if (interaction.customId === "rolepanel_compose_plain_modal") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const content = interaction.fields.getTextInputValue("content").trim();
      if (!content) {
        await interaction.reply(ephemeralPayload({ content: "Текст сообщения не может быть пустым." }));
        return;
      }

      setRolePanelDraft(interaction.user.id, { format: ROLE_PANEL_FORMATS.PLAIN, content });
      await interaction.reply(buildRolePanelComposerPayload(interaction.user.id, "Текст сообщения обновлён."));
      return;
    }

    if (interaction.customId === "rolepanel_compose_embed_modal") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const embedTitle = interaction.fields.getTextInputValue("embed_title").trim();
      const embedDescription = interaction.fields.getTextInputValue("embed_description").trim();
      if (!embedTitle && !embedDescription) {
        await interaction.reply(ephemeralPayload({ content: "Заполни хотя бы заголовок или текст embed." }));
        return;
      }

      setRolePanelDraft(interaction.user.id, {
        format: ROLE_PANEL_FORMATS.EMBED,
        embedTitle,
        embedDescription,
      });
      await interaction.reply(buildRolePanelComposerPayload(interaction.user.id, "Embed обновлён."));
      return;
    }

    if (interaction.customId === "rolepanel_compose_button_modal" || interaction.customId === "rolepanel_compose_button_label_modal") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const buttonLabel = interaction.fields.getTextInputValue("button_label").trim();
      if (!buttonLabel) {
        await interaction.reply(ephemeralPayload({ content: "Текст кнопки не может быть пустым." }));
        return;
      }

      const draft = ensureRolePanelDraft(interaction.user.id);
      const idx = Number.isInteger(draft.editingButtonIndex) && draft.editingButtonIndex >= 0 ? draft.editingButtonIndex : -1;
      const buttons = Array.isArray(draft.buttons) ? [...draft.buttons] : [];

      if (idx >= 0 && idx < buttons.length) {
        buttons[idx] = { ...buttons[idx], label: buttonLabel };
        setRolePanelDraft(interaction.user.id, { buttons });
        await interaction.reply(buildRolePanelComposerPayload(interaction.user.id, `Подпись кнопки ${idx + 1} обновлена.`));
      } else {
        await interaction.reply(buildRolePanelComposerPayload(interaction.user.id, "Кнопка не найдена."));
      }
      return;
    }

    if (interaction.customId === "rolepanel_picker_search_modal") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const picker = getRolePanelPicker(interaction.user.id);
      if (!picker) {
        await interaction.reply(ephemeralPayload({ content: "Сессия выбора истекла. Открой выбор заново." }));
        return;
      }

      const query = interaction.fields.getTextInputValue("query").trim();
      setRolePanelPicker(interaction.user.id, { query, page: 0 });
      await interaction.deferUpdate();
      await interaction.editReply(await buildRolePanelPickerPayload(
        client,
        interaction.user.id,
        query ? `Поиск обновлён: ${previewFieldText(query, 100)}.` : "Поиск сброшен.",
        false
      ));
      return;
    }

    if (interaction.customId === "rolepanel_picker_id_modal") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const picker = getRolePanelPicker(interaction.user.id);
      if (!picker) {
        await interaction.reply(ephemeralPayload({ content: "Сессия выбора истекла. Открой выбор заново." }));
        return;
      }

      const entityId = interaction.fields.getTextInputValue("entity_id").trim();
      const entry = await findRolePanelPickerEntryById(client, picker.scope, entityId);
      if (!entry) {
        const entityLabel = picker.scope === ROLE_PANEL_PICKER_SCOPES.COMPOSE_CHANNEL ? "Канал" : "Роль";
        await interaction.deferUpdate();
        await interaction.editReply(await buildRolePanelPickerPayload(
          client,
          interaction.user.id,
          `${entityLabel} с таким ID не найден в полном списке.`,
          false
        ));
        return;
      }

      const statusText = await selectRolePanelPickerValue(client, interaction.user.id, picker.scope, entry.id);
      clearRolePanelPicker(interaction.user.id);
      await interaction.update(buildRolePanelPickerReturnPayload(interaction.user.id, picker.scope, statusText, false));
      return;
    }

    // === Graphic Panel modals ===
    if (interaction.customId === "graphic_panel_title_modal") {
      const title = interaction.fields.getTextInputValue("graphic_title").trim();
      if (!title) {
        await interaction.reply(ephemeralPayload({ content: "Название PNG не может быть пустым." }));
        return;
      }
      await applyUiMutation(client, "graphic", () => {
        db.config.presentation.tierlist.graphicTitle = title;
      });
      await interaction.reply(ephemeralPayload({ content: `Название PNG обновлено: **${title}**` }));
      return;
    }

    if (interaction.customId === "graphic_panel_message_text_modal") {
      const nextText = interaction.fields.getTextInputValue("graphic_message_text").trim();
      if (!nextText) {
        await interaction.reply(ephemeralPayload({ content: "Текст сообщения PNG не может быть пустым." }));
        return;
      }
      await applyUiMutation(client, "graphic", () => {
        db.config.presentation.tierlist.graphicMessageText = nextText;
      });
      await interaction.reply(ephemeralPayload({ content: `Текст сообщения обновлён.` }));
      return;
    }

    if (interaction.customId.startsWith("graphic_panel_rename_modal:")) {
      const tierKey = interaction.customId.split(":")[1];
      const tierName = interaction.fields.getTextInputValue("tier_name").trim();
      if (!tierName) {
        await interaction.reply(ephemeralPayload({ content: "Название тира не может быть пустым." }));
        return;
      }
      await applyUiMutation(client, "tierlists", () => {
        db.config.presentation.tierlist.labels ||= {};
        db.config.presentation.tierlist.labels[tierKey] = tierName;
      });
      await interaction.reply(ephemeralPayload({ content: `Тир ${tierKey} переименован: **${tierName}**` }));
      return;
    }

    if (interaction.customId === "graphic_panel_nonfake_modal") {
      const action = String(interaction.fields.getTextInputValue("nonfake_action") || "").trim().toLowerCase();
      const normalizedAction = action === "ls" ? "list" : action;
      if (normalizedAction === "list") {
        await interaction.reply(ephemeralPayload({ content: buildTierlistNonFakeListText() }));
        return;
      }
      if (!["add", "remove"].includes(normalizedAction)) {
        await interaction.reply(ephemeralPayload({ content: "Поддерживаются только action = list, add или remove." }));
        return;
      }

      const targetId = parseRequestedUserId(interaction.fields.getTextInputValue("nonfake_target"), "");
      if (!targetId) {
        await interaction.reply(ephemeralPayload({ content: "Для add/remove укажи user mention или user ID." }));
        return;
      }
      if (await replyAutonomyGuardIsolatedTarget(interaction, targetId)) {
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const mutationResult = await applyTierlistNonFakeClusterMutation(client, targetId, normalizedAction === "add");
        await interaction.editReply(buildGraphicPanelPayload(
          buildTierlistNonFakeMutationText(
            targetId,
            normalizedAction === "add",
            mutationResult.result,
            mutationResult.refreshWarnings
          ),
          false
        ));
      } catch (error) {
        await interaction.editReply({ content: `Не удалось обновить remembered T6-кластер: ${String(error?.message || error)}` });
      }
      return;
    }

    if (interaction.customId.startsWith("graphic_panel_color_modal:")) {
      const tierKey = interaction.customId.split(":")[1];
      const color = interaction.fields.getTextInputValue("tier_color").trim();
      if (!/^#[0-9a-f]{6}$/i.test(color)) {
        await interaction.reply(ephemeralPayload({ content: "Некорректный HEX-цвет. Формат: #rrggbb" }));
        return;
      }
      await applyUiMutation(client, "graphic", () => {
        getGraphicTierlistConfig().colors ||= {};
        getGraphicTierlistConfig().colors[tierKey] = color;
      });
      await interaction.reply(ephemeralPayload({ content: `Цвет тира ${tierKey} обновлён: **${color}**` }));
      return;
    }

    if (interaction.customId === "graphic_panel_outline_modal") {
      const color = interaction.fields.getTextInputValue("outline_color").trim();
      if (!/^#[0-9a-f]{6}$/i.test(color)) {
        await interaction.reply(ephemeralPayload({ content: "Некорректный HEX-цвет. Формат: #rrggbb" }));
        return;
      }
      const rules = parseRequestedGraphicOutlineRules(interaction.fields.getTextInputValue("outline_rules"), color);
      if (!rules.length) {
        await interaction.reply(ephemeralPayload({ content: "Укажи хотя бы один корректный role ID или role mention. Для своих цветов добавляй #HEX в той же строке." }));
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        await applyUiMutation(client, "graphic", () => {
          const outline = getGraphicTierlistConfig().outline ||= {};
          outline.roleId = rules[0]?.roleId || "";
          outline.roleIds = rules.map((rule) => rule.roleId);
          outline.color = color;
          outline.rules = rules.map((rule) => ({ ...rule }));
        });
        const rulesPreview = rules.slice(0, 5)
          .map((rule) => `${formatRoleMention(rule.roleId)} → **${rule.color}**`)
          .join(", ");
        const moreText = rules.length > 5 ? ` и ещё ${rules.length - 5}` : "";
        await interaction.editReply(buildGraphicPanelPayload(
          `Обводка PNG настроена для ${rules.length} ролей: ${rulesPreview}${moreText}. Цвет по умолчанию: **${color}**.`,
          false
        ));
      } catch (error) {
        await interaction.editReply({ content: `Не удалось сохранить обводку PNG: ${String(error?.message || error)}` });
      }
      return;
    }

    // === Welcome Editor modals ===
    if (interaction.customId === "welcome_editor_text_modal") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }
      const newTitle = interaction.fields.getTextInputValue("welcome_title").trim();
      const newText = interaction.fields.getTextInputValue("welcome_text").trim();
      if (!newTitle || !newText) {
        await interaction.reply(ephemeralPayload({ content: "Название и текст не могут быть пустыми." }));
        return;
      }
      await applyUiMutation(client, "welcome", () => {
        db.config.presentation.welcome.title = newTitle;
        db.config.presentation.welcome.description = newText;
      });
      await interaction.reply(buildWelcomeEditorPayload("Welcome-сообщение обновлено."));
      return;
    }

    if (interaction.customId === "welcome_editor_steps_modal") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }
      const steps = [1, 2, 3, 4, 5].map((index) => interaction.fields.getTextInputValue(`welcome_step_${index}`).trim());
      if (steps.some((step) => !step)) {
        await interaction.reply(ephemeralPayload({ content: "Все шаги должны быть заполнены." }));
        return;
      }
      await applyUiMutation(client, "welcome", () => {
        db.config.presentation.welcome.steps = steps;
      });
      await interaction.reply(buildWelcomeEditorPayload("Шаги welcome обновлены."));
      return;
    }

    if (interaction.customId === "welcome_editor_buttons_modal") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }
      const begin = interaction.fields.getTextInputValue("button_begin").trim();
      const quick = interaction.fields.getTextInputValue("button_quick").trim();
      if (!begin || !quick) {
        await interaction.reply(ephemeralPayload({ content: "Все подписи кнопок должны быть заполнены." }));
        return;
      }
      await applyUiMutation(client, "welcome", () => {
        db.config.presentation.welcome.buttons ||= {};
        db.config.presentation.welcome.buttons.begin = begin;
        db.config.presentation.welcome.buttons.quickMains = quick;
        delete db.config.presentation.welcome.buttons.myCard;
      });
      await interaction.reply(buildWelcomeEditorPayload("Кнопки welcome обновлены."));
      return;
    }

    if (interaction.customId === "welcome_editor_submit_modal") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }
      const title = interaction.fields.getTextInputValue("submit_step_title").trim();
      const description = interaction.fields.getTextInputValue("submit_step_text").trim();
      if (!title || !description) {
        await interaction.reply(ephemeralPayload({ content: "Заголовок и текст submit-шага не могут быть пустыми." }));
        return;
      }
      await applyUiMutation(client, "welcome", () => {
        db.config.presentation.welcome.submitStep ||= {};
        db.config.presentation.welcome.submitStep.title = title;
        db.config.presentation.welcome.submitStep.description = description;
      });
      await interaction.reply(buildWelcomeEditorPayload("Submit-шаг обновлён."));
      return;
    }

    if (interaction.customId === "welcome_editor_jjs_modal") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }
      const title = interaction.fields.getTextInputValue("jjs_title").trim();
      const description = interaction.fields.getTextInputValue("jjs_text").trim();
      const buttonLabel = interaction.fields.getTextInputValue("jjs_button").trim();
      if (!title || !description || !buttonLabel) {
        await interaction.reply(ephemeralPayload({ content: "Все поля JJS-блока должны быть заполнены." }));
        return;
      }
      await applyUiMutation(client, "welcome", () => {
        db.config.presentation ||= {};
        db.config.presentation.nonGgs ||= {};
        db.config.presentation.nonGgs.title = title;
        db.config.presentation.nonGgs.description = description;
        db.config.presentation.nonGgs.buttonLabel = buttonLabel;
        delete db.config.nonJjsUi;
        delete db.config.nonGgsUi;
      });
      await interaction.reply(buildWelcomeEditorPayload("JJS-блок обновлён."));
      return;
    }

    if (interaction.customId === "welcome_editor_tiers_modal") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }
      const nextLabels = {};
      for (const tier of [1, 2, 3, 4, 5]) {
        const value = interaction.fields.getTextInputValue(`tier_label_${tier}`).trim();
        if (!value) {
          await interaction.reply(ephemeralPayload({ content: `Название тира ${tier} не может быть пустым.` }));
          return;
        }
        nextLabels[tier] = value;
      }
      await applyUiMutation(client, "tierlists", () => {
        db.config.presentation.tierlist.labels = nextLabels;
      });
      await interaction.reply(buildWelcomeEditorPayload("Названия тиров обновлены."));
      return;
    }

    if (interaction.customId === "welcome_editor_png_modal") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }
      const textTitle = interaction.fields.getTextInputValue("text_tierlist_title").trim();
      const graphicTitle = interaction.fields.getTextInputValue("graphic_title").trim();
      const graphicMessageText = interaction.fields.getTextInputValue("graphic_message_text").trim();
      if (!textTitle || !graphicTitle || !graphicMessageText) {
        await interaction.reply(ephemeralPayload({ content: "Все поля PNG/tierlist должны быть заполнены." }));
        return;
      }
      await applyUiMutation(client, "tierlists", () => {
        db.config.presentation.tierlist.textTitle = textTitle;
        db.config.presentation.tierlist.graphicTitle = graphicTitle;
        db.config.presentation.tierlist.graphicMessageText = graphicMessageText;
      });
      await interaction.reply(buildWelcomeEditorPayload("Тексты tier-листа и PNG обновлены."));
      return;
    }

    if (interaction.customId === "panel_config_channels_modal") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const welcomeChannelId = parseRequestedChannelId(interaction.fields.getTextInputValue("panel_channel_welcome"), "");
      const reviewChannelId = parseRequestedChannelId(interaction.fields.getTextInputValue("panel_channel_review"), "");
      const textTierlistChannelId = parseRequestedChannelId(interaction.fields.getTextInputValue("panel_channel_text_tierlist"), "");
      const graphicTierlistChannelId = parseRequestedChannelId(interaction.fields.getTextInputValue("panel_channel_graphic_tierlist"), "");
      const noticesChannelId = parseRequestedChannelId(interaction.fields.getTextInputValue("panel_channel_notices"), "");

      const channelOverrides = [
        { slot: "welcome", label: "Welcome", channelId: welcomeChannelId },
        { slot: "review", label: "Review", channelId: reviewChannelId },
        { slot: "tierlistText", label: "Text tierlist", channelId: textTierlistChannelId },
        { slot: "tierlistGraphic", label: "Graphic tierlist", channelId: graphicTierlistChannelId },
        { slot: "log", label: "Notice/log", channelId: noticesChannelId },
      ];
      const changedChannelOverrides = getManagedChannelOverrideChanges(
        channelOverrides,
        (slot) => getResolvedChannelId(slot)
      );

      if (!changedChannelOverrides.length) {
        await interaction.editReply(await buildModeratorPanelPayload(client, "Изменений по каналам нет.", false));
        return;
      }

      for (const { label, channelId } of changedChannelOverrides) {
        if (!channelId) continue;
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel?.isTextBased?.()) {
          await interaction.editReply({ content: `${label} канал не найден или не является текстовым.`, embeds: [], components: [] });
          return;
        }
      }

      let batchResult;
      try {
        batchResult = await applyManagedChannelOverrideBatch({
          channelOverrides: changedChannelOverrides,
          getCurrentChannelId: (slot) => getResolvedChannelId(slot),
          applyChannelOverride: (slot, channelId, options) => applyGroundTruthReportChannelLink(client, slot, channelId, {
            allowClear: options?.allowClear !== false,
          }),
        });
      } catch (error) {
        const appliedText = error instanceof ChannelOverrideBatchError && error.appliedOverrides.length
          ? ` Применённые изменения откатили: ${error.appliedOverrides.map((entry) => entry.label || getManagedChannelSlotLabel(entry.slot)).join(", ")}.`
          : "";
        const rollbackText = error instanceof ChannelOverrideBatchError && error.rollbackFailures.length
          ? ` Откат не удался для: ${error.rollbackFailures.map((entry) => entry.label || getManagedChannelSlotLabel(entry.slot)).join(", ")}.`
          : "";
        await interaction.editReply({
          content: `${String(error?.message || error || "Не удалось сохранить каналы.")}${appliedText}${rollbackText}`,
          embeds: [],
          components: [],
        });
        return;
      }

      let statusText = batchResult.statusNotes.length ? `${batchResult.statusNotes.join(" ")} ` : "";
      statusText += "Каналы сохранены.";

      await interaction.editReply(await buildModeratorPanelPayload(client, statusText, false));
      return;
    }

    if (interaction.customId === "panel_add_character_modal" || interaction.customId === "panel_add_custom_character_modal") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }
      const charName = String(interaction.fields.getTextInputValue("character_name") || "").trim();
      const idHint = (() => {
        try { return String(interaction.fields.getTextInputValue("character_id") || "").trim(); } catch { return ""; }
      })();
      const imageUrl = (() => {
        try { return String(interaction.fields.getTextInputValue("character_image_url") || "").trim(); } catch { return ""; }
      })();

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const result = await submitAddCharacterUnified(client, { name: charName, idHint, imageUrl });
        await interaction.editReply([
          `Персонаж **${result.name}** добавлен.`,
          `id: ${result.characterId}${result.roleNote || ""}`,
          `${result.viewsNote || ""}${getLegacyTierlistSyncStatusSuffix(result.syncResult)}`.trim(),
        ].filter(Boolean).join("\n"));
      } catch (error) {
        await interaction.editReply(String(error?.message || error || "Не удалось добавить персонажа."));
      }
      return;
    }

    if (interaction.customId === "elo_panel_source_modal") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const sourcePath = interaction.fields.getTextInputValue("elo_source_path").trim();

      let statusText = "";
      if (!sourcePath) {
        clearNativeIntegrationSourcePath(db, { slot: "elo" });
        const cleared = clearDormantEloSync(db, { syncedAt: nowIso(), sourcePath: "" });
        saveDb();
        statusText = `ELO sourcePath очищен. Снято проекций: ${cleared.clearedProfiles}.`;
      } else {
        writeNativeIntegrationSourcePath(db, { slot: "elo", sourcePath });
        saveDb();
        const result = refreshDormantEloImport();
        statusText = getDormantEloImportStatusText(result);
        const liveState = getLiveLegacyEloState();
        if (liveState.ok) {
          const roleSync = await syncLegacyEloTierRoles(client, liveState.rawDb, { reason: "legacy elo source sync" });
          if (roleSync.processed > 0) {
            statusText += ` Роли: assigned ${roleSync.assigned}, cleared ${roleSync.cleared}.`;
          }
        }
      }

      await interaction.reply(buildDormantEloPanelPayload(statusText));
      return;
    }

    if (interaction.customId === "tierlist_panel_source_modal") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const sourcePath = interaction.fields.getTextInputValue("tierlist_source_path").trim();

      let statusText = "";
      if (!sourcePath) {
        clearNativeIntegrationSourcePath(db, { slot: "tierlist" });
        const cleared = clearDormantTierlistSync(db, { syncedAt: nowIso(), sourcePath: "" });
        saveDb();
        statusText = `Tierlist sourcePath очищен. Снято проекций: ${cleared.clearedProfiles}.`;
      } else {
        writeNativeIntegrationSourcePath(db, { slot: "tierlist", sourcePath });
        saveDb();
        const result = refreshDormantTierlistImport();
        statusText = getDormantTierlistImportStatusText(result);
      }

      await interaction.reply(buildDormantTierlistPanelPayload(statusText));
      return;
    }

    if (interaction.customId === "elo_panel_lookup_modal") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const requestedUserId = parseRequestedUserId(
        interaction.fields.getTextInputValue("elo_lookup_user"),
        interaction.user.id
      );
      if (!requestedUserId) {
        await interaction.reply(ephemeralPayload({ content: "Нужен корректный user ID или Discord mention." }));
        return;
      }

      await interaction.reply(buildDormantEloProfilePayload(requestedUserId));
      return;
    }

    if (interaction.customId === "tierlist_panel_lookup_modal") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const requestedUserId = parseRequestedUserId(
        interaction.fields.getTextInputValue("tierlist_lookup_user"),
        interaction.user.id
      );
      if (!requestedUserId) {
        await interaction.reply(ephemeralPayload({ content: "Нужен корректный user ID или Discord mention." }));
        return;
      }

      await interaction.reply(buildDormantTierlistProfilePayload(requestedUserId));
      return;
    }

    if (interaction.customId.startsWith("panel_rename_modal:")) {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const tierKey = interaction.customId.split(":")[1] || "S";
      const name = String(interaction.fields.getTextInputValue("tier_name") || "").trim().slice(0, 24);
      if (!name) {
        await interaction.reply(ephemeralPayload({ content: "Пустое имя." }));
        return;
      }

      const liveState = getLiveLegacyTierlistState();
      if (!liveState.ok) {
        await interaction.reply(buildLegacyTierlistStateErrorPayload("Не удалось открыть legacy Tierlist state", liveState));
        return;
      }

      liveState.rawState.tiers ||= {};
      liveState.rawState.tiers[tierKey] ||= {};
      liveState.rawState.tiers[tierKey].name = name;

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const syncResult = saveLiveLegacyTierlistStateAndResync(liveState);
      const refreshError = await tryRefreshLegacyTierlistPublicViews(client, liveState);
      if (refreshError) {
        console.warn(`[legacy-tierlist] panel rename refresh warning for ${tierKey}: ${refreshError}`);
      }
      await interaction.editReply(`Ок. Теперь **${tierKey}** называется: **${name}**.${getLegacyTierlistSyncStatusSuffix(syncResult)}${getLegacyTierlistRefreshWarningText(refreshError)}`);
      return;
    }

    if (interaction.customId === "panel_set_img_modal") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const parseField = (rawValue, min, max, label) => {
        const text = String(rawValue || "").trim();
        if (!text) return null;
        if (!/^\d+$/.test(text)) {
          throw new Error(`${label}: нужно целое число.`);
        }
        const value = Number(text);
        if (value < min || value > max) {
          throw new Error(`${label}: диапазон ${min}-${max}.`);
        }
        return value;
      };

      let width = null;
      let height = null;
      let icon = null;
      try {
        width = parseField(interaction.fields.getTextInputValue("tierlist_width"), 1200, 4096, "Ширина");
        height = parseField(interaction.fields.getTextInputValue("tierlist_height"), 700, 2160, "Высота");
        icon = parseField(interaction.fields.getTextInputValue("tierlist_icon"), 64, 256, "Иконки");
      } catch (error) {
        await interaction.reply(ephemeralPayload({ content: String(error?.message || error || "Неверные значения размеров.") }));
        return;
      }

      if (width == null && height == null && icon == null) {
        await interaction.reply(ephemeralPayload({ content: "Укажи хотя бы одно значение размера." }));
        return;
      }

      const liveState = getLiveLegacyTierlistState();
      if (!liveState.ok) {
        await interaction.reply(buildLegacyTierlistStateErrorPayload("Не удалось открыть legacy Tierlist state", liveState));
        return;
      }

      liveState.rawState.settings ||= {};
      liveState.rawState.settings.image ||= { width: null, height: null, icon: null };
      if (width != null) liveState.rawState.settings.image.width = width;
      if (height != null) liveState.rawState.settings.image.height = height;
      if (icon != null) liveState.rawState.settings.image.icon = icon;

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const syncResult = saveLiveLegacyTierlistStateAndResync(liveState);
      const refreshError = await tryRefreshLegacyTierlistPublicViews(client, liveState);
      if (refreshError) {
        console.warn(`[legacy-tierlist] panel set image refresh warning: ${refreshError}`);
      }
      const cfg = getLegacyTierlistImageConfig(liveState.rawState);
      await interaction.editReply(`Ок. Теперь img: ${cfg.W}x${cfg.H}, icon=${cfg.ICON}.${getLegacyTierlistSyncStatusSuffix(syncResult)}${getLegacyTierlistRefreshWarningText(refreshError)}`);
      return;
    }

    if (interaction.customId === "panel_role_coefficients_modal") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const parseInfluenceBlock = (rawText, expectedKeys, label) => {
        const lines = String(rawText || "")
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);

        const result = {};
        for (const line of lines) {
          const match = line.match(/^([a-z0-9]+)\s*=\s*([0-9]+(?:[.,][0-9]+)?)$/i);
          if (!match) {
            throw new Error(`${label}: используй строки формата key=value.`);
          }

          const key = match[1].toLowerCase();
          if (!expectedKeys.includes(key)) {
            throw new Error(`${label}: ключ ${key} не поддерживается.`);
          }

          const value = Number(match[2].replace(",", "."));
          if (!Number.isFinite(value) || value <= 0) {
            throw new Error(`${label}: коэффициент для ${key} должен быть положительным числом.`);
          }
          result[key] = value;
        }

        for (const key of expectedKeys) {
          if (!(key in result)) {
            throw new Error(`${label}: не хватает значения для ${key}.`);
          }
        }

        return result;
      };

      let low = null;
      let high = null;
      try {
        low = parseInfluenceBlock(interaction.fields.getTextInputValue("tierlist_influence_low"), ["default", "1", "2"], "Блок без роли / T1 / T2");
        high = parseInfluenceBlock(interaction.fields.getTextInputValue("tierlist_influence_high"), ["3", "4", "5"], "Блок T3 / T4 / T5");
      } catch (error) {
        await interaction.reply(ephemeralPayload({ content: String(error?.message || error || "Неверный формат коэффициентов.") }));
        return;
      }

      const liveState = getLiveLegacyTierlistState();
      if (!liveState.ok) {
        await interaction.reply(buildLegacyTierlistStateErrorPayload("Не удалось открыть legacy Tierlist state", liveState));
        return;
      }

      liveState.rawState.settings ||= {};
      liveState.rawState.settings.roleInfluence = {
        default: low.default,
        1: low[1],
        2: low[2],
        3: high[3],
        4: high[4],
        5: high[5],
      };

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const syncResult = saveLiveLegacyTierlistStateAndResync(liveState);
      const backfillResult = await backfillLegacyTierlistInfluenceForExistingVoters(client, { refresh: true });
      let refreshError = backfillResult.refreshError || null;
      if (!backfillResult.changed) {
        refreshError = refreshError || await tryRefreshLegacyTierlistPublicViews(client, liveState);
      }
      if (refreshError) {
        console.warn(`[legacy-tierlist] influence panel refresh warning: ${refreshError}`);
      }
      await interaction.editReply([
        `Коэффициенты сохранены: ${formatLegacyTierlistInfluenceSummary(liveState.rawState)}.`,
        backfillResult.total ? `Пересчитано влияний: ${backfillResult.changed}/${backfillResult.total}.` : "Голосов для пересчёта пока нет.",
        refreshError ? `Предупреждение: public views не обновились (${refreshError}).` : "",
        getLegacyTierlistSyncStatusSuffix(syncResult),
      ].filter(Boolean).join(" "));
      return;
    }

    if (interaction.customId === "panel_add_custom_character_modal_legacy_disabled_path") {
      // Handler unified above.
      return;
    }

    if (["tierlist_panel_dashboard_setup_modal", "tierlist_panel_summary_setup_modal"].includes(interaction.customId)) {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const isDashboard = interaction.customId === "tierlist_panel_dashboard_setup_modal";
      const channelId = parseRequestedChannelId(
        interaction.fields.getTextInputValue(isDashboard ? "tierlist_dashboard_channel" : "tierlist_summary_channel")
      );
      if (!channelId) {
        await interaction.reply(ephemeralPayload({ content: "Нужен корректный ID или mention текстового канала." }));
        return;
      }

      const liveState = getLiveLegacyTierlistState();
      if (!liveState.ok) {
        await interaction.reply(buildLegacyTierlistStateErrorPayload("Не удалось открыть legacy Tierlist state", liveState));
        return;
      }

      try {
        const result = await writeAndApplyNativePanelOverride(
          client,
          isDashboard ? "tierlistDashboard" : "tierlistSummary",
          channelId
        );

        await interaction.reply(buildDormantTierlistPanelPayload(
          `${isDashboard ? "Legacy Tierlist dashboard" : "Legacy Tierlist summary"} создан/обновлён в ${formatChannelMention(result.channel?.id || channelId)}.`
        ));
      } catch (error) {
        await interaction.reply(ephemeralPayload({ content: String(error?.message || error || "Не удалось настроить legacy Tierlist public view.") }));
      }
      return;
    }

    if (interaction.customId === "tierlist_panel_channels_modal") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const dashboardChannelId = parseRequestedChannelId(interaction.fields.getTextInputValue("tierlist_channel_dashboard"), "");
      const summaryChannelId = parseRequestedChannelId(interaction.fields.getTextInputValue("tierlist_channel_summary"), "");

      for (const [label, channelId] of [
        ["Dashboard", dashboardChannelId],
        ["Summary", summaryChannelId],
      ]) {
        if (!channelId) continue;
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel?.isTextBased?.()) {
          await interaction.editReply({ content: `${label} канал не найден или не является текстовым.`, embeds: [], components: [] });
          return;
        }
      }

      const liveState = getLiveLegacyTierlistState();
      if (!liveState.ok) {
        await interaction.editReply(buildLegacyTierlistStateErrorPayload("Не удалось открыть legacy Tierlist state", liveState, false));
        return;
      }

      const notes = [];

      if (dashboardChannelId) {
        try {
          const result = await writeAndApplyNativePanelOverride(client, "tierlistDashboard", dashboardChannelId);
          notes.push(`Dashboard → ${formatChannelMention(result.channel?.id || dashboardChannelId)}.`);
        } catch (error) {
          notes.push(`Dashboard ошибка: ${String(error?.message || error)}.`);
        }
      }

      if (summaryChannelId) {
        try {
          const result = await writeAndApplyNativePanelOverride(client, "tierlistSummary", summaryChannelId);
          notes.push(`Summary → ${formatChannelMention(result.channel?.id || summaryChannelId)}.`);
        } catch (error) {
          notes.push(`Summary ошибка: ${String(error?.message || error)}.`);
        }
      }

      if (!dashboardChannelId && !summaryChannelId) {
        notes.push("Ни один канал не задан — изменений нет.");
      }

      const statusText = `Каналы Tierlist сохранены. ${notes.join(" ")}`.trim();
      await interaction.editReply(buildDormantTierlistPanelPayload(statusText, false));
      return;
    }

    if (interaction.customId === "elo_panel_modset_modal") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const targetUserId = parseRequestedUserId(interaction.fields.getTextInputValue("elo_modset_user"));
      if (!targetUserId) {
        await interaction.reply(ephemeralPayload({ content: "Нужен корректный user ID или Discord mention." }));
        return;
      }

      const rawText = String(interaction.fields.getTextInputValue("elo_modset_text") || "").trim();
      if (!rawText) {
        await interaction.reply(ephemeralPayload({ content: "Нужен текст с числом ELO." }));
        return;
      }

      const screenshotUrl = String(interaction.fields.getTextInputValue("elo_modset_screenshot_url") || "").trim();
      if (!isLikelyImageUrl(screenshotUrl)) {
        await interaction.reply(ephemeralPayload({ content: "Нужна прямая ссылка на image URL, например из Discord CDN." }));
        return;
      }

      const liveState = getLiveLegacyEloState();
      if (!liveState.ok) {
        await interaction.reply(buildLegacyEloStateErrorPayload("Не удалось открыть legacy ELO базу", liveState));
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const created = await createManualApprovedLegacyEloRecord(
          client,
          liveState,
          targetUserId,
          rawText,
          screenshotUrl,
          interaction.user.tag
        );
        await syncLegacyEloTierRoles(client, liveState.rawDb, {
          targetUserId,
          reason: "legacy elo modset",
        });

        let boardUpdated = false;
        let syncResult = null;
        const refreshResult = await refreshLegacyEloGraphicBoard(client, { liveState });
        if (refreshResult?.ok) {
          boardUpdated = true;
          syncResult = refreshResult.syncResult;
        } else {
          syncResult = saveLiveLegacyEloStateAndResync(liveState);
        }

        const latestRating = liveState.rawDb?.ratings?.[targetUserId] || created.rating;
        const eloValue = latestRating?.elo ?? created.rating?.elo ?? "—";
        const tierValue = latestRating?.tier ?? created.rating?.tier ?? "—";
        const proofUrl = latestRating?.proofUrl || screenshotUrl;

        await dmUser(
          client,
          targetUserId,
          [
            "Модератор обновил твой ELO рейтинг.",
            `ELO: ${eloValue}`,
            `Тир: ${tierValue}`,
            `Пруф: ${proofUrl}`,
          ].join("\n")
        );
        await logLine(client, `ELO MODSET: <@${targetUserId}> ELO ${eloValue} -> Tier ${tierValue} by ${interaction.user.tag}`);

        await interaction.editReply(buildDormantEloPanelPayload(
          [
            `Legacy ELO modset выполнен для <@${targetUserId}>.`,
            `ELO: ${eloValue}.`,
            `Tier: ${tierValue}.`,
            `Review ID: ${created.submissionId}.`,
            `PNG: ${boardUpdated ? "обновлён" : "не настроен или пропущен"}.`,
          ].join(" ") + getLegacyEloSyncStatusSuffix(syncResult),
          false
        ));
      } catch (error) {
        await interaction.editReply(buildDormantEloPanelPayload(String(error?.message || error || "Не удалось выполнить legacy ELO modset."), false));
      }
      return;
    }

    if (interaction.customId === "elo_panel_channels_modal") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const submitChannelId = parseRequestedChannelId(interaction.fields.getTextInputValue("elo_channel_submit"), "");
      const graphicChannelId = parseRequestedChannelId(interaction.fields.getTextInputValue("elo_channel_graphic"), "");

      for (const [label, channelId] of [
        ["Submit Hub", submitChannelId],
        ["Graphic board", graphicChannelId],
      ]) {
        if (!channelId) continue;
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel?.isTextBased?.()) {
          await interaction.editReply({ content: `${label} канал не найден или не является текстовым.`, embeds: [], components: [] });
          return;
        }
      }

      const liveState = getLiveLegacyEloState();
      if (!liveState.ok) {
        await interaction.editReply(buildLegacyEloStateErrorPayload("Не удалось открыть legacy ELO базу", liveState));
        return;
      }

      const notes = [];

      try {
        const submitPanel = getLegacyEloSubmitPanelState(liveState.rawDb);
        if (submitChannelId) {
          const result = await writeAndApplyNativePanelOverride(client, "eloSubmit", submitChannelId);
          notes.push(`Submit Hub → ${formatChannelMention(result.channel?.id || submitChannelId)}.`);
        } else if (submitPanel.channelId) {
          const result = await writeAndApplyNativePanelOverride(client, "eloSubmit", "");
          notes.push(result.applyResult?.deletedMessageId
            ? `Submit Hub сброшен и старое сообщение удалено (${result.applyResult.deletedMessageId}).`
            : "Submit Hub канал сброшен.");
        }
      } catch (error) {
        notes.push(`Submit Hub ошибка: ${String(error?.message || error)}.`);
      }

      try {
        if (graphicChannelId) {
          const result = await writeAndApplyNativePanelOverride(client, "eloGraphic", graphicChannelId);
          notes.push(`PNG board → ${formatChannelMention(result.channel?.id || graphicChannelId)}.`);
        } else {
          const graphicState = ensureLegacyEloGraphicState(liveState.rawDb);
          if (graphicState.dashboardChannelId) {
            const result = await writeAndApplyNativePanelOverride(client, "eloGraphic", "");
            notes.push(result.applyResult?.deletedMessageId
              ? `PNG board сброшен и старое сообщение удалено (${result.applyResult.deletedMessageId}).`
              : "PNG board канал сброшен.");
          }
        }
      } catch (error) {
        notes.push(`PNG board ошибка: ${String(error?.message || error)}.`);
      }

      const statusText = `Каналы ELO сохранены. ${notes.join(" ")}`.trim();
      await interaction.editReply(buildDormantEloPanelPayload(statusText, false));
      return;
    }

    if (interaction.customId === "elo_panel_submit_setup_modal") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const channelId = parseRequestedChannelId(interaction.fields.getTextInputValue("elo_submit_channel"));
      if (!channelId) {
        await interaction.reply(ephemeralPayload({ content: "Нужен корректный ID или mention текстового канала." }));
        return;
      }

      const liveState = getLiveLegacyEloState();
      if (!liveState.ok) {
        await interaction.reply(buildLegacyEloStateErrorPayload("Не удалось открыть legacy ELO базу", liveState));
        return;
      }

      try {
        const result = await writeAndApplyNativePanelOverride(client, "eloSubmit", channelId);
        await interaction.reply(buildDormantEloPanelPayload(
          `Legacy ELO submit hub создан/обновлён в ${formatChannelMention(result.channel?.id || channelId)}.`
        ));
      } catch (error) {
        await interaction.reply(ephemeralPayload({ content: String(error?.message || error || "Не удалось настроить legacy ELO submit hub.") }));
      }
      return;
    }

    if (interaction.customId === "elo_submit_modal") {
      const liveState = getLiveLegacyEloState();
      if (!liveState.ok) {
        await interaction.reply(buildLegacyEloStateErrorPayload("Не удалось открыть legacy ELO данные", liveState));
        return;
      }

      const rawText = String(interaction.fields.getTextInputValue("elo_submit_text") || "").trim();
      const blockReason = getLegacyEloSubmitEligibilityError(liveState.rawDb, interaction.user.id, rawText);
      if (blockReason) {
        await interaction.reply(ephemeralPayload({ content: blockReason }));
        return;
      }

      const submitPanel = getLegacyEloSubmitPanelState(liveState.rawDb);
      const targetChannelId = submitPanel.channelId || interaction.channelId;
      setLegacyEloSubmitSession(interaction.user.id, {
        rawText,
        channelId: targetChannelId,
      });
      await interaction.reply(buildLegacyEloSubmitAwaitPayload(targetChannelId));
      return;
    }

    if (interaction.customId === "elo_graphic_panel_setup_modal") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const channelId = parseRequestedChannelId(interaction.fields.getTextInputValue("elo_graphic_channel"));
      if (!channelId) {
        await interaction.reply(ephemeralPayload({ content: "Нужен корректный ID или mention текстового канала." }));
        return;
      }

      const liveState = getLiveLegacyEloState();
      if (!liveState.ok) {
        await interaction.reply(buildLegacyEloStateErrorPayload("Не удалось открыть legacy ELO PNG panel", liveState));
        return;
      }

      try {
        const result = await writeAndApplyNativePanelOverride(client, "eloGraphic", channelId);
        const status = `Legacy ELO PNG создан/обновлён в ${formatChannelMention(result.channel?.id || channelId)}.`;
        await interaction.reply(buildLegacyEloGraphicPanelPayload(liveState.rawDb, status));
      } catch (error) {
        await interaction.reply(ephemeralPayload({ content: String(error?.message || error || "Не удалось настроить legacy ELO PNG канал.") }));
      }
      return;
    }

    if (interaction.customId === "elo_graphic_panel_labels_modal") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const liveState = getLiveLegacyEloState();
      if (!liveState.ok) {
        await interaction.reply(buildLegacyEloStateErrorPayload("Не удалось открыть legacy ELO PNG panel", liveState));
        return;
      }

      const nextLabels = {
        1: interaction.fields.getTextInputValue("tier_label_1").trim(),
        2: interaction.fields.getTextInputValue("tier_label_2").trim(),
        3: interaction.fields.getTextInputValue("tier_label_3").trim(),
        4: interaction.fields.getTextInputValue("tier_label_4").trim(),
        5: interaction.fields.getTextInputValue("tier_label_5").trim(),
      };
      if (!setLegacyEloTierLabels(liveState.rawDb, nextLabels)) {
        await interaction.reply(ephemeralPayload({ content: "Все названия tiers должны быть заполнены." }));
        return;
      }

      try {
        const persisted = await persistLegacyEloGraphicMutation(client, liveState, { refreshBoard: true });
        await interaction.reply(buildLegacyEloGraphicPanelPayload(
          liveState.rawDb,
          `Названия tiers обновлены.${persisted.boardUpdated ? " PNG board пересобран." : " PNG board пока не настроен."}${getLegacyEloSyncStatusSuffix(persisted.syncResult)}`
        ));
      } catch (error) {
        await interaction.reply(ephemeralPayload({ content: String(error?.message || error || "Не удалось обновить labels для legacy ELO PNG.") }));
      }
      return;
    }

    if (interaction.customId === "elo_graphic_panel_title_modal") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const title = interaction.fields.getTextInputValue("graphic_title").trim();
      if (!title) {
        await interaction.reply(ephemeralPayload({ content: "Название PNG не может быть пустым." }));
        return;
      }

      const liveState = getLiveLegacyEloState();
      if (!liveState.ok) {
        await interaction.reply(buildLegacyEloStateErrorPayload("Не удалось открыть legacy ELO PNG panel", liveState));
        return;
      }

      setLegacyEloGraphicTitle(liveState.rawDb, title);
      try {
        const persisted = await persistLegacyEloGraphicMutation(client, liveState, { refreshBoard: true });
        await interaction.reply(buildLegacyEloGraphicPanelPayload(
          liveState.rawDb,
          `Название PNG обновлено: **${title}**.${persisted.boardUpdated ? " PNG board пересобран." : " PNG board пока не настроен."}${getLegacyEloSyncStatusSuffix(persisted.syncResult)}`
        ));
      } catch (error) {
        await interaction.reply(ephemeralPayload({ content: String(error?.message || error || "Не удалось обновить название legacy ELO PNG.") }));
      }
      return;
    }

    if (interaction.customId === "elo_graphic_panel_message_text_modal") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const nextText = interaction.fields.getTextInputValue("graphic_message_text").trim();
      if (!nextText) {
        await interaction.reply(ephemeralPayload({ content: "Текст сообщения PNG не может быть пустым." }));
        return;
      }

      const liveState = getLiveLegacyEloState();
      if (!liveState.ok) {
        await interaction.reply(buildLegacyEloStateErrorPayload("Не удалось открыть legacy ELO PNG panel", liveState));
        return;
      }

      setLegacyEloGraphicMessageText(liveState.rawDb, nextText);
      try {
        const persisted = await persistLegacyEloGraphicMutation(client, liveState, { refreshBoard: true });
        await interaction.reply(buildLegacyEloGraphicPanelPayload(
          liveState.rawDb,
          `Текст сообщения PNG обновлён.${persisted.boardUpdated ? " PNG board пересобран." : " PNG board пока не настроен."}${getLegacyEloSyncStatusSuffix(persisted.syncResult)}`
        ));
      } catch (error) {
        await interaction.reply(ephemeralPayload({ content: String(error?.message || error || "Не удалось обновить текст legacy ELO PNG.") }));
      }
      return;
    }

    if (interaction.customId.startsWith("elo_graphic_panel_rename_modal:")) {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const tierKey = interaction.customId.split(":")[1];
      const tierName = interaction.fields.getTextInputValue("tier_name").trim();
      if (!tierName) {
        await interaction.reply(ephemeralPayload({ content: "Название тира не может быть пустым." }));
        return;
      }

      const liveState = getLiveLegacyEloState();
      if (!liveState.ok) {
        await interaction.reply(buildLegacyEloStateErrorPayload("Не удалось открыть legacy ELO PNG panel", liveState));
        return;
      }

      setLegacyEloTierLabel(liveState.rawDb, tierKey, tierName);
      try {
        const persisted = await persistLegacyEloGraphicMutation(client, liveState, { refreshBoard: true });
        await interaction.reply(buildLegacyEloGraphicPanelPayload(
          liveState.rawDb,
          `Tier ${tierKey} переименован: **${tierName}**.${persisted.boardUpdated ? " PNG board пересобран." : " PNG board пока не настроен."}${getLegacyEloSyncStatusSuffix(persisted.syncResult)}`
        ));
      } catch (error) {
        await interaction.reply(ephemeralPayload({ content: String(error?.message || error || "Не удалось переименовать tier для legacy ELO PNG.") }));
      }
      return;
    }

    if (interaction.customId.startsWith("elo_graphic_panel_color_modal:")) {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const tierKey = interaction.customId.split(":")[1];
      const color = interaction.fields.getTextInputValue("tier_color").trim();
      const liveState = getLiveLegacyEloState();
      if (!liveState.ok) {
        await interaction.reply(buildLegacyEloStateErrorPayload("Не удалось открыть legacy ELO PNG panel", liveState));
        return;
      }
      if (!setLegacyEloGraphicTierColor(liveState.rawDb, tierKey, color)) {
        await interaction.reply(ephemeralPayload({ content: "Нужен HEX цвет вида #ff6b6b" }));
        return;
      }

      try {
        const persisted = await persistLegacyEloGraphicMutation(client, liveState, { refreshBoard: true });
        await interaction.reply(buildLegacyEloGraphicPanelPayload(
          liveState.rawDb,
          `Цвет tier ${tierKey} обновлён.${persisted.boardUpdated ? " PNG board пересобран." : " PNG board пока не настроен."}${getLegacyEloSyncStatusSuffix(persisted.syncResult)}`
        ));
      } catch (error) {
        await interaction.reply(ephemeralPayload({ content: String(error?.message || error || "Не удалось обновить цвет tier для legacy ELO PNG.") }));
      }
      return;
    }

    if (interaction.customId === "elo_review_open_modal") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const submissionId = String(interaction.fields.getTextInputValue("elo_review_submission_id") || "").trim();
      if (!submissionId) {
        await interaction.reply(ephemeralPayload({ content: "Нужен ID заявки." }));
        return;
      }

      await interaction.reply(buildLegacyEloReviewPayload(submissionId));
      return;
    }

    if (interaction.customId === "elo_panel_remove_modal") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const userId = parseRequestedUserId(interaction.fields.getTextInputValue("elo_remove_user"));
      if (!userId) {
        await interaction.reply(ephemeralPayload({ content: "Нужен корректный user ID или Discord mention." }));
        return;
      }

      const liveState = getLiveLegacyEloState();
      if (!liveState.ok) {
        await interaction.reply(buildLegacyEloStateErrorPayload("Не удалось открыть legacy ELO базу", liveState));
        return;
      }

      const removed = removeLegacyEloRating(liveState.rawDb, userId);
      if (!removed.removed) {
        await interaction.reply(ephemeralPayload({ content: "Этого игрока нет в legacy ELO рейтинге." }));
        return;
      }

      await syncLegacyEloTierRoles(client, liveState.rawDb, {
        targetUserId: userId,
        reason: "legacy elo remove",
      });
      clearGraphicAvatarCacheForUser(userId);
      const persisted = await persistLegacyEloGraphicMutation(client, liveState, { refreshBoard: true });
      const syncWarning = `${getLegacyEloSyncStatusSuffix(persisted.syncResult)}${persisted.warning}`;
      await logLine(client, `ELO REMOVE: <@${userId}> removed from legacy rating by ${interaction.user.tag}`);
      await interaction.reply(buildDormantEloPanelPayload(
        `Удалил <@${userId}> из legacy ELO рейтинга. Mini-card link: ${removed.removedMiniCardId ? "да" : "нет"}. Legacy card link: ${removed.removedCardMessageId ? "да" : "нет"}.${syncWarning}`
      ));
      return;
    }

    if (interaction.customId === "elo_panel_wipe_modal") {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const mode = String(interaction.fields.getTextInputValue("elo_wipe_mode") || "").trim().toLowerCase();
      const confirm = String(interaction.fields.getTextInputValue("elo_wipe_confirm") || "").trim();
      if (!["soft", "hard"].includes(mode)) {
        await interaction.reply(ephemeralPayload({ content: "Режим wipe должен быть soft или hard." }));
        return;
      }
      if (confirm !== "WIPE") {
        await interaction.reply(ephemeralPayload({ content: "Не подтверждено. В confirm надо написать ровно: WIPE" }));
        return;
      }

      const liveState = getLiveLegacyEloState();
      if (!liveState.ok) {
        await interaction.reply(buildLegacyEloStateErrorPayload("Не удалось открыть legacy ELO базу", liveState));
        return;
      }

      const wiped = wipeLegacyEloRatings(liveState.rawDb, { mode });
      await syncLegacyEloTierRoles(client, liveState.rawDb, {
        clearUserIds: wiped.removedUserIds,
        reason: `legacy elo wipe ${mode}`,
      });
      clearGraphicAvatarCache();
      const persisted = await persistLegacyEloGraphicMutation(client, liveState, { refreshBoard: true });
      const syncWarning = `${getLegacyEloSyncStatusSuffix(persisted.syncResult)}${persisted.warning}`;
      await logLine(client, `ELO WIPE_RATINGS (${mode}) by ${interaction.user.tag}`);
      await interaction.reply(buildDormantEloPanelPayload(
        [
          `Рейтинг очищен. mode=${mode}.`,
          `Удалено игроков: ${wiped.removedRatings}.`,
          `Очищено mini-card ссылок: ${wiped.removedMiniCards}.`,
          `Legacy card links: ${wiped.cleanup.clearedCardLinks}.`,
          `Legacy index link: ${wiped.cleanup.clearedIndexLink ? "да" : "нет"}.`,
        ].join(" ") + syncWarning
      ));
      return;
    }

    if (interaction.customId.startsWith("elo_review_edit_modal:")) {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const submissionId = interaction.customId.split(":")[1] || "";
      const liveState = getLiveLegacyEloState();
      if (!liveState.ok) {
        await interaction.reply(buildLegacyEloStateErrorPayload("Не удалось открыть ELO review-заявку", liveState));
        return;
      }

      const submission = getLegacyEloSubmission(liveState.rawDb, submissionId);
      if (!submission) {
        await interaction.reply(ephemeralPayload({ content: "Legacy ELO заявка не найдена." }));
        return;
      }

      if (submission.status !== "pending") {
        await interaction.reply(buildLegacyEloReviewPayload(submissionId, `Заявка уже обработана: ${submission.status}.`));
        return;
      }

      if (isLegacyEloSubmissionExpired(submission, { pendingExpireHours: LEGACY_ELO_PENDING_EXPIRE_HOURS })) {
        const expired = expireLegacyEloSubmission(liveState.rawDb, submissionId, { reviewedAt: nowIso() });
        saveLegacyEloDbFile(liveState.resolvedPath, expired.db);
        const syncWarning = getLegacyEloResyncWarning();
        const reviewMessage = await fetchLegacyEloReviewMessage(client, expired.submission);
        if (reviewMessage) {
          await reviewMessage.edit(buildLegacyEloReviewChannelPayload(expired.submission, "expired")).catch(() => {});
        }
        await interaction.reply(ephemeralPayload({ content: `Заявка протухла и помечена expired.${syncWarning}` }));
        return;
      }

      try {
        const edited = editLegacyEloSubmission(
          liveState.rawDb,
          submissionId,
          interaction.fields.getTextInputValue("elo_review_value")
        );
        saveLegacyEloDbFile(liveState.resolvedPath, edited.db);
        const syncWarning = getLegacyEloResyncWarning();
        await logLine(client, `ELO EDIT: <@${submission.userId}> pending elo ${edited.submission.elo} -> tier ${edited.submission.tier} (id ${edited.submission.id}) by ${interaction.user.tag}`);
        const reviewMessage = await fetchLegacyEloReviewMessage(client, edited.submission);
        if (reviewMessage) {
          await reviewMessage.edit(buildLegacyEloReviewChannelPayload(edited.submission, "pending", [buildLegacyEloReviewButtons(edited.submission.id)])).catch(() => {});
        }
        await interaction.reply(ephemeralPayload({ content: `ELO обновлено: ${edited.submission.elo} (тир ${edited.submission.tier}).${syncWarning}` }));
      } catch (error) {
        await interaction.reply(ephemeralPayload({ content: String(error?.message || error || "Не удалось изменить ELO в заявке.") }));
      }
      return;
    }

    if (interaction.customId.startsWith("elo_review_reject_modal:")) {
      if (!isModerator(interaction.member)) {
        await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
        return;
      }

      const submissionId = interaction.customId.split(":")[1] || "";
      const liveState = getLiveLegacyEloState();
      if (!liveState.ok) {
        await interaction.reply(buildLegacyEloStateErrorPayload("Не удалось открыть ELO review-заявку", liveState));
        return;
      }

      const submission = getLegacyEloSubmission(liveState.rawDb, submissionId);
      if (!submission) {
        await interaction.reply(ephemeralPayload({ content: "Legacy ELO заявка не найдена." }));
        return;
      }

      if (submission.status !== "pending") {
        await interaction.reply(buildLegacyEloReviewPayload(submissionId, `Заявка уже обработана: ${submission.status}.`));
        return;
      }

      if (isLegacyEloSubmissionExpired(submission, { pendingExpireHours: LEGACY_ELO_PENDING_EXPIRE_HOURS })) {
        const expired = expireLegacyEloSubmission(liveState.rawDb, submissionId, { reviewedAt: nowIso() });
        saveLegacyEloDbFile(liveState.resolvedPath, expired.db);
        const syncWarning = getLegacyEloResyncWarning();
        const reviewMessage = await fetchLegacyEloReviewMessage(client, expired.submission);
        if (reviewMessage) {
          await reviewMessage.edit(buildLegacyEloReviewChannelPayload(expired.submission, "expired")).catch(() => {});
        }
        await interaction.reply(ephemeralPayload({ content: `Заявка протухла и помечена expired.${syncWarning}` }));
        return;
      }

      const reason = String(interaction.fields.getTextInputValue("elo_review_reason") || "").trim().slice(0, 800);
      if (!reason) {
        await interaction.reply(ephemeralPayload({ content: "Нужна причина отказа." }));
        return;
      }

      const rejected = rejectLegacyEloSubmission(liveState.rawDb, submissionId, {
        reviewedBy: interaction.user.tag,
        reviewedAt: nowIso(),
        reason,
      });
      saveLegacyEloDbFile(liveState.resolvedPath, rejected.db);
      const syncWarning = getLegacyEloResyncWarning();
      await dmUser(
        client,
        submission.userId,
        [
          "Твоя ELO-заявка отклонена.",
          `Причина: ${reason}`,
          `Пруф: ${submission.screenshotUrl || submission.reviewAttachmentUrl || "—"}`,
        ].join("\n")
      );
      await logLine(client, `ELO REJECT: <@${submission.userId}> elo ${submission.elo} (id ${submission.id}) by ${interaction.user.tag} | reason: ${reason}`);
      const reviewMessage = await fetchLegacyEloReviewMessage(client, rejected.submission);
      if (reviewMessage) {
        await reviewMessage.edit(buildLegacyEloReviewChannelPayload(rejected.submission, "rejected")).catch(() => {});
      }
      await interaction.reply(ephemeralPayload({ content: `Отклонено.${syncWarning}` }));
      return;
    }

    const [kind, submissionId] = interaction.customId.split(":");
    const submission = db.submissions[submissionId];

    if (!submission) {
      await interaction.reply(ephemeralPayload({ content: "Заявка не найдена." }));
      return;
    }

    if (!isModerator(interaction.member)) {
      await interaction.reply(ephemeralPayload({ content: "Нет прав." }));
      return;
    }

    if (submission.status !== "pending") {
      await interaction.reply(ephemeralPayload({ content: `Заявка уже обработана: ${submission.status}.` }));
      return;
    }

    if (hoursSince(submission.createdAt) > PENDING_EXPIRE_HOURS) {
      await expireSubmission(client, submission);
      await interaction.reply(ephemeralPayload({ content: "Заявка уже истекла и была помечена как expired." }));
      return;
    }

    if (kind === "edit_kills") {
      const kills = parseKillCount(interaction.fields.getTextInputValue("kills"));
      if (kills === null) {
        await interaction.reply(ephemeralPayload({ content: "Нужно корректное число kills." }));
        return;
      }

      await updateSubmissionKills(client, submission, kills, interaction.user.tag);
      await interaction.reply(ephemeralPayload({
        content: `Kills обновлены: ${kills}. Новый tier: ${killTierFor(kills)} (${formatTierLabel(killTierFor(kills))}).`,
      }));
      return;
    }

    if (kind === "reject_reason") {
      const reason = String(interaction.fields.getTextInputValue("reason") || "").trim().slice(0, 800);
      if (!reason) {
        await interaction.reply(ephemeralPayload({ content: "Причина не может быть пустой." }));
        return;
      }

      await rejectSubmission(client, submission, interaction.user.tag, reason);
      await interaction.reply(ephemeralPayload({ content: "Заявка отклонена." }));
      return;
    }
  }
});

client.login(DISCORD_TOKEN);








