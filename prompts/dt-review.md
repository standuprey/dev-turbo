---
description: Review code and architecture in chat; suggest fixes and offer to apply them
argument-hint: "[ticket id | branch] [autofix]"
---
Review the change for "$1" (target: ${2:-the current branch}).

**Merged-ticket guard:** for a ticket, check its saved PR states before starting the diff/three-axis review. If it is already recorded done, report that and stop; do not suggest a status command. If every saved PR is merged, do not review the landed diff again or run autofix; stop and hand over to `/dt-check-merged`, which confirms the merge on GitHub and closes the ticket. Merged implementation fixes require a separately scoped follow-up, not changes to the old PR.

Use a clean context: do not trust the author's explanations, read the code. Run `node ~/.pi/agent/dt/dt.mjs info` for the main branch and features dir. Resolve the branch: a ticket id means the branch saved in its progress; otherwise the given branch, or the current one. For a T0/T1 feature without a target, use ticket 00. `git fetch origin`, then review `git diff origin/<main>...origin/<branch>` (or the local branch) and read files at that ref with `git show <branch>:<path>`, so no checkout is needed. Read `<features dir>/$1/spec.md` (T2 only), the ticket, its saved state (`node ~/.pi/agent/dt/dt.mjs progress $1 --ticket <id>`: verification, todo, PRs) and the PR description.

## Purpose
Review the code and architecture and suggest concrete improvements. Spend effort reading and reasoning, not producing a report. Do not turn code review into a staging-acceptance checklist or a workflow audit.

Run the three axes one after another; label each actual finding by axis. Report defects and worthwhile improvements with a specific location, consequence and fix. Do not invent findings to fill an axis, demand tests for every defensive branch, or treat missing screenshots, staging access, remote CI/RBE, reviewer approval or other acceptance evidence as code defects. Preserve those prerequisites in saved progress; they do not determine the code-review verdict. Flag an unsafe rollout or broken behavior only when the code demonstrates the risk.

Run focused checks when they help resolve a code question. Do not rerun broad suites just to decorate the review with test counts.

For a spike (a ticket with an Investigation section), review the findings against its question, experiment, effort limit and Done when: evidence supports the recommendation, alternatives and trade-offs are clear, and remaining uncertainty is explicit. A negative or inconclusive result can satisfy the ticket; do not demand production implementation or feature scenarios. Review retained experiment code normally and flag throwaway prototypes shipped into production.

**Axis 1 - Standards**: repo coding standards, naming, error handling, test quality (do tests assert behavior at the boundary, or mirror the implementation?), obvious smells. Flag references to the dev-turbo plan, spec, tickets, slices or gates in shipped code, comments, test names, documentation, commit messages or PR titles/bodies; do not assume readers know the workflow. Suggest wording about current behavior and technical reasons instead, while preserving required issue links and concrete PR sequencing.
**Axis 2 - Ticket adherence**: does the diff deliver the ticket's Outcome and Done when, within its Scope and Out of scope? Missing behavior, extra behavior, scenarios passing for the wrong reason, interface changes or deviations not mentioned in the PR description. Necessary test, shared-fixture and test-only build updates outside `touches` are supporting work, not scope violations; do not require `/dt-revise` for them. Preserve assertions, validation, public contracts and concurrent lane ownership.
**Axis 3 - Architecture** (the one I care most about), against the spec's module map, the ticket's Scope and `touches`, and the interfaces already merged:
- Responsibility: did any module take on a second job?
- Depth: did an interface grow wider, or leak internals?
- Dependencies: new edge, wrong direction, cycle, reach into another module's internals?
- Interfaces: any change other tickets or merged code depend on? Any caller relying on undocumented behavior?
- Testability: could this module be tested at its boundary without the rest of the system?
- Scale: does the change meet the brief's targets? Anything unbounded (query without limit, in-memory accumulation, N+1, retry without backoff, missing timeout)?

## Output
Keep the review in roughly 200 words unless the findings genuinely need more. Put the important issues first; no preamble, axis-by-axis clean bills of health, spec recap, command dumps, log paths or verification narrative.
- If there are findings, use one compact table: Axis | Severity (blocker / should / nit) | File:line | Finding | Suggested fix. One short row per distinct issue; do not pad it with low-value nits.
- End with the code-review verdict: merge / merge after fixes / rework, and one concrete thing worth looking at yourself, if any.
- No findings: say "No actionable code or architecture findings. Code-review verdict: merge." Do not emit an empty table or offer unnecessary fixes.
- No mandatory architecture diagram. Add a small diagram of only the relevant modules when it explains an actual finding better than a sentence. Never reproduce the full building-block diagram; a broader code-alignment audit needs an explicit request, while optional `/dt-revise` checks spec/ticket coverage.

Keep all findings in chat. Do not post a PR review, PR comment or ticket comment; do not run `dt.mjs comment`, `gh pr review`, `gh pr comment` or a remote commenting tool as part of this command.

When there are findings, offer to fix any user-selected items: "Would you like me to fix any of these? Tell me which ones, or choose all safe fixes." Wait for the user's selection before editing. `/dt-review <id or branch> autofix` is an optional shortcut for all clearly correct, local fixes that do not change contracts. You may suggest re-review after fixes, but it is optional, never a required checkpoint or a prerequisite for merge or ticket closure.

## Handover
Save the outcome so a new session can pick it up. Progress updates replace lists: retain existing unresolved acceptance/rollout prerequisites alongside actionable code findings, but do not copy them into the chat review or let them change its verdict. Save the combined remaining todo (use `--no-todo` only when nothing remains): `node ~/.pi/agent/dt/dt.mjs progress $1 --ticket <id> --owner <session-owner> --todo "<remaining prerequisite or actionable blocker/should finding, one line>"` (or `--no-todo`) `--next "<suggested next dt-command: /dt-lane <id> for fixes, or /dt-check-merged after merge>"`. For a verdict requiring fixes, record `node ~/.pi/agent/dt/dt.mjs gate $1 3 change --ticket <id> --note "Code fixes suggested; re-review optional"`, then save the suggested fix command through progress. Do not save a mandatory re-review step or create a fresh-review gate. When the verdict is merge, record `node ~/.pi/agent/dt/dt.mjs gate $1 3 pending --ticket <id> --note "<verdict in one line>"` and end with `/dt-check-merged`: the user merges all saved PRs first, then that command checks every saved PR live on GitHub and records completion, not staging acceptance; never run gate approve from chat. With unresolved findings, end with the offer to fix selected items, not an approval request or a required re-review command.

After applying fixes, update the todo and verdict from the changed code and focused checks; do not require another `/dt-review` invocation before the merge handover.

Planning files may be maintained during the review: update clear wording/path mismatches in the spec and editable tickets directly, without requiring another command. Preserve settled behavior and completed tickets, and coordinate another active ticket’s scope changes. This does not authorize code fixes without the user’s selection.

## Applying fixes
Only if the user selects findings to fix or the arguments contain "autofix": apply the authorized fixes on the reviewed branch and list what changed. Otherwise change no code. Before touching code, run `node ~/.pi/agent/dt/dt.mjs next $1 --ticket <id> --owner <session-owner>` to claim the ticket in its saved checkout; if refused or directed to another checkout, STOP. Never force a claim from review. Save progress with the same owner and add `--release-claim` to the final update when handing work back. Interface changes that other tickets depend on require a user decision and coordination, not automatic fixes; once settled, update editable planning files directly without requiring `/dt-revise`. Clear planning wording/path corrections may also be saved directly, preserving completed tickets and agreed behavior.
