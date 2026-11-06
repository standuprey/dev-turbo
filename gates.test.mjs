import assert from "node:assert/strict";
import { test } from "node:test";
import * as logic from "./dt.mjs";
import { SCOPE, QUICK, scopeProposal, pendingGates, approvalPlan, approvalCompletions, driftDecisions, needsSliceReview, nextCommands, namedText } from "./extensions/dt-session/gates.mjs";
import { renderStatus } from "./extensions/dt-status/status.mjs";

const repo = { key: "org/repo", featuresBase: "/features" };
const project = { slug: "demo", tier: "T2", type: "service", key: repo.key, base: repo.featuresBase };
const ticket = { id: "00", title: "Skeleton", blocked_by: [], touches: [], unsafe_with: [] };
function view(gates = {}, ticketState = {}) {
	const prog = logic.normalizeProgress({ gates: { G1: { state: "approved", at: "2026-11-01T00:00Z" }, G2: { state: "approved", at: "2026-11-02T00:00Z" }, ...gates }, tickets: { "00": ticketState } });
	const tickets = [ticket], st = logic.deriveStatuses(tickets, prog);
	const snapshot = { prog, tickets, st, feature: project, phase: "build", next: "Discuss scope changes", suggested: "/dt-lane demo next" };
	return { project, scope: null, branch: [], snapshot };
}

test("scope is a saved proposal, scoped to the repo, not an approval", () => {
	const data = { ...project, note: "Build it" }, branch = [{ type: "custom", customType: SCOPE, data }];
	assert.deepEqual(scopeProposal(branch, repo), data);
	assert.equal(scopeProposal(branch, { ...repo, key: "other/repo" }), null);
	assert.equal(scopeProposal([...branch, { type: "custom", customType: SCOPE, data: null }], repo), null);
	assert.deepEqual(pendingGates({ scope: data }), ["scope"]);
	assert.equal(approvalPlan({ scope: data }, "scope", []).id, 0);
	assert.throws(() => approvalPlan({ scope: data }, "scope", ["other-name"]), /Usage/);
	assert.throws(() => approvalPlan({ scope: { ...data, note: "--help" } }, "scope", []), /task summary/);
});

test("named gate completion only offers pending gates and ticket IDs", () => {
	const v = view({ G1: { state: "pending" }, G4: { state: "pending", note: "2 findings" } }, { status: "review", acceptance: { state: "pending" } });
	assert.ok(approvalCompletions(v, "arch").some((i) => i.value === "architecture"));
	assert.ok(!approvalCompletions(v, "").some((i) => i.value === "slices"));
	const t = view({}, { status: "review", acceptance: { state: "pending" } });
	assert.deepEqual(approvalCompletions(t, "ticket ").map((i) => i.value), ["ticket 00"]);
	assert.deepEqual(approvalCompletions(t, "ticket 9"), []);
	assert.throws(() => approvalPlan(t, "ticket", []), /ticket <ID>/);
	assert.throws(() => approvalPlan(t, "architecture", []), /not awaiting/);
});

test("ticket acceptance requires merged PRs, saved verification and cleared blockers", () => {
	const saved = { status: "review", acceptance: { state: "pending" }, verification: "tests + staging", prs: [{ state: "merged" }] };
	assert.equal(approvalPlan(view({}, saved), "ticket", ["0"]).ticket, "00");
	assert.throws(() => approvalPlan(view({}, { ...saved, prs: [{ state: "open" }] }), "ticket", ["00"]), /merged/);
	assert.throws(() => approvalPlan(view({}, { ...saved, verification: "" }), "ticket", ["00"]), /verification/);
	assert.throws(() => approvalPlan(view({}, { ...saved, blockers: ["staging failed"] }), "ticket", ["00"]), /blockers/);
	assert.ok(pendingGates(view({}, { status: "review", next: "Gate 3: merge decision" })).includes("ticket")); // Legacy state.
});

test("drift needs exactly one explicit decision per numbered finding", () => {
	const v = view({ G4: { state: "pending", note: "2 findings" } });
	assert.equal(driftDecisions(v.snapshot, ["2:accept", "1:spec"]), "1:spec 2:accept");
	for (const bad of [[], ["1:spec"], ["1:spec", "1:code"], ["1:spec", "3:accept"], ["1:maybe", "2:accept"]]) assert.throws(() => driftDecisions(v.snapshot, bad));
	assert.deepEqual(approvalCompletions(v, "drift 1:spec 2:").map((i) => i.value), ["drift 1:spec 2:code", "drift 1:spec 2:spec", "drift 1:spec 2:accept"]);
	assert.equal(approvalPlan(view({ G4: { state: "pending", note: "0 findings" } }), "drift", []).note, "0 findings");
});

test("next steps are workflow commands, and spec amendments reopen slice review", () => {
	assert.deepEqual(nextCommands(view({ G1: { state: "pending" } }), logic), ["/dt-approve architecture"]);
	assert.deepEqual(nextCommands(view({ G2: { state: "pending" } }), logic), ["/dt-approve slices"]);
	assert.deepEqual(nextCommands(view({}, { status: "review", acceptance: { state: "pending" } }), logic), ["/dt-approve ticket 00"]);
	const amended = view({ G4: { state: "approved", at: "2026-11-05T00:00Z", note: "1:spec" } });
	assert.ok(needsSliceReview(amended.snapshot));
	assert.deepEqual(nextCommands(amended, logic), ["/dt-slice"]);
	amended.snapshot.prog.todo = ["drift 1: amendment -> spec"];
	assert.deepEqual(nextCommands(amended, logic), ["/dt-drift apply"]);
	const concrete = view(); concrete.snapshot.prog.next = "/dt-slice";
	assert.deepEqual(nextCommands(concrete, logic), ["/dt-slice"]);
	const output = renderStatus(project, amended.snapshot, logic);
	const final = output.split("## Next commands\n")[1];
	assert.equal(final.trim(), "- `/dt-drift apply`");
	assert.ok(output.indexOf("## Next commands") > output.indexOf("## Approvals"));
	assert.ok(!output.includes("G1") && !output.includes("G3"));
	assert.equal(namedText("Gate 1 pending, G3 and G2b"), "Architecture pending, Ticket acceptance and ticket 00 acceptance");
});

test("merged tickets route to acceptance preparation, never review or rebuild", () => {
	for (const acceptance of [undefined, { state: "changes" }]) {
		for (const next of ["", "/dt-review 00", "/dt-review demo 00 autofix", "/dt-lane 00"]) {
			const v = view({}, { status: "review", prs: [{ state: "merged" }, { state: "merged" }], acceptance, next });
			v.snapshot.prog.next = next;
			const before = JSON.stringify(v.snapshot.prog);
			assert.deepEqual(nextCommands(v, logic), ["/dt-final-check 00"]);
			assert.match(renderStatus(project, v.snapshot, logic), /`\/dt-final-check 00`/);
			assert.equal(JSON.stringify(v.snapshot.prog), before, "routing must not mutate acceptance or status");
		}
	}
	const pending = { status: "review", prs: [{ state: "merged" }], acceptance: { state: "pending" }, verification: "acceptance evidence" };
	assert.deepEqual(nextCommands(view({}, pending), logic), ["/dt-approve ticket 00"]);
	for (const gap of [{ verification: "" }, { blockers: ["staging access"] }]) {
		assert.deepEqual(nextCommands(view({}, { ...pending, ...gap }), logic), ["/dt-final-check 00"]);
	}
});

test("amendment handoffs supersede stale approvals without restarting merged work", () => {
	const merged = { status: "review", prs: [{ state: "merged" }], acceptance: { state: "changes" } };
	assert.deepEqual(nextCommands(view({ G1: { state: "changes", note: "Amendment proposed; revise spec" } }, merged), logic), ["/dt-spec"]);
	assert.deepEqual(nextCommands(view({ G2: { state: "changes", note: "Amendment proposed; align tickets" } }, merged), logic), ["/dt-slice"]);
});

test("merged routing preserves gates, partial-merge review and completed tickets", () => {
	const merged = { status: "review", prs: [{ state: "merged" }], acceptance: { state: "changes" } };
	assert.deepEqual(nextCommands(view({ G2: { state: "pending" } }, merged), logic), ["/dt-approve slices"]);
	assert.deepEqual(nextCommands(view({ G4: { state: "pending" } }, merged), logic), ["/dt-approve drift"]);
	assert.deepEqual(nextCommands(view({}, { ...merged, prs: [{ state: "merged" }, { state: "open" }] }), logic), ["/dt-review 00"]);
	assert.deepEqual(nextCommands(view({}, { ...merged, prs: [] }), logic), ["/dt-review 00"]);
	assert.deepEqual(nextCommands(view({}, { ...merged, status: "done", acceptance: { state: "approved" } }), logic), ["/dt-status"]);
});

test("CLI merged suggestions use acceptance preparation instead of raw approval", () => {
	const v = view({}, { status: "review", prs: [{ state: "merged" }], acceptance: { state: "changes" } });
	assert.equal(logic.suggestNext({ slug: project.slug, feature: project, ...v.snapshot }), "/dt-final-check demo 00");
});

test("small-task approvals use the same names and stay in their scope session", () => {
	const quick = { ...project, tier: "T1", scopeId: "one" };
	const branch = [{ type: "custom", customType: QUICK, data: { slug: "demo", key: repo.key, scopeId: "one", gate: "slices", state: "pending", note: "Scenarios" } }];
	const v = { project: quick, branch };
	assert.deepEqual(pendingGates(v), ["slices"]);
	assert.ok(approvalPlan(v, "slices", []).quick);
	assert.deepEqual(nextCommands(v, logic), ["/dt-approve slices"]);
	assert.deepEqual(pendingGates({ ...v, project: { ...quick, scopeId: "new" } }), []);
	branch.push({ type: "custom", customType: QUICK, data: { ...branch[0].data, state: "approved" } });
	branch.push({ type: "custom", customType: QUICK, data: { ...branch[0].data, gate: "review", state: "pending" } });
	assert.deepEqual(nextCommands(v, logic), ["/dt-review"]);
});
