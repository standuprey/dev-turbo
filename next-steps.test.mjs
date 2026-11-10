import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as logic from "./dt.mjs";
import { nextCommands, QUICK } from "./extensions/dt-session/gates.mjs";
import { renderStatus } from "./extensions/dt-status/status.mjs";

const project = { slug: "demo", tier: "T2", type: "service" };
function view(states, extra = {}) {
  const tickets = Object.keys(states).map((id) => ({ id, title: id, touches: [id], blocked_by: [], unsafe_with: [] }));
  const prog = logic.normalizeProgress({ gates: { G1: { state: "approved" }, G2: { state: "approved" } }, tickets: states, ...extra });
  return { project, branch: [], snapshot: { feature: project, phase: "build", tickets, prog, st: logic.deriveStatuses(tickets, prog) } };
}

test("full lanes route to the picker without choosing another session's ticket", () => {
  const v = view({ "01": { status: "in_progress", claim: { owner: "other", checkout: "/lane2" } }, "02": { status: "in_progress" }, "03": { status: "todo" } });
  assert.deepEqual(nextCommands(v, logic), ["/dt-lane"]);
  assert.equal(logic.suggestNext({ slug: project.slug, ...v.snapshot }), "/dt-lane demo");
  assert.match(renderStatus(project, v.snapshot, logic), /## Next commands\n- `\/dt-lane`$/);
});

test("completion has no next command, but outstanding final drift still routes to review", () => {
  const v = view({ "00": { status: "done" } });
  assert.deepEqual(nextCommands(v, logic), []);
  assert.match(renderStatus(project, v.snapshot, logic), /## Next commands\nNo next command\.$/);
  v.snapshot.prog.drift.merges_since = 1;
  assert.deepEqual(nextCommands(v, logic), ["/dt-drift"]);
  assert.equal(logic.suggestNext({ slug: project.slug, ...v.snapshot }), "/dt-drift demo");
  for (const tier of ["T0", "T1"]) {
    const quick = { ...project, tier, key: "org/repo", scopeId: "scope" };
    const branch = [{ type: "custom", customType: QUICK, data: { ...quick, gate: "ticket", state: "approved" } }];
    assert.deepEqual(nextCommands({ project: quick, branch }, logic), []);
    assert.match(renderStatus(quick, null, logic, { branch }), /## Next commands\nNo next command\.$/);
  }
});

test("stale saved status commands are ignored without rewriting progress", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "dt-next-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const dir = join(base, project.slug);
  await mkdir(join(dir, "tickets"), { recursive: true });
  await writeFile(join(dir, "feature.json"), JSON.stringify(project));
  await writeFile(join(dir, "tickets/00-ticket.md"), '---\nid: "00"\ntitle: Build\nkind: AFK\nblocked_by: []\ntouches: [module]\n---\n');
  for (const command of ["/dt-status", "/dt-status demo"]) {
    const v = view({ "00": { status: "in_progress", next: command } }, { next: command });
    const progress = JSON.stringify(v.snapshot.prog);
    await writeFile(join(dir, "progress.json"), progress);
    const snapshot = logic.readFeatureStatus({ featuresBase: base }, project.slug);
    assert.equal(snapshot.next, "/dt-lane demo");
    assert.equal(snapshot.suggested, "/dt-lane demo");
    assert.deepEqual(nextCommands({ ...v, snapshot }, logic), ["/dt-lane"]);
    assert.doesNotMatch(logic.renderBrief({ slug: project.slug, ...snapshot }), /\/dt-status\b/);
    assert.doesNotMatch(renderStatus(project, snapshot, logic), /\/dt-status\b/);
    assert.equal(await readFile(join(dir, "progress.json"), "utf8"), progress);
  }
});

test("workflow prompts never send completed work back to status", async () => {
  for (const name of ["lane", "review", "drift"]) {
    const prompt = await readFile(new URL(`./prompts/dt-${name}.md`, import.meta.url), "utf8");
    assert.doesNotMatch(prompt, /\/dt-status\b/);
  }
});
