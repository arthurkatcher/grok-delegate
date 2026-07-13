/**
 * Fail-closed argv parsing.
 * - Unknown flags throw (never become positionals).
 * - `--` ends flag parsing; remainder is free text.
 * - First non-option positional also ends flag parsing (safe for "review focus --yolo").
 */

export function parseArgs(argv, config = {}) {
  const valueOptions = new Set(config.valueOptions ?? []);
  const booleanOptions = new Set(config.booleanOptions ?? []);
  const aliasMap = config.aliasMap ?? {};
  const strictUnknown = config.strictUnknown !== false;
  const stopAtFirstPositional = config.stopAtFirstPositional !== false;
  const options = {};
  const positionals = [];
  let passthrough = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (passthrough) {
      positionals.push(token);
      continue;
    }

    if (token === "--") {
      passthrough = true;
      continue;
    }

    if (!token.startsWith("-") || token === "-") {
      positionals.push(token);
      if (stopAtFirstPositional) {
        passthrough = true;
      }
      continue;
    }

    if (token.startsWith("--")) {
      const [rawKey, inlineValue] = token.slice(2).split("=", 2);
      const key = aliasMap[rawKey] ?? rawKey;

      if (booleanOptions.has(key)) {
        options[key] = inlineValue === undefined ? true : inlineValue !== "false";
        continue;
      }

      if (valueOptions.has(key)) {
        const nextValue = inlineValue ?? argv[index + 1];
        if (nextValue === undefined || (inlineValue === undefined && nextValue.startsWith("-") && nextValue !== "-")) {
          throw new Error(`Missing value for --${rawKey}`);
        }
        options[key] = nextValue;
        if (inlineValue === undefined) {
          index += 1;
        }
        continue;
      }

      if (strictUnknown) {
        throw new Error(
          `Unknown option --${rawKey}. Use -- before free-text focus so it is not parsed as flags.`
        );
      }
      positionals.push(token);
      continue;
    }

    const shortKey = token.slice(1);
    const key = aliasMap[shortKey] ?? shortKey;

    if (booleanOptions.has(key)) {
      options[key] = true;
      continue;
    }

    if (valueOptions.has(key)) {
      const nextValue = argv[index + 1];
      if (nextValue === undefined) {
        throw new Error(`Missing value for -${shortKey}`);
      }
      options[key] = nextValue;
      index += 1;
      continue;
    }

    if (strictUnknown) {
      throw new Error(`Unknown option -${shortKey}`);
    }
    positionals.push(token);
  }

  return { options, positionals };
}

export function splitRawArgumentString(raw) {
  const tokens = [];
  let current = "";
  let quote = null;
  let escaping = false;

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }
    if (ch === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }

  if (current) {
    tokens.push(current);
  }
  return tokens;
}

/** Shared option names both engines understand. */
export const SHARED_VALUE_OPTIONS = [
  "cwd",
  "model",
  "effort",
  "max-turns",
  "resume",
  "payload-file"
];

export const SHARED_BOOLEAN_OPTIONS = [
  "json",
  "wait",
  "read-only",
  "write",
  "yolo",
  "bare",
  "trust-project",
  "stream-partial",
  "persist-result",
  "skip-git-check",
  "skip-git-repo-check"
];

export const CLAUDE_VALUE_OPTIONS = [
  ...SHARED_VALUE_OPTIONS,
  "permission-mode",
  "allowed-tools",
  "disallowed-tools"
];

export const CLAUDE_BOOLEAN_OPTIONS = [...SHARED_BOOLEAN_OPTIONS];

export const CODEX_VALUE_OPTIONS = [...SHARED_VALUE_OPTIONS, "sandbox", "approval"];

export const CODEX_BOOLEAN_OPTIONS = [
  ...SHARED_BOOLEAN_OPTIONS,
  "search",
  "ephemeral"
];
