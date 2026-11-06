---
description: Fresh-context review on three axes (standards, spec adherence, architecture) with an architecture delta diagram; posts to the PR
argument-hint: "[ticket id | branch] [autofix]"
---
Review the change for "$1" (target: ${2:-the current branch}).

**Merged-ticket guard:** for a T2 ticket, check its saved PR states before starting the diff/three-axis review. If it is already recorded done, stop with `/dt-status`. If every saved PR is merged, do not review the landed diff again or run autofix; stop and hand over to `/dt-approve <id>` to check live merge states and close the ticket internally. Merged implementation fixes require a separately scoped follow-up, not changes to the old PR.

Use a clean context: do not trust the author's explanations, read the code. Run `node ~/.pi/agent/dt/dt.mjs info` for the main branch and features dir. Resolve the branch: a ticket id means `ticket/$1-<id>`; otherwise the given branch, or the current one. `git fetch origin`, then review `git diff origin/<main>...origin/<branch>` (or the local branch) and read files at that ref with `git show <branch>:<path>`, so no checkout is needed. For a feature, read `<features dir>/$1/spec.md`, the ticket, its saved state (`node ~/.pi/agent/dt/dt.mjs progress $1 --ticket <id>`: verification, todo, PRs) and the PR description. For `quick`, the reference is the Scope facts from the conversation and the repo's existing module structure.

Run the three axes one after another and keep their findings separate.

**Axis 1 - Standards**: repo coding standards, naming, error handling, test quality (do tests assert behavior at the boundary, or mirror the implementation?), obvious smells.
**Axis 2 - Spec adherence**: does the diff do what the ticket and Gherkin say, no more and no less? Missing scenarios, extra behavior, scenarios passing for the wrong reason, deviations not mentioned in the PR description.
**Axis 3 - Architecture** (the one I care most about), against the module map and contracts:
- Responsibility: did any module take on a second job?
- Depth: did an interface grow wider, or leak internals?
- Dependencies: new edge, wrong direction, cycle, reach into another module's internals?
- Contract: any change not approved? Any caller relying on undocumented behavior?
- Testability: could this module be tested at its boundary without the rest of the system?
- Scale: does the change meet the spec's targets? Anything unbounded (query without limit, in-memory accumulation, N+1, retry without backoff, missing timeout)?

## Output
1. One table: Axis | Severity (blocker / should / nit) | File:line | Finding | Suggested fix.
2. **Architecture delta**: the spec's module diagram as Mermaid (`flowchart LR`, one node per module, `A --> B` = A depends on B's public API), with the modules and edges touched by this diff in bold (`stroke-width:3px`), edges present in the code but absent from the spec in red (`stroke:#dc2626`), and a one-line legend.
3. A 3-line verdict: merge / merge after fixes / rework, and the single most important thing to look at myself.

Write 1-3 to a temp file and run `node ~/.pi/agent/dt/dt.mjs comment --branch <branch> --body-file <file>` to post them on the PR (it says so when there is no PR; the findings then stay in chat).

For a feature ticket, then save the outcome so a new session can pick it up (it replaces the previous state): `node ~/.pi/agent/dt/dt.mjs progress $1 --ticket <id> --todo "<each blocker and should finding, one line>"` (or `--no-todo`) `--next "<exact dt-command: /dt-lane <id>, /dt-review <id> autofix, or /dt-approve <id>>"`. For a verdict requiring fixes, first record `node ~/.pi/agent/dt/dt.mjs gate $1 3 change --ticket <id> --note "Fresh review required after fixes"`, then save the exact fix command through progress so the next session knows fixes are needed; closure still requires every PR to be merged. When the verdict is merge, also record `node ~/.pi/agent/dt/dt.mjs gate $1 3 pending --ticket <id> --note "<verdict in one line>"`. End with the exact command `/dt-approve <id>` and its prerequisites: the user merges all PRs first. The command checks every saved PR live on GitHub and records completion, not staging acceptance; never run gate approve from chat. For a quick task with a merge verdict, call `dt_propose_quick_gate` with gate `ticket`, the reviewed branch and a short verification note, then end with `/dt-approve ticket`. If fixes are needed, end with `/dt-lane <id>` or `/dt-review <id> autofix`, not a request for a chat approval.

Only if the arguments contain "autofix": apply fixes that are clearly correct, local and not contract changes, on the reviewed branch, and list what you changed. Otherwise change nothing.
