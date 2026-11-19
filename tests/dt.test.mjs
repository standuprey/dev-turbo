import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../dt.mjs", import.meta.url));
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "dt-cli-test-"));
process.on("exit", () => fs.rmSync(sandbox, { recursive: true, force: true }));
const run = (args) => spawnSync(process.execPath, [script, ...args], {
  cwd: sandbox,
  encoding: "utf8",
  // Missing Git/gh and invalid config prove help doesn't invoke workflow operations.
  env: { ...process.env, PATH: "", DT_DIR: sandbox },
});
fs.writeFileSync(path.join(sandbox, "config.json"), "invalid JSON");

const topics = [
  [], ["info"], ["config"], ["config", "set"], ["config", "set", "checks"],
  ["resume"], ["progress"], ["status"], ["next"], ["gate"], ["pr"], ["comment"], ["selftest"],
];
for (const topic of topics) {
  for (const flag of ["-h", "--help"]) {
    test(`${topic.join(" ") || "top-level"} ${flag}`, () => {
      const result = run([...topic, flag]);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.ok(result.stdout.startsWith(`Usage: dt.mjs${topic.length ? ` ${topic.join(" ")}` : " <command>"}`));
      assert.match(result.stdout, /-h, --help/);
      if (!topic.length) for (const command of topics.filter((t) => t.length === 1)) assert.ok(result.stdout.includes(command[0]));
    });
  }
}

test("no arguments shows top-level help", () => {
  const result = run([]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: dt.mjs <command>/);
});

test("help works before the command and after complete workflow arguments", () => {
  for (const args of [["-h", "info"], ["gate", "example", "0", "approve", "--tier", "T2", "--type", "service", "-h"]]) {
    const result = run(args);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage: dt.mjs (info|gate)/);
  }
  assert.deepEqual(fs.readdirSync(sandbox), ["config.json"]);
});

test("unknown commands fail before repository resolution", () => {
  for (const args of [["unknown"], ["unknown", "-h"], ["__proto__", "-h"]]) {
    const result = run(args);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /unknown command/);
    assert.equal(result.stdout, "");
  }
});

test("gate help advertises the CLI type", () => {
  const result = run(["gate", "--help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--type web\|device\|service\|cli\|mixed/);
});

test("PR help uses the short description and fixed testing format", () => {
  const result = run(["pr", "--help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /five-bullet|5-bullet|5 bullets|pr quick/);
  assert.match(result.stdout, /unit tests \+ staging tests/);
});

test("Gate 0 creates the project and approves its plan at every tier; it rejects unknown types and missing plans", () => {
  const repo = fs.mkdtempSync(path.join(sandbox, "gate-repo-"));
  const state = fs.mkdtempSync(path.join(sandbox, "gate-state-"));
  for (const args of [["init", "--quiet"], ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]]) {
    const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  // Standalone T2 approval opens GitHub issues; a stub gh returns an issue URL.
  const bin = fs.mkdtempSync(path.join(sandbox, "gate-bin-"));
  fs.writeFileSync(path.join(bin, "gh"), "#!/bin/sh\necho https://github.com/o/r/issues/7\n", { mode: 0o755 });
  const gate = (tier, type) => spawnSync(process.execPath, [script, "gate", `example-${tier}`, "0", "approve", "--tier", tier, "--type", type], {
    cwd: repo, encoding: "utf8", env: { ...process.env, DT_DIR: state, PATH: `${bin}:${process.env.PATH}` },
  });
  const dir = (tier) => path.join(repo, "docs", "features", `example-${tier}`);
  const writeTicket = (tier) => { fs.mkdirSync(path.join(dir(tier), "tickets"), { recursive: true }); fs.writeFileSync(path.join(dir(tier), "tickets", "00-task.md"), '---\nid: "00"\ntitle: Task\n---\n'); };
  for (const tier of ["T0", "T1"]) {
    assert.match(gate(tier, "cli").stderr, /no tickets/);
    writeTicket(tier);
    const result = gate(tier, "cli");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`next: /dt-lane example-${tier}`));
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir(tier), "progress.json"), "utf8")).gates.G2.state, "approved");
  }
  writeTicket("T2");
  assert.match(gate("T2", "cli").stderr, /need a brief/);
  fs.writeFileSync(path.join(dir("T2"), "spec.md"), "# Brief\n");
  const result = gate("T2", "cli");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /next: \/dt-lane example-T2/);
  const feature = JSON.parse(fs.readFileSync(path.join(repo, "docs", "features", "example-T2", "feature.json"), "utf8"));
  assert.equal(feature.type, "cli");
  assert.equal(feature.tier, "T2");
  const progress = JSON.parse(fs.readFileSync(path.join(repo, "docs", "features", "example-T2", "progress.json"), "utf8"));
  assert.equal(progress.gates.G0.state, "approved");
  const invalid = gate("T0", "unknown");
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /gate 0 needs/);
});

test("a feature resumes from its folder alone: gates, progress and briefs", () => {
  const repo = fs.mkdtempSync(path.join(sandbox, "resume-repo-"));
  const state = fs.mkdtempSync(path.join(sandbox, "resume-state-"));
  for (const args of [["init", "--quiet"], ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]]) {
    assert.equal(spawnSync("git", args, { cwd: repo, encoding: "utf8" }).status, 0);
  }
  const key = `${path.basename(sandbox)}/${path.basename(repo)}`;
  fs.writeFileSync(path.join(state, "config.json"), JSON.stringify({ repos: { [key]: { checks: "npm test" } } }));
  // T2 approval opens GitHub issues; a stub gh returns an issue URL.
  const bin = fs.mkdtempSync(path.join(sandbox, "resume-bin-"));
  fs.writeFileSync(path.join(bin, "gh"), "#!/bin/sh\necho https://github.com/o/r/issues/7\n", { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, DT_DIR: state, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  const dt = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: repo, encoding: "utf8", env });
  const ok = (...args) => { const r = dt(...args); assert.equal(r.status, 0, `${args.join(" ")}: ${r.stderr}`); return r.stdout; };
  const dir = path.join(repo, "docs", "features", "f");
  const progress = () => JSON.parse(fs.readFileSync(path.join(dir, "progress.json"), "utf8"));
  const ticket = (id, blocked, touches) => `---\nid: "${id}"\ntitle: Ticket ${id}\nkind: AFK\nblocked_by: [${blocked}]\ntouches: [${touches}]\nverify: web\nunsafe_with: []\n---\nbody\n`;

  fs.mkdirSync(path.join(dir, "tickets"), { recursive: true });
  fs.writeFileSync(path.join(dir, "spec.md"), "# spec\n");
  fs.writeFileSync(path.join(dir, "tickets", "00-skeleton.md"), ticket("00", "", "core"));
  fs.writeFileSync(path.join(dir, "tickets", "01-slice.md"), ticket("01", '"00"', "api"));

  assert.match(ok("gate", "f", "0", "approve", "--tier", "T2", "--type", "web"), /next: \/dt-lane f/);
  ok("gate", "f", "2", "pending", "--note", "new building block");
  const pending = JSON.parse(ok("resume", "f", "--no-gh", "--json"));
  assert.equal(pending.phase, "planning: plan approval pending");
  assert.equal(pending.next, "/dt-approve plan");
  assert.match(dt("gate", "f", "1", "approve").stderr, /retired/);
  assert.match(ok("gate", "f", "2", "approve"), /next: \/dt-lane f/);

  const before = fs.readFileSync(path.join(dir, "progress.json"), "utf8");
  assert.match(ok("next", "f", "--ticket", "00", "--owner", "a", "--check-only", "--no-fetch"), /tickets are not on origin\/main yet/);
  assert.equal(fs.readFileSync(path.join(dir, "progress.json"), "utf8"), before, "preflight must not save");

  ok("progress", "f", "--ticket", "0", "--status", "review", "--pr", "12", "--no-gh", "--issue", "99", "--todo", "staging check", "--verification", "unit tests at abc123", "--next", "run the staging check");
  const saved = progress().tickets["00"];
  assert.deepEqual([saved.status, saved.prs[0].number, saved.todo[0]], ["review", 12, "staging check"]);
  assert.deepEqual(saved.issues.map((issue) => issue.ref), ["#7", "#99"]);
  ok("progress", "f", "--ticket", "00", "--todo", "replaced");
  assert.deepEqual(progress().tickets["00"].todo, ["replaced"], "updates replace, they do not append");
  assert.match(dt("progress", "f", "--next", "x".repeat(401)).stderr, /keep it under 400/);
  assert.match(dt("progress", "f", "--verification", "x").stderr, /need --ticket/);
  assert.match(dt("progress", "f", "--ticket", "07", "--next", "x").stderr, /no ticket 07/);

  const list = JSON.parse(ok("resume", "--json"));
  assert.equal(list[0].slug, "f");
  assert.match(list[0].label, /^f · build · 0\/2 done/);
  const brief = ok("resume", "f", "--no-gh");
  assert.match(brief, /in flight 1 \(00 review\)/);
  assert.match(brief, /PRs: #12 \(not checked\)/);
  assert.match(brief, /Next: run the staging check/);
  assert.match(brief, /Next:\*\* \/dt-review f 00/);
  assert.match(ok("resume", "f", "--no-gh", "--prompt"), /never edit progress.json by hand/);

  assert.match(ok("gate", "f", "3", "approve", "--ticket", "00"), /next: \/dt-lane f/);
  assert.deepEqual([progress().tickets["00"].status, progress().tickets["00"].todo, progress().drift], ["done", undefined, undefined]);
  assert.match(ok("progress", "f", "--ticket", "00"), /"status": "done"/);

  assert.match(ok("resume", "f", "--no-gh"), /1\/2 done · in flight 0 · ready: 01/);
});

test("existing pure-logic selftest still works", () => {
  const result = run(["selftest"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /all good/);
});

test("a T1 ticket runs in its own worktree like T2, without a spec", () => {
  const dir = fs.mkdtempSync(path.join(sandbox, "t1-"));
  const remote = path.join(dir, "remote.git"), repo = path.join(dir, "repo"), state = path.join(dir, "state");
  const env = { ...process.env, DT_DIR: state, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  const git = (...args) => { const r = spawnSync("git", args, { cwd: fs.existsSync(repo) ? repo : dir, env, encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  git("init", "--bare", "--initial-branch=main", remote);
  git("clone", remote, repo);
  git("commit", "--allow-empty", "-m", "init");
  git("push", "origin", "main");
  fs.mkdirSync(state);
  const dt = (...args) => spawnSync(process.execPath, [script, ...args, "--no-fetch"], { cwd: repo, env, encoding: "utf8" });
  const ok = (...args) => { const r = dt(...args); assert.equal(r.status, 0, `${args.join(" ")}: ${r.stderr}`); return r.stdout; };
  const feature = path.join(repo, "docs", "features", "fix-copy");
  fs.mkdirSync(path.join(feature, "tickets"), { recursive: true });
  fs.writeFileSync(path.join(feature, "tickets", "00-fix.md"), '---\nid: "00"\ntitle: Fix button copy\ntouches: [ui]\n---\n**Outcome**\nThe button says Save.\n');
  fs.writeFileSync(path.join(feature, "tickets", "01-help.md"), '---\nid: "01"\ntitle: Explain saving\nblocked_by: ["00"]\ntouches: [ui]\n---\n**Outcome**\nA hint explains saving.\n');
  // Plan approval creates GitHub issues; this repository has no GitHub remote, so the approval is saved directly.
  fs.writeFileSync(path.join(feature, "feature.json"), JSON.stringify({ slug: "fix-copy", tier: "T1", type: "web" }));
  fs.writeFileSync(path.join(feature, "progress.json"), JSON.stringify({ gates: { G0: { state: "approved" }, G2: { state: "approved" } } }));
  git("add", "docs");
  git("commit", "-m", "plan");
  git("push", "origin", "main");
  assert.match(ok("next", "fix-copy", "--owner", "a"), /open pi in .*repo\.lane-00/);
  assert.equal(git("branch", "--show-current"), "main");
  const lane = path.join(dir, "repo.lane-00");
  assert.equal(git("-C", lane, "branch", "--show-current"), "ticket/fix-copy-00");
  const saved = JSON.parse(fs.readFileSync(path.join(feature, "progress.json"), "utf8")).tickets["00"];
  assert.deepEqual([saved.branch, saved.status, fs.realpathSync(saved.worktree)], ["ticket/fix-copy-00", "in_progress", fs.realpathSync(lane)]);
  const body = path.join(dir, "pr.md"); fs.writeFileSync(body, "## Description\n- Fix copy.\n\n## Testing\nunit tests + staging tests\n");
  const pr = spawnSync(process.execPath, [script, "pr", "fix-copy", "00", "--owner", "a", "--body-file", body, "--dry-run"], { cwd: lane, env, encoding: "utf8" });
  assert.equal(pr.status, 0, pr.stderr);
  assert.match(pr.stdout, /--title "fix-copy 00: Fix button copy"/);
});

test("a T0 ticket stays on the current branch and leaves uncommitted work alone", () => {
  const dir = fs.mkdtempSync(path.join(sandbox, "local-"));
  const remote = path.join(dir, "remote.git"), repo = path.join(dir, "repo"), state = path.join(dir, "state");
  const env = { ...process.env, DT_DIR: state, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  const git = (...args) => { const r = spawnSync("git", args, { cwd: fs.existsSync(repo) ? repo : dir, env, encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  git("init", "--bare", "--initial-branch=main", remote);
  git("clone", remote, repo);
  git("commit", "--allow-empty", "-m", "init");
  git("push", "origin", "main");
  git("switch", "-c", "my-work");
  fs.mkdirSync(state);
  const dt = (...args) => spawnSync(process.execPath, [script, ...args, "--no-fetch"], { cwd: repo, env, encoding: "utf8" });
  const ok = (...args) => { const r = dt(...args); assert.equal(r.status, 0, `${args.join(" ")}: ${r.stderr}`); return r.stdout; };
  const feature = path.join(repo, "docs", "features", "fix-typo");
  fs.mkdirSync(path.join(feature, "tickets"), { recursive: true });
  fs.writeFileSync(path.join(feature, "tickets", "00-fix.md"), '---\nid: "00"\ntitle: Fix typo\ntouches: [ui]\n---\n**Outcome**\nThe label is spelled right.\n');
  ok("gate", "fix-typo", "0", "approve", "--tier", "T0", "--type", "web");
  const head = git("rev-parse", "HEAD");
  fs.writeFileSync(path.join(repo, "edit.txt"), "uncommitted");
  assert.match(ok("next", "fix-typo", "--ticket", "00", "--owner", "a"), /on the current branch my-work/);
  const saved = () => JSON.parse(fs.readFileSync(path.join(feature, "progress.json"), "utf8")).tickets["00"];
  assert.deepEqual([saved().branch, saved().worktree, saved().status, saved().claim.owner], [undefined, undefined, "in_progress", "a"]);
  ok("progress", "fix-typo", "--ticket", "00", "--owner", "a", "--release-claim", "--next", "finish the fix");
  assert.match(ok("next", "fix-typo", "--ticket", "00", "--owner", "b"), /resume: already on my-work/);
  assert.equal(saved().claim.owner, "b");
  assert.equal(git("branch", "--show-current"), "my-work");
  assert.equal(git("rev-parse", "HEAD"), head);
  assert.equal(git("branch", "--list", "quick/*"), "");
  assert.equal(git("ls-remote", "--heads", "origin", "my-work"), "");
  assert.equal(fs.readFileSync(path.join(repo, "edit.txt"), "utf8"), "uncommitted");
});
