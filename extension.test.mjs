// Optional runtime integration tests: PI_PACKAGE_DIR=<installed pi package> node --test extension.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProjectFooter } from "./extensions/dt-session/footer.mjs";

const piPackage = process.env.PI_PACKAGE_DIR;

test("Pi runtime: confirmation, persistence, defaults, resume and safe failures", { skip: !piPackage }, async (t) => {
	const dir = await mkdtemp(join(tmpdir(), "dt-session-runtime-"));
	const previous = process.env.DT_DIR;
	process.env.DT_DIR = dir;
	t.after(async () => { if (previous === undefined) delete process.env.DT_DIR; else process.env.DT_DIR = previous; await rm(dir, { recursive: true, force: true }); });
	const require = createRequire(join(piPackage, "package.json"));
	const { createJiti } = require("jiti");
	const jiti = createJiti(join(piPackage, "package.json"), { alias: {
		"@earendil-works/pi-coding-agent": join(piPackage, "dist/index.js"),
		"@earendil-works/pi-tui": join(piPackage, "../pi-tui/dist/index.js"),
		"@earendil-works/pi-ai": join(piPackage, "../pi-ai/dist/compat.js"),
	} });
	const session = await jiti.import(join(import.meta.dirname, "extensions/dt-session/index.ts"), { default: true });
	const resume = await jiti.import(join(import.meta.dirname, "extensions/dt-resume.ts"), { default: true });
	const repo = { key: "org/repo", featuresBase: join(dir, "features") };
	await mkdir(join(repo.featuresBase, "catalog"), { recursive: true });
	await writeFile(join(repo.featuresBase, "catalog", "feature.json"), JSON.stringify({ slug: "catalog", tier: "T2", type: "web" }));
	let entries = [];
	let confirmed = true;
	let gateFailure = false;
	let resumeFailure = false;
	let localResumeFailure = false;
	let sessionId = "one";
	const notices = [], messages = [], calls = [];
	const handlers = new Map(), eventHandlers = new Map(), tools = new Map(), commands = new Map();
	const pi = {
		on(event, fn) { handlers.set(event, fn); },
		events: { on(name, fn) { eventHandlers.set(name, fn); }, emit(name, request) { eventHandlers.get(name)?.(request); } },
		appendEntry(customType, data) { entries.push({ type: "custom", customType, data }); },
		registerTool(tool) { tools.set(tool.name, tool); },
		registerCommand(name, command) { commands.set(name, command); },
		registerMessageRenderer() {},
		sendMessage(message) { messages.push(message); },
		sendUserMessage() { throw new Error("Non-UI resume must not start work"); },
		getThinkingLevel() { return "high"; },
		async exec(command, args, options) {
			calls.push({ command, args, options });
			if (args[1] === "info") return { code: 0, stdout: JSON.stringify(repo) };
			if (args[1] === "progress") return { code: 0, stdout: "released" };
			if (args[1] === "gate") return gateFailure ? { code: 1, stderr: "Gate 0 failed" } : { code: 0, stdout: "G0 approved" };
			if (args[1] === "resume") {
				if (localResumeFailure && args.includes("--no-gh")) return { code: 1, stderr: "Local state unreadable" };
				if (resumeFailure && args[2] !== "--json" && !args.includes("--no-gh")) return { code: 1, stderr: "Refresh failed" };
				if (args[2] === "--json") return { code: 0, stdout: JSON.stringify([{ slug: "catalog", label: "catalog" }]) };
				return { code: 0, stdout: JSON.stringify({ slug: "catalog", brief: "Next: /dt-lane catalog next", next: "/dt-lane catalog next", suggested: "/dt-lane catalog next", instructions: "Continue" }) };
			}
			throw new Error("Unexpected exec");
		},
	};
	const ctx = {
		mode: "print", hasUI: true, cwd: "/repo", isIdle: () => true,
		sessionManager: { getBranch: () => entries, getSessionId: () => sessionId },
		ui: { async confirm() { return confirmed; }, notify(...args) { notices.push(args); }, setStatus() {}, setFooter() {} },
	};
	const selected = () => { const request = { project: null }; pi.events.emit("dt:project:get", request); return request.project; };
	await session(pi); await resume(pi);
	await handlers.get("session_start")({}, ctx);
	assert.equal(selected(), null);
	const input = (text) => handlers.get("input")({ text, source: "interactive" }, ctx);
	assert.equal((await input("/dt-lane")).action, "handled");
	assert.equal(calls.filter((c) => c.args[1] === "gate").length, 0);
	const tool = tools.get("dt_propose_scope");
	const params = { slug: "checkout", tier: "T2", type: "service", note: "Checkout feature" };
	const signal = new AbortController().signal;
	await tool.execute("id", params, signal, undefined, ctx);
	assert.equal(selected(), null); // Proposals never approve or select.
	assert.equal(calls.filter((c) => c.args[1] === "gate").length, 0);
	pi.appendEntry("dt-project", { ...params, key: repo.key, base: repo.featuresBase });
	assert.equal(selected().slug, "checkout");
	assert.equal((await input("/dt-lane 00")).text, "/dt-lane checkout 00");
	assert.equal((await input("/dt-lane 00 force")).text, "/dt-lane checkout 00 force");
	assert.match(handlers.get("before_agent_start")({}, ctx).message.content, /Lane claim owner for this session: one/);
	await handlers.get("session_shutdown")({}, ctx);
	assert.ok(calls.some((c) => c.args.join(" ").includes("progress checkout --release-claim --owner one")));
	assert.equal((await input("/dt-spec")).text, "/dt-spec checkout service");
	// Reopening/reloading/forking restores the active branch's selection.
	await handlers.get("session_start")({ reason: "reload" }, ctx);
	assert.equal(selected().slug, "checkout");
	const saved = [...entries];
	entries = []; sessionId = "new";
	await handlers.get("session_start")({ reason: "new" }, ctx);
	assert.equal(selected(), null);
	entries = [...saved]; sessionId = "fork";
	await handlers.get("session_start")({ reason: "fork" }, ctx);
	assert.equal(selected().slug, "checkout");
	// Invalid/unreadable local features preserve the old selection.
	ctx.hasUI = false;
	localResumeFailure = true;
	await commands.get("dt-resume").handler("catalog", ctx);
	assert.equal(selected().slug, "checkout");
	localResumeFailure = false;
	// Valid local selection survives a failed remote refresh and a missing event listener.
	const selectionListener = eventHandlers.get("dt:project:select");
	eventHandlers.delete("dt:project:select");
	resumeFailure = true;
	await commands.get("dt-resume").handler("catalog", ctx);
	assert.equal((await input("/dt-lane")).action, "handled");
	assert.equal(selected().slug, "catalog");
	assert.ok(messages.at(-1).content.startsWith("Next: /dt-lane"));
	assert.ok(notices.some(([message]) => message.includes("remote refresh failed")));
	assert.ok(handlers.get("before_agent_start")({}, ctx).message.content.includes("Selected dev-turbo project: catalog"));
	eventHandlers.set("dt:project:select", selectionListener);
	resumeFailure = false;
	await commands.get("dt-resume").handler("catalog", ctx);
	assert.equal((await input("/dt-lane checkout next")).action, "handled");
	assert.equal((await input("/dt-lane")).action, "handled");
	// UI resume keeps feature selection but never offers actions or changes the editor.
	ctx.hasUI = true;
	const selections = [];
	ctx.ui.select = async (title, labels) => {
		selections.push(title);
		assert.equal(title, "Resume which feature?");
		return labels[0];
	};
	ctx.ui.setEditorText = () => { throw new Error("Resume must not change the editor"); };
	await commands.get("dt-resume").handler("catalog", ctx);
	assert.deepEqual(selections, []);
	assert.ok(messages.at(-1).content.includes("## Next commands\n- `/dt-status`"));
	await commands.get("dt-resume").handler("", ctx);
	assert.deepEqual(selections, ["Resume which feature?"]);
	assert.equal(selected().slug, "catalog");
	// Tree navigation restores the selection at that point, not the latest entry anywhere.
	entries = saved;
	handlers.get("session_tree")({}, ctx);
	assert.equal(selected().slug, "checkout");
	await input("/dt-grill a different project");
	assert.equal(selected(), null);
	assert.equal((await input("/dt-review")).action, "handled");
	assert.ok(notices.length);
	const guard = handlers.get("tool_call");
	assert.ok(guard({ toolName: "bash", input: { command: "node dt.mjs gate checkout 1 approve" } }).block);
	assert.equal(guard({ toolName: "bash", input: { command: "node dt.mjs gate checkout 1 pending" } }), undefined);
	// Exercise footer sizing using real Pi ANSI/Unicode width utilities.
	const format = await import(join(piPackage, "../pi-tui/dist/index.js"));
	Object.assign(ctx.sessionManager, { getLeafId: () => "leaf", getEntryCount: () => 0, getEntries: () => [], getCwd: () => "/repo", getSessionName: () => undefined });
	ctx.getContextUsage = () => undefined;
	ctx.model = { id: "test-model", contextWindow: 200000 };
	ctx.modelRegistry = { isUsingOAuth: () => false };
	const data = { onBranchChange: () => () => {}, getGitBranch: () => "master", getAvailableProviderCount: () => 1, getExtensionStatuses: () => new Map() };
	const footer = createProjectFooter(ctx, pi, { fg: (_, value) => `\x1b[36m${value}\x1b[0m` }, data, { requestRender() {} }, () => ({ slug: "checkout" }), format);
	for (const width of [1, 8, 20, 80]) assert.ok(footer.render(width).every((line) => format.visibleWidth(line) <= width));
	footer.dispose();
});

test("Pi runtime: /dt-status reads the selected folder without a prompt or event handoff", { skip: !piPackage }, async (t) => {
	const dir = await mkdtemp(join(tmpdir(), "dt-status-runtime-"));
	const previous = process.env.DT_DIR;
	process.env.DT_DIR = dir;
	t.after(async () => { if (previous === undefined) delete process.env.DT_DIR; else process.env.DT_DIR = previous; await rm(dir, { recursive: true, force: true }); });
	const base = join(dir, "features");
	const repo = { key: "test/repo", featuresBase: base };
	const feature = { slug: "demo", tier: "T2", type: "service" };
	await mkdir(join(base, "demo", "tickets"), { recursive: true });
	await writeFile(join(base, "demo", "feature.json"), JSON.stringify(feature));
	const progress = JSON.stringify({ gates: { G1: { state: "approved" }, G2: { state: "approved" } }, tickets: { "00": { status: "done", verification: "tests passed" } }, next: "Run acceptance checks" });
	await writeFile(join(base, "demo", "progress.json"), progress);
	await writeFile(join(base, "demo", "tickets/00-skeleton.md"), '---\nid: "00"\ntitle: Skeleton\n---\n');
	await writeFile(join(dir, "dt.mjs"), `export { readFeatureStatus, pickReady } from ${JSON.stringify(new URL("./dt.mjs", import.meta.url).href)};\nexport const resolveRepo = () => (${JSON.stringify(repo)});\n`);
	const require = createRequire(join(piPackage, "package.json"));
	const { createJiti } = require("jiti");
	const jiti = createJiti(join(piPackage, "package.json"), { alias: { "@earendil-works/pi-coding-agent": join(piPackage, "dist/index.js"), "@earendil-works/pi-tui": join(piPackage, "../pi-tui/dist/index.js") } });
	const status = await jiti.import(join(import.meta.dirname, "extensions/dt-status/index.ts"), { default: true });
	let command;
	const notices = [], messages = [];
	await status({ registerMessageRenderer() {}, registerCommand(name, definition) { assert.equal(name, "dt-status"); command = definition; }, sendMessage(message) { messages.push(message); }, sendUserMessage() { throw new Error("must not call model"); }, exec() { throw new Error("must not call CLI actions"); }, events: { emit() { throw new Error("must not depend on event handoff"); } } });
	let branch = [];
	const ctx = { cwd: "/repo", sessionManager: { getBranch: () => branch }, ui: { notify(...args) { notices.push(args); } } };
	await command.handler("", ctx);
	assert.equal(messages.length, 0);
	assert.ok(notices.at(-1)[0].includes("No dev-turbo project selected"));
	branch = [{ type: "custom", customType: "dt-project", data: { ...feature, key: repo.key, base } }];
	await command.handler("other-slug", ctx);
	assert.equal(messages.length, 0);
	assert.ok(notices.at(-1)[0].includes("Usage: /dt-status"));
	await command.handler("", ctx);
	assert.equal(messages.length, 1);
	assert.equal(messages[0].customType, "dt-status");
	assert.ok(messages[0].content.includes("1/1 accepted"));
	assert.ok(messages[0].content.includes("Run acceptance checks"));
	assert.ok(messages[0].content.includes("tests passed"));
	assert.equal(await readFile(join(base, "demo", "progress.json"), "utf8"), progress);
});
