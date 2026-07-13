#!/usr/bin/env node
/**
 * grok-delegate companion
 *
 *   node delegate-companion.mjs claude|codex <action> [flags] -- [focus…]
 *
 * Safe: flags before free text; unknown flags/actions fail closed.
 * Host under Grok: run_terminal_command({ background: true }) + --wait
 */

import fs from "node:fs";
import process from "node:process";
import {
  parseArgs,
  splitRawArgumentString,
  CLAUDE_VALUE_OPTIONS,
  CLAUDE_BOOLEAN_OPTIONS,
  CODEX_VALUE_OPTIONS,
  CODEX_BOOLEAN_OPTIONS
} from "./lib/args.mjs";
import { isGitWorkTree, resolveWorkspaceRoot } from "./lib/workspace.mjs";
import { resolveReviewContext } from "./lib/git.mjs";
import { installCancelHandlers } from "./lib/child-lifecycle.mjs";
import {
  adjustClaudePolicyForAuth,
  isValidAction,
  listActions,
  resolveCodexSkipGitRepoCheck,
  resolvePolicy
} from "./lib/policy.mjs";
import {
  buildClaudeSetupReport,
  buildClaudeArgs,
  buildClaudePrompt,
  getClaudeCatalog,
  resolveClaudeModel,
  resolveClaudeEffort
} from "./lib/engines/claude.mjs";
import {
  buildCodexSetupReport,
  buildCodexArgs,
  buildCodexPrompt,
  getCodexCatalog,
  resolveCodexModel,
  resolveCodexEffort,
  makeTempLastMessagePath
} from "./lib/engines/codex.mjs";
import { runTrackedEngine } from "./lib/runner.mjs";

function printUsage() {
  console.log(`Usage:
  node delegate-companion.mjs claude|codex <action> [options] -- [focus…]

Actions: ${listActions().join(" | ")}

Shared:
  --model <id>   --effort <lvl>   --cwd <path>
  --read-only    --yolo           --json
  --resume <id>  --payload-file <path>
  --persist-result   --stream-partial (claude)
  --skip-git-check

Claude:
  --permission-mode <mode>  --trust-project  --bare
  --allowed-tools <list>    --disallowed-tools <list>
  --max-turns <n>

Codex:
  --sandbox <mode>  --approval <mode>  --search  --ephemeral

Host: Grok run_terminal_command({ background: true }) + companion --wait
Cancel Grok task → SIGTERM stops Claude/Codex process tree.
`);
}

function normalizeArgv(argv) {
  if (argv.length === 1) {
    const [raw] = argv;
    if (!raw?.trim()) return [];
    return splitRawArgumentString(raw);
  }
  return argv;
}

function loadPayloadFile(file) {
  const text = fs.readFileSync(file, "utf8");
  return JSON.parse(text);
}

function output(value, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  } else {
    const s = typeof value === "string" ? value : String(value);
    process.stdout.write(s.endsWith("\n") ? s : `${s}\n`);
  }
}

/**
 * Human-readable readiness report (binary + auth + next steps).
 * Used for `setup` and for preflight blocks on overview/review/rescue.
 * @param {object} report
 * @param {{ title?: string, intro?: string|null }} [opts]
 */
function renderSetup(report, opts = {}) {
  const title = opts.title || `${report.engine} setup`;
  const lines = [
    `# ${title}`,
    "",
    opts.intro || null,
    opts.intro ? "" : null,
    `- ready: ${report.ready}`,
    `- platform: ${process.platform}`,
    `- binary: ${report.binary?.detail || (report.binary?.available ? "ok" : "not found")}`,
    report.version ? `- version: ${report.version}` : null,
    `- auth: ${report.auth?.detail}`,
    `- catalog source: ${report.catalog?.source}`,
    ""
  ].filter((x) => x != null);

  if (report.catalog?.models?.length) {
    lines.push("## Models (live)", "");
    for (const m of report.catalog.models.slice(0, 40)) {
      if (typeof m === "string") lines.push(`- ${m}`);
      else {
        const eff = (m.efforts || []).join(", ") || "?";
        lines.push(`- \`${m.slug}\` efforts: ${eff}`);
      }
    }
    if (report.catalog.models.length > 40) {
      lines.push(`- … +${report.catalog.models.length - 40} more`);
    }
    lines.push("");
  } else {
    lines.push(
      "## Models",
      "",
      "_Empty catalog — pass `--model` as a raw engine id (no auto agent discovery)._",
      ""
    );
  }
  if (report.catalog?.efforts?.length) {
    lines.push(`## Efforts: ${report.catalog.efforts.join(", ")}`, "");
  }
  if (report.nextSteps?.length) {
    lines.push("## Next steps", "");
    for (const s of report.nextSteps) lines.push(`- ${s}`);
    lines.push("");
  }
  return lines.join("\n");
}

function resolveAction(positionals) {
  if (!positionals.length) {
    return { action: null, rest: [] };
  }
  const first = positionals[0].toLowerCase();
  if (isValidAction(first)) {
    return { action: first, rest: positionals.slice(1) };
  }
  // Do NOT fall through to rescue — fail closed
  return { action: null, rest: positionals, unknown: first };
}

async function runEngine(engine, argv) {
  const valueOptions =
    engine === "claude" ? CLAUDE_VALUE_OPTIONS : CODEX_VALUE_OPTIONS;
  const booleanOptions =
    engine === "claude" ? CLAUDE_BOOLEAN_OPTIONS : CODEX_BOOLEAN_OPTIONS;

  let { options, positionals } = parseArgs(normalizeArgv(argv), {
    valueOptions,
    booleanOptions,
    strictUnknown: true,
    stopAtFirstPositional: true
  });

  if (options["payload-file"]) {
    const payload = loadPayloadFile(options["payload-file"]);
    if (payload.options && typeof payload.options === "object") {
      options = { ...options, ...payload.options };
    }
    if (Array.isArray(payload.positionals)) {
      positionals = payload.positionals;
    } else if (payload.action || payload.focus || payload.task) {
      positionals = [
        payload.action,
        payload.focus || payload.task || ""
      ].filter(Boolean);
    }
  }

  // Wait is default; ignore --background if present historically
  const asJson = Boolean(options.json);
  const cwd = resolveWorkspaceRoot(options.cwd);

  if (process.platform === "win32" && process.env.GROK_DELEGATE_ALLOW_WINDOWS !== "1") {
    const msg =
      "Windows is not supported yet. Use Linux/macOS or set GROK_DELEGATE_ALLOW_WINDOWS=1.";
    output(asJson ? { ok: false, error: msg } : msg, asJson);
    process.exitCode = 1;
    return;
  }

  let { action, rest, unknown } = resolveAction(positionals);
  if (unknown) {
    const msg = `Unknown action "${unknown}". Valid: ${listActions().join(", ")}`;
    output(asJson ? { ok: false, error: msg } : msg, asJson);
    process.exitCode = 1;
    return;
  }
  if (!action) {
    // default rescue only if there is free-text task after no action keyword
    if (rest.length || positionals.length) {
      action = "rescue";
      rest = positionals;
    } else {
      const msg = `Action required. Valid: ${listActions().join(", ")}`;
      output(asJson ? { ok: false, error: msg } : msg, asJson);
      process.exitCode = 1;
      return;
    }
  }

  // Flag conflicts first (works even without claude/codex on PATH — CI-friendly).
  const policy = resolvePolicy(engine, action, options);
  if (action !== "setup" && policy.errors.length) {
    const msg = policy.errors.join("; ");
    output(asJson ? { ok: false, error: msg } : msg, asJson);
    process.exitCode = 1;
    return;
  }

  // Shared readiness gate: binary on PATH + login/API key (same for setup and all runs).
  const setup =
    engine === "claude" ? buildClaudeSetupReport(cwd) : buildCodexSetupReport(cwd);

  if (action === "setup") {
    output(asJson ? setup : renderSetup(setup), asJson);
    process.exitCode = setup.ready ? 0 : 1;
    return;
  }

  if (!setup.ready) {
    // Do not spawn Claude/Codex — print the same next-steps as setup.
    if (asJson) {
      output(
        {
          ok: false,
          error: `${engine} not ready for ${action}`,
          setup
        },
        true
      );
    } else {
      output(
        renderSetup(setup, {
          title: `cannot run ${action} — ${engine} not ready`,
          intro:
            "Preflight matches `setup`: engine binary on PATH + auth (login or API key). Fix the next steps, then retry."
        }),
        false
      );
    }
    process.exitCode = 1;
    return;
  }

  // Claude: hermetic --bare cannot use Max/OAuth — auto-relax unless user forced --bare.
  let effectivePolicy = policy;
  if (engine === "claude") {
    const adj = adjustClaudePolicyForAuth(policy, setup.auth || {}, options);
    if (adj.error) {
      output(asJson ? { ok: false, error: adj.error } : adj.error, asJson);
      process.exitCode = 1;
      return;
    }
    effectivePolicy = adj.policy;
    if (adj.note && !asJson) {
      process.stderr.write(`${adj.note}\n`);
    }
  }

  // Codex: outside a git work tree, auto --skip-git-repo-check (home dir first-launch).
  let skipGitRepoCheck = Boolean(options["skip-git-repo-check"]);
  if (engine === "codex") {
    const gitSkip = resolveCodexSkipGitRepoCheck(cwd, options, isGitWorkTree);
    skipGitRepoCheck = gitSkip.skip;
    if (gitSkip.auto && !asJson) {
      process.stderr.write(
        "Note: cwd is not a git work tree — passing --skip-git-repo-check so Codex can run (prefer --cwd <repo>).\n"
      );
    }
  }

  const focus = rest.join(" ").trim();
  if (action === "rescue" && !focus) {
    const msg = "rescue requires a task description after the action (or after --).";
    output(asJson ? { ok: false, error: msg } : msg, asJson);
    process.exitCode = 1;
    return;
  }

  // Git required for review/adversarial
  let scopeSummary = "";
  let diffExcerpt = "";
  if (action === "review" || action === "adversarial") {
    if (!options["skip-git-check"]) {
      try {
        const ctx = resolveReviewContext(cwd, { scope: "auto" });
        scopeSummary = ctx.summary || ctx.shortstat || "";
        diffExcerpt = (ctx.diffExcerpt || ctx.diff || "").slice(0, 120_000);
      } catch (e) {
        const msg = `Git scope required for ${action}: ${e.message || e}. Init a git repo or pass --skip-git-check.`;
        output(asJson ? { ok: false, error: msg } : msg, asJson);
        process.exitCode = 1;
        return;
      }
    }
  }

  // Catalog once
  const catalog =
    engine === "claude" ? getClaudeCatalog() : getCodexCatalog();
  const userSetModel = options.model != null && String(options.model).trim() !== "";
  const model = userSetModel
    ? engine === "claude"
      ? resolveClaudeModel(options.model, catalog)
      : resolveCodexModel(options.model, catalog)
    : null;
  const effortRes = userSetModel || options.effort
    ? engine === "claude"
      ? resolveClaudeEffort(options.effort, catalog, model)
      : resolveCodexEffort(options.effort, catalog, model)
    : null;
  if (effortRes?.warning && !asJson) {
    process.stderr.write(`Note: ${effortRes.warning}\n`);
  }
  const effort = effortRes?.effort ?? (options.effort ? String(options.effort) : null);

  const prompt =
    engine === "claude"
      ? buildClaudePrompt({
          action,
          cwd,
          focus,
          task: focus,
          scopeSummary: [scopeSummary, diffExcerpt && `\nDiff excerpt:\n${diffExcerpt}`]
            .filter(Boolean)
            .join("\n"),
          write: effectivePolicy.write
        })
      : buildCodexPrompt({
          action,
          cwd,
          focus,
          task: focus,
          scopeSummary: [scopeSummary, diffExcerpt && `\nDiff excerpt:\n${diffExcerpt}`]
            .filter(Boolean)
            .join("\n"),
          write: effectivePolicy.write
        });

  let lastMessagePath = null;
  let lastMessageDir = null;
  if (engine === "codex") {
    lastMessagePath = makeTempLastMessagePath();
    lastMessageDir = lastMessagePath.replace(/[/\\][^/\\]+$/, "");
  }

  const args =
    engine === "claude"
      ? buildClaudeArgs({
          action,
          prompt,
          model,
          effort,
          bare: effectivePolicy.bare,
          maxTurns: options["max-turns"] ? Number(options["max-turns"]) : undefined,
          resumeSessionId: options.resume || null,
          permissionMode: effectivePolicy.permissionMode,
          yolo: effectivePolicy.yolo,
          write: effectivePolicy.write,
          streamPartial: Boolean(options["stream-partial"]),
          allowedTools: options["allowed-tools"] || null,
          disallowedTools: options["disallowed-tools"] || null
        })
      : buildCodexArgs({
          action,
          prompt,
          model,
          effort,
          cwd,
          sandbox: effectivePolicy.sandbox,
          approval: effectivePolicy.approval,
          yolo: effectivePolicy.yolo,
          write: effectivePolicy.write,
          lastMessagePath,
          ephemeral: Boolean(options.ephemeral),
          search: Boolean(options.search),
          skipGitRepoCheck,
          ignoreUserConfig: effectivePolicy.ignoreUserConfig,
          resumeSessionId: options.resume || null
        });

  try {
    const { run, job, ok } = await runTrackedEngine({
      cwd,
      engine,
      kind: action,
      model,
      effort,
      args,
      jsonMode: asJson,
      persistResult: Boolean(options["persist-result"])
    });

    const payload = {
      ok,
      engine,
      action,
      model,
      effort,
      effective: {
        write: effectivePolicy.write,
        bare: effectivePolicy.bare,
        hermetic: effectivePolicy.hermetic,
        permissionMode: effectivePolicy.permissionMode,
        sandbox: effectivePolicy.sandbox,
        approval: effectivePolicy.approval,
        yolo: effectivePolicy.yolo,
        skipGitRepoCheck: engine === "codex" ? skipGitRepoCheck : undefined
      },
      job_id: job?.id,
      session_id: run.sessionId,
      cancelled: Boolean(run.cancelled),
      result: run.resultText,
      stderr: (run.stderr || "").trim() || null
    };

    if (asJson) {
      output(payload, true);
    } else {
      process.stdout.write("\n---\n\n");
      process.stdout.write(run.resultText || "(no result)\n");
      if (!String(run.resultText || "").endsWith("\n")) process.stdout.write("\n");
    }
    process.exitCode = ok ? 0 : 1;
  } finally {
    if (lastMessageDir) {
      try {
        fs.rmSync(lastMessageDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

async function main() {
  installCancelHandlers();

  const argv = process.argv.slice(2);
  if (!argv.length || argv[0] === "-h" || argv[0] === "--help") {
    printUsage();
    process.exitCode = argv.length ? 0 : 1;
    return;
  }

  const engine = argv[0].toLowerCase();
  if (engine === "-h" || engine === "--help" || engine === "help") {
    printUsage();
    process.exitCode = 0;
    return;
  }
  if (engine !== "claude" && engine !== "codex") {
    console.error(`Unknown engine "${argv[0]}". Use claude or codex.`);
    printUsage();
    process.exitCode = 1;
    return;
  }
  if (argv.slice(1).some((t) => t === "-h" || t === "--help")) {
    printUsage();
    process.exitCode = 0;
    return;
  }

  try {
    await runEngine(engine, argv.slice(1));
  } catch (err) {
    const msg = err?.message || String(err);
    process.stderr.write(`${msg}\n`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err?.stack || err);
  process.exitCode = 1;
});
