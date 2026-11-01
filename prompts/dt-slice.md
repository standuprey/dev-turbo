---
description: T2 - split an approved spec into vertical-slice tickets with Gherkin; DAG and kanban are derived (stops at Gate 2)
argument-hint: <slug>
---
Slice the approved spec at `<features dir>/$1/spec.md` into tickets (take the features dir from `node ~/.pi/agent/dt/dt.mjs info`).

Write tickets to `<features dir>/$1/tickets/NN-short-name.md`. There is no hand-written dependency graph and no status file: `dt.mjs` derives the DAG, the kanban and every status from ticket frontmatter and git.

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
verify: service               # web | device | service - which overlay applies
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

Then run `node ~/.pi/agent/dt/dt.mjs status $1 --no-fetch` and read its output (kanban, DAG, pairs that must not run together).

## Gate 2 (stop here)

STOP. In chat, post the gate card:
1. Table: id | title | kind | blocked_by | touches | unsafe_with.
2. The DAG (the Mermaid block printed by `status`).
3. Scenario titles per ticket.
4. The 3 slicing decisions I am least sure about.
5. "Approve Gate 2, or what changes?"

On my approval: save the card to a temp file and run `node ~/.pi/agent/dt/dt.mjs gate $1 2 approve --card <file>` (in standalone modality this creates one GitHub issue per ticket, writes `issue:` into each ticket and adds a task list to the feature issue). In standalone modality, then commit `docs/features/$1` and push it to the main branch (docs only, no code) so that lanes branch from a main that contains the tickets. Next: `/dt-lane $1 00`.
