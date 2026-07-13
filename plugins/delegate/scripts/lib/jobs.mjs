import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveWorkspaceRoot } from "./workspace.mjs";

const STATE_VERSION = 1;
const MAX_JOBS = 50;

function nowIso() {
  return new Date().toISOString();
}

function defaultState() {
  return { version: STATE_VERSION, jobs: [] };
}

function pluginDataRoot() {
  const root =
    process.env.GROK_PLUGIN_DATA ||
    process.env.CLAUDE_PLUGIN_DATA ||
    path.join(os.homedir(), ".local", "share", "grok-delegate");
  try {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    fs.chmodSync(root, 0o700);
  } catch {
    /* ignore */
  }
  return root;
}

function writePrivateFile(file, content) {
  fs.writeFileSync(file, content, { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* ignore */
  }
}

export function resolveStateDir(cwd) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  let canonical = workspaceRoot;
  try {
    canonical = fs.realpathSync.native(workspaceRoot);
  } catch {
    /* keep */
  }
  const slugSource = path.basename(workspaceRoot) || "workspace";
  const slug =
    slugSource.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";
  const hash = createHash("sha256").update(canonical).digest("hex").slice(0, 16);
  return path.join(pluginDataRoot(), "state", `${slug}-${hash}`);
}

export function resolveStateFile(cwd) {
  return path.join(resolveStateDir(cwd), "state.json");
}

export function resolveJobsDir(cwd) {
  return path.join(resolveStateDir(cwd), "jobs");
}

function resolveLockFile(cwd) {
  return path.join(resolveStateDir(cwd), "state.lock");
}

export function ensureStateDir(cwd) {
  const jobs = resolveJobsDir(cwd);
  fs.mkdirSync(jobs, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(resolveStateDir(cwd), 0o700);
    fs.chmodSync(jobs, 0o700);
  } catch {
    /* ignore */
  }
}

/**
 * Simple exclusive lock for state RMW (workers + main process).
 */
function withStateLock(cwd, fn) {
  ensureStateDir(cwd);
  const lockPath = resolveLockFile(cwd);
  const start = Date.now();
  let fd = null;
  while (Date.now() - start < 5000) {
    try {
      fd = fs.openSync(lockPath, "wx");
      break;
    } catch (error) {
      if (error && error.code !== "EEXIST") {
        throw error;
      }
      // brief busy wait
      const until = Date.now() + 15;
      while (Date.now() < until) {
        /* spin */
      }
    }
  }
  if (fd == null) {
    // last resort: proceed without lock rather than hang forever
    return fn();
  }
  try {
    return fn();
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(lockPath);
    } catch {
      /* ignore */
    }
  }
}

export function loadState(cwd) {
  const stateFile = resolveStateFile(cwd);
  if (!fs.existsSync(stateFile)) {
    return defaultState();
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    return {
      ...defaultState(),
      ...parsed,
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : []
    };
  } catch {
    return defaultState();
  }
}

function pruneJobs(jobs) {
  return [...jobs]
    .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")))
    .slice(0, MAX_JOBS);
}

export function saveState(cwd, state) {
  ensureStateDir(cwd);
  const next = {
    version: STATE_VERSION,
    jobs: pruneJobs(state.jobs ?? [])
  };
  const file = resolveStateFile(cwd);
  const tmp = `${file}.${process.pid}.tmp`;
  writePrivateFile(tmp, `${JSON.stringify(next, null, 2)}\n`);
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* ignore */
  }
  // Prune orphaned log/json beyond MAX_JOBS
  try {
    const keep = new Set(next.jobs.map((j) => j.id));
    const dir = resolveJobsDir(cwd);
    for (const name of fs.readdirSync(dir)) {
      const id = name.replace(/\.(json|log)$/, "");
      if (!keep.has(id) && (name.endsWith(".json") || name.endsWith(".log"))) {
        try {
          fs.unlinkSync(path.join(dir, name));
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
  return next;
}

function writeJobFile(cwd, job) {
  ensureStateDir(cwd);
  const file = path.join(resolveJobsDir(cwd), `${job.id}.json`);
  // Do not persist full result bodies by default (privacy)
  const toStore = { ...job };
  if (!toStore.persistResult && toStore.result && String(toStore.result).length > 500) {
    toStore.result = `[truncated ${String(job.result).length} chars; use task stdout]`;
  }
  writePrivateFile(file, `${JSON.stringify(toStore, null, 2)}\n`);
  return file;
}

function loadJobFile(cwd, jobId) {
  if (!jobId) {
    return null;
  }
  const dir = resolveJobsDir(cwd);
  if (!fs.existsSync(dir)) {
    return null;
  }
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const id = name.slice(0, -".json".length);
    if (id === jobId || id.startsWith(jobId) || jobId.startsWith(id)) {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
      } catch {
        /* try next */
      }
    }
  }
  return null;
}

export function createJob(cwd, fields = {}) {
  return withStateLock(cwd, () => {
    const id = randomUUID().slice(0, 8);
    ensureStateDir(cwd);
    const logFile = path.join(resolveJobsDir(cwd), `${id}.log`);
    writePrivateFile(logFile, "");
    const job = {
      id,
      kind: fields.kind || "task",
      status: "running",
      model: fields.model ?? null,
      effort: fields.effort ?? null,
      prompt: fields.prompt ?? null,
      cwd: resolveWorkspaceRoot(cwd),
      sessionId: null,
      pid: null,
      enginePid: null,
      logFile,
      phase: "starting",
      lastEvent: null,
      result: null,
      persistResult: Boolean(fields.persistResult),
      error: null,
      exitCode: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      finishedAt: null
    };
    const state = loadState(cwd);
    state.jobs.unshift(job);
    saveState(cwd, state);
    writeJobFile(cwd, job);
    return job;
  });
}

export function listJobs(cwd) {
  return loadState(cwd).jobs;
}

export function getJob(cwd, jobId) {
  const jobs = listJobs(cwd);
  if (!jobId) {
    return jobs[0] ?? null;
  }
  const fromState =
    jobs.find((j) => j.id === jobId || j.id.startsWith(jobId) || jobId.startsWith(j.id)) ?? null;
  if (fromState) {
    return fromState;
  }
  // Durable fallback: per-job file survives state.json races with workers
  return loadJobFile(cwd, jobId);
}

export function updateJob(cwd, jobId, patch) {
  return withStateLock(cwd, () => {
    const state = loadState(cwd);
    let idx = state.jobs.findIndex(
      (j) => j.id === jobId || j.id.startsWith(jobId) || jobId.startsWith(j.id)
    );
    if (idx === -1) {
      const fromFile = loadJobFile(cwd, jobId);
      if (!fromFile) {
        throw new Error(`Unknown job: ${jobId}`);
      }
      state.jobs.unshift(fromFile);
      idx = 0;
    }
    const next = {
      ...state.jobs[idx],
      ...patch,
      updatedAt: nowIso()
    };
    state.jobs[idx] = next;
    saveState(cwd, state);
    writeJobFile(cwd, next);
    return next;
  });
}

export function finishJob(cwd, jobId, { status, result, error, exitCode, sessionId } = {}) {
  return updateJob(cwd, jobId, {
    status: status || "completed",
    result: result ?? null,
    error: error ?? null,
    exitCode: exitCode ?? null,
    sessionId: sessionId ?? undefined,
    finishedAt: nowIso()
  });
}

export function cancelJob(cwd, jobId, { reason = "cancelled" } = {}) {
  const job = getJob(cwd, jobId);
  if (!job) {
    throw new Error(`Unknown job: ${jobId}`);
  }
  if (job.pid && job.status === "running") {
    try {
      process.kill(-job.pid, "SIGTERM");
    } catch {
      try {
        process.kill(job.pid, "SIGTERM");
      } catch {
        /* already dead */
      }
    }
  }
  return finishJob(cwd, job.id, {
    status: "cancelled",
    error: reason,
    exitCode: null
  });
}

export function appendJobLog(cwd, jobId, line) {
  const job = getJob(cwd, jobId);
  if (!job?.logFile) {
    return;
  }
  fs.appendFileSync(job.logFile, `${line}\n`, "utf8");
}
