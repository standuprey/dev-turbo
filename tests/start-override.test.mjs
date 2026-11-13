import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closable, ticketMerged } from "../extensions/dt-session/gates.mjs";

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dt-start-override-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const remote = path.join(dir, "remote.git"), main = path.join(dir, "repo"), state = path.join(dir, "state");
  const env = { ...process.env, DT_DIR: state, GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "test@example.com" };
  const git = (cwd, ...args) => { const r = spawnSync("git", args, { cwd, env, encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  git(dir, "init", "--bare", "--initial-branch=main", remote);
  git(dir, "clone", remote, main);
  fs.mkdirSync(state);
  const feature = path.join(main, "docs", "features", "demo");
  fs.mkdirSync(path.join(feature, "tickets"), { recursive: true });
  fs.writeFileSync(path.join(feature, "feature.json"), JSON.stringify({ slug: "demo", tier: "T2", type: "service" }));
  const progressFile = path.join(feature, "progress.json");
  fs.writeFileSync(progressFile, JSON.stringify({ gates: { G2: { state: "approved" } } }));
  for (const id of ["00", "01", "02"]) fs.writeFileSync(path.join(feature, "tickets", `${id}.md`), `---\nid: "${id}"\ntitle: Ticket ${id}\ntouches: [module${id}]\nblocked_by: []\nunsafe_with: []\n---\n## Outcome\nBuild ${id}.\n`);
  git(main, "add", "docs");
  git(main, "commit", "-m", "plan");
  git(main, "push", "origin", "main");
  const wt = (id) => path.join(dir, `repo.lane-${id}`);
  const dt = (cwd, ...args) => spawnSync(process.execPath, [path.resolve(import.meta.dirname, "../dt.mjs"), ...args, "--no-fetch"], { cwd, env, encoding: "utf8" });
  const ok = (cwd, ...args) => { const r = dt(cwd, ...args); assert.equal(r.status, 0, r.stderr); return r; };
  const progress = () => JSON.parse(fs.readFileSync(progressFile, "utf8"));
  const save = (value) => fs.writeFileSync(progressFile, JSON.stringify(value));
  // Starts ticket 00 in its worktree and claims it there for the owner.
  const startInWorktree = (owner) => { ok(main, "next", "demo", "--ticket", "00", "--owner", owner); ok(wt("00"), "next", "demo", "--ticket", "00", "--owner", owner); };
  return { main, wt, feature, progressFile, dt, ok, progress, save, git, env, startInWorktree };
}

test("ticket starts share one git status snapshot per command, including clean results", (t) => {
  const f = fixture(t);
  const bin = path.join(path.dirname(f.main), "git-bin"), log = path.join(path.dirname(f.main), "git-status.log");
  const realGit = spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim();
  assert.ok(realGit);
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "git"), `#!${process.execPath}\n` +
    `const fs = require("node:fs"), { spawnSync } = require("node:child_process");\n` +
    `if (process.argv[2] === "status") fs.appendFileSync(${JSON.stringify(log)}, "status\\n");\n` +
    `const r = spawnSync(${JSON.stringify(realGit)}, process.argv.slice(2), { stdio: "inherit" });\n` +
    `process.exit(r.status ?? 1);\n`, { mode: 0o755 });
  f.env.PATH = `${bin}${path.delimiter}${f.env.PATH}`;
  const check = (...args) => {
    fs.writeFileSync(log, "");
    const r = f.dt(f.main, "next", "demo", "--ticket", "01", "--owner", "here", ...args);
    assert.equal(fs.readFileSync(log, "utf8"), "status\n", "all guards must reuse the snapshot within this command");
    return r;
  };
  const before = fs.readFileSync(f.progressFile, "utf8");
  const clean = check("--check-only", "--json");
  assert.equal(clean.status, 0, clean.stderr);
  assert.deepEqual(JSON.parse(clean.stdout).warnings, []);
  fs.writeFileSync(path.join(f.main, "dirty.txt"), "keep");
  const dirty = check("--check-only", "--json");
  assert.equal(dirty.status, 0, dirty.stderr);
  assert.ok(JSON.parse(dirty.stdout).warnings.includes("working tree is not clean"), "a new command must not reuse the previous clean snapshot");
  assert.notEqual(check().status, 0);
  assert.equal(fs.readFileSync(f.progressFile, "utf8"), before);
  fs.unlinkSync(path.join(f.main, "dirty.txt"));
  const started = check();
  assert.equal(started.status, 0, started.stderr);
  assert.equal(f.progress().tickets["01"].branch, "ticket/demo-01");
  assert.ok(fs.existsSync(f.wt("01")));
});

test("start preflight is read-only and reports every dependency, overlap, unsafe and saved-plan warning", (t) => {
  const f = fixture(t);
  const file = path.join(f.feature, "tickets", "01.md");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("module01", "module00").replace("blocked_by: []", 'blocked_by: ["02"]').replace("unsafe_with: []", 'unsafe_with: ["00"]'));
  f.save({ gates: { G2: { state: "pending" } }, blockers: ["owner input"], tickets: { "00": { status: "in_progress", claim: { owner: "other", checkout: f.wt("00") } }, "01": { blockers: ["fixture missing"] } } });
  const before = fs.readFileSync(f.progressFile, "utf8");
  const result = f.ok(f.main, "next", "demo", "--ticket", "01", "--owner", "here", "--check-only", "--json");
  const warnings = JSON.parse(result.stdout).warnings.join("\n");
  for (const pattern of [/blocked by 02/, /module00/, /unsafe.*00/, /plan approval/, /owner input/, /fixture missing/]) assert.match(warnings, pattern);
  assert.equal(fs.readFileSync(f.progressFile, "utf8"), before);
  assert.equal(f.git(f.main, "branch", "--show-current"), "main");
  assert.notEqual(f.dt(f.main, "next", "demo", "--ticket", "01", "--owner", "here").status, 0);
  assert.equal(fs.existsSync(f.wt("01")), false);
  const started = f.ok(f.main, "next", "demo", "--ticket", "01", "--owner", "here", "--override");
  assert.match(started.stderr, /WARNING/);
  assert.equal(f.git(f.wt("01"), "branch", "--show-current"), "ticket/demo-01");
  assert.equal(f.progress().gates.G2.state, "pending", "override is not plan approval");
  assert.equal(f.progress().tickets["00"].claim.owner, "other");
});

test("explicit override permits cross-checkout takeover but stale owners remain fenced", (t) => {
  const f = fixture(t);
  f.startInWorktree("old");
  const before = fs.readFileSync(f.progressFile, "utf8");
  assert.match(f.dt(f.main, "next", "demo", "--ticket", "00", "--owner", "new").stderr, /belongs to checkout/);
  assert.equal(fs.readFileSync(f.progressFile, "utf8"), before);
  const r = f.ok(f.main, "next", "demo", "--ticket", "00", "--owner", "new", "--override");
  assert.match(r.stderr, /old|checkout/);
  assert.equal(f.progress().tickets["00"].claim.checkout, fs.realpathSync(f.main));
  assert.equal(f.progress().tickets["00"].claim.owner, "new");
  assert.match(f.dt(f.wt("00"), "progress", "demo", "--ticket", "00", "--owner", "old", "--next", "stale").stderr, /claimed/);
  f.ok(f.main, "progress", "demo", "--ticket", "00", "--owner", "new", "--release-claim");
  assert.equal(f.progress().tickets["00"].claim, undefined);
});

test("override permits dirty/shared checkouts and active peers without discarding files or releasing their ticket claims", async (t) => {
  const f = fixture(t), wt = f.wt("00");
  f.startInWorktree("old");
  fs.writeFileSync(path.join(wt, "dirty.txt"), "keep this data");
  const peer = spawn(process.execPath, ["-e", "process.title = 'pi'; console.log('ready'); setInterval(() => {}, 1000)"], { cwd: wt });
  t.after(() => peer.kill());
  await new Promise((resolve) => peer.stdout.once("data", resolve));
  const before = fs.readFileSync(f.progressFile, "utf8");
  assert.notEqual(f.dt(wt, "next", "demo", "--ticket", "01", "--owner", "new").status, 0);
  assert.equal(fs.readFileSync(f.progressFile, "utf8"), before);
  const r = f.ok(wt, "next", "demo", "--ticket", "01", "--owner", "new", "--override");
  assert.match(r.stderr, /not clean/);
  assert.match(r.stderr, /active session/);
  assert.equal(fs.readFileSync(path.join(wt, "dirty.txt"), "utf8"), "keep this data");
  assert.equal(f.git(wt, "branch", "--show-current"), "ticket/demo-01");
  assert.equal(f.progress().tickets["00"].claim.owner, "old");
  assert.equal(f.progress().tickets["01"].claim.owner, "new");
});

test("completed and merged ticket starts require explicit override and preserve recorded PR facts", (t) => {
  const f = fixture(t);
  f.save({ gates: { G2: { state: "approved" } }, tickets: { "00": { status: "done", prs: [{ number: 7, state: "merged" }], verification: "previous work" } } });
  assert.notEqual(f.dt(f.main, "next", "demo", "--ticket", "00", "--owner", "here").status, 0);
  const r = f.ok(f.main, "next", "demo", "--ticket", "00", "--owner", "here", "--override");
  assert.match(r.stderr, /done|completed/);
  assert.match(r.stderr, /merged/);
  assert.equal(f.progress().tickets["00"].status, "in_progress");
  assert.deepEqual(f.progress().tickets["00"].prs, [{ number: 7, state: "merged" }]);
  assert.equal(f.progress().tickets["00"].verification, "previous work");
  assert.equal(f.progress().tickets["00"].reopened, true);
  assert.equal(ticketMerged(f.progress().tickets["00"]), false);
  assert.deepEqual(closable({ tickets: [{ id: "00" }], prog: f.progress() }), []);
  f.ok(f.main, "progress", "demo", "--ticket", "00", "--owner", "here", "--pr", "8", "--no-gh");
  assert.equal(f.progress().tickets["00"].reopened, undefined);
  assert.deepEqual(closable({ tickets: [{ id: "00" }], prog: f.progress() }).map((t) => t.id), ["00"]);
});

test("reset-to-todo work reuses its saved branch without bypassing fresh start checks", (t) => {
  const f = fixture(t), wt = f.wt("00");
  f.ok(f.main, "next", "demo", "--ticket", "00", "--owner", "old");
  const branch = f.progress().tickets["00"].branch;
  f.ok(f.main, "progress", "demo", "--ticket", "00", "--owner", "old", "--status", "todo", "--release-claim");
  const raw = f.progress(); raw.gates.G2.state = "pending"; f.save(raw);
  const checked = JSON.parse(f.ok(wt, "next", "demo", "--ticket", "00", "--owner", "new", "--check-only", "--json").stdout);
  assert.match(checked.warnings.join("\n"), /plan approval/);
  assert.notEqual(f.dt(wt, "next", "demo", "--ticket", "00", "--owner", "new").status, 0);
  raw.gates.G2.state = "approved"; f.save(raw);
  assert.match(f.ok(wt, "next", "demo", "--ticket", "00", "--owner", "new").stdout, /resume/);
  assert.equal(f.progress().tickets["00"].branch, branch);
});

test("closing an overridden main-checkout start never removes that checkout", (t) => {
  const f = fixture(t);
  f.startInWorktree("other");
  fs.writeFileSync(path.join(f.main, "keep.txt"), "local data");
  f.ok(f.main, "next", "demo", "--ticket", "00", "--owner", "here", "--override");
  assert.equal(f.git(f.main, "branch", "--show-current"), "ticket/demo-00");
  assert.match(f.ok(f.main, "gate", "demo", "3", "approve", "--ticket", "00").stdout, /retained main checkout/);
  assert.equal(fs.readFileSync(path.join(f.main, "keep.txt"), "utf8"), "local data");
  assert.ok(fs.existsSync(path.join(f.main, ".git")));
});

test("legacy quick-plan approval is honored by preflight and normal starts", (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.feature, "feature.json"), JSON.stringify({ slug: "demo", tier: "T1", type: "service" }));
  fs.unlinkSync(path.join(f.feature, "tickets/01.md"));
  fs.unlinkSync(path.join(f.feature, "tickets/02.md"));
  f.save({ gates: { G0: { state: "approved" } } });
  const before = fs.readFileSync(f.progressFile, "utf8");
  assert.deepEqual(JSON.parse(f.ok(f.main, "next", "demo", "--ticket", "00", "--owner", "here", "--check-only", "--json").stdout).warnings, []);
  assert.equal(fs.readFileSync(f.progressFile, "utf8"), before);
  f.ok(f.main, "next", "demo", "--ticket", "00", "--owner", "here");
  assert.equal(f.progress().gates.G2.state, "approved");
  assert.equal(f.git(f.main, "branch", "--show-current"), "quick/demo");
});

test("override remains explicit and cannot bypass missing IDs, owners or corrupt data", (t) => {
  const f = fixture(t), before = fs.readFileSync(f.progressFile, "utf8");
  assert.match(f.dt(f.main, "next", "demo", "--owner", "here", "--override").stderr, /explicit.*ticket|--ticket/);
  assert.match(f.dt(f.main, "next", "demo", "--ticket", "99", "--owner", "here", "--override").stderr, /no ticket/);
  assert.match(f.dt(f.main, "next", "demo", "--ticket", "01", "--override").stderr, /--owner/);
  assert.equal(fs.readFileSync(f.progressFile, "utf8"), before);
  fs.writeFileSync(f.progressFile, "{invalid JSON");
  assert.match(f.dt(f.main, "next", "demo", "--ticket", "01", "--owner", "here", "--override").stderr, /cannot parse/);
});
