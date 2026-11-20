import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { deriveStatuses, normalizeProgress, pickReady, ticketStartWarnings } from "../dt.mjs";
import { laneOptions } from "../extensions/dt-session/lane-picker.mjs";

function fixture(dependencies = ["00"], status = "review") {
  const tickets = ["00", "01", "02"].map((id) => ({
    id, title: `Ticket ${id}`, blocked_by: id === "02" ? dependencies : [], touches: [id], unsafe_with: [],
  }));
  const prog = normalizeProgress({ gates: { G2: { state: "approved" } }, tickets: {
    "00": { status }, "01": { status: "done" },
  } });
  return { tickets, prog, st: deriveStatuses(tickets, prog) };
}

test("one unmet dependency in review suggests a stack without making the ticket ready", () => {
  const snapshot = fixture(["00", "01"]), before = JSON.stringify(snapshot);
  assert.match(ticketStartWarnings(snapshot.tickets, snapshot.prog, "02").join("\n"), /blocked by 00.*suggest stacking.*ask before/);
  assert.throws(() => pickReady(snapshot.tickets, snapshot.st, "02"), /suggest stacking/);
  const option = laneOptions(snapshot, { root: "/repo", branch: "main" }, "owner", { pickReady }).find((o) => o.id === "02");
  assert.equal(option.warning, true);
  assert.equal(option.state, "blocked");
  assert.match(option.label, /suggest stacking/);
  assert.equal(JSON.stringify(snapshot), before);
});

test("multiple unmet dependencies or a dependency outside review do not suggest stacking", () => {
  for (const status of ["todo", "in_progress", "done"]) {
    const { tickets, prog } = fixture(["00"], status);
    assert.doesNotMatch(ticketStartWarnings(tickets, prog, "02").join("\n"), /stacking/);
  }
  const snapshot = fixture(["00", "01"]);
  snapshot.prog.tickets["01"].status = "review";
  assert.doesNotMatch(ticketStartWarnings(snapshot.tickets, snapshot.prog, "02").join("\n"), /stacking/);
});

test("stacking requires separate consent and preserves published PRs and other blockers", () => {
  const lane = readFileSync(new URL("../prompts/dt-lane.md", import.meta.url), "utf8");
  assert.match(lane, /At startup or whenever work becomes blocked/);
  assert.match(lane, /accepting start warnings or using "override" is not consent to stack/);
  assert.match(lane, /saved branches and published PR URLs/);
  assert.match(lane, /Keep other blockers and unresolved spike decisions intact/);
  assert.match(lane, /gh pr create --base <dependency-head>/);
  assert.match(lane, /After the dependency merges, retarget to main/);
  assert.match(lane, /For an explicitly agreed stack, use the PR steps in Dependency in review instead/);
});
