import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
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
  const remote = path.join(dir, "remote.git"), main = path.join(dir, "repo"), state = path.join(dir, "state");
  const env = { ...process.env, DT_DIR: state, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  const git = (cwd, ...args) => { const r = spawnSync("git", args, { cwd, env, encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  git(dir, "init", "--bare", "--initial-branch=main", remote);
  git(dir, "clone", remote, main);
  fs.mkdirSync(state);
  const feature = path.join(main, "docs", "features", "f");
  fs.mkdirSync(path.join(feature, "tickets"), { recursive: true });
  fs.writeFileSync(path.join(feature, "feature.json"), JSON.stringify({ slug: "f", tier: "T2", type: "service" }));
  fs.writeFileSync(path.join(feature, "progress.json"), JSON.stringify({ gates: { G1: { state: "approved" }, G2: { state: "approved" } } }));
  for (const id of ["00", "01", "02"]) fs.writeFileSync(path.join(feature, "tickets", `${id}.md`), `---\nid: "${id}"\ntitle: Ticket ${id}\nkind: AFK\ntouches: [module${id}]\nblocked_by: []\nunsafe_with: []\n---\nbody\n`);
  // Ticket files must be on the main branch before T2 worktrees start.
  git(main, "add", "docs");
  git(main, "commit", "-m", "plan");
  git(main, "push", "origin", "main");
  const wt = (id) => path.join(dir, `repo.lane-${id}`);
  const dt = (cwd, ...args) => spawnSync(process.execPath, [script, ...args, "--no-fetch"], { cwd, env, encoding: "utf8" });
  const ok = (cwd, ...args) => { const r = dt(cwd, ...args); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  const progress = () => JSON.parse(fs.readFileSync(path.join(feature, "progress.json"), "utf8"));
  return { main, wt, env, git, dt, ok, progress, feature };
}

test("T2 starts create a worktree from the main checkout; the worktree session then holds the claim", (t) => {
  const f = fixture(t);
  assert.match(f.ok(f.main, "next", "f", "--ticket", "00", "--owner", "a"), /open pi in .*repo\.lane-00 and run: \/dt-lane f 00/);
  let saved = f.progress().tickets["00"];
  assert.equal(saved.branch, "ticket/f-00");
  assert.equal(fs.realpathSync(saved.worktree), fs.realpathSync(f.wt("00")));
  assert.equal(saved.claim, undefined);
  assert.equal(f.git(f.main, "branch", "--show-current"), "main");
  assert.equal(f.git(f.wt("00"), "branch", "--show-current"), "ticket/f-00");
  assert.match(f.ok(f.wt("00"), "next", "f", "--ticket", "00", "--owner", "b"), /resume: already on ticket\/f-00/);
  saved = f.progress().tickets["00"];
  assert.equal(saved.claim.owner, "b");
  assert.equal(saved.claim.checkout, fs.realpathSync(f.wt("00")));
});

test("ticket files must be on the main branch first; uncommitted feature docs never count as changes", (t) => {
  const f = fixture(t);
  const other = path.join(f.main, "docs", "features", "g");
  fs.cpSync(f.feature, other, { recursive: true });
  const before = fs.readFileSync(path.join(other, "progress.json"), "utf8");
  assert.match(f.dt(f.main, "next", "g", "--ticket", "00", "--owner", "a").stderr, /tickets are not on origin\/main yet: commit and push docs\/features\/g\/tickets first/);
  assert.equal(fs.readFileSync(path.join(other, "progress.json"), "utf8"), before);
  fs.writeFileSync(path.join(f.main, "stray.txt"), "x");
  assert.match(f.dt(f.main, "next", "f", "--ticket", "00", "--owner", "a").stderr, /not clean/);
  fs.rmSync(path.join(f.main, "stray.txt"));
  f.ok(f.main, "next", "f", "--ticket", "00", "--owner", "a");
});

test("claims persist, reject another session, fence stale saves, and allow explicit force", (t) => {
  const f = fixture(t), wt = f.wt("00");
  f.ok(f.main, "next", "f", "--ticket", "00", "--owner", "agent-a");
  f.ok(wt, "next", "f", "--ticket", "00", "--owner", "agent-a");
  assert.equal(f.progress().tickets["00"].claim.owner, "agent-a");
  const before = fs.readFileSync(path.join(f.feature, "progress.json"), "utf8");
  assert.match(f.dt(wt, "next", "f", "--ticket", "00", "--owner", "agent-b").stderr, /claimed.*agent-a/);
  assert.equal(fs.readFileSync(path.join(f.feature, "progress.json"), "utf8"), before);
  assert.match(f.dt(f.main, "next", "f", "--ticket", "00", "--owner", "agent-b", "--force").stderr, /belongs to checkout/);
  f.ok(wt, "next", "f", "--ticket", "00", "--owner", "agent-b", "--force");
  assert.equal(f.progress().tickets["00"].claim.owner, "agent-b");
  assert.match(f.dt(wt, "progress", "f", "--ticket", "00", "--owner", "agent-a", "--next", "stale").stderr, /claimed/);
  f.ok(wt, "progress", "f", "--ticket", "00", "--owner", "agent-b", "--next", "handover", "--release-claim");
  assert.equal(f.progress().tickets["00"].claim, undefined);
  assert.match(f.ok(wt, "next", "f", "--ticket", "00", "--owner", "agent-c"), /resume/);
  assert.equal(f.progress().tickets["00"].next, "handover");
});

test("a ticket worktree cannot start another ticket; the main checkout gives it its own worktree", (t) => {
  const f = fixture(t);
  f.ok(f.main, "next", "f", "--ticket", "00", "--owner", "a");
  f.ok(f.wt("00"), "next", "f", "--ticket", "00", "--owner", "a");
  const before = fs.readFileSync(path.join(f.feature, "progress.json"), "utf8");
  assert.match(f.dt(f.wt("00"), "next", "f", "--ticket", "01", "--owner", "a").stderr, /on ticket 00's branch/);
  assert.equal(fs.readFileSync(path.join(f.feature, "progress.json"), "utf8"), before);
  f.ok(f.main, "next", "f", "--ticket", "01", "--owner", "a");
  assert.equal(f.git(f.wt("01"), "branch", "--show-current"), "ticket/f-01");
  assert.equal(f.progress().tickets["00"].claim.owner, "a");
});

test("legacy lane numbers do not lock; dirty force leaves state safe", (t) => {
  const f = fixture(t);
  const file = path.join(f.feature, "progress.json");
  const raw = f.progress();
  raw.tickets = { "00": { status: "in_progress", lane: "lane 2" } };
  fs.writeFileSync(file, JSON.stringify(raw));
  f.ok(f.main, "next", "f", "--ticket", "00", "--owner", "a");
  assert.equal(f.progress().tickets["00"].lane, undefined);
  f.ok(f.wt("00"), "next", "f", "--ticket", "00", "--owner", "a");
  const before = fs.readFileSync(file, "utf8");
  fs.writeFileSync(path.join(f.wt("00"), "dirty.txt"), "dirty");
  assert.match(f.dt(f.wt("00"), "next", "f", "--ticket", "00", "--owner", "b", "--force").stderr, /not clean/);
  assert.equal(fs.readFileSync(file, "utf8"), before);
});

test("migration is locked, idempotent and preserves all non-location state", (t) => {
  const f = fixture(t), file = path.join(f.feature, "progress.json");
  const raw = f.progress();
  raw.updated = "original";
  raw.custom = { retain: true };
  raw.tickets = {
    "00": { lane: "lane 2", claim: { owner: "other", checkout: f.wt("00"), acquired: "original" }, verification: "passed", prs: [{ number: 123 }], acceptance: { state: "changes" } },
    "01": { lane: "/repo.lane-01", next: "resume", todo: ["review"] },
  };
  fs.writeFileSync(file, JSON.stringify(raw));
  const before = fs.readFileSync(file, "utf8");
  assert.match(f.ok(f.main, "migrate-progress", "f", "--dry-run"), /would migrate/);
  assert.equal(fs.readFileSync(file, "utf8"), before);
  f.ok(f.main, "migrate-progress", "f");
  const expected = structuredClone(raw);
  delete expected.tickets["00"].lane;
  delete expected.tickets["01"].lane;
  expected.tickets["01"].worktree = "/repo.lane-01";
  assert.deepEqual(f.progress(), expected);
  const migrated = fs.readFileSync(file, "utf8");
  assert.match(f.ok(f.main, "migrate-progress", "f"), /already migrated/);
  assert.equal(fs.readFileSync(file, "utf8"), migrated);
});

test("setup failure before branch creation leaves no reservation", (t) => {
  const f = fixture(t);
  f.git(f.main, "update-ref", "-d", "refs/remotes/origin/main");
  assert.notEqual(f.dt(f.main, "next", "f", "--owner", "a").status, 0);
  assert.equal(f.progress().tickets?.["00"]?.claim, undefined);
  assert.notEqual(f.progress().tickets?.["00"]?.status, "in_progress");
});

test("an interrupted worktree setup keeps the reservation with a resume hint", (t) => {
  const f = fixture(t);
  f.git(f.main, "branch", "ticket/f-00");
  assert.notEqual(f.dt(f.main, "next", "f", "--ticket", "00", "--owner", "a").status, 0);
  const saved = f.progress().tickets["00"];
  assert.equal(saved.branch, "ticket/f-00");
  assert.match(saved.next, /^setup interrupted: .*resume \/dt-lane 00$/);
});
