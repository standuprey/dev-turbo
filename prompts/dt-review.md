---
description: Review code and architecture in chat; suggest fixes and offer to apply them
argument-hint: "[ticket id | branch] [autofix]"
---
Review the change for "$1" (target: ${2:-the current branch}).

**Merged-ticket guard:** for a ticket, check its saved state first. Already done: say so and stop. Every saved PR merged: do not review or fix; hand over to `/dt-check-merged`.

Read the code, not the author's explanations. Run `node ~/.pi/agent/dt/dt.mjs info`. Branch: a ticket ID means its saved branch (a single-ticket feature without a target: ticket 00); otherwise the given or current branch. `git fetch origin`, review `git diff origin/<main>...origin/<branch>` and read files with `git show <branch>:<path>`. Read `spec.md` (T2), the ticket, its saved state (`node ~/.pi/agent/dt/dt.mjs progress $1 --ticket <id>`) and the PR description.

## Purpose
Any ticket line limit counts net growth: `added lines - removed lines`, summed across all files in the full ticket diff against the merge base with its PR base branch. Never use `added lines + removed lines`, an absolute value or per-commit churn; replacements cancel and negative counts stay negative.

Review the code and architecture and suggest concrete improvements, each with location, consequence and fix. Do not invent findings to fill an axis. Missing screenshots, staging access, CI or approvals are not code defects; they do not determine the code-review verdict. Run focused checks only to settle a code question. Ask for tests only where changed behavior, a fixed bug or a concrete high-risk failure lacks protection: an essential regression suite, not 100% test coverage or a coverage percentage target. Preserve existing assertions and required repository checks.

For a spike (ticket with an Investigation section), review the findings against its question, experiment, effort limit and Done when. A negative or inconclusive result can pass; do not demand production implementation or feature scenarios. Flag throwaway prototypes shipped to production.

**Axis 1 - Standards**: repo conventions, naming, error handling, tests asserting behavior at the boundary rather than mirroring the implementation. Flag references to the dev-turbo plan, spec, tickets, slices or gates in shipped code, comments, test names, docs, commits or PR text; do not assume readers know the workflow.
**Axis 2 - Ticket adherence**: does the diff deliver the ticket's Outcome and Done when, within Scope and Out of scope? Missing or extra behavior, scenarios passing for the wrong reason, unmentioned interface changes. Test, fixture and test-only build updates outside `touches` are supporting work, not scope violations; do not require `/dt-revise` for them.
**Axis 3 - Architecture** (most important), against the spec's module map, the ticket's Scope and `touches`, and merged interfaces:
- Responsibility: did a module take on a second job?
- Depth: did an interface widen or leak internals?
- Dependencies: new edge, wrong direction, cycle, reach into internals?
- Interfaces: changes others depend on, or callers relying on undocumented behavior?
- Testability: testable at its boundary?
- Scale: meets the brief's targets? Anything unbounded (no limit, in-memory accumulation, N+1, retry without backoff, missing timeout)?

## Output
Keep it to roughly 200 words, important issues first; no preamble, recaps or command dumps.
- Findings: one table `Axis | Severity (blocker / should / nit) | File:line | Finding | Suggested fix`, one row per distinct issue.
- End with the code-review verdict (merge / merge after fixes / rework) and one thing worth looking at yourself, if any.
- No findings: "No actionable code or architecture findings. Code-review verdict: merge." Do not emit an empty table or offer unnecessary fixes.
- No mandatory architecture diagram; add a small one only when it explains a finding.

Keep all findings in chat. Do not post a PR review, PR comment or ticket comment; do not run `dt.mjs comment`, `gh pr review`, `gh pr comment` or a remote commenting tool.

With findings, ask: "Would you like me to fix any of these? Tell me which ones, or choose all safe fixes." Wait for the user's selection before editing. You may suggest re-review after fixes, but it is optional, never a required checkpoint.

## Handover
Save `node ~/.pi/agent/dt/dt.mjs progress $1 --ticket <id> --owner <session-owner> --todo "<one line>" --next "<next dt-command>"` (or `--no-todo`). Lists are replaced: retain existing unresolved acceptance/rollout prerequisites alongside blocker/should findings.
- Fixes needed: `node ~/.pi/agent/dt/dt.mjs gate $1 3 change --ticket <id> --note "Code fixes suggested; re-review optional"`, next `/dt-lane <id>`.
- Merge: `node ~/.pi/agent/dt/dt.mjs gate $1 3 pending --ticket <id> --note "<verdict>"`, then end with `/dt-check-merged` once the user has merged every saved PR.

After applying fixes, update the todo and verdict; do not require another `/dt-review` invocation. You may update editable planning files directly for clear wording or path mismatches.

## Applying fixes
Only if the user selects findings to fix or the arguments contain "autofix" (all clearly correct, local fixes that keep contracts). Before touching code, run `node ~/.pi/agent/dt/dt.mjs next $1 --ticket <id> --owner <session-owner>`; if refused or directed to another checkout, STOP. Never force. Add `--release-claim` to the final progress save. Interface changes other tickets depend on need a user decision.
