"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { renderDailyNewsCoverPng } = require("../src/news/cover");

test("renderDailyNewsCoverPng builds a PNG buffer from cover spec", async () => {
  const buffer = await renderDailyNewsCoverPng({
    masthead: "Moderator Chronicle",
    title: "Daily Issue · 14.05.2026",
    subtitle: "Главный сюжет дня: Echo поднял килы, а voice и JJS дали сильный фон выпуска.",
    accentColor: "#E6B450",
    accentColorAlt: "#4AA3FF",
    backgroundColor: "#101418",
    visualMode: "edition",
    metrics: [
      { label: "Kill jumps", value: 4, icon: "⚔️" },
      { label: "Messages", value: 128, icon: "💬" },
      { label: "JJS", value: 3, icon: "🎮" },
      { label: "New", value: 2, icon: "🆕" },
      { label: "Voice", value: 9, icon: "🎙️" },
      { label: "Audit", value: 14, icon: "🧾" },
    ],
  });

  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 1024);
  assert.equal(buffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
});