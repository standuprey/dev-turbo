import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as logic from "../dt.mjs";
import { approvalPlan, nextCommands } from "../extensions/dt-session/gates.mjs";
import { renderStatus } from "../extensions/dt-status/status.mjs";

const project = { slug: "demo", tier: "T2", type: "service" };
function view(states, extra = {}) {
  const tickets = Object.keys(states).map((id) => ({ id, title: id, touches: [id], blocked_by: [], unsafe_with: [] }));
  const prog = logic.normalizeProgress({ gates: { G0: { state: "approved" }, G2: { state: "approved" } }, tickets: states, ...extra });
  return { project, branch: [], snapshot: { feature: project, phase: "build", tickets, prog, st: logic.deriveStatuses(tickets, prog) } };
}

test("full lanes route to the picker without choosing another session's ticket", () => {
  const v = view({ "01": { status: "in_progress", claim: { owner: "other", checkout: "/lane2" } }, "02": { status: "in_progress" }, "03": { status: "todo" } });
  assert.deepEqual(nextCommands(v, logic), ["/dt-lane"]);
  assert.equal(logic.suggestNext({ slug: project.slug, ...v.snapshot }), "/dt-lane demo");
  assert.ok(renderStatus(project, v.snapshot, logic).split("\n").every((line) => line.startsWith("|")));
});

test("review work outranks ready tickets and stale generic lane handovers", () => {
  for (const next of ["", "/dt-lane", "/dt-lane demo", "/dt-lane demo next", "/dt-lane next"]) {
    const v = view({ "42": { status: "review", prs: [{ number: 1, state: "open" }], acceptance: { state: "changes", note: "old scope handover" } }, "53": { status: "todo" } }, { next });
    const before = JSON.stringify(v.snapshot.prog);
    assert.deepEqual(nextCommands(v, logic), ["/dt-review 42"]);
    assert.equal(logic.suggestNext({ slug: project.slug, ...v.snapshot }), "/dt-review demo 42");
    assert.match(renderStatus(project, v.snapshot, logic), /\| 42 \| 42 \| review \|/);
    assert.equal(JSON.stringify(v.snapshot.prog), before);
  }
});

test("reviews are listed before starting new work, but merge closure and explicit review selection keep priority", () => {
  const v = view({ "42": { status: "review", prs: [{ state: "open" }] }, "44": { status: "review", prs: [{ state: "open" }] }, "53": { status: "todo" } });
  assert.deepEqual(nextCommands(v, logic), ["/dt-review 42", "/dt-review 44"]);
  v.snapshot.prog.next = "/dt-review demo 44";
  assert.deepEqual(nextCommands(v, logic), ["/dt-review 44"]);
  v.snapshot.prog.tickets["42"].prs[0].state = "merged";
  v.snapshot.st = logic.deriveStatuses(v.snapshot.tickets, v.snapshot.prog);
  assert.deepEqual(nextCommands(v, logic), ["/dt-check-merged"]);
});

test("CLI snapshots ignore stale generic lane steps when review is due without rewriting progress", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "dt-next-review-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const dir = join(base, project.slug);
  await mkdir(join(dir, "tickets"), { recursive: true });
  await writeFile(join(dir, "feature.json"), JSON.stringify(project));
  for (const id of ["42", "53"]) await writeFile(join(dir, "tickets", `${id}.md`), `---\nid: "${id}"\ntitle: Ticket ${id}\nblocked_by: []\ntouches: [module${id}]\nunsafe_with: []\n---\n`);
  for (const next of ["", "/dt-lane", "/dt-lane demo", "/dt-lane demo next", "/dt-lane next"]) {
    const v = view({ "42": { status: "review", prs: [{ state: "open" }] }, "53": { status: "todo" } }, { next });
    const progress = JSON.stringify(v.snapshot.prog);
    await writeFile(join(dir, "progress.json"), progress);
    const snapshot = logic.readFeatureStatus({ featuresBase: base }, project.slug);
    assert.equal(snapshot.next, "/dt-review demo 42");
    assert.equal(snapshot.suggested, "/dt-review demo 42");
    assert.equal(await readFile(join(dir, "progress.json"), "utf8"), progress);
  }
});

test("resume and approval recognize a pending legacy T2 plan without rewriting progress", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "dt-next-legacy-plan-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const dir = join(base, project.slug);
  const spec = join(dir, "spec.md"), ticket = join(dir, "tickets", "00.md"), file = join(dir, "progress.json");
  await mkdir(join(dir, "tickets"), { recursive: true });
  await writeFile(join(dir, "feature.json"), JSON.stringify(project));
  await writeFile(spec, "Saved spec");
  await writeFile(ticket, '---\nid: "00"\ntitle: Build\n---\n');
  const gates = { G0: { state: "approved" }, G1: { state: "pending", note: "Saved architecture" } };
  const progress = { gates, next: "/dt-lane demo" };
  const read = () => logic.readFeatureStatus({ featuresBase: base }, project.slug);
  const save = (overrides = {}) => writeFile(file, JSON.stringify({ ...progress, ...overrides }));
  await save();
  const snapshot = read(), v = { project, snapshot };
  assert.equal(snapshot.phase, "planning: plan approval pending");
  assert.equal(snapshot.next, "/dt-approve plan");
  assert.equal(snapshot.suggested, snapshot.next);
  assert.match(logic.renderBrief({ slug: project.slug, ...snapshot }), /\*\*Next:\*\* \/dt-approve plan/);
  assert.deepEqual(nextCommands(v, logic), ["/dt-approve plan"]);
  assert.equal(approvalPlan(v, "plan", []).id, 2);
  assert.equal(await readFile(file, "utf8"), JSON.stringify(progress));

  for (const state of ["pending", "approved", "changes"]) {
    const G2 = { state, note: "Explicit plan gate" };
    await save({ gates: { ...gates, G2 } });
    const current = read();
    assert.deepEqual(current.prog.gates.G2, G2);
    if (state === "pending") assert.equal(current.next, "/dt-approve plan");
  }
  await save({ gates: { ...gates, G1: { state: "approved" } } });
  assert.equal(read().prog.gates.G2, undefined, "architecture approval is not plan approval");
  await save();
  await rm(spec);
  assert.equal(read().prog.gates.G2, undefined);
  await writeFile(spec, "Saved spec");
  await rm(ticket);
  assert.equal(read().prog.gates.G2, undefined);
});

test("completion has no next command and suggests no review", () => {
  for (const tier of ["T0", "T1", "T2"]) {
    const v = view({ "00": { status: "done" } });
    const p = { ...project, tier };
    assert.deepEqual(nextCommands({ ...v, project: p }, logic), []);
    assert.equal(renderStatus(p, v.snapshot, logic).split("\n").length, 2);
    assert.doesNotMatch(renderStatus(p, v.snapshot, logic), /drift/i);
  }
  const v = view({ "00": { status: "done" } });
  assert.equal(logic.suggestNext({ slug: project.slug, ...v.snapshot }), "feature complete");
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
  for (const name of ["lane", "review", "revise"]) {
    const prompt = await readFile(new URL(`../prompts/dt-${name}.md`, import.meta.url), "utf8");
    assert.doesNotMatch(prompt, /\/dt-status\b(?! <id>)/);
  }
});
