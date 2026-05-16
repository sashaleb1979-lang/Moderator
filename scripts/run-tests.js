const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function collectTestFiles(rootDir) {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTestFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".test.js")) {
      files.push(fullPath);
    }
  }

  return files;
}

const testsRoot = path.resolve(__dirname, "..", "tests");
const testFiles = collectTestFiles(testsRoot)
  .map((filePath) => path.relative(process.cwd(), filePath))
  .sort((left, right) => left.localeCompare(right));

if (!testFiles.length) {
  console.error("No test files found under tests/.");
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...testFiles], {
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

if (typeof result.status === "number") {
  process.exit(result.status);
}

if (result.signal) {
  process.kill(process.pid, result.signal);
}

process.exit(1);