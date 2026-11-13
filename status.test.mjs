import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as logic from "./dt.mjs";
import { renderStatus, renderTicketProgress } from "./extensions/dt-status/status.mjs";
import { readTicketPreview, displayTicket, ticketStatus } from "./extensions/dt-session/ticket-preview.mjs";

async function fixture(t, progress = {}) {
	const base = await mkdtemp(join(tmpdir(), "dt-status-"));
	t.after(() => rm(base, { recursive: true, force: true }));
	const dir = join(base, "demo");
	await mkdir(join(dir, "tickets"), { recursive: true });
	const feature = { slug: "demo", tier: "T2", type: "service" };
	await writeFile(join(dir, "feature.json"), JSON.stringify(feature));
	await writeFile(join(dir, "progress.json"), JSON.stringify({ version: 1, updated: "2026-11-05T10:00Z", gates: { G0: { state: "approved" }, G2: { state: "approved" } }, ...progress }));
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
	assert.ok(output.includes("Tickets left (2)"));
	assert.ok(output.includes("| 01 | First slice | ready |"));
	assert.ok(output.includes("| 02 | Second slice | blocked by 01 |"));
	assert.ok(output.includes("Confirm acceptance before starting 01"));
	assert.ok(output.includes("Align scopes with revised spec"));
	assert.ok(output.includes("Plan: approved"));
	assert.ok(!output.includes("99"));
	assert.equal(await readFile(join(f.dir, "progress.json"), "utf8"), before);
	assert.deepEqual(await readdir(f.dir), beforeFiles);
});

test("ticket detail includes all saved progress without changing files or showing another ticket's state", async (t) => {
	const saved = {
		status: "review", updated: "2026-11-05T09:00Z", branch: "ov_731_scoped_styles", worktree: "/lane2",
		claim: { owner: "session-123", checkout: "/lane2", acquired: "2026-11-04T09:00Z" },
		next: "/dt-review demo 00", verification: "unit tests passed\nstaging needs acceptance",
		todo: ["Check keyboard navigation"], blockers: ["Needs human"],
		prs: [{ number: 123, url: "https://github.com/org/repo/pull/123", state: "merged", checked: "2026-11-05T09:00Z" }],
		issues: [{ key: "OV-731", url: "https://jira.example/browse/OV-731" }],
		jira: { key: "OV-731", description: "Keep scoped styles" }, acceptance: { state: "pending" },
		custom: { note: "Keep ``` intact" },
	};
	const f = await fixture(t, { tickets: { "00": saved, "01": { verification: "Other ticket only" } } });
	const before = await readFile(join(f.dir, "progress.json"), "utf8");
	const snapshot = logic.readFeatureStatus(f.repo, "demo");
	const ticket = await readTicketPreview(snapshot, "0");
	const messages = [];
	displayTicket({ sendMessage(message) { messages.push(message); } }, f.project, ticket, ticketStatus(snapshot, ticket.id), renderTicketProgress(snapshot, ticket.id));
	const output = messages[0].content;
	assert.ok(output.startsWith("Status: REVIEW"));
	assert.ok(output.includes(ticket.content));
	assert.ok(output.indexOf(ticket.content) < output.indexOf("## Saved ticket progress"));
	assert.ok(output.endsWith(renderTicketProgress(snapshot, ticket.id)));
	assert.match(output, /Saved ticket progress/);
	assert.match(output, /progress.json.*2026-11-05T10:00Z/);
	assert.match(output, /PR states are saved observations/);
	for (const label of ["Status", "Last updated", "Branch", "Worktree", "Claim", "Saved handover", "Verification", "Todo", "Blockers", "PRs", "Issues", "Jira", "Acceptance", "Custom"]) {
		assert.ok(output.includes(`**${label}:**`), `missing readable ${label}`);
	}
	for (const value of ["session-123", "/lane2", "2026-11-04T09:00Z", "/dt-review demo 00", "unit tests passed staging needs acceptance", "Check keyboard navigation", "Needs human", "https://github.com/org/repo/pull/123", "merged", "OV-731", "Keep scoped styles", "pending"]) {
		assert.ok(output.includes(value), `missing saved value ${value}`);
	}
	assert.ok(output.includes("Keep \\`\\`\\` intact"));
	assert.doesNotMatch(output, /```json|"status":|"claim":/);
	assert.doesNotMatch(output, /Other ticket only/);
	assert.equal(await readFile(join(f.dir, "progress.json"), "utf8"), before);
});

test("readable progress skips empty defaults and keeps unfamiliar values", async (t) => {
	const f = await fixture(t, { tickets: { "00": { status: "in_progress", retryCount: 0, needs_review: false, metadata: {}, extra_notes: ["Saved note"] } } });
	const output = renderTicketProgress(logic.readFeatureStatus(f.repo, "demo"), "00");
	assert.match(output, /\*\*Status:\*\* in progress/);
	assert.match(output, /\*\*Retry Count:\*\* 0/);
	assert.match(output, /\*\*Needs review:\*\* No/);
	assert.match(output, /\*\*Extra notes:\*\*/);
	assert.match(output, /- Saved note/);
	assert.doesNotMatch(output, /\*\*(Claim|Metadata|PRs|Blockers|Verification):\*\*/);
});

test("ticket detail explicitly reports missing progress", async (t) => {
	const f = await fixture(t);
	const snapshot = logic.readFeatureStatus(f.repo, "demo");
	assert.match(renderTicketProgress(snapshot, "00"), /No saved progress for this ticket/);
	assert.deepEqual(snapshot.prog.tickets, {});
});

test("saved merged PRs do not mark a review ticket done or skip acceptance", async (t) => {
	const f = await fixture(t, { next: "Verify staging acceptance, then approve 00 G3", tickets: { "00": { status: "review", next: "Human acceptance", verification: "unit tests passed", todo: ["Authenticated staging test"], blockers: ["Needs human"], prs: [{ number: 123, state: "merged", checked: "2026-11-05T09:00Z" }] } } });
	const output = renderStatus(f.project, logic.readFeatureStatus(f.repo, "demo"), logic);
	assert.ok(output.includes("0/3 accepted"));
	assert.ok(output.includes("unit tests passed"));
	assert.ok(output.includes("Authenticated staging test"));
	assert.ok(output.includes("Needs human"));
	assert.ok(output.includes("#123 merged (checked 2026-11-05T09:00Z)"));
	assert.ok(output.includes("Merged: use `/dt-check-merged`"));
	assert.ok(output.includes("| 01 | First slice | blocked by 00 |"));
});

test("ready list respects gates and blockers without an in-flight count limit", async (t) => {
	const f = await fixture(t, { gates: { G2: { state: "pending", note: "New building block" } }, tickets: { "00": { status: "done" } } });
	let output = renderStatus(f.project, logic.readFeatureStatus(f.repo, "demo"), logic);
	assert.ok(output.includes("waiting for plan approval"));
	assert.ok(output.includes("Plan: revision awaiting /dt-approve plan — New building block"));
	const progress = { gates: { G2: { state: "approved" } }, tickets: { "00": { status: "in_progress" }, "01": { status: "review" } } };
	await f.ticket("02", "Independent slice");
	await writeFile(join(f.dir, "progress.json"), JSON.stringify(progress));
	output = renderStatus(f.project, logic.readFeatureStatus(f.repo, "demo"), logic);
	assert.ok(output.includes("| 02 | Independent slice | ready |"));
	assert.ok(!output.includes("merge one first"));
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

test("all tickets closed has no next command; T0/T1 use the same board", async (t) => {
	const f = await fixture(t, { tickets: { "00": { status: "done" }, "01": { status: "done" }, "02": { status: "done" } } });
	const output = renderStatus(f.project, logic.readFeatureStatus(f.repo, "demo"), logic);
	assert.ok(output.includes("all tickets accepted"));
	assert.ok(output.includes("No next command."));
	const quick = renderStatus({ ...f.project, tier: "T1" }, logic.readFeatureStatus(f.repo, "demo"), logic);
	assert.ok(quick.includes("3/3 accepted"));
});
