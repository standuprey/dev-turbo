import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { forceCloseTicket, readFeatureStatus } from "../dt.mjs";

test("force closure releases only the active ticket and preserves unfinished work and remote records", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "dt-close-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const ctx = { featuresBase: base }, folder = join(base, "demo"), file = join(folder, "progress.json");
  await mkdir(join(folder, "tickets"), { recursive: true });
  await writeFile(join(folder, "feature.json"), JSON.stringify({ slug: "demo", tier: "T2", type: "service" }));
  await writeFile(join(folder, "tickets", "00.md"), '---\nid: "00"\ntitle: First\n---\n');
  await writeFile(join(folder, "tickets", "01.md"), '---\nid: "01"\ntitle: Next\nblocked_by: ["00"]\n---\n');
  const saved = { status: "in_progress", claim: { owner: "other-session", checkout: "/checkout" },
    branch: "saved-branch", worktree: "/checkout", prs: [{ number: 123, state: "open" }], issues: [{ ref: "EX-123" }],
    verification: "Not tested", todo: ["Finish implementation"], blockers: ["Missing access"], next: "Keep building" };
  const original = { gates: { G2: { state: "approved" } }, blockers: ["Project blocker"], tickets: {
    "00": saved, "01": { status: "todo", claim: { owner: "peer", checkout: "/peer" } },
  } };
  await writeFile(file, JSON.stringify(original));
  const unchanged = await readFile(file, "utf8");
  for (const [id, reason] of [["00", ""], ["00", "  "], ["00", "x".repeat(401)], ["99", "Cancelled"], ["01", "Cancelled"]]) {
    assert.throws(() => forceCloseTicket(ctx, "demo", id, reason));
    assert.equal(await readFile(file, "utf8"), unchanged);
  }
  assert.equal(readFeatureStatus(ctx, "demo").st["01"].blocked, true);
  forceCloseTicket(ctx, "demo", "00", "  No longer needed  ");
  const progress = JSON.parse(await readFile(file, "utf8")), closed = progress.tickets["00"];
  assert.equal(closed.status, "done");
  assert.equal(closed.claim, undefined);
  assert.equal(closed.next, undefined);
  assert.deepEqual(closed.acceptance, { state: "approved", forced: true, at: closed.updated, note: "No longer needed" });
  for (const key of ["branch", "worktree", "prs", "issues", "verification", "todo", "blockers"]) assert.deepEqual(closed[key], saved[key]);
  assert.deepEqual(progress.tickets["01"], original.tickets["01"]);
  assert.deepEqual(progress.gates, original.gates);
  assert.deepEqual(progress.blockers, original.blockers);
  assert.equal(readFeatureStatus(ctx, "demo").st["01"].blocked, false);
  assert.match(await readFile(join(folder, "tickets", "00.md"), "utf8"), /First/);
  const done = await readFile(file, "utf8");
  assert.throws(() => forceCloseTicket(ctx, "demo", "00", "Again"), /only active tickets/);
  assert.equal(await readFile(file, "utf8"), done);
  progress.tickets["00"].status = "review";
  await writeFile(file, JSON.stringify(progress));
  forceCloseTicket(ctx, "demo", "00", "Stop review");
  assert.equal(JSON.parse(await readFile(file, "utf8")).tickets["00"].status, "done");
});
