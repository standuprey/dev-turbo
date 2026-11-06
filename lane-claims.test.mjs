import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as logic from "./dt.mjs";
import { nextCommands } from "./extensions/dt-session/gates.mjs";

const script = path.resolve(import.meta.dirname, "dt.mjs");
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

test("legacy lane ownership, dirty force and failed setup leave state safe", (t) => {
  const f = fixture(t);
  f.ok(0, "progress", "f", "--ticket", "00", "--status", "in_progress", "--lane", "lane 2");
  assert.match(f.dt(0, "next", "f", "--ticket", "00", "--owner", "a", "--force").stderr, /checkout/);
  f.ok(0, "next", "f", "--ticket", "01", "--owner", "a");
  const before = fs.readFileSync(path.join(f.feature, "progress.json"), "utf8");
  fs.writeFileSync(path.join(f.lanes[0], "dirty.txt"), "dirty");
  assert.match(f.dt(0, "next", "f", "--ticket", "01", "--owner", "b", "--force").stderr, /not clean/);
  assert.equal(fs.readFileSync(path.join(f.feature, "progress.json"), "utf8"), before);
  fs.unlinkSync(path.join(f.lanes[0], "dirty.txt"));
});

test("setup failure before branch creation rolls reservation back", (t) => {
  const f = fixture(t);
  const r = spawnSync("git", ["update-ref", "-d", "refs/remotes/origin/main"], { cwd: f.lanes[0], encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.notEqual(f.dt(0, "next", "f", "--owner", "a").status, 0);
  assert.equal(f.progress().tickets?.["00"]?.claim, undefined);
  assert.notEqual(f.progress().tickets?.["00"]?.status, "in_progress");
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
  assert.match(f.dt(0, "next", "f", "--ticket", "02", "--owner", "a", "--force").stderr, /finish it|in flight/);
});
