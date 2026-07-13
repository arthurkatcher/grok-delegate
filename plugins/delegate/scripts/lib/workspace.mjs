import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runCommand } from "./process.mjs";

export function resolveWorkspaceRoot(cwdOption) {
  const start = cwdOption
    ? path.resolve(process.cwd(), cwdOption)
    : process.cwd();

  if (!fs.existsSync(start)) {
    throw new Error(`Working directory does not exist: ${start}`);
  }

  const git = runCommand("git", ["rev-parse", "--show-toplevel"], { cwd: start });
  if (!git.error && git.status === 0) {
    const root = git.stdout.trim();
    if (root) {
      return root;
    }
  }

  return start;
}

/** True when `dir` is inside a git work tree (not necessarily the repo root). */
export function isGitWorkTree(dir) {
  const start = path.resolve(dir || process.cwd());
  if (!fs.existsSync(start)) return false;
  const r = runCommand("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: start,
    timeout: 5_000
  });
  return Boolean(r.ok && String(r.stdout || "").trim() === "true");
}

export function pluginRootFromScript(importMetaUrl) {
  // scripts/lib/*.mjs → scripts → plugin root
  return path.resolve(path.dirname(fileURLToPath(importMetaUrl)), "../..");
}

export function resolvePluginEnv() {
  return {
    root:
      process.env.GROK_PLUGIN_ROOT ||
      process.env.CLAUDE_PLUGIN_ROOT ||
      null,
    data:
      process.env.GROK_PLUGIN_DATA ||
      process.env.CLAUDE_PLUGIN_DATA ||
      null
  };
}
