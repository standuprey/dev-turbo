import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./dt.mjs", import.meta.url));
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
  ["resume"], ["progress"], ["status"], ["next"], ["gate"], ["pr"], ["pr", "quick"], ["comment"], ["selftest"],
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
  for (const topic of [["pr"], ["pr", "quick"]]) {
    const result = run([...topic, "--help"]);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /five-bullet|5-bullet|5 bullets/);
    if (topic.length === 1) assert.match(result.stdout, /unit tests \+ staging tests/);
    else assert.match(result.stdout, /short description/);
  }
});

test("Gate 0 accepts CLI tasks at every tier and rejects unknown types", () => {
  const repo = fs.mkdtempSync(path.join(sandbox, "gate-repo-"));
  const state = fs.mkdtempSync(path.join(sandbox, "gate-state-"));
  for (const args of [["init", "--quiet"], ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]]) {
    const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  const gate = (tier, type) => spawnSync(process.execPath, [script, "gate", `example-${tier}`, "0", "approve", "--tier", tier, "--type", type], {
    cwd: repo, encoding: "utf8", env: { ...process.env, DT_DIR: state },
  });
  for (const tier of ["T0", "T1"]) {
    const result = gate(tier, "cli");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`G0 approve: ${tier} cli`));
    assert.match(result.stdout, /next: \/dt-quick cli as aligned/);
    assert.equal(fs.existsSync(path.join(repo, "docs")), false);
  }
  const result = gate("T2", "cli");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /next: \/dt-spec example-T2 cli/);
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
  const repo = fs.mkdtempSync(path.join(sandbox, "mono-repo-"));
  const state = fs.mkdtempSync(path.join(sandbox, "mono-state-"));
  for (const args of [["init", "--quiet"], ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]]) {
    assert.equal(spawnSync("git", args, { cwd: repo, encoding: "utf8" }).status, 0);
  }
  const key = `${path.basename(sandbox)}/${path.basename(repo)}`;
  fs.writeFileSync(path.join(state, "config.json"), JSON.stringify({ repos: { [key]: { modality: "monorepo", lanes: [repo], checks: "npm test" } } }));
  const env = { ...process.env, DT_DIR: state, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  const dt = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: repo, encoding: "utf8", env });
  const ok = (...args) => { const r = dt(...args); assert.equal(r.status, 0, `${args.join(" ")}: ${r.stderr}`); return r.stdout; };
  const dir = path.join(state, "features", key, "f");
  const progress = () => JSON.parse(fs.readFileSync(path.join(dir, "progress.json"), "utf8"));
  const ticket = (id, blocked, touches) => `---\nid: "${id}"\ntitle: Ticket ${id}\nkind: AFK\nblocked_by: [${blocked}]\ntouches: [${touches}]\nverify: web\nunsafe_with: []\n---\nbody\n`;

  ok("gate", "f", "0", "approve", "--tier", "T2", "--type", "web");
  fs.writeFileSync(path.join(dir, "spec.md"), "# spec\n");
  fs.mkdirSync(path.join(dir, "tickets"));
  fs.writeFileSync(path.join(dir, "tickets", "00-skeleton.md"), ticket("00", "", "core"));
  fs.writeFileSync(path.join(dir, "tickets", "01-slice.md"), ticket("01", '"00"', "api"));

  ok("gate", "f", "1", "pending", "--note", "card shown");
  const pending = JSON.parse(ok("resume", "f", "--no-gh", "--json"));
  assert.equal(pending.phase, "spec: Gate 1 pending");
  assert.match(pending.next, /Gate 1: waiting for my decision \(card shown\)/);
  ok("gate", "f", "1", "approve");
  assert.match(ok("gate", "f", "2", "approve"), /next: \/dt-lane f/);

  const before = fs.readFileSync(path.join(dir, "progress.json"), "utf8");
  assert.match(ok("next", "f", "--dry-run", "--no-fetch"), /ticket 00 "Ticket 00"/);
  assert.equal(fs.readFileSync(path.join(dir, "progress.json"), "utf8"), before, "dry-run must not save");

  ok("progress", "f", "--ticket", "0", "--status", "review", "--pr", "12", "--no-gh", "--issue", "OV-1", "--todo", "staging check", "--verification", "unit tests at abc123", "--next", "run the staging check");
  const saved = progress().tickets["00"];
  assert.deepEqual([saved.status, saved.prs[0].number, saved.issues[0].ref, saved.todo[0]], ["review", 12, "OV-1", "staging check"]);
  ok("progress", "f", "--ticket", "00", "--todo", "replaced");
  assert.deepEqual(progress().tickets["00"].todo, ["replaced"], "updates replace, they do not append");
  assert.match(dt("progress", "f", "--next", "x".repeat(401)).stderr, /keep it under 400/);
  assert.match(dt("progress", "f", "--verification", "x").stderr, /need --ticket/);
  assert.match(dt("progress", "f", "--ticket", "07", "--next", "x").stderr, /no ticket 07/);

  const list = JSON.parse(ok("resume", "--json"));
  assert.equal(list[0].slug, "f");
  assert.match(list[0].label, /^f · build · 0\/2 done/);
  const brief = ok("resume", "f", "--no-gh");
  assert.match(brief, /in flight 1\/2 \(00 review\)/);
  assert.match(brief, /PRs: #12 \(not checked\)/);
  assert.match(brief, /Next:\*\* 00: run the staging check/);
  assert.match(ok("resume", "f", "--no-gh", "--prompt"), /never edit progress.json by hand/);

  assert.match(ok("gate", "f", "3", "approve", "--ticket", "00"), /next: \/dt-lane f/);
  assert.deepEqual([progress().tickets["00"].status, progress().tickets["00"].todo, progress().drift.merges_since], ["done", undefined, 1]);
  assert.match(ok("progress", "f", "--ticket", "00"), /"status": "done"/);
  const log = spawnSync("git", ["log", "--format=%s"], { cwd: path.join(state, "features"), encoding: "utf8" }).stdout;
  assert.match(log, /dt: G3 approve ticket 00 f/);
  assert.match(log, /dt: G1 approve f/);

  assert.match(ok("resume", "f", "--no-gh"), /1\/2 done · in flight 0\/2 · ready: 01/);
});

test("existing pure-logic selftest still works", () => {
  const result = run(["selftest"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /all good/);
});
