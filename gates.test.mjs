import assert from "node:assert/strict";
import { test } from "node:test";
import * as logic from "./dt.mjs";
import { SCOPE, closable, scopeProposal, pendingGates, approvalPlan, approvalCompletions, nextCommands, namedText } from "./extensions/dt-session/gates.mjs";
import { renderStatus } from "./extensions/dt-status/status.mjs";

const repo = { key: "org/repo", featuresBase: "/features" };
const project = { slug: "demo", tier: "T2", type: "service", key: repo.key, base: repo.featuresBase };
const ticket = { id: "00", title: "Skeleton", blocked_by: [], touches: [], unsafe_with: [] };
function view(gates = {}, ticketState = {}, tickets = [ticket]) {
	const prog = logic.normalizeProgress({ gates: { G0: { state: "approved" }, G2: { state: "approved", at: "2026-11-02T00:00Z" }, ...gates }, tickets: { "00": ticketState } });
	const st = logic.deriveStatuses(tickets, prog);
	const snapshot = { prog, tickets, st, feature: project, phase: "build", next: "Discuss scope changes", suggested: "/dt-lane demo next" };
	return { project, scope: null, branch: [], snapshot };
}

test("a plan proposal is saved in the session, scoped to the repo, not an approval", () => {
	const data = { ...project, note: "Build it" }, branch = [{ type: "custom", customType: SCOPE, data }];
	assert.deepEqual(scopeProposal(branch, repo), data);
	assert.equal(scopeProposal(branch, { ...repo, key: "other/repo" }), null);
	assert.equal(scopeProposal([...branch, { type: "custom", customType: SCOPE, data: null }], repo), null);
	assert.deepEqual(pendingGates({ scope: data }), ["plan"]);
	assert.equal(approvalPlan({ scope: data }, "plan", []).id, 0);
	assert.equal(approvalPlan({ scope: data }, "scope", []).name, "plan", "the old name still approves the plan");
	assert.throws(() => approvalPlan({ scope: data }, "plan", ["other-name"]), /Usage/);
	assert.throws(() => approvalPlan({ scope: { ...data, note: "--help" } }, "plan", []), /task summary/);
	assert.throws(() => approvalPlan({ scope: data, existingScope: true }, "plan", []), /already exists/);
	assert.deepEqual(nextCommands({ scope: data }, logic), ["/dt-approve plan"]);
});

test("a revised plan awaits approval; completion offers only the plan", () => {
	const revised = view({ G2: { state: "pending", note: "new building block" } }, { status: "review", prs: [{ number: 1, state: "open" }] });
	assert.deepEqual(pendingGates(revised), ["plan"]);
	assert.equal(approvalPlan(revised, "plan", []).id, 2);
	assert.deepEqual(approvalCompletions(revised, "").map((i) => i.value), ["plan"]);
	assert.deepEqual(approvalCompletions(revised, "p").map((i) => i.value), ["plan"]);
	assert.deepEqual(approvalCompletions(revised, "0"), []);
	assert.throws(() => approvalPlan(view(), "plan", []), /No plan is awaiting/);
	assert.throws(() => approvalPlan(view(), "drift", []), /Usage/);
	assert.deepEqual(nextCommands(revised, logic), ["/dt-approve plan"]);
});

test("tickets are not approved: /dt-approve points to /dt-check-merged, which inspects open tickets with PRs", () => {
	const saved = { status: "review", prs: [{ number: 123, state: "open" }] };
	for (const [name, args] of [["ticket", ["00"]], ["00", []], ["ticket", []]]) assert.throws(() => approvalPlan(view({}, saved), name, args), /\/dt-check-merged/);
	const tickets = [ticket, { ...ticket, id: "01" }, { ...ticket, id: "02" }];
	const v = view({}, saved, tickets);
	v.snapshot.prog.tickets["01"] = { ...v.snapshot.prog.tickets["01"], status: "done", prs: [{ number: 1 }] };
	assert.deepEqual(closable(v.snapshot).map((t) => t.id), ["00"]);
});

test("routing: revise when no plan, lane when ready, closure when merged", () => {
	assert.deepEqual(nextCommands(view({ G2: undefined }), logic), ["/dt-revise"]);
	assert.deepEqual(nextCommands(view({ G2: { state: "changes" } }), logic), ["/dt-revise"]);
	assert.deepEqual(nextCommands(view(), logic), ["/dt-lane"]);
	assert.deepEqual(nextCommands(view({}, { status: "review", acceptance: { state: "pending" } }), logic), ["/dt-check-merged"]);
	const saved = view(); saved.snapshot.prog.next = "/dt-slice";
	assert.deepEqual(nextCommands(saved, logic), ["/dt-revise"], "retired commands map to /dt-revise");
	const output = renderStatus(project, view().snapshot, logic);
	assert.equal(output.split("## Next commands\n")[1].trim(), "- `/dt-lane`");
	assert.match(output, /Plan: approved/);
	assert.ok(!/drift|Architecture|Slices/i.test(output));
	assert.equal(namedText("Gate 1 pending, G3 and G2b"), "Plan pending, Ticket closure and ticket 00 acceptance");
});

test("merged tickets route straight to internal closure, never review or rebuild", () => {
	for (const acceptance of [undefined, { state: "changes" }]) {
		for (const next of ["", "/dt-review 00", "/dt-review demo 00 autofix", "/dt-lane 00"]) {
			const v = view({}, { status: "review", prs: [{ state: "merged" }, { state: "merged" }], acceptance, next });
			v.snapshot.prog.next = next;
			const before = JSON.stringify(v.snapshot.prog);
			assert.deepEqual(nextCommands(v, logic), ["/dt-check-merged"]);
			assert.match(renderStatus(project, v.snapshot, logic), /`\/dt-check-merged`/);
			assert.equal(JSON.stringify(v.snapshot.prog), before, "routing must not mutate acceptance or status");
		}
	}
	const pending = { status: "review", prs: [{ state: "merged" }], acceptance: { state: "pending" }, verification: "acceptance evidence" };
	assert.deepEqual(nextCommands(view({}, pending), logic), ["/dt-check-merged"]);
	for (const gap of [{ verification: "" }, { blockers: ["staging access"] }]) {
		assert.deepEqual(nextCommands(view({}, { ...pending, ...gap }), logic), ["/dt-check-merged"]);
	}
});

test("merged routing preserves the plan gate, partial-merge review and completed tickets", () => {
	const merged = { status: "review", prs: [{ state: "merged" }], acceptance: { state: "changes" } };
	assert.deepEqual(nextCommands(view({ G2: { state: "pending" } }, merged), logic), ["/dt-approve plan"]);
	assert.deepEqual(nextCommands(view({}, { ...merged, prs: [{ state: "merged" }, { state: "open" }] }), logic), ["/dt-review 00"]);
	assert.deepEqual(nextCommands(view({}, { ...merged, prs: [] }), logic), ["/dt-review 00"]);
	assert.deepEqual(nextCommands(view({}, { ...merged, status: "done", acceptance: { state: "approved" } }), logic), []);
});

test("CLI merged suggestions use internal closure", () => {
	const v = view({}, { status: "review", prs: [{ state: "merged" }], acceptance: { state: "changes" } });
	assert.equal(logic.suggestNext({ slug: project.slug, feature: project, ...v.snapshot }), "/dt-check-merged");
});

test("T0/T1 projects use the same plan, lane and closure routing", () => {
	const quick = { ...view(), project: { ...project, tier: "T1" } };
	assert.deepEqual(nextCommands(quick, logic), ["/dt-lane"]);
	const merged = view({}, { status: "review", prs: [{ number: 4, state: "merged" }] });
	assert.deepEqual(nextCommands({ ...merged, project: { ...project, tier: "T0" } }, logic), ["/dt-check-merged"]);
});

test("T0/T1 projects approved before the plan gate keep their G0 approval", () => {
	const prog = logic.normalizeProgress({ gates: { G0: { state: "approved" } } });
	assert.equal(logic.legacyQuickPlan({ tier: "T0" }, prog).gates.G2.state, "approved");
	assert.equal(logic.legacyQuickPlan({ tier: "T2" }, logic.normalizeProgress({ gates: { G0: { state: "approved" } } })).gates.G2, undefined);
});
