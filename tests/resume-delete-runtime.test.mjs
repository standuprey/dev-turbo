import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, writeFile, readFile, readdir, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const pkg = process.env.PI_PACKAGE_DIR;
test("resume picker deletes the highlighted feature only after confirmation and preserves selection on cancel or failure", { skip: !pkg }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "dt-resume-delete-")), previous = process.env.DT_DIR;
  process.env.DT_DIR = dir;
  t.after(async () => { if (previous === undefined) delete process.env.DT_DIR; else process.env.DT_DIR = previous; await rm(dir, { recursive: true, force: true }); });
  const repo = { key: "org/repo", featuresBase: join(dir, "features") };
  for (const slug of ["catalog", "demo"]) {
    await mkdir(join(repo.featuresBase, slug), { recursive: true });
    await writeFile(join(repo.featuresBase, slug, "feature.json"), JSON.stringify({ slug, tier: "T2", type: "service" }));
    await writeFile(join(repo.featuresBase, slug, "progress.json"), "{}");
  }
  await writeFile(join(dir, "dt.mjs"), `export { deleteFeature } from ${JSON.stringify(new URL("../dt.mjs", import.meta.url).href)};\n`);
  const { createJiti } = createRequire(join(pkg, "package.json"))("jiti");
  const jiti = createJiti(join(pkg, "package.json"), { alias: {
    "@earendil-works/pi-coding-agent": join(pkg, "dist/index.js"),
    "@earendil-works/pi-tui": join(pkg, "../pi-tui/dist/index.js"),
  } });
  const extension = await jiti.import(join(import.meta.dirname, "../extensions/dt-resume.ts"), { default: true });
  let command, keys = [], confirmations = [];
  const notices = [], events = [], entries = [{ type: "custom", customType: "dt-project", data: { ...repo, base: repo.featuresBase, slug: "demo", tier: "T2", type: "service" } }];
  await extension({
    registerCommand(name, definition) { assert.equal(name, "dt-resume"); command = definition; },
    registerMessageRenderer() {},
    appendEntry(customType, data) { entries.push({ type: "custom", customType, data }); },
    events: { emit(name, data) { events.push({ name, data }); } },
    sendMessage() { throw new Error("Deleting must not resume or call the model"); },
    async exec(_command, args) {
      if (args[1] === "info") return { code: 0, stdout: JSON.stringify(repo) };
      assert.deepEqual(args.slice(1), ["resume", "--json"]);
      const features = (await readdir(repo.featuresBase)).map((slug) => ({ slug, label: slug }));
      return { code: 0, stdout: JSON.stringify(features) };
    },
  });
  const ctx = { cwd: "/repo", mode: "tui", hasUI: true, isIdle: () => true, sessionManager: { getBranch: () => entries }, ui: {
    notify(text) { notices.push(text); },
    async confirm(title, body) {
      assert.match(title, /Delete feature/);
      assert.match(body, /Permanently delete/);
      return confirmations.shift();
    },
    async custom(factory) {
      let result, finished = false;
      const component = factory({ requestRender() {} }, { fg: (_color, text) => text }, {}, (value) => { result = value; finished = true; });
      assert.match(component.render(80).join("\n"), /ctrl\+d delete/);
      for (const key of keys.shift()) component.handleInput(key);
      assert.equal(finished, true);
      return result;
    },
  } };
  const selected = () => entries.findLast((e) => e.customType === "dt-project").data;
  // Move down to demo: cancellation preserves files and the selected project.
  keys = [["\x1b[B", "\x04"], ["\x1b"]]; confirmations = [false];
  await command.handler("", ctx);
  assert.equal(selected().slug, "demo");
  assert.equal(await readFile(join(repo.featuresBase, "demo", "progress.json"), "utf8"), "{}");
  // A claim acquired before deletion is checked at the write boundary.
  await writeFile(join(repo.featuresBase, "demo", "progress.json"), JSON.stringify({ tickets: { "00": { claim: { owner: "busy" } } } }));
  keys = [["\x1b[B", "\x04"], ["\x1b"]]; confirmations = [true];
  await command.handler("", ctx);
  assert.match(notices.at(-1), /claimed tickets/);
  assert.equal(selected().slug, "demo");
  await access(join(repo.featuresBase, "demo", "feature.json"));
  // Deleting another feature keeps the selection, then deleting the selected final feature clears it.
  keys = [["\x04"], ["\x1b"]]; confirmations = [true];
  await command.handler("", ctx);
  await assert.rejects(access(join(repo.featuresBase, "catalog")), { code: "ENOENT" });
  assert.equal(selected().slug, "demo");
  await writeFile(join(repo.featuresBase, "demo", "progress.json"), "{}");
  keys = [["\x04"]]; confirmations = [true];
  await command.handler("", ctx);
  assert.equal(selected(), null);
  assert.equal(entries.at(-1).customType, "dt-scope-proposal");
  assert.equal(entries.at(-1).data, null);
  assert.equal(events.at(-1).data.project, null);
  assert.deepEqual(await readdir(repo.featuresBase), []);
  assert.deepEqual(keys, []);
});
