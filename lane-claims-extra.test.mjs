import assert from "node:assert/strict";
import { test } from "node:test";
import * as logic from "./dt.mjs";
import { nextCommands } from "./extensions/dt-session/gates.mjs";

const ticket = (id, touches = [id]) => ({ id, title: id, touches, blocked_by: [], unsafe_with: [] });
test("when no spare ticket fits, status does not recommend joining another build", () => {
  const tickets = [ticket("00"), ticket("01", ["00"])];
  const prog = logic.normalizeProgress({ gates: { G1: { state: "approved" }, G2: { state: "approved" } }, tickets: { "00": { status: "in_progress", next: "/dt-lane 00" } } });
  const snapshot = { prog, tickets, st: logic.deriveStatuses(tickets, prog) };
  assert.deepEqual(nextCommands({ project: { slug: "f", tier: "T2" }, snapshot }, logic), ["/dt-status"]);
  assert.equal(logic.suggestNext({ slug: "f", feature: {}, ...snapshot }), "/dt-status f");
});

test("claims round-trip through compact state and release remains independent of ticket status", () => {
  const claim = { owner: "session", checkout: "/repo", acquired: "2026-11-06T12:00Z" };
  const prog = logic.normalizeProgress({ tickets: { "1": { status: "in_progress", claim } } });
  assert.deepEqual(logic.compactProgress(prog).tickets["01"].claim, claim);
  prog.tickets["01"].claim = null;
  const saved = logic.compactProgress(prog).tickets["01"];
  assert.equal(saved.status, "in_progress");
  assert.equal(saved.claim, undefined);
});
