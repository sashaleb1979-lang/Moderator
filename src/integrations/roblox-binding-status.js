"use strict";

const { buildRobloxCleanupAuditRecord } = require("./roblox-cleanup-audit");

function cleanString(value, maxLength = 200) {
  if (value === undefined || value === null) return "";
  const text = String(value).trim();
  if (!text) return "";
  return text.slice(0, maxLength);
}

function normalizeRobloxPlatformUserId(value) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? String(numeric) : "";
}

function looksLikeProfile(value = {}) {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && (
      Object.prototype.hasOwnProperty.call(value, "domains")
      || (value.summary && typeof value.summary === "object" && value.summary.roblox && typeof value.summary.roblox === "object")
      || Object.prototype.hasOwnProperty.call(value, "robloxUsername")
      || Object.prototype.hasOwnProperty.call(value, "robloxUserId")
      || Object.prototype.hasOwnProperty.call(value, "robloxVerifiedAt")
    )
  );
}

function resolveReasonFromSummary(summaryValue = {}) {
  const summary = summaryValue && typeof summaryValue === "object" ? summaryValue : {};
  const trackingState = cleanString(summary.trackingState, 40).toLowerCase();
  const username = cleanString(summary.currentUsername || summary.username, 120);
  const userId = cleanString(summary.userId, 40);
  const usable = summary.isTrackable === true
    || trackingState === "trackable"
    || (!trackingState && summary.hasVerifiedAccount === true && Boolean(username) && Boolean(userId));

  if (usable) {
    return { code: "usable", usable: true };
  }

  if (trackingState === "repairable") {
    return { code: "invalid_user_id", usable: false };
  }
  if (trackingState === "manual_only") {
    return { code: "missing_account", usable: false };
  }
  if (trackingState === "pending") {
    return { code: "pending_verification", usable: false };
  }
  if (trackingState === "failed") {
    return { code: "failed_verification", usable: false };
  }

  const verificationStatus = cleanString(summary.verificationStatus, 40).toLowerCase();
  if (verificationStatus === "pending") return { code: "pending_verification", usable: false };
  if (verificationStatus === "failed") return { code: "failed_verification", usable: false };
  if (verificationStatus === "verified") return { code: "missing_account", usable: false };
  if (username || userId || verificationStatus) return { code: "unverified", usable: false };
  return { code: "missing", usable: false };
}

function resolveLegacyRootReason(profileValue = {}) {
  const profile = profileValue && typeof profileValue === "object" ? profileValue : {};
  const username = cleanString(profile.robloxUsername, 120);
  const userId = normalizeRobloxPlatformUserId(profile.robloxUserId);
  const verificationStatus = cleanString(profile.verificationStatus, 40).toLowerCase();
  const trusted = Boolean(
    cleanString(profile.robloxVerifiedAt, 80)
    || verificationStatus === "verified"
    || profile.hasVerifiedAccount === true
  );

  if (!trusted && !username && !cleanString(profile.robloxUserId, 40)) {
    return null;
  }
  if (trusted && username && userId) {
    return { code: "usable", usable: true };
  }
  if (trusted && username) {
    return { code: "invalid_user_id", usable: false };
  }
  if (trusted) {
    return { code: "missing_account", usable: false };
  }
  return null;
}

function isGenericReason(reason = null) {
  return !reason || reason.code === "missing" || reason.code === "unverified";
}

function resolveRobloxBindingReason(value = {}, options = {}) {
  if (looksLikeProfile(value)) {
    const profile = value;
    const summaryReason = profile?.summary?.roblox && typeof profile.summary.roblox === "object"
      ? resolveReasonFromSummary(profile.summary.roblox)
      : null;
    const legacyRootReason = resolveLegacyRootReason(profile);
    const userId = cleanString(options.userId || profile.userId, 80);
    const record = buildRobloxCleanupAuditRecord(profile, userId, {
      robloxConfirmations: options.robloxConfirmations,
    });

    if (options.includeConfirmOnly === true && record.usableWithoutAntiteamConfirmation) {
      return { code: "confirm_only", usable: false };
    }
    if (record.primaryCohort === "usable_verified") {
      return { code: "usable", usable: true };
    }
    if (record.suspiciousPollution) {
      return { code: "suspicious_identity", usable: false };
    }
    const auditReason = resolveReasonFromSummary({
      trackingState: record.trackingState,
      trackingBlocker: record.trackingBlocker,
      verificationStatus: record.verificationStatus,
      currentUsername: record.robloxUsername,
      username: record.robloxUsername,
      userId: record.robloxUserId,
    });

    if (isGenericReason(auditReason) && summaryReason && !isGenericReason(summaryReason)) {
      return summaryReason;
    }
    if (isGenericReason(auditReason) && isGenericReason(summaryReason) && legacyRootReason) {
      return legacyRootReason;
    }
    return auditReason;
  }

  return resolveReasonFromSummary(value);
}

function formatRobloxBindingStatusLine(value = {}, options = {}) {
  const reason = resolveRobloxBindingReason(value, options);
  switch (reason.code) {
    case "usable":
      return "Roblox-связка: подтверждена.";
    case "invalid_user_id":
      return "Roblox-связка: нужна перепривязка, нет валидного Roblox userId.";
    case "missing_account":
      return "Roblox-связка: нужна перепривязка, нет полного Roblox аккаунта.";
    case "suspicious_identity":
      return "Roblox-связка: нужна перепривязка, текущий ник выглядит недостоверным.";
    case "pending_verification":
      return "Roblox-связка: проверка ещё не завершена.";
    case "failed_verification":
      return "Roblox-связка: предыдущая проверка не прошла.";
    case "confirm_only":
      return "Roblox-связка: подтверждена, но антитим ещё ждёт одноразовое подтверждение.";
    default:
      return "Roblox-связка: не подтверждена.";
  }
}

function formatRobloxReadinessLabel(value = {}, options = {}) {
  const reason = resolveRobloxBindingReason(value, options);
  switch (reason.code) {
    case "usable":
      return "Roblox связан";
    case "pending_verification":
      return "Roblox ждёт проверки";
    case "confirm_only":
      return "Roblox связан, ждёт подтверждения антитима";
    case "invalid_user_id":
    case "missing_account":
    case "suspicious_identity":
    case "failed_verification":
      return "Roblox требует перепривязки";
    default:
      return "Roblox не подтверждён";
  }
}

function getRobloxBindingRecoveryText(value = {}, options = {}) {
  const reason = resolveRobloxBindingReason(value, options);
  const audience = cleanString(options.audience, 40).toLowerCase();

  switch (reason.code) {
    case "invalid_user_id":
      return audience === "antiteam"
        ? "Старая Roblox-связка повреждена: в профиле нет валидного Roblox userId, поэтому бот не возьмёт её автоматически."
        : "Старая Roblox-связка повреждена: в профиле нет валидного Roblox userId. Укажи аккаунт заново.";
    case "missing_account":
      return audience === "antiteam"
        ? "Старая Roblox-связка неполная: в профиле нет полного Roblox аккаунта, поэтому бот не возьмёт её автоматически."
        : "Старая Roblox-связка неполная: в профиле нет полного Roblox аккаунта. Укажи аккаунт заново.";
    case "suspicious_identity":
      return audience === "antiteam"
        ? "Старая Roblox-связка выглядит недостоверной и не будет взята автоматически. Внеси Roblox ник вручную."
        : "Старая Roblox-связка выглядит недостоверной и не будет переиспользована. Укажи аккаунт заново.";
    case "pending_verification":
      return audience === "antiteam"
        ? "Прошлая Roblox-проверка ещё не завершена, поэтому бот не может взять её автоматически."
        : "Прошлая Roblox-проверка ещё не завершена, поэтому укажи аккаунт заново.";
    case "failed_verification":
      return audience === "antiteam"
        ? "Прошлая Roblox-проверка не прошла, поэтому бот не может взять её автоматически."
        : "Прошлая Roblox-проверка не прошла, поэтому укажи аккаунт заново.";
    case "confirm_only":
      return audience === "antiteam"
        ? "Roblox уже связан, но для антитима ещё нужно одноразовое подтверждение."
        : "";
    default:
      return "";
  }
}

module.exports = {
  formatRobloxBindingStatusLine,
  formatRobloxReadinessLabel,
  getRobloxBindingRecoveryText,
  resolveRobloxBindingReason,
};