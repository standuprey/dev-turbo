import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveCommand } from "./extensions/dt-session/state.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const readme = read("./README.md"), workflow = read("./workflow.md");
const start = read("./prompts/dt-start.md"), revise = read("./prompts/dt-revise.md"), lane = read("./prompts/dt-lane.md"), review = read("./prompts/dt-review.md");
const flow = readme.split("## Flow\n")[1]?.split(/^## /m)[0];

test("only four workflow prompts remain; removed prompts are cleaned up on install", () => {
  for (const name of ["dt-spec", "dt-slice", "dt-amend", "dt-drift", "dt-quick", "dt-final-check", "dt-accept"]) {
    assert.equal(existsSync(new URL(`./prompts/${name}.md`, import.meta.url)), false, name);
  }
  const install = read("./install.sh");
  for (const name of ["dt-spec", "dt-slice", "dt-amend", "dt-drift", "dt-quick", "dt-final-check"]) assert.match(install, new RegExp(`\\b${name}\\b`));
  for (const doc of [readme, workflow, start, revise, lane, review]) assert.doesNotMatch(doc, /\/dt-(?:spec|slice|amend|drift|quick|show)\b(?![^\n]*print their replacement)/);
});

test("the grill waits for the user's tier choice after a short summary", () => {
  assert.match(start, /summarize the task in at most 3 short sentences/);
  assert.match(start, /Which tier do you want: T0, T1 or T2\?/);
  for (const tier of ["T0", "T1", "T2"]) assert.ok(start.includes(`| ${tier} |`));
  assert.match(start, /Explain the workflow differences, not which tier you think fits the task/);
  assert.match(start, /never infer, recommend or default to T0\/T1\/T2/);
  assert.match(start, /STOP and wait for my explicit choice/);
  assert.match(start, /A chat "yes" is not a tier choice/);
  assert.match(start, /already explicitly chose a tier for this scope, use that choice/);
  assert.match(start, /After my choice, resolve any required T2 Jira epic/);
  assert.match(start, /If I change the scope itself, summarize it again and ask me to choose the tier again/);
  for (const doc of [readme, workflow]) {
    assert.match(doc, /short (?:task )?summary/);
    assert.match(doc, /without guessing or recommending a tier/);
  }
  const session = read("./extensions/dt-session/index.ts");
  assert.match(session, /After an explicit choice, write the plan files, call dt_propose_plan with that tier/);
  assert.match(session, /after the user explicitly chose T0\/T1\/T2/);
});

test("the grill writes a short brief and outcome-level tickets, not a design document", () => {
  const plan = start.split("## Write the plan")[1];
  assert.ok(plan, "dt-start must write the plan");
  assert.match(plan, /reflects this session only/);
  assert.match(plan, /do not invent contracts, schemas or per-file changes/);
  assert.match(plan, /one to two pages/);
  assert.match(plan, /T0\/T1: exactly one ticket, `00`/);
  assert.match(plan, /Prefer fewer, larger tickets/);
  assert.match(plan, /under ~700 lines of change/);
  assert.match(plan, /No Gherkin, change tables or exhaustive file lists/);
  assert.match(plan, /00 is the walking skeleton/);
  assert.match(plan, /Interfaces are reviewed in its PR, not on paper/);
  assert.doesNotMatch(plan, /Change \| Purpose|Critique|Score each module/);
  assert.match(start, /Call `dt_propose_plan` with the slug, my chosen tier/);
  assert.match(start, /\*\*Next command: `\/dt-approve plan`\*\*/);
  assert.match(start, /Never run `dt\.mjs gate` yourself/);
});

test("spec requirements stay separate from ticket implementation and targeted revisions", () => {
  const spec = start.split("### T2 brief: `spec.md`")[1].split("### Tickets:")[0];
  assert.match(spec, /The spec answers \*\*what and why\*\*, not how/);
  assert.match(spec, /Do not include slices, ticket lists or IDs, module ownership, dependency tables, architecture diagrams, implementation steps or landing order/);
  assert.doesNotMatch(spec, /\*\*Building blocks\*\*|Mermaid `flowchart/);
  assert.match(start, /Tickets answer \*\*how\*\*/);
  assert.match(start, /Ticket 00 owns the shared \*\*Building blocks\*\* section/);
  assert.match(start, /diagram from ticket 00/);
  assert.match(revise, /read only the ticket bodies needed/);
  assert.match(revise, /implementation-only revisions leave it untouched/);
  assert.match(revise, /Edit the affected tickets without rewriting unrelated ones/);
  assert.match(revise, /Move existing slices, module ownership, architecture and landing order out of the spec/);
  assert.match(revise, /Never edit done or merged tickets to relocate it/);
  assert.match(lane, /Build ticket 00's interfaces from its Building blocks section/);
  for (const doc of [readme, workflow]) {
    assert.match(doc, /spec says what and why/);
    assert.match(doc, /[Ii]mplementation-only (?:changes|revisions) leave the spec untouched/);
  }
});

test("unresolved implementation questions become bounded spikes with dependent work blocked", () => {
  assert.match(start, /create a separate, bounded spike ticket instead of guessing an approach/);
  assert.match(start, /ordinary factual questions is still part of planning, not a spike/);
  assert.match(start, /keep `kind: AFK`.*`kind: HITL`/);
  assert.match(start, /\*\*Investigation\*\* section/);
  assert.match(start, /question to answer, known options, experiment or comparison, a time or effort limit/);
  assert.match(start, /negative or inconclusive result is valid/);
  assert.match(start, /Dependent implementation tickets list the spike in `blocked_by`/);
  assert.match(start, /leave out the dependency on 00, and make 00 depend on it/);
  assert.match(start, /Never create a dependency cycle/);
  assert.match(start, /never change the tier yourself/);
  assert.match(revise, /add a bounded spike rather than guessing implementation/);
  assert.match(revise, /Preserve in-flight and completed ticket protections/);
  assert.match(lane, /Replace the implementation loop's scenario-first and TDD steps/);
  assert.match(lane, /stop at the stated time or effort limit/);
  assert.match(lane, /Commit the findings so normal PR review and merge closure apply/);
  assert.match(lane, /dependent tickets remain blocked until the spike is closed and their unresolved approach is settled/);
  assert.match(review, /review the findings against its question, experiment, effort limit and Done when/);
  assert.match(review, /do not demand production implementation or feature scenarios/);
  for (const doc of [readme, workflow]) assert.match(doc, /bounded spike/);
});

test("tickets explain concrete behavior with code or pseudocode without inventing contracts", () => {
  assert.match(start, /\*\*Example\*\* \(a small code or pseudocode block showing the behavior\)/);
  assert.match(start, /Titles name the action and object/);
  assert.match(start, /Use real function, type and module names when known/);
  assert.match(start, /Do not invent API signatures or schemas/);
  assert.match(start, /Every ticket includes a short input → output, before → after, or call-flow example/);
  assert.match(start, /not a prescribed implementation or frozen interface/);
  assert.match(start, /Done when states observable results with concrete values/);
  assert.match(start, /readConfig\(\{ version: 99 \}\) -> unsupported-version error/);
  assert.doesNotMatch(start, /file lists or code/);
  assert.match(revise, /Outcome, Scope, Example, Out of scope, Done when/);
  assert.match(revise, /New and clarified tickets follow its concrete-language rules/);
  assert.match(revise, /only clarify its existing behavior, not add requirements/);
});

test("UI tickets describe pages, controls, actions and visible results in plans and Jira", () => {
  for (const prompt of [start, revise, lane]) {
    assert.match(prompt, /page or route, visible UI elements, user actions and (?:the visible result of each action|their visible results)/);
    assert.match(prompt, /mixed UI\/backend/);
    assert.match(prompt, /known or settled routes, labels and behavior|routes and labels known from the code or agreed with the user/);
  }
  assert.match(start, /Outcome and Scope describe what users see and do; Example walks through those actions; Done when checks the resulting screen state/);
  assert.match(start, /Click "Add brand" -> dialog opens with a "Brand name" input/);
  assert.match(start, /Canceling leaves the list unchanged and creates no brand/);
  assert.match(start, /ask about missing product decisions instead of inventing pages, controls or behavior/);
  assert.match(revise, /must only clarify its existing behavior, not add requirements/);
  assert.match(lane, /keep the Jira description concrete too/);
  assert.match(lane, /keep the description within 3 to 5 bullets/);
  const web = read("./overlays/web.md");
  assert.match(web, /UI ticket descriptions name the page or route/);
  assert.match(web, /Use meaningful UI actions when needed, not CSS selectors/);
  assert.doesNotMatch(web, /never selectors or clicks/);
});

test("UI planning captures supplied prototypes and links durable references in tickets", () => {
  assert.match(start, /## UI references/);
  assert.match(start, /During the grill, open any supplied prototype/);
  assert.match(start, /authoritative for appearance and behavior or only illustrative/);
  assert.match(start, /references\/ui\/manifest\.md/);
  assert.match(start, /source URL, screen\/state, viewport, capture date and steps to reproduce/);
  assert.match(start, /user-provided screenshots or an explicit waiver/);
  assert.match(start, /No supplied prototype: ask for a visual reference or an explicit waiver/);
  assert.match(start, /Every UI ticket, including mixed UI\/backend tickets/);
  assert.match(start, /embedded relative screenshot links/);
  assert.match(start, /agreed differences/);
  assert.match(start, /Verify that every linked screenshot exists/);
  assert.match(start, /!\[Brands list\]\(\.\.\/references\/ui\/brands-list\.png\)/);
  assert.match(revise, /Apply `\/dt-start`'s UI reference requirements/);
  assert.match(revise, /Do not silently waive missing references/);
  assert.match(revise, /Adding references to an in-flight ticket may only clarify settled scope/);
  assert.match(readme, /references\/ui\/manifest\.md/);
});

test("UI lanes read planning screenshots and compare results without asserting pixels", () => {
  const web = read("./overlays/web.md");
  assert.match(lane, /Before UI implementation, read the ticket's UI reference section/);
  assert.match(lane, /open its linked screenshots and manifest/);
  assert.match(lane, /Planning screenshots in `references\/ui\/` are required inputs/);
  assert.match(lane, /prototype URL and relevant screen\/state in one of the existing Jira bullets/);
  assert.match(web, /Compare the implemented screen\/state against the ticket's reference screenshots/);
  assert.match(web, /Visual acceptance remains human-owned/);
  assert.match(web, /do not assert it in tests/);
});

test("revise edits the plan directly and asks for approval only when its shape changes", () => {
  assert.match(revise, /\$\{@:2\}/);
  assert.match(revise, /\*\*No description:\*\* compare the plan with the code/);
  assert.match(revise, /Default each finding to updating the appropriate planning file to match the code/);
  assert.match(revise, /\*\*done or merged\*\* tickets: never change/);
  assert.match(revise, /No Gherkin or change tables/);
  assert.match(revise, /Ask for approval only when the plan's shape changes/);
  assert.match(revise, /gate \$1 2 pending/);
  assert.match(revise, /work in flight continues/);
  assert.match(revise, /Do not write implementation code or run `dt\.mjs gate \.\.\. approve`/);
});

test("Pi runtime: revise expands the complete description after the selected slug", { skip: !process.env.PI_PACKAGE_DIR }, async () => {
  const { expandPromptTemplate } = await import(pathToFileURL(join(process.env.PI_PACKAGE_DIR, "dist/core/prompt-templates.js")));
  const content = revise.replace(/^---\n[\s\S]*?\n---\n/, "");
  const project = { slug: "demo", tier: "T2", type: "mixed" };
  for (const description of ["prioritize isolating v1 without changing rollout", '"keep $1 literal and preserve v1 behavior"']) {
    const command = resolveCommand(`/dt-revise ${description}`, project);
    const prompt = expandPromptTemplate(command, [{ name: "dt-revise", content }]);
    assert.ok(prompt.includes('feature "demo"'));
    assert.ok(prompt.includes(`Requested change: ${description.replace(/^"|"$/g, "")}`));
    assert.ok(!prompt.includes("${@:2}"));
  }
});

test("lanes write their own scenarios and may change interfaces nobody else uses yet", () => {
  assert.match(lane, /Write executable scenarios for the ticket's Outcome and Done when/);
  assert.doesNotMatch(lane, /Gherkin|frozen/);
  assert.match(lane, /Public interfaces may change when the code needs it/);
  assert.match(lane, /NEEDS INTERFACE CHANGE/);
  assert.match(lane, /suggest `\/dt-revise <change>`/);
  assert.match(lane, /T0\/T1 features are one ticket \(`00`\) built in the current checkout on a `quick\/<slug>` branch/);
  assert.match(lane, /sequence diagram of the skeleton path to the PR description/);
});

test("verification uses saved summaries and optional artifacts, not per-feature folders", () => {
  const web = read("./overlays/web.md"), cli = read("./overlays/cli.md");
  assert.match(lane, /Save verification results, useful links, gaps and follow-ups as one-liners in progress.json/);
  assert.match(lane, /Do not create a per-feature `evidence\/` folder or separate verification logs by default/);
  assert.match(lane, /Save separate artifacts only when genuinely useful/);
  assert.match(lane, /Preserve existing artifacts and their references/);
  assert.doesNotMatch(lane, /keep the evidence/);
  for (const overlay of [web, cli]) {
    assert.match(overlay, /dt\.mjs progress --verification/);
    assert.match(overlay, /[Dd]o not create an `evidence\/` folder/);
    assert.match(overlay, /link.*`--verification`/i);
  }
  assert.match(web, /capture and show a screenshot when useful for visual review/);
  assert.match(web, /check console\/network errors/);
  assert.match(readme, /There is no required per-feature `evidence\/` folder/);
});

test("necessary test and fixture maintenance does not require scope revision", () => {
  const conventions = read("./AGENTS.md");
  for (const doc of [lane, conventions]) {
    assert.match(doc, /Necessary tests, shared fixtures and test-only build wiring may be read and updated outside `touches`/);
    assert.match(doc, /Do not block or request `\/dt-revise` solely because these supporting files are outside `touches`/);
    assert.match(doc, /Do not weaken assertions, relax validation or change public contracts to make tests pass/);
    assert.match(doc, /Actual concurrent ownership conflicts still require coordination/);
    assert.match(doc, /Record the supporting paths and run their affected checks/);
  }
  assert.match(lane, /including the supporting test and fixture files allowed below/);
  assert.ok(review.includes("supporting work, not scope violations; do not require `/dt-revise` for them"));
});

test("help shows one table for every tier, the T2 loop and plan revision", () => {
  assert.ok(flow, "README must have a Flow section");
  const loop = flow.split("### T2 implementation loop")[1]?.split("### Changing the plan")[0];
  assert.ok(loop, "the loop must be inside the Flow section displayed by dt-help");
  for (const command of ["/dt-lane", "/dt-review <id>", "/dt-check-merged"]) assert.ok(loop.includes(command), `missing ${command}`);
  assert.match(loop, /closes every ticket whose PRs are all merged/);
  assert.match(loop, /Repeat for each ready ticket/i);
  const changes = flow.split("### Changing the plan")[1]?.split("### Ticket picker")[0];
  assert.match(changes, /`\/dt-revise <change>`/);
  assert.match(changes, /`\/dt-approve plan`\. New starts wait; work in flight continues/);
  assert.match(changes, /Done and merged tickets are never reopened/);
  assert.match(flow, /checks every saved PR of each open ticket live on GitHub/);
  const table = flow.split("### Commands")[1]?.split("###")[0];
  assert.ok(table, "README must list every command in one table");
  for (const command of ["/dt-start", "/dt-approve plan", "/dt-lane", "/dt-review", "/dt-check-merged", "/dt-revise", "/dt-status", "/dt-resume", "/dt-help"]) assert.ok(table.includes(`| \`${command}`), `missing ${command}`);
  assert.doesNotMatch(flow, /dt-show/);
  assert.doesNotMatch(flow, /\/dt-approve <id>|\/dt-approve ticket/);
});

test("review checks the ticket outcome and keeps findings in chat", () => {
  assert.ok(review.indexOf("Merged-ticket guard") < review.indexOf("git diff"));
  assert.match(review, /\/dt-check-merged/);
  assert.doesNotMatch(review, /\/dt-approve/);
  assert.match(review, /deliver the ticket's Outcome and Done when/);
  assert.doesNotMatch(review, /Changes table|Gherkin|quick/);
  assert.match(review, /Review the code and architecture and suggest concrete improvements/);
  assert.match(review, /roughly 200 words/);
  assert.match(review, /they do not determine the code-review verdict/);
  assert.match(review, /retain existing unresolved acceptance\/rollout prerequisites/);
  assert.match(review, /Do not invent findings to fill an axis/);
  assert.match(review, /No mandatory architecture diagram/);
  assert.match(review, /Do not emit an empty table or offer unnecessary fixes/);
  assert.match(review, /Keep all findings in chat/);
  assert.match(review, /Do not post a PR review, PR comment or ticket comment/);
  assert.match(review, /do not run `dt\.mjs comment`, `gh pr review`, `gh pr comment` or a remote commenting tool/);
  assert.match(review, /Would you like me to fix any of these\?/);
  assert.match(review, /Wait for the user's selection before editing/);
  assert.match(review, /Only if the user selects findings to fix or the arguments contain "autofix"/);
  assert.match(review, /[Bb]efore touching code, run `node .* next \$1 --ticket <id> --owner <session-owner>`/);
  assert.match(review, /if refused or directed to another checkout, STOP/);
  assert.match(review, /--release-claim/);
  assert.match(review, /re-review after fixes, but it is optional, never a required checkpoint/);
  assert.match(review, /Code fixes suggested; re-review optional/);
  assert.match(review, /do not require another `\/dt-review` invocation/);
  for (const doc of [readme, workflow]) assert.match(doc, /[Rr]e-review.*optional/);
});

test("implementation and review keep shipped work independent of dev-turbo context", () => {
  const conventions = read("./AGENTS.md");
  assert.match(conventions, /Code, comments, test names, commit messages and PR titles\/bodies must stand on their own/);
  assert.match(conventions, /Never reference the dev-turbo plan, spec, tickets, slices or gates/);
  assert.match(conventions, /Workflow references belong only in dev-turbo planning artifacts, saved progress and command\/gate handovers/);
  assert.match(conventions, /Reads stored v1 brand configurations/);
  assert.match(lane, /Code, comments, test names, commit messages and PR titles\/bodies must stand on their own/);
  assert.match(lane, /Never reference the dev-turbo plan, spec, tickets, slices or gates/);
  assert.match(lane, /Describe current behavior and technical reasons/);
  assert.match(start, /Plan files stand on their own: never mention the grill/);
  assert.match(review, /Flag references to the dev-turbo plan, spec, tickets, slices or gates in shipped code/);
  assert.match(review, /do not assume readers know the workflow/);
});
