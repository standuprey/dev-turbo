---
description: Review code and architecture in chat; suggest fixes and offer to apply them
argument-hint: "[ticket id | branch] [autofix]"
---
Review the change for "$1" (target: ${2:-the current branch}).

**Merged-ticket guard:** for a T2 ticket, check its saved PR states before starting the diff/three-axis review. If it is already recorded done, report that and stop; do not suggest a status command. If every saved PR is merged, do not review the landed diff again or run autofix; stop and hand over to `/dt-approve <id>` to check live merge states and close the ticket internally. Merged implementation fixes require a separately scoped follow-up, not changes to the old PR.

Use a clean context: do not trust the author's explanations, read the code. Run `node ~/.pi/agent/dt/dt.mjs info` for the main branch and features dir. Resolve the branch: a ticket id means `ticket/$1-<id>`; otherwise the given branch, or the current one. `git fetch origin`, then review `git diff origin/<main>...origin/<branch>` (or the local branch) and read files at that ref with `git show <branch>:<path>`, so no checkout is needed. For a feature, read `<features dir>/$1/spec.md`, the ticket, its saved state (`node ~/.pi/agent/dt/dt.mjs progress $1 --ticket <id>`: verification, todo, PRs) and the PR description. For `quick`, the reference is the Scope facts from the conversation and the repo's existing module structure.

## Purpose
Review the code and architecture and suggest concrete improvements. Spend effort reading and reasoning, not producing a report. Do not turn code review into a staging-acceptance checklist or a workflow audit.

Run the three axes one after another; label each actual finding by axis. Report defects and worthwhile improvements with a specific location, consequence and fix. Do not invent findings to fill an axis, demand tests for every defensive branch, or treat missing screenshots, staging access, remote CI/RBE, reviewer approval or other acceptance evidence as code defects. Preserve those prerequisites in saved progress; they do not determine the code-review verdict. Flag an unsafe rollout or broken behavior only when the code demonstrates the risk.

Run focused checks when they help resolve a code question. Do not rerun broad suites just to decorate the review with test counts.

**Axis 1 - Standards**: repo coding standards, naming, error handling, test quality (do tests assert behavior at the boundary, or mirror the implementation?), obvious smells. Flag references to the dev-turbo plan, spec, tickets, slices or gates in shipped code, comments, test names, documentation, commit messages or PR titles/bodies; do not assume readers know the workflow. Suggest wording about current behavior and technical reasons instead, while preserving required issue links and concrete PR sequencing.
**Axis 2 - Spec adherence**: does the diff do what the ticket's Changes table and Gherkin say, no more and no less? Missing change rows or one-to-one scenarios, extra behavior, scenarios passing for the wrong reason, deviations not mentioned in the PR description.
**Axis 3 - Architecture** (the one I care most about), against the module map and contracts:
- Responsibility: did any module take on a second job?
- Depth: did an interface grow wider, or leak internals?
- Dependencies: new edge, wrong direction, cycle, reach into another module's internals?
- Contract: any change not approved? Any caller relying on undocumented behavior?
- Testability: could this module be tested at its boundary without the rest of the system?
- Scale: does the change meet the spec's targets? Anything unbounded (query without limit, in-memory accumulation, N+1, retry without backoff, missing timeout)?

## Output
Keep the review in roughly 200 words unless the findings genuinely need more. Put the important issues first; no preamble, axis-by-axis clean bills of health, spec recap, command dumps, log paths or verification narrative.
- If there are findings, use one compact table: Axis | Severity (blocker / should / nit) | File:line | Finding | Suggested fix. One short row per distinct issue; do not pad it with low-value nits.
- End with the code-review verdict: merge / merge after fixes / rework, and one concrete thing worth looking at yourself, if any.
- No findings: say "No actionable code or architecture findings. Code-review verdict: merge." Do not emit an empty table or offer unnecessary fixes.
- No mandatory architecture diagram. Add a small diagram of only the relevant modules when it explains an actual finding better than a sentence. Never reproduce the full spec diagram; full architecture drift belongs to `/dt-drift`.

Keep all findings in chat. Do not post a PR review, PR comment or ticket comment; do not run `dt.mjs comment`, `gh pr review`, `gh pr comment` or a remote commenting tool as part of this command.

When there are findings, offer to fix any user-selected items: "Would you like me to fix any of these? Tell me which ones, or choose all safe fixes." Wait for the user's selection before editing. `/dt-review <id or branch> autofix` is an optional shortcut for all clearly correct, local fixes that do not change contracts. You may suggest re-review after fixes, but it is optional, never a required checkpoint or a prerequisite for merge or ticket closure.

## Handover
For a feature ticket, save the outcome so a new session can pick it up. Progress updates replace lists: retain existing unresolved acceptance/rollout prerequisites alongside actionable code findings, but do not copy them into the chat review or let them change its verdict. Save the combined remaining todo (use `--no-todo` only when nothing remains): `node ~/.pi/agent/dt/dt.mjs progress $1 --ticket <id> --owner <session-owner> --todo "<remaining prerequisite or actionable blocker/should finding, one line>"` (or `--no-todo`) `--next "<suggested next dt-command: /dt-lane <id> for fixes, or /dt-approve <id> after merge>"`. For a verdict requiring fixes, record `node ~/.pi/agent/dt/dt.mjs gate $1 3 change --ticket <id> --note "Code fixes suggested; re-review optional"`, then save the suggested fix command through progress. Do not save a mandatory re-review step or create a fresh-review gate. When the verdict is merge, record `node ~/.pi/agent/dt/dt.mjs gate $1 3 pending --ticket <id> --note "<verdict in one line>"` and end with `/dt-approve <id>`: the user merges all saved PRs first. Closure checks every saved PR live on GitHub and records completion, not staging acceptance; never run gate approve from chat. With unresolved findings, end with the offer to fix selected items, not an approval request or a required re-review command.

For a quick task with a merge verdict, call `dt_propose_quick_gate` with gate `ticket`, the reviewed branch and a short verification note, then end with `/dt-approve ticket`. With unresolved findings, offer selected fixes instead. After applying fixes, update the todo and verdict from the changed code and focused checks; do not require another `/dt-review` invocation before the merge handover or quick ticket proposal.

## Applying fixes
Only if the user selects findings to fix or the arguments contain "autofix": apply the authorized fixes on the reviewed branch and list what changed. Otherwise change no code. For a feature ticket, before touching code, run `node ~/.pi/agent/dt/dt.mjs next $1 --ticket <id> --owner <session-owner>` to claim the ticket in its saved checkout; if refused or directed to another checkout, STOP. Never force a claim from review. Save progress with the same owner and add `--release-claim` to the final update when handing work back. Contract changes need separate alignment, not autofix.
