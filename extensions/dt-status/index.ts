/** /dt-status reads saved project files and displays a board. No model or remote calls. */
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getMarkdownTheme, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Box, Markdown } from "@earendil-works/pi-tui";
import { createModuleLoader } from "../dt-session/runtime.ts";

const MESSAGE = "dt-status";

export default async function (pi: ExtensionAPI) {
	const load = createModuleLoader(import.meta.url);
	const { ENTRY, restoreProject } = await load("../dt-session/state.mjs");
	const { renderStatus } = await load("./status.mjs");
	const { SCOPE, scopeProposal } = await load("../dt-session/gates.mjs");
	const dt = join(process.env.DT_DIR || join(homedir(), ".pi", "agent", "dt"), "dt.mjs");
	pi.registerMessageRenderer(MESSAGE, (msg, { outputPad }, theme) => {
		const box = new Box(outputPad, 1, (t) => theme.bg("customMessageBg", t));
		box.addChild(new Markdown(String(msg.content), 0, 0, getMarkdownTheme()));
		return box;
	});
	pi.registerCommand("dt-status", {
		description: "Show saved completion, remaining tickets and next steps (no model call)",
		handler: async (args, ctx) => {
			if (args.trim()) {
				ctx.ui.notify("Usage: /dt-status. Switch projects with /dt-resume [slug].", "warning");
				return;
			}
			const branch = ctx.sessionManager.getBranch();
			const selected = [...branch].reverse().find((e) => e.type === "custom" && e.customType === ENTRY);
			const pendingScope = [...branch].reverse().find((e) => e.type === "custom" && e.customType === SCOPE);
			if ((!selected || !("data" in selected) || !selected.data) && (!pendingScope || !("data" in pendingScope) || !pendingScope.data)) {
				ctx.ui.notify("No dev-turbo project selected. Run /dt-resume [slug], or /dt-grill and confirm Gate 0 + the slug.", "warning");
				return;
			}
			try {
				// Importing dt.mjs does not run its CLI. These functions only read local git/config/files.
				const logic = await load(pathToFileURL(dt).href);
				const repo = logic.resolveRepo(ctx.cwd);
				const project = restoreProject(branch, repo);
				const scope = scopeProposal(branch, repo);
				if (scope) {
					pi.sendMessage({ customType: MESSAGE, content: renderStatus(null, null, logic, { branch, scope }), display: true, details: undefined });
					return;
				}
				if (!project) throw new Error("The saved project does not match this repository. Select it with /dt-resume.");
				const snapshot = project.tier === "T2" ? logic.readFeatureStatus(repo, project.slug) : null;
				const content = renderStatus(project, snapshot, logic, { branch });
				pi.sendMessage({ customType: MESSAGE, content, display: true, details: { slug: project.slug } });
			} catch (e) {
				ctx.ui.notify(`dt-status: ${e instanceof Error ? e.message : String(e)}`, "error");
			}
		},
	});
}
