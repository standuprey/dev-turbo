---
description: Change the plan (with a description) or check it against the landed code (without one); edits the brief and tickets directly
argument-hint: "[description of the change]"
---
Revise the plan of feature "$1". Requested change: ${@:2}

Run `node ~/.pi/agent/dt/dt.mjs info` (main branch, features dir) and read `<features dir>/$1/spec.md` (T2 only) and saved state (`node ~/.pi/agent/dt/dt.mjs progress $1`). Use ticket frontmatter to identify affected tickets and dependencies, then read only the ticket bodies needed for the change or comparison. Actual ticket IDs and statuses are authoritative.

## Mode

**No tickets yet** (a project planned before tickets were written with the brief): write them from the current `spec.md` using `/dt-start`'s ticket format. Move existing slices, module ownership, architecture and landing order out of the spec into the appropriate tickets; shared building blocks belong in ticket 00. Keep every settled decision in the appropriate file, leaving only what and why in the spec. Then record the plan as pending (below) and stop.

- **A change is described:** a deliberate change to the plan. Briefly state what the plan says now and which tickets it touches. Ask only the questions you need (usually 1-3, each with a recommendation worded so "yes" accepts it), then edit.
- **No description:** compare the plan with the code. `git fetch origin`, then check behavior against the spec and derive the real modules and dependencies on `origin/<main>` from imports and build files to compare with the affected tickets. List differences that matter in a few lines: behavior or constraints the code went against, implementation that differs from tickets, scope that landed in a different ticket. Default each finding to updating the appropriate planning file to match the code, subject to the ticket status rules below; never put implementation details in the spec or silently change agreed behavior. Propose a code change only when the code is clearly worse, and make it a new ticket. Ask me to confirm the list once, then edit. Zero findings: say so and stop.

## UI references

Apply `/dt-start`'s UI reference requirements when adding or updating UI tickets, including mixed UI/backend work, or when asked to backfill references in an existing plan. Read its UI references and ticket-format sections: inspect the supplied prototype with browser tools, settle its authority and differences, save relevant screenshots and `references/ui/manifest.md`, and add UI reference sections with embedded relative screenshot links. Reuse existing captures when they still represent the settled scope; verify linked files exist. Do not silently waive missing references: ask for user-provided screenshots or an explicit waiver if capture is blocked.

Adding references to an in-flight ticket may only clarify settled scope; if they require different work, follow the scope-change and approval rules below. Never edit done or merged tickets; extra work belongs in a new ticket. Preserve existing captures and references, and do not treat a newly observed prototype behavior as approved scope. Adding references alone does not change the plan's shape or require approval.

## Edit directly

The spec answers **what and why**; tickets answer **how**. Edit `spec.md` only when intended behavior, goals, constraints or acceptance criteria change; implementation-only revisions leave it untouched. Do not add slices, ticket lists or IDs, module ownership, dependency tables, architecture diagrams, implementation steps or landing order to the spec. Edit the affected tickets without rewriting unrelated ones; do not add changelogs or "revised" notes. Keep the spec short.

If an existing spec mixes requirements and implementation, move the implementation material into the appropriate editable tickets without losing settled decisions. Never edit done or merged tickets to relocate it. If there is no editable destination, ask where to preserve the material before removing it; do not create an implementation ticket just to store historical notes.

Tickets:
- **todo** tickets: edit scope, outcome, `blocked_by`, `touches` or `unsafe_with` freely.
- **in progress / review** tickets: only clarify wording. If its scope must change, say so and record `node ~/.pi/agent/dt/dt.mjs gate $1 3 change --ticket <id> --note "Scope changed: <one line>"` so its lane picks it up.
- **done or merged** tickets: never change. Extra work becomes a new ticket.
- New tickets take the next free ID and follow the format in `/dt-start` (Outcome, Scope, Example, Out of scope, Done when; frontmatter with `blocked_by`, `touches`, `verify`, `unsafe_with`). New and clarified tickets follow its concrete-language rules: plain action titles, known code names and a short code or pseudocode behavior example, not invented contracts or unnecessary code-level instructions. For tickets that include UI, including mixed UI/backend work, describe the page or route, visible UI elements, user actions and their visible results in Outcome, Scope, Example and Done when, as in `/dt-start`; use only known or settled routes, labels and behavior. Adding an example to an in-flight ticket must only clarify its existing behavior, not add requirements. No Gherkin or change tables.
- When a solution requires investigation, apply `/dt-start`'s Investigation tickets rules: add a bounded spike rather than guessing implementation, and block dependent implementation tickets on it. After its findings are reviewed, update only affected editable tickets with the settled approach; change the spec only if intended behavior or constraints change. Preserve in-flight and completed ticket protections and request approval when dependency or scope rules below require it.
- T0/T1 stay one ticket. If the change needs more, ask the user whether to start a new T2 project; never change the tier yourself.

## Approval only for big changes

Ask for approval only when the plan's shape changes: a building block is added, removed or changes owner, a done-or-in-flight ticket would need different work, or a ready ticket's `blocked_by`/`unsafe_with` changes. Then record `node ~/.pi/agent/dt/dt.mjs gate $1 2 pending --note "<one line>"` and end with **Next command: `/dt-approve plan`**. New starts wait for that approval; work in flight continues.

Everything else (wording, scope within a module, a new ticket that depends only on existing ones, confirmed requirement clarifications) needs no approval. Save `node ~/.pi/agent/dt/dt.mjs progress $1 --next "/dt-lane $1"` when tickets remain, and end with the next command.

## Reply

At most 8 lines: what changed in the brief, which tickets changed or were added (id, title, one-line reason), whether approval is needed, and the next command. In standalone modality, remind me to commit and push changed ticket files to the main branch before starting them. Do not write implementation code or run `dt.mjs gate ... approve`.
