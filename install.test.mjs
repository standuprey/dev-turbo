import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("install replaces the old start command while preserving user data", async (t) => {
	const dir = await mkdtemp(join(tmpdir(), "dt-install-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	await mkdir(join(dir, "prompts"));
	await mkdir(join(dir, "dt", "features"), { recursive: true });
	await writeFile(join(dir, "prompts", "dt-grill.md"), "Obsolete prompt");
	await writeFile(join(dir, "dt", "config.json"), "{}");
	await writeFile(join(dir, "dt", "features", "saved.md"), "Saved feature");
	execFileSync("bash", [join(import.meta.dirname, "install.sh")], { env: { ...process.env, PI_AGENT_DIR: dir } });
	assert.equal(await readFile(join(dir, "prompts", "dt-start.md"), "utf8"), await readFile(new URL("./prompts/dt-start.md", import.meta.url), "utf8"));
	await assert.rejects(access(join(dir, "prompts", "dt-grill.md")), { code: "ENOENT" });
	assert.equal(await readFile(join(dir, "dt", "config.json"), "utf8"), "{}");
	assert.equal(await readFile(join(dir, "dt", "features", "saved.md"), "utf8"), "Saved feature");
});
