/** Named, explicit human approvals. Never invokes the model or merges a PR. */
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { readFile, mkdir, rmdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { getMarkdownTheme, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Box, Markdown } from "@earendil-works/pi-tui";
import { createModuleLoader } from "../dt-session/runtime.ts";

export default async function (pi: ExtensionAPI) {
	const load = createModuleLoader(import.meta.url);
	const { ENTRY, restoreProject } = await load("../dt-session/state.mjs");
	const { SCOPE, QUICK, NAMES, scopeProposal, pendingGates, findings, approvalPlan, approvalCompletions, nextCommands } = await load("../dt-session/gates.mjs");
	const dt = join(process.env.DT_DIR || join(homedir(), ".pi", "agent", "dt"), "dt.mjs");
	let currentCtx: ExtensionContext | undefined;
	let busy = false;
	pi.on("session_start", (_event, ctx) => { currentCtx = ctx; });
	pi.on("session_tree", (_event, ctx) => { currentCtx = ctx; });
	const view = async (ctx: ExtensionContext, withRevision = false) => {
		const logic = await load(pathToFileURL(dt).href);
		const repo = logic.resolveRepo(ctx.cwd), branch = ctx.sessionManager.getBranch();
		const project = restoreProject(branch, repo), scope = scopeProposal(branch, repo);
		const snapshot = project?.tier === "T2" ? logic.readFeatureStatus(repo, project.slug) : null;
		let revision;
		if (withRevision) {
			const files = snapshot ? [snapshot.p.feature, snapshot.p.progress, snapshot.p.spec, ...snapshot.tickets.map((t: { file: string }) => t.file)] : [];
			const contents = await Promise.all(files.map(async (file: string) => { try { return await readFile(file, "utf8"); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return "missing"; throw e; } }));
			revision = createHash("sha256").update(JSON.stringify({ scope, project, contents })).digest("hex");
		}
		return { logic, repo, branch, project, scope, snapshot, revision, existingScope: scope ? existsSync(join(repo.featuresBase, scope.slug, "feature.json")) : false };
	};
	const exec = async (command: string, args: string[], ctx: ExtensionContext) => {
		const r = await pi.exec(command, args, { cwd: ctx.cwd, timeout: 120000 });
		if (r.code !== 0) throw new Error(([r.stdout, r.stderr].filter(Boolean).join("\n") || `${command} failed`).trim());
		return r.stdout;
	};
	pi.registerMessageRenderer("dt-approve", (msg, { outputPad }, theme) => {
		const box = new Box(outputPad, 1, (t) => theme.bg("customMessageBg", t));
		box.addChild(new Markdown(String(msg.content), 0, 0, getMarkdownTheme()));
		return box;
	});
	pi.registerCommand("dt-approve", {
		description: "Close a merged ticket: <id>; approve scope, architecture, slices or drift",
		getArgumentCompletions: async (prefix) => {
			if (!currentCtx) return null;
			try { return approvalCompletions(await view(currentCtx), prefix); } catch { return null; }
		},
		handler: async (args, ctx) => {
			currentCtx = ctx;
			if (busy || !ctx.isIdle()) { ctx.ui.notify("Finish the current task before approving a gate.", "warning"); return; }
			busy = true;
			let applied = false;
			let lock: string | undefined;
			try {
				if (!ctx.hasUI) throw new Error("A dialog-capable UI is required for human gate approval.");
				const initial = await view(ctx, true);
				let [name, ...rest] = args.trim().split(/\s+/);
				if (/^\d{1,2}$/.test(name)) { rest.unshift(name); name = "ticket"; }
				const session = ctx.sessionManager.getSessionId();
				if (name === "drift" && !rest.length && pendingGates(initial).includes("drift")) {
					for (const id of findings(initial.snapshot)) {
						const saved = initial.snapshot.prog.todo.find((n: string) => n.toLowerCase().startsWith(`drift ${id}:`));
						const choice = await ctx.ui.select(`Drift finding ${id}: ${saved || "see the drift card"}`, ["code", "spec", "accept"]);
						if (!choice) return;
						rest.push(`${id}:${choice}`);
					}
				}
				const plan = approvalPlan(initial, name, rest);
				const title = plan.ticket ? `Ticket closure ${plan.ticket}` : NAMES[name].label;
				const extra = name === "scope" ? `\nConfirm project name: ${plan.slug}\n${plan.tier} · ${plan.type}` : name === "ticket" ? "\nClose this ticket after checking every saved PR is merged on GitHub. No acceptance checks, code review or rebuild. This never merges PRs." : name === "drift" ? `\nDecisions: ${plan.note}` : "";
				const summary = name === "scope" ? plan.note : plan.quick ? plan.quick.note || "Review the quick-task proposal." : (name === "ticket" ? [initial.snapshot.prog.tickets[plan.ticket]?.verification, ...(initial.snapshot.prog.tickets[plan.ticket]?.todo || [])].filter(Boolean).join("\nChecklist: ") : initial.snapshot.prog.gates[`G${plan.id}`]?.note) || "Review the saved proposal before confirming.";
				if (!await ctx.ui.confirm(`Approve ${title}?`, `${plan.slug}${extra}\n${summary}`)) return;
				if (currentCtx?.sessionManager.getSessionId() !== session) throw new Error("Session changed while confirming. No approval was applied.");
				const lockRoot = join(process.env.DT_DIR || join(homedir(), ".pi", "agent", "dt"), "approval-locks");
				await mkdir(lockRoot, { recursive: true });
				const candidate = join(lockRoot, createHash("sha256").update(JSON.stringify([initial.repo.key, initial.repo.featuresBase, plan.slug])).digest("hex"));
				try { await mkdir(candidate); lock = candidate; }
				catch (e) { if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`Another approval holds ${candidate}. Retry when it finishes; remove a stale lock only after checking no approval is running.`); throw e; }
				const fresh = await view(ctx, true);
				const checked = approvalPlan(fresh, name, rest);
				if (JSON.stringify(checked) !== JSON.stringify(plan)) throw new Error("The pending gate changed while confirming. Review it and approve again.");
				if (plan.quick) {
					if (name === "ticket") {
						if (!plan.quick.branch || plan.quick.branch.startsWith("-")) throw new Error("No valid quick PR branch is saved. Run /dt-review first.");
						const pr = JSON.parse(await exec("gh", ["pr", "view", plan.quick.branch, "--json", "state"], ctx));
						if (pr.state !== "MERGED") throw new Error("Merge the quick PR yourself before accepting it.");
					}
					pi.appendEntry(QUICK, { ...plan.quick, state: "approved" });
					applied = true;
				} else {
					if (plan.ticket) {
						for (const saved of fresh.snapshot.prog.tickets[plan.ticket].prs) {
							const url = String(saved.url || "").match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/([1-9]\d*)$/);
							if (url && url[1].toLowerCase() !== fresh.repo.key.toLowerCase()) throw new Error("A saved PR belongs to another repository. Correct the PR reference before closing the ticket.");
							const ref = saved.number || url?.[2];
							if (!ref || !/^[1-9]\d*$/.test(String(ref))) throw new Error("A saved PR has no valid number or GitHub URL. Save its PR reference before closing the ticket.");
							const pr = JSON.parse(await exec("gh", ["pr", "view", String(ref), "--repo", fresh.repo.key, "--json", "state"], ctx));
							if (pr.state !== "MERGED") throw new Error(`PR ${ref} is not merged. Merge every ticket PR yourself before closing ${plan.ticket}.`);
						}
						const latest = await view(ctx, true);
						if (latest.revision !== fresh.revision) throw new Error("The ticket changed during merge checks. Retry; no completion was recorded.");
					}
					const options = ["--note", plan.note];
					if (name === "scope") options.push("--tier", plan.tier, "--type", plan.type);
					if (plan.ticket) options.push("--ticket", plan.ticket);
					await exec("node", [dt, "gate", plan.slug, String(plan.id), "approve", ...options], ctx);
					applied = true;
					if (name === "scope") {
						const project = { slug: plan.slug, tier: plan.tier, type: plan.type, key: fresh.repo.key, base: fresh.repo.featuresBase, scopeId: randomUUID() };
						pi.appendEntry(ENTRY, project);
						pi.appendEntry(SCOPE, null);
						pi.events.emit("dt:project:select", { project, repo: fresh.repo, ctx });
					}
				}
				const updated = await view(ctx);
				pi.sendMessage({ customType: "dt-approve", display: true, details: { gate: name, ticket: plan.ticket }, content: `## Approved: ${title}\n\nProject: ${plan.slug}\n\n## Next commands\n${nextCommands(updated, updated.logic).map((c) => `- \`${c}\``).join("\n")}` });
			} catch (e) { ctx.ui.notify(`dt-approve: ${applied ? "Approval was recorded, but a follow-up failed: " : ""}${e instanceof Error ? e.message : String(e)}`, "error"); }
			finally {
				if (lock) { try { await rmdir(lock); } catch { ctx.ui.notify(`Approval lock could not be removed: ${lock}`, "warning"); } }
				busy = false;
			}
		},
	});
}
