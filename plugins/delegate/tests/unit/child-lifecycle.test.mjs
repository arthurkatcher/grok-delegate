import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { describe, it } from "node:test";
import {
  engineSpawnOptions,
  trackEngineChild,
  killEngineChild,
  activeEngineChildCount
} from "../../scripts/lib/child-lifecycle.mjs";

describe("child-lifecycle", () => {
  it("tracks and kills a long-running child", async () => {
    const before = activeEngineChildCount();
    const child = trackEngineChild(
      spawn(
        process.execPath,
        ["-e", "setInterval(() => {}, 1000)"],
        engineSpawnOptions()
      )
    );
    assert.ok(child.pid);
    assert.equal(activeEngineChildCount(), before + 1);

    await new Promise((r) => setTimeout(r, 50));
    killEngineChild(child, "SIGTERM");

    const code = await new Promise((resolve) => {
      child.once("close", (c, signal) => resolve({ c, signal }));
    });
    assert.ok(code.signal === "SIGTERM" || code.c !== 0 || code.c === null);
    // allow exit handler to drop from set
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(activeEngineChildCount(), before);
  });
});
