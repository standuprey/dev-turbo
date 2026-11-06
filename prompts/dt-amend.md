---
description: T2 - discuss a change to the selected project, save an amendment proposal, then hand off to spec or slice alignment
argument-hint: "<description of the change>"
---
Discuss an amendment to the selected T2 feature "$1".
Requested change: ${@:2}

This is a short alignment session for an existing project, not a new grill or an approval gate. Preserve the selected project, slug and tier. Do not call dt_propose_scope or run `/dt-grill`. Do not implement the request or treat agreement in discussion as approval.

## Ground the discussion

1. Run `node ~/.pi/agent/dt/dt.mjs info`. Read `<features dir>/$1/spec.md` and saved progress with `node ~/.pi/agent/dt/dt.mjs progress $1`. Read any existing `amendment.md`, then inspect only relevant ticket files and code to establish current behavior, overlap and dependencies. Actual ticket IDs are authoritative, not historical spec numbering. Saved PR states are observations, not a fresh remote check.
2. State the requested outcome in plain words, what the approved plan currently says, and which actual tickets might change. Separate done/merged work from remaining implementation and acceptance. Do not reset status, revisit completed code review, or assume merged means accepted.
3. If the description is missing, ask for it and stop. A request is intent to explore, not permission to make changes.

## Mini questions round

**Ask questions before choosing the route.** Ask the smallest useful frontier of self-contained questions, usually 2–5 at a time; do not repeat facts already settled. For each question give the current behavior/evidence, why the distinction matters, concrete options and a recommendation. Wait for answers, then ask follow-ups only where needed. A diagram is useful when it clarifies a boundary or release sequence.

Settle:
- Why change now, and what demoable/verifiable outcome is wanted?
- What changes and what must remain unchanged (behavior, contracts, data, permissions, rollout or compatibility)?
- Is this new work, a reprioritization, or a split of existing scope? Which tickets overlap, and can the change be small enough for one context window?
- What protects existing accepted/merged work and users of the current release? Extra scope on merged/accepted work becomes a follow-up, not a reopened old PR.
- How is the change verified, what prerequisites does it need, and what is explicitly out of scope?

Use those answers and code evidence to choose the route, not the user's initial guess that it is or is not a spec change:
- **`/dt-spec`:** changes approved user-visible behavior, goals/non-goals, module responsibilities/public contracts, stored data, scale targets, compatibility or release ordering. Propose targeted spec amendments; Architecture approval follows, then slice alignment.
- **`/dt-slice`:** the approved spec still fully permits the intended outcome; only remaining ticket scopes, follow-ups, priority/dependencies or verification allocation need to change. Slices approval follows. A cleanup with unchanged behavior/contracts/rollout can take this route; retiring live v1 support sooner cannot if the spec promises it until cutover.

If the request is already covered unchanged, explain which ticket covers it and ask whether any priority/scope change is actually wanted. Do not manufacture an amendment. If the request is outside this project's scope/tier, ask whether to narrow it or create a separate project; do not silently change the selection or force it into these routes. Blocked decisions stay explicit; do not freeze a route with unanswered questions.

## Save the proposal, not implementation

Save discussion results to `<features dir>/$1/amendment.md`, including unresolved questions when the session pauses. This is a change proposal, not a status file, dependency graph or approved spec. Update only this proposal during the discussion. Keep enough evidence for `/dt-spec` or `/dt-slice` to start in a fresh session:
- Request and reason; proposal date.
- Current approved behavior → proposed outcome, with relevant spec sections.
- Settled decisions, preserved behavior and non-goals.
- Affected actual ticket IDs and current status; overlapping existing scopes; proposed follow-ups or dependency changes.
- Acceptance/scale checks and human prerequisites.
- Remaining questions, or none.
- Route: `/dt-spec` or `/dt-slice`, with the factual reason (omit until settled).

Do not edit spec.md or ticket files, write implementation code, merge PRs, alter ticket status/acceptance, or record approval in this command. Amendments do not create a new Scope gate.

## Handoff (stop here)

Only when the questions are settled and a real plan change is proposed:
- For `/dt-spec`, invalidate the previous Architecture proposal/approval with `node ~/.pi/agent/dt/dt.mjs gate $1 1 change --note "Amendment proposed; revise spec from amendment.md"`.
- For `/dt-slice`, invalidate the previous Slices proposal/approval with `node ~/.pi/agent/dt/dt.mjs gate $1 2 change --note "Amendment proposed; align tickets from amendment.md"`.
- Save the exact next command using `node ~/.pi/agent/dt/dt.mjs progress $1 --next "/dt-spec"` or `--next "/dt-slice"`. Preserve existing todo/blockers; do not clear them when saving the handoff. Gate change invalidates a stale plan; it is not human approval or a decision to change accepted work.

Post a short alignment summary: proposed change, what stays unchanged, affected tickets with status, chosen route and why, and the `amendment.md` path. Explain the downstream approval: Architecture then Slices for `/dt-spec`, or Slices only for `/dt-slice`. End with exactly the chosen next command, `/dt-spec` or `/dt-slice`, and STOP. Do not run it automatically or post an approval card for this alignment session.

Only user `/dt-approve` commands approve the downstream proposals. If paused, save the questions in amendment.md and continue asking; do not invalidate gates or route to implementation prematurely.
