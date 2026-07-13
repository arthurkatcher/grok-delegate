import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveExecutionMode } from "../../scripts/lib/execution.mjs";

describe("resolveExecutionMode", () => {
  it("defaults to wait", () => {
    assert.equal(resolveExecutionMode({}).background, false);
  });

  it("honors --background", () => {
    assert.equal(resolveExecutionMode({ background: true }).background, true);
  });
});
