/** Selected dev-turbo project: explicit confirmation, session persistence, input defaults. */
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Type } from "@earendil-works/pi-ai";
import { getMarkdownTheme, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Box, Markdown, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { createModuleLoader } from "./runtime.ts";

type Repo = { key: string; featuresBase: string };
type Project = { slug: string; key: string; base: string; tier: string; type: string; scopeId?: string };

export default async function (pi: ExtensionAPI) {
	const load = createModuleLoader(import.meta.url);
	const { ENTRY, TYPES, restoreProject, resolveCommand, validSlug } = await load("./state.mjs");
	const { createProjectFooter } = await load("./footer.mjs");
	const { parseExecJson } = await load("./exec-json.mjs");
	const { WORKFLOW, createBranchReader } = await load("./branch.mjs");
	const TICKET_MESSAGE = "dt-ticket";
	const { createTicketRenderer } = await load("./ticket-screenshots.mjs");
	const { SCOPE, scopeProposal } = await load("./gates.mjs");
	const { approvalGuard } = await load("./approval-guard.mjs");
	const dt = join(process.env.DT_DIR || join(homedir(), ".pi", "agent", "dt"), "dt.mjs");
	let project: Project | null = null;
	let repo: Repo | null = null;
	let repoCwd: string | undefined;
	let currentCtx: ExtensionContext | undefined;
	const branchReader = createBranchReader();
	let cachedBranch: unknown, cachedRepo: Repo | null | undefined, cachedCwd: string | undefined;
	let draft: any = null, grilling = false, contextContent: string | undefined;
	let footerSession: string | undefined, requestFooterRender: (() => void) | undefined;
	let status: string | undefined;
	const laneProjects = new Set<string>();
	let approvedStart: { project: Project; session: string; cwd: string; ticketContent: string } | undefined;
	pi.events.on("dt:lane:approved", (request: { project: Project; ctx: ExtensionContext; ticketContent: string; accepted: boolean }) => {
		refreshSelection(request.ctx);
		if (!project || project.scopeId !== request.project.scopeId || project.tier !== "T0") return;
		approvedStart = { project, session: request.ctx.sessionManager.getSessionId(), cwd: request.ctx.cwd, ticketContent: request.ticketContent };
		request.accepted = true;
	});

	const readRepo = async (ctx: ExtensionContext): Promise<Repo> => {
		const result = await pi.exec("node", [dt, "info", "--json"], { cwd: ctx.cwd, timeout: 5000 });
		return parseExecJson(result, "Cannot resolve this repository");
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
		approvedStart = undefined;
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
		approvedStart = undefined;
		branchReader.invalidate();
		await restoreRepo(ctx);
		refreshSelection(ctx);
	});
	const withLaneFeedback = async <T,>(ctx: ExtensionContext, message: string, work: () => Promise<T>): Promise<T> => {
		if (ctx.hasUI) {
			ctx.ui.setStatus("dt-lane-check", message);
			ctx.ui.notify(message, "info");
		}
		try { return await work(); }
		finally { if (ctx.hasUI) ctx.ui.setStatus("dt-lane-check", undefined); }
	};
	const loadSnapshot = async (ctx: ExtensionContext, selectedProject: Project) => {
		const logic = await load(pathToFileURL(dt).href);
		const repo = logic.resolveRepo(ctx.cwd);
		if (repo.key !== selectedProject.key || repo.featuresBase !== selectedProject.base) throw new Error("Repository changed. Run /dt-resume before choosing a ticket.");
		return { logic, repo, snapshot: logic.readFeatureStatus(repo, selectedProject.slug) };
	};
	pi.registerMessageRenderer(TICKET_MESSAGE, createTicketRenderer({ Box, Markdown, Text, getMarkdownTheme }));
	pi.on("input", async (event, ctx) => {
		// Approval consent is single-use and applies only to the immediate extension kickoff.
		const kickoff = approvedStart;
		approvedStart = undefined;
		if (!/^\/dt-[\w-]+(?:\s|$)/.test(event.text)) return { action: "continue" };
		refreshSelection(ctx);
		if (/^\/dt-start(?:\s|$)/.test(event.text)) {
			if (project) select(null, ctx);
			pi.appendEntry(SCOPE, null);
			pi.appendEntry(WORKFLOW, { cwd: ctx.cwd });
			refreshSelection(ctx);
			return { action: "continue" };
		}
		try {
			let text = resolveCommand(event.text, project);
			let laneContext = "";
			if (text?.startsWith("/dt-lane ")) {
				const separator = text.match(/\s--(?:\s|$)/);
				if (separator) {
					laneContext = text.slice(separator.index! + separator[0].length).trim();
					text = text.slice(0, separator.index);
				}
			}
			if (project && text === `/dt-lane ${project.slug}`) {
				if (!ctx.hasUI) {
					ctx.ui.notify("/dt-lane needs a ticket picker. In non-interactive mode use /dt-lane <id>.", "warning");
					return { action: "handled" };
				}
				const selectedProject = project;
				const { logic } = await withLaneFeedback(ctx, "Loading tickets…", () => loadSnapshot(ctx, selectedProject));
				const { chooseLane } = await load("./lane-picker.mjs");
				const id = await chooseLane({ project: selectedProject, ctx, logic, loadSnapshot: () => loadSnapshot(ctx, selectedProject) });
				if (!id) return { action: "handled" };
				text = `/dt-lane ${selectedProject.slug} ${id}`;
			}
			if (text?.startsWith("/dt-lane ") && project) {
				const selectedProject = project;
				const [, , id, option] = text.split(" ");
				const session = ctx.sessionManager.getSessionId();
				const approvedContent = kickoff && event.source === "extension" && event.text === "/dt-lane 00" &&
					kickoff.session === session && kickoff.cwd === ctx.cwd && kickoff.project.scopeId === selectedProject.scopeId &&
					kickoff.project.slug === selectedProject.slug && kickoff.project.key === selectedProject.key && kickoff.project.base === selectedProject.base
					? kickoff.ticketContent : undefined;
				const { snapshot, warnings } = await withLaneFeedback(ctx, `Checking ticket ${id}: repository, claims and start warnings…`, async () => {
					const { snapshot } = await loadSnapshot(ctx, selectedProject);
					const checked = await pi.exec("node", [dt, "next", selectedProject.slug, "--ticket", id, "--owner", ctx.sessionManager.getSessionId(), "--check-only", "--json", ...(option === "force" ? ["--force"] : []), ...(option === "override" ? ["--override"] : [])], { cwd: ctx.cwd, timeout: 60000 });
					const checkedData = parseExecJson(checked, "Cannot inspect ticket start warnings");
					const warnings = checkedData?.warnings;
					if (!Array.isArray(warnings) || warnings.some((w: unknown) => typeof w !== "string")) throw new Error("Invalid ticket start warnings.");
					return { snapshot, warnings };
				});
				const { chooseDependencyStack, dependencyStackCandidate, remainingStackWarnings, stackConsentMessage } = await load("./dependency-stack.mjs");
				const stackChoice = await chooseDependencyStack({ ctx, project: selectedProject, snapshot, id });
				if (stackChoice.action === "stop") return { action: "handled" };
				const { confirmTicket } = await load("./ticket-preview.mjs");
				if (!await confirmTicket({ pi, ctx, project: selectedProject, snapshot, id, force: option === "force", override: option === "override", warnings: stackChoice.action === "stack" ? remainingStackWarnings(warnings, stackChoice.candidate) : warnings, approvedContent, stackContent: stackChoice.action === "stack" ? stackChoice.ticketContent : undefined })) return { action: "handled" };
				if (warnings.length || option === "override") text = `/dt-lane ${selectedProject.slug} ${id} override`;
				refreshSelection(ctx);
				if (ctx.sessionManager.getSessionId() !== session || project?.scopeId !== selectedProject.scopeId || project?.slug !== selectedProject.slug || project?.key !== selectedProject.key || project?.base !== selectedProject.base) throw new Error("Project changed during confirmation. Run /dt-lane again.");
				if (stackChoice.action === "stack") {
					const { snapshot: fresh } = await loadSnapshot(ctx, selectedProject);
					if (JSON.stringify(dependencyStackCandidate(selectedProject, fresh, id)) !== JSON.stringify(stackChoice.candidate)) throw new Error("Review dependency changed during confirmation. Run /dt-lane again to choose its base.");
					pi.sendMessage(stackConsentMessage(selectedProject.slug, stackChoice.candidate));
				} else if (stackChoice.declined) {
					pi.sendMessage({ customType: "dt-stack-declined", display: true, details: { slug: selectedProject.slug, ticket: id }, content: `No stack consent was given for this start of ${selectedProject.slug} ticket ${id}. Do not reuse a previous stack choice; accepting start warnings alone does not approve changing the branch or PR base.` });
				}
				laneProjects.add(selectedProject.slug);
				// Keep the option in position 3 so context cannot grant force or override.
				if (laneContext) text += `${text.split(" ").length === 3 ? " none" : ""} ${laneContext}`;
			}
			// Staging tests claim the ticket too; release that claim if the session ends.
			if (project && text?.startsWith(`/dt-staging-test ${project.slug}`)) laneProjects.add(project.slug);
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
			project ? `Selected dev-turbo project: ${project.slug} (${project.tier}, ${project.type}), repo ${project.key}, feature base ${project.base}.` : "No project selected. Use /dt-start or /dt-resume.",
			`Lane claim owner for this session: ${ctx.sessionManager.getSessionId()}. Pass --owner ${ctx.sessionManager.getSessionId()} to dt.mjs next, ticket progress updates and pr. Never use another session's owner. Acquire the claim with next before touching ticket code. A refused start requires user consent to override the warnings; never invent --override. On a work handover save --release-claim with the final progress update. Force is only allowed for explicit /dt-lane <id> force. --override is allowed only after the user explicitly requests /dt-lane <id> override or accepts the displayed start-warning confirmation. It overrides ticket-start policy checks, never malformed data or the progress lock, and does not stop previous agents or discard files.`,
			"Only user commands approve new plans: /dt-approve plan; /dt-check-merged closes tickets whose PRs the user merged. Revisions to an approved feature do not require renewed plan approval: ask about unsettled decisions in chat, then edit and keep the original approval intact. Agents may update spec.md and editable ticket files directly during normal work; /dt-revise is an optional spec/ticket coverage audit, not an editing prerequisite. Preserve done/merged tickets and coordinate changes to another active ticket; progress.json is written only through dt.mjs. Do not create a new G2 pending gate for revisions or silently clear a legacy pending gate. Discussion does not approve an initial plan or close a ticket. Do not run dt.mjs gate approve yourself or inject /dt-approve as a user message. Slash commands omit the selected slug; dt.mjs CLI still needs it.",
			draft ? `Pending plan proposal: ${JSON.stringify(draft)}. User next: /dt-approve plan.` : "At the end of a grill, give a short task summary and ask the user to choose T0/T1/T2. Never infer, recommend or default to a tier. After an explicit choice, write the plan files, call dt_propose_plan with that tier, then ask for /dt-approve plan. Choosing a tier in chat does not approve anything.",
		].filter(Boolean).join("\n");
		event.systemPromptOptions.sections.dt_project_context = contextContent;
	});

	pi.on("tool_call", (event) => {
		if (event.toolName === "bash") return approvalGuard(String(event.input.command || ""));
	});
	pi.registerTool({
		name: "dt_propose_plan", label: "Propose plan", exposure: "model-only",
		description: "Save or revise the grill's plan proposal after the user explicitly chose T0/T1/T2 and the plan files are written (tickets/, plus spec.md for T2). Never infer or recommend the tier. This does not approve anything or select a project. The user must run /dt-approve plan.",
		parameters: Type.Object({
			slug: Type.String({ pattern: "^[a-z0-9]+(-[a-z0-9]+)*$" }),
			tier: Type.Union([Type.Literal("T0"), Type.Literal("T1"), Type.Literal("T2")]),
			type: Type.Union(TYPES.map((value: string) => Type.Literal(value))),
			note: Type.String({ maxLength: 400 }),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			if (!validSlug(params.slug)) throw new Error("Use a lowercase kebab-case slug.");
			const r = await readRepo(ctx);
			const dir = join(r.featuresBase, params.slug);
			const tickets = existsSync(join(dir, "tickets")) ? readdirSync(join(dir, "tickets")).filter((f) => f.endsWith(".md")) : [];
			if (!tickets.length) throw new Error(`Write the ticket files to ${join(dir, "tickets")} before proposing the plan.`);
			if (params.tier === "T0" && tickets.length !== 1) throw new Error("A T0 plan is exactly one ticket (00). Choose T1 or T2 for more tickets.");
			if (params.tier === "T1" && tickets.length > 5) throw new Error("A T1 plan has at most 5 tickets. Choose T2 for more.");
			if (params.tier === "T2" && !existsSync(join(dir, "spec.md"))) throw new Error(`Write the brief to ${join(dir, "spec.md")} before proposing a T2 plan.`);
			repo = r;
			repoCwd = ctx.cwd;
			pi.appendEntry(SCOPE, { ...params, key: r.key, base: r.featuresBase, proposalId: randomUUID() });
			refreshSelection(ctx);
			return { content: [{ type: "text", text: "Plan proposal saved. End the card with: /dt-approve plan. Discussion is not approval." }], details: undefined };
		},
	});
}
