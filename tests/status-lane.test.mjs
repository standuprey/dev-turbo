import assert from "node:assert/strict";
import { test } from "node:test";
import { currentLaneTicket, branchTicket } from "../extensions/dt-status/status.mjs";

const project = { slug: "demo", tier: "T2" };
const snapshot = (tickets = {}) => ({ tickets: ["00", "01", "02"].map(id => ({ id })), prog: { tickets } });

test("branch targets match saved branches exactly, reject ambiguity and never change progress", () => {
  const saved = snapshot({ "00": { branch: "quick/demo", status: "done" }, "01": { branch: "custom-review", status: "review" } });
  const before = structuredClone(saved);
  assert.equal(branchTicket(saved, "quick/demo"), "00");
  assert.equal(branchTicket(saved, "custom-review"), "01");
  for (const branch of ["custom", "Custom-review", "other/project", "ticket/demo-02", "../00"]) assert.throws(() => branchTicket(saved, branch), /No ticket saved for branch/);
  assert.deepEqual(saved, before);
  saved.prog.tickets["02"] = { branch: "custom-review" };
  assert.throws(() => branchTicket(saved, "custom-review"), /Multiple tickets.*Use \/dt-status <id>/);
});

test("current lane resolves saved and standard branches, including completed tickets", () => {
  assert.equal(currentLaneTicket(project, snapshot({ "01": { branch: "custom", status: "done" } }), { branch: "custom" }), "01");
  assert.equal(currentLaneTicket(project, snapshot(), { branch: "ticket/demo-02" }), "02");
  for (const tier of ["T0", "T1"]) assert.equal(currentLaneTicket({ ...project, tier }, snapshot(), { branch: "quick/demo" }), "00");
  assert.throws(() => currentLaneTicket(project, snapshot(), { branch: "quick/demo" }), /No ticket found/);
  assert.equal(currentLaneTicket({ ...project, tier: "T0" }, snapshot(), { root: "/repo", branch: "main" }), "00");
  assert.throws(() => currentLaneTicket({ ...project, tier: "T1" }, snapshot(), { root: "/repo", branch: "main" }), /No ticket found/);
  assert.throws(() => currentLaneTicket(project, snapshot(), { branch: "ticket/other-02" }), /No ticket found/);
});

test("current lane uses checkout metadata when detached and prefers its branch", () => {
  const saved = snapshot({ "01": { worktree: "/repo/lane" }, "02": { claim: { checkout: "/repo/other", owner: "other" } } });
  assert.equal(currentLaneTicket(project, saved, { root: "/repo/lane/sub/..", branch: "" }), "01");
  assert.equal(currentLaneTicket(project, saved, { root: "/repo/other", branch: "" }), "02");
  assert.equal(currentLaneTicket(project, saved, { root: "/repo/lane", branch: "ticket/demo-02" }), "02");
  assert.throws(() => currentLaneTicket(project, saved, { root: "/repo/main", branch: "main" }), /No ticket found/);
});

test("current lane rejects ambiguous matches and never changes saved progress", () => {
  const saved = snapshot({ "01": { worktree: "/repo/lane", branch: "custom" }, "02": { worktree: "/repo/lane", branch: "custom" } });
  const before = structuredClone(saved);
  assert.throws(() => currentLaneTicket(project, saved, { branch: "custom" }), /Multiple tickets/);
  assert.throws(() => currentLaneTicket(project, saved, { root: "/repo/lane", branch: "" }), /Multiple tickets/);
  assert.deepEqual(saved, before);
});
