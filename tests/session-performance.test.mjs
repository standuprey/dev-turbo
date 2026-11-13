import fs from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBranchReader, WORKFLOW } from "../extensions/dt-session/branch.mjs";
import { createProjectFooter } from "../extensions/dt-session/footer.mjs";

function history() {
  const entries = new Map();
  let leaf = null, session = "one", sequence = 0;
  const calls = { branch: 0, entry: 0 };
  const manager = {
    getSessionId: () => session, getLeafId: () => leaf, getEntryCount: () => entries.size,
    getEntry(id) { calls.entry++; return entries.get(id); },
    getBranch() {
      calls.branch++;
      const branch = [];
      for (let entry = entries.get(leaf); entry; entry = entries.get(entry.parentId)) branch.push(entry);
      return branch.reverse();
    },
  };
  return { manager, calls,
    append(data) { const id = String(++sequence); entries.set(id, { ...data, id, parentId: leaf }); leaf = id; return id; },
    custom(customType, data) { return this.append({ type: "custom", customType, data }); },
    move(id) { leaf = id; },
    session(id) { session = id; },
  };
}

test("metadata reads reuse unchanged ancestry and inspect only appended entries", () => {
  const h = history(), reader = createBranchReader();
  for (let i = 0; i < 10000; i++) h.append({ type: "message" });
  const root = h.custom("dt-project", { slug: "demo" });
  const first = reader.read(h.manager);
  assert.equal(first.length, 1);
  assert.equal(h.calls.branch, 1);
  for (let i = 0; i < 100; i++) assert.equal(reader.read(h.manager), first);
  assert.equal(h.calls.entry, 0);
  for (let i = 0; i < 100; i++) h.append({ type: "message" });
  assert.equal(reader.read(h.manager), first);
  assert.equal(h.calls.entry, 100);
  assert.equal(h.calls.branch, 1);
  h.custom("dt-scope-proposal", { slug: "next" });
  assert.equal(reader.read(h.manager).length, 2);
  h.move(root);
  assert.deepEqual(reader.read(h.manager).map(e => e.customType), ["dt-project"]);
  h.move(null);
  assert.deepEqual(reader.read(h.manager), []);
  h.custom(WORKFLOW, { cwd: "/repo" });
  assert.equal(reader.read(h.manager).length, 1);
  h.session("two");
  const reads = h.calls.branch;
  reader.read(h.manager);
  assert.equal(h.calls.branch, reads + 1);
  reader.invalidate();
  reader.read(h.manager);
  assert.equal(h.calls.branch, reads + 2);
});

test("metadata reads support hosts without entry lookup and discard unrelated custom state", () => {
  const reader = createBranchReader();
  let entries = [{ type: "custom", customType: "other", data: {} }];
  const manager = { getBranch: () => entries };
  assert.deepEqual(reader.read(manager), []);
  entries = [{ type: "custom", customType: WORKFLOW, data: { cwd: "/repo" } }];
  assert.equal(reader.read(manager).length, 1);
});

test("footer redraws retain numeric caches but refresh after history or model changes", () => {
  let count = 1, leaf = "a", totalsReads = 0, contextReads = 0, color = "one";
  const ctx = {
    model: { id: "model", provider: "provider", contextWindow: 200000 },
    modelRegistry: { isUsingOAuth: () => false },
    getContextUsage() { contextReads++; return { percent: count, contextWindow: ctx.model.contextWindow }; },
    sessionManager: {
      getSessionId: () => "one", getLeafId: () => leaf, getEntryCount: () => count,
      getEntries() { totalsReads++; return [{ type: "usage", usage: { input: count } }]; },
      getCwd: () => "/repo", getSessionName: () => undefined,
    },
  };
  const data = { onBranchChange: () => () => {}, getGitBranch: () => "main", getAvailableProviderCount: () => 1, getExtensionStatuses: () => new Map() };
  const format = { visibleWidth: s => s.length, truncateToWidth: (s, width) => s.slice(0, Math.max(0, width)) };
  const footer = createProjectFooter(ctx, {}, { fg: (_, s) => color + s }, data, { requestRender() {} }, () => ({ slug: "demo" }), format);
  for (let i = 0; i < 100; i++) { footer.invalidate(); footer.render(120); }
  assert.equal(totalsReads, 1);
  assert.equal(contextReads, 1);
  color = "two";
  footer.invalidate();
  assert.ok(footer.render(120)[0].startsWith("two"));
  assert.equal(contextReads, 1);
  count++; leaf = "b";
  assert.match(footer.render(120)[1], /↑2/);
  assert.equal(contextReads, 2);
  leaf = "a";
  footer.render(120);
  assert.equal(contextReads, 3);
  ctx.model = { ...ctx.model, id: "other-model" };
  footer.render(120);
  assert.equal(contextReads, 4);
  ctx.model.contextWindow = 100000;
  assert.match(footer.render(120)[1], /100k/);
  assert.equal(contextReads, 5);
  footer.dispose();
});

const pkg = process.env.PI_PACKAGE_DIR;
test("Pi runtime: idle sessions stay dormant and active input reuses state without hidden messages", { skip: !pkg }, async t => {
  const dir = await mkdtemp(join(tmpdir(), "dt-session-performance-"));
  const previous = process.env.DT_DIR;
  process.env.DT_DIR = dir;
  t.after(async () => { if (previous === undefined) delete process.env.DT_DIR; else process.env.DT_DIR = previous; await rm(dir, { recursive: true, force: true }); });
  // Omit command-only modules: loading the extension must not need them.
  for (const file of ["index.ts", "runtime.ts", "state.mjs", "gates.mjs", "approval-guard.mjs", "footer.mjs", "branch.mjs", "ticket-screenshots.mjs", "exec-json.mjs"]) {
    await writeFile(join(dir, file), await readFile(new URL(`../extensions/dt-session/${file}`, import.meta.url)));
  }
  const { createJiti } = createRequire(join(pkg, "package.json"))("jiti");
  const jiti = createJiti(join(pkg, "package.json"), { moduleCache: false, alias: {
    "@earendil-works/pi-coding-agent": join(pkg, "dist/index.js"),
    "@earendil-works/pi-tui": join(pkg, "../pi-tui/dist/index.js"),
    "@earendil-works/pi-ai": (fs.existsSync(join(pkg, "dist/core/extensions/pi-ai-extension-view.js")) ? join(pkg, "dist/core/extensions/pi-ai-extension-view.js") : join(pkg, "../pi-ai/dist/compat.js")),
  } });
  const factory = await jiti.import(join(dir, "index.ts"), { default: true });
  const h = history(), handlers = new Map(), events = new Map(), tools = new Map();
  const repo = { key: "org/repo", featuresBase: join(dir, "features") };
  const project = { slug: "demo", tier: "T2", type: "service", key: repo.key, base: repo.featuresBase };
  let processes = 0, footerChanges = 0, renders = 0, statuses = 0;
  const ctx = { cwd: "/repo", mode: "tui", hasUI: true, sessionManager: h.manager, ui: {
    notify() {}, setStatus() { statuses++; },
    setFooter(factory) {
      footerChanges++;
      factory?.({ requestRender() { renders++; } }, {}, { onBranchChange: () => () => {} });
    },
  } };
  const pi = {
    on: (name, fn) => handlers.set(name, fn),
    events: { on: (name, fn) => events.set(name, fn) },
    registerCommand() {}, registerMessageRenderer() {}, registerTool: tool => tools.set(tool.name, tool),
    appendEntry: (type, data) => h.custom(type, data),
    async exec() { processes++; return { code: 0, stdout: JSON.stringify(repo) }; },
  };
  await factory(pi);
  const input = text => handlers.get("input")({ text, source: "interactive" }, ctx);
  const before = () => {
    const event = { systemPromptOptions: { sections: {} } };
    assert.equal(handlers.get("before_agent_start")(event, ctx), undefined);
    return event.systemPromptOptions.sections.dt_project_context;
  };
  await handlers.get("session_start")({}, ctx);
  const initialReads = h.calls.branch;
  for (let i = 0; i < 100; i++) {
    assert.equal((await input("ordinary input")).action, "continue");
    assert.equal(before(), undefined);
  }
  assert.equal(h.calls.branch, initialReads);
  assert.equal(h.calls.entry, 0);
  assert.equal(processes, 0);
  assert.equal(footerChanges, 0);
  assert.equal(statuses, 0);
  assert.equal((await input("/dt-lane")).action, "handled");
  assert.equal(processes, 0);
  await input("/dt-start a task");
  assert.match(before(), /Lane claim owner for this session: one/);
  assert.equal(processes, 0);
  // Restoring an unfinished conversation uses its stored activation marker.
  await handlers.get("session_start")({}, ctx);
  assert.match(before(), /No project selected/);
  assert.equal(processes, 0);
  h.move(null); h.session("new");
  await handlers.get("session_start")({}, ctx);
  assert.equal(before(), undefined);
  assert.equal(processes, 0);
  // Historical injected messages are not proof that the user started a workflow.
  h.custom("dt-project-context", { content: "No project selected" });
  await handlers.get("session_start")({}, ctx);
  assert.equal(before(), undefined);
  assert.equal(footerChanges, 0);
  const selectedLeaf = h.custom("dt-project", project);
  await handlers.get("session_start")({}, ctx);
  assert.equal(processes, 1);
  assert.equal(footerChanges, 1);
  const content = before();
  assert.match(content, /Selected dev-turbo project: demo/);
  const activeReads = h.calls.branch;
  for (let i = 0; i < 100; i++) {
    h.append({ type: "message" });
    await input("ordinary input");
    assert.equal(before(), content);
    const request = { project: null };
    events.get("dt:project:get")(request);
    assert.equal(request.project.slug, "demo");
  }
  assert.equal(h.calls.branch, activeReads);
  assert.equal(processes, 1);
  assert.equal(footerChanges, 1);
  const next = { ...project, slug: "other" };
  h.custom("dt-project", next);
  events.get("dt:project:select")({ project: next, repo, ctx });
  assert.match(before(), /project: other/);
  assert.equal(footerChanges, 1);
  assert.ok(renders > 0);
  h.move(selectedLeaf);
  await handlers.get("session_tree")({}, ctx);
  assert.match(before(), /project: demo/);
  assert.equal(footerChanges, 1);
  h.move(null);
  await handlers.get("session_tree")({}, ctx);
  assert.equal(before(), undefined);
  assert.equal(footerChanges, 2);
  // A successfully saved proposal also activates context without selecting a project.
  const params = { slug: "proposed", tier: "T1", type: "cli", note: "Improve input latency" };
  await mkdir(join(repo.featuresBase, "proposed", "tickets"), { recursive: true });
  await writeFile(join(repo.featuresBase, "proposed", "tickets", "00-task.md"), '---\nid: "00"\ntitle: Task\n---\n');
  await tools.get("dt_propose_plan").execute("id", params, undefined, undefined, ctx);
  assert.match(before(), /Pending plan proposal/);
  assert.equal(processes, 2);
  assert.equal(footerChanges, 2);
  await handlers.get("session_start")({}, ctx);
  assert.match(before(), /Pending plan proposal/);
  assert.equal(processes, 3);
  h.move(null); h.session("fork");
  h.custom("dt-project", project);
  await handlers.get("session_start")({}, ctx);
  assert.match(before(), /Lane claim owner for this session: fork/);
  assert.equal(footerChanges, 3);
  // Opening on an inactive branch must still allow navigation back to saved state.
  const previousProcesses = processes;
  h.move(null);
  await handlers.get("session_start")({}, ctx);
  assert.equal(before(), undefined);
  assert.equal(processes, previousProcesses);
  h.move(selectedLeaf);
  await handlers.get("session_tree")({}, ctx);
  assert.match(before(), /project: demo/);
  assert.equal(processes, previousProcesses + 1);
  const guard = handlers.get("tool_call");
  assert.ok(guard({ toolName: "bash", input: { command: "node dt.mjs gate demo 1 approve" } }).block);
});
