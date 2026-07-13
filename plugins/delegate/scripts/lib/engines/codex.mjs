import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { binaryAvailable, runCommand } from "../process.mjs";
import {
  codexBin,
  getCodexCatalog,
  getCodexVersion,
  compareSemver,
  CODEX_MIN_VERSION_FOR_56,
  resolveCodexModel,
  resolveCodexEffort
} from "../models/codex.mjs";
import {
  buildOverviewPrompt,
  buildReviewPrompt,
  buildRescuePrompt
} from "../prompts.mjs";
import { parseSandboxModesFromHelp } from "../models/discover.mjs";
import {
  engineSpawnOptions,
  trackEngineChild,
  killEngineChild
} from "../child-lifecycle.mjs";

export {
  codexBin,
  getCodexCatalog,
  getCodexVersion,
  resolveCodexModel,
  resolveCodexEffort,
  CODEX_MIN_VERSION_FOR_56
};

export function getCodexAvailability(cwd) {
  return binaryAvailable(codexBin(), ["--version"], { cwd });
}

export function getCodexAuthStatus(cwd) {
  const result = runCommand(codexBin(), ["login", "status"], { cwd, timeout: 15_000 });
  const out = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
  const env = {
    hasApiKey: Boolean(
      process.env.CODEX_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim()
    )
  };
  if (!result.ok) {
    return {
      loggedIn: false,
      status: result.status,
      detail: result.error?.message || result.signal || out || "auth check failed",
      env
    };
  }
  const loggedIn = !/not logged|unauthenticated|no credentials/i.test(out);
  return {
    loggedIn,
    status: result.status,
    detail: out || "authenticated",
    env
  };
}

export function buildCodexSetupReport(cwd) {
  const node = binaryAvailable("node", ["--version"]);
  const binary = getCodexAvailability(cwd);
  const auth = binary.available
    ? getCodexAuthStatus(cwd)
    : { loggedIn: false, detail: "codex not available", env: {} };
  const version = binary.available ? getCodexVersion() : null;
  const catalog = binary.available ? getCodexCatalog() : { models: [], effortsGlobal: [], source: "n/a" };

  const help = binary.available
    ? runCommand(codexBin(), ["exec", "--help"], { timeout: 10_000 })
    : { stdout: "", stderr: "" };
  const sandboxModes = parseSandboxModesFromHelp(`${help.stdout}\n${help.stderr}`);

  const nextSteps = [];
  if (!node.available) nextSteps.push("Install Node.js 18+.");
  if (!binary.available) nextSteps.push("Install Codex CLI: npm i -g @openai/codex");
  if (binary.available && !auth.loggedIn && !auth.env.hasApiKey) {
    nextSteps.push("Run `codex login` (or set CODEX_API_KEY for exec).");
  }
  if (version && compareSemver(version, CODEX_MIN_VERSION_FOR_56) < 0) {
    nextSteps.push(
      `Codex ${version} < ${CODEX_MIN_VERSION_FOR_56}: upgrade for GPT-5.6 Sol/Terra/Luna (npm i -g @openai/codex@^0.144.0). Live catalog may only show older models until then.`
    );
  }

  const ready =
    node.available && binary.available && (auth.loggedIn || auth.env.hasApiKey);

  return {
    engine: "codex",
    ready,
    node,
    binary,
    version,
    auth,
    catalog: {
      source: catalog.source,
      models: (catalog.models || []).map((m) => ({
        slug: m.slug,
        efforts: m.efforts,
        defaultEffort: m.defaultEffort
      })),
      efforts: catalog.effortsGlobal || [],
      sandboxModes
    },
    nextSteps
  };
}

/**
 * Build codex argv. Global flags (e.g. --search) must precede `exec`.
 * Resume: `codex exec resume <id> --json …`
 */
export function buildCodexArgs({
  action,
  prompt,
  model,
  effort,
  cwd,
  sandbox,
  approval = "never",
  yolo,
  write,
  lastMessagePath,
  ephemeral,
  search,
  skipGitRepoCheck,
  ignoreUserConfig,
  resumeSessionId
}) {
  // Global options before subcommand (Codex 0.144+)
  const args = [];
  if (search) args.push("--search");
  if (ignoreUserConfig) args.push("--ignore-user-config");

  if (resumeSessionId) {
    args.push("exec", "resume", String(resumeSessionId));
  } else {
    args.push("exec");
  }

  args.push("--json", "--color", "never");

  let sb = sandbox;
  if (!sb && !yolo) {
    sb = write ? "workspace-write" : "read-only";
  }
  if (yolo) {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  } else {
    if (sb) args.push("--sandbox", sb);
    args.push("-c", `approval_policy=${approval || "never"}`);
  }

  if (cwd) args.push("-C", cwd);
  if (model) args.push("-m", model);
  if (effort) args.push("-c", `model_reasoning_effort=${effort}`);
  if (lastMessagePath) args.push("-o", lastMessagePath);
  if (ephemeral) args.push("--ephemeral");
  if (skipGitRepoCheck) args.push("--skip-git-repo-check");

  args.push(prompt);
  return args;
}

export function buildCodexPrompt({ action, cwd, focus, task, scopeSummary, write = true }) {
  if (action === "overview") return buildOverviewPrompt({ cwd, focus });
  if (action === "review") return buildReviewPrompt({ cwd, focus, scopeSummary, adversarial: false });
  if (action === "adversarial") {
    return buildReviewPrompt({ cwd, focus, scopeSummary, adversarial: true });
  }
  return buildRescuePrompt({ cwd, task: task || focus || "", write });
}

/**
 * Map Codex JSONL events to progress events (same shape as Claude stream).
 */
export function describeCodexStreamEvent(obj) {
  if (!obj || typeof obj !== "object") return null;
  const type = obj.type || obj.event;

  if (type === "thread.started") {
    return {
      phase: "starting",
      message: obj.thread_id ? `thread ${obj.thread_id}` : "thread started",
      kind: "system_init",
      sessionId: obj.thread_id || null
    };
  }
  if (type === "turn.started") {
    return { phase: "running", message: "turn started", kind: "progress" };
  }
  if (type === "turn.completed") {
    return { phase: "completed", message: "turn completed", kind: "result", isResult: false };
  }
  if (type === "turn.failed" || type === "error") {
    const msg = obj.message || obj.error || type;
    if (/reconnecting/i.test(String(msg))) {
      return { phase: "retry", message: String(msg).slice(0, 120), kind: "system" };
    }
    return {
      phase: "failed",
      message: String(msg).slice(0, 160),
      kind: "result",
      isResult: true,
      isError: true,
      resultText: String(msg)
    };
  }

  // item.* patterns
  const item = obj.item || obj;
  const itemType = item.type || obj.item_type;
  if (type === "item.started" || type === "item.completed") {
    if (itemType === "command_execution" || item.command) {
      const cmd = item.command || item.command_line || "";
      const short = String(cmd).replace(/\s+/g, " ").slice(0, 100);
      const exit =
        item.exit_code ?? item.exitCode ?? item.status ?? item.outcome ?? null;
      if (type === "item.started") {
        return { phase: "tool", message: `Bash ${short}`, kind: "tool_use" };
      }
      const suffix = exit != null && exit !== "" ? ` exit=${exit}` : "";
      return {
        phase: "tool",
        message: `Bash done ${short}${suffix}`,
        kind: "tool_use"
      };
    }
    if (itemType === "file_change" || item.path || item.changes) {
      let p = item.path || item.file;
      if (!p && Array.isArray(item.changes) && item.changes[0]) {
        p =
          item.changes[0].path ||
          item.changes[0].file ||
          item.changes.map((c) => c.path || c.file).filter(Boolean).join(",") ||
          "?";
      }
      return { phase: "tool", message: `edit ${p || "?"}`, kind: "tool_use" };
    }
    if (itemType === "mcp_tool_call") {
      return {
        phase: "tool",
        message: `mcp ${item.server || ""}.${item.tool || item.name || ""}`,
        kind: "tool_use"
      };
    }
    if (itemType === "web_search") {
      return {
        phase: "tool",
        message: `search ${String(item.query || "").slice(0, 80)}`,
        kind: "tool_use"
      };
    }
    // Reasoning / thinking items (Sol etc. at high/ultra effort)
    if (itemType === "reasoning" || itemType === "thinking") {
      const body =
        item.text ||
        item.summary ||
        item.content ||
        (Array.isArray(item.summary) ? item.summary.map((s) => s.text || s).join(" ") : "") ||
        "";
      const short = String(body).replace(/\s+/g, " ").trim().slice(0, 140);
      if (type === "item.started") {
        return {
          phase: "thinking",
          message: short || "reasoning…",
          kind: "thinking"
        };
      }
      if (short) {
        return {
          phase: "thinking",
          message: short + (body.length > 140 ? "…" : ""),
          kind: "thinking"
        };
      }
      return {
        phase: "thinking",
        message: "reasoning…",
        kind: "thinking"
      };
    }
    if (itemType === "agent_message" && type === "item.completed") {
      const text = item.text || item.content || obj.text || "";
      if (text) {
        return {
          phase: "completed",
          message: "result received",
          kind: "result",
          isResult: true,
          resultText: String(text),
          isError: false
        };
      }
    }
  }

  if (itemType === "agent_message" && (item.text || obj.text)) {
    return {
      phase: "completed",
      message: "result received",
      kind: "result",
      isResult: true,
      resultText: String(item.text || obj.text),
      isError: false
    };
  }

  return null;
}

export function runCodexStream(args, options = {}) {
  const bin = options.bin || codexBin();
  const onProgress = options.onProgress || (() => {});

  return new Promise((resolve) => {
    const child = trackEngineChild(
      spawn(
        bin,
        args,
        engineSpawnOptions({
          cwd: options.cwd,
          env: options.env ?? process.env
        })
      )
    );

    let stderr = "";
    let lastResultText = "";
    let sessionId = null;
    let isError = false;
    let sawResult = false;
    let settled = false;

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      resolve(payload);
    };

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });

    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on("line", (line) => {
      const t = line.trim();
      if (!t.startsWith("{")) return;
      let obj;
      try {
        obj = JSON.parse(t);
      } catch {
        return;
      }
      const ev = describeCodexStreamEvent(obj);
      if (!ev) return;
      onProgress(ev);
      if (ev.sessionId) sessionId = ev.sessionId;
      if (ev.isResult) {
        sawResult = true;
        if (ev.resultText) lastResultText = ev.resultText;
        isError = Boolean(ev.isError);
      }
    });

    child.on("error", (error) => {
      finish({
        status: 1,
        stderr: error.message,
        resultText: error.message,
        isError: true,
        sessionId,
        cancelled: false
      });
    });

    child.on("close", (code, signal) => {
      rl.close();
      const cancelled = signal === "SIGTERM" || signal === "SIGINT" || signal === "SIGHUP";
      // Prefer last-message file if provided via -o
      const outIdx = args.indexOf("-o");
      if (outIdx !== -1 && args[outIdx + 1]) {
        try {
          const p = args[outIdx + 1];
          if (fs.existsSync(p)) {
            const text = fs.readFileSync(p, "utf8").trim();
            if (text) {
              lastResultText = text;
              sawResult = true;
            }
          }
        } catch {
          /* ignore */
        }
      }
      let status = code ?? (cancelled ? 143 : 1);
      if (cancelled) {
        lastResultText = lastResultText || "cancelled (Codex stopped)";
        isError = true;
      } else if (!lastResultText && status !== 0) {
        lastResultText = stderr.trim() || `codex exited ${status}`;
        isError = true;
      }
      if (!sawResult && lastResultText) sawResult = true;
      finish({
        status,
        stderr,
        resultText: lastResultText,
        isError: isError || status !== 0,
        sessionId,
        cancelled,
        signal: signal || null
      });
    });

    if (options.abortSignal) {
      options.abortSignal.addEventListener?.("abort", () => {
        killEngineChild(child, "SIGTERM");
      });
    }
  });
}

export function makeTempLastMessagePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-delegate-"));
  return path.join(dir, "last-message.md");
}
