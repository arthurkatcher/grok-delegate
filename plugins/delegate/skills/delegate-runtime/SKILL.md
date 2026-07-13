---
name: delegate-runtime
description: Internal contract for grok-delegate companion (Claude Code + Codex CLI)
user-invocable: false
---

# grok-delegate runtime

## Hosting

```text
run_terminal_command({ background: true, timeout: 0 })
  → node $GROK_PLUGIN_ROOT/scripts/delegate-companion.mjs <claude|codex> --wait [flags] -- <action> "focus"
  → expand Grok task for live tools
  → cancel task → SIGTERM kills Claude/Codex process group
```

**Always set `timeout: 0`** (or multi-hour) on the Grok background shell — default ~20s kills long delegates with cancel (SIGTERM).

Never poll companion status into chat. Put free text after `--`. Prefer `--payload-file` for messy paste. Prefer `--cwd` at a real project, not `$HOME`.

## Engines

- `claude` — RO prefers hermetic `--bare` when `ANTHROPIC_API_KEY` is set; **Max/OAuth without a key auto-drops `--bare`** so first launch works; rescue = file tools only (no Bash unless user opts in)
- `codex` — OS sandbox; `--search` is a global flag before `exec`; **auto `--skip-git-repo-check` when cwd is not a git work tree**
