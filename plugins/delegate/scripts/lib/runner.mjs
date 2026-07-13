/**
 * Run engine with live progress → process.stdout (Grok task log when background:true).
 */
import fs from "node:fs";
import process from "node:process";
import { appendJobLog, createJob, finishJob, getJob, updateJob } from "./jobs.mjs";
import { runClaudeStream } from "./engines/claude.mjs";
import { runCodexStream } from "./engines/codex.mjs";

function progressSink(cwd, jobId, logFile, { jsonMode = false } = {}) {
  let lastPhaseWrite = 0;
  let lastLogged = "";
  let sawSessionInit = false;
  return (ev) => {
    if (ev.kind === "system_init") {
      if (sawSessionInit) return;
      sawSessionInit = true;
    }
    const ts = new Date().toISOString().slice(11, 19);
    const line = `[${ts}] ${ev.phase}: ${ev.message}`;
    if (line === lastLogged || ev.message === lastLogged) return;
    lastLogged = ev.message;

    try {
      fs.appendFileSync(logFile, `${line}\n`, "utf8");
    } catch {
      appendJobLog(cwd, jobId, line);
    }

    try {
      const stream = jsonMode ? process.stderr : process.stdout;
      stream.write(`${line}\n`);
    } catch {
      /* closed */
    }

    const now = Date.now();
    if (
      ev.kind === "tool_use" ||
      ev.kind === "result" ||
      ev.kind === "system_init" ||
      now - lastPhaseWrite > 1500
    ) {
      lastPhaseWrite = now;
      try {
        updateJob(cwd, jobId, {
          phase: ev.phase,
          lastEvent: ev.message.slice(0, 240)
        });
      } catch {
        /* ignore */
      }
    }
  };
}

/**
 * @param {{
 *   cwd: string,
 *   engine: 'claude'|'codex',
 *   kind: string,
 *   model: string|null,
 *   effort: string|null,
 *   args: string[],
 *   jsonMode?: boolean
 * }} opts
 */
export async function runTrackedEngine({
  cwd,
  engine,
  kind,
  model,
  effort,
  args,
  jsonMode = false,
  persistResult = false
}) {
  const job = createJob(cwd, {
    kind: `${engine}:${kind}`,
    model,
    effort,
    prompt: kind,
    persistResult
  });
  appendJobLog(cwd, job.id, `starting ${engine} ${kind} (stream)`);
  updateJob(cwd, job.id, {
    pid: process.pid,
    phase: "starting",
    lastEvent: `spawn ${engine}`
  });

  const onProgress = progressSink(cwd, job.id, job.logFile, { jsonMode });

  const run =
    engine === "codex"
      ? await runCodexStream(args, { cwd, onProgress })
      : await runClaudeStream(args, { cwd, onProgress });

  const sessionId = run.sessionId || run.json?.session_id || null;
  const ok = run.status === 0 && Boolean(run.resultText) && !run.isError;

  const finished = finishJob(cwd, job.id, {
    status: ok ? "completed" : "failed",
    result: run.resultText,
    error: ok ? null : run.stderr || run.resultText || `exit ${run.status}`,
    exitCode: run.status,
    sessionId
  });
  updateJob(cwd, job.id, {
    phase: ok ? "completed" : "failed",
    lastEvent: ok ? "done" : finished.error
  });
  appendJobLog(cwd, job.id, `finished status=${finished.status}`);

  return { run, job: getJob(cwd, job.id) || finished, sessionId, ok };
}
