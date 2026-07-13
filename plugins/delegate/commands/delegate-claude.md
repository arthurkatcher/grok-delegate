---
description: Delegate to local Claude Code (Grok background task; live tools in task log)
argument-hint: "[setup|overview|review|adversarial|rescue] [--model <id>] [--effort <lvl>] [--read-only] [--trust-project] [--yolo] -- [focus…]"
disable-model-invocation: true
---

Delegate to **local Claude Code**. Models/efforts are discovered live from the installed CLI.

## Launch (required)

Use **exactly one** `run_terminal_command` with **`background: true`**.

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
| overview / review / adversarial | Hermetic `--bare` + read tools (`dontAsk`); use `--trust-project` to load project hooks/MCP |
| rescue | `acceptEdits` + **file tools only** (Read/Edit/Write/Glob/Grep) — **no Bash** |
| Shell / git CLI | Explicit `--allowed-tools '…,Bash(…)'` or full `--yolo` |

## Auth

`claude auth login` or `ANTHROPIC_API_KEY`. Setup first if unsure.

Raw arguments (agent: re-split carefully; prefer structured payload):

$ARGUMENTS
