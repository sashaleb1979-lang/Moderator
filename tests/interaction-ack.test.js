"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_INTERACTION_PAYLOAD_TIMEOUT_MS,
  isInteractionPayloadTimeoutError,
  isUnknownInteractionError,
  resolveInteractionPayloadWithTimeout,
  safeDeferComponentUpdate,
  safeDeferEphemeralReply,
} = require("../src/runtime/interaction-ack");

test("isUnknownInteractionError matches Discord 10062 responses", () => {
  assert.equal(isUnknownInteractionError({ code: 10062, message: "Unknown interaction" }), true);
  assert.equal(isUnknownInteractionError({ message: "Unknown interaction" }), true);
  assert.equal(isUnknownInteractionError({ code: 50013, message: "Missing permissions" }), false);
});

test("resolveInteractionPayloadWithTimeout returns payload before timeout", async () => {
  const payload = await resolveInteractionPayloadWithTimeout(async () => ({ content: "ok" }), {
    label: "bot helper refresh",
    timeoutMs: 50,
  });

  assert.deepEqual(payload, { content: "ok" });
});

test("resolveInteractionPayloadWithTimeout rethrows payload builder errors", async () => {
  await assert.rejects(
    resolveInteractionPayloadWithTimeout(async () => {
      throw new Error("builder failed");
    }, {
      label: "bot helper refresh",
      timeoutMs: 50,
    }),
    /builder failed/
  );
});

test("resolveInteractionPayloadWithTimeout fails with a typed timeout error and warning", async () => {
  const warnings = [];

  await assert.rejects(
    resolveInteractionPayloadWithTimeout(() => new Promise((resolve) => {
      setTimeout(() => resolve({ content: "late" }), DEFAULT_INTERACTION_PAYLOAD_TIMEOUT_MS);
    }), {
      label: "bot helper refresh",
      timeoutMs: 10,
      logWarning: (message) => warnings.push(message),
    }),
    (error) => {
      assert.equal(isInteractionPayloadTimeoutError(error), true);
      assert.equal(error.timeoutMs, 10);
      return true;
    }
  );

  assert.deepEqual(warnings, ["bot helper refresh: interaction payload build timed out after 10ms."]);
});

test("safeDeferEphemeralReply acknowledges once when interaction is still valid", async () => {
  const calls = [];
  const interaction = {
    deferred: false,
    replied: false,
    async deferReply(payload) {
      calls.push(payload);
    },
  };

  const result = await safeDeferEphemeralReply(interaction, { label: "onboard nonfake" });

  assert.equal(result, true);
  assert.deepEqual(calls, [{ flags: 64 }]);
});

test("safeDeferEphemeralReply swallows unknown interaction expiry and reports false", async () => {
  const warnings = [];
  const interaction = {
    deferred: false,
    replied: false,
    async deferReply() {
      const error = new Error("Unknown interaction");
      error.code = 10062;
      throw error;
    },
  };

  const result = await safeDeferEphemeralReply(interaction, {
    label: "onboard nonfake",
    logWarning: (message) => warnings.push(message),
  });

  assert.equal(result, false);
  assert.deepEqual(warnings, ["onboard nonfake: interaction ack expired before deferReply."]);
});

test("safeDeferEphemeralReply rethrows non-expiry errors", async () => {
  const interaction = {
    deferred: false,
    replied: false,
    async deferReply() {
      throw new Error("network down");
    },
  };

  await assert.rejects(
    safeDeferEphemeralReply(interaction, { label: "onboard nonfake" }),
    /network down/
  );
});

test("safeDeferComponentUpdate acknowledges once when component interaction is still valid", async () => {
  const calls = [];
  const interaction = {
    deferred: false,
    replied: false,
    async deferUpdate() {
      calls.push("deferUpdate");
    },
  };

  const result = await safeDeferComponentUpdate(interaction, { label: "mains picker toggle" });

  assert.equal(result, true);
  assert.deepEqual(calls, ["deferUpdate"]);
});

test("safeDeferComponentUpdate swallows unknown interaction expiry and reports false", async () => {
  const warnings = [];
  const interaction = {
    deferred: false,
    replied: false,
    async deferUpdate() {
      const error = new Error("Unknown interaction");
      error.code = 10062;
      throw error;
    },
  };

  const result = await safeDeferComponentUpdate(interaction, {
    label: "mains picker toggle",
    logWarning: (message) => warnings.push(message),
  });

  assert.equal(result, false);
  assert.deepEqual(warnings, ["mains picker toggle: interaction ack expired before deferUpdate."]);
});

test("safeDeferComponentUpdate rethrows non-expiry errors", async () => {
  const interaction = {
    deferred: false,
    replied: false,
    async deferUpdate() {
      throw new Error("network down");
    },
  };

  await assert.rejects(
    safeDeferComponentUpdate(interaction, { label: "mains picker toggle" }),
    /network down/
  );
});