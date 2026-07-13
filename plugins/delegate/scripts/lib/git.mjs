import { runCommand, formatCommandFailure } from "./process.mjs";

function git(cwd, args, options = {}) {
  return runCommand("git", args, { cwd, ...options, shell: false });
}

function gitChecked(cwd, args, options = {}) {
  const result = git(cwd, args, options);
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(formatCommandFailure(result));
  }
  return result;
}

export function ensureGitRepository(cwd) {
  const result = git(cwd, ["rev-parse", "--show-toplevel"]);
  const errorCode = result.error && "code" in result.error ? result.error.code : null;
  if (errorCode === "ENOENT") {
    throw new Error("git is not installed. Install Git and retry.");
  }
  if (result.status !== 0) {
    throw new Error("This command must run inside a Git repository.");
  }
  return result.stdout.trim();
}

export function getWorkingTreeSummary(cwd) {
  ensureGitRepository(cwd);
  const status = gitChecked(cwd, ["status", "--porcelain"]).stdout;
  const files = status
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => line.slice(3).trim());
  const shortstat = git(cwd, ["diff", "--stat", "HEAD"]).stdout.trim();
  const diff = git(cwd, ["diff", "HEAD", "--", "."], { maxBuffer: 512 * 1024 }).stdout;
  const untrackedNames = files.filter((f) => {
    // crude: status porcelain "?? file"
    return status.split("\n").some((line) => line.startsWith("??") && line.includes(f));
  });
  return {
    dirty: files.length > 0,
    files,
    untrackedNames,
    shortstat: shortstat || null,
    diff: diff.slice(0, 200_000),
    statusPorcelain: status
  };
}

export function getBranchDiffSummary(cwd, baseRef = "main") {
  ensureGitRepository(cwd);
  // resolve base
  let base = baseRef;
  const hasBase = git(cwd, ["rev-parse", "--verify", base]);
  if (hasBase.status !== 0) {
    const master = git(cwd, ["rev-parse", "--verify", "master"]);
    if (master.status === 0) {
      base = "master";
    } else {
      throw new Error(`Base ref not found: ${baseRef}`);
    }
  }
  const mergeBase = gitChecked(cwd, ["merge-base", "HEAD", base]).stdout.trim();
  const shortstat = git(cwd, ["diff", "--stat", `${mergeBase}...HEAD`]).stdout.trim();
  const diff = git(cwd, ["diff", `${mergeBase}...HEAD`], { maxBuffer: 512 * 1024 }).stdout;
  const nameOnly = gitChecked(cwd, ["diff", "--name-only", `${mergeBase}...HEAD`])
    .stdout.split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    base,
    mergeBase,
    dirty: nameOnly.length > 0,
    files: nameOnly,
    shortstat: shortstat || null,
    diff: diff.slice(0, 200_000)
  };
}

/**
 * @param {string} cwd
 * @param {{ scope?: "auto"|"working-tree"|"branch", base?: string }} options
 */
export function resolveReviewContext(cwd, options = {}) {
  ensureGitRepository(cwd);
  const scopeOpt = options.scope || "auto";
  const base = options.base || "main";

  if (scopeOpt === "branch") {
    const branch = getBranchDiffSummary(cwd, base);
    return {
      scope: "branch",
      base: branch.base,
      summary: `branch vs ${branch.base} (${branch.files.length} files)`,
      files: branch.files,
      shortstat: branch.shortstat,
      diffExcerpt: branch.diff || branch.shortstat || "(no diff)",
      dirty: branch.dirty
    };
  }

  if (scopeOpt === "working-tree") {
    const wt = getWorkingTreeSummary(cwd);
    return {
      scope: "working-tree",
      base: null,
      summary: `working tree (${wt.files.length} changed paths)`,
      files: wt.files,
      shortstat: wt.shortstat,
      diffExcerpt: wt.diff || wt.shortstat || wt.statusPorcelain || "(clean)",
      dirty: wt.dirty
    };
  }

  // auto
  const wt = getWorkingTreeSummary(cwd);
  if (wt.dirty) {
    return {
      scope: "working-tree",
      base: null,
      summary: `working tree (${wt.files.length} changed paths)`,
      files: wt.files,
      shortstat: wt.shortstat,
      diffExcerpt: wt.diff || wt.shortstat || wt.statusPorcelain || "(dirty)",
      dirty: true
    };
  }

  try {
    const branch = getBranchDiffSummary(cwd, base);
    if (branch.dirty) {
      return {
        scope: "branch",
        base: branch.base,
        summary: `branch vs ${branch.base} (${branch.files.length} files)`,
        files: branch.files,
        shortstat: branch.shortstat,
        diffExcerpt: branch.diff || branch.shortstat || "(no diff)",
        dirty: true
      };
    }
  } catch {
    /* fall through */
  }

  return {
    scope: "working-tree",
    base: null,
    summary: "working tree (clean) — review recent repo state",
    files: [],
    shortstat: null,
    diffExcerpt: "(no uncommitted or branch diff detected)",
    dirty: false
  };
}
