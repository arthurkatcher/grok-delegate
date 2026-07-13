/**
 * Execution mode for long Claude Code runs.
 *
 * **Grok-hosted path (preferred):** the agent launches this process with
 * Grok `run_terminal_command({ background: true })` and passes **`--wait`**.
 * The shell stays alive, tool events stream to stdout → native Grok task log.
 * The main chat turn is free; expand the task for live tools. Do not poll.
 *
 * - --wait → block this process until Claude finishes (stdout = live stream)
 * - --background → companion-internal detached worker (job.log only; no Grok task stream)
 * - neither → wait (so hosting under Grok background:true is correct by default)
 */
export function resolveExecutionMode(options = {}) {
  if (options.wait) {
    return { background: false, mode: "wait" };
  }
  if (options.background) {
    return { background: true, mode: "background" };
  }
  // Default wait: under Grok, agent must use shell background:true so the
  // process is the expandable task and tool lines land in task stdout.
  return { background: false, mode: "wait-default" };
}
