import { spawnSync } from "node:child_process";
import process from "node:process";

/**
 * Run a command. Failures: non-zero status, signal, or spawn error.
 * Never coerce null status to 0 (timeout/signal must not look successful).
 */
export function runCommand(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    input: options.input,
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
    stdio: options.stdio ?? "pipe",
    shell: options.shell ?? false,
    windowsHide: true,
    timeout: options.timeout
  });

  let status = result.status;
  if (status === null || status === undefined) {
    // timeout or signal — treat as failure
    status = result.signal ? 1 : result.error ? 1 : 1;
  }

  return {
    command,
    args,
    status,
    signal: result.signal ?? null,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null,
    ok: !result.error && !result.signal && result.status === 0
  };
}

export function binaryAvailable(command, versionArgs = ["--version"], options = {}) {
  if (process.platform === "win32" && process.env.GROK_DELEGATE_ALLOW_WINDOWS !== "1") {
    return {
      available: false,
      detail: "Windows is not supported yet (set GROK_DELEGATE_ALLOW_WINDOWS=1 to override)"
    };
  }
  const result = runCommand(command, versionArgs, { ...options, timeout: options.timeout ?? 15_000 });
  if (result.error && /** @type {NodeJS.ErrnoException} */ (result.error).code === "ENOENT") {
    return { available: false, detail: "not found" };
  }
  if (result.error) {
    return { available: false, detail: result.error.message };
  }
  if (result.signal) {
    return { available: false, detail: `killed by ${result.signal}` };
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`;
    return { available: false, detail };
  }
  return { available: true, detail: result.stdout.trim() || result.stderr.trim() || "ok" };
}

export function formatCommandFailure(result) {
  const parts = [
    `${result.command} ${result.args.join(" ")}`.trim(),
    result.stderr?.trim(),
    result.stdout?.trim(),
    result.error?.message,
    result.signal && `signal ${result.signal}`
  ].filter(Boolean);
  return parts.join("\n") || `Command failed with exit ${result.status}`;
}
