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
	await writeFile(join(dir, "dt.mjs"), `export { readFeatureStatus, forceCloseTicket, pickReady } from ${JSON.stringify(new URL("../dt.mjs", import.meta.url).href)};\nexport const resolveRepo = () => ({ ...${JSON.stringify(repo)}, root: "/repo" });\n`);
	const require = createRequire(join(pkg, "package.json")), { createJiti } = require("jiti");
	// Match Pi's legacy pi-ai import mapping, which also exposes TypeBox.
	const ai = join(dir, "pi-ai.mjs");
	await writeFile(ai, `export * from ${JSON.stringify(join(pkg, "../pi-ai/dist/compat.js"))};\nexport { Type } from ${JSON.stringify(require.resolve("typebox"))};\n`);
	const jiti = createJiti(join(pkg, "package.json"), { alias: { "@earendil-works/pi-coding-agent": join(pkg, "dist/index.js"), "@earendil-works/pi-tui": join(pkg, "../pi-tui/dist/index.js"), "@earendil-works/pi-ai": ai } });
	const session = await jiti.import(join(import.meta.dirname, "../extensions/dt-session/index.ts"), { default: true });
	const approve = await jiti.import(join(import.meta.dirname, "../extensions/dt-approve/index.ts"), { default: true });
	const entries = [], notices = [], messages = [], gateCalls = [], starts = [], preflights = [], confirmations = [], handlers = new Map(), bus = new Map(), tools = new Map();
	let startWarnings = [], failPreflight = false;
	let command, check, close, confirmed = true, failGate = false, ticketPr = "OPEN", failPr = false, blockedSecond = false;
	const prChecks = [], openPrs = new Set();
	const pi = {
		on(name, fn) { const list = handlers.get(name) || []; list.push(fn); handlers.set(name, list); },
		events: { on(name, fn) { bus.set(name, fn); }, emit(name, value) { bus.get(name)?.(value); } },
		appendEntry(customType, data) { entries.push({ type: "custom", customType, data }); },
		registerTool(tool) { tools.set(tool.name, tool); }, registerMessageRenderer() {},
		registerCommand(name, definition) { if (name === "dt-close") close = definition; else if (name === "dt-check-merged") check = definition; else { assert.equal(name, "dt-approve"); command = definition; } },
		sendMessage(message) { messages.push(message); },
		sendUserMessage(text, options) { starts.push({ text, options }); },
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
			if (args[1] === "next") {
				assert.ok(args.includes("--check-only"));
				assert.equal(args[args.indexOf("--owner") + 1], "session");
				preflights.push(args);
				return failPreflight ? { code: 1, stderr: "Inspection unavailable" } : { code: 0, stdout: JSON.stringify({ warnings: startWarnings }) };
			}
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
	const ctx = { cwd: "/repo", mode: "print", hasUI: true, isIdle: () => true, sessionManager: { getBranch: () => entries, getSessionId: () => "session" }, ui: { confirm: async (title, body) => { confirmations.push({ title, body }); return confirmed; }, notify(...args) { notices.push(args); }, setStatus() {}, setFooter() {} } };
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
	ctx.ui.confirm = async (title, body) => { confirmations.push({ title, body }); return confirmed; };
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
	// Force closure targets an explicit ticket from any checkout and never checks PRs.
	const beforeClose = await readFile(file, "utf8");
	p = await read(); p.tickets["00"] = { status: "in_progress", claim: { owner: "other-session", checkout: "/other-checkout" }, prs: [{ number: 123, state: "open" }] }; await save(p);
	const activeBeforeClose = await readFile(file, "utf8");
	for (const args of ["", "00", "00   ", "No longer needed", "bad Stop"]) {
		await close.handler(args, ctx); assert.match(notices.at(-1)[0], /Usage: \/dt-close <ticket> <reason>/);
		assert.equal(await readFile(file, "utf8"), activeBeforeClose);
	}
	await close.handler("99 Stop", ctx); assert.match(notices.at(-1)[0], /no ticket 99/);
	assert.equal(await readFile(file, "utf8"), activeBeforeClose);
	await close.handler("01 Stop", ctx); assert.match(notices.at(-1)[0], /only active tickets/);
	assert.equal(await readFile(file, "utf8"), activeBeforeClose);
	ctx.isIdle = () => false; await close.handler("00 Stop", ctx); ctx.isIdle = () => true;
	assert.match(notices.at(-1)[0], /Finish or stop/);
	assert.equal(await readFile(file, "utf8"), activeBeforeClose);
	const beforeCloseChecks = prChecks.length, beforeCloseGates = gateCalls.length;
	await close.handler("0 No longer needed", ctx);
	assert.equal((await read()).tickets["00"].status, "done");
	assert.deepEqual((await read()).tickets["01"], p.tickets["01"]);
	assert.equal((await read()).tickets["00"].acceptance.note, "No longer needed");
	assert.equal((await read()).tickets["00"].acceptance.forced, true);
	assert.equal((await read()).tickets["00"].claim, undefined);
	assert.equal(prChecks.length, beforeCloseChecks); assert.equal(gateCalls.length, beforeCloseGates);
	assert.match(messages.at(-1).content, /Force closed ticket 00/);
	await writeFile(file, beforeClose);
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
	assert.equal(starts.length, 0, "T2 and legacy revision approvals do not start implementation");
	const runStart = async () => {
		const start = starts.at(-1);
		assert.deepEqual(start.options, { expandPromptTemplates: true });
		return handlers.get("input")[0]({ text: start.text, source: "extension" }, ctx);
	};
	// One confirmation approves and starts a T0 task; warnings still need consent.
	for (const tier of ["T0"]) {
		const slug = `quick-${tier.toLowerCase()}`, quickFolder = join(repo.featuresBase, slug);
		await mkdir(join(quickFolder, "tickets"), { recursive: true });
		await writeFile(join(quickFolder, "tickets/00-fix.md"), '---\nid: "00"\ntitle: Fix\n---\n');
		await writeFile(join(quickFolder, "tickets/01-extra.md"), '---\nid: "01"\ntitle: Extra\n---\n');
		await assert.rejects(proposal.execute("id", { ...params, slug, tier }, undefined, undefined, ctx), /exactly one ticket/);
		await rm(join(quickFolder, "tickets/01-extra.md"));
		await proposal.execute("id", { ...params, slug, tier }, undefined, undefined, ctx);
		const before = gateCalls.length, beforeStarts = starts.length, beforeConfirmations = confirmations.length;
		confirmed = false;
		await command.handler("plan", ctx);
		assert.equal(starts.length, beforeStarts, "cancelled approval must not start work");
		confirmed = true;
		const confirm = ctx.ui.confirm, ticketFile = join(quickFolder, "tickets/00-fix.md");
		ctx.ui.confirm = async (title, body) => {
			await writeFile(ticketFile, '---\nid: "00"\ntitle: Updated fix\n---\n');
			return confirm(title, body);
		};
		await command.handler("plan", ctx);
		assert.equal(gateCalls.length, before, "a new proposal must hash its own files even with an existing project selected");
		assert.equal(starts.length, beforeStarts);
		ctx.ui.confirm = confirm;
		await command.handler("plan", ctx);
		assert.equal(gateCalls.length, before + 1);
		assert.equal(entries.filter((e) => e.customType === "dt-project").at(-1).data.tier, tier);
		assert.equal(starts.length, beforeStarts + 1);
		assert.match(confirmations.at(-1).title, /Approve.*start/);
		assert.match(confirmations.at(-1).body, /current checkout/);
		assert.equal(confirmations.length, beforeConfirmations + 3);
		const beforeStartConfirmations = confirmations.length;
		assert.equal((await runStart()).text, `/dt-lane ${slug} 00`);
		assert.equal(preflights.at(-1)[2], slug);
		assert.equal(confirmations.length, beforeStartConfirmations, "clean start needs no second confirmation");
		await handlers.get("input")[0]({ text: "/dt-lane 00", source: "interactive" }, ctx);
		assert.equal(confirmations.length, beforeStartConfirmations + 1, "later resumes still confirm the ticket");
		const quickFile = join(quickFolder, "progress.json");
		const q = JSON.parse(await readFile(quickFile, "utf8")); q.tickets["00"] = { status: "review", prs: [{ number: 789, state: "merged" }] };
		await writeFile(quickFile, JSON.stringify(q));
		await check.handler("", ctx);
		assert.equal(JSON.parse(await readFile(quickFile, "utf8")).tickets["00"].status, "done");
		assert.ok(messages.at(-1).content.endsWith("No next command."));
	}
	// T1 plans have up to five tickets and start through the ticket picker, not approval.
	{
		const slug = "multi-t1", folder = join(repo.featuresBase, slug);
		await mkdir(join(folder, "tickets"), { recursive: true });
		for (const id of ["00", "01", "02", "03", "04", "05"]) await writeFile(join(folder, `tickets/${id}-part.md`), `---\nid: "${id}"\ntitle: Part ${id}\n---\n`);
		await assert.rejects(proposal.execute("id", { ...params, slug, tier: "T1" }, undefined, undefined, ctx), /at most 5 tickets/);
		await rm(join(folder, "tickets/05-part.md"));
		await proposal.execute("id", { ...params, slug, tier: "T1" }, undefined, undefined, ctx);
		const beforeStarts = starts.length;
		await command.handler("plan", ctx);
		assert.equal(entries.filter((e) => e.customType === "dt-project").at(-1).data.tier, "T1");
		assert.equal(starts.length, beforeStarts, "T1 approval does not start a ticket");
		assert.doesNotMatch(confirmations.at(-1).title, /start/);
		assert.match(messages.at(-1).content, /## Next commands/);
	}
	for (const outcome of ["cancel", "override", "failed-check", "changed-ticket"]) {
		const slug = `quick-${outcome}`, folder = join(repo.featuresBase, slug), ticket = join(folder, "tickets/00.md");
		await mkdir(join(folder, "tickets"), { recursive: true });
		await writeFile(ticket, '---\nid: "00"\ntitle: Fix\n---\n');
		await proposal.execute("id", { ...params, slug, tier: "T0" }, undefined, undefined, ctx);
		await command.handler("plan", ctx);
		startWarnings = ["Dirty checkout"];
		confirmed = outcome !== "cancel";
		failPreflight = outcome === "failed-check";
		if (outcome === "changed-ticket") await writeFile(ticket, '---\nid: "00"\ntitle: Changed\n---\n');
		const result = await runStart();
		if (outcome === "override") {
			assert.equal(result.text, `/dt-lane ${slug} 00 override`);
			assert.match(confirmations.at(-1).title, /Start anyway/);
			assert.match(confirmations.at(-1).body, /Dirty checkout/);
		} else assert.deepEqual(result, { action: "handled" });
		assert.equal(JSON.parse(await readFile(join(folder, "progress.json"), "utf8")).gates.G2.state, "approved", "a blocked start preserves approval");
		startWarnings = []; failPreflight = false; confirmed = true;
	}
});
