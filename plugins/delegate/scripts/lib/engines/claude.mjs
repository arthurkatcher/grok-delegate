import { spawn } from "node:child_process";
import readline from "node:readline";
import { binaryAvailable, runCommand } from "../process.mjs";
import { parseStreamLine } from "../stream.mjs";
import { claudeBin, getClaudeCatalog, resolveClaudeModel, resolveClaudeEffort } from "../models/claude.mjs";
import {
  buildOverviewPrompt,
  buildReviewPrompt,
  buildRescuePrompt
} from "../prompts.mjs";
import {
  engineSpawnOptions,
  trackEngineChild,
  killEngineChild
} from "../child-lifecycle.mjs";

export { claudeBin, getClaudeCatalog, resolveClaudeModel, resolveClaudeEffort };

export function getClaudeAvailability(cwd) {
  return binaryAvailable(claudeBin(), ["--version"], { cwd });
}

export function getClaudeAuthStatus(cwd) {
  const result = runCommand(claudeBin(), ["auth", "status"], {
    cwd,
    timeout: 15_000
  });
  const stdout = (result.stdout || "").trim();
  let parsed = null;
  if (stdout) {
    try {
      parsed = JSON.parse(stdout);
    } catch {
      parsed = null;
    }
  }
  const env = {
    hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
    hasOauthToken: Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim()),
    hasAuthToken: Boolean(process.env.ANTHROPIC_AUTH_TOKEN?.trim())
  };
  // Fail closed on spawn error / signal / non-zero
  if (!result.ok) {
    return {
      loggedIn: false,
      status: result.status,
      detail:
        result.error?.message ||
        result.signal ||
        stdout ||
        result.stderr.trim() ||
        "auth check failed",
      raw: parsed,
      env
    };
  }
  const loggedIn =
    parsed?.loggedIn === true ||
    (parsed == null && !/not logged|unauthenticated/i.test(stdout + result.stderr));
  return {
    loggedIn: Boolean(loggedIn),
    status: result.status,
    detail: parsed
      ? [
          parsed.authMethod && `method: ${parsed.authMethod}`,
          parsed.subscriptionType && `plan: ${parsed.subscriptionType}`,
          parsed.email && `email: ${parsed.email}`
        ]
          .filter(Boolean)
          .join(", ") || "authenticated"
      : stdout || "authenticated",
    raw: parsed,
    env
  };
}

export function buildClaudeSetupReport(cwd) {
  const node = binaryAvailable("node", ["--version"]);
  const claude = getClaudeAvailability(cwd);
  const auth = claude.available
    ? getClaudeAuthStatus(cwd)
    : { loggedIn: false, detail: "claude not available", env: {} };
  const catalog = claude.available ? getClaudeCatalog() : { models: [], effortsGlobal: [], source: "n/a" };

  const nextSteps = [];
  if (!node.available) nextSteps.push("Install Node.js 18+.");
  if (!claude.available) nextSteps.push("Install Claude Code and ensure `claude` is on PATH.");
  if (
    claude.available &&
    !auth.loggedIn &&
    !auth.env.hasApiKey &&
    !auth.env.hasOauthToken
  ) {
    nextSteps.push("Run `claude auth login` (or set ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN).");
  }
  if (auth.env?.hasApiKey && auth.loggedIn) {
    nextSteps.push("Note: ANTHROPIC_API_KEY usually overrides Max/subscription auth.");
  }

  const ready =
    node.available &&
    claude.available &&
    (auth.loggedIn || auth.env.hasApiKey || auth.env.hasOauthToken || auth.env.hasAuthToken);

  return {
    engine: "claude",
    ready,
    node,
    binary: claude,
    auth,
    catalog: {
      source: catalog.source,
      models: (catalog.models || []).map((m) => m.slug),
      efforts: catalog.effortsGlobal || [],
      permissionModes: catalog.permissionModes || [],
      defaultModel: catalog.defaultModel || null
    },
    nextSteps
  };
}

/**
 * Build claude -p argv from resolved policy.
 * - Rescue default: acceptEdits + file tools + scoped Bash(git *) — never bare Bash.
 * - RO default: dontAsk + read tools (not plan mode).
 * - Hermetic RO: --bare unless --trust-project.
 * - Model/effort only passed when explicitly set.
 */
export function buildClaudeArgs({
  action,
  prompt,
  model,
  effort,
  bare,
  maxTurns,
  resumeSessionId,
  permissionMode,
  yolo,
  write,
  streamPartial,
  allowedTools,
  disallowedTools
}) {
  const args = ["-p", prompt, "--output-format", "stream-json", "--verbose"];
  args.push("--max-turns", String(maxTurns ?? (action === "rescue" ? 80 : 40)));

  if (model) args.push("--model", model);
  if (effort) args.push("--effort", effort);
  if (bare) args.push("--bare");
  if (resumeSessionId) args.push("--resume", resumeSessionId);
  if (streamPartial) args.push("--include-partial-messages");

  if (yolo) {
    args.push("--dangerously-skip-permissions");
    return args;
  }

  const mode = permissionMode || (write ? "acceptEdits" : "dontAsk");
  args.push("--permission-mode", mode);

  if (allowedTools) {
    args.push("--allowedTools", allowedTools);
  } else if (write) {
    // File tools only — no Bash by default (even Bash(git *) can force-push,
    // clean -fdx, reset --hard, etc.). Opt in with --allowed-tools or --yolo.
    args.push("--allowedTools", "Read,Edit,Write,Glob,Grep");
    args.push("--disallowedTools", disallowedTools || "Bash");
  } else {
    args.push(
      "--allowedTools",
      "Read,Glob,Grep",
      "--disallowedTools",
      disallowedTools || "Edit,Write,Bash"
    );
  }
  if (disallowedTools && write && allowedTools) {
    args.push("--disallowedTools", disallowedTools);
  }

  return args;
}

export function buildClaudePrompt({ action, cwd, focus, task, scopeSummary, write = true }) {
  if (action === "overview") return buildOverviewPrompt({ cwd, focus });
  if (action === "review") return buildReviewPrompt({ cwd, focus, scopeSummary, adversarial: false });
  if (action === "adversarial") {
    return buildReviewPrompt({ cwd, focus, scopeSummary, adversarial: true });
  }
  return buildRescuePrompt({ cwd, task: task || focus || "", write });
}

export function parseClaudeJsonResult(stdout) {
  const text = (stdout || "").trim();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      const lastBrace = text.lastIndexOf("\n{");
      if (lastBrace !== -1) {
        try {
          json = JSON.parse(text.slice(lastBrace + 1));
        } catch {
          json = null;
        }
      }
    }
  }
  let resultText = "";
  let isError = false;
  if (json && typeof json === "object") {
    if (typeof json.result === "string" && json.result.trim()) resultText = json.result;
    isError = Boolean(json.is_error) || json.subtype === "error_max_turns";
  }
  if (!resultText) resultText = text || "";
  return { json, resultText: String(resultText), isError };
}

export function runClaudeStream(args, options = {}) {
  const bin = options.bin || claudeBin();
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
    let lastJson = null;
    let isError = false;
    let sessionId = null;
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
      const ev = parseStreamLine(line);
      if (!ev) {
        const t = line.trim();
        if (t.startsWith("{") && t.includes('"result"')) {
          try {
            const obj = JSON.parse(t);
            if (obj.type === "result" || obj.result) {
              lastJson = obj;
              lastResultText = typeof obj.result === "string" ? obj.result : lastResultText;
              sessionId = obj.session_id ?? sessionId;
              sawResult = true;
              isError = Boolean(obj.is_error);
            }
          } catch {
            /* ignore */
          }
        }
        return;
      }
      onProgress(ev);
      if (ev.sessionId) sessionId = ev.sessionId;
      if (ev.isResult) {
        sawResult = true;
        lastResultText = ev.resultText || lastResultText;
        isError = Boolean(ev.isError);
        try {
          lastJson = JSON.parse(line);
        } catch {
          lastJson = { type: "result", result: lastResultText, session_id: sessionId, is_error: isError };
        }
      }
    });

    child.on("error", (error) => {
      finish({
        status: 1,
        stderr: error.message,
        resultText: error.message,
        isError: true,
        sessionId,
        json: null,
        cancelled: false
      });
    });

    child.on("close", (code, signal) => {
      rl.close();
      const cancelled = signal === "SIGTERM" || signal === "SIGINT" || signal === "SIGHUP";
      if (!sawResult && !lastResultText) {
        const parsed = parseClaudeJsonResult(stderr);
        if (parsed.resultText) {
          lastResultText = parsed.resultText;
          lastJson = parsed.json;
          isError = parsed.isError;
        }
      }
      let status = code ?? (cancelled ? 143 : 1);
      if (isError && status === 0) status = 1;
      if (cancelled) {
        lastResultText = lastResultText || "cancelled (Claude stopped)";
        isError = true;
      } else if (!lastResultText && status !== 0) {
        lastResultText = stderr.trim() || `claude exited ${status}`;
        isError = true;
      }
      finish({
        status,
        stderr,
        resultText: lastResultText,
        isError,
        sessionId,
        json: lastJson,
        cancelled,
        signal: signal || null
      });
    });

    // If parent is already shutting down, don't leave a stray child
    if (options.abortSignal) {
      options.abortSignal.addEventListener?.("abort", () => {
        killEngineChild(child, "SIGTERM");
      });
    }
  });
}
