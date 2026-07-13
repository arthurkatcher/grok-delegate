export function buildOverviewPrompt({ cwd, focus }) {
  const focusBlock = focus?.trim()
    ? `\n\nAdditional focus from the user:\n${focus.trim()}\n`
    : "";
  return `You are producing an architecture overview for a peer coding agent (Grok Build).

Repository working directory: ${cwd}
${focusBlock}
Requirements:
- Read-only exploration only. Do not modify files.
- Be concrete: paths, entrypoints, modules, data flow, risks, next steps.
- Structure with clear markdown headings.
- End with prioritized improvements if gaps are clear.`;
}

export function buildReviewPrompt({ cwd, focus, scopeSummary, adversarial = false }) {
  const focusBlock = focus?.trim() ? `\n\nFocus:\n${focus.trim()}\n` : "";
  const stance = adversarial
    ? "Challenge the design aggressively: find holes, failure modes, and weaker alternatives."
    : "Prioritize bugs, regressions, security, and missing tests. Findings first, ordered by severity.";
  return `You are reviewing code for a peer coding agent (Grok Build).

Repository: ${cwd}
Scope:
${scopeSummary || "(auto)"}
${focusBlock}
${stance}
Read-only: do not modify files.
Present findings with file references; then open questions; brief summary last.`;
}

export function buildRescuePrompt({ cwd, task, write = true }) {
  const mode = write
    ? "You may edit files and run commands to implement the fix."
    : "Read-only diagnosis only — do not modify files.";
  return `You are helping a peer coding agent (Grok Build) on a rescue task.

Repository: ${cwd}
Task:
${task}

${mode}
Be concrete and finish end-to-end when write mode is on (implement + verify).`;
}
