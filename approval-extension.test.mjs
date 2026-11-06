import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCOPE, QUICK } from "./extensions/dt-session/gates.mjs";

const pkg = process.env.PI_PACKAGE_DIR;
test("Pi runtime: explicit named approvals, cancelled/stale proposals, ticket/drift and quick gates", { skip: !pkg }, async (t) => {
	const dir = await mkdtemp(join(tmpdir(), "dt-approve-test-")), previous = process.env.DT_DIR;
	process.env.DT_DIR = dir;
	t.after(async () => { if (previous === undefined) delete process.env.DT_DIR; else process.env.DT_DIR = previous; await rm(dir, { recursive: true, force: true }); });
	const repo = { key: "test/repo", featuresBase: join(dir, "features") };
	await writeFile(join(dir, "dt.mjs"), `export { readFeatureStatus, pickReady } from ${JSON.stringify(new URL("./dt.mjs", import.meta.url).href)};\nexport const resolveRepo = () => (${JSON.stringify(repo)});\n`);
	const require = createRequire(join(pkg, "package.json")), { createJiti } = require("jiti");
	const jiti = createJiti(join(pkg, "package.json"), { alias: { "@earendil-works/pi-coding-agent": join(pkg, "dist/index.js"), "@earendil-works/pi-tui": join(pkg, "../pi-tui/dist/index.js"), "@earendil-works/pi-ai": join(pkg, "../pi-ai/dist/compat.js") } });
	const session = await jiti.import(join(import.meta.dirname, "extensions/dt-session/index.ts"), { default: true });
	const approve = await jiti.import(join(import.meta.dirname, "extensions/dt-approve/index.ts"), { default: true });
	const entries = [], notices = [], messages = [], gateCalls = [], handlers = new Map(), bus = new Map(), tools = new Map();
	let command, confirmed = true, failGate = false, quickPr = "OPEN";
	const pi = {
		on(name, fn) { const list = handlers.get(name) || []; list.push(fn); handlers.set(name, list); },
		events: { on(name, fn) { bus.set(name, fn); }, emit(name, value) { bus.get(name)?.(value); } },
		appendEntry(customType, data) { entries.push({ type: "custom", customType, data }); },
		registerTool(tool) { tools.set(tool.name, tool); }, registerMessageRenderer() {},
		registerCommand(name, definition) { assert.equal(name, "dt-approve"); command = definition; },
		sendMessage(message) { messages.push(message); }, sendUserMessage() { throw new Error("Approvals must not start the model"); },
		async exec(cmd, args) {
			if (cmd === "gh") { assert.deepEqual(args.slice(-2), ["--json", "state"]); return { code: 0, stdout: JSON.stringify({ state: quickPr }) }; }
			if (args[1] === "info") return { code: 0, stdout: JSON.stringify(repo) };
			assert.equal(args[1], "gate"); assert.equal(args[4], "approve");
			if (failGate) return { code: 1, stderr: "Simulated approval failure" };
			gateCalls.push(args);
			const option = (key) => args[args.indexOf(key) + 1], slug = args[2], number = Number(args[3]);
			const folder = join(repo.featuresBase, slug);
			if (number === 0) {
				if (option("--tier") !== "T2") return { code: 0, stdout: "Scope approved (quick task)" };
				await mkdir(folder, { recursive: true });
				await writeFile(join(folder, "feature.json"), JSON.stringify({ slug, tier: "T2", type: option("--type") }));
				await writeFile(join(folder, "progress.json"), JSON.stringify({ gates: { G0: { state: "approved" } }, tickets: {} }));
			} else {
				const progress = JSON.parse(await readFile(join(folder, "progress.json"), "utf8"));
				if (number === 3) { const ticket = progress.tickets[option("--ticket")]; ticket.status = "done"; ticket.acceptance = { state: "approved" }; }
				else progress.gates[`G${number}`] = { state: "approved", note: option("--note"), at: new Date().toISOString() };
				await writeFile(join(folder, "progress.json"), JSON.stringify(progress));
			}
			return { code: 0, stdout: "Approval recorded" };
		},
	};
	const ctx = { cwd: "/repo", mode: "print", hasUI: true, isIdle: () => true, sessionManager: { getBranch: () => entries, getSessionId: () => "session" }, ui: { confirm: async () => confirmed, notify(...args) { notices.push(args); }, setStatus() {}, setFooter() {} } };
	await session(pi); await approve(pi);
	for (const fn of handlers.get("session_start")) await fn({}, ctx);
	const proposal = tools.get("dt_propose_scope"), params = { slug: "demo", tier: "T2", type: "service", note: "Task scope" };
	await proposal.execute("id", params, new AbortController().signal, undefined, ctx);
	assert.equal(gateCalls.length, 0);
	assert.deepEqual((await command.getArgumentCompletions("sc")).map((i) => i.value), ["scope"]);
	confirmed = false; await command.handler("scope", ctx); assert.equal(gateCalls.length, 0);
	confirmed = true; failGate = true; await command.handler("scope", ctx); assert.equal(gateCalls.length, 0);
	assert.ok(entries.some((e) => e.customType === SCOPE && e.data));
	failGate = false; await command.handler("scope", ctx);
	assert.equal(gateCalls.length, 1);
	assert.equal(entries.filter((e) => e.customType === "dt-project").at(-1).data.slug, "demo");
	assert.equal(entries.filter((e) => e.customType === SCOPE).at(-1).data, null);
	assert.ok(messages.at(-1).content.endsWith("- `/dt-spec`"));
	const file = join(repo.featuresBase, "demo", "progress.json");
	const read = async () => JSON.parse(await readFile(file, "utf8")), save = (p) => writeFile(file, JSON.stringify(p));
	let p = await read(); p.gates.G1 = { state: "pending" }; await save(p);
	assert.deepEqual((await command.getArgumentCompletions("")).map((i) => i.value), ["architecture"]);
	await command.handler("architecture", ctx); assert.ok(messages.at(-1).content.endsWith("- `/dt-slice`"));
	p = await read(); p.gates.G2 = { state: "pending" }; await save(p);
	const spec = join(repo.featuresBase, "demo", "spec.md"); await writeFile(spec, "Design v1");
	const before = gateCalls.length;
	ctx.ui.confirm = async () => { await writeFile(spec, "Design v2"); return true; };
	await command.handler("slices", ctx); assert.equal(gateCalls.length, before); assert.equal((await read()).gates.G2.state, "pending");
	ctx.ui.confirm = async () => true;
	await command.handler("slices", ctx);
	await mkdir(join(repo.featuresBase, "demo", "tickets"));
	await writeFile(join(repo.featuresBase, "demo", "tickets/00-skeleton.md"), '---\nid: "00"\ntitle: Skeleton\n---\n');
	p = await read(); p.tickets["00"] = { status: "review", acceptance: { state: "pending" }, verification: "Tests and staging passed", prs: [{ state: "open" }] }; await save(p);
	await command.handler("ticket 00", ctx); assert.equal((await read()).tickets["00"].status, "review");
	p.tickets["00"].prs[0].state = "merged"; await save(p);
	// Reconfirming slices must not send already merged work back to code review.
	p.gates.G2 = { state: "pending" }; p.tickets["00"].acceptance = { state: "changes" }; p.next = "/dt-review 00"; await save(p);
	await command.handler("slices", ctx);
	assert.ok(messages.at(-1).content.endsWith("- `/dt-final-check 00`"));
	assert.equal((await read()).tickets["00"].status, "review");
	assert.equal((await read()).tickets["00"].acceptance.state, "changes");
	p = await read(); p.tickets["00"].acceptance = { state: "pending" }; p.next = ""; await save(p);
	assert.deepEqual((await command.getArgumentCompletions("ticket ")).map((i) => i.value), ["ticket 00"]);
	await command.handler("ticket 00", ctx); assert.equal((await read()).tickets["00"].status, "done");
	p = await read(); p.gates.G4 = { state: "pending", note: "2 findings" }; p.todo = ["drift 1: issue -> spec", "drift 2: issue -> accept"]; await save(p);
	ctx.ui.select = async () => undefined;
	await command.handler("drift", ctx); assert.equal((await read()).gates.G4.state, "pending");
	ctx.ui.select = async (title) => title.includes("finding 1:") ? "spec" : "accept";
	await command.handler("drift", ctx); assert.equal((await read()).gates.G4.note, "1:spec 2:accept");
	assert.ok(messages.at(-1).content.endsWith("- `/dt-drift apply`"));
	// Quick tasks share named gates, but have no ticket-folder or numeric acceptance CLI.
	await proposal.execute("id", { ...params, slug: "quick-task", tier: "T1" }, new AbortController().signal, undefined, ctx);
	await command.handler("scope", ctx);
	const quick = tools.get("dt_propose_quick_gate");
	await quick.execute("id", { gate: "slices", note: "Scenario plan" }, undefined, undefined, ctx);
	await command.handler("slices", ctx); assert.ok(messages.at(-1).content.endsWith("- `/dt-quick`"));
	await quick.execute("id", { gate: "ticket", note: "Quick verification", branch: "quick/test" }, undefined, undefined, ctx);
	await command.handler("ticket", ctx); assert.equal(entries.filter((e) => e.customType === QUICK).at(-1).data.state, "pending");
	quickPr = "MERGED"; await command.handler("ticket", ctx);
	assert.equal(entries.filter((e) => e.customType === QUICK).at(-1).data.state, "approved");
	assert.ok(messages.at(-1).content.endsWith("- `/dt-status`"));
});
