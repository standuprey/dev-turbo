/**
 * /dt-resume [slug] - pick a dev-turbo feature and see where it stands.
 *
 * Everything comes from the feature folder (feature.json, spec.md, tickets/, progress.json)
 * through `dt.mjs resume`; nothing depends on an earlier session. The brief is posted in the
 * transcript with next commands; no follow-up action picker is shown.
 * Installed by dev-turbo's install.sh into ~/.pi/agent/extensions/.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { getMarkdownTheme, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Box, Markdown } from "@earendil-works/pi-tui";
import { createModuleLoader } from "./dt-session/runtime.ts";
import { pathToFileURL } from "node:url";

const DT = join(process.env.DT_DIR || join(homedir(), ".pi", "agent", "dt"), "dt.mjs");
const MESSAGE = "dt-resume";

type Feature = { slug: string; label: string };
type Resume = { slug: string; next: string; suggested: string; brief: string; instructions: string };

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default async function (pi: ExtensionAPI) {
	const load = createModuleLoader(import.meta.url);
	const { ENTRY, sessionCommand, validSlug } = await load("./dt-session/state.mjs");
	const { SCOPE, nextCommands, namedText } = await load("./dt-session/gates.mjs");
	pi.registerMessageRenderer(MESSAGE, (msg, { outputPad }, theme) => {
		const box = new Box(outputPad, 1, (t) => theme.bg("customMessageBg", t));
		box.addChild(new Markdown(String(msg.content), 0, 0, getMarkdownTheme()));
		return box;
	});

	const dt = async <T>(cwd: string, args: string[]): Promise<T> => {
		const r = await pi.exec("node", [DT, ...args], { cwd, timeout: 120_000 });
		if (r.code !== 0) throw new Error((r.stderr || r.stdout || `dt.mjs ${args[0]} failed`).trim().replace(/^dt: /, ""));
		return JSON.parse(r.stdout) as T;
	};

	pi.registerCommand("dt-resume", {
		description: "Pick a dev-turbo feature and see where it stands (from its feature folder)",
		handler: async (args, ctx) => {
			if (!ctx.isIdle()) {
				ctx.ui.notify("Wait for the current task to finish, then run /dt-resume.", "warning");
				return;
			}
			let features: Feature[];
			try {
				features = await dt<Feature[]>(ctx.cwd, ["resume", "--json"]);
			} catch (e) {
				ctx.ui.notify(`dt-resume: ${message(e)}. Open pi inside the repository or one of its lanes.`, "error");
				return;
			}
			if (!features.length) {
				ctx.ui.notify("No dev-turbo features for this repository yet: start with /dt-grill.", "info");
				return;
			}

			let slug = args.trim();
			if (slug && !features.some((f) => f.slug === slug)) {
				ctx.ui.notify(`Unknown feature "${slug}". Known: ${features.map((f) => f.slug).join(", ")}`, "error");
				return;
			}
			if (!slug) {
				if (!ctx.hasUI) {
					ctx.ui.notify(`Name the feature: /dt-resume <slug> (${features.map((f) => f.slug).join(", ")})`, "warning");
					return;
				}
				const labels = features.map((f, i) => `${i + 1}. ${short(f.label, 110)}`);
				const choice = await ctx.ui.select("Resume which feature?", labels);
				if (!choice) return;
				slug = features[labels.indexOf(choice)].slug;
			}

			// Selecting a valid local feature must not depend on GitHub or an event acknowledgement.
			let r: Resume;
			try {
				if (!validSlug(slug)) throw new Error("Feature slugs must be lowercase kebab-case.");
				const info = await dt<{ key: string; featuresBase: string }>(ctx.cwd, ["info", "--json"]);
				const feature = JSON.parse(await readFile(join(info.featuresBase, slug, "feature.json"), "utf8"));
				if (!/^T[012]$/.test(feature.tier) || !["web", "device", "service", "cli", "mixed"].includes(feature.type)) {
					throw new Error("The feature has invalid tier/type metadata.");
				}
				r = await dt<Resume>(ctx.cwd, ["resume", slug, "--json", "--no-gh"]);
				const project = { slug, tier: feature.tier, type: feature.type, key: info.key, base: info.featuresBase };
				pi.appendEntry(ENTRY, project);
				pi.appendEntry(SCOPE, null);
				// Notification only: status/defaults restore directly from the session entry.
				pi.events.emit("dt:project:select", { project, repo: info, ctx });
				ctx.ui.notify(`Selected project: ${slug}`, "info");
			} catch (e) {
				ctx.ui.notify(`dt-resume: ${message(e)}`, "error");
				return;
			}

			ctx.ui.setStatus(MESSAGE, `dt-resume: refreshing ${slug}…`);
			try {
				r = await dt<Resume>(ctx.cwd, ["resume", slug, "--json"]);
			} catch (e) {
				ctx.ui.notify(`Selected ${slug}; remote refresh failed: ${message(e)}. Showing saved state.`, "warning");
			} finally {
				ctx.ui.setStatus(MESSAGE, undefined);
			}
			r.next = sessionCommand(r.next, slug);
			r.suggested = sessionCommand(r.suggested, slug);
			let commands = ["/dt-status"];
			try {
				const logic = await load(pathToFileURL(DT).href);
				const repo = logic.resolveRepo(ctx.cwd);
				const snapshot = logic.readFeatureStatus(repo, slug);
				commands = nextCommands({ project: { slug, tier: snapshot.feature.tier }, snapshot, branch: ctx.sessionManager.getBranch() }, logic);
			} catch { /* Status reports a local snapshot gap without inventing a workflow transition. */ }
			pi.sendMessage({ customType: MESSAGE, content: namedText(sessionCommand(r.brief, slug)) + "\n\n## Next commands\n" + commands.map((c) => "- `" + c + "`").join("\n"), display: true, details: { slug } });
		},
	});
}
