/** /dt-status [id] reads saved project files and displays the board or one ticket. No model or remote calls. */
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getMarkdownTheme, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Box, Markdown, Text } from "@earendil-works/pi-tui";
import { createModuleLoader } from "../dt-session/runtime.ts";

const MESSAGE = "dt-status";

export default async function (pi: ExtensionAPI) {
	const load = createModuleLoader(import.meta.url);
	const { ENTRY, restoreProject } = await load("../dt-session/state.mjs");
	const { renderStatus, renderTicketProgress } = await load("./status.mjs");
	const { SCOPE, scopeProposal } = await load("../dt-session/gates.mjs");
	const { createTicketRenderer, readTicketScreenshots, exportTicketScreenshots } = await load("../dt-session/ticket-screenshots.mjs");
	pi.registerMessageRenderer("dt-ticket", createTicketRenderer({ Box, Markdown, Text, getMarkdownTheme }));
	const dt = join(process.env.DT_DIR || join(homedir(), ".pi", "agent", "dt"), "dt.mjs");
	pi.registerMessageRenderer(MESSAGE, (msg, { outputPad }, theme) => {
		const box = new Box(outputPad, 1, (t) => theme.bg("customMessageBg", t));
		box.addChild(new Markdown(String(msg.content), 0, 0, getMarkdownTheme()));
		return box;
	});
	pi.registerCommand("dt-status", {
		description: "Show the saved board, or a full ticket and its saved progress with /dt-status <id> (no model call)",
		handler: async (args, ctx) => {
			const id = args.trim();
			if (id && !/^\d{1,2}$/.test(id)) {
				ctx.ui.notify("Usage: /dt-status [ticket ID]. Switch projects with /dt-resume [slug].", "warning");
				return;
			}
			const branch = ctx.sessionManager.getBranch();
			const selected = [...branch].reverse().find((e) => e.type === "custom" && e.customType === ENTRY);
			const pendingScope = [...branch].reverse().find((e) => e.type === "custom" && e.customType === SCOPE);
			if ((!selected || !("data" in selected) || !selected.data) && (!pendingScope || !("data" in pendingScope) || !pendingScope.data)) {
				ctx.ui.notify("No dev-turbo project selected. Run /dt-resume [slug], or /dt-start and approve the plan.", "warning");
				return;
			}
			try {
				// Importing dt.mjs does not run its CLI. These functions only read local git/config/files.
				const logic = await load(pathToFileURL(dt).href);
				const repo = logic.resolveRepo(ctx.cwd);
				const project = restoreProject(branch, repo);
				const scope = scopeProposal(branch, repo);
				if (scope && !id) {
					pi.sendMessage({ customType: MESSAGE, content: renderStatus(null, null, logic, { branch, scope }), display: true, details: undefined });
					return;
				}
				if (!project) throw new Error(scope ? "Approve the plan before viewing its tickets here." : "The saved project does not match this repository. Select it with /dt-resume.");
				const snapshot = logic.readFeatureStatus(repo, project.slug);
				if (id) {
					const { displayTicket, readTicketPreview, ticketStatus } = await load("../dt-session/ticket-preview.mjs");
					const ticket = await readTicketPreview(snapshot, id);
					const screenshots = await readTicketScreenshots(ticket, join(project.base, project.slug));
					const unavailable = screenshots.filter(screenshot => screenshot.error);
					if (unavailable.length) ctx.ui.notify(unavailable.map(screenshot => `${screenshot.label || "Screenshot"}: ${screenshot.error}`).join("\n"), "warning");
					const screenshotExport = await exportTicketScreenshots(ticket.id, screenshots);
					displayTicket(pi, project, ticket, ticketStatus(snapshot, ticket.id), renderTicketProgress(snapshot, ticket.id), screenshots, screenshotExport);
					return;
				}
				pi.sendMessage({ customType: MESSAGE, content: renderStatus(project, snapshot, logic, { branch }), display: true, details: { slug: project.slug } });
			} catch (e) {
				ctx.ui.notify(`dt-status: ${e instanceof Error ? e.message : String(e)}`, "error");
			}
		},
	});
}
