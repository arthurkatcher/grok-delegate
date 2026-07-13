/**
 * Runtime model / effort discovery for Claude Code and Codex CLI.
 * Never ship a fixed product catalog as source of truth — probe the local binary.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCommand } from "../process.mjs";

/**
 * Parse effort levels advertised in CLI help text.
 * Handles multi-line Claude help where the parenthetical wraps.
 */
export function parseEffortLevelsFromHelp(helpText) {
  const text = String(helpText || "");
  const efforts = new Set();
  const known = [
    "minimal",
    "low",
    "light",
    "medium",
    "high",
    "xhigh",
    "extra high",
    "extrahigh",
    "max",
    "ultra",
    "ultracode"
  ];

  // Collapse whitespace so multi-line help still matches.
  const collapsed = text.replace(/\s+/g, " ");
  const paren = /effort[^)]*\(([^)]+)\)/gi;
  let m;
  while ((m = paren.exec(collapsed)) !== null) {
    for (const token of m[1].split(/[|,/ ]+/)) {
      const t = token.trim().toLowerCase().replace(/\s+/g, "");
      if (!t) continue;
      if (t === "extrahigh") {
        efforts.add("xhigh");
        continue;
      }
      if (known.includes(t)) {
        efforts.add(t === "light" ? "low" : t);
      }
    }
  }

  // Line + following lines (parenthetical often wraps under --effort)
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (!/effort/i.test(lines[i])) continue;
    const window = [lines[i], lines[i + 1] || "", lines[i + 2] || ""].join(" ");
    for (const k of known) {
      const re = new RegExp(`\\b${k.replace(/\s+/g, "\\s+")}\\b`, "i");
      if (re.test(window)) {
        if (k === "light") efforts.add("low");
        else if (k === "extra high" || k === "extrahigh") efforts.add("xhigh");
        else efforts.add(k.replace(/\s+/g, ""));
      }
    }
  }
  return [...efforts];
}

/**
 * Extract example model aliases from help (e.g. 'fable', 'opus', or 'sonnet').
 */
export function parseModelHintsFromHelp(helpText) {
  const text = String(helpText || "");
  const hints = new Set();
  const quoted = text.matchAll(/'([a-zA-Z0-9][a-zA-Z0-9._-]{1,40})'/g);
  for (const m of quoted) {
    const v = m[1];
    if (/^(fable|opus|sonnet|haiku|best|default|gpt-|claude-)/i.test(v) || /-\d/.test(v)) {
      hints.add(v);
    }
  }
  const full = text.matchAll(
    /\b(claude-[a-z0-9][a-z0-9._-]{2,40}|gpt-[a-z0-9][a-z0-9._-]{2,40})\b/gi
  );
  for (const m of full) {
    hints.add(m[1]);
  }
  return [...hints];
}

export function parsePermissionModesFromHelp(helpText) {
  const text = String(helpText || "");
  const modes = new Set();
  const known = [
    "default",
    "manual",
    "acceptEdits",
    "plan",
    "auto",
    "dontAsk",
    "bypassPermissions"
  ];
  for (const k of known) {
    if (new RegExp(`\\b${k}\\b`).test(text)) {
      modes.add(k);
    }
  }
  return [...modes];
}

export function parseSandboxModesFromHelp(helpText) {
  const text = String(helpText || "");
  const modes = [];
  for (const k of ["read-only", "workspace-write", "danger-full-access"]) {
    if (text.includes(k)) modes.push(k);
  }
  return modes;
}

/**
 * Codex live catalog: debug models → cache file → empty.
 */
export function listCodexModelsFromCli(codexBin = "codex", env = process.env) {
  const result = runCommand(codexBin, ["debug", "models"], {
    env,
    timeout: 30_000
  });
  if (result.status === 0 && result.stdout.trim()) {
    try {
      const parsed = JSON.parse(result.stdout);
      const models = parsed.models || (Array.isArray(parsed) ? parsed : []);
      if (models.length) {
        return normalizeCodexModels(models, "codex-debug-models");
      }
    } catch {
      /* fall through */
    }
  }

  const cachePath =
    env.CODEX_MODELS_CACHE ||
    path.join(env.CODEX_HOME || path.join(os.homedir(), ".codex"), "models_cache.json");
  try {
    if (fs.existsSync(cachePath)) {
      const parsed = JSON.parse(fs.readFileSync(cachePath, "utf8"));
      const models = parsed.models || [];
      if (models.length) {
        return normalizeCodexModels(models, `cache:${cachePath}`);
      }
    }
  } catch {
    /* empty */
  }

  return { models: [], source: "empty", effortsGlobal: [] };
}

function normalizeCodexModels(rawModels, source) {
  const models = [];
  const effortsGlobal = new Set();
  for (const m of rawModels) {
    const slug = m.slug || m.id || m.model || null;
    if (!slug) continue;
    const vis = m.visibility || "list";
    if (vis === "hide" || slug === "codex-auto-review") continue;
    let efforts = m.supported_reasoning_levels || m.reasoning_levels || [];
    if (Array.isArray(efforts) && efforts[0] && typeof efforts[0] === "object") {
      efforts = efforts.map((x) => x.effort || x.level || x.name).filter(Boolean);
    }
    efforts = (efforts || []).map((e) => String(e).toLowerCase());
    for (const e of efforts) effortsGlobal.add(e);
    models.push({
      slug: String(slug),
      displayName: m.display_name || m.displayName || slug,
      defaultEffort: m.default_reasoning_level || m.default_effort || null,
      efforts,
      visibility: vis,
      priority: m.priority ?? 100
    });
  }
  models.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  return { models, source, effortsGlobal: [...effortsGlobal] };
}

/**
 * Resolve claude binary path (follow symlinks to versioned install).
 */
export function resolveClaudeBinaryPath(claudeBin = "claude") {
  try {
    const which = runCommand("which", [claudeBin], { timeout: 5_000 });
    const p = (which.stdout || "").trim().split("\n")[0];
    if (p && fs.existsSync(p)) {
      try {
        return fs.realpathSync(p);
      } catch {
        return p;
      }
    }
  } catch {
    /* fall through */
  }
  return claudeBin;
}

/**
 * True if string looks like a real Claude model id (not junk from binary scan).
 */
export function isPlausibleClaudeModelId(id) {
  const s = String(id || "");
  if (!/^claude-(fable|mythos|opus|sonnet|haiku)[a-z0-9._-]*$/i.test(s)) {
    return false;
  }
  if (s.endsWith("-") || s.endsWith(".") || /\.md$/i.test(s)) return false;
  // Require a version digit somewhere (claude-opus-4-8, claude-sonnet-5, …)
  if (!/\d/.test(s)) return false;
  // Drop accidental concatenations
  if (/fable-5-mythos|mythos-5-fable/i.test(s)) return false;
  return true;
}

/**
 * Scan installed Claude binary for embedded model IDs (updates with CLI version).
 * Prefer `rg -a`; fall back to `strings`.
 */
export function extractClaudeModelsFromBinary(binPath) {
  if (!binPath || !fs.existsSync(binPath)) {
    return { ids: [], method: "missing-binary" };
  }
  const pattern = "claude-(fable|mythos|opus|sonnet|haiku)[a-z0-9._-]*";
  let raw = "";
  let method = "none";

  const rg = runCommand(
    "rg",
    ["-a", "-o", "--no-filename", pattern, binPath],
    { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 }
  );
  if (rg.status === 0 && rg.stdout.trim()) {
    raw = rg.stdout;
    method = "rg";
  } else {
    const st = runCommand("strings", [binPath], {
      timeout: 120_000,
      maxBuffer: 80 * 1024 * 1024
    });
    if (st.status === 0 && st.stdout) {
      raw = st.stdout;
      method = "strings";
    }
  }

  const re = /claude-(?:fable|mythos|opus|sonnet|haiku)[a-z0-9._-]*/gi;
  const found = new Set();
  let m;
  while ((m = re.exec(raw)) !== null) {
    if (isPlausibleClaudeModelId(m[0])) {
      found.add(m[0].toLowerCase().replace(/claude-sonnet-4\.6/, "claude-sonnet-4-6"));
    }
  }
  return { ids: [...found].sort(), method };
}

/**
 * Parse `claude-…` ids from free text / markdown tables (agent "models" listing).
 */
export function parseClaudeModelIdsFromText(text) {
  const found = new Set();
  const re = /`?(claude-(?:fable|mythos|opus|sonnet|haiku)[a-z0-9._-]*)`?/gi;
  let m;
  while ((m = re.exec(String(text || ""))) !== null) {
    if (isPlausibleClaudeModelId(m[1])) {
      found.add(m[1]);
    }
  }
  return [...found].sort();
}

function claudeModelsCachePath(env = process.env) {
  const base =
    env.GROK_PLUGIN_DATA ||
    env.CLAUDE_PLUGIN_DATA ||
    path.join(os.homedir(), ".local", "share", "grok-delegate");
  try {
    fs.mkdirSync(base, { recursive: true, mode: 0o700 });
    try {
      fs.chmodSync(base, 0o700);
    } catch {
      /* ignore */
    }
  } catch {
    /* ignore */
  }
  return path.join(base, "claude-models.json");
}

function readClaudeModelsCache(binPath, env) {
  try {
    const p = claudeModelsCachePath(env);
    if (!fs.existsSync(p)) return null;
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    const st = fs.existsSync(binPath) ? fs.statSync(binPath) : null;
    if (
      data.binPath === binPath &&
      st &&
      data.binMtimeMs === st.mtimeMs &&
      Array.isArray(data.ids) &&
      data.ids.length
    ) {
      return data;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function writeClaudeModelsCache(binPath, ids, source, env) {
  try {
    const st = fs.existsSync(binPath) ? fs.statSync(binPath) : null;
    const p = claudeModelsCachePath(env);
    fs.writeFileSync(
      p,
      JSON.stringify(
        {
          binPath,
          binMtimeMs: st?.mtimeMs ?? null,
          source,
          ids,
          fetchedAt: new Date().toISOString()
        },
        null,
        2
      ),
      "utf8"
    );
  } catch {
    /* ignore */
  }
}

/**
 * Optional agent listing: `claude -p` with a models prompt (slow).
 * Enable with CLAUDE_MODELS_AGENT=1. Note: bare `claude models` is NOT a
 * subcommand — it is the same agent path without --print.
 */
export function listClaudeModelsViaAgent(claudeBin = "claude", env = process.env) {
  const prompt =
    "List every currently available Claude Code --model id. " +
    "Output a markdown table with a Model ID column using exact ids like `claude-opus-4-8`. " +
    "No tools. No prose beyond the table.";
  const result = runCommand(
    claudeBin,
    [
      "-p",
      prompt,
      "--output-format",
      "text",
      "--max-turns",
      "1",
      "--permission-mode",
      "plan",
      "--disallowedTools",
      "Bash,Edit,Write,Read,Glob,Grep,Agent,WebSearch,WebFetch,Task,NotebookEdit,Skill"
    ],
    { env, timeout: 90_000, maxBuffer: 8 * 1024 * 1024 }
  );
  const text = `${result.stdout || ""}\n${result.stderr || ""}`;
  return {
    ids: parseClaudeModelIdsFromText(text),
    status: result.status,
    ok: result.status === 0
  };
}

function sortClaudeModelIds(ids) {
  const prefer = [
    "claude-fable-5",
    "claude-mythos-5",
    "claude-opus-4-8",
    "claude-sonnet-5",
    "claude-haiku-4-5",
    "claude-opus-4-7",
    "claude-opus-4-6",
    "claude-sonnet-4-6",
    "claude-opus-4-5",
    "claude-sonnet-4-5"
  ];
  const rank = (id) => {
    const i = prefer.indexOf(id);
    return i === -1 ? 1000 + id.length : i;
  };
  return [...ids].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/**
 * Claude live catalog (no hardcoded product list):
 * 1) cache keyed by binary mtime
 * 2) scan installed Claude binary for embedded model ids
 * 3) optional agent listing (CLAUDE_MODELS_AGENT=1)
 * 4) merge --help aliases + settings default
 */
export function listClaudeModelsFromCli(claudeBin = "claude", env = process.env) {
  const help = runCommand(claudeBin, ["--help"], { env, timeout: 15_000 });
  const helpText = `${help.stdout || ""}\n${help.stderr || ""}`;
  const helpHints = parseModelHintsFromHelp(helpText);
  const efforts = parseEffortLevelsFromHelp(helpText);
  const permissionModes = parsePermissionModesFromHelp(helpText);

  let defaultModel = null;
  try {
    const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
    if (fs.existsSync(settingsPath)) {
      const s = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      defaultModel = s.model || s.defaultModel || null;
    }
  } catch {
    /* ignore */
  }

  const binPath = resolveClaudeBinaryPath(claudeBin);
  const sources = [];
  const idSet = new Set();

  const cached = readClaudeModelsCache(binPath, env);
  if (cached?.ids?.length) {
    for (const id of cached.ids) idSet.add(id);
    sources.push(`cache:${cached.source || "binary"}`);
  } else {
    const scanned = extractClaudeModelsFromBinary(binPath);
    for (const id of scanned.ids) idSet.add(id);
    if (scanned.ids.length) {
      sources.push(`binary-${scanned.method}`);
      writeClaudeModelsCache(binPath, scanned.ids, `binary-${scanned.method}`, env);
    }
  }

  // Agent listing is STRICTLY opt-in (never auto-bill on empty scan)
  const explicitAgent =
    env.CLAUDE_MODELS_AGENT === "1" || env.CLAUDE_MODELS_AGENT === "true";
  if (explicitAgent) {
    try {
      const agent = listClaudeModelsViaAgent(claudeBin, env);
      for (const id of agent.ids) idSet.add(id);
      if (agent.ids.length) {
        sources.push("claude-print-models");
        writeClaudeModelsCache(
          binPath,
          [...idSet].filter(isPlausibleClaudeModelId),
          "merged",
          env
        );
      }
    } catch {
      /* ignore agent failures */
    }
  } else if (idSet.size === 0) {
    sources.push("empty-scan-pass-model-flag");
  }

  // Help aliases (fable, opus, …) always useful for --model UX
  for (const h of helpHints) {
    idSet.add(h);
  }
  if (helpHints.length) sources.push("claude-help");

  const sortedIds = sortClaudeModelIds(
    [...idSet].filter((id) => {
      // keep short aliases from help; full ids must be plausible
      if (/^claude-/i.test(id)) return isPlausibleClaudeModelId(id);
      return true;
    })
  );

  const models = sortedIds.map((slug, idx) => ({
    slug,
    displayName: slug,
    defaultEffort: null,
    efforts: efforts.slice(),
    visibility: "list",
    priority: idx + 1
  }));

  return {
    models,
    source: sources.length ? sources.join("+") : "empty",
    effortsGlobal: efforts,
    permissionModes,
    defaultModel,
    binaryPath: binPath
  };
}

/**
 * Resolve user --model against live catalog.
 * Always allows pass-through of unknown strings (CLI is source of truth).
 */
export function resolveModelAgainstCatalog(userModel, catalog, { softDefault = null } = {}) {
  // When user omits --model, return null so the engine uses its own default
  // (do NOT force catalog[0] / fable-5 / Sol).
  if (userModel == null || String(userModel).trim() === "") {
    if (softDefault) return softDefault;
    return null;
  }
  const raw = String(userModel).trim();
  const lower = raw.toLowerCase();

  const exact = catalog.models?.find((m) => m.slug.toLowerCase() === lower);
  if (exact) return exact.slug;

  // Loose match against live catalog only (aliases resolve if present in catalog)
  const aliasSeeds = {
    sol: ["sol", "gpt-5.6-sol", "gpt-5.6"],
    terra: ["terra", "gpt-5.6-terra"],
    luna: ["luna", "gpt-5.6-luna"],
    "5.6": ["gpt-5.6", "sol"],
    "5.5": ["gpt-5.5"],
    mini: ["mini", "gpt-5.4-mini"],
    fable: ["fable"],
    opus: ["opus"],
    sonnet: ["sonnet"],
    haiku: ["haiku"]
  };
  const keys = aliasSeeds[lower] || [lower];
  for (const key of keys) {
    const hit = catalog.models?.find(
      (m) =>
        m.slug.toLowerCase() === key ||
        m.slug.toLowerCase().includes(key) ||
        (m.displayName || "").toLowerCase().includes(key)
    );
    if (hit) return hit.slug;
  }

  return raw;
}

/**
 * Resolve effort: prefer model-specific supported list; else global; else pass-through.
 */
export function resolveEffortAgainstCatalog(userEffort, catalog, modelSlug) {
  if (userEffort == null || String(userEffort).trim() === "") {
    return null;
  }
  const e = String(userEffort).trim().toLowerCase();
  const model = catalog.models?.find((m) => m.slug === modelSlug);
  const allowed = model?.efforts?.length
    ? model.efforts
    : catalog.effortsGlobal || [];
  if (allowed.length && !allowed.map((x) => x.toLowerCase()).includes(e)) {
    return {
      effort: e,
      warning: `effort "${e}" not in discovered list [${allowed.join(", ")}]; passing through`
    };
  }
  return { effort: e, warning: null };
}
