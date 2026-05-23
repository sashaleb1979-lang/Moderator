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
  assert.match(source, /const \{[\s\S]*recordGuildBanEvent,[\s\S]*recordMemberRemovalEvent,[\s\S]*\} = require\("\.\/src\/news\/moderation"\);/);
  assert.match(source, /buildClientReadyPeriodicJobs\(\{[\s\S]*runDailyNewsCompileTick: async \(\) => \{[\s\S]*runSerializedDbTask\(\(\) => runDailyNewsCompileTick\(\{[\s\S]*db,[\s\S]*now: nowIso,[\s\S]*saveDb,[\s\S]*\}\), "daily-news-shadow-compile"\)[\s\S]*\},[\s\S]*news: ensureNewsState\(db\)\.config,[\s\S]*\}\);/);
  assert.match(source, /client\.on\("voiceStateUpdate", async \(oldState, newState\) => \{[\s\S]*runSerializedDbTask\(\(\) => recordVoiceStateTransition\(\{[\s\S]*oldState,[\s\S]*newState,[\s\S]*now: eventRecordedAt,[\s\S]*\}\), "daily-news-voice-capture"\)/);
  assert.match(source, /client\.on\("guildMemberRemove", async \(member\) => \{[\s\S]*runSerializedDbTask\(\(\) => recordMemberRemovalEvent\(\{[\s\S]*member,[\s\S]*now: nowIso\(\),[\s\S]*\}\), "daily-news-member-remove-capture"\)/);
  assert.match(source, /client\.on\("guildBanAdd", async \(ban\) => \{[\s\S]*recordGuildBanEvent\(\{[\s\S]*eventType: "ban_add",[\s\S]*\}\), "daily-news-ban-add-capture"\)/);
  assert.match(source, /client\.on\("guildBanRemove", async \(ban\) => \{[\s\S]*recordGuildBanEvent\(\{[\s\S]*eventType: "ban_remove",[\s\S]*\}\), "daily-news-ban-remove-capture"\)/);
});