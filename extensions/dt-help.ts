/** /dt-help displays the README's command flow, ticket picker and ownership rules; no model or workflow actions. */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { getMarkdownTheme, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Box, Markdown } from "@earendil-works/pi-tui";

const README = join(process.env.DT_DIR || join(homedir(), ".pi", "agent", "dt"), "README.md");
const MESSAGE = "dt-help";

export function workflowGuide(readme: string): string {
	const guide = readme.split(/^## Flow\r?\n/m)[1]?.split(/^## /m)[0]?.trim();
	if (!guide) throw new Error("The installed README has no Flow section. Re-run dev-turbo's install.sh.");
	return `# dev-turbo workflow\n\n${guide}`;
}

export default function (pi: ExtensionAPI) {
	pi.registerMessageRenderer(MESSAGE, (msg, { outputPad }, theme) => {
		const box = new Box(outputPad, 1, (t) => theme.bg("customMessageBg", t));
		box.addChild(new Markdown(String(msg.content), 0, 0, getMarkdownTheme()));
		return box;
	});
	pi.registerCommand("dt-help", {
		description: "Show the command flow, ticket picker, ownership rules and approvals (no model call)",
		handler: async (args, ctx) => {
			if (args.trim()) {
				ctx.ui.notify("Usage: /dt-help", "info");
				return;
			}
			try {
				const content = workflowGuide(await readFile(README, "utf8"));
				pi.sendMessage({ customType: MESSAGE, content, display: true, details: undefined });
			} catch (e) {
				ctx.ui.notify(`dt-help: ${e instanceof Error ? e.message : String(e)}`, "error");
			}
		},
	});
}
