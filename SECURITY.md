# Security Policy

## About this project

**grok-delegate** is a Grok Build plugin that launches local **Claude Code** and **Codex** processes on the operator’s machine. Risk is mostly about **trust, defaults, and process control** (shell access, write scope, orphaned agents, secret handling), not a multi-tenant network service.

## Supported versions

| Version | Supported |
|---------|-----------|
| `main` / latest `0.1.x` | Yes |
| Older tags / forks | Best effort only |

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security-sensitive findings.

**Preferred:** [GitHub private vulnerability reporting](https://github.com/arthurkatcher/grok-delegate/security/advisories/new) — Security → Advisories → Report a vulnerability (enabled on this public repo).

**Alternative:** email **apps@kardash.ai** with a subject like `[security] grok-delegate …`.

Include, when you can:

- What you found and why it matters  
- Steps to reproduce (minimal)  
- Affected version / commit  
- Whether you plan to disclose publicly and on what timeline  

We will acknowledge reports when we can and work with you on a fix before any coordinated disclosure. There is no paid bug bounty at this time.

## What we care about most

High-signal examples:

- Ways to **escape** intended Claude/Codex permission or sandbox defaults without an explicit opt-in (`--yolo`, extra tools, etc.)  
- **Flag / argv injection** from free-text focus after `--`  
- Failure to **kill** engine process groups on cancel, leaving privileged children running  
- **Secret leakage** into job logs, activity files, or world-readable paths  
- Supply-chain issues in install paths (`grok plugin install`, marketplace clone) that could run untrusted code under `--trust`  
- Auth/preflight bypass that makes a missing or unauthenticated CLI look ready  

Lower priority (still welcome if clearly harmful): pure DoS of the companion, cosmetic log issues, or model-output quality.

## Non-vulnerabilities (please don’t file these as security)

- User chose `--yolo`, broad `--allowed-tools`, or trusted an untrusted marketplace/plugin  
- Model produces bad code or bad advice inside an intended sandbox  
- Missing binary / failed login (operational; use `setup`)  
- Features that are intentionally out of scope (Windows, multi-tenant SaaS, etc.)

## Safe defaults (for operators)

- Prefer read-only actions for exploration and review  
- Keep Claude **rescue** without Bash unless you explicitly need shell  
- Only install/trust plugins and marketplaces you control  
- Treat `GROK_PLUGIN_ROOT` companion scripts as executable code on your machine  

## Thanks

Responsible reports help keep delegation safe for people who use this as an orchestrator. We appreciate the care.
