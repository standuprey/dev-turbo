---
description: Optionally edit the plan, or audit spec/ticket coverage in both directions without arguments
argument-hint: "[description of the change]"
---
Revise the plan of feature "$1". Requested change: ${@:2}

Run `node ~/.pi/agent/dt/dt.mjs info` (main branch, features dir) and read `<features dir>/$1/spec.md` (T2 only) and saved state (`node ~/.pi/agent/dt/dt.mjs progress $1`). Use ticket frontmatter to identify affected tickets and dependencies, then read only the ticket bodies needed for the change or comparison. Actual ticket IDs and statuses are authoritative.

## Mode

**No tickets yet** (a project planned before tickets were written with the brief): write them from the current `spec.md` using `/dt-start`'s ticket format. Keep the shared module map in `spec.md`, using `/dt-start`'s Module map requirements. Move existing slices, ticket/lane ownership, ticket dependencies, implementation details and landing order into the appropriate tickets; skeleton interface/fake work belongs in ticket 00. Keep every settled decision in the appropriate file, leaving what and why plus the module map in the spec. Keep the feature's existing plan approval unchanged, save the next step through progress and stop; an unapproved new plan still follows `/dt-start` and `/dt-approve plan`.

- **A change is described:** a deliberate change to the plan. Briefly state what the plan says now and which tickets it touches. Ask only the questions you need (usually 1-3, each with a recommendation worded so "yes" accepts it), then edit.
- **No description:** audit coverage between the spec and tickets in both directions. Map each spec goal, constraint and acceptance criterion to tickets or an explicit exclusion/follow-up. Map each ticket outcome back to the spec; implementation choices need not be repeated in the spec. Check uncovered requirements, work outside the agreed scope, contradictions, missing module-map definitions and dependency gaps using authoritative ticket IDs/statuses and only the relevant bodies. Use the code only when needed to resolve a factual ambiguity; a full landed-code audit is not the default. If the user explicitly requests code alignment, inspect `origin/<main>` as needed. Do not silently weaken the spec to match code or invent behavior to fill a coverage gap. Report meaningful findings; fix clear wording/path/reference mismatches directly, and ask only when a real scope or design decision is unresolved. Zero findings: say so and stop.

## UI references

Apply `/dt-start`'s UI reference requirements when adding or updating UI tickets, including mixed UI/backend work, or when asked to backfill references in an existing plan. Read its UI references and ticket-format sections: inspect the supplied prototype with browser tools, settle its authority and differences, save relevant screenshots and `references/ui/manifest.md`, and add UI reference sections with embedded relative screenshot links. Reuse existing captures when they still represent the settled scope; verify linked files exist. Do not silently waive missing references: ask for user-provided screenshots or an explicit waiver if capture is blocked.

Adding references to an in-flight ticket may only clarify settled scope; if they require different work, follow the scope-change and decision rules below. Never edit done or merged tickets; extra work belongs in a new ticket. Preserve existing captures and references, and do not treat a newly observed prototype behavior as approved scope. Adding references alone does not change the plan's shape or require another decision.

## Edit directly

This command is optional, not permission to edit planning files. Agents may maintain the spec and editable tickets during normal implementation or review without invoking `/dt-revise`. Preserve settled behavior, module-map definitions, ticket protections and existing approval; ask about unresolved decisions instead of inventing scope.

The spec answers **what and why** and keeps the shared module map; tickets answer **how**. Keep the shared module map in `spec.md`. Update the spec when intended behavior, goals, constraints or acceptance criteria change, or when module names, paths, responsibilities or module dependencies change. Implementation-only revisions that do not affect the module map leave it untouched. Do not add slices, ticket lists or IDs, ticket/lane ownership, ticket dependency tables, implementation steps or landing order to the spec. Edit the affected tickets without rewriting unrelated ones; do not add changelogs or "revised" notes. Keep the spec short.

Backfill a missing or incomplete module map from known code paths, imports/build files and settled module definitions without editing done or merged tickets. Apply `/dt-start`'s map format and resolve every ticket `touches` key explicitly, including aliases and artifact resources. Do not guess missing definitions or change agreed behavior/public interfaces while documenting them.

If an existing spec mixes requirements and delivery details, retain its compact module map and move only the delivery material into the appropriate editable tickets without losing settled decisions. Never edit done or merged tickets to relocate it. If there is no editable destination, ask where to preserve the material before removing it; do not create an implementation ticket just to store historical notes.

Tickets:
- **todo** tickets: edit scope, outcome, `blocked_by`, `touches` or `unsafe_with` freely.
- **in progress / review** tickets: only clarify wording. If its scope must change, say so and record `node ~/.pi/agent/dt/dt.mjs gate $1 3 change --ticket <id> --note "Scope changed: <one line>"` so its lane picks it up.
- **done or merged** tickets: never change. Extra work becomes a new ticket.
- New tickets take the next free ID and follow the format in `/dt-start` (Outcome, Scope, Example, Out of scope, Done when; frontmatter with `blocked_by`, `touches`, `verify`, `unsafe_with`). New and clarified tickets follow its concrete-language rules: plain action titles, known code names and a short code or pseudocode behavior example, not invented contracts or unnecessary code-level instructions. For tickets that include UI, including mixed UI/backend work, describe the page or route, visible UI elements, user actions and their visible results in Outcome, Scope, Example and Done when, as in `/dt-start`; use only known or settled routes, labels and behavior. Adding an example to an in-flight ticket must only clarify its existing behavior, not add requirements. No Gherkin or change tables.
- When a solution requires investigation, apply `/dt-start`'s Investigation tickets rules: add a bounded spike rather than guessing implementation, and block dependent implementation tickets on it. After its findings are reviewed, update only affected editable tickets with the settled approach; update the spec only if intended behavior/constraints or the shared module map change. Preserve in-flight and completed ticket protections, settle any unresolved dependency/scope decisions in chat and retain required lane handovers.
- T0/T1 stay one ticket. If the change needs more, ask the user whether to start a new T2 project; never change the tier yourself.

## Confirm decisions in chat

Do not ask for a separate `/dt-approve plan` after revising an approved feature, including changes to building blocks, scope or ticket dependencies. Ask only when a decision is genuinely unsettled; a clear requested change does not need another confirmation. Explain material consequences and wait for the user's answer before applying an ambiguous choice. A decision answered in chat is enough to edit the affected planning files; it is not a new initial-plan approval or ticket closure.

Do not record a new G2 pending gate or call `dt_propose_plan` for an already approved feature. Keep its original plan approval intact; work in flight continues, with scope-change handovers and lane claims still enforced. Do not silently clear an existing pending gate or bypass approval of an unapproved new plan; legacy pending gates retain their existing confirmation path.

Once the decisions are settled and edits are saved, save `node ~/.pi/agent/dt/dt.mjs progress $1 --next "/dt-lane $1"` when tickets remain, and end with the next command. If an answer is still needed, end with that question instead.

## Reply

At most 8 lines: what changed in the brief, which tickets changed or were added (id, title, one-line reason), any remaining decision or blocker, and the next command. Remind me to commit and push changed ticket files to the main branch before starting them. Do not write implementation code or run `dt.mjs gate ... approve`.
