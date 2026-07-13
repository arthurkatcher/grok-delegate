/**
 * Safety policy: read-only authority, write mode, effective sandbox/permission.
 */

const ACTIONS = new Set(["setup", "overview", "review", "adversarial", "rescue"]);

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
