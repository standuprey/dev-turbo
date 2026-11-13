import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as logic from "../dt.mjs";
import { closable, ticketMerged } from "../extensions/dt-session/gates.mjs";

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dt-start-override-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const remote = path.join(dir, "remote.git"), lanes = [path.join(dir, "one"), path.join(dir, "two")], state = path.join(dir, "state");
  const env = { ...process.env, DT_DIR: state, GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "test@example.com" };
  const git = (cwd, ...args) => { const r = spawnSync("git", args, { cwd, env, encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); };
  git(dir, "init", "--bare", "--initial-branch=main", remote);
  git(dir, "clone", remote, lanes[0]);
  git(lanes[0], "commit", "--allow-empty", "-m", "init");
  git(lanes[0], "push", "origin", "main");
  git(dir, "clone", remote, lanes[1]);
  fs.mkdirSync(state);
  fs.writeFileSync(path.join(state, "config.json"), JSON.stringify({ repos: { [logic.repoKeyFromUrl(remote)]: { modality: "monorepo", lanes } } }));
  const feature = path.join(state, "features", logic.repoKeyFromUrl(remote), "demo");
  fs.mkdirSync(path.join(feature, "tickets"), { recursive: true });
  fs.writeFileSync(path.join(feature, "feature.json"), JSON.stringify({ slug: "demo", tier: "T2", type: "service" }));
  const progressFile = path.join(feature, "progress.json");
  fs.writeFileSync(progressFile, JSON.stringify({ gates: { G2: { state: "approved" } } }));
  for (const id of ["00", "01", "02"]) fs.writeFileSync(path.join(feature, "tickets", `${id}.md`), `---\nid: "${id}"\ntitle: Ticket ${id}\ntouches: [module${id}]\nblocked_by: []\nunsafe_with: []\n---\n## Outcome\nBuild ${id}.\n`);
  const dt = (lane, ...args) => spawnSync(process.execPath, [path.resolve(import.meta.dirname, "../dt.mjs"), ...args, "--no-fetch"], { cwd: lanes[lane], env, encoding: "utf8" });
  const ok = (lane, ...args) => { const r = dt(lane, ...args); assert.equal(r.status, 0, r.stderr); return r; };
  const progress = () => JSON.parse(fs.readFileSync(progressFile, "utf8"));
  const save = (value) => fs.writeFileSync(progressFile, JSON.stringify(value));
  return { lanes, feature, progressFile, dt, ok, progress, save, git, env };
}

test("start preflight is read-only and reports every dependency, overlap, unsafe and saved-plan warning", (t) => {
  const f = fixture(t);
  const file = path.join(f.feature, "tickets", "01.md");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("module01", "module00").replace("blocked_by: []", 'blocked_by: ["02"]').replace("unsafe_with: []", 'unsafe_with: ["00"]'));
  f.save({ gates: { G2: { state: "pending" } }, blockers: ["owner input"], tickets: { "00": { status: "in_progress", claim: { owner: "other", checkout: f.lanes[1] } }, "01": { blockers: ["fixture missing"] } } });
  const before = fs.readFileSync(f.progressFile, "utf8");
  const result = f.ok(0, "next", "demo", "--ticket", "01", "--owner", "here", "--check-only", "--json");
  const warnings = JSON.parse(result.stdout).warnings.join("\n");
  for (const pattern of [/blocked by 02/, /module00/, /unsafe.*00/, /plan approval/, /owner input/, /fixture missing/]) assert.match(warnings, pattern);
  assert.equal(fs.readFileSync(f.progressFile, "utf8"), before);
  assert.equal(spawnSync("git", ["branch", "--show-current"], { cwd: f.lanes[0], encoding: "utf8" }).stdout.trim(), "main");
  assert.notEqual(f.dt(0, "next", "demo", "--ticket", "01", "--owner", "here").status, 0);
  const started = f.ok(0, "next", "demo", "--ticket", "01", "--owner", "here", "--override", "--claim-only");
  assert.match(started.stderr, /WARNING/);
  assert.equal(f.progress().tickets["01"].claim.owner, "here");
  assert.ok(f.progress().tickets["01"].claim.override.length >= 6);
  assert.equal(f.progress().gates.G2.state, "pending", "override is not plan approval");
  assert.equal(f.progress().tickets["00"].claim.owner, "other");
});

test("explicit override permits cross-checkout takeover but stale owners remain fenced", (t) => {
  const f = fixture(t);
  f.ok(0, "next", "demo", "--ticket", "00", "--owner", "old", "--claim-only");
  const before = fs.readFileSync(f.progressFile, "utf8");
  assert.notEqual(f.dt(1, "next", "demo", "--ticket", "00", "--owner", "new").status, 0);
  assert.equal(fs.readFileSync(f.progressFile, "utf8"), before);
  const r = f.ok(1, "next", "demo", "--ticket", "00", "--owner", "new", "--override", "--claim-only");
  assert.match(r.stderr, /old|checkout/);
  assert.equal(f.progress().tickets["00"].claim.checkout, fs.realpathSync(f.lanes[1]));
  assert.equal(f.progress().tickets["00"].claim.owner, "new");
  assert.match(f.dt(0, "progress", "demo", "--ticket", "00", "--owner", "old", "--next", "stale").stderr, /claimed/);
  f.ok(1, "progress", "demo", "--ticket", "00", "--owner", "new", "--release-claim");
  assert.equal(f.progress().tickets["00"].claim, undefined);
});

test("override permits dirty/shared checkouts and active peers without discarding files or releasing their ticket claims", async (t) => {
  const f = fixture(t);
  f.ok(0, "next", "demo", "--ticket", "00", "--owner", "old", "--claim-only");
  fs.writeFileSync(path.join(f.lanes[0], "dirty.txt"), "keep this data");
  const peer = spawn(process.execPath, ["-e", "process.title = 'pi'; console.log('ready'); setInterval(() => {}, 1000)"], { cwd: f.lanes[0] });
  t.after(() => peer.kill());
  await new Promise((resolve) => peer.stdout.once("data", resolve));
  const before = fs.readFileSync(f.progressFile, "utf8");
  assert.notEqual(f.dt(0, "next", "demo", "--ticket", "01", "--owner", "new", "--claim-only").status, 0);
  assert.equal(fs.readFileSync(f.progressFile, "utf8"), before);
  const r = f.ok(0, "next", "demo", "--ticket", "01", "--owner", "new", "--override", "--claim-only");
  assert.match(r.stderr, /not clean/);
  assert.match(r.stderr, /active session/);
  assert.equal(fs.readFileSync(path.join(f.lanes[0], "dirty.txt"), "utf8"), "keep this data");
  assert.equal(f.progress().tickets["00"].claim.owner, "old");
  assert.equal(f.progress().tickets["01"].claim.owner, "new");
});

test("completed and merged ticket starts require explicit override and preserve recorded PR facts", (t) => {
  const f = fixture(t);
  f.save({ gates: { G2: { state: "approved" } }, tickets: { "00": { status: "done", prs: [{ number: 7, state: "merged" }], verification: "previous work" } } });
  assert.notEqual(f.dt(0, "next", "demo", "--ticket", "00", "--owner", "here", "--claim-only").status, 0);
  const r = f.ok(0, "next", "demo", "--ticket", "00", "--owner", "here", "--override", "--claim-only");
  assert.match(r.stderr, /done|completed/);
  assert.match(r.stderr, /merged/);
  assert.equal(f.progress().tickets["00"].status, "in_progress");
  assert.deepEqual(f.progress().tickets["00"].prs, [{ number: 7, state: "merged" }]);
  assert.equal(f.progress().tickets["00"].verification, "previous work");
  assert.equal(f.progress().tickets["00"].reopened, true);
  assert.equal(ticketMerged(f.progress().tickets["00"]), false);
  assert.deepEqual(closable({ tickets: [{ id: "00" }], prog: f.progress() }), []);
  f.ok(0, "progress", "demo", "--ticket", "00", "--owner", "here", "--pr", "8", "--no-gh");
  assert.equal(f.progress().tickets["00"].reopened, undefined);
  assert.deepEqual(closable({ tickets: [{ id: "00" }], prog: f.progress() }).map((t) => t.id), ["00"]);
});

test("reset-to-todo work reuses its saved branch without bypassing fresh start checks", (t) => {
  const f = fixture(t);
  f.ok(0, "next", "demo", "--ticket", "00", "--owner", "old");
  const branch = f.progress().tickets["00"].branch;
  f.ok(0, "progress", "demo", "--ticket", "00", "--owner", "old", "--status", "todo", "--release-claim");
  const raw = f.progress(); raw.gates.G2.state = "pending"; f.save(raw);
  const checked = JSON.parse(f.ok(0, "next", "demo", "--ticket", "00", "--owner", "new", "--check-only", "--json").stdout);
  assert.match(checked.warnings.join("\n"), /plan approval/);
  assert.notEqual(f.dt(0, "next", "demo", "--ticket", "00", "--owner", "new").status, 0);
  raw.gates.G2.state = "approved"; f.save(raw);
  assert.match(f.ok(0, "next", "demo", "--ticket", "00", "--owner", "new").stdout, /resume/);
  assert.equal(f.progress().tickets["00"].branch, branch);
});

test("closing an overridden standalone main-checkout start never removes that checkout", (t) => {
  const f = fixture(t);
  const configFile = path.join(f.env.DT_DIR, "config.json");
  const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
  Object.values(config.repos)[0].modality = "standalone";
  fs.writeFileSync(configFile, JSON.stringify(config));
  const feature = path.join(f.lanes[0], "docs", "features", "demo");
  fs.cpSync(f.feature, feature, { recursive: true });
  fs.writeFileSync(path.join(feature, "progress.json"), JSON.stringify({ gates: { G2: { state: "approved" } }, tickets: { "00": { status: "in_progress", branch: "ticket/demo-00", worktree: f.lanes[1], claim: { owner: "other", checkout: f.lanes[1] } } } }));
  f.git(f.lanes[0], "branch", "ticket/demo-00");
  fs.writeFileSync(path.join(f.lanes[0], "keep.txt"), "local data");
  f.ok(0, "next", "demo", "--ticket", "00", "--owner", "here", "--override");
  assert.match(f.ok(0, "gate", "demo", "3", "approve", "--ticket", "00").stdout, /retained main checkout/);
  assert.equal(fs.readFileSync(path.join(f.lanes[0], "keep.txt"), "utf8"), "local data");
  assert.ok(fs.existsSync(path.join(f.lanes[0], ".git")));
});

test("legacy quick-plan approval is honored by preflight and normal starts", (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.feature, "feature.json"), JSON.stringify({ slug: "demo", tier: "T1", type: "service" }));
  fs.unlinkSync(path.join(f.feature, "tickets/01.md"));
  fs.unlinkSync(path.join(f.feature, "tickets/02.md"));
  f.save({ gates: { G0: { state: "approved" } } });
  const before = fs.readFileSync(f.progressFile, "utf8");
  assert.deepEqual(JSON.parse(f.ok(0, "next", "demo", "--ticket", "00", "--owner", "here", "--check-only", "--json").stdout).warnings, []);
  assert.equal(fs.readFileSync(f.progressFile, "utf8"), before);
  f.ok(0, "next", "demo", "--ticket", "00", "--owner", "here");
  assert.equal(f.progress().gates.G2.state, "approved");
});

test("override remains explicit and cannot bypass missing IDs, owners or corrupt data", (t) => {
  const f = fixture(t), before = fs.readFileSync(f.progressFile, "utf8");
  assert.match(f.dt(0, "next", "demo", "--owner", "here", "--override").stderr, /explicit.*ticket|--ticket/);
  assert.match(f.dt(0, "next", "demo", "--ticket", "99", "--owner", "here", "--override").stderr, /no ticket/);
  assert.match(f.dt(0, "next", "demo", "--ticket", "01", "--override").stderr, /--owner/);
  assert.equal(fs.readFileSync(f.progressFile, "utf8"), before);
  fs.writeFileSync(f.progressFile, "{invalid JSON");
  assert.match(f.dt(0, "next", "demo", "--ticket", "01", "--owner", "here", "--override").stderr, /cannot parse/);
});
