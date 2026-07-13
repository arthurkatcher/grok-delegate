/**
 * Integration: mock engines on PATH, exercise fail-closed companion.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it, before, after } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const COMPANION = path.join(ROOT, "scripts/delegate-companion.mjs");

function runCompanion(args, env = {}) {
  return spawnSync(process.execPath, [COMPANION, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 30_000
  });
}

describe("companion fail-closed", () => {
  it("rejects unknown action", () => {
    const r = runCompanion(["claude", "overveiw", "x"]);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /Unknown action|Valid:/i);
  });

  it("rejects unknown flag", () => {
    const r = runCompanion(["claude", "--not-real", "setup"]);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /Unknown option/i);
  });

  it("rejects empty rescue", () => {
    // Will fail auth/setup or empty rescue depending on order — empty task after setup ready
    const r = runCompanion(["claude", "rescue"]);
    assert.notEqual(r.status, 0);
  });

  it("rejects read-only + yolo", () => {
    const r = runCompanion([
      "claude",
      "--read-only",
      "--yolo",
      "rescue",
      "--",
      "do thing"
    ]);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /conflict|read-only/i);
  });
});
