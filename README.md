# grok-delegate

A **Grok Build plugin** that runs **Claude Code** or **Codex** for you as a background task.

You stay in Grok. The other CLI does the work. Tools stream into the task log. Cancel the task → the agent process dies with it.

Marketplace: **Grok Build Extras** (this private repo).

[![Grok Build](https://img.shields.io/badge/Grok_Build-plugin-111111)](https://grok.x.ai)
[![Claude Code](https://img.shields.io/badge/Claude_Code-local_CLI-D97757)](https://docs.anthropic.com/en/docs/claude-code)
[![Codex CLI](https://img.shields.io/badge/Codex-local_CLI-10A37F)](https://github.com/openai/codex)
[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)](plugins/delegate/.grok-plugin/plugin.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## Use

```text
/delegate-claude setup
/delegate-codex setup

/delegate-claude overview --model sonnet --effort low --trust-project --
/delegate-codex review --model gpt-5.6-sol --effort high --

/delegate-claude rescue --model opus --effort high -- fix the flaky test
/delegate-codex rescue -- implement the retry helper
```

Actions: `setup` · `overview` · `review` · `adversarial` · `rescue`

Flags go before `--`. Focus text goes after. Expand the Grok background task for the live stream (`starting` / `thinking` / `tool` / `writing` / `completed`). Cancel that task to kill the whole engine process group.

| Action | What it does | Writes? |
|--------|----------------|---------|
| `setup` | Check CLI, auth, version, live model catalog | No |
| `overview` | Map the repo, entry points, architecture | No |
| `review` | Review the current git scope | No |
| `adversarial` | Skeptical second pass | No |
| `rescue` | Implement a concrete task | Yes (constrained) |

Useful flags: `--model`, `--effort`, `--cwd`, `--read-only`, `--resume`, `--yolo`. Claude also: `--trust-project`, `--allowed-tools`, `--disallowed-tools`, `--max-turns`, `--stream-partial`. Codex also: `--sandbox`, `--approval`, `--search`, `--ephemeral`.

Models and efforts come from the installed CLIs at runtime (not a frozen list in the plugin). Claude discovery never spends agent tokens unless you set `CLAUDE_MODELS_AGENT=1`.

## Install

Private repo — your GitHub user needs access to `arthurkatcher/grok-delegate`, and `git` / `gh` must already be authenticated on the machine that runs Grok.

```bash
grok plugin marketplace add arthurkatcher/grok-delegate
grok plugin install arthurkatcher/grok-delegate#plugins/delegate --trust
```

```toml
# ~/.grok/config.toml
[plugins]
enabled = ["grok-delegate"]
```

Restart Grok (or reload plugins), then:

```bash
grok plugin list
grok plugin details grok-delegate
```

If the shorthand clone fails auth, use an explicit remote:

```bash
grok plugin marketplace add https://github.com/arthurkatcher/grok-delegate.git
# or
grok plugin marketplace add git@github.com:arthurkatcher/grok-delegate.git
```

Update later:

```bash
grok plugin marketplace update
grok plugin update grok-delegate
```

The `#plugins/delegate` bit is required because this repo is a **marketplace root**; the installable plugin lives in that subdirectory. `--trust` allows the companion scripts to run.

## What you need

- Access to private `arthurkatcher/grok-delegate`
- Grok Build with plugins
- Node.js 18+
- Linux or macOS (Windows only if `GROK_DELEGATE_ALLOW_WINDOWS=1`)
- `claude` and/or `codex` on `PATH`, already authenticated
- Codex ≥ 0.144 if you want GPT-5.6 Sol / Terra / Luna ids
- Plugin installed with `--trust` and listed in `plugins.enabled`

Auth is **not** part of the plugin install. Grok login, GitHub access, and `claude auth login` / `codex login` (or API keys) are separate. Run `setup` first on a new machine — if the binary or login is missing, every action prints the same next steps and does **not** spawn the engine.

## Defaults

Read work stays read-only. Write work is narrow unless you open it up.

| Action | Claude | Codex |
|--------|--------|-------|
| `overview` / `review` / `adversarial` | Hermetic `--bare`, `dontAsk`, read tools | OS `read-only` sandbox |
| `rescue` | File tools only (Read/Edit/Write/Glob/Grep) — **no Bash** | OS `workspace-write` |
| Full power | `--allowed-tools '…,Bash'` or `--yolo` | `--yolo` |

Why no Bash on Claude rescue by default? Even “just git” can `reset --hard`, `clean -fdx`, force-push, or delete branches. Shell is opt-in.

Other hard edges:

- Claude OAuth / Max: add `--trust-project` on read actions. Hermetic `--bare` only sees `ANTHROPIC_API_KEY` (not your Max login).
- Free text after `--` cannot inject flags. Unknown actions/flags fail closed. Prefer `--payload-file` for messy paste.
- Job state under `~/.local/share/grok-delegate` (mode `0700`), not world-writable tmp.
- Cancel Grok task → companion `SIGTERM`s the engine process group (then `SIGKILL` if needed). No orphaned agents.
- Codex uses `approval_policy=never` inside the chosen sandbox; `--yolo` is intentionally loud.

Need shell on Claude rescue:

```text
/delegate-claude rescue --allowed-tools 'Read,Edit,Write,Glob,Grep,Bash' -- fix it and run the targeted tests
```

## How it works

```text
/delegate-claude or /delegate-codex
  → one Grok background task
  → node …/delegate-companion.mjs <engine> --wait …
  → local `claude` (stream-json) or `codex exec --json`
  → progress lines on stdout → Grok task log
  → final result back in the task
```

The companion owns argv validation, live model discovery, policy, process lifecycle, stream mapping, and optional job state.

Low-level form (debugging / skills):

```bash
node "${GROK_PLUGIN_ROOT}/scripts/delegate-companion.mjs" claude --wait \
  --model sonnet --effort low --trust-project \
  -- overview -- "Map purpose, layout, entry points."
```

## Layout

```text
grok-delegate/                      marketplace root
├── marketplace.json                Grok Build Extras
├── plugins/delegate/               installable plugin
│   ├── .grok-plugin/plugin.json
│   ├── commands/                   /delegate-claude, /delegate-codex
│   ├── skills/delegate-runtime/    host contract for Grok
│   ├── scripts/                    companion + engines
│   └── tests/
├── LICENSE
└── README.md
```

## Development

```bash
git clone git@github.com:arthurkatcher/grok-delegate.git
cd grok-delegate/plugins/delegate
npm test
```

Pure Node ESM, no production npm deps. Tests use `node --test`.

## License

[MIT](LICENSE) © Arthur Katcher
