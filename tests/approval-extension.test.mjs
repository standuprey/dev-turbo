import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCOPE } from "../extensions/dt-session/gates.mjs";

const pkg = process.env.PI_PACKAGE_DIR;
test("Pi runtime: plan approval, cancelled/stale proposals, revised plans and /dt-check-merged closure", { skip: !pkg }, async (t) => {
	const key = "test/repo";
	const dir = await mkdtemp(join(tmpdir(), "dt-approve-test-")), previous = process.env.DT_DIR;
	process.env.DT_DIR = dir;
	t.after(async () => { if (previous === undefined) delete process.env.DT_DIR; else process.env.DT_DIR = previous; await rm(dir, { recursive: true, force: true }); });
	// The real CLI reads feature docs from the repository's docs/features.
	const repo = { key, featuresBase: join(dir, "docs", "features") };
	execFileSync("git", ["init", "-q", dir]);
	execFileSync("git", ["remote", "add", "origin", `https://github.com/${key}.git`], { cwd: dir });
	execFileSync("git", ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"], { cwd: dir });
	await writeFile(join(dir, "config.json"), JSON.stringify({ defaults: {} }));
	await writeFile(join(dir, "dt.mjs"), `export { readFeatureStatus, pickReady } from ${JSON.stringify(new URL("../dt.mjs", import.meta.url).href)};\nexport const resolveRepo = () => (${JSON.stringify(repo)});\n`);
	const require = createRequire(join(pkg, "package.json")), { createJiti } = require("jiti");
	// Match Pi's legacy pi-ai import mapping, which also exposes TypeBox.
	const ai = join(dir, "pi-ai.mjs");
	await writeFile(ai, `export * from ${JSON.stringify(join(pkg, "../pi-ai/dist/compat.js"))};\nexport { Type } from ${JSON.stringify(require.resolve("typebox"))};\n`);
	const jiti = createJiti(join(pkg, "package.json"), { alias: { "@earendil-works/pi-coding-agent": join(pkg, "dist/index.js"), "@earendil-works/pi-tui": join(pkg, "../pi-tui/dist/index.js"), "@earendil-works/pi-ai": ai } });
	const session = await jiti.import(join(import.meta.dirname, "../extensions/dt-session/index.ts"), { default: true });
	const approve = await jiti.import(join(import.meta.dirname, "../extensions/dt-approve/index.ts"), { default: true });
	const entries = [], notices = [], messages = [], gateCalls = [], handlers = new Map(), bus = new Map(), tools = new Map();
	let command, check, confirmed = true, failGate = false, ticketPr = "OPEN", failPr = false, blockedSecond = false;
	const prChecks = [], openPrs = new Set();
	const pi = {
		on(name, fn) { const list = handlers.get(name) || []; list.push(fn); handlers.set(name, list); },
		events: { on(name, fn) { bus.set(name, fn); }, emit(name, value) { bus.get(name)?.(value); } },
		appendEntry(customType, data) { entries.push({ type: "custom", customType, data }); },
		registerTool(tool) { tools.set(tool.name, tool); }, registerMessageRenderer() {},
		registerCommand(name, definition) { if (name === "dt-check-merged") check = definition; else { assert.equal(name, "dt-approve"); command = definition; } },
		sendMessage(message) { messages.push(message); }, sendUserMessage() { throw new Error("Approvals must not start the model"); },
		async exec(cmd, args) {
			if (cmd === "gh") {
				assert.deepEqual(args.slice(-2), ["--json", "state"]);
				if (args.includes("--repo")) {
					assert.equal(args[args.indexOf("--repo") + 1], repo.key);
					prChecks.push(args[2]);
					return failPr ? { code: 1, stderr: "GitHub unavailable" } : { code: 0, stdout: JSON.stringify({ state: openPrs.has(args[2]) || (blockedSecond && args[2] === "456") ? "OPEN" : ticketPr }) };
				}
				throw new Error("Every PR check names the repository");
			}
			if (args[1] === "info") return { code: 0, stdout: JSON.stringify(repo) };
			assert.equal(args[1], "gate"); assert.equal(args[4], "approve");
			if (failGate) return { code: 1, stderr: "Simulated approval failure" };
			gateCalls.push(args);
			const option = (key) => args[args.indexOf(key) + 1], slug = args[2], number = Number(args[3]);
			const folder = join(repo.featuresBase, slug);
			if (number === 0) {
				await writeFile(join(folder, "feature.json"), JSON.stringify({ slug, tier: option("--tier"), type: option("--type") }));
				await writeFile(join(folder, "progress.json"), JSON.stringify({ gates: { G0: { state: "approved" }, G2: { state: "approved" } }, tickets: {} }));
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
	const proposal = tools.get("dt_propose_plan"), params = { slug: "demo", tier: "T2", type: "service", note: "Task scope" };
	const folder = join(repo.featuresBase, "demo"), spec = join(folder, "spec.md");
	await assert.rejects(proposal.execute("id", params, undefined, undefined, ctx), /ticket files/);
	await mkdir(join(folder, "tickets"), { recursive: true });
	await writeFile(join(folder, "tickets/00-skeleton.md"), '---\nid: "00"\ntitle: Skeleton\n---\n');
	await assert.rejects(proposal.execute("id", params, undefined, undefined, ctx), /brief/);
	await writeFile(spec, "Brief v1");
	await proposal.execute("id", params, new AbortController().signal, undefined, ctx);
	assert.equal(gateCalls.length, 0);
	assert.deepEqual((await command.getArgumentCompletions("pl")).map((i) => i.value), ["plan"]);
	confirmed = false; await command.handler("plan", ctx); assert.equal(gateCalls.length, 0);
	confirmed = true; failGate = true; await command.handler("plan", ctx); assert.equal(gateCalls.length, 0);
	assert.ok(entries.some((e) => e.customType === SCOPE && e.data));
	failGate = false;
	// Editing the plan while the dialog is open invalidates the confirmation.
	ctx.ui.confirm = async () => { await writeFile(spec, "Brief v2"); return true; };
	await command.handler("plan", ctx); assert.equal(gateCalls.length, 0);
	ctx.ui.confirm = async () => confirmed;
	await command.handler("plan", ctx);
	assert.equal(gateCalls.length, 1);
	assert.equal(gateCalls[0][3], "0");
	assert.equal(entries.filter((e) => e.customType === "dt-project").at(-1).data.slug, "demo");
	assert.equal(entries.filter((e) => e.customType === SCOPE).at(-1).data, null);
	assert.ok(messages.at(-1).content.endsWith("- `/dt-lane`"));
	const file = join(folder, "progress.json");
	const read = async () => JSON.parse(await readFile(file, "utf8")), save = (p) => writeFile(file, JSON.stringify(p));
	// A revised plan is approved with the same command; the old names still work.
	let p = await read(); p.gates.G2 = { state: "pending", note: "New building block" }; await save(p);
	assert.deepEqual((await command.getArgumentCompletions("")).map((i) => i.value), ["plan"]);
	await command.handler("slices", ctx);
	assert.equal(gateCalls.at(-1)[3], "2");
	assert.equal((await read()).gates.G2.state, "approved");
	assert.ok(messages.at(-1).content.endsWith("- `/dt-lane`"));
	const ticketGateCalls = gateCalls.length;
	p = await read(); p.tickets["00"] = { status: "review", acceptance: { state: "pending" }, verification: "Tests and staging passed", prs: [{ number: 123, state: "open" }, { number: 456, state: "open" }] }; await save(p);
	// /dt-approve no longer closes tickets; it points to /dt-check-merged.
	for (const args of ["ticket 00", "00"]) {
		await command.handler(args, ctx);
		assert.match(notices.at(-1)[0], /\/dt-check-merged/);
	}
	assert.equal(gateCalls.length, ticketGateCalls);
	assert.deepEqual((await command.getArgumentCompletions("0")).map((i) => i.value), []);
	// Re-approving a plan must not send already merged work back to code review.
	p.tickets["00"].prs = [{ number: 123, state: "merged" }, { number: 456, state: "merged" }];
	p.gates.G2 = { state: "pending" }; p.tickets["00"].acceptance = { state: "changes" }; p.next = "/dt-review 00"; await save(p);
	await command.handler("plan", ctx);
	assert.ok(messages.at(-1).content.endsWith("- `/dt-check-merged`"));
	assert.equal((await read()).tickets["00"].status, "review");
	assert.equal((await read()).tickets["00"].acceptance.state, "changes");
	// A second ticket in review keeps an open PR throughout.
	await writeFile(join(folder, "tickets/01-next.md"), '---\nid: "01"\ntitle: Next\n---\n');
	p = await read(); p.next = ""; delete p.tickets["00"].verification; p.tickets["00"].blockers = ["staging missing"];
	p.tickets["01"] = { status: "review", prs: [{ number: 777, state: "open" }] }; await save(p);
	openPrs.add("777");
	// Closure ignores stale acceptance evidence but fails closed on every live PR.
	const unchanged = await readFile(file, "utf8");
	for (const state of ["OPEN", "CLOSED", "UNKNOWN"]) {
		ticketPr = state; await check.handler("", ctx);
		assert.equal(await readFile(file, "utf8"), unchanged);
		assert.match(messages.at(-1).content, /\| 00 \| Skeleton \| #123 \w+, #456 \w+ \| waiting for merge \|/);
	}
	failPr = true; await check.handler("", ctx); assert.equal(await readFile(file, "utf8"), unchanged); failPr = false;
	assert.match(messages.at(-1).content, /#123 not checked: GitHub unavailable/);
	ticketPr = "MERGED"; blockedSecond = true; prChecks.length = 0;
	await check.handler("", ctx); assert.deepEqual(prChecks, ["123", "456", "777"]);
	assert.equal(await readFile(file, "utf8"), unchanged); blockedSecond = false;
	await check.handler("extra", ctx); assert.match(notices.at(-1)[0], /Usage: \/dt-check-merged/);
	prChecks.length = 0; await check.handler("", ctx);
	assert.deepEqual(prChecks, ["123", "456", "777"]);
	assert.equal((await read()).tickets["00"].status, "done");
	assert.equal((await read()).tickets["01"].status, "review");
	assert.match(messages.at(-1).content, /\| 00 \| Skeleton \| #123 merged, #456 merged \| \*\*closed\*\* \|/);
	assert.match(messages.at(-1).content, /\| 01 \| Next \| #777 open \| waiting for merge \|/);
	assert.ok(messages.at(-1).content.endsWith("- `/dt-review 01`"));
	openPrs.delete("777"); await check.handler("", ctx);
	assert.equal((await read()).tickets["01"].status, "done");
	assert.doesNotMatch(messages.at(-1).content, /drift/i);
	assert.ok(messages.at(-1).content.endsWith("## Next commands\nNo next command."));
	const afterDone = gateCalls.length; await check.handler("", ctx); assert.equal(gateCalls.length, afterDone);
	assert.match(messages.at(-1).content, /No open tickets have saved PRs/);
	// Run real CLI writes only after the registered tool guard allows the call.
	// The sandbox has its own Git repository and feature data; no installed state is touched.
	const agentBash = async (shell) => {
		for (const guard of handlers.get("tool_call")) {
			const result = await guard({ toolName: "bash", input: { command: shell } }, ctx);
			if (result?.block) return { isError: true, content: result.reason };
		}
		const result = spawnSync("bash", ["-c", shell], { cwd: dir, env: { ...process.env, DT_DIR: dir }, encoding: "utf8" });
		return { isError: result.status !== 0, content: result.stdout + result.stderr };
	};
	const cli = `node ${JSON.stringify(join(import.meta.dirname, "../dt.mjs"))}`;
	const beforeBlocked = await readFile(file, "utf8"), beforeMessages = messages.length;
	const blocked = await agentBash(`${cli} gate demo 2 pending --note "new module" && ${cli} gate demo 2 approve`);
	assert.equal(blocked.isError, true);
	assert.match(blocked.content, /Nothing.*persisted/);
	assert.equal(await readFile(file, "utf8"), beforeBlocked);
	assert.equal(messages.length, beforeMessages);
	const pending = await agentBash(`${cli} gate demo 2 pending --note "new module"`);
	assert.equal(pending.isError, false, pending.content);
	assert.match(pending.content, /G2 pending recorded/);
	assert.equal((await read()).gates.G2.state, "pending");
	assert.equal((await read()).next, "/dt-approve plan");
	// T0/T1 tasks are one-ticket plans with the same approvals.
	for (const tier of ["T0", "T1"]) {
		const slug = `quick-${tier.toLowerCase()}`, quickFolder = join(repo.featuresBase, slug);
		await mkdir(join(quickFolder, "tickets"), { recursive: true });
		await writeFile(join(quickFolder, "tickets/00-fix.md"), '---\nid: "00"\ntitle: Fix\n---\n');
		await writeFile(join(quickFolder, "tickets/01-extra.md"), '---\nid: "01"\ntitle: Extra\n---\n');
		await assert.rejects(proposal.execute("id", { ...params, slug, tier }, undefined, undefined, ctx), /exactly one ticket/);
		await rm(join(quickFolder, "tickets/01-extra.md"));
		await proposal.execute("id", { ...params, slug, tier }, undefined, undefined, ctx);
		const before = gateCalls.length;
		await command.handler("plan", ctx);
		assert.equal(gateCalls.length, before + 1);
		assert.equal(entries.filter((e) => e.customType === "dt-project").at(-1).data.tier, tier);
		assert.ok(messages.at(-1).content.endsWith("- `/dt-lane`"));
		const quickFile = join(quickFolder, "progress.json");
		const q = JSON.parse(await readFile(quickFile, "utf8")); q.tickets["00"] = { status: "review", prs: [{ number: 789, state: "merged" }] };
		await writeFile(quickFile, JSON.stringify(q));
		await check.handler("", ctx);
		assert.equal(JSON.parse(await readFile(quickFile, "utf8")).tickets["00"].status, "done");
		assert.ok(messages.at(-1).content.endsWith("No next command."));
	}
});
