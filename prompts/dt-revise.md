---
description: Optionally edit the plan, or audit spec/ticket coverage in both directions without arguments
argument-hint: "[description of the change]"
---
Revise the plan of feature "$1". Requested change: ${@:2}

Run `node ~/.pi/agent/dt/dt.mjs info`, then read `<features dir>/$1/spec.md` (T2) and `node ~/.pi/agent/dt/dt.mjs progress $1`. Use ticket frontmatter to find affected tickets and read only the ticket bodies needed. Saved ticket IDs and statuses are authoritative. Ticket format, UI reference and spike rules are in `~/.pi/agent/prompts/dt-start.md`.

## Mode
- **No tickets yet:** write them from `spec.md` in `/dt-start`'s format. Keep the module map in the spec and move delivery details (slices, ownership, dependencies, landing order) into tickets. Keep the existing approval.
- **A change is described:** say what the plan says now and which tickets it touches, ask only the questions you need (each with a recommendation), then edit.
- **No description:** audit coverage between the spec and tickets in both directions. Map each spec goal, constraint and acceptance criterion to tickets or an explicit exclusion. Map each ticket outcome back to the spec. Check contradictions, missing module-map entries and dependency gaps. Use the code only when needed to resolve a factual ambiguity or when I ask for code alignment. Do not silently weaken the spec to match code or invent behavior. Fix clear wording/path mismatches directly; ask only about real decisions. No findings: say so and stop.

## Editing
- Any ticket line limit counts net growth: `added lines - removed lines`, summed across all files in the full ticket diff against the merge base with its PR base branch. Never use `added lines + removed lines`, an absolute value or per-commit churn; replacements cancel and negative counts stay negative.
- The spec says what and why; tickets say how. Keep the shared module map in `spec.md`. Update the spec only when behavior, goals, constraints or acceptance criteria change, or when module names, paths, responsibilities or module dependencies change. Implementation-only revisions that do not affect the module map leave it untouched. Never add ticket lists, ownership, dependencies or landing order to the spec.
- Backfill a missing or incomplete module map from code paths and settled definitions without editing done or merged tickets.
- Edit the affected tickets without rewriting unrelated ones; no changelog notes.
- **todo** tickets: edit freely. **in progress / review** tickets: clarify wording only; if scope must change, record `node ~/.pi/agent/dt/dt.mjs gate $1 3 change --ticket <id> --note "Scope changed: <one line>"`. **done or merged** tickets: never change; extra work becomes a new ticket with the next free ID.
- New tickets use `/dt-start`'s format (Outcome, Scope, Example, Out of scope, Done when). New and clarified tickets follow its concrete-language rules. UI tickets, including mixed UI/backend work, describe the page or route, visible UI elements, user actions and their visible results, using only routes and labels known from the code or agreed with the user. No Gherkin or change tables.
- Apply `/dt-start`'s UI reference requirements to new or updated UI tickets and backfills; reuse existing captures. Do not silently waive missing references.
- An example or reference added to an in-flight ticket must only clarify its existing behavior, not add requirements.
- Unsettled approach: add a bounded spike rather than guessing implementation, and block dependents on it. Preserve in-flight and completed ticket protections.
- T0 stays one ticket and T1 at most 5 tickets without a spec; for more, ask whether to start a T1 or T2 project and never change the tier yourself.

## Confirm decisions in chat
Ask only about genuinely unsettled decisions; a clear requested change does not need another confirmation. Do not ask for a separate `/dt-approve plan` after revising an approved feature. Do not record a new G2 pending gate or call `dt_propose_plan`; work in flight continues. Do not silently clear an existing pending gate.

## Reply
When tickets remain, save `node ~/.pi/agent/dt/dt.mjs progress $1 --next "/dt-lane $1"`. At most 8 lines: what changed in the spec, changed or added tickets (id, title, reason), open decisions and the next command. Remind me to commit and push changed ticket files to the main branch. Do not write implementation code or run `dt.mjs gate ... approve`.
