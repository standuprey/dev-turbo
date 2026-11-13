import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as logic from "./dt.mjs";
import { laneOptions } from "./extensions/dt-session/lane-picker.mjs";

const script = path.resolve(import.meta.dirname, "dt.mjs");
function fixture(t, name = "monorepo") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dt-jira-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repo = path.join(dir, "repo"), remote = path.join(dir, "remote.git"), state = path.join(dir, "state");
  const env = { ...process.env, DT_DIR: state, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  const git = (...args) => { const r = spawnSync("git", args, { cwd: fs.existsSync(repo) ? repo : dir, env, encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  git("init", "--bare", "--initial-branch=main", remote);
  git("clone", remote, repo);
  git("commit", "--allow-empty", "-m", "init");
  git("push", "origin", "main");
  const key = `csscompany-enterprise/${name}`, url = `https://github.com/${key}.git`;
  git("remote", "set-url", "origin", url);
  git("remote", "set-url", "--push", "origin", remote);
  const bin = path.join(dir, "bin"); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "gh"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  env.PATH = `${bin}:${env.PATH}`;
  fs.mkdirSync(state);
  fs.writeFileSync(path.join(state, "config.json"), JSON.stringify({ repos: { [key]: { modality: name === "monorepo" ? "monorepo" : "standalone", lanes: [repo] } } }));
  const feature = name === "monorepo" ? path.join(state, "features", key, "f") : path.join(repo, "docs", "features", "f");
  const dt = (...args) => spawnSync(process.execPath, [script, ...args, "--no-fetch", "--no-gh"], { cwd: repo, env, encoding: "utf8" });
  const ok = (...args) => { const r = dt(...args); assert.equal(r.status, 0, `${args}: ${r.stdout}\n${r.stderr}`); return r.stdout; };
  const saved = () => JSON.parse(fs.readFileSync(path.join(feature, "progress.json"), "utf8"));
  const description = path.join(dir, "description.md");
  fs.writeFileSync(description, "- Update schema for f ticket 00.\n- Keep existing consumers working.\n- Verify migration behavior.\n");
  const plan = () => {
    ok("epic", "f", "--key", "OV-100");
    fs.mkdirSync(path.join(feature, "tickets"));
    fs.writeFileSync(path.join(feature, "spec.md"), "# Spec\n");
    for (const id of ["00", "01"]) fs.writeFileSync(path.join(feature, "tickets", `${id}.md`), `---\nid: ${id}\ntitle: Update schema\ntouches: [module${id}]\nblocked_by: []\nunsafe_with: []\n---\nbody\n`);
    ok("gate", "f", "0", "approve", "--tier", "T2", "--type", "service");
    assert.equal(saved().gates.G2.state, "approved");
  };
  return { repo, feature, dt, ok, saved, git, description, plan };
}

test("new monorepo Jira issues require verified assignment, active sprint and In Progress before branching", () => {
  const prompt = fs.readFileSync(new URL("./prompts/dt-lane.md", import.meta.url), "utf8");
  const setup = prompt.split("## Jira setup (T2 in the two CSS repos only)")[1].split("## Saving state")[0];
  const updates = setup.split("5. For newly created Jira tickets in **monorepo modality**")[1].split("6. Run the normal `next` command")[0];
  assert.ok(setup.indexOf("--jira-key <KEY>") < setup.indexOf("5. For newly created"));
  assert.match(updates, /authenticated-user\/profile tools/);
  assert.match(updates, /Do not use the lane claim owner as a Jira identity/);
  assert.match(updates, /service account.*ask for their Jira account/);
  assert.match(updates, /sprint in openSprints\(\)/);
  assert.match(updates, /no board lookup is needed/);
  assert.match(updates, /Exactly one active sprint: use its ID without asking/);
  assert.match(updates, /Use the sprint ID, not its name/);
  assert.match(updates, /Several: ask one question naming them/);
  assert.match(updates, /None: report it and ask how to proceed/);
  assert.match(updates, /keep the claim, ask, and continue in this session once I answer/);
  assert.match(prompt, /never bare IDs/);
  assert.match(updates, /never start a sprint/);
  assert.match(updates, /available transitions.*transition to In Progress/);
  assert.match(updates, /separate calls.*issue edit \(`atlassian-editJiraIssue`\).*Then query the issue's available transitions and call `atlassian-transitionJiraIssue` with only the transition/);
  assert.match(updates, /Never put assignee, sprint or other fields in the transition call/);
  assert.match(updates, /Do not hard-code a transition ID or write the status field directly/);
  assert.match(updates, /Re-read the issue and verify the assignee account ID, active sprint ID and In Progress status/);
  assert.match(updates, /progress --verification/);
  assert.match(updates, /keep the saved Jira key, save a blocker and release your claim/);
  assert.match(updates, /apply only missing setup changes; never create a replacement issue/);
  assert.match(updates, /Do not reassign, move to a newer sprint or reset the status.*when resuming/);
  assert.match(updates, /Standalone modality retains its existing Jira behavior/);
  for (const file of ["AGENTS.md", "README.md"]) {
    const doc = fs.readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    assert.match(doc, /monorepo modality, newly created Jira tickets.*assigned to the user.*current active sprint.*In Progress/i);
    assert.match(doc, /standalone behavior is unchanged/i);
  }
});

test("Jira policy matches only the two named repos and normalizes branches", () => {
  for (const key of ["csscompany-enterprise/monorepo", "csscompany-enterprise/ottercam"]) assert.equal(logic.requiresJira(key), true);
  assert.equal(logic.requiresJira("other/monorepo"), false);
  assert.equal(logic.requiresJira("csscompany-enterprise/other"), false);
  assert.equal(logic.jiraBranch("ov-777", "Update schema"), "ov_777_update_schema");
  assert.equal(logic.jiraBranch("CAM-12", "Fix café / API v2!"), "cam_12_fix_cafe_api_v2");
  assert.throws(() => logic.jiraBranch("fake", "title"), /Jira key/);
});

for (const name of ["monorepo", "ottercam"]) test(`${name}: only T2 requires an epic during scope proposal and approval`, (t) => {
  const f = fixture(t, name);
  const ctx = { key: `csscompany-enterprise/${name}`, featuresBase: path.dirname(f.feature) };
  for (const tier of ["T0", "T1", "T2"]) {
    const p = path.join(ctx.featuresBase, tier);
    const writePlan = () => { fs.mkdirSync(path.join(p, "tickets"), { recursive: true }); fs.writeFileSync(path.join(p, "tickets", "00.md"), "---\nid: \"00\"\ntitle: Task\n---\n"); if (tier === "T2") fs.writeFileSync(path.join(p, "spec.md"), "# Brief\n"); };
    if (tier === "T2") {
      assert.throws(() => logic.requireEpic(ctx, tier, tier), /epic/);
      writePlan();
      assert.match(f.dt("gate", tier, "0", "approve", "--tier", tier, "--type", "cli").stderr, /epic/);
      assert.equal(fs.existsSync(path.join(p, "feature.json")), false);
      f.ok("epic", tier, "--key", "ov-100");
      assert.equal(JSON.parse(fs.readFileSync(path.join(p, "feature.json"))).epic, "OV-100");
      assert.equal(fs.existsSync(path.join(p, "progress.json")), false);
      assert.equal(logic.requireEpic(ctx, tier, tier), "OV-100");
    } else {
      assert.equal(logic.requireEpic(ctx, tier, tier), null);
      assert.match(f.dt("gate", tier, "0", "approve", "--tier", tier, "--type", "cli").stderr, /no tickets/);
      writePlan();
    }
    f.ok("gate", tier, "0", "approve", "--tier", tier, "--type", "cli");
    const feature = JSON.parse(fs.readFileSync(path.join(p, "feature.json")));
    assert.equal(feature.tier, tier);
    if (tier !== "T2") assert.equal(feature.epic, undefined);
    assert.equal(logic.requireEpic(ctx, tier), tier === "T2" ? "OV-100" : null);
    assert.equal(JSON.parse(fs.readFileSync(path.join(p, "progress.json"))).gates.G0.state, "approved");
  }
  // Revising an existing quick task to T2 must check the proposed tier, not the saved tier.
  assert.throws(() => logic.requireEpic(ctx, "T1", "T2"), /epic/);
  assert.match(f.dt("gate", "T1", "0", "approve", "--tier", "T2", "--type", "cli").stderr, /epic/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(ctx.featuresBase, "T1", "feature.json"))).tier, "T1");
});

test("grill and lane instructions require epics only for T2 and keep T0/T1 work in one ticket", () => {
  const start = fs.readFileSync(new URL("./prompts/dt-start.md", import.meta.url), "utf8");
  const lane = fs.readFileSync(new URL("./prompts/dt-lane.md", import.meta.url), "utf8");
  assert.match(start, /Wait for the user to choose the tier before asking for an epic/);
  assert.match(start, /T0\/T1 assume all work fits inside one ticket/);
  assert.match(start, /refuses a missing one only for T2/);
  assert.match(start, /T0\/T1: exactly one ticket, `00`/);
  assert.match(lane, /T0\/T1 features and other repos skip it/);
});

test("claim → Jira metadata → snake_case branch → resume and PR mapping", (t) => {
  const f = fixture(t); f.plan();
  assert.match(f.dt("next", "f", "--ticket", "00", "--owner", "a").stderr, /Jira/);
  assert.equal(f.saved().tickets?.["00"], undefined);
  const before = f.git("branch", "--show-current");
  assert.match(f.ok("next", "f", "--ticket", "00", "--owner", "a", "--claim-only"), /no branch created/);
  assert.equal(f.git("branch", "--show-current"), before);
  assert.equal(f.saved().tickets["00"].branch, undefined);
  assert.match(f.dt("next", "f", "--ticket", "00", "--owner", "b", "--claim-only").stderr, /claimed/);
  assert.match(f.dt("progress", "f", "--ticket", "00", "--owner", "b", "--jira-key", "OV-777", "--jira-description-file", f.description).stderr, /claimed/);
  f.ok("progress", "f", "--ticket", "00", "--owner", "a", "--jira-key", "OV-777", "--jira-description-file", f.description);
  assert.equal(f.saved().tickets["00"].jira.epic, "OV-100");
  assert.equal(f.saved().tickets["00"].jira.title, "Update schema");
  assert.equal(f.saved().tickets["00"].issues[0].ref, "OV-777");
  assert.match(f.dt("epic", "f", "--key", "OV-101").stderr, /cannot change epic/);
  assert.match(f.dt("progress", "f", "--ticket", "00", "--owner", "a", "--jira-key", "OV-778", "--jira-description-file", f.description).stderr, /already saved/);
  f.ok("next", "f", "--ticket", "00", "--owner", "a");
  assert.equal(f.git("branch", "--show-current"), "ov_777_update_schema");
  assert.equal(f.saved().tickets["00"].branch, "ov_777_update_schema");
  assert.match(f.ok("next", "f", "--ticket", "00", "--owner", "a"), /resume: already on ov_777_update_schema/);
  const claimedBeforeSwitch = f.saved().tickets["00"].claim;
  assert.match(f.dt("next", "f", "--ticket", "01", "--owner", "a").stderr, /Jira/);
  assert.deepEqual(f.saved().tickets["00"].claim, claimedBeforeSwitch);
  assert.match(f.ok("status", "f"), /lane 1/);
  const ctx = logic.resolveRepo(f.repo, { repos: { "csscompany-enterprise/monorepo": { modality: "monorepo", lanes: [f.repo] } } });
  const snapshot = logic.readFeatureStatus({ ...ctx, featuresBase: path.dirname(f.feature) }, "f");
  const options = laneOptions(snapshot, { modality: "monorepo", branch: "ov_777_update_schema", root: f.repo, lanes: [f.repo] }, "a", logic);
  assert.equal(options.find((o) => o.id === "01").selectable, true);
  const body = path.join(path.dirname(f.description), "pr.md"); fs.writeFileSync(body, "## Description\n- Update schema.\n\n## Testing\nunit tests + staging tests\n");
  const prOutput = f.ok("pr", "f", "00", "--owner", "a", "--body-file", body, "--dry-run");
  assert.match(prOutput, /--head ov_777_update_schema/);
  assert.match(prOutput, /--title "OV-777: Update schema"/);
  const generatedBody = prOutput.match(/--body-file (\S+)/)?.[1];
  assert.ok(generatedBody, prOutput);
  assert.match(fs.readFileSync(generatedBody, "utf8"), /## Description\nhttps:\/\/csscompany\.atlassian\.net\/browse\/OV-777\n\n- Update schema\./);
  assert.equal(fs.readFileSync(body, "utf8"), "## Description\n- Update schema.\n\n## Testing\nunit tests + staging tests\n");
});

test("ottercam: pending claim becomes a worktree and cleanup deletes the saved Jira branch", (t) => {
  const f = fixture(t, "ottercam"); f.plan();
  // Jira repos must not create GitHub issues during planning approvals.
  assert.match(f.dt("gate", "f", "1", "approve").stderr, /retired/);
  f.ok("gate", "f", "2", "approve");
  f.git("add", "docs"); f.git("commit", "-m", "plan"); f.git("push", "origin", "main");
  f.ok("next", "f", "--ticket", "00", "--owner", "a", "--claim-only");
  assert.equal(f.saved().tickets["00"].worktree, undefined);
  f.ok("progress", "f", "--ticket", "00", "--owner", "a", "--jira-key", "CAM-777", "--jira-description-file", f.description);
  f.git("add", "docs"); f.git("commit", "-m", "Jira mapping"); f.git("push", "origin", "main");
  assert.match(f.ok("next", "f", "--ticket", "00", "--owner", "a"), /open pi in/);
  const saved = f.saved().tickets["00"];
  assert.equal(saved.branch, "cam_777_update_schema");
  assert.equal(saved.claim, undefined);
  assert.ok(fs.existsSync(saved.worktree));
  assert.equal(saved.lane, undefined);
  assert.equal(f.git("branch", "--show-current"), "main");
  assert.match(f.dt("progress", "f", "--ticket", "00", "--worktree", "relative").stderr, /absolute path/);
  const moved = path.join(path.dirname(f.repo), "moved-worktree");
  f.git("worktree", "move", saved.worktree, moved);
  f.ok("progress", "f", "--ticket", "00", "--worktree", moved);
  assert.match(f.dt("next", "f", "--ticket", "00", "--owner", "b").stderr, /belongs to checkout/);
  const resumed = spawnSync(process.execPath, [script, "next", "f", "--ticket", "00", "--owner", "b", "--no-fetch"], { cwd: moved, env: { ...process.env, DT_DIR: path.join(path.dirname(f.repo), "state") }, encoding: "utf8" });
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.match(resumed.stdout, /resume: already on cam_777_update_schema/);
  f.ok("gate", "f", "3", "approve", "--ticket", "00");
  assert.equal(fs.existsSync(moved), false);
  assert.doesNotMatch(f.git("branch", "--list"), /cam_777_update_schema/);
});

test("Jira descriptions require 3–5 short bullets and a claim", (t) => {
  const f = fixture(t); f.plan();
  assert.match(f.dt("progress", "f", "--ticket", "00", "--owner", "a", "--jira-key", "OV-777", "--jira-description-file", f.description).stderr, /claim/);
  f.ok("next", "f", "--ticket", "00", "--owner", "a", "--claim-only");
  for (const text of ["- One\n- Two", "Not bullets\nAnother\nThird", Array(6).fill("- Too many").join("\n")]) {
    fs.writeFileSync(f.description, text);
    assert.match(f.dt("progress", "f", "--ticket", "00", "--owner", "a", "--jira-key", "OV-777", "--jira-description-file", f.description).stderr, /3 to 5/);
  }
  assert.equal(f.saved().tickets["00"].jira, undefined);
});
