# grok-delegate

A **Grok Build plugin** that runs **Claude Code** or **Codex** for you as a background task.

You stay in Grok. The other CLI does the work. Tools stream into the task log. Cancel the task → the agent process dies with it.

Marketplace: **Grok Build Extras** (this private repo).

## Install

Private repo — you need GitHub access and `git`/`gh` auth.

```bash
grok plugin marketplace add arthurkatcher/grok-delegate
grok plugin install arthurkatcher/grok-delegate#plugins/delegate --trust
```

```toml
# ~/.grok/config.toml
[plugins]
enabled = ["grok-delegate"]
```

You also need `claude` and/or `codex` on your PATH, already logged in. Node 18+, Linux/macOS.

## Use

```text
/delegate-claude setup
/delegate-codex setup

/delegate-claude overview --model sonnet --trust-project --
/delegate-codex review --model gpt-5.6-sol --effort high --

/delegate-claude rescue --model opus -- fix the flaky test
/delegate-codex rescue -- implement the retry helper
```

Actions: `setup` · `overview` · `review` · `adversarial` · `rescue`

Flags before `--`. Focus text after. Expand the Grok task for the live stream.

## Defaults (short version)

- Read actions stay read-only (Claude hermetic / Codex sandbox).
- Claude rescue = file edits only — **no Bash** unless you opt in or pass `--yolo`.
- Claude OAuth/Max: add `--trust-project` on read actions (bare mode won’t see that login).
- Missing CLI or auth → same setup-style next steps; nothing is spawned.

## License

MIT © Arthur Katcher
