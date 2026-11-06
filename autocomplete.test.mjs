import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { completeArguments, createAutocompleteProvider, createDataLoader } from "./extensions/dt-autocomplete/completion.mjs";

const features = [{ slug: "checkout", label: "checkout · slicing" }, { slug: "catalog", label: "catalog · spec" }];
const project = { slug: "checkout", base: "/missing", tier: "T2", type: "service" };
const values = (items) => items?.map((i) => i.value);
const load = async () => ({ base: "/missing", features });

test("only resume completes project slugs; unselected workflow commands have no suggestions", async () => {
	assert.deepEqual(values(await completeArguments("dt-resume", "ch", load)), ["checkout"]);
	assert.deepEqual(values(await completeArguments("dt-resume", "", load)), ["checkout", "catalog"]);
	assert.equal(await completeArguments("dt-resume", "checkout extra", load), null);
	for (const command of ["dt-status", "dt-spec", "dt-slice", "dt-lane", "dt-review", "dt-drift", "dt-grill", "dt-quick"]) {
		assert.equal(await completeArguments(command, "", () => { throw new Error("must not load"); }), null);
	}
});

test("task types complete for the selected project without loading repo data", async () => {
	assert.deepEqual(values(await completeArguments("dt-spec", "s", () => { throw new Error("must not load"); }, project)), ["service"]);
	assert.deepEqual(values(await completeArguments("dt-spec", "", load, project)), ["web", "device", "service", "cli", "mixed"]);
});

test("selected project's current ticket files supply IDs, titles and next", async (t) => {
	const base = await mkdtemp(join(tmpdir(), "dt-autocomplete-"));
	t.after(() => rm(base, { recursive: true, force: true }));
	const dir = join(base, "checkout", "tickets");
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "00-skeleton.md"), '---\nid: "00"\ntitle: Walking skeleton\n---\n');
	await writeFile(join(dir, "01-old-number.md"), "---\r\nid: '07'\r\ntitle: 'Ship checkout' # note\r\n---\r\n");
	await writeFile(join(dir, "notes.md"), "Not a ticket");
	const get = async () => ({ base, features });
	const selected = { ...project, base };
	const items = await completeArguments("dt-lane", "", get, selected);
	assert.deepEqual(values(items), ["00", "07"]);
	assert.equal(items[1].description, "Ship checkout");
	assert.deepEqual(values(await completeArguments("dt-review", "0", get, selected)), ["00", "07"]);
	assert.equal(await completeArguments("dt-final-check", "0", get, selected), null);
	assert.equal(await completeArguments("dt-final-check", "07 a", get, selected), null);
	assert.equal(await completeArguments("dt-lane", "n", get, selected), null);
	assert.deepEqual(values(await completeArguments("dt-lane", "07 f", get, selected)), ["07 force"]);
	assert.equal(await completeArguments("dt-lane", "next f", get, selected), null);
	assert.deepEqual(values(await completeArguments("dt-review", "07 a", get, selected)), ["07 autofix"]);
	assert.equal(await completeArguments("dt-review", "my-branch", get, selected), null);
	assert.equal(await completeArguments("dt-review", "checkout 07 autofix", get, selected), null);
	assert.equal(await completeArguments("dt-review", "", get, { ...selected, base: "/other-repo" }), null);
	await writeFile(join(dir, "08-new.md"), '---\nid: "08"\ntitle: New ticket\n---\n');
	assert.deepEqual(values(await completeArguments("dt-review", "08", get, selected)), ["08"]);
	assert.equal(await completeArguments("dt-lane", "", get, { ...selected, slug: "catalog" }), null);
});

test("provider preserves other completions and sees project switches immediately", async () => {
	let delegated = 0;
	const current = {
		triggerCharacters: ["#"],
		async getSuggestions() { delegated++; return { items: [], prefix: "fallback" }; },
		applyCompletion(lines, row, col, item, prefix) {
			return { lines: [lines[row].slice(0, col - prefix.length) + item.value + lines[row].slice(col)], cursorLine: row, cursorCol: col - prefix.length + item.value.length };
		},
		shouldTriggerFileCompletion() { return false; },
	};
	let selected = null;
	const provider = createAutocompleteProvider(current, load, () => selected);
	const options = { signal: new AbortController().signal };
	const line = "/dt-resume ch suffix";
	const result = await provider.getSuggestions([line], 0, 13, options);
	assert.equal(result.prefix, "ch");
	assert.deepEqual(provider.applyCompletion([line], 0, 13, result.items[0], result.prefix).lines, ["/dt-resume checkout suffix"]);
	assert.equal(await provider.getSuggestions(["/dt-spec s"], 0, 10, options), null);
	selected = project;
	assert.deepEqual(values((await provider.getSuggestions(["/dt-spec s"], 0, 10, options)).items), ["service"]);
	for (const line of ["/dt-grill ch", "/dt-quick a task", "/dt-st", "text /dt-resume ch", "@file"]) {
		assert.equal((await provider.getSuggestions([line], 0, line.length, options)).prefix, "fallback");
	}
	assert.equal(delegated, 5);
	assert.deepEqual(provider.triggerCharacters, ["#"]);
	assert.equal(provider.shouldTriggerFileCompletion([], 0, 0), false);
	const abort = new AbortController(); abort.abort();
	assert.equal(await provider.getSuggestions(["/dt-resume ch"], 0, 13, { signal: abort.signal }), null);
});

test("local loader coalesces calls, expires, isolates cwd, and rejects unsafe slugs", async () => {
	let clock = 0;
	const calls = [];
	const pi = { async exec(command, args, options) {
		calls.push({ command, args, options });
		return { code: 0, stdout: JSON.stringify(args[1] === "info" ? { featuresBase: "/features" } : [...features, { slug: "../escape" }]) };
	} };
	const get = createDataLoader(pi, "/dt/dt.mjs", "/repo-one", { now: () => clock });
	const [a, b] = await Promise.all([get(), get()]);
	assert.equal(a, b); assert.deepEqual(a.features, features); assert.equal(calls.length, 2);
	await get(); assert.equal(calls.length, 2);
	clock = 2001; await get(); assert.equal(calls.length, 4);
	await createDataLoader(pi, "/dt/dt.mjs", "/repo-two")();
	assert.equal(calls.at(-1).options.cwd, "/repo-two");
	assert.ok(calls.every((c) => c.command === "node" && c.options.timeout === 5000));
	assert.ok(calls.filter((c) => c.args[1] === "resume").every((c) => c.args.includes("--no-gh") && c.args.length === 4));
});

test("bad CLI output quietly returns no suggestions", async () => {
	for (const response of [{ code: 1, stderr: "not a repo" }, { code: 0, stdout: "invalid" }, { code: 0, stdout: "{}" }]) {
		const get = createDataLoader({ exec: async () => response }, "/dt", "/missing");
		assert.equal(await get(), null);
		assert.equal(await completeArguments("dt-resume", "", get), null);
	}
});
