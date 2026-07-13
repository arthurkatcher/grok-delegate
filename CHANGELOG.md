# Changelog

All notable changes to **grok-delegate** / **Grok Build Extras** are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [SemVer](https://semver.org/) for the plugin package (`plugins/delegate`).

## [Unreleased]

### Added

- (nothing yet)

## [0.1.0] — 2026-07-13

### Added

- Initial **Grok Build Extras** marketplace and **grok-delegate** plugin
- Slash commands `/delegate-claude` and `/delegate-codex` with actions: `setup`, `overview`, `review`, `adversarial`, `rescue`
- Companion runtime (`delegate-companion.mjs`) with fail-closed argv, live model discovery, kill-on-cancel process groups
- Claude defaults: hermetic RO overview/review; rescue = file tools only (**no Bash**)
- Codex defaults: OS `read-only` sandbox for RO actions; `workspace-write` for rescue
- Shared preflight (binary + auth) on every action, with setup-style next steps when not ready
- Policy conflicts validated before readiness (e.g. `--read-only` + `--yolo`)
- Codex stream: no successful `Bash done` noise; failures still logged
- `SECURITY.md`, Dependabot config, CI (`npm test` + `grok plugin validate`)
- GitHub security: Dependabot alerts + automated security fixes enabled on the repo

### Security

- Default Claude rescue disallows Bash (git/shell opt-in only)
- Job state under `~/.local/share/grok-delegate` (mode `0700`)
- Free text after `--` cannot inject flags

[Unreleased]: https://github.com/arthurkatcher/grok-delegate/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/arthurkatcher/grok-delegate/releases/tag/v0.1.0
