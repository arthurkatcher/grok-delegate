---
name: delegate-runtime
description: Internal contract for grok-delegate companion (Claude Code + Codex CLI)
user-invocable: false
---

# grok-delegate runtime

## Hosting

```text
run_terminal_command({ background: true })
  → node $GROK_PLUGIN_ROOT/scripts/delegate-companion.mjs <claude|codex> --wait [flags] -- <action> "focus"
  → expand Grok task for live tools
  → cancel task → SIGTERM kills Claude/Codex process group
```

Never poll companion status into chat. Put free text after `--`. Prefer `--payload-file` for messy paste.

## Engines

- `claude` — hermetic RO by default; rescue = file tools only (no Bash unless user opts in)
- `codex` — OS sandbox; `--search` is a global flag before `exec`
