/** /dt-status [id|branch|lane|all] reads saved project files and displays the board or one ticket. No model or remote calls. */
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getMarkdownTheme, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Box, Markdown, Text } from "@earendil-works/pi-tui";
import { createModuleLoader } from "../dt-session/runtime.ts";

const MESSAGE = "dt-status";
const specLink = (file: string) => existsSync(file) ? `\n\n[Spec](<${pathToFileURL(file).href}>)` : "";

export default async function (pi: ExtensionAPI) {
	const load = createModuleLoader(import.meta.url);
	const { ENTRY, restoreProject } = await load("../dt-session/state.mjs");
	const { renderStatus, renderTicketProgress, currentLaneTicket, branchTicket } = await load("./status.mjs");
	const { SCOPE, scopeProposal } = await load("../dt-session/gates.mjs");
	const { createTicketRenderer, readTicketScreenshots, exportTicketScreenshots } = await load("../dt-session/ticket-screenshots.mjs");
	pi.registerMessageRenderer("dt-ticket", createTicketRenderer({ Box, Markdown, Text, getMarkdownTheme }));
	const dt = join(process.env.DT_DIR || join(homedir(), ".pi", "agent", "dt"), "dt.mjs");
	pi.registerMessageRenderer(MESSAGE, (msg, { outputPad }, theme) => {
		const box = new Box(outputPad, 1, (t) => theme.bg("customMessageBg", t));
		// Color only the State cell; leave saved content and other cells unstyled.
		const content = String(msg.content).replace(/^(\|(?:\\.|[^|\r\n])*\|(?:\\.|[^|\r\n])*\|[ \t]*)(🟢 ready)([ \t]*\|)/gm,
			(_match, before, status, after) => before + theme.fg("success", status) + after);
		box.addChild(new Markdown(content, 0, 0, getMarkdownTheme()));
		return box;
	});
	pi.registerCommand("dt-status", {
		description: "Show an ID-sorted ticket table (all includes closed), or a full ticket with <id|branch|lane> (no model call)",
		handler: async (args, ctx) => {
			let id = args.trim();
			const all = id === "all";
			if (all) id = "";
			if (/[\s\x00-\x1f\x7f]/.test(id)) {
				ctx.ui.notify("Usage: /dt-status [ticket ID|branch|lane|all]. Switch projects with /dt-resume [slug].", "warning");
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
					pi.sendMessage({ customType: MESSAGE, content: renderStatus(null, null, logic, { branch, scope }) + specLink(join(repo.featuresBase, scope.slug, "spec.md")), display: true, details: undefined });
					return;
				}
				if (!project) throw new Error(scope ? "Approve the plan before viewing its tickets here." : "The saved project does not match this repository. Select it with /dt-resume.");
				const snapshot = logic.readFeatureStatus(repo, project.slug);
				if (id === "lane") id = currentLaneTicket(project, snapshot, repo);
				else if (id && !/^\d{1,2}$/.test(id)) id = branchTicket(snapshot, id);
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
				pi.sendMessage({ customType: MESSAGE, content: renderStatus(project, snapshot, logic, { branch, all }) + specLink(snapshot.p.spec), display: true, details: { slug: project.slug } });
			} catch (e) {
				ctx.ui.notify(`dt-status: ${e instanceof Error ? e.message : String(e)}`, "error");
			}
		},
	});
}
