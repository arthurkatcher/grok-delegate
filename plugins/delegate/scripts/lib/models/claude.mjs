import { listClaudeModelsFromCli, resolveModelAgainstCatalog, resolveEffortAgainstCatalog } from "./discover.mjs";

export function claudeBin() {
  return process.env.CLAUDE_BIN?.trim() || "claude";
}

export function getClaudeCatalog(env = process.env) {
  return listClaudeModelsFromCli(claudeBin(), env);
}

export function resolveClaudeModel(userModel, catalog) {
  return resolveModelAgainstCatalog(userModel, catalog, {
    softDefault: catalog.defaultModel || null
  });
}

export function resolveClaudeEffort(userEffort, catalog, modelSlug) {
  return resolveEffortAgainstCatalog(userEffort, catalog, modelSlug);
}
