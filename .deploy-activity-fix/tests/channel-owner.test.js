"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  applyChannelLink,
  applyChannelOverrideBatch,
  ChannelOverrideBatchError,
  clearChannelLink,
  getChangedChannelOverrides,
  normalizeChannelSlot,
} = require("../src/onboard/channel-owner");

function createHelpers(overrides = {}) {
  const welcomePanelState = overrides.welcomePanelState || { channelId: "welcome-home", messageId: "welcome-msg" };
  const nonGgsPanelState = overrides.nonGgsPanelState || { channelId: "welcome-home", messageId: "captcha-msg" };
  const textBoardState = overrides.textBoardState || {
    channelId: "text-home",
    messageId: "legacy-msg",
    messageIdSummary: "summary-msg",
    messageIdPages: "pages-msg",
  };
  const graphicBoardState = overrides.graphicBoardState || {
    channelId: "graphic-home",
    messageId: "graphic-msg",
  };
  const dbState = {
    reviewChannelId: overrides.reviewChannelId ?? "review-home",
    notificationChannelId: overrides.notificationChannelId ?? "log-home",
  };

  let saveCalls = 0;
  const deleteCalls = [];

  return {
    state: {
      welcomePanelState,
      nonGgsPanelState,
      textBoardState,
      graphicBoardState,
      dbState,
      get saveCalls() {
        return saveCalls;
      },
      get deleteCalls() {
        return deleteCalls;
      },
    },
    helpers: {
      clearTextTierlistBoardMessageIds(state) {
        state.messageId = "";
        state.messageIdSummary = "";
        state.messageIdPages = "";
      },
      formatChannelMention(channelId) {
        return `<#${channelId}>`;
      },
      getGraphicTierlistBoardState() {
        return graphicBoardState;
      },
      getNonGgsPanelState() {
        return nonGgsPanelState;
      },
      getResolvedChannelId(slot) {
        if (slot === "review") return dbState.reviewChannelId;
        if (slot === "log") return dbState.notificationChannelId;
        return "";
      },
      getResolvedGraphicTierlistBoardSnapshot() {
        return { ...graphicBoardState };
      },
      getResolvedNonGgsPanelSnapshot() {
        return { ...nonGgsPanelState };
      },
      getResolvedTextTierlistBoardSnapshot() {
        return { ...textBoardState };
      },
      getResolvedWelcomePanelSnapshot() {
        return { ...welcomePanelState };
      },
      getTextTierlistBoardState() {
        return textBoardState;
      },
      getWelcomePanelState() {
        return welcomePanelState;
      },
      saveDb() {
        saveCalls += 1;
      },
      async deleteManagedChannelMessage(channelId, messageId) {
        deleteCalls.push({ channelId, messageId });
        return true;
      },
      setNotificationChannelId(channelId) {
        dbState.notificationChannelId = channelId;
      },
      setReviewChannelId(channelId) {
        dbState.reviewChannelId = channelId;
      },
      syncLegacyGraphicTierlistBoardSnapshot(state, snapshot) {
        return Object.assign(state, snapshot);
      },
      syncLegacyPanelSnapshot(state, snapshot) {
        return Object.assign(state, snapshot);
      },
      syncLegacyTextTierlistBoardSnapshot(state, snapshot) {
        return Object.assign(state, snapshot);
      },
    },
  };
}

test("normalizeChannelSlot supports legacy and operator aliases", () => {
  assert.equal(normalizeChannelSlot("welcome"), "welcome");
  assert.equal(normalizeChannelSlot("Text Tierlist"), "tierlistText");
  assert.equal(normalizeChannelSlot("graphic-tierlist"), "tierlistGraphic");
  assert.equal(normalizeChannelSlot("notifications"), "log");
  assert.equal(normalizeChannelSlot("unknown"), "");
});

test("applyChannelLink delegates populated channel moves to linkChannel", async () => {
  const calls = [];
  const result = await applyChannelLink({
    slot: "graphic",
    targetChannelId: "1234567890",
    clearChannel: () => assert.fail("clearChannel should not be called"),
    linkChannel: async (slot, channelId) => {
      calls.push({ slot, channelId });
      return `linked:${slot}:${channelId}`;
    },
  });

  assert.equal(result, "linked:tierlistGraphic:1234567890");
  assert.deepEqual(calls, [{ slot: "tierlistGraphic", channelId: "1234567890" }]);
});

test("applyChannelLink routes blank values to clearChannel only when allowClear is enabled", async () => {
  await assert.rejects(
    () => applyChannelLink({
      slot: "review",
      targetChannelId: "",
      clearChannel: () => assert.fail("clearChannel should not run without allowClear"),
      linkChannel: () => assert.fail("linkChannel should not run for blank target"),
    }),
    /Нужно указать текстовый канал/
  );

  let clearedSlot = "";
  const result = await applyChannelLink({
    slot: "notices",
    targetChannelId: "",
    allowClear: true,
    clearChannel: async (slot) => {
      clearedSlot = slot;
      return `cleared:${slot}`;
    },
    linkChannel: () => assert.fail("linkChannel should not run when clearing"),
  });

  assert.equal(result, "cleared:log");
  assert.equal(clearedSlot, "log");
});

test("getChangedChannelOverrides keeps only slots with real channel changes", () => {
  const changed = getChangedChannelOverrides([
    { slot: "welcome", channelId: "welcome-home" },
    { slot: "review", channelId: "review-new" },
    { slot: "tierlistText", channelId: "" },
    { slot: "log", channelId: "log-home" },
  ], (slot) => {
    if (slot === "welcome") return "welcome-home";
    if (slot === "review") return "review-home";
    if (slot === "tierlistText") return "text-home";
    if (slot === "log") return "log-home";
    return "";
  });

  assert.deepEqual(changed, [
    {
      slot: "review",
      channelId: "review-new",
      currentChannelId: "review-home",
    },
    {
      slot: "tierlistText",
      channelId: "",
      currentChannelId: "text-home",
    },
  ]);
});

test("applyChannelOverrideBatch skips unchanged overrides and preserves input order for changed slots", async () => {
  const calls = [];

  const result = await applyChannelOverrideBatch({
    channelOverrides: [
      { slot: "welcome", channelId: "welcome-home" },
      { slot: "review", channelId: "review-new" },
      { slot: "log", channelId: "log-new" },
    ],
    getCurrentChannelId(slot) {
      if (slot === "welcome") return "welcome-home";
      if (slot === "review") return "review-home";
      if (slot === "log") return "log-home";
      return "";
    },
    async applyChannelOverride(slot, channelId, options) {
      calls.push({ slot, channelId, options });
      return `${slot}:${channelId || "clear"}`;
    },
  });

  assert.deepEqual(result.changedChannelOverrides, [
    { slot: "review", channelId: "review-new", currentChannelId: "review-home" },
    { slot: "log", channelId: "log-new", currentChannelId: "log-home" },
  ]);
  assert.deepEqual(result.statusNotes, ["review:review-new", "log:log-new"]);
  assert.deepEqual(calls, [
    { slot: "review", channelId: "review-new", options: { allowClear: true, currentChannelId: "review-home" } },
    { slot: "log", channelId: "log-new", options: { allowClear: true, currentChannelId: "log-home" } },
  ]);
});

test("applyChannelOverrideBatch rolls back already applied slots when a later override fails", async () => {
  const calls = [];

  await assert.rejects(
    () => applyChannelOverrideBatch({
      channelOverrides: [
        { slot: "review", channelId: "review-new" },
        { slot: "log", channelId: "log-new" },
      ],
      getCurrentChannelId(slot) {
        if (slot === "review") return "review-home";
        if (slot === "log") return "log-home";
        return "";
      },
      async applyChannelOverride(slot, channelId, options) {
        calls.push({ slot, channelId, options });
        if (slot === "log" && !options?.isRollback) {
          throw new Error("log apply failed");
        }
        return `${slot}:${channelId || "clear"}`;
      },
    }),
    (error) => {
      assert.equal(error instanceof ChannelOverrideBatchError, true);
      assert.equal(error.message, "log apply failed");
      assert.deepEqual(error.appliedOverrides, [
        { slot: "review", channelId: "review-new", currentChannelId: "review-home" },
      ]);
      assert.deepEqual(error.rollbackFailures, []);
      assert.deepEqual(error.failedOverride, {
        slot: "log",
        channelId: "log-new",
        currentChannelId: "log-home",
      });
      return true;
    }
  );

  assert.deepEqual(calls, [
    { slot: "review", channelId: "review-new", options: { allowClear: true, currentChannelId: "review-home" } },
    { slot: "log", channelId: "log-new", options: { allowClear: true, currentChannelId: "log-home" } },
    { slot: "review", channelId: "review-home", options: { allowClear: true, currentChannelId: "review-new", isRollback: true } },
  ]);
});

test("applyChannelOverrideBatch reports rollback failures without swallowing the original apply error", async () => {
  await assert.rejects(
    () => applyChannelOverrideBatch({
      channelOverrides: [
        { slot: "review", channelId: "review-new" },
        { slot: "log", channelId: "log-new" },
      ],
      getCurrentChannelId(slot) {
        if (slot === "review") return "review-home";
        if (slot === "log") return "log-home";
        return "";
      },
      async applyChannelOverride(slot, channelId, options) {
        if (slot === "review" && options?.isRollback) {
          throw new Error("review rollback failed");
        }
        if (slot === "log" && !options?.isRollback) {
          throw new Error("log apply failed");
        }
        return `${slot}:${channelId || "clear"}`;
      },
    }),
    (error) => {
      assert.equal(error instanceof ChannelOverrideBatchError, true);
      assert.equal(error.message, "log apply failed");
      assert.equal(error.rollbackFailures.length, 1);
      assert.equal(error.rollbackFailures[0].slot, "review");
      assert.equal(String(error.rollbackFailures[0].error?.message || ""), "review rollback failed");
      return true;
    }
  );
});

test("clearChannelLink clears welcome and nonGgs panel state together", async () => {
  const { helpers, state } = createHelpers();

  const status = await clearChannelLink("welcome", helpers);

  assert.deepEqual(state.welcomePanelState, { channelId: "", messageId: "" });
  assert.deepEqual(state.nonGgsPanelState, { channelId: "", messageId: "" });
  assert.deepEqual(state.deleteCalls, [
    { channelId: "welcome-home", messageId: "welcome-msg" },
    { channelId: "welcome-home", messageId: "captcha-msg" },
  ]);
  assert.equal(state.saveCalls, 1);
  assert.match(status, /Welcome и non-JJS panel отключены/);
  assert.match(status, /<#welcome-home>/);
});

test("clearChannelLink clears review channel binding", async () => {
  const { helpers, state } = createHelpers();

  const status = await clearChannelLink("review", helpers);

  assert.equal(state.dbState.reviewChannelId, "");
  assert.deepEqual(state.deleteCalls, []);
  assert.equal(state.saveCalls, 1);
  assert.match(status, /Review channel очищен/);
  assert.match(status, /<#review-home>/);
});

test("clearChannelLink clears text tierlist channel and all managed message ids", async () => {
  const { helpers, state } = createHelpers();

  const status = await clearChannelLink("tierlistText", helpers);

  assert.deepEqual(state.textBoardState, {
    channelId: "",
    messageId: "",
    messageIdSummary: "",
    messageIdPages: "",
  });
  assert.deepEqual(state.deleteCalls, [
    { channelId: "text-home", messageId: "legacy-msg" },
    { channelId: "text-home", messageId: "summary-msg" },
    { channelId: "text-home", messageId: "pages-msg" },
  ]);
  assert.equal(state.saveCalls, 1);
  assert.match(status, /Text tierlist очищен/);
  assert.match(status, /<#text-home>/);
});

test("clearChannelLink clears graphic tierlist channel binding", async () => {
  const { helpers, state } = createHelpers();

  const status = await clearChannelLink("tierlistGraphic", helpers);

  assert.deepEqual(state.graphicBoardState, {
    channelId: "",
    messageId: "",
  });
  assert.deepEqual(state.deleteCalls, [
    { channelId: "graphic-home", messageId: "graphic-msg" },
  ]);
  assert.equal(state.saveCalls, 1);
  assert.match(status, /Graphic tierlist очищен/);
  assert.match(status, /<#graphic-home>/);
});

test("clearChannelLink clears log channel binding", async () => {
  const { helpers, state } = createHelpers();

  const status = await clearChannelLink("log", helpers);

  assert.equal(state.dbState.notificationChannelId, "");
  assert.deepEqual(state.deleteCalls, []);
  assert.equal(state.saveCalls, 1);
  assert.match(status, /Notice\/log channel очищен/);
  assert.match(status, /<#log-home>/);
});