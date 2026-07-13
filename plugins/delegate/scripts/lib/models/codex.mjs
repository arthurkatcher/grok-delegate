import { listCodexModelsFromCli, resolveModelAgainstCatalog, resolveEffortAgainstCatalog } from "./discover.mjs";
import { runCommand } from "../process.mjs";

export const CODEX_MIN_VERSION_FOR_56 = "0.144.0";

export function codexBin() {
  return process.env.CODEX_BIN?.trim() || "codex";
}

export function getCodexVersion(env = process.env) {
  const r = runCommand(codexBin(), ["--version"], { env, timeout: 10_000 });
  const text = `${r.stdout || ""} ${r.stderr || ""}`;
  const m = text.match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : null;
}

export function compareSemver(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
  }
  return 0;
}

export function getCodexCatalog(env = process.env) {
  return listCodexModelsFromCli(codexBin(), env);
}

export function resolveCodexModel(userModel, catalog) {
  // No hardcoded flagship — prefer catalog order (priority) when user omitted model
  return resolveModelAgainstCatalog(userModel, catalog, { softDefault: null });
}

export function resolveCodexEffort(userEffort, catalog, modelSlug) {
  return resolveEffortAgainstCatalog(userEffort, catalog, modelSlug);
}
