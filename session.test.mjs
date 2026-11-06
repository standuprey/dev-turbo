import assert from "node:assert/strict";
import { test } from "node:test";
import { ENTRY, restoreProject, resolveCommand, sessionCommand } from "./extensions/dt-session/state.mjs";
import { aligned, usageTotals, createProjectFooter } from "./extensions/dt-session/footer.mjs";

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
	for (const command of ["spec", "slice", "lane", "review", "drift", "quick"]) {
		assert.throws(() => resolveCommand(`/dt-${command}`, null), /No dev-turbo project selected/);
		assert.throws(() => resolveCommand(`/dt-${command} checkout`, null), /No dev-turbo project selected/);
	}
	for (const text of ["/dt-help", "/dt-status", "/dt-resume checkout", "/dt-grill a task", "normal input", "/other"]) {
		assert.equal(resolveCommand(text, null), null);
	}
});

test("selected project supplies slug, task type and default ticket", () => {
	assert.equal(resolveCommand("/dt-spec", project), "/dt-spec checkout service");
	assert.equal(resolveCommand("/dt-spec web", project), "/dt-spec checkout web");
	assert.equal(resolveCommand("/dt-slice", project), "/dt-slice checkout");
	assert.equal(resolveCommand("/dt-lane", project), "/dt-lane checkout next");
	assert.equal(resolveCommand("/dt-lane 00", project), "/dt-lane checkout 00");
	assert.equal(resolveCommand("/dt-review 07 autofix", project), "/dt-review checkout 07 autofix");
	assert.equal(resolveCommand("/dt-review ov-123-my-branch", project), "/dt-review checkout ov-123-my-branch");
	assert.equal(resolveCommand("/dt-drift", project), "/dt-drift checkout");
	assert.equal(resolveCommand("/dt-status", project), null); // Handled directly by its extension.
});

test("amend requires a selected T2 project and preserves the full change description", () => {
	const before = JSON.stringify(project);
	assert.throws(() => resolveCommand("/dt-amend isolate v1", null), /No dev-turbo project selected/);
	assert.equal(resolveCommand("/dt-amend isolate v1 without changing rollout", project), "/dt-amend checkout isolate v1 without changing rollout");
	assert.equal(resolveCommand('/dt-amend "isolate v1, keep flag-off working"', project), '/dt-amend checkout "isolate v1, keep flag-off working"');
	assert.equal(resolveCommand("/dt-amend checkout isolate v1", project), "/dt-amend checkout isolate v1");
	assert.equal(sessionCommand("/dt-amend checkout isolate v1", project.slug), "/dt-amend isolate v1");
	for (const args of ["", "--help", '""']) assert.throws(() => resolveCommand(`/dt-amend ${args}`, project), /description/);
	assert.throws(() => resolveCommand("/dt-amend isolate v1", { ...project, tier: "T1" }), /needs a T2/);
	assert.equal(JSON.stringify(project), before, "amend must not clear or change the selected project");
});

test("final checks are a selected T2 ticket command", () => {
	assert.throws(() => resolveCommand("/dt-final-check 00", null), /No dev-turbo project selected/);
	assert.equal(resolveCommand("/dt-final-check 00", project), "/dt-final-check checkout 00");
	assert.equal(resolveCommand("/dt-final-check checkout 7", project), "/dt-final-check checkout 7");
	assert.equal(sessionCommand("/dt-final-check checkout 00", project.slug), "/dt-final-check 00");
	for (const args of ["", "next", "my-branch", "00 autofix", "00 extra"]) {
		assert.throws(() => resolveCommand(`/dt-final-check ${args}`, project), /Usage/);
	}
	assert.throws(() => resolveCommand("/dt-final-check 00", { ...project, tier: "T1" }), /needs a T2/);
});

test("old acceptance handovers display the renamed final-check command", () => {
	assert.equal(resolveCommand("/dt-accept 00", project), null, "the old command is no longer registered");
	assert.equal(sessionCommand("/dt-accept checkout 00", project.slug), "/dt-final-check 00");
	assert.equal(sessionCommand("Next: /dt-accept 00", project.slug), "Next: /dt-final-check 00");
	assert.equal(sessionCommand("/dt-acceptance checkout 00", project.slug), "/dt-acceptance checkout 00");
});

test("legacy saved commands only repeat the selected slug, never switch it", () => {
	assert.equal(resolveCommand("/dt-lane checkout next", project), "/dt-lane checkout next");
	assert.equal(resolveCommand("/dt-spec checkout service", project), "/dt-spec checkout service");
	assert.equal(resolveCommand("/dt-review checkout 07 autofix", project), "/dt-review checkout 07 autofix");
	assert.throws(() => resolveCommand("/dt-lane catalog next", project), /Usage/);
	assert.throws(() => resolveCommand("/dt-drift catalog", project), /Switch projects/);
	assert.throws(() => resolveCommand("/dt-spec catalog service", project), /Switch projects/);
	assert.throws(() => resolveCommand("/dt-lane 00 extra", project), /Usage/);
	assert.throws(() => resolveCommand("/dt-review 00 extra", project), /Usage/);
});

test("T0/T1 retain quick-task defaults and cannot run ticket workflows", () => {
	const quick = { ...project, tier: "T1", type: "web" };
	assert.equal(resolveCommand("/dt-quick", quick), "/dt-quick web as aligned");
	assert.equal(resolveCommand("/dt-quick fix the title", quick), "/dt-quick web fix the title");
	assert.equal(resolveCommand("/dt-quick web as aligned", quick), "/dt-quick web as aligned");
	assert.equal(resolveCommand("/dt-review", quick), "/dt-review quick");
	assert.equal(resolveCommand("/dt-review quick my-branch", quick), "/dt-review quick my-branch");
	assert.throws(() => resolveCommand("/dt-lane", quick), /needs a T2/);
	assert.throws(() => resolveCommand("/dt-quick", project), /for T0\/T1/);
});

test("resume displays slugless next steps without changing explicit CLI commands", () => {
	assert.equal(sessionCommand("/dt-lane checkout next", project.slug), "/dt-lane next");
	assert.equal(sessionCommand("Next: /dt-review checkout 00\nThen: /dt-drift checkout", project.slug), "Next: /dt-review 00\nThen: /dt-drift");
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
