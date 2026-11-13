import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as logic from "../dt.mjs";
import { nextCommands } from "../extensions/dt-session/gates.mjs";

const script = path.resolve(import.meta.dirname, "../dt.mjs");
const ticket = (id) => ({ id, title: id, touches: [id], blocked_by: [], unsafe_with: [] });
test("ready work routes to next, not another agent's active ticket or saved lane handover", () => {
  const tickets = [ticket("00"), ticket("01")];
  const prog = logic.normalizeProgress({ gates: { G1: { state: "approved" }, G2: { state: "approved" } }, next: "/dt-lane f 00", tickets: { "00": { status: "in_progress", lane: "lane 2" } } });
  const st = logic.deriveStatuses(tickets, prog);
  const snapshot = { prog, tickets, st };
  assert.equal(logic.suggestNext({ slug: "f", feature: {}, ...snapshot }), "/dt-lane f");
  assert.deepEqual(nextCommands({ project: { slug: "f", tier: "T2" }, snapshot }, logic), ["/dt-lane"]);
});

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dt-claims-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const remote = path.join(dir, "remote.git"), lanes = [path.join(dir, "one"), path.join(dir, "two")], state = path.join(dir, "state");
  const env = { ...process.env, DT_DIR: state, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  const git = (cwd, ...args) => { const r = spawnSync("git", args, { cwd, env, encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); };
  git(dir, "init", "--bare", "--initial-branch=main", remote);
  git(dir, "clone", remote, lanes[0]);
  git(lanes[0], "commit", "--allow-empty", "-m", "init");
  git(lanes[0], "push", "origin", "main");
  git(dir, "clone", remote, lanes[1]);
  fs.mkdirSync(state);
  fs.writeFileSync(path.join(state, "config.json"), JSON.stringify({ repos: { [logic.repoKeyFromUrl(remote)]: { modality: "monorepo", lanes } } }));
  const feature = path.join(state, "features", logic.repoKeyFromUrl(remote), "f");
  fs.mkdirSync(path.join(feature, "tickets"), { recursive: true });
  fs.writeFileSync(path.join(feature, "feature.json"), JSON.stringify({ slug: "f", tier: "T2", type: "service" }));
  fs.writeFileSync(path.join(feature, "progress.json"), JSON.stringify({ gates: { G1: { state: "approved" }, G2: { state: "approved" } } }));
  for (const id of ["00", "01", "02"]) fs.writeFileSync(path.join(feature, "tickets", `${id}.md`), `---\nid: "${id}"\ntitle: Ticket ${id}\nkind: AFK\ntouches: [module${id}]\nblocked_by: []\nunsafe_with: []\n---\nbody\n`);
  const dt = (lane, ...args) => spawnSync(process.execPath, [script, ...args, "--no-fetch"], { cwd: lanes[lane], env, encoding: "utf8" });
  const ok = (lane, ...args) => { const r = dt(lane, ...args); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  const progress = () => JSON.parse(fs.readFileSync(path.join(feature, "progress.json"), "utf8"));
  return { lanes, env, dt, ok, progress, feature };
}

test("a free checkout can start independent work with two tickets awaiting merge", (t) => {
  const f = fixture(t);
  for (const id of ["00", "01"]) f.ok(0, "progress", "f", "--ticket", id, "--status", "review");
  f.ok(0, "next", "f", "--ticket", "02", "--owner", "agent-a");
  const saved = f.progress().tickets;
  assert.equal(saved["02"].claim.owner, "agent-a");
  assert.equal(saved["02"].status, "in_progress");
  assert.equal(saved["00"].status, "review");
  assert.equal(saved["01"].status, "review");
});

test("claims persist, reject another session, fence stale saves, and allow explicit force", (t) => {
  const f = fixture(t);
  f.ok(0, "next", "f", "--ticket", "00", "--owner", "agent-a");
  assert.equal(f.progress().tickets["00"].claim.owner, "agent-a");
  assert.equal(f.progress().tickets["00"].claim.checkout, fs.realpathSync(f.lanes[0]));
  const before = fs.readFileSync(path.join(f.feature, "progress.json"), "utf8");
  assert.match(f.dt(0, "next", "f", "--ticket", "00", "--owner", "agent-b").stderr, /claimed.*agent-a/);
  assert.equal(fs.readFileSync(path.join(f.feature, "progress.json"), "utf8"), before);
  assert.match(f.dt(1, "next", "f", "--ticket", "00", "--owner", "agent-b", "--force").stderr, /checkout|lane/);
  f.ok(0, "next", "f", "--ticket", "00", "--owner", "agent-b", "--force");
  assert.equal(f.progress().tickets["00"].claim.owner, "agent-b");
  assert.match(f.dt(0, "progress", "f", "--ticket", "00", "--owner", "agent-a", "--next", "stale").stderr, /claimed/);
  f.ok(0, "progress", "f", "--ticket", "00", "--owner", "agent-b", "--next", "handover", "--release-claim");
  assert.equal(f.progress().tickets["00"].claim, undefined);
  f.ok(0, "next", "f", "--ticket", "00", "--owner", "agent-c");
  assert.equal(f.progress().tickets["00"].next, "handover");
});

test("legacy lane numbers do not lock; dirty force leaves state safe", (t) => {
  const f = fixture(t);
  const file = path.join(f.feature, "progress.json");
  const raw = f.progress();
  raw.tickets = { "00": { status: "in_progress", lane: "lane 2" } };
  fs.writeFileSync(file, JSON.stringify(raw));
  f.ok(0, "next", "f", "--ticket", "00", "--owner", "a");
  assert.equal(f.progress().tickets["00"].lane, undefined);
  assert.equal(f.progress().tickets["00"].worktree, undefined);
  f.ok(0, "progress", "f", "--ticket", "00", "--owner", "a", "--status", "review", "--release-claim");
  f.ok(0, "next", "f", "--ticket", "01", "--owner", "a");
  const before = fs.readFileSync(path.join(f.feature, "progress.json"), "utf8");
  fs.writeFileSync(path.join(f.lanes[0], "dirty.txt"), "dirty");
  assert.match(f.dt(0, "next", "f", "--ticket", "01", "--owner", "b", "--force").stderr, /not clean/);
  assert.equal(fs.readFileSync(path.join(f.feature, "progress.json"), "utf8"), before);
  fs.unlinkSync(path.join(f.lanes[0], "dirty.txt"));
});

test("released tickets can resume in another monorepo checkout", (t) => {
  const f = fixture(t);
  f.ok(0, "next", "f", "--ticket", "00", "--owner", "a");
  f.ok(0, "progress", "f", "--ticket", "00", "--owner", "a", "--next", "handover", "--release-claim");
  const fetch = spawnSync("git", ["fetch", "origin"], { cwd: f.lanes[1], encoding: "utf8" });
  assert.equal(fetch.status, 0, fetch.stderr);
  assert.match(f.ok(1, "next", "f", "--ticket", "00", "--owner", "b"), /resume/);
  const saved = f.progress().tickets["00"];
  assert.equal(saved.claim.checkout, fs.realpathSync(f.lanes[1]));
  assert.equal(saved.next, "handover");
  assert.equal(saved.lane, undefined);
  assert.equal(saved.worktree, undefined);
});

test("migration is locked, idempotent and preserves all non-location state", (t) => {
  const f = fixture(t), file = path.join(f.feature, "progress.json");
  const raw = f.progress();
  raw.updated = "original";
  raw.custom = { retain: true };
  raw.tickets = {
    "00": { lane: "lane 2", claim: { owner: "other", checkout: f.lanes[1], acquired: "original" }, verification: "passed", prs: [{ number: 123 }], acceptance: { state: "changes" } },
    "01": { lane: "/repo.lane-01", next: "resume", todo: ["review"] },
  };
  fs.writeFileSync(file, JSON.stringify(raw));
  const before = fs.readFileSync(file, "utf8");
  assert.match(f.ok(0, "migrate-progress", "f", "--dry-run"), /would migrate/);
  assert.equal(fs.readFileSync(file, "utf8"), before);
  f.ok(0, "migrate-progress", "f");
  const expected = structuredClone(raw);
  delete expected.tickets["00"].lane;
  delete expected.tickets["01"].lane;
  expected.tickets["01"].worktree = "/repo.lane-01";
  assert.deepEqual(f.progress(), expected);
  const migrated = fs.readFileSync(file, "utf8");
  assert.match(f.ok(0, "migrate-progress", "f"), /already migrated/);
  assert.equal(fs.readFileSync(file, "utf8"), migrated);
});

test("setup failure before branch creation rolls reservation back", (t) => {
  const f = fixture(t);
  const r = spawnSync("git", ["update-ref", "-d", "refs/remotes/origin/main"], { cwd: f.lanes[0], encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.notEqual(f.dt(0, "next", "f", "--owner", "a").status, 0);
  assert.equal(f.progress().tickets?.["00"]?.claim, undefined);
  assert.notEqual(f.progress().tickets?.["00"]?.status, "in_progress");
});

test("explicit ticket switch releases only the old claim and preserves its handover", (t) => {
  const f = fixture(t);
  f.ok(0, "next", "f", "--ticket", "00", "--owner", "old");
  f.ok(0, "progress", "f", "--ticket", "00", "--owner", "old", "--status", "review", "--next", "/dt-review 00", "--verification", "passed", "--todo", "review");
  const before = f.progress().tickets["00"];
  f.ok(0, "next", "f", "--ticket", "01", "--owner", "new");
  const { claim, ...saved } = before;
  assert.deepEqual(f.progress().tickets["00"], saved);
  assert.equal(f.progress().tickets["01"].claim.owner, "new");
  assert.match(spawnSync("git", ["branch", "--show-current"], { cwd: f.lanes[0], encoding: "utf8" }).stdout, /ticket\/f-01/);
});

test("switching from main with a stale checkout claim still respects module conflicts", (t) => {
  const f = fixture(t);
  f.ok(0, "next", "f", "--ticket", "00", "--owner", "old");
  spawnSync("git", ["switch", "main"], { cwd: f.lanes[0] });
  const file = path.join(f.feature, "tickets", "01.md");
  const original = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, original.replace("module01", "module00"));
  assert.match(f.dt(0, "next", "f", "--ticket", "01", "--owner", "new").stderr, /already in flight/);
  assert.equal(f.progress().tickets["00"].claim.owner, "old");
  fs.writeFileSync(file, original);
  f.ok(0, "next", "f", "--ticket", "01", "--owner", "new");
  assert.equal(f.progress().tickets["00"].claim, undefined);
  f.ok(0, "next", "f", "--ticket", "00", "--owner", "new");
  assert.equal(f.progress().tickets["01"].claim, undefined);
  assert.equal(f.progress().tickets["00"].claim.owner, "new");
});

test("dirty checkout and another live pi session refuse a switch without changing state", async (t) => {
  const f = fixture(t);
  f.ok(0, "next", "f", "--ticket", "00", "--owner", "old");
  const before = fs.readFileSync(path.join(f.feature, "progress.json"), "utf8");
  fs.writeFileSync(path.join(f.lanes[0], "dirty"), "dirty");
  assert.match(f.dt(0, "next", "f", "--ticket", "01", "--owner", "new").stderr, /not clean/);
  fs.unlinkSync(path.join(f.lanes[0], "dirty"));
  const peer = spawn(process.execPath, ["-e", "process.title = 'pi'; console.log('ready'); setInterval(() => {}, 1000)"], { cwd: f.lanes[0] });
  t.after(() => peer.kill());
  await new Promise((resolve) => peer.stdout.once("data", resolve));
  assert.match(f.dt(0, "next", "f", "--ticket", "01", "--owner", "new").stderr, /active session/);
  assert.equal(fs.readFileSync(path.join(f.feature, "progress.json"), "utf8"), before);
  peer.kill();
  await new Promise((resolve) => peer.once("close", resolve));
  f.ok(0, "next", "f", "--ticket", "01", "--owner", "new", "--claim-only");
  assert.equal(f.progress().tickets["00"].claim, undefined);
});

test("failed switch setup restores the released claim", (t) => {
  const f = fixture(t);
  f.ok(0, "next", "f", "--ticket", "00", "--owner", "old");
  const before = f.progress().tickets["00"];
  spawnSync("git", ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"], { cwd: f.lanes[0] });
  spawnSync("git", ["update-ref", "-d", "refs/remotes/origin/main"], { cwd: f.lanes[0] });
  const result = f.dt(0, "next", "f", "--ticket", "01", "--owner", "new");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /git switch/);
  assert.deepEqual(f.progress().tickets["00"], before);
});

test("two agents in one checkout cannot reserve different tickets", async (t) => {
  const f = fixture(t);
  const run = (owner) => new Promise((resolve) => {
    const p = spawn(process.execPath, [script, "next", "f", "--owner", owner, "--no-fetch"], { cwd: f.lanes[0], env: f.env });
    p.stdout.resume(); p.stderr.resume(); p.on("close", (code) => resolve(code));
  });
  const results = await Promise.all([run("a"), run("b")]);
  assert.deepEqual(results.sort(), [0, 1]);
  assert.equal(Object.keys(f.progress().tickets).length, 1);
});

test("two lanes reserve distinct tickets atomically", async (t) => {
  const f = fixture(t);
  const run = (lane, owner) => new Promise((resolve) => {
    const p = spawn(process.execPath, [script, "next", "f", "--owner", owner, "--no-fetch"], { cwd: f.lanes[lane], env: f.env });
    let stderr = ""; p.stderr.on("data", (s) => stderr += s); p.on("close", (code) => resolve({ code, stderr }));
  });
  const results = await Promise.all([run(0, "a"), run(1, "b")]);
  for (const r of results) assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(Object.values(f.progress().tickets).map((s) => s.claim.owner).sort(), ["a", "b"]);
  const otherLane = Object.values(f.progress().tickets).find((saved) => saved.claim.owner === "b");
  f.ok(0, "next", "f", "--ticket", "02", "--owner", "a");
  assert.deepEqual(Object.values(f.progress().tickets).find((saved) => saved.claim?.owner === "b"), otherLane);
  assert.equal(f.progress().tickets["02"].claim.owner, "a");
});
