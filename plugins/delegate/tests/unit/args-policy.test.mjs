import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseArgs } from "../../scripts/lib/args.mjs";
import { resolvePolicy, isValidAction } from "../../scripts/lib/policy.mjs";
import { buildClaudeArgs } from "../../scripts/lib/engines/claude.mjs";
import { buildCodexArgs } from "../../scripts/lib/engines/codex.mjs";
import { resolveModelAgainstCatalog } from "../../scripts/lib/models/discover.mjs";
import { runCommand } from "../../scripts/lib/process.mjs";

describe("parseArgs fail-closed", () => {
  it("stops flags after first positional so --yolo in focus is text", () => {
    const { options, positionals } = parseArgs(
      ["--model", "opus", "review", "please", "--yolo", "now"],
      {
        valueOptions: ["model"],
        booleanOptions: ["yolo"],
        strictUnknown: true,
        stopAtFirstPositional: true
      }
    );
    assert.equal(options.model, "opus");
    assert.equal(options.yolo, undefined);
    assert.deepEqual(positionals, ["review", "please", "--yolo", "now"]);
  });

  it("honors -- terminator", () => {
    const { options, positionals } = parseArgs(
      ["--model", "x", "--", "rescue", "fix --yolo please"],
      {
        valueOptions: ["model"],
        booleanOptions: ["yolo"],
        strictUnknown: true
      }
    );
    assert.equal(options.yolo, undefined);
    assert.ok(positionals.includes("rescue"));
  });

  it("rejects unknown flags", () => {
    assert.throws(
      () =>
        parseArgs(["--not-a-real-flag"], {
          valueOptions: [],
          booleanOptions: [],
          strictUnknown: true
        }),
      /Unknown option/
    );
  });
});

describe("resolvePolicy", () => {
  it("rejects read-only + yolo", () => {
    const p = resolvePolicy("claude", "rescue", { "read-only": true, yolo: true });
    assert.ok(p.errors.length);
  });

  it("RO overview is hermetic bare by default", () => {
    const p = resolvePolicy("claude", "overview", {});
    assert.equal(p.write, false);
    assert.equal(p.bare, true);
    assert.equal(p.hermetic, true);
    assert.equal(p.permissionMode, "dontAsk");
  });

  it("trust-project disables hermetic bare", () => {
    const p = resolvePolicy("claude", "review", { "trust-project": true });
    assert.equal(p.bare, false);
    assert.equal(p.hermetic, false);
  });
});

describe("buildClaudeArgs isolation", () => {
  it("rescue has no Bash in allowedTools by default", () => {
    const args = buildClaudeArgs({
      action: "rescue",
      prompt: "hi",
      write: true,
      permissionMode: "acceptEdits"
    });
    const i = args.indexOf("--allowedTools");
    assert.notEqual(i, -1);
    assert.equal(args[i + 1], "Read,Edit,Write,Glob,Grep");
    assert.ok(!String(args[i + 1]).includes("Bash"));
    // Bash may appear only as disallowed
    const d = args.indexOf("--disallowedTools");
    if (d !== -1) assert.match(args[d + 1], /Bash/);
  });

  it("RO uses dontAsk not plan", () => {
    const args = buildClaudeArgs({
      action: "review",
      prompt: "hi",
      write: false,
      permissionMode: "dontAsk",
      bare: true
    });
    assert.ok(args.includes("dontAsk"));
    assert.ok(args.includes("--bare"));
    assert.ok(!args.includes("plan"));
  });
});

describe("buildCodexArgs", () => {
  it("puts search before exec", () => {
    const args = buildCodexArgs({
      action: "overview",
      prompt: "hi",
      search: true,
      write: false,
      sandbox: "read-only"
    });
    assert.ok(args.indexOf("--search") < args.indexOf("exec"));
  });

  it("resume uses exec resume", () => {
    const args = buildCodexArgs({
      action: "rescue",
      prompt: "cont",
      write: true,
      resumeSessionId: "abc123"
    });
    assert.ok(args.includes("resume"));
    assert.ok(args.includes("abc123"));
  });
});

describe("resolveModelAgainstCatalog", () => {
  it("returns null when model omitted (engine default)", () => {
    const catalog = { models: [{ slug: "gpt-5.6-sol" }] };
    assert.equal(resolveModelAgainstCatalog("", catalog), null);
    assert.equal(resolveModelAgainstCatalog(null, catalog), null);
  });
});

describe("runCommand fail-closed", () => {
  it("does not report ok on missing binary", () => {
    const r = runCommand("this-binary-definitely-missing-xyz", ["--version"], {
      timeout: 2000
    });
    assert.equal(r.ok, false);
  });
});

describe("isValidAction", () => {
  it("knows actions", () => {
    assert.equal(isValidAction("review"), true);
    assert.equal(isValidAction("overveiw"), false);
  });
});
