/**
 * Load local helpers, bypassing Node's native ESM cache so /reload picks up edited .mjs files.
 *
 * Pi loads extensions through a jiti instance bundled inside its compiled binary, which makes
 * node-style require("jiti") unresolvable from the filesystem once pi is installed via mise
 * (no node_modules ships with the binary). Instead of fighting that, each loader instance
 * mirrors the requested module and its relative-import graph to a fresh temp dir and imports
 * the copy: dedicated URLs per instance, so the native ESM registry never serves stale code.
 * Helpers must not use bare third-party imports (node: builtins are fine) - enforced here.
 */
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Static ESM import/export statements with a quoted specifier: `import x from "…"`, `import "…"`, `export … from "…"`. */
const IMPORT_STATEMENT = /(?:^|[;\n]\s*)(?:import|export)\s+(?:[^'"`]*?\s+from\s+)?["'`]([^"'`]+)["'`]/g;

export function createModuleLoader(from: string) {
	// A fresh factory gets a fresh temp mirror on /reload. Commands share loaded code within that runtime.
	const uid = randomUUID();
	const modules = new Map<string, Promise<any>>();
	const copied = new Map<string, string>(); // real path -> mirrored path
	let root: Promise<string> | null = null;

	return (specifier: string): Promise<any> => {
		const path = fileURLToPath(new URL(specifier, from));
		if (!modules.has(path)) {
			root ??= mkdtemp(join(tmpdir(), `dt-helpers-${uid}-`)); // lazy: loaders that never load (e.g. help-only) leave no temp dirs
			const promise = (async () => {
				const mirrored = await mirror(path, await root);
				return import(pathToFileURL(mirrored).href);
			})();
			modules.set(path, promise.catch((error: unknown) => { modules.delete(path); throw error; }));
		}
		return modules.get(path)!;
	};

	async function mirror(real: string, base: string): Promise<string> {
		if (copied.has(real)) return copied.get(real)!;
		// Mirror the absolute path under the temp root so relative imports ("./x", "../y")
		// resolve exactly like they do in the real tree. This tree is Linux-only; the wide berth
		// for a leading "/" keeps the mapping trivial.
		const mirrored = join(base, real.startsWith("/") ? real.slice(1) : real);
		await mkdir(dirname(mirrored), { recursive: true });
		await copyFile(real, mirrored);
		copied.set(real, mirrored);
		for (const spec of importSpecifiers(await readFile(real, "utf8"))) {
			if (!spec.startsWith("./") && !spec.startsWith("../")) continue;
			const dep = fileURLToPath(new URL(spec, pathToFileURL(real).href));
			// Import-time would fail loudly for genuinely missing statics; skipping makes the
			// scan resilient to specifier-shaped strings in comments.
			try { if (!(await stat(dep)).isFile()) continue; } catch { continue; }
			await mirror(dep, base);
		}
		return mirrored;
	}
}

function importSpecifiers(source: string): string[] {
	const out: string[] = [];
	let match: RegExpExecArray | null;
	IMPORT_STATEMENT.lastIndex = 0;
	while ((match = IMPORT_STATEMENT.exec(source))) out.push(match[1]);
	return out;
}