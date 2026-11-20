import fs from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const piPackage = process.env.PI_PACKAGE_DIR;
test("Pi input: lane displays and confirms before work; dt-status <id> is read-only", { skip: !piPackage }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "dt-lane-picker-runtime-"));
  const previous = process.env.DT_DIR;
  process.env.DT_DIR = dir;
  t.after(async () => { if (previous === undefined) delete process.env.DT_DIR; else process.env.DT_DIR = previous; await rm(dir, { recursive: true, force: true }); });
  const base = join(dir, "features"), featureDir = join(base, "demo");
  const repo = { key: "org/repo", featuresBase: base, root: "/lane1", lanes: ["/lane1", "/lane2"], branch: "main" };
  const project = { slug: "demo", tier: "T2", type: "service", key: repo.key, base };
  await mkdir(join(featureDir, "tickets"), { recursive: true });
  await writeFile(join(featureDir, "feature.json"), JSON.stringify(project));
  const progress = JSON.stringify({ gates: { G0: { state: "approved" }, G2: { state: "approved" } }, tickets: { "01": { status: "in_progress", branch: "ticket/demo-01", lane: "lane 2", claim: { owner: "other", checkout: "/lane2" } }, "03": { status: "review", branch: "custom-review-branch" }, "04": { status: "done" } } });
  await writeFile(join(featureDir, "progress.json"), progress);
  for (const id of ["01", "02", "03", "04"]) await writeFile(join(featureDir, "tickets", `${id}.md`), `---\nid: "${id}"\ntitle: Ticket ${id}\ntouches: [module${id}]\nblocked_by: []\nunsafe_with: []\n---\n`);
  await writeFile(join(dir, "dt.mjs"), `export { readFeatureStatus, pickReady } from ${JSON.stringify(new URL("../dt.mjs", import.meta.url).href)};\nexport const resolveRepo = () => (${JSON.stringify(repo)});\n`);
  const require = createRequire(join(piPackage, "package.json"));
  const { createJiti } = require("jiti");
  const jiti = createJiti(join(piPackage, "package.json"), { alias: {
    "@earendil-works/pi-coding-agent": join(piPackage, "dist/index.js"),
    "@earendil-works/pi-tui": join(piPackage, "../pi-tui/dist/index.js"),
    "@earendil-works/pi-ai": (fs.existsSync(join(piPackage, "dist/core/extensions/pi-ai-extension-view.js")) ? join(piPackage, "dist/core/extensions/pi-ai-extension-view.js") : join(piPackage, "../pi-ai/dist/compat.js")),
  } });
  const session = await jiti.import(join(import.meta.dirname, "../extensions/dt-session/index.ts"), { default: true });
  const handlers = new Map(), commands = new Map(), messages = [], confirmations = [], entries = [{ type: "custom", customType: "dt-project", data: project }], calls = [], notices = [], selections = [];
  let choice = "READY", confirmed = true, dependencyWarnings = [], onConfirm;
  const ctx = { mode: "print", hasUI: true, cwd: "/lane1", sessionManager: { getBranch: () => entries, getSessionId: () => "here" }, ui: {
    setStatus() {}, setFooter() {}, notify: (s) => notices.push(s),
    select: async (title, labels) => { selections.push({ title, labels }); return choice === "cancel" ? undefined : labels.find((label) => label.includes(choice)); },
    confirm: async (title, body) => {
      confirmations.push({ title, body });
      assert.ok(body.includes(messages.at(-1).content), "ticket summary must be displayed before confirmation");
      if (onConfirm) await onConfirm();
      return confirmed;
    },
  } };
  await session({
    on: (name, fn) => handlers.set(name, fn), events: { on() {} }, registerTool() {},
    registerMessageRenderer() {}, registerCommand: (name, command) => commands.set(name, command),
    sendMessage: (message) => messages.push(message),
    appendEntry: (customType, data) => entries.push({ type: "custom", customType, data }),
    exec: async (_command, args) => {
      calls.push(args);
      if (args[1] === "info") return { code: 0, stdout: JSON.stringify(repo) };
      assert.equal(args[1], "next");
      assert.ok(args.includes("--check-only"), "confirmation must not perform workflow writes");
      const id = args[args.indexOf("--ticket") + 1];
      const warnings = id === "01" ? ["ticket belongs to checkout /lane2", ...(!args.includes("--force") ? ["ticket claimed by other; takeover does not stop the previous agent"] : [])] : dependencyWarnings;
      return { code: 0, stdout: JSON.stringify({ warnings }) };
    },
  });
  await handlers.get("session_start")({}, ctx);
  const input = (text) => handlers.get("input")({ text, source: "interactive" }, ctx);
  assert.equal((await input("/dt-lane")).text, "/dt-lane demo 02");
  assert.match(selections[0].labels.find((s) => s.startsWith("01")), /LOCKED.*other.*\/lane2/);
  assert.ok(selections[0].labels.find((s) => s.startsWith("01")).includes("Ticket 01 (ticket/demo-01)"));
  assert.ok(selections[0].labels.find((s) => s.startsWith("03")).includes("Ticket 03 (custom-review-branch)"));
  assert.ok(selections[0].labels.find((s) => s.startsWith("02")).includes("Ticket 02 · READY"));
  assert.equal((await input("/dt-lane 02")).text, "/dt-lane demo 02");
  assert.equal(selections.length, 1);
  assert.equal(confirmations.length, 2);
  assert.match(messages.at(-1).content, /02 · Ticket 02/);
  assert.doesNotMatch(messages.at(-1).content, /Ticket 02 \(.*\)/);
  assert.doesNotMatch(messages.at(-1).content, /title:|touches:/);
  assert.match(messages.at(-1).content, /\/dt-status 02/);
  confirmed = false;
  assert.equal((await input("/dt-lane 02")).action, "handled");
  confirmed = undefined;
  assert.equal((await input("/dt-lane 02")).action, "handled");
  confirmed = true;
  choice = "cancel";
  assert.equal((await input("/dt-lane")).action, "handled");
  choice = "LOCKED";
  assert.equal((await input("/dt-lane")).text, "/dt-lane demo 01 override");
  assert.match(confirmations.at(-1).title, /Start anyway/);
  assert.match(confirmations.at(-1).body, /claimed by other/);
  assert.ok(confirmations.at(-1).title.includes("ticket 01 (ticket/demo-01)"));
  assert.ok(confirmations.at(-1).body.includes("Ticket 01 (ticket/demo-01)"));
  assert.ok(messages.at(-1).content.includes("Ticket 01 (ticket/demo-01)"));
  confirmed = false;
  assert.equal((await input("/dt-lane 01 override")).action, "handled");
  confirmed = true;
  assert.equal((await input("/dt-lane 01 force")).text, "/dt-lane demo 01 override");
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
  assert.equal((await input("/dt-lane 02 override")).text, "/dt-lane demo 02 override");
  assert.equal(confirmations.length, confirmationCount, "an explicit non-UI override is its own consent");
  const status = await jiti.import(join(import.meta.dirname, "../extensions/dt-status/index.ts"), { default: true });
  await status({ registerMessageRenderer() {}, registerCommand: (name, command) => commands.set(name, command), sendMessage: (message) => messages.push(message) });
  const show = (args) => commands.get("dt-status").handler(args, ctx);
  await show("1"); // locked tickets are still readable, including in non-UI mode
  assert.match(messages.at(-1).content, /^Status: IN PROGRESS\n\n---/);
  assert.match(messages.at(-1).content, /\*\*Owner:\*\* other/);
  assert.match(messages.at(-1).content, /\*\*Checkout:\*\* \/lane2/);
  assert.ok(messages.at(-1).content.indexOf("title: Ticket 01") < messages.at(-1).content.indexOf("## Saved ticket progress"));
  assert.doesNotMatch(messages.at(-1).content, /```json/);
  assert.match(messages.at(-1).content, /title: Ticket 01/);
  await show("2");
  assert.match(messages.at(-1).content, /No saved progress for this ticket/);
  assert.match(messages.at(-1).content, /title: Ticket 02/);
  const messageCount = messages.length;
  await show("99");
  assert.match(notices.at(-1), /No ticket 99/);
  await show("../01");
  assert.match(notices.at(-1), /No ticket saved for branch/);
  assert.equal(messages.length, messageCount);
  await show("");
  assert.match(messages.at(-1).content, /^\| ID \| Ticket \| State \| Saved verification \| Notes \|/);
  assert.deepEqual(messages.at(-1).content.split("\n").slice(2).map((line) => line.split("|")[1].trim()), ["01", "02", "03"]);
  assert.equal(confirmations.length, confirmationCount, "dt-status must never ask to start work");
  assert.equal(await readFile(join(featureDir, "progress.json"), "utf8"), progress);
  assert.equal(entries.length, 1);

  await writeFile(join(featureDir, "tickets/02.md"), '---\nid: "02"\ntitle: Ticket 02\ntouches: [module03]\nblocked_by: ["03"]\nunsafe_with: []\n---\n');
  dependencyWarnings = ["02: blocked by 03", "02: touches module03, already in flight in ticket 03"];
  ctx.hasUI = true;
  choice = "Wait for";
  const beforeWait = confirmations.length;
  assert.equal((await input("/dt-lane 02")).action, "handled");
  assert.equal(confirmations.length, beforeWait, "waiting never asks to override start warnings");
  assert.match(selections.at(-1).title, /blocked by 03.*in review/);
  choice = "cancel";
  assert.equal((await input("/dt-lane 02")).action, "handled");
  choice = "Stack PR";
  dependencyWarnings.push("working tree is not clean");
  confirmed = false;
  assert.equal((await input("/dt-lane 02")).action, "handled");
  assert.equal(messages.filter((m) => m.customType === "dt-stack-decision").length, 0);
  assert.match(confirmations.at(-1).body, /working tree is not clean/);
  assert.doesNotMatch(confirmations.at(-1).body, /blocked by 03|touches module03/);
  dependencyWarnings.pop();
  const beforeStackConfirmations = confirmations.length;
  assert.equal((await input("/dt-lane 02")).text, "/dt-lane demo 02 override");
  assert.equal(confirmations.length, beforeStackConfirmations, "the stack choice already confirms starting and its overlap warnings");
  confirmed = true;
  const consent = messages.at(-1);
  assert.equal(consent.customType, "dt-stack-decision");
  assert.match(consent.content, /User explicitly chose to stack PR.*ticket 02 on ticket 03/);
  assert.equal(consent.details.branch, "custom-review-branch");
  assert.match(selections.at(-1).title, /accepts its dependency and shared-code warnings for ticket 03/);
  const consentCount = messages.filter((m) => m.customType === "dt-stack-decision").length;
  choice = "Start without";
  assert.equal((await input("/dt-lane 02")).text, "/dt-lane demo 02 override");
  assert.equal(messages.filter((m) => m.customType === "dt-stack-decision").length, consentCount, "start-warning consent never grants stack consent");
  choice = "Stack PR";
  dependencyWarnings.push("working tree is not clean");
  onConfirm = async () => {
    const changed = JSON.parse(progress);
    changed.tickets["03"].status = "done";
    await writeFile(join(featureDir, "progress.json"), JSON.stringify(changed));
  };
  assert.equal((await input("/dt-lane 02")).action, "handled");
  assert.match(notices.at(-1), /Review dependency changed during confirmation/);
  assert.equal(messages.filter((m) => m.customType === "dt-stack-decision").length, consentCount);
  await writeFile(join(featureDir, "progress.json"), progress);
  assert.equal(await readFile(join(featureDir, "progress.json"), "utf8"), progress);
});
