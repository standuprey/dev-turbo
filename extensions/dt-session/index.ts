/** Selected dev-turbo project: explicit confirmation, session persistence, input defaults. */
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { createModuleLoader } from "./runtime.ts";

type Repo = { key: string; featuresBase: string };
type Project = { slug: string; key: string; base: string; tier: string; type: string; scopeId?: string };

export default async function (pi: ExtensionAPI) {
	const load = createModuleLoader(import.meta.url);
	const { ENTRY, TYPES, restoreProject, resolveCommand, validSlug } = await load("./state.mjs");
	const { createProjectFooter } = await load("./footer.mjs");
	const { SCOPE, QUICK, scopeProposal, quickGate } = await load("./gates.mjs");
	const dt = join(process.env.DT_DIR || join(homedir(), ".pi", "agent", "dt"), "dt.mjs");
	let project: Project | null = null;
	let repo: Repo | null = null;
	let currentCtx: ExtensionContext | undefined;

	const readRepo = async (ctx: ExtensionContext): Promise<Repo> => {
		const result = await pi.exec("node", [dt, "info", "--json"], { cwd: ctx.cwd, timeout: 5000 });
		if (result.code !== 0) throw new Error(result.stderr || "Cannot resolve this repository.");
		return JSON.parse(result.stdout);
	};
	const updateUI = (ctx: ExtensionContext) => {
		if (ctx.mode === "tui") {
			if (!project) ctx.ui.setFooter(undefined);
			else ctx.ui.setFooter((tui, theme, data) => createProjectFooter(ctx, pi, theme, data, tui, () => project, { truncateToWidth, visibleWidth }));
		} else ctx.ui.setStatus(ENTRY, project ? `dt: ${project.slug}` : undefined);
	};
	const select = (value: Project | null, ctx: ExtensionContext) => {
		project = value;
		pi.appendEntry(ENTRY, value);
		updateUI(ctx);
	};
	const refreshSelection = (ctx: ExtensionContext) => {
		currentCtx = ctx;
		const saved = restoreProject(ctx.sessionManager.getBranch(), repo);
		if (JSON.stringify(saved) !== JSON.stringify(project)) {
			project = saved;
			updateUI(ctx);
		}
	};
	pi.events.on("dt:project:get", (request: { project: Project | null }) => {
		if (currentCtx) refreshSelection(currentCtx);
		request.project = project;
	});
	pi.events.on("dt:project:select", (request: { project: Project; repo?: Repo; ctx: ExtensionContext }) => {
		if (currentCtx && request.ctx.sessionManager.getSessionId() !== currentCtx.sessionManager.getSessionId()) return;
		if (request.repo) repo = request.repo;
		// The entry was already persisted by /dt-resume. This event only updates the footer.
		refreshSelection(request.ctx);
	});
	pi.on("session_start", async (_event, ctx) => {
		currentCtx = ctx;
		project = null;
		repo = null;
		try { repo = await readRepo(ctx); } catch { /* Help and grilling work without a selection. */ }
		project = restoreProject(ctx.sessionManager.getBranch(), repo);
		updateUI(ctx);
	});
	pi.on("session_tree", (_event, ctx) => {
		currentCtx = ctx;
		project = restoreProject(ctx.sessionManager.getBranch(), repo);
		updateUI(ctx);
	});
	pi.on("input", (event, ctx) => {
		refreshSelection(ctx);
		if (/^\/dt-grill(?:\s|$)/.test(event.text)) {
			if (project) select(null, ctx);
			pi.appendEntry(SCOPE, null);
			return { action: "continue" };
		}
		try {
			const text = resolveCommand(event.text, project);
			return text ? { action: "transform", text, images: event.images } : { action: "continue" };
		} catch (e) {
			ctx.ui.notify(e instanceof Error ? e.message : String(e), "warning");
			return { action: "handled" };
		}
	});
	pi.on("before_agent_start", (_event, ctx) => {
		refreshSelection(ctx);
		const draft = scopeProposal(ctx.sessionManager.getBranch(), repo);
		const quick = project?.tier !== "T2" ? ["slices", "review", "ticket"].map((g) => quickGate(ctx.sessionManager.getBranch(), project, g)).filter(Boolean) : [];
		return { message: { customType: "dt-project-context", display: false, details: undefined, content: [
			project ? `Selected dev-turbo project: ${project.slug} (${project.tier}, ${project.type}), repo ${project.key}, feature base ${project.base}.` : "No project selected. Use /dt-grill or /dt-resume.",
			"Only user /dt-approve commands record approval: scope, architecture, slices, ticket, drift. Discussion and adjustments never approve a gate. Do not run dt.mjs gate approve yourself or inject /dt-approve as a user message. End every pending gate card with its exact /dt-approve command. Slash commands omit the selected slug; dt.mjs CLI still needs it.",
			draft ? `Pending scope proposal: ${JSON.stringify(draft)}. User next: /dt-approve scope.` : "At the end of a grill, call dt_propose_scope to save the proposal, then ask for /dt-approve scope.",
			quick.length ? `Quick-task gates: ${JSON.stringify(quick)}. An approved slices gate lets /dt-quick continue with coding; an approved ticket gate means quick-task acceptance is recorded.` : "",
		].filter(Boolean).join("\n") } };
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
			pi.appendEntry(SCOPE, { ...params, key: r.key, base: r.featuresBase, proposalId: randomUUID() });
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
