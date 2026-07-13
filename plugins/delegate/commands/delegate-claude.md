---
description: Delegate to local Claude Code (Grok background task; live tools in task log)
argument-hint: "[setup|overview|review|adversarial|rescue] [--model <id>] [--effort <lvl>] [--read-only] [--trust-project] [--yolo] -- [focus…]"
disable-model-invocation: true
---

Delegate to **local Claude Code**. Models/efforts are discovered live from the installed CLI.

## Launch (required)

Use **exactly one** `run_terminal_command` with **`background: true`** and **`timeout: 0`** (or a very high timeout) so the host does not SIGTERM the companion after ~20s.

Put **flags before free text**. Use `--` before focus so paste cannot inject flags.
Do **not** unquote free-form text into the shell — pass as separate argv tokens after `--`.

```bash
node "${GROK_PLUGIN_ROOT}/scripts/delegate-companion.mjs" claude --wait --model MODEL --effort EFFORT -- overview -- "focus text"
```

For complex paste, write JSON and use:

```bash
node "${GROK_PLUGIN_ROOT}/scripts/delegate-companion.mjs" claude --wait --payload-file /tmp/payload.json
```

Payload shape: `{ "positionals": ["review", "focus…"], "options": { "model": "opus" } }`

- Expand the **Grok task** for live tools (`thinking` / `tool` / `writing`).
- Cancel the Grok task → companion SIGTERM kills Claude process tree.
- Do **not** poll status into chat.

## Safety defaults

| Action | Default |
|--------|---------|
| overview / review / adversarial | Prefer hermetic `--bare` + read tools (`dontAsk`) when `ANTHROPIC_API_KEY` is set; **Max/OAuth without a key auto-drops `--bare`** (same practical mode as `--trust-project`) so first launch works |
| rescue | `acceptEdits` + **file tools only** (Read/Edit/Write/Glob/Grep) — **no Bash** |
| Shell / git CLI | Explicit `--allowed-tools '…,Bash(…)'` or full `--yolo` |

Pass explicit `--bare` only if you have an API key and want to force hermetic (hard-fails without a key). Prefer `--cwd` at a real project, not `$HOME`.

## Auth / preflight

`claude auth login` or `ANTHROPIC_API_KEY`. Setup first if unsure.

**Every action** runs the same readiness check first: `claude` on `PATH` + login/API key/token. If not ready, the companion **does not spawn** Claude — it prints setup-style next steps and exits non-zero.

Raw arguments (agent: re-split carefully; prefer structured payload):

$ARGUMENTS
