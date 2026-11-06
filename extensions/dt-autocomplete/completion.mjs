import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const COMMANDS = new Set(["dt-resume", "dt-spec", "dt-slice", "dt-lane", "dt-review", "dt-final-check", "dt-drift"]);
const TYPES = ["web", "device", "service", "cli", "mixed"];
const VALID_SLUG = /^[\w][\w.-]*$/;
const safeSlug = (slug) => VALID_SLUG.test(slug) && !slug.includes("..");

// A short, session-local cache coalesces keystrokes but sees newly created features.
export function createDataLoader(pi, dt, cwd, { now = Date.now, ttl = 2000 } = {}) {
	let pending;
	let expires = 0;
	return () => {
		if (!pending || now() >= expires) {
			expires = Infinity;
			pending = Promise.all(["info", "resume"].map(async (command) => {
				const args = [dt, command, "--json", ...(command === "resume" ? ["--no-gh"] : [])];
				const result = await pi.exec("node", args, { cwd, timeout: 5000 });
				if (result.code !== 0) throw new Error(result.stderr || "Cannot list features");
				return JSON.parse(result.stdout);
			})).then(([info, features]) => {
				if (typeof info.featuresBase !== "string" || !Array.isArray(features)) return null;
				return { base: info.featuresBase, features: features.filter((f) => typeof f.slug === "string" && safeSlug(f.slug)) };
			}).catch(() => null).finally(() => { expires = now() + ttl; });
		}
		return pending;
	};
}

async function tickets(base, slug) {
	if (!safeSlug(slug)) return [];
	const dir = join(base, slug, "tickets");
	let files;
	try { files = (await readdir(dir)).filter((f) => f.endsWith(".md")).sort(); }
	catch { return []; }
	return (await Promise.all(files.map(async (file) => {
		try {
			const text = await readFile(join(dir, file), "utf8");
			const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] || "";
			const scalar = (key) => {
				const value = fm.match(new RegExp(`^${key}:\\s*(.*)$`, "m"))?.[1] || "";
				return value.replace(/\s+#\s.*$/, "").trim().replace(/^["']|["']$/g, "");
			};
			const id = (scalar("id") || file.slice(0, 2)).padStart(2, "0");
			return /^\d{2}$/.test(id) ? { value: id, label: id, description: scalar("title") || file.replace(/\.md$/, "") } : null;
		} catch { return null; }
	}))).filter(Boolean);
}

function match(items, query, head = "") {
	const filtered = items.filter((item) => item.value.startsWith(query))
		.map((item) => ({ ...item, value: head + item.value }));
	return filtered.length ? filtered : null;
}

export async function completeArguments(command, args, load, project = null) {
	if (!COMMANDS.has(command)) return null;
	if (command === "dt-resume") {
		if (/\s/.test(args)) return null;
		const data = await load();
		return match((data?.features || []).map((f) => ({ value: f.slug, label: f.slug, description: f.label })), args);
	}
	if (!project) return null;
	if (command === "dt-spec") return match(TYPES.map((value) => ({ value, label: value })), args);
	if (!["dt-lane", "dt-review", "dt-final-check"].includes(command)) return null;
	const second = args.match(/^(\S+)([ \t]+)(\S*)$/);
	if (command === "dt-review" && second) {
		return match([{ value: "autofix", label: "autofix" }], second[3], second[1] + second[2]);
	}
	if (/\s/.test(args) || project.tier !== "T2") return null;
	const data = await load();
	if (!data || data.base !== project.base || !data.features.some((f) => f.slug === project.slug)) return null;
	const items = await tickets(data.base, project.slug);
	if (command === "dt-lane") items.unshift({ value: "next", label: "next", description: "Pick the next ready ticket" });
	return match(items, args);
}

export function createAutocompleteProvider(current, load, getProject = () => null) {
	return {
		triggerCharacters: current.triggerCharacters,
		async getSuggestions(lines, cursorLine, cursorCol, options) {
			const before = (lines[cursorLine] || "").slice(0, cursorCol);
			const command = before.match(/^\/(dt-[\w-]+) ([^\n]*)$/);
			if (!command || !COMMANDS.has(command[1])) return current.getSuggestions(lines, cursorLine, cursorCol, options);
			const items = await completeArguments(command[1], command[2], load, getProject());
			if (options.signal.aborted) return null;
			// Returning null leaves arbitrary new slugs and branch names as normal input.
			return items ? { items, prefix: command[2] } : null;
		},
		applyCompletion(...args) { return current.applyCompletion(...args); },
		shouldTriggerFileCompletion(...args) { return current.shouldTriggerFileCompletion?.(...args) ?? true; },
	};
}
