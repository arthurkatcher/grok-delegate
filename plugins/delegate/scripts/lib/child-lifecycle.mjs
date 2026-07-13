/**
 * Track engine children and kill the whole process tree on cancel.
 * Grok background-task cancel delivers SIGTERM/SIGINT to the companion;
 * we forward that to claude/codex (and their descendants).
 */

import process from "node:process";

/** @type {Set<import('node:child_process').ChildProcess>} */
const active = new Set();

let handlersInstalled = false;
let shuttingDown = false;

/**
 * Spawn options so the child becomes a process-group leader on Unix.
 * Then `process.kill(-pid)` tears down codex/claude + grandchildren.
 * Do not unref — parent must keep streaming pipes open.
 */
export function engineSpawnOptions(extra = {}) {
  return {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    // New process group on Unix so kill(-pid) works
    detached: process.platform !== "win32",
    ...extra
  };
}

/**
 * @param {import('node:child_process').ChildProcess} child
 */
export function trackEngineChild(child) {
  if (!child) return child;
  active.add(child);
  const drop = () => {
    active.delete(child);
  };
  child.once("exit", drop);
  child.once("error", drop);
  return child;
}

/**
 * Kill one child process tree.
 * @param {import('node:child_process').ChildProcess} child
 * @param {NodeJS.Signals | number} signal
 */
export function killEngineChild(child, signal = "SIGTERM") {
  if (!child?.pid) return;
  const pid = child.pid;
  try {
    if (process.platform !== "win32") {
      // Negative PID = process group (child is group leader when detached)
      process.kill(-pid, signal);
    } else {
      child.kill(signal);
    }
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* already dead */
    }
  }
}

export function killAllEngineChildren(signal = "SIGTERM") {
  for (const child of [...active]) {
    killEngineChild(child, signal);
  }
}

/**
 * Install once on companion process entry.
 */
export function installCancelHandlers() {
  if (handlersInstalled) return;
  handlersInstalled = true;

  const shutdown = (reason) => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      process.stderr.write(
        `\n[grok-delegate] cancel (${reason}): stopping Claude/Codex children…\n`
      );
    } catch {
      /* ignore */
    }
    killAllEngineChildren("SIGTERM");
    // Escalate if anything ignores SIGTERM
    const t = setTimeout(() => {
      killAllEngineChildren("SIGKILL");
      process.exit(reason === "SIGINT" ? 130 : 143);
    }, 2500);
    if (typeof t.unref === "function") t.unref();

    // If all children exit quickly, exit soon
    const check = setInterval(() => {
      if (active.size === 0) {
        clearInterval(check);
        process.exit(reason === "SIGINT" ? 130 : 143);
      }
    }, 100);
    if (typeof check.unref === "function") check.unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGHUP", () => shutdown("SIGHUP"));

  // Last-resort: if the companion exits while children still run, kill them
  process.on("exit", () => {
    killAllEngineChildren("SIGKILL");
  });
}

export function activeEngineChildCount() {
  return active.size;
}
