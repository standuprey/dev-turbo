---
description: T2 - propose new tickets or review existing-ticket changes against the approved spec (stops at Slices)
argument-hint: ""
---
Slice the approved spec at `<features dir>/$1/spec.md` into tickets (take the features dir from `node ~/.pi/agent/dt/dt.mjs info`). The approved spec and saved tickets are authoritative; conversation is not design approval.

For plan-only changes discussed through `/dt-amend`, use the intended change clarified in this conversation, not approval. If that intent is missing in a fresh session, ask the user to restate it before editing. Compare the outcome with the current spec and tickets; do not blindly replay changes already reflected there. Update only affected scopes/dependencies or add follow-ups under the still-approved spec. If the outcome changes approved behavior, contracts, data, scale or rollout, stop and hand over to `/dt-spec` rather than slipping that design change into tickets. Do not require or create a separate amendment artifact.

**Choose the mode before editing:**
- **Initial slicing:** no ticket files exist. Create the plan and use the initial-planning card below.
- **Existing-ticket alignment:** ticket files already exist. Read the current spec, tickets and progress; capture a before/after delta for this run. Preserve ticket IDs, accepted work and unchanged scopes; update only affected scopes/dependencies. Use the alignment card below, not the initial-planning card.

Do not reset status or replace actual IDs with historical spec numbering. For an in-flight ticket whose implementation scope or acceptance requirements change, invalidate its previous acceptance proposal with `node ~/.pi/agent/dt/dt.mjs gate $1 3 change --ticket <id> --note "Scope changed; fresh review required"`. Documentation-only clarifications do not by themselves reopen acceptance. Do not change already accepted work: create follow-up tickets for extra scope instead. Post a fresh Slices approval card even when existing scopes remain valid.

The approved spec is the input, not a new design proposal. Do not amend the approved spec merely to make tickets fit. Show its path and relevant revised sections; distinguish amendments already applied by `/dt-drift apply` from ticket edits made in this run. Use saved decisions/local history to summarize amendments, and say when an exact earlier spec version is unavailable rather than inventing a diff. If alignment needs an unapproved spec/contract change, flag it and stop for the appropriate review.

Read status from progress.json and merged PR facts from saved state; do not silently refresh remote facts or claim checks ran. Accepted tickets are labelled done. When saved review/PR facts support it, label merged but unaccepted work **implemented, reviewed and merged; recorded acceptance pending** (otherwise say **PRs merged; recorded acceptance pending**). In particular, never present merged 00 as awaiting implementation. Explain outstanding acceptance separately; never mark a ticket done or record approval from discussion.

Write tickets to `<features dir>/$1/tickets/NN-short-name.md`. Tickets are the work items: the monorepo has no issues, so each ticket must stand on its own. There is no hand-written dependency graph and no status file: `dt.mjs` derives the DAG from ticket frontmatter and keeps every status in `progress.json` (never edit it by hand).

**Ticket 00 is always the walking skeleton** (HITL): the contracts from the spec as compiling interfaces, empty implementations or fakes, contract-test stubs, and one path through every layer that does something trivial. Its body includes a Mermaid `sequenceDiagram` of that path (participants = modules, messages = public interface calls). I review it before any parallel work, so every other ticket has `00` in `blocked_by`.

Each later ticket is a tracer-bullet vertical slice: thin, through every layer it needs, demoable or verifiable alone. Never slice by layer; never write "phase N of M" tickets.

Frontmatter for every ticket (ids are two digits; keep the quotes):
```
---
id: "03"
title: ...
kind: AFK                     # AFK (agent alone) | HITL (needs me)
blocked_by: ["00", "02"]
touches: [module-a, module-b] # modules whose code this ticket changes
verify: service               # web | device | service | cli - which overlay applies
unsafe_with: []               # tickets that must not run in parallel with this one (shared migration, generated file, lockfile)
---
```
Body sections: **Outcome** (what is demoable), **Scenarios** (full declarative Gherkin, 2-5 scenarios, public behavior only), **Out of scope**, **Verification** (exact commands or browser/device steps), **Done when**.

Rules:
- A ticket fits one agent context window: roughly one module-boundary crossing, under ~300 lines of change. Split otherwise.
- Contracts live in ticket 00. A later ticket that needs a contract change is a slicing bug: flag it, do not hide it.
- At most 2 tickets run at once. Tickets that share `touches`, a migration, a generated file or a lockfile cannot run together: encode that in `touches` and `unsafe_with` (`dt.mjs next` enforces both). Anything shared (schema migration, dependency bump, flag wiring) is its own slice that lands first.
- Prefer AFK. HITL only for contract review, UX judgment, real hardware or production.
- If the spec has scale targets, checking them is explicit: a benchmark, load or soak slice, or a Done-when line on the tickets concerned, scheduled early so a miss changes the design while that is cheap. A target nobody checks is not a target.

Then run `node ~/.pi/agent/dt/dt.mjs status $1 --no-gh` and read its output (kanban, DAG, pairs that must not run together).

## Slices approval (stop here)

STOP. First record that the gate is waiting: `node ~/.pi/agent/dt/dt.mjs gate $1 2 pending --note "<n> tickets, <one line>"`. In alignment mode, include the number of changed tickets in that note. Then post only the card for the selected mode.

### Initial slicing: planning card

1. Table: id | title | kind | blocked_by | touches | unsafe_with.
2. The DAG (the Mermaid block printed by `status`).
3. Scenario titles per ticket.
4. The 3 slicing decisions I am least sure about.
5. "Next command: `/dt-approve slices`. Discuss adjustments before approving."

### Existing tickets: alignment card

Keep this a concise change review, not a replay of the original plan:
1. **Spec:** show the current `spec.md` path and a short summary of the relevant approved amendments, with section references. State explicitly whether this run changed spec.md; normally it did not, because drift already amended it.
2. **Preserved work:** summarize done and merged work, especially 00, using the explicit status labels above. Separate pending recorded acceptance from remaining implementation. State that IDs/status/accepted work were preserved.
3. **Affected tickets only:** table: id | title | current status | what changed | why. Distinguish implementation scope, acceptance requirements, dependencies and documentation-only clarification. Include new follow-up tickets and their purpose; list unchanged ticket IDs compactly or give their count. Do not repeat the full ticket table, full DAG or scenario-title inventory unless the user asks.
4. **Dependency/parallelism delta:** show changed blocked_by/touches/unsafe_with values as before → after; say "No dependency or parallelism changes" when unchanged. Include a small affected-subgraph diagram only when it clarifies the changes, with current-status labels for nodes. The full status output was checked, not pasted.
5. **Behavior delta and uncertainty:** Only show changed scenarios or acceptance criteria, in plain words beside the affected tickets, not standalone titles for unchanged scenarios. Give up to 3 concrete decisions needing judgment; do not manufacture uncertainty for unchanged scopes. If nothing changed, say "No ticket scope or dependency changes" and request reconfirmation without inventing edits.
6. Explain exactly what Slices approval confirms: alignment of the remaining ticket plan with the revised spec, not reimplementation or Ticket acceptance of merged work. End with "Next command: `/dt-approve slices`. Discuss adjustments before approving."

### Approval rules

Only `/dt-approve slices` records approval (standalone: it creates the ticket issues). Never approve from discussion. If changes are requested, revise the affected tickets and record `pending` again. In standalone modality, tell the user that ticket docs must be committed/pushed before a lane can start; do not silently start implementation. After approval the next command is `/dt-lane 00` for a new plan, or `/dt-lane next` when reconfirming existing slices. If 00 is merged but unaccepted, explain that `/dt-final-check 00` prepares outstanding acceptance evidence and `/dt-approve ticket 00` records completion; both are required unless valid acceptance evidence is already proposed before other tickets can start; do not tell the user to rebuild it.
