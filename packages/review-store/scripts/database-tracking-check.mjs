import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const reviewRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const databasePath = "database/review-content.sqlite";
const sidecarPaths = [
  "database/review-content.sqlite-journal",
  "database/review-content.sqlite-shm",
  "database/review-content.sqlite-wal",
];

const tracked = execFileSync(
  "git",
  ["-C", reviewRoot, "ls-files", "--error-unmatch", databasePath],
  { encoding: "utf8" },
).trim();
assert.equal(tracked, databasePath);

const mainIgnoreCheck = spawnSync(
  "git",
  ["-C", reviewRoot, "check-ignore", "--no-index", databasePath],
  { encoding: "utf8" },
);
assert.equal(mainIgnoreCheck.status, 1);

const ignoredSidecars = execFileSync(
  "git",
  ["-C", reviewRoot, "check-ignore", ...sidecarPaths],
  { encoding: "utf8" },
)
  .trim()
  .split("\n");
assert.deepEqual(ignoredSidecars, sidecarPaths);

console.log(
  "The shared review-store SQLite database is tracked; runtime sidecars are ignored.",
);
