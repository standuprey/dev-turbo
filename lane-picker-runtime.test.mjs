import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const piPackage = process.env.PI_PACKAGE_DIR;
test("Pi input: lane displays and confirms before work; dt-show is read-only", { skip: !piPackage }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "dt-lane-picker-runtime-"));
  const previous = process.env.DT_DIR;
  process.env.DT_DIR = dir;
  t.after(async () => { if (previous === undefined) delete process.env.DT_DIR; else process.env.DT_DIR = previous; await rm(dir, { recursive: true, force: true }); });
  const base = join(dir, "features"), featureDir = join(base, "demo");
  const repo = { key: "org/repo", featuresBase: base, root: "/lane1", lanes: ["/lane1", "/lane2"], branch: "main" };
  const project = { slug: "demo", tier: "T2", type: "service", key: repo.key, base };
  await mkdir(join(featureDir, "tickets"), { recursive: true });
  await writeFile(join(featureDir, "feature.json"), JSON.stringify(project));
  const progress = JSON.stringify({ gates: { G1: { state: "approved" }, G2: { state: "approved" } }, tickets: { "01": { status: "in_progress", lane: "lane 2", claim: { owner: "other", checkout: "/lane2" } }, "03": { status: "review" }, "04": { status: "done" } } });
  await writeFile(join(featureDir, "progress.json"), progress);
  for (const id of ["01", "02", "03", "04"]) await writeFile(join(featureDir, "tickets", `${id}.md`), `---\nid: "${id}"\ntitle: Ticket ${id}\ntouches: [module${id}]\nblocked_by: []\nunsafe_with: []\n---\n`);
  await writeFile(join(dir, "dt.mjs"), `export { readFeatureStatus, pickReady, requireEpic, requiresJira } from ${JSON.stringify(new URL("./dt.mjs", import.meta.url).href)};\nexport const resolveRepo = () => (${JSON.stringify(repo)});\n`);
  const require = createRequire(join(piPackage, "package.json"));
  const { createJiti } = require("jiti");
  const jiti = createJiti(join(piPackage, "package.json"), { alias: {
    "@earendil-works/pi-coding-agent": join(piPackage, "dist/index.js"),
    "@earendil-works/pi-tui": join(piPackage, "../pi-tui/dist/index.js"),
    "@earendil-works/pi-ai": join(piPackage, "../pi-ai/dist/compat.js"),
  } });
  const session = await jiti.import(join(import.meta.dirname, "extensions/dt-session/index.ts"), { default: true });
  const handlers = new Map(), commands = new Map(), messages = [], confirmations = [], entries = [{ type: "custom", customType: "dt-project", data: project }], calls = [], notices = [], selections = [];
  let choice = "READY", confirmed = true;
  const ctx = { mode: "print", hasUI: true, cwd: "/lane1", sessionManager: { getBranch: () => entries, getSessionId: () => "here" }, ui: {
    setStatus() {}, setFooter() {}, notify: (s) => notices.push(s),
    select: async (title, labels) => { selections.push({ title, labels }); return choice === "cancel" ? undefined : labels.find((label) => label.includes(choice)); },
    confirm: async (title, body) => {
      confirmations.push({ title, body });
      assert.ok(body.includes(messages.at(-1).content), "ticket summary must be displayed before confirmation");
      return confirmed;
    },
  } };
  await session({
    on: (name, fn) => handlers.set(name, fn), events: { on() {} }, registerTool() {},
    registerMessageRenderer() {}, registerCommand: (name, command) => commands.set(name, command),
    sendMessage: (message) => messages.push(message),
    appendEntry: (customType, data) => entries.push({ type: "custom", customType, data }),
    exec: async (_command, args) => { calls.push(args); assert.equal(args[1], "info", "picker must not perform workflow writes"); return { code: 0, stdout: JSON.stringify(repo) }; },
  });
  await handlers.get("session_start")({}, ctx);
  const input = (text) => handlers.get("input")({ text, source: "interactive" }, ctx);
  assert.equal((await input("/dt-lane")).text, "/dt-lane demo 02");
  assert.match(selections[0].labels.find((s) => s.startsWith("01")), /LOCKED.*other.*\/lane2/);
  assert.equal((await input("/dt-lane 02")).text, "/dt-lane demo 02");
  assert.equal(selections.length, 1);
  assert.equal(confirmations.length, 2);
  assert.match(messages.at(-1).content, /02 · Ticket 02/);
  assert.doesNotMatch(messages.at(-1).content, /title:|touches:/);
  assert.match(messages.at(-1).content, /\/dt-show 02/);
  confirmed = false;
  assert.equal((await input("/dt-lane 02")).action, "handled");
  confirmed = undefined;
  assert.equal((await input("/dt-lane 02")).action, "handled");
  confirmed = true;
  choice = "cancel";
  assert.equal((await input("/dt-lane")).action, "handled");
  choice = "LOCKED";
  assert.equal((await input("/dt-lane")).action, "handled");
  assert.match(notices.at(-1), /LOCKED.*\/dt-lane 01 force/);
  assert.equal((await input("/dt-lane 01 force")).text, "/dt-lane demo 01 force");
  assert.match(confirmations.at(-1).body, /force takeover/);
  choice = "READY";
  assert.equal((await input("/dt-lane next")).text, "/dt-lane demo 02", "legacy next opens picker too");
  ctx.hasUI = false;
  assert.equal((await input("/dt-lane")).action, "handled");
  assert.match(notices.at(-1), /non-interactive/);
  assert.equal(selections.length, 4);
  const confirmationCount = confirmations.length;
  assert.equal((await input("/dt-lane 02")).action, "handled");
  assert.equal(confirmations.length, confirmationCount);
  assert.match(notices.at(-1), /requires confirmation/);
  const show = commands.get("dt-show").handler;
  await show("1", ctx); // locked tickets are still readable, including in non-UI mode
  assert.match(messages.at(-1).content, /^Status: IN PROGRESS\n\n---/);
  assert.match(messages.at(-1).content, /title: Ticket 01/);
  const messageCount = messages.length;
  await show("99", ctx);
  assert.match(notices.at(-1), /No ticket 99/);
  await show("../01", ctx);
  assert.match(notices.at(-1), /Usage/);
  await show("", ctx);
  assert.match(notices.at(-1), /non-interactive/);
  assert.equal(messages.length, messageCount);
  ctx.hasUI = true;
  choice = "01";
  await show("", ctx);
  assert.match(selections.at(-1).title, /Show a ticket/);
  assert.deepEqual(selections.at(-1).labels, ["01 · Ticket 01 · IN PROGRESS", "02 · Ticket 02 · TODO", "03 · Ticket 03 · REVIEW", "04 · Ticket 04 · DONE"]);
  assert.match(messages.at(-1).content, /title: Ticket 01/);
  choice = "cancel";
  await show("", ctx);
  assert.equal(messages.length, messageCount + 1);
  assert.equal(confirmations.length, confirmationCount, "dt-show must never ask to start work");
  assert.equal(await readFile(join(featureDir, "progress.json"), "utf8"), progress);
  assert.equal(entries.length, 1);
});
