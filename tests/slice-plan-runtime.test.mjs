import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const pkg = process.env.PI_PACKAGE_DIR;
test("Pi slice-plan reads the explicitly selected project without model, network, claims or file changes", { skip: !pkg }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "dt-slice-plan-")), previous = process.env.DT_DIR;
  process.env.DT_DIR = dir;
  t.after(async () => { if (previous === undefined) delete process.env.DT_DIR; else process.env.DT_DIR = previous; await rm(dir, { recursive: true, force: true }); });
  const repo = { key: "org/repo", featuresBase: join(dir, "features") };
  const project = { slug: "demo", tier: "T2", type: "service", key: repo.key, base: repo.featuresBase };
  const folder = join(repo.featuresBase, "demo");
  await mkdir(join(folder, "tickets"), { recursive: true });
  await writeFile(join(folder, "feature.json"), JSON.stringify(project));
  const progress = JSON.stringify({ gates: { G2: { state: "approved" } }, tickets: { "00": { status: "review", prs: [{ state: "merged" }] } } });
  await writeFile(join(folder, "progress.json"), progress);
  for (const [id, dependencies] of [["00", ""], ["07", "00"], ["42", "00"], ["15", "07, 42"]]) {
    await writeFile(join(folder, "tickets", `${id}.md`), `---\nid: "${id}"\ntitle: Ticket ${id}\nblocked_by: [${dependencies}]\ntouches: [module${id}]\nunsafe_with: []\n---\n`);
  }
  await writeFile(join(dir, "dt.mjs"), `export { readFeatureStatus } from ${JSON.stringify(new URL("../dt.mjs", import.meta.url).href)};\nexport const resolveRepo = () => (${JSON.stringify(repo)});\n`);
  const { createJiti } = createRequire(join(pkg, "package.json"))("jiti");
  const jiti = createJiti(join(pkg, "package.json"), { alias: {
    "@earendil-works/pi-coding-agent": join(pkg, "dist/index.js"),
    "@earendil-works/pi-tui": join(pkg, "../pi-tui/dist/index.js"),
  } });
  const extension = await jiti.import(join(import.meta.dirname, "../extensions/dt-slice-plan/index.ts"), { default: true });
  let command, renderer, entries = [];
  const messages = [], notices = [];
  await extension({
    registerCommand(name, definition) { assert.equal(name, "dt-slice-plan"); command = definition; },
    registerMessageRenderer(name, render) { assert.equal(name, "dt-slice-plan"); renderer = render; },
    sendMessage(message) { messages.push(message); },
    exec() { throw new Error("No subprocesses from the extension"); },
    appendEntry() { throw new Error("Do not change selection"); },
    sendUserMessage() { throw new Error("Do not start the model"); },
  });
  const ctx = { cwd: "/repo", mode: "rpc", hasUI: true, sessionManager: { getBranch: () => entries }, ui: { notify(message) { notices.push(message); } } };
  await command.handler("", ctx);
  assert.match(notices.at(-1), /No dev-turbo project selected/);
  assert.equal(messages.length, 0);
  entries = [{ type: "custom", customType: "dt-project", data: project }];
  await command.handler("demo", ctx);
  assert.match(notices.at(-1), /Usage: \/dt-slice-plan/);
  const files = await readdir(folder);
  await command.handler("", ctx);
  assert.equal(messages.at(-1).content, "Slice 1: 07, 42\nSlice 2: 15");
  assert.equal(messages.at(-1).display, true);
  const rendered = renderer(messages.at(-1), { outputPad: 1 }, { bg: (_color, text) => text }).render(80).join("\n");
  assert.match(rendered, /Slice 1: 07, 42/);
  assert.match(rendered, /Slice 2: 15/);
  assert.equal(await readFile(join(folder, "progress.json"), "utf8"), progress);
  assert.deepEqual(await readdir(folder), files);
  entries.push({ type: "custom", customType: "dt-project", data: { ...project, key: "other/repo" } });
  const count = messages.length;
  await command.handler("", ctx);
  assert.match(notices.at(-1), /does not match this repository/);
  assert.equal(messages.length, count);
  entries.push({ type: "custom", customType: "dt-project", data: null });
  await command.handler("", ctx);
  assert.match(notices.at(-1), /No dev-turbo project selected/);
  entries = [{ type: "custom", customType: "dt-project", data: project }];
  await writeFile(join(folder, "progress.json"), "invalid JSON");
  await command.handler("", ctx);
  assert.match(notices.at(-1), /cannot parse/);
  assert.equal(messages.length, count);
});
