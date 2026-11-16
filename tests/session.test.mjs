import assert from "node:assert/strict";
import { test } from "node:test";
import { ENTRY, restoreProject, resolveCommand, sessionCommand } from "../extensions/dt-session/state.mjs";
import { aligned, usageTotals, createProjectFooter } from "../extensions/dt-session/footer.mjs";

const repo = { key: "org/repo", featuresBase: "/features/org/repo" };
const project = { slug: "checkout", key: repo.key, base: repo.featuresBase, tier: "T2", type: "service" };
const entry = (data) => ({ type: "custom", customType: ENTRY, data });

test("selection restores only from the active session branch and matching repo", () => {
	assert.deepEqual(restoreProject([entry(project)], repo), project);
	assert.equal(restoreProject([], repo), null);
	assert.equal(restoreProject([entry(project), entry(null)], repo), null);
	assert.equal(restoreProject([entry(project)], { ...repo, key: "other/repo" }), null);
	assert.equal(restoreProject([entry(project)], { ...repo, featuresBase: "/other" }), null);
	assert.equal(restoreProject([entry({ ...project, slug: "../escape" })], repo), null);
	assert.equal(restoreProject([entry({ ...project, tier: "T9" })], repo), null);
	assert.equal(restoreProject([entry({ ...project, type: "unknown" })], repo), null);
	const other = { ...project, slug: "catalog" };
	assert.deepEqual(restoreProject([entry(project), entry(other)], repo), other);
	// Navigating back to the earlier branch restores its own selection.
	assert.deepEqual(restoreProject([entry(project)], repo), project);
});

test("workflow commands fail before expansion if no project is selected", () => {
	for (const command of ["lane", "review", "revise"]) {
		assert.throws(() => resolveCommand(`/dt-${command}`, null), /No dev-turbo project selected/);
		assert.throws(() => resolveCommand(`/dt-${command} checkout`, null), /No dev-turbo project selected/);
	}
	for (const text of ["/dt-help", "/dt-status", "/dt-resume checkout", "/dt-start a task", "normal input", "/other"]) {
		assert.equal(resolveCommand(text, null), null);
	}
});

test("retired commands name their replacement instead of reaching the model", () => {
	for (const selected of [null, project]) assert.equal(resolveCommand("/dt-show 01", selected), null, "dt-show is gone, not redirected");
	for (const [command, replacement] of [["spec", "/dt-revise"], ["slice", "/dt-revise"], ["amend x", "/dt-revise <change>"], ["drift", "/dt-revise"], ["quick", "/dt-lane"]]) {
		for (const selected of [null, project]) assert.throws(() => resolveCommand(`/dt-${command}`, selected), new RegExp(`removed\\. Use ${replacement.replace(/[<>]/g, ".")}`));
	}
});

test("selected project supplies slug, task type and default ticket", () => {
	assert.equal(resolveCommand("/dt-lane", project), "/dt-lane checkout");
	assert.equal(resolveCommand("/dt-lane 00", project), "/dt-lane checkout 00");
	assert.equal(resolveCommand("/dt-lane 01 force", project), "/dt-lane checkout 01 force");
	assert.equal(resolveCommand("/dt-lane 01 override", project), "/dt-lane checkout 01 override");
	assert.throws(() => resolveCommand("/dt-lane override", project), /Usage/);
	assert.throws(() => resolveCommand("/dt-lane 01 force override", project), /Usage/);
	assert.throws(() => resolveCommand("/dt-lane next force", project), /Usage/);
	assert.throws(() => resolveCommand("/dt-lane force", project), /Usage/);
	assert.equal(resolveCommand("/dt-review 07 autofix", project), "/dt-review checkout 07 autofix");
	assert.equal(resolveCommand("/dt-review ov-123-my-branch", project), "/dt-review checkout ov-123-my-branch");
	assert.equal(resolveCommand("/dt-revise", project), "/dt-revise checkout");
	assert.equal(resolveCommand("/dt-status", project), null); // Handled directly by its extension.
});

test("staging tests take the selected slug and an optional ticket ID", () => {
	assert.equal(resolveCommand("/dt-staging-test", project), "/dt-staging-test checkout");
	assert.equal(resolveCommand("/dt-staging-test 7", project), "/dt-staging-test checkout 7");
	assert.equal(resolveCommand("/dt-staging-test checkout 07", project), "/dt-staging-test checkout 07");
	assert.throws(() => resolveCommand("/dt-staging-test 07 now", project), /Usage: \/dt-staging-test/);
	assert.throws(() => resolveCommand("/dt-staging-test my-branch", project), /Usage: \/dt-staging-test/);
	assert.throws(() => resolveCommand("/dt-staging-test 07", null), /No dev-turbo project selected/);
	assert.equal(sessionCommand("Next: /dt-staging-test checkout 07", project.slug), "Next: /dt-staging-test 07");
});

test("revise keeps the selected project and the full change description", () => {
	const before = JSON.stringify(project);
	assert.throws(() => resolveCommand("/dt-revise isolate v1", null), /No dev-turbo project selected/);
	assert.equal(resolveCommand("/dt-revise isolate v1 without changing rollout", project), "/dt-revise checkout isolate v1 without changing rollout");
	assert.equal(resolveCommand('/dt-revise "isolate v1, keep flag-off working"', project), '/dt-revise checkout "isolate v1, keep flag-off working"');
	assert.equal(resolveCommand("/dt-revise checkout isolate v1", project), "/dt-revise checkout isolate v1");
	assert.equal(resolveCommand("/dt-revise fix copy", { ...project, tier: "T1" }), "/dt-revise checkout fix copy");
	assert.equal(JSON.stringify(project), before, "revise must not clear or change the selected project");
});

test("final-check is removed; old handovers display internal closure", () => {
	assert.equal(resolveCommand("/dt-final-check 00", project), null);
	assert.equal(resolveCommand("/dt-final-check 00", null), null);
	assert.equal(sessionCommand("/dt-final-check checkout 00", project.slug), "/dt-check-merged");
	assert.equal(sessionCommand("/dt-final-check 7", project.slug), "/dt-check-merged");
});

test("old acceptance handovers display internal closure", () => {
	assert.equal(resolveCommand("/dt-accept 00", project), null, "the old command is no longer registered");
	assert.equal(sessionCommand("/dt-accept checkout 00", project.slug), "/dt-check-merged");
	assert.equal(sessionCommand("Next: /dt-accept 00", project.slug), "Next: /dt-check-merged");
	assert.equal(sessionCommand("/dt-acceptance checkout 00", project.slug), "/dt-acceptance checkout 00");
});

test("legacy saved commands only repeat the selected slug, never switch it", () => {
	assert.equal(resolveCommand("/dt-lane checkout next", project), "/dt-lane checkout");
	assert.equal(resolveCommand("/dt-review checkout 07 autofix", project), "/dt-review checkout 07 autofix");
	assert.throws(() => resolveCommand("/dt-lane catalog next", project), /Usage/);
	assert.throws(() => resolveCommand("/dt-lane 00 extra", project), /Usage/);
	assert.throws(() => resolveCommand("/dt-review 00 extra", project), /Usage/);
});

test("T0/T1 projects use the same lane, review and revise commands", () => {
	const quick = { ...project, tier: "T1", type: "web" };
	assert.equal(resolveCommand("/dt-lane", quick), "/dt-lane checkout");
	assert.equal(resolveCommand("/dt-review", quick), "/dt-review checkout");
	assert.equal(resolveCommand("/dt-revise", quick), "/dt-revise checkout");
});

test("resume displays slugless next steps without changing explicit CLI commands", () => {
	assert.equal(sessionCommand("/dt-lane checkout next", project.slug), "/dt-lane");
	assert.equal(sessionCommand("Next: /dt-review checkout 00\nThen: /dt-drift checkout", project.slug), "Next: /dt-review 00\nThen: /dt-revise");
	for (const old of ["/dt-spec checkout service", "/dt-slice checkout", "/dt-amend checkout", "/dt-drift checkout apply"]) assert.equal(sessionCommand(old, project.slug), "/dt-revise");
	assert.equal(sessionCommand("/dt-approve slices", project.slug), "/dt-approve plan");
	for (const old of ["/dt-approve 00", "/dt-approve checkout 3", "/dt-approve ticket", "/dt-approve ticket 01"]) assert.equal(sessionCommand(old, project.slug), "/dt-check-merged");
	assert.equal(sessionCommand("/dt-resume checkout", project.slug), "/dt-resume checkout");
	assert.equal(sessionCommand("dt.mjs gate checkout 3 approve --ticket 00", project.slug), "dt.mjs gate checkout 3 approve --ticket 00");
});

const format = { visibleWidth: (s) => s.length, truncateToWidth: (s, width) => s.slice(0, Math.max(0, width)) };
test("footer aligns the project above the model and stays within narrow widths", () => {
	assert.equal(aligned("path", "dt: checkout", 24, format).length, 24);
	assert.ok(aligned("a long path", "dt: checkout", 8, format).length <= 8);
	let disposed = false;
	const usage = { input: 100, output: 25, cacheRead: 200, cacheWrite: 50, cost: { total: 0.125 } };
	const ctx = {
		model: { id: "my-model", provider: "provider", contextWindow: 200000, reasoning: true },
		modelRegistry: { isUsingOAuth: () => false },
		getContextUsage: () => ({ percent: 12.5, contextWindow: 200000 }),
		sessionManager: {
			getSessionId: () => "s", getLeafId: () => "l", getEntryCount: () => 1,
			getEntries: () => [{ type: "message", message: { role: "assistant", usage } }],
			getCwd: () => "/repo", getSessionName: () => "feature work",
		},
	};
	const data = { onBranchChange: () => () => { disposed = true; }, getGitBranch: () => "master", getAvailableProviderCount: () => 1, getExtensionStatuses: () => new Map([["test", "other status"]]) };
	const footer = createProjectFooter(ctx, { getThinkingLevel: () => "high" }, { fg: (_, s) => s }, data, { requestRender() {} }, () => project, format);
	const lines = footer.render(100);
	assert.ok(lines[0].endsWith("dt: checkout"));
	assert.ok(lines[1].endsWith("my-model • high"));
	assert.ok(lines[1].includes("↑100 ↓25 R200 W50 $0.125 12.5%/200k"));
	assert.equal(lines[2], "other status");
	for (const width of [1, 8, 20, 60]) assert.ok(footer.render(width).every((line) => line.length <= width));
	footer.dispose();
	assert.ok(disposed);
});

test("footer includes nested tool, compaction and attributed usage", () => {
	const usage = { input: 10, output: 5, cost: { total: 0.1 } };
	const entries = [
		{ type: "usage", usage }, { type: "compaction", usage }, { type: "branch_summary", usage },
		{ type: "message", message: { role: "toolResult", usage } },
		{ type: "message", message: { role: "user", usage } },
	];
	assert.deepEqual(usageTotals(entries), { input: 40, output: 20, cacheRead: 0, cacheWrite: 0, cost: 0.4 });
});
