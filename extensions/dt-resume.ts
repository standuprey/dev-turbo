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
import { Box, Container, Key, Markdown, matchesKey, SelectList, Text } from "@earendil-works/pi-tui";
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
	const { ENTRY, restoreProject, sessionCommand, validSlug } = await load("./dt-session/state.mjs");
	const { SCOPE, nextCommands, nextCommandText, namedText } = await load("./dt-session/gates.mjs");
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
				ctx.ui.notify("No dev-turbo features for this repository yet: start with /dt-start.", "info");
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
				while (!slug && features.length) {
					const labels = features.map((f, i) => `${i + 1}. ${short(f.label, 110)}`);
					// RPC clients retain the standard dialog; terminal input belongs to the custom picker.
					if (ctx.mode !== "tui") {
						const choice = await ctx.ui.select("Resume which feature?", labels);
						if (!choice) return;
						slug = features[labels.indexOf(choice)].slug;
						break;
					}
					const choice = await ctx.ui.custom<{ slug: string; delete?: boolean } | undefined>((tui, theme, _keys, done) => {
						const container = new Container();
						container.addChild(new Text("Resume which feature?", 0, 0));
						const list = new SelectList(features.map((f, i) => ({ value: f.slug, label: labels[i] })), Math.min(features.length, 10), {
							selectedPrefix: (text) => theme.fg("accent", text),
							selectedText: (text) => theme.fg("accent", text),
							description: (text) => theme.fg("muted", text),
							scrollInfo: (text) => theme.fg("dim", text),
							noMatch: (text) => theme.fg("warning", text),
						});
						list.onSelect = (item) => done({ slug: item.value });
						list.onCancel = () => done(undefined);
						container.addChild(list);
						container.addChild(new Text("↑↓ navigate • enter resume • ctrl+d delete • esc cancel", 0, 0));
						return {
							capturesViewportInput: list.capturesViewportInput,
							render: (width) => container.render(width),
							invalidate: () => container.invalidate(),
							handleInput(data) {
								if (matchesKey(data, Key.ctrl("d"))) {
									const item = list.getSelectedItem();
									if (item) done({ slug: item.value, delete: true });
									return;
								}
								list.handleInput(data);
								tui.requestRender();
							},
						};
					}, { blocked: { kind: "question", message: "Resume which feature?" } });
					if (!choice) return;
					if (!choice.delete) { slug = choice.slug; break; }
					try {
						const info = await dt<{ key: string; featuresBase: string }>(ctx.cwd, ["info", "--json"]);
						if (!await ctx.ui.confirm(`Delete feature "${choice.slug}"?`, `Permanently delete ${join(info.featuresBase, choice.slug)} and all its saved files, including tickets and progress? Branches, worktrees, PRs and issues will not be deleted. Claimed tickets prevent deletion.`)) continue;
						if (!ctx.isIdle()) throw new Error("Wait for the current task to finish before deleting a feature.");
						const logic = await load(pathToFileURL(DT).href);
						logic.deleteFeature(info, choice.slug);
						const selected = restoreProject(ctx.sessionManager.getBranch(), info);
						if (selected?.slug === choice.slug) {
							pi.appendEntry(ENTRY, null);
							pi.appendEntry(SCOPE, null);
							pi.events.emit("dt:project:select", { project: null, repo: info, ctx });
						}
						features = features.filter((f) => f.slug !== choice.slug);
						ctx.ui.notify(`Deleted feature: ${choice.slug}`, "info");
					} catch (e) {
						ctx.ui.notify(`dt-resume: ${message(e)}`, "error");
					}
				}
				if (!slug) return;
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
			let commandsText = "Unavailable: could not read the local workflow state.";
			try {
				const logic = await load(pathToFileURL(DT).href);
				const repo = logic.resolveRepo(ctx.cwd);
				const snapshot = logic.readFeatureStatus(repo, slug);
				commandsText = nextCommandText(nextCommands({ project: { slug, tier: snapshot.feature.tier }, snapshot, branch: ctx.sessionManager.getBranch() }, logic));
			} catch { /* Report the snapshot gap without inventing a workflow transition. */ }
			pi.sendMessage({ customType: MESSAGE, content: namedText(sessionCommand(r.brief, slug)) + "\n\n## Next commands\n" + commandsText, display: true, details: { slug } });
		},
	});
}
