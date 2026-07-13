/**
 * Safety policy: read-only authority, write mode, effective sandbox/permission.
 */

const ACTIONS = new Set(["setup", "overview", "review", "adversarial", "rescue"]);

/**
 * Claude hermetic `--bare` only sees API keys, not Max/OAuth.
 * When the user is logged in via Max but has no key, auto-relax bare
 * unless they explicitly passed `--bare`.
 *
 * @param {ReturnType<typeof resolvePolicy>} policy
 * @param {{ loggedIn?: boolean, env?: { hasApiKey?: boolean, hasAuthToken?: boolean, hasOauthToken?: boolean } }} auth
 * @param {Record<string, unknown>} options raw CLI options
 * @returns {{ policy: typeof policy, error: string|null, note: string|null }}
 */
export function adjustClaudePolicyForAuth(policy, auth = {}, options = {}) {
  if (!policy?.bare) {
    return { policy, error: null, note: null };
  }

  const hasKey = Boolean(auth.env?.hasApiKey || auth.env?.hasAuthToken);
  if (hasKey) {
    return { policy, error: null, note: null };
  }

  // Explicit --bare with no API key → still hard-fail (user asked for hermetic).
  if (options.bare === true) {
    return {
      policy,
      error:
        "--bare requires ANTHROPIC_API_KEY (or apiKeyHelper); OAuth/Max is not read in bare mode.",
      note: null
    };
  }

  // Default RO hermetic: first-launch Max/OAuth users should not hard-fail.
  // Keep permissionMode / tool allowlists; only drop --bare.
  return {
    policy: {
      ...policy,
      bare: false,
      hermetic: false,
      trustProject: true
    },
    error: null,
    note:
      "Note: hermetic --bare needs ANTHROPIC_API_KEY; using Max/OAuth-compatible mode (no --bare). Pass --trust-project to silence this, or set an API key + --bare for hermetic RO."
  };
}

/**
 * Codex refuses non-git / untrusted cwds unless --skip-git-repo-check.
 * Auto-enable outside a git work tree; honor explicit flag.
 *
 * @param {string} cwd
 * @param {Record<string, unknown>} options
 * @param {(dir: string) => boolean} [isGit]
 */
export function resolveCodexSkipGitRepoCheck(cwd, options = {}, isGit = null) {
  if (options["skip-git-repo-check"]) return { skip: true, auto: false };
  // Allow forcing strict git-only if we add a flag later; for now only auto.
  if (typeof isGit === "function") {
    const inGit = isGit(cwd);
    if (!inGit) return { skip: true, auto: true };
    return { skip: false, auto: false };
  }
  return { skip: Boolean(options["skip-git-repo-check"]), auto: false };
}

export function listActions() {
  return [...ACTIONS];
}

export function isValidAction(action) {
  return ACTIONS.has(action);
}

/**
 * @returns {{
 *   write: boolean,
 *   hermetic: boolean,
 *   permissionMode: string|null,
 *   sandbox: string|null,
 *   approval: string,
 *   yolo: boolean,
 *   bare: boolean,
 *   errors: string[]
 * }}
 */
export function resolvePolicy(engine, action, options = {}) {
  const errors = [];
  const yolo = Boolean(options.yolo);
  const readOnlyFlag = Boolean(options["read-only"]);
  const trustProject = Boolean(options["trust-project"]);
  const userPermission = options["permission-mode"] || null;
  const userSandbox = options.sandbox || null;
  const userApproval = options.approval || null;

  const isRoAction =
    action === "overview" || action === "review" || action === "adversarial";
  let write =
    action === "rescue" && options.write !== false && !readOnlyFlag;

  if (readOnlyFlag) {
    write = false;
  }
  if (isRoAction) {
    write = false;
  }

  // Conflicts
  if (readOnlyFlag && yolo) {
    errors.push("--read-only conflicts with --yolo");
  }
  if (readOnlyFlag && userPermission === "acceptEdits") {
    errors.push("--read-only conflicts with --permission-mode acceptEdits");
  }
  if (
    readOnlyFlag &&
    userSandbox &&
    (userSandbox === "workspace-write" || userSandbox === "danger-full-access")
  ) {
    errors.push(`--read-only conflicts with --sandbox ${userSandbox}`);
  }
  if (readOnlyFlag && userPermission === "bypassPermissions") {
    errors.push("--read-only conflicts with --permission-mode bypassPermissions");
  }

  let permissionMode = userPermission;
  let sandbox = userSandbox;
  let bare = Boolean(options.bare);
  let hermetic = false;

  if (engine === "claude") {
    if (yolo) {
      permissionMode = "bypassPermissions";
      bare = false;
      hermetic = false;
    } else if (!permissionMode) {
      if (!write) {
        // dontAsk + tool allowlist — not plan mode
        permissionMode = "dontAsk";
      } else {
        permissionMode = "acceptEdits";
      }
    }
    // Hermetic RO by default unless --trust-project
    if (!write && !trustProject) {
      hermetic = true;
      bare = options.bare === false ? false : true;
    } else if (trustProject) {
      hermetic = false;
      bare = Boolean(options.bare);
    } else {
      // rescue write
      bare = Boolean(options.bare);
      hermetic = false;
    }
    if (options.bare === true) bare = true;
  }

  if (engine === "codex") {
    if (yolo) {
      sandbox = "danger-full-access";
    } else if (!sandbox) {
      sandbox = write ? "workspace-write" : "read-only";
    }
  }

  const approval = userApproval || "never";

  // Map bare for codex
  const ignoreUserConfig = engine === "codex" && bare;

  return {
    write,
    hermetic,
    permissionMode,
    sandbox,
    approval,
    yolo,
    bare,
    ignoreUserConfig,
    trustProject,
    errors
  };
}
