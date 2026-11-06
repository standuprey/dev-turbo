---
description: T2 - clarify a change in chat and suggest targeted spec or slice amendments; no artifacts or state changes
argument-hint: "<description of the change>"
---
Discuss an amendment to the selected T2 feature "$1".
Requested change: ${@:2}

This is discussion only, not a new grill or an approval gate. Preserve the selected project, slug and tier. Do not call dt_propose_scope or run `/dt-grill`. Agreement in chat is not approval.

## Ground the discussion

1. If the description is missing, ask for it and stop.
2. Run `node ~/.pi/agent/dt/dt.mjs info`. Read `<features dir>/$1/spec.md` and saved progress with `node ~/.pi/agent/dt/dt.mjs progress $1` (read-only). Inspect only relevant ticket files and code to establish current behavior, overlap and dependencies. Actual ticket IDs are authoritative, not historical spec numbering. Saved PR states are observations, not a fresh remote check.
3. Briefly state the requested outcome, what the approved plan currently says, and which actual tickets might change. Separate done/merged work from remaining implementation and acceptance; merged does not mean accepted.

## Clarify

**Ask questions before choosing the route.** Ask only the smallest useful set, usually 2–5 at a time. Give current evidence, why the distinction matters, concrete options and a recommendation. Wait for answers; ask follow-ups only where needed. Do not repeat settled facts.

Settle the reason and first verifiable outcome; what changes and what must remain unchanged; existing scope overlaps, priority/dependency changes or follow-ups; verification and human prerequisites. Preserve accepted/merged work: extra scope becomes a follow-up, not a reopened old PR. Keep the change small enough for one context window or suggest a split.

## Recommend amendments in chat

Explain both whether the spec needs changing and how, and whether the plan/tickets/slices need changing and how. Name relevant spec sections and actual ticket IDs with status. Describe only affected changes, preserved behavior and verification; do not reproduce the full plan.

- **`/dt-spec`:** approved behavior, goals/non-goals, module responsibilities/public contracts, data, scale, compatibility or release ordering must change. Suggest targeted spec edits, then the corresponding ticket alignment. Architecture approval follows, then Slices approval.
- **`/dt-slice`:** the approved spec fully permits the outcome; only remaining ticket scopes, follow-ups, priorities/dependencies or verification allocation change. Explain why no spec edit is needed and suggest the specific slice changes. Slices approval follows. Unchanged-behavior cleanup can take this route; retiring live v1 earlier cannot if the spec promises it until cutover.

If already covered unchanged, name the existing ticket and ask whether any actual priority/scope change is wanted; do not manufacture an amendment. If outside this project, ask whether to narrow it or use a separate project without changing selection. If decisions remain open, continue asking rather than choosing a route.

## Stop without writing

Do not create or update any feature artifact. Do not edit spec.md or ticket files, write implementation code, merge PRs, alter project selection, ticket status/acceptance, gates or progress, or record approval. Do not run dt.mjs gate or write-mode progress commands. Do not save a separate proposal or handoff file.

Once settled, post a short recommendation in this conversation: spec changes needed (or none), plan/ticket changes needed (or none), preserved work, verification impact, and why the suggested route fits. End with exactly the suggested next command, `/dt-spec` or `/dt-slice`, and STOP. Do not run it automatically or post an approval card.

The downstream command uses the discussion in this session. In a fresh session, ask the user to restate the intended change; never invent a missing handoff or create another artifact to preserve it. Only user `/dt-approve` commands approve downstream proposals.
