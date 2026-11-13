import assert from "node:assert/strict";
import { test } from "node:test";
import * as logic from "../dt.mjs";
import { laneOptions } from "../extensions/dt-session/lane-picker.mjs";

test("normalization drops lane numbers and migrates legacy worktree paths", () => {
  const raw = { tickets: {
    "01": { lane: "lane 2", claim: { owner: "other", checkout: "/lane2" }, verification: "passed" },
    "02": { lane: "/repo.lane-02", branch: "ticket/f-02" },
    "03": { lane: "/old", worktree: "/new" },
  } };
  const before = structuredClone(raw);
  const prog = logic.normalizeProgress(raw);
  assert.equal(prog.tickets["01"].lane, undefined);
  assert.equal(prog.tickets["01"].worktree, undefined);
  assert.deepEqual(prog.tickets["01"].claim, raw.tickets["01"].claim);
  assert.equal(prog.tickets["02"].worktree, "/repo.lane-02");
  assert.equal(prog.tickets["03"].worktree, "/new");
  assert.equal(prog.tickets["03"].lane, undefined);
  assert.deepEqual(raw, before);
  assert.deepEqual(logic.normalizeProgress(prog), prog);
});

test("unclaimed tickets are not locked by legacy lanes; worktrees and claims still lock", () => {
  const tickets = [{ id: "01", title: "Ticket", touches: [], blocked_by: [], unsafe_with: [] }];
  const prog = logic.normalizeProgress({ gates: { G1: { state: "approved" }, G2: { state: "approved" } }, tickets: { "01": { status: "in_progress" } } });
  // Also tolerate unmigrated snapshots from older callers.
  prog.tickets["01"].lane = "lane 2";
  const snapshot = { tickets, prog, st: logic.deriveStatuses(tickets, prog) };
  const repo = { root: "/repo", branch: "main" };
  assert.equal(laneOptions(snapshot, repo, "here", logic)[0].state, "resume");
  prog.tickets["01"].worktree = "/repo.lane-01";
  assert.equal(laneOptions(snapshot, repo, "here", logic)[0].state, "locked");
  delete prog.tickets["01"].worktree;
  prog.tickets["01"].claim = { owner: "other", checkout: "/repo" };
  assert.equal(laneOptions(snapshot, repo, "here", logic)[0].state, "locked");
});
