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

test("final-check is removed and review hands merged work straight to closure", () => {
  assert.equal(existsSync(new URL("./prompts/dt-final-check.md", import.meta.url)), false);
  assert.equal(existsSync(new URL("./prompts/dt-accept.md", import.meta.url)), false);
  const install = readFileSync(new URL("./install.sh", import.meta.url), "utf8");
  assert.ok(install.includes('"$PROMPTS/dt-final-check.md"'));
  assert.doesNotMatch(readme, /\/dt-final-check/);
  assert.match(readme, /checks every saved ticket PR live on GitHub/);
  const review = readFileSync(new URL("./prompts/dt-review.md", import.meta.url), "utf8");
  assert.ok(review.indexOf("Merged-ticket guard") < review.indexOf("git diff"));
  assert.match(review, /\/dt-approve <id>/);
  assert.doesNotMatch(review, /\/dt-final-check/);
});

test("review focuses on actionable code improvements, not acceptance reports", () => {
  const review = readFileSync(new URL("./prompts/dt-review.md", import.meta.url), "utf8");
  assert.match(review, /Review the code and architecture and suggest concrete improvements/);
  assert.match(review, /roughly 200 words/);
  assert.match(review, /they do not determine the code-review verdict/);
  assert.match(review, /retain existing unresolved acceptance\/rollout prerequisites/);
  assert.match(review, /Do not invent findings to fill an axis/);
  assert.match(review, /No mandatory architecture diagram/);
  assert.match(review, /Never reproduce the full spec diagram/);
  assert.match(review, /Do not emit an empty table or offer unnecessary fixes/);
  assert.doesNotMatch(review, /the spec's module diagram as Mermaid|Write 1-3/);
});

test("review keeps findings in chat, offers selected fixes and makes re-review optional", () => {
  const review = readFileSync(new URL("./prompts/dt-review.md", import.meta.url), "utf8");
  assert.match(review, /Keep all findings in chat/);
  assert.match(review, /Do not post a PR review, PR comment or ticket comment/);
  assert.match(review, /do not run `dt\.mjs comment`, `gh pr review`, `gh pr comment` or a remote commenting tool/);
  assert.doesNotMatch(review, /write.*review to a temp file|node ~\/\.pi\/agent\/dt\/dt\.mjs comment/);
  assert.match(review, /Would you like me to fix any of these\?/);
  assert.match(review, /Wait for the user's selection before editing/);
  assert.match(review, /Only if the user selects findings to fix or the arguments contain "autofix"/);
  assert.match(review, /before touching code, run `node .* next \$1 --ticket <id> --owner <session-owner>`/);
  assert.match(review, /if refused or directed to another checkout, STOP/);
  assert.match(review, /--release-claim/);
  assert.match(review, /re-review after fixes, but it is optional, never a required checkpoint/);
  assert.match(review, /Code fixes suggested; re-review optional/);
  assert.match(review, /do not require another `\/dt-review` invocation/);
  assert.doesNotMatch(review, /Fresh review required|fix and repeat review/);
  const quick = readFileSync(new URL("./prompts/dt-quick.md", import.meta.url), "utf8");
  assert.match(quick, /proposes ticket acceptance only after its verdict is merge/);
  for (const doc of [readme, readFileSync(new URL("./workflow.md", import.meta.url), "utf8")]) {
    assert.match(doc, /[Rr]e-review.*optional/);
    assert.doesNotMatch(doc, /fix and repeat review|Fix findings and repeat review|short PR comment|posted only when actionable/);
  }
});

test("implementation and review keep shipped work independent of dev-turbo context", () => {
  const conventions = readFileSync(new URL("./AGENTS.md", import.meta.url), "utf8");
  assert.match(conventions, /Code, comments, test names, commit messages and PR titles\/bodies must stand on their own/);
  assert.match(conventions, /Never reference the dev-turbo plan, spec, tickets, slices or gates/);
  assert.match(conventions, /Workflow references belong only in dev-turbo planning artifacts, saved progress and command\/gate handovers/);
  assert.match(conventions, /Reads stored v1 brand configurations/);
  for (const name of ["dt-lane", "dt-quick"]) {
    const prompt = readFileSync(new URL(`./prompts/${name}.md`, import.meta.url), "utf8");
    assert.match(prompt, /Code, comments, test names, commit messages and PR titles\/bodies must stand on their own/);
    assert.match(prompt, /Never reference the dev-turbo plan, spec, tickets, slices or gates/);
    assert.match(prompt, /Describe current behavior and technical reasons/);
  }
  const review = readFileSync(new URL("./prompts/dt-review.md", import.meta.url), "utf8");
  assert.match(review, /Flag references to the dev-turbo plan, spec, tickets, slices or gates in shipped code/);
  assert.match(review, /do not assume readers know the workflow/);
});

test("slice chooses initial planning or alignment before making changes", () => {
  assert.match(slice, /Choose the mode before editing/);
  assert.match(slice, /capture a before\/after delta/);
  assert.match(slice, /Do not amend the approved spec merely to make tickets fit/);
});

test("specs and tickets map each concrete change to one scenario", () => {
  const spec = readFileSync(new URL("./prompts/dt-spec.md", import.meta.url), "utf8");
  const review = readFileSync(new URL("./prompts/dt-review.md", import.meta.url), "utf8");
  assert.match(spec, /\*\*Slice changes\*\* - for each slice, a compact `Change \| Purpose` table/);
  assert.match(slice, /\*\*Changes\*\* is a table: `Change \| Purpose`/);
  assert.match(slice, /exactly one scenario per Change row, in the same order/);
  assert.match(slice, /Do not add scenarios without a matching row/);
  assert.match(review, /Changes table and Gherkin/);
  assert.match(readme, /one Gherkin scenario per change/);
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
  for (const command of ["/dt-lane", "/dt-review <id>", "/dt-approve <id>", "/dt-drift", "/dt-approve drift", "/dt-drift apply", "/dt-slice", "/dt-approve slices"]) {
    assert.ok(loop.includes(command), `missing ${command}`);
  }
  assert.match(loop, /checks live merge states and records completion/);
  assert.ok(!loop.includes("/dt-final-check"));
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
