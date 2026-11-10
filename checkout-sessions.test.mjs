import assert from "node:assert/strict";
import { test } from "node:test";
import { otherCheckoutSessions } from "./checkout-sessions.mjs";

const inspect = (rows, cwds, extra = {}) => otherCheckoutSessions("/repo", {
  pid: 30, realpath: (p) => p === "/alias" ? "/repo" : p,
  processes: () => rows, cwd: (pid) => cwds[pid], ...extra,
});
const rows = [
  { pid: 10, ppid: 1, command: "pi" },
  { pid: 20, ppid: 10, command: "bash" },
  { pid: 30, ppid: 20, command: "node dt.mjs next f" },
  { pid: 40, ppid: 1, command: "pi" },
];
test("exclude the requesting session, but include other idle pi sessions and path aliases", () => {
  assert.deepEqual(inspect(rows, { 10: "/repo", 40: "/alias" }), [40]);
  assert.deepEqual(inspect(rows, { 10: "/repo", 40: "/other" }), []);
});
test("also recognize Node pi entrypoints and concurrent next commands", () => {
  const peers = ["node /pkg/pi-coding-agent/dist/cli.js", "node /kit/dt.mjs next f --ticket 01"];
  for (const command of peers) assert.deepEqual(inspect([...rows.slice(0, 3), { pid: 40, ppid: 1, command }], { 40: "/repo" }), [40]);
});
test("unknown process inspection fails closed; unrelated programs are ignored", () => {
  assert.throws(() => inspect(rows, {}, { cwd: () => { throw new Error("denied"); } }), /denied/);
  assert.throws(() => inspect(rows, {}, { processes: () => { throw new Error("ps unavailable"); } }), /ps unavailable/);
  assert.deepEqual(inspect([...rows.slice(0, 3), { pid: 40, ppid: 1, command: "node server.js" }], {}), []);
});
