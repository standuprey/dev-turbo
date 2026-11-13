import assert from "node:assert/strict";
import { test } from "node:test";
import { parseExecJson } from "../extensions/dt-session/exec-json.mjs";

const ok = { code: 0, killed: false, truncated: false, stdout: '{"warnings":[]}', stderr: "" };
test("complete JSON is accepted", () => {
  assert.deepEqual(parseExecJson(ok, "Preflight"), { warnings: [] });
});
for (const [name, patch, message] of [
  ["signal exit reported as success", { code: 0, killed: true, stdout: "" }, /interrupted or timed out/],
  ["interrupted complete output", { killed: true }, /interrupted or timed out/],
  ["truncation reported as success", { truncated: true }, /truncated/],
  ["nonzero exit", { code: 1, stderr: "dt: invalid plan" }, /exit 1.*\n.*invalid plan/],
  ["empty output", { stdout: " \n" }, /returned no JSON/],
  ["partial output", { stdout: '{"warnings":' }, /invalid or incomplete JSON/],
]) {
  test(name, () => assert.throws(() => parseExecJson({ ...ok, ...patch }, "Preflight"), message));
}
