"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("welcome-bot wires daily-news capture owners into live Discord events", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "welcome-bot.js"), "utf8");

  assert.match(source, /const \{ ensureNewsState \} = require\("\.\/src\/news\/state"\);/);
  assert.match(source, /const \{ runDailyNewsCompileTick \} = require\("\.\/src\/news\/scheduler"\);/);
  assert.match(source, /const \{ recordVoiceStateTransition \} = require\("\.\/src\/news\/voice"\);/);
  assert.match(source, /const \{[\s\S]*collectPendingMemberRemovalEvents,[\s\S]*createMemberRemovalReconciliationId,[\s\S]*reconcileMemberRemovalEvents,[\s\S]*recordGuildBanEvent,[\s\S]*recordMemberRemovalEvent,[\s\S]*recordMemberTimeoutEvent,[\s\S]*\} = require\("\.\/src\/news\/moderation"\);/);
  assert.match(source, /buildClientReadyPeriodicJobs\(\{[\s\S]*runDailyNewsCompileTick: async \(\) => \{[\s\S]*const nowValue = nowIso\(\);[\s\S]*resolveDailyNewsPendingMemberRemovalResolutions\(client, nowValue\)[\s\S]*runSerializedDbTask\(\(\) => runDailyNewsCompileTick\(\{[\s\S]*db,[\s\S]*now: nowValue,[\s\S]*saveDb,[\s\S]*beforeCompile: \(\) => reconcileMemberRemovalEvents\([\s\S]*\),[\s\S]*\}\), "daily-news-shadow-compile"\)[\s\S]*\},[\s\S]*news: ensureNewsState\(db\)\.config,[\s\S]*\}\);/);
  assert.match(source, /client\.on\("voiceStateUpdate", async \(oldState, newState\) => \{[\s\S]*runSerializedDbTask\(\(\) => recordVoiceStateTransition\(\{[\s\S]*oldState,[\s\S]*newState,[\s\S]*now: eventRecordedAt,[\s\S]*\}\), "daily-news-voice-capture"\)/);
  assert.match(source, /client\.on\("guildMemberUpdate", async \(oldMember, newMember\) => \{[\s\S]*runSerializedDbTask\(\(\) => recordMemberTimeoutEvent\(\{[\s\S]*oldMember,[\s\S]*newMember,[\s\S]*now: nowIso\(\),[\s\S]*\}\), "daily-news-timeout-capture"\)/);
  assert.match(source, /async function resolveDailyNewsMemberRemovalResolution\(\{ member = null, guild = null, userId = "", occurredAt = "" \} = \{\}\) \{[\s\S]*fetchAuditLogs\(\{ type: AuditLogEvent\.MemberKick, limit: 6 \}\)[\s\S]*buildDailyNewsKickResolution/);
  assert.match(source, /async function resolveDailyNewsPendingMemberRemovalResolutions\(currentClient, now = null\) \{[\s\S]*collectPendingMemberRemovalEvents\(\{ db, now \}\)[\s\S]*createMemberRemovalReconciliationId/);
  assert.match(source, /client\.on\("guildMemberRemove", async \(member\) => \{[\s\S]*const occurredAt = nowIso\(\);[\s\S]*resolveDailyNewsMemberRemovalResolution\(\{ member, occurredAt \}\)\.catch\([\s\S]*runSerializedDbTask\(\(\) => recordMemberRemovalEvent\(\{[\s\S]*member,[\s\S]*resolveRemovalResolution: \(\) => resolvedRemoval,[\s\S]*now: occurredAt,[\s\S]*\}\), "daily-news-member-remove-capture"\)/);
  assert.match(source, /client\.on\("guildBanAdd", async \(ban\) => \{[\s\S]*recordGuildBanEvent\(\{[\s\S]*eventType: "ban_add",[\s\S]*\}\), "daily-news-ban-add-capture"\)/);
  assert.match(source, /client\.on\("guildBanRemove", async \(ban\) => \{[\s\S]*recordGuildBanEvent\(\{[\s\S]*eventType: "ban_remove",[\s\S]*\}\), "daily-news-ban-remove-capture"\)/);
});

test("welcome-bot wires Daily News operator panel into moderator panel routing", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "welcome-bot.js"), "utf8");

  assert.match(source, /const \{[\s\S]*handleDailyNewsPanelButtonInteraction,[\s\S]*handleDailyNewsPanelModalSubmitInteraction,[\s\S]*\} = require\("\.\/src\/news\/operator"\);/);
  assert.match(source, /new ButtonBuilder\(\)\.setCustomId\("panel_open_daily_news"\)\.setLabel\("Daily News"\)\.setStyle\(ButtonStyle\.Secondary\)/);
  assert.match(source, /if \(await handleDailyNewsPanelButtonInteraction\(\{[\s\S]*interaction,[\s\S]*client,[\s\S]*db,[\s\S]*isModerator,[\s\S]*buildBackPayload: async \(\) => buildModeratorPanelPayloadSafe\(client, "", false\),[\s\S]*saveDb,[\s\S]*now: nowIso\(\),[\s\S]*\}\)\) \{/);
  assert.match(source, /if \(await runInteractionHandlerSafely\([\s\S]*"Daily News panel modal interaction failed",[\s\S]*\(\) => handleDailyNewsPanelModalSubmitInteraction\(\{[\s\S]*interaction,[\s\S]*db,[\s\S]*isModerator,[\s\S]*saveDb,[\s\S]*now: nowIso\(\),[\s\S]*\}\)[\s\S]*\)\) \{/);
});