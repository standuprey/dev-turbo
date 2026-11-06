import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveCommand } from "./extensions/dt-session/state.mjs";

const slice = readFileSync(new URL("./prompts/dt-slice.md", import.meta.url), "utf8");
const readme = readFileSync(new URL("./README.md", import.meta.url), "utf8");

test("amend clarifies in chat and suggests a route without artifacts or state changes", () => {
  const amend = readFileSync(new URL("./prompts/dt-amend.md", import.meta.url), "utf8");
  assert.match(amend, /\$\{@:2\}/);
  assert.match(amend, /Ask questions before choosing the route/);
  assert.match(amend, /whether the spec needs changing and how/);
  assert.match(amend, /whether the plan\/tickets\/slices need changing and how/);
  assert.match(amend, /Do not call dt_propose_scope/);
  assert.match(amend, /Do not create or update any feature artifact/);
  assert.match(amend, /Do not edit spec\.md or ticket files/);
  assert.match(amend, /Do not run dt\.mjs gate or write-mode progress commands/);
  assert.match(amend, /End with exactly the suggested next command, `\/dt-spec` or `\/dt-slice`/);
  assert.doesNotMatch(amend, /amendment\.md|gate \$1|--next/);
  const spec = readFileSync(new URL("./prompts/dt-spec.md", import.meta.url), "utf8");
  for (const prompt of [spec, slice]) {
    assert.doesNotMatch(prompt, /amendment\.md/);
    assert.match(prompt, /ask the user to restate it before editing/);
    assert.match(prompt, /not approval/);
  }
  assert.match(spec, /Preserve unchanged spec sections/);
});

test("Pi runtime: amend expands the complete description after the selected slug", { skip: !process.env.PI_PACKAGE_DIR }, async () => {
  const { expandPromptTemplate } = await import(pathToFileURL(join(process.env.PI_PACKAGE_DIR, "dist/core/prompt-templates.js")));
  const content = readFileSync(new URL("./prompts/dt-amend.md", import.meta.url), "utf8").replace(/^---\n[\s\S]*?\n---\n/, "");
  const project = { slug: "demo", tier: "T2", type: "mixed" };
  for (const description of ["prioritize isolating v1 without changing rollout", '"keep $1 literal and preserve v1 behavior"']) {
    const command = resolveCommand(`/dt-amend ${description}`, project);
    const prompt = expandPromptTemplate(command, [{ name: "dt-amend", content }]);
    assert.ok(prompt.includes('feature "demo"'));
    assert.ok(prompt.includes(`Requested change: ${description.replace(/^"|"$/g, "")}`));
    assert.ok(!prompt.includes("${@:2}"));
  }
});

test("help shows deliberate amendments separately from architecture drift", () => {
  const flow = readme.split("## Flow\n")[1]?.split(/^## /m)[0];
  assert.match(flow, /\/dt-amend <description>/);
  assert.match(flow, /not an approval gate/);
  assert.match(flow, /no artifacts, gate changes or progress writes/);
  assert.doesNotMatch(flow, /amendment\.md/);
});

test("merged-ticket final check verifies acceptance without rereview or approval", () => {
  assert.equal(existsSync(new URL("./prompts/dt-accept.md", import.meta.url)), false);
  const accept = readFileSync(new URL("./prompts/dt-final-check.md", import.meta.url), "utf8");
  assert.match(accept, /No repeat code review or rebuild/);
  assert.match(accept, /Require at least one saved PR and every ticket PR saved as merged/);
  assert.match(accept, /no pending approval card until acceptance is verified/);
  assert.match(accept, /Only the user.s `\/dt-approve ticket <id>` records completion/);
  assert.match(accept, /Reuse valid evidence/);
  assert.match(accept, /\/dt-final-check <id>/);
  assert.match(readme, /no extra step is required/);
  const install = readFileSync(new URL("./install.sh", import.meta.url), "utf8");
  assert.match(install, /rm -f .*"\$PROMPTS\/dt-accept\.md"/);
  const review = readFileSync(new URL("./prompts/dt-review.md", import.meta.url), "utf8");
  assert.ok(review.indexOf("Merged-ticket guard") < review.indexOf("git diff"), "merged guard must precede code review");
});

test("slice chooses initial planning or alignment before making changes", () => {
  assert.match(slice, /Choose the mode before editing/);
  assert.match(slice, /capture a before\/after delta/);
  assert.match(slice, /Do not amend the approved spec merely to make tickets fit/);
});

test("existing-ticket approval presents changes, not the initial plan", () => {
  const alignment = slice.split("### Existing tickets: alignment card")[1]?.split("### Approval rules")[0];
  assert.ok(alignment, "alignment must have its own card instructions");
  assert.match(alignment, /id \| title \| current status \| what changed \| why/);
  assert.match(alignment, /Do not repeat the full ticket table, full DAG or scenario-title inventory/);
  assert.match(alignment, /Only show changed scenarios or acceptance criteria/);
  assert.match(alignment, /No ticket scope or dependency changes/);
});

test("alignment distinguishes merged work from recorded acceptance", () => {
  assert.match(slice, /implemented, reviewed and merged; recorded acceptance pending/);
  assert.match(slice, /Documentation-only clarifications do not by themselves reopen acceptance/);
  assert.match(slice, /never mark a ticket done or record approval/);
  assert.match(slice, /Next command: `\/dt-approve slices`/);
});

test("help shows the T2 implementation loop and its drift branches", () => {
  const flow = readme.split("## Flow\n")[1]?.split(/^## /m)[0];
  const loop = flow?.split("### T2 implementation loop")[1]?.split("### Named approvals")[0];
  assert.ok(loop, "the loop must be inside the Flow section displayed by dt-help");
  for (const command of ["/dt-lane next", "/dt-review <id>", "/dt-approve ticket <id>", "/dt-drift", "/dt-approve drift", "/dt-drift apply", "/dt-slice", "/dt-approve slices"]) {
    assert.ok(loop.includes(command), `missing ${command}`);
  }
  assert.match(loop, /merge.*acceptance evidence/i);
  assert.ok(loop.includes("/dt-final-check <id>"));
  assert.match(loop, /Repeat for each ready ticket/);
  assert.match(loop, /every 2–3 merges and at the end/);
  assert.match(loop, /No spec\/scope changes/);
  assert.match(loop, /Spec or ticket scopes changed/);
  assert.match(loop, /not.*rebuild.*00/i);
});

test("help explains the existing-ticket delta card", () => {
  const flow = readme.split("## Flow\n")[1]?.split(/^## /m)[0];
  assert.match(flow, /When tickets already exist, `\/dt-slice` shows a change-review card/);
  assert.match(flow, /Merged work awaiting recorded Ticket acceptance is labelled explicitly/);
});
