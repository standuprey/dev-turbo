---
description: T2 - final checks after merge, before your sign-off; no repeat code review or implementation
argument-hint: "<ticket id>"
---
Run the final checks for feature "$1", ticket "$2" before human sign-off. This is a post-merge acceptance checkpoint, not code review, implementation or approval.

## Preconditions

1. Run `node ~/.pi/agent/dt/dt.mjs info` and read the ticket plus its saved state with `node ~/.pi/agent/dt/dt.mjs progress $1 --ticket $2`. Resolve the two-digit ticket ID. Read only the spec sections and verification overlay the ticket needs.
2. Read `node ~/.pi/agent/dt/dt.mjs status $1 --no-gh`. If Architecture/Slices are not approved, approved spec amendments still need alignment, or drift is pending/due, stop and report that workflow command first. Do not bypass gates.
3. Require at least one saved PR and every ticket PR saved as merged. Saved observations are not a remote refresh. If unknown/stale, ask for `/dt-resume` to refresh; if any PR is unmerged, stop and use `/dt-review <id>` for its remaining code review or ask the user to merge it. Never merge a PR yourself.
4. If already recorded done, report that fact and stop with `/dt-status`. Do not reopen acceptance.

## Acceptance only

- Say clearly: **PRs merged; checking acceptance only. No repeat code review or rebuild.** Preserve the completed review and existing verification evidence.
- Compare the ticket's Verification and Done when with saved evidence, unresolved todo and blockers. Show a compact checklist: acceptance check | existing evidence | gap. Reuse valid evidence; do not rerun completed checks merely because a scope clarification changed prose.
- Run only missing, safe acceptance checks against the merged/deployed version. Record exact versions, results and artifact paths. Browser/device checks follow the ticket overlay. Human-only UX, hardware or production checks require the human; never invent access or results, execute production steps implicitly, or treat a merge as proof that staging passed.
- Do not diff/review the merged PR again, check out its old branch, create a work branch, call `dt.mjs next`, change code, or open another implementation PR.
- If acceptance exposes a bug or substantive extra scope, record it and propose a separate follow-up ticket/re-slicing. Do not reopen or edit merged implementation silently; any new work needs its own scope/review.

## Save and stop

Use only dt.mjs to update progress.json; never edit it by hand. Progress updates replace values: preserve relevant prior evidence, unresolved todo and blockers rather than clearing them wholesale. Do not reset ticket status, PRs or accepted work.

- **Missing/failed checks or human input:** record `node ~/.pi/agent/dt/dt.mjs gate $1 3 change --ticket <id> --note "Acceptance evidence incomplete: <short gap>"`, then save the outstanding `--todo`, `--blocker` and `--verification` evidence with `node ~/.pi/agent/dt/dt.mjs progress $1 --ticket <id> ... --next "/dt-final-check <id>"`. Explain the exact missing action; no pending approval card until acceptance is verified. If a follow-up needs slicing, save that handover instead. Stop without implementation.
- **All acceptance checks verified and blockers resolved:** save the combined evidence and clear only resolved todo/blockers through `dt.mjs progress`. Then record `node ~/.pi/agent/dt/dt.mjs gate $1 3 pending --ticket <id> --note "Merged ticket acceptance verified: <short evidence>"`. Present the compact checklist with the verification results and any substantive changes since code review.

Only the user's `/dt-approve ticket <id>` records completion. Never run gate approve, mark the ticket done, or approve from discussion. End a pending acceptance card with exactly `/dt-approve ticket <id>`. A failed/incomplete checkpoint ends with its concrete prerequisite and `/dt-final-check <id>` (or the required slice/follow-up command), not an approval request.
