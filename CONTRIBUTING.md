# Contributing

Thanks for helping with **grok-delegate**. This repo is the private **Grok Build Extras** marketplace; the installable plugin is `plugins/delegate/`.

## Before you start

1. Read [README.md](README.md) (product + install) and [SECURITY.md](SECURITY.md) (how to report vulns).
2. Skim [AGENTS.md](AGENTS.md) if you are an automated coding agent — same rules apply to humans.
3. You need Node **18+**, and for live smoke tests: Grok Build plus `claude` and/or `codex` on `PATH`.

## Local development

```bash
git clone git@github.com:arthurkatcher/grok-delegate.git
cd grok-delegate/plugins/delegate
npm test
```

Optional: validate the Grok plugin package layout:

```bash
grok plugin validate plugins/delegate
```

For a real install from this checkout:

```bash
grok plugin marketplace add /path/to/grok-delegate
grok plugin install /path/to/grok-delegate/plugins/delegate --trust
# enable "grok-delegate" in ~/.grok/config.toml [plugins].enabled
```

Prefer iterating against a local path marketplace while developing; switch back to the GitHub install for release checks.

## What to change where

| Area | Path |
|------|------|
| Slash commands | `plugins/delegate/commands/` |
| Companion CLI | `plugins/delegate/scripts/delegate-companion.mjs` |
| Engines / policy / stream | `plugins/delegate/scripts/lib/` |
| Host contract for Grok | `plugins/delegate/skills/delegate-runtime/` |
| Tests | `plugins/delegate/tests/` |
| Marketplace catalog | `marketplace.json` |
| Version | `plugins/delegate/.grok-plugin/plugin.json` **and** `marketplace.json` |

## Pull requests

1. Branch from `main`.
2. Keep changes small and reviewable. Match existing ADRs in spirit: retrieval-first for power, fail-closed flags, no silent shell on Claude rescue.
3. Add or update tests for behavior changes.
4. Run `npm test` (and `grok plugin validate plugins/delegate` if you touch layout/manifest).
5. Update [CHANGELOG.md](CHANGELOG.md) under **Unreleased** when the change is user-visible.
6. Do **not** commit secrets, API keys, `token.key`, real job state, or personal `mcp.json` with credentials.
7. PRs squash-merge; branches delete on merge.

## Security reports

Do not open public issues for vulnerabilities. Follow [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the MIT License in this repository.
