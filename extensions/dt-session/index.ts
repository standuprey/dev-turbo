/** Selected dev-turbo project: explicit confirmation, session persistence, input defaults. */
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Type } from "@earendil-works/pi-ai";
import { getMarkdownTheme, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Box, Markdown, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { createModuleLoader } from "./runtime.ts";

type Repo = { key: string; featuresBase: string; jiraRequired?: boolean };
type Project = { slug: string; key: string; base: string; tier: string; type: string; scopeId?: string };

export default async function (pi: ExtensionAPI) {
	const load = createModuleLoader(import.meta.url);
	const { ENTRY, TYPES, restoreProject, resolveCommand, validSlug } = await load("./state.mjs");
	const { createProjectFooter } = await load("./footer.mjs");
	const { WORKFLOW, createBranchReader } = await load("./branch.mjs");
	const TICKET_MESSAGE = "dt-ticket";
	const { SCOPE, QUICK, scopeProposal, quickGate } = await load("./gates.mjs");
	const dt = join(process.env.DT_DIR || join(homedir(), ".pi", "agent", "dt"), "dt.mjs");
	let project: Project | null = null;
	let repo: Repo | null = null;
	let repoCwd: string | undefined;
	let currentCtx: ExtensionContext | undefined;
	const branchReader = createBranchReader();
	let cachedBranch: unknown, cachedRepo: Repo | null | undefined, cachedCwd: string | undefined;
	let draft: any = null, quick: any[] = [], grilling = false, contextContent: string | undefined;
	let footerSession: string | undefined, requestFooterRender: (() => void) | undefined;
	let status: string | undefined;
	const laneProjects = new Set<string>();

	const readRepo = async (ctx: ExtensionContext): Promise<Repo> => {
		const result = await pi.exec("node", [dt, "info", "--json"], { cwd: ctx.cwd, timeout: 5000 });
		if (result.code !== 0) throw new Error(result.stderr || "Cannot resolve this repository.");
		return JSON.parse(result.stdout);
	};
	const restoreRepo = async (ctx: ExtensionContext) => {
		const branch = branchReader.read(ctx.sessionManager);
		const saved = branch.findLast((e: any) => e.customType === ENTRY)?.data;
		const pending = branch.findLast((e: any) => e.customType === SCOPE)?.data;
		if ((!repo || repoCwd !== ctx.cwd) && (saved || pending)) {
			try { repo = await readRepo(ctx); repoCwd = ctx.cwd; }
			catch { repo = null; repoCwd = undefined; }
		}
	};
	const updateUI = (ctx: ExtensionContext) => {
		if (ctx.mode === "tui") {
			if (!project) {
				if (footerSession !== undefined) ctx.ui.setFooter(undefined);
				footerSession = undefined;
				requestFooterRender = undefined;
			} else if (footerSession !== ctx.sessionManager.getSessionId()) {
				footerSession = ctx.sessionManager.getSessionId();
				ctx.ui.setFooter((tui, theme, data) => {
					requestFooterRender = () => tui.requestRender();
					return createProjectFooter(ctx, pi, theme, data, tui, () => project, { truncateToWidth, visibleWidth });
				});
			} else requestFooterRender?.();
		} else {
			const next = project ? `dt: ${project.slug}` : undefined;
			if (next !== status) ctx.ui.setStatus(ENTRY, next);
			status = next;
		}
	};
	const refreshSelection = (ctx: ExtensionContext) => {
		currentCtx = ctx;
		const branch = branchReader.read(ctx.sessionManager);
		if (branch === cachedBranch && repo === cachedRepo && ctx.cwd === cachedCwd) return;
		cachedBranch = branch;
		cachedRepo = repo;
		cachedCwd = ctx.cwd;
		contextContent = undefined;
		const saved = restoreProject(branch, repo);
		draft = scopeProposal(branch, repo);
		grilling = branch.findLast((e: any) => e.customType === WORKFLOW)?.data?.cwd === ctx.cwd;
		quick = saved && saved.tier !== "T2" ? ["slices", "review", "ticket"].map((g) => quickGate(branch, saved, g)).filter(Boolean) : [];
		if (saved !== project) {
			project = saved;
			updateUI(ctx);
		}
	};
	const select = (value: Project | null, ctx: ExtensionContext) => {
		pi.appendEntry(ENTRY, value);
		refreshSelection(ctx);
	};
	pi.events.on("dt:project:get", (request: { project: Project | null }) => {
		if (currentCtx) refreshSelection(currentCtx);
		request.project = project;
	});
	pi.events.on("dt:project:select", (request: { project: Project; repo?: Repo; ctx: ExtensionContext }) => {
		if (currentCtx && request.ctx.sessionManager.getSessionId() !== currentCtx.sessionManager.getSessionId()) return;
		if (request.repo) { repo = request.repo; repoCwd = request.ctx.cwd; }
		// The entry was already persisted by /dt-resume. This event only updates the footer.
		refreshSelection(request.ctx);
	});
	pi.on("session_start", async (_event, ctx) => {
		currentCtx = ctx;
		repo = null;
		repoCwd = undefined;
		status = undefined;
		cachedBranch = undefined;
		branchReader.invalidate();
		// Ordinary sessions never need a repository subprocess or a footer reset.
		await restoreRepo(ctx);
		refreshSelection(ctx);
		if (project) updateUI(ctx);
	});
	pi.on("session_tree", async (_event, ctx) => {
		branchReader.invalidate();
		await restoreRepo(ctx);
		refreshSelection(ctx);
	});
	const loadSnapshot = async (ctx: ExtensionContext, selectedProject: Project) => {
		const logic = await load(pathToFileURL(dt).href);
		const repo = logic.resolveRepo(ctx.cwd);
		if (repo.key !== selectedProject.key || repo.featuresBase !== selectedProject.base) throw new Error("Repository changed. Run /dt-resume before choosing a ticket.");
		return { logic, repo, snapshot: logic.readFeatureStatus(repo, selectedProject.slug) };
	};
	pi.registerMessageRenderer(TICKET_MESSAGE, (msg, { outputPad }, theme) => {
		const box = new Box(outputPad, 1, (t) => theme.bg("customMessageBg", t));
		box.addChild(new Markdown(String(msg.content), 0, 0, getMarkdownTheme()));
		return box;
	});
	pi.registerCommand("dt-show", {
		description: "Display a ticket without claiming or starting it",
		handler: async (args, ctx) => {
			refreshSelection(ctx);
			try {
				if (!project) throw new Error("No dev-turbo project selected. Run /dt-resume [slug].");
				if (project.tier !== "T2") throw new Error("/dt-show needs a T2 feature with tickets.");
				let id = args.trim();
				if (id && !/^\d{1,2}$/.test(id)) throw new Error("Usage: /dt-show [ticket ID]. Switch projects with /dt-resume.");
				const selectedProject = project;
				const { snapshot } = await loadSnapshot(ctx, selectedProject);
				const { displayTicket, readTicketPreview, ticketStatus } = await load("./ticket-preview.mjs");
				if (!id) {
					if (!ctx.hasUI) throw new Error("In non-interactive mode use /dt-show <id>.");
					const labels = snapshot.tickets.map((t: { id: string; title: string }) => `${t.id} · ${t.title} · ${ticketStatus(snapshot, t.id)}`);
					if (!labels.length) throw new Error("No tickets to display.");
					const choice = await ctx.ui.select(`Show a ticket · ${selectedProject.slug}`, labels);
					if (!choice) return;
					id = snapshot.tickets[labels.indexOf(choice)].id;
				}
				const ticket = await readTicketPreview(snapshot, id);
				displayTicket(pi, selectedProject, ticket, ticketStatus(snapshot, ticket.id));
			} catch (e) {
				ctx.ui.notify(e instanceof Error ? e.message : String(e), "warning");
			}
		},
	});
	pi.on("input", async (event, ctx) => {
		if (!/^\/dt-[\w-]+(?:\s|$)/.test(event.text)) return { action: "continue" };
		refreshSelection(ctx);
		if (/^\/dt-grill(?:\s|$)/.test(event.text)) {
			if (project) select(null, ctx);
			pi.appendEntry(SCOPE, null);
			pi.appendEntry(WORKFLOW, { cwd: ctx.cwd });
			refreshSelection(ctx);
			return { action: "continue" };
		}
		try {
			let text = resolveCommand(event.text, project);
			if (project && text === `/dt-lane ${project.slug}`) {
				if (!ctx.hasUI) {
					ctx.ui.notify("/dt-lane needs a ticket picker. In non-interactive mode use /dt-lane <id>.", "warning");
					return { action: "handled" };
				}
				const selectedProject = project;
				const { logic } = await loadSnapshot(ctx, selectedProject);
				const { chooseLane } = await load("./lane-picker.mjs");
				const id = await chooseLane({ project: selectedProject, ctx, logic, loadSnapshot: () => loadSnapshot(ctx, selectedProject) });
				if (!id) return { action: "handled" };
				text = `/dt-lane ${selectedProject.slug} ${id}`;
			}
			if (text?.startsWith("/dt-lane ") && project) {
				const selectedProject = project;
				const [, , id, force] = text.split(" ");
				const { snapshot } = await loadSnapshot(ctx, selectedProject);
				const { confirmTicket } = await load("./ticket-preview.mjs");
				if (!await confirmTicket({ pi, ctx, project: selectedProject, snapshot, id, force: force === "force" })) return { action: "handled" };
				refreshSelection(ctx);
				if (project?.slug !== selectedProject.slug || project?.key !== selectedProject.key || project?.base !== selectedProject.base) throw new Error("Project changed during confirmation. Run /dt-lane again.");
				laneProjects.add(selectedProject.slug);
			}
			return text ? { action: "transform", text, images: event.images } : { action: "continue" };
		} catch (e) {
			ctx.ui.notify(e instanceof Error ? e.message : String(e), "warning");
			return { action: "handled" };
		}
	});
	pi.on("session_shutdown", async (_event, ctx) => {
		// Release only this session's claims. A force takeover must not be undone.
		for (const slug of laneProjects) {
			const result = await pi.exec("node", [dt, "progress", slug, "--release-claim", "--owner", ctx.sessionManager.getSessionId()], { cwd: ctx.cwd, timeout: 15000 });
			if (result.code !== 0) ctx.ui.notify(`Could not release ${slug}'s lane claim; use /dt-lane <id> force after checking the old agent is gone.`, "warning");
		}
	});
	pi.on("before_agent_start", (event, ctx) => {
		if (!project && !grilling && !draft) return;
		refreshSelection(ctx);
		if (!project && !grilling && !draft) return;
		// A stable prompt section avoids adding another hidden transcript message each turn.
		contextContent ??= [
			project ? `Selected dev-turbo project: ${project.slug} (${project.tier}, ${project.type}), repo ${project.key}, feature base ${project.base}.` : "No project selected. Use /dt-grill or /dt-resume.",
			`Lane claim owner for this session: ${ctx.sessionManager.getSessionId()}. Pass --owner ${ctx.sessionManager.getSessionId()} to dt.mjs next, ticket progress updates and pr. Never use another session's owner. Acquire the claim with next before touching ticket code; if refused, STOP. On a work handover save --release-claim with the final progress update. Force is only allowed when the user explicitly ran /dt-lane <id> force; it does not stop the previous agent.`,
			"Only user /dt-approve commands record approval: scope, architecture, slices, ticket, drift. Discussion and adjustments never approve a gate. Do not run dt.mjs gate approve yourself or inject /dt-approve as a user message. End every pending gate card with its exact /dt-approve command. Slash commands omit the selected slug; dt.mjs CLI still needs it.",
			draft ? `Pending scope proposal: ${JSON.stringify(draft)}. User next: /dt-approve scope.` : "At the end of a grill, call dt_propose_scope to save the proposal, then ask for /dt-approve scope.",
			quick.length ? `Quick-task gates: ${JSON.stringify(quick)}. An approved slices gate lets /dt-quick continue with coding; an approved ticket gate means quick-task acceptance is recorded.` : "",
		].filter(Boolean).join("\n");
		event.systemPromptOptions.sections.dt_project_context = contextContent;
	});

	pi.on("tool_call", (event) => {
		if (event.toolName === "bash" && /dt\.mjs[\s\S]*(?:\bgate\b[\s\S]*\bapprove\b|\bprogress\b[\s\S]*--status\s+["']?done\b)/.test(String(event.input.command || ""))) {
			return { block: true, reason: "Approvals are user commands. Ask the user to run /dt-approve <gate>; do not record approval from discussion." };
		}
	});
	pi.registerTool({
		name: "dt_propose_scope", label: "Propose Scope", exposure: "model-only",
		description: "Save or revise the grill's scope proposal. This does not approve anything or select a project. The user must run /dt-approve scope.",
		parameters: Type.Object({
			slug: Type.String({ pattern: "^[a-z0-9]+(-[a-z0-9]+)*$" }),
			tier: Type.Union([Type.Literal("T0"), Type.Literal("T1"), Type.Literal("T2")]),
			type: Type.Union(TYPES.map((value: string) => Type.Literal(value))),
			note: Type.String({ maxLength: 400 }),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			if (!validSlug(params.slug)) throw new Error("Use a lowercase kebab-case slug.");
			const r = await readRepo(ctx);
			const epic = r.jiraRequired ? (await load(pathToFileURL(dt).href)).requireEpic(r, params.slug) : null;
			repo = r;
			repoCwd = ctx.cwd;
			pi.appendEntry(SCOPE, { ...params, ...(epic ? { epic } : {}), key: r.key, base: r.featuresBase, proposalId: randomUUID() });
			refreshSelection(ctx);
			return { content: [{ type: "text", text: "Scope proposal saved. End the card with: /dt-approve scope. Discussion is not approval." }], details: undefined };
		},
	});
	pi.registerTool({
		name: "dt_propose_quick_gate", label: "Propose quick-task gate", exposure: "model-only",
		description: "Save a T0/T1 scenario-plan (slices), required-review checkpoint (review), or acceptance proposal (ticket). Only /dt-approve records human approval.",
		parameters: Type.Object({ gate: Type.Union([Type.Literal("slices"), Type.Literal("review"), Type.Literal("ticket")]), note: Type.String({ maxLength: 400 }), branch: Type.Optional(Type.String({ maxLength: 200 })) }),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			refreshSelection(ctx);
			if (!project || project.tier === "T2") throw new Error("This proposal tool is only for a selected T0/T1 task.");
			if (params.gate === "ticket" && project.tier === "T1" && quickGate(ctx.sessionManager.getBranch(), project, "slices")?.state !== "approved") throw new Error("Approve the T1 scenario plan with /dt-approve slices before building or proposing ticket acceptance.");
			if (params.gate === "ticket" && (!params.branch || params.branch.startsWith("-"))) throw new Error("Save the quick PR branch before proposing ticket acceptance.");
			if (params.gate === "ticket") {
				const review = quickGate(ctx.sessionManager.getBranch(), project, "review");
				if (review?.state === "pending") pi.appendEntry(QUICK, { ...review, state: "done" });
			}
			pi.appendEntry(QUICK, { ...params, slug: project.slug, key: project.key, scopeId: project.scopeId, state: "pending" });
			return { content: [{ type: "text", text: params.gate === "review" ? "Review checkpoint saved. User next: /dt-review." : "Quick gate proposal saved. User next: /dt-approve " + params.gate }], details: undefined };
		},
	});
}
