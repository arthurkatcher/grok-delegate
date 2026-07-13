# grok-delegate

**Grok Build is the conductor. Claude Code and Codex are the soloists.**

`grok-delegate` is a Grok plugin marketplace that lets you hand hard work to the
local engines you already trust — without leaving the Grok TUI, without pasting
transcripts by hand, and without giving every delegate a free shell.

Part of marketplace **[Grok Build Extras](#install)**.

[![Grok Build](https://img.shields.io/badge/Grok_Build-plugin-111111)](https://grok.x.ai)
[![Claude Code](https://img.shields.io/badge/Claude_Code-local_CLI-D97757)](https://docs.anthropic.com/en/docs/claude-code)
[![Codex CLI](https://img.shields.io/badge/Codex-local_CLI-10A37F)](https://github.com/openai/codex)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)](plugins/delegate/.grok-plugin/plugin.json)

---

## The problem

Grok is excellent at orchestration — planning, stitching context, deciding what
to try next. Sometimes you still want:

- **Claude Code** for deep repo walks, careful refactors, or long tool loops
- **Codex** for sandbox-tight execution, Sol/Terra/Luna reasoning, or a second opinion

The usual path is friction: open another terminal, re-explain the task, lose
Grok’s thread, then paste the answer back. Worse, people “solve” that by giving
the other agent unrestricted shell on your machine.

## The fix

Two slash commands. One companion process. Live tools in the Grok task log.

```text
You (in Grok)
  → /delegate-claude overview --model sonnet --
  → Grok starts a background task
  → node delegate-companion.mjs claude --wait …
  → Claude streams tools / thinking / writing into the task pane
  → Cancel the task → SIGTERM kills Claude’s whole process group
```

Same shape for Codex. You stay in Grok. The other model does the legwork. You
watch progress the same way you watch any Grok background job.

| Slash command | Engine |
|---------------|--------|
| `/delegate-claude` | Local [Claude Code](https://docs.anthropic.com/en/docs/claude-code) |
| `/delegate-codex` | Local [OpenAI Codex CLI](https://github.com/openai/codex) |

**Actions:** `setup` · `overview` · `review` · `adversarial` · `rescue`

---

## Install

> This marketplace is published as a **private** GitHub repo. You need access
> to `arthurkatcher/grok-delegate` and authenticated `git` / `gh` on the machine
> that runs Grok.

### 1. Prerequisites

| Need | Notes |
|------|--------|
| **Grok Build** | Plugin system enabled |
| **Node.js 18+** | Companion runtime |
| **Linux or macOS** | Windows unsupported unless `GROK_DELEGATE_ALLOW_WINDOWS=1` |
| **`claude` and/or `codex` on `PATH`** | Auth already done (`claude auth login`, Codex login, or API keys) |
| **Codex ≥ 0.144** | Required for GPT-5.6 Sol / Terra / Luna model ids |

### 2. Add the marketplace

From a shell (GitHub shorthand — clones via your credentials):

```bash
grok plugin marketplace add arthurkatcher/grok-delegate
```

Equivalents if you prefer an explicit URL:

```bash
# HTTPS (uses your gh/git credentials for private clone)
grok plugin marketplace add https://github.com/arthurkatcher/grok-delegate.git

# SSH
grok plugin marketplace add git@github.com:arthurkatcher/grok-delegate.git
```

### 3. Install the plugin

Install the **plugin package** (not just the marketplace root):

```bash
grok plugin install arthurkatcher/grok-delegate#plugins/delegate --trust
```

`--trust` is required so the companion scripts are allowed to run. Review the
source first if you want — everything lives under
[`plugins/delegate/`](plugins/delegate/).

### 4. Enable it

```toml
# ~/.grok/config.toml
[plugins]
enabled = ["grok-delegate"]
```

Restart Grok (or reload plugins). Confirm with:

```bash
grok plugin list
grok plugin details grok-delegate
```

### 5. Update later

```bash
grok plugin marketplace update
grok plugin update grok-delegate
```

### Private-repo auth notes

| Symptom | Fix |
|---------|-----|
| `Repository not found` / clone fails | Ensure your GitHub user is a collaborator, and `gh auth status` shows a token with `repo` scope |
| HTTPS clone asks for password | Prefer `gh auth setup-git`, or use the SSH remote |
| Plugin installs but commands missing | Check `enabled` in `config.toml` and that you installed `#plugins/delegate`, not only the marketplace root |

---

## Quick start

In Grok, from a repo you care about:

```text
/delegate-claude setup
/delegate-claude overview --model sonnet --trust-project --effort low --
/delegate-codex overview --model gpt-5.4 --effort low --
```

**Auth tip (Claude):** hermetic overview defaults to `--bare`, which needs
`ANTHROPIC_API_KEY`. If you use Claude Max / OAuth only, pass `--trust-project`
so the session can use your existing login.

**Watch the process:** expand the Grok background task for live lines:

```text
[10:56:31] starting: session opened model=claude-sonnet-5
[10:56:34] tool: Glob pattern=*
[10:56:41] writing: There's already an ARCHITECTURE.md…
[10:56:55] completed: result received
```

Cancel the task any time — that stops the engine, not just the log stream.

---

## How it works

```text
run_terminal_command({ background: true })
  → node $GROK_PLUGIN_ROOT/scripts/delegate-companion.mjs <claude|codex> --wait …
  → NDJSON / JSONL from the engine → progress lines on stdout
  → Grok task pane shows tool / thinking / writing / completed
  → Cancel task → companion SIGTERM → kill(-pid) on the engine process group
```

| Piece | Role |
|-------|------|
| **Slash commands** | `/delegate-claude`, `/delegate-codex` — host contract for Grok |
| **Companion** | `plugins/delegate/scripts/delegate-companion.mjs` — argv parsing, model discovery, spawn, stream map |
| **Engines** | Claude: `stream-json` · Codex: `exec --json` |
| **Jobs** | Optional state under `~/.local/share/grok-delegate` (mode `0700`) |
| **Skill** | `delegate-runtime` — internal contract so Grok launches correctly |

Models and effort levels are **discovered live** from the installed CLIs (no
stale hard-coded catalog). Discovery never auto-spends Claude tokens; set
`CLAUDE_MODELS_AGENT=1` only if you explicitly want agent-assisted model listing.

---

## Security model (read this)

Defaults are **retrieval-first for power**, not “full YOLO agent in your home directory.”

| Action | Claude default | Codex default |
|--------|----------------|---------------|
| `overview` / `review` / `adversarial` | Hermetic `--bare` + **read** tools (`dontAsk`) | OS **`read-only`** sandbox |
| `rescue` | **File tools only** — Read / Edit / Write / Glob / Grep · **no Bash** | OS **`workspace-write`** |
| Shell / full power | Explicit `--allowed-tools '…,Bash'` or `--yolo` | Explicit `--yolo` |

Why no Bash on Claude rescue by default? Even “innocent” git can
`reset --hard`, `clean -fdx`, force-push, or delete branches. Shell is opt-in.

Other hard edges:

- Free text after `--` **cannot inject flags** (fail-closed argv)
- Unknown actions / flags **fail closed**
- Job state is **not** world-writable `/tmp`
- **Cancel = kill** the engine process group (no orphaned agents)
- Prefer `--payload-file` for messy paste instead of shell-quoting nightmares

| Want this | Pass |
|-----------|------|
| OAuth Claude without API key | `--trust-project` on RO actions |
| Load project hooks / MCP into Claude | `--trust-project` |
| Live thinking deltas | `--stream-partial` (Claude) |
| Shell for rescue | `--allowed-tools 'Read,Edit,Write,Glob,Grep,Bash'` or `--yolo` |
| Full Codex power | `--yolo` |

---

## Examples

```text
# Health check both CLIs
/delegate-claude setup
/delegate-codex setup

# Fast dual discovery (great for watching the task stream)
/delegate-claude overview --model sonnet --effort low --trust-project --
/delegate-codex overview --model gpt-5.4 --effort low --

# Careful review
/delegate-claude review --model opus --effort high --
/delegate-codex review --model gpt-5.6-sol --effort ultra --sandbox read-only --

# Adversarial second pass
/delegate-claude adversarial --model sonnet --effort high -- focus on auth and SSRF

# Implement (file edits only for Claude unless you opt into Bash)
/delegate-claude rescue --model opus --effort high -- fix the flaky pagination test
/delegate-codex rescue --model gpt-5.4 --effort medium -- implement the retry helper
```

CLI form Grok’s agent uses under the hood (for debugging / skills):

```bash
node "${GROK_PLUGIN_ROOT}/scripts/delegate-companion.mjs" claude --wait \
  --model sonnet --effort low --trust-project \
  -- overview -- "Quick discovery: purpose, layout, entrypoints."
```

---

## Live log phases

| Phase | Meaning |
|-------|---------|
| `starting` | Session / thread opened |
| `thinking` | Reasoning / thinking blocks (more common at higher effort) |
| `tool` | Tool call or command |
| `writing` | Assistant text chunks |
| `completed` / `failed` | Terminal result |
| `retry` | Transient API / reconnect |

At `--effort low` you may mostly see tools — that is normal. Raise effort or use
thinking-heavy models when you want a denser `thinking:` trail.

---

## Repository layout

```text
grok-delegate/                    ← marketplace root (this repo)
├── marketplace.json              ← "Grok Build Extras"
├── LICENSE
├── README.md
└── plugins/
    └── delegate/                 ← the installable Grok plugin
        ├── .grok-plugin/plugin.json
        ├── commands/             ← /delegate-claude, /delegate-codex
        ├── skills/delegate-runtime/
        ├── scripts/              ← companion + engine adapters
        └── tests/
```

---

## Development

```bash
git clone git@github.com:arthurkatcher/grok-delegate.git
cd grok-delegate/plugins/delegate
npm test
```

Unit + companion CLI tests use Node’s built-in test runner (`node --test`).
No production npm dependencies — pure Node ESM.

---

## Requirements (checklist)

- [ ] Access to private repo `arthurkatcher/grok-delegate`
- [ ] Grok Build with plugins enabled
- [ ] Node 18+
- [ ] Linux or macOS
- [ ] `claude` and/or `codex` on `PATH`, authenticated
- [ ] Codex ≥ 0.144 if you want Sol / Terra / Luna ids
- [ ] Plugin installed with `--trust` and listed in `plugins.enabled`

---

## License

MIT © Arthur Katcher — see [LICENSE](LICENSE).

---

## Why this exists

Grok should stay the orchestrator. The best local CLIs should stay *local* —
with sandboxes, kill-on-cancel, and defaults that don’t hand a silent
`Bash(git …)` to a rescue agent at 2am.

If you can see the tools stream, cancel the task, and trust the permission
table above, you’re using this the way it was meant to be used.
