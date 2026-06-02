"use strict";

const { cleanString } = require("./state");

function getInteractionType(interaction = {}) {
  if (interaction?.isChatInputCommand?.()) return "command";
  if (interaction?.isButton?.()) return "button";
  if (interaction?.isStringSelectMenu?.()) return "select";
  if (interaction?.isModalSubmit?.()) return "modal";
  return "interaction";
}

function getSubcommand(interaction = {}) {
  try {
    return cleanString(interaction?.options?.getSubcommand?.(false), 80);
  } catch {
    return "";
  }
}

function classifySlashCommand(interaction = {}) {
  const commandName = cleanString(interaction.commandName, 80);
  const subcommand = getSubcommand(interaction);
  if (!commandName) return null;

  const action = subcommand ? `slash_${subcommand}` : "slash";
  if (commandName === "профиль") return { feature: "profile", action: "open_slash" };
  if (commandName === "антитим") return { feature: "antiteam", action };
  if (commandName === "combo") return { feature: "combo_guide", action };
  if (commandName === "onboard") return { feature: "onboarding", action };
  if (commandName === "rolepanel") return { feature: "role_panel", action: "open_slash" };
  if (commandName === "verify") return { feature: "verification", action };
  if (commandName === "analytics") return { feature: "analytics", action };
  return { feature: commandName, action };
}

function parseColonId(value = "") {
  return cleanString(value, 300).split(":").map((part) => cleanString(part, 120));
}

function classifyProfileCustomId(customId = "") {
  if (customId === "profile_bind_roblox") return { feature: "profile", action: "roblox_bind_open" };
  if (customId === "profile_bind_roblox_modal") return { feature: "profile", action: "roblox_bind_submit" };
  if (customId === "elo_submit_card") return { feature: "profile", action: "elo_compact_card_open" };
  if (customId.startsWith("profile_open:")) {
    const [, requesterUserId, targetUserId] = parseColonId(customId);
    return { feature: "profile", action: "open_card", targetUserId, metadata: { requesterUserId } };
  }
  if (customId.startsWith("profile_nav:")) {
    const [, requesterUserId, targetUserId, view] = parseColonId(customId);
    return { feature: "profile", action: `nav_${view || "unknown"}`, targetUserId, metadata: { requesterUserId, view } };
  }
  if (customId.startsWith("profile_rating_detail:")) {
    const [, requesterUserId, targetUserId, axis] = parseColonId(customId);
    return { feature: "profile", action: `rating_detail_${axis || "unknown"}`, targetUserId, metadata: { requesterUserId, axis } };
  }
  return null;
}

function classifyAntiteamCustomId(customId = "") {
  if (!customId.startsWith("at:")) return null;
  const parts = parseColonId(customId);
  if (parts[1] === "ticket") {
    return {
      feature: "antiteam",
      action: `ticket_${parts[2] || "unknown"}`,
      targetUserId: "",
      metadata: { ticketId: parts[3] || "", extra: parts.slice(4).join(":") },
    };
  }
  if (parts[1] === "stats") {
    return { feature: "antiteam", action: `stats_${parts[2] || "open"}`, metadata: { extra: parts.slice(3).join(":") } };
  }
  const known = {
    open: "open",
    progress: "progress",
    leaders: "leaders",
    guide: "guide",
    roblox: parts[2] ? `roblox_${parts[2]}` : "roblox",
    battalion: parts[2] ? `battalion_${parts[2]}` : "battalion",
    config: parts[2] ? `config_${parts[2]}` : "config",
    ping: parts[2] ? `ping_${parts[2]}` : "ping",
    panel: parts[2] ? `panel_${parts[2]}` : "panel",
    level: "draft_level",
    count: "draft_count",
    clan_roles: "draft_clan_roles",
    toggle: parts[2] ? `draft_toggle_${parts[2]}` : "draft_toggle",
    desc: parts[2] ? `draft_description_${parts[2]}` : "draft_description",
    submit: "draft_submit",
    photo: parts[2] ? `photo_${parts[2]}` : "photo",
    cancel: "draft_cancel",
  };
  return { feature: "antiteam", action: known[parts[1]] || parts.slice(1).join("_") || "unknown" };
}

function classifyOnboardingCustomId(customId = "") {
  if (customId === "onboard_begin") return { feature: "onboarding", action: "begin" };
  if (customId === "onboard_quick_mains") return { feature: "onboarding", action: "quick_mains" };
  if (customId === "onboard_change_mains") return { feature: "onboarding", action: "change_mains" };
  if (customId === "onboard_set_roblox_username") return { feature: "onboarding", action: "roblox_open" };
  if (customId === "onboard_roblox_username_modal") return { feature: "onboarding", action: "roblox_submit" };
  if (customId.startsWith("onboard_main_toggle:")) return { feature: "onboarding", action: "main_toggle", metadata: { characterId: customId.slice("onboard_main_toggle:".length) } };
  if (customId.startsWith("non_ggs_captcha_answer:")) return { feature: "onboarding", action: "non_jjs_captcha_answer", metadata: { answer: customId.split(":")[1] || "" } };
  if (customId.startsWith("approve:")) return { feature: "onboarding", action: "review_approve", metadata: { submissionId: customId.split(":")[1] || "" } };
  if (customId.startsWith("edit:")) return { feature: "onboarding", action: "review_edit", metadata: { submissionId: customId.split(":")[1] || "" } };
  if (customId.startsWith("reject:")) return { feature: "onboarding", action: "review_reject", metadata: { submissionId: customId.split(":")[1] || "" } };
  if (customId.startsWith("reject_reason:")) return { feature: "onboarding", action: "review_reject_submit", metadata: { submissionId: customId.split(":")[1] || "" } };
  if (customId.startsWith("edit_kills:")) return { feature: "onboarding", action: "review_edit_submit", metadata: { submissionId: customId.split(":")[1] || "" } };
  if (customId.startsWith("onboard_")) return { feature: "onboarding", action: customId.replace(/^onboard_/, "") };
  return null;
}

function classifyTierlistCustomId(customId = "") {
  if (customId.startsWith("text_tierlist_")) return { feature: "tierlist", action: customId };
  if (customId.startsWith("graphic_") || customId.startsWith("panel_")) {
    if (customId.startsWith("panel_open_")) return null;
    if (customId.startsWith("panel_mode_") || customId.startsWith("panel_access_") || customId.startsWith("panel_refresh_") || customId.startsWith("panel_sync_") || customId.startsWith("panel_config_") || customId.startsWith("panel_remind_") || customId.startsWith("panel_add_")) {
      return { feature: "moderator_panel", action: customId.replace(/^panel_/, "") };
    }
    return { feature: "tierlist", action: customId };
  }
  if (["start_rating", "rate_new_characters", "my_status", "refresh_tierlist", "select_main", "point_rate_select"].includes(customId)) {
    return { feature: "tierlist", action: customId };
  }
  if (customId.startsWith("panel_part_") || customId.startsWith("panel_tab_") || customId.startsWith("panel_confirm_") || customId.startsWith("panel_cancel_")) {
    return { feature: "tierlist", action: customId };
  }
  return null;
}

function classifyEloCustomId(customId = "") {
  if (customId.startsWith("elo_submit_")) return { feature: "elo", action: customId };
  if (customId.startsWith("elo_review_")) {
    const [action, submissionId] = parseColonId(customId);
    return { feature: "elo", action, metadata: { submissionId } };
  }
  if (customId.startsWith("elo_panel_")) return { feature: "elo", action: customId };
  return null;
}

function classifyComboCustomId(customId = "") {
  if (!customId.startsWith("combo_")) return null;
  const metadata = {};
  if (customId.startsWith("combo_panel_remove_char:")) {
    metadata.characterId = customId.split(":")[1] || "";
    return { feature: "combo_guide", action: "panel_remove_character", metadata };
  }
  if (customId.startsWith("combo_edit_message:")) {
    metadata.messageId = customId.split(":")[1] || "";
    return { feature: "combo_guide", action: "edit_message_submit", metadata };
  }
  return { feature: "combo_guide", action: customId.replace(/^combo_/, "") };
}

function classifyRolePanelCustomId(customId = "") {
  if (customId.startsWith("rolepanel_grant:")) {
    const [, recordId, buttonIndex] = parseColonId(customId);
    return { feature: "role_panel", action: "grant_role", metadata: { recordId, buttonIndex } };
  }
  if (customId.startsWith("rolepanel_")) return { feature: "role_panel", action: customId.replace(/^rolepanel_/, "") };
  return null;
}

function classifyVerificationCustomId(customId = "") {
  if (customId.startsWith("verification_report_")) {
    const [action, targetUserId] = parseColonId(customId);
    return { feature: "verification", action, targetUserId };
  }
  if (customId.startsWith("verification_")) return { feature: "verification", action: customId.replace(/^verification_/, "") };
  return null;
}

function classifyActivityOrNewsCustomId(customId = "") {
  if (customId === "panel_open_activity" || customId.startsWith("activity_panel_")) {
    return { feature: "activity_panel", action: customId.replace(/^activity_panel_/, "").replace(/^panel_open_/, "open_") };
  }
  if (customId === "panel_open_daily_news" || customId.startsWith("daily_news_panel_")) {
    return { feature: "daily_news", action: customId.replace(/^daily_news_panel_/, "").replace(/^panel_open_/, "open_") };
  }
  return null;
}

function classifyAnalyticsCustomId(customId = "") {
  if (customId === "panel_open_analytics") return { feature: "analytics", action: "open_panel" };
  if (customId.startsWith("analytics_panel_")) return { feature: "analytics", action: customId.replace(/^analytics_panel_/, "") };
  return null;
}

function classifyInteraction(interaction = {}) {
  const interactionType = getInteractionType(interaction);
  const base = interactionType === "command"
    ? classifySlashCommand(interaction)
    : [
        classifyAnalyticsCustomId,
        classifyProfileCustomId,
        classifyAntiteamCustomId,
        classifyOnboardingCustomId,
        classifyEloCustomId,
        classifyComboCustomId,
        classifyRolePanelCustomId,
        classifyVerificationCustomId,
        classifyActivityOrNewsCustomId,
        classifyTierlistCustomId,
      ].map((fn) => fn(cleanString(interaction.customId, 300))).find(Boolean);

  if (!base) {
    const raw = cleanString(interaction.customId || interaction.commandName, 120);
    return raw ? { feature: "unknown", action: raw } : null;
  }

  return {
    feature: cleanString(base.feature, 80) || "unknown",
    action: cleanString(base.action, 120) || "unknown",
    targetUserId: cleanString(base.targetUserId, 80),
    interactionType,
    metadata: base.metadata || {},
  };
}

function buildAnalyticsEventFromInteraction(interaction = {}, options = {}) {
  const classified = classifyInteraction(interaction);
  if (!classified) return null;
  return {
    feature: classified.feature,
    action: classified.action,
    actorUserId: cleanString(interaction?.user?.id, 80),
    targetUserId: classified.targetUserId,
    guildId: cleanString(interaction?.guildId || interaction?.guild?.id, 80),
    channelId: cleanString(interaction?.channelId || interaction?.channel?.id, 80),
    messageId: cleanString(interaction?.message?.id, 80),
    interactionType: classified.interactionType,
    outcome: options.outcome || "received",
    metadata: {
      customId: cleanString(interaction?.customId, 240),
      commandName: cleanString(interaction?.commandName, 80),
      ...classified.metadata,
    },
  };
}

module.exports = {
  buildAnalyticsEventFromInteraction,
  classifyInteraction,
  getInteractionType,
};
