/** Reload local helpers through Pi's existing jiti dependency, not Node's persistent ESM cache. */
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPackageDir } from "@earendil-works/pi-coding-agent";

export function createModuleLoader(from: string) {
	const require = createRequire(join(getPackageDir(), "package.json"));
	const { createJiti } = require("jiti");
	const jiti = createJiti(from, { moduleCache: false, fsCache: false, tryNative: false });
	// A fresh factory gets a fresh cache on /reload. Commands share loaded code within that runtime.
	const modules = new Map<string, Promise<any>>();
	return (specifier: string): Promise<any> => {
		const path = fileURLToPath(new URL(specifier, from));
		// jiti.import() delegates .mjs files to Node's cached native import. Sync evaluation
		// transpiles the whole local helper graph; these helpers have no top-level await.
		if (!modules.has(path)) modules.set(path, Promise.resolve().then(() => jiti(path)).catch((error: unknown) => { modules.delete(path); throw error; }));
		return modules.get(path)!;
	};
}
