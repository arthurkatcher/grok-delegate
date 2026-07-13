import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseEffortLevelsFromHelp,
  parseModelHintsFromHelp,
  parseSandboxModesFromHelp,
  resolveModelAgainstCatalog,
  resolveEffortAgainstCatalog,
  isPlausibleClaudeModelId,
  parseClaudeModelIdsFromText
} from "../../scripts/lib/models/discover.mjs";
import { describeCodexStreamEvent } from "../../scripts/lib/engines/codex.mjs";
import { buildCodexArgs } from "../../scripts/lib/engines/codex.mjs";
import { buildClaudeArgs } from "../../scripts/lib/engines/claude.mjs";
import { describeStreamEvent } from "../../scripts/lib/stream.mjs";

describe("parseEffortLevelsFromHelp", () => {
  it("extracts efforts from claude-style help", () => {
    const help =
      "  --effort <level>  Effort level for the current session (low, medium, high, xhigh, max)";
    const levels = parseEffortLevelsFromHelp(help);
    assert.ok(levels.includes("low"));
    assert.ok(levels.includes("xhigh"));
    assert.ok(levels.includes("max"));
  });
});

describe("parseModelHintsFromHelp", () => {
  it("extracts quoted aliases", () => {
    const help = "Provide an alias (e.g. 'fable', 'opus', or 'sonnet') or 'claude-fable-5'";
    const hints = parseModelHintsFromHelp(help);
    assert.ok(hints.includes("fable") || hints.includes("claude-fable-5"));
  });
});

describe("parseSandboxModesFromHelp", () => {
  it("finds codex sandbox modes", () => {
    const help = "possible values: read-only, workspace-write, danger-full-access";
    const modes = parseSandboxModesFromHelp(help);
    assert.deepEqual(modes, ["read-only", "workspace-write", "danger-full-access"]);
  });
});

describe("resolveModelAgainstCatalog", () => {
  const catalog = {
    models: [
      { slug: "gpt-5.6-sol", displayName: "Sol", efforts: ["low", "high", "max"], priority: 1 },
      { slug: "gpt-5.6-terra", displayName: "Terra", efforts: ["low", "medium"], priority: 2 },
      { slug: "gpt-5.5", displayName: "GPT-5.5", efforts: ["low", "xhigh"], priority: 3 }
    ]
  };

  it("resolves sol alias", () => {
    assert.equal(resolveModelAgainstCatalog("sol", catalog), "gpt-5.6-sol");
  });

  it("pass-through unknown", () => {
    assert.equal(resolveModelAgainstCatalog("my-custom-model", catalog), "my-custom-model");
  });

  it("empty returns null so engine default applies", () => {
    assert.equal(resolveModelAgainstCatalog("", catalog), null);
  });
});

describe("resolveEffortAgainstCatalog", () => {
  it("accepts listed effort", () => {
    const catalog = {
      models: [{ slug: "m", efforts: ["low", "high"] }],
      effortsGlobal: ["low", "high"]
    };
    const r = resolveEffortAgainstCatalog("high", catalog, "m");
    assert.equal(r.effort, "high");
    assert.equal(r.warning, null);
  });

  it("pass-through with warning when not listed", () => {
    const catalog = {
      models: [{ slug: "m", efforts: ["low"] }],
      effortsGlobal: ["low"]
    };
    const r = resolveEffortAgainstCatalog("ultra", catalog, "m");
    assert.equal(r.effort, "ultra");
    assert.ok(r.warning);
  });
});

describe("describeCodexStreamEvent", () => {
  it("maps command execution", () => {
    const ev = describeCodexStreamEvent({
      type: "item.started",
      item: { type: "command_execution", command: "ls -la" }
    });
    assert.equal(ev.kind, "tool_use");
    assert.match(ev.message, /Bash/);
  });

  it("maps reasoning items to thinking phase", () => {
    const ev = describeCodexStreamEvent({
      type: "item.completed",
      item: {
        type: "reasoning",
        text: "I should inspect the companion streaming path next."
      }
    });
    assert.equal(ev.phase, "thinking");
    assert.equal(ev.kind, "thinking");
    assert.match(ev.message, /companion streaming/);
  });
});

describe("describeStreamEvent thinking", () => {
  it("maps thinking content blocks", () => {
    const ev = describeStreamEvent({
      type: "assistant",
      message: {
        content: [
          {
            type: "thinking",
            thinking: "Need to check sandbox defaults carefully."
          }
        ]
      }
    });
    assert.equal(ev.phase, "thinking");
    assert.equal(ev.kind, "thinking");
    assert.match(ev.message, /sandbox defaults/);
  });

  it("maps redacted_thinking", () => {
    const ev = describeStreamEvent({
      type: "assistant",
      message: { content: [{ type: "redacted_thinking" }] }
    });
    assert.equal(ev.phase, "thinking");
    assert.match(ev.message, /redacted|thinking/i);
  });

  it("prefers tool over thinking in same message", () => {
    const ev = describeStreamEvent({
      type: "assistant",
      message: {
        content: [
          { type: "thinking", thinking: "hmm" },
          { type: "tool_use", name: "Read", input: { file_path: "/x" } }
        ]
      }
    });
    assert.equal(ev.phase, "tool");
  });
});

describe("buildCodexArgs sandbox user control", () => {
  it("honors explicit --sandbox and config approval_policy", () => {
    const args = buildCodexArgs({
      action: "rescue",
      prompt: "hi",
      sandbox: "danger-full-access",
      approval: "never"
    });
    assert.ok(args.includes("danger-full-access"));
    assert.ok(args.includes("approval_policy=never"));
    assert.ok(!args.includes("--ask-for-approval"));
  });

  it("soft-defaults overview to read-only when sandbox omitted", () => {
    const args = buildCodexArgs({
      action: "overview",
      prompt: "hi",
      approval: "never"
    });
    const i = args.indexOf("--sandbox");
    assert.notEqual(i, -1);
    assert.equal(args[i + 1], "read-only");
  });
});

describe("buildClaudeArgs permission user control", () => {
  it("honors explicit permission-mode", () => {
    const args = buildClaudeArgs({
      action: "rescue",
      prompt: "hi",
      permissionMode: "auto",
      write: true
    });
    const i = args.indexOf("--permission-mode");
    assert.equal(args[i + 1], "auto");
  });
});

describe("isPlausibleClaudeModelId", () => {
  it("accepts real ids", () => {
    assert.equal(isPlausibleClaudeModelId("claude-opus-4-8"), true);
    assert.equal(isPlausibleClaudeModelId("claude-fable-5"), true);
    assert.equal(isPlausibleClaudeModelId("claude-sonnet-5"), true);
  });
  it("rejects junk from binary scan", () => {
    assert.equal(isPlausibleClaudeModelId("claude-fable-"), false);
    assert.equal(isPlausibleClaudeModelId("claude-fable-5.md"), false);
    assert.equal(isPlausibleClaudeModelId("claude-fable-5-mythos-5"), false);
  });
});

describe("parseClaudeModelIdsFromText", () => {
  it("extracts ids from markdown table", () => {
    const text = `
| Claude Fable 5 | \`claude-fable-5\` | 1M |
| Claude Opus 4.8 | \`claude-opus-4-8\` | 1M |
`;
    const ids = parseClaudeModelIdsFromText(text);
    assert.ok(ids.includes("claude-fable-5"));
    assert.ok(ids.includes("claude-opus-4-8"));
  });
});
