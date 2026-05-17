"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildProgressSynergyState, buildProfileSynergyState } = require("../src/profile/synergy");

test("buildProgressSynergyState derives wall-clock and JJS hours since latest approved proof window", () => {
  const state = buildProgressSynergyState({
    now: "2026-05-16T12:00:00.000Z",
    profile: {
      domains: {
        progress: {
          proofWindows: [
            {
              approvedKills: 4300,
              reviewedAt: "2026-05-15T00:00:00.000Z",
              playtimeTracked: true,
              totalJjsMinutes: 120,
            },
          ],
        },
      },
    },
    robloxSummary: {
      hasVerifiedAccount: true,
      totalJjsMinutes: 900,
    },
  });

  assert.equal(state.latestProofWindow.approvedKills, 4300);
  assert.equal(state.hoursSinceLastApprovedKillsUpdate, 36);
  assert.equal(state.jjsMinutesSinceLastApprovedKillsUpdate, 780);
  assert.equal(state.jjsHoursSinceLastApprovedKillsUpdate, 13);
  assert.equal(state.hasReliableJjsSinceLastApproved, true);
  assert.equal(state.reminderEligible, true);
});

test("buildProgressSynergyState stays honest when tracked Roblox baseline is unreliable", () => {
  const state = buildProgressSynergyState({
    now: "2026-05-16T12:00:00.000Z",
    profile: {
      domains: {
        progress: {
          proofWindows: [
            {
              approvedKills: 4300,
              reviewedAt: "2026-05-15T00:00:00.000Z",
              playtimeTracked: false,
              totalJjsMinutes: 120,
            },
          ],
        },
      },
    },
    robloxSummary: {
      hasVerifiedAccount: true,
      totalJjsMinutes: 900,
    },
  });

  assert.equal(state.hoursSinceLastApprovedKillsUpdate, 36);
  assert.equal(state.jjsHoursSinceLastApprovedKillsUpdate, null);
  assert.equal(state.hasReliableJjsSinceLastApproved, false);
  assert.equal(state.reminderEligible, false);
});

test("buildProfileSynergyState builds a self-progress block with growth window and countdowns", () => {
  const state = buildProfileSynergyState({
    now: "2026-05-16T12:00:00.000Z",
    isSelf: true,
    approvedKills: 4300,
    killTier: 3,
    profile: {
      domains: {
        progress: {
          proofWindows: [
            {
              approvedKills: 3500,
              killTier: 3,
              reviewedAt: "2026-05-05T00:00:00.000Z",
              playtimeTracked: true,
              totalJjsMinutes: 300,
            },
            {
              approvedKills: 4000,
              killTier: 3,
              reviewedAt: "2026-05-10T00:00:00.000Z",
              playtimeTracked: true,
              totalJjsMinutes: 900,
            },
            {
              approvedKills: 4300,
              killTier: 3,
              reviewedAt: "2026-05-15T00:00:00.000Z",
              playtimeTracked: true,
              totalJjsMinutes: 1200,
            },
          ],
        },
      },
    },
    robloxSummary: {
      hasVerifiedAccount: true,
      totalJjsMinutes: 1980,
    },
  });

  assert.equal(state.blocks.selfProgress.title, "Практический прогресс");
  assert.match(state.blocks.selfProgress.lines.join("\n"), /Зарегистрировано: 4.?300 kills .* tier 3/);
  assert.match(state.blocks.selfProgress.lines.join("\n"), /С последнего рега: 36 ч по времени .* 13 ч JJS/);
  assert.match(state.blocks.selfProgress.lines.join("\n"), /Последнее окно роста: 4.?000 -> 4.?300 kills .* \+300 .* 5 ч JJS .* 5 д .* 60 kills\/ч/);
  assert.match(state.blocks.selfProgress.lines.join("\n"), /Сравнение окон: последний ап 60 kills\/ч .* прошлый 50 kills\/ч .* выше прошлого окна/);
  assert.match(state.blocks.selfProgress.lines.join("\n"), /Средний темп за отслеженный период: 53,3 kills\/ч JJS .* 800 kills за 15 ч JJS .* 2 окна/);
  assert.match(state.blocks.selfProgress.lines.join("\n"), /До следующего tier: 2.?700 kills .* при текущем темпе/);
  assert.match(state.blocks.selfProgress.lines.join("\n"), /До milestone 20.?000: 15.?700 kills .* при текущем темпе/);
  assert.match(state.blocks.selfProgress.lines.join("\n"), /Есть смысл обновить kills: после последнего апрува уже 13 ч JJS/);
});