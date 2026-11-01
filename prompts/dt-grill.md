---
description: Start here - grill in rounds, settle scale/ownership/reversibility/verification/non-goals, end with the tier (Gate 0)
argument-hint: "<what you want to build or change>"
---
Grill me on: $@

Start by running `node ~/.pi/agent/dt/dt.mjs info` and keep its output in mind: modality (monorepo or standalone), main branch, where feature docs live, and the `checks` command. If `checks` is unset, ask me for it once at the end and save it with `node ~/.pi/agent/dt/dt.mjs config set checks "<cmd>"`.

## How to grill

Interview me until we reach a shared understanding. Map the task as a **design tree**: every decision branches into the decisions that hang off it. Work it in **rounds**: the frontier is every decision whose prerequisites are settled. Ask the whole frontier in one round, numbered, each with your recommended answer, worded so that "yes" accepts it. Wait for my answers, recompute the frontier, repeat. A question that depends on another one still open belongs to a later round.

Format each question as:

```
❓ **Q1** - **<title>**: <body, may offer choices>

➡️ <recommended answer>
```

Facts are your job: explore the codebase (dispatch a sub-agent with a fresh context when a question needs a fact from the environment) instead of asking me anything the code can answer. Decisions are mine.

Proportion: a tiny, obvious task gets one round of 2-3 questions, not a long session.

## Topics that must be settled before closing

If one is not relevant, make me say so in one line ("n/a because ...") instead of skipping it silently.

1. **Scale** - always settled, proportionately. If nothing so far points to a T2 signal (see the table below), propose the one-liner yourself: "scale does not matter because <reason> - confirm?". Only once a T2 signal has surfaced, ask the full set: load and data volume now and in 12 months (order of magnitude), concurrency, what can grow without bound (rows, queues, memory, logs, storage), latency and throughput, behavior under failure and overload (timeouts, retries, partial failure), cost; for a device: CPU, RAM, disk, SD-card wear, flaky network, fleet size. End with exactly one of "scale matters: targets are X" or "scale does not matter because Y".
2. **Ownership** - which module owns this? New module, or a change to a module's public contract?
3. **Reversibility** - schema or data migrations, protocols, deployed device state, anything hard to undo.
4. **Verification** - how we will see it works (browser, device over ssh, tests at the module boundary); what needs a human.
5. **Non-goals** - what we are explicitly not doing.

## Closing block (Gate 0)

When the frontier is empty, post exactly this and nothing else:

**Facts**
- Task: ...
- Type: web | device | service | mixed (list the parts)
- Modules touched: ... (new / public interface changed / internal only)
- Contract impact: none | changed | new (which)
- Irreversible parts: none | ...
- Scale: matters (targets: ...) | does not matter (because ...)
- Rough size: <n> vertical slices, <effort>
- Open decisions: none | ...
- Non-goals: ...

**Signals** (yes / no / unsure, one line of evidence each)

| # | signal | answer | evidence |
|---|---|---|---|
| 1 | new module, or a public contract changed | | |
| 2 | something irreversible | | |
| 3 | scale targets shape the design | | |
| 4 | 3+ slices, or more than ~2 days | | |
| 5 | code changes in 3+ modules | | |
| 6 | an open decision remains | | |
| 7 | tiny and local (≤ ~30 lines, one place) | | |

**Tier** - apply these rules in order, do not improvise:
1. Any of signals 1-5 = yes → **T2**.
2. Any of signals 1-5 = unsure → T2 for now, but first list the unsure ones under "ASK ME FIRST", ask them, and redo the table.
3. Signal 7 = yes and signal 6 = no → **T0**.
4. Otherwise **T1**. If signal 6 = yes the task is not ready: go back one round and settle the decision.

Proposed: **Tier Tn · Type <type>**. Approve, or override with a reason?

On my approval run `node ~/.pi/agent/dt/dt.mjs gate <slug> 0 approve --tier Tn --type <type> --note "<task in one line>"` with a short kebab-case slug, show its output, and name the next command: `/dt-spec <slug> <type>` for T2, `/dt-quick <type> as aligned` for T0 and T1. Do not write any other file.
