/**
 * Parse Claude Code --output-format stream-json NDJSON lines into progress events.
 */
import fs from "node:fs";

function shorten(text, limit = 120) {
  const s = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "";
  return s.length <= limit ? s : `${s.slice(0, limit - 1)}…`;
}

function toolNameFromBlock(block) {
  if (!block || typeof block !== "object") return null;
  if (block.type === "tool_use" || block.type === "toolUse" || block.name) {
    return block.name || block.tool_name || null;
  }
  return null;
}

function summarizeToolInput(input) {
  if (input == null) return "";
  if (typeof input === "string") return shorten(input, 80);
  if (typeof input !== "object") return shorten(String(input), 80);
  const prefer = ["file_path", "path", "pattern", "command", "query", "url", "glob"];
  for (const key of prefer) {
    if (input[key] != null) {
      return `${key}=${shorten(String(input[key]), 60)}`;
    }
  }
  try {
    return shorten(JSON.stringify(input), 80);
  } catch {
    return "";
  }
}

/**
 * @param {unknown} obj
 * @returns {{ phase: string, message: string, kind: string, isResult?: boolean, resultText?: string, sessionId?: string|null, isError?: boolean } | null}
 */
export function describeStreamEvent(obj) {
  if (!obj || typeof obj !== "object") {
    return null;
  }

  const type = obj.type || obj.event || obj.kind;
  const subtype = obj.subtype || obj.event_type;

  if (type === "result" || subtype === "success" || subtype === "error_max_turns") {
    const isError = Boolean(obj.is_error) || subtype === "error_max_turns";
    let resultText = "";
    if (typeof obj.result === "string") {
      resultText = obj.result;
    } else if (Array.isArray(obj.errors) && obj.errors.length) {
      resultText = obj.errors.join("; ");
    } else if (isError) {
      resultText = `Claude stopped (${subtype || "error"})`;
    }
    return {
      phase: isError ? "failed" : "completed",
      message: isError
        ? `result error: ${shorten(resultText || subtype || "failed", 100)}`
        : "result received",
      kind: "result",
      isResult: true,
      resultText,
      sessionId: obj.session_id ?? null,
      isError
    };
  }

  // Claude emits many type:"system" lines during a run (status, keepalives, etc.).
  // Only the real session open is useful as "init" — never map every system line to that.
  if (type === "system") {
    if (subtype === "init") {
      const model = obj.model || obj.model_id || "";
      return {
        phase: "starting",
        message: model ? `session opened model=${model}` : "session opened",
        kind: "system_init",
        sessionId: obj.session_id ?? null
      };
    }
    if (subtype === "api_retry") {
      return {
        phase: "retry",
        message: shorten(obj.error || obj.message || "api retry", 100),
        kind: "system"
      };
    }
    // Drop other system noise from the progress log.
    return null;
  }

  // Prefer explicit assistant/user types — do NOT match any object with a .message field
  // (many stream frames include message metadata and were misclassified).
  if (type === "assistant") {
    const msg = obj.message || obj;
    const content = msg.content || obj.content || [];
    const blocks = Array.isArray(content) ? content : [];
    // Priority: tools (action) > thinking > writing (same idea as task log UX)
    let thinkingEv = null;
    let textEv = null;
    const toolParts = [];
    for (const block of blocks) {
      if (!block || typeof block !== "object") continue;
      if (block.type === "tool_use" || block.type === "toolUse") {
        const name = toolNameFromBlock(block) || "tool";
        const detail = summarizeToolInput(block.input || block.arguments);
        toolParts.push(detail ? `${name} ${detail}` : name);
        continue;
      }
      if (
        (block.type === "thinking" || block.type === "redacted_thinking") &&
        !thinkingEv
      ) {
        // redacted_thinking often has no text — still show that thinking ran
        const body =
          block.thinking ||
          block.text ||
          block.content ||
          (block.type === "redacted_thinking" ? "(redacted thinking)" : "");
        if (body || block.type === "redacted_thinking") {
          thinkingEv = {
            phase: "thinking",
            message: shorten(body || "(thinking…)", 140),
            kind: "thinking"
          };
        }
      }
      if (block.type === "text" && block.text && !textEv) {
        textEv = {
          phase: "writing",
          message: shorten(block.text, 100),
          kind: "text"
        };
      }
    }
    if (toolParts.length) {
      return {
        phase: "tool",
        message: toolParts.join(" | "),
        kind: "tool_use"
      };
    }
    return thinkingEv || textEv;
  }

  if (type === "content_block_start" || subtype === "content_block_start") {
    const block = obj.content_block || obj.block || obj.content;
    const name = toolNameFromBlock(block);
    if (name) {
      return {
        phase: "tool",
        message: `tool start ${name}`,
        kind: "tool_use"
      };
    }
    if (block?.type === "thinking" || block?.type === "redacted_thinking") {
      return {
        phase: "thinking",
        message: "thinking…",
        kind: "thinking"
      };
    }
  }

  // Tool results are very frequent and low-signal for a progress UI; only log errors.
  if (type === "user" || type === "tool_result" || subtype === "tool_result") {
    const content = obj.message?.content || obj.content || [];
    const blocks = Array.isArray(content) ? content : [obj];
    for (const block of blocks) {
      if (block?.type === "tool_result" || type === "tool_result") {
        if (!block.is_error) {
          return null;
        }
        return {
          phase: "tool",
          message: `tool error ${String(block.tool_use_id || "").slice(0, 12)}`,
          kind: "tool_result"
        };
      }
    }
    return null;
  }

  if (type === "stream_event") {
    const ev = obj.event || {};
    if (ev.type === "content_block_start") {
      const name = toolNameFromBlock(ev.content_block);
      if (name) {
        return {
          phase: "tool",
          message: `tool start ${name}`,
          kind: "tool_use"
        };
      }
      const bt = ev.content_block?.type;
      if (bt === "thinking" || bt === "redacted_thinking") {
        return {
          phase: "thinking",
          message: "thinking…",
          kind: "thinking"
        };
      }
    }
    // Partial thinking deltas (only present with --include-partial-messages)
    if (ev.type === "content_block_delta") {
      const d = ev.delta || {};
      if (d.type === "thinking_delta" && d.thinking) {
        return {
          phase: "thinking",
          message: shorten(d.thinking, 100),
          kind: "thinking"
        };
      }
    }
    return null;
  }

  if (type === "progress" || type === "status") {
    return {
      phase: obj.phase || "running",
      message: shorten(obj.message || obj.status || "progress"),
      kind: "progress"
    };
  }

  return null;
}

export function parseStreamLine(line) {
  const trimmed = String(line ?? "").trim();
  if (!trimmed || !trimmed.startsWith("{")) {
    return null;
  }
  try {
    return describeStreamEvent(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

export function readLogTail(logFile, maxLines = 40) {
  if (!logFile) {
    return [];
  }
  try {
    if (!fs.existsSync(logFile)) {
      return [];
    }
    const text = fs.readFileSync(logFile, "utf8");
    return text
      .split(/\r?\n/)
      .map((l) => l.trimEnd())
      .filter(Boolean)
      .slice(-maxLines);
  } catch {
    return [];
  }
}
