---
description: Delegate to local Codex CLI (Grok background task; live tools in task log)
argument-hint: "[setup|overview|review|adversarial|rescue] [--model <id>] [--effort <lvl>] [--sandbox <mode>] [--read-only] [--yolo] -- [focus…]"
disable-model-invocation: true
---

Delegate to **local OpenAI Codex CLI**. Models/efforts from live `codex debug models` (GPT-5.6 Sol/Terra/Luna when CLI ≥ 0.144).

## Launch (required)

Use **exactly one** `run_terminal_command` with **`background: true`** and **`timeout: 0`** (or a very high timeout) so the host does not SIGTERM the companion after ~20s.

Flags before free text; use `--` before focus. Prefer `--payload-file` for messy paste. Prefer **`--cwd`** at a real project/repo (not `$HOME`).

```bash
node "${GROK_PLUGIN_ROOT}/scripts/delegate-companion.mjs" codex --wait --model gpt-5.6-sol --effort ultra --sandbox read-only -- review -- "focus text"
```

- Expand the **Grok task** for live tools.
- Cancel the Grok task → stops Codex process tree.
- Do **not** poll status into chat.

If `cwd` is **not** a git work tree, the companion auto-passes **`--skip-git-repo-check`** so Codex does not refuse `$HOME`/non-repo dirs on first launch.

## Sandbox

| Action soft default (if `--sandbox` omitted) |
|-----------------------------------------------|
| overview / review / adversarial → `read-only` |
| rescue → `workspace-write` |

User can always pass `--sandbox …` or `--yolo`. `--read-only` rejects write sandboxes.

## Auth / preflight

`codex login` or `CODEX_API_KEY`. Setup warns if CLI &lt; 0.144 for GPT-5.6.

**Every action** (`setup`, `overview`, `review`, `adversarial`, `rescue`) runs the same readiness check first: Codex binary on `PATH` + login/API key. If not ready, the companion **does not spawn** Codex — it prints the setup-style next steps and exits non-zero.

Raw arguments:

$ARGUMENTS
