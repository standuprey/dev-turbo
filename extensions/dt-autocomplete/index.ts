/** Local feature and ticket completion, without changing prompt dispatch. */
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createModuleLoader } from "../dt-session/runtime.ts";

export default async function (pi: ExtensionAPI) {
	const modules = createModuleLoader(import.meta.url);
	const { createDataLoader, createAutocompleteProvider } = await modules("./completion.mjs");
	const dt = join(process.env.DT_DIR || join(homedir(), ".pi", "agent", "dt"), "dt.mjs");
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		const load = createDataLoader(pi, dt, ctx.cwd);
		const getProject = () => {
			const request = { project: null };
			pi.events.emit("dt:project:get", request);
			return request.project;
		};
		ctx.ui.addAutocompleteProvider((current) => createAutocompleteProvider(current, load, getProject));
	});
}
