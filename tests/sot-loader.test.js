"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createSotBus } = require("../src/sot/bus");
const { loadSotState, saveSotState, syncSotShadowState, writeJsonAtomic } = require("../src/sot/loader");

test("writeJsonAtomic overwrites the destination through a temp file", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "moderator-sot-atomic-"));
  const dbPath = path.join(tempDir, "welcome-db.json");

  fs.writeFileSync(dbPath, JSON.stringify({ ok: false }, null, 2), "utf8");
  writeJsonAtomic(dbPath, { ok: true });

  assert.deepEqual(JSON.parse(fs.readFileSync(dbPath, "utf8")), { ok: true });
  assert.deepEqual(fs.readdirSync(tempDir), ["welcome-db.json"]);
});

test("loadSotState migrates an in-memory db into db.sot", () => {
  const db = {
    config: {
      welcomePanel: { channelId: "welcome-channel", messageId: "welcome-message" },
    },
  };

  const result = loadSotState(db, {
    appConfig: {
      channels: { welcomeChannelId: "welcome-channel" },
      roles: {},
      characters: [],
    },
  });

  assert.equal(result.migrated, true);
  assert.equal(db.sot.channels.welcome.value, "welcome-channel");
});

test("loadSotState imports legacy character compat data only during first migration", () => {
  const db = {
    profiles: {
      user_1: {
        mainCharacterIds: ["vessel"],
        characterRoleIds: ["role-vessel-legacy"],
      },
    },
    config: {
      generatedRoles: {
        characters: {
          vessel: "role-vessel-legacy",
        },
        characterLabels: {
          vessel: "Юджи legacy",
        },
        tiers: {},
      },
      characters: [
        { id: "legacy_only", label: "Legacy Only", roleId: "role-legacy-only" },
      ],
    },
  };

  loadSotState(db, {
    appConfig: {
      channels: {},
      roles: {},
      characters: [{ id: "vessel", label: "Vessel" }],
    },
  });

  assert.equal(db.sot.characters.vessel.roleId, "role-vessel-legacy");
  assert.equal(db.sot.characters.vessel.label, "Юджи");
  assert.equal(db.sot.characters.vessel.source, "alias");
  assert.deepEqual(db.sot.characters.vessel.evidence.aliasNames, ["Юджи"]);
  assert.equal(db.sot.characters.legacy_only, undefined);
});

test("syncSotShadowState refreshes existing db.sot when legacy fields change", () => {
  const schemaOptions = {
    appConfig: {
      channels: {
        welcomeChannelId: "welcome-channel",
        reviewChannelId: "review-a",
        tierlistChannelId: "",
        logChannelId: "",
      },
      roles: {},
      characters: [],
    },
  };
  const db = {
    config: {
      welcomePanel: { channelId: "welcome-channel", messageId: "welcome-message" },
      reviewChannelId: "review-a",
      tierlistBoard: {
        text: { channelId: "", messageId: "" },
        graphic: { channelId: "", messageId: "", lastUpdated: null },
      },
      generatedRoles: {
        characters: {},
        characterLabels: {},
        tiers: {},
      },
      integrations: {},
    },
  };

  syncSotShadowState(db, schemaOptions);
  db.config.reviewChannelId = "review-b";
  const result = syncSotShadowState(db, schemaOptions);

  assert.equal(result.refreshed, true);
  assert.equal(db.sot.channels.review.value, "review-b");
});

test("syncSotShadowState preserves manual and native-owned character records during legacy refresh", () => {
  const schemaOptions = {
    appConfig: {
      channels: {
        welcomeChannelId: "welcome-channel",
        reviewChannelId: "review-a",
        tierlistChannelId: "",
        logChannelId: "",
      },
      roles: {},
      characters: [
        { id: "vessel", label: "Vessel" },
      ],
    },
  };
  const db = {
    config: {
      welcomePanel: { channelId: "welcome-channel", messageId: "welcome-message" },
      reviewChannelId: "review-a",
      tierlistBoard: {
        text: { channelId: "", messageId: "" },
        graphic: { channelId: "", messageId: "", lastUpdated: null },
      },
      generatedRoles: {
        characters: {
          vessel: "legacy-vessel-role",
        },
        characterLabels: {
          vessel: "Юджи legacy",
        },
        tiers: {},
      },
      integrations: {},
    },
    sot: {
      sotVersion: 1,
      characters: {
        vessel: {
          id: "vessel",
          label: "Юджи native",
          englishLabel: "Vessel",
          roleId: "native-vessel-role",
          source: "discovered",
          verifiedAt: "2026-05-04T10:00:00.000Z",
          evidence: { nativeWriter: true },
          history: [
            { at: "2026-05-03T12:00:00.000Z", from: "configured", to: "discovered", oldValue: "role-old" },
          ],
        },
        manual_only: {
          id: "manual_only",
          label: "Manual Only",
          englishLabel: "Manual Only",
          roleId: "role-manual",
          source: "manual",
          verifiedAt: null,
          evidence: { manualOverride: true },
        },
      },
    },
  };

  syncSotShadowState(db, schemaOptions);

  assert.equal(db.sot.characters.vessel.roleId, "native-vessel-role");
  assert.equal(db.sot.characters.vessel.label, "Юджи native");
  assert.deepEqual(db.sot.characters.vessel.history, [
    { at: "2026-05-03T12:00:00.000Z", from: "configured", to: "discovered", oldValue: "role-old" },
  ]);
  assert.equal(db.sot.characters.manual_only.roleId, "role-manual");
  assert.equal(db.sot.characters.manual_only.source, "manual");
});

test("syncSotShadowState preserves discovered SoT records without reviving compat-only legacy character seeds", () => {
  const schemaOptions = {
    appConfig: {
      channels: {
        welcomeChannelId: "welcome-channel",
        reviewChannelId: "review-a",
        tierlistChannelId: "",
        logChannelId: "",
      },
      roles: {},
      characters: [
        { id: "vessel", label: "Vessel" },
      ],
    },
  };
  const db = {
    config: {
      welcomePanel: { channelId: "welcome-channel", messageId: "welcome-message" },
      reviewChannelId: "review-a",
      tierlistBoard: {
        text: { channelId: "", messageId: "" },
        graphic: { channelId: "", messageId: "", lastUpdated: null },
      },
      generatedRoles: {
        characters: {
          outsider: "role-outsider",
        },
        characterLabels: {
          outsider: "Outsider Legacy",
        },
        tiers: {},
      },
      characters: [
        { id: "legacy_only", label: "Legacy Only", roleId: "role-legacy-only" },
      ],
      integrations: {},
    },
    sot: {
      sotVersion: 1,
      characters: {
        vessel: {
          id: "vessel",
          label: "Юджи discovered",
          englishLabel: "Vessel",
          roleId: "role-vessel-live",
          source: "discovered",
          verifiedAt: "2026-05-04T12:00:00.000Z",
        },
      },
    },
  };

  syncSotShadowState(db, schemaOptions);

  assert.equal(db.sot.characters.vessel.roleId, "role-vessel-live");
  assert.equal(db.sot.characters.vessel.source, "discovered");
  assert.equal(db.sot.characters.outsider, undefined);
  assert.equal(db.sot.characters.legacy_only, undefined);
});

test("syncSotShadowState preserves activity SoT state during legacy refresh", () => {
  const schemaOptions = {
    appConfig: {
      channels: {
        welcomeChannelId: "welcome-channel",
        reviewChannelId: "review-a",
        tierlistChannelId: "",
        logChannelId: "",
      },
      roles: {},
      characters: [],
    },
  };
  const db = {
    config: {
      welcomePanel: { channelId: "welcome-channel", messageId: "welcome-message" },
      reviewChannelId: "review-a",
      tierlistBoard: {
        text: { channelId: "", messageId: "" },
        graphic: { channelId: "", messageId: "", lastUpdated: null },
      },
      generatedRoles: {
        characters: {},
        characterLabels: {},
        tiers: {},
      },
      integrations: {},
    },
    sot: {
      sotVersion: 1,
      activity: {
        config: {
          sessionGapMinutes: 45,
          scoreWindowDays: 30,
        },
        watchedChannels: [
          {
            channelId: "channel-1",
            enabled: true,
            channelWeight: 1,
          },
        ],
        userSnapshots: {
          user_1: {
            activityScore: 55,
            trustScore: 320,
          },
        },
        ops: {
          moderationAuditLog: [
            {
              actionType: "watch_channel_add",
              moderatorUserId: "mod-1",
            },
          ],
        },
        runtime: {
          dirtyUsers: ["user_1"],
          lastFlushAt: "2026-05-09T10:00:00.000Z",
        },
      },
    },
  };

  syncSotShadowState(db, schemaOptions);

  assert.equal(db.sot.activity.config.sessionGapMinutes, 45);
  assert.equal(db.sot.activity.config.scoreWindowDays, 30);
  assert.equal(db.sot.activity.config.channelWeightPresets.main_chat, 1);
  assert.equal(db.sot.activity.config.channelWeightPresets.flood, 0.35);
  assert.equal(db.sot.activity.config.activityRoleThresholds.core, 85);
  assert.equal(db.sot.activity.config.activityRoleThresholds.dead, 0);
  assert.deepEqual(db.sot.activity.watchedChannels, [
    {
      guildId: null,
      channelId: "channel-1",
      channelNameCache: "",
      enabled: true,
      channelType: "normal_chat",
      channelWeight: 1,
      countMessages: true,
      countSessions: true,
      countForTrust: true,
      countForRoles: true,
      importedUntilMessageId: "",
      lastScannedMessageId: "",
      lastImportAt: null,
      createdAt: null,
      updatedAt: null,
    },
  ]);
  assert.deepEqual(db.sot.activity.userSnapshots, {
    user_1: {
      activityScore: 55,
      trustScore: 320,
    },
  });
  assert.deepEqual(db.sot.activity.ops.moderationAuditLog, [
    {
      actionType: "watch_channel_add",
      moderatorUserId: "mod-1",
    },
  ]);
  assert.deepEqual(db.sot.activity.runtime.dirtyUsers, ["user_1"]);
  assert.equal(db.sot.activity.runtime.lastFlushAt, "2026-05-09T10:00:00.000Z");
  assert.deepEqual(db.sot.activity.globalUserSessions, []);
  assert.deepEqual(db.sot.activity.calibrationRuns, []);
});

test("saveSotState ensures db.sot, runs beforeWrite, and persists the full db atomically", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "moderator-sot-save-"));
  const dbPath = path.join(tempDir, "welcome-db.json");
  const db = {
    config: {
      welcomePanel: { channelId: "welcome-channel", messageId: "welcome-message" },
    },
  };
  let beforeWritePayload = null;

  const result = saveSotState({
    dbPath,
    db,
    schemaOptions: {
      appConfig: {
        channels: { welcomeChannelId: "welcome-channel" },
        roles: {},
        characters: [],
      },
    },
    beforeWrite(payload) {
      beforeWritePayload = payload;
    },
  });

  assert.equal(result.sot.channels.welcome.value, "welcome-channel");
  assert.equal(beforeWritePayload.dbPath, dbPath);
  assert.equal(beforeWritePayload.sot.channels.welcome.value, "welcome-channel");

  const written = JSON.parse(fs.readFileSync(dbPath, "utf8"));
  assert.equal(written.sot.channels.welcome.value, "welcome-channel");
});

test("saveSotState publishes bus changes after a successful write when eventBus is provided", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "moderator-sot-bus-"));
  const dbPath = path.join(tempDir, "welcome-db.json");
  const db = {
    config: {
      welcomePanel: { channelId: "welcome-channel", messageId: "welcome-message" },
    },
  };
  const bus = createSotBus();
  const events = [];

  bus.on("change", (event) => {
    events.push(`${event.domain}:${event.key}:${event.reason}`);
  });

  const result = saveSotState({
    dbPath,
    db,
    eventBus: bus,
    changeReason: "save",
    schemaOptions: {
      appConfig: {
        channels: { welcomeChannelId: "welcome-channel" },
        roles: {},
        characters: [],
      },
    },
  });

  assert.equal(result.changes.some((entry) => entry.domain === "channels" && entry.key === "welcome"), true);
  assert.equal(events.includes("channels:welcome:save"), true);
});