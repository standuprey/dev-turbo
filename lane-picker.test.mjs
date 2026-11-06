import assert from "node:assert/strict";
import { test } from "node:test";
import * as logic from "./dt.mjs";
import { laneOptions, chooseLane } from "./extensions/dt-session/lane-picker.mjs";

const repo = { root: "/lane1", lanes: ["/lane1", "/lane2"], branch: "main" };
const project = { slug: "demo" };
const tickets = ["00", "01", "02", "03", "04"].map((id) => ({ id, title: `Ticket ${id}`, touches: [id], blocked_by: id === "03" ? ["01"] : [], unsafe_with: [] }));
function fixture() {
  const prog = logic.normalizeProgress({ gates: { G1: { state: "approved" }, G2: { state: "approved" } }, tickets: {
    "00": { status: "done" },
    "01": { status: "in_progress", lane: "lane 2", claim: { owner: "other", checkout: "/lane2" } },
  } });
  const snapshot = { prog, tickets, st: logic.deriveStatuses(tickets, prog) };
  return { snapshot, repo };
}

test("picker orders available tickets first and labels locked/blocked tickets without mutating state", () => {
  const { snapshot } = fixture(), before = JSON.stringify(snapshot);
  const options = laneOptions(snapshot, repo, "here", logic);
  assert.deepEqual(options.map((o) => o.id), ["02", "04", "01", "03"]);
  assert.equal(options[0].selectable, true);
  assert.match(options[2].label, /LOCKED.*other.*lane 2/);
  assert.equal(options[2].selectable, false);
  assert.match(options[3].label, /BLOCKED.*blocked by 01/);
  assert.equal(JSON.stringify(snapshot), before);
});

test("legacy lane assignments stay locked and own claims can resume", () => {
  const f = fixture();
  delete f.snapshot.prog.tickets["01"].claim;
  assert.match(laneOptions(f.snapshot, repo, "here", logic).find((o) => o.id === "01").label, /LOCKED.*lane 2/);
  f.snapshot.prog.tickets["01"].claim = { owner: "here", checkout: "/lane1" };
  const option = laneOptions(f.snapshot, repo, "here", logic).find((o) => o.id === "01");
  assert.equal(option.state, "resume");
  assert.equal(option.selectable, true);
});

test("picker respects gates, resource limits, saved blockers and current branch", () => {
  const f = fixture();
  f.snapshot.prog.gates.G2.state = "pending";
  assert.equal(laneOptions(f.snapshot, repo, "here", logic).find((o) => o.id === "02").selectable, false);
  f.snapshot.prog.gates.G2.state = "approved";
  f.snapshot.prog.tickets["02"] = { status: "review" };
  f.snapshot.st = logic.deriveStatuses(tickets, f.snapshot.prog);
  assert.match(laneOptions(f.snapshot, repo, "here", logic).find((o) => o.id === "04").label, /BLOCKED.*in flight/);
  const g = fixture();
  g.snapshot.prog.tickets["04"] = { blockers: ["Human input"] };
  assert.match(laneOptions(g.snapshot, repo, "here", logic).find((o) => o.id === "04").label, /Human input/);
});

test("selecting a ready ticket returns its ID; cancel, locked selection and non-UI never start work", async () => {
  let selection = "ready", calls = 0;
  const notices = [];
  const ctx = { hasUI: true, sessionManager: { getSessionId: () => "here" }, ui: {
    notify: (message) => notices.push(message),
    select: async (title, labels) => {
      calls++;
      assert.equal(title, "Choose a ticket · demo");
      return selection === "cancel" ? undefined : labels.find((l) => l.includes(selection === "ready" ? "READY" : "LOCKED"));
    },
  } };
  const args = { project, ctx, loadSnapshot: async () => fixture(), logic };
  assert.equal(await chooseLane(args), "02");
  selection = "cancel";
  assert.equal(await chooseLane(args), null);
  selection = "locked";
  assert.equal(await chooseLane(args), null);
  assert.match(notices.at(-1), /LOCKED.*\/dt-lane 01 force/);
  ctx.hasUI = false;
  assert.equal(await chooseLane({ ...args, loadSnapshot() { throw new Error("must not load"); } }), null);
  assert.equal(calls, 3);
  assert.match(notices.at(-1), /non-interactive.*\/dt-lane <id>/);
});
