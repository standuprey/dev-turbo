import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as logic from "./dt.mjs";
import { renderStatus } from "./extensions/dt-status/status.mjs";

async function fixture(t, progress = {}) {
	const base = await mkdtemp(join(tmpdir(), "dt-status-"));
	t.after(() => rm(base, { recursive: true, force: true }));
	const dir = join(base, "demo");
	await mkdir(join(dir, "tickets"), { recursive: true });
	const feature = { slug: "demo", tier: "T2", type: "service" };
	await writeFile(join(dir, "feature.json"), JSON.stringify(feature));
	await writeFile(join(dir, "progress.json"), JSON.stringify({ version: 1, updated: "2026-11-05T10:00Z", gates: { G0: { state: "approved" }, G1: { state: "approved" }, G2: { state: "approved" } }, ...progress }));
	const ticket = async (id, title, blocked = [], extra = "") => writeFile(join(dir, "tickets", `${id}-ticket.md`), `---\nid: "${id}"\ntitle: ${title}\nkind: AFK\nblocked_by: [${blocked.join(", ")}]\ntouches: [module-${id}]\n${extra}---\nScenarios\n`);
	await ticket("00", "Walking skeleton");
	await ticket("01", "First slice", ["00"]);
	await ticket("02", "Second slice", ["01"]);
	await writeFile(join(dir, "spec.md"), "Historical spec ID 99 must not become a ticket.");
	return { base, dir, ticket, repo: { featuresBase: base }, project: { ...feature, base } };
}

test("status reads files without writes and lists done, remaining, gates and saved next", async (t) => {
	const f = await fixture(t, { next: "Confirm acceptance before starting 01", todo: ["Align scopes with revised spec"], tickets: { "00": { status: "done", verification: "tests + staging passed" } } });
	const before = await readFile(join(f.dir, "progress.json"), "utf8");
	const beforeFiles = await readdir(f.dir);
	const snapshot = logic.readFeatureStatus(f.repo, "demo");
	const output = renderStatus(f.project, snapshot, logic);
	assert.ok(output.includes("1/3 accepted"));
	assert.ok(output.includes("Accepted (1)"));
	assert.ok(output.includes("tests + staging passed"));
	assert.ok(output.includes("Tickets / slices left (2)"));
	assert.ok(output.includes("| 01 | First slice | ready |"));
	assert.ok(output.includes("| 02 | Second slice | blocked by 01 |"));
	assert.ok(output.includes("Confirm acceptance before starting 01"));
	assert.ok(output.includes("Align scopes with revised spec"));
	assert.ok(output.includes("Architecture: approved"));
	assert.ok(output.includes("Ticket acceptance: 00 accepted"));
	assert.ok(!output.includes("99"));
	assert.equal(await readFile(join(f.dir, "progress.json"), "utf8"), before);
	assert.deepEqual(await readdir(f.dir), beforeFiles);
});

test("saved merged PRs do not mark a review ticket done or skip acceptance", async (t) => {
	const f = await fixture(t, { next: "Verify staging acceptance, then approve 00 G3", tickets: { "00": { status: "review", next: "Human acceptance", verification: "unit tests passed", todo: ["Authenticated staging test"], blockers: ["Needs human"], prs: [{ number: 123, state: "merged", checked: "2026-11-05T09:00Z" }] } } });
	const output = renderStatus(f.project, logic.readFeatureStatus(f.repo, "demo"), logic);
	assert.ok(output.includes("0/3 accepted"));
	assert.ok(output.includes("unit tests passed"));
	assert.ok(output.includes("Authenticated staging test"));
	assert.ok(output.includes("Needs human"));
	assert.ok(output.includes("#123 merged (checked 2026-11-05T09:00Z)"));
	assert.ok(output.includes("Merged but not accepted"));
	assert.ok(output.includes("| 01 | First slice | blocked by 00 |"));
});

test("ready list respects gate decisions, in-flight limits and resource conflicts", async (t) => {
	const f = await fixture(t, { gates: { G1: { state: "approved" }, G2: { state: "pending", note: "Review slices" } }, tickets: { "00": { status: "done" } } });
	let output = renderStatus(f.project, logic.readFeatureStatus(f.repo, "demo"), logic);
	assert.ok(output.includes("waiting for Architecture / Slices approval"));
	assert.ok(output.includes("Slices: pending"));
	const progress = { gates: { G1: { state: "approved" }, G2: { state: "approved" } }, tickets: { "00": { status: "in_progress" }, "01": { status: "review" } } };
	await f.ticket("02", "Independent slice");
	await writeFile(join(f.dir, "progress.json"), JSON.stringify(progress));
	output = renderStatus(f.project, logic.readFeatureStatus(f.repo, "demo"), logic);
	assert.ok(output.includes("2 tickets already in flight"));
	assert.ok(output.includes("Ready by saved gate/dependency/resource checks: none"));
	progress.tickets["00"].status = "done";
	progress.tickets["02"] = { blockers: ["Needs a scope decision"] };
	await writeFile(join(f.dir, "progress.json"), JSON.stringify(progress));
	output = renderStatus(f.project, logic.readFeatureStatus(f.repo, "demo"), logic);
	assert.ok(output.includes("saved blockers: Needs a scope decision"));
});

test("no tickets, missing/corrupt progress and orphan ticket IDs are explicit", async (t) => {
	const f = await fixture(t, { gates: { G1: { state: "pending" } }, tickets: { "99": { status: "done" } } });
	await rm(join(f.dir, "tickets"), { recursive: true });
	const output = renderStatus(f.project, logic.readFeatureStatus(f.repo, "demo"), logic);
	assert.ok(output.includes("No ticket files yet"));
	assert.ok(output.includes("progress has ticket IDs without ticket files: 99"));
	await writeFile(join(f.dir, "progress.json"), "bad JSON");
	assert.throws(() => logic.readFeatureStatus(f.repo, "demo"), /cannot parse/);
	await rm(join(f.dir, "progress.json"));
	assert.throws(() => logic.readFeatureStatus(f.repo, "demo"), /cannot report saved ticket completion/);
});

test("all recorded done is not a claim of completed rollout; T0/T1 do not invent a board", async (t) => {
	const f = await fixture(t, { tickets: { "00": { status: "done" }, "01": { status: "done" }, "02": { status: "done" } } });
	const output = renderStatus(f.project, logic.readFeatureStatus(f.repo, "demo"), logic);
	assert.ok(output.includes("all tickets accepted"));
	assert.ok(output.includes("Check feature acceptance and rollout"));
	const quick = renderStatus({ slug: "quick-fix", tier: "T1", type: "web" }, null, logic);
	assert.ok(quick.includes("no feature-folder ticket board"));
	assert.ok(quick.includes("/dt-quick"));
});
