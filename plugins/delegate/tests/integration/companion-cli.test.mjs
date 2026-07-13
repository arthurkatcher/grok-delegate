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

/**
 * PATH with node + coreutils only — no claude/codex.
 * (nvm's bin dir also contains `codex`, so we cannot put that dir on PATH.)
 */
function barePathEnv() {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "grok-delegate-bare-"));
  // Symlink only node so spawn works; do not expose sibling CLIs.
  fs.symlinkSync(process.execPath, path.join(bin, "node"));
  return {
    PATH: [bin, "/usr/bin", "/bin"].join(path.delimiter),
    // avoid inheriting API keys that could mark ready:true without a binary
    CODEX_API_KEY: "",
    OPENAI_API_KEY: "",
    ANTHROPIC_API_KEY: "",
    CLAUDE_CODE_OAUTH_TOKEN: "",
    ANTHROPIC_AUTH_TOKEN: "",
    CODEX_BIN: "",
    CLAUDE_BIN: ""
  };
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

describe("companion preflight (same as setup)", () => {
  it("codex overview without binary prints setup next steps and does not spawn", () => {
    const r = runCompanion(["codex", "overview", "--", "hello"], barePathEnv());
    assert.notEqual(r.status, 0);
    const out = r.stdout + r.stderr;
    assert.match(out, /cannot run overview|not ready/i);
    assert.match(out, /binary:.*not found|Install Codex CLI/i);
    assert.match(out, /Next steps|npm i -g @openai\/codex/i);
    // Must not look like a live Codex session started
    assert.doesNotMatch(out, /thread started|turn started|item\.started/i);
  });

  it("codex setup and overview share install guidance when missing", () => {
    const setup = runCompanion(["codex", "setup"], barePathEnv());
    const overview = runCompanion(["codex", "overview", "--", "x"], barePathEnv());
    assert.notEqual(setup.status, 0);
    assert.notEqual(overview.status, 0);
    assert.match(setup.stdout + setup.stderr, /Install Codex CLI/i);
    assert.match(overview.stdout + overview.stderr, /Install Codex CLI/i);
  });

  it("claude overview without binary prints setup next steps", () => {
    const r = runCompanion(["claude", "overview", "--", "hello"], barePathEnv());
    assert.notEqual(r.status, 0);
    const out = r.stdout + r.stderr;
    assert.match(out, /cannot run overview|not ready/i);
    assert.match(out, /Install Claude Code|binary:.*not found/i);
  });
});
