/** Plan approval, single-ticket startup and merge-based ticket closure. Never merges a PR. */
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { readFile, readdir, mkdir, rmdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { getMarkdownTheme, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Box, Markdown } from "@earendil-works/pi-tui";
import { createModuleLoader } from "../dt-session/runtime.ts";

export default async function (pi: ExtensionAPI) {
	const load = createModuleLoader(import.meta.url);
	const { ENTRY, restoreProject } = await load("../dt-session/state.mjs");
	const { SCOPE, NAMES, closable, scopeProposal, approvalPlan, approvalCompletions, nextCommands, nextCommandText } = await load("../dt-session/gates.mjs");
	const dt = join(process.env.DT_DIR || join(homedir(), ".pi", "agent", "dt"), "dt.mjs");
	let currentCtx: ExtensionContext | undefined;
	let busy = false;
	pi.on("session_start", (_event, ctx) => { currentCtx = ctx; });
	pi.on("session_tree", (_event, ctx) => { currentCtx = ctx; });
	const view = async (ctx: ExtensionContext, withRevision = false) => {
		const logic = await load(pathToFileURL(dt).href);
		const repo = logic.resolveRepo(ctx.cwd), branch = ctx.sessionManager.getBranch();
		const project = restoreProject(branch, repo), scope = scopeProposal(branch, repo);
		const scopeFeature = scope && existsSync(join(repo.featuresBase, scope.slug, "feature.json")) ? JSON.parse(await readFile(join(repo.featuresBase, scope.slug, "feature.json"), "utf8")) : null;
		const snapshot = project ? logic.readFeatureStatus(repo, project.slug) : null;
		let revision, quickTicketContent;
		if (withRevision) {
			// A pending plan's files are hashed too, so edits during confirmation are caught.
			const planDir = scope ? join(repo.featuresBase, scope.slug) : null;
			const planFiles = planDir ? [join(planDir, "spec.md"), ...(existsSync(join(planDir, "tickets")) ? (await readdir(join(planDir, "tickets"))).filter((f) => f.endsWith(".md")).sort().map((f) => join(planDir, "tickets", f)) : [])] : [];
			const files = scope ? planFiles : snapshot ? [snapshot.p.feature, snapshot.p.progress, snapshot.p.spec, ...snapshot.tickets.map((t: { file: string }) => t.file)] : [];
			const contents = await Promise.all(files.map(async (file: string) => { try { return await readFile(file, "utf8"); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return "missing"; throw e; } }));
			if (scope?.tier === "T0") quickTicketContent = contents[files.findIndex((file: string) => file.includes(`${join(planDir!, "tickets")}/`))];
			revision = createHash("sha256").update(JSON.stringify({ scope, project, contents })).digest("hex");
		}
		return { logic, repo, branch, project, scope, snapshot, revision, quickTicketContent, existingScope: Boolean(scopeFeature) };
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
	const acquireLock = async (repo: { key: string; featuresBase: string }, slug: string) => {
		const lockRoot = join(process.env.DT_DIR || join(homedir(), ".pi", "agent", "dt"), "approval-locks");
		await mkdir(lockRoot, { recursive: true });
		const candidate = join(lockRoot, createHash("sha256").update(JSON.stringify([repo.key, repo.featuresBase, slug])).digest("hex"));
		try { await mkdir(candidate); return candidate; }
		catch (e) { if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`Another approval holds ${candidate}. Retry when it finishes; remove a stale lock only after checking no approval is running.`); throw e; }
	};
	const releaseLock = async (lock: string | undefined, ctx: ExtensionContext) => {
		if (lock) { try { await rmdir(lock); } catch { ctx.ui.notify(`Approval lock could not be removed: ${lock}`, "warning"); } }
	};
	pi.registerCommand("dt-approve", {
		description: "Approve a plan; also start ticket 00 for a new T0 project",
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
				const [name, ...rest] = args.trim().split(/\s+/);
				const session = ctx.sessionManager.getSessionId();
				const plan = approvalPlan(initial, name, rest);
				const title = NAMES[plan.name].label;
				const startQuick = plan.id === 0 && plan.tier === "T0";
				const startNote = startQuick ? "\nApproval also starts ticket 00 on the current branch of the current checkout, without committing. Start warnings require a separate decision." : "";
				const extra = plan.id === 0 ? `\nConfirm project name: ${plan.slug}\n${plan.tier} · ${plan.type}` : "";
				const summary = (plan.id === 0 ? plan.note : initial.snapshot.prog.gates.G2?.note) || "Review the saved plan before confirming.";
				if (!await ctx.ui.confirm(`Approve ${title}${startQuick ? " and start ticket 00" : ""}?`, `${plan.slug}${extra}\n${summary}${startNote}`)) return;
				if (currentCtx?.sessionManager.getSessionId() !== session) throw new Error("Session changed while confirming. No approval was applied.");
				lock = await acquireLock(initial.repo, plan.slug);
				const fresh = await view(ctx, true);
				const checked = approvalPlan(fresh, name, rest);
				if (JSON.stringify(checked) !== JSON.stringify(plan)) throw new Error("The pending gate changed while confirming. Review it and approve again.");
				const options = ["--note", plan.note];
				if (plan.id === 0) options.push("--tier", plan.tier, "--type", plan.type);
				await exec("node", [dt, "gate", plan.slug, String(plan.id), "approve", ...options], ctx);
				applied = true;
				if (plan.id === 0) {
					const project = { slug: plan.slug, tier: plan.tier, type: plan.type, key: fresh.repo.key, base: fresh.repo.featuresBase, scopeId: randomUUID() };
					pi.appendEntry(ENTRY, project);
					pi.appendEntry(SCOPE, null);
					pi.events.emit("dt:project:select", { project, repo: fresh.repo, ctx });
				}
				const updated = await view(ctx);
				pi.sendMessage({ customType: "dt-approve", display: true, details: { gate: plan.name }, content: `## Approved: ${title}\n\nProject: ${plan.slug}\n\n${startQuick ? "Starting ticket 00 after checking repository, claims and start warnings. If blocked, approval is retained; retry with /dt-lane 00." : `## Next commands\n${nextCommandText(nextCommands(updated, updated.logic))}`}` });
				if (startQuick) {
					const request = { project: updated.project, ctx, ticketContent: initial.quickTicketContent, accepted: false };
					pi.events.emit("dt:lane:approved", request);
					if (!request.accepted) throw new Error("Ticket startup is unavailable. Run /dt-lane 00 after loading the session extension.");
					pi.sendUserMessage("/dt-lane 00", { expandPromptTemplates: true });
				}
			} catch (e) { ctx.ui.notify(`dt-approve: ${applied ? "Approval was recorded, but a follow-up failed: " : ""}${e instanceof Error ? e.message : String(e)}`, "error"); }
			finally {
				await releaseLock(lock, ctx);
				busy = false;
			}
		},
	});

	pi.registerCommand("dt-close", {
		description: "Force close an active ticket: /dt-close <ticket> <reason>",
		handler: async (args, ctx) => {
			currentCtx = ctx;
			const match = args.trim().match(/^(\d{1,2})\s+(\S[\s\S]*)$/);
			if (!match) { ctx.ui.notify("Usage: /dt-close <ticket> <reason>", "warning"); return; }
			const id = match[1].padStart(2, "0"), reason = match[2];
			if (busy || !ctx.isIdle()) { ctx.ui.notify("Finish or stop the current task before closing its ticket.", "warning"); return; }
			busy = true;
			const session = ctx.sessionManager.getSessionId();
			try {
				const { logic, repo, project, snapshot } = await view(ctx);
				if (currentCtx?.sessionManager.getSessionId() !== session || JSON.stringify(restoreProject(ctx.sessionManager.getBranch(), repo)) !== JSON.stringify(project)) throw new Error("Session or project changed. Run /dt-close again.");
				if (!project || !snapshot) throw new Error("No dev-turbo project selected. Run /dt-resume [slug].");
				logic.forceCloseTicket(repo, project.slug, id, reason);
				pi.sendMessage({ customType: "dt-approve", display: true, details: { gate: "close", ticket: id },
					content: `Force closed ticket ${id}: ${reason.replace(/[\\`*_\[\]<>]/g, "\\$&")}

Claim released; files, branches, PRs and issues retained. No merge or test checks ran; dependent tickets may now start. Other agents are not stopped.` });
			} catch (e) { ctx.ui.notify(`dt-close: ${e instanceof Error ? e.message : String(e)}`, "error"); }
			finally { busy = false; }
		},
	});

	// Merging a PR is the human decision; this command only records it after checking GitHub.
	const prRef = (saved: { number?: number; url?: string }, repoKey: string) => {
		const url = String(saved.url || "").match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/([1-9]\d*)$/);
		if (url && url[1].toLowerCase() !== repoKey.toLowerCase()) throw new Error("belongs to another repository");
		const ref = saved.number || url?.[2];
		if (!ref || !/^[1-9]\d*$/.test(String(ref))) throw new Error("has no valid number or GitHub URL");
		return String(ref);
	};
	pi.registerCommand("dt-check-merged", {
		description: "Check ticket PRs on GitHub and close every ticket whose PRs are all merged",
		handler: async (args, ctx) => {
			currentCtx = ctx;
			if (args.trim()) { ctx.ui.notify("Usage: /dt-check-merged", "warning"); return; }
			if (busy || !ctx.isIdle()) { ctx.ui.notify("Finish the current task before checking merges.", "warning"); return; }
			busy = true;
			let lock: string | undefined;
			try {
				const initial = await view(ctx);
				if (!initial.project || !initial.snapshot) throw new Error("No dev-turbo project selected. Run /dt-resume [slug].");
				const { project } = initial;
				lock = await acquireLock(initial.repo, project.slug);
				const fresh = await view(ctx);
				const candidates = closable(fresh.snapshot);
				if (!candidates.length) {
					pi.sendMessage({ customType: "dt-approve", display: true, details: { gate: "check-merged" }, content: `## Merge check\n\n${fresh.snapshot.tickets.some((t: { id: string }) => fresh.snapshot.prog.tickets[t.id]?.reopened) ? "Reopened tickets need a fresh PR before merge-based closure; previously merged PRs are retained, not reused as new acceptance." : "No open tickets have saved PRs."}\n\n## Next commands\n${nextCommandText(nextCommands(fresh, fresh.logic))}` });
					return;
				}
				const rows: string[] = [];
				for (const t of candidates as { id: string; title: string }[]) {
					const saved = fresh.snapshot.prog.tickets[t.id];
					const states: string[] = [];
					let allMerged = true;
					for (const pr of saved.prs) {
						let label: string;
						try {
							const ref = prRef(pr, fresh.repo.key);
							const state = String(JSON.parse(await exec("gh", ["pr", "view", ref, "--repo", fresh.repo.key, "--json", "state"], ctx)).state || "UNKNOWN").toLowerCase();
							label = `#${ref} ${state}`;
							if (state !== "merged") allMerged = false;
						} catch (e) {
							allMerged = false;
							label = `${pr.number ? `#${pr.number}` : pr.url || "PR"} not checked: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}`;
						}
						states.push(label);
					}
					let result = "waiting for merge";
					if (allMerged) {
						// Re-read so a ticket closed or changed meanwhile is never closed twice or on stale PRs.
						const latest = (await view(ctx)).snapshot.prog.tickets[t.id];
						if (latest?.status === "done") result = "already closed";
						else if (JSON.stringify(latest?.prs?.map((x: { number?: number }) => x.number)) !== JSON.stringify(saved.prs.map((x: { number?: number }) => x.number))) result = "PRs changed during the check; run again";
						else {
							try {
								await exec("node", [dt, "gate", project.slug, "3", "approve", "--ticket", t.id, "--note", "Closed by /dt-check-merged after live merge checks"], ctx);
								result = "**closed**";
							} catch (e) { result = `close failed: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}`; }
						}
					}
					rows.push(`| ${t.id} | ${t.title.replace(/\|/g, "\\|")} | ${states.join(", ").replace(/\|/g, "\\|")} | ${result} |`);
				}
				const updated = await view(ctx);
				pi.sendMessage({ customType: "dt-approve", display: true, details: { gate: "check-merged" }, content: `## Merge check\n\nProject: ${project.slug}\n\n| Ticket | Title | PRs | Result |\n|---|---|---|---|\n${rows.join("\n")}\n\nClosing records that every PR merged; it is not proof that staging or production checks passed.\n\n## Next commands\n${nextCommandText(nextCommands(updated, updated.logic))}` });
			} catch (e) { ctx.ui.notify(`dt-check-merged: ${e instanceof Error ? e.message : String(e)}`, "error"); }
			finally {
				await releaseLock(lock, ctx);
				busy = false;
			}
		},
	});
}
