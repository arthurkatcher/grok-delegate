# grok-delegate

**One Grok task. Two local engines. Zero orphaned agents.**

`grok-delegate` hands work to Claude Code or Codex without handing off the session: live tools in the task log, the result back in Grok, and cancellation that kills the whole process group. Reviews stay read-only by default; Claude rescue gets files, not Bash.

Part of the private **Grok Build Extras** marketplace.

[![Grok Build](https://img.shields.io/badge/Grok_Build-plugin-111111)](https://grok.x.ai)
[![Claude Code](https://img.shields.io/badge/Claude_Code-local_CLI-D97757)](https://docs.anthropic.com/en/docs/claude-code)
[![Codex CLI](https://img.shields.io/badge/Codex-local_CLI-10A37F)](https://github.com/openai/codex)
[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)](plugins/delegate/.grok-plugin/plugin.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## Quick start

From a repository open in Grok:

```text
/delegate-claude setup
/delegate-codex setup

/delegate-claude overview --model sonnet --effort low --trust-project --
/delegate-codex review --effort high -- focus on auth boundaries
```

Expand the background task to watch tool calls, reasoning, and output as they happen. Cancel the task to terminate the delegate's entire process group.

Claude's read-only actions use hermetic `--bare` mode by default. If you authenticate Claude with OAuth/Claude Max rather than `ANTHROPIC_API_KEY`, add `--trust-project`; bare sessions cannot read OAuth credentials.

## Install

The marketplace is a private GitHub repository. Your GitHub account must have access to `arthurkatcher/grok-delegate`, and `git` or `gh` must already be authenticated on the machine running Grok.

Add **Grok Build Extras**:

```bash
grok plugin marketplace add arthurkatcher/grok-delegate
```

Install the plugin package and allow its companion process to run:

```bash
grok plugin install arthurkatcher/grok-delegate#plugins/delegate --trust
```

Then add the plugin to `plugins.enabled` (preserving any existing entries):

```toml
# ~/.grok/config.toml
[plugins]
enabled = ["grok-delegate"]
```

Restart Grok or reload plugins, then verify the installation:

```bash
grok plugin list
grok plugin details grok-delegate
```

If the shorthand clone cannot authenticate, add the marketplace with an explicit remote:

```bash
# HTTPS; use `gh auth setup-git` for private-repo credentials
grok plugin marketplace add https://github.com/arthurkatcher/grok-delegate.git

# SSH
grok plugin marketplace add git@github.com:arthurkatcher/grok-delegate.git
```

To update later:

```bash
grok plugin marketplace update
grok plugin update grok-delegate
```

## Commands

The plugin adds `/delegate-claude` and `/delegate-codex`. Both use the same action vocabulary:

| Action | What it asks the delegate to do | Write access |
| --- | --- | --- |
| `setup` | Check the CLI, authentication, version, and live model catalog | None |
| `overview` | Map the repository, entry points, and architecture | None |
| `review` | Review the current Git scope for concrete defects | None |
| `adversarial` | Re-review with an explicitly skeptical brief | None |
| `rescue` | Implement a specific task | Yes, constrained as documented below |

Pass options before the final `--`; everything after it is focus text, not flags.

```text
# Repository reconnaissance
/delegate-claude overview --model sonnet --effort low --trust-project -- trace the request path
/delegate-codex overview --effort low -- map entry points and test boundaries

# Focused review
/delegate-claude review --model opus --effort high -- inspect auth and session handling
/delegate-codex adversarial --effort high -- look for rollback and concurrency failures

# Implementation
/delegate-claude rescue --model opus --effort high -- fix the flaky pagination test
/delegate-codex rescue --effort medium -- implement the retry helper and run its tests
```

Useful controls include `--model`, `--effort`, `--cwd`, `--read-only`, `--resume`, and `--yolo`. Claude also supports `--trust-project`, `--allowed-tools`, `--disallowed-tools`, `--max-turns`, and `--stream-partial`; Codex supports `--sandbox`, `--approval`, `--search`, and `--ephemeral`.

Models and effort levels are discovered from the installed CLIs instead of being frozen in the plugin. Claude discovery does not spend agent tokens unless `CLAUDE_MODELS_AGENT=1` is set.

## Security model

Delegation is local, but it is still code execution. The defaults are deliberately narrow and the escape hatches are explicit.

| Action | Claude Code default | Codex default |
| --- | --- | --- |
| `overview`, `review`, `adversarial` | Hermetic `--bare`, `dontAsk`, read tools only | OS `read-only` sandbox |
| `rescue` | `acceptEdits`; Read, Edit, Write, Glob, and Grep; **no Bash** | OS `workspace-write` sandbox |
| Full access | Explicit `--allowed-tools` including Bash, or `--yolo` | Explicit `--yolo` |

Important consequences:

- Claude rescue cannot run shell or Git commands unless you opt in. Even scoped Git access can reset, clean, delete branches, or push, so Bash is not part of the default rescue profile.
- `--trust-project` disables Claude's hermetic default for read-only actions and allows project configuration, hooks, MCP servers, and OAuth credentials to load.
- Codex uses `approval_policy=never` inside the selected sandbox. `--yolo` bypasses both approvals and the sandbox; it is intentionally loud.
- Unknown actions and flags fail closed. Free text after `--` cannot turn into options. For complex pasted input, the companion also accepts a structured `--payload-file`.
- Job state is stored under `~/.local/share/grok-delegate` with private directory permissions, not in a world-writable temporary directory.
- On cancellation, the companion sends `SIGTERM` to the delegate process group and escalates to `SIGKILL` if necessary, preventing orphaned Claude or Codex processes.

Use the narrowest mode that can complete the task. For a write-capable Claude rescue that truly needs shell access, opt in precisely:

```text
/delegate-claude rescue --allowed-tools 'Read,Edit,Write,Glob,Grep,Bash' -- fix it and run the targeted tests
```

## How it works

```text
/delegate-claude or /delegate-codex
  -> one Grok background task
  -> delegate-companion.mjs
  -> local `claude` stream-json or `codex exec --json`
  -> normalized progress in the Grok task log
  -> final result returned to Grok
```

The companion owns argument validation, live model discovery, policy selection, process lifecycle, stream normalization, and optional job state. A running task emits concise phases such as `starting`, `thinking`, `tool`, `writing`, `completed`, `retry`, and `failed`.

The low-level form is useful when debugging the plugin contract:

```bash
node "${GROK_PLUGIN_ROOT}/scripts/delegate-companion.mjs" claude --wait \
  --model sonnet --effort low --trust-project \
  -- overview -- "Map the purpose, layout, and entry points."
```

## Requirements

- Access to the private `arthurkatcher/grok-delegate` repository
- Grok Build with plugin support
- Node.js 18 or newer
- Linux or macOS; Windows is unsupported unless explicitly enabled with `GROK_DELEGATE_ALLOW_WINDOWS=1`
- `claude`, `codex`, or both on `PATH` and already authenticated
- Codex 0.144 or newer for GPT-5.6 Sol, Terra, and Luna model IDs
- Plugin installed with `--trust` and present in `plugins.enabled`

Run `/delegate-claude setup` or `/delegate-codex setup` to inspect the actual local CLI, authentication state, supported models, effort levels, and sandbox modes.

## Repository layout

```text
grok-delegate/
├── marketplace.json                 # Grok Build Extras marketplace
├── plugins/delegate/
│   ├── .grok-plugin/plugin.json      # plugin manifest
│   ├── commands/                     # Grok slash commands
│   ├── skills/delegate-runtime/      # host execution contract
│   ├── scripts/                      # companion and engine adapters
│   └── tests/                        # unit and CLI integration tests
├── LICENSE
└── README.md
```

## Development

```bash
git clone git@github.com:arthurkatcher/grok-delegate.git
cd grok-delegate/plugins/delegate
npm test
```

The runtime is pure Node ESM with no production npm dependencies. Tests use Node's built-in test runner.

## License

[MIT](LICENSE) © 2026 Arthur Katcher.
