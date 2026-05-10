"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  createCaptchaChallenge,
  getCaptchaCatalogIssues,
  loadCaptchaCatalog,
  resolveCaptchaAssetPath,
} = require("../src/onboard/non-jjs-captcha");

test("captcha asset resolver finds numbered files in the configured directory", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "non-jjs-captcha-"));
  fs.writeFileSync(path.join(tempDir, "1.png"), "");
  fs.writeFileSync(path.join(tempDir, "3.jpg"), "");
  fs.writeFileSync(path.join(tempDir, "6.jpeg"), "");

  assert.equal(resolveCaptchaAssetPath(tempDir, 1), path.join(tempDir, "1.png"));
  assert.equal(resolveCaptchaAssetPath(tempDir, 3), path.join(tempDir, "3.jpg"));
  assert.equal(resolveCaptchaAssetPath(tempDir, 6), path.join(tempDir, "6.jpeg"));
  assert.equal(resolveCaptchaAssetPath(tempDir, 9), "");

  const catalog = loadCaptchaCatalog(tempDir);
  assert.deepEqual(catalog.skillful.map((entry) => entry.slot), [1, 3]);
  assert.deepEqual(catalog.outliers.map((entry) => entry.slot), [6]);
});

test("captcha challenge always contains eight skillful cells and one outlier", () => {
  const catalog = {
    skillful: [{ slot: 2, path: "skill.png" }],
    outliers: [{ slot: 9, path: "outlier.png" }],
  };
  let calls = 0;
  const randomValues = [0.1, 0.1, 0.8];

  const challenge = createCaptchaChallenge(catalog, {
    random: () => {
      const value = randomValues[Math.min(calls, randomValues.length - 1)];
      calls += 1;
      return value;
    },
  });

  assert.equal(challenge.skillSlot, 2);
  assert.equal(challenge.outlierSlot, 9);
  assert.equal(challenge.correctIndex, 8);
  assert.equal(challenge.cells.length, 9);
  assert.equal(challenge.cells.filter((cell) => cell.kind === "skillful").length, 8);
  assert.equal(challenge.cells.filter((cell) => cell.kind === "outlier").length, 1);
  assert.equal(challenge.cells[7].slot, 9);
});

test("captcha challenge reports missing catalog groups clearly", () => {
  assert.deepEqual(
    getCaptchaCatalogIssues({ skillful: [], outliers: [] }),
    [
      "не найдено ни одной картинки для skillful-слотов 1-5",
      "не найдено ни одной картинки для non-skillful-слотов 6-10",
    ]
  );

  assert.throws(
    () => createCaptchaChallenge({ skillful: [], outliers: [{ slot: 7, path: "x.png" }] }),
    /Капча не готова/
  );
});
