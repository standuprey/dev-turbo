import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const pkg = process.env.PI_PACKAGE_DIR;
test("Pi /reload gets updated helper dependencies despite native ESM caching", { skip: !pkg }, async (t) => {
	const dir = await mkdtemp(join(tmpdir(), "dt-reload-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	const dependency = join(dir, "dependency.mjs");
	await writeFile(dependency, 'export const value = "before";');
	await writeFile(join(dir, "helper.mjs"), 'import { value } from "./dependency.mjs"; export { value };');
	const runtime = new URL("./extensions/dt-session/runtime.ts", import.meta.url).href;
	await writeFile(join(dir, "index.ts"), `import { createModuleLoader } from ${JSON.stringify(runtime)}; export default async function () { const load = createModuleLoader(import.meta.url); const { value } = await load("./helper.mjs"); return value; }`);
	const { createJiti } = createRequire(join(pkg, "package.json"))("jiti");
	const options = { moduleCache: false, alias: { "@earendil-works/pi-coding-agent": join(pkg, "dist/index.js") } };
	assert.equal((await import(pathToFileURL(dependency).href)).value, "before");
	const first = await createJiti(join(pkg, "package.json"), options).import(join(dir, "index.ts"), { default: true });
	assert.equal(await first(), "before");
	await writeFile(dependency, 'export const value = "after";');
	assert.equal((await import(pathToFileURL(dependency).href)).value, "before"); // The bug we must bypass.
	const reloaded = await createJiti(join(pkg, "package.json"), options).import(join(dir, "index.ts"), { default: true });
	assert.equal(await reloaded(), "after");
});
