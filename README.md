# grok-delegate

**grok-delegate** is a Grok Build plugin that hands work to local **Claude Code** or **Codex** while you stay in the Grok session. 

The delegate runs as a normal background task: tools and progress stream into the task log, the result comes back when it finishes, and canceling the task stops the engine’s whole process group so nothing is left orphaned.

This private repository is the **Grok Build Extras** marketplace. The installable plugin package is under `plugins/delegate/`.

[![Grok Build](https://img.shields.io/badge/Grok_Build-plugin-111111)](https://grok.x.ai)
[![Claude Code](https://img.shields.io/badge/Claude_Code-local_CLI-D97757)](https://docs.anthropic.com/en/docs/claude-code)
[![Codex CLI](https://img.shields.io/badge/Codex-local_CLI-10A37F)](https://github.com/openai/codex)
[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)](plugins/delegate/.grok-plugin/plugin.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## What you get

Two slash commands — `/delegate-claude` and `/delegate-codex` — that hand a job to the matching local CLI without leaving Grok. Progress shows up in the background-task pane the same way any other long Grok job does: `starting`, `thinking`, `tool`, `writing`, `completed`. When the run finishes, the answer is in that task. When you cancel it, the companion stops the whole engine process group so nothing is left running in the background.

Both commands share the same actions:

| Action | Intent | Can write files? |
|--------|--------|------------------|
| `setup` | Check that the CLI is installed, authenticated, and what models it knows about | No |
| `overview` | Map the repo — purpose, layout, entry points | No |
| `review` | Review the current git scope for concrete problems | No |
| `adversarial` | Same as review, with a deliberately skeptical brief | No |
| `rescue` | Implement a specific change | Yes, under the defaults below |

Put flags before `--`. Everything after `--` is focus text for the delegate, never options. Models and effort levels are read from your installed CLIs at runtime, not hard-coded in the plugin.

```text
/delegate-claude setup
/delegate-codex setup

/delegate-claude overview --model sonnet --effort low --trust-project --
/delegate-codex review --model gpt-5.6-sol --effort high -- focus on auth

/delegate-claude rescue --model opus --effort high -- fix the flaky pagination test
/delegate-codex rescue -- implement the retry helper
```

Common flags for both engines: `--model`, `--effort`, `--cwd`, `--read-only`, `--resume`, `--yolo`. Claude also understands `--trust-project`, `--allowed-tools`, `--disallowed-tools`, `--max-turns`, and `--stream-partial`. Codex also understands `--sandbox`, `--approval`, `--search`, and `--ephemeral`.

---

## Install

You need access to the private GitHub repo `arthurkatcher/grok-delegate`, and `git` or `gh` already authenticated on the machine that runs Grok. The plugin install does **not** log you into Claude, Codex, or Grok itself — those stay separate.

```bash
grok plugin marketplace add arthurkatcher/grok-delegate
grok plugin install arthurkatcher/grok-delegate#plugins/delegate --trust
```

Then enable it (keep any other plugins you already have listed):

```toml
# ~/.grok/config.toml
[plugins]
enabled = ["grok-delegate"]
```

Restart Grok or reload plugins, and check:

```bash
grok plugin list
grok plugin details grok-delegate
```

The `#plugins/delegate` suffix matters. This git root is a marketplace catalog; the package Grok should trust and run is the subdirectory. `--trust` is required so the companion scripts are allowed to execute.

If the GitHub shorthand cannot clone, add the marketplace with a full remote instead:

```bash
grok plugin marketplace add https://github.com/arthurkatcher/grok-delegate.git
# or
grok plugin marketplace add git@github.com:arthurkatcher/grok-delegate.git
```

To pick up later releases:

```bash
grok plugin marketplace update
grok plugin update grok-delegate
```

### What else has to be on the machine

- Grok Build with plugins enabled  
- Node.js 18 or newer  
- Linux or macOS (Windows only if you set `GROK_DELEGATE_ALLOW_WINDOWS=1`)  
- `claude` and/or `codex` on your `PATH`, already signed in (`claude auth login`, `codex login`, or the usual API keys)  
- Codex 0.144+ if you want GPT-5.6 Sol / Terra / Luna model ids  

On a new laptop, start with `/delegate-claude setup` or `/delegate-codex setup`. Every other action runs the **same** readiness check first. If the binary is missing or you are not logged in, the companion prints the setup-style next steps and does not start the engine.

---

## Defaults and safety

Read work is read-only. Write work is intentionally narrow unless you open it up.

| Action | Claude default | Codex default |
|--------|----------------|---------------|
| `overview`, `review`, `adversarial` | Hermetic `--bare`, permission mode `dontAsk`, read tools only | OS `read-only` sandbox |
| `rescue` | File tools only — Read, Edit, Write, Glob, Grep — **no Bash** | OS `workspace-write` sandbox |
| Full power | Explicit `--allowed-tools` including Bash, or `--yolo` | Explicit `--yolo` |

Claude rescue does not get a shell by default on purpose. Even “just git” can force-push, `reset --hard`, or wipe untracked files. If you really need shell for a rescue, opt in:

```text
/delegate-claude rescue --allowed-tools 'Read,Edit,Write,Glob,Grep,Bash' -- fix it and run the tests
```

A few other rules that matter in practice:

If you use Claude Max or OAuth rather than `ANTHROPIC_API_KEY`, pass `--trust-project` on read-only actions. Hermetic `--bare` does not see that login.

Anything after `--` cannot turn into flags. Unknown actions and options fail closed. For awkward multi-line paste, use `--payload-file` instead of fighting the shell.

Job state lives under `~/.local/share/grok-delegate` with private permissions, not in a world-writable temp directory.

Canceling the Grok task sends `SIGTERM` to the engine process group (and escalates if needed). You should not be left with orphaned Claude or Codex processes.

Codex runs with `approval_policy=never` inside the sandbox you chose. `--yolo` turns both approvals and the sandbox off — use it only when you mean it.

---

## How it works

Under the hood the slash command is a thin host around one long-lived companion process:

```text
/delegate-claude or /delegate-codex
    → Grok starts a background task
    → node …/delegate-companion.mjs <claude|codex> --wait …
    → local Claude (stream-json) or Codex (exec --json)
    → progress lines on stdout → Grok task log
    → final result in the same task
```

The companion owns argument validation, live model discovery, permission policy, process lifecycle, and turning engine events into the short progress lines you see in the task pane.

If you are debugging the plugin contract from a skill or shell, the same entrypoint looks like this:

```bash
node "${GROK_PLUGIN_ROOT}/scripts/delegate-companion.mjs" claude --wait \
  --model sonnet --effort low --trust-project \
  -- overview -- "Map purpose, layout, and entry points."
```

---

## Repository layout

```text
grok-delegate/                   marketplace root (this repo)
├── marketplace.json             Grok Build Extras catalog
├── plugins/delegate/            the installable plugin
│   ├── .grok-plugin/            manifest
│   ├── commands/                /delegate-claude, /delegate-codex
│   ├── skills/delegate-runtime/ how Grok should launch the companion
│   ├── scripts/                 companion + Claude/Codex adapters
│   └── tests/
├── LICENSE
└── README.md
```

---

## Development

```bash
git clone git@github.com:arthurkatcher/grok-delegate.git
cd grok-delegate/plugins/delegate
npm test
```

The runtime is plain Node ESM with no production npm dependencies. Tests use Node’s built-in test runner (`node --test`).

---

## Security

See [SECURITY.md](SECURITY.md) for how to report vulnerabilities (private advisory / email). Do not file security-sensitive issues in public trackers.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Coding agents: start with [AGENTS.md](AGENTS.md). User-visible changes go in [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE) © Arthur Katcher
